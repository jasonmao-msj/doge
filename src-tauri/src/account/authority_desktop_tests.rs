use super::authority::{TokenMatrixAuthority, TOKEN_MATRIX_ORIGIN};
use super::desktop_continuation::{DesktopContinuationBroker, DesktopContinuationPurpose};
use axum::{
    extract::{Query, State},
    http::HeaderMap,
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

const NOW: i64 = 1_893_456_000;
const DEVICE: &str = "device_synthetic01";

#[derive(Clone, Default)]
struct CapturedRequests(Arc<Mutex<Vec<(String, Value)>>>);

async fn spawn_protocol_server(app: Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind OAuth protocol server");
    let address = listener.local_addr().expect("OAuth protocol address");
    tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("serve OAuth protocol test");
    });
    format!("http://{address}")
}

fn capture(captured: &CapturedRequests, headers: &HeaderMap, body: Value) {
    let idempotency_key = headers
        .get("idempotency-key")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    captured
        .0
        .lock()
        .expect("capture OAuth request")
        .push((idempotency_key, body));
}

#[tokio::test]
async fn desktop_oauth_authority_wire_is_scoped_secret_safe_and_idempotent() {
    let captured = CapturedRequests::default();
    let app = Router::new()
        .route(
            "/api/v1/desktop/v1/oauth/authorizations",
            post(
                |State(captured): State<CapturedRequests>,
                 headers: HeaderMap,
                 Json(body): Json<Value>| async move {
                    capture(&captured, &headers, body);
                    Json(json!({
                        "code": 0,
                        "data": {
                            "authorization_id": "authorization_synthetic0001",
                            "authorize_url": "https://github.com/login/oauth/authorize?client_id=synthetic",
                            "expires_at": "2030-01-01T00:01:00Z"
                        }
                    }))
                },
            ),
        )
        .route(
            "/api/v1/desktop/v1/oauth/authorizations/authorization_synthetic0001/exchange",
            post(
                |State(captured): State<CapturedRequests>,
                 headers: HeaderMap,
                 Json(body): Json<Value>| async move {
                    capture(&captured, &headers, body);
                    Json(json!({
                        "code": 0,
                        "data": {
                            "requires_2fa": false,
                            "access_token": "synthetic-access",
                            "refresh_token": "synthetic-refresh",
                            "expires_in": 900,
                            "user": { "id": 42, "username": "Synthetic" }
                        }
                    }))
                },
            ),
        )
        .with_state(captured.clone());
    let origin = spawn_protocol_server(app).await;
    let authority = TokenMatrixAuthority::new_for_protocol_test(origin, None);
    let broker = DesktopContinuationBroker::new();
    let start = broker
        .begin_loopback(
            DesktopContinuationPurpose::OAuth,
            TOKEN_MATRIX_ORIGIN,
            "doge-desktop",
            DEVICE,
            3,
            17,
            NOW,
            60,
        )
        .await
        .expect("begin local OAuth continuation");

    let remote = authority
        .begin_desktop_oauth(
            "github",
            "login",
            &start.callback_uri,
            &start.pkce_challenge,
            &start.state,
            &start.nonce,
            DEVICE,
            "operation_oauthbegin0001",
        )
        .await
        .expect("begin Authority OAuth");
    assert_eq!(remote.authorization_id, "authorization_synthetic0001");

    let callback = format!(
        "{}?state={}&ticket=synthetic-desktop-ticket-0001",
        start.callback_uri.as_str(),
        start.state.as_str()
    );
    assert!(reqwest::get(callback)
        .await
        .expect("return ticket")
        .status()
        .is_success());
    for _ in 0..2 {
        let material = broker
            .exchange_material(
                &start.handle,
                DesktopContinuationPurpose::OAuth,
                TOKEN_MATRIX_ORIGIN,
                "doge-desktop",
                DEVICE,
                3,
                17,
                NOW,
            )
            .await
            .expect("read retryable exchange material");
        let login = authority
            .exchange_desktop_oauth(
                &remote.authorization_id,
                &material,
                DEVICE,
                "operation_oauthexchange0001",
            )
            .await
            .expect("exchange desktop ticket");
        assert_eq!(login.access_token.as_deref(), Some("synthetic-access"));
    }

    let requests = captured.0.lock().expect("captured OAuth requests");
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[0].0, "operation_oauthbegin0001");
    assert_eq!(requests[1].0, "operation_oauthexchange0001");
    assert_eq!(requests[2].0, "operation_oauthexchange0001");
    assert_eq!(
        requests[0]
            .1
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>(),
        vec![
            "audience",
            "device_id",
            "intent",
            "nonce",
            "pkce_challenge",
            "pkce_challenge_method",
            "provider",
            "redirect_uri",
            "state"
        ]
    );
    assert_eq!(
        requests[1]
            .1
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<_>>(),
        vec![
            "audience",
            "desktop_ticket",
            "device_id",
            "nonce",
            "pkce_verifier",
            "redirect_uri"
        ]
    );
    assert_eq!(requests[1].1, requests[2].1);
    for (_, body) in requests.iter() {
        let serialized = body.to_string();
        assert!(!serialized.contains("access_token"));
        assert!(!serialized.contains("refresh_token"));
        assert!(!serialized.contains("password"));
    }
}

#[tokio::test]
async fn desktop_api_key_list_is_metadata_only_and_handoff_is_scoped() {
    let captured = CapturedRequests::default();
    let app = Router::new()
        .route(
            "/api/v1/desktop/v1/api-keys",
            get(|| async {
                Json(json!({
                    "code": 0,
                    "data": {
                        "keys": [{
                            "id": 7,
                            "name": "Codex",
                            "key_prefix": "sk-syntheti",
                            "status": "active",
                            "availability": "selectable"
                        }]
                    }
                }))
            }),
        )
        .route(
            "/api/v1/desktop/v1/api-keys/7/handoffs",
            post(
                |State(captured): State<CapturedRequests>,
                 headers: HeaderMap,
                 Json(body): Json<Value>| async move {
                    capture(&captured, &headers, body);
                    Json(json!({
                        "code": 0,
                        "data": { "id": 7, "secret": "synthetic-desktop-key" }
                    }))
                },
            ),
        )
        .with_state(captured.clone());
    let origin = spawn_protocol_server(app).await;
    let authority = TokenMatrixAuthority::new_for_protocol_test(origin, None);

    let listed = authority
        .list_api_key_candidates("synthetic-access")
        .await
        .expect("list API Key metadata");
    assert_eq!(listed.keys.len(), 1);
    assert_eq!(listed.keys[0].id, 7);
    assert_eq!(listed.keys[0].name, "Codex");
    assert_eq!(listed.keys[0].key_prefix, "sk-syntheti");
    assert_eq!(listed.keys[0].status, "active");
    assert_eq!(listed.keys[0].availability, "selectable");

    let handed_off = authority
        .handoff_api_key("synthetic-access", 7, DEVICE, "operation_keyhandoff0001")
        .await
        .expect("handoff selected API Key");
    assert_eq!(handed_off.id, 7);
    assert_eq!(handed_off.secret, "synthetic-desktop-key");
    let requests = captured.0.lock().expect("captured API Key handoff");
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].0, "operation_keyhandoff0001");
    assert_eq!(
        requests[0].1,
        json!({
            "audience": "doge-desktop",
            "device_id": DEVICE,
            "recipe_id": "doge.account.codex-token-service",
            "recipe_version": 1,
        }),
    );
}

#[tokio::test]
async fn subscription_usage_authority_wire_uses_progress_and_group_scoped_dashboard() {
    let captured_query = Arc::new(Mutex::new(HashMap::<String, String>::new()));
    let app = Router::new()
        .route(
            "/api/v1/subscriptions/progress",
            get(|| async {
                Json(json!({
                    "code": 0,
                    "data": [{
                        "subscription": { "id": 7, "group_id": 11 },
                        "progress": {
                            "id": 7,
                            "group_name": "Codex Pro",
                            "expires_at": "2030-02-01T00:00:00+08:00",
                            "daily": {
                                "limit_usd": 10.0,
                                "used_usd": 1.25,
                                "remaining_usd": 8.75,
                                "percentage": 12.5,
                                "window_start": "2030-01-01T00:00:00+08:00",
                                "resets_at": "2030-01-02T00:00:00+08:00",
                                "resets_in_seconds": 3600
                            }
                        }
                    }]
                }))
            }),
        )
        .route(
            "/api/v1/usage/dashboard/snapshot-v2",
            get({
                let captured_query = Arc::clone(&captured_query);
                move |Query(query): Query<HashMap<String, String>>| {
                    let captured_query = Arc::clone(&captured_query);
                    async move {
                        *captured_query.lock().expect("capture usage query") = query;
                        Json(json!({
                            "code": 0,
                            "data": {
                                "generated_at": "2030-01-01T00:00:00Z",
                                "start_date": "2029-01-02",
                                "end_date": "2030-01-01",
                                "granularity": "day",
                                "trend": [{
                                    "date": "2030-01-01", "requests": 2,
                                    "input_tokens": 100, "output_tokens": 20,
                                    "cache_creation_tokens": 5, "cache_read_tokens": 10,
                                    "total_tokens": 135, "cost": 1.5, "actual_cost": 1.25
                                }],
                                "models": [{
                                    "model": "gpt-5", "requests": 2,
                                    "input_tokens": 100, "output_tokens": 20,
                                    "cache_creation_tokens": 5, "cache_read_tokens": 10,
                                    "total_tokens": 135, "cost": 1.5, "actual_cost": 1.25
                                }]
                            }
                        }))
                    }
                }
            }),
        );
    let origin = spawn_protocol_server(app).await;
    let authority = TokenMatrixAuthority::new_for_protocol_test(origin, None);

    let progress = authority
        .subscription_progress("synthetic-access")
        .await
        .expect("subscription progress");
    assert_eq!(progress[0].subscription.id, 7);
    assert_eq!(
        progress[0]
            .progress
            .daily
            .as_ref()
            .map(|value| value.used_usd),
        Some(1.25)
    );
    assert_eq!(
        progress[0]
            .progress
            .daily
            .as_ref()
            .map(|value| value.window_start.as_str()),
        Some("2030-01-01T00:00:00+08:00")
    );

    let snapshot = authority
        .usage_dashboard_snapshot(
            "synthetic-access",
            11,
            "2029-01-02",
            "2030-01-01",
            "day",
            true,
            true,
        )
        .await
        .expect("group-scoped usage dashboard");
    assert_eq!(snapshot.trend[0].actual_cost, 1.25);
    assert_eq!(snapshot.models[0].model, "gpt-5");
    let query = captured_query.lock().expect("usage query");
    assert_eq!(query.get("group_id").map(String::as_str), Some("11"));
    assert_eq!(query.get("granularity").map(String::as_str), Some("day"));
    assert_eq!(
        query.get("start_date").map(String::as_str),
        Some("2029-01-02")
    );
    assert_eq!(
        query.get("end_date").map(String::as_str),
        Some("2030-01-01")
    );
    assert_eq!(query.get("include_trend").map(String::as_str), Some("true"));
    assert_eq!(
        query.get("include_model_stats").map(String::as_str),
        Some("true")
    );
}

#[tokio::test]
async fn product_account_detail_wire_matches_generic_token2api_user_routes() {
    let captured_usage_query = Arc::new(Mutex::new(HashMap::<String, String>::new()));
    let app = Router::new()
        .route(
            "/api/v1/payment/checkout-info",
            get(|| async {
                Json(json!({
                    "code": 0,
                    "data": {
                        "methods": {
                            "alipay": {
                                "payment_type": "alipay",
                                "display_name": "支付宝",
                                "currency": "CNY"
                            }
                        },
                        "subscription_usd_to_cny_rate": 7.2,
                        "plans": [{
                            "id": 5,
                            "group_id": 11,
                            "group_platform": "composite",
                            "group_name": "Doge",
                            "name": "Doge Pro",
                            "description": "All supported models",
                            "price": 12.0,
                            "original_price": 16.0,
                            "validity_days": 30,
                            "validity_unit": "day",
                            "features": ["All models"],
                            "daily_limit_usd": 2.0,
                            "weekly_limit_usd": 8.0,
                            "monthly_limit_usd": 20.0
                        }]
                    }
                }))
            }),
        )
        .route(
            "/api/v1/usage/stats",
            get({
                let captured_usage_query = Arc::clone(&captured_usage_query);
                move |Query(query): Query<HashMap<String, String>>| {
                    let captured_usage_query = Arc::clone(&captured_usage_query);
                    async move {
                        *captured_usage_query
                            .lock()
                            .expect("capture product usage query") = query;
                        Json(json!({
                            "code": 0,
                            "data": {
                                "total_requests": 7,
                                "total_input_tokens": 100,
                                "total_output_tokens": 20,
                                "total_cache_tokens": 10,
                                "total_cache_creation_tokens": 4,
                                "total_cache_read_tokens": 6,
                                "total_tokens": 130,
                                "total_cost": 1.25,
                                "total_actual_cost": 1.0,
                                "average_duration_ms": 7200.0
                            }
                        }))
                    }
                }
            }),
        )
        .route(
            "/api/v1/payment/orders/my",
            get(|| async {
                Json(json!({
                    "code": 0,
                    "data": {
                        "items": [{
                            "id": 91,
                            "amount": 12.0,
                            "pay_amount": 86.4,
                            "currency": "CNY",
                            "status": "completed",
                            "order_type": "subscription",
                            "plan_id": 5,
                            "created_at": "2030-01-01T00:00:00Z",
                            "paid_at": "2030-01-01T00:01:00Z",
                            "expires_at": "2030-01-01T00:30:00Z"
                        }],
                        "total": 1,
                        "page": 1,
                        "page_size": 20,
                        "pages": 1
                    }
                }))
            }),
        );
    let origin = spawn_protocol_server(app).await;
    let authority = TokenMatrixAuthority::new_for_protocol_test(origin, None);

    let checkout = authority
        .product_checkout_info("synthetic-access")
        .await
        .expect("product checkout info");
    assert_eq!(checkout.plans[0].validity_unit, "day");
    assert_eq!(checkout.plans[0].features, vec!["All models"]);
    assert_eq!(checkout.plans[0].monthly_limit_usd, Some(20.0));

    let usage = authority
        .product_usage_stats("synthetic-access", 11, "2030-01-01", "2030-01-30")
        .await
        .expect("product usage stats");
    assert_eq!(usage.total_requests, 7);
    assert_eq!(usage.average_duration_ms, 7200.0);
    let query = captured_usage_query.lock().expect("product usage query");
    assert_eq!(query.get("group_id").map(String::as_str), Some("11"));
    assert_eq!(
        query.get("start_date").map(String::as_str),
        Some("2030-01-01")
    );
    assert_eq!(
        query.get("end_date").map(String::as_str),
        Some("2030-01-30")
    );

    let orders = authority
        .product_orders("synthetic-access")
        .await
        .expect("product orders");
    assert_eq!(orders.items[0].plan_id, Some(5));
    assert_eq!(orders.items[0].currency, "CNY");
    assert_eq!(orders.items[0].pay_amount, 86.4);
}

#[tokio::test]
#[ignore = "requires an isolated live token2api authority"]
async fn live_token2api_existing_key_handoff_matches_native_contract() {
    let origin = std::env::var("DOGE_ACCOUNT_E2E_ORIGIN").expect("live Authority origin");
    let email = std::env::var("DOGE_ACCOUNT_E2E_EMAIL").expect("live Authority email");
    let password = std::env::var("DOGE_ACCOUNT_E2E_PASSWORD").expect("live Authority password");
    let authority =
        TokenMatrixAuthority::new_for_protocol_test(origin, Some("/api/v1/desktop/v1/authority"));

    let settings = authority.public_settings().await.expect("public settings");
    settings
        .validate_fixed_authority()
        .expect("fixed local Authority origin");
    let descriptor = authority
        .capability_descriptor()
        .await
        .expect("closed Authority descriptor");
    assert!(descriptor.supports(
        "apiKeyHandoff",
        &[
            "api_key_one_time_secret_v1",
            "api_key_owner_handoff_v1",
            "api_key_recoverable_encryption_v1",
        ],
    ));

    let login = authority
        .login(&email, &password)
        .await
        .expect("live login");
    let access = login.access_token.expect("live access token");
    let candidates = authority
        .list_api_key_candidates(&access)
        .await
        .expect("live candidate list");
    let selected = candidates
        .keys
        .into_iter()
        .find(|candidate| candidate.status == "active" && candidate.availability == "selectable")
        .expect("selectable existing API Key");
    let first = authority
        .handoff_api_key(
            &access,
            selected.id,
            "device_doge_native_e2e_0001",
            "operation_doge_native_e2e_0001",
        )
        .await
        .expect("first native handoff");
    let replay = authority
        .handoff_api_key(
            &access,
            selected.id,
            "device_doge_native_e2e_0001",
            "operation_doge_native_e2e_0001",
        )
        .await
        .expect("idempotent native handoff replay");
    assert_eq!(first.id, selected.id);
    assert_eq!(first.secret, replay.secret);
    assert!(!first.secret.is_empty());
}
