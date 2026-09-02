use serde::{Deserialize, Deserializer, Serialize};

use crate::backend_budget::PayloadBudgetMetadata;

/// 结构化技能调用契约（composer 选中 skill/common 发送时随消息下发）。
/// 当前仅在 `engine_send_message` 边界接收并记录日志；引擎侧解析与参数
/// 校验属后续协议演进。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SkillInvocation {
    pub(crate) name: String,
    /// SKILL.md / skill 目录路径；协作首段 client 侧注入用，引擎可忽略。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) args: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum WorkspaceSessionAttributionMode {
    Related,
    WorkspaceOnly,
}

impl Default for WorkspaceSessionAttributionMode {
    fn default() -> Self {
        Self::Related
    }
}

impl WorkspaceSessionAttributionMode {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Related => "related",
            Self::WorkspaceOnly => "workspace-only",
        }
    }

    fn from_persisted_value(value: &str) -> Self {
        match value.trim() {
            "workspace-only" => Self::WorkspaceOnly,
            _ => Self::Related,
        }
    }
}

impl<'de> Deserialize<'de> for WorkspaceSessionAttributionMode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        Ok(match value {
            serde_json::Value::String(value) => Self::from_persisted_value(&value),
            _ => Self::default(),
        })
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitFileStatus {
    pub(crate) path: String,
    #[serde(default, rename = "oldPath", skip_serializing_if = "Option::is_none")]
    pub(crate) old_path: Option<String>,
    pub(crate) status: String,
    pub(crate) additions: i64,
    pub(crate) deletions: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitFileDiff {
    pub(crate) path: String,
    pub(crate) diff: String,
    #[serde(default, rename = "isBinary")]
    pub(crate) is_binary: bool,
    #[serde(default, rename = "isImage")]
    pub(crate) is_image: bool,
    #[serde(rename = "oldImageData")]
    pub(crate) old_image_data: Option<String>,
    #[serde(rename = "newImageData")]
    pub(crate) new_image_data: Option<String>,
    #[serde(rename = "oldImageMime")]
    pub(crate) old_image_mime: Option<String>,
    #[serde(rename = "newImageMime")]
    pub(crate) new_image_mime: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitBlameHunk {
    pub(crate) start_line: usize,
    pub(crate) line_count: usize,
    pub(crate) commit_sha: String,
    pub(crate) author: String,
    pub(crate) authored_at: i64,
    pub(crate) summary: String,
    pub(crate) original_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitFileBlameResponse {
    pub(crate) path: String,
    pub(crate) head_sha: String,
    pub(crate) line_count: usize,
    pub(crate) hunks: Vec<GitBlameHunk>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitCommitDiff {
    pub(crate) path: String,
    pub(crate) status: String,
    pub(crate) diff: String,
    #[serde(default, rename = "isBinary")]
    pub(crate) is_binary: bool,
    #[serde(default, rename = "isImage")]
    pub(crate) is_image: bool,
    #[serde(rename = "oldImageData")]
    pub(crate) old_image_data: Option<String>,
    #[serde(rename = "newImageData")]
    pub(crate) new_image_data: Option<String>,
    #[serde(rename = "oldImageMime")]
    pub(crate) old_image_mime: Option<String>,
    #[serde(rename = "newImageMime")]
    pub(crate) new_image_mime: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitLogEntry {
    pub(crate) sha: String,
    pub(crate) summary: String,
    pub(crate) author: String,
    pub(crate) timestamp: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitLogResponse {
    pub(crate) total: usize,
    pub(crate) entries: Vec<GitLogEntry>,
    #[serde(default)]
    pub(crate) ahead: usize,
    #[serde(default)]
    pub(crate) behind: usize,
    #[serde(default, rename = "aheadEntries")]
    pub(crate) ahead_entries: Vec<GitLogEntry>,
    #[serde(default, rename = "behindEntries")]
    pub(crate) behind_entries: Vec<GitLogEntry>,
    #[serde(default)]
    pub(crate) upstream: Option<String>,
    #[serde(
        default,
        rename = "payloadBudget",
        skip_serializing_if = "Option::is_none"
    )]
    pub(crate) payload_budget: Option<PayloadBudgetMetadata>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitHistoryCommit {
    pub(crate) sha: String,
    #[serde(rename = "shortSha")]
    pub(crate) short_sha: String,
    pub(crate) summary: String,
    pub(crate) message: String,
    pub(crate) author: String,
    #[serde(rename = "authorEmail")]
    pub(crate) author_email: String,
    pub(crate) timestamp: i64,
    pub(crate) parents: Vec<String>,
    #[serde(default)]
    pub(crate) refs: Vec<String>,
    #[serde(default, rename = "filePath", skip_serializing_if = "Option::is_none")]
    pub(crate) file_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitHistoryResponse {
    #[serde(rename = "snapshotId")]
    pub(crate) snapshot_id: String,
    pub(crate) total: usize,
    pub(crate) offset: usize,
    pub(crate) limit: usize,
    #[serde(rename = "hasMore")]
    pub(crate) has_more: bool,
    pub(crate) commits: Vec<GitHistoryCommit>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitPushPreviewResponse {
    #[serde(rename = "sourceBranch")]
    pub(crate) source_branch: String,
    #[serde(rename = "targetRemote")]
    pub(crate) target_remote: String,
    #[serde(rename = "targetBranch")]
    pub(crate) target_branch: String,
    #[serde(rename = "targetRef")]
    pub(crate) target_ref: String,
    #[serde(rename = "targetFound")]
    pub(crate) target_found: bool,
    #[serde(rename = "hasMore")]
    pub(crate) has_more: bool,
    pub(crate) commits: Vec<GitHistoryCommit>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitBranchCompareCommitSets {
    #[serde(rename = "targetOnlyCommits")]
    pub(crate) target_only_commits: Vec<GitHistoryCommit>,
    #[serde(rename = "currentOnlyCommits")]
    pub(crate) current_only_commits: Vec<GitHistoryCommit>,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub(crate) struct PullRequestGeneratedContent {
    #[serde(default)]
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) body: String,
    #[serde(default)]
    pub(crate) engine: String,
    #[serde(default)]
    pub(crate) language: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitPrWorkflowDefaults {
    #[serde(rename = "upstreamRepo")]
    pub(crate) upstream_repo: String,
    #[serde(rename = "baseBranch")]
    pub(crate) base_branch: String,
    #[serde(rename = "headOwner")]
    pub(crate) head_owner: String,
    #[serde(rename = "headBranch")]
    pub(crate) head_branch: String,
    pub(crate) title: String,
    pub(crate) body: String,
    #[serde(rename = "commentBody")]
    pub(crate) comment_body: String,
    #[serde(rename = "canCreate")]
    pub(crate) can_create: bool,
    #[serde(rename = "disabledReason")]
    pub(crate) disabled_reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitPrWorkflowStage {
    pub(crate) key: String,
    pub(crate) status: String,
    pub(crate) detail: String,
    pub(crate) command: Option<String>,
    pub(crate) stdout: Option<String>,
    pub(crate) stderr: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitPrExistingPullRequest {
    pub(crate) number: u64,
    pub(crate) title: String,
    pub(crate) url: String,
    pub(crate) state: String,
    #[serde(rename = "headRefName")]
    pub(crate) head_ref_name: String,
    #[serde(rename = "baseRefName")]
    pub(crate) base_ref_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum GitPrRangeGateSeverity {
    Large,
    DiffIncomplete,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub(crate) struct GitPrRangeGate {
    #[serde(rename = "changedFiles")]
    pub(crate) changed_files: usize,
    pub(crate) threshold: usize,
    pub(crate) severity: GitPrRangeGateSeverity,
    #[serde(rename = "requiresConfirmation")]
    pub(crate) requires_confirmation: bool,
    #[serde(rename = "rangeFingerprint")]
    pub(crate) range_fingerprint: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitPrWorkflowResult {
    pub(crate) ok: bool,
    pub(crate) status: String,
    pub(crate) message: String,
    #[serde(rename = "errorCategory")]
    pub(crate) error_category: Option<String>,
    #[serde(rename = "nextActionHint")]
    pub(crate) next_action_hint: Option<String>,
    #[serde(rename = "prUrl")]
    pub(crate) pr_url: Option<String>,
    #[serde(rename = "prNumber")]
    pub(crate) pr_number: Option<u64>,
    #[serde(rename = "existingPr")]
    pub(crate) existing_pr: Option<GitPrExistingPullRequest>,
    #[serde(rename = "retryCommand")]
    pub(crate) retry_command: Option<String>,
    #[serde(rename = "rangeGate")]
    pub(crate) range_gate: Option<GitPrRangeGate>,
    pub(crate) stages: Vec<GitPrWorkflowStage>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitCommitFileChange {
    pub(crate) path: String,
    #[serde(rename = "oldPath")]
    pub(crate) old_path: Option<String>,
    pub(crate) status: String,
    pub(crate) additions: i64,
    pub(crate) deletions: i64,
    #[serde(default, rename = "isBinary")]
    pub(crate) is_binary: bool,
    #[serde(default, rename = "isImage")]
    pub(crate) is_image: bool,
    pub(crate) diff: String,
    #[serde(rename = "lineCount")]
    pub(crate) line_count: usize,
    pub(crate) truncated: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitCommitDetails {
    pub(crate) sha: String,
    pub(crate) summary: String,
    pub(crate) message: String,
    pub(crate) author: String,
    #[serde(rename = "authorEmail")]
    pub(crate) author_email: String,
    pub(crate) committer: String,
    #[serde(rename = "committerEmail")]
    pub(crate) committer_email: String,
    #[serde(rename = "authorTime")]
    pub(crate) author_time: i64,
    #[serde(rename = "commitTime")]
    pub(crate) commit_time: i64,
    pub(crate) parents: Vec<String>,
    pub(crate) files: Vec<GitCommitFileChange>,
    #[serde(rename = "totalAdditions")]
    pub(crate) total_additions: i64,
    #[serde(rename = "totalDeletions")]
    pub(crate) total_deletions: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitBranchListItem {
    pub(crate) name: String,
    #[serde(rename = "isCurrent")]
    pub(crate) is_current: bool,
    #[serde(rename = "isRemote")]
    pub(crate) is_remote: bool,
    pub(crate) remote: Option<String>,
    #[serde(rename = "lastCommit")]
    pub(crate) last_commit: i64,
    #[serde(default, rename = "headSha")]
    pub(crate) head_sha: Option<String>,
    pub(crate) ahead: usize,
    pub(crate) behind: usize,
    #[serde(default)]
    pub(crate) upstream: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitRepositoryFileStatus {
    pub(crate) path: String,
    pub(crate) status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitRepositorySummary {
    pub(crate) repository_root: String,
    pub(crate) display_name: String,
    pub(crate) current_branch: Option<String>,
    pub(crate) head_state: String,
    pub(crate) upstream: Option<String>,
    pub(crate) ahead: usize,
    pub(crate) behind: usize,
    pub(crate) staged_count: usize,
    pub(crate) modified_count: usize,
    pub(crate) untracked_count: usize,
    pub(crate) conflicted_count: usize,
    #[serde(default)]
    pub(crate) file_statuses: Vec<GitRepositoryFileStatus>,
    pub(crate) is_clean: bool,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitBranchUpdateResult {
    pub(crate) branch: String,
    pub(crate) status: String,
    #[serde(default)]
    pub(crate) reason: Option<String>,
    pub(crate) message: String,
    #[serde(default, rename = "worktreePath")]
    pub(crate) worktree_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitHubIssue {
    pub(crate) number: u64,
    pub(crate) title: String,
    pub(crate) url: String,
    #[serde(rename = "updatedAt")]
    pub(crate) updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitHubIssuesResponse {
    pub(crate) total: usize,
    pub(crate) issues: Vec<GitHubIssue>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitHubPullRequestAuthor {
    pub(crate) login: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitHubPullRequest {
    pub(crate) number: u64,
    pub(crate) title: String,
    pub(crate) url: String,
    #[serde(rename = "updatedAt")]
    pub(crate) updated_at: String,
    #[serde(rename = "createdAt")]
    pub(crate) created_at: String,
    pub(crate) body: String,
    #[serde(rename = "headRefName")]
    pub(crate) head_ref_name: String,
    #[serde(rename = "baseRefName")]
    pub(crate) base_ref_name: String,
    #[serde(rename = "isDraft")]
    pub(crate) is_draft: bool,
    #[serde(default)]
    pub(crate) author: Option<GitHubPullRequestAuthor>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitHubPullRequestsResponse {
    pub(crate) total: usize,
    #[serde(rename = "pullRequests")]
    pub(crate) pull_requests: Vec<GitHubPullRequest>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitHubPullRequestDiff {
    pub(crate) path: String,
    pub(crate) status: String,
    pub(crate) diff: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitHubPullRequestComment {
    pub(crate) id: u64,
    #[serde(default)]
    pub(crate) body: String,
    #[serde(rename = "createdAt")]
    pub(crate) created_at: String,
    #[serde(default)]
    pub(crate) url: String,
    #[serde(default)]
    pub(crate) author: Option<GitHubPullRequestAuthor>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageDay {
    pub(crate) day: String,
    pub(crate) input_tokens: i64,
    pub(crate) cached_input_tokens: i64,
    pub(crate) output_tokens: i64,
    pub(crate) total_tokens: i64,
    #[serde(default)]
    pub(crate) agent_time_ms: i64,
    #[serde(default)]
    pub(crate) agent_runs: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageTotals {
    pub(crate) last7_days_tokens: i64,
    pub(crate) last30_days_tokens: i64,
    pub(crate) average_daily_tokens: i64,
    pub(crate) cache_hit_rate_percent: f64,
    pub(crate) peak_day: Option<String>,
    pub(crate) peak_day_tokens: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageModel {
    pub(crate) model: String,
    pub(crate) tokens: i64,
    pub(crate) share_percent: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageSnapshot {
    pub(crate) updated_at: i64,
    pub(crate) days: Vec<LocalUsageDay>,
    pub(crate) totals: LocalUsageTotals,
    #[serde(default)]
    pub(crate) top_models: Vec<LocalUsageModel>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageUsageData {
    pub(crate) input_tokens: i64,
    pub(crate) output_tokens: i64,
    pub(crate) cache_write_tokens: i64,
    pub(crate) cache_read_tokens: i64,
    pub(crate) total_tokens: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageSessionSummary {
    pub(crate) session_id: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) session_id_aliases: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) parent_session_id: Option<String>,
    pub(crate) timestamp: i64,
    #[serde(default)]
    pub(crate) cwd: Option<String>,
    pub(crate) model: String,
    pub(crate) usage: LocalUsageUsageData,
    pub(crate) cost: f64,
    #[serde(default)]
    pub(crate) summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) native_title: Option<String>,
    #[serde(default)]
    pub(crate) source: Option<String>,
    #[serde(default)]
    pub(crate) provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_profile_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_profile_source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_profile_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_availability: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) physical_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) file_size_bytes: Option<u64>,
    #[serde(default)]
    pub(crate) modified_lines: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) background_kind: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct BranchInfo {
    pub(crate) name: String,
    pub(crate) last_commit: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct WorkspaceEntry {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) codex_bin: Option<String>,
    #[serde(default)]
    pub(crate) kind: WorkspaceKind,
    #[serde(default, rename = "parentId")]
    pub(crate) parent_id: Option<String>,
    #[serde(default)]
    pub(crate) worktree: Option<WorktreeInfo>,
    #[serde(default)]
    pub(crate) settings: WorkspaceSettings,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct WorkspaceInfo {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) connected: bool,
    pub(crate) codex_bin: Option<String>,
    #[serde(default)]
    pub(crate) kind: WorkspaceKind,
    #[serde(default, rename = "parentId")]
    pub(crate) parent_id: Option<String>,
    #[serde(default)]
    pub(crate) worktree: Option<WorktreeInfo>,
    #[serde(default)]
    pub(crate) settings: WorkspaceSettings,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub(crate) enum WorkspaceKind {
    Main,
    Worktree,
}

impl Default for WorkspaceKind {
    fn default() -> Self {
        WorkspaceKind::Main
    }
}

impl WorkspaceKind {
    pub(crate) fn is_worktree(&self) -> bool {
        matches!(self, WorkspaceKind::Worktree)
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct WorktreeInfo {
    pub(crate) branch: String,
    #[serde(default, rename = "baseRef")]
    pub(crate) base_ref: Option<String>,
    #[serde(default, rename = "baseCommit")]
    pub(crate) base_commit: Option<String>,
    #[serde(default)]
    pub(crate) tracking: Option<String>,
    #[serde(default, rename = "publishError")]
    pub(crate) publish_error: Option<String>,
    #[serde(default, rename = "publishRetryCommand")]
    pub(crate) publish_retry_command: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct WorkspaceGroup {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default, rename = "sortOrder")]
    pub(crate) sort_order: Option<u32>,
    #[serde(default, rename = "copiesFolder")]
    pub(crate) copies_folder: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub(crate) struct WorkspaceSettings {
    #[serde(default, rename = "sidebarCollapsed")]
    pub(crate) sidebar_collapsed: bool,
    #[serde(default, rename = "visibleThreadRootCount")]
    pub(crate) visible_thread_root_count: Option<u32>,
    #[serde(default, rename = "sortOrder")]
    pub(crate) sort_order: Option<u32>,
    #[serde(default, rename = "groupId")]
    pub(crate) group_id: Option<String>,
    #[serde(default, rename = "projectAlias")]
    pub(crate) project_alias: Option<String>,
    #[serde(default, rename = "gitRoot")]
    pub(crate) git_root: Option<String>,
    #[serde(default, rename = "codexHome")]
    pub(crate) codex_home: Option<String>,
    #[serde(default, rename = "codexArgs")]
    pub(crate) codex_args: Option<String>,
    #[serde(default, rename = "launchScript")]
    pub(crate) launch_script: Option<String>,
    #[serde(default, rename = "launchScripts")]
    pub(crate) launch_scripts: Option<Vec<LaunchScriptEntry>>,
    #[serde(default, rename = "worktreeSetupScript")]
    pub(crate) worktree_setup_script: Option<String>,
    /// Engine type for this workspace: "claude" or "codex". If not set, use app default.
    #[serde(default, rename = "engineType")]
    pub(crate) engine_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct LaunchScriptEntry {
    pub(crate) id: String,
    pub(crate) script: String,
    pub(crate) icon: String,
    #[serde(default)]
    pub(crate) label: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct WorktreeSetupStatus {
    #[serde(rename = "shouldRun")]
    pub(crate) should_run: bool,
    pub(crate) script: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct OpenAppTarget {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) kind: String,
    #[serde(default, rename = "appName")]
    pub(crate) app_name: Option<String>,
    #[serde(default)]
    pub(crate) command: Option<String>,
    #[serde(default)]
    pub(crate) args: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CodexUnifiedExecPolicy {
    #[default]
    Inherit,
    ForceEnabled,
    ForceDisabled,
}

impl CodexUnifiedExecPolicy {
    pub(crate) fn explicit_value(self) -> Option<bool> {
        match self {
            Self::Inherit => None,
            Self::ForceEnabled => Some(true),
            Self::ForceDisabled => Some(false),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexUnifiedExecExternalStatus {
    pub(crate) config_path: Option<String>,
    pub(crate) has_explicit_unified_exec: bool,
    pub(crate) explicit_unified_exec_value: Option<bool>,
    pub(crate) official_default_enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EmailSenderProvider {
    #[serde(rename = "126")]
    Mail126,
    #[serde(rename = "163")]
    Mail163,
    Qq,
    Custom,
}

impl Default for EmailSenderProvider {
    fn default() -> Self {
        Self::Custom
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EmailSenderSecurity {
    SslTls,
    StartTls,
    None,
}

impl Default for EmailSenderSecurity {
    fn default() -> Self {
        Self::SslTls
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EmailSenderSettings {
    #[serde(default)]
    pub(crate) enabled: bool,
    #[serde(default)]
    pub(crate) provider: EmailSenderProvider,
    #[serde(default, rename = "senderEmail")]
    pub(crate) sender_email: String,
    #[serde(default, rename = "senderName")]
    pub(crate) sender_name: String,
    #[serde(default, rename = "smtpHost")]
    pub(crate) smtp_host: String,
    #[serde(default = "default_email_sender_smtp_port", rename = "smtpPort")]
    pub(crate) smtp_port: u16,
    #[serde(default)]
    pub(crate) security: EmailSenderSecurity,
    #[serde(default)]
    pub(crate) username: String,
    #[serde(default, rename = "recipientEmail")]
    pub(crate) recipient_email: String,
}

impl Default for EmailSenderSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: EmailSenderProvider::Custom,
            sender_email: String::new(),
            sender_name: String::new(),
            smtp_host: String::new(),
            smtp_port: default_email_sender_smtp_port(),
            security: EmailSenderSecurity::SslTls,
            username: String::new(),
            recipient_email: String::new(),
        }
    }
}

fn default_email_sender_settings() -> EmailSenderSettings {
    EmailSenderSettings::default()
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EmailInboundSecurity {
    SslTls,
    StartTls,
    None,
}

impl Default for EmailInboundSecurity {
    fn default() -> Self {
        Self::SslTls
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EmailInboundSettings {
    #[serde(default)]
    pub(crate) enabled: bool,
    #[serde(default)]
    pub(crate) provider: EmailSenderProvider,
    #[serde(default, rename = "imapHost")]
    pub(crate) imap_host: String,
    #[serde(default = "default_email_inbound_imap_port", rename = "imapPort")]
    pub(crate) imap_port: u16,
    #[serde(default)]
    pub(crate) security: EmailInboundSecurity,
    #[serde(default)]
    pub(crate) username: String,
    #[serde(
        default = "default_email_inbound_mailbox_folder",
        rename = "mailboxFolder"
    )]
    pub(crate) mailbox_folder: String,
    #[serde(default, rename = "allowedSenders")]
    pub(crate) allowed_senders: Vec<String>,
    #[serde(
        default = "default_email_inbound_poll_interval_seconds",
        rename = "pollIntervalSeconds"
    )]
    pub(crate) poll_interval_seconds: u64,
    #[serde(
        default = "default_email_inbound_read_only_mode",
        rename = "readOnlyMode"
    )]
    pub(crate) read_only_mode: bool,
    #[serde(
        default = "default_email_inbound_action_window_hours",
        rename = "actionWindowHours"
    )]
    pub(crate) action_window_hours: i64,
    #[serde(default, rename = "debugStorageEnabled")]
    pub(crate) debug_storage_enabled: bool,
}

impl Default for EmailInboundSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: EmailSenderProvider::Custom,
            imap_host: String::new(),
            imap_port: default_email_inbound_imap_port(),
            security: EmailInboundSecurity::SslTls,
            username: String::new(),
            mailbox_folder: default_email_inbound_mailbox_folder(),
            allowed_senders: Vec::new(),
            poll_interval_seconds: default_email_inbound_poll_interval_seconds(),
            read_only_mode: default_email_inbound_read_only_mode(),
            action_window_hours: default_email_inbound_action_window_hours(),
            debug_storage_enabled: false,
        }
    }
}

fn default_email_inbound_settings() -> EmailInboundSettings {
    EmailInboundSettings::default()
}

fn default_gemini_enabled() -> bool {
    crate::engine_policy::GEMINI_RUNTIME_ENABLED
}

fn default_opencode_enabled() -> bool {
    // Legacy field: OpenCode is always enabled at runtime (see engine::engine_enabled_in_settings);
    // the persisted flag no longer gates anything and defaults to true.
    true
}

fn default_disabled_cli_engines() -> Vec<String> {
    vec!["grok".to_string(), "opencode".to_string()]
}

fn default_email_sender_smtp_port() -> u16 {
    465
}

fn default_email_inbound_imap_port() -> u16 {
    993
}

fn default_email_inbound_mailbox_folder() -> String {
    "INBOX".to_string()
}

fn default_email_inbound_poll_interval_seconds() -> u64 {
    300
}

fn default_email_inbound_read_only_mode() -> bool {
    true
}

fn default_email_inbound_action_window_hours() -> i64 {
    24
}

fn default_wechat_webhook_port() -> u16 {
    18790
}

fn default_wechat_webhook_path() -> String {
    "/webhook/wechat".to_string()
}

fn default_wechat_device_type() -> String {
    "ipad".to_string()
}

/// WeChat personal-account bridge channel settings (OpenClaw-style contract).
/// Secrets (apiKey / webhookToken) never live here; see `wechat` module secret store.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WechatChannelSettings {
    #[serde(default)]
    pub(crate) enabled: bool,
    #[serde(default, rename = "bridgeBaseUrl")]
    pub(crate) bridge_base_url: String,
    #[serde(default = "default_wechat_webhook_host", rename = "webhookHost")]
    pub(crate) webhook_host: String,
    #[serde(default = "default_wechat_webhook_port", rename = "webhookPort")]
    pub(crate) webhook_port: u16,
    #[serde(default = "default_wechat_webhook_path", rename = "webhookPath")]
    pub(crate) webhook_path: String,
    #[serde(default = "default_wechat_device_type", rename = "deviceType")]
    pub(crate) device_type: String,
    /// User explicitly acknowledged Tencent iLink authorization and local data handling.
    #[serde(default, rename = "riskAcknowledged")]
    pub(crate) risk_acknowledged: bool,
    /// Business routing target. Bridge/network wiring remains fully managed by Doge.
    #[serde(default, rename = "workspaceId")]
    pub(crate) workspace_id: Option<String>,
    #[serde(default)]
    pub(crate) engine: Option<String>,
    #[serde(default)]
    pub(crate) model: Option<String>,
    #[serde(default, rename = "modelCatalogEntryId")]
    pub(crate) model_catalog_entry_id: Option<String>,
    #[serde(default, rename = "providerProfileId")]
    pub(crate) provider_profile_id: Option<String>,
}

impl Default for WechatChannelSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            bridge_base_url: String::new(),
            webhook_host: default_wechat_webhook_host(),
            webhook_port: default_wechat_webhook_port(),
            webhook_path: default_wechat_webhook_path(),
            device_type: default_wechat_device_type(),
            risk_acknowledged: false,
            workspace_id: None,
            engine: None,
            model: None,
            model_catalog_entry_id: None,
            provider_profile_id: None,
        }
    }
}

fn default_wechat_channel_settings() -> WechatChannelSettings {
    WechatChannelSettings::default()
}

fn default_wechat_webhook_host() -> String {
    "127.0.0.1".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct AppSettings {
    #[serde(default, rename = "codexBin")]
    pub(crate) codex_bin: Option<String>,
    #[serde(default, rename = "claudeBin")]
    pub(crate) claude_bin: Option<String>,
    #[serde(default, rename = "kimiBin")]
    pub(crate) kimi_bin: Option<String>,
    #[serde(default, rename = "grokBin")]
    pub(crate) grok_bin: Option<String>,
    #[serde(default, rename = "opencodeBin")]
    pub(crate) opencode_bin: Option<String>,
    #[serde(default, rename = "codexArgs")]
    pub(crate) codex_args: Option<String>,
    #[serde(default, rename = "terminalShellPath")]
    pub(crate) terminal_shell_path: Option<String>,
    #[serde(default = "default_gemini_enabled", rename = "geminiEnabled")]
    pub(crate) gemini_enabled: bool,
    #[serde(default = "default_opencode_enabled", rename = "opencodeEnabled")]
    pub(crate) opencode_enabled: bool,
    #[serde(
        default = "default_disabled_cli_engines",
        rename = "disabledCliEngines"
    )]
    pub(crate) disabled_cli_engines: Vec<String>,
    #[serde(default, rename = "sessionAttributionMode")]
    pub(crate) session_attribution_mode: WorkspaceSessionAttributionMode,
    #[serde(default, rename = "backendMode")]
    pub(crate) backend_mode: BackendMode,
    #[serde(default = "default_remote_backend_host", rename = "remoteBackendHost")]
    pub(crate) remote_backend_host: String,
    #[serde(default, rename = "remoteBackendToken")]
    pub(crate) remote_backend_token: Option<String>,
    #[serde(default = "default_web_service_port", rename = "webServicePort")]
    pub(crate) web_service_port: u16,
    #[serde(default, rename = "webServiceToken")]
    pub(crate) web_service_token: Option<String>,
    #[serde(default, rename = "systemProxyEnabled")]
    pub(crate) system_proxy_enabled: bool,
    #[serde(default, rename = "systemProxyUrl")]
    pub(crate) system_proxy_url: Option<String>,
    #[serde(default = "default_access_mode", rename = "defaultAccessMode")]
    pub(crate) default_access_mode: String,
    #[serde(
        default = "default_composer_model_shortcut",
        rename = "composerModelShortcut"
    )]
    pub(crate) composer_model_shortcut: Option<String>,
    #[serde(
        default = "default_composer_access_shortcut",
        rename = "composerAccessShortcut"
    )]
    pub(crate) composer_access_shortcut: Option<String>,
    #[serde(
        default = "default_composer_reasoning_shortcut",
        rename = "composerReasoningShortcut"
    )]
    pub(crate) composer_reasoning_shortcut: Option<String>,
    #[serde(default = "default_interrupt_shortcut", rename = "interruptShortcut")]
    pub(crate) interrupt_shortcut: Option<String>,
    #[serde(
        default = "default_composer_collaboration_shortcut",
        rename = "composerCollaborationShortcut"
    )]
    pub(crate) composer_collaboration_shortcut: Option<String>,
    #[serde(
        default = "default_open_settings_shortcut",
        rename = "openSettingsShortcut"
    )]
    pub(crate) open_settings_shortcut: Option<String>,
    #[serde(default = "default_new_window_shortcut", rename = "newWindowShortcut")]
    pub(crate) new_window_shortcut: Option<String>,
    #[serde(default = "default_open_chat_shortcut", rename = "openChatShortcut")]
    pub(crate) open_chat_shortcut: Option<String>,
    #[serde(
        default = "default_open_kanban_shortcut",
        rename = "openKanbanShortcut"
    )]
    pub(crate) open_kanban_shortcut: Option<String>,
    #[serde(
        default = "default_cycle_open_session_prev_shortcut",
        rename = "cycleOpenSessionPrevShortcut"
    )]
    pub(crate) cycle_open_session_prev_shortcut: Option<String>,
    #[serde(
        default = "default_cycle_open_session_next_shortcut",
        rename = "cycleOpenSessionNextShortcut"
    )]
    pub(crate) cycle_open_session_next_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_left_conversation_sidebar_shortcut",
        rename = "toggleLeftConversationSidebarShortcut"
    )]
    pub(crate) toggle_left_conversation_sidebar_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_right_conversation_sidebar_shortcut",
        rename = "toggleRightConversationSidebarShortcut"
    )]
    pub(crate) toggle_right_conversation_sidebar_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_runtime_console_shortcut",
        rename = "toggleRuntimeConsoleShortcut"
    )]
    pub(crate) toggle_runtime_console_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_files_surface_shortcut",
        rename = "toggleFilesSurfaceShortcut"
    )]
    pub(crate) toggle_files_surface_shortcut: Option<String>,
    #[serde(default = "default_save_file_shortcut", rename = "saveFileShortcut")]
    pub(crate) save_file_shortcut: Option<String>,
    #[serde(
        default = "default_find_in_file_shortcut",
        rename = "findInFileShortcut"
    )]
    pub(crate) find_in_file_shortcut: Option<String>,
    #[serde(
        default = "default_expand_selection_shortcut",
        rename = "expandSelectionShortcut"
    )]
    pub(crate) expand_selection_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_git_diff_list_view_shortcut",
        rename = "toggleGitDiffListViewShortcut"
    )]
    pub(crate) toggle_git_diff_list_view_shortcut: Option<String>,
    #[serde(default, rename = "toggleGitGraphShortcut")]
    pub(crate) toggle_git_graph_shortcut: Option<String>,
    #[serde(default, rename = "openNotesShortcut")]
    pub(crate) open_notes_shortcut: Option<String>,
    #[serde(default, rename = "openIntentCanvasShortcut")]
    pub(crate) open_intent_canvas_shortcut: Option<String>,
    #[serde(default, rename = "openRadarShortcut")]
    pub(crate) open_radar_shortcut: Option<String>,
    #[serde(default, rename = "openProjectMapShortcut")]
    pub(crate) open_project_map_shortcut: Option<String>,
    #[serde(default, rename = "openBrowserDockShortcut")]
    pub(crate) open_browser_dock_shortcut: Option<String>,
    #[serde(default, rename = "openFileCompareShortcut")]
    pub(crate) open_file_compare_shortcut: Option<String>,
    #[serde(
        default = "default_increase_ui_scale_shortcut",
        rename = "increaseUiScaleShortcut"
    )]
    pub(crate) increase_ui_scale_shortcut: Option<String>,
    #[serde(
        default = "default_decrease_ui_scale_shortcut",
        rename = "decreaseUiScaleShortcut"
    )]
    pub(crate) decrease_ui_scale_shortcut: Option<String>,
    #[serde(
        default = "default_reset_ui_scale_shortcut",
        rename = "resetUiScaleShortcut"
    )]
    pub(crate) reset_ui_scale_shortcut: Option<String>,
    #[serde(default = "default_new_agent_shortcut", rename = "newAgentShortcut")]
    pub(crate) new_agent_shortcut: Option<String>,
    #[serde(
        default = "default_new_worktree_agent_shortcut",
        rename = "newWorktreeAgentShortcut"
    )]
    pub(crate) new_worktree_agent_shortcut: Option<String>,
    #[serde(
        default = "default_new_clone_agent_shortcut",
        rename = "newCloneAgentShortcut"
    )]
    pub(crate) new_clone_agent_shortcut: Option<String>,
    #[serde(
        default = "default_archive_thread_shortcut",
        rename = "archiveThreadShortcut"
    )]
    pub(crate) archive_thread_shortcut: Option<String>,
    #[serde(
        default = "default_close_current_session_shortcut",
        rename = "closeCurrentSessionShortcut"
    )]
    pub(crate) close_current_session_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_projects_sidebar_shortcut",
        rename = "toggleProjectsSidebarShortcut"
    )]
    pub(crate) toggle_projects_sidebar_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_git_sidebar_shortcut",
        rename = "toggleGitSidebarShortcut"
    )]
    pub(crate) toggle_git_sidebar_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_global_search_shortcut",
        rename = "toggleGlobalSearchShortcut"
    )]
    pub(crate) toggle_global_search_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_debug_panel_shortcut",
        rename = "toggleDebugPanelShortcut"
    )]
    pub(crate) toggle_debug_panel_shortcut: Option<String>,
    #[serde(
        default = "default_toggle_terminal_shortcut",
        rename = "toggleTerminalShortcut"
    )]
    pub(crate) toggle_terminal_shortcut: Option<String>,
    #[serde(
        default = "default_cycle_agent_next_shortcut",
        rename = "cycleAgentNextShortcut"
    )]
    pub(crate) cycle_agent_next_shortcut: Option<String>,
    #[serde(
        default = "default_cycle_agent_prev_shortcut",
        rename = "cycleAgentPrevShortcut"
    )]
    pub(crate) cycle_agent_prev_shortcut: Option<String>,
    #[serde(
        default = "default_cycle_workspace_next_shortcut",
        rename = "cycleWorkspaceNextShortcut"
    )]
    pub(crate) cycle_workspace_next_shortcut: Option<String>,
    #[serde(
        default = "default_cycle_workspace_prev_shortcut",
        rename = "cycleWorkspacePrevShortcut"
    )]
    pub(crate) cycle_workspace_prev_shortcut: Option<String>,
    #[serde(default, rename = "lastComposerModelId")]
    pub(crate) last_composer_model_id: Option<String>,
    #[serde(default, rename = "lastComposerReasoningEffort")]
    pub(crate) last_composer_reasoning_effort: Option<String>,
    // Frontend-owned per-engine composer preferences; stored as opaque JSON so
    // new frontend fields survive the save/echo round-trip without backend changes.
    #[serde(default, rename = "lastComposerPrefsByEngine")]
    pub(crate) last_composer_prefs_by_engine: Option<serde_json::Value>,
    #[serde(default = "default_ui_scale", rename = "uiScale")]
    pub(crate) ui_scale: f64,
    #[serde(default = "default_theme", rename = "theme")]
    pub(crate) theme: String,
    /// macOS Dock + in-app logo preference (`default` = shipping product icon).
    #[serde(default = "default_dock_icon_id", rename = "dockIconId")]
    pub(crate) dock_icon_id: String,
    #[serde(
        default = "default_light_theme_preset_id",
        rename = "lightThemePresetId"
    )]
    pub(crate) light_theme_preset_id: String,
    #[serde(default = "default_dark_theme_preset_id", rename = "darkThemePresetId")]
    pub(crate) dark_theme_preset_id: String,
    #[serde(
        default = "default_custom_theme_preset_id",
        rename = "customThemePresetId"
    )]
    pub(crate) custom_theme_preset_id: String,
    #[serde(
        default = "default_custom_skill_directories",
        rename = "customSkillDirectories"
    )]
    pub(crate) custom_skill_directories: Vec<String>,
    #[serde(default = "default_user_msg_color", rename = "userMsgColor")]
    pub(crate) user_msg_color: String,
    #[serde(
        default = "default_usage_show_remaining",
        rename = "usageShowRemaining"
    )]
    pub(crate) usage_show_remaining: bool,
    #[serde(
        default = "default_show_message_anchors",
        rename = "showMessageAnchors"
    )]
    pub(crate) show_message_anchors: bool,
    #[serde(
        default = "default_show_sidebar_provider_labels",
        rename = "showSidebarProviderLabels"
    )]
    pub(crate) show_sidebar_provider_labels: bool,
    #[serde(
        default = "default_performance_compatibility_mode_enabled",
        rename = "performanceCompatibilityModeEnabled"
    )]
    pub(crate) performance_compatibility_mode_enabled: bool,
    #[serde(default = "default_canvas_width_mode", rename = "canvasWidthMode")]
    pub(crate) canvas_width_mode: String,
    #[serde(default = "default_layout_mode", rename = "layoutMode")]
    pub(crate) layout_mode: String,
    #[serde(default = "default_ui_font_family", rename = "uiFontFamily")]
    pub(crate) ui_font_family: String,
    #[serde(default = "default_code_font_family", rename = "codeFontFamily")]
    pub(crate) code_font_family: String,
    #[serde(default = "default_code_font_size", rename = "codeFontSize")]
    pub(crate) code_font_size: u8,
    #[serde(
        default = "default_notification_sounds_enabled",
        rename = "notificationSoundsEnabled"
    )]
    pub(crate) notification_sounds_enabled: bool,
    #[serde(
        default = "default_notification_sound_id",
        rename = "notificationSoundId"
    )]
    pub(crate) notification_sound_id: String,
    #[serde(
        default = "default_notification_sound_custom_path",
        rename = "notificationSoundCustomPath"
    )]
    pub(crate) notification_sound_custom_path: String,
    #[serde(
        default = "default_system_notification_enabled",
        rename = "systemNotificationEnabled"
    )]
    pub(crate) system_notification_enabled: bool,
    #[serde(default = "default_email_sender_settings", rename = "emailSender")]
    pub(crate) email_sender: EmailSenderSettings,
    #[serde(default = "default_email_inbound_settings", rename = "emailInbound")]
    pub(crate) email_inbound: EmailInboundSettings,
    #[serde(default = "default_wechat_channel_settings", rename = "wechatChannel")]
    pub(crate) wechat_channel: WechatChannelSettings,
    #[serde(default = "default_preload_git_diffs", rename = "preloadGitDiffs")]
    pub(crate) preload_git_diffs: bool,
    #[serde(
        default = "default_detached_external_change_awareness_enabled",
        rename = "detachedExternalChangeAwarenessEnabled"
    )]
    pub(crate) detached_external_change_awareness_enabled: bool,
    #[serde(
        default = "default_detached_external_change_watcher_enabled",
        rename = "detachedExternalChangeWatcherEnabled"
    )]
    pub(crate) detached_external_change_watcher_enabled: bool,
    #[serde(
        default = "default_experimental_collab_enabled",
        rename = "experimentalCollabEnabled"
    )]
    pub(crate) experimental_collab_enabled: bool,
    #[serde(
        default = "default_experimental_collaboration_modes_enabled",
        rename = "experimentalCollaborationModesEnabled"
    )]
    pub(crate) experimental_collaboration_modes_enabled: bool,
    #[serde(
        default = "default_codex_mode_enforcement_enabled",
        rename = "codexModeEnforcementEnabled"
    )]
    pub(crate) codex_mode_enforcement_enabled: bool,
    #[serde(
        default = "default_experimental_steer_enabled",
        rename = "experimentalSteerEnabled"
    )]
    pub(crate) experimental_steer_enabled: bool,
    #[serde(default, rename = "codexUnifiedExecPolicy")]
    pub(crate) codex_unified_exec_policy: CodexUnifiedExecPolicy,
    #[serde(default, rename = "experimentalUnifiedExecEnabled", skip_serializing)]
    pub(crate) experimental_unified_exec_enabled: Option<bool>,
    #[serde(
        default = "default_chat_canvas_use_normalized_realtime",
        rename = "chatCanvasUseNormalizedRealtime"
    )]
    pub(crate) chat_canvas_use_normalized_realtime: bool,
    #[serde(
        default = "default_chat_canvas_use_unified_history_loader",
        rename = "chatCanvasUseUnifiedHistoryLoader"
    )]
    pub(crate) chat_canvas_use_unified_history_loader: bool,
    #[serde(
        default = "default_chat_canvas_use_presentation_profile",
        rename = "chatCanvasUsePresentationProfile"
    )]
    pub(crate) chat_canvas_use_presentation_profile: bool,
    #[serde(default = "default_dictation_enabled", rename = "dictationEnabled")]
    pub(crate) dictation_enabled: bool,
    #[serde(default = "default_dictation_model_id", rename = "dictationModelId")]
    pub(crate) dictation_model_id: String,
    #[serde(default, rename = "dictationPreferredLanguage")]
    pub(crate) dictation_preferred_language: Option<String>,
    #[serde(default = "default_dictation_hold_key", rename = "dictationHoldKey")]
    pub(crate) dictation_hold_key: String,
    #[serde(
        default = "default_composer_editor_preset",
        rename = "composerEditorPreset"
    )]
    pub(crate) composer_editor_preset: String,
    #[serde(
        default = "default_composer_send_shortcut",
        rename = "composerSendShortcut"
    )]
    pub(crate) composer_send_shortcut: String,
    #[serde(
        default = "default_composer_fence_expand_on_space",
        rename = "composerFenceExpandOnSpace"
    )]
    pub(crate) composer_fence_expand_on_space: bool,
    #[serde(
        default = "default_composer_fence_expand_on_enter",
        rename = "composerFenceExpandOnEnter"
    )]
    pub(crate) composer_fence_expand_on_enter: bool,
    #[serde(
        default = "default_composer_fence_language_tags",
        rename = "composerFenceLanguageTags"
    )]
    pub(crate) composer_fence_language_tags: bool,
    #[serde(
        default = "default_composer_fence_wrap_selection",
        rename = "composerFenceWrapSelection"
    )]
    pub(crate) composer_fence_wrap_selection: bool,
    #[serde(
        default = "default_composer_fence_auto_wrap_paste_multiline",
        rename = "composerFenceAutoWrapPasteMultiline"
    )]
    pub(crate) composer_fence_auto_wrap_paste_multiline: bool,
    #[serde(
        default = "default_composer_fence_auto_wrap_paste_code_like",
        rename = "composerFenceAutoWrapPasteCodeLike"
    )]
    pub(crate) composer_fence_auto_wrap_paste_code_like: bool,
    #[serde(
        default = "default_composer_list_continuation",
        rename = "composerListContinuation"
    )]
    pub(crate) composer_list_continuation: bool,
    #[serde(
        default = "default_composer_code_block_copy_use_modifier",
        rename = "composerCodeBlockCopyUseModifier"
    )]
    pub(crate) composer_code_block_copy_use_modifier: bool,
    #[serde(default = "default_workspace_groups", rename = "workspaceGroups")]
    pub(crate) workspace_groups: Vec<WorkspaceGroup>,
    #[serde(default = "default_open_app_targets", rename = "openAppTargets")]
    pub(crate) open_app_targets: Vec<OpenAppTarget>,
    #[serde(default = "default_selected_open_app_id", rename = "selectedOpenAppId")]
    pub(crate) selected_open_app_id: String,
    #[serde(
        default = "default_runtime_restore_threads_only_on_launch",
        rename = "runtimeRestoreThreadsOnlyOnLaunch"
    )]
    pub(crate) runtime_restore_threads_only_on_launch: bool,
    #[serde(
        default = "default_runtime_force_cleanup_on_exit",
        rename = "runtimeForceCleanupOnExit"
    )]
    pub(crate) runtime_force_cleanup_on_exit: bool,
    #[serde(
        default = "default_runtime_orphan_sweep_on_launch",
        rename = "runtimeOrphanSweepOnLaunch"
    )]
    pub(crate) runtime_orphan_sweep_on_launch: bool,
    #[serde(
        default = "default_codex_max_hot_runtimes",
        rename = "codexMaxHotRuntimes"
    )]
    pub(crate) codex_max_hot_runtimes: u8,
    #[serde(
        default = "default_codex_max_warm_runtimes",
        rename = "codexMaxWarmRuntimes"
    )]
    pub(crate) codex_max_warm_runtimes: u8,
    #[serde(
        default = "default_codex_warm_ttl_seconds",
        rename = "codexWarmTtlSeconds"
    )]
    pub(crate) codex_warm_ttl_seconds: u16,
    #[serde(
        default = "default_codex_auto_compaction_threshold_percent",
        rename = "codexAutoCompactionThresholdPercent"
    )]
    pub(crate) codex_auto_compaction_threshold_percent: u16,
    #[serde(
        default = "default_codex_auto_compaction_enabled",
        rename = "codexAutoCompactionEnabled"
    )]
    pub(crate) codex_auto_compaction_enabled: bool,
    #[serde(
        default = "default_browser_agent_enabled",
        rename = "browserAgentEnabled"
    )]
    pub(crate) browser_agent_enabled: bool,
    #[serde(
        default = "default_browser_agent_prefer_built_in",
        rename = "browserAgentPreferBuiltIn"
    )]
    pub(crate) browser_agent_prefer_built_in: bool,
    #[serde(
        default = "default_browser_agent_allow_external_provider_fallback",
        rename = "browserAgentAllowExternalProviderFallback"
    )]
    pub(crate) browser_agent_allow_external_provider_fallback: bool,
    /// Default engine type: "claude", "codex", or "opencode". If not set, auto-detect.
    #[serde(default, rename = "defaultEngine")]
    pub(crate) default_engine: Option<String>,
    /// Curated skill ids the user has enabled. Shared across workspaces and
    /// sessions. Toggling these participates in Codex restart detection because
    /// long-lived app-server runtimes cache generated instruction transport state.
    #[serde(
        default = "default_enabled_curated_skill_ids",
        rename = "enabledCuratedSkillIds"
    )]
    pub(crate) enabled_curated_skill_ids: Vec<String>,
    /// One-shot version marker for newly introduced default curated skills.
    /// Legacy settings omit this field and deserialize as 0.
    #[serde(default, rename = "curatedSkillDefaultsVersion")]
    pub(crate) curated_skill_defaults_version: u8,
    /// Built-in Agent Catalog ids the user explicitly enabled for discovery in
    /// the Composer `#` picker. Enablement never injects a prompt by itself.
    #[serde(
        default = "default_enabled_builtin_agent_ids",
        rename = "enabledBuiltInAgentIds"
    )]
    pub(crate) enabled_builtin_agent_ids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub(crate) enum BackendMode {
    Local,
    Remote,
}

impl Default for BackendMode {
    fn default() -> Self {
        BackendMode::Local
    }
}

fn default_access_mode() -> String {
    "full-access".to_string()
}

fn default_remote_backend_host() -> String {
    "127.0.0.1:4732".to_string()
}

fn default_web_service_port() -> u16 {
    3080
}

fn default_ui_scale() -> f64 {
    1.0
}

fn default_dock_icon_id() -> String {
    "default".to_string()
}

fn default_theme() -> String {
    "system".to_string()
}

fn default_light_theme_preset_id() -> String {
    "vscode-light-modern".to_string()
}

fn default_dark_theme_preset_id() -> String {
    "vscode-dark-modern".to_string()
}

fn default_custom_theme_preset_id() -> String {
    "vscode-dark-modern".to_string()
}

fn default_custom_skill_directories() -> Vec<String> {
    Vec::new()
}

fn default_user_msg_color() -> String {
    String::new()
}

fn default_usage_show_remaining() -> bool {
    false
}

fn default_show_message_anchors() -> bool {
    true
}

fn default_show_sidebar_provider_labels() -> bool {
    false
}

fn default_performance_compatibility_mode_enabled() -> bool {
    false
}

fn default_canvas_width_mode() -> String {
    "narrow".to_string()
}

fn default_layout_mode() -> String {
    "default".to_string()
}

fn default_ui_font_family() -> String {
    "Monaco, \"SF Pro Text\", \"SF Pro Display\", -apple-system, \"Helvetica Neue\", sans-serif"
        .to_string()
}

fn default_code_font_family() -> String {
    "Monaco, \"SF Mono\", \"SFMono-Regular\", Menlo, monospace".to_string()
}

fn default_code_font_size() -> u8 {
    11
}

fn default_composer_model_shortcut() -> Option<String> {
    Some("cmd+shift+m".to_string())
}

fn default_composer_access_shortcut() -> Option<String> {
    Some("cmd+shift+a".to_string())
}

fn default_composer_reasoning_shortcut() -> Option<String> {
    Some("cmd+shift+r".to_string())
}

fn default_interrupt_shortcut() -> Option<String> {
    let value = if cfg!(target_os = "macos") {
        "ctrl+c"
    } else {
        "ctrl+shift+c"
    };
    Some(value.to_string())
}

fn default_composer_collaboration_shortcut() -> Option<String> {
    Some("shift+tab".to_string())
}

fn default_open_settings_shortcut() -> Option<String> {
    Some("cmd+,".to_string())
}

fn default_new_window_shortcut() -> Option<String> {
    Some("cmd+shift+n".to_string())
}

fn default_open_chat_shortcut() -> Option<String> {
    Some("cmd+j".to_string())
}

fn default_open_kanban_shortcut() -> Option<String> {
    Some("cmd+k".to_string())
}

fn default_cycle_open_session_prev_shortcut() -> Option<String> {
    Some("cmd+shift+[".to_string())
}

fn default_cycle_open_session_next_shortcut() -> Option<String> {
    Some("cmd+shift+]".to_string())
}

fn default_toggle_left_conversation_sidebar_shortcut() -> Option<String> {
    Some("cmd+alt+[".to_string())
}

fn default_toggle_right_conversation_sidebar_shortcut() -> Option<String> {
    Some("cmd+alt+]".to_string())
}

fn default_toggle_runtime_console_shortcut() -> Option<String> {
    Some("cmd+shift+`".to_string())
}

fn default_toggle_files_surface_shortcut() -> Option<String> {
    Some("cmd+shift+e".to_string())
}

fn default_save_file_shortcut() -> Option<String> {
    Some("cmd+s".to_string())
}

fn default_find_in_file_shortcut() -> Option<String> {
    Some("cmd+f".to_string())
}

fn default_expand_selection_shortcut() -> Option<String> {
    Some("cmd+w".to_string())
}

fn default_toggle_git_diff_list_view_shortcut() -> Option<String> {
    Some("alt+shift+v".to_string())
}

fn default_increase_ui_scale_shortcut() -> Option<String> {
    Some("cmd+=".to_string())
}

fn default_decrease_ui_scale_shortcut() -> Option<String> {
    Some("cmd+-".to_string())
}

fn default_reset_ui_scale_shortcut() -> Option<String> {
    Some("cmd+0".to_string())
}

fn default_new_agent_shortcut() -> Option<String> {
    Some("cmd+n".to_string())
}

fn default_new_worktree_agent_shortcut() -> Option<String> {
    Some("cmd+shift+n".to_string())
}

fn default_new_clone_agent_shortcut() -> Option<String> {
    Some("cmd+alt+n".to_string())
}

fn default_archive_thread_shortcut() -> Option<String> {
    Some("cmd+ctrl+a".to_string())
}

fn default_close_current_session_shortcut() -> Option<String> {
    Some("cmd+w".to_string())
}

fn default_toggle_projects_sidebar_shortcut() -> Option<String> {
    Some("cmd+shift+p".to_string())
}

fn default_toggle_git_sidebar_shortcut() -> Option<String> {
    Some("cmd+shift+g".to_string())
}

fn default_toggle_global_search_shortcut() -> Option<String> {
    Some("cmd+o".to_string())
}

fn default_toggle_debug_panel_shortcut() -> Option<String> {
    Some("cmd+shift+d".to_string())
}

fn default_toggle_terminal_shortcut() -> Option<String> {
    Some("cmd+shift+t".to_string())
}

fn default_cycle_agent_next_shortcut() -> Option<String> {
    Some("cmd+ctrl+down".to_string())
}

fn default_cycle_agent_prev_shortcut() -> Option<String> {
    Some("cmd+ctrl+up".to_string())
}

fn default_cycle_workspace_next_shortcut() -> Option<String> {
    Some("cmd+shift+down".to_string())
}

fn default_cycle_workspace_prev_shortcut() -> Option<String> {
    Some("cmd+shift+up".to_string())
}

fn default_notification_sounds_enabled() -> bool {
    true
}

fn default_notification_sound_id() -> String {
    "default".to_string()
}

fn default_notification_sound_custom_path() -> String {
    String::new()
}

fn default_detached_external_change_awareness_enabled() -> bool {
    true
}

fn default_detached_external_change_watcher_enabled() -> bool {
    true
}

fn default_system_notification_enabled() -> bool {
    true
}

fn default_preload_git_diffs() -> bool {
    true
}

fn default_experimental_collab_enabled() -> bool {
    false
}

fn default_experimental_collaboration_modes_enabled() -> bool {
    false
}

fn default_codex_mode_enforcement_enabled() -> bool {
    true
}

fn default_experimental_steer_enabled() -> bool {
    false
}

fn default_chat_canvas_use_normalized_realtime() -> bool {
    false
}

fn default_chat_canvas_use_unified_history_loader() -> bool {
    false
}

fn default_chat_canvas_use_presentation_profile() -> bool {
    false
}

fn default_dictation_enabled() -> bool {
    false
}

fn default_dictation_model_id() -> String {
    "base".to_string()
}

fn default_dictation_hold_key() -> String {
    "alt".to_string()
}

fn default_composer_editor_preset() -> String {
    "default".to_string()
}

fn default_composer_send_shortcut() -> String {
    "enter".to_string()
}

fn default_composer_fence_expand_on_space() -> bool {
    false
}

fn default_composer_fence_expand_on_enter() -> bool {
    false
}

fn default_composer_fence_language_tags() -> bool {
    false
}

fn default_composer_fence_wrap_selection() -> bool {
    false
}

fn default_composer_fence_auto_wrap_paste_multiline() -> bool {
    false
}

fn default_composer_fence_auto_wrap_paste_code_like() -> bool {
    false
}

fn default_composer_list_continuation() -> bool {
    false
}

fn default_composer_code_block_copy_use_modifier() -> bool {
    false
}

fn default_workspace_groups() -> Vec<WorkspaceGroup> {
    Vec::new()
}

fn default_open_app_targets() -> Vec<OpenAppTarget> {
    vec![
        OpenAppTarget {
            id: "vscode".to_string(),
            label: "VS Code".to_string(),
            kind: "app".to_string(),
            app_name: Some("Visual Studio Code".to_string()),
            command: None,
            args: Vec::new(),
        },
        OpenAppTarget {
            id: "cursor".to_string(),
            label: "Cursor".to_string(),
            kind: "app".to_string(),
            app_name: Some("Cursor".to_string()),
            command: None,
            args: Vec::new(),
        },
        OpenAppTarget {
            id: "zed".to_string(),
            label: "Zed".to_string(),
            kind: "app".to_string(),
            app_name: Some("Zed".to_string()),
            command: None,
            args: Vec::new(),
        },
        OpenAppTarget {
            id: "ghostty".to_string(),
            label: "Ghostty".to_string(),
            kind: "app".to_string(),
            app_name: Some("Ghostty".to_string()),
            command: None,
            args: Vec::new(),
        },
        OpenAppTarget {
            id: "antigravity".to_string(),
            label: "Antigravity".to_string(),
            kind: "app".to_string(),
            app_name: Some("Antigravity".to_string()),
            command: None,
            args: Vec::new(),
        },
        OpenAppTarget {
            id: "finder".to_string(),
            label: "Finder".to_string(),
            kind: "finder".to_string(),
            app_name: None,
            command: None,
            args: Vec::new(),
        },
    ]
}

fn default_selected_open_app_id() -> String {
    "vscode".to_string()
}

fn default_runtime_restore_threads_only_on_launch() -> bool {
    true
}

fn default_runtime_force_cleanup_on_exit() -> bool {
    true
}

fn default_runtime_orphan_sweep_on_launch() -> bool {
    true
}

fn default_codex_max_hot_runtimes() -> u8 {
    1
}

fn default_codex_max_warm_runtimes() -> u8 {
    2
}

fn default_codex_warm_ttl_seconds() -> u16 {
    7200
}

fn default_codex_auto_compaction_threshold_percent() -> u16 {
    92
}

fn default_codex_auto_compaction_enabled() -> bool {
    true
}

fn default_browser_agent_enabled() -> bool {
    true
}

fn default_browser_agent_prefer_built_in() -> bool {
    true
}

fn default_browser_agent_allow_external_provider_fallback() -> bool {
    true
}

pub(crate) fn default_enabled_curated_skill_ids() -> Vec<String> {
    vec!["lazy-senior-dev".to_string(), "caveman".to_string()]
}

const CURRENT_CURATED_SKILL_DEFAULTS_VERSION: u8 = 1;

fn default_curated_skill_defaults_version() -> u8 {
    CURRENT_CURATED_SKILL_DEFAULTS_VERSION
}

pub(crate) fn default_enabled_builtin_agent_ids() -> Vec<String> {
    Vec::new()
}

fn is_allowed_codex_auto_compaction_threshold_percent(value: u16) -> bool {
    value == 92 || ((100..=200).contains(&value) && value % 10 == 0)
}

impl AppSettings {
    pub(crate) fn normalize_unified_exec_policy(&mut self) {
        self.codex_unified_exec_policy = CodexUnifiedExecPolicy::Inherit;
        self.experimental_unified_exec_enabled = None;
    }

    pub(crate) fn codex_unified_exec_override(&self) -> Option<bool> {
        self.codex_unified_exec_policy.explicit_value()
    }

    pub(crate) fn sanitize_runtime_pool_settings(&mut self) {
        self.codex_max_hot_runtimes = self.codex_max_hot_runtimes.clamp(0, 8);
        self.codex_max_warm_runtimes = self.codex_max_warm_runtimes.clamp(0, 16);
        self.codex_warm_ttl_seconds = self.codex_warm_ttl_seconds.clamp(15, 14400);
        if !is_allowed_codex_auto_compaction_threshold_percent(
            self.codex_auto_compaction_threshold_percent,
        ) {
            self.codex_auto_compaction_threshold_percent =
                default_codex_auto_compaction_threshold_percent();
        }
    }

    pub(crate) fn upgrade_runtime_pool_settings_for_startup(&mut self) {
        self.sanitize_runtime_pool_settings();
        self.codex_warm_ttl_seconds = self
            .codex_warm_ttl_seconds
            .max(default_codex_warm_ttl_seconds());
    }

    pub(crate) fn upgrade_curated_skill_defaults_for_startup(&mut self) {
        if self.curated_skill_defaults_version >= CURRENT_CURATED_SKILL_DEFAULTS_VERSION {
            return;
        }
        if !self.enabled_curated_skill_ids.is_empty()
            && !self
                .enabled_curated_skill_ids
                .iter()
                .any(|id| id == "caveman")
        {
            self.enabled_curated_skill_ids.push("caveman".to_string());
        }
        self.curated_skill_defaults_version = CURRENT_CURATED_SKILL_DEFAULTS_VERSION;
    }

    pub(crate) fn sanitize_engine_gates(&mut self) {
        self.gemini_enabled = crate::engine_policy::GEMINI_RUNTIME_ENABLED;
        if self
            .default_engine
            .as_deref()
            .is_some_and(|engine| engine.trim().eq_ignore_ascii_case("gemini"))
        {
            self.default_engine = None;
        }
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            codex_bin: None,
            claude_bin: None,
            kimi_bin: None,
            grok_bin: None,
            opencode_bin: None,
            codex_args: None,
            terminal_shell_path: None,
            gemini_enabled: default_gemini_enabled(),
            opencode_enabled: default_opencode_enabled(),
            disabled_cli_engines: default_disabled_cli_engines(),
            session_attribution_mode: WorkspaceSessionAttributionMode::Related,
            backend_mode: BackendMode::Local,
            remote_backend_host: default_remote_backend_host(),
            remote_backend_token: None,
            web_service_port: default_web_service_port(),
            web_service_token: None,
            system_proxy_enabled: false,
            system_proxy_url: None,
            default_engine: None,
            default_access_mode: "full-access".to_string(),
            composer_model_shortcut: default_composer_model_shortcut(),
            composer_access_shortcut: default_composer_access_shortcut(),
            composer_reasoning_shortcut: default_composer_reasoning_shortcut(),
            interrupt_shortcut: default_interrupt_shortcut(),
            composer_collaboration_shortcut: default_composer_collaboration_shortcut(),
            open_settings_shortcut: default_open_settings_shortcut(),
            new_window_shortcut: default_new_window_shortcut(),
            open_chat_shortcut: default_open_chat_shortcut(),
            open_kanban_shortcut: default_open_kanban_shortcut(),
            cycle_open_session_prev_shortcut: default_cycle_open_session_prev_shortcut(),
            cycle_open_session_next_shortcut: default_cycle_open_session_next_shortcut(),
            toggle_left_conversation_sidebar_shortcut:
                default_toggle_left_conversation_sidebar_shortcut(),
            toggle_right_conversation_sidebar_shortcut:
                default_toggle_right_conversation_sidebar_shortcut(),
            toggle_runtime_console_shortcut: default_toggle_runtime_console_shortcut(),
            toggle_files_surface_shortcut: default_toggle_files_surface_shortcut(),
            save_file_shortcut: default_save_file_shortcut(),
            find_in_file_shortcut: default_find_in_file_shortcut(),
            expand_selection_shortcut: default_expand_selection_shortcut(),
            toggle_git_diff_list_view_shortcut: default_toggle_git_diff_list_view_shortcut(),
            toggle_git_graph_shortcut: None,
            open_notes_shortcut: None,
            open_intent_canvas_shortcut: None,
            open_radar_shortcut: None,
            open_project_map_shortcut: None,
            open_browser_dock_shortcut: None,
            open_file_compare_shortcut: None,
            increase_ui_scale_shortcut: default_increase_ui_scale_shortcut(),
            decrease_ui_scale_shortcut: default_decrease_ui_scale_shortcut(),
            reset_ui_scale_shortcut: default_reset_ui_scale_shortcut(),
            new_agent_shortcut: default_new_agent_shortcut(),
            new_worktree_agent_shortcut: default_new_worktree_agent_shortcut(),
            new_clone_agent_shortcut: default_new_clone_agent_shortcut(),
            archive_thread_shortcut: default_archive_thread_shortcut(),
            close_current_session_shortcut: default_close_current_session_shortcut(),
            toggle_projects_sidebar_shortcut: default_toggle_projects_sidebar_shortcut(),
            toggle_git_sidebar_shortcut: default_toggle_git_sidebar_shortcut(),
            toggle_global_search_shortcut: default_toggle_global_search_shortcut(),
            toggle_debug_panel_shortcut: default_toggle_debug_panel_shortcut(),
            toggle_terminal_shortcut: default_toggle_terminal_shortcut(),
            cycle_agent_next_shortcut: default_cycle_agent_next_shortcut(),
            cycle_agent_prev_shortcut: default_cycle_agent_prev_shortcut(),
            cycle_workspace_next_shortcut: default_cycle_workspace_next_shortcut(),
            cycle_workspace_prev_shortcut: default_cycle_workspace_prev_shortcut(),
            last_composer_model_id: None,
            last_composer_reasoning_effort: None,
            last_composer_prefs_by_engine: None,
            ui_scale: 1.0,
            theme: default_theme(),
            dock_icon_id: default_dock_icon_id(),
            light_theme_preset_id: default_light_theme_preset_id(),
            dark_theme_preset_id: default_dark_theme_preset_id(),
            custom_theme_preset_id: default_custom_theme_preset_id(),
            custom_skill_directories: default_custom_skill_directories(),
            user_msg_color: default_user_msg_color(),
            usage_show_remaining: default_usage_show_remaining(),
            show_message_anchors: default_show_message_anchors(),
            show_sidebar_provider_labels: default_show_sidebar_provider_labels(),
            performance_compatibility_mode_enabled: default_performance_compatibility_mode_enabled(
            ),
            canvas_width_mode: default_canvas_width_mode(),
            layout_mode: default_layout_mode(),
            ui_font_family: default_ui_font_family(),
            code_font_family: default_code_font_family(),
            code_font_size: default_code_font_size(),
            notification_sounds_enabled: true,
            notification_sound_id: default_notification_sound_id(),
            notification_sound_custom_path: default_notification_sound_custom_path(),
            system_notification_enabled: true,
            email_sender: EmailSenderSettings::default(),
            email_inbound: EmailInboundSettings::default(),
            wechat_channel: WechatChannelSettings::default(),
            preload_git_diffs: default_preload_git_diffs(),
            detached_external_change_awareness_enabled:
                default_detached_external_change_awareness_enabled(),
            detached_external_change_watcher_enabled:
                default_detached_external_change_watcher_enabled(),
            experimental_collab_enabled: false,
            experimental_collaboration_modes_enabled: false,
            codex_mode_enforcement_enabled: true,
            experimental_steer_enabled: false,
            codex_unified_exec_policy: CodexUnifiedExecPolicy::Inherit,
            experimental_unified_exec_enabled: None,
            chat_canvas_use_normalized_realtime: false,
            chat_canvas_use_unified_history_loader: false,
            chat_canvas_use_presentation_profile: false,
            dictation_enabled: false,
            dictation_model_id: default_dictation_model_id(),
            dictation_preferred_language: None,
            dictation_hold_key: default_dictation_hold_key(),
            composer_editor_preset: default_composer_editor_preset(),
            composer_send_shortcut: default_composer_send_shortcut(),
            composer_fence_expand_on_space: default_composer_fence_expand_on_space(),
            composer_fence_expand_on_enter: default_composer_fence_expand_on_enter(),
            composer_fence_language_tags: default_composer_fence_language_tags(),
            composer_fence_wrap_selection: default_composer_fence_wrap_selection(),
            composer_fence_auto_wrap_paste_multiline:
                default_composer_fence_auto_wrap_paste_multiline(),
            composer_fence_auto_wrap_paste_code_like:
                default_composer_fence_auto_wrap_paste_code_like(),
            composer_list_continuation: default_composer_list_continuation(),
            composer_code_block_copy_use_modifier: default_composer_code_block_copy_use_modifier(),
            workspace_groups: default_workspace_groups(),
            open_app_targets: default_open_app_targets(),
            selected_open_app_id: default_selected_open_app_id(),
            runtime_restore_threads_only_on_launch: default_runtime_restore_threads_only_on_launch(
            ),
            runtime_force_cleanup_on_exit: default_runtime_force_cleanup_on_exit(),
            runtime_orphan_sweep_on_launch: default_runtime_orphan_sweep_on_launch(),
            codex_max_hot_runtimes: default_codex_max_hot_runtimes(),
            codex_max_warm_runtimes: default_codex_max_warm_runtimes(),
            codex_warm_ttl_seconds: default_codex_warm_ttl_seconds(),
            codex_auto_compaction_threshold_percent:
                default_codex_auto_compaction_threshold_percent(),
            codex_auto_compaction_enabled: default_codex_auto_compaction_enabled(),
            browser_agent_enabled: default_browser_agent_enabled(),
            browser_agent_prefer_built_in: default_browser_agent_prefer_built_in(),
            browser_agent_allow_external_provider_fallback:
                default_browser_agent_allow_external_provider_fallback(),
            enabled_curated_skill_ids: default_enabled_curated_skill_ids(),
            curated_skill_defaults_version: default_curated_skill_defaults_version(),
            enabled_builtin_agent_ids: default_enabled_builtin_agent_ids(),
        }
    }
}

// ==================== Vendor/Provider Types ====================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderConfig {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) remark: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) website_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) created_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) sort_order: Option<i64>,
    #[serde(default)]
    pub(crate) is_active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) is_local_provider: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) settings_config: Option<serde_json::Value>,
    /// Provider-owned custom models (symmetric with CodexProviderConfig).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) custom_models: Option<Vec<CodexCustomModel>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexCustomModel {
    pub(crate) id: String,
    pub(crate) label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexProviderConfig {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) remark: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) created_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) sort_order: Option<i64>,
    #[serde(default)]
    pub(crate) is_active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) config_toml: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) auth_json: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) custom_models: Option<Vec<CodexCustomModel>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KimiProviderConfig {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) remark: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) website_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) created_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) sort_order: Option<i64>,
    #[serde(default)]
    pub(crate) is_active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) is_local_provider: Option<bool>,
    #[serde(default)]
    pub(crate) base_url: String,
    #[serde(default)]
    pub(crate) api_key: String,
    #[serde(default)]
    pub(crate) model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) max_context_size: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) display_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GrokProviderConfig {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) remark: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) website_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) created_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) sort_order: Option<i64>,
    #[serde(default)]
    pub(crate) is_active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) is_local_provider: Option<bool>,
    #[serde(default)]
    pub(crate) base_url: String,
    #[serde(default)]
    pub(crate) api_key: String,
    #[serde(default)]
    pub(crate) model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) provider_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) max_context_size: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) display_name: Option<String>,
    /// API/wire backend: "chat_completions" | "responses" | "messages".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) api_backend: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenCodeProviderConfig {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) remark: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) website_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) created_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) sort_order: Option<i64>,
    #[serde(default)]
    pub(crate) is_active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) is_local_provider: Option<bool>,
    #[serde(default)]
    pub(crate) base_url: String,
    #[serde(default)]
    pub(crate) api_key: String,
    /// Model ids exposed by this provider (e.g. `provider/model` slugs).
    #[serde(default)]
    pub(crate) models: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::{
        AppSettings, BackendMode, EmailSenderProvider, EmailSenderSecurity, GitFileStatus,
        WorkspaceEntry, WorkspaceGroup, WorkspaceKind, WorkspaceSessionAttributionMode,
        WorkspaceSettings,
    };

    #[test]
    fn git_file_status_serializes_optional_rename_source_as_old_path() {
        let renamed = GitFileStatus {
            path: "archive/spec.md".to_string(),
            old_path: Some("changes/spec.md".to_string()),
            status: "R".to_string(),
            additions: 0,
            deletions: 0,
        };
        let renamed_json = serde_json::to_value(renamed).expect("serialize rename status");
        assert_eq!(renamed_json["path"], "archive/spec.md");
        assert_eq!(renamed_json["oldPath"], "changes/spec.md");

        let modified = GitFileStatus {
            path: "src/app.ts".to_string(),
            old_path: None,
            status: "M".to_string(),
            additions: 1,
            deletions: 0,
        };
        let modified_json = serde_json::to_value(modified).expect("serialize modified status");
        assert!(modified_json.get("oldPath").is_none());
    }

    #[test]
    fn app_settings_round_trips_last_composer_prefs_by_engine() {
        let raw = r#"{
            "lastComposerPrefsByEngine": {
                "claude": {
                    "modelId": "claude-opus-4-8",
                    "effort": null,
                    "accessMode": "full-access",
                    "collaborationModeId": "code"
                }
            }
        }"#;
        let settings: AppSettings = serde_json::from_str(raw).expect("settings deserialize");
        let prefs = settings
            .last_composer_prefs_by_engine
            .as_ref()
            .expect("prefs preserved");
        assert_eq!(
            prefs["claude"]["accessMode"],
            serde_json::Value::String("full-access".to_string())
        );

        let echoed = serde_json::to_string(&settings).expect("settings serialize");
        let reparsed: AppSettings = serde_json::from_str(&echoed).expect("echo deserialize");
        assert_eq!(
            reparsed.last_composer_prefs_by_engine,
            settings.last_composer_prefs_by_engine
        );
    }

    #[test]
    fn app_settings_round_trips_all_frontend_shortcut_fields() {
        let shortcut_payload = serde_json::json!({
            "openSettingsShortcut": "cmd+alt+,",
            "newWindowShortcut": "cmd+alt+w",
            "openChatShortcut": "cmd+alt+j",
            "openKanbanShortcut": "cmd+alt+k",
            "cycleOpenSessionPrevShortcut": "cmd+alt+left",
            "cycleOpenSessionNextShortcut": "cmd+alt+right",
            "toggleLeftConversationSidebarShortcut": "cmd+ctrl+[",
            "toggleRightConversationSidebarShortcut": "cmd+ctrl+]",
            "toggleRuntimeConsoleShortcut": "cmd+alt+`",
            "toggleFilesSurfaceShortcut": "cmd+alt+e",
            "saveFileShortcut": "cmd+alt+s",
            "findInFileShortcut": "cmd+alt+f",
            "expandSelectionShortcut": "ctrl+alt+w",
            "toggleGitDiffListViewShortcut": "cmd+alt+v",
            "toggleGitGraphShortcut": "cmd+alt+g",
            "openNotesShortcut": null,
            "openIntentCanvasShortcut": "cmd+alt+i",
            "openRadarShortcut": "cmd+alt+r",
            "openProjectMapShortcut": "cmd+alt+m",
            "openBrowserDockShortcut": "cmd+alt+b",
            "openFileCompareShortcut": "cmd+alt+c",
            "increaseUiScaleShortcut": "cmd+alt+=",
            "decreaseUiScaleShortcut": "cmd+alt+-",
            "resetUiScaleShortcut": "cmd+alt+0"
        });
        let settings: AppSettings =
            serde_json::from_value(shortcut_payload.clone()).expect("settings deserialize");
        let echoed = serde_json::to_value(settings).expect("settings serialize");

        for (key, expected) in shortcut_payload
            .as_object()
            .expect("shortcut payload object")
        {
            assert_eq!(echoed.get(key), Some(expected), "shortcut field {key}");
        }
    }

    #[test]
    fn app_settings_round_trips_disabled_cli_engines() {
        // 前端 CLI 可见性开关的持久化链路:serde 未知字段默认被丢弃,
        // 此测试锁定 disabledCliEngines 必须完整往返,防止再次静默丢字段。
        let payload = serde_json::json!({
            "disabledCliEngines": ["opencode", "kimi"],
        });
        let settings: AppSettings = serde_json::from_value(payload).expect("settings deserialize");
        assert_eq!(
            settings.disabled_cli_engines,
            vec!["opencode".to_string(), "kimi".to_string()]
        );

        let echoed = serde_json::to_value(settings).expect("settings serialize");
        assert_eq!(
            echoed.get("disabledCliEngines"),
            Some(&serde_json::json!(["opencode", "kimi"]))
        );
    }

    #[test]
    fn app_settings_defaults_from_empty_json() {
        let settings: AppSettings = serde_json::from_str("{}").expect("settings deserialize");
        assert!(settings.codex_bin.is_none());
        assert!(matches!(settings.backend_mode, BackendMode::Local));
        assert_eq!(settings.remote_backend_host, "127.0.0.1:4732");
        assert!(settings.remote_backend_token.is_none());
        assert_eq!(settings.web_service_port, 3080);
        assert!(settings.web_service_token.is_none());
        assert!(settings.custom_skill_directories.is_empty());
        assert!(!settings.system_proxy_enabled);
        assert!(!settings.gemini_enabled);
        assert!(settings.opencode_enabled);
        assert_eq!(
            settings.disabled_cli_engines,
            vec!["grok".to_string(), "opencode".to_string()]
        );
        assert_eq!(
            settings.session_attribution_mode,
            WorkspaceSessionAttributionMode::Related
        );
        assert!(settings.system_proxy_url.is_none());
        assert_eq!(settings.default_access_mode, "full-access");
        assert_eq!(
            settings.composer_model_shortcut.as_deref(),
            Some("cmd+shift+m")
        );
        assert_eq!(
            settings.composer_access_shortcut.as_deref(),
            Some("cmd+shift+a")
        );
        assert_eq!(
            settings.composer_reasoning_shortcut.as_deref(),
            Some("cmd+shift+r")
        );
        assert_eq!(
            settings.composer_collaboration_shortcut.as_deref(),
            Some("shift+tab")
        );
        let expected_interrupt = if cfg!(target_os = "macos") {
            "ctrl+c"
        } else {
            "ctrl+shift+c"
        };
        assert_eq!(
            settings.interrupt_shortcut.as_deref(),
            Some(expected_interrupt)
        );
        assert_eq!(
            settings.archive_thread_shortcut.as_deref(),
            Some("cmd+ctrl+a")
        );
        assert_eq!(
            settings.close_current_session_shortcut.as_deref(),
            Some("cmd+w")
        );
        assert_eq!(settings.expand_selection_shortcut.as_deref(), Some("cmd+w"));
        assert_eq!(
            settings.toggle_debug_panel_shortcut.as_deref(),
            Some("cmd+shift+d")
        );
        assert_eq!(
            settings.toggle_terminal_shortcut.as_deref(),
            Some("cmd+shift+t")
        );
        assert_eq!(
            settings.toggle_global_search_shortcut.as_deref(),
            Some("cmd+o")
        );
        assert_eq!(
            settings.cycle_agent_next_shortcut.as_deref(),
            Some("cmd+ctrl+down")
        );
        assert_eq!(
            settings.cycle_agent_prev_shortcut.as_deref(),
            Some("cmd+ctrl+up")
        );
        assert_eq!(
            settings.cycle_workspace_next_shortcut.as_deref(),
            Some("cmd+shift+down")
        );
        assert_eq!(
            settings.cycle_workspace_prev_shortcut.as_deref(),
            Some("cmd+shift+up")
        );
        assert!(settings.last_composer_model_id.is_none());
        assert!(settings.last_composer_reasoning_effort.is_none());
        assert!((settings.ui_scale - 1.0).abs() < f64::EPSILON);
        assert_eq!(settings.theme, "system");
        assert_eq!(settings.light_theme_preset_id, "vscode-light-modern");
        assert_eq!(settings.dark_theme_preset_id, "vscode-dark-modern");
        assert_eq!(settings.custom_theme_preset_id, "vscode-dark-modern");
        assert!(settings.user_msg_color.is_empty());
        assert!(!settings.usage_show_remaining);
        assert!(settings.show_message_anchors);
        assert!(!settings.show_sidebar_provider_labels);
        assert!(!settings.performance_compatibility_mode_enabled);
        assert_eq!(settings.canvas_width_mode, "narrow");
        assert_eq!(settings.layout_mode, "default");
        assert!(settings.ui_font_family.starts_with("Monaco"));
        assert!(settings.code_font_family.starts_with("Monaco"));
        assert_eq!(settings.code_font_size, 11);
        assert!(settings.notification_sounds_enabled);
        assert_eq!(settings.notification_sound_id, "default");
        assert!(settings.notification_sound_custom_path.is_empty());
        assert!(settings.system_notification_enabled);
        assert!(!settings.email_sender.enabled);
        assert_eq!(settings.email_sender.provider, EmailSenderProvider::Custom);
        assert!(settings.email_sender.sender_email.is_empty());
        assert!(settings.email_sender.sender_name.is_empty());
        assert!(settings.email_sender.smtp_host.is_empty());
        assert_eq!(settings.email_sender.smtp_port, 465);
        assert_eq!(settings.email_sender.security, EmailSenderSecurity::SslTls);
        assert!(settings.email_sender.username.is_empty());
        assert!(settings.email_sender.recipient_email.is_empty());
        assert!(settings.preload_git_diffs);
        assert!(settings.detached_external_change_awareness_enabled);
        assert!(settings.detached_external_change_watcher_enabled);
        assert!(!settings.experimental_steer_enabled);
        assert!(settings.codex_mode_enforcement_enabled);
        assert!(!settings.chat_canvas_use_normalized_realtime);
        assert!(!settings.chat_canvas_use_unified_history_loader);
        assert!(!settings.chat_canvas_use_presentation_profile);
        assert!(!settings.dictation_enabled);
        assert_eq!(settings.dictation_model_id, "base");
        assert!(settings.dictation_preferred_language.is_none());
        assert_eq!(settings.dictation_hold_key, "alt");
        assert_eq!(settings.composer_editor_preset, "default");
        assert_eq!(settings.composer_send_shortcut, "enter");
        assert!(!settings.composer_fence_expand_on_space);
        assert!(!settings.composer_fence_expand_on_enter);
        assert!(!settings.composer_fence_language_tags);
        assert!(!settings.composer_fence_wrap_selection);
        assert!(!settings.composer_fence_auto_wrap_paste_multiline);
        assert!(!settings.composer_fence_auto_wrap_paste_code_like);
        assert!(!settings.composer_list_continuation);
        assert!(!settings.composer_code_block_copy_use_modifier);
        assert!(settings.workspace_groups.is_empty());
        assert_eq!(settings.selected_open_app_id, "vscode");
        assert_eq!(settings.open_app_targets.len(), 6);
        assert_eq!(settings.open_app_targets[0].id, "vscode");
        assert!(settings.codex_auto_compaction_enabled);
    }

    #[test]
    fn workspace_group_defaults_from_minimal_json() {
        let group: WorkspaceGroup =
            serde_json::from_str(r#"{"id":"g1","name":"Group"}"#).expect("group deserialize");
        assert!(group.sort_order.is_none());
        assert!(group.copies_folder.is_none());
    }

    #[test]
    fn app_settings_round_trip_preserves_workspace_group_copies_folder() {
        let mut settings = AppSettings::default();
        settings.workspace_groups = vec![WorkspaceGroup {
            id: "g1".to_string(),
            name: "Group".to_string(),
            sort_order: Some(2),
            copies_folder: Some("/tmp/group-copies".to_string()),
        }];

        let json = serde_json::to_string(&settings).expect("serialize settings");
        let decoded: AppSettings = serde_json::from_str(&json).expect("deserialize settings");
        assert_eq!(decoded.workspace_groups.len(), 1);
        assert_eq!(
            decoded.workspace_groups[0].copies_folder.as_deref(),
            Some("/tmp/group-copies")
        );
    }

    #[test]
    fn app_settings_round_trip_preserves_session_attribution_mode() {
        let mut settings = AppSettings::default();
        settings.session_attribution_mode = WorkspaceSessionAttributionMode::WorkspaceOnly;

        let json = serde_json::to_string(&settings).expect("serialize settings");
        assert!(json.contains(r#""sessionAttributionMode":"workspace-only""#));
        let decoded: AppSettings = serde_json::from_str(&json).expect("deserialize settings");

        assert_eq!(
            decoded.session_attribution_mode,
            WorkspaceSessionAttributionMode::WorkspaceOnly
        );
    }

    #[test]
    fn app_settings_defaults_invalid_session_attribution_mode_to_related() {
        let decoded: AppSettings = serde_json::from_str(r#"{"sessionAttributionMode":"invalid"}"#)
            .expect("deserialize settings");

        assert_eq!(
            decoded.session_attribution_mode,
            WorkspaceSessionAttributionMode::Related
        );

        let decoded: AppSettings = serde_json::from_str(r#"{"sessionAttributionMode":123}"#)
            .expect("deserialize settings");

        assert_eq!(
            decoded.session_attribution_mode,
            WorkspaceSessionAttributionMode::Related
        );
    }

    #[test]
    fn app_settings_sanitize_runtime_pool_settings_clamps_budget_fields() {
        let mut settings = AppSettings::default();
        settings.codex_max_hot_runtimes = 200;
        settings.codex_max_warm_runtimes = 99;
        settings.codex_warm_ttl_seconds = 20_000;
        settings.codex_auto_compaction_threshold_percent = 93;

        settings.sanitize_runtime_pool_settings();

        assert_eq!(settings.codex_max_hot_runtimes, 8);
        assert_eq!(settings.codex_max_warm_runtimes, 16);
        assert_eq!(settings.codex_warm_ttl_seconds, 14_400);
        assert_eq!(settings.codex_auto_compaction_threshold_percent, 92);
    }

    #[test]
    fn app_settings_sanitize_runtime_pool_settings_keeps_allowed_compaction_thresholds() {
        for threshold in [92, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200] {
            let mut settings = AppSettings::default();
            settings.codex_auto_compaction_threshold_percent = threshold;

            settings.sanitize_runtime_pool_settings();

            assert_eq!(settings.codex_auto_compaction_threshold_percent, threshold);
        }
    }

    #[test]
    fn app_settings_defaults_disable_retired_optional_engines() {
        let settings = AppSettings::default();
        assert!(!settings.gemini_enabled);
        // OpenCode is an always-enabled engine again; the legacy flag defaults to true
        // and no longer gates runtime policy.
        assert!(settings.opencode_enabled);
    }

    #[test]
    fn app_settings_sanitizer_forces_legacy_gemini_true_to_false() {
        let mut settings: AppSettings =
            serde_json::from_str(r#"{"geminiEnabled":true,"defaultEngine":"gemini"}"#)
                .expect("deserialize legacy settings");
        assert!(settings.gemini_enabled);
        assert_eq!(settings.default_engine.as_deref(), Some("gemini"));

        settings.sanitize_engine_gates();

        assert!(!settings.gemini_enabled);
        assert!(settings.default_engine.is_none());
    }

    #[test]
    fn app_settings_sanitizer_preserves_legacy_opencode_values() {
        let mut settings: AppSettings =
            serde_json::from_str(r#"{"opencodeEnabled":true,"defaultEngine":"opencode"}"#)
                .expect("deserialize legacy settings");
        assert!(settings.opencode_enabled);
        assert_eq!(settings.default_engine.as_deref(), Some("opencode"));

        settings.sanitize_engine_gates();

        // OpenCode is always enabled at runtime; the sanitizer must not clear
        // the legacy flag or a persisted opencode default engine.
        assert!(settings.opencode_enabled);
        assert_eq!(settings.default_engine.as_deref(), Some("opencode"));
    }

    #[test]
    fn app_settings_defaults_enable_core_curated_skills() {
        let settings = AppSettings::default();
        assert_eq!(
            settings.enabled_curated_skill_ids,
            vec!["lazy-senior-dev".to_string(), "caveman".to_string()]
        );

        let decoded: AppSettings = serde_json::from_str("{}").expect("deserialize settings");
        assert_eq!(
            decoded.enabled_curated_skill_ids,
            vec!["lazy-senior-dev".to_string(), "caveman".to_string()]
        );
    }

    #[test]
    fn app_settings_preserves_explicitly_empty_curated_skill_ids() {
        let decoded: AppSettings =
            serde_json::from_str(r#"{"enabledCuratedSkillIds":[]}"#).expect("deserialize settings");

        assert!(decoded.enabled_curated_skill_ids.is_empty());
    }

    #[test]
    fn app_settings_upgrade_runtime_pool_settings_for_startup_raises_legacy_warm_ttl() {
        let mut settings = AppSettings::default();
        settings.codex_warm_ttl_seconds = 300;

        settings.upgrade_runtime_pool_settings_for_startup();

        assert_eq!(settings.codex_warm_ttl_seconds, 7200);
    }

    #[test]
    fn workspace_entry_defaults_from_minimal_json() {
        let entry: WorkspaceEntry =
            serde_json::from_str(r#"{"id":"1","name":"Test","path":"/tmp","codexBin":null}"#)
                .expect("workspace deserialize");
        assert!(matches!(entry.kind, WorkspaceKind::Main));
        assert!(entry.parent_id.is_none());
        assert!(entry.worktree.is_none());
        assert!(entry.settings.sort_order.is_none());
        assert!(entry.settings.group_id.is_none());
    }

    #[test]
    fn workspace_settings_defaults() {
        let settings = WorkspaceSettings::default();
        assert!(!settings.sidebar_collapsed);
        assert!(settings.sort_order.is_none());
        assert!(settings.group_id.is_none());
        assert!(settings.git_root.is_none());
    }
}
