use serde_json::{json, Value};
use tauri::State;
use uuid::Uuid;

use crate::shared_event_log::canonical::types::{
    CanonicalFact, SquadCancelRequestedFact, SquadNodeOutcomeRecordedFact, SquadPlanApprovedFact,
    SquadPlanProposedFact, SquadPlanRevisedFact, SquadRunRequestedFact, SquadRunSettledFact,
};
use crate::shared_session_v2::{require_shared_session_workspace_owner, ExecutionTargetInput};
use crate::state::AppState;

use super::support::*;
use super::types::{
    apply_stage_bindings, cap_text, empty_extra, short_text, stages_from_bindings,
    AgentCancelResultV1, AgentPlanDraftV1, AgentPreparedAttemptV1, AgentProjectionV1,
    AgentRunStatus, AgentStageBindingInput, AgentStageId, AgentStageProjectionV1, AgentStageStatus,
    AGENT_SCHEMA_VERSION, FINAL_SUMMARY_CHARS, STAGE_OUTCOME_BODY_CHARS, STAGE_SHORT_OUTCOME_CHARS,
};

fn stage_index(run: &AgentProjectionV1, stage_id: &str) -> Option<usize> {
    run.stages.iter().position(|stage| stage.id == stage_id)
}

fn next_pending_stage(run: &AgentProjectionV1) -> Option<&AgentStageProjectionV1> {
    run.stages
        .iter()
        .find(|stage| stage.status == AgentStageStatus::Pending)
}

/// 按**当前段** upstream_feed_mode 组装已成功前序产出。
/// - summary（默认）：short_outcome
/// - full：full_outcome（空则回退 short），并 cap body 上限
fn prior_feed_notes(run: &AgentProjectionV1, stage_index: usize) -> String {
    let mode = run
        .stages
        .get(stage_index)
        .and_then(|stage| stage.upstream_feed_mode.as_deref())
        .map(str::trim)
        .unwrap_or("summary");
    let use_full = mode == "full";
    run.stages
        .iter()
        .take(stage_index)
        .filter(|stage| stage.status == AgentStageStatus::Succeeded)
        .filter_map(|stage| {
            if use_full {
                let full = stage
                    .full_outcome
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                if let Some(text) = full {
                    return Some(cap_text(text, STAGE_OUTCOME_BODY_CHARS));
                }
            }
            stage
                .short_outcome
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .collect::<Vec<_>>()
        .join("\n---\n")
}

fn access_mode_for(stage: &AgentStageProjectionV1) -> String {
    let mode = stage.access_mode.trim();
    if mode == "read-only" || mode == "current" {
        mode.to_string()
    } else {
        stage_access_mode(&stage.id, &stage.target).to_string()
    }
}

/// 协作 stage 结算 outcome：summary 给 chip，body 给 Runtime Context / 右栏全文。
fn stage_outcome_value(status: &str, summary: &str, body: &str) -> Value {
    json!({
        "schemaVersion": AGENT_SCHEMA_VERSION,
        "status": status,
        "summary": short_text(summary, STAGE_SHORT_OUTCOME_CHARS),
        "body": cap_text(body, STAGE_OUTCOME_BODY_CHARS),
    })
}

fn start_stage_attempt(
    writer: &crate::shared_event_log::SharedEventWriter,
    session_id: &str,
    run: &AgentProjectionV1,
    stage: &AgentStageProjectionV1,
) -> Result<AgentPreparedAttemptV1, String> {
    let stage_idx = stage_index(run, &stage.id).unwrap_or(0);
    // 首段吃完整 model text（含注入）；后续段只吃可见原文 + plan/上游短说明
    let base_task = if stage_idx == 0 {
        run.request_text.as_str()
    } else if !run.user_visible_text.trim().is_empty() {
        run.user_visible_text.as_str()
    } else {
        run.request_text.as_str()
    };
    // 批准补充：仅注入非首段（规划后），与打回补充对称但不重开 run
    let task_owned = if stage_idx > 0 {
        match run
            .approval_note
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some(note) => Some(format!("{base_task}\n\n【批准时用户补充】\n{note}")),
            None => None,
        }
    } else {
        None
    };
    let task_text = task_owned.as_deref().unwrap_or(base_task);
    let prompt = build_stage_prompt(
        &stage.id,
        stage_idx,
        run.stages.len(),
        stage.requires_approval,
        stage.role_prompt.as_deref(),
        stage.persona_prompt.as_deref(),
        task_text,
        run.plan.as_ref(),
        &prior_feed_notes(run, stage_idx),
    );
    let attempt_id = Uuid::new_v4().to_string();
    let logical_turn_id = Uuid::new_v4().to_string();
    let access_mode = access_mode_for(stage);
    // Context Fan-in：仅首段重试带图
    let images = if stage_idx == 0 && !run.first_stage_images.is_empty() {
        Some(run.first_stage_images.clone())
    } else {
        None
    };
    let begin = begin_stage_turn(
        writer,
        session_id,
        &stage.target,
        &run.run_id,
        &stage.id,
        prompt,
        access_mode.as_str(),
        attempt_id.clone(),
        logical_turn_id.clone(),
        images,
    )?;
    prepared_from_begin(
        run.run_id.clone(),
        stage.id.clone(),
        attempt_id,
        logical_turn_id,
        &begin,
        stage.target.clone(),
        access_mode.as_str(),
    )
}

#[tauri::command]
pub(crate) async fn shared_agent_request_run(
    workspace_id: String,
    thread_id: String,
    text: String,
    target: ExecutionTargetInput,
    // 有序列表：完整 N 段定义（target + title + rolePrompt + requiresApproval）
    stage_bindings: Option<Vec<AgentStageBindingInput>>,
    // 首段附图（Context Fan-in）；后续段不传
    images: Option<Vec<String>>,
    // 主幕可见原文（无注入块）；缺省回退 text
    visible_text: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    require_agent_enabled()?;
    let session_id = parse_session(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &session_id)?;
    crate::shared_session_v2::validate_resolved_execution_target(&target)?;
    validate_agent_target(&target)?;
    let first_stage_images: Vec<String> = images
        .clone()
        .unwrap_or_default()
        .into_iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    // 纯图：允许空正文，用占位任务文案喂首段（下游只吃文字归纳）
    let request_text = {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            if first_stage_images.is_empty() {
                return Err("agent-request-invalid: text or images must be non-empty".to_string());
            }
            "（请根据附图回答）"
        } else {
            trimmed
        }
    };
    let user_visible_text = visible_text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(request_text)
        .to_string();

    let bindings = stage_bindings.unwrap_or_default();
    for binding in &bindings {
        validate_agent_target(&binding.target)?;
        crate::shared_session_v2::validate_resolved_execution_target(&binding.target)?;
    }
    let stages = if bindings.is_empty() {
        apply_stage_bindings(super::types::default_stage_specs(&target), &[])
    } else {
        stages_from_bindings(&target, &bindings)
    };
    if stages.is_empty() {
        return Err("agent-request-invalid: stages empty".to_string());
    }

    let workspace_root = resolve_workspace_root(&state, &workspace_id).await?;
    let _transition = lock_agent_transition()?;
    let writer = require_writer_state(state.inner())?;
    ensure_no_active_run(writer, &session_id)?;

    let run_id = format!("agent-{}", Uuid::new_v4());
    let attempt_id = Uuid::new_v4().to_string();
    let logical_turn_id = Uuid::new_v4().to_string();
    let requested_at = now_ms();
    let first = stages[0].clone();
    let access_mode = access_mode_for(&first);

    // 必须与 AgentStageBindingInput / stages_from_bindings 字段对齐；
    // 漏写 upstreamFeedMode 会导致投影回放后后续段永远缺省 summary（假实现）。
    let bindings_json = serde_json::to_value(
        stages
            .iter()
            .map(|stage| {
                json!({
                    "id": stage.id,
                    "title": stage.title,
                    "rolePrompt": stage.role_prompt,
                    "accessMode": stage.access_mode,
                    "requiresApproval": stage.requires_approval,
                    "upstreamFeedMode": stage.upstream_feed_mode,
                    "personaAgentId": stage.persona_agent_id,
                    "personaAgentName": stage.persona_agent_name,
                    "personaAgentIcon": stage.persona_agent_icon,
                    "personaPrompt": stage.persona_prompt,
                    "target": stage.target,
                })
            })
            .collect::<Vec<_>>(),
    )
    .map_err(|error| error.to_string())?;

    append_fact(
        writer,
        &session_id,
        CanonicalFact::SquadRunRequested(SquadRunRequestedFact {
            fact_id: format!("agent:{run_id}:requested"),
            run_id: run_id.clone(),
            workspace_id: workspace_id.clone(),
            request_text: request_text.to_string(),
            lead_target: target.to_snapshot(),
            requested_at,
            extra: json!({
                "planAttemptId": attempt_id,
                "leadAttemptId": attempt_id,
                "planLogicalTurnId": logical_turn_id,
                "firstStageId": first.id,
                "workspaceRoot": workspace_root,
                "orchestration": "multi-cli-collab-v1",
                "stageBindings": bindings_json,
                "firstStageImages": first_stage_images,
                "userVisibleText": user_visible_text,
            }),
        }),
    )?;

    let prompt = build_stage_prompt(
        &first.id,
        0,
        stages.len(),
        first.requires_approval,
        first.role_prompt.as_deref(),
        first.persona_prompt.as_deref(),
        request_text,
        None,
        "",
    );
    let first_images = if first_stage_images.is_empty() {
        None
    } else {
        Some(first_stage_images.clone())
    };
    let begin = begin_stage_turn(
        writer,
        &session_id,
        &first.target,
        &run_id,
        &first.id,
        prompt,
        access_mode.as_str(),
        attempt_id.clone(),
        logical_turn_id.clone(),
        first_images,
    )?;
    if begin.status != crate::shared_session_v2::BeginTurnStatus::Creating {
        let run = require_run(writer, &session_id, &run_id)?;
        append_failed_and_settle(
            writer,
            &run,
            begin.reason.as_deref().unwrap_or("first stage unavailable"),
            requested_at,
        )?;
        return Err("agent-plan-unavailable: failed to prepare first stage".to_string());
    }

    let prepared = prepared_from_begin(
        run_id.clone(),
        first.id,
        attempt_id,
        logical_turn_id,
        &begin,
        first.target,
        access_mode.as_str(),
    )?;
    Ok(json!({
        "projection": require_run(writer, &session_id, &run_id)?,
        "stageAttempt": prepared,
        "planAttempt": prepared,
    }))
}

#[tauri::command]
pub(crate) async fn shared_agent_get(
    workspace_id: String,
    thread_id: String,
    state: State<'_, AppState>,
) -> Result<Option<AgentProjectionV1>, String> {
    let session_id = parse_session(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &session_id)?;
    load_latest(require_writer_state(state.inner())?, &session_id)
}

/// 返回该 Shared 会话中所有协作轮次（历史 + 当前），按时间升序。
/// 用于页面刷新后重放历史折叠卡。
#[tauri::command]
pub(crate) async fn shared_agent_list_all(
    workspace_id: String,
    thread_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<AgentProjectionV1>, String> {
    let session_id = parse_session(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &session_id)?;
    load_all_runs(require_writer_state(state.inner())?, &session_id)
}

/// 记录当前段 terminal；若该段 requiresApproval → 待批准；否则自动启动下一段。
#[tauri::command]
pub(crate) async fn shared_agent_record_plan(
    workspace_id: String,
    thread_id: String,
    run_id: String,
    attempt_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    record_stage_and_maybe_advance(workspace_id, thread_id, run_id, attempt_id, true, state).await
}

#[tauri::command]
pub(crate) async fn shared_agent_approve(
    workspace_id: String,
    thread_id: String,
    run_id: String,
    revision: u32,
    // 可选：用户批准时补充，写入 fact.extra 并注入后续段 prompt
    approval_note: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    require_agent_enabled()?;
    let session_id = parse_session(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &session_id)?;
    let workspace_root = resolve_workspace_root(&state, &workspace_id).await?;
    let _transition = lock_agent_transition()?;
    let writer = require_writer_state(state.inner())?;
    let run = require_run(writer, &session_id, &run_id)?;
    if workspace_root != run.workspace_root {
        append_failed_and_settle(
            writer,
            &run,
            "scope-denied: workspace root changed before approval",
            now_ms(),
        )?;
        return Ok(json!({
            "projection": require_run(writer, &session_id, &run_id)?,
            "stageAttempt": Value::Null,
            "executeAttempt": Value::Null,
        }));
    }
    if run.status != AgentRunStatus::AwaitingApproval || run.plan_revision != revision {
        // 幂等：若已进入后续运行且 revision 匹配则直接返回
        if !run.status.is_terminal() && run.plan_revision == revision {
            return Ok(json!({
                "projection": run,
                "stageAttempt": Value::Null,
                "executeAttempt": Value::Null,
            }));
        }
        return Err(format!(
            "agent-approval-conflict: revision {} status {:?}",
            run.plan_revision, run.status
        ));
    }
    let approved_at = now_ms();
    let note = approval_note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let extra = match note.as_ref() {
        Some(value) => json!({ "approvalNote": value }),
        None => empty_extra(),
    };
    append_fact(
        writer,
        &session_id,
        CanonicalFact::SquadPlanApproved(SquadPlanApprovedFact {
            fact_id: format!("agent:{run_id}:approved:{revision}"),
            run_id: run_id.clone(),
            revision,
            approved_at,
            extra,
        }),
    )?;

    let run = require_run(writer, &session_id, &run_id)?;
    let next = next_pending_stage(&run)
        .cloned()
        .ok_or_else(|| "agent-stage-missing: no pending stage after approval".to_string())?;
    let prepared = match start_stage_attempt(writer, &session_id, &run, &next) {
        Ok(prepared) => prepared,
        Err(error) => {
            let latest = require_run(writer, &session_id, &run_id)?;
            append_failed_and_settle(writer, &latest, &error, now_ms())?;
            return Err(error);
        }
    };
    Ok(json!({
        "projection": require_run(writer, &session_id, &run_id)?,
        "stageAttempt": prepared,
        "executeAttempt": prepared,
    }))
}

/// 通用段结算：实现/中间/末段均可；自动启动下一段或 settle。
#[tauri::command]
pub(crate) async fn shared_agent_record_execute(
    workspace_id: String,
    thread_id: String,
    run_id: String,
    attempt_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    record_stage_and_maybe_advance(workspace_id, thread_id, run_id, attempt_id, false, state).await
}

#[tauri::command]
pub(crate) async fn shared_agent_record_review(
    workspace_id: String,
    thread_id: String,
    run_id: String,
    attempt_id: String,
    state: State<'_, AppState>,
) -> Result<AgentProjectionV1, String> {
    let result =
        record_stage_and_maybe_advance(workspace_id, thread_id, run_id, attempt_id, false, state)
            .await?;
    serde_json::from_value(result.get("projection").cloned().unwrap_or(Value::Null))
        .map_err(|error| error.to_string())
}

async fn record_stage_and_maybe_advance(
    workspace_id: String,
    thread_id: String,
    run_id: String,
    attempt_id: String,
    prefer_plan_parse: bool, // 保留兼容 record_plan 调用约定
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let _ = prefer_plan_parse;
    let session_id = parse_session(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &session_id)?;
    let workspace_root = resolve_workspace_root(&state, &workspace_id).await?;
    let _transition = lock_agent_transition()?;
    let writer = require_writer_state(state.inner())?;
    let run = require_run(writer, &session_id, &run_id)?;
    if run.status.is_terminal() {
        return Ok(json!({ "projection": run, "stageAttempt": Value::Null }));
    }
    if workspace_root != run.workspace_root {
        append_failed_and_settle(
            writer,
            &run,
            "scope-denied: workspace root changed during stage",
            now_ms(),
        )?;
        return Ok(json!({
            "projection": require_run(writer, &session_id, &run_id)?,
            "stageAttempt": Value::Null,
        }));
    }

    // 已 awaiting 且是 plan 重入
    if run.status == AgentRunStatus::AwaitingApproval && prefer_plan_parse {
        return Ok(json!({ "projection": run, "stageAttempt": Value::Null }));
    }

    let stage = run
        .stages
        .iter()
        .find(|stage| stage.attempt_id.as_deref() == Some(attempt_id.as_str()))
        .or_else(|| {
            run.stages
                .iter()
                .find(|stage| stage.status == AgentStageStatus::Running)
        })
        .cloned()
        .ok_or_else(|| "agent-stage-missing: active stage for attempt".to_string())?;

    // 幂等：段已成功则直接推进（避免重复 NodeOutcome）
    if stage.status == AgentStageStatus::Succeeded {
        // fall through to advance
    } else {
        let committed = committed_fact(writer, &session_id, &attempt_id)?;
        let raw = assistant_text(&committed);
        let ok = outcome_completed(&committed);
        if !ok {
            let body = if raw.trim().is_empty() {
                format!("{} 失败。", stage.title)
            } else {
                stage_outcome_body(&raw, &stage.title, false)
            };
            let note = short_text(&body, STAGE_SHORT_OUTCOME_CHARS);
            append_fact(
                writer,
                &session_id,
                CanonicalFact::SquadNodeOutcomeRecorded(SquadNodeOutcomeRecordedFact {
                    fact_id: format!("agent:{run_id}:{}:{attempt_id}", stage.id),
                    run_id: run_id.clone(),
                    node_id: stage.id.clone(),
                    attempt_id: attempt_id.clone(),
                    outcome: stage_outcome_value("failed", &note, &body),
                    recorded_at: committed.committed_at,
                    extra: empty_extra(),
                }),
            )?;
            let latest = require_run(writer, &session_id, &run_id)?;
            append_failed_and_settle(
                writer,
                &latest,
                &format!("{} did not complete successfully", stage.title),
                committed.committed_at,
            )?;
            return Ok(json!({
                "projection": require_run(writer, &session_id, &run_id)?,
                "stageAttempt": Value::Null,
            }));
        }

        // 仅 requires_approval 进入门闩；plan 段尽量解析 SUMMARY，失败不杀 run
        let wants_plan_text =
            stage.requires_approval || AgentStageId::parse(&stage.id) == Some(AgentStageId::Plan);

        let summary_text = if wants_plan_text {
            match parse_plan_from_assistant(&raw) {
                Ok(plan) => {
                    let short = short_text(&plan.summary, STAGE_SHORT_OUTCOME_CHARS);
                    let body = if !plan.markdown.trim().is_empty() {
                        cap_text(&plan.markdown, STAGE_OUTCOME_BODY_CHARS)
                    } else if !raw.trim().is_empty() {
                        stage_outcome_body(&raw, &stage.title, true)
                    } else {
                        short.clone()
                    };
                    append_fact(
                        writer,
                        &session_id,
                        CanonicalFact::SquadNodeOutcomeRecorded(SquadNodeOutcomeRecordedFact {
                            fact_id: format!("agent:{run_id}:{}:{attempt_id}", stage.id),
                            run_id: run_id.clone(),
                            node_id: stage.id.clone(),
                            attempt_id: attempt_id.clone(),
                            outcome: stage_outcome_value("succeeded", &short, &body),
                            recorded_at: committed.committed_at,
                            extra: empty_extra(),
                        }),
                    )?;
                    if stage.requires_approval {
                        append_plan_gate_fact(
                            writer,
                            &session_id,
                            &run_id,
                            &stage.id,
                            &attempt_id,
                            &plan,
                            run.plan_revision,
                            committed.committed_at,
                        )?;
                        return Ok(json!({
                            "projection": require_run(writer, &session_id, &run_id)?,
                            "stageAttempt": Value::Null,
                        }));
                    }
                    short
                }
                Err(_) if stage.requires_approval => {
                    // 批准门闩：解析失败时用原文软降级，不整 run 失败
                    let plan = soft_plan_from_raw(&raw, &stage.title);
                    let short = short_text(&plan.summary, STAGE_SHORT_OUTCOME_CHARS);
                    let body = if !plan.markdown.trim().is_empty() {
                        cap_text(&plan.markdown, STAGE_OUTCOME_BODY_CHARS)
                    } else {
                        stage_outcome_body(&raw, &stage.title, true)
                    };
                    append_fact(
                        writer,
                        &session_id,
                        CanonicalFact::SquadNodeOutcomeRecorded(SquadNodeOutcomeRecordedFact {
                            fact_id: format!("agent:{run_id}:{}:{attempt_id}", stage.id),
                            run_id: run_id.clone(),
                            node_id: stage.id.clone(),
                            attempt_id: attempt_id.clone(),
                            outcome: stage_outcome_value("succeeded", &short, &body),
                            recorded_at: committed.committed_at,
                            extra: empty_extra(),
                        }),
                    )?;
                    append_plan_gate_fact(
                        writer,
                        &session_id,
                        &run_id,
                        &stage.id,
                        &attempt_id,
                        &plan,
                        run.plan_revision,
                        committed.committed_at,
                    )?;
                    return Ok(json!({
                        "projection": require_run(writer, &session_id, &run_id)?,
                        "stageAttempt": Value::Null,
                    }));
                }
                Err(_) => {
                    let is_last = run.stages.last().map(|s| s.id == stage.id).unwrap_or(false)
                        || stage.id == AgentStageId::Review.as_str();
                    let body = stage_outcome_body(&raw, &stage.title, is_last);
                    let note = short_text(&body, STAGE_SHORT_OUTCOME_CHARS);
                    append_fact(
                        writer,
                        &session_id,
                        CanonicalFact::SquadNodeOutcomeRecorded(SquadNodeOutcomeRecordedFact {
                            fact_id: format!("agent:{run_id}:{}:{attempt_id}", stage.id),
                            run_id: run_id.clone(),
                            node_id: stage.id.clone(),
                            attempt_id: attempt_id.clone(),
                            outcome: stage_outcome_value("succeeded", &note, &body),
                            recorded_at: committed.committed_at,
                            extra: empty_extra(),
                        }),
                    )?;
                    note
                }
            }
        } else {
            let is_last = run.stages.last().map(|s| s.id == stage.id).unwrap_or(false)
                || stage.id == AgentStageId::Review.as_str();
            let body = stage_outcome_body(&raw, &stage.title, is_last);
            let note = short_text(&body, STAGE_SHORT_OUTCOME_CHARS);
            append_fact(
                writer,
                &session_id,
                CanonicalFact::SquadNodeOutcomeRecorded(SquadNodeOutcomeRecordedFact {
                    fact_id: format!("agent:{run_id}:{}:{attempt_id}", stage.id),
                    run_id: run_id.clone(),
                    node_id: stage.id.clone(),
                    attempt_id: attempt_id.clone(),
                    outcome: stage_outcome_value("succeeded", &note, &body),
                    recorded_at: committed.committed_at,
                    extra: empty_extra(),
                }),
            )?;
            note
        };
        let _ = summary_text;
    }

    // 取最新 projection 推进（含幂等成功路径）
    let committed_at = now_ms();

    // 推进下一段或 settle
    let run = require_run(writer, &session_id, &run_id)?;
    let idx = stage_index(&run, &stage.id).unwrap_or(0);
    if idx + 1 >= run.stages.len() {
        // 调度者视角：综括本轮所有节点，禁止只复读末段审查原文
        let summary = compose_orchestration_summary(&run);
        append_fact(
            writer,
            &session_id,
            CanonicalFact::SquadRunSettled(SquadRunSettledFact {
                fact_id: format!("agent:{run_id}:settled"),
                run_id: run_id.clone(),
                status: "succeeded".to_string(),
                summary: Some(summary),
                settled_at: committed_at,
                extra: json!({
                    "finalAttemptId": attempt_id,
                    "orchestration": "multi-cli-collab-v1",
                }),
            }),
        )?;
        return Ok(json!({
            "projection": require_run(writer, &session_id, &run_id)?,
            "stageAttempt": Value::Null,
        }));
    }

    let next = run.stages[idx + 1].clone();
    // 下一段若仍是 pending 才启动；已 running 则返回其 attempt
    if next.status == AgentStageStatus::Running {
        if let Some(attempt_id) = next.attempt_id.clone() {
            let prepared = AgentPreparedAttemptV1 {
                run_id: run.run_id.clone(),
                stage_id: next.id.clone(),
                attempt_id,
                logical_turn_id: Uuid::new_v4().to_string(),
                binding_key: next.binding_key.clone().unwrap_or_default(),
                target: next.target.clone(),
                access_mode: access_mode_for(&next),
            };
            return Ok(json!({
                "projection": run,
                "stageAttempt": prepared,
            }));
        }
    }
    let prepared = match start_stage_attempt(writer, &session_id, &run, &next) {
        Ok(prepared) => prepared,
        Err(error) => {
            // 非首段启动失败：实现已成功则降级 settle（§11 / contracts.md §3）
            if should_degrade_settle_on_next_start_failure(idx) {
                let mut settled_run = run.clone();
                // 标记后续未跑段为 skipped，便于汇总表
                for stage in settled_run.stages.iter_mut().skip(idx + 1) {
                    if matches!(
                        stage.status,
                        AgentStageStatus::Pending | AgentStageStatus::Running
                    ) {
                        stage.status = AgentStageStatus::Skipped;
                    }
                }
                let note = compose_orchestration_summary(&settled_run);
                append_fact(
                    writer,
                    &session_id,
                    CanonicalFact::SquadRunSettled(SquadRunSettledFact {
                        fact_id: format!("agent:{run_id}:settled"),
                        run_id: run_id.clone(),
                        status: "succeeded".to_string(),
                        summary: Some(note),
                        settled_at: now_ms(),
                        extra: json!({ "nextStageSkipped": error }),
                    }),
                )?;
                return Ok(json!({
                    "projection": require_run(writer, &session_id, &run_id)?,
                    "stageAttempt": Value::Null,
                }));
            }
            let latest = require_run(writer, &session_id, &run_id)?;
            append_failed_and_settle(writer, &latest, &error, now_ms())?;
            return Ok(json!({
                "projection": require_run(writer, &session_id, &run_id)?,
                "stageAttempt": Value::Null,
            }));
        }
    };
    Ok(json!({
        "projection": require_run(writer, &session_id, &run_id)?,
        "stageAttempt": prepared,
    }))
}

/// 首次门闩用 planProposed(revision=1)；再次门闩/打回后用 planRevised(revision>=2)。
/// 校验器对 planProposed 硬要求 revision==1，否则整 run 会 validation failed。
fn append_plan_gate_fact(
    writer: &crate::shared_event_log::SharedEventWriter,
    session_id: &str,
    run_id: &str,
    stage_id: &str,
    attempt_id: &str,
    plan: &AgentPlanDraftV1,
    plan_revision: u32,
    proposed_at: i64,
) -> Result<u32, String> {
    let revision = if plan_revision == 0 {
        1
    } else {
        plan_revision + 1
    };
    let plan_value = serde_json::to_value(plan).map_err(|error| error.to_string())?;
    let extra = json!({
        "planAttemptId": attempt_id,
        "stageId": stage_id,
    });
    if revision == 1 {
        append_fact(
            writer,
            session_id,
            CanonicalFact::SquadPlanProposed(SquadPlanProposedFact {
                fact_id: format!("agent:{run_id}:gate:{stage_id}:{revision}"),
                run_id: run_id.to_string(),
                revision,
                plan: plan_value,
                proposed_at,
                extra,
            }),
        )?;
    } else {
        append_fact(
            writer,
            session_id,
            CanonicalFact::SquadPlanRevised(SquadPlanRevisedFact {
                fact_id: format!("agent:{run_id}:gate:{stage_id}:{revision}"),
                run_id: run_id.to_string(),
                revision,
                plan: plan_value,
                revised_at: proposed_at,
                extra,
            }),
        )?;
    }
    Ok(revision)
}

fn soft_plan_from_raw(raw: &str, stage_title: &str) -> AgentPlanDraftV1 {
    let text = raw.trim();
    let summary = if text.is_empty() {
        format!("{stage_title} 已完成，待确认")
    } else {
        short_text(text, 120)
    };
    let markdown = if text.is_empty() {
        summary.clone()
    } else {
        short_text(text, 4000)
    };
    AgentPlanDraftV1 {
        schema_version: AGENT_SCHEMA_VERSION,
        summary,
        markdown,
        steps: vec![],
    }
}

/// 阶段结算正文：各节点保留全文供右栏渲染（硬上限、无 …）
fn stage_outcome_body(raw: &str, stage_title: &str, _is_last_or_review: bool) -> String {
    let text = raw.trim();
    if text.is_empty() {
        return format!("{stage_title} 完成。");
    }
    cap_text(text, STAGE_OUTCOME_BODY_CHARS)
}

/// 非首段已成功结算后，下一段启动失败时可降级 settle 为 succeeded（§11）。
/// `completed_stage_index` 为刚完成段在 `run.stages` 中的下标。
pub(super) fn should_degrade_settle_on_next_start_failure(completed_stage_index: usize) -> bool {
    completed_stage_index > 0
}

/// 主幕布调度汇总：综括本轮所有节点，而非复读末段全文
pub(super) fn compose_orchestration_summary(run: &AgentProjectionV1) -> String {
    let task = run.request_text.trim();
    let mut md = String::from("## 本轮协作总结\n\n");
    if !task.is_empty() {
        md.push_str(&format!("**任务**：{}\n\n", task));
    }
    md.push_str("| 环节 | 状态 | 要点 |\n| --- | --- | --- |\n");
    for stage in &run.stages {
        let mark = match stage.status {
            AgentStageStatus::Succeeded => "✓",
            AgentStageStatus::Failed => "✗",
            AgentStageStatus::Skipped => "—",
            AgentStageStatus::Running => "●",
            AgentStageStatus::Pending => "○",
        };
        let detail = if stage.id == AgentStageId::Plan.as_str() {
            run.plan
                .as_ref()
                .map(|p| p.summary.trim())
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .or_else(|| stage.short_outcome.clone())
                .unwrap_or_else(|| "—".into())
        } else {
            stage
                .short_outcome
                .clone()
                .filter(|s| !s.trim().is_empty())
                .or_else(|| {
                    stage
                        .full_outcome
                        .as_ref()
                        .map(|s| short_text(s, STAGE_SHORT_OUTCOME_CHARS))
                })
                .unwrap_or_else(|| "—".into())
        };
        let one_line = detail.replace('\n', " ").trim().to_string();
        md.push_str(&format!(
            "| {} | {} | {} |\n",
            stage.title,
            mark,
            if one_line.is_empty() {
                "—".into()
            } else {
                one_line
            }
        ));
    }
    md.push('\n');
    // 各节点分段摘要（调度视角，控制长度）
    for stage in &run.stages {
        if !matches!(
            stage.status,
            AgentStageStatus::Succeeded | AgentStageStatus::Failed
        ) {
            continue;
        }
        let body = if stage.id == AgentStageId::Plan.as_str() {
            run.plan
                .as_ref()
                .map(|p| {
                    if !p.summary.trim().is_empty() {
                        p.summary.clone()
                    } else {
                        short_text(&p.markdown, 400)
                    }
                })
                .or_else(|| stage.short_outcome.clone())
                .unwrap_or_default()
        } else {
            stage
                .short_outcome
                .clone()
                .or_else(|| stage.full_outcome.as_ref().map(|s| short_text(s, 400)))
                .unwrap_or_default()
        };
        if body.trim().is_empty() {
            continue;
        }
        md.push_str(&format!("### {}\n{}\n\n", stage.title, body.trim()));
    }
    cap_text(&md, FINAL_SUMMARY_CHARS)
}

/// 单节点重试：关闭当前卡死/失败 attempt，同 stage 再开一轮 worker turn。
/// - 仅允许非终态 run 上 Running/Failed 的节点
/// - 已成功节点不重跑（避免破坏后续依赖）
/// - 不 settle 整 run；返回新的 stageAttempt 供前端 driveAutoChain
#[tauri::command]
pub(crate) async fn shared_agent_retry_stage(
    workspace_id: String,
    thread_id: String,
    run_id: String,
    stage_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    require_agent_enabled()?;
    let session_id = parse_session(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &session_id)?;
    let workspace_root = resolve_workspace_root(&state, &workspace_id).await?;
    let _transition = lock_agent_transition()?;
    let writer = require_writer_state(state.inner())?;
    let run = require_run(writer, &session_id, &run_id)?;
    if workspace_root != run.workspace_root {
        return Err("agent-retry-stage: workspace root changed".to_string());
    }
    if run.status.is_terminal() {
        return Err("agent-retry-stage-terminal: run already settled; use full re-run".to_string());
    }
    let stage_id = stage_id.trim();
    if stage_id.is_empty() {
        return Err("agent-retry-stage: stage_id required".to_string());
    }
    let stage = run
        .stages
        .iter()
        .find(|s| s.id == stage_id)
        .cloned()
        .ok_or_else(|| format!("agent-retry-stage: unknown stage {stage_id}"))?;

    match stage.status {
        AgentStageStatus::Succeeded | AgentStageStatus::Skipped => {
            return Err(format!(
                "agent-retry-stage-not-allowed: stage {stage_id} is {:?}",
                stage.status
            ));
        }
        AgentStageStatus::Pending | AgentStageStatus::Running | AgentStageStatus::Failed => {}
    }

    // 关闭旧 attempt：记 failed 结果，但不 settle 整 run
    if let Some(old_attempt) = stage.attempt_id.clone() {
        let now = now_ms();
        let _ = append_fact(
            writer,
            &session_id,
            CanonicalFact::SquadNodeOutcomeRecorded(SquadNodeOutcomeRecordedFact {
                fact_id: format!("agent:{run_id}:{stage_id}:{old_attempt}:retry-close:{now}"),
                run_id: run_id.clone(),
                node_id: stage_id.to_string(),
                attempt_id: old_attempt.clone(),
                outcome: stage_outcome_value(
                    "failed",
                    "节点重试：关闭上一轮卡死/失败 attempt",
                    "节点重试：关闭上一轮卡死/失败 attempt",
                ),
                recorded_at: now,
                extra: json!({ "retryClose": true }),
            }),
        );
    }

    // 投影会把该 stage 标成 Failed；再 start 会由 TurnRequested 打成 Running
    let run = require_run(writer, &session_id, &run_id)?;
    let stage = run
        .stages
        .iter()
        .find(|s| s.id == stage_id)
        .cloned()
        .ok_or_else(|| format!("agent-retry-stage: stage missing after close {stage_id}"))?;

    let prepared = start_stage_attempt(writer, &session_id, &run, &stage)?;
    Ok(json!({
        "projection": require_run(writer, &session_id, &run_id)?,
        "stageAttempt": prepared,
    }))
}

#[tauri::command]
pub(crate) async fn shared_agent_cancel(
    workspace_id: String,
    thread_id: String,
    run_id: String,
    reason: String,
    state: State<'_, AppState>,
) -> Result<AgentCancelResultV1, String> {
    let session_id = parse_session(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &session_id)?;
    let _transition = lock_agent_transition()?;
    let writer = require_writer_state(state.inner())?;
    let run = require_run(writer, &session_id, &run_id)?;
    if run.status.is_terminal() {
        return Ok(AgentCancelResultV1 {
            projection: run,
            attempt_ids: vec![],
        });
    }
    let attempt_ids = run.active_attempt_ids.clone();
    append_fact(
        writer,
        &session_id,
        CanonicalFact::SquadCancelRequested(SquadCancelRequestedFact {
            fact_id: format!("agent:{run_id}:cancel"),
            run_id: run_id.clone(),
            reason: reason.trim().to_string(),
            requested_at: now_ms(),
            extra: empty_extra(),
        }),
    )?;
    Ok(AgentCancelResultV1 {
        projection: require_run(writer, &session_id, &run_id)?,
        attempt_ids,
    })
}

#[tauri::command]
pub(crate) async fn shared_agent_finalize_cancel(
    workspace_id: String,
    thread_id: String,
    run_id: String,
    attempt_results: Vec<Value>,
    state: State<'_, AppState>,
) -> Result<AgentProjectionV1, String> {
    let session_id = parse_session(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &session_id)?;
    let _transition = lock_agent_transition()?;
    let writer = require_writer_state(state.inner())?;
    let run = require_run(writer, &session_id, &run_id)?;
    if run.status.is_terminal() {
        return Ok(run);
    }
    append_fact(
        writer,
        &session_id,
        CanonicalFact::SquadRunSettled(SquadRunSettledFact {
            fact_id: format!("agent:{run_id}:settled"),
            run_id: run_id.clone(),
            status: "cancelled".to_string(),
            summary: Some("协作已取消。".into()),
            settled_at: now_ms(),
            extra: json!({ "attemptResults": attempt_results }),
        }),
    )?;
    require_run(writer, &session_id, &run_id)
}

#[cfg(test)]
mod degrade_settle_tests {
    use super::{compose_orchestration_summary, should_degrade_settle_on_next_start_failure};
    use crate::agent_orchestration::types::{
        AgentPlanDraftV1, AgentProjectionV1, AgentRunStatus, AgentStageProjectionV1,
        AgentStageStatus, AGENT_SCHEMA_VERSION,
    };
    use crate::shared_event_log::canonical::types::CanonicalProviderProfileSource;
    use crate::shared_session_v2::{EngineType, ExecutionTargetInput};

    fn target() -> ExecutionTargetInput {
        ExecutionTargetInput {
            engine: EngineType::Codex,
            provider_profile_id: None,
            model_catalog_entry_id: Some("m1".into()),
            model: Some("m1".into()),
            reasoning_effort: Some("medium".into()),
            provider_profile_name_snapshot: Some("local".into()),
            provider_profile_source: Some(CanonicalProviderProfileSource::Local),
            runtime_capability_fingerprint: None,
        }
    }

    fn stage(
        id: &str,
        title: &str,
        status: AgentStageStatus,
        short: Option<&str>,
    ) -> AgentStageProjectionV1 {
        AgentStageProjectionV1 {
            id: id.into(),
            title: title.into(),
            role: id.into(),
            role_prompt: None,
            target: target(),
            status,
            access_mode: "current".into(),
            requires_approval: false,
            upstream_feed_mode: None,
            attempt_id: None,
            binding_key: None,
            started_at: None,
            settled_at: None,
            short_outcome: short.map(str::to_string),
            full_outcome: None,
            error: None,
            persona_agent_id: None,
            persona_agent_name: None,
            persona_agent_icon: None,
            persona_prompt: None,
        }
    }

    #[test]
    fn should_degrade_only_after_first_stage() {
        assert!(!should_degrade_settle_on_next_start_failure(0));
        assert!(should_degrade_settle_on_next_start_failure(1));
        assert!(should_degrade_settle_on_next_start_failure(2));
    }

    /// §11：implement succeeded + review 未跑 → finalSummary 含 implement 短说明，不含假 review 正文
    #[test]
    fn compose_summary_prefers_implement_when_review_skipped() {
        let run = AgentProjectionV1 {
            schema_version: AGENT_SCHEMA_VERSION,
            run_id: "run-1".into(),
            workspace_id: "ws".into(),
            workspace_root: "/tmp".into(),
            session_id: "sess".into(),
            request_text: "收口契约常量".into(),
            user_visible_text: "收口契约常量".into(),
            first_stage_images: vec![],
            target: target(),
            status: AgentRunStatus::Succeeded,
            plan_revision: 1,
            plan: Some(AgentPlanDraftV1 {
                schema_version: AGENT_SCHEMA_VERSION,
                summary: "补测与 spec".into(),
                markdown: "SHOULD_NOT_BE_REVIEW_BODY".into(),
                steps: vec![],
            }),
            stages: vec![
                stage(
                    "plan",
                    "规划",
                    AgentStageStatus::Succeeded,
                    Some("计划已确认"),
                ),
                stage(
                    "implement",
                    "实现",
                    AgentStageStatus::Succeeded,
                    Some("已写入 contracts 与回归测"),
                ),
                stage("review", "审查", AgentStageStatus::Skipped, None),
            ],
            active_attempt_ids: vec![],
            diagnostics: vec![],
            requested_at: 1,
            approved_at: Some(2),
            approval_note: None,
            updated_at: 3,
            final_summary: None,
        };
        let summary = compose_orchestration_summary(&run);
        assert!(
            summary.contains("已写入 contracts 与回归测"),
            "finalSummary 应保留 implement 短说明: {summary}"
        );
        assert!(
            summary.contains("实现") && summary.contains('✓'),
            "汇总表应标记实现成功: {summary}"
        );
        assert!(
            summary.contains("审查") && summary.contains('—'),
            "review skipped 应在表中为 —: {summary}"
        );
        assert!(
            !summary.contains("SHOULD_NOT_BE_REVIEW_BODY"),
            "不得用 plan.markdown 冒充 review/汇总正文: {summary}"
        );
    }
}
