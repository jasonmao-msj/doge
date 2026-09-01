use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Bytes;
use axum::extract::{Query, State as AxumState};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
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

mod target_commands;

use target_commands::{handle_target_control_message, PendingTargetSelection};

const MAX_MESSAGE_CHARS: usize = 1800;
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
    pub(crate) is_group: bool,
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
    fn session_for_target(&self, wxid: &str, target: &WechatExecutionTarget) -> Option<String> {
        self.routes
            .get(wxid.trim())
            .filter(|route| route.matches_target(target))
            .map(|route| route.session_id.clone())
    }

    fn bind_session(&mut self, wxid: &str, target: &WechatExecutionTarget, session_id: String) {
        self.routes.insert(
            wxid.trim().to_string(),
            PersistedWechatConversationRoute::from_target(target, session_id),
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
}

impl PersistedWechatConversationRoute {
    fn from_target(target: &WechatExecutionTarget, session_id: String) -> Self {
        Self {
            session_id,
            workspace_id: target.workspace_id.clone(),
            engine: target.engine_name().to_string(),
            model: target.model.clone(),
            model_catalog_entry_id: target.model_catalog_entry_id.clone(),
            provider_profile_id: target.provider_profile_id.clone(),
        }
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
    let text = first_string(data, &["text", "content", "message"]);
    let msg_id = first_string(data, &["msgId", "msg_id", "id"]);
    let wxid = first_string(data, &["wxid", "fromWxid", "from_wxid", "sender"]);
    let message_type = first_string(data, &["type", "messageType", "message_type"])
        .unwrap_or_else(|| "text".to_string());
    let is_group = data
        .get("isGroup")
        .or_else(|| data.get("is_group"))
        .and_then(Value::as_bool)
        .unwrap_or_else(|| wxid.as_deref().is_some_and(|id| id.contains("@chatroom")));

    let msg_id = msg_id.ok_or_else(|| "wechat webhook rejected: msgId is required".to_string())?;
    let wxid = wxid.ok_or_else(|| "wechat webhook rejected: wxid is required".to_string())?;
    let text = text.ok_or_else(|| "wechat webhook rejected: text is required".to_string())?;
    if msg_id.trim().is_empty() || wxid.trim().is_empty() {
        return Err("wechat webhook rejected: msgId and wxid are required".to_string());
    }
    Ok(WechatInboundMessage {
        msg_id,
        wxid,
        text,
        message_type,
        is_group,
    })
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
    let message = match parse_inbound_message(payload) {
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
        let existing_session_id = state
            .wechat
            .ledger
            .lock()
            .await
            .session_for_target(&wxid_for_task, &target);
        let continue_session = existing_session_id.is_some();
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
            text_for_task.clone(),
            Some(target.engine),
            target.model.clone(),
            None,
            Some(false),
            None,
            None,
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
                {
                    let mut ledger = state.wechat.ledger.lock().await;
                    let ledger_before = ledger.clone();
                    ledger.bind_session(&wxid_for_task, &target, session_id.clone());
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
                if let Some(reply) = crate::engine::extract_turn_result_text(Some(&response)) {
                    if let Err(error) = send_reply_with_state(&state, &wxid_for_task, &reply).await
                    {
                        log::error!("[wechat] reply delivery failed: {error}");
                    }
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
        let response = self
            .client
            .post(format!("{}/message/send", self.base_url))
            .header("x-api-key", &self.api_key)
            .bearer_auth(&self.api_key)
            .json(&serde_json::json!({ "to": wxid, "content": content }))
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
    let chunks = split_reply(text);
    if chunks.is_empty() {
        return Ok(0);
    }
    let client = bridge_client_for_state(state).await?;
    for chunk in &chunks {
        client.send_text(wxid, chunk).await?;
    }
    Ok(chunks.len())
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
        ledger.bind_session("wxid-a", &target, "session-a".to_string());
        assert_eq!(
            ledger.session_for_target("wxid-a", &target).as_deref(),
            Some("session-a"),
        );

        let mut changed_target = target.clone();
        changed_target.model = Some("gpt-5.6-terra".to_string());
        assert_eq!(ledger.session_for_target("wxid-a", &changed_target), None);
    }

    #[test]
    fn persists_and_restores_session_and_message_ledger() {
        let root = std::env::temp_dir().join(format!("doge-wechat-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create test directory");
        let settings_path = root.join("settings.json");
        let mut ledger = WechatMessageLedger::default();
        assert!(!ledger.is_duplicate("message-1"));
        let target = execution_target();
        ledger.bind_session("wxid-a", &target, "session-a".to_string());
        persist_ledger(&settings_path, &ledger).expect("persist ledger");

        let mut restored = load_ledger(&settings_path).expect("load ledger");
        assert_eq!(
            restored.session_for_target("wxid-a", &target).as_deref(),
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
        ledger.bind_session("wxid-a", &route_target, "session-a".to_string());
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
            restored.session_for_target("wxid-a", &execution_target()),
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
