use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::extract::{Query, State as AxumState};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use reqwest::header::HeaderValue;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;
use zeroize::Zeroizing;

use crate::engine::EngineType;
use crate::session_management::{AutoSessionCreatedBy, AutoSessionMetadata, AutoSessionVisibility};
use crate::state::AppState;
use crate::storage::write_settings;
use crate::types::WechatChannelSettings;

mod outbound_artifacts;
mod target_commands;

use target_commands::{handle_target_control_message, PendingTargetSelection};

const MAX_MESSAGE_CHARS: usize = 1800;
const WECHAT_SESSION_IDLE_TTL_MS: u64 = 24 * 60 * 60 * 1000;
const MAX_WECHAT_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_WECHAT_INBOUND_MEDIA_BYTES: u64 = 100 * 1024 * 1024;
const WECHAT_INBOUND_MEDIA_DIR: &str = "inbound";
const INTERNAL_BRIDGE_HOST: &str = "127.0.0.1";
const INTERNAL_BRIDGE_PORT: u16 = 18789;
const INTERNAL_WEBHOOK_HOST: &str = "127.0.0.1";
const INTERNAL_WEBHOOK_PORT: u16 = 18790;
const INTERNAL_WEBHOOK_PATH: &str = "/webhook/wechat";
const INTERNAL_DEVICE_TYPE: &str = "ipad";
const BUNDLED_BRIDGE_PROVIDER: &str = "@tencent-weixin/openclaw-weixin";
const BUNDLED_BRIDGE_PROVIDER_VERSION: &str = "2.4.6";
const BUNDLED_BRIDGE_PROVIDER_INTEGRITY: &str =
    "sha512-qw9k3PLTiMWGNjjsknHgcTManH1w4j+Ji1ArWIaYLKCq3aFRsVwcqnPi127bvOoVMJGW4dbyJ8NECEMgoO+iRw==";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum WechatLoginState {
    Unconfigured,
    LoggedOut,
    AwaitingConfirmation,
    NeedVerification,
    LoggedIn,
    Disconnected,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WechatChannelStatus {
    pub(crate) state: WechatLoginState,
    pub(crate) message: String,
    pub(crate) listener_running: bool,
}

impl Default for WechatChannelStatus {
    fn default() -> Self {
        Self {
            state: WechatLoginState::Unconfigured,
            message: "微信渠道未配置".to_string(),
            listener_running: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WechatChannelView {
    pub(crate) settings: WechatChannelSettings,
    pub(crate) status: WechatChannelStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateWechatChannelRequest {
    pub(crate) settings: WechatChannelSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WechatLoginQrCode {
    pub(crate) value: String,
    pub(crate) expires_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BundledBridgeHealth {
    ok: bool,
    provider: String,
    provider_version: String,
    provider_integrity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WechatInboundMessage {
    pub(crate) msg_id: String,
    pub(crate) wxid: String,
    pub(crate) text: String,
    #[serde(default)]
    pub(crate) message_type: String,
    #[serde(default)]
    pub(crate) images: Vec<String>,
    #[serde(default)]
    pub(crate) attachments: Vec<WechatMediaAttachment>,
    #[serde(default)]
    pub(crate) is_group: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WechatMediaAttachment {
    pub(crate) kind: String,
    #[serde(default)]
    pub(crate) mime_type: Option<String>,
    #[serde(default)]
    pub(crate) file_name: Option<String>,
    #[serde(default)]
    pub(crate) data_url: Option<String>,
    #[serde(default)]
    pub(crate) url: Option<String>,
    #[serde(default)]
    pub(crate) size: Option<u64>,
    #[serde(default)]
    pub(crate) path: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct WechatMessageLedger {
    routes: HashMap<String, PersistedWechatConversationRoute>,
    targets: HashMap<String, WechatExecutionTarget>,
    pending_selections: HashMap<String, PendingTargetSelection>,
    seen_order: VecDeque<String>,
    seen: HashSet<String>,
}

impl WechatMessageLedger {
    fn session_for_target_at(
        &self,
        wxid: &str,
        target: &WechatExecutionTarget,
        now_ms: u64,
    ) -> Option<String> {
        self.routes
            .get(wxid.trim())
            .filter(|route| route.matches_target(target))
            .filter(|route| !route.is_expired(now_ms))
            .map(|route| route.session_id.clone())
    }

    fn bind_session_at(
        &mut self,
        wxid: &str,
        target: &WechatExecutionTarget,
        session_id: String,
        now_ms: u64,
    ) {
        self.routes.insert(
            wxid.trim().to_string(),
            PersistedWechatConversationRoute::from_target(target, session_id, now_ms),
        );
    }

    fn selected_target(&self, wxid: &str) -> Option<WechatExecutionTarget> {
        let wxid = wxid.trim();
        self.targets.get(wxid).cloned().or_else(|| {
            self.routes
                .get(wxid)
                .and_then(PersistedWechatConversationRoute::execution_target)
        })
    }

    fn pending_selection(&self, wxid: &str) -> Option<PendingTargetSelection> {
        self.pending_selections.get(wxid.trim()).cloned()
    }

    fn set_pending_selection(&mut self, wxid: &str, pending: PendingTargetSelection) {
        self.pending_selections
            .insert(wxid.trim().to_string(), pending);
    }

    fn clear_pending_selection(&mut self, wxid: &str) -> bool {
        self.pending_selections.remove(wxid.trim()).is_some()
    }

    fn select_target(&mut self, wxid: &str, target: WechatExecutionTarget) {
        let wxid = wxid.trim().to_string();
        self.targets.insert(wxid.clone(), target);
        self.pending_selections.remove(&wxid);
    }

    fn reset_session(&mut self, wxid: &str) -> bool {
        let wxid = wxid.trim();
        if !self.targets.contains_key(wxid) {
            if let Some(target) = self
                .routes
                .get(wxid)
                .and_then(PersistedWechatConversationRoute::execution_target)
            {
                self.targets.insert(wxid.to_string(), target);
            }
        }
        let route_removed = self.routes.remove(wxid).is_some();
        let pending_removed = self.pending_selections.remove(wxid).is_some();
        route_removed || pending_removed
    }

    pub(crate) fn is_duplicate(&mut self, msg_id: &str) -> bool {
        let msg_id = msg_id.trim();
        if msg_id.is_empty() || !self.seen.insert(msg_id.to_string()) {
            return true;
        }
        self.seen_order.push_back(msg_id.to_string());
        while self.seen_order.len() > 4096 {
            if let Some(old) = self.seen_order.pop_front() {
                self.seen.remove(&old);
            }
        }
        false
    }

    #[cfg(test)]
    fn route_for(&self, wxid: &str) -> Option<&PersistedWechatConversationRoute> {
        self.routes.get(wxid)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WechatExecutionTarget {
    workspace_id: String,
    engine: EngineType,
    model: Option<String>,
    model_catalog_entry_id: Option<String>,
    provider_profile_id: Option<String>,
}

impl WechatExecutionTarget {
    fn engine_name(&self) -> &'static str {
        match self.engine {
            EngineType::Claude => "claude",
            EngineType::Codex => "codex",
            EngineType::Gemini => "gemini",
            EngineType::Grok => "grok",
            EngineType::Kimi => "kimi",
            EngineType::OpenCode => "opencode",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PersistedWechatConversationRoute {
    session_id: String,
    workspace_id: String,
    engine: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    model_catalog_entry_id: Option<String>,
    #[serde(default)]
    provider_profile_id: Option<String>,
    #[serde(default)]
    last_activity_at_ms: Option<u64>,
}

impl PersistedWechatConversationRoute {
    fn from_target(target: &WechatExecutionTarget, session_id: String, now_ms: u64) -> Self {
        Self {
            session_id,
            workspace_id: target.workspace_id.clone(),
            engine: target.engine_name().to_string(),
            model: target.model.clone(),
            model_catalog_entry_id: target.model_catalog_entry_id.clone(),
            provider_profile_id: target.provider_profile_id.clone(),
            last_activity_at_ms: Some(now_ms),
        }
    }

    fn is_expired(&self, now_ms: u64) -> bool {
        self.last_activity_at_ms.is_some_and(|last_activity_at_ms| {
            now_ms.saturating_sub(last_activity_at_ms) >= WECHAT_SESSION_IDLE_TTL_MS
        })
    }

    fn matches_target(&self, target: &WechatExecutionTarget) -> bool {
        self.workspace_id == target.workspace_id
            && self.engine == target.engine_name()
            && self.model == target.model
            && self.model_catalog_entry_id == target.model_catalog_entry_id
            && self.provider_profile_id == target.provider_profile_id
    }

    fn execution_target(&self) -> Option<WechatExecutionTarget> {
        Some(WechatExecutionTarget {
            workspace_id: self.workspace_id.clone(),
            engine: parse_wechat_engine(&self.engine).ok()?,
            model: self.model.clone(),
            model_catalog_entry_id: self.model_catalog_entry_id.clone(),
            provider_profile_id: self.provider_profile_id.clone(),
        })
    }
}

fn wechat_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(crate) struct WechatRuntime {
    server_abort: Mutex<Option<tokio::task::AbortHandle>>,
    bridge_abort: Mutex<Option<tokio::task::AbortHandle>>,
    internal_secrets: Mutex<Option<WechatInternalSecrets>>,
    status: Mutex<WechatChannelStatus>,
    ledger: Mutex<WechatMessageLedger>,
    session_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl Default for WechatRuntime {
    fn default() -> Self {
        Self {
            server_abort: Mutex::new(None),
            bridge_abort: Mutex::new(None),
            internal_secrets: Mutex::new(None),
            status: Mutex::new(WechatChannelStatus::default()),
            ledger: Mutex::new(WechatMessageLedger::default()),
            session_locks: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Clone)]
struct WechatInternalSecrets {
    api_key: Zeroizing<String>,
    webhook_token: Zeroizing<String>,
}

impl WechatInternalSecrets {
    fn generate() -> Self {
        Self {
            api_key: Zeroizing::new(uuid::Uuid::new_v4().simple().to_string()),
            webhook_token: Zeroizing::new(uuid::Uuid::new_v4().simple().to_string()),
        }
    }
}

impl WechatRuntime {
    pub(crate) async fn status(&self) -> WechatChannelStatus {
        self.status.lock().await.clone()
    }

    async fn session_lock(&self, session_id: &str) -> Arc<Mutex<()>> {
        let mut locks = self.session_locks.lock().await;
        locks
            .entry(session_id.to_string())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }

    async fn internal_secrets(&self) -> Option<WechatInternalSecrets> {
        self.internal_secrets.lock().await.clone()
    }

    pub(crate) async fn sync(&self, app: AppHandle) {
        let state = app.state::<AppState>();
        let raw_settings = state.app_settings.lock().await.wechat_channel.clone();
        let settings = match normalize_settings(raw_settings) {
            Ok(settings) => settings,
            Err(error) => {
                self.stop().await;
                self.set_error(&error).await;
                return;
            }
        };
        if !settings.enabled {
            self.stop().await;
            let mut status = self.status.lock().await;
            *status = if settings.bridge_base_url.trim().is_empty() {
                WechatChannelStatus::default()
            } else {
                WechatChannelStatus {
                    state: WechatLoginState::LoggedOut,
                    message: "微信渠道已关闭".to_string(),
                    listener_running: false,
                }
            };
            return;
        }
        if !settings.risk_acknowledged {
            self.stop().await;
            self.set_error("启用微信渠道前必须确认 Tencent iLink 授权与数据处理说明")
                .await;
            return;
        }
        match load_ledger(&state.settings_path) {
            Ok(ledger) => *self.ledger.lock().await = ledger,
            Err(error) => {
                log::error!("[wechat] ledger load failed: {error}");
                self.stop().await;
                self.set_error("微信渠道历史状态加载失败，请检查本地存储")
                    .await;
                return;
            }
        }
        self.stop().await;
        let bind_address = format!("{}:{}", settings.webhook_host, settings.webhook_port);
        let listener = match tokio::net::TcpListener::bind(&bind_address).await {
            Ok(listener) => listener,
            Err(error) => {
                self.set_error(&format!(
                    "微信 webhook 启动失败（{}）：{}",
                    bind_address,
                    readable_bind_error(&error)
                ))
                .await;
                return;
            }
        };
        let path = settings.webhook_path.clone();
        let secrets = WechatInternalSecrets::generate();
        *self.internal_secrets.lock().await = Some(secrets.clone());
        let router = Router::new()
            .route(&path, post(wechat_webhook))
            .with_state(app.clone());
        let task = tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, router).await {
                log::warn!("[wechat] webhook server stopped: {error}");
            }
        });
        *self.server_abort.lock().await = Some(task.abort_handle());
        if let Err(error) = self.start_bridge(&app, &state, &secrets).await {
            self.stop().await;
            self.set_error(&error).await;
            return;
        }
        let mut status = self.status.lock().await;
        *status = WechatChannelStatus {
            state: WechatLoginState::LoggedOut,
            message: format!(
                "微信 bridge 已启动，webhook 已监听 {}{}",
                bind_address, path
            ),
            listener_running: true,
        };
    }

    pub(crate) async fn stop(&self) {
        if let Some(abort) = self.server_abort.lock().await.take() {
            abort.abort();
        }
        if let Some(abort) = self.bridge_abort.lock().await.take() {
            abort.abort();
        }
        *self.internal_secrets.lock().await = None;
    }

    async fn start_bridge(
        &self,
        app: &AppHandle,
        state: &AppState,
        secrets: &WechatInternalSecrets,
    ) -> Result<(), String> {
        let binary = resolve_bundled_bridge(app)?;
        let webhook_url = format!(
            "http://{}:{}{}",
            INTERNAL_WEBHOOK_HOST, INTERNAL_WEBHOOK_PORT, INTERNAL_WEBHOOK_PATH
        );
        let data_dir = state
            .settings_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("wechat-bridge");
        std::fs::create_dir_all(&data_dir)
            .map_err(|_| "微信 bridge 数据目录无法创建".to_string())?;

        let mut command = crate::utils::async_command(&binary);
        command
            .arg("--listen")
            .arg(format!("{}:{}", INTERNAL_BRIDGE_HOST, INTERNAL_BRIDGE_PORT))
            .env("DOGE_WECHAT_API_KEY", secrets.api_key.as_str())
            .env("DOGE_WECHAT_WEBHOOK_URL", webhook_url)
            .env("DOGE_WECHAT_WEBHOOK_TOKEN", secrets.webhook_token.as_str())
            .env("DOGE_WECHAT_DATA_DIR", &data_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        let mut child = command.spawn().map_err(|error| {
            format!("微信 bridge 组件启动失败，请重新安装包含微信 bridge 的 Doge 安装包：{error}")
        })?;
        let app_for_monitor = app.clone();
        let monitor = tokio::spawn(async move {
            match child.wait().await {
                Ok(exit) => {
                    let state = app_for_monitor.state::<AppState>();
                    let enabled = state.app_settings.lock().await.wechat_channel.enabled;
                    if enabled {
                        state
                            .wechat
                            .set_error(if exit.success() {
                                "微信 bridge 已退出，请重新启用微信渠道"
                            } else {
                                "微信 bridge 意外退出，请重新启用微信渠道"
                            })
                            .await;
                        state.wechat.stop().await;
                    }
                }
                Err(error) => log::warn!("[wechat] bridge process wait failed: {error}"),
            }
        });
        *self.bridge_abort.lock().await = Some(monitor.abort_handle());
        wait_for_bridge_ready(secrets.api_key.as_str()).await?;
        Ok(())
    }

    async fn set_error(&self, message: &str) {
        eprintln!("[wechat] runtime error: {message}");
        log::warn!("[wechat] runtime error: {message}");
        let mut status = self.status.lock().await;
        *status = WechatChannelStatus {
            state: WechatLoginState::Error,
            message: message.to_string(),
            listener_running: false,
        };
    }
}

fn validate_bundled_bridge_health(payload: Value) -> Result<(), String> {
    let health = serde_json::from_value::<BundledBridgeHealth>(payload)
        .map_err(|_| "bridge /health 未返回可识别的 provider identity".to_string())?;
    if !health.ok {
        return Err("bridge /health 报告尚未就绪".to_string());
    }
    if health.provider != BUNDLED_BRIDGE_PROVIDER
        || health.provider_version != BUNDLED_BRIDGE_PROVIDER_VERSION
        || health.provider_integrity != BUNDLED_BRIDGE_PROVIDER_INTEGRITY
    {
        return Err("本地端口被旧版或不兼容的微信 bridge 占用，请重启 Doge".to_string());
    }
    Ok(())
}

async fn wait_for_bridge_ready(api_key: &str) -> Result<(), String> {
    let address = format!("{INTERNAL_BRIDGE_HOST}:{INTERNAL_BRIDGE_PORT}");
    let health_url = format!("http://{address}/health");
    let status_url = format!("http://{address}/login/status");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(250))
        .build()
        .map_err(|_| "微信 bridge 健康检查初始化失败".to_string())?;
    let mut last_error = "bridge 尚未监听本地端口".to_string();
    for _ in 0..20 {
        match client.get(&health_url).send().await {
            Ok(response) if response.status().is_success() => {
                match response.json::<Value>().await {
                    Ok(payload) => match validate_bundled_bridge_health(payload) {
                        Ok(()) => match client
                            .get(&status_url)
                            .header("x-api-key", api_key)
                            .bearer_auth(api_key)
                            .send()
                            .await
                        {
                            Ok(status) if status.status().is_success() => return Ok(()),
                            Ok(status)
                                if status.status() == StatusCode::UNAUTHORIZED
                                    || status.status() == StatusCode::FORBIDDEN =>
                            {
                                last_error =
                                    "本地端口被另一个微信 bridge 进程占用，请重启 Doge".to_string();
                            }
                            Ok(status) => {
                                last_error = format!(
                                    "bridge 登录状态检查失败（HTTP {}）",
                                    status.status().as_u16()
                                );
                            }
                            Err(_) => {
                                last_error = "bridge 登录状态检查失败".to_string();
                            }
                        },
                        Err(error) => last_error = error,
                    },
                    Err(_) => {
                        last_error = "bridge /health 返回了无法识别的响应".to_string();
                    }
                }
            }
            Ok(response) => {
                if let Ok(payload) = response.json::<Value>().await {
                    if let Some(error) = payload.get("error").and_then(Value::as_str) {
                        last_error = error.to_string();
                    }
                }
            }
            Err(_) => {}
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err(format!(
        "微信 bridge 启动后未就绪：{last_error}。请检查安装包中的 bridge 组件"
    ))
}

fn resolve_bundled_bridge(app: &AppHandle) -> Result<PathBuf, String> {
    let executable = if cfg!(target_os = "windows") {
        "wechat-bridge.exe"
    } else {
        "wechat-bridge"
    };
    let architecture = std::env::consts::ARCH;
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.extend([
            resource_dir
                .join("wechat-bridge")
                .join(architecture)
                .join(executable),
            resource_dir.join("wechat-bridge").join(executable),
        ]);
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.join("wechat-bridge").join(executable));
        }
    }
    candidates
        .into_iter()
        .find(|candidate| candidate.is_file())
        .ok_or_else(|| "微信 bridge 组件未随安装包提供，当前版本无法启动微信渠道".to_string())
}

pub(crate) fn split_reply(text: &str) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }
    let chars: Vec<char> = text.chars().collect();
    chars
        .chunks(MAX_MESSAGE_CHARS)
        .map(|chunk| chunk.iter().collect::<String>())
        .collect()
}

pub(crate) fn parse_inbound_message(value: Value) -> Result<WechatInboundMessage, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "wechat webhook rejected: JSON object required".to_string())?;
    let data = object
        .get("data")
        .and_then(Value::as_object)
        .unwrap_or(object);
    let mut text = first_string(data, &["text", "content", "message"]).unwrap_or_default();
    let msg_id = first_string(data, &["msgId", "msg_id", "id"]);
    let wxid = first_string(data, &["wxid", "fromWxid", "from_wxid", "sender"]);
    let message_type = first_string(data, &["type", "messageType", "message_type"])
        .unwrap_or_else(|| "text".to_string());
    let attachments = data
        .get("attachments")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    serde_json::from_value::<WechatMediaAttachment>(item.clone()).ok()
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let mut images = data
        .get("images")
        .or_else(|| data.get("imageUrls"))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    images.extend(
        attachments
            .iter()
            .filter(|attachment| attachment.kind.eq_ignore_ascii_case("image"))
            .filter_map(|attachment| attachment.data_url.clone()),
    );
    images = normalize_wechat_images(images)?;
    if text.is_empty() {
        text = if images.is_empty() && attachments.is_empty() {
            String::new()
        } else {
            media_fallback_text(&message_type, &attachments)
        };
    }
    let is_group = data
        .get("isGroup")
        .or_else(|| data.get("is_group"))
        .and_then(Value::as_bool)
        .unwrap_or_else(|| wxid.as_deref().is_some_and(|id| id.contains("@chatroom")));

    let msg_id = msg_id.ok_or_else(|| "wechat webhook rejected: msgId is required".to_string())?;
    let wxid = wxid.ok_or_else(|| "wechat webhook rejected: wxid is required".to_string())?;
    if msg_id.trim().is_empty() || wxid.trim().is_empty() {
        return Err("wechat webhook rejected: msgId and wxid are required".to_string());
    }
    if text.is_empty() {
        return Err("wechat webhook rejected: text or media is required".to_string());
    }
    Ok(WechatInboundMessage {
        msg_id,
        wxid,
        text,
        message_type,
        images,
        attachments,
        is_group,
    })
}

fn normalize_wechat_images(images: Vec<String>) -> Result<Vec<String>, String> {
    let mut normalized = Vec::with_capacity(images.len());
    for image in images {
        let Some((metadata, payload)) = image.split_once(',') else {
            return Err("wechat webhook rejected: image data URL is invalid".to_string());
        };
        if !metadata.starts_with("data:image/") || !metadata.contains(";base64") {
            return Err("wechat webhook rejected: image data URL is invalid".to_string());
        }
        if payload.len() > (MAX_WECHAT_IMAGE_BYTES * 4 / 3) + 4 {
            return Err("wechat webhook rejected: image payload is too large".to_string());
        }
        let bytes = BASE64
            .decode(payload.as_bytes())
            .map_err(|_| "wechat webhook rejected: image data URL is invalid".to_string())?;
        if bytes.is_empty() || bytes.len() > MAX_WECHAT_IMAGE_BYTES {
            return Err("wechat webhook rejected: image payload is too large".to_string());
        }
        normalized.push(image);
    }
    normalized.sort();
    normalized.dedup();
    Ok(normalized)
}

fn optional_engine_images(images: Vec<String>) -> Option<Vec<String>> {
    (!images.is_empty()).then_some(images)
}

fn resolve_wechat_access_mode(default_access_mode: &str) -> String {
    match default_access_mode.trim() {
        "full-access" => "full-access",
        "read-only" => "read-only",
        "current" => "current",
        // Legacy `default` and malformed persisted values must remain writable
        // without escalating beyond the selected workspace.
        _ => "current",
    }
    .to_string()
}

fn wechat_inbound_media_root(settings_path: &Path) -> PathBuf {
    settings_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("wechat-bridge")
        .join(WECHAT_INBOUND_MEDIA_DIR)
}

fn validate_inbound_attachment_paths(
    attachments: &mut [WechatMediaAttachment],
    managed_root: &Path,
) -> Result<(), String> {
    if !attachments
        .iter()
        .any(|attachment| attachment.path.is_some())
    {
        return Ok(());
    }
    let canonical_root = std::fs::canonicalize(managed_root)
        .map_err(|_| "wechat webhook rejected: inbound media root is unavailable".to_string())?;
    let canonical_parent = managed_root
        .parent()
        .and_then(|parent| std::fs::canonicalize(parent).ok())
        .ok_or_else(|| {
            "wechat webhook rejected: inbound media parent is unavailable".to_string()
        })?;
    if !canonical_root.starts_with(&canonical_parent) {
        return Err(
            "wechat webhook rejected: inbound media root escapes managed storage".to_string(),
        );
    }
    for attachment in attachments {
        let Some(path) = attachment.path.as_deref() else {
            continue;
        };
        let path = Path::new(path.trim());
        if !path.is_absolute() {
            return Err("wechat webhook rejected: inbound media path must be absolute".to_string());
        }
        let canonical = std::fs::canonicalize(path).map_err(|_| {
            "wechat webhook rejected: inbound media path is unavailable".to_string()
        })?;
        let metadata = std::fs::metadata(&canonical).map_err(|_| {
            "wechat webhook rejected: inbound media metadata is unavailable".to_string()
        })?;
        if !canonical.starts_with(&canonical_root) {
            return Err(
                "wechat webhook rejected: inbound media path is outside managed storage"
                    .to_string(),
            );
        }
        if !metadata.is_file() || metadata.len() == 0 {
            return Err(
                "wechat webhook rejected: inbound media must be a non-empty file".to_string(),
            );
        }
        if metadata.len() > MAX_WECHAT_INBOUND_MEDIA_BYTES {
            return Err("wechat webhook rejected: inbound media is too large".to_string());
        }
        attachment.path = Some(canonical.to_string_lossy().into_owned());
        attachment.size = Some(metadata.len());
        if attachment.file_name.is_none() {
            attachment.file_name = canonical
                .file_name()
                .and_then(|value| value.to_str())
                .map(ToString::to_string);
        }
    }
    Ok(())
}

fn materialize_inbound_prompt(text: &str, attachments: &[WechatMediaAttachment]) -> String {
    let entries = attachments
        .iter()
        .filter_map(|attachment| {
            let path = attachment.path.as_deref()?;
            Some(serde_json::json!({
                "kind": attachment.kind,
                "fileName": attachment.file_name,
                "mimeType": attachment.mime_type,
                "size": attachment.size,
                "localPath": path,
            }))
        })
        .collect::<Vec<_>>();
    if entries.is_empty() {
        return text.to_string();
    }
    let attachment_context = entries
        .iter()
        .filter_map(|entry| serde_json::to_string(entry).ok())
        .collect::<Vec<_>>()
        .join("\n");
    format!("{text}\n\n[微信附件：以下 localPath 是当前消息已验证的本地文件]\n{attachment_context}")
}

fn prepare_inbound_engine_input(
    text: &str,
    attachments: &[WechatMediaAttachment],
    mut images: Vec<String>,
) -> (String, Option<Vec<String>>) {
    for attachment in attachments {
        if !attachment.kind.eq_ignore_ascii_case("image")
            || attachment
                .size
                .is_none_or(|size| size > MAX_WECHAT_IMAGE_BYTES as u64)
        {
            continue;
        }
        let Some(path) = attachment.path.as_deref() else {
            continue;
        };
        let Ok(bytes) = std::fs::read(path) else {
            continue;
        };
        if bytes.is_empty() || bytes.len() > MAX_WECHAT_IMAGE_BYTES {
            continue;
        }
        let mime_type = attachment
            .mime_type
            .as_deref()
            .filter(|value| value.starts_with("image/"))
            .unwrap_or("image/jpeg");
        images.push(format!("data:{mime_type};base64,{}", BASE64.encode(bytes)));
    }
    images.sort();
    images.dedup();
    (
        materialize_inbound_prompt(text, attachments),
        optional_engine_images(images),
    )
}

fn media_fallback_text(message_type: &str, attachments: &[WechatMediaAttachment]) -> String {
    let kinds = attachments
        .iter()
        .map(|attachment| attachment.kind.as_str())
        .filter(|kind| !kind.is_empty())
        .collect::<Vec<_>>();
    let kind = if kinds.is_empty() {
        message_type
    } else {
        kinds[0]
    };
    let materialized = attachments
        .iter()
        .any(|attachment| attachment.path.is_some());
    match kind.to_ascii_lowercase().as_str() {
        "image" => "收到一张微信图片，请描述图片内容。".to_string(),
        "voice" if materialized => "收到一条微信语音消息，请读取附件并根据内容回应。".to_string(),
        "video" if materialized => "收到一段微信视频消息，请读取附件并根据内容回应。".to_string(),
        "file" if materialized => "收到一个微信文件，请读取附件并根据内容回应。".to_string(),
        "voice" => "收到一条微信语音消息，但附件下载或解密失败，请让用户重试。".to_string(),
        "video" => "收到一段微信视频消息，但附件下载或解密失败，请让用户重试。".to_string(),
        "file" => "收到一个微信文件，但附件下载或解密失败，请让用户重试。".to_string(),
        _ => "收到一条微信媒体消息。当前 engine 未提供该媒体类型的直接输入，请补充文字说明。"
            .to_string(),
    }
}

fn first_string(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

pub(crate) fn validate_webhook_token(
    expected: Option<&str>,
    header: Option<&str>,
    query: Option<&str>,
) -> bool {
    let Some(expected) = expected.map(str::trim).filter(|value| !value.is_empty()) else {
        return false;
    };
    header.is_some_and(|value| value == expected) || query.is_some_and(|value| value == expected)
}

pub(crate) fn normalize_settings(
    mut settings: WechatChannelSettings,
) -> Result<WechatChannelSettings, String> {
    // Keep the legacy fields in the persisted schema so older settings files
    // deserialize, but Doge owns the local bridge contract now.
    settings.bridge_base_url = format!("http://{INTERNAL_BRIDGE_HOST}:{INTERNAL_BRIDGE_PORT}");
    settings.webhook_host = INTERNAL_WEBHOOK_HOST.to_string();
    settings.webhook_port = INTERNAL_WEBHOOK_PORT;
    settings.webhook_path = INTERNAL_WEBHOOK_PATH.to_string();
    settings.device_type = INTERNAL_DEVICE_TYPE.to_string();
    settings.workspace_id = normalize_optional_string(settings.workspace_id);
    settings.engine = normalize_optional_string(settings.engine);
    settings.model = normalize_optional_string(settings.model);
    settings.model_catalog_entry_id = normalize_optional_string(settings.model_catalog_entry_id);
    settings.provider_profile_id = normalize_optional_string(settings.provider_profile_id);
    if let Some(engine) = settings.engine.as_deref() {
        parse_wechat_engine(engine)?;
    }
    if settings.enabled && !settings.risk_acknowledged {
        return Err("启用微信渠道前必须确认 Tencent iLink 授权与数据处理说明".to_string());
    }
    Ok(settings)
}

fn normalize_optional_string(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn parse_wechat_engine(value: &str) -> Result<EngineType, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "claude" => Ok(EngineType::Claude),
        "codex" => Ok(EngineType::Codex),
        "gemini" if crate::engine_policy::GEMINI_RUNTIME_ENABLED => Ok(EngineType::Gemini),
        "grok" => Ok(EngineType::Grok),
        "kimi" => Ok(EngineType::Kimi),
        "opencode" => Ok(EngineType::OpenCode),
        _ => Err(format!("微信渠道引擎不可用: {value}")),
    }
}

fn wechat_user_visible_session_metadata() -> AutoSessionMetadata {
    AutoSessionMetadata {
        session_purpose: "wechat-conversation".to_string(),
        visibility: AutoSessionVisibility::UserVisible,
        owner_feature: "wechat-channel".to_string(),
        auto_archive: Some(false),
        created_by: AutoSessionCreatedBy::User,
    }
}

fn extract_sync_session_id(response: &Value) -> Option<String> {
    response
        .get("sessionId")
        .or_else(|| response.get("session_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct WechatOutboundMedia {
    path: String,
    kind: String,
    mime_type: String,
    file_name: Option<String>,
}

fn outbound_media_kind(media_type: Option<&str>, path: &Path) -> &'static str {
    let media_type = media_type.unwrap_or_default().trim().to_ascii_lowercase();
    if media_type.starts_with("image/") {
        return "image";
    }
    if media_type.starts_with("video/") {
        return "video";
    }
    if media_type.starts_with("audio/") || media_type == "voice" {
        return "voice";
    }
    if !media_type.is_empty() {
        return "file";
    }
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" | "jpg" | "jpeg" | "gif" | "webp" => "image",
        "mp4" | "mov" | "webm" | "mkv" | "avi" | "m4v" => "video",
        "mp3" | "wav" | "m4a" | "aac" | "ogg" | "opus" => "voice",
        _ => "file",
    }
}

fn outbound_media_mime_type(kind: &str, path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "pdf" => "application/pdf",
        "txt" => "text/plain",
        "json" => "application/json",
        _ if kind == "image" => "image/png",
        _ if kind == "video" => "video/mp4",
        _ if kind == "voice" => "audio/mpeg",
        _ => "application/octet-stream",
    }
}

fn extract_outbound_media(value: &Value) -> Vec<WechatOutboundMedia> {
    const IMAGE_KEYS: [&str; 5] = [
        "images",
        "imagePaths",
        "image_paths",
        "generatedImages",
        "generated_images",
    ];
    const VIDEO_KEYS: [&str; 3] = ["videos", "videoPaths", "video_paths"];
    const FILE_KEYS: [&str; 3] = ["files", "filePaths", "file_paths"];
    const VOICE_KEYS: [&str; 5] = [
        "audio",
        "audioPaths",
        "audio_paths",
        "voicePaths",
        "voice_paths",
    ];
    const ARTIFACT_KEYS: [&str; 3] = ["artifacts", "artifactRefs", "artifact_refs"];

    fn add_path(
        media: &mut Vec<WechatOutboundMedia>,
        seen: &mut HashSet<String>,
        candidate: &str,
        forced_kind: Option<&str>,
        media_type: Option<&str>,
        file_name: Option<&str>,
    ) {
        let candidate = candidate.trim();
        if candidate.is_empty()
            || candidate.starts_with("data:")
            || candidate.starts_with("http://")
            || candidate.starts_with("https://")
        {
            return;
        }
        let path = Path::new(candidate);
        if !path.is_absolute() {
            return;
        }
        let kind = forced_kind.unwrap_or_else(|| outbound_media_kind(media_type, path));
        let dedupe_key = format!("{kind}\0{candidate}");
        if seen.insert(dedupe_key) {
            let mime_type = media_type
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .unwrap_or_else(|| outbound_media_mime_type(kind, path).to_string());
            media.push(WechatOutboundMedia {
                path: candidate.to_string(),
                kind: kind.to_string(),
                mime_type,
                file_name: file_name
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string),
            });
        }
    }

    fn add_value(
        value: &Value,
        media: &mut Vec<WechatOutboundMedia>,
        seen: &mut HashSet<String>,
        forced_kind: Option<&str>,
    ) {
        match value {
            Value::String(candidate) => add_path(media, seen, candidate, forced_kind, None, None),
            Value::Array(items) => {
                for item in items {
                    add_value(item, media, seen, forced_kind);
                }
            }
            Value::Object(object) => {
                let declared_kind = object
                    .get("kind")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|kind| matches!(*kind, "image" | "video" | "file" | "voice"));
                let media_type = object
                    .get("mediaType")
                    .or_else(|| object.get("media_type"))
                    .and_then(Value::as_str);
                let file_name = object
                    .get("fileName")
                    .or_else(|| object.get("file_name"))
                    .or_else(|| object.get("name"))
                    .and_then(Value::as_str);
                for key in ["locator", "path", "filePath", "file_path"] {
                    if let Some(candidate) = object.get(key).and_then(Value::as_str) {
                        add_path(
                            media,
                            seen,
                            candidate,
                            forced_kind.or(declared_kind),
                            media_type,
                            file_name,
                        );
                    }
                }
            }
            _ => {}
        }
    }

    fn visit(
        value: &Value,
        depth: usize,
        media: &mut Vec<WechatOutboundMedia>,
        seen: &mut HashSet<String>,
    ) {
        if depth > 3 {
            return;
        }
        let Some(object) = value.as_object() else {
            return;
        };
        for key in IMAGE_KEYS {
            if let Some(images) = object.get(key) {
                add_value(images, media, seen, Some("image"));
            }
        }
        for key in VIDEO_KEYS {
            if let Some(videos) = object.get(key) {
                add_value(videos, media, seen, Some("video"));
            }
        }
        for key in FILE_KEYS {
            if let Some(files) = object.get(key) {
                add_value(files, media, seen, Some("file"));
            }
        }
        for key in VOICE_KEYS {
            if let Some(voice) = object.get(key) {
                add_value(voice, media, seen, Some("voice"));
            }
        }
        for key in ARTIFACT_KEYS {
            if let Some(artifacts) = object.get(key) {
                add_value(artifacts, media, seen, None);
            }
        }
        for key in ["data", "result", "response", "payload"] {
            if let Some(child) = object.get(key) {
                visit(child, depth + 1, media, seen);
            }
        }
    }

    let mut media = Vec::new();
    let mut seen = HashSet::new();
    visit(value, 0, &mut media, &mut seen);
    media
}

fn prepare_outbound_reply(
    response: &Value,
    workspace_root: &Path,
    app_data_dir: &Path,
) -> (String, Vec<WechatOutboundMedia>) {
    let raw_reply = crate::engine::extract_turn_result_text(Some(response)).unwrap_or_default();
    let (reply, linked_media) = outbound_artifacts::materialize_wechat_markdown_artifacts(
        &raw_reply,
        workspace_root,
        app_data_dir,
    );
    let mut combined = extract_outbound_media(response);
    combined.extend(linked_media);

    let mut seen = HashSet::new();
    let mut failures = Vec::new();
    let media = combined
        .into_iter()
        .filter_map(|item| {
            let item = match outbound_artifacts::validate_wechat_outbound_media(
                &item,
                workspace_root,
                app_data_dir,
            ) {
                Ok(item) => item,
                Err(reason) => {
                    let file_name = Path::new(&item.path)
                        .file_name()
                        .and_then(|name| name.to_str())
                        .filter(|name| !name.trim().is_empty())
                        .unwrap_or("attachment");
                    failures.push(format!("[附件未发送：{file_name}（{reason}）]"));
                    return None;
                }
            };
            let normalized_path = Path::new(&item.path).to_string_lossy().into_owned();
            #[cfg(windows)]
            let normalized_path = normalized_path.to_ascii_lowercase();
            seen.insert(format!("{}\0{normalized_path}", item.kind))
                .then_some(item)
        })
        .collect();
    let reply = if failures.is_empty() {
        reply
    } else if reply.trim().is_empty() {
        failures.join("\n")
    } else {
        format!("{reply}\n{}", failures.join("\n"))
    };
    (reply, media)
}

fn prepare_outbound_reply_without_workspace(
    response: &Value,
) -> (String, Vec<WechatOutboundMedia>) {
    let mut reply = crate::engine::extract_turn_result_text(Some(response)).unwrap_or_default();
    if !extract_outbound_media(response).is_empty() {
        if !reply.trim().is_empty() {
            reply.push('\n');
        }
        reply.push_str("[附件未发送：无法确认当前工作区]");
    }
    (reply, Vec::new())
}

fn readable_bind_error(error: &std::io::Error) -> &'static str {
    match error.kind() {
        std::io::ErrorKind::AddrInUse => "端口已被占用",
        std::io::ErrorKind::PermissionDenied => "没有权限绑定该地址",
        _ => "地址不可用",
    }
}

async fn wechat_webhook(
    AxumState(app): AxumState<AppHandle>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
    body: Bytes,
) -> (StatusCode, Json<Value>) {
    let state = app.state::<AppState>();
    let expected_token = state
        .wechat
        .internal_secrets()
        .await
        .map(|secrets| secrets.webhook_token.to_string());
    let header_token = headers
        .get("x-wechat-webhook-token")
        .and_then(|value| value.to_str().ok())
        .or_else(|| {
            headers
                .get("x-webhook-token")
                .and_then(|value| value.to_str().ok())
        });
    if !validate_webhook_token(
        expected_token.as_deref(),
        header_token,
        query.get("token").map(String::as_str),
    ) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "ok": false, "error": "unauthorized" })),
        );
    }
    let payload = match serde_json::from_slice::<Value>(&body) {
        Ok(payload) => payload,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "ok": false, "error": "invalid payload" })),
            )
        }
    };
    let payload = match payload {
        Value::Object(_) => payload,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "ok": false, "error": "invalid payload" })),
            )
        }
    };
    let mut message = match parse_inbound_message(payload) {
        Ok(message) => message,
        Err(error) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "ok": false, "error": error })),
            )
        }
    };
    if message.is_group {
        return (
            StatusCode::OK,
            Json(serde_json::json!({ "ok": true, "ignored": "group" })),
        );
    }
    let inbound_media_root = wechat_inbound_media_root(&state.settings_path);
    if let Err(error) =
        validate_inbound_attachment_paths(&mut message.attachments, &inbound_media_root)
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "ok": false, "error": error })),
        );
    }
    let accepted = {
        let mut ledger = state.wechat.ledger.lock().await;
        if ledger.is_duplicate(&message.msg_id) {
            Ok(false)
        } else {
            let ledger_before = ledger.clone();
            match persist_ledger(&state.settings_path, &ledger) {
                Ok(()) => Ok(true),
                Err(error) => {
                    log::error!("[wechat] ledger persist failed: {error}");
                    *ledger = ledger_before;
                    Err(error)
                }
            }
        }
    };
    match accepted {
        Ok(false) => {
            return (
                StatusCode::OK,
                Json(serde_json::json!({ "ok": true, "duplicate": true })),
            )
        }
        Ok(true) => {}
        Err(_) => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "ok": false, "error": "channel storage unavailable" })),
            )
        }
    };
    let app_for_task = app.clone();
    let wxid_for_task = message.wxid.clone();
    let text_for_task = message.text.clone();
    let msg_id_for_task = message.msg_id.clone();
    let message_type_for_task = message.message_type.clone();
    let images_for_task = message.images.clone();
    let attachments_for_task = message.attachments.clone();
    tokio::spawn(async move {
        let state = app_for_task.state::<AppState>();
        let session_lock = state.wechat.session_lock(&wxid_for_task).await;
        let _session_guard = session_lock.lock().await;
        match handle_target_control_message(&app_for_task, &wxid_for_task, &text_for_task).await {
            Ok(Some(reply)) => {
                if let Err(error) = send_reply_with_state(&state, &wxid_for_task, &reply).await {
                    log::error!("[wechat] target command reply failed: {error}");
                }
                return;
            }
            Ok(None) => {}
            Err(error) => {
                log::error!("[wechat] target command failed: {error}");
                if let Err(reply_error) = send_reply_with_state(
                    &state,
                    &wxid_for_task,
                    "暂时无法读取工作区或模型目录，请稍后重试",
                )
                .await
                {
                    log::error!("[wechat] target command error reply failed: {reply_error}");
                }
                return;
            }
        }
        let target = match state
            .wechat
            .ledger
            .lock()
            .await
            .selected_target(&wxid_for_task)
        {
            Some(target) => target,
            None => {
                if let Err(error) = send_reply_with_state(
                    &state,
                    &wxid_for_task,
                    "尚未选择会话目标。请发送 /workspace 开始选择工作区、引擎和模型。",
                )
                .await
                {
                    log::error!("[wechat] missing target guidance failed: {error}");
                }
                return;
            }
        };
        let now_ms = wechat_now_ms();
        let existing_session_id =
            state
                .wechat
                .ledger
                .lock()
                .await
                .session_for_target_at(&wxid_for_task, &target, now_ms);
        let continue_session = existing_session_id.is_some();
        let access_mode_for_engine = {
            let settings = state.app_settings.lock().await;
            resolve_wechat_access_mode(&settings.default_access_mode)
        };
        let (text_for_engine, images_for_engine) =
            prepare_inbound_engine_input(&text_for_task, &attachments_for_task, images_for_task);
        let _ = app_for_task.emit(
            "wechat://message",
            serde_json::json!({
                "msgId": msg_id_for_task,
                "wxid": wxid_for_task,
                "text": text_for_task,
                "messageType": message_type_for_task,
                "workspaceId": target.workspace_id,
                "engine": target.engine_name(),
                "model": target.model,
                "sessionId": existing_session_id,
            }),
        );
        let result = crate::engine::engine_send_message_sync_inner(
            target.workspace_id.clone(),
            text_for_engine,
            Some(target.engine),
            target.model.clone(),
            None,
            Some(false),
            Some(access_mode_for_engine),
            images_for_engine,
            continue_session,
            existing_session_id,
            None,
            None,
            None,
            None,
            Some(wechat_user_visible_session_metadata()),
            target.provider_profile_id.clone(),
            &app_for_task,
            &state,
        )
        .await;
        match result {
            Ok(response) => {
                let Some(session_id) = extract_sync_session_id(&response) else {
                    log::error!("[wechat] agent turn did not return a canonical session id");
                    return;
                };
                let workspace_root = {
                    let workspaces = state.workspaces.lock().await;
                    workspaces
                        .get(&target.workspace_id)
                        .map(|workspace| PathBuf::from(&workspace.path))
                };
                {
                    let mut ledger = state.wechat.ledger.lock().await;
                    let ledger_before = ledger.clone();
                    ledger.bind_session_at(
                        &wxid_for_task,
                        &target,
                        session_id.clone(),
                        wechat_now_ms(),
                    );
                    if let Err(error) = persist_ledger(&state.settings_path, &ledger) {
                        *ledger = ledger_before;
                        log::error!("[wechat] route persist failed: {error}");
                        return;
                    }
                }
                if let Err(error) =
                    crate::session_management::record_session_execution_target_if_present(
                        &state.workspaces,
                        state.storage_path.as_path(),
                        target.workspace_id.clone(),
                        session_id.clone(),
                        target.engine_name().to_string(),
                        target.model_catalog_entry_id.as_deref(),
                        target.model.as_deref(),
                        None,
                    )
                    .await
                {
                    log::warn!("[wechat] session execution target persist failed: {error}");
                }
                let _ = app_for_task.emit(
                    "wechat://session-updated",
                    serde_json::json!({
                        "workspaceId": target.workspace_id,
                        "sessionId": session_id,
                        "engine": target.engine_name(),
                        "model": target.model,
                    }),
                );
                let (reply, outbound_media) = if let Some(workspace_root) = workspace_root {
                    let app_data_dir = state
                        .storage_path
                        .parent()
                        .unwrap_or_else(|| Path::new("."));
                    prepare_outbound_reply(&response, &workspace_root, app_data_dir)
                } else {
                    log::warn!(
                        "[wechat] outbound artifact materialization skipped: workspace unavailable"
                    );
                    prepare_outbound_reply_without_workspace(&response)
                };
                if reply.trim().is_empty() && outbound_media.is_empty() {
                    log::warn!("[wechat] agent turn returned neither text nor outbound media");
                } else if let Err(error) = send_reply_with_media_with_state(
                    &state,
                    &wxid_for_task,
                    &reply,
                    &outbound_media,
                )
                .await
                {
                    log::error!("[wechat] reply delivery failed: {error}");
                }
            }
            Err(error) => {
                log::error!("[wechat] agent turn failed: {error}");
                if let Err(reply_error) = send_reply_with_state(
                    &state,
                    &wxid_for_task,
                    "doge 暂时无法处理此消息，请稍后重试",
                )
                .await
                {
                    log::error!("[wechat] error reply delivery failed: {reply_error}");
                }
            }
        }
    });
    (StatusCode::OK, Json(serde_json::json!({ "ok": true })))
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedWechatLedger {
    #[serde(default)]
    routes: HashMap<String, PersistedWechatConversationRoute>,
    #[serde(default)]
    targets: HashMap<String, WechatExecutionTarget>,
    #[serde(default)]
    pending_selections: HashMap<String, PendingTargetSelection>,
    /// Legacy v1 map used random ids before engines returned canonical session ids.
    /// It is intentionally read and discarded during migration.
    #[serde(default)]
    sessions: HashMap<String, String>,
    #[serde(default)]
    seen_msg_ids: Vec<String>,
}

fn ledger_path(settings_path: &Path) -> std::path::PathBuf {
    settings_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("wechat-channel-ledger.json")
}

fn persist_ledger(settings_path: &Path, ledger: &WechatMessageLedger) -> Result<(), String> {
    crate::storage::write_json_file(
        &ledger_path(settings_path),
        &PersistedWechatLedger {
            routes: ledger.routes.clone(),
            targets: ledger.targets.clone(),
            pending_selections: ledger.pending_selections.clone(),
            sessions: HashMap::new(),
            seen_msg_ids: ledger.seen_order.iter().cloned().collect(),
        },
    )
}

fn load_ledger(settings_path: &Path) -> Result<WechatMessageLedger, String> {
    let persisted =
        crate::storage::read_json_file::<PersistedWechatLedger>(&ledger_path(settings_path))?
            .unwrap_or_default();
    let _legacy_sessions = persisted.sessions;
    let mut ledger = WechatMessageLedger {
        routes: persisted.routes,
        targets: persisted.targets,
        pending_selections: persisted.pending_selections,
        seen_order: VecDeque::from(persisted.seen_msg_ids),
        seen: HashSet::new(),
    };
    for msg_id in ledger.seen_order.iter().cloned() {
        ledger.seen.insert(msg_id);
    }
    while ledger.seen_order.len() > 4096 {
        if let Some(old) = ledger.seen_order.pop_front() {
            ledger.seen.remove(&old);
        }
    }
    Ok(ledger)
}

fn settings_view(
    state: &AppState,
) -> impl std::future::Future<Output = Result<WechatChannelView, String>> + '_ {
    async move {
        let settings = state.app_settings.lock().await.wechat_channel.clone();
        let runtime_status = state.wechat.status().await;
        Ok(WechatChannelView {
            settings: settings.clone(),
            status: if settings.enabled {
                runtime_status
            } else {
                WechatChannelStatus::default()
            },
        })
    }
}

#[tauri::command]
pub(crate) async fn get_wechat_channel(
    state: State<'_, AppState>,
) -> Result<WechatChannelView, String> {
    settings_view(&state).await
}

#[tauri::command]
pub(crate) async fn update_wechat_channel(
    request: UpdateWechatChannelRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<WechatChannelView, String> {
    let settings = normalize_settings(request.settings)?;
    let mut next = state.app_settings.lock().await.clone();
    next.wechat_channel = settings;
    if let Err(error) = write_settings(&state.settings_path, &next) {
        return Err(format!("failed to write WeChat channel settings: {error}"));
    }
    *state.app_settings.lock().await = next;
    state.wechat.sync(app).await;
    settings_view(&state).await
}

struct WechatBridgeClient {
    client: reqwest::Client,
    base_url: String,
    api_key: String,
    device_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WechatOutboundMediaRequest {
    path: String,
    kind: String,
    mime_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_name: Option<String>,
}

fn validate_outbound_media_path(media: &WechatOutboundMedia) -> Result<&Path, String> {
    if media.kind == "voice" {
        return Err("微信暂不支持发送语音或音频 artifact".to_string());
    }
    if !matches!(media.kind.as_str(), "image" | "video" | "file") {
        return Err(format!("微信不支持发送 {} 类型 artifact", media.kind));
    }
    let path = Path::new(media.path.trim());
    if !path.is_absolute() {
        return Err("生成媒体路径必须是绝对路径".to_string());
    }
    let metadata = std::fs::metadata(path).map_err(|error| format!("生成媒体不可读：{error}"))?;
    if !metadata.is_file() {
        return Err("生成媒体路径不是文件".to_string());
    }
    if metadata.len() == 0 {
        return Err("生成媒体文件为空".to_string());
    }
    if metadata.len() > MAX_WECHAT_IMAGE_BYTES as u64 {
        return Err(format!(
            "生成媒体超过 {} MB 限制",
            MAX_WECHAT_IMAGE_BYTES / (1024 * 1024)
        ));
    }
    Ok(path)
}

fn build_outbound_media_payload(wxid: &str, media: &WechatOutboundMedia) -> Result<Value, String> {
    let path_ref = validate_outbound_media_path(media)?;
    Ok(serde_json::json!({
        "to": wxid,
        "content": "",
        "media": WechatOutboundMediaRequest {
            path: path_ref.to_string_lossy().into_owned(),
            kind: media.kind.clone(),
            mime_type: media.mime_type.clone(),
            file_name: media.file_name.clone().or_else(|| {
                path_ref
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(ToString::to_string)
            }),
        }
    }))
}

struct WechatBridgeLoginStatus {
    state: WechatLoginState,
    message: String,
}

impl WechatBridgeClient {
    fn new(base_url: &str, api_key: &str, device_type: &str) -> Result<Self, String> {
        let base_url = base_url.trim().trim_end_matches('/');
        if !(base_url.starts_with("http://") || base_url.starts_with("https://")) {
            return Err("微信 bridge 地址必须以 http:// 或 https:// 开头".to_string());
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| "微信 bridge client 初始化失败".to_string())?;
        Ok(Self {
            client,
            base_url: base_url.to_string(),
            api_key: api_key.to_string(),
            device_type: device_type.to_string(),
        })
    }

    fn request(&self, path: &str) -> reqwest::RequestBuilder {
        let url = format!("{}{}", self.base_url, path);
        let api_key = HeaderValue::from_str(&self.api_key)
            .unwrap_or_else(|_| HeaderValue::from_static("invalid"));
        self.client
            .get(url)
            .header("x-api-key", api_key)
            .bearer_auth(&self.api_key)
    }

    async fn get_json(&self, path: &str) -> Result<Value, String> {
        self.get_json_with_query(path, &[]).await
    }

    async fn get_json_with_query(
        &self,
        path: &str,
        query: &[(&str, &str)],
    ) -> Result<Value, String> {
        let response = self
            .request(path)
            .query(query)
            .send()
            .await
            .map_err(|_| "bridge 连接失败，请检查地址和网络".to_string())?;
        let status = response.status();
        if !status.is_success() {
            return Err(if status.as_u16() == 401 || status.as_u16() == 403 {
                "本地 bridge 鉴权失败，请重启 Doge".to_string()
            } else {
                format!("bridge 请求失败（HTTP {}）", status.as_u16())
            });
        }
        response
            .json::<Value>()
            .await
            .map_err(|_| "bridge 返回了无法识别的响应".to_string())
    }

    async fn qrcode(&self) -> Result<WechatLoginQrCode, String> {
        let value = self
            .get_json_with_query(
                "/login/qrcode",
                &[("deviceType", self.device_type.as_str())],
            )
            .await?;
        parse_qrcode_response(value)
    }

    async fn login_status(&self) -> Result<WechatBridgeLoginStatus, String> {
        let value = self.get_json("/login/status").await?;
        parse_login_status_response(value)
    }

    async fn submit_login_verify(&self, code: &str) -> Result<(), String> {
        let code = validate_login_verification_code(code)?;
        let response = self
            .client
            .post(format!("{}/login/verify", self.base_url))
            .header("x-api-key", &self.api_key)
            .bearer_auth(&self.api_key)
            .json(&serde_json::json!({ "code": code }))
            .send()
            .await
            .map_err(|_| "bridge 连接失败，验证码未提交".to_string())?;
        if response.status().is_success() {
            Ok(())
        } else if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
            Err("bridge 鉴权失败，验证码未提交".to_string())
        } else if response.status() == StatusCode::CONFLICT {
            Err("当前没有等待验证码的微信登录，请刷新二维码".to_string())
        } else if response.status() == StatusCode::BAD_REQUEST {
            Err("数字验证码格式无效，请输入手机微信显示的数字".to_string())
        } else {
            Err(format!(
                "bridge 提交验证码失败（HTTP {}）",
                response.status().as_u16()
            ))
        }
    }

    async fn send_text(&self, wxid: &str, content: &str) -> Result<(), String> {
        self.send_request(serde_json::json!({ "to": wxid, "content": content }))
            .await
    }

    async fn send_media(&self, wxid: &str, media: &WechatOutboundMedia) -> Result<(), String> {
        self.send_request(build_outbound_media_payload(wxid, media)?)
            .await
    }

    async fn send_request(&self, payload: Value) -> Result<(), String> {
        let response = self
            .client
            .post(format!("{}/message/send", self.base_url))
            .header("x-api-key", &self.api_key)
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .await
            .map_err(|_| "bridge 连接失败，消息未发送".to_string())?;
        if response.status().is_success() {
            Ok(())
        } else if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
            Err("bridge 鉴权失败，消息未发送".to_string())
        } else {
            Err(format!(
                "bridge 发送消息失败（HTTP {}）",
                response.status().as_u16()
            ))
        }
    }
}

fn parse_login_status_response(value: Value) -> Result<WechatBridgeLoginStatus, String> {
    let status = value
        .pointer("/data/status")
        .or_else(|| value.get("status"))
        .or_else(|| value.get("state"))
        .and_then(Value::as_str)
        .unwrap_or("logged_out")
        .to_ascii_lowercase();
    let state = match status.as_str() {
        "logged_in" | "loggedin" | "online" | "connected" => WechatLoginState::LoggedIn,
        "scanned" | "scaned" | "awaiting_confirmation" | "wait_confirm" | "confirm" => {
            WechatLoginState::AwaitingConfirmation
        }
        "need_verify" | "need_verifycode" => WechatLoginState::NeedVerification,
        "disconnected" | "offline" | "expired" => WechatLoginState::Disconnected,
        "error" | "verify_code_blocked" => WechatLoginState::Error,
        _ => WechatLoginState::LoggedOut,
    };
    let message = value
        .pointer("/data/message")
        .or_else(|| value.get("message"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| default_login_status_message(&state).to_string());
    Ok(WechatBridgeLoginStatus { state, message })
}

fn default_login_status_message(state: &WechatLoginState) -> &'static str {
    match state {
        WechatLoginState::LoggedIn => "微信已登录",
        WechatLoginState::AwaitingConfirmation => "请在手机微信中确认登录",
        WechatLoginState::NeedVerification => "请输入手机微信显示的数字验证码",
        WechatLoginState::Disconnected => "微信已掉线，请重新扫码",
        WechatLoginState::Error => "微信登录失败，请刷新二维码后重试",
        _ => "微信尚未登录",
    }
}

fn validate_login_verification_code(code: &str) -> Result<&str, String> {
    let code = code.trim();
    if code.is_empty() || code.len() > 8 || !code.bytes().all(|value| value.is_ascii_digit()) {
        return Err("数字验证码必须为 1-8 位数字".to_string());
    }
    Ok(code)
}

fn parse_qrcode_response(value: Value) -> Result<WechatLoginQrCode, String> {
    let root = value.as_object();
    let data = root.and_then(|object| object.get("data"));
    let data_object = data.and_then(Value::as_object);
    let qr = find_qr_value(data_object)
        .or_else(|| find_qr_value(root))
        .or_else(|| data.and_then(Value::as_str))
        .or_else(|| value.as_str())
        .map(ToString::to_string)
        .ok_or_else(|| "bridge QR 响应格式无效或未返回登录二维码".to_string())?;
    Ok(WechatLoginQrCode {
        value: qr,
        expires_at: data_object
            .or(root)
            .and_then(|object| object.get("expiresAt"))
            .and_then(Value::as_str)
            .map(ToString::to_string),
    })
}

fn find_qr_value<'a>(object: Option<&'a serde_json::Map<String, Value>>) -> Option<&'a str> {
    for key in ["value", "qrcode", "qrCode", "url", "dataUrl"] {
        let Some(value) = object
            .and_then(|object| object.get(key))
            .and_then(Value::as_str)
        else {
            continue;
        };
        let value = value.trim();
        if !value.is_empty() {
            return Some(value);
        }
    }
    None
}

async fn bridge_client_for_state(state: &AppState) -> Result<WechatBridgeClient, String> {
    let api_key = state
        .wechat
        .internal_secrets()
        .await
        .map(|secrets| secrets.api_key.to_string())
        .ok_or_else(|| "微信 bridge 尚未启动，请重新启用微信渠道".to_string())?;
    WechatBridgeClient::new(
        &format!("http://{INTERNAL_BRIDGE_HOST}:{INTERNAL_BRIDGE_PORT}"),
        &api_key,
        INTERNAL_DEVICE_TYPE,
    )
}

async fn send_reply_with_state(state: &AppState, wxid: &str, text: &str) -> Result<usize, String> {
    send_reply_with_media_with_state(state, wxid, text, &[]).await
}

async fn send_reply_with_media_with_state(
    state: &AppState,
    wxid: &str,
    text: &str,
    outbound_media: &[WechatOutboundMedia],
) -> Result<usize, String> {
    let chunks = split_reply(text);
    if chunks.is_empty() && outbound_media.is_empty() {
        return Ok(0);
    }
    for media in outbound_media {
        validate_outbound_media_path(media)?;
    }
    let client = bridge_client_for_state(state).await?;
    for chunk in &chunks {
        client.send_text(wxid, chunk).await?;
    }
    for media in outbound_media {
        client.send_media(wxid, media).await?;
    }
    Ok(chunks.len() + outbound_media.len())
}

#[tauri::command]
pub(crate) async fn wechat_get_login_qrcode(
    state: State<'_, AppState>,
) -> Result<WechatLoginQrCode, String> {
    bridge_client_for_state(&state).await?.qrcode().await
}

#[tauri::command]
pub(crate) async fn wechat_get_login_status(
    state: State<'_, AppState>,
) -> Result<WechatChannelStatus, String> {
    let bridge_status = match bridge_client_for_state(&state).await {
        Ok(client) => match client.login_status().await {
            Ok(login_status) => login_status,
            Err(error) => {
                state.wechat.set_error(&error).await;
                return Err(error);
            }
        },
        Err(error) => {
            state.wechat.set_error(&error).await;
            return Err(error);
        }
    };
    let listener_running = state.wechat.status().await.listener_running;
    let status = WechatChannelStatus {
        state: bridge_status.state,
        message: bridge_status.message,
        listener_running,
    };
    *state.wechat.status.lock().await = status.clone();
    Ok(status)
}

#[tauri::command]
pub(crate) async fn wechat_submit_login_verify(
    code: String,
    state: State<'_, AppState>,
) -> Result<WechatChannelStatus, String> {
    bridge_client_for_state(&state)
        .await?
        .submit_login_verify(&code)
        .await?;
    wechat_get_login_status(state).await
}

#[tauri::command]
pub(crate) async fn wechat_test_connection(state: State<'_, AppState>) -> Result<String, String> {
    let login_state = match bridge_client_for_state(&state).await {
        Ok(client) => match client.login_status().await {
            Ok(login_status) => login_status.state,
            Err(error) => {
                state.wechat.set_error(&error).await;
                return Err(error);
            }
        },
        Err(error) => {
            state.wechat.set_error(&error).await;
            return Err(error);
        }
    };
    Ok(match login_state {
        WechatLoginState::LoggedIn => "bridge 连接正常，微信已登录".to_string(),
        WechatLoginState::NeedVerification => {
            "bridge 连接正常，等待输入手机微信显示的数字验证码".to_string()
        }
        WechatLoginState::Disconnected => "bridge 连接正常，但微信已掉线".to_string(),
        _ => "bridge 连接正常，微信尚未登录".to_string(),
    })
}

#[tauri::command]
pub(crate) async fn wechat_send_reply(
    wxid: String,
    text: String,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let wxid = wxid.trim();
    if wxid.is_empty() {
        return Err("微信回复目标不能为空".to_string());
    }
    send_reply_with_state(&state, wxid, &text).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn execution_target() -> WechatExecutionTarget {
        WechatExecutionTarget {
            workspace_id: "workspace-a".to_string(),
            engine: EngineType::Codex,
            model: Some("gpt-5.6-sol".to_string()),
            model_catalog_entry_id: Some("codex:gpt-5.6-sol".to_string()),
            provider_profile_id: Some("provider-a".to_string()),
        }
    }

    #[tokio::test]
    async fn internal_secrets_are_ephemeral_and_cleared_on_stop() {
        let runtime = WechatRuntime::default();
        assert!(runtime.internal_secrets().await.is_none());

        let first = WechatInternalSecrets::generate();
        let second = WechatInternalSecrets::generate();
        assert_ne!(first.api_key, second.api_key);
        assert_ne!(first.webhook_token, second.webhook_token);
        assert_ne!(first.api_key, first.webhook_token);

        *runtime.internal_secrets.lock().await = Some(first);
        assert!(runtime.internal_secrets().await.is_some());
        runtime.stop().await;
        assert!(runtime.internal_secrets().await.is_none());
    }

    #[test]
    fn rejects_webhook_token_before_body_processing() {
        assert!(!validate_webhook_token(Some("secret"), None, None));
        assert!(!validate_webhook_token(Some("secret"), Some("wrong"), None));
        assert!(validate_webhook_token(Some("secret"), Some("secret"), None));
        assert!(validate_webhook_token(Some("secret"), None, Some("secret")));
    }

    #[test]
    fn deduplicates_messages_and_resumes_only_an_exact_execution_target() {
        let mut ledger = WechatMessageLedger::default();
        assert!(!ledger.is_duplicate("msg-1"));
        assert!(ledger.is_duplicate("msg-1"));

        let target = execution_target();
        ledger.bind_session_at("wxid-a", &target, "session-a".to_string(), 100);
        assert_eq!(
            ledger
                .session_for_target_at("wxid-a", &target, 100)
                .as_deref(),
            Some("session-a"),
        );

        let mut changed_target = target.clone();
        changed_target.model = Some("gpt-5.6-terra".to_string());
        assert_eq!(
            ledger.session_for_target_at("wxid-a", &changed_target, 100),
            None
        );
    }

    #[test]
    fn expires_idle_route_but_keeps_legacy_route_compatible() {
        let target = execution_target();
        let mut ledger = WechatMessageLedger::default();
        ledger.bind_session_at("wxid-a", &target, "session-a".to_string(), 100);

        assert_eq!(
            ledger
                .session_for_target_at("wxid-a", &target, 100 + WECHAT_SESSION_IDLE_TTL_MS - 1)
                .as_deref(),
            Some("session-a"),
        );
        assert_eq!(
            ledger.session_for_target_at("wxid-a", &target, 100 + WECHAT_SESSION_IDLE_TTL_MS),
            None
        );

        let legacy_route = serde_json::json!({
            "sessionId": "legacy-session",
            "workspaceId": "workspace-a",
            "engine": "codex",
            "model": "gpt-5.6-sol",
            "modelCatalogEntryId": "codex:gpt-5.6-sol",
            "providerProfileId": "provider-a"
        });
        let route = serde_json::from_value::<PersistedWechatConversationRoute>(legacy_route)
            .expect("legacy route remains readable");
        assert_eq!(route.last_activity_at_ms, None);
        assert!(!route.is_expired(100 + WECHAT_SESSION_IDLE_TTL_MS * 2));
    }

    #[test]
    fn manual_session_reset_keeps_selected_target_and_clears_pending_selection() {
        let target = execution_target();
        let pending = serde_json::from_value::<PendingTargetSelection>(serde_json::json!({
            "kind": "workspace",
            "choices": [{ "id": "workspace-a", "label": "workspace-a" }]
        }))
        .expect("pending selection");
        let mut ledger = WechatMessageLedger::default();
        ledger.select_target("wxid-a", target.clone());
        ledger.bind_session_at("wxid-a", &target, "session-a".to_string(), 100);
        ledger.set_pending_selection("wxid-a", pending);

        assert!(ledger.reset_session("wxid-a"));
        assert_eq!(ledger.selected_target("wxid-a"), Some(target.clone()));
        assert_eq!(ledger.route_for("wxid-a"), None);
        assert_eq!(ledger.pending_selection("wxid-a"), None);
        assert!(!ledger.reset_session("wxid-a"));

        let mut legacy_like_ledger = WechatMessageLedger::default();
        legacy_like_ledger.bind_session_at("wxid-b", &target, "session-b".to_string(), 100);
        assert!(legacy_like_ledger.reset_session("wxid-b"));
        assert_eq!(legacy_like_ledger.selected_target("wxid-b"), Some(target));
    }

    #[test]
    fn persists_and_restores_session_and_message_ledger() {
        let root = std::env::temp_dir().join(format!("doge-wechat-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create test directory");
        let settings_path = root.join("settings.json");
        let mut ledger = WechatMessageLedger::default();
        assert!(!ledger.is_duplicate("message-1"));
        let target = execution_target();
        ledger.bind_session_at("wxid-a", &target, "session-a".to_string(), 100);
        persist_ledger(&settings_path, &ledger).expect("persist ledger");

        let mut restored = load_ledger(&settings_path).expect("load ledger");
        assert_eq!(
            restored
                .session_for_target_at("wxid-a", &target, 100)
                .as_deref(),
            Some("session-a"),
        );
        assert_eq!(
            restored
                .route_for("wxid-a")
                .map(|route| route.provider_profile_id.as_deref()),
            Some(Some("provider-a")),
        );
        assert!(restored.is_duplicate("message-1"));
        std::fs::remove_dir_all(root).expect("remove test directory");
    }

    #[test]
    fn persists_contact_targets_and_pending_selection_independently() {
        let root = std::env::temp_dir().join(format!("doge-wechat-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create test directory");
        let settings_path = root.join("settings.json");
        let target_a = execution_target();
        let mut target_b = target_a.clone();
        target_b.workspace_id = "workspace-b".to_string();
        target_b.model = Some("claude-sonnet-4-8".to_string());
        target_b.model_catalog_entry_id = Some("claude-sonnet-4-8".to_string());
        target_b.provider_profile_id = Some("provider-b".to_string());

        let pending_a = serde_json::from_value::<PendingTargetSelection>(serde_json::json!({
            "kind": "workspace",
            "choices": [{ "id": "workspace-c", "label": "Workspace C" }]
        }))
        .expect("deserialize pending selection");
        let mut ledger = WechatMessageLedger::default();
        ledger.select_target("wxid-a", target_a.clone());
        ledger.select_target("wxid-b", target_b.clone());
        ledger.set_pending_selection("wxid-a", pending_a.clone());
        persist_ledger(&settings_path, &ledger).expect("persist ledger");

        let restored = load_ledger(&settings_path).expect("load ledger");
        assert_eq!(restored.selected_target("wxid-a"), Some(target_a));
        assert_eq!(restored.selected_target("wxid-b"), Some(target_b));
        assert_eq!(restored.pending_selection("wxid-a"), Some(pending_a));
        assert_eq!(restored.pending_selection("wxid-b"), None);
        std::fs::remove_dir_all(root).expect("remove test directory");
    }

    #[test]
    fn uses_legacy_route_target_only_when_no_selected_target_exists() {
        let route_target = execution_target();
        let mut selected_target = route_target.clone();
        selected_target.model = Some("gpt-5.6-terra".to_string());
        selected_target.model_catalog_entry_id = Some("codex:gpt-5.6-terra".to_string());

        let mut ledger = WechatMessageLedger::default();
        ledger.bind_session_at("wxid-a", &route_target, "session-a".to_string(), 100);
        assert_eq!(ledger.selected_target("wxid-a"), Some(route_target));

        ledger.select_target("wxid-a", selected_target.clone());
        assert_eq!(ledger.selected_target("wxid-a"), Some(selected_target));
    }

    #[test]
    fn ignores_legacy_random_session_routes() {
        let root = std::env::temp_dir().join(format!("doge-wechat-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create test directory");
        let settings_path = root.join("settings.json");
        crate::storage::write_json_file(
            &ledger_path(&settings_path),
            &PersistedWechatLedger {
                routes: HashMap::new(),
                targets: HashMap::new(),
                pending_selections: HashMap::new(),
                sessions: HashMap::from([("wxid-a".to_string(), "random-v1".to_string())]),
                seen_msg_ids: Vec::new(),
            },
        )
        .expect("persist legacy ledger");

        let restored = load_ledger(&settings_path).expect("load ledger");
        assert_eq!(
            restored.session_for_target_at("wxid-a", &execution_target(), 100),
            None
        );
        std::fs::remove_dir_all(root).expect("remove test directory");
    }

    #[test]
    fn creates_user_visible_wechat_session_metadata() {
        let metadata = wechat_user_visible_session_metadata();
        assert_eq!(metadata.visibility, AutoSessionVisibility::UserVisible);
        assert_eq!(metadata.created_by, AutoSessionCreatedBy::User);
        assert_eq!(metadata.owner_feature, "wechat-channel");
        assert_eq!(metadata.session_purpose, "wechat-conversation");
        assert_eq!(metadata.auto_archive, Some(false));
    }

    #[test]
    fn extracts_canonical_session_id_from_sync_response() {
        assert_eq!(
            extract_sync_session_id(&serde_json::json!({ "sessionId": "native-thread-a" }))
                .as_deref(),
            Some("native-thread-a"),
        );
        assert_eq!(
            extract_sync_session_id(&serde_json::json!({ "text": "done" })),
            None
        );
    }

    #[test]
    fn extracts_typed_current_response_media() {
        let image_path = std::env::temp_dir()
            .join("doge-generated-image.png")
            .to_string_lossy()
            .into_owned();
        let video_path = std::env::temp_dir()
            .join("doge-generated-video.mp4")
            .to_string_lossy()
            .into_owned();
        let file_path = std::env::temp_dir()
            .join("doge-generated-report.pdf")
            .to_string_lossy()
            .into_owned();
        let voice_path = std::env::temp_dir()
            .join("doge-generated-voice.mp3")
            .to_string_lossy()
            .into_owned();
        let audio_file_path = std::env::temp_dir()
            .join("doge-generated-audio.wav")
            .to_string_lossy()
            .into_owned();
        let value = serde_json::json!({
            "text": "done",
            "images": [image_path, "data:image/png;base64,aGVsbG8=", "https://example.com/a.png"],
            "artifacts": [
                { "mediaType": "video/mp4", "locator": video_path },
                { "mediaType": "application/pdf", "locator": file_path, "fileName": "report.pdf" },
                { "mediaType": "audio/mpeg", "locator": voice_path },
                { "kind": "file", "mediaType": "audio/wav", "locator": audio_file_path, "fileName": "audio.wav" }
            ]
        });
        let media = extract_outbound_media(&value);
        assert_eq!(media.len(), 5);
        assert_eq!(media[0].kind, "image");
        assert_eq!(media[1].kind, "video");
        assert_eq!(media[2].kind, "file");
        assert_eq!(media[2].file_name.as_deref(), Some("report.pdf"));
        assert_eq!(media[3].kind, "voice");
        assert_eq!(media[4].kind, "file");
        assert_eq!(media[4].mime_type, "audio/wav");
        assert_eq!(media[4].file_name.as_deref(), Some("audio.wav"));
    }

    #[test]
    fn prepares_local_artifacts_for_every_engine_response() {
        let root =
            std::env::temp_dir().join(format!("doge-wechat-claude-{}", uuid::Uuid::new_v4()));
        let workspace = root.join("workspace");
        let app_data = root.join("app-data");
        std::fs::create_dir_all(&workspace).expect("create workspace");
        std::fs::create_dir_all(&app_data).expect("create app data");
        std::fs::write(workspace.join("report.pptx"), b"pptx bytes").expect("write pptx");
        std::fs::write(workspace.join("clip.mp4"), b"video bytes").expect("write mp4");
        std::fs::write(workspace.join("answer.wav"), b"wav bytes").expect("write wav");
        for engine in ["claude", "codex", "opencode", "kimi", "grok", "gemini"] {
            let response = serde_json::json!({
                "engine": engine,
                "sessionId": format!("{engine}-session"),
                "text": "已生成：[下载报告](report.pptx)\n[下载视频](clip.mp4)\n[下载音频](answer.wav)"
            });

            let (reply, media) = prepare_outbound_reply(&response, &workspace, &app_data);

            assert_eq!(reply, "已生成：", "engine={engine}");
            assert_eq!(media.len(), 3, "engine={engine}");
            assert_eq!(media[0].kind, "file", "engine={engine}");
            assert_eq!(
                media[0].file_name.as_deref(),
                Some("report.pptx"),
                "engine={engine}"
            );
            assert_eq!(media[1].kind, "video", "engine={engine}");
            assert_eq!(media[1].mime_type, "video/mp4", "engine={engine}");
            assert_eq!(media[2].kind, "file", "engine={engine}");
            assert_eq!(media[2].mime_type, "audio/wav", "engine={engine}");
        }
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn rejects_structured_media_outside_the_workspace_boundary() {
        let root = std::env::temp_dir().join(format!(
            "doge-wechat-structured-boundary-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = root.join("workspace");
        let app_data = root.join("app-data");
        std::fs::create_dir_all(&workspace).expect("create workspace");
        std::fs::create_dir_all(&app_data).expect("create app data");
        let outside = root.join("outside.pdf");
        std::fs::write(&outside, b"outside bytes").expect("write outside file");
        let response = serde_json::json!({
            "engine": "claude",
            "text": "已生成报告",
            "artifacts": [{
                "kind": "file",
                "mediaType": "application/pdf",
                "locator": outside
            }]
        });

        let (reply, media) = prepare_outbound_reply(&response, &workspace, &app_data);

        assert!(media.is_empty());
        assert!(reply.contains("已生成报告"));
        assert!(reply.contains("附件未发送：outside.pdf（文件不在允许目录内）"));
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn refuses_structured_media_when_workspace_is_unavailable() {
        let image_path = std::env::temp_dir().join("doge-unavailable-workspace-preview.png");
        let response = serde_json::json!({
            "engine": "gemini",
            "text": "已生成图片",
            "images": [image_path]
        });

        let (reply, media) = prepare_outbound_reply_without_workspace(&response);

        assert!(media.is_empty());
        assert_eq!(reply, "已生成图片\n[附件未发送：无法确认当前工作区]");
    }

    #[test]
    fn deduplicates_structured_and_markdown_media_for_codex_responses() {
        let root = std::env::temp_dir().join(format!("doge-wechat-codex-{}", uuid::Uuid::new_v4()));
        let workspace = root.join("workspace");
        let app_data = root.join("app-data");
        std::fs::create_dir_all(&workspace).expect("create workspace");
        std::fs::create_dir_all(&app_data).expect("create app data");
        let image_path = workspace.join("preview.png");
        std::fs::write(&image_path, b"png bytes").expect("write image");
        let response = serde_json::json!({
            "engine": "codex",
            "sessionId": "codex-session",
            "text": format!("![预览](<{}>)", image_path.display()),
            "images": [image_path.to_string_lossy()]
        });

        let (reply, media) = prepare_outbound_reply(&response, &workspace, &app_data);

        assert!(reply.is_empty());
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].kind, "image");
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn builds_image_media_request_without_changing_text_payload_shape() {
        let root = std::env::temp_dir().join(format!("doge-wechat-image-{}", uuid::Uuid::new_v4()));
        std::fs::write(&root, b"png bytes").expect("write test image");
        let media = WechatOutboundMedia {
            path: root.to_string_lossy().into_owned(),
            kind: "image".to_string(),
            mime_type: "image/png".to_string(),
            file_name: None,
        };
        let payload = build_outbound_media_payload("wxid-a", &media).expect("media payload");
        assert_eq!(payload.pointer("/to"), Some(&serde_json::json!("wxid-a")));
        assert_eq!(payload.pointer("/content"), Some(&serde_json::json!("")));
        assert_eq!(
            payload.pointer("/media/kind"),
            Some(&serde_json::json!("image"))
        );
        assert_eq!(
            payload.pointer("/media/mimeType"),
            Some(&serde_json::json!("image/png"))
        );
        assert_eq!(
            payload.pointer("/media/path"),
            Some(&serde_json::json!(root.to_string_lossy().to_string()))
        );
        std::fs::remove_file(root).expect("remove test image");
    }

    #[test]
    fn builds_video_and_file_requests_and_rejects_voice() {
        let root = std::env::temp_dir().join(format!("doge-wechat-media-{}", uuid::Uuid::new_v4()));
        std::fs::write(&root, b"media bytes").expect("write test media");
        let path = root.to_string_lossy().into_owned();

        let video = WechatOutboundMedia {
            path: path.clone(),
            kind: "video".to_string(),
            mime_type: "video/mp4".to_string(),
            file_name: Some("clip.mp4".to_string()),
        };
        let payload = build_outbound_media_payload("wxid-a", &video).expect("video payload");
        assert_eq!(
            payload.pointer("/media/kind"),
            Some(&serde_json::json!("video"))
        );
        assert_eq!(
            payload.pointer("/media/fileName"),
            Some(&serde_json::json!("clip.mp4"))
        );

        let file = WechatOutboundMedia {
            path: path.clone(),
            kind: "file".to_string(),
            mime_type: "application/pdf".to_string(),
            file_name: Some("report.pdf".to_string()),
        };
        let payload = build_outbound_media_payload("wxid-a", &file).expect("file payload");
        assert_eq!(
            payload.pointer("/media/kind"),
            Some(&serde_json::json!("file"))
        );

        let voice = WechatOutboundMedia {
            path,
            kind: "voice".to_string(),
            mime_type: "audio/mpeg".to_string(),
            file_name: Some("voice.mp3".to_string()),
        };
        let error = build_outbound_media_payload("wxid-a", &voice)
            .expect_err("voice must remain unsupported");
        assert!(error.contains("暂不支持发送语音"));
        std::fs::remove_file(root).expect("remove test media");
    }

    #[test]
    fn splits_unicode_reply_by_character_boundary() {
        let text = "中".repeat(MAX_MESSAGE_CHARS + 1);
        let chunks = split_reply(&text);
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].chars().count(), MAX_MESSAGE_CHARS);
        assert_eq!(chunks[1].chars().count(), 1);
    }

    #[test]
    fn parses_nested_bridge_message_and_ignores_group_marker_only_at_consumer() {
        let message = parse_inbound_message(serde_json::json!({
            "data": {
                "msg_id": "m1",
                "from_wxid": "wxid-a",
                "content": "hello",
                "is_group": true
            }
        }))
        .expect("valid message");
        assert_eq!(message.msg_id, "m1");
        assert_eq!(message.wxid, "wxid-a");
        assert!(message.is_group);
    }

    #[test]
    fn parses_image_attachment_without_text_and_exposes_engine_image_input() {
        let image = "data:image/png;base64,aGVsbG8=";
        let message = parse_inbound_message(serde_json::json!({
            "msgId": "image-1",
            "wxid": "wxid-a",
            "messageType": "image",
            "attachments": [{
                "kind": "image",
                "mimeType": "image/png",
                "dataUrl": image,
                "size": 5
            }]
        }))
        .expect("valid image message");
        assert_eq!(message.text, "收到一张微信图片，请描述图片内容。");
        assert_eq!(message.images, vec![image]);
        assert_eq!(
            message.attachments[0].mime_type.as_deref(),
            Some("image/png")
        );
    }

    #[test]
    fn parses_non_image_media_with_readable_fallback() {
        let message = parse_inbound_message(serde_json::json!({
            "msgId": "file-1",
            "wxid": "wxid-a",
            "messageType": "file",
            "attachments": [{
                "kind": "file",
                "mimeType": "application/pdf",
                "fileName": "report.pdf",
                "size": 1024
            }]
        }))
        .expect("valid file message");
        assert!(message.images.is_empty());
        assert!(message.text.contains("微信文件"));
        assert_eq!(
            message.attachments[0].file_name.as_deref(),
            Some("report.pdf")
        );
    }

    #[test]
    fn validates_managed_attachment_and_builds_wechat_only_prompt() {
        let root = std::env::temp_dir().join(format!("doge-wechat-inbox-{}", uuid::Uuid::new_v4()));
        let managed = root.join("wechat-bridge").join(WECHAT_INBOUND_MEDIA_DIR);
        std::fs::create_dir_all(&managed).expect("create managed inbox");
        let image_path = managed.join("photo.png");
        std::fs::write(&image_path, b"png bytes").expect("write inbound image");
        let mut attachments = vec![WechatMediaAttachment {
            kind: "image".to_string(),
            mime_type: Some("image/png".to_string()),
            file_name: Some("photo.png".to_string()),
            data_url: None,
            url: None,
            size: None,
            path: Some(image_path.to_string_lossy().into_owned()),
        }];

        validate_inbound_attachment_paths(&mut attachments, &managed).expect("managed attachment");
        let (prompt, images) =
            prepare_inbound_engine_input("看一下这张图", &attachments, Vec::new());

        assert!(prompt.starts_with("看一下这张图\n\n[微信附件"));
        assert!(prompt.contains("\"localPath\""));
        let attachment_json = prompt.lines().last().expect("attachment JSON");
        let attachment: Value = serde_json::from_str(attachment_json).expect("valid JSON");
        let canonical_image = std::fs::canonicalize(&image_path)
            .expect("canonical image")
            .to_string_lossy()
            .into_owned();
        assert_eq!(
            attachment.get("localPath").and_then(Value::as_str),
            Some(canonical_image.as_str())
        );
        assert_eq!(
            images,
            Some(vec!["data:image/png;base64,cG5nIGJ5dGVz".to_string()])
        );
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn text_only_engine_input_is_byte_for_byte_unchanged() {
        let original = "普通桌面/微信文本保持原样\n第二行";
        let (prompt, images) = prepare_inbound_engine_input(original, &[], Vec::new());
        assert_eq!(prompt, original);
        assert_eq!(images, None);
    }

    #[test]
    fn inbound_attachment_paths_fail_closed_outside_managed_root() {
        let root =
            std::env::temp_dir().join(format!("doge-wechat-escape-{}", uuid::Uuid::new_v4()));
        let managed = root.join("wechat-bridge").join(WECHAT_INBOUND_MEDIA_DIR);
        std::fs::create_dir_all(&managed).expect("create managed inbox");
        let outside = root.join("outside.pdf");
        std::fs::write(&outside, b"outside").expect("write outside file");
        let mut attachments = vec![WechatMediaAttachment {
            kind: "file".to_string(),
            mime_type: Some("application/pdf".to_string()),
            file_name: Some("outside.pdf".to_string()),
            data_url: None,
            url: None,
            size: None,
            path: Some(outside.to_string_lossy().into_owned()),
        }];

        let error = validate_inbound_attachment_paths(&mut attachments, &managed)
            .expect_err("outside path must fail");
        assert!(error.contains("outside managed storage"));
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn inbound_attachment_paths_reject_empty_and_oversized_files() {
        let root = std::env::temp_dir().join(format!("doge-wechat-size-{}", uuid::Uuid::new_v4()));
        let managed = root.join("wechat-bridge").join(WECHAT_INBOUND_MEDIA_DIR);
        std::fs::create_dir_all(&managed).expect("create managed inbox");
        let empty = managed.join("empty.bin");
        std::fs::write(&empty, []).expect("write empty file");
        let oversized = managed.join("oversized.bin");
        std::fs::File::create(&oversized)
            .expect("create oversized file")
            .set_len(MAX_WECHAT_INBOUND_MEDIA_BYTES + 1)
            .expect("set sparse size");

        for (path, expected) in [(empty, "non-empty"), (oversized, "too large")] {
            let mut attachments = vec![WechatMediaAttachment {
                kind: "file".to_string(),
                mime_type: None,
                file_name: None,
                data_url: None,
                url: None,
                size: None,
                path: Some(path.to_string_lossy().into_owned()),
            }];
            let error = validate_inbound_attachment_paths(&mut attachments, &managed)
                .expect_err("invalid file must fail");
            assert!(error.contains(expected));
        }
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn text_only_messages_do_not_enable_engine_image_mode() {
        assert_eq!(optional_engine_images(Vec::new()), None);
        assert_eq!(
            optional_engine_images(vec!["data:image/png;base64,aGVsbG8=".to_string()]),
            Some(vec!["data:image/png;base64,aGVsbG8=".to_string()])
        );
    }

    #[test]
    fn wechat_access_mode_inherits_explicit_defaults_and_bounds_legacy_values() {
        for access_mode in ["full-access", "current", "read-only"] {
            assert_eq!(resolve_wechat_access_mode(access_mode), access_mode);
        }
        for access_mode in ["default", "", "unknown", "  default  "] {
            assert_eq!(resolve_wechat_access_mode(access_mode), "current");
        }
    }

    #[test]
    fn rejects_invalid_or_oversized_image_data_urls() {
        let invalid = parse_inbound_message(serde_json::json!({
            "msgId": "image-2",
            "wxid": "wxid-a",
            "images": ["data:image/png;base64,not-valid"]
        }))
        .expect_err("invalid image must be rejected");
        assert!(invalid.contains("image data URL is invalid"));

        let oversized = parse_inbound_message(serde_json::json!({
            "msgId": "image-3",
            "wxid": "wxid-a",
            "images": [format!(
                "data:image/png;base64,{}",
                "A".repeat((MAX_WECHAT_IMAGE_BYTES * 4 / 3) + 8)
            )]
        }))
        .expect_err("oversized image must be rejected");
        assert!(oversized.contains("image payload is too large"));
    }

    #[test]
    fn normalizes_legacy_fields_to_internal_bridge_defaults() {
        let settings = normalize_settings(WechatChannelSettings {
            bridge_base_url: "https://old-bridge.example".to_string(),
            webhook_host: "0.0.0.0".to_string(),
            webhook_port: 1234,
            webhook_path: "/old-path".to_string(),
            device_type: "mac".to_string(),
            ..Default::default()
        })
        .expect("settings normalize");
        assert_eq!(settings.bridge_base_url, "http://127.0.0.1:18789");
        assert_eq!(settings.webhook_host, "127.0.0.1");
        assert_eq!(settings.webhook_port, 18790);
        assert_eq!(settings.webhook_path, "/webhook/wechat");
        assert_eq!(settings.device_type, "ipad");
        assert!(normalize_settings(WechatChannelSettings {
            enabled: true,
            bridge_base_url: "http://127.0.0.1:18789".to_string(),
            risk_acknowledged: false,
            ..Default::default()
        })
        .is_err());
    }

    #[test]
    fn channel_settings_do_not_require_a_global_execution_target() {
        let settings = normalize_settings(WechatChannelSettings {
            enabled: true,
            risk_acknowledged: true,
            ..Default::default()
        })
        .expect("channel settings without target");

        assert_eq!(settings.workspace_id, None);
        assert_eq!(settings.engine, None);
        assert_eq!(settings.model, None);
        assert_eq!(settings.model_catalog_entry_id, None);
        assert_eq!(settings.provider_profile_id, None);
    }

    #[test]
    fn parses_plain_and_nested_qrcode_responses() {
        assert_eq!(
            parse_qrcode_response(Value::String("data:image/png;base64,qr".to_string()))
                .unwrap()
                .value,
            "data:image/png;base64,qr"
        );
        let nested = parse_qrcode_response(serde_json::json!({
            "data": { "qrCode": "https://bridge.test/qr", "expiresAt": "soon" }
        }))
        .expect("nested QR response");
        assert_eq!(nested.value, "https://bridge.test/qr");
        assert_eq!(nested.expires_at.as_deref(), Some("soon"));

        let bundled_sidecar = parse_qrcode_response(serde_json::json!({
            "value": "https://ilinkai.weixin.qq.com/x/qr",
            "expiresAt": "1770000000000"
        }))
        .expect("bundled sidecar QR response");
        assert_eq!(bundled_sidecar.value, "https://ilinkai.weixin.qq.com/x/qr");
        assert_eq!(bundled_sidecar.expires_at.as_deref(), Some("1770000000000"));
    }

    #[test]
    fn maps_tencent_login_status_and_preserves_provider_message() {
        let status = parse_login_status_response(serde_json::json!({
            "status": "need_verify",
            "message": "请输入手机微信显示的数字验证码"
        }))
        .expect("valid login status");
        assert_eq!(status.state, WechatLoginState::NeedVerification);
        assert_eq!(status.message, "请输入手机微信显示的数字验证码");

        let scanned = parse_login_status_response(serde_json::json!({
            "data": { "status": "scaned", "message": "请确认登录" }
        }))
        .expect("nested login status");
        assert_eq!(scanned.state, WechatLoginState::AwaitingConfirmation);
        assert_eq!(scanned.message, "请确认登录");
    }

    #[test]
    fn validates_tencent_login_verification_code() {
        assert_eq!(validate_login_verification_code(" 123456 "), Ok("123456"));
        assert!(validate_login_verification_code("").is_err());
        assert!(validate_login_verification_code("12a4").is_err());
        assert!(validate_login_verification_code("123456789").is_err());
    }

    #[test]
    fn validates_exact_bundled_bridge_health_identity() {
        assert!(validate_bundled_bridge_health(serde_json::json!({
            "ok": true,
            "provider": BUNDLED_BRIDGE_PROVIDER,
            "providerVersion": BUNDLED_BRIDGE_PROVIDER_VERSION,
            "providerIntegrity": BUNDLED_BRIDGE_PROVIDER_INTEGRITY
        }))
        .is_ok());

        let legacy = validate_bundled_bridge_health(serde_json::json!({
            "ok": true,
            "provider": "openclaw-wechat",
            "providerVersion": "legacy",
            "providerIntegrity": "unknown"
        }))
        .expect_err("legacy provider must not satisfy readiness");
        assert!(legacy.contains("旧版或不兼容"));
    }
}
