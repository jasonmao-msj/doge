//! Kimi engine implementation
//!
//! Handles Kimi Code CLI execution via:
//! `kimi -p "<prompt>" --output-format stream-json [--session <id>] [--model <alias>]`
//!
//! Kimi's `stream-json` output is NDJSON on stdout with four line shapes:
//! - `{"role":"assistant","content":"..."}` — assistant text (whole block, no token deltas)
//! - `{"role":"assistant","tool_calls":[{"type":"function","id":"...","function":{"name":"...","arguments":"..."}}]}`
//! - `{"role":"tool","tool_call_id":"...","content":"..."}` — tool result
//! - `{"role":"meta","type":"session.resume_hint","session_id":"session_<uuid>",...}`
//!
//! Image input (headless): Kimi `-p` only accepts a text prompt. Interactive paste
//! expands to `image_url` parts via TUI store; headless injects absolute paths as
//! `<image path="...">` tags and instructs the agent to call `ReadMediaFile`
//! (print mode uses `permission: auto`, and ReadMediaFile is auto-approved).
//!
//! In `-p` mode Kimi always runs under the `auto` permission policy, so no
//! approval events exist. Thinking content is not written to the JSONL stream.

use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{broadcast, Mutex, RwLock};

use super::events::EngineEvent;
use super::{EngineConfig, EngineType, SendMessageParams};

pub fn resolve_kimi_session_id_for_engine_send(
    continue_session: bool,
    explicit_session_id: Option<String>,
    tracked_session_id: Option<String>,
) -> Option<String> {
    continue_session
        .then(|| explicit_session_id.or(tracked_session_id))
        .flatten()
}

#[derive(Debug, Clone)]
pub struct KimiTurnEvent {
    pub turn_id: String,
    pub event: EngineEvent,
}

/// Kimi session for a workspace
pub struct KimiSession {
    pub workspace_id: String,
    pub workspace_path: PathBuf,
    session_id: RwLock<Option<String>>,
    event_sender: broadcast::Sender<KimiTurnEvent>,
    bin_path: Option<String>,
    home_dir: Option<String>,
    custom_args: Option<String>,
    active_processes: Mutex<HashMap<String, ActiveKimiChildProcess>>,
    interrupted_turns: Mutex<HashSet<String>>,
}

#[allow(dead_code)]
pub struct KimiActiveProcessSnapshot {
    pub pid: u32,
    pub registered_age_ms: u64,
}

struct ActiveKimiChildProcess {
    child: Child,
    #[allow(dead_code)]
    started_at_ms: u64,
}

impl ActiveKimiChildProcess {
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
    fn snapshot(&self, sampled_at_ms: u64) -> Option<KimiActiveProcessSnapshot> {
        Some(KimiActiveProcessSnapshot {
            pid: self.child.id()?,
            registered_age_ms: sampled_at_ms.saturating_sub(self.started_at_ms),
        })
    }
}

fn apply_interrupt_result(
    active_processes: &mut HashMap<String, ActiveKimiChildProcess>,
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

/// Parsed representation of one Kimi stream-json stdout line.
enum KimiStreamLine {
    AssistantText(String),
    ToolCalls(Vec<KimiToolCall>),
    ToolResult {
        tool_call_id: String,
        content: String,
    },
    SessionHint {
        session_id: String,
    },
    Other,
}

struct KimiToolCall {
    id: String,
    name: String,
    arguments: Option<Value>,
}

/// Parse a single NDJSON line from `kimi -p --output-format stream-json`.
fn parse_kimi_stream_line(value: &Value) -> KimiStreamLine {
    let role = value.get("role").and_then(|v| v.as_str()).unwrap_or("");
    match role {
        "assistant" => {
            if let Some(tool_calls) = value.get("tool_calls").and_then(|v| v.as_array()) {
                let calls = tool_calls
                    .iter()
                    .filter_map(|call| {
                        let id = call.get("id").and_then(|v| v.as_str())?.to_string();
                        let function = call.get("function")?;
                        let name = function.get("name").and_then(|v| v.as_str())?.to_string();
                        let arguments = function
                            .get("arguments")
                            .and_then(|v| v.as_str())
                            .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                            .or_else(|| {
                                function
                                    .get("arguments")
                                    .filter(|v| !v.is_string())
                                    .cloned()
                            });
                        Some(KimiToolCall {
                            id,
                            name,
                            arguments,
                        })
                    })
                    .collect::<Vec<_>>();
                if !calls.is_empty() {
                    return KimiStreamLine::ToolCalls(calls);
                }
            }
            if let Some(text) = extract_assistant_text(value) {
                if !text.is_empty() {
                    return KimiStreamLine::AssistantText(text);
                }
            }
            KimiStreamLine::Other
        }
        "tool" => {
            let tool_call_id = value
                .get("tool_call_id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let content = value
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if tool_call_id.is_empty() {
                KimiStreamLine::Other
            } else {
                KimiStreamLine::ToolResult {
                    tool_call_id,
                    content,
                }
            }
        }
        "meta" => {
            let meta_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
            if meta_type == "session.resume_hint" {
                if let Some(session_id) = value.get("session_id").and_then(|v| v.as_str()) {
                    let session_id = session_id.trim().to_string();
                    if !session_id.is_empty() {
                        return KimiStreamLine::SessionHint { session_id };
                    }
                }
            }
            KimiStreamLine::Other
        }
        _ => KimiStreamLine::Other,
    }
}

/// Assistant `content` is normally a plain string; tolerate `[{type:"text",text}]` parts.
fn extract_assistant_text(value: &Value) -> Option<String> {
    let content = value.get("content")?;
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    if let Some(parts) = content.as_array() {
        let mut text = String::new();
        for part in parts {
            if let Some(chunk) = part.get("text").and_then(|v| v.as_str()) {
                text.push_str(chunk);
            }
        }
        return Some(text);
    }
    None
}

fn merge_kimi_assistant_text_snapshot(accumulated: &mut String, incoming: &str) -> Option<String> {
    if incoming.is_empty() {
        return None;
    }
    if incoming == accumulated {
        return None;
    }
    if incoming.starts_with(accumulated.as_str()) {
        let delta = incoming[accumulated.len()..].to_string();
        accumulated.clear();
        accumulated.push_str(incoming);
        return (!delta.is_empty()).then_some(delta);
    }
    accumulated.push_str(incoming);
    Some(incoming.to_string())
}

impl KimiSession {
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

    pub fn subscribe(&self) -> broadcast::Receiver<KimiTurnEvent> {
        self.event_sender.subscribe()
    }

    pub async fn get_session_id(&self) -> Option<String> {
        self.session_id.read().await.clone()
    }

    async fn set_session_id(&self, id: Option<String>) {
        *self.session_id.write().await = id;
    }

    fn emit_turn_event(&self, turn_id: &str, event: EngineEvent) {
        let _ = self.event_sender.send(KimiTurnEvent {
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

    fn build_command(&self, params: &SendMessageParams) -> Result<Command, String> {
        let launch = crate::engine::kimi_launch::resolve_kimi_launch_context(
            self.bin_path.as_deref(),
            self.home_dir.as_deref().map(std::path::Path::new),
        )?;
        let bin = launch.binary.to_string_lossy().to_string();
        let mut cmd = crate::backend::app_server::build_command_for_binary(&bin);
        launch.apply_environment(&mut cmd);
        cmd.current_dir(&self.workspace_path);
        cmd.arg("--output-format");
        cmd.arg("stream-json");

        if let Some(model) = params
            .model
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            cmd.arg("--model");
            cmd.arg(model);
        }

        if params.continue_session {
            if let Some(session_id) = params
                .session_id
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
            {
                cmd.arg("--session");
                cmd.arg(session_id);
            }
        }

        if let Some(args) = self.custom_args.as_ref() {
            for arg in args.split_whitespace() {
                cmd.arg(arg);
            }
        }

        let image_files = crate::engine::cli_image_input::resolve_existing_image_files(
            params.images.as_deref(),
            &self.workspace_path,
        )?;
        let prompt_text = crate::engine::cli_image_input::build_kimi_prompt_with_images(
            &params.text,
            &image_files,
        );
        let safe_text = if prompt_text.starts_with('-') {
            format!(" {}", prompt_text)
        } else {
            prompt_text
        };
        cmd.arg("--prompt");
        cmd.arg(&safe_text);

        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        Ok(cmd)
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
        let resume_session_id_len = params
            .session_id
            .as_ref()
            .map(|value| value.trim().len())
            .unwrap_or(0);
        log::info!(
            "[kimi/send] turn={} workspace={} model={} continue_session={} resume_session_id_len={}",
            turn_id,
            self.workspace_id,
            requested_model,
            params.continue_session,
            resume_session_id_len,
        );

        let mut command = match self.build_command(&params) {
            Ok(command) => command,
            Err(error) => {
                let error_msg = format!("Failed to build kimi command: {}", error);
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        };
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let error_msg = format!("Failed to spawn kimi: {}", error);
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
            active.insert(turn_id.to_string(), ActiveKimiChildProcess::new(child));
        }

        self.emit_turn_event(
            turn_id,
            EngineEvent::SessionStarted {
                workspace_id: self.workspace_id.clone(),
                session_id: "pending".to_string(),
                engine: EngineType::Kimi,
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
        let mut saw_tool_activity = false;
        let mut tool_names_by_id: HashMap<String, String> = HashMap::new();
        let mut tool_inputs_by_id: HashMap<String, Option<Value>> = HashMap::new();
        let mut error_output = String::new();
        let mut session_started_emitted = false;
        let mut new_session_id: Option<String> = None;
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
                Ok(event) => match parse_kimi_stream_line(&event) {
                    KimiStreamLine::AssistantText(text) => {
                        if let Some(delta) =
                            merge_kimi_assistant_text_snapshot(&mut response_text, &text)
                        {
                            self.emit_turn_event(
                                turn_id,
                                EngineEvent::TextDelta {
                                    workspace_id: self.workspace_id.clone(),
                                    text: delta,
                                },
                            );
                        }
                    }
                    KimiStreamLine::ToolCalls(calls) => {
                        saw_tool_activity = true;
                        for call in calls {
                            tool_names_by_id.insert(call.id.clone(), call.name.clone());
                            tool_inputs_by_id.insert(call.id.clone(), call.arguments.clone());
                            self.emit_turn_event(
                                turn_id,
                                EngineEvent::ToolStarted {
                                    workspace_id: self.workspace_id.clone(),
                                    tool_id: call.id,
                                    tool_name: call.name,
                                    input: call.arguments,
                                },
                            );
                        }
                    }
                    KimiStreamLine::ToolResult {
                        tool_call_id,
                        content,
                    } => {
                        saw_tool_activity = true;
                        let tool_name = tool_names_by_id.get(&tool_call_id).cloned();
                        let wrapped_output = match tool_inputs_by_id.get(&tool_call_id).cloned() {
                            Some(Some(input_value)) => Some(json!({
                                "_input": input_value,
                                "_output": content,
                            })),
                            _ => Some(Value::String(content)),
                        };
                        self.emit_turn_event(
                            turn_id,
                            EngineEvent::ToolCompleted {
                                workspace_id: self.workspace_id.clone(),
                                tool_id: tool_call_id,
                                tool_name,
                                output: wrapped_output,
                                error: None,
                            },
                        );
                    }
                    KimiStreamLine::SessionHint { session_id } => {
                        if !session_started_emitted {
                            session_started_emitted = true;
                            new_session_id = Some(session_id.clone());
                            self.set_session_id(Some(session_id.clone())).await;
                            self.emit_turn_event(
                                turn_id,
                                EngineEvent::SessionStarted {
                                    workspace_id: self.workspace_id.clone(),
                                    session_id,
                                    engine: EngineType::Kimi,
                                    turn_id: Some(turn_id.to_string()),
                                },
                            );
                        }
                    }
                    KimiStreamLine::Other => {}
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
                .map(ActiveKimiChildProcess::into_child)
        };
        let status = if let Some(mut process) = child.take() {
            process.wait().await.ok()
        } else {
            None
        };
        let stderr_text = stderr_task.await.unwrap_or_default();
        if !stderr_text.trim().is_empty() {
            error_output.push_str(&stderr_text);
        }
        let completed_ms = turn_started_at.elapsed().as_millis();
        let status_success = status.as_ref().is_some_and(|value| value.success());
        log::info!(
            "[kimi/send][timing] turn={} spawn_ms={} first_stdout_line_ms={:?} stdout_eof_ms={} completed_ms={} stdout_lines={} status_success={} response_chars={} stderr_chars={}",
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
                let error_msg = if was_interrupted {
                    "Session stopped.".to_string()
                } else if !error_output.trim().is_empty() {
                    error_output.trim().to_string()
                } else {
                    format!("Kimi exited with status: {}", status)
                };
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        } else if was_interrupted {
            let error_msg = "Session stopped.".to_string();
            self.emit_error(turn_id, error_msg.clone());
            return Err(error_msg);
        }

        if response_text.trim().is_empty() && !error_output.trim().is_empty() {
            let error_msg = error_output.trim().to_string();
            self.emit_error(turn_id, error_msg.clone());
            return Err(error_msg);
        }

        if response_text.trim().is_empty() && !saw_tool_activity {
            let diagnostic = "Kimi exited without assistant output.".to_string();
            self.emit_error(turn_id, diagnostic.clone());
            return Err(diagnostic);
        }

        if let Some(session_id) = new_session_id {
            self.set_session_id(Some(session_id)).await;
        }

        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnCompleted {
                workspace_id: self.workspace_id.clone(),
                result: Some(json!({
                    "text": response_text,
                })),
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
    ) -> Vec<KimiActiveProcessSnapshot> {
        let active = self.active_processes.lock().await;
        active
            .values()
            .filter_map(|process| process.snapshot(sampled_at_ms))
            .collect()
    }
}

impl Drop for KimiSession {
    fn drop(&mut self) {
        let Ok(mut active) = self.active_processes.try_lock() else {
            log::warn!(
                "[kimi] dropping session workspace={} while active_processes is locked; child cleanup fallback skipped",
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
                        "[kimi] drop fallback started child kill workspace={} turn={} pid={:?}",
                        self.workspace_id,
                        turn_id,
                        pid
                    );
                }
                Err(error) => {
                    log::warn!(
                        "[kimi] drop fallback failed to kill child workspace={} turn={} pid={:?}: {}",
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
        let session = KimiSession::new("workspace-1".to_string(), std::env::temp_dir(), None);

        session
            .interrupt_turn("turn-owned-by-another-provider")
            .await
            .expect("unknown turn interrupt is idempotent");

        assert!(session.interrupted_turns.lock().await.is_empty());
    }

    #[test]
    fn managed_binary_override_pins_spawn_binary() {
        let session = KimiSession::new(
            "workspace-managed".to_string(),
            std::env::temp_dir(),
            Some(crate::engine::EngineConfig {
                bin_path: Some("bundled-kimi".to_string()),
                ..Default::default()
            }),
        );

        // The account toolchain pins the bundled binary through EngineConfig;
        // build_command must prefer it over PATH lookup.
        assert_eq!(session.bin_path.as_deref(), Some("bundled-kimi"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn failed_interrupt_result_keeps_turn_owner_registered() {
        let session = KimiSession::new("workspace-1".to_string(), std::env::temp_dir(), None);
        let child = Command::new("sh")
            .arg("-c")
            .arg("sleep 30")
            .spawn()
            .expect("spawn child");
        session
            .active_processes
            .lock()
            .await
            .insert("turn-owned".to_string(), ActiveKimiChildProcess::new(child));

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
    fn parses_assistant_text_line() {
        let line = json!({"role":"assistant","content":"hello"});
        match parse_kimi_stream_line(&line) {
            KimiStreamLine::AssistantText(text) => assert_eq!(text, "hello"),
            _ => panic!("expected AssistantText"),
        }
    }

    #[test]
    fn parses_assistant_tool_calls_line() {
        let line = json!({
            "role":"assistant",
            "tool_calls":[{
                "type":"function",
                "id":"tool_abc",
                "function":{"name":"Bash","arguments":"{\"command\":\"echo hi\"}"}
            }]
        });
        match parse_kimi_stream_line(&line) {
            KimiStreamLine::ToolCalls(calls) => {
                assert_eq!(calls.len(), 1);
                assert_eq!(calls[0].id, "tool_abc");
                assert_eq!(calls[0].name, "Bash");
                assert_eq!(calls[0].arguments, Some(json!({"command":"echo hi"})));
            }
            _ => panic!("expected ToolCalls"),
        }
    }

    #[test]
    fn parses_tool_result_line() {
        let line = json!({"role":"tool","tool_call_id":"tool_abc","content":"OK\n"});
        match parse_kimi_stream_line(&line) {
            KimiStreamLine::ToolResult {
                tool_call_id,
                content,
            } => {
                assert_eq!(tool_call_id, "tool_abc");
                assert_eq!(content, "OK\n");
            }
            _ => panic!("expected ToolResult"),
        }
    }

    #[test]
    fn parses_session_resume_hint_line() {
        let line = json!({
            "role":"meta",
            "type":"session.resume_hint",
            "session_id":"session_1234",
            "command":"kimi -r session_1234"
        });
        match parse_kimi_stream_line(&line) {
            KimiStreamLine::SessionHint { session_id } => {
                assert_eq!(session_id, "session_1234")
            }
            _ => panic!("expected SessionHint"),
        }
    }

    #[test]
    fn ignores_unknown_lines() {
        let line = json!({"role":"meta","type":"something.else"});
        assert!(matches!(
            parse_kimi_stream_line(&line),
            KimiStreamLine::Other
        ));
        let empty_content = json!({"role":"assistant","content":""});
        assert!(matches!(
            parse_kimi_stream_line(&empty_content),
            KimiStreamLine::Other
        ));
    }

    #[test]
    fn tolerates_array_content_parts() {
        let line = json!({
            "role":"assistant",
            "content":[{"type":"text","text":"foo"},{"type":"text","text":"bar"}]
        });
        match parse_kimi_stream_line(&line) {
            KimiStreamLine::AssistantText(text) => assert_eq!(text, "foobar"),
            _ => panic!("expected AssistantText"),
        }
    }

    #[test]
    fn converts_repeated_assistant_snapshots_to_suffix_deltas() {
        let mut accumulated = String::new();

        assert_eq!(
            merge_kimi_assistant_text_snapshot(&mut accumulated, "我是 Kimi"),
            Some("我是 Kimi".to_string())
        );
        assert_eq!(accumulated, "我是 Kimi");
        assert_eq!(
            merge_kimi_assistant_text_snapshot(&mut accumulated, "我是 Kimi Code"),
            Some(" Code".to_string())
        );
        assert_eq!(accumulated, "我是 Kimi Code");
        assert_eq!(
            merge_kimi_assistant_text_snapshot(&mut accumulated, "我是 Kimi Code"),
            None
        );
        assert_eq!(accumulated, "我是 Kimi Code");
    }

    #[test]
    fn preserves_chunk_style_assistant_text_when_not_snapshot_prefix() {
        let mut accumulated = String::new();

        assert_eq!(
            merge_kimi_assistant_text_snapshot(&mut accumulated, "第一段"),
            Some("第一段".to_string())
        );
        assert_eq!(
            merge_kimi_assistant_text_snapshot(&mut accumulated, "第二段"),
            Some("第二段".to_string())
        );
        assert_eq!(accumulated, "第一段第二段");
    }
}
