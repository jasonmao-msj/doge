use super::*;
use tokio::sync::mpsc;

impl DaemonState {
    pub(crate) async fn generate_thread_title(
        &self,
        workspace_id: String,
        thread_id: String,
        user_message: String,
        preferred_language: Option<String>,
    ) -> Result<String, String> {
        let cleaned_message = user_message.trim().to_string();
        if cleaned_message.is_empty() {
            return Err("Message is required to generate title".to_string());
        }

        let language_instruction = match preferred_language
            .unwrap_or_else(|| "en".to_string())
            .trim()
            .to_lowercase()
            .as_str()
        {
            "zh" | "zh-cn" | "zh-hans" | "chinese" => "Output language: Simplified Chinese.",
            _ => "Output language: English.",
        };

        let session = {
            let sessions = self.sessions.lock().await;
            sessions
                .get(&workspace_id)
                .ok_or("workspace not connected")?
                .clone()
        };

        let prompt = format!(
            "Generate a concise title for a coding chat thread from the first user message. \
Return only the title text, no quotes, no punctuation-only output, no markdown. \
Keep it between 3 and 8 words.\n\
{language_instruction}\n\nFirst user message:\n{cleaned_message}"
        );

        let helper_thread_result = session
            .send_request(
                "thread/start",
                json!({
                    "cwd": session.entry.path,
                    "approvalPolicy": "never"
                }),
            )
            .await?;

        if let Some(error) = helper_thread_result.get("error") {
            let message = error
                .get("message")
                .and_then(|value| value.as_str())
                .unwrap_or("Unknown error starting title thread");
            return Err(message.to_string());
        }

        let helper_thread_id = helper_thread_result
            .get("result")
            .and_then(|result| result.get("threadId"))
            .or_else(|| {
                helper_thread_result
                    .get("result")
                    .and_then(|result| result.get("thread"))
                    .and_then(|thread| thread.get("id"))
            })
            .or_else(|| helper_thread_result.get("threadId"))
            .or_else(|| {
                helper_thread_result
                    .get("thread")
                    .and_then(|thread| thread.get("id"))
            })
            .and_then(|value| value.as_str())
            .ok_or_else(|| {
                format!(
                    "Failed to get threadId from thread/start response: {:?}",
                    helper_thread_result
                )
            })?
            .to_string();

        let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
        {
            let mut callbacks = session.background_thread_callbacks.lock().await;
            callbacks.insert(helper_thread_id.clone(), tx);
        }

        let turn_start_result = session
            .send_request(
                "turn/start",
                json!({
                    "threadId": helper_thread_id,
                    "input": [{ "type": "text", "text": prompt }],
                    "cwd": session.entry.path,
                    "approvalPolicy": "never",
                    "sandboxPolicy": { "type": "readOnly" },
                }),
            )
            .await;

        let turn_start_result = match turn_start_result {
            Ok(value) => value,
            Err(error) => {
                {
                    let mut callbacks = session.background_thread_callbacks.lock().await;
                    callbacks.remove(&helper_thread_id);
                }
                let _ = session
                    .send_request(
                        "thread/archive",
                        json!({ "threadId": helper_thread_id.as_str() }),
                    )
                    .await;
                return Err(error);
            }
        };

        if let Some(error) = turn_start_result.get("error") {
            let message = error
                .get("message")
                .and_then(|value| value.as_str())
                .unwrap_or("Unknown error starting title generation turn")
                .to_string();
            {
                let mut callbacks = session.background_thread_callbacks.lock().await;
                callbacks.remove(&helper_thread_id);
            }
            let _ = session
                .send_request(
                    "thread/archive",
                    json!({ "threadId": helper_thread_id.as_str() }),
                )
                .await;
            return Err(message);
        }

        let mut generated = String::new();
        let collect_result = tokio::time::timeout(std::time::Duration::from_secs(30), async {
            while let Some(event) = rx.recv().await {
                let method = event
                    .get("method")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                match method {
                    "item/agentMessage/delta" => {
                        if let Some(delta) = event
                            .get("params")
                            .and_then(|params| params.get("delta"))
                            .and_then(|value| value.as_str())
                        {
                            generated.push_str(delta);
                        }
                    }
                    "turn/completed" => break,
                    "turn/error" => {
                        let message = event
                            .get("params")
                            .and_then(|params| params.get("error"))
                            .and_then(|value| value.as_str())
                            .unwrap_or("Unknown error during title generation");
                        return Err(message.to_string());
                    }
                    _ => {}
                }
            }
            Ok(())
        })
        .await;

        {
            let mut callbacks = session.background_thread_callbacks.lock().await;
            callbacks.remove(&helper_thread_id);
        }

        let _ = session
            .send_request("thread/archive", json!({ "threadId": helper_thread_id }))
            .await;

        match collect_result {
            Ok(Ok(())) => {}
            Ok(Err(error)) => return Err(error),
            Err(_) => return Err("Timeout waiting for thread title generation".to_string()),
        }

        let normalized = generated
            .lines()
            .next()
            .unwrap_or("")
            .trim()
            .trim_matches('"')
            .to_string();
        if normalized.is_empty() {
            return Err("No thread title was generated".to_string());
        }

        thread_titles_core::upsert_thread_title_core(
            &self.workspaces,
            workspace_id,
            thread_id,
            normalized,
        )
        .await
    }
}
