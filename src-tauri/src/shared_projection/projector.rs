//! SharedProjector：Canonical Fact → ProjectionItem 映射。

use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};

use crate::shared_event_log::canonical::types::{
    ArtifactRef, CanonicalBlock, CanonicalFact, ControlFact, OutcomeStatus, SquadRunRequestedFact,
    SquadRunSettledFact, ToolResultStatus, TurnCommittedFact, TurnRequestedFact, UsageRecordedFact,
    UsageShape, UsageSource,
};
use crate::shared_event_log::{
    ProjectionCheckpointRow, SharedEventWriter, StoreError, StoredEvent,
};

use super::types::{ProjectionItem, ProjectionItemKind};

fn decode_canonical_fact(event: &StoredEvent) -> Result<CanonicalFact, StoreError> {
    let context = format!(
        "project canonical event session={} sequence={} fact_type={}",
        event.session_id, event.sequence, event.fact_type
    );
    let mut payload = serde_json::from_str::<Value>(&event.payload_json)
        .map_err(|source| StoreError::json(context.clone(), source))?;
    let object = payload.as_object_mut().ok_or_else(|| {
        StoreError::validation_failed(context.clone(), "canonical payload must be a JSON object")
    })?;
    match object.get("type") {
        Some(Value::String(payload_type)) if payload_type == &event.fact_type => {}
        Some(Value::String(payload_type)) => {
            return Err(StoreError::validation_failed(
                context,
                format!(
                    "payload type '{}' conflicts with durable fact_type '{}'",
                    payload_type, event.fact_type
                ),
            ));
        }
        Some(_) => {
            return Err(StoreError::validation_failed(
                context,
                "canonical payload type must be a string",
            ));
        }
        None => {
            object.insert("type".to_string(), Value::String(event.fact_type.clone()));
        }
    }
    serde_json::from_value::<CanonicalFact>(payload)
        .map_err(|source| StoreError::json(context, source))
}

/// Canonical Fact 到 UI 的单向投影器。
#[derive(Debug, Default)]
pub struct SharedProjector;

impl SharedProjector {
    pub fn new() -> Self {
        Self
    }

    /// 把一组 StoredEvent 投影为 ProjectionItem 列表。
    pub fn project_events(
        &self,
        events: &[StoredEvent],
    ) -> Result<Vec<ProjectionItem>, StoreError> {
        let squad_attempts = events
            .iter()
            .filter(|event| event.fact_type == "conversation.turnRequested")
            .filter_map(|event| {
                let payload = serde_json::from_str::<Value>(&event.payload_json).ok()?;
                payload
                    .get("squadWorkerBindingKey")
                    .and_then(Value::as_str)
                    .filter(|value| !value.trim().is_empty())?;
                event.attempt_id.clone()
            })
            .collect::<HashSet<_>>();
        self.project_events_with_squad_attempts(events, &squad_attempts)
    }

    fn project_events_with_squad_attempts(
        &self,
        events: &[StoredEvent],
        squad_attempts: &HashSet<String>,
    ) -> Result<Vec<ProjectionItem>, StoreError> {
        let canonical_turn_ids = events
            .iter()
            .filter(|event| event.fidelity == crate::shared_event_log::Fidelity::Canonical)
            .filter_map(|event| event.logical_turn_id.as_deref())
            .collect::<HashSet<_>>();
        let mut decoded = Vec::with_capacity(events.len());
        // (priority, revision, sequence, usage) — higher wins; used for both metadata emit and
        // stamping final assistant footer fields on TurnCommitted.
        let mut preferred_usage_by_attempt: HashMap<String, (u8, i64, i64, UsageShape)> =
            HashMap::new();
        let mut requested_at_by_attempt: HashMap<String, i64> = HashMap::new();
        for event in events {
            // Legacy/V0 shadow may be appended after its V2 canonical fact. It can keep richer
            // presentation-only content for legacy-only Turns, but it must never downgrade the
            // immutable target of a logical Turn already owned by canonical V2.
            if event.fidelity == crate::shared_event_log::Fidelity::PresentationOnly
                && event
                    .logical_turn_id
                    .as_deref()
                    .is_some_and(|turn_id| canonical_turn_ids.contains(turn_id))
            {
                continue;
            }
            let fact = decode_canonical_fact(event)?;
            if let CanonicalFact::TurnRequested(requested) = &fact {
                requested_at_by_attempt
                    .entry(requested.attempt_id.clone())
                    .or_insert(requested.requested_at);
            }
            if event
                .attempt_id
                .as_ref()
                .is_some_and(|attempt| squad_attempts.contains(attempt))
                && matches!(
                    fact,
                    CanonicalFact::TurnRequested(_)
                        | CanonicalFact::TurnCommitted(_)
                        | CanonicalFact::UsageRecorded(_)
                )
            {
                continue;
            }
            if let CanonicalFact::UsageRecorded(usage) = &fact {
                let priority = match usage.source {
                    UsageSource::RuntimeFinal => 0,
                    UsageSource::ProviderReport => 1,
                };
                preferred_usage_by_attempt
                    .entry(usage.attempt_id.clone())
                    .and_modify(|current| {
                        if (priority, usage.revision, event.sequence)
                            > (current.0, current.1, current.2)
                        {
                            *current = (
                                priority,
                                usage.revision,
                                event.sequence,
                                usage.usage.clone(),
                            );
                        }
                    })
                    .or_insert((
                        priority,
                        usage.revision,
                        event.sequence,
                        usage.usage.clone(),
                    ));
            }
            decoded.push((event, fact));
        }

        let usage_by_attempt = preferred_usage_by_attempt
            .iter()
            .map(|(attempt_id, (_, _, _, usage))| (attempt_id.clone(), usage.clone()))
            .collect::<HashMap<_, _>>();
        let hints = TurnProjectionHints {
            requested_at_by_attempt: &requested_at_by_attempt,
            usage_by_attempt: &usage_by_attempt,
        };

        let mut items = Vec::new();
        for (event, fact) in decoded {
            if let CanonicalFact::UsageRecorded(usage) = &fact {
                let selected_sequence = preferred_usage_by_attempt
                    .get(&usage.attempt_id)
                    .map(|selected| selected.2);
                if selected_sequence != Some(event.sequence) {
                    continue;
                }
            }
            items.extend(self.project_fact(event, &fact, &hints));
        }
        // Usage may land after TurnCommitted (common) or only in an incremental batch.
        // Second pass stamps tokens onto final assistants by turnId so footer meta survives
        // both full rebuild and checkpoint+delta loads.
        stamp_usage_tokens_onto_final_assistants(&mut items);
        Ok(items)
    }

    /// 使用持久化 checkpoint 增量投影；version 不匹配或旧 cache 不可用时全量 rebuild。
    pub fn project(
        &self,
        writer: &SharedEventWriter,
        session_id: &str,
        projection_name: &str,
        projection_version: i64,
    ) -> Result<Vec<ProjectionItem>, StoreError> {
        let checkpoint = writer.get_projection_checkpoint(session_id, projection_name)?;
        let (mut items, through_sequence) = match checkpoint {
            Some(checkpoint) if checkpoint.projection_version == projection_version => {
                match serde_json::from_str::<Vec<ProjectionItem>>(&checkpoint.payload_json) {
                    Ok(items) => (items, checkpoint.through_sequence),
                    Err(_) => {
                        return self.rebuild(
                            writer,
                            session_id,
                            projection_name,
                            projection_version,
                        )
                    }
                }
            }
            _ => {
                return self.rebuild(writer, session_id, projection_name, projection_version);
            }
        };

        let events = writer.read_projection_events(session_id, through_sequence)?;
        if events
            .iter()
            .any(|event| event.fidelity == crate::shared_event_log::Fidelity::PresentationOnly)
        {
            let all_events = writer.events_for_session(session_id)?;
            if all_events
                .iter()
                .any(|event| event.fidelity == crate::shared_event_log::Fidelity::Canonical)
            {
                // ponytail: V0 rollback/shadow writes are rare and projection loads are
                // session-scoped. Rebuild only at this compatibility boundary so canonical
                // precedence can compare against the complete logical-Turn set.
                let items = self.project_events(&all_events)?;
                let new_through_sequence = all_events
                    .iter()
                    .map(|event| event.sequence)
                    .max()
                    .unwrap_or(through_sequence);
                self.persist_checkpoint(
                    writer,
                    session_id,
                    projection_name,
                    projection_version,
                    new_through_sequence,
                    &items,
                )?;
                return Ok(items);
            }
        }
        let squad_attempts = writer
            .squad_attempt_ids_for_session(session_id)?
            .into_iter()
            .collect::<HashSet<_>>();
        let projected = self.project_events_with_squad_attempts(&events, &squad_attempts)?;
        merge_projected_items(&mut items, projected);
        // project_events already stamps within the delta set; re-stamp the merged
        // checkpoint+delta list so late UsageRecorded can patch earlier assistant rows.
        stamp_usage_tokens_onto_final_assistants(&mut items);
        let new_through_sequence = events
            .iter()
            .map(|event| event.sequence)
            .max()
            .unwrap_or(through_sequence);
        self.persist_checkpoint(
            writer,
            session_id,
            projection_name,
            projection_version,
            new_through_sequence,
            &items,
        )?;
        Ok(items)
    }

    /// 全量 rebuild：扫描 session 全部事件，投影并更新 checkpoint。
    ///
    /// rebuild 是幂等的：相同事件流 + 相同 projection_version 产出相同 items 与 checkpoint。
    pub fn rebuild(
        &self,
        writer: &SharedEventWriter,
        session_id: &str,
        projection_name: &str,
        projection_version: i64,
    ) -> Result<Vec<ProjectionItem>, StoreError> {
        let events = writer.events_for_session(session_id)?;
        let items = self.project_events(&events)?;
        let through_sequence = events.iter().map(|event| event.sequence).max().unwrap_or(0);
        self.persist_checkpoint(
            writer,
            session_id,
            projection_name,
            projection_version,
            through_sequence,
            &items,
        )?;
        Ok(items)
    }

    fn persist_checkpoint(
        &self,
        writer: &SharedEventWriter,
        session_id: &str,
        projection_name: &str,
        projection_version: i64,
        through_sequence: i64,
        items: &[ProjectionItem],
    ) -> Result<(), StoreError> {
        let payload_json = serde_json::to_string(items)
            .map_err(|source| StoreError::json("serialize projection checkpoint", source))?;
        writer.upsert_projection_checkpoint(&ProjectionCheckpointRow {
            session_id: session_id.to_string(),
            projection_name: projection_name.to_string(),
            projection_version,
            through_sequence,
            payload_json,
        })
    }

    fn project_fact(
        &self,
        event: &StoredEvent,
        fact: &CanonicalFact,
        hints: &TurnProjectionHints<'_>,
    ) -> Vec<ProjectionItem> {
        match fact {
            CanonicalFact::TurnRequested(f) => self.project_turn_requested(event, f),
            CanonicalFact::TurnCommitted(f) => self.project_turn_committed(event, f, hints),
            CanonicalFact::UsageRecorded(f) => self.project_usage_recorded(event, f),
            CanonicalFact::Control(f) => self.project_control(event, f),
            CanonicalFact::SquadRunRequested(f) => self.project_squad_run_requested(event, f),
            CanonicalFact::SquadRunSettled(f) => self.project_squad_run_settled(event, f),
            _ => vec![],
        }
    }

    fn project_squad_run_requested(
        &self,
        event: &StoredEvent,
        fact: &SquadRunRequestedFact,
    ) -> Vec<ProjectionItem> {
        vec![ProjectionItem {
            id: format!("squad:{}:user", fact.run_id),
            kind: ProjectionItemKind::Message,
            content: json!({
                "role": "user",
                "text": fact.request_text,
                "turnId": format!("squad:{}", fact.run_id),
                "squadRunId": fact.run_id,
                "engineSource": fact.lead_target.engine,
                "executionTargetSnapshot": fact.lead_target,
            }),
            fidelity: event.fidelity,
            checksum: event.payload_checksum.clone(),
        }]
    }

    fn project_squad_run_settled(
        &self,
        event: &StoredEvent,
        fact: &SquadRunSettledFact,
    ) -> Vec<ProjectionItem> {
        let Some(summary) = fact
            .summary
            .as_deref()
            .map(str::trim)
            .filter(|summary| !summary.is_empty())
        else {
            return vec![];
        };
        if fact.status != "succeeded" {
            return vec![];
        }
        let mut content = json!({
            "role": "assistant",
            "text": summary,
            "turnId": format!("squad:{}", fact.run_id),
            "squadRunId": fact.run_id,
            "isFinal": true,
        });
        if let Some(target) = fact.extra.get("target") {
            content["executionTargetSnapshot"] = target.clone();
            if let Some(engine) = target.get("engine") {
                content["engineSource"] = engine.clone();
            }
        }
        if let Some(attempt_id) = fact.extra.get("finalAttemptId") {
            content["squadFinalAttemptId"] = attempt_id.clone();
        }
        vec![ProjectionItem {
            id: format!("squad:{}:assistant", fact.run_id),
            kind: ProjectionItemKind::Message,
            content,
            fidelity: event.fidelity,
            checksum: event.payload_checksum.clone(),
        }]
    }

    fn project_turn_requested(
        &self,
        event: &StoredEvent,
        fact: &TurnRequestedFact,
    ) -> Vec<ProjectionItem> {
        let text = fact.input.text.clone().unwrap_or_default();
        // 用户附图 → user message.images（locator）；禁止投成 generatedImage。
        let images: Vec<String> = fact
            .input
            .image_refs
            .as_ref()
            .map(|refs| {
                refs.iter()
                    .map(|artifact| artifact.locator.trim().to_string())
                    .filter(|locator| !locator.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        let mut content = json!({
            "role": "user",
            "text": text,
            "turnId": fact.logical_turn_id,
            "engineSource": fact.target.engine,
            "executionTargetSnapshot": fact.target,
        });
        if !images.is_empty() {
            if let Some(object) = content.as_object_mut() {
                object.insert("images".to_string(), json!(images));
            }
        }
        vec![ProjectionItem {
            id: format!("{}:user", event.sequence),
            kind: ProjectionItemKind::Message,
            content,
            fidelity: event.fidelity,
            checksum: event.payload_checksum.clone(),
        }]
    }

    fn project_turn_committed(
        &self,
        event: &StoredEvent,
        fact: &TurnCommittedFact,
        hints: &TurnProjectionHints<'_>,
    ) -> Vec<ProjectionItem> {
        let mut items = Vec::new();
        let mut projected_artifact_ids = HashSet::new();
        let mut has_assistant_message = false;
        let checksum = event.payload_checksum.clone();
        let final_meta = build_final_assistant_meta(
            fact.committed_at,
            hints.requested_at_by_attempt.get(&fact.attempt_id).copied(),
            hints.usage_by_attempt.get(&fact.attempt_id),
        );

        // Canvas process-phase collapse only folds process items that sit
        // immediately *before* assistant prose. Emit in Native-compatible order:
        //   process (reasoning / artifacts / tools) → final assistant text
        // Do NOT dump tools after Text — that becomes trailing process (never collapsed).

        // Phase 1: reasoning + inline artifacts from assistant blocks (process)
        let mut deferred_text_blocks: Vec<(usize, &str)> = Vec::new();
        for (index, block) in fact.assistant.blocks.iter().enumerate() {
            match block {
                CanonicalBlock::Text { text } => {
                    deferred_text_blocks.push((index, text.as_str()));
                }
                CanonicalBlock::Reasoning { text } => {
                    items.push(ProjectionItem {
                        id: format!("{}:reasoning:{}", event.sequence, index),
                        kind: ProjectionItemKind::Reasoning,
                        content: json!({
                            "summary": text,
                            "content": text,
                            "engineSource": fact.target.engine,
                            "turnId": fact.logical_turn_id,
                        }),
                        fidelity: event.fidelity,
                        checksum: checksum.clone(),
                    });
                }
                CanonicalBlock::RedactedReasoning { .. } => {
                    items.push(ProjectionItem {
                        id: format!("{}:reasoning:{}", event.sequence, index),
                        kind: ProjectionItemKind::Reasoning,
                        content: json!({
                            "summary": "[redacted]",
                            "content": "[redacted]",
                            "engineSource": fact.target.engine,
                            "turnId": fact.logical_turn_id,
                        }),
                        fidelity: event.fidelity,
                        checksum: checksum.clone(),
                    });
                }
                CanonicalBlock::ArtifactRef { artifact_ref } => {
                    projected_artifact_ids.insert(artifact_ref.artifact_id.clone());
                    let (kind, content) = project_artifact_ref(
                        artifact_ref,
                        &fact.logical_turn_id,
                        &fact.target.engine,
                    );
                    items.push(ProjectionItem {
                        id: projection_artifact_item_id(
                            artifact_ref,
                            format!("{}:artifact:{}", event.sequence, index),
                        ),
                        kind,
                        content,
                        fidelity: event.fidelity,
                        checksum: checksum.clone(),
                    });
                }
            }
        }

        // Phase 2: standalone artifacts still count as process chrome
        for (index, artifact_ref) in fact.artifact_refs.iter().enumerate() {
            if !projected_artifact_ids.insert(artifact_ref.artifact_id.clone()) {
                continue;
            }
            let (kind, content) =
                project_artifact_ref(artifact_ref, &fact.logical_turn_id, &fact.target.engine);
            items.push(ProjectionItem {
                id: projection_artifact_item_id(
                    artifact_ref,
                    format!("{}:artifact-ref:{}", event.sequence, index),
                ),
                kind,
                content,
                fidelity: event.fidelity,
                checksum: checksum.clone(),
            });
        }

        // Phase 3: tool exchanges (process body for the causal phase chip)
        for (index, exchange) in fact.atomic_tool_exchanges.iter().enumerate() {
            let status = match exchange.result.status {
                ToolResultStatus::Completed => "completed",
                ToolResultStatus::Error => "error",
                ToolResultStatus::Incomplete => "incomplete",
            };
            let detail = exchange.call.arguments_summary.clone().unwrap_or_default();
            let mut tool_type = resolve_canvas_tool_type_value(&exchange.tool_name);
            let mut title = canvas_tool_title(&exchange.tool_name, &detail);
            let has_native_changes_array = detail_has_changes_array(&detail);
            let changes = extract_changes_for_canvas_tool(&detail, &tool_type, &exchange.tool_name);
            // Promote to fileChange when we have structured changes (native changes[]
            // or parsed apply_patch). Keep plain Write/Edit names without changes so
            // Claude/Grok still use EditToolBlock polish.
            let should_promote_file_change = changes.as_ref().is_some_and(|rows| !rows.is_empty())
                && (has_native_changes_array
                    || is_codex_file_change_name(&exchange.tool_name)
                    || is_apply_patch_tool_name(&exchange.tool_name)
                    || tool_type == "fileChange"
                    || detail.contains("*** Begin Patch")
                    || detail.contains("*** Update File:"));
            if should_promote_file_change {
                tool_type = "fileChange".to_string();
                if title.eq_ignore_ascii_case("filechange")
                    || title.eq_ignore_ascii_case("file_change")
                    || is_apply_patch_tool_name(&title)
                {
                    title = "File changes".to_string();
                }
            }
            let mut content = json!({
                "toolType": tool_type,
                "turnId": fact.logical_turn_id,
                "title": title,
                "detail": detail,
                "status": status,
                "output": exchange.result.output_summary.clone().unwrap_or_default(),
                "engineSource": fact.target.engine,
            });
            if let Some(changes) = changes {
                if let Some(object) = content.as_object_mut() {
                    object.insert("changes".to_string(), Value::Array(changes));
                }
            }
            items.push(ProjectionItem {
                id: format!("{}:tool:{}", event.sequence, index),
                kind: ProjectionItemKind::Tool,
                content,
                fidelity: event.fidelity,
                checksum: checksum.clone(),
            });
        }

        // Phase 4: assistant prose last — anchors process-phase collapse above it
        for (index, text) in deferred_text_blocks {
            has_assistant_message = true;
            items.push(ProjectionItem {
                id: format!("{}:assistant:{}", event.sequence, index),
                kind: ProjectionItemKind::Message,
                content: build_final_assistant_message_content(
                    text,
                    &fact.logical_turn_id,
                    &fact.target.engine,
                    &fact.target,
                    &final_meta,
                ),
                fidelity: event.fidelity,
                checksum: checksum.clone(),
            });
        }

        // 非成功 terminal 也是本轮可见的 assistant 结果。必须携带同一个 immutable
        // target snapshot，否则 history reload 会同时丢掉错误与 CLI/Provider/Model label。
        if !matches!(fact.outcome.status, OutcomeStatus::Completed) {
            has_assistant_message = true;
            let status_text = match fact.outcome.status {
                OutcomeStatus::Completed => "completed",
                OutcomeStatus::Failed => "failed",
                OutcomeStatus::Cancelled => "cancelled",
                OutcomeStatus::Replaced => "replaced",
            };
            let text = format!(
                "Turn {}: {}",
                status_text,
                fact.outcome.error_message.clone().unwrap_or_default()
            );
            items.push(ProjectionItem {
                id: format!("{}:outcome", event.sequence),
                kind: ProjectionItemKind::Message,
                content: build_final_assistant_message_content(
                    &text,
                    &fact.logical_turn_id,
                    &fact.target.engine,
                    &fact.target,
                    &final_meta,
                ),
                fidelity: event.fidelity,
                checksum: checksum.clone(),
            });
        }

        // Reasoning-only / tool-only completed Turns still need one presentation anchor
        // carrying the immutable Target. MessageRow renders the per-turn CLI/Provider/Model
        // badge even when the assistant body is empty; current Picker state is never consulted.
        if !has_assistant_message {
            items.push(ProjectionItem {
                id: format!("{}:provenance", event.sequence),
                kind: ProjectionItemKind::Message,
                content: build_final_assistant_message_content(
                    "",
                    &fact.logical_turn_id,
                    &fact.target.engine,
                    &fact.target,
                    &final_meta,
                ),
                fidelity: event.fidelity,
                checksum,
            });
        }

        items
    }

    fn project_usage_recorded(
        &self,
        event: &StoredEvent,
        fact: &UsageRecordedFact,
    ) -> Vec<ProjectionItem> {
        vec![ProjectionItem {
            id: format!("{}:usage", event.sequence),
            kind: ProjectionItemKind::Metadata,
            content: json!({
                "type": "usage",
                "turnId": fact.logical_turn_id,
                "attemptId": fact.attempt_id,
                "inputTokens": fact.usage.input_tokens,
                "cachedInputTokens": fact.usage.cached_input_tokens,
                "outputTokens": fact.usage.output_tokens,
                "totalTokens": fact.usage.total_tokens,
                "source": fact.source,
                "revision": fact.revision,
            }),
            fidelity: event.fidelity,
            checksum: event.payload_checksum.clone(),
        }]
    }

    fn project_control(&self, event: &StoredEvent, fact: &ControlFact) -> Vec<ProjectionItem> {
        vec![ProjectionItem {
            id: format!("{}:control", event.sequence),
            kind: ProjectionItemKind::SystemNotice,
            content: json!({
                "text": format!("Control: {}", fact.control_kind),
                "attemptId": fact.attempt_id,
                "logicalTurnId": fact.logical_turn_id,
                "bindingKey": fact.binding_key,
                "reason": fact.reason,
            }),
            fidelity: event.fidelity,
            checksum: event.payload_checksum.clone(),
        }]
    }
}

/// Per-turn hints collected before projecting committed turns (footer meta parity).
struct TurnProjectionHints<'a> {
    requested_at_by_attempt: &'a HashMap<String, i64>,
    usage_by_attempt: &'a HashMap<String, UsageShape>,
}

struct FinalAssistantMeta {
    final_completed_at: i64,
    final_duration_ms: Option<i64>,
    final_input_tokens: Option<i64>,
    final_output_tokens: Option<i64>,
}

fn build_final_assistant_meta(
    committed_at: i64,
    requested_at: Option<i64>,
    usage: Option<&UsageShape>,
) -> FinalAssistantMeta {
    let final_duration_ms = requested_at.and_then(|started_at| {
        let duration = committed_at.saturating_sub(started_at);
        (duration >= 0).then_some(duration)
    });
    let (final_input_tokens, final_output_tokens) = usage
        .map(|shape| {
            let input_base = shape.input_tokens.unwrap_or(0).max(0);
            let cached = shape.cached_input_tokens.unwrap_or(0).max(0);
            let input_tokens = input_base + cached;
            let output_tokens = shape.output_tokens.unwrap_or(0).max(0);
            let input = (input_tokens > 0).then_some(input_tokens);
            let output = (output_tokens > 0).then_some(output_tokens);
            (input, output)
        })
        .unwrap_or((None, None));
    FinalAssistantMeta {
        final_completed_at: committed_at,
        final_duration_ms,
        final_input_tokens,
        final_output_tokens,
    }
}

fn build_final_assistant_message_content(
    text: &str,
    logical_turn_id: &str,
    engine: &str,
    target: &impl serde::Serialize,
    meta: &FinalAssistantMeta,
) -> Value {
    let mut content = json!({
        "role": "assistant",
        "text": text,
        "turnId": logical_turn_id,
        "engineSource": engine,
        "executionTargetSnapshot": target,
        "isFinal": true,
        "finalCompletedAt": meta.final_completed_at,
    });
    if let Some(object) = content.as_object_mut() {
        if let Some(duration_ms) = meta.final_duration_ms {
            object.insert("finalDurationMs".to_string(), json!(duration_ms));
        }
        if let Some(input_tokens) = meta.final_input_tokens {
            object.insert("finalInputTokens".to_string(), json!(input_tokens));
        }
        if let Some(output_tokens) = meta.final_output_tokens {
            object.insert("finalOutputTokens".to_string(), json!(output_tokens));
        }
    }
    content
}

/// Canvas toolType classification for Shared history.
///
/// Only force `commandExecution` for bash/shell family so hide policies work.
/// Keep original tool names for Write/Edit/Read so FE routes to EditToolBlock /
/// ReadToolBlock (forcing `fileChange` would water-soil into GenericToolBlock and
/// skip single-file edit polish that Native history enjoys).
fn resolve_canvas_tool_type_value(tool_name: &str) -> String {
    let trimmed = tool_name.trim();
    if trimmed.is_empty() {
        return "mcpToolCall".to_string();
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.contains("exec")
        || lower.contains("bash")
        || lower.contains("shell")
        || lower.contains("terminal")
        || lower.contains("command")
        || lower.contains("stdin")
        || lower == "run"
        || lower.starts_with("run_")
    {
        return "commandExecution".to_string();
    }
    trimmed.to_string()
}

fn is_edit_like_tool_name(tool_name: &str) -> bool {
    let lower = tool_name.trim().to_ascii_lowercase();
    lower == "delete"
        || lower == "delete_file"
        || lower == "remove_file"
        || lower == "rm"
        || lower.contains("delete_file")
        || lower.contains("remove_file")
        || lower.contains("apply_patch")
        || lower.contains("applypatch")
        || lower.contains("write")
        || lower.contains("edit")
        || lower.contains("search_replace")
        || lower.contains("replace_string")
        || lower.contains("str_replace")
        || lower.contains("multiedit")
        || lower.contains("multi_edit")
        || lower == "create_file"
        || lower.contains("patch")
}

fn is_codex_file_change_name(tool_name: &str) -> bool {
    let compact = tool_name
        .trim()
        .to_ascii_lowercase()
        .replace('_', "")
        .replace('-', "");
    compact == "filechange"
}

fn is_apply_patch_tool_name(tool_name: &str) -> bool {
    let compact = tool_name
        .trim()
        .to_ascii_lowercase()
        .replace('_', "")
        .replace('-', "");
    compact == "applypatch" || compact.contains("applypatch")
}

fn detail_has_changes_array(detail: &str) -> bool {
    let trimmed = detail.trim();
    if trimmed.is_empty() {
        return false;
    }
    serde_json::from_str::<Value>(trimmed)
        .ok()
        .and_then(|value| value.get("changes").and_then(Value::as_array).cloned())
        .is_some_and(|rows| !rows.is_empty())
}

fn canvas_tool_title(tool_name: &str, detail: &str) -> String {
    if let Ok(parsed) = serde_json::from_str::<Value>(detail.trim()) {
        if let Some(title) = parsed.get("title").and_then(Value::as_str) {
            let trimmed = title.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
        if let Some(description) = parsed.get("description").and_then(Value::as_str) {
            let trimmed = description.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
        if let Some(command) = parsed.get("command").and_then(Value::as_str) {
            let trimmed = command.trim();
            if !trimmed.is_empty() {
                // Short label for shell / apply_patch commands (full text stays in detail).
                let first_line = trimmed.lines().next().unwrap_or(trimmed).trim();
                if first_line.chars().count() > 80 {
                    let shortened: String = first_line.chars().take(77).collect();
                    return format!("{shortened}…");
                }
                return first_line.to_string();
            }
        }
    }
    let trimmed = tool_name.trim();
    if trimmed.is_empty()
        || trimmed.eq_ignore_ascii_case("commandexecution")
        || trimmed.eq_ignore_ascii_case("command_execution")
    {
        "Command".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Rebuild canvas `changes[]` from projected tool detail.
///
/// Priority:
/// 1. Native-shaped `changes: [{path, kind?, diff?}]` packed by Shared ingest
/// 2. Single-path edit/write args (path / file_path / …)
fn extract_changes_for_canvas_tool(
    detail: &str,
    tool_type: &str,
    tool_name: &str,
) -> Option<Vec<Value>> {
    let trimmed = detail.trim();
    if trimmed.is_empty() {
        return None;
    }
    // commandExecution may still carry apply_patch body in `command` — try that first.
    // Pure shell (cat/rg/ls) correctly yields None and stays commandExecution.
    let parsed: Value = serde_json::from_str(trimmed).ok()?;

    if let Some(rows) = parsed.get("changes").and_then(Value::as_array) {
        let mut changes = Vec::new();
        for row in rows {
            let path = extract_path_from_change_row(row)
                .or_else(|| extract_path_from_args(row))
                .unwrap_or_default();
            if path.is_empty() {
                continue;
            }
            let kind = row
                .get("kind")
                .or_else(|| row.get("type"))
                .or_else(|| row.get("status"))
                .and_then(|value| match value {
                    Value::String(text) => Some(text.clone()),
                    Value::Object(map) => map
                        .get("type")
                        .or_else(|| map.get("status"))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    _ => None,
                });
            let diff = row
                .get("diff")
                .or_else(|| row.get("patch"))
                .or_else(|| row.get("unifiedDiff"))
                .or_else(|| row.get("unified_diff"))
                .and_then(Value::as_str)
                .map(str::to_string)
                .filter(|text| !text.trim().is_empty());
            let mut change = json!({ "path": path });
            if let Some(object) = change.as_object_mut() {
                if let Some(kind) = kind {
                    object.insert("kind".to_string(), Value::String(kind));
                }
                if let Some(diff) = diff {
                    object.insert("diff".to_string(), Value::String(diff));
                }
            }
            changes.push(change);
        }
        if !changes.is_empty() {
            return Some(changes);
        }
    }

    // apply_patch / custom_tool_call / commandExecution wrapping a patch body.
    if let Some(patch) = extract_apply_patch_text(&parsed, trimmed) {
        if let Some(from_patch) = extract_changes_from_apply_patch(&patch) {
            return Some(from_patch);
        }
    }

    // Do not invent file paths from arbitrary shell commands (cat/rg/ls…).
    if tool_type == "commandExecution" {
        return None;
    }

    // Fallback: single-file write/edit args (Claude/Grok style).
    if !is_edit_like_tool_name(tool_name) && tool_type != "fileChange" {
        return None;
    }
    let path = extract_path_from_args(&parsed)?;
    if path.is_empty() {
        return None;
    }
    Some(vec![json!({
        "path": path,
        "kind": "modified",
    })])
}

fn extract_apply_patch_text(parsed: &Value, raw_detail: &str) -> Option<String> {
    for key in ["patch", "input", "command", "cmd"] {
        if let Some(Value::String(text)) = parsed.get(key) {
            let trimmed = text.trim();
            if trimmed.contains("*** Begin Patch") || trimmed.contains("*** Update File:") {
                return Some(trimmed.to_string());
            }
        }
    }
    let trimmed = raw_detail.trim();
    if trimmed.contains("*** Begin Patch") || trimmed.contains("*** Update File:") {
        return Some(trimmed.to_string());
    }
    None
}

/// Minimal Codex apply_patch parser for Shared history (aligned with FE
/// `inferFileChangesFromPayload` / `*** Update|Add|Delete File:` markers).
fn extract_changes_from_apply_patch(patch: &str) -> Option<Vec<Value>> {
    let mut changes = Vec::new();
    let mut current_path = String::new();
    let mut current_kind = String::from("update");
    let mut current_diff: Vec<String> = Vec::new();

    let flush = |path: &mut String,
                 kind: &mut String,
                 diff_lines: &mut Vec<String>,
                 out: &mut Vec<Value>| {
        let trimmed_path = path.trim().to_string();
        if trimmed_path.is_empty() {
            diff_lines.clear();
            return;
        }
        let diff = diff_lines.join("\n").trim().to_string();
        let mut change = json!({
            "path": trimmed_path,
            "kind": kind.clone(),
        });
        if !diff.is_empty() {
            if let Some(object) = change.as_object_mut() {
                object.insert("diff".to_string(), Value::String(diff));
            }
        }
        out.push(change);
        path.clear();
        *kind = "update".to_string();
        diff_lines.clear();
    };

    for line in patch.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("*** Update File:") {
            flush(
                &mut current_path,
                &mut current_kind,
                &mut current_diff,
                &mut changes,
            );
            current_path = rest.trim().to_string();
            current_kind = "update".to_string();
            current_diff.push(line.to_string());
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("*** Add File:") {
            flush(
                &mut current_path,
                &mut current_kind,
                &mut current_diff,
                &mut changes,
            );
            current_path = rest.trim().to_string();
            current_kind = "add".to_string();
            current_diff.push(line.to_string());
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("*** Delete File:") {
            flush(
                &mut current_path,
                &mut current_kind,
                &mut current_diff,
                &mut changes,
            );
            current_path = rest.trim().to_string();
            current_kind = "delete".to_string();
            current_diff.push(line.to_string());
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("*** Move to:") {
            let moved = rest.trim();
            if !moved.is_empty() {
                current_path = moved.to_string();
            }
            current_diff.push(line.to_string());
            continue;
        }
        if trimmed == "*** End Patch" {
            current_diff.push(line.to_string());
            flush(
                &mut current_path,
                &mut current_kind,
                &mut current_diff,
                &mut changes,
            );
            break;
        }
        if !current_path.is_empty() {
            current_diff.push(line.to_string());
        }
    }
    flush(
        &mut current_path,
        &mut current_kind,
        &mut current_diff,
        &mut changes,
    );

    if changes.is_empty() {
        None
    } else {
        Some(changes)
    }
}

fn extract_path_from_change_row(value: &Value) -> Option<String> {
    let object = value.as_object()?;
    for key in [
        "path",
        "file_path",
        "filePath",
        "file",
        "filename",
        "file_name",
    ] {
        if let Some(Value::String(path)) = object.get(key) {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// Attach preferred usage tokens onto final assistant messages that share the same turnId.
/// Idempotent: does not overwrite non-zero existing token fields.
fn stamp_usage_tokens_onto_final_assistants(items: &mut [ProjectionItem]) {
    let mut tokens_by_turn: HashMap<String, (i64, i64)> = HashMap::new();
    for item in items.iter() {
        if item.kind != ProjectionItemKind::Metadata {
            continue;
        }
        if item.content.get("type").and_then(Value::as_str) != Some("usage") {
            continue;
        }
        let turn_id = item
            .content
            .get("turnId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if turn_id.is_empty() {
            continue;
        }
        let input = item
            .content
            .get("inputTokens")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .max(0);
        // cachedInputTokens is not always on metadata projection; prefer stamped
        // finalInputTokens path that already combined cache at commit time when present.
        let cached = item
            .content
            .get("cachedInputTokens")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .max(0);
        let output = item
            .content
            .get("outputTokens")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            .max(0);
        let input_tokens = input + cached;
        if input_tokens <= 0 && output <= 0 {
            continue;
        }
        tokens_by_turn.insert(turn_id.to_string(), (input_tokens, output));
    }
    if tokens_by_turn.is_empty() {
        return;
    }
    for item in items.iter_mut() {
        if item.kind != ProjectionItemKind::Message {
            continue;
        }
        let Some(object) = item.content.as_object_mut() else {
            continue;
        };
        if object.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        if object.get("isFinal").and_then(Value::as_bool) != Some(true) {
            continue;
        }
        let turn_id = object
            .get("turnId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string();
        if turn_id.is_empty() {
            continue;
        }
        let Some(&(input_tokens, output_tokens)) = tokens_by_turn.get(&turn_id) else {
            continue;
        };
        let missing_input = !object
            .get("finalInputTokens")
            .and_then(Value::as_i64)
            .is_some_and(|value| value > 0);
        let missing_output = !object
            .get("finalOutputTokens")
            .and_then(Value::as_i64)
            .is_some_and(|value| value > 0);
        if missing_input && input_tokens > 0 {
            object.insert("finalInputTokens".to_string(), json!(input_tokens));
        }
        if missing_output && output_tokens > 0 {
            object.insert("finalOutputTokens".to_string(), json!(output_tokens));
        }
    }
}

fn extract_path_from_args(value: &Value) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in [
                "path",
                "file_path",
                "filePath",
                "file",
                "target",
                "target_file",
                "targetFile",
                "filename",
                "file_name",
            ] {
                if let Some(Value::String(path)) = map.get(key) {
                    let trimmed = path.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
            // Nested input / arguments wrappers
            for key in ["input", "arguments", "args"] {
                if let Some(nested) = map.get(key) {
                    if let Some(path) = extract_path_from_args(nested) {
                        return Some(path);
                    }
                }
            }
            None
        }
        Value::Array(items) => items.iter().find_map(extract_path_from_args),
        _ => None,
    }
}

fn project_artifact_ref(
    artifact_ref: &ArtifactRef,
    logical_turn_id: &str,
    engine: &str,
) -> (ProjectionItemKind, Value) {
    if artifact_ref.media_type.starts_with("image/") {
        let source_tool_name = artifact_ref
            .extra
            .get("sourceToolName")
            .and_then(Value::as_str)
            .unwrap_or("artifact");
        let prompt_text = artifact_ref
            .extra
            .get("promptText")
            .and_then(Value::as_str)
            .unwrap_or_default();
        return (
            ProjectionItemKind::GeneratedImage,
            json!({
                "status": "completed",
                "sourceToolName": source_tool_name,
                "promptText": prompt_text,
                "turnId": logical_turn_id,
                "engineSource": engine,
                "images": [{
                    "src": artifact_ref.locator,
                    "localPath": artifact_ref.locator,
                }],
            }),
        );
    }
    (
        ProjectionItemKind::Metadata,
        json!({
            "type": "artifact",
            "artifactId": artifact_ref.artifact_id,
            "mediaType": artifact_ref.media_type,
            "locator": artifact_ref.locator,
            "turnId": logical_turn_id,
            "engineSource": engine,
        }),
    )
}

fn projection_artifact_item_id(artifact_ref: &ArtifactRef, fallback: String) -> String {
    if artifact_ref.media_type.starts_with("image/") {
        let artifact_id = artifact_ref.artifact_id.trim();
        if !artifact_id.is_empty() {
            return artifact_id.to_string();
        }
    }
    fallback
}

fn merge_projected_items(items: &mut Vec<ProjectionItem>, projected: Vec<ProjectionItem>) {
    for item in projected {
        if let Some((attempt_id, priority, revision)) = usage_projection_precedence(&item) {
            let existing_precedence = items
                .iter()
                .filter_map(usage_projection_precedence)
                .find(|(existing_attempt, _, _)| existing_attempt == &attempt_id);
            if existing_precedence.as_ref().is_some_and(
                |(_, existing_priority, existing_revision)| {
                    (*existing_priority, *existing_revision) >= (priority, revision)
                },
            ) {
                continue;
            }
            items.retain(|existing| {
                usage_projection_precedence(existing)
                    .is_none_or(|(existing_attempt, _, _)| existing_attempt != attempt_id)
            });
        }
        items.push(item);
    }
}

fn usage_projection_precedence(item: &ProjectionItem) -> Option<(String, u8, i64)> {
    if item.kind != ProjectionItemKind::Metadata
        || item.content.get("type").and_then(serde_json::Value::as_str) != Some("usage")
    {
        return None;
    }
    let attempt_id = item
        .content
        .get("attemptId")
        .and_then(serde_json::Value::as_str)?
        .to_string();
    let priority = match item
        .content
        .get("source")
        .and_then(serde_json::Value::as_str)
    {
        Some("provider-report") => 1,
        _ => 0,
    };
    let revision = item
        .content
        .get("revision")
        .and_then(serde_json::Value::as_i64)
        .unwrap_or_default();
    Some((attempt_id, priority, revision))
}
