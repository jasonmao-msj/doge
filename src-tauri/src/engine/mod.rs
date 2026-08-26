//! Multi-engine abstraction layer for CLI tools (Claude Code, Codex, Gemini, etc.)
//!
//! This module provides a unified interface for different AI coding assistants,
//! allowing the application to seamlessly switch between engines while maintaining
//! a consistent API.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub(crate) mod adapter_registry;
pub(crate) mod agent_event_bus;
#[cfg(test)]
mod capability_matrix;
pub mod claude;
pub mod claude_history;
#[cfg(test)]
mod claude_history_delete_tests;
pub(crate) mod claude_history_entries;
#[cfg(test)]
mod claude_history_issue529_tests;
pub(crate) mod claude_history_large_payload;
#[cfg(test)]
mod claude_history_large_payload_tests;
pub(crate) mod claude_history_subagents;
pub(crate) mod claude_message_content;
pub(crate) mod cli_image_input;
pub(crate) mod codex_adapter;
pub(crate) mod codex_prompt_service;
pub mod commands;
pub(crate) mod error_mapper;
pub mod events;
pub mod gemini;
pub mod gemini_history;
pub(crate) mod gemini_proxy_guard;
pub mod grok;
pub mod grok_history;
pub(crate) mod grok_provider_profile;
pub mod kimi;
pub mod kimi_history;
pub(crate) mod kimi_launch;
pub(crate) mod kimi_provider_profile;
pub mod manager;
pub mod opencode;
pub(crate) mod opencode_provider_profile;
pub(crate) mod remote_bridge;
pub mod rewind_commands;
pub mod session_history_commands;
pub mod status;
pub mod task_output;

// Re-exports for convenience
pub use commands::*;
pub use manager::EngineManager;
pub use rewind_commands::*;
pub use session_history_commands::*;
pub use status::resolve_engine_type;
pub use task_output::*;

/// Supported engine types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EngineType {
    /// Claude Code by Anthropic
    Claude,
    /// Codex CLI
    Codex,
    /// Google Gemini CLI
    Gemini,
    /// xAI Grok CLI
    Grok,
    /// OpenCode CLI
    OpenCode,
    /// Kimi Code CLI
    Kimi,
}

impl Default for EngineType {
    fn default() -> Self {
        EngineType::Claude // Default to Claude Code as per user requirement
    }
}

impl EngineType {
    /// Get display name for UI
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

    /// Get icon identifier for UI
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

pub(crate) fn disabled_engine_status(engine_type: EngineType) -> EngineStatus {
    let features = match engine_type {
        EngineType::Claude => EngineFeatures::claude(),
        EngineType::Codex => EngineFeatures::codex(),
        EngineType::Gemini => EngineFeatures::gemini(),
        EngineType::Grok => EngineFeatures::grok(),
        EngineType::OpenCode => EngineFeatures::opencode(),
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

impl std::fmt::Display for EngineType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.display_name())
    }
}

/// Engine installation and capability status
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    /// Engine type identifier
    pub engine_type: EngineType,
    /// Whether the CLI is installed and accessible
    pub installed: bool,
    /// CLI version string if available
    pub version: Option<String>,
    /// Path to the CLI binary
    pub bin_path: Option<String>,
    /// Home/config directory for the engine
    pub home_dir: Option<String>,
    /// Available models for this engine
    pub models: Vec<ModelInfo>,
    /// Default model ID
    pub default_model: Option<String>,
    /// Feature capabilities
    pub features: EngineFeatures,
    /// Error message if detection failed
    pub error: Option<String>,
}

/// Model information
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    /// Unique model identifier (e.g., "claude-sonnet-4-5-20250929")
    pub id: String,
    /// Runtime model value passed to the CLI.
    #[serde(default)]
    pub model: String,
    /// Human-readable name (e.g., "Claude Sonnet 4.5")
    #[serde(rename = "displayName")]
    pub name: String,
    /// Whether this is the default model
    #[serde(rename = "isDefault")]
    pub default: bool,
    /// Model description
    #[serde(default)]
    pub description: String,
    /// Provider name (e.g., "anthropic", "openai")
    #[serde(default)]
    pub provider: Option<String>,
    /// API/wire protocol, independent from provider identity.
    #[serde(default)]
    pub protocol: Option<String>,
    /// Source owner used to explain catalog precedence.
    #[serde(default)]
    pub provenance: Option<String>,
    /// Managed provider profile that owns this configured model.
    #[serde(default)]
    pub provider_profile_id: Option<String>,
    #[serde(default)]
    pub observed_at: Option<u64>,
    #[serde(default)]
    pub last_verified_at: Option<String>,
    #[serde(default)]
    pub lifecycle: Option<String>,
    /// Discovery/configuration source for diagnostics.
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

/// Engine feature capabilities
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineFeatures {
    /// Supports reasoning effort levels (low/medium/high)
    pub reasoning_effort: bool,
    /// Supports collaboration modes
    pub collaboration_mode: bool,
    /// Supports image input
    pub image_input: bool,
    /// Supports session resume/continue
    pub session_resume: bool,
    /// Supports tool/permission control
    pub tools_control: bool,
    /// Supports streaming output
    pub streaming: bool,
    /// Supports MCP (Model Context Protocol)
    pub mcp: bool,
}

impl EngineFeatures {
    /// Features for Claude Code
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

    /// Features for Codex
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

    /// Features for OpenCode
    pub fn opencode() -> Self {
        Self {
            reasoning_effort: false,
            collaboration_mode: false,
            // `opencode run -f <file>` attaches local images/files to the message.
            image_input: true,
            session_resume: true,
            tools_control: true,
            streaming: true,
            mcp: false,
        }
    }

    /// Features for Gemini
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

    /// Features for Kimi CLI
    pub fn kimi() -> Self {
        Self {
            reasoning_effort: false,
            collaboration_mode: false,
            // Headless: path tags + ReadMediaFile (print mode permission=auto).
            image_input: true,
            session_resume: true,
            tools_control: true,
            streaming: true,
            mcp: false,
        }
    }

    /// Features for Grok CLI
    pub fn grok() -> Self {
        Self {
            // Grok CLI: `--reasoning-effort` / `--effort` (TUI + headless).
            reasoning_effort: true,
            collaboration_mode: false,
            // Headless multimodal via `grok --prompt-file` ACP image blocks.
            image_input: true,
            session_resume: true,
            tools_control: true,
            streaming: true,
            mcp: false,
        }
    }
}

/// Parameters for sending a message to an engine
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageParams {
    /// The message text/prompt
    pub text: String,
    /// Model to use (optional, uses default if not specified)
    pub model: Option<String>,
    /// Reasoning effort level (for engines that support it)
    pub effort: Option<String>,
    /// Force-disable Claude Code extended thinking for this request.
    pub disable_thinking: bool,
    /// Access/permission mode
    pub access_mode: Option<String>,
    /// Image paths to include
    pub images: Option<Vec<String>>,
    /// Whether to continue from previous session
    pub continue_session: bool,
    /// Session ID to resume (for Claude)
    pub session_id: Option<String>,
    /// Parent session ID to fork from (for Claude)
    pub fork_session_id: Option<String>,
    /// Agent id/name (for OpenCode)
    pub agent: Option<String>,
    /// Variant/reasoning mode (for OpenCode)
    pub variant: Option<String>,
    /// Collaboration mode settings (for Codex)
    pub collaboration_mode: Option<Value>,
    /// Optional external OpenSpec root to expose for the session.
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

/// Engine configuration stored in app settings
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfig {
    /// Custom binary path (overrides default)
    pub bin_path: Option<String>,
    /// Custom home/config directory
    pub home_dir: Option<String>,
    /// Additional CLI arguments
    pub custom_args: Option<String>,
    /// Default model for this engine
    pub default_model: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_type_default_is_claude() {
        assert_eq!(EngineType::default(), EngineType::Claude);
    }

    #[test]
    fn engine_type_display_names() {
        assert_eq!(EngineType::Claude.display_name(), "Claude Code");
        assert_eq!(EngineType::Codex.display_name(), "Codex");
    }

    #[test]
    fn engine_type_serialization() {
        let claude = EngineType::Claude;
        let json = serde_json::to_string(&claude).unwrap();
        assert_eq!(json, "\"claude\"");

        let parsed: EngineType = serde_json::from_str("\"codex\"").unwrap();
        assert_eq!(parsed, EngineType::Codex);
    }

    #[test]
    fn model_info_builder() {
        let model = ModelInfo::new("test-model", "Test Model")
            .as_default()
            .with_provider("test-provider");

        assert_eq!(model.id, "test-model");
        assert!(model.default);
        assert_eq!(model.provider, Some("test-provider".to_string()));
    }

    #[test]
    fn engine_features_defaults() {
        let claude = EngineFeatures::claude();
        assert!(claude.reasoning_effort);
        assert!(claude.image_input);
        assert!(claude.session_resume);

        let codex = EngineFeatures::codex();
        assert!(codex.reasoning_effort);
        assert!(codex.collaboration_mode);

        let grok = EngineFeatures::grok();
        assert!(grok.reasoning_effort);
        assert!(grok.image_input);
        assert!(!grok.mcp);
    }

    #[test]
    fn gemini_runtime_policy_ignores_legacy_enabled_setting() {
        let mut settings = crate::types::AppSettings::default();
        settings.gemini_enabled = true;

        assert!(!engine_enabled_in_settings(&settings, EngineType::Gemini));
        assert_eq!(
            engine_disabled_diagnostic(EngineType::Gemini),
            Some(crate::engine_policy::GEMINI_DISABLED_DIAGNOSTIC)
        );
    }

    #[test]
    fn opencode_is_always_enabled_regardless_of_legacy_setting() {
        let mut settings = crate::types::AppSettings::default();
        settings.opencode_enabled = false;

        assert!(engine_enabled_in_settings(&settings, EngineType::OpenCode));
        assert_eq!(engine_disabled_diagnostic(EngineType::OpenCode), None);
    }
}
