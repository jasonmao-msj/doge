use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::events::EngineEvent;
use super::EngineType;

const EVENT_SCHEMA_VERSION: &str = "1.0";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AgentEventLane {
    Critical,
    Delta,
    Normal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunSettlementStatus {
    Completed,
    Failed,
    Cancelled,
    Replaced,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEventProvenance {
    pub source: String,
    pub raw_event_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DogeAgentEvent {
    pub schema_version: String,
    pub event_id: String,
    pub sequence: u64,
    pub timestamp_ms: u64,
    pub engine: EngineType,
    pub workspace_id: String,
    pub logical_session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_session_id: Option<String>,
    pub run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    pub kind: String,
    pub lane: AgentEventLane,
    pub payload: Value,
    pub provenance: AgentEventProvenance,
}

#[derive(Debug, Default)]
pub struct AgentEventBusDiagnostics {
    published: AtomicU64,
    coalesced_deltas: AtomicU64,
    duplicate_settlements: AtomicU64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AgentEventBusDiagnosticSnapshot {
    pub published: u64,
    pub coalesced_deltas: u64,
    pub duplicate_settlements: u64,
}

impl AgentEventBusDiagnostics {
    pub fn snapshot(&self) -> AgentEventBusDiagnosticSnapshot {
        AgentEventBusDiagnosticSnapshot {
            published: self.published.load(Ordering::Relaxed),
            coalesced_deltas: self.coalesced_deltas.load(Ordering::Relaxed),
            duplicate_settlements: self.duplicate_settlements.load(Ordering::Relaxed),
        }
    }
}

struct AgentEventSink {
    critical_tx: mpsc::UnboundedSender<DogeAgentEvent>,
    normal_tx: mpsc::Sender<DogeAgentEvent>,
    coalesced_deltas: Arc<Mutex<VecDeque<DogeAgentEvent>>>,
    coalesced_notify_tx: mpsc::UnboundedSender<()>,
}

pub struct AgentEventSubscription {
    critical_rx: mpsc::UnboundedReceiver<DogeAgentEvent>,
    normal_rx: mpsc::Receiver<DogeAgentEvent>,
    coalesced_deltas: Arc<Mutex<VecDeque<DogeAgentEvent>>>,
    coalesced_notify_rx: mpsc::UnboundedReceiver<()>,
}

impl AgentEventSubscription {
    pub async fn recv(&mut self) -> Option<DogeAgentEvent> {
        if let Ok(event) = self.critical_rx.try_recv() {
            return Some(event);
        }
        if let Some(event) = self.coalesced_deltas.lock().ok()?.pop_front() {
            return Some(event);
        }
        tokio::select! {
            biased;
            event = self.critical_rx.recv() => event,
            event = self.normal_rx.recv() => event,
            notification = self.coalesced_notify_rx.recv() => {
                notification?;
                self.coalesced_deltas.lock().ok()?.pop_front()
            }
        }
    }
}

#[derive(Clone)]
pub struct AgentEventBus {
    enabled: Arc<AtomicBool>,
    sequence: Arc<AtomicU64>,
    next_sink_id: Arc<AtomicU64>,
    sinks: Arc<Mutex<HashMap<u64, AgentEventSink>>>,
    settled_runs: Arc<Mutex<HashSet<String>>>,
    diagnostics: Arc<AgentEventBusDiagnostics>,
}

impl Default for AgentEventBus {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentEventBus {
    pub fn new() -> Self {
        Self {
            enabled: Arc::new(AtomicBool::new(
                std::env::var("DOGE_AGENT_EVENT_BUS_ENABLED")
                    .or_else(|_| std::env::var("MOSSX_AGENT_EVENT_BUS_ENABLED"))
                    .as_deref()
                    != Ok("0"),
            )),
            sequence: Arc::new(AtomicU64::new(0)),
            next_sink_id: Arc::new(AtomicU64::new(0)),
            sinks: Arc::new(Mutex::new(HashMap::new())),
            settled_runs: Arc::new(Mutex::new(HashSet::new())),
            diagnostics: Arc::new(AgentEventBusDiagnostics::default()),
        }
    }

    pub fn subscribe(&self, capacity: usize) -> AgentEventSubscription {
        let (critical_tx, critical_rx) = mpsc::unbounded_channel();
        let (normal_tx, normal_rx) = mpsc::channel(capacity.max(1));
        let (coalesced_notify_tx, coalesced_notify_rx) = mpsc::unbounded_channel();
        let coalesced_deltas = Arc::new(Mutex::new(VecDeque::new()));
        let sink_id = self.next_sink_id.fetch_add(1, Ordering::Relaxed);
        self.sinks
            .lock()
            .expect("agent event sinks poisoned")
            .insert(
                sink_id,
                AgentEventSink {
                    critical_tx,
                    normal_tx,
                    coalesced_deltas: Arc::clone(&coalesced_deltas),
                    coalesced_notify_tx,
                },
            );
        AgentEventSubscription {
            critical_rx,
            normal_rx,
            coalesced_deltas,
            coalesced_notify_rx,
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    pub fn diagnostics(&self) -> AgentEventBusDiagnosticSnapshot {
        self.diagnostics.snapshot()
    }

    pub fn publish_engine_event(
        &self,
        engine: EngineType,
        logical_session_id: &str,
        native_session_id: Option<&str>,
        run_id: &str,
        turn_id: Option<&str>,
        event: &EngineEvent,
    ) -> bool {
        if !self.is_enabled() {
            return false;
        }
        let (kind, lane) = classify_engine_event(event);
        if event.is_terminal() {
            let status = if matches!(event, EngineEvent::TurnCompleted { .. }) {
                RunSettlementStatus::Completed
            } else {
                RunSettlementStatus::Failed
            };
            return self.publish_settlement(
                engine,
                logical_session_id,
                native_session_id,
                run_id,
                turn_id,
                status,
                serde_json::to_value(event).unwrap_or(Value::Null),
            );
        }
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        self.publish(DogeAgentEvent {
            schema_version: EVENT_SCHEMA_VERSION.to_string(),
            event_id: format!("{}:{sequence}", event.workspace_id()),
            sequence,
            timestamp_ms: now_ms(),
            engine,
            workspace_id: event.workspace_id().to_string(),
            logical_session_id: logical_session_id.to_string(),
            native_session_id: native_session_id.map(str::to_string),
            run_id: run_id.to_string(),
            turn_id: turn_id.map(str::to_string),
            item_id: event_item_id(event),
            kind: kind.to_string(),
            lane,
            payload: serde_json::to_value(event).unwrap_or(Value::Null),
            provenance: AgentEventProvenance {
                source: "engine-event-shadow-adapter".to_string(),
                raw_event_type: kind.to_string(),
            },
        })
    }

    pub fn publish_settlement(
        &self,
        engine: EngineType,
        logical_session_id: &str,
        native_session_id: Option<&str>,
        run_id: &str,
        turn_id: Option<&str>,
        status: RunSettlementStatus,
        evidence: Value,
    ) -> bool {
        let mut settled_runs = self.settled_runs.lock().expect("settled runs poisoned");
        if !settled_runs.insert(run_id.to_string()) {
            self.diagnostics
                .duplicate_settlements
                .fetch_add(1, Ordering::Relaxed);
            return false;
        }
        drop(settled_runs);
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        self.publish(DogeAgentEvent {
            schema_version: EVENT_SCHEMA_VERSION.to_string(),
            event_id: format!("{logical_session_id}:{sequence}"),
            sequence,
            timestamp_ms: now_ms(),
            engine,
            workspace_id: event_workspace_id(&evidence).unwrap_or_default(),
            logical_session_id: logical_session_id.to_string(),
            native_session_id: native_session_id.map(str::to_string),
            run_id: run_id.to_string(),
            turn_id: turn_id.map(str::to_string),
            item_id: None,
            kind: "run.settled".to_string(),
            lane: AgentEventLane::Critical,
            payload: json!({ "status": status, "evidence": evidence }),
            provenance: AgentEventProvenance {
                source: "runtime-lifecycle-owner".to_string(),
                raw_event_type: "terminal-evidence".to_string(),
            },
        })
    }

    fn publish(&self, event: DogeAgentEvent) -> bool {
        self.diagnostics.published.fetch_add(1, Ordering::Relaxed);
        let mut dead_sink_ids = Vec::new();
        let sinks = self.sinks.lock().expect("agent event sinks poisoned");
        for (sink_id, sink) in sinks.iter() {
            let send_result = match event.lane {
                AgentEventLane::Critical => sink.critical_tx.send(event.clone()).map_err(|_| ()),
                AgentEventLane::Normal => match sink.normal_tx.try_send(event.clone()) {
                    Ok(()) | Err(mpsc::error::TrySendError::Full(_)) => Ok(()),
                    Err(mpsc::error::TrySendError::Closed(_)) => Err(()),
                },
                AgentEventLane::Delta => match sink.normal_tx.try_send(event.clone()) {
                    Ok(()) => Ok(()),
                    Err(mpsc::error::TrySendError::Full(event)) => {
                        let mut pending = sink
                            .coalesced_deltas
                            .lock()
                            .expect("coalesced delta queue poisoned");
                        coalesce_delta(&mut pending, event);
                        let _ = sink.coalesced_notify_tx.send(());
                        self.diagnostics
                            .coalesced_deltas
                            .fetch_add(1, Ordering::Relaxed);
                        Ok(())
                    }
                    Err(mpsc::error::TrySendError::Closed(_)) => Err(()),
                },
            };
            if send_result.is_err() {
                dead_sink_ids.push(*sink_id);
            }
        }
        drop(sinks);
        if !dead_sink_ids.is_empty() {
            let mut sinks = self.sinks.lock().expect("agent event sinks poisoned");
            dead_sink_ids.into_iter().for_each(|sink_id| {
                sinks.remove(&sink_id);
            });
        }
        true
    }
}

fn coalesce_delta(pending: &mut VecDeque<DogeAgentEvent>, event: DogeAgentEvent) {
    if let Some(existing) = pending.iter_mut().find(|existing| {
        existing.logical_session_id == event.logical_session_id
            && existing.turn_id == event.turn_id
            && existing.item_id == event.item_id
            && existing.kind == event.kind
    }) {
        existing.payload = merge_delta_payload(&existing.payload, &event.payload);
        existing.sequence = event.sequence;
        existing.event_id = event.event_id;
        existing.timestamp_ms = event.timestamp_ms;
        return;
    }
    pending.push_back(event);
}

fn merge_delta_payload(left: &Value, right: &Value) -> Value {
    let mut merged = left.clone();
    let left_text = left.get("text").and_then(Value::as_str);
    let right_text = right.get("text").and_then(Value::as_str);
    if let (Some(left_text), Some(right_text), Some(object)) =
        (left_text, right_text, merged.as_object_mut())
    {
        object.insert(
            "text".to_string(),
            Value::String(format!("{left_text}{right_text}")),
        );
        return merged;
    }
    right.clone()
}

fn classify_engine_event(event: &EngineEvent) -> (&'static str, AgentEventLane) {
    match event {
        EngineEvent::SessionStarted { .. } => ("session.started", AgentEventLane::Critical),
        EngineEvent::TurnStarted { .. } => ("run.started", AgentEventLane::Critical),
        EngineEvent::TextDelta { .. } => ("message.delta", AgentEventLane::Delta),
        EngineEvent::ReasoningDelta { .. } => ("reasoning.delta", AgentEventLane::Delta),
        EngineEvent::ToolInputUpdated { .. } => ("tool.input.delta", AgentEventLane::Delta),
        EngineEvent::ToolOutputDelta { .. } => ("tool.output.delta", AgentEventLane::Delta),
        EngineEvent::TurnCompleted { .. } | EngineEvent::TurnError { .. } => {
            ("run.settled", AgentEventLane::Critical)
        }
        EngineEvent::SessionEnded { .. }
        | EngineEvent::ApprovalRequest { .. }
        | EngineEvent::RequestUserInput { .. } => ("control.event", AgentEventLane::Critical),
        EngineEvent::ToolStarted { .. } => ("tool.started", AgentEventLane::Normal),
        EngineEvent::ToolCompleted { .. } => ("tool.completed", AgentEventLane::Normal),
        EngineEvent::UsageUpdate { .. } => ("usage.updated", AgentEventLane::Normal),
        EngineEvent::ProcessingHeartbeat { .. } => ("run.heartbeat", AgentEventLane::Normal),
        EngineEvent::Raw { .. } => ("engine.raw", AgentEventLane::Normal),
    }
}

fn event_item_id(event: &EngineEvent) -> Option<String> {
    match event {
        EngineEvent::ToolStarted { tool_id, .. }
        | EngineEvent::ToolCompleted { tool_id, .. }
        | EngineEvent::ToolInputUpdated { tool_id, .. }
        | EngineEvent::ToolOutputDelta { tool_id, .. } => Some(tool_id.clone()),
        _ => None,
    }
}

fn event_workspace_id(evidence: &Value) -> Option<String> {
    evidence
        .get("workspaceId")
        .or_else(|| evidence.get("workspace_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_delta(text: &str) -> EngineEvent {
        EngineEvent::TextDelta {
            workspace_id: "workspace-1".to_string(),
            text: text.to_string(),
        }
    }

    #[tokio::test]
    async fn slow_sink_never_blocks_publisher_and_deltas_coalesce() {
        let bus = AgentEventBus::new();
        let mut subscription = bus.subscribe(1);
        for index in 0..100 {
            assert!(bus.publish_engine_event(
                EngineType::Kimi,
                "logical-1",
                Some("native-1"),
                "run-1",
                Some("turn-1"),
                &text_delta(&index.to_string()),
            ));
        }
        assert!(bus.diagnostics().coalesced_deltas > 0);
        assert!(subscription.recv().await.is_some());
    }

    #[tokio::test]
    async fn critical_settlement_bypasses_full_normal_lane_and_settles_once() {
        let bus = AgentEventBus::new();
        let mut subscription = bus.subscribe(1);
        bus.publish_engine_event(
            EngineType::Claude,
            "logical-1",
            None,
            "run-normal",
            None,
            &EngineEvent::UsageUpdate {
                workspace_id: "workspace-1".to_string(),
                input_tokens: Some(1),
                output_tokens: Some(1),
                cached_tokens: None,
                model_context_window: None,
                context_used_tokens: None,
                context_usage_source: None,
                context_usage_freshness: None,
                context_used_percent: None,
                context_remaining_percent: None,
                context_tool_usages: None,
                context_tool_usages_truncated: None,
                context_category_usages: None,
            },
        );
        assert!(bus.publish_settlement(
            EngineType::Claude,
            "logical-1",
            None,
            "run-1",
            Some("turn-1"),
            RunSettlementStatus::Cancelled,
            json!({ "workspaceId": "workspace-1" }),
        ));
        assert!(!bus.publish_settlement(
            EngineType::Claude,
            "logical-1",
            None,
            "run-1",
            Some("turn-1"),
            RunSettlementStatus::Replaced,
            json!({ "workspaceId": "workspace-1" }),
        ));
        let settled = subscription.recv().await.expect("critical event");
        assert_eq!(settled.kind, "run.settled");
        assert_eq!(bus.diagnostics().duplicate_settlements, 1);
    }

    #[test]
    fn active_engine_events_share_the_same_shadow_mapping() {
        for engine in [EngineType::Codex, EngineType::Claude, EngineType::Kimi] {
            let bus = AgentEventBus::new();
            let event = EngineEvent::TurnStarted {
                workspace_id: "workspace-1".to_string(),
                turn_id: "turn-1".to_string(),
            };
            assert!(bus.publish_engine_event(
                engine,
                "logical-1",
                None,
                "run-1",
                Some("turn-1"),
                &event,
            ));
        }
    }
}
