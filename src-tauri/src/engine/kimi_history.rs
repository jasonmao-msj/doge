//! Read Kimi CLI session history from `<kimi-home>/session_index.jsonl` and
//! `sessions/<wdKey>/<sessionId>/{state.json,agents/main/wire.jsonl}`.
//!
//! Layout (kimi-code >= 0.27):
//! - `session_index.jsonl`: one JSON object per line `{sessionId, sessionDir, workDir}`.
//! - `state.json`: `{title, lastPrompt, createdAt, updatedAt, workDir, ...}` (RFC3339 times).
//! - `agents/main/wire.jsonl`: append-only event log. Relevant line types:
//!   - `turn.prompt` — user prompt (`input: [{type:"text", text}]`, `time` epoch millis)
//!   - `context.append_loop_event` with `event.type`:
//!     - `content.part` — `part.type` `text` (assistant) / `think` (reasoning)
//!     - `tool.call` — `{toolCallId, name, args, description}`
//!     - `tool.result` — `{toolCallId, result: {output}}`
//!   - `usage.record` — `{usage: {inputOther, output, inputCacheRead, inputCacheCreation}}`
//!   Other types (`metadata`, `config.update`, `llm.request`, `llm.tools_snapshot`,
//!   `tools.set_active_tools`, `step.begin`, `step.end`, ...) are skipped.

use chrono::DateTime;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::fs;
use tokio::time::timeout;

const LOCAL_SESSION_SCAN_TIMEOUT: Duration = Duration::from_secs(60);

fn normalize_session_id(session_id: &str) -> Result<String, String> {
    let normalized = session_id.trim();
    if normalized.is_empty()
        || normalized == "."
        || normalized.contains('/')
        || normalized.contains('\\')
        || normalized.contains("..")
    {
        return Err("[SESSION_NOT_FOUND] Invalid Kimi session id".to_string());
    }
    Ok(normalized.to_string())
}

/// Summary of a Kimi session for sidebar display.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiSessionSummary {
    pub session_id: String,
    pub first_message: String,
    pub updated_at: i64,
    pub created_at: i64,
    pub message_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canonical_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribution_status: Option<String>,
}

/// Single normalized message row used by frontend history parser.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiSessionMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    /// "message", "reasoning", or "tool"
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_input: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_output: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KimiSessionUsage {
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_creation_input_tokens: Option<i64>,
    pub cache_read_input_tokens: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KimiSessionLoadResult {
    pub messages: Vec<KimiSessionMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<KimiSessionUsage>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KimiSessionIndexEntry {
    session_id: String,
    session_dir: String,
    work_dir: String,
}

fn parse_timestamp_millis(value: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

fn millis_to_timestamp_text(value: i64) -> Option<String> {
    DateTime::from_timestamp_millis(value).map(|dt| dt.to_rfc3339())
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let truncated: String = value.chars().take(max_chars).collect();
    format!("{}…", truncated)
}

fn normalize_windows_path_for_comparison(path: &str) -> String {
    if path.is_empty() {
        return String::new();
    }
    let mut normalized = path.replace('\\', "/");
    if normalized.starts_with("//?/UNC/") {
        normalized = format!("//{}", &normalized["//?/UNC/".len()..]);
    } else if normalized.starts_with("//?/") {
        normalized = normalized["//?/".len()..].to_string();
    }
    while normalized.ends_with('/') && normalized.len() > 1 {
        normalized.pop();
    }
    normalized
}

fn build_path_variants(path: &str) -> Vec<String> {
    let normalized = normalize_windows_path_for_comparison(path.trim());
    if normalized.is_empty() {
        return Vec::new();
    }
    let mut variants = vec![normalized.clone()];
    if normalized.starts_with("/private/") {
        variants.push(normalized["/private".len()..].to_string());
    } else if normalized.starts_with('/') {
        variants.push(format!("/private{}", normalized));
    }
    if normalized.len() >= 2 && normalized.as_bytes()[1] == b':' {
        let mut chars = normalized.chars();
        if let Some(first) = chars.next() {
            variants.push(format!("{}{}", first.to_ascii_lowercase(), chars.as_str()));
        }
        variants.push(normalized.to_ascii_lowercase());
    }
    if normalized.starts_with("//") {
        variants.push(normalized.to_ascii_lowercase());
    }
    variants.sort();
    variants.dedup();
    variants
}

fn build_workspace_path_variants(workspace_path: &Path) -> Vec<String> {
    let workspace_raw = workspace_path.to_string_lossy().to_string();
    let mut workspace_variants = build_path_variants(&workspace_raw);
    if let Ok(canonical_workspace) = std::fs::canonicalize(workspace_path) {
        let canonical_workspace_raw = canonical_workspace.to_string_lossy().to_string();
        workspace_variants.extend(build_path_variants(&canonical_workspace_raw));
    }
    workspace_variants.sort();
    workspace_variants.dedup();
    workspace_variants
}

fn path_is_same_or_child(candidate: &str, base: &str) -> bool {
    if candidate.is_empty() || base.is_empty() {
        return false;
    }
    if candidate == base {
        return true;
    }
    if base == "/" {
        return candidate.starts_with('/');
    }
    candidate.starts_with(base) && candidate.chars().nth(base.len()) == Some('/')
}

fn matches_workspace_path(work_dir: &str, workspace_variants: &[String]) -> bool {
    if workspace_variants.is_empty() {
        return false;
    }
    let work_dir_variants = build_path_variants(work_dir);
    for candidate in work_dir_variants {
        for workspace in workspace_variants {
            // One-way only: session workDir must be the workspace or a child of it.
            // Reverse matching (workspace under session dir) leaks home/tmp sessions
            // into every nested empty project, e.g. workDir=/Users/me shown under
            // /Users/me/Desktop/新的空文件夹.
            if path_is_same_or_child(&candidate, workspace) {
                return true;
            }
        }
    }
    false
}

fn expand_home_prefixed_path(path: &str) -> Option<PathBuf> {
    if path == "~" {
        return dirs::home_dir();
    }
    let relative = path
        .strip_prefix("~/")
        .or_else(|| path.strip_prefix("~\\"))
        .filter(|value| !value.is_empty())?;
    dirs::home_dir().map(|home| home.join(relative))
}

fn resolve_kimi_base_dir(custom_home: Option<&str>) -> PathBuf {
    if let Some(home) = custom_home.map(str::trim).filter(|value| !value.is_empty()) {
        if let Some(expanded) = expand_home_prefixed_path(home) {
            return expanded;
        }
        return PathBuf::from(home);
    }
    if let Some(home) = std::env::var_os("KIMI_CODE_HOME").filter(|value| !value.is_empty()) {
        let configured = PathBuf::from(home);
        let configured_text = configured.to_string_lossy();
        if let Some(expanded) = expand_home_prefixed_path(&configured_text) {
            return expanded;
        }
        return configured;
    }
    dirs::home_dir().unwrap_or_default().join(".kimi-code")
}

async fn read_index_entries(base_dir: &Path) -> Vec<KimiSessionIndexEntry> {
    let index_path = base_dir.join("session_index.jsonl");
    let raw = match fs::read_to_string(&index_path).await {
        Ok(raw) => raw,
        Err(_) => return Vec::new(),
    };
    raw.lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            serde_json::from_str::<KimiSessionIndexEntry>(line).ok()
        })
        .filter(|entry| !entry.session_id.trim().is_empty() && !entry.session_dir.trim().is_empty())
        .collect()
}

fn wire_log_path(session_dir: &Path) -> PathBuf {
    session_dir.join("agents").join("main").join("wire.jsonl")
}

fn extract_input_text(input: Option<&Value>) -> String {
    match input {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter(|part| part.get("type").and_then(|v| v.as_str()) == Some("text"))
            .filter_map(|part| part.get("text").and_then(|v| v.as_str()))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// Build a sidebar summary from one index entry. Best-effort: missing
/// `state.json` or `wire.jsonl` degrade individual fields instead of
/// dropping the session.
async fn build_summary_from_entry(entry: &KimiSessionIndexEntry) -> KimiSessionSummary {
    let session_dir = PathBuf::from(entry.session_dir.trim());
    let state_path = session_dir.join("state.json");
    let wire_path = wire_log_path(&session_dir);

    let state_value = fs::read_to_string(&state_path)
        .await
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok());
    let wire_raw = fs::read_to_string(&wire_path).await.ok();

    let wire_mtime_millis = std::fs::metadata(&wire_path)
        .or_else(|_| std::fs::metadata(&state_path))
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64);

    let created_at = state_value
        .as_ref()
        .and_then(|state| state.get("createdAt"))
        .and_then(|v| v.as_str())
        .and_then(parse_timestamp_millis)
        .or(wire_mtime_millis)
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
    let updated_at = state_value
        .as_ref()
        .and_then(|state| state.get("updatedAt"))
        .and_then(|v| v.as_str())
        .and_then(parse_timestamp_millis)
        .or(wire_mtime_millis)
        .unwrap_or(created_at);

    let title = state_value
        .as_ref()
        .and_then(|state| state.get("title"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let last_prompt = state_value
        .as_ref()
        .and_then(|state| state.get("lastPrompt"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

    let mut message_count = 0usize;
    let mut first_prompt_text: Option<String> = None;
    if let Some(wire) = wire_raw.as_deref() {
        for line in wire.lines() {
            if !line.contains("\"type\":\"turn.prompt\"") {
                continue;
            }
            message_count += 1;
            if first_prompt_text.is_none() {
                if let Ok(value) = serde_json::from_str::<Value>(line) {
                    let text = extract_input_text(value.get("input"));
                    let (display_text, image_paths) =
                        crate::engine::cli_image_input::split_kimi_prompt_for_display(&text);
                    let preview = if display_text.trim().is_empty() && !image_paths.is_empty() {
                        format!("[{} image(s)]", image_paths.len())
                    } else {
                        display_text
                    };
                    if !preview.trim().is_empty() {
                        first_prompt_text = Some(preview);
                    }
                }
            }
        }
    }

    let first_message = title
        .or(last_prompt)
        .or(first_prompt_text)
        .map(|text| truncate_chars(&text, 60))
        .unwrap_or_else(|| entry.session_id.clone());

    let file_size_bytes = std::fs::metadata(&wire_path)
        .or_else(|_| std::fs::metadata(&state_path))
        .ok()
        .map(|metadata| metadata.len());

    KimiSessionSummary {
        canonical_session_id: Some(entry.session_id.clone()),
        session_id: entry.session_id.clone(),
        first_message,
        updated_at,
        created_at,
        message_count,
        file_size_bytes,
        engine: Some("kimi".to_string()),
        attribution_status: Some("strict-match".to_string()),
    }
}

fn accumulate_usage(target: &mut Option<i64>, delta: Option<i64>) {
    if let Some(delta) = delta {
        *target = Some(target.unwrap_or(0) + delta);
    }
}

/// Parse `wire.jsonl` content into normalized messages + aggregated usage.
fn parse_messages_from_wire(raw: &str) -> KimiSessionLoadResult {
    let mut messages: Vec<KimiSessionMessage> = Vec::new();
    let mut usage = KimiSessionUsage::default();
    let mut saw_usage = false;
    let mut counter = 0usize;

    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() || !line.contains("\"type\"") {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let line_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let timestamp = value
            .get("time")
            .and_then(|v| v.as_i64())
            .and_then(millis_to_timestamp_text);

        match line_type {
            "turn.prompt" => {
                let text = extract_input_text(value.get("input"));
                if text.trim().is_empty() {
                    continue;
                }
                // Wire prompt may include doge or legacy CLI-only image injection. Split so
                // the canvas shows user text + image thumbnails, never the
                // ReadMediaFile instruction block.
                let (display_text, image_paths) =
                    crate::engine::cli_image_input::split_kimi_prompt_for_display(&text);
                if display_text.trim().is_empty() && image_paths.is_empty() {
                    continue;
                }
                counter += 1;
                messages.push(KimiSessionMessage {
                    id: format!("kimi-user-{}", counter),
                    role: "user".to_string(),
                    text: display_text,
                    images: if image_paths.is_empty() {
                        None
                    } else {
                        Some(image_paths)
                    },
                    timestamp,
                    kind: "message".to_string(),
                    tool_type: None,
                    title: None,
                    tool_input: None,
                    tool_output: None,
                });
            }
            "context.append_loop_event" => {
                let Some(event) = value.get("event") else {
                    continue;
                };
                match event.get("type").and_then(|v| v.as_str()) {
                    Some("content.part") => {
                        let Some(part) = event.get("part") else {
                            continue;
                        };
                        let part_id = event
                            .get("uuid")
                            .and_then(|v| v.as_str())
                            .map(|value| value.to_string())
                            .unwrap_or_else(|| {
                                counter += 1;
                                format!("kimi-part-{}", counter)
                            });
                        match part.get("type").and_then(|v| v.as_str()) {
                            Some("text") => {
                                let text = part
                                    .get("text")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                if text.trim().is_empty() {
                                    continue;
                                }
                                messages.push(KimiSessionMessage {
                                    id: part_id,
                                    role: "assistant".to_string(),
                                    text,
                                    images: None,
                                    timestamp,
                                    kind: "message".to_string(),
                                    tool_type: None,
                                    title: None,
                                    tool_input: None,
                                    tool_output: None,
                                });
                            }
                            Some("think") => {
                                let text = part
                                    .get("think")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                if text.trim().is_empty() {
                                    continue;
                                }
                                messages.push(KimiSessionMessage {
                                    id: format!("{}-reasoning", part_id),
                                    role: "assistant".to_string(),
                                    text,
                                    images: None,
                                    timestamp,
                                    kind: "reasoning".to_string(),
                                    tool_type: None,
                                    title: None,
                                    tool_input: None,
                                    tool_output: None,
                                });
                            }
                            _ => {}
                        }
                    }
                    Some("tool.call") => {
                        let call_id = event
                            .get("toolCallId")
                            .and_then(|v| v.as_str())
                            .or_else(|| event.get("uuid").and_then(|v| v.as_str()))
                            .map(|value| value.to_string())
                            .unwrap_or_else(|| {
                                counter += 1;
                                format!("kimi-tool-{}", counter)
                            });
                        let tool_name = event
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or("tool")
                            .to_string();
                        let input_value = event.get("args").cloned();
                        let input_text = input_value
                            .as_ref()
                            .and_then(|v| serde_json::to_string_pretty(v).ok())
                            .unwrap_or_default();
                        let title = event
                            .get("description")
                            .and_then(|v| v.as_str())
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(|value| value.to_string())
                            .unwrap_or_else(|| tool_name.clone());
                        messages.push(KimiSessionMessage {
                            id: call_id,
                            role: "assistant".to_string(),
                            text: input_text,
                            images: None,
                            timestamp,
                            kind: "tool".to_string(),
                            tool_type: Some(tool_name),
                            title: Some(title),
                            tool_input: input_value,
                            tool_output: None,
                        });
                    }
                    Some("tool.result") => {
                        let call_id = event
                            .get("toolCallId")
                            .and_then(|v| v.as_str())
                            .or_else(|| event.get("parentUuid").and_then(|v| v.as_str()))
                            .map(|value| value.to_string())
                            .unwrap_or_else(|| {
                                counter += 1;
                                format!("kimi-tool-{}", counter)
                            });
                        let result = event.get("result").cloned().unwrap_or(Value::Null);
                        let output_text = result
                            .get("output")
                            .and_then(|v| v.as_str())
                            .map(|value| value.to_string())
                            .unwrap_or_else(|| serde_json::to_string(&result).unwrap_or_default());
                        if output_text.trim().is_empty() {
                            continue;
                        }
                        let is_error = result
                            .get("isError")
                            .or_else(|| result.get("is_error"))
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        messages.push(KimiSessionMessage {
                            id: format!("{}-result", call_id),
                            role: "assistant".to_string(),
                            text: output_text,
                            images: None,
                            timestamp,
                            kind: "tool".to_string(),
                            tool_type: Some(if is_error {
                                "error".to_string()
                            } else {
                                "result".to_string()
                            }),
                            title: Some(if is_error {
                                "Error".to_string()
                            } else {
                                "Result".to_string()
                            }),
                            tool_input: None,
                            tool_output: Some(result),
                        });
                    }
                    _ => {}
                }
            }
            "usage.record" => {
                if let Some(record) = value.get("usage") {
                    saw_usage = true;
                    accumulate_usage(
                        &mut usage.input_tokens,
                        record.get("inputOther").and_then(|v| v.as_i64()),
                    );
                    accumulate_usage(
                        &mut usage.output_tokens,
                        record.get("output").and_then(|v| v.as_i64()),
                    );
                    accumulate_usage(
                        &mut usage.cache_read_input_tokens,
                        record.get("inputCacheRead").and_then(|v| v.as_i64()),
                    );
                    accumulate_usage(
                        &mut usage.cache_creation_input_tokens,
                        record.get("inputCacheCreation").and_then(|v| v.as_i64()),
                    );
                }
            }
            _ => {}
        }
    }

    KimiSessionLoadResult {
        messages,
        usage: if saw_usage { Some(usage) } else { None },
    }
}

async fn resolve_workspace_index_entries(
    workspace_path: &Path,
    custom_home: Option<&str>,
) -> Vec<KimiSessionIndexEntry> {
    let base_dir = resolve_kimi_base_dir(custom_home);
    let workspace_variants = build_workspace_path_variants(workspace_path);
    read_index_entries(&base_dir)
        .await
        .into_iter()
        .filter(|entry| matches_workspace_path(&entry.work_dir, &workspace_variants))
        .collect()
}

/// List Kimi sessions for a workspace path.
pub async fn list_kimi_sessions(
    workspace_path: &Path,
    limit: Option<usize>,
    custom_home: Option<&str>,
) -> Result<Vec<KimiSessionSummary>, String> {
    timeout(LOCAL_SESSION_SCAN_TIMEOUT, async {
        let entries = resolve_workspace_index_entries(workspace_path, custom_home).await;
        let mut sessions = Vec::new();
        for entry in entries {
            sessions.push(build_summary_from_entry(&entry).await);
        }
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        sessions.truncate(limit.unwrap_or(200));
        Ok(sessions)
    })
    .await
    .map_err(|_| "Kimi session scan timed out".to_string())?
}

async fn find_workspace_index_entry(
    workspace_path: &Path,
    session_id: &str,
    custom_home: Option<&str>,
) -> Result<KimiSessionIndexEntry, String> {
    let normalized_session_id = normalize_session_id(session_id)?;
    let entries = timeout(
        LOCAL_SESSION_SCAN_TIMEOUT,
        resolve_workspace_index_entries(workspace_path, custom_home),
    )
    .await
    .map_err(|_| "Kimi session scan timed out".to_string())?;
    entries
        .into_iter()
        .find(|entry| entry.session_id.trim() == normalized_session_id)
        .ok_or_else(|| format!("Kimi session not found: {}", normalized_session_id))
}

pub(crate) async fn resolve_kimi_session_history_path(
    workspace_path: &Path,
    session_id: &str,
    custom_home: Option<&str>,
) -> Result<PathBuf, String> {
    let entry = find_workspace_index_entry(workspace_path, session_id, custom_home).await?;
    Ok(wire_log_path(Path::new(entry.session_dir.trim())))
}

/// Load full Kimi session messages by session id.
pub async fn load_kimi_session(
    workspace_path: &Path,
    session_id: &str,
    custom_home: Option<&str>,
) -> Result<KimiSessionLoadResult, String> {
    let entry = find_workspace_index_entry(workspace_path, session_id, custom_home).await?;
    let wire_path = wire_log_path(Path::new(entry.session_dir.trim()));
    let raw = fs::read_to_string(&wire_path).await.map_err(|error| {
        format!(
            "Failed to read Kimi session wire log {}: {}",
            wire_path.display(),
            error
        )
    })?;
    Ok(parse_messages_from_wire(&raw))
}

/// Delete a Kimi session: remove the session directory and drop its index lines.
pub async fn delete_kimi_session(
    workspace_path: &Path,
    session_id: &str,
    custom_home: Option<&str>,
) -> Result<(), String> {
    let normalized_session_id = normalize_session_id(session_id)?;
    let entry =
        find_workspace_index_entry(workspace_path, &normalized_session_id, custom_home).await?;

    let session_dir = PathBuf::from(entry.session_dir.trim());
    if session_dir.exists() {
        fs::remove_dir_all(&session_dir).await.map_err(|error| {
            format!(
                "[IO_ERROR] Failed to delete Kimi session dir {}: {}",
                session_dir.display(),
                error
            )
        })?;
    }

    let index_path = resolve_kimi_base_dir(custom_home).join("session_index.jsonl");
    if let Ok(raw) = fs::read_to_string(&index_path).await {
        let kept: Vec<&str> = raw
            .lines()
            .filter(|line| {
                let line = line.trim();
                if line.is_empty() {
                    return false;
                }
                match serde_json::from_str::<KimiSessionIndexEntry>(line) {
                    Ok(index_entry) => index_entry.session_id.trim() != normalized_session_id,
                    // Preserve unparsable lines rather than silently dropping data.
                    Err(_) => true,
                }
            })
            .collect();
        let mut rewritten = kept.join("\n");
        if !rewritten.is_empty() {
            rewritten.push('\n');
        }
        fs::write(&index_path, rewritten).await.map_err(|error| {
            format!(
                "[IO_ERROR] Failed to rewrite Kimi session index {}: {}",
                index_path.display(),
                error
            )
        })?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{matches_workspace_path, parse_messages_from_wire, parse_timestamp_millis};
    use std::path::Path;

    #[test]
    fn parses_wire_user_assistant_reasoning_tool_and_usage() {
        let wire = concat!(
            "{\"type\":\"metadata\",\"time\":1784340688000}\n",
            "{\"type\":\"turn.prompt\",\"input\":[{\"type\":\"text\",\"text\":\"你好\"}],\"origin\":{\"kind\":\"user\"},\"time\":1784340688097}\n",
            "{\"type\":\"context.append_message\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"你好\"}]},\"time\":1784340688098}\n",
            "{\"type\":\"context.append_loop_event\",\"event\":{\"type\":\"step.begin\",\"uuid\":\"s1\",\"turnId\":\"0\",\"step\":1},\"time\":1784340697348}\n",
            "{\"type\":\"context.append_loop_event\",\"event\":{\"type\":\"content.part\",\"uuid\":\"p1\",\"part\":{\"type\":\"think\",\"think\":\"用户在打招呼\"}},\"time\":1784340698782}\n",
            "{\"type\":\"context.append_loop_event\",\"event\":{\"type\":\"content.part\",\"uuid\":\"p2\",\"part\":{\"type\":\"text\",\"text\":\"你好！\"}},\"time\":1784340698783}\n",
            "{\"type\":\"context.append_loop_event\",\"event\":{\"type\":\"tool.call\",\"uuid\":\"t1\",\"toolCallId\":\"tool_1\",\"name\":\"Grep\",\"args\":{\"pattern\":\"kimi\"},\"description\":\"Searching for kimi\"},\"time\":1784340698790}\n",
            "{\"type\":\"context.append_loop_event\",\"event\":{\"type\":\"tool.result\",\"parentUuid\":\"t1\",\"toolCallId\":\"tool_1\",\"result\":{\"output\":\"src/main.rs\"}},\"time\":1784340698795}\n",
            "{\"type\":\"usage.record\",\"model\":\"kimi-code/kimi-for-coding\",\"usage\":{\"inputOther\":100,\"output\":33,\"inputCacheRead\":20,\"inputCacheCreation\":5},\"usageScope\":\"turn\",\"time\":1784340698800}\n",
            "{\"type\":\"usage.record\",\"model\":\"kimi-code/kimi-for-coding\",\"usage\":{\"inputOther\":50,\"output\":7,\"inputCacheRead\":0,\"inputCacheCreation\":0},\"usageScope\":\"turn\",\"time\":1784340698900}\n"
        );

        let result = parse_messages_from_wire(wire);

        assert_eq!(result.messages.len(), 5);
        assert_eq!(result.messages[0].role, "user");
        assert_eq!(result.messages[0].text, "你好");
        assert_eq!(result.messages[0].images, None);
        assert_eq!(result.messages[0].kind, "message");
        assert_eq!(result.messages[1].kind, "reasoning");
        assert_eq!(result.messages[1].text, "用户在打招呼");
        assert_eq!(result.messages[2].kind, "message");
        assert_eq!(result.messages[2].text, "你好！");
        assert_eq!(result.messages[3].kind, "tool");
        assert_eq!(result.messages[3].tool_type.as_deref(), Some("Grep"));
        assert_eq!(
            result.messages[3].title.as_deref(),
            Some("Searching for kimi")
        );
        assert_eq!(result.messages[4].id, "tool_1-result");
        assert_eq!(result.messages[4].tool_type.as_deref(), Some("result"));
        assert_eq!(result.messages[4].text, "src/main.rs");

        let usage = result.usage.expect("usage aggregated");
        assert_eq!(usage.input_tokens, Some(150));
        assert_eq!(usage.output_tokens, Some(40));
        assert_eq!(usage.cache_read_input_tokens, Some(20));
        assert_eq!(usage.cache_creation_input_tokens, Some(5));
    }

    #[test]
    fn strips_mossx_image_injection_into_display_text_and_images() {
        let wire = concat!(
            r#"{"type":"turn.prompt","input":[{"type":"text","text":"请看截图\n\n<!-- mossx:kimi-image-attachments -->\nThe user attached the following image file(s). You MUST call ReadMediaFile on each path below before answering any question about visual content.\n1. /tmp/shot.png\n<image path=\"/tmp/shot.png\"></image>\n"}],"origin":{"kind":"user"},"time":1784340688097}"#,
            "\n",
        );
        let result = parse_messages_from_wire(wire);
        assert_eq!(result.messages.len(), 1);
        assert_eq!(result.messages[0].role, "user");
        assert_eq!(result.messages[0].text, "请看截图");
        assert_eq!(
            result.messages[0].images.as_deref(),
            Some(&["/tmp/shot.png".to_string()][..])
        );
        assert!(!result.messages[0].text.contains("ReadMediaFile"));
    }

    #[test]
    fn skips_irrelevant_wire_line_types() {
        let wire = concat!(
            "{\"type\":\"config.update\",\"time\":1}\n",
            "{\"type\":\"llm.request\",\"payload\":{},\"time\":2}\n",
            "{\"type\":\"llm.tools_snapshot\",\"time\":3}\n",
            "{\"type\":\"tools.set_active_tools\",\"time\":4}\n",
            "not json at all\n",
            "{\"type\":\"context.append_loop_event\",\"event\":{\"type\":\"step.end\"},\"time\":5}\n"
        );

        let result = parse_messages_from_wire(wire);

        assert!(result.messages.is_empty());
        assert!(result.usage.is_none());
    }

    #[test]
    fn matches_workspace_path_variants() {
        let variants = vec![
            "/Users/demo/repo".to_string(),
            "/private/Users/demo/repo".to_string(),
        ];
        assert!(matches_workspace_path("/Users/demo/repo", &variants));
        assert!(matches_workspace_path(
            "/private/Users/demo/repo",
            &variants
        ));
        assert!(matches_workspace_path(
            "/Users/demo/repo/packages/app",
            &variants
        ));
        assert!(!matches_workspace_path("/Users/demo/other", &variants));
        assert!(!matches_workspace_path("", &variants));
        // Home-level sessions must not appear inside nested empty folders.
        assert!(!matches_workspace_path(
            "/Users/demo",
            &["/Users/demo/Desktop/新的空文件夹".to_string()]
        ));
    }

    #[test]
    fn parses_rfc3339_timestamps() {
        assert_eq!(
            parse_timestamp_millis("2026-07-18T02:11:11.192Z"),
            Some(1784340671192)
        );
        assert_eq!(parse_timestamp_millis("not-a-date"), None);
    }

    #[test]
    fn workspace_match_requires_variants() {
        assert!(!matches_workspace_path("/tmp", &[]));
        let _ = Path::new("/tmp");
    }
}
