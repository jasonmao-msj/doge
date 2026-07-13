import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  AccessMode,
  ConversationItem,
} from "../../../types";
import { isMacPlatform, isWindowsPlatform } from "../../../utils/platform";
import type { ConversationState } from "../../threads/contracts/conversationCurtainContracts";
import { useStreamActivityPhase } from "../../threads/hooks/useStreamActivityPhase";
import { setPerfStreamingState } from "../../../services/perfBaseline/perfContextBridge";
import {
  noteThreadVisibleTextRendered,
  noteThreadVisibleRender,
  resolveActiveThreadStreamMitigation,
  useThreadStreamLatencySnapshot,
} from "../../threads/utils/streamLatencyDiagnostics";
import type { AgentTaskScrollRequest } from "../types";
import { getVisibleApprovalsForThread } from "../../../utils/approvalBatching";
import {
  MESSAGES_LIVE_AUTO_FOLLOW_FLAG_KEY,
  MESSAGES_LIVE_COLLAPSE_MIDDLE_STEPS_FLAG_KEY,
  MESSAGES_LIVE_CONTROLS_UPDATED_EVENT,
  readLocalBooleanFlag,
  writeLocalBooleanFlag,
} from "../constants/liveCanvasControls";
import { useFileLinkOpener } from "../hooks/useFileLinkOpener";
import { RendererContextMenu } from "../../../components/ui/RendererContextMenu";
import { appendRendererDiagnostic } from "../../../services/rendererDiagnostics";
import {
  groupToolItems,
} from "../utils/groupToolItems";
import { MessagesTimeline } from "./MessagesTimeline";
import { MessagesAnchorRail } from "./MessagesAnchorRail";
import { ScrollControl } from "./ScrollControl";
import {
  MessagesInlineApproval,
  MessagesInlineUserInput,
} from "./MessagesInlinePrompts";
import {
  parseReasoning,
} from "./messagesReasoning";
import {
  buildAssistantFinalBoundarySet,
  buildLiveTailWorkingSet,
  buildMessagesPresentationScopeKey,
  buildRenderedItemsWindow,
  collapseExpandedExploreItems,
  resolveMessagesPresentationMode,
  resolveStreamingPresentationItems,
  resolveLiveAutoExpandedExploreId,
  suppressCompletedExploreItemsBetweenLatestUserTurns,
  type MessagesHistoryExpansionMode,
} from "./messagesLiveWindow";
import {
  buildTurnFileChangesByBoundaryId,
  mergeTurnFileChangesSummaries,
} from "../utils/turnFileChanges";
import {
  isAssistantMessageConversationItem,
  isReasoningConversationItem,
  isUserMessageConversationItem,
} from "./messageItemPredicates";
import { parseAgentTaskNotification } from "../utils/agentTaskNotification";
import { dedupeExitPlanItemsKeepFirst } from "./messagesExitPlan";
import { buildSuppressedUserMemoryContextMessageIdSet } from "./messagesMemoryContext";
import { buildSuppressedUserNoteCardContextMessageIdSet } from "./messagesNoteCardContext";
import { dispatchOpenTaskRunEvent } from "../../agent-orchestration/utils/navigationEvents";
import {
  compareTaskRunSurfacePriority,
  describeTaskRunSurface,
} from "../../tasks/utils/taskRunSurface";
import {
  countRenderableCollapsedEntries,
  findLastAssistantMessageIndex,
  findLatestAssistantMessageIdAfterIndex,
  findLastUserMessageIndex,
  isMessagesPerfDebugEnabled,
  isSelectionInsideNode,
  logClaudeRender,
  logMessagesPerf,
  MESSAGES_SLOW_ANCHOR_WARN_MS,
  MESSAGES_SLOW_RENDER_WARN_MS,
  resolveRenderableItems,
  resolveWorkingActivityLabel,
  SCROLL_THRESHOLD_PX,
  shouldDisplayWorkingActivityLabel,
  shouldHideClaudeReasoningModule,
  isClaudeHistoryTranscriptHeavy,
  toConversationEngine,
  VISIBLE_MESSAGE_WINDOW,
  STREAMING_VISIBLE_WINDOW,
} from "./messagesRenderUtils";
import {
  buildMessageActionTargets,
  buildMessagesScrollKey,
  findItemById,
  findLatestAssistantTextLength,
  isMessagesScrollNearBottom,
  mergeReadableRecoveryItems,
  scrollContainerToBottom,
  resolveActiveUserInputRequest,
  resolveActiveMessageAnchor,
  resolveCollapsedTimelineItems,
  resolveVisibleMessageItems,
  type MessageActionTargets,
  type PreservedReadableWindow,
} from "./messagesViewModel";
import {
  ASSISTANT_FINALIZING_LIVE_WINDOW_MS,
  CODEX_FINALIZING_LIVE_WINDOW_MS,
  INITIAL_BOTTOM_PIN_BUDGET_MS,
  MESSAGE_JUMP_EVENT_NAME,
  SETTLE_REPIN_WINDOW_MS,
  VISIBLE_TEXT_REPORT_EAGER_PREFIX_CHARS,
  VISIBLE_TEXT_REPORT_MIN_GROWTH_CHARS,
  VISIBLE_TEXT_REPORT_MIN_INTERVAL_MS,
} from "./messagesConstants";
import {
  DEFAULT_RENDER_LOOP_GUARD_BUDGET,
  resolveIdempotentRenderLoopGuard,
  type RenderLoopGuardBudget,
} from "./messagesRenderLoopGuards";
import { addBoundedConversationRenderModeKey } from "./messagesConversationLightweightMode";
import {
  TRANSIENT_RUNTIME_RECONNECT_AUTO_DISMISS_MS,
  resolveAssistantRuntimeReconnectHint,
  resolveRetryMessageForReconnectItem,
} from "./runtimeReconnect";
import type {
  LastRenderSnapshot,
  LastVisibleTextReport,
  MessagesProps,
} from "./messagesTypes";

const EMPTY_TASK_RUNS: NonNullable<MessagesProps["taskRuns"]> = [];

const ANCHOR_TITLE_MAX_LENGTH = 60;

/**
 * Derive a short, human-readable label for an anchor dot from the raw
 * user message text: take the first non-empty line, collapse inner
 * whitespace, and truncate. Used for the hover tooltip + outline label
 * on the messages anchor rail.
 */
function deriveAnchorTitle(text: string): string {
  const firstLine =
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  const normalized = firstLine.replace(/\s+/g, " ");
  return normalized.length > ANCHOR_TITLE_MAX_LENGTH
    ? `${normalized.slice(0, ANCHOR_TITLE_MAX_LENGTH)}…`
    : normalized;
}

function areStringSetsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}

// 流式期间每个 token 都会替换 items 数组引用,但通常只有最后一条正在流式输出的
// assistant/user "message" 条目发生了文本变化,其余条目引用保持不变。此时
// dedupeExitPlanItemsKeepFirst / buildMessageActionTargets 的计算结果必然与上一次
// 完全相同(两者都只关心 tool 条目身份或 role/isFinal 边界,不关心文本内容本身),
// 可以安全复用缓存结果,避免对整段历史重新扫描。
// 一旦出现条目增删、非 message 类型条目变化,或 role/isFinal 发生翻转,则回退到全量重算,
// 保证 idle/展开态下覆盖全部历史的正确性不受影响。
function isTrailingMessageTextOnlyUpdate(
  prev: ConversationItem[],
  next: ConversationItem[],
): boolean {
  if (prev.length === 0 || prev.length !== next.length) {
    return false;
  }
  const lastIndex = prev.length - 1;
  for (let index = 0; index < lastIndex; index += 1) {
    if (prev[index] !== next[index]) {
      return false;
    }
  }
  const prevLast = prev[lastIndex];
  const nextLast = next[lastIndex];
  if (prevLast === nextLast) {
    return true;
  }
  return (
    prevLast.kind === "message" &&
    nextLast.kind === "message" &&
    prevLast.id === nextLast.id &&
    prevLast.role === nextLast.role &&
    prevLast.isFinal === nextLast.isFinal
  );
}

export const Messages = memo(function Messages({
  items: legacyItems,
  threadId: legacyThreadId,
  workspaceId: legacyWorkspaceId = null,
  isThinking: legacyIsThinking,
  isHistoryLoading = false,
  isContextCompacting = false,
  proxyEnabled = false,
  proxyUrl = null,
  processingStartedAt = null,
  lastDurationMs = null,
  heartbeatPulse: legacyHeartbeatPulse = 0,
  codexSilentSuspectedAt = null,
  workspacePath = null,
  openTargets,
  selectedOpenAppId,
  showMessageAnchors = true,
  codeBlockCopyUseModifier = false,
  userInputRequests: legacyUserInputRequests = [],
  approvals = [],
  workspaces = [],
  onUserInputSubmit: legacyOnUserInputSubmit,
  onUserInputDismiss: legacyOnUserInputDismiss,
  onApprovalDecision,
  onApprovalBatchAccept,
  onApprovalRemember,
  activeEngine: legacyActiveEngine = "claude",
  claudeThinkingVisible,
  activeCollaborationModeId = null,
  plan: legacyPlan = null,
  isPlanMode: _isPlanMode = false,
  isPlanProcessing: _isPlanProcessing = false,
  onOpenDiffPath,
  conversationState = null,
  presentationProfile = null,
  onOpenWorkspaceFile,
  onExitPlanModeExecute,
  agentTaskScrollRequest = null,
  onRecoverThreadRuntime,
  onRecoverThreadRuntimeAndResend,
  onThreadRecoveryFork,
  onForkFromMessage,
  onRewindFromMessage,
  taskRuns = EMPTY_TASK_RUNS,
}: MessagesProps) {
  const { t } = useTranslation();
  const isWindowsDesktop = useMemo(() => isWindowsPlatform(), []);
  const isMacDesktop = useMemo(() => isMacPlatform(), []);
  const legacyIsWorking = legacyIsThinking || isContextCompacting;
  const fallbackConversationState = useMemo<ConversationState>(
    () => ({
      items: legacyItems,
      plan: legacyPlan,
      userInputQueue: legacyUserInputRequests,
      meta: {
        workspaceId: legacyWorkspaceId ?? "",
        threadId: legacyThreadId ?? "",
        engine: toConversationEngine(legacyActiveEngine),
        activeTurnId: null,
        isThinking: legacyIsWorking,
        heartbeatPulse: legacyHeartbeatPulse,
        historyRestoredAtMs: null,
      },
    }),
    [
      legacyItems,
      legacyPlan,
      legacyUserInputRequests,
      legacyWorkspaceId,
      legacyThreadId,
      legacyActiveEngine,
      legacyIsWorking,
      legacyHeartbeatPulse,
    ],
  );
  const effectiveState = conversationState ?? fallbackConversationState;
  const items = useMemo(
    () =>
      resolveRenderableItems({
        legacyItems,
        legacyThreadId,
        legacyWorkspaceId,
        conversationState,
      }),
    [conversationState, legacyItems, legacyThreadId, legacyWorkspaceId],
  );
  const userInputRequests = effectiveState.userInputQueue;
  const workspaceId = effectiveState.meta.workspaceId || legacyWorkspaceId;
  const threadId = effectiveState.meta.threadId || legacyThreadId;
  const activeTurnId = effectiveState.meta.activeTurnId ?? null;
  const activeEngine = toConversationEngine(effectiveState.meta.engine);
  const renderScopeKey = `${workspaceId ?? ""}\u0000${threadId ?? ""}`;
  const conversationRenderModeKey =
    workspaceId && threadId ? `${workspaceId}\u0000${threadId}` : null;
  const isThinking = conversationState
    ? effectiveState.meta.isThinking
    : legacyIsThinking;
  const isWorking = isThinking || isContextCompacting;
  const heartbeatPulse = conversationState
    ? (effectiveState.meta.heartbeatPulse ?? legacyHeartbeatPulse ?? 0)
    : legacyHeartbeatPulse ?? 0;
  const threadStreamLatencySnapshot = useThreadStreamLatencySnapshot(threadId);
  const activeStreamMitigation = useMemo(
    () => resolveActiveThreadStreamMitigation(threadStreamLatencySnapshot),
    [threadStreamLatencySnapshot],
  );
  const blankingRecoveryActive =
    activeEngine === "claude" &&
    isThinking &&
    threadStreamLatencySnapshot?.latencyCategory === "repeat-turn-blanking";
  const supportsStreamingReadableWindowRecovery =
    activeEngine === "claude" ||
    activeEngine === "codex" ||
    activeEngine === "gemini";
  const visibleStallRecoveryActive =
    supportsStreamingReadableWindowRecovery &&
    isThinking &&
    threadStreamLatencySnapshot?.latencyCategory === "visible-output-stall-after-first-delta";
  const readableWindowRecoveryActive =
    blankingRecoveryActive || visibleStallRecoveryActive;
  const transientRuntimeReconnectSeenAtByItemIdRef = useRef<Map<string, number>>(new Map());
  const [transientRuntimeReconnectClock, setTransientRuntimeReconnectClock] = useState(() =>
    Date.now(),
  );
  useEffect(() => {
    const currentMessageIds = new Set(
      items
        .filter((item) => item.kind === "message")
        .map((item) => item.id),
    );
    const seenAtByItemId = transientRuntimeReconnectSeenAtByItemIdRef.current;
    for (const itemId of seenAtByItemId.keys()) {
      if (!currentMessageIds.has(itemId)) {
        seenAtByItemId.delete(itemId);
      }
    }
  }, [items]);
  const latestRuntimeReconnectItemId = useMemo(() => {
    let sawUserMessageAfterDiagnostic = false;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (!item || item.kind !== "message") {
        continue;
      }
      if (item.role === "user") {
        sawUserMessageAfterDiagnostic = true;
        continue;
      }
      if (item.role !== "assistant") {
        continue;
      }
      const runtimeReconnectHint = resolveAssistantRuntimeReconnectHint(
        item,
        Boolean(parseAgentTaskNotification(item.text)),
      );
      if (!runtimeReconnectHint) {
        return null;
      }
      if (runtimeReconnectHint.tone === "transient" && sawUserMessageAfterDiagnostic) {
        continue;
      }
      if (runtimeReconnectHint.tone === "transient") {
        const seenAtByItemId = transientRuntimeReconnectSeenAtByItemIdRef.current;
        const seenAt =
          seenAtByItemId.get(item.id) ?? transientRuntimeReconnectClock;
        if (!seenAtByItemId.has(item.id)) {
          seenAtByItemId.set(item.id, seenAt);
        }
        const autoDismissMs =
          runtimeReconnectHint.autoDismissMs ??
          TRANSIENT_RUNTIME_RECONNECT_AUTO_DISMISS_MS;
        if (transientRuntimeReconnectClock - seenAt >= autoDismissMs) {
          continue;
        }
      }
      return item.id;
    }
    return null;
  }, [items, transientRuntimeReconnectClock]);
  useEffect(() => {
    if (!latestRuntimeReconnectItemId) {
      return;
    }
    const item = items.find((candidate) => candidate.id === latestRuntimeReconnectItemId);
    if (!item || item.kind !== "message" || item.role !== "assistant") {
      return;
    }
    const runtimeReconnectHint = resolveAssistantRuntimeReconnectHint(
      item,
      Boolean(parseAgentTaskNotification(item.text)),
    );
    if (runtimeReconnectHint?.tone !== "transient") {
      return;
    }
    const seenAt =
      transientRuntimeReconnectSeenAtByItemIdRef.current.get(item.id) ??
      transientRuntimeReconnectClock;
    const autoDismissMs =
      runtimeReconnectHint.autoDismissMs ??
      TRANSIENT_RUNTIME_RECONNECT_AUTO_DISMISS_MS;
    const remainingMs = Math.max(0, seenAt + autoDismissMs - Date.now());
    const timeoutId = window.setTimeout(() => {
      setTransientRuntimeReconnectClock(Date.now());
    }, remainingMs);
    return () => window.clearTimeout(timeoutId);
  }, [items, latestRuntimeReconnectItemId, transientRuntimeReconnectClock]);
  const latestRetryMessage = useMemo(
    () => resolveRetryMessageForReconnectItem(items, latestRuntimeReconnectItemId),
    [items, latestRuntimeReconnectItemId],
  );
  const renderStartedAt =
    typeof performance === "undefined" ? 0 : performance.now();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 非流式期的「跟随窗口」deadline：打开会话钉底、对话结束回刷幕布落地，都在窗口内
  // 允许内容长高时把视口按回底部。isThinking 下降沿用于开启收尾窗口。
  const stickToBottomDeadlineRef = useRef(0);
  const settleRepinPrevThinkingRef = useRef(isThinking);
  const pendingHistoryExpansionModeRef = useRef<MessagesHistoryExpansionMode>(null);
  const messageNodeByIdRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const agentTaskNodeByTaskIdRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const agentTaskNodeByToolUseIdRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const autoScrollRef = useRef(true);
  const initialBottomPinScopeRef = useRef<string | null>(null);
  const anchorUpdateRafRef = useRef<number | null>(null);
  const lastRenderSnapshotRef = useRef<LastRenderSnapshot | null>(null);
  const preservedReadableWindowRef = useRef<PreservedReadableWindow>({
    threadId: null,
    turnId: null,
    renderedItems: [],
    visibleCollapsedHistoryItemCount: 0,
  });
  const [expandedItems, setExpandedItems] = useState<Set<string>>(() => new Set());
  const [selectedExitPlanExecutionByItemKey, setSelectedExitPlanExecutionByItemKey] = useState<
    Record<string, Extract<AccessMode, "default" | "full-access">>
  >({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [lightweightConversationKeys, setLightweightConversationKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [detailHydrationConversationKeys, setDetailHydrationConversationKeys] = useState<
    Set<string>
  >(() => new Set());
  const conversationLightweightModeEnabled = Boolean(
    conversationRenderModeKey && lightweightConversationKeys.has(conversationRenderModeKey),
  );
  const conversationDetailHydrationRequested = Boolean(
    conversationRenderModeKey && detailHydrationConversationKeys.has(conversationRenderModeKey),
  );
  const handleConversationLightweightModeEnable = useCallback(() => {
    if (!conversationRenderModeKey) {
      return;
    }
    setLightweightConversationKeys((previous) => {
      return addBoundedConversationRenderModeKey(previous, conversationRenderModeKey);
    });
    setDetailHydrationConversationKeys((previous) => {
      if (!previous.has(conversationRenderModeKey)) {
        return previous;
      }
      const next = new Set(previous);
      next.delete(conversationRenderModeKey);
      return next;
    });
  }, [conversationRenderModeKey]);
  const handleConversationDetailHydrationRequest = useCallback(() => {
    if (!conversationRenderModeKey) {
      return;
    }
    setDetailHydrationConversationKeys((previous) => {
      return addBoundedConversationRenderModeKey(previous, conversationRenderModeKey);
    });
    setLightweightConversationKeys((previous) => {
      if (!previous.has(conversationRenderModeKey)) {
        return previous;
      }
      const next = new Set(previous);
      next.delete(conversationRenderModeKey);
      return next;
    });
  }, [conversationRenderModeKey]);
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const activeAnchorIdRef = useRef<string | null>(null);
  const anchorLoopGuardRef = useRef<RenderLoopGuardBudget>(
    DEFAULT_RENDER_LOOP_GUARD_BUDGET,
  );
  const [showAllHistoryItems, setShowAllHistoryItems] = useState(false);
  const [historyExpansionMode, setHistoryExpansionMode] =
    useState<MessagesHistoryExpansionMode>(null);
  const [pendingJumpMessageId, setPendingJumpMessageId] = useState<string | null>(null);
  const [liveAutoFollowEnabled, setLiveAutoFollowEnabled] = useState(() =>
    readLocalBooleanFlag(MESSAGES_LIVE_AUTO_FOLLOW_FLAG_KEY, true),
  );
  const [collapseLiveMiddleStepsEnabled, setCollapseLiveMiddleStepsEnabled] = useState(() =>
    readLocalBooleanFlag(MESSAGES_LIVE_COLLAPSE_MIDDLE_STEPS_FLAG_KEY, false),
  );
  const liveAutoFollowEnabledRef = useRef(liveAutoFollowEnabled);
  liveAutoFollowEnabledRef.current = liveAutoFollowEnabled;
  const collapseLiveMiddleStepsEnabledRef = useRef(collapseLiveMiddleStepsEnabled);
  collapseLiveMiddleStepsEnabledRef.current = collapseLiveMiddleStepsEnabled;
  const legacyClaudeReasoningDockEnabled =
    activeEngine === "claude" &&
    typeof claudeThinkingVisible !== "boolean" &&
    shouldHideClaudeReasoningModule();
  const hideClaudeReasoning =
    activeEngine === "claude" &&
    (typeof claudeThinkingVisible === "boolean"
      ? !claudeThinkingVisible
      : legacyClaudeReasoningDockEnabled);
  const [isSelectionFrozen, setIsSelectionFrozen] = useState(false);
  const enableCollaborationBadge = activeEngine === "codex";
  const copyTimeoutRef = useRef<number | null>(null);
  const planPanelFocusRafRef = useRef<number | null>(null);
  const planPanelFocusTimeoutRef = useRef<number | null>(null);
  const planPanelFocusNodeRef = useRef<HTMLElement | null>(null);
  const assistantFinalizingTimerRef = useRef<number | null>(null);
  const assistantFinalizingCompleteRenderedIdRef = useRef<string | null>(null);
  const lastVisibleTextReportRef = useRef<LastVisibleTextReport>({
    itemId: null,
    visibleTextLength: 0,
    reportedAt: 0,
  });
  const lastStreamSurfaceDiagnosticKeyRef = useRef<string | null>(null);
  const previousAssistantThinkingRef = useRef(isThinking);
  const previousAssistantThreadIdRef = useRef(threadId);
  const resourceCleanupThreadIdRef = useRef(threadId);
  const frozenItemsRef = useRef<ConversationItem[] | null>(null);
  const latestItemsRef = useRef(items);
  latestItemsRef.current = items;
  const [finalizingAssistantMessageId, setFinalizingAssistantMessageId] = useState<string | null>(null);
  const exitPlanDedupeCacheRef = useRef<{
    baseItems: ConversationItem[];
    result: ConversationItem[];
  } | null>(null);
  const effectiveItems = useMemo(() => {
    const baseItems = isSelectionFrozen
      ? frozenItemsRef.current ?? items
      : items;
    const cache = exitPlanDedupeCacheRef.current;
    if (cache && isTrailingMessageTextOnlyUpdate(cache.baseItems, baseItems)) {
      // dedupe 只会移除 exit-plan 工具条目,末尾的 "message" 条目必然原样透传,
      // 因此只需把结果数组的最后一项替换为最新引用,无需重新扫描整段历史。
      // 尾项引用未变时(如选区冻结触发的引用级重算)必须原样返回缓存:此时尾项
      // 可能是被去重掉的 exit-plan 条目,写回结果末尾会丢真尾项、复活重复项。
      const nextLast = baseItems[baseItems.length - 1];
      const result =
        cache.baseItems[cache.baseItems.length - 1] === nextLast ||
        cache.result[cache.result.length - 1] === nextLast
          ? cache.result
          : [...cache.result.slice(0, -1), nextLast];
      exitPlanDedupeCacheRef.current = { baseItems, result };
      return result;
    }
    const result = dedupeExitPlanItemsKeepFirst(baseItems);
    exitPlanDedupeCacheRef.current = { baseItems, result };
    return result;
  }, [isSelectionFrozen, items]);
  const messageActionTargetsCacheRef = useRef<{
    baseItems: ConversationItem[];
    result: MessageActionTargets;
  } | null>(null);
  const messageActionTargets = useMemo(() => {
    const cache = messageActionTargetsCacheRef.current;
    if (cache && isTrailingMessageTextOnlyUpdate(cache.baseItems, effectiveItems)) {
      messageActionTargetsCacheRef.current = { baseItems: effectiveItems, result: cache.result };
      return cache.result;
    }
    const result = buildMessageActionTargets(effectiveItems);
    messageActionTargetsCacheRef.current = { baseItems: effectiveItems, result };
    return result;
  }, [effectiveItems]);
  const liveTailWorkingSet = useMemo(
    () =>
      buildLiveTailWorkingSet(effectiveItems, {
        isThinking,
        showAllHistoryItems,
        // 流式期裁到 live 尾窗（buildLiveTailWorkingSet 仅在 isThinking 时裁剪）；
        // show all 只在 idle 恢复全量，避免展开历史后每个 token 都重跑完整 timeline。
        visibleWindow: STREAMING_VISIBLE_WINDOW,
        enableCollaborationBadge,
      }),
    [effectiveItems, enableCollaborationBadge, isThinking, showAllHistoryItems],
  );
  const renderSourceItems = liveTailWorkingSet.items;
  // 跨 token 稳定引用:供 handleAssistantVisibleTextRender 在回调体内读取最新条目,
  // 而不必把每 token 换新引用的 renderSourceItems 放进 useCallback 依赖。render 期
  // 同步赋值,读取不滞后一帧。不复用 latestItemsRef(=未 windowing 的原始 items),
  // 以免 codex finalizing 分支的 targetTextLength 语义漂移。
  const renderSourceItemsRef = useRef(renderSourceItems);
  renderSourceItemsRef.current = renderSourceItems;
  const renderSourceSnapshot = useMemo(
    () => ({
      scopeKey: renderScopeKey,
      items: renderSourceItems,
    }),
    [renderScopeKey, renderSourceItems],
  );
  const deferredRenderSourceSnapshot = useDeferredValue(renderSourceSnapshot);
  const deferredRenderSourceItems =
    deferredRenderSourceSnapshot.scopeKey === renderScopeKey
      ? deferredRenderSourceSnapshot.items
      : renderSourceItems;
  const firstItemIdRef = useRef<string | null>(items[0]?.id ?? null);
  const activeUserInputRequest = resolveActiveUserInputRequest({
    requests: userInputRequests,
    threadId,
    workspaceId,
  });
  const activeUserInputRequestId = activeUserInputRequest?.request_id ?? null;
  const activeUserInputAnchorItemId =
    activeUserInputRequest?.params.item_id?.trim() || null;
  const rawScrollKey = buildMessagesScrollKey(effectiveItems, activeUserInputRequestId);
  // Throttle scrollKey during streaming to avoid flooding the main thread
  // with smooth-scroll animations that block keyboard input.
  const [scrollKey, setScrollKey] = useState(rawScrollKey);
  const [, startScrollKeyTransition] = useTransition();
  const scrollThrottleRef = useRef<number>(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (scrollThrottleRef.current) {
      window.clearTimeout(scrollThrottleRef.current);
    }
    scrollThrottleRef.current = window.setTimeout(() => {
      if (!mountedRef.current || typeof window === "undefined") {
        return;
      }
      startScrollKeyTransition(() => {
        setScrollKey((current) => (current === rawScrollKey ? current : rawScrollKey));
      });
    }, isThinking ? 120 : 0);
    return () => {
      if (scrollThrottleRef.current) {
        window.clearTimeout(scrollThrottleRef.current);
      }
    };
  }, [rawScrollKey, isThinking, startScrollKeyTransition]);
  const { openFileLink, showFileLinkMenu, fileLinkMenu, closeFileLinkMenu } = useFileLinkOpener(
    workspacePath,
    openTargets,
    selectedOpenAppId,
    onOpenWorkspaceFile,
  );

  const isNearBottom = useCallback(
    (node: HTMLDivElement) => isMessagesScrollNearBottom(node, SCROLL_THRESHOLD_PX),
    [],
  );

  const computeActiveAnchor = useCallback(() => {
    return resolveActiveMessageAnchor(containerRef.current, messageNodeByIdRef.current);
  }, []);

  const requestAutoScroll = useCallback(() => {
    if (!liveAutoFollowEnabled || !isWorking) {
      return;
    }
    // Respect a manual scroll-up: never yank the user back to the bottom.
    if (!autoScrollRef.current || !containerRef.current) {
      return;
    }
    // Always instant for programmatic scroll requests to avoid blocking input.
    scrollContainerToBottom(containerRef.current);
  }, [isWorking, liveAutoFollowEnabled]);

  const rearmAutoFollowToBottom = useCallback(() => {
    autoScrollRef.current = true;
    if (containerRef.current) {
      scrollContainerToBottom(containerRef.current);
    }
  }, []);

  const scrollToAgentTaskCard = useCallback((request: AgentTaskScrollRequest | null) => {
    if (!request) {
      return;
    }
    const container = containerRef.current;
    const node =
      (request.taskId
        ? agentTaskNodeByTaskIdRef.current.get(request.taskId)
        : null) ??
      (request.toolUseId
        ? agentTaskNodeByToolUseIdRef.current.get(request.toolUseId)
        : null);
    if (!node || !container) {
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const targetTop =
      container.scrollTop + (nodeRect.top - containerRect.top) - container.clientHeight * 0.22;
    autoScrollRef.current = false;
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    const previousThreadId = resourceCleanupThreadIdRef.current;
    const threadChanged = previousThreadId !== threadId;
    const pendingResourceCounts = {
      anchorRaf: anchorUpdateRafRef.current !== null ? 1 : 0,
      planFocusRaf: planPanelFocusRafRef.current !== null ? 1 : 0,
      planFocusTimer: planPanelFocusTimeoutRef.current !== null ? 1 : 0,
      assistantFinalizingTimer: assistantFinalizingTimerRef.current !== null ? 1 : 0,
      copyTimer: copyTimeoutRef.current !== null ? 1 : 0,
      scrollThrottleTimer: scrollThrottleRef.current ? 1 : 0,
      messageNodeCount: messageNodeByIdRef.current.size,
      agentTaskNodeCount:
        agentTaskNodeByTaskIdRef.current.size + agentTaskNodeByToolUseIdRef.current.size,
    };
    autoScrollRef.current = true;
    setExpandedItems((previous) => (previous.size === 0 ? previous : new Set()));
    setIsSelectionFrozen(false);
    frozenItemsRef.current = null;
    pendingHistoryExpansionModeRef.current = null;
    setHistoryExpansionMode(null);
    activeAnchorIdRef.current = null;
    anchorLoopGuardRef.current = DEFAULT_RENDER_LOOP_GUARD_BUDGET;
    if (typeof window !== "undefined") {
      if (anchorUpdateRafRef.current !== null) {
        window.cancelAnimationFrame(anchorUpdateRafRef.current);
        anchorUpdateRafRef.current = null;
      }
      if (planPanelFocusRafRef.current !== null) {
        window.cancelAnimationFrame(planPanelFocusRafRef.current);
        planPanelFocusRafRef.current = null;
      }
      if (planPanelFocusTimeoutRef.current !== null) {
        window.clearTimeout(planPanelFocusTimeoutRef.current);
        planPanelFocusTimeoutRef.current = null;
      }
      if (assistantFinalizingTimerRef.current !== null) {
        window.clearTimeout(assistantFinalizingTimerRef.current);
        assistantFinalizingTimerRef.current = null;
      }
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
        copyTimeoutRef.current = null;
      }
      if (scrollThrottleRef.current) {
        window.clearTimeout(scrollThrottleRef.current);
        scrollThrottleRef.current = 0;
      }
    }
    if (threadChanged) {
      appendRendererDiagnostic("messages/render-resource-cleanup", {
        surface: "conversation",
        component: "Messages",
        workspaceId: workspaceId ?? null,
        previousThreadId,
        threadId,
        pendingResourceCounts,
      });
    }
    resourceCleanupThreadIdRef.current = threadId;
    setFinalizingAssistantMessageId(null);
    setActiveAnchorId(null);
    previousAssistantThinkingRef.current = false;
    previousAssistantThreadIdRef.current = threadId;
  }, [threadId, workspaceId]);
  useEffect(() => {
    scrollToAgentTaskCard(agentTaskScrollRequest);
  }, [agentTaskScrollRequest, scrollToAgentTaskCard]);
  useEffect(() => {
    const handleSelectionChange = () => {
      const nextFrozen = isSelectionInsideNode(window.getSelection(), containerRef.current);
      if (nextFrozen) {
        frozenItemsRef.current = frozenItemsRef.current ?? latestItemsRef.current;
      } else {
        frozenItemsRef.current = null;
      }
      setIsSelectionFrozen((previous) => (previous === nextFrozen ? previous : nextFrozen));
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, []);
  useEffect(() => {
    if (!isSelectionFrozen) {
      frozenItemsRef.current = null;
    }
  }, [isSelectionFrozen, items]);

  useEffect(() => {
    writeLocalBooleanFlag(MESSAGES_LIVE_AUTO_FOLLOW_FLAG_KEY, liveAutoFollowEnabled);
  }, [liveAutoFollowEnabled]);

  useEffect(() => {
    writeLocalBooleanFlag(
      MESSAGES_LIVE_COLLAPSE_MIDDLE_STEPS_FLAG_KEY,
      collapseLiveMiddleStepsEnabled,
    );
  }, [collapseLiveMiddleStepsEnabled]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleLiveControlsUpdated = (
      event: Event,
    ) => {
      const customEvent = event as CustomEvent<{
        liveAutoFollowEnabled?: boolean;
        collapseLiveMiddleStepsEnabled?: boolean;
      }>;
      const detail = customEvent.detail;
      if (!detail) {
        return;
      }
      if (typeof detail.liveAutoFollowEnabled === "boolean") {
        const nextLiveAutoFollowEnabled = detail.liveAutoFollowEnabled;
        const wasLiveAutoFollowEnabled = liveAutoFollowEnabledRef.current;
        if (wasLiveAutoFollowEnabled !== nextLiveAutoFollowEnabled) {
          liveAutoFollowEnabledRef.current = nextLiveAutoFollowEnabled;
          setLiveAutoFollowEnabled(nextLiveAutoFollowEnabled);
        }
        if (!wasLiveAutoFollowEnabled && nextLiveAutoFollowEnabled && isWorking) {
          rearmAutoFollowToBottom();
        }
      }
      if (typeof detail.collapseLiveMiddleStepsEnabled === "boolean") {
        const nextCollapseLiveMiddleStepsEnabled = detail.collapseLiveMiddleStepsEnabled;
        if (collapseLiveMiddleStepsEnabledRef.current !== nextCollapseLiveMiddleStepsEnabled) {
          collapseLiveMiddleStepsEnabledRef.current = nextCollapseLiveMiddleStepsEnabled;
          setCollapseLiveMiddleStepsEnabled(nextCollapseLiveMiddleStepsEnabled);
        }
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (!event.key) {
        return;
      }
      if (event.key === MESSAGES_LIVE_AUTO_FOLLOW_FLAG_KEY) {
        const nextLiveAutoFollowEnabled = readLocalBooleanFlag(
          MESSAGES_LIVE_AUTO_FOLLOW_FLAG_KEY,
          true,
        );
        if (liveAutoFollowEnabledRef.current !== nextLiveAutoFollowEnabled) {
          liveAutoFollowEnabledRef.current = nextLiveAutoFollowEnabled;
          setLiveAutoFollowEnabled(nextLiveAutoFollowEnabled);
        }
        return;
      }
      if (event.key === MESSAGES_LIVE_COLLAPSE_MIDDLE_STEPS_FLAG_KEY) {
        const nextCollapseLiveMiddleStepsEnabled = readLocalBooleanFlag(
          MESSAGES_LIVE_COLLAPSE_MIDDLE_STEPS_FLAG_KEY,
          false,
        );
        if (collapseLiveMiddleStepsEnabledRef.current !== nextCollapseLiveMiddleStepsEnabled) {
          collapseLiveMiddleStepsEnabledRef.current = nextCollapseLiveMiddleStepsEnabled;
          setCollapseLiveMiddleStepsEnabled(nextCollapseLiveMiddleStepsEnabled);
        }
      }
    };
    window.addEventListener(
      MESSAGES_LIVE_CONTROLS_UPDATED_EVENT,
      handleLiveControlsUpdated as EventListener,
    );
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(
        MESSAGES_LIVE_CONTROLS_UPDATED_EVENT,
        handleLiveControlsUpdated as EventListener,
      );
      window.removeEventListener("storage", handleStorage);
    };
  }, [isWorking, rearmAutoFollowToBottom]);
  useEffect(() => {
    if (!liveAutoFollowEnabled || !isWorking) {
      return;
    }
    autoScrollRef.current = true;
    requestAutoScroll();
  }, [isWorking, liveAutoFollowEnabled, requestAutoScroll]);
  useEffect(() => {
    const currentFirstId = effectiveItems[0]?.id ?? null;
    if (currentFirstId !== firstItemIdRef.current) {
      setShowAllHistoryItems(false);
      setHistoryExpansionMode(null);
      setPendingJumpMessageId(null);
      pendingHistoryExpansionModeRef.current = null;
    }
    firstItemIdRef.current = currentFirstId;
  }, [effectiveItems]);
  const toggleExpanded = useCallback((id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);
  const handleExitPlanModeExecuteForItem = useCallback(
    async (
      itemId: string,
      mode: Extract<AccessMode, "default" | "full-access">,
    ) => {
      const selectionKey = `${threadId ?? "no-thread"}:${itemId}`;
      setSelectedExitPlanExecutionByItemKey((prev) => {
        if (prev[selectionKey] === mode) {
          return prev;
        }
        return {
          ...prev,
          [selectionKey]: mode,
        };
      });
      await onExitPlanModeExecute?.(mode);
    },
    [onExitPlanModeExecute, threadId],
  );
  useEffect(() => {
    if (isThinking) {
      return;
    }
    setExpandedItems((prev) => collapseExpandedExploreItems(prev, effectiveItems));
  }, [effectiveItems, isThinking]);

  // Auto-expand the latest reasoning block during streaming (synced with idea-claude-code-gui)
  const lastAutoExpandedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isThinking) {
      lastAutoExpandedIdRef.current = null;
      return;
    }

    const reasoningIds: string[] = [];
    for (const item of renderSourceItems) {
      if (item.kind === "reasoning") {
        reasoningIds.push(item.id);
      }
    }

    if (reasoningIds.length === 0) return;

    const lastReasoningId = reasoningIds[reasoningIds.length - 1] ?? null;

    if (lastReasoningId !== lastAutoExpandedIdRef.current) {
      setExpandedItems((prev) => {
        const next = new Set<string>();
        // Only expand the latest reasoning block, collapse all others
        if (lastReasoningId) {
          next.add(lastReasoningId);
        }
        // Preserve non-reasoning expanded items
        for (const id of prev) {
          const isReasoning = reasoningIds.includes(id);
          if (!isReasoning) {
            next.add(id);
          }
        }
        return areStringSetsEqual(prev, next) ? prev : next;
      });
      lastAutoExpandedIdRef.current = lastReasoningId;
    }
  }, [isThinking, renderSourceItems]);
  const reasoningMetaById = useMemo(() => {
    const meta = new Map<string, ReturnType<typeof parseReasoning>>();
    deferredRenderSourceItems.forEach((item) => {
      if (item.kind === "reasoning") {
        meta.set(item.id, parseReasoning(item));
      }
    });
    return meta;
  }, [deferredRenderSourceItems]);

  const lastUserMessageIndex = useMemo(
    () => findLastUserMessageIndex(deferredRenderSourceItems),
    [deferredRenderSourceItems],
  );
  const liveSourceLastUserMessageIndex = useMemo(
    () => findLastUserMessageIndex(renderSourceItems),
    [renderSourceItems],
  );
  const reasoningWindowStartIndex = useMemo(() => {
    if (lastUserMessageIndex >= 0) {
      return lastUserMessageIndex;
    }
    return findLastAssistantMessageIndex(deferredRenderSourceItems);
  }, [deferredRenderSourceItems, lastUserMessageIndex]);

  const latestReasoningLabel = useMemo(() => {
    if (hideClaudeReasoning) {
      return null;
    }
    for (
      let index = deferredRenderSourceItems.length - 1;
      index > reasoningWindowStartIndex;
      index -= 1
    ) {
      const item = deferredRenderSourceItems[index];
      if (!isReasoningConversationItem(item)) {
        continue;
      }
      const parsed = reasoningMetaById.get(item.id);
      if (parsed?.workingLabel) {
        return parsed.workingLabel;
      }
    }
    return null;
  }, [
    deferredRenderSourceItems,
    hideClaudeReasoning,
    reasoningMetaById,
    reasoningWindowStartIndex,
  ]);

  const latestReasoningId = useMemo(() => {
    for (
      let index = deferredRenderSourceItems.length - 1;
      index > reasoningWindowStartIndex;
      index -= 1
    ) {
      const item = deferredRenderSourceItems[index];
      if (isReasoningConversationItem(item)) {
        return item.id;
      }
    }
    return null;
  }, [deferredRenderSourceItems, reasoningWindowStartIndex]);
  const claudeDockedReasoningItems = useMemo(() => {
    if (!legacyClaudeReasoningDockEnabled) {
      return [] as Array<{
        item: Extract<ConversationItem, { kind: "reasoning" }>;
        parsed: ReturnType<typeof parseReasoning>;
      }>;
    }
    const list: Array<{
      item: Extract<ConversationItem, { kind: "reasoning" }>;
      parsed: ReturnType<typeof parseReasoning>;
    }> = [];
    for (
      let index = reasoningWindowStartIndex + 1;
      index < deferredRenderSourceItems.length;
      index += 1
    ) {
      const item = deferredRenderSourceItems[index];
      if (!isReasoningConversationItem(item)) {
        continue;
      }
      const parsed = reasoningMetaById.get(item.id);
      if (!parsed) {
        continue;
      }
      const hasText =
        Boolean(parsed.bodyText?.trim()) ||
        Boolean(item.content?.trim()) ||
        Boolean(item.summary?.trim());
      if (!hasText) {
        continue;
      }
      list.push({ item, parsed });
    }
    return list;
  }, [
    deferredRenderSourceItems,
    legacyClaudeReasoningDockEnabled,
    reasoningMetaById,
    reasoningWindowStartIndex,
  ]);
  const previousIsThinkingRef = useRef(isThinking);
  useEffect(() => {
    if (previousIsThinkingRef.current && !isThinking && claudeDockedReasoningItems.length > 0) {
      setExpandedItems((prev) => {
        const reasoningIds = new Set(claudeDockedReasoningItems.map((entry) => entry.item.id));
        let changed = false;
        const next = new Set(prev);
        for (const id of reasoningIds) {
          if (next.delete(id)) {
            changed = true;
          }
        }
        if (!changed) {
          return prev;
        }
        return next;
      });
    }
    previousIsThinkingRef.current = isThinking;
  }, [claudeDockedReasoningItems, isThinking]);

  const latestTitleOnlyReasoningId = useMemo(() => {
    for (let index = deferredRenderSourceItems.length - 1; index >= 0; index -= 1) {
      const item = deferredRenderSourceItems[index];
      if (!isReasoningConversationItem(item)) {
        continue;
      }
      const parsed = reasoningMetaById.get(item.id);
      if (parsed?.workingLabel && !parsed.hasBody) {
        return item.id;
      }
    }
    return null;
  }, [deferredRenderSourceItems, reasoningMetaById]);

  const latestWorkingActivityLabel = useMemo(() => {
    let lastUserIndex = -1;
    for (let index = deferredRenderSourceItems.length - 1; index >= 0; index -= 1) {
      const item = deferredRenderSourceItems[index];
      if (isUserMessageConversationItem(item)) {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0) {
      return null;
    }
    for (
      let index = deferredRenderSourceItems.length - 1;
      index > lastUserIndex;
      index -= 1
    ) {
      const item = deferredRenderSourceItems[index];
      if (!item) {
        continue;
      }
      if (isAssistantMessageConversationItem(item)) {
        break;
      }
      const label = resolveWorkingActivityLabel(item, activeEngine, presentationProfile);
      if (label) {
        return label;
      }
    }
    return null;
  }, [activeEngine, deferredRenderSourceItems, presentationProfile]);
  const approvalResumeWorkingLabel = useMemo(() => {
    if (!isThinking || lastUserMessageIndex < 0) {
      return null;
    }
    const resumeText = t("approval.resumingAfterApproval");
    for (
      let index = deferredRenderSourceItems.length - 1;
      index > lastUserMessageIndex;
      index -= 1
    ) {
      const item = deferredRenderSourceItems[index];
      if (!item) {
        continue;
      }
      if (isAssistantMessageConversationItem(item)) {
        break;
      }
      if (
        item.kind === "tool" &&
        item.toolType === "fileChange" &&
        item.status === "running"
      ) {
        return item.output?.trim() || resumeText;
      }
    }
    return null;
  }, [deferredRenderSourceItems, isThinking, lastUserMessageIndex, t]);

  const latestAssistantMessageId = useMemo(
    () => findLatestAssistantMessageIdAfterIndex(
      deferredRenderSourceItems,
      lastUserMessageIndex,
    ),
    [deferredRenderSourceItems, lastUserMessageIndex],
  );
  const latestLiveSourceAssistantMessageId = useMemo(
    () => findLatestAssistantMessageIdAfterIndex(
      renderSourceItems,
      liveSourceLastUserMessageIndex,
    ),
    [liveSourceLastUserMessageIndex, renderSourceItems],
  );
  const assistantFinalizingCandidateId =
    latestLiveSourceAssistantMessageId ?? latestAssistantMessageId;
  const supportsAssistantFinalizingWindow =
    activeEngine === "claude" || activeEngine === "codex";
  const isAssistantCompletionFrame =
    supportsAssistantFinalizingWindow &&
    previousAssistantThreadIdRef.current === threadId &&
    previousAssistantThinkingRef.current &&
    !isThinking &&
    assistantFinalizingCandidateId !== null;
  const liveAssistantMessageId = isThinking
    ? assistantFinalizingCandidateId
    : finalizingAssistantMessageId ?? (
        isAssistantCompletionFrame ? assistantFinalizingCandidateId : null
      );
  const isAssistantFinalizing =
    !isThinking &&
    liveAssistantMessageId !== null;
  // 供内容高度观察器（见下方 ResizeObserver）读取，避免它随每次流式状态变化重挂。
  const isWorkingRef = useRef(isWorking);
  isWorkingRef.current = isWorking;
  const isAssistantFinalizingRef = useRef(isAssistantFinalizing);
  isAssistantFinalizingRef.current = isAssistantFinalizing;
  useEffect(() => {
    const previouslyThinking = previousAssistantThinkingRef.current;
    previousAssistantThreadIdRef.current = threadId;
    previousAssistantThinkingRef.current = isThinking;
    if (!supportsAssistantFinalizingWindow) {
      if (assistantFinalizingTimerRef.current !== null) {
        window.clearTimeout(assistantFinalizingTimerRef.current);
        assistantFinalizingTimerRef.current = null;
      }
      assistantFinalizingCompleteRenderedIdRef.current = null;
      if (finalizingAssistantMessageId !== null) {
        setFinalizingAssistantMessageId(null);
      }
      return;
    }
    if (isThinking) {
      if (assistantFinalizingTimerRef.current !== null) {
        window.clearTimeout(assistantFinalizingTimerRef.current);
        assistantFinalizingTimerRef.current = null;
      }
      assistantFinalizingCompleteRenderedIdRef.current = null;
      if (finalizingAssistantMessageId !== null) {
        setFinalizingAssistantMessageId(null);
      }
      return;
    }
    if (!previouslyThinking || !assistantFinalizingCandidateId) {
      return;
    }
    setFinalizingAssistantMessageId((current) =>
      current === assistantFinalizingCandidateId
        ? current
        : assistantFinalizingCandidateId,
    );
    if (assistantFinalizingTimerRef.current !== null) {
      window.clearTimeout(assistantFinalizingTimerRef.current);
    }
    assistantFinalizingCompleteRenderedIdRef.current = null;
    const finalizingWindowMs =
      activeEngine === "codex"
        ? CODEX_FINALIZING_LIVE_WINDOW_MS
        : ASSISTANT_FINALIZING_LIVE_WINDOW_MS;
    assistantFinalizingTimerRef.current = window.setTimeout(() => {
      assistantFinalizingTimerRef.current = null;
      assistantFinalizingCompleteRenderedIdRef.current = null;
      setFinalizingAssistantMessageId((current) =>
        current === assistantFinalizingCandidateId ? null : current,
      );
    }, finalizingWindowMs);
  }, [
    activeEngine,
    assistantFinalizingCandidateId,
    finalizingAssistantMessageId,
    isThinking,
    supportsAssistantFinalizingWindow,
    threadId,
  ]);
  useEffect(() => () => {
    if (assistantFinalizingTimerRef.current !== null) {
      window.clearTimeout(assistantFinalizingTimerRef.current);
      assistantFinalizingTimerRef.current = null;
    }
    assistantFinalizingCompleteRenderedIdRef.current = null;
  }, []);
  useEffect(() => {
    lastVisibleTextReportRef.current = {
      itemId: null,
      visibleTextLength: 0,
      reportedAt: 0,
    };
  }, [activeTurnId, threadId]);

  const waitingForFirstChunk = useMemo(() => {
    if (!isThinking || deferredRenderSourceItems.length === 0) {
      return false;
    }
    let lastUserIndex = -1;
    for (let index = deferredRenderSourceItems.length - 1; index >= 0; index -= 1) {
      const item = deferredRenderSourceItems[index];
      if (isUserMessageConversationItem(item)) {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0) {
      return false;
    }
    for (
      let index = lastUserIndex + 1;
      index < deferredRenderSourceItems.length;
      index += 1
    ) {
      const item = deferredRenderSourceItems[index];
      if (isAssistantMessageConversationItem(item)) {
        return false;
      }
    }
    return true;
  }, [deferredRenderSourceItems, isThinking]);
  const streamActivityPhase = useStreamActivityPhase({
    isProcessing:
      isThinking &&
      (activeEngine === "codex" || activeEngine === "claude" || activeEngine === "gemini"),
    items: deferredRenderSourceItems,
  });
  // 把对话页当前的流式状态 / 可见行数写入性能上下文桥,供掉帧 / 长任务采集器在
  // 掉帧瞬间附带"当时在干什么"。廉价 effect,仅在派生值变化时触发。
  useEffect(() => {
    setPerfStreamingState({
      isStreaming: isThinking,
      streamActivityPhase: streamActivityPhase ? String(streamActivityPhase) : null,
      visibleRowCount: renderSourceItems.length,
    });
  }, [isThinking, streamActivityPhase, renderSourceItems.length]);
  const codexSilentSuspectedLabel =
    activeEngine === "codex" && codexSilentSuspectedAt !== null
      ? t("messages.codexSilentSuspected")
      : null;
  const codexWaitingForFirstTextLabel =
    activeEngine === "codex" && isThinking && waitingForFirstChunk
      ? t("messages.codexWaitingForFirstText")
      : null;
  const primaryWorkingLabel = isContextCompacting
    ? t("chat.contextDualViewCompacting")
    : codexSilentSuspectedLabel ??
      codexWaitingForFirstTextLabel ??
      approvalResumeWorkingLabel;
  const enableClaudeRenderSafeMode =
    (isWindowsDesktop || isMacDesktop) &&
    activeEngine === "claude" &&
    isThinking;

  const visibleItems = useMemo(
    () =>
      resolveVisibleMessageItems({
        items: deferredRenderSourceItems,
        activeEngine,
        hideClaudeReasoning,
        latestTitleOnlyReasoningId,
        presentationProfile,
        reasoningMetaById,
      }),
    [
      activeEngine,
      deferredRenderSourceItems,
      hideClaudeReasoning,
      latestTitleOnlyReasoningId,
      presentationProfile,
      reasoningMetaById,
    ],
  );
  const timelineSourceItems = useMemo(() => {
    if (activeEngine !== "codex" || !isThinking) {
      return visibleItems;
    }
    return suppressCompletedExploreItemsBetweenLatestUserTurns(visibleItems, {
      enableCollaborationBadge,
    });
  }, [activeEngine, enableCollaborationBadge, isThinking, visibleItems]);
  const { timelineItems, collapsedMiddleStepCount } = useMemo(
    () =>
      resolveCollapsedTimelineItems({
        activeEngine,
        collapseLiveMiddleStepsEnabled,
        isThinking,
        latestAssistantMessageId,
        latestReasoningId,
        timelineSourceItems,
      }),
    [
      activeEngine,
      collapseLiveMiddleStepsEnabled,
      isThinking,
      latestAssistantMessageId,
      latestReasoningId,
      timelineSourceItems,
    ],
  );
  const latestReasoningVisibleInTimeline = useMemo(() => {
    if (!latestReasoningId) {
      return false;
    }
    return timelineItems.some((item) => item.kind === "reasoning" && item.id === latestReasoningId);
  }, [latestReasoningId, timelineItems]);
  const workingIndicatorShowsActivityLabel = shouldDisplayWorkingActivityLabel(
    latestReasoningLabel,
    latestWorkingActivityLabel,
  );
  const workingIndicatorReasoningLabel =
    activeEngine === "claude"
    && latestAssistantMessageId === null
    && workingIndicatorShowsActivityLabel
    && latestReasoningVisibleInTimeline
      ? null
      : latestReasoningLabel;
  useEffect(() => {
    if (activeEngine !== "claude") {
      return;
    }
    logClaudeRender("visible-items", {
      threadId,
      effectiveCount: effectiveItems.length,
      visibleCount: visibleItems.length,
      reasoningIds: visibleItems
        .filter((item) => item.kind === "reasoning")
        .map((item) => item.id),
      assistantIds: visibleItems
        .filter(
          (item): item is Extract<ConversationItem, { kind: "message" }> =>
            item.kind === "message" && item.role === "assistant",
        )
        .map((item) => item.id),
      latestReasoningId,
      latestAssistantMessageId,
      isThinking,
    });
  }, [
    activeEngine,
    effectiveItems.length,
    isThinking,
    latestAssistantMessageId,
    latestReasoningId,
    threadId,
    visibleItems,
  ]);
  const timelineCollapsedHistoryItemCount =
    !showAllHistoryItems && timelineItems.length > VISIBLE_MESSAGE_WINDOW
      ? timelineItems.length - VISIBLE_MESSAGE_WINDOW
      : 0;
  const collapsedHistoryItemCount =
    liveTailWorkingSet.omittedBeforeWorkingSetCount + timelineCollapsedHistoryItemCount;
  const renderedItemsWindow = useMemo(
    () =>
      buildRenderedItemsWindow(
        timelineItems,
        timelineCollapsedHistoryItemCount,
        liveTailWorkingSet.preservedUserMessageId,
      ),
    [
      liveTailWorkingSet.preservedUserMessageId,
      timelineCollapsedHistoryItemCount,
      timelineItems,
    ],
  );
  const renderedItems = renderedItemsWindow.renderedItems;
  const visibleCollapsedHistoryItemCount = collapsedHistoryItemCount > 0
    ? renderedItemsWindow.visibleCollapsedHistoryItemCount
      + liveTailWorkingSet.omittedBeforeWorkingSetCount
    : 0;
  const messagesPresentationMode = resolveMessagesPresentationMode({
    historyExpansionMode,
    isWorking,
    showAllHistoryItems,
    visibleCollapsedHistoryItemCount,
  });
  const currentLatestAssistantTextLength = useMemo(
    () => findLatestAssistantTextLength(renderedItems),
    [renderedItems],
  );
  useEffect(() => {
    const currentThreadId = threadId ?? null;
    const currentTurnId = activeTurnId;
    if (
      preservedReadableWindowRef.current.threadId !== currentThreadId ||
      preservedReadableWindowRef.current.turnId !== currentTurnId
    ) {
      preservedReadableWindowRef.current = {
        threadId: currentThreadId,
        turnId: currentTurnId,
        renderedItems: renderedItems.length > 0 ? renderedItems : [],
        visibleCollapsedHistoryItemCount:
          renderedItems.length > 0 ? visibleCollapsedHistoryItemCount : 0,
      };
      return;
    }
    if (renderedItems.length > 0) {
      if (readableWindowRecoveryActive) {
        return;
      }
      preservedReadableWindowRef.current = {
        threadId: currentThreadId,
        turnId: currentTurnId,
        renderedItems,
        visibleCollapsedHistoryItemCount,
      };
      return;
    }
    if (!isThinking) {
      preservedReadableWindowRef.current = {
        threadId: currentThreadId,
        turnId: null,
        renderedItems: [],
        visibleCollapsedHistoryItemCount: 0,
      };
    }
  }, [
    activeTurnId,
    isThinking,
    readableWindowRecoveryActive,
    renderedItems,
    threadId,
    visibleCollapsedHistoryItemCount,
  ]);
  const preservedReadableWindowSnapshot = preservedReadableWindowRef.current;
  const preservedLatestAssistantTextLength = findLatestAssistantTextLength(
    preservedReadableWindowSnapshot.renderedItems,
  );
  const hasPreservedReadableWindow =
    (readableWindowRecoveryActive || supportsStreamingReadableWindowRecovery) &&
    preservedReadableWindowSnapshot.threadId === (threadId ?? null) &&
    preservedReadableWindowSnapshot.turnId === activeTurnId &&
    preservedReadableWindowSnapshot.renderedItems.length > 0;
  const renderChainBlankingRegressionActive =
    supportsStreamingReadableWindowRecovery &&
    isThinking &&
    effectiveItems.length > 0 &&
    renderedItems.length === 0;
  const shouldUseReadableWindowRecovery =
    hasPreservedReadableWindow &&
    (
      renderChainBlankingRegressionActive ||
      (blankingRecoveryActive && renderedItems.length === 0) ||
      (
        visibleStallRecoveryActive &&
        currentLatestAssistantTextLength > 0 &&
        currentLatestAssistantTextLength < preservedLatestAssistantTextLength
      )
    );
  const recoveredReadableWindow = useMemo(() => {
    if (!shouldUseReadableWindowRecovery) {
      return null;
    }
    return {
      renderedItems: mergeReadableRecoveryItems(
        preservedReadableWindowSnapshot.renderedItems,
        renderedItems,
      ),
      visibleCollapsedHistoryItemCount:
        preservedReadableWindowSnapshot.visibleCollapsedHistoryItemCount,
    };
  }, [preservedReadableWindowSnapshot, renderedItems, shouldUseReadableWindowRecovery]);
  const presentationRenderedItems = shouldUseReadableWindowRecovery
    ? recoveredReadableWindow?.renderedItems ?? renderedItems
    : renderedItems;
  const presentationCollapsedHistoryItemCount = shouldUseReadableWindowRecovery
    ? recoveredReadableWindow?.visibleCollapsedHistoryItemCount ?? visibleCollapsedHistoryItemCount
    : visibleCollapsedHistoryItemCount;
  const presentationScopeKey = buildMessagesPresentationScopeKey({
    scopeKey: renderScopeKey,
    mode: messagesPresentationMode,
    collapsedHistoryItemCount: presentationCollapsedHistoryItemCount,
    itemCount: presentationRenderedItems.length,
    firstItemId: presentationRenderedItems[0]?.id ?? null,
    lastItemId: presentationRenderedItems.at(-1)?.id ?? null,
  });
  const claudeRenderableEntryCount = useMemo(
    () => countRenderableCollapsedEntries(timelineItems, activeEngine),
    [activeEngine, timelineItems],
  );
  const claudeHistoryTranscriptFallbackActive = useMemo(() => {
    if (activeEngine !== "claude" || isThinking || isHistoryLoading) {
      return false;
    }
    if (conversationState?.meta.historyRestoredAtMs == null) {
      return false;
    }
    if (claudeRenderableEntryCount > 0) {
      return false;
    }
    return isClaudeHistoryTranscriptHeavy(timelineItems);
  }, [
    activeEngine,
    claudeRenderableEntryCount,
    conversationState?.meta.historyRestoredAtMs,
    isHistoryLoading,
    isThinking,
    timelineItems,
  ]);
  const presentationRenderSnapshot = useMemo(
    () => ({
      scopeKey: presentationScopeKey,
      items: presentationRenderedItems,
    }),
    [presentationRenderedItems, presentationScopeKey],
  );
  const deferredPresentationRenderSnapshot = useDeferredValue(
    presentationRenderSnapshot,
  );
  const deferredPresentationRenderedItems =
    deferredPresentationRenderSnapshot.scopeKey === presentationScopeKey
      ? deferredPresentationRenderSnapshot.items
      : presentationRenderedItems;
  const shouldStabilizePresentationItems =
    supportsStreamingReadableWindowRecovery &&
    (isThinking || isAssistantFinalizing);
  const livePresentationOverrideItemIds = useMemo(() => {
    if (!liveAssistantMessageId) {
      return undefined;
    }
    return new Set([liveAssistantMessageId]);
  }, [liveAssistantMessageId]);
  const timelinePresentationItems = useMemo(() => {
    if (claudeHistoryTranscriptFallbackActive) {
      return timelineItems;
    }
    // Keep timeline-heavy derivations on a stable snapshot so long Codex/Claude
    // streams do not re-run grouping/anchors/boundaries on every text delta.
    // The live assistant/reasoning rows still override from renderSourceItems.
    return resolveStreamingPresentationItems(
      deferredPresentationRenderedItems,
      presentationRenderedItems,
      shouldStabilizePresentationItems,
      livePresentationOverrideItemIds,
      {
        deferredScopeKey: deferredPresentationRenderSnapshot.scopeKey,
        currentScopeKey: presentationScopeKey,
      },
    );
  }, [
    claudeHistoryTranscriptFallbackActive,
    deferredPresentationRenderSnapshot.scopeKey,
    deferredPresentationRenderedItems,
    livePresentationOverrideItemIds,
    presentationRenderedItems,
    presentationScopeKey,
    shouldStabilizePresentationItems,
    timelineItems,
  ]);
  const hiddenClaudeReasoningOnly =
    activeEngine === "claude" &&
    hideClaudeReasoning &&
    deferredRenderSourceItems.length > 0 &&
    deferredRenderSourceItems.every(isReasoningConversationItem) &&
    timelinePresentationItems.length === 0 &&
    claudeDockedReasoningItems.length === 0;
  const liveAssistantItem = useMemo(
    () => {
      const item = findItemById(renderSourceItems, liveAssistantMessageId);
      if (!item || !isAssistantMessageConversationItem(item)) {
        return null;
      }
      return item;
    },
    [liveAssistantMessageId, renderSourceItems],
  );
  const liveReasoningItem = useMemo(
    () => {
      if (!isThinking) {
        return null;
      }
      const item = findItemById(renderSourceItems, latestReasoningId);
      if (!item || !isReasoningConversationItem(item)) {
        return null;
      }
      return item;
    },
    [isThinking, latestReasoningId, renderSourceItems],
  );
  useEffect(() => {
    if (!threadId || !isThinking) {
      lastStreamSurfaceDiagnosticKeyRef.current = null;
      return;
    }
    const shouldReportSurface =
      visibleStallRecoveryActive ||
      shouldUseReadableWindowRecovery ||
      renderChainBlankingRegressionActive;
    if (!shouldReportSurface) {
      return;
    }
    const liveAssistantTextLength = liveAssistantItem?.text.length ?? 0;
    const diagnosticKey = [
      threadId,
      activeTurnId ?? "no-turn",
      threadStreamLatencySnapshot?.latencyCategory ?? "no-category",
      renderedItems.length,
      presentationRenderedItems.length,
      timelinePresentationItems.length,
      renderSourceItems.length,
      liveAssistantItem?.id ?? "no-live-assistant",
      liveAssistantTextLength,
      shouldUseReadableWindowRecovery ? "recovery" : "observe",
    ].join(":");
    if (lastStreamSurfaceDiagnosticKeyRef.current === diagnosticKey) {
      return;
    }
    lastStreamSurfaceDiagnosticKeyRef.current = diagnosticKey;
    appendRendererDiagnostic("messages/stream-surface-diagnostic", {
      threadId,
      turnId: activeTurnId,
      engine: activeEngine,
      latencyCategory: threadStreamLatencySnapshot?.latencyCategory ?? null,
      renderedItemsCount: renderedItems.length,
      presentationRenderedItemsCount: presentationRenderedItems.length,
      timelinePresentationItemsCount: timelinePresentationItems.length,
      renderSourceItemsCount: renderSourceItems.length,
      visibleStallRecoveryActive,
      readableWindowRecoveryActive,
      shouldUseReadableWindowRecovery,
      renderChainBlankingRegressionActive,
      liveAssistantItemId: liveAssistantItem?.id ?? null,
      liveAssistantTextLength,
      liveReasoningItemId: liveReasoningItem?.id ?? null,
      preservedReadableWindowItemsCount:
        preservedReadableWindowSnapshot.renderedItems.length,
      preservedLatestAssistantTextLength,
    });
  }, [
    activeEngine,
    activeTurnId,
    isThinking,
    liveAssistantItem,
    liveReasoningItem,
    preservedLatestAssistantTextLength,
    preservedReadableWindowSnapshot.renderedItems.length,
    presentationRenderedItems.length,
    readableWindowRecoveryActive,
    renderChainBlankingRegressionActive,
    renderSourceItems.length,
    renderedItems.length,
    shouldUseReadableWindowRecovery,
    threadId,
    threadStreamLatencySnapshot?.latencyCategory,
    timelinePresentationItems.length,
    visibleStallRecoveryActive,
  ]);
  const messageAnchors = useMemo(() => {
    const messageItems = timelinePresentationItems.filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "user",
    );
    if (!messageItems.length) {
      return [];
    }
    return messageItems.map((item) => ({
      id: item.id,
      role: item.role,
      title: deriveAnchorTitle(item.text),
    }));
  }, [timelinePresentationItems]);
  const suppressedUserNoteCardContextMessageIds = useMemo(
    () => buildSuppressedUserNoteCardContextMessageIdSet(timelinePresentationItems),
    [timelinePresentationItems],
  );
  const suppressedUserMemoryContextMessageIds = useMemo(
    () => buildSuppressedUserMemoryContextMessageIdSet(timelinePresentationItems),
    [timelinePresentationItems],
  );
  const hasAnchorRail = showMessageAnchors && messageAnchors.length > 0;
  const commitActiveAnchorId = useCallback(
    (nextActiveAnchor: string | null, reason: "scroll" | "sync") => {
      const signature = [
        "anchor",
        reason,
        nextActiveAnchor ?? "none",
        messageAnchors.length,
      ].join(":");
      const guard = resolveIdempotentRenderLoopGuard({
        previous: anchorLoopGuardRef.current,
        signature,
        changed: activeAnchorIdRef.current !== nextActiveAnchor,
        now: Date.now(),
      });
      anchorLoopGuardRef.current = guard.nextBudget;
      if (!guard.shouldCommit) {
        if (guard.shouldDiagnose) {
          appendRendererDiagnostic("messages/overlay-loop-guard", {
            surface: "anchor-rail",
            component: "Messages",
            reason,
            threadId,
            workspaceId: workspaceId ?? null,
            rowKind: "message-anchor",
            counter: guard.suppressedCount,
            threshold: "idempotent-state-write",
            anchorCount: messageAnchors.length,
          });
        }
        return;
      }
      activeAnchorIdRef.current = nextActiveAnchor;
      setActiveAnchorId(nextActiveAnchor);
    },
    [messageAnchors.length, threadId, workspaceId],
  );
  const scheduleAnchorUpdate = useCallback(
    (reason: "scroll" | "sync") => {
      if (!hasAnchorRail) {
        return;
      }
      if (anchorUpdateRafRef.current !== null) {
        return;
      }
      anchorUpdateRafRef.current = window.requestAnimationFrame(() => {
        anchorUpdateRafRef.current = null;
        const anchorStartedAt =
          typeof performance === "undefined" ? 0 : performance.now();
        const container = containerRef.current;
        const latestAnchorId = messageAnchors[messageAnchors.length - 1]?.id ?? null;
        const nextActiveAnchor =
          container && isNearBottom(container)
            ? latestAnchorId
            : computeActiveAnchor() ?? latestAnchorId;
        const elapsedMs =
          typeof performance === "undefined"
            ? 0
            : performance.now() - anchorStartedAt;
        if (elapsedMs >= MESSAGES_SLOW_ANCHOR_WARN_MS) {
          logMessagesPerf("anchor.compute", {
            ms: Number(elapsedMs.toFixed(2)),
            reason,
            anchorCount: messageAnchors.length,
            threadId,
          });
        }
        commitActiveAnchorId(nextActiveAnchor, reason);
      });
    },
    [
      commitActiveAnchorId,
      computeActiveAnchor,
      hasAnchorRail,
      isNearBottom,
      messageAnchors,
      threadId,
    ],
  );
  const revealAllHistoryItems = useCallback((mode: "manual" | "jump") => {
    pendingHistoryExpansionModeRef.current = mode;
    setHistoryExpansionMode(mode);
    setShowAllHistoryItems(true);
  }, []);
  const handleShowAllHistoryItems = useCallback(() => {
    revealAllHistoryItems("manual");
  }, [revealAllHistoryItems]);
  useLayoutEffect(() => {
    if (!showAllHistoryItems) {
      pendingHistoryExpansionModeRef.current = null;
      return;
    }
    const pendingExpansionMode = pendingHistoryExpansionModeRef.current;
    const container = containerRef.current;
    if (!pendingExpansionMode || !container) {
      return;
    }
    pendingHistoryExpansionModeRef.current = null;
    if (pendingExpansionMode === "manual") {
      autoScrollRef.current = false;
      container.scrollTop = 0;
    }
    scheduleAnchorUpdate("sync");
  }, [
    timelinePresentationItems,
    scheduleAnchorUpdate,
    showAllHistoryItems,
  ]);
  const updateAutoScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    // Auto-follow tracks the user's real scroll position: stick to the bottom
    // only while the viewport is actually near the bottom. Scrolling up cancels
    // the follow; scrolling back to the bottom re-enables it.
    autoScrollRef.current = isNearBottom(container);
    scheduleAnchorUpdate("scroll");
  }, [
    isNearBottom,
    scheduleAnchorUpdate,
  ]);
  const clearTransientUiState = useCallback(() => {
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = null;
    }
    if (anchorUpdateRafRef.current !== null) {
      window.cancelAnimationFrame(anchorUpdateRafRef.current);
      anchorUpdateRafRef.current = null;
    }
    if (planPanelFocusRafRef.current !== null) {
      window.cancelAnimationFrame(planPanelFocusRafRef.current);
      planPanelFocusRafRef.current = null;
    }
    if (planPanelFocusTimeoutRef.current !== null) {
      window.clearTimeout(planPanelFocusTimeoutRef.current);
      planPanelFocusTimeoutRef.current = null;
    }
    if (planPanelFocusNodeRef.current) {
      planPanelFocusNodeRef.current.classList.remove("plan-panel-focus-ring");
      planPanelFocusNodeRef.current = null;
    }
    messageNodeByIdRef.current.clear();
    agentTaskNodeByTaskIdRef.current.clear();
    agentTaskNodeByToolUseIdRef.current.clear();
  }, []);

  useEffect(() => {
    if (!isMessagesPerfDebugEnabled()) {
      return;
    }
    const renderCostMs =
      typeof performance === "undefined"
        ? 0
        : performance.now() - renderStartedAt;
    const previous = lastRenderSnapshotRef.current;
    const changedKeys: string[] = [];
    if (previous) {
      if (previous.items !== effectiveItems) {
        changedKeys.push("items");
      }
      if (previous.userInputRequests !== userInputRequests) {
        changedKeys.push("userInputRequests");
      }
      if (previous.conversationState !== conversationState) {
        changedKeys.push("conversationState");
      }
      if (previous.presentationProfile !== presentationProfile) {
        changedKeys.push("presentationProfile");
      }
      if (previous.isThinking !== isThinking) {
        changedKeys.push("isThinking");
      }
      if (previous.heartbeatPulse !== heartbeatPulse) {
        changedKeys.push("heartbeatPulse");
      }
      if (previous.threadId !== threadId) {
        changedKeys.push("threadId");
      }
    }
    if (
      renderCostMs >= MESSAGES_SLOW_RENDER_WARN_MS ||
      changedKeys.includes("conversationState") ||
      changedKeys.includes("presentationProfile")
    ) {
      logMessagesPerf("render", {
        ms: Number(renderCostMs.toFixed(2)),
        items: effectiveItems.length,
        visibleItems: renderedItems.length,
        anchors: messageAnchors.length,
        threadId,
        changed: changedKeys,
      });
    }
    lastRenderSnapshotRef.current = {
      items: effectiveItems,
      userInputRequests,
      conversationState,
      presentationProfile,
      isThinking,
      heartbeatPulse,
      threadId,
    };
  });

  useEffect(() => {
    if (
      (activeEngine !== "claude" && activeEngine !== "codex" && activeEngine !== "gemini") ||
      (!isThinking && !isAssistantFinalizing) ||
      !threadId
    ) {
      return;
    }
    noteThreadVisibleRender(threadId, {
      visibleItemCount: renderedItems.length,
    });
  }, [activeEngine, isAssistantFinalizing, isThinking, renderedItems.length, threadId]);

  const handleAssistantVisibleTextRender = useCallback(
    (payload: { itemId: string; visibleText: string }) => {
      if (
        (activeEngine !== "claude" && activeEngine !== "codex" && activeEngine !== "gemini") ||
        (!isThinking && !isAssistantFinalizing) ||
        !threadId
      ) {
        return;
      }
      const visibleTextLength = payload.visibleText.length;
      let targetTextLength = 0;
      if (
        activeEngine === "codex" &&
        isAssistantFinalizing &&
        payload.itemId === finalizingAssistantMessageId
      ) {
        const targetItem = renderSourceItemsRef.current.find(
          (item) =>
            isAssistantMessageConversationItem(item) &&
            item.id === payload.itemId,
        );
        targetTextLength =
          targetItem && isAssistantMessageConversationItem(targetItem)
            ? targetItem.text.length
            : 0;
      }
      const previousReport = lastVisibleTextReportRef.current;
      const isNewAssistantItem = previousReport.itemId !== payload.itemId;
      const visibleTextGrew =
        isNewAssistantItem || visibleTextLength > previousReport.visibleTextLength;
      if (visibleTextGrew) {
        const now = Date.now();
        const shouldReport =
          isNewAssistantItem ||
          visibleTextLength <= VISIBLE_TEXT_REPORT_EAGER_PREFIX_CHARS ||
          visibleTextLength - previousReport.visibleTextLength >=
            VISIBLE_TEXT_REPORT_MIN_GROWTH_CHARS ||
          now - previousReport.reportedAt >= VISIBLE_TEXT_REPORT_MIN_INTERVAL_MS ||
          (targetTextLength > 0 && visibleTextLength >= targetTextLength);
        if (shouldReport) {
          noteThreadVisibleTextRendered(threadId, {
            itemId: payload.itemId,
            visibleTextLength,
            renderAt: now,
          });
          lastVisibleTextReportRef.current = {
            itemId: payload.itemId,
            visibleTextLength,
            reportedAt: now,
          };
        }
      }
      if (
        activeEngine === "codex" &&
        isAssistantFinalizing &&
        payload.itemId === finalizingAssistantMessageId &&
        targetTextLength > 0 &&
        visibleTextLength >= targetTextLength &&
        assistantFinalizingCompleteRenderedIdRef.current !== payload.itemId
      ) {
        assistantFinalizingCompleteRenderedIdRef.current = payload.itemId;
        if (assistantFinalizingTimerRef.current !== null) {
          window.clearTimeout(assistantFinalizingTimerRef.current);
        }
        const completedAssistantMessageId = payload.itemId;
        assistantFinalizingTimerRef.current = window.setTimeout(() => {
          assistantFinalizingTimerRef.current = null;
          assistantFinalizingCompleteRenderedIdRef.current = null;
          setFinalizingAssistantMessageId((current) =>
            current === completedAssistantMessageId ? null : current,
          );
        }, ASSISTANT_FINALIZING_LIVE_WINDOW_MS);
      }
    },
    [
      activeEngine,
      finalizingAssistantMessageId,
      isAssistantFinalizing,
      isThinking,
      threadId,
    ],
  );

  useEffect(() => clearTransientUiState, [clearTransientUiState]);

  useEffect(() => {
    if (!hasAnchorRail) {
      if (anchorUpdateRafRef.current !== null) {
        window.cancelAnimationFrame(anchorUpdateRafRef.current);
        anchorUpdateRafRef.current = null;
      }
      activeAnchorIdRef.current = null;
      anchorLoopGuardRef.current = DEFAULT_RENDER_LOOP_GUARD_BUDGET;
      setActiveAnchorId((current) => (current === null ? current : null));
      return;
    }
    scheduleAnchorUpdate("sync");
  }, [hasAnchorRail, messageAnchors, scheduleAnchorUpdate, scrollKey, threadId]);

  const handleCopyMessage = useCallback(
    async (
      item: Extract<ConversationItem, { kind: "message" }>,
      copyText?: string,
    ) => {
      try {
        await navigator.clipboard.writeText(copyText ?? item.text);
        setCopiedMessageId(item.id);
        if (copyTimeoutRef.current) {
          window.clearTimeout(copyTimeoutRef.current);
        }
        copyTimeoutRef.current = window.setTimeout(() => {
          setCopiedMessageId(null);
        }, 1200);
      } catch {
        // No-op: clipboard errors can occur in restricted contexts.
      }
    },
    [],
  );

  useEffect(() => {
    if (!bottomRef.current) {
      return undefined;
    }
    if (!liveAutoFollowEnabled || (!isWorking && !isAssistantFinalizing)) {
      return undefined;
    }
    const container = containerRef.current;
    // Follow new content only when the user is parked at the bottom. A manual
    // scroll up flips autoScrollRef off (see updateAutoScroll) and stops the
    // pull-to-bottom; scrolling back down re-arms it.
    const shouldScroll =
      autoScrollRef.current || (container ? isNearBottom(container) : true);
    if (!shouldScroll) {
      return undefined;
    }
    let raf = 0;
    const target = bottomRef.current;
    // Use instant scroll during streaming to avoid blocking the main thread
    // with smooth-scroll animations that compete with keyboard input events.
    const scrollBehavior =
      isThinking || isAssistantFinalizing ? "instant" as const : "smooth" as const;
    raf = window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: scrollBehavior, block: "end" });
    });
    return () => {
      if (raf) {
        window.cancelAnimationFrame(raf);
      }
    };
  }, [
    isAssistantFinalizing,
    isNearBottom,
    isThinking,
    isWorking,
    liveAutoFollowEnabled,
    scrollKey,
  ]);

  // Opening a thread should land the viewport at the bottom (latest messages),
  // matching chat conventions. Runs once per workspace+thread once history
  // content is actually rendered; live auto-follow and anchor jumps own all
  // subsequent scrolling.
  useLayoutEffect(() => {
    const scope = `${workspaceId ?? ""}\u0000${threadId}`;
    if (initialBottomPinScopeRef.current === scope) {
      return undefined;
    }
    if (isHistoryLoading || timelinePresentationItems.length === 0) {
      return undefined;
    }
    if (pendingJumpMessageId) {
      initialBottomPinScopeRef.current = scope;
      return undefined;
    }
    if (isWorking || isThinking) {
      return undefined;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }
    initialBottomPinScopeRef.current = scope;
    autoScrollRef.current = true;
    scrollContainerToBottom(container);
    // 落位只对此刻的高度有效：虚拟化行还是估算高度、content-visibility:auto 的屏外行
    // 要进视口才真实布局，底部长消息被系统性低估（估高封顶 260px，真实常上千）。
    // 开一个跟随窗口，让下方的内容高度观察器把迟到的测量一路追到底。
    stickToBottomDeadlineRef.current = Date.now() + INITIAL_BOTTOM_PIN_BUDGET_MS;
  }, [
    isHistoryLoading,
    isThinking,
    isWorking,
    pendingJumpMessageId,
    threadId,
    timelinePresentationItems,
    workspaceId,
  ]);

  // 对话结束（isThinking true→false）后开一个收尾跟随窗口：live 尾窗回刷成全量
  // timeline 时几百条历史带着估算高度插进列表，scrollHeight 暴涨；且全量渲染源经
  // useDeferredValue 延后数帧才落地。窗口内的高度变化都由观察器钉回底部。
  useEffect(() => {
    const wasThinking = settleRepinPrevThinkingRef.current;
    settleRepinPrevThinkingRef.current = isThinking;
    if (wasThinking && !isThinking) {
      stickToBottomDeadlineRef.current = Date.now() + SETTLE_REPIN_WINDOW_MS;
    }
  }, [isThinking]);

  // ── 底部跟随的真正驱动：内容高度变化 ───────────────────────────────────
  // 曾经唯一的驱动是依赖 scrollKey 的 auto-follow effect，而 scrollKey 由 items 末条的
  // text.length 算出。正文外部化（liveAssistantTextChannel）之后流式 delta 不再进
  // reducer，items 不变 → scrollKey 不变 → 整个流式期一次都不触发，视口被越长越高的
  // 正文甩在半空，用户每轮都得手动滚到底。虚拟化行的迟到测量、content-visibility 屏外
  // 行进视口才布局也一样：只改高度，不改 items。
  //
  // 所以改由 ResizeObserver 盯住内容盒的真实高度：只要跟随仍 armed（用户 parked 在
  // 底部）且处于跟随窗口（流式中 / 收尾中 / 打开会话的钉底窗口内），就把视口按在底部。
  // 命令式写 scrollTop，不进 state / 不重渲染；空闲期内容不变 → 回调不触发，零开销。
  //
  // 交还控制权走 wheel 而不是只等 scroll：流式期观察器每帧都在写 scrollTop，而 scroll
  // 事件是异步派发的。只靠 updateAutoScroll 的话，一旦某帧的高度变化抢在 scroll 送达
  // 之前，用户刚滚上去就被当场拽回底部——表现是「滚不走」。wheel 在滚动生效前同步到达，
  // 向上滚立即解除跟随；向下滚回底部时由 scroll 的 isNearBottom 重新武装。
  // ponytail: 只覆盖 wheel（桌面主场景）。键盘 PageUp / 触屏拖拽仍靠 scroll 事件滞后一帧
  // 解除，它们不是每帧连续的，不会和高度变化持续抢跑；真要根治得改成 scrollend 语义。
  useEffect(() => {
    const container = containerRef.current;
    const content = container?.querySelector<HTMLElement>(".messages-timeline-root");
    if (!container || !content || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) {
        autoScrollRef.current = false;
      }
    };
    container.addEventListener("wheel", handleWheel, { passive: true });
    const observer = new ResizeObserver(() => {
      if (!liveAutoFollowEnabledRef.current || !autoScrollRef.current) {
        return;
      }
      const insideFollowWindow =
        isWorkingRef.current ||
        isAssistantFinalizingRef.current ||
        Date.now() <= stickToBottomDeadlineRef.current;
      if (!insideFollowWindow) {
        return;
      }
      scrollContainerToBottom(container);
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
      container.removeEventListener("wheel", handleWheel);
    };
    // threadId：切会话时重新绑定，避免时间线根节点被换掉后观察到已脱离文档的旧节点。
  }, [threadId]);

  const groupedEntries = useMemo(
    () => groupToolItems(timelinePresentationItems),
    [timelinePresentationItems],
  );
  const liveAutoExpandedExploreId = useMemo(
    () => resolveLiveAutoExpandedExploreId(groupedEntries, isThinking),
    [groupedEntries, isThinking],
  );
  useEffect(() => {
    if (!isThinking || liveAutoExpandedExploreId !== null) {
      return;
    }
    setExpandedItems((prev) => collapseExpandedExploreItems(prev, effectiveItems));
  }, [effectiveItems, isThinking, liveAutoExpandedExploreId]);
  const assistantFinalBoundarySet = useMemo(() => {
    return buildAssistantFinalBoundarySet(timelinePresentationItems);
  }, [timelinePresentationItems]);
  const turnFileChangesByBoundaryId = useMemo(() => {
    return buildTurnFileChangesByBoundaryId(timelinePresentationItems);
  }, [timelinePresentationItems]);
  const sessionFileChangesSummary = useMemo(() => {
    return mergeTurnFileChangesSummaries(turnFileChangesByBoundaryId.values());
  }, [turnFileChangesByBoundaryId]);
  const assistantLiveTurnFinalBoundarySuppressedSet = useMemo(() => {
    const ids = new Set<string>();
    if (!liveAssistantMessageId) {
      return ids;
    }
    let lastUserIndex = -1;
    for (let index = timelinePresentationItems.length - 1; index >= 0; index -= 1) {
      const entry = timelinePresentationItems[index];
      if (entry?.kind === "message" && entry.role === "user") {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0) {
      return ids;
    }
    for (
      let index = lastUserIndex + 1;
      index < timelinePresentationItems.length;
      index += 1
    ) {
      const entry = timelinePresentationItems[index];
      if (
        entry?.kind === "message" &&
        entry.role === "assistant" &&
        entry.isFinal === true &&
        assistantFinalBoundarySet.has(entry.id) &&
        (isThinking || entry.id === liveAssistantMessageId)
      ) {
        ids.add(entry.id);
      }
    }
    return ids;
  }, [assistantFinalBoundarySet, isThinking, liveAssistantMessageId, timelinePresentationItems]);

  const shouldRenderUserInputNode =
    (activeEngine === "codex" || activeEngine === "claude") &&
    Boolean(legacyOnUserInputSubmit);
  const visibleApprovals = useMemo(() => {
    return getVisibleApprovalsForThread(approvals, workspaceId, threadId);
  }, [approvals, threadId, workspaceId]);
  const approvalNode = (
    <MessagesInlineApproval
      approvals={visibleApprovals}
      workspaces={workspaces}
      onApprovalDecision={onApprovalDecision}
      onApprovalBatchAccept={onApprovalBatchAccept}
      onApprovalRemember={onApprovalRemember}
    />
  );
  const userInputNode = (
    <MessagesInlineUserInput
      requests={userInputRequests}
      activeThreadId={threadId ?? null}
      activeWorkspaceId={workspaceId ?? null}
      onSubmit={legacyOnUserInputSubmit}
      onDismiss={legacyOnUserInputDismiss}
      shouldRender={shouldRenderUserInputNode}
    />
  );
  const hasVisibleUserInputRequest =
    shouldRenderUserInputNode &&
    Boolean(legacyOnUserInputSubmit) &&
    activeUserInputRequestId !== null;
  const linkedConversationRun = useMemo(() => {
    if (!threadId) {
      return null;
    }
    return taskRuns
      .filter((run) =>
        run.linkedThreadId === threadId &&
        (!workspaceId || run.task.workspaceId === workspaceId),
      )
      .sort(compareTaskRunSurfacePriority)[0] ?? null;
  }, [taskRuns, threadId, workspaceId]);
  const linkedConversationRunSurface = linkedConversationRun
    ? describeTaskRunSurface(linkedConversationRun)
    : null;

  const scrollToAnchor = useCallback((messageId: string) => {
    const node = messageNodeByIdRef.current.get(messageId);
    const container = containerRef.current;
    if (!node || !container) {
      return false;
    }
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const targetTop =
      container.scrollTop + (nodeRect.top - containerRect.top) - container.clientHeight * 0.28;
    autoScrollRef.current = false;
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: "smooth",
    });
    commitActiveAnchorId(messageId, "sync");
    return true;
  }, [commitActiveAnchorId]);

  const requestScrollToAnchor = useCallback((messageId: string) => {
    if (scrollToAnchor(messageId)) {
      setPendingJumpMessageId(null);
      return;
    }
    setPendingJumpMessageId((previous) => (previous === messageId ? previous : messageId));
    if (!showAllHistoryItems) {
      revealAllHistoryItems("jump");
    }
  }, [revealAllHistoryItems, scrollToAnchor, showAllHistoryItems]);

  const handlePendingJumpTargetReady = useCallback((messageId: string) => {
    if (pendingJumpMessageId !== messageId) {
      return;
    }
    if (scrollToAnchor(messageId)) {
      setPendingJumpMessageId(null);
    }
  }, [pendingJumpMessageId, scrollToAnchor]);

  useEffect(() => {
    if (!pendingJumpMessageId) {
      return;
    }
    if (scrollToAnchor(pendingJumpMessageId)) {
      setPendingJumpMessageId(null);
    }
  }, [pendingJumpMessageId, timelinePresentationItems, scrollToAnchor]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }
    const handleJumpToMessage = (event: Event) => {
      const messageId =
        event instanceof CustomEvent && typeof event.detail === "string" ? event.detail : "";
      if (!messageId) {
        return;
      }
      requestScrollToAnchor(messageId);
    };
    document.addEventListener(MESSAGE_JUMP_EVENT_NAME, handleJumpToMessage);
    return () => {
      document.removeEventListener(MESSAGE_JUMP_EVENT_NAME, handleJumpToMessage);
    };
  }, [requestScrollToAnchor]);

  return (
    <div
      className={`messages-shell${hasAnchorRail ? " has-anchor-rail" : ""}${enableClaudeRenderSafeMode ? " claude-render-safe" : ""}`}
    >
      <MessagesAnchorRail
        activeAnchorId={activeAnchorId}
        anchors={messageAnchors}
        anchorNavigationLabel={t("messages.anchorNavigation")}
        getFallbackTitle={(index) => t("messages.anchorUserTitle", { index: index + 1 })}
        onScrollToAnchor={requestScrollToAnchor}
      />
      <div
        className="messages scrollable"
        ref={containerRef}
        onScroll={updateAutoScroll}
      >
        {linkedConversationRun && linkedConversationRunSurface ? (
          <div className={`messages-linked-run messages-linked-run--${linkedConversationRunSurface.severity}`}>
            <div>
              <span className="messages-linked-run-eyebrow">
                {t("messages.linkedRunEyebrow", "Linked run")}
              </span>
              <strong>{linkedConversationRun.task.title || linkedConversationRun.task.taskId}</strong>
              <span>
                {t(`taskCenter.status.${linkedConversationRun.status}`, linkedConversationRun.status)}
                {" · "}
                {linkedConversationRunSurface.summary ||
                  t("taskCenter.unavailable", "Unavailable")}
              </span>
            </div>
            <button
              type="button"
              onClick={() => dispatchOpenTaskRunEvent(linkedConversationRun.runId)}
            >
              {t("messages.openLinkedRun", "Open run detail")}
            </button>
          </div>
        ) : null}
        <MessagesTimeline
          activeCollaborationModeId={activeCollaborationModeId}
          activeEngine={activeEngine}
          activeUserInputAnchorItemId={activeUserInputAnchorItemId}
          activeUserInputRequestId={activeUserInputRequestId}
          agentTaskNodeByTaskIdRef={agentTaskNodeByTaskIdRef}
          agentTaskNodeByToolUseIdRef={agentTaskNodeByToolUseIdRef}
          approvalNode={approvalNode}
          assistantFinalBoundarySet={assistantFinalBoundarySet}
          assistantLiveTurnFinalBoundarySuppressedSet={assistantLiveTurnFinalBoundarySuppressedSet}
          bottomRef={bottomRef}
          claudeDockedReasoningItems={claudeDockedReasoningItems}
          collapseLiveMiddleStepsEnabled={collapseLiveMiddleStepsEnabled}
          collapsedMiddleStepCount={collapsedMiddleStepCount}
          codeBlockCopyUseModifier={codeBlockCopyUseModifier}
          copiedMessageId={copiedMessageId}
          effectiveItemsCount={timelinePresentationItems.length}
          expandedItems={expandedItems}
          groupedEntries={groupedEntries}
          liveAssistantItem={liveAssistantItem}
          liveReasoningItem={liveReasoningItem}
          handleCopyMessage={handleCopyMessage}
          messageActionTargetByAssistantId={messageActionTargets.targetByAssistantId}
          messageCopyTextByAssistantId={messageActionTargets.copyTextByAssistantId}
          latestFinalAssistantMessageId={messageActionTargets.latestFinalAssistantMessageId}
          hasPendingUserTurn={messageActionTargets.hasPendingUserTurn}
          pendingJumpMessageId={pendingJumpMessageId}
          onPendingJumpTargetReady={handlePendingJumpTargetReady}
          onForkFromMessage={onForkFromMessage}
          onRewindFromMessage={onRewindFromMessage}
          handleExitPlanModeExecuteForItem={handleExitPlanModeExecuteForItem}
          heartbeatPulse={heartbeatPulse}
          hiddenClaudeReasoningOnly={hiddenClaudeReasoningOnly}
          isHistoryLoading={isHistoryLoading}
          isThinking={isThinking}
          isWorking={isWorking}
          lastDurationMs={lastDurationMs}
          liveAssistantMessageId={liveAssistantMessageId}
          latestReasoningLabel={workingIndicatorReasoningLabel}
          latestReasoningId={latestReasoningId}
          latestRetryMessage={latestRetryMessage}
          latestRuntimeReconnectItemId={latestRuntimeReconnectItemId}
          latestWorkingActivityLabel={latestWorkingActivityLabel}
          liveAutoExpandedExploreId={liveAutoExpandedExploreId}
          conversationDetailHydrationRequested={conversationDetailHydrationRequested}
          conversationLightweightModeEnabled={conversationLightweightModeEnabled}
          messageNodeByIdRef={messageNodeByIdRef}
          onOpenDiffPath={onOpenDiffPath}
          onConversationDetailHydrationRequest={handleConversationDetailHydrationRequest}
          onConversationLightweightModeEnable={handleConversationLightweightModeEnable}
          onRecoverThreadRuntime={onRecoverThreadRuntime}
          onRecoverThreadRuntimeAndResend={onRecoverThreadRuntimeAndResend}
          onThreadRecoveryFork={onThreadRecoveryFork}
          onAssistantVisibleTextRender={handleAssistantVisibleTextRender}
          onShowAllHistoryItems={handleShowAllHistoryItems}
          openFileLink={openFileLink}
          presentationProfile={presentationProfile}
          primaryWorkingLabel={primaryWorkingLabel}
          processingStartedAt={processingStartedAt}
          proxyEnabled={proxyEnabled}
          proxyUrl={proxyUrl}
          reasoningMetaById={reasoningMetaById}
          requestAutoScroll={requestAutoScroll}
          selectedExitPlanExecutionByItemKey={selectedExitPlanExecutionByItemKey}
          scrollElementRef={containerRef}
          showFileLinkMenu={showFileLinkMenu}
          streamMitigationProfile={activeStreamMitigation}
          streamActivityPhase={streamActivityPhase}
          suppressedUserMemoryContextMessageIds={suppressedUserMemoryContextMessageIds}
          threadId={threadId}
          toggleExpanded={toggleExpanded}
          turnFileChangesByBoundaryId={turnFileChangesByBoundaryId}
          sessionFileChangesSummary={sessionFileChangesSummary}
          suppressedUserNoteCardContextMessageIds={suppressedUserNoteCardContextMessageIds}
          claudeHistoryTranscriptFallbackActive={claudeHistoryTranscriptFallbackActive}
          hasVisibleUserInputRequest={hasVisibleUserInputRequest}
          historyExpansionActive={showAllHistoryItems}
          presentationMode={messagesPresentationMode}
          presentationScopeKey={presentationScopeKey}
          userInputNode={userInputNode}
          visibleCollapsedHistoryItemCount={presentationCollapsedHistoryItemCount}
          waitingForFirstChunk={waitingForFirstChunk}
          workspaceId={workspaceId}
        />
      </div>
      <ScrollControl containerRef={containerRef} />
      {fileLinkMenu ? (
        <RendererContextMenu
          menu={fileLinkMenu}
          onClose={closeFileLinkMenu}
          className="renderer-context-menu messages-file-link-context-menu"
        />
      ) : null}
    </div>
  );
});
