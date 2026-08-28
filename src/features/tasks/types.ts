import type { EngineType } from "../../types";
import type { PersistedTaskRunEngine } from "./taskRunEnginePolicy";

export type TaskRunStatus =
  | "queued"
  | "planning"
  | "running"
  | "waiting_input"
  | "blocked"
  | "failed"
  | "completed"
  | "canceled";

export type TaskRunTrigger =
  | "manual"
  | "scheduled"
  | "chained"
  | "retry"
  | "resume"
  | "forked";

export type TaskRunArtifact = {
  kind: "message" | "file" | "patch" | "command" | "summary" | "link";
  label: string;
  ref?: string | null;
  summary?: string | null;
};

export type TaskRunBrowserEvidenceRef = {
  attachmentId: string;
  browserSessionId: string;
  snapshotId: string;
  url: string;
  title?: string | null;
  capturedAt: number;
  state: "available" | "stale" | "expired" | "degraded" | "deleted" | "unsupported";
  summary?: string | null;
  diagnostics?: string[];
  redactedKinds?: string[];
  codeCandidates?: Array<{
    filePath: string;
    reason:
      | "route_match"
      | "file_name_match"
      | "visible_text_match"
      | "heading_match"
      | "button_label_match"
      | "form_label_match"
      | "aria_label_match"
      | "test_id_match"
      | "component_symbol_match"
      | "manual_hint";
    confidence: "high" | "medium" | "low";
    matchedText?: string | null;
    sourceEvidence?: string[];
    explanation?: string;
    openAction?: {
      kind: "open_file";
      filePath: string;
    } | null;
  }>;
};

export type TaskRunRecoveryAction =
  | "open_conversation"
  | "retry"
  | "resume"
  | "cancel"
  | "fork_new_run";

export type TaskRunDefinitionRef = {
  taskId: string;
  source: "kanban";
  workspaceId: string;
  title?: string | null;
};

export type TaskRunRecord = {
  runId: string;
  task: TaskRunDefinitionRef;
  engine: PersistedTaskRunEngine;
  providerProfileId?: string | null;
  modelCatalogEntryId?: string | null;
  model?: string | null;
  status: TaskRunStatus;
  trigger: TaskRunTrigger;
  linkedThreadId?: string | null;
  parentRunId?: string | null;
  upstreamRunId?: string | null;
  planSnapshot?: string | null;
  currentStep?: string | null;
  latestOutputSummary?: string | null;
  blockedReason?: string | null;
  failureReason?: string | null;
  browserEvidence?: TaskRunBrowserEvidenceRef | null;
  artifacts: TaskRunArtifact[];
  availableRecoveryActions: TaskRunRecoveryAction[];
  startedAt?: number | null;
  updatedAt: number;
  finishedAt?: number | null;
};

export type TaskRunStoreData = {
  version: 1;
  runs: TaskRunRecord[];
};

export type KanbanLatestRunSummary = {
  runId: string;
  status: TaskRunStatus;
  trigger: TaskRunTrigger;
  engine: PersistedTaskRunEngine;
  model?: string | null;
  linkedThreadId?: string | null;
  latestOutputSummary?: string | null;
  blockedReason?: string | null;
  failureReason?: string | null;
  artifactCount: number;
  updatedAt: number;
  finishedAt?: number | null;
};

export type CreateTaskRunInput = {
  taskId: string;
  workspaceId: string;
  taskTitle?: string | null;
  taskSource?: TaskRunDefinitionRef["source"];
  engine: EngineType;
  providerProfileId?: string | null;
  modelCatalogEntryId?: string | null;
  model?: string | null;
  trigger: TaskRunTrigger;
  linkedThreadId?: string | null;
  parentRunId?: string | null;
  upstreamRunId?: string | null;
  now?: number;
};

export type TaskRunPatch = Partial<
  Pick<
    TaskRunRecord,
    | "status"
    | "linkedThreadId"
    | "planSnapshot"
    | "currentStep"
    | "latestOutputSummary"
    | "blockedReason"
    | "failureReason"
    | "browserEvidence"
    | "artifacts"
    | "availableRecoveryActions"
    | "startedAt"
    | "finishedAt"
  >
> & {
  now?: number;
};
