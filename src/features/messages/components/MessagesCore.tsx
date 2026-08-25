import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { ConversationItem } from "../../../types";
import { isMacPlatform, isWindowsPlatform } from "../../../utils/platform";
import {
  noteThreadVisibleTextRendered,
  noteThreadVisibleRender,
  resolveActiveThreadStreamMitigation,
  useThreadStreamLatencySnapshot,
} from "../../threads/utils/streamLatencyDiagnostics";
import { useStreamActivityPhase } from "../../threads/hooks/useStreamActivityPhase";
import type { AgentTaskScrollRequest } from "../types";
import { getVisibleApprovalsForThread } from "../../../utils/approvalBatching";
import {
  MESSAGES_FORCE_PIN_BOTTOM_EVENT,
  MESSAGES_LIVE_AUTO_FOLLOW_FLAG_KEY,
  MESSAGES_LIVE_CONTROLS_UPDATED_EVENT,
  readLocalBooleanFlag,
  writeLocalBooleanFlag,
} from "../../../live-canvas/liveCanvasControls";
import {
  RendererContextMenu,
} from "../../../components/ui/RendererContextMenu";
import { appendRendererDiagnostic } from "../../../services/rendererDiagnostics";
import { MessagesTimeline } from "./MessagesTimeline";
import { MessagesAnchorRail } from "./conversation/MessagesAnchorRail";
import { ScrollControl, type ConversationScrollEdge } from "./conversation/ScrollControl";
import {
  MessagesInlineApproval,
  MessagesInlineUserInput,
} from "./conversation/MessagesInlinePrompts";
import {
  parseReasoning,
} from "../presentation/messagesReasoning";
import {
  buildLiveTailWorkingSet,
  suppressCompletedExploreItemsBetweenLatestUserTurns,
} from "../orchestration/presentation/messagesLiveWindow";
import {
  isAssistantMessageConversationItem,
  isReasoningConversationItem,
  isUserMessageConversationItem,
} from "../utils/messageItemPredicates";
import { parseAgentTaskNotification } from "@/contracts/agentTaskNotification";
import { dedupeExitPlanItemsKeepFirst } from "../utils/messagesExitPlan";
import {
  filterContextProtocolConversationItems,
  hasContextProtocolControlTail,
  isContextProtocolConversationItem,
} from "../../../utils/contextProtocol";
import {
  findLastAssistantMessageIndex,
  findLastUserMessageIndex,
  isMessagesPerfDebugEnabled,
  isSelectionInsideNode,
  logClaudeRender,
  logMessagesPerf,
  MESSAGES_SLOW_ANCHOR_WARN_MS,
  MESSAGES_SLOW_RENDER_WARN_MS,
  resolveWorkingActivityLabel,
  shouldDisplayWorkingActivityLabel,
  shouldHideClaudeReasoningModule,
  STREAMING_VISIBLE_WINDOW,
} from "../utils/messagesRenderUtils";
import {
  buildMessageActionTargets,
  buildMessagesScrollKey,
  resolveActiveUserInputRequest,
  resolveActiveMessageAnchor,
  resolveCollapsedTimelineItems,
  resolveVisibleMessageItems,
  type MessageActionTargets,
} from "../orchestration/presentation/messagesViewModel";
import {
  DEFAULT_RENDER_LOOP_GUARD_BUDGET,
  resolveIdempotentRenderLoopGuard,
  type RenderLoopGuardBudget,
} from "../timeline/virtualization/messagesRenderLoopGuards";
import { addBoundedConversationRenderModeKey } from "../presentation/messagesConversationLightweightMode";
import type { LastRenderSnapshot } from "../types/messagesTypes";
import type { MessagesCoreProps } from "../contracts/messagesInput";
import { useMessagesTimelineModels } from "../orchestration/hooks/useMessagesTimelineModels";
import { useMessagesAnchorNavigation } from "../orchestration/hooks/useMessagesAnchorNavigation";
import { useMessagesRuntimeState } from "../orchestration/hooks/useMessagesRuntimeState";
import {
  useMessagesHistoryPresentationWindow,
  useMessagesHistoryWindow,
} from "../orchestration/hooks/useMessagesHistoryWindow";
import { useMessagesPresentationState } from "../orchestration/hooks/useMessagesPresentationState";
import {
  isCanvasNearBottom,
  useMessagesCanvasFollow,
} from "../orchestration/hooks/useMessagesCanvasFollow";
import { useMessagesInteractions } from "../orchestration/hooks/useMessagesInteractions";
import { MessagesLinkedRunBanner } from "../orchestration/components/MessagesLinkedRunBanner";

const EMPTY_TASK_RUNS: NonNullable<MessagesCoreProps["runtime"]["taskRuns"]> = [];

const ANCHOR_TITLE_MAX_LENGTH = 60;
const ANCHOR_DESCRIPTION_MAX_LENGTH = 160;

function isAgentTaskNotificationText(text: string) {
  return Boolean(parseAgentTaskNotification(text));
}

/**
 * Derive bounded, plain-text copy for the anchor preview from the user
 * message only. Assistant rows remain outside this model so streaming output
 * cannot turn the navigation rail into another live render surface.
 */
function deriveAnchorPreviewCopy(text: string): {
  description?: string;
  title: string;
} {
  const normalizedLines = text
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const firstLine = normalizedLines[0] ?? "";
  const title =
    firstLine.length > ANCHOR_TITLE_MAX_LENGTH
      ? `${firstLine.slice(0, ANCHOR_TITLE_MAX_LENGTH)}…`
      : firstLine;
  const descriptionSource =
    normalizedLines.length > 1
      ? normalizedLines.slice(1).join(" ")
      : firstLine.slice(ANCHOR_TITLE_MAX_LENGTH).trim();
  const description =
    descriptionSource.length > ANCHOR_DESCRIPTION_MAX_LENGTH
      ? `${descriptionSource.slice(0, ANCHOR_DESCRIPTION_MAX_LENGTH)}…`
      : descriptionSource;
  return {
    title,
    ...(description ? { description } : {}),
  };
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

export const MessagesCore = memo(function MessagesCore({
  conversation,
  runtime,
  interactions,
  presentation,
}: MessagesCoreProps) {
  const { state: conversationState, workspacePath = null } = conversation;
  const {
    isHistoryLoading = false,
    historyLoadingProgress = null,
    historyRecoveryFailureReason = null,
    isContextCompacting = false,
    proxyEnabled = false,
    proxyUrl = null,
    processingStartedAt = null,
    lastDurationMs = null,
    codexSilentSuspectedAt = null,
    approvals = [],
    taskRuns = EMPTY_TASK_RUNS,
  } = runtime;
  const {
    onRetryHistory,
    onUserInputSubmit: legacyOnUserInputSubmit,
    onUserInputDismiss: legacyOnUserInputDismiss,
    onApprovalDecision,
    onApprovalBatchAccept,
    onApprovalRemember,
    onOpenDiffPath,
    onPreviewFileDiff,
    onOpenWorkspaceFile,
    onCaptureNote,
    onSaveAsPrompt: onSaveAsPromptOverride,
    onExitPlanModeExecute,
    onRecoverThreadRuntime,
    onRecoverThreadRuntimeAndResend,
    onThreadRecoveryFork,
    onForkFromMessage,
    onRewindFromMessage,
  } = interactions;
  const {
    openTargets,
    selectedOpenAppId,
    showMessageAnchors = true,
    codeBlockCopyUseModifier = false,
    workspaces = [],
    claudeThinkingVisible,
    activeCollaborationModeId = null,
    isPlanMode: _isPlanMode = false,
    isPlanProcessing: _isPlanProcessing = false,
    presentationProfile = null,
    agentTaskScrollRequest = null,
    timelineLeadingNode = null,
    timelineTrailingNode = null,
    renderHistoryFold,
    isProviderContinuation = false,
  } = presentation;
  const { t } = useTranslation();
  const isWindowsDesktop = useMemo(() => isWindowsPlatform(), []);
  const isMacDesktop = useMemo(() => isMacPlatform(), []);
  const items = conversationState.items;
  const userInputRequests = conversationState.userInputQueue;
  const workspaceId = conversationState.meta.workspaceId || null;
  const threadId = conversationState.meta.threadId || null;
  // 注意：不要在此处 closeSubagentInspector。
  // 右侧抽屉会嵌套挂载另一个 Messages（子 session threadId），若在这里按 thread 关抽屉，
  // 打开瞬间就会被嵌套实例关掉 → 闪屏。切会话关闭改由 SubagentChatSplit 只监听父幕布 scope。
  const nativeRuntimeRecoveryEnabled = !threadId?.startsWith("shared:");
  const activeTurnId = conversationState.meta.activeTurnId ?? null;
  const activeEngine = conversationState.meta.engine;
  const hideLeadingContinuationBootstrap =
    activeEngine === "codex" && isProviderContinuation;
  const renderScopeKey = `${workspaceId ?? ""}\u0000${threadId ?? ""}`;
  const conversationRenderModeKey =
    workspaceId && threadId ? `${workspaceId}\u0000${threadId}` : null;
  const isThinking = conversationState.meta.isThinking;
  const isWorking = isThinking || isContextCompacting;
  const heartbeatPulse = conversationState.meta.heartbeatPulse ?? 0;
  const {
    clearPendingJumpMessage,
    consumePendingHistoryExpansionMode,
    discardPendingHistoryExpansion,
    historyExpansionMode,
    pendingJumpMessageId,
    requestPendingJumpMessage,
    resetHistoryScope,
    revealAllHistoryItems,
    showAllHistoryItems,
  } = useMessagesHistoryWindow({ firstItemId: items[0]?.id ?? null });
  const renderStartedAt =
    typeof performance === "undefined" ? 0 : performance.now();
  const messageNodeByIdRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const agentTaskNodeByTaskIdRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const agentTaskNodeByToolUseIdRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const anchorUpdateRafRef = useRef<number | null>(null);
  const lastRenderSnapshotRef = useRef<LastRenderSnapshot | null>(null);
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
  const [liveAutoFollowEnabled, setLiveAutoFollowEnabled] = useState(() =>
    readLocalBooleanFlag(MESSAGES_LIVE_AUTO_FOLLOW_FLAG_KEY, true),
  );
  const [expandedProcessPhaseKeys, setExpandedProcessPhaseKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const liveAutoFollowEnabledRef = useRef(liveAutoFollowEnabled);
  liveAutoFollowEnabledRef.current = liveAutoFollowEnabled;
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
  const planPanelFocusRafRef = useRef<number | null>(null);
  const planPanelFocusTimeoutRef = useRef<number | null>(null);
  const planPanelFocusNodeRef = useRef<HTMLElement | null>(null);
  const lastStreamSurfaceDiagnosticKeyRef = useRef<string | null>(null);
  const resourceCleanupThreadIdRef = useRef(threadId);
  const frozenItemsRef = useRef<ConversationItem[] | null>(null);
  const latestItemsRef = useRef(items);
  latestItemsRef.current = items;
  const exitPlanDedupeCacheRef = useRef<{
    baseItems: ConversationItem[];
    result: ConversationItem[];
    hideLeadingContinuationBootstrap: boolean;
  } | null>(null);
  const effectiveItems = useMemo(() => {
    const baseItems = isSelectionFrozen
      ? frozenItemsRef.current ?? items
      : items;
    const cache = exitPlanDedupeCacheRef.current;
    if (
      cache &&
      cache.hideLeadingContinuationBootstrap ===
        hideLeadingContinuationBootstrap &&
      isTrailingMessageTextOnlyUpdate(cache.baseItems, baseItems)
    ) {
      // dedupe 只会移除 exit-plan 工具条目,末尾的 "message" 条目必然原样透传,
      // 因此只需把结果数组的最后一项替换为最新引用,无需重新扫描整段历史。
      // 尾项引用未变时(如选区冻结触发的引用级重算)必须原样返回缓存:此时尾项
      // 可能是被去重掉的 exit-plan 条目,写回结果末尾会丢真尾项、复活重复项。
      const nextLast = baseItems[baseItems.length - 1];
      if (
        isContextProtocolConversationItem(nextLast) ||
        hasContextProtocolControlTail(baseItems, {
          hideLeadingContinuationBootstrap,
        })
      ) {
        exitPlanDedupeCacheRef.current = {
          baseItems,
          result: cache.result,
          hideLeadingContinuationBootstrap,
        };
        return cache.result;
      }
      const result =
        cache.baseItems[cache.baseItems.length - 1] === nextLast ||
        cache.result[cache.result.length - 1] === nextLast
          ? cache.result
          : [...cache.result.slice(0, -1), nextLast];
      exitPlanDedupeCacheRef.current = {
        baseItems,
        result,
        hideLeadingContinuationBootstrap,
      };
      return result;
    }
    const result = dedupeExitPlanItemsKeepFirst(
      filterContextProtocolConversationItems(baseItems, {
        hideLeadingContinuationBootstrap,
      }),
    );
    exitPlanDedupeCacheRef.current = {
      baseItems,
      result,
      hideLeadingContinuationBootstrap,
    };
    return result;
  }, [hideLeadingContinuationBootstrap, isSelectionFrozen, items]);
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
  const turnBoundaryStateRef = useRef({
    isHistoryLoading,
    isWorking,
    pendingWorkingStartCovered: false,
    renderScopeKey,
    userMessageCount: messageActionTargets.userMessageCount,
  });
  const liveTailWorkingSet = useMemo(
    () =>
      buildLiveTailWorkingSet(effectiveItems, {
        isThinking,
        showAllHistoryItems,
        // STREAMING_VISIBLE_WINDOW<=0：jetbrains 全量列表，流式不裁尾窗。
        visibleWindow: STREAMING_VISIBLE_WINDOW,
        enableCollaborationBadge,
      }),
    [effectiveItems, enableCollaborationBadge, isThinking, showAllHistoryItems],
  );
  // jetbrains 同帧：不用 useDeferredValue 推迟时间线 DOM。
  // deferred 会让「状态已变高、画面仍是旧高度」paint 一帧 → 往上一闪再被 stick 吸回。
  const renderSourceItems = liveTailWorkingSet.items;
  const threadStreamLatencySnapshot = useThreadStreamLatencySnapshot(threadId);
  const activeStreamMitigation = useMemo(
    () => resolveActiveThreadStreamMitigation(threadStreamLatencySnapshot),
    [threadStreamLatencySnapshot],
  );
  const streamActivityPhase = useStreamActivityPhase({
    isProcessing:
      isThinking &&
      (activeEngine === "codex" ||
        activeEngine === "claude" ||
        activeEngine === "gemini" ||
        activeEngine === "grok" ||
        activeEngine === "kimi"),
    items: renderSourceItems,
  });
  const {
    blankingRecoveryActive,
    enableClaudeRenderSafeMode,
    getPendingRuntimeResourceCount,
    handleAssistantVisibleTextRender,
    isAssistantFinalizing,
    latestAssistantMessageId,
    latestRetryMessage,
    latestRuntimeReconnectItemId,
    liveAssistantMessageId,
    primaryWorkingLabel,
    readableWindowRecoveryActive,
    supportsStreamingReadableWindowRecovery,
    visibleStallRecoveryActive,
    waitingForFirstChunk,
  } = useMessagesRuntimeState({
    activeEngine,
    activeTurnId,
    codexSilentSuspectedAt,
    // jetbrains 同帧：deferred 与即时同源，不再拆两拍 items。
    deferredRenderSourceItems: renderSourceItems,
    isContextCompacting,
    isMacDesktop,
    isAgentTaskNotificationText,
    isThinking,
    isWindowsDesktop,
    items,
    labels: {
      approvalResumingAfterApproval: t("approval.resumingAfterApproval"),
      codexSilentSuspected: t("messages.codexSilentSuspected"),
      codexWaitingForFirstText: t("messages.codexWaitingForFirstText"),
      contextCompacting: t("chat.contextDualViewCompacting"),
    },
    nativeRuntimeRecoveryEnabled,
    renderScopeKey,
    reportVisibleTextRendered: noteThreadVisibleTextRendered,
    renderSourceItems,
    streamActivityPhase,
    threadId,
    threadStreamLatencyCategory:
      threadStreamLatencySnapshot?.latencyCategory ?? null,
  });
  const activeUserInputRequest = resolveActiveUserInputRequest({
    requests: userInputRequests,
    threadId,
    workspaceId,
  });
  const activeUserInputRequestId = activeUserInputRequest?.request_id ?? null;
  const activeUserInputAnchorItemId =
    activeUserInputRequest?.params.item_id?.trim() || null;
  const rawScrollKey = buildMessagesScrollKey(effectiveItems, activeUserInputRequestId);
  // working 边沿并入 followSignal：工具折叠/结算等不改尾条 text 时也触发布局追底。
  // live 正文外部化走 useMessagesCanvasFollow 内 channel 订阅（无 React 重渲）。
  const canvasFollowSignal = `${rawScrollKey}|w:${isWorking ? 1 : 0}|liveId:${liveAssistantMessageId ?? ""}`;
  const {
    containerRef,
    getPendingScrollResourceCount,
    messagesEndRef,
    pauseFollow,
    pinIfFollowing,
    resumeFollowAndPin,
    resumeFollowAndSmoothPin,
    settleFollow,
  } = useMessagesCanvasFollow({
    followSignal: canvasFollowSignal,
    isThinking,
    hasPendingJump: Boolean(pendingJumpMessageId),
    liveAutoFollowEnabledRef,
    renderScopeKey,
    threadId,
  });
  const scrollKey = rawScrollKey;
  const historyOpenedScopeRef = useRef<string | null>(null);
  const {
    closeFileLinkMenu,
    closeNoteCaptureMenu,
    collapseExpandedIds,
    collapseExploreItems,
    copiedMessageId,
    expandedItems,
    fileLinkMenu,
    getPendingInteractionResourceCount,
    handleConversationContextMenu,
    handleCopyMessage,
    handleExitPlanModeExecuteForItem,
    noteCaptureMenu,
    openFileLink,
    resetInteractionScope,
    selectedExitPlanExecutionByItemKey,
    showFileLinkMenu,
    timelineOpenNoteCaptureMenu,
    toggleExpanded,
  } = useMessagesInteractions({
    canvasRootRef: containerRef,
    effectiveItems,
    isThinking,
    items,
    onCaptureNote,
    onSaveAsPrompt: onSaveAsPromptOverride,
    onExitPlanModeExecute,
    onOpenWorkspaceFile,
    openTargets,
    renderSourceItems,
    selectedOpenAppId,
    threadId,
    workspacePath,
  });

  const computeActiveAnchor = useCallback(() => {
    return resolveActiveMessageAnchor(containerRef.current, messageNodeByIdRef.current);
  }, [containerRef]);

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
    pauseFollow();
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: "smooth",
    });
  }, [containerRef, pauseFollow]);

  useEffect(() => {
    const previousThreadId = resourceCleanupThreadIdRef.current;
    const threadChanged = previousThreadId !== threadId;
    const pendingResourceCounts = {
      anchorRaf: anchorUpdateRafRef.current !== null ? 1 : 0,
      planFocusRaf: planPanelFocusRafRef.current !== null ? 1 : 0,
      planFocusTimer: planPanelFocusTimeoutRef.current !== null ? 1 : 0,
      assistantFinalizingTimer: getPendingRuntimeResourceCount(),
      copyTimer: getPendingInteractionResourceCount(),
      scrollThrottleTimer: getPendingScrollResourceCount(),
      messageNodeCount: messageNodeByIdRef.current.size,
      agentTaskNodeCount:
        agentTaskNodeByTaskIdRef.current.size + agentTaskNodeByToolUseIdRef.current.size,
    };
    resetInteractionScope();
    // thread→null→thread 的重开（previous 为 null 的真正「打开」事件）允许 history-open
    // 重新落底；A→B 直切靠 scope 去重自然重 pin，pending jump 的抑制不被破坏。
    if (threadChanged && previousThreadId == null && threadId != null) {
      historyOpenedScopeRef.current = null;
    }
    // pre-dispatch guard：值未变不得进 dispatch（#185 / Messages scope reset）
    setIsSelectionFrozen((previous) => (previous ? false : previous));
    frozenItemsRef.current = null;
    resetHistoryScope();
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
    setActiveAnchorId((previous) => (previous === null ? previous : null));
  }, [
    getPendingInteractionResourceCount,
    getPendingScrollResourceCount,
    getPendingRuntimeResourceCount,
    resetHistoryScope,
    resetInteractionScope,
    threadId,
    workspaceId,
  ]);
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
  }, [containerRef]);
  useEffect(() => {
    if (!isSelectionFrozen) {
      frozenItemsRef.current = null;
    }
  }, [isSelectionFrozen, items]);

  useEffect(() => {
    writeLocalBooleanFlag(MESSAGES_LIVE_AUTO_FOLLOW_FLAG_KEY, liveAutoFollowEnabled);
  }, [liveAutoFollowEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleLiveControlsUpdated = (
      event: Event,
    ) => {
      const customEvent = event as CustomEvent<{
        liveAutoFollowEnabled?: boolean;
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
        if (!nextLiveAutoFollowEnabled) {
          pauseFollow();
        }
        // 重新打开焦点跟随：仅 false→true 边沿 re-arm（流式/闲时均可一键归位）。
        if (!wasLiveAutoFollowEnabled && nextLiveAutoFollowEnabled) {
          resumeFollowAndPin();
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
        const wasLiveAutoFollowEnabled = liveAutoFollowEnabledRef.current;
        if (wasLiveAutoFollowEnabled !== nextLiveAutoFollowEnabled) {
          liveAutoFollowEnabledRef.current = nextLiveAutoFollowEnabled;
          setLiveAutoFollowEnabled(nextLiveAutoFollowEnabled);
        }
        if (!nextLiveAutoFollowEnabled) {
          pauseFollow();
        } else if (!wasLiveAutoFollowEnabled && nextLiveAutoFollowEnabled) {
          // 与 CustomEvent 一致：只在边沿 re-arm，避免跨 tab 重复 setItem 拽回底部。
          resumeFollowAndPin();
        }
      }
    };
    // jetbrains useMessageSender：发送当下清 pause + 钉底，不靠 item 计数晚一拍。
    const handleForcePinBottom = () => {
      resumeFollowAndPin();
    };
    window.addEventListener(
      MESSAGES_LIVE_CONTROLS_UPDATED_EVENT,
      handleLiveControlsUpdated as EventListener,
    );
    window.addEventListener("storage", handleStorage);
    document.addEventListener(MESSAGES_FORCE_PIN_BOTTOM_EVENT, handleForcePinBottom);
    return () => {
      window.removeEventListener(
        MESSAGES_LIVE_CONTROLS_UPDATED_EVENT,
        handleLiveControlsUpdated as EventListener,
      );
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener(MESSAGES_FORCE_PIN_BOTTOM_EVENT, handleForcePinBottom);
    };
  }, [pauseFollow, resumeFollowAndPin]);
  const reasoningMetaById = useMemo(() => {
    const meta = new Map<string, ReturnType<typeof parseReasoning>>();
    renderSourceItems.forEach((item) => {
      if (item.kind === "reasoning") {
        meta.set(item.id, parseReasoning(item));
      }
    });
    return meta;
  }, [renderSourceItems]);

  const lastUserMessageIndex = useMemo(
    () => findLastUserMessageIndex(renderSourceItems),
    [renderSourceItems],
  );
  const liveSourceLastUserMessageIndex = useMemo(
    () => findLastUserMessageIndex(renderSourceItems),
    [renderSourceItems],
  );
  const reasoningWindowStartIndex = useMemo(() => {
    if (lastUserMessageIndex >= 0) {
      return lastUserMessageIndex;
    }
    return findLastAssistantMessageIndex(renderSourceItems);
  }, [renderSourceItems, lastUserMessageIndex]);
  const liveReasoningWindowStartIndex = useMemo(() => {
    if (liveSourceLastUserMessageIndex >= 0) {
      return liveSourceLastUserMessageIndex;
    }
    return findLastAssistantMessageIndex(renderSourceItems);
  }, [liveSourceLastUserMessageIndex, renderSourceItems]);
  const latestLiveReasoningItem = useMemo(() => {
    if (!isThinking) {
      return null;
    }
    for (
      let index = renderSourceItems.length - 1;
      index > liveReasoningWindowStartIndex;
      index -= 1
    ) {
      const item = renderSourceItems[index];
      if (isReasoningConversationItem(item)) {
        return item;
      }
    }
    return null;
  }, [isThinking, liveReasoningWindowStartIndex, renderSourceItems]);

  const latestReasoningLabel = useMemo(() => {
    if (hideClaudeReasoning) {
      return null;
    }
    if (latestLiveReasoningItem) {
      const parsed = parseReasoning(latestLiveReasoningItem);
      if (parsed.workingLabel) {
        return parsed.workingLabel;
      }
    }
    for (
      let index = renderSourceItems.length - 1;
      index > reasoningWindowStartIndex;
      index -= 1
    ) {
      const item = renderSourceItems[index];
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
    renderSourceItems,
    hideClaudeReasoning,
    latestLiveReasoningItem,
    reasoningMetaById,
    reasoningWindowStartIndex,
  ]);

  const latestDeferredReasoningId = useMemo(() => {
    for (
      let index = renderSourceItems.length - 1;
      index > reasoningWindowStartIndex;
      index -= 1
    ) {
      const item = renderSourceItems[index];
      if (isReasoningConversationItem(item)) {
        return item.id;
      }
    }
    return null;
  }, [renderSourceItems, reasoningWindowStartIndex]);
  const latestReasoningId = latestLiveReasoningItem?.id ?? latestDeferredReasoningId;
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
      index < renderSourceItems.length;
      index += 1
    ) {
      const item = renderSourceItems[index];
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
    renderSourceItems,
    legacyClaudeReasoningDockEnabled,
    reasoningMetaById,
    reasoningWindowStartIndex,
  ]);
  const previousIsThinkingRef = useRef(isThinking);
  useEffect(() => {
    if (previousIsThinkingRef.current && !isThinking && claudeDockedReasoningItems.length > 0) {
      collapseExpandedIds(
        new Set(claudeDockedReasoningItems.map((entry) => entry.item.id)),
      );
    }
    previousIsThinkingRef.current = isThinking;
  }, [claudeDockedReasoningItems, collapseExpandedIds, isThinking]);

  const latestTitleOnlyReasoningId = useMemo(() => {
    for (let index = renderSourceItems.length - 1; index >= 0; index -= 1) {
      const item = renderSourceItems[index];
      if (!isReasoningConversationItem(item)) {
        continue;
      }
      const parsed = reasoningMetaById.get(item.id);
      if (parsed?.workingLabel && !parsed.hasBody) {
        return item.id;
      }
    }
    return null;
  }, [renderSourceItems, reasoningMetaById]);

  const latestWorkingActivityLabel = useMemo(() => {
    let lastUserIndex = -1;
    for (let index = renderSourceItems.length - 1; index >= 0; index -= 1) {
      const item = renderSourceItems[index];
      if (isUserMessageConversationItem(item)) {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0) {
      return null;
    }
    for (
      let index = renderSourceItems.length - 1;
      index > lastUserIndex;
      index -= 1
    ) {
      const item = renderSourceItems[index];
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
  }, [activeEngine, renderSourceItems, presentationProfile]);

  const visibleItems = useMemo(
    () =>
      resolveVisibleMessageItems({
        items: renderSourceItems,
        activeEngine,
        hideClaudeReasoning,
        latestTitleOnlyReasoningId,
        presentationProfile,
        reasoningMetaById,
      }),
    [
      activeEngine,
      renderSourceItems,
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
  const { timelineItems, phases: processPhases } = useMemo(
    () =>
      resolveCollapsedTimelineItems({
        activeEngine,
        expandedPhaseKeys: expandedProcessPhaseKeys,
        timelineSourceItems,
      }),
    [activeEngine, expandedProcessPhaseKeys, timelineSourceItems],
  );
  const processPhaseChips = useMemo(
    () =>
      processPhases.map((phase) => ({
        phaseKey: phase.phaseKey,
        count: phase.count,
        expanded: phase.expanded,
        breakdown: phase.breakdown,
        // Prefer per-tool duration; fall back to turn duration so the header matches
        // the reference "已处理 1m 3s" control when tool timing is missing.
        durationMs:
          phase.durationMs ??
          (typeof lastDurationMs === "number" && lastDurationMs >= 0 ? lastDurationMs : null),
        insertBeforeItemId: phase.insertBeforeItemId,
        assistantItemId: phase.assistantItemId,
        hiddenItemIds: phase.hiddenItemIds,
      })),
    [lastDurationMs, processPhases],
  );
  const handleToggleProcessPhaseExpanded = useCallback((phaseKey: string) => {
    setExpandedProcessPhaseKeys((previous) => {
      const next = new Set(previous);
      if (next.has(phaseKey)) {
        next.delete(phaseKey);
      } else {
        next.add(phaseKey);
      }
      return next;
    });
  }, []);
  useEffect(() => {
    // 禁止无条件 `new Set()`：空集合换引用也会触发 re-render（#185 防御）
    setExpandedProcessPhaseKeys((previous) =>
      previous.size === 0 ? previous : new Set(),
    );
  }, [threadId]);
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
  const {
    messagesPresentationMode,
    presentationCollapsedHistoryItemCount,
    presentationRenderedItems,
    preservedLatestAssistantTextLength,
    preservedReadableWindowItemCount,
    renderChainBlankingRegressionActive,
    renderedItems,
    shouldUseReadableWindowRecovery,
  } = useMessagesHistoryPresentationWindow({
    activeTurnId,
    blankingRecoveryActive,
    effectiveItemsLength: effectiveItems.length,
    historyExpansionMode,
    isThinking,
    isWorking,
    liveTailWorkingSet,
    readableWindowRecoveryActive,
    showAllHistoryItems,
    supportsStreamingReadableWindowRecovery,
    threadId,
    timelineItems,
    visibleStallRecoveryActive,
    workspaceId,
  });
  const {
    assistantFinalBoundarySet,
    assistantLiveTurnFinalBoundarySuppressedSet,
    claudeHistoryTranscriptFallbackActive,
    groupedEntries,
    hiddenClaudeReasoningOnly,
    liveAssistantItem,
    liveAutoExpandedExploreId,
    liveReasoningItem,
    presentationScopeKey,
    sessionFileChangesSummary,
    suppressedUserMemoryContextMessageIds,
    suppressedUserNoteCardContextMessageIds,
    timelinePresentationItems,
    turnFileChangesByBoundaryId,
    turnTargetBadgeVisibleItemIds,
  } = useMessagesPresentationState({
    activeEngine,
    claudeDockedReasoningItemCount: claudeDockedReasoningItems.length,
    collapsedHistoryItemCount: presentationCollapsedHistoryItemCount,
    deferredRenderSourceItems: renderSourceItems,
    hideClaudeReasoning,
    historyRestoredAtMs: conversationState.meta.historyRestoredAtMs,
    isAssistantFinalizing,
    isHistoryLoading,
    isThinking,
    latestReasoningId,
    liveAssistantMessageId,
    messagesPresentationMode,
    presentationRenderedItems,
    renderScopeKey,
    renderSourceItems,
    supportsStreamingReadableWindowRecovery,
    threadId,
    timelineItems,
  });
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
      preservedReadableWindowItemsCount: preservedReadableWindowItemCount,
      preservedLatestAssistantTextLength,
    });
  }, [
    activeEngine,
    activeTurnId,
    isThinking,
    liveAssistantItem,
    liveReasoningItem,
    preservedLatestAssistantTextLength,
    preservedReadableWindowItemCount,
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
      ...deriveAnchorPreviewCopy(item.text),
    }));
  }, [timelinePresentationItems]);
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
          container && isCanvasNearBottom(container)
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
      containerRef,
      hasAnchorRail,
      messageAnchors,
      threadId,
    ],
  );
  const handleShowAllHistoryItems = useCallback(() => {
    revealAllHistoryItems("manual");
  }, [revealAllHistoryItems]);
  useLayoutEffect(() => {
    if (!showAllHistoryItems) {
      discardPendingHistoryExpansion();
      return;
    }
    const pendingExpansionMode = consumePendingHistoryExpansionMode();
    const container = containerRef.current;
    if (!pendingExpansionMode || !container) {
      return;
    }
    if (pendingExpansionMode === "manual") {
      pauseFollow();
      container.scrollTop = 0;
    }
    scheduleAnchorUpdate("sync");
  }, [
    consumePendingHistoryExpansionMode,
    discardPendingHistoryExpansion,
    pauseFollow,
    containerRef,
    timelinePresentationItems,
    scheduleAnchorUpdate,
    showAllHistoryItems,
  ]);
  // 跟随/释放/re-arm 全部由 useMessagesCanvasFollow 的容器监听自持；
  // 这里的 onScroll 只驱动锚点轨道高亮。
  const handleCanvasScroll = useCallback(() => {
    scheduleAnchorUpdate("scroll");
  }, [scheduleAnchorUpdate]);
  // ScrollControl 浮标：回顶 / 回底均为用户主动导航，对称 smooth；
  // 回底结束后再硬钉一次并 re-arm follow。send / history-open 仍走瞬时 resumeFollowAndPin。
  const handleScrollControlRequest = useCallback(
    (edge: ConversationScrollEdge) => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      if (edge === "bottom") {
        clearPendingJumpMessage();
        resumeFollowAndSmoothPin();
        return;
      }
      pauseFollow();
      clearPendingJumpMessage();
      container.scrollTo({ top: 0, behavior: "smooth" });
    },
    [
      clearPendingJumpMessage,
      containerRef,
      pauseFollow,
      resumeFollowAndSmoothPin,
    ],
  );
  const clearTransientUiState = useCallback(() => {
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
      (activeEngine !== "claude" && activeEngine !== "codex" && activeEngine !== "gemini" && activeEngine !== "grok" && activeEngine !== "kimi") ||
      (!isThinking && !isAssistantFinalizing) ||
      !threadId
    ) {
      return;
    }
    noteThreadVisibleRender(threadId, {
      visibleItemCount: renderedItems.length,
    });
  }, [activeEngine, isAssistantFinalizing, isThinking, renderedItems.length, threadId]);

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

  // 关闭会话时清 history-open 去重，保证 null→同 thread 重开仍能落底
  // （useEffect 清理会晚于本 layout 效应，不能依赖它）。
  useLayoutEffect(() => {
    if (threadId == null) {
      historyOpenedScopeRef.current = null;
    }
  }, [threadId]);

  // Opening a thread should land the viewport at the bottom (latest messages),
  // matching chat conventions. Runs once per workspace+thread once history
  // content is actually rendered; live auto-follow and anchor jumps own all
  // subsequent scrolling. 迟到测高回填由跟随中的 ResizeObserver 追底覆盖。
  useLayoutEffect(() => {
    if (threadId == null) {
      return undefined;
    }
    const scope = `${workspaceId ?? ""} ${threadId}`;
    if (historyOpenedScopeRef.current === scope) {
      return undefined;
    }
    if (isHistoryLoading || timelinePresentationItems.length === 0) {
      return undefined;
    }
    if (pendingJumpMessageId) {
      historyOpenedScopeRef.current = scope;
      // 跳锚优先：暂停 stick，避免 RO 在 jump 完成前把视口拽回底。
      pauseFollow();
      return undefined;
    }
    historyOpenedScopeRef.current = scope;
    resumeFollowAndPin();
  }, [
    isHistoryLoading,
    pauseFollow,
    pendingJumpMessageId,
    resumeFollowAndPin,
    threadId,
    timelinePresentationItems,
    workspaceId,
  ]);

  // send：强制回底（清暂停 + 多帧追高，对齐 jetbrains useMessageSender）。
  // settle：用户未 wheel 暂停则强制回底（防高度塌缩钳到顶）；已上滚读历史则不拽回。
  // scope switch 只刷新 baseline，避免把旧会话 working 状态投射到新会话。
  useLayoutEffect(() => {
    const previous = turnBoundaryStateRef.current;
    if (previous.renderScopeKey !== renderScopeKey) {
      turnBoundaryStateRef.current = {
        isHistoryLoading,
        isWorking,
        pendingWorkingStartCovered: false,
        renderScopeKey,
        userMessageCount: messageActionTargets.userMessageCount,
      };
      return;
    }
    // 对齐 jetbrains useMessageSender：任何新用户气泡都强制清暂停并回底。
    const userMessageAdded =
      !previous.isHistoryLoading &&
      messageActionTargets.userMessageCount > previous.userMessageCount;
    const enteredWorking = !previous.isWorking && isWorking;
    const exitedWorking = previous.isWorking && !isWorking;
    let pendingWorkingStartCovered = previous.pendingWorkingStartCovered;
    let sendBoundaryStarted = false;

    if (userMessageAdded) {
      resumeFollowAndPin();
      sendBoundaryStarted = true;
      pendingWorkingStartCovered = !isWorking;
    }
    if (enteredWorking) {
      if (!sendBoundaryStarted && !pendingWorkingStartCovered) {
        resumeFollowAndPin();
      }
      pendingWorkingStartCovered = false;
    } else if (exitedWorking) {
      settleFollow();
      pendingWorkingStartCovered = false;
    }
    if (!messageActionTargets.hasPendingUserTurn && !isWorking) {
      pendingWorkingStartCovered = false;
    }
    turnBoundaryStateRef.current = {
      isHistoryLoading,
      isWorking,
      pendingWorkingStartCovered,
      renderScopeKey,
      userMessageCount: messageActionTargets.userMessageCount,
    };
  }, [
    isHistoryLoading,
    isWorking,
    messageActionTargets.hasPendingUserTurn,
    messageActionTargets.userMessageCount,
    renderScopeKey,
    resumeFollowAndPin,
    settleFollow,
  ]);
  useEffect(() => {
    if (!isThinking || liveAutoExpandedExploreId !== null) {
      return;
    }
    collapseExploreItems(effectiveItems);
  }, [collapseExploreItems, effectiveItems, isThinking, liveAutoExpandedExploreId]);
  const shouldRenderUserInputNode =
    (activeEngine === "codex" || activeEngine === "claude") &&
    Boolean(legacyOnUserInputSubmit);
  const visibleApprovals = useMemo(() => {
    return getVisibleApprovalsForThread(approvals, workspaceId, threadId);
  }, [approvals, threadId, workspaceId]);
  const hasVisibleUserInputRequest =
    shouldRenderUserInputNode &&
    Boolean(legacyOnUserInputSubmit) &&
    activeUserInputRequestId !== null;
  const approvalNode = useMemo(
    () =>
      visibleApprovals.length > 0 && onApprovalDecision ? (
        <MessagesInlineApproval
          approvals={visibleApprovals}
          workspaces={workspaces}
          onApprovalDecision={onApprovalDecision}
          onApprovalBatchAccept={onApprovalBatchAccept}
          onApprovalRemember={onApprovalRemember}
        />
      ) : null,
    [
      onApprovalBatchAccept,
      onApprovalDecision,
      onApprovalRemember,
      visibleApprovals,
      workspaces,
    ],
  );
  const userInputNode = useMemo(
    () =>
      hasVisibleUserInputRequest ? (
        <MessagesInlineUserInput
          requests={userInputRequests}
          activeThreadId={threadId ?? null}
          activeWorkspaceId={workspaceId ?? null}
          onSubmit={legacyOnUserInputSubmit}
          onDismiss={legacyOnUserInputDismiss}
          shouldRender
        />
      ) : null,
    [
      hasVisibleUserInputRequest,
      legacyOnUserInputDismiss,
      legacyOnUserInputSubmit,
      threadId,
      userInputRequests,
      workspaceId,
    ],
  );
  const timelineHeartbeatPulse =
    (presentationProfile?.heartbeatWaitingHint ?? activeEngine === "opencode")
      ? heartbeatPulse
      : 0;
  const { handlePendingJumpTargetReady, requestScrollToAnchor } =
    useMessagesAnchorNavigation({
      pauseFollow,
      clearPendingJumpMessage,
      commitActiveAnchorId,
      containerRef,
      messageNodeByIdRef,
      pendingJumpMessageId,
      requestPendingJumpMessage,
      revealAllHistoryItems,
      showAllHistoryItems,
      timelinePresentationSignal: timelinePresentationItems,
    });

  const timelineModels = useMessagesTimelineModels({
    snapshot: {
      assistantFinalBoundarySet,
      assistantLiveTurnFinalBoundarySuppressedSet,
      claudeDockedReasoningItems,
      processPhaseChips,
      effectiveItemsCount: timelinePresentationItems.length,
      groupedEntries,
      hasPendingUserTurn: messageActionTargets.hasPendingUserTurn,
      latestFinalAssistantMessageId: messageActionTargets.latestFinalAssistantMessageId,
      messageActionTargetByAssistantId: messageActionTargets.targetByAssistantId,
      messageCopyTextByAssistantId: messageActionTargets.copyTextByAssistantId,
      reasoningMetaById,
      sessionFileChangesSummary,
      suppressedUserMemoryContextMessageIds,
      suppressedUserNoteCardContextMessageIds,
      turnFileChangesByBoundaryId,
      turnTargetBadgeVisibleItemIds,
      visibleCollapsedHistoryItemCount: presentationCollapsedHistoryItemCount,
    },
    live: {
      heartbeatPulse: timelineHeartbeatPulse,
      hiddenClaudeReasoningOnly,
      isThinking,
      isWorking,
      lastDurationMs,
      latestReasoningId,
      latestReasoningLabel: workingIndicatorReasoningLabel,
      latestWorkingActivityLabel,
      liveAssistantItem,
      liveAssistantMessageId,
      liveReasoningItem,
      primaryWorkingLabel,
      processingStartedAt,
      streamActivityPhase,
      waitingForFirstChunk,
    },
    runtime: {
      activeCollaborationModeId,
      activeEngine,
      activeUserInputAnchorItemId,
      activeUserInputRequestId,
      claudeHistoryTranscriptFallbackActive,
      hasVisibleUserInputRequest,
      historyRecoveryFailureReason: nativeRuntimeRecoveryEnabled
        ? historyRecoveryFailureReason
        : null,
      isHistoryLoading,
      historyLoadingProgress,
      latestRetryMessage,
      latestRuntimeReconnectItemId,
      nativeRuntimeRecoveryEnabled,
      proxyEnabled,
      proxyUrl,
      threadId,
      workspaceId,
    },
    navigation: {
      agentTaskNodeByTaskIdRef,
      agentTaskNodeByToolUseIdRef,
      messageNodeByIdRef,
      onPendingJumpTargetReady: handlePendingJumpTargetReady,
      pendingJumpMessageId,
      requestAutoScroll: pinIfFollowing,
      requestBottomConvergence: pinIfFollowing,
      scrollElementRef: containerRef,
    },
    interactions: {
      handleCopyMessage,
      handleExitPlanModeExecuteForItem,
      onAssistantVisibleTextRender: handleAssistantVisibleTextRender,
      onConversationDetailHydrationRequest: handleConversationDetailHydrationRequest,
      onConversationLightweightModeEnable: handleConversationLightweightModeEnable,
      onForkFromMessage,
      onOpenDiffPath,
      onOpenNoteCaptureMenu: timelineOpenNoteCaptureMenu,
      onPreviewFileDiff,
      onRecoverThreadRuntime,
      onRecoverThreadRuntimeAndResend,
      onRetryHistory,
      onRewindFromMessage,
      onShowAllHistoryItems: handleShowAllHistoryItems,
      onThreadRecoveryFork,
      onToggleProcessPhaseExpanded: handleToggleProcessPhaseExpanded,
      openFileLink,
      showFileLinkMenu,
      toggleExpanded,
    },
    presentation: {
      codeBlockCopyUseModifier,
      conversationDetailHydrationRequested,
      conversationLightweightModeEnabled,
      copiedMessageId,
      expandedItems,
      historyExpansionActive: showAllHistoryItems,
      liveAutoExpandedExploreId,
      presentationMode: messagesPresentationMode,
      presentationProfile,
      presentationScopeKey,
      selectedExitPlanExecutionByItemKey,
      streamMitigationProfile: activeStreamMitigation,
    },
    slots: { approvalNode, renderHistoryFold, userInputNode },
  });
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
        onScroll={handleCanvasScroll}
        onContextMenu={handleConversationContextMenu}
      >
        <MessagesLinkedRunBanner
          taskRuns={taskRuns}
          threadId={threadId}
          workspaceId={workspaceId}
        />
        {timelineLeadingNode}
        <MessagesTimeline {...timelineModels} />
        {timelineTrailingNode}
        {/* jetbrains messagesEndRef：两步追底的 scrollIntoView 锚点；无视觉高度。 */}
        <div ref={messagesEndRef} className="messages-end-sentinel" aria-hidden="true" />
      </div>
      <ScrollControl
        containerRef={containerRef}
        onRequestScrollToEdge={handleScrollControlRequest}
      />
      {fileLinkMenu ? (
        <RendererContextMenu
          menu={fileLinkMenu}
          onClose={closeFileLinkMenu}
          className="renderer-context-menu messages-file-link-context-menu"
        />
      ) : null}
      {noteCaptureMenu ? (
        <RendererContextMenu
          menu={noteCaptureMenu}
          onClose={closeNoteCaptureMenu}
          className="renderer-context-menu messages-note-capture-context-menu"
        />
      ) : null}
    </div>
  );
});
