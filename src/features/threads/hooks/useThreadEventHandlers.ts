import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import {
  workspaceScopedDelete,
  workspaceScopedHas,
} from "./workspaceScopedMap";
import type {
  AppServerEvent,
  CollaborationModeBlockedRequest,
  CollaborationModeResolvedRequest,
  RequestUserInputRequest,
} from "../../../types";
import { useThreadApprovalEvents } from "./useThreadApprovalEvents";
import { useThreadItemEvents } from "./useThreadItemEvents";
import { isSalvageableTerminalAssistantComplete } from "../contracts/realtimeEventContract";
import { useThreadTurnEvents } from "./useThreadTurnEvents";
import { queryTurnReconciliationStatusWithTimeout } from "./threadReconciliationStatusQuery";
import { useThreadUserInputEvents } from "./useThreadUserInputEvents";
import { useThreadTurnSettlementReconciliation } from "./useThreadTurnSettlementReconciliation";
import { parseFirstPacketTimeoutSeconds } from "../utils/networkErrors";
import { buildThreadDebugCorrelation } from "../utils/threadDebugCorrelation";
import type {
  ConversationEngine,
  NormalizedThreadEvent,
} from "../contracts/conversationCurtainContracts";
import {
  buildThreadStreamCorrelationDimensions,
  completeThreadStreamTurn,
  noteThreadDeltaReceived,
  noteThreadTextIngressReceived,
  noteThreadTurnStarted,
  reportThreadUpstreamPending,
  type StreamIngressSource,
} from "../utils/streamLatencyDiagnostics";
import { buildCodexLivenessDiagnostic } from "../utils/codexConversationLiveness";
import { domainEventFactories } from "../domain-events";
import type { ThreadEventHandlersOptions } from "./threadEventHandlerTypes";
import type { TurnExecutionSnapshot } from "../../shared-session/target/types";
import { handleThreadAppServerEventDiagnostics } from "./threadAppServerEventDiagnostics";
import {
  TURN_FIRST_DELTA_WARNING_MS,
  TURN_STALL_WARNING_MS,
  applyActiveExecutionItemEvent,
  asString,
  buildAssistantSnapshotIngressKey,
  buildCodexTurnIdentityKey,
  cleanupThreadTransientState,
  createThreadLifecycleSnapshot,
  createTurnDiagnosticState,
  extractTurnIdFromRawItem,
  getCodexNoProgressTimeoutMs,
  sweepThreadTransientState,
  TRANSIENT_TURN_STATE_SWEEP_INTERVAL_MS,
  inferRawItemEngine,
  inferThreadEngine,
  isExecutionItemType,
  isRequestUserInputModeBlocked,
  isTurnDiagnosticVerboseEnabled,
  listActiveExecutionItemTypes,
  listDeferredCompletionBlockers,
  resolveAgentMessageSnapshotText,
  type CodexQuarantinedTurn,
  type DeferredCompletionFlushSource,
  type ThreadLifecycleSnapshot,
  type TurnDiagnosticState,
} from "./threadEventDiagnostics";
export { CODEX_EXECUTION_ACTIVE_NO_PROGRESS_STALL_MS, CODEX_TURN_NO_PROGRESS_STALL_MS } from "./threadEventDiagnostics";

export function useThreadEventHandlers({
  activeThreadId,
  dispatch,
  getCustomName,
  resolveCanonicalThreadId,
  resolveCollaborationUiMode,
  isAutoTitlePending,
  isThreadHidden,
  markProcessing,
  markReviewing,
  setActiveTurnId,
  codexCompactionInFlightByThreadRef,
  safeMessageActivity,
  recordThreadActivity,
  pushThreadErrorMessage,
  onDebug,
  onWorkspaceConnected,
  applyCollabThreadLinks,
  approvalAllowlistRef,
  pendingInterruptsRef,
  interruptedThreadsRef,
  renameCustomNameKey,
  renameAutoTitlePendingKey,
  renameThreadTitleMapping,
  resolveClaudeContinuationThreadId,
  resolvePendingThreadForSession,
  resolvePendingThreadForTurn,
  getActiveTurnIdForThread,
  hasEstablishedThreadItems,
  renamePendingMemoryCaptureKey,
  onAgentMessageCompletedExternal,
  onTurnCompletedExternal,
  onTurnTerminalExternal,
  onThreadTransientCleanupReady,
  onDurableRealtimeTurnSettlementReady,
  onCollaborationModeResolved,
  onExitPlanModeToolCompleted,
  domainEventController = null,
}: ThreadEventHandlersOptions) {
  const threadLifecycleSnapshotRef = useRef<Map<string, ThreadLifecycleSnapshot>>(new Map());
  const turnDiagnosticsRef = useRef<Map<string, TurnDiagnosticState>>(new Map());
  const turnFirstDeltaTimerRef = useRef<Map<string, number>>(new Map());
  const turnStallTimerRef = useRef<Map<string, number>>(new Map());
  const codexNoProgressTimerRef = useRef<Map<string, number>>(new Map());
  const reconciliationQueryInFlightRef = useRef<Set<string>>(new Set());
  const flushDeferredTurnCompletionRef = useRef<
    ((threadId: string, source: DeferredCompletionFlushSource) => void) | null
  >(null);
  const assistantSnapshotIngressLengthRef = useRef<Map<string, number>>(new Map());
  const quarantinedCodexTurnsRef = useRef<Map<string, CodexQuarantinedTurn>>(new Map());
  const cleanupThreadTransientRefs = useCallback(
    (workspaceId: string | null | undefined, threadId: string) =>
      cleanupThreadTransientState(
        {
          turnDiagnosticsRef,
          quarantinedCodexTurnsRef,
          assistantSnapshotIngressLengthRef,
        },
        workspaceId,
        threadId,
      ),
    [],
  );
  useEffect(() => {
    return onThreadTransientCleanupReady?.(cleanupThreadTransientRefs);
  }, [cleanupThreadTransientRefs, onThreadTransientCleanupReady]);
  const getThreadLifecycleSnapshot = useCallback((threadId: string) => {
    return (
      threadLifecycleSnapshotRef.current.get(threadId) ?? createThreadLifecycleSnapshot()
    );
  }, []);
  const emitTurnDiagnostic = useCallback(
    (
      label: string,
      payload: Record<string, unknown>,
      options?: { force?: boolean },
    ) => {
      if (!options?.force && !isTurnDiagnosticVerboseEnabled()) {
        return;
      }
      onDebug?.({
        id: `${Date.now()}-turn-diagnostic-${label}`,
        timestamp: Date.now(),
        source: "event",
        label: `thread/session:turn-diagnostic:${label}`,
        payload: buildThreadDebugCorrelation(
          {
            workspaceId:
              typeof payload.workspaceId === "string" ? payload.workspaceId : null,
            threadId:
              typeof payload.threadId === "string" ? payload.threadId : null,
            action: `turn-diagnostic:${label}`,
            diagnosticCategory:
              typeof payload.diagnosticCategory === "string"
                ? payload.diagnosticCategory
                : null,
          },
          payload,
        ),
      });
    },
    [onDebug],
  );
  const {
    emitForegroundSettlementDiagnostic,
    buildReconciliationQueryKey,
    terminalKindFromReconciliationStatus,
    settleForegroundTurnResidue,
    emitThreeEvidenceDryRunDiagnostic,
  } = useThreadTurnSettlementReconciliation({
    activeThreadId,
    dispatch,
    markProcessing,
    setActiveTurnId,
    threadLifecycleSnapshotRef,
    turnDiagnosticsRef,
    reconciliationQueryInFlightRef,
    getThreadLifecycleSnapshot,
    emitTurnDiagnostic,
  });

  const clearFirstDeltaTimer = useCallback((threadId: string) => {
    const timerId = turnFirstDeltaTimerRef.current.get(threadId);
    if (timerId === undefined) {
      return;
    }
    window.clearTimeout(timerId);
    turnFirstDeltaTimerRef.current.delete(threadId);
  }, []);

  const clearTurnStallTimer = useCallback((threadId: string) => {
    const timerId = turnStallTimerRef.current.get(threadId);
    if (timerId === undefined) {
      return;
    }
    window.clearTimeout(timerId);
    turnStallTimerRef.current.delete(threadId);
  }, []);

  const clearCodexNoProgressTimer = useCallback((threadId: string) => {
    const timerId = codexNoProgressTimerRef.current.get(threadId);
    if (timerId === undefined) {
      return;
    }
    window.clearTimeout(timerId);
    codexNoProgressTimerRef.current.delete(threadId);
  }, []);

  const markCodexNoProgressSuspected = useCallback(
    (threadId: string, diagnostic: TurnDiagnosticState, elapsedSinceProgressMs: number) => {
      if (diagnostic.noProgressSuspectedAt !== null) {
        return;
      }
      const now = Date.now();
      const timeoutMs = getCodexNoProgressTimeoutMs(diagnostic);
      const activeExecutionItemTypes = listActiveExecutionItemTypes(diagnostic);
      const lifecycle = getThreadLifecycleSnapshot(threadId);
      diagnostic.noProgressSuspectedAt = now;
      diagnostic.noProgressSuspectedSource = "frontend-no-progress-suspected";
      dispatch({
        type: "markCodexSilentSuspected",
        threadId,
        timestamp: now,
        source: "frontend-no-progress-suspected",
      });
      emitTurnDiagnostic("codex-no-progress-suspected", {
        ...buildCodexLivenessDiagnostic({
          workspaceId: diagnostic.workspaceId,
          threadId,
          stage: "suspected-silent",
          outcome: "recoverable",
          source: "frontend-no-progress-suspected",
          reason: "frontend observed no Codex progress before the watchdog window",
          turnId: diagnostic.turnId,
          lastEventAgeMs: elapsedSinceProgressMs,
        }),
        turnId: diagnostic.turnId,
        elapsedMs: Math.max(0, now - diagnostic.startedAt),
        elapsedSinceProgressMs,
        timeoutMs,
        lastProgressSource: diagnostic.lastProgressSource,
        progressSequence: diagnostic.progressSequence,
        activeExecutionItemCount: diagnostic.activeExecutionItems.size,
        activeExecutionItemTypes,
        isProcessing: lifecycle.isProcessing,
        activeTurnId: lifecycle.activeTurnId,
        diagnosticCategory: "codex-no-progress",
        terminal: false,
        quarantine: false,
        ...buildThreadStreamCorrelationDimensions(threadId),
      }, { force: true });
      emitThreeEvidenceDryRunDiagnostic({
        workspaceId: diagnostic.workspaceId,
        threadId,
        turnId: diagnostic.turnId,
        terminalKind: null,
        sourceMethod: "frontend-no-progress-suspected",
        lifecycle,
        diagnostic,
        handled: false,
        fallbackApplied: false,
      });
    },
    [dispatch, emitThreeEvidenceDryRunDiagnostic, emitTurnDiagnostic, getThreadLifecycleSnapshot],
  );

  const emitCodexNoProgressWatchdogDiagnostic = useCallback(
    (
      stage: "scheduled" | "fired" | "skipped",
      input: {
        workspaceId?: string | null;
        threadId: string;
        diagnostic: TurnDiagnosticState | null;
        reason?: string;
        timeoutMs?: number | null;
        elapsedSinceProgressMs?: number | null;
        delayMs?: number | null;
        lifecycle?: ThreadLifecycleSnapshot | null;
      },
    ) => {
      emitTurnDiagnostic(`codex-no-progress-watchdog-${stage}`, {
        workspaceId: input.workspaceId ?? input.diagnostic?.workspaceId ?? null,
        threadId: input.threadId,
        turnId: input.diagnostic?.turnId ?? null,
        diagnosticCategory: "codex-no-progress-watchdog",
        stage,
        reason: input.reason ?? null,
        timeoutMs: input.timeoutMs ?? null,
        elapsedSinceProgressMs: input.elapsedSinceProgressMs ?? null,
        delayMs: input.delayMs ?? null,
        lastProgressSource: input.diagnostic?.lastProgressSource ?? null,
        progressSequence: input.diagnostic?.progressSequence ?? null,
        activeExecutionItemCount:
          input.diagnostic?.activeExecutionItems.size ?? null,
        isProcessing: input.lifecycle?.isProcessing ?? null,
        activeTurnId: input.lifecycle?.activeTurnId ?? null,
        activeThreadId,
        ...buildThreadStreamCorrelationDimensions(input.threadId),
      }, stage === "scheduled" ? undefined : { force: true });
    },
    [activeThreadId, emitTurnDiagnostic],
  );

  const scheduleCodexNoProgressTimer = useCallback(
    (workspaceId: string | null, threadId: string) => {
      if (typeof window === "undefined" || inferThreadEngine(threadId) !== "codex") {
        return;
      }
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (!diagnostic) {
        emitCodexNoProgressWatchdogDiagnostic("skipped", {
          workspaceId,
          threadId,
          diagnostic: null,
          reason: "missing-diagnostic",
        });
        return;
      }
      clearCodexNoProgressTimer(threadId);
      const now = Date.now();
      const timeoutMs = getCodexNoProgressTimeoutMs(diagnostic);
      const elapsedSinceProgressMs = Math.max(0, now - diagnostic.lastProgressAt);
      const delayMs = Math.max(0, timeoutMs - elapsedSinceProgressMs);
      emitCodexNoProgressWatchdogDiagnostic("scheduled", {
        workspaceId: diagnostic.workspaceId,
        threadId,
        diagnostic,
        timeoutMs,
        elapsedSinceProgressMs,
        delayMs,
      });
      const timerId = window.setTimeout(() => {
        const latestDiagnostic = turnDiagnosticsRef.current.get(threadId);
        if (!latestDiagnostic) {
          emitCodexNoProgressWatchdogDiagnostic("skipped", {
            workspaceId: diagnostic?.workspaceId ?? null,
            threadId,
            diagnostic: null,
            reason: "missing-diagnostic",
          });
          return;
        }
        const now = Date.now();
        const elapsedSinceProgressMs = Math.max(0, now - latestDiagnostic.lastProgressAt);
        const timeoutMs = getCodexNoProgressTimeoutMs(latestDiagnostic);
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        emitCodexNoProgressWatchdogDiagnostic("fired", {
          workspaceId: diagnostic?.workspaceId ?? null,
          threadId,
          diagnostic: latestDiagnostic,
          timeoutMs,
          elapsedSinceProgressMs,
          lifecycle,
        });
        if (latestDiagnostic.completedAt !== null) {
          emitCodexNoProgressWatchdogDiagnostic("skipped", {
            workspaceId: diagnostic?.workspaceId ?? null,
            threadId,
            diagnostic: latestDiagnostic,
            reason: "completed",
            timeoutMs,
            elapsedSinceProgressMs,
          });
          return;
        }
        if (latestDiagnostic.errorAt !== null) {
          emitCodexNoProgressWatchdogDiagnostic("skipped", {
            workspaceId: diagnostic?.workspaceId ?? null,
            threadId,
            diagnostic: latestDiagnostic,
            reason: "error",
            timeoutMs,
            elapsedSinceProgressMs,
          });
          return;
        }
        if (workspaceScopedHas(interruptedThreadsRef.current, workspaceId ?? latestDiagnostic.workspaceId ?? null, threadId)) {
          const inferredEngine = inferThreadEngine(threadId);
          const correlationEngine =
            buildThreadStreamCorrelationDimensions(threadId).engine;
          const engineScopeMatches =
            correlationEngine === null || correlationEngine === inferredEngine;
          const turnScopeMatches =
            lifecycle.activeTurnId === latestDiagnostic.turnId ||
            lifecycle.activeTurnId === null;
          settleForegroundTurnResidue({
            workspaceId: latestDiagnostic.workspaceId,
            threadId,
            turnId: latestDiagnostic.turnId,
            engine: inferredEngine,
            lifecycle,
            source: "watchdog-interrupted",
            decisionAction: "cleanup-residue",
            decisionReason: "interrupted",
            scopeMatch: {
              matched: engineScopeMatches && turnScopeMatches,
              workspace: true,
              engine: engineScopeMatches,
              thread: true,
              turn: turnScopeMatches,
              foregroundOwner: true,
              runtimeLease: null,
            },
            acceptedEvidence: {
              terminal: true,
              state: lifecycle.isProcessing,
              progress: false,
              reconciliation: false,
            },
            boundedReason: "watchdog skipped because turn was interrupted",
            lastProgressAgeMs: elapsedSinceProgressMs,
            allowAbandonedActiveTurn: true,
          });
          emitCodexNoProgressWatchdogDiagnostic("skipped", {
            workspaceId: diagnostic?.workspaceId ?? null,
            threadId,
            diagnostic: latestDiagnostic,
            reason: "interrupted",
            timeoutMs,
            elapsedSinceProgressMs,
            lifecycle,
          });
          return;
        }
        if (!lifecycle.isProcessing) {
          emitCodexNoProgressWatchdogDiagnostic("skipped", {
            workspaceId: diagnostic?.workspaceId ?? null,
            threadId,
            diagnostic: latestDiagnostic,
            reason: "not-processing",
            timeoutMs,
            elapsedSinceProgressMs,
            lifecycle,
          });
          return;
        }
        if (
          lifecycle.activeTurnId !== null &&
          lifecycle.activeTurnId !== latestDiagnostic.turnId
        ) {
          emitCodexNoProgressWatchdogDiagnostic("skipped", {
            workspaceId: diagnostic?.workspaceId ?? null,
            threadId,
            diagnostic: latestDiagnostic,
            reason: "active-turn-mismatch",
            timeoutMs,
            elapsedSinceProgressMs,
            lifecycle,
          });
          return;
        }
        if (elapsedSinceProgressMs < timeoutMs) {
          emitCodexNoProgressWatchdogDiagnostic("skipped", {
            workspaceId: diagnostic?.workspaceId ?? null,
            threadId,
            diagnostic: latestDiagnostic,
            reason: "progress-still-fresh",
            timeoutMs,
            elapsedSinceProgressMs,
            lifecycle,
          });
          return;
        }
        markCodexNoProgressSuspected(
          threadId,
          latestDiagnostic,
          elapsedSinceProgressMs,
        );
      }, delayMs);
      codexNoProgressTimerRef.current.set(threadId, timerId);
    },
    [
      clearCodexNoProgressTimer,
      emitCodexNoProgressWatchdogDiagnostic,
      getThreadLifecycleSnapshot,
      interruptedThreadsRef,
      markCodexNoProgressSuspected,
      settleForegroundTurnResidue,
    ],
  );

  const noteCodexTurnProgressEvidence = useCallback(
    (workspaceId: string | null, threadId: string, source: string) => {
      if (inferThreadEngine(threadId) !== "codex" || workspaceScopedHas(interruptedThreadsRef.current, workspaceId, threadId)) {
        return;
      }
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (!diagnostic) {
        return;
      }
      const wasSuspected = diagnostic.noProgressSuspectedAt !== null;
      const suspectedDurationMs =
        diagnostic.noProgressSuspectedAt === null
          ? null
          : Math.max(0, Date.now() - diagnostic.noProgressSuspectedAt);
      diagnostic.lastProgressAt = Date.now();
      diagnostic.lastProgressSource = source;
      diagnostic.progressSequence += 1;
      diagnostic.noProgressSuspectedAt = null;
      diagnostic.noProgressSuspectedSource = null;
      if (wasSuspected) {
        dispatch({ type: "clearCodexSilentSuspected", threadId });
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        emitTurnDiagnostic("codex-no-progress-recovered", {
          ...buildCodexLivenessDiagnostic({
            workspaceId: diagnostic.workspaceId,
            threadId,
            stage: "active",
            outcome: "recovered",
            source,
            reason: "matching Codex progress arrived after frontend no-progress suspicion",
            turnId: diagnostic.turnId,
          }),
          turnId: diagnostic.turnId,
          progressSource: source,
          suspectedDurationMs,
          progressSequence: diagnostic.progressSequence,
          isProcessing: lifecycle.isProcessing,
          activeTurnId: lifecycle.activeTurnId,
          diagnosticCategory: "codex-no-progress",
          ...buildThreadStreamCorrelationDimensions(threadId),
        }, { force: true });
      }
      scheduleCodexNoProgressTimer(workspaceId, threadId);
    },
    [
      emitTurnDiagnostic,
      dispatch,
      getThreadLifecycleSnapshot,
      interruptedThreadsRef,
      scheduleCodexNoProgressTimer,
    ],
  );

  const scheduleFirstDeltaTimer = useCallback(
    (workspaceId: string | null, threadId: string) => {
      if (typeof window === "undefined") {
        return;
      }
      clearFirstDeltaTimer(threadId);
      const timerId = window.setTimeout(() => {
        if (workspaceScopedHas(interruptedThreadsRef.current, workspaceId, threadId)) {
          return;
        }
        const diagnostic = turnDiagnosticsRef.current.get(threadId);
        if (!diagnostic || diagnostic.firstDeltaAt !== null) {
          return;
        }
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        const now = Date.now();
        const elapsedMs = Math.max(0, now - diagnostic.startedAt);
        reportThreadUpstreamPending(threadId, {
          elapsedMs,
          diagnosticCategory: "first-token-delay",
          reason: "waiting-for-first-delta",
        });
        emitTurnDiagnostic("waiting-for-first-delta", {
          workspaceId: diagnostic.workspaceId,
          threadId: diagnostic.threadId,
          turnId: diagnostic.turnId,
          elapsedMs,
          isProcessing: lifecycle.isProcessing,
          activeTurnId: lifecycle.activeTurnId,
          diagnosticCategory: "first-token-delay",
          ...buildThreadStreamCorrelationDimensions(threadId),
        }, { force: true });
      }, TURN_FIRST_DELTA_WARNING_MS);
      turnFirstDeltaTimerRef.current.set(threadId, timerId);
    },
    [clearFirstDeltaTimer, emitTurnDiagnostic, getThreadLifecycleSnapshot, interruptedThreadsRef],
  );

  const scheduleTurnStallTimer = useCallback(
    (threadId: string) => {
      if (typeof window === "undefined") {
        return;
      }
      clearTurnStallTimer(threadId);
      const timerId = window.setTimeout(() => {
        const diagnostic = turnDiagnosticsRef.current.get(threadId);
        if (!diagnostic || diagnostic.stallReported || diagnostic.firstExecutionAt !== null) {
          return;
        }
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        const now = Date.now();
        diagnostic.stallReported = true;
        emitTurnDiagnostic("stalled-after-first-delta", {
          workspaceId: diagnostic.workspaceId,
          threadId: diagnostic.threadId,
          turnId: diagnostic.turnId,
          elapsedMs: Math.max(0, now - diagnostic.startedAt),
          deltaSinceMs:
            diagnostic.firstDeltaAt === null ? null : Math.max(0, now - diagnostic.firstDeltaAt),
          itemEventCount: diagnostic.itemEventCount,
          firstItemEventKind: diagnostic.firstItemEventKind,
          firstItemType: diagnostic.firstItemType,
          hasExecutionItem: false,
          isProcessing: lifecycle.isProcessing,
          activeTurnId: lifecycle.activeTurnId,
          ...buildThreadStreamCorrelationDimensions(threadId),
        }, { force: true });
      }, TURN_STALL_WARNING_MS);
      turnStallTimerRef.current.set(threadId, timerId);
    },
    [clearTurnStallTimer, emitTurnDiagnostic, getThreadLifecycleSnapshot],
  );

  const noteNonTextRuntimeProgress = useCallback(
    (
      threadId: string,
      source: string,
      evidence: {
        itemType?: string | null;
        itemId?: string | null;
        itemEventKind?: "started" | "updated" | "completed" | "output-delta" | null;
        outputLength?: number | null;
      } = {},
    ) => {
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (!diagnostic || diagnostic.completedAt !== null || diagnostic.errorAt !== null) {
        return;
      }
      const now = Date.now();
      diagnostic.lastProgressAt = now;
      diagnostic.lastProgressSource = source;
      diagnostic.progressSequence += 1;
      if (diagnostic.firstDeltaAt === null) {
        clearFirstDeltaTimer(threadId);
      }
      const lifecycle = getThreadLifecycleSnapshot(threadId);
      emitTurnDiagnostic("non-text-runtime-progress", {
        workspaceId: diagnostic.workspaceId,
        threadId,
        turnId: diagnostic.turnId,
        source,
        itemType: evidence.itemType ?? null,
        itemId: evidence.itemId ?? null,
        itemEventKind: evidence.itemEventKind ?? null,
        outputLength: evidence.outputLength ?? null,
        elapsedMs: Math.max(0, now - diagnostic.startedAt),
        firstDeltaSeen: diagnostic.firstDeltaAt !== null,
        progressSequence: diagnostic.progressSequence,
        isProcessing: lifecycle.isProcessing,
        activeTurnId: lifecycle.activeTurnId,
        diagnosticCategory: "non-text-runtime-progress",
        ...buildThreadStreamCorrelationDimensions(threadId),
      });
    },
    [clearFirstDeltaTimer, emitTurnDiagnostic, getThreadLifecycleSnapshot],
  );

  const clearAssistantSnapshotIngressForThread = useCallback((threadId: string) => {
    const prefix = `${threadId}\u0000`;
    assistantSnapshotIngressLengthRef.current.forEach((_value, key) => {
      if (key.startsWith(prefix)) {
        assistantSnapshotIngressLengthRef.current.delete(key);
      }
    });
  }, []);

  const quarantineCodexTurn = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
      reason: string,
      source: string,
      engineHint?: ConversationEngine | null,
    ) => {
      const normalizedTurnId = turnId.trim();
      const engine = engineHint ?? inferThreadEngine(threadId);
      if (engine !== "codex" || !normalizedTurnId) {
        return;
      }
      const key = buildCodexTurnIdentityKey(threadId, normalizedTurnId);
      if (quarantinedCodexTurnsRef.current.has(key)) {
        return;
      }
      quarantinedCodexTurnsRef.current.set(key, {
        workspaceId,
        threadId,
        turnId: normalizedTurnId,
        settledAt: Date.now(),
        reason,
        source,
      });
    },
    [],
  );

  const findQuarantinedCodexTurn = useCallback(
    (threadId: string, turnId?: string | null) => {
      const normalizedThreadId = threadId.trim();
      if (!normalizedThreadId) {
        return null;
      }
      const normalizedTurnId = turnId?.trim() ?? "";
      if (normalizedTurnId) {
        return (
          quarantinedCodexTurnsRef.current.get(
            buildCodexTurnIdentityKey(normalizedThreadId, normalizedTurnId),
          ) ?? null
        );
      }
      for (const quarantinedTurn of quarantinedCodexTurnsRef.current.values()) {
        if (quarantinedTurn.threadId === normalizedThreadId) {
          return quarantinedTurn;
        }
      }
      return null;
    },
    [],
  );

  const shouldSkipCodexTurnEvent = useCallback(
    (input: {
      engine: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode";
      workspaceId: string;
      threadId: string;
      turnId: string;
      operation: string;
      sourceMethod: string;
    }) => {
      if (input.engine !== "codex") {
        return false;
      }
      const eventTurnId = input.turnId.trim();
      if (!eventTurnId) {
        const lifecycle = getThreadLifecycleSnapshot(input.threadId);
        const activeQuarantinedTurn = lifecycle.activeTurnId
          ? findQuarantinedCodexTurn(input.threadId, lifecycle.activeTurnId)
          : null;
        const settledTurnWithoutSuccessor =
          lifecycle.activeTurnId === null && !lifecycle.isProcessing
            ? findQuarantinedCodexTurn(input.threadId)
            : null;
        const quarantinedTurn = activeQuarantinedTurn ?? settledTurnWithoutSuccessor;
        if (!quarantinedTurn) {
          return false;
        }
        emitTurnDiagnostic("quarantined-codex-event-skipped", {
          ...buildCodexLivenessDiagnostic({
            workspaceId: input.workspaceId,
            threadId: input.threadId,
            stage: "abandoned",
            outcome: "abandoned",
            source: input.sourceMethod,
            reason:
              "turnless event follows a quarantined Codex turn without a verified successor",
            turnId: quarantinedTurn.turnId,
          }),
          eventTurnId: null,
          activeTurnId: lifecycle.activeTurnId,
          isProcessing: lifecycle.isProcessing,
          quarantinedAtMs: quarantinedTurn.settledAt,
          quarantineReason: quarantinedTurn.reason,
          quarantineSource: quarantinedTurn.source,
          operation: input.operation,
          sourceMethod: input.sourceMethod,
          diagnosticCategory: "quarantined-codex-event",
        }, { force: true });
        return true;
      }
      const quarantineKey = buildCodexTurnIdentityKey(input.threadId, eventTurnId);
      const quarantinedTurn = quarantinedCodexTurnsRef.current.get(quarantineKey);
      if (quarantinedTurn) {
        emitTurnDiagnostic("quarantined-codex-event-skipped", {
          ...buildCodexLivenessDiagnostic({
            workspaceId: input.workspaceId,
            threadId: input.threadId,
            stage: "abandoned",
            outcome: "abandoned",
            source: input.sourceMethod,
            reason: "event belongs to a quarantined Codex turn",
            turnId: eventTurnId,
          }),
          eventTurnId,
          quarantinedAtMs: quarantinedTurn.settledAt,
          quarantineReason: quarantinedTurn.reason,
          quarantineSource: quarantinedTurn.source,
          operation: input.operation,
          sourceMethod: input.sourceMethod,
          diagnosticCategory: "quarantined-codex-event",
        }, { force: true });
        return true;
      }
      const diagnosticTurnId = turnDiagnosticsRef.current.get(input.threadId)?.turnId ?? null;
      const activeTurnId = getThreadLifecycleSnapshot(input.threadId).activeTurnId;
      const expectedTurnId = diagnosticTurnId ?? activeTurnId;
      if (!expectedTurnId || expectedTurnId === eventTurnId) {
        return false;
      }
      emitTurnDiagnostic("late-codex-event-skipped", {
        ...buildCodexLivenessDiagnostic({
          workspaceId: input.workspaceId,
          threadId: input.threadId,
          stage: "abandoned",
          outcome: "abandoned",
          source: input.sourceMethod,
          reason: "event turn id does not match active Codex turn",
          turnId: eventTurnId,
        }),
        eventTurnId,
        activeTurnId,
        expectedTurnId,
        operation: input.operation,
        sourceMethod: input.sourceMethod,
        diagnosticCategory: "late-codex-event",
      }, { force: true });
      return true;
    },
    [emitTurnDiagnostic, findQuarantinedCodexTurn, getThreadLifecycleSnapshot],
  );

  const resolveTerminalSettlementTurnId = useCallback(
    (threadId: string, incomingTurnId: string) => {
      const normalizedTurnId = incomingTurnId.trim();
      if (normalizedTurnId) {
        return normalizedTurnId;
      }
      return (
        getThreadLifecycleSnapshot(threadId).activeTurnId ??
        turnDiagnosticsRef.current.get(threadId)?.turnId ??
        ""
      );
    },
    [getThreadLifecycleSnapshot],
  );

  const markProcessingTracked = useCallback(
    (threadId: string, isProcessing: boolean) => {
      const previous =
        threadLifecycleSnapshotRef.current.get(threadId) ?? createThreadLifecycleSnapshot();
      threadLifecycleSnapshotRef.current.set(threadId, {
        ...previous,
        isProcessing,
      });
      markProcessing(threadId, isProcessing);
    },
    [markProcessing],
  );

  const setActiveTurnIdTracked = useCallback(
    (threadId: string, turnId: string | null) => {
      const previous =
        threadLifecycleSnapshotRef.current.get(threadId) ?? createThreadLifecycleSnapshot();
      threadLifecycleSnapshotRef.current.set(threadId, {
        ...previous,
        activeTurnId: turnId,
      });
      setActiveTurnId(threadId, turnId);
    },
    [setActiveTurnId],
  );

  const captureTurnItemDiagnostic = useCallback(
    (
      workspaceId: string | null,
      threadId: string,
      kind: "started" | "updated" | "completed",
      item: Record<string, unknown>,
    ) => {
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (!diagnostic) {
        return;
      }
      diagnostic.itemEventCount += 1;
      const itemType = asString(item.type).trim() || null;
      const itemId = asString(item.id).trim() || null;
      const now = Date.now();
      if (diagnostic.firstItemEventAt === null) {
        diagnostic.firstItemEventAt = now;
        diagnostic.firstItemEventKind = kind;
        diagnostic.firstItemType = itemType;
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        emitTurnDiagnostic("first-item", {
          workspaceId: diagnostic.workspaceId,
          threadId,
          turnId: diagnostic.turnId,
          itemEventKind: kind,
          itemType,
          itemId,
          elapsedMs: Math.max(0, now - diagnostic.startedAt),
          deltaSeen: diagnostic.firstDeltaAt !== null,
          isProcessing: lifecycle.isProcessing,
          activeTurnId: lifecycle.activeTurnId,
          ...buildThreadStreamCorrelationDimensions(threadId),
        });
      }
      if (isExecutionItemType(itemType)) {
        noteNonTextRuntimeProgress(threadId, `execution-item-${kind}`, {
          itemType,
          itemId,
          itemEventKind: kind,
        });
        if (diagnostic.firstExecutionAt === null) {
          diagnostic.firstExecutionAt = now;
          diagnostic.firstExecutionEventKind = kind;
          diagnostic.firstExecutionItemType = itemType;
          diagnostic.firstExecutionItemId = itemId;
          clearTurnStallTimer(threadId);
          const lifecycle = getThreadLifecycleSnapshot(threadId);
          emitTurnDiagnostic("first-execution-item", {
            workspaceId: diagnostic.workspaceId,
            threadId,
            turnId: diagnostic.turnId,
            itemEventKind: kind,
            itemType,
            itemId,
            elapsedMs: Math.max(0, now - diagnostic.startedAt),
            deltaSinceMs:
              diagnostic.firstDeltaAt === null ? null : Math.max(0, now - diagnostic.firstDeltaAt),
            isProcessing: lifecycle.isProcessing,
            activeTurnId: lifecycle.activeTurnId,
            ...buildThreadStreamCorrelationDimensions(threadId),
          });
        }
      }
      if (applyActiveExecutionItemEvent(diagnostic, kind, itemType, itemId, item, now)) {
        scheduleCodexNoProgressTimer(workspaceId, threadId);
      }
    },
    [
      clearTurnStallTimer,
      emitTurnDiagnostic,
      getThreadLifecycleSnapshot,
      noteNonTextRuntimeProgress,
      scheduleCodexNoProgressTimer,
    ],
  );

  const recordAssistantCompletionEvidence = useCallback(
    (threadId: string, itemId: string) => {
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (!diagnostic) {
        return;
      }
      diagnostic.assistantCompletedAt = Date.now();
      diagnostic.assistantCompletedItemId = itemId || null;
    },
    [],
  );

  const recordAssistantStreamIngress = useCallback(
    (payload: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      textLength: number;
      source: StreamIngressSource;
    }) => {
      if (workspaceScopedHas(interruptedThreadsRef.current, payload.workspaceId, payload.threadId)) {
        return;
      }
      const diagnostic = turnDiagnosticsRef.current.get(payload.threadId);
      if (!diagnostic) {
        return;
      }
      const deltaTimestamp = Date.now();
      const source = payload.source;
      const isDeltaIngress = source === "delta" || source === "snapshot";
      if (isDeltaIngress) {
        noteThreadDeltaReceived(payload.threadId, deltaTimestamp, {
          source,
          itemId: payload.itemId,
          textLength: payload.textLength,
        });
        diagnostic.deltaCount += 1;
      } else {
        noteThreadTextIngressReceived(payload.threadId, {
          source: payload.source,
          itemId: payload.itemId,
          textLength: payload.textLength,
          timestamp: deltaTimestamp,
        });
      }
      if (!isDeltaIngress) {
        return;
      }
      if (diagnostic.firstDeltaAt !== null) {
        return;
      }
      diagnostic.firstDeltaAt = deltaTimestamp;
      clearFirstDeltaTimer(payload.threadId);
      scheduleTurnStallTimer(payload.threadId);
      const lifecycle = getThreadLifecycleSnapshot(payload.threadId);
      emitTurnDiagnostic("first-delta", {
        workspaceId: payload.workspaceId,
        threadId: payload.threadId,
        turnId: diagnostic.turnId,
        itemId: payload.itemId,
        deltaLength: payload.textLength,
        ingressSource: payload.source,
        elapsedMs: Math.max(0, diagnostic.firstDeltaAt - diagnostic.startedAt),
        isProcessing: lifecycle.isProcessing,
        activeTurnId: lifecycle.activeTurnId,
        ...buildThreadStreamCorrelationDimensions(payload.threadId),
      });
    },
    [
      clearFirstDeltaTimer,
      emitTurnDiagnostic,
      getThreadLifecycleSnapshot,
      interruptedThreadsRef,
      scheduleTurnStallTimer,
    ],
  );

  const maybeRecordAgentMessageSnapshotIngress = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      const itemType = asString(item.type).trim();
      if (itemType !== "agentMessage") {
        return;
      }
      const text = resolveAgentMessageSnapshotText(item);
      if (!text.trim()) {
        return;
      }
      const itemId = asString(item.id).trim();
      const ingressKey = buildAssistantSnapshotIngressKey(threadId, itemId);
      const previousLength =
        assistantSnapshotIngressLengthRef.current.get(ingressKey) ?? 0;
      const nextLength = text.length;
      if (nextLength <= previousLength) {
        return;
      }
      assistantSnapshotIngressLengthRef.current.set(ingressKey, nextLength);
      recordAssistantStreamIngress({
        workspaceId,
        threadId,
        itemId,
        textLength: nextLength,
        source: "snapshot",
      });
    },
    [recordAssistantStreamIngress],
  );

  useEffect(() => {
    const firstDeltaTimers = turnFirstDeltaTimerRef.current;
    const stallTimers = turnStallTimerRef.current;
    const codexNoProgressTimers = codexNoProgressTimerRef.current;
    const assistantSnapshotIngressLength = assistantSnapshotIngressLengthRef.current;
    const quarantinedCodexTurns = quarantinedCodexTurnsRef.current;
    const reconciliationQueryInFlight = reconciliationQueryInFlightRef.current;
    return () => {
      firstDeltaTimers.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      firstDeltaTimers.clear();
      stallTimers.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      stallTimers.clear();
      codexNoProgressTimers.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      codexNoProgressTimers.clear();
      assistantSnapshotIngressLength.clear();
      quarantinedCodexTurns.clear();
      reconciliationQueryInFlight.clear();
    };
  }, []);

  // chat-stream-render-isolation-2026-06 task 8.4: 60s interval sweep
  // over turnDiagnosticsRef / quarantinedCodexTurnsRef. Active turns (no
  // settled timestamp) are never evicted; settled entries expire 30min after
  // their settledAt. See design.md §4 and sweepThreadTransientState in
  // threadEventDiagnostics.ts.
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      const diagnosticEntries = Array.from(
        turnDiagnosticsRef.current.entries(),
      ).map(([threadId, state]) => ({
        threadId,
        settledAt:
          state.completedAt ?? state.errorAt ?? state.assistantCompletedAt,
      }));
      const diagnosticSweep = sweepThreadTransientState(
        diagnosticEntries,
        now,
      );
      for (const threadId of diagnosticSweep.expiredThreadIds) {
        const workspaceId =
          turnDiagnosticsRef.current.get(threadId)?.workspaceId ?? null;
        cleanupThreadTransientRefs(workspaceId, threadId);
      }
      const quarantineEntries = Array.from(
        quarantinedCodexTurnsRef.current.entries(),
      ).map(([quarantineKey, entry]) => ({
        threadId: quarantineKey,
        settledAt: entry.settledAt,
      }));
      const quarantineSweep = sweepThreadTransientState(
        quarantineEntries,
        now,
      );
      for (const quarantineKey of quarantineSweep.expiredThreadIds) {
        quarantinedCodexTurnsRef.current.delete(quarantineKey);
      }
    }, TRANSIENT_TURN_STATE_SWEEP_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [cleanupThreadTransientRefs]);

  const onApprovalRequest = useThreadApprovalEvents({
    dispatch,
    approvalAllowlistRef,
    markProcessing: markProcessingTracked,
    setActiveTurnId: setActiveTurnIdTracked,
    resolveClaudeContinuationThreadId,
  });
  const enqueueUserInputRequest = useThreadUserInputEvents({
    dispatch,
    resolveClaudeContinuationThreadId,
  });
  const settleThreadWaitingForUserChoice = useCallback(
    (threadId: string) => {
      if (!threadId) {
        return;
      }
      // User-choice gates are no longer normal foreground processing.
      markProcessingTracked(threadId, false);
      setActiveTurnIdTracked(threadId, null);
      dispatch({
        type: "settleThreadPlanInProgress",
        threadId,
        targetStatus: "pending",
      });
    },
    [dispatch, markProcessingTracked, setActiveTurnIdTracked],
  );
  const onRequestUserInput = useCallback(
    (request: RequestUserInputRequest) => {
      enqueueUserInputRequest(request);
      const threadId =
        request.shared_runtime_owner?.sharedThreadId ??
        resolveClaudeContinuationThreadId?.(
          request.workspace_id,
          request.params.thread_id,
          request.params.turn_id,
        ) ??
        request.params.thread_id;
      if (!threadId) {
        return;
      }
      settleThreadWaitingForUserChoice(threadId);
    },
    [
      enqueueUserInputRequest,
      resolveClaudeContinuationThreadId,
      settleThreadWaitingForUserChoice,
    ],
  );
  const onModeBlocked = useCallback(
    (event: CollaborationModeBlockedRequest) => {
      const rawThreadId = event.params.thread_id;
      const threadId =
        event.shared_runtime_owner?.sharedThreadId ??
        resolveClaudeContinuationThreadId?.(event.workspace_id, rawThreadId) ??
        rawThreadId;
      if (!threadId) {
        return;
      }
      const requestUserInputBlocked = isRequestUserInputModeBlocked(event);
      const requestId = event.params.request_id;
      if (requestId !== null && requestId !== undefined) {
        dispatch({
          type: "removeUserInputRequest",
          requestId,
          workspaceId: event.workspace_id,
          ...(event.shared_runtime_owner
            ? { sharedRuntimeOwner: event.shared_runtime_owner }
            : {}),
        });
      }
      if (requestUserInputBlocked) {
        settleThreadWaitingForUserChoice(threadId);
      }
      const reason =
        event.params.reason.trim() ||
        "This request is blocked while effective mode is code.";
      const suggestion =
        (event.params.suggestion ?? "").trim() ||
        "Switch to Plan mode and retry if user input is required.";
      const blockedMethod = asString(event.params.blocked_method).trim();
      const blockedDetail = blockedMethod || (
        requestUserInputBlocked ? "item/tool/requestUserInput" : "modeBlocked"
      );
      const blockedTitle = requestUserInputBlocked
        ? "Tool: askuserquestion"
        : "Tool: mode policy";
      const eventId = requestId !== null && requestId !== undefined
        ? String(requestId)
        : `${Date.now()}`;
      dispatch({
        type: "upsertItem",
        workspaceId: event.workspace_id,
        threadId,
        item: {
          id: `mode-blocked-${threadId}-${eventId}`,
          kind: "tool",
          toolType: "modeBlocked",
          title: blockedTitle,
          detail: blockedDetail,
          status: "completed",
          output: `${reason}\n\n${suggestion}`,
        },
        hasCustomName: Boolean(getCustomName(event.workspace_id, threadId)),
      });
    },
    [dispatch, getCustomName, resolveClaudeContinuationThreadId, settleThreadWaitingForUserChoice],
  );

  const onModeResolved = useCallback(
    (event: CollaborationModeResolvedRequest) => {
      onCollaborationModeResolved?.(event);
    },
    [onCollaborationModeResolved],
  );

  const {
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
    flushPendingRealtimeEvents,
    isRealtimeTurnTerminalExact,
    noteRealtimeTurnStarted,
    markRealtimeTurnTerminal,
  } = useThreadItemEvents({
    activeThreadId,
    dispatch,
    resolveCanonicalThreadId,
    getCustomName,
    resolveCollaborationUiMode,
    markProcessing: markProcessingTracked,
    markReviewing,
    safeMessageActivity,
    recordThreadActivity,
    applyCollabThreadLinks,
    interruptedThreadsRef,
    onDebug,
    onAgentMessageCompletedExternal,
    onExitPlanModeToolCompleted,
  });

  const settleDurableRealtimeTurn = useCallback(
    (threadId: string, runtimeTurnId: string) => {
      const normalizedThreadId = threadId.trim();
      const normalizedRuntimeTurnId = runtimeTurnId.trim();
      if (!normalizedThreadId || !normalizedRuntimeTurnId) {
        return;
      }
      // Durable Shared commit 是 control authority。先收敛已排队内容，再建立
      // exact-turn barrier，后续迟到 event 只能被丢弃，不能复燃 processing。
      flushPendingRealtimeEvents();
      markRealtimeTurnTerminal(normalizedThreadId, normalizedRuntimeTurnId);
      onDebug?.({
        id: `${Date.now()}-shared-durable-terminal-barrier-installed`,
        timestamp: Date.now(),
        source: "event",
        label: "thread/session:shared-durable-terminal-barrier-installed",
        payload: {
          threadId: normalizedThreadId,
          runtimeTurnId: normalizedRuntimeTurnId,
        },
      });
    },
    [flushPendingRealtimeEvents, markRealtimeTurnTerminal, onDebug],
  );
  useLayoutEffect(() => {
    return onDurableRealtimeTurnSettlementReady?.(settleDurableRealtimeTurn);
  }, [
    onDurableRealtimeTurnSettlementReady,
    settleDurableRealtimeTurn,
  ]);

  const {
    onThreadStarted,
    onTurnStarted,
    onTurnCompleted,
    onTurnPlanUpdated,
    onThreadTokenUsageUpdated: onThreadTokenUsageUpdatedBase,
    onAccountRateLimitsUpdated,
    onTurnError,
    onTurnStalled,
    onContextCompacting,
    onContextCompacted,
    onContextCompactionFailed,
    onThreadSessionIdUpdated,
  } = useThreadTurnEvents({
    activeThreadId,
    dispatch,
    getCustomName,
    resolveCanonicalThreadId,
    isAutoTitlePending,
    isThreadHidden,
    markProcessing: markProcessingTracked,
    markReviewing,
    setActiveTurnId: setActiveTurnIdTracked,
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
  });

  const onThreadTokenUsageUpdatedTracked = useCallback(
    (workspaceId: string, threadId: string, tokenUsage: Record<string, unknown>) => {
      onThreadTokenUsageUpdatedBase(workspaceId, threadId, tokenUsage);
      noteCodexTurnProgressEvidence(workspaceId, threadId, "thread-token-usage");
    },
    [noteCodexTurnProgressEvidence, onThreadTokenUsageUpdatedBase],
  );

  const onBackgroundThreadAction = useCallback(
    (workspaceId: string, threadId: string, action: string) => {
      if (action !== "hide") {
        return;
      }
      dispatch({ type: "hideThread", workspaceId, threadId });
    },
    [dispatch],
  );

  const onProcessingHeartbeat = useCallback(
    (_workspaceId: string, threadId: string, pulse: number) => {
      if (!threadId || pulse <= 0) {
        return;
      }
      dispatch({ type: "markHeartbeat", threadId, pulse });
      dispatch({ type: "markContinuationEvidence", threadId, at: Date.now() });
      noteCodexTurnProgressEvidence(_workspaceId, threadId, "processing-heartbeat");
      safeMessageActivity();
    },
    [dispatch, noteCodexTurnProgressEvidence, safeMessageActivity],
  );

  const emitTurnDomainEvent = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
      status: "completed" | "failed",
      payload?: { durationMs?: number | null; errorMessage?: string },
    ) => {
      if (!domainEventController || !turnId.trim()) {
        return;
      }
      const common = {
        occurredAt: new Date().toISOString(),
        workspaceId,
        sessionId: threadId,
        logicalSessionId: threadId,
        runId: turnId,
        engine: inferThreadEngine(threadId),
        engineId: inferThreadEngine(threadId),
        provenance: {
          source: "frontend-compatibility-sink",
          rawEventType: status === "completed" ? "turn/completed" : "turn/error",
        },
        turnId,
      };
      domainEventController.emitInternal(
        status === "completed"
          ? domainEventFactories.turnCompleted({
              ...common,
              durationMs: payload?.durationMs ?? null,
            })
          : domainEventFactories.turnFailed({
              ...common,
              errorMessage: payload?.errorMessage ?? "turn failed",
            }),
      );
      domainEventController.emitInternal(
        domainEventFactories.runSettled({
          ...common,
          status,
          evidence: payload ?? {},
        }),
      );
    },
    [domainEventController],
  );

  const onTurnStartedTracked = useCallback(
    (workspaceId: string, threadId: string, turnId: string) => {
      const normalizedTurnId = turnId.trim();
      if (inferThreadEngine(threadId) === "codex" && normalizedTurnId) {
        const quarantinedTurn = findQuarantinedCodexTurn(threadId, normalizedTurnId);
        if (quarantinedTurn) {
          emitTurnDiagnostic("quarantined-codex-event-skipped", {
            ...buildCodexLivenessDiagnostic({
              workspaceId,
              threadId,
              stage: "abandoned",
              outcome: "abandoned",
              source: "turn/started",
              reason: "turn/started belongs to a quarantined Codex turn",
              turnId: normalizedTurnId,
            }),
            eventTurnId: normalizedTurnId,
            quarantinedAtMs: quarantinedTurn.settledAt,
            quarantineReason: quarantinedTurn.reason,
            quarantineSource: quarantinedTurn.source,
            operation: "turnStarted",
            sourceMethod: "turn/started",
            diagnosticCategory: "quarantined-codex-event",
          }, { force: true });
          return;
        }
      }
      const startedAt = Date.now();
      noteRealtimeTurnStarted(threadId, turnId);
      clearAssistantSnapshotIngressForThread(threadId);
      noteThreadTurnStarted({
        workspaceId,
        threadId,
        turnId,
        startedAt,
      });
      clearTurnStallTimer(threadId);
      clearFirstDeltaTimer(threadId);
      turnDiagnosticsRef.current.set(
        threadId,
        createTurnDiagnosticState(workspaceId, threadId, turnId, startedAt),
      );
      dispatch({ type: "clearCodexSilentSuspected", threadId });
      scheduleFirstDeltaTimer(workspaceId, threadId);
      scheduleCodexNoProgressTimer(workspaceId, threadId);
      onTurnStarted(workspaceId, threadId, turnId);
      dispatch({ type: "markContinuationEvidence", threadId, at: Date.now(), force: true });
      const lifecycle = getThreadLifecycleSnapshot(threadId);
      emitTurnDiagnostic("started", {
        workspaceId,
        threadId,
        turnId,
        isProcessing: lifecycle.isProcessing,
        activeTurnId: lifecycle.activeTurnId,
        ...buildThreadStreamCorrelationDimensions(threadId),
      });
    },
    [
      clearFirstDeltaTimer,
      clearTurnStallTimer,
      dispatch,
      emitTurnDiagnostic,
      getThreadLifecycleSnapshot,
      onTurnStarted,
      noteRealtimeTurnStarted,
      scheduleCodexNoProgressTimer,
      scheduleFirstDeltaTimer,
      clearAssistantSnapshotIngressForThread,
      findQuarantinedCodexTurn,
    ],
  );

  const onSharedRuntimeTurnStarted = useCallback(
    (threadId: string, runtimeTurnId: string) => {
      noteRealtimeTurnStarted(threadId, runtimeTurnId);
    },
    [noteRealtimeTurnStarted],
  );

  const onAgentMessageDeltaTracked = useCallback(
    (payload: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
      turnId?: string | null;
    }) => {
      const eventTurnId = asString(payload.turnId).trim();
      if (
        eventTurnId &&
        isRealtimeTurnTerminalExact(payload.threadId, eventTurnId)
      ) {
        return;
      }
      if (
        eventTurnId &&
        shouldSkipCodexTurnEvent({
          engine: inferThreadEngine(payload.threadId),
          workspaceId: payload.workspaceId,
          threadId: payload.threadId,
          turnId: eventTurnId,
          operation: "appendAgentMessageDelta",
          sourceMethod: "item/agentMessage/delta",
        })
      ) {
        return;
      }
      onAgentMessageDelta(payload);
      dispatch({ type: "markContinuationEvidence", threadId: payload.threadId, at: Date.now() });
      if (workspaceScopedHas(interruptedThreadsRef.current, payload.workspaceId, payload.threadId)) {
        return;
      }
      noteCodexTurnProgressEvidence(payload.workspaceId, payload.threadId, "agent-message-delta");
      recordAssistantStreamIngress({
        workspaceId: payload.workspaceId,
        threadId: payload.threadId,
        itemId: payload.itemId,
        textLength: payload.delta.length,
        source: "delta",
      });
    },
    [
      dispatch,
      interruptedThreadsRef,
      isRealtimeTurnTerminalExact,
      noteCodexTurnProgressEvidence,
      onAgentMessageDelta,
      recordAssistantStreamIngress,
      shouldSkipCodexTurnEvent,
    ],
  );

  const onAgentMessageCompletedTracked = useCallback(
    (payload: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      text: string;
      turnId?: string | null;
    }) => {
      const eventTurnId = asString(payload.turnId).trim();
      if (eventTurnId && isRealtimeTurnTerminalExact(payload.threadId, eventTurnId)) {
        return;
      }
      onAgentMessageCompleted(payload);
      if (workspaceScopedHas(interruptedThreadsRef.current, payload.workspaceId, payload.threadId) || payload.text.length === 0) {
        return;
      }
      recordAssistantCompletionEvidence(payload.threadId, payload.itemId);
      recordAssistantStreamIngress({
        workspaceId: payload.workspaceId,
        threadId: payload.threadId,
        itemId: payload.itemId,
        textLength: payload.text.length,
        source: "completion",
      });
    },
    [
      interruptedThreadsRef,
      isRealtimeTurnTerminalExact,
      onAgentMessageCompleted,
      recordAssistantCompletionEvidence,
      recordAssistantStreamIngress,
    ],
  );

  const onItemStartedTracked = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      const eventTurnId = extractTurnIdFromRawItem(item);
      if (eventTurnId && isRealtimeTurnTerminalExact(threadId, eventTurnId)) {
        return;
      }
      if (
        shouldSkipCodexTurnEvent({
          engine: inferRawItemEngine(threadId, item),
          workspaceId,
          threadId,
          turnId: eventTurnId,
          operation: "itemStarted",
          sourceMethod: "item/started",
        })
      ) {
        return;
      }
      onItemStarted(workspaceId, threadId, item);
      dispatch({ type: "markContinuationEvidence", threadId, at: Date.now() });
      noteCodexTurnProgressEvidence(workspaceId, threadId, "item-started");
      maybeRecordAgentMessageSnapshotIngress(workspaceId, threadId, item);
      captureTurnItemDiagnostic(workspaceId, threadId, "started", item);
    },
    [
      captureTurnItemDiagnostic,
      dispatch,
      isRealtimeTurnTerminalExact,
      maybeRecordAgentMessageSnapshotIngress,
      noteCodexTurnProgressEvidence,
      onItemStarted,
      shouldSkipCodexTurnEvent,
    ],
  );

  const onItemUpdatedTracked = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      const eventTurnId = extractTurnIdFromRawItem(item);
      if (eventTurnId && isRealtimeTurnTerminalExact(threadId, eventTurnId)) {
        return;
      }
      if (
        shouldSkipCodexTurnEvent({
          engine: inferRawItemEngine(threadId, item),
          workspaceId,
          threadId,
          turnId: eventTurnId,
          operation: "itemUpdated",
          sourceMethod: "item/updated",
        })
      ) {
        return;
      }
      onItemUpdated(workspaceId, threadId, item);
      dispatch({ type: "markContinuationEvidence", threadId, at: Date.now() });
      noteCodexTurnProgressEvidence(workspaceId, threadId, "item-updated");
      maybeRecordAgentMessageSnapshotIngress(workspaceId, threadId, item);
      captureTurnItemDiagnostic(workspaceId, threadId,
        "updated", item);
      flushDeferredTurnCompletionRef.current?.(threadId, "item-terminal");
    },
    [
      captureTurnItemDiagnostic,
      dispatch,
      isRealtimeTurnTerminalExact,
      maybeRecordAgentMessageSnapshotIngress,
      noteCodexTurnProgressEvidence,
      onItemUpdated,
      shouldSkipCodexTurnEvent,
    ],
  );

  const onItemCompletedTracked = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      const eventTurnId = extractTurnIdFromRawItem(item);
      if (eventTurnId && isRealtimeTurnTerminalExact(threadId, eventTurnId)) {
        return;
      }
      if (
        shouldSkipCodexTurnEvent({
          engine: inferRawItemEngine(threadId, item),
          workspaceId,
          threadId,
          turnId: eventTurnId,
          operation: "itemCompleted",
          sourceMethod: "item/completed",
        })
      ) {
        return;
      }
      onItemCompleted(workspaceId, threadId, item);
      dispatch({ type: "markContinuationEvidence", threadId, at: Date.now() });
      noteCodexTurnProgressEvidence(workspaceId, threadId, "item-completed");
      captureTurnItemDiagnostic(workspaceId, threadId,
        "completed", item);
      flushDeferredTurnCompletionRef.current?.(threadId, "item-terminal");
    },
    [
      captureTurnItemDiagnostic,
      dispatch,
      isRealtimeTurnTerminalExact,
      noteCodexTurnProgressEvidence,
      onItemCompleted,
      shouldSkipCodexTurnEvent,
    ],
  );

  const shouldSkipLateCodexNormalizedEvent = useCallback(
    (event: NormalizedThreadEvent) => {
      return shouldSkipCodexTurnEvent({
        engine: event.engine,
        workspaceId: event.workspaceId,
        threadId: event.threadId,
        turnId: asString(event.turnId).trim(),
        operation: event.operation,
        sourceMethod: event.sourceMethod,
      });
    },
    [shouldSkipCodexTurnEvent],
  );

  const onNormalizedRealtimeEventTracked = useCallback(
    (event: NormalizedThreadEvent) => {
      const salvageableTerminalComplete =
        isSalvageableTerminalAssistantComplete(event);
      if (
        event.turnId &&
        isRealtimeTurnTerminalExact(event.threadId, event.turnId) &&
        !salvageableTerminalComplete
      ) {
        onDebug?.({
          id: `${Date.now()}-realtime-terminal-exact-drop`,
          timestamp: Date.now(),
          source: "event",
          label: "thread/session:realtime-terminal-exact-drop",
          payload: {
            threadId: event.threadId,
            turnId: event.turnId,
            operation: event.operation,
            sourceMethod: event.sourceMethod,
          },
        });
        return;
      }
      if (
        !salvageableTerminalComplete &&
        shouldSkipLateCodexNormalizedEvent(event)
      ) {
        return;
      }
      onNormalizedRealtimeEvent(event);
      dispatch({ type: "markContinuationEvidence", threadId: event.threadId, at: Date.now() });
      noteCodexTurnProgressEvidence(event.workspaceId, event.threadId, `normalized:${event.operation}`);
      if (event.operation === "appendAgentMessageDelta") {
        const textLength =
          event.delta?.length ??
          (event.item.kind === "message" ? event.item.text.length : 0);
        if (textLength > 0 && event.item.kind === "message") {
          recordAssistantStreamIngress({
            workspaceId: event.workspaceId,
            threadId: event.threadId,
            itemId: event.item.id,
            textLength,
            source:
              event.sourceMethod === "item/started" ||
              event.sourceMethod === "item/updated"
                ? "snapshot"
                : "delta",
          });
        }
      }
      if (event.operation === "appendToolOutputDelta" && event.item.kind === "tool") {
        noteNonTextRuntimeProgress(event.threadId, "normalized-tool-output-delta", {
          itemType: event.item.toolType,
          itemId: event.item.id,
          itemEventKind: "output-delta",
          outputLength: (event.delta ?? event.item.output ?? "").length,
        });
      }
      if (
        event.operation === "completeAgentMessage" &&
        event.item.kind === "message" &&
        event.item.role === "assistant" &&
        event.item.text.length > 0
      ) {
        recordAssistantStreamIngress({
          workspaceId: event.workspaceId,
          threadId: event.threadId,
          itemId: event.item.id,
          textLength: event.item.text.length,
          source: "completion",
        });
        recordAssistantCompletionEvidence(event.threadId, event.item.id);
      }
      if (!event.rawItem) {
        return;
      }
      if (event.operation === "itemStarted" || event.operation === "itemUpdated") {
        maybeRecordAgentMessageSnapshotIngress(
          event.workspaceId,
          event.threadId,
          event.rawItem,
        );
      }
      if (event.operation === "itemStarted") {
        captureTurnItemDiagnostic(event.workspaceId, event.threadId,
        "started", event.rawItem);
        return;
      }
      if (event.operation === "itemUpdated") {
        captureTurnItemDiagnostic(event.workspaceId, event.threadId,
        "updated", event.rawItem);
        flushDeferredTurnCompletionRef.current?.(event.threadId, "item-terminal");
        return;
      }
      if (event.operation === "itemCompleted") {
        captureTurnItemDiagnostic(event.workspaceId, event.threadId,
        "completed", event.rawItem);
        flushDeferredTurnCompletionRef.current?.(event.threadId, "item-terminal");
      }
    },
    [
      captureTurnItemDiagnostic,
      dispatch,
      isRealtimeTurnTerminalExact,
      maybeRecordAgentMessageSnapshotIngress,
      noteCodexTurnProgressEvidence,
      noteNonTextRuntimeProgress,
      onDebug,
      onNormalizedRealtimeEvent,
      recordAssistantCompletionEvidence,
      recordAssistantStreamIngress,
      shouldSkipLateCodexNormalizedEvent,
    ],
  );

  const onCommandOutputDeltaTracked = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      turnId?: string | null,
    ) => {
      onCommandOutputDelta(workspaceId, threadId, itemId, delta, turnId);
      if (workspaceScopedHas(interruptedThreadsRef.current, workspaceId, threadId)) {
        return;
      }
      noteNonTextRuntimeProgress(threadId, "command-output-delta", {
        itemType: "commandExecution",
        itemId,
        itemEventKind: "output-delta",
        outputLength: delta.length,
      });
    },
    [interruptedThreadsRef, noteNonTextRuntimeProgress, onCommandOutputDelta],
  );

  const onFileChangeOutputDeltaTracked = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      turnId?: string | null,
    ) => {
      onFileChangeOutputDelta(workspaceId, threadId, itemId, delta, turnId);
      if (workspaceScopedHas(interruptedThreadsRef.current, workspaceId, threadId)) {
        return;
      }
      noteNonTextRuntimeProgress(threadId, "file-change-output-delta", {
        itemType: "fileChange",
        itemId,
        itemEventKind: "output-delta",
        outputLength: delta.length,
      });
    },
    [interruptedThreadsRef, noteNonTextRuntimeProgress, onFileChangeOutputDelta],
  );

  const onTerminalInteractionTracked = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      stdin: string,
      turnId?: string | null,
    ) => {
      onTerminalInteraction(workspaceId, threadId, itemId, stdin, turnId);
      if (workspaceScopedHas(interruptedThreadsRef.current, workspaceId, threadId)) {
        return;
      }
      noteNonTextRuntimeProgress(threadId, "terminal-interaction", {
        itemType: "commandExecution",
        itemId,
        itemEventKind: "output-delta",
        outputLength: stdin.length,
      });
    },
    [interruptedThreadsRef, noteNonTextRuntimeProgress, onTerminalInteraction],
  );

  const finalizeTurnDiagnostic = useCallback(
    (
      threadId: string,
      finalState: "completed" | "error",
      payload?: Record<string, unknown>,
    ) => {
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      clearFirstDeltaTimer(threadId);
      clearTurnStallTimer(threadId);
      clearCodexNoProgressTimer(threadId);
      if (!diagnostic) {
        return;
      }
      const now = Date.now();
      if (finalState === "completed") {
        diagnostic.completedAt = now;
      } else {
        diagnostic.errorAt = now;
      }
      const rawMessage =
        typeof payload?.message === "string" ? payload.message : null;
      const firstPacketTimeoutSeconds =
        rawMessage ? parseFirstPacketTimeoutSeconds(rawMessage) : null;
      if (diagnostic.firstDeltaAt === null && finalState === "error") {
        reportThreadUpstreamPending(threadId, {
          elapsedMs: Math.max(0, now - diagnostic.startedAt),
          diagnosticCategory:
            firstPacketTimeoutSeconds !== null
              ? "first-packet-timeout"
              : "first-token-delay",
          reason: firstPacketTimeoutSeconds !== null ? "first-packet-timeout" : "turn-error",
          firstPacketTimeoutSeconds,
          message: rawMessage,
        });
      }
      const lifecycle = getThreadLifecycleSnapshot(threadId);
      const suspectedDurationMs =
        diagnostic.noProgressSuspectedAt === null
          ? null
          : Math.max(0, now - diagnostic.noProgressSuspectedAt);
      emitTurnDiagnostic(finalState, {
        workspaceId: diagnostic.workspaceId,
        threadId,
        turnId: diagnostic.turnId,
        elapsedMs: Math.max(0, now - diagnostic.startedAt),
        firstDeltaAtMs:
          diagnostic.firstDeltaAt === null
            ? null
            : Math.max(0, diagnostic.firstDeltaAt - diagnostic.startedAt),
        firstItemAtMs:
          diagnostic.firstItemEventAt === null
            ? null
            : Math.max(0, diagnostic.firstItemEventAt - diagnostic.startedAt),
        firstItemEventKind: diagnostic.firstItemEventKind,
        firstItemType: diagnostic.firstItemType,
        firstExecutionAtMs:
          diagnostic.firstExecutionAt === null
            ? null
            : Math.max(0, diagnostic.firstExecutionAt - diagnostic.startedAt),
        firstExecutionEventKind: diagnostic.firstExecutionEventKind,
        firstExecutionItemType: diagnostic.firstExecutionItemType,
        firstExecutionItemId: diagnostic.firstExecutionItemId,
        deltaCount: diagnostic.deltaCount,
        itemEventCount: diagnostic.itemEventCount,
        stalledAfterFirstDelta: diagnostic.stallReported,
        lastProgressSource: diagnostic.lastProgressSource,
        lastProgressAgeMs: Math.max(0, now - diagnostic.lastProgressAt),
        progressSequence: diagnostic.progressSequence,
        wasNoProgressSuspected: diagnostic.noProgressSuspectedAt !== null,
        noProgressSuspectedSource: diagnostic.noProgressSuspectedSource,
        suspectedDurationMs,
        isProcessing: lifecycle.isProcessing,
        activeTurnId: lifecycle.activeTurnId,
        firstPacketTimeoutSeconds,
        ...buildThreadStreamCorrelationDimensions(threadId),
        ...payload,
      }, { force: finalState === "error" || diagnostic.stallReported });
      turnDiagnosticsRef.current.delete(threadId);
      clearAssistantSnapshotIngressForThread(threadId);
      completeThreadStreamTurn(threadId);
    },
    [
      clearAssistantSnapshotIngressForThread,
      clearFirstDeltaTimer,
      clearTurnStallTimer,
      clearCodexNoProgressTimer,
      emitTurnDiagnostic,
      getThreadLifecycleSnapshot,
    ],
  );

  const settleCompletedTurn = useCallback(
    (
      workspaceId: string,
      threadId: string,
      normalizedTurnId: string,
      rawTurnId: string | null = normalizedTurnId,
    ) => {
      // Drain every accepted content lane before installing the terminal
      // barrier. Deferred completion calls this same owner, so it cannot leave
      // a cadence-batched tail behind. Semantic port of upstream `0d8f2426c`.
      flushPendingRealtimeEvents();
      markRealtimeTurnTerminal(threadId, normalizedTurnId);
      quarantineCodexTurn(
        workspaceId,
        threadId,
        normalizedTurnId,
        "turn-completed",
        "turn/completed",
      );
      const handled = onTurnCompleted(workspaceId, threadId, normalizedTurnId);
      let fallbackApplied = false;
      if (handled) {
        onTurnCompletedExternal?.({ workspaceId, threadId, turnId: normalizedTurnId });
        onTurnTerminalExternal?.({
          workspaceId,
          threadId,
          turnId: normalizedTurnId,
          rawTurnId,
          status: "completed",
        });
      }
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (!handled && diagnostic && diagnostic.assistantCompletedAt !== null) {
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        const canFallbackSettle =
          !normalizedTurnId ||
          lifecycle.activeTurnId === null ||
          lifecycle.activeTurnId === normalizedTurnId;
        if (canFallbackSettle) {
          dispatch({
            type: "clearProcessingGeneratedImages",
            threadId,
          });
          dispatch({ type: "markTerminalSettlement", threadId });
          dispatch({
            type: "finalizePendingToolStatuses",
            threadId,
            status: "completed",
          });
          dispatch({
            type: "markContextCompacting",
            threadId,
            isCompacting: false,
            timestamp: Date.now(),
          });
          dispatch({
            type: "settleThreadPlanInProgress",
            threadId,
            targetStatus: "completed",
          });
          markProcessingTracked(threadId, false);
          setActiveTurnIdTracked(threadId, null);
          workspaceScopedDelete(pendingInterruptsRef.current, workspaceId, threadId);
          workspaceScopedDelete(interruptedThreadsRef.current, workspaceId, threadId);
          dispatch({ type: "resetAgentSegment", threadId });
          dispatch({ type: "markLatestAssistantMessageFinal", threadId });
          onTurnCompletedExternal?.({
            workspaceId,
            threadId,
            turnId: normalizedTurnId,
          });
          onTurnTerminalExternal?.({
            workspaceId,
            threadId,
            turnId: normalizedTurnId,
            rawTurnId,
            status: "completed",
          });
          fallbackApplied = true;
          emitTurnDiagnostic("terminal-settlement-fallback-applied", {
            workspaceId,
            threadId,
            turnId: normalizedTurnId,
            elapsedMs: Math.max(0, Date.now() - diagnostic.startedAt),
            assistantCompletedAtMs:
              diagnostic.assistantCompletedAt === null
                ? null
                : Math.max(0, diagnostic.assistantCompletedAt - diagnostic.startedAt),
            assistantCompletedItemId: diagnostic.assistantCompletedItemId,
            isProcessing: lifecycle.isProcessing,
            activeTurnId: lifecycle.activeTurnId,
            diagnosticCategory: "frontend-terminal-settlement",
            reason: "turn-completed-settlement-fallback-applied",
            ...buildThreadStreamCorrelationDimensions(threadId),
          }, { force: true });
        } else {
          emitTurnDiagnostic("terminal-settlement-rejected", {
            workspaceId,
            threadId,
            turnId: normalizedTurnId,
            elapsedMs: Math.max(0, Date.now() - diagnostic.startedAt),
            assistantCompletedAtMs:
              diagnostic.assistantCompletedAt === null
                ? null
                : Math.max(0, diagnostic.assistantCompletedAt - diagnostic.startedAt),
            assistantCompletedItemId: diagnostic.assistantCompletedItemId,
            isProcessing: lifecycle.isProcessing,
            activeTurnId: lifecycle.activeTurnId,
            diagnosticCategory: "frontend-terminal-settlement",
            reason: "turn-completed-settlement-rejected",
            ...buildThreadStreamCorrelationDimensions(threadId),
          }, { force: true });
        }
      }
      const postSettlementLifecycle = getThreadLifecycleSnapshot(threadId);
      emitThreeEvidenceDryRunDiagnostic({
        workspaceId,
        threadId,
        turnId: normalizedTurnId,
        terminalKind: "completed",
        sourceMethod: "turn/completed",
        lifecycle: postSettlementLifecycle,
        diagnostic: diagnostic ?? undefined,
        handled,
        fallbackApplied,
      });
      if (
        postSettlementLifecycle.isProcessing ||
        (
          normalizedTurnId &&
          postSettlementLifecycle.activeTurnId === normalizedTurnId
        )
      ) {
        const now = Date.now();
        emitForegroundSettlementDiagnostic("terminal-settlement-busy-residue", {
          workspaceId,
          threadId,
          turnId: normalizedTurnId,
          handled,
          fallbackApplied,
          isProcessing: postSettlementLifecycle.isProcessing,
          activeTurnId: postSettlementLifecycle.activeTurnId,
          lastProgressSource: diagnostic?.lastProgressSource ?? null,
          lastProgressAgeMs: diagnostic ? Math.max(0, now - diagnostic.lastProgressAt) : null,
          progressSequence: diagnostic?.progressSequence ?? null,
          wasNoProgressSuspected: Boolean(
            diagnostic && diagnostic.noProgressSuspectedAt !== null,
          ),
          reason: "terminal-event-handled-but-foreground-state-remains-busy",
          ...buildThreadStreamCorrelationDimensions(threadId),
        });
      }
      if (diagnostic && diagnostic.turnId !== normalizedTurnId) {
        return handled || fallbackApplied;
      }
      emitTurnDomainEvent(
        workspaceId,
        threadId,
        normalizedTurnId,
        "completed",
        {
          durationMs: diagnostic ? Math.max(0, Date.now() - diagnostic.startedAt) : null,
        },
      );
      finalizeTurnDiagnostic(threadId, "completed");
      return handled || fallbackApplied;
    },
    [
      dispatch,
      emitThreeEvidenceDryRunDiagnostic,
      emitTurnDiagnostic,
      emitForegroundSettlementDiagnostic,
      emitTurnDomainEvent,
      finalizeTurnDiagnostic,
      flushPendingRealtimeEvents,
      getThreadLifecycleSnapshot,
      interruptedThreadsRef,
      markRealtimeTurnTerminal,
      markProcessingTracked,
      onTurnCompleted,
      onTurnCompletedExternal,
      onTurnTerminalExternal,
      pendingInterruptsRef,
      quarantineCodexTurn,
      setActiveTurnIdTracked,
    ],
  );

  const requestDeferredCompletionReconciliation = useCallback(
    (workspaceId: string, threadId: string, turnId: string) => {
      const engine = inferThreadEngine(threadId);
      if (engine !== "codex" || !turnId) {
        return;
      }
      const request = {
        workspaceId,
        engine,
        threadId,
        turnId,
        runtimeSessionId: null,
        runtimeLeaseId: null,
        requestSource: "three-evidence-reconciliation" as const,
        requestedAtMs: Date.now(),
      };
      const queryKey = buildReconciliationQueryKey(request);
      if (reconciliationQueryInFlightRef.current.has(queryKey)) {
        emitTurnDiagnostic("deferred-completion-reconciliation-query-skipped", {
          workspaceId,
          threadId,
          turnId,
          engine,
          diagnosticCategory: "deferred-completion-reconciliation",
          skipReason: "query-already-in-flight",
          requestSource: request.requestSource,
          queryKeyHash: queryKey.length,
          activeThreadId,
        }, { force: true });
        return;
      }

      reconciliationQueryInFlightRef.current.add(queryKey);
      emitTurnDiagnostic("deferred-completion-reconciliation-query-requested", {
        workspaceId,
        threadId,
        turnId,
        engine,
        diagnosticCategory: "deferred-completion-reconciliation",
        requestSource: request.requestSource,
        queryKeyHash: queryKey.length,
        activeThreadId,
      }, { force: true });

      void queryTurnReconciliationStatusWithTimeout(request)
        .then((response) => {
          const latestDiagnostic = turnDiagnosticsRef.current.get(threadId);
          const latestLifecycle = getThreadLifecycleSnapshot(threadId);
          const completion = latestDiagnostic?.deferredCompletion ?? null;
          const responseTerminalKind = terminalKindFromReconciliationStatus(response.status);
          const responseTurnId = response.turnId ?? null;
          const scopeMatches =
            response.workspaceId === workspaceId &&
            response.engine === engine &&
            response.threadId === threadId &&
            responseTurnId === turnId;
          const stillDeferred =
            latestDiagnostic?.turnId === turnId &&
            completion?.workspaceId === workspaceId &&
            completion.threadId === threadId &&
            completion.turnId === turnId;
          const activeTurnMatches =
            latestLifecycle.activeTurnId === null ||
            latestLifecycle.activeTurnId === turnId;
          const canFlush =
            responseTerminalKind !== null &&
            scopeMatches &&
            stillDeferred &&
            activeTurnMatches;
          const label = scopeMatches
            ? "deferred-completion-reconciliation-query-resolved"
            : "deferred-completion-reconciliation-query-rejected";
          emitTurnDiagnostic(label, {
            workspaceId,
            threadId,
            turnId,
            engine,
            diagnosticCategory: "deferred-completion-reconciliation",
            status: response.status,
            statusSource: response.statusSource,
            observedAtMs: response.observedAtMs,
            responseWorkspaceId: response.workspaceId,
            responseThreadId: response.threadId,
            responseTurnId: response.turnId,
            responseTerminalKind,
            scopeMatches,
            stillDeferred,
            activeTurnMatches,
            isProcessing: latestLifecycle.isProcessing,
            activeTurnId: latestLifecycle.activeTurnId,
            activeThreadId,
          }, { force: true });

          if (!canFlush) {
            emitTurnDiagnostic("deferred-completion-reconciliation-cleanup-skipped", {
              workspaceId,
              threadId,
              turnId,
              engine,
              diagnosticCategory: "deferred-completion-reconciliation",
              status: response.status,
              statusSource: response.statusSource,
              skipReason:
                responseTerminalKind === null
                  ? "status-not-terminal"
                  : !scopeMatches
                    ? "scope-mismatch"
                    : !stillDeferred
                      ? "deferred-completion-missing"
                      : !activeTurnMatches
                        ? "active-turn-mismatch"
                        : "guard-rejected",
              responseWorkspaceId: response.workspaceId,
              responseThreadId: response.threadId,
              responseTurnId: response.turnId,
              isProcessing: latestLifecycle.isProcessing,
              activeTurnId: latestLifecycle.activeTurnId,
              activeThreadId,
            }, { force: true });
            return;
          }

          flushDeferredTurnCompletionRef.current?.(
            threadId,
            "scoped-reconciliation-terminal",
          );
        })
        .catch((error: unknown) => {
          const latestLifecycle = getThreadLifecycleSnapshot(threadId);
          emitTurnDiagnostic("deferred-completion-reconciliation-query-failed", {
            workspaceId,
            threadId,
            turnId,
            engine,
            diagnosticCategory: "deferred-completion-reconciliation",
            status: "query-failed",
            boundedReason:
              error instanceof Error
                ? error.message
                : "status query failed with unknown error",
            isProcessing: latestLifecycle.isProcessing,
            activeTurnId: latestLifecycle.activeTurnId,
            activeThreadId,
          }, { force: true });
        })
        .finally(() => {
          reconciliationQueryInFlightRef.current.delete(queryKey);
        });
    },
    [
      activeThreadId,
      buildReconciliationQueryKey,
      emitTurnDiagnostic,
      getThreadLifecycleSnapshot,
      terminalKindFromReconciliationStatus,
    ],
  );

  const deferCodexTurnCompletionIfBlocked = useCallback(
    (workspaceId: string, threadId: string, normalizedTurnId: string) => {
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (
        inferThreadEngine(threadId) !== "codex" ||
        !diagnostic ||
        !normalizedTurnId ||
        diagnostic.turnId !== normalizedTurnId
      ) {
        return false;
      }
      const blockers = listDeferredCompletionBlockers(diagnostic);
      if (blockers.length === 0) {
        return false;
      }
      const now = Date.now();
      diagnostic.deferredCompletion = diagnostic.deferredCompletion ?? {
        workspaceId,
        threadId,
        turnId: normalizedTurnId,
        deferredAt: now,
      };
      const lifecycle = getThreadLifecycleSnapshot(threadId);
      emitTurnDiagnostic("turn-completed-deferred", {
        workspaceId,
        threadId,
        turnId: normalizedTurnId,
        elapsedMs: Math.max(0, now - diagnostic.startedAt),
        blockerCount: blockers.length,
        blockers,
        isProcessing: lifecycle.isProcessing,
        activeTurnId: lifecycle.activeTurnId,
        diagnosticCategory: "codex-collab-terminal-order",
        reason: "turn/completed arrived while Codex collaboration child agents were still active",
        ...buildThreadStreamCorrelationDimensions(threadId),
      }, { force: true });
      requestDeferredCompletionReconciliation(workspaceId, threadId, normalizedTurnId);
      return true;
    },
    [emitTurnDiagnostic, getThreadLifecycleSnapshot, requestDeferredCompletionReconciliation],
  );

  const flushDeferredTurnCompletionIfReady = useCallback(
    (threadId: string, source: DeferredCompletionFlushSource) => {
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      const completion = diagnostic?.deferredCompletion ?? null;
      if (!diagnostic || !completion) {
        return;
      }
      const blockers = listDeferredCompletionBlockers(diagnostic);
      const allowBlockedFlush = source === "scoped-reconciliation-terminal";
      const lifecycle = getThreadLifecycleSnapshot(threadId);
      if (diagnostic.turnId !== completion.turnId) {
        emitTurnDiagnostic("turn-completed-deferred-flush-skipped", {
          workspaceId: completion.workspaceId,
          threadId: completion.threadId,
          turnId: completion.turnId,
          source,
          diagnosticTurnId: diagnostic.turnId,
          diagnosticCategory: "codex-collab-terminal-order",
          skipReason: "diagnostic-turn-mismatch",
          ...buildThreadStreamCorrelationDimensions(threadId),
        }, { force: true });
        return;
      }
      if (
        lifecycle.activeTurnId !== null &&
        lifecycle.activeTurnId !== completion.turnId
      ) {
        emitTurnDiagnostic("turn-completed-deferred-flush-skipped", {
          workspaceId: completion.workspaceId,
          threadId: completion.threadId,
          turnId: completion.turnId,
          source,
          activeTurnId: lifecycle.activeTurnId,
          diagnosticCategory: "codex-collab-terminal-order",
          skipReason: "active-turn-mismatch",
          ...buildThreadStreamCorrelationDimensions(threadId),
        }, { force: true });
        return;
      }
      if (blockers.length > 0 && !allowBlockedFlush) {
        return;
      }
      diagnostic.deferredCompletion = null;
      const now = Date.now();
      emitTurnDiagnostic("turn-completed-deferred-flushed", {
        workspaceId: completion.workspaceId,
        threadId: completion.threadId,
        turnId: completion.turnId,
        deferredMs: Math.max(0, now - completion.deferredAt),
        elapsedMs: Math.max(0, now - diagnostic.startedAt),
        source,
        forcedByScopedReconciliation: allowBlockedFlush && blockers.length > 0,
        remainingBlockers: allowBlockedFlush ? blockers : [],
        diagnosticCategory: "codex-collab-terminal-order",
        ...buildThreadStreamCorrelationDimensions(threadId),
      }, { force: true });
      settleCompletedTurn(completion.workspaceId, completion.threadId, completion.turnId);
    },
    [emitTurnDiagnostic, getThreadLifecycleSnapshot, settleCompletedTurn],
  );
  flushDeferredTurnCompletionRef.current = flushDeferredTurnCompletionIfReady;

  const onTurnCompletedTracked = useCallback(
    (workspaceId: string, threadId: string, turnId: string) => {
      const normalizedTurnId = resolveTerminalSettlementTurnId(threadId, turnId);
      if (deferCodexTurnCompletionIfBlocked(workspaceId, threadId, normalizedTurnId)) {
        return;
      }
      settleCompletedTurn(workspaceId, threadId, normalizedTurnId, turnId);
    },
    [
      deferCodexTurnCompletionIfBlocked,
      resolveTerminalSettlementTurnId,
      settleCompletedTurn,
    ],
  );

  const onTurnErrorTracked = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
      payload: {
        message: string;
        willRetry: boolean;
        suppressMessage?: boolean;
        engine?: ConversationEngine | null;
        executionTargetSnapshot?: TurnExecutionSnapshot;
      },
    ) => {
      const normalizedTurnId = resolveTerminalSettlementTurnId(threadId, turnId);
      flushPendingRealtimeEvents();
      markRealtimeTurnTerminal(threadId, normalizedTurnId);
      onTurnError(workspaceId, threadId, normalizedTurnId, payload);
      if (payload.willRetry) {
        return;
      }
      quarantineCodexTurn(
        workspaceId,
        threadId,
        normalizedTurnId,
        "turn-error",
        "turn/error",
        payload.engine,
      );
      onTurnTerminalExternal?.({
        workspaceId,
        threadId,
        turnId: normalizedTurnId,
        rawTurnId: turnId,
        status: "error",
      });
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (diagnostic && diagnostic.turnId !== normalizedTurnId) {
        return;
      }
      emitTurnDomainEvent(workspaceId, threadId, normalizedTurnId, "failed", {
        errorMessage: payload.message,
      });
      finalizeTurnDiagnostic(threadId, "error", {
        message: payload.message,
        willRetry: payload.willRetry,
      });
    },
    [
      finalizeTurnDiagnostic,
      emitTurnDomainEvent,
      flushPendingRealtimeEvents,
      markRealtimeTurnTerminal,
      onTurnError,
      onTurnTerminalExternal,
      quarantineCodexTurn,
      resolveTerminalSettlementTurnId,
    ],
  );

  const onTurnStalledTracked = useCallback(
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
        engine?: ConversationEngine | null;
      },
    ) => {
      const normalizedTurnId = resolveTerminalSettlementTurnId(threadId, turnId);
      flushPendingRealtimeEvents();
      markRealtimeTurnTerminal(threadId, normalizedTurnId);
      onTurnStalled(workspaceId, threadId, normalizedTurnId, payload);
      quarantineCodexTurn(
        workspaceId,
        threadId,
        normalizedTurnId,
        payload.reasonCode || "turn-stalled",
        payload.source || "turn/stalled",
        payload.engine,
      );
      onTurnTerminalExternal?.({
        workspaceId,
        threadId,
        turnId: normalizedTurnId,
        rawTurnId: turnId,
        status: "stalled",
      });
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (diagnostic && diagnostic.turnId !== normalizedTurnId) {
        return;
      }
      emitTurnDomainEvent(workspaceId, threadId, normalizedTurnId, "failed", {
        errorMessage: payload.message,
      });
      finalizeTurnDiagnostic(threadId, "error", {
        message: payload.message,
        diagnosticCategory: "resume_stalled",
        reasonCode: payload.reasonCode,
        stage: payload.stage,
        source: payload.source,
        startedAtMs: payload.startedAtMs,
        timeoutMs: payload.timeoutMs,
      });
    },
    [
      finalizeTurnDiagnostic,
      emitTurnDomainEvent,
      flushPendingRealtimeEvents,
      markRealtimeTurnTerminal,
      onTurnStalled,
      onTurnTerminalExternal,
      quarantineCodexTurn,
      resolveTerminalSettlementTurnId,
    ],
  );

  const onAppServerEvent = useCallback(
    (event: AppServerEvent) => {
      handleThreadAppServerEventDiagnostics({
        event,
        onDebug,
        getThreadLifecycleSnapshot,
        getExpectedTurnId: (threadId) =>
          turnDiagnosticsRef.current.get(threadId)?.turnId ??
          getThreadLifecycleSnapshot(threadId).activeTurnId,
        emitForegroundSettlementDiagnostic,
        noteCodexTurnProgressEvidence,
      });
    },
    [
      emitForegroundSettlementDiagnostic,
      getThreadLifecycleSnapshot,
      onDebug,
      noteCodexTurnProgressEvidence,
    ],
  );

  const handlers = useMemo(
    () => ({
      onWorkspaceConnected,
      onApprovalRequest,
      onRequestUserInput,
      onModeBlocked,
      onModeResolved,
      onBackgroundThreadAction,
      onAppServerEvent,
      onAgentMessageDelta: onAgentMessageDeltaTracked,
      onAgentMessageCompleted: onAgentMessageCompletedTracked,
      onNormalizedRealtimeEvent: onNormalizedRealtimeEventTracked,
      onItemStarted: onItemStartedTracked,
      onItemUpdated: onItemUpdatedTracked,
      onItemCompleted: onItemCompletedTracked,
      onReasoningSummaryDelta,
      onReasoningSummaryBoundary,
      onReasoningTextDelta,
      onCommandOutputDelta: onCommandOutputDeltaTracked,
      onTerminalInteraction: onTerminalInteractionTracked,
      onFileChangeOutputDelta: onFileChangeOutputDeltaTracked,
      onThreadStarted,
      onTurnStarted: onTurnStartedTracked,
      onSharedRuntimeTurnStarted,
      onTurnCompleted: onTurnCompletedTracked,
      onProcessingHeartbeat,
      onTurnPlanUpdated,
      onThreadTokenUsageUpdated: onThreadTokenUsageUpdatedTracked,
      onAccountRateLimitsUpdated,
      onTurnError: onTurnErrorTracked,
      onTurnStalled: onTurnStalledTracked,
      onContextCompacting,
      onContextCompacted,
      onContextCompactionFailed,
      onThreadSessionIdUpdated,
    }),
    [
      onWorkspaceConnected,
      onApprovalRequest,
      onRequestUserInput,
      onModeBlocked,
      onModeResolved,
      onBackgroundThreadAction,
      onAppServerEvent,
      onAgentMessageDeltaTracked,
      onAgentMessageCompletedTracked,
      onNormalizedRealtimeEventTracked,
      onItemStartedTracked,
      onItemUpdatedTracked,
      onItemCompletedTracked,
      onReasoningSummaryDelta,
      onReasoningSummaryBoundary,
      onReasoningTextDelta,
      onCommandOutputDeltaTracked,
      onTerminalInteractionTracked,
      onFileChangeOutputDeltaTracked,
      onThreadStarted,
      onTurnStartedTracked,
      onSharedRuntimeTurnStarted,
      onTurnCompletedTracked,
      onProcessingHeartbeat,
      onTurnPlanUpdated,
      onThreadTokenUsageUpdatedTracked,
      onAccountRateLimitsUpdated,
      onTurnErrorTracked,
      onTurnStalledTracked,
      onContextCompacting,
      onContextCompacted,
      onContextCompactionFailed,
      onThreadSessionIdUpdated,
    ],
  );

  return handlers;
}
