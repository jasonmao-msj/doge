use serde::{Deserialize, Serialize};
use serde_json::Value;

#[path = "../../engine/adapter_registry.rs"]
pub(crate) mod adapter_registry;
#[path = "../../engine/agent_event_bus.rs"]
pub(crate) mod agent_event_bus;
#[allow(dead_code)]
#[path = "../../engine/claude.rs"]
pub mod claude;
#[path = "../../engine/claude_history.rs"]
pub mod claude_history;
#[path = "../../engine/claude_history_entries.rs"]
pub(crate) mod claude_history_entries;
#[path = "../../engine/claude_history_large_payload.rs"]
pub(crate) mod claude_history_large_payload;
#[path = "../../engine/claude_history_subagents.rs"]
pub(crate) mod claude_history_subagents;
#[allow(dead_code)]
#[path = "../../engine/claude_message_content.rs"]
pub(crate) mod claude_message_content;
#[path = "../../engine/cli_image_input.rs"]
pub(crate) mod cli_image_input;
#[path = "../../engine/events.rs"]
pub mod events;
#[path = "../../engine/gemini.rs"]
pub mod gemini;
#[path = "../../engine/gemini_history.rs"]
pub mod gemini_history;
#[path = "../../engine/gemini_proxy_guard.rs"]
pub(crate) mod gemini_proxy_guard;
#[path = "../../engine/grok.rs"]
pub mod grok;
#[path = "../../engine/grok_history.rs"]
pub mod grok_history;
#[path = "../../engine/grok_provider_profile.rs"]
pub(crate) mod grok_provider_profile;
#[path = "../../engine/kimi.rs"]
pub mod kimi;
#[path = "../../engine/kimi_history.rs"]
pub mod kimi_history;
#[path = "../../engine/kimi_provider_profile.rs"]
pub(crate) mod kimi_provider_profile;
#[allow(dead_code)]
#[path = "../../engine/manager.rs"]
pub mod manager;
#[path = "../../engine/opencode.rs"]
pub mod opencode;
#[path = "../../engine/opencode_provider_profile.rs"]
pub(crate) mod opencode_provider_profile;
#[allow(dead_code)]
#[path = "../../engine/status.rs"]
pub mod status;

pub use manager::EngineManager;

pub mod commands {
    use std::collections::HashMap;
    use std::fs;
    use std::path::{Path, PathBuf};

    use serde::Serialize;
    use serde_json::{json, Value};

    use crate::backend::app_server::build_command_for_binary;
    use crate::types::WorkspaceEntry;

    use super::{manager::EngineManager, EngineConfig, EngineType};

    #[derive(Debug, Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct OpenCodeSessionEntry {
        pub session_id: String,
        pub title: String,
        pub updated_label: String,
        pub updated_at: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub directory: Option<String>,
    }

    fn strip_ansi_codes(input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        let mut chars = input.chars().peekable();
        while let Some(ch) = chars.next() {
            if ch == '\u{1b}' {
                if let Some('[') = chars.peek().copied() {
                    let _ = chars.next();
                    for c in chars.by_ref() {
                        if ('@'..='~').contains(&c) {
                            break;
                        }
                    }
                    continue;
                }
            }
            out.push(ch);
        }
        out
    }

    fn resolve_opencode_bin(config: Option<&EngineConfig>) -> Result<String, String> {
        let custom_bin = config.and_then(|item| item.bin_path.as_deref());
        crate::backend::app_server_cli::resolve_safe_opencode_binary(custom_bin)
            .map(|path| path.to_string_lossy().to_string())
    }

    fn build_opencode_command(
        config: Option<&EngineConfig>,
    ) -> Result<tokio::process::Command, String> {
        let mut cmd = build_command_for_binary(&resolve_opencode_bin(config)?);
        if let Some(home) = config.and_then(|item| item.home_dir.as_ref()) {
            cmd.env("OPENCODE_HOME", home);
        }
        Ok(cmd)
    }

    fn parse_opencode_session_list(stdout: &str) -> Vec<OpenCodeSessionEntry> {
        let clean = strip_ansi_codes(stdout);
        let trimmed = clean.trim();
        if trimmed.starts_with('[') {
            if let Ok(rows) = serde_json::from_str::<Vec<serde_json::Value>>(trimmed) {
                return rows
                    .into_iter()
                    .filter_map(|row| {
                        let session_id = row
                            .get("id")
                            .and_then(|value| value.as_str())
                            .unwrap_or("")
                            .trim();
                        if session_id.is_empty() || !session_id.starts_with("ses_") {
                            return None;
                        }
                        let title = row
                            .get("title")
                            .and_then(|value| value.as_str())
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .unwrap_or("Untitled")
                            .to_string();
                        let updated_at = row.get("updated").and_then(|value| value.as_i64());
                        let directory = row
                            .get("directory")
                            .and_then(|value| value.as_str())
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(str::to_string);
                        Some(OpenCodeSessionEntry {
                            session_id: session_id.to_string(),
                            title,
                            updated_label: String::new(),
                            updated_at,
                            directory,
                        })
                    })
                    .collect();
            }
        }

        let mut entries = Vec::new();
        for raw in clean.lines() {
            let trimmed = raw.trim();
            if trimmed.is_empty() || trimmed.starts_with("Session ID") || trimmed.starts_with('─')
            {
                continue;
            }
            let Some(session_id_end) = trimmed.find(char::is_whitespace) else {
                continue;
            };
            let session_id = trimmed[..session_id_end].trim();
            if session_id.is_empty() || !session_id.starts_with("ses_") {
                continue;
            }
            let rest = trimmed[session_id_end..].trim_start();
            if rest.is_empty() {
                continue;
            }
            let split_idx = rest.rfind("  ");
            let (title, updated_label) = if let Some(index) = split_idx {
                let title_text = rest[..index].trim();
                let updated_text = rest[index..].trim();
                (
                    if title_text.is_empty() {
                        "Untitled"
                    } else {
                        title_text
                    },
                    updated_text,
                )
            } else {
                (rest, "")
            };
            entries.push(OpenCodeSessionEntry {
                session_id: session_id.to_string(),
                title: title.to_string(),
                updated_label: updated_label.to_string(),
                updated_at: None,
                directory: None,
            });
        }
        entries
    }

    fn filter_opencode_sessions_for_workspace(
        entries: Vec<OpenCodeSessionEntry>,
        workspace_path: &Path,
    ) -> Vec<OpenCodeSessionEntry> {
        entries
            .into_iter()
            .filter(|entry| {
                let Some(directory) = entry
                    .directory
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                else {
                    return false;
                };
                crate::local_usage::path_matches_workspace(directory, workspace_path)
            })
            .collect()
    }

    fn opencode_session_candidate_paths(
        workspace_path: &Path,
        session_id: &str,
        config: Option<&EngineConfig>,
    ) -> Vec<PathBuf> {
        let mut roots = Vec::new();
        if let Some(home) = config.and_then(|item| item.home_dir.as_ref()) {
            roots.push(PathBuf::from(home).join("sessions"));
        }
        if let Some(home) = std::env::var_os("OPENCODE_HOME") {
            roots.push(PathBuf::from(home).join("sessions"));
        }
        if let Some(home) = dirs::home_dir() {
            roots.push(home.join(".opencode").join("sessions"));
        }
        roots.push(workspace_path.join(".opencode").join("sessions"));

        let mut candidates = Vec::new();
        for root in roots {
            for candidate in [
                root.join(session_id),
                root.join(format!("{session_id}.json")),
            ] {
                if !candidates.contains(&candidate) {
                    candidates.push(candidate);
                }
            }
        }
        candidates
    }

    fn opencode_data_candidate_roots(
        workspace_path: &Path,
        config: Option<&EngineConfig>,
    ) -> Vec<PathBuf> {
        let mut roots = Vec::new();
        if let Some(home) = config.and_then(|item| item.home_dir.as_ref()) {
            roots.push(PathBuf::from(home));
        }
        if let Some(home) = std::env::var_os("OPENCODE_HOME") {
            roots.push(PathBuf::from(home));
        }
        if let Some(data_home) = dirs::data_local_dir() {
            roots.push(data_home.join("opencode"));
        }
        if let Some(data_dir) = dirs::data_dir() {
            roots.push(data_dir.join("opencode"));
        }
        if let Some(home) = dirs::home_dir() {
            roots.push(home.join(".local").join("share").join("opencode"));
        }
        roots.push(workspace_path.join(".opencode"));

        let mut deduped = Vec::new();
        for root in roots {
            if !deduped.contains(&root) {
                deduped.push(root);
            }
        }
        deduped
    }

    fn delete_path_if_exists(path: &Path) -> Result<bool, String> {
        if !path.exists() {
            return Ok(false);
        }
        let result = if path.is_dir() {
            fs::remove_dir_all(path)
        } else {
            fs::remove_file(path)
        };
        match result {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(format!(
                "[IO_ERROR] Failed to delete OpenCode session path {}: {}",
                path.display(),
                error
            )),
        }
    }

    fn is_invalid_session_path_segment(session_id: &str) -> bool {
        session_id == "."
            || session_id.contains('/')
            || session_id.contains('\\')
            || session_id.contains("..")
    }

    fn delete_opencode_session_files(
        workspace_path: &Path,
        session_id: &str,
        config: Option<&EngineConfig>,
    ) -> Result<(), String> {
        let normalized_session_id = session_id.trim();
        if normalized_session_id.is_empty()
            || is_invalid_session_path_segment(normalized_session_id)
        {
            return Err("[SESSION_NOT_FOUND] Invalid OpenCode session id".to_string());
        }

        let mut deleted_any = false;

        for candidate in
            opencode_session_candidate_paths(workspace_path, normalized_session_id, config)
        {
            deleted_any |= delete_path_if_exists(&candidate)?;
        }

        for data_root in opencode_data_candidate_roots(workspace_path, config) {
            deleted_any |= delete_path_if_exists(
                &data_root
                    .join("storage")
                    .join(format!("{normalized_session_id}.json")),
            )?;
            deleted_any |= delete_path_if_exists(
                &data_root
                    .join("storage")
                    .join(normalized_session_id)
                    .join("messages.json"),
            )?;
        }

        if deleted_any {
            Ok(())
        } else {
            Err(format!(
                "[SESSION_NOT_FOUND] OpenCode session file not found: {}",
                normalized_session_id
            ))
        }
    }

    pub(crate) async fn opencode_session_list_core(
        workspaces: &tokio::sync::Mutex<HashMap<String, WorkspaceEntry>>,
        manager: &EngineManager,
        workspace_id: &str,
    ) -> Result<Vec<OpenCodeSessionEntry>, String> {
        let workspace_path = {
            let workspaces = workspaces.lock().await;
            workspaces
                .get(workspace_id)
                .map(|workspace| PathBuf::from(&workspace.path))
                .ok_or_else(|| "Workspace not found".to_string())?
        };
        let config = manager.get_engine_config(EngineType::OpenCode).await;
        let mut cmd = build_opencode_command(config.as_ref())?;
        cmd.current_dir(&workspace_path);
        cmd.arg("session");
        cmd.arg("list");
        cmd.arg("--format");
        cmd.arg("json");
        let output = cmd
            .output()
            .await
            .map_err(|error| format!("Failed to execute opencode session list: {error}"))?;
        if !output.status.success() {
            let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
            return Err(format!("opencode session list failed: {}", stderr.trim()));
        }
        let raw = parse_opencode_session_list(&String::from_utf8_lossy(&output.stdout));
        Ok(filter_opencode_sessions_for_workspace(raw, &workspace_path))
    }

    pub(crate) async fn opencode_delete_session_core(
        workspaces: &tokio::sync::Mutex<HashMap<String, WorkspaceEntry>>,
        manager: &EngineManager,
        workspace_id: &str,
        session_id: &str,
    ) -> Result<Value, String> {
        let workspace_path = {
            let workspaces = workspaces.lock().await;
            workspaces
                .get(workspace_id)
                .map(|workspace| PathBuf::from(&workspace.path))
                .ok_or_else(|| "[WORKSPACE_NOT_CONNECTED] Workspace not found".to_string())?
        };
        let config = manager.get_engine_config(EngineType::OpenCode).await;
        let mut cmd = build_opencode_command(config.as_ref())?;
        cmd.current_dir(&workspace_path);
        cmd.arg("session");
        cmd.arg("delete");
        cmd.arg(session_id);

        match cmd.output().await {
            Ok(output) if output.status.success() => Ok(json!({
                "deleted": true,
                "method": "cli",
            })),
            Ok(output) => {
                let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
                log::warn!(
                    "opencode session delete failed, fallback to filesystem delete: session_id={}, stderr={}",
                    session_id,
                    stderr.trim()
                );
                delete_opencode_session_files(&workspace_path, session_id, config.as_ref())?;
                Ok(json!({
                    "deleted": true,
                    "method": "filesystem",
                }))
            }
            Err(error) => {
                log::warn!(
                    "opencode session delete command unavailable, fallback to filesystem delete: session_id={}, error={}",
                    session_id,
                    error
                );
                delete_opencode_session_files(&workspace_path, session_id, config.as_ref())?;
                Ok(json!({
                    "deleted": true,
                    "method": "filesystem",
                }))
            }
        }
    }

    #[cfg(test)]
    mod tests {
        use super::is_invalid_session_path_segment;

        #[cfg(windows)]
        use super::{resolve_opencode_bin, EngineConfig};
        #[cfg(windows)]
        use std::fs;
        #[cfg(windows)]
        use std::time::{SystemTime, UNIX_EPOCH};

        #[test]
        fn opencode_session_id_rejects_path_like_segments() {
            assert!(is_invalid_session_path_segment("."));
            assert!(is_invalid_session_path_segment("../escape"));
            assert!(is_invalid_session_path_segment("folder/session"));
            assert!(is_invalid_session_path_segment(r"folder\session"));
            assert!(!is_invalid_session_path_segment("ses_valid"));
        }

        #[cfg(windows)]
        #[test]
        fn resolve_opencode_bin_rejects_launcher_like_windows_candidate() {
            let unique = format!(
                "ccgui-daemon-opencode-launcher-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            );
            let root = std::env::temp_dir().join(unique);
            let bin_path = root
                .join("AppData")
                .join("Local")
                .join("Programs")
                .join("OpenCode")
                .join("opencode.exe");
            fs::create_dir_all(bin_path.parent().expect("launcher dir"))
                .expect("create launcher dir");
            fs::write(&bin_path, []).expect("create fake launcher");

            let config = EngineConfig {
                bin_path: Some(bin_path.to_string_lossy().to_string()),
                ..EngineConfig::default()
            };
            let error = resolve_opencode_bin(Some(&config)).expect_err("unsafe launcher rejected");
            assert!(error.contains("[OPENCODE_CLI_UNSAFE]"));

            let _ = fs::remove_file(&bin_path);
            let _ = fs::remove_dir_all(&root);
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineType {
    Claude,
    Codex,
    Gemini,
    Grok,
    OpenCode,
    Kimi,
}

impl Default for EngineType {
    fn default() -> Self {
        EngineType::Claude
    }
}

impl EngineType {
    pub fn display_name(&self) -> &'static str {
        match self {
            EngineType::Claude => "Claude Code",
            EngineType::Codex => "Codex",
            EngineType::Gemini => "Gemini",
            EngineType::Grok => "Grok CLI",
            EngineType::OpenCode => "OpenCode",
            EngineType::Kimi => "Kimi CLI",
        }
    }

    pub fn icon(&self) -> &'static str {
        match self {
            EngineType::Claude => "claude",
            EngineType::Codex => "codex",
            EngineType::Gemini => "gemini",
            EngineType::Grok => "grok",
            EngineType::OpenCode => "opencode",
            EngineType::Kimi => "kimi",
        }
    }
}

impl std::fmt::Display for EngineType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.display_name())
    }
}

pub(crate) fn engine_enabled_in_settings(
    _settings: &crate::types::AppSettings,
    engine_type: EngineType,
) -> bool {
    match engine_type {
        EngineType::Gemini => crate::engine_policy::GEMINI_RUNTIME_ENABLED,
        EngineType::OpenCode
        | EngineType::Claude
        | EngineType::Codex
        | EngineType::Grok
        | EngineType::Kimi => true,
    }
}

pub(crate) fn engine_disabled_diagnostic(engine_type: EngineType) -> Option<&'static str> {
    match engine_type {
        EngineType::Gemini => Some(crate::engine_policy::GEMINI_DISABLED_DIAGNOSTIC),
        EngineType::OpenCode
        | EngineType::Claude
        | EngineType::Codex
        | EngineType::Grok
        | EngineType::Kimi => None,
    }
}

pub(crate) fn ensure_engine_enabled(
    settings: &crate::types::AppSettings,
    engine_type: EngineType,
) -> Result<(), String> {
    if engine_enabled_in_settings(settings, engine_type) {
        return Ok(());
    }
    Err(engine_disabled_diagnostic(engine_type)
        .unwrap_or("Engine is disabled in CLI validation settings")
        .to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub engine_type: EngineType,
    pub installed: bool,
    pub version: Option<String>,
    pub bin_path: Option<String>,
    pub home_dir: Option<String>,
    pub models: Vec<ModelInfo>,
    pub default_model: Option<String>,
    pub features: EngineFeatures,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    #[serde(default)]
    pub model: String,
    #[serde(rename = "displayName")]
    pub name: String,
    #[serde(rename = "isDefault")]
    pub default: bool,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub protocol: Option<String>,
    #[serde(default)]
    pub provenance: Option<String>,
    #[serde(default)]
    pub provider_profile_id: Option<String>,
    #[serde(default)]
    pub observed_at: Option<u64>,
    #[serde(default)]
    pub last_verified_at: Option<String>,
    #[serde(default)]
    pub lifecycle: Option<String>,
    #[serde(default = "default_model_source")]
    pub source: String,
}

fn default_model_source() -> String {
    "unknown".to_string()
}

impl ModelInfo {
    pub fn new(id: impl Into<String>, name: impl Into<String>) -> Self {
        let id = id.into();
        Self {
            model: id.clone(),
            id,
            name: name.into(),
            default: false,
            description: String::new(),
            provider: None,
            protocol: None,
            provenance: None,
            provider_profile_id: None,
            observed_at: None,
            last_verified_at: None,
            lifecycle: None,
            source: default_model_source(),
        }
    }

    pub fn as_default(mut self) -> Self {
        self.default = true;
        self
    }

    pub fn with_provider(mut self, provider: impl Into<String>) -> Self {
        self.provider = Some(provider.into());
        self
    }

    pub fn with_protocol(mut self, protocol: impl Into<String>) -> Self {
        self.protocol = Some(protocol.into());
        self
    }

    pub fn with_provenance(mut self, provenance: impl Into<String>) -> Self {
        self.provenance = Some(provenance.into());
        self
    }

    pub fn with_provider_profile_id(mut self, provider_profile_id: impl Into<String>) -> Self {
        self.provider_profile_id = Some(provider_profile_id.into());
        self
    }

    pub fn with_observed_at(mut self, observed_at: u64) -> Self {
        self.observed_at = Some(observed_at);
        self
    }

    pub fn with_fallback_freshness(
        mut self,
        last_verified_at: impl Into<String>,
        lifecycle: impl Into<String>,
    ) -> Self {
        self.last_verified_at = Some(last_verified_at.into());
        self.lifecycle = Some(lifecycle.into());
        self
    }

    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = description.into();
        self
    }

    pub fn with_runtime_model(mut self, model: impl Into<String>) -> Self {
        self.model = model.into();
        self
    }

    pub fn with_source(mut self, source: impl Into<String>) -> Self {
        let source = source.into();
        self.source = if source.trim().is_empty() {
            default_model_source()
        } else {
            source
        };
        self
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineFeatures {
    pub reasoning_effort: bool,
    pub collaboration_mode: bool,
    pub image_input: bool,
    pub session_resume: bool,
    pub tools_control: bool,
    pub streaming: bool,
    pub mcp: bool,
}

impl EngineFeatures {
    pub fn claude() -> Self {
        Self {
            reasoning_effort: true,
            collaboration_mode: false,
            image_input: true,
            session_resume: true,
            tools_control: true,
            streaming: true,
            mcp: true,
        }
    }

    pub fn codex() -> Self {
        Self {
            reasoning_effort: true,
            collaboration_mode: true,
            image_input: true,
            session_resume: true,
            tools_control: true,
            streaming: true,
            mcp: true,
        }
    }

    pub fn opencode() -> Self {
        Self {
            reasoning_effort: false,
            collaboration_mode: false,
            image_input: true,
            session_resume: true,
            tools_control: true,
            streaming: true,
            mcp: false,
        }
    }

    pub fn gemini() -> Self {
        Self {
            reasoning_effort: false,
            collaboration_mode: false,
            image_input: true,
            session_resume: true,
            tools_control: true,
            streaming: true,
            mcp: true,
        }
    }

    pub fn kimi() -> Self {
        Self {
            reasoning_effort: false,
            collaboration_mode: false,
            image_input: true,
            session_resume: true,
            tools_control: true,
            streaming: true,
            mcp: false,
        }
    }

    pub fn grok() -> Self {
        Self {
            reasoning_effort: true,
            collaboration_mode: false,
            image_input: true,
            session_resume: true,
            tools_control: true,
            streaming: true,
            mcp: false,
        }
    }
}

pub(crate) fn disabled_engine_status(engine_type: EngineType) -> EngineStatus {
    let features = match engine_type {
        EngineType::Claude => EngineFeatures::claude(),
        EngineType::Codex => EngineFeatures::codex(),
        EngineType::Gemini => EngineFeatures::gemini(),
        EngineType::OpenCode => EngineFeatures::opencode(),
        EngineType::Grok => EngineFeatures::grok(),
        EngineType::Kimi => EngineFeatures::kimi(),
    };
    EngineStatus {
        engine_type,
        installed: false,
        version: None,
        bin_path: None,
        home_dir: None,
        models: Vec::new(),
        default_model: None,
        features,
        error: engine_disabled_diagnostic(engine_type).map(str::to_string),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageParams {
    pub text: String,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub disable_thinking: bool,
    pub access_mode: Option<String>,
    pub images: Option<Vec<String>>,
    pub continue_session: bool,
    pub session_id: Option<String>,
    pub fork_session_id: Option<String>,
    pub agent: Option<String>,
    pub variant: Option<String>,
    pub collaboration_mode: Option<Value>,
    pub custom_spec_root: Option<String>,
}

impl Default for SendMessageParams {
    fn default() -> Self {
        Self {
            text: String::new(),
            model: None,
            effort: None,
            disable_thinking: false,
            access_mode: None,
            images: None,
            continue_session: false,
            session_id: None,
            fork_session_id: None,
            agent: None,
            variant: None,
            collaboration_mode: None,
            custom_spec_root: None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfig {
    pub bin_path: Option<String>,
    pub home_dir: Option<String>,
    pub custom_args: Option<String>,
    pub default_model: Option<String>,
}

#[cfg(test)]
mod runtime_policy_tests {
    use super::{
        engine_disabled_diagnostic, engine_enabled_in_settings, ensure_engine_enabled, EngineType,
    };

    #[test]
    fn daemon_gemini_runtime_policy_ignores_legacy_enabled_setting() {
        let mut settings = crate::types::AppSettings::default();
        settings.gemini_enabled = true;

        assert!(!engine_enabled_in_settings(&settings, EngineType::Gemini));
        assert_eq!(
            ensure_engine_enabled(&settings, EngineType::Gemini),
            Err(crate::engine_policy::GEMINI_DISABLED_DIAGNOSTIC.to_string())
        );
        assert_eq!(
            engine_disabled_diagnostic(EngineType::Gemini),
            Some(crate::engine_policy::GEMINI_DISABLED_DIAGNOSTIC)
        );
    }

    #[test]
    fn daemon_opencode_is_always_enabled_regardless_of_legacy_setting() {
        let mut settings = crate::types::AppSettings::default();
        settings.opencode_enabled = false;

        assert!(engine_enabled_in_settings(&settings, EngineType::OpenCode));
        assert_eq!(
            ensure_engine_enabled(&settings, EngineType::OpenCode),
            Ok(())
        );
        assert_eq!(engine_disabled_diagnostic(EngineType::OpenCode), None);
    }
}
