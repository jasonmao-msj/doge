use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::native_history::{NativeHistoryReadResult, NativeHistorySource};
use crate::shared_event_log::{deterministic_json_bytes, Fidelity, StoredEvent};

use super::types::{
    CompressionCategory, ContextCompressionReport, ContextPackage, ContextPackageSource,
    OmissionDisposition, PortableContextEntry, ProjectionManifest, ProjectionMode,
    ProjectionOmission, RuntimeContextCapabilities,
};

const COMPILER_VERSION: &str = "doge-shared-context/1";
const DEFAULT_TRANSCRIPT_BUDGET: u64 = 12_000;
const FOLD_BLOCK_THRESHOLD_CHARS: usize = 800;
const FOLDED_TEXT_MAX_CHARS: usize = 2_400;
const FOLDED_TOOL_ARGUMENTS_MAX_CHARS: usize = 800;
const FOLDED_TOOL_OUTPUT_MAX_CHARS: usize = 1_600;

#[derive(Debug, Clone)]
pub struct CompileContextRequest {
    pub session_id: String,
    pub binding_key: String,
    pub destination: Value,
    pub destination_native_session_id: Option<String>,
    pub from_sequence_exclusive: Option<i64>,
    pub through_sequence_inclusive: Option<i64>,
    pub exclude_attempt_id: Option<String>,
    pub capabilities: RuntimeContextCapabilities,
    pub budget_estimated_tokens: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct CompileNativeContextRequest {
    pub session_id: String,
    pub binding_key: String,
    pub destination: Value,
    pub source: NativeHistorySource,
    pub history: NativeHistoryReadResult,
    pub capabilities: RuntimeContextCapabilities,
    pub budget_estimated_tokens: Option<u64>,
}

fn estimated_tokens(text: &str) -> u64 {
    text.chars().count().div_ceil(4) as u64
}

fn sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let hex = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("sha256:{hex}")
}

fn select_mode(
    capabilities: &RuntimeContextCapabilities,
    has_destination_identity: bool,
    source_estimated_tokens: u64,
    budget: u64,
) -> (ProjectionMode, String) {
    if has_destination_identity && capabilities.native_delta {
        return (
            ProjectionMode::NativeDelta,
            "destination identity + native delta capability".to_string(),
        );
    }
    if capabilities.structured_history_import {
        return (
            ProjectionMode::NativeHistoryImport,
            "structured history import capability".to_string(),
        );
    }
    if capabilities.native_clone {
        return (
            ProjectionMode::NativeHistoryClone,
            "native clone capability".to_string(),
        );
    }
    if capabilities.user_channel_transcript && source_estimated_tokens <= budget {
        return (
            ProjectionMode::PortableTranscript,
            "portable transcript capability within budget".to_string(),
        );
    }
    (
        ProjectionMode::Checkpoint,
        "structured import unavailable or transcript exceeds budget".to_string(),
    )
}

fn text_block(text: impl Into<String>) -> Value {
    json!({ "kind": "text", "text": text.into() })
}

fn event_payload(event: &StoredEvent) -> Result<Value, String> {
    serde_json::from_str(&event.payload_json)
        .map_err(|error| format!("parse {} payload: {error}", event.fact_type))
}

fn squad_context_scope(events: &[StoredEvent], attempt_id: Option<&str>) -> Option<Value> {
    let attempt_id = attempt_id?;
    events
        .iter()
        .find(|event| {
            event.fact_type == "conversation.turnRequested"
                && event.attempt_id.as_deref() == Some(attempt_id)
        })
        .and_then(|event| event_payload(event).ok())
        .and_then(|payload| payload.get("squadContextIdentity").cloned())
        .filter(|scope| !scope.is_null())
}

fn destination_owned_attempts(events: &[StoredEvent], binding_key: &str) -> HashSet<String> {
    events
        .iter()
        .filter(|event| event.fact_type == "conversation.turnAccepted")
        .filter_map(|event| {
            let payload = event_payload(event).ok()?;
            (payload.get("bindingKey").and_then(Value::as_str) == Some(binding_key))
                .then(|| event.attempt_id.clone())
                .flatten()
        })
        .collect()
}

fn is_collab_control_user_text(text: &str) -> bool {
    let raw = text.trim();
    if raw.is_empty() {
        return false;
    }
    raw.contains("[[doge.collab.briefing")
        || raw.contains("[[doge.collab.summary")
        || raw.contains("[[doge.collab.")
        || raw.contains("[[mossx.collab.briefing")
        || raw.contains("[[mossx.collab.summary")
        || raw.contains("[[mossx.collab.")
        || raw.contains("【协作调度")
}

fn collab_stage_portable_text(payload: &Value) -> Option<String> {
    let outcome = payload.get("outcome")?;
    let node_id = payload
        .get("nodeId")
        .and_then(Value::as_str)
        .unwrap_or("stage");
    let status = outcome
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let body = outcome
        .get("body")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            outcome
                .get("summary")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })?;
    Some(format!("[协作环节 {node_id} · {status}]\n{body}"))
}

fn transform_event(
    event: &StoredEvent,
    payload: &Value,
    capabilities: &RuntimeContextCapabilities,
    omissions: &mut Vec<ProjectionOmission>,
) -> Option<PortableContextEntry> {
    let entry_id = event.event_id.clone();
    match event.fact_type.as_str() {
        "conversation.turnRequested" => {
            let input = payload.get("input")?;
            let mut blocks = Vec::new();
            if let Some(text) = input.get("text").and_then(Value::as_str) {
                if is_collab_control_user_text(text) {
                    omissions.push(ProjectionOmission {
                        entry_id: entry_id.clone(),
                        category: "collab-control-prompt".to_string(),
                        reason:
                            "collab scheduler briefing/summary is not portable ordinary context"
                                .to_string(),
                        disposition: OmissionDisposition::NotRetrievable,
                        retrievable_ref: None,
                    });
                    return None;
                }
                blocks.push(text_block(text));
            }
            for field in ["imageRefs", "attachmentRefs"] {
                if let Some(refs) = input.get(field).and_then(Value::as_array) {
                    for artifact_ref in refs {
                        if capabilities.image_history || field == "attachmentRefs" {
                            blocks.push(json!({
                                "kind": "artifact-ref",
                                "artifactRef": artifact_ref,
                                "referenceOnly": true,
                            }));
                        } else {
                            omissions.push(ProjectionOmission {
                                entry_id: entry_id.clone(),
                                category: "image".to_string(),
                                reason: "destination does not support image history".to_string(),
                                disposition: OmissionDisposition::RetrievableOnDemand,
                                retrievable_ref: artifact_ref
                                    .get("artifactId")
                                    .and_then(Value::as_str)
                                    .map(str::to_string),
                            });
                        }
                    }
                }
            }
            Some(PortableContextEntry {
                entry_id,
                sequence: event.sequence,
                role: "user".to_string(),
                blocks,
                outcome: None,
            })
        }
        "conversation.turnCommitted" => {
            let outcome = payload
                .pointer("/outcome/status")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            if outcome != "completed" {
                omissions.push(ProjectionOmission {
                    entry_id,
                    category: "assistant".to_string(),
                    reason: format!("assistant outcome is {outcome}; not replayed as success"),
                    disposition: OmissionDisposition::NotRetrievable,
                    retrievable_ref: None,
                });
                return None;
            }
            let mut blocks = payload
                .get("assistant")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|block| {
                    let kind = block.get("kind").and_then(Value::as_str);
                    if kind == Some("text") {
                        return Some(block);
                    }
                    let (category, reason, retrievable_ref, disposition) = match kind {
                        Some("reasoning") | Some("redacted-reasoning") => (
                            "provider-private-reasoning",
                            "private reasoning is not portable",
                            block
                                .get("artifactRef")
                                .and_then(|artifact_ref| artifact_ref.get("artifactId"))
                                .and_then(Value::as_str)
                                .map(str::to_string),
                            if block.get("artifactRef").is_some() {
                                OmissionDisposition::RetrievableOnDemand
                            } else {
                                OmissionDisposition::NotRetrievable
                            },
                        ),
                        Some("artifact-ref") => (
                            "assistant-artifact",
                            "assistant artifact is reference-only and not injected as text",
                            block
                                .get("artifactRef")
                                .and_then(|artifact_ref| artifact_ref.get("artifactId"))
                                .and_then(Value::as_str)
                                .map(str::to_string),
                            OmissionDisposition::RetrievableOnDemand,
                        ),
                        _ => (
                            "provider-private-block",
                            "unknown assistant block is not on the portable allowlist",
                            None,
                            OmissionDisposition::NotRetrievable,
                        ),
                    };
                    omissions.push(ProjectionOmission {
                        entry_id: event.event_id.clone(),
                        category: category.to_string(),
                        reason: reason.to_string(),
                        disposition,
                        retrievable_ref,
                    });
                    None
                })
                .collect::<Vec<_>>();
            let exchanges = payload
                .get("atomicToolExchanges")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if capabilities.tool_history {
                blocks.extend(exchanges.into_iter().map(
                    |exchange| json!({ "kind": "atomic-tool-exchange", "exchange": exchange }),
                ));
            } else if !exchanges.is_empty() {
                omissions.push(ProjectionOmission {
                    entry_id: event.event_id.clone(),
                    category: "tool-exchange".to_string(),
                    reason: "destination does not support tool history; pair omitted atomically"
                        .to_string(),
                    disposition: OmissionDisposition::NotRetrievable,
                    retrievable_ref: None,
                });
            }
            if blocks.is_empty() {
                return None;
            }
            Some(PortableContextEntry {
                entry_id: event.event_id.clone(),
                sequence: event.sequence,
                role: "assistant".to_string(),
                blocks,
                outcome: Some(outcome.to_string()),
            })
        }
        "conversation.controlFact" => {
            omissions.push(ProjectionOmission {
                entry_id,
                category: "historical-control".to_string(),
                reason: "historical control is reference-only and never re-executed".to_string(),
                disposition: OmissionDisposition::NotRetrievable,
                retrievable_ref: None,
            });
            None
        }
        "squad.nodeOutcomeRecorded" => {
            let text = collab_stage_portable_text(payload)?;
            Some(PortableContextEntry {
                entry_id,
                sequence: event.sequence,
                role: "assistant".to_string(),
                blocks: vec![text_block(&text)],
                outcome: payload
                    .pointer("/outcome/status")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            })
        }
        _ => None,
    }
}

fn transcript(entries: &[PortableContextEntry], checkpoint: bool) -> String {
    if entries.is_empty() {
        return String::new();
    }
    let mut output = if checkpoint {
        "Shared Context Checkpoint\n\n".to_string()
    } else {
        "Shared Context Transcript\n\n".to_string()
    };
    for entry in entries {
        output.push_str(&format!("[{}:{}]\n", entry.role, entry.entry_id));
        for block in &entry.blocks {
            if let Some(text) = block.get("text").and_then(Value::as_str) {
                output.push_str(text);
                output.push('\n');
            } else {
                output.push_str(&block.to_string());
                output.push('\n');
            }
        }
        output.push('\n');
    }
    output
}

fn fold_text(text: &str) -> (&'static str, String) {
    if let Ok(value) = serde_json::from_str::<Value>(text) {
        let folded = match value {
            Value::Array(items) => json!({
                "kind": "folded-json-array",
                "count": items.len(),
                "head": items.iter().take(2).collect::<Vec<_>>(),
                "tail": items.iter().rev().take(2).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>(),
            }),
            Value::Object(object) => json!({
                "kind": "folded-json-object",
                "keys": object.keys().collect::<Vec<_>>(),
                "fieldCount": object.len(),
            }),
            _ => value,
        };
        return ("tool-json-schema-count-head-tail", folded.to_string());
    }
    let lines = text.lines().collect::<Vec<_>>();
    if text.contains("diff --git") || text.contains("\n@@ ") || text.contains("```") {
        let anchors = lines
            .iter()
            .filter(|line| {
                let trimmed = line.trim_start();
                trimmed.starts_with("diff --git")
                    || trimmed.starts_with("--- ")
                    || trimmed.starts_with("+++ ")
                    || trimmed.starts_with("@@")
                    || trimmed.starts_with("fn ")
                    || trimmed.starts_with("function ")
                    || trimmed.starts_with("class ")
                    || trimmed.starts_with("struct ")
            })
            .take(40)
            .copied()
            .collect::<Vec<_>>();
        return (
            "code-diff-path-signature-hunk",
            format!(
                "{}\n{}\n{}",
                lines
                    .iter()
                    .take(12)
                    .copied()
                    .collect::<Vec<_>>()
                    .join("\n"),
                anchors.join("\n"),
                lines
                    .iter()
                    .rev()
                    .take(12)
                    .copied()
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect::<Vec<_>>()
                    .join("\n")
            ),
        );
    }
    let evidence = lines
        .iter()
        .filter(|line| {
            let lower = line.to_ascii_lowercase();
            lower.contains("error") || lower.contains("warning") || lower.contains("failed")
        })
        .take(30)
        .copied()
        .collect::<Vec<_>>();
    (
        "log-error-warning-head-tail",
        format!(
            "{}\n{}\n{}",
            lines
                .iter()
                .take(12)
                .copied()
                .collect::<Vec<_>>()
                .join("\n"),
            evidence.join("\n"),
            lines
                .iter()
                .rev()
                .take(12)
                .copied()
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("\n")
        ),
    )
}

fn bounded_text(text: &str, max_chars: usize) -> String {
    let char_count = text.chars().count();
    if char_count <= max_chars {
        return text.to_string();
    }
    let marker = "\n...[deterministically omitted]...\n";
    let marker_chars = marker.chars().count();
    let retained_chars = max_chars.saturating_sub(marker_chars);
    let head_chars = retained_chars.div_ceil(2);
    let tail_chars = retained_chars / 2;
    let head = text.chars().take(head_chars).collect::<String>();
    let tail = text
        .chars()
        .rev()
        .take(tail_chars)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    format!("{head}{marker}{tail}")
}

fn fold_and_bound_text(text: &str, max_chars: usize) -> (&'static str, String) {
    let (strategy, folded) = fold_text(text);
    if folded.chars().count() <= max_chars {
        return (strategy, folded);
    }
    let evidence = text
        .lines()
        .filter(|line| {
            let trimmed = line.trim_start();
            let lower = trimmed.to_ascii_lowercase();
            lower.contains("error")
                || lower.contains("warning")
                || lower.contains("failed")
                || trimmed.starts_with("diff --git")
                || trimmed.starts_with("@@")
                || trimmed.starts_with("fn ")
                || trimmed.starts_with("function ")
                || trimmed.starts_with("class ")
                || trimmed.starts_with("struct ")
        })
        .take(20)
        .collect::<Vec<_>>()
        .join("\n");
    if evidence.is_empty() {
        return (strategy, bounded_text(&folded, max_chars));
    }
    let separator = "\n...[evidence]...\n";
    let separator_chars = separator.chars().count();
    let content_budget = max_chars.saturating_sub(separator_chars);
    let evidence_budget = content_budget / 2;
    let edge_budget = content_budget.saturating_sub(evidence_budget);
    let head_budget = edge_budget.div_ceil(2);
    let tail_budget = edge_budget / 2;
    let head = text.chars().take(head_budget).collect::<String>();
    let evidence = bounded_text(&evidence, evidence_budget);
    let tail = text
        .chars()
        .rev()
        .take(tail_budget)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    (strategy, format!("{head}{separator}{evidence}{tail}"))
}

fn fold_atomic_tool_exchange(block: &Value) -> Option<Value> {
    if block.get("kind").and_then(Value::as_str) != Some("atomic-tool-exchange")
        || block.to_string().chars().count() <= FOLD_BLOCK_THRESHOLD_CHARS
    {
        return None;
    }
    let arguments = block
        .pointer("/exchange/call/argumentsSummary")
        .and_then(Value::as_str)?;
    let output = block
        .pointer("/exchange/result/outputSummary")
        .and_then(Value::as_str)?;
    let (_, folded_arguments) = fold_and_bound_text(arguments, FOLDED_TOOL_ARGUMENTS_MAX_CHARS);
    let (_, folded_output) = fold_and_bound_text(output, FOLDED_TOOL_OUTPUT_MAX_CHARS);
    let mut folded = block.clone();
    *folded.pointer_mut("/exchange/call/argumentsSummary")? = Value::String(folded_arguments);
    *folded.pointer_mut("/exchange/result/outputSummary")? = Value::String(folded_output);
    Some(folded)
}

fn fold_checkpoint_entries(
    entries: &mut [PortableContextEntry],
    omissions: &mut Vec<ProjectionOmission>,
) -> Vec<CompressionCategory> {
    let mut categories: HashMap<String, (u64, u64)> = HashMap::new();
    for entry in entries {
        for block in &mut entry.blocks {
            if let Some(folded) = fold_atomic_tool_exchange(block) {
                let source_tokens = estimated_tokens(&block.to_string());
                let package_tokens = estimated_tokens(&folded.to_string());
                *block = folded;
                let strategy = "atomic-tool-exchange-bounded-evidence";
                let totals = categories.entry(strategy.to_string()).or_default();
                totals.0 += source_tokens;
                totals.1 += package_tokens;
                omissions.push(ProjectionOmission {
                    entry_id: entry.entry_id.clone(),
                    category: "deterministic-fold".to_string(),
                    reason: format!(
                        "{strategy}; Tool Call/Result evidence was folded for checkpoint budget"
                    ),
                    disposition: OmissionDisposition::NotRetrievable,
                    retrievable_ref: None,
                });
                continue;
            }
            let Some(text) = block.get("text").and_then(Value::as_str) else {
                continue;
            };
            if text.chars().count() <= FOLD_BLOCK_THRESHOLD_CHARS {
                continue;
            }
            let source_tokens = estimated_tokens(text);
            let (strategy, folded) = fold_and_bound_text(text, FOLDED_TEXT_MAX_CHARS);
            let package_tokens = estimated_tokens(&folded);
            *block = text_block(folded);
            let totals = categories.entry(strategy.to_string()).or_default();
            totals.0 += source_tokens;
            totals.1 += package_tokens;
            omissions.push(ProjectionOmission {
                entry_id: entry.entry_id.clone(),
                category: "deterministic-fold".to_string(),
                reason: format!("{strategy}; full content was folded for checkpoint budget"),
                disposition: OmissionDisposition::NotRetrievable,
                retrievable_ref: None,
            });
        }
    }
    categories
        .into_iter()
        .map(
            |(strategy, (source_estimated_tokens, package_estimated_tokens))| CompressionCategory {
                category: "checkpoint-content".to_string(),
                strategy,
                source_estimated_tokens,
                package_estimated_tokens,
            },
        )
        .collect()
}

fn trim_checkpoint_entries_to_budget(
    entries: &mut Vec<PortableContextEntry>,
    omissions: &mut Vec<ProjectionOmission>,
    budget: u64,
) -> Option<CompressionCategory> {
    let source_estimated_tokens = estimated_tokens(&transcript(entries, true));
    if source_estimated_tokens <= budget {
        return None;
    }

    // Resume integrity：永远保留最早 user 原任务；预算不够时删 **中间** complete Turn
    // （第二段及之后的较旧轮），再尽量保留最近 spine。禁止把首条 user 当「oldest」裁掉。
    while estimated_tokens(&transcript(entries, true)) > budget {
        let user_indices = entries
            .iter()
            .enumerate()
            .filter_map(|(index, entry)| (entry.role == "user").then_some(index))
            .collect::<Vec<_>>();
        // 需要至少两轮 user 才有可删的「非首轮」complete turn。
        if user_indices.len() < 2 {
            break;
        }
        // 删除第二轮 user 起至第三轮 user 前（或末尾）——即丢掉次旧一轮，保留首轮。
        let start = user_indices[1];
        let end = user_indices.get(2).copied().unwrap_or(entries.len());
        if start >= end || start == 0 {
            break;
        }
        for entry in entries.drain(start..end) {
            omissions.push(ProjectionOmission {
                entry_id: entry.entry_id,
                category: "checkpoint-budget".to_string(),
                reason: "middle complete Turn omitted to satisfy checkpoint budget while preserving earliest user task"
                    .to_string(),
                disposition: OmissionDisposition::RetrievableOnDemand,
                retrievable_ref: None,
            });
        }
    }

    if estimated_tokens(&transcript(entries, true)) > budget && !entries.is_empty() {
        let first_user_anchor = entries
            .iter()
            .find(|entry| entry.role == "user")
            .map(|entry| entry.entry_id.clone());
        let latest_user_anchor = entries
            .iter()
            .rposition(|entry| entry.role == "user")
            .map(|index| entries[index].entry_id.clone());
        let outcome_anchor = entries
            .iter()
            .rposition(|entry| entry.role == "assistant")
            .or_else(|| entries.len().checked_sub(1))
            .map(|index| entries[index].entry_id.clone());
        let anchors = [first_user_anchor, latest_user_anchor, outcome_anchor]
            .into_iter()
            .flatten()
            .collect::<HashSet<_>>();
        while estimated_tokens(&transcript(entries, true)) > budget {
            let Some(remove_index) = entries
                .iter()
                .position(|entry| !anchors.contains(&entry.entry_id))
            else {
                break;
            };
            let entry = entries.remove(remove_index);
            omissions.push(ProjectionOmission {
                entry_id: entry.entry_id,
                category: "checkpoint-budget".to_string(),
                reason: "intermediate entry omitted from oversized Turn; earliest user and latest spine retained"
                    .to_string(),
                disposition: OmissionDisposition::RetrievableOnDemand,
                retrievable_ref: None,
            });
        }
    }

    Some(CompressionCategory {
        category: "checkpoint-history".to_string(),
        strategy: "preserve-earliest-user-drop-middle-then-latest-spine".to_string(),
        source_estimated_tokens,
        package_estimated_tokens: estimated_tokens(&transcript(entries, true)),
    })
}

/// Whether a full rematerialize compile (no accepted cursor, no destination-owned
/// omission) would produce a non-empty transfer payload for this session range.
pub fn session_needs_history(
    events: &[StoredEvent],
    request: &CompileContextRequest,
) -> Result<bool, String> {
    let rematerialize_request = CompileContextRequest {
        session_id: request.session_id.clone(),
        binding_key: request.binding_key.clone(),
        destination: request.destination.clone(),
        destination_native_session_id: None,
        from_sequence_exclusive: None,
        through_sequence_inclusive: request.through_sequence_inclusive,
        exclude_attempt_id: request.exclude_attempt_id.clone(),
        capabilities: request.capabilities.clone(),
        budget_estimated_tokens: request.budget_estimated_tokens,
    };
    let package = compile_context(events, &rematerialize_request)?;
    Ok(!super::types::is_zero_transfer_package(&package))
}

pub fn compile_context(
    events: &[StoredEvent],
    request: &CompileContextRequest,
) -> Result<ContextPackage, String> {
    let upper = request
        .through_sequence_inclusive
        .or_else(|| events.last().map(|event| event.sequence))
        .unwrap_or(0);
    let lower = request.from_sequence_exclusive.unwrap_or(0);
    let canonical_turn_ids = events
        .iter()
        .filter(|event| event.fidelity == Fidelity::Canonical)
        .filter_map(|event| event.logical_turn_id.as_deref())
        .collect::<HashSet<_>>();
    let squad_attempt_ids = events
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
    let source = events
        .iter()
        .filter(|event| {
            let is_collab_stage_outcome = event.fact_type == "squad.nodeOutcomeRecorded";
            (event.fidelity == Fidelity::Canonical
                || (event.fidelity == Fidelity::PresentationOnly
                    && event
                        .logical_turn_id
                        .as_deref()
                        .is_none_or(|turn_id| !canonical_turn_ids.contains(turn_id))))
                && event.sequence > lower
                && event.sequence <= upper
                && event.attempt_id.as_deref() != request.exclude_attempt_id.as_deref()
                // collab stage digest 必须进入 ordinary turn context：
                // 不因 squad worker attempt 集合被整段剔除。
                && (is_collab_stage_outcome
                    || event
                        .attempt_id
                        .as_ref()
                        .is_none_or(|attempt| !squad_attempt_ids.contains(attempt)))
        })
        .cloned()
        .collect::<Vec<_>>();
    let source_value = source
        .iter()
        .map(|event| {
            json!({
                "sequence": event.sequence,
                "eventId": event.event_id,
                "factType": event.fact_type,
                "payloadChecksum": event.payload_checksum,
            })
        })
        .collect::<Vec<_>>();
    let source_bytes =
        deterministic_json_bytes(&json!(source_value)).map_err(|error| error.to_string())?;
    let source_checksum = sha256(&source_bytes);
    let context_scope = squad_context_scope(events, request.exclude_attempt_id.as_deref());
    let budget = request
        .budget_estimated_tokens
        .unwrap_or(DEFAULT_TRANSCRIPT_BUDGET);
    let owned_attempts = destination_owned_attempts(events, &request.binding_key);
    let mut omissions = Vec::new();
    let mut entries = Vec::new();
    for event in &source {
        let is_collab_stage_outcome = event.fact_type == "squad.nodeOutcomeRecorded";
        // collab stage digest 跨 binding 续聊必须可见，禁止 destination-owned 吞掉。
        if !is_collab_stage_outcome
            && request.destination_native_session_id.is_some()
            && event
                .attempt_id
                .as_ref()
                .is_some_and(|attempt| owned_attempts.contains(attempt))
        {
            omissions.push(ProjectionOmission {
                entry_id: event.event_id.clone(),
                category: "destination-owned".to_string(),
                reason: "entry already belongs to destination native history".to_string(),
                disposition: OmissionDisposition::NotRetrievable,
                retrievable_ref: None,
            });
            continue;
        }
        let payload = event_payload(event)?;
        if let Some(entry) = transform_event(event, &payload, &request.capabilities, &mut omissions)
        {
            entries.push(entry);
        }
    }
    let source_estimated_tokens = estimated_tokens(&transcript(&entries, false));
    let (mode, mode_reason) = select_mode(
        &request.capabilities,
        request.destination_native_session_id.is_some(),
        source_estimated_tokens,
        budget,
    );
    let mut compression_categories = if mode == ProjectionMode::Checkpoint {
        fold_checkpoint_entries(&mut entries, &mut omissions)
    } else {
        Vec::new()
    };
    if mode == ProjectionMode::Checkpoint {
        if let Some(category) =
            trim_checkpoint_entries_to_budget(&mut entries, &mut omissions, budget)
        {
            compression_categories.push(category);
        }
    }
    let included_entry_ids = entries
        .iter()
        .map(|entry| entry.entry_id.clone())
        .collect::<Vec<_>>();
    let stable_prefix = format!(
        "DOGE_SHARED_CONTEXT_V1\nsession:{}\nbinding:{}\n",
        request.session_id, request.binding_key
    );
    let projected_text = transcript(&entries, mode == ProjectionMode::Checkpoint);
    let package_estimated_tokens = estimated_tokens(&projected_text);
    let manifest = ProjectionManifest {
        compiler_version: COMPILER_VERSION.to_string(),
        mode,
        mode_reason,
        included_entry_ids,
        omitted: omissions,
        from_sequence_exclusive: request.from_sequence_exclusive,
        through_sequence_inclusive: upper,
        source_checksum: source_checksum.clone(),
        scope: context_scope.clone(),
    };
    let identity = json!({
        "compilerVersion": COMPILER_VERSION,
        "sessionId": request.session_id,
        "bindingKey": request.binding_key,
        "destination": request.destination,
        "destinationNativeSessionId": request.destination_native_session_id,
        "capabilities": request.capabilities,
        "budgetEstimatedTokens": budget,
        "fromSequenceExclusive": request.from_sequence_exclusive,
        "throughSequenceInclusive": upper,
        "sourceChecksum": source_checksum,
        "scope": context_scope,
    });
    let package_id =
        sha256(&deterministic_json_bytes(&identity).map_err(|error| error.to_string())?);
    let marker = format!("DOGE_CONTEXT_PACKAGE:{package_id}:{source_checksum}");
    let prompt_prefix = match mode {
        ProjectionMode::PortableTranscript | ProjectionMode::Checkpoint
            if projected_text.is_empty() =>
        {
            String::new()
        }
        ProjectionMode::PortableTranscript | ProjectionMode::Checkpoint => {
            format!("{marker}\n{stable_prefix}\n{projected_text}\n{marker}\n")
        }
        _ => String::new(),
    };
    Ok(ContextPackage {
        schema_version: 1,
        package_id,
        session_id: request.session_id.clone(),
        binding_key: request.binding_key.clone(),
        source: ContextPackageSource::SharedCanonical {
            session_id: request.session_id.clone(),
            from_sequence_exclusive: request.from_sequence_exclusive,
            through_sequence_inclusive: upper,
        },
        destination: request.destination.clone(),
        stable_prefix,
        delta: entries,
        prompt_prefix,
        manifest,
        compression: ContextCompressionReport {
            estimator: "deterministic-char-div-4".to_string(),
            source_estimated_tokens,
            package_estimated_tokens,
            per_category: {
                compression_categories.push(CompressionCategory {
                    category: "portable-turns".to_string(),
                    strategy: if mode == ProjectionMode::Checkpoint {
                        "bounded-checkpoint".to_string()
                    } else {
                        "portable-transcript".to_string()
                    },
                    source_estimated_tokens,
                    package_estimated_tokens,
                });
                compression_categories
            },
        },
    })
}

pub fn compile_native_context(
    request: &CompileNativeContextRequest,
) -> Result<ContextPackage, String> {
    if request.history.reader_id != request.source.engine.reader_id() {
        return Err("native history reader identity mismatch".to_string());
    }
    if request.history.through_cursor.trim().is_empty()
        || request.history.source_fingerprint.trim().is_empty()
    {
        return Err("native history fingerprint and cursor are required".to_string());
    }
    let source_identity = ContextPackageSource::NativeHistory {
        session_id: request.source.session_id.clone(),
        native_session_id: request.source.native_session_id.clone(),
        engine: format!("{:?}", request.source.engine).to_ascii_lowercase(),
        provider_profile_id: request.source.provider_profile_id.clone(),
        reader_id: request.history.reader_id.clone(),
        source_fingerprint: request.history.source_fingerprint.clone(),
        through_cursor: request.history.through_cursor.clone(),
    };
    let source_value = json!({
        "source": source_identity,
        "entries": request.history.entries,
    });
    let source_checksum =
        sha256(&deterministic_json_bytes(&source_value).map_err(|error| error.to_string())?);
    let mut omissions = request.history.omissions.clone();
    let mut entries = request
        .history
        .entries
        .iter()
        .enumerate()
        .map(|(index, entry)| PortableContextEntry {
            entry_id: entry.source_entry_id.clone(),
            sequence: (index + 1) as i64,
            role: entry.role.clone(),
            blocks: entry.blocks.clone(),
            outcome: None,
        })
        .collect::<Vec<_>>();
    let source_entry_count = entries.len();
    if entries.is_empty() {
        return Err("native history has no portable context entries".to_string());
    }
    let source_estimated_tokens = estimated_tokens(&transcript(&entries, false));
    let budget = request
        .budget_estimated_tokens
        .unwrap_or(DEFAULT_TRANSCRIPT_BUDGET);
    let (mode, mode_reason) = select_mode(
        &request.capabilities,
        false,
        source_estimated_tokens,
        budget,
    );
    let requires_checkpoint = source_estimated_tokens > budget;
    let mut compression_categories = if requires_checkpoint {
        fold_checkpoint_entries(&mut entries, &mut omissions)
    } else {
        Vec::new()
    };
    if requires_checkpoint {
        if let Some(category) =
            trim_checkpoint_entries_to_budget(&mut entries, &mut omissions, budget)
        {
            compression_categories.push(category);
        }
    }
    let included_entry_ids = entries
        .iter()
        .map(|entry| entry.entry_id.clone())
        .collect::<Vec<_>>();
    let stable_prefix = format!(
        "DOGE_NATIVE_CONTEXT_V1\nsource:{}\nbinding:{}\n",
        request.source.session_id, request.binding_key
    );
    let projected_text = transcript(&entries, requires_checkpoint);
    let package_estimated_tokens = estimated_tokens(&projected_text);
    if package_estimated_tokens == 0 {
        return Err("native context projection is empty".to_string());
    }
    if requires_checkpoint && package_estimated_tokens > budget {
        return Err(format!(
            "native context projection exceeds budget: {package_estimated_tokens} > {budget}"
        ));
    }
    let manifest = ProjectionManifest {
        compiler_version: COMPILER_VERSION.to_string(),
        mode,
        mode_reason,
        included_entry_ids,
        omitted: omissions,
        from_sequence_exclusive: None,
        through_sequence_inclusive: source_entry_count as i64,
        source_checksum: source_checksum.clone(),
        scope: None,
    };
    let identity = json!({
        "compilerVersion": COMPILER_VERSION,
        "source": source_identity,
        "bindingKey": request.binding_key,
        "destination": request.destination,
        "capabilities": request.capabilities,
        "budgetEstimatedTokens": budget,
        "sourceChecksum": source_checksum,
    });
    let package_id =
        sha256(&deterministic_json_bytes(&identity).map_err(|error| error.to_string())?);
    let marker = format!("DOGE_CONTEXT_PACKAGE:{package_id}:{source_checksum}");
    let prompt_prefix = match mode {
        ProjectionMode::PortableTranscript | ProjectionMode::Checkpoint => {
            format!("{marker}\n{stable_prefix}\n{projected_text}\n{marker}\n")
        }
        _ => String::new(),
    };
    compression_categories.push(CompressionCategory {
        category: "portable-turns".to_string(),
        strategy: if requires_checkpoint {
            "bounded-checkpoint".to_string()
        } else {
            "portable-transcript".to_string()
        },
        source_estimated_tokens,
        package_estimated_tokens,
    });
    Ok(ContextPackage {
        schema_version: 1,
        package_id,
        session_id: request.session_id.clone(),
        binding_key: request.binding_key.clone(),
        source: source_identity,
        destination: request.destination.clone(),
        stable_prefix,
        delta: entries,
        prompt_prefix,
        manifest,
        compression: ContextCompressionReport {
            estimator: "deterministic-char-div-4".to_string(),
            source_estimated_tokens,
            package_estimated_tokens,
            per_category: compression_categories,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mode_priority_is_capability_driven_and_delta_requires_identity() {
        let all = RuntimeContextCapabilities {
            native_delta: true,
            structured_history_import: true,
            native_clone: true,
            user_channel_transcript: true,
            tool_history: true,
            image_history: true,
            strong_context_ack: true,
        };
        assert_eq!(
            select_mode(&all, true, 1, 10).0,
            ProjectionMode::NativeDelta
        );
        assert_eq!(
            select_mode(&all, false, 1, 10).0,
            ProjectionMode::NativeHistoryImport
        );
    }

    #[test]
    fn checkpoint_log_fold_is_deterministic_and_keeps_error_evidence() {
        let text = (0..200)
            .map(|index| {
                if index == 100 {
                    "ERROR durable write failed".to_string()
                } else {
                    format!("line-{index}")
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        let (left_strategy, left) = fold_text(&text);
        let (right_strategy, right) = fold_text(&text);
        assert_eq!(left_strategy, "log-error-warning-head-tail");
        assert_eq!(left_strategy, right_strategy);
        assert_eq!(left, right);
        assert!(left.contains("ERROR durable write failed"));
        assert!(left.contains("line-0"));
        assert!(left.contains("line-199"));
    }

    #[test]
    fn checkpoint_budget_preserves_earliest_user_and_drops_middle_turns() {
        let mut entries = vec![
            PortableContextEntry {
                entry_id: "u1".to_string(),
                sequence: 1,
                role: "user".to_string(),
                blocks: vec![text_block("original task body")],
                outcome: None,
            },
            PortableContextEntry {
                entry_id: "a1".to_string(),
                sequence: 2,
                role: "assistant".to_string(),
                blocks: vec![text_block("old answer")],
                outcome: Some("completed".to_string()),
            },
            PortableContextEntry {
                entry_id: "u2".to_string(),
                sequence: 3,
                role: "user".to_string(),
                blocks: vec![text_block("middle question")],
                outcome: None,
            },
            PortableContextEntry {
                entry_id: "a2".to_string(),
                sequence: 4,
                role: "assistant".to_string(),
                blocks: vec![text_block("middle answer")],
                outcome: Some("completed".to_string()),
            },
            PortableContextEntry {
                entry_id: "u3".to_string(),
                sequence: 5,
                role: "user".to_string(),
                blocks: vec![text_block("recent question")],
                outcome: None,
            },
            PortableContextEntry {
                entry_id: "a3".to_string(),
                sequence: 6,
                role: "assistant".to_string(),
                blocks: vec![text_block("recent answer")],
                outcome: Some("completed".to_string()),
            },
        ];
        // 预算约等于首轮+最近轮，逼出中间轮删除。
        let tight_budget = estimated_tokens(&transcript(
            &[
                entries[0].clone(),
                entries[1].clone(),
                entries[4].clone(),
                entries[5].clone(),
            ],
            true,
        ));
        let mut omissions = Vec::new();

        let category =
            trim_checkpoint_entries_to_budget(&mut entries, &mut omissions, tight_budget)
                .expect("budget trimming");

        let ids = entries
            .iter()
            .map(|entry| entry.entry_id.as_str())
            .collect::<Vec<_>>();
        assert!(
            ids.contains(&"u1"),
            "earliest user task must survive checkpoint budget: {ids:?}"
        );
        assert!(
            !ids.contains(&"u2") && !ids.contains(&"a2"),
            "middle turn should be dropped first: {ids:?}"
        );
        assert_eq!(
            category.strategy,
            "preserve-earliest-user-drop-middle-then-latest-spine"
        );
        assert!(estimated_tokens(&transcript(&entries, true)) <= tight_budget);
    }

    #[test]
    fn checkpoint_folds_atomic_tool_exchange_with_bounded_error_evidence() {
        let arguments = format!(r#"{{"path":"{}"}}"#, "目录/".repeat(1_000));
        let output = (0..300)
            .map(|index| {
                if index == 150 {
                    "ERROR 目标供应商拒绝了工具输出".to_string()
                } else {
                    format!("第 {index} 行 {}", "数据".repeat(20))
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        let block = json!({
            "kind": "atomic-tool-exchange",
            "exchange": {
                "toolCallId": "call-1",
                "toolName": "Read",
                "call": { "argumentsSummary": arguments },
                "result": { "outputSummary": output }
            }
        });

        let folded = fold_atomic_tool_exchange(&block).expect("fold tool exchange");
        let repeated = fold_atomic_tool_exchange(&block).expect("repeat fold");

        assert_eq!(folded, repeated);
        assert_eq!(folded["exchange"]["toolCallId"], "call-1");
        assert_eq!(folded["exchange"]["toolName"], "Read");
        assert!(
            folded["exchange"]["call"]["argumentsSummary"]
                .as_str()
                .expect("arguments")
                .chars()
                .count()
                <= FOLDED_TOOL_ARGUMENTS_MAX_CHARS
        );
        let folded_output = folded["exchange"]["result"]["outputSummary"]
            .as_str()
            .expect("output");
        assert!(folded_output.chars().count() <= FOLDED_TOOL_OUTPUT_MAX_CHARS);
        assert!(folded_output.contains("ERROR 目标供应商拒绝了工具输出"));
    }

    #[test]
    fn oversized_single_turn_preserves_non_empty_spine_for_prompt_and_import() {
        use crate::native_history::{
            ContextSourceEntry, NativeHistoryEngine, NativeHistoryFidelity,
        };

        let mut source_entries = vec![ContextSourceEntry {
            source_entry_id: "user-intent".to_string(),
            occurred_at: None,
            role: "user".to_string(),
            blocks: vec![text_block("继续完成这个目标。".repeat(600))],
            provenance: json!({ "engine": "codex" }),
            fidelity: NativeHistoryFidelity::Semantic,
        }];
        source_entries.extend((0..24).map(|index| ContextSourceEntry {
            source_entry_id: format!("tool-{index}"),
            occurred_at: None,
            role: "control".to_string(),
            blocks: vec![json!({
                "kind": "atomic-tool-exchange",
                "exchange": {
                    "toolCallId": format!("call-{index}"),
                    "toolName": "exec_command",
                    "call": { "argumentsSummary": format!("参数-{index}-{}", "参".repeat(2_000)) },
                    "result": { "outputSummary": format!("输出-{index}-{}", "果".repeat(4_000)) }
                }
            })],
            provenance: json!({ "engine": "codex" }),
            fidelity: NativeHistoryFidelity::Semantic,
        }));
        source_entries.push(ContextSourceEntry {
            source_entry_id: "assistant-outcome".to_string(),
            occurred_at: None,
            role: "assistant".to_string(),
            blocks: vec![text_block("最终结论已经形成。".repeat(600))],
            provenance: json!({ "engine": "codex" }),
            fidelity: NativeHistoryFidelity::Semantic,
        });
        let compile = |structured_history_import| {
            compile_native_context(&CompileNativeContextRequest {
                session_id: "continuation-a".to_string(),
                binding_key: "continuation:operation-a".to_string(),
                destination: json!({ "engine": "codex" }),
                source: NativeHistorySource {
                    session_id: "codex:source".to_string(),
                    native_session_id: "source".to_string(),
                    engine: NativeHistoryEngine::Codex,
                    provider_profile_id: Some("provider-a".to_string()),
                },
                history: NativeHistoryReadResult {
                    reader_id: NativeHistoryEngine::Codex.reader_id().to_string(),
                    source_fingerprint: "sha256:source".to_string(),
                    through_cursor: "cursor-a".to_string(),
                    entries: source_entries.clone(),
                    fidelity: NativeHistoryFidelity::Semantic,
                    omissions: Vec::new(),
                },
                capabilities: RuntimeContextCapabilities {
                    native_delta: false,
                    structured_history_import,
                    native_clone: false,
                    user_channel_transcript: true,
                    tool_history: structured_history_import,
                    image_history: false,
                    strong_context_ack: structured_history_import,
                },
                budget_estimated_tokens: Some(1_800),
            })
            .expect("compile oversized native turn")
        };

        let prompt = compile(false);
        let native_import = compile(true);
        for package in [&prompt, &native_import] {
            assert!(package.compression.source_estimated_tokens > 1_800);
            assert!(package.compression.package_estimated_tokens > 0);
            assert!(package.compression.package_estimated_tokens <= 1_800);
            assert!(package
                .delta
                .iter()
                .any(|entry| entry.entry_id == "user-intent"));
            assert!(package
                .delta
                .iter()
                .any(|entry| entry.entry_id == "assistant-outcome"));
            assert!(!package.manifest.omitted.is_empty());
        }
        assert_eq!(prompt.manifest.mode, ProjectionMode::Checkpoint);
        assert_eq!(
            native_import.manifest.mode,
            ProjectionMode::NativeHistoryImport
        );
        assert!(native_import.prompt_prefix.is_empty());
    }

    #[test]
    fn native_compilation_rejects_empty_portable_history() {
        use crate::native_history::{NativeHistoryEngine, NativeHistoryFidelity};

        let error = compile_native_context(&CompileNativeContextRequest {
            session_id: "continuation-a".to_string(),
            binding_key: "continuation:operation-a".to_string(),
            destination: json!({ "engine": "codex" }),
            source: NativeHistorySource {
                session_id: "codex:source".to_string(),
                native_session_id: "source".to_string(),
                engine: NativeHistoryEngine::Codex,
                provider_profile_id: Some("provider-a".to_string()),
            },
            history: NativeHistoryReadResult {
                reader_id: NativeHistoryEngine::Codex.reader_id().to_string(),
                source_fingerprint: "sha256:source".to_string(),
                through_cursor: "cursor-a".to_string(),
                entries: Vec::new(),
                fidelity: NativeHistoryFidelity::Semantic,
                omissions: Vec::new(),
            },
            capabilities: RuntimeContextCapabilities {
                native_delta: false,
                structured_history_import: true,
                native_clone: false,
                user_channel_transcript: true,
                tool_history: true,
                image_history: false,
                strong_context_ack: true,
            },
            budget_estimated_tokens: None,
        })
        .expect_err("empty native history must fail closed");

        assert_eq!(error, "native history has no portable context entries");
    }

    #[test]
    fn collab_stage_outcome_enters_portable_context_even_when_destination_owned() {
        let stored = |sequence: i64, event_id: &str, fact_type: &str, payload: Value| StoredEvent {
            session_id: "session-1".to_string(),
            sequence,
            event_id: event_id.to_string(),
            fact_type: fact_type.to_string(),
            logical_turn_id: Some(format!("turn-{sequence}")),
            attempt_id: Some("attempt-stage-1".to_string()),
            dedupe_key: None,
            payload_json: payload.to_string(),
            payload_checksum: format!("sha256:{event_id}"),
            fidelity: Fidelity::Canonical,
            committed_at: sequence,
        };
        let events = vec![
            stored(
                1,
                "requested-1",
                "conversation.turnRequested",
                json!({
                    "type": "conversation.turnRequested",
                    "input": {
                        "text": "user task\n---\n【协作调度 · 主幕对话】\n[[mossx.collab.briefing]]"
                    }
                }),
            ),
            stored(
                2,
                "accepted-1",
                "conversation.turnAccepted",
                json!({
                    "type": "conversation.turnAccepted",
                    "bindingKey": "claude::provider-a"
                }),
            ),
            stored(
                3,
                "outcome-1",
                "squad.nodeOutcomeRecorded",
                json!({
                    "type": "squad.nodeOutcomeRecorded",
                    "factId": "agent:run1:implement:attempt-stage-1",
                    "runId": "run1",
                    "nodeId": "implement",
                    "attemptId": "attempt-stage-1",
                    "outcome": {
                        "status": "succeeded",
                        "summary": "短摘要",
                        "body": "完整实现说明：新增 Phone CRUD 与测试。"
                    },
                    "recordedAt": 3
                }),
            ),
        ];
        let package = compile_context(
            &events,
            &CompileContextRequest {
                session_id: "session-1".to_string(),
                binding_key: "claude::provider-a".to_string(),
                destination: json!({"engine": "claude"}),
                destination_native_session_id: Some("claude:native-1".to_string()),
                from_sequence_exclusive: None,
                through_sequence_inclusive: None,
                exclude_attempt_id: None,
                capabilities: RuntimeContextCapabilities {
                    native_delta: false,
                    structured_history_import: false,
                    native_clone: false,
                    user_channel_transcript: true,
                    tool_history: false,
                    image_history: false,
                    strong_context_ack: false,
                },
                budget_estimated_tokens: None,
            },
        )
        .expect("collab stage package");

        assert!(
            package.prompt_prefix.contains("完整实现说明"),
            "stage body must enter prompt: {}",
            package.prompt_prefix
        );
        assert!(
            package.prompt_prefix.contains("协作环节 implement"),
            "stage label missing: {}",
            package.prompt_prefix
        );
        assert!(
            !package.prompt_prefix.contains("[[mossx.collab.briefing]]"),
            "collab control briefing must not enter prompt: {}",
            package.prompt_prefix
        );
        // briefing 可能被 destination-owned 先剔除，或被 collab-control omission 剔除
        assert!(
            package
                .manifest
                .omitted
                .iter()
                .any(|o| o.category == "collab-control-prompt"
                    || o.category == "destination-owned"),
            "expected control briefing omitted somehow: {:?}",
            package.manifest.omitted
        );
    }

    #[test]
    fn portable_assistant_transform_is_allowlist_based() {
        let event = StoredEvent {
            session_id: "session-1".to_string(),
            sequence: 1,
            event_id: "event-1".to_string(),
            fact_type: "conversation.turnCommitted".to_string(),
            logical_turn_id: Some("turn-1".to_string()),
            attempt_id: Some("attempt-1".to_string()),
            dedupe_key: None,
            payload_json: "{}".to_string(),
            payload_checksum: "sha256:test".to_string(),
            fidelity: Fidelity::Canonical,
            committed_at: 1,
        };
        let payload = json!({
            "outcome": { "status": "completed" },
            "assistant": [
                { "kind": "text", "text": "visible" },
                { "kind": "reasoning", "text": "private" },
                {
                    "kind": "redacted-reasoning",
                    "artifactRef": { "artifactId": "reasoning-1" }
                },
                { "kind": "future-private-block", "payload": "secret" }
            ],
            "atomicToolExchanges": []
        });
        let capabilities = RuntimeContextCapabilities {
            native_delta: false,
            structured_history_import: false,
            native_clone: false,
            user_channel_transcript: true,
            tool_history: false,
            image_history: false,
            strong_context_ack: false,
        };
        let mut omissions = Vec::new();

        let entry = transform_event(&event, &payload, &capabilities, &mut omissions)
            .expect("visible text remains portable");

        assert_eq!(entry.blocks, vec![text_block("visible")]);
        assert_eq!(omissions.len(), 3);
        assert!(omissions
            .iter()
            .any(|omission| omission.category == "provider-private-block"));
        assert!(omissions.iter().any(|omission| {
            omission.category == "provider-private-reasoning"
                && omission.retrievable_ref.as_deref() == Some("reasoning-1")
        }));
    }

    #[test]
    fn destination_owned_only_package_has_no_transfer_payload() {
        let stored = |sequence: i64, event_id: &str, fact_type: &str, payload: Value| StoredEvent {
            session_id: "session-1".to_string(),
            sequence,
            event_id: event_id.to_string(),
            fact_type: fact_type.to_string(),
            logical_turn_id: Some("turn-1".to_string()),
            attempt_id: Some("attempt-1".to_string()),
            dedupe_key: None,
            payload_json: payload.to_string(),
            payload_checksum: format!("sha256:{event_id}"),
            fidelity: Fidelity::Canonical,
            committed_at: sequence,
        };
        let events = vec![
            stored(
                1,
                "requested-1",
                "conversation.turnRequested",
                json!({"input": {"text": "already native"}}),
            ),
            stored(
                2,
                "accepted-1",
                "conversation.turnAccepted",
                json!({"bindingKey": "claude::provider-a"}),
            ),
        ];
        let package = compile_context(
            &events,
            &CompileContextRequest {
                session_id: "session-1".to_string(),
                binding_key: "claude::provider-a".to_string(),
                destination: json!({"engine": "claude"}),
                destination_native_session_id: Some("claude:native-1".to_string()),
                from_sequence_exclusive: None,
                through_sequence_inclusive: None,
                exclude_attempt_id: None,
                capabilities: RuntimeContextCapabilities {
                    native_delta: false,
                    structured_history_import: false,
                    native_clone: false,
                    user_channel_transcript: true,
                    tool_history: false,
                    image_history: false,
                    strong_context_ack: true,
                },
                budget_estimated_tokens: None,
            },
        )
        .expect("compile destination-owned package");

        assert!(package.delta.is_empty());
        assert!(package.prompt_prefix.is_empty());
        assert_eq!(package.compression.source_estimated_tokens, 0);
        assert_eq!(package.compression.package_estimated_tokens, 0);
        assert!(!package.manifest.omitted.is_empty());
        assert!(package
            .manifest
            .omitted
            .iter()
            .all(|omission| !omission.requires_confirmation()));
    }

    #[test]
    fn native_source_identity_changes_package_checksum() {
        use crate::native_history::{
            ContextSourceEntry, NativeHistoryEngine, NativeHistoryFidelity,
        };
        let compile = |fingerprint: &str| {
            compile_native_context(&CompileNativeContextRequest {
                session_id: "continuation-a".to_string(),
                binding_key: "codex:provider-b".to_string(),
                destination: json!({ "engine": "codex", "providerProfileId": "provider-b" }),
                source: NativeHistorySource {
                    session_id: "claude:source".to_string(),
                    native_session_id: "source".to_string(),
                    engine: NativeHistoryEngine::Claude,
                    provider_profile_id: Some("provider-a".to_string()),
                },
                history: NativeHistoryReadResult {
                    reader_id: NativeHistoryEngine::Claude.reader_id().to_string(),
                    source_fingerprint: fingerprint.to_string(),
                    through_cursor: "cursor-a".to_string(),
                    entries: vec![ContextSourceEntry {
                        source_entry_id: "entry-a".to_string(),
                        occurred_at: None,
                        role: "user".to_string(),
                        blocks: vec![json!({ "kind": "text", "text": "hello" })],
                        provenance: json!({ "engine": "claude" }),
                        fidelity: NativeHistoryFidelity::Semantic,
                    }],
                    fidelity: NativeHistoryFidelity::Semantic,
                    omissions: Vec::new(),
                },
                capabilities: RuntimeContextCapabilities {
                    native_delta: false,
                    structured_history_import: true,
                    native_clone: false,
                    user_channel_transcript: true,
                    tool_history: true,
                    image_history: true,
                    strong_context_ack: true,
                },
                budget_estimated_tokens: None,
            })
            .expect("compile")
        };
        let first = compile("sha256:first");
        let same = compile("sha256:first");
        let changed = compile("sha256:changed");
        assert_eq!(first.package_id, same.package_id);
        assert_eq!(
            first.manifest.source_checksum,
            same.manifest.source_checksum
        );
        assert_ne!(first.package_id, changed.package_id);
    }

    #[test]
    fn native_compilation_decisions_change_package_identity() {
        use crate::native_history::{
            ContextSourceEntry, NativeHistoryEngine, NativeHistoryFidelity,
        };
        let compile = |destination: Value,
                       capabilities: RuntimeContextCapabilities,
                       budget_estimated_tokens: Option<u64>| {
            compile_native_context(&CompileNativeContextRequest {
                session_id: "continuation-a".to_string(),
                binding_key: "binding-a".to_string(),
                destination,
                source: NativeHistorySource {
                    session_id: "claude:source".to_string(),
                    native_session_id: "source".to_string(),
                    engine: NativeHistoryEngine::Claude,
                    provider_profile_id: Some("provider-a".to_string()),
                },
                history: NativeHistoryReadResult {
                    reader_id: NativeHistoryEngine::Claude.reader_id().to_string(),
                    source_fingerprint: "sha256:source".to_string(),
                    through_cursor: "cursor-a".to_string(),
                    entries: vec![ContextSourceEntry {
                        source_entry_id: "entry-a".to_string(),
                        occurred_at: None,
                        role: "user".to_string(),
                        blocks: vec![json!({ "kind": "text", "text": "hello" })],
                        provenance: json!({ "engine": "claude" }),
                        fidelity: NativeHistoryFidelity::Semantic,
                    }],
                    fidelity: NativeHistoryFidelity::Semantic,
                    omissions: Vec::new(),
                },
                capabilities,
                budget_estimated_tokens,
            })
            .expect("compile")
        };
        let transcript = RuntimeContextCapabilities {
            native_delta: false,
            structured_history_import: false,
            native_clone: false,
            user_channel_transcript: true,
            tool_history: false,
            image_history: false,
            strong_context_ack: false,
        };
        let mut import = transcript.clone();
        import.structured_history_import = true;
        import.tool_history = true;
        let first = compile(
            json!({"engine": "codex", "model": "a"}),
            transcript.clone(),
            None,
        );
        let same = compile(
            json!({"engine": "codex", "model": "a"}),
            transcript.clone(),
            None,
        );
        let destination_changed = compile(
            json!({"engine": "codex", "model": "b"}),
            transcript.clone(),
            None,
        );
        let capability_changed = compile(json!({"engine": "codex", "model": "a"}), import, None);
        let budget_changed = compile(
            json!({"engine": "codex", "model": "a"}),
            transcript,
            Some(16),
        );

        assert_eq!(first.package_id, same.package_id);
        assert_ne!(first.package_id, destination_changed.package_id);
        assert_ne!(first.package_id, capability_changed.package_id);
        assert_ne!(first.package_id, budget_changed.package_id);
    }
}
