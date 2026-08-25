import type { ConversationItem, ThreadTokenUsage } from "../../../types";
import { isIncrementalDerivationEnabled } from "@/conversation-presentation/realtimePerfFlags";
import { isLocalCliReasoningThread } from "./threadReducerReasoningGuards";
import type { ThreadActivityStatus, ThreadState } from "./threadReducerTypes";

const INCREMENTAL_DERIVATION_ENABLED = isIncrementalDerivationEnabled();
const CODEX_COMPACTION_MESSAGE_ID_PREFIX = "context-compacted-codex-compact-";

type MessageItem = Extract<ConversationItem, { kind: "message" }>;
type UserMessageItem = MessageItem & { role: "user" };
type AssistantMessageItem = MessageItem & { role: "assistant" };
type ToolConversationItem = Extract<ConversationItem, { kind: "tool" }>;

export function getThreadScopedCodexCompactionMessagePrefix(threadId: string) {
  return `${CODEX_COMPACTION_MESSAGE_ID_PREFIX}${threadId}`;
}

export function isThreadScopedCodexCompactionMessage(
  item: ConversationItem | undefined,
  threadId: string,
): item is AssistantMessageItem {
  if (
    item?.kind !== "message" ||
    item.role !== "assistant" ||
    item.engineSource !== "codex"
  ) {
    return false;
  }
  const prefix = getThreadScopedCodexCompactionMessagePrefix(threadId);
  return item.id === prefix || item.id.startsWith(`${prefix}-`);
}

export function buildCodexCompactionMessage(
  threadId: string,
  text: string,
  id = `${getThreadScopedCodexCompactionMessagePrefix(threadId)}-${Date.now()}`,
): ConversationItem {
  return {
    id,
    kind: "message",
    role: "assistant",
    text,
    engineSource: "codex",
  };
}

export function collectThreadScopedCodexCompactionMessages(
  list: ConversationItem[],
  threadId: string,
) {
  let latestMatch: AssistantMessageItem | null = null;
  let matchCount = 0;
  for (const item of list) {
    if (!isThreadScopedCodexCompactionMessage(item, threadId)) {
      continue;
    }
    latestMatch = item;
    matchCount += 1;
  }
  return {
    latestMatch,
    matchCount,
  };
}

export function filterThreadScopedCodexCompactionMessages(
  list: ConversationItem[],
  threadId: string,
) {
  return list.filter(
    (item) => !isThreadScopedCodexCompactionMessage(item, threadId),
  );
}

export function isUserMessageItem(
  item: ConversationItem | undefined,
): item is UserMessageItem {
  return item?.kind === "message" && item.role === "user";
}

export function isAssistantMessageItem(
  item: ConversationItem | undefined,
): item is AssistantMessageItem {
  return item?.kind === "message" && item.role === "assistant";
}

export function canUseLiveAssistantDeltaFastPath({
  // threadId retained for caller-side API stability and future per-engine overrides;
  // the engine-prefix gate is intentionally not part of the fast-path predicate.
  threadId: _threadId,
  list,
  index,
  shouldCanonicalizeLegacyId,
  keepFinalMetadata,
}: {
  threadId: string;
  list: ConversationItem[];
  index: number;
  shouldCanonicalizeLegacyId: boolean;
  keepFinalMetadata: boolean;
}) {
  return (
    INCREMENTAL_DERIVATION_ENABLED &&
    index === list.length - 1 &&
    !shouldCanonicalizeLegacyId &&
    !keepFinalMetadata
  );
}

export function isToolConversationItem(
  item: ConversationItem | undefined,
): item is ToolConversationItem {
  return item?.kind === "tool";
}

export function withThreadStatusDefaults(
  status?: ThreadActivityStatus,
): ThreadActivityStatus {
  return {
    isProcessing: status?.isProcessing ?? false,
    hasUnread: status?.hasUnread ?? false,
    isReviewing: status?.isReviewing ?? false,
    isContextCompacting: status?.isContextCompacting ?? false,
    processingStartedAt: status?.processingStartedAt ?? null,
    lastDurationMs: status?.lastDurationMs ?? null,
    heartbeatPulse: status?.heartbeatPulse ?? 0,
    continuationPulse: status?.continuationPulse ?? 0,
    lastContinuationEvidenceAtMs: status?.lastContinuationEvidenceAtMs ?? null,
    terminalPulse: status?.terminalPulse ?? 0,
    codexCompactionSource: status?.codexCompactionSource ?? null,
    codexCompactionLifecycleState:
      status?.codexCompactionLifecycleState ?? "idle",
    codexCompactionCompletedAt: status?.codexCompactionCompletedAt ?? null,
    lastTokenUsageUpdatedAt: status?.lastTokenUsageUpdatedAt ?? null,
    codexSilentSuspectedAt: status?.codexSilentSuspectedAt ?? null,
    codexSilentSuspectedSource: status?.codexSilentSuspectedSource ?? null,
  };
}

/** True when any workspace currently has this thread selected. */
export function isThreadActiveInState(
  activeThreadIdByWorkspace: Record<string, string | null | undefined>,
  threadId: string,
  workspaceId?: string | null,
): boolean {
  if (workspaceId) {
    return (activeThreadIdByWorkspace[workspaceId] ?? null) === threadId;
  }
  for (const activeId of Object.values(activeThreadIdByWorkspace)) {
    if (activeId === threadId) {
      return true;
    }
  }
  return false;
}

function isTokenUsageBreakdownEqual(
  left: ThreadTokenUsage["total"] | ThreadTokenUsage["last"] | undefined,
  right: ThreadTokenUsage["total"] | ThreadTokenUsage["last"] | undefined,
): boolean {
  return (
    (left?.totalTokens ?? 0) === (right?.totalTokens ?? 0) &&
    (left?.inputTokens ?? 0) === (right?.inputTokens ?? 0) &&
    (left?.cachedInputTokens ?? 0) === (right?.cachedInputTokens ?? 0) &&
    (left?.outputTokens ?? 0) === (right?.outputTokens ?? 0) &&
    (left?.reasoningOutputTokens ?? 0) === (right?.reasoningOutputTokens ?? 0)
  );
}

export function isThreadTokenUsageEqual(
  left: ThreadTokenUsage | null | undefined,
  right: ThreadTokenUsage | null | undefined,
): boolean {
  if (left == null || right == null) {
    return left == null && right == null;
  }
  return (
    isTokenUsageBreakdownEqual(left.total, right.total) &&
    isTokenUsageBreakdownEqual(left.last, right.last) &&
    left.modelContextWindow === right.modelContextWindow &&
    (left.contextUsageSource ?? null) === (right.contextUsageSource ?? null) &&
    (left.contextUsageFreshness ?? null) === (right.contextUsageFreshness ?? null) &&
    (left.contextUsedTokens ?? null) === (right.contextUsedTokens ?? null) &&
    (left.contextUsedPercent ?? null) === (right.contextUsedPercent ?? null) &&
    (left.contextRemainingPercent ?? null) === (right.contextRemainingPercent ?? null) &&
    (left.contextToolUsagesTruncated ?? null) === (right.contextToolUsagesTruncated ?? null) &&
    JSON.stringify(left.contextToolUsages ?? null) === JSON.stringify(right.contextToolUsages ?? null) &&
    JSON.stringify(left.contextCategoryUsages ?? null) === JSON.stringify(right.contextCategoryUsages ?? null)
  );
}

export function findAssistantMessageIndexById(
  list: ConversationItem[],
  candidateId: string,
) {
  if (!candidateId) {
    return -1;
  }
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index];
    if (!item) {
      continue;
    }
    if (isAssistantMessageItem(item) && item.id === candidateId) {
      return index;
    }
  }
  return -1;
}

export function findAssistantMessageIndexByPrefix(
  list: ConversationItem[],
  idPrefix: string,
) {
  if (!idPrefix) {
    return -1;
  }
  const segmentPrefix = `${idPrefix}-seg-`;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index];
    if (!item) {
      continue;
    }
    if (isAssistantMessageItem(item) && item.id.startsWith(segmentPrefix)) {
      return index;
    }
  }
  return -1;
}

export function listHasAssistantSegmentSiblings(
  list: ConversationItem[],
  baseItemId: string,
) {
  if (!baseItemId) {
    return false;
  }
  const segmentPrefix = `${baseItemId}-seg-`;
  for (const item of list) {
    if (isAssistantMessageItem(item) && item.id.startsWith(segmentPrefix)) {
      return true;
    }
  }
  return false;
}

export type LiveSettlementLookupMode = "append" | "complete";

/**
 * Resolve which assistant row should receive live complete / delta for a provider itemId.
 *
 * Tool boundaries create durable ids `{base}` then `{base}-seg-1`…. After
 * `resetAgentSegment`, `resolveLiveAssistantMessageId` returns bare `base` again.
 * Preferring bare id first remounts post-tool conclusion text onto the pre-tool
 * bubble (user sees conclusion before tools). When segmented siblings exist and
 * the resolved id collapses to bare base, target the latest `-seg-*` sibling.
 *
 * For `append` of a **new** `-seg-N` shell, must return -1 (create) — never fall
 * back to bare `base`, or post-tool deltas merge into the pre-tool bubble.
 *
 * @see openspec/changes/fix-live-settle-assistant-tool-order
 */
export function findAssistantMessageIndexForLiveSettlement(
  list: ConversationItem[],
  itemId: string,
  segmentedItemId: string,
  mode: LiveSettlementLookupMode = "complete",
) {
  const baseId = itemId.trim();
  const resolvedId = segmentedItemId.trim() || baseId;
  const hasSegmentedSiblings =
    baseId.length > 0 && listHasAssistantSegmentSiblings(list, baseId);
  const resolvedIsSegmentedShell =
    baseId.length > 0 && resolvedId.startsWith(`${baseId}-seg-`);

  // resetAgentSegment → segment=0 → resolved id === bare base, but post-tool
  // shells already live under base-seg-N. Prefer that latest sibling.
  if (hasSegmentedSiblings && resolvedId === baseId) {
    const latestSegmented = findAssistantMessageIndexByPrefix(list, baseId);
    if (latestSegmented >= 0) {
      return latestSegmented;
    }
  }

  let index = findAssistantMessageIndexById(list, resolvedId);
  if (index >= 0) {
    return index;
  }

  // Missing -seg-N: append must create a new shell; complete may fall back to
  // the latest existing sibling so late final text still lands after tools.
  if (resolvedIsSegmentedShell) {
    if (mode === "append") {
      return -1;
    }
    index = findAssistantMessageIndexByPrefix(list, baseId);
    if (index >= 0) {
      return index;
    }
    return findAssistantMessageIndexById(list, baseId);
  }

  if (baseId) {
    index = findAssistantMessageIndexByPrefix(list, baseId);
    if (index >= 0) {
      return index;
    }
    index = findAssistantMessageIndexById(list, baseId);
    if (index >= 0) {
      return index;
    }
  }

  return -1;
}

export function resolveLiveAssistantMessageId(
  state: ThreadState,
  threadId: string,
  itemId: string,
) {
  const segment = state.agentSegmentByThread[threadId] ?? 0;
  const normalizedItemId = itemId.trim();
  if (normalizedItemId.length > 0) {
    return segment > 0 ? `${normalizedItemId}-seg-${segment}` : normalizedItemId;
  }
  const activeTurnId = state.activeTurnIdByThread[threadId] ?? null;
  if (isLocalCliReasoningThread(threadId) && activeTurnId) {
    return segment > 0
      ? `assistant-live:${activeTurnId}:seg-${segment}`
      : `assistant-live:${activeTurnId}`;
  }
  return segment > 0 ? `${itemId}-seg-${segment}` : itemId;
}

export function resolveLiveReasoningItemId(
  state: ThreadState,
  threadId: string,
  itemId: string,
) {
  if (!isLocalCliReasoningThread(threadId)) {
    return itemId;
  }
  const segment = state.agentSegmentByThread[threadId] ?? 0;
  return segment > 0 ? `${itemId}-seg-${segment}` : itemId;
}
