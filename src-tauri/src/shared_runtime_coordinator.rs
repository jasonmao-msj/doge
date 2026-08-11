//! Shared Runtime lifecycle owner。
//!
//! V2 dispatch 在产生 Runtime side effect 前注册 durable attempt。Runtime event 先进入本
//! coordinator，再进入普通 UI fan-out / throttle。这里按 attempt owner 组装 terminal
//! snapshot；frontend 只能通过 backend durable await 等待 settlement，不能提供
//! canonical assistant content，也不能把 transient UI event 当成 control authority。

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use crate::backend::events::AppServerEvent;
use crate::engine::codex_prompt_service::{
    extract_agent_message_snapshot_text, extract_codex_reasoning_delta, extract_codex_text_delta,
    extract_turn_completed_text,
};
use crate::engine::events::EngineEvent;
use crate::engine::EngineType;
use crate::shared_event_log::canonical::assembler::{
    RuntimeFinalSnapshot, RuntimeToolCall, RuntimeToolResult,
};
use crate::shared_event_log::canonical::types::{
    ArtifactRef, CanonicalBlock, CanonicalOmission, OutcomeStatus, ProviderPrivateRef,
    ToolResultStatus, TurnExecutionSnapshot,
};

const MAX_UNOWNED_EVENTS: usize = 512;
const UNCLASSIFIED_RUNTIME_FAILURE_CODE: &str = "runtime_failure_unclassified";
/// Claude CLI 的同一完整 observation 可能同时从 streaming 与 result surface 到达。
/// 只对足够长的 full observation 判重，避免吞掉正常的短 token/fragment。
const CLAUDE_FULL_OBSERVATION_MIN_CHARS: usize = 24;
#[cfg(test)]
const TEST_PROVIDER_RUNTIME_KEY: &str = "test-provider-runtime";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SharedRuntimeAttemptOwner {
    pub workspace_id: String,
    /// 实际承载本次 attempt 的 Provider-scoped Runtime identity。
    ///
    /// 同一 workspace + engine 下允许多个 Provider Runtime 并行；native
    /// session / runtime turn id 只能在该 scope 内解释。
    pub provider_runtime_key: String,
    pub shared_session_id: String,
    pub shared_thread_id: String,
    pub logical_turn_id: String,
    pub attempt_id: String,
    pub binding_key: String,
    /// Binding generation frozen by the durable `turnRequested` owner.
    pub binding_operation_id: String,
    pub engine: EngineType,
    /// `conversation.turnRequested.target` 的 durable 副本。
    ///
    /// Runtime fan-out 必须携带创建 attempt 时冻结的身份，不能在 frontend
    /// 重新读取当前 Picker 推断本轮 Provider / Model。
    pub execution_target_snapshot: TurnExecutionSnapshot,
    pub native_session_id: Option<String>,
    pub runtime_turn_id: Option<String>,
    pub context_marker: Option<SharedRuntimeContextMarker>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SharedRuntimeContextMarker {
    pub package_id: String,
    pub source_checksum: String,
}

impl SharedRuntimeContextMarker {
    fn wire_marker(&self) -> String {
        format!(
            "DOGE_CONTEXT_PACKAGE:{}:{}",
            self.package_id, self.source_checksum
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SharedRuntimeContextAck {
    pub attempt_id: String,
    pub package_id: String,
    pub source_checksum: String,
}

#[derive(Debug, Clone)]
pub(crate) enum SharedRuntimeContextWaitOutcome {
    Acknowledged(SharedRuntimeContextAck),
    Settled(SettledSharedRuntimeAttempt),
}

#[derive(Debug, Clone)]
pub(crate) struct SettledSharedRuntimeAttempt {
    pub owner: SharedRuntimeAttemptOwner,
    pub final_snapshot: RuntimeFinalSnapshot,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct SharedRuntimeObservation {
    pub owner: Option<SharedRuntimeAttemptOwner>,
    pub agent_event: Option<EngineEvent>,
    pub settled: Option<SettledSharedRuntimeAttempt>,
    /// `true` 时该 ingress 已由 Shared owner 接管并等待 replay barrier；普通
    /// Native/UI fan-out 必须跳过，durable accept 后由 drain 唯一发出。
    pub ui_fanout_deferred: bool,
    /// 区分“等待 exact owner identity”与“已绑定但等待 replay barrier”。
    pub ui_fanout_defer_reason: Option<SharedRuntimeUiFanoutDeferReason>,
    /// 当前 defer queue 深度，只用于 content-safe attribution。
    pub deferred_queue_depth: usize,
    /// coordinator 生命周期内因 unowned queue 满而丢弃的累计事件数。
    pub unowned_overflow_drop_count: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SharedRuntimeUiFanoutDeferReason {
    AwaitingOwnerIdentity,
    ReplayBarrier,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct SharedRuntimeCoordinator {
    inner: Arc<Mutex<CoordinatorState>>,
}

#[derive(Debug, Default)]
struct CoordinatorState {
    attempts: HashMap<String, AttemptAccumulator>,
    attempt_by_runtime_turn: HashMap<RuntimeIdentityKey, String>,
    attempt_by_native_session: HashMap<RuntimeIdentityKey, String>,
    settled_by_attempt: HashMap<String, SettledSharedRuntimeAttempt>,
    replay_barriers: HashMap<String, ReplayBarrier>,
    held_attempt_by_native_session: HashMap<RuntimeIdentityKey, String>,
    held_provisioning_attempts_by_runtime: HashMap<RuntimeScopeKey, HashSet<String>>,
    unowned_events: VecDeque<RuntimeIngress>,
    unowned_overflow_drop_count: u64,
}

#[derive(Debug, Default)]
struct ReplayBarrier {
    pending: VecDeque<RuntimeIngress>,
    native_releases: VecDeque<AppServerEvent>,
}

#[derive(Debug, Clone)]
pub(crate) struct SharedRuntimeReplayDelivery {
    pub observation: SharedRuntimeObservation,
    pub app_server_events: Vec<AppServerEvent>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct SharedRuntimeReplayBatch {
    pub deliveries: Vec<SharedRuntimeReplayDelivery>,
    pub native_app_server_events: Vec<AppServerEvent>,
    /// `true` 表示 barrier 已在 coordinator lock 内原子关闭；此后 ingress
    /// 可以直接进入正常 observation / UI fan-out。
    pub barrier_cleared: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct RuntimeIdentityKey {
    workspace_id: String,
    engine: EngineType,
    provider_runtime_key: String,
    identity: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct RuntimeScopeKey {
    workspace_id: String,
    engine: EngineType,
    provider_runtime_key: String,
}

#[derive(Debug)]
struct AttemptAccumulator {
    owner: SharedRuntimeAttemptOwner,
    assistant_blocks: Vec<CanonicalBlock>,
    tool_calls: Vec<RuntimeToolCall>,
    tool_results: Vec<RuntimeToolResult>,
    tool_output_deltas: HashMap<String, String>,
    artifacts: Vec<ArtifactRef>,
    provider_private_refs: Vec<ProviderPrivateRef>,
    omissions: Vec<CanonicalOmission>,
    context_ack: Option<SharedRuntimeContextAck>,
    context_ack_notify: Arc<tokio::sync::Notify>,
    settlement_notify: Arc<tokio::sync::Notify>,
    cancel_intent: bool,
    settled: bool,
}

#[derive(Debug, Clone)]
struct RuntimeIngress {
    workspace_id: String,
    engine: EngineType,
    provider_runtime_key: String,
    runtime_turn_id: Option<String>,
    native_session_id: Option<String>,
    is_session_started: bool,
    actions: Vec<AccumulatorAction>,
    agent_event: Option<EngineEvent>,
    replay_app_server_events: Vec<AppServerEvent>,
}

#[derive(Debug, Clone)]
enum AccumulatorAction {
    AssistantDelta(String),
    AssistantSnapshot(String),
    ReasoningDelta(String),
    ToolStarted {
        tool_id: String,
        tool_name: String,
        input: Option<Value>,
    },
    ToolInputUpdated {
        tool_id: String,
        tool_name: Option<String>,
        input: Option<Value>,
    },
    ToolOutputDelta {
        tool_id: String,
        delta: String,
    },
    ToolCompleted {
        tool_id: String,
        tool_name: Option<String>,
        output: Option<Value>,
        error: Option<String>,
    },
    Artifacts(Vec<ArtifactRef>),
    ContextEcho(String),
    Terminal(TerminalEvidence),
}

#[derive(Debug, Clone)]
struct TerminalEvidence {
    outcome: OutcomeStatus,
    error_code: Option<String>,
    error_message: Option<String>,
    stop_reason: Option<String>,
    fallback_text: Option<String>,
    artifacts: Vec<ArtifactRef>,
    provider_private_refs: Vec<ProviderPrivateRef>,
    omissions: Vec<CanonicalOmission>,
}

impl AttemptAccumulator {
    fn new(owner: SharedRuntimeAttemptOwner) -> Self {
        Self {
            owner,
            assistant_blocks: Vec::new(),
            tool_calls: Vec::new(),
            tool_results: Vec::new(),
            tool_output_deltas: HashMap::new(),
            artifacts: Vec::new(),
            provider_private_refs: Vec::new(),
            omissions: Vec::new(),
            context_ack: None,
            context_ack_notify: Arc::new(tokio::sync::Notify::new()),
            settlement_notify: Arc::new(tokio::sync::Notify::new()),
            cancel_intent: false,
            settled: false,
        }
    }

    fn apply(&mut self, action: AccumulatorAction) -> Option<SettledSharedRuntimeAttempt> {
        if self.settled {
            return None;
        }
        match action {
            AccumulatorAction::AssistantDelta(text) => {
                self.merge_runtime_observation(CanonicalBlock::Text { text });
            }
            AccumulatorAction::AssistantSnapshot(text) => {
                self.merge_complete_assistant_text(text);
            }
            AccumulatorAction::ReasoningDelta(text) => {
                self.merge_runtime_observation(CanonicalBlock::Reasoning { text });
            }
            AccumulatorAction::ToolStarted {
                tool_id,
                tool_name,
                input,
            } => self.upsert_tool_call(tool_id, Some(tool_name), input),
            AccumulatorAction::ToolInputUpdated {
                tool_id,
                tool_name,
                input,
            } => self.upsert_tool_call(tool_id, tool_name, input),
            AccumulatorAction::ToolOutputDelta { tool_id, delta } => {
                self.tool_output_deltas
                    .entry(tool_id)
                    .or_default()
                    .push_str(&delta);
            }
            AccumulatorAction::ToolCompleted {
                tool_id,
                tool_name,
                output,
                error,
            } => {
                self.upsert_tool_call(tool_id.clone(), tool_name, None);
                let output_summary = output
                    .as_ref()
                    .map(stringify_json_value)
                    .filter(|text| !text.is_empty())
                    .or_else(|| self.tool_output_deltas.remove(&tool_id));
                let status = if error.is_some() {
                    ToolResultStatus::Error
                } else {
                    ToolResultStatus::Completed
                };
                upsert_tool_result(
                    &mut self.tool_results,
                    RuntimeToolResult {
                        tool_call_id: tool_id,
                        status,
                        output_summary,
                        error_message: error,
                    },
                );
                if let Some(output) = output.as_ref() {
                    extend_unique_artifacts(
                        &mut self.artifacts,
                        extract_explicit_artifact_refs(output),
                    );
                }
            }
            AccumulatorAction::Artifacts(artifacts) => {
                extend_unique_artifacts(&mut self.artifacts, artifacts);
            }
            AccumulatorAction::ContextEcho(echo) => {
                if self.context_ack.is_none() {
                    if let Some(marker) = self.owner.context_marker.as_ref() {
                        if echo.contains(&marker.wire_marker()) {
                            self.context_ack = Some(SharedRuntimeContextAck {
                                attempt_id: self.owner.attempt_id.clone(),
                                package_id: marker.package_id.clone(),
                                source_checksum: marker.source_checksum.clone(),
                            });
                            self.context_ack_notify.notify_one();
                        }
                    }
                }
            }
            AccumulatorAction::Terminal(mut evidence) => {
                // Runtime 通常把用户 interrupt 表达为 TurnError。control plane
                // 已确认发送 cancel intent 后，这类 terminal 属于 Cancelled，
                // 不能再伪装成 Provider failure。
                if self.cancel_intent && evidence.outcome == OutcomeStatus::Failed {
                    evidence.outcome = OutcomeStatus::Cancelled;
                    evidence
                        .stop_reason
                        .get_or_insert_with(|| "interrupted".to_string());
                }
                // Canonical failed outcome 强制要求 errorCode。部分 Runtime 只返回
                // status/message；在 lifecycle owner 的唯一收敛点补齐稳定 fallback，
                // 同时保留 Provider 提供的真实 code。
                if evidence.outcome == OutcomeStatus::Failed
                    && evidence
                        .error_code
                        .as_ref()
                        .is_none_or(|code| code.trim().is_empty())
                {
                    evidence.error_code = Some(UNCLASSIFIED_RUNTIME_FAILURE_CODE.to_string());
                }
                if let Some(text) = evidence
                    .fallback_text
                    .filter(|text| !text.trim().is_empty())
                {
                    self.merge_complete_assistant_text(text);
                }
                extend_unique_artifacts(&mut self.artifacts, evidence.artifacts);
                extend_unique_private_refs(
                    &mut self.provider_private_refs,
                    evidence.provider_private_refs,
                );
                extend_unique_omissions(&mut self.omissions, evidence.omissions);
                self.settled = true;
                let settled = SettledSharedRuntimeAttempt {
                    owner: self.owner.clone(),
                    final_snapshot: RuntimeFinalSnapshot {
                        assistant_blocks: std::mem::take(&mut self.assistant_blocks),
                        assistant_text: None,
                        tool_calls: std::mem::take(&mut self.tool_calls),
                        tool_results: std::mem::take(&mut self.tool_results),
                        artifacts: std::mem::take(&mut self.artifacts),
                        provider_private_refs: std::mem::take(&mut self.provider_private_refs),
                        omissions: std::mem::take(&mut self.omissions),
                        outcome: evidence.outcome,
                        error_code: evidence.error_code,
                        error_message: evidence.error_message,
                        stop_reason: evidence.stop_reason,
                    },
                };
                // 同一 Attempt 可能同时存在旧 observer 与 recovery reattachment。
                // waiter 会先注册再复查 state，因此这里安全唤醒全部 observer。
                self.settlement_notify.notify_waiters();
                return Some(settled);
            }
        }
        None
    }

    fn merge_runtime_observation(&mut self, next: CanonicalBlock) {
        if self.owner.engine == EngineType::Claude {
            merge_claude_full_observation(&mut self.assistant_blocks, next);
        } else {
            push_assistant_block(&mut self.assistant_blocks, next);
        }
    }

    fn merge_complete_assistant_text(&mut self, complete_text: String) {
        if self.owner.engine == EngineType::Claude {
            merge_claude_complete_assistant_text(&mut self.assistant_blocks, complete_text);
        } else {
            merge_complete_assistant_text(&mut self.assistant_blocks, complete_text);
        }
    }

    fn upsert_tool_call(
        &mut self,
        tool_id: String,
        tool_name: Option<String>,
        input: Option<Value>,
    ) {
        let arguments_summary = input
            .as_ref()
            .map(stringify_json_value)
            .filter(|text| !text.is_empty());
        if let Some(existing) = self
            .tool_calls
            .iter_mut()
            .find(|call| call.tool_call_id == tool_id)
        {
            if let Some(tool_name) = tool_name.filter(|name| !name.trim().is_empty()) {
                existing.tool_name = tool_name;
            }
            if let Some(incoming) = arguments_summary {
                existing.arguments_summary = Some(merge_tool_arguments_summary(
                    existing.arguments_summary.as_deref(),
                    &incoming,
                ));
            }
            return;
        }
        self.tool_calls.push(RuntimeToolCall {
            tool_call_id: tool_id.clone(),
            tool_name: tool_name
                .filter(|name| !name.trim().is_empty())
                .unwrap_or(tool_id),
            arguments_summary,
        });
    }
}

impl SharedRuntimeCoordinator {
    pub(crate) fn register_attempt(
        &self,
        mut owner: SharedRuntimeAttemptOwner,
    ) -> Result<Option<SettledSharedRuntimeAttempt>, String> {
        if owner.native_session_id.is_some() {
            owner.native_session_id =
                normalize_native_session_identity(owner.engine, owner.native_session_id.as_deref());
            if owner.native_session_id.is_none() {
                return Err("shared runtime native session identity is empty".to_string());
            }
        }
        validate_owner(&owner)?;
        let mut state = self.lock();
        if let Some(existing) = state.attempts.get(&owner.attempt_id) {
            if !same_durable_owner(&existing.owner, &owner) {
                return Err(format!(
                    "shared runtime attempt owner mismatch: {}",
                    owner.attempt_id
                ));
            }
        } else {
            state.attempts.insert(
                owner.attempt_id.clone(),
                AttemptAccumulator::new(owner.clone()),
            );
        }
        state.update_owner_identities(&owner.attempt_id, &owner)?;
        // Runtime send 尚未返回 exact identity 时不能消费 unowned events。
        // 唯一 replay handoff 在 bind_runtime_turn 中开启 barrier。
        Ok(None)
    }

    /// 绑定 exact runtime identity，并在同一 coordinator lock 内开启 replay
    /// barrier、搬运此前 unowned ingress。直到 `drain_replay_barrier` 原子清除
    /// barrier，后续同 owner 的可见 ingress 也只会排队，不会越过早到事件。
    pub(crate) fn bind_runtime_turn(
        &self,
        attempt_id: &str,
        runtime_turn_id: Option<&str>,
        native_session_id: Option<&str>,
    ) -> Result<Option<SettledSharedRuntimeAttempt>, String> {
        let mut state = self.lock();
        let owner = {
            let attempt = state
                .attempts
                .get_mut(attempt_id)
                .ok_or_else(|| format!("shared runtime attempt not registered: {attempt_id}"))?;
            if let Some(runtime_turn_id) = normalize_identity(runtime_turn_id) {
                if let Some(existing) = attempt.owner.runtime_turn_id.as_deref() {
                    if existing != runtime_turn_id {
                        return Err(format!(
                            "shared runtime turn identity mismatch for attempt {attempt_id}"
                        ));
                    }
                } else {
                    attempt.owner.runtime_turn_id = Some(runtime_turn_id.to_string());
                }
            }
            if let Some(native_session_id) =
                normalize_native_session_identity(attempt.owner.engine, native_session_id)
            {
                attempt.owner.native_session_id = Some(native_session_id);
            }
            attempt.owner.clone()
        };
        state.update_owner_identities(attempt_id, &owner)?;
        state.open_replay_barrier(attempt_id)?;
        Ok(None)
    }

    /// 在 actual Runtime side effect 前登记本次 attempt 将使用的 Native Binding。
    /// 这里只决定早到 UI event 的 hold，不赋予 canonical owner：带 runtimeTurnId
    /// 的 ingress 仍必须等 exact `bind_runtime_turn` 才能归属，避免复用 Binding
    /// 上一轮的迟到 terminal 被错配到新 attempt。
    pub(crate) fn hold_native_session(
        &self,
        attempt_id: &str,
        native_session_id: &str,
    ) -> Result<(), String> {
        let mut state = self.lock();
        let attempt = state
            .attempts
            .get(attempt_id)
            .ok_or_else(|| format!("shared runtime attempt not registered: {attempt_id}"))?;
        let native_session_id =
            normalize_native_session_identity(attempt.owner.engine, Some(native_session_id))
                .ok_or_else(|| "shared runtime native session identity is empty".to_string())?;
        let key = RuntimeIdentityKey {
            workspace_id: attempt.owner.workspace_id.clone(),
            engine: attempt.owner.engine,
            provider_runtime_key: attempt.owner.provider_runtime_key.clone(),
            identity: native_session_id.clone(),
        };
        if let Some(existing) = state.held_attempt_by_native_session.get(&key) {
            if existing != attempt_id {
                return Err(format!(
                    "shared runtime native session hold conflict: {native_session_id}"
                ));
            }
        }
        state
            .held_attempt_by_native_session
            .insert(key, attempt_id.to_string());
        Ok(())
    }

    /// Codex `thread/start` 在 response 返回 exact thread id 前可能先发
    /// `thread/started`。仅在同 workspace/engine/provider scope 暂存该启动事件，
    /// 防止隐藏 Shared Binding 先进入普通 Session catalog。
    pub(crate) fn hold_native_provisioning(&self, attempt_id: &str) -> Result<(), String> {
        let mut state = self.lock();
        let attempt = state
            .attempts
            .get(attempt_id)
            .ok_or_else(|| format!("shared runtime attempt not registered: {attempt_id}"))?;
        if attempt.owner.engine != EngineType::Codex {
            return Err("native provisioning hold is only valid for Codex".to_string());
        }
        let scope = runtime_scope_key(&attempt.owner);
        state
            .held_provisioning_attempts_by_runtime
            .entry(scope)
            .or_default()
            .insert(attempt_id.to_string());
        Ok(())
    }

    /// exact native identity 已知后撤销 provider-scoped hold。当前 Attempt 的
    /// `thread/started` 仍由 native-session hold 保护；同 scope 的非目标启动事件
    /// 返回调用方，按原 Native 路径继续 fan-out。
    pub(crate) fn finish_native_provisioning(
        &self,
        attempt_id: &str,
    ) -> Result<Vec<AppServerEvent>, String> {
        let mut state = self.lock();
        let attempt = state
            .attempts
            .get(attempt_id)
            .ok_or_else(|| format!("shared runtime attempt not registered: {attempt_id}"))?;
        let scope = runtime_scope_key(&attempt.owner);
        state.remove_provisioning_hold(attempt_id);

        let mut remaining = VecDeque::new();
        let mut native_releases = Vec::new();
        while let Some(ingress) = state.unowned_events.pop_front() {
            let is_unheld_start_in_scope = ingress.is_session_started
                && runtime_scope_key_for_ingress(&ingress) == scope
                && !state.is_exact_native_held_ingress(&ingress)
                && !state.is_provisioning_held_ingress(&ingress);
            if is_unheld_start_in_scope {
                native_releases.extend(ingress.replay_app_server_events);
            } else {
                remaining.push_back(ingress);
            }
        }
        state.unowned_events = remaining;
        Ok(native_releases)
    }

    pub(crate) fn ingest_codex_event_scoped(
        &self,
        provider_runtime_key: &str,
        workspace_id: &str,
        event: &Value,
    ) -> SharedRuntimeObservation {
        self.ingest(normalize_codex_ingress(
            provider_runtime_key,
            workspace_id,
            event,
        ))
    }

    pub(crate) fn ingest_engine_event_scoped(
        &self,
        provider_runtime_key: &str,
        engine: EngineType,
        runtime_turn_id: Option<&str>,
        native_session_id: Option<&str>,
        event: &EngineEvent,
    ) -> SharedRuntimeObservation {
        self.ingest_engine_event_with_replay_scoped(
            provider_runtime_key,
            engine,
            runtime_turn_id,
            native_session_id,
            event,
            Vec::new(),
        )
    }

    pub(crate) fn ingest_engine_event_with_replay_scoped(
        &self,
        provider_runtime_key: &str,
        engine: EngineType,
        runtime_turn_id: Option<&str>,
        native_session_id: Option<&str>,
        event: &EngineEvent,
        replay_app_server_events: Vec<AppServerEvent>,
    ) -> SharedRuntimeObservation {
        let mut ingress = normalize_engine_ingress(
            provider_runtime_key,
            engine,
            runtime_turn_id,
            native_session_id,
            event,
        );
        ingress.replay_app_server_events = replay_app_server_events;
        self.ingest(ingress)
    }

    #[cfg(test)]
    fn ingest_codex_event(&self, workspace_id: &str, event: &Value) -> SharedRuntimeObservation {
        self.ingest_codex_event_scoped(TEST_PROVIDER_RUNTIME_KEY, workspace_id, event)
    }

    #[cfg(test)]
    fn ingest_engine_event(
        &self,
        engine: EngineType,
        runtime_turn_id: Option<&str>,
        native_session_id: Option<&str>,
        event: &EngineEvent,
    ) -> SharedRuntimeObservation {
        self.ingest_engine_event_scoped(
            TEST_PROVIDER_RUNTIME_KEY,
            engine,
            runtime_turn_id,
            native_session_id,
            event,
        )
    }

    /// 每次取出 bind barrier 当前已有的 ordered batch。非空 batch 返回后仍保持
    /// barrier；调用方必须先逐事件 publish observation + emit projected UI event，
    /// 再继续 drain。仅当一次 drain 在 lock 内观察到空队列时才原子清 barrier。
    pub(crate) fn drain_replay_barrier(
        &self,
        attempt_id: &str,
    ) -> Result<SharedRuntimeReplayBatch, String> {
        self.lock().drain_replay_barrier(attempt_id)
    }

    /// interrupt 必须先登记 attempt-owned intent，再触发 Runtime side effect，
    /// 防止同步返回的 TurnError 抢先按 Failed 结算。
    pub(crate) fn mark_cancel_intent(&self, attempt_id: &str) -> Result<(), String> {
        let mut state = self.lock();
        let attempt = state
            .attempts
            .get_mut(attempt_id)
            .ok_or_else(|| format!("shared runtime attempt not registered: {attempt_id}"))?;
        if attempt.settled {
            return Err(format!(
                "shared runtime attempt already settled: {attempt_id}"
            ));
        }
        attempt.cancel_intent = true;
        Ok(())
    }

    pub(crate) fn clear_cancel_intent(&self, attempt_id: &str) {
        if let Some(attempt) = self.lock().attempts.get_mut(attempt_id) {
            attempt.cancel_intent = false;
        }
    }

    /// 非破坏读取 canonical settlement。调用方必须只在 durable commit 成功后
    /// `remove_attempt`；commit 失败时 cache 留存，供 recovery/probe 重试。
    pub(crate) fn settled_for_attempt(
        &self,
        attempt_id: &str,
    ) -> Option<SettledSharedRuntimeAttempt> {
        self.lock().settled_by_attempt.get(attempt_id).cloned()
    }

    pub(crate) fn owns_attempt(&self, attempt_id: &str) -> bool {
        self.lock().attempts.contains_key(attempt_id)
    }

    pub(crate) fn owner_for_attempt(&self, attempt_id: &str) -> Option<SharedRuntimeAttemptOwner> {
        self.lock()
            .attempts
            .get(attempt_id)
            .map(|attempt| attempt.owner.clone())
    }

    /// 等待 exact Attempt 的 authoritative Runtime settlement。
    ///
    /// 返回 `None` 表示 coordinator owner 已被其他 critical sink 清理；调用方必须
    /// 立即复查 durable `conversation.turnCommitted`，不能把 owner removal 当失败。
    pub(crate) async fn wait_for_settlement(
        &self,
        attempt_id: &str,
    ) -> Option<SettledSharedRuntimeAttempt> {
        loop {
            let notify = {
                let state = self.lock();
                if let Some(settled) = state.settled_by_attempt.get(attempt_id) {
                    return Some(settled.clone());
                }
                let Some(attempt) = state.attempts.get(attempt_id) else {
                    return None;
                };
                Arc::clone(&attempt.settlement_notify)
            };
            let notified = notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            {
                // 注册 waiter 后复查，封闭「首次检查 → notified().await」之间的
                // terminal/remove race；同时允许 notify_waiters 唤醒所有重挂 observer。
                let state = self.lock();
                if let Some(settled) = state.settled_by_attempt.get(attempt_id) {
                    return Some(settled.clone());
                }
                if !state.attempts.contains_key(attempt_id) {
                    return None;
                }
            }
            notified.await;
        }
    }

    pub(crate) async fn wait_for_context_ack(
        &self,
        attempt_id: &str,
        timeout: std::time::Duration,
    ) -> Result<SharedRuntimeContextAck, String> {
        match self
            .wait_for_context_ack_or_settlement(attempt_id, timeout)
            .await?
        {
            SharedRuntimeContextWaitOutcome::Acknowledged(ack) => Ok(ack),
            SharedRuntimeContextWaitOutcome::Settled(_) => Err(format!(
                "shared runtime attempt settled before context ACK: {attempt_id}"
            )),
        }
    }

    pub(crate) async fn wait_for_context_ack_or_settlement(
        &self,
        attempt_id: &str,
        timeout: std::time::Duration,
    ) -> Result<SharedRuntimeContextWaitOutcome, String> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let notify = {
                let mut state = self.lock();
                let attempt = state.attempts.get(attempt_id).ok_or_else(|| {
                    format!("shared runtime attempt not registered: {attempt_id}")
                })?;
                if let Some(ack) = attempt.context_ack.as_ref() {
                    return Ok(SharedRuntimeContextWaitOutcome::Acknowledged(ack.clone()));
                }
                if state.replay_barrier_has_terminal(attempt_id) {
                    // Terminal before Context ACK is authoritative. Apply the entire
                    // held ingress queue in order, but do not expose its UI events:
                    // caller commits canonical terminal and returns the typed error.
                    loop {
                        let batch = state.drain_replay_barrier(attempt_id)?;
                        if batch.barrier_cleared {
                            break;
                        }
                    }
                    let settled = state
                        .settled_by_attempt
                        .get(attempt_id)
                        .cloned()
                        .ok_or_else(|| {
                            format!(
                                "shared runtime terminal barrier did not settle attempt {attempt_id}"
                            )
                        })?;
                    return Ok(SharedRuntimeContextWaitOutcome::Settled(settled));
                }
                Arc::clone(
                    &state
                        .attempts
                        .get(attempt_id)
                        .expect("attempt checked above")
                        .context_ack_notify,
                )
            };
            tokio::time::timeout_at(deadline, notify.notified())
                .await
                .map_err(|_| {
                    format!(
                        "ambiguous-runtime: timed out waiting for Claude context echo ACK for attempt {attempt_id}"
                    )
                })?;
        }
    }

    pub(crate) fn take_context_ack(&self, attempt_id: &str) -> Option<SharedRuntimeContextAck> {
        self.lock()
            .attempts
            .get_mut(attempt_id)
            .and_then(|attempt| attempt.context_ack.take())
    }

    pub(crate) fn remove_attempt(&self, attempt_id: &str) {
        let mut state = self.lock();
        if let Some(attempt) = state.attempts.get(attempt_id) {
            // critical sink 可能先 commit SQL 再清理 coordinator。唤醒 backend
            // waiter，让它从 durable fact 完成收敛。
            attempt.settlement_notify.notify_waiters();
        }
        let removed_scope = state
            .attempts
            .get(attempt_id)
            .map(|attempt| runtime_scope_key(&attempt.owner));
        let removed_native_keys = state
            .held_attempt_by_native_session
            .iter()
            .filter_map(|(key, mapped_attempt_id)| {
                (mapped_attempt_id == attempt_id).then_some(key.clone())
            })
            .collect::<HashSet<_>>();
        state.attempts.remove(attempt_id);
        state.settled_by_attempt.remove(attempt_id);
        state.replay_barriers.remove(attempt_id);
        state
            .held_attempt_by_native_session
            .retain(|_, mapped_attempt_id| mapped_attempt_id != attempt_id);
        state
            .attempt_by_runtime_turn
            .retain(|_, mapped_attempt_id| mapped_attempt_id != attempt_id);
        state
            .attempt_by_native_session
            .retain(|_, mapped_attempt_id| mapped_attempt_id != attempt_id);
        state.remove_provisioning_hold(attempt_id);
        let remaining_provisioning_scopes = state
            .held_provisioning_attempts_by_runtime
            .keys()
            .cloned()
            .collect::<HashSet<_>>();
        state.unowned_events.retain(|ingress| {
            let removed_exact_event = native_identity_key_for_ingress(ingress)
                .is_some_and(|key| removed_native_keys.contains(&key));
            let removed_orphan_start = ingress.is_session_started
                && removed_scope.as_ref().is_some_and(|scope| {
                    runtime_scope_key_for_ingress(ingress) == scope.clone()
                        && !remaining_provisioning_scopes.contains(scope)
                });
            !removed_exact_event && !removed_orphan_start
        });
    }

    fn ingest(&self, ingress: RuntimeIngress) -> SharedRuntimeObservation {
        let mut state = self.lock();
        state.ingest_or_buffer(ingress)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, CoordinatorState> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl CoordinatorState {
    fn remove_provisioning_hold(&mut self, attempt_id: &str) {
        self.held_provisioning_attempts_by_runtime
            .retain(|_, attempt_ids| {
                attempt_ids.remove(attempt_id);
                !attempt_ids.is_empty()
            });
    }

    fn update_owner_identities(
        &mut self,
        attempt_id: &str,
        owner: &SharedRuntimeAttemptOwner,
    ) -> Result<(), String> {
        if let Some(runtime_turn_id) = owner.runtime_turn_id.as_deref() {
            insert_identity_owner(
                &mut self.attempt_by_runtime_turn,
                identity_key(owner, runtime_turn_id),
                attempt_id,
            )?;
        }
        if let Some(native_session_id) = owner.native_session_id.as_deref() {
            // Native Binding is reused sequentially. The latest active attempt owns
            // fallback routing; exact runtime identity still wins for older events.
            self.attempt_by_native_session.insert(
                identity_key(owner, native_session_id),
                attempt_id.to_string(),
            );
        }
        Ok(())
    }

    fn ingest_or_buffer(&mut self, ingress: RuntimeIngress) -> SharedRuntimeObservation {
        let Some(attempt_id) = self.resolve_attempt_id(&ingress) else {
            if !self.is_held_shared_ingress(&ingress) {
                return SharedRuntimeObservation::default();
            }
            let first_deferred_event = self.unowned_events.is_empty();
            let overflowed = self.unowned_events.len() >= MAX_UNOWNED_EVENTS;
            if overflowed {
                self.unowned_events.pop_front();
                self.unowned_overflow_drop_count =
                    self.unowned_overflow_drop_count.saturating_add(1);
            }
            let observation = SharedRuntimeObservation {
                ui_fanout_deferred: true,
                ui_fanout_defer_reason: Some(
                    SharedRuntimeUiFanoutDeferReason::AwaitingOwnerIdentity,
                ),
                deferred_queue_depth: self.unowned_events.len() + 1,
                unowned_overflow_drop_count: self.unowned_overflow_drop_count,
                ..SharedRuntimeObservation::default()
            };
            if first_deferred_event {
                log::debug!(
                    "[shared-runtime] UI fan-out deferred reason={:?} workspace_id={} engine={:?} provider_runtime_key={} queue_depth={}",
                    observation.ui_fanout_defer_reason,
                    ingress.workspace_id,
                    ingress.engine,
                    ingress.provider_runtime_key,
                    observation.deferred_queue_depth
                );
            }
            if overflowed
                && (observation.unowned_overflow_drop_count == 1
                    || observation.unowned_overflow_drop_count.is_power_of_two())
            {
                log::warn!(
                    "[shared-runtime] unowned ingress overflow workspace_id={} engine={:?} provider_runtime_key={} queue_depth={} queue_limit={} dropped_total={}",
                    ingress.workspace_id,
                    ingress.engine,
                    ingress.provider_runtime_key,
                    observation.deferred_queue_depth,
                    MAX_UNOWNED_EVENTS,
                    observation.unowned_overflow_drop_count
                );
            }
            self.unowned_events.push_back(ingress);
            return observation;
        };
        if self.replay_barriers.contains_key(&attempt_id) {
            self.queue_behind_replay_barrier(&attempt_id, ingress);
            return SharedRuntimeObservation {
                ui_fanout_deferred: true,
                ui_fanout_defer_reason: Some(SharedRuntimeUiFanoutDeferReason::ReplayBarrier),
                deferred_queue_depth: self
                    .replay_barriers
                    .get(&attempt_id)
                    .map_or(0, |barrier| barrier.pending.len()),
                unowned_overflow_drop_count: self.unowned_overflow_drop_count,
                ..SharedRuntimeObservation::default()
            };
        }
        self.apply_ingress(&attempt_id, ingress)
    }

    fn is_exact_native_held_ingress(&self, ingress: &RuntimeIngress) -> bool {
        let Some(key) = native_identity_key_for_ingress(ingress) else {
            return false;
        };
        self.held_attempt_by_native_session
            .get(&key)
            .is_some_and(|attempt_id| self.attempts.contains_key(attempt_id))
    }

    fn is_provisioning_held_ingress(&self, ingress: &RuntimeIngress) -> bool {
        ingress.is_session_started
            && self
                .held_provisioning_attempts_by_runtime
                .get(&runtime_scope_key_for_ingress(ingress))
                .is_some_and(|attempt_ids| {
                    attempt_ids
                        .iter()
                        .any(|attempt_id| self.attempts.contains_key(attempt_id))
                })
    }

    fn is_held_shared_ingress(&self, ingress: &RuntimeIngress) -> bool {
        self.is_exact_native_held_ingress(ingress) || self.is_provisioning_held_ingress(ingress)
    }

    fn resolve_attempt_id(&self, ingress: &RuntimeIngress) -> Option<String> {
        if let Some(runtime_turn_id) = ingress.runtime_turn_id.as_deref() {
            let key = RuntimeIdentityKey {
                workspace_id: ingress.workspace_id.clone(),
                engine: ingress.engine,
                provider_runtime_key: ingress.provider_runtime_key.clone(),
                identity: runtime_turn_id.to_string(),
            };
            if let Some(attempt_id) = self.attempt_by_runtime_turn.get(&key) {
                return Some(attempt_id.clone());
            }
        }

        let native_session_id = ingress.native_session_id.as_deref()?;
        let native_key = RuntimeIdentityKey {
            workspace_id: ingress.workspace_id.clone(),
            engine: ingress.engine,
            provider_runtime_key: ingress.provider_runtime_key.clone(),
            identity: native_session_id.to_string(),
        };
        let attempt_id = self.attempt_by_native_session.get(&native_key)?;
        let attempt = self.attempts.get(attempt_id)?;
        // D8：双方都有 runtimeTurnId 时只能 exact match。Thread/native fallback 只在
        // 任一侧缺 runtime identity 时启用。
        if ingress.runtime_turn_id.is_some() && attempt.owner.runtime_turn_id.is_some() {
            return None;
        }
        Some(attempt_id.clone())
    }

    fn apply_ingress(
        &mut self,
        attempt_id: &str,
        ingress: RuntimeIngress,
    ) -> SharedRuntimeObservation {
        let owner = {
            let attempt = match self.attempts.get_mut(attempt_id) {
                Some(attempt) => attempt,
                None => return SharedRuntimeObservation::default(),
            };
            if attempt.owner.runtime_turn_id.is_none() {
                attempt.owner.runtime_turn_id = ingress.runtime_turn_id.clone();
            }
            if let Some(native_session_id) = ingress.native_session_id.as_deref() {
                attempt.owner.native_session_id = Some(native_session_id.to_string());
            }
            attempt.owner.clone()
        };
        let _ = self.update_owner_identities(attempt_id, &owner);

        let mut settled = None;
        if let Some(attempt) = self.attempts.get_mut(attempt_id) {
            for action in ingress.actions {
                if let Some(completed) = attempt.apply(action) {
                    settled = Some(completed);
                    break;
                }
            }
        }
        if let Some(completed) = settled.as_ref() {
            self.settled_by_attempt
                .entry(attempt_id.to_string())
                .or_insert_with(|| completed.clone());
        }
        SharedRuntimeObservation {
            owner: Some(owner),
            agent_event: ingress.agent_event,
            settled,
            ui_fanout_deferred: false,
            ui_fanout_defer_reason: None,
            deferred_queue_depth: 0,
            unowned_overflow_drop_count: self.unowned_overflow_drop_count,
        }
    }

    fn open_replay_barrier(&mut self, attempt_id: &str) -> Result<(), String> {
        if !self.attempts.contains_key(attempt_id) {
            return Err(format!(
                "shared runtime attempt not registered: {attempt_id}"
            ));
        }
        self.replay_barriers
            .entry(attempt_id.to_string())
            .or_default();
        self.remove_provisioning_hold(attempt_id);

        let mut remaining = VecDeque::new();
        let mut owned = VecDeque::new();
        let mut native_releases = VecDeque::new();
        while let Some(ingress) = self.unowned_events.pop_front() {
            match self.resolve_attempt_id(&ingress) {
                Some(ref resolved_attempt_id) if resolved_attempt_id == attempt_id => {
                    owned.push_back(ingress);
                }
                _ if self.is_provisioning_held_ingress(&ingress) => {
                    remaining.push_back(ingress);
                }
                _ if self.is_exact_native_held_ingress(&ingress) || ingress.is_session_started => {
                    native_releases.extend(ingress.replay_app_server_events);
                }
                _ => remaining.push_back(ingress),
            }
        }
        self.unowned_events = remaining;
        if let Some(barrier) = self.replay_barriers.get_mut(attempt_id) {
            barrier.native_releases.extend(native_releases);
        }
        for ingress in owned {
            self.queue_behind_replay_barrier(attempt_id, ingress);
        }
        self.held_attempt_by_native_session
            .retain(|_, mapped_attempt_id| mapped_attempt_id != attempt_id);
        Ok(())
    }

    fn queue_behind_replay_barrier(&mut self, attempt_id: &str, mut ingress: RuntimeIngress) {
        // Claude replay echo 是 transport ACK。durable accept 会等待它，因此不能
        // 被可见事件 barrier 阻塞；只把剩余可见 actions 保持原顺序排队。
        let mut deferred_actions = Vec::with_capacity(ingress.actions.len());
        let mut terminal_deferred = false;
        if let Some(attempt) = self.attempts.get_mut(attempt_id) {
            for action in ingress.actions.drain(..) {
                match action {
                    AccumulatorAction::ContextEcho(_) => {
                        let _ = attempt.apply(action);
                    }
                    _ => {
                        terminal_deferred |= matches!(&action, AccumulatorAction::Terminal(_));
                        deferred_actions.push(action);
                    }
                }
            }
            if terminal_deferred {
                attempt.context_ack_notify.notify_one();
            }
        }
        ingress.actions = deferred_actions;
        if ingress.actions.is_empty()
            && ingress.agent_event.is_none()
            && ingress.replay_app_server_events.is_empty()
        {
            return;
        }
        if let Some(barrier) = self.replay_barriers.get_mut(attempt_id) {
            let first_deferred_event = barrier.pending.is_empty();
            barrier.pending.push_back(ingress);
            if first_deferred_event {
                log::debug!(
                    "[shared-runtime] UI fan-out deferred reason=replay-barrier attempt_id={} queue_depth=1",
                    attempt_id
                );
            }
        }
    }

    fn replay_barrier_has_terminal(&self, attempt_id: &str) -> bool {
        self.replay_barriers.get(attempt_id).is_some_and(|barrier| {
            barrier.pending.iter().any(|ingress| {
                ingress
                    .actions
                    .iter()
                    .any(|action| matches!(action, AccumulatorAction::Terminal(_)))
            })
        })
    }

    fn drain_replay_barrier(
        &mut self,
        attempt_id: &str,
    ) -> Result<SharedRuntimeReplayBatch, String> {
        let (pending, native_app_server_events) = {
            let Some(barrier) = self.replay_barriers.get_mut(attempt_id) else {
                return Ok(SharedRuntimeReplayBatch {
                    deliveries: Vec::new(),
                    native_app_server_events: Vec::new(),
                    barrier_cleared: true,
                });
            };
            if barrier.pending.is_empty() && barrier.native_releases.is_empty() {
                self.replay_barriers.remove(attempt_id);
                return Ok(SharedRuntimeReplayBatch {
                    deliveries: Vec::new(),
                    native_app_server_events: Vec::new(),
                    barrier_cleared: true,
                });
            }
            (
                std::mem::take(&mut barrier.pending),
                std::mem::take(&mut barrier.native_releases)
                    .into_iter()
                    .collect::<Vec<_>>(),
            )
        };

        let mut deliveries = Vec::with_capacity(pending.len());
        for ingress in pending {
            let is_duplicate_terminal = self.settled_by_attempt.contains_key(attempt_id)
                && ingress
                    .actions
                    .iter()
                    .any(|action| matches!(action, AccumulatorAction::Terminal(_)));
            if is_duplicate_terminal {
                continue;
            }
            let mut app_server_events = ingress.replay_app_server_events.clone();
            let observation = self.apply_ingress(attempt_id, ingress);
            let Some(owner) = observation.owner.as_ref() else {
                continue;
            };
            for event in &mut app_server_events {
                project_app_server_event_to_shared_owner(event, owner);
            }
            deliveries.push(SharedRuntimeReplayDelivery {
                observation,
                app_server_events,
            });
        }

        Ok(SharedRuntimeReplayBatch {
            deliveries,
            native_app_server_events,
            // 非空 batch 必须先由调用方完成 publish + emit；此处保持 barrier，
            // 让期间到达的 ingress 继续排队。下一轮空 drain 才原子清除。
            barrier_cleared: false,
        })
    }
}

pub(crate) fn project_app_server_event_to_shared_owner(
    event: &mut AppServerEvent,
    owner: &SharedRuntimeAttemptOwner,
) {
    let requires_binding_recovery = owner.engine == EngineType::Claude
        && is_missing_native_session_error(&event.message.to_string());
    let native_thread_id = crate::backend::app_server::extract_thread_id(&event.message)
        .filter(|thread_id| !thread_id.starts_with("shared:"))
        .or_else(|| owner.native_session_id.clone());
    // Read method before mutably borrowing params (same message object).
    let method = event
        .message
        .get("method")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    // Control-plane methods are fail-closed on the frontend: params.turnId must
    // equal sharedOwner.runtimeTurnId. Claude historically mapped
    // requestUserInput.turnId to the assistant item id; force-align here so
    // Shared AskUserQuestion / approval cards are not silently dropped.
    let force_control_turn_identity = method == "item/tool/requestUserInput"
        || method == "approval/request"
        || method == "collaboration/modeBlocked"
        || method.contains("requestApproval");
    let params = event.message.as_object_mut().and_then(|message| {
        message
            .entry("params".to_string())
            .or_insert_with(|| json!({}))
            .as_object_mut()
    });
    let Some(params) = params else {
        return;
    };

    params.insert(
        "threadId".to_string(),
        Value::String(owner.shared_thread_id.clone()),
    );
    params.insert(
        "thread_id".to_string(),
        Value::String(owner.shared_thread_id.clone()),
    );
    rewrite_nested_thread_identity(params.get_mut("turn"), &owner.shared_thread_id);
    rewrite_nested_thread_identity(params.get_mut("thread"), &owner.shared_thread_id);

    if let Some(native_thread_id) = native_thread_id.as_deref() {
        params.insert(
            "nativeThreadId".to_string(),
            Value::String(native_thread_id.to_string()),
        );
        params.insert(
            "native_thread_id".to_string(),
            Value::String(native_thread_id.to_string()),
        );
    }
    if let Some(runtime_turn_id) = owner.runtime_turn_id.as_deref() {
        if force_control_turn_identity {
            params.insert(
                "turnId".to_string(),
                Value::String(runtime_turn_id.to_string()),
            );
            params.insert(
                "turn_id".to_string(),
                Value::String(runtime_turn_id.to_string()),
            );
        } else {
            params
                .entry("turnId".to_string())
                .or_insert_with(|| Value::String(runtime_turn_id.to_string()));
            params
                .entry("turn_id".to_string())
                .or_insert_with(|| Value::String(runtime_turn_id.to_string()));
        }
    }
    params.insert(
        "sharedOwner".to_string(),
        json!({
            "sharedSessionId": owner.shared_session_id,
            "sharedThreadId": owner.shared_thread_id,
            "providerRuntimeKey": owner.provider_runtime_key,
            "nativeThreadId": native_thread_id,
            "runtimeTurnId": owner.runtime_turn_id,
            "logicalTurnId": owner.logical_turn_id,
            "attemptId": owner.attempt_id,
            "bindingKey": owner.binding_key,
            "bindingOperationId": owner.binding_operation_id,
            "engine": engine_token(owner.engine),
            "executionTargetSnapshot": execution_target_snapshot_wire(
                &owner.execution_target_snapshot
            ),
        }),
    );
    if requires_binding_recovery {
        params.insert(
            "sharedRecoveryReason".to_string(),
            Value::String("native-session-not-found".to_string()),
        );
    }
}

fn execution_target_snapshot_wire(snapshot: &TurnExecutionSnapshot) -> Value {
    json!({
        "engine": snapshot.engine,
        "providerProfileId": snapshot.provider_profile_id,
        "modelCatalogEntryId": snapshot.model_catalog_entry_id,
        "model": snapshot.model,
        "reasoning": snapshot.reasoning,
        "providerProfileNameSnapshot": snapshot.provider_profile_name_snapshot,
        "providerProfileSource": snapshot.provider_profile_source,
        "runtimeCapabilityFingerprint": snapshot.runtime_capability_fingerprint,
    })
}

fn rewrite_nested_thread_identity(value: Option<&mut Value>, shared_thread_id: &str) {
    let Some(object) = value.and_then(Value::as_object_mut) else {
        return;
    };
    object.insert(
        "threadId".to_string(),
        Value::String(shared_thread_id.to_string()),
    );
    object.insert(
        "thread_id".to_string(),
        Value::String(shared_thread_id.to_string()),
    );
}

fn normalize_engine_ingress(
    provider_runtime_key: &str,
    engine: EngineType,
    runtime_turn_id: Option<&str>,
    native_session_id: Option<&str>,
    event: &EngineEvent,
) -> RuntimeIngress {
    let mut actions = Vec::new();
    let mut suppress_agent_event = false;
    match event {
        EngineEvent::SessionStarted { session_id, .. } => {
            return RuntimeIngress {
                workspace_id: event.workspace_id().to_string(),
                engine,
                provider_runtime_key: provider_runtime_key.to_string(),
                runtime_turn_id: normalize_identity(runtime_turn_id).map(str::to_string),
                native_session_id: normalize_native_session_identity(
                    engine,
                    Some(session_id.as_str()),
                )
                .or_else(|| normalize_native_session_identity(engine, native_session_id)),
                is_session_started: true,
                actions,
                agent_event: Some(event.clone()),
                replay_app_server_events: Vec::new(),
            };
        }
        EngineEvent::TurnStarted { turn_id, .. } => {
            return RuntimeIngress {
                workspace_id: event.workspace_id().to_string(),
                engine,
                provider_runtime_key: provider_runtime_key.to_string(),
                runtime_turn_id: normalize_identity(Some(turn_id.as_str()))
                    .or_else(|| normalize_identity(runtime_turn_id))
                    .map(str::to_string),
                native_session_id: normalize_native_session_identity(engine, native_session_id),
                is_session_started: false,
                actions,
                agent_event: Some(event.clone()),
                replay_app_server_events: Vec::new(),
            };
        }
        EngineEvent::TextDelta { text, .. } => {
            actions.push(AccumulatorAction::AssistantDelta(text.clone()));
        }
        EngineEvent::ReasoningDelta { text, .. } => {
            actions.push(AccumulatorAction::ReasoningDelta(text.clone()));
        }
        EngineEvent::ToolStarted {
            tool_id,
            tool_name,
            input,
            ..
        } => actions.push(AccumulatorAction::ToolStarted {
            tool_id: tool_id.clone(),
            tool_name: tool_name.clone(),
            input: input.clone(),
        }),
        EngineEvent::ToolInputUpdated {
            tool_id,
            tool_name,
            input,
            ..
        } => actions.push(AccumulatorAction::ToolInputUpdated {
            tool_id: tool_id.clone(),
            tool_name: tool_name.clone(),
            input: input.clone(),
        }),
        EngineEvent::ToolOutputDelta { tool_id, delta, .. } => {
            actions.push(AccumulatorAction::ToolOutputDelta {
                tool_id: tool_id.clone(),
                delta: delta.clone(),
            });
        }
        EngineEvent::ToolCompleted {
            tool_id,
            tool_name,
            output,
            error,
            ..
        } => actions.push(AccumulatorAction::ToolCompleted {
            tool_id: tool_id.clone(),
            tool_name: tool_name.clone(),
            output: output.clone(),
            error: error.clone(),
        }),
        EngineEvent::TurnCompleted { result, .. } => {
            let result = result.as_ref();
            actions.push(AccumulatorAction::Terminal(TerminalEvidence {
                outcome: completion_outcome(result),
                error_code: value_string_by_aliases(result, &["errorCode", "error_code", "code"]),
                error_message: value_string_by_aliases(
                    result,
                    &["errorMessage", "error_message", "error"],
                ),
                stop_reason: value_string_by_aliases(
                    result,
                    &["stopReason", "stop_reason", "reason"],
                ),
                fallback_text: crate::engine::commands::extract_turn_result_text(result),
                artifacts: result
                    .map(extract_explicit_artifact_refs)
                    .unwrap_or_default(),
                provider_private_refs: deserialize_vec_by_aliases(
                    result,
                    &["providerPrivateRefs", "provider_private_refs"],
                ),
                omissions: deserialize_vec_by_aliases(result, &["omissions"]),
            }));
        }
        EngineEvent::TurnError { error, code, .. } => {
            actions.push(AccumulatorAction::Terminal(TerminalEvidence {
                outcome: OutcomeStatus::Failed,
                error_code: code.clone(),
                error_message: Some(error.clone()),
                stop_reason: None,
                fallback_text: None,
                artifacts: Vec::new(),
                provider_private_refs: Vec::new(),
                omissions: Vec::new(),
            }));
        }
        EngineEvent::Raw { data, .. } => {
            if engine == EngineType::Claude {
                if let Some(echo) = extract_claude_replay_echo(data) {
                    actions.push(AccumulatorAction::ContextEcho(echo));
                    // replay echo 是 transport-level ACK，不是用户输入，也不是 assistant
                    // content。禁止进入 AgentEventBus/history/UI raw fan-out。
                    suppress_agent_event = true;
                }
                if let Some(terminal) = claude_result_terminal_evidence(data) {
                    // Claude CLI 的 `result` packet 是业务回合已经结束的 typed
                    // evidence；后续 stdout/stderr drain 与 process reap 只是 Runtime
                    // cleanup。Native Claude 仍等待 canonical TurnCompleted，Shared
                    // attempt 则必须在这里先收口，不能让清理延迟继续占用 Stop/UI lock。
                    actions.push(AccumulatorAction::Terminal(terminal));
                }
            }
            let artifacts = extract_explicit_artifact_refs(data);
            if !artifacts.is_empty() {
                actions.push(AccumulatorAction::Artifacts(artifacts));
            }
        }
        _ => {}
    }
    RuntimeIngress {
        workspace_id: event.workspace_id().to_string(),
        engine,
        provider_runtime_key: provider_runtime_key.to_string(),
        runtime_turn_id: normalize_identity(runtime_turn_id).map(str::to_string),
        native_session_id: normalize_native_session_identity(engine, native_session_id),
        is_session_started: false,
        actions,
        agent_event: (!suppress_agent_event).then(|| event.clone()),
        replay_app_server_events: Vec::new(),
    }
}

fn claude_result_terminal_evidence(data: &Value) -> Option<TerminalEvidence> {
    let event_type = data
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    if !event_type.eq_ignore_ascii_case("result") {
        return None;
    }

    let subtype = data
        .get("subtype")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    let terminal_reason = value_string_by_aliases(
        Some(data),
        &[
            "terminalReason",
            "terminal_reason",
            "stopReason",
            "stop_reason",
        ],
    );
    let is_failed = data
        .get("is_error")
        .or_else(|| data.get("isError"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || matches!(
            subtype.as_str(),
            "error" | "failed" | "failure" | "error_during_execution"
        )
        || subtype.starts_with("error_");

    let fallback_text = (!is_failed)
        .then(|| crate::engine::commands::extract_turn_result_text(Some(data)))
        .flatten();
    let result_text = crate::engine::commands::extract_turn_result_text(Some(data));
    let error_message = if is_failed {
        value_string_by_aliases(Some(data), &["errorMessage", "error_message", "message"])
            .or_else(|| {
                data.get("error")
                    .and_then(|error| value_string_by_aliases(Some(error), &["message"]))
            })
            .or(result_text)
    } else {
        None
    };

    Some(TerminalEvidence {
        outcome: if is_failed {
            OutcomeStatus::Failed
        } else {
            OutcomeStatus::Completed
        },
        error_code: value_string_by_aliases(
            Some(data),
            &[
                "apiErrorStatus",
                "api_error_status",
                "errorCode",
                "error_code",
                "code",
            ],
        ),
        error_message,
        stop_reason: terminal_reason,
        fallback_text,
        artifacts: extract_explicit_artifact_refs(data),
        provider_private_refs: deserialize_vec_by_aliases(
            Some(data),
            &["providerPrivateRefs", "provider_private_refs"],
        ),
        omissions: deserialize_vec_by_aliases(Some(data), &["omissions"]),
    })
}

/// Claude `--replay-user-messages` 回显的 Shared context marker 仅用于强 ACK。
/// 即使 runtime identity 尚未完成绑定，也必须在普通 UI/history fan-out 前过滤。
pub(crate) fn is_internal_shared_context_replay_event(event: &EngineEvent) -> bool {
    matches!(
        event,
        EngineEvent::Raw {
            engine: EngineType::Claude,
            data,
            ..
        } if extract_claude_replay_echo(data).is_some()
    )
}

fn normalize_codex_ingress(
    provider_runtime_key: &str,
    workspace_id: &str,
    event: &Value,
) -> RuntimeIngress {
    let method = event
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let params = event.get("params").unwrap_or(&Value::Null);
    let runtime_turn_id = crate::backend::app_server::extract_turn_id(event);
    let native_session_id = crate::backend::app_server::extract_thread_id(event);
    let mut actions = Vec::new();

    let agent_event = if let Some(text) = extract_codex_text_delta(event) {
        actions.push(AccumulatorAction::AssistantDelta(text.clone()));
        Some(EngineEvent::TextDelta {
            workspace_id: workspace_id.to_string(),
            text,
        })
    } else if let Some(text) = extract_codex_reasoning_delta(event) {
        actions.push(AccumulatorAction::ReasoningDelta(text.clone()));
        Some(EngineEvent::ReasoningDelta {
            workspace_id: workspace_id.to_string(),
            text,
        })
    } else if let Some(text) = extract_agent_message_snapshot_text(event) {
        actions.push(AccumulatorAction::AssistantSnapshot(text));
        Some(EngineEvent::Raw {
            workspace_id: workspace_id.to_string(),
            engine: EngineType::Codex,
            data: event.clone(),
        })
    } else {
        normalize_codex_structured_event(workspace_id, method, params, event, &mut actions)
    };

    let artifacts = extract_explicit_artifact_refs(params);
    if !artifacts.is_empty() {
        actions.push(AccumulatorAction::Artifacts(artifacts));
    }

    RuntimeIngress {
        workspace_id: workspace_id.to_string(),
        engine: EngineType::Codex,
        provider_runtime_key: provider_runtime_key.to_string(),
        runtime_turn_id,
        native_session_id,
        is_session_started: method == "thread/started",
        actions,
        agent_event,
        replay_app_server_events: vec![AppServerEvent {
            workspace_id: workspace_id.to_string(),
            message: event.clone(),
        }],
    }
}

fn normalize_codex_structured_event(
    workspace_id: &str,
    method: &str,
    params: &Value,
    event: &Value,
    actions: &mut Vec<AccumulatorAction>,
) -> Option<EngineEvent> {
    match method {
        "turn/started" => {
            let turn_id = crate::backend::app_server::extract_turn_id(event).unwrap_or_default();
            Some(EngineEvent::TurnStarted {
                workspace_id: workspace_id.to_string(),
                turn_id,
            })
        }
        "thread/started" => {
            let session_id =
                crate::backend::app_server::extract_thread_id(event).unwrap_or_default();
            Some(EngineEvent::SessionStarted {
                workspace_id: workspace_id.to_string(),
                session_id,
                engine: EngineType::Codex,
                turn_id: crate::backend::app_server::extract_turn_id(event),
            })
        }
        "item/started" | "item/updated" | "item/completed" => {
            normalize_codex_item_event(workspace_id, method, params, actions)
        }
        "item/toolStart" => {
            let tool_id = value_string_by_aliases(Some(params), &["toolId", "tool_id", "id"])
                .unwrap_or_else(|| "unknown-tool".to_string());
            let tool_name =
                value_string_by_aliases(Some(params), &["toolName", "tool_name", "name"])
                    .unwrap_or_else(|| tool_id.clone());
            let input = value_by_aliases(params, &["input", "arguments"]).cloned();
            actions.push(AccumulatorAction::ToolStarted {
                tool_id: tool_id.clone(),
                tool_name: tool_name.clone(),
                input: input.clone(),
            });
            Some(EngineEvent::ToolStarted {
                workspace_id: workspace_id.to_string(),
                tool_id,
                tool_name,
                input,
            })
        }
        "item/toolComplete" => {
            let tool_id = value_string_by_aliases(Some(params), &["toolId", "tool_id", "id"])
                .unwrap_or_else(|| "unknown-tool".to_string());
            let tool_name =
                value_string_by_aliases(Some(params), &["toolName", "tool_name", "name"]);
            let output = value_by_aliases(params, &["output", "result"]).cloned();
            let error = value_string_by_aliases(Some(params), &["error", "errorMessage"]);
            actions.push(AccumulatorAction::ToolCompleted {
                tool_id: tool_id.clone(),
                tool_name: tool_name.clone(),
                output: output.clone(),
                error: error.clone(),
            });
            Some(EngineEvent::ToolCompleted {
                workspace_id: workspace_id.to_string(),
                tool_id,
                tool_name,
                output,
                error,
            })
        }
        "turn/completed" => {
            let fallback_text = extract_turn_completed_text(event);
            let evidence = terminal_evidence_from_value(params, fallback_text, false);
            actions.push(AccumulatorAction::Terminal(evidence));
            Some(EngineEvent::TurnCompleted {
                workspace_id: workspace_id.to_string(),
                result: Some(params.clone()),
            })
        }
        "turn/error" | "runtime/ended" => {
            let evidence = terminal_evidence_from_value(params, None, true);
            let error = evidence
                .error_message
                .clone()
                .unwrap_or_else(|| "Codex runtime turn failed".to_string());
            let code = evidence.error_code.clone();
            actions.push(AccumulatorAction::Terminal(evidence));
            Some(EngineEvent::TurnError {
                workspace_id: workspace_id.to_string(),
                error,
                code,
            })
        }
        "error"
            if !params
                .get("willRetry")
                .or_else(|| params.get("will_retry"))
                .and_then(Value::as_bool)
                .unwrap_or(false) =>
        {
            let evidence = terminal_evidence_from_value(params, None, true);
            let error = evidence
                .error_message
                .clone()
                .unwrap_or_else(|| "Codex runtime request failed".to_string());
            let code = evidence.error_code.clone();
            actions.push(AccumulatorAction::Terminal(evidence));
            Some(EngineEvent::TurnError {
                workspace_id: workspace_id.to_string(),
                error,
                code,
            })
        }
        _ => Some(EngineEvent::Raw {
            workspace_id: workspace_id.to_string(),
            engine: EngineType::Codex,
            data: event.clone(),
        }),
    }
}

fn normalize_codex_item_event(
    workspace_id: &str,
    method: &str,
    params: &Value,
    actions: &mut Vec<AccumulatorAction>,
) -> Option<EngineEvent> {
    let item = params.get("item")?;
    if is_assistant_or_reasoning_item(item) {
        return Some(EngineEvent::Raw {
            workspace_id: workspace_id.to_string(),
            engine: EngineType::Codex,
            data: json!({ "method": method, "params": params }),
        });
    }
    let item_type = value_string_by_aliases(Some(item), &["type", "kind"]).unwrap_or_default();
    if !is_tool_item_type(&item_type) {
        return Some(EngineEvent::Raw {
            workspace_id: workspace_id.to_string(),
            engine: EngineType::Codex,
            data: json!({ "method": method, "params": params }),
        });
    }
    let tool_id = value_string_by_aliases(Some(item), &["id", "toolId", "tool_id"])
        .unwrap_or_else(|| "unknown-tool".to_string());
    // Prefer explicit tool name; custom_tool_call uses `name` (e.g. apply_patch).
    // Fall back to item type (e.g. "fileChange") for canvas classifiers.
    let tool_name = value_string_by_aliases(
        Some(item),
        &["tool", "toolName", "tool_name", "name", "title"],
    )
    .unwrap_or_else(|| item_type.clone());
    // Codex fileChange puts paths/diffs on `changes[]`, not `arguments`/`input`.
    // Pack both so SharedProjector can rebuild ConversationItem.changes.
    let input = extract_codex_tool_payload(item);
    if method == "item/started" {
        actions.push(AccumulatorAction::ToolStarted {
            tool_id: tool_id.clone(),
            tool_name: tool_name.clone(),
            input: input.clone(),
        });
        return Some(EngineEvent::ToolStarted {
            workspace_id: workspace_id.to_string(),
            tool_id,
            tool_name,
            input,
        });
    }
    if method == "item/updated" {
        actions.push(AccumulatorAction::ToolInputUpdated {
            tool_id: tool_id.clone(),
            tool_name: Some(tool_name.clone()),
            input: input.clone(),
        });
        return Some(EngineEvent::ToolInputUpdated {
            workspace_id: workspace_id.to_string(),
            tool_id,
            tool_name: Some(tool_name),
            input,
        });
    }

    // Completed snapshots often carry the final `changes[]` only at this step.
    if let Some(payload) = input.clone() {
        actions.push(AccumulatorAction::ToolInputUpdated {
            tool_id: tool_id.clone(),
            tool_name: Some(tool_name.clone()),
            input: Some(payload),
        });
    }
    let output = value_by_aliases(item, &["result", "output", "aggregatedOutput"])
        .or_else(|| value_by_aliases(params, &["result", "output"]))
        .cloned();
    let error = value_string_by_aliases(Some(item), &["error", "errorMessage"])
        .or_else(|| value_string_by_aliases(Some(params), &["error", "errorMessage"]));
    actions.push(AccumulatorAction::ToolCompleted {
        tool_id: tool_id.clone(),
        tool_name: Some(tool_name.clone()),
        output: output.clone(),
        error: error.clone(),
    });
    Some(EngineEvent::ToolCompleted {
        workspace_id: workspace_id.to_string(),
        tool_id,
        tool_name: Some(tool_name),
        output,
        error,
    })
}

/// Build a portable tool payload for Shared canonical storage.
///
/// Codex `fileChange` items put path/diff on `changes[]` (not `arguments`).
/// Codex `apply_patch` often arrives as `custom_tool_call` with a raw patch string
/// in `input`. Both must be packed or history cannot rebuild the file-edit scene.
fn extract_codex_tool_payload(item: &Value) -> Option<Value> {
    let mut object = serde_json::Map::new();

    match value_by_aliases(item, &["arguments", "input"]) {
        Some(Value::Object(map)) => {
            for (key, value) in map {
                object.insert(key.clone(), value.clone());
            }
        }
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                object.insert("input".to_string(), Value::String(trimmed.to_string()));
                // Preserve patch-shaped strings under an explicit key for projection.
                if trimmed.contains("*** Begin Patch") || trimmed.contains("*** Update File:") {
                    object.insert("patch".to_string(), Value::String(trimmed.to_string()));
                }
            }
        }
        Some(value) if !value.is_null() => {
            object.insert("input".to_string(), value.clone());
        }
        _ => {}
    }

    if let Some(changes) = item.get("changes") {
        if changes.as_array().is_some_and(|rows| !rows.is_empty()) {
            object.insert("changes".to_string(), changes.clone());
        }
    }

    // custom_tool_call / function_call name (apply_patch, shell, …)
    if let Some(name) =
        value_string_by_aliases(Some(item), &["name", "tool", "toolName", "tool_name"])
    {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            object.insert("name".to_string(), Value::String(trimmed.to_string()));
        }
    }

    if let Some(title) = item.get("title").and_then(Value::as_str) {
        let trimmed = title.trim();
        if !trimmed.is_empty() {
            object.insert("title".to_string(), Value::String(trimmed.to_string()));
        }
    }

    // commandExecution-shaped fields. Codex often sends `command` as a string[] argv
    // (e.g. ["cat","README.md"] or apply_patch + patch body). We must join argv into a
    // single string or Shared history loses the command text and cannot promote
    // apply_patch → fileChange.
    for key in ["cwd", "description"] {
        if let Some(Value::String(text)) = item.get(key) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                object.insert(key.to_string(), Value::String(trimmed.to_string()));
            }
        }
    }
    if let Some(command) = coerce_command_field(item.get("command").or_else(|| item.get("cmd"))) {
        let looks_like_patch = command.contains("*** Begin Patch")
            || command.contains("*** Update File:")
            || command.to_ascii_lowercase().contains("apply_patch");
        object.insert("command".to_string(), Value::String(command.clone()));
        if looks_like_patch {
            object.insert("patch".to_string(), Value::String(command));
        }
    }

    if object.is_empty() {
        None
    } else {
        Some(Value::Object(object))
    }
}

/// Normalize Codex command field: string as-is, string[] joined with spaces.
fn coerce_command_field(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Some(Value::Array(parts)) => {
            let joined = parts
                .iter()
                .filter_map(|part| part.as_str().map(str::trim))
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            if joined.is_empty() {
                None
            } else {
                Some(joined)
            }
        }
        _ => None,
    }
}

/// Merge tool argument JSON summaries. Object keys from `incoming` win; non-JSON
/// strings fall back to last-write-wins (preserves prior string when incoming empty).
fn merge_tool_arguments_summary(existing: Option<&str>, incoming: &str) -> String {
    let incoming = incoming.trim();
    if incoming.is_empty() {
        return existing.unwrap_or("").to_string();
    }
    let Some(existing) = existing.map(str::trim).filter(|text| !text.is_empty()) else {
        return incoming.to_string();
    };
    let Ok(Value::Object(mut base)) = serde_json::from_str::<Value>(existing) else {
        return incoming.to_string();
    };
    let Ok(Value::Object(patch)) = serde_json::from_str::<Value>(incoming) else {
        return incoming.to_string();
    };
    for (key, value) in patch {
        base.insert(key, value);
    }
    serde_json::to_string(&Value::Object(base)).unwrap_or_else(|_| incoming.to_string())
}

fn terminal_evidence_from_value(
    value: &Value,
    fallback_text: Option<String>,
    force_failed: bool,
) -> TerminalEvidence {
    let outcome = if force_failed {
        OutcomeStatus::Failed
    } else {
        completion_outcome(Some(value))
    };
    TerminalEvidence {
        outcome,
        error_code: value_string_by_aliases(
            Some(value),
            &[
                "errorCode",
                "error_code",
                "code",
                "reasonCode",
                "reason_code",
            ],
        )
        .or_else(|| {
            value.get("error").and_then(|error| {
                value_string_by_aliases(
                    Some(error),
                    &[
                        "errorCode",
                        "error_code",
                        "code",
                        "reasonCode",
                        "reason_code",
                    ],
                )
            })
        }),
        error_message: value_string_by_aliases(
            Some(value),
            &["errorMessage", "error_message", "message"],
        )
        .or_else(|| {
            value
                .get("error")
                .and_then(|error| value_string_by_aliases(Some(error), &["message"]))
        }),
        stop_reason: value_string_by_aliases(Some(value), &["stopReason", "stop_reason", "reason"]),
        fallback_text,
        artifacts: extract_explicit_artifact_refs(value),
        provider_private_refs: deserialize_vec_by_aliases(
            Some(value),
            &["providerPrivateRefs", "provider_private_refs"],
        ),
        omissions: deserialize_vec_by_aliases(Some(value), &["omissions"]),
    }
}

fn push_assistant_block(blocks: &mut Vec<CanonicalBlock>, next: CanonicalBlock) {
    match (blocks.last_mut(), next) {
        (Some(CanonicalBlock::Text { text }), CanonicalBlock::Text { text: delta }) => {
            text.push_str(&delta);
        }
        (Some(CanonicalBlock::Reasoning { text }), CanonicalBlock::Reasoning { text: delta }) => {
            text.push_str(&delta);
        }
        (_, next) => blocks.push(next),
    }
}

fn canonical_block_text(block: &CanonicalBlock) -> (&'static str, &str) {
    match block {
        CanonicalBlock::Text { text } => ("text", text),
        CanonicalBlock::Reasoning { text } => ("reasoning", text),
        _ => ("other", ""),
    }
}

fn matching_block_text(blocks: &[CanonicalBlock], kind: &str) -> String {
    blocks
        .iter()
        .filter_map(|block| {
            let (block_kind, text) = canonical_block_text(block);
            (block_kind == kind).then_some(text)
        })
        .collect()
}

fn is_full_claude_observation(text: &str) -> bool {
    text.chars()
        .filter(|character| !character.is_whitespace())
        .count()
        >= CLAUDE_FULL_OBSERVATION_MIN_CHARS
}

/// Claude provider adapters may expose a growing full snapshot on more than one protocol
/// surface. This merge is intentionally scoped to the Shared accumulator: Native Claude keeps
/// its existing reducer normalization and Codex keeps delta append semantics.
fn merge_claude_full_observation(blocks: &mut Vec<CanonicalBlock>, next: CanonicalBlock) {
    let (kind, incoming) = canonical_block_text(&next);
    if kind == "other" || incoming.trim().is_empty() {
        push_assistant_block(blocks, next);
        return;
    }

    let existing = matching_block_text(blocks, kind);
    if existing.is_empty() || !is_full_claude_observation(&existing) {
        push_assistant_block(blocks, next);
        return;
    }
    if incoming == existing || existing.starts_with(incoming) {
        return;
    }
    if let Some(suffix) = incoming.strip_prefix(&existing) {
        let replay_trimmed = suffix.trim_start();
        if let Some(after_replay) = replay_trimmed.strip_prefix(&existing) {
            if !after_replay.is_empty() {
                let replay_free = match kind {
                    "text" => CanonicalBlock::Text {
                        text: after_replay.to_string(),
                    },
                    "reasoning" => CanonicalBlock::Reasoning {
                        text: after_replay.to_string(),
                    },
                    _ => unreachable!("canonical block kind checked above"),
                };
                push_assistant_block(blocks, replay_free);
            }
            return;
        }
        if !suffix.is_empty() {
            let incremental_suffix = match kind {
                "text" => CanonicalBlock::Text {
                    text: suffix.to_string(),
                },
                "reasoning" => CanonicalBlock::Reasoning {
                    text: suffix.to_string(),
                },
                _ => unreachable!("canonical block kind checked above"),
            };
            push_assistant_block(blocks, incremental_suffix);
        }
        return;
    }

    push_assistant_block(blocks, next);
}

fn merge_claude_complete_assistant_text(blocks: &mut Vec<CanonicalBlock>, complete_text: String) {
    let existing_text = matching_block_text(blocks, "text");
    if is_full_claude_observation(&existing_text) {
        if complete_text == existing_text || existing_text.starts_with(&complete_text) {
            return;
        }
        if let Some(suffix) = complete_text.strip_prefix(&existing_text) {
            if suffix.trim_start().starts_with(&existing_text) {
                return;
            }
        }
    }
    merge_complete_assistant_text(blocks, complete_text);
}

/// Snapshot/terminal text 是累计完成证据。只做单调补全；无前缀关系时保留独立
/// Text block，禁止用猜测覆盖已观察到的 streamed content。
fn merge_complete_assistant_text(blocks: &mut Vec<CanonicalBlock>, complete_text: String) {
    if complete_text.trim().is_empty() {
        return;
    }

    let existing_text = blocks
        .iter()
        .filter_map(|block| match block {
            CanonicalBlock::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<String>();
    if existing_text.is_empty() {
        blocks.push(CanonicalBlock::Text {
            text: complete_text,
        });
        return;
    }
    if complete_text == existing_text || existing_text.starts_with(&complete_text) {
        return;
    }
    if let Some(suffix) = complete_text.strip_prefix(&existing_text) {
        if let Some(CanonicalBlock::Text { text }) = blocks
            .iter_mut()
            .rev()
            .find(|block| matches!(block, CanonicalBlock::Text { .. }))
        {
            text.push_str(suffix);
        }
        return;
    }
    if blocks
        .iter()
        .any(|block| matches!(block, CanonicalBlock::Text { text } if text == &complete_text))
    {
        return;
    }

    blocks.push(CanonicalBlock::Text {
        text: complete_text,
    });
}

fn upsert_tool_result(results: &mut Vec<RuntimeToolResult>, result: RuntimeToolResult) {
    if let Some(existing) = results
        .iter_mut()
        .find(|existing| existing.tool_call_id == result.tool_call_id)
    {
        *existing = result;
    } else {
        results.push(result);
    }
}

fn stringify_json_value(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| serde_json::to_string(value).unwrap_or_default())
}

fn extract_explicit_artifact_refs(value: &Value) -> Vec<ArtifactRef> {
    fn walk(value: &Value, refs: &mut Vec<ArtifactRef>) {
        match value {
            Value::Array(items) => items.iter().for_each(|item| walk(item, refs)),
            Value::Object(object) => {
                for (key, child) in object {
                    if matches!(
                        key.as_str(),
                        "artifactRef" | "artifact_ref" | "artifactRefs" | "artifact_refs"
                    ) {
                        match child {
                            Value::Array(items) => {
                                for item in items {
                                    if let Ok(artifact) =
                                        serde_json::from_value::<ArtifactRef>(item.clone())
                                    {
                                        refs.push(artifact);
                                    }
                                }
                            }
                            _ => {
                                if let Ok(artifact) =
                                    serde_json::from_value::<ArtifactRef>(child.clone())
                                {
                                    refs.push(artifact);
                                }
                            }
                        }
                    } else {
                        walk(child, refs);
                    }
                }
            }
            _ => {}
        }
    }

    let mut refs = Vec::new();
    walk(value, &mut refs);
    let mut unique = Vec::new();
    extend_unique_artifacts(&mut unique, refs);
    unique
}

fn extract_claude_replay_echo(data: &Value) -> Option<String> {
    let is_replay = data
        .get("isReplay")
        .or_else(|| data.get("is_replay"))
        .and_then(Value::as_bool)
        == Some(true);
    if !is_replay {
        return None;
    }
    fn collect_text(value: &Value, output: &mut String) {
        match value {
            Value::String(text) => output.push_str(text),
            Value::Array(items) => {
                for item in items {
                    collect_text(item, output);
                }
            }
            Value::Object(object) => {
                for key in ["content", "text", "message"] {
                    if let Some(value) = object.get(key) {
                        collect_text(value, output);
                    }
                }
            }
            _ => {}
        }
    }
    let mut echo = String::new();
    collect_text(data.get("message").unwrap_or(data), &mut echo);
    (echo.contains("DOGE_CONTEXT_PACKAGE:") || echo.contains("MOSSX_CONTEXT_PACKAGE:"))
        .then_some(echo)
        .filter(|value| !value.is_empty())
}

fn extend_unique_artifacts(target: &mut Vec<ArtifactRef>, values: Vec<ArtifactRef>) {
    for value in values {
        if !target.iter().any(|existing| {
            existing.artifact_id == value.artifact_id && existing.sha256 == value.sha256
        }) {
            target.push(value);
        }
    }
}

fn extend_unique_private_refs(
    target: &mut Vec<ProviderPrivateRef>,
    values: Vec<ProviderPrivateRef>,
) {
    for value in values {
        if !target
            .iter()
            .any(|existing| existing.ref_id == value.ref_id)
        {
            target.push(value);
        }
    }
}

fn extend_unique_omissions(target: &mut Vec<CanonicalOmission>, values: Vec<CanonicalOmission>) {
    for value in values {
        if !target.iter().any(|existing| {
            existing.category == value.category
                && existing.reason == value.reason
                && existing.retrievable_ref == value.retrievable_ref
        }) {
            target.push(value);
        }
    }
}

fn deserialize_vec_by_aliases<T: serde::de::DeserializeOwned>(
    value: Option<&Value>,
    aliases: &[&str],
) -> Vec<T> {
    let Some(value) = value else {
        return Vec::new();
    };
    for alias in aliases {
        if let Some(candidate) = value.get(*alias) {
            if let Ok(values) = serde_json::from_value::<Vec<T>>(candidate.clone()) {
                return values;
            }
        }
    }
    Vec::new()
}

fn completion_outcome(value: Option<&Value>) -> OutcomeStatus {
    let status =
        value_string_by_aliases(value, &["status", "outcome", "stopReason", "stop_reason"])
            .or_else(|| {
                value.and_then(|root| {
                    ["turn", "result"].iter().find_map(|key| {
                        root.get(*key).and_then(|nested| {
                            value_string_by_aliases(
                                Some(nested),
                                &["status", "outcome", "stopReason", "stop_reason"],
                            )
                        })
                    })
                })
            })
            .unwrap_or_default()
            .to_ascii_lowercase();
    match status.as_str() {
        "cancelled" | "canceled" | "interrupted" | "aborted" => OutcomeStatus::Cancelled,
        "failed" | "error" => OutcomeStatus::Failed,
        "replaced" => OutcomeStatus::Replaced,
        _ => OutcomeStatus::Completed,
    }
}

fn value_by_aliases<'a>(value: &'a Value, aliases: &[&str]) -> Option<&'a Value> {
    aliases.iter().find_map(|alias| value.get(*alias))
}

fn value_string_by_aliases(value: Option<&Value>, aliases: &[&str]) -> Option<String> {
    let value = value?;
    value_by_aliases(value, aliases)
        .and_then(|candidate| match candidate {
            Value::String(text) => Some(text.clone()),
            Value::Object(_) | Value::Array(_) => serde_json::to_string(candidate).ok(),
            Value::Null => None,
            other => Some(other.to_string()),
        })
        .filter(|text| !text.trim().is_empty())
}

fn is_assistant_or_reasoning_item(item: &Value) -> bool {
    let item_type = value_string_by_aliases(Some(item), &["type", "kind"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(
        item_type.as_str(),
        "agentmessage" | "agent_message" | "assistantmessage" | "assistant_message" | "reasoning"
    )
}

fn is_tool_item_type(item_type: &str) -> bool {
    matches!(
        item_type.to_ascii_lowercase().as_str(),
        "commandexecution"
            | "command_execution"
            | "filechange"
            | "file_change"
            | "mcptoolcall"
            | "mcp_tool_call"
            | "toolcall"
            | "tool_call"
            | "dynamictoolcall"
            | "dynamic_tool_call"
            // Codex Responses often emits apply_patch as custom_tool_call (not fileChange).
            | "customtoolcall"
            | "custom_tool_call"
            | "function_call"
            | "functioncall"
            | "apply_patch"
            | "applypatch"
    )
}

fn validate_owner(owner: &SharedRuntimeAttemptOwner) -> Result<(), String> {
    for (field, value) in [
        ("workspaceId", owner.workspace_id.as_str()),
        ("providerRuntimeKey", owner.provider_runtime_key.as_str()),
        ("sharedSessionId", owner.shared_session_id.as_str()),
        ("sharedThreadId", owner.shared_thread_id.as_str()),
        ("logicalTurnId", owner.logical_turn_id.as_str()),
        ("attemptId", owner.attempt_id.as_str()),
        ("bindingKey", owner.binding_key.as_str()),
        ("bindingOperationId", owner.binding_operation_id.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(format!("shared runtime owner {field} cannot be empty"));
        }
    }
    if owner.shared_thread_id != format!("shared:{}", owner.shared_session_id) {
        return Err("shared runtime owner session/thread identity mismatch".to_string());
    }
    if owner.execution_target_snapshot.engine != engine_token(owner.engine) {
        return Err("shared runtime owner execution target engine mismatch".to_string());
    }
    if let Some(marker) = owner.context_marker.as_ref() {
        if marker.package_id.trim().is_empty() || marker.source_checksum.trim().is_empty() {
            return Err("shared runtime context marker cannot be empty".to_string());
        }
    }
    Ok(())
}

fn same_durable_owner(left: &SharedRuntimeAttemptOwner, right: &SharedRuntimeAttemptOwner) -> bool {
    left.workspace_id == right.workspace_id
        && left.provider_runtime_key == right.provider_runtime_key
        && left.shared_session_id == right.shared_session_id
        && left.shared_thread_id == right.shared_thread_id
        && left.logical_turn_id == right.logical_turn_id
        && left.attempt_id == right.attempt_id
        && left.binding_key == right.binding_key
        && left.binding_operation_id == right.binding_operation_id
        && left.engine == right.engine
        && left.execution_target_snapshot == right.execution_target_snapshot
        && left.context_marker == right.context_marker
}

fn insert_identity_owner(
    index: &mut HashMap<RuntimeIdentityKey, String>,
    key: RuntimeIdentityKey,
    attempt_id: &str,
) -> Result<(), String> {
    if let Some(existing) = index.get(&key) {
        if existing != attempt_id {
            return Err(format!(
                "shared runtime identity already owned by attempt {existing}"
            ));
        }
    }
    index.insert(key, attempt_id.to_string());
    Ok(())
}

fn identity_key(owner: &SharedRuntimeAttemptOwner, identity: &str) -> RuntimeIdentityKey {
    RuntimeIdentityKey {
        workspace_id: owner.workspace_id.clone(),
        engine: owner.engine,
        provider_runtime_key: owner.provider_runtime_key.clone(),
        identity: identity.to_string(),
    }
}

fn runtime_scope_key(owner: &SharedRuntimeAttemptOwner) -> RuntimeScopeKey {
    RuntimeScopeKey {
        workspace_id: owner.workspace_id.clone(),
        engine: owner.engine,
        provider_runtime_key: owner.provider_runtime_key.clone(),
    }
}

fn runtime_scope_key_for_ingress(ingress: &RuntimeIngress) -> RuntimeScopeKey {
    RuntimeScopeKey {
        workspace_id: ingress.workspace_id.clone(),
        engine: ingress.engine,
        provider_runtime_key: ingress.provider_runtime_key.clone(),
    }
}

fn native_identity_key_for_ingress(ingress: &RuntimeIngress) -> Option<RuntimeIdentityKey> {
    ingress
        .native_session_id
        .as_deref()
        .map(|native_session_id| RuntimeIdentityKey {
            workspace_id: ingress.workspace_id.clone(),
            engine: ingress.engine,
            provider_runtime_key: ingress.provider_runtime_key.clone(),
            identity: native_session_id.to_string(),
        })
}

fn normalize_identity(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn normalize_native_session_identity(engine: EngineType, value: Option<&str>) -> Option<String> {
    let normalized = normalize_identity(value)?;
    // Claude / Kimi / Grok / OpenCode：catalog 与 FE hide 使用 `engine:{raw}`。
    // Codex 保持 raw thread id（无前缀）。pending 占位原样保留，避免误写成
    // `grok:grok-pending-shared-*`。
    match engine {
        EngineType::Claude | EngineType::Kimi | EngineType::Grok | EngineType::OpenCode => {
            let token = engine_token(engine);
            let prefix = format!("{token}:");
            if crate::shared_sessions::is_pending_shared_binding_thread_id(engine, normalized) {
                return Some(normalized.to_string());
            }
            let raw = normalized
                .strip_prefix(prefix.as_str())
                .unwrap_or(normalized)
                .trim();
            if raw.is_empty() {
                return None;
            }
            if crate::shared_sessions::is_pending_shared_binding_thread_id(engine, raw) {
                return Some(raw.to_string());
            }
            Some(format!("{prefix}{raw}"))
        }
        EngineType::Codex | EngineType::Gemini => Some(normalized.to_string()),
    }
}

pub(crate) fn is_missing_native_session_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("no conversation found with session id")
        || normalized.contains("conversation not found for session id")
}

fn engine_token(engine: EngineType) -> &'static str {
    match engine {
        EngineType::Claude => "claude",
        EngineType::Codex => "codex",
        EngineType::Gemini => "gemini",
        EngineType::OpenCode => "opencode",
        EngineType::Kimi => "kimi",
        EngineType::Grok => "grok",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owner(
        attempt_id: &str,
        runtime_turn_id: Option<&str>,
        native_session_id: Option<&str>,
    ) -> SharedRuntimeAttemptOwner {
        SharedRuntimeAttemptOwner {
            workspace_id: "ws-1".to_string(),
            provider_runtime_key: TEST_PROVIDER_RUNTIME_KEY.to_string(),
            shared_session_id: "session-1".to_string(),
            shared_thread_id: "shared:session-1".to_string(),
            logical_turn_id: format!("logical-{attempt_id}"),
            attempt_id: attempt_id.to_string(),
            binding_key: "codex::managed-a".to_string(),
            binding_operation_id: "binding-operation-1".to_string(),
            engine: EngineType::Codex,
            execution_target_snapshot: TurnExecutionSnapshot {
                engine: "codex".to_string(),
                provider_profile_id: Some("managed-a".to_string()),
                model_catalog_entry_id: Some("catalog-gpt".to_string()),
                model: Some("gpt-runtime".to_string()),
                reasoning: None,
                provider_profile_name_snapshot: Some("Managed A".to_string()),
                provider_profile_source: Some(
                    crate::shared_event_log::canonical::types::CanonicalProviderProfileSource::Managed,
                ),
                runtime_capability_fingerprint: Some("runtime-capability-v1".to_string()),
                extra: Value::Object(Default::default()),
            },
            native_session_id: native_session_id.map(str::to_string),
            runtime_turn_id: runtime_turn_id.map(str::to_string),
            context_marker: None,
        }
    }

    fn claude_owner(
        attempt_id: &str,
        runtime_turn_id: Option<&str>,
        native_session_id: Option<&str>,
    ) -> SharedRuntimeAttemptOwner {
        let mut owner = owner(attempt_id, runtime_turn_id, native_session_id);
        owner.engine = EngineType::Claude;
        owner.execution_target_snapshot.engine = "claude".to_string();
        owner.binding_key = "claude::managed-a".to_string();
        owner
    }

    #[test]
    fn provider_engine_events_settle_exact_shared_attempts() {
        for engine in [EngineType::Kimi, EngineType::Grok, EngineType::OpenCode] {
            let coordinator = SharedRuntimeCoordinator::default();
            let runtime_turn_id = format!("{}-turn-1", engine_token(engine));
            let native_session_id = format!("{}-session-1", engine_token(engine));
            let mut engine_owner = owner(
                &format!("attempt-{}", engine_token(engine)),
                Some(&runtime_turn_id),
                None,
            );
            engine_owner.engine = engine;
            engine_owner.binding_key = format!("{}::managed-a", engine_token(engine));
            engine_owner.execution_target_snapshot.engine = engine_token(engine).to_string();
            coordinator
                .register_attempt(engine_owner)
                .expect("register provider engine owner");

            coordinator.ingest_engine_event_with_replay_scoped(
                TEST_PROVIDER_RUNTIME_KEY,
                engine,
                Some(&runtime_turn_id),
                None,
                &EngineEvent::SessionStarted {
                    workspace_id: "ws-1".to_string(),
                    session_id: native_session_id.clone(),
                    engine,
                    turn_id: Some(runtime_turn_id.clone()),
                },
                Vec::new(),
            );
            coordinator.ingest_engine_event_with_replay_scoped(
                TEST_PROVIDER_RUNTIME_KEY,
                engine,
                Some(&runtime_turn_id),
                Some(&native_session_id),
                &EngineEvent::TextDelta {
                    workspace_id: "ws-1".to_string(),
                    text: format!("{} response", engine_token(engine)),
                },
                Vec::new(),
            );
            let settled = coordinator
                .ingest_engine_event_with_replay_scoped(
                    TEST_PROVIDER_RUNTIME_KEY,
                    engine,
                    Some(&runtime_turn_id),
                    Some(&native_session_id),
                    &EngineEvent::TurnCompleted {
                        workspace_id: "ws-1".to_string(),
                        result: Some(json!({ "status": "completed" })),
                    },
                    Vec::new(),
                )
                .settled
                .expect("provider engine terminal settles owner");

            assert_eq!(settled.owner.engine, engine);
            // local CLIs normalize to `engine:{raw}` so hide set / catalog match.
            let expected_native = format!("{}:{}", engine_token(engine), native_session_id);
            assert_eq!(
                settled.owner.native_session_id.as_deref(),
                Some(expected_native.as_str()),
            );
            assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Completed);
        }
    }

    #[test]
    fn claude_raw_result_settles_shared_attempt_before_process_cleanup() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(claude_owner(
                "attempt-claude-result",
                Some("run-claude-result"),
                Some("claude:native-claude-result"),
            ))
            .expect("register");

        coordinator.ingest_engine_event(
            EngineType::Claude,
            Some("run-claude-result"),
            Some("claude:native-claude-result"),
            &EngineEvent::TextDelta {
                workspace_id: "ws-1".to_string(),
                text: "你好".to_string(),
            },
        );
        let result_observation = coordinator.ingest_engine_event(
            EngineType::Claude,
            Some("run-claude-result"),
            Some("claude:native-claude-result"),
            &EngineEvent::Raw {
                workspace_id: "ws-1".to_string(),
                engine: EngineType::Claude,
                data: json!({
                    "type": "result",
                    "subtype": "success",
                    "is_error": false,
                    "terminal_reason": "completed",
                    "stop_reason": "end_turn",
                    "result": "你好"
                }),
            },
        );
        let settled = result_observation
            .settled
            .expect("Claude result must settle the Shared attempt immediately");

        assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Completed);
        assert_eq!(
            settled.final_snapshot.stop_reason.as_deref(),
            Some("completed")
        );
        assert_eq!(
            settled.final_snapshot.assistant_blocks,
            vec![CanonicalBlock::Text {
                text: "你好".to_string(),
            }]
        );

        let cleanup_completion = coordinator.ingest_engine_event(
            EngineType::Claude,
            Some("run-claude-result"),
            Some("claude:native-claude-result"),
            &EngineEvent::TurnCompleted {
                workspace_id: "ws-1".to_string(),
                result: Some(json!({ "text": "你好" })),
            },
        );
        assert!(
            cleanup_completion.settled.is_none(),
            "late cleanup completion must not settle or duplicate the Shared turn again"
        );
    }

    #[test]
    fn claude_raw_error_result_settles_shared_attempt_as_failed() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(claude_owner(
                "attempt-claude-error-result",
                Some("run-claude-error-result"),
                Some("claude:native-claude-error-result"),
            ))
            .expect("register");

        let settled = coordinator
            .ingest_engine_event(
                EngineType::Claude,
                Some("run-claude-error-result"),
                Some("claude:native-claude-error-result"),
                &EngineEvent::Raw {
                    workspace_id: "ws-1".to_string(),
                    engine: EngineType::Claude,
                    data: json!({
                        "type": "result",
                        "subtype": "error_during_execution",
                        "is_error": true,
                        "api_error_status": "rate_limited",
                        "result": "provider request failed"
                    }),
                },
            )
            .settled
            .expect("failed Claude result must settle the Shared attempt");

        assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Failed);
        assert_eq!(
            settled.final_snapshot.error_code.as_deref(),
            Some("rate_limited")
        );
        assert_eq!(
            settled.final_snapshot.error_message.as_deref(),
            Some("provider request failed")
        );
        assert!(settled.final_snapshot.assistant_blocks.is_empty());
    }

    #[test]
    fn claude_non_result_raw_event_does_not_settle_shared_attempt() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(claude_owner(
                "attempt-claude-raw-progress",
                Some("run-claude-raw-progress"),
                Some("claude:native-claude-raw-progress"),
            ))
            .expect("register");

        let observation = coordinator.ingest_engine_event(
            EngineType::Claude,
            Some("run-claude-raw-progress"),
            Some("claude:native-claude-raw-progress"),
            &EngineEvent::Raw {
                workspace_id: "ws-1".to_string(),
                engine: EngineType::Claude,
                data: json!({
                    "type": "system",
                    "subtype": "thinking_tokens",
                    "estimated_tokens": 3
                }),
            },
        );

        assert!(observation.settled.is_none());
        assert!(coordinator
            .settled_for_attempt("attempt-claude-raw-progress")
            .is_none());
    }

    #[test]
    fn codex_terminal_preserves_rich_blocks_tools_artifacts_and_failure() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner("attempt-1", Some("run-1"), Some("native-1")))
            .expect("register");

        let events = [
            json!({
                "method": "item/reasoning/textDelta",
                "params": {"threadId": "native-1", "turnId": "run-1", "delta": "think "}
            }),
            json!({
                "method": "item/agentMessage/delta",
                "params": {"threadId": "native-1", "turnId": "run-1", "delta": "answer"}
            }),
            json!({
                "method": "item/started",
                "params": {
                    "threadId": "native-1",
                    "turnId": "run-1",
                    "item": {
                        "id": "tool-1",
                        "type": "commandExecution",
                        "tool": "exec",
                        "arguments": {"cmd": "pwd"}
                    }
                }
            }),
            json!({
                "method": "item/completed",
                "params": {
                    "threadId": "native-1",
                    "turnId": "run-1",
                    "item": {
                        "id": "tool-1",
                        "type": "commandExecution",
                        "tool": "exec",
                        "output": "ok",
                        "artifactRef": {
                            "artifactId": "artifact-1",
                            "mediaType": "text/plain",
                            "sizeBytes": 2,
                            "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                            "locator": "artifact://artifact-1"
                        }
                    }
                }
            }),
            json!({
                "method": "turn/error",
                "params": {
                    "threadId": "native-1",
                    "turnId": "run-1",
                    "code": "provider_rejected",
                    "message": "provider rejected request"
                }
            }),
        ];
        let mut terminal = None;
        for event in events {
            let observation = coordinator.ingest_codex_event("ws-1", &event);
            terminal = terminal.or(observation.settled);
        }
        let settled = terminal.expect("settled");
        assert_eq!(settled.owner.attempt_id, "attempt-1");
        assert_eq!(settled.final_snapshot.assistant_blocks.len(), 2);
        assert!(matches!(
            settled.final_snapshot.assistant_blocks[0],
            CanonicalBlock::Reasoning { .. }
        ));
        assert!(matches!(
            settled.final_snapshot.assistant_blocks[1],
            CanonicalBlock::Text { .. }
        ));
        assert_eq!(settled.final_snapshot.tool_calls.len(), 1);
        assert_eq!(settled.final_snapshot.tool_results.len(), 1);
        assert_eq!(settled.final_snapshot.artifacts.len(), 1);
        assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Failed);
        assert_eq!(
            settled.final_snapshot.error_code.as_deref(),
            Some("provider_rejected")
        );
        assert_eq!(
            settled.final_snapshot.error_message.as_deref(),
            Some("provider rejected request")
        );
    }

    #[test]
    fn codex_command_execution_argv_array_is_joined_into_summary() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner("attempt-argv", Some("run-argv"), Some("native-argv")))
            .expect("register");
        let events = [
            json!({
                "method": "item/started",
                "params": {
                    "threadId": "native-argv",
                    "turnId": "run-argv",
                    "item": {
                        "id": "cmd-1",
                        "type": "commandExecution",
                        "command": ["cat", "README.md"],
                        "cwd": "/repo",
                        "status": "inProgress"
                    }
                }
            }),
            json!({
                "method": "item/completed",
                "params": {
                    "threadId": "native-argv",
                    "turnId": "run-argv",
                    "item": {
                        "id": "cmd-1",
                        "type": "commandExecution",
                        "command": ["cat", "README.md"],
                        "cwd": "/repo",
                        "status": "completed",
                        "aggregatedOutput": "# Title\n"
                    }
                }
            }),
            json!({
                "method": "item/agentMessage/delta",
                "params": {"threadId": "native-argv", "turnId": "run-argv", "delta": "ok"}
            }),
            json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "native-argv",
                    "turnId": "run-argv",
                    "status": "completed"
                }
            }),
        ];
        let mut settled = None;
        for event in events {
            let observation = coordinator.ingest_codex_event("ws-1", &event);
            settled = settled.or(observation.settled);
        }
        let settled = settled.expect("settled");
        assert_eq!(settled.final_snapshot.tool_calls.len(), 1);
        let summary = settled.final_snapshot.tool_calls[0]
            .arguments_summary
            .as_deref()
            .unwrap_or("");
        assert!(
            summary.contains("cat") && summary.contains("README.md"),
            "argv[] command must be joined into summary, got: {summary}"
        );
    }

    #[test]
    fn codex_apply_patch_custom_tool_call_is_captured_as_tool_exchange() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner("attempt-ap", Some("run-ap"), Some("native-ap")))
            .expect("register");
        let patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** End Patch\n";
        let events = [
            json!({
                "method": "item/started",
                "params": {
                    "threadId": "native-ap",
                    "turnId": "run-ap",
                    "item": {
                        "id": "call-ap",
                        "type": "custom_tool_call",
                        "name": "apply_patch",
                        "input": patch,
                        "status": "inProgress"
                    }
                }
            }),
            json!({
                "method": "item/completed",
                "params": {
                    "threadId": "native-ap",
                    "turnId": "run-ap",
                    "item": {
                        "id": "call-ap",
                        "type": "custom_tool_call",
                        "name": "apply_patch",
                        "input": patch,
                        "status": "completed",
                        "output": "Success. Updated the following files:\nM src/a.ts"
                    }
                }
            }),
            json!({
                "method": "item/agentMessage/delta",
                "params": {"threadId": "native-ap", "turnId": "run-ap", "delta": "ok"}
            }),
            json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "native-ap",
                    "turnId": "run-ap",
                    "status": "completed"
                }
            }),
        ];
        let mut settled = None;
        for event in events {
            let observation = coordinator.ingest_codex_event("ws-1", &event);
            settled = settled.or(observation.settled);
        }
        let settled = settled.expect("settled");
        assert_eq!(settled.final_snapshot.tool_calls.len(), 1);
        assert_eq!(
            settled.final_snapshot.tool_calls[0].tool_name,
            "apply_patch"
        );
        let summary = settled.final_snapshot.tool_calls[0]
            .arguments_summary
            .as_deref()
            .unwrap_or("");
        assert!(
            summary.contains("Begin Patch") && summary.contains("src/a.ts"),
            "apply_patch input must be packed for history, got: {summary}"
        );
    }

    #[test]
    fn codex_file_change_item_preserves_changes_in_tool_arguments_summary() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner("attempt-fc", Some("run-fc"), Some("native-fc")))
            .expect("register");

        let events = [
            json!({
                "method": "item/started",
                "params": {
                    "threadId": "native-fc",
                    "turnId": "run-fc",
                    "item": {
                        "id": "fc-1",
                        "type": "fileChange",
                        "status": "inProgress",
                        "changes": [{
                            "path": "src/keep.ts",
                            "kind": "update",
                            "diff": "--- a\n+++ b\n@@\n-old\n+new"
                        }]
                    }
                }
            }),
            json!({
                "method": "item/completed",
                "params": {
                    "threadId": "native-fc",
                    "turnId": "run-fc",
                    "item": {
                        "id": "fc-1",
                        "type": "fileChange",
                        "status": "completed",
                        "changes": [{
                            "path": "src/keep.ts",
                            "kind": "update",
                            "diff": "--- a\n+++ b\n@@\n-old\n+new"
                        }]
                    }
                }
            }),
            json!({
                "method": "item/agentMessage/delta",
                "params": {"threadId": "native-fc", "turnId": "run-fc", "delta": "done"}
            }),
            json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "native-fc",
                    "turnId": "run-fc",
                    "status": "completed"
                }
            }),
        ];
        let mut settled = None;
        for event in events {
            let observation = coordinator.ingest_codex_event("ws-1", &event);
            settled = settled.or(observation.settled);
        }
        let settled = settled.expect("settled");
        assert_eq!(settled.final_snapshot.tool_calls.len(), 1);
        let summary = settled.final_snapshot.tool_calls[0]
            .arguments_summary
            .as_deref()
            .unwrap_or("");
        assert!(
            summary.contains("src/keep.ts") && summary.contains("changes"),
            "fileChange changes[] must be packed into arguments_summary for history projection, got: {summary}"
        );
        assert_eq!(
            settled.final_snapshot.tool_calls[0]
                .tool_name
                .to_ascii_lowercase(),
            "filechange"
        );
    }

    #[test]
    fn codex_non_retry_error_settles_failed_before_transport_completion() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner(
                "attempt-provider-rejected",
                Some("run-provider-rejected"),
                Some("native-provider-rejected"),
            ))
            .expect("register");

        let failed = coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "error",
                "params": {
                    "threadId": "native-provider-rejected",
                    "turnId": "run-provider-rejected",
                    "willRetry": false,
                    "error": {
                        "code": "invalid_prompt",
                        "message": "unknown model 'gpt-5.6-sol'"
                    }
                }
            }),
        );
        let settled = failed.settled.expect("non-retry error must settle");
        assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Failed);
        assert_eq!(
            settled.final_snapshot.error_code.as_deref(),
            Some("invalid_prompt")
        );
        assert_eq!(
            settled.final_snapshot.error_message.as_deref(),
            Some("unknown model 'gpt-5.6-sol'")
        );

        let duplicate_completion = coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "native-provider-rejected",
                    "turnId": "run-provider-rejected"
                }
            }),
        );
        assert!(duplicate_completion.settled.is_none());
        assert_eq!(
            coordinator
                .settled_for_attempt("attempt-provider-rejected")
                .expect("settlement retained")
                .final_snapshot
                .outcome,
            OutcomeStatus::Failed
        );
    }

    #[test]
    fn codex_retrying_error_remains_non_terminal() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner(
                "attempt-provider-retry",
                Some("run-provider-retry"),
                Some("native-provider-retry"),
            ))
            .expect("register");

        let observation = coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "error",
                "params": {
                    "threadId": "native-provider-retry",
                    "turnId": "run-provider-retry",
                    "willRetry": true,
                    "error": {
                        "code": "rate_limited",
                        "message": "retrying"
                    }
                }
            }),
        );

        assert!(observation.settled.is_none());
        assert!(coordinator
            .settled_for_attempt("attempt-provider-retry")
            .is_none());
    }

    #[test]
    fn codex_failed_terminal_without_code_gets_canonical_fallback() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner(
                "attempt-codex-no-code",
                Some("run-codex-no-code"),
                Some("native-codex-no-code"),
            ))
            .expect("register");

        let settled = coordinator
            .ingest_codex_event(
                "ws-1",
                &json!({
                    "method": "turn/completed",
                    "params": {
                        "threadId": "native-codex-no-code",
                        "turnId": "run-codex-no-code",
                        "status": "failed",
                        "message": "provider returned no error code"
                    }
                }),
            )
            .settled
            .expect("settled");

        assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Failed);
        assert_eq!(
            settled.final_snapshot.error_code.as_deref(),
            Some(UNCLASSIFIED_RUNTIME_FAILURE_CODE)
        );

        let fact = crate::shared_event_log::canonical::assembler::assemble_turn_committed(
            settled.owner.logical_turn_id,
            settled.owner.attempt_id,
            "input-codex-no-code".to_string(),
            settled.owner.execution_target_snapshot,
            settled.final_snapshot,
            1,
        )
        .expect("assemble terminal fact");
        crate::shared_event_log::canonical::validator::validate_fact(
            &crate::shared_event_log::canonical::types::CanonicalFact::TurnCommitted(fact),
        )
        .expect("fallback terminal must satisfy canonical contract");
    }

    #[test]
    fn engine_failed_terminal_without_code_gets_canonical_fallback() {
        let coordinator = SharedRuntimeCoordinator::default();
        let mut claude_owner = owner(
            "attempt-engine-no-code",
            Some("run-engine-no-code"),
            Some("native-engine-no-code"),
        );
        claude_owner.engine = EngineType::Claude;
        claude_owner.execution_target_snapshot.engine = "claude".to_string();
        claude_owner.binding_key = "claude::managed-a".to_string();
        coordinator
            .register_attempt(claude_owner)
            .expect("register");

        let settled = coordinator
            .ingest_engine_event(
                EngineType::Claude,
                Some("run-engine-no-code"),
                Some("native-engine-no-code"),
                &EngineEvent::TurnCompleted {
                    workspace_id: "ws-1".to_string(),
                    result: Some(json!({
                        "status": "failed",
                        "message": "runtime returned no error code"
                    })),
                },
            )
            .settled
            .expect("settled");

        assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Failed);
        assert_eq!(
            settled.final_snapshot.error_code.as_deref(),
            Some(UNCLASSIFIED_RUNTIME_FAILURE_CODE)
        );
    }

    #[test]
    fn exact_runtime_turn_wins_over_reused_native_session() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner("attempt-a", Some("run-a"), Some("native-1")))
            .expect("register a");
        coordinator
            .register_attempt(owner("attempt-b", Some("run-b"), Some("native-1")))
            .expect("register b");

        let terminal = coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "turn/completed",
                "params": {"threadId": "native-1", "turnId": "run-a"}
            }),
        );
        assert_eq!(
            terminal
                .settled
                .as_ref()
                .map(|settled| settled.owner.attempt_id.as_str()),
            Some("attempt-a")
        );
        assert!(coordinator.settled_for_attempt("attempt-b").is_none());
    }

    #[test]
    fn missing_runtime_identity_falls_back_to_native_session() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner("attempt-1", None, Some("native-1")))
            .expect("register");

        let terminal = coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "turn/completed",
                "params": {"threadId": "native-1"}
            }),
        );
        assert_eq!(
            terminal
                .settled
                .as_ref()
                .map(|settled| settled.owner.attempt_id.as_str()),
            Some("attempt-1")
        );
    }

    #[test]
    fn early_runtime_events_replay_after_exact_binding() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner("attempt-1", None, None))
            .expect("register");
        coordinator
            .hold_native_session("attempt-1", "native-1")
            .expect("hold");
        let early = coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "item/agentMessage/delta",
                "params": {"threadId": "native-1", "turnId": "run-1", "delta": "early"}
            }),
        );
        assert!(early.ui_fanout_deferred);
        assert_eq!(
            early.ui_fanout_defer_reason,
            Some(SharedRuntimeUiFanoutDeferReason::AwaitingOwnerIdentity)
        );
        assert_eq!(early.deferred_queue_depth, 1);
        assert_eq!(early.unowned_overflow_drop_count, 0);
        coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "turn/completed",
                "params": {"threadId": "native-1", "turnId": "run-1"}
            }),
        );

        coordinator
            .bind_runtime_turn("attempt-1", Some("run-1"), Some("native-1"))
            .expect("bind");
        let barrier_deferred = coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "item/agentMessage/delta",
                "params": {"threadId": "native-1", "turnId": "run-1", "delta": "barrier"}
            }),
        );
        assert!(barrier_deferred.ui_fanout_deferred);
        assert_eq!(
            barrier_deferred.ui_fanout_defer_reason,
            Some(SharedRuntimeUiFanoutDeferReason::ReplayBarrier)
        );
        assert!(barrier_deferred.deferred_queue_depth >= 1);
        let batch = coordinator
            .drain_replay_barrier("attempt-1")
            .expect("drain");
        let settled = batch
            .deliveries
            .iter()
            .find_map(|delivery| delivery.observation.settled.clone())
            .expect("replayed terminal");
        assert!(matches!(
            settled.final_snapshot.assistant_blocks.as_slice(),
            [CanonicalBlock::Text { text }] if text == "early"
        ));
    }

    #[test]
    fn unowned_queue_overflow_reports_bounded_attribution() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner("attempt-overflow", None, None))
            .expect("register");
        coordinator
            .hold_native_session("attempt-overflow", "native-overflow")
            .expect("hold");

        let mut latest = SharedRuntimeObservation::default();
        for index in 0..=MAX_UNOWNED_EVENTS {
            latest = coordinator.ingest_codex_event(
                "ws-1",
                &json!({
                    "method": "item/agentMessage/delta",
                    "params": {
                        "threadId": "native-overflow",
                        "turnId": "run-overflow",
                        "delta": format!("chunk-{index}")
                    }
                }),
            );
        }

        assert!(latest.ui_fanout_deferred);
        assert_eq!(
            latest.ui_fanout_defer_reason,
            Some(SharedRuntimeUiFanoutDeferReason::AwaitingOwnerIdentity)
        );
        assert_eq!(latest.deferred_queue_depth, MAX_UNOWNED_EVENTS);
        assert_eq!(latest.unowned_overflow_drop_count, 1);
    }

    #[test]
    fn terminal_buffered_before_runtime_binding_is_returned_by_bind() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner("attempt-bind", None, None))
            .expect("register identity-less owner");
        coordinator
            .hold_native_session("attempt-bind", "native-bind")
            .expect("hold");
        coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "item/agentMessage/delta",
                "params": {
                    "threadId": "native-bind",
                    "turnId": "run-bind",
                    "delta": "early final"
                }
            }),
        );
        coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "item/reasoning/textDelta",
                "params": {
                    "threadId": "native-bind",
                    "turnId": "run-bind",
                    "delta": "early reasoning"
                }
            }),
        );
        coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "turn/completed",
                "params": {"threadId": "native-bind", "turnId": "run-bind"}
            }),
        );

        coordinator
            .bind_runtime_turn("attempt-bind", Some("run-bind"), Some("native-bind"))
            .expect("bind");
        let batch = coordinator
            .drain_replay_barrier("attempt-bind")
            .expect("drain");
        assert!(!batch.barrier_cleared);
        let settled = batch
            .deliveries
            .iter()
            .find_map(|delivery| delivery.observation.settled.clone())
            .expect("early terminal must be returned");
        assert_eq!(settled.owner.attempt_id, "attempt-bind");
        assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Completed);
        assert!(matches!(
            settled.final_snapshot.assistant_blocks.as_slice(),
            [
                CanonicalBlock::Text { text },
                CanonicalBlock::Reasoning { text: reasoning }
            ] if text == "early final" && reasoning == "early reasoning"
        ));
        let replay = batch
            .deliveries
            .into_iter()
            .flat_map(|delivery| delivery.app_server_events)
            .collect::<Vec<_>>();
        assert_eq!(replay.len(), 3);
        assert_eq!(replay[0].message["params"]["threadId"], "shared:session-1");
        assert_eq!(
            replay[0].message["params"]["sharedOwner"]["executionTargetSnapshot"]["model"],
            "gpt-runtime"
        );
        assert_eq!(replay[1].message["method"], "item/reasoning/textDelta");
        assert_eq!(replay[2].message["method"], "turn/completed");
        assert!(
            coordinator
                .drain_replay_barrier("attempt-bind")
                .expect("clear barrier")
                .barrier_cleared
        );
    }

    #[test]
    fn replay_barrier_orders_early_and_live_ingress_before_atomic_release() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner("attempt-order", None, None))
            .expect("register");
        coordinator
            .hold_native_session("attempt-order", "native-order")
            .expect("hold");
        coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "item/agentMessage/delta",
                "params": {
                    "threadId": "native-order",
                    "turnId": "run-order",
                    "delta": "early-1"
                }
            }),
        );
        coordinator
            .bind_runtime_turn("attempt-order", Some("run-order"), Some("native-order"))
            .expect("bind");

        let queued_observation = coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "item/agentMessage/delta",
                "params": {
                    "threadId": "native-order",
                    "turnId": "run-order",
                    "delta": "live-2"
                }
            }),
        );
        assert!(queued_observation.owner.is_none());

        let first = coordinator
            .drain_replay_barrier("attempt-order")
            .expect("first drain");
        assert!(!first.barrier_cleared);
        let first_deltas = first
            .deliveries
            .iter()
            .filter_map(|delivery| {
                delivery
                    .app_server_events
                    .first()
                    .and_then(|event| event.message.pointer("/params/delta"))
                    .and_then(Value::as_str)
            })
            .collect::<Vec<_>>();
        assert_eq!(first_deltas, vec!["early-1", "live-2"]);
        assert!(first
            .deliveries
            .iter()
            .all(|delivery| delivery.observation.owner.is_some()));
        assert!(first
            .deliveries
            .iter()
            .all(|delivery| delivery.observation.agent_event.is_some()));

        coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "item/agentMessage/delta",
                "params": {
                    "threadId": "native-order",
                    "turnId": "run-order",
                    "delta": "during-drain-3"
                }
            }),
        );
        let second = coordinator
            .drain_replay_barrier("attempt-order")
            .expect("second drain");
        assert_eq!(second.deliveries.len(), 1);
        assert_eq!(
            second.deliveries[0].app_server_events[0].message["params"]["delta"],
            "during-drain-3"
        );
        assert!(!second.barrier_cleared);

        assert!(
            coordinator
                .drain_replay_barrier("attempt-order")
                .expect("atomic release")
                .barrier_cleared
        );
        let direct = coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "item/agentMessage/delta",
                "params": {
                    "threadId": "native-order",
                    "turnId": "run-order",
                    "delta": "direct-4"
                }
            }),
        );
        assert_eq!(
            direct.owner.as_ref().map(|owner| owner.attempt_id.as_str()),
            Some("attempt-order")
        );
    }

    #[test]
    fn replay_barrier_filters_duplicate_terminal() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner("attempt-terminal", None, None))
            .expect("register");
        coordinator
            .bind_runtime_turn(
                "attempt-terminal",
                Some("run-terminal"),
                Some("native-terminal"),
            )
            .expect("bind");
        let terminal = json!({
            "method": "turn/error",
            "params": {
                "threadId": "native-terminal",
                "turnId": "run-terminal",
                "code": "runtime_error",
                "message": "failed"
            }
        });
        coordinator.ingest_codex_event("ws-1", &terminal);
        coordinator.ingest_codex_event("ws-1", &terminal);

        let batch = coordinator
            .drain_replay_barrier("attempt-terminal")
            .expect("drain");
        assert_eq!(
            batch
                .deliveries
                .iter()
                .filter(|delivery| delivery.observation.settled.is_some())
                .count(),
            1
        );
        assert_eq!(
            batch
                .deliveries
                .iter()
                .flat_map(|delivery| delivery.app_server_events.iter())
                .filter(|event| event.message["method"] == "turn/error")
                .count(),
            1
        );
    }

    #[test]
    fn duplicate_terminal_settles_once() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner("attempt-1", Some("run-1"), Some("native-1")))
            .expect("register");
        let event = json!({
            "method": "turn/completed",
            "params": {"threadId": "native-1", "turnId": "run-1"}
        });
        assert!(coordinator
            .ingest_codex_event("ws-1", &event)
            .settled
            .is_some());
        assert!(coordinator
            .ingest_codex_event("ws-1", &event)
            .settled
            .is_none());
        assert!(coordinator.settled_for_attempt("attempt-1").is_some());
        assert!(coordinator.settled_for_attempt("attempt-1").is_some());
        coordinator.remove_attempt("attempt-1");
        assert!(coordinator.settled_for_attempt("attempt-1").is_none());
    }

    #[test]
    fn codex_nested_replaced_completion_preserves_replaced_outcome() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner(
                "attempt-replaced",
                Some("run-replaced"),
                Some("native-replaced"),
            ))
            .expect("register");

        let event = json!({
            "method": "turn/completed",
            "params": {
                "threadId": "native-replaced",
                "turn": {
                    "id": "run-replaced",
                    "status": "replaced"
                }
            }
        });
        let settled = coordinator
            .ingest_codex_event("ws-1", &event)
            .settled
            .expect("nested replaced terminal");

        assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Replaced);
    }

    #[test]
    fn completion_outcome_falls_through_supported_nested_aliases() {
        let params = json!({
            "turn": {"id": "run-replaced"},
            "result": {"status": "replaced"}
        });

        assert_eq!(completion_outcome(Some(&params)), OutcomeStatus::Replaced);
    }

    #[test]
    fn claude_equivalent_full_observations_and_terminal_fallback_are_canonicalized_once() {
        let coordinator = SharedRuntimeCoordinator::default();
        let mut claude_owner = owner("attempt-claude-dedup", Some("run-1"), Some("native-1"));
        claude_owner.engine = EngineType::Claude;
        claude_owner.execution_target_snapshot.engine = "claude".to_string();
        claude_owner.binding_key = "claude::managed-a".to_string();
        coordinator
            .register_attempt(claude_owner)
            .expect("register");

        let reasoning =
            "This is one complete reasoning observation that must only be persisted once.";
        let answer =
            "这是一个足够长的完整回答，用来验证 Claude Shared 的重复 observation 只会持久化一次。";
        for text in [reasoning, reasoning] {
            coordinator.ingest_engine_event(
                EngineType::Claude,
                Some("run-1"),
                Some("native-1"),
                &EngineEvent::ReasoningDelta {
                    workspace_id: "ws-1".to_string(),
                    text: text.to_string(),
                },
            );
        }
        for text in [answer, answer] {
            coordinator.ingest_engine_event(
                EngineType::Claude,
                Some("run-1"),
                Some("native-1"),
                &EngineEvent::TextDelta {
                    workspace_id: "ws-1".to_string(),
                    text: text.to_string(),
                },
            );
        }

        let settled = coordinator
            .ingest_engine_event(
                EngineType::Claude,
                Some("run-1"),
                Some("native-1"),
                &EngineEvent::TurnCompleted {
                    workspace_id: "ws-1".to_string(),
                    result: Some(json!({"text": format!("{answer}{answer}")})),
                },
            )
            .settled
            .expect("settled");

        assert_eq!(
            settled.final_snapshot.assistant_blocks,
            vec![
                CanonicalBlock::Reasoning {
                    text: reasoning.to_string(),
                },
                CanonicalBlock::Text {
                    text: answer.to_string(),
                },
            ]
        );
    }

    #[test]
    fn codex_equivalent_deltas_keep_existing_append_semantics() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner(
                "attempt-codex-append",
                Some("run-1"),
                Some("native-1"),
            ))
            .expect("register");
        let answer = "This long Codex delta is intentionally sent twice to preserve its semantics.";
        for _ in 0..2 {
            coordinator.ingest_codex_event(
                "ws-1",
                &json!({
                    "method": "item/agentMessage/delta",
                    "params": {"threadId": "native-1", "turnId": "run-1", "delta": answer}
                }),
            );
        }
        let settled = coordinator
            .ingest_codex_event(
                "ws-1",
                &json!({
                    "method": "turn/completed",
                    "params": {"threadId": "native-1", "turnId": "run-1"}
                }),
            )
            .settled
            .expect("settled");

        assert!(matches!(
            settled.final_snapshot.assistant_blocks.as_slice(),
            [CanonicalBlock::Text { text }] if text == &format!("{answer}{answer}")
        ));
    }

    #[test]
    fn partial_delta_is_monotonically_completed_by_full_terminal_text() {
        let coordinator = SharedRuntimeCoordinator::default();
        let mut claude_owner = owner("attempt-1", Some("run-1"), Some("native-1"));
        claude_owner.engine = EngineType::Claude;
        claude_owner.execution_target_snapshot.engine = "claude".to_string();
        claude_owner.binding_key = "claude::managed-a".to_string();
        coordinator
            .register_attempt(claude_owner)
            .expect("register");

        coordinator.ingest_engine_event(
            EngineType::Claude,
            Some("run-1"),
            Some("native-1"),
            &EngineEvent::TextDelta {
                workspace_id: "ws-1".to_string(),
                text: "partial".to_string(),
            },
        );
        let settled = coordinator
            .ingest_engine_event(
                EngineType::Claude,
                Some("run-1"),
                Some("native-1"),
                &EngineEvent::TurnCompleted {
                    workspace_id: "ws-1".to_string(),
                    result: Some(json!({"text": "partial complete"})),
                },
            )
            .settled
            .expect("settled");

        assert!(matches!(
            settled.final_snapshot.assistant_blocks.as_slice(),
            [CanonicalBlock::Text { text }] if text == "partial complete"
        ));
    }

    #[test]
    fn unrelated_terminal_text_does_not_overwrite_streamed_text() {
        let coordinator = SharedRuntimeCoordinator::default();
        let mut claude_owner = owner("attempt-1", Some("run-1"), Some("native-1"));
        claude_owner.engine = EngineType::Claude;
        claude_owner.execution_target_snapshot.engine = "claude".to_string();
        claude_owner.binding_key = "claude::managed-a".to_string();
        coordinator
            .register_attempt(claude_owner)
            .expect("register");

        coordinator.ingest_engine_event(
            EngineType::Claude,
            Some("run-1"),
            Some("native-1"),
            &EngineEvent::TextDelta {
                workspace_id: "ws-1".to_string(),
                text: "streamed partial".to_string(),
            },
        );
        let settled = coordinator
            .ingest_engine_event(
                EngineType::Claude,
                Some("run-1"),
                Some("native-1"),
                &EngineEvent::TurnCompleted {
                    workspace_id: "ws-1".to_string(),
                    result: Some(json!({"text": "independent final"})),
                },
            )
            .settled
            .expect("settled");

        assert!(matches!(
            settled.final_snapshot.assistant_blocks.as_slice(),
            [
                CanonicalBlock::Text { text: streamed },
                CanonicalBlock::Text { text: terminal }
            ] if streamed == "streamed partial" && terminal == "independent final"
        ));
    }

    #[test]
    fn stale_native_event_is_not_replayed_after_exact_runtime_binding() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner("attempt-new", None, None))
            .expect("register");

        coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "turn/completed",
                "params": {"threadId": "native-1", "turnId": "run-old"}
            }),
        );

        let replayed = coordinator
            .bind_runtime_turn("attempt-new", Some("run-new"), Some("native-1"))
            .expect("bind");
        assert!(replayed.is_none());
        assert!(coordinator.settled_for_attempt("attempt-new").is_none());
    }

    #[test]
    fn coordinator_ownership_is_not_rehydrated_after_restart() {
        let coordinator = SharedRuntimeCoordinator::default();
        assert!(!coordinator.owns_attempt("attempt-1"));
        coordinator
            .register_attempt(owner("attempt-1", Some("run-1"), Some("native-1")))
            .expect("register");
        assert!(coordinator.owns_attempt("attempt-1"));

        let restarted = SharedRuntimeCoordinator::default();
        assert!(!restarted.owns_attempt("attempt-1"));
    }

    #[tokio::test]
    async fn settlement_wait_is_exact_attempt_scoped_and_survives_early_terminal() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner("attempt-a", Some("run-a"), Some("native-a")))
            .expect("register attempt a");
        coordinator
            .register_attempt(owner("attempt-b", Some("run-b"), Some("native-b")))
            .expect("register attempt b");

        coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "native-b",
                    "turnId": "run-b"
                }
            }),
        );
        tokio::time::timeout(
            std::time::Duration::from_millis(5),
            coordinator.wait_for_settlement("attempt-a"),
        )
        .await
        .expect_err("attempt b terminal must leave attempt a pending");
        assert!(coordinator.owns_attempt("attempt-a"));

        coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "native-a",
                    "turnId": "run-a"
                }
            }),
        );
        let settled = coordinator
            .wait_for_settlement("attempt-a")
            .await
            .expect("settlement retained");
        assert_eq!(settled.owner.attempt_id, "attempt-a");
    }

    #[tokio::test]
    async fn settlement_wait_returns_none_after_critical_sink_removes_owner() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner(
                "attempt-removed",
                Some("run-removed"),
                Some("native-removed"),
            ))
            .expect("register");
        coordinator.remove_attempt("attempt-removed");

        assert!(coordinator
            .wait_for_settlement("attempt-removed")
            .await
            .is_none());
    }

    #[tokio::test]
    async fn settlement_wait_wakes_all_observers_for_the_same_attempt() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner(
                "attempt-multi-waiter",
                Some("run-multi-waiter"),
                Some("native-multi-waiter"),
            ))
            .expect("register");
        let first_coordinator = coordinator.clone();
        let first_waiter = tokio::spawn(async move {
            first_coordinator
                .wait_for_settlement("attempt-multi-waiter")
                .await
        });
        let second_coordinator = coordinator.clone();
        let second_waiter = tokio::spawn(async move {
            second_coordinator
                .wait_for_settlement("attempt-multi-waiter")
                .await
        });
        tokio::task::yield_now().await;

        coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "native-multi-waiter",
                    "turnId": "run-multi-waiter"
                }
            }),
        );

        for waiter in [first_waiter, second_waiter] {
            let settled = tokio::time::timeout(std::time::Duration::from_secs(1), waiter)
                .await
                .expect("all observers must wake")
                .expect("waiter task")
                .expect("settlement");
            assert_eq!(settled.owner.attempt_id, "attempt-multi-waiter");
        }
    }

    #[tokio::test]
    async fn claude_replay_echo_acknowledges_exact_context_marker() {
        let coordinator = SharedRuntimeCoordinator::default();
        let mut claude_owner = owner("attempt-1", Some("run-1"), Some("native-1"));
        claude_owner.engine = EngineType::Claude;
        claude_owner.execution_target_snapshot.engine = "claude".to_string();
        claude_owner.binding_key = "claude::managed-a".to_string();
        claude_owner.context_marker = Some(SharedRuntimeContextMarker {
            package_id: "package-1".to_string(),
            source_checksum: "checksum-1".to_string(),
        });
        coordinator
            .register_attempt(claude_owner)
            .expect("register");

        let replay_event = EngineEvent::Raw {
            workspace_id: "ws-1".to_string(),
            engine: EngineType::Claude,
            data: json!({
                "type": "user",
                "isReplay": true,
                "message": {
                    "role": "user",
                    "content": "DOGE_CONTEXT_PACKAGE:package-1:checksum-1"
                }
            }),
        };
        assert!(is_internal_shared_context_replay_event(&replay_event));
        let observation = coordinator.ingest_engine_event(
            EngineType::Claude,
            Some("run-1"),
            Some("native-1"),
            &replay_event,
        );
        assert!(observation.agent_event.is_none());

        let ack = coordinator
            .wait_for_context_ack("attempt-1", std::time::Duration::from_millis(10))
            .await
            .expect("context ack");
        assert_eq!(ack.package_id, "package-1");
        assert_eq!(ack.source_checksum, "checksum-1");
        assert_eq!(
            coordinator.take_context_ack("attempt-1").expect("take ack"),
            ack
        );
    }

    #[tokio::test]
    async fn replay_barrier_applies_context_ack_without_waiting_for_visible_drain() {
        let coordinator = SharedRuntimeCoordinator::default();
        let mut claude_owner = owner("attempt-ack-barrier", None, None);
        claude_owner.engine = EngineType::Claude;
        claude_owner.execution_target_snapshot.engine = "claude".to_string();
        claude_owner.binding_key = "claude::managed-a".to_string();
        claude_owner.context_marker = Some(SharedRuntimeContextMarker {
            package_id: "package-barrier".to_string(),
            source_checksum: "checksum-barrier".to_string(),
        });
        coordinator
            .register_attempt(claude_owner)
            .expect("register");
        coordinator
            .hold_native_session("attempt-ack-barrier", "native-ack")
            .expect("hold native binding before runtime side effect");

        // Runtime replay echo 可以抢在 send response / bind 之前到达。此时先进入
        // held unowned queue；bind 搬运时必须立即 apply，不能等 visible drain。
        let observation = coordinator.ingest_engine_event(
            EngineType::Claude,
            Some("run-ack"),
            Some("native-ack"),
            &EngineEvent::Raw {
                workspace_id: "ws-1".to_string(),
                engine: EngineType::Claude,
                data: json!({
                    "type": "user",
                    "isReplay": true,
                    "message": {
                        "role": "user",
                        "content": "DOGE_CONTEXT_PACKAGE:package-barrier:checksum-barrier"
                    }
                }),
            },
        );
        assert!(observation.owner.is_none());
        coordinator
            .bind_runtime_turn("attempt-ack-barrier", Some("run-ack"), Some("native-ack"))
            .expect("bind");
        let ack = coordinator
            .wait_for_context_ack("attempt-ack-barrier", std::time::Duration::from_millis(10))
            .await
            .expect("barrier must not delay context ack");
        assert_eq!(ack.package_id, "package-barrier");
        assert!(
            coordinator
                .drain_replay_barrier("attempt-ack-barrier")
                .expect("empty visible drain")
                .barrier_cleared
        );
    }

    #[test]
    fn cancel_intent_reclassifies_runtime_turn_error_as_cancelled() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner(
                "attempt-cancel",
                Some("run-cancel"),
                Some("native-cancel"),
            ))
            .expect("register");
        coordinator
            .mark_cancel_intent("attempt-cancel")
            .expect("mark cancel");

        let settled = coordinator
            .ingest_engine_event(
                EngineType::Codex,
                Some("run-cancel"),
                Some("native-cancel"),
                &EngineEvent::TurnError {
                    workspace_id: "ws-1".to_string(),
                    error: "interrupted by user".to_string(),
                    code: None,
                },
            )
            .settled
            .expect("settled");
        assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Cancelled);
        assert_eq!(
            settled.final_snapshot.stop_reason.as_deref(),
            Some("interrupted")
        );
        assert_eq!(settled.final_snapshot.error_code, None);
    }

    #[test]
    fn clearing_failed_cancel_intent_preserves_runtime_failure() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner(
                "attempt-cancel-failed",
                Some("run-cancel-failed"),
                Some("native-cancel-failed"),
            ))
            .expect("register");
        coordinator
            .mark_cancel_intent("attempt-cancel-failed")
            .expect("mark cancel");
        coordinator.clear_cancel_intent("attempt-cancel-failed");

        let settled = coordinator
            .ingest_engine_event(
                EngineType::Codex,
                Some("run-cancel-failed"),
                Some("native-cancel-failed"),
                &EngineEvent::TurnError {
                    workspace_id: "ws-1".to_string(),
                    error: "provider failed".to_string(),
                    code: Some("provider_error".to_string()),
                },
            )
            .settled
            .expect("settled");
        assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Failed);
        assert_eq!(
            settled.final_snapshot.error_code.as_deref(),
            Some("provider_error")
        );
    }

    #[test]
    fn provider_runtime_scope_isolates_identical_native_and_turn_ids() {
        let coordinator = SharedRuntimeCoordinator::default();
        let mut provider_a = owner("attempt-provider-a", Some("turn-1"), Some("native-1"));
        provider_a.provider_runtime_key = "codex::ws-1::provider-a".to_string();
        provider_a.binding_key = "codex::provider-a".to_string();
        provider_a.execution_target_snapshot.provider_profile_id = Some("provider-a".to_string());
        let mut provider_b = owner("attempt-provider-b", Some("turn-1"), Some("native-1"));
        provider_b.provider_runtime_key = "codex::ws-1::provider-b".to_string();
        provider_b.binding_key = "codex::provider-b".to_string();
        provider_b.execution_target_snapshot.provider_profile_id = Some("provider-b".to_string());

        coordinator
            .register_attempt(provider_a)
            .expect("provider A owner");
        coordinator
            .register_attempt(provider_b)
            .expect("provider B owner with same native identities");

        let text_event = |text: &str| {
            json!({
                "method": "item/agentMessage/delta",
                "params": {
                    "threadId": "native-1",
                    "turnId": "turn-1",
                    "delta": text,
                }
            })
        };
        let completed_event = json!({
            "method": "turn/completed",
            "params": {
                "threadId": "native-1",
                "turnId": "turn-1",
                "status": "completed",
            }
        });

        let observation_a = coordinator.ingest_codex_event_scoped(
            "codex::ws-1::provider-a",
            "ws-1",
            &text_event("answer-a"),
        );
        let observation_b = coordinator.ingest_codex_event_scoped(
            "codex::ws-1::provider-b",
            "ws-1",
            &text_event("answer-b"),
        );
        assert_eq!(
            observation_a
                .owner
                .as_ref()
                .map(|owner| owner.attempt_id.as_str()),
            Some("attempt-provider-a")
        );
        assert_eq!(
            observation_b
                .owner
                .as_ref()
                .map(|owner| owner.attempt_id.as_str()),
            Some("attempt-provider-b")
        );

        let settled_a = coordinator
            .ingest_codex_event_scoped("codex::ws-1::provider-a", "ws-1", &completed_event)
            .settled
            .expect("provider A settled");
        let settled_b = coordinator
            .ingest_codex_event_scoped("codex::ws-1::provider-b", "ws-1", &completed_event)
            .settled
            .expect("provider B settled");
        assert_eq!(settled_a.owner.attempt_id, "attempt-provider-a");
        assert_eq!(settled_b.owner.attempt_id, "attempt-provider-b");
        assert_eq!(
            settled_a.final_snapshot.assistant_blocks,
            vec![CanonicalBlock::Text {
                text: "answer-a".to_string(),
            }]
        );
        assert_eq!(
            settled_b.final_snapshot.assistant_blocks,
            vec![CanonicalBlock::Text {
                text: "answer-b".to_string(),
            }]
        );
    }

    #[test]
    fn claude_raw_native_identity_is_canonical_and_provider_scoped() {
        let coordinator = SharedRuntimeCoordinator::default();
        let claude_owner = |attempt_id: &str, provider: &str| {
            let mut value = owner(attempt_id, Some("turn-1"), Some("claude:session-1"));
            value.engine = EngineType::Claude;
            value.provider_runtime_key = format!("claude::ws-1::{provider}");
            value.binding_key = format!("claude::{provider}");
            value.execution_target_snapshot.engine = "claude".to_string();
            value.execution_target_snapshot.provider_profile_id = Some(provider.to_string());
            value
        };
        coordinator
            .register_attempt(claude_owner("attempt-claude-a", "provider-a"))
            .expect("provider A owner");
        coordinator
            .register_attempt(claude_owner("attempt-claude-b", "provider-b"))
            .expect("provider B owner");

        for (provider, text) in [("provider-a", "answer-a"), ("provider-b", "answer-b")] {
            let observation = coordinator.ingest_engine_event_scoped(
                &format!("claude::ws-1::{provider}"),
                EngineType::Claude,
                Some("turn-1"),
                Some("session-1"),
                &EngineEvent::TextDelta {
                    workspace_id: "ws-1".to_string(),
                    text: text.to_string(),
                },
            );
            assert_eq!(
                observation
                    .owner
                    .as_ref()
                    .and_then(|owner| owner.native_session_id.as_deref()),
                Some("claude:session-1")
            );
        }

        let settled_a = coordinator
            .ingest_engine_event_scoped(
                "claude::ws-1::provider-a",
                EngineType::Claude,
                Some("turn-1"),
                Some("session-1"),
                &EngineEvent::TurnCompleted {
                    workspace_id: "ws-1".to_string(),
                    result: Some(json!({"status": "completed"})),
                },
            )
            .settled
            .expect("provider A settled");
        let settled_b = coordinator
            .ingest_engine_event_scoped(
                "claude::ws-1::provider-b",
                EngineType::Claude,
                Some("turn-1"),
                Some("session-1"),
                &EngineEvent::TurnCompleted {
                    workspace_id: "ws-1".to_string(),
                    result: Some(json!({"status": "completed"})),
                },
            )
            .settled
            .expect("provider B settled");

        assert_eq!(settled_a.owner.attempt_id, "attempt-claude-a");
        assert_eq!(settled_b.owner.attempt_id, "attempt-claude-b");
        assert_eq!(
            settled_a.owner.native_session_id.as_deref(),
            Some("claude:session-1")
        );
        assert_eq!(
            settled_b.owner.native_session_id.as_deref(),
            Some("claude:session-1")
        );
    }

    #[test]
    fn codex_provisioning_holds_first_thread_until_shared_binding() {
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(owner("attempt-provision", None, None))
            .expect("register");
        coordinator
            .hold_native_provisioning("attempt-provision")
            .expect("hold provisioning");

        let early = coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "thread/started",
                "params": {"thread": {"id": "native-provision"}}
            }),
        );
        assert!(early.ui_fanout_deferred);

        coordinator
            .hold_native_session("attempt-provision", "native-provision")
            .expect("hold exact native session");
        assert!(coordinator
            .finish_native_provisioning("attempt-provision")
            .expect("finish provisioning")
            .is_empty());
        coordinator
            .bind_runtime_turn(
                "attempt-provision",
                Some("run-provision"),
                Some("native-provision"),
            )
            .expect("bind exact runtime");
        let batch = coordinator
            .drain_replay_barrier("attempt-provision")
            .expect("drain");
        let projected = batch
            .deliveries
            .iter()
            .flat_map(|delivery| delivery.app_server_events.iter())
            .find(|event| event.message["method"] == "thread/started")
            .expect("projected thread/started");
        assert_eq!(projected.message["params"]["threadId"], "shared:session-1");
        assert_eq!(
            projected.message["params"]["nativeThreadId"],
            "native-provision"
        );
    }

    #[test]
    fn projected_missing_claude_session_has_typed_recovery_reason() {
        let mut claude_owner = owner(
            "attempt-missing-session",
            Some("run-missing-session"),
            Some("claude:missing-session"),
        );
        claude_owner.engine = EngineType::Claude;
        claude_owner.execution_target_snapshot.engine = "claude".to_string();
        let mut event = AppServerEvent {
            workspace_id: "ws-1".to_string(),
            message: json!({
                "method": "turn/error",
                "params": {
                    "threadId": "missing-session",
                    "error": "No conversation found with session ID: missing-session"
                }
            }),
        };

        project_app_server_event_to_shared_owner(&mut event, &claude_owner);

        assert_eq!(
            event.message["params"]["sharedRecoveryReason"],
            "native-session-not-found"
        );
    }

    #[test]
    fn projection_rewrites_shared_owner_before_ui_fanout() {
        let owner = owner("attempt-1", Some("run-1"), Some("native-1"));
        let mut event = AppServerEvent {
            workspace_id: "ws-1".to_string(),
            message: json!({
                "method": "item/reasoning/textDelta",
                "params": {
                    "threadId": "native-1",
                    "turnId": "run-1",
                    "delta": "thinking"
                }
            }),
        };
        project_app_server_event_to_shared_owner(&mut event, &owner);
        assert_eq!(event.message["params"]["threadId"], "shared:session-1");
        assert_eq!(event.message["params"]["nativeThreadId"], "native-1");
        assert_eq!(event.message["params"]["sharedOwner"]["engine"], "codex");
        assert_eq!(
            event.message["params"]["sharedOwner"]["executionTargetSnapshot"]
                ["modelCatalogEntryId"],
            "catalog-gpt"
        );
        assert_eq!(
            event.message["params"]["sharedOwner"]["executionTargetSnapshot"]["model"],
            "gpt-runtime"
        );
        assert_eq!(
            event.message["params"]["sharedOwner"]["executionTargetSnapshot"]["reasoning"],
            Value::Null
        );
        assert_eq!(
            event.message["params"]["sharedOwner"]["attemptId"],
            "attempt-1"
        );
    }

    #[test]
    fn projection_force_aligns_request_user_input_turn_id_to_runtime_turn() {
        // Claude historically set requestUserInput.turnId to the assistant item
        // id. Shared control-owner resolution requires params.turnId ==
        // sharedOwner.runtimeTurnId; force-align so the dialog is not dropped.
        let owner = owner(
            "attempt-ask",
            Some("runtime-turn-ask"),
            Some("claude:native-ask"),
        );
        let mut event = AppServerEvent {
            workspace_id: "ws-1".to_string(),
            message: json!({
                "method": "item/tool/requestUserInput",
                "id": "ask-req-shared",
                "params": {
                    "threadId": "claude:native-ask",
                    "turnId": "assistant-item-stale",
                    "itemId": "askuserquestion-ask-req-shared",
                    "questions": [{
                        "id": "q-0",
                        "header": "Pick",
                        "question": "Which option?"
                    }],
                    "completed": false
                }
            }),
        };

        project_app_server_event_to_shared_owner(&mut event, &owner);

        assert_eq!(event.message["params"]["threadId"], "shared:session-1");
        assert_eq!(
            event.message["params"]["nativeThreadId"],
            "claude:native-ask"
        );
        assert_eq!(
            event.message["params"]["turnId"], "runtime-turn-ask",
            "control events must overwrite stale assistant-item turnId"
        );
        assert_eq!(event.message["params"]["turn_id"], "runtime-turn-ask");
        assert_eq!(
            event.message["params"]["sharedOwner"]["runtimeTurnId"],
            "runtime-turn-ask"
        );
        assert_eq!(
            event.message["params"]["itemId"], "askuserquestion-ask-req-shared",
            "ask card item id must stay request-scoped"
        );
    }

    #[test]
    fn projection_does_not_overwrite_non_control_existing_turn_id() {
        let owner = owner(
            "attempt-delta",
            Some("runtime-turn-delta"),
            Some("native-delta"),
        );
        let mut event = AppServerEvent {
            workspace_id: "ws-1".to_string(),
            message: json!({
                "method": "item/agentMessage/delta",
                "params": {
                    "threadId": "native-delta",
                    "turnId": "pre-existing-turn",
                    "delta": "hello"
                }
            }),
        };

        project_app_server_event_to_shared_owner(&mut event, &owner);

        assert_eq!(
            event.message["params"]["turnId"], "pre-existing-turn",
            "non-control events keep existing turnId via or_insert"
        );
        assert_eq!(
            event.message["params"]["sharedOwner"]["runtimeTurnId"],
            "runtime-turn-delta"
        );
    }

    #[test]
    fn attempt_owner_rejects_execution_target_rewrite() {
        let coordinator = SharedRuntimeCoordinator::default();
        let durable = owner("attempt-immutable", Some("run-immutable"), Some("native-1"));
        coordinator
            .register_attempt(durable.clone())
            .expect("register durable owner");

        let mut poisoned = durable;
        poisoned.execution_target_snapshot.model =
            Some("poisoned-current-picker-model".to_string());

        assert!(coordinator
            .register_attempt(poisoned)
            .expect_err("target rewrite must fail")
            .contains("owner mismatch"));
    }

    /// 验证 remove_attempt 会清掉 settled_by_attempt。
    /// 这是 abandon 竞态修复的前置契约：必须在 remove 之前读 settled，
    /// 否则 interrupt 与 completion 竞态时会丢失已完成的助手回复。
    #[test]
    fn remove_attempt_clears_settled_evidence() {
        let coordinator = SharedRuntimeCoordinator::default();
        let attempt_owner = owner(
            "attempt-settled-race",
            Some("run-settled"),
            Some("native-settled"),
        );
        coordinator
            .register_attempt(attempt_owner.clone())
            .expect("register");

        // 模拟 interrupt 与 completion 竞态：settled 证据已写入 coordinator。
        let settled = SettledSharedRuntimeAttempt {
            owner: attempt_owner.clone(),
            final_snapshot: RuntimeFinalSnapshot {
                assistant_blocks: vec![],
                assistant_text: None,
                tool_calls: vec![],
                tool_results: vec![],
                artifacts: vec![],
                provider_private_refs: vec![],
                omissions: vec![],
                outcome: OutcomeStatus::Completed,
                error_code: None,
                error_message: None,
                stop_reason: None,
            },
        };
        coordinator
            .inner
            .lock()
            .unwrap()
            .settled_by_attempt
            .insert("attempt-settled-race".to_string(), settled);

        // remove 前 settled 可读。
        assert!(
            coordinator
                .settled_for_attempt("attempt-settled-race")
                .is_some(),
            "settled evidence MUST be readable before remove_attempt"
        );

        // remove 后 settled 被清掉。
        coordinator.remove_attempt("attempt-settled-race");
        assert!(
            coordinator
                .settled_for_attempt("attempt-settled-race")
                .is_none(),
            "settled evidence MUST be cleared after remove_attempt — \
             callers must read settled BEFORE remove"
        );
    }
}
