import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { AgentIcon } from "../../../../components/AgentIcon";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { appendMessageRowRenderBudgetDiagnostic } from "../../../../services/rendererDiagnostics";
import { trackHotspot } from "../../../../services/perfBaseline/hotspotTracker";
import { useRenderHotspot } from "../../../../services/perfBaseline/useRenderHotspot";
import type { ConversationItem } from "../../../../types";
import { useLiveAssistantText } from "../../../threads/hooks/useLiveAssistantText";
import { isLiveTextExternalizationEnabled } from "../../../threads/utils/realtimePerfFlags";
import {
  noteThreadLiveRowRenderMeasured,
} from "../../../threads/utils/streamLatencyDiagnostics";
import { EngineTaskOutputInspector } from "../../../engine-task-output/components/EngineTaskOutputInspector";
import { useEngineTaskOutputSnapshot } from "../../../engine-task-output/hooks/useEngineTaskOutputSnapshot";
import type { EngineTaskOutputSnapshot } from "../../../engine-task-output/types";
import {
  buildEngineTaskOutputSnapshot,
  buildTaskOutputSourceFromNotification,
} from "../../../engine-task-output/utils/engineTaskOutputProjection";
import type { PresentationProfile } from "../../../../conversation-presentation/presentationProfile";
import {
  CollapsibleUserTextBlock,
  UserCodeAnnotationContextBlock,
} from "../../components/context/CollapsibleUserTextBlock";
import { ConversationBrowserContextSummaryCard } from "../../../../conversation-presentation/components/ConversationBrowserContextSummaryCard";
import {
  ImageLightbox,
  MessageImageGrid,
} from "../../components/media/MessageMediaBlocks";
import { Markdown } from "../../components/Markdown";
import { IntentCanvasContextSummaryCard } from "../../components/context/IntentCanvasContextSummaryCard";
import { NoteCardContextSummaryCard } from "../../components/context/NoteCardContextSummaryCard";
import {
  analyzeStreamingMarkdownComplexity,
  analyzeStreamingMarkdownComplexityDelta,
  EMPTY_STREAMING_MARKDOWN_COMPLEXITY,
  resolveAssistantMessageStreamingThrottleMs,
  shouldUseStagedStreamingMarkdown,
  type StreamMitigationProfile,
  type StreamingMarkdownComplexity,
} from "../presentation/messagesStreamingComplexity";
import { RuntimeReconnectCard } from "../../components/recovery/RuntimeReconnectCard";
import {
  resolveAssistantRuntimeReconnectHint,
} from "../../../../runtime-recovery/runtimeReconnect";
import {
  basenameFromPath,
  MessagesEngine,
  normalizeAgentTaskStatus,
  resolveAgentTaskDisplaySummary,
} from "../../utils/messagesRenderUtils";
import {
  areMessageRowPropsEqual,
  type MessageItem,
  type MessageRowEqualityProps,
} from "../presentation/messageRowEquality";
import {
  deferredMessageImageKey,
  useDeferredMessageImages,
} from "../hooks/useDeferredMessageImages";
import { buildMessageRowPresentation } from "../presentation/messageRowPresentation";
import { resolveTurnBadge } from "../../../../utils/turnBadge";

type MessageRowProps = MessageRowEqualityProps;

const EMPTY_DEFERRED_IMAGE_ITEMS: NonNullable<
  MessageItem["deferredImages"]
> = [];

function formatDeferredImageSize(byteSize: number) {
  if (!Number.isFinite(byteSize) || byteSize <= 0) {
    return "unknown size";
  }
  if (byteSize >= 1024 * 1024) {
    return `${(byteSize / 1024 / 1024).toFixed(1)} MB`;
  }
  if (byteSize >= 1024) {
    return `${Math.round(byteSize / 1024)} KB`;
  }
  return `${Math.round(byteSize)} B`;
}

function readHighResolutionNowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function shouldUsePlainTextStreamingSurface(
  item: Extract<ConversationItem, { kind: "message" }>,
  isStreaming: boolean,
  activeEngine: MessagesEngine,
  mitigationProfile: StreamMitigationProfile | null | undefined,
) {
  return (
    item.role === "assistant" &&
    isStreaming &&
    activeEngine !== "codex" &&
    mitigationProfile?.renderPlainTextWhileStreaming === true
  );
}

/**
 * staged streaming 引擎（claude / codex）的流式 assistant 消息自首个非空 token
 * 起统一走 lightweight markdown。历史上早期阶段（<260 chars 且非结构化）仍走
 * full react-markdown，每次 48ms throttled 更新都触发全量重解析 + Prism 同步
 * 高亮，是对话页 5 FPS / 单组件 225ms 的主因之一；settle 后由 full markdown
 * 渲染最终内容，视觉结果不变。
 */
// A4 流式正文外部化（docs/perf/a4-live-text-externalization-plan.md）：
// 模块加载时读一次 flag，翻转需刷新页面（与其余 perf flag 同语义）。
const LIVE_TEXT_EXTERNALIZATION_ENABLED = isLiveTextExternalizationEnabled();

function shouldUseLightweightStreamingMarkdown(
  item: Extract<ConversationItem, { kind: "message" }>,
  isStreaming: boolean,
  activeEngine: MessagesEngine,
  presentationProfile: PresentationProfile | null | undefined,
  complexity: StreamingMarkdownComplexity,
) {
  if (item.role !== "assistant" || !isStreaming) {
    return false;
  }
  const useStagedMarkdownThrottle = shouldUseStagedStreamingMarkdown(
    activeEngine,
    presentationProfile,
  );
  if (!useStagedMarkdownThrottle) {
    return false;
  }
  return complexity.trimmedText.length > 0;
}

function shouldUseLongFoldedMarkdownStreamingSurface(
  item: Extract<ConversationItem, { kind: "message" }>,
  isStreaming: boolean,
  activeEngine: MessagesEngine,
  text: string,
) {
  return (
    item.role === "assistant" &&
    isStreaming &&
    activeEngine === "claude" &&
    text.length > STREAMING_PLAIN_TEXT_COLLAPSE_THRESHOLD
  );
}

const STREAMING_PLAIN_TEXT_COLLAPSE_THRESHOLD = 20_000;
const STREAMING_PLAIN_TEXT_HEAD_CHARS = 4_000;
const STREAMING_PLAIN_TEXT_TAIL_CHARS = 2_000;

function resolveStreamingPlainTextCollapsedView({
  text,
  omittedChars,
  marker,
}: {
  text: string;
  omittedChars: number;
  marker: string;
}) {
  if (text.length <= STREAMING_PLAIN_TEXT_COLLAPSE_THRESHOLD) {
    return text;
  }
  if (omittedChars <= 0) {
    return text;
  }
  return [
    text.slice(0, STREAMING_PLAIN_TEXT_HEAD_CHARS),
    `\n\n${marker}\n\n`,
    text.slice(-STREAMING_PLAIN_TEXT_TAIL_CHARS),
  ].join("");
}

export const MessageRow = memo(function MessageRow({
  item,
  workspaceId = null,
  threadId = null,
  isStreaming = false,
  activeEngine = "claude",
  enableCollaborationBadge = false,
  presentationProfile = null,
  nativeRuntimeRecoveryEnabled = true,
  showRuntimeReconnectCard = false,
  onRecoverThreadRuntime,
  onRecoverThreadRuntimeAndResend,
  onThreadRecoveryFork,
  retryMessage = null,
  userActionNode = null,
  codeBlockCopyUseModifier,
  onOpenFileLink,
  onOpenFileLinkMenu,
  streamMitigationProfile = null,
  onAssistantVisibleTextRender,
  suppressMemorySummaryCard = false,
  suppressNoteCardSummaryCard = false,
  showTurnTargetBadge = true,
  onOutlineReady,
}: MessageRowProps) {
  const renderStartedAtMs = readHighResolutionNowMs();
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  const { t } = useTranslation();
  const lastLongLiveRenderDiagnosticRef = useRef<{
    itemId: string;
    textLength: number;
  }>({ itemId: "", textLength: 0 });
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const deferredImageItems = item.deferredImages ?? EMPTY_DEFERRED_IMAGE_ITEMS;
  const {
    states: deferredImageStates,
    loadedImages: loadedDeferredImages,
    load: loadDeferredImage,
  } = useDeferredMessageImages({
    messageId: item.id,
    threadId,
    images: deferredImageItems,
  });
  const [memorySummaryExpanded, setMemorySummaryExpanded] = useState(false);
  const [memoryPayloadDialogOpen, setMemoryPayloadDialogOpen] = useState(false);
  const [isAgentBadgeExpanded, setIsAgentBadgeExpanded] = useState(false);
  const [inspectedTaskOutput, setInspectedTaskOutput] =
    useState<EngineTaskOutputSnapshot | null>(null);
  const inspectedTaskOutputState = useEngineTaskOutputSnapshot({
    workspaceId,
    snapshot: inspectedTaskOutput,
  });
  useEffect(() => {
    if (!memoryPayloadDialogOpen) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMemoryPayloadDialogOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [memoryPayloadDialogOpen]);
  // A4 live-text 外部化：流式中的 assistant 行订阅 liveAssistantTextChannel
  // （通道自首条 delta 起全量累计，item.text 仅为建壳首段），后续 delta 只驱动
  // 本行小树渲染。非流式行/flag 关闭时订阅为空、零开销；终稿落地或中断 drain
  // 后通道条目清除，本行自然切回读 item.text。
  const liveAssistantTextEntry = useLiveAssistantText(
    threadId,
    LIVE_TEXT_EXTERNALIZATION_ENABLED && isStreaming && item.role === "assistant",
  );
  const liveAssistantText =
    liveAssistantTextEntry && isStreaming && item.role === "assistant"
      ? liveAssistantTextEntry.text
      : null;
  const staticPresentation = useMemo(() => buildMessageRowPresentation({
    item,
    enableCollaborationBadge,
    suppressMemorySummaryCard,
    suppressNoteCardSummaryCard,
  }), [
    enableCollaborationBadge,
    item,
    suppressMemorySummaryCard,
    suppressNoteCardSummaryCard,
  ]);
  const {
    resolvedMemorySummary,
    resolvedNoteCardSummary,
    memorySummaryRecords,
    memorySummaryRawPayload,
    memoryPayloadPacks,
    agentTaskNotification,
    suppressSubagentAgentTaskCard,
    browserContextSummary,
    intentCanvasContextSummary,
    displayText: staticDisplayText,
    canUseLiveAssistantText,
    messageRowSubtype,
    selectedAgentName,
    selectedAgentIcon,
    hasExternalAgentBadge,
    parsedUserTextContent,
    imageItems,
  } = staticPresentation;
  const displayText = canUseLiveAssistantText
    ? liveAssistantText ?? staticDisplayText
    : staticDisplayText;
  const hasText = displayText.trim().length > 0;
  // jetbrains 同帧 stick：流式正文不再 useDeferredValue，避免「字先长高、钉底晚一帧」闪一下。
  // liveAssistantTextChannel 已自带 cadence，直接用 displayText。
  const streamingDisplayText = displayText;
  useEffect(() => {
    appendMessageRowRenderBudgetDiagnostic({
      threadId,
      itemId: item.id,
      role: item.role,
      subtype: messageRowSubtype,
      evidenceKind: "proxy",
      renderCount: renderCountRef.current,
      isStreaming,
      textLength: displayText.length,
    });
  });
  useRenderHotspot(
    "message-row-render",
    `${messageRowSubtype}:${displayText.length}ch:${isStreaming ? "stream" : "idle"}`,
    isStreaming,
  );
  const agentTaskDisplay = useMemo(() => {
    if (!agentTaskNotification || suppressSubagentAgentTaskCard) {
      return null;
    }
    return {
      ...resolveAgentTaskDisplaySummary(agentTaskNotification.summary),
      status: normalizeAgentTaskStatus(agentTaskNotification.status),
      outputFileName: basenameFromPath(agentTaskNotification.outputFile),
    };
  }, [agentTaskNotification, suppressSubagentAgentTaskCard]);
  const agentTaskOutputSnapshot = useMemo(() => {
    if (!agentTaskNotification || !agentTaskDisplay || suppressSubagentAgentTaskCard) {
      return null;
    }
    return buildEngineTaskOutputSnapshot(
      buildTaskOutputSourceFromNotification({
        itemId: item.id,
        engine: activeEngine,
        title: agentTaskDisplay.title,
        notification: agentTaskNotification,
      }),
      null,
    );
  }, [
    activeEngine,
    agentTaskDisplay,
    agentTaskNotification,
    item.id,
    suppressSubagentAgentTaskCard,
  ]);
  useEffect(() => {
    setIsAgentBadgeExpanded(false);
  }, [item.id, selectedAgentIcon, selectedAgentName]);
  useEffect(() => {
    setInspectedTaskOutput(null);
  }, [item.id]);
  const handleToggleAgentBadge = useCallback(() => {
    setIsAgentBadgeExpanded((current) => !current);
  }, []);
  const lightboxImages = useMemo(
    () => [...imageItems, ...loadedDeferredImages],
    [imageItems, loadedDeferredImages],
  );
  const useStagedMarkdownThrottle = shouldUseStagedStreamingMarkdown(
    activeEngine,
    presentationProfile,
  );
  const resolvedMarkdownClassName = isStreaming
    ? "markdown markdown-live-streaming"
    : "markdown";
  const streamingMarkdownComplexityCacheRef = useRef<{
    value: string;
    complexity: StreamingMarkdownComplexity;
  } | null>(null);
  const streamingMarkdownComplexity = useMemo(
    () => {
      if (
        item.role !== "assistant" ||
        !isStreaming ||
        !useStagedMarkdownThrottle
      ) {
        streamingMarkdownComplexityCacheRef.current = null;
        return EMPTY_STREAMING_MARKDOWN_COMPLEXITY;
      }
      return trackHotspot("markdown-complexity", `${streamingDisplayText.length}ch`, () => {
        const previousCache = streamingMarkdownComplexityCacheRef.current;
        if (previousCache) {
          // chat-stream-render-isolation-2026-06 task 3.1: prefer the delta
          // path when displayText strictly extends the cached prefix, so
          // long streaming bursts avoid re-scanning the full prefix.
          if (streamingDisplayText === previousCache.value) {
            return previousCache.complexity;
          }
          if (streamingDisplayText.startsWith(previousCache.value)) {
            const deltaText = streamingDisplayText.slice(previousCache.value.length);
            const nextComplexity = analyzeStreamingMarkdownComplexityDelta(
              previousCache.complexity,
              previousCache.value,
              deltaText,
            );
            streamingMarkdownComplexityCacheRef.current = {
              value: streamingDisplayText,
              complexity: nextComplexity,
            };
            return nextComplexity;
          }
          if (previousCache.complexity.isHuge) {
            return previousCache.complexity;
          }
        }
        const nextComplexity = analyzeStreamingMarkdownComplexity(streamingDisplayText);
        streamingMarkdownComplexityCacheRef.current = {
          value: streamingDisplayText,
          complexity: nextComplexity,
        };
        return nextComplexity;
      });
    },
    [streamingDisplayText, isStreaming, item.role, useStagedMarkdownThrottle],
  );
  const usePlainTextStreamingSurface = shouldUsePlainTextStreamingSurface(
    item,
    isStreaming,
    activeEngine,
    streamMitigationProfile,
  );
  const useLongFoldedMarkdownStreamingSurface = shouldUseLongFoldedMarkdownStreamingSurface(
    item,
    isStreaming,
    activeEngine,
    streamingDisplayText,
  );
  const useLightweightStreamingMarkdown = !usePlainTextStreamingSurface && (
    useLongFoldedMarkdownStreamingSurface ||
    shouldUseLightweightStreamingMarkdown(
      item,
      isStreaming,
      activeEngine,
      presentationProfile,
      streamingMarkdownComplexity,
    )
  );
  const livePlainTextClassName = `${resolvedMarkdownClassName} markdown-live-plain-text`;
  const streamingPlainTextCollapsedOmittedChars = useMemo(() => {
    if (!useLongFoldedMarkdownStreamingSurface) {
      return 0;
    }
    const omitted = streamingDisplayText.length - (
      STREAMING_PLAIN_TEXT_HEAD_CHARS + STREAMING_PLAIN_TEXT_TAIL_CHARS
    );
    return Math.max(omitted, 0);
  }, [streamingDisplayText.length, useLongFoldedMarkdownStreamingSurface]);
  const liveFoldedStreamingSurfaceText = useMemo(() => {
    if (!useLongFoldedMarkdownStreamingSurface || streamingPlainTextCollapsedOmittedChars <= 0) {
      return streamingDisplayText;
    }
    return resolveStreamingPlainTextCollapsedView({
      text: streamingDisplayText,
      omittedChars: streamingPlainTextCollapsedOmittedChars,
      marker: t("messages.streamingPlainTextCollapsed", {
        omittedChars: streamingPlainTextCollapsedOmittedChars,
      }),
    });
  }, [streamingDisplayText, streamingPlainTextCollapsedOmittedChars, t, useLongFoldedMarkdownStreamingSurface]);
  const handleRenderedAssistantValue = useCallback(
    (visibleText: string) => {
      if (item.role !== "assistant" || !isStreaming) {
        return;
      }
      onAssistantVisibleTextRender?.({
        itemId: item.id,
        visibleText,
      });
    },
    [isStreaming, item.id, item.role, onAssistantVisibleTextRender],
  );
  const handleMarkdownRenderedAssistantValue = useCallback(
    (visibleText: string) => {
      handleRenderedAssistantValue(
        useLongFoldedMarkdownStreamingSurface ? streamingDisplayText : visibleText,
      );
    },
    [streamingDisplayText, handleRenderedAssistantValue, useLongFoldedMarkdownStreamingSurface],
  );
  useEffect(() => {
    if (!usePlainTextStreamingSurface) {
      return;
    }
    handleRenderedAssistantValue(streamingDisplayText);
  }, [
    streamingDisplayText,
    handleRenderedAssistantValue,
    usePlainTextStreamingSurface,
  ]);
  useEffect(() => {
    if (usePlainTextStreamingSurface || !useLightweightStreamingMarkdown) {
      return;
    }
    handleRenderedAssistantValue(streamingDisplayText);
  }, [
    streamingDisplayText,
    handleRenderedAssistantValue,
    useLightweightStreamingMarkdown,
    usePlainTextStreamingSurface,
  ]);
  useEffect(() => {
    if (
      !threadId ||
      item.role !== "assistant" ||
      !isStreaming ||
      displayText.length <= STREAMING_PLAIN_TEXT_COLLAPSE_THRESHOLD
    ) {
      return;
    }
    const previousDiagnostic = lastLongLiveRenderDiagnosticRef.current;
    if (
      previousDiagnostic.itemId === item.id &&
      displayText.length - previousDiagnostic.textLength < 2_048
    ) {
      return;
    }
    lastLongLiveRenderDiagnosticRef.current = {
      itemId: item.id,
      textLength: displayText.length,
    };
    noteThreadLiveRowRenderMeasured(threadId, {
      itemId: item.id,
      textLength: displayText.length,
      renderCostMs: readHighResolutionNowMs() - renderStartedAtMs,
    });
  }, [displayText.length, isStreaming, item.id, item.role, renderStartedAtMs, threadId]);
  const runtimeReconnectHint = useMemo(
    () => (
      item.role === "assistant"
        ? resolveAssistantRuntimeReconnectHint(item, Boolean(agentTaskNotification))
        : null
    ),
    [agentTaskNotification, item],
  );
  const showActiveRuntimeReconnectCard =
    nativeRuntimeRecoveryEnabled &&
    Boolean(runtimeReconnectHint) &&
    showRuntimeReconnectCard;
  const suppressRuntimeReconnectText = Boolean(runtimeReconnectHint);
  if (runtimeReconnectHint && !showActiveRuntimeReconnectCard) {
    return null;
  }
  const turnBadge =
    item.executionTargetSnapshot && showTurnTargetBadge
      ? resolveTurnBadge(item.executionTargetSnapshot, {
          providerExists: item.executionTargetSnapshot.providerAvailable !== false,
          providerAvailable: item.executionTargetSnapshot.providerAvailable !== false,
          runtimeAvailable: true,
        })
      : null;

  const bubbleNode = (
    <div className={`bubble message-bubble${agentTaskNotification && !suppressSubagentAgentTaskCard ? " message-bubble-agent-task" : ""}`}>
      {turnBadge && item.role === "assistant" ? (
        <div
          className={`message-turn-target-badge${turnBadge.unavailable ? " is-unavailable" : ""}`}
          data-testid="message-turn-target-badge"
          title={turnBadge.unavailable ? t("sidebar.unavailableTag") : undefined}
        >
          <span>{turnBadge.engineLabel}</span>
          {turnBadge.modelLabel ? <span>{turnBadge.modelLabel}</span> : null}
          {turnBadge.reasoningLabel ? <span>{turnBadge.reasoningLabel}</span> : null}
          {turnBadge.unavailable ? <span>{t("sidebar.unavailableTag")}</span> : null}
        </div>
      ) : null}
      {agentTaskNotification && agentTaskDisplay ? (
        <Card className="message-agent-task-card gap-3 rounded-[8px] p-4 before:rounded-[7px]">
          <div className="flex items-center gap-3">
            <div
              className="flex size-9 shrink-0 items-center justify-center rounded-xl border bg-primary/10 text-primary"
              aria-hidden
            >
              <AgentIcon
                seed={agentTaskDisplay.title || agentTaskNotification.taskId || item.id}
                fallback="codicon-hubot"
                className="inline-flex"
                size={18}
              />
            </div>
            <div className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Agent session
              </span>
              <strong className="min-w-0 truncate text-sm font-semibold leading-tight text-foreground">
                {agentTaskDisplay.title}
              </strong>
              {agentTaskDisplay.subtitle ? (
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  {agentTaskDisplay.subtitle}
                </span>
              ) : null}
            </div>
            <Badge
              variant={
                agentTaskDisplay.status.tone === "completed"
                  ? "success"
                  : agentTaskDisplay.status.tone === "running"
                    ? "info"
                    : agentTaskDisplay.status.tone === "error"
                      ? "error"
                      : "secondary"
              }
              className="shrink-0 uppercase"
            >
              {agentTaskDisplay.status.label}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {agentTaskNotification.taskId ? (
              <Badge variant="secondary" className="max-w-full truncate font-normal">
                task {agentTaskNotification.taskId}
              </Badge>
            ) : null}
            {agentTaskNotification.toolUseId ? (
              <Badge variant="secondary" className="max-w-full truncate font-normal">
                tool {agentTaskNotification.toolUseId}
              </Badge>
            ) : null}
            {agentTaskDisplay.outputFileName ? (
              <Badge variant="secondary" className="max-w-full truncate font-normal">
                {agentTaskDisplay.outputFileName}
              </Badge>
            ) : null}
          </div>
          {agentTaskOutputSnapshot ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => setInspectedTaskOutput(agentTaskOutputSnapshot)}
            >
              {t("engineTaskOutput.inspect")}
            </Button>
          ) : null}
          {inspectedTaskOutput ? (
            <div className="mt-1">
              <EngineTaskOutputInspector
                snapshot={inspectedTaskOutputState.snapshot ?? inspectedTaskOutput}
                refreshState={inspectedTaskOutputState.refreshState}
                onRefresh={inspectedTaskOutputState.refresh}
                onClose={() => setInspectedTaskOutput(null)}
                className="border-border/60 bg-muted/30 shadow-none before:hidden"
              />
            </div>
          ) : null}
        </Card>
      ) : null}
      {imageItems.length > 0 && (
        <MessageImageGrid
          images={imageItems}
          onOpen={setLightboxIndex}
          hasText={hasText}
          workspaceId={workspaceId}
        />
      )}
      {deferredImageItems.length > 0 ? (
        <div className="message-deferred-image-list" role="list">
          {deferredImageItems.map((image, index) => {
            const key = deferredMessageImageKey(threadId, item.id, image);
            const state = deferredImageStates.get(key) ?? { status: "idle" };
            return (
              <div
                key={key}
                className={`message-deferred-image is-${state.status}`}
                role="listitem"
              >
                {state.status === "loaded" && state.src ? (
                  <button
                    type="button"
                    className="message-deferred-image-preview"
                    onClick={() => {
                      const lightboxTarget = lightboxImages.findIndex(
                        (entry) => entry.src === state.src,
                      );
                      if (lightboxTarget >= 0) {
                        setLightboxIndex(lightboxTarget);
                      }
                    }}
                    aria-label={`Open image ${index + 1}`}
                  >
                    <img src={state.src} alt={`Deferred Claude image ${index + 1}`} loading="lazy" />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="message-deferred-image-placeholder"
                      onClick={() => void loadDeferredImage(image)}
                      disabled={state.status === "loading"}
                      aria-label="Load image"
                      title={`${image.mediaType} · ${formatDeferredImageSize(image.estimatedByteSize)}`}
                    >
                      <span className="message-deferred-image-icon" aria-hidden="true">
                        {state.status === "loading" ? (
                          <LoaderCircle size={18} className="message-deferred-image-spinner" />
                        ) : (
                          <RefreshCw size={18} />
                        )}
                      </span>
                      <span className="sr-only">Claude history image available on demand</span>
                    </button>
                    {state.status === "error" && state.error ? (
                      <span className="message-deferred-image-error">{state.error}</span>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
      {runtimeReconnectHint && showActiveRuntimeReconnectCard ? (
        <RuntimeReconnectCard
          hint={runtimeReconnectHint}
          workspaceId={workspaceId}
          threadId={threadId}
          onRecoverThreadRuntime={onRecoverThreadRuntime}
          retryMessage={retryMessage}
          onRecoverThreadRuntimeAndResend={onRecoverThreadRuntimeAndResend}
          onThreadRecoveryFork={onThreadRecoveryFork}
        />
      ) : null}
      {hasText && (
        item.role === "user" && !agentTaskNotification ? (
          <CollapsibleUserTextBlock
            content={displayText}
            parsedContent={parsedUserTextContent ?? undefined}
          />
        ) : suppressRuntimeReconnectText ? null : usePlainTextStreamingSurface ? (
          <div className={livePlainTextClassName}>
            {useLongFoldedMarkdownStreamingSurface ? liveFoldedStreamingSurfaceText : streamingDisplayText}
          </div>
        ) : (
          <Markdown
            value={useLongFoldedMarkdownStreamingSurface ? liveFoldedStreamingSurfaceText : streamingDisplayText}
            className={resolvedMarkdownClassName}
            workspaceId={workspaceId}
            codeBlockStyle="message"
            codeBlockCopyUseModifier={codeBlockCopyUseModifier}
            streamingThrottleMs={resolveAssistantMessageStreamingThrottleMs(
              item,
              isStreaming,
              activeEngine,
              streamMitigationProfile,
              presentationProfile,
              streamingMarkdownComplexity,
            )}
            onOpenFileLink={onOpenFileLink}
            onOpenFileLinkMenu={onOpenFileLinkMenu}
            liveRenderMode={useLightweightStreamingMarkdown ? "lightweight" : "full"}
            progressiveReveal={
              useLightweightStreamingMarkdown && streamingMarkdownComplexity.isMedium
            }
            onRenderedValueChange={handleMarkdownRenderedAssistantValue}
            onOutlineReady={isStreaming ? undefined : onOutlineReady}
          />
        )
      )}
      {item.role === "user" && !agentTaskNotification ? userActionNode : null}
      {lightboxIndex !== null && lightboxImages.length > 0 && (
        <ImageLightbox
          images={lightboxImages}
          activeIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          workspaceId={workspaceId}
        />
      )}
    </div>
  );
  const codeAnnotationContextNode =
    parsedUserTextContent && parsedUserTextContent.codeAnnotations.length > 0 ? (
      <UserCodeAnnotationContextBlock annotations={parsedUserTextContent.codeAnnotations} />
    ) : null;
  const noteCardSummaryNode = resolvedNoteCardSummary ? (
    <NoteCardContextSummaryCard
      summary={resolvedNoteCardSummary}
      workspaceId={workspaceId}
      codeBlockCopyUseModifier={codeBlockCopyUseModifier}
      onOpenFileLink={onOpenFileLink}
      onOpenFileLinkMenu={onOpenFileLinkMenu}
    />
  ) : null;
  const browserContextSummaryNode = browserContextSummary ? (
    <ConversationBrowserContextSummaryCard context={browserContextSummary} />
  ) : null;
  const intentCanvasContextSummaryNode =
    intentCanvasContextSummary && intentCanvasContextSummary.length > 0 ? (
      <>
        {intentCanvasContextSummary.map((summary) => (
          <IntentCanvasContextSummaryCard
            key={summary.view.attachmentId}
            summary={summary.view}
          />
        ))}
      </>
    ) : null;
  const shouldRenderBubble =
    (agentTaskNotification && !suppressSubagentAgentTaskCard)
    || imageItems.length > 0
    || deferredImageItems.length > 0
    || showActiveRuntimeReconnectCard
    || Boolean(turnBadge)
    || (hasText && !suppressRuntimeReconnectText);
  // SubAgent 型 task-notification：整行视觉退役（事实已迁 S10 / inspector）
  if (
    suppressSubagentAgentTaskCard &&
    !shouldRenderBubble &&
    !resolvedMemorySummary &&
    !resolvedNoteCardSummary &&
    !browserContextSummary &&
    !(intentCanvasContextSummary && intentCanvasContextSummary.length > 0)
  ) {
    return null;
  }
  const memoryPayloadDialogNode =
    memoryPayloadDialogOpen && memorySummaryRawPayload && typeof document !== "undefined"
      ? createPortal(
        <div
          className="memory-context-payload-dialog-overlay"
          role="presentation"
          onClick={() => setMemoryPayloadDialogOpen(false)}
        >
          <div
            className="memory-context-payload-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${item.id}-memory-payload-title`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="memory-context-payload-dialog-header">
              <div>
                <h3 id={`${item.id}-memory-payload-title`}>
                  {t("messages.memoryContextSentDetailsTitle")}
                </h3>
                <p>{t("messages.memoryContextSentDetailsHint")}</p>
              </div>
              <button
                type="button"
                className="memory-context-payload-dialog-close"
                aria-label={t("messages.memoryContextCloseDetails")}
                onClick={() => setMemoryPayloadDialogOpen(false)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="memory-context-payload-dialog-body">
              {memoryPayloadPacks.length > 0 ? (
                <div className="memory-context-payload-pack-list">
                  {memoryPayloadPacks.map((pack, packIndex) => (
                    <section
                      key={`${item.id}-memory-payload-pack-${packIndex}`}
                      className="memory-context-payload-pack"
                    >
                      <div className="memory-context-payload-pack-header">
                        <span className="memory-context-payload-pack-title">
                          {t("messages.memoryContextPayloadPackTitle", {
                            index: packIndex + 1,
                          })}
                        </span>
                        <span className="memory-context-payload-pack-meta">
                          {t("messages.memoryContextPayloadPackMeta", {
                            source: pack.source || t("messages.memoryContextSourceUnknown"),
                            count: Number(pack.count),
                          })}
                        </span>
                      </div>
                      <div className="memory-context-payload-section-label">
                        {t("messages.memoryContextPayloadCleanedContext")}
                      </div>
                      <Markdown
                        value={pack.cleanedContext}
                        className="markdown memory-context-payload-markdown"
                        workspaceId={workspaceId}
                        codeBlockStyle="message"
                        codeBlockCopyUseModifier={codeBlockCopyUseModifier}
                        onOpenFileLink={onOpenFileLink}
                        onOpenFileLinkMenu={onOpenFileLinkMenu}
                      />
                    </section>
                  ))}
                </div>
              ) : (
                <Markdown
                  value={memorySummaryRawPayload}
                  className="markdown memory-context-payload-markdown"
                  workspaceId={workspaceId}
                  codeBlockStyle="message"
                  codeBlockCopyUseModifier={codeBlockCopyUseModifier}
                  onOpenFileLink={onOpenFileLink}
                  onOpenFileLinkMenu={onOpenFileLinkMenu}
                />
              )}
              <details className="memory-context-payload-raw">
                <summary>{t("messages.memoryContextPayloadRaw")}</summary>
                <pre className="memory-context-payload-dialog-code">
                  <code>{memorySummaryRawPayload}</code>
                </pre>
              </details>
            </div>
          </div>
        </div>,
        document.body,
      )
      : null;
  const memorySummaryNode = resolvedMemorySummary ? (
    <>
      <div className="memory-context-summary-card">
        <button
          type="button"
          className="memory-context-summary-toggle"
          onClick={() => setMemorySummaryExpanded((current) => !current)}
          aria-expanded={memorySummaryExpanded}
        >
          <span className="memory-context-summary-title">
            {t("messages.memoryContextSummary")}
          </span>
          <span className="memory-context-summary-count">
            {t("messages.memoryContextSummaryCount", {
              count: resolvedMemorySummary.lines.length,
            })}
          </span>
          {memorySummaryExpanded ? (
            <ChevronUp size={14} aria-hidden />
          ) : (
            <ChevronDown size={14} aria-hidden />
          )}
        </button>
        {memorySummaryExpanded && (
          <div className="memory-context-summary-content">
            {memorySummaryRecords.length > 0 ? (
              <div className="memory-context-summary-record-list">
                {memorySummaryRecords.map((record) => {
                  const sourceLabel = record.source === "manual-selection"
                    ? t("messages.memoryContextSourceManual")
                    : record.source === "memory-scout"
                      ? t("messages.memoryContextSourceMemoryReference")
                      : (record.source || t("messages.memoryContextSourceUnknown"));
                  return (
                    <div
                      key={`${item.id}-${record.displayIndex}-${record.index}-${record.memoryId}`}
                      className="memory-context-summary-record"
                    >
                      <span className="memory-context-summary-record-index">
                        {record.displayIndex}
                      </span>
                      <span className="memory-context-summary-record-copy">
                        <span className="memory-context-summary-record-title">
                          {record.title || record.memoryId}
                        </span>
                        <span className="memory-context-summary-record-meta">
                          {t("messages.memoryContextRecordMeta", {
                            source: sourceLabel,
                            index: record.index,
                          })}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Markdown
                value={resolvedMemorySummary.markdown ?? resolvedMemorySummary.lines.join("\n\n")}
                className="markdown memory-context-summary-markdown"
                workspaceId={workspaceId}
                codeBlockStyle="message"
                codeBlockCopyUseModifier={codeBlockCopyUseModifier}
                onOpenFileLink={onOpenFileLink}
                onOpenFileLinkMenu={onOpenFileLinkMenu}
              />
            )}
            {memorySummaryRawPayload ? (
              <button
                type="button"
                className="memory-context-summary-detail-button"
                onClick={() => setMemoryPayloadDialogOpen(true)}
              >
                {t("messages.memoryContextViewSentDetails")}
              </button>
            ) : null}
          </div>
        )}
      </div>
      {memoryPayloadDialogNode}
    </>
  ) : null;
  if (!memorySummaryNode && !noteCardSummaryNode && !browserContextSummaryNode && !intentCanvasContextSummaryNode && !codeAnnotationContextNode && !shouldRenderBubble) {
    return null;
  }
  const stackedContent = memorySummaryNode || noteCardSummaryNode || browserContextSummaryNode || intentCanvasContextSummaryNode || codeAnnotationContextNode ? (
    <div className={`message-context-stack${item.role === "user" ? " is-user" : ""}`}>
      {memorySummaryNode}
      {codeAnnotationContextNode}
      {browserContextSummaryNode}
      {intentCanvasContextSummaryNode}
      {noteCardSummaryNode}
      {shouldRenderBubble ? bubbleNode : null}
    </div>
  ) : bubbleNode;

  const agentBadgeNode = hasExternalAgentBadge ? (
    <div className={`message-user-agent-rail${isAgentBadgeExpanded ? " is-open" : ""}`}>
      <button
        type="button"
        className="message-agent-icon-button"
        onClick={handleToggleAgentBadge}
        aria-expanded={isAgentBadgeExpanded}
        aria-label={
          selectedAgentName
            ? t("messages.agentBadgeWithNameAriaLabel", { name: selectedAgentName })
            : t("messages.agentBadgeAriaLabel")
        }
        title={selectedAgentName ?? undefined}
      >
        <AgentIcon
          icon={selectedAgentIcon}
          seed={selectedAgentName ?? item.id}
          fallback="codicon-hubot"
          className="message-agent-icon-glyph"
          size={30}
        />
      </button>
      {isAgentBadgeExpanded && selectedAgentName && (
        <div className="message-agent-reveal is-visible" role="status">
          <span className="message-agent-tag-text">{selectedAgentName}</span>
        </div>
      )}
    </div>
  ) : null;

  const messageClassName = [
    "message",
    item.role,
    agentTaskNotification && !suppressSubagentAgentTaskCard
      ? "message-agent-task"
      : "",
    item.role === "assistant" && isStreaming ? "is-live-streaming" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={messageClassName}>
      {hasExternalAgentBadge ? (
        <div className="message-user-layout">
          {agentBadgeNode}
          {stackedContent}
        </div>
      ) : stackedContent}
    </div>
  );
}, areMessageRowPropsEqual);
