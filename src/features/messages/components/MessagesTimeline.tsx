import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { MessagesOutlineFloater } from "./conversation/MessagesOutlineFloater";
import { parseAgentTaskNotification } from "@/contracts/agentTaskNotification";
import { appendRendererDiagnostic } from "../../../services/rendererDiagnostics";
import {
  buildTimelineProjectionRows,
  findTimelineProjectionRowIndexByItemId,
  groupedEntryContainsItemId,
  type TimelineProjectionRow,
} from "../timeline/projection/messagesTimelineProjection";
import {
  resolveConversationLightweightModeState,
  resolveConversationLightweightPolicy,
} from "../presentation/messagesConversationLightweightMode";
import {
  buildTimelineRenderWeightDiagnosticPayload,
  getActiveLiveTimelineRowKeys,
  summarizeTimelineProjectionRenderWeight,
  TIMELINE_ADAPTIVE_RENDERING_ENABLED,
} from "../timeline/virtualization/messagesTimelineVirtualization";
import type { MessagesTimelineProps } from "../orchestration/models/messagesTimelineModels";
import { ConversationLightweightPrompt } from "../timeline/components/ConversationLightweightPrompt";
import { TimelineProjectionViewport } from "../timeline/components/TimelineProjectionViewport";
import { TimelineRowRenderer } from "../timeline/components/TimelineRowRenderer";
import { useMessagesTimelineOutline } from "../timeline/hooks/useMessagesTimelineOutline";
import { useMessagesTimelineHydration } from "../timeline/hooks/useMessagesTimelineHydration";

// ponytail: bottom-right outline floater hidden by product decision (2026-07-03).
const SHOW_OUTLINE_FLOATER = false;

const TIMELINE_RENDER_WEIGHT_DIAGNOSTIC_COOLDOWN_MS = 5_000;
const CONVERSATION_LIGHTWEIGHT_DIAGNOSTIC_COOLDOWN_MS = 5_000;
const TIMELINE_SCROLL_DIAGNOSTIC_MIN_INTERVAL_MS = 250;
const TIMELINE_SCROLL_DIAGNOSTIC_MIN_DELTA_PX = 24;

type TimelineScrollDiagnosticSnapshot = {
  clientHeight: number;
  distanceFromBottom: number;
  scrollHeight: number;
  scrollTop: number;
};

type TimelineScrollDiagnosticContext = {
  activeLiveRowCount: number;
  isThinking: boolean;
  isWorking: boolean;
  renderWeight: number;
  rowCount: number;
  threadId: string | null;
  workspaceId: string | null;
};

function collectTimelineScrollDiagnosticSnapshot(
  element: HTMLElement,
): TimelineScrollDiagnosticSnapshot {
  const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
  return {
    clientHeight: Math.round(element.clientHeight),
    distanceFromBottom: Math.round(distanceFromBottom),
    scrollHeight: Math.round(element.scrollHeight),
    scrollTop: Math.round(element.scrollTop),
  };
}

export const MessagesTimeline = memo(function MessagesTimeline({
  snapshot,
  live,
  runtime,
  navigation,
  interactions,
  presentation,
  slots,
}: MessagesTimelineProps) {
  const {
    claudeDockedReasoningItems,
    effectiveItemsCount,
    groupedEntries,
    processPhaseChips,
    visibleCollapsedHistoryItemCount,
  } = snapshot;
  const {
    hiddenClaudeReasoningOnly,
    isThinking,
    isWorking,
    latestReasoningId,
    liveAssistantItem,
    liveAssistantMessageId,
    liveReasoningItem,
  } = live;
  const {
    activeEngine,
    activeUserInputAnchorItemId,
    hasVisibleUserInputRequest,
    historyRecoveryFailureReason,
    isHistoryLoading,
    threadId,
    workspaceId,
  } = runtime;
  const {
    pendingJumpMessageId,
    scrollElementRef,
  } = navigation;
  const {
    onConversationDetailHydrationRequest,
    onConversationLightweightModeEnable,
    onShowAllHistoryItems,
  } = interactions;
  const {
    codeBlockCopyUseModifier,
    conversationDetailHydrationRequested,
    conversationLightweightModeEnabled,
    historyExpansionActive,
    presentationMode,
    presentationProfile,
    presentationScopeKey,
  } = presentation;
  const { approvalNode, userInputNode } = slots;
  const { t } = useTranslation();
  const {
    activeHeadingId,
    currentOutline,
    floaterContainerRef,
    handleJumpToHeading,
    liveAssistantOutlineReady,
  } = useMessagesTimelineOutline({
    enabled: SHOW_OUTLINE_FLOATER,
    liveAssistantMessageId,
    threadId,
    workspaceId: workspaceId ?? null,
  });
  const lastTimelineRenderWeightDiagnosticRef = useRef<{
    at: number;
    signature: string;
  }>({ at: 0, signature: "" });
  const lastConversationLightweightDiagnosticRef = useRef<{
    at: number;
    signature: string;
  }>({ at: 0, signature: "" });
  const lastTimelineScrollDiagnosticRef = useRef<{
    at: number;
    eventKind: string;
    snapshot: TimelineScrollDiagnosticSnapshot | null;
  }>({ at: 0, eventKind: "", snapshot: null });
  const shouldRenderUserInputAtTail = Boolean(
    userInputNode &&
      (!activeUserInputAnchorItemId ||
        !groupedEntries.some((entry) =>
          groupedEntryContainsItemId(entry, activeUserInputAnchorItemId),
        )),
  );
  const approvalVisible = Boolean(approvalNode);
  const historyRecoveryFailureVisible =
    Boolean(historyRecoveryFailureReason?.trim());
  const claudeDockedReasoningItemIds = useMemo(
    () => claudeDockedReasoningItems.map(({ item }) => item.id),
    [claudeDockedReasoningItems],
  );
  const timelineProjectionRows = useMemo(
    () =>
      buildTimelineProjectionRows({
        activeUserInputAnchorItemId,
        approvalVisible,
        claudeDockedReasoningItemIds,
        effectiveItemsCount,
        groupedEntries,
        hasVisibleUserInputRequest,
        hiddenClaudeReasoningOnly,
        historyRecoveryFailureVisible,
        isHistoryLoading,
        isThinking,
        processPhaseChips,
        shouldRenderUserInputAtTail,
      }),
    [
      activeUserInputAnchorItemId,
      approvalVisible,
      claudeDockedReasoningItemIds,
      effectiveItemsCount,
      groupedEntries,
      hasVisibleUserInputRequest,
      hiddenClaudeReasoningOnly,
      historyRecoveryFailureVisible,
      isHistoryLoading,
      isThinking,
      processPhaseChips,
      shouldRenderUserInputAtTail,
    ],
  );
  const timelineRenderWeightSummary = useMemo(
    () => {
      if (!TIMELINE_ADAPTIVE_RENDERING_ENABLED || isThinking || isWorking) {
        return {
          rowCount: timelineProjectionRows.length,
          renderWeight: timelineProjectionRows.length,
          heavyRowCount: 0,
          categoryCounts: {},
        };
      }
      return summarizeTimelineProjectionRenderWeight(timelineProjectionRows);
    },
    [isThinking, isWorking, timelineProjectionRows],
  );
  const conversationLightweightPolicy = useMemo(
    () => resolveConversationLightweightPolicy(timelineRenderWeightSummary),
    [timelineRenderWeightSummary],
  );
  const conversationLightweightModeState = useMemo(
    () =>
      resolveConversationLightweightModeState({
        policy: conversationLightweightPolicy,
        manualEnabled: conversationLightweightModeEnabled,
        detailHydrationRequested: conversationDetailHydrationRequested,
      }),
    [
      conversationDetailHydrationRequested,
      conversationLightweightModeEnabled,
      conversationLightweightPolicy,
    ],
  );
  const effectiveConversationLightweightMode = conversationLightweightModeState.active;
  const shouldUseStaticExpandedHistoryFlow =
    historyExpansionActive &&
    !isThinking &&
    !isWorking &&
    !pendingJumpMessageId;
  const shouldUseStaticLightweightHistoryFlow =
    shouldUseStaticExpandedHistoryFlow &&
    !conversationDetailHydrationRequested &&
    (conversationLightweightPolicy.suggested || effectiveConversationLightweightMode);
  // 轻量历史策略仍可 deferred 诊断；呈现层已不画 lightweight 摘要条。
  const shouldDeferHeavyTimelineRows = shouldUseStaticLightweightHistoryFlow;
  const activeLiveTimelineRowKeys = useMemo(
    () =>
      getActiveLiveTimelineRowKeys({
        rows: timelineProjectionRows,
        liveAssistantItemId: liveAssistantItem?.id ?? liveAssistantMessageId,
        liveReasoningItemId: liveReasoningItem?.id ?? latestReasoningId,
      }),
    [
      latestReasoningId,
      liveAssistantItem?.id,
      liveAssistantMessageId,
      liveReasoningItem?.id,
      timelineProjectionRows,
    ],
  );
  const activeLiveTimelineRowKeySet = useMemo(
    () => new Set(activeLiveTimelineRowKeys),
    [activeLiveTimelineRowKeys],
  );
  const pendingJumpRowIndex = useMemo(
    () =>
      pendingJumpMessageId
        ? findTimelineProjectionRowIndexByItemId(timelineProjectionRows, pendingJumpMessageId)
        : -1,
    [pendingJumpMessageId, timelineProjectionRows],
  );
  const pendingJumpRowKey = pendingJumpRowIndex >= 0
    ? timelineProjectionRows[pendingJumpRowIndex]?.key ?? null
    : null;

  const timelineScrollDiagnosticContextRef = useRef<TimelineScrollDiagnosticContext>({
    activeLiveRowCount: activeLiveTimelineRowKeys.length,
    isThinking,
    isWorking,
    renderWeight: timelineRenderWeightSummary.renderWeight,
    rowCount: timelineProjectionRows.length,
    threadId,
    workspaceId: workspaceId ?? null,
  });
  timelineScrollDiagnosticContextRef.current = {
    activeLiveRowCount: activeLiveTimelineRowKeys.length,
    isThinking,
    isWorking,
    renderWeight: timelineRenderWeightSummary.renderWeight,
    rowCount: timelineProjectionRows.length,
    threadId,
    workspaceId: workspaceId ?? null,
  };

  useEffect(() => {
    const scrollElement = scrollElementRef.current;
    if (!scrollElement) {
      return undefined;
    }

    const appendScrollDiagnostic = (
      eventKind: "scroll" | "scrollend" | "wheel",
      extra: Record<string, unknown> = {},
    ) => {
      const snapshotValue = collectTimelineScrollDiagnosticSnapshot(scrollElement);
      const previous = lastTimelineScrollDiagnosticRef.current;
      const now = Date.now();
      const previousSnapshot = previous.snapshot;
      const scrollTopDelta = previousSnapshot
        ? snapshotValue.scrollTop - previousSnapshot.scrollTop
        : 0;
      const distanceFromBottomDelta = previousSnapshot
        ? snapshotValue.distanceFromBottom - previousSnapshot.distanceFromBottom
        : 0;
      const isMeaningfulDelta =
        Math.abs(scrollTopDelta) >= TIMELINE_SCROLL_DIAGNOSTIC_MIN_DELTA_PX ||
        Math.abs(distanceFromBottomDelta) >= TIMELINE_SCROLL_DIAGNOSTIC_MIN_DELTA_PX ||
        eventKind === "wheel" ||
        previous.eventKind !== eventKind;
      if (
        !isMeaningfulDelta ||
        now - previous.at < TIMELINE_SCROLL_DIAGNOSTIC_MIN_INTERVAL_MS
      ) {
        return;
      }
      lastTimelineScrollDiagnosticRef.current = {
        at: now,
        eventKind,
        snapshot: snapshotValue,
      };
      const diagnosticContext = timelineScrollDiagnosticContextRef.current;
      appendRendererDiagnostic("messages/timeline-scroll-behavior", {
        component: "MessagesTimeline",
        eventKind,
        threadId: diagnosticContext.threadId,
        workspaceId: diagnosticContext.workspaceId,
        isThinking: diagnosticContext.isThinking,
        isWorking: diagnosticContext.isWorking,
        shouldVirtualizeTimeline: false,
        rowCount: diagnosticContext.rowCount,
        renderWeight: diagnosticContext.renderWeight,
        virtualItemCount: 0,
        activeLiveRowCount: diagnosticContext.activeLiveRowCount,
        scrollTopDelta: Math.round(scrollTopDelta),
        distanceFromBottomDelta: Math.round(distanceFromBottomDelta),
        ...snapshotValue,
        ...extra,
      });
    };

    const handleScroll = () => appendScrollDiagnostic("scroll");
    const handleScrollEnd = () => appendScrollDiagnostic("scrollend");
    const handleWheel = (event: WheelEvent) => {
      appendScrollDiagnostic("wheel", {
        deltaMode: event.deltaMode,
        deltaX: Math.round(event.deltaX),
        deltaY: Math.round(event.deltaY),
      });
    };

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    scrollElement.addEventListener("wheel", handleWheel, { passive: true });
    scrollElement.addEventListener("scrollend", handleScrollEnd, { passive: true });
    appendScrollDiagnostic("scroll", { reason: "listener-attached" });
    return () => {
      scrollElement.removeEventListener("scroll", handleScroll);
      scrollElement.removeEventListener("wheel", handleWheel);
      scrollElement.removeEventListener("scrollend", handleScrollEnd);
    };
  }, [scrollElementRef]);

  const presentationRetainedScopeKey = useMemo(
    () =>
      [
        presentationScopeKey,
        presentationMode,
        timelineProjectionRows.length,
        timelineRenderWeightSummary.renderWeight,
        "static",
      ].join("\u0000"),
    [
      presentationMode,
      presentationScopeKey,
      timelineProjectionRows.length,
      timelineRenderWeightSummary.renderWeight,
    ],
  );
  const timelineRendererOptionsKey = useMemo(
    () => [
      activeEngine,
      presentationProfile?.preferCommandSummary ? "command-summary" : "no-command-summary",
      presentationProfile?.codexCanvasMarkdown ? "codex-canvas" : "plain-markdown",
      codeBlockCopyUseModifier ? "copy-modifier" : "copy-default",
    ].join("|"),
    [
      activeEngine,
      codeBlockCopyUseModifier,
      presentationProfile?.codexCanvasMarkdown,
      presentationProfile?.preferCommandSummary,
    ],
  );
  const {
    hydratedHeavyTimelineRowCount,
    shouldRenderLightweightProjectionRow,
    timelineRowHydrationStateByKey,
  } = useMessagesTimelineHydration({
    activeLiveTimelineRowKeySet,
    conversationDetailHydrationRequested,
    effectiveConversationLightweightMode,
    isThinking,
    isWorking,
    pendingJumpRowKey,
    rendererOptionsKey: timelineRendererOptionsKey,
    retainedScopeKey: `${presentationRetainedScopeKey}\u0000${timelineRendererOptionsKey}`,
    shouldDeferHeavyTimelineRows,
    timelineProjectionRows,
  });

  useEffect(() => {
    if (!TIMELINE_ADAPTIVE_RENDERING_ENABLED) {
      return;
    }
    const signature = [
      workspaceId ?? "",
      threadId ?? "",
      timelineRenderWeightSummary.rowCount,
      timelineRenderWeightSummary.renderWeight,
      timelineRenderWeightSummary.heavyRowCount,
      hydratedHeavyTimelineRowCount,
    ].join(":");
    const now = Date.now();
    if (
      lastTimelineRenderWeightDiagnosticRef.current.signature === signature &&
      now - lastTimelineRenderWeightDiagnosticRef.current.at <
        TIMELINE_RENDER_WEIGHT_DIAGNOSTIC_COOLDOWN_MS
    ) {
      return;
    }
    lastTimelineRenderWeightDiagnosticRef.current = { at: now, signature };
    appendRendererDiagnostic(
      "messages/timeline-render-weight",
      buildTimelineRenderWeightDiagnosticPayload({
        summary: timelineRenderWeightSummary,
        shouldVirtualize: false,
        hydratedHeavyRowCount: hydratedHeavyTimelineRowCount,
        localErrorState: "none",
        threadId,
        workspaceId: workspaceId ?? null,
      }),
    );
  }, [
    hydratedHeavyTimelineRowCount,
    threadId,
    timelineRenderWeightSummary,
    workspaceId,
  ]);

  useEffect(() => {
    if (!conversationLightweightPolicy.suggested && !effectiveConversationLightweightMode) {
      return;
    }
    const signature = [
      workspaceId ?? "",
      threadId ?? "",
      conversationLightweightModeState.reason,
      conversationLightweightPolicy.suggested ? "suggested" : "not-suggested",
      conversationLightweightPolicy.oversized ? "oversized" : "not-oversized",
      conversationDetailHydrationRequested ? "detail-requested" : "detail-deferred",
      timelineRenderWeightSummary.rowCount,
      timelineRenderWeightSummary.renderWeight,
      timelineRenderWeightSummary.heavyRowCount,
    ].join(":");
    const now = Date.now();
    if (
      lastConversationLightweightDiagnosticRef.current.signature === signature &&
      now - lastConversationLightweightDiagnosticRef.current.at <
        CONVERSATION_LIGHTWEIGHT_DIAGNOSTIC_COOLDOWN_MS
    ) {
      return;
    }
    lastConversationLightweightDiagnosticRef.current = { at: now, signature };
    appendRendererDiagnostic("messages/conversation-lightweight-mode", {
      surface: "timeline",
      component: "MessagesTimeline",
      workspaceId: workspaceId ?? null,
      threadId,
      active: effectiveConversationLightweightMode,
      reason: conversationLightweightModeState.reason,
      suggested: conversationLightweightPolicy.suggested,
      oversized: conversationLightweightPolicy.oversized,
      detailHydrationRequested: conversationDetailHydrationRequested,
      rowCount: timelineRenderWeightSummary.rowCount,
      renderWeight: timelineRenderWeightSummary.renderWeight,
      heavyRowCount: timelineRenderWeightSummary.heavyRowCount,
    });
  }, [
    conversationDetailHydrationRequested,
    conversationLightweightModeState.reason,
    conversationLightweightPolicy.oversized,
    conversationLightweightPolicy.suggested,
    effectiveConversationLightweightMode,
    threadId,
    timelineRenderWeightSummary.heavyRowCount,
    timelineRenderWeightSummary.renderWeight,
    timelineRenderWeightSummary.rowCount,
    workspaceId,
  ]);

  const renderProjectionRowWithBoundary = useCallback(
    (row: TimelineProjectionRow | undefined) => {
      if (!row) {
        return null;
      }
      const hydrationState = timelineRowHydrationStateByKey.get(row.key);
      return (
        <TimelineRowRenderer
          row={row}
          hydrationState={hydrationState}
          renderLightweight={shouldRenderLightweightProjectionRow(row, hydrationState)}
          liveAssistantOutlineReady={liveAssistantOutlineReady}
          parseAgentTaskNotification={parseAgentTaskNotification}
          snapshot={snapshot}
          live={live}
          runtime={runtime}
          navigation={navigation}
          interactions={interactions}
          presentation={presentation}
          slots={slots}
        />
      );
    },
    [
      interactions,
      live,
      liveAssistantOutlineReady,
      navigation,
      presentation,
      shouldRenderLightweightProjectionRow,
      slots,
      snapshot,
      timelineRowHydrationStateByKey,
      runtime,
    ],
  );
  const shouldShowConversationLightweightPrompt =
    !isThinking &&
    !isWorking &&
    !conversationDetailHydrationRequested &&
    (conversationLightweightPolicy.suggested || effectiveConversationLightweightMode);
  return (
    <div
      ref={floaterContainerRef}
      className="messages-timeline-root"
      data-timeline-static-expanded-history={
        shouldUseStaticExpandedHistoryFlow ? "true" : undefined
      }
      data-timeline-static-lightweight-history={
        shouldUseStaticLightweightHistoryFlow ? "true" : undefined
      }
      data-timeline-presentation-mode={presentationMode}
      data-timeline-presentation-scope={presentationScopeKey}
    >
      <MessagesOutlineFloater
        outline={SHOW_OUTLINE_FLOATER ? (currentOutline?.outline ?? null) : null}
        activeHeadingId={activeHeadingId}
        onJumpToHeading={handleJumpToHeading}
      />
      <div
        className="messages-full"
        data-timeline-projection-row-count={timelineProjectionRows.length}
        data-timeline-virtualized="false"
      >
        <ConversationLightweightPrompt
          active={effectiveConversationLightweightMode}
          heavyRowCount={timelineRenderWeightSummary.heavyRowCount}
          onEnable={onConversationLightweightModeEnable}
          onHydrateVisible={onConversationDetailHydrationRequest}
          oversized={conversationLightweightPolicy.oversized}
          renderWeight={timelineRenderWeightSummary.renderWeight}
          rowCount={timelineRenderWeightSummary.rowCount}
          visible={shouldShowConversationLightweightPrompt}
        />
        {visibleCollapsedHistoryItemCount > 0 && (
          <div
            className="messages-collapsed-indicator"
            data-collapsed-count={visibleCollapsedHistoryItemCount}
            onClick={onShowAllHistoryItems}
          >
            {t("messages.showEarlierMessages", { count: visibleCollapsedHistoryItemCount })}
          </div>
        )}
        <TimelineProjectionViewport
          renderProjectionRow={renderProjectionRowWithBoundary}
          timelineProjectionRows={timelineProjectionRows}
        />
      </div>
    </div>
  );
});
