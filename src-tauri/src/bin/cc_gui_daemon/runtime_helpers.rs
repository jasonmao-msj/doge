use super::*;
use tokio::time::Duration;

const SESSION_HEALTH_PROBE_TIMEOUT_SECS: u64 = 15;
const CREATE_SESSION_RUNTIME_RECOVERING_ERROR_PREFIX: &str = "[SESSION_CREATE_RUNTIME_RECOVERING]";

pub(super) fn is_stopping_runtime_race_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("manual shutdown")
        || normalized.contains("manual_shutdown")
        || (normalized.contains("[runtime_ended]") && normalized.contains("stopped after"))
}

pub(super) fn create_session_runtime_recovering_error() -> String {
    format!(
        "{CREATE_SESSION_RUNTIME_RECOVERING_ERROR_PREFIX} Managed runtime was restarting while creating this session. The app retried automatically but could not acquire a healthy runtime yet. Reconnect the workspace and try again."
    )
}

pub(super) fn is_valid_claude_model_for_passthrough(model: &str) -> bool {
    let trimmed = model.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return false;
    }
    trimmed.chars().all(|ch| {
        ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':' | '/' | '[' | ']')
    })
}

impl DaemonState {
    fn emit_manual_compaction_event(&self, workspace_id: &str, method: &str, params: Value) {
        self.event_sink.emit_app_server_event(AppServerEvent {
            workspace_id: workspace_id.to_string(),
            message: json!({
                "method": method,
                "params": params,
            }),
        });
    }

    pub(super) async fn compact_claude_thread(
        &self,
        workspace_id: String,
        thread_id: String,
    ) -> Result<Value, String> {
        let session_id = thread_id
            .strip_prefix("claude:")
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("Claude thread id is invalid: {thread_id}"))?
            .to_string();

        let workspace_path = {
            let workspaces = self.workspaces.lock().await;
            workspaces
                .get(&workspace_id)
                .map(|entry| PathBuf::from(&entry.path))
                .ok_or_else(|| "Workspace not found".to_string())?
        };

        let session = self
            .engine_manager
            .get_claude_session(&workspace_id, &workspace_path)
            .await;

        self.emit_manual_compaction_event(
            &workspace_id,
            "thread/compacting",
            json!({
                "threadId": &thread_id,
                "thread_id": &thread_id,
                "auto": false,
                "manual": true,
            }),
        );

        let turn_id = format!("claude-compact-{}", uuid::Uuid::new_v4());
        let params = engine::SendMessageParams {
            text: "/compact".to_string(),
            images: None,
            continue_session: true,
            session_id: Some(session_id),
            ..Default::default()
        };

        // No outer wall-clock cap: /compact is an LLM summarization over the whole
        // conversation and legitimately takes minutes on a large context. send_message
        // already has a 90s first-event watchdog (claude.rs) guarding a true hang, and
        // the auto-compact path (lifecycle.rs) runs uncapped too — matching it here.
        let compact_result = session.send_message(params, &turn_id).await;

        match compact_result {
            Ok(result_text) => {
                self.emit_manual_compaction_event(
                    &workspace_id,
                    "thread/compacted",
                    json!({
                        "threadId": &thread_id,
                        "thread_id": &thread_id,
                        "turnId": &turn_id,
                        "turn_id": &turn_id,
                        "auto": false,
                        "manual": true,
                    }),
                );
                Ok(json!({
                    "threadId": &thread_id,
                    "turnId": &turn_id,
                    "text": result_text,
                    "status": "completed",
                    "engine": "claude",
                }))
            }
            Err(error) => {
                self.emit_manual_compaction_event(
                    &workspace_id,
                    "thread/compactionFailed",
                    json!({
                        "threadId": &thread_id,
                        "thread_id": &thread_id,
                        "auto": false,
                        "manual": true,
                        "reason": error,
                    }),
                );
                Err(error)
            }
        }
    }

    pub(super) async fn ensure_codex_session_for_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<(), String> {
        let existing_session = {
            let sessions = self.sessions.lock().await;
            sessions.get(workspace_id).cloned()
        };
        if let Some(session) = existing_session {
            if let Some(reason) = session.stale_reuse_reason() {
                log::warn!(
                    "[daemon.ensure_codex_session_for_workspace] stale session rejected before probe for workspace {}: {}",
                    workspace_id,
                    reason
                );
                workspaces_core::disconnect_workspace_session_core(
                    &self.sessions,
                    Some(&self.runtime_manager),
                    workspace_id,
                )
                .await;
            } else {
                match session
                    .probe_health(Duration::from_secs(SESSION_HEALTH_PROBE_TIMEOUT_SECS))
                    .await
                {
                    Ok(()) => return Ok(()),
                    Err(error) => {
                        log::warn!(
                            "[daemon.ensure_codex_session_for_workspace] stale session detected for workspace {}: {}",
                            workspace_id,
                            error
                        );
                        workspaces_core::disconnect_workspace_session_core(
                            &self.sessions,
                            Some(&self.runtime_manager),
                            workspace_id,
                        )
                        .await;
                    }
                }
            }
        }
        self.connect_codex_workspace_session(
            workspace_id.to_string(),
            env!("CARGO_PKG_VERSION").to_string(),
            Some("ensure-runtime-ready".to_string()),
        )
        .await
    }
}
