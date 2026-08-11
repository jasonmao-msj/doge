//! Multi-Agent 协作：多 CLI 分环节串行编排。
//!
//! 产品语义（非单模型流水线）：
//! - stages 有序；每 stage 可绑不同 CLI + Provider + Model
//! - 主幕布展示编排组合与状态
//! - 分屏直播当前 stage
//! - 完成态只给短汇总

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::shared_session_v2::{EngineType, ExecutionTargetInput};

pub const AGENT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentRunStatus {
    /// 规划 stage 运行中
    Planning,
    /// 规划完成，等人确认后才进入实现
    AwaitingApproval,
    /// 实现 stage 运行中
    Implementing,
    /// 审查 stage 运行中
    Reviewing,
    Succeeded,
    Failed,
    Cancelled,
}

impl AgentRunStatus {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed | Self::Cancelled)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Planning => "planning",
            Self::AwaitingApproval => "awaiting-approval",
            Self::Implementing => "implementing",
            Self::Reviewing => "reviewing",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "planning" => Some(Self::Planning),
            "awaiting-approval" => Some(Self::AwaitingApproval),
            "implementing" | "executing" => Some(Self::Implementing),
            "reviewing" => Some(Self::Reviewing),
            "succeeded" => Some(Self::Succeeded),
            "failed" | "blocked" => Some(Self::Failed),
            "cancelled" => Some(Self::Cancelled),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentStageId {
    Plan,
    Implement,
    Review,
}

impl AgentStageId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Plan => "plan",
            Self::Implement => "implement",
            Self::Review => "review",
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            Self::Plan => "规划",
            Self::Implement => "实现",
            Self::Review => "审查",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "plan" | "lead" => Some(Self::Plan),
            "implement" | "execute" | "mutate" | "worker" => Some(Self::Implement),
            "review" | "verify" | "synthesize" => Some(Self::Review),
            _ => None,
        }
    }

    pub fn order(self) -> u8 {
        match self {
            Self::Plan => 0,
            Self::Implement => 1,
            Self::Review => 2,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentStageStatus {
    Pending,
    Running,
    Succeeded,
    Failed,
    Skipped,
}

impl AgentStageStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
            Self::Skipped => "skipped",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "pending" => Some(Self::Pending),
            "running" | "prepared" => Some(Self::Running),
            "succeeded" => Some(Self::Succeeded),
            "failed" | "blocked" => Some(Self::Failed),
            "skipped" | "cancelled" => Some(Self::Skipped),
            _ => None,
        }
    }
}

/// 请求时每段的绑定（前端可配；有序列表即完整 N 段定义）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStageBindingInput {
    pub id: String,
    pub target: ExecutionTargetInput,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// 步骤级提示词 / 约束，拼入 worker prompt
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_mode: Option<String>,
    /// 本段成功后是否进入批准门闩
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requires_approval: Option<bool>,
    /// 本段启动时上游喂料：summary | full（缺省 summary；首段忽略）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream_feed_mode: Option<String>,
    /// 客户端智能体（展示 + 绑定元数据，可选）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persona_agent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persona_agent_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persona_agent_icon: Option<String>,
    /// 智能体正文快照（发送时冻结；仅 CLI 注入，幕布不展示）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persona_prompt: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStageProjectionV1 {
    pub id: String,
    pub title: String,
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_prompt: Option<String>,
    pub target: ExecutionTargetInput,
    pub status: AgentStageStatus,
    /// read-only | current
    pub access_mode: String,
    #[serde(default)]
    pub requires_approval: bool,
    /// summary | full；缺省按 summary 解释
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream_feed_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempt_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binding_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settled_at: Option<i64>,
    /// 主时间线 / 阶段 chip 用一行结果，禁止塞全文
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub short_outcome: Option<String>,
    /// 右栏节点全文（与 SubAgent 幕布同源：完整阶段输出，供 Messages 渲染）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub full_outcome: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persona_agent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persona_agent_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persona_agent_icon: Option<String>,
    /// 智能体正文快照（执行叠层用；UI 只展示 icon/name）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persona_prompt: Option<String>,
}

/// 规划产物：给确认 UI 用，不是最终用户答案。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPlanDraftV1 {
    pub schema_version: u32,
    pub summary: String,
    pub markdown: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub steps: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPreparedAttemptV1 {
    pub run_id: String,
    pub stage_id: String,
    pub attempt_id: String,
    pub logical_turn_id: String,
    pub binding_key: String,
    pub target: ExecutionTargetInput,
    pub access_mode: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProjectionV1 {
    pub schema_version: u32,
    pub run_id: String,
    pub workspace_id: String,
    pub workspace_root: String,
    pub session_id: String,
    pub request_text: String,
    /// 主幕可见原文（无记忆/skill 注入块）；后续段「用户任务」用此字段
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub user_visible_text: String,
    /// 首段 worker 附图路径（Context Fan-in）；后续段不消费
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub first_stage_images: Vec<String>,
    /// 入口默认 target（兼容旧字段）；编排以 stages[].target 为准
    pub target: ExecutionTargetInput,
    pub status: AgentRunStatus,
    pub plan_revision: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<AgentPlanDraftV1>,
    pub stages: Vec<AgentStageProjectionV1>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub active_attempt_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<String>,
    pub requested_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approved_at: Option<i64>,
    /// 批准时用户可选补充；后续段 prompt 注入（空则省略）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub approval_note: Option<String>,
    pub updated_at: i64,
    /// 主幕布调度汇总：综括本轮各节点结果（非末段原文重复）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub final_summary: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCancelResultV1 {
    pub projection: AgentProjectionV1,
    pub attempt_ids: Vec<String>,
}

pub fn empty_extra() -> Value {
    Value::Object(Default::default())
}

pub fn default_stage_specs(default_target: &ExecutionTargetInput) -> Vec<AgentStageProjectionV1> {
    vec![
        AgentStageProjectionV1 {
            id: AgentStageId::Plan.as_str().into(),
            title: AgentStageId::Plan.title().into(),
            role: "planner".into(),
            role_prompt: None,
            target: default_target.clone(),
            status: AgentStageStatus::Pending,
            access_mode: "read-only".into(),
            requires_approval: true,
            upstream_feed_mode: Some("full".into()),
            attempt_id: None,
            binding_key: None,
            started_at: None,
            settled_at: None,
            short_outcome: None,
            full_outcome: None,
            error: None,
            persona_agent_id: None,
            persona_agent_name: None,
            persona_agent_icon: None,
            persona_prompt: None,
        },
        AgentStageProjectionV1 {
            id: AgentStageId::Implement.as_str().into(),
            title: AgentStageId::Implement.title().into(),
            role: "implementer".into(),
            role_prompt: None,
            target: default_target.clone(),
            status: AgentStageStatus::Pending,
            access_mode: "current".into(),
            requires_approval: false,
            upstream_feed_mode: Some("summary".into()),
            attempt_id: None,
            binding_key: None,
            started_at: None,
            settled_at: None,
            short_outcome: None,
            full_outcome: None,
            error: None,
            persona_agent_id: None,
            persona_agent_name: None,
            persona_agent_icon: None,
            persona_prompt: None,
        },
        AgentStageProjectionV1 {
            id: AgentStageId::Review.as_str().into(),
            title: AgentStageId::Review.title().into(),
            role: "reviewer".into(),
            role_prompt: None,
            target: default_target.clone(),
            status: AgentStageStatus::Pending,
            access_mode: "read-only".into(),
            requires_approval: false,
            upstream_feed_mode: Some("summary".into()),
            attempt_id: None,
            binding_key: None,
            started_at: None,
            settled_at: None,
            short_outcome: None,
            full_outcome: None,
            error: None,
            persona_agent_id: None,
            persona_agent_name: None,
            persona_agent_icon: None,
            persona_prompt: None,
        },
    ]
}

fn default_requires_approval(stage_id: &str, index: usize) -> bool {
    if let Some(parsed) = AgentStageId::parse(stage_id) {
        return matches!(parsed, AgentStageId::Plan);
    }
    index == 0
}

fn default_access_mode_for(
    stage_id: &str,
    target: &ExecutionTargetInput,
    index: usize,
    total: usize,
) -> String {
    if let Some(mode) = match AgentStageId::parse(stage_id) {
        Some(AgentStageId::Implement) => Some("current"),
        Some(AgentStageId::Plan) | Some(AgentStageId::Review) => match target.engine {
            EngineType::Codex | EngineType::Claude => Some("read-only"),
            _ => Some("current"),
        },
        None => None,
    } {
        return mode.into();
    }
    // 自定义段：首段/末段偏只读，中间段允许写
    if index == 0 || index + 1 == total {
        match target.engine {
            EngineType::Codex | EngineType::Claude => "read-only".into(),
            _ => "current".into(),
        }
    } else {
        "current".into()
    }
}

/// 有序 bindings 即完整 N 段；空 bindings 回退默认三段。
pub fn stages_from_bindings(
    default_target: &ExecutionTargetInput,
    bindings: &[AgentStageBindingInput],
) -> Vec<AgentStageProjectionV1> {
    if bindings.is_empty() {
        return default_stage_specs(default_target);
    }
    let total = bindings.len();
    bindings
        .iter()
        .enumerate()
        .map(|(index, binding)| {
            let id = binding.id.trim();
            let id = if id.is_empty() {
                format!("stage-{}", index + 1)
            } else {
                id.to_string()
            };
            let title = binding
                .title
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .or_else(|| AgentStageId::parse(&id).map(|s| s.title().to_string()))
                .unwrap_or_else(|| format!("环节 {}", index + 1));
            let role_prompt = binding
                .role_prompt
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let requires_approval = binding
                .requires_approval
                .unwrap_or_else(|| default_requires_approval(&id, index));
            let access_mode = binding
                .access_mode
                .as_deref()
                .map(str::trim)
                .filter(|value| *value == "read-only" || *value == "current")
                .map(str::to_string)
                .unwrap_or_else(|| default_access_mode_for(&id, &binding.target, index, total));
            let persona_agent_id = binding
                .persona_agent_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let persona_agent_name = binding
                .persona_agent_name
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let persona_agent_icon = binding
                .persona_agent_icon
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let persona_prompt = binding
                .persona_prompt
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            // 首段默认 full（用户全文）；后续默认 summary
            let upstream_feed_mode = if index == 0 {
                match binding.upstream_feed_mode.as_deref().map(str::trim) {
                    Some("summary") => Some("summary".into()),
                    _ => Some("full".into()),
                }
            } else {
                match binding
                    .upstream_feed_mode
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                {
                    Some("full") => Some("full".into()),
                    _ => Some("summary".into()),
                }
            };
            AgentStageProjectionV1 {
                id: id.clone(),
                title,
                role: role_prompt.clone().unwrap_or_else(|| format!("stage:{id}")),
                role_prompt,
                target: binding.target.clone(),
                status: AgentStageStatus::Pending,
                access_mode,
                requires_approval,
                upstream_feed_mode,
                attempt_id: None,
                binding_key: None,
                started_at: None,
                settled_at: None,
                short_outcome: None,
                full_outcome: None,
                error: None,
                persona_agent_id,
                persona_agent_name,
                persona_agent_icon,
                persona_prompt,
            }
        })
        .collect()
}

/// 兼容：仅覆盖同 id target；若 bindings 含 title/role 等扩展字段则按有序列表重建。
pub fn apply_stage_bindings(
    stages: Vec<AgentStageProjectionV1>,
    bindings: &[AgentStageBindingInput],
) -> Vec<AgentStageProjectionV1> {
    if bindings.is_empty() {
        return stages;
    }
    let rich = bindings.iter().any(|binding| {
        binding.title.is_some()
            || binding.role_prompt.is_some()
            || binding.requires_approval.is_some()
            || binding.upstream_feed_mode.is_some()
            || binding.access_mode.is_some()
            || binding.persona_agent_id.is_some()
            || binding.persona_agent_name.is_some()
            || binding.persona_agent_icon.is_some()
            || binding.persona_prompt.is_some()
            || bindings.len() != stages.len()
    });
    if rich || bindings.len() != 3 {
        let default_target = bindings
            .first()
            .map(|binding| binding.target.clone())
            .unwrap_or_else(|| stages[0].target.clone());
        return stages_from_bindings(&default_target, bindings);
    }
    let mut next = stages;
    for binding in bindings {
        let id = binding.id.trim();
        if let Some(stage) = next.iter_mut().find(|s| s.id == id) {
            stage.target = binding.target.clone();
            if let Some(title) = binding.title.as_ref() {
                if !title.trim().is_empty() {
                    stage.title = title.trim().to_string();
                }
            }
            if let Some(role_prompt) = binding.role_prompt.as_ref() {
                let trimmed = role_prompt.trim();
                stage.role_prompt = if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                };
            }
            if let Some(requires) = binding.requires_approval {
                stage.requires_approval = requires;
            }
            if let Some(feed) = binding.upstream_feed_mode.as_ref() {
                let feed = feed.trim();
                stage.upstream_feed_mode = if feed == "full" {
                    Some("full".into())
                } else if feed == "summary" {
                    Some("summary".into())
                } else {
                    stage.upstream_feed_mode.clone()
                };
            }
            if let Some(mode) = binding.access_mode.as_ref() {
                let mode = mode.trim();
                if mode == "read-only" || mode == "current" {
                    stage.access_mode = mode.to_string();
                }
            }
            if let Some(name) = binding.persona_agent_name.as_ref() {
                let trimmed = name.trim();
                stage.persona_agent_name = if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                };
            }
            if let Some(pid) = binding.persona_agent_id.as_ref() {
                let trimmed = pid.trim();
                stage.persona_agent_id = if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                };
            }
            if let Some(icon) = binding.persona_agent_icon.as_ref() {
                let trimmed = icon.trim();
                stage.persona_agent_icon = if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed.to_string())
                };
            }
        }
    }
    next
}

pub fn short_text(raw: &str, max_chars: usize) -> String {
    let trimmed = raw.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(max_chars.saturating_sub(1)).collect();
    out.push('…');
    out
}

// Cross-layer contract SSOT:
// `.trellis/spec/multi-agent/contracts.md` + `openspec/specs/multi-agent-orchestration/spec.md`
/// 阶段行短摘要（chip / shortOutcome）
pub const STAGE_SHORT_OUTCOME_CHARS: usize = 160;
/// 末段/汇总用正文：保留完整阶段输出，仅作极端安全阀
pub const STAGE_OUTCOME_BODY_CHARS: usize = 12_000;
/// finalSummary 安全阀（不加省略号，避免汇总框出现 …）
pub const FINAL_SUMMARY_CHARS: usize = 12_000;

/// 硬截断：超长时裁切但**不加** `…`（汇总展示用，避免误导性省略）
pub fn cap_text(raw: &str, max_chars: usize) -> String {
    let trimmed = raw.trim();
    if max_chars == 0 {
        return String::new();
    }
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    trimmed.chars().take(max_chars).collect()
}
