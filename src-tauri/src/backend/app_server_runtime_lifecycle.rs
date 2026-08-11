use super::*;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{ChildStderr, ChildStdout};

impl WorkspaceSession {
    pub(super) async fn record_timed_out_request(
        &self,
        id: u64,
        method: &str,
        thread_id: Option<String>,
    ) {
        let now = now_millis();
        let mut timed_out_requests = self.timed_out_requests.lock().await;
        timed_out_requests.retain(|_, request| {
            now.saturating_sub(request.timed_out_at_ms) <= TIMED_OUT_REQUEST_GRACE_MS
        });
        timed_out_requests.insert(
            id,
            TimedOutRequest {
                method: method.to_string(),
                thread_id,
                timed_out_at_ms: now,
            },
        );
    }

    pub(super) async fn take_timed_out_request(&self, id: u64) -> Option<TimedOutRequest> {
        let now = now_millis();
        let mut timed_out_requests = self.timed_out_requests.lock().await;
        timed_out_requests.retain(|_, request| {
            now.saturating_sub(request.timed_out_at_ms) <= TIMED_OUT_REQUEST_GRACE_MS
        });
        timed_out_requests.remove(&id)
    }

    pub(super) async fn record_runtime_event_activity(&self, value: &Value) {
        let mut active_turns = self.active_turns.lock().await;
        super::event_helpers::apply_runtime_event_activity(&mut active_turns, value);
    }

    pub(super) async fn enrich_codex_turn_timing(
        &self,
        value: &mut Value,
        stdout_received_at_ms: u64,
    ) {
        let Some(thread_id) = extract_thread_id(value) else {
            return;
        };
        let normalized_thread_id = thread_id.trim();
        if normalized_thread_id.is_empty() {
            return;
        }
        let method = extract_event_method(value).map(ToOwned::to_owned);
        let method_name = method.as_deref();
        let has_agent_text_delta = has_agent_message_text_delta(value);
        let is_reasoning_event = is_reasoning_event_method(method_name);
        let is_assistant_item_event = is_assistant_item_event(value);
        let is_tool_event = is_tool_event(value);
        let should_count_before_first_text = !has_agent_text_delta;
        let timing_snapshot = {
            let mut timing = self.codex_turn_timing.lock().await;
            let Some(state) = timing.get_mut(normalized_thread_id) else {
                return;
            };
            if state.first_runtime_event_received_at_ms.is_none() {
                state.first_runtime_event_received_at_ms = Some(stdout_received_at_ms);
                state.first_runtime_event_method = method.clone();
            }
            if state.first_stream_event_received_at_ms.is_none() {
                state.first_stream_event_received_at_ms = Some(stdout_received_at_ms);
                state.first_stream_event_method = method.clone();
            }
            if is_reasoning_event && state.first_reasoning_event_received_at_ms.is_none() {
                state.first_reasoning_event_received_at_ms = Some(stdout_received_at_ms);
                state.first_reasoning_event_method = method.clone();
            }
            if is_assistant_item_event && state.first_assistant_item_event_received_at_ms.is_none()
            {
                state.first_assistant_item_event_received_at_ms = Some(stdout_received_at_ms);
                state.first_assistant_item_event_method = method.clone();
            }
            if is_agent_message_text_delta_method(method_name)
                && state.first_agent_message_event_received_at_ms.is_none()
            {
                state.first_agent_message_event_received_at_ms = Some(stdout_received_at_ms);
                state.first_agent_message_event_method = method.clone();
            }
            if is_tool_event && state.first_tool_event_received_at_ms.is_none() {
                state.first_tool_event_received_at_ms = Some(stdout_received_at_ms);
                state.first_tool_event_method = method.clone();
            }
            if state.first_text_delta_received_at_ms.is_none() && should_count_before_first_text {
                state.event_count_before_first_text_delta =
                    state.event_count_before_first_text_delta.saturating_add(1);
                if is_reasoning_event {
                    state.reasoning_event_count_before_first_text_delta = state
                        .reasoning_event_count_before_first_text_delta
                        .saturating_add(1);
                }
                if is_tool_event {
                    state.tool_event_count_before_first_text_delta = state
                        .tool_event_count_before_first_text_delta
                        .saturating_add(1);
                }
                if let Some(method) = method_name {
                    if state.methods_before_first_text_delta.len()
                        < CODEX_TIMING_METHODS_BEFORE_FIRST_TEXT_LIMIT
                        && !state
                            .methods_before_first_text_delta
                            .iter()
                            .any(|existing| existing == method)
                    {
                        state
                            .methods_before_first_text_delta
                            .push(method.to_string());
                    }
                }
            }
            if has_agent_text_delta && state.first_text_delta_received_at_ms.is_none() {
                state.first_text_delta_received_at_ms = Some(stdout_received_at_ms);
                state.first_text_delta_method = method.clone();
            }
            state.clone()
        };
        attach_codex_timing_to_event(value, &timing_snapshot, stdout_received_at_ms);
        if matches!(method.as_deref(), Some("turn/completed" | "turn/error")) {
            self.codex_turn_timing
                .lock()
                .await
                .remove(normalized_thread_id);
        }
    }

    pub(crate) fn mark_shutdown_requested(&self, source: RuntimeShutdownSource) {
        self.manual_shutdown_requested.store(true, Ordering::SeqCst);
        let mut shutdown_source = self
            .shutdown_source
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if shutdown_source.is_none() {
            *shutdown_source = Some(source);
        }
    }

    #[cfg(test)]
    pub(crate) fn mark_manual_shutdown(&self) {
        self.mark_shutdown_requested(RuntimeShutdownSource::CompatibilityManual);
    }

    pub(crate) fn has_manual_shutdown_requested(&self) -> bool {
        self.manual_shutdown_requested.load(Ordering::SeqCst)
    }

    pub(crate) fn mark_shutdown_had_active_work_protection(&self) {
        self.shutdown_had_active_work_protection
            .store(true, Ordering::SeqCst);
    }

    fn had_active_work_protection_when_shutdown_started(&self) -> bool {
        self.shutdown_had_active_work_protection
            .load(Ordering::SeqCst)
    }

    pub(crate) fn shutdown_source(&self) -> Option<RuntimeShutdownSource> {
        *self
            .shutdown_source
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub(crate) fn has_runtime_end_emitted(&self) -> bool {
        self.runtime_end_emitted.load(Ordering::SeqCst)
    }

    pub(crate) fn stale_reuse_reason(&self) -> Option<&'static str> {
        if let Some(source) = self.shutdown_source() {
            Some(source.stale_reuse_reason())
        } else if self.has_manual_shutdown_requested() {
            Some(RuntimeShutdownSource::CompatibilityManual.stale_reuse_reason())
        } else if self.has_runtime_end_emitted() {
            Some("runtime-end-emitted")
        } else {
            None
        }
    }

    async fn collect_runtime_end_context(&self) -> RuntimeEndContext {
        let active_turns = self.active_turns.lock().await.clone();
        let timed_out_requests = self.timed_out_requests.lock().await.clone();
        let callback_threads = self
            .background_thread_callbacks
            .lock()
            .await
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        super::event_helpers::collect_runtime_end_context(
            &active_turns,
            &timed_out_requests,
            &callback_threads,
        )
    }

    pub(super) async fn handle_runtime_end<E: EventSink>(
        &self,
        event_sink: &E,
        reason_code: &str,
        message: String,
        exit_code: Option<i32>,
        exit_signal: Option<String>,
    ) {
        if self
            .runtime_end_emitted
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }

        let runtime_end_context = self.collect_runtime_end_context().await;

        let mut pending = self.pending.lock().await;
        let pending_count = pending.len() as u32;
        for sender in pending.drain().map(|(_, sender)| sender) {
            let _ = sender.send(Err(message.clone()));
        }
        drop(pending);

        let mut timed_out_requests = self.timed_out_requests.lock().await;
        let timed_out_count = timed_out_requests.len() as u32;
        timed_out_requests.clear();
        drop(timed_out_requests);

        self.resume_pending_turns.lock().await.clear();
        self.background_thread_callbacks.lock().await.clear();
        let total_pending_request_count = pending_count.saturating_add(timed_out_count);
        let runtime_work_active = if let Some(runtime_manager) = self.runtime_manager() {
            runtime_manager
                .has_active_work_protection_for_session(
                    "codex",
                    &self.entry.id,
                    self.process_id,
                    Some(self.started_at_ms),
                )
                .await
        } else {
            false
        } || self.had_active_work_protection_when_shutdown_started();

        if let Some(runtime_manager) = self.runtime_manager() {
            runtime_manager
                .record_runtime_end_context(
                    "codex",
                    &self.entry.id,
                    runtime_end_context.affected_thread_ids.clone(),
                    runtime_end_context.affected_turn_ids.clone(),
                    runtime_end_context.affected_active_turns.clone(),
                    reason_code,
                )
                .await;
            runtime_manager
                .record_runtime_ended_for_session(
                    "codex",
                    &self.entry.id,
                    self.process_id,
                    Some(self.started_at_ms),
                    RuntimeEndedRecord {
                        reason_code: reason_code.to_string(),
                        message: Some(message.clone()),
                        exit_code,
                        exit_signal: exit_signal.clone(),
                        pending_request_count: total_pending_request_count,
                    },
                )
                .await;
        }

        if runtime_end_context.has_affected_work()
            || total_pending_request_count > 0
            || runtime_work_active
        {
            event_sink.emit_app_server_event(AppServerEvent {
                workspace_id: self.entry.id.clone(),
                message: build_runtime_ended_event(
                    &self.entry.id,
                    reason_code,
                    &message,
                    exit_code,
                    exit_signal.as_deref(),
                    self.shutdown_source()
                        .map(RuntimeShutdownSource::as_str)
                        .as_deref(),
                    Some(self.runtime_generation().as_str()),
                    self.process_id,
                    Some(self.started_at_ms),
                    &runtime_end_context,
                    total_pending_request_count,
                ),
            });
        }
    }
}

fn has_agent_message_text_delta(value: &Value) -> bool {
    if !is_agent_message_text_delta_method(extract_event_method(value)) {
        return false;
    }
    value
        .get("params")
        .and_then(|params| params.get("delta").or_else(|| params.get("text")))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .is_some()
}

fn is_agent_message_text_delta_method(method: Option<&str>) -> bool {
    matches!(
        method,
        Some(
            "item/agentMessage/delta" | "text:delta" | "text/delta" | "item/agentMessage/textDelta"
        )
    )
}

fn is_reasoning_event_method(method: Option<&str>) -> bool {
    method
        .map(|method| method.starts_with("item/reasoning/"))
        .unwrap_or(false)
}

fn is_assistant_item_event(value: &Value) -> bool {
    let Some(method) = extract_event_method(value) else {
        return false;
    };
    if !matches!(method, "item/started" | "item/updated" | "item/completed") {
        return false;
    }
    value
        .get("params")
        .and_then(|params| params.get("item"))
        .and_then(Value::as_object)
        .and_then(|item| {
            item.get("type")
                .or_else(|| item.get("kind"))
                .and_then(Value::as_str)
        })
        .map(|type_text| {
            let normalized = type_text
                .chars()
                .filter(|character| *character != '_' && *character != '-')
                .collect::<String>()
                .to_ascii_lowercase();
            normalized == "agentmessage" || normalized == "assistantmessage"
        })
        .unwrap_or(false)
}

fn is_tool_event(value: &Value) -> bool {
    let Some(method) = extract_event_method(value) else {
        return false;
    };
    if !matches!(method, "item/started" | "item/updated" | "item/completed") {
        return false;
    }
    let Some(item) = value
        .get("params")
        .and_then(|params| params.get("item"))
        .and_then(Value::as_object)
    else {
        return false;
    };
    let type_text = item
        .get("type")
        .or_else(|| item.get("kind"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    type_text.contains("tool")
        || type_text.contains("call")
        || item.get("tool").and_then(Value::as_str).is_some()
        || item.get("toolName").and_then(Value::as_str).is_some()
        || item.get("tool_name").and_then(Value::as_str).is_some()
}

fn non_negative_gap_ms(later: Option<u64>, earlier: Option<u64>) -> Option<u64> {
    match (later, earlier) {
        (Some(later), Some(earlier)) => Some(later.saturating_sub(earlier)),
        _ => None,
    }
}

fn attach_codex_timing_to_event(
    value: &mut Value,
    timing: &CodexTurnTimingState,
    stdout_received_at_ms: u64,
) {
    let Some(params) = value.get_mut("params").and_then(Value::as_object_mut) else {
        return;
    };
    let response_received_at_ms = timing.turn_start_response_received_at_ms;
    let mut payload = serde_json::Map::new();
    payload.insert("source".to_string(), json!("codex-app-server"));
    payload.insert(
        "turnStartRequestStartedAtMs".to_string(),
        json!(timing.turn_start_request_started_at_ms),
    );
    payload.insert(
        "turnStartResponseReceivedAtMs".to_string(),
        json!(response_received_at_ms),
    );
    payload.insert(
        "firstRuntimeEventReceivedAtMs".to_string(),
        json!(timing.first_runtime_event_received_at_ms),
    );
    payload.insert(
        "firstStreamEventReceivedAtMs".to_string(),
        json!(timing.first_stream_event_received_at_ms),
    );
    payload.insert(
        "firstReasoningEventReceivedAtMs".to_string(),
        json!(timing.first_reasoning_event_received_at_ms),
    );
    payload.insert(
        "firstAssistantItemEventReceivedAtMs".to_string(),
        json!(timing.first_assistant_item_event_received_at_ms),
    );
    payload.insert(
        "firstAgentMessageEventReceivedAtMs".to_string(),
        json!(timing.first_agent_message_event_received_at_ms),
    );
    payload.insert(
        "firstToolEventReceivedAtMs".to_string(),
        json!(timing.first_tool_event_received_at_ms),
    );
    payload.insert(
        "firstTextDeltaReceivedAtMs".to_string(),
        json!(timing.first_text_delta_received_at_ms),
    );
    payload.insert(
        "stdoutReceivedAtMs".to_string(),
        json!(stdout_received_at_ms),
    );
    payload.insert(
        "turnStartRequestToResponseMs".to_string(),
        json!(non_negative_gap_ms(
            timing.turn_start_response_received_at_ms,
            Some(timing.turn_start_request_started_at_ms),
        )),
    );
    payload.insert(
        "turnStartResponseToFirstStreamEventMs".to_string(),
        json!(non_negative_gap_ms(
            timing.first_stream_event_received_at_ms,
            response_received_at_ms,
        )),
    );
    payload.insert(
        "turnStartResponseToFirstRuntimeEventMs".to_string(),
        json!(non_negative_gap_ms(
            timing.first_runtime_event_received_at_ms,
            response_received_at_ms,
        )),
    );
    payload.insert(
        "turnStartResponseToFirstTextDeltaMs".to_string(),
        json!(non_negative_gap_ms(
            timing.first_text_delta_received_at_ms,
            response_received_at_ms,
        )),
    );
    payload.insert(
        "firstRuntimeEventToFirstTextDeltaMs".to_string(),
        json!(non_negative_gap_ms(
            timing.first_text_delta_received_at_ms,
            timing.first_runtime_event_received_at_ms,
        )),
    );
    payload.insert(
        "firstRuntimeEventToFirstAssistantItemEventMs".to_string(),
        json!(non_negative_gap_ms(
            timing.first_assistant_item_event_received_at_ms,
            timing.first_runtime_event_received_at_ms,
        )),
    );
    payload.insert(
        "firstAssistantItemEventToFirstTextDeltaMs".to_string(),
        json!(non_negative_gap_ms(
            timing.first_text_delta_received_at_ms,
            timing.first_assistant_item_event_received_at_ms,
        )),
    );
    payload.insert(
        "turnStartResponseToThisEventMs".to_string(),
        json!(non_negative_gap_ms(
            Some(stdout_received_at_ms),
            response_received_at_ms,
        )),
    );
    payload.insert(
        "firstStreamEventMethod".to_string(),
        json!(timing.first_stream_event_method.as_deref()),
    );
    payload.insert(
        "firstRuntimeEventMethod".to_string(),
        json!(timing.first_runtime_event_method.as_deref()),
    );
    payload.insert(
        "firstReasoningEventMethod".to_string(),
        json!(timing.first_reasoning_event_method.as_deref()),
    );
    payload.insert(
        "firstAssistantItemEventMethod".to_string(),
        json!(timing.first_assistant_item_event_method.as_deref()),
    );
    payload.insert(
        "firstAgentMessageEventMethod".to_string(),
        json!(timing.first_agent_message_event_method.as_deref()),
    );
    payload.insert(
        "firstToolEventMethod".to_string(),
        json!(timing.first_tool_event_method.as_deref()),
    );
    payload.insert(
        "firstTextDeltaMethod".to_string(),
        json!(timing.first_text_delta_method.as_deref()),
    );
    payload.insert(
        "eventCountBeforeFirstTextDelta".to_string(),
        json!(timing.event_count_before_first_text_delta),
    );
    payload.insert(
        "reasoningEventCountBeforeFirstTextDelta".to_string(),
        json!(timing.reasoning_event_count_before_first_text_delta),
    );
    payload.insert(
        "toolEventCountBeforeFirstTextDelta".to_string(),
        json!(timing.tool_event_count_before_first_text_delta),
    );
    payload.insert(
        "methodsBeforeFirstTextDelta".to_string(),
        json!(timing.methods_before_first_text_delta),
    );

    match params.get_mut("dogeTiming").and_then(Value::as_object_mut) {
        Some(existing) => existing.extend(payload),
        None => {
            params.insert("dogeTiming".to_string(), Value::Object(payload));
        }
    }
}

fn runtime_shutdown_message(source: Option<RuntimeShutdownSource>) -> String {
    let source = source.unwrap_or(RuntimeShutdownSource::CompatibilityManual);
    format!(
        "[RUNTIME_ENDED] Managed runtime stopped after manual shutdown (source: {}).",
        source.as_str()
    )
}

fn runtime_end_from_stdout_close_without_status(
    session: &WorkspaceSession,
) -> (&'static str, String) {
    let reason_code = if session.manual_shutdown_requested.load(Ordering::SeqCst) {
        "manual_shutdown"
    } else {
        "stdout_eof"
    };
    let message = if reason_code == "manual_shutdown" {
        runtime_shutdown_message(session.shutdown_source())
    } else {
        "[RUNTIME_ENDED] Managed runtime stdout closed before the turn reached a terminal lifecycle event."
            .to_string()
    };
    (reason_code, message)
}

fn runtime_end_from_process_status(
    session: &WorkspaceSession,
    status: &std::process::ExitStatus,
) -> (&'static str, String, Option<i32>, Option<String>) {
    let reason_code = if session.manual_shutdown_requested.load(Ordering::SeqCst) {
        "manual_shutdown"
    } else {
        "process_exit"
    };
    let exit_code = status.code();
    #[cfg(unix)]
    let exit_signal =
        std::os::unix::process::ExitStatusExt::signal(status).map(|signal| signal.to_string());
    #[cfg(not(unix))]
    let exit_signal: Option<String> = None;
    let message = if reason_code == "manual_shutdown" {
        runtime_shutdown_message(session.shutdown_source())
    } else if let Some(code) = exit_code {
        format!("[RUNTIME_ENDED] Managed runtime process exited unexpectedly with code {code}.")
    } else if let Some(signal) = exit_signal.as_deref() {
        format!("[RUNTIME_ENDED] Managed runtime process exited unexpectedly with signal {signal}.")
    } else {
        "[RUNTIME_ENDED] Managed runtime process exited unexpectedly.".to_string()
    };
    (reason_code, message, exit_code, exit_signal)
}

async fn wait_for_process_status_after_stdout_close(
    session: &WorkspaceSession,
) -> Option<std::process::ExitStatus> {
    let deadline = tokio::time::Instant::now() + Duration::from_millis(150);
    loop {
        let status_result = {
            let mut child = session.child.lock().await;
            child.try_wait()
        };
        match status_result {
            Ok(Some(status)) => return Some(status),
            Ok(None) if tokio::time::Instant::now() < deadline => {
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            Ok(None) | Err(_) => return None,
        }
    }
}

async fn runtime_end_from_stdout_close(
    session: &WorkspaceSession,
) -> (&'static str, String, Option<i32>, Option<String>) {
    if let Some(status) = wait_for_process_status_after_stdout_close(session).await {
        return runtime_end_from_process_status(session, &status);
    }
    let (reason_code, message) = runtime_end_from_stdout_close_without_status(session);
    (reason_code, message, None, None)
}

async fn emit_workspace_event<E: EventSink>(
    session: &Arc<WorkspaceSession>,
    event_sink: &E,
    workspace_id: &str,
    value: Value,
) {
    let thread_id = extract_thread_id(&value);
    let background_sender = if let Some(ref tid) = thread_id {
        let callbacks = session.background_thread_callbacks.lock().await;
        callbacks.get(tid).cloned()
    } else {
        None
    };
    let mut event = AppServerEvent {
        workspace_id: workspace_id.to_string(),
        message: value,
    };
    let background_message = background_sender.as_ref().map(|_| event.message.clone());

    // Shared canonical assembler 与 owner projection 必须先看到 authoritative
    // Runtime event；普通 UI throttle/drop 不能影响 durable terminal snapshot。
    if event_sink.observe_app_server_event(&session.provider_runtime_key, &mut event)
        == AppServerEventDisposition::DeferredBySharedOwner
    {
        return;
    }

    if let (Some(sender), Some(message)) = (background_sender, background_message) {
        let _ = sender.send(message);
    } else {
        let events = {
            let mut throttle = session.snapshot_throttle.lock().await;
            throttle.filter_event(workspace_id, event.message)
        };
        for message in events {
            event_sink.emit_app_server_event(AppServerEvent {
                workspace_id: workspace_id.to_string(),
                message,
            });
        }
    }
}

fn parse_app_server_message_id(value: &Value) -> Option<u64> {
    value.get("id").and_then(|id| {
        id.as_u64()
            .or_else(|| id.as_i64().and_then(|i| u64::try_from(i).ok()))
            .or_else(|| id.as_str().and_then(|s| s.parse::<u64>().ok()))
    })
}

async fn dispatch_workspace_stdout_value<E: EventSink>(
    session: &Arc<WorkspaceSession>,
    event_sink: &E,
    workspace_id: &str,
    value: Value,
) {
    let maybe_id = parse_app_server_message_id(&value);
    let has_method = value.get("method").is_some();
    let has_result_or_error = value.get("result").is_some() || value.get("error").is_some();

    if let Some(id) = maybe_id {
        if has_result_or_error {
            if let Some(tx) = session.pending.lock().await.remove(&id) {
                let _ = tx.send(Ok(value));
            } else if let Some(timed_out_request) = session.take_timed_out_request(id).await {
                if timed_out_request.method == "turn/start" {
                    let synthetic_event = if response_error_message(&value).is_some() {
                        build_late_turn_error_event(&value, &timed_out_request)
                    } else {
                        build_late_turn_started_event(&value)
                    };
                    if let Some(synthetic_event) = synthetic_event {
                        emit_workspace_event(session, event_sink, workspace_id, synthetic_event)
                            .await;
                    }
                }
            }
            return;
        }

        if has_method {
            emit_workspace_event(session, event_sink, workspace_id, value).await;
            return;
        }

        if let Some(tx) = session.pending.lock().await.remove(&id) {
            let _ = tx.send(Ok(value));
        }
        return;
    }

    if has_method {
        emit_workspace_event(session, event_sink, workspace_id, value).await;
    }
}

async fn process_workspace_stdout_value<E: EventSink>(
    session: &Arc<WorkspaceSession>,
    event_sink: &E,
    workspace_id: &str,
    mut value: Value,
) {
    let stdout_received_at_ms = now_millis();
    if let Some(blocked_event) = session.intercept_request_user_input_if_needed(&value).await {
        value = blocked_event;
    }
    if let Some(blocked_event) = session.intercept_plan_repo_mutation_if_needed(&value).await {
        value = blocked_event;
    }

    session.track_plan_turn_state(&value).await;
    session.record_runtime_event_activity(&value).await;
    session
        .clear_resume_pending_watch(
            extract_thread_id(&value).as_deref(),
            extract_turn_id(&value).as_deref(),
            extract_event_method(&value),
        )
        .await;
    if let Some(runtime_manager) = session.runtime_manager() {
        runtime_manager
            .handle_codex_runtime_event(&session.entry, &value)
            .await;
    }
    session
        .enrich_codex_turn_timing(&mut value, stdout_received_at_ms)
        .await;

    let synthetic_plan_event = session.maybe_emit_plan_blocker_user_input(&value).await;
    let synthetic_plan_apply_event = session.maybe_emit_plan_apply_user_input(&value).await;
    if session
        .should_suppress_after_synthetic_plan_block(&value)
        .await
    {
        let suppressed_thread_id = extract_thread_id(&value);
        let suppressed_method = extract_event_method(&value);
        session
            .clear_terminal_plan_turn_state(suppressed_thread_id.as_deref(), suppressed_method)
            .await;
        return;
    }

    let event_method = extract_event_method(&value).map(ToString::to_string);
    let thread_id = extract_thread_id(&value);
    let usage_percent = extract_compaction_usage_percent(&value);

    dispatch_workspace_stdout_value(session, event_sink, workspace_id, value).await;

    maybe_trigger_auto_compaction(
        session,
        event_sink,
        workspace_id,
        event_method.as_deref(),
        thread_id.as_deref(),
        usage_percent,
    )
    .await;

    if let Some(extra_event) = synthetic_plan_event {
        emit_workspace_event(session, event_sink, workspace_id, extra_event).await;
    }
    if let Some(extra_event) = synthetic_plan_apply_event {
        emit_workspace_event(session, event_sink, workspace_id, extra_event).await;
    }
    session
        .clear_terminal_plan_turn_state(thread_id.as_deref(), event_method.as_deref())
        .await;
}

async fn maybe_trigger_auto_compaction<E: EventSink>(
    session: &Arc<WorkspaceSession>,
    event_sink: &E,
    workspace_id: &str,
    method: Option<&str>,
    thread_id: Option<&str>,
    usage_percent: Option<f64>,
) {
    let Some(method) = method else {
        return;
    };
    let Some(thread_id) = thread_id else {
        return;
    };
    if !is_codex_thread_id(thread_id) {
        return;
    }

    let should_trigger = {
        let mut states = session.auto_compaction_thread_state.lock().await;
        let state = states.entry(thread_id.to_string()).or_default();
        evaluate_auto_compaction_state(
            state,
            method,
            usage_percent,
            session.auto_compaction_threshold_percent(),
            session.auto_compaction_enabled(),
            now_millis(),
        )
    };
    if matches!(
        method,
        "turn/started" | "thread/compacted" | "thread/compactionFailed"
    ) {
        session.notify_codex_compaction_state_changed();
    }
    if !should_trigger {
        return;
    }

    let params = json!({ "threadId": thread_id });
    match session
        .fire_and_forget_request("thread/compact/start", params)
        .await
    {
        Ok(()) => {
            emit_workspace_event(
                session,
                event_sink,
                workspace_id,
                json!({
                    "method": "thread/compacting",
                    "params": {
                        "threadId": thread_id,
                        "thread_id": thread_id,
                        "thresholdPercent": session.auto_compaction_threshold_percent(),
                        "threshold_percent": session.auto_compaction_threshold_percent(),
                        "auto": true,
                        "manual": false,
                    }
                }),
            )
            .await;
        }
        Err(error) => {
            session
                .release_codex_compaction_reservation(thread_id)
                .await;
            eprintln!(
                "[codex] auto compaction dispatch failed workspace={} thread={}: {}",
                workspace_id, thread_id, error
            );
        }
    }
}

pub(super) fn spawn_workspace_session_runtime_tasks<E: EventSink>(
    session: Arc<WorkspaceSession>,
    stdout: ChildStdout,
    stderr: ChildStderr,
    workspace_id: String,
    event_sink: E,
) {
    let stdout_session = Arc::clone(&session);
    let stdout_sink = event_sink.clone();
    let stdout_workspace_id = workspace_id.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        loop {
            let next_line = lines.next_line().await;
            let Some(line) = (match next_line {
                Ok(Some(line)) => Some(line),
                Ok(None) => {
                    let (reason_code, message, exit_code, exit_signal) =
                        runtime_end_from_stdout_close(&stdout_session).await;
                    stdout_session
                        .handle_runtime_end(
                            &stdout_sink,
                            reason_code,
                            message,
                            exit_code,
                            exit_signal,
                        )
                        .await;
                    break;
                }
                Err(error) => {
                    stdout_session
                        .handle_runtime_end(
                            &stdout_sink,
                            "stdout_read_failed",
                            format!(
                                "[RUNTIME_ENDED] Managed runtime stdout reader failed: {error}"
                            ),
                            None,
                            None,
                        )
                        .await;
                    break;
                }
            }) else {
                break;
            };
            if line.trim().is_empty() {
                continue;
            }
            let value: Value = match serde_json::from_str(&line) {
                Ok(value) => value,
                Err(err) => {
                    stdout_sink.emit_app_server_event(AppServerEvent {
                        workspace_id: stdout_workspace_id.clone(),
                        message: json!({
                                    "method": "codex/parseError",
                                    "params": { "error": err.to_string(), "raw": line },
                        }),
                    });
                    continue;
                }
            };
            process_workspace_stdout_value(
                &stdout_session,
                &stdout_sink,
                &stdout_workspace_id,
                value,
            )
            .await;
        }
    });

    let wait_session = Arc::clone(&session);
    let wait_sink = event_sink.clone();
    tokio::spawn(async move {
        loop {
            let try_wait_result = {
                let mut child = wait_session.child.lock().await;
                child.try_wait()
            };
            match try_wait_result {
                Ok(Some(status)) => {
                    let (reason_code, message, exit_code, exit_signal) =
                        runtime_end_from_process_status(&wait_session, &status);
                    wait_session
                        .handle_runtime_end(
                            &wait_sink,
                            reason_code,
                            message,
                            exit_code,
                            exit_signal,
                        )
                        .await;
                    break;
                }
                Ok(None) => {
                    tokio::time::sleep(Duration::from_millis(250)).await;
                }
                Err(error) => {
                    wait_session
                        .handle_runtime_end(
                            &wait_sink,
                            "process_wait_failed",
                            format!(
                                "[RUNTIME_ENDED] Failed to read managed runtime process status: {error}"
                            ),
                            None,
                            None,
                        )
                        .await;
                    break;
                }
            }
        }
    });

    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if should_skip_codex_stderr_line(&line) {
                continue;
            }
            event_sink.emit_app_server_event(AppServerEvent {
                workspace_id: workspace_id.clone(),
                message: json!({
                    "method": "codex/stderr",
                    "params": { "message": line },
                }),
            });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_shutdown_source_labels_are_platform_neutral() {
        let labels = [
            (
                RuntimeShutdownSource::UserManualShutdown,
                "user_manual_shutdown",
            ),
            (RuntimeShutdownSource::ManualRelease, "manual_release"),
            (
                RuntimeShutdownSource::InternalReplacement,
                "internal_replacement",
            ),
            (
                RuntimeShutdownSource::StaleReuseCleanup,
                "stale_reuse_cleanup",
            ),
            (RuntimeShutdownSource::SettingsRestart, "settings_restart"),
            (RuntimeShutdownSource::AppExit, "app_exit"),
            (RuntimeShutdownSource::IdleEviction, "idle_eviction"),
            (
                RuntimeShutdownSource::CompatibilityManual,
                "manual_shutdown",
            ),
        ];

        for (source, expected) in labels {
            assert_eq!(source.as_str(), expected);
            assert!(!source.as_str().contains("windows"));
            assert!(!source.as_str().contains("macos"));
            assert!(!source.as_str().contains("unix"));
        }
    }
}
