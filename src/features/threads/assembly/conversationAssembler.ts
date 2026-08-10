import type {
  ConversationState,
  NormalizedHistorySnapshot,
  NormalizedThreadEvent,
} from "../contracts/conversationCurtainContracts";
import type { ConversationItem } from "../../../types";
import { normalizeItem } from "../../../utils/threadItems";
import {
  areEquivalentAssistantMessageTexts,
  compactComparableConversationText,
  findEquivalentReasoningObservationIndex,
  isEquivalentUserObservation,
  normalizeComparableUserText,
} from "./conversationNormalization";
import {
  classifyConversationObservation,
  formatCompactControlToolItem,
  type ConversationFactSource,
} from "../contracts/conversationFactContract";
import {
  isLowRiskStreamingAppendFragmentWithoutBoundary,
  mergeAgentMessageText,
  mergeCompletedAgentText,
  mergeReasoningSnapshotTextForThread,
  mergeReasoningTextForThread,
} from "../hooks/threadReducerTextMerge";

type MessageConversationItem = Extract<ConversationItem, { kind: "message" }>;
type AssistantMessageItem = MessageConversationItem & { role: "assistant" };
type UserMessageItem = MessageConversationItem & { role: "user" };
type ReasoningConversationItem = Extract<ConversationItem, { kind: "reasoning" }>;
type ToolConversationItem = Extract<ConversationItem, { kind: "tool" }>;
type GeneratedImageConversationItem = Extract<
  ConversationItem,
  { kind: "generatedImage" }
>;

export const CONVERSATION_STATE_DIFF_WHITELIST = [
  "meta.heartbeatPulse",
  "meta.historyRestoredAtMs",
] as const;

function buildConversationItemIdentityKey(item: ConversationItem): string {
  return `${item.kind}:${item.id}`;
}

function replaceItemAtIndex(
  items: ConversationItem[],
  index: number,
  next: ConversationItem,
): ConversationItem[] {
  if (index >= 0 && items[index] === next) {
    return items;
  }
  const normalizedNext = normalizeItem(next);
  if (index < 0) {
    return [...items, normalizedNext];
  }
  if (items[index] === normalizedNext) {
    return items;
  }
  const copy = [...items];
  copy[index] = normalizedNext;
  return copy;
}

function findIdentityIndex(items: ConversationItem[], next: ConversationItem): number {
  const nextIdentityKey = buildConversationItemIdentityKey(next);
  return items.findIndex(
    (item) => buildConversationItemIdentityKey(item) === nextIdentityKey,
  );
}

function sliceByComparableLength(text: string, targetLength: number): string {
  if (targetLength <= 0) {
    return text;
  }
  let comparableLength = 0;
  for (let index = 0; index < text.length; index += 1) {
    const currentChar = text[index] ?? "";
    if (!/\s/.test(currentChar)) {
      comparableLength += 1;
    }
    if (comparableLength >= targetLength) {
      return text.slice(index + 1);
    }
  }
  return "";
}

function isAssistantMessageItem(
  item: ConversationItem | undefined,
): item is AssistantMessageItem {
  return item?.kind === "message" && item.role === "assistant";
}

function isUserMessageItem(
  item: ConversationItem | undefined,
): item is UserMessageItem {
  return item?.kind === "message" && item.role === "user";
}

function isReasoningItem(
  item: ConversationItem | undefined,
): item is ReasoningConversationItem {
  return item?.kind === "reasoning";
}

function isToolItem(item: ConversationItem | undefined): item is ToolConversationItem {
  return item?.kind === "tool";
}

function shouldStopAssistantEquivalenceSearch(item: ConversationItem) {
  if (item.kind === "message") {
    return item.role === "user";
  }
  return (
    item.kind === "reasoning" ||
    item.kind === "tool" ||
    item.kind === "generatedImage" ||
    item.kind === "diff" ||
    item.kind === "review" ||
    item.kind === "explore"
  );
}

function findEquivalentAssistantMessageIndex(
  items: ConversationItem[],
  incomingText: string,
  mergeText: (existing: string, incoming: string) => string,
) {
  if (!incomingText.trim()) {
    return -1;
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const candidate = items[index];
    if (!candidate) {
      continue;
    }
    if (shouldStopAssistantEquivalenceSearch(candidate)) {
      break;
    }
    if (!isAssistantMessageItem(candidate)) {
      continue;
    }
    if (areEquivalentAssistantMessageTexts(candidate.text, incomingText, mergeText)) {
      return index;
    }
  }
  return -1;
}

/** 同 turn 用户文案等价（允许 images 一侧缺失，用于 Shared history 补图）。 */
function isTextEquivalentUserTurn(
  left: Pick<UserMessageItem, "text">,
  right: Pick<UserMessageItem, "text">,
) {
  return (
    normalizeComparableUserText(left.text) ===
    normalizeComparableUserText(right.text)
  );
}

function isHistoryCompatibleUserObservation(
  left: UserMessageItem,
  right: UserMessageItem,
) {
  return (
    isEquivalentUserObservation(left, right) ||
    isTextEquivalentUserTurn(left, right)
  );
}

/** 合并两侧用户附图：优先非空；两侧皆有时保留更长列表。 */
export function preferRicherUserImages(
  existing: UserMessageItem,
  incoming: UserMessageItem,
): string[] | undefined {
  // Image normalization deliberately removes note-card injected attachments
  // for intent comparison. Presentation merging must retain the raw attached
  // images so replacing an optimistic user row cannot make them disappear.
  const existingImages = existing.images ?? [];
  const incomingImages = incoming.images ?? [];
  if (incomingImages.length === 0 && existingImages.length === 0) {
    return undefined;
  }
  if (incomingImages.length === 0) {
    return existingImages;
  }
  if (existingImages.length === 0) {
    return incomingImages;
  }
  if (incomingImages.length >= existingImages.length) {
    return incomingImages;
  }
  return existingImages;
}

function mergeUserMessageSnapshot(
  existing: UserMessageItem,
  incoming: UserMessageItem,
): UserMessageItem {
  const images = preferRicherUserImages(existing, incoming);
  return {
    ...existing,
    ...incoming,
    images,
  };
}

function findEquivalentTrailingUserMessageIndex(
  items: ConversationItem[],
  incoming: UserMessageItem,
) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const candidate = items[index];
    if (!candidate) {
      continue;
    }
    if (candidate.kind === "generatedImage") {
      continue;
    }
    if (!isUserMessageItem(candidate)) {
      break;
    }
    // Shared history：projection 无图 / legacy 有图时仍要命中并补图
    if (isHistoryCompatibleUserObservation(candidate, incoming)) {
      return index;
    }
  }
  return -1;
}

function mergeToolSnapshot(
  existing: ToolConversationItem,
  incoming: ToolConversationItem,
): ToolConversationItem {
  const incomingOutput = incoming.output ?? "";
  const incomingDetail = incoming.detail ?? "";
  const incomingTitle = incoming.title ?? "";
  const incomingChanges = incoming.changes ?? [];
  return {
    ...existing,
    ...incoming,
    title: incomingTitle || existing.title,
    detail: incomingDetail || existing.detail,
    output: incomingOutput || existing.output,
    changes: incomingChanges.length > 0 ? incomingChanges : existing.changes,
  };
}

function collapseRepeatedAssistantEcho(text: string) {
  const comparable = compactComparableConversationText(text);
  if (comparable.length < 16 || comparable.length % 2 !== 0) {
    return text;
  }
  const halfLength = comparable.length / 2;
  const prefix = comparable.slice(0, halfLength);
  if (!prefix || `${prefix}${prefix}` !== comparable) {
    return text;
  }
  const suffix = sliceByComparableLength(text, halfLength);
  return suffix ? text.slice(0, text.length - suffix.length).trimEnd() : text;
}

function dedupeAdjacentAssistantParagraphs(text: string) {
  const paragraphs = text
    .split(/\r?\n[^\S\r\n]*\r?\n+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (paragraphs.length <= 1) {
    return text;
  }
  const deduped: string[] = [];
  for (const paragraph of paragraphs) {
    const comparableParagraph = compactComparableConversationText(paragraph);
    const previous = deduped[deduped.length - 1] ?? "";
    if (
      previous &&
      comparableParagraph.length >= 8 &&
      compactComparableConversationText(previous) === comparableParagraph
    ) {
      continue;
    }
    deduped.push(paragraph);
  }
  return deduped.length === paragraphs.length ? text : deduped.join("\n\n");
}

function normalizeAssistantSnapshotText(text: string) {
  const normalizedStreamingText = mergeAgentMessageText("", text);
  if (!normalizedStreamingText) {
    return "";
  }
  return dedupeAdjacentAssistantParagraphs(
    mergeCompletedAgentText(
      "",
      collapseRepeatedAssistantEcho(normalizedStreamingText),
    ),
  );
}

function normalizeAssistantSnapshotItem(
  item: AssistantMessageItem,
): AssistantMessageItem {
  const normalizedText = normalizeAssistantSnapshotText(item.text);
  if (!normalizedText || normalizedText === item.text) {
    return item;
  }
  return {
    ...item,
    text: normalizedText,
  };
}

function areConversationImageListsEqual(
  left: AssistantMessageItem["images"] | undefined,
  right: AssistantMessageItem["images"] | undefined,
) {
  const normalizedLeft = left ?? [];
  const normalizedRight = right ?? [];
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  for (let index = 0; index < normalizedLeft.length; index += 1) {
    const leftImage = normalizedLeft[index];
    const rightImage = normalizedRight[index];
    if (leftImage === rightImage) {
      continue;
    }
    if (
      leftImage === undefined ||
      rightImage === undefined ||
      JSON.stringify(leftImage) !== JSON.stringify(rightImage)
    ) {
      return false;
    }
  }
  return true;
}

function mergeAssistantSnapshot(
  existing: AssistantMessageItem,
  incoming: AssistantMessageItem,
) {
  const executionTargetSnapshot =
    existing.executionTargetSnapshot ?? incoming.executionTargetSnapshot;
  // Codex itemUpdated 每次 flush 都投递整段增长中的快照；典型形态是
  // 「existing 全文 + 无边界短追加」。与 reducer delta 快路同一前提：无
  // 句末/换行边界的低风险追加不会产生新的可折叠结构，直接采纳 incoming，
  // 跳过整段快照的多趟归一化 + 等价比较（随文本增长累积成 O(n²)）。
  if (
    existing.text &&
    incoming.text.length > existing.text.length &&
    incoming.text.startsWith(existing.text) &&
    isLowRiskStreamingAppendFragmentWithoutBoundary(
      existing.text,
      incoming.text.slice(existing.text.length),
    )
  ) {
    return {
      ...existing,
      ...incoming,
      executionTargetSnapshot,
    } satisfies AssistantMessageItem;
  }
  const normalizedIncomingText = normalizeAssistantSnapshotText(incoming.text);
  if (!normalizedIncomingText) {
    return executionTargetSnapshot === existing.executionTargetSnapshot
      ? existing
      : {
          ...existing,
          executionTargetSnapshot,
        };
  }
  const nextImages = incoming.images ?? existing.images;
  if (!existing.text) {
    return {
      ...existing,
      ...incoming,
      executionTargetSnapshot,
      text: normalizedIncomingText,
    } satisfies AssistantMessageItem;
  }
  if (
    !areEquivalentAssistantMessageTexts(
      existing.text,
      normalizedIncomingText,
      mergeCompletedAgentText,
    )
  ) {
    if (
      incoming.id === existing.id &&
      existing.text === normalizedIncomingText &&
      areConversationImageListsEqual(existing.images, nextImages) &&
      executionTargetSnapshot === existing.executionTargetSnapshot
    ) {
      return existing;
    }
    return {
      ...existing,
      ...incoming,
      executionTargetSnapshot,
      text: normalizedIncomingText,
    } satisfies AssistantMessageItem;
  }
  const mergedText = mergeCompletedAgentText(existing.text, normalizedIncomingText);
  if (
    incoming.id === existing.id &&
    mergedText === existing.text &&
    areConversationImageListsEqual(existing.images, nextImages) &&
    executionTargetSnapshot === existing.executionTargetSnapshot
  ) {
    return existing;
  }
  return {
    ...existing,
    ...incoming,
    executionTargetSnapshot,
    text: mergedText,
  } satisfies AssistantMessageItem;
}

function mergeReasoningSnapshot(
  existing: ReasoningConversationItem,
  incoming: ReasoningConversationItem,
  threadId: string,
) {
  return {
    ...existing,
    ...incoming,
    summary: mergeReasoningSnapshotTextForThread(
      threadId,
      existing.summary,
      incoming.summary,
    ),
    content: mergeReasoningSnapshotTextForThread(
      threadId,
      existing.content,
      incoming.content,
    ),
  } satisfies ReasoningConversationItem;
}

function areEquivalentReasoningSnapshotObservation(
  existing: ReasoningConversationItem,
  incoming: ReasoningConversationItem,
) {
  if (findEquivalentReasoningObservationIndex([existing], incoming) >= 0) {
    return true;
  }
  const existingText = (existing.content || existing.summary || "").trim();
  const incomingText = (incoming.content || incoming.summary || "").trim();
  if (!existingText || !incomingText) {
    return false;
  }
  const compactExisting = compactComparableConversationText(existingText);
  const compactIncoming = compactComparableConversationText(incomingText);
  if (!compactExisting || !compactIncoming) {
    return false;
  }
  if (compactExisting === compactIncoming) {
    return true;
  }
  const shorter =
    compactExisting.length <= compactIncoming.length ? compactExisting : compactIncoming;
  const longer =
    shorter === compactExisting ? compactIncoming : compactExisting;
  return (
    shorter.length >= 5 &&
    (longer.startsWith(shorter) || longer.endsWith(shorter))
  );
}

function retargetGeneratedImageAnchors(
  items: ConversationItem[],
  replacementByUserId: Map<string, string>,
) {
  if (replacementByUserId.size === 0) {
    return items;
  }
  let didRetarget = false;
  const nextItems = items.map((item) => {
    if (item.kind !== "generatedImage") {
      return item;
    }
    const replacementAnchorId = replacementByUserId.get(item.anchorUserMessageId ?? "");
    if (!replacementAnchorId || replacementAnchorId === item.anchorUserMessageId) {
      return item;
    }
    didRetarget = true;
    return {
      ...item,
      anchorUserMessageId: replacementAnchorId,
    } satisfies GeneratedImageConversationItem;
  });
  return didRetarget ? nextItems : items;
}

function upsertSnapshotItem(
  items: ConversationItem[],
  next: ConversationItem,
  event: Pick<NormalizedThreadEvent, "engine" | "threadId" | "turnId"> & {
    source: ConversationFactSource;
  },
): ConversationItem[] {
  const factRawType = next.kind === "tool" ? next.toolType : next.kind;
  const factRawText =
    next.kind === "message"
      ? next.text
      : next.kind === "tool"
        ? [next.title, next.detail, next.output].filter(Boolean).join(" ")
        : null;
  const fact = classifyConversationObservation({
    engine: event.engine,
    threadId: event.threadId,
    turnId: event.turnId ?? null,
    source: event.source,
    item: next,
    rawText: factRawText,
    rawType: factRawType,
  });
  if (fact.visibility === "hidden") {
    return items;
  }
  const classifiedNext =
    fact.visibility === "compact" && isToolItem(next)
      ? formatCompactControlToolItem(next)
      : next;

  const normalizedNextCandidate = normalizeItem(classifiedNext);
  const normalizedNext = isAssistantMessageItem(normalizedNextCandidate)
    ? normalizeAssistantSnapshotItem(normalizedNextCandidate)
    : normalizedNextCandidate;
  const identityIndex = findIdentityIndex(items, normalizedNext);
  const existingByIdentity = identityIndex >= 0 ? items[identityIndex] : undefined;

  if (isToolItem(existingByIdentity) && isToolItem(normalizedNext)) {
    return replaceItemAtIndex(
      items,
      identityIndex,
      mergeToolSnapshot(existingByIdentity, normalizedNext),
    );
  }
  if (isReasoningItem(existingByIdentity) && isReasoningItem(normalizedNext)) {
    return replaceItemAtIndex(
      items,
      identityIndex,
      mergeReasoningSnapshot(existingByIdentity, normalizedNext, event.threadId),
    );
  }
  if (isAssistantMessageItem(existingByIdentity) && isAssistantMessageItem(normalizedNext)) {
    return replaceItemAtIndex(
      items,
      identityIndex,
      mergeAssistantSnapshot(existingByIdentity, normalizedNext),
    );
  }
  if (identityIndex >= 0) {
    return replaceItemAtIndex(items, identityIndex, normalizedNext);
  }

  if (isUserMessageItem(normalizedNext)) {
    const userIndex = findEquivalentTrailingUserMessageIndex(items, normalizedNext);
    if (userIndex >= 0) {
      const existing = items[userIndex];
      if (isUserMessageItem(existing)) {
        const retargetedItems =
          existing.id === normalizedNext.id
            ? items
            : retargetGeneratedImageAnchors(
                items,
                new Map([[existing.id, normalizedNext.id]]),
              );
        return replaceItemAtIndex(
          retargetedItems,
          userIndex,
          mergeUserMessageSnapshot(existing, normalizedNext),
        );
      }
    }
  }
  if (isReasoningItem(normalizedNext)) {
    let reasoningIndex = findEquivalentReasoningObservationIndex(items, normalizedNext);
    if (reasoningIndex < 0) {
      reasoningIndex = items.findIndex((item) => {
        return isReasoningItem(item) &&
          areEquivalentReasoningSnapshotObservation(item, normalizedNext);
      });
    }
    if (reasoningIndex >= 0) {
      const existing = items[reasoningIndex];
      if (isReasoningItem(existing)) {
        return replaceItemAtIndex(
          items,
          reasoningIndex,
          mergeReasoningSnapshot(existing, normalizedNext, event.threadId),
        );
      }
    }
  }
  if (isAssistantMessageItem(normalizedNext)) {
    const assistantIndex = findEquivalentAssistantMessageIndex(
      items,
      normalizedNext.text,
      mergeCompletedAgentText,
    );
    if (assistantIndex >= 0) {
      const existing = items[assistantIndex];
      if (isAssistantMessageItem(existing)) {
        return replaceItemAtIndex(
          items,
          assistantIndex,
          mergeAssistantSnapshot(existing, normalizedNext),
        );
      }
    }
  }

  return replaceItemAtIndex(items, -1, normalizedNext);
}

function appendMessageDelta(
  items: ConversationItem[],
  event: NormalizedThreadEvent,
): ConversationItem[] {
  if (event.item.kind !== "message") {
    return items;
  }
  const delta = event.delta ?? event.item.text;
  if (!delta) {
    return items;
  }
  const existingIndex = items.findIndex(
    (item) => item.kind === "message" && item.id === event.item.id,
  );
  const existing = existingIndex >= 0 ? items[existingIndex] : undefined;
  if (!isAssistantMessageItem(existing)) {
    return replaceItemAtIndex(items, -1, {
      ...event.item,
      role: "assistant",
      text: delta,
      turnId: event.item.turnId ?? event.turnId ?? null,
      engineSource: event.item.engineSource ?? event.engine,
    });
  }
  return replaceItemAtIndex(items, existingIndex, {
    ...existing,
    turnId: existing.turnId ?? event.item.turnId ?? event.turnId ?? null,
    engineSource:
      existing.engineSource ?? event.item.engineSource ?? event.engine,
    executionTargetSnapshot:
      existing.executionTargetSnapshot ??
      event.item.executionTargetSnapshot,
    text: mergeAgentMessageText(existing.text, delta),
  });
}

function appendReasoningSummaryDelta(
  items: ConversationItem[],
  event: NormalizedThreadEvent,
): ConversationItem[] {
  const delta = event.delta ?? "";
  if (!delta) {
    return items;
  }
  const existingIndex = items.findIndex(
    (item) => item.kind === "reasoning" && item.id === event.item.id,
  );
  const fallbackIndex =
    existingIndex >= 0
      ? existingIndex
      : findEquivalentReasoningObservationIndex(items, {
          summary: delta,
          content: "",
        });
  const existing = fallbackIndex >= 0 ? items[fallbackIndex] : undefined;
  if (!isReasoningItem(existing)) {
    return replaceItemAtIndex(items, -1, {
      id: event.item.id,
      kind: "reasoning",
      summary: delta,
      content: "",
    });
  }
  return replaceItemAtIndex(items, fallbackIndex, {
    ...existing,
    summary: mergeReasoningTextForThread(event.threadId, existing.summary, delta),
  });
}

function appendReasoningContentDelta(
  items: ConversationItem[],
  event: NormalizedThreadEvent,
): ConversationItem[] {
  const delta = event.delta ?? "";
  if (!delta) {
    return items;
  }
  const existingIndex = items.findIndex(
    (item) => item.kind === "reasoning" && item.id === event.item.id,
  );
  const fallbackIndex =
    existingIndex >= 0
      ? existingIndex
      : findEquivalentReasoningObservationIndex(items, {
          summary: "",
          content: delta,
        });
  const existing = fallbackIndex >= 0 ? items[fallbackIndex] : undefined;
  if (!isReasoningItem(existing)) {
    return replaceItemAtIndex(items, -1, {
      id: event.item.id,
      kind: "reasoning",
      summary: "",
      content: delta,
    });
  }
  return replaceItemAtIndex(items, fallbackIndex, {
    ...existing,
    content: mergeReasoningTextForThread(event.threadId, existing.content, delta),
  });
}

function appendToolOutputDelta(
  items: ConversationItem[],
  event: NormalizedThreadEvent,
): ConversationItem[] {
  if (event.item.kind !== "tool") {
    return items;
  }
  const delta = event.delta ?? "";
  if (!delta) {
    return items;
  }
  const existingIndex = items.findIndex(
    (item) => item.kind === "tool" && item.id === event.item.id,
  );
  const existing = existingIndex >= 0 ? items[existingIndex] : undefined;
  if (!isToolItem(existing)) {
    return replaceItemAtIndex(items, -1, {
      ...event.item,
      output: delta,
      status: event.item.status ?? "started",
    });
  }
  return replaceItemAtIndex(items, existingIndex, {
    ...existing,
    output: `${existing.output ?? ""}${delta}`,
  });
}

function completeAssistantMessage(
  items: ConversationItem[],
  event: NormalizedThreadEvent,
): ConversationItem[] {
  if (event.item.kind !== "message") {
    return items;
  }
  const identityIndex = items.findIndex(
    (item) => item.kind === "message" && item.id === event.item.id,
  );
  const fallbackIndex =
    identityIndex >= 0
      ? identityIndex
      : findEquivalentAssistantMessageIndex(
          items,
          event.item.text,
          mergeCompletedAgentText,
        );
  const existing = fallbackIndex >= 0 ? items[fallbackIndex] : undefined;
  if (!isAssistantMessageItem(existing)) {
    return replaceItemAtIndex(items, -1, event.item);
  }
  const mergedText = mergeCompletedAgentText(existing.text, event.item.text);
  const nextImages =
    event.item.kind === "message" ? event.item.images ?? existing.images : existing.images;
  if (
    event.item.id === existing.id &&
    mergedText === existing.text &&
    areConversationImageListsEqual(existing.images, nextImages)
  ) {
    return items;
  }
  return replaceItemAtIndex(items, fallbackIndex, {
    ...existing,
    ...event.item,
    text: mergedText,
  });
}

export function appendEvent(
  state: ConversationState,
  event: NormalizedThreadEvent,
): ConversationState {
  let items = state.items;
  switch (event.operation) {
    case "itemStarted":
    case "itemUpdated":
    case "itemCompleted":
      items = upsertSnapshotItem(items, event.item, {
        engine: event.engine,
        threadId: event.threadId,
        turnId: event.turnId ?? null,
        source: "realtime",
      });
      break;
    case "appendAgentMessageDelta":
      items = appendMessageDelta(items, event);
      break;
    case "completeAgentMessage":
      items = completeAssistantMessage(items, event);
      break;
    case "appendReasoningSummaryDelta":
      items = appendReasoningSummaryDelta(items, event);
      break;
    case "appendReasoningSummaryBoundary":
      break;
    case "appendReasoningContentDelta":
      items = appendReasoningContentDelta(items, event);
      break;
    case "appendToolOutputDelta":
      items = appendToolOutputDelta(items, event);
      break;
    default:
      break;
  }
  return {
    ...state,
    items,
    meta: {
      ...state.meta,
      activeTurnId: event.turnId ?? state.meta.activeTurnId,
    },
  };
}

export function hydrateHistory(snapshot: NormalizedHistorySnapshot): ConversationState {
  const items = snapshot.items.reduce<ConversationItem[]>(
    (current, item) =>
      upsertSnapshotItem(current, item, {
        engine: snapshot.engine,
        threadId: snapshot.threadId,
        turnId: null,
        source: "history",
      }),
    [],
  );
  return {
    items,
    plan: snapshot.plan,
    userInputQueue: [...snapshot.userInputQueue],
    meta: snapshot.meta,
  };
}

function findAssistantPrefixMatchIndex(
  items: readonly ConversationItem[],
  incomingText: string,
): number {
  const incomingComparable = compactComparableConversationText(incomingText);
  if (!incomingComparable) {
    return -1;
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const candidate = items[index];
    if (!isAssistantMessageItem(candidate)) {
      continue;
    }
    const candidateComparable = compactComparableConversationText(candidate.text);
    if (
      candidateComparable &&
      (candidateComparable.startsWith(incomingComparable) ||
        incomingComparable.startsWith(candidateComparable))
    ) {
      return index;
    }
  }
  return -1;
}

function preserveMoreCompleteAssistantText(
  existingText: string,
  incomingText: string,
): string {
  const existingComparable = compactComparableConversationText(existingText);
  const incomingComparable = compactComparableConversationText(incomingText);
  return existingComparable.length > incomingComparable.length
    ? existingText
    : incomingText;
}

function targetSnapshotCompleteness(
  snapshot: MessageConversationItem["executionTargetSnapshot"],
) {
  if (!snapshot) {
    return 0;
  }
  return [
    snapshot.engine,
    snapshot.providerProfileId,
    snapshot.providerProfileSource,
    snapshot.providerProfileNameSnapshot,
    snapshot.modelCatalogEntryId,
    snapshot.model,
    snapshot.reasoning?.effort,
    snapshot.runtimeCapabilityFingerprint,
  ].filter((value) => value !== null && value !== undefined && value !== "").length;
}

function isResolvedCanonicalTargetSnapshot(
  snapshot: MessageConversationItem["executionTargetSnapshot"],
) {
  if (!snapshot) {
    return false;
  }
  const providerProfileId = snapshot.providerProfileId?.trim() || null;
  const providerSource = snapshot.providerProfileSource;
  const providerIdentityResolved =
    providerSource === "managed"
      ? providerProfileId !== null
      : providerSource === "local" && providerProfileId === null;
  return (
    providerIdentityResolved &&
    Boolean(snapshot.modelCatalogEntryId?.trim()) &&
    Boolean(snapshot.model?.trim()) &&
    Boolean(snapshot.providerProfileNameSnapshot?.trim())
  );
}

function preserveMoreCompleteTargetSnapshot(
  existing: MessageConversationItem["executionTargetSnapshot"],
  incoming: MessageConversationItem["executionTargetSnapshot"],
) {
  // V2 canonical Turn snapshot 是历史 Target 的唯一权威。Legacy snapshot 可能字段更多，
  // 但它属于 presentation evidence，不能覆盖本轮 attempt 已冻结的 Provider/Model。
  // presentation-only shadow 本身不完整时，仍保留 Legacy 可读信息，避免降级旧会话。
  if (isResolvedCanonicalTargetSnapshot(incoming)) {
    return incoming;
  }
  return targetSnapshotCompleteness(existing) > targetSnapshotCompleteness(incoming)
    ? existing
    : incoming ?? existing;
}

/**
 * 将第二个 history projection 按 Turn scope 合并到已有 transcript。
 *
 * Shared Session dual-read 使用 Legacy snapshot 保留 presentation 顺序，
 * 再用 canonical projection 覆盖 frozen identity。每个 Turn 仍复用
 * `upsertSnapshotItem`，避免另写一套 message/reasoning dedupe 规则。
 */
export function mergeHistoryProjectionItems(
  baseItems: ConversationItem[],
  overlayItems: readonly ConversationItem[],
  meta: Pick<ConversationState["meta"], "workspaceId" | "threadId" | "engine">,
): ConversationItem[] {
  let items = [...baseItems];
  let activeTurnStart = 0;
  let activeTurnEnd = items.length;
  let lastMatchedUserIndex = -1;

  for (const overlayItem of overlayItems) {
    const engine = overlayItem.engineSource ?? meta.engine;
    const turnId =
      overlayItem.kind === "message" || overlayItem.kind === "tool"
        ? overlayItem.turnId ?? null
        : null;
    const event = {
      engine,
      threadId: meta.threadId,
      turnId,
      source: "history" as const,
    };

    if (isUserMessageItem(overlayItem)) {
      const matchedUserIndex = items.findIndex(
        (item, index) =>
          index > lastMatchedUserIndex &&
          isUserMessageItem(item) &&
          isHistoryCompatibleUserObservation(item, overlayItem),
      );
      if (matchedUserIndex < 0) {
        items = upsertSnapshotItem(items, overlayItem, event);
        const appendedUserIndex = items.findIndex(
          (item) =>
            isUserMessageItem(item) &&
            item.id === overlayItem.id,
        );
        lastMatchedUserIndex =
          appendedUserIndex >= 0 ? appendedUserIndex : items.length - 1;
      } else {
        const existingUser = items[matchedUserIndex];
        if (!isUserMessageItem(existingUser)) {
          continue;
        }
        // 保留 legacy 与 projection 两侧更完整的附图，避免 history 丢图
        items[matchedUserIndex] = mergeUserMessageSnapshot(existingUser, {
          ...overlayItem,
          id: existingUser.id,
        });
        lastMatchedUserIndex = matchedUserIndex;
      }
      activeTurnStart = lastMatchedUserIndex + 1;
      const nextUserOffset = items
        .slice(activeTurnStart)
        .findIndex(isUserMessageItem);
      activeTurnEnd =
        nextUserOffset >= 0
          ? activeTurnStart + nextUserOffset
          : items.length;
      continue;
    }

    const currentTurnItems = items.slice(activeTurnStart, activeTurnEnd);
    let mergedTurnItems: ConversationItem[] | null = null;
    if (isAssistantMessageItem(overlayItem)) {
      const assistantIndex = findAssistantPrefixMatchIndex(
        currentTurnItems,
        overlayItem.text,
      );
      const existingAssistant =
        assistantIndex >= 0 ? currentTurnItems[assistantIndex] : undefined;
      if (isAssistantMessageItem(existingAssistant)) {
        mergedTurnItems = replaceItemAtIndex(
          currentTurnItems,
          assistantIndex,
          normalizeAssistantSnapshotItem({
            ...existingAssistant,
            ...overlayItem,
            executionTargetSnapshot: preserveMoreCompleteTargetSnapshot(
              existingAssistant.executionTargetSnapshot,
              overlayItem.executionTargetSnapshot,
            ),
            text: preserveMoreCompleteAssistantText(
              existingAssistant.text,
              overlayItem.text,
            ),
          }),
        );
      }
    }
    if (!mergedTurnItems) {
      mergedTurnItems = upsertSnapshotItem(
        currentTurnItems,
        overlayItem,
        event,
      );
    }
    items = [
      ...items.slice(0, activeTurnStart),
      ...mergedTurnItems,
      ...items.slice(activeTurnEnd),
    ];
    activeTurnEnd += mergedTurnItems.length - currentTurnItems.length;
  }

  return items;
}

function flattenComparablePaths(
  prefix: string,
  value: unknown,
  output: Map<string, string>,
): void {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      output.set(prefix, "[]");
      return;
    }
    value.forEach((entry, index) => {
      flattenComparablePaths(`${prefix}.${index}`, entry, output);
    });
    return;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      output.set(prefix, "{}");
      return;
    }
    for (const [key, nested] of entries) {
      const path = prefix ? `${prefix}.${key}` : key;
      flattenComparablePaths(path, nested, output);
    }
    return;
  }
  output.set(prefix, JSON.stringify(value));
}

export function findConversationStateDiffs(
  realtime: ConversationState,
  history: ConversationState,
): string[] {
  const realtimePaths = new Map<string, string>();
  const historyPaths = new Map<string, string>();
  flattenComparablePaths("", realtime, realtimePaths);
  flattenComparablePaths("", history, historyPaths);
  const allPaths = new Set([...realtimePaths.keys(), ...historyPaths.keys()]);
  const whitelist = new Set<string>(CONVERSATION_STATE_DIFF_WHITELIST);
  const diffs = new Set<string>();
  for (const path of allPaths) {
    const left = realtimePaths.get(path);
    const right = historyPaths.get(path);
    if (left === right) {
      continue;
    }
    if (whitelist.has(path)) {
      continue;
    }
    const semanticPath = path.includes(".") ? path.slice(0, path.indexOf(".")) : path;
    if (semanticPath && semanticPath !== "meta") {
      diffs.add(semanticPath);
    } else if (path && !whitelist.has(path)) {
      diffs.add(path);
    }
  }
  return Array.from(diffs).sort();
}
