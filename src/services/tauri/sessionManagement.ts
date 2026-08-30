import { invoke } from "@tauri-apps/api/core";
import type {
  AutoSessionCreatedBy,
  AutoSessionMetadata,
  AutoSessionVisibility,
  WorkspaceSessionAttributionMode,
} from "../../types";

export interface WorkspaceSessionCatalogEntry {
  sessionId: string;
  stableSessionKey?: string | null;
  canonicalSessionId?: string | null;
  parentSessionId?: string | null;
  workspaceId: string;
  workspaceLabel?: string | null;
  engine: string;
  title: string;
  nativeTitle?: string | null;
  updatedAt: number;
  archivedAt?: number | null;
  threadKind: string;
  source?: string | null;
  sourceLabel?: string | null;
  providerProfileId?: string | null;
  providerProfileSource?: string | null;
  providerProfileName?: string | null;
  providerAvailability?: string | null;
  modelCatalogEntryId?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  sourceCompleteness?: WorkspaceSessionSourceCompleteness | null;
  sourceStatusReason?: string | null;
  sizeBytes?: number | null;
  cwd?: string | null;
  attributionStatus?: "strict-match" | "inferred-related" | "unassigned" | null;
  attributionReason?: string | null;
  attributionConfidence?: "high" | "medium" | null;
  matchedWorkspaceId?: string | null;
  matchedWorkspaceLabel?: string | null;
  folderId?: string | null;
  autoSession?: AutoSessionMetadata | null;
  existsOnDisk?: boolean | null;
  inconsistencyCode?:
    | "missing-on-disk"
    | "owner-unresolved"
    | "metadata-orphaned"
    | "source-degraded"
    | string
    | null;
  deleteMode?: "physical" | "metadata-cleanup" | "unsupported" | string | null;
  physicalPath?: string | null;
  childrenCount?: number | null;
  originKind?: string | null;
  sourceSessionId?: string | null;
  sourceProviderProfileId?: string | null;
  familyId?: string | null;
  familyRootSessionId?: string | null;
  lineageParentSessionId?: string | null;
  lineageKind?: string | null;
  lineageDepth?: number | null;
}

export type NativeHistorySourceInput = {
  sessionId: string;
  nativeSessionId: string;
  engine: "claude" | "codex" | "kimi";
  providerProfileId?: string | null;
};

export type ProviderContinuationTargetInput = {
  engine: "claude" | "codex";
  providerProfileId: string;
  modelCatalogEntryId?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  providerProfileNameSnapshot?: string | null;
  providerProfileSource?: "local" | "managed" | null;
  runtimeCapabilityFingerprint?: string | null;
};

export type NativeProviderContinuationInput = {
  workspaceId: string;
  operationId: string;
  source: NativeHistorySourceInput;
  destination: ProviderContinuationTargetInput;
};

export type NativeProviderContinuationResponse = {
  status:
    | "prepared"
    | "confirmation-required"
    | "ready"
    | "recovery-required"
    | string;
  fidelity: "strong" | "degraded";
  operation: {
    phase: string;
    resultSessionId?: string | null;
    errorCode?: string | null;
  };
  omissions?: Array<{ category?: string; reason?: string }>;
  adapterDroppedEntries?: number;
  projectionMode?: string;
  sourceEstimatedTokens?: number;
  packageEstimatedTokens?: number;
};

export type {
  AutoSessionCreatedBy,
  AutoSessionMetadata,
  AutoSessionVisibility,
};

export type WorkspaceSessionSourceCompleteness =
  | "complete"
  | "authoritative_empty"
  | "partial"
  | "degraded"
  | "uncertain_empty";

export interface WorkspaceSessionCatalogSourceStatus {
  engine: string;
  sourceKind?: string | null;
  completeness: WorkspaceSessionSourceCompleteness;
  reason?: string | null;
  scannedCandidates?: number | null;
  skippedCandidates?: number | null;
  scanCapReached?: boolean | null;
  diagnostics?: WorkspaceSessionCatalogDiagnostic[];
  cache?: WorkspaceSessionSourceCacheMetrics | null;
}

export interface WorkspaceSessionCatalogDiagnostic {
  engine: string;
  code: string;
  reason: string;
  sessionId?: string | null;
  physicalLocator?: string | null;
  cwd?: string | null;
  candidateCount?: number | null;
}

export interface WorkspaceSessionSourceCacheMetrics {
  hits: number;
  misses: number;
  stale: number;
  rebuilds: number;
  failures: number;
}

export interface WorkspaceSessionCatalogQuery {
  keyword?: string | null;
  engine?: string | null;
  status?: "active" | "archived" | "all" | null;
  folderId?: string | null;
  sessionAttributionMode?: WorkspaceSessionAttributionMode | null;
}

export interface WorkspaceSessionCatalogPage {
  data: WorkspaceSessionCatalogEntry[];
  nextCursor?: string | null;
  requestedLimit?: number | null;
  effectiveLimit?: number | null;
  limitCapped?: boolean;
  partialSource?: string | null;
  sourceStatuses?: WorkspaceSessionCatalogSourceStatus[];
  /**
   * Session id aliases for automatic helper sessions with visibility=hidden.
   * Sidebar/native history merge uses this exclusion set so commit-message
   * helpers do not reappear when engine-native lists omit autoSession metadata.
   */
  hiddenAutomaticSessionIds?: string[];
}

export interface WorkspaceSessionArchiveEvidence {
  archivedAtBySessionId: Record<string, number>;
  partialSource?: string | null;
  sourceStatuses?: WorkspaceSessionCatalogSourceStatus[];
}

export interface WorkspaceSessionFolder {
  id: string;
  workspaceId: string;
  parentId?: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceSessionFolderTree {
  workspaceId: string;
  folders: WorkspaceSessionFolder[];
}

export interface WorkspaceSessionFolderMutation {
  folder: WorkspaceSessionFolder;
}

export interface WorkspaceSessionAssignmentResponse {
  sessionId: string;
  folderId?: string | null;
}

export interface WorkspaceSessionProjectionSummary {
  scopeKind: "project" | "worktree";
  ownerWorkspaceIds: string[];
  activeTotal: number;
  archivedTotal: number;
  allTotal: number;
  filteredTotal: number;
  folderCountsById?: Record<string, number>;
  unassignedFolderCount?: number;
  partialSources?: string[];
  sourceStatuses?: WorkspaceSessionCatalogSourceStatus[];
}

export interface WorkspaceSessionBatchMutationResult {
  sessionId: string;
  stableSessionKey?: string | null;
  ownerWorkspaceId?: string | null;
  ok: boolean;
  archivedAt?: number | null;
  error?: string | null;
  code?: string | null;
  deletedFromDisk?: boolean | null;
  metadataCleaned?: boolean | null;
}

export interface WorkspaceSessionBatchMutationResponse {
  results: WorkspaceSessionBatchMutationResult[];
}

export async function listWorkspaceSessions(
  workspaceId: string,
  options?: {
    query?: WorkspaceSessionCatalogQuery | null;
    cursor?: string | null;
    limit?: number | null;
  },
): Promise<WorkspaceSessionCatalogPage> {
  return invoke<WorkspaceSessionCatalogPage>("list_workspace_sessions", {
    workspaceId,
    query: options?.query ?? null,
    cursor: options?.cursor ?? null,
    limit: options?.limit ?? null,
  });
}

export async function recordAutoSessionMetadata(
  workspaceId: string,
  sessionId: string,
  metadata: AutoSessionMetadata,
): Promise<void> {
  return invoke<void>("record_auto_session_metadata", {
    workspaceId,
    sessionId,
    metadata,
  });
}

export type SessionExecutionTargetInput = {
  workspaceId: string;
  sessionId: string;
  engine: string;
  modelCatalogEntryId: string;
  model: string;
  reasoningEffort?: string | null;
};

export type SessionExecutionTarget = {
  modelCatalogEntryId: string;
  model: string;
  reasoningEffort?: string | null;
};

export async function recordSessionExecutionTarget(
  input: SessionExecutionTargetInput,
): Promise<void> {
  return invoke<void>("record_session_execution_target", {
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    engine: input.engine,
    modelCatalogEntryId: input.modelCatalogEntryId,
    model: input.model,
    reasoningEffort: input.reasoningEffort ?? null,
  });
}

export async function getSessionExecutionTarget(input: {
  workspaceId: string;
  sessionId: string;
  engine: string;
}): Promise<SessionExecutionTarget | null> {
  return invoke<SessionExecutionTarget | null>("get_session_execution_target", {
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    engine: input.engine,
  });
}

export async function listGlobalCodexSessions(options?: {
  query?: WorkspaceSessionCatalogQuery | null;
  cursor?: string | null;
  limit?: number | null;
}): Promise<WorkspaceSessionCatalogPage> {
  return invoke<WorkspaceSessionCatalogPage>("list_global_codex_sessions", {
    query: options?.query ?? null,
    cursor: options?.cursor ?? null,
    limit: options?.limit ?? null,
  });
}

export async function listProjectRelatedCodexSessions(
  workspaceId: string,
  options?: {
    query?: WorkspaceSessionCatalogQuery | null;
    cursor?: string | null;
    limit?: number | null;
  },
): Promise<WorkspaceSessionCatalogPage> {
  return invoke<WorkspaceSessionCatalogPage>("list_project_related_codex_sessions", {
    workspaceId,
    query: options?.query ?? null,
    cursor: options?.cursor ?? null,
    limit: options?.limit ?? null,
  });
}

export async function listProjectRelatedSessions(
  workspaceId: string,
  options?: {
    query?: WorkspaceSessionCatalogQuery | null;
    cursor?: string | null;
    limit?: number | null;
  },
): Promise<WorkspaceSessionCatalogPage> {
  return invoke<WorkspaceSessionCatalogPage>("list_project_related_sessions", {
    workspaceId,
    query: options?.query ?? null,
    cursor: options?.cursor ?? null,
    limit: options?.limit ?? null,
  });
}

export async function listWorkspaceSessionArchiveEvidence(
  workspaceId: string,
): Promise<WorkspaceSessionArchiveEvidence> {
  return invoke<WorkspaceSessionArchiveEvidence>(
    "list_workspace_session_archive_evidence",
    { workspaceId },
  );
}

export async function getWorkspaceSessionProjectionSummary(
  workspaceId: string,
  options?: {
    query?: WorkspaceSessionCatalogQuery | null;
  },
): Promise<WorkspaceSessionProjectionSummary> {
  return invoke<WorkspaceSessionProjectionSummary>("get_workspace_session_projection_summary", {
    workspaceId,
    query: options?.query ?? null,
  });
}

export async function archiveWorkspaceSessions(
  workspaceId: string,
  sessionIds: string[],
): Promise<WorkspaceSessionBatchMutationResponse> {
  return invoke<WorkspaceSessionBatchMutationResponse>(
    "archive_workspace_sessions",
    {
      workspaceId,
      sessionIds,
    },
  );
}

export async function unarchiveWorkspaceSessions(
  workspaceId: string,
  sessionIds: string[],
): Promise<WorkspaceSessionBatchMutationResponse> {
  return invoke<WorkspaceSessionBatchMutationResponse>(
    "unarchive_workspace_sessions",
    {
      workspaceId,
      sessionIds,
    },
  );
}

export async function deleteWorkspaceSessions(
  workspaceId: string,
  sessionIds: string[],
): Promise<WorkspaceSessionBatchMutationResponse> {
  return invoke<WorkspaceSessionBatchMutationResponse>(
    "delete_workspace_sessions",
    {
      workspaceId,
      sessionIds,
    },
  );
}

export async function listWorkspaceSessionFolders(
  workspaceId: string,
): Promise<WorkspaceSessionFolderTree> {
  return invoke<WorkspaceSessionFolderTree>("list_workspace_session_folders", {
    workspaceId,
  });
}

export async function createWorkspaceSessionFolder(
  workspaceId: string,
  name: string,
  parentId?: string | null,
): Promise<WorkspaceSessionFolderMutation> {
  return invoke<WorkspaceSessionFolderMutation>("create_workspace_session_folder", {
    workspaceId,
    name,
    parentId: parentId ?? null,
  });
}

export async function renameWorkspaceSessionFolder(
  workspaceId: string,
  folderId: string,
  name: string,
): Promise<WorkspaceSessionFolderMutation> {
  return invoke<WorkspaceSessionFolderMutation>("rename_workspace_session_folder", {
    workspaceId,
    folderId,
    name,
  });
}

export async function moveWorkspaceSessionFolder(
  workspaceId: string,
  folderId: string,
  parentId?: string | null,
): Promise<WorkspaceSessionFolderMutation> {
  return invoke<WorkspaceSessionFolderMutation>("move_workspace_session_folder", {
    workspaceId,
    folderId,
    parentId: parentId ?? null,
  });
}

export async function deleteWorkspaceSessionFolder(
  workspaceId: string,
  folderId: string,
): Promise<void> {
  return invoke<void>("delete_workspace_session_folder", {
    workspaceId,
    folderId,
  });
}

export async function assignWorkspaceSessionFolder(
  workspaceId: string,
  sessionId: string,
  folderId?: string | null,
): Promise<WorkspaceSessionAssignmentResponse> {
  return invoke<WorkspaceSessionAssignmentResponse>("assign_workspace_session_folder", {
    workspaceId,
    sessionId,
    folderId: folderId ?? null,
  });
}

export async function assignWorkspaceSessionFolders(
  workspaceId: string,
  sessionIds: string[],
  folderId?: string | null,
): Promise<WorkspaceSessionBatchMutationResponse> {
  return invoke<WorkspaceSessionBatchMutationResponse>("assign_workspace_session_folders", {
    workspaceId,
    sessionIds,
    folderId: folderId ?? null,
  });
}

export async function createNativeProviderContinuation(input: NativeProviderContinuationInput & {
  confirmDegraded?: boolean;
}): Promise<NativeProviderContinuationResponse> {
  return invoke<NativeProviderContinuationResponse>(
    "create_native_provider_continuation",
    {
      workspaceId: input.workspaceId,
      operationId: input.operationId,
      source: input.source,
      destination: input.destination,
      confirmDegraded: input.confirmDegraded ?? false,
    },
  );
}

export async function prepareNativeProviderContinuation(
  input: NativeProviderContinuationInput,
): Promise<NativeProviderContinuationResponse> {
  return invoke<NativeProviderContinuationResponse>(
    "prepare_native_provider_continuation",
    {
      workspaceId: input.workspaceId,
      operationId: input.operationId,
      source: input.source,
      destination: input.destination,
    },
  );
}

export async function discardPreparedNativeProviderContinuation(
  input: NativeProviderContinuationInput,
): Promise<boolean> {
  return invoke<boolean>(
    "discard_prepared_native_provider_continuation",
    {
      workspaceId: input.workspaceId,
      operationId: input.operationId,
      source: input.source,
      destination: input.destination,
    },
  );
}
