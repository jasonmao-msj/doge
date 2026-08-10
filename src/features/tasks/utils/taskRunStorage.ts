import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import type {
  CreateTaskRunInput,
  TaskRunArtifact,
  TaskRunBrowserEvidenceRef,
  TaskRunRecord,
  TaskRunRecoveryAction,
  TaskRunStatus,
  TaskRunStoreData,
  TaskRunTrigger,
} from "../types";
import type { EngineType } from "../../../types";
import type { BrowserContextSendAttachment } from "../../../types";
import { isEngineCapabilityAvailable } from "../../engine/engineCapabilityMatrix";

export const TASK_RUN_STORE_KEY = "taskCenter.taskRuns";

const STORE_VERSION = 1;
const ACTIVE_RUN_STATUSES = new Set<TaskRunStatus>([
  "queued",
  "planning",
  "running",
  "waiting_input",
  "blocked",
]);
const SETTLED_RUN_STATUSES = new Set<TaskRunStatus>([
  "failed",
  "completed",
  "canceled",
]);
const TASK_CENTER_BASE_ENGINES = new Set<EngineType>(["claude", "gemini"]);

function isSupportedTaskCenterEngine(
  engine: EngineType | unknown,
): engine is TaskRunRecord["engine"] {
  if (!engine || typeof engine !== "string") {
    return false;
  }
  return (
    TASK_CENTER_BASE_ENGINES.has(engine as EngineType) ||
    isEngineCapabilityAvailable(engine as EngineType, "collaboration.mode")
  );
}

function normalizeStatus(value: unknown): TaskRunStatus | null {
  return value === "queued" ||
    value === "planning" ||
    value === "running" ||
    value === "waiting_input" ||
    value === "blocked" ||
    value === "failed" ||
    value === "completed" ||
    value === "canceled"
    ? value
    : null;
}

function normalizeTrigger(value: unknown): TaskRunTrigger | null {
  return value === "manual" ||
    value === "scheduled" ||
    value === "chained" ||
    value === "retry" ||
    value === "resume" ||
    value === "forked"
    ? value
    : null;
}

function normalizeFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizeArtifacts(value: unknown): TaskRunArtifact[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry): TaskRunArtifact | null => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const input = entry as Record<string, unknown>;
      const kind = input.kind;
      if (
        kind !== "message" &&
        kind !== "file" &&
        kind !== "patch" &&
        kind !== "command" &&
        kind !== "summary" &&
        kind !== "link"
      ) {
        return null;
      }
      const label = normalizeNullableString(input.label);
      if (!label) {
        return null;
      }
      return {
        kind,
        label,
        ref: normalizeNullableString(input.ref),
        summary: normalizeNullableString(input.summary),
      };
    })
    .filter((entry): entry is TaskRunArtifact => Boolean(entry));
}

function normalizeBrowserEvidence(value: unknown): TaskRunBrowserEvidenceRef | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const input = value as Record<string, unknown>;
  const attachmentId = normalizeNullableString(input.attachmentId);
  const browserSessionId = normalizeNullableString(input.browserSessionId);
  const snapshotId = normalizeNullableString(input.snapshotId);
  const url = normalizeNullableString(input.url);
  const capturedAt = normalizeFiniteNumber(input.capturedAt);
  const state = input.state;
  if (
    !attachmentId ||
    !browserSessionId ||
    !snapshotId ||
    !url ||
    capturedAt == null ||
    (
      state !== "available" &&
      state !== "stale" &&
      state !== "expired" &&
      state !== "degraded" &&
      state !== "deleted" &&
      state !== "unsupported"
    )
  ) {
    return null;
  }
  return {
    attachmentId,
    browserSessionId,
    snapshotId,
    url,
    title: normalizeNullableString(input.title),
    capturedAt,
    state,
    summary: normalizeNullableString(input.summary),
    diagnostics: Array.isArray(input.diagnostics)
      ? input.diagnostics
          .map((entry) => normalizeNullableString(entry))
          .filter((entry): entry is string => Boolean(entry))
      : [],
    redactedKinds: Array.isArray(input.redactedKinds)
      ? input.redactedKinds
          .map((entry) => normalizeNullableString(entry))
          .filter((entry): entry is string => Boolean(entry))
      : [],
    codeCandidates: Array.isArray(input.codeCandidates)
      ? input.codeCandidates
          .map((entry) => {
            if (!entry || typeof entry !== "object") {
              return null;
            }
            const candidate = entry as Record<string, unknown>;
            const filePath = normalizeNullableString(candidate.filePath);
            const reason = candidate.reason;
            const confidence = candidate.confidence;
            const normalizedReasonValue = reason === "landmark_match"
              ? "button_label_match"
              : reason;
            if (
              !filePath ||
              (
                normalizedReasonValue !== "route_match" &&
                normalizedReasonValue !== "file_name_match" &&
                normalizedReasonValue !== "visible_text_match" &&
                normalizedReasonValue !== "heading_match" &&
                normalizedReasonValue !== "button_label_match" &&
                normalizedReasonValue !== "form_label_match" &&
                normalizedReasonValue !== "aria_label_match" &&
                normalizedReasonValue !== "test_id_match" &&
                normalizedReasonValue !== "component_symbol_match" &&
                normalizedReasonValue !== "manual_hint"
              ) ||
              (confidence !== "high" && confidence !== "medium" && confidence !== "low")
            ) {
              return null;
            }
            const normalizedReason = normalizedReasonValue as NonNullable<
              TaskRunBrowserEvidenceRef["codeCandidates"]
            >[number]["reason"];
            const normalizedConfidence = confidence as NonNullable<
              TaskRunBrowserEvidenceRef["codeCandidates"]
            >[number]["confidence"];
            return {
              filePath,
              reason: normalizedReason,
              confidence: normalizedConfidence,
              matchedText: normalizeNullableString(candidate.matchedText),
              sourceEvidence: Array.isArray(candidate.sourceEvidence)
                ? candidate.sourceEvidence
                    .map((entry) => normalizeNullableString(entry))
                    .filter((entry): entry is string => Boolean(entry))
                : [],
              explanation: normalizeNullableString(candidate.explanation) ?? undefined,
              openAction: (() => {
                const openAction = candidate.openAction;
                if (!openAction || typeof openAction !== "object") {
                  return null;
                }
                const openActionInput = openAction as Record<string, unknown>;
                const openActionFilePath = normalizeNullableString(openActionInput.filePath);
                return openActionInput.kind === "open_file" && openActionFilePath
                  ? {
                      kind: "open_file" as const,
                      filePath: openActionFilePath,
                    }
                  : null;
              })(),
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      : [],
  };
}

function normalizeRecoveryActions(value: unknown): TaskRunRecoveryAction[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const actions = value.filter((entry): entry is TaskRunRecoveryAction =>
    entry === "open_conversation" ||
    entry === "retry" ||
    entry === "resume" ||
    entry === "cancel" ||
    entry === "fork_new_run",
  );
  return Array.from(new Set(actions));
}

function normalizeRun(raw: unknown): TaskRunRecord | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const input = raw as Record<string, unknown>;
  const task = input.task;
  if (!task || typeof task !== "object") {
    return null;
  }
  const taskInput = task as Record<string, unknown>;
  const runId = normalizeNullableString(input.runId);
  const taskId = normalizeNullableString(taskInput.taskId);
  const workspaceId = normalizeNullableString(taskInput.workspaceId);
  const engine = input.engine;
  const status = normalizeStatus(input.status);
  const trigger = normalizeTrigger(input.trigger);
  const updatedAt = normalizeFiniteNumber(input.updatedAt);
  if (
    !runId ||
    !taskId ||
    !workspaceId ||
    !isSupportedTaskCenterEngine(engine) ||
    !status ||
    !trigger ||
    updatedAt == null
  ) {
    return null;
  }
  return {
    runId,
    task: {
      taskId,
      source: "kanban",
      workspaceId,
      title: normalizeNullableString(taskInput.title),
    },
    engine,
    model: normalizeNullableString(input.model),
    status,
    trigger,
    linkedThreadId: normalizeNullableString(input.linkedThreadId),
    parentRunId: normalizeNullableString(input.parentRunId),
    upstreamRunId: normalizeNullableString(input.upstreamRunId),
    planSnapshot: normalizeNullableString(input.planSnapshot),
    currentStep: normalizeNullableString(input.currentStep),
    latestOutputSummary: normalizeNullableString(input.latestOutputSummary),
    blockedReason: normalizeNullableString(input.blockedReason),
    failureReason: normalizeNullableString(input.failureReason),
    browserEvidence: normalizeBrowserEvidence(input.browserEvidence),
    artifacts: normalizeArtifacts(input.artifacts),
    availableRecoveryActions: normalizeRecoveryActions(input.availableRecoveryActions),
    startedAt: normalizeFiniteNumber(input.startedAt),
    updatedAt,
    finishedAt: normalizeFiniteNumber(input.finishedAt),
  };
}

function sortRunsNewestFirst(runs: TaskRunRecord[]): TaskRunRecord[] {
  return [...runs].sort((left, right) => right.updatedAt - left.updatedAt);
}

function makeRunId(taskId: string, now: number): string {
  const randomPart =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  return `task-run-${taskId}-${now}-${randomPart}`;
}

export function isTaskRunActive(status: TaskRunStatus): boolean {
  return ACTIVE_RUN_STATUSES.has(status);
}

export function isTaskRunSettled(status: TaskRunStatus): boolean {
  return SETTLED_RUN_STATUSES.has(status);
}

export function normalizeTaskRunStore(raw: unknown): TaskRunStoreData {
  if (!raw || typeof raw !== "object") {
    return { version: STORE_VERSION, runs: [] };
  }
  const input = raw as Record<string, unknown>;
  const rawRuns = Array.isArray(input.runs) ? input.runs : [];
  const runsById = new Map<string, TaskRunRecord>();
  for (const rawRun of rawRuns) {
    const run = normalizeRun(rawRun);
    if (!run) {
      continue;
    }
    const previous = runsById.get(run.runId);
    if (!previous || previous.updatedAt <= run.updatedAt) {
      runsById.set(run.runId, run);
    }
  }
  return {
    version: STORE_VERSION,
    runs: sortRunsNewestFirst(Array.from(runsById.values())),
  };
}

export function loadTaskRunStore(): TaskRunStoreData {
  return normalizeTaskRunStore(
    getClientStoreSync<Record<string, unknown>>("app", TASK_RUN_STORE_KEY),
  );
}

// 写入即广播：useTaskRunStore 靠此事件即时刷新，替代原来的 2s 高频轮询
// （该 hook 挂在布局根上，任务运行期间每次轮询都换引用导致全树重渲染）。
export const TASK_RUN_STORE_UPDATED_EVENT = "doge:task-run-store-updated" as const;

export function saveTaskRunStore(data: TaskRunStoreData): void {
  writeClientStoreValue("app", TASK_RUN_STORE_KEY, normalizeTaskRunStore(data), {
    immediate: true,
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(TASK_RUN_STORE_UPDATED_EVENT));
  }
}

export function findActiveRunForTask(
  runs: TaskRunRecord[],
  taskId: string,
): TaskRunRecord | null {
  return sortRunsNewestFirst(runs).find(
    (run) => run.task.taskId === taskId && isTaskRunActive(run.status),
  ) ?? null;
}

export function createTaskRunRecord(input: CreateTaskRunInput): TaskRunRecord {
  const now = input.now ?? Date.now();
  if (!isSupportedTaskCenterEngine(input.engine)) {
    throw new Error(`unsupported_task_run_engine:${input.engine}`);
  }
  return {
    runId: makeRunId(input.taskId, now),
    task: {
      taskId: input.taskId,
      source: input.taskSource ?? "kanban",
      workspaceId: input.workspaceId,
      title: input.taskTitle ?? null,
    },
    engine: input.engine,
    model: normalizeNullableString(input.model),
    status: "queued",
    trigger: input.trigger,
    linkedThreadId: input.linkedThreadId ?? null,
    parentRunId: input.parentRunId ?? null,
    upstreamRunId: input.upstreamRunId ?? null,
    planSnapshot: null,
    currentStep: null,
    latestOutputSummary: null,
    blockedReason: null,
    failureReason: null,
    browserEvidence: null,
    artifacts: [],
    availableRecoveryActions: ["open_conversation", "cancel"],
    startedAt: null,
    updatedAt: now,
    finishedAt: null,
  };
}

export function buildTaskRunBrowserEvidenceRef(
  attachment: BrowserContextSendAttachment,
): TaskRunBrowserEvidenceRef {
  return {
    attachmentId: attachment.attachmentId,
    browserSessionId: attachment.browserSessionId,
    snapshotId: attachment.snapshotId,
    url: attachment.url,
    title: attachment.title,
    capturedAt: attachment.capturedAt,
    state: attachment.stale ? "stale" : "available",
    summary: attachment.summary,
    diagnostics: attachment.diagnostics?.map((diagnostic) => diagnostic.message) ?? [],
    redactedKinds: attachment.privacy.redactedKinds,
    codeCandidates:
      attachment.codeCandidates?.map((candidate) => ({
        filePath: candidate.filePath,
        reason: candidate.reason,
        confidence: candidate.confidence,
        matchedText: candidate.matchedText ?? null,
        sourceEvidence: candidate.sourceEvidence ?? [],
        explanation: candidate.explanation,
        openAction: candidate.openAction ?? null,
      })) ?? [],
  };
}

export function upsertTaskRun(
  store: TaskRunStoreData,
  run: TaskRunRecord,
): TaskRunStoreData {
  const withoutCurrent = store.runs.filter((entry) => entry.runId !== run.runId);
  return normalizeTaskRunStore({
    version: STORE_VERSION,
    runs: [run, ...withoutCurrent],
  });
}

export function patchTaskRun(
  store: TaskRunStoreData,
  runId: string,
  patch: Partial<Omit<TaskRunRecord, "runId" | "task" | "engine" | "trigger">> & {
    now?: number;
  },
): TaskRunStoreData {
  const run = store.runs.find((entry) => entry.runId === runId);
  if (!run) {
    return store;
  }
  const now = patch.now ?? Date.now();
  const nextRun: TaskRunRecord = {
    ...run,
    ...patch,
    runId: run.runId,
    task: run.task,
    engine: run.engine,
    model: patch.model === undefined ? run.model : patch.model,
    trigger: run.trigger,
    artifacts: patch.artifacts ?? run.artifacts,
    browserEvidence:
      patch.browserEvidence === undefined ? run.browserEvidence : patch.browserEvidence,
    availableRecoveryActions:
      patch.availableRecoveryActions ?? run.availableRecoveryActions,
    updatedAt: now,
  };
  return upsertTaskRun(store, nextRun);
}
