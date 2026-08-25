import type { ConversationItem } from "../../../../types";
import { parseAgentTaskNotification } from "@/contracts/agentTaskNotification";
import type { GroupedEntry } from "../../utils/groupToolItems";
import type { MessageConversationItem } from "../../utils/messageItemPredicates";
import { resolveUserMessagePresentation } from "../../presentation/messagesUserPresentation";

export type MessagesHistoryExpansionMode = "manual" | "jump" | null;

export type MessagesPresentationMode =
  | "realtime-collapsed-tail"
  | "realtime-expanded-history-jump"
  | "realtime-expanded-history-manual"
  | "realtime-full-tail"
  | "static-collapsed-history"
  | "static-expanded-history-jump"
  | "static-expanded-history-manual"
  | "static-full-history";

function resolveOrdinaryUserQuestionText(
  item: MessageConversationItem,
  enableCollaborationBadge: boolean,
) {
  return resolveUserMessagePresentation({
    text: item.text,
    selectedAgentName: item.selectedAgentName,
    selectedAgentIcon: item.selectedAgentIcon,
    presentationMetadata: item.presentationMetadata,
    enableCollaborationBadge,
  }).stickyCandidateText.trim();
}

export function isOrdinaryUserQuestionItem(
  item: ConversationItem | undefined,
  enableCollaborationBadge: boolean,
): item is MessageConversationItem & { role: "user" } {
  if (item?.kind !== "message" || item.role !== "user") {
    return false;
  }
  return (
    !parseAgentTaskNotification(item.text) &&
    resolveOrdinaryUserQuestionText(item, enableCollaborationBadge).length > 0
  );
}

export function resolveLiveAutoExpandedExploreId(
  entries: GroupedEntry[],
  isThinking: boolean,
) {
  if (!isThinking || entries.length === 0) {
    return null;
  }
  const latestEntry = entries[entries.length - 1];
  if (latestEntry?.kind !== "item" || latestEntry.item.kind !== "explore") {
    return null;
  }
  return latestEntry.item.status === "explored" ? latestEntry.item.id : null;
}

export function collapseExpandedExploreItems(
  expandedItemIds: Set<string>,
  items: ConversationItem[],
) {
  if (expandedItemIds.size === 0) {
    return expandedItemIds;
  }
  const nextExpandedItemIds = new Set(expandedItemIds);
  let changed = false;
  for (const item of items) {
    if (item.kind !== "explore") {
      continue;
    }
    if (nextExpandedItemIds.delete(item.id)) {
      changed = true;
    }
  }
  return changed ? nextExpandedItemIds : expandedItemIds;
}

function findLatestOrdinaryUserQuestionIndex(
  items: ConversationItem[],
  options?: { enableCollaborationBadge?: boolean },
) {
  const enableCollaborationBadge = options?.enableCollaborationBadge ?? false;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (isOrdinaryUserQuestionItem(item, enableCollaborationBadge)) {
      return index;
    }
  }
  return -1;
}

export function findLatestOrdinaryUserQuestionId(
  items: ConversationItem[],
  options?: { enableCollaborationBadge?: boolean },
) {
  const latestUserIndex = findLatestOrdinaryUserQuestionIndex(items, options);
  return latestUserIndex >= 0 ? items[latestUserIndex]?.id ?? null : null;
}

export function suppressCompletedExploreItemsBetweenLatestUserTurns(
  items: ConversationItem[],
  options?: { enableCollaborationBadge?: boolean },
) {
  const latestUserIndex = findLatestOrdinaryUserQuestionIndex(items, options);
  if (latestUserIndex <= 0) {
    return items;
  }
  const previousUserIndex = findLatestOrdinaryUserQuestionIndex(
    items.slice(0, latestUserIndex),
    options,
  );
  if (previousUserIndex < 0) {
    return items;
  }
  let changed = false;
  const filteredItems = items.filter((item, index) => {
    if (index <= previousUserIndex || index >= latestUserIndex) {
      return true;
    }
    const shouldSuppress =
      item.kind === "explore" && item.status === "explored";
    if (shouldSuppress) {
      changed = true;
      return false;
    }
    return true;
  });
  return changed ? filteredItems : items;
}

export function buildRenderedItemsWindow(
  timelineItems: ConversationItem[],
  collapsedHistoryItemCount: number,
  preservedUserMessageId: string | null,
) {
  const windowedItems =
    collapsedHistoryItemCount > 0
      ? timelineItems.slice(collapsedHistoryItemCount)
      : timelineItems;
  if (!preservedUserMessageId || collapsedHistoryItemCount === 0) {
    return {
      renderedItems: windowedItems,
      visibleCollapsedHistoryItemCount: collapsedHistoryItemCount,
    };
  }
  if (windowedItems.some((item) => item.id === preservedUserMessageId)) {
    return {
      renderedItems: windowedItems,
      visibleCollapsedHistoryItemCount: collapsedHistoryItemCount,
    };
  }
  const preservedUserMessage = timelineItems.find(
    (item) => item.id === preservedUserMessageId,
  );
  if (!preservedUserMessage) {
    return {
      renderedItems: windowedItems,
      visibleCollapsedHistoryItemCount: collapsedHistoryItemCount,
    };
  }
  return {
    renderedItems: [preservedUserMessage, ...windowedItems],
    visibleCollapsedHistoryItemCount: Math.max(0, collapsedHistoryItemCount - 1),
  };
}

export function resolveMessagesPresentationMode(input: {
  historyExpansionMode: MessagesHistoryExpansionMode;
  isWorking: boolean;
  showAllHistoryItems: boolean;
  visibleCollapsedHistoryItemCount: number;
}): MessagesPresentationMode {
  const runtimePrefix = input.isWorking ? "realtime" : "static";
  if (input.showAllHistoryItems) {
    const expansionMode = input.historyExpansionMode === "jump" ? "jump" : "manual";
    return `${runtimePrefix}-expanded-history-${expansionMode}` as MessagesPresentationMode;
  }
  if (input.visibleCollapsedHistoryItemCount > 0) {
    return input.isWorking ? "realtime-collapsed-tail" : "static-collapsed-history";
  }
  return input.isWorking ? "realtime-full-tail" : "static-full-history";
}

export function buildMessagesPresentationScopeKey(input: {
  collapsedHistoryItemCount: number;
  itemCount: number;
  firstItemId: string | null;
  lastItemId: string | null;
  mode: MessagesPresentationMode;
  scopeKey: string;
}) {
  return [
    input.scopeKey,
    input.mode,
    input.collapsedHistoryItemCount,
    input.itemCount,
    input.firstItemId ?? "",
    input.lastItemId ?? "",
  ].join("\u0000");
}

export function resolveStreamingPresentationItems(
  deferredItems: ConversationItem[],
  currentItems: ConversationItem[],
  shouldStabilize: boolean,
  liveOverrideItemIds?: ReadonlySet<string>,
  scope?: {
    deferredScopeKey: string | null;
    currentScopeKey: string | null;
  },
) {
  if (!shouldStabilize) {
    return currentItems;
  }
  if (
    scope &&
    scope.deferredScopeKey !== null &&
    scope.currentScopeKey !== null &&
    scope.deferredScopeKey !== scope.currentScopeKey
  ) {
    return currentItems;
  }
  if (deferredItems.length === 0) {
    return currentItems;
  }
  // Preserve the deferred history snapshot for parent-level timeline work, but
  // append truly new live ids so the active tail can still appear immediately.
  const deferredItemIds = new Set(deferredItems.map((item) => item.id));
  let resolvedDeferredItems = deferredItems;
  let hasLiveOverride = false;
  if (liveOverrideItemIds && liveOverrideItemIds.size > 0) {
    const currentItemById = new Map(currentItems.map((item) => [item.id, item]));
    resolvedDeferredItems = deferredItems.map((item) => {
      if (!liveOverrideItemIds.has(item.id)) {
        return item;
      }
      const currentItem = currentItemById.get(item.id);
      if (
        !currentItem ||
        currentItem === item ||
        !isSamePresentationItemSlot(item, currentItem)
      ) {
        return item;
      }
      hasLiveOverride = true;
      return currentItem;
    });
  }
  const appendedCurrentItems = currentItems.filter((item) => !deferredItemIds.has(item.id));
  return hasLiveOverride || appendedCurrentItems.length > 0
    ? [...resolvedDeferredItems, ...appendedCurrentItems]
    : deferredItems;
}

function isSamePresentationItemSlot(
  stableItem: ConversationItem,
  liveItem: ConversationItem,
) {
  if (stableItem.kind !== liveItem.kind) {
    return false;
  }
  if (stableItem.kind === "message" && liveItem.kind === "message") {
    return stableItem.role === liveItem.role;
  }
  return true;
}

export function buildAssistantFinalBoundarySet(items: ConversationItem[]) {
  const ids = new Set<string>();
  let lastFinalAssistantIdInTurn: string | null = null;
  items.forEach((entry) => {
    if (entry.kind === "message" && entry.role === "user") {
      if (lastFinalAssistantIdInTurn) {
        ids.add(lastFinalAssistantIdInTurn);
      }
      lastFinalAssistantIdInTurn = null;
      return;
    }
    if (
      entry.kind === "message" &&
      entry.role === "assistant" &&
      entry.isFinal === true
    ) {
      lastFinalAssistantIdInTurn = entry.id;
    }
  });
  if (lastFinalAssistantIdInTurn) {
    ids.add(lastFinalAssistantIdInTurn);
  }
  return ids;
}

/**
 * 流式工作集。
 * visibleWindow<=0：jetbrains 模式——始终全量 items（不裁尾窗），避免结束瞬间高度暴涨。
 * visibleWindow>0：历史性能路径，仅 isThinking 时裁最近 visibleWindow*2 条。
 */
export function buildLiveTailWorkingSet(
  items: ConversationItem[],
  options: {
    isThinking: boolean;
    showAllHistoryItems: boolean;
    visibleWindow: number;
    enableCollaborationBadge?: boolean;
  },
) {
  const { isThinking, showAllHistoryItems, visibleWindow } = options;
  if (!isThinking || showAllHistoryItems || visibleWindow <= 0) {
    return {
      items,
      omittedBeforeWorkingSetCount: 0,
      preservedUserMessageId: null,
    };
  }

  const maxWorkingSetItems = Math.max(visibleWindow, visibleWindow * 2);
  if (items.length <= maxWorkingSetItems) {
    return {
      items,
      omittedBeforeWorkingSetCount: 0,
      preservedUserMessageId: findLatestOrdinaryUserQuestionId(items, {
        enableCollaborationBadge: options.enableCollaborationBadge,
      }),
    };
  }

  const tailStartIndex = Math.max(0, items.length - maxWorkingSetItems);
  const tailItems = items.slice(tailStartIndex);
  const preservedUserMessageId = findLatestOrdinaryUserQuestionId(items, {
    enableCollaborationBadge: options.enableCollaborationBadge,
  });
  if (!preservedUserMessageId || tailItems.some((item) => item.id === preservedUserMessageId)) {
    return {
      items: tailItems,
      omittedBeforeWorkingSetCount: tailStartIndex,
      preservedUserMessageId,
    };
  }

  const preservedUserMessageIndex = items.findIndex((item) => item.id === preservedUserMessageId);
  const preservedUserMessage = items[preservedUserMessageIndex];
  if (!preservedUserMessage || preservedUserMessageIndex >= tailStartIndex) {
    return {
      items: tailItems,
      omittedBeforeWorkingSetCount: tailStartIndex,
      preservedUserMessageId,
    };
  }

  return {
    items: [preservedUserMessage, ...tailItems],
    omittedBeforeWorkingSetCount: Math.max(0, tailStartIndex - 1),
    preservedUserMessageId,
  };
}
