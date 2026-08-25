import { useCallback } from "react";
import type { Dispatch, MutableRefObject } from "react";
import {
  workspaceScopedDelete,
  workspaceScopedGet,
  workspaceScopedHas,
  workspaceScopedSet,
  type WorkspaceScopedMap,
} from "./workspaceScopedMap";
import type { DebugEntry } from "../../../types";
import { useTranslation } from "react-i18next";
import {
  engineInterrupt as engineInterruptService,
  engineInterruptTurn as engineInterruptTurnService,
  interruptTurn as interruptTurnService,
} from "../../../services/tauri";
import { pushThreadFailureRuntimeNotice } from "../../../services/globalRuntimeNotices";
import { getThreadTimestamp } from "../../../utils/threadItems";
import {
  isClaudeForkThreadId,
  isClaudeSessionBootstrapThreadId,
} from "../utils/claudeForkThread";
import {
  asString,
  normalizePlanUpdate,
  normalizeRateLimits,
  normalizeTokenUsage,
} from "../utils/threadNormalize";
import { previewThreadName } from "../../../utils/threadItems";
import { resolveThreadStabilityDiagnostic } from "../utils/stabilityDiagnostics";
import type { TurnExecutionSnapshot } from "../../shared-session/target/types";
import { hasCodexBackgroundHelperPreview } from "../utils/codexBackgroundHelpers";
import { isCodexPrewarmThreadStart } from "../utils/codexPendingPrewarm";
import {
  drainLiveAssistantTextTail,
  renameLiveAssistantTextThread,
} from "../utils/liveAssistantTextChannel";
import { resolveCodexSubagentIdentity } from "../utils/codexSubagentIdentity";
import {
  inferEngineFromLegacyThreadId,
  isPendingSessionForEngine,
} from "../contracts/engineRuntimeIdentity";
import type { ThreadAction } from "./useThreadsReducer";

/**
 * Infer engine type from thread ID.
 * Claude/Gemini/Kimi/OpenCode threads use "<engine>:" or "<engine>-pending-" prefixes.
 */
const inferEngineFromThreadId = inferEngineFromLegacyThreadId;

type ContextCompactionSourcePayload = {
  auto?: boolean | null;
  manual?: boolean | null;
};

function resolveCompactionSource(
  payload?: ContextCompactionSourcePayload,
): "auto" | "manual" | null | undefined {
  if (!payload) {
    return undefined;
  }
  if (payload.manual === true) {
    return "manual";
  }
  if (payload.auto === true) {
    return "auto";
  }
  return undefined;
}

function isCodexContextCompaction(threadId: string): boolean {
  if (inferEngineFromThreadId(threadId) !== "codex") {
    return false;
  }
  return true;
}

function buildCodexCompactionCompletionFallbackId(threadId: string, turnId: string) {
  return `context-compacted-codex-compact-${threadId}-completed-${turnId}`;
}

function isCodexBackgroundHelperThread(
  threadId: string,
  thread: Record<string, unknown>,
): boolean {
  if (inferEngineFromThreadId(threadId) !== "codex") {
    return false;
  }
  const previewCandidates = [
    asString(thread.preview).trim(),
    asString(thread.title).trim(),
  ].filter(Boolean);
  return hasCodexBackgroundHelperPreview(previewCandidates);
}

function normalizeThreadProviderMetadataString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function extractThreadProviderMetadata(thread: Record<string, unknown>) {
  const sourceLabel = normalizeThreadProviderMetadataString(
    thread.sourceLabel ?? thread.source_label,
  );
  const providerProfileId = normalizeThreadProviderMetadataString(
    thread.providerProfileId ?? thread.provider_profile_id,
  );
  const providerProfileSource = normalizeThreadProviderMetadataString(
    thread.providerProfileSource ?? thread.provider_profile_source,
  );
  const providerProfileName = normalizeThreadProviderMetadataString(
    thread.providerProfileName ?? thread.provider_profile_name,
  );
  const providerAvailability = normalizeThreadProviderMetadataString(
    thread.providerAvailability ?? thread.provider_availability,
  );
  return {
    ...(sourceLabel ? { sourceLabel } : {}),
    ...(providerProfileId ? { providerProfileId } : {}),
    ...(providerProfileSource ? { providerProfileSource } : {}),
    ...(providerProfileName ? { providerProfileName } : {}),
    ...(providerAvailability ? { providerAvailability } : {}),
  };
}

function isPendingThreadForEngine(
  engine: "claude" | "gemini" | "grok" | "kimi" | "opencode",
  threadId: string | null | undefined,
): threadId is string {
  if (!threadId) {
    return false;
  }
  if (engine === "claude") {
    return isClaudeSessionBootstrapThreadId(threadId);
  }
  return isPendingSessionForEngine(engine, threadId);
}

type UseThreadTurnEventsOptions = {
  activeThreadId?: string | null;
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  resolveCanonicalThreadId?: (threadId: string) => string;
  isAutoTitlePending: (workspaceId: string, threadId: string) => boolean;
  isThreadHidden: (workspaceId: string, threadId: string) => boolean;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  markReviewing: (threadId: string, isReviewing: boolean) => void;
  setActiveTurnId: (threadId: string, turnId: string | null) => void;
  codexCompactionInFlightByThreadRef: MutableRefObject<Record<string, boolean>>;
  pendingInterruptsRef: MutableRefObject<WorkspaceScopedMap<true>>;
  interruptedThreadsRef: MutableRefObject<WorkspaceScopedMap<true>>;
  pushThreadErrorMessage: (
    workspaceId: string,
    threadId: string,
    message: string,
    executionTargetSnapshot?: TurnExecutionSnapshot,
  ) => void;
  safeMessageActivity: () => void;
  recordThreadActivity: (workspaceId: string, threadId: string, timestamp?: number) => void;
  renameCustomNameKey: (
    workspaceId: string,
    oldThreadId: string,
    newThreadId: string,
  ) => void;
  renameAutoTitlePendingKey: (
    workspaceId: string,
    oldThreadId: string,
    newThreadId: string,
  ) => void;
  renameThreadTitleMapping: (
    workspaceId: string,
    oldThreadId: string,
    newThreadId: string,
  ) => Promise<void>;
  resolvePendingThreadForSession?: (
    workspaceId: string,
    engine: "claude" | "gemini" | "grok" | "kimi" | "opencode",
  ) => string | null;
  resolvePendingThreadForTurn?: (
    workspaceId: string,
    engine: "claude" | "gemini" | "grok" | "kimi" | "opencode",
    turnId: string | null | undefined,
  ) => string | null;
  getActiveTurnIdForThread?: (threadId: string) => string | null;
  hasEstablishedThreadItems?: (threadId: string) => boolean;
  renamePendingMemoryCaptureKey: (
    oldThreadId: string,
    newThreadId: string,
  ) => void;
  onDebug?: (entry: DebugEntry) => void;
};

export function useThreadTurnEvents({
  activeThreadId = null,
  dispatch,
  getCustomName,
  resolveCanonicalThreadId,
  isAutoTitlePending,
  isThreadHidden,
  markProcessing,
  markReviewing,
  setActiveTurnId,
  codexCompactionInFlightByThreadRef,
  pendingInterruptsRef,
  interruptedThreadsRef,
  pushThreadErrorMessage,
  safeMessageActivity,
  recordThreadActivity,
  renameCustomNameKey,
  renameAutoTitlePendingKey,
  renameThreadTitleMapping,
  resolvePendingThreadForSession,
  resolvePendingThreadForTurn,
  getActiveTurnIdForThread,
  hasEstablishedThreadItems,
  renamePendingMemoryCaptureKey,
  onDebug,
}: UseThreadTurnEventsOptions) {
  const { t } = useTranslation();
  const collectCompactionTargetThreadIds = useCallback(
    (threadId: string) => {
      const normalizedThreadId = threadId.trim();
      if (!normalizedThreadId) {
        return [] as string[];
      }
      const canonicalThreadId = resolveCanonicalThreadId?.(normalizedThreadId) ?? normalizedThreadId;
      return Array.from(new Set([normalizedThreadId, canonicalThreadId].filter(Boolean)));
    },
    [resolveCanonicalThreadId],
  );
  const isCodexCompactionInFlight = useCallback(
    (threadId: string) => codexCompactionInFlightByThreadRef.current[threadId] ?? false,
    [codexCompactionInFlightByThreadRef],
  );
  const setCodexCompactionInFlight = useCallback(
    (threadIds: string[], nextInFlight: boolean) => {
      const compactionStateByThread = codexCompactionInFlightByThreadRef.current;
      threadIds.forEach((targetThreadId) => {
        if (nextInFlight) {
          compactionStateByThread[targetThreadId] = true;
          return;
        }
        delete compactionStateByThread[targetThreadId];
      });
    },
    [codexCompactionInFlightByThreadRef],
  );
  const logSessionTrace = useCallback(
    (label: string, payload: Record<string, unknown>) => {
      onDebug?.({
        id: `${Date.now()}-thread-session-trace`,
        timestamp: Date.now(),
        source: "event",
        label: `thread/session:${label}`,
        payload,
      });
    },
    [onDebug],
  );
  const migrateThreadInterruptGuards = useCallback(
    (oldThreadId: string, newThreadId: string) => {
      const result = {
        movedPendingInterrupt: false,
        movedInterruptedThread: false,
      };
      if (!oldThreadId || !newThreadId || oldThreadId === newThreadId) {
        return result;
      }
      // workspace-scope rename: scan every workspace bucket and move
      // the oldThreadId entry to newThreadId (preserving the workspace
      // bucket key)
      for (const store of [pendingInterruptsRef.current, interruptedThreadsRef.current]) {
        for (const workspaceId of Array.from(store.keys())) {
          if (workspaceScopedHas(store, workspaceId, oldThreadId)) {
            const value = workspaceScopedGet(store, workspaceId, oldThreadId);
            workspaceScopedDelete(store, workspaceId, oldThreadId);
            if (value !== undefined) {
              workspaceScopedSet(store, workspaceId, newThreadId, value);
            }
            if (store === pendingInterruptsRef.current) {
              result.movedPendingInterrupt = true;
            } else {
              result.movedInterruptedThread = true;
            }
          }
        }
      }
      return result;
    },
    [interruptedThreadsRef, pendingInterruptsRef],
  );
  const resolvePendingAliasThread = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
    ): string | null => {
      const engine = threadId.startsWith("opencode:")
        ? "opencode"
        : threadId.startsWith("gemini:")
          ? "gemini"
        : threadId.startsWith("grok:")
          ? "grok"
        : threadId.startsWith("kimi:")
          ? "kimi"
        : threadId.startsWith("claude:")
          ? "claude"
          : null;
      if (!engine) {
        return null;
      }
      if (!turnId || !getActiveTurnIdForThread) {
        return null;
      }
      const resolveMatchingPending = (candidate: string | null | undefined) => {
        if (!candidate || candidate === threadId) {
          return null;
        }
        const activePendingTurnId = getActiveTurnIdForThread(candidate);
        return activePendingTurnId === turnId ? candidate : null;
      };
      return (
        resolveMatchingPending(resolvePendingThreadForSession?.(workspaceId, engine)) ??
        resolveMatchingPending(resolvePendingThreadForTurn?.(workspaceId, engine, turnId))
      );
    },
    [getActiveTurnIdForThread, resolvePendingThreadForSession, resolvePendingThreadForTurn],
  );

  const emitTurnSettlementAudit = useCallback(
    (
      result: "settled" | "rejected",
      payload: Record<string, unknown>,
    ) => {
      const threadId =
        typeof payload.threadId === "string" ? payload.threadId : "";
      onDebug?.({
        id: `${Date.now()}-turn-settlement-${result}`,
        timestamp: Date.now(),
        source: "client",
        label: `thread/session:turn-settlement:${result}`,
        payload: {
          diagnosticCategory: "foreground-terminal-settlement",
          engine: threadId ? inferEngineFromThreadId(threadId) : null,
          settlementResult: result,
          ...payload,
        },
      });
    },
    [onDebug],
  );

  const onThreadStarted = useCallback(
    (workspaceId: string, thread: Record<string, unknown>) => {
      const threadId = asString(thread.id);
      if (!threadId) {
        return;
      }
      if (isCodexBackgroundHelperThread(threadId, thread)) {
        dispatch({ type: "hideThread", workspaceId, threadId });
        return;
      }
      // 乐观创建的 codex 会话在后台预热了真实线程，app-server 会为它推一条
      // thread/started。首次发消息 finalize 换绑前放它进侧边栏，就会和
      // `codex-pending-*` 条目并列成两条空会话。
      if (
        inferEngineFromThreadId(threadId) === "codex" &&
        isCodexPrewarmThreadStart(workspaceId, threadId)
      ) {
        return;
      }
      if (isThreadHidden(workspaceId, threadId)) {
        return;
      }
      const customName = getCustomName(workspaceId, threadId);
      const canApplyLiveName =
        !customName && !isAutoTitlePending(workspaceId, threadId);
      const liveIdentity = resolveCodexSubagentIdentity(threadId, thread);
      dispatch({
        type: "ensureThread",
        workspaceId,
        threadId,
        engine: inferEngineFromThreadId(threadId),
        ...(liveIdentity.parentThreadId
          ? { parentThreadId: liveIdentity.parentThreadId }
          : {}),
        ...(canApplyLiveName && liveIdentity.name
          ? { name: liveIdentity.name }
          : {}),
        ...extractThreadProviderMetadata(thread),
      });
      if (inferEngineFromThreadId(threadId) === "codex") {
        dispatch({
          type: "markCodexAcceptedTurn",
          threadId,
          fact: "empty-draft",
          source: "thread-start",
          timestamp: Date.now(),
        });
      }
      const timestamp = getThreadTimestamp(thread);
      const activityTimestamp = timestamp > 0 ? timestamp : Date.now();
      recordThreadActivity(workspaceId, threadId, activityTimestamp);
      dispatch({
        type: "setThreadTimestamp",
        workspaceId,
        threadId,
        timestamp: activityTimestamp,
      });

      if (canApplyLiveName && !liveIdentity.name) {
        const preview = asString(thread.preview).trim();
        if (preview) {
          const name = previewThreadName(preview, `Agent ${threadId.slice(0, 4)}`);
          dispatch({ type: "setThreadName", workspaceId, threadId, name });
        }
      }
      safeMessageActivity();
    },
    [dispatch, getCustomName, isAutoTitlePending, isThreadHidden, recordThreadActivity, safeMessageActivity],
  );

  const onTurnStarted = useCallback(
    (workspaceId: string, threadId: string, turnId: string) => {
      dispatch({
        type: "ensureThread",
        workspaceId,
        threadId,
        engine: inferEngineFromThreadId(threadId),
      });
      dispatch({
        type: "setThreadHistoryRestoredAt",
        threadId,
        timestamp: null,
      });
      dispatch({ type: "markContextCompacting", threadId, isCompacting: false });
      if (workspaceScopedHas(pendingInterruptsRef.current, workspaceId, threadId)) {
        workspaceScopedDelete(pendingInterruptsRef.current, workspaceId, threadId);
        const engine = inferEngineFromThreadId(threadId);
        if (engine === "codex" && turnId) {
          void interruptTurnService(workspaceId, threadId, turnId).catch(() => {});
        } else if (turnId) {
          void engineInterruptTurnService(workspaceId, turnId, engine).catch(() => {
            // Fallback for older runtimes missing turn-scoped interrupt.
            void engineInterruptService(workspaceId).catch(() => {});
          });
        }
        return;
      }
      markProcessing(threadId, true);
      if (turnId) {
        setActiveTurnId(threadId, turnId);
      }
    },
    [dispatch, markProcessing, pendingInterruptsRef, setActiveTurnId],
  );

  const onTurnCompleted = useCallback(
    (workspaceId: string, threadId: string, turnId: string) => {
      const aliasThreadId = resolvePendingAliasThread(workspaceId, threadId, turnId);
      const activeTurnId = getActiveTurnIdForThread?.(threadId) ?? null;
      const activeAliasTurnId = aliasThreadId
        ? (getActiveTurnIdForThread?.(aliasThreadId) ?? null)
        : null;
      const targetThreadIds = Array.from(
        new Set(aliasThreadId ? [threadId, aliasThreadId] : [threadId]),
      );
      const targetSnapshots = targetThreadIds.map((targetThreadId) => ({
        threadId: targetThreadId,
        activeTurnId:
          targetThreadId === threadId
            ? activeTurnId
            : targetThreadId === aliasThreadId
              ? activeAliasTurnId
              : (getActiveTurnIdForThread?.(targetThreadId) ?? null),
      }));
      const safeTargets = targetSnapshots.filter(
        (target) =>
          !turnId ||
          target.activeTurnId === null ||
          target.activeTurnId === turnId,
      );
      const rejectedTargets = targetSnapshots.filter(
        (target) => !safeTargets.some((safeTarget) => safeTarget.threadId === target.threadId),
      );
      if (safeTargets.length === 0) {
        emitTurnSettlementAudit("rejected", {
          workspaceId,
          threadId,
          turnId,
          aliasThreadId,
          activeTurnId,
          activeAliasTurnId,
          rejectedTargets,
          reason: "turn-mismatch",
          incomingTurnId: turnId || null,
          currentActiveTurnId: activeTurnId,
          targetThreadCount: targetSnapshots.length,
        });
        return false;
      }
      safeTargets.forEach(({ threadId: targetThreadId }) => {
        // A4 live-text 外部化：terminal settlement 前把尚未落入 reducer 的尾段
        // 回灌到同一 assistant item。否则 isStreaming 关闭后只能读到建壳首段。
        const liveTextTail = drainLiveAssistantTextTail(targetThreadId);
        if (liveTextTail) {
          dispatch({
            type: "appendAgentDelta",
            workspaceId,
            threadId: targetThreadId,
            itemId: liveTextTail.itemId,
            delta: liveTextTail.tailDelta,
            hasCustomName: true,
          });
        }
        dispatch({
          type: "clearProcessingGeneratedImages",
          threadId: targetThreadId,
        });
        dispatch({ type: "markTerminalSettlement", threadId: targetThreadId });
        dispatch({
          type: "finalizePendingToolStatuses",
          threadId: targetThreadId,
          status: "completed",
        });
        dispatch({
          type: "markContextCompacting",
          threadId: targetThreadId,
          isCompacting: false,
          timestamp: Date.now(),
        });
        dispatch({
          type: "settleThreadPlanInProgress",
          threadId: targetThreadId,
          targetStatus: "completed",
        });
        markProcessing(targetThreadId, false);
        setActiveTurnId(targetThreadId, null);
        workspaceScopedDelete(pendingInterruptsRef.current, workspaceId, targetThreadId);
        workspaceScopedDelete(interruptedThreadsRef.current, workspaceId, targetThreadId);
        // 重置分段计数，为下一个 turn 做准备
        dispatch({ type: "resetAgentSegment", threadId: targetThreadId });
        dispatch({ type: "markLatestAssistantMessageFinal", threadId: targetThreadId });
      });
      emitTurnSettlementAudit("settled", {
        workspaceId,
        threadId,
        turnId,
        aliasThreadId,
        activeTurnId,
        activeAliasTurnId,
        settledThreadIds: safeTargets.map((target) => target.threadId),
        rejectedTargets,
        reason: rejectedTargets.length > 0 ? "partial-turn-mismatch" : "matched",
        incomingTurnId: turnId || null,
        currentActiveTurnId: activeTurnId,
        targetThreadCount: targetSnapshots.length,
      });
      return true;
    },
    [
      dispatch,
      emitTurnSettlementAudit,
      getActiveTurnIdForThread,
      interruptedThreadsRef,
      markProcessing,
      pendingInterruptsRef,
      resolvePendingAliasThread,
      setActiveTurnId,
    ],
  );

  const onTurnPlanUpdated = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
      payload: { explanation: unknown; plan: unknown },
    ) => {
      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      const normalized = normalizePlanUpdate(
        turnId,
        payload.explanation,
        payload.plan,
      );
      dispatch({ type: "setThreadPlan", threadId, plan: normalized });
    },
    [dispatch],
  );

  const onThreadTokenUsageUpdated = useCallback(
    (workspaceId: string, threadId: string, tokenUsage: Record<string, unknown>) => {
      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      dispatch({
        type: "setThreadTokenUsage",
        threadId,
        tokenUsage: normalizeTokenUsage(tokenUsage),
      });
    },
    [dispatch],
  );

  const onAccountRateLimitsUpdated = useCallback(
    (workspaceId: string, rateLimits: Record<string, unknown>) => {
      dispatch({
        type: "setRateLimits",
        workspaceId,
        rateLimits: normalizeRateLimits(rateLimits),
      });
    },
    [dispatch],
  );

  const onTurnError = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
      payload: {
        message: string;
        willRetry: boolean;
        suppressMessage?: boolean;
        executionTargetSnapshot?: TurnExecutionSnapshot;
      },
    ) => {
      if (payload.willRetry) {
        return;
      }
      const aliasThreadId = resolvePendingAliasThread(workspaceId, threadId, turnId);
      const activeTurnId = getActiveTurnIdForThread?.(threadId) ?? null;
      const activeAliasTurnId = aliasThreadId
        ? (getActiveTurnIdForThread?.(aliasThreadId) ?? null)
        : null;
      const matchesActiveTurn =
        !turnId ||
        activeTurnId === null ||
        activeTurnId === turnId ||
        activeAliasTurnId === turnId;
      if (!matchesActiveTurn) {
        return;
      }

      // If this thread was interrupted by user, the error is expected
      // (e.g. "Session stopped."). Clean up the interrupted flag and
      // suppress the redundant error message since interruptTurn already
      // displayed "Session stopped." to the user.
      const wasInterrupted = workspaceScopedHas(
        interruptedThreadsRef.current,
        workspaceId,
        threadId,
      );
      const shouldKeepInterruptedGuard =
        wasInterrupted && inferEngineFromThreadId(threadId) === "gemini";
      if (!shouldKeepInterruptedGuard) {
        workspaceScopedDelete(interruptedThreadsRef.current, workspaceId, threadId);
      }

      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      dispatch({
        type: "clearProcessingGeneratedImages",
        threadId,
      });
      dispatch({ type: "markTerminalSettlement", threadId });
      dispatch({
        type: "finalizePendingToolStatuses",
        threadId,
        status: "failed",
      });
      dispatch({
        type: "settleThreadPlanInProgress",
        threadId,
        targetStatus: "pending",
      });
      dispatch({
        type: "markContextCompacting",
        threadId,
        isCompacting: false,
        timestamp: Date.now(),
      });
      markProcessing(threadId, false);
      markReviewing(threadId, false);
      setActiveTurnId(threadId, null);
      if (aliasThreadId) {
        dispatch({
          type: "clearProcessingGeneratedImages",
          threadId: aliasThreadId,
        });
        dispatch({
          type: "markTerminalSettlement",
          threadId: aliasThreadId,
        });
        dispatch({
          type: "finalizePendingToolStatuses",
          threadId: aliasThreadId,
          status: "failed",
        });
        dispatch({
          type: "markContextCompacting",
          threadId: aliasThreadId,
          isCompacting: false,
          timestamp: Date.now(),
        });
        dispatch({
          type: "settleThreadPlanInProgress",
          threadId: aliasThreadId,
          targetStatus: "pending",
        });
        markProcessing(aliasThreadId, false);
        markReviewing(aliasThreadId, false);
        setActiveTurnId(aliasThreadId, null);
        workspaceScopedDelete(pendingInterruptsRef.current, workspaceId, aliasThreadId);
        workspaceScopedDelete(interruptedThreadsRef.current, workspaceId, aliasThreadId);
      }

      if (!wasInterrupted && !payload.suppressMessage) {
        const stabilityDiagnostic = payload.message
          ? resolveThreadStabilityDiagnostic(payload.message)
          : null;
        if (stabilityDiagnostic) {
          onDebug?.({
            id: `${Date.now()}-thread-stability-diagnostic`,
            timestamp: Date.now(),
            source: "event",
            label: "thread/stability diagnostic",
            payload: {
              workspaceId,
              threadId,
              turnId,
              category: stabilityDiagnostic.category,
              rawMessage: stabilityDiagnostic.rawMessage,
              recoveryReason: stabilityDiagnostic.reconnectReason ?? null,
            },
          });
        }
        const message = payload.message
          ? t("threads.turnFailedWithMessage", { message: payload.message })
          : t("threads.turnFailed");
        if (payload.executionTargetSnapshot) {
          pushThreadErrorMessage(
            workspaceId,
            threadId,
            message,
            payload.executionTargetSnapshot,
          );
        } else {
          pushThreadErrorMessage(workspaceId, threadId, message);
        }
        pushThreadFailureRuntimeNotice({
          workspaceId,
          threadId,
          turnId,
          engine: inferEngineFromThreadId(threadId),
          message: payload.message || message,
        });
      }
      safeMessageActivity();
    },
    [
      dispatch,
      getActiveTurnIdForThread,
      interruptedThreadsRef,
      markProcessing,
      markReviewing,
      onDebug,
      pendingInterruptsRef,
      pushThreadErrorMessage,
      resolvePendingAliasThread,
      safeMessageActivity,
      setActiveTurnId,
      t,
    ],
  );

  const onTurnStalled = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
      payload: {
        message: string;
        reasonCode: string;
        stage: string;
        source: string;
        startedAtMs: number | null;
        timeoutMs: number | null;
      },
    ) => {
      const aliasThreadId = resolvePendingAliasThread(workspaceId, threadId, turnId);
      const activeTurnId = getActiveTurnIdForThread?.(threadId) ?? null;
      const activeAliasTurnId = aliasThreadId
        ? (getActiveTurnIdForThread?.(aliasThreadId) ?? null)
        : null;
      const matchesActiveTurn =
        !turnId ||
        activeTurnId === null ||
        activeTurnId === turnId ||
        activeAliasTurnId === turnId;
      if (!matchesActiveTurn) {
        return;
      }

      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      dispatch({
        type: "clearProcessingGeneratedImages",
        threadId,
      });
      dispatch({ type: "markTerminalSettlement", threadId });
      dispatch({
        type: "settleThreadPlanInProgress",
        threadId,
        targetStatus: "pending",
      });
      dispatch({
        type: "markContextCompacting",
        threadId,
        isCompacting: false,
        timestamp: Date.now(),
      });
      markProcessing(threadId, false);
      markReviewing(threadId, false);
      setActiveTurnId(threadId, null);
      if (aliasThreadId) {
        dispatch({
          type: "clearProcessingGeneratedImages",
          threadId: aliasThreadId,
        });
        dispatch({
          type: "markTerminalSettlement",
          threadId: aliasThreadId,
        });
        dispatch({
          type: "settleThreadPlanInProgress",
          threadId: aliasThreadId,
          targetStatus: "pending",
        });
        dispatch({
          type: "markContextCompacting",
          threadId: aliasThreadId,
          isCompacting: false,
          timestamp: Date.now(),
        });
        markProcessing(aliasThreadId, false);
        markReviewing(aliasThreadId, false);
        setActiveTurnId(aliasThreadId, null);
      }
      onDebug?.({
        id: `${Date.now()}-thread-stability-diagnostic`,
        timestamp: Date.now(),
        source: "event",
        label: "thread/stability diagnostic",
        payload: {
          workspaceId,
          threadId,
          turnId,
          category: "resume_stalled",
          rawMessage: payload.message,
          reasonCode: payload.reasonCode,
          stage: payload.stage,
          source: payload.source,
          startedAtMs: payload.startedAtMs,
          timeoutMs: payload.timeoutMs,
        },
      });
      const isFusionStalled = payload.source === "queue-fusion-cutover";
      const message = payload.message
        ? t(
            isFusionStalled
              ? "threads.fusionTurnStalledWithMessage"
              : "threads.turnStalledWithMessage",
            { message: payload.message },
          )
        : t(isFusionStalled ? "threads.fusionTurnStalled" : "threads.turnStalled");
      pushThreadErrorMessage(workspaceId, threadId, message);
      pushThreadFailureRuntimeNotice({
        workspaceId,
        threadId,
        turnId,
        engine: inferEngineFromThreadId(threadId),
        message: payload.message || message,
      });
      safeMessageActivity();
    },
    [
      dispatch,
      getActiveTurnIdForThread,
      markProcessing,
      markReviewing,
      onDebug,
      pushThreadErrorMessage,
      resolvePendingAliasThread,
      safeMessageActivity,
      setActiveTurnId,
      t,
    ],
  );

  const onContextCompacted = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
      payload?: ContextCompactionSourcePayload,
    ) => {
      const timestamp = Date.now();
      const targetThreadIds = collectCompactionTargetThreadIds(threadId);
      const wasCodexCompacting = targetThreadIds.some(isCodexCompactionInFlight);
      const isCodexCompaction = payload
        ? targetThreadIds.some((targetThreadId) => isCodexContextCompaction(targetThreadId))
        : wasCodexCompacting;
      setCodexCompactionInFlight(targetThreadIds, false);
      const compactionSource = resolveCompactionSource(payload);
      targetThreadIds.forEach((targetThreadId) => {
        const compactionAction: ThreadAction = {
          type: "markContextCompacting",
          threadId: targetThreadId,
          isCompacting: false,
          timestamp,
          ...(isCodexCompaction ? { completionStatus: "completed" as const } : {}),
          ...(compactionSource !== undefined ? { source: compactionSource } : {}),
        };
        dispatch({
          type: "ensureThread",
          workspaceId,
          threadId: targetThreadId,
          engine: inferEngineFromThreadId(targetThreadId),
        });
        dispatch(compactionAction);
      });
      const resolvedTurnId = turnId || `auto-${timestamp}`;
      if (isCodexCompaction) {
        const shouldAppendCompletedFallback = Boolean(payload) && !wasCodexCompacting;
        targetThreadIds.forEach((targetThreadId) => {
          dispatch({
            type: "settleCodexCompactionMessage",
            threadId: targetThreadId,
            text: t("threads.codexCompactionCompleted"),
            fallbackMessageId: buildCodexCompactionCompletionFallbackId(
              targetThreadId,
              resolvedTurnId,
            ),
            appendIfAlreadyCompleted: shouldAppendCompletedFallback,
          });
        });
      } else {
        targetThreadIds.forEach((targetThreadId) => {
          dispatch({
            type: "appendContextCompacted",
            threadId: targetThreadId,
            turnId: resolvedTurnId,
          });
        });
      }
      targetThreadIds.forEach((targetThreadId) => {
        recordThreadActivity(workspaceId, targetThreadId, timestamp);
      });
      safeMessageActivity();
    },
    [
      collectCompactionTargetThreadIds,
      dispatch,
      isCodexCompactionInFlight,
      recordThreadActivity,
      safeMessageActivity,
      setCodexCompactionInFlight,
      t,
    ],
  );

  const onContextCompacting = useCallback(
    (
      workspaceId: string,
      threadId: string,
      _payload: {
        usagePercent: number | null;
        thresholdPercent: number | null;
        targetPercent: number | null;
        auto?: boolean | null;
        manual?: boolean | null;
      },
    ) => {
      const targetThreadIds = collectCompactionTargetThreadIds(threadId);
      const isCodexCompaction = targetThreadIds.some((targetThreadId) =>
        isCodexContextCompaction(targetThreadId),
      );
      setCodexCompactionInFlight(targetThreadIds, isCodexCompaction);
      const timestamp = Date.now();
      const compactionSource = resolveCompactionSource(_payload);
      targetThreadIds.forEach((targetThreadId) => {
        const compactionAction: ThreadAction = {
          type: "markContextCompacting",
          threadId: targetThreadId,
          isCompacting: true,
          timestamp,
          ...(compactionSource !== undefined ? { source: compactionSource } : {}),
        };
        dispatch({
          type: "ensureThread",
          workspaceId,
          threadId: targetThreadId,
          engine: inferEngineFromThreadId(targetThreadId),
        });
        dispatch(compactionAction);
      });
      if (isCodexCompaction) {
        targetThreadIds.forEach((targetThreadId) => {
          dispatch({
            type: "appendCodexCompactionMessage",
            threadId: targetThreadId,
            text: t("threads.codexCompactionStarted"),
          });
        });
      }
      targetThreadIds.forEach((targetThreadId) => {
        recordThreadActivity(workspaceId, targetThreadId, timestamp);
      });
      safeMessageActivity();
    },
    [
      collectCompactionTargetThreadIds,
      dispatch,
      recordThreadActivity,
      safeMessageActivity,
      setCodexCompactionInFlight,
      t,
    ],
  );

  const onContextCompactionFailed = useCallback(
    (workspaceId: string, threadId: string, reason: string) => {
      const timestamp = Date.now();
      const targetThreadIds = collectCompactionTargetThreadIds(threadId);
      setCodexCompactionInFlight(targetThreadIds, false);
      targetThreadIds.forEach((targetThreadId) => {
        dispatch({
          type: "ensureThread",
          workspaceId,
          threadId: targetThreadId,
          engine: inferEngineFromThreadId(targetThreadId),
        });
        dispatch({
          type: "markContextCompacting",
          threadId: targetThreadId,
          isCompacting: false,
          timestamp,
        });
      });
      const message = reason
        ? t("threads.contextCompactionFailedWithMessage", { message: reason })
        : t("threads.contextCompactionFailed");
      const stabilityDiagnostic = reason
        ? resolveThreadStabilityDiagnostic(reason)
        : null;
      if (stabilityDiagnostic) {
        onDebug?.({
          id: `${Date.now()}-thread-stability-diagnostic`,
          timestamp: Date.now(),
          source: "event",
          label: "thread/stability diagnostic",
          payload: {
            workspaceId,
            threadId: targetThreadIds[0] ?? threadId,
            category: stabilityDiagnostic.category,
            rawMessage: stabilityDiagnostic.rawMessage,
            recoveryReason: stabilityDiagnostic.reconnectReason ?? null,
            stage: "context-compaction",
          },
        });
      }
      targetThreadIds.forEach((targetThreadId) => {
        pushThreadErrorMessage(workspaceId, targetThreadId, message);
      });
      pushThreadFailureRuntimeNotice({
        workspaceId,
        threadId: targetThreadIds[0] ?? threadId,
        engine: inferEngineFromThreadId(targetThreadIds[0] ?? threadId),
        message: reason || message,
      });
      safeMessageActivity();
    },
    [
      collectCompactionTargetThreadIds,
      dispatch,
      onDebug,
      pushThreadErrorMessage,
      safeMessageActivity,
      setCodexCompactionInFlight,
      t,
    ],
  );

  const onThreadSessionIdUpdated = useCallback(
    (
      workspaceId: string,
      threadId: string,
      sessionId: string,
      engineHint?: "claude" | "opencode" | "codex" | "gemini" | "grok" | "kimi" | null,
      turnId?: string | null,
    ) => {
      const explicitEnginePrefix = threadId.startsWith("claude:")
        || threadId.startsWith("claude-pending-")
        || isClaudeForkThreadId(threadId)
        ? "claude"
        : threadId.startsWith("gemini:")
          || threadId.startsWith("gemini-pending-")
          ? "gemini"
        : threadId.startsWith("grok:")
          || threadId.startsWith("grok-pending-")
          ? "grok"
        : threadId.startsWith("kimi:")
          || threadId.startsWith("kimi-pending-")
          ? "kimi"
        : threadId.startsWith("opencode:")
          || threadId.startsWith("opencode-pending-")
          ? "opencode"
          : null;
      const hintedEngine =
        engineHint === "claude" || engineHint === "gemini" || engineHint === "grok" || engineHint === "kimi" || engineHint === "opencode"
          ? engineHint
          : null;
      const pendingOpenCode = resolvePendingThreadForSession?.(workspaceId, "opencode") ?? null;
      const pendingGemini = resolvePendingThreadForSession?.(workspaceId, "gemini") ?? null;
      const pendingGrok = resolvePendingThreadForSession?.(workspaceId, "grok") ?? null;
      const pendingKimi = resolvePendingThreadForSession?.(workspaceId, "kimi") ?? null;
      const pendingClaude = resolvePendingThreadForSession?.(workspaceId, "claude") ?? null;
      logSessionTrace("event", {
        workspaceId,
        threadId,
        sessionId,
        engineHint: engineHint ?? null,
        turnId: turnId ?? null,
        explicitEnginePrefix,
        pendingOpenCode,
        pendingGemini,
        pendingGrok,
        pendingKimi,
        pendingClaude,
      });

      const enginePrefix =
        explicitEnginePrefix
        ?? hintedEngine
        ?? (pendingOpenCode && !pendingGemini && !pendingGrok && !pendingKimi && !pendingClaude
          ? "opencode"
          : pendingGemini && !pendingOpenCode && !pendingGrok && !pendingKimi && !pendingClaude
            ? "gemini"
          : pendingGrok && !pendingOpenCode && !pendingGemini && !pendingKimi && !pendingClaude
            ? "grok"
          : pendingKimi && !pendingOpenCode && !pendingGemini && !pendingGrok && !pendingClaude
            ? "kimi"
          : pendingClaude && !pendingOpenCode && !pendingGemini && !pendingGrok && !pendingKimi
            ? "claude"
            : null);
      if (!enginePrefix) {
        logSessionTrace("skip:no-engine-prefix", {
          workspaceId,
          threadId,
          sessionId,
          engineHint: engineHint ?? null,
          pendingOpenCode,
          pendingGemini,
          pendingGrok,
          pendingKimi,
          pendingClaude,
        });
        return;
      }

      const newThreadId = `${enginePrefix}:${sessionId}`;
      const turnBoundPendingThreadId =
        resolvePendingThreadForTurn?.(workspaceId, enginePrefix, turnId) ?? null;

      const sameEngineFinalizedPrefix = `${enginePrefix}:`;
      const hasAnyEnginePrefix =
        threadId.startsWith("claude:")
        || threadId.startsWith("claude-pending-")
        || isClaudeForkThreadId(threadId)
        || threadId.startsWith("gemini:")
        || threadId.startsWith("gemini-pending-")
        || threadId.startsWith("grok:")
        || threadId.startsWith("grok-pending-")
        || threadId.startsWith("kimi:")
        || threadId.startsWith("kimi-pending-")
        || threadId.startsWith("opencode:")
        || threadId.startsWith("opencode-pending-");
      const hasForeignEnginePrefix = (
        (enginePrefix !== "claude" && (threadId.startsWith("claude:") || threadId.startsWith("claude-pending-")))
        || (enginePrefix !== "gemini" && (threadId.startsWith("gemini:") || threadId.startsWith("gemini-pending-")))
        || (enginePrefix !== "grok" && (threadId.startsWith("grok:") || threadId.startsWith("grok-pending-")))
        || (enginePrefix !== "kimi" && (threadId.startsWith("kimi:") || threadId.startsWith("kimi-pending-")))
        || (enginePrefix !== "opencode" && (threadId.startsWith("opencode:") || threadId.startsWith("opencode-pending-")))
      );

      if (
        threadId.startsWith(sameEngineFinalizedPrefix)
        && threadId !== newThreadId
      ) {
        logSessionTrace("skip:finalized-mismatch", {
          workspaceId,
          threadId,
          newThreadId,
          enginePrefix,
          activeThreadId,
        });
        return;
      }

      // Claude re-announces its session id at the start of every turn, so an
      // established conversation keeps emitting finalized session-id updates
      // while it streams. Rebinding a pending thread onto such a target would
      // merge a brand-new session into an unrelated in-flight conversation
      // (its user bubble shows up in the old timeline), so the active-pending
      // fallbacks below must never fire when the target already has items.
      const newThreadIsEstablished =
        hasEstablishedThreadItems?.(newThreadId) ?? false;
      let sourceThreadId: string | null = null;
      if (threadId === newThreadId) {
        // Some runtimes emit session-id updates with finalized thread ids only.
        // Rebind conservatively: prefer an exact turn-bound pending match, and
        // otherwise only fall back to the active pending thread for the engine.
        const pendingThreadId = enginePrefix === "opencode"
          ? pendingOpenCode
          : enginePrefix === "gemini"
            ? pendingGemini
          : enginePrefix === "grok"
            ? pendingGrok
          : enginePrefix === "kimi"
            ? pendingKimi
            : pendingClaude;
        if (turnBoundPendingThreadId && turnBoundPendingThreadId !== newThreadId) {
          sourceThreadId = turnBoundPendingThreadId;
        } else if (
          !newThreadIsEstablished
          && isPendingThreadForEngine(enginePrefix, pendingThreadId)
          && (
            pendingThreadId === activeThreadId ||
            activeThreadId === newThreadId
          )
        ) {
          sourceThreadId = pendingThreadId;
        } else {
          logSessionTrace(
            newThreadIsEstablished
              ? "skip:established-target"
              : "skip:already-finalized",
            {
              workspaceId,
              threadId,
              newThreadId,
              enginePrefix,
              activeThreadId,
              pendingThreadId: pendingThreadId ?? null,
              turnBoundPendingThreadId,
              turnId: turnId ?? null,
            },
          );
          return;
        }
      } else if (isPendingThreadForEngine(enginePrefix, threadId)) {
        sourceThreadId = threadId;
      } else if (!hasAnyEnginePrefix && !hasForeignEnginePrefix) {
        const pendingThreadId = enginePrefix === "opencode"
          ? pendingOpenCode
          : enginePrefix === "gemini"
            ? pendingGemini
          : enginePrefix === "grok"
            ? pendingGrok
          : enginePrefix === "kimi"
            ? pendingKimi
          : pendingClaude;
        // Safety boundary: an exact engine+turn resolver result may be an
        // engine-prefixed pending id or a Product Home provisional UUID.
        // Workspace-level fallback still requires the conventional pending
        // prefix so active selection alone cannot steal another session.
        if (turnBoundPendingThreadId && turnBoundPendingThreadId !== newThreadId) {
          sourceThreadId = turnBoundPendingThreadId;
        } else if (
          !newThreadIsEstablished
          && isPendingThreadForEngine(enginePrefix, pendingThreadId)
          && (
            pendingThreadId === activeThreadId ||
            activeThreadId === newThreadId
          )
        ) {
          sourceThreadId = pendingThreadId;
        } else {
          logSessionTrace(
            newThreadIsEstablished
              ? "skip:established-target"
              : "skip:non-prefixed-not-active",
            {
              workspaceId,
              threadId,
              newThreadId,
              enginePrefix,
              pendingThreadId: pendingThreadId ?? null,
              turnBoundPendingThreadId,
              activeThreadId,
              turnId: turnId ?? null,
            },
          );
        }
      }

      if (!sourceThreadId || sourceThreadId === newThreadId) {
        logSessionTrace("skip:no-pending-source", {
          workspaceId,
          threadId,
          newThreadId,
          sourceThreadId,
          hasForeignEnginePrefix,
          enginePrefix,
          turnBoundPendingThreadId,
          turnId: turnId ?? null,
        });
        return;
      }

      logSessionTrace("rename", {
        workspaceId,
        oldThreadId: sourceThreadId,
        newThreadId,
        enginePrefix,
        eventThreadId: threadId,
        turnBoundPendingThreadId,
        turnId: turnId ?? null,
      });
      const { movedPendingInterrupt } = migrateThreadInterruptGuards(
        sourceThreadId,
        newThreadId,
      );
      // If the user interrupted during pending->finalized rebind and the target
      // thread already has an active turn id, execute interrupt immediately.
      if (movedPendingInterrupt) {
        const activeTurnId = getActiveTurnIdForThread?.(newThreadId) ?? null;
        if (activeTurnId) {
          workspaceScopedDelete(pendingInterruptsRef.current, workspaceId, newThreadId);
          void engineInterruptTurnService(
            workspaceId,
            activeTurnId,
            enginePrefix,
          ).catch(() => {
            void engineInterruptService(workspaceId).catch(() => {});
          });
        }
      }
      // Rename the thread from claude-pending-* to claude:{sessionId}
      dispatch({
        type: "renameThreadId",
        workspaceId,
        oldThreadId: sourceThreadId,
        newThreadId,
      });
      // A4 live-text 外部化：随迁通道条目，流式中改名后订阅（新 threadId）
      // 才能继续读到累计文本。
      renameLiveAssistantTextThread(sourceThreadId, newThreadId);
      renameCustomNameKey(workspaceId, sourceThreadId, newThreadId);
      renameAutoTitlePendingKey(workspaceId, sourceThreadId, newThreadId);
      renamePendingMemoryCaptureKey(sourceThreadId, newThreadId);
      void renameThreadTitleMapping(workspaceId, sourceThreadId, newThreadId);
    },
    [
      dispatch,
      logSessionTrace,
      renameAutoTitlePendingKey,
      renameCustomNameKey,
      renamePendingMemoryCaptureKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
      resolvePendingThreadForTurn,
      migrateThreadInterruptGuards,
      getActiveTurnIdForThread,
      hasEstablishedThreadItems,
      pendingInterruptsRef,
      activeThreadId,
    ],
  );

  return {
    onThreadStarted,
    onTurnStarted,
    onTurnCompleted,
    onTurnPlanUpdated,
    onThreadTokenUsageUpdated,
    onAccountRateLimitsUpdated,
    onTurnError,
    onTurnStalled,
    onContextCompacting,
    onContextCompacted,
    onContextCompactionFailed,
    onThreadSessionIdUpdated,
  };
}
