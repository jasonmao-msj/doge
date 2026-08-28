import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  EngineType,
  MessageSendOptions,
  QueuedMessage,
  SharedQueuedExecutionTarget,
  WorkspaceInfo,
} from "../../../types";
import {
  getSharedSendActiveAttemptId,
  getSharedSendStateRevision,
  useSharedSendState,
} from "../../shared-session/runtime/sharedSendStateStore";
import { getSharedTargetState } from "../../shared-session/target/targetStore";
import {
  isResolvedExecutionTarget,
  type ResolvedExecutionTarget,
} from "../../shared-session/target/types";
import type { SharedSendState } from "../../shared-session/target/sendStateMachine";
import {
  buildQueuedHandoffBubbleItem,
  type QueuedHandoffBubble,
} from "../utils/queuedHandoffBubble";
import {
  readSharedQueuedFollowUps,
  writeSharedQueuedFollowUps,
} from "../utils/sharedQueuedFollowUpStore";
import {
  createEngineMessageDeliveryDiagnostic,
  decideEngineMessageDelivery,
  type EngineMessageDeliveryDiagnostic,
} from "../contracts/engineMessageDelivery";
import type { ThreadMessageDispatchResult } from "./useThreadMessaging";
import { normalizeEngineForExecution } from "../../../utils/engineExecutionPolicy";

const OPENCODE_INFLIGHT_STALL_MS = 18_000;
const FUSION_RESUME_TIMEOUT_MS = 48_000;
const QUEUED_HANDOFF_BUBBLE_TTL_MS = 60_000;
const DELIVERY_DIAGNOSTIC_LIMIT = 100;

type UseQueuedSendOptions = {
  activeThreadId: string | null;
  activeTurnId?: string | null;
  activeContinuationPulse?: number;
  activeTerminalPulse?: number;
  isProcessing: boolean;
  isReviewing: boolean;
  isContextCompacting?: boolean;
  // True while an AskUserQuestion dialog is open for the active thread. The CLI
  // turn is blocked awaiting the answer, so the queue must NOT flush into it —
  // isProcessing can drop to false mid-ask, which would otherwise send queued
  // messages as fresh turns and strand the pending answer. See handleSend +
  // the auto-flush effect below.
  hasPendingUserInput?: boolean;
  steerEnabled: boolean;
  activeWorkspace: WorkspaceInfo | null;
  activeEngine?: EngineType;
  getThreadEngine?: (
    workspaceId: string,
    threadId: string,
  ) => EngineType | undefined;
  getThreadProviderProfileId?: (
    workspaceId: string,
    threadId: string,
  ) => string | null;
  isSharedSession?: boolean;
  resolveCanonicalThreadId: (threadId: string) => string;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: {
      activate?: boolean;
      engine?: EngineType;
      providerProfileId?: string | null;
      folderId?: string | null;
    },
  ) => Promise<string | null>;
  sendUserMessage: (
    text: string,
    images?: string[],
    options?: MessageSendOptions,
  ) => Promise<void>;
  sendUserMessageToThread: (
    workspace: WorkspaceInfo,
    threadId: string,
    text: string,
    images?: string[],
    options?: MessageSendOptions,
  ) => Promise<ThreadMessageDispatchResult>;
  startFork: (text: string, options?: MessageSendOptions) => Promise<void>;
  startReview: (text: string) => Promise<void>;
  startResume: (text: string) => Promise<void>;
  startMcp: (text: string) => Promise<void>;
  startSpecRoot: (text: string) => Promise<void>;
  startStatus: (text: string) => Promise<void>;
  startContext: (text: string) => Promise<void>;
  startExport: (text: string) => Promise<void>;
  startImport: (text: string) => Promise<void>;
  startLsp: (text: string) => Promise<void>;
  startShare: (text: string) => Promise<void>;
  startCompact: (text: string) => Promise<void>;
  startFast: (text: string) => Promise<void>;
  startMode: (text: string) => Promise<void>;
  setCodexCollaborationMode?: (mode: "plan" | "code") => void;
  getCodexCollaborationMode?: () => "plan" | "code" | null;
  getCodexCollaborationPayload?: () => Record<string, unknown> | null;
  interruptTurn?: (options?: {
    reason?: "user-stop" | "queue-fusion";
  }) => Promise<void>;
  handleFusionStalled?: (
    threadId: string,
    options?: { message?: string | null },
  ) => void;
  clearActiveImages: () => void;
};

type UseQueuedSendResult = {
  queuedByThread: Record<string, QueuedMessage[]>;
  activeQueue: QueuedMessage[];
  activeQueuedHandoffBubble: QueuedHandoffBubble | null;
  handleSend: (
    text: string,
    images?: string[],
    options?: MessageSendOptions,
  ) => Promise<void>;
  queueMessage: (
    text: string,
    images?: string[],
    options?: MessageSendOptions,
  ) => Promise<void>;
  removeQueuedMessage: (threadId: string, messageId: string) => void;
  fuseQueuedMessage: (threadId: string, messageId: string) => Promise<void>;
  canFuseActiveQueue: boolean;
  /** 全局融合不可用时的 i18n key；canFuse 时为 null。 */
  fuseDisabledReasonKey: string | null;
  activeFusingMessageId: string | null;
};

type ThreadFusionState = {
  messageId: string;
  turnIdBeforeFusion: string | null;
  mode: "same-run" | "cutover";
  stage:
    "awaiting-predecessor-settlement" | "dispatching" | "awaiting-continuation";
  startedAtMs: number;
  continuationPulseAtStart: number;
  terminalPulseAtStart: number;
};

type QueuedDispatchResult =
  "committed" | "dispatched" | "blocked" | "ambiguous";

type SlashCommandKind =
  | "fork"
  | "fast"
  | "clear"
  | "mcp"
  | "new"
  | "resume"
  | "specRoot"
  | "review"
  | "status"
  | "context"
  | "export"
  | "import"
  | "lsp"
  | "share"
  | "compact"
  | "plan"
  | "defaultMode"
  | "code"
  | "mode";

const MODE_QUERY_DENYLIST =
  /(区别|差别|不同|怎么|如何|为什么|为何|影响|不影响|约束|规则|行为|能力|planfirst|agents\.?md)/i;

function readSlashCommandToken(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const withoutSlash = trimmed.slice(1);
  if (!withoutSlash) {
    return null;
  }
  const firstToken = withoutSlash.split(/\s+/, 1)[0]?.trim();
  if (!firstToken) {
    return null;
  }
  return firstToken.toLowerCase();
}

function isImplicitModeQuery(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 64) {
    return false;
  }
  if (MODE_QUERY_DENYLIST.test(trimmed)) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  if (
    /^(?:mode|current\s+mode|what(?:'s| is)\s+(?:the\s+)?(?:current\s+)?mode|am i in (?:plan|default) mode)\s*[?]?$/i
      .test(normalized)
  ) {
    return true;
  }
  if (/^(现在呢|当前呢|此时呢)\s*[？?]?$/u.test(trimmed)) {
    return true;
  }
  return /^(现在|当前|此时).{0,24}(模式|计划模式|default|默认).{0,24}(吗|呢)?\s*[？?]?$/u
    .test(trimmed);
}

function parseSlashCommand(text: string): SlashCommandKind | null {
  const commandToken = readSlashCommandToken(text);
  if (commandToken === "fork") {
    return "fork";
  }
  if (commandToken === "fast") {
    return "fast";
  }
  if (commandToken === "clear" || commandToken === "reset") {
    return "clear";
  }
  if (commandToken === "mcp") {
    return "mcp";
  }
  if (commandToken === "review") {
    return "review";
  }
  if (commandToken === "new") {
    return "new";
  }
  if (commandToken === "resume") {
    return "resume";
  }
  if (commandToken === "spec-root") {
    return "specRoot";
  }
  if (commandToken === "status") {
    return "status";
  }
  if (commandToken === "context") {
    return "context";
  }
  if (commandToken === "export") {
    return "export";
  }
  if (commandToken === "import") {
    return "import";
  }
  if (commandToken === "lsp") {
    return "lsp";
  }
  if (commandToken === "share") {
    return "share";
  }
  if (commandToken === "compact") {
    return "compact";
  }
  if (commandToken === "plan") {
    return "plan";
  }
  if (commandToken === "default") {
    return "defaultMode";
  }
  if (commandToken === "code") {
    return "code";
  }
  if (commandToken === "mode") {
    return "mode";
  }
  return null;
}

function isQueuedMessageFuseEligible(item: QueuedMessage): boolean {
  return (
    readSlashCommandToken(item.text) === null &&
    item.sharedDispatchState !== "pending-ack"
  );
}

function cloneSharedExecutionTarget(
  target: ResolvedExecutionTarget,
): SharedQueuedExecutionTarget {
  return {
    engine: target.engine,
    providerProfileId: target.providerProfileId?.trim() || null,
    modelCatalogEntryId: target.modelCatalogEntryId,
    model: target.model,
    reasoning: target.reasoning ? { effort: target.reasoning.effort } : null,
    providerProfileNameSnapshot: target.providerProfileNameSnapshot,
    providerProfileSource: target.providerProfileSource,
  };
}

function isSharedFollowUpState(state: SharedSendState): boolean {
  return state === "running" || state === "settling";
}

function isSameSharedExecutionTarget(
  current: ResolvedExecutionTarget,
  frozen: SharedQueuedExecutionTarget,
): boolean {
  return (
    current.engine === frozen.engine &&
    normalizeOptionalIdentity(current.providerProfileId) ===
      normalizeOptionalIdentity(frozen.providerProfileId) &&
    current.modelCatalogEntryId === frozen.modelCatalogEntryId &&
    current.model === frozen.model &&
    normalizeOptionalIdentity(current.reasoning?.effort) ===
      normalizeOptionalIdentity(frozen.reasoning?.effort) &&
    current.providerProfileNameSnapshot ===
      frozen.providerProfileNameSnapshot &&
    current.providerProfileSource === frozen.providerProfileSource
  );
}

function normalizeOptionalIdentity(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function classifySharedDispatchResult(
  value: unknown,
  expectedTarget: SharedQueuedExecutionTarget | undefined,
): QueuedDispatchResult {
  if (!value || typeof value !== "object") {
    return "ambiguous";
  }
  const response = value as Record<string, unknown>;
  const v2 =
    response.v2 && typeof response.v2 === "object"
      ? (response.v2 as Record<string, unknown>)
      : null;
  if (
    response.status === "accepted" &&
    v2?.committed === true &&
    normalizeOptionalIdentity(v2.attemptId) !== null &&
    normalizeOptionalIdentity(v2.logicalTurnId) !== null &&
    expectedTarget !== undefined &&
    response.engine === expectedTarget.engine &&
    normalizeOptionalIdentity(response.providerProfileId) ===
      normalizeOptionalIdentity(expectedTarget.providerProfileId) &&
    normalizeOptionalIdentity(response.model) === expectedTarget.model &&
    normalizeOptionalIdentity(response.reasoningEffort) ===
      normalizeOptionalIdentity(expectedTarget.reasoning?.effort)
  ) {
    return "committed";
  }
  if (
    response.status === "blocked" ||
    response.status === "cancelled" ||
    response.status === "recovery-required" ||
    response.status === "target-unavailable"
  ) {
    return "blocked";
  }
  return "ambiguous";
}

function isCodexOnlyCommand(command: SlashCommandKind): boolean {
  return (
    command === "fast" ||
    command === "plan" ||
    command === "defaultMode" ||
    command === "code" ||
    command === "mode"
  );
}

function isClaudeOnlyCommand(command: SlashCommandKind): boolean {
  return command === "compact";
}

function canExecuteSlashCommand(
  command: SlashCommandKind | null,
  activeEngine: EngineType,
  activeThreadId: string | null,
): command is SlashCommandKind {
  if (!command) {
    return false;
  }
  if (command === "clear" && activeEngine !== "claude") {
    return false;
  }
  if (isCodexOnlyCommand(command) && activeEngine !== "codex") {
    return false;
  }
  if (isClaudeOnlyCommand(command)) {
    if (activeEngine === "claude") {
      return true;
    }
    return Boolean(
      activeThreadId &&
        (activeThreadId.startsWith("claude:")
          || activeThreadId.startsWith("claude-pending-")),
    );
  }
  return true;
}

export function useQueuedSend({
  activeThreadId,
  activeTurnId,
  activeContinuationPulse = 0,
  activeTerminalPulse = 0,
  isProcessing,
  isReviewing,
  isContextCompacting = false,
  hasPendingUserInput = false,
  steerEnabled,
  activeWorkspace,
  activeEngine = "claude",
  getThreadEngine,
  getThreadProviderProfileId,
  isSharedSession = false,
  resolveCanonicalThreadId,
  connectWorkspace,
  startThreadForWorkspace,
  sendUserMessage,
  sendUserMessageToThread,
  startFork,
  startReview,
  startResume,
  startMcp,
  startSpecRoot,
  startStatus,
  startContext,
  startExport,
  startImport,
  startLsp,
  startShare,
  startCompact,
  startFast,
  startMode,
  setCodexCollaborationMode,
  getCodexCollaborationMode,
  getCodexCollaborationPayload,
  interruptTurn,
  handleFusionStalled,
  clearActiveImages,
}: UseQueuedSendOptions): UseQueuedSendResult {
  const isClaudePendingBootstrapThread =
    activeEngine === "claude" &&
    Boolean(activeThreadId?.startsWith("claude-pending-"));
  const sharedSendEntry = useSharedSendState(
    isSharedSession ? (activeWorkspace?.id ?? "") : "",
    isSharedSession ? (activeThreadId ?? "") : "",
  );
  const activeSharedSendState: SharedSendState = isSharedSession
    ? sharedSendEntry.state
    : "idle";
  const initialSharedQueueOwner =
    isSharedSession && activeWorkspace && activeThreadId
      ? `${activeWorkspace.id}::${activeThreadId}`
      : null;
  const [queuedByThread, setQueuedByThreadState] = useState<
    Record<string, QueuedMessage[]>
  >(() =>
    isSharedSession && activeWorkspace && activeThreadId
      ? {
          [activeThreadId]: readSharedQueuedFollowUps(
            activeWorkspace.id,
            activeThreadId,
          ),
        }
      : {},
  );
  const queuedByThreadRef = useRef(queuedByThread);
  const [inFlightByThread, setInFlightByThread] = useState<
    Record<string, QueuedMessage | null>
  >({});
  const [queuedHandoffByThread, setQueuedHandoffByThread] = useState<
    Record<string, QueuedHandoffBubble | null>
  >({});
  const [hasStartedByThread, setHasStartedByThread] = useState<
    Record<string, boolean>
  >({});
  const [fusionByThread, setFusionByThread] = useState<
    Record<string, ThreadFusionState | null>
  >({});
  const previousActiveThreadIdRef = useRef<string | null>(activeThreadId);
  const queuedAfterTerminalPulseRef = useRef(new Map<string, number>());
  const queuedAfterSharedRevisionRef = useRef(new Map<string, number>());
  const deliveryDiagnosticsRef = useRef<EngineMessageDeliveryDiagnostic[]>([]);
  const hydratedSharedQueueOwnersRef = useRef(
    new Set(initialSharedQueueOwner ? [initialSharedQueueOwner] : []),
  );
  const fusionDispatchingRef = useRef(new Set<string>());
  const queueDispatchingRef = useRef(new Set<string>());

  useEffect(() => {
    queuedByThreadRef.current = queuedByThread;
  }, [queuedByThread]);

  useEffect(() => {
    if (!isSharedSession || !activeWorkspace || !activeThreadId) {
      return;
    }
    const ownerKey = `${activeWorkspace.id}::${activeThreadId}`;
    if (hydratedSharedQueueOwnersRef.current.has(ownerKey)) {
      return;
    }
    hydratedSharedQueueOwnersRef.current.add(ownerKey);
    const persisted = readSharedQueuedFollowUps(
      activeWorkspace.id,
      activeThreadId,
    );
    setQueuedByThreadState((prev) => {
      if (prev[activeThreadId]) {
        return prev;
      }
      const next = {
        ...prev,
        [activeThreadId]: persisted,
      };
      queuedByThreadRef.current = next;
      return next;
    });
  }, [activeThreadId, activeWorkspace, isSharedSession]);

  const setQueuedByThread = useCallback(
    (
      updater: (
        previous: Record<string, QueuedMessage[]>,
      ) => Record<string, QueuedMessage[]>,
    ) => {
      const next = updater(queuedByThreadRef.current);
      if (Object.is(next, queuedByThreadRef.current)) {
        return;
      }
      queuedByThreadRef.current = next;
      setQueuedByThreadState(next);
      if (isSharedSession && activeWorkspace && activeThreadId) {
        writeSharedQueuedFollowUps(
          activeWorkspace.id,
          activeThreadId,
          next[activeThreadId] ?? [],
        );
      }
    },
    [activeThreadId, activeWorkspace, isSharedSession],
  );

  const recordDeliveryDecision = useCallback(
    (diagnostic: EngineMessageDeliveryDiagnostic) => {
      deliveryDiagnosticsRef.current = [
        ...deliveryDiagnosticsRef.current.slice(-(DELIVERY_DIAGNOSTIC_LIMIT - 1)),
        diagnostic,
      ];
    },
    [],
  );

  const activeQueue = useMemo(
    () => (activeThreadId ? (queuedByThread[activeThreadId] ?? []) : []),
    [activeThreadId, queuedByThread],
  );
  const activeFusion = useMemo(
    () => (activeThreadId ? (fusionByThread[activeThreadId] ?? null) : null),
    [activeThreadId, fusionByThread],
  );
  const activeQueuedHandoffBubble = useMemo(
    () =>
      activeThreadId ? (queuedHandoffByThread[activeThreadId] ?? null) : null,
    [activeThreadId, queuedHandoffByThread],
  );
  const activeFusingMessageId = activeFusion?.messageId ?? null;
  const activeFusionCapability = useMemo(() => {
    if (!activeThreadId || !activeTurnId) {
      return { sameRun: false, cutover: false };
    }
    const decision = decideEngineMessageDelivery({
      intent: "steer",
      engine: activeEngine,
      sessionId: activeThreadId,
      activeRunId: activeTurnId,
    });
    return {
      sameRun:
        steerEnabled &&
        decision.status !== "rejected" &&
        decision.route === "steer",
      cutover:
        decision.evidence.midTurnCapability === "compat-input" &&
        typeof interruptTurn === "function",
    };
  }, [activeEngine, activeThreadId, activeTurnId, interruptTurn, steerEnabled]);
  const fuseDisabledReasonKey = useMemo((): string | null => {
    if (!activeThreadId || !activeWorkspace) {
      return "chat.fuseDisabledNoSession";
    }
    if (activeQueue.length === 0) {
      return "chat.fuseDisabledEmptyQueue";
    }
    if (activeFusion) {
      return "chat.fuseDisabledAlreadyFusing";
    }
    if (isClaudePendingBootstrapThread) {
      return "chat.fuseDisabledBootstrap";
    }
    if (isContextCompacting) {
      return "chat.fuseDisabledCompacting";
    }
    if (!isProcessing) {
      return "chat.fuseDisabledNoActiveTurn";
    }
    if (isReviewing) {
      return "chat.fuseDisabledReviewing";
    }
    if (
      isSharedSession &&
      !isSharedFollowUpState(activeSharedSendState)
    ) {
      return activeSharedSendState === "recovery-required"
        ? "chat.fuseDisabledSharedRecovery"
        : "chat.fuseDisabledSharedNotReady";
    }
    if (!(activeFusionCapability.sameRun || activeFusionCapability.cutover)) {
      return "chat.fuseDisabledCapability";
    }
    return null;
  }, [
    activeFusion,
    activeQueue.length,
    activeThreadId,
    activeFusionCapability,
    activeWorkspace,
    activeSharedSendState,
    isClaudePendingBootstrapThread,
    isContextCompacting,
    isProcessing,
    isReviewing,
    isSharedSession,
  ]);
  const canFuseActiveQueue = fuseDisabledReasonKey === null;

  useEffect(() => {
    if (previousActiveThreadIdRef.current === activeThreadId) {
      return;
    }
    const oldThreadId = previousActiveThreadIdRef.current;
    const newThreadId = activeThreadId;
    previousActiveThreadIdRef.current = newThreadId;
    if (!oldThreadId || !newThreadId) {
      return;
    }
    const isClaudeSessionTransition =
      oldThreadId.startsWith("claude-pending-") && newThreadId.startsWith("claude:");
    // Optimistic codex threads rename from `codex-pending-*` to a bare
    // backend thread id (codex ids carry no engine prefix), so id shape alone
    // cannot distinguish the finalize rebind from the user manually switching
    // to another codex thread. Require the alias the finalize flow records
    // (onCodexPendingThreadFinalized -> rememberThreadAlias) to confirm that
    // newThreadId really is oldThreadId's finalized identity.
    const isCodexSessionTransition =
      oldThreadId.startsWith("codex-pending-") &&
      resolveCanonicalThreadId(oldThreadId) === newThreadId;
    if (!isClaudeSessionTransition && !isCodexSessionTransition) {
      return;
    }

    setQueuedByThread((prev) => {
      const pendingQueue = prev[oldThreadId] ?? [];
      if (pendingQueue.length < 1) {
        return prev;
      }
      const nextQueue = prev[newThreadId] ?? [];
      const next = {
        ...prev,
        [newThreadId]: [...pendingQueue, ...nextQueue],
      };
      delete next[oldThreadId];
      return next;
    });

    setInFlightByThread((prev) => {
      const pendingInFlight = prev[oldThreadId];
      if (pendingInFlight === undefined) {
        return prev;
      }
      const next = { ...prev };
      if (next[newThreadId] === undefined) {
        next[newThreadId] = pendingInFlight;
      }
      delete next[oldThreadId];
      return next;
    });

    setHasStartedByThread((prev) => {
      const pendingStarted = prev[oldThreadId];
      if (pendingStarted === undefined) {
        return prev;
      }
      const next = { ...prev };
      if (next[newThreadId] === undefined) {
        next[newThreadId] = pendingStarted;
      }
      delete next[oldThreadId];
      return next;
    });

    setQueuedHandoffByThread((prev) => {
      const pendingHandoff = prev[oldThreadId];
      if (pendingHandoff === undefined) {
        return prev;
      }
      const next = { ...prev };
      if (next[newThreadId] === undefined) {
        next[newThreadId] = pendingHandoff;
      }
      delete next[oldThreadId];
      return next;
    });

    setFusionByThread((prev) => {
      const pendingFusion = prev[oldThreadId];
      if (pendingFusion === undefined) {
        return prev;
      }
      const next = { ...prev };
      if (next[newThreadId] === undefined) {
        next[newThreadId] = pendingFusion;
      }
      delete next[oldThreadId];
      return next;
    });
  }, [activeThreadId, resolveCanonicalThreadId, setQueuedByThread]);

  const buildQueuedMessage = useCallback(
    (
      text: string,
      images: string[] = [],
      options?: MessageSendOptions,
    ): QueuedMessage => {
      let sharedExecutionTarget: SharedQueuedExecutionTarget | undefined;
      let sharedPredecessorAttemptId: string | null | undefined;
      if (isSharedSession) {
        if (!activeWorkspace || !activeThreadId) {
          throw new Error("Shared follow-up 缺少 workspace/thread owner。");
        }
        const selectedTarget = getSharedTargetState(
          activeWorkspace.id,
          activeThreadId,
        ).selectedNextTarget;
        if (!isResolvedExecutionTarget(selectedTarget)) {
          throw new Error(
            "Shared follow-up Target 不完整，请重新选择 CLI、Provider 和 Model。",
          );
        }
        sharedExecutionTarget = cloneSharedExecutionTarget(selectedTarget);
        sharedPredecessorAttemptId = getSharedSendActiveAttemptId(
          activeWorkspace.id,
          activeThreadId,
        );
        if (
          isSharedFollowUpState(activeSharedSendState) &&
          !sharedPredecessorAttemptId
        ) {
          throw new Error(
            "Shared follow-up 缺少 durable predecessor Attempt，已拒绝入队。",
          );
        }
      }
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        createdAt: Date.now(),
        images: [...images],
        sendOptions:
          options === undefined ? undefined : structuredClone(options),
        ...(isSharedSession ? {} : { engine: activeEngine }),
        sharedExecutionTarget,
        sharedPredecessorAttemptId,
      };
    },
    [
      activeEngine,
      activeSharedSendState,
      activeThreadId,
      activeWorkspace,
      isSharedSession,
    ],
  );

  const enqueueMessage = useCallback(
    (threadId: string, item: QueuedMessage) => {
      setQueuedByThread((prev) => ({
        ...prev,
        [threadId]: [...(prev[threadId] ?? []), item],
      }));
    },
    [setQueuedByThread],
  );

  const removeQueuedMessage = useCallback(
    (threadId: string, messageId: string) => {
      if (inFlightByThread[threadId]?.id === messageId) {
        return;
      }
      queuedAfterTerminalPulseRef.current.delete(messageId);
      queuedAfterSharedRevisionRef.current.delete(messageId);
      setQueuedByThread((prev) => ({
        ...prev,
        [threadId]: (prev[threadId] ?? []).filter(
          (entry) => entry.id !== messageId,
        ),
      }));
    },
    [inFlightByThread, setQueuedByThread],
  );

  const insertQueuedMessageAt = useCallback(
    (threadId: string, item: QueuedMessage, index: number) => {
      setQueuedByThread((prev) => {
        const threadQueue = [...(prev[threadId] ?? [])];
        const boundedIndex = Math.max(0, Math.min(index, threadQueue.length));
        threadQueue.splice(boundedIndex, 0, item);
        return {
          ...prev,
          [threadId]: threadQueue,
        };
      });
    },
    [setQueuedByThread],
  );

  const prependQueuedMessage = useCallback(
    (threadId: string, item: QueuedMessage) => {
      insertQueuedMessageAt(threadId, item, 0);
    },
    [insertQueuedMessageAt],
  );

  const replaceQueuedMessage = useCallback(
    (threadId: string, item: QueuedMessage) => {
      setQueuedByThread((prev) => ({
        ...prev,
        [threadId]: (prev[threadId] ?? []).map((entry) =>
          entry.id === item.id ? item : entry,
        ),
      }));
    },
    [setQueuedByThread],
  );

  const withCodexCollaborationMode = useCallback(
    (options?: MessageSendOptions): MessageSendOptions | undefined => {
      if (activeEngine !== "codex") {
        return options;
      }
      const existingPayload = options?.collaborationMode;
      const existingModeRaw =
        existingPayload &&
          typeof existingPayload === "object" &&
          !Array.isArray(existingPayload)
          ? (existingPayload as Record<string, unknown>).mode
          : null;
      const existingMode = typeof existingModeRaw === "string"
        ? existingModeRaw.trim().toLowerCase()
        : null;
      if (existingMode === "plan" || existingMode === "code" || existingMode === "default") {
        return options;
      }
      const currentPayload = getCodexCollaborationPayload?.();
      if (
        currentPayload &&
        typeof currentPayload === "object" &&
        !Array.isArray(currentPayload)
      ) {
        return {
          ...(options ?? {}),
          collaborationMode: { ...currentPayload },
        };
      }
      const currentMode = getCodexCollaborationMode?.();
      if (currentMode !== "plan" && currentMode !== "code") {
        return options;
      }
      return {
        ...(options ?? {}),
        collaborationMode: {
          mode: currentMode,
          settings: {},
        },
      };
    },
    [
      activeEngine,
      getCodexCollaborationMode,
      getCodexCollaborationPayload,
    ],
  );

  const runSlashCommand = useCallback(
    async (
      command: SlashCommandKind,
      trimmed: string,
      options?: MessageSendOptions,
    ): Promise<boolean> => {
      if (
        (command === "plan" || command === "defaultMode" || command === "code") &&
        activeEngine === "codex" &&
        setCodexCollaborationMode
      ) {
        const targetMode = command === "plan" ? "plan" : "code";
        setCodexCollaborationMode(targetMode);
        const rest = trimmed
          .replace(/^\/(?:plan|default|code)\b/i, "")
          .trim();
        if (rest) {
          const modeOverrideOptions: MessageSendOptions = {
            ...(options ?? {}),
            collaborationMode: {
              mode: targetMode,
              settings: {},
            },
          };
          if (options) {
            await sendUserMessage(rest, [], modeOverrideOptions);
          } else {
            await sendUserMessage(rest, [], modeOverrideOptions);
          }
        }
        return true;
      }
      if (command === "mode" && activeEngine === "codex") {
        await startMode(trimmed);
        return true;
      }
      if (command === "fast" && activeEngine === "codex") {
        await startFast(trimmed);
        return true;
      }
      if (command === "fork") {
        await startFork(trimmed, withCodexCollaborationMode(options));
        return true;
      }
      if (command === "review") {
        await startReview(trimmed);
        return true;
      }
      if (command === "resume") {
        await startResume(trimmed);
        return true;
      }
      if (command === "mcp") {
        await startMcp(trimmed);
        return true;
      }
      if (command === "specRoot") {
        await startSpecRoot(trimmed);
        return true;
      }
      if (command === "status") {
        await startStatus(trimmed);
        return true;
      }
      if (command === "context") {
        await startContext(trimmed);
        return true;
      }
      if (command === "export") {
        await startExport(trimmed);
        return true;
      }
      if (command === "import") {
        await startImport(trimmed);
        return true;
      }
      if (command === "lsp") {
        await startLsp(trimmed);
        return true;
      }
      if (command === "share") {
        await startShare(trimmed);
        return true;
      }
      if (command === "compact") {
        await startCompact(trimmed);
        return true;
      }
      if (command === "clear" && activeWorkspace) {
        const threadEngine = activeThreadId
          ? getThreadEngine?.(activeWorkspace.id, activeThreadId)
          : undefined;
        const engine = normalizeEngineForExecution(threadEngine ?? activeEngine);
        const providerProfileId = activeThreadId
          ? (getThreadProviderProfileId?.(activeWorkspace.id, activeThreadId) ??
            null)
          : null;
        const threadId = await startThreadForWorkspace(activeWorkspace.id, {
          engine,
          ...(providerProfileId ? { providerProfileId } : {}),
        });
        const rest = trimmed.replace(/^\/(?:clear|reset)\b/i, "").trim();
        const effectiveOptions = withCodexCollaborationMode(options);
        if (threadId && rest) {
          if (effectiveOptions) {
            await sendUserMessageToThread(activeWorkspace, threadId, rest, [], effectiveOptions);
          } else {
            await sendUserMessageToThread(activeWorkspace, threadId, rest, []);
          }
        }
        return true;
      }
      if (command === "new" && activeWorkspace) {
        const threadEngine = activeThreadId
          ? getThreadEngine?.(activeWorkspace.id, activeThreadId)
          : undefined;
        const engine = normalizeEngineForExecution(threadEngine ?? activeEngine);
        const providerProfileId = activeThreadId
          ? (getThreadProviderProfileId?.(activeWorkspace.id, activeThreadId) ??
            null)
          : null;
        const threadId = await startThreadForWorkspace(activeWorkspace.id, {
          engine,
          ...(providerProfileId ? { providerProfileId } : {}),
        });
        const rest = trimmed.replace(/^\/new\b/i, "").trim();
        const effectiveOptions = withCodexCollaborationMode(options);
        if (threadId && rest) {
          if (effectiveOptions) {
            await sendUserMessageToThread(activeWorkspace, threadId, rest, [], effectiveOptions);
          } else {
            await sendUserMessageToThread(activeWorkspace, threadId, rest, []);
          }
        }
        return true;
      }
      return false;
    },
    [
      activeWorkspace,
      activeEngine,
      activeThreadId,
      getThreadEngine,
      getThreadProviderProfileId,
      setCodexCollaborationMode,
      sendUserMessage,
      sendUserMessageToThread,
      startFork,
      startReview,
      startResume,
      startMcp,
      startSpecRoot,
      startStatus,
      startContext,
      startExport,
      startImport,
      startLsp,
      startShare,
      startCompact,
      startFast,
      startMode,
      startThreadForWorkspace,
      withCodexCollaborationMode,
    ],
  );

  const dispatchQueuedMessage = useCallback(
    async (
      item: QueuedMessage,
      options?: { targetThreadId?: string | null },
    ): Promise<QueuedDispatchResult> => {
      const trimmed = item.text.trim();
      const command = parseSlashCommand(trimmed);
      const commandEnabled = canExecuteSlashCommand(
        command,
        activeEngine,
        activeThreadId,
      );
      if (activeWorkspace && !activeWorkspace.connected) {
        await connectWorkspace(activeWorkspace);
      }
      if (commandEnabled && command) {
        const handled = await runSlashCommand(command, trimmed, item.sendOptions);
        if (handled) {
          return "dispatched";
        }
      }
      const implicitModeQuery =
        activeEngine === "codex" &&
        !command &&
        (item.images?.length ?? 0) === 0 &&
        isImplicitModeQuery(trimmed);
      if (implicitModeQuery) {
        await startMode(trimmed);
        return "dispatched";
      }
      const frozenTargetOptions = item.sharedExecutionTarget
        ? {
            ...(item.sendOptions ?? {}),
            sharedExecutionTarget: item.sharedExecutionTarget,
          }
        : item.sendOptions;
      const effectiveOptions = withCodexCollaborationMode(frozenTargetOptions);
      const targetThreadId =
        options?.targetThreadId?.trim() ??
        (isSharedSession ? (activeThreadId?.trim() ?? "") : "");
      const shouldUseDirectThreadSend =
        (isSharedSession || activeEngine === "codex") &&
        Boolean(activeWorkspace && targetThreadId);
      if (shouldUseDirectThreadSend && activeWorkspace) {
        const response = await sendUserMessageToThread(
          activeWorkspace,
          targetThreadId,
          trimmed,
          item.images ?? [],
          effectiveOptions,
        );
        return isSharedSession
          ? classifySharedDispatchResult(response, item.sharedExecutionTarget)
          : "dispatched";
      }
      const engineFrozenOptions =
        item.engine !== undefined
          ? { ...(effectiveOptions ?? {}), engineOverride: item.engine }
          : effectiveOptions;
      if (engineFrozenOptions) {
        await sendUserMessage(trimmed, item.images ?? [], engineFrozenOptions);
      } else {
        await sendUserMessage(trimmed, item.images ?? []);
      }
      return "dispatched";
    },
    [
      activeEngine,
      activeThreadId,
      activeWorkspace,
      connectWorkspace,
      isSharedSession,
      runSlashCommand,
      sendUserMessage,
      sendUserMessageToThread,
      startMode,
      withCodexCollaborationMode,
    ],
  );

  const handleSend = useCallback(
    async (
      text: string,
      images: string[] = [],
      options?: MessageSendOptions,
    ) => {
      const trimmed = text.trim();
      const command = parseSlashCommand(trimmed);
      const commandEnabled = canExecuteSlashCommand(
        command,
        activeEngine,
        activeThreadId,
      );
      const nextImages = commandEnabled ? [] : images;
      if (!trimmed && nextImages.length === 0) {
        return;
      }
      if (activeThreadId && isReviewing) {
        return;
      }
      const shouldQueueSharedFollowUp =
        isSharedSession && isSharedFollowUpState(activeSharedSendState);
      const shouldQueueSharedCompaction =
        isSharedSession && isContextCompacting;
      if (
        isSharedSession &&
        activeSharedSendState !== "idle" &&
        !shouldQueueSharedFollowUp
      ) {
        return;
      }
      const shouldQueueWhileProcessing =
        isProcessing && (!steerEnabled || isClaudePendingBootstrapThread);
      const deliveryRequest = {
        intent: isProcessing && steerEnabled ? "steer" : "prompt",
        engine: activeEngine,
        sessionId: activeThreadId,
        activeRunId: isProcessing ? (activeTurnId ?? null) : null,
        allowFollowUpFallback: true,
      } as const;
      const deliveryResult = decideEngineMessageDelivery(deliveryRequest);
      recordDeliveryDecision(
        createEngineMessageDeliveryDiagnostic(deliveryRequest, deliveryResult),
      );
      // A pending AskUserQuestion also holds the queue: the turn is alive but
      // blocked on the answer, so a fresh send must queue rather than dispatch.
      if (
        activeThreadId &&
        (shouldQueueSharedFollowUp ||
          shouldQueueSharedCompaction ||
          shouldQueueWhileProcessing ||
          hasPendingUserInput ||
          (deliveryResult.status === "degraded" &&
            deliveryResult.route === "queue") ||
          (deliveryResult.status === "accepted" && deliveryResult.route === "queue"))
      ) {
        // Shared durable queue only accepts user prompts. Local slash commands
        // have no canonical V2 commit ACK and would otherwise execute once while
        // leaving a permanent pending-ack item behind.
        if (isSharedSession && command) {
          return;
        }
        const item = buildQueuedMessage(trimmed, nextImages, options);
        if (isProcessing && activeTurnId) {
          queuedAfterTerminalPulseRef.current.set(item.id, activeTerminalPulse);
        }
        enqueueMessage(activeThreadId, item);
        clearActiveImages();
        return;
      }
      if (deliveryResult.status === "rejected") {
        throw new Error(`Message delivery rejected: ${deliveryResult.reason}`);
      }
      await dispatchQueuedMessage(buildQueuedMessage(trimmed, nextImages, options));
      clearActiveImages();
    },
    [
      activeEngine,
      activeSharedSendState,
      activeThreadId,
      activeTerminalPulse,
      activeTurnId,
      buildQueuedMessage,
      clearActiveImages,
      dispatchQueuedMessage,
      enqueueMessage,
      hasPendingUserInput,
      isClaudePendingBootstrapThread,
      isContextCompacting,
      isProcessing,
      isReviewing,
      isSharedSession,
      recordDeliveryDecision,
      steerEnabled,
    ],
  );

  const queueMessage = useCallback(
    async (
      text: string,
      images: string[] = [],
      options?: MessageSendOptions,
    ) => {
      const trimmed = text.trim();
      const command = parseSlashCommand(trimmed);
      const commandEnabled = canExecuteSlashCommand(
        command,
        activeEngine,
        activeThreadId,
      );
      const nextImages = commandEnabled ? [] : images;
      if (!trimmed && nextImages.length === 0) {
        return;
      }
      if (activeThreadId && isReviewing) {
        return;
      }
      if (!activeThreadId) {
        return;
      }
      if (
        isSharedSession &&
        !isSharedFollowUpState(activeSharedSendState) &&
        !(activeSharedSendState === "idle" && isContextCompacting)
      ) {
        return;
      }
      if (isSharedSession && command) {
        return;
      }
      const item = buildQueuedMessage(trimmed, nextImages, options);
      if (isProcessing && activeTurnId) {
        queuedAfterTerminalPulseRef.current.set(item.id, activeTerminalPulse);
      }
      enqueueMessage(activeThreadId, item);
      clearActiveImages();
    },
    [
      activeEngine,
      activeSharedSendState,
      activeThreadId,
      activeTerminalPulse,
      activeTurnId,
      buildQueuedMessage,
      clearActiveImages,
      enqueueMessage,
      isProcessing,
      isReviewing,
      isContextCompacting,
      isSharedSession,
    ],
  );

  const dispatchFusionSuccessor = useCallback(
    async (
      threadId: string,
      messageId: string,
      fusionOverride?: ThreadFusionState,
    ) => {
      const dispatchKey = `${threadId}:${messageId}`;
      if (fusionDispatchingRef.current.has(dispatchKey)) {
        return;
      }
      const fusion = fusionOverride ?? fusionByThread[threadId];
      const item = (queuedByThread[threadId] ?? []).find(
        (entry) => entry.id === messageId,
      );
      if (!fusion || !item) {
        return;
      }
      fusionDispatchingRef.current.add(dispatchKey);
      const dispatchItem: QueuedMessage = isSharedSession
        ? { ...item, sharedDispatchState: "pending-ack" }
        : item;
      if (isSharedSession) {
        replaceQueuedMessage(threadId, dispatchItem);
      }
      setFusionByThread((prev) => {
        const current = prev[threadId];
        if (!current || current.messageId !== messageId) {
          return prev;
        }
        return {
          ...prev,
          [threadId]: {
            ...current,
            stage: "dispatching",
            startedAtMs: Date.now(),
            turnIdBeforeFusion: activeTurnId ?? null,
            continuationPulseAtStart: activeContinuationPulse,
            terminalPulseAtStart: activeTerminalPulse,
          },
        };
      });
      const successorItem =
        fusion.mode === "cutover"
          ? {
              ...dispatchItem,
              sendOptions: {
                ...(dispatchItem.sendOptions ?? {}),
                resumeSource: "queue-fusion-cutover" as const,
                resumeTurnId: fusion.turnIdBeforeFusion,
              },
            }
          : dispatchItem;
      try {
        const dispatchResult = await dispatchQueuedMessage(successorItem, {
          targetThreadId:
            isSharedSession || activeEngine === "codex" ? threadId : null,
        });
        const dispatchAccepted =
          dispatchResult === "committed" ||
          (!isSharedSession && dispatchResult === "dispatched");
        if (!dispatchAccepted) {
          if (isSharedSession && dispatchResult === "blocked") {
            replaceQueuedMessage(threadId, {
              ...dispatchItem,
              sharedDispatchState: undefined,
            });
            if (activeWorkspace) {
              queuedAfterSharedRevisionRef.current.set(
                messageId,
                getSharedSendStateRevision(activeWorkspace.id, threadId),
              );
            }
          }
          queuedAfterTerminalPulseRef.current.set(
            messageId,
            activeTerminalPulse,
          );
          setFusionByThread((prev) => ({ ...prev, [threadId]: null }));
          return;
        }
        if (dispatchResult === "committed") {
          // canonical commit 比 successor-start 更强：已证明 successor 启动且结算。
          queuedAfterTerminalPulseRef.current.delete(messageId);
          queuedAfterSharedRevisionRef.current.delete(messageId);
          setQueuedByThread((prev) => ({
            ...prev,
            [threadId]: (prev[threadId] ?? []).filter(
              (entry) => entry.id !== messageId,
            ),
          }));
          setFusionByThread((prev) => ({ ...prev, [threadId]: null }));
          return;
        }
        setFusionByThread((prev) => {
          const current = prev[threadId];
          if (!current || current.messageId !== messageId) {
            return prev;
          }
          return {
            ...prev,
            [threadId]: {
              ...current,
              stage: "awaiting-continuation",
              startedAtMs: Date.now(),
            },
          };
        });
      } catch (error) {
        queuedAfterTerminalPulseRef.current.set(messageId, activeTerminalPulse);
        setFusionByThread((prev) => ({ ...prev, [threadId]: null }));
        throw error;
      } finally {
        fusionDispatchingRef.current.delete(dispatchKey);
      }
    },
    [
      activeContinuationPulse,
      activeEngine,
      activeTerminalPulse,
      activeTurnId,
      activeWorkspace,
      dispatchQueuedMessage,
      fusionByThread,
      isSharedSession,
      queuedByThread,
      replaceQueuedMessage,
      setQueuedByThread,
    ],
  );

  const fuseQueuedMessage = useCallback(
    async (threadId: string, messageId: string) => {
      if (!activeThreadId || threadId !== activeThreadId) {
        return;
      }
      if (isClaudePendingBootstrapThread) {
        return;
      }
      if (!activeWorkspace || !isProcessing || isReviewing) {
        return;
      }
      if (
        isContextCompacting ||
        (isSharedSession &&
          !isSharedFollowUpState(activeSharedSendState))
      ) {
        return;
      }
      if (fusionByThread[threadId] || inFlightByThread[threadId]) {
        return;
      }
      const item = (queuedByThread[threadId] ?? []).find(
        (entry) => entry.id === messageId,
      );
      if (!item || !isQueuedMessageFuseEligible(item)) {
        return;
      }
      if (
        isSharedSession &&
        (!item.sharedPredecessorAttemptId ||
          item.sharedPredecessorAttemptId !==
            getSharedSendActiveAttemptId(activeWorkspace.id, threadId))
      ) {
        return;
      }
      if (isSharedSession) {
        const currentTarget = getSharedTargetState(
          activeWorkspace.id,
          threadId,
        ).selectedNextTarget;
        if (
          !item.sharedExecutionTarget ||
          !isResolvedExecutionTarget(currentTarget) ||
          !isSameSharedExecutionTarget(
            currentTarget,
            item.sharedExecutionTarget,
          )
        ) {
          return;
        }
      }
      const deliveryRequest = {
        intent: "steer" as const,
        engine: activeEngine,
        sessionId: threadId,
        activeRunId: activeTurnId ?? null,
      };
      const steeringDecision = decideEngineMessageDelivery(deliveryRequest);
      recordDeliveryDecision(
        createEngineMessageDeliveryDiagnostic(
          deliveryRequest,
          steeringDecision,
        ),
      );
      const useSameRunContinuation =
        steerEnabled &&
        steeringDecision.status !== "rejected" &&
        steeringDecision.route === "steer";
      const useSafeCutover =
        !useSameRunContinuation &&
        steeringDecision.evidence.midTurnCapability === "compat-input" &&
        typeof interruptTurn === "function";
      if (!useSameRunContinuation && !useSafeCutover) {
        return;
      }

      const nextFusion: ThreadFusionState = {
        messageId,
        turnIdBeforeFusion: activeTurnId ?? null,
        mode: useSameRunContinuation ? "same-run" : "cutover",
        stage: useSameRunContinuation
          ? "dispatching"
          : "awaiting-predecessor-settlement",
        startedAtMs: Date.now(),
        continuationPulseAtStart: activeContinuationPulse,
        terminalPulseAtStart: activeTerminalPulse,
      };
      setFusionByThread((prev) => ({
        ...prev,
        [threadId]: nextFusion,
      }));

      if (useSameRunContinuation) {
        await dispatchFusionSuccessor(threadId, messageId, nextFusion);
        return;
      }
      await interruptTurn?.({ reason: "queue-fusion" });
    },
    [
      activeEngine,
      activeThreadId,
      activeContinuationPulse,
      activeTerminalPulse,
      activeTurnId,
      activeWorkspace,
      dispatchFusionSuccessor,
      fusionByThread,
      inFlightByThread,
      interruptTurn,
      activeSharedSendState,
      isClaudePendingBootstrapThread,
      isContextCompacting,
      isProcessing,
      isReviewing,
      isSharedSession,
      queuedByThread,
      recordDeliveryDecision,
      steerEnabled,
    ],
  );

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }
    const fusion = fusionByThread[activeThreadId];
    if (
      !fusion ||
      fusion.mode !== "same-run" ||
      fusion.stage !== "dispatching"
    ) {
      return;
    }
    void dispatchFusionSuccessor(activeThreadId, fusion.messageId).catch(
      () => undefined,
    );
  }, [activeThreadId, dispatchFusionSuccessor, fusionByThread]);

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }
    const fusion = fusionByThread[activeThreadId];
    const predecessorSettled = isSharedSession
      ? activeSharedSendState === "idle"
      : activeTerminalPulse > (fusion?.terminalPulseAtStart ?? Infinity);
    if (
      !fusion ||
      fusion.stage !== "awaiting-predecessor-settlement" ||
      !predecessorSettled ||
      isProcessing ||
      (isSharedSession && isContextCompacting)
    ) {
      return;
    }
    void dispatchFusionSuccessor(activeThreadId, fusion.messageId).catch(
      () => undefined,
    );
  }, [
    activeSharedSendState,
    activeTerminalPulse,
    activeThreadId,
    dispatchFusionSuccessor,
    fusionByThread,
    isContextCompacting,
    isProcessing,
    isSharedSession,
  ]);

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }
    const fusion = fusionByThread[activeThreadId];
    if (!fusion || fusion.stage !== "awaiting-continuation") {
      return;
    }
    const hasSameRunContinuation =
      fusion.mode === "same-run"
      && activeContinuationPulse > fusion.continuationPulseAtStart;
    const hasCutoverContinuation =
      fusion.mode === "cutover" &&
      Boolean(activeTurnId) &&
      activeTurnId !== fusion.turnIdBeforeFusion;
    if (!hasSameRunContinuation && !hasCutoverContinuation) {
      return;
    }
    queuedAfterTerminalPulseRef.current.delete(fusion.messageId);
    queuedAfterSharedRevisionRef.current.delete(fusion.messageId);
    setQueuedByThread((prev) => ({
      ...prev,
      [activeThreadId]: (prev[activeThreadId] ?? []).filter(
        (entry) => entry.id !== fusion.messageId,
      ),
    }));
    setFusionByThread((prev) => ({
      ...prev,
      [activeThreadId]: null,
    }));
  }, [
    activeContinuationPulse,
    activeThreadId,
    activeTurnId,
    fusionByThread,
    setQueuedByThread,
  ]);

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }
    const handoffBubble = queuedHandoffByThread[activeThreadId];
    if (!handoffBubble) {
      return;
    }
    const timer = window.setTimeout(() => {
      setQueuedHandoffByThread((prev) => {
        const current = prev[activeThreadId];
        if (!current || current.id !== handoffBubble.id) {
          return prev;
        }
        return {
          ...prev,
          [activeThreadId]: null,
        };
      });
    }, QUEUED_HANDOFF_BUBBLE_TTL_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeThreadId, queuedHandoffByThread]);

  useEffect(() => {
    if (!activeThreadId || isSharedSession) {
      return;
    }
    const inFlight = inFlightByThread[activeThreadId];
    if (!inFlight) {
      return;
    }
    if (isProcessing || isReviewing) {
      if (!hasStartedByThread[activeThreadId]) {
        setHasStartedByThread((prev) => ({
          ...prev,
          [activeThreadId]: true,
        }));
      }
      return;
    }
    if (hasStartedByThread[activeThreadId]) {
      setInFlightByThread((prev) => ({ ...prev, [activeThreadId]: null }));
      setHasStartedByThread((prev) => ({ ...prev, [activeThreadId]: false }));
    }
  }, [
    activeThreadId,
    hasStartedByThread,
    inFlightByThread,
    isProcessing,
    isReviewing,
    isSharedSession,
  ]);

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }
    const fusion = fusionByThread[activeThreadId];
    if (
      !fusion ||
      (fusion.stage !== "awaiting-predecessor-settlement" &&
        fusion.stage !== "awaiting-continuation")
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      setFusionByThread((prev) => {
        const current = prev[activeThreadId];
        if (
          !current ||
          (current.stage !== "awaiting-predecessor-settlement" &&
            current.stage !== "awaiting-continuation")
        ) {
          return prev;
        }
        // Timeout 后无法证明 successor 是否已接受；保留 item，但禁止
        // auto-drain 盲重放。用户仍可显式再次 Fusion 或删除该 item。
        queuedAfterTerminalPulseRef.current.set(
          current.messageId,
          Number.MAX_SAFE_INTEGER,
        );
        return {
          ...prev,
          [activeThreadId]: null,
        };
      });
      handleFusionStalled?.(activeThreadId);
    }, FUSION_RESUME_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeThreadId, fusionByThread, handleFusionStalled]);

  useEffect(() => {
    if (activeEngine !== "opencode") {
      return;
    }
    if (!activeThreadId || isProcessing || isReviewing) {
      return;
    }
    const inFlight = inFlightByThread[activeThreadId];
    if (!inFlight) {
      return;
    }
    if (hasStartedByThread[activeThreadId]) {
      return;
    }
    const timer = window.setTimeout(() => {
      setInFlightByThread((prev) => {
        const current = prev[activeThreadId];
        if (!current || current.id !== inFlight.id) {
          return prev;
        }
        return { ...prev, [activeThreadId]: null };
      });
      setHasStartedByThread((prev) => ({ ...prev, [activeThreadId]: false }));
      prependQueuedMessage(activeThreadId, inFlight);
    }, OPENCODE_INFLIGHT_STALL_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    activeEngine,
    activeThreadId,
    hasStartedByThread,
    inFlightByThread,
    isProcessing,
    isReviewing,
    prependQueuedMessage,
  ]);

  useEffect(() => {
    if (!activeThreadId || isProcessing || isReviewing) {
      return;
    }
    if (
      isSharedSession &&
      (activeSharedSendState !== "idle" || isContextCompacting)
    ) {
      return;
    }
    // Hold the queue while an AskUserQuestion dialog is open: the CLI turn is
    // blocked awaiting the answer even though isProcessing may read false, so
    // flushing here would send the queued message as a fresh turn and strand
    // the pending answer (→ 5-min MCP timeout). The queue drains after the
    // dialog is settled and the turn resumes/ends.
    if (hasPendingUserInput) {
      return;
    }
    if (fusionByThread[activeThreadId]) {
      return;
    }
    if (inFlightByThread[activeThreadId]) {
      return;
    }
    const queue = queuedByThread[activeThreadId] ?? [];
    if (queue.length === 0) {
      return;
    }
    const threadId = activeThreadId;
    const nextItem = queue[0];
    if (!nextItem || nextItem.sharedDispatchState === "pending-ack") {
      return;
    }
    const queueDispatchKey = `${activeThreadId}:${nextItem.id}`;
    if (queueDispatchingRef.current.has(queueDispatchKey)) {
      return;
    }
    const blockedAtSharedRevision =
      queuedAfterSharedRevisionRef.current.get(nextItem.id);
    if (
      isSharedSession &&
      activeWorkspace &&
      blockedAtSharedRevision !== undefined &&
      getSharedSendStateRevision(activeWorkspace.id, activeThreadId) <=
        blockedAtSharedRevision
    ) {
      return;
    }
    const predecessorTerminalPulse =
      queuedAfterTerminalPulseRef.current.get(nextItem.id);
    if (
      !isSharedSession &&
      predecessorTerminalPulse !== undefined &&
      activeTerminalPulse <= predecessorTerminalPulse
    ) {
      return;
    }
    const nextTrimmedText = nextItem.text.trim();
    const shouldCreateHandoffBubble =
      !isSharedSession &&
      activeEngine === "codex" &&
      !parseSlashCommand(nextTrimmedText) &&
      !(
        (nextItem.images?.length ?? 0) === 0 &&
        isImplicitModeQuery(nextTrimmedText)
      );
    if (shouldCreateHandoffBubble) {
      setQueuedHandoffByThread((prev) => ({
        ...prev,
        [threadId]: buildQueuedHandoffBubbleItem(nextItem),
      }));
    }
    const dispatchItem: QueuedMessage = isSharedSession
      ? { ...nextItem, sharedDispatchState: "pending-ack" }
      : nextItem;
    if (isSharedSession) {
      replaceQueuedMessage(threadId, dispatchItem);
    }
    setInFlightByThread((prev) => ({ ...prev, [threadId]: dispatchItem }));
    setHasStartedByThread((prev) => ({ ...prev, [threadId]: false }));
    queuedAfterTerminalPulseRef.current.delete(nextItem.id);
    queuedAfterSharedRevisionRef.current.delete(nextItem.id);
    queueDispatchingRef.current.add(queueDispatchKey);
    (async () => {
      try {
        const dispatchResult = await dispatchQueuedMessage(dispatchItem, {
          targetThreadId:
            isSharedSession || activeEngine === "codex" ? threadId : null,
        });
        const dispatchAccepted =
          dispatchResult === "committed" ||
          (!isSharedSession && dispatchResult === "dispatched");
        if (dispatchAccepted) {
          queuedAfterSharedRevisionRef.current.delete(nextItem.id);
          setQueuedByThread((prev) => ({
            ...prev,
            [threadId]: (prev[threadId] ?? []).filter(
              (entry) => entry.id !== nextItem.id,
            ),
          }));
          if (isSharedSession) {
            setInFlightByThread((prev) => ({ ...prev, [threadId]: null }));
            setHasStartedByThread((prev) => ({ ...prev, [threadId]: false }));
          }
          return;
        }
        if (isSharedSession && dispatchResult === "blocked") {
          replaceQueuedMessage(threadId, {
            ...dispatchItem,
            sharedDispatchState: undefined,
          });
          if (activeWorkspace) {
            queuedAfterSharedRevisionRef.current.set(
              nextItem.id,
              getSharedSendStateRevision(activeWorkspace.id, threadId),
            );
          }
        }
        queuedAfterTerminalPulseRef.current.set(
          nextItem.id,
          activeTerminalPulse,
        );
        setInFlightByThread((prev) => ({ ...prev, [threadId]: null }));
        setHasStartedByThread((prev) => ({ ...prev, [threadId]: false }));
        setQueuedHandoffByThread((prev) => ({ ...prev, [threadId]: null }));
      } catch {
        if (isSharedSession) {
          queuedAfterTerminalPulseRef.current.set(
            nextItem.id,
            activeTerminalPulse,
          );
        }
        setInFlightByThread((prev) => ({ ...prev, [threadId]: null }));
        setHasStartedByThread((prev) => ({ ...prev, [threadId]: false }));
        setQueuedHandoffByThread((prev) => ({ ...prev, [threadId]: null }));
        if (!isSharedSession) {
          // Native queue item 尚未删除；保持原位等待既有恢复策略。
          return;
        }
      } finally {
        queueDispatchingRef.current.delete(queueDispatchKey);
      }
    })();
  }, [
    activeEngine,
    activeSharedSendState,
    activeThreadId,
    activeTerminalPulse,
    activeWorkspace,
    dispatchQueuedMessage,
    fusionByThread,
    hasPendingUserInput,
    inFlightByThread,
    isProcessing,
    isReviewing,
    isContextCompacting,
    isSharedSession,
    queuedByThread,
    replaceQueuedMessage,
    setQueuedByThread,
  ]);

  return {
    queuedByThread,
    activeQueue,
    activeQueuedHandoffBubble,
    handleSend,
    queueMessage,
    removeQueuedMessage,
    fuseQueuedMessage,
    canFuseActiveQueue,
    fuseDisabledReasonKey,
    activeFusingMessageId,
  };
}
