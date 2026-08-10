import type { CollaborationModeBlockedRequest } from "../../../types";
import { isDebugLightPathEnabled } from "../utils/realtimePerfFlags";

export const TURN_FIRST_DELTA_WARNING_MS = 6_000;
export const TURN_STALL_WARNING_MS = 6_000;
export const CODEX_TURN_NO_PROGRESS_STALL_MS = 600_000;
export const CODEX_EXECUTION_ACTIVE_NO_PROGRESS_STALL_MS = 20 * 60_000;

const TURN_DIAGNOSTIC_VERBOSE_FLAG_KEY = "doge.debug.turnDiagnosticsVerbose";
const REQUEST_USER_INPUT_BLOCKED_REASON_CODE =
  "request_user_input_blocked_in_default_mode";
const EXECUTION_ITEM_TYPES = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "collabToolCall",
  "collabAgentToolCall",
  "webSearch",
  "imageView",
]);
const TERMINAL_AGENT_STATUSES = new Set([
  "aborted",
  "cancelled",
  "canceled",
  "complete",
  "completed",
  "done",
  "error",
  "errored",
  "failed",
  "failure",
  "interrupted",
  "skipped",
  "stopped",
  "success",
  "succeeded",
  "terminated",
  "timed_out",
  "timeout",
]);

type ActiveExecutionItem = {
  itemType: string;
  toolName: string | null;
  status: string | null;
  hasAgentStatusEvidence: boolean;
  hasRunningAgentStatus: boolean;
  startedAt: number;
};

type DeferredTurnCompletion = {
  workspaceId: string;
  threadId: string;
  turnId: string;
  deferredAt: number;
};

export type DeferredCompletionFlushSource =
  | "item-terminal"
  | "scoped-reconciliation-terminal";

export type ThreadLifecycleSnapshot = {
  isProcessing: boolean;
  activeTurnId: string | null;
};

export type TurnDiagnosticState = {
  workspaceId: string;
  threadId: string;
  turnId: string;
  startedAt: number;
  lastProgressAt: number;
  lastProgressSource: string;
  firstDeltaAt: number | null;
  firstItemEventAt: number | null;
  firstItemEventKind: "started" | "updated" | "completed" | null;
  firstItemType: string | null;
  firstExecutionAt: number | null;
  firstExecutionEventKind: "started" | "updated" | "completed" | null;
  firstExecutionItemType: string | null;
  firstExecutionItemId: string | null;
  activeExecutionItems: Map<string, ActiveExecutionItem>;
  completedAt: number | null;
  errorAt: number | null;
  deferredCompletion: DeferredTurnCompletion | null;
  assistantCompletedAt: number | null;
  assistantCompletedItemId: string | null;
  deltaCount: number;
  itemEventCount: number;
  progressSequence: number;
  stallReported: boolean;
  noProgressSuspectedAt: number | null;
  noProgressSuspectedSource: string | null;
};

export type CodexQuarantinedTurn = {
  workspaceId: string;
  threadId: string;
  turnId: string;
  settledAt: number;
  reason: string;
  source: string;
};

export function asString(value: unknown) {
  return typeof value === "string" ? value : value ? String(value) : "";
}

export function isExecutionItemType(itemType: string | null): itemType is string {
  return itemType !== null && EXECUTION_ITEM_TYPES.has(itemType);
}

function normalizeExecutionToolName(item: Record<string, unknown>) {
  return asString(item.tool ?? item.name ?? item.title ?? "")
    .trim()
    .toLowerCase();
}

function isTerminalAgentStatus(status: string) {
  const normalizedStatus = status.trim().toLowerCase();
  if (!normalizedStatus) {
    return true;
  }
  return TERMINAL_AGENT_STATUSES.has(normalizedStatus);
}

function hasTerminalExecutionStatus(status: string | null) {
  return Boolean(status && TERMINAL_AGENT_STATUSES.has(status));
}

function extractAgentStatusValues(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (!entry || typeof entry !== "object") {
          return "";
        }
        return asString((entry as Record<string, unknown>).status);
      })
      .filter(Boolean);
  }
  return Object.values(payload as Record<string, unknown>)
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      if (!entry || typeof entry !== "object") {
        return "";
      }
      return asString((entry as Record<string, unknown>).status);
    })
    .filter(Boolean);
}

function hasRunningAgentStatus(item: Record<string, unknown>) {
  const statusValues = extractAgentStatusValues(
    item.agentStatus ?? item.agentsStates ?? item.agents_states,
  );
  return statusValues.some((status) => !isTerminalAgentStatus(status));
}

function hasAgentStatusEvidence(item: Record<string, unknown>) {
  return extractAgentStatusValues(
    item.agentStatus ?? item.agentsStates ?? item.agents_states,
  ).length > 0;
}

function isCollabWaitToolName(toolName: string | null) {
  return toolName === "wait" || toolName === "wait_agent";
}

function buildExecutionItemIdKey(itemId: string) {
  return `id:${itemId}`;
}

function buildExecutionItemKey(itemType: string, itemId: string | null) {
  return itemId ? buildExecutionItemIdKey(itemId) : `type:${itemType}`;
}

export function getCodexNoProgressTimeoutMs(diagnostic: TurnDiagnosticState) {
  return diagnostic.activeExecutionItems.size > 0
    ? CODEX_EXECUTION_ACTIVE_NO_PROGRESS_STALL_MS
    : CODEX_TURN_NO_PROGRESS_STALL_MS;
}

export function listActiveExecutionItemTypes(diagnostic: TurnDiagnosticState) {
  return Array.from(
    new Set(
      Array.from(diagnostic.activeExecutionItems.values()).map(
        (item) => item.itemType,
      ),
    ),
  );
}

export function listDeferredCompletionBlockers(diagnostic: TurnDiagnosticState) {
  return Array.from(diagnostic.activeExecutionItems.values())
    .filter((item) => {
      if (item.itemType === "collabAgentToolCall") {
        return !hasTerminalExecutionStatus(item.status);
      }
      if (item.itemType !== "collabToolCall") {
        return false;
      }
      if (!isCollabWaitToolName(item.toolName)) {
        return item.hasRunningAgentStatus;
      }
      if (item.hasAgentStatusEvidence) {
        return item.hasRunningAgentStatus;
      }
      return !hasTerminalExecutionStatus(item.status);
    })
    .map((item) => ({
      itemType: item.itemType,
      toolName: item.toolName,
      status: item.status,
      hasAgentStatusEvidence: item.hasAgentStatusEvidence,
      hasRunningAgentStatus: item.hasRunningAgentStatus,
      ageMs: Math.max(0, Date.now() - item.startedAt),
    }));
}

export function isRequestUserInputModeBlocked(
  event: CollaborationModeBlockedRequest,
) {
  const blockedMethod = asString(event.params.blocked_method).trim();
  if (blockedMethod === "item/tool/requestUserInput") {
    return true;
  }
  const reasonCode = asString(event.params.reason_code).trim();
  return reasonCode === REQUEST_USER_INPUT_BLOCKED_REASON_CODE;
}

function clearCompletedExecutionItem(
  diagnostic: TurnDiagnosticState,
  itemType: string | null,
  itemId: string | null,
) {
  const previousSize = diagnostic.activeExecutionItems.size;
  if (itemId) {
    diagnostic.activeExecutionItems.delete(buildExecutionItemIdKey(itemId));
  }
  if (itemType) {
    for (const [key, activeItem] of diagnostic.activeExecutionItems) {
      if (activeItem.itemType === itemType && !itemId) {
        diagnostic.activeExecutionItems.delete(key);
      }
    }
    diagnostic.activeExecutionItems.delete(buildExecutionItemKey(itemType, itemId));
  }
  return diagnostic.activeExecutionItems.size !== previousSize;
}

export function applyActiveExecutionItemEvent(
  diagnostic: TurnDiagnosticState,
  kind: "started" | "updated" | "completed",
  itemType: string | null,
  itemId: string | null,
  item: Record<string, unknown>,
  now: number,
) {
  if (kind === "completed") {
    return clearCompletedExecutionItem(diagnostic, itemType, itemId);
  }
  if (!isExecutionItemType(itemType)) {
    return false;
  }
  const executionItemKey = buildExecutionItemKey(itemType, itemId);
  const existing = diagnostic.activeExecutionItems.get(executionItemKey);
  const nextToolName = normalizeExecutionToolName(item) || existing?.toolName || null;
  const nextStatus = asString(item.status).trim().toLowerCase() || existing?.status || null;
  const nextHasAgentStatusEvidence = hasAgentStatusEvidence(item);
  const nextHasRunningAgentStatus = hasRunningAgentStatus(item);
  if (existing) {
    existing.toolName = nextToolName;
    existing.status = nextStatus;
    existing.hasAgentStatusEvidence =
      existing.hasAgentStatusEvidence || nextHasAgentStatusEvidence;
    existing.hasRunningAgentStatus = nextHasRunningAgentStatus;
    return false;
  }
  diagnostic.activeExecutionItems.set(executionItemKey, {
    itemType,
    toolName: nextToolName,
    status: nextStatus,
    hasAgentStatusEvidence: nextHasAgentStatusEvidence,
    hasRunningAgentStatus: nextHasRunningAgentStatus,
    startedAt: now,
  });
  return true;
}

export function buildAssistantSnapshotIngressKey(
  threadId: string,
  itemId: string,
) {
  return `${threadId}\u0000${itemId || "__anonymous__"}`;
}

export function buildCodexTurnIdentityKey(threadId: string, turnId: string) {
  return `${threadId}\u0000${turnId}`;
}

export function extractTurnIdFromRawItem(item: Record<string, unknown>) {
  const turn = item.turn && typeof item.turn === "object"
    ? (item.turn as Record<string, unknown>)
    : null;
  return asString(
    item.turnId ??
      item.turn_id ??
      turn?.id ??
      turn?.turnId ??
      turn?.turn_id ??
      "",
  ).trim();
}

export function inferRawItemEngine(
  threadId: string,
  item: Record<string, unknown>,
): "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" {
  const rawEngine = asString(item.engineSource ?? item.engine_source)
    .trim()
    .toLowerCase();
  if (
    rawEngine === "claude" ||
    rawEngine === "codex" ||
    rawEngine === "gemini" ||
    rawEngine === "grok" ||
    rawEngine === "kimi" ||
    rawEngine === "opencode"
  ) {
    return rawEngine;
  }
  return inferThreadEngine(threadId);
}

export function resolveAgentMessageSnapshotText(item: Record<string, unknown>) {
  return asString(
    item.text ?? item.content ?? item.output_text ?? item.outputText ?? "",
  );
}

export function createThreadLifecycleSnapshot(): ThreadLifecycleSnapshot {
  return {
    isProcessing: false,
    activeTurnId: null,
  };
}

export function createTurnDiagnosticState(
  workspaceId: string,
  threadId: string,
  turnId: string,
  startedAt: number,
): TurnDiagnosticState {
  return {
    workspaceId,
    threadId,
    turnId,
    startedAt,
    lastProgressAt: startedAt,
    lastProgressSource: "turn-start",
    firstDeltaAt: null,
    firstItemEventAt: null,
    firstItemEventKind: null,
    firstItemType: null,
    firstExecutionAt: null,
    firstExecutionEventKind: null,
    firstExecutionItemType: null,
    firstExecutionItemId: null,
    activeExecutionItems: new Map(),
    completedAt: null,
    errorAt: null,
    deferredCompletion: null,
    assistantCompletedAt: null,
    assistantCompletedItemId: null,
    deltaCount: 0,
    itemEventCount: 0,
    progressSequence: 0,
    stallReported: false,
    noProgressSuspectedAt: null,
    noProgressSuspectedSource: null,
  };
}

export function inferThreadEngine(
  threadId: string,
): "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" {
  if (threadId.startsWith("claude:") || threadId.startsWith("claude-pending-")) {
    return "claude";
  }
  if (threadId.startsWith("gemini:") || threadId.startsWith("gemini-pending-")) {
    return "gemini";
  }
  if (threadId.startsWith("grok:") || threadId.startsWith("grok-pending-")) {
    return "grok";
  }
  if (threadId.startsWith("kimi:") || threadId.startsWith("kimi-pending-")) {
    return "kimi";
  }
  if (threadId.startsWith("opencode:") || threadId.startsWith("opencode-pending-")) {
    return "opencode";
  }
  return "codex";
}

export function isTurnDiagnosticVerboseEnabled() {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const value = window.localStorage.getItem(TURN_DIAGNOSTIC_VERBOSE_FLAG_KEY);
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "on";
  } catch {
    return false;
  }
}

export function isThreadSessionMirrorEnabled() {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const value = window.localStorage.getItem("doge.debug.threadSessionMirror");
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "on";
  } catch {
    return false;
  }
}

export function shouldEmitServerDebugEntry(method: string) {
  if (!isDebugLightPathEnabled()) {
    return true;
  }
  return (
    method === "error" ||
    method === "turn/error" ||
    method === "codex/stderr" ||
    method === "turn/started" ||
    method === "turn/completed" ||
    method === "thread/started" ||
    method === "thread/compacting" ||
    method === "thread/compacted" ||
    method === "thread/compactionFailed" ||
    method.includes("warn") ||
    method.includes("warning")
  );
}

// chat-stream-render-isolation-2026-06 task 8.4: 30min TTL for transient
// turn refs (turnDiagnosticsRef / quarantinedCodexTurnsRef /
// assistantSnapshotIngressLengthRef). 60s sweep interval evicts entries that
// have been settled for `ttlMs` while leaving active turns (no settled
// timestamp) untouched.

export const TRANSIENT_TURN_STATE_TTL_MS = 30 * 60 * 1000;
export const TRANSIENT_TURN_STATE_SWEEP_INTERVAL_MS = 60 * 1000;

export function resolveTransientSettledAt(
  diagnostic: TurnDiagnosticState,
): number | null {
  return (
    diagnostic.completedAt ??
    diagnostic.errorAt ??
    diagnostic.assistantCompletedAt
  );
}

export type TransientTurnRef = {
  workspaceId: string;
  threadId: string;
  state: { completedAt: number | null; errorAt: number | null; assistantCompletedAt: number | null };
};

export function resolveRefSettledAt(ref: TransientTurnRef): number | null {
  const { state } = ref;
  return state.completedAt ?? state.errorAt ?? state.assistantCompletedAt;
}

export type SweepableThreadDiagnostic = {
  threadId: string;
  settledAt: number | null;
};

export type TransientSweepResult = {
  expiredThreadIds: string[];
  remainingCount: number;
};

export type ThreadTransientStateRefs = {
  turnDiagnosticsRef: {
    current: Map<string, TurnDiagnosticState>;
  };
  quarantinedCodexTurnsRef: {
    current: Map<string, CodexQuarantinedTurn>;
  };
  assistantSnapshotIngressLengthRef: {
    current: Map<string, number>;
  };
};

export function cleanupThreadTransientState(
  refs: ThreadTransientStateRefs,
  workspaceId: string | null | undefined,
  threadId: string,
): number {
  let cleaned = 0;
  if (refs.turnDiagnosticsRef.current.delete(threadId)) {
    cleaned += 1;
  }
  for (const [key, entry] of refs.quarantinedCodexTurnsRef.current) {
    if (
      entry.threadId === threadId &&
      (workspaceId == null || entry.workspaceId === workspaceId)
    ) {
      refs.quarantinedCodexTurnsRef.current.delete(key);
      cleaned += 1;
    }
  }
  const ingressPrefix = `${threadId}\u0000`;
  for (const key of refs.assistantSnapshotIngressLengthRef.current.keys()) {
    if (key.startsWith(ingressPrefix)) {
      refs.assistantSnapshotIngressLengthRef.current.delete(key);
      cleaned += 1;
    }
  }
  return cleaned;
}

/**
 * Pure helper for chat-stream-render-isolation-2026-06 task 8.4.
 * Returns the threadIds whose settled timestamp is older than `ttlMs` ago.
 * Entries with no settled timestamp are considered active and never expire.
 */
export function sweepThreadTransientState(
  entries: Iterable<SweepableThreadDiagnostic>,
  now: number,
  ttlMs: number = TRANSIENT_TURN_STATE_TTL_MS,
): TransientSweepResult {
  const expiredThreadIds: string[] = [];
  let remainingCount = 0;
  for (const entry of entries) {
    if (typeof entry.settledAt === "number" && now - entry.settledAt >= ttlMs) {
      expiredThreadIds.push(entry.threadId);
    } else {
      remainingCount += 1;
    }
  }
  return { expiredThreadIds, remainingCount };
}
