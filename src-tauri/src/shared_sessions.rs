use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::app_paths;
use crate::codex;
use crate::engine::{self, EngineType};
use crate::shared::codex_core;
use crate::shared_event_log::{SessionTargetUpdate, SharedEventWriter};
use crate::state::AppState;

const SHARED_SESSIONS_DIRNAME: &str = "shared-sessions";
const SHARED_STORE_LOCK_WAIT_TIMEOUT: Duration = Duration::from_secs(5);
const SHARED_STORE_LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(25);
const SHARED_STORE_LOCK_STALE_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_DELTA_SYNC_TURNS: usize = 8;
const MAX_DELTA_SYNC_CHARS: usize = 4_000;
const SHARED_SESSION_SCHEMA_VERSION: u32 = 2;

fn codex_turn_developer_instructions(settings: &crate::types::AppSettings) -> Option<String> {
    crate::backend::app_server_cli::codex_generated_developer_instructions_for_turn(settings)
}

fn is_supported_shared_session_engine(engine: EngineType) -> bool {
    matches!(
        engine,
        EngineType::Claude
            | EngineType::Codex
            | EngineType::Kimi
            | EngineType::Grok
            | EngineType::OpenCode
    )
}

fn normalize_shared_session_engine(engine: EngineType) -> EngineType {
    if is_supported_shared_session_engine(engine) {
        engine
    } else {
        EngineType::Claude
    }
}

pub(crate) fn ensure_supported_shared_session_engine(
    engine: EngineType,
) -> Result<EngineType, String> {
    if is_supported_shared_session_engine(engine) {
        Ok(engine)
    } else {
        Err(format!(
            "Unsupported shared session engine: {}",
            engine.icon()
        ))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SharedEngineBinding {
    engine: EngineType,
    native_thread_id: String,
    created_at: u64,
    last_used_at: u64,
    last_synced_turn_seq: u64,
}

/// Target 级 Binding（Wave 4 / B.2）：Binding Key = Engine + ProviderProfile。
/// `provider_profile_id = None` 表示 default/local Provider 语义（旧 V0 binding 的归位点）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SharedTargetBindingMeta {
    pub(crate) binding_key: String,
    pub(crate) engine: EngineType,
    pub(crate) provider_profile_id: Option<String>,
    pub(crate) native_thread_id: String,
    pub(crate) created_at: u64,
    pub(crate) last_used_at: u64,
    pub(crate) last_synced_turn_seq: u64,
    /// ready / missing-provider / missing-runtime / degraded / recovery-required。
    #[serde(default = "default_target_binding_availability")]
    pub(crate) availability: String,
}

fn default_target_binding_availability() -> String {
    "ready".to_string()
}

fn normalize_provider_selection_source(value: Option<String>) -> Option<String> {
    value
        .map(|source| source.trim().to_string())
        .filter(|source| matches!(source.as_str(), "disk" | "managed"))
}

/// 当前选中的 Execution Target（Wave 4 / B.2 任务 2.3）。
/// `provider_profile_id = None` 表示 default/local Provider 语义。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SharedSelectedReasoning {
    pub(crate) effort: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SharedSelectedTarget {
    pub(crate) engine: EngineType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_profile_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) model_catalog_entry_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) reasoning: Option<SharedSelectedReasoning>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_profile_name_snapshot: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_profile_source: Option<String>,
}

fn normalize_shared_selected_target(mut target: SharedSelectedTarget) -> SharedSelectedTarget {
    target.provider_profile_id = target
        .provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    target.model_catalog_entry_id = target
        .model_catalog_entry_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    target.model = target
        .model
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    target.reasoning = target.reasoning.and_then(|mut reasoning| {
        reasoning.effort = reasoning.effort.trim().to_string();
        (!reasoning.effort.is_empty()).then_some(reasoning)
    });
    target.provider_profile_name_snapshot = target
        .provider_profile_name_snapshot
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    target.provider_profile_source =
        normalize_provider_selection_source(target.provider_profile_source);
    target
}

fn legacy_engine_only_selected_target(engine: EngineType) -> SharedSelectedTarget {
    SharedSelectedTarget {
        engine,
        provider_profile_id: None,
        model_catalog_entry_id: None,
        model: None,
        reasoning: None,
        provider_profile_name_snapshot: None,
        provider_profile_source: None,
    }
}

fn is_legacy_engine_only_selected_target(target: &SharedSelectedTarget) -> bool {
    target.provider_profile_id.is_none()
        && target.model_catalog_entry_id.is_none()
        && target.model.is_none()
        && target.reasoning.is_none()
        && target.provider_profile_name_snapshot.is_none()
        && target.provider_profile_source.is_none()
}

fn validate_resolved_shared_selected_target(target: &SharedSelectedTarget) -> Result<(), String> {
    let engine = ensure_supported_shared_session_engine(target.engine)?;
    let provider_profile_id = target.provider_profile_id.as_deref();
    let expected_source = if provider_profile_id.is_some() {
        "managed"
    } else {
        "disk"
    };
    if target.provider_profile_source.as_deref() != Some(expected_source) {
        return Err(format!(
            "invalid-shared-target: provider source must be '{expected_source}'"
        ));
    }
    if target.provider_profile_name_snapshot.is_none() {
        return Err("invalid-shared-target: provider name snapshot is required".to_string());
    }
    if target.model_catalog_entry_id.is_none() || target.model.is_none() {
        return Err(
            "invalid-shared-target: modelCatalogEntryId and runtime model are required".to_string(),
        );
    }
    let models = match provider_profile_id {
        Some(provider_profile_id) => crate::engine::status::get_provider_scoped_engine_models(
            engine,
            Some(provider_profile_id),
        )?,
        None => crate::engine::status::get_local_engine_models_for_validation(engine),
    }
    .ok_or_else(|| {
        format!(
            "invalid-shared-target: model catalog is unavailable for {} provider {}",
            engine.icon(),
            provider_profile_id.unwrap_or("default")
        )
    })?;
    // 不限制用户模型名：catalog 未登记的自定义模型也允许保存为 next-send target。
    crate::engine::status::validate_model_catalog_pair(
        target.model_catalog_entry_id.as_deref(),
        target.model.as_deref(),
        &models,
        crate::engine::status::UnlistedRuntimeModelPolicy::Allow,
    )
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SharedSessionMeta {
    #[serde(default = "default_shared_session_schema_version")]
    pub(crate) schema_version: u32,
    pub(crate) id: String,
    pub(crate) workspace_id: String,
    pub(crate) title: String,
    pub(crate) created_at: u64,
    pub(crate) updated_at: u64,
    /// V0 字段：保留写（= `selected_target.engine`），供回滚与旧版本读取。
    selected_engine: EngineType,
    /// Wave 4 起持久化；旧 meta 缺失时由 sanitize 从 `selected_engine` 迁移。
    #[serde(default)]
    pub(crate) selected_target: Option<SharedSelectedTarget>,
    pub(crate) last_turn_seq: u64,
    pub(crate) bindings_by_engine: HashMap<EngineType, SharedEngineBinding>,
    /// Wave 4 起持久化；旧 meta 缺失时由 sanitize 从 `bindings_by_engine` 迁移。
    #[serde(default)]
    pub(crate) bindings_by_target: HashMap<String, SharedTargetBindingMeta>,
}

fn default_shared_session_schema_version() -> u32 {
    SHARED_SESSION_SCHEMA_VERSION
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SharedSessionSnapshotEntry {
    kind: String,
    created_at: u64,
    selected_engine: EngineType,
    last_turn_seq: u64,
    pub(crate) items: Vec<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SharedSessionSummary {
    pub(crate) id: String,
    pub(crate) thread_id: String,
    pub(crate) title: String,
    pub(crate) updated_at: u64,
    pub(crate) selected_engine: EngineType,
    pub(crate) thread_kind: String,
    pub(crate) engine_source: EngineType,
    pub(crate) selected_engine_label: String,
    pub(crate) native_thread_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SharedSessionLoadPayload {
    id: String,
    thread_id: String,
    title: String,
    selected_engine: EngineType,
    thread_kind: String,
    engine_source: EngineType,
    selected_target: Option<SharedSelectedTarget>,
    items: Vec<Value>,
    updated_at: u64,
}

struct SharedStoreFileLock {
    path: PathBuf,
}

impl Drop for SharedStoreFileLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn shared_store_lock_file_path(path: &Path) -> PathBuf {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!("{value}.lock"))
        .unwrap_or_else(|| "lock".to_string());
    path.with_extension(extension)
}

fn is_shared_store_lock_stale(lock_path: &Path) -> bool {
    let metadata = match std::fs::metadata(lock_path) {
        Ok(metadata) => metadata,
        Err(_) => return false,
    };
    let modified_at = match metadata.modified() {
        Ok(modified_at) => modified_at,
        Err(_) => return false,
    };
    match modified_at.elapsed() {
        Ok(elapsed) => elapsed > SHARED_STORE_LOCK_STALE_TIMEOUT,
        Err(_) => false,
    }
}

fn acquire_shared_store_lock(path: &Path) -> Result<SharedStoreFileLock, String> {
    let lock_path = shared_store_lock_file_path(path);
    if let Some(parent) = lock_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let deadline = Instant::now() + SHARED_STORE_LOCK_WAIT_TIMEOUT;
    loop {
        match std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&lock_path)
        {
            Ok(mut file) => {
                let _ = writeln!(file, "pid={}", std::process::id());
                return Ok(SharedStoreFileLock { path: lock_path });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if is_shared_store_lock_stale(&lock_path) {
                    let _ = std::fs::remove_file(&lock_path);
                    continue;
                }
                if Instant::now() >= deadline {
                    return Err(format!(
                        "Timed out waiting for shared session file lock: {}",
                        lock_path.display()
                    ));
                }
                thread::sleep(SHARED_STORE_LOCK_RETRY_INTERVAL);
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn with_shared_store_lock<T>(
    path: &Path,
    op: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _lock_guard = acquire_shared_store_lock(path)?;
    op()
}

fn write_string_atomically(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("Shared session path has no parent: {}", path.display()))?;
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            format!(
                "Shared session path has invalid filename: {}",
                path.display()
            )
        })?;
    let temp_path = parent.join(format!(".{filename}.{}.tmp", Uuid::new_v4()));
    let mut temp_file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .map_err(|error| error.to_string())?;
    temp_file
        .write_all(content.as_bytes())
        .map_err(|error| error.to_string())?;
    temp_file.sync_all().map_err(|error| error.to_string())?;

    #[cfg(target_os = "windows")]
    if path.exists() {
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
    }

    if let Err(error) = std::fs::rename(&temp_path, path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(error.to_string());
    }
    Ok(())
}

pub(crate) fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64
}

fn shared_sessions_root_dir() -> Result<PathBuf, String> {
    Ok(app_paths::app_home_dir()?.join(SHARED_SESSIONS_DIRNAME))
}

fn workspace_shared_sessions_dir(workspace_id: &str) -> Result<PathBuf, String> {
    Ok(shared_sessions_root_dir()?.join(workspace_id))
}

fn shared_session_dir(workspace_id: &str, shared_session_id: &str) -> Result<PathBuf, String> {
    Ok(workspace_shared_sessions_dir(workspace_id)?.join(shared_session_id))
}

fn shared_session_meta_path(
    workspace_id: &str,
    shared_session_id: &str,
) -> Result<PathBuf, String> {
    Ok(shared_session_dir(workspace_id, shared_session_id)?.join("meta.json"))
}

fn shared_session_log_path(workspace_id: &str, shared_session_id: &str) -> Result<PathBuf, String> {
    Ok(shared_session_dir(workspace_id, shared_session_id)?.join("log.jsonl"))
}

pub(crate) fn shared_session_projection_source(
    workspace_id: &str,
    thread_id: &str,
) -> Result<(String, PathBuf), String> {
    let shared_session_id = parse_shared_session_id(thread_id)?;
    let log_path = shared_session_log_path(workspace_id, &shared_session_id)?;
    Ok((shared_session_id, log_path))
}

fn shared_thread_id(shared_session_id: &str) -> String {
    format!("shared:{shared_session_id}")
}

fn is_safe_shared_session_storage_id(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
}

pub(crate) fn parse_shared_session_id(thread_id: &str) -> Result<String, String> {
    let normalized = thread_id.trim();
    if let Some(rest) = normalized.strip_prefix("shared:") {
        let shared_session_id = rest.trim();
        if is_safe_shared_session_storage_id(shared_session_id) {
            return Ok(shared_session_id.to_string());
        }
    }
    Err(format!("Invalid shared session thread id: {thread_id}"))
}

fn validate_shared_native_thread_id(value: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        Err("Shared session native thread id cannot be empty".to_string())
    } else {
        Ok(normalized.to_string())
    }
}

pub(crate) fn is_pending_shared_binding_thread_id(engine: EngineType, thread_id: &str) -> bool {
    let normalized = thread_id.trim();
    if normalized.is_empty() {
        return true;
    }
    match engine {
        EngineType::Claude => normalized.starts_with("claude-pending-shared-"),
        EngineType::Codex => normalized.starts_with("codex-pending-shared-"),
        EngineType::Kimi => normalized.starts_with("kimi-pending-shared-"),
        EngineType::Grok => normalized.starts_with("grok-pending-shared-"),
        EngineType::OpenCode => normalized.starts_with("opencode-pending-shared-"),
        EngineType::Gemini => false,
    }
}

pub(crate) fn binding_uses_established_native_thread(engine: EngineType, thread_id: &str) -> bool {
    let normalized = thread_id.trim();
    if normalized.is_empty() || is_pending_shared_binding_thread_id(engine, normalized) {
        return false;
    }
    // 兼容 `engine:{raw}` 与历史 raw id；strip 前缀后再判 pending。
    let raw = match engine {
        EngineType::Claude | EngineType::Kimi | EngineType::Grok | EngineType::OpenCode => {
            let prefix = format!("{}:", engine.icon());
            normalized
                .strip_prefix(prefix.as_str())
                .unwrap_or(normalized)
                .trim()
        }
        EngineType::Codex | EngineType::Gemini => normalized,
    };
    if raw.is_empty() || is_pending_shared_binding_thread_id(engine, raw) {
        return false;
    }
    match engine {
        EngineType::Claude => normalized.contains(':'),
        EngineType::Codex | EngineType::Kimi | EngineType::Grok | EngineType::OpenCode => true,
        EngineType::Gemini => false,
    }
}

pub(crate) fn engine_binding_thread_id(engine: EngineType, seed: &str) -> String {
    match engine {
        EngineType::Claude => format!("claude-pending-shared-{seed}"),
        EngineType::Codex => format!("codex-pending-shared-{seed}"),
        EngineType::Kimi => format!("kimi-pending-shared-{seed}"),
        EngineType::Grok => format!("grok-pending-shared-{seed}"),
        EngineType::OpenCode => format!("opencode-pending-shared-{seed}"),
        EngineType::Gemini => format!("gemini-pending-shared-{seed}"),
    }
}

/// Binding Key = Engine + ProviderProfile（Model 不进 Key）。
/// 与前端 `bindingKeyOf` 保持一致：`{engine}:{provider|"default"}`。
pub(crate) fn shared_target_binding_key(
    engine: EngineType,
    provider_profile_id: Option<&str>,
) -> String {
    let provider = provider_profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    format!("{}:{}", engine.icon(), provider.unwrap_or("default"))
}

fn sanitize_shared_session_meta(meta: &mut SharedSessionMeta) {
    meta.schema_version = SHARED_SESSION_SCHEMA_VERSION;
    // 任务 2.3：`selectedEngine → selectedTarget` 迁移；selectedTarget 为权威，
    // selected_engine 回落为 target.engine（V0 回滚读取兼容）。
    let mut selected_target = match meta.selected_target.take() {
        Some(mut target) => {
            if !is_supported_shared_session_engine(target.engine) {
                target.engine = normalize_shared_session_engine(target.engine);
                target.provider_profile_id = None;
                target.model_catalog_entry_id = None;
                target.model = None;
                target.reasoning = None;
                target.provider_profile_name_snapshot = None;
                target.provider_profile_source = None;
            }
            target.provider_profile_id = target
                .provider_profile_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            target
        }
        None => SharedSelectedTarget {
            engine: normalize_shared_session_engine(meta.selected_engine),
            provider_profile_id: None,
            model_catalog_entry_id: None,
            model: None,
            reasoning: None,
            provider_profile_name_snapshot: None,
            provider_profile_source: None,
        },
    };
    selected_target.model_catalog_entry_id = selected_target
        .model_catalog_entry_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    selected_target.model = selected_target
        .model
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    selected_target.reasoning = selected_target.reasoning.and_then(|mut reasoning| {
        reasoning.effort = reasoning.effort.trim().to_string();
        (!reasoning.effort.is_empty()).then_some(reasoning)
    });
    selected_target.provider_profile_name_snapshot = selected_target
        .provider_profile_name_snapshot
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    selected_target.provider_profile_source =
        normalize_provider_selection_source(selected_target.provider_profile_source);
    meta.selected_engine = selected_target.engine;
    meta.selected_target = Some(selected_target);
    meta.bindings_by_engine
        .retain(|engine, _| is_supported_shared_session_engine(*engine));
    for (engine, binding) in meta.bindings_by_engine.iter_mut() {
        binding.engine = *engine;
    } // B.2 迁移：旧 `bindings_by_engine` 归位到 default-provider 语义。
      // V0 仍是 default binding 身份字段的权威来源（回滚兼容），
      // 因此 default key 的身份字段以 engine binding 为准做覆盖式同步；
      // managed-provider 条目（provider_profile_id != None）不受此影响。
    meta.bindings_by_target.retain(|key, binding| {
        key == &binding.binding_key && is_supported_shared_session_engine(binding.engine)
    });
    for (engine, binding) in meta.bindings_by_engine.iter() {
        let key = shared_target_binding_key(*engine, None);
        match meta.bindings_by_target.get_mut(&key) {
            Some(target) => {
                target.engine = *engine;
                target.provider_profile_id = None;
                target.native_thread_id = binding.native_thread_id.clone();
                target.created_at = binding.created_at;
                target.last_used_at = binding.last_used_at;
                target.last_synced_turn_seq = binding.last_synced_turn_seq;
            }
            None => {
                meta.bindings_by_target.insert(
                    key.clone(),
                    SharedTargetBindingMeta {
                        binding_key: key,
                        engine: *engine,
                        provider_profile_id: None,
                        native_thread_id: binding.native_thread_id.clone(),
                        created_at: binding.created_at,
                        last_used_at: binding.last_used_at,
                        last_synced_turn_seq: binding.last_synced_turn_seq,
                        availability: default_target_binding_availability(),
                    },
                );
            }
        }
    }
    // default binding 在 engine map 中已不存在时，target map 也不应残留（例如 sanitize 剔除不支持 engine）。
    let live_default_keys: std::collections::HashSet<String> = meta
        .bindings_by_engine
        .keys()
        .map(|engine| shared_target_binding_key(*engine, None))
        .collect();
    meta.bindings_by_target.retain(|key, binding| {
        binding.provider_profile_id.is_some() || live_default_keys.contains(key)
    });
}

/// 更新选中 Target（同时写 V0 `selected_engine` 保持回滚兼容）。
pub(crate) fn select_meta_target(
    meta: &mut SharedSessionMeta,
    engine: EngineType,
    provider_profile_id: Option<String>,
) {
    let provider_profile_id = provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let preserved = meta.selected_target.take().filter(|target| {
        target.engine == engine && target.provider_profile_id == provider_profile_id
    });
    meta.selected_engine = engine;
    meta.selected_target = Some(preserved.unwrap_or(SharedSelectedTarget {
        engine,
        provider_profile_id,
        model_catalog_entry_id: None,
        model: None,
        reasoning: None,
        provider_profile_name_snapshot: None,
        provider_profile_source: None,
    }));
}

fn apply_selected_target_selection(
    root: &mut Value,
    target: &SharedSelectedTarget,
    updated_at: u64,
) -> Result<(), String> {
    let object = root
        .as_object_mut()
        .ok_or_else(|| "Shared session metadata must be a JSON object".to_string())?;
    object.insert(
        "selectedEngine".to_string(),
        serde_json::to_value(target.engine).map_err(|error| error.to_string())?,
    );
    object.insert(
        "selectedTarget".to_string(),
        serde_json::to_value(target).map_err(|error| error.to_string())?,
    );
    object.insert("updatedAt".to_string(), json!(updated_at));
    Ok(())
}

fn write_shared_session_selection(
    workspace_id: &str,
    shared_session_id: &str,
    target: &SharedSelectedTarget,
    updated_at: u64,
    writer: &SharedEventWriter,
) -> Result<SharedSelectedTarget, String> {
    let path = shared_session_meta_path(workspace_id, shared_session_id)?;
    with_shared_store_lock(&path, || {
        let raw = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
        let mut root: Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
        let selected_target = if is_legacy_engine_only_selected_target(target) {
            let mut meta: SharedSessionMeta =
                serde_json::from_value(root.clone()).map_err(|error| error.to_string())?;
            sanitize_shared_session_meta(&mut meta);
            resolve_shared_selection_update(&mut meta, target)
        } else {
            target.clone()
        };
        apply_selected_target_selection(&mut root, &selected_target, updated_at)?;
        let updated_raw = serde_json::to_string_pretty(&root).map_err(|error| error.to_string())?;
        write_string_atomically(&path, &updated_raw)?;
        if let Err(error) =
            upsert_v2_selected_target(writer, shared_session_id, &selected_target, updated_at)
        {
            let rollback = write_string_atomically(&path, &raw);
            return Err(match rollback {
                Ok(()) => error,
                Err(rollback_error) => {
                    format!("{error}; legacy metadata rollback also failed: {rollback_error}")
                }
            });
        }
        Ok(selected_target)
    })
}

fn upsert_v2_selected_target(
    writer: &SharedEventWriter,
    shared_session_id: &str,
    target: &SharedSelectedTarget,
    updated_at: u64,
) -> Result<(), String> {
    let selected_target_json = serde_json::to_string(target).map_err(|error| error.to_string())?;
    writer
        .upsert_session_target(&SessionTargetUpdate {
            session_id: shared_session_id.to_string(),
            schema_version: SHARED_SESSION_SCHEMA_VERSION,
            selected_target_json,
            updated_at: updated_at as i64,
        })
        .map_err(|error| error.to_string())
}

fn select_meta_engine_compat(meta: &mut SharedSessionMeta, engine: EngineType) {
    if meta
        .selected_target
        .as_ref()
        .is_some_and(|target| target.engine == engine)
    {
        meta.selected_engine = engine;
        return;
    }
    select_meta_target(meta, engine, None);
}

fn resolve_shared_selection_update(
    meta: &mut SharedSessionMeta,
    requested_target: &SharedSelectedTarget,
) -> SharedSelectedTarget {
    if !is_legacy_engine_only_selected_target(requested_target) {
        return requested_target.clone();
    }
    select_meta_engine_compat(meta, requested_target.engine);
    meta.selected_target
        .clone()
        .unwrap_or_else(|| legacy_engine_only_selected_target(requested_target.engine))
}

async fn ensure_shared_session_native_binding(
    workspace_id: &str,
    meta: &mut SharedSessionMeta,
    engine: EngineType,
    provider_profile_id: Option<String>,
    last_turn_seq: u64,
    state: &AppState,
    app: &AppHandle,
) -> Result<String, String> {
    let now = now_millis();
    let provider_profile_id = provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let binding_key = shared_target_binding_key(engine, provider_profile_id.as_deref());
    let (current_native_thread_id, needs_codex_thread) = {
        let native_thread_id = if provider_profile_id.is_some() {
            let binding = meta
                .bindings_by_target
                .entry(binding_key.clone())
                .or_insert_with(|| SharedTargetBindingMeta {
                    binding_key: binding_key.clone(),
                    engine,
                    provider_profile_id: provider_profile_id.clone(),
                    native_thread_id: engine_binding_thread_id(engine, &Uuid::new_v4().to_string()),
                    created_at: now,
                    last_used_at: now,
                    // New target binding should replay canonical shared history on first send.
                    last_synced_turn_seq: 0,
                    availability: default_target_binding_availability(),
                });
            binding.last_used_at = now;
            binding.native_thread_id.clone()
        } else {
            let binding =
                meta.bindings_by_engine
                    .entry(engine)
                    .or_insert_with(|| SharedEngineBinding {
                        engine,
                        native_thread_id: engine_binding_thread_id(
                            engine,
                            &Uuid::new_v4().to_string(),
                        ),
                        created_at: now,
                        last_used_at: now,
                        // New engine binding should replay canonical shared history on first send.
                        last_synced_turn_seq: 0,
                    });
            binding.last_used_at = now;
            binding.native_thread_id.clone()
        };
        let needs_codex_thread = engine == EngineType::Codex
            && !binding_uses_established_native_thread(engine, &native_thread_id);
        (native_thread_id, needs_codex_thread)
    };

    if !needs_codex_thread {
        return Ok(current_native_thread_id);
    }

    let started = codex::start_thread_with_runtime_retry_for_provider(
        workspace_id,
        None,
        provider_profile_id.clone(),
        state,
        app,
    )
    .await?;
    let result = started
        .get("result")
        .cloned()
        .unwrap_or_else(|| started.clone());
    let next_native_thread_id = result
        .get("thread")
        .and_then(|value| value.get("id"))
        .and_then(Value::as_str)
        .or_else(|| result.get("threadId").and_then(Value::as_str))
        .unwrap_or_default()
        .trim()
        .to_string();
    if next_native_thread_id.is_empty() {
        return Err("Failed to create Codex binding thread".to_string());
    }

    if provider_profile_id.is_some() {
        if let Some(binding) = meta.bindings_by_target.get_mut(&binding_key) {
            binding.native_thread_id = next_native_thread_id.clone();
            binding.created_at = now;
            binding.last_used_at = now;
            binding.last_synced_turn_seq = last_turn_seq;
        }
    } else if let Some(binding) = meta.bindings_by_engine.get_mut(&engine) {
        binding.native_thread_id = next_native_thread_id.clone();
        binding.created_at = now;
        binding.last_used_at = now;
        binding.last_synced_turn_seq = last_turn_seq;
    }

    Ok(next_native_thread_id)
}

/// 读取 binding 的已同步 turn seq（provider None → engine map 权威；Some → target map）。
fn shared_binding_synced_turn_seq(
    meta: &mut SharedSessionMeta,
    engine: EngineType,
    provider_profile_id: Option<&str>,
    now: u64,
) -> u64 {
    if provider_profile_id.is_some() {
        let key = shared_target_binding_key(engine, provider_profile_id);
        let binding = meta
            .bindings_by_target
            .entry(key.clone())
            .or_insert_with(|| SharedTargetBindingMeta {
                binding_key: key,
                engine,
                provider_profile_id: provider_profile_id.map(str::to_string),
                native_thread_id: engine_binding_thread_id(engine, &Uuid::new_v4().to_string()),
                created_at: now,
                last_used_at: now,
                last_synced_turn_seq: 0,
                availability: default_target_binding_availability(),
            });
        binding.last_synced_turn_seq
    } else {
        let binding =
            meta.bindings_by_engine
                .entry(engine)
                .or_insert_with(|| SharedEngineBinding {
                    engine,
                    native_thread_id: engine_binding_thread_id(engine, &Uuid::new_v4().to_string()),
                    created_at: now,
                    last_used_at: now,
                    last_synced_turn_seq: 0,
                });
        binding.last_synced_turn_seq
    }
}

/// 发送前后触碰 binding（更新 last_used_at；可选推进 last_synced_turn_seq）。
fn touch_shared_binding(
    meta: &mut SharedSessionMeta,
    engine: EngineType,
    provider_profile_id: Option<&str>,
    now: u64,
    synced_turn_seq: Option<u64>,
) {
    if provider_profile_id.is_some() {
        let key = shared_target_binding_key(engine, provider_profile_id);
        if let Some(binding) = meta.bindings_by_target.get_mut(&key) {
            binding.last_used_at = now;
            if let Some(synced) = synced_turn_seq {
                binding.last_synced_turn_seq = synced;
            }
        }
    } else if let Some(binding) = meta.bindings_by_engine.get_mut(&engine) {
        binding.last_used_at = now;
        if let Some(synced) = synced_turn_seq {
            binding.last_synced_turn_seq = synced;
        }
    }
}

pub(crate) fn read_shared_session_meta(
    workspace_id: &str,
    shared_session_id: &str,
) -> Result<SharedSessionMeta, String> {
    let path = shared_session_meta_path(workspace_id, shared_session_id)?;
    let raw = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let mut meta: SharedSessionMeta =
        serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    sanitize_shared_session_meta(&mut meta);
    Ok(meta)
}

fn resolve_shared_session_read_target(
    meta: &SharedSessionMeta,
    event_writer: Option<&SharedEventWriter>,
) -> Result<Option<SharedSelectedTarget>, String> {
    let Some(writer) = event_writer else {
        return Ok(meta.selected_target.clone());
    };
    let Some(stored_target) = writer
        .session_target(&meta.id)
        .map_err(|error| error.to_string())?
    else {
        return Ok(meta.selected_target.clone());
    };
    let target = serde_json::from_str::<SharedSelectedTarget>(&stored_target.selected_target_json)
        .map_err(|error| {
            format!(
                "invalid Shared V2 selected target for session {}: {error}",
                meta.id
            )
        })?;
    Ok(Some(normalize_shared_selected_target(target)))
}

pub(crate) fn write_shared_session_meta(meta: &SharedSessionMeta) -> Result<(), String> {
    let path = shared_session_meta_path(&meta.workspace_id, &meta.id)?;
    with_shared_store_lock(&path, || {
        let mut sanitized = meta.clone();
        sanitize_shared_session_meta(&mut sanitized);
        let raw = serde_json::to_string_pretty(&sanitized).map_err(|error| error.to_string())?;
        write_string_atomically(&path, &raw)
    })
}

fn append_shared_session_log_entry(
    workspace_id: &str,
    shared_session_id: &str,
    entry: &SharedSessionSnapshotEntry,
) -> Result<(), String> {
    let path = shared_session_log_path(workspace_id, shared_session_id)?;
    with_shared_store_lock(&path, || {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let serialized = serde_json::to_string(entry).map_err(|error| error.to_string())?;
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|error| error.to_string())?;
        writeln!(file, "{serialized}").map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        Ok(())
    })
}

pub(crate) fn read_latest_shared_session_snapshot(
    workspace_id: &str,
    shared_session_id: &str,
) -> Result<Option<SharedSessionSnapshotEntry>, String> {
    let path = shared_session_log_path(workspace_id, shared_session_id)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let latest = content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| serde_json::from_str::<SharedSessionSnapshotEntry>(line).ok())
        .last();
    Ok(latest)
}

pub(crate) fn list_workspace_shared_sessions(
    workspace_id: &str,
    event_writer: Option<&crate::shared_event_log::SharedEventWriter>,
) -> Result<Vec<SharedSessionSummary>, String> {
    let directory = workspace_shared_sessions_dir(workspace_id)?;
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut summaries = Vec::new();
    for entry in std::fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if !file_type.is_dir() {
            continue;
        }
        let shared_session_id = entry.file_name().to_string_lossy().to_string();
        let meta = match read_shared_session_meta(workspace_id, &shared_session_id) {
            Ok(meta) => meta,
            Err(_) => continue,
        };
        let selected_target = resolve_shared_session_read_target(&meta, event_writer)?;
        let selected_engine = selected_target
            .as_ref()
            .map(|target| target.engine)
            .unwrap_or(meta.selected_engine);
        let mut native_thread_ids = meta
            .bindings_by_engine
            .values()
            .map(|binding| binding.native_thread_id.clone())
            .collect::<Vec<_>>();
        if let Some(writer) = event_writer {
            native_thread_ids.extend(
                writer
                    .binding_states_for_session(&meta.id)
                    .map_err(|error| error.to_string())?
                    .into_iter()
                    .filter_map(|binding| binding.native_session_id)
                    .filter(|native_session_id| !native_session_id.trim().is_empty()),
            );
        }
        native_thread_ids.sort();
        native_thread_ids.dedup();
        summaries.push(SharedSessionSummary {
            id: meta.id.clone(),
            thread_id: shared_thread_id(&meta.id),
            title: meta.title.clone(),
            updated_at: meta.updated_at,
            selected_engine,
            thread_kind: "shared".to_string(),
            engine_source: selected_engine,
            selected_engine_label: selected_engine.display_name().to_string(),
            native_thread_ids,
        });
    }
    summaries.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(summaries)
}

fn extract_first_user_title(items: &[Value]) -> Option<String> {
    for item in items {
        let role = item
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        if role != "user" {
            continue;
        }
        let text = item
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        if text.is_empty() {
            continue;
        }
        let normalized = text.lines().next().unwrap_or(text).trim();
        if normalized.is_empty() {
            continue;
        }
        let title = if normalized.chars().count() > 32 {
            format!("{}...", normalized.chars().take(32).collect::<String>())
        } else {
            normalized.to_string()
        };
        return Some(title);
    }
    None
}

fn count_user_turns(items: &[Value]) -> u64 {
    items
        .iter()
        .filter(|item| {
            item.get("kind").and_then(Value::as_str) == Some("message")
                && item.get("role").and_then(Value::as_str) == Some("user")
        })
        .count() as u64
}

fn build_delta_sync_projection(items: &[Value], from_turn_seq: u64) -> Option<(String, bool)> {
    if items.is_empty() {
        return None;
    }
    let mut turn_index = 0_u64;
    let mut current_user: Option<String> = None;
    let mut collected: Vec<String> = Vec::new();

    for item in items {
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or_default();
        if kind != "message" {
            continue;
        }
        let role = item.get("role").and_then(Value::as_str).unwrap_or_default();
        let text = item
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .replace('\n', " ");
        if role == "user" {
            turn_index += 1;
            current_user = if text.is_empty() { None } else { Some(text) };
            continue;
        }
        if role == "assistant" && turn_index > from_turn_seq {
            let engine = item
                .get("engineSource")
                .and_then(Value::as_str)
                .unwrap_or("assistant")
                .trim()
                .to_string();
            if !text.is_empty() {
                if let Some(user_text) = current_user.take() {
                    collected.push(format!(
                        "Turn {turn_index}\nUser: {user_text}\n{engine}: {text}"
                    ));
                }
            }
        }
    }

    if collected.is_empty() {
        return None;
    }

    let mut merged = String::from(
        "Shared session context sync. Continue from these recent turns before answering the new request:\n\n",
    );
    let retained_from = collected.len().saturating_sub(MAX_DELTA_SYNC_TURNS);
    let mut truncated = false;
    for block in &collected[retained_from..] {
        let remaining = MAX_DELTA_SYNC_CHARS.saturating_sub(merged.chars().count() + 2);
        if remaining == 0 {
            truncated = true;
            break;
        }
        let block_chars = block.chars().count();
        merged.extend(block.chars().take(remaining));
        merged.push_str("\n\n");
        if block_chars > remaining {
            truncated = true;
            break;
        }
    }
    Some((merged.trim_end().to_string(), truncated))
}

fn build_delta_sync_prefix(items: &[Value], from_turn_seq: u64) -> Option<String> {
    build_delta_sync_projection(items, from_turn_seq).map(|(projection, _)| projection)
}

pub(crate) fn inspect_shared_context_projection(
    items: &[Value],
    from_turn_seq: u64,
) -> Vec<String> {
    let pending_turns = count_user_turns(items).saturating_sub(from_turn_seq);
    let mut omissions = Vec::new();
    if pending_turns as usize > MAX_DELTA_SYNC_TURNS {
        omissions.push(format!(
            "{} older turn(s) omitted by the {}-turn context limit",
            pending_turns as usize - MAX_DELTA_SYNC_TURNS,
            MAX_DELTA_SYNC_TURNS
        ));
    }
    let projection_truncated = build_delta_sync_projection(items, from_turn_seq)
        .map(|(_, truncated)| truncated)
        .unwrap_or(false);
    if projection_truncated {
        omissions.push(format!(
            "context truncated at the {}-character limit",
            MAX_DELTA_SYNC_CHARS
        ));
    }
    omissions
}

pub(crate) fn shared_binding_synced_sequence(
    meta: &SharedSessionMeta,
    engine: EngineType,
    provider_profile_id: Option<&str>,
) -> u64 {
    match provider_profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(provider) => meta
            .bindings_by_target
            .get(&shared_target_binding_key(engine, Some(provider)))
            .map(|binding| binding.last_synced_turn_seq)
            .unwrap_or(0),
        None => meta
            .bindings_by_engine
            .get(&engine)
            .map(|binding| binding.last_synced_turn_seq)
            .unwrap_or(0),
    }
}

async fn resolve_workspace_path(
    workspaces: &Mutex<HashMap<String, crate::types::WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<PathBuf, String> {
    let workspaces = workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .ok_or_else(|| format!("workspace not found: {workspace_id}"))?;
    Ok(PathBuf::from(&entry.path))
}

async fn ensure_known_workspace(
    workspaces: &Mutex<HashMap<String, crate::types::WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<(), String> {
    let workspaces = workspaces.lock().await;
    if workspaces.contains_key(workspace_id) {
        Ok(())
    } else {
        Err(format!("workspace not found: {workspace_id}"))
    }
}

fn load_meta_and_snapshot(
    workspace_id: &str,
    shared_session_id: &str,
) -> Result<(SharedSessionMeta, Option<SharedSessionSnapshotEntry>), String> {
    Ok((
        read_shared_session_meta(workspace_id, shared_session_id)?,
        read_latest_shared_session_snapshot(workspace_id, shared_session_id)?,
    ))
}

#[tauri::command]
pub async fn start_shared_session(
    workspace_id: String,
    initial_target: Option<SharedSelectedTarget>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    ensure_known_workspace(&state.workspaces, &workspace_id).await?;
    let writer = state.shared_event_writer.as_ref().ok_or_else(|| {
        "shared event writer unavailable; cannot create a durable Shared Session".to_string()
    })?;

    let selected_target = match initial_target {
        Some(target) => {
            let target = normalize_shared_selected_target(target);
            validate_resolved_shared_selected_target(&target)?;
            target
        }
        None => {
            return Err(
                "invalid-shared-target: initialTarget is required for a new Shared Session"
                    .to_string(),
            )
        }
    };
    let selected_engine = selected_target.engine;
    let now = now_millis();
    let shared_session_id = Uuid::new_v4().to_string();
    let meta = SharedSessionMeta {
        schema_version: SHARED_SESSION_SCHEMA_VERSION,
        id: shared_session_id.clone(),
        workspace_id: workspace_id.clone(),
        title: "Shared Session".to_string(),
        created_at: now,
        updated_at: now,
        selected_engine,
        selected_target: Some(selected_target.clone()),
        last_turn_seq: 0,
        bindings_by_engine: HashMap::new(),
        bindings_by_target: HashMap::new(),
    };
    let session_dir = shared_session_dir(&workspace_id, &shared_session_id)?;
    std::fs::create_dir_all(&session_dir).map_err(|error| error.to_string())?;
    if let Err(error) = write_shared_session_meta(&meta)
        .and_then(|_| upsert_v2_selected_target(writer, &shared_session_id, &selected_target, now))
    {
        let rollback = std::fs::remove_dir_all(&session_dir);
        return Err(match rollback {
            Ok(()) => error,
            Err(rollback_error) => {
                format!("{error}; new Shared Session rollback failed: {rollback_error}")
            }
        });
    }

    Ok(json!({
        "result": {
            "thread": {
                "id": shared_thread_id(&shared_session_id),
                "name": meta.title,
                "updatedAt": meta.updated_at,
                "threadKind": "shared",
                "engineSource": meta.selected_engine,
                "selectedEngine": meta.selected_engine,
                "selectedTarget": selected_target,
                "nativeThreadIds": Vec::<String>::new(),
            }
        }
    }))
}

#[tauri::command]
pub async fn list_shared_sessions(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    ensure_known_workspace(&state.workspaces, &workspace_id).await?;
    Ok(json!(list_workspace_shared_sessions(
        &workspace_id,
        state.shared_event_writer.as_ref(),
    )?))
}

#[tauri::command]
pub async fn load_shared_session(
    workspace_id: String,
    thread_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    ensure_known_workspace(&state.workspaces, &workspace_id).await?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    let (meta, snapshot) = load_meta_and_snapshot(&workspace_id, &shared_session_id)?;
    let selected_target =
        resolve_shared_session_read_target(&meta, state.shared_event_writer.as_ref())?;
    let selected_engine = selected_target
        .as_ref()
        .map(|target| target.engine)
        .unwrap_or(meta.selected_engine);
    let payload = SharedSessionLoadPayload {
        id: meta.id.clone(),
        thread_id: shared_thread_id(&meta.id),
        title: meta.title.clone(),
        selected_engine,
        thread_kind: "shared".to_string(),
        engine_source: selected_engine,
        selected_target,
        items: snapshot
            .as_ref()
            .map(|entry| entry.items.clone())
            .unwrap_or_default(),
        updated_at: meta.updated_at,
    };
    Ok(json!(payload))
}

#[tauri::command]
pub async fn set_shared_session_selected_engine(
    workspace_id: String,
    thread_id: String,
    selected_engine: EngineType,
    provider_profile_id: Option<String>,
    model_catalog_entry_id: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    provider_profile_name_snapshot: Option<String>,
    provider_profile_source: Option<String>,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<Value, String> {
    ensure_known_workspace(&state.workspaces, &workspace_id).await?;
    let selected_engine = ensure_supported_shared_session_engine(selected_engine)?;
    let provider_profile_id = provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    let now = now_millis();
    let selected_target = normalize_shared_selected_target(SharedSelectedTarget {
        engine: selected_engine,
        provider_profile_id,
        model_catalog_entry_id: model_catalog_entry_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        model: model
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        reasoning: reasoning_effort
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(|effort| SharedSelectedReasoning { effort }),
        provider_profile_name_snapshot: provider_profile_name_snapshot
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        provider_profile_source: normalize_provider_selection_source(provider_profile_source),
    });
    if !is_legacy_engine_only_selected_target(&selected_target) {
        validate_resolved_shared_selected_target(&selected_target)?;
    }
    let selected_target = write_shared_session_selection(
        &workspace_id,
        &shared_session_id,
        &selected_target,
        now,
        state.shared_event_writer.as_ref().ok_or_else(|| {
            "shared event writer unavailable; cannot persist Shared Session Target".to_string()
        })?,
    )?;
    Ok(json!({
        "threadId": shared_thread_id(&shared_session_id),
        "selectedEngine": selected_target.engine,
        "engineSource": selected_target.engine,
        "threadKind": "shared",
        "selectedTarget": selected_target,
    }))
}

#[tauri::command]
pub async fn update_shared_session_native_binding(
    workspace_id: String,
    thread_id: String,
    engine: EngineType,
    old_native_thread_id: Option<String>,
    new_native_thread_id: String,
    provider_profile_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    ensure_known_workspace(&state.workspaces, &workspace_id).await?;
    let engine = ensure_supported_shared_session_engine(engine)?;
    let provider_profile_id = provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    let new_native_thread_id = validate_shared_native_thread_id(&new_native_thread_id)?;
    let mut meta = read_shared_session_meta(&workspace_id, &shared_session_id)?;
    if let Some(provider) = provider_profile_id.as_deref() {
        // B.5：managed provider 走 Target 级 binding；rebind 时保留 created_at，
        // 仅更新 native_thread_id / last_used_at。
        let binding_key = shared_target_binding_key(engine, Some(provider));
        let now = now_millis();
        let entry = meta
            .bindings_by_target
            .entry(binding_key.clone())
            .or_insert_with(|| SharedTargetBindingMeta {
                binding_key,
                engine,
                provider_profile_id: Some(provider.to_string()),
                native_thread_id: new_native_thread_id.clone(),
                created_at: now,
                last_used_at: now,
                last_synced_turn_seq: meta.last_turn_seq,
                availability: default_target_binding_availability(),
            });
        let matches_old = old_native_thread_id
            .as_ref()
            .map(|value| value.trim() == entry.native_thread_id.trim())
            .unwrap_or(true);
        if matches_old {
            entry.native_thread_id = new_native_thread_id.clone();
            entry.last_used_at = now;
        }
        meta.updated_at = now_millis();
        write_shared_session_meta(&meta)?;
        return Ok(json!({
            "threadId": shared_thread_id(&meta.id),
            "engine": engine,
            "providerProfileId": provider,
            "nativeThreadId": new_native_thread_id,
        }));
    }
    let entry = meta
        .bindings_by_engine
        .entry(engine)
        .or_insert_with(|| SharedEngineBinding {
            engine,
            native_thread_id: new_native_thread_id.clone(),
            created_at: now_millis(),
            last_used_at: now_millis(),
            last_synced_turn_seq: meta.last_turn_seq,
        });
    let matches_old = old_native_thread_id
        .as_ref()
        .map(|value| value.trim() == entry.native_thread_id.trim())
        .unwrap_or(true);
    if matches_old {
        entry.native_thread_id = new_native_thread_id.clone();
        entry.last_used_at = now_millis();
    }
    meta.updated_at = now_millis();
    write_shared_session_meta(&meta)?;
    Ok(json!({
        "threadId": shared_thread_id(&meta.id),
        "engine": engine,
        "nativeThreadId": new_native_thread_id,
    }))
}

fn apply_shared_snapshot_presentation_metadata(
    meta: &mut SharedSessionMeta,
    items: &[Value],
    updated_at: u64,
) {
    meta.updated_at = updated_at;
    meta.last_turn_seq = count_user_turns(items);
    if let Some(title) = extract_first_user_title(items) {
        meta.title = title;
    }
}

#[tauri::command]
pub async fn sync_shared_session_snapshot(
    workspace_id: String,
    thread_id: String,
    items: Vec<Value>,
    selected_engine: EngineType,
    legacy_snapshot_enabled: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    ensure_known_workspace(&state.workspaces, &workspace_id).await?;
    let selected_engine = ensure_supported_shared_session_engine(selected_engine)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    let mut meta = read_shared_session_meta(&workspace_id, &shared_session_id)?;
    // Snapshot sync 只拥有 presentation authority。Selection 的唯一写入口是
    // set_shared_session_selected_engine；stale timer 禁止反向覆盖 selectedTarget。
    apply_shared_snapshot_presentation_metadata(&mut meta, &items, now_millis());
    write_shared_session_meta(&meta)?;
    if !legacy_snapshot_enabled.unwrap_or(true) {
        return Ok(json!({
            "threadId": shared_thread_id(&meta.id),
            "updatedAt": meta.updated_at,
            "lastTurnSeq": meta.last_turn_seq,
            "legacySnapshot": {
                "status": "skipped",
                "reason": "renderer-v2-authority",
            },
            "shadowMirror": { "status": "skipped" },
        }));
    }
    let entry = SharedSessionSnapshotEntry {
        kind: "snapshot".to_string(),
        created_at: meta.updated_at,
        selected_engine,
        last_turn_seq: meta.last_turn_seq,
        items,
    };
    append_shared_session_log_entry(&workspace_id, &shared_session_id, &entry)?;
    let shadow_mirror = if let Some(writer) = state.shared_event_writer.as_ref() {
        let facts =
            crate::shared_event_log::canonical::shadow_v0::map_v0_snapshot_to_presentation_only_facts(
                &entry.items,
                selected_engine.icon(),
                i64::try_from(entry.created_at).unwrap_or(i64::MAX),
            );
        let mut mirrored_facts = 0usize;
        let mut mirror_error = None;
        for fact in facts {
            match writer.append_presentation_only_fact(shared_session_id.clone(), fact) {
                Ok(_) => mirrored_facts += 1,
                Err(error) => {
                    mirror_error = Some(error.to_string());
                    break;
                }
            }
        }
        if let Some(error) = mirror_error {
            eprintln!(
                "[shared-event-log] V0 shadow mirror failed session={shared_session_id}: {error}"
            );
            json!({ "status": "error", "error": error })
        } else {
            json!({ "status": "ok", "factCount": mirrored_facts })
        }
    } else {
        json!({ "status": "unavailable" })
    };
    Ok(json!({
        "threadId": shared_thread_id(&meta.id),
        "updatedAt": meta.updated_at,
        "lastTurnSeq": meta.last_turn_seq,
        "shadowMirror": shadow_mirror,
    }))
}

/// Deletes shared session storage for a workspace.
/// Returns `Ok(true)` when files were removed, `Ok(false)` when already absent.
pub(crate) fn delete_shared_session_files(
    workspace_id: &str,
    thread_id: &str,
) -> Result<bool, String> {
    let shared_session_id = parse_shared_session_id(thread_id)?;
    let path = shared_session_dir(workspace_id, &shared_session_id)?;
    if !path.exists() {
        return Ok(false);
    }
    std::fs::remove_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn delete_shared_session(
    workspace_id: String,
    thread_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    ensure_known_workspace(&state.workspaces, &workspace_id).await?;
    let deleted = delete_shared_session_files(&workspace_id, &thread_id)?;
    Ok(json!({ "deleted": deleted, "threadId": thread_id }))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedContextRuntimeDelivery {
    pub package_id: String,
    pub source_checksum: String,
    pub operation: String,
    #[serde(default)]
    pub import_items: Vec<Value>,
    pub ack_fidelity: String,
}

#[tauri::command]
pub async fn send_shared_session_message(
    workspace_id: String,
    thread_id: String,
    engine: EngineType,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    collaboration_mode: Option<Value>,
    preferred_language: Option<String>,
    custom_spec_root: Option<String>,
    provider_profile_id: Option<String>,
    context_delivery: Option<SharedContextRuntimeDelivery>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let engine = ensure_supported_shared_session_engine(engine)?;
    let provider_profile_id = provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let binding_key = shared_target_binding_key(engine, provider_profile_id.as_deref());
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    let _workspace_path = resolve_workspace_path(&state.workspaces, &workspace_id).await?;
    let (mut meta, snapshot) = load_meta_and_snapshot(&workspace_id, &shared_session_id)?;
    let now = now_millis();
    let latest_items = snapshot
        .as_ref()
        .map(|entry| entry.items.clone())
        .unwrap_or_default();
    let latest_turn_seq = count_user_turns(&latest_items);
    let sync_from_turn_seq =
        shared_binding_synced_turn_seq(&mut meta, engine, provider_profile_id.as_deref(), now);

    // Change C package 已由 Canonical Log 编译；存在 contextDelivery 时禁止再叠加
    // V0 snapshot prefix，否则同一历史会被重复投递。
    let sync_prefix = if context_delivery.is_none() && sync_from_turn_seq < latest_turn_seq {
        build_delta_sync_prefix(&latest_items, sync_from_turn_seq)
    } else {
        None
    };
    let outbound_text = if let Some(prefix) = sync_prefix {
        format!("{prefix}\n\nCurrent user request:\n{text}")
    } else {
        text.clone()
    };
    let mut context_acceptance = Value::Null;

    let response = match engine {
        EngineType::Codex => {
            let native_thread_id = ensure_shared_session_native_binding(
                &workspace_id,
                &mut meta,
                engine,
                provider_profile_id.clone(),
                latest_turn_seq,
                &state,
                &app,
            )
            .await?;
            touch_shared_binding(&mut meta, engine, provider_profile_id.as_deref(), now, None);
            select_meta_target(&mut meta, engine, provider_profile_id.clone());
            meta.updated_at = now;
            // Persist binding materialization before sending so failures don't
            // repeatedly create new native threads.
            write_shared_session_meta(&meta)?;
            if let Some(delivery) = context_delivery.as_ref() {
                if delivery.operation == "context-import" {
                    codex_core::inject_thread_items_core(
                        &state.sessions,
                        &workspace_id,
                        provider_profile_id.as_deref(),
                        &native_thread_id,
                        delivery.import_items.clone(),
                    )
                    .await?;
                    context_acceptance = json!({
                        "status": "accepted",
                        "packageId": delivery.package_id,
                        "sourceChecksum": delivery.source_checksum,
                        "ackFidelity": delivery.ack_fidelity,
                        "evidence": "thread/inject_items-jsonrpc-success",
                    });
                }
            }
            let (mode_enforcement_enabled, extra_developer_instructions) = {
                let settings = state.app_settings.lock().await;
                (
                    settings.codex_mode_enforcement_enabled,
                    codex_turn_developer_instructions(&settings),
                )
            };
            let response = codex_core::send_user_message_core(
                &state.sessions,
                workspace_id.clone(),
                provider_profile_id.clone(),
                native_thread_id.clone(),
                outbound_text,
                model,
                effort,
                access_mode,
                images,
                collaboration_mode,
                preferred_language,
                custom_spec_root,
                mode_enforcement_enabled,
                extra_developer_instructions,
            )
            .await?;
            touch_shared_binding(
                &mut meta,
                engine,
                provider_profile_id.as_deref(),
                now,
                Some(latest_turn_seq + 1),
            );
            select_meta_target(&mut meta, engine, provider_profile_id.clone());
            meta.updated_at = now;
            meta.last_turn_seq = latest_turn_seq + 1;
            write_shared_session_meta(&meta)?;
            response
        }
        EngineType::Claude => {
            let native_thread_id = ensure_shared_session_native_binding(
                &workspace_id,
                &mut meta,
                engine,
                provider_profile_id.clone(),
                latest_turn_seq,
                &state,
                &app,
            )
            .await?;
            let continue_session =
                binding_uses_established_native_thread(engine, &native_thread_id);
            let session_id = if continue_session {
                native_thread_id
                    .split_once(':')
                    .map(|(_, session_id)| session_id.to_string())
            } else {
                None
            };
            touch_shared_binding(&mut meta, engine, provider_profile_id.as_deref(), now, None);
            select_meta_target(&mut meta, engine, provider_profile_id.clone());
            meta.updated_at = now;
            write_shared_session_meta(&meta)?;
            let response = engine::engine_send_message(
                workspace_id.clone(),
                outbound_text,
                Some(engine),
                model,
                None,
                effort,
                disable_thinking,
                access_mode,
                images,
                continue_session,
                Some(native_thread_id),
                session_id,
                None,
                None,
                None,
                provider_profile_id.clone(),
                custom_spec_root,
                None,
                None,
                app,
                state,
            )
            .await?;
            touch_shared_binding(
                &mut meta,
                engine,
                provider_profile_id.as_deref(),
                now,
                Some(latest_turn_seq + 1),
            );
            select_meta_target(&mut meta, engine, provider_profile_id.clone());
            meta.updated_at = now;
            meta.last_turn_seq = latest_turn_seq + 1;
            write_shared_session_meta(&meta)?;
            response
        }
        EngineType::Gemini | EngineType::OpenCode | EngineType::Grok | EngineType::Kimi => {
            return Err(format!(
                "Unsupported shared session engine: {}",
                engine.icon()
            ));
        }
    };
    let prompt_acceptance = if response.get("error").is_some() {
        "rejected"
    } else {
        "accepted"
    };
    if context_acceptance.is_null() {
        if let Some(delivery) = context_delivery.as_ref() {
            if delivery.operation == "prompt-prefix" && prompt_acceptance == "accepted" {
                context_acceptance = json!({
                    "status": if delivery.ack_fidelity == "strong" { "pending" } else { "accepted" },
                    "packageId": delivery.package_id,
                    "sourceChecksum": delivery.source_checksum,
                    "ackFidelity": delivery.ack_fidelity,
                    "evidence": if delivery.ack_fidelity == "strong" {
                        "awaiting-claude-replay-echo"
                    } else {
                        "typed-prompt-acceptance"
                    },
                });
            }
        }
    }

    Ok(json!({
        "engine": engine,
        "sharedSessionId": shared_session_id,
        "threadKind": "shared",
        "threadId": thread_id,
        "nativeThreadId": if provider_profile_id.is_some() {
            meta.bindings_by_target.get(&binding_key).map(|binding| binding.native_thread_id.clone()).unwrap_or_default()
        } else {
            meta.bindings_by_engine.get(&engine).map(|binding| binding.native_thread_id.clone()).unwrap_or_default()
        },
        "providerProfileId": provider_profile_id,
        "bindingKey": binding_key,
        "selectedEngine": meta.selected_engine,
        "result": response.get("result").cloned().unwrap_or_else(|| response.clone()),
        "turn": response.get("turn").cloned().or_else(|| response.get("result").and_then(|value| value.get("turn")).cloned()).unwrap_or(Value::Null),
        "response": response,
        "delivery": json!({
            "promptAcceptance": prompt_acceptance,
            "contextAcceptance": context_acceptance,
        }),
    }))
}

#[cfg(test)]
mod tests {
    use super::{
        apply_selected_target_selection, apply_shared_snapshot_presentation_metadata,
        binding_uses_established_native_thread, build_delta_sync_prefix, count_user_turns,
        extract_first_user_title, inspect_shared_context_projection,
        is_legacy_engine_only_selected_target, is_pending_shared_binding_thread_id,
        legacy_engine_only_selected_target, normalize_provider_selection_source,
        normalize_shared_selected_target, parse_shared_session_id, resolve_shared_selection_update,
        resolve_shared_session_read_target, sanitize_shared_session_meta,
        select_meta_engine_compat, select_meta_target, shared_target_binding_key,
        validate_resolved_shared_selected_target, validate_shared_native_thread_id,
        SharedEngineBinding, SharedSelectedReasoning, SharedSelectedTarget, SharedSessionMeta,
        SharedTargetBindingMeta, MAX_DELTA_SYNC_CHARS, SHARED_SESSION_SCHEMA_VERSION,
    };
    use crate::engine::EngineType;
    use crate::shared_event_log::{open, OpenOutcome, SessionTargetUpdate};
    use serde_json::{json, Value};
    use std::collections::HashMap;

    #[test]
    fn derives_title_from_first_user_message() {
        let items = vec![
            json!({ "id": "u1", "kind": "message", "role": "user", "text": "帮我看看 shared session 该怎么做" }),
            json!({ "id": "a1", "kind": "message", "role": "assistant", "text": "好的" }),
        ];
        let title = extract_first_user_title(&items);
        assert_eq!(title.as_deref(), Some("帮我看看 shared session 该怎么做"));
    }

    #[test]
    fn counts_user_turns_from_snapshot_items() {
        let items = vec![
            json!({ "id": "u1", "kind": "message", "role": "user", "text": "A" }),
            json!({ "id": "a1", "kind": "message", "role": "assistant", "text": "B" }),
            json!({ "id": "u2", "kind": "message", "role": "user", "text": "C" }),
        ];
        assert_eq!(count_user_turns(&items), 2);
    }

    #[test]
    fn builds_delta_sync_prefix_from_newer_turns_only() {
        let items = vec![
            json!({ "id": "u1", "kind": "message", "role": "user", "text": "first user" }),
            json!({ "id": "a1", "kind": "message", "role": "assistant", "text": "first assistant", "engineSource": "claude" }),
            json!({ "id": "u2", "kind": "message", "role": "user", "text": "second user" }),
            json!({ "id": "a2", "kind": "message", "role": "assistant", "text": "second assistant", "engineSource": "codex" }),
        ];
        let prefix = build_delta_sync_prefix(&items, 1).expect("prefix");
        assert!(prefix.contains("Turn 2"));
        assert!(prefix.contains("second user"));
        assert!(prefix.contains("codex"));
        assert!(!prefix.contains("first assistant"));
    }

    #[test]
    fn delta_sync_keeps_the_latest_bounded_turns() {
        let items = (1..=10)
            .flat_map(|turn| {
                [
                    json!({ "kind": "message", "role": "user", "text": format!("user-{turn}") }),
                    json!({ "kind": "message", "role": "assistant", "text": format!("assistant-{turn}") }),
                ]
            })
            .collect::<Vec<_>>();

        let prefix = build_delta_sync_prefix(&items, 0).expect("prefix");
        assert!(!prefix.contains("Turn 1\n"));
        assert!(!prefix.contains("Turn 2\n"));
        assert!(prefix.contains("Turn 3\n"));
        assert!(prefix.contains("Turn 10\n"));
    }

    #[test]
    fn delta_sync_truncates_unicode_by_characters_and_reports_it() {
        let items = vec![
            json!({ "kind": "message", "role": "user", "text": "问题" }),
            json!({ "kind": "message", "role": "assistant", "text": "答".repeat(MAX_DELTA_SYNC_CHARS) }),
        ];

        let prefix = build_delta_sync_prefix(&items, 0).expect("prefix");
        assert!(prefix.chars().count() <= MAX_DELTA_SYNC_CHARS);
        assert_eq!(
            inspect_shared_context_projection(&items, 0),
            vec![format!(
                "context truncated at the {}-character limit",
                MAX_DELTA_SYNC_CHARS
            )]
        );
    }

    #[test]
    fn detects_pending_shared_binding_ids() {
        for engine in [
            EngineType::Claude,
            EngineType::Codex,
            EngineType::Kimi,
            EngineType::Grok,
            EngineType::OpenCode,
        ] {
            assert!(is_pending_shared_binding_thread_id(
                engine,
                &format!("{}-pending-shared-1", engine.icon()),
            ));
        }
        assert!(!is_pending_shared_binding_thread_id(
            EngineType::Codex,
            "550e8400-e29b-41d4-a716-446655440000"
        ));
        assert!(!is_pending_shared_binding_thread_id(
            EngineType::Codex,
            "codex-native-thread-1"
        ));
    }

    #[test]
    fn requires_established_native_thread_before_reusing_binding() {
        assert!(!binding_uses_established_native_thread(
            EngineType::Claude,
            "claude-pending-shared-1"
        ));
        assert!(binding_uses_established_native_thread(
            EngineType::Claude,
            "claude:session-1"
        ));
        assert!(!binding_uses_established_native_thread(
            EngineType::Codex,
            "codex-pending-shared-1"
        ));
        assert!(binding_uses_established_native_thread(
            EngineType::Codex,
            "550e8400-e29b-41d4-a716-446655440000"
        ));
        assert!(binding_uses_established_native_thread(
            EngineType::Codex,
            "codex-native-thread-1"
        ));
        for engine in [EngineType::Kimi, EngineType::Grok, EngineType::OpenCode] {
            assert!(!binding_uses_established_native_thread(
                engine,
                &format!("{}-pending-shared-1", engine.icon()),
            ));
            assert!(binding_uses_established_native_thread(
                engine,
                &format!("native-{}-session", engine.icon()),
            ));
            // catalog / hide set 使用的前缀形式也必须视为 established。
            assert!(binding_uses_established_native_thread(
                engine,
                &format!("{}:native-{}-session", engine.icon(), engine.icon()),
            ));
        }
    }

    #[test]
    fn resolved_local_targets_validate_for_new_shared_cli_engines() {
        for engine in [EngineType::Kimi, EngineType::Grok, EngineType::OpenCode] {
            let catalog = crate::engine::status::get_local_engine_models_for_validation(engine)
                .unwrap_or_else(|| panic!("missing local catalog for {engine:?}"));
            let selected = catalog
                .first()
                .unwrap_or_else(|| panic!("empty local catalog for {engine:?}"));
            let target = SharedSelectedTarget {
                engine,
                provider_profile_id: None,
                model_catalog_entry_id: Some(selected.id.clone()),
                model: Some(selected.model.clone()),
                reasoning: None,
                provider_profile_name_snapshot: Some("本地配置".to_string()),
                provider_profile_source: Some("disk".to_string()),
            };

            validate_resolved_shared_selected_target(&target)
                .unwrap_or_else(|error| panic!("{engine:?} local target rejected: {error}"));
        }
    }

    #[test]
    fn normalizes_legacy_shared_meta_to_supported_engines_only() {
        let mut meta = SharedSessionMeta {
            schema_version: 1,
            id: "shared-1".to_string(),
            workspace_id: "ws-1".to_string(),
            title: "Shared Session".to_string(),
            created_at: 1,
            updated_at: 2,
            selected_engine: EngineType::Gemini,
            selected_target: Some(SharedSelectedTarget {
                engine: EngineType::Gemini,
                provider_profile_id: Some("legacy-provider".to_string()),
                model_catalog_entry_id: Some("legacy-model-entry".to_string()),
                model: Some("legacy-model".to_string()),
                reasoning: Some(SharedSelectedReasoning {
                    effort: "high".to_string(),
                }),
                provider_profile_name_snapshot: Some("Legacy Provider".to_string()),
                provider_profile_source: Some("managed".to_string()),
            }),
            last_turn_seq: 3,
            bindings_by_engine: HashMap::from([
                (
                    EngineType::Gemini,
                    SharedEngineBinding {
                        engine: EngineType::Gemini,
                        native_thread_id: "gemini:session-1".to_string(),
                        created_at: 1,
                        last_used_at: 2,
                        last_synced_turn_seq: 3,
                    },
                ),
                (
                    EngineType::Claude,
                    SharedEngineBinding {
                        engine: EngineType::Claude,
                        native_thread_id: "claude:session-1".to_string(),
                        created_at: 1,
                        last_used_at: 2,
                        last_synced_turn_seq: 3,
                    },
                ),
            ]),
            bindings_by_target: HashMap::new(),
        };

        sanitize_shared_session_meta(&mut meta);

        assert_eq!(meta.selected_engine, EngineType::Claude);
        let target = meta.selected_target.expect("normalized selected target");
        assert_eq!(target.engine, EngineType::Claude);
        assert!(target.provider_profile_id.is_none());
        assert!(target.model_catalog_entry_id.is_none());
        assert!(target.model.is_none());
        assert!(target.reasoning.is_none());
        assert!(meta.bindings_by_engine.contains_key(&EngineType::Claude));
        assert!(!meta.bindings_by_engine.contains_key(&EngineType::Gemini));
    }

    #[test]
    fn rejects_shared_session_ids_with_path_like_segments() {
        assert!(parse_shared_session_id("shared:session-1").is_ok());
        assert!(parse_shared_session_id("shared:../session-1").is_err());
        assert!(parse_shared_session_id("shared:..\\session-1").is_err());
        assert!(parse_shared_session_id("shared:session/1").is_err());
        assert!(parse_shared_session_id("shared:session\\1").is_err());
        assert!(parse_shared_session_id("shared:").is_err());
    }

    #[test]
    fn rejects_empty_shared_native_thread_ids() {
        assert!(validate_shared_native_thread_id("claude:session-1").is_ok());
        assert!(validate_shared_native_thread_id("   ").is_err());
    }

    fn meta_with_engine_binding(engine: EngineType, native_thread_id: &str) -> SharedSessionMeta {
        SharedSessionMeta {
            schema_version: 1,
            id: "shared-1".to_string(),
            workspace_id: "ws-1".to_string(),
            title: "Shared Session".to_string(),
            created_at: 1,
            updated_at: 2,
            selected_engine: engine,
            selected_target: None,
            last_turn_seq: 0,
            bindings_by_engine: HashMap::from([(
                engine,
                SharedEngineBinding {
                    engine,
                    native_thread_id: native_thread_id.to_string(),
                    created_at: 1,
                    last_used_at: 2,
                    last_synced_turn_seq: 3,
                },
            )]),
            bindings_by_target: HashMap::new(),
        }
    }

    #[test]
    fn binding_key_uses_engine_and_provider_with_default_fallback() {
        assert_eq!(
            shared_target_binding_key(EngineType::Claude, None),
            "claude:default"
        );
        assert_eq!(
            shared_target_binding_key(EngineType::Claude, Some("  ")),
            "claude:default"
        );
        assert_eq!(
            shared_target_binding_key(EngineType::Claude, Some("openrouter")),
            "claude:openrouter"
        );
        assert_eq!(
            shared_target_binding_key(EngineType::Codex, Some("openai")),
            "codex:openai"
        );
    }

    #[test]
    fn selected_target_preserves_complete_identity_for_the_same_binding() {
        let mut meta = meta_with_engine_binding(EngineType::Codex, "codex-session-1");
        meta.selected_target = Some(SharedSelectedTarget {
            engine: EngineType::Codex,
            provider_profile_id: Some("provider-kimi".to_string()),
            model_catalog_entry_id: Some("kimi-coding-entry".to_string()),
            model: Some("kimi-for-coding".to_string()),
            reasoning: Some(SharedSelectedReasoning {
                effort: "high".to_string(),
            }),
            provider_profile_name_snapshot: Some("Kimi Coding".to_string()),
            provider_profile_source: Some("managed".to_string()),
        });

        select_meta_target(
            &mut meta,
            EngineType::Codex,
            Some("provider-kimi".to_string()),
        );

        let target = meta.selected_target.expect("selected target");
        assert_eq!(
            target.model_catalog_entry_id.as_deref(),
            Some("kimi-coding-entry")
        );
        assert_eq!(target.model.as_deref(), Some("kimi-for-coding"));
        assert_eq!(
            target
                .reasoning
                .as_ref()
                .map(|reasoning| reasoning.effort.as_str()),
            Some("high")
        );
        assert_eq!(
            target.provider_profile_name_snapshot.as_deref(),
            Some("Kimi Coding")
        );
    }

    #[test]
    fn snapshot_sync_has_no_selection_authority_even_with_a_stale_engine() {
        let mut meta = meta_with_engine_binding(EngineType::Codex, "codex-session-1");
        meta.selected_target = Some(SharedSelectedTarget {
            engine: EngineType::Codex,
            provider_profile_id: Some("provider-kimi".to_string()),
            model_catalog_entry_id: Some("kimi-coding-entry".to_string()),
            model: Some("kimi-for-coding".to_string()),
            reasoning: Some(SharedSelectedReasoning {
                effort: "high".to_string(),
            }),
            provider_profile_name_snapshot: Some("Kimi Coding".to_string()),
            provider_profile_source: Some("managed".to_string()),
        });

        apply_shared_snapshot_presentation_metadata(
            &mut meta,
            &[json!({
                "kind": "message",
                "role": "user",
                "text": "stale Claude snapshot"
            })],
            42,
        );

        let target = meta.selected_target.expect("selected target");
        assert_eq!(meta.selected_engine, EngineType::Codex);
        assert_eq!(target.provider_profile_id.as_deref(), Some("provider-kimi"));
        assert_eq!(target.model.as_deref(), Some("kimi-for-coding"));
        assert_eq!(meta.updated_at, 42);
    }

    #[test]
    fn legacy_engine_only_selection_update_does_not_downgrade_complete_target() {
        let mut meta = meta_with_engine_binding(EngineType::Codex, "codex-session-1");
        meta.selected_target = Some(SharedSelectedTarget {
            engine: EngineType::Codex,
            provider_profile_id: Some("provider-kimi".to_string()),
            model_catalog_entry_id: Some("kimi-coding-entry".to_string()),
            model: Some("kimi-for-coding".to_string()),
            reasoning: Some(SharedSelectedReasoning {
                effort: "high".to_string(),
            }),
            provider_profile_name_snapshot: Some("Kimi Coding".to_string()),
            provider_profile_source: Some("managed".to_string()),
        });
        let legacy_update = legacy_engine_only_selected_target(EngineType::Codex);

        let selected_target = resolve_shared_selection_update(&mut meta, &legacy_update);

        assert_eq!(
            selected_target.provider_profile_id.as_deref(),
            Some("provider-kimi"),
        );
        assert_eq!(
            selected_target.model_catalog_entry_id.as_deref(),
            Some("kimi-coding-entry"),
        );
        assert_eq!(selected_target.model.as_deref(), Some("kimi-for-coding"));
    }

    #[test]
    fn resolved_selected_target_validation_rejects_legacy_partial_identity() {
        let partial = legacy_engine_only_selected_target(EngineType::Codex);

        assert!(is_legacy_engine_only_selected_target(&partial));
        assert!(validate_resolved_shared_selected_target(&partial)
            .expect_err("legacy partial target must not become executable")
            .contains("provider source"),);
    }

    #[test]
    fn selected_target_normalization_preserves_missing_legacy_fields() {
        let normalized = normalize_shared_selected_target(SharedSelectedTarget {
            engine: EngineType::Claude,
            provider_profile_id: Some("   ".to_string()),
            model_catalog_entry_id: None,
            model: None,
            reasoning: None,
            provider_profile_name_snapshot: None,
            provider_profile_source: Some("unknown".to_string()),
        });

        assert!(is_legacy_engine_only_selected_target(&normalized));
    }

    #[test]
    fn selected_target_optional_fields_round_trip_and_legacy_fields_default() {
        let full: SharedSelectedTarget = serde_json::from_value(json!({
            "engine": "codex",
            "providerProfileId": "provider-kimi",
            "modelCatalogEntryId": "kimi-coding-entry",
            "model": "kimi-for-coding",
            "reasoning": { "effort": "high" },
            "providerProfileNameSnapshot": "Kimi Coding",
            "providerProfileSource": "managed"
        }))
        .expect("full selected target");
        let serialized = serde_json::to_value(&full).expect("serialize selected target");
        assert_eq!(
            serialized
                .get("modelCatalogEntryId")
                .and_then(|value| value.as_str()),
            Some("kimi-coding-entry")
        );
        assert_eq!(
            serialized.get("model").and_then(|value| value.as_str()),
            Some("kimi-for-coding")
        );

        let legacy: SharedSelectedTarget =
            serde_json::from_value(json!({ "engine": "claude" })).expect("legacy selected target");
        assert!(legacy.provider_profile_id.is_none());
        assert!(legacy.model_catalog_entry_id.is_none());
        assert!(legacy.model.is_none());
        assert!(legacy.reasoning.is_none());
    }

    #[test]
    fn shared_v2_target_wins_over_stale_legacy_meta_without_writing_either_store() {
        let temp = std::env::temp_dir().join(format!(
            "doge-shared-target-authority-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&temp).expect("create temp dir");
        let writer = match open(&temp.join("shared-v2.sqlite3")).expect("open V2 store") {
            OpenOutcome::Ready(writer) => writer,
            OpenOutcome::ReadOnlyRecovery { .. } => panic!("fresh V2 store must be writable"),
        };
        let mut meta = meta_with_engine_binding(EngineType::Codex, "codex:legacy");
        meta.id = "shared-authority".to_string();
        meta.selected_engine = EngineType::Codex;
        meta.selected_target = Some(SharedSelectedTarget {
            engine: EngineType::Codex,
            provider_profile_id: Some("doge-token-matrix".to_string()),
            model_catalog_entry_id: Some("gpt-5.6-sol".to_string()),
            model: Some("gpt-5.6-sol".to_string()),
            reasoning: None,
            provider_profile_name_snapshot: Some("Doge".to_string()),
            provider_profile_source: Some("managed".to_string()),
        });
        let kimi_target = SharedSelectedTarget {
            engine: EngineType::Kimi,
            provider_profile_id: Some("doge-token-matrix".to_string()),
            model_catalog_entry_id: Some("k3-256k".to_string()),
            model: Some("k3-256k".to_string()),
            reasoning: None,
            provider_profile_name_snapshot: Some("Doge".to_string()),
            provider_profile_source: Some("managed".to_string()),
        };
        writer
            .upsert_session_target(&SessionTargetUpdate {
                session_id: meta.id.clone(),
                schema_version: SHARED_SESSION_SCHEMA_VERSION,
                selected_target_json: serde_json::to_string(&kimi_target)
                    .expect("serialize Kimi target"),
                updated_at: 42,
            })
            .expect("persist V2 target");
        let stored_before = writer
            .session_target(&meta.id)
            .expect("read V2 before")
            .expect("stored V2 target");

        let resolved = resolve_shared_session_read_target(&meta, Some(&writer))
            .expect("resolve read authority")
            .expect("resolved target");

        assert_eq!(resolved, kimi_target);
        assert_eq!(
            meta.selected_target
                .as_ref()
                .and_then(|target| target.model.as_deref()),
            Some("gpt-5.6-sol"),
            "read projection must not mutate legacy metadata"
        );
        assert_eq!(
            writer
                .session_target(&meta.id)
                .expect("read V2 after")
                .expect("stored V2 target"),
            stored_before,
            "read projection must not rewrite V2 target"
        );
        writer.shutdown().expect("shutdown V2 writer");
        std::fs::remove_dir_all(temp).expect("remove temp dir");
    }

    #[test]
    fn picker_selection_does_not_create_or_touch_same_engine_provider_bindings() {
        let mut meta = meta_with_engine_binding(EngineType::Codex, "codex-local-session");
        meta.bindings_by_target.insert(
            "codex:provider-a".to_string(),
            SharedTargetBindingMeta {
                binding_key: "codex:provider-a".to_string(),
                engine: EngineType::Codex,
                provider_profile_id: Some("provider-a".to_string()),
                native_thread_id: "codex-provider-a-session".to_string(),
                created_at: 1,
                last_used_at: 2,
                last_synced_turn_seq: 3,
                availability: "ready".to_string(),
            },
        );
        let mut root = serde_json::to_value(meta).expect("serialize metadata fixture");
        let engine_bindings_before = root.get("bindingsByEngine").cloned();
        let target_bindings_before = root.get("bindingsByTarget").cloned();
        let selected_target = SharedSelectedTarget {
            engine: EngineType::Codex,
            provider_profile_id: Some("provider-b".to_string()),
            model_catalog_entry_id: Some("provider-b-entry".to_string()),
            model: Some("provider-b-runtime".to_string()),
            reasoning: None,
            provider_profile_name_snapshot: Some("Provider B".to_string()),
            provider_profile_source: Some("managed".to_string()),
        };

        apply_selected_target_selection(&mut root, &selected_target, 99)
            .expect("apply selection-only patch");

        assert_eq!(
            root.get("bindingsByEngine").cloned(),
            engine_bindings_before
        );
        assert_eq!(
            root.get("bindingsByTarget").cloned(),
            target_bindings_before
        );
        assert!(
            root.pointer("/bindingsByTarget/codex:provider-b").is_none(),
            "selection must not materialize a Provider binding"
        );
        assert_eq!(root.get("updatedAt").and_then(Value::as_u64), Some(99));
        assert_eq!(
            root.pointer("/selectedTarget/providerProfileId")
                .and_then(Value::as_str),
            Some("provider-b")
        );
    }

    #[test]
    fn selected_target_source_accepts_catalog_values_and_drops_unknown_values() {
        assert_eq!(
            normalize_provider_selection_source(Some(" disk ".to_string())).as_deref(),
            Some("disk")
        );
        assert_eq!(
            normalize_provider_selection_source(Some("managed".to_string())).as_deref(),
            Some("managed")
        );
        assert!(
            normalize_provider_selection_source(Some("local".to_string())).is_none(),
            "selected target persists catalog-domain source, not canonical source"
        );
        assert!(normalize_provider_selection_source(Some("future-source".to_string())).is_none());
    }

    #[test]
    fn migrates_legacy_engine_bindings_to_default_provider_targets() {
        let mut meta = meta_with_engine_binding(EngineType::Claude, "claude:session-1");
        sanitize_shared_session_meta(&mut meta);

        let target = meta
            .bindings_by_target
            .get("claude:default")
            .expect("default target binding");
        assert_eq!(target.provider_profile_id, None);
        assert_eq!(target.native_thread_id, "claude:session-1");
        assert_eq!(target.last_synced_turn_seq, 3);
        assert_eq!(target.availability, "ready");
    }

    #[test]
    fn sanitize_keeps_engine_binding_authoritative_for_default_identity() {
        let mut meta = meta_with_engine_binding(EngineType::Claude, "claude:session-new");
        meta.bindings_by_target.insert(
            "claude:default".to_string(),
            SharedTargetBindingMeta {
                binding_key: "claude:default".to_string(),
                engine: EngineType::Claude,
                provider_profile_id: None,
                native_thread_id: "claude:session-stale".to_string(),
                created_at: 9,
                last_used_at: 9,
                last_synced_turn_seq: 9,
                availability: "recovery-required".to_string(),
            },
        );
        sanitize_shared_session_meta(&mut meta);

        let target = meta
            .bindings_by_target
            .get("claude:default")
            .expect("default target binding");
        // 身份字段以 V0 engine binding 为准（回滚兼容）；availability 保留 V2 状态。
        assert_eq!(target.native_thread_id, "claude:session-new");
        assert_eq!(target.last_synced_turn_seq, 3);
        assert_eq!(target.availability, "recovery-required");
    }

    #[test]
    fn sanitize_preserves_managed_provider_targets_untouched() {
        let mut meta = meta_with_engine_binding(EngineType::Claude, "claude:session-1");
        meta.bindings_by_target.insert(
            "claude:openrouter".to_string(),
            SharedTargetBindingMeta {
                binding_key: "claude:openrouter".to_string(),
                engine: EngineType::Claude,
                provider_profile_id: Some("openrouter".to_string()),
                native_thread_id: "claude:session-or".to_string(),
                created_at: 5,
                last_used_at: 6,
                last_synced_turn_seq: 7,
                availability: "degraded".to_string(),
            },
        );
        sanitize_shared_session_meta(&mut meta);

        let managed = meta
            .bindings_by_target
            .get("claude:openrouter")
            .expect("managed provider binding");
        assert_eq!(managed.native_thread_id, "claude:session-or");
        assert_eq!(managed.last_synced_turn_seq, 7);
        assert_eq!(managed.availability, "degraded");
        assert!(meta.bindings_by_target.contains_key("claude:default"));
    }

    #[test]
    fn sanitize_drops_target_bindings_whose_engine_is_unsupported() {
        let mut meta = meta_with_engine_binding(EngineType::Claude, "claude:session-1");
        meta.bindings_by_target.insert(
            "gemini:default".to_string(),
            SharedTargetBindingMeta {
                binding_key: "gemini:default".to_string(),
                engine: EngineType::Gemini,
                provider_profile_id: None,
                native_thread_id: "gemini:session-1".to_string(),
                created_at: 1,
                last_used_at: 2,
                last_synced_turn_seq: 3,
                availability: "ready".to_string(),
            },
        );
        sanitize_shared_session_meta(&mut meta);

        assert!(!meta.bindings_by_target.contains_key("gemini:default"));
    }

    #[test]
    fn legacy_meta_without_target_map_deserializes_via_default() {
        let raw = json!({
            "id": "shared-1",
            "workspaceId": "ws-1",
            "title": "Shared Session",
            "createdAt": 1,
            "updatedAt": 2,
            "selectedEngine": "claude",
            "lastTurnSeq": 0,
            "bindingsByEngine": {},
        });
        let mut meta: SharedSessionMeta = serde_json::from_value(raw).expect("legacy meta parses");
        sanitize_shared_session_meta(&mut meta);
        assert_eq!(meta.schema_version, SHARED_SESSION_SCHEMA_VERSION);
        assert!(meta.bindings_by_target.is_empty());
    }
}
