//! Tauri commands for engine management
//!
//! Provides frontend-accessible commands for engine detection, switching,
//! and configuration.

use chrono::{
    DateTime, Duration as ChronoDuration, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;

use crate::backend::events::AppServerEvent;
use crate::remote_backend;
use crate::session_management::{self, AutoSessionMetadata};
use crate::state::AppState;
use crate::types::WorkspaceEntry;

use super::codex_prompt_service::{normalize_custom_spec_root, run_codex_prompt_sync};
use super::events::{engine_event_to_app_server_event_with_turn_context, EngineEvent};
use super::grok::resolve_grok_session_id_for_engine_send;
use super::kimi::resolve_kimi_session_id_for_engine_send;
use super::remote_bridge::{
    call_remote_typed, remote_detect_engines_request, remote_engine_interrupt_request,
    remote_engine_send_message_sync_request,
};
use super::status::{detect_grok_status, detect_kimi_status, load_opencode_models};
use super::{
    engine_disabled_diagnostic, engine_enabled_in_settings, EngineConfig, EngineStatus, EngineType,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredEngineActiveProcessDiagnostic {
    pub pid: u32,
    pub registered_age_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineWorkspaceActiveProcessDiagnostics {
    pub workspace_id: String,
    pub engine: EngineType,
    pub active_process_ids: Vec<u32>,
    pub registered_active_processes: Vec<RegisteredEngineActiveProcessDiagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineActiveProcessDiagnostics {
    pub measured: bool,
    pub sampled_at_ms: u64,
    pub total_active_process_count: usize,
    pub workspaces: Vec<EngineWorkspaceActiveProcessDiagnostics>,
    pub unsupported_reason: Option<String>,
    /// Separate OS-level child process liveness evidence. The total_active_process_count
    /// above counts handles still registered in the runtime maps; this field makes
    /// clear that the registry count is NOT proof of OS process exit.
    pub os_child_liveness: OsChildLivenessEvidence,
    /// Diagnostics-only stale child candidates. The reconciler never auto-kills.
    pub stale_child_candidates: Vec<StaleChildCandidate>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsChildLivenessEvidence {
    /// "measured" | "proxy" | "manual-only" | "unsupported"
    pub evidence_class: &'static str,
    pub sampled_after_close_ms: u64,
    pub sampled_os_child_count: Option<u32>,
    pub sampler: Option<String>,
    /// Bounded rationale when evidence is unsupported or manual-only.
    pub rationale: Option<String>,
}

impl OsChildLivenessEvidence {
    fn unsupported(rationale: &str) -> Self {
        Self {
            evidence_class: "unsupported",
            sampled_after_close_ms: 0,
            sampled_os_child_count: None,
            sampler: None,
            rationale: Some(rationale.to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaleChildCandidate {
    pub workspace_id: String,
    pub engine: String,
    pub pid: u32,
    pub registered_age_ms: u64,
    pub stale_reason: String,
    /// "timing-only" | "unsupported" — only Claude has structured stream timing
    /// metadata; OpenCode/Gemini currently emit age-only and report unsupported.
    pub progress_evidence: String,
}

#[path = "claude_forwarder.rs"]
mod claude_forwarder;
#[path = "commands_opencode.rs"]
mod commands_opencode;
#[path = "commands_opencode_helpers.rs"]
mod opencode_helpers;
#[path = "commands_parse_helpers.rs"]
mod parse_helpers;
use claude_forwarder::{
    handle_claude_forwarder_event, ClaudeForwarderRuntimeContext, ClaudeForwarderState,
};
pub use commands_opencode::*;
use opencode_helpers::*;
use parse_helpers::*;

/// Gemini may emit fallback reasoning shortly after turn/completed.
/// Keep the forwarder alive briefly so realtime reasoning is not dropped.
const GEMINI_POST_COMPLETION_REASONING_GRACE_MS: u64 = 8_000;

fn unix_timestamp_ms_for_diagnostics() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn has_non_empty_images(images: &Option<Vec<String>>) -> bool {
    images
        .as_ref()
        .is_some_and(|entries| entries.iter().any(|entry| !entry.trim().is_empty()))
}

fn features_for_engine(engine: EngineType) -> super::EngineFeatures {
    match engine {
        EngineType::Claude => super::EngineFeatures::claude(),
        EngineType::Codex => super::EngineFeatures::codex(),
        EngineType::Gemini => super::EngineFeatures::gemini(),
        EngineType::Grok => super::EngineFeatures::grok(),
        EngineType::OpenCode => super::EngineFeatures::opencode(),
        EngineType::Kimi => super::EngineFeatures::kimi(),
    }
}

/// Reject non-empty image payloads when `EngineFeatures.image_input = false`.
/// Current engines all report `image_input = true`; this remains as a guard for
/// future unsupported engines.
pub(crate) fn require_image_support(
    engine: EngineType,
    images: &Option<Vec<String>>,
) -> Result<(), String> {
    if features_for_engine(engine).image_input {
        return Ok(());
    }
    if has_non_empty_images(images) {
        return Err(format!(
            "{} does not support image input in this release",
            engine.display_name()
        ));
    }
    Ok(())
}

fn build_engine_active_process_diagnostics(
    sampled_at_ms: u64,
    mut workspaces: Vec<EngineWorkspaceActiveProcessDiagnostics>,
    stale_child_candidates: Vec<StaleChildCandidate>,
) -> EngineActiveProcessDiagnostics {
    workspaces.sort_by(|left, right| left.workspace_id.cmp(&right.workspace_id));
    let total_active_process_count = workspaces
        .iter()
        .map(|workspace| workspace.active_process_ids.len())
        .sum();

    EngineActiveProcessDiagnostics {
        measured: true,
        sampled_at_ms,
        total_active_process_count,
        workspaces,
        unsupported_reason: None,
        // OS process liveness sampling is intentionally split from the registry
        // count. The runtime does not ship a cross-platform OS process sampler
        // (no /proc, no ps binding, no Windows API helper), so this is currently
        // reported as `unsupported` rather than inferred from registry zero.
        os_child_liveness: OsChildLivenessEvidence::unsupported(
            "Runtime does not ship a cross-platform OS child process sampler. Registry total_active_process_count=0 means no handles are registered; it does NOT prove OS processes have been reaped.",
        ),
        stale_child_candidates,
    }
}

const STALE_CHILD_CANDIDATE_MIN_AGE_MS: u64 = 5 * 60 * 1000;

fn collect_stale_child_candidates(
    workspaces: &[EngineWorkspaceActiveProcessDiagnostics],
    sampled_at_ms: u64,
) -> Vec<StaleChildCandidate> {
    // Diagnostics-only: report candidates without killing. Engines without
    // progress metadata (OpenCode, Gemini) emit progress_evidence=unsupported.
    let mut candidates = Vec::new();
    for workspace in workspaces {
        for process in &workspace.registered_active_processes {
            if process.registered_age_ms < STALE_CHILD_CANDIDATE_MIN_AGE_MS {
                continue;
            }
            let progress_evidence = match workspace.engine {
                EngineType::Claude => "timing-only",
                EngineType::OpenCode | EngineType::Gemini | EngineType::Grok | EngineType::Kimi => {
                    "unsupported"
                }
                // Codex is intentionally not part of this child-process parity
                // path (it has its own wrapper runtime).
                EngineType::Codex => "unsupported",
            };
            candidates.push(StaleChildCandidate {
                workspace_id: workspace.workspace_id.clone(),
                engine: engine_type_label(workspace.engine).to_string(),
                pid: process.pid,
                registered_age_ms: process.registered_age_ms,
                stale_reason: "diagnostics-only-candidate".to_string(),
                progress_evidence: progress_evidence.to_string(),
            });
        }
    }
    let _ = sampled_at_ms;
    candidates
}

fn engine_type_label(engine: EngineType) -> &'static str {
    match engine {
        EngineType::Claude => "claude",
        EngineType::OpenCode => "opencode",
        EngineType::Gemini => "gemini",
        EngineType::Codex => "codex",
        EngineType::Grok => "grok",
        EngineType::Kimi => "kimi",
    }
}

async fn record_auto_session_metadata_if_present(
    state: &AppState,
    workspace_id: &str,
    session_id: Option<&str>,
    metadata: Option<AutoSessionMetadata>,
    engine_prefix: &str,
) {
    let (Some(session_id), Some(metadata)) = (session_id, metadata) else {
        return;
    };
    let _ = session_management::record_auto_session_metadata_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id.to_string(),
        format!("{engine_prefix}:{session_id}"),
        metadata,
    )
    .await;
}

async fn record_claude_auto_session_metadata_for_sync_result(
    workspaces: &tokio::sync::Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    workspace_id: &str,
    send_succeeded: bool,
    response_session_id: Option<&str>,
    observed_session_id: Option<&str>,
    metadata: Option<AutoSessionMetadata>,
) {
    let metadata_session_id = resolve_claude_auto_session_metadata_session_id(
        send_succeeded,
        response_session_id,
        observed_session_id,
    );
    let (Some(session_id), Some(metadata)) = (metadata_session_id, metadata) else {
        return;
    };
    let _ = session_management::record_auto_session_metadata_core(
        workspaces,
        storage_path,
        workspace_id.to_string(),
        format!("claude:{session_id}"),
        metadata,
    )
    .await;
}

fn resolve_claude_session_id_for_engine_send(
    normalized_fork_session_id: Option<&str>,
    explicit_session_id: Option<String>,
    continue_session: bool,
    tracked_session_id: Option<String>,
) -> Option<String> {
    if normalized_fork_session_id.is_some() {
        return None;
    }
    if continue_session {
        return explicit_session_id.or(tracked_session_id);
    }
    Some(explicit_session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
}

fn resolve_claude_auto_session_metadata_session_id(
    send_succeeded: bool,
    response_session_id: Option<&str>,
    observed_session_id: Option<&str>,
) -> Option<String> {
    if send_succeeded {
        return response_session_id.map(str::to_string);
    }

    let expected_session_id = response_session_id?;
    let observed_session_id = observed_session_id?;
    if observed_session_id == expected_session_id {
        return Some(observed_session_id.to_string());
    }
    None
}

/// Claude `/context` probing happens after the CLI turn completes. Keep the
/// forwarder subscribed long enough for the post-completion UsageUpdate.
const CLAUDE_POST_COMPLETION_USAGE_GRACE_MS: u64 = 35_000;

async fn read_app_settings_snapshot(state: &State<'_, AppState>) -> crate::types::AppSettings {
    state.app_settings.lock().await.clone()
}

fn ensure_engine_enabled(
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

fn resolve_enabled_engine_for_send(
    settings: &crate::types::AppSettings,
    requested_engine: Option<EngineType>,
    active_engine: EngineType,
) -> Result<EngineType, String> {
    let effective_engine = requested_engine.unwrap_or(active_engine);
    ensure_engine_enabled(settings, effective_engine)?;
    Ok(effective_engine)
}

fn validate_remote_requested_engine(
    settings: &crate::types::AppSettings,
    requested_engine: Option<EngineType>,
) -> Result<Option<EngineType>, String> {
    if let Some(engine_type) = requested_engine {
        ensure_engine_enabled(settings, engine_type)?;
    }
    Ok(requested_engine)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum GeminiRenderLane {
    Text,
    Reasoning,
    Tool,
    Other,
}

impl Default for GeminiRenderLane {
    fn default() -> Self {
        Self::Other
    }
}

#[derive(Default)]
struct GeminiRenderRoutingState {
    last_render_lane: GeminiRenderLane,
    text_run_index: usize,
    reasoning_run_index: usize,
    active_text_item_id: Option<String>,
    active_reasoning_item_id: Option<String>,
    saw_text_delta: bool,
}

fn next_gemini_routed_item_id(
    state: &mut GeminiRenderRoutingState,
    render_lane: GeminiRenderLane,
    base_item_id: &str,
) -> String {
    if matches!(render_lane, GeminiRenderLane::Text)
        && (state.last_render_lane != GeminiRenderLane::Text || state.active_text_item_id.is_none())
    {
        state.text_run_index += 1;
        let text_item_id = if state.text_run_index == 1 {
            base_item_id.to_string()
        } else {
            format!("{base_item_id}:text-{}", state.text_run_index)
        };
        state.active_text_item_id = Some(text_item_id);
    }

    if matches!(render_lane, GeminiRenderLane::Reasoning)
        && (state.last_render_lane != GeminiRenderLane::Reasoning
            || state.active_reasoning_item_id.is_none())
    {
        state.reasoning_run_index += 1;
        state.active_reasoning_item_id = Some(format!(
            "{base_item_id}:reasoning-seg-{}",
            state.reasoning_run_index
        ));
    }

    let routed_item_id = match render_lane {
        GeminiRenderLane::Text => state
            .active_text_item_id
            .clone()
            .unwrap_or_else(|| base_item_id.to_string()),
        GeminiRenderLane::Reasoning => state
            .active_reasoning_item_id
            .clone()
            .unwrap_or_else(|| base_item_id.to_string()),
        GeminiRenderLane::Tool | GeminiRenderLane::Other => base_item_id.to_string(),
    };

    if !matches!(render_lane, GeminiRenderLane::Other) {
        state.last_render_lane = render_lane;
        if !matches!(render_lane, GeminiRenderLane::Reasoning) {
            state.active_reasoning_item_id = None;
        }
        if !matches!(render_lane, GeminiRenderLane::Text) {
            state.active_text_item_id = None;
        }
    }

    routed_item_id
}

/// Prefer the last text-lane item id so synthetic `item/completed` upserts the
/// same assistant bubble as streamed TextDelta (Claude-parity; avoids double bubbles).
pub(crate) fn gemini_agent_completion_item_id(
    state: &GeminiRenderRoutingState,
    base_item_id: &str,
) -> String {
    if let Some(id) = state.active_text_item_id.as_ref() {
        return id.clone();
    }
    match state.text_run_index {
        0 | 1 => base_item_id.to_string(),
        n => format!("{base_item_id}:text-{n}"),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeCommandEntry {
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "argumentHint")]
    pub argument_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeAgentEntry {
    pub id: String,
    pub description: Option<String>,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeProviderHealth {
    pub provider: String,
    pub connected: bool,
    pub credential_count: usize,
    pub matched: bool,
    pub authenticated_providers: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeMcpServerState {
    pub name: String,
    pub enabled: bool,
    pub status: Option<String>,
    pub permission_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeStatusSnapshot {
    pub session_id: Option<String>,
    pub model: Option<String>,
    pub agent: Option<String>,
    pub variant: Option<String>,
    pub provider: Option<String>,
    pub provider_health: OpenCodeProviderHealth,
    pub mcp_enabled: bool,
    pub mcp_servers: Vec<OpenCodeMcpServerState>,
    pub mcp_raw: String,
    pub managed_toggles: bool,
    pub token_usage: Option<u64>,
    pub context_window: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeSessionEntry {
    pub session_id: String,
    pub title: String,
    pub updated_label: String,
    pub updated_at: Option<i64>,
    /// Session working directory from OpenCode (`session list --format json`).
    /// Used to filter out global/foreign project leakage into empty workspaces.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub directory: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeProviderOption {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
    pub category: String,
    pub recommended: bool,
}

#[derive(Debug, Clone, Default)]
struct OpenCodeMcpToggleState {
    global_enabled: bool,
    server_enabled: HashMap<String, bool>,
}

const OPENCODE_CACHE_TTL: Duration = Duration::from_secs(30);
static OPENCODE_COMMANDS_CACHE: OnceLock<Mutex<Option<(Instant, Vec<OpenCodeCommandEntry>)>>> =
    OnceLock::new();
static OPENCODE_AGENTS_CACHE: OnceLock<Mutex<Option<(Instant, Vec<OpenCodeAgentEntry>)>>> =
    OnceLock::new();
static OPENCODE_MCP_TOGGLE_STATE: OnceLock<Mutex<HashMap<String, OpenCodeMcpToggleState>>> =
    OnceLock::new();

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

fn extract_turn_result_text_internal(value: &Value, depth: usize) -> Option<String> {
    if depth > 4 {
        return None;
    }
    if let Some(text) = value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        return Some(text.to_string());
    }
    if let Some(array) = value.as_array() {
        let mut merged = String::new();
        for item in array {
            if let Some(text) = extract_turn_result_text_internal(item, depth + 1) {
                if !merged.is_empty() {
                    merged.push('\n');
                }
                merged.push_str(&text);
            }
        }
        return if merged.trim().is_empty() {
            None
        } else {
            Some(merged)
        };
    }
    if let Some(object) = value.as_object() {
        for key in [
            "text",
            "delta",
            "output_text",
            "outputText",
            "content",
            "message",
        ] {
            if let Some(text) = object
                .get(key)
                .and_then(|entry| entry.as_str())
                .map(str::trim)
                .filter(|entry| !entry.is_empty())
            {
                return Some(text.to_string());
            }
        }
        for key in [
            "result", "response", "content", "message", "output", "data", "payload",
        ] {
            if let Some(entry) = object.get(key) {
                if let Some(text) = extract_turn_result_text_internal(entry, depth + 1) {
                    return Some(text);
                }
            }
        }
    }
    None
}

pub(crate) fn extract_turn_result_text(result: Option<&Value>) -> Option<String> {
    result.and_then(|value| extract_turn_result_text_internal(value, 0))
}

fn should_prefer_turn_result_text(result: Option<&Value>) -> bool {
    result
        .and_then(|value| value.get("syntheticApprovalResolved"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn is_likely_foreign_model_for_gemini(model: &str) -> bool {
    let normalized = model.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }
    if normalized.contains("gemini") {
        return false;
    }
    if normalized.starts_with("claude-") {
        return true;
    }
    if normalized.starts_with("gpt-") || normalized.contains("codex") {
        return true;
    }
    normalized.starts_with("openai/")
        || normalized.starts_with("anthropic/")
        || normalized.starts_with("x-ai/")
        || normalized.starts_with("openrouter/")
        || normalized.starts_with("deepseek/")
        || normalized.starts_with("qwen/")
        || normalized.starts_with("meta/")
        || normalized.starts_with("mistral/")
}

fn is_likely_legacy_claude_model_id(model: &str) -> bool {
    model.trim().to_ascii_lowercase().starts_with("claude-")
}

pub(crate) fn is_valid_claude_model_for_passthrough(model: &str) -> bool {
    let trimmed = model.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return false;
    }
    trimmed.chars().all(|ch| {
        ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':' | '/' | '[' | ']')
    })
}

fn resolve_opencode_bin(config: Option<&EngineConfig>) -> Result<String, String> {
    let custom_bin = config.and_then(|c| c.bin_path.as_deref());
    crate::backend::app_server_cli::resolve_safe_opencode_binary(custom_bin)
        .map(|path| path.to_string_lossy().to_string())
}

fn build_opencode_command(config: Option<&EngineConfig>) -> Result<Command, String> {
    let bin = resolve_opencode_bin(config)?;
    let mut cmd = crate::backend::app_server::build_command_for_binary(&bin);
    if let Some(home) = config.and_then(|c| c.home_dir.as_ref()) {
        cmd.env("OPENCODE_HOME", home);
    }
    Ok(cmd)
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

fn delete_opencode_session_files(
    workspace_path: &Path,
    session_id: &str,
    config: Option<&EngineConfig>,
) -> Result<(), String> {
    let normalized_session_id = session_id.trim();
    if normalized_session_id.is_empty()
        || normalized_session_id.contains('/')
        || normalized_session_id.contains('\\')
        || normalized_session_id.contains("..")
    {
        return Err("[SESSION_NOT_FOUND] Invalid OpenCode session id".to_string());
    }

    let mut deleted_any = false;

    let candidates =
        opencode_session_candidate_paths(workspace_path, normalized_session_id, config);
    for candidate in candidates {
        if !candidate.exists() {
            continue;
        }
        let delete_result = if candidate.is_dir() {
            fs::remove_dir_all(&candidate)
        } else {
            fs::remove_file(&candidate)
        };
        match delete_result {
            Ok(()) => {
                deleted_any = true;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(format!(
                    "[IO_ERROR] Failed to delete OpenCode session path {}: {}",
                    candidate.display(),
                    error
                ));
            }
        }
    }

    for data_root in opencode_data_candidate_roots(workspace_path, config) {
        match delete_opencode_session_from_datastore(&data_root, normalized_session_id) {
            Ok(true) => {
                deleted_any = true;
            }
            Ok(false) => {}
            Err(error) => return Err(error),
        }
    }

    if deleted_any {
        return Ok(());
    }

    Err(format!(
        "[SESSION_NOT_FOUND] OpenCode session file not found: {}",
        normalized_session_id
    ))
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

fn delete_opencode_session_from_datastore(
    data_root: &Path,
    session_id: &str,
) -> Result<bool, String> {
    let mut deleted_any = false;

    let db_path = data_root.join("opencode.db");
    if db_path.exists() {
        let connection = Connection::open(&db_path).map_err(|error| {
            format!(
                "[IO_ERROR] Failed to open OpenCode datastore {}: {}",
                db_path.display(),
                error
            )
        })?;
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(|error| {
                format!(
                    "[IO_ERROR] Failed to enable OpenCode datastore foreign_keys {}: {}",
                    db_path.display(),
                    error
                )
            })?;
        let deleted_rows = connection
            .execute("DELETE FROM session WHERE id = ?1", params![session_id])
            .map_err(|error| {
                format!(
                    "[IO_ERROR] Failed to delete OpenCode session {} in {}: {}",
                    session_id,
                    db_path.display(),
                    error
                )
            })?;
        if deleted_rows > 0 {
            deleted_any = true;
        }
    }

    let storage_root = data_root.join("storage");
    if storage_root.exists() {
        let reader = fs::read_dir(&storage_root).map_err(|error| {
            format!(
                "[IO_ERROR] Failed to read OpenCode storage directory {}: {}",
                storage_root.display(),
                error
            )
        })?;
        for entry in reader {
            let entry = entry.map_err(|error| {
                format!(
                    "[IO_ERROR] Failed to read OpenCode storage entry under {}: {}",
                    storage_root.display(),
                    error
                )
            })?;
            let parent = entry.path();
            if !parent.is_dir() {
                continue;
            }
            if delete_path_if_exists(&parent.join(session_id))? {
                deleted_any = true;
            }
            if delete_path_if_exists(&parent.join(format!("{session_id}.json")))? {
                deleted_any = true;
            }
        }
    }

    Ok(deleted_any)
}

fn slugify_provider_label(value: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
            continue;
        }
        if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn parse_provider_option_line(line: &str, category: &str) -> Option<OpenCodeProviderOption> {
    let trimmed = line
        .trim_start_matches(|ch: char| matches!(ch, '●' | '○' | '◆' | '◇' | '│'))
        .trim();
    if trimmed.is_empty() || trimmed.starts_with("Search:") || trimmed == "..." {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower == "select provider"
        || lower == "add credential"
        || lower == "login method"
        || lower.contains("to select")
        || lower.contains("enter: confirm")
        || lower.contains("type: to search")
        || lower.starts_with("search:")
        || trimmed.starts_with('┌')
        || trimmed.starts_with('└')
        || trimmed.starts_with('■')
        || trimmed.starts_with('│')
    {
        return None;
    }
    let (label, description) = if let Some((left, right)) = trimmed.split_once('(') {
        (
            left.trim().to_string(),
            Some(right.trim_end_matches(')').trim().to_string()),
        )
    } else {
        (trimmed.to_string(), None)
    };
    if label.is_empty() {
        return None;
    }
    let id = slugify_provider_label(&label);
    if id.is_empty() {
        return None;
    }
    let recommended = description
        .as_ref()
        .map(|text| text.to_ascii_lowercase().contains("recommended"))
        .unwrap_or(false);
    Some(OpenCodeProviderOption {
        id,
        label,
        description,
        category: category.to_string(),
        recommended,
    })
}

fn fallback_opencode_provider_catalog() -> Vec<OpenCodeProviderOption> {
    let popular = vec![
        ("opencode-zen", "OpenCode Zen", Some("recommended")),
        ("anthropic", "Anthropic", Some("Claude Max or API key")),
        ("github-copilot", "GitHub Copilot", None),
        ("openai", "OpenAI", Some("ChatGPT Plus/Pro or API key")),
        ("google", "Google", None),
    ];
    let other = vec![
        ("z-ai", "Z.AI"),
        ("zenmux", "ZenMux"),
        ("io-net", "IO.NET"),
        ("nvidia", "Nvidia"),
        ("fastrouter", "FastRouter"),
        ("iflow", "iFlow"),
        ("modelscope", "ModelScope"),
        ("llama", "Llama"),
    ];

    let mut out = Vec::new();
    for (id, label, description) in popular {
        out.push(OpenCodeProviderOption {
            id: id.to_string(),
            label: label.to_string(),
            description: description.map(ToOwned::to_owned),
            category: "popular".to_string(),
            recommended: description
                .map(|text| text.to_ascii_lowercase().contains("recommended"))
                .unwrap_or(false),
        });
    }
    for (id, label) in other {
        out.push(OpenCodeProviderOption {
            id: id.to_string(),
            label: label.to_string(),
            description: None,
            category: "other".to_string(),
            recommended: false,
        });
    }
    out
}

async fn fetch_opencode_provider_catalog_preview(
    workspace_path: &PathBuf,
    config: Option<&EngineConfig>,
) -> Vec<OpenCodeProviderOption> {
    let mut cmd = match build_opencode_command(config) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    cmd.current_dir(workspace_path);
    cmd.arg("auth");
    cmd.arg("login");
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.stdin(Stdio::null());
    let mut child = match cmd.spawn() {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    tokio::time::sleep(Duration::from_millis(900)).await;
    let _ = child.start_kill();
    let output = match tokio::time::timeout(Duration::from_secs(2), child.wait_with_output()).await
    {
        Ok(Ok(value)) => value,
        _ => return Vec::new(),
    };
    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let mut providers: Vec<OpenCodeProviderOption> = Vec::new();
    let mut category = "popular".to_string();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.eq_ignore_ascii_case("Popular") {
            category = "popular".to_string();
            continue;
        }
        if trimmed.eq_ignore_ascii_case("Other") {
            category = "other".to_string();
            continue;
        }
        if let Some(option) = parse_provider_option_line(line, &category) {
            providers.push(option);
        }
    }
    providers.sort_by(|a, b| a.label.cmp(&b.label));
    providers.dedup_by(|a, b| a.id == b.id);
    providers
}

async fn fetch_opencode_provider_catalog_from_auth_picker(
    workspace_path: &PathBuf,
    config: Option<&EngineConfig>,
) -> Vec<OpenCodeProviderOption> {
    let mut cmd = match build_opencode_command(config) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    cmd.current_dir(workspace_path);
    cmd.arg("auth");
    cmd.arg("login");
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.stdin(Stdio::piped());
    let mut child = match cmd.spawn() {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    if let Some(stdin) = child.stdin.as_mut() {
        let mut payload = String::new();
        for _ in 0..520 {
            payload.push_str("\u{1b}[B");
        }
        payload.push('\u{3}');
        if stdin.write_all(payload.as_bytes()).await.is_err() {
            let _ = child.start_kill();
            return Vec::new();
        }
        let _ = stdin.flush().await;
    }

    let output = match tokio::time::timeout(Duration::from_secs(12), child.wait_with_output()).await
    {
        Ok(Ok(value)) => value,
        _ => return Vec::new(),
    };
    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let mut providers: Vec<OpenCodeProviderOption> = Vec::new();
    let mut category = "popular".to_string();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.eq_ignore_ascii_case("Popular") {
            category = "popular".to_string();
            continue;
        }
        if trimmed.eq_ignore_ascii_case("Other") {
            category = "other".to_string();
            continue;
        }
        if let Some(option) = parse_provider_option_line(line, &category) {
            if let Some(existing) = providers.iter_mut().find(|item| item.id == option.id) {
                if option.category == "popular" {
                    existing.category = "popular".to_string();
                }
                if existing.description.is_none() && option.description.is_some() {
                    existing.description = option.description.clone();
                }
                existing.recommended = existing.recommended || option.recommended;
                continue;
            }
            providers.push(option);
        }
    }
    providers.sort_by(|a, b| {
        let score_a = if a.category == "popular" { 0 } else { 1 };
        let score_b = if b.category == "popular" { 0 } else { 1 };
        score_a
            .cmp(&score_b)
            .then_with(|| b.recommended.cmp(&a.recommended))
            .then_with(|| a.label.cmp(&b.label))
    });
    providers.dedup_by(|a, b| a.id == b.id);
    providers
}

/// Detect all installed engines and their capabilities
#[tauri::command]
pub async fn detect_engines(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<EngineStatus>, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let (method, params) = remote_detect_engines_request();
        return call_remote_typed(&*state, &app, method, params).await;
    }
    let manager = &state.engine_manager;
    let settings = read_app_settings_snapshot(&state).await;
    Ok(manager
        .detect_engines_with_gates(settings.gemini_enabled)
        .await)
}

/// Get the currently active engine
#[tauri::command]
pub async fn get_active_engine(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<EngineType, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return call_remote_typed(&*state, &app, "get_active_engine", json!({})).await;
    }
    let manager = &state.engine_manager;
    Ok(manager.get_active_engine().await)
}

/// Switch to a different engine
#[tauri::command]
pub async fn switch_engine(
    engine_type: EngineType,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let settings = read_app_settings_snapshot(&state).await;
    ensure_engine_enabled(&settings, engine_type)?;

    if remote_backend::is_remote_mode(&*state).await {
        let _: Value = call_remote_typed(
            &*state,
            &app,
            "switch_engine",
            json!({ "engineType": engine_type }),
        )
        .await?;
        return Ok(());
    }
    let manager = &state.engine_manager;
    manager.set_active_engine(engine_type).await
}

/// Get cached status for a specific engine
#[tauri::command]
pub async fn get_engine_status(
    engine_type: EngineType,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Option<EngineStatus>, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return call_remote_typed(
            &*state,
            &app,
            "get_engine_status",
            json!({ "engineType": engine_type }),
        )
        .await;
    }
    let manager = &state.engine_manager;
    Ok(manager.get_engine_status(engine_type).await)
}

/// Get all cached engine statuses
#[tauri::command]
pub async fn get_all_engine_statuses(
    state: State<'_, AppState>,
) -> Result<Vec<EngineStatus>, String> {
    let manager = &state.engine_manager;
    Ok(manager.get_all_statuses().await)
}

/// Set engine configuration
#[tauri::command]
pub async fn set_engine_config(
    engine_type: EngineType,
    config: EngineConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let manager = &state.engine_manager;
    manager.set_engine_config(engine_type, config).await;
    Ok(())
}

/// Get engine configuration
#[tauri::command]
pub async fn get_engine_config(
    engine_type: EngineType,
    state: State<'_, AppState>,
) -> Result<Option<EngineConfig>, String> {
    let manager = &state.engine_manager;
    Ok(manager.get_engine_config(engine_type).await)
}

/// Check if an engine is available
#[tauri::command]
pub async fn is_engine_available(
    engine_type: EngineType,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let manager = &state.engine_manager;
    let settings = read_app_settings_snapshot(&state).await;
    if !engine_enabled_in_settings(&settings, engine_type) {
        return Ok(false);
    }
    Ok(manager.is_engine_available(engine_type).await)
}

/// Get list of available engines
#[tauri::command]
pub async fn get_available_engines(state: State<'_, AppState>) -> Result<Vec<EngineType>, String> {
    let manager = &state.engine_manager;
    let settings = read_app_settings_snapshot(&state).await;
    Ok(manager
        .get_available_engines()
        .await
        .into_iter()
        .filter(|engine| engine_enabled_in_settings(&settings, *engine))
        .collect())
}

/// Get active child-process diagnostics for local engine sessions.
#[tauri::command]
pub async fn get_engine_active_process_diagnostics(
    state: State<'_, AppState>,
) -> Result<EngineActiveProcessDiagnostics, String> {
    let sampled_at_ms = unix_timestamp_ms_for_diagnostics();
    if remote_backend::is_remote_mode(&*state).await {
        return Ok(EngineActiveProcessDiagnostics {
            measured: false,
            sampled_at_ms,
            total_active_process_count: 0,
            workspaces: Vec::new(),
            unsupported_reason: Some(
                "active process diagnostics are only available for local runtime sessions"
                    .to_string(),
            ),
            os_child_liveness: OsChildLivenessEvidence::unsupported(
                "Remote backend mode does not have local runtime registry access; OS process liveness cannot be sampled.",
            ),
            stale_child_candidates: Vec::new(),
        });
    }

    let mut workspaces = Vec::new();
    for (workspace_id, session) in state.engine_manager.claude_manager.list_sessions().await {
        let active_process_ids = session.active_process_ids().await;
        let registered_active_processes = active_process_ids
            .iter()
            .map(|pid| RegisteredEngineActiveProcessDiagnostic {
                pid: *pid,
                registered_age_ms: 0,
            })
            .collect();
        workspaces.push(EngineWorkspaceActiveProcessDiagnostics {
            workspace_id,
            engine: EngineType::Claude,
            active_process_ids,
            registered_active_processes,
        });
    }
    for (workspace_id, session) in state.engine_manager.list_opencode_sessions().await {
        let active_process_snapshots = session.active_process_snapshots(sampled_at_ms).await;
        let active_process_ids = active_process_snapshots
            .iter()
            .map(|process| process.pid)
            .collect::<Vec<_>>();
        if active_process_ids.is_empty() {
            continue;
        }
        let registered_active_processes = active_process_snapshots
            .into_iter()
            .map(|process| RegisteredEngineActiveProcessDiagnostic {
                pid: process.pid,
                registered_age_ms: process.registered_age_ms,
            })
            .collect();
        workspaces.push(EngineWorkspaceActiveProcessDiagnostics {
            workspace_id,
            engine: EngineType::OpenCode,
            active_process_ids,
            registered_active_processes,
        });
    }
    for (workspace_id, session) in state.engine_manager.list_gemini_sessions().await {
        let active_process_snapshots = session.active_process_snapshots(sampled_at_ms).await;
        let active_process_ids = active_process_snapshots
            .iter()
            .map(|process| process.pid)
            .collect::<Vec<_>>();
        if active_process_ids.is_empty() {
            continue;
        }
        let registered_active_processes = active_process_snapshots
            .into_iter()
            .map(|process| RegisteredEngineActiveProcessDiagnostic {
                pid: process.pid,
                registered_age_ms: process.registered_age_ms,
            })
            .collect();
        workspaces.push(EngineWorkspaceActiveProcessDiagnostics {
            workspace_id,
            engine: EngineType::Gemini,
            active_process_ids,
            registered_active_processes,
        });
    }
    for (workspace_id, session) in state.engine_manager.list_kimi_sessions().await {
        let active_process_snapshots = session.active_process_snapshots(sampled_at_ms).await;
        let active_process_ids = active_process_snapshots
            .iter()
            .map(|process| process.pid)
            .collect::<Vec<_>>();
        if active_process_ids.is_empty() {
            continue;
        }
        let registered_active_processes = active_process_snapshots
            .into_iter()
            .map(|process| RegisteredEngineActiveProcessDiagnostic {
                pid: process.pid,
                registered_age_ms: process.registered_age_ms,
            })
            .collect();
        workspaces.push(EngineWorkspaceActiveProcessDiagnostics {
            workspace_id,
            engine: EngineType::Kimi,
            active_process_ids,
            registered_active_processes,
        });
    }
    for (workspace_id, session) in state.engine_manager.list_grok_sessions().await {
        let active_process_snapshots = session.active_process_snapshots(sampled_at_ms).await;
        let active_process_ids = active_process_snapshots
            .iter()
            .map(|process| process.pid)
            .collect::<Vec<_>>();
        if active_process_ids.is_empty() {
            continue;
        }
        let registered_active_processes = active_process_snapshots
            .into_iter()
            .map(|process| RegisteredEngineActiveProcessDiagnostic {
                pid: process.pid,
                registered_age_ms: process.registered_age_ms,
            })
            .collect();
        workspaces.push(EngineWorkspaceActiveProcessDiagnostics {
            workspace_id,
            engine: EngineType::Grok,
            active_process_ids,
            registered_active_processes,
        });
    }
    let stale_child_candidates = collect_stale_child_candidates(&workspaces, sampled_at_ms);
    Ok(build_engine_active_process_diagnostics(
        sampled_at_ms,
        workspaces,
        stale_child_candidates,
    ))
}

/// Get models for a specific engine
#[tauri::command]
pub async fn get_engine_models(
    engine_type: EngineType,
    provider_profile_id: Option<String>,
    force_refresh: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<super::ModelInfo>, String> {
    let force_refresh = force_refresh.unwrap_or(false);
    let settings = read_app_settings_snapshot(&state).await;
    ensure_engine_enabled(&settings, engine_type)?;

    if remote_backend::is_remote_mode(&*state).await {
        return call_remote_typed(
            &*state,
            &app,
            "get_engine_models",
            json!({
                "engineType": engine_type,
                "providerProfileId": provider_profile_id,
                "forceRefresh": force_refresh
            }),
        )
        .await;
    }
    if let Some(models) = crate::engine::status::get_provider_scoped_engine_models(
        engine_type,
        provider_profile_id.as_deref(),
    )? {
        return Ok(models);
    }
    let manager = &state.engine_manager;

    match engine_type {
        EngineType::OpenCode => {
            let config = manager.get_engine_config(EngineType::OpenCode).await;
            let custom_bin = config
                .as_ref()
                .and_then(|cfg| cfg.bin_path.as_ref())
                .map(|s| s.as_str());
            let fresh_models = load_opencode_models(custom_bin).await.unwrap_or_default();

            if !fresh_models.is_empty() {
                return Ok(fresh_models);
            }

            if let Some(cached) = manager.get_engine_status(EngineType::OpenCode).await {
                if !cached.models.is_empty() {
                    return Ok(cached.models);
                }
            }

            Ok(fresh_models)
        }
        EngineType::Gemini => Ok(Vec::new()),
        EngineType::Kimi => {
            let config = manager.get_engine_config(EngineType::Kimi).await;
            let custom_bin = config
                .as_ref()
                .and_then(|cfg| cfg.bin_path.as_ref())
                .map(|s| s.as_str());
            let fresh_status = detect_kimi_status(custom_bin).await;

            if !fresh_status.models.is_empty() {
                return Ok(fresh_status.models);
            }

            if let Some(cached) = manager.get_engine_status(EngineType::Kimi).await {
                if !cached.models.is_empty() {
                    return Ok(cached.models);
                }
            }

            Ok(fresh_status.models)
        }
        EngineType::Grok => {
            let config = manager.get_engine_config(EngineType::Grok).await;
            let custom_bin = config
                .as_ref()
                .and_then(|cfg| cfg.bin_path.as_ref())
                .map(|s| s.as_str());
            let fresh_status = detect_grok_status(custom_bin).await;

            if !fresh_status.models.is_empty() {
                return Ok(fresh_status.models);
            }

            if let Some(cached) = manager.get_engine_status(EngineType::Grok).await {
                if !cached.models.is_empty() {
                    return Ok(cached.models);
                }
            }

            Ok(fresh_status.models)
        }
        EngineType::Claude | EngineType::Codex => {
            if force_refresh {
                let status = manager
                    .refresh_engine_status_with_gates(engine_type, settings.gemini_enabled)
                    .await;
                return Ok(status.models);
            }

            if let Some(status) = manager.get_engine_status(engine_type).await {
                if !status.models.is_empty() {
                    return Ok(status.models);
                }
            }

            let status = manager
                .refresh_engine_status_with_gates(engine_type, settings.gemini_enabled)
                .await;
            Ok(status.models)
        }
    }
}

fn build_claude_dispatch_receipt(
    workspace_id: &str,
    effective_provider_profile_id: Option<&str>,
    model: Option<&str>,
    reasoning_effort: Option<&str>,
) -> Value {
    let provider_profile_id = effective_provider_profile_id.filter(|profile_id| {
        *profile_id != crate::engine::claude::CLAUDE_LOCAL_PROVIDER_PROFILE_ID
    });
    json!({
        "engine": "claude",
        "providerProfileId": provider_profile_id,
        "providerProfileSource": if provider_profile_id.is_some() { "managed" } else { "local" },
        "providerRuntimeKey": crate::engine::claude::provider_profile::claude_runtime_key(
            workspace_id,
            effective_provider_profile_id,
        ),
        "model": model,
        "reasoningEffort": reasoning_effort,
    })
}

fn build_provider_engine_dispatch_receipt(
    engine: EngineType,
    provider_profile_id: Option<&str>,
    provider_runtime_key: &str,
    model: Option<&str>,
    reasoning_effort: Option<&str>,
) -> Value {
    let canonical_provider_profile_id = provider_profile_id.filter(|profile_id| {
        !matches!(
            (engine, *profile_id),
            (
                EngineType::Kimi,
                super::kimi_provider_profile::KIMI_LOCAL_PROVIDER_PROFILE_ID
            ) | (
                EngineType::Grok,
                super::grok_provider_profile::GROK_LOCAL_PROVIDER_PROFILE_ID
            ) | (
                EngineType::OpenCode,
                super::opencode_provider_profile::OPENCODE_LOCAL_PROVIDER_PROFILE_ID
            )
        )
    });
    json!({
        "engine": engine.icon(),
        "providerProfileId": canonical_provider_profile_id,
        "providerProfileSource": if canonical_provider_profile_id.is_some() { "managed" } else { "local" },
        "providerRuntimeKey": provider_runtime_key,
        "model": model,
        "reasoningEffort": reasoning_effort,
    })
}

fn fan_out_provider_engine_event(
    app: &AppHandle,
    provider_runtime_key: &str,
    engine: EngineType,
    runtime_turn_id: &str,
    native_session_id: Option<&str>,
    event: &EngineEvent,
    app_server_events: Vec<AppServerEvent>,
) {
    let shared_observation = app
        .try_state::<AppState>()
        .map(|app_state| {
            let observation = app_state
                .shared_runtime_coordinator
                .ingest_engine_event_with_replay_scoped(
                    provider_runtime_key,
                    engine,
                    Some(runtime_turn_id),
                    native_session_id,
                    event,
                    app_server_events.clone(),
                );
            crate::event_sink::publish_shared_runtime_observation(&app_state, &observation);
            observation
        })
        .unwrap_or_default();
    if shared_observation.ui_fanout_deferred {
        return;
    }
    for mut payload in app_server_events {
        if let Some(owner) = shared_observation.owner.as_ref() {
            crate::shared_runtime_coordinator::project_app_server_event_to_shared_owner(
                &mut payload,
                owner,
            );
        }
        let _ = app.emit("app-server-event", payload);
    }
}

/// Send a message using the active engine
/// For Claude: spawns async tasks for streaming events to the frontend
/// via app-server-event, returns immediately with turn ID.
#[tauri::command]
pub async fn engine_send_message(
    workspace_id: String,
    text: String,
    engine: Option<EngineType>,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    thread_id: Option<String>,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    provider_profile_id: Option<String>,
    custom_spec_root: Option<String>,
    auto_session: Option<AutoSessionMetadata>,
    skill_invocations: Option<Vec<crate::types::SkillInvocation>>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let requested_engine = engine;
    if let Some(invocations) = skill_invocations.as_ref().filter(|list| !list.is_empty()) {
        // 契约通道已落地：接收并记录，引擎侧消费属后续协议演进。
        log::debug!(
            "[engine_send_message] skill_invocations received: count={} names={:?}",
            invocations.len(),
            invocations
                .iter()
                .map(|invocation| invocation.name.as_str())
                .collect::<Vec<_>>()
        );
    }
    let settings = read_app_settings_snapshot(&state).await;

    if remote_backend::is_remote_mode(&*state).await {
        let remote_engine = validate_remote_requested_engine(&settings, requested_engine)?;
        let images = images.map(|paths| {
            paths
                .into_iter()
                .map(remote_backend::normalize_path_for_remote)
                .collect::<Vec<_>>()
        });
        return remote_backend::call_remote(
            &*state,
            app,
            "engine_send_message",
            json!({
                "workspaceId": workspace_id,
                "text": text,
                "engine": remote_engine,
                "model": model,
                "effort": effort,
                "disableThinking": disable_thinking.unwrap_or(false),
                "accessMode": access_mode,
                "images": images,
                "continueSession": continue_session,
                "threadId": thread_id,
                "sessionId": session_id,
                "forkSessionId": fork_session_id,
                "agent": agent,
                "variant": variant,
                "providerProfileId": provider_profile_id,
                "customSpecRoot": custom_spec_root,
                "autoSession": auto_session,
                "skillInvocations": skill_invocations,
            }),
        )
        .await;
    }

    let manager = &state.engine_manager;
    let active_engine = manager.get_active_engine().await;
    let effective_engine =
        resolve_enabled_engine_for_send(&settings, requested_engine, active_engine)?;
    // Capability gate follows EngineFeatures; all current engines allow images.
    require_image_support(effective_engine, &images)?;
    log::info!(
        "[engine_send_message] engine={:?} active_engine={:?} workspace_id={} model={:?} continue_session={} thread_id={:?} session_id={:?} fork_session_id={:?} agent={:?} variant={:?} provider_profile_id={:?}",
        effective_engine,
        active_engine,
        workspace_id,
        model,
        continue_session,
        thread_id,
        session_id,
        fork_session_id,
        agent,
        variant,
        provider_profile_id
    );
    if let Some(explicit_engine) = requested_engine {
        if explicit_engine != active_engine {
            log::warn!(
                "[engine_send_message] explicit engine {:?} overrides active engine {:?}",
                explicit_engine,
                active_engine
            );
        }
    }
    let normalized_custom_spec_root = normalize_custom_spec_root(custom_spec_root.as_deref());

    match effective_engine {
        EngineType::Claude => {
            let workspace_entry = {
                let workspaces = state.workspaces.lock().await;
                workspaces
                    .get(&workspace_id)
                    .cloned()
                    .ok_or_else(|| "Workspace not found".to_string())?
            };
            let provider_binding_lookup_session_id = session_id
                .as_deref()
                .or(thread_id.as_deref())
                .map(str::to_string);
            let effective_provider_profile_id =
                crate::session_management::resolve_engine_provider_profile_id(
                    state.storage_path.as_path(),
                    &workspace_id,
                    provider_binding_lookup_session_id.as_deref(),
                    "claude",
                    provider_profile_id.as_deref(),
                )?;
            let provider_launch_profile =
                crate::engine::claude::resolve_claude_provider_launch_profile(
                    effective_provider_profile_id.as_deref(),
                )?;
            let workspace_path = std::path::PathBuf::from(&workspace_entry.path);
            state
                .runtime_manager
                .record_starting(&workspace_entry, "claude", "engine-send-message")
                .await;

            let session = manager
                .get_claude_session_for_provider(
                    &workspace_id,
                    &workspace_path,
                    effective_provider_profile_id.as_deref(),
                )
                .await;

            let has_images = images
                .as_ref()
                .is_some_and(|entries| entries.iter().any(|entry| !entry.trim().is_empty()));
            let normalized_fork_session_id = fork_session_id
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            if fork_session_id.is_some() && normalized_fork_session_id.is_none() {
                return Err("forkSessionId is required for Claude fork session".to_string());
            }
            let continue_session_for_send = continue_session;

            // Resolve session id according to mode:
            // 1) continue_session=true  -> explicit session_id or tracked session id
            // 2) continue_session=false -> force a fresh unique session id so concurrent
            //    Claude turns never collapse into one shared persisted session.
            let resolved_session_id = if normalized_fork_session_id.is_some() {
                None
            } else if continue_session {
                if session_id.is_some() {
                    session_id
                } else {
                    session.get_session_id().await
                }
            } else {
                Some(session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
            };

            let sanitized_model = model
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .and_then(|value| {
                    if is_valid_claude_model_for_passthrough(value) {
                        Some(value.to_string())
                    } else {
                        None
                    }
                });
            if model.is_some() && sanitized_model.is_none() {
                log::warn!(
                    "[engine_send_message] dropped invalid claude model={:?}, fallback to default",
                    model
                );
            }
            let dispatch_receipt = build_claude_dispatch_receipt(
                &workspace_id,
                effective_provider_profile_id.as_deref(),
                sanitized_model.as_deref(),
                effort.as_deref(),
            );
            let model_resolution = json!({
                "requestedModel": model.as_deref(),
                "runtimeModel": sanitized_model.as_deref(),
                "willPassToCli": sanitized_model.is_some(),
                "fallbackReason": if model.is_some() && sanitized_model.is_none() {
                    Some("invalid-shape")
                } else if model.is_none() {
                    Some("not-requested")
                } else {
                    None
                },
            });

            let response_session_id = resolved_session_id.clone();
            if let Some(provider_launch_profile) = provider_launch_profile.as_ref() {
                let binding_session_id = response_session_id
                    .as_deref()
                    .or(provider_binding_lookup_session_id.as_deref())
                    .ok_or_else(|| {
                        "Claude provider binding requires a session identity".to_string()
                    })?;
                crate::session_management::record_engine_provider_binding_core(
                    &state.workspaces,
                    state.storage_path.as_path(),
                    workspace_id.clone(),
                    binding_session_id.to_string(),
                    "claude".to_string(),
                    provider_launch_profile.binding.clone(),
                )
                .await?;
            }
            let auto_session_for_record = auto_session.clone();
            let params = super::SendMessageParams {
                text,
                model: sanitized_model,
                effort,
                disable_thinking: disable_thinking.unwrap_or(false),
                access_mode,
                images,
                continue_session: continue_session_for_send,
                session_id: resolved_session_id,
                fork_session_id: normalized_fork_session_id,
                agent: None,
                variant: None,
                collaboration_mode: None,
                custom_spec_root: normalized_custom_spec_root.clone(),
            };

            // Generate unique render item ids for Claude's assistant/reasoning lanes.
            // The conversation curtain keeps message/reasoning as separate items.
            // Reusing one id across kinds causes realtime assistant text to be
            // overwritten by reasoning snapshots in the normalized assembler path.
            let turn_id = format!("claude-turn-{}", uuid::Uuid::new_v4());
            let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
            session.register_turn_thread_id(&turn_id, &thread_id);
            let assistant_item_id = format!("claude-item-{}", uuid::Uuid::new_v4());
            let reasoning_item_id = format!("claude-reasoning-{}", uuid::Uuid::new_v4());

            // Subscribe to session events BEFORE spawning send_message
            let mut receiver = session.subscribe();
            let app_clone = app.clone();
            let turn_id_for_forwarder = turn_id.clone();
            let runtime_manager = state.runtime_manager.clone();
            let workspace_entry_for_forwarder = workspace_entry.clone();
            let session_for_forwarder = session.clone();
            let provider_binding_for_forwarder = provider_launch_profile
                .as_ref()
                .map(|profile| profile.binding.clone());
            let provider_binding_storage_path = state.storage_path.clone();
            let provider_binding_workspace_id = workspace_id.clone();
            let native_session_id_for_forwarder = response_session_id
                .clone()
                .or_else(|| provider_binding_lookup_session_id.clone());
            let provider_runtime_key_for_forwarder =
                crate::engine::claude::provider_profile::claude_runtime_key(
                    &workspace_id,
                    effective_provider_profile_id.as_deref(),
                );

            // Spawn event forwarder: reads from broadcast channel and emits Tauri events.
            tokio::spawn(async move {
                let turn_source = format!("turn:{turn_id_for_forwarder}");
                let stream_source = format!("stream:{turn_id_for_forwarder}");
                let runtime_context = ClaudeForwarderRuntimeContext {
                    runtime_manager,
                    workspace_entry: workspace_entry_for_forwarder,
                    session: session_for_forwarder,
                    turn_source,
                    stream_source,
                };
                let mut forwarder_state = ClaudeForwarderState::new(
                    thread_id,
                    assistant_item_id,
                    reasoning_item_id,
                    turn_id_for_forwarder.clone(),
                );
                let mut post_completion_grace_deadline: Option<tokio::time::Instant> = None;
                loop {
                    let recv_result = if let Some(grace_deadline) = post_completion_grace_deadline {
                        tokio::time::timeout_at(grace_deadline, receiver.recv()).await
                    } else {
                        Ok(receiver.recv().await)
                    };
                    let turn_event = match recv_result {
                        Ok(Ok(event)) => event,
                        Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => break,
                        Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped))) => {
                            log::warn!(
                                "Claude event forwarder lagged; skipped {} events for turn {}",
                                skipped,
                                turn_id_for_forwarder
                            );
                            continue;
                        }
                        Err(_) => break, // post-completion grace reached
                    };
                    if turn_event.turn_id != turn_id_for_forwarder {
                        continue;
                    }

                    let is_post_completion_context_usage = post_completion_grace_deadline.is_some()
                        && matches!(
                            &turn_event.event,
                            EngineEvent::UsageUpdate {
                                context_usage_source,
                                ..
                            } if context_usage_source.as_deref() == Some("context_command")
                        );
                    let is_turn_completed =
                        matches!(turn_event.event, EngineEvent::TurnCompleted { .. });
                    let event = turn_event.event;
                    if let (
                        Some(binding),
                        EngineEvent::SessionStarted {
                            session_id,
                            engine: EngineType::Claude,
                            ..
                        },
                    ) = (provider_binding_for_forwarder.as_ref(), &event)
                    {
                        if !session_id.is_empty() && session_id != "pending" {
                            session_management::schedule_engine_provider_binding_record(
                                provider_binding_storage_path.clone(),
                                provider_binding_workspace_id.clone(),
                                session_id.clone(),
                                "claude".to_string(),
                                binding.clone(),
                            );
                        }
                    }
                    let stream_timing = turn_event.stream_timing;
                    if crate::shared_runtime_coordinator::is_internal_shared_context_replay_event(
                        &event,
                    ) {
                        // Shared context replay 是 checksum ACK transport，不是可见用户消息。
                        // coordinator 消费后禁止继续生成 claude/raw UI/history event。
                        if let Some(app_state) = app_clone.try_state::<AppState>() {
                            let observation = app_state
                                .shared_runtime_coordinator
                                .ingest_engine_event_scoped(
                                    &provider_runtime_key_for_forwarder,
                                    EngineType::Claude,
                                    Some(&turn_id_for_forwarder),
                                    native_session_id_for_forwarder.as_deref(),
                                    &event,
                                );
                            crate::event_sink::publish_shared_runtime_observation(
                                &app_state,
                                &observation,
                            );
                        }
                        continue;
                    }
                    let mut app_server_events = Vec::new();
                    let did_finish = handle_claude_forwarder_event(
                        event.clone(),
                        stream_timing.as_ref(),
                        &mut forwarder_state,
                        &runtime_context,
                        &mut |payload| app_server_events.push(payload),
                    )
                    .await;
                    let shared_observation = app_clone
                        .try_state::<AppState>()
                        .map(|app_state| {
                            let observation = app_state
                                .shared_runtime_coordinator
                                .ingest_engine_event_with_replay_scoped(
                                    &provider_runtime_key_for_forwarder,
                                    EngineType::Claude,
                                    Some(&turn_id_for_forwarder),
                                    native_session_id_for_forwarder.as_deref(),
                                    &event,
                                    app_server_events.clone(),
                                );
                            crate::event_sink::publish_shared_runtime_observation(
                                &app_state,
                                &observation,
                            );
                            observation
                        })
                        .unwrap_or_default();
                    if !shared_observation.ui_fanout_deferred {
                        for mut payload in app_server_events {
                            if let Some(owner) = shared_observation.owner.as_ref() {
                                crate::shared_runtime_coordinator::
                                    project_app_server_event_to_shared_owner(&mut payload, owner);
                            }
                            let _ = app_clone.emit("app-server-event", payload);
                        }
                    }
                    if did_finish {
                        if is_turn_completed {
                            post_completion_grace_deadline = Some(
                                tokio::time::Instant::now()
                                    + std::time::Duration::from_millis(
                                        CLAUDE_POST_COMPLETION_USAGE_GRACE_MS,
                                    ),
                            );
                            continue;
                        }
                        break;
                    }
                    if is_post_completion_context_usage {
                        break;
                    }
                }
            });
            if let (Some(session_id), Some(metadata)) =
                (response_session_id.as_deref(), auto_session_for_record)
            {
                record_auto_session_metadata_if_present(
                    &state,
                    &workspace_id,
                    Some(session_id),
                    Some(metadata),
                    "claude",
                )
                .await;
            }

            // Spawn the message sender: drives the Claude CLI process
            let session_clone = session.clone();
            let turn_id_clone = turn_id.clone();
            let runtime_manager_for_sender = state.runtime_manager.clone();
            let workspace_entry_for_sender = workspace_entry.clone();
            let app_settings_snapshot = state.app_settings.lock().await.clone();
            let provider_env = provider_launch_profile.map(|profile| profile.env);
            tokio::spawn(async move {
                let send_result = if has_images {
                    session_clone
                        .send_message_with_app_settings_and_provider_env(
                            params,
                            &turn_id_clone,
                            Some(&app_settings_snapshot),
                            provider_env.as_ref(),
                        )
                        .await
                } else {
                    session_clone
                        .send_message_with_app_settings_and_provider_env(
                            params,
                            &turn_id_clone,
                            Some(&app_settings_snapshot),
                            provider_env.as_ref(),
                        )
                        .await
                };
                if let Err(e) = send_result {
                    log::error!("Claude send_message failed: {}", e);
                    runtime_manager_for_sender
                        .record_failure(
                            &workspace_entry_for_sender,
                            "claude",
                            "engine-send-message",
                            e,
                        )
                        .await;
                }
            });

            // Return immediately with turn info (frontend will receive streaming events)
            Ok(json!({
                "engine": "claude",
                "sessionId": response_session_id.clone(),
                "result": {
                    "sessionId": response_session_id.clone(),
                    "modelResolution": model_resolution.clone(),
                    "turn": {
                        "id": turn_id,
                        "status": "started"
                    },
                },
                "modelResolution": model_resolution,
                "dogeDispatchReceipt": dispatch_receipt,
                "turn": {
                    "id": turn_id,
                    "status": "started"
                }
            }))
        }
        EngineType::Codex => {
            // For Codex, delegate to existing send_user_message command
            // The frontend should use the existing command for now
            Ok(json!({
                "delegateTo": "send_user_message",
                "engine": "codex",
            }))
        }
        EngineType::OpenCode => {
            let workspace_path = {
                let workspaces = state.workspaces.lock().await;
                workspaces
                    .get(&workspace_id)
                    .map(|w| std::path::PathBuf::from(&w.path))
                    .ok_or_else(|| "Workspace not found".to_string())?
            };

            let provider_binding_lookup_session_id = session_id
                .as_deref()
                .or(thread_id.as_deref())
                .map(str::to_string);
            let effective_provider_profile_id =
                crate::session_management::resolve_engine_provider_profile_id(
                    state.storage_path.as_path(),
                    &workspace_id,
                    provider_binding_lookup_session_id.as_deref(),
                    "opencode",
                    provider_profile_id.as_deref(),
                )?;
            let provider_launch_profile =
                crate::engine::opencode_provider_profile::resolve_opencode_provider_launch_profile(
                    &workspace_id,
                    effective_provider_profile_id.as_deref(),
                )?;
            let session = manager
                .get_or_create_opencode_session_for_runtime(
                    &workspace_id,
                    &workspace_path,
                    &provider_launch_profile.runtime_key,
                    provider_launch_profile.config_content.clone(),
                )
                .await;

            let resolved_session_id = if continue_session {
                if session_id.is_some() {
                    session_id
                } else {
                    session.get_session_id().await
                }
            } else {
                Some(session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
            };
            let response_session_id = resolved_session_id.clone();

            let sanitized_model = model
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .and_then(|value| {
                    if is_likely_legacy_claude_model_id(value) {
                        None
                    } else {
                        Some(value.to_string())
                    }
                });
            if model.is_some() && sanitized_model.is_none() {
                log::warn!(
                    "[engine_send_message] dropped invalid opencode model={:?}, fallback to default",
                    model
                );
            }
            // Always pass an explicit --model: a broken default model in the
            // user's opencode.json must not fail GUI turns. Managed providers
            // resolve through the injected `doge/<model>` refs.
            let model_for_send = if provider_launch_profile.binding.is_some() {
                sanitized_model
                    .or_else(|| provider_launch_profile.default_model.clone())
                    .map(|value| {
                        crate::engine::opencode_provider_profile::qualify_managed_model_ref(&value)
                    })
            } else {
                sanitized_model.or_else(|| Some("opencode/big-pickle".to_string()))
            };
            let dispatch_receipt = build_provider_engine_dispatch_receipt(
                EngineType::OpenCode,
                effective_provider_profile_id.as_deref(),
                &provider_launch_profile.runtime_key,
                model_for_send.as_deref(),
                effort.as_deref(),
            );

            let params = super::SendMessageParams {
                text,
                model: model_for_send.clone(),
                effort,
                disable_thinking: false,
                access_mode,
                images,
                continue_session,
                session_id: resolved_session_id,
                fork_session_id: None,
                agent,
                variant,
                collaboration_mode: None,
                custom_spec_root: normalized_custom_spec_root.clone(),
            };

            let turn_id = format!("opencode-turn-{}", uuid::Uuid::new_v4());
            let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
            let binding_session_id = response_session_id
                .as_deref()
                .or(provider_binding_lookup_session_id.as_deref())
                .unwrap_or(thread_id.as_str());
            if let Some(binding) = provider_launch_profile.binding.as_ref() {
                crate::session_management::record_engine_provider_binding_core(
                    &state.workspaces,
                    state.storage_path.as_path(),
                    workspace_id.clone(),
                    binding_session_id.to_string(),
                    "opencode".to_string(),
                    binding.clone(),
                )
                .await?;
            }
            let item_id = format!("opencode-item-{}", uuid::Uuid::new_v4());

            let mut receiver = session.subscribe();
            let app_clone = app.clone();
            let mut current_thread_id = thread_id.clone();
            let item_id_clone = item_id.clone();
            let turn_id_for_forwarder = turn_id.clone();
            let provider_runtime_key_for_forwarder = provider_launch_profile.runtime_key.clone();
            let mut native_session_id_for_forwarder = response_session_id
                .clone()
                .or_else(|| provider_binding_lookup_session_id.clone());
            // Spawn event forwarder (same pattern as Claude forwarder above).
            tokio::spawn(async move {
                loop {
                    let turn_event = match receiver.recv().await {
                        Ok(event) => event,
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                            log::warn!(
                                "OpenCode event forwarder lagged; skipped {} events for turn {}",
                                skipped,
                                turn_id_for_forwarder
                            );
                            continue;
                        }
                    };
                    if turn_event.turn_id != turn_id_for_forwarder {
                        continue;
                    }

                    let event = turn_event.event;
                    let is_terminal = event.is_terminal();

                    let mut app_server_events = Vec::new();
                    if let Some(payload) = engine_event_to_app_server_event_with_turn_context(
                        &event,
                        &current_thread_id,
                        &item_id_clone,
                        Some(&turn_id_for_forwarder),
                    ) {
                        app_server_events.push(payload);
                    }
                    fan_out_provider_engine_event(
                        &app_clone,
                        &provider_runtime_key_for_forwarder,
                        EngineType::OpenCode,
                        &turn_id_for_forwarder,
                        native_session_id_for_forwarder.as_deref(),
                        &event,
                        app_server_events,
                    );

                    if let EngineEvent::SessionStarted {
                        session_id, engine, ..
                    } = &event
                    {
                        if !session_id.is_empty() && session_id != "pending" {
                            if matches!(engine, EngineType::OpenCode) {
                                current_thread_id = format!("opencode:{}", session_id);
                                native_session_id_for_forwarder = Some(session_id.clone());
                            }
                        }
                    }

                    if is_terminal {
                        break;
                    }
                }
            });

            let session_clone = session.clone();
            let turn_id_clone = turn_id.clone();
            tokio::spawn(async move {
                if let Err(e) = session_clone.send_message(params, &turn_id_clone).await {
                    log::error!("OpenCode send_message failed: {}", e);
                    session_clone.emit_error(&turn_id_clone, e);
                }
            });
            if let (Some(session_id), Some(metadata)) =
                (response_session_id.as_deref(), auto_session.clone())
            {
                record_auto_session_metadata_if_present(
                    &state,
                    &workspace_id,
                    Some(session_id),
                    Some(metadata),
                    "opencode",
                )
                .await;
            }

            Ok(json!({
                "engine": "opencode",
                "sessionId": response_session_id,
                "result": {
                    "turn": {
                        "id": turn_id,
                        "status": "started"
                    },
                },
                "dogeDispatchReceipt": dispatch_receipt,
                "turn": {
                    "id": turn_id,
                    "status": "started"
                }
            }))
        }
        EngineType::Gemini => {
            let workspace_path = {
                let workspaces = state.workspaces.lock().await;
                workspaces
                    .get(&workspace_id)
                    .map(|w| std::path::PathBuf::from(&w.path))
                    .ok_or_else(|| "Workspace not found".to_string())?
            };

            let session = manager
                .get_or_create_gemini_session(&workspace_id, &workspace_path)
                .await?;

            let resolved_session_id = if continue_session {
                if session_id.is_some() {
                    session_id
                } else {
                    session.get_session_id().await
                }
            } else {
                Some(session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
            };
            let response_session_id = resolved_session_id.clone();

            let sanitized_model = model
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .and_then(|value| {
                    if is_likely_foreign_model_for_gemini(value) {
                        None
                    } else {
                        Some(value.to_string())
                    }
                });
            if model.is_some() && sanitized_model.is_none() {
                log::warn!(
                    "[engine_send_message] dropped invalid gemini model={:?}, fallback to default",
                    model
                );
            }

            let params = super::SendMessageParams {
                text,
                model: sanitized_model,
                effort,
                disable_thinking: false,
                access_mode,
                images,
                continue_session,
                session_id: resolved_session_id,
                fork_session_id: None,
                agent: None,
                variant: None,
                collaboration_mode: None,
                custom_spec_root: normalized_custom_spec_root.clone(),
            };

            let turn_id = format!("gemini-turn-{}", uuid::Uuid::new_v4());
            let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
            let item_id = format!("gemini-item-{}", uuid::Uuid::new_v4());

            let mut receiver = session.subscribe();
            let app_clone = app.clone();
            let mut current_thread_id = thread_id.clone();
            let item_id_clone = item_id.clone();
            let turn_id_for_forwarder = turn_id.clone();
            let mut accumulated_agent_text = String::new();
            tokio::spawn(async move {
                let mut render_state = GeminiRenderRoutingState::default();
                let mut post_completion_grace_deadline: Option<tokio::time::Instant> = None;
                loop {
                    let recv_result = if let Some(grace_deadline) = post_completion_grace_deadline {
                        tokio::time::timeout_at(grace_deadline, receiver.recv()).await
                    } else {
                        Ok(receiver.recv().await)
                    };
                    let turn_event = match recv_result {
                        Ok(Ok(event)) => event,
                        Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => break,
                        Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped))) => {
                            log::warn!(
                                "Gemini event forwarder lagged; skipped {} events for turn {}",
                                skipped,
                                turn_id_for_forwarder
                            );
                            continue;
                        }
                        Err(_) => break,
                    };
                    if turn_event.turn_id != turn_id_for_forwarder {
                        continue;
                    }

                    let event = turn_event.event;
                    let is_terminal = event.is_terminal();
                    let render_lane = match &event {
                        EngineEvent::TextDelta { .. } => GeminiRenderLane::Text,
                        EngineEvent::ReasoningDelta { .. } => GeminiRenderLane::Reasoning,
                        EngineEvent::ToolStarted { .. }
                        | EngineEvent::ToolCompleted { .. }
                        | EngineEvent::ToolInputUpdated { .. }
                        | EngineEvent::ToolOutputDelta { .. } => GeminiRenderLane::Tool,
                        _ => GeminiRenderLane::Other,
                    };
                    let routed_item_id =
                        next_gemini_routed_item_id(&mut render_state, render_lane, &item_id_clone);

                    if let EngineEvent::TextDelta { text, .. } = &event {
                        render_state.saw_text_delta = true;
                        accumulated_agent_text.push_str(text);
                    }

                    if let EngineEvent::TurnCompleted { result, .. } = &event {
                        let fallback_text =
                            extract_turn_result_text(result.as_ref()).unwrap_or_default();
                        let completed_text = if should_prefer_turn_result_text(result.as_ref()) {
                            fallback_text
                        } else if accumulated_agent_text.trim().is_empty() {
                            fallback_text
                        } else {
                            accumulated_agent_text.clone()
                        };
                        // Always emit agentMessage item/completed so project-memory
                        // fusion (onAgentMessageCompleted) runs even after TextDelta.
                        // Use text-lane id so the frontend upserts the streamed bubble.
                        if !completed_text.trim().is_empty() {
                            let completion_item_id =
                                gemini_agent_completion_item_id(&render_state, &item_id_clone);
                            let synthetic = AppServerEvent {
                                workspace_id: event.workspace_id().to_string(),
                                message: json!({
                                    "method": "item/completed",
                                    "params": {
                                        "threadId": &current_thread_id,
                                        "item": {
                                            "id": completion_item_id,
                                            "type": "agentMessage",
                                            "text": completed_text,
                                            "status": "completed",
                                        }
                                    }
                                }),
                            };
                            let _ = app_clone.emit("app-server-event", synthetic);
                        }
                    }

                    if let Some(payload) = engine_event_to_app_server_event_with_turn_context(
                        &event,
                        &current_thread_id,
                        &routed_item_id,
                        Some(&turn_id_for_forwarder),
                    ) {
                        let _ = app_clone.emit("app-server-event", payload);
                    }

                    if let EngineEvent::SessionStarted {
                        session_id, engine, ..
                    } = &event
                    {
                        if !session_id.is_empty() && session_id != "pending" {
                            if matches!(engine, EngineType::Gemini) {
                                current_thread_id = format!("gemini:{}", session_id);
                            }
                        }
                    }

                    if is_terminal {
                        if matches!(event, EngineEvent::TurnCompleted { .. }) {
                            post_completion_grace_deadline = Some(
                                tokio::time::Instant::now()
                                    + std::time::Duration::from_millis(
                                        GEMINI_POST_COMPLETION_REASONING_GRACE_MS,
                                    ),
                            );
                            continue;
                        }
                        break;
                    }
                }
            });

            let session_clone = session.clone();
            let turn_id_clone = turn_id.clone();
            tokio::spawn(async move {
                if let Err(e) = session_clone.send_message(params, &turn_id_clone).await {
                    log::error!("Gemini send_message failed: {}", e);
                }
            });
            if let (Some(session_id), Some(metadata)) =
                (response_session_id.as_deref(), auto_session.clone())
            {
                record_auto_session_metadata_if_present(
                    &state,
                    &workspace_id,
                    Some(session_id),
                    Some(metadata),
                    "gemini",
                )
                .await;
            }

            Ok(json!({
                "engine": "gemini",
                "sessionId": response_session_id,
                "result": {
                    "turn": {
                        "id": turn_id,
                        "status": "started"
                    },
                },
                "turn": {
                    "id": turn_id,
                    "status": "started"
                }
            }))
        }
        EngineType::Kimi => {
            let workspace_path = {
                let workspaces = state.workspaces.lock().await;
                workspaces
                    .get(&workspace_id)
                    .map(|w| std::path::PathBuf::from(&w.path))
                    .ok_or_else(|| "Workspace not found".to_string())?
            };
            let provider_binding_lookup_session_id = session_id
                .as_deref()
                .or(thread_id.as_deref())
                .map(str::to_string);
            let effective_provider_profile_id =
                crate::session_management::resolve_engine_provider_profile_id(
                    state.storage_path.as_path(),
                    &workspace_id,
                    provider_binding_lookup_session_id.as_deref(),
                    "kimi",
                    provider_profile_id.as_deref(),
                )?;
            let provider_launch_profile =
                crate::engine::kimi_provider_profile::resolve_kimi_provider_launch_profile(
                    &workspace_id,
                    effective_provider_profile_id.as_deref(),
                )?;
            let session = manager
                .get_or_create_kimi_session_for_runtime(
                    &workspace_id,
                    &workspace_path,
                    &provider_launch_profile.runtime_key,
                    provider_launch_profile.home_dir.as_deref(),
                )
                .await;

            let resolved_session_id = resolve_kimi_session_id_for_engine_send(
                continue_session,
                session_id,
                session.get_session_id().await,
            );
            let response_session_id = resolved_session_id.clone();
            let runtime_model = model
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let dispatch_receipt = build_provider_engine_dispatch_receipt(
                EngineType::Kimi,
                effective_provider_profile_id.as_deref(),
                &provider_launch_profile.runtime_key,
                runtime_model.as_deref(),
                effort.as_deref(),
            );

            let params = super::SendMessageParams {
                text,
                model: runtime_model,
                effort,
                disable_thinking: false,
                access_mode,
                images,
                continue_session,
                session_id: resolved_session_id,
                fork_session_id: None,
                agent: None,
                variant: None,
                collaboration_mode: None,
                custom_spec_root: normalized_custom_spec_root.clone(),
            };

            let turn_id = format!("kimi-turn-{}", uuid::Uuid::new_v4());
            let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
            let binding_session_id = response_session_id
                .as_deref()
                .or(provider_binding_lookup_session_id.as_deref())
                .unwrap_or(thread_id.as_str());
            if let Some(binding) = provider_launch_profile.binding.as_ref() {
                crate::session_management::record_engine_provider_binding_core(
                    &state.workspaces,
                    state.storage_path.as_path(),
                    workspace_id.clone(),
                    binding_session_id.to_string(),
                    "kimi".to_string(),
                    binding.clone(),
                )
                .await?;
            }
            let item_id = format!("kimi-item-{}", uuid::Uuid::new_v4());

            let mut receiver = session.subscribe();
            let app_clone = app.clone();
            let mut current_thread_id = thread_id.clone();
            let item_id_clone = item_id.clone();
            let turn_id_for_forwarder = turn_id.clone();
            let mut accumulated_agent_text = String::new();
            let provider_binding_for_forwarder = provider_launch_profile.binding.clone();
            let provider_binding_storage_path = state.storage_path.clone();
            let provider_binding_workspace_id = workspace_id.clone();
            let provider_runtime_key_for_forwarder = provider_launch_profile.runtime_key.clone();
            let mut native_session_id_for_forwarder = response_session_id
                .clone()
                .or_else(|| provider_binding_lookup_session_id.clone());
            tokio::spawn(async move {
                let mut render_state = GeminiRenderRoutingState::default();
                loop {
                    let turn_event = match receiver.recv().await {
                        Ok(event) => event,
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                            log::warn!(
                                "Kimi event forwarder lagged; skipped {} events for turn {}",
                                skipped,
                                turn_id_for_forwarder
                            );
                            continue;
                        }
                    };
                    if turn_event.turn_id != turn_id_for_forwarder {
                        continue;
                    }

                    let event = turn_event.event;
                    if let (
                        Some(binding),
                        EngineEvent::SessionStarted {
                            session_id,
                            engine: EngineType::Kimi,
                            ..
                        },
                    ) = (provider_binding_for_forwarder.as_ref(), &event)
                    {
                        if !session_id.is_empty() && session_id != "pending" {
                            session_management::schedule_engine_provider_binding_record(
                                provider_binding_storage_path.clone(),
                                provider_binding_workspace_id.clone(),
                                session_id.clone(),
                                "kimi".to_string(),
                                binding.clone(),
                            );
                        }
                    }
                    let is_terminal = event.is_terminal();
                    let render_lane = match &event {
                        EngineEvent::TextDelta { .. } => GeminiRenderLane::Text,
                        EngineEvent::ReasoningDelta { .. } => GeminiRenderLane::Reasoning,
                        EngineEvent::ToolStarted { .. }
                        | EngineEvent::ToolCompleted { .. }
                        | EngineEvent::ToolInputUpdated { .. }
                        | EngineEvent::ToolOutputDelta { .. } => GeminiRenderLane::Tool,
                        _ => GeminiRenderLane::Other,
                    };
                    let routed_item_id =
                        next_gemini_routed_item_id(&mut render_state, render_lane, &item_id_clone);

                    if let EngineEvent::TextDelta { text, .. } = &event {
                        render_state.saw_text_delta = true;
                        accumulated_agent_text.push_str(text);
                    }

                    let mut app_server_events = Vec::new();
                    if let EngineEvent::TurnCompleted { result, .. } = &event {
                        let fallback_text =
                            extract_turn_result_text(result.as_ref()).unwrap_or_default();
                        let completed_text = if should_prefer_turn_result_text(result.as_ref()) {
                            fallback_text
                        } else if accumulated_agent_text.trim().is_empty() {
                            fallback_text
                        } else {
                            accumulated_agent_text.clone()
                        };
                        // Always emit agentMessage item/completed so project-memory
                        // fusion runs after normal TextDelta streaming (Claude-parity).
                        // Use text-lane id so the frontend upserts the streamed bubble.
                        if !completed_text.trim().is_empty() {
                            let completion_item_id =
                                gemini_agent_completion_item_id(&render_state, &item_id_clone);
                            let synthetic = AppServerEvent {
                                workspace_id: event.workspace_id().to_string(),
                                message: json!({
                                    "method": "item/completed",
                                    "params": {
                                        "threadId": &current_thread_id,
                                        "item": {
                                            "id": completion_item_id,
                                            "type": "agentMessage",
                                            "text": completed_text,
                                            "status": "completed",
                                        }
                                    }
                                }),
                            };
                            app_server_events.push(synthetic);
                        }
                    }

                    if let Some(payload) = engine_event_to_app_server_event_with_turn_context(
                        &event,
                        &current_thread_id,
                        &routed_item_id,
                        Some(&turn_id_for_forwarder),
                    ) {
                        app_server_events.push(payload);
                    }
                    fan_out_provider_engine_event(
                        &app_clone,
                        &provider_runtime_key_for_forwarder,
                        EngineType::Kimi,
                        &turn_id_for_forwarder,
                        native_session_id_for_forwarder.as_deref(),
                        &event,
                        app_server_events,
                    );

                    if let EngineEvent::SessionStarted {
                        session_id, engine, ..
                    } = &event
                    {
                        if !session_id.is_empty() && session_id != "pending" {
                            if matches!(engine, EngineType::Kimi) {
                                current_thread_id = format!("kimi:{}", session_id);
                                native_session_id_for_forwarder = Some(session_id.clone());
                            }
                        }
                    }

                    if is_terminal {
                        break;
                    }
                }
            });

            let session_clone = session.clone();
            let turn_id_clone = turn_id.clone();
            tokio::spawn(async move {
                if let Err(e) = session_clone.send_message(params, &turn_id_clone).await {
                    log::error!("Kimi send_message failed: {}", e);
                }
            });
            if let (Some(session_id), Some(metadata)) =
                (response_session_id.as_deref(), auto_session.clone())
            {
                record_auto_session_metadata_if_present(
                    &state,
                    &workspace_id,
                    Some(session_id),
                    Some(metadata),
                    "kimi",
                )
                .await;
            }

            Ok(json!({
                "engine": "kimi",
                "sessionId": response_session_id,
                "result": {
                    "turn": {
                        "id": turn_id,
                        "status": "started"
                    },
                },
                "dogeDispatchReceipt": dispatch_receipt,
                "turn": {
                    "id": turn_id,
                    "status": "started"
                }
            }))
        }
        EngineType::Grok => {
            let workspace_path = {
                let workspaces = state.workspaces.lock().await;
                workspaces
                    .get(&workspace_id)
                    .map(|w| std::path::PathBuf::from(&w.path))
                    .ok_or_else(|| "Workspace not found".to_string())?
            };
            let provider_binding_lookup_session_id = session_id
                .as_deref()
                .or(thread_id.as_deref())
                .map(str::to_string);
            let effective_provider_profile_id =
                crate::session_management::resolve_engine_provider_profile_id(
                    state.storage_path.as_path(),
                    &workspace_id,
                    provider_binding_lookup_session_id.as_deref(),
                    "grok",
                    provider_profile_id.as_deref(),
                )?;
            let provider_launch_profile =
                crate::engine::grok_provider_profile::resolve_grok_provider_launch_profile(
                    &workspace_id,
                    effective_provider_profile_id.as_deref(),
                )?;
            let session = manager
                .get_or_create_grok_session_for_runtime(
                    &workspace_id,
                    &workspace_path,
                    &provider_launch_profile.runtime_key,
                    provider_launch_profile.home_dir.as_deref(),
                )
                .await;

            let resolved_session_id = resolve_grok_session_id_for_engine_send(
                continue_session,
                session_id,
                session.get_session_id().await,
            );
            let response_session_id = resolved_session_id.clone();
            let runtime_model = model
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let dispatch_receipt = build_provider_engine_dispatch_receipt(
                EngineType::Grok,
                effective_provider_profile_id.as_deref(),
                &provider_launch_profile.runtime_key,
                runtime_model.as_deref(),
                effort.as_deref(),
            );

            let params = super::SendMessageParams {
                text,
                model: runtime_model,
                effort,
                disable_thinking: false,
                access_mode,
                images,
                continue_session,
                session_id: resolved_session_id,
                fork_session_id: None,
                agent: None,
                variant: None,
                collaboration_mode: None,
                custom_spec_root: normalized_custom_spec_root.clone(),
            };

            let turn_id = format!("grok-turn-{}", uuid::Uuid::new_v4());
            let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
            let binding_session_id = response_session_id
                .as_deref()
                .or(provider_binding_lookup_session_id.as_deref())
                .unwrap_or(thread_id.as_str());
            if let Some(binding) = provider_launch_profile.binding.as_ref() {
                crate::session_management::record_engine_provider_binding_core(
                    &state.workspaces,
                    state.storage_path.as_path(),
                    workspace_id.clone(),
                    binding_session_id.to_string(),
                    "grok".to_string(),
                    binding.clone(),
                )
                .await?;
            }
            let item_id = format!("grok-item-{}", uuid::Uuid::new_v4());

            let mut receiver = session.subscribe();
            let app_clone = app.clone();
            let mut current_thread_id = thread_id.clone();
            let item_id_clone = item_id.clone();
            let turn_id_for_forwarder = turn_id.clone();
            let mut accumulated_agent_text = String::new();
            let provider_binding_for_forwarder = provider_launch_profile.binding.clone();
            let provider_binding_storage_path = state.storage_path.clone();
            let provider_binding_workspace_id = workspace_id.clone();
            let provider_runtime_key_for_forwarder = provider_launch_profile.runtime_key.clone();
            let mut native_session_id_for_forwarder = response_session_id
                .clone()
                .or_else(|| provider_binding_lookup_session_id.clone());
            tokio::spawn(async move {
                let mut render_state = GeminiRenderRoutingState::default();
                loop {
                    let turn_event = match receiver.recv().await {
                        Ok(event) => event,
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                            log::warn!(
                                "Grok event forwarder lagged; skipped {} events for turn {}",
                                skipped,
                                turn_id_for_forwarder
                            );
                            continue;
                        }
                    };
                    if turn_event.turn_id != turn_id_for_forwarder {
                        continue;
                    }

                    let event = turn_event.event;
                    if let (
                        Some(binding),
                        EngineEvent::SessionStarted {
                            session_id,
                            engine: EngineType::Grok,
                            ..
                        },
                    ) = (provider_binding_for_forwarder.as_ref(), &event)
                    {
                        if !session_id.is_empty() && session_id != "pending" {
                            session_management::schedule_engine_provider_binding_record(
                                provider_binding_storage_path.clone(),
                                provider_binding_workspace_id.clone(),
                                session_id.clone(),
                                "grok".to_string(),
                                binding.clone(),
                            );
                        }
                    }
                    let is_terminal = event.is_terminal();
                    let render_lane = match &event {
                        EngineEvent::TextDelta { .. } => GeminiRenderLane::Text,
                        EngineEvent::ReasoningDelta { .. } => GeminiRenderLane::Reasoning,
                        EngineEvent::ToolStarted { .. }
                        | EngineEvent::ToolCompleted { .. }
                        | EngineEvent::ToolInputUpdated { .. }
                        | EngineEvent::ToolOutputDelta { .. } => GeminiRenderLane::Tool,
                        _ => GeminiRenderLane::Other,
                    };
                    let routed_item_id =
                        next_gemini_routed_item_id(&mut render_state, render_lane, &item_id_clone);

                    if let EngineEvent::TextDelta { text, .. } = &event {
                        render_state.saw_text_delta = true;
                        accumulated_agent_text.push_str(text);
                    }

                    let mut app_server_events = Vec::new();
                    if let EngineEvent::TurnCompleted { result, .. } = &event {
                        let fallback_text =
                            extract_turn_result_text(result.as_ref()).unwrap_or_default();
                        let completed_text = if should_prefer_turn_result_text(result.as_ref()) {
                            fallback_text
                        } else if accumulated_agent_text.trim().is_empty() {
                            fallback_text
                        } else {
                            accumulated_agent_text.clone()
                        };
                        // Always emit agentMessage item/completed so project-memory
                        // fusion runs after normal TextDelta streaming (Claude-parity).
                        // Use text-lane id so the frontend upserts the streamed bubble.
                        if !completed_text.trim().is_empty() {
                            let completion_item_id =
                                gemini_agent_completion_item_id(&render_state, &item_id_clone);
                            let synthetic = AppServerEvent {
                                workspace_id: event.workspace_id().to_string(),
                                message: json!({
                                    "method": "item/completed",
                                    "params": {
                                        "threadId": &current_thread_id,
                                        "item": {
                                            "id": completion_item_id,
                                            "type": "agentMessage",
                                            "text": completed_text,
                                            "status": "completed",
                                        }
                                    }
                                }),
                            };
                            app_server_events.push(synthetic);
                        }
                    }

                    if let Some(payload) = engine_event_to_app_server_event_with_turn_context(
                        &event,
                        &current_thread_id,
                        &routed_item_id,
                        Some(&turn_id_for_forwarder),
                    ) {
                        app_server_events.push(payload);
                    }
                    fan_out_provider_engine_event(
                        &app_clone,
                        &provider_runtime_key_for_forwarder,
                        EngineType::Grok,
                        &turn_id_for_forwarder,
                        native_session_id_for_forwarder.as_deref(),
                        &event,
                        app_server_events,
                    );

                    if let EngineEvent::SessionStarted {
                        session_id, engine, ..
                    } = &event
                    {
                        if !session_id.is_empty() && session_id != "pending" {
                            if matches!(engine, EngineType::Grok) {
                                current_thread_id = format!("grok:{}", session_id);
                                native_session_id_for_forwarder = Some(session_id.clone());
                            }
                        }
                    }

                    if is_terminal {
                        break;
                    }
                }
            });

            let session_clone = session.clone();
            let turn_id_clone = turn_id.clone();
            tokio::spawn(async move {
                if let Err(e) = session_clone.send_message(params, &turn_id_clone).await {
                    log::error!("Grok send_message failed: {}", e);
                }
            });
            if let (Some(session_id), Some(metadata)) =
                (response_session_id.as_deref(), auto_session.clone())
            {
                record_auto_session_metadata_if_present(
                    &state,
                    &workspace_id,
                    Some(session_id),
                    Some(metadata),
                    "grok",
                )
                .await;
            }

            Ok(json!({
                "engine": "grok",
                "sessionId": response_session_id,
                "result": {
                    "turn": {
                        "id": turn_id,
                        "status": "started"
                    },
                },
                "dogeDispatchReceipt": dispatch_receipt,
                "turn": {
                    "id": turn_id,
                    "status": "started"
                }
            }))
        }
    }
}

/// Send a message and wait for the final plain-text response from the selected engine.
#[tauri::command]
pub async fn engine_send_message_sync(
    workspace_id: String,
    text: String,
    engine: Option<EngineType>,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    custom_spec_root: Option<String>,
    auto_session: Option<AutoSessionMetadata>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if text.trim().is_empty() {
        return Err("Prompt text cannot be empty".to_string());
    }
    let settings = read_app_settings_snapshot(&state).await;

    if remote_backend::is_remote_mode(&*state).await {
        let remote_engine = validate_remote_requested_engine(&settings, engine)?;
        let (method, params) = remote_engine_send_message_sync_request(
            workspace_id,
            text,
            remote_engine,
            model,
            effort,
            disable_thinking,
            access_mode,
            images,
            continue_session,
            session_id,
            fork_session_id,
            agent,
            variant,
            custom_spec_root,
            auto_session,
        );
        return remote_backend::call_remote(&*state, app, method, params).await;
    }

    let manager = &state.engine_manager;
    let active_engine = manager.get_active_engine().await;
    let effective_engine = resolve_enabled_engine_for_send(&settings, engine, active_engine)?;
    // Capability gate follows EngineFeatures; all current engines allow images.
    require_image_support(effective_engine, &images)?;
    let normalized_custom_spec_root = normalize_custom_spec_root(custom_spec_root.as_deref());

    match effective_engine {
        EngineType::Claude => {
            let workspace_path = {
                let workspaces = state.workspaces.lock().await;
                workspaces
                    .get(&workspace_id)
                    .map(|w| std::path::PathBuf::from(&w.path))
                    .ok_or_else(|| "Workspace not found".to_string())?
            };
            let session = manager
                .get_claude_session(&workspace_id, &workspace_path)
                .await;

            let has_images = has_non_empty_images(&images);
            let normalized_fork_session_id = fork_session_id
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            if fork_session_id.is_some() && normalized_fork_session_id.is_none() {
                return Err("forkSessionId is required for Claude fork session".to_string());
            }
            let continue_session_for_send = continue_session;

            let resolved_session_id = resolve_claude_session_id_for_engine_send(
                normalized_fork_session_id.as_deref(),
                session_id,
                continue_session,
                session.get_session_id().await,
            );

            let sanitized_model = model
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .and_then(|value| {
                    if is_valid_claude_model_for_passthrough(value) {
                        Some(value.to_string())
                    } else {
                        None
                    }
                });

            let response_session_id = resolved_session_id.clone();
            let params = super::SendMessageParams {
                text,
                model: sanitized_model,
                effort,
                disable_thinking: disable_thinking.unwrap_or(false),
                access_mode,
                images,
                continue_session: continue_session_for_send,
                session_id: resolved_session_id,
                fork_session_id: normalized_fork_session_id,
                agent: None,
                variant: None,
                collaboration_mode: None,
                custom_spec_root: normalized_custom_spec_root.clone(),
            };

            let turn_id = format!("claude-sync-{}", uuid::Uuid::new_v4());
            let send_result = timeout(Duration::from_secs(900), async {
                if has_images {
                    session.send_message(params, &turn_id).await
                } else {
                    session
                        .send_message_with_auto_compact_retry(params, &turn_id)
                        .await
                }
            })
            .await
            .map_err(|_| "Claude response timed out".to_string())
            .and_then(|result| result);
            let observed_session_id = if send_result.is_err() {
                session.get_session_id().await
            } else {
                None
            };
            record_claude_auto_session_metadata_for_sync_result(
                &state.workspaces,
                state.storage_path.as_path(),
                &workspace_id,
                send_result.is_ok(),
                response_session_id.as_deref(),
                observed_session_id.as_deref(),
                auto_session,
            )
            .await;
            let response = send_result?;

            Ok(json!({
                "engine": "claude",
                "sessionId": response_session_id,
                "text": response
            }))
        }
        EngineType::OpenCode => {
            let workspace_path = {
                let workspaces = state.workspaces.lock().await;
                workspaces
                    .get(&workspace_id)
                    .map(|w| std::path::PathBuf::from(&w.path))
                    .ok_or_else(|| "Workspace not found".to_string())?
            };

            let effective_provider_profile_id = {
                let from_session = crate::session_management::resolve_engine_provider_profile_id(
                    state.storage_path.as_path(),
                    &workspace_id,
                    session_id.as_deref(),
                    "opencode",
                    None,
                )?;
                if from_session.is_some() {
                    from_session
                } else {
                    crate::vendors::read_config()
                        .ok()
                        .and_then(|config| config.opencode.current)
                }
            };
            let provider_launch_profile =
                crate::engine::opencode_provider_profile::resolve_opencode_provider_launch_profile(
                    &workspace_id,
                    effective_provider_profile_id.as_deref(),
                )?;
            let session = manager
                .get_or_create_opencode_session_for_runtime(
                    &workspace_id,
                    &workspace_path,
                    &provider_launch_profile.runtime_key,
                    provider_launch_profile.config_content.clone(),
                )
                .await;
            let resolved_session_id = if continue_session {
                if session_id.is_some() {
                    session_id
                } else {
                    session.get_session_id().await
                }
            } else {
                Some(session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
            };
            let response_session_id = resolved_session_id.clone();

            let sanitized_model = model
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .and_then(|value| {
                    if is_likely_legacy_claude_model_id(value) {
                        None
                    } else {
                        Some(value.to_string())
                    }
                });
            let model_for_send =
                sanitized_model.or_else(|| Some("opencode/big-pickle".to_string()));

            let params = super::SendMessageParams {
                text,
                model: model_for_send,
                effort,
                disable_thinking: false,
                access_mode,
                images,
                continue_session,
                session_id: resolved_session_id,
                fork_session_id: None,
                agent,
                variant,
                collaboration_mode: None,
                custom_spec_root: normalized_custom_spec_root.clone(),
            };

            let turn_id = format!("opencode-sync-{}", uuid::Uuid::new_v4());
            let response = timeout(
                Duration::from_secs(900),
                session.send_message(params, &turn_id),
            )
            .await
            .map_err(|_| "OpenCode response timed out".to_string())??;
            if let Some(binding) = provider_launch_profile.binding.as_ref() {
                let binding_session_id = response_session_id.as_deref().unwrap_or(turn_id.as_str());
                crate::session_management::record_engine_provider_binding_core(
                    &state.workspaces,
                    state.storage_path.as_path(),
                    workspace_id.clone(),
                    binding_session_id.to_string(),
                    "opencode".to_string(),
                    binding.clone(),
                )
                .await?;
            }
            record_auto_session_metadata_if_present(
                &state,
                &workspace_id,
                response_session_id.as_deref(),
                auto_session,
                "opencode",
            )
            .await;

            Ok(json!({
                "engine": "opencode",
                "sessionId": response_session_id,
                "text": response
            }))
        }
        EngineType::Codex => {
            let response = run_codex_prompt_sync(
                &workspace_id,
                &text,
                model,
                effort,
                access_mode,
                images,
                normalized_custom_spec_root.clone(),
                auto_session.clone(),
                &app,
                &state,
            )
            .await?;

            Ok(json!({
                "engine": "codex",
                "text": response
            }))
        }
        EngineType::Gemini => {
            let workspace_path = {
                let workspaces = state.workspaces.lock().await;
                workspaces
                    .get(&workspace_id)
                    .map(|w| std::path::PathBuf::from(&w.path))
                    .ok_or_else(|| "Workspace not found".to_string())?
            };

            let session = manager
                .get_or_create_gemini_session(&workspace_id, &workspace_path)
                .await?;
            let resolved_session_id = if continue_session {
                if session_id.is_some() {
                    session_id
                } else {
                    session.get_session_id().await
                }
            } else {
                Some(session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
            };
            let response_session_id = resolved_session_id.clone();

            let sanitized_model = model
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .and_then(|value| {
                    if is_likely_foreign_model_for_gemini(value) {
                        None
                    } else {
                        Some(value.to_string())
                    }
                });

            let params = super::SendMessageParams {
                text,
                model: sanitized_model,
                effort,
                disable_thinking: false,
                access_mode,
                images,
                continue_session,
                session_id: resolved_session_id,
                fork_session_id: None,
                agent: None,
                variant: None,
                collaboration_mode: None,
                custom_spec_root: normalized_custom_spec_root.clone(),
            };

            let turn_id = format!("gemini-sync-{}", uuid::Uuid::new_v4());
            let response = session
                .send_message_with_timeout(params, &turn_id, Duration::from_secs(900))
                .await?;
            record_auto_session_metadata_if_present(
                &state,
                &workspace_id,
                response_session_id.as_deref(),
                auto_session,
                "gemini",
            )
            .await;

            Ok(json!({
                "engine": "gemini",
                "sessionId": response_session_id,
                "text": response
            }))
        }
        EngineType::Kimi => {
            let workspace_path = {
                let workspaces = state.workspaces.lock().await;
                workspaces
                    .get(&workspace_id)
                    .map(|w| std::path::PathBuf::from(&w.path))
                    .ok_or_else(|| "Workspace not found".to_string())?
            };

            // 与 async send 对齐：无 session 绑定时回落到 vendors.kimi.current，
            // 让 commit-message 等 helper 也能吃到 managed provider 的 API key。
            let effective_provider_profile_id = {
                let from_session = crate::session_management::resolve_engine_provider_profile_id(
                    state.storage_path.as_path(),
                    &workspace_id,
                    session_id.as_deref(),
                    "kimi",
                    None,
                )?;
                if from_session.is_some() {
                    from_session
                } else {
                    crate::vendors::read_config()
                        .ok()
                        .and_then(|config| config.kimi.current)
                }
            };
            let provider_launch_profile =
                crate::engine::kimi_provider_profile::resolve_kimi_provider_launch_profile(
                    &workspace_id,
                    effective_provider_profile_id.as_deref(),
                )?;
            let session = manager
                .get_or_create_kimi_session_for_runtime(
                    &workspace_id,
                    &workspace_path,
                    &provider_launch_profile.runtime_key,
                    provider_launch_profile.home_dir.as_deref(),
                )
                .await;
            let resolved_session_id = resolve_kimi_session_id_for_engine_send(
                continue_session,
                session_id,
                session.get_session_id().await,
            );
            let runtime_model = model
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string());

            let params = super::SendMessageParams {
                text,
                model: runtime_model,
                effort,
                disable_thinking: false,
                access_mode,
                images,
                continue_session,
                session_id: resolved_session_id,
                fork_session_id: None,
                agent: None,
                variant: None,
                collaboration_mode: None,
                custom_spec_root: normalized_custom_spec_root.clone(),
            };

            let turn_id = format!("kimi-sync-{}", uuid::Uuid::new_v4());
            let response = timeout(
                Duration::from_secs(900),
                session.send_message(params, &turn_id),
            )
            .await
            .map_err(|_| "Kimi response timed out".to_string())??;
            let response_session_id = session.get_session_id().await;
            if let Some(binding) = provider_launch_profile.binding.as_ref() {
                let binding_session_id = response_session_id.as_deref().unwrap_or(turn_id.as_str());
                crate::session_management::record_engine_provider_binding_core(
                    &state.workspaces,
                    state.storage_path.as_path(),
                    workspace_id.clone(),
                    binding_session_id.to_string(),
                    "kimi".to_string(),
                    binding.clone(),
                )
                .await?;
            }
            record_auto_session_metadata_if_present(
                &state,
                &workspace_id,
                response_session_id.as_deref(),
                auto_session,
                "kimi",
            )
            .await;

            Ok(json!({
                "engine": "kimi",
                "sessionId": response_session_id,
                "text": response
            }))
        }
        EngineType::Grok => {
            let workspace_path = {
                let workspaces = state.workspaces.lock().await;
                workspaces
                    .get(&workspace_id)
                    .map(|w| std::path::PathBuf::from(&w.path))
                    .ok_or_else(|| "Workspace not found".to_string())?
            };

            // 根因：旧 sync 路径走 bare get_or_create_grok_session（无 provider home），
            // 导致 managed Grok API key 不会被注入，commit-message 出现 401 Unauthorized。
            let effective_provider_profile_id = {
                let from_session = crate::session_management::resolve_engine_provider_profile_id(
                    state.storage_path.as_path(),
                    &workspace_id,
                    session_id.as_deref(),
                    "grok",
                    None,
                )?;
                if from_session.is_some() {
                    from_session
                } else {
                    crate::vendors::read_config()
                        .ok()
                        .and_then(|config| config.grok.current)
                }
            };
            let provider_launch_profile =
                crate::engine::grok_provider_profile::resolve_grok_provider_launch_profile(
                    &workspace_id,
                    effective_provider_profile_id.as_deref(),
                )?;
            let session = manager
                .get_or_create_grok_session_for_runtime(
                    &workspace_id,
                    &workspace_path,
                    &provider_launch_profile.runtime_key,
                    provider_launch_profile.home_dir.as_deref(),
                )
                .await;
            let resolved_session_id = resolve_grok_session_id_for_engine_send(
                continue_session,
                session_id,
                session.get_session_id().await,
            );
            let runtime_model = model
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
                .or_else(|| {
                    // managed provider 时若未显式传 model，用 provider 配置的默认 model
                    effective_provider_profile_id.as_deref().and_then(|profile_id| {
                        crate::engine::grok_provider_profile::resolve_grok_provider_model_config(
                            profile_id,
                        )
                        .ok()
                        .flatten()
                        .map(|provider| provider.model)
                        .filter(|value| !value.trim().is_empty())
                    })
                });

            let params = super::SendMessageParams {
                text,
                model: runtime_model,
                effort,
                disable_thinking: false,
                access_mode,
                images,
                continue_session,
                session_id: resolved_session_id,
                fork_session_id: None,
                agent: None,
                variant: None,
                collaboration_mode: None,
                custom_spec_root: normalized_custom_spec_root.clone(),
            };

            let turn_id = format!("grok-sync-{}", uuid::Uuid::new_v4());
            let response = timeout(
                Duration::from_secs(900),
                session.send_message(params, &turn_id),
            )
            .await
            .map_err(|_| "Grok response timed out".to_string())??;
            let response_session_id = session.get_session_id().await;
            if let Some(binding) = provider_launch_profile.binding.as_ref() {
                let binding_session_id = response_session_id.as_deref().unwrap_or(turn_id.as_str());
                crate::session_management::record_engine_provider_binding_core(
                    &state.workspaces,
                    state.storage_path.as_path(),
                    workspace_id.clone(),
                    binding_session_id.to_string(),
                    "grok".to_string(),
                    binding.clone(),
                )
                .await?;
            }
            record_auto_session_metadata_if_present(
                &state,
                &workspace_id,
                response_session_id.as_deref(),
                auto_session,
                "grok",
            )
            .await;

            Ok(json!({
                "engine": "grok",
                "sessionId": response_session_id,
                "text": response
            }))
        }
    }
}

/// Interrupt the current operation for the active engine
#[tauri::command]
pub async fn engine_interrupt(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        let (method, params) = remote_engine_interrupt_request(workspace_id);
        let _: Value = call_remote_typed(&*state, &app, method, params).await?;
        return Ok(());
    }
    let manager = &state.engine_manager;
    let active_engine = manager.get_active_engine().await;

    match active_engine {
        EngineType::Claude => {
            manager
                .claude_manager
                .interrupt_workspace_sessions(&workspace_id)
                .await
        }
        EngineType::Codex => {
            // Codex interrupts are handled via turn_interrupt RPC from the frontend.
            // This path is a fallback; log for diagnostic visibility.
            log::info!(
                "engine_interrupt called for Codex workspace: {}",
                workspace_id
            );
            Ok(())
        }
        EngineType::OpenCode => {
            manager
                .interrupt_opencode_sessions(&workspace_id, None)
                .await
        }
        EngineType::Gemini => {
            if let Some(session) = manager.get_gemini_session(&workspace_id).await {
                session.interrupt().await?;
            }
            Ok(())
        }
        EngineType::Kimi => manager.interrupt_kimi_sessions(&workspace_id, None).await,
        EngineType::Grok => manager.interrupt_grok_sessions(&workspace_id, None).await,
    }
}

/// Interrupt a specific turn for the active engine.
#[tauri::command]
pub async fn engine_interrupt_turn(
    workspace_id: String,
    turn_id: String,
    engine: Option<EngineType>,
    provider_profile_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        let _: Value = call_remote_typed(
            &*state,
            &app,
            "engine_interrupt_turn",
            json!({
                "workspaceId": workspace_id,
                "turnId": turn_id,
                "engine": engine,
                "providerProfileId": provider_profile_id,
            }),
        )
        .await?;
        return Ok(());
    }
    let manager = &state.engine_manager;
    let active_engine = manager.get_active_engine().await;
    let target_engine = engine.unwrap_or(active_engine);

    match target_engine {
        EngineType::Claude => {
            let provider_profile_id = provider_profile_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let session = if provider_profile_id.is_some() {
                let provider_session = manager
                    .claude_manager
                    .get_session_for_provider(&workspace_id, provider_profile_id)
                    .await;
                match provider_session {
                    Some(session) if session.has_active_turn(&turn_id).await => Some(session),
                    _ => None,
                }
            } else {
                manager
                    .claude_manager
                    .session_for_turn(&workspace_id, &turn_id)
                    .await
            };
            if let Some(session) = session {
                session.interrupt_turn(&turn_id).await?;
            }
            Ok(())
        }
        EngineType::Codex => {
            // Codex interrupts are handled via turn_interrupt RPC from the frontend.
            Ok(())
        }
        EngineType::OpenCode => {
            manager
                .interrupt_opencode_sessions(&workspace_id, Some(&turn_id))
                .await
        }
        EngineType::Gemini => {
            if let Some(session) = manager.get_gemini_session(&workspace_id).await {
                session.interrupt_turn(&turn_id).await?;
            }
            Ok(())
        }
        EngineType::Kimi => {
            manager
                .interrupt_kimi_sessions(&workspace_id, Some(&turn_id))
                .await
        }
        EngineType::Grok => {
            manager
                .interrupt_grok_sessions(&workspace_id, Some(&turn_id))
                .await
        }
    }
}

#[cfg(test)]
#[path = "commands_tests.rs"]
mod commands_tests;
