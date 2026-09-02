// Tencent Weixin iLink protocol adapter based on the MIT-licensed
// @tencent-weixin/openclaw-weixin 2.4.6 package. See the bundled license notice.

use std::collections::HashMap;
use std::env;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use aes::cipher::{generic_array::GenericArray, BlockDecrypt, BlockEncrypt, KeyInit};
use aes::Aes128;
use axum::extract::State;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use md5::{Digest, Md5};
use reqwest::redirect::Policy;
use reqwest::{Client, Method, Url};
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
const FIXED_ILINK_CDN_BASE_URL: &str = "https://novac2c.cdn.weixin.qq.com/c2c";
const ILINK_APP_ID: &str = "bot";
const ILINK_APP_CLIENT_VERSION: &str = "132102";
const ILINK_BOT_TYPE: &str = "3";
const QR_TTL_MS: u64 = 5 * 60_000;
const QR_POLL_TIMEOUT: Duration = Duration::from_secs(35);
const API_TIMEOUT: Duration = Duration::from_secs(15);
const UPDATES_TIMEOUT: Duration = Duration::from_secs(40);
const MAX_INLINE_MEDIA_BYTES: usize = 8 * 1024 * 1024;
const MAX_OUTBOUND_MEDIA_BYTES: u64 = 8 * 1024 * 1024;
const MAX_INBOUND_MEDIA_BYTES: usize = 100 * 1024 * 1024;
const MAX_INBOUND_CIPHERTEXT_BYTES: usize = MAX_INBOUND_MEDIA_BYTES + 16;
const INBOUND_MEDIA_DIR: &str = "inbound";
const UPLOAD_MAX_RETRIES: usize = 3;

#[derive(Clone)]
struct BridgeState {
    config: BridgeConfig,
    client: Client,
    cdn_client: Client,
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
    #[serde(default)]
    media: Option<OutboundMediaRequest>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutboundMediaRequest {
    path: String,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    file_name: Option<String>,
    #[serde(default)]
    mime_type: Option<String>,
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
    image_item: Option<Value>,
    voice_item: Option<Value>,
    video_item: Option<Value>,
    file_item: Option<Value>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    message_type: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    images: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    attachments: Vec<MediaAttachment>,
    is_group: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaAttachment {
    kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip)]
    source: Option<InboundMediaSource>,
}

#[derive(Debug, Clone)]
struct InboundMediaSource {
    encrypt_query_param: Option<String>,
    full_url: Option<String>,
    aes_key: Result<Option<[u8; 16]>, String>,
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
    let cdn_client = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .redirect(Policy::none())
        .build()
        .unwrap_or_else(|error| {
            exit_configuration_error(&format!("CDN HTTP client error: {error}"))
        });
    let state = Arc::new(BridgeState {
        config,
        client,
        cdn_client,
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
    if to.is_empty() || (content.is_empty() && request.media.is_none()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"ok": false, "error": "message target and content or media are required"})),
        ));
    }

    let session = state.session.lock().await.clone();
    let token = session
        .bot_token
        .as_deref()
        .ok_or_else(|| provider_error("WeChat is not logged in".to_string()))?;
    let base_url = session.base_url.as_deref().unwrap_or(FIXED_ILINK_BASE_URL);
    let context_token = session.context_tokens.get(to).map(String::as_str);
    let mut message_id = None;
    if !content.is_empty() {
        let client_id = new_client_id();
        send_provider_message(
            &state,
            base_url,
            token,
            build_send_message_payload(to, content, &client_id, context_token),
        )
        .await
        .map_err(provider_error)?;
        message_id = Some(client_id);
    }

    if let Some(media) = request.media {
        let client_id = new_client_id();
        let item = upload_media_and_build_item(&state, base_url, token, to, &media)
            .await
            .map_err(provider_error)?;
        send_provider_message(
            &state,
            base_url,
            token,
            build_send_message_item_payload(to, item, &client_id, context_token),
        )
        .await
        .map_err(provider_error)?;
        message_id = Some(client_id);
    }

    Ok(Json(
        json!({"ok": true, "messageId": message_id.unwrap_or_else(new_client_id)}),
    ))
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
        let mut inbound = Vec::new();
        for message in updates.msgs.unwrap_or_default() {
            if let Some((mut message, context_token)) = extract_inbound_message(message) {
                materialize_inbound_attachments(&state, &mut message).await;
                inbound.push((message, context_token));
            }
        }
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
    let mut text_parts = Vec::new();
    let mut images = Vec::new();
    let mut attachments = Vec::new();
    let mut kinds = Vec::new();
    for item in message.item_list.unwrap_or_default() {
        if item.item_type == 1 {
            if let Some(text) = item.text_item.and_then(|item| item.text) {
                if !text.trim().is_empty() {
                    text_parts.push(text);
                }
            }
            continue;
        }
        let (kind, value) = match item.item_type {
            2 => ("image", item.image_item),
            3 => ("voice", item.voice_item),
            4 => ("file", item.file_item),
            5 => ("video", item.video_item),
            _ => continue,
        };
        if let Some(value) = value {
            if let Some(attachment) = extract_media_attachment(kind, &value) {
                if let Some(data_url) = attachment.data_url.as_deref() {
                    if kind == "image" && validate_inline_media_data_url(data_url) {
                        images.push(data_url.to_string());
                    }
                }
                if kind == "voice" {
                    if let Some(transcript) = first_string_field(&value, &["text", "transcript"]) {
                        text_parts.push(transcript);
                    }
                }
                kinds.push(kind.to_string());
                attachments.push(attachment);
            }
        }
    }
    let text = text_parts.join("\n").trim().to_string();
    if text.is_empty() && kinds.is_empty() {
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
            message_type: if kinds.is_empty() {
                Some("text".to_string())
            } else {
                Some(kinds.join(","))
            },
            images,
            attachments,
            is_group: false,
        },
        message
            .context_token
            .filter(|value| !value.trim().is_empty()),
    ))
}

fn extract_media_attachment(kind: &str, value: &Value) -> Option<MediaAttachment> {
    let mime_type = first_string_field(
        value,
        &["mimeType", "mime_type", "contentType", "content_type"],
    )
    .or_else(|| (kind == "image").then(|| "image/jpeg".to_string()));
    let mut data_url = first_string_field(value, &["dataUrl", "data_url"]);
    let url = first_string_field(
        value,
        &[
            "url",
            "downloadUrl",
            "download_url",
            "mediaUrl",
            "media_url",
            "cdnUrl",
            "cdn_url",
            "fullUrl",
            "full_url",
        ],
    );
    if data_url.is_none() {
        if let Some(data) = first_string_field(value, &["data", "base64"]) {
            if data.starts_with("data:") {
                data_url = Some(data);
            } else if kind == "image" && data.len() <= MAX_INLINE_MEDIA_BYTES * 2 {
                data_url = Some(format!(
                    "data:{};base64,{}",
                    mime_type.as_deref().unwrap_or("image/jpeg"),
                    data
                ));
            }
        }
    }
    let data_url = data_url.filter(|value| validate_inline_media_data_url(value));
    let file_name = first_string_field(value, &["fileName", "file_name", "name"]);
    let size = first_u64_field(value, &["fileSize", "file_size", "size"]);
    let source = extract_inbound_media_source(kind, value);
    if data_url.is_none() && url.is_none() && file_name.is_none() && size.is_none() {
        return Some(MediaAttachment {
            kind: kind.to_string(),
            mime_type,
            file_name: None,
            data_url: None,
            url: None,
            size: None,
            path: None,
            source,
        });
    }
    Some(MediaAttachment {
        kind: kind.to_string(),
        mime_type,
        file_name,
        data_url,
        url: url.filter(|value| value.starts_with("https://")),
        size,
        path: None,
        source,
    })
}

fn extract_inbound_media_source(kind: &str, value: &Value) -> Option<InboundMediaSource> {
    let media = value.get("media")?.as_object()?;
    let encrypt_query_param = media
        .get("encrypt_query_param")
        .or_else(|| media.get("encryptQueryParam"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let full_url = media
        .get("full_url")
        .or_else(|| media.get("fullUrl"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    if encrypt_query_param.is_none() && full_url.is_none() {
        return None;
    }
    let aes_key = if kind == "image" {
        value
            .get("aeskey")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| parse_hex_aes_key(value).map(Some))
            .unwrap_or_else(|| parse_optional_inbound_aes_key(media))
    } else {
        parse_optional_inbound_aes_key(media)
    };
    Some(InboundMediaSource {
        encrypt_query_param,
        full_url,
        aes_key,
    })
}

fn parse_optional_inbound_aes_key(
    media: &serde_json::Map<String, Value>,
) -> Result<Option<[u8; 16]>, String> {
    media
        .get("aes_key")
        .or_else(|| media.get("aesKey"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(parse_inbound_aes_key)
        .transpose()
}

fn parse_inbound_aes_key(value: &str) -> Result<[u8; 16], String> {
    let decoded = BASE64
        .decode(value.as_bytes())
        .map_err(|_| "inbound media AES key is not valid Base64".to_string())?;
    if decoded.len() == 16 {
        return decoded
            .try_into()
            .map_err(|_| "inbound media AES key must be 16 bytes".to_string());
    }
    if decoded.len() == 32 {
        let encoded = std::str::from_utf8(&decoded)
            .map_err(|_| "inbound media AES hex key is not ASCII".to_string())?;
        return parse_hex_aes_key(encoded);
    }
    Err("inbound media AES key must decode to 16 raw bytes or 32 hex characters".to_string())
}

fn parse_hex_aes_key(value: &str) -> Result<[u8; 16], String> {
    if value.len() != 32 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("inbound media AES hex key must contain 32 characters".to_string());
    }
    let mut key = [0_u8; 16];
    for (index, byte) in key.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
            .map_err(|_| "inbound media AES hex key is invalid".to_string())?;
    }
    Ok(key)
}

fn first_string_field(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    for key in keys {
        if let Some(value) = object.get(*key).and_then(Value::as_str) {
            let value = value.trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    object
        .values()
        .find_map(|value| first_string_field(value, keys))
}

fn first_u64_field(value: &Value, keys: &[&str]) -> Option<u64> {
    let object = value.as_object()?;
    for key in keys {
        if let Some(value) = object.get(*key) {
            if let Some(value) = value.as_u64() {
                return Some(value);
            }
            if let Some(value) = value.as_str() {
                if let Ok(value) = value.trim().parse() {
                    return Some(value);
                }
            }
        }
    }
    object
        .values()
        .find_map(|value| first_u64_field(value, keys))
}

fn validate_inline_media_data_url(value: &str) -> bool {
    let Some((metadata, payload)) = value.split_once(',') else {
        return false;
    };
    metadata.starts_with("data:image/")
        && metadata.contains(";base64")
        && !payload.is_empty()
        && payload.len() <= (MAX_INLINE_MEDIA_BYTES * 4 / 3) + 4
        && BASE64
            .decode(payload.as_bytes())
            .is_ok_and(|bytes| !bytes.is_empty() && bytes.len() <= MAX_INLINE_MEDIA_BYTES)
}

async fn materialize_inbound_attachments(state: &BridgeState, message: &mut WebhookMessage) {
    for attachment in &mut message.attachments {
        let Some(source) = attachment.source.take() else {
            continue;
        };
        let result = async {
            let plaintext = download_inbound_media(state, &attachment.kind, &source).await?;
            let file_name = attachment
                .file_name
                .as_deref()
                .unwrap_or_else(|| default_inbound_file_name(&attachment.kind));
            let path = save_inbound_media(
                &state.config.data_dir,
                &message.msg_id,
                file_name,
                &plaintext,
            )
            .await?;
            attachment.size = Some(plaintext.len() as u64);
            attachment.file_name = path
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| {
                    value
                        .split_once('-')
                        .map(|(_, name)| name)
                        .unwrap_or(value)
                        .to_string()
                });
            if attachment.mime_type.is_none() {
                attachment.mime_type = Some(inbound_mime_type(&attachment.kind, &path));
            }
            attachment.path = Some(path.to_string_lossy().into_owned());
            attachment.url = None;
            Ok::<(), String>(())
        }
        .await;
        if let Err(error) = result {
            eprintln!(
                "[wechat-bridge] inbound {} attachment unavailable: {error}",
                attachment.kind
            );
        }
    }
}

async fn download_inbound_media(
    state: &BridgeState,
    kind: &str,
    source: &InboundMediaSource,
) -> Result<Vec<u8>, String> {
    let url = inbound_download_url(source)?;
    let mut response = state
        .cdn_client
        .get(url)
        .timeout(API_TIMEOUT)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "inbound media CDN download timed out".to_string()
            } else {
                "inbound media CDN connection failed".to_string()
            }
        })?;
    if !response.status().is_success() {
        return Err(format!(
            "inbound media CDN download failed (HTTP {})",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_INBOUND_CIPHERTEXT_BYTES as u64)
    {
        return Err(format!(
            "inbound media download exceeds {MAX_INBOUND_MEDIA_BYTES} bytes"
        ));
    }
    let mut downloaded = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "inbound media CDN body read failed".to_string())?
    {
        let next_size = checked_inbound_download_size(downloaded.len(), chunk.len())?;
        downloaded.reserve(next_size.saturating_sub(downloaded.len()));
        downloaded.extend_from_slice(&chunk);
    }
    if downloaded.is_empty() {
        return Err("inbound media CDN returned an empty body".to_string());
    }
    let key = source.aes_key.clone()?;
    let plaintext = match key {
        Some(key) => decrypt_aes_128_ecb(&downloaded, &key)?,
        None if kind == "image" => downloaded,
        None => return Err("inbound media AES key is missing".to_string()),
    };
    if plaintext.is_empty() || plaintext.len() > MAX_INBOUND_MEDIA_BYTES {
        return Err(format!(
            "inbound media plaintext exceeds {MAX_INBOUND_MEDIA_BYTES} bytes"
        ));
    }
    Ok(plaintext)
}

fn inbound_download_url(source: &InboundMediaSource) -> Result<Url, String> {
    let url = if let Some(full_url) = source.full_url.as_deref() {
        if full_url.len() > 32 * 1024 {
            return Err("inbound media full_url is too long".to_string());
        }
        Url::parse(full_url).map_err(|_| "inbound media full_url is invalid".to_string())?
    } else {
        let parameter = source
            .encrypt_query_param
            .as_deref()
            .filter(|value| !value.is_empty() && value.len() <= 16 * 1024)
            .ok_or_else(|| "inbound media encrypt_query_param is invalid".to_string())?;
        Url::parse(&format!(
            "{FIXED_ILINK_CDN_BASE_URL}/download?encrypted_query_param={}",
            url_encode(parameter)
        ))
        .map_err(|_| "failed to construct inbound media CDN URL".to_string())?
    };
    let host = url
        .host_str()
        .ok_or_else(|| "inbound media CDN URL host is missing".to_string())?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port_or_known_default() != Some(443)
        || !is_safe_redirect_host(host)
    {
        return Err("inbound media CDN URL is not an allowed Tencent HTTPS host".to_string());
    }
    Ok(url)
}

fn checked_inbound_download_size(current: usize, chunk: usize) -> Result<usize, String> {
    let next = current
        .checked_add(chunk)
        .ok_or_else(|| "inbound media download size overflow".to_string())?;
    if next > MAX_INBOUND_CIPHERTEXT_BYTES {
        return Err(format!(
            "inbound media download exceeds {MAX_INBOUND_MEDIA_BYTES} bytes"
        ));
    }
    Ok(next)
}

fn decrypt_aes_128_ecb(ciphertext: &[u8], key: &[u8; 16]) -> Result<Vec<u8>, String> {
    if ciphertext.is_empty() || ciphertext.len() % 16 != 0 {
        return Err("inbound media ciphertext is not AES block aligned".to_string());
    }
    let cipher =
        Aes128::new_from_slice(key).map_err(|_| "invalid AES-128 inbound media key".to_string())?;
    let mut plaintext = Vec::with_capacity(ciphertext.len());
    for chunk in ciphertext.chunks_exact(16) {
        let mut block = GenericArray::clone_from_slice(chunk);
        cipher.decrypt_block(&mut block);
        plaintext.extend_from_slice(&block);
    }
    let padding = *plaintext
        .last()
        .ok_or_else(|| "inbound media plaintext is empty".to_string())? as usize;
    if padding == 0
        || padding > 16
        || padding > plaintext.len()
        || !plaintext[plaintext.len() - padding..]
            .iter()
            .all(|byte| *byte as usize == padding)
    {
        return Err("inbound media PKCS#7 padding is invalid".to_string());
    }
    plaintext.truncate(plaintext.len() - padding);
    Ok(plaintext)
}

async fn save_inbound_media(
    data_dir: &Path,
    message_id: &str,
    original_file_name: &str,
    plaintext: &[u8],
) -> Result<PathBuf, String> {
    if plaintext.is_empty() || plaintext.len() > MAX_INBOUND_MEDIA_BYTES {
        return Err("inbound media file size is invalid".to_string());
    }
    let root = data_dir.join(INBOUND_MEDIA_DIR);
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|_| "failed to create inbound media directory".to_string())?;
    let canonical_data_dir = tokio::fs::canonicalize(data_dir)
        .await
        .map_err(|_| "failed to canonicalize WeChat provider data directory".to_string())?;
    let canonical_root = tokio::fs::canonicalize(&root)
        .await
        .map_err(|_| "failed to canonicalize inbound media directory".to_string())?;
    if !canonical_root.starts_with(&canonical_data_dir) {
        return Err("inbound media directory escapes provider data storage".to_string());
    }
    let message_dir = canonical_root.join(sanitize_path_component(message_id, "message"));
    tokio::fs::create_dir_all(&message_dir)
        .await
        .map_err(|_| "failed to create inbound message directory".to_string())?;
    let canonical_message_dir = tokio::fs::canonicalize(&message_dir)
        .await
        .map_err(|_| "failed to canonicalize inbound message directory".to_string())?;
    if !canonical_message_dir.starts_with(&canonical_root) {
        return Err("inbound message directory escapes managed storage".to_string());
    }
    let safe_name = sanitize_path_component(original_file_name, "attachment.bin");
    let unique = Uuid::new_v4().simple().to_string();
    let final_path = canonical_message_dir.join(format!("{unique}-{safe_name}"));
    let temporary = canonical_message_dir.join(format!(".{unique}.part"));
    tokio::fs::write(&temporary, plaintext)
        .await
        .map_err(|_| "failed to write inbound media file".to_string())?;
    if let Err(error) = tokio::fs::rename(&temporary, &final_path).await {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(format!("failed to finalize inbound media file: {error}"));
    }
    if let Err(error) = set_private_permissions(&final_path) {
        let _ = tokio::fs::remove_file(&final_path).await;
        return Err(error);
    }
    let canonical = tokio::fs::canonicalize(&final_path)
        .await
        .map_err(|_| "failed to canonicalize inbound media file".to_string())?;
    let metadata = tokio::fs::metadata(&canonical)
        .await
        .map_err(|_| "failed to inspect inbound media file".to_string())?;
    if !canonical.starts_with(&canonical_root)
        || !metadata.is_file()
        || metadata.len() != plaintext.len() as u64
    {
        let _ = tokio::fs::remove_file(&canonical).await;
        return Err("inbound media file failed managed storage validation".to_string());
    }
    Ok(canonical)
}

fn sanitize_path_component(value: &str, fallback: &str) -> String {
    let base_name = value
        .rsplit(|character| character == '/' || character == '\\')
        .next()
        .unwrap_or_default();
    let mut sanitized = base_name
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
                )
            {
                '_'
            } else {
                character
            }
        })
        .take(120)
        .collect::<String>();
    sanitized = sanitized.trim_matches([' ', '.']).to_string();
    if sanitized.is_empty() {
        fallback.to_string()
    } else {
        sanitized
    }
}

fn default_inbound_file_name(kind: &str) -> &'static str {
    match kind {
        "image" => "image.jpg",
        "voice" => "voice.silk",
        "video" => "video.mp4",
        _ => "attachment.bin",
    }
}

fn inbound_mime_type(kind: &str, path: &Path) -> String {
    match kind {
        "image" => "image/jpeg",
        "voice" => "audio/silk",
        "video" => "video/mp4",
        _ => match path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "pdf" => "application/pdf",
            "txt" | "md" => "text/plain",
            "json" => "application/json",
            "doc" => "application/msword",
            "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "xls" => "application/vnd.ms-excel",
            "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "ppt" => "application/vnd.ms-powerpoint",
            "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "zip" => "application/zip",
            _ => "application/octet-stream",
        },
    }
    .to_string()
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

fn new_client_id() -> String {
    format!(
        "doge-weixin:{}-{}",
        now_ms(),
        &Uuid::new_v4().simple().to_string()[..8]
    )
}

async fn send_provider_message(
    state: &BridgeState,
    base_url: &str,
    token: &str,
    payload: Value,
) -> Result<(), String> {
    let response = provider_json(
        state,
        Method::POST,
        base_url,
        "ilink/bot/sendmessage",
        Some(token),
        Some(payload),
        API_TIMEOUT,
    )
    .await?;
    ensure_provider_success(&response)
}

fn build_send_message_payload(
    to: &str,
    content: &str,
    client_id: &str,
    context_token: Option<&str>,
) -> Value {
    build_send_message_item_payload(
        to,
        json!({
            "type": 1,
            "text_item": { "text": content }
        }),
        client_id,
        context_token,
    )
}

fn build_send_message_item_payload(
    to: &str,
    item: Value,
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
            "item_list": [item],
            "context_token": context_token
        },
        "base_info": base_info()
    })
}

#[derive(Debug)]
struct UploadedMedia {
    media_type: i64,
    download_param: String,
    aes_key_hex: String,
    raw_size: u64,
    encrypted_size: usize,
}

async fn upload_media_and_build_item(
    state: &BridgeState,
    base_url: &str,
    token: &str,
    to: &str,
    media: &OutboundMediaRequest,
) -> Result<Value, String> {
    let path = media.path.trim();
    if path.is_empty() {
        return Err("outbound media path is required".to_string());
    }
    let path = Path::new(path);
    if !path.is_absolute() {
        return Err("outbound media path must be absolute".to_string());
    }
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|error| format!("failed to read outbound media metadata: {error}"))?;
    if !metadata.is_file() {
        return Err("outbound media path is not a regular file".to_string());
    }
    if metadata.len() == 0 {
        return Err("outbound media file is empty".to_string());
    }
    if metadata.len() > MAX_OUTBOUND_MEDIA_BYTES {
        return Err(format!(
            "outbound media exceeds {MAX_OUTBOUND_MEDIA_BYTES} bytes"
        ));
    }
    let plaintext = tokio::fs::read(path)
        .await
        .map_err(|error| format!("failed to read outbound media file: {error}"))?;
    let kind = outbound_media_kind(media, path)?;
    let aes_key = *Uuid::new_v4().as_bytes();
    let encrypted = encrypt_aes_128_ecb(&plaintext, &aes_key)?;
    let mut md5 = Md5::new();
    md5.update(&plaintext);
    let rawfilemd5 = format!("{:x}", md5.finalize());
    let filekey = Uuid::new_v4().simple().to_string();
    let aes_key_hex = aes_key
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let upload_response = provider_json(
        state,
        Method::POST,
        base_url,
        "ilink/bot/getuploadurl",
        Some(token),
        Some(json!({
            "filekey": filekey,
            "media_type": kind.media_type,
            "to_user_id": to,
            "rawsize": plaintext.len(),
            "rawfilemd5": rawfilemd5,
            "filesize": encrypted.len(),
            "no_need_thumb": true,
            "aeskey": aes_key_hex.clone(),
            "base_info": base_info()
        })),
        API_TIMEOUT,
    )
    .await?;
    ensure_provider_success(&upload_response)?;
    let upload_url = upload_response
        .get("upload_full_url")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            upload_response
                .get("upload_param")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|param| {
                    format!(
                        "{FIXED_ILINK_CDN_BASE_URL}/upload?encrypted_query_param={}&filekey={}",
                        url_encode(param),
                        url_encode(&filekey)
                    )
                })
        })
        .ok_or_else(|| "Tencent iLink upload URL is missing".to_string())?;
    let download_param = upload_encrypted_media(state, &upload_url, &encrypted).await?;
    let uploaded = UploadedMedia {
        media_type: kind.media_type,
        download_param,
        aes_key_hex,
        raw_size: plaintext.len() as u64,
        encrypted_size: encrypted.len(),
    };
    Ok(build_media_item(&uploaded, media, path))
}

#[derive(Debug, Clone, Copy)]
struct OutboundMediaKind {
    media_type: i64,
}

fn outbound_media_kind(
    media: &OutboundMediaRequest,
    path: &Path,
) -> Result<OutboundMediaKind, String> {
    let kind = media
        .kind
        .as_deref()
        .or(media.mime_type.as_deref())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let kind = if kind.starts_with("image/") || kind == "image" {
        Some(OutboundMediaKind { media_type: 1 })
    } else if kind.starts_with("video/") || kind == "video" {
        Some(OutboundMediaKind { media_type: 2 })
    } else if kind == "file" {
        Some(OutboundMediaKind { media_type: 3 })
    } else if path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "webp"
            )
        })
    {
        Some(OutboundMediaKind { media_type: 1 })
    } else {
        None
    };
    kind.ok_or_else(|| {
        "unsupported outbound media type; expected image, video, or file".to_string()
    })
}

async fn upload_encrypted_media(
    state: &BridgeState,
    upload_url: &str,
    encrypted: &[u8],
) -> Result<String, String> {
    let mut last_error = None;
    for attempt in 1..=UPLOAD_MAX_RETRIES {
        let response = state
            .client
            .post(upload_url)
            .header("content-type", "application/octet-stream")
            .timeout(API_TIMEOUT)
            .body(encrypted.to_vec())
            .send()
            .await;
        match response {
            Ok(response) if response.status().is_success() => {
                if let Some(value) = response
                    .headers()
                    .get("x-encrypted-param")
                    .and_then(|value| value.to_str().ok())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    return Ok(value.to_string());
                }
                last_error = Some("CDN upload response missing x-encrypted-param".to_string());
            }
            Ok(response) => {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                last_error = Some(format!("CDN upload failed (HTTP {status}): {body}"));
                if status.is_client_error() {
                    break;
                }
            }
            Err(error) => {
                last_error = Some(if error.is_timeout() {
                    "CDN upload timed out".to_string()
                } else {
                    format!("CDN upload connection failed: {error}")
                });
            }
        }
        if attempt < UPLOAD_MAX_RETRIES {
            tokio::time::sleep(Duration::from_millis(100 * attempt as u64)).await;
        }
    }
    Err(last_error.unwrap_or_else(|| "CDN upload failed".to_string()))
}

fn build_media_item(uploaded: &UploadedMedia, media: &OutboundMediaRequest, path: &Path) -> Value {
    let media_ref = json!({
        "encrypt_query_param": uploaded.download_param,
        "aes_key": BASE64.encode(uploaded.aes_key_hex.as_bytes()),
        "encrypt_type": 1
    });
    match uploaded.media_type {
        1 => json!({
            "type": 2,
            "image_item": {
                "media": media_ref,
                "mid_size": uploaded.encrypted_size
            }
        }),
        2 => json!({
            "type": 5,
            "video_item": {
                "media": media_ref,
                "video_size": uploaded.encrypted_size
            }
        }),
        _ => json!({
            "type": 4,
            "file_item": {
                "media": media_ref,
                "file_name": media.file_name.as_deref().or_else(|| path.file_name().and_then(|value| value.to_str())),
                "len": uploaded.raw_size.to_string()
            }
        }),
    }
}

fn encrypt_aes_128_ecb(plaintext: &[u8], key: &[u8; 16]) -> Result<Vec<u8>, String> {
    let cipher = Aes128::new_from_slice(key)
        .map_err(|_| "invalid AES-128 outbound media key".to_string())?;
    let padding = 16 - (plaintext.len() % 16);
    let mut padded = Vec::with_capacity(plaintext.len() + padding);
    padded.extend_from_slice(plaintext);
    padded.extend(std::iter::repeat_n(padding as u8, padding));
    let mut encrypted = Vec::with_capacity(padded.len());
    for chunk in padded.chunks_exact(16) {
        let mut block = GenericArray::clone_from_slice(chunk);
        cipher.encrypt_block(&mut block);
        encrypted.extend_from_slice(&block);
    }
    Ok(encrypted)
}

fn ensure_provider_success(value: &Value) -> Result<(), String> {
    let ret = value.get("ret").and_then(Value::as_i64).unwrap_or(0);
    if ret == 0 {
        Ok(())
    } else {
        let message = value
            .get("errmsg")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|message| !message.is_empty())
            .unwrap_or("unknown provider error");
        Err(format!(
            "Tencent iLink request failed (ret={ret}, errmsg={message})"
        ))
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
    fn encrypts_aes_ecb_with_pkcs7_padding() {
        let key = [0x11_u8; 16];
        for (plaintext, expected_len) in [
            (b"".as_slice(), 16),
            (b"1234567890abcdef".as_slice(), 32),
            (b"1234567890abcdefx".as_slice(), 32),
        ] {
            let encrypted = encrypt_aes_128_ecb(plaintext, &key).expect("encrypted media");
            assert_eq!(encrypted.len(), expected_len);
            assert_eq!(encrypted.len() % 16, 0);
        }
    }

    #[test]
    fn image_item_contains_encrypted_media_reference() {
        let item = build_media_item(
            &UploadedMedia {
                media_type: 1,
                download_param: "download-param".to_string(),
                aes_key_hex: "07".repeat(16),
                raw_size: 12,
                encrypted_size: 16,
            },
            &OutboundMediaRequest {
                path: "C:\\\\tmp\\\\generated.png".to_string(),
                kind: Some("image".to_string()),
                file_name: None,
                mime_type: Some("image/png".to_string()),
            },
            Path::new("C:\\\\tmp\\\\generated.png"),
        );
        assert_eq!(item.pointer("/type"), Some(&json!(2)));
        assert_eq!(item.pointer("/image_item/mid_size"), Some(&json!(16)));
        assert_eq!(
            item.pointer("/image_item/media/encrypt_query_param"),
            Some(&json!("download-param"))
        );
        assert_eq!(
            item.pointer("/image_item/media/encrypt_type"),
            Some(&json!(1))
        );
        assert_eq!(
            item.pointer("/image_item/media/aes_key"),
            Some(&json!(BASE64.encode("07".repeat(16).as_bytes())))
        );
    }

    #[test]
    fn video_and_file_items_use_tencent_hex_key_encoding() {
        let uploaded = |media_type| UploadedMedia {
            media_type,
            download_param: "download-param".to_string(),
            aes_key_hex: "ab".repeat(16),
            raw_size: 12,
            encrypted_size: 16,
        };
        let video = build_media_item(
            &uploaded(2),
            &OutboundMediaRequest {
                path: "C:\\\\tmp\\\\clip.mp4".to_string(),
                kind: Some("video".to_string()),
                file_name: None,
                mime_type: Some("video/mp4".to_string()),
            },
            Path::new("C:\\\\tmp\\\\clip.mp4"),
        );
        assert_eq!(video.pointer("/type"), Some(&json!(5)));
        assert_eq!(video.pointer("/video_item/video_size"), Some(&json!(16)));
        assert_eq!(
            video.pointer("/video_item/media/aes_key"),
            Some(&json!(BASE64.encode("ab".repeat(16).as_bytes())))
        );

        let file = build_media_item(
            &uploaded(3),
            &OutboundMediaRequest {
                path: "C:\\\\tmp\\\\report.pdf".to_string(),
                kind: Some("file".to_string()),
                file_name: Some("report.pdf".to_string()),
                mime_type: Some("application/pdf".to_string()),
            },
            Path::new("C:\\\\tmp\\\\report.pdf"),
        );
        assert_eq!(file.pointer("/type"), Some(&json!(4)));
        assert_eq!(
            file.pointer("/file_item/file_name"),
            Some(&json!("report.pdf"))
        );
        assert_eq!(file.pointer("/file_item/len"), Some(&json!("12")));
        assert_eq!(
            file.pointer("/file_item/media/aes_key"),
            Some(&json!(BASE64.encode("ab".repeat(16).as_bytes())))
        );
    }

    #[test]
    fn outbound_media_kind_maps_image_mime_and_extension() {
        let by_mime = outbound_media_kind(
            &OutboundMediaRequest {
                path: "C:\\\\tmp\\\\generated.bin".to_string(),
                kind: None,
                file_name: None,
                mime_type: Some("image/png".to_string()),
            },
            Path::new("C:\\\\tmp\\\\generated.bin"),
        )
        .expect("image mime");
        assert_eq!(by_mime.media_type, 1);

        let by_extension = outbound_media_kind(
            &OutboundMediaRequest {
                path: "C:\\\\tmp\\\\generated.webp".to_string(),
                kind: None,
                file_name: None,
                mime_type: None,
            },
            Path::new("C:\\\\tmp\\\\generated.webp"),
        )
        .expect("image extension");
        assert_eq!(by_extension.media_type, 1);
    }

    #[test]
    fn provider_errors_preserve_tencent_error_message() {
        let error = ensure_provider_success(&json!({
            "ret": -14,
            "errmsg": "upload denied"
        }))
        .expect_err("provider error");
        assert!(error.contains("ret=-14"));
        assert!(error.contains("upload denied"));
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
                image_item: None,
                voice_item: None,
                video_item: None,
                file_item: None,
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
    fn inbound_parser_preserves_image_and_other_media_items() {
        let image_data = "data:image/png;base64,aGVsbG8=";
        let message = IlinkMessage {
            seq: Some(8),
            message_id: Some(44),
            client_id: None,
            from_user_id: Some("wx-user".to_string()),
            group_id: None,
            message_type: Some(1),
            message_state: Some(2),
            item_list: Some(vec![
                MessageItem {
                    item_type: 2,
                    text_item: None,
                    image_item: Some(json!({
                        "mimeType": "image/png",
                        "dataUrl": image_data,
                        "fileSize": 5
                    })),
                    voice_item: None,
                    video_item: None,
                    file_item: None,
                },
                MessageItem {
                    item_type: 4,
                    text_item: None,
                    image_item: None,
                    voice_item: None,
                    video_item: None,
                    file_item: Some(json!({
                        "fileName": "report.pdf",
                        "fileSize": 1024
                    })),
                },
            ]),
            context_token: None,
        };

        let (message, _) = extract_inbound_message(message).expect("media message");
        assert_eq!(message.message_type.as_deref(), Some("image,file"));
        assert_eq!(message.images, vec![image_data]);
        assert_eq!(message.attachments.len(), 2);
        assert_eq!(
            message.attachments[1].file_name.as_deref(),
            Some("report.pdf")
        );
        assert!(message.text.is_empty());
    }

    #[test]
    fn inbound_parser_degrades_oversized_inline_image_to_metadata() {
        let oversized = format!(
            "data:image/png;base64,{}",
            "A".repeat((MAX_INLINE_MEDIA_BYTES * 4 / 3) + 8)
        );
        let message = IlinkMessage {
            seq: Some(9),
            message_id: Some(45),
            client_id: None,
            from_user_id: Some("wx-user".to_string()),
            group_id: None,
            message_type: Some(1),
            message_state: Some(2),
            item_list: Some(vec![MessageItem {
                item_type: 2,
                text_item: None,
                image_item: Some(json!({"dataUrl": oversized})),
                voice_item: None,
                video_item: None,
                file_item: None,
            }]),
            context_token: None,
        };
        let (message, _) = extract_inbound_message(message).expect("media fallback");
        assert!(message.images.is_empty());
        assert!(message.attachments[0].data_url.is_none());
    }

    #[test]
    fn inbound_aes_key_encodings_decrypt_tencent_compatible_fixture() {
        let raw_key = "AAECAwQFBgcICQoLDA0ODw==";
        let hex_key = "MDAwMTAyMDMwNDA1MDYwNzA4MDkwYTBiMGMwZDBlMGY=";
        let ciphertext = (0..64)
            .step_by(2)
            .map(|index| {
                u8::from_str_radix(
                    &"269ea8ce8573c5dcab59099987501a42fd1aeb70dd15113774968465d8818bdb"
                        [index..index + 2],
                    16,
                )
                .expect("fixture byte")
            })
            .collect::<Vec<_>>();

        for encoded in [raw_key, hex_key] {
            let key = parse_inbound_aes_key(encoded).expect("Tencent AES key representation");
            let plaintext = decrypt_aes_128_ecb(&ciphertext, &key).expect("fixture decrypt");
            assert_eq!(plaintext, b"wechat-file-fixture");
        }
    }

    #[test]
    fn inbound_image_raw_hex_key_takes_precedence() {
        let attachment = extract_media_attachment(
            "image",
            &json!({
                "aeskey": "000102030405060708090a0b0c0d0e0f",
                "media": {
                    "encrypt_query_param": "download-param",
                    "aes_key": "EREREREREREREREREREREQ=="
                }
            }),
        )
        .expect("image attachment");
        let key = attachment
            .source
            .expect("download source")
            .aes_key
            .expect("valid key")
            .expect("present key");
        assert_eq!(key, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    }

    #[test]
    fn inbound_download_urls_are_tencent_https_only() {
        let source = InboundMediaSource {
            encrypt_query_param: Some("a/b+c".to_string()),
            full_url: None,
            aes_key: Ok(None),
        };
        assert_eq!(
            inbound_download_url(&source)
                .expect("fallback URL")
                .as_str(),
            "https://novac2c.cdn.weixin.qq.com/c2c/download?encrypted_query_param=a%2Fb%2Bc"
        );

        for full_url in [
            "http://novac2c.cdn.weixin.qq.com/c2c/download",
            "https://evil.example/download",
            "https://novac2c.cdn.weixin.qq.com:444/download",
            "https://novac2c.cdn.weixin.qq.com@evil.example/download",
        ] {
            let source = InboundMediaSource {
                encrypt_query_param: None,
                full_url: Some(full_url.to_string()),
                aes_key: Ok(None),
            };
            assert!(inbound_download_url(&source).is_err(), "{full_url}");
        }
    }

    #[test]
    fn inbound_key_padding_and_size_fail_closed() {
        assert!(parse_inbound_aes_key("not-base64").is_err());
        assert!(parse_inbound_aes_key("c2hvcnQ=").is_err());
        assert!(decrypt_aes_128_ecb(&[0_u8; 15], &[0_u8; 16]).is_err());
        assert!(checked_inbound_download_size(MAX_INBOUND_CIPHERTEXT_BYTES, 1).is_err());
    }

    #[tokio::test]
    async fn inbound_media_write_sanitizes_name_and_stays_in_managed_root() {
        let root = std::env::temp_dir().join(format!("doge-wechat-inbound-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create test root");
        let path = save_inbound_media(&root, "../message", "../../report?.pdf", b"pdf bytes")
            .await
            .expect("save inbound file");
        let canonical_root = std::fs::canonicalize(root.join(INBOUND_MEDIA_DIR)).expect("root");
        assert!(path.starts_with(canonical_root));
        assert_eq!(std::fs::read(&path).expect("read saved file"), b"pdf bytes");
        let name = path.file_name().unwrap().to_string_lossy();
        assert!(name.ends_with("report_.pdf"));
        assert!(!name.contains(".."));
        std::fs::remove_dir_all(root).expect("remove test root");
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
