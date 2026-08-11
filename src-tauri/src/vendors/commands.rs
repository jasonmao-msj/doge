use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::process::Command;
use tokio::time::timeout;

use crate::app_paths;
use crate::backend::app_server::build_codex_path_env;
use crate::types::{CodexProviderConfig, ProviderConfig};
use crate::utils::async_command;
#[cfg(windows)]
use crate::utils::async_command_with_console_visibility;

// ==================== Claude Settings Sync ====================

/// Fields in ~/.claude/settings.json that are managed by the system and should NOT be overwritten
const PROTECTED_SYSTEM_FIELDS: &[&str] = &[
    "mcpServers",
    "disabledMcpServers",
    "plugins",
    "trustedDirectories",
    "trustedFiles",
];

/// Fields that a provider's settingsConfig can manage (overwrite) in ~/.claude/settings.json
const PROVIDER_MANAGED_FIELDS: &[&str] = &[
    "env",
    "model",
    "alwaysThinkingEnabled",
    "autoDreamEnabled",
    "cleanupPeriodDays",
    "effortLevel",
    "hasCompletedOnboarding",
    "language",
    "skipAutoPermissionPrompt",
    "teammateMode",
    "tui",
    "codemossProviderId",
    "ccSwitchProviderId",
    "maxContextLengthTokens",
    "temperature",
    "topP",
    "topK",
];

const LOCAL_SETTINGS_PROVIDER_ID: &str = "__local_settings_json__";
const LOCAL_SETTINGS_PROVIDER_NAME: &str = "Local settings.json";
/// 「取消授权」伪供应商 id: 仅用于清空 current 标记, 不会出现在供应商列表中
const DISABLED_PROVIDER_ID: &str = "__disabled__";
const LOCAL_SETTINGS_PROVIDER_REMARK: &str =
    "Use configuration directly from ~/.claude/settings.json";
const LOCAL_PROVIDER_MODEL_MAPPING_KEYS: &[&str] = &[
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_FABLE_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
];
const GEMINI_PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(8);
const GEMINI_DEFAULT_AUTH_MODE: &str = "login_google";

fn effective_gemini_vendor_enabled(_requested: bool) -> bool {
    crate::engine_policy::GEMINI_RUNTIME_ENABLED
}

fn effective_gemini_vendor_enabled_default() -> bool {
    effective_gemini_vendor_enabled(false)
}

fn default_gemini_auth_mode() -> String {
    GEMINI_DEFAULT_AUTH_MODE.to_string()
}

fn claude_settings_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    Ok(home.join(".claude").join("settings.json"))
}

fn read_claude_settings() -> Result<serde_json::Map<String, Value>, String> {
    let path = claude_settings_path()?;
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read claude settings: {}", e))?;
    if content.trim().is_empty() {
        return Ok(serde_json::Map::new());
    }
    let val: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse claude settings: {}", e))?;
    match val {
        Value::Object(map) => Ok(map),
        _ => Ok(serde_json::Map::new()),
    }
}

fn atomic_write_claude_settings_content(content: &str) -> Result<(), String> {
    let path = claude_settings_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create claude settings dir: {}", e))?;
    }

    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, content)
        .map_err(|e| format!("Failed to write claude settings temp file: {}", e))?;
    std::fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to rename claude settings temp file: {}", e))
}

fn write_claude_settings(settings: &serde_json::Map<String, Value>) -> Result<(), String> {
    // Ensure env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1"
    let mut settings = settings.clone();
    let env = settings
        .entry("env")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    if let Value::Object(ref mut env_map) = env {
        env_map.insert(
            "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC".into(),
            Value::String("1".into()),
        );
    }

    let content = serde_json::to_string_pretty(&Value::Object(settings))
        .map_err(|e| format!("Failed to serialize claude settings: {}", e))?;

    atomic_write_claude_settings_content(&content)
}

#[tauri::command]
pub(crate) async fn vendor_read_claude_settings_json() -> Result<String, String> {
    let settings = read_claude_settings()?;
    serde_json::to_string_pretty(&Value::Object(settings))
        .map_err(|e| format!("Failed to serialize ~/.claude/settings.json: {}", e))
}

#[tauri::command]
pub(crate) async fn vendor_save_claude_settings_json(content: String) -> Result<(), String> {
    let value: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON in ~/.claude/settings.json: {}", e))?;
    let settings = match value {
        Value::Object(map) => map,
        _ => return Err("~/.claude/settings.json must contain a JSON object.".to_string()),
    };
    let content = serde_json::to_string_pretty(&Value::Object(settings))
        .map_err(|e| format!("Failed to serialize ~/.claude/settings.json: {}", e))?;
    atomic_write_claude_settings_content(&content)
}

fn ensure_local_claude_settings_ready() -> Result<(), String> {
    let path = claude_settings_path()?;
    if !path.exists() {
        return Err("~/.claude/settings.json does not exist. Please create it first.".to_string());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read ~/.claude/settings.json: {}", e))?;
    if content.trim().is_empty() {
        return Err("~/.claude/settings.json is empty. Please provide valid JSON.".to_string());
    }
    let value: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON in ~/.claude/settings.json: {}", e))?;
    if !value.is_object() {
        return Err("~/.claude/settings.json must contain a JSON object.".to_string());
    }
    Ok(())
}

fn extract_local_model_mapping_settings() -> Option<Value> {
    let settings = read_claude_settings().ok()?;
    let env = settings.get("env")?.as_object()?;

    let mut filtered_env = serde_json::Map::new();
    for key in LOCAL_PROVIDER_MODEL_MAPPING_KEYS {
        if let Some(value) = env.get(*key) {
            filtered_env.insert((*key).to_string(), value.clone());
        }
    }

    if filtered_env.is_empty() {
        return None;
    }

    let mut settings_config = serde_json::Map::new();
    settings_config.insert("env".into(), Value::Object(filtered_env));
    Some(Value::Object(settings_config))
}

fn build_local_provider(is_active: bool) -> ProviderConfig {
    ProviderConfig {
        id: LOCAL_SETTINGS_PROVIDER_ID.to_string(),
        name: LOCAL_SETTINGS_PROVIDER_NAME.to_string(),
        remark: Some(LOCAL_SETTINGS_PROVIDER_REMARK.to_string()),
        website_url: None,
        category: None,
        created_at: Some(0),
        sort_order: None,
        is_active,
        source: None,
        is_local_provider: Some(true),
        settings_config: extract_local_model_mapping_settings(),
        custom_models: None,
    }
}

/// Merge a managed provider's settingsConfig into `~/.claude/settings.json`.
///
/// **Not used by `vendor_switch_claude_provider`.** Managed multi-provider isolation
/// must not overwrite the user's local Claude settings on enable/switch. Session
/// launch injects env via provider profile + turn-scoped `--settings` instead.
///
/// Kept only for intentional/export tooling that explicitly needs disk materialize.
#[allow(dead_code)]
fn apply_provider_to_claude_settings(
    provider_value: &Value,
    provider_id: &str,
) -> Result<(), String> {
    let settings_config = match provider_value.get("settingsConfig") {
        Some(sc) if sc.is_object() => sc,
        _ => return Ok(()), // No settingsConfig, nothing to sync
    };

    let mut claude_settings = read_claude_settings()?;

    if let Value::Object(config_map) = settings_config {
        for (key, value) in config_map {
            if value.is_null() {
                continue;
            }
            if PROTECTED_SYSTEM_FIELDS.contains(&key.as_str()) {
                continue;
            }
            if PROVIDER_MANAGED_FIELDS.contains(&key.as_str()) {
                claude_settings.insert(key.clone(), value.clone());
            }
        }
    }

    // Tag with the provider ID for traceability
    claude_settings.insert(
        "codemossProviderId".into(),
        Value::String(provider_id.to_string()),
    );

    write_claude_settings(&claude_settings)
}

// ==================== Config File Types ====================

/// Represents the ~/.ccgui/config.json file structure shared with idea-claude-code-gui
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub(crate) struct DogeConfig {
    #[serde(default)]
    version: Option<Value>,
    #[serde(default)]
    claude: ClaudeSection,
    #[serde(default)]
    codex: CodexSection,
    #[serde(default)]
    gemini: GeminiSection,
    #[serde(default)]
    pub(crate) kimi: KimiSection,
    #[serde(default)]
    pub(crate) grok: GrokSection,
    #[serde(default)]
    pub(crate) opencode: OpenCodeSection,
    /// Preserve all other top-level fields (mcpServers, agents, ui, etc.)
    #[serde(flatten)]
    extra: HashMap<String, Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct ClaudeSection {
    #[serde(default)]
    providers: HashMap<String, Value>,
    #[serde(default)]
    current: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct CodexSection {
    #[serde(default)]
    providers: HashMap<String, Value>,
    #[serde(default)]
    current: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct GeminiSection {
    #[serde(default = "effective_gemini_vendor_enabled_default")]
    enabled: bool,
    #[serde(default)]
    env: HashMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    auth_mode: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub(crate) struct KimiSection {
    #[serde(default)]
    pub(crate) providers: HashMap<String, Value>,
    #[serde(default)]
    pub(crate) current: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub(crate) struct GrokSection {
    #[serde(default)]
    pub(crate) providers: HashMap<String, Value>,
    #[serde(default)]
    pub(crate) current: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub(crate) struct OpenCodeSection {
    #[serde(default)]
    pub(crate) providers: HashMap<String, Value>,
    #[serde(default)]
    pub(crate) current: Option<String>,
}

impl Default for GeminiSection {
    fn default() -> Self {
        Self {
            enabled: crate::engine_policy::GEMINI_RUNTIME_ENABLED,
            env: HashMap::new(),
            auth_mode: Some(default_gemini_auth_mode()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaudeCurrentConfig {
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    auth_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    provider_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    provider_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeminiVendorSettings {
    #[serde(default = "effective_gemini_vendor_enabled_default")]
    pub(crate) enabled: bool,
    #[serde(default)]
    pub(crate) env: BTreeMap<String, String>,
    #[serde(default = "default_gemini_auth_mode")]
    pub(crate) auth_mode: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeminiVendorPreflightCheck {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) status: String,
    pub(crate) message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeminiVendorPreflightResult {
    pub(crate) checks: Vec<GeminiVendorPreflightCheck>,
}

#[derive(Debug, Serialize)]
pub(crate) struct VendorModelListResult {
    pub(crate) models: Vec<String>,
    pub(crate) endpoint: String,
}

// ==================== Helpers ====================

fn push_unique_candidate(candidates: &mut Vec<String>, candidate: String) {
    if !candidate.trim().is_empty() && !candidates.contains(&candidate) {
        candidates.push(candidate);
    }
}

pub(crate) fn derive_model_list_candidates(base_url: &str) -> Vec<String> {
    let base = base_url.trim().trim_end_matches('/').to_string();
    if base.is_empty() {
        return Vec::new();
    }

    let mut candidates = Vec::new();
    push_unique_candidate(&mut candidates, format!("{base}/v1/models"));

    if base.ends_with("/v1") {
        push_unique_candidate(&mut candidates, format!("{base}/models"));
    }

    if let Some(stripped) = base.strip_suffix("/anthropic") {
        let stripped = stripped.trim_end_matches('/');
        if !stripped.is_empty() {
            push_unique_candidate(&mut candidates, format!("{stripped}/v1/models"));
        }
    }

    if let Ok(parsed) = reqwest::Url::parse(&base) {
        if let Some(host) = parsed.host_str() {
            let origin = match parsed.port() {
                Some(port) => format!("{}://{}:{}", parsed.scheme(), host, port),
                None => format!("{}://{}", parsed.scheme(), host),
            };
            push_unique_candidate(&mut candidates, format!("{origin}/v1/models"));
        }
    }

    candidates
}

fn push_model_id(models: &mut Vec<String>, value: &Value) {
    let candidate = match value {
        Value::String(value) => Some(value.as_str()),
        Value::Object(map) => map.get("id").and_then(Value::as_str),
        _ => None,
    };
    let Some(candidate) = candidate.map(str::trim).filter(|value| !value.is_empty()) else {
        return;
    };
    if !models.iter().any(|model| model == candidate) {
        models.push(candidate.to_string());
    }
}

pub(crate) fn extract_vendor_model_ids(value: &Value) -> Vec<String> {
    let mut models = Vec::new();

    if let Some(data) = value.get("data").and_then(Value::as_array) {
        for item in data {
            push_model_id(&mut models, item);
        }
        return models;
    }

    if let Some(data) = value.as_array() {
        for item in data {
            push_model_id(&mut models, item);
        }
        return models;
    }

    if let Some(data) = value.get("models").and_then(Value::as_array) {
        for item in data {
            push_model_id(&mut models, item);
        }
    }

    models
}

fn config_path() -> PathBuf {
    app_paths::config_file_path().unwrap_or_else(|_| PathBuf::from("config.json"))
}

pub(crate) fn read_config() -> Result<DogeConfig, String> {
    let path = config_path();
    if !path.exists() {
        return Ok(DogeConfig::default());
    }
    let content =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read config: {}", e))?;
    if content.trim().is_empty() {
        return Ok(DogeConfig::default());
    }
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))
}

pub(crate) fn write_config(config: &DogeConfig) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config dir: {}", e))?;
    }
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    std::fs::write(&path, content).map_err(|e| format!("Failed to write config: {}", e))
}

fn provider_created_at(value: &Value) -> Option<i64> {
    value.get("createdAt").and_then(Value::as_i64)
}

pub(crate) fn next_provider_created_at(providers: &HashMap<String, Value>) -> i64 {
    let next_from_existing = providers
        .values()
        .filter_map(provider_created_at)
        .max()
        .unwrap_or(0)
        .saturating_add(1);
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or(next_from_existing);
    now_ms.max(next_from_existing)
}

pub(crate) fn updated_provider_created_at(
    existing_provider: Option<&Value>,
    updates_created_at: Option<i64>,
) -> Option<i64> {
    existing_provider
        .and_then(provider_created_at)
        .or(updates_created_at)
}

pub(crate) fn set_provider_created_at(value: &mut Value, created_at: i64) {
    if let Value::Object(map) = value {
        map.insert("createdAt".into(), Value::Number(created_at.into()));
    }
}

fn sort_claude_providers_by_order(providers: &mut [ProviderConfig]) {
    providers.sort_by(|a, b| {
        a.sort_order
            .unwrap_or(i64::MAX)
            .cmp(&b.sort_order.unwrap_or(i64::MAX))
            .then_with(|| a.created_at.unwrap_or(0).cmp(&b.created_at.unwrap_or(0)))
            .then_with(|| a.id.cmp(&b.id))
    });
}

fn sort_codex_providers_by_order(providers: &mut [CodexProviderConfig]) {
    providers.sort_by(|a, b| {
        a.sort_order
            .unwrap_or(i64::MAX)
            .cmp(&b.sort_order.unwrap_or(i64::MAX))
            .then_with(|| a.created_at.unwrap_or(0).cmp(&b.created_at.unwrap_or(0)))
            .then_with(|| a.id.cmp(&b.id))
    });
}

fn resolve_provider_name(config: &DogeConfig, provider_id: &str) -> Option<String> {
    if provider_id == LOCAL_SETTINGS_PROVIDER_ID {
        return Some(LOCAL_SETTINGS_PROVIDER_NAME.to_string());
    }
    config
        .claude
        .providers
        .get(provider_id)
        .and_then(|provider| provider.get("name"))
        .and_then(|name| name.as_str())
        .map(String::from)
}

/// Convert a raw JSON Value from config.json providers map into ProviderConfig for frontend
fn value_to_claude_provider(
    id: &str,
    value: &Value,
    is_active: bool,
) -> Result<ProviderConfig, String> {
    let name = value
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let remark = value
        .get("remark")
        .and_then(|v| v.as_str())
        .map(String::from);
    let website_url = value
        .get("websiteUrl")
        .and_then(|v| v.as_str())
        .map(String::from);
    let category = value
        .get("category")
        .and_then(|v| v.as_str())
        .map(String::from);
    let created_at = value.get("createdAt").and_then(|v| v.as_i64());
    let sort_order = value.get("sortOrder").and_then(|v| v.as_i64());
    let source = value
        .get("source")
        .and_then(|v| v.as_str())
        .map(String::from);
    let is_local_provider = value.get("isLocalProvider").and_then(|v| v.as_bool());
    let settings_config = value.get("settingsConfig").cloned();
    let custom_models = value
        .get("customModels")
        .cloned()
        .and_then(|v| serde_json::from_value::<Vec<crate::types::CodexCustomModel>>(v).ok());

    Ok(ProviderConfig {
        id: id.to_string(),
        name,
        remark,
        website_url: website_url,
        category,
        created_at,
        sort_order,
        is_active,
        source,
        is_local_provider,
        settings_config,
        custom_models,
    })
}

/// Convert a ProviderConfig back to JSON Value for storage in config.json
fn claude_provider_to_value(provider: &ProviderConfig) -> Value {
    let mut map = serde_json::Map::new();
    map.insert("id".into(), Value::String(provider.id.clone()));
    map.insert("name".into(), Value::String(provider.name.clone()));
    if let Some(ref remark) = provider.remark {
        map.insert("remark".into(), Value::String(remark.clone()));
    }
    if let Some(ref url) = provider.website_url {
        map.insert("websiteUrl".into(), Value::String(url.clone()));
    }
    if let Some(ref cat) = provider.category {
        map.insert("category".into(), Value::String(cat.clone()));
    }
    if let Some(ts) = provider.created_at {
        map.insert("createdAt".into(), Value::Number(ts.into()));
    }
    if let Some(order) = provider.sort_order {
        map.insert("sortOrder".into(), Value::Number(order.into()));
    }
    if let Some(ref src) = provider.source {
        map.insert("source".into(), Value::String(src.clone()));
    }
    if let Some(local) = provider.is_local_provider {
        map.insert("isLocalProvider".into(), Value::Bool(local));
    }
    if let Some(ref sc) = provider.settings_config {
        map.insert("settingsConfig".into(), sc.clone());
    }
    if let Some(ref models) = provider.custom_models {
        if let Ok(v) = serde_json::to_value(models) {
            map.insert("customModels".into(), v);
        }
    }
    Value::Object(map)
}

fn value_to_codex_provider(
    id: &str,
    value: &Value,
    is_active: bool,
) -> Result<CodexProviderConfig, String> {
    let name = value
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let remark = value
        .get("remark")
        .and_then(|v| v.as_str())
        .map(String::from);
    let created_at = value.get("createdAt").and_then(|v| v.as_i64());
    let sort_order = value.get("sortOrder").and_then(|v| v.as_i64());
    let source = value
        .get("source")
        .and_then(|v| v.as_str())
        .map(String::from);
    let config_toml = value
        .get("configToml")
        .and_then(|v| v.as_str())
        .map(String::from);
    let auth_json = value
        .get("authJson")
        .and_then(|v| v.as_str())
        .map(String::from);
    let custom_models = value
        .get("customModels")
        .and_then(|v| serde_json::from_value(v.clone()).ok());

    Ok(CodexProviderConfig {
        id: id.to_string(),
        name,
        remark,
        created_at,
        sort_order,
        is_active,
        source,
        config_toml,
        auth_json,
        custom_models,
    })
}

fn codex_provider_to_value(provider: &CodexProviderConfig) -> Value {
    let mut map = serde_json::Map::new();
    map.insert("id".into(), Value::String(provider.id.clone()));
    map.insert("name".into(), Value::String(provider.name.clone()));
    if let Some(ref remark) = provider.remark {
        map.insert("remark".into(), Value::String(remark.clone()));
    }
    if let Some(ts) = provider.created_at {
        map.insert("createdAt".into(), Value::Number(ts.into()));
    }
    if let Some(order) = provider.sort_order {
        map.insert("sortOrder".into(), Value::Number(order.into()));
    }
    if let Some(ref src) = provider.source {
        map.insert("source".into(), Value::String(src.clone()));
    }
    if let Some(ref toml) = provider.config_toml {
        map.insert("configToml".into(), Value::String(toml.clone()));
    }
    if let Some(ref auth) = provider.auth_json {
        map.insert("authJson".into(), Value::String(auth.clone()));
    }
    if let Some(ref models) = provider.custom_models {
        if let Ok(v) = serde_json::to_value(models) {
            map.insert("customModels".into(), v);
        }
    }
    Value::Object(map)
}

fn normalize_gemini_auth_mode(mode: &str) -> String {
    let normalized = mode.trim().to_lowercase();
    match normalized.as_str() {
        "custom"
        | "login_google"
        | "gemini_api_key"
        | "vertex_adc"
        | "vertex_service_account"
        | "vertex_api_key" => normalized,
        _ => GEMINI_DEFAULT_AUTH_MODE.to_string(),
    }
}

fn sanitize_env_map(input: BTreeMap<String, String>) -> HashMap<String, String> {
    let mut output = HashMap::new();
    for (key, value) in input {
        let normalized_key = key.trim();
        if normalized_key.is_empty() {
            continue;
        }
        output.insert(normalized_key.to_string(), value.trim().to_string());
    }
    output
}

fn build_preflight_command(candidate: &str) -> Command {
    #[cfg(windows)]
    {
        // Some .cmd/.bat wrappers can fail with hidden console + piped stdio.
        let lower = candidate.to_ascii_lowercase();
        if lower.ends_with(".cmd") || lower.ends_with(".bat") {
            return async_command_with_console_visibility(candidate, false);
        }
        return async_command(candidate);
    }
    #[cfg(not(windows))]
    {
        async_command(candidate)
    }
}

async fn run_preflight_probe(command_candidates: &[&str], args: &[&str]) -> Result<String, String> {
    let path_env = build_codex_path_env(None);
    let mut last_error: Option<String> = None;

    for candidate in command_candidates {
        let mut cmd: Command = build_preflight_command(candidate);
        if let Some(path) = &path_env {
            cmd.env("PATH", path);
        }
        cmd.args(args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let output = match timeout(GEMINI_PREFLIGHT_TIMEOUT, cmd.output()).await {
            Ok(Ok(result)) => result,
            Ok(Err(error)) => {
                last_error = Some(format!("{} execution failed: {}", candidate, error));
                continue;
            }
            Err(_) => {
                last_error = Some(format!("{} timed out", candidate));
                continue;
            }
        };

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !stdout.is_empty() {
                return Ok(stdout);
            }
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Ok(if stderr.is_empty() {
                "ok".to_string()
            } else {
                stderr
            });
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        last_error = Some(if !stderr.is_empty() {
            format!("{} failed: {}", candidate, stderr)
        } else if !stdout.is_empty() {
            format!("{} failed: {}", candidate, stdout)
        } else {
            format!("{} exited with status {}", candidate, output.status)
        });
    }

    Err(last_error.unwrap_or_else(|| "command probe failed".to_string()))
}

fn build_preflight_check(
    id: &str,
    label: &str,
    result: Result<String, String>,
) -> GeminiVendorPreflightCheck {
    match result {
        Ok(message) => GeminiVendorPreflightCheck {
            id: id.to_string(),
            label: label.to_string(),
            status: "pass".to_string(),
            message,
        },
        Err(message) => GeminiVendorPreflightCheck {
            id: id.to_string(),
            label: label.to_string(),
            status: "fail".to_string(),
            message,
        },
    }
}

// ==================== Claude Provider Commands ====================

#[tauri::command]
pub(crate) async fn vendor_get_claude_providers() -> Result<Vec<ProviderConfig>, String> {
    let config = read_config()?;
    let current = config.claude.current.as_deref();
    let mut regular_providers: Vec<ProviderConfig> = config
        .claude
        .providers
        .iter()
        .filter_map(|(id, value)| {
            if id == LOCAL_SETTINGS_PROVIDER_ID {
                return None;
            }
            let is_active = current == Some(id.as_str());
            value_to_claude_provider(id, value, is_active).ok()
        })
        .collect();
    sort_claude_providers_by_order(&mut regular_providers);

    let mut providers = Vec::with_capacity(regular_providers.len() + 1);
    providers.push(build_local_provider(
        current == Some(LOCAL_SETTINGS_PROVIDER_ID),
    ));
    providers.extend(regular_providers);

    Ok(providers)
}

#[tauri::command]
pub(crate) async fn vendor_get_current_claude_config() -> Result<ClaudeCurrentConfig, String> {
    let settings = read_claude_settings()?;

    let mut api_key = String::new();
    let mut auth_type = "none".to_string();
    let mut base_url = String::new();

    if let Some(env) = settings.get("env").and_then(|v| v.as_object()) {
        if let Some(token) = env.get("ANTHROPIC_AUTH_TOKEN").and_then(|v| v.as_str()) {
            if !token.is_empty() {
                api_key = token.to_string();
                auth_type = "auth_token".to_string();
            }
        }
        if api_key.is_empty() {
            if let Some(key) = env.get("ANTHROPIC_API_KEY").and_then(|v| v.as_str()) {
                if !key.is_empty() {
                    api_key = key.to_string();
                    auth_type = "api_key".to_string();
                }
            }
        }
        if let Some(url) = env.get("ANTHROPIC_BASE_URL").and_then(|v| v.as_str()) {
            base_url = url.to_string();
        }
    }

    let provider_id = settings
        .get("codemossProviderId")
        .and_then(|v| v.as_str())
        .map(String::from);
    let provider_name = provider_id.as_ref().and_then(|id| {
        read_config()
            .ok()
            .and_then(|config| resolve_provider_name(&config, id))
    });

    Ok(ClaudeCurrentConfig {
        api_key,
        base_url,
        auth_type,
        provider_id,
        provider_name,
    })
}

#[tauri::command]
pub(crate) async fn vendor_add_claude_provider(provider: ProviderConfig) -> Result<(), String> {
    if provider.id == LOCAL_SETTINGS_PROVIDER_ID {
        return Err("Reserved provider id".to_string());
    }
    let mut config = read_config()?;
    if config.claude.providers.contains_key(&provider.id) {
        return Err(format!("Provider with id {} already exists", provider.id));
    }
    let created_at = provider
        .created_at
        .unwrap_or_else(|| next_provider_created_at(&config.claude.providers));
    let mut provider_value = claude_provider_to_value(&provider);
    set_provider_created_at(&mut provider_value, created_at);
    config
        .claude
        .providers
        .insert(provider.id.clone(), provider_value);
    write_config(&config)
}

#[tauri::command]
pub(crate) async fn vendor_update_claude_provider(
    id: String,
    updates: ProviderConfig,
) -> Result<(), String> {
    if id == LOCAL_SETTINGS_PROVIDER_ID {
        return Err("Local settings provider cannot be updated".to_string());
    }
    let mut config = read_config()?;
    if !config.claude.providers.contains_key(&id) {
        return Err(format!("Provider {} not found", id));
    }
    let existing_created_at =
        updated_provider_created_at(config.claude.providers.get(&id), updates.created_at);
    let mut provider_value = claude_provider_to_value(&updates);
    if let Some(created_at) = existing_created_at {
        set_provider_created_at(&mut provider_value, created_at);
    }
    config.claude.providers.insert(id, provider_value);
    write_config(&config)
}

#[tauri::command]
pub(crate) async fn vendor_reorder_claude_providers(
    ordered_ids: Vec<String>,
) -> Result<(), String> {
    let mut config = read_config()?;
    for (index, id) in ordered_ids.iter().enumerate() {
        if id == LOCAL_SETTINGS_PROVIDER_ID {
            continue;
        }
        let Some(Value::Object(provider)) = config.claude.providers.get_mut(id) else {
            continue;
        };
        provider.insert("sortOrder".into(), Value::Number((index as i64).into()));
    }
    write_config(&config)
}

#[tauri::command]
pub(crate) async fn vendor_delete_claude_provider(id: String) -> Result<(), String> {
    if id == LOCAL_SETTINGS_PROVIDER_ID {
        return Err("Local settings provider cannot be deleted".to_string());
    }
    let mut config = read_config()?;
    if config.claude.providers.remove(&id).is_none() {
        return Err(format!("Provider {} not found", id));
    }
    if config.claude.current.as_ref() == Some(&id) {
        config.claude.current = None;
    }
    write_config(&config)
}

/// L1 全局「启用 / 使用中」标记（配置页与新建菜单共用）。
///
/// - local：只标记 current=local，不改写用户 `~/.claude/settings.json` 内容（可读授权）
/// - managed：只更新 app 内 `claude.current`，**禁止** merge 盖写 `~/.claude/settings.json`
/// - 真正跑 managed 会话：thread `providerProfileId` + launch profile env + turn `--settings`
///   （见 `engine/claude/provider_profile.rs` / `ClaudeProviderSettingsOverride`）
///
/// 历史上 switch 会 `apply_provider_to_claude_settings`，导致「启用」毁掉独立供应商与
/// 用户本地配置；与 Codex 独立 home / 7-27 isolation 契约冲突。已移除盖盘。
#[tauri::command]
pub(crate) async fn vendor_switch_claude_provider(id: String) -> Result<(), String> {
    let mut config = read_config()?;
    // 「取消授权」语义: 清空 current 标记, 不触碰 ~/.claude/settings.json
    if id == DISABLED_PROVIDER_ID {
        config.claude.current = None;
        write_config(&config)?;
        return Ok(());
    }
    if id == LOCAL_SETTINGS_PROVIDER_ID {
        ensure_local_claude_settings_ready()?;
        config.claude.current = Some(id);
        write_config(&config)?;
        return Ok(());
    }
    // Managed: require provider exists, mark active only — never overwrite disk settings.
    if !config.claude.providers.contains_key(&id) {
        return Err(format!("Provider {} not found", id));
    }
    config.claude.current = Some(id);
    write_config(&config)?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn vendor_get_claude_always_thinking_enabled() -> Result<bool, String> {
    let settings = read_claude_settings()?;
    Ok(settings
        .get("alwaysThinkingEnabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

#[tauri::command]
pub(crate) async fn vendor_set_claude_always_thinking_enabled(enabled: bool) -> Result<(), String> {
    let mut settings = read_claude_settings()?;
    settings.insert("alwaysThinkingEnabled".into(), Value::Bool(enabled));
    write_claude_settings(&settings)
}

#[tauri::command]
pub(crate) async fn vendor_fetch_claude_models(
    base_url: String,
    api_key: String,
) -> Result<VendorModelListResult, String> {
    if base_url.trim().is_empty() {
        return Err("API URL is required".to_string());
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Failed to build HTTP client: {error}"))?;
    let api_key = api_key.trim().to_string();
    let mut last_error: Option<String> = None;

    for endpoint in derive_model_list_candidates(&base_url) {
        let response = match client
            .get(&endpoint)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("x-api-key", api_key.as_str())
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                last_error = Some(format!("{endpoint}: {error}"));
                continue;
            }
        };

        let status = response.status();
        if !status.is_success() {
            last_error = Some(format!("{endpoint} returned HTTP {status}"));
            continue;
        }

        let body = match response.text().await {
            Ok(body) => body,
            Err(error) => {
                last_error = Some(format!("{endpoint}: failed to read response body: {error}"));
                continue;
            }
        };

        let value = match serde_json::from_str::<Value>(&body) {
            Ok(value) => value,
            Err(error) => {
                last_error = Some(format!(
                    "{endpoint}: failed to parse JSON response: {error}"
                ));
                continue;
            }
        };

        return Ok(VendorModelListResult {
            models: extract_vendor_model_ids(&value),
            endpoint,
        });
    }

    Err(format!(
        "Failed to fetch models: {}",
        last_error.unwrap_or_else(|| "no candidate endpoint succeeded".to_string())
    ))
}

// ==================== Codex Provider Commands ====================

#[tauri::command]
pub(crate) async fn vendor_get_codex_providers() -> Result<Vec<CodexProviderConfig>, String> {
    let config = read_config()?;
    let current = config.codex.current.as_deref();
    let mut providers: Vec<CodexProviderConfig> = config
        .codex
        .providers
        .iter()
        .filter_map(|(id, value)| {
            let is_active = current == Some(id.as_str());
            value_to_codex_provider(id, value, is_active).ok()
        })
        .collect();
    sort_codex_providers_by_order(&mut providers);
    Ok(providers)
}

#[tauri::command]
pub(crate) async fn vendor_add_codex_provider(provider: CodexProviderConfig) -> Result<(), String> {
    let mut config = read_config()?;
    if config.codex.providers.contains_key(&provider.id) {
        return Err(format!(
            "Codex provider with id {} already exists",
            provider.id
        ));
    }
    let created_at = provider
        .created_at
        .unwrap_or_else(|| next_provider_created_at(&config.codex.providers));
    let mut provider_value = codex_provider_to_value(&provider);
    set_provider_created_at(&mut provider_value, created_at);
    config
        .codex
        .providers
        .insert(provider.id.clone(), provider_value);
    write_config(&config)
}

#[tauri::command]
pub(crate) async fn vendor_update_codex_provider(
    id: String,
    updates: CodexProviderConfig,
) -> Result<(), String> {
    let mut config = read_config()?;
    if !config.codex.providers.contains_key(&id) {
        return Err(format!("Codex provider {} not found", id));
    }
    let existing_created_at =
        updated_provider_created_at(config.codex.providers.get(&id), updates.created_at);
    let mut provider_value = codex_provider_to_value(&updates);
    if let Some(created_at) = existing_created_at {
        set_provider_created_at(&mut provider_value, created_at);
    }
    config.codex.providers.insert(id, provider_value);
    write_config(&config)
}

#[tauri::command]
pub(crate) async fn vendor_delete_codex_provider(id: String) -> Result<(), String> {
    let mut config = read_config()?;
    if config.codex.providers.remove(&id).is_none() {
        return Err(format!("Codex provider {} not found", id));
    }
    if config.codex.current.as_ref() == Some(&id) {
        config.codex.current = None;
    }
    write_config(&config)
}

#[tauri::command]
pub(crate) async fn vendor_switch_codex_provider(id: String) -> Result<(), String> {
    let mut config = read_config()?;
    // 「使用官方配置」: 清空 managed current，回退全局 ~/.codex
    if id == DISABLED_PROVIDER_ID {
        config.codex.current = None;
        write_config(&config)?;
        return Ok(());
    }
    if !config.codex.providers.contains_key(&id) {
        return Err(format!("Codex provider {} not found", id));
    }
    config.codex.current = Some(id);
    write_config(&config)
}

#[tauri::command]
pub(crate) async fn vendor_reorder_codex_providers(ordered_ids: Vec<String>) -> Result<(), String> {
    let mut config = read_config()?;
    apply_codex_provider_sort_order(&mut config, &ordered_ids);
    write_config(&config)
}

fn apply_codex_provider_sort_order(config: &mut DogeConfig, ordered_ids: &[String]) {
    for (index, id) in ordered_ids.iter().enumerate() {
        let Some(Value::Object(provider)) = config.codex.providers.get_mut(id) else {
            continue;
        };
        provider.insert("sortOrder".into(), Value::Number((index as i64).into()));
    }
}

// ==================== Gemini Vendor Commands ====================

#[tauri::command]
pub(crate) async fn vendor_get_gemini_settings() -> Result<GeminiVendorSettings, String> {
    let config = read_config()?;
    let mut env = BTreeMap::new();
    for (key, value) in config.gemini.env {
        let normalized_key = key.trim();
        if normalized_key.is_empty() {
            continue;
        }
        env.insert(normalized_key.to_string(), value);
    }
    Ok(GeminiVendorSettings {
        enabled: effective_gemini_vendor_enabled(config.gemini.enabled),
        env,
        auth_mode: config
            .gemini
            .auth_mode
            .as_deref()
            .map(normalize_gemini_auth_mode)
            .unwrap_or_else(default_gemini_auth_mode),
    })
}

#[tauri::command]
pub(crate) async fn vendor_save_gemini_settings(
    settings: GeminiVendorSettings,
) -> Result<(), String> {
    let mut config = read_config()?;
    config.gemini = GeminiSection {
        enabled: effective_gemini_vendor_enabled(settings.enabled),
        env: sanitize_env_map(settings.env),
        auth_mode: Some(normalize_gemini_auth_mode(&settings.auth_mode)),
    };
    write_config(&config)
}

#[tauri::command]
pub(crate) async fn vendor_gemini_preflight() -> Result<GeminiVendorPreflightResult, String> {
    if !crate::engine_policy::GEMINI_RUNTIME_ENABLED {
        let diagnostic = crate::engine_policy::GEMINI_DISABLED_DIAGNOSTIC;
        return Ok(GeminiVendorPreflightResult {
            checks: vec![
                build_preflight_check("gemini_version", "Gemini CLI", Err(diagnostic.to_string())),
                build_preflight_check("node", "Node.js", Err(format!("Skipped: {diagnostic}"))),
                build_preflight_check("npm", "npm", Err(format!("Skipped: {diagnostic}"))),
            ],
        });
    }

    let gemini_result =
        run_preflight_probe(&["gemini", "gemini.cmd", "gemini.exe"], &["--version"]).await;
    let node_result = run_preflight_probe(&["node", "node.exe"], &["--version"]).await;
    let npm_result = run_preflight_probe(&["npm", "npm.cmd", "npm.exe"], &["--version"]).await;

    let checks = vec![
        build_preflight_check("gemini_version", "Gemini CLI", gemini_result),
        build_preflight_check("node", "Node.js", node_result),
        build_preflight_check("npm", "npm", npm_result),
    ];

    Ok(GeminiVendorPreflightResult { checks })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn gemini_vendor_enabled_policy_forces_defaults_and_legacy_true_off() {
        let settings: GeminiVendorSettings =
            serde_json::from_str("{}").expect("deserialize default Gemini vendor settings");

        assert!(!settings.enabled);
        assert!(!effective_gemini_vendor_enabled(true));
    }

    #[tokio::test]
    async fn disabled_gemini_vendor_preflight_skips_all_process_probes() {
        let result = vendor_gemini_preflight()
            .await
            .expect("disabled Gemini preflight should return stable checks");

        assert_eq!(result.checks.len(), 3);
        assert!(result.checks.iter().all(|check| check.status == "fail"));
        assert!(result
            .checks
            .iter()
            .all(|check| check.message.contains("Gemini CLI is disabled")));
    }

    fn codex_provider(id: &str, created_at: Option<i64>) -> CodexProviderConfig {
        CodexProviderConfig {
            id: id.to_string(),
            name: id.to_string(),
            remark: None,
            created_at,
            sort_order: None,
            is_active: false,
            source: None,
            config_toml: None,
            auth_json: None,
            custom_models: None,
        }
    }

    fn claude_provider(
        id: &str,
        created_at: Option<i64>,
        sort_order: Option<i64>,
    ) -> ProviderConfig {
        ProviderConfig {
            id: id.to_string(),
            name: id.to_string(),
            remark: None,
            website_url: None,
            category: None,
            created_at,
            sort_order,
            is_active: false,
            source: None,
            is_local_provider: None,
            settings_config: None,
            custom_models: None,
        }
    }

    #[test]
    fn claude_provider_order_uses_sort_order_before_created_at() {
        let mut providers = vec![
            claude_provider("provider-created-first", Some(10), Some(2)),
            claude_provider("provider-sort-first", Some(30), Some(0)),
            claude_provider("provider-sort-second", Some(20), Some(1)),
        ];

        sort_claude_providers_by_order(&mut providers);

        let ordered_ids: Vec<&str> = providers
            .iter()
            .map(|provider| provider.id.as_str())
            .collect();
        assert_eq!(
            ordered_ids,
            vec![
                "provider-sort-first",
                "provider-sort-second",
                "provider-created-first",
            ]
        );
    }

    #[test]
    fn claude_provider_order_falls_back_to_created_at_without_sort_order() {
        let mut providers = vec![
            claude_provider("provider-c", Some(30), None),
            claude_provider("provider-b", Some(10), None),
            claude_provider("provider-a", Some(10), None),
        ];

        sort_claude_providers_by_order(&mut providers);

        let ordered_ids: Vec<&str> = providers
            .iter()
            .map(|provider| provider.id.as_str())
            .collect();
        assert_eq!(ordered_ids, vec!["provider-a", "provider-b", "provider-c"]);
    }

    #[test]
    fn claude_provider_order_places_missing_sort_order_after_ordered_entries() {
        let mut providers = vec![
            claude_provider("provider-created-first", Some(10), None),
            claude_provider("provider-sort-first", Some(30), Some(0)),
            claude_provider("provider-created-second", Some(20), None),
        ];

        sort_claude_providers_by_order(&mut providers);

        let ordered_ids: Vec<&str> = providers
            .iter()
            .map(|provider| provider.id.as_str())
            .collect();
        assert_eq!(
            ordered_ids,
            vec![
                "provider-sort-first",
                "provider-created-first",
                "provider-created-second",
            ]
        );
    }

    #[test]
    fn provider_order_uses_stable_tie_breaker_when_created_at_is_missing() {
        let mut providers = vec![
            codex_provider("provider-c", None),
            codex_provider("provider-a", None),
            codex_provider("provider-b", None),
        ];

        sort_codex_providers_by_order(&mut providers);

        let ordered_ids: Vec<&str> = providers
            .iter()
            .map(|provider| provider.id.as_str())
            .collect();
        assert_eq!(ordered_ids, vec!["provider-a", "provider-b", "provider-c"]);
    }

    #[test]
    fn provider_order_keeps_created_at_before_tie_breaker() {
        let mut providers = vec![
            codex_provider("provider-c", Some(30)),
            codex_provider("provider-b", Some(10)),
            codex_provider("provider-a", Some(10)),
        ];

        sort_codex_providers_by_order(&mut providers);

        let ordered_ids: Vec<&str> = providers
            .iter()
            .map(|provider| provider.id.as_str())
            .collect();
        assert_eq!(ordered_ids, vec!["provider-a", "provider-b", "provider-c"]);
    }

    #[test]
    fn codex_provider_order_prefers_sort_order_over_created_at() {
        let mut providers = vec![
            CodexProviderConfig {
                sort_order: Some(1),
                ..codex_provider("provider-created-first", Some(10))
            },
            CodexProviderConfig {
                sort_order: Some(0),
                ..codex_provider("provider-sort-first", Some(30))
            },
            codex_provider("provider-unordered", Some(20)),
        ];

        sort_codex_providers_by_order(&mut providers);

        let ordered_ids: Vec<&str> = providers
            .iter()
            .map(|provider| provider.id.as_str())
            .collect();
        assert_eq!(
            ordered_ids,
            vec![
                "provider-sort-first",
                "provider-created-first",
                "provider-unordered",
            ]
        );
    }

    #[test]
    fn apply_codex_provider_sort_order_writes_index_per_id() {
        let mut config = DogeConfig::default();
        config.codex.providers.insert(
            "a".to_string(),
            json!({ "id": "a", "name": "A", "createdAt": 10 }),
        );
        config.codex.providers.insert(
            "b".to_string(),
            json!({ "id": "b", "name": "B", "createdAt": 20 }),
        );

        apply_codex_provider_sort_order(
            &mut config,
            &["b".to_string(), "a".to_string(), "missing".to_string()],
        );

        assert_eq!(
            config.codex.providers["b"].get("sortOrder"),
            Some(&json!(0))
        );
        assert_eq!(
            config.codex.providers["a"].get("sortOrder"),
            Some(&json!(1))
        );
        // 未命中 id 静默跳过, 不新建条目
        assert!(!config.codex.providers.contains_key("missing"));
    }

    #[test]
    fn next_provider_created_at_appends_after_existing_timestamps() {
        let providers = HashMap::from([
            ("first".to_string(), json!({ "createdAt": 100 })),
            ("second".to_string(), json!({ "createdAt": 120 })),
        ]);

        assert!(next_provider_created_at(&providers) > 120);
    }

    #[test]
    fn set_provider_created_at_overwrites_storage_value() {
        let mut value = json!({ "name": "Provider", "createdAt": 10 });

        set_provider_created_at(&mut value, 42);

        assert_eq!(provider_created_at(&value), Some(42));
    }

    #[test]
    fn updated_provider_created_at_keeps_existing_order_timestamp() {
        let existing = json!({ "name": "Provider", "createdAt": 10 });

        let created_at = updated_provider_created_at(Some(&existing), Some(42));

        assert_eq!(created_at, Some(10));
    }

    #[test]
    fn derive_model_list_candidates_supports_origin_base_url() {
        assert_eq!(
            derive_model_list_candidates("https://api.example.com"),
            vec!["https://api.example.com/v1/models"]
        );
    }

    #[test]
    fn derive_model_list_candidates_supports_v1_base_url() {
        assert_eq!(
            derive_model_list_candidates("https://api.example.com/v1"),
            vec![
                "https://api.example.com/v1/v1/models",
                "https://api.example.com/v1/models",
            ]
        );
    }

    #[test]
    fn derive_model_list_candidates_supports_anthropic_base_url() {
        assert_eq!(
            derive_model_list_candidates("https://proxy.example.com/anthropic"),
            vec![
                "https://proxy.example.com/anthropic/v1/models",
                "https://proxy.example.com/v1/models",
            ]
        );
    }

    #[test]
    fn derive_model_list_candidates_trims_trailing_slashes_and_preserves_port() {
        assert_eq!(
            derive_model_list_candidates(" https://localhost:8787/api/anthropic/// "),
            vec![
                "https://localhost:8787/api/anthropic/v1/models",
                "https://localhost:8787/api/v1/models",
                "https://localhost:8787/v1/models",
            ]
        );
    }
}
