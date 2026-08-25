import {
  Fragment,
  memo,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import Check from "lucide-react/dist/esm/icons/check";
import Copy from "lucide-react/dist/esm/icons/copy";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import History from "lucide-react/dist/esm/icons/history";
import NotebookPen from "lucide-react/dist/esm/icons/notebook-pen";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import type { ConversationItem } from "../../../../types";
import { Button } from "../../../../components/ui/button";
import { TooltipIconButton } from "../../../../components/ui/tooltip-icon-button";
import { parseReasoning } from "../../presentation/messagesReasoning";
import { resolveUserMessagePresentation } from "../../presentation/messagesUserPresentation";
import {
  buildAssistantFinalBoundaryMetaText,
  shouldHideCodexCanvasCommandCard,
} from "../../utils/messagesRenderUtils";
import type { GroupedEntry } from "../../utils/groupToolItems";
import {
  groupedEntryContainsItemId,
  type TimelineProjectionRow,
} from "../projection/messagesTimelineProjection";
import type { TimelineRowHydrationState } from "../virtualization/messagesTimelineHydration";
import { useTimelineMessageNodeRefs } from "../hooks/useTimelineMessageNodeRefs";
import { resolveTimelineLiveRenderItem } from "../presentation/messagesTimelineLiveRender";
import { resolveTimelineLightweightRowSummary } from "../presentation/messagesTimelineLightweightRow";
import {
  BashToolGroupBlock,
  EditToolGroupBlock,
  ReadToolGroupBlock,
  SearchToolGroupBlock,
  ToolBlockRenderer,
} from "../../components/toolBlocks";
import {
  isSubagentStyleAgentTaskNotification,
  parseAgentTaskNotification as parseFullAgentTaskNotification,
} from "@/contracts/agentTaskNotification";
import {
  DiffRow,
  ExploreRow,
  GeneratedImageRow,
  MessageRow,
  ReasoningRow,
  ReviewRow,
  WorkingIndicator,
} from "../../components/MessagesRows";
import { ConversationRowErrorBoundary } from "../../components/conversation/ConversationRowErrorBoundary";
import {
  isMultiAgentHistFoldItemId,
  isMultiAgentSettledSummaryItemId,
} from "@/conversation-presentation/multi-agent/canvasItems";
import { MiddleStepsCollapsedChip } from "./MiddleStepsCollapsedChip";
import type {
  TimelineRowRendererProps,
  TimelineUserActionNodeCacheEntry,
} from "./TimelineRowRenderer.types";

const USER_ACTION_NODE_CACHE_LIMIT = 500;

export const TimelineRowRenderer = memo(function TimelineRowRenderer({
  row,
  hydrationState,
  liveAssistantOutlineReady,
  parseAgentTaskNotification,
  renderLightweight,
  snapshot,
  live,
  runtime,
  navigation,
  interactions,
  presentation,
  slots,
}: TimelineRowRendererProps) {
  const {
    assistantFinalBoundarySet,
    assistantLiveTurnFinalBoundarySuppressedSet,
    claudeDockedReasoningItems,
    effectiveItemsCount,
    latestFinalAssistantMessageId,
    messageActionTargetByAssistantId,
    messageCopyTextByAssistantId,
    suppressedUserMemoryContextMessageIds,
    suppressedUserNoteCardContextMessageIds,
    turnTargetBadgeVisibleItemIds,
  } = snapshot;
  const {
    heartbeatPulse,
    isThinking,
    isWorking,
    lastDurationMs,
    latestReasoningId,
    latestReasoningLabel,
    latestWorkingActivityLabel,
    liveAssistantItem,
    liveAssistantMessageId,
    liveReasoningItem,
    primaryWorkingLabel,
    processingStartedAt,
    waitingForFirstChunk,
  } = live;
  const {
    activeCollaborationModeId,
    activeEngine,
    activeUserInputAnchorItemId,
    activeUserInputRequestId,
    latestRetryMessage,
    latestRuntimeReconnectItemId,
    nativeRuntimeRecoveryEnabled,
    proxyEnabled,
    proxyUrl,
    isHistoryLoading: _isHistoryLoading,
    historyLoadingProgress,
    threadId,
    workspaceId,
  } = runtime;
  const {
    agentTaskNodeByTaskIdRef,
    agentTaskNodeByToolUseIdRef,
    messageNodeByIdRef,
    requestAutoScroll,
  } = navigation;
  const {
    handleCopyMessage,
    handleExitPlanModeExecuteForItem,
    onAssistantVisibleTextRender,
    onConversationDetailHydrationRequest,
    onForkFromMessage,
    onOpenDiffPath,
    onOpenNoteCaptureMenu,
    onRecoverThreadRuntime,
    onRecoverThreadRuntimeAndResend,
    onRetryHistory,
    onRewindFromMessage,
    onThreadRecoveryFork,
    onToggleProcessPhaseExpanded,
    openFileLink,
    showFileLinkMenu,
    toggleExpanded,
  } = interactions;
  const {
    codeBlockCopyUseModifier,
    copiedMessageId,
    expandedItems,
    liveAutoExpandedExploreId,
    presentationProfile,
    selectedExitPlanExecutionByItemKey,
    streamMitigationProfile,
  } = presentation;
  const { approvalNode, renderHistoryFold, userInputNode } = slots;
  const { t } = useTranslation();
  const messageNodeRefs = useTimelineMessageNodeRefs({
    agentTaskNodeByTaskIdRef,
    agentTaskNodeByToolUseIdRef,
    messageNodeByIdRef,
  });
  const dockedReasoningById = useMemo(
    () => new Map(claudeDockedReasoningItems.map((entry) => [entry.item.id, entry])),
    [claudeDockedReasoningItems],
  );
  // MessageRow 的 memo 比较器按引用比对 userActionNode；若每次时间线渲染都新建
  // 元素，所有用户行都会被打穿并真实重渲染（流式期间每个 token 一次）。按行缓存
  // 元素，仅在影响输出的输入（item 引用 / 复制文案 / 已复制态 / 语言）变化时重建。
  const userActionNodeCacheRef = useRef(
    new Map<string, TimelineUserActionNodeCacheEntry>(),
  );
  const renderSingleItem = (item: ConversationItem) => {
    const renderItem = resolveTimelineLiveRenderItem(
      item,
      liveAssistantItem,
      liveReasoningItem,
    );
    const renderKind = renderItem.kind;
    if (renderKind === "message" && renderItem.kind === "message") {
      const itemRenderKey = `message:${renderItem.id}`;
      // 协作终态 HistoryFold：插在时间线消息位置，随主幕布滚动
      if (isMultiAgentHistFoldItemId(renderItem.id)) {
        const historyFoldNode = renderHistoryFold?.(renderItem.id) ?? null;
        return (
          <div
            key={itemRenderKey}
            className="ma-hist-timeline-row"
            data-message-anchor-id={renderItem.id}
          >
            {historyFoldNode}
          </div>
        );
      }
      // durable settle 摘要：不进气泡（由 HistoryFold 卡下汇总承载）
      if (isMultiAgentSettledSummaryItemId(renderItem.id)) {
        return null;
      }
      const isCopied = copiedMessageId === renderItem.id;
      const agentTaskNotification = parseAgentTaskNotification(renderItem.text);
      // SubAgent 型 task-notification：幕布行整段退役（事实迁 S10）；仅保留 0 高锚点供 scroll
      // Timeline prop 类型只有 taskId/toolUseId，退役判定用 contract 完整 parse（含 summary）
      const fullAgentTaskNotification = parseFullAgentTaskNotification(renderItem.text);
      if (
        fullAgentTaskNotification &&
        isSubagentStyleAgentTaskNotification(fullAgentTaskNotification)
      ) {
        const retiredTaskId = fullAgentTaskNotification.taskId ?? null;
        const retiredToolUseId = fullAgentTaskNotification.toolUseId ?? null;
        const bindMessageNode = messageNodeRefs.getRef(renderItem.id, {
          role: renderItem.role,
          taskId: retiredTaskId,
          toolUseId: retiredToolUseId,
        });
        return (
          <div
            key={itemRenderKey}
            ref={bindMessageNode}
            data-message-anchor-id={renderItem.id}
            data-agent-task-id={retiredTaskId ?? undefined}
            data-agent-tool-use-id={retiredToolUseId ?? undefined}
            data-subagent-task-notification-retired="1"
            // 0 高可定位锚点：不占幕布像素，仍可被 scrollInto / getBoundingClientRect
            style={{ height: 0, overflow: "hidden", margin: 0, padding: 0 }}
            aria-hidden
          />
        );
      }
      const shouldRenderFinalBoundary =
        renderItem.role === "assistant" &&
        renderItem.isFinal === true &&
        assistantFinalBoundarySet.has(renderItem.id) &&
        !assistantLiveTurnFinalBoundarySuppressedSet.has(renderItem.id);
      // 文件变更汇总已迁到 Composer 运行态条「已编辑」pill；流内不再渲染回合卡。
      const finalMetaText = buildAssistantFinalBoundaryMetaText({
        finalDurationMs: renderItem.finalDurationMs,
        finalInputTokens: renderItem.finalInputTokens,
        finalOutputTokens: renderItem.finalOutputTokens,
        finalCompletedAt: renderItem.finalCompletedAt,
        t,
      });
      const actionTargetUserMessageId =
        renderItem.role === "assistant"
          ? messageActionTargetByAssistantId.get(renderItem.id) ?? null
          : null;
      const isLatestFinalAssistant =
        renderItem.id === latestFinalAssistantMessageId;
      const shouldRenderAssistantActions =
        renderItem.role === "assistant" && renderItem.isFinal === true;
      const assistantCopyText =
        renderItem.role === "assistant"
          ? messageCopyTextByAssistantId.get(renderItem.id) ?? renderItem.text
          : renderItem.text;
      const userCopyText =
        renderItem.role === "user"
          ? resolveUserMessagePresentation({
              text: renderItem.text,
              selectedAgentName: renderItem.selectedAgentName,
              selectedAgentIcon: renderItem.selectedAgentIcon,
              presentationMetadata: renderItem.presentationMetadata,
              enableCollaborationBadge: activeEngine === "codex",
            }).displayText
          : "";
      const shouldRenderUserActions =
        renderItem.role === "user" && userCopyText.trim().length > 0;
      const shouldRenderForkAction =
        isLatestFinalAssistant &&
        Boolean(actionTargetUserMessageId) &&
        typeof onForkFromMessage === "function";
      const shouldRenderRewindAction =
        isLatestFinalAssistant &&
        Boolean(actionTargetUserMessageId) &&
        typeof onRewindFromMessage === "function";
      const renderAssistantActions = () => {
        if (!shouldRenderAssistantActions) {
          return null;
        }
        // 统一 lucide 细描边，贴近常见对话产品的轻量图标行
        const actionIconProps = {
          size: 16,
          strokeWidth: 1.5,
          absoluteStrokeWidth: false as const,
          "aria-hidden": true as const,
        };
        return (
          <div
            className="message-action-bar message-action-bar-row"
            aria-label={t("messages.messageActions")}
          >
            <TooltipIconButton
              className={`ghost message-action-button message-copy-button${isCopied ? " is-copied" : ""}`}
              onClick={() => handleCopyMessage(renderItem, assistantCopyText)}
              label={t("messages.copyMessage")}
              tooltipSide="top"
            >
              <span className="message-copy-icon" aria-hidden>
                <Copy className="message-copy-icon-copy message-action-icon" {...actionIconProps} />
                <Check className="message-copy-icon-check message-action-icon" {...actionIconProps} />
              </span>
            </TooltipIconButton>
            {shouldRenderForkAction && actionTargetUserMessageId ? (
              <TooltipIconButton
                className="ghost message-action-button"
                onClick={() => onForkFromMessage(actionTargetUserMessageId)}
                label={t("messages.forkMessage")}
                tooltipSide="top"
              >
                <GitBranch
                  className="message-action-icon message-fork-icon"
                  {...actionIconProps}
                />
              </TooltipIconButton>
            ) : null}
            {shouldRenderRewindAction && actionTargetUserMessageId ? (
              <TooltipIconButton
                className="ghost message-action-button"
                onClick={() => onRewindFromMessage(actionTargetUserMessageId)}
                label={t("messages.rewindMessage")}
                tooltipSide="top"
              >
                <History
                  className="message-action-icon message-history-icon"
                  {...actionIconProps}
                />
              </TooltipIconButton>
            ) : null}
            {isLatestFinalAssistant && onOpenNoteCaptureMenu ? (
              <TooltipIconButton
                className="ghost message-action-button"
                onClick={(event) => onOpenNoteCaptureMenu(event.currentTarget)}
                label={t("noteCards.captureMenu")}
                tooltipSide="top"
              >
                <NotebookPen className="message-action-icon" {...actionIconProps} />
              </TooltipIconButton>
            ) : null}
          </div>
        );
      };
      const renderUserActions = () => {
        if (!shouldRenderUserActions) {
          return null;
        }
        const cache = userActionNodeCacheRef.current;
        const cached = cache.get(renderItem.id);
        if (
          cached &&
          cached.item === renderItem &&
          cached.copyText === userCopyText &&
          cached.isCopied === isCopied &&
          cached.translate === t
        ) {
          return cached.node;
        }
        const node = (
          <div
            className="message-action-bar message-user-bubble-actions"
            aria-label={t("messages.messageActions")}
          >
            <TooltipIconButton
              className={`ghost message-action-button message-copy-button${isCopied ? " is-copied" : ""}`}
              onClick={() => handleCopyMessage(renderItem, userCopyText)}
              label={t("messages.copyUserMessage")}
              tooltipSide="top"
            >
              <span className="message-copy-icon" aria-hidden>
                <Copy className="message-copy-icon-copy" size={12} />
                <Check className="message-copy-icon-check" size={12} />
              </span>
            </TooltipIconButton>
          </div>
        );
        if (cache.size >= USER_ACTION_NODE_CACHE_LIMIT) {
          cache.clear();
        }
        cache.set(renderItem.id, {
          item: renderItem,
          copyText: userCopyText,
          isCopied,
          translate: t,
          node,
        });
        return node;
      };
      const bindMessageNode = messageNodeRefs.getRef(renderItem.id, {
        role: renderItem.role,
        taskId: agentTaskNotification?.taskId ?? null,
        toolUseId: agentTaskNotification?.toolUseId ?? null,
      });
      return (
        <Fragment key={itemRenderKey}>
          <div
            ref={bindMessageNode}
            data-message-anchor-id={renderItem.id}
            data-agent-task-id={agentTaskNotification?.taskId ?? undefined}
            data-agent-tool-use-id={agentTaskNotification?.toolUseId ?? undefined}
          >
            <MessageRow
              item={renderItem}
              workspaceId={workspaceId}
              threadId={threadId}
              isStreaming={
                (activeEngine === "claude" ||
                  activeEngine === "codex" ||
                  activeEngine === "gemini" ||
                  activeEngine === "grok" ||
                  activeEngine === "kimi" ||
                  activeEngine === "opencode") &&
                renderItem.role === "assistant" &&
                renderItem.recoveredFromLiveShadow !== true &&
                renderItem.id === liveAssistantMessageId
              }
              activeEngine={activeEngine}
              activeCollaborationModeId={activeCollaborationModeId}
              enableCollaborationBadge={activeEngine === "codex"}
              presentationProfile={presentationProfile}
              nativeRuntimeRecoveryEnabled={nativeRuntimeRecoveryEnabled}
              showRuntimeReconnectCard={renderItem.id === latestRuntimeReconnectItemId}
              onRecoverThreadRuntime={onRecoverThreadRuntime}
              onRecoverThreadRuntimeAndResend={onRecoverThreadRuntimeAndResend}
              onThreadRecoveryFork={onThreadRecoveryFork}
              retryMessage={
                renderItem.id === latestRuntimeReconnectItemId
                  ? latestRetryMessage
                  : null
              }
              userActionNode={renderUserActions()}
              codeBlockCopyUseModifier={codeBlockCopyUseModifier}
              onOpenFileLink={openFileLink}
              onOpenFileLinkMenu={showFileLinkMenu}
              streamMitigationProfile={streamMitigationProfile}
              onAssistantVisibleTextRender={onAssistantVisibleTextRender}
              suppressMemorySummaryCard={suppressedUserMemoryContextMessageIds.has(renderItem.id)}
              suppressNoteCardSummaryCard={suppressedUserNoteCardContextMessageIds.has(renderItem.id)}
              showTurnTargetBadge={
                !renderItem.executionTargetSnapshot ||
                turnTargetBadgeVisibleItemIds.has(renderItem.id)
              }
              onOutlineReady={
                renderItem.role === "assistant" && renderItem.id === liveAssistantMessageId
                  ? liveAssistantOutlineReady
                  : undefined
              }
            />
          </div>
          {shouldRenderFinalBoundary && (
            <div
              className="message-assistant-action-footer messages-final-boundary"
              data-testid="message-assistant-action-footer"
            >
              {renderAssistantActions()}
              {finalMetaText ? (
                <span
                  className="message-assistant-action-meta messages-turn-boundary-meta"
                  data-testid="message-assistant-action-meta"
                >
                  {finalMetaText}
                </span>
              ) : null}
            </div>
          )}
        </Fragment>
      );
    }
    if (renderKind === "reasoning" && renderItem.kind === "reasoning") {
      const itemRenderKey = `reasoning:${renderItem.id}`;
      const isExpanded = expandedItems.has(renderItem.id);
      // 必须基于最终 renderItem 解析：相邻 reasoning 合并后会复用 latest id，
      // 但 content/summary 已是拼接结果；若仍查源表 reasoningMetaById 会拿到合并前的短正文。
      // parseReasoning 按 item 引用 WeakMap 缓存，稳定行无额外成本。
      const parsed = parseReasoning(renderItem);
      const isLiveReasoning =
        isThinking && latestReasoningId === renderItem.id;
      return (
        <ReasoningRow
          key={itemRenderKey}
          item={renderItem}
          workspaceId={workspaceId}
          parsed={parsed}
          isExpanded={isExpanded}
          isLive={isLiveReasoning}
          activeEngine={activeEngine}
          onToggle={toggleExpanded}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          presentationProfile={presentationProfile}
          streamMitigationProfile={streamMitigationProfile}
        />
      );
    }
    if (renderKind === "review" && renderItem.kind === "review") {
      return (
        <ReviewRow
          key={`review:${renderItem.id}`}
          item={renderItem}
          workspaceId={workspaceId}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
        />
      );
    }
    if (renderKind === "generatedImage" && renderItem.kind === "generatedImage") {
      return (
        <GeneratedImageRow
          key={`generated-image:${renderItem.id}`}
          item={renderItem}
          workspaceId={workspaceId}
        />
      );
    }
    if (renderKind === "diff" && renderItem.kind === "diff") {
      return <DiffRow key={`diff:${renderItem.id}`} item={renderItem} />;
    }
    if (renderKind === "tool" && renderItem.kind === "tool") {
      const isExpanded = expandedItems.has(renderItem.id);
      const selectedExitPlanExecutionMode =
        selectedExitPlanExecutionByItemKey[`${threadId ?? "no-thread"}:${renderItem.id}`] ?? null;
      return (
        <div key={`tool:${renderItem.id}`} className="message-tool-block-shell">
          <ToolBlockRenderer
            item={renderItem}
            workspaceId={workspaceId}
            isExpanded={isExpanded}
            onToggle={toggleExpanded}
            onRequestAutoScroll={requestAutoScroll}
            activeCollaborationModeId={activeCollaborationModeId}
            activeEngine={activeEngine}
            hasPendingUserInputRequest={activeUserInputRequestId !== null}
            onOpenFilePath={openFileLink}
            onOpenDiffPath={onOpenDiffPath}
            selectedExitPlanExecutionMode={selectedExitPlanExecutionMode}
            onExitPlanModeExecute={handleExitPlanModeExecuteForItem}
          />
        </div>
      );
    }
    if (renderKind === "explore" && renderItem.kind === "explore") {
      const isExpanded =
        liveAutoExpandedExploreId === renderItem.id || expandedItems.has(renderItem.id);
      return (
        <ExploreRow
          key={`explore:${renderItem.id}`}
          item={renderItem}
          isExpanded={isExpanded}
          onToggle={toggleExpanded}
        />
      );
    }
    return null;
  };

  const renderEntry = (entry: GroupedEntry) => {
    const shouldRenderUserInputAfterEntry = Boolean(
      userInputNode &&
        activeUserInputAnchorItemId &&
        groupedEntryContainsItemId(entry, activeUserInputAnchorItemId),
    );
    const renderWithAnchoredUserInput = (node: ReactNode) => {
      if (!shouldRenderUserInputAfterEntry) {
        return node;
      }
      return (
        <Fragment key={`user-input-anchor:${activeUserInputAnchorItemId}`}>
          {node}
          {userInputNode}
        </Fragment>
      );
    };
    if (entry.kind === "readGroup") {
      const firstItem = entry.items[0];
      return renderWithAnchoredUserInput(
        <ReadToolGroupBlock key={`rg-${firstItem?.id ?? "read-group"}`} items={entry.items} />,
      );
    }
    if (entry.kind === "editGroup") {
      const firstItem = entry.items[0];
      return renderWithAnchoredUserInput(
        <EditToolGroupBlock
          key={`eg-${firstItem?.id ?? "edit-group"}`}
          items={entry.items}
          onOpenFilePath={openFileLink}
          onOpenDiffPath={onOpenDiffPath}
        />,
      );
    }
    if (entry.kind === "bashGroup") {
      // Pure shell noise is filtered before collapse. Remaining bash rows are
      // Codex file-IO commands (cat/rg/apply_patch) and MUST render — otherwise
      // process-phase expand shows a chip with N tools but an empty body.
      const visibleItems = entry.items.filter(
        (toolItem) => !shouldHideCodexCanvasCommandCard(toolItem, activeEngine),
      );
      if (visibleItems.length === 0) {
        return null;
      }
      const firstItem = visibleItems[0];
      return renderWithAnchoredUserInput(
        <BashToolGroupBlock
          key={`bg-${firstItem?.id ?? "bash-group"}`}
          items={visibleItems}
          onRequestAutoScroll={requestAutoScroll}
        />,
      );
    }
    if (entry.kind === "searchGroup") {
      const firstItem = entry.items[0];
      return renderWithAnchoredUserInput(
        <SearchToolGroupBlock key={`sg-${firstItem?.id ?? "search-group"}`} items={entry.items} />,
      );
    }
    return renderWithAnchoredUserInput(renderSingleItem(entry.item));
  };
  const renderLightweightProjectionRow = (
    row: TimelineProjectionRow,
    hydrationState: TimelineRowHydrationState,
  ) => {
    const { itemCount, rowKindLabel, singleMessage } = resolveTimelineLightweightRowSummary(
      row,
      {
        assistantMessage: t("messages.conversationLightweightAssistantMessage"),
        userMessage: t("messages.conversationLightweightUserMessage"),
      },
    );
    const actionTargetUserMessageId =
      singleMessage?.role === "assistant"
        ? messageActionTargetByAssistantId.get(singleMessage.id) ?? null
        : null;
    const shouldRenderForkAction =
      singleMessage?.id === latestFinalAssistantMessageId &&
      Boolean(actionTargetUserMessageId) &&
      typeof onForkFromMessage === "function";
    const shouldRenderRewindAction =
      singleMessage?.id === latestFinalAssistantMessageId &&
      Boolean(actionTargetUserMessageId) &&
      typeof onRewindFromMessage === "function";
    const bindLightweightMessageNode = singleMessage
      ? messageNodeRefs.getRef(singleMessage.id, {
          role: singleMessage.role,
          taskId: null,
          toolUseId: null,
        })
      : undefined;

    return (
      <div
        ref={bindLightweightMessageNode}
        className="messages-lightweight-row-summary"
        data-conversation-lightweight-row="true"
        data-message-anchor-id={singleMessage?.id}
      >
        <div className="messages-lightweight-row-summary-main">
          <span className="messages-lightweight-row-summary-eyebrow">
            {t("messages.conversationLightweightRowEyebrow")}
          </span>
          <span className="messages-lightweight-row-summary-title">
            {t("messages.conversationLightweightRowTitle", {
              kind: rowKindLabel,
              count: itemCount,
            })}
          </span>
          <span>
            {t("messages.conversationLightweightRowMeta", {
              weight: hydrationState.renderWeight,
            })}
          </span>
        </div>
        <div className="messages-lightweight-row-summary-actions">
          {shouldRenderForkAction && actionTargetUserMessageId ? (
            <TooltipIconButton
              className="ghost message-action-button"
              onClick={() => onForkFromMessage(actionTargetUserMessageId)}
              label={t("messages.forkMessage")}
              tooltipSide="top"
            >
              <span className="codicon codicon-git-branch-create" aria-hidden />
            </TooltipIconButton>
          ) : null}
          {shouldRenderRewindAction && actionTargetUserMessageId ? (
            <TooltipIconButton
              className="ghost message-action-button"
              onClick={() => onRewindFromMessage(actionTargetUserMessageId)}
              label={t("messages.rewindMessage")}
              tooltipSide="top"
            >
              <span className="codicon codicon-history" aria-hidden />
            </TooltipIconButton>
          ) : null}
          <button
            type="button"
            className="messages-lightweight-row-detail-button"
            onClick={onConversationDetailHydrationRequest}
          >
            {t("messages.conversationLightweightHydrateVisible")}
          </button>
        </div>
      </div>
    );
  };
  const renderProjectionRow = (row: TimelineProjectionRow | undefined) => {
    if (!row) {
      return null;
    }
    if (row.kind === "entry") {
      const entryNode = renderEntry(row.entry);
      if (!entryNode) {
        return null;
      }
      // Remount fade-in when a phase is expanded (hard-unmount model: no soft hide).
      if (row.processPhaseKey && !row.processPhaseCollapsed) {
        const revealDelayMs = Math.min(140, (row.processPhaseRevealIndex ?? 0) * 32);
        return (
          <div
            className="messages-process-phase-slot is-expanded"
            data-process-phase-key={row.processPhaseKey}
            data-process-phase-collapsed="false"
            style={{ animationDelay: `${revealDelayMs}ms` } satisfies CSSProperties}
          >
            <div className="messages-process-phase-slot-inner">{entryNode}</div>
          </div>
        );
      }
      return entryNode;
    }
    if (row.kind === "dockedReasoning") {
      const dockedReasoning = dockedReasoningById.get(row.itemId);
      if (!dockedReasoning) {
        return null;
      }
      const { item, parsed } = dockedReasoning;
      return (
        <ReasoningRow
          key={`claude-live-${item.id}`}
          item={item}
          workspaceId={workspaceId}
          parsed={parsed}
          isExpanded={isThinking && latestReasoningId === item.id ? true : expandedItems.has(item.id)}
          isLive={isThinking && latestReasoningId === item.id}
          onToggle={toggleExpanded}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
          presentationProfile={presentationProfile}
          streamMitigationProfile={streamMitigationProfile}
        />
      );
    }
    if (row.kind === "tailUserInput") {
      return userInputNode;
    }
    if (row.kind === "liveMiddleCollapsed") {
      return (
        <MiddleStepsCollapsedChip
          count={row.count}
          expanded={row.expanded}
          breakdown={row.breakdown}
          onToggle={() => onToggleProcessPhaseExpanded(row.phaseKey)}
        />
      );
    }
    if (row.kind === "workingIndicator") {
      return (
        <WorkingIndicator
          isThinking={isWorking}
          proxyEnabled={proxyEnabled}
          proxyUrl={proxyUrl}
          processingStartedAt={processingStartedAt}
          lastDurationMs={lastDurationMs}
          heartbeatPulse={heartbeatPulse}
          hasItems={effectiveItemsCount > 0}
          reasoningLabel={latestReasoningLabel}
          activityLabel={latestWorkingActivityLabel}
          primaryLabel={primaryWorkingLabel}
          activeEngine={activeEngine}
          waitingForFirstChunk={waitingForFirstChunk}
          presentationProfile={presentationProfile}
        />
      );
    }
    if (row.kind === "historyRecoveryFailure") {
      return (
        <div
          className="message-runtime-recovery-card"
          role="alert"
          aria-label={t("messages.threadRecoveryTitle")}
        >
          <div className="message-runtime-recovery-header">
            <Terminal className="message-runtime-recovery-icon" size={15} aria-hidden />
            <div className="message-runtime-recovery-copy">
              <div className="message-runtime-recovery-title">
                {t("messages.threadRecoveryTitle")}
              </div>
              <div className="message-runtime-recovery-description">
                {t("messages.threadRecoveryFailed")}
              </div>
            </div>
            {onRetryHistory ? (
              <div className="message-runtime-recovery-actions">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="message-runtime-recovery-button"
                  onClick={onRetryHistory}
                >
                  {t("messages.threadRecoveryAction")}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      );
    }
    if (row.kind === "emptyState") {
      if (row.state === "historyLoading") {
        const progress = historyLoadingProgress ?? null;
        const title = progress
          ? t(`messages.${progress.titleKey}`, progress.detailParams)
          : t("messages.restoringHistory");
        const detail = progress
          ? t(`messages.${progress.detailKey}`, progress.detailParams)
          : t("messages.restoringHistoryHint");
        const percent = progress?.percent ?? null;
        return (
          <div
            className="empty messages-empty messages-history-loading"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <span className="working-spinner" aria-hidden="true" />
            <div className="messages-history-loading-copy">
              <strong>{title}</strong>
              <span>{detail}</span>
              <div
                className={`messages-history-loading-bar${percent == null ? " is-indeterminate" : ""}`}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent ?? undefined}
                aria-label={title}
              >
                <div
                  className="messages-history-loading-bar-fill"
                  style={percent == null ? undefined : { width: `${percent}%` }}
                />
              </div>
              {percent != null ? (
                <span className="messages-history-loading-percent">{percent}%</span>
              ) : null}
            </div>
          </div>
        );
      }
      if (row.state === "hiddenReasoning") {
        return (
          <div className="empty messages-empty messages-hidden-reasoning">
            {t("messages.hiddenThinkingContent")}
          </div>
        );
      }
      return <div className="empty messages-empty">{t("messages.emptyThread")}</div>;
    }
    if (row.kind === "approval") {
      return approvalNode;
    }
    if (row.kind === "bottomAnchor") {
      return null;
    }
    return null;
  };
  return (
    <ConversationRowErrorBoundary
      key={`row-boundary:${row.key}:${hydrationState?.contentHash ?? "unknown"}`}
      rowKey={row.key}
      rowKind={row.kind}
      contentHash={hydrationState?.contentHash ?? null}
      renderWeight={hydrationState?.renderWeight ?? null}
      engine={activeEngine}
      threadId={threadId}
      workspaceId={workspaceId ?? null}
      fallbackTitle={t("messages.rowRenderFailedTitle")}
      fallbackDescription={t("messages.rowRenderFailedDescription")}
      retryLabel={t("messages.rowRenderRetry")}
      retryBlockedLabel={t("messages.rowRenderRetryBlocked")}
    >
      {renderLightweight && hydrationState
        ? renderLightweightProjectionRow(row, hydrationState)
        : renderProjectionRow(row)}
    </ConversationRowErrorBoundary>
  );
});
