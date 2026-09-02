// Tencent Weixin iLink protocol adapter based on the MIT-licensed
// @tencent-weixin/openclaw-weixin 2.4.6 package. See the bundled license notice.

use std::collections::HashMap;
use std::env;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::Mutex;
use uuid::Uuid;

const LOCAL_API_KEY_ENV: &str = "DOGE_WECHAT_API_KEY";
const WEBHOOK_TOKEN_ENV: &str = "DOGE_WECHAT_WEBHOOK_TOKEN";
const WEBHOOK_URL_ENV: &str = "DOGE_WECHAT_WEBHOOK_URL";
const DATA_DIR_ENV: &str = "DOGE_WECHAT_DATA_DIR";

const PROVIDER_NAME: &str = "@tencent-weixin/openclaw-weixin";
const PROVIDER_VERSION: &str = "2.4.6";
const PROVIDER_INTEGRITY: &str =
    "sha512-qw9k3PLTiMWGNjjsknHgcTManH1w4j+Ji1ArWIaYLKCq3aFRsVwcqnPi127bvOoVMJGW4dbyJ8NECEMgoO+iRw==";
const FIXED_ILINK_BASE_URL: &str = "https://ilinkai.weixin.qq.com";
const ILINK_APP_ID: &str = "bot";
const ILINK_APP_CLIENT_VERSION: &str = "132102";
const ILINK_BOT_TYPE: &str = "3";
const QR_TTL_MS: u64 = 5 * 60_000;
const QR_POLL_TIMEOUT: Duration = Duration::from_secs(35);
const API_TIMEOUT: Duration = Duration::from_secs(15);
const UPDATES_TIMEOUT: Duration = Duration::from_secs(40);

#[derive(Clone)]
struct BridgeState {
    config: BridgeConfig,
    client: Client,
    session: Arc<Mutex<SessionState>>,
    login: Arc<Mutex<Option<ActiveLogin>>>,
    runtime: Arc<Mutex<RuntimeState>>,
}

#[derive(Clone)]
struct BridgeConfig {
    local_api_key: String,
    webhook_token: String,
    webhook_url: String,
    data_dir: PathBuf,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct SessionState {
    bot_token: Option<String>,
    account_id: Option<String>,
    user_id: Option<String>,
    base_url: Option<String>,
    get_updates_buf: String,
    context_tokens: HashMap<String, String>,
}

#[derive(Debug, Clone)]
struct ActiveLogin {
    generation: String,
    qrcode: String,
    current_base_url: String,
    pending_verify_code: Option<String>,
    status: String,
    message: String,
    started_at_ms: u64,
}

#[derive(Debug, Clone, Default)]
struct RuntimeState {
    disconnected: bool,
    last_error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SendMessageRequest {
    to: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct VerifyCodeRequest {
    code: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginStatusResponse {
    status: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    account_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct QrCodeResponse {
    qrcode: String,
    qrcode_img_content: String,
}

#[derive(Debug, Deserialize)]
struct QrStatusResponse {
    status: String,
    bot_token: Option<String>,
    ilink_bot_id: Option<String>,
    baseurl: Option<String>,
    ilink_user_id: Option<String>,
    redirect_host: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct UpdatesResponse {
    ret: Option<i64>,
    errcode: Option<i64>,
    errmsg: Option<String>,
    msgs: Option<Vec<IlinkMessage>>,
    get_updates_buf: Option<String>,
}

#[derive(Debug, Deserialize)]
struct IlinkMessage {
    seq: Option<u64>,
    message_id: Option<u64>,
    client_id: Option<String>,
    from_user_id: Option<String>,
    group_id: Option<String>,
    message_type: Option<i64>,
    message_state: Option<i64>,
    item_list: Option<Vec<MessageItem>>,
    context_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct MessageItem {
    #[serde(rename = "type")]
    item_type: i64,
    text_item: Option<TextItem>,
}

#[derive(Debug, Deserialize)]
struct TextItem {
    text: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebhookMessage {
    msg_id: String,
    wxid: String,
    text: String,
    is_group: bool,
}

impl BridgeConfig {
    fn from_env() -> Result<Self, String> {
        let data_dir = PathBuf::from(required_env(DATA_DIR_ENV)?);
        std::fs::create_dir_all(&data_dir)
            .map_err(|error| format!("failed to create WeChat provider data directory: {error}"))?;
        Ok(Self {
            local_api_key: required_env(LOCAL_API_KEY_ENV)?,
            webhook_token: required_env(WEBHOOK_TOKEN_ENV)?,
            webhook_url: required_env(WEBHOOK_URL_ENV)?,
            data_dir,
        })
    }
}

fn required_env(name: &str) -> Result<String, String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("missing required WeChat bridge environment variable: {name}"))
}

#[tokio::main]
async fn main() {
    let listen = listen_address().unwrap_or_else(|error| exit_configuration_error(&error));
    let config = BridgeConfig::from_env().unwrap_or_else(|error| exit_configuration_error(&error));
    let session =
        load_session(&config.data_dir).unwrap_or_else(|error| exit_configuration_error(&error));
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
        .unwrap_or_else(|error| exit_configuration_error(&format!("HTTP client error: {error}")));
    let state = Arc::new(BridgeState {
        config,
        client,
        session: Arc::new(Mutex::new(session)),
        login: Arc::new(Mutex::new(None)),
        runtime: Arc::new(Mutex::new(RuntimeState::default())),
    });

    tokio::spawn(monitor_updates(state.clone()));

    let router = Router::new()
        .route("/health", get(health))
        .route("/login/qrcode", get(login_qrcode))
        .route("/login/status", get(login_status))
        .route("/login/verify", post(login_verify))
        .route("/message/send", post(send_message))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(listen)
        .await
        .unwrap_or_else(|error| {
            exit_configuration_error(&format!("failed to bind local listener: {error}"))
        });
    if let Err(error) = axum::serve(listener, router).await {
        eprintln!("WeChat bridge stopped: {error}");
        std::process::exit(1);
    }
}

fn exit_configuration_error(message: &str) -> ! {
    eprintln!("WeChat bridge configuration error: {message}");
    std::process::exit(2);
}

fn listen_address() -> Result<SocketAddr, String> {
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--listen" {
            return args
                .next()
                .ok_or_else(|| "--listen requires host:port".to_string())?
                .parse()
                .map_err(|_| "--listen must be a valid host:port".to_string());
        }
    }
    "127.0.0.1:18789"
        .parse()
        .map_err(|_| "default bridge address is invalid".to_string())
}

async fn health(State(state): State<Arc<BridgeState>>) -> (StatusCode, Json<Value>) {
    let logged_in = state.session.lock().await.bot_token.is_some();
    (
        StatusCode::OK,
        Json(json!({
            "ok": true,
            "provider": PROVIDER_NAME,
            "providerVersion": PROVIDER_VERSION,
            "providerIntegrity": PROVIDER_INTEGRITY,
            "loggedIn": logged_in
        })),
    )
}

async fn login_qrcode(
    State(state): State<Arc<BridgeState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state.config)?;
    let local_token_list = state
        .session
        .lock()
        .await
        .bot_token
        .clone()
        .into_iter()
        .collect::<Vec<_>>();
    let value = provider_json(
        &state,
        Method::POST,
        FIXED_ILINK_BASE_URL,
        &format!("ilink/bot/get_bot_qrcode?bot_type={ILINK_BOT_TYPE}"),
        None,
        Some(json!({ "local_token_list": local_token_list })),
        API_TIMEOUT,
    )
    .await
    .map_err(provider_error)?;
    let response: QrCodeResponse = serde_json::from_value(value).map_err(|_| {
        provider_error("Tencent iLink did not return a valid login QR code".to_string())
    })?;
    if response.qrcode.trim().is_empty() || response.qrcode_img_content.trim().is_empty() {
        return Err(provider_error(
            "Tencent iLink did not return a valid login QR code".to_string(),
        ));
    }

    let generation = Uuid::new_v4().simple().to_string();
    let started_at_ms = now_ms();
    *state.login.lock().await = Some(ActiveLogin {
        generation: generation.clone(),
        qrcode: response.qrcode,
        current_base_url: FIXED_ILINK_BASE_URL.to_string(),
        pending_verify_code: None,
        status: "waiting".to_string(),
        message: "请使用手机微信扫码".to_string(),
        started_at_ms,
    });
    tokio::spawn(poll_login(state.clone(), generation));

    Ok(Json(json!({
        "value": response.qrcode_img_content,
        "expiresAt": (started_at_ms + QR_TTL_MS).to_string()
    })))
}

async fn login_status(
    State(state): State<Arc<BridgeState>>,
    headers: HeaderMap,
) -> Result<Json<LoginStatusResponse>, ApiError> {
    authorize(&headers, &state.config)?;
    let active = state.login.lock().await.clone();
    if let Some(login) = active.filter(|login| login.status != "logged_in") {
        return Ok(Json(LoginStatusResponse {
            status: login.status,
            message: login.message,
            account_id: None,
        }));
    }

    let session = state.session.lock().await.clone();
    let runtime = state.runtime.lock().await.clone();
    let (status, message) = if session.bot_token.is_none() {
        ("logged_out".to_string(), "微信尚未扫码登录".to_string())
    } else if runtime.disconnected {
        (
            "disconnected".to_string(),
            runtime
                .last_error
                .unwrap_or_else(|| "Tencent iLink 连接已中断".to_string()),
        )
    } else {
        ("logged_in".to_string(), "微信已登录".to_string())
    };
    Ok(Json(LoginStatusResponse {
        status,
        message,
        account_id: session.account_id,
    }))
}

async fn login_verify(
    State(state): State<Arc<BridgeState>>,
    headers: HeaderMap,
    Json(request): Json<VerifyCodeRequest>,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state.config)?;
    let code = request.code.trim();
    if code.is_empty() || code.len() > 8 || !code.bytes().all(|value| value.is_ascii_digit()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"ok": false, "error": "verification code must contain 1-8 digits"})),
        ));
    }
    let mut login = state.login.lock().await;
    let active = login.as_mut().ok_or_else(|| {
        (
            StatusCode::CONFLICT,
            Json(json!({"ok": false, "error": "no active WeChat login"})),
        )
    })?;
    active.pending_verify_code = Some(code.to_string());
    active.status = "awaiting_confirmation".to_string();
    active.message = "正在验证手机微信显示的数字".to_string();
    Ok(Json(json!({"ok": true})))
}

async fn send_message(
    State(state): State<Arc<BridgeState>>,
    headers: HeaderMap,
    Json(request): Json<SendMessageRequest>,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state.config)?;
    let to = request.to.trim();
    let content = request.content.trim();
    if to.is_empty() || content.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"ok": false, "error": "message target and content are required"})),
        ));
    }

    let session = state.session.lock().await.clone();
    let token = session
        .bot_token
        .as_deref()
        .ok_or_else(|| provider_error("WeChat is not logged in".to_string()))?;
    let base_url = session.base_url.as_deref().unwrap_or(FIXED_ILINK_BASE_URL);
    let client_id = format!(
        "doge-weixin:{}-{}",
        now_ms(),
        &Uuid::new_v4().simple().to_string()[..8]
    );
    let payload = build_send_message_payload(
        to,
        content,
        &client_id,
        session.context_tokens.get(to).map(String::as_str),
    );
    let response = provider_json(
        &state,
        Method::POST,
        base_url,
        "ilink/bot/sendmessage",
        Some(token),
        Some(payload),
        API_TIMEOUT,
    )
    .await
    .map_err(provider_error)?;
    ensure_provider_success(&response).map_err(provider_error)?;
    Ok(Json(json!({"ok": true, "messageId": client_id})))
}

async fn poll_login(state: Arc<BridgeState>, generation: String) {
    loop {
        let snapshot = {
            let login = state.login.lock().await;
            let Some(active) = login
                .as_ref()
                .filter(|active| active.generation == generation)
            else {
                return;
            };
            if now_ms().saturating_sub(active.started_at_ms) >= QR_TTL_MS {
                drop(login);
                set_login_result(
                    &state,
                    &generation,
                    "disconnected",
                    "二维码已过期，请刷新二维码",
                )
                .await;
                return;
            }
            if active.status == "need_verify" && active.pending_verify_code.is_none() {
                None
            } else {
                Some((
                    active.qrcode.clone(),
                    active.current_base_url.clone(),
                    active.pending_verify_code.clone(),
                ))
            }
        };
        let Some((qrcode, base_url, verify_code)) = snapshot else {
            tokio::time::sleep(Duration::from_millis(300)).await;
            continue;
        };

        let mut endpoint = format!("ilink/bot/get_qrcode_status?qrcode={}", url_encode(&qrcode));
        if let Some(code) = verify_code.as_deref() {
            endpoint.push_str("&verify_code=");
            endpoint.push_str(&url_encode(code));
        }
        let response = match provider_json(
            &state,
            Method::GET,
            &base_url,
            &endpoint,
            None,
            None,
            QR_POLL_TIMEOUT,
        )
        .await
        {
            Ok(value) => serde_json::from_value::<QrStatusResponse>(value).ok(),
            Err(_) => None,
        };
        let Some(response) = response else {
            tokio::time::sleep(Duration::from_secs(1)).await;
            continue;
        };

        match response.status.as_str() {
            "wait" => {
                set_login_result(&state, &generation, "waiting", "请使用手机微信扫码").await;
            }
            "scaned" => {
                let mut login = state.login.lock().await;
                if let Some(active) = login
                    .as_mut()
                    .filter(|active| active.generation == generation)
                {
                    active.pending_verify_code = None;
                    active.status = "awaiting_confirmation".to_string();
                    active.message = "请在手机微信中确认登录".to_string();
                }
            }
            "need_verifycode" => {
                let mut login = state.login.lock().await;
                if let Some(active) = login
                    .as_mut()
                    .filter(|active| active.generation == generation)
                {
                    let previous_code_rejected = active.pending_verify_code.take().is_some();
                    active.status = "need_verify".to_string();
                    active.message = if previous_code_rejected {
                        "数字验证码不匹配，请重新输入".to_string()
                    } else {
                        "请输入手机微信显示的数字验证码".to_string()
                    };
                }
            }
            "scaned_but_redirect" => {
                let mut login = state.login.lock().await;
                if let Some(active) = login
                    .as_mut()
                    .filter(|active| active.generation == generation)
                {
                    if let Some(host) = response
                        .redirect_host
                        .as_deref()
                        .filter(|host| is_safe_redirect_host(host))
                    {
                        active.current_base_url = format!("https://{host}");
                    }
                    active.status = "awaiting_confirmation".to_string();
                    active.message = "请在手机微信中确认登录".to_string();
                }
            }
            "confirmed" => {
                let Some(token) = response.bot_token.filter(|value| !value.trim().is_empty())
                else {
                    set_login_result(
                        &state,
                        &generation,
                        "error",
                        "Tencent iLink 未返回登录 token",
                    )
                    .await;
                    return;
                };
                let Some(account_id) = response
                    .ilink_bot_id
                    .filter(|value| !value.trim().is_empty())
                else {
                    set_login_result(&state, &generation, "error", "Tencent iLink 未返回账号 ID")
                        .await;
                    return;
                };
                let current_base_url = state
                    .login
                    .lock()
                    .await
                    .as_ref()
                    .filter(|active| active.generation == generation)
                    .map(|active| active.current_base_url.clone())
                    .unwrap_or_else(|| FIXED_ILINK_BASE_URL.to_string());
                let mut session = state.session.lock().await;
                if session.account_id.as_deref() != Some(account_id.as_str()) {
                    session.get_updates_buf.clear();
                    session.context_tokens.clear();
                }
                session.bot_token = Some(token);
                session.account_id = Some(account_id);
                session.user_id = response.ilink_user_id;
                session.base_url = response
                    .baseurl
                    .filter(|value| value.starts_with("https://"))
                    .or(Some(current_base_url));
                if let Err(error) = persist_session(&state.config.data_dir, &session) {
                    eprintln!("[wechat-bridge] failed to persist iLink login: {error}");
                    drop(session);
                    set_login_result(&state, &generation, "error", "微信登录凭据保存失败").await;
                    return;
                }
                drop(session);
                *state.runtime.lock().await = RuntimeState::default();
                set_login_result(&state, &generation, "logged_in", "微信已登录").await;
                return;
            }
            "binded_redirect" => {
                if state.session.lock().await.bot_token.is_some() {
                    set_login_result(&state, &generation, "logged_in", "微信已登录").await;
                } else {
                    set_login_result(
                        &state,
                        &generation,
                        "error",
                        "该微信已绑定，但本机登录凭据不存在，请解除旧绑定后重试",
                    )
                    .await;
                }
                return;
            }
            "expired" => {
                set_login_result(
                    &state,
                    &generation,
                    "disconnected",
                    "二维码已过期，请刷新二维码",
                )
                .await;
                return;
            }
            "verify_code_blocked" => {
                set_login_result(
                    &state,
                    &generation,
                    "error",
                    "数字验证码多次错误，请刷新二维码后重试",
                )
                .await;
                return;
            }
            _ => {
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
}

async fn set_login_result(state: &BridgeState, generation: &str, status: &str, message: &str) {
    let mut login = state.login.lock().await;
    if let Some(active) = login
        .as_mut()
        .filter(|active| active.generation == generation)
    {
        active.status = status.to_string();
        active.message = message.to_string();
    }
}

async fn monitor_updates(state: Arc<BridgeState>) {
    let mut active_token = String::new();
    let mut consecutive_failures = 0_u8;
    loop {
        let session = state.session.lock().await.clone();
        let Some(token) = session.bot_token.clone() else {
            active_token.clear();
            tokio::time::sleep(Duration::from_millis(500)).await;
            continue;
        };
        let base_url = session
            .base_url
            .clone()
            .unwrap_or_else(|| FIXED_ILINK_BASE_URL.to_string());
        if active_token != token {
            active_token = token.clone();
            let _ = provider_json(
                &state,
                Method::POST,
                &base_url,
                "ilink/bot/msg/notifystart",
                Some(&token),
                Some(json!({"base_info": base_info()})),
                API_TIMEOUT,
            )
            .await;
        }

        let response = provider_json(
            &state,
            Method::POST,
            &base_url,
            "ilink/bot/getupdates",
            Some(&token),
            Some(json!({
                "get_updates_buf": session.get_updates_buf,
                "base_info": base_info()
            })),
            UPDATES_TIMEOUT,
        )
        .await;
        let value = match response {
            Ok(value) => value,
            Err(error) => {
                if error.contains("timed out") {
                    continue;
                }
                consecutive_failures = consecutive_failures.saturating_add(1);
                if consecutive_failures >= 3 {
                    *state.runtime.lock().await = RuntimeState {
                        disconnected: true,
                        last_error: Some("Tencent iLink 暂时无法连接".to_string()),
                    };
                    consecutive_failures = 0;
                    tokio::time::sleep(Duration::from_secs(30)).await;
                } else {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                }
                continue;
            }
        };
        let updates: UpdatesResponse = match serde_json::from_value(value) {
            Ok(updates) => updates,
            Err(_) => {
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }
        };
        if updates.ret.unwrap_or(0) != 0 || updates.errcode.unwrap_or(0) != 0 {
            let stale = updates.ret == Some(-14) || updates.errcode == Some(-14);
            *state.runtime.lock().await = RuntimeState {
                disconnected: stale,
                last_error: Some(if stale {
                    "微信登录已失效，请重新扫码".to_string()
                } else {
                    "Tencent iLink 返回了暂时性错误".to_string()
                }),
            };
            let _ = updates.errmsg;
            tokio::time::sleep(Duration::from_secs(if stale { 60 } else { 2 })).await;
            continue;
        }

        consecutive_failures = 0;
        *state.runtime.lock().await = RuntimeState::default();
        let inbound = updates
            .msgs
            .unwrap_or_default()
            .into_iter()
            .filter_map(extract_inbound_message)
            .collect::<Vec<_>>();
        {
            let mut persisted = state.session.lock().await;
            if persisted.bot_token.as_deref() != Some(token.as_str()) {
                continue;
            }
            if let Some(cursor) = updates.get_updates_buf.filter(|value| !value.is_empty()) {
                persisted.get_updates_buf = cursor;
            }
            for (message, context_token) in &inbound {
                if let Some(context_token) = context_token.as_ref() {
                    persisted
                        .context_tokens
                        .insert(message.wxid.clone(), context_token.clone());
                }
            }
            if let Err(error) = persist_session(&state.config.data_dir, &persisted) {
                eprintln!("[wechat-bridge] failed to persist update cursor: {error}");
            }
        }
        for (message, _) in inbound {
            if let Err(error) = post_webhook(&state, &message).await {
                eprintln!("[wechat-bridge] failed to deliver inbound message: {error}");
            }
        }
    }
}

fn extract_inbound_message(message: IlinkMessage) -> Option<(WebhookMessage, Option<String>)> {
    if message
        .group_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return None;
    }
    if message.message_type.is_some_and(|value| value != 1)
        || message.message_state.is_some_and(|value| value != 2)
    {
        return None;
    }
    let wxid = message.from_user_id?.trim().to_string();
    if wxid.is_empty() {
        return None;
    }
    let text = message
        .item_list
        .unwrap_or_default()
        .into_iter()
        .filter(|item| item.item_type == 1)
        .filter_map(|item| item.text_item.and_then(|item| item.text))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    if text.is_empty() {
        return None;
    }
    let msg_id = message
        .message_id
        .map(|value| value.to_string())
        .or(message.client_id)
        .or_else(|| message.seq.map(|value| value.to_string()))?;
    Some((
        WebhookMessage {
            msg_id,
            wxid,
            text,
            is_group: false,
        },
        message
            .context_token
            .filter(|value| !value.trim().is_empty()),
    ))
}

async fn post_webhook(state: &BridgeState, message: &WebhookMessage) -> Result<(), String> {
    let response = state
        .client
        .post(&state.config.webhook_url)
        .header("x-wechat-webhook-token", &state.config.webhook_token)
        .json(message)
        .timeout(API_TIMEOUT)
        .send()
        .await
        .map_err(|_| "Doge webhook connection failed".to_string())?;
    if response.status().is_success() || response.status() == StatusCode::CONFLICT {
        Ok(())
    } else {
        Err(format!(
            "Doge webhook rejected HTTP {}",
            response.status().as_u16()
        ))
    }
}

fn authorize(headers: &HeaderMap, config: &BridgeConfig) -> Result<(), ApiError> {
    let header_key = headers
        .get("x-api-key")
        .and_then(|value| value.to_str().ok());
    let bearer_key = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    if header_key == Some(config.local_api_key.as_str())
        || bearer_key == Some(config.local_api_key.as_str())
    {
        Ok(())
    } else {
        Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({"ok": false, "error": "unauthorized"})),
        ))
    }
}

async fn provider_json(
    state: &BridgeState,
    method: Method,
    base_url: &str,
    endpoint: &str,
    token: Option<&str>,
    body: Option<Value>,
    timeout: Duration,
) -> Result<Value, String> {
    if !base_url.starts_with("https://") {
        return Err("Tencent iLink base URL is invalid".to_string());
    }
    let url = format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        endpoint.trim_start_matches('/')
    );
    let mut request = state
        .client
        .request(method, url)
        .headers(provider_headers(token)?)
        .timeout(timeout);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            "Tencent iLink request timed out".to_string()
        } else {
            "Tencent iLink connection failed".to_string()
        }
    })?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Tencent iLink request failed (HTTP {})",
            status.as_u16()
        ));
    }
    response
        .json::<Value>()
        .await
        .map_err(|_| "Tencent iLink returned invalid JSON".to_string())
}

fn provider_headers(token: Option<&str>) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert("content-type", HeaderValue::from_static("application/json"));
    headers.insert(
        "authorizationtype",
        HeaderValue::from_static("ilink_bot_token"),
    );
    headers.insert("ilink-app-id", HeaderValue::from_static(ILINK_APP_ID));
    headers.insert(
        "ilink-app-clientversion",
        HeaderValue::from_static(ILINK_APP_CLIENT_VERSION),
    );
    let random = Uuid::new_v4();
    let bytes = random.as_bytes();
    let uin = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]).to_string();
    let encoded = BASE64.encode(uin.as_bytes());
    headers.insert(
        "x-wechat-uin",
        HeaderValue::from_str(&encoded)
            .map_err(|_| "failed to build iLink request headers".to_string())?,
    );
    if let Some(token) = token.filter(|value| !value.trim().is_empty()) {
        headers.insert(
            "authorization",
            HeaderValue::from_str(&format!("Bearer {}", token.trim()))
                .map_err(|_| "invalid iLink login token".to_string())?,
        );
    }
    Ok(headers)
}

fn base_info() -> Value {
    json!({
        "channel_version": PROVIDER_VERSION,
        "bot_agent": "Doge/0.1.14"
    })
}

fn build_send_message_payload(
    to: &str,
    content: &str,
    client_id: &str,
    context_token: Option<&str>,
) -> Value {
    json!({
        "msg": {
            "from_user_id": "",
            "to_user_id": to,
            "client_id": client_id,
            "message_type": 2,
            "message_state": 2,
            "item_list": [{
                "type": 1,
                "text_item": { "text": content }
            }],
            "context_token": context_token
        },
        "base_info": base_info()
    })
}

fn ensure_provider_success(value: &Value) -> Result<(), String> {
    let ret = value.get("ret").and_then(Value::as_i64).unwrap_or(0);
    if ret == 0 {
        Ok(())
    } else {
        Err(format!("Tencent iLink send failed (ret={ret})"))
    }
}

fn is_safe_redirect_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && host
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'.' || value == b'-')
        && (host.ends_with(".weixin.qq.com") || host == "ilinkai.weixin.qq.com")
}

fn url_encode(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char]
            }
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn session_path(data_dir: &Path) -> PathBuf {
    data_dir.join("ilink-session.json")
}

fn load_session(data_dir: &Path) -> Result<SessionState, String> {
    match std::fs::read(session_path(data_dir)) {
        Ok(bytes) => serde_json::from_slice(&bytes)
            .map_err(|error| format!("failed to parse iLink provider session: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(SessionState::default()),
        Err(error) => Err(format!("failed to read iLink provider session: {error}")),
    }
}

fn persist_session(data_dir: &Path, session: &SessionState) -> Result<(), String> {
    let path = session_path(data_dir);
    let temporary = data_dir.join(format!("ilink-session.json.tmp-{}", std::process::id()));
    let bytes = serde_json::to_vec(session)
        .map_err(|error| format!("failed to encode iLink provider session: {error}"))?;
    std::fs::write(&temporary, bytes)
        .map_err(|error| format!("failed to write iLink provider session: {error}"))?;
    set_private_permissions(&temporary)?;
    replace_file(&temporary, &path)
        .map_err(|error| format!("failed to commit iLink provider session: {error}"))
}

#[cfg(unix)]
fn set_private_permissions(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("failed to protect iLink provider session: {error}"))
}

#[cfg(not(unix))]
fn set_private_permissions(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(source, destination)
}

#[cfg(target_os = "windows")]
fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

type ApiError = (StatusCode, Json<Value>);

fn provider_error(message: String) -> ApiError {
    let status = if message.contains("not logged in") {
        StatusCode::CONFLICT
    } else if message.contains("valid login QR") || message.contains("base URL") {
        StatusCode::BAD_GATEWAY
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (status, Json(json!({"ok": false, "error": message})))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn official_provider_headers_do_not_require_deployment_credentials() {
        let headers = provider_headers(None).expect("headers");
        assert_eq!(headers.get("iLink-App-Id").unwrap(), "bot");
        assert_eq!(headers.get("iLink-App-ClientVersion").unwrap(), "132102");
        assert_eq!(headers.get("AuthorizationType").unwrap(), "ilink_bot_token");
        assert!(headers.get("Authorization").is_none());
        let uin = BASE64
            .decode(headers.get("X-WECHAT-UIN").unwrap().as_bytes())
            .expect("base64 uin");
        assert!(String::from_utf8(uin).unwrap().parse::<u32>().is_ok());
    }

    #[test]
    fn authenticated_provider_headers_do_not_leak_into_payload() {
        let headers = provider_headers(Some("secret-token")).expect("headers");
        assert_eq!(headers.get("Authorization").unwrap(), "Bearer secret-token");
        assert!(!base_info().to_string().contains("secret-token"));
    }

    #[test]
    fn text_send_payload_matches_tencent_ilink_contract() {
        let payload = build_send_message_payload("wx-user", "hello", "doge:1", Some("context"));
        assert_eq!(payload.pointer("/msg/to_user_id"), Some(&json!("wx-user")));
        assert_eq!(payload.pointer("/msg/message_type"), Some(&json!(2)));
        assert_eq!(payload.pointer("/msg/message_state"), Some(&json!(2)));
        assert_eq!(payload.pointer("/msg/item_list/0/type"), Some(&json!(1)));
        assert_eq!(
            payload.pointer("/msg/item_list/0/text_item/text"),
            Some(&json!("hello"))
        );
        assert_eq!(
            payload.pointer("/msg/context_token"),
            Some(&json!("context"))
        );
        assert_eq!(
            payload.pointer("/base_info/channel_version"),
            Some(&json!("2.4.6"))
        );
    }

    #[test]
    fn inbound_parser_accepts_finished_direct_text_and_rejects_groups() {
        let direct = IlinkMessage {
            seq: Some(7),
            message_id: Some(42),
            client_id: None,
            from_user_id: Some("wx-user".to_string()),
            group_id: None,
            message_type: Some(1),
            message_state: Some(2),
            item_list: Some(vec![MessageItem {
                item_type: 1,
                text_item: Some(TextItem {
                    text: Some("hello".to_string()),
                }),
            }]),
            context_token: Some("ctx".to_string()),
        };
        let (message, context) = extract_inbound_message(direct).expect("direct message");
        assert_eq!(message.msg_id, "42");
        assert_eq!(message.wxid, "wx-user");
        assert_eq!(message.text, "hello");
        assert_eq!(context.as_deref(), Some("ctx"));

        let group = IlinkMessage {
            seq: None,
            message_id: Some(43),
            client_id: None,
            from_user_id: Some("wx-user".to_string()),
            group_id: Some("group".to_string()),
            message_type: Some(1),
            message_state: Some(2),
            item_list: None,
            context_token: None,
        };
        assert!(extract_inbound_message(group).is_none());
    }

    #[test]
    fn redirect_hosts_are_restricted_to_tencent_weixin() {
        assert!(is_safe_redirect_host("ilinkai.weixin.qq.com"));
        assert!(is_safe_redirect_host("sh.ilink.weixin.qq.com"));
        assert!(!is_safe_redirect_host("evil.example"));
        assert!(!is_safe_redirect_host("weixin.qq.com.evil.example"));
    }

    #[test]
    fn session_round_trip_preserves_credentials_cursor_and_context() {
        let root =
            std::env::temp_dir().join(format!("doge-weixin-provider-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create temp directory");
        let mut session = SessionState {
            bot_token: Some("token".to_string()),
            account_id: Some("bot@im.bot".to_string()),
            get_updates_buf: "cursor".to_string(),
            ..SessionState::default()
        };
        session
            .context_tokens
            .insert("user".to_string(), "context".to_string());
        persist_session(&root, &session).expect("persist session");
        assert_eq!(load_session(&root).expect("load session"), session);
        std::fs::remove_dir_all(root).expect("remove temp directory");
    }
}
