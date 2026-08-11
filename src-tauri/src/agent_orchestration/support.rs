use std::sync::{Mutex, OnceLock};

use serde_json::{json, Value};
use tauri::State;

use crate::shared_event_log::canonical::types::{
    CanonicalBlock, CanonicalFact, OutcomeStatus, SquadBranchBlockedFact, SquadRunSettledFact,
    TurnCommittedFact,
};
use crate::shared_event_log::{SharedEventWriter, StoredEvent};
use crate::shared_session_v2::EngineType;
use crate::shared_session_v2::{
    begin_squad_worker_turn_core, require_writer, BeginTurnOutcome, BeginTurnStatus,
    ExecutionTargetInput,
};
use crate::shared_sessions::{now_millis, parse_shared_session_id};
use crate::state::AppState;

use super::projection::{active_agent_run, project_agent_runs};
use super::types::{
    empty_extra, AgentPlanDraftV1, AgentPreparedAttemptV1, AgentProjectionV1, AgentStageId,
    AGENT_SCHEMA_VERSION,
};

static TRANSITION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

/// Kill switch（opt-out）：默认开启，仅显式关闭时拒绝。
/// 关闭：`DOGE_AGENT_ORCHESTRATION_V1=0|false|off|no`（兼容旧 CCGUI 变量）。
/// Shared Session 内启用协作后走真实 target 校验，不再依赖「显式开启」env。
pub fn require_agent_enabled() -> Result<(), String> {
    let raw = std::env::var("DOGE_AGENT_ORCHESTRATION_V1")
        .or_else(|_| std::env::var("DOGE_SQUAD_ORCHESTRATION_V1"))
        .or_else(|_| std::env::var("CCGUI_AGENT_ORCHESTRATION_V1"))
        .or_else(|_| std::env::var("CCGUI_SQUAD_ORCHESTRATION_V1"))
        .ok();
    let disabled = raw.as_deref().is_some_and(|value| {
        let normalized = value.trim().to_ascii_lowercase();
        matches!(normalized.as_str(), "0" | "false" | "off" | "no")
    });
    if disabled {
        return Err("agent-disabled: Multi-Agent is disabled".to_string());
    }
    Ok(())
}

pub(super) fn lock_agent_transition() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    TRANSITION_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "agent-transition-lock-poisoned".to_string())
}

pub(super) async fn resolve_workspace_root(
    state: &State<'_, AppState>,
    workspace_id: &str,
) -> Result<String, String> {
    let workspaces = state.workspaces.lock().await;
    let workspace = workspaces
        .get(workspace_id)
        .ok_or_else(|| format!("agent-workspace-missing: {workspace_id}"))?;
    let root = workspace.path.trim();
    if root.is_empty() {
        return Err("agent-workspace-missing: empty path".to_string());
    }
    Ok(std::fs::canonicalize(root)
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|_| root.to_string()))
}

pub(super) fn load_events(
    writer: &SharedEventWriter,
    session_id: &str,
) -> Result<Vec<StoredEvent>, String> {
    writer
        .events_for_session(session_id)
        .map_err(|error| error.to_string())
}

pub(super) fn load_latest(
    writer: &SharedEventWriter,
    session_id: &str,
) -> Result<Option<AgentProjectionV1>, String> {
    let events = load_events(writer, session_id)?;
    Ok(project_agent_runs(session_id, &events)?
        .into_iter()
        .next_back())
}

pub(super) fn load_all_runs(
    writer: &SharedEventWriter,
    session_id: &str,
) -> Result<Vec<AgentProjectionV1>, String> {
    let events = load_events(writer, session_id)?;
    project_agent_runs(session_id, &events)
}

pub(super) fn require_run(
    writer: &SharedEventWriter,
    session_id: &str,
    run_id: &str,
) -> Result<AgentProjectionV1, String> {
    let events = load_events(writer, session_id)?;
    project_agent_runs(session_id, &events)?
        .into_iter()
        .find(|run| run.run_id == run_id)
        .ok_or_else(|| format!("agent-run-not-found: {run_id}"))
}

pub(super) fn append_fact(
    writer: &SharedEventWriter,
    session_id: &str,
    fact: CanonicalFact,
) -> Result<(), String> {
    writer
        .append_canonical_fact(session_id.to_string(), fact)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub(super) fn append_failed_and_settle(
    writer: &SharedEventWriter,
    run: &AgentProjectionV1,
    reason: &str,
    occurred_at: i64,
) -> Result<(), String> {
    append_fact(
        writer,
        &run.session_id,
        CanonicalFact::SquadBranchBlocked(SquadBranchBlockedFact {
            fact_id: format!("agent:{}:failed:{}", run.run_id, occurred_at),
            run_id: run.run_id.clone(),
            node_id: None,
            reason: reason.to_string(),
            details: Some(json!({ "source": "multi-agent-collab" })),
            blocked_at: occurred_at,
            extra: empty_extra(),
        }),
    )?;
    append_fact(
        writer,
        &run.session_id,
        CanonicalFact::SquadRunSettled(SquadRunSettledFact {
            fact_id: format!("agent:{}:settled", run.run_id),
            run_id: run.run_id.clone(),
            status: "failed".to_string(),
            summary: Some(crate::agent_orchestration::types::short_text(reason, 240)),
            settled_at: occurred_at,
            extra: json!({ "diagnostics": [reason] }),
        }),
    )?;
    Ok(())
}

pub(super) fn plan_prompt(request_text: &str) -> String {
    format!(
        r#"你是多 Agent 协作管线中的【规划】环节。只产出计划，不执行。

硬性禁止：写盘工具、改文件、开子代理、AskUserQuestion、commit/push/deploy。
若用户消息含图片或引用上下文（记忆/便签/skill）：先消化其事实，再写计划；关键信息必须写进 SUMMARY 与 Markdown（下游节点看不到原图/原附件）。
信息不足时写「假设 / 待确认」。

用户任务：
{request_text}

输出格式：
1. 第一行：SUMMARY: <一句话>
2. Markdown：目标、步骤、风险、验收（含从附件/引用归纳的要点）
3. 可选 STEPS: 列表

不要 JSON，不要全文代码围栏。"#
    )
}

pub(super) fn implement_prompt(request_text: &str, plan: &AgentPlanDraftV1) -> String {
    format!(
        r#"你是多 Agent 协作管线中的【实现】环节。按已确认计划完成工作。

用户任务：
{request_text}

已确认计划：
{summary}

{markdown}

要求：
- 在工作区内完成必要实现
- 禁止 commit / push / deploy
- 结束时用简短 Markdown 说明改了什么、如何验证（控制在 20 行内）"#,
        summary = plan.summary,
        markdown = plan.markdown,
    )
}

pub(super) fn review_prompt(
    request_text: &str,
    plan: &AgentPlanDraftV1,
    implement_note: &str,
) -> String {
    format!(
        r#"你是多 Agent 协作管线中的【审查/汇总】环节。

用户任务：
{request_text}

计划摘要：
{summary}

实现说明：
{implement_note}

要求（硬约束）：
1. 只输出「给用户看的短汇总」，全文不超过 12 行
2. 结构：完成了什么 / 关键改动 / 如何验证 / 剩余风险（如有）
3. 不要复述长分析，不要贴大段代码，不要再开工具扫全仓
4. 禁止调用会改文件的工具"#,
        summary = plan.summary,
        implement_note = implement_note,
    )
}

/// 将智能体正文 + 本步 rolePrompt 叠到环节基座 prompt 上（均可选）。
/// 顺序：persona → 本步指令 → 基座。幕布不展示正文，仅 CLI 消费。
pub(super) fn with_persona_and_role_prompt(
    persona_prompt: Option<&str>,
    role_prompt: Option<&str>,
    base: String,
) -> String {
    let persona = persona_prompt
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let role = role_prompt.map(str::trim).filter(|value| !value.is_empty());
    let mut prefix = String::new();
    if let Some(persona) = persona {
        prefix.push_str("【智能体角色指令】\n");
        prefix.push_str(persona);
        prefix.push_str("\n\n");
    }
    if let Some(role) = role {
        prefix.push_str("【本环节自定义指令】\n");
        prefix.push_str(role);
        prefix.push_str("\n\n");
    }
    if prefix.is_empty() {
        base
    } else {
        format!("{prefix}---\n\n{base}")
    }
}

/// 按环节位置拼 worker prompt（支持自定义 N 段 + persona + rolePrompt）。
pub(super) fn build_stage_prompt(
    stage_id: &str,
    stage_index: usize,
    stage_count: usize,
    requires_approval: bool,
    role_prompt: Option<&str>,
    persona_prompt: Option<&str>,
    request_text: &str,
    plan: Option<&AgentPlanDraftV1>,
    upstream_notes: &str,
) -> String {
    let base = if stage_index == 0
        && (requires_approval || AgentStageId::parse(stage_id) == Some(AgentStageId::Plan))
    {
        plan_prompt(request_text)
    } else if stage_index + 1 >= stage_count
        || AgentStageId::parse(stage_id) == Some(AgentStageId::Review)
    {
        let plan_ref = plan.cloned().unwrap_or(AgentPlanDraftV1 {
            schema_version: AGENT_SCHEMA_VERSION,
            summary: "（无规划摘要）".into(),
            markdown: request_text.to_string(),
            steps: vec![],
        });
        review_prompt(request_text, &plan_ref, upstream_notes)
    } else if let Some(plan) = plan {
        let mut implement = implement_prompt(request_text, plan);
        // full/summary 上游 notes：implement 基座原只含 plan，非空时追加前序产出
        if !upstream_notes.trim().is_empty() {
            implement.push_str("\n\n上游环节产出：\n");
            implement.push_str(upstream_notes.trim());
            implement.push('\n');
        }
        implement
    } else {
        format!(
            r#"你是多 Agent 协作管线中的【{title}】环节。

用户任务：
{request_text}

上游环节产出：
{upstream}

要求：
- 完成该环节职责
- 若本段为管线首段且含图片/引用上下文：先消化事实并写入结果，供后续节点使用
- 禁止 commit / push / deploy
- 结束时用简短 Markdown 说明结果（控制在 20 行内）"#,
            title = stage_id,
            upstream = if upstream_notes.trim().is_empty() {
                "（无）"
            } else {
                upstream_notes
            },
        )
    };
    with_persona_and_role_prompt(persona_prompt, role_prompt, base)
}

pub(super) fn parse_plan_from_assistant(raw: &str) -> Result<AgentPlanDraftV1, String> {
    let text = raw.trim();
    if text.is_empty() {
        return Err("agent-plan-empty: planner returned empty text".to_string());
    }
    let unfenced = text
        .strip_prefix("```markdown")
        .or_else(|| text.strip_prefix("```md"))
        .or_else(|| text.strip_prefix("```"))
        .and_then(|value| value.strip_suffix("```"))
        .map(str::trim)
        .unwrap_or(text);

    let mut summary = String::new();
    let mut steps = Vec::new();
    let mut body_lines = Vec::new();
    let mut in_steps = false;
    for line in unfenced.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed
            .strip_prefix("SUMMARY:")
            .or_else(|| trimmed.strip_prefix("Summary:"))
            .or_else(|| trimmed.strip_prefix("summary:"))
        {
            summary = rest.trim().to_string();
            continue;
        }
        if trimmed.eq_ignore_ascii_case("STEPS:") || trimmed.eq_ignore_ascii_case("步骤:") {
            in_steps = true;
            continue;
        }
        if in_steps {
            let step = trimmed
                .strip_prefix('-')
                .or_else(|| trimmed.strip_prefix('*'))
                .map(str::trim)
                .filter(|value| !value.is_empty());
            if let Some(step) = step {
                steps.push(step.to_string());
                continue;
            }
            if trimmed.is_empty() {
                continue;
            }
            in_steps = false;
        }
        body_lines.push(line);
    }
    let markdown = body_lines.join("\n").trim().to_string();
    if summary.is_empty() {
        summary = markdown
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .unwrap_or("执行计划")
            .trim_start_matches('#')
            .trim()
            .chars()
            .take(120)
            .collect();
    }
    if summary.is_empty() {
        return Err("agent-plan-invalid: missing summary".to_string());
    }
    let markdown = if markdown.is_empty() {
        summary.clone()
    } else {
        markdown
    };
    Ok(AgentPlanDraftV1 {
        schema_version: AGENT_SCHEMA_VERSION,
        summary,
        markdown,
        steps,
    })
}

pub(super) fn committed_fact(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
) -> Result<TurnCommittedFact, String> {
    load_events(writer, session_id)?
        .into_iter()
        .find(|event| {
            event.fact_type == "conversation.turnCommitted"
                && event.attempt_id.as_deref() == Some(attempt_id)
        })
        .ok_or_else(|| format!("agent-attempt-not-terminal: {attempt_id}"))
        .and_then(|event| {
            serde_json::from_str::<CanonicalFact>(&event.payload_json)
                .map_err(|error| format!("decode committed agent attempt: {error}"))
        })
        .and_then(|fact| match fact {
            CanonicalFact::TurnCommitted(fact) => Ok(fact),
            _ => Err("invalid committed agent attempt fact".to_string()),
        })
}

pub(super) fn assistant_text(fact: &TurnCommittedFact) -> String {
    fact.assistant
        .blocks
        .iter()
        .filter_map(|block| match block {
            CanonicalBlock::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(super) fn begin_stage_turn(
    writer: &SharedEventWriter,
    session_id: &str,
    target: &ExecutionTargetInput,
    run_id: &str,
    stage_id: &str,
    prompt: String,
    access_mode: &str,
    attempt_id: String,
    logical_turn_id: String,
    // 仅首段传图；后续段 None
    images: Option<Vec<String>>,
) -> Result<BeginTurnOutcome, String> {
    let permission_class = if access_mode == "current" {
        "current-workspace"
    } else {
        "read-only"
    };
    let context_identity = json!({
        "schemaVersion": AGENT_SCHEMA_VERSION,
        "domain": "multi-agent-collab",
        "runId": run_id,
        "stageId": stage_id,
        "accessMode": access_mode,
    });
    begin_squad_worker_turn_core(
        writer,
        session_id,
        target,
        prompt,
        images,
        run_id,
        stage_id,
        stage_id,
        permission_class,
        stage_id != AgentStageId::Plan.as_str(),
        context_identity,
        attempt_id,
        logical_turn_id,
    )
}

pub(super) fn prepared_from_begin(
    run_id: String,
    stage_id: String,
    attempt_id: String,
    logical_turn_id: String,
    begin: &BeginTurnOutcome,
    target: ExecutionTargetInput,
    access_mode: &str,
) -> Result<AgentPreparedAttemptV1, String> {
    if begin.status != BeginTurnStatus::Creating {
        return Err(format!(
            "agent-stage-unavailable: {}",
            begin.reason.as_deref().unwrap_or("failed to prepare stage")
        ));
    }
    Ok(AgentPreparedAttemptV1 {
        run_id,
        stage_id,
        attempt_id,
        logical_turn_id,
        binding_key: begin.binding_key.clone(),
        target,
        access_mode: access_mode.to_string(),
    })
}

pub(super) fn validate_agent_target(target: &ExecutionTargetInput) -> Result<(), String> {
    match target.engine {
        EngineType::Codex
        | EngineType::Claude
        | EngineType::Kimi
        | EngineType::Grok
        | EngineType::OpenCode => Ok(()),
        other => Err(format!(
            "agent-target-unavailable:{other:?}: unsupported Shared engine"
        )),
    }
}

pub(super) fn stage_access_mode(stage_id: &str, target: &ExecutionTargetInput) -> &'static str {
    match AgentStageId::parse(stage_id) {
        Some(AgentStageId::Implement) => "current",
        Some(AgentStageId::Plan) | Some(AgentStageId::Review) => match target.engine {
            EngineType::Codex | EngineType::Claude => "read-only",
            _ => "current",
        },
        None => "current",
    }
}

pub(super) fn ensure_no_active_run(
    writer: &SharedEventWriter,
    session_id: &str,
) -> Result<(), String> {
    let events = load_events(writer, session_id)?;
    if let Some(active) = active_agent_run(session_id, &events)? {
        return Err(format!(
            "agent-run-conflict: session already has active run {}",
            active.run_id
        ));
    }
    Ok(())
}

pub(super) fn parse_session(thread_id: &str) -> Result<String, String> {
    parse_shared_session_id(thread_id)
}

pub(super) fn now_ms() -> i64 {
    now_millis() as i64
}

pub(super) fn require_writer_state(state: &AppState) -> Result<&SharedEventWriter, String> {
    require_writer(state)
}

pub(super) fn outcome_completed(fact: &TurnCommittedFact) -> bool {
    fact.outcome.status == OutcomeStatus::Completed
}

#[cfg(test)]
mod kill_switch_tests {
    use super::require_agent_enabled;

    /// 默认开启：无 env 时不应拒绝（与 Shared 协作默认可用对齐）。
    #[test]
    fn require_agent_enabled_defaults_open() {
        // 测试环境通常不设 CCGUI_AGENT_ORCHESTRATION_V1；若 CI 显式关闭则跳过。
        let raw = std::env::var("CCGUI_AGENT_ORCHESTRATION_V1")
            .or_else(|_| std::env::var("CCGUI_SQUAD_ORCHESTRATION_V1"))
            .ok();
        if raw.as_deref().is_some_and(|v| {
            matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "0" | "false" | "off" | "no"
            )
        }) {
            return;
        }
        assert!(require_agent_enabled().is_ok());
    }
}
