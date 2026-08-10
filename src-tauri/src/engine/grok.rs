//! Grok engine implementation
//!
//! Handles Grok CLI execution via:
//! - text-only:
//!   `grok -p "<prompt>" --output-format streaming-json --always-approve
//!    [-m <model>] [--reasoning-effort <low|medium|high>] (-s|-r)`
//! - multimodal (images):
//!   `grok --prompt-file <staging.json> --output-format streaming-json ...`
//!
//! Multimodal payloads are ACP content blocks written to a temp file (not argv):
//! `{ "type": "image", "mimeType": "image/png", "data": "<base64>" }`
//! Grok headless accepts the same blocks via `--prompt-file` (verified against
//! grok 0.2.x; avoids ARG_MAX). Text-only keeps the legacy `-p` path.
//!
//! Grok's `streaming-json` output is NDJSON on stdout with four event shapes:
//! - `{"type":"text","data":"..."}` — assistant text delta (true deltas, append)
//! - `{"type":"thought","data":"..."}` — reasoning delta
//! - `{"type":"end","stopReason":"...","sessionId":"...","usage":{...},...}` — always last
//! - `{"type":"error","message":"..."}` — error
//!
//! In headless mode Grok runs with `--always-approve`, so no approval events exist.
//! Stdout exposes **no** tool-call events. Live canvas tool projection is bridged by
//! polling `chat_history.jsonl` (same file history loader reads) and emitting
//! `ToolStarted` / `ToolCompleted` for new `tool_calls` / `tool_result` lines.
//! Session identity is decided by the backend up front: new sessions get a
//! caller-generated UUID via `-s`, existing sessions resume via `-r`.

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{broadcast, Mutex, RwLock};

use super::cli_image_input::{
    collect_non_empty_image_paths, normalize_local_image_path, GROK_IMAGE_ONLY_FALLBACK_TEXT,
};
use super::events::EngineEvent;
use super::grok_history::{
    poll_chat_history_tool_signals, resolve_chat_history_path, GrokHistoryToolSignal,
    GrokToolHistoryTailState,
};
use super::{EngineConfig, EngineType, SendMessageParams};

/// Soft per-image cap for attachments materialised into ACP image blocks.
/// Payload rides `--prompt-file` (not argv), so this is a model/UX bound rather
/// than an OS ARG_MAX bound. xAI vision caps are higher; keep a conservative
/// client-side limit to avoid accidental multi-MB base64 staging.
const GROK_MAX_IMAGE_BYTES: u64 = 2 * 1024 * 1024;

/// Reasoning effort levels accepted by Grok CLI (`--reasoning-effort` / `--effort`).
/// Keep this aligned with the composer allowlist; model menus may still reject a
/// subset (e.g. grok-4.5 advertises low/medium/high only).
const GROK_REASONING_EFFORTS: &[&str] = &["low", "medium", "high"];

/// Built headless command plus optional multimodal prompt file to clean up.
struct GrokBuiltCommand {
    command: Command,
    /// Staging path for ACP content blocks when images were attached.
    prompt_file: Option<PathBuf>,
}

/// Best-effort RAII cleanup for the multimodal `--prompt-file` staging JSON.
struct GrokPromptFileGuard(Option<PathBuf>);

impl GrokPromptFileGuard {
    fn new(path: Option<PathBuf>) -> Self {
        Self(path)
    }
}

impl Drop for GrokPromptFileGuard {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            if let Err(error) = std::fs::remove_file(&path) {
                log::warn!(
                    "[grok] failed to remove prompt-file {}: {}",
                    path.display(),
                    error
                );
            }
        }
    }
}

/// Build ACP content blocks for Grok multimodal headless input.
///
/// Returns `None` when there are no non-empty image attachments so callers can
/// keep the lighter `-p` text path. Returns `Err` when the user attached images
/// but none could be materialised (bad path / oversized / unreadable).
///
/// The encoded JSON is written to a staging file and passed via `--prompt-file`
/// (not inlined on argv) so large screenshots do not hit ARG_MAX.
pub(crate) fn build_grok_prompt_json(
    text: &str,
    images: Option<&[String]>,
    workspace_path: &Path,
) -> Result<Option<String>, String> {
    let image_paths = collect_non_empty_image_paths(images);
    if image_paths.is_empty() {
        return Ok(None);
    }

    let mut blocks: Vec<Value> = Vec::new();
    if !text.trim().is_empty() {
        blocks.push(json!({
            "type": "text",
            "text": text,
        }));
    }

    let mut loaded = 0usize;
    let mut errors: Vec<String> = Vec::new();
    for raw in image_paths {
        match load_image_as_grok_block(&raw, workspace_path) {
            Ok(block) => {
                blocks.push(block);
                loaded += 1;
            }
            Err(error) => errors.push(format!("{raw}: {error}")),
        }
    }

    if loaded == 0 {
        return Err(format!(
            "Grok image input failed: none of the attached images could be loaded ({})",
            errors.join("; ")
        ));
    }
    if !errors.is_empty() {
        log::warn!(
            "[grok] partial image load: {} ok, {} failed ({})",
            loaded,
            errors.len(),
            errors.join("; ")
        );
    }

    // Grok requires at least one content block; if the user only attached images
    // with empty text, keep a minimal text block so the payload stays valid.
    // Display layer strips GROK_IMAGE_ONLY_FALLBACK_TEXT so the canvas never
    // shows this as a user-authored bubble.
    if blocks
        .iter()
        .all(|block| block.get("type").and_then(Value::as_str) != Some("text"))
    {
        blocks.insert(
            0,
            json!({
                "type": "text",
                "text": GROK_IMAGE_ONLY_FALLBACK_TEXT,
            }),
        );
    }

    let encoded = serde_json::to_string(&blocks)
        .map_err(|error| format!("Failed to serialize Grok prompt-json: {error}"))?;
    Ok(Some(encoded))
}

/// Write ACP content-block JSON to workspace staging and return its path.
///
/// Path is under `{workspace}/.doge/image-staging/grok-prompt-<uuid>.json` so
/// argv only carries a short path (Grok CLI `--prompt-file`).
pub(crate) fn write_grok_prompt_file(
    workspace_path: &Path,
    prompt_json: &str,
) -> Result<PathBuf, String> {
    let dir = workspace_path.join(".doge").join("image-staging");
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Failed to create Grok prompt staging dir: {error}"))?;
    let path = dir.join(format!("grok-prompt-{}.json", uuid::Uuid::new_v4()));
    std::fs::write(&path, prompt_json.as_bytes()).map_err(|error| {
        format!(
            "Failed to write Grok prompt-file {}: {error}",
            path.display()
        )
    })?;
    Ok(path)
}

fn load_image_as_grok_block(raw: &str, workspace_path: &Path) -> Result<Value, String> {
    if let Some(block) = try_load_data_url_image(raw) {
        return block;
    }
    let path = normalize_local_image_path(raw)?;
    let path = if path.is_absolute() {
        path
    } else {
        workspace_path.join(path)
    };
    let metadata = std::fs::metadata(&path).map_err(|error| format!("stat failed: {error}"))?;
    if !metadata.is_file() {
        return Err("not a regular file".to_string());
    }
    if metadata.len() > GROK_MAX_IMAGE_BYTES {
        return Err(format!(
            "exceeds {} byte limit ({})",
            GROK_MAX_IMAGE_BYTES,
            metadata.len()
        ));
    }
    let bytes = std::fs::read(&path).map_err(|error| format!("read failed: {error}"))?;
    let mime = mime_type_for_image_path(&path).unwrap_or("image/png");
    Ok(json!({
        "type": "image",
        "mimeType": mime,
        "data": BASE64_STANDARD.encode(bytes),
    }))
}

fn try_load_data_url_image(raw: &str) -> Option<Result<Value, String>> {
    let lower = raw.get(..5)?.to_ascii_lowercase();
    if lower != "data:" {
        return None;
    }
    let rest = &raw[5..];
    let (meta, payload) = rest.split_once(",")?;
    if !meta.to_ascii_lowercase().contains(";base64") {
        return Some(Err("data URL must be base64".to_string()));
    }
    let mime = meta
        .split(';')
        .next()
        .map(str::trim)
        .filter(|value| value.starts_with("image/"))
        .unwrap_or("image/png");
    let encoded_payload = payload.trim();
    let max_encoded_bytes = GROK_MAX_IMAGE_BYTES
        .saturating_add(2)
        .saturating_div(3)
        .saturating_mul(4) as usize;
    if encoded_payload.len() > max_encoded_bytes {
        return Some(Err(format!(
            "data URL exceeds {} byte decoded-image limit",
            GROK_MAX_IMAGE_BYTES
        )));
    }
    let decoded = BASE64_STANDARD
        .decode(encoded_payload)
        .map_err(|error| format!("invalid base64 data URL: {error}"));
    Some(decoded.and_then(|bytes| {
        if bytes.len() as u64 > GROK_MAX_IMAGE_BYTES {
            return Err(format!(
                "data URL exceeds {} byte decoded-image limit",
                GROK_MAX_IMAGE_BYTES
            ));
        }
        Ok(json!({
            "type": "image",
            "mimeType": mime,
            "data": BASE64_STANDARD.encode(bytes),
        }))
    }))
}

fn mime_type_for_image_path(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

pub fn resolve_grok_session_id_for_engine_send(
    continue_session: bool,
    explicit_session_id: Option<String>,
    tracked_session_id: Option<String>,
) -> Option<String> {
    let normalize = |value: Option<String>| {
        value
            .map(|entry| entry.trim().to_string())
            .filter(|entry| !entry.is_empty())
    };
    if continue_session {
        return normalize(explicit_session_id).or_else(|| normalize(tracked_session_id));
    }
    // 新会话：仅用 explicit 预分配 id（Shared Binding / 调用方指定），
    // 不得回退 tracked——否则会把「新建」误 steers 到已有 session 并触发 `-s` 冲突。
    // 与 Claude resolve_claude_session_id_for_engine_send 对齐。
    Some(normalize(explicit_session_id).unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
}

#[derive(Debug, Clone)]
pub struct GrokTurnEvent {
    pub turn_id: String,
    pub event: EngineEvent,
}

/// Grok session for a workspace
pub struct GrokSession {
    pub workspace_id: String,
    pub workspace_path: PathBuf,
    session_id: RwLock<Option<String>>,
    event_sender: broadcast::Sender<GrokTurnEvent>,
    bin_path: Option<String>,
    home_dir: Option<String>,
    custom_args: Option<String>,
    active_processes: Mutex<HashMap<String, ActiveGrokChildProcess>>,
    interrupted_turns: Mutex<HashSet<String>>,
}

#[allow(dead_code)]
pub struct GrokActiveProcessSnapshot {
    pub pid: u32,
    pub registered_age_ms: u64,
}

struct ActiveGrokChildProcess {
    child: Child,
    #[allow(dead_code)]
    started_at_ms: u64,
}

impl ActiveGrokChildProcess {
    fn new(child: Child) -> Self {
        Self {
            child,
            started_at_ms: unix_timestamp_ms_for_process_diagnostics(),
        }
    }

    fn into_child(self) -> Child {
        self.child
    }

    #[allow(dead_code)]
    fn snapshot(&self, sampled_at_ms: u64) -> Option<GrokActiveProcessSnapshot> {
        Some(GrokActiveProcessSnapshot {
            pid: self.child.id()?,
            registered_age_ms: sampled_at_ms.saturating_sub(self.started_at_ms),
        })
    }
}

fn apply_interrupt_result(
    active_processes: &mut HashMap<String, ActiveGrokChildProcess>,
    interrupted_turns: &mut HashSet<String>,
    turn_id: &str,
    kill_result: Result<(), String>,
) -> Result<(), String> {
    kill_result?;
    interrupted_turns.insert(turn_id.to_string());
    active_processes.remove(turn_id);
    Ok(())
}

fn unix_timestamp_ms_for_process_diagnostics() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// Parsed representation of one Grok streaming-json stdout line.
enum GrokStreamLine {
    TextDelta(String),
    ReasoningDelta(String),
    End {
        session_id: Option<String>,
        usage: Option<Value>,
    },
    StreamError(String),
    Other,
}

/// Parse a single NDJSON line from `grok -p --output-format streaming-json`.
fn parse_grok_stream_line(value: &Value) -> GrokStreamLine {
    let event_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match event_type {
        "text" => value
            .get("data")
            .and_then(|v| v.as_str())
            .filter(|text| !text.is_empty())
            .map(|text| GrokStreamLine::TextDelta(text.to_string()))
            .unwrap_or(GrokStreamLine::Other),
        "thought" => value
            .get("data")
            .and_then(|v| v.as_str())
            .filter(|text| !text.is_empty())
            .map(|text| GrokStreamLine::ReasoningDelta(text.to_string()))
            .unwrap_or(GrokStreamLine::Other),
        "end" => {
            let session_id = value
                .get("sessionId")
                .and_then(|v| v.as_str())
                .map(|id| id.trim().to_string())
                .filter(|id| !id.is_empty());
            let usage = value.get("usage").cloned();
            GrokStreamLine::End { session_id, usage }
        }
        "error" => value
            .get("message")
            .and_then(|v| v.as_str())
            .map(|message| message.trim().to_string())
            .filter(|message| !message.is_empty())
            .map(GrokStreamLine::StreamError)
            .unwrap_or(GrokStreamLine::Other),
        _ => GrokStreamLine::Other,
    }
}

impl GrokSession {
    pub fn new(
        workspace_id: String,
        workspace_path: PathBuf,
        config: Option<EngineConfig>,
    ) -> Self {
        let (event_sender, _) = broadcast::channel(1024);
        let config = config.unwrap_or_default();
        Self {
            workspace_id,
            workspace_path,
            session_id: RwLock::new(None),
            event_sender,
            bin_path: config.bin_path,
            home_dir: config.home_dir,
            custom_args: config.custom_args,
            active_processes: Mutex::new(HashMap::new()),
            interrupted_turns: Mutex::new(HashSet::new()),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<GrokTurnEvent> {
        self.event_sender.subscribe()
    }

    pub async fn get_session_id(&self) -> Option<String> {
        self.session_id.read().await.clone()
    }

    async fn set_session_id(&self, id: Option<String>) {
        *self.session_id.write().await = id;
    }

    fn emit_turn_event(&self, turn_id: &str, event: EngineEvent) {
        let _ = self.event_sender.send(GrokTurnEvent {
            turn_id: turn_id.to_string(),
            event,
        });
    }

    pub fn emit_error(&self, turn_id: &str, error: String) {
        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnError {
                workspace_id: self.workspace_id.clone(),
                error,
                code: None,
            },
        );
    }

    fn build_command(
        &self,
        params: &SendMessageParams,
        canonical_session_id: &str,
        resume_session: bool,
    ) -> Result<GrokBuiltCommand, String> {
        let bin = if let Some(ref custom) = self.bin_path {
            custom.clone()
        } else {
            crate::backend::app_server::find_cli_binary("grok", None)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "grok".to_string())
        };

        let mut cmd = crate::backend::app_server::build_command_for_binary(&bin);
        cmd.current_dir(&self.workspace_path);
        cmd.arg("--output-format");
        cmd.arg("streaming-json");
        cmd.arg("--always-approve");

        if let Some(model) = params
            .model
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            cmd.arg("-m");
            cmd.arg(model);
        }

        if let Some(effort) = params
            .effort
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| GROK_REASONING_EFFORTS.contains(value))
        {
            cmd.arg("--reasoning-effort");
            cmd.arg(effort);
        }

        // `-s` creates a NEW session with a caller-chosen UUID and errors if the
        // id already exists; `-r` resumes an existing session. Never pass both,
        // and never pass `-s` when continuing.
        if resume_session {
            cmd.arg("-r");
            cmd.arg(canonical_session_id);
        } else {
            cmd.arg("-s");
            cmd.arg(canonical_session_id);
        }

        if let Some(args) = self.custom_args.as_ref() {
            for arg in args.split_whitespace() {
                cmd.arg(arg);
            }
        }

        // Multimodal: ACP content blocks via --prompt-file (staging JSON).
        // Avoids putting base64 image payloads on argv (ARG_MAX). Text-only
        // keeps legacy -p for smaller argv and identical behaviour.
        let prompt_file = match build_grok_prompt_json(
            &params.text,
            params.images.as_deref(),
            &self.workspace_path,
        )? {
            Some(prompt_json) => {
                let path = write_grok_prompt_file(&self.workspace_path, &prompt_json)?;
                cmd.arg("--prompt-file");
                cmd.arg(&path);
                Some(path)
            }
            None => {
                let safe_text = if params.text.starts_with('-') {
                    format!(" {}", params.text)
                } else {
                    params.text.clone()
                };
                cmd.arg("-p");
                cmd.arg(&safe_text);
                None
            }
        };

        // Grok 0.2.111 has no `--no-auto-update` flag; disable via env.
        cmd.env("GROK_DISABLE_AUTOUPDATER", "1");
        if let Some(home) = self.home_dir.as_ref() {
            cmd.env("GROK_HOME", home);
        }

        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        Ok(GrokBuiltCommand {
            command: cmd,
            prompt_file,
        })
    }

    pub async fn send_message(
        &self,
        params: SendMessageParams,
        turn_id: &str,
    ) -> Result<String, String> {
        let turn_started_at = std::time::Instant::now();
        let requested_model = params
            .model
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or("<auto>");
        let explicit_session_id = params
            .session_id
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        // Canonical session identity is known up front:
        // - continue=true → resume via `-r` with existing id
        // - continue=false → create via `-s` with caller-chosen or new UUID
        //   (Shared Binding 预分配 id 必须走后者，不能被忽略)
        let (canonical_session_id, resume_session) = if params.continue_session {
            match explicit_session_id {
                Some(session_id) => (session_id, true),
                None => (uuid::Uuid::new_v4().to_string(), false),
            }
        } else {
            (
                explicit_session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                false,
            )
        };
        log::info!(
            "[grok/send] turn={} workspace={} model={} continue_session={} resume_session={} session_id_len={}",
            turn_id,
            self.workspace_id,
            requested_model,
            params.continue_session,
            resume_session,
            canonical_session_id.len(),
        );

        let built = match self.build_command(&params, &canonical_session_id, resume_session) {
            Ok(built) => built,
            Err(error) => {
                let error_msg = format!("Failed to build grok command: {}", error);
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        };
        // Clean staging prompt-file after the turn ends (success, error, or interrupt).
        let _prompt_file_guard = GrokPromptFileGuard::new(built.prompt_file);
        let mut command = built.command;
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let error_msg = format!("Failed to spawn grok: {}", error);
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        };
        let spawn_ms = turn_started_at.elapsed().as_millis();

        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                let error_msg = "Failed to capture stdout".to_string();
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        };
        let stderr = match child.stderr.take() {
            Some(stderr) => stderr,
            None => {
                let error_msg = "Failed to capture stderr".to_string();
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        };

        {
            let mut active = self.active_processes.lock().await;
            active.insert(turn_id.to_string(), ActiveGrokChildProcess::new(child));
        }

        self.set_session_id(Some(canonical_session_id.clone()))
            .await;
        self.emit_turn_event(
            turn_id,
            EngineEvent::SessionStarted {
                workspace_id: self.workspace_id.clone(),
                session_id: canonical_session_id.clone(),
                engine: EngineType::Grok,
                turn_id: Some(turn_id.to_string()),
            },
        );
        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnStarted {
                workspace_id: self.workspace_id.clone(),
                turn_id: turn_id.to_string(),
            },
        );

        // Live tool bridge: poll chat_history.jsonl while the process runs.
        let stop_tool_poll = Arc::new(AtomicBool::new(false));
        let tool_poll_task = {
            let stop = stop_tool_poll.clone();
            let workspace_path = self.workspace_path.clone();
            let session_id = canonical_session_id.clone();
            let custom_home = self.home_dir.clone();
            let workspace_id = self.workspace_id.clone();
            let turn_id_owned = turn_id.to_string();
            let event_sender = self.event_sender.clone();
            // resume → skip prior jsonl tools; brand-new session → read from 0
            let resume_for_tool_bridge = resume_session;
            tokio::spawn(async move {
                let mut tail = GrokToolHistoryTailState::for_turn(resume_for_tool_bridge);
                let mut cached_path: Option<std::path::PathBuf> = None;
                let emit = |event: EngineEvent| {
                    let _ = event_sender.send(GrokTurnEvent {
                        turn_id: turn_id_owned.clone(),
                        event,
                    });
                };
                let emit_signals =
                    |signals: Vec<GrokHistoryToolSignal>, tail: &mut GrokToolHistoryTailState| {
                        for signal in signals {
                            match signal {
                                GrokHistoryToolSignal::Started {
                                    tool_id,
                                    tool_name,
                                    input,
                                } => {
                                    tail.started_names
                                        .insert(tool_id.clone(), tool_name.clone());
                                    if let Some(input_value) = input.clone() {
                                        tail.started_inputs.insert(tool_id.clone(), input_value);
                                    }
                                    emit(EngineEvent::ToolStarted {
                                        workspace_id: workspace_id.clone(),
                                        tool_id,
                                        tool_name,
                                        input,
                                    });
                                }
                                GrokHistoryToolSignal::Completed { tool_id, output } => {
                                    let tool_name = tail.started_names.get(&tool_id).cloned();
                                    // Preserve start-time args so completed fileChange can still
                                    // resolve path for EditToolBlock / fileEdit scene polish.
                                    let wrapped_output = match (
                                        tail.started_inputs.get(&tool_id).cloned(),
                                        output,
                                    ) {
                                        (Some(input_value), Some(out)) => Some(json!({
                                            "_input": input_value,
                                            "_output": out,
                                        })),
                                        (Some(input_value), None) => Some(json!({
                                            "_input": input_value,
                                        })),
                                        (None, other) => other,
                                    };
                                    emit(EngineEvent::ToolCompleted {
                                        workspace_id: workspace_id.clone(),
                                        tool_id,
                                        tool_name,
                                        output: wrapped_output,
                                        error: None,
                                    });
                                }
                            }
                        }
                    };
                loop {
                    if cached_path.is_none() {
                        cached_path = resolve_chat_history_path(
                            &workspace_path,
                            &session_id,
                            custom_home.as_deref(),
                        )
                        .await
                        .filter(|path| path.exists());
                    }
                    if let Some(path) = cached_path.as_ref() {
                        match poll_chat_history_tool_signals(path, &mut tail) {
                            Ok(signals) => emit_signals(signals, &mut tail),
                            Err(error) => {
                                log::debug!(
                                    "[grok/tool-bridge] poll {}: {}",
                                    path.display(),
                                    error
                                );
                            }
                        }
                    }
                    if stop.load(Ordering::Relaxed) {
                        // Final poll after process exit so late tool_result lines are not missed.
                        if cached_path.is_none() {
                            cached_path = resolve_chat_history_path(
                                &workspace_path,
                                &session_id,
                                custom_home.as_deref(),
                            )
                            .await
                            .filter(|path| path.exists());
                        }
                        if let Some(path) = cached_path.as_ref() {
                            if let Ok(signals) = poll_chat_history_tool_signals(path, &mut tail) {
                                emit_signals(signals, &mut tail);
                            }
                        }
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
            })
        };

        let stderr_reader = BufReader::new(stderr);
        let stderr_task = tokio::spawn(async move {
            let mut lines = stderr_reader.lines();
            let mut text = String::new();
            while let Ok(Some(line)) = lines.next_line().await {
                text.push_str(&line);
                text.push('\n');
            }
            text
        });

        let mut response_text = String::new();
        let mut error_output = String::new();
        let mut stream_error: Option<String> = None;
        let mut end_usage: Option<Value> = None;
        let mut first_stdout_line_ms: Option<u128> = None;
        let mut stdout_line_count: usize = 0;

        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();

        while let Ok(Some(line)) = lines.next_line().await {
            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }
            stdout_line_count += 1;
            if first_stdout_line_ms.is_none() {
                first_stdout_line_ms = Some(turn_started_at.elapsed().as_millis());
            }
            match serde_json::from_str::<Value>(&line) {
                Ok(event) => match parse_grok_stream_line(&event) {
                    GrokStreamLine::TextDelta(text) => {
                        response_text.push_str(&text);
                        self.emit_turn_event(
                            turn_id,
                            EngineEvent::TextDelta {
                                workspace_id: self.workspace_id.clone(),
                                text,
                            },
                        );
                    }
                    GrokStreamLine::ReasoningDelta(text) => {
                        self.emit_turn_event(
                            turn_id,
                            EngineEvent::ReasoningDelta {
                                workspace_id: self.workspace_id.clone(),
                                text,
                            },
                        );
                    }
                    GrokStreamLine::End { session_id, usage } => {
                        if let Some(session_id) = session_id {
                            if session_id != canonical_session_id {
                                log::warn!(
                                    "[grok/send] turn={} end.sessionId mismatch: canonical={} end={}; keeping canonical",
                                    turn_id,
                                    canonical_session_id,
                                    session_id,
                                );
                            }
                        }
                        if usage.is_some() {
                            end_usage = usage;
                        }
                    }
                    GrokStreamLine::StreamError(message) => {
                        if stream_error.is_none() {
                            stream_error = Some(message);
                        }
                    }
                    GrokStreamLine::Other => {}
                },
                Err(_) => {
                    error_output.push_str(&line);
                    error_output.push('\n');
                }
            }
        }
        let stdout_eof_ms = turn_started_at.elapsed().as_millis();

        let mut child = {
            let mut active = self.active_processes.lock().await;
            active
                .remove(turn_id)
                .map(ActiveGrokChildProcess::into_child)
        };
        let status = if let Some(mut process) = child.take() {
            process.wait().await.ok()
        } else {
            None
        };
        stop_tool_poll.store(true, Ordering::Relaxed);
        let _ = tool_poll_task.await;
        let stderr_text = stderr_task.await.unwrap_or_default();
        if !stderr_text.trim().is_empty() {
            error_output.push_str(&stderr_text);
        }
        let completed_ms = turn_started_at.elapsed().as_millis();
        let status_success = status.as_ref().is_some_and(|value| value.success());
        log::info!(
            "[grok/send][timing] turn={} spawn_ms={} first_stdout_line_ms={:?} stdout_eof_ms={} completed_ms={} stdout_lines={} status_success={} response_chars={} stderr_chars={}",
            turn_id,
            spawn_ms,
            first_stdout_line_ms,
            stdout_eof_ms,
            completed_ms,
            stdout_line_count,
            status_success,
            response_text.chars().count(),
            error_output.chars().count(),
        );

        let was_interrupted = self.interrupted_turns.lock().await.remove(turn_id);
        if let Some(status) = status {
            if !status.success() {
                let error_msg = if was_interrupted || matches!(status.code(), Some(130) | Some(143))
                {
                    "Session stopped.".to_string()
                } else if let Some(stream_error) = stream_error.clone() {
                    stream_error
                } else if !error_output.trim().is_empty() {
                    error_output.trim().to_string()
                } else {
                    format!("Grok exited with status: {}", status)
                };
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        } else if was_interrupted {
            let error_msg = "Session stopped.".to_string();
            self.emit_error(turn_id, error_msg.clone());
            return Err(error_msg);
        }

        if let Some(stream_error) = stream_error {
            self.emit_error(turn_id, stream_error.clone());
            return Err(stream_error);
        }

        if response_text.trim().is_empty() && !error_output.trim().is_empty() {
            let error_msg = error_output.trim().to_string();
            self.emit_error(turn_id, error_msg.clone());
            return Err(error_msg);
        }

        if response_text.trim().is_empty() {
            let diagnostic = "Grok exited without assistant output.".to_string();
            self.emit_error(turn_id, diagnostic.clone());
            return Err(diagnostic);
        }

        let mut result = json!({
            "text": response_text,
        });
        if let Some(usage) = end_usage {
            result["usage"] = usage;
        }
        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnCompleted {
                workspace_id: self.workspace_id.clone(),
                result: Some(result),
            },
        );

        Ok(response_text)
    }

    pub async fn interrupt(&self) -> Result<(), String> {
        let mut active = self.active_processes.lock().await;
        for (turn_id, process) in active.iter_mut() {
            let child = &mut process.child;
            child
                .kill()
                .await
                .map_err(|e| format!("Failed to kill process: {}", e))?;
            self.interrupted_turns.lock().await.insert(turn_id.clone());
        }
        active.clear();
        Ok(())
    }

    pub async fn interrupt_turn(&self, turn_id: &str) -> Result<(), String> {
        let mut active = self.active_processes.lock().await;
        let Some(process) = active.get_mut(turn_id) else {
            return Ok(());
        };
        let kill_result = process
            .child
            .kill()
            .await
            .map_err(|e| format!("Failed to kill process: {}", e));
        let mut interrupted_turns = self.interrupted_turns.lock().await;
        apply_interrupt_result(&mut active, &mut interrupted_turns, turn_id, kill_result)
    }

    #[cfg(test)]
    pub async fn active_process_ids(&self) -> Vec<u32> {
        let active = self.active_processes.lock().await;
        active
            .values()
            .filter_map(|process| process.child.id())
            .collect()
    }

    #[allow(dead_code)]
    pub async fn active_process_snapshots(
        &self,
        sampled_at_ms: u64,
    ) -> Vec<GrokActiveProcessSnapshot> {
        let active = self.active_processes.lock().await;
        active
            .values()
            .filter_map(|process| process.snapshot(sampled_at_ms))
            .collect()
    }
}

impl Drop for GrokSession {
    fn drop(&mut self) {
        let Ok(mut active) = self.active_processes.try_lock() else {
            log::warn!(
                "[grok] dropping session workspace={} while active_processes is locked; child cleanup fallback skipped",
                self.workspace_id
            );
            return;
        };
        if active.is_empty() {
            return;
        }
        for (turn_id, process) in active.drain() {
            let mut child = process.into_child();
            let pid = child.id();
            match child.start_kill() {
                Ok(()) => {
                    log::info!(
                        "[grok] drop fallback started child kill workspace={} turn={} pid={:?}",
                        self.workspace_id,
                        turn_id,
                        pid
                    );
                }
                Err(error) => {
                    log::warn!(
                        "[grok] drop fallback failed to kill child workspace={} turn={} pid={:?}: {}",
                        self.workspace_id,
                        turn_id,
                        pid,
                        error
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn interrupt_unknown_turn_does_not_mark_another_runtime_interrupted() {
        let session = GrokSession::new("workspace-1".to_string(), std::env::temp_dir(), None);

        session
            .interrupt_turn("turn-owned-by-another-provider")
            .await
            .expect("unknown turn interrupt is idempotent");

        assert!(session.interrupted_turns.lock().await.is_empty());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn failed_interrupt_result_keeps_turn_owner_registered() {
        let session = GrokSession::new("workspace-1".to_string(), std::env::temp_dir(), None);
        let child = Command::new("sh")
            .arg("-c")
            .arg("sleep 30")
            .spawn()
            .expect("spawn child");
        session
            .active_processes
            .lock()
            .await
            .insert("turn-owned".to_string(), ActiveGrokChildProcess::new(child));

        {
            let mut active = session.active_processes.lock().await;
            let mut interrupted = session.interrupted_turns.lock().await;
            apply_interrupt_result(
                &mut active,
                &mut interrupted,
                "turn-owned",
                Err("kill failed".to_string()),
            )
            .expect_err("failed kill result must propagate");
        }

        assert!(session
            .active_processes
            .lock()
            .await
            .contains_key("turn-owned"));
        assert!(session.interrupted_turns.lock().await.is_empty());
        session
            .interrupt_turn("turn-owned")
            .await
            .expect("cleanup child");
    }

    #[test]
    fn parses_text_delta_line() {
        let line = json!({"type":"text","data":"hello"});
        match parse_grok_stream_line(&line) {
            GrokStreamLine::TextDelta(text) => assert_eq!(text, "hello"),
            _ => panic!("expected TextDelta"),
        }
    }

    #[test]
    fn parses_thought_delta_line() {
        let line = json!({"type":"thought","data":"thinking..."});
        match parse_grok_stream_line(&line) {
            GrokStreamLine::ReasoningDelta(text) => assert_eq!(text, "thinking..."),
            _ => panic!("expected ReasoningDelta"),
        }
    }

    #[test]
    fn parses_end_line() {
        let line = json!({
            "type":"end",
            "stopReason":"EndTurn",
            "sessionId":"019fa245-1234-5678-9abc-def012345678",
            "requestId":"req-1",
            "usage":{"input_tokens":10,"output_tokens":5},
            "num_turns":2,
            "total_cost_usd":0.001
        });
        match parse_grok_stream_line(&line) {
            GrokStreamLine::End { session_id, usage } => {
                assert_eq!(
                    session_id.as_deref(),
                    Some("019fa245-1234-5678-9abc-def012345678")
                );
                assert_eq!(usage, Some(json!({"input_tokens":10,"output_tokens":5})));
            }
            _ => panic!("expected End"),
        }
    }

    #[test]
    fn parses_error_line() {
        let line = json!({"type":"error","message":"boom"});
        match parse_grok_stream_line(&line) {
            GrokStreamLine::StreamError(message) => assert_eq!(message, "boom"),
            _ => panic!("expected StreamError"),
        }
    }

    #[test]
    fn ignores_unknown_event_types() {
        let max_turns = json!({"type":"max_turns_reached"});
        assert!(matches!(
            parse_grok_stream_line(&max_turns),
            GrokStreamLine::Other
        ));
        let auto_compact = json!({"type":"auto_compact_started"});
        assert!(matches!(
            parse_grok_stream_line(&auto_compact),
            GrokStreamLine::Other
        ));
        let missing_type = json!({"data":"hello"});
        assert!(matches!(
            parse_grok_stream_line(&missing_type),
            GrokStreamLine::Other
        ));
        let empty_text = json!({"type":"text","data":""});
        assert!(matches!(
            parse_grok_stream_line(&empty_text),
            GrokStreamLine::Other
        ));
    }

    #[test]
    fn resolves_session_id_for_continue_and_preassigned_create() {
        assert_eq!(
            resolve_grok_session_id_for_engine_send(
                true,
                Some("session-a".to_string()),
                Some("session-b".to_string())
            ),
            Some("session-a".to_string())
        );
        assert_eq!(
            resolve_grok_session_id_for_engine_send(true, None, Some("session-b".to_string())),
            Some("session-b".to_string())
        );
        // Shared Binding 预分配：continue=false 仍使用 explicit id（走 `-s`）。
        assert_eq!(
            resolve_grok_session_id_for_engine_send(
                false,
                Some("session-a".to_string()),
                Some("session-b".to_string())
            ),
            Some("session-a".to_string())
        );
        // continue=false 不得回退 tracked（新建必须新 id）。
        let generated_ignoring_tracked = resolve_grok_session_id_for_engine_send(
            false,
            None,
            Some("session-tracked".to_string()),
        );
        assert!(generated_ignoring_tracked
            .is_some_and(|value| { !value.is_empty() && value != "session-tracked" }));
        let generated = resolve_grok_session_id_for_engine_send(false, None, None);
        assert!(generated.is_some_and(|value| !value.is_empty()));
    }

    #[test]
    fn prompt_json_omitted_for_text_only() {
        assert_eq!(
            build_grok_prompt_json("hello", None, Path::new(".")).unwrap(),
            None
        );
        assert_eq!(
            build_grok_prompt_json(
                "hello",
                Some(&["  ".to_string(), "".to_string()]),
                Path::new("."),
            )
            .unwrap(),
            None
        );
    }

    #[test]
    fn prompt_json_embeds_local_png_as_acp_image_block() {
        let dir = std::env::temp_dir().join(format!("grok-image-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("pixel.png");
        // 1x1 transparent PNG
        let png = BASE64_STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
            .unwrap();
        std::fs::write(&path, &png).unwrap();

        let encoded = build_grok_prompt_json(
            "what color?",
            Some(&[path.to_string_lossy().to_string()]),
            &dir,
        )
        .unwrap()
        .expect("expected prompt-json payload");
        let blocks: Vec<Value> = serde_json::from_str(&encoded).unwrap();
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0]["type"], "text");
        assert_eq!(blocks[0]["text"], "what color?");
        assert_eq!(blocks[1]["type"], "image");
        assert_eq!(blocks[1]["mimeType"], "image/png");
        assert_eq!(
            blocks[1]["data"].as_str().unwrap(),
            BASE64_STANDARD.encode(&png)
        );

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn prompt_json_accepts_data_url_images() {
        let data_url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        let encoded = build_grok_prompt_json("", Some(&[data_url.to_string()]), Path::new("."))
            .unwrap()
            .expect("expected prompt-json");
        let blocks: Vec<Value> = serde_json::from_str(&encoded).unwrap();
        assert_eq!(blocks[0]["type"], "text");
        assert_eq!(blocks[0]["text"], GROK_IMAGE_ONLY_FALLBACK_TEXT);
        assert_eq!(blocks[1]["type"], "image");
        assert_eq!(blocks[1]["mimeType"], "image/png");
    }

    #[test]
    fn prompt_json_preserves_non_empty_user_text_verbatim() {
        let data_url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        let encoded = build_grok_prompt_json(
            "  preserve surrounding whitespace  \n",
            Some(&[data_url.to_string()]),
            Path::new("."),
        )
        .unwrap()
        .expect("expected prompt-json");
        let blocks: Vec<Value> = serde_json::from_str(&encoded).unwrap();
        assert_eq!(blocks[0]["text"], "  preserve surrounding whitespace  \n");
    }

    #[test]
    fn prompt_json_errors_when_all_images_unreadable() {
        let err = build_grok_prompt_json(
            "hi",
            Some(&["/tmp/definitely-missing-mossx-image-xyz.png".to_string()]),
            Path::new("."),
        )
        .unwrap_err();
        assert!(err.contains("none of the attached images could be loaded"));
    }

    #[test]
    fn prompt_json_resolves_relative_images_from_workspace() {
        let dir = std::env::temp_dir().join(format!("grok-relative-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let png = BASE64_STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
            .unwrap();
        std::fs::write(dir.join("relative.png"), png).unwrap();

        let encoded =
            build_grok_prompt_json("inspect", Some(&["relative.png".to_string()]), &dir).unwrap();
        assert!(encoded.is_some());

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn prompt_json_rejects_oversized_data_url_before_decode() {
        let max_encoded_bytes = GROK_MAX_IMAGE_BYTES
            .saturating_add(2)
            .saturating_div(3)
            .saturating_mul(4) as usize;
        let data_url = format!(
            "data:image/png;base64,{}",
            "A".repeat(max_encoded_bytes + 1)
        );
        let error =
            build_grok_prompt_json("inspect", Some(&[data_url]), Path::new(".")).unwrap_err();
        assert!(error.contains("decoded-image limit"));
    }

    #[test]
    fn prompt_json_allows_payloads_larger_than_former_argv_cap() {
        // Former soft-cap was 700KB on --prompt-json argv. Multimodal now rides
        // --prompt-file, so a ~750KB+ serialized payload must still serialize.
        let dir = std::env::temp_dir().join(format!("grok-large-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("big.bin");
        // ~560KB raw → ~747KB base64 + JSON wrapper > 700KB.
        let bytes = vec![0x41u8; 560 * 1024];
        std::fs::write(&path, &bytes).unwrap();

        let encoded = build_grok_prompt_json(
            "describe",
            Some(&[path.to_string_lossy().to_string()]),
            &dir,
        )
        .unwrap()
        .expect("expected large prompt payload");
        assert!(
            encoded.len() > 700_000,
            "expected payload above former argv cap, got {}",
            encoded.len()
        );
        assert!(!encoded.contains("too large for CLI argv"));

        let staging = write_grok_prompt_file(&dir, &encoded).unwrap();
        assert!(staging.exists());
        assert!(staging.starts_with(dir.join(".doge").join("image-staging")));
        let on_disk = std::fs::read_to_string(&staging).unwrap();
        assert_eq!(on_disk, encoded);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn build_command_uses_prompt_file_for_images_not_prompt_json_argv() {
        let dir = std::env::temp_dir().join(format!("grok-cmd-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("pixel.png");
        let png = BASE64_STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
            .unwrap();
        std::fs::write(&path, &png).unwrap();

        let session = GrokSession::new(
            "ws-test".to_string(),
            dir.clone(),
            Some(EngineConfig {
                bin_path: Some("grok".to_string()),
                ..Default::default()
            }),
        );
        let params = SendMessageParams {
            text: "what is this?".to_string(),
            images: Some(vec![path.to_string_lossy().to_string()]),
            ..Default::default()
        };
        let built = session
            .build_command(&params, "11111111-1111-1111-1111-111111111111", false)
            .expect("build command");

        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert!(
            args.iter().any(|arg| arg == "--prompt-file"),
            "expected --prompt-file in args: {args:?}"
        );
        assert!(
            !args.iter().any(|arg| arg == "--prompt-json"),
            "must not put multimodal payload on --prompt-json argv: {args:?}"
        );
        assert!(
            !args.iter().any(|arg| arg == "-p"),
            "image turns must not use -p: {args:?}"
        );
        let prompt_file = built.prompt_file.expect("prompt file path");
        assert!(prompt_file.exists());
        let file_arg = args
            .iter()
            .position(|arg| arg == "--prompt-file")
            .and_then(|idx| args.get(idx + 1))
            .expect("path after --prompt-file");
        assert_eq!(Path::new(file_arg), prompt_file.as_path());
        let body = std::fs::read_to_string(&prompt_file).unwrap();
        assert!(body.contains("\"type\":\"image\""));

        let _ = std::fs::remove_file(&prompt_file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn build_command_text_only_keeps_dash_p() {
        let dir = std::env::temp_dir().join(format!("grok-text-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let session = GrokSession::new(
            "ws-text".to_string(),
            dir.clone(),
            Some(EngineConfig {
                bin_path: Some("grok".to_string()),
                ..Default::default()
            }),
        );
        let params = SendMessageParams {
            text: "hello only".to_string(),
            ..Default::default()
        };
        let built = session
            .build_command(&params, "22222222-2222-2222-2222-222222222222", false)
            .expect("build command");
        assert!(built.prompt_file.is_none());
        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert!(args.iter().any(|arg| arg == "-p"));
        assert!(!args.iter().any(|arg| arg == "--prompt-file"));
        assert!(!args.iter().any(|arg| arg == "--prompt-json"));
        assert!(!args.iter().any(|arg| arg == "--reasoning-effort"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn build_command_appends_allowed_reasoning_efforts() {
        let dir = std::env::temp_dir().join(format!("grok-effort-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let session = GrokSession::new(
            "ws-effort".to_string(),
            dir.clone(),
            Some(EngineConfig {
                bin_path: Some("grok".to_string()),
                ..Default::default()
            }),
        );

        for effort in ["low", "medium", "high"] {
            let params = SendMessageParams {
                text: "hello".to_string(),
                effort: Some(effort.to_string()),
                ..Default::default()
            };
            let built = session
                .build_command(&params, "33333333-3333-3333-3333-333333333333", false)
                .expect("build command");
            let args: Vec<String> = built
                .command
                .as_std()
                .get_args()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect();
            assert!(
                args.windows(2)
                    .any(|window| window[0] == "--reasoning-effort" && window[1] == effort),
                "missing --reasoning-effort {effort} in args: {args:?}"
            );
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn build_command_ignores_missing_empty_and_invalid_reasoning_effort() {
        let dir = std::env::temp_dir().join(format!("grok-effort-bad-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let session = GrokSession::new(
            "ws-effort-bad".to_string(),
            dir.clone(),
            Some(EngineConfig {
                bin_path: Some("grok".to_string()),
                ..Default::default()
            }),
        );

        for effort in [
            None,
            Some(""),
            Some("   "),
            Some("xhigh"),
            Some("ultra"),
            Some("--danger"),
        ] {
            let params = SendMessageParams {
                text: "hello".to_string(),
                effort: effort.map(str::to_string),
                ..Default::default()
            };
            let built = session
                .build_command(&params, "44444444-4444-4444-4444-444444444444", false)
                .expect("build command");
            let args: Vec<String> = built
                .command
                .as_std()
                .get_args()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect();
            assert!(!args.iter().any(|arg| arg == "--reasoning-effort"));
            assert!(!args.iter().any(|arg| arg == "--effort"));
            assert!(!args.iter().any(|arg| arg == "xhigh"));
            assert!(!args.iter().any(|arg| arg == "ultra"));
            assert!(!args.iter().any(|arg| arg == "--danger"));
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn prompt_file_guard_removes_staging_file() {
        let dir = std::env::temp_dir().join(format!("grok-guard-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = write_grok_prompt_file(&dir, r#"[{"type":"text","text":"x"}]"#).unwrap();
        assert!(path.exists());
        {
            let _guard = GrokPromptFileGuard::new(Some(path.clone()));
        }
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
