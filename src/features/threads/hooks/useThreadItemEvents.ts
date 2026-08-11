import { startTransition, useCallback, useEffect, useMemo, useRef } from "react";
import { workspaceScopedHas, type WorkspaceScopedMap } from "./workspaceScopedMap";
import type { Dispatch, MutableRefObject } from "react";
import { buildConversationItem } from "../../../utils/threadItems";
import { isCodexSubagentActivityItem } from "../utils/codexSubagentIdentity";
import type { NormalizedThreadEvent } from "../contracts/conversationCurtainContracts";
import {
  createRealtimeEventBatcher,
  type RealtimeBatcherFlush,
  type RealtimeBatcherFlushReason,
} from "../contracts/realtimeEventBatcher";
import { asString } from "../utils/threadNormalize";
import type { ConversationItem, DebugEntry } from "../../../types";
import type { ThreadAction } from "./useThreadsReducer";
import { isRealtimeBatchingEnabled, readStreamingScheduleTier } from "../utils/realtimePerfFlags";
import {
  resolveDispatchSubmitMode,
  type DispatchSubmitMode,
} from "../utils/renderSchedulingPolicy";
import {
  buildToolOutputKey,
  createToolOutputTailGate,
  type ToolOutputKey,
} from "./useToolOutputTailGate";
import {
  applyPendingClaudeMcpOutputNoticeToAgentCompleted,
  applyPendingClaudeMcpOutputNoticeToAgentDelta,
} from "../utils/claudeMcpRuntimeSnapshot";
import {
  appendLiveAssistantShadowDelta,
  settleLiveAssistantShadowTranscript,
  upsertLiveAssistantShadowSnapshot,
} from "../utils/liveAssistantShadowTranscript";
import {
  appendLiveAssistantText,
  clearLiveAssistantText,
  drainLiveAssistantTextTail,
  drainLiveAssistantTextTailIfItemChanged,
  peekLiveAssistantText,
  resolveLiveAssistantSettlementText,
  updateLiveAssistantTextSnapshot,
} from "../utils/liveAssistantTextChannel";
import { isLiveTextExternalizationEnabled } from "../utils/realtimePerfFlags";
import {
  noteRealtimeCoalescedFlush,
  noteThreadReducerWorkMeasured,
} from "../utils/streamLatencyDiagnostics";
import { recordHotspotSample } from "../../../services/perfBaseline/hotspotTracker";
import { inferEngineFromLegacyThreadId } from "../contracts/engineRuntimeIdentity";

const CLAUDE_STREAM_DEBUG_FLAG_KEY = "doge.debug.claude.stream";
// A4 流式正文外部化（docs/perf/a4-live-text-externalization-plan.md）：
// 模块加载时读一次，翻转 flag 需刷新页面（与其余 perf flag 同语义）。
const LIVE_TEXT_EXTERNALIZATION_ENABLED = isLiveTextExternalizationEnabled();

/**
 * Infer engine type from thread ID.
 * Claude/Gemini/Kimi/OpenCode threads use "<engine>:" or "<engine>-pending-" prefixes.
 */
const inferEngineFromThreadId = inferEngineFromLegacyThreadId;

export function canProgressEventStartProcessing(
  engine: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode",
) {
  return engine !== "codex";
}

function isClaudeThread(threadId: string) {
  return threadId.startsWith("claude:") || threadId.startsWith("claude-pending-");
}

function isGeminiThread(threadId: string) {
  return threadId.startsWith("gemini:") || threadId.startsWith("gemini-pending-");
}

function isGrokThread(threadId: string) {
  return threadId.startsWith("grok:") || threadId.startsWith("grok-pending-");
}

function isKimiThread(threadId: string) {
  return threadId.startsWith("kimi:") || threadId.startsWith("kimi-pending-");
}

function readHighResolutionNowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

type ReasoningEngineHint = "gemini" | "grok" | "kimi" | null;

function isGeminiEventThread(
  threadId: string,
  engineHint?: ReasoningEngineHint,
) {
  return engineHint === "gemini" || isGeminiThread(threadId);
}

function isGrokEventThread(
  threadId: string,
  engineHint?: ReasoningEngineHint,
) {
  return engineHint === "grok" || isGrokThread(threadId);
}

function isKimiEventThread(
  threadId: string,
  engineHint?: ReasoningEngineHint,
) {
  return engineHint === "kimi" || isKimiThread(threadId);
}

function inferItemEngineSource(
  item: Record<string, unknown>,
  threadId: string,
): "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" {
  const rawEngineSource = asString(item.engineSource ?? item.engine_source ?? "")
    .trim()
    .toLowerCase();
  if (
    rawEngineSource === "claude" ||
    rawEngineSource === "codex" ||
    rawEngineSource === "gemini" ||
    rawEngineSource === "grok" ||
    rawEngineSource === "kimi" ||
    rawEngineSource === "opencode"
  ) {
    return rawEngineSource;
  }
  return inferEngineFromThreadId(threadId);
}

function isInterruptedThread(
  interruptedThreadsRef: MutableRefObject<WorkspaceScopedMap<true>>,
  workspaceId: string | null,
  threadId: string,
) {
  return workspaceScopedHas(interruptedThreadsRef.current, workspaceId, threadId);
}

function isClaudeStreamDebugEnabled() {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const value = window.localStorage.getItem(CLAUDE_STREAM_DEBUG_FLAG_KEY);
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "on";
  } catch {
    return false;
  }
}

function createDebugPreview(value: string, maxLength = 160) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

type UseThreadItemEventsOptions = {
  activeThreadId: string | null;
  dispatch: Dispatch<ThreadAction>;
  resolveCanonicalThreadId?: (threadId: string) => string;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  resolveCollaborationUiMode?: (
    threadId: string,
  ) => "plan" | "code" | null;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  markReviewing: (threadId: string, isReviewing: boolean) => void;
  safeMessageActivity: () => void;
  recordThreadActivity: (
    workspaceId: string,
    threadId: string,
    timestamp?: number,
  ) => void;
  applyCollabThreadLinks: (
    threadId: string,
    item: Record<string, unknown>,
    workspaceId?: string,
  ) => void;
  interruptedThreadsRef: MutableRefObject<WorkspaceScopedMap<true>>;
  onDebug?: (entry: DebugEntry) => void;
  onAgentMessageCompletedExternal?: (payload: {
    workspaceId: string;
    threadId: string;
    turnId?: string | null;
    itemId: string;
    text: string;
  }) => void;
  onExitPlanModeToolCompleted?: (payload: {
    workspaceId: string;
    threadId: string;
    itemId: string;
  }) => void;
  scheduleRealtimeDispatch?: (run: () => void) => void;
};

type RealtimeDeltaOperation =
  | {
      kind: "agentDelta";
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
      turnId?: string | null;
    }
  | {
      kind: "reasoningSummaryDelta";
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
      engineHint?: ReasoningEngineHint;
      turnId?: string | null;
    }
  | {
      kind: "reasoningSummaryBoundary";
      workspaceId: string;
      threadId: string;
      itemId: string;
      engineHint?: ReasoningEngineHint;
      turnId?: string | null;
    }
  | {
      kind: "reasoningContentDelta";
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
      engineHint?: ReasoningEngineHint;
      turnId?: string | null;
    }
  | {
      kind: "toolOutputDelta";
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
      turnId?: string | null;
    };

// 32ms (~30 flush/s)：12ms 时顶层 thread reducer 每秒最高 dispatch ~83 次，
// 每次 flush 都触发 app-shell 大子树 re-render，是流式卡顿的放大器。
// 视觉平滑度由 Markdown streaming throttle + progressive reveal 保证。
const REALTIME_DELTA_BATCH_FLUSH_MS = 32;
const NORMALIZED_REALTIME_BATCH_FLUSH_MS = 32;

type PendingNormalizedRealtimeOperation = {
  event: NormalizedThreadEvent;
  hasCustomName: boolean;
};

function isCodexAssistantMessageItem(
  item: NormalizedThreadEvent["item"],
): item is Extract<ConversationItem, { kind: "message"; role: "assistant" }> {
  return item.kind === "message" && item.role === "assistant";
}

function shouldBatchNormalizedRealtimeEvent(event: NormalizedThreadEvent) {
  return (
    (isCodexAssistantMessageItem(event.item) &&
      (event.operation === "itemStarted" || event.operation === "itemUpdated")) ||
    event.operation === "appendReasoningContentDelta" ||
    event.operation === "appendReasoningSummaryDelta" ||
    event.operation === "appendToolOutputDelta"
  );
}

function shouldUseContractRealtimeBatcher(event: NormalizedThreadEvent) {
  return event.operation === "appendAgentMessageDelta";
}

export function shouldUrgentlyDispatchReasoningDelta(
  event: NormalizedThreadEvent,
  flushReason: RealtimeBatcherFlushReason,
) {
  return (
    event.operation === "appendReasoningContentDelta" &&
    flushReason === "first-token"
  );
}

function shouldDispatchNormalizedRealtimeEventUrgently(
  event: NormalizedThreadEvent,
  flushReason: RealtimeBatcherFlushReason,
) {
  return (
    event.operation === "appendAgentMessageDelta" ||
    shouldUrgentlyDispatchReasoningDelta(event, flushReason)
  );
}

function buildPendingNormalizedRealtimeOperationKey(event: NormalizedThreadEvent) {
  return `${event.threadId}\u0000${event.item.kind}\u0000${event.item.id}`;
}

// 全局已终态 turnId 的保留上限。turnId 全局唯一（claude-turn-<uuid>），
// 因此改为按 turnId 而非按线程分桶，容量相应放大。
const MAX_TERMINAL_TURN_IDS = 256;

function normalizeTurnId(value: unknown) {
  return asString(value).trim();
}

function extractTurnIdFromRawItem(item: Record<string, unknown>) {
  const turn = item.turn && typeof item.turn === "object"
    ? (item.turn as Record<string, unknown>)
    : null;
  return normalizeTurnId(
    item.turnId ??
      item.turn_id ??
      turn?.id ??
      turn?.turnId ??
      turn?.turn_id ??
      "",
  );
}

function extractTurnIdFromNormalizedRealtimeEvent(event: NormalizedThreadEvent) {
  const eventTurnId = normalizeTurnId(event.turnId);
  if (eventTurnId) {
    return eventTurnId;
  }
  if (!event.rawItem) {
    return "";
  }
  return extractTurnIdFromRawItem(event.rawItem);
}

export function useThreadItemEvents({
  activeThreadId,
  dispatch,
  resolveCanonicalThreadId,
  getCustomName,
  resolveCollaborationUiMode,
  markProcessing,
  markReviewing,
  safeMessageActivity,
  recordThreadActivity,
  applyCollabThreadLinks,
  interruptedThreadsRef,
  onDebug,
  onAgentMessageCompletedExternal,
  onExitPlanModeToolCompleted,
  scheduleRealtimeDispatch = startTransition,
}: UseThreadItemEventsOptions) {
  const enableRealtimeBatchingRef = useRef(isRealtimeBatchingEnabled());
  const pendingRealtimeDeltaOpsRef = useRef<RealtimeDeltaOperation[]>([]);
  const realtimeFlushTimerRef = useRef<number | null>(null);
  const isFlushingRealtimeDeltaOpsRef = useRef(false);
  const pendingNormalizedRealtimeOpsRef = useRef<Map<string, PendingNormalizedRealtimeOperation>>(
    new Map(),
  );
  const normalizedRealtimeBatcherRef = useRef(createRealtimeEventBatcher());
  const normalizedRealtimeFlushTimerRef = useRef<number | null>(null);
  const isFlushingNormalizedRealtimeOpsRef = useRef(false);
  const activeRealtimeTurnIdByThreadRef = useRef<Map<string, string>>(new Map());
  // 全局已终态 turnId 集合。按 turnId（回合的全局唯一身份）判定终态，
  // 使迟到事件无论落在主线程还是别名线程都能被识别为已结束，避免复燃。
  const terminalRealtimeTurnIdsRef = useRef<Set<string>>(new Set());
  // 已结算且尚未开始新回合的线程，用于拦截「无 turnId」的迟到复燃事件。
  const settledRealtimeThreadsRef = useRef<Set<string>>(new Set());
  // 诊断：被终态守卫拦下（本会把线程复燃为「处理中」）的迟到事件计数，
  // 结算时汇总上报，用于量化「结束后仍显示生成中」的根因频率。
  const droppedLateRealtimeEventCountRef = useRef(0);

  const normalizeToolIdentifier = useCallback((value: string) => {
    return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  }, []);

  const isClaudeExitPlanModeTool = useCallback(
    (item: Extract<ConversationItem, { kind: "tool" }>) => {
      const normalizedToolType = normalizeToolIdentifier(item.toolType);
      const normalizedTitle = normalizeToolIdentifier(item.title);
      return (
        normalizedToolType === "exitplanmode" ||
        normalizedToolType.endsWith("exitplanmode") ||
        normalizedTitle.includes("exitplanmode")
      );
    },
    [normalizeToolIdentifier],
  );

  const logReasoningRoute = useCallback(
    (
      label: string,
      payload: {
        workspaceId: string;
        threadId: string;
        itemId: string;
        deltaLength?: number;
        skipped?: boolean;
        reason?: string;
      },
    ) => {
      onDebug?.({
        id: `${Date.now()}-thread-reasoning-route`,
        timestamp: Date.now(),
        source: "event",
        label: `thread/session:${label}`,
        payload: {
          ...payload,
          activeThreadId,
        },
      });
    },
    [activeThreadId, onDebug],
  );

  const logClaudeStream = useCallback(
    (
      label: string,
      payload: {
        workspaceId: string;
        threadId: string;
        itemId?: string;
        itemType?: string;
        deltaLength?: number;
        textPreview?: string;
        skipped?: boolean;
        reason?: string;
      },
    ) => {
      if (!onDebug || !isClaudeThread(payload.threadId) || !isClaudeStreamDebugEnabled()) {
        return;
      }
      onDebug({
        id: `${Date.now()}-claude-stream-${label}`,
        timestamp: Date.now(),
        source: "event",
        label: `thread/session:claude-stream:${label}`,
        payload: {
          ...payload,
          activeThreadId,
        },
      });
    },
    [activeThreadId, onDebug],
  );

  const isRealtimeTurnTerminal = useCallback(
    (
      threadId: string,
      turnId?: string | null,
      options: {
        allowActiveTurnFallback?: boolean;
      } = {},
    ) => {
      const normalizedTurnId = normalizeTurnId(turnId);
      if (normalizedTurnId) {
        // 带 turnId：按回合的全局唯一身份判定终态，与线程别名无关。
        // 这样迟到事件即便落在别名线程上，只要其 turnId 已结算就会被拒绝，
        // 不再把线程复燃为「处理中」。
        return terminalRealtimeTurnIdsRef.current.has(normalizedTurnId);
      }
      if (options.allowActiveTurnFallback === false) {
        return false;
      }
      const activeTurnId = activeRealtimeTurnIdByThreadRef.current.get(threadId);
      if (activeTurnId) {
        return terminalRealtimeTurnIdsRef.current.has(activeTurnId);
      }
      // 无 turnId 且该线程已无进行中回合：结算过则视为终态，
      // 拒绝迟到事件把它复燃。新线程（从未结算）仍放行首个事件。
      return settledRealtimeThreadsRef.current.has(threadId);
    },
    [],
  );

  const noteRealtimeTurnStarted = useCallback((threadId: string, turnId: string) => {
    const normalizedTurnId = normalizeTurnId(turnId);
    if (!threadId || !normalizedTurnId) {
      return;
    }
    activeRealtimeTurnIdByThreadRef.current.set(threadId, normalizedTurnId);
    // 新回合开始：解除该线程的「已结算」态，避免上一回合的结算态
    // 误杀本回合的无 turnId 事件。
    settledRealtimeThreadsRef.current.delete(threadId);
  }, []);

  const markRealtimeTurnTerminal = useCallback((threadId: string, turnId: string) => {
    const normalizedTurnId = normalizeTurnId(turnId);
    if (!threadId || !normalizedTurnId) {
      return;
    }
    const terminalTurnIds = terminalRealtimeTurnIdsRef.current;
    terminalTurnIds.delete(normalizedTurnId);
    terminalTurnIds.add(normalizedTurnId);
    while (terminalTurnIds.size > MAX_TERMINAL_TURN_IDS) {
      const oldestTurnId = terminalTurnIds.values().next().value;
      if (!oldestTurnId) {
        break;
      }
      terminalTurnIds.delete(oldestTurnId);
    }
    // 该线程回合已结算：登记结算态并清掉活跃记录，使后续「无 turnId」
    // 的迟到事件不再复燃它（配合 isRealtimeTurnTerminal 的无 id 分支）。
    const settledThreads = settledRealtimeThreadsRef.current;
    settledThreads.delete(threadId);
    settledThreads.add(threadId);
    while (settledThreads.size > MAX_TERMINAL_TURN_IDS) {
      const oldestThreadId = settledThreads.values().next().value;
      if (!oldestThreadId) {
        break;
      }
      settledThreads.delete(oldestThreadId);
    }
    activeRealtimeTurnIdByThreadRef.current.delete(threadId);
    // 诊断汇总：本回合期间被终态守卫拦下的迟到事件数（>0 表示确有
    // 迟到事件试图复燃线程，这正是「结束后仍显示生成中」的根因）。
    const droppedLateEvents = droppedLateRealtimeEventCountRef.current;
    if (droppedLateEvents > 0) {
      droppedLateRealtimeEventCountRef.current = 0;
      onDebug?.({
        id: `${Date.now()}-realtime-late-event-drop`,
        timestamp: Date.now(),
        source: "event",
        label: "thread/session:realtime-late-event-drop",
        payload: {
          threadId,
          turnId: normalizedTurnId,
          droppedLateEvents,
          activeThreadId,
        },
      });
    }
  }, [activeThreadId, onDebug]);

  const isRealtimeTurnTerminalExact = useCallback(
    (threadId: string, turnId?: string | null) =>
      isRealtimeTurnTerminal(threadId, turnId, {
        allowActiveTurnFallback: false,
      }),
    [isRealtimeTurnTerminal],
  );

  const applyRealtimeDeltaOperation = useCallback(
    (
      operation: RealtimeDeltaOperation,
      context?: {
        ensuredThreads?: Set<string>;
        markedProcessingThreads?: Set<string>;
      },
    ) => {
      const threadId = resolveCanonicalThreadId?.(operation.threadId) ?? operation.threadId;
      if (isInterruptedThread(interruptedThreadsRef, operation.workspaceId, threadId)) {
        return;
      }
      if (isRealtimeTurnTerminal(threadId, operation.turnId)) {
        droppedLateRealtimeEventCountRef.current += 1;
        return;
      }
      const ensuredThreads = context?.ensuredThreads;
      const markedProcessingThreads = context?.markedProcessingThreads;
      if (!ensuredThreads || !ensuredThreads.has(threadId)) {
        dispatch({
          type: "ensureThread",
          workspaceId: operation.workspaceId,
          threadId,
          engine: inferEngineFromThreadId(threadId),
        });
        ensuredThreads?.add(threadId);
      }
      const reasoningEngineHint =
        "engineHint" in operation ? operation.engineHint : undefined;
      const isGeminiReasoningDelta =
        (isGeminiEventThread(threadId, reasoningEngineHint) ||
          isGrokEventThread(threadId, reasoningEngineHint) ||
          isKimiEventThread(threadId, reasoningEngineHint)) &&
        (operation.kind === "reasoningSummaryDelta" ||
          operation.kind === "reasoningSummaryBoundary" ||
          operation.kind === "reasoningContentDelta");
      if (
        !isGeminiReasoningDelta &&
        canProgressEventStartProcessing(inferEngineFromThreadId(threadId)) &&
        (!markedProcessingThreads || !markedProcessingThreads.has(threadId))
      ) {
        markProcessing(threadId, true);
        markedProcessingThreads?.add(threadId);
      }

      if (operation.kind === "agentDelta") {
        const dispatchStartedAt = readHighResolutionNowMs();
        dispatch({
          type: "appendAgentDelta",
          workspaceId: operation.workspaceId,
          threadId,
          itemId: operation.itemId,
          delta: operation.delta,
          hasCustomName: Boolean(getCustomName(operation.workspaceId, threadId)),
        });
        const dispatchCostMs = readHighResolutionNowMs() - dispatchStartedAt;
        noteThreadReducerWorkMeasured(threadId, {
          itemId: operation.itemId,
          textLength: operation.delta.length,
          mergeCostMs: dispatchCostMs,
          normalizationCostMs: dispatchCostMs,
        });
        return;
      }
      if (operation.kind === "reasoningSummaryDelta") {
        dispatch({
          type: "appendReasoningSummary",
          threadId,
          itemId: operation.itemId,
          delta: operation.delta,
        });
        return;
      }
      if (operation.kind === "reasoningSummaryBoundary") {
        dispatch({
          type: "appendReasoningSummaryBoundary",
          threadId,
          itemId: operation.itemId,
        });
        return;
      }
      if (operation.kind === "reasoningContentDelta") {
        dispatch({
          type: "appendReasoningContent",
          threadId,
          itemId: operation.itemId,
          delta: operation.delta,
        });
        return;
      }

      dispatch({
        type: "appendToolOutput",
        threadId,
        itemId: operation.itemId,
        delta: operation.delta,
      });
    },
    [
      dispatch,
      getCustomName,
      interruptedThreadsRef,
      isRealtimeTurnTerminal,
      markProcessing,
      resolveCanonicalThreadId,
    ],
  );

  const flushRealtimeDeltaOps = useCallback(() => {
    if (!enableRealtimeBatchingRef.current) {
      return;
    }
    if (isFlushingRealtimeDeltaOpsRef.current) {
      return;
    }
    if (realtimeFlushTimerRef.current !== null) {
      window.clearTimeout(realtimeFlushTimerRef.current);
      realtimeFlushTimerRef.current = null;
    }
    if (pendingRealtimeDeltaOpsRef.current.length === 0) {
      return;
    }
    isFlushingRealtimeDeltaOpsRef.current = true;
    const flushStartedAt = readHighResolutionNowMs();
    let flushedOpCount = 0;
    try {
      const bufferedOps = pendingRealtimeDeltaOpsRef.current;
      pendingRealtimeDeltaOpsRef.current = [];
      flushedOpCount = bufferedOps.length;
      const ensuredThreads = new Set<string>();
      const markedProcessingThreads = new Set<string>();
      for (const operation of bufferedOps) {
        applyRealtimeDeltaOperation(operation, {
          ensuredThreads,
          markedProcessingThreads,
        });
      }
      safeMessageActivity();
    } finally {
      isFlushingRealtimeDeltaOpsRef.current = false;
      recordHotspotSample(
        "realtime-delta-flush",
        readHighResolutionNowMs() - flushStartedAt,
        `ops=${flushedOpCount}`,
      );
    }
  }, [applyRealtimeDeltaOperation, safeMessageActivity]);

  const flushRealtimeDeltaOpsForThread = useCallback(
    (threadId: string) => {
      if (isFlushingRealtimeDeltaOpsRef.current) {
        return;
      }
      const matchingOperations: RealtimeDeltaOperation[] = [];
      const deferredOperations: RealtimeDeltaOperation[] = [];
      for (const operation of pendingRealtimeDeltaOpsRef.current) {
        if (operation.threadId === threadId) {
          matchingOperations.push(operation);
        } else {
          deferredOperations.push(operation);
        }
      }
      if (matchingOperations.length === 0) {
        return;
      }
      pendingRealtimeDeltaOpsRef.current = deferredOperations;
      if (
        deferredOperations.length === 0 &&
        realtimeFlushTimerRef.current !== null
      ) {
        window.clearTimeout(realtimeFlushTimerRef.current);
        realtimeFlushTimerRef.current = null;
      }
      const ensuredThreads = new Set<string>();
      const markedProcessingThreads = new Set<string>();
      for (const operation of matchingOperations) {
        applyRealtimeDeltaOperation(operation, {
          ensuredThreads,
          markedProcessingThreads,
        });
      }
      safeMessageActivity();
    },
    [applyRealtimeDeltaOperation, safeMessageActivity],
  );

  const enqueueRealtimeDeltaOperation = useCallback(
    (
      operation: RealtimeDeltaOperation,
      options: { urgent?: boolean } = {},
    ) => {
      if (options.urgent) {
        // 首个 assistant shell 是结构性 lifecycle 事件。先提交已排队的前一段
        // tail，再同步建壳；其它 thread 的队列保持原 cadence。
        flushRealtimeDeltaOpsForThread(operation.threadId);
        applyRealtimeDeltaOperation(operation);
        safeMessageActivity();
        return;
      }
      if (!enableRealtimeBatchingRef.current) {
        applyRealtimeDeltaOperation(operation);
        safeMessageActivity();
        return;
      }
      pendingRealtimeDeltaOpsRef.current.push(operation);
      if (realtimeFlushTimerRef.current !== null) {
        return;
      }
      realtimeFlushTimerRef.current = window.setTimeout(() => {
        flushRealtimeDeltaOps();
      }, REALTIME_DELTA_BATCH_FLUSH_MS);
    },
    [
      applyRealtimeDeltaOperation,
      flushRealtimeDeltaOps,
      flushRealtimeDeltaOpsForThread,
      safeMessageActivity,
    ],
  );

  const dispatchNormalizedRealtimeEvent = useCallback(
    (
      normalizedEvent: NormalizedThreadEvent,
      hasCustomName: boolean,
      options: {
        ensuredThreads?: Set<string>;
        markedProcessingThreads?: Set<string>;
        useTransitionForDispatch?: boolean;
      } = {},
    ) => {
      const {
        ensuredThreads,
        markedProcessingThreads,
      } = options;
      const eventTurnId = extractTurnIdFromNormalizedRealtimeEvent(normalizedEvent);
      const isEventTurnTerminal = () =>
        isRealtimeTurnTerminal(normalizedEvent.threadId, eventTurnId);
      const shouldMarkProcessing = normalizedEvent.operation !== "itemCompleted";
      const markProcessingIfNeeded = () => {
        if (!shouldMarkProcessing) {
          return;
        }
        if (!canProgressEventStartProcessing(normalizedEvent.engine)) {
          return;
        }
        if (markedProcessingThreads?.has(normalizedEvent.threadId)) {
          return;
        }
        if (isEventTurnTerminal()) {
          return;
        }
        markProcessing(normalizedEvent.threadId, true);
        markedProcessingThreads?.add(normalizedEvent.threadId);
      };
      const run = (runOptions: { skipProcessingMark?: boolean } = {}) => {
        if (isEventTurnTerminal()) {
          droppedLateRealtimeEventCountRef.current += 1;
          return;
        }
        if (!ensuredThreads?.has(normalizedEvent.threadId)) {
          dispatch({
            type: "ensureThread",
            workspaceId: normalizedEvent.workspaceId,
            threadId: normalizedEvent.threadId,
            engine: normalizedEvent.engine,
          });
          ensuredThreads?.add(normalizedEvent.threadId);
        }
        if (!runOptions.skipProcessingMark) {
          markProcessingIfNeeded();
        }
        dispatch({
          type: "applyNormalizedRealtimeEvent",
          workspaceId: normalizedEvent.workspaceId,
          threadId: normalizedEvent.threadId,
          event: normalizedEvent,
          hasCustomName,
        });
        if (
          normalizedEvent.operation === "completeAgentMessage" &&
          normalizedEvent.item.kind === "message" &&
          normalizedEvent.item.role === "assistant"
        ) {
          const timestamp = Date.now();
          dispatch({
            type: "setThreadTimestamp",
            workspaceId: normalizedEvent.workspaceId,
            threadId: normalizedEvent.threadId,
            timestamp,
          });
          dispatch({
            type: "setLastAgentMessage",
            threadId: normalizedEvent.threadId,
            text: normalizedEvent.item.text,
            timestamp,
          });
          if (normalizedEvent.threadId !== activeThreadId) {
            dispatch({
              type: "markUnread",
              threadId: normalizedEvent.threadId,
              hasUnread: true,
            });
          }
          recordThreadActivity(
            normalizedEvent.workspaceId,
            normalizedEvent.threadId,
            timestamp,
          );
        }
      };
      if (options.useTransitionForDispatch === false) {
        run();
        return;
      }
      markProcessingIfNeeded();
      scheduleRealtimeDispatch(() => run({ skipProcessingMark: true }));
    },
    [
      activeThreadId,
      dispatch,
      isRealtimeTurnTerminal,
      markProcessing,
      recordThreadActivity,
      scheduleRealtimeDispatch,
    ],
  );

  const runNormalizedRealtimeEventSideEffects = useCallback(
    (
      normalizedEvent: NormalizedThreadEvent,
      options: {
        skipMessageActivity?: boolean;
      } = {},
    ) => {
      if (normalizedEvent.rawItem) {
        if (isCodexSubagentActivityItem(normalizedEvent.rawItem)) {
          applyCollabThreadLinks(
            normalizedEvent.threadId,
            normalizedEvent.rawItem,
            normalizedEvent.workspaceId,
          );
        } else {
          applyCollabThreadLinks(normalizedEvent.threadId, normalizedEvent.rawItem);
        }
      }
      if (
        normalizedEvent.operation === "completeAgentMessage" &&
        normalizedEvent.item.kind === "message" &&
        normalizedEvent.item.role === "assistant"
      ) {
        onAgentMessageCompletedExternal?.({
          workspaceId: normalizedEvent.workspaceId,
          threadId: normalizedEvent.threadId,
          ...(normalizedEvent.turnId ? { turnId: normalizedEvent.turnId } : {}),
          itemId: normalizedEvent.item.id,
          text: normalizedEvent.item.text,
        });
      }
      if (!options.skipMessageActivity) {
        safeMessageActivity();
      }
    },
    [
      applyCollabThreadLinks,
      onAgentMessageCompletedExternal,
      safeMessageActivity,
    ],
  );

  const applyNormalizedRealtimeEventNow = useCallback(
    (
      operation: PendingNormalizedRealtimeOperation,
      options: {
        ensuredThreads?: Set<string>;
        markedProcessingThreads?: Set<string>;
        useTransitionForDispatch?: boolean;
        skipMessageActivity?: boolean;
      } = {},
    ) => {
      if (
        isRealtimeTurnTerminal(
          operation.event.threadId,
          extractTurnIdFromNormalizedRealtimeEvent(operation.event),
        )
      ) {
        return;
      }
      dispatchNormalizedRealtimeEvent(operation.event, operation.hasCustomName, {
        ensuredThreads: options.ensuredThreads,
        markedProcessingThreads: options.markedProcessingThreads,
        useTransitionForDispatch: options.useTransitionForDispatch,
      });
      runNormalizedRealtimeEventSideEffects(operation.event, {
        skipMessageActivity: options.skipMessageActivity,
      });
    },
    [
      dispatchNormalizedRealtimeEvent,
      isRealtimeTurnTerminal,
      runNormalizedRealtimeEventSideEffects,
    ],
  );

  const flushNormalizedRealtimeOps = useCallback(() => {
    if (isFlushingNormalizedRealtimeOpsRef.current) {
      return;
    }
    if (normalizedRealtimeFlushTimerRef.current !== null) {
      window.clearTimeout(normalizedRealtimeFlushTimerRef.current);
      normalizedRealtimeFlushTimerRef.current = null;
    }
    if (pendingNormalizedRealtimeOpsRef.current.size === 0) {
      return;
    }
    isFlushingNormalizedRealtimeOpsRef.current = true;
    const flushStartedAt = readHighResolutionNowMs();
    let flushedOpCount = 0;
    try {
      const bufferedOps = Array.from(pendingNormalizedRealtimeOpsRef.current.values());
      pendingNormalizedRealtimeOpsRef.current.clear();
      flushedOpCount = bufferedOps.length;
      const ensuredThreads = new Set<string>();
      const markedProcessingThreads = new Set<string>();
      for (const operation of bufferedOps) {
        applyNormalizedRealtimeEventNow(operation, {
          ensuredThreads,
          markedProcessingThreads,
          useTransitionForDispatch: false,
          skipMessageActivity: true,
        });
      }
      safeMessageActivity();
    } finally {
      isFlushingNormalizedRealtimeOpsRef.current = false;
      recordHotspotSample(
        "normalized-realtime-flush",
        readHighResolutionNowMs() - flushStartedAt,
        `ops=${flushedOpCount}`,
      );
    }
  }, [applyNormalizedRealtimeEventNow, safeMessageActivity]);

  const applyNormalizedRealtimeBatcherFlushes = useCallback(
    (
      flushes: readonly RealtimeBatcherFlush[],
      operation: PendingNormalizedRealtimeOperation,
    ) => {
      if (flushes.length === 0) {
        return;
      }
      flushNormalizedRealtimeOps();
      const ensuredThreads = new Set<string>();
      const markedProcessingThreads = new Set<string>();
      const flushEndedAt = Date.now();
      for (const flush of flushes) {
        // Reconstruct the batch wait window from event timestamps, but measure
        // actual route work separately so evidence does not treat long streams
        // as one giant route operation.
        let batchStart = flushEndedAt;
        for (const event of flush.events) {
          if (typeof event.timestampMs === "number" && event.timestampMs < batchStart) {
            batchStart = event.timestampMs;
          }
        }
        const routeStartedAt = readHighResolutionNowMs();
        for (const event of flush.events) {
          const useTransitionForDispatch =
            flush.reason !== "terminal" &&
            !shouldDispatchNormalizedRealtimeEventUrgently(event, flush.reason);
          applyNormalizedRealtimeEventNow(
            {
              event,
              hasCustomName: operation.hasCustomName,
            },
            {
              ensuredThreads,
              markedProcessingThreads,
              useTransitionForDispatch,
              skipMessageActivity: false,
            },
          );
        }
        const routeEndedAt = readHighResolutionNowMs();
        recordHotspotSample(
          "codex-batcher-flush",
          routeEndedAt - routeStartedAt,
          `${flush.reason} events=${flush.events.length}`,
        );
        noteRealtimeCoalescedFlush({
          reason: flush.reason,
          eventCount: flush.events.length,
          engine: operation.event.engine,
          workspaceId: operation.event.workspaceId,
          threadId: operation.event.threadId,
          turnId: operation.event.turnId ?? null,
          itemKind: operation.event.itemKind,
          startedAt: batchStart,
          endedAt: flushEndedAt,
          routeStartedAt: Math.round(routeStartedAt),
          routeEndedAt: Math.round(routeEndedAt),
          queueDepthAfter: 0,
        });
      }
    },
    [applyNormalizedRealtimeEventNow, flushNormalizedRealtimeOps],
  );

  const enqueueNormalizedRealtimeEvent = useCallback(
    (operation: PendingNormalizedRealtimeOperation) => {
      if (!enableRealtimeBatchingRef.current) {
        applyNormalizedRealtimeEventNow(operation, {
          useTransitionForDispatch: false,
        });
        return;
      }
      if (
        isCodexAssistantMessageItem(operation.event.item) &&
        (operation.event.operation === "itemStarted" || operation.event.operation === "itemUpdated")
      ) {
        pendingNormalizedRealtimeOpsRef.current.set(
          buildPendingNormalizedRealtimeOperationKey(operation.event),
          operation,
        );
        if (normalizedRealtimeFlushTimerRef.current !== null) {
          return;
        }
        normalizedRealtimeFlushTimerRef.current = window.setTimeout(() => {
          flushNormalizedRealtimeOps();
        }, NORMALIZED_REALTIME_BATCH_FLUSH_MS);
        return;
      }
      const flushes = normalizedRealtimeBatcherRef.current.push(operation.event);
      if (flushes.some((flush) => flush.reason === "first-token")) {
        for (const flush of flushes) {
          for (const event of flush.events) {
            applyNormalizedRealtimeEventNow(
              {
                event,
                hasCustomName: operation.hasCustomName,
              },
              {
                useTransitionForDispatch: !shouldDispatchNormalizedRealtimeEventUrgently(
                  event,
                  flush.reason,
                ),
              },
            );
          }
        }
        return;
      }
      applyNormalizedRealtimeBatcherFlushes(flushes, operation);
      if (normalizedRealtimeFlushTimerRef.current !== null) {
        return;
      }
      normalizedRealtimeFlushTimerRef.current = window.setTimeout(() => {
        const flush = normalizedRealtimeBatcherRef.current.flush("cadence");
        if (flush) {
          applyNormalizedRealtimeBatcherFlushes([flush], operation);
        }
      }, NORMALIZED_REALTIME_BATCH_FLUSH_MS);
    },
    [
      applyNormalizedRealtimeBatcherFlushes,
      applyNormalizedRealtimeEventNow,
      flushNormalizedRealtimeOps,
    ],
  );

  const flushNormalizedRealtimeOpsForThread = useCallback(
    (threadId: string) => {
      const matchingOperations: PendingNormalizedRealtimeOperation[] = [];
      for (const [operationKey, operation] of pendingNormalizedRealtimeOpsRef.current) {
        if (operation.event.threadId !== threadId) {
          continue;
        }
        pendingNormalizedRealtimeOpsRef.current.delete(operationKey);
        matchingOperations.push(operation);
      }
      if (matchingOperations.length === 0) {
        return;
      }
      if (
        pendingNormalizedRealtimeOpsRef.current.size === 0 &&
        normalizedRealtimeFlushTimerRef.current !== null
      ) {
        window.clearTimeout(normalizedRealtimeFlushTimerRef.current);
        normalizedRealtimeFlushTimerRef.current = null;
      }
      for (const operation of matchingOperations) {
        applyNormalizedRealtimeEventNow(operation, {
          useTransitionForDispatch: false,
        });
      }
    },
    [applyNormalizedRealtimeEventNow],
  );

  useEffect(() => {
    if (!activeThreadId?.startsWith("shared:")) {
      return;
    }
    flushRealtimeDeltaOpsForThread(activeThreadId);
    flushNormalizedRealtimeOpsForThread(activeThreadId);
  }, [
    activeThreadId,
    flushNormalizedRealtimeOpsForThread,
    flushRealtimeDeltaOpsForThread,
  ]);

  const flushRealtimeDeltaOpsForUnmountRef = useRef(flushRealtimeDeltaOps);
  const flushNormalizedRealtimeOpsForUnmountRef = useRef(
    flushNormalizedRealtimeOps,
  );
  useEffect(() => {
    flushRealtimeDeltaOpsForUnmountRef.current = flushRealtimeDeltaOps;
    flushNormalizedRealtimeOpsForUnmountRef.current =
      flushNormalizedRealtimeOps;
  }, [flushNormalizedRealtimeOps, flushRealtimeDeltaOps]);

  useEffect(
    () => () => {
      flushRealtimeDeltaOpsForUnmountRef.current();
      flushNormalizedRealtimeOpsForUnmountRef.current();
      if (realtimeFlushTimerRef.current !== null) {
        window.clearTimeout(realtimeFlushTimerRef.current);
        realtimeFlushTimerRef.current = null;
      }
      if (normalizedRealtimeFlushTimerRef.current !== null) {
        window.clearTimeout(normalizedRealtimeFlushTimerRef.current);
        normalizedRealtimeFlushTimerRef.current = null;
      }
      pendingRealtimeDeltaOpsRef.current = [];
      pendingNormalizedRealtimeOpsRef.current.clear();
      activeRealtimeTurnIdByThreadRef.current.clear();
      terminalRealtimeTurnIdsRef.current.clear();
      settledRealtimeThreadsRef.current.clear();
    },
    [],
  );

  const flushPendingRealtimeEvents = useCallback(() => {
    flushRealtimeDeltaOps();
    flushNormalizedRealtimeOps();
  }, [flushNormalizedRealtimeOps, flushRealtimeDeltaOps]);


  // \u00a76.3 / \u00a76.4: dispatch \u8c03\u5ea6\u4e0e\u4eea\u8868\u62ee\u53d6
  const submitScheduleInstrumentationRef = useRef({
    urgentDispatchCount: 0,
    transitionDispatchCount: 0,
    idleDispatchCount: 0,
    totalDispatchCostMs: 0,
    lastDispatchAtMs: 0,
  });

  const dispatchWithSchedule = useCallback(
    (
      action: ThreadAction,
      options: {
        isLiveRow?: boolean;
        isCritical?: boolean;
      } = {},
    ) => {
      const tier = readStreamingScheduleTier();
      const isLiveRow = options.isLiveRow ?? false;
      const isCritical = options.isCritical ?? false;
      const mode: DispatchSubmitMode = resolveDispatchSubmitMode({
        tier,
        isLiveRow,
        isHeavy: false,
        isCritical,
      });
      const startedAt =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      // §6.4: instrumentation \u5728 submit-mode \u9009\u5b9a\u540e\u7acb\u5373\u8bb0\u5f55,
      // \u4e0d\u7b49 dispatch \u5b8c\u6210\u3002\u8fd9\u6837 test \u4ee5 act() \u540c\u6b65\u8c03\u7528\u540e\u7acb\u5373\u80fd\u770b\u5230
      // \u8ba1\u6570\u4e0a\u53b8\u3002
      const inst0 = submitScheduleInstrumentationRef.current;
      if (mode === "urgent") inst0.urgentDispatchCount += 1;
      else if (mode === "transition") inst0.transitionDispatchCount += 1;
      else inst0.idleDispatchCount += 1;
      const finalize = () => {
        const endedAt =
          typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
        inst0.totalDispatchCostMs += Math.max(0, endedAt - startedAt);
        inst0.lastDispatchAtMs = endedAt;
        dispatch(action);
      };
      if (mode === "urgent") {
        finalize();
        return;
      }
      if (mode === "transition") {
        startTransition(() => {
          finalize();
        });
        return;
      }
      // mode === "idle"
      if (
        typeof (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback ===
        "function"
      ) {
        (globalThis as unknown as {
          requestIdleCallback: (cb: () => void) => void;
        }).requestIdleCallback(() => {
          finalize();
        });
        return;
      }
      // fallback: setTimeout(0)
      globalThis.setTimeout(() => {
        finalize();
      }, 0);
    },
    [dispatch],
  );

  const __getSubmitScheduleInstrumentationForTests = useCallback(
    () => submitScheduleInstrumentationRef.current,
    [],
  );


  const handleItemUpdate = useCallback(
    (
      workspaceId: string,
      threadId: string,
      item: Record<string, unknown>,
      shouldMarkProcessing: boolean,
      shouldIncrementAgentSegment: boolean,
    ) => {
      if (isInterruptedThread(interruptedThreadsRef, workspaceId, threadId)) {
        return;
      }
      flushRealtimeDeltaOps();
      const turnId = extractTurnIdFromRawItem(item);
      if (isRealtimeTurnTerminal(threadId, turnId)) {
        return;
      }
      // \u00a76.3: \u5165\u53e3 ensureThread \u8d70 dispatchWithSchedule\u3002
      // baseline \u4e0e isLiveRow / isCritical \u90fd\u9000\u5316\u4e3a urgent\uff0c\u8bed\u4e49\u4e0e\u539f\u540c\u3002
      // \u4f4e\u4f18\u5148\u7ea7\u4f1a\u8bdd\uff08threadId !== activeThreadId\uff09+ guarded / aggressive \u8d70 transition / idle \u3002
      const isLiveRow = threadId === activeThreadId;
      dispatchWithSchedule(
        { type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) },
        { isLiveRow, isCritical: false },
      );
      const itemType = asString(item?.type ?? "");
      const itemId = asString(item?.id ?? "");
      const itemEngineSource = inferItemEngineSource(item, threadId);
      const shouldSuppressGeminiReasoningProcessing =
        itemType === "reasoning" &&
        (itemEngineSource === "gemini" || itemEngineSource === "kimi");
      if (
        shouldMarkProcessing &&
        !shouldSuppressGeminiReasoningProcessing &&
        canProgressEventStartProcessing(itemEngineSource)
      ) {
        markProcessing(threadId, true);
      }
      if (isCodexSubagentActivityItem(item)) {
        applyCollabThreadLinks(threadId, item, workspaceId);
      } else {
        applyCollabThreadLinks(threadId, item);
      }
      const agentMessageSnapshotText = asString(
        item?.text ?? item?.content ?? item?.output_text ?? item?.outputText ?? "",
      );
      if (
        itemType === "agentMessage" ||
        itemType === "reasoning"
      ) {
        logClaudeStream("item-snapshot", {
          workspaceId,
          threadId,
          itemId,
          itemType,
          deltaLength: agentMessageSnapshotText.length,
          textPreview: createDebugPreview(agentMessageSnapshotText),
        });
      }
      if (itemType === "enteredReviewMode") {
        markReviewing(threadId, true);
      } else if (itemType === "exitedReviewMode") {
        markReviewing(threadId, false);
        markProcessing(threadId, false);
      }

      // 当 tool item 开始时，增加分段计数，确保后续文本创建新的 message
      // 这样可以实现文本和工具调用交替显示
      const isToolItem = [
        "commandExecution",
        "fileChange",
        "mcpToolCall",
        "collabToolCall",
        "collabAgentToolCall",
        "webSearch",
        "imageView",
        "generatedImage",
        "generated_image",
        "image_generation_call",
        "image_generation_end",
      ].includes(itemType);
      if (shouldMarkProcessing && shouldIncrementAgentSegment && isToolItem) {
        // A4 live-text 外部化：本段正文只有建壳首段落进了 reducer，其余都停在通道里。
        // 分段前必须把尾段灌回，否则 incrementAgentSegment 之后通道条目会被下一段的
        // 首 delta 顶掉，本段正文永久丢失。dispatch 必须早于 incrementAgentSegment，
        // 好让 reducer 用「旧 segment」解析出本段的 assistant item id。
        // hasCustomName: true 表示灌回不参与线程自动命名（与中断 drain 一致）。
        if (LIVE_TEXT_EXTERNALIZATION_ENABLED) {
          const liveTextTail = drainLiveAssistantTextTail(threadId);
          if (liveTextTail) {
            dispatch({
              type: "appendAgentDelta",
              workspaceId,
              threadId,
              itemId: liveTextTail.itemId,
              delta: liveTextTail.tailDelta,
              hasCustomName: true,
            });
          }
        }
        dispatch({ type: "incrementAgentSegment", threadId });
      }

      if (itemType === "agentMessage") {
        // item completed（shouldMarkProcessing=false）时 snapshot 可能偏短/空，
        // 必须在 clear 通道前与 live 全文合并，否则只剩建壳首段（如 `**`）。
        const settledSnapshotText =
          LIVE_TEXT_EXTERNALIZATION_ENABLED && !shouldMarkProcessing
            ? resolveLiveAssistantSettlementText(
                threadId,
                agentMessageSnapshotText,
              )
            : agentMessageSnapshotText;
        if (settledSnapshotText) {
          upsertLiveAssistantShadowSnapshot({
            engine: inferEngineFromThreadId(threadId),
            workspaceId,
            threadId,
            itemId,
            text: settledSnapshotText,
            turnId,
          });
          // 同 delta 路径：snapshot 换 itemId 时先 drain 上一段，避免只剩建壳首字。
          if (LIVE_TEXT_EXTERNALIZATION_ENABLED && shouldMarkProcessing) {
            const previousTail = drainLiveAssistantTextTailIfItemChanged(
              threadId,
              itemId,
            );
            if (previousTail) {
              dispatch({
                type: "appendAgentDelta",
                workspaceId,
                threadId,
                itemId: previousTail.itemId,
                delta: previousTail.tailDelta,
                hasCustomName: true,
              });
            }
          }
          const liveSnapshotUpdate =
            LIVE_TEXT_EXTERNALIZATION_ENABLED && shouldMarkProcessing
              ? updateLiveAssistantTextSnapshot(
                  threadId,
                  itemId,
                  settledSnapshotText,
                )
              : "replacement";
          const shouldDispatchSnapshot =
            liveSnapshotUpdate === "first" ||
            liveSnapshotUpdate === "replacement";
          if (shouldDispatchSnapshot) {
            const dispatchStartedAt = readHighResolutionNowMs();
            dispatch({
              type: "appendAgentDelta",
              workspaceId,
              threadId,
              itemId,
              delta: settledSnapshotText,
              hasCustomName: Boolean(getCustomName(workspaceId, threadId)),
            });
            const dispatchCostMs =
              readHighResolutionNowMs() - dispatchStartedAt;
            noteThreadReducerWorkMeasured(threadId, {
              itemId,
              textLength: settledSnapshotText.length,
              mergeCostMs: dispatchCostMs,
              normalizationCostMs: dispatchCostMs,
            });
          }
          if (liveSnapshotUpdate === "replacement") {
            clearLiveAssistantText(threadId);
          }
          logClaudeStream("agent-snapshot-routed", {
            workspaceId,
            threadId,
            itemId,
            itemType,
            deltaLength: settledSnapshotText.length,
            textPreview: createDebugPreview(settledSnapshotText),
          });
        }
        safeMessageActivity();
        return;
      }

      const converted = buildConversationItem(item);
      if (converted) {
        const itemEngineSource = asString(
          item.engineSource ?? item.engine_source ?? "",
        )
          .trim()
          .toLowerCase();
        const normalizedConverted =
          itemEngineSource === "claude" ||
          itemEngineSource === "gemini" ||
          itemEngineSource === "grok" ||
          itemEngineSource === "kimi" ||
          itemEngineSource === "opencode" ||
          itemEngineSource === "codex"
            ? {
                ...converted,
                engineSource: itemEngineSource as "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode",
              }
            : converted;
        const threadEngine = inferEngineFromThreadId(threadId);
        // Claude reasoning should converge to the persisted history shape.
        // Accept snapshot items so final/live state can be enriched by the
        // server snapshot instead of staying delta-only.
        if (threadEngine === "claude" && normalizedConverted.kind === "reasoning") {
          logReasoningRoute("reasoning-snapshot-accepted", {
            workspaceId,
            threadId,
            itemId: normalizedConverted.id,
            skipped: false,
            reason: "claude-snapshot-enriches-live-state",
          });
          logClaudeStream("reasoning-snapshot-upsert", {
            workspaceId,
            threadId,
            itemId: normalizedConverted.id,
            itemType,
            deltaLength: `${normalizedConverted.summary}${normalizedConverted.content}`.length,
            textPreview: createDebugPreview(
              normalizedConverted.content || normalizedConverted.summary || "",
            ),
          });
        }
        const normalizedItem =
          normalizedConverted.kind === "message" &&
          normalizedConverted.role === "user" &&
          !normalizedConverted.collaborationMode
            ? {
                ...normalizedConverted,
                collaborationMode: resolveCollaborationUiMode?.(threadId) ?? null,
              }
            : normalizedConverted;
        dispatch({
          type: "upsertItem",
          workspaceId,
          threadId,
          item: normalizedItem,
          hasCustomName: Boolean(getCustomName(workspaceId, threadId)),
        });
        if (
          !shouldMarkProcessing &&
          inferEngineFromThreadId(threadId) === "claude" &&
          normalizedItem.kind === "tool" &&
          isClaudeExitPlanModeTool(normalizedItem)
        ) {
          onExitPlanModeToolCompleted?.({
            workspaceId,
            threadId,
            itemId: normalizedItem.id,
          });
        }
      }
      safeMessageActivity();
    },
    [
      activeThreadId,
      applyCollabThreadLinks,
      dispatch,
      dispatchWithSchedule,
      flushRealtimeDeltaOps,
      getCustomName,
      interruptedThreadsRef,
      isRealtimeTurnTerminal,
      isClaudeExitPlanModeTool,
      logClaudeStream,
      logReasoningRoute,
      markProcessing,
      markReviewing,
      onExitPlanModeToolCompleted,
      resolveCollaborationUiMode,
      safeMessageActivity,
    ],
  );

  // 2026-06-24-harden-realtime-interaction-jank-during-tool-call §5.2
  // Tool output tail gate. Coalesces per-item deltas at 32ms (or 16ms in
  // aggressive tier) and caps the per-key buffer at 1 MiB. The flush
  // handler enqueues a single `toolOutputDelta` op into the existing
  // realtime delta queue, preserving the contract with
  // `applyRealtimeDeltaOperation`. The gate can be disabled at runtime
  // via `localStorage.setItem("doge.perf.toolOutputTailGate", "off")`,
  // in which case the flush handler is invoked synchronously per submit.
  const toolOutputMetadataRef = useRef(
    new Map<ToolOutputKey, { threadId: string; turnId: string | null }>(),
  );

  const toolOutputTailGate = useMemo(
    () =>
      createToolOutputTailGate({
        onEntryEvicted: (key) => {
          toolOutputMetadataRef.current.delete(key);
        },
        flushHandler: (key, fullText) => {
          // Re-decompose the key into the original tuple. The gate is
          // append-only, so we forward the merged text as a single delta.
          // The reducer is idempotent for repeated text appends.
          const [workspaceId, itemId] = key.split("\0") as [
            string,
            string,
            string,
          ];
          const metadata = toolOutputMetadataRef.current.get(key);
          const threadId = metadata?.threadId ?? "";
          if (!workspaceId || !threadId || !itemId) return;
          enqueueRealtimeDeltaOperation({
            kind: "toolOutputDelta",
            workspaceId,
            threadId,
            itemId,
            delta: fullText,
            turnId: metadata?.turnId ?? null,
          });
        },
      }),
    [enqueueRealtimeDeltaOperation],
  );

  // Flush the tool output gate on item completion / turn completion so the
  // user sees the final tail before the next reducer turn kicks in.
  useEffect(() => {
    return () => {
      // Drain on unmount so any buffered deltas land before the hook is
      // torn down. Tests can call __flushAllForTests synchronously.
      toolOutputTailGate.flushAll();
    };
  }, [toolOutputTailGate]);

  const handleToolOutputDelta = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      kind: "commandExecution" | "fileChange",
      turnId?: string | null,
    ) => {
      // 2026-06-24-harden-realtime-interaction-jank-during-tool-call §5.2
      // Forward the delta into the tail gate instead of the realtime delta
      // queue directly. The gate coalesces and forwards the merged text
      // to `enqueueRealtimeDeltaOperation` at its 32ms cadence.
      const key = buildToolOutputKey(workspaceId, itemId, kind);
      toolOutputMetadataRef.current.set(key, {
        threadId,
        turnId: turnId ?? null,
      });
      toolOutputTailGate.submit(key, delta);
    },
    [toolOutputTailGate],
  );

  const flushToolOutputForItem = useCallback(
    (workspaceId: string, itemId: string) => {
      for (const kind of ["commandExecution", "fileChange"] as const) {
        const key = buildToolOutputKey(workspaceId, itemId, kind);
        toolOutputTailGate.flush(key);
        toolOutputTailGate.reset(key);
        toolOutputMetadataRef.current.delete(key);
      }
    },
    [toolOutputTailGate],
  );

  const handleTerminalInteraction = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      stdin: string,
      turnId?: string | null,
    ) => {
      if (!stdin) {
        return;
      }
      const normalized = stdin.replace(/\r\n/g, "\n");
      const suffix = normalized.endsWith("\n") ? "" : "\n";
      handleToolOutputDelta(
        workspaceId,
        threadId,
        itemId,
        `\n[stdin]\n${normalized}${suffix}`,
        "commandExecution",
        turnId,
      );
    },
    [handleToolOutputDelta],
  );
  const onAgentMessageDelta = useCallback(
    ({
      workspaceId,
      threadId,
      itemId,
      delta,
      turnId,
    }: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
      turnId?: string | null;
    }) => {
      // Skip late-arriving deltas for threads that have been interrupted
      if (isInterruptedThread(interruptedThreadsRef, workspaceId, threadId)) {
        logClaudeStream("agent-delta-skipped", {
          workspaceId,
          threadId,
          itemId,
          deltaLength: delta.length,
          textPreview: createDebugPreview(delta),
          skipped: true,
          reason: "interrupted-thread",
        });
        return;
      }
      const resolvedDelta = applyPendingClaudeMcpOutputNoticeToAgentDelta(
        workspaceId,
        threadId,
        delta,
      );
      appendLiveAssistantShadowDelta({
        engine: inferEngineFromThreadId(threadId),
        workspaceId,
        threadId,
        itemId,
        delta: resolvedDelta,
        turnId,
      });
      // A4：flag 开启时，首条 delta（或 itemId 变化）仍走 reducer 建壳；
      // 后续 delta 只累计进 live 通道（订阅的 MessageRow 小树渲染），
      // 不再逐条 dispatch 打根。终稿由 completed 全量落地。
      //
      // Text↔Reasoning 交错会换 itemId（Gemini/Grok/Kimi 的 text-N run）。
      // 换 id 前必须先 drain 上一段尾部；否则上段只剩建壳首字，历史重载才完整。
      if (LIVE_TEXT_EXTERNALIZATION_ENABLED) {
        const previousTail = drainLiveAssistantTextTailIfItemChanged(
          threadId,
          itemId,
        );
        if (previousTail) {
          enqueueRealtimeDeltaOperation({
            kind: "agentDelta",
            workspaceId,
            threadId,
            itemId: previousTail.itemId,
            delta: previousTail.tailDelta,
            turnId,
          });
        }
      }
      const liveTextResult = LIVE_TEXT_EXTERNALIZATION_ENABLED
        ? appendLiveAssistantText(threadId, itemId, resolvedDelta)
        : null;
      if (!liveTextResult || liveTextResult.isFirst) {
        enqueueRealtimeDeltaOperation(
          {
            kind: "agentDelta",
            workspaceId,
            threadId,
            itemId,
            delta: resolvedDelta,
            turnId,
          },
          {
            urgent:
              (threadId.startsWith("shared:") ||
                threadId.startsWith("agent-canvas:")) &&
              liveTextResult?.isFirst === true,
          },
        );
      }
      logClaudeStream("agent-delta", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: resolvedDelta.length,
        textPreview: createDebugPreview(resolvedDelta),
      });
    },
    [
      enqueueRealtimeDeltaOperation,
      interruptedThreadsRef,
      logClaudeStream,
    ],
  );

  const onAgentMessageCompleted = useCallback(
    ({
      workspaceId,
      threadId,
      itemId,
      text,
      turnId,
    }: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      text: string;
      turnId?: string | null;
    }) => {
      if (isInterruptedThread(interruptedThreadsRef, workspaceId, threadId)) {
        return;
      }
      const resolvedText = applyPendingClaudeMcpOutputNoticeToAgentCompleted(
        workspaceId,
        threadId,
        text,
      );
      // A4：provider 终稿可能短于通道累积全文（或仅为建壳 `**`）。
      // clear 前先与权威 live 合并，否则 isStreaming 结束后只剩壳文本。
      const settledText = LIVE_TEXT_EXTERNALIZATION_ENABLED
        ? resolveLiveAssistantSettlementText(threadId, resolvedText)
        : resolvedText;
      settleLiveAssistantShadowTranscript({
        engine: inferEngineFromThreadId(threadId),
        workspaceId,
        threadId,
        itemId,
        text: settledText,
        turnId,
        providerFinalObserved: true,
      });
      flushRealtimeDeltaOps();
      if (isRealtimeTurnTerminal(threadId, turnId)) {
        // 回合已 terminal：turn settle 通常已 drain。若通道仍有残留（竞态），
        // 仍须把更长终稿写入 durable state，避免 UI 卡在壳首段。
        if (LIVE_TEXT_EXTERNALIZATION_ENABLED && settledText) {
          const residual = peekLiveAssistantText(threadId);
          if (residual?.text) {
            const timestamp = Date.now();
            dispatch({
              type: "ensureThread",
              workspaceId,
              threadId,
              engine: inferEngineFromThreadId(threadId),
            });
            dispatch({
              type: "flushAgentCompletedBatch",
              workspaceId,
              threadId,
              itemId,
              text: settledText,
              hasCustomName: Boolean(getCustomName(workspaceId, threadId)),
              timestamp,
              isActiveThread: threadId === activeThreadId,
            });
            clearLiveAssistantText(threadId);
            recordThreadActivity(workspaceId, threadId, timestamp);
            safeMessageActivity();
            onAgentMessageCompletedExternal?.({
              workspaceId,
              threadId,
              ...(turnId ? { turnId } : {}),
              itemId,
              text: settledText,
            });
            logClaudeStream("agent-completed-terminal-salvage", {
              workspaceId,
              threadId,
              itemId,
              deltaLength: settledText.length,
              textPreview: createDebugPreview(settledText),
            });
          }
        }
        return;
      }
      const timestamp = Date.now();
      // \u00a76.2: \u4fdd\u8bc1\u4e0a\u4e0b\u6587\u5148 ensureThread (\u539f\u987a\u5e8f)
      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      const hasCustomName = Boolean(getCustomName(workspaceId, threadId));
      // \u00a76.2: \u4e00\u6b21\u6027\u5408\u5e76 completeAgentMessage + setThreadTimestamp +
      // setLastAgentMessage + (\u6761\u4ef6) markUnread\uff0c\u51cf\u5c11 reducer \u8c03\u5ea6\u6b21\u6570\u3002
      dispatch({
        type: "flushAgentCompletedBatch",
        workspaceId,
        threadId,
        itemId,
        text: settledText,
        hasCustomName,
        timestamp,
        isActiveThread: threadId === activeThreadId,
      });
      // A4：终稿已全量落 reducer，清 live 通道；订阅行在同一批提交内
      // 切回读 item.text（终稿），无闪烁。
      if (LIVE_TEXT_EXTERNALIZATION_ENABLED) {
        clearLiveAssistantText(threadId);
      }
      recordThreadActivity(workspaceId, threadId, timestamp);
      safeMessageActivity();
      onAgentMessageCompletedExternal?.({
        workspaceId,
        threadId,
        ...(turnId ? { turnId } : {}),
        itemId,
        text: settledText,
      });
      logClaudeStream("agent-completed", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: settledText.length,
        textPreview: createDebugPreview(settledText),
      });
    },
    [
      activeThreadId,
      dispatch,
      flushRealtimeDeltaOps,
      getCustomName,
      logClaudeStream,
      onAgentMessageCompletedExternal,
      recordThreadActivity,
      safeMessageActivity,
      interruptedThreadsRef,
      isRealtimeTurnTerminal,
    ],
  );

  const onItemStarted = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      handleItemUpdate(workspaceId, threadId, item, true, true);
    },
    [handleItemUpdate],
  );

  const onItemUpdated = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      handleItemUpdate(workspaceId, threadId, item, true, false);
    },
    [handleItemUpdate],
  );

  const onItemCompleted = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      const itemId = asString(item.id ?? "");
      if (itemId) {
        flushToolOutputForItem(workspaceId, itemId);
      }
      handleItemUpdate(workspaceId, threadId, item, false, false);
    },
    [flushToolOutputForItem, handleItemUpdate],
  );

  const onReasoningSummaryDelta = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      engineHint?: ReasoningEngineHint,
      turnId?: string | null,
    ) => {
      logReasoningRoute("reasoning-summary-delta", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: delta.length,
      });
      if (workspaceScopedHas(interruptedThreadsRef.current, workspaceId, threadId)) {
        logClaudeStream("reasoning-summary-delta-skipped", {
          workspaceId,
          threadId,
          itemId,
          deltaLength: delta.length,
          textPreview: createDebugPreview(delta),
          skipped: true,
          reason: "interrupted-thread",
        });
        return;
      }
      enqueueRealtimeDeltaOperation({
        kind: "reasoningSummaryDelta",
        workspaceId,
        threadId,
        itemId,
        delta,
        engineHint,
        turnId,
      });
      logClaudeStream("reasoning-summary-delta", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: delta.length,
        textPreview: createDebugPreview(delta),
      });
    },
    [enqueueRealtimeDeltaOperation, interruptedThreadsRef, logClaudeStream, logReasoningRoute],
  );

  const onReasoningSummaryBoundary = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      engineHint?: ReasoningEngineHint,
      turnId?: string | null,
    ) => {
      logReasoningRoute("reasoning-summary-boundary", {
        workspaceId,
        threadId,
        itemId,
      });
      if (workspaceScopedHas(interruptedThreadsRef.current, workspaceId, threadId)) {
        logClaudeStream("reasoning-summary-boundary-skipped", {
          workspaceId,
          threadId,
          itemId,
          skipped: true,
          reason: "interrupted-thread",
        });
        return;
      }
      enqueueRealtimeDeltaOperation({
        kind: "reasoningSummaryBoundary",
        workspaceId,
        threadId,
        itemId,
        engineHint,
        turnId,
      });
      logClaudeStream("reasoning-summary-boundary", {
        workspaceId,
        threadId,
        itemId,
      });
    },
    [enqueueRealtimeDeltaOperation, interruptedThreadsRef, logClaudeStream, logReasoningRoute],
  );

  const onReasoningTextDelta = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      engineHint?: ReasoningEngineHint,
      turnId?: string | null,
    ) => {
      logReasoningRoute("reasoning-text-delta", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: delta.length,
      });
      if (workspaceScopedHas(interruptedThreadsRef.current, workspaceId, threadId)) {
        logClaudeStream("reasoning-text-delta-skipped", {
          workspaceId,
          threadId,
          itemId,
          deltaLength: delta.length,
          textPreview: createDebugPreview(delta),
          skipped: true,
          reason: "interrupted-thread",
        });
        return;
      }
      enqueueRealtimeDeltaOperation({
        kind: "reasoningContentDelta",
        workspaceId,
        threadId,
        itemId,
        delta,
        engineHint,
        turnId,
      });
      logClaudeStream("reasoning-text-delta", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: delta.length,
        textPreview: createDebugPreview(delta),
      });
    },
    [enqueueRealtimeDeltaOperation, interruptedThreadsRef, logClaudeStream, logReasoningRoute],
  );

  const onCommandOutputDelta = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      turnId?: string | null,
    ) => {
      handleToolOutputDelta(
        workspaceId,
        threadId,
        itemId,
        delta,
        "commandExecution",
        turnId,
      );
    },
    [handleToolOutputDelta],
  );

  const onTerminalInteraction = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      stdin: string,
      turnId?: string | null,
    ) => {
      handleTerminalInteraction(workspaceId, threadId, itemId, stdin, turnId);
    },
    [handleTerminalInteraction],
  );

  const onFileChangeOutputDelta = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      turnId?: string | null,
    ) => {
      handleToolOutputDelta(
        workspaceId,
        threadId,
        itemId,
        delta,
        "fileChange",
        turnId,
      );
    },
    [handleToolOutputDelta],
  );

  const onNormalizedRealtimeEvent = useCallback(
    (event: NormalizedThreadEvent) => {
      const { workspaceId, threadId } = event;
      if (isInterruptedThread(interruptedThreadsRef, workspaceId, threadId)) {
        return;
      }
      const hasCustomName = Boolean(getCustomName(workspaceId, threadId));
      const normalizedItem =
        event.item.kind === "message" &&
        event.item.role === "user" &&
        !event.item.collaborationMode
          ? {
              ...event.item,
              collaborationMode: resolveCollaborationUiMode?.(threadId) ?? null,
            }
          : event.item;
      const normalizedEvent =
        normalizedItem === event.item
          ? event
          : {
              ...event,
              item: normalizedItem,
            };
      const operation = {
        event: normalizedEvent,
        hasCustomName,
      } satisfies PendingNormalizedRealtimeOperation;
      if (
        shouldBatchNormalizedRealtimeEvent(normalizedEvent) ||
        (enableRealtimeBatchingRef.current && shouldUseContractRealtimeBatcher(normalizedEvent))
      ) {
        enqueueNormalizedRealtimeEvent(operation);
        return;
      }
      flushNormalizedRealtimeOps();
      applyNormalizedRealtimeEventNow(operation, {
        useTransitionForDispatch: normalizedEvent.operation !== "completeAgentMessage",
      });
    },
    [
      applyNormalizedRealtimeEventNow,
      enqueueNormalizedRealtimeEvent,
      flushNormalizedRealtimeOps,
      getCustomName,
      interruptedThreadsRef,
      resolveCollaborationUiMode,
    ],
  );

  return {
    onAgentMessageDelta,
    onAgentMessageCompleted,
    onItemStarted,
    onItemUpdated,
    onItemCompleted,
    onNormalizedRealtimeEvent,
    onReasoningSummaryDelta,
    onReasoningSummaryBoundary,
    onReasoningTextDelta,
    onCommandOutputDelta,
    onTerminalInteraction,
    onFileChangeOutputDelta,
    // §6.4: instrumentation test surface
    __getSubmitScheduleInstrumentationForTests,
    flushPendingRealtimeEvents,
    isRealtimeTurnTerminalExact,
    noteRealtimeTurnStarted,
    markRealtimeTurnTerminal,
  };
}
