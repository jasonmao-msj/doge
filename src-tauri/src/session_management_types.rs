use std::collections::HashMap;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};

use crate::types::WorkspaceSessionAttributionMode;

pub(crate) const SESSION_CATALOG_DEFAULT_LIMIT: usize = 50;
pub(crate) const SESSION_CATALOG_MAX_LIMIT: usize = 9_999;
pub(crate) const SESSION_CATALOG_SCAN_LOOKAHEAD: usize = 1;
pub(crate) const SESSION_CATALOG_ARCHIVE_TIMEOUT_MS: u64 = 1_500;
pub(crate) const SESSION_CATALOG_CURSOR_PREFIX: &str = "offset:";
pub(crate) const SESSION_CATALOG_STABLE_CURSOR_PREFIX: &str = "stable:";
pub(crate) const SESSION_CATALOG_PARTIAL_CODEX: &str = "codex-history-unavailable";
pub(crate) const SESSION_CATALOG_PARTIAL_CLAUDE: &str = "claude-history-unavailable";
pub(crate) const SESSION_CATALOG_PARTIAL_CLAUDE_UNCERTAIN_EMPTY: &str = "claude-uncertain-empty";
pub(crate) const SESSION_CATALOG_PARTIAL_GEMINI: &str = "gemini-history-unavailable";
pub(crate) const SESSION_CATALOG_PARTIAL_GROK: &str = "grok-history-unavailable";
pub(crate) const SESSION_CATALOG_PARTIAL_KIMI: &str = "kimi-history-unavailable";
pub(crate) const SESSION_CATALOG_PARTIAL_OPENCODE: &str = "opencode-history-unavailable";
pub(crate) const SESSION_CATALOG_PARTIAL_SHARED: &str = "shared-history-unavailable";
pub(crate) const SESSION_CATALOG_PARTIAL_ARCHIVE_METADATA: &str = "archive-metadata-unavailable";
pub(crate) const SESSION_CATALOG_UNASSIGNED_WORKSPACE_ID: &str = "__global_unassigned__";
pub(crate) const SESSION_FOLDER_ROOT_ID: &str = "__root__";
pub(crate) const SESSION_FOLDER_SYSTEM_AUTO_ID: &str = "__system_auto__";
pub(crate) const SESSION_INCONSISTENCY_MISSING_ON_DISK: &str = "missing-on-disk";
pub(crate) const SESSION_DELETE_MODE_PHYSICAL: &str = "physical";
pub(crate) const SESSION_DELETE_MODE_METADATA_CLEANUP: &str = "metadata-cleanup";
pub(crate) const SESSION_DELETE_MODE_UNSUPPORTED: &str = "unsupported";
pub(crate) const SESSION_DELETE_CODE_DELETED: &str = "DELETED";
pub(crate) const SESSION_DELETE_CODE_ALREADY_MISSING_CLEANED: &str = "ALREADY_MISSING_CLEANED";
pub(crate) const SESSION_DELETE_CODE_DELETE_FAILED: &str = "DELETE_FAILED";
pub(crate) const SESSION_DELETE_CODE_UNSUPPORTED: &str = "UNSUPPORTED";
pub(crate) const SESSION_ASSIGN_CODE_FOLDER_ASSIGNED: &str = "FOLDER_ASSIGNED";

impl WorkspaceSessionAttributionMode {
    pub(crate) fn from_query(query: &WorkspaceSessionCatalogQuery) -> Self {
        query.session_attribution_mode.unwrap_or_default()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionCatalogEntry {
    pub(crate) session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) stable_session_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) canonical_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) parent_session_id: Option<String>,
    pub(crate) workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) workspace_label: Option<String>,
    pub(crate) engine: String,
    pub(crate) title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) native_title: Option<String>,
    pub(crate) updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) archived_at: Option<i64>,
    pub(crate) thread_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) source_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) provider_profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) provider_profile_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) provider_profile_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) provider_availability: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) source_completeness: Option<WorkspaceSessionSourceCompleteness>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) source_status_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) attribution_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) attribution_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) attribution_confidence: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) matched_workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) matched_workspace_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) auto_session: Option<AutoSessionMetadata>,
    #[serde(default)]
    pub(crate) exists_on_disk: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) inconsistency_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) delete_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) physical_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) children_count: Option<usize>,
    #[serde(flatten)]
    pub(crate) continuation: ProviderContinuationProjection,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderContinuationProjection {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) origin_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) source_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) source_provider_profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) family_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) family_root_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) lineage_parent_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) lineage_kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) lineage_depth: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) model_catalog_entry_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderContinuationMetadata {
    pub(crate) origin_kind: String,
    pub(crate) source_session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) source_provider_profile_id: Option<String>,
    pub(crate) family_id: String,
    pub(crate) family_root_session_id: String,
    pub(crate) lineage_parent_session_id: String,
    pub(crate) lineage_kind: String,
    pub(crate) lineage_depth: u32,
}

impl From<ProviderContinuationMetadata> for ProviderContinuationProjection {
    fn from(metadata: ProviderContinuationMetadata) -> Self {
        Self {
            origin_kind: Some(metadata.origin_kind),
            source_session_id: Some(metadata.source_session_id),
            source_provider_profile_id: metadata.source_provider_profile_id,
            family_id: Some(metadata.family_id),
            family_root_session_id: Some(metadata.family_root_session_id),
            lineage_parent_session_id: Some(metadata.lineage_parent_session_id),
            lineage_kind: Some(metadata.lineage_kind),
            lineage_depth: Some(metadata.lineage_depth),
            model_catalog_entry_id: None,
            model: None,
            reasoning_effort: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EngineProviderBinding {
    pub(crate) provider_profile_id: String,
    pub(crate) provider_profile_source: String,
    pub(crate) provider_profile_name: String,
    pub(crate) provider_availability: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionExecutionTarget {
    pub(crate) model_catalog_entry_id: String,
    pub(crate) model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reasoning_effort: Option<String>,
}

pub(crate) type CodexProviderBinding = EngineProviderBinding;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum WorkspaceSessionSourceCompleteness {
    Complete,
    AuthoritativeEmpty,
    Partial,
    Degraded,
    UncertainEmpty,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionCatalogSourceStatus {
    pub(crate) engine: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) source_kind: Option<String>,
    pub(crate) completeness: WorkspaceSessionSourceCompleteness,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) scanned_candidates: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) skipped_candidates: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) scan_cap_reached: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) diagnostics: Vec<WorkspaceSessionCatalogDiagnostic>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) cache: Option<WorkspaceSessionSourceCacheMetrics>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionCatalogDiagnostic {
    pub(crate) engine: String,
    pub(crate) code: String,
    pub(crate) reason: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) physical_locator: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) candidate_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionSourceCacheMetrics {
    pub(crate) hits: usize,
    pub(crate) misses: usize,
    pub(crate) stale: usize,
    pub(crate) rebuilds: usize,
    pub(crate) failures: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionCatalogQuery {
    #[serde(default)]
    pub(crate) keyword: Option<String>,
    #[serde(default)]
    pub(crate) engine: Option<String>,
    #[serde(default)]
    pub(crate) status: Option<String>,
    #[serde(default)]
    pub(crate) folder_id: Option<String>,
    #[serde(default)]
    pub(crate) session_attribution_mode: Option<WorkspaceSessionAttributionMode>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionCatalogPage {
    pub(crate) data: Vec<WorkspaceSessionCatalogEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) next_cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) requested_limit: Option<usize>,
    pub(crate) effective_limit: usize,
    #[serde(default)]
    pub(crate) limit_capped: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) partial_source: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) source_statuses: Vec<WorkspaceSessionCatalogSourceStatus>,
    /// Session id aliases for automatic helper sessions with `visibility=hidden`.
    /// Used by sidebar/native list merge to exclude commit-message helpers that
    /// still appear in engine-native history sources without autoSession metadata.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) hidden_automatic_session_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionArchiveEvidence {
    pub(crate) archived_at_by_session_id: HashMap<String, i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) partial_source: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) source_statuses: Vec<WorkspaceSessionCatalogSourceStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionFolder {
    pub(crate) id: String,
    pub(crate) workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) parent_id: Option<String>,
    pub(crate) name: String,
    pub(crate) created_at: i64,
    pub(crate) updated_at: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum AutoSessionVisibility {
    Hidden,
    SystemAuto,
    UserVisible,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum AutoSessionCreatedBy {
    System,
    User,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AutoSessionMetadata {
    pub(crate) session_purpose: String,
    pub(crate) visibility: AutoSessionVisibility,
    pub(crate) owner_feature: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) auto_archive: Option<bool>,
    pub(crate) created_by: AutoSessionCreatedBy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionFolderTree {
    pub(crate) workspace_id: String,
    pub(crate) folders: Vec<WorkspaceSessionFolder>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionFolderMutation {
    pub(crate) folder: WorkspaceSessionFolder,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionAssignmentResponse {
    pub(crate) session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) folder_id: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum WorkspaceSessionProjectionScopeKind {
    Project,
    Worktree,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionProjectionSummary {
    pub(crate) scope_kind: WorkspaceSessionProjectionScopeKind,
    pub(crate) owner_workspace_ids: Vec<String>,
    pub(crate) active_total: usize,
    pub(crate) archived_total: usize,
    pub(crate) all_total: usize,
    pub(crate) filtered_total: usize,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub(crate) folder_counts_by_id: HashMap<String, usize>,
    #[serde(default)]
    pub(crate) unassigned_folder_count: usize,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) partial_sources: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) source_statuses: Vec<WorkspaceSessionCatalogSourceStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionBatchMutationResult {
    pub(crate) session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) stable_session_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) owner_workspace_id: Option<String>,
    pub(crate) ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) archived_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) deleted_from_disk: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) metadata_cleaned: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionBatchMutationResponse {
    pub(crate) results: Vec<WorkspaceSessionBatchMutationResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceSessionCatalogMetadata {
    #[serde(default)]
    pub(crate) archived_at_by_session_id: HashMap<String, i64>,
    #[serde(default)]
    pub(crate) folders: Vec<WorkspaceSessionFolder>,
    #[serde(default)]
    pub(crate) folder_id_by_session_id: HashMap<String, String>,
    #[serde(default)]
    pub(crate) auto_session_by_session_id: HashMap<String, AutoSessionMetadata>,
    #[serde(default)]
    pub(crate) codex_provider_binding_by_session_id: HashMap<String, CodexProviderBinding>,
    #[serde(default)]
    pub(crate) engine_provider_binding_by_session_key: HashMap<String, EngineProviderBinding>,
    #[serde(default)]
    pub(crate) execution_target_by_session_key: HashMap<String, SessionExecutionTarget>,
    #[serde(default)]
    pub(crate) provider_continuation_by_session_key: HashMap<String, ProviderContinuationMetadata>,
}

#[derive(Debug, Clone)]
pub(crate) struct WorkspaceScopeCatalogData {
    pub(crate) scope_kind: WorkspaceSessionProjectionScopeKind,
    pub(crate) owner_workspace_ids: Vec<String>,
    pub(crate) entries: Vec<WorkspaceSessionCatalogEntry>,
    pub(crate) partial_sources: Vec<String>,
    pub(crate) source_statuses: Vec<WorkspaceSessionCatalogSourceStatus>,
    pub(crate) hidden_automatic_session_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum SessionCatalogScanMode {
    Bounded(usize),
    Exhaustive,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionCatalogStableCursor {
    pub(crate) version: u8,
    pub(crate) updated_at: i64,
    pub(crate) session_id: String,
    pub(crate) workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) stable_session_key: Option<String>,
    pub(crate) query_fingerprint: String,
    pub(crate) offset_hint: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SessionCatalogCursor {
    LegacyOffset(usize),
    Stable(SessionCatalogStableCursor),
}

impl SessionCatalogScanMode {
    pub(crate) fn limit(self) -> usize {
        match self {
            SessionCatalogScanMode::Bounded(limit) => limit,
            SessionCatalogScanMode::Exhaustive => usize::MAX,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SessionCatalogCountSummary {
    pub(crate) active_total: usize,
    pub(crate) archived_total: usize,
    pub(crate) all_total: usize,
    pub(crate) filtered_total: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SessionCatalogStatusFilter {
    Active,
    Archived,
    All,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SessionCatalogAttributionStatus {
    StrictMatch,
    InferredRelated,
    Unassigned,
}

impl SessionCatalogAttributionStatus {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            SessionCatalogAttributionStatus::StrictMatch => "strict-match",
            SessionCatalogAttributionStatus::InferredRelated => "inferred-related",
            SessionCatalogAttributionStatus::Unassigned => "unassigned",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SessionCatalogAttributionReason {
    CwdExact,
    CwdLongest,
    ProjectDirDirect,
    GitRootInferred,
    SharedWorktreeFamily,
    SharedGitRoot,
    ParentScope,
    AmbiguousSibling,
    CwdProjectConflict,
    SourceIncomplete,
}

impl SessionCatalogAttributionReason {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            SessionCatalogAttributionReason::CwdExact => "cwd-exact",
            SessionCatalogAttributionReason::CwdLongest => "cwd-longest",
            SessionCatalogAttributionReason::ProjectDirDirect => "project-dir-direct",
            SessionCatalogAttributionReason::GitRootInferred => "git-root-inferred",
            SessionCatalogAttributionReason::SharedWorktreeFamily => "shared-worktree-family",
            SessionCatalogAttributionReason::SharedGitRoot => "shared-git-root",
            SessionCatalogAttributionReason::ParentScope => "parent-scope",
            SessionCatalogAttributionReason::AmbiguousSibling => "ambiguous-sibling",
            SessionCatalogAttributionReason::CwdProjectConflict => "cwd-project-conflict",
            SessionCatalogAttributionReason::SourceIncomplete => "source-incomplete",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SessionCatalogAttributionConfidence {
    High,
    Medium,
    Low,
}

impl SessionCatalogAttributionConfidence {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            SessionCatalogAttributionConfidence::High => "high",
            SessionCatalogAttributionConfidence::Medium => "medium",
            SessionCatalogAttributionConfidence::Low => "low",
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct SessionCatalogAttribution {
    pub(crate) status: SessionCatalogAttributionStatus,
    pub(crate) reason: Option<SessionCatalogAttributionReason>,
    pub(crate) confidence: Option<SessionCatalogAttributionConfidence>,
    pub(crate) matched_workspace_id: Option<String>,
    pub(crate) matched_workspace_label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SessionCatalogIdentity {
    Codex { session_id: String },
    Claude { session_id: String },
    Gemini { session_id: String },
    Grok { session_id: String },
    Kimi { session_id: String },
    OpenCode { session_id: String },
    Shared { session_id: String },
}

impl SessionCatalogIdentity {
    pub(crate) fn engine_name(&self) -> &'static str {
        match self {
            Self::Codex { .. } => "codex",
            Self::Claude { .. } => "claude",
            Self::Gemini { .. } => "gemini",
            Self::Grok { .. } => "grok",
            Self::Kimi { .. } => "kimi",
            Self::OpenCode { .. } => "opencode",
            Self::Shared { .. } => "shared",
        }
    }

    pub(crate) fn raw_session_id(&self) -> &str {
        match self {
            Self::Codex { session_id }
            | Self::Claude { session_id }
            | Self::Gemini { session_id }
            | Self::Grok { session_id }
            | Self::Kimi { session_id }
            | Self::OpenCode { session_id }
            | Self::Shared { session_id } => session_id,
        }
    }
}

pub(crate) fn parse_catalog_identity(session_id: &str) -> SessionCatalogIdentity {
    if let Some(raw_id) = session_id.strip_prefix("claude:") {
        return SessionCatalogIdentity::Claude {
            session_id: raw_id.to_string(),
        };
    }
    if let Some(raw_id) = session_id.strip_prefix("gemini:") {
        return SessionCatalogIdentity::Gemini {
            session_id: raw_id.to_string(),
        };
    }
    if let Some(raw_id) = session_id.strip_prefix("grok:") {
        return SessionCatalogIdentity::Grok {
            session_id: raw_id.to_string(),
        };
    }
    if let Some(raw_id) = session_id.strip_prefix("kimi:") {
        return SessionCatalogIdentity::Kimi {
            session_id: raw_id.to_string(),
        };
    }
    if let Some(raw_id) = session_id.strip_prefix("opencode:") {
        return SessionCatalogIdentity::OpenCode {
            session_id: raw_id.to_string(),
        };
    }
    if let Some(raw_id) = session_id.strip_prefix("shared:") {
        return SessionCatalogIdentity::Shared {
            session_id: raw_id.to_string(),
        };
    }
    SessionCatalogIdentity::Codex {
        session_id: session_id.to_string(),
    }
}

pub(crate) fn parse_status_filter(value: Option<&str>) -> SessionCatalogStatusFilter {
    match value
        .map(str::trim)
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "archived" => SessionCatalogStatusFilter::Archived,
        "all" => SessionCatalogStatusFilter::All,
        _ => SessionCatalogStatusFilter::Active,
    }
}

fn normalize_cursor_query_component(value: Option<&str>, lowercase: bool) -> Option<String> {
    let trimmed = value.map(str::trim).filter(|value| !value.is_empty())?;
    if lowercase {
        Some(trimmed.to_ascii_lowercase())
    } else {
        Some(trimmed.to_string())
    }
}

pub(crate) fn catalog_query_fingerprint(query: &WorkspaceSessionCatalogQuery) -> String {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct CursorQueryFingerprint {
        keyword: Option<String>,
        engine: Option<String>,
        status: String,
        folder_id: Option<String>,
        session_attribution_mode: String,
    }

    let status = match parse_status_filter(query.status.as_deref()) {
        SessionCatalogStatusFilter::Active => "active",
        SessionCatalogStatusFilter::Archived => "archived",
        SessionCatalogStatusFilter::All => "all",
    }
    .to_string();
    let folder_id = normalize_cursor_query_component(query.folder_id.as_deref(), false)
        .filter(|value| value != "__all__");
    let payload = CursorQueryFingerprint {
        keyword: normalize_cursor_query_component(query.keyword.as_deref(), true),
        engine: normalize_cursor_query_component(query.engine.as_deref(), true),
        status,
        folder_id,
        session_attribution_mode: WorkspaceSessionAttributionMode::from_query(query)
            .as_str()
            .to_string(),
    };
    serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string())
}

pub(crate) fn parse_catalog_cursor_state(cursor: Option<&str>) -> SessionCatalogCursor {
    let Some(raw_cursor) = cursor.map(str::trim).filter(|value| !value.is_empty()) else {
        return SessionCatalogCursor::LegacyOffset(0);
    };
    if let Some(raw_offset) = raw_cursor.strip_prefix(SESSION_CATALOG_CURSOR_PREFIX) {
        return SessionCatalogCursor::LegacyOffset(raw_offset.parse::<usize>().unwrap_or(0));
    }
    if let Some(raw_payload) = raw_cursor.strip_prefix(SESSION_CATALOG_STABLE_CURSOR_PREFIX) {
        let decoded = URL_SAFE_NO_PAD.decode(raw_payload.as_bytes());
        if let Ok(bytes) = decoded {
            if let Ok(payload) = serde_json::from_slice::<SessionCatalogStableCursor>(&bytes) {
                if payload.version == 1 {
                    return SessionCatalogCursor::Stable(payload);
                }
            }
        }
        return SessionCatalogCursor::LegacyOffset(0);
    }
    SessionCatalogCursor::LegacyOffset(raw_cursor.parse::<usize>().unwrap_or(0))
}

pub(crate) fn parse_catalog_cursor(cursor: Option<&str>) -> usize {
    match parse_catalog_cursor_state(cursor) {
        SessionCatalogCursor::LegacyOffset(offset) => offset,
        SessionCatalogCursor::Stable(payload) => payload.offset_hint,
    }
}

pub(crate) fn build_catalog_cursor(offset: usize) -> String {
    format!("{SESSION_CATALOG_CURSOR_PREFIX}{offset}")
}

pub(crate) fn build_catalog_stable_cursor(
    entry: &WorkspaceSessionCatalogEntry,
    query: &WorkspaceSessionCatalogQuery,
    offset_hint: usize,
) -> String {
    let payload = SessionCatalogStableCursor {
        version: 1,
        updated_at: entry.updated_at,
        session_id: entry.session_id.clone(),
        workspace_id: entry.workspace_id.clone(),
        stable_session_key: entry.stable_session_key.clone(),
        query_fingerprint: catalog_query_fingerprint(query),
        offset_hint,
    };
    match serde_json::to_vec(&payload) {
        Ok(bytes) => format!(
            "{SESSION_CATALOG_STABLE_CURSOR_PREFIX}{}",
            URL_SAFE_NO_PAD.encode(bytes)
        ),
        Err(_) => build_catalog_cursor(offset_hint),
    }
}

pub(crate) fn normalize_catalog_page_limit(limit: Option<u32>) -> usize {
    limit
        .unwrap_or(SESSION_CATALOG_DEFAULT_LIMIT as u32)
        .clamp(1, SESSION_CATALOG_MAX_LIMIT as u32) as usize
}

pub(crate) fn build_catalog_scan_limit(cursor: Option<&str>, limit: Option<u32>) -> usize {
    parse_catalog_cursor(cursor)
        .saturating_add(normalize_catalog_page_limit(limit))
        .saturating_add(SESSION_CATALOG_SCAN_LOOKAHEAD)
}

pub(crate) fn query_requires_exhaustive_scan(query: &WorkspaceSessionCatalogQuery) -> bool {
    let has_keyword = query
        .keyword
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some();
    if has_keyword {
        return true;
    }
    let has_folder_filter = query
        .folder_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter(|value| *value != "__all__")
        .is_some();
    if has_folder_filter {
        return true;
    }
    matches!(
        parse_status_filter(query.status.as_deref()),
        SessionCatalogStatusFilter::Archived
    )
}

pub(crate) fn build_catalog_scan_mode(
    query: &WorkspaceSessionCatalogQuery,
    cursor: Option<&str>,
    limit: Option<u32>,
) -> SessionCatalogScanMode {
    if query_requires_exhaustive_scan(query) {
        SessionCatalogScanMode::Exhaustive
    } else {
        SessionCatalogScanMode::Bounded(build_catalog_scan_limit(cursor, limit))
    }
}
