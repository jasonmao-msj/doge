use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::time::timeout;

use crate::backend::app_server::WorkspaceSession;
use crate::backend::events::AppServerEvent;
use crate::engine::codex_adapter::params_to_codex_input;
use crate::engine::error_mapper::extract_error_message;
use crate::engine::SendMessageParams;
use crate::session_management::{self, AutoSessionMetadata};
use crate::shared::codex_core;
use crate::state::AppState;

pub(crate) fn normalize_custom_spec_root(custom_spec_root: Option<&str>) -> Option<String> {
    let trimmed = custom_spec_root?.trim();
    if trimmed.is_empty() {
        return None;
    }
    if !Path::new(trimmed).is_absolute() {
        return None;
    }
    Some(trimmed.to_string())
}

struct BackgroundCallbackGuard {
    session: std::sync::Arc<WorkspaceSession>,
    thread_id: String,
    active: bool,
}

impl BackgroundCallbackGuard {
    fn new(session: std::sync::Arc<WorkspaceSession>, thread_id: String) -> Self {
        Self {
            session,
            thread_id,
            active: true,
        }
    }

    async fn cleanup(&mut self) {
        if !self.active {
            return;
        }
        self.active = false;
        let mut callbacks = self.session.background_thread_callbacks.lock().await;
        callbacks.remove(&self.thread_id);
    }
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(text) = value.get(*key).and_then(|candidate| candidate.as_str()) {
            return Some(text.to_string());
        }
    }
    None
}

fn text_from_content_value(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string()).filter(|candidate| !candidate.trim().is_empty());
    }

    if let Some(items) = value.as_array() {
        let text = items
            .iter()
            .filter_map(text_from_content_value)
            .collect::<Vec<_>>()
            .join("");
        return Some(text).filter(|candidate| !candidate.trim().is_empty());
    }

    let item = value.as_object()?;
    string_field(
        value,
        &[
            "delta",
            "text",
            "output_text",
            "outputText",
            "content",
            "summary",
        ],
    )
    .or_else(|| item.get("content").and_then(text_from_content_value))
    .or_else(|| item.get("parts").and_then(text_from_content_value))
    .or_else(|| item.get("output").and_then(text_from_content_value))
    .filter(|candidate| !candidate.trim().is_empty())
}

fn collect_agent_message_texts(value: &Value, output: &mut Vec<String>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_agent_message_texts(item, output);
            }
        }
        Value::Object(item) => {
            if is_agent_message_item(value) {
                if let Some(text) = text_from_content_value(value) {
                    output.push(text);
                }
                return;
            }

            for key in [
                "item", "message", "turn", "result", "output", "items", "messages",
            ] {
                if let Some(next) = item.get(key) {
                    collect_agent_message_texts(next, output);
                }
            }
        }
        _ => {}
    }
}

fn extract_agent_message_collection_text(value: &Value) -> Option<String> {
    let mut chunks = Vec::new();
    collect_agent_message_texts(value, &mut chunks);
    let text = chunks
        .into_iter()
        .map(|chunk| chunk.trim().to_string())
        .filter(|chunk| !chunk.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    Some(text).filter(|candidate| !candidate.trim().is_empty())
}

pub(crate) fn extract_codex_text_delta(event: &Value) -> Option<String> {
    let method = event.get("method").and_then(|value| value.as_str())?;
    let is_agent_delta = matches!(
        method,
        "item/agentMessage/delta"
            | "item/agentMessage/textDelta"
            | "item/agentMessage/text/delta"
            | "text:delta"
            | "text/delta"
    );
    if !is_agent_delta {
        return None;
    }

    let params = event.get("params")?;
    string_field(
        params,
        &["delta", "text", "output_text", "outputText", "content"],
    )
    .or_else(|| params.get("part").and_then(text_from_content_value))
    .or_else(|| params.get("item").and_then(text_from_content_value))
    .or_else(|| params.get("message").and_then(text_from_content_value))
    .or_else(|| params.get("content").and_then(text_from_content_value))
}

pub(crate) fn extract_codex_reasoning_delta(event: &Value) -> Option<String> {
    let method = event.get("method").and_then(Value::as_str)?;
    if !matches!(
        method,
        "item/reasoning/textDelta"
            | "item/reasoning/delta"
            | "item/reasoning/summaryTextDelta"
            | "response.reasoning_text.delta"
            | "response.reasoning_summary_text.delta"
            | "response.reasoning_summary.delta"
    ) {
        return None;
    }
    let params = event.get("params")?;
    string_field(params, &["delta", "text", "summary", "content"])
        .or_else(|| params.get("part").and_then(text_from_content_value))
        .or_else(|| params.get("item").and_then(text_from_content_value))
}

fn is_agent_message_item(item: &Value) -> bool {
    let item_type = item
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(
        item_type.as_str(),
        "agentmessage" | "agent_message" | "assistantmessage" | "assistant_message"
    ) {
        return true;
    }

    let role = item
        .get("role")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    role == "assistant" && (item_type.is_empty() || item_type == "message")
}

pub(crate) fn extract_agent_message_snapshot_text(event: &Value) -> Option<String> {
    let method = event.get("method").and_then(|value| value.as_str())?;
    if !matches!(method, "item/updated" | "item/completed") {
        return None;
    }

    let item = event.get("params").and_then(|params| params.get("item"))?;
    if !is_agent_message_item(item) {
        return None;
    }
    text_from_content_value(item)
}

pub(crate) fn extract_turn_completed_text(event: &Value) -> Option<String> {
    let method = event.get("method").and_then(|value| value.as_str())?;
    if method != "turn/completed" {
        return None;
    }

    let params = event.get("params")?;
    string_field(
        params,
        &["text", "summary", "output_text", "outputText", "content"],
    )
    .or_else(|| extract_agent_message_collection_text(params))
    .or_else(|| params.get("result").and_then(text_from_content_value))
    .or_else(|| {
        params
            .get("turn")
            .and_then(extract_agent_message_collection_text)
    })
    .or_else(|| {
        params
            .get("result")
            .and_then(extract_agent_message_collection_text)
    })
    .or_else(|| {
        params
            .get("items")
            .and_then(extract_agent_message_collection_text)
    })
    .or_else(|| params.get("output").and_then(text_from_content_value))
    .or_else(|| params.get("content").and_then(text_from_content_value))
    .filter(|text| !text.trim().is_empty())
}

pub(crate) struct CodexPromptSyncResult {
    pub(crate) text: String,
    pub(crate) session_id: String,
}

pub(crate) async fn run_codex_prompt_sync(
    workspace_id: &str,
    text: &str,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    custom_spec_root: Option<String>,
    auto_session: Option<AutoSessionMetadata>,
    session_id: Option<String>,
    continue_session: bool,
    preserve_session: bool,
    provider_profile_id: Option<String>,
    app: &AppHandle,
    state: &AppState,
) -> Result<CodexPromptSyncResult, String> {
    let provider_profile_id =
        codex_core::normalize_provider_profile_id(provider_profile_id.as_deref());
    crate::codex::ensure_codex_session_for_provider(workspace_id, &provider_profile_id, state, app)
        .await?;

    let session = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&codex_core::session_key_for_provider(
                workspace_id,
                Some(&provider_profile_id),
            ))
            .ok_or("workspace not connected")?
            .clone()
    };

    let thread_result = if continue_session {
        let session_id = session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "sessionId is required to continue Codex sync session".to_string())?;
        session
            .send_request("thread/resume", json!({ "threadId": session_id }))
            .await?
    } else {
        session
            .send_request(
                "thread/start",
                json!({
                    "cwd": session.entry.path,
                    "approvalPolicy": "never"
                }),
            )
            .await?
    };

    if thread_result.get("error").is_some() {
        return Err(extract_error_message(
            thread_result.get("error"),
            "Unknown error starting Codex thread",
        ));
    }

    let helper_thread_id = thread_result
        .get("result")
        .and_then(|r| r.get("threadId"))
        .or_else(|| {
            thread_result
                .get("result")
                .and_then(|r| r.get("thread"))
                .and_then(|t| t.get("id"))
        })
        .or_else(|| thread_result.get("threadId"))
        .or_else(|| thread_result.get("thread").and_then(|t| t.get("id")))
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Failed to get thread id for Codex prompt".to_string())?
        .to_string();

    if preserve_session {
        crate::codex::record_codex_provider_binding(
            state,
            workspace_id,
            &helper_thread_id,
            &provider_profile_id,
        )
        .await;
    }

    if let Some(metadata) = auto_session.clone() {
        let _ = session_management::record_auto_session_metadata_core(
            &state.workspaces,
            state.storage_path.as_path(),
            workspace_id.to_string(),
            helper_thread_id.clone(),
            metadata,
        )
        .await;
    }

    if !preserve_session {
        let _ = app.emit(
            "app-server-event",
            AppServerEvent {
                workspace_id: workspace_id.to_string(),
                message: json!({
                    "method": "codex/backgroundThread",
                    "params": {
                        "threadId": helper_thread_id,
                        "action": "hide"
                    }
                }),
            },
        );
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
    {
        let mut callbacks = session.background_thread_callbacks.lock().await;
        callbacks.insert(helper_thread_id.clone(), tx);
    }
    let mut callback_guard =
        BackgroundCallbackGuard::new(session.clone(), helper_thread_id.clone());

    let mut writable_roots = vec![session.entry.path.clone()];
    if let Some(spec_root) = custom_spec_root {
        if !spec_root.is_empty()
            && spec_root != session.entry.path
            && !writable_roots.iter().any(|root| root == &spec_root)
        {
            writable_roots.push(spec_root);
        }
    }
    let access_mode = access_mode.unwrap_or_else(|| "read-only".to_string());
    let sandbox_policy = match access_mode.as_str() {
        "full-access" => json!({ "type": "dangerFullAccess" }),
        "current" => json!({
            "type": "workspaceWrite",
            "writableRoots": writable_roots,
            "networkAccess": true
        }),
        _ => json!({ "type": "readOnly" }),
    };
    let params = SendMessageParams {
        text: text.to_string(),
        model,
        effort,
        disable_thinking: false,
        access_mode: Some(access_mode),
        images,
        continue_session: false,
        session_id: None,
        fork_session_id: None,
        agent: None,
        variant: None,
        collaboration_mode: None,
        custom_spec_root: None,
    };
    let turn_input = params_to_codex_input(&params);

    let turn_result = session
        .send_request(
            "turn/start",
            json!({
                "threadId": helper_thread_id,
                "input": turn_input,
                "cwd": session.entry.path,
                "approvalPolicy": "never",
                "sandboxPolicy": sandbox_policy,
                "model": params.model,
                "effort": params.effort,
            }),
        )
        .await;

    let turn_result = match turn_result {
        Ok(result) => result,
        Err(error) => {
            callback_guard.cleanup().await;
            if !preserve_session {
                let _ = session
                    .send_request(
                        "thread/archive",
                        json!({ "threadId": helper_thread_id.as_str() }),
                    )
                    .await;
            }
            return Err(error);
        }
    };

    if turn_result.get("error").is_some() {
        callback_guard.cleanup().await;
        if !preserve_session {
            let _ = session
                .send_request(
                    "thread/archive",
                    json!({ "threadId": helper_thread_id.as_str() }),
                )
                .await;
        }
        return Err(extract_error_message(
            turn_result.get("error"),
            "Unknown error starting Codex turn",
        ));
    }

    let mut response_text = String::new();
    let collect_result = timeout(Duration::from_secs(600), async {
        while let Some(event) = rx.recv().await {
            let method = event.get("method").and_then(|m| m.as_str()).unwrap_or("");
            if let Some(delta) = extract_codex_text_delta(&event) {
                response_text.push_str(&delta);
                continue;
            }
            match method {
                "item/updated" | "item/completed" => {
                    if let Some(snapshot_text) = extract_agent_message_snapshot_text(&event) {
                        response_text = snapshot_text;
                    }
                }
                "turn/completed" => {
                    if response_text.trim().is_empty() {
                        if let Some(result_text) = extract_turn_completed_text(&event) {
                            response_text = result_text;
                        }
                    }
                    break;
                }
                "turn/error" => {
                    return Err(extract_error_message(
                        event.get("params").and_then(|params| params.get("error")),
                        "Unknown Codex turn error",
                    ));
                }
                _ => {}
            }
        }
        Ok(())
    })
    .await;

    callback_guard.cleanup().await;

    if !preserve_session {
        let _ = session
            .send_request(
                "thread/archive",
                json!({ "threadId": helper_thread_id.as_str() }),
            )
            .await;
    }

    match collect_result {
        Ok(Ok(())) => {}
        Ok(Err(error)) => return Err(error),
        Err(_) => return Err("Timeout waiting for Codex response".to_string()),
    }

    let trimmed = response_text.trim().to_string();
    if trimmed.is_empty() {
        return Err("Codex returned empty response".to_string());
    }
    Ok(CodexPromptSyncResult {
        text: trimmed,
        session_id: helper_thread_id,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        extract_agent_message_snapshot_text, extract_codex_text_delta, extract_turn_completed_text,
    };
    use serde_json::json;

    #[test]
    fn extracts_codex_agent_message_delta_aliases() {
        for method in [
            "item/agentMessage/delta",
            "item/agentMessage/textDelta",
            "item/agentMessage/text/delta",
        ] {
            let event = json!({
                "method": method,
                "params": {
                    "threadId": "thread-1",
                    "delta": "hello"
                }
            });
            assert_eq!(extract_codex_text_delta(&event), Some("hello".to_string()));
        }

        let nested = json!({
            "method": "item/agentMessage/textDelta",
            "params": {
                "threadId": "thread-1",
                "item": {
                    "text": "nested text"
                }
            }
        });
        assert_eq!(
            extract_codex_text_delta(&nested),
            Some("nested text".to_string())
        );
    }

    #[test]
    fn extracts_completed_agent_message_snapshot_text() {
        let event = json!({
            "method": "item/completed",
            "params": {
                "threadId": "thread-1",
                "item": {
                    "id": "item-1",
                    "type": "agentMessage",
                    "text": "{\"nodes\":[]}"
                }
            }
        });

        assert_eq!(
            extract_agent_message_snapshot_text(&event),
            Some("{\"nodes\":[]}".to_string())
        );
    }

    #[test]
    fn extracts_updated_agent_message_content_array_text() {
        let event = json!({
            "method": "item/updated",
            "params": {
                "threadId": "thread-1",
                "item": {
                    "id": "item-1",
                    "type": "message",
                    "role": "assistant",
                    "content": [
                        { "type": "output_text", "text": "{\"profile\":" },
                        { "type": "output_text", "text": "{}}" }
                    ]
                }
            }
        });

        assert_eq!(
            extract_agent_message_snapshot_text(&event),
            Some("{\"profile\":{}}".to_string())
        );
    }

    #[test]
    fn extracts_completed_assistant_message_snapshot_text_aliases() {
        let event = json!({
            "method": "item/completed",
            "params": {
                "threadId": "thread-1",
                "item": {
                    "id": "item-1",
                    "type": "assistantMessage",
                    "content": [{ "type": "output_text", "text": "assistant snapshot" }]
                }
            }
        });

        assert_eq!(
            extract_agent_message_snapshot_text(&event),
            Some("assistant snapshot".to_string())
        );
    }

    #[test]
    fn ignores_completed_tool_snapshots_as_assistant_text() {
        let event = json!({
            "method": "item/completed",
            "params": {
                "threadId": "thread-1",
                "item": {
                    "id": "tool-1",
                    "type": "toolCall",
                    "text": "not assistant text"
                }
            }
        });

        assert_eq!(extract_agent_message_snapshot_text(&event), None);
    }

    #[test]
    fn extracts_turn_completed_result_text_as_last_resort() {
        let event = json!({
            "method": "turn/completed",
            "params": {
                "threadId": "thread-1",
                "result": {
                    "summary": "final summary"
                }
            }
        });

        assert_eq!(
            extract_turn_completed_text(&event),
            Some("final summary".to_string())
        );
    }

    #[test]
    fn extracts_turn_completed_output_array_text_as_last_resort() {
        let event = json!({
            "method": "turn/completed",
            "params": {
                "threadId": "thread-1",
                "output": [
                    {
                        "type": "message",
                        "role": "assistant",
                        "content": [
                            { "type": "output_text", "text": "{\"nodes\":" },
                            { "type": "output_text", "text": "[]}" }
                        ]
                    }
                ]
            }
        });

        assert_eq!(
            extract_turn_completed_text(&event),
            Some("{\"nodes\":[]}".to_string())
        );
    }

    #[test]
    fn extracts_turn_completed_turn_items_agent_message_text() {
        let event = json!({
            "method": "turn/completed",
            "params": {
                "threadId": "thread-1",
                "turn": {
                    "id": "turn-1",
                    "status": "completed",
                    "items": [
                        { "type": "userMessage", "text": "do not use this prompt" },
                        {
                            "type": "agentMessage",
                            "text": "{\"nodes\":[{\"id\":\"project-core\"}]}"
                        }
                    ]
                }
            }
        });

        assert_eq!(
            extract_turn_completed_text(&event),
            Some("{\"nodes\":[{\"id\":\"project-core\"}]}".to_string())
        );
    }

    #[test]
    fn extracts_turn_completed_result_turn_assistant_content_text() {
        let event = json!({
            "method": "turn/completed",
            "params": {
                "threadId": "thread-1",
                "result": {
                    "turn": {
                        "items": [
                            {
                                "role": "assistant",
                                "type": "message",
                                "content": [
                                    { "type": "output_text", "text": "{\"profile\":" },
                                    { "type": "output_text", "text": "{}}" }
                                ]
                            }
                        ]
                    }
                }
            }
        });

        assert_eq!(
            extract_turn_completed_text(&event),
            Some("{\"profile\":{}}".to_string())
        );
    }

    #[test]
    fn turn_completed_items_do_not_treat_user_text_as_assistant_output() {
        let event = json!({
            "method": "turn/completed",
            "params": {
                "threadId": "thread-1",
                "turn": {
                    "items": [
                        { "type": "userMessage", "text": "user prompt" },
                        { "type": "toolCall", "output": "tool output" }
                    ]
                }
            }
        });

        assert_eq!(extract_turn_completed_text(&event), None);
    }
}
