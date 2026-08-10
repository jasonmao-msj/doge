use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::sync::{oneshot, Mutex};
use tokio::time::{sleep, timeout};

use crate::backend::app_server::{build_codex_command_with_bin, WorkspaceSession};
use crate::codex::args::{apply_codex_args, resolve_workspace_codex_args};
use crate::codex::collaboration_policy::{
    apply_policy_to_collaboration_mode, apply_policy_to_collaboration_mode_with_extra_directives,
    resolve_policy,
};
use crate::codex::config as codex_config;
use crate::codex::home::{resolve_default_codex_home, resolve_workspace_codex_home};
use crate::codex::provider_profile::{
    codex_runtime_key, legacy_codex_runtime_key, CODEX_DISK_PROVIDER_PROFILE_ID,
};
use crate::rules;
use crate::shared::account::{build_account_response, read_auth_account};
use crate::shared::workspace_snapshot::{
    resolve_workspace_and_parent, resolve_workspace_parent_and_settings,
};
use crate::types::{AppSettings, WorkspaceEntry};

const THREAD_COMPACTION_METHOD_CANDIDATES: [&str; 3] = [
    "thread/compact/start",
    "thread/compactStart",
    "thread/compact",
];
const TURN_START_THREAD_NOT_FOUND_RETRY_DELAYS_MS: [u64; 4] = [150, 350, 750, 1_500];
const THREAD_RESUME_READY_RETRY_DELAYS_MS: [u64; 5] = [150, 350, 750, 1_500, 3_000];
// Disk Codex cold starts can take longer than the normal turn/start ack window.
// Keep readiness bounded, but do not misclassify a slow first resume as a broken thread.
const THREAD_START_READY_CONFIRM_TIMEOUT_MS: u64 = 8_000;
const FIRST_PACKET_TIMEOUT_ERROR_PREFIX: &str = "FIRST_PACKET_TIMEOUT";
pub(crate) const INVALID_THREAD_START_RESPONSE_ERROR_PREFIX: &str = "invalid_thread_start_response";

fn normalize_preferred_language(preferred_language: Option<&str>) -> Option<&'static str> {
    match preferred_language
        .map(|value| value.trim().to_lowercase())
        .as_deref()
    {
        Some("zh") | Some("zh-cn") | Some("zh-hans") | Some("chinese") => Some("zh"),
        Some("en") | Some("en-us") | Some("en-gb") | Some("english") => Some("en"),
        _ => None,
    }
}

fn normalize_custom_spec_root(custom_spec_root: Option<&str>) -> Option<String> {
    let trimmed = custom_spec_root?.trim();
    if trimmed.is_empty() {
        return None;
    }
    if !Path::new(trimmed).is_absolute() {
        return None;
    }
    Some(trimmed.to_string())
}

fn build_first_packet_timeout_error(timeout_duration: Duration) -> String {
    let timeout_seconds = timeout_duration.as_secs().max(1);
    format!(
        "{FIRST_PACKET_TIMEOUT_ERROR_PREFIX}:{timeout_seconds}:Timed out waiting for initial response. Network, proxy, or upstream service load may be causing delay. Please retry."
    )
}

fn build_writable_roots(workspace_path: &str, custom_spec_root: Option<&str>) -> Vec<String> {
    let mut writable_roots = Vec::new();
    if let Some(spec_root) = custom_spec_root {
        if !writable_roots.iter().any(|path| path == spec_root) {
            writable_roots.push(spec_root.to_string());
        }
    }
    if !writable_roots.iter().any(|path| path == workspace_path) {
        writable_roots.push(workspace_path.to_string());
    }
    writable_roots
}

fn resolve_execution_policy(
    access_mode: &str,
    workspace_path: &str,
    custom_spec_root: Option<&str>,
    effective_mode: &str,
    mode_enforcement_enabled: bool,
) -> (Value, &'static str, Option<&'static str>) {
    let mut sandbox_policy = match access_mode {
        "full-access" => json!({ "type": "dangerFullAccess" }),
        "read-only" => json!({ "type": "readOnly" }),
        "squad-current-workspace" => json!({
            "type": "workspaceWrite",
            "writableRoots": [workspace_path],
            "networkAccess": false
        }),
        _ => {
            let writable_roots = build_writable_roots(workspace_path, custom_spec_root);
            json!({
                "type": "workspaceWrite",
                "writableRoots": writable_roots,
                "networkAccess": true
            })
        }
    };

    let mut approval_policy = if matches!(access_mode, "full-access" | "squad-current-workspace") {
        "never"
    } else {
        "on-request"
    };

    if mode_enforcement_enabled && effective_mode == "plan" {
        sandbox_policy = json!({ "type": "readOnly" });
        approval_policy = "on-request";
        return (
            sandbox_policy,
            approval_policy,
            Some("plan_readonly_violation"),
        );
    }

    (sandbox_policy, approval_policy, None)
}

/// Squad Mutate 的 sealed `squad-current-workspace` 边界不能被 collaboration-mode 强制
/// 静默降级为 read-only：降级后 worker 会拿到比已批准权限更小的执行面，且 change fence
/// 无法对账。命中时 dispatch 必须 fail closed，而不是发出一个被改写的 sandbox policy。
fn squad_mutation_policy_rejection(
    access_mode: &str,
    enforcement_reason: Option<&str>,
) -> Option<String> {
    if access_mode == "squad-current-workspace" && enforcement_reason.is_some() {
        Some(
            "squad-mutate-authority-denied: plan mode enforcement would downgrade the sealed \
             workspace mutation boundary to read-only"
                .to_string(),
        )
    } else {
        None
    }
}

pub(crate) fn extract_thread_id_from_response(value: &Value) -> Option<String> {
    value
        .get("result")
        .and_then(|result| result.get("threadId"))
        .or_else(|| {
            value
                .get("result")
                .and_then(|result| result.get("thread_id"))
        })
        .or_else(|| {
            value
                .get("result")
                .and_then(|result| result.get("thread"))
                .and_then(|thread| thread.get("id"))
        })
        .or_else(|| value.get("threadId"))
        .or_else(|| value.get("thread_id"))
        .or_else(|| value.get("thread").and_then(|thread| thread.get("id")))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|thread_id| !thread_id.is_empty())
        .map(ToString::to_string)
}

fn summarize_thread_start_response_shape(value: &Value) -> String {
    let root_keys = value
        .as_object()
        .map(|object| object.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let result_keys = value
        .get("result")
        .and_then(Value::as_object)
        .map(|object| object.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let has_error = value.get("error").is_some()
        || value
            .get("result")
            .and_then(|result| result.get("error"))
            .is_some();
    format!("root_keys={root_keys:?}; result_keys={result_keys:?}; has_error={has_error}")
}

pub(crate) fn validate_thread_start_response(response: Value) -> Result<Value, String> {
    if let Some(error) = extract_error_message_from_response(&response) {
        return Err(format!("thread/start failed: {error}"));
    }
    if extract_thread_id_from_response(&response).is_some() {
        return Ok(response);
    }
    Err(format!(
        "{INVALID_THREAD_START_RESPONSE_ERROR_PREFIX}: {}",
        summarize_thread_start_response_shape(&response)
    ))
}

fn extract_parent_thread_id_from_response(value: &Value) -> Option<String> {
    value
        .get("result")
        .and_then(|result| {
            result
                .get("parentThreadId")
                .or_else(|| result.get("parent_thread_id"))
                .or_else(|| result.get("parentId"))
                .or_else(|| result.get("parent_id"))
                .or_else(|| {
                    result
                        .get("thread")
                        .and_then(|thread| thread.get("parentId"))
                        .or_else(|| {
                            result
                                .get("thread")
                                .and_then(|thread| thread.get("parent_id"))
                        })
                })
        })
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn ensure_collaboration_mode_defaults(
    payload: Value,
    model: Option<&str>,
    effort: Option<&str>,
) -> Value {
    let mut root = payload.as_object().cloned().unwrap_or_default();
    let mut settings = root
        .get("settings")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let has_model = settings
        .get("model")
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    if !has_model {
        if let Some(model) = model.map(str::trim).filter(|value| !value.is_empty()) {
            settings.insert("model".to_string(), Value::String(model.to_string()));
        }
    }

    let has_effort = settings
        .get("reasoning_effort")
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    if !has_effort {
        if let Some(effort) = effort.map(str::trim).filter(|value| !value.is_empty()) {
            settings.insert(
                "reasoning_effort".to_string(),
                Value::String(effort.to_string()),
            );
        }
    }

    root.insert("settings".to_string(), Value::Object(settings));
    Value::Object(root)
}

fn build_reasoning_config(effort: Option<&str>) -> Value {
    let normalized_effort = effort
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| Value::String(value.to_string()))
        .unwrap_or_else(|| Value::String("low".to_string()));
    json!({
        "effort": normalized_effort,
        // Codex responses currently accepts concise|detailed|none.
        // "auto" can be ignored by newer runtimes and suppress reasoning summaries.
        "summary": "concise"
    })
}

pub(crate) fn extract_error_message_from_response(value: &Value) -> Option<String> {
    value
        .get("error")
        .and_then(|error| {
            error
                .get("message")
                .and_then(Value::as_str)
                .or_else(|| error.as_str())
        })
        .or_else(|| {
            value
                .get("result")
                .and_then(|result| result.get("error"))
                .and_then(|error| {
                    error
                        .get("message")
                        .and_then(Value::as_str)
                        .or_else(|| error.as_str())
                })
        })
        .map(ToString::to_string)
}

pub(crate) async fn thread_compact_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    provider_profile_id: Option<String>,
    thread_id: String,
) -> Result<Value, String> {
    let normalized_thread_id = thread_id.trim().to_string();
    if normalized_thread_id.is_empty() {
        return Err("thread_id is required".to_string());
    }
    let session_key = session_key_for_provider(&workspace_id, provider_profile_id.as_deref());
    let session = get_session_clone(sessions, &session_key).await?;
    session
        .try_reserve_codex_manual_compaction(&normalized_thread_id)
        .await?;

    let mut attempts = Vec::new();
    for method in THREAD_COMPACTION_METHOD_CANDIDATES {
        let params = json!({ "threadId": normalized_thread_id });
        match session.send_request(method, params).await {
            Ok(response) => {
                if let Some(error) = extract_error_message_from_response(&response) {
                    attempts.push(format!("{method}: {error}"));
                    continue;
                }
                return Ok(json!({
                    "ok": true,
                    "method": method
                }));
            }
            Err(error) => {
                attempts.push(format!("{method}: {error}"));
            }
        }
    }

    session
        .release_codex_compaction_reservation(&normalized_thread_id)
        .await;
    Err(format!(
        "all compaction methods failed for thread {}: {}",
        normalized_thread_id,
        attempts.join(" | ")
    ))
}

fn is_collaboration_mode_capability_error(value: &Value) -> bool {
    let message = extract_error_message_from_response(value)
        .unwrap_or_default()
        .to_lowercase();
    message.contains("turn/start.collaborationmode")
        && message.contains("experimentalapi")
        && message.contains("capability")
}

fn is_method_not_found_response(value: &Value) -> bool {
    value
        .pointer("/error/code")
        .and_then(Value::as_i64)
        .is_some_and(|code| code == -32601)
        || value
            .pointer("/error/message")
            .and_then(Value::as_str)
            .is_some_and(|message| {
                let normalized = message.to_ascii_lowercase();
                normalized.contains("method not found")
                    || normalized.contains("unsupported server request")
            })
}

fn is_thread_not_found_error_message(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    normalized.contains("thread not found")
        || normalized.contains("thread_not_found")
        || normalized.contains("conversation not found")
        || normalized.contains("conversation_not_found")
}

fn is_thread_resume_rollout_pending_error_message(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    normalized.contains("no rollout found for thread id")
        || (normalized.contains("no rollout found") && normalized.contains("thread"))
}

fn is_thread_resume_not_ready_error_message(message: &str) -> bool {
    is_thread_not_found_error_message(message)
        || is_thread_resume_rollout_pending_error_message(message)
}

fn should_soft_ready_for_not_ready_reason(
    reason: &str,
    soft_ready_on_rollout_pending: bool,
) -> bool {
    soft_ready_on_rollout_pending && is_thread_resume_rollout_pending_error_message(reason)
}

fn is_thread_not_found_response(value: &Value) -> bool {
    extract_error_message_from_response(value)
        .as_deref()
        .is_some_and(is_thread_not_found_error_message)
}

fn validate_thread_resume_ready_response(value: &Value, thread_id: &str) -> Result<bool, String> {
    if let Some(error) = extract_error_message_from_response(value) {
        if is_thread_resume_not_ready_error_message(&error) {
            return Ok(false);
        }
        return Err(format!(
            "thread/resume failed during readiness check: {error}"
        ));
    }

    if let Some(resolved_thread_id) = extract_thread_id_from_response(value) {
        if resolved_thread_id != thread_id {
            return Err(format!(
                "thread/resume returned unexpected thread id {resolved_thread_id}; expected {thread_id}"
            ));
        }
    }

    Ok(true)
}

async fn wait_for_thread_resume_ready(
    session: &Arc<WorkspaceSession>,
    workspace_id: &str,
    thread_id: &str,
    timeout_duration: Duration,
    context: &str,
    soft_ready_on_rollout_pending: bool,
) -> Result<(), String> {
    let mut last_thread_not_ready_reason: Option<String> = None;
    for attempt_index in 0..=THREAD_RESUME_READY_RETRY_DELAYS_MS.len() {
        if attempt_index > 0 {
            if let Some(delay_ms) = THREAD_RESUME_READY_RETRY_DELAYS_MS.get(attempt_index - 1) {
                sleep(Duration::from_millis(*delay_ms)).await;
            }
        }
        let not_ready_reason = match session
            .send_request_with_timeout(
                "thread/resume",
                json!({ "threadId": thread_id }),
                timeout_duration,
            )
            .await
        {
            Ok(response) => match validate_thread_resume_ready_response(&response, thread_id) {
                Ok(true) => return Ok(()),
                Ok(false) => extract_error_message_from_response(&response)
                    .unwrap_or_else(|| "thread not found".to_string()),
                Err(error) => return Err(error),
            },
            Err(error) if is_thread_resume_not_ready_error_message(&error) => error,
            Err(error) => return Err(error),
        };
        if should_soft_ready_for_not_ready_reason(&not_ready_reason, soft_ready_on_rollout_pending)
        {
            log_thread_resume_rollout_pending_soft_ready(
                workspace_id,
                thread_id,
                context,
                &not_ready_reason,
            );
            return Ok(());
        }
        log::warn!(
            "[thread/resume][ready_retry] workspace_id={} thread_id={} context={} outcome=thread_not_ready attempt={} next_retry={} reason={}",
            workspace_id,
            thread_id,
            context,
            attempt_index + 1,
            attempt_index < THREAD_RESUME_READY_RETRY_DELAYS_MS.len(),
            not_ready_reason
        );
        last_thread_not_ready_reason = Some(not_ready_reason);
    }
    let last_reason =
        last_thread_not_ready_reason.unwrap_or_else(|| "thread not found".to_string());
    if is_thread_resume_rollout_pending_error_message(&last_reason) {
        log_thread_resume_rollout_pending_soft_ready(
            workspace_id,
            thread_id,
            context,
            &last_reason,
        );
        return Ok(());
    }
    Err(format!(
        "thread not ready after bounded resume retry: {}",
        last_reason
    ))
}

fn log_thread_resume_rollout_pending_soft_ready(
    workspace_id: &str,
    thread_id: &str,
    context: &str,
    reason: &str,
) {
    log::warn!(
        "[thread/resume][ready_retry] workspace_id={} thread_id={} context={} outcome=rollout_pending_soft_ready reason={}",
        workspace_id,
        thread_id,
        context,
        reason
    );
}

async fn retry_turn_start_after_thread_resume(
    session: &Arc<WorkspaceSession>,
    workspace_id: &str,
    thread_id: &str,
    params: &Map<String, Value>,
    timeout_duration: Duration,
    reason: &str,
) -> Result<Value, String> {
    log::warn!(
        "[turn/start][thread_resume_retry] workspace_id={} thread_id={} action=resume_before_retry reason={}",
        workspace_id,
        thread_id,
        reason
    );
    wait_for_thread_resume_ready(
        session,
        workspace_id,
        thread_id,
        timeout_duration,
        "turn-start",
        false,
    )
    .await?;
    for (attempt_index, delay_ms) in TURN_START_THREAD_NOT_FOUND_RETRY_DELAYS_MS
        .iter()
        .copied()
        .enumerate()
    {
        sleep(Duration::from_millis(delay_ms)).await;
        session
            .note_codex_turn_start_pending(thread_id, timeout_duration)
            .await;
        session
            .start_codex_turn_timing(thread_id, crate::backend::app_server::now_millis())
            .await;
        let retry_response = session
            .send_request_with_timeout(
                "turn/start",
                Value::Object(params.clone()),
                timeout_duration,
            )
            .await?;
        session
            .record_codex_turn_start_response(thread_id, crate::backend::app_server::now_millis())
            .await;
        if !is_thread_not_found_response(&retry_response) {
            return Ok(retry_response);
        }
        session
            .clear_codex_foreground_work(Some(thread_id), None)
            .await;
        log::warn!(
            "[turn/start][thread_resume_retry] workspace_id={} thread_id={} outcome=thread_not_ready attempt={} next_retry={}",
            workspace_id,
            thread_id,
            attempt_index + 1,
            attempt_index + 1 < TURN_START_THREAD_NOT_FOUND_RETRY_DELAYS_MS.len()
        );
    }
    Err("thread not found after bounded readiness retry".to_string())
}

const CODE_MODE_FALLBACK_DIRECTIVE: &str = "Execution policy (default mode): do not ask the user follow-up questions. If details are missing, make minimal reasonable assumptions, proceed autonomously, and report assumptions briefly.";
const PLAN_MODE_FALLBACK_DIRECTIVE: &str = "Execution policy (plan mode fallback): planning-only. Experimental ask-user-input APIs are not available in this session. If a blocker appears (missing path/context, ambiguous scope, permission gap, or prerequisite failure), ask a concise multiple-choice question in plain assistant text, stop, and WAIT for user input before continuing.";

fn inject_fallback_prompt_with_directive(input: &mut Vec<Value>, directive: &str) {
    if let Some(text_item) = input.iter_mut().find(|item| {
        item.get("type")
            .and_then(Value::as_str)
            .map(|kind| kind == "text")
            .unwrap_or(false)
    }) {
        let original_text = text_item
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim();
        let merged_text = if original_text.is_empty() {
            directive.to_string()
        } else {
            format!("{directive}\n\nUser request:\n{original_text}")
        };
        if let Some(obj) = text_item.as_object_mut() {
            obj.insert("text".to_string(), Value::String(merged_text));
        }
        return;
    }

    input.insert(
        0,
        json!({
            "type": "text",
            "text": directive,
        }),
    );
}

fn inject_code_mode_fallback_prompt(input: &mut Vec<Value>) {
    inject_fallback_prompt_with_directive(input, CODE_MODE_FALLBACK_DIRECTIVE);
}

fn inject_plan_mode_fallback_prompt(input: &mut Vec<Value>) {
    inject_fallback_prompt_with_directive(input, PLAN_MODE_FALLBACK_DIRECTIVE);
}

fn inject_mode_fallback_prompt(input: &mut Vec<Value>, effective_mode: &str) {
    if effective_mode == "code" {
        inject_code_mode_fallback_prompt(input);
    } else {
        inject_plan_mode_fallback_prompt(input);
    }
}

async fn get_session_clone(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    session_key: &str,
) -> Result<Arc<WorkspaceSession>, String> {
    let sessions = sessions.lock().await;
    sessions
        .get(session_key)
        .cloned()
        .ok_or_else(|| "workspace not connected".to_string())
}

pub(crate) fn session_key_for_provider(
    workspace_id: &str,
    provider_profile_id: Option<&str>,
) -> String {
    let provider_profile_id = provider_profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(CODEX_DISK_PROVIDER_PROFILE_ID);
    if provider_profile_id == CODEX_DISK_PROVIDER_PROFILE_ID {
        legacy_codex_runtime_key(workspace_id)
    } else {
        codex_runtime_key(workspace_id, provider_profile_id)
    }
}

pub(crate) fn normalize_provider_profile_id(provider_profile_id: Option<&str>) -> String {
    provider_profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(CODEX_DISK_PROVIDER_PROFILE_ID)
        .to_string()
}

async fn resolve_codex_home_for_workspace_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<PathBuf, String> {
    let (entry, parent_entry) = resolve_workspace_and_parent(workspaces, workspace_id).await?;
    resolve_workspace_codex_home(&entry, parent_entry.as_ref())
        .or_else(resolve_default_codex_home)
        .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())
}

pub(crate) async fn start_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    provider_profile_id: Option<String>,
    model: Option<String>,
) -> Result<Value, String> {
    let session_key = session_key_for_provider(&workspace_id, provider_profile_id.as_deref());
    let session = get_session_clone(sessions, &session_key).await?;
    let timeout_duration = session.default_request_timeout();
    let mut params = Map::new();
    params.insert("cwd".to_string(), json!(session.entry.path));
    params.insert("approvalPolicy".to_string(), json!("on-request"));
    if let Some(model) = model
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        params.insert("model".to_string(), json!(model));
    }
    session
        .note_codex_thread_create_pending(timeout_duration)
        .await;
    match session
        .send_request_with_timeout("thread/start", Value::Object(params), timeout_duration)
        .await
    {
        Ok(response) => {
            let response = match validate_thread_start_response(response) {
                Ok(response) => response,
                Err(error) => {
                    session.clear_codex_foreground_work(None, None).await;
                    return Err(error);
                }
            };
            if let Some(thread_id) = extract_thread_id_from_response(&response) {
                session
                    .note_codex_thread_started_pending(&thread_id, timeout_duration)
                    .await;
            } else {
                session.clear_codex_foreground_work(None, None).await;
            }
            Ok(response)
        }
        Err(error) => {
            session.clear_codex_foreground_work(None, None).await;
            Err(error)
        }
    }
}

pub(crate) async fn resume_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    provider_profile_id: Option<String>,
    thread_id: String,
) -> Result<Value, String> {
    let session_key = session_key_for_provider(&workspace_id, provider_profile_id.as_deref());
    let session = get_session_clone(sessions, &session_key).await?;
    let params = json!({ "threadId": thread_id.clone() });
    let response = session.send_request("thread/resume", params).await?;
    if let Some(resolved_thread_id) = extract_thread_id_from_response(&response) {
        if session
            .get_thread_effective_mode(&resolved_thread_id)
            .await
            .is_none()
        {
            if let Some(parent_thread_id) = extract_parent_thread_id_from_response(&response) {
                let _ = session
                    .inherit_thread_effective_mode(&parent_thread_id, &resolved_thread_id)
                    .await;
            } else if resolved_thread_id != thread_id {
                let _ = session
                    .inherit_thread_effective_mode(&thread_id, &resolved_thread_id)
                    .await;
            }
        }
    }
    Ok(response)
}

pub(crate) async fn confirm_thread_ready_after_start_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    provider_profile_id: Option<String>,
    thread_id: String,
) -> Result<(), String> {
    let session_key = session_key_for_provider(&workspace_id, provider_profile_id.as_deref());
    let session = get_session_clone(sessions, &session_key).await?;
    // A freshly started thread has no rollout file until the first turn is
    // sent, so "no rollout found" is its normal state: soft-ready immediately
    // instead of burning the full retry ladder (~5.8s) on every new session.
    wait_for_thread_resume_ready(
        &session,
        &workspace_id,
        &thread_id,
        Duration::from_millis(THREAD_START_READY_CONFIRM_TIMEOUT_MS),
        "thread-start",
        true,
    )
    .await
    .map_err(|error| {
        format!(
            "thread/start ready confirmation failed for workspace {workspace_id} thread {thread_id}: {error}"
        )
    })
}

pub(crate) async fn fork_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    provider_profile_id: Option<String>,
    thread_id: String,
    message_id: Option<String>,
) -> Result<Value, String> {
    let session_key = session_key_for_provider(&workspace_id, provider_profile_id.as_deref());
    let session = get_session_clone(sessions, &session_key).await?;
    let mut params = Map::new();
    params.insert("threadId".to_string(), json!(thread_id.clone()));
    if let Some(message_id) = message_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        params.insert("messageId".to_string(), json!(message_id));
    }
    let response = session
        .send_request("thread/fork", Value::Object(params))
        .await?;
    if let Some(child_thread_id) = extract_thread_id_from_response(&response) {
        if child_thread_id != thread_id {
            let _ = session
                .inherit_thread_effective_mode(&thread_id, &child_thread_id)
                .await;
        }
    }
    Ok(response)
}

pub(crate) async fn list_threads_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    provider_profile_id: Option<String>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    let session_key = session_key_for_provider(&workspace_id, provider_profile_id.as_deref());
    let session = get_session_clone(sessions, &session_key).await?;
    let params = json!({ "cursor": cursor, "limit": limit });
    session.send_request("thread/list", params).await
}

pub(crate) async fn list_mcp_server_status_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    provider_profile_id: Option<String>,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<Value, String> {
    let session_key = session_key_for_provider(&workspace_id, provider_profile_id.as_deref());
    let session = get_session_clone(sessions, &session_key).await?;
    let params = json!({ "cursor": cursor, "limit": limit });
    session.send_request("mcpServerStatus/list", params).await
}

pub(crate) async fn archive_thread_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    provider_profile_id: Option<String>,
    thread_id: String,
) -> Result<Value, String> {
    let session_key = session_key_for_provider(&workspace_id, provider_profile_id.as_deref());
    let session = get_session_clone(sessions, &session_key).await?;
    let params = json!({ "threadId": thread_id.clone() });
    let response = session.send_request("thread/archive", params).await?;
    session.clear_thread_effective_mode(&thread_id).await;
    Ok(response)
}

pub(crate) async fn archive_thread_best_effort_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    provider_profile_id: Option<String>,
    thread_id: String,
    timeout_duration: Duration,
) -> Result<Value, String> {
    let session_key = session_key_for_provider(&workspace_id, provider_profile_id.as_deref());
    let session = get_session_clone(sessions, &session_key).await?;
    let params = json!({ "threadId": thread_id.clone() });
    let response = session
        .send_request_with_timeout("thread/archive", params, timeout_duration)
        .await?;
    session.clear_thread_effective_mode(&thread_id).await;
    Ok(response)
}

fn attach_codex_dispatch_receipt(
    mut response: Value,
    provider_profile_id: Option<&str>,
    provider_runtime_key: &str,
    model: Option<&str>,
    reasoning_effort: Option<&str>,
) -> Value {
    if let Some(root) = response.as_object_mut() {
        root.insert(
            "dogeDispatchReceipt".to_string(),
            json!({
                "engine": "codex",
                "providerProfileId": provider_profile_id,
                "providerProfileSource": if provider_profile_id.is_some() { "managed" } else { "local" },
                "providerRuntimeKey": provider_runtime_key,
                "model": model,
                "reasoningEffort": reasoning_effort,
            }),
        );
    }
    response
}

pub(crate) async fn send_user_message_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    provider_profile_id: Option<String>,
    thread_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    collaboration_mode: Option<Value>,
    preferred_language: Option<String>,
    custom_spec_root: Option<String>,
    mode_enforcement_enabled: bool,
    extra_developer_instructions: Option<String>,
) -> Result<Value, String> {
    let session_key = session_key_for_provider(&workspace_id, provider_profile_id.as_deref());
    let session = get_session_clone(sessions, &session_key).await?;
    session.set_mode_enforcement_enabled(mode_enforcement_enabled);
    let normalized_language = normalize_preferred_language(preferred_language.as_deref());
    let normalized_custom_spec_root = normalize_custom_spec_root(custom_spec_root.as_deref());
    let access_mode = access_mode.unwrap_or_else(|| "current".to_string());
    let trimmed_text = text.trim();
    let mut input: Vec<Value> = Vec::new();
    if !trimmed_text.is_empty() {
        input.push(json!({ "type": "text", "text": trimmed_text }));
    }
    if let Some(paths) = images {
        for path in paths {
            let trimmed = path.trim();
            if trimmed.is_empty() {
                continue;
            }
            if trimmed.starts_with("data:")
                || trimmed.starts_with("http://")
                || trimmed.starts_with("https://")
            {
                input.push(json!({ "type": "image", "url": trimmed }));
            } else {
                input.push(json!({ "type": "localImage", "path": trimmed }));
            }
        }
    }
    if input.is_empty() {
        return Err("empty user message".to_string());
    }

    let persisted_mode = session.get_thread_effective_mode(&thread_id).await;
    let policy = resolve_policy(collaboration_mode.as_ref(), persisted_mode.as_deref());
    let (sandbox_policy, approval_policy, enforcement_reason) = resolve_execution_policy(
        access_mode.as_str(),
        &session.entry.path,
        normalized_custom_spec_root.as_deref(),
        &policy.effective_mode,
        mode_enforcement_enabled,
    );
    if let Some(rejection) =
        squad_mutation_policy_rejection(access_mode.as_str(), enforcement_reason)
    {
        return Err(rejection);
    }
    if let Some(reason) = enforcement_reason {
        log::info!(
            "[collaboration_mode_enforcement] decision=override_execution_policy workspace_id={} thread_id={} effective_mode={} requested_access_mode={} sandbox_policy=readOnly approval_policy=on-request reason={}",
            workspace_id,
            thread_id,
            policy.effective_mode,
            access_mode,
            reason
        );
    }
    let mut params = Map::new();
    params.insert("threadId".to_string(), json!(thread_id.clone()));
    params.insert("cwd".to_string(), json!(session.entry.path));
    params.insert("approvalPolicy".to_string(), json!(approval_policy));
    params.insert("sandboxPolicy".to_string(), json!(sandbox_policy));
    params.insert("model".to_string(), json!(model));
    params.insert("effort".to_string(), json!(effort));
    params.insert(
        "reasoning".to_string(),
        build_reasoning_config(effort.as_deref()),
    );
    // Keep wire mode aligned with runtime policy on every turn.
    // If some frontend path misses explicit collaborationMode once, the backend
    // still enforces and persists the effective mode for this thread.
    let can_send_collaboration_mode = session.collaboration_mode_supported();
    if !can_send_collaboration_mode {
        inject_mode_fallback_prompt(&mut input, &policy.effective_mode);
    }
    params.insert("input".to_string(), json!(input));
    if can_send_collaboration_mode {
        let enriched_collaboration_mode = if session.generated_developer_instructions_enabled {
            if let Some(extra_directive) = extra_developer_instructions.as_ref() {
                apply_policy_to_collaboration_mode_with_extra_directives(
                    collaboration_mode,
                    &policy,
                    std::slice::from_ref(extra_directive),
                )
            } else {
                apply_policy_to_collaboration_mode(collaboration_mode, &policy)
            }
        } else {
            apply_policy_to_collaboration_mode(collaboration_mode, &policy)
        };
        let enriched_collaboration_mode = ensure_collaboration_mode_defaults(
            enriched_collaboration_mode,
            model.as_deref(),
            effort.as_deref(),
        );
        params.insert("collaborationMode".to_string(), enriched_collaboration_mode);
    }
    session
        .set_thread_effective_mode(&thread_id, &policy.effective_mode)
        .await;
    log::debug!(
        "[turn/start][collaboration_mode] workspace_id={} thread_id={} selected_mode={} effective_mode={} policy_version={} fallback_reason={}",
        workspace_id,
        thread_id,
        policy
            .selected_mode
            .clone()
            .unwrap_or_else(|| "missing".to_string()),
        policy.effective_mode,
        policy.policy_version,
        policy
            .fallback_reason
            .clone()
            .unwrap_or_else(|| "none".to_string())
    );
    if let Some(language) = normalized_language {
        params.insert("preferredLanguage".to_string(), json!(language));
    }
    let timeout_duration = session.initial_turn_start_timeout();
    // Close the auto-compaction race before the first runtime side effect. If
    // compaction already owns this native thread, preserve the original prompt
    // and wait; otherwise this reservation prevents compaction from replacing it.
    session.reserve_codex_user_dispatch(&thread_id).await?;
    session
        .note_codex_turn_start_pending(&thread_id, timeout_duration)
        .await;
    let turn_start_request_started_at_ms = crate::backend::app_server::now_millis();
    session
        .start_codex_turn_timing(&thread_id, turn_start_request_started_at_ms)
        .await;
    let response = match session
        .send_request_with_timeout(
            "turn/start",
            Value::Object(params.clone()),
            timeout_duration,
        )
        .await
    {
        Ok(response) if is_thread_not_found_response(&response) => {
            session
                .record_codex_turn_start_response(
                    &thread_id,
                    crate::backend::app_server::now_millis(),
                )
                .await;
            session
                .clear_codex_foreground_work(Some(&thread_id), None)
                .await;
            let retry_reason = extract_error_message_from_response(&response)
                .unwrap_or_else(|| "thread not found".to_string());
            match retry_turn_start_after_thread_resume(
                &session,
                &workspace_id,
                &thread_id,
                &params,
                timeout_duration,
                &retry_reason,
            )
            .await
            {
                Ok(retry_response) => retry_response,
                Err(retry_error) => {
                    log::warn!(
                        "[turn/start][thread_resume_retry] workspace_id={} thread_id={} outcome=failed error={}",
                        workspace_id,
                        thread_id,
                        retry_error
                    );
                    response
                }
            }
        }
        Ok(response) => {
            session
                .record_codex_turn_start_response(
                    &thread_id,
                    crate::backend::app_server::now_millis(),
                )
                .await;
            response
        }
        Err(error) => {
            session
                .clear_codex_foreground_work(Some(&thread_id), None)
                .await;
            if is_thread_not_found_error_message(&error) {
                match retry_turn_start_after_thread_resume(
                    &session,
                    &workspace_id,
                    &thread_id,
                    &params,
                    timeout_duration,
                    &error,
                )
                .await
                {
                    Ok(retry_response) => {
                        if extract_error_message_from_response(&retry_response).is_some() {
                            session
                                .clear_codex_foreground_work(Some(&thread_id), None)
                                .await;
                            session
                                .release_codex_user_dispatch_reservation(&thread_id)
                                .await;
                        }
                        return Ok(attach_codex_dispatch_receipt(
                            retry_response,
                            provider_profile_id.as_deref(),
                            &session_key,
                            model.as_deref(),
                            effort.as_deref(),
                        ));
                    }
                    Err(retry_error) => {
                        log::warn!(
                            "[turn/start][thread_resume_retry] workspace_id={} thread_id={} outcome=failed error={}",
                            workspace_id,
                            thread_id,
                            retry_error
                        );
                        session
                            .clear_codex_foreground_work(Some(&thread_id), None)
                            .await;
                    }
                }
            }
            session
                .release_codex_user_dispatch_reservation(&thread_id)
                .await;
            return Err(if error == "request timed out" {
                build_first_packet_timeout_error(timeout_duration)
            } else {
                error
            });
        }
    };
    if response.get("error").is_some() {
        session
            .clear_codex_foreground_work(Some(&thread_id), None)
            .await;
    }
    if can_send_collaboration_mode && is_collaboration_mode_capability_error(&response) {
        log::warn!(
            "[turn/start][collaboration_mode] workspace_id={} thread_id={} capability=unsupported action=retry_without_collaboration_mode",
            workspace_id,
            thread_id
        );
        session.set_collaboration_mode_supported(false);
        params.remove("collaborationMode");
        if let Some(Value::Array(input_items)) = params.get_mut("input") {
            inject_mode_fallback_prompt(input_items, &policy.effective_mode);
        }
        session
            .start_codex_turn_timing(&thread_id, crate::backend::app_server::now_millis())
            .await;
        let fallback_response = match session
            .send_request("turn/start", Value::Object(params))
            .await
        {
            Ok(response) => response,
            Err(error) => {
                session
                    .release_codex_user_dispatch_reservation(&thread_id)
                    .await;
                return Err(error);
            }
        };
        session
            .record_codex_turn_start_response(&thread_id, crate::backend::app_server::now_millis())
            .await;
        if extract_error_message_from_response(&fallback_response).is_some() {
            session
                .clear_codex_foreground_work(Some(&thread_id), None)
                .await;
            session
                .release_codex_user_dispatch_reservation(&thread_id)
                .await;
        }
        return Ok(attach_codex_dispatch_receipt(
            fallback_response,
            provider_profile_id.as_deref(),
            &session_key,
            model.as_deref(),
            effort.as_deref(),
        ));
    }
    if extract_error_message_from_response(&response).is_some() {
        session
            .release_codex_user_dispatch_reservation(&thread_id)
            .await;
    }
    Ok(attach_codex_dispatch_receipt(
        response,
        provider_profile_id.as_deref(),
        &session_key,
        model.as_deref(),
        effort.as_deref(),
    ))
}

/// Change C：向已建立的 Codex thread 注入 Responses API history items。
///
/// `thread/inject_items` 不去重；调用方必须先用 durable pendingDelivery 保证同一
/// package 只调用一次。只有 JSON-RPC success 才返回 Ok，error response 显式拒绝。
pub(crate) async fn inject_thread_items_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: &str,
    provider_profile_id: Option<&str>,
    thread_id: &str,
    items: Vec<Value>,
) -> Result<Value, String> {
    if thread_id.trim().is_empty() {
        return Err("context import missing Codex thread identity".to_string());
    }
    if items.is_empty() {
        return Ok(json!({ "skipped": true, "reason": "empty-package" }));
    }
    let session_key = session_key_for_provider(workspace_id, provider_profile_id);
    let session = get_session_clone(sessions, &session_key).await?;
    let response = session
        .send_request(
            "thread/inject_items",
            json!({ "threadId": thread_id, "items": items }),
        )
        .await?;
    classify_context_import_response(response)
}

/// 无副作用探测 `thread/inject_items` 是否存在。
///
/// 使用必然无效的 thread id 与空 items；除 method-not-found 外的 JSON-RPC
/// response 都证明 method 已注册。调用发生在目标 Thread 创建之前。
pub(crate) async fn probe_thread_inject_items_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: &str,
    provider_profile_id: Option<&str>,
) -> Result<bool, String> {
    let session_key = session_key_for_provider(workspace_id, provider_profile_id);
    let session = get_session_clone(sessions, &session_key).await?;
    let response = session
        .send_request(
            "thread/inject_items",
            json!({
                "threadId": "doge-capability-probe-no-thread",
                "items": [],
            }),
        )
        .await?;
    Ok(!is_method_not_found_response(&response))
}

fn classify_context_import_response(response: Value) -> Result<Value, String> {
    if let Some(error) = response.get("error").filter(|value| !value.is_null()) {
        return Err(format!("context-import-rejected: {error}"));
    }
    Ok(response.get("result").cloned().unwrap_or(response))
}

#[cfg(test)]
mod tests {
    use super::{
        attach_codex_dispatch_receipt, build_reasoning_config, build_writable_roots,
        ensure_collaboration_mode_defaults, extract_parent_thread_id_from_response,
        extract_thread_id_from_response, inject_code_mode_fallback_prompt,
        inject_plan_mode_fallback_prompt, is_collaboration_mode_capability_error,
        is_method_not_found_response, is_thread_not_found_error_message,
        is_thread_not_found_response, is_thread_resume_rollout_pending_error_message,
        normalize_custom_spec_root, normalize_preferred_language, resolve_execution_policy,
        should_soft_ready_for_not_ready_reason, squad_mutation_policy_rejection,
        validate_thread_resume_ready_response, validate_thread_start_response,
        INVALID_THREAD_START_RESPONSE_ERROR_PREFIX,
    };
    use serde_json::{json, Value};

    #[test]
    fn codex_dispatch_receipt_records_the_provider_scoped_request() {
        let response = attach_codex_dispatch_receipt(
            json!({ "result": { "turn": { "id": "turn-1" } } }),
            Some("provider-kimi"),
            "workspace::provider-kimi",
            Some("kimi-for-coding"),
            Some("high"),
        );

        assert_eq!(response["dogeDispatchReceipt"]["engine"], "codex");
        assert_eq!(
            response["dogeDispatchReceipt"]["providerProfileId"],
            "provider-kimi"
        );
        assert_eq!(
            response["dogeDispatchReceipt"]["providerRuntimeKey"],
            "workspace::provider-kimi"
        );
        assert_eq!(
            response["dogeDispatchReceipt"]["providerProfileSource"],
            "managed"
        );
        assert_eq!(response["dogeDispatchReceipt"]["model"], "kimi-for-coding");
        assert_eq!(response["dogeDispatchReceipt"]["reasoningEffort"], "high");
    }

    #[test]
    fn codex_dispatch_receipt_records_local_runtime_identity() {
        let response = attach_codex_dispatch_receipt(
            json!({ "result": { "turn": { "id": "turn-local" } } }),
            None,
            "workspace-local",
            Some("gpt-5.3-codex-spark"),
            None,
        );

        assert!(response["dogeDispatchReceipt"]["providerProfileId"].is_null());
        assert_eq!(
            response["dogeDispatchReceipt"]["providerProfileSource"],
            "local"
        );
        assert_eq!(
            response["dogeDispatchReceipt"]["providerRuntimeKey"],
            "workspace-local"
        );
        assert_eq!(
            response["dogeDispatchReceipt"]["model"],
            "gpt-5.3-codex-spark"
        );
        assert!(response["dogeDispatchReceipt"]["reasoningEffort"].is_null());
    }

    #[test]
    fn context_import_requires_jsonrpc_success() {
        assert_eq!(
            super::classify_context_import_response(json!({"result": {}})).expect("success"),
            json!({})
        );
        assert!(super::classify_context_import_response(json!({
            "error": {"code": -32601, "message": "unsupported"}
        }))
        .expect_err("explicit rejection")
        .contains("context-import-rejected"));
    }

    #[test]
    fn import_method_probe_only_rejects_method_not_found() {
        assert!(is_method_not_found_response(&json!({
            "error": {"code": -32601, "message": "Method not found"}
        })));
        assert!(is_method_not_found_response(&json!({
            "error": {"message": "Unsupported server request: thread/inject_items"}
        })));
        assert!(!is_method_not_found_response(&json!({
            "error": {"code": -32602, "message": "invalid thread id"}
        })));
    }

    #[test]
    fn normalize_preferred_language_maps_supported_values() {
        assert_eq!(normalize_preferred_language(Some("zh")), Some("zh"));
        assert_eq!(normalize_preferred_language(Some("ZH-CN")), Some("zh"));
        assert_eq!(normalize_preferred_language(Some("english")), Some("en"));
        assert_eq!(normalize_preferred_language(Some("en-US")), Some("en"));
    }

    #[test]
    fn normalize_preferred_language_rejects_unknown_values() {
        assert_eq!(normalize_preferred_language(Some("ja")), None);
        assert_eq!(normalize_preferred_language(Some("")), None);
        assert_eq!(normalize_preferred_language(None), None);
    }

    #[test]
    fn thread_not_found_classifier_matches_rpc_error_shapes() {
        assert!(is_thread_not_found_error_message(
            "thread not found: 019eaae1-51d8"
        ));
        assert!(is_thread_not_found_error_message(
            "THREAD_NOT_FOUND: 019eaae1-51d8"
        ));
        assert!(is_thread_not_found_error_message(
            "conversation not found: 019eaae1-51d8"
        ));
        assert!(is_thread_not_found_error_message(
            "CONVERSATION_NOT_FOUND: 019eaae1-51d8"
        ));
        assert!(is_thread_not_found_response(&json!({
            "error": { "message": "thread not found: 019eaae1-51d8" }
        })));
        assert!(is_thread_not_found_response(&json!({
            "error": { "message": "conversation not found: 019eaae1-51d8" }
        })));
        assert!(is_thread_not_found_response(&json!({
            "result": {
                "error": { "message": "thread_not_found: 019eaae1-51d8" }
            }
        })));
    }

    #[test]
    fn thread_not_found_classifier_rejects_unrelated_errors() {
        assert!(!is_thread_not_found_error_message(
            "workspace not connected"
        ));
        assert!(!is_thread_not_found_response(&json!({
            "error": { "message": "model not found" }
        })));
    }

    #[test]
    fn rollout_pending_soft_ready_short_circuits_only_when_enabled() {
        // thread-start confirmation: a brand-new thread has no rollout file
        // until the first turn, so rollout-pending must soft-ready immediately.
        assert!(should_soft_ready_for_not_ready_reason(
            "no rollout found for thread id thread-1",
            true
        ));
        // turn-start retry path keeps the bounded retry ladder.
        assert!(!should_soft_ready_for_not_ready_reason(
            "no rollout found for thread id thread-1",
            false
        ));
        // A genuinely unknown thread must never soft-ready early.
        assert!(!should_soft_ready_for_not_ready_reason(
            "thread not found: thread-1",
            true
        ));
    }

    #[test]
    fn thread_resume_ready_response_rejects_rpc_errors_and_wrong_thread() {
        assert_eq!(
            validate_thread_resume_ready_response(
                &json!({ "error": { "message": "thread not found: thread-1" } }),
                "thread-1"
            )
            .unwrap(),
            false
        );
        assert_eq!(
            validate_thread_resume_ready_response(
                &json!({ "error": { "message": "no rollout found for thread id thread-1" } }),
                "thread-1"
            )
            .unwrap(),
            false
        );
        assert!(is_thread_resume_rollout_pending_error_message(
            "no rollout found for thread id thread-1"
        ));
        assert!(validate_thread_resume_ready_response(
            &json!({ "error": { "message": "permission denied" } }),
            "thread-1"
        )
        .unwrap_err()
        .contains("thread/resume failed during readiness check"));
        assert!(validate_thread_resume_ready_response(
            &json!({ "result": { "threadId": "thread-2" } }),
            "thread-1"
        )
        .unwrap_err()
        .contains("unexpected thread id"));
        assert!(validate_thread_resume_ready_response(
            &json!({ "result": { "threadId": "thread-1" } }),
            "thread-1"
        )
        .unwrap());
        assert!(validate_thread_resume_ready_response(
            &json!({ "result": { "ok": true } }),
            "thread-1"
        )
        .unwrap());
    }

    #[test]
    fn normalize_custom_spec_root_accepts_absolute_path() {
        assert_eq!(
            normalize_custom_spec_root(Some("/tmp/external-openspec")),
            Some("/tmp/external-openspec".to_string())
        );
    }

    #[test]
    fn normalize_custom_spec_root_rejects_invalid_paths() {
        assert_eq!(normalize_custom_spec_root(Some("openspec")), None);
        assert_eq!(normalize_custom_spec_root(Some("   ")), None);
        assert_eq!(normalize_custom_spec_root(None), None);
    }

    #[test]
    fn build_writable_roots_prioritizes_custom_spec_root() {
        let roots = build_writable_roots("/workspace/repo", Some("/external/openspec"));
        assert_eq!(
            roots,
            vec![
                "/external/openspec".to_string(),
                "/workspace/repo".to_string(),
            ]
        );
    }

    #[test]
    fn build_writable_roots_keeps_workspace_when_custom_missing() {
        let roots = build_writable_roots("/workspace/repo", None);
        assert_eq!(roots, vec!["/workspace/repo".to_string()]);
    }

    #[test]
    fn resolve_execution_policy_keeps_default_code_path() {
        let (sandbox, approval, reason) =
            resolve_execution_policy("full-access", "/workspace/repo", None, "code", true);
        assert_eq!(sandbox, json!({ "type": "dangerFullAccess" }));
        assert_eq!(approval, "never");
        assert_eq!(reason, None);
    }

    #[test]
    fn resolve_execution_policy_enforces_plan_readonly_when_enabled() {
        let (sandbox, approval, reason) = resolve_execution_policy(
            "full-access",
            "/workspace/repo",
            Some("/external/openspec"),
            "plan",
            true,
        );
        assert_eq!(sandbox, json!({ "type": "readOnly" }));
        assert_eq!(approval, "on-request");
        assert_eq!(reason, Some("plan_readonly_violation"));
    }

    #[test]
    fn resolve_execution_policy_does_not_override_when_enforcement_disabled() {
        let (sandbox, approval, reason) = resolve_execution_policy(
            "current",
            "/workspace/repo",
            Some("/external/openspec"),
            "plan",
            false,
        );
        assert_eq!(
            sandbox,
            json!({
                "type": "workspaceWrite",
                "writableRoots": ["/external/openspec", "/workspace/repo"],
                "networkAccess": true
            })
        );
        assert_eq!(approval, "on-request");
        assert_eq!(reason, None);
    }

    #[test]
    fn squad_mutation_rejects_plan_enforcement_downgrade() {
        let rejection = squad_mutation_policy_rejection(
            "squad-current-workspace",
            Some("plan_readonly_violation"),
        )
        .expect("must fail closed");
        assert!(rejection.contains("squad-mutate-authority-denied"));

        assert_eq!(
            squad_mutation_policy_rejection("squad-current-workspace", None),
            None
        );
        assert_eq!(
            squad_mutation_policy_rejection("read-only", Some("plan_readonly_violation")),
            None
        );
        assert_eq!(
            squad_mutation_policy_rejection("full-access", Some("plan_readonly_violation")),
            None
        );
    }

    #[test]
    fn extract_thread_id_from_response_supports_common_shapes() {
        assert_eq!(
            extract_thread_id_from_response(&json!({ "result": { "threadId": "thread-1" } })),
            Some("thread-1".to_string())
        );
        assert_eq!(
            extract_thread_id_from_response(&json!({ "result": { "thread_id": "thread-1b" } })),
            Some("thread-1b".to_string())
        );
        assert_eq!(
            extract_thread_id_from_response(
                &json!({ "result": { "thread": { "id": "thread-2" } } })
            ),
            Some("thread-2".to_string())
        );
        assert_eq!(
            extract_thread_id_from_response(&json!({ "thread_id": "thread-3" })),
            Some("thread-3".to_string())
        );
        assert_eq!(
            extract_thread_id_from_response(&json!({ "result": { "threadId": "   " } })),
            None
        );
        assert_eq!(extract_thread_id_from_response(&json!({})), None);
    }

    #[test]
    fn validate_thread_start_response_classifies_missing_thread_id() {
        let error = validate_thread_start_response(json!({ "result": { "ok": true } }))
            .expect_err("missing thread id should be invalid");

        assert!(error.starts_with(INVALID_THREAD_START_RESPONSE_ERROR_PREFIX));
        assert!(error.contains("result_keys"));
    }

    #[test]
    fn extract_parent_thread_id_from_response_reads_parent_fields() {
        assert_eq!(
            extract_parent_thread_id_from_response(
                &json!({ "result": { "parentThreadId": "thread-parent" } })
            ),
            Some("thread-parent".to_string())
        );
        assert_eq!(
            extract_parent_thread_id_from_response(
                &json!({ "result": { "thread": { "parentId": "thread-parent-2" } } })
            ),
            Some("thread-parent-2".to_string())
        );
        assert_eq!(extract_parent_thread_id_from_response(&json!({})), None);
    }

    #[test]
    fn ensure_collaboration_mode_defaults_populates_model_and_effort_when_missing() {
        let payload = json!({
            "mode": "plan",
            "settings": {}
        });
        let enriched = ensure_collaboration_mode_defaults(payload, Some("gpt-5"), Some("high"));
        assert_eq!(enriched["settings"]["model"], "gpt-5");
        assert_eq!(enriched["settings"]["reasoning_effort"], "high");
    }

    #[test]
    fn ensure_collaboration_mode_defaults_keeps_existing_values() {
        let payload = json!({
            "mode": "code",
            "settings": {
                "model": "existing-model",
                "reasoning_effort": "medium"
            }
        });
        let enriched =
            ensure_collaboration_mode_defaults(payload, Some("fallback-model"), Some("low"));
        assert_eq!(enriched["settings"]["model"], "existing-model");
        assert_eq!(enriched["settings"]["reasoning_effort"], "medium");
    }

    #[test]
    fn build_reasoning_config_requests_auto_summary_and_effort() {
        let config = build_reasoning_config(Some("high"));
        assert_eq!(config["summary"], "concise");
        assert_eq!(config["effort"], "high");
    }

    #[test]
    fn build_reasoning_config_keeps_auto_summary_without_effort() {
        let config = build_reasoning_config(None);
        assert_eq!(config["summary"], "concise");
        assert_eq!(config["effort"], "low");
    }

    #[test]
    fn collaboration_mode_capability_error_is_detected() {
        let response = json!({
            "error": {
                "message": "turn/start.collaborationMode requires experimentalApi capability"
            }
        });
        assert!(is_collaboration_mode_capability_error(&response));
    }

    #[test]
    fn collaboration_mode_capability_error_ignores_unrelated_errors() {
        let response = json!({
            "error": {
                "message": "turn/start.model is required"
            }
        });
        assert!(!is_collaboration_mode_capability_error(&response));
    }

    #[test]
    fn inject_code_mode_fallback_prompt_prefixes_existing_text() {
        let mut input = vec![json!({
            "type": "text",
            "text": "Implement the feature end-to-end."
        })];
        inject_code_mode_fallback_prompt(&mut input);
        let text = input[0]
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default();
        assert!(text.contains("Execution policy (default mode):"));
        assert!(text.contains("User request:\nImplement the feature end-to-end."));
    }

    #[test]
    fn inject_code_mode_fallback_prompt_adds_text_for_image_only_input() {
        let mut input = vec![json!({
            "type": "localImage",
            "path": "/tmp/demo.png"
        })];
        inject_code_mode_fallback_prompt(&mut input);
        assert_eq!(input.len(), 2);
        assert_eq!(input[0]["type"], "text");
    }

    #[test]
    fn inject_plan_mode_fallback_prompt_prefixes_existing_text() {
        let mut input = vec![json!({
            "type": "text",
            "text": "先扫目录并确认改动范围。"
        })];
        inject_plan_mode_fallback_prompt(&mut input);
        let text = input[0]
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default();
        assert!(text.contains("Execution policy (plan mode fallback):"));
        assert!(text.contains("ask a concise multiple-choice question in plain assistant text"));
        assert!(text.contains("User request:\n先扫目录并确认改动范围。"));
    }

    #[test]
    fn inject_plan_mode_fallback_prompt_adds_text_for_image_only_input() {
        let mut input = vec![json!({
            "type": "localImage",
            "path": "/tmp/demo.png"
        })];
        inject_plan_mode_fallback_prompt(&mut input);
        assert_eq!(input.len(), 2);
        assert_eq!(input[0]["type"], "text");
    }
}

pub(crate) async fn collaboration_mode_list_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &legacy_codex_runtime_key(&workspace_id)).await?;
    session
        .send_request("collaborationMode/list", json!({}))
        .await
}

pub(crate) async fn turn_interrupt_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    provider_profile_id: Option<String>,
    thread_id: String,
    turn_id: String,
) -> Result<Value, String> {
    let session_key = session_key_for_provider(&workspace_id, provider_profile_id.as_deref());
    let session = get_session_clone(sessions, &session_key).await?;
    let params = json!({ "threadId": thread_id, "turnId": turn_id });
    session.send_request("turn/interrupt", params).await
}

pub(crate) async fn start_review_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    provider_profile_id: Option<String>,
    thread_id: String,
    target: Value,
    delivery: Option<String>,
) -> Result<Value, String> {
    let session_key = session_key_for_provider(&workspace_id, provider_profile_id.as_deref());
    let session = get_session_clone(sessions, &session_key).await?;
    let mut params = Map::new();
    params.insert("threadId".to_string(), json!(thread_id));
    params.insert("target".to_string(), target);
    if let Some(delivery) = delivery {
        params.insert("delivery".to_string(), json!(delivery));
    }
    session
        .send_request("review/start", Value::Object(params))
        .await
}

pub(crate) async fn model_list_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
) -> Result<Value, String> {
    model_list_for_provider_core(sessions, workspace_id, None).await
}

pub(crate) async fn model_list_for_provider_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    provider_profile_id: Option<String>,
) -> Result<Value, String> {
    let session_key = session_key_for_provider(&workspace_id, provider_profile_id.as_deref());
    let session = get_session_clone(sessions, &session_key).await?;
    session.send_request("model/list", json!({})).await
}

pub(crate) async fn account_rate_limits_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &legacy_codex_runtime_key(&workspace_id)).await?;
    session
        .send_request("account/rateLimits/read", Value::Null)
        .await
}

pub(crate) async fn account_read_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
) -> Result<Value, String> {
    let session = {
        let sessions = sessions.lock().await;
        sessions
            .get(&legacy_codex_runtime_key(&workspace_id))
            .cloned()
    };
    let response = if let Some(session) = session {
        session.send_request("account/read", Value::Null).await.ok()
    } else {
        None
    };

    let (entry, parent_entry) = resolve_workspace_and_parent(workspaces, &workspace_id).await?;
    let codex_home = resolve_workspace_codex_home(&entry, parent_entry.as_ref())
        .or_else(resolve_default_codex_home);
    let fallback = read_auth_account(codex_home);

    Ok(build_account_response(response, fallback))
}

pub(crate) async fn codex_login_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    app_settings: &Mutex<AppSettings>,
    codex_login_cancels: &Mutex<HashMap<String, oneshot::Sender<()>>>,
    workspace_id: String,
) -> Result<Value, String> {
    let (entry, parent_entry, settings) =
        resolve_workspace_parent_and_settings(workspaces, app_settings, &workspace_id).await?;

    let codex_bin = entry
        .codex_bin
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or(settings.codex_bin.clone());
    let codex_args = resolve_workspace_codex_args(&entry, parent_entry.as_ref(), Some(&settings));
    let codex_home = resolve_workspace_codex_home(&entry, parent_entry.as_ref())
        .or_else(resolve_default_codex_home);

    let mut command = build_codex_command_with_bin(codex_bin);
    if let Some(ref codex_home) = codex_home {
        command.env("CODEX_HOME", codex_home);
    }
    apply_codex_args(&mut command, codex_args.as_deref())?;
    command.arg("login");
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    {
        let mut cancels = codex_login_cancels.lock().await;
        if let Some(existing) = cancels.remove(&workspace_id) {
            let _ = existing.send(());
        }
        cancels.insert(workspace_id.clone(), cancel_tx);
    }
    let pid = child.id();
    let canceled = Arc::new(AtomicBool::new(false));
    let canceled_for_task = Arc::clone(&canceled);
    let cancel_task = tokio::spawn(async move {
        if cancel_rx.await.is_ok() {
            canceled_for_task.store(true, Ordering::Relaxed);
            if let Some(pid) = pid {
                #[cfg(not(target_os = "windows"))]
                unsafe {
                    libc::kill(pid as i32, libc::SIGKILL);
                }
                #[cfg(target_os = "windows")]
                {
                    let _ = crate::utils::async_command("taskkill")
                        .args(["/PID", &pid.to_string(), "/T", "/F"])
                        .status()
                        .await;
                }
            }
        }
    });
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    let stdout_task = tokio::spawn(async move {
        let mut buffer = Vec::new();
        if let Some(mut stdout) = stdout_pipe {
            let _ = stdout.read_to_end(&mut buffer).await;
        }
        buffer
    });
    let stderr_task = tokio::spawn(async move {
        let mut buffer = Vec::new();
        if let Some(mut stderr) = stderr_pipe {
            let _ = stderr.read_to_end(&mut buffer).await;
        }
        buffer
    });

    let status = match timeout(Duration::from_secs(120), child.wait()).await {
        Ok(result) => result.map_err(|error| error.to_string())?,
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            cancel_task.abort();
            {
                let mut cancels = codex_login_cancels.lock().await;
                cancels.remove(&workspace_id);
            }
            return Err("Codex login timed out.".to_string());
        }
    };

    cancel_task.abort();
    {
        let mut cancels = codex_login_cancels.lock().await;
        cancels.remove(&workspace_id);
    }

    if canceled.load(Ordering::Relaxed) {
        return Err("Codex login canceled.".to_string());
    }

    let stdout_bytes = match stdout_task.await {
        Ok(bytes) => bytes,
        Err(_) => Vec::new(),
    };
    let stderr_bytes = match stderr_task.await {
        Ok(bytes) => bytes,
        Err(_) => Vec::new(),
    };

    let stdout = String::from_utf8_lossy(&stdout_bytes);
    let stderr = String::from_utf8_lossy(&stderr_bytes);
    let detail = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    let combined = if stdout.trim().is_empty() {
        stderr.trim().to_string()
    } else if stderr.trim().is_empty() {
        stdout.trim().to_string()
    } else {
        format!("{}\n{}", stdout.trim(), stderr.trim())
    };
    let limited = combined.chars().take(4000).collect::<String>();

    if !status.success() {
        return Err(if detail.is_empty() {
            "Codex login failed.".to_string()
        } else {
            format!("Codex login failed: {detail}")
        });
    }

    Ok(json!({ "output": limited }))
}

pub(crate) async fn codex_login_cancel_core(
    codex_login_cancels: &Mutex<HashMap<String, oneshot::Sender<()>>>,
    workspace_id: String,
) -> Result<Value, String> {
    let cancel_tx = {
        let mut cancels = codex_login_cancels.lock().await;
        cancels.remove(&workspace_id)
    };
    let canceled = if let Some(tx) = cancel_tx {
        let _ = tx.send(());
        true
    } else {
        false
    };
    Ok(json!({ "canceled": canceled }))
}

pub(crate) async fn skills_list_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    custom_skill_roots: Vec<String>,
) -> Result<Value, String> {
    let session = get_session_clone(sessions, &workspace_id).await?;
    let params = json!({
        "cwd": session.entry.path,
        "forceReload": true,
        "customSkillRoots": custom_skill_roots,
    });
    session.send_request("skills/list", params).await
}

pub(crate) async fn respond_to_server_request_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    workspace_id: String,
    provider_profile_id: Option<String>,
    request_id: Value,
    result: Value,
) -> Result<(), String> {
    let session_key = session_key_for_provider(&workspace_id, provider_profile_id.as_deref());
    respond_to_server_request_for_runtime_core(sessions, session_key, request_id, result).await
}

pub(crate) async fn respond_to_server_request_for_runtime_core(
    sessions: &Mutex<HashMap<String, Arc<WorkspaceSession>>>,
    provider_runtime_key: String,
    request_id: Value,
    result: Value,
) -> Result<(), String> {
    let session = get_session_clone(sessions, provider_runtime_key.trim()).await?;
    if let Some(local_request_id) = request_id.as_str() {
        if session
            .consume_local_user_input_request(local_request_id)
            .await
        {
            return Ok(());
        }
    }
    session.send_response(request_id, result).await
}

pub(crate) async fn remember_approval_rule_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
    command: Vec<String>,
) -> Result<Value, String> {
    let command = command
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();
    if command.is_empty() {
        return Err("empty command".to_string());
    }

    let codex_home = resolve_codex_home_for_workspace_core(workspaces, &workspace_id).await?;
    let rules_path = rules::default_rules_path(&codex_home);
    rules::append_prefix_rule(&rules_path, &command)?;

    Ok(json!({
        "ok": true,
        "rulesPath": rules_path,
    }))
}

pub(crate) async fn get_config_model_core(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
) -> Result<Value, String> {
    let codex_home = resolve_codex_home_for_workspace_core(workspaces, &workspace_id).await?;
    let model = codex_config::read_config_model(Some(codex_home))?;
    Ok(json!({ "model": model }))
}
