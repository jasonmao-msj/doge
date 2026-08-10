use std::collections::HashMap;

use crate::shared_event_log::canonical::types::CanonicalFact;
use crate::shared_event_log::StoredEvent;
use crate::shared_session_v2::target_input_from_snapshot;

use super::types::{
    apply_stage_bindings, cap_text, default_stage_specs, short_text, AgentPlanDraftV1,
    AgentProjectionV1, AgentRunStatus, AgentStageBindingInput, AgentStageId, AgentStageStatus,
    AGENT_SCHEMA_VERSION, FINAL_SUMMARY_CHARS, STAGE_SHORT_OUTCOME_CHARS,
};

fn decode_fact(event: &StoredEvent) -> Result<CanonicalFact, String> {
    serde_json::from_str(&event.payload_json).map_err(|error| {
        format!(
            "decode agent fact session={} sequence={}: {error}",
            event.session_id, event.sequence
        )
    })
}

fn parse_plan(value: &serde_json::Value) -> Option<AgentPlanDraftV1> {
    if let Ok(plan) = serde_json::from_value::<AgentPlanDraftV1>(value.clone()) {
        if !plan.summary.trim().is_empty() {
            return Some(plan);
        }
    }
    let summary = value
        .get("summary")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .trim();
    if summary.is_empty() {
        return None;
    }
    let markdown = value
        .get("markdown")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .unwrap_or(summary)
        .to_string();
    let steps = value
        .get("steps")
        .and_then(|item| item.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    Some(AgentPlanDraftV1 {
        schema_version: AGENT_SCHEMA_VERSION,
        summary: summary.to_string(),
        markdown,
        steps,
    })
}

fn run_mut<'a>(
    runs: &'a mut [AgentProjectionV1],
    run_id: &str,
) -> Option<&'a mut AgentProjectionV1> {
    runs.iter_mut().find(|run| run.run_id == run_id)
}

fn stage_mut<'a>(
    run: &'a mut AgentProjectionV1,
    stage_id: &str,
) -> Option<&'a mut super::types::AgentStageProjectionV1> {
    run.stages.iter_mut().find(|stage| stage.id == stage_id)
}

fn apply_plan_gate(
    runs: &mut [AgentProjectionV1],
    plan_attempt_by_run: &mut HashMap<String, String>,
    run_id: &str,
    revision: u32,
    plan_value: &serde_json::Value,
    at: i64,
    stage_id: Option<&str>,
) {
    let Some(run) = run_mut(runs, run_id) else {
        return;
    };
    let Some(plan) = parse_plan(plan_value) else {
        return;
    };
    let short = short_text(&plan.summary, 120);
    run.plan = Some(plan);
    run.plan_revision = revision.max(1);
    run.status = AgentRunStatus::AwaitingApproval;
    run.updated_at = at;
    let gate_stage_id = stage_id.unwrap_or(AgentStageId::Plan.as_str());
    if let Some(stage) = stage_mut(run, gate_stage_id) {
        stage.status = AgentStageStatus::Succeeded;
        stage.settled_at = Some(at);
        stage.short_outcome = Some(short);
    }
    if let Some(attempt_id) = plan_attempt_by_run.remove(run_id) {
        run.active_attempt_ids.retain(|id| id != &attempt_id);
    }
}

pub fn project_agent_runs(
    session_id: &str,
    events: &[StoredEvent],
) -> Result<Vec<AgentProjectionV1>, String> {
    let mut runs = Vec::<AgentProjectionV1>::new();
    let mut plan_attempt_by_run = HashMap::<String, String>::new();

    for event in events {
        let fact = decode_fact(event)?;
        match fact {
            CanonicalFact::SquadRunRequested(fact) => {
                if runs.iter().any(|run| run.run_id == fact.run_id) {
                    continue;
                }
                let default_target = target_input_from_snapshot(&fact.lead_target)?;
                let mut stages = default_stage_specs(&default_target);
                if let Some(bindings) = fact.extra.get("stageBindings") {
                    if let Ok(parsed) =
                        serde_json::from_value::<Vec<AgentStageBindingInput>>(bindings.clone())
                    {
                        stages = apply_stage_bindings(stages, &parsed);
                    }
                }
                if let Some(attempt_id) = fact
                    .extra
                    .get("planAttemptId")
                    .or_else(|| fact.extra.get("leadAttemptId"))
                    .and_then(|value| value.as_str())
                {
                    plan_attempt_by_run.insert(fact.run_id.clone(), attempt_id.to_string());
                }
                let first_stage_images = fact
                    .extra
                    .get("firstStageImages")
                    .and_then(|value| value.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(str::to_string))
                            .filter(|s| !s.trim().is_empty())
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let user_visible_text = fact
                    .extra
                    .get("userVisibleText")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(fact.request_text.as_str())
                    .to_string();
                runs.push(AgentProjectionV1 {
                    schema_version: AGENT_SCHEMA_VERSION,
                    run_id: fact.run_id,
                    workspace_root: fact
                        .extra
                        .get("workspaceRoot")
                        .and_then(|value| value.as_str())
                        .unwrap_or(&fact.workspace_id)
                        .to_string(),
                    workspace_id: fact.workspace_id,
                    session_id: session_id.to_string(),
                    request_text: fact.request_text,
                    user_visible_text,
                    first_stage_images,
                    target: default_target,
                    status: AgentRunStatus::Planning,
                    plan_revision: 0,
                    plan: None,
                    stages,
                    active_attempt_ids: vec![],
                    diagnostics: vec![],
                    requested_at: fact.requested_at,
                    approved_at: None,
                    approval_note: None,
                    updated_at: fact.requested_at,
                    final_summary: None,
                });
            }
            CanonicalFact::SquadPlanProposed(fact) => {
                apply_plan_gate(
                    &mut runs,
                    &mut plan_attempt_by_run,
                    &fact.run_id,
                    fact.revision,
                    &fact.plan,
                    fact.proposed_at,
                    fact.extra.get("stageId").and_then(|value| value.as_str()),
                );
            }
            CanonicalFact::SquadPlanRevised(fact) => {
                apply_plan_gate(
                    &mut runs,
                    &mut plan_attempt_by_run,
                    &fact.run_id,
                    fact.revision,
                    &fact.plan,
                    fact.revised_at,
                    fact.extra.get("stageId").and_then(|value| value.as_str()),
                );
            }
            CanonicalFact::SquadPlanApproved(fact) => {
                if let Some(run) = run_mut(&mut runs, &fact.run_id) {
                    if fact.revision == run.plan_revision {
                        run.status = AgentRunStatus::Implementing;
                        run.approved_at = Some(fact.approved_at);
                        run.updated_at = fact.approved_at;
                        // 可选：用户在批准时补充，供后续段 prompt 注入
                        let note = fact
                            .extra
                            .get("approvalNote")
                            .and_then(|value| value.as_str())
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .map(|value| value.to_string());
                        run.approval_note = note;
                    } else {
                        run.status = AgentRunStatus::Failed;
                        run.diagnostics.push(format!(
                            "approved revision {} mismatches {}",
                            fact.revision, run.plan_revision
                        ));
                    }
                }
            }
            CanonicalFact::TurnRequested(fact) => {
                let run_id = fact
                    .extra
                    .get("squadRunId")
                    .and_then(|value| value.as_str());
                let stage_id = fact
                    .extra
                    .get("squadNodeId")
                    .and_then(|value| value.as_str())
                    .map(|id| {
                        // normalize legacy execute -> implement
                        if id == "execute" {
                            "implement"
                        } else {
                            id
                        }
                    });
                let binding_key = fact
                    .extra
                    .get("squadWorkerBindingKey")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                if let (Some(run_id), Some(stage_id)) = (run_id, stage_id) {
                    if let Some(run) = run_mut(&mut runs, run_id) {
                        if let Some(stage) = stage_mut(run, stage_id) {
                            stage.status = AgentStageStatus::Running;
                            stage.attempt_id = Some(fact.attempt_id.clone());
                            stage.binding_key = Some(binding_key.to_string());
                            stage.started_at = Some(fact.requested_at);
                            stage.error = None;
                        }
                        if !run.active_attempt_ids.contains(&fact.attempt_id) {
                            run.active_attempt_ids.push(fact.attempt_id.clone());
                        }
                        match AgentStageId::parse(stage_id) {
                            Some(AgentStageId::Plan) => run.status = AgentRunStatus::Planning,
                            Some(AgentStageId::Implement) => {
                                run.status = AgentRunStatus::Implementing
                            }
                            Some(AgentStageId::Review) => run.status = AgentRunStatus::Reviewing,
                            None => {
                                // 自定义 N 段：首段视作 planning，其余 implementing
                                let is_first = run
                                    .stages
                                    .first()
                                    .map(|stage| stage.id == stage_id)
                                    .unwrap_or(false);
                                run.status = if is_first {
                                    AgentRunStatus::Planning
                                } else {
                                    AgentRunStatus::Implementing
                                };
                            }
                        }
                        run.updated_at = fact.requested_at;
                    }
                }
            }
            CanonicalFact::SquadNodeOutcomeRecorded(fact) => {
                if let Some(run) = run_mut(&mut runs, &fact.run_id) {
                    let stage_id = if fact.node_id == "execute" {
                        "implement".to_string()
                    } else {
                        fact.node_id.clone()
                    };
                    let status = fact
                        .outcome
                        .get("status")
                        .and_then(|value| value.as_str())
                        .unwrap_or("failed");
                    let summary = fact
                        .outcome
                        .get("summary")
                        .and_then(|value| value.as_str())
                        .unwrap_or("")
                        .trim();
                    // body 优先（Runtime Context / 右栏全文）；旧事件无 body 时 fallback summary
                    let body = fact
                        .outcome
                        .get("body")
                        .and_then(|value| value.as_str())
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .unwrap_or(summary);
                    // short=阶段 chip；full=右栏 Messages 全文
                    let short = short_text(summary, STAGE_SHORT_OUTCOME_CHARS);
                    let full = cap_text(body, FINAL_SUMMARY_CHARS);
                    if let Some(stage) = stage_mut(run, &stage_id) {
                        stage.settled_at = Some(fact.recorded_at);
                        if status == "succeeded" {
                            stage.status = AgentStageStatus::Succeeded;
                            stage.short_outcome = Some(short.clone());
                            if !full.is_empty() {
                                stage.full_outcome = Some(full);
                            }
                            stage.error = None;
                        } else {
                            stage.status = AgentStageStatus::Failed;
                            stage.error = Some(short.clone());
                            stage.short_outcome = Some(short.clone());
                            if !full.is_empty() {
                                stage.full_outcome = Some(full);
                            }
                        }
                    }
                    run.active_attempt_ids
                        .retain(|attempt| attempt != &fact.attempt_id);
                    run.updated_at = fact.recorded_at;
                    // finalSummary 在 settle 时由「全节点调度总结」写入，此处不塞末段原文
                }
            }
            CanonicalFact::SquadBranchBlocked(fact) => {
                if let Some(run) = run_mut(&mut runs, &fact.run_id) {
                    run.status = AgentRunStatus::Failed;
                    run.diagnostics.push(fact.reason.clone());
                    run.updated_at = fact.blocked_at;
                    if let Some(node_id) = fact.node_id.as_deref() {
                        let stage_id = if node_id == "execute" {
                            "implement"
                        } else {
                            node_id
                        };
                        if let Some(stage) = stage_mut(run, stage_id) {
                            stage.status = AgentStageStatus::Failed;
                            stage.error = Some(short_text(&fact.reason, 160));
                        }
                    }
                }
            }
            CanonicalFact::SquadCancelRequested(fact) => {
                if let Some(run) = run_mut(&mut runs, &fact.run_id) {
                    if !run.status.is_terminal() {
                        run.diagnostics
                            .push(format!("cancel requested: {}", fact.reason));
                    }
                    run.updated_at = fact.requested_at;
                }
            }
            CanonicalFact::SquadRunSettled(fact) => {
                if let Some(run) = run_mut(&mut runs, &fact.run_id) {
                    if let Some(status) = AgentRunStatus::parse(&fact.status) {
                        run.status = status;
                    } else {
                        run.status = AgentRunStatus::Failed;
                    }
                    if let Some(summary) = fact.summary {
                        let next = cap_text(&summary, FINAL_SUMMARY_CHARS);
                        if !next.is_empty() {
                            // settle 写入的是全节点调度总结
                            run.final_summary = Some(next);
                        }
                    }
                    for stage in &mut run.stages {
                        if matches!(
                            stage.status,
                            AgentStageStatus::Pending | AgentStageStatus::Running
                        ) {
                            stage.status = if run.status == AgentRunStatus::Cancelled {
                                AgentStageStatus::Skipped
                            } else {
                                AgentStageStatus::Failed
                            };
                        }
                    }
                    run.active_attempt_ids.clear();
                    run.updated_at = fact.settled_at;
                }
            }
            _ => {}
        }
    }

    for run in &mut runs {
        if let Some(plan_attempt) = plan_attempt_by_run.get(&run.run_id) {
            if !run.active_attempt_ids.contains(plan_attempt)
                && run.status == AgentRunStatus::Planning
            {
                run.active_attempt_ids.push(plan_attempt.clone());
            }
        }
    }

    Ok(runs)
}

pub fn active_agent_run(
    session_id: &str,
    events: &[StoredEvent],
) -> Result<Option<AgentProjectionV1>, String> {
    Ok(project_agent_runs(session_id, events)?
        .into_iter()
        .find(|run| !run.status.is_terminal()))
}
