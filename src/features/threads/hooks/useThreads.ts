import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type {
  CustomPromptOption,
  DebugEntry,
  ThreadSummary,
  WorkspaceInfo,
  WorkspaceSessionAttributionMode,
} from "../../../types";
import { useAppServerEvents } from "../../app/hooks/useAppServerEvents";
import {
  subscribeWechatSessionUpdated,
  subscribeWebServiceReconnect,
} from "../../../services/events";
import { createInitialThreadState, threadReducer } from "./useThreadsReducer";
import {
  type PendingMemoryCapture,
  buildMemoryTurnKey,
  joinPendingAssistantCompletionText,
  memoryDebugLog,
  normalizeAssistantOutputForMemory,
  normalizeDigestSummaryForMemory,
  PENDING_MEMORY_STALE_MS,
  upsertPendingAssistantCompletionSegment,
} from "./threadMemoryCaptureHelpers";
import {
  type CodexOwnershipFallbackCandidateInput,
  type PendingAssistantCompletionBucket,
  type PendingMemoryCaptureBucket,
  THREAD_ITEM_CACHE_TRIM_WATERMARK,
  computeThreadItemCacheMax,
  deletePendingMemoryEntry,
  getPendingMemoryEntries,
  isCodexOwnershipFallbackCandidate,
  setPendingMemoryEntry,
  shouldKeepPendingCaptureForAdditionalAssistantSegments,
} from "./threadRuntimeOwnershipHelpers";
import { useThreadStorage } from "./useThreadStorage";
import { useThreadLinking } from "./useThreadLinking";
import { useThreadEventHandlers } from "./useThreadEventHandlers";
import { useThreadActions } from "./useThreadActions";
import { useThreadMessaging } from "./useThreadMessaging";
import { useThreadApprovals } from "./useThreadApprovals";
import type { TurnExecutionSnapshot } from "../../shared-session/target/types";
import {
  cleanupThreadScopedRefs,
  createWorkspaceScopedMap,
  workspaceScopedEntries,
  workspaceScopedGet,
  workspaceScopedHas,
  workspaceScopedSet,
  type WorkspaceScopedMap,
} from "./workspaceScopedMap";
import { useThreadAccountInfo } from "./useThreadAccountInfo";
import { useThreadRateLimits } from "./useThreadRateLimits";
import { useThreadSelectors } from "./useThreadSelectors";
import { useThreadStatus } from "./useThreadStatus";
import { registerCollabThreadProcessingMarker } from "../../multi-agent/runtime/collabThreadProcessingBridge";
import { useThreadUserInput } from "./useThreadUserInput";
import { useThreadCompletionEmail } from "./useThreadCompletionEmail";
import { useMailDrivenSessionContinuation } from "./useMailDrivenSessionContinuation";
import { useThreadRealtimeHistoryReconcile } from "./useThreadRealtimeHistoryReconcile";
import {
  resolveClaudeContinuationThreadId as resolveClaudeContinuationThreadIdFromState,
  shouldShowHistoryLoadingForSelectionThread,
} from "../utils/claudeThreadContinuity";
import { clearLiveAssistantText } from "@/conversation-presentation/liveAssistantTextChannel";
import {
  resolvePendingThreadIdForSession,
  resolvePendingThreadIdForTurn,
} from "../utils/threadPendingResolution";
export {
  resolvePendingThreadIdForSession,
  resolvePendingThreadIdForTurn,
} from "../utils/threadPendingResolution";
import {
  mapDeleteErrorCode,
  shouldSettleDeleteAsSuccess,
  type ThreadDeleteErrorCode,
} from "../utils/threadDelete";
import {
  collectCanonicalActiveThreadRebindings,
  makeCustomNameKey,
  saveCustomName,
} from "../utils/threadStorage";
import { writeClientStoreValue } from "../../../services/clientStorage";
import { appendRendererDiagnostic } from "../../../services/rendererDiagnostics";
import { isWebServiceRuntime } from "../../../services/tauri/runtimeMode";
import {
  loadSidebarSnapshot,
  saveSidebarSnapshotAllThreads,
} from "../utils/sidebarSnapshot";
import {
  generateThreadTitle,
  listThreadTitles,
  resumeThread,
  setThreadTitle,
  projectMemoryCompleteTurn,
  deleteCodexSessions,
  noteWebServiceReconnected,
} from "../../../services/tauri";
import { buildAssistantOutputDigest } from "../../project-memory/utils/outputDigest";
import {
  classifyMemoryImportance,
  classifyMemoryKind,
} from "../../project-memory/utils/memoryKindClassifier";
import {
  shouldMergeOnAssistantCompleted,
  shouldMergeOnInputCapture,
} from "../utils/memoryCaptureRace";
import { buildItemsFromThread } from "../../../utils/threadItems";
import i18n from "../../../i18n";
import { clearSharedSessionBindingsForSharedThread } from "../../shared-session/runtime/sharedSessionBridge";
import { isSharedSessionThreadId } from "../../shared-session/utils/sharedSessionIdentity";
import {
  syncSharedSessionSnapshot as syncSharedSessionSnapshotService,
} from "../../shared-session/services/sharedSessions";
import { isSharedV2SendEnabled } from "../../shared-session/runtime/sharedV2SendFlag";
import { normalizeSharedSessionEngine } from "../../shared-session/utils/sharedSessionEngines";
import { type ConversationCompletionEmailMetadata } from "../utils/conversationCompletionEmail";
import {
  createDomainEventGovernanceConsumer,
  createDomainEventRuntimeController,
} from "../domain-events";

export { computeThreadItemCacheMax } from "./threadRuntimeOwnershipHelpers";

const AUTO_TITLE_REQUEST_TIMEOUT_MS = 8_000;
const AUTO_TITLE_MAX_ATTEMPTS = 2;
const AUTO_TITLE_PENDING_STALE_MS = 20_000;
const THREAD_ERROR_DUPLICATE_WINDOW_MS = 8_000;
const THREAD_SWITCH_RESUME_DELAY_MS = 24;
const THREAD_SWITCH_LOADED_REFRESH_MS = 20_000;

function normalizeMemoryTurnId(turnId: string | null | undefined) {
  return turnId?.trim() || "__unknown_turn__";
}

function isSameMemoryTurn(
  leftTurnId: string | null | undefined,
  rightTurnId: string | null | undefined,
) {
  return (
    normalizeMemoryTurnId(leftTurnId) === normalizeMemoryTurnId(rightTurnId)
  );
}

type UseThreadsOptions = {
  activeWorkspace: WorkspaceInfo | null;
  onWorkspaceConnected: (id: string) => void;
  onWorkspaceModelsRefresh?: () => Promise<void> | void;
  onDebug?: (entry: DebugEntry) => void;
  model?: string | null;
  effort?: string | null;
  collaborationMode?: Record<string, unknown> | null;
  resolveComposerSelection?: () => {
    id?: string | null;
    model: string | null;
    source?: string | null;
    providerProfileId?: string | null;
    effort: string | null;
    collaborationMode: Record<string, unknown> | null;
  };
  claudeThinkingVisible?: boolean;
  accessMode?: "default" | "read-only" | "current" | "full-access";
  steerEnabled?: boolean;
  customPrompts?: CustomPromptOption[];
  onMessageActivity?: () => void;
  activeEngine?: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode";
  useNormalizedRealtimeAdapters?: boolean;
  useUnifiedHistoryLoader?: boolean;
  sessionAttributionMode?: WorkspaceSessionAttributionMode;
  resolveOpenCodeAgent?: (threadId: string | null) => string | null;
  resolveOpenCodeVariant?: (threadId: string | null) => string | null;
  resolveCollaborationUiMode?: (threadId: string) => "plan" | "code" | null;
  resolveCollaborationRuntimeMode?: (
    threadId: string,
  ) => "plan" | "code" | null;
  onCollaborationModeResolved?: (payload: {
    workspaceId: string;
    threadId: string;
    selectedUiMode: "plan" | "default";
    effectiveRuntimeMode: "plan" | "code";
    effectiveUiMode: "plan" | "default";
    fallbackReason: string | null;
  }) => void;
  runWithCreateSessionLoading?: <T>(
    params: {
      workspace: WorkspaceInfo;
      engine: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode";
    },
    action: () => Promise<T>,
  ) => Promise<T>;
};

export type { ThreadDeleteErrorCode } from "../utils/threadDelete";

export type ThreadDeleteResult = {
  threadId: string;
  success: boolean;
  code: ThreadDeleteErrorCode | null;
  message: string | null;
};

export function useThreads({
  activeWorkspace,
  onWorkspaceConnected,
  onWorkspaceModelsRefresh,
  onDebug,
  model,
  effort,
  collaborationMode,
  resolveComposerSelection,
  claudeThinkingVisible,
  accessMode,
  steerEnabled = false,
  customPrompts = [],
  onMessageActivity,
  activeEngine = "claude",
  useNormalizedRealtimeAdapters = true,
  useUnifiedHistoryLoader = false,
  sessionAttributionMode = "related",
  resolveOpenCodeAgent,
  resolveOpenCodeVariant,
  resolveCollaborationUiMode,
  resolveCollaborationRuntimeMode,
  onCollaborationModeResolved,
  runWithCreateSessionLoading,
}: UseThreadsOptions) {
  const [state, dispatch] = useReducer(
    threadReducer,
    loadSidebarSnapshot(),
    createInitialThreadState,
  );
  const domainEventRuntimeController = useMemo(
    () => createDomainEventRuntimeController(),
    [],
  );
  const domainEventGovernanceConsumer = useMemo(
    () =>
      createDomainEventGovernanceConsumer(domainEventRuntimeController.runtime),
    [domainEventRuntimeController],
  );
  useEffect(() => {
    domainEventGovernanceConsumer.getSnapshot();
    return () => {
      domainEventGovernanceConsumer.unsubscribe();
    };
  }, [domainEventGovernanceConsumer]);
  const loadedThreadsRef = useRef<Record<string, boolean>>({});
  const threadStatusByIdRef = useRef(state.threadStatusById);
  const itemsByThreadRef = useRef(state.itemsByThread);
  const activeTurnIdByThreadRef = useRef(state.activeTurnIdByThread);
  const threadsByWorkspaceRef = useRef(state.threadsByWorkspace);
  const immediateThreadWorkspaceByIdRef = useRef<Record<string, string>>({});
  const immediateThreadCodexCandidateByIdRef = useRef<Record<string, boolean>>(
    {},
  );
  const immediateProcessingCodexThreadIdsByWorkspaceRef = useRef<
    Record<string, Set<string>>
  >({});
  const activeWorkspaceRef = useRef(activeWorkspace);
  const activeThreadIdRef = useRef<string | null>(null);
  const loadedThreadLastRefreshAtRef = useRef<Record<string, number>>({});
  const lazyResumeTimerByWorkspaceRef = useRef<
    Record<string, ReturnType<typeof setTimeout> | null>
  >({});
  const historyLoadingThreadByWorkspaceRef = useRef<
    Record<string, string | null>
  >({});
  const historyLoadingStateByThreadRef = useRef<
    Record<string, true | "failed">
  >({});
  const historySelectionGenerationByScopeRef = useRef<Record<string, number>>(
    {},
  );
  const activeThreadIdByWorkspaceRef = useRef(state.activeThreadIdByWorkspace);
  const replaceOnResumeRef = useRef<Record<string, boolean>>({});
  // chat-stream-render-isolation-2026-06 task 8: workspace-scope these
  // 6 thread-scoped in-flight refs so a workspace switch cannot resurrect
  // stale entries from a previous workspace. The 3 Set refs use boolean
  // values; the 2 pending memory refs keep per-thread turn buckets. The
  // 5 additional Record refs
  // listed in proposal footnote (loadedThreadLastRefreshAtRef,
  // historyLoadingThreadByWorkspaceRef, codexCompactionInFlightByThreadRef,
  // sharedSessionLastSignatureByThreadRef, sharedSessionSyncTimerByThreadRef)
  // are follow-up 11.6 and stay in the original shape.
  const pendingInterruptsRef = useRef<WorkspaceScopedMap<true>>(
    createWorkspaceScopedMap<true>(),
  );
  const interruptedThreadsRef = useRef<WorkspaceScopedMap<true>>(
    createWorkspaceScopedMap<true>(),
  );
  const codexCompactionInFlightByThreadRef = useRef<Record<string, boolean>>(
    {},
  );
  const pendingMemoryCaptureRef = useRef<
    WorkspaceScopedMap<PendingMemoryCaptureBucket>
  >(createWorkspaceScopedMap<PendingMemoryCaptureBucket>());
  const pendingAssistantCompletionRef = useRef<
    WorkspaceScopedMap<PendingAssistantCompletionBucket>
  >(createWorkspaceScopedMap<PendingAssistantCompletionBucket>());
  const recentThreadErrorsRef = useRef<
    WorkspaceScopedMap<{ message: string; at: number }>
  >(createWorkspaceScopedMap<{ message: string; at: number }>());
  const handledClaudeExitPlanToolIdsRef = useRef<WorkspaceScopedMap<true>>(
    createWorkspaceScopedMap<true>(),
  );
  const cleanupThreadTransientStateRef = useRef<
    (workspaceId: string | null | undefined, threadId: string) => number
  >(() => 0);
  const settleSharedDurableTurnRef = useRef<
    (threadId: string, runtimeTurnId: string) => void
  >(() => {});
  const settleSharedDurableTurn = useCallback(
    (threadId: string, runtimeTurnId: string) => {
      settleSharedDurableTurnRef.current(threadId, runtimeTurnId);
    },
    [],
  );
  const registerSharedDurableTurnSettlement = useCallback(
    (settle: (threadId: string, runtimeTurnId: string) => void) => {
      settleSharedDurableTurnRef.current = settle;
      return () => {
        if (settleSharedDurableTurnRef.current === settle) {
          settleSharedDurableTurnRef.current = () => {};
        }
      };
    },
    [],
  );
  const sharedSessionSyncTimerByThreadRef = useRef<
    Record<string, ReturnType<typeof setTimeout> | null>
  >({});
  // 以「引用相等」代替 JSON.stringify 全量序列化做变更检测：reducer 对 items
  // 做不可变更新，引用不变 => 内容不变；避免每次 flush 对全部 shared thread
  // 的整段对话做 O(序列化体积) 的深比较。
  const sharedSessionLastSignatureByThreadRef = useRef<
    Record<string, { selectedEngine: string; items: unknown }>
  >({});
  const {
    customNamesRef,
    threadActivityRef,
    threadAliasesRef,
    pinnedThreadsVersion,
    getCustomName,
    resolveCanonicalThreadId,
    rememberThreadAlias,
    clearThreadAlias,
    recordThreadActivity,
    pinThread,
    unpinThread,
    isThreadPinned,
    getPinTimestamp,
    markAutoTitlePending,
    clearAutoTitlePending,
    isAutoTitlePending,
    getAutoTitlePendingStartedAt,
    renameAutoTitlePendingKey,
    autoTitlePendingVersion: _autoTitlePendingVersion,
  } = useThreadStorage();

  const activeWorkspaceId = activeWorkspace?.id ?? null;
  const resolveWorkspacePath = useCallback((workspaceId: string) => {
    const workspace = activeWorkspaceRef.current;
    return workspace?.id === workspaceId ? workspace.path : null;
  }, []);
  const { activeThreadId, activeItems } = useThreadSelectors({
    activeWorkspaceId,
    activeThreadIdByWorkspace: state.activeThreadIdByWorkspace,
    itemsByThread: state.itemsByThread,
  });

  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
  }, [activeWorkspace]);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  const { refreshAccountRateLimits } = useThreadRateLimits({
    activeWorkspaceId,
    activeWorkspaceConnected: activeWorkspace?.connected,
    dispatch,
    onDebug,
  });
  const { refreshAccountInfo } = useThreadAccountInfo({
    activeWorkspaceId,
    activeWorkspaceConnected: activeWorkspace?.connected,
    dispatch,
    onDebug,
  });

  const { markProcessing, markReviewing, setActiveTurnId } = useThreadStatus({
    dispatch,
  });

  const rememberImmediateThreadOwner = useCallback(
    (
      workspaceId: string,
      threadId: string,
      thread?: CodexOwnershipFallbackCandidateInput,
    ) => {
      const normalizedWorkspaceId = workspaceId.trim();
      const normalizedThreadId = threadId.trim();
      if (!normalizedWorkspaceId || !normalizedThreadId) {
        return;
      }
      immediateThreadWorkspaceByIdRef.current[normalizedThreadId] =
        normalizedWorkspaceId;
      if (thread) {
        immediateThreadCodexCandidateByIdRef.current[normalizedThreadId] =
          isCodexOwnershipFallbackCandidate(thread);
        return;
      }
      if (
        immediateThreadCodexCandidateByIdRef.current[normalizedThreadId] ===
        undefined
      ) {
        immediateThreadCodexCandidateByIdRef.current[normalizedThreadId] =
          isCodexOwnershipFallbackCandidate({ id: normalizedThreadId });
      }
    },
    [],
  );

  const markImmediateCodexProcessingOwner = useCallback(
    (
      workspaceId: string | null | undefined,
      threadId: string,
      isProcessing: boolean,
    ) => {
      const normalizedThreadId = threadId.trim();
      if (!normalizedThreadId) {
        return;
      }
      const normalizedWorkspaceId =
        workspaceId?.trim() ||
        immediateThreadWorkspaceByIdRef.current[normalizedThreadId] ||
        activeWorkspaceRef.current?.id?.trim() ||
        "";
      if (!normalizedWorkspaceId) {
        if (!isProcessing) {
          for (const threadIds of Object.values(
            immediateProcessingCodexThreadIdsByWorkspaceRef.current,
          )) {
            threadIds.delete(normalizedThreadId);
          }
        }
        return;
      }
      rememberImmediateThreadOwner(normalizedWorkspaceId, normalizedThreadId);
      const isCodexCandidate =
        immediateThreadCodexCandidateByIdRef.current[normalizedThreadId] ??
        isCodexOwnershipFallbackCandidate({ id: normalizedThreadId });
      if (!isCodexCandidate) {
        for (const threadIds of Object.values(
          immediateProcessingCodexThreadIdsByWorkspaceRef.current,
        )) {
          threadIds.delete(normalizedThreadId);
        }
        return;
      }
      let threadIds =
        immediateProcessingCodexThreadIdsByWorkspaceRef.current[
          normalizedWorkspaceId
        ];
      if (!threadIds) {
        threadIds = new Set<string>();
        immediateProcessingCodexThreadIdsByWorkspaceRef.current[
          normalizedWorkspaceId
        ] = threadIds;
      }
      if (isProcessing) {
        threadIds.add(normalizedThreadId);
        return;
      }
      threadIds.delete(normalizedThreadId);
    },
    [rememberImmediateThreadOwner],
  );

  const markProcessingWithImmediateOwner = useCallback(
    (threadId: string, isProcessing: boolean) => {
      markImmediateCodexProcessingOwner(null, threadId, isProcessing);
      markProcessing(threadId, isProcessing);
    },
    [markImmediateCodexProcessingOwner, markProcessing],
  );

  // Multi-Agent 协作生命周期 → 左侧会话蓝点 / 代理电（executor 经 bridge 调用）
  useEffect(() => {
    registerCollabThreadProcessingMarker(markProcessingWithImmediateOwner);
    return () => {
      registerCollabThreadProcessingMarker(null);
    };
  }, [markProcessingWithImmediateOwner]);

  const pushThreadErrorMessage = useCallback(
    (
      workspaceId: string,
      threadId: string,
      message: string,
      executionTargetSnapshot?: TurnExecutionSnapshot,
    ) => {
      const normalized = message.trim();
      if (normalized) {
        const now = Date.now();
        const recent = workspaceScopedGet(
          recentThreadErrorsRef.current,
          workspaceId,
          threadId,
        );
        if (
          recent &&
          recent.message === normalized &&
          now - recent.at < THREAD_ERROR_DUPLICATE_WINDOW_MS
        ) {
          return;
        }
        workspaceScopedSet(
          recentThreadErrorsRef.current,
          workspaceId,
          threadId,
          { message: normalized, at: now },
        );
      }
      dispatch({
        type: "addAssistantMessage",
        threadId,
        text: message,
        ...(executionTargetSnapshot ? { executionTargetSnapshot } : {}),
      });
      if (threadId !== activeThreadId) {
        dispatch({ type: "markUnread", threadId, hasUnread: true });
      }
    },
    [activeThreadId, dispatch],
  );

  const safeMessageActivity = useCallback(() => {
    try {
      void onMessageActivity?.();
    } catch {
      // Ignore refresh errors to avoid breaking the UI.
    }
  }, [onMessageActivity]);

  const getCompletionEmailMetadata = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
    ): ConversationCompletionEmailMetadata => {
      const threadSummary =
        (threadsByWorkspaceRef.current[workspaceId] ?? []).find(
          (thread) => thread.id === threadId,
        ) ?? null;
      return {
        workspaceId,
        workspaceName:
          activeWorkspace?.id === workspaceId ? activeWorkspace.name : null,
        workspacePath:
          activeWorkspace?.id === workspaceId ? activeWorkspace.path : null,
        threadId,
        threadName: threadSummary?.name ?? null,
        turnId,
        engine: threadSummary?.engineSource ?? activeEngine ?? null,
      };
    },
    [activeEngine, activeWorkspace],
  );
  const {
    completionEmailIntentByThread,
    armMailDrivenCompletionEmail,
    clearCompletionEmailIntent,
    toggleCompletionEmailIntent,
    setActiveTurnIdWithCompletionEmail,
    renameCompletionEmailIntentThread,
    settleCompletionEmailIntent,
  } = useThreadCompletionEmail({
    activeThreadId,
    activeTurnIdByThreadRef,
    itemsByThreadRef,
    resolveCanonicalThreadId,
    setActiveTurnId,
    getCompletionEmailMetadata,
    onDebug,
  });

  // chat-stream-render-isolation-2026-06 task 4: collapse the five
  // per-slice ref-sync effects into a single effect so dispatching
  // state only schedules one React commit's worth of ref work.
  useEffect(() => {
    activeThreadIdByWorkspaceRef.current = state.activeThreadIdByWorkspace;
    threadStatusByIdRef.current = state.threadStatusById;
    itemsByThreadRef.current = state.itemsByThread;
    activeTurnIdByThreadRef.current = state.activeTurnIdByThread;
    threadsByWorkspaceRef.current = state.threadsByWorkspace;
  }, [
    state.activeThreadIdByWorkspace,
    state.threadStatusById,
    state.itemsByThread,
    state.activeTurnIdByThread,
    state.threadsByWorkspace,
  ]);

  // 派生表是 O(所有线程) 的循环，只依赖 threadsByWorkspace/threadStatusById；
  // 与上面的 ref 同步拆开，避免 itemsByThread 每次 delta flush（~32ms）都全量重算。
  useEffect(() => {
    const nextThreadWorkspaceById: Record<string, string> = {};
    const nextThreadCodexCandidateById: Record<string, boolean> = {};
    const nextProcessingCodexThreadIdsByWorkspace: Record<
      string,
      Set<string>
    > = {};
    for (const [workspaceId, threads] of Object.entries(
      state.threadsByWorkspace,
    )) {
      for (const thread of threads) {
        nextThreadWorkspaceById[thread.id] = workspaceId;
        const isCodexCandidate = isCodexOwnershipFallbackCandidate(thread);
        nextThreadCodexCandidateById[thread.id] = isCodexCandidate;
        if (!isCodexCandidate) {
          continue;
        }
        if (!state.threadStatusById[thread.id]?.isProcessing) {
          continue;
        }
        let processingThreadIds =
          nextProcessingCodexThreadIdsByWorkspace[workspaceId];
        if (!processingThreadIds) {
          processingThreadIds = new Set<string>();
          nextProcessingCodexThreadIdsByWorkspace[workspaceId] =
            processingThreadIds;
        }
        processingThreadIds.add(thread.id);
      }
    }
    immediateThreadWorkspaceByIdRef.current = nextThreadWorkspaceById;
    immediateThreadCodexCandidateByIdRef.current = nextThreadCodexCandidateById;
    immediateProcessingCodexThreadIdsByWorkspaceRef.current =
      nextProcessingCodexThreadIdsByWorkspace;
  }, [state.threadStatusById, state.threadsByWorkspace]);

  useEffect(() => {
    saveSidebarSnapshotAllThreads(state.threadsByWorkspace);
  }, [state.threadsByWorkspace]);

  useEffect(() => {
    return () => {
      Object.values(lazyResumeTimerByWorkspaceRef.current).forEach((timer) => {
        if (timer) {
          clearTimeout(timer);
        }
      });
      lazyResumeTimerByWorkspaceRef.current = {};
      historyLoadingThreadByWorkspaceRef.current = {};
      historySelectionGenerationByScopeRef.current = {};
      Object.values(sharedSessionSyncTimerByThreadRef.current).forEach(
        (timer) => {
          if (timer) {
            clearTimeout(timer);
          }
        },
      );
      sharedSessionSyncTimerByThreadRef.current = {};
    };
  }, []);
  const {
    applyCollabThreadLinks,
    applyCollabThreadLinksFromThread,
    updateThreadParent,
  } = useThreadLinking({
    dispatch,
    threadParentById: state.threadParentById,
  });

  const handleWorkspaceConnected = useCallback(
    (workspaceId: string) => {
      onWorkspaceConnected(workspaceId);
      if (workspaceId === activeWorkspace?.id) {
        void onWorkspaceModelsRefresh?.();
      }
      void refreshAccountRateLimits(workspaceId);
      void refreshAccountInfo(workspaceId);
    },
    [
      activeWorkspace?.id,
      onWorkspaceConnected,
      onWorkspaceModelsRefresh,
      refreshAccountRateLimits,
      refreshAccountInfo,
    ],
  );

  const isThreadHidden = useCallback(
    (workspaceId: string, threadId: string) =>
      Boolean(state.hiddenThreadIdsByWorkspace[workspaceId]?.[threadId]),
    [state.hiddenThreadIdsByWorkspace],
  );

  const getThreadEngine = useCallback(
    (workspaceId: string, threadId: string): "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | undefined => {
      const threads = state.threadsByWorkspace[workspaceId] ?? [];
      const thread = threads.find((t) => t.id === threadId);
      return thread?.engineSource;
    },
    [state.threadsByWorkspace],
  );

  const getThreadKind = useCallback(
    (workspaceId: string, threadId: string): "native" | "shared" => {
      // id-first：shared: 前缀是身份 hard gate，threadKind 投影可丢
      // （fix-shared-session-identity-id-first）。send/delete 共用此解析。
      if (isSharedSessionThreadId(threadId)) {
        return "shared";
      }
      const threads = state.threadsByWorkspace[workspaceId] ?? [];
      const thread = threads.find((t) => t.id === threadId);
      return thread?.threadKind === "shared" ? "shared" : "native";
    },
    [state.threadsByWorkspace],
  );

  const getThreadProviderProfileId = useCallback(
    (workspaceId: string, threadId: string): string | null => {
      const threads = threadsByWorkspaceRef.current[workspaceId] ?? [];
      const thread = threads.find((t) => t.id === threadId);
      return thread?.providerProfileId?.trim() || null;
    },
    [],
  );

  const resolvePendingThreadForSession = useCallback(
    (
      workspaceId: string,
      engine: "claude" | "gemini" | "grok" | "kimi" | "opencode",
    ): string | null => {
      const resolved = resolvePendingThreadIdForSession({
        workspaceId,
        engine,
        threadsByWorkspace: state.threadsByWorkspace,
        activeThreadIdByWorkspace: state.activeThreadIdByWorkspace,
        threadStatusById: state.threadStatusById,
        activeTurnIdByThread: state.activeTurnIdByThread,
        itemsByThread: state.itemsByThread,
      });
      const pendingPrefix = `${engine}-pending-`;
      const pendingCandidates = (state.threadsByWorkspace[workspaceId] ?? [])
        .map((thread) => thread.id)
        .filter((threadId) => threadId.startsWith(pendingPrefix));
      onDebug?.({
        id: `${Date.now()}-thread-session-resolve`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/session:resolve-pending",
        payload: {
          workspaceId,
          engine,
          activeThreadId: state.activeThreadIdByWorkspace[workspaceId] ?? null,
          pendingCandidates,
          resolved,
          anchors: pendingCandidates.map((threadId) => ({
            threadId,
            hasTurn: (state.activeTurnIdByThread[threadId] ?? null) !== null,
            itemCount: state.itemsByThread[threadId]?.length ?? 0,
            isProcessing: Boolean(
              state.threadStatusById[threadId]?.isProcessing,
            ),
          })),
        },
      });
      return resolved;
    },
    [
      onDebug,
      state.activeThreadIdByWorkspace,
      state.activeTurnIdByThread,
      state.itemsByThread,
      state.threadStatusById,
      state.threadsByWorkspace,
    ],
  );

  const resolvePendingThreadForTurn = useCallback(
    (
      workspaceId: string,
      engine: "claude" | "gemini" | "grok" | "kimi" | "opencode",
      turnId: string | null | undefined,
    ): string | null =>
      resolvePendingThreadIdForTurn({
        workspaceId,
        engine,
        turnId,
        threadsByWorkspace: state.threadsByWorkspace,
        activeThreadIdByWorkspace: state.activeThreadIdByWorkspace,
        activeTurnIdByThread: state.activeTurnIdByThread,
      }),
    [
      state.activeThreadIdByWorkspace,
      state.activeTurnIdByThread,
      state.threadsByWorkspace,
    ],
  );

  const resolveClaudeContinuationThreadId = useCallback(
    (workspaceId: string, threadId: string, turnId?: string | null) =>
      resolveClaudeContinuationThreadIdFromState({
        workspaceId,
        threadId,
        turnId,
        resolveCanonicalThreadId,
        resolvePendingThreadForSession,
        getActiveTurnIdForThread: (candidateThreadId) =>
          state.activeTurnIdByThread[candidateThreadId] ?? null,
      }),
    [
      resolveCanonicalThreadId,
      resolvePendingThreadForSession,
      state.activeTurnIdByThread,
    ],
  );

  const {
    approvalAllowlistRef,
    handleApprovalDecision,
    handleApprovalBatchAccept,
    handleApprovalRemember,
  } = useThreadApprovals({
    dispatch,
    onDebug,
    resolveClaudeContinuationThreadId,
  });
  const { handleUserInputSubmit, handleUserInputDismiss } = useThreadUserInput({
    dispatch,
    resolveClaudeContinuationThreadId,
  });

  const renameCustomNameKey = useCallback(
    (workspaceId: string, oldThreadId: string, newThreadId: string) => {
      const fromKey = makeCustomNameKey(workspaceId, oldThreadId);
      const value = customNamesRef.current[fromKey];
      if (!value) {
        return;
      }
      const toKey = makeCustomNameKey(workspaceId, newThreadId);
      const next = { ...customNamesRef.current };
      delete next[fromKey];
      next[toKey] = value;
      customNamesRef.current = next;
      writeClientStoreValue("threads", "customNames", next);
    },
    [customNamesRef],
  );

  const collectRelatedThreadIds = useCallback(
    (threadId: string): string[] => {
      const canonicalThreadId = resolveCanonicalThreadId(threadId);
      const related = new Set<string>([threadId, canonicalThreadId]);
      Object.entries(threadAliasesRef.current).forEach(
        ([sourceThreadId, targetThreadId]) => {
          if (resolveCanonicalThreadId(sourceThreadId) !== canonicalThreadId) {
            return;
          }
          related.add(sourceThreadId);
          related.add(targetThreadId);
        },
      );
      return Array.from(related);
    },
    [resolveCanonicalThreadId, threadAliasesRef],
  );

  const renamePendingMemoryCaptureKey = useCallback(
    (oldThreadId: string, newThreadId: string) => {
      renameCompletionEmailIntentThread(oldThreadId, newThreadId);
      rememberThreadAlias(oldThreadId, newThreadId);
      const oldCanonicalThreadId = resolveCanonicalThreadId(oldThreadId);
      const newCanonicalThreadId = resolveCanonicalThreadId(newThreadId);
      const pendingEntries = workspaceScopedEntries(
        pendingMemoryCaptureRef.current,
      ).flatMap(({ workspaceId, threadId, value }) =>
        Object.entries(value)
          .filter(
            ([, entry]) =>
              entry.threadId === oldThreadId ||
              entry.threadId === oldCanonicalThreadId,
          )
          .map(([key, pending]) => ({ workspaceId, threadId, key, pending })),
      );
      if (pendingEntries.length > 0) {
        memoryDebugLog("rename pending capture key", {
          oldThreadId,
          newThreadId,
          count: pendingEntries.length,
        });
        pendingEntries.forEach(({ workspaceId, threadId, key, pending }) => {
          deletePendingMemoryEntry(
            pendingMemoryCaptureRef.current,
            workspaceId,
            threadId,
            key,
          );
          setPendingMemoryEntry(
            pendingMemoryCaptureRef.current,
            workspaceId,
            newCanonicalThreadId,
            buildMemoryTurnKey(newCanonicalThreadId, pending.turnId),
            {
              ...pending,
              threadId: newCanonicalThreadId,
            },
          );
        });
      }
      const completedEntries = workspaceScopedEntries(
        pendingAssistantCompletionRef.current,
      ).flatMap(({ workspaceId, threadId, value }) =>
        Object.entries(value)
          .filter(
            ([, entry]) =>
              entry.threadId === oldThreadId ||
              entry.threadId === oldCanonicalThreadId,
          )
          .map(([key, completed]) => ({
            workspaceId,
            threadId,
            key,
            completed,
          })),
      );
      if (completedEntries.length === 0) {
        return;
      }
      memoryDebugLog("rename pending assistant completion key", {
        oldThreadId,
        newThreadId,
        count: completedEntries.length,
      });
      completedEntries.forEach(({ workspaceId, threadId, key, completed }) => {
        deletePendingMemoryEntry(
          pendingAssistantCompletionRef.current,
          workspaceId,
          threadId,
          key,
        );
        setPendingMemoryEntry(
          pendingAssistantCompletionRef.current,
          workspaceId,
          newCanonicalThreadId,
          buildMemoryTurnKey(newCanonicalThreadId, completed.turnId),
          {
            ...completed,
            threadId: newCanonicalThreadId,
          },
        );
      });
    },
    [
      rememberThreadAlias,
      renameCompletionEmailIntentThread,
      resolveCanonicalThreadId,
    ],
  );

  // Mirrors the side-state migration the Claude pending rebind performs in
  // useThreadTurnEvents (alias table, custom names, auto-title, memory keys)
  // so canonical thread-id resolution keeps working after an optimistic codex
  // pending thread is renamed to its real backend id.
  const handleCodexPendingThreadFinalized = useCallback(
    (workspaceId: string, pendingThreadId: string, realThreadId: string) => {
      renameCustomNameKey(workspaceId, pendingThreadId, realThreadId);
      renameAutoTitlePendingKey(workspaceId, pendingThreadId, realThreadId);
      renamePendingMemoryCaptureKey(pendingThreadId, realThreadId);
    },
    [
      renameAutoTitlePendingKey,
      renameCustomNameKey,
      renamePendingMemoryCaptureKey,
    ],
  );

  const {
    startThreadForWorkspace,
    finalizeCodexPendingThread,
    startSharedSessionForWorkspace,
    forkThreadForWorkspace,
    forkSessionFromMessageForWorkspace,
    forkClaudeSessionFromMessageForWorkspace,
    resumeThreadForWorkspace,
    refreshThread: rawRefreshThread,
    resetWorkspaceThreads,
    listThreadsForWorkspace,
    loadOlderThreadsForWorkspace,
    deleteThreadForWorkspace,
    renameThreadTitleMapping,
    setThreadHistoryLoading,
    setThreadHistoryLoadingProgress,
    historyLoadingByThreadId,
    historyLoadingProgressByThreadId,
  } = useThreadActions({
    dispatch,
    itemsByThread: state.itemsByThread,
    tokenUsageByThread: state.tokenUsageByThread,
    userInputRequests: state.userInputRequests,
    threadsByWorkspace: state.threadsByWorkspace,
    activeThreadIdByWorkspace: state.activeThreadIdByWorkspace,
    threadListCursorByWorkspace: state.threadListCursorByWorkspace,
    threadStatusById: state.threadStatusById,
    onDebug,
    getCustomName,
    threadActivityRef,
    loadedThreadsRef,
    replaceOnResumeRef,
    applyCollabThreadLinksFromThread,
    updateThreadParent,
    resolveCanonicalThreadId,
    rememberThreadAlias,
    clearThreadAlias,
    resolveWorkspacePath,
    onThreadTitleMappingsLoaded: (workspaceId, titles) => {
      Object.entries(titles).forEach(([threadId, title]) => {
        if (!threadId.trim() || !title.trim()) {
          return;
        }
        saveCustomName(workspaceId, threadId, title);
        const key = makeCustomNameKey(workspaceId, threadId);
        customNamesRef.current[key] = title;
        dispatch({ type: "setThreadName", workspaceId, threadId, name: title });
      });
    },
    onRenameThreadTitleMapping: (workspaceId, oldThreadId, _newThreadId) => {
      clearAutoTitlePending(workspaceId, oldThreadId);
    },
    onCodexPendingThreadFinalized: handleCodexPendingThreadFinalized,
    sessionAttributionMode,
    useUnifiedHistoryLoader,
  });
  useEffect(() => {
    historyLoadingStateByThreadRef.current = historyLoadingByThreadId;
  }, [historyLoadingByThreadId]);

  const refreshThread = useCallback(
    async (workspaceId: string, threadId: string) => {
      const canonicalThreadId = resolveCanonicalThreadId(threadId);
      if (threadId !== canonicalThreadId) {
        dispatch({
          type: "setActiveThreadId",
          workspaceId,
          threadId: canonicalThreadId,
        });
      }
      return rawRefreshThread(workspaceId, canonicalThreadId);
    },
    [dispatch, rawRefreshThread, resolveCanonicalThreadId],
  );

  const {
    handleTurnCompletedForHistoryReconcile,
    scheduleClaudeBlankCurtainRecovery,
  } = useThreadRealtimeHistoryReconcile({
    itemsByThreadRef,
    onDebug,
    refreshThread,
    resolveCanonicalThreadId,
    threadStatusByIdRef,
    threadsByWorkspace: state.threadsByWorkspace,
  });

  // Claude blank-curtain in place: while the active Claude thread is empty during
  // processing (or after a failed history hydrate), force disk rehydrate without
  // requiring the user to switch pages and come back.
  useEffect(() => {
    if (!activeWorkspaceId || !activeThreadId) {
      return;
    }
    if (!activeThreadId.startsWith("claude:")) {
      return;
    }
    const itemCount = state.itemsByThread[activeThreadId]?.length ?? 0;
    if (itemCount > 0) {
      return;
    }
    const isProcessing = Boolean(
      state.threadStatusById[activeThreadId]?.isProcessing,
    );
    const historyFailed =
      historyLoadingByThreadId[activeThreadId] === "failed";
    if (!isProcessing && !historyFailed) {
      return;
    }
    scheduleClaudeBlankCurtainRecovery(
      activeWorkspaceId,
      activeThreadId,
      isProcessing
        ? "active-processing-empty-surface"
        : "active-failed-empty-surface",
    );
  }, [
    activeThreadId,
    activeWorkspaceId,
    historyLoadingByThreadId,
    scheduleClaudeBlankCurtainRecovery,
    state.itemsByThread,
    state.threadStatusById,
  ]);

  useEffect(() => {
    return subscribeWechatSessionUpdated(
      (event) => {
        const workspace = activeWorkspaceRef.current;
        if (!workspace || workspace.id !== event.workspaceId) {
          return;
        }
        void listThreadsForWorkspace(workspace, {
          preserveState: true,
          recoverySource: "wechat-session-updated",
        }).catch((error) => {
          onDebug?.({
            id: `${Date.now()}-wechat-session-refresh-error`,
            timestamp: Date.now(),
            source: "error",
            label: "wechat/session refresh error",
            payload: {
              workspaceId: event.workspaceId,
              sessionId: event.sessionId,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        });
      },
      {
        onError: (error) => {
          onDebug?.({
            id: `${Date.now()}-wechat-session-listener-error`,
            timestamp: Date.now(),
            source: "error",
            label: "wechat/session listener error",
            payload: {
              error: error instanceof Error ? error.message : String(error),
            },
          });
        },
      },
    );
  }, [listThreadsForWorkspace, onDebug]);

  useEffect(() => {
    if (!isWebServiceRuntime()) {
      return undefined;
    }
    return subscribeWebServiceReconnect(() => {
      const workspace = activeWorkspaceRef.current;
      if (!workspace) {
        return;
      }
      onDebug?.({
        id: `${Date.now()}-web-service-reconnect-refresh`,
        timestamp: Date.now(),
        source: "client",
        label: "web-service/reconnect refresh",
        payload: {
          workspaceId: workspace.id,
        },
      });
      void noteWebServiceReconnected(workspace.id).catch((error) => {
        onDebug?.({
          id: `${Date.now()}-web-service-reconnect-runtime-evidence-error`,
          timestamp: Date.now(),
          source: "error",
          label: "web-service/reconnect runtime evidence error",
          payload: {
            workspaceId: workspace.id,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      });
      void listThreadsForWorkspace(workspace, {
        preserveState: true,
        recoverySource: "web-service-reconnected",
      }).catch((error) => {
        onDebug?.({
          id: `${Date.now()}-web-service-reconnect-refresh-error`,
          timestamp: Date.now(),
          source: "error",
          label: "web-service/reconnect refresh error",
          payload: {
            workspaceId: workspace.id,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      });

      const activeThreadIdForWorkspace = activeThreadIdRef.current;
      if (
        !activeThreadIdForWorkspace ||
        !threadStatusByIdRef.current[activeThreadIdForWorkspace]?.isProcessing
      ) {
        return;
      }
      void refreshThread(workspace.id, activeThreadIdForWorkspace).catch(
        (error) => {
          onDebug?.({
            id: `${Date.now()}-web-service-reconnect-thread-refresh-error`,
            timestamp: Date.now(),
            source: "error",
            label: "web-service/reconnect thread refresh error",
            payload: {
              workspaceId: workspace.id,
              threadId: activeThreadIdForWorkspace,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        },
      );
    });
  }, [listThreadsForWorkspace, onDebug, refreshThread]);

  const startThread = useCallback(async () => {
    if (!activeWorkspaceId) {
      return null;
    }
    return startThreadForWorkspace(activeWorkspaceId, { engine: activeEngine });
  }, [activeWorkspaceId, activeEngine, startThreadForWorkspace]);

  const ensureThreadForActiveWorkspace = useCallback(async () => {
    if (!activeWorkspace) {
      return null;
    }
    const canonicalActiveThreadId = activeThreadId
      ? resolveCanonicalThreadId(activeThreadId)
      : activeThreadId;
    if (activeThreadId && canonicalActiveThreadId !== activeThreadId) {
      dispatch({
        type: "setActiveThreadId",
        workspaceId: activeWorkspace.id,
        threadId: canonicalActiveThreadId,
      });
    }
    let threadId = canonicalActiveThreadId;
    if (!threadId) {
      threadId = await startThreadForWorkspace(activeWorkspace.id, {
        engine: activeEngine,
      });
      if (!threadId) {
        return null;
      }
    } else if (!loadedThreadsRef.current[threadId]) {
      threadId = await resumeThreadForWorkspace(activeWorkspace.id, threadId);
    }
    return threadId;
  }, [
    activeWorkspace,
    activeThreadId,
    activeEngine,
    dispatch,
    resolveCanonicalThreadId,
    resumeThreadForWorkspace,
    startThreadForWorkspace,
  ]);

  const ensureThreadForWorkspace = useCallback(
    async (workspaceId: string) => {
      const currentActiveThreadId =
        state.activeThreadIdByWorkspace[workspaceId] ?? null;
      const shouldActivate = workspaceId === activeWorkspaceId;
      const canonicalActiveThreadId = currentActiveThreadId
        ? resolveCanonicalThreadId(currentActiveThreadId)
        : currentActiveThreadId;
      let threadId = canonicalActiveThreadId;
      if (!threadId) {
        threadId = await startThreadForWorkspace(workspaceId, {
          activate: shouldActivate,
          engine: activeEngine,
        });
        if (!threadId) {
          return null;
        }
      } else if (!loadedThreadsRef.current[threadId]) {
        threadId = await resumeThreadForWorkspace(workspaceId, threadId);
      }
      if (
        currentActiveThreadId &&
        canonicalActiveThreadId !== currentActiveThreadId
      ) {
        dispatch({
          type: "setActiveThreadId",
          workspaceId,
          threadId: canonicalActiveThreadId,
        });
      }
      if (shouldActivate && currentActiveThreadId !== threadId) {
        dispatch({ type: "setActiveThreadId", workspaceId, threadId });
      }
      return threadId;
    },
    [
      activeWorkspaceId,
      activeEngine,
      dispatch,
      loadedThreadsRef,
      resolveCanonicalThreadId,
      resumeThreadForWorkspace,
      startThreadForWorkspace,
      state.activeThreadIdByWorkspace,
    ],
  );

  useEffect(() => {
    collectCanonicalActiveThreadRebindings(
      state.activeThreadIdByWorkspace,
      resolveCanonicalThreadId,
    ).forEach(({ workspaceId, canonicalThreadId }) => {
      dispatch({
        type: "setActiveThreadId",
        workspaceId,
        threadId: canonicalThreadId,
      });
    });
  }, [dispatch, resolveCanonicalThreadId, state.activeThreadIdByWorkspace]);

  const autoNameThread = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      sourceText: string,
      options?: { force?: boolean; clearPendingOnSkip?: boolean },
    ): Promise<string | null> => {
      const key = makeCustomNameKey(workspaceId, threadId);
      const hasCustomName = Boolean(customNamesRef.current[key]);
      if (hasCustomName && !options?.force) {
        onDebug?.({
          id: `${Date.now()}-thread-title-skip-custom`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/title skipped",
          payload: { workspaceId, threadId, reason: "has-custom-name" },
        });
        if (options?.clearPendingOnSkip) {
          clearAutoTitlePending(workspaceId, threadId);
        }
        return null;
      }

      const message = sourceText.trim();
      if (!message) {
        onDebug?.({
          id: `${Date.now()}-thread-title-skip-empty`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/title skipped",
          payload: { workspaceId, threadId, reason: "empty-source-text" },
        });
        if (options?.clearPendingOnSkip) {
          clearAutoTitlePending(workspaceId, threadId);
        }
        return null;
      }

      const pendingStartedAt = getAutoTitlePendingStartedAt(
        workspaceId,
        threadId,
      );
      if (pendingStartedAt) {
        const pendingAgeMs = Date.now() - pendingStartedAt;
        if (pendingAgeMs >= AUTO_TITLE_PENDING_STALE_MS) {
          onDebug?.({
            id: `${Date.now()}-thread-title-pending-timeout-reset`,
            timestamp: Date.now(),
            source: "client",
            label: "thread/title pending reset",
            payload: {
              workspaceId,
              threadId,
              pendingStartedAt,
              pendingAgeMs,
              reason: "timeout",
            },
          });
          clearAutoTitlePending(workspaceId, threadId);
        } else {
          onDebug?.({
            id: `${Date.now()}-thread-title-skip-pending`,
            timestamp: Date.now(),
            source: "client",
            label: "thread/title skipped",
            payload: {
              workspaceId,
              threadId,
              reason: "already-pending",
              pendingStartedAt,
              pendingAgeMs,
            },
          });
          return null;
        }
      }

      if (isAutoTitlePending(workspaceId, threadId)) {
        onDebug?.({
          id: `${Date.now()}-thread-title-skip-pending-after-reset`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/title skipped",
          payload: {
            workspaceId,
            threadId,
            reason: "already-pending-after-reset",
          },
        });
        return null;
      }

      markAutoTitlePending(workspaceId, threadId);
      const markAt = getAutoTitlePendingStartedAt(workspaceId, threadId);
      onDebug?.({
        id: `${Date.now()}-thread-title-generate-start`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/title generate",
        payload: {
          workspaceId,
          threadId,
          force: Boolean(options?.force),
          pendingStartedAt: markAt,
        },
      });

      try {
        const applyGeneratedTitle = (
          title: string,
          source: "generated" | "recovered",
        ) => {
          saveCustomName(workspaceId, threadId, title);
          const nextKey = makeCustomNameKey(workspaceId, threadId);
          customNamesRef.current[nextKey] = title;
          dispatch({
            type: "setThreadName",
            workspaceId,
            threadId,
            name: title,
          });
          onDebug?.({
            id: `${Date.now()}-thread-title-${source}-success`,
            timestamp: Date.now(),
            source: "server",
            label:
              source === "generated"
                ? "thread/title generated"
                : "thread/title recovered",
            payload: { workspaceId, threadId, title, source },
          });
          return title;
        };

        const generateWithTimeout = async (
          preferredLanguage: "zh" | "en",
        ): Promise<string> =>
          await new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              reject(new Error("auto-title-timeout"));
            }, AUTO_TITLE_REQUEST_TIMEOUT_MS);

            void generateThreadTitle(
              workspaceId,
              threadId,
              message,
              preferredLanguage,
            ).then(
              (value) => {
                clearTimeout(timeoutId);
                resolve(value);
              },
              (error) => {
                clearTimeout(timeoutId);
                reject(error);
              },
            );
          });

        const language = i18n.language.toLowerCase().startsWith("zh")
          ? "zh"
          : "en";
        for (
          let attempt = 1;
          attempt <= AUTO_TITLE_MAX_ATTEMPTS;
          attempt += 1
        ) {
          const attemptStartedAt = Date.now();
          try {
            onDebug?.({
              id: `${Date.now()}-thread-title-attempt-start`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/title attempt",
              payload: {
                workspaceId,
                threadId,
                attempt,
                maxAttempts: AUTO_TITLE_MAX_ATTEMPTS,
                timeoutMs: AUTO_TITLE_REQUEST_TIMEOUT_MS,
                language,
              },
            });

            const generated = await generateWithTimeout(language);
            const title = generated.trim();
            if (!title) {
              throw new Error("empty-generated-title");
            }
            return applyGeneratedTitle(title, "generated");
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            const isTimeout = errorMessage.includes("auto-title-timeout");
            const elapsedMs = Date.now() - attemptStartedAt;

            onDebug?.({
              id: `${Date.now()}-thread-title-attempt-failed`,
              timestamp: Date.now(),
              source: isTimeout ? "client" : "error",
              label: "thread/title attempt failed",
              payload: {
                workspaceId,
                threadId,
                attempt,
                maxAttempts: AUTO_TITLE_MAX_ATTEMPTS,
                isTimeout,
                elapsedMs,
                error: errorMessage,
              },
            });

            if (isTimeout) {
              await new Promise((resolve) => setTimeout(resolve, 1200));
            }

            try {
              const mappedTitles = await listThreadTitles(workspaceId);
              const recovered = mappedTitles[threadId]?.trim();
              if (recovered) {
                return applyGeneratedTitle(recovered, "recovered");
              }
            } catch (recoveryError) {
              onDebug?.({
                id: `${Date.now()}-thread-title-recovery-check-error`,
                timestamp: Date.now(),
                source: "error",
                label: "thread/title recovery error",
                payload:
                  recoveryError instanceof Error
                    ? recoveryError.message
                    : String(recoveryError),
              });
            }

            if (attempt < AUTO_TITLE_MAX_ATTEMPTS) {
              onDebug?.({
                id: `${Date.now()}-thread-title-retry`,
                timestamp: Date.now(),
                source: "client",
                label: "thread/title retry",
                payload: {
                  workspaceId,
                  threadId,
                  nextAttempt: attempt + 1,
                  maxAttempts: AUTO_TITLE_MAX_ATTEMPTS,
                },
              });
              continue;
            }

            onDebug?.({
              id: `${Date.now()}-thread-title-generate-error`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/title generate error",
              payload: {
                workspaceId,
                threadId,
                attempt,
                maxAttempts: AUTO_TITLE_MAX_ATTEMPTS,
                error: errorMessage,
              },
            });
            return null;
          }
        }

        return null;
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-thread-title-generate-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/title generate error",
          payload: {
            workspaceId,
            threadId,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        return null;
      } finally {
        clearAutoTitlePending(workspaceId, threadId);
      }
    },
    [
      clearAutoTitlePending,
      customNamesRef,
      dispatch,
      getAutoTitlePendingStartedAt,
      isAutoTitlePending,
      markAutoTitlePending,
      onDebug,
    ],
  );

  const mergeMemoryFromPendingCapture = useCallback(
    (
      pending: Omit<PendingMemoryCapture, "createdAt">,
      payload: { threadId: string; itemId: string; text: string },
    ) => {
      const normalizedAssistantOutput = normalizeAssistantOutputForMemory(
        payload.text,
      );
      const digest = buildAssistantOutputDigest(normalizedAssistantOutput);
      const normalizedSummary = digest
        ? normalizeDigestSummaryForMemory(digest.summary) || digest.summary
        : "";
      const mergedDetail = [
        `用户输入：\n${pending.inputText}`,
        `AI 回复：\n${normalizedAssistantOutput}`,
      ].join("\n\n");
      const classifiedKind = classifyMemoryKind(mergedDetail);
      const mergedKind =
        classifiedKind === "note" ? "conversation" : classifiedKind;
      const mergedImportance = classifyMemoryImportance(mergedDetail);

      const mergeWrite = async () => {
        try {
          await projectMemoryCompleteTurn({
            workspaceId: pending.workspaceId,
            threadId: payload.threadId,
            turnId: pending.turnId,
            memoryId: pending.memoryId,
            kind: mergedKind,
            userInput: pending.inputText,
            assistantResponse: normalizedAssistantOutput,
            assistantMessageId: payload.itemId,
            title: digest?.title ?? "",
            summary: normalizedSummary,
            importance: mergedImportance,
            workspaceName: pending.workspaceName,
            workspacePath: pending.workspacePath,
            engine: pending.engine,
          });
          memoryDebugLog("merge write completed turn memory", {
            threadId: payload.threadId,
            turnId: pending.turnId,
            itemId: payload.itemId,
            assistantResponseLength: normalizedAssistantOutput.length,
          });
        } catch (completeErr) {
          if (import.meta.env.DEV) {
            console.warn("[project-memory] merge complete failed:", {
              threadId: payload.threadId,
              error: completeErr,
            });
          }
          memoryDebugLog("merge complete failed", {
            threadId: payload.threadId,
            error:
              completeErr instanceof Error
                ? completeErr.message
                : String(completeErr),
          });
        }
      };

      void mergeWrite();
    },
    [],
  );

  /** 输入侧采集成功后，将 pending 数据存入 ref（仅保留该 thread 最新一条） */
  const handleInputMemoryCaptured = useCallback(
    (payload: {
      workspaceId: string;
      threadId: string;
      turnId: string;
      inputText: string;
      memoryId: string | null;
      workspaceName: string | null;
      workspacePath: string | null;
      engine: string | null;
    }) => {
      const canonicalThreadId = resolveCanonicalThreadId(payload.threadId);
      const normalizedPayload = {
        ...payload,
        threadId: canonicalThreadId,
      };
      const captureKey = buildMemoryTurnKey(canonicalThreadId, payload.turnId);
      setPendingMemoryEntry(
        pendingMemoryCaptureRef.current,
        payload.workspaceId,
        canonicalThreadId,
        captureKey,
        {
          ...normalizedPayload,
          createdAt: Date.now(),
        },
      );
      const completedThreadIds = collectRelatedThreadIds(canonicalThreadId);
      const completedEntry = completedThreadIds
        .flatMap((threadId) =>
          getPendingMemoryEntries(
            pendingAssistantCompletionRef.current,
            payload.workspaceId,
            [threadId],
          )
            .filter(({ entry: completion }) => {
              if (!completion.turnId || !payload.turnId) {
                return true;
              }
              return completion.turnId === payload.turnId;
            })
            .map(({ key, threadId, entry: completion }) => ({
              key,
              threadId,
              completion,
            })),
        )
        .find((entry) => Boolean(entry.completion));
      const nowMs = Date.now();
      if (
        completedEntry?.completion &&
        shouldMergeOnInputCapture(
          completedEntry.completion.createdAt,
          nowMs,
          PENDING_MEMORY_STALE_MS,
        )
      ) {
        const keepPendingCapture =
          shouldKeepPendingCaptureForAdditionalAssistantSegments(
            normalizedPayload,
          );
        completedThreadIds.forEach((threadId) => {
          getPendingMemoryEntries(
            pendingAssistantCompletionRef.current,
            payload.workspaceId,
            [threadId],
          ).forEach(({ key, entry }) => {
            if (isSameMemoryTurn(entry.turnId, payload.turnId)) {
              if (!keepPendingCapture) {
                deletePendingMemoryEntry(
                  pendingAssistantCompletionRef.current,
                  payload.workspaceId,
                  threadId,
                  key,
                );
              }
            }
          });
          getPendingMemoryEntries(
            pendingMemoryCaptureRef.current,
            payload.workspaceId,
            [threadId],
          ).forEach(({ key, entry }) => {
            if (isSameMemoryTurn(entry.turnId, payload.turnId)) {
              const isSameCanonicalEntry = key === captureKey;
              if (!keepPendingCapture || !isSameCanonicalEntry) {
                deletePendingMemoryEntry(
                  pendingMemoryCaptureRef.current,
                  payload.workspaceId,
                  threadId,
                  key,
                );
              }
            }
          });
        });
        memoryDebugLog(
          "capture resolved after assistant completion, merging now",
          {
            threadId: canonicalThreadId,
            itemId: completedEntry.completion.itemId,
            memoryId: normalizedPayload.memoryId,
          },
        );
        mergeMemoryFromPendingCapture(normalizedPayload, {
          ...completedEntry.completion,
          threadId: canonicalThreadId,
          text: joinPendingAssistantCompletionText(completedEntry.completion),
        });
        return;
      }
      if (completedEntry) {
        deletePendingMemoryEntry(
          pendingAssistantCompletionRef.current,
          payload.workspaceId,
          completedEntry.threadId,
          completedEntry.key,
        );
      }
      memoryDebugLog("input captured", {
        threadId: canonicalThreadId,
        turnId: payload.turnId,
        memoryId: payload.memoryId,
      });
    },
    [
      collectRelatedThreadIds,
      mergeMemoryFromPendingCapture,
      resolveCanonicalThreadId,
    ],
  );

  /**
   * 回合融合写入 —— assistant 输出完成后，与 pending 输入采集合并写入。
   * 优先 update（若输入侧已产生 memoryId），失败则回退 create。
   */
  const handleAgentMessageCompletedForMemory = useCallback(
    (payload: {
      workspaceId: string;
      threadId: string;
      turnId?: string | null;
      itemId: string;
      text: string;
    }) => {
      const canonicalThreadId = resolveCanonicalThreadId(payload.threadId);
      const completionTurnId = payload.turnId?.trim() || null;
      const sharedThread = (
        state.threadsByWorkspace[payload.workspaceId] ?? []
      ).find((thread) => thread.id === canonicalThreadId);
      if (sharedThread?.threadKind === "shared" && sharedThread.engineSource) {
        dispatch({
          type: "upsertItem",
          workspaceId: payload.workspaceId,
          threadId: canonicalThreadId,
          item: {
            id: payload.itemId,
            kind: "message",
            role: "assistant",
            text: payload.text,
            engineSource: sharedThread.engineSource,
            isFinal: true,
          },
          hasCustomName: Boolean(
            getCustomName(payload.workspaceId, canonicalThreadId),
          ),
        });
      }
      const relatedThreadIds = collectRelatedThreadIds(canonicalThreadId);
      const pendingEntry = relatedThreadIds
        .flatMap((threadId) =>
          getPendingMemoryEntries(
            pendingMemoryCaptureRef.current,
            payload.workspaceId,
            [threadId],
          )
            .filter(({ entry: capture }) => {
              if (!completionTurnId || !capture.turnId) {
                return true;
              }
              return capture.turnId === completionTurnId;
            })
            .map(({ key, threadId, entry: capture }) => ({
              key,
              threadId,
              capture,
            })),
        )
        .find((entry) => Boolean(entry.capture));
      if (!pendingEntry?.capture) {
        const completionKey = buildMemoryTurnKey(
          canonicalThreadId,
          completionTurnId,
        );
        const existingBucket = workspaceScopedGet(
          pendingAssistantCompletionRef.current,
          payload.workspaceId,
          canonicalThreadId,
        );
        setPendingMemoryEntry(
          pendingAssistantCompletionRef.current,
          payload.workspaceId,
          canonicalThreadId,
          completionKey,
          upsertPendingAssistantCompletionSegment(
            existingBucket?.[completionKey],
            {
              ...payload,
              threadId: canonicalThreadId,
              turnId: completionTurnId,
            },
            Date.now(),
          ),
        );
        memoryDebugLog("assistant completed but no pending capture", {
          threadId: canonicalThreadId,
          turnId: completionTurnId,
          itemId: payload.itemId,
        });
        return;
      }
      if (
        !shouldMergeOnAssistantCompleted(
          pendingEntry.capture.createdAt,
          Date.now(),
          PENDING_MEMORY_STALE_MS,
        )
      ) {
        deletePendingMemoryEntry(
          pendingMemoryCaptureRef.current,
          payload.workspaceId,
          pendingEntry.threadId,
          pendingEntry.key,
        );
        memoryDebugLog("pending capture is stale, skip merge", {
          threadId: pendingEntry.threadId,
          turnId: pendingEntry.capture.turnId,
          itemId: payload.itemId,
        });
        return;
      }
      const completionKey = buildMemoryTurnKey(
        canonicalThreadId,
        pendingEntry.capture.turnId,
      );
      const previousCompletion = workspaceScopedGet(
        pendingAssistantCompletionRef.current,
        payload.workspaceId,
        canonicalThreadId,
      )?.[completionKey];
      const previousAssistantText = previousCompletion
        ? joinPendingAssistantCompletionText(previousCompletion)
        : "";
      const nextCompletion = upsertPendingAssistantCompletionSegment(
        previousCompletion,
        {
          ...payload,
          threadId: canonicalThreadId,
          turnId: pendingEntry.capture.turnId,
        },
        Date.now(),
      );
      setPendingMemoryEntry(
        pendingAssistantCompletionRef.current,
        payload.workspaceId,
        canonicalThreadId,
        completionKey,
        nextCompletion,
      );
      const mergedAssistantText =
        joinPendingAssistantCompletionText(nextCompletion);
      if (previousAssistantText === mergedAssistantText) {
        memoryDebugLog(
          "assistant completed text unchanged, skip memory rewrite",
          {
            threadId: canonicalThreadId,
            turnId: pendingEntry.capture.turnId,
            itemId: payload.itemId,
          },
        );
        return;
      }
      const keepPendingCapture =
        shouldKeepPendingCaptureForAdditionalAssistantSegments(
          pendingEntry.capture,
        );
      relatedThreadIds.forEach((threadId) => {
        getPendingMemoryEntries(
          pendingMemoryCaptureRef.current,
          payload.workspaceId,
          [threadId],
        ).forEach(({ key, entry }) => {
          if (isSameMemoryTurn(entry.turnId, pendingEntry.capture.turnId)) {
            const isSameCanonicalEntry = key === pendingEntry.key;
            if (!keepPendingCapture || !isSameCanonicalEntry) {
              deletePendingMemoryEntry(
                pendingMemoryCaptureRef.current,
                payload.workspaceId,
                threadId,
                key,
              );
            }
          }
        });
        getPendingMemoryEntries(
          pendingAssistantCompletionRef.current,
          payload.workspaceId,
          [threadId],
        ).forEach(({ key, entry }) => {
          if (isSameMemoryTurn(entry.turnId, pendingEntry.capture.turnId)) {
            if (keepPendingCapture) {
              setPendingMemoryEntry(
                pendingAssistantCompletionRef.current,
                payload.workspaceId,
                threadId,
                key,
                nextCompletion,
              );
            } else {
              deletePendingMemoryEntry(
                pendingAssistantCompletionRef.current,
                payload.workspaceId,
                threadId,
                key,
              );
            }
          }
        });
      });
      mergeMemoryFromPendingCapture(pendingEntry.capture, {
        ...payload,
        threadId: canonicalThreadId,
        text: mergedAssistantText,
      });
    },
    [
      collectRelatedThreadIds,
      dispatch,
      getCustomName,
      mergeMemoryFromPendingCapture,
      resolveCanonicalThreadId,
      state.threadsByWorkspace,
    ],
  );

  const {
    handleFusionStalled,
    interruptTurn: rawInterruptTurn,
    sendUserMessage,
    sendUserMessageToThread,
    startFork,
    startReview,
    startResume,
    startMcp,
    startSpecRoot,
    startStatus,
    startContext,
    startCompact,
    startFast,
    startMode,
    startExport,
    startImport,
    startLsp,
    startShare,
    reviewPrompt,
    openReviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    confirmBranch,
    selectBranch,
    selectBranchAtIndex,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
  } = useThreadMessaging({
    activeWorkspace,
    activeThreadId,
    accessMode,
    model,
    effort,
    collaborationMode,
    resolveComposerSelection,
    claudeThinkingVisible,
    steerEnabled,
    customPrompts,
    activeEngine,
    threadStatusById: state.threadStatusById,
    itemsByThread: state.itemsByThread,
    activeTurnIdByThread: state.activeTurnIdByThread,
    codexAcceptedTurnByThread: state.codexAcceptedTurnByThread,
    tokenUsageByThread: state.tokenUsageByThread,
    rateLimitsByWorkspace: state.rateLimitsByWorkspace,
    codexCompactionInFlightByThreadRef,
    pendingInterruptsRef,
    interruptedThreadsRef,
    dispatch,
    getCustomName,
    getThreadEngine,
    getThreadKind,
    getThreadProviderProfileId,
    markProcessing: markProcessingWithImmediateOwner,
    markReviewing,
    setActiveTurnId: setActiveTurnIdWithCompletionEmail,
    recordThreadActivity,
    safeMessageActivity,
    onDebug,
    pushThreadErrorMessage,
    ensureThreadForActiveWorkspace,
    ensureThreadForWorkspace,
    refreshThread,
    forkThreadForWorkspace,
    updateThreadParent,
    startThreadForWorkspace,
    finalizeCodexPendingThread,
    resolveOpenCodeAgent,
    resolveOpenCodeVariant,
    onInputMemoryCaptured: handleInputMemoryCaptured,
    resolveCollaborationRuntimeMode,
    runWithCreateSessionLoading,
    onSharedDurableTurnCommitted: settleSharedDurableTurn,
  });

  useMailDrivenSessionContinuation({
    activeWorkspace,
    sendUserMessageToThread,
    armMailDrivenCompletionEmail,
  });

  const interruptTurn = useCallback(
    async (options?: {
      reason?: "user-stop" | "queue-fusion" | "plan-handoff";
    }) => {
      const interruptedThreadId = activeThreadId;
      const interruptedTurnId = interruptedThreadId
        ? (activeTurnIdByThreadRef.current[interruptedThreadId] ?? null)
        : null;
      try {
        await rawInterruptTurn(options);
      } finally {
        if (interruptedThreadId) {
          clearCompletionEmailIntent(interruptedThreadId, interruptedTurnId);
        }
      }
    },
    [activeThreadId, clearCompletionEmailIntent, rawInterruptTurn],
  );

  const setActiveThreadId = useCallback(
    (threadId: string | null, workspaceId?: string) => {
      const targetId = workspaceId ?? activeWorkspaceId;
      if (!targetId) {
        return;
      }
      const clearHistoryLoadingForThread = (targetThreadId: string | null) => {
        if (!targetThreadId) {
          return;
        }
        setThreadHistoryLoading(targetThreadId, false);
        if (
          historyLoadingThreadByWorkspaceRef.current[targetId] ===
          targetThreadId
        ) {
          historyLoadingThreadByWorkspaceRef.current[targetId] = null;
        }
      };
      const canonicalThreadId = threadId
        ? resolveCanonicalThreadId(threadId)
        : null;
      dispatch({
        type: "setActiveThreadId",
        workspaceId: targetId,
        threadId: canonicalThreadId,
      });
      const previousTimer = lazyResumeTimerByWorkspaceRef.current[targetId];
      if (previousTimer) {
        clearTimeout(previousTimer);
        lazyResumeTimerByWorkspaceRef.current[targetId] = null;
      }
      const previousHistoryLoadingThreadId =
        historyLoadingThreadByWorkspaceRef.current[targetId] ?? null;
      if (
        previousHistoryLoadingThreadId &&
        previousHistoryLoadingThreadId !== canonicalThreadId
      ) {
        clearHistoryLoadingForThread(previousHistoryLoadingThreadId);
      }
      if (!canonicalThreadId) {
        return;
      }
      if (canonicalThreadId) {
        const historySelectionScopeKey = `${targetId}\u0000${canonicalThreadId}`;
        const historySelectionGeneration =
          (historySelectionGenerationByScopeRef.current[
            historySelectionScopeKey
          ] ?? 0) + 1;
        historySelectionGenerationByScopeRef.current[historySelectionScopeKey] =
          historySelectionGeneration;
        const isCurrentHistorySelection = () =>
          historySelectionGenerationByScopeRef.current[
            historySelectionScopeKey
          ] === historySelectionGeneration;
        const now = Date.now();
        const isLoaded = Boolean(loadedThreadsRef.current[canonicalThreadId]);
        const automaticRecoveryBlocked =
          historyLoadingStateByThreadRef.current[canonicalThreadId] ===
          "failed";
        const isProcessing = Boolean(
          threadStatusByIdRef.current[canonicalThreadId]?.isProcessing,
        );
        const activeSurfaceItemCount =
          itemsByThreadRef.current[canonicalThreadId]?.length ?? 0;
        const isClaudeEmptySurface =
          canonicalThreadId.startsWith("claude:") &&
          activeSurfaceItemCount === 0;
        // Empty Claude surfaces must force rehydrate even after a prior
        // history-hydrate-empty failure, otherwise the user is stuck until a
        // full remount and sees only messages.emptyThread.
        const shouldForceEmptyClaudeReload =
          isClaudeEmptySurface && !isProcessing;
        let lastRefreshAt =
          loadedThreadLastRefreshAtRef.current[canonicalThreadId] ?? 0;
        if (isLoaded && lastRefreshAt <= 0) {
          lastRefreshAt = now;
          loadedThreadLastRefreshAtRef.current[canonicalThreadId] = now;
        }
        const shouldRefreshLoaded =
          isLoaded &&
          !isProcessing &&
          now - lastRefreshAt >= THREAD_SWITCH_LOADED_REFRESH_MS;
        const shouldScheduleResume =
          (!isLoaded && !isProcessing && !automaticRecoveryBlocked) ||
          shouldRefreshLoaded ||
          shouldForceEmptyClaudeReload;
        if (!shouldScheduleResume) {
          clearHistoryLoadingForThread(canonicalThreadId);
          return;
        }
        const shouldShowHistoryLoading =
          !isLoaded &&
          shouldShowHistoryLoadingForSelectionThread(canonicalThreadId);
        if (shouldShowHistoryLoading) {
          setThreadHistoryLoading(canonicalThreadId, true);
          historyLoadingThreadByWorkspaceRef.current[targetId] =
            canonicalThreadId;
          if (canonicalThreadId.startsWith("shared:")) {
            setThreadHistoryLoadingProgress(canonicalThreadId, {
              phase: "prepare",
              percent: 8,
              titleKey: "restoringSharedHistory",
              detailKey: "restoringSharedHistoryPrepare",
            });
          }
        } else {
          clearHistoryLoadingForThread(canonicalThreadId);
        }
        lazyResumeTimerByWorkspaceRef.current[targetId] = setTimeout(() => {
          lazyResumeTimerByWorkspaceRef.current[targetId] = null;
          if (!isCurrentHistorySelection()) {
            return;
          }
          const activeThreadIdForWorkspace =
            activeThreadIdByWorkspaceRef.current[targetId] ?? null;
          if (activeThreadIdForWorkspace !== canonicalThreadId) {
            clearHistoryLoadingForThread(canonicalThreadId);
            return;
          }
          const loadedAtCallback = Boolean(
            loadedThreadsRef.current[canonicalThreadId],
          );
          if (!loadedAtCallback) {
            loadedThreadLastRefreshAtRef.current[canonicalThreadId] =
              Date.now();
            let resumeLoadingThreadId = canonicalThreadId;
            // Force when prior automatic recovery failed or Claude surface is
            // empty so resume is not skipped by automaticRecoveryFailedByScope.
            const forceEmptyClaudeResume =
              historyLoadingStateByThreadRef.current[canonicalThreadId] ===
                "failed" ||
              (canonicalThreadId.startsWith("claude:") &&
                (itemsByThreadRef.current[canonicalThreadId]?.length ?? 0) ===
                  0);
            void resumeThreadForWorkspace(
              targetId,
              canonicalThreadId,
              forceEmptyClaudeResume,
              forceEmptyClaudeResume,
              {
                preferLocalCodexHistory: true,
              },
            )
              .then((recoveredThreadId) => {
                if (!isCurrentHistorySelection()) {
                  return;
                }
                const recoveredCanonicalThreadId = recoveredThreadId
                  ? resolveCanonicalThreadId(recoveredThreadId)
                  : null;
                if (
                  shouldShowHistoryLoading &&
                  recoveredCanonicalThreadId &&
                  recoveredCanonicalThreadId !== canonicalThreadId
                ) {
                  clearHistoryLoadingForThread(canonicalThreadId);
                  setThreadHistoryLoading(recoveredCanonicalThreadId, true);
                  historyLoadingThreadByWorkspaceRef.current[targetId] =
                    recoveredCanonicalThreadId;
                  resumeLoadingThreadId = recoveredCanonicalThreadId;
                }
                if (
                  recoveredCanonicalThreadId &&
                  recoveredCanonicalThreadId !== canonicalThreadId &&
                  activeThreadIdByWorkspaceRef.current[targetId] ===
                    canonicalThreadId
                ) {
                  onDebug?.({
                    id: `${Date.now()}-thread-selection-recovered-canonical`,
                    timestamp: Date.now(),
                    source: "client",
                    label: "thread/selection recovered canonical",
                    payload: {
                      workspaceId: targetId,
                      staleThreadId: canonicalThreadId,
                      recoveredThreadId: recoveredCanonicalThreadId,
                    },
                  });
                  dispatch({
                    type: "setActiveThreadId",
                    workspaceId: targetId,
                    threadId: recoveredCanonicalThreadId,
                  });
                }
              })
              .finally(() => {
                if (!isCurrentHistorySelection()) {
                  return;
                }
                const currentLoadingThreadId =
                  historyLoadingThreadByWorkspaceRef.current[targetId] ?? null;
                if (currentLoadingThreadId === resumeLoadingThreadId) {
                  clearHistoryLoadingForThread(resumeLoadingThreadId);
                  return;
                }
                setThreadHistoryLoading(canonicalThreadId, false);
              });
            return;
          }
          clearHistoryLoadingForThread(canonicalThreadId);
          const processingAtCallback = Boolean(
            threadStatusByIdRef.current[canonicalThreadId]?.isProcessing,
          );
          if (processingAtCallback) {
            return;
          }
          const callbackLastRefreshAt =
            loadedThreadLastRefreshAtRef.current[canonicalThreadId] ?? 0;
          const claudeEmptyAtCallback =
            canonicalThreadId.startsWith("claude:") &&
            (itemsByThreadRef.current[canonicalThreadId]?.length ?? 0) === 0;
          // Claude empty surfaces skip the 20s cooldown so reselect immediately
          // rehydrates transcript instead of showing messages.emptyThread.
          if (
            !claudeEmptyAtCallback &&
            Date.now() - callbackLastRefreshAt <
              THREAD_SWITCH_LOADED_REFRESH_MS
          ) {
            return;
          }
          loadedThreadLastRefreshAtRef.current[canonicalThreadId] = Date.now();
          void resumeThreadForWorkspace(
            targetId,
            canonicalThreadId,
            true,
            claudeEmptyAtCallback,
            {
              preferLocalCodexHistory: true,
            },
          ).then((recoveredThreadId) => {
            if (!isCurrentHistorySelection()) {
              return;
            }
            const recoveredCanonicalThreadId = recoveredThreadId
              ? resolveCanonicalThreadId(recoveredThreadId)
              : null;
            if (
              recoveredCanonicalThreadId &&
              recoveredCanonicalThreadId !== canonicalThreadId &&
              activeThreadIdByWorkspaceRef.current[targetId] ===
                canonicalThreadId
            ) {
              onDebug?.({
                id: `${Date.now()}-thread-selection-recovered-canonical-refresh`,
                timestamp: Date.now(),
                source: "client",
                label: "thread/selection recovered canonical",
                payload: {
                  workspaceId: targetId,
                  staleThreadId: canonicalThreadId,
                  recoveredThreadId: recoveredCanonicalThreadId,
                  trigger: "refresh",
                },
              });
              dispatch({
                type: "setActiveThreadId",
                workspaceId: targetId,
                threadId: recoveredCanonicalThreadId,
              });
            }
          });
        }, THREAD_SWITCH_RESUME_DELAY_MS);
      }
    },
    [
      activeWorkspaceId,
      dispatch,
      onDebug,
      resolveCanonicalThreadId,
      resumeThreadForWorkspace,
      setThreadHistoryLoading,
      setThreadHistoryLoadingProgress,
    ],
  );

  useEffect(() => {
    const loadedThreadIds = Object.entries(loadedThreadsRef.current)
      .filter(([, isLoaded]) => isLoaded)
      .map(([threadId]) => threadId);
    // chat-stream-render-isolation-2026-06 task 5: in-flight aware LRU.
    // Count the number of threads currently streaming (`isProcessing`)
    // and let the cache budget grow with them.
    const inFlightCount = Object.values(state.threadStatusById).filter(
      (status) => status?.isProcessing,
    ).length;
    const cacheMax = computeThreadItemCacheMax(inFlightCount);
    if (loadedThreadIds.length <= cacheMax + THREAD_ITEM_CACHE_TRIM_WATERMARK) {
      return;
    }

    const threadWorkspaceMap = new Map<string, string>();
    Object.entries(state.threadsByWorkspace).forEach(
      ([workspaceId, threads]) => {
        threads.forEach((thread) => {
          threadWorkspaceMap.set(thread.id, workspaceId);
        });
      },
    );

    const protectedThreadIds = new Set<string>();
    Object.values(state.activeThreadIdByWorkspace).forEach((threadId) => {
      if (threadId) {
        protectedThreadIds.add(threadId);
      }
    });
    Object.entries(state.threadStatusById).forEach(([threadId, status]) => {
      if (status?.isProcessing) {
        protectedThreadIds.add(threadId);
      }
    });
    state.userInputRequests.forEach((request) => {
      const requestThreadId = request.params.thread_id;
      if (requestThreadId) {
        protectedThreadIds.add(requestThreadId);
      }
    });

    const protectedLoadedCount = loadedThreadIds.filter((threadId) => {
      if (protectedThreadIds.has(threadId)) {
        return true;
      }
      const workspaceId = threadWorkspaceMap.get(threadId);
      return workspaceId ? isThreadPinned(workspaceId, threadId) : false;
    }).length;
    const keepableSlots = Math.max(0, cacheMax - protectedLoadedCount);

    const evictableCandidates = loadedThreadIds
      .filter((threadId) => {
        if (protectedThreadIds.has(threadId)) {
          return false;
        }
        const workspaceId = threadWorkspaceMap.get(threadId);
        if (workspaceId && isThreadPinned(workspaceId, threadId)) {
          return false;
        }
        return (state.itemsByThread[threadId]?.length ?? 0) > 0;
      })
      .map((threadId) => {
        const workspaceId = threadWorkspaceMap.get(threadId) ?? "";
        const activityTimestamp =
          threadActivityRef.current[workspaceId]?.[threadId] ??
          state.lastAgentMessageByThread[threadId]?.timestamp ??
          0;
        return { threadId, activityTimestamp };
      })
      .sort((left, right) => right.activityTimestamp - left.activityTimestamp);

    const evictedThreadIds = evictableCandidates
      .slice(keepableSlots)
      .map((entry) => entry.threadId);
    if (evictedThreadIds.length === 0) {
      return;
    }

    evictedThreadIds.forEach((threadId) => {
      loadedThreadsRef.current[threadId] = false;
    });
    // chat-stream-render-isolation-2026-06 task 8.2: drop per-thread entries
    // from all 6 workspace-scope refs before dispatching the evict so that
    // dispatch + cleanup happen in the same microtask. Handler-owned transient
    // refs are cleaned through the registered owner callback below.
    let cleanedRefCount = 0;
    const scopedStores: ReadonlyArray<WorkspaceScopedMap<unknown>> = [
      pendingMemoryCaptureRef.current,
      pendingAssistantCompletionRef.current,
      pendingInterruptsRef.current,
      interruptedThreadsRef.current,
      recentThreadErrorsRef.current,
      handledClaudeExitPlanToolIdsRef.current,
    ];
    for (const threadId of evictedThreadIds) {
      const workspaceId = threadWorkspaceMap.get(threadId);
      cleanedRefCount += cleanupThreadScopedRefs(
        scopedStores,
        workspaceId,
        threadId,
      );
      cleanedRefCount += cleanupThreadTransientStateRef.current(
        workspaceId,
        threadId,
      );
    }
    appendRendererDiagnostic("chat-stream/evict-thread", {
      evictedCount: evictedThreadIds.length,
      cleanedRefCount,
      cacheMax,
      inFlightCount,
    });
    evictedThreadIds.forEach((threadId) => {
      clearLiveAssistantText(threadId);
    });
    dispatch({ type: "evictThreadItems", threadIds: evictedThreadIds });
  }, [
    isThreadPinned,
    pinnedThreadsVersion,
    state.activeThreadIdByWorkspace,
    state.itemsByThread,
    state.lastAgentMessageByThread,
    state.threadStatusById,
    state.threadsByWorkspace,
    state.userInputRequests,
    threadActivityRef,
  ]);

  useEffect(() => {
    Object.entries(state.threadsByWorkspace).forEach(
      ([workspaceId, threads]) => {
        threads.forEach((thread) => {
          if (thread.threadKind !== "shared") {
            return;
          }
          if (!loadedThreadsRef.current[thread.id]) {
            const existingTimer =
              sharedSessionSyncTimerByThreadRef.current[thread.id];
            if (existingTimer) {
              clearTimeout(existingTimer);
              sharedSessionSyncTimerByThreadRef.current[thread.id] = null;
            }
            return;
          }
          const selectedEngine = normalizeSharedSessionEngine(
            thread.selectedEngine ?? thread.engineSource ?? "claude",
          );
          const items = state.itemsByThread[thread.id] ?? [];
          const lastSynced =
            sharedSessionLastSignatureByThreadRef.current[thread.id];
          if (
            lastSynced &&
            lastSynced.selectedEngine === selectedEngine &&
            lastSynced.items === items
          ) {
            return;
          }
          sharedSessionLastSignatureByThreadRef.current[thread.id] = {
            selectedEngine,
            items,
          };
          const existingTimer =
            sharedSessionSyncTimerByThreadRef.current[thread.id];
          if (existingTimer) {
            clearTimeout(existingTimer);
          }
          sharedSessionSyncTimerByThreadRef.current[thread.id] = setTimeout(
            () => {
              void syncSharedSessionSnapshotService(
                workspaceId,
                thread.id,
                items,
                selectedEngine,
                !isSharedV2SendEnabled(),
              ).catch((error) => {
                onDebug?.({
                  id: `${Date.now()}-shared-session-sync-error`,
                  timestamp: Date.now(),
                  source: "error",
                  label: "shared-session/sync error",
                  payload:
                    error instanceof Error ? error.message : String(error),
                });
              });
            },
            320,
          );
        });
      },
    );
  }, [onDebug, state.itemsByThread, state.threadsByWorkspace]);

  const removeThread = useCallback(
    async (
      workspaceId: string,
      threadId: string,
    ): Promise<ThreadDeleteResult> => {
      const settleThreadDeletionLocally = (
        result: Omit<ThreadDeleteResult, "threadId">,
      ): ThreadDeleteResult => {
        loadedThreadsRef.current[threadId] = false;
        unpinThread(workspaceId, threadId);
        if (getThreadKind(workspaceId, threadId) === "shared") {
          clearSharedSessionBindingsForSharedThread(workspaceId, threadId);
        }
        dispatch({
          type: "clearUserInputRequestsForThread",
          workspaceId,
          threadId,
        });
        dispatch({ type: "removeThread", workspaceId, threadId });
        return {
          threadId,
          ...result,
        };
      };

      try {
        await deleteThreadForWorkspace(workspaceId, threadId);
        return settleThreadDeletionLocally({
          success: true,
          code: null,
          message: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = mapDeleteErrorCode(message);
        if (shouldSettleDeleteAsSuccess(message)) {
          return settleThreadDeletionLocally({
            success: true,
            code: null,
            message: null,
          });
        }
        return {
          threadId,
          success: false,
          code,
          message,
        };
      }
    },
    [
      deleteThreadForWorkspace,
      dispatch,
      getThreadKind,
      loadedThreadsRef,
      unpinThread,
    ],
  );

  const removeThreads = useCallback(
    async (
      workspaceId: string,
      threadIds: string[],
    ): Promise<ThreadDeleteResult[]> => {
      if (!workspaceId || threadIds.length === 0) {
        return [];
      }

      const workspaceThreads = state.threadsByWorkspace[workspaceId] ?? [];
      const codexThreadIds = threadIds.filter((threadId) => {
        const thread = workspaceThreads.find((entry) => entry.id === threadId);
        if (thread?.threadKind === "shared") {
          return false;
        }
        if (threadId.includes("-pending-") || threadId.includes(":")) {
          return false;
        }
        return (
          thread?.engineSource !== "claude" &&
          thread?.engineSource !== "gemini" &&
          thread?.engineSource !== "kimi" &&
          thread?.engineSource !== "opencode"
        );
      });

      const codexResultByThreadId = new Map<string, ThreadDeleteResult>();
      if (codexThreadIds.length > 1) {
        try {
          const response = await deleteCodexSessions(
            workspaceId,
            codexThreadIds,
          );
          response.results.forEach((result) => {
            const message =
              (result.error ?? "").trim() || "Failed to delete codex session";
            const code = mapDeleteErrorCode(message);
            if (result.deleted || shouldSettleDeleteAsSuccess(message)) {
              loadedThreadsRef.current[result.sessionId] = false;
              unpinThread(workspaceId, result.sessionId);
              dispatch({
                type: "clearUserInputRequestsForThread",
                workspaceId,
                threadId: result.sessionId,
              });
              dispatch({
                type: "removeThread",
                workspaceId,
                threadId: result.sessionId,
              });
              codexResultByThreadId.set(result.sessionId, {
                threadId: result.sessionId,
                success: true,
                code: null,
                message: null,
              });
              return;
            }
            codexResultByThreadId.set(result.sessionId, {
              threadId: result.sessionId,
              success: false,
              code,
              message,
            });
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          codexThreadIds.forEach((threadId) => {
            codexResultByThreadId.set(threadId, {
              threadId,
              success: false,
              code: mapDeleteErrorCode(message),
              message,
            });
          });
        }
      }

      const results: ThreadDeleteResult[] = [];
      for (const threadId of threadIds) {
        const fastPathResult = codexResultByThreadId.get(threadId);
        if (fastPathResult) {
          results.push(fastPathResult);
          continue;
        }
        results.push(await removeThread(workspaceId, threadId));
      }
      return results;
    },
    [dispatch, removeThread, state.threadsByWorkspace, unpinThread],
  );

  const renameThread = useCallback(
    (workspaceId: string, threadId: string, newName: string) => {
      saveCustomName(workspaceId, threadId, newName);
      void setThreadTitle(workspaceId, threadId, newName).catch(() => {
        // Keep local rename even if file persistence fails.
      });
      const key = makeCustomNameKey(workspaceId, threadId);
      customNamesRef.current[key] = newName;
      dispatch({ type: "setThreadName", workspaceId, threadId, name: newName });
      clearAutoTitlePending(workspaceId, threadId);
    },
    [clearAutoTitlePending, customNamesRef, dispatch],
  );

  const triggerAutoThreadTitle = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      options?: { force?: boolean },
    ) => {
      const items = state.itemsByThread[threadId] ?? [];
      const userMessage = items.find(
        (item) => item.kind === "message" && item.role === "user",
      );
      let text =
        userMessage && userMessage.kind === "message" ? userMessage.text : "";

      if (!text.trim() && !threadId.startsWith("claude:")) {
        try {
          const response = (await resumeThread(
            workspaceId,
            threadId,
          )) as Record<string, unknown> | null;
          const result = (response?.result ?? response) as Record<
            string,
            unknown
          > | null;
          const thread = (result?.thread ?? response?.thread ?? null) as Record<
            string,
            unknown
          > | null;
          if (thread) {
            const loadedItems = buildItemsFromThread(thread);
            const loadedFirstUserMessage = loadedItems.find(
              (item) => item.kind === "message" && item.role === "user",
            );
            if (
              loadedFirstUserMessage &&
              loadedFirstUserMessage.kind === "message" &&
              loadedFirstUserMessage.text.trim()
            ) {
              text = loadedFirstUserMessage.text;
              onDebug?.({
                id: `${Date.now()}-thread-title-manual-source-resume`,
                timestamp: Date.now(),
                source: "client",
                label: "thread/title manual source",
                payload: { workspaceId, threadId, source: "thread/resume" },
              });
            }
          }
        } catch (error) {
          onDebug?.({
            id: `${Date.now()}-thread-title-manual-source-resume-error`,
            timestamp: Date.now(),
            source: "error",
            label: "thread/title manual source error",
            payload: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (!text.trim()) {
        const fallbackName =
          state.threadsByWorkspace[workspaceId]
            ?.find((thread) => thread.id === threadId)
            ?.name?.trim() ?? "";
        if (fallbackName && !/^agent\s+\d+$/i.test(fallbackName)) {
          text = fallbackName;
          onDebug?.({
            id: `${Date.now()}-thread-title-manual-source-name`,
            timestamp: Date.now(),
            source: "client",
            label: "thread/title manual source",
            payload: { workspaceId, threadId, source: "thread/name" },
          });
        }
      }

      if (!text.trim()) {
        onDebug?.({
          id: `${Date.now()}-thread-title-manual-missing-source`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/title manual skipped",
          payload: { workspaceId, threadId, reason: "no-user-message-found" },
        });
      }
      const generated = await autoNameThread(workspaceId, threadId, text, {
        force: options?.force ?? true,
        clearPendingOnSkip: true,
      });
      return generated;
    },
    [autoNameThread, onDebug, state.itemsByThread, state.threadsByWorkspace],
  );

  const isThreadAutoNaming = useCallback(
    (workspaceId: string, threadId: string) =>
      isAutoTitlePending(workspaceId, threadId),
    [isAutoTitlePending],
  );

  const getSingleProcessingCodexThreadId = useCallback(
    (workspaceId: string) => {
      const candidates = Array.from(
        immediateProcessingCodexThreadIdsByWorkspaceRef.current[workspaceId] ??
          [],
      );
      return candidates.length === 1 ? (candidates[0] ?? null) : null;
    },
    [],
  );

  const handlers = useThreadEventHandlers({
    activeThreadId,
    dispatch,
    getCustomName,
    resolveCanonicalThreadId,
    resolveCollaborationUiMode,
    isAutoTitlePending,
    isThreadHidden,
    markProcessing: markProcessingWithImmediateOwner,
    markReviewing,
    setActiveTurnId: setActiveTurnIdWithCompletionEmail,
    codexCompactionInFlightByThreadRef,
    safeMessageActivity,
    recordThreadActivity,
    pushThreadErrorMessage,
    onDebug,
    onWorkspaceConnected: handleWorkspaceConnected,
    domainEventController: domainEventRuntimeController,
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
    getActiveTurnIdForThread: (threadId: string) =>
      state.activeTurnIdByThread[threadId] ?? null,
    hasEstablishedThreadItems: (threadId: string) =>
      (state.itemsByThread[threadId]?.length ?? 0) > 0,
    renamePendingMemoryCaptureKey,
    onAgentMessageCompletedExternal: handleAgentMessageCompletedForMemory,
    onTurnCompletedExternal: (payload) => {
      handleTurnCompletedForHistoryReconcile(payload);
    },
    onTurnTerminalExternal: ({
      workspaceId,
      threadId,
      turnId,
      rawTurnId,
      status,
    }) => {
      settleCompletionEmailIntent(
        workspaceId,
        threadId,
        rawTurnId ?? turnId,
        status,
      );
    },
    onThreadTransientCleanupReady: (cleanup) => {
      cleanupThreadTransientStateRef.current = cleanup;
      return () => {
        cleanupThreadTransientStateRef.current = () => 0;
      };
    },
    onDurableRealtimeTurnSettlementReady:
      registerSharedDurableTurnSettlement,
    onCollaborationModeResolved: onCollaborationModeResolved
      ? (event) => {
          onCollaborationModeResolved({
            workspaceId: event.workspace_id,
            threadId: event.params.thread_id,
            selectedUiMode: event.params.selected_ui_mode,
            effectiveRuntimeMode: event.params.effective_runtime_mode,
            effectiveUiMode: event.params.effective_ui_mode,
            fallbackReason: event.params.fallback_reason ?? null,
          });
        }
      : undefined,
    onExitPlanModeToolCompleted: ({ threadId, itemId }) => {
      if (threadId !== activeThreadId) {
        return;
      }
      if (activeEngine !== "claude" || accessMode !== "read-only") {
        return;
      }
      const handoffKey = `${threadId}:${itemId}`;
      if (
        workspaceScopedHas(
          handledClaudeExitPlanToolIdsRef.current,
          activeWorkspaceId,
          handoffKey,
        )
      ) {
        return;
      }
      workspaceScopedSet(
        handledClaudeExitPlanToolIdsRef.current,
        activeWorkspaceId,
        handoffKey,
        true,
      );
      void interruptTurn({ reason: "plan-handoff" });
    },
  });

  const appServerEventHandlers = useMemo(
    () => ({
      ...handlers,
      onThreadStarted: (
        workspaceId: string,
        thread: Record<string, unknown>,
      ) => {
        const threadId = typeof thread.id === "string" ? thread.id : "";
        if (threadId) {
          rememberImmediateThreadOwner(workspaceId, threadId, {
            id: threadId,
            engineSource:
              thread.engineSource === "codex" ||
              thread.engineSource === "claude" ||
              thread.engineSource === "gemini" ||
              thread.engineSource === "grok" ||
              thread.engineSource === "kimi" ||
              thread.engineSource === "opencode"
                ? thread.engineSource
                : undefined,
            selectedEngine:
              thread.selectedEngine === "codex" ||
              thread.selectedEngine === "claude" ||
              thread.selectedEngine === "gemini" ||
              thread.selectedEngine === "grok" ||
              thread.selectedEngine === "kimi" ||
              thread.selectedEngine === "opencode"
                ? thread.selectedEngine
                : undefined,
            threadKind:
              thread.threadKind === "native" || thread.threadKind === "shared"
                ? thread.threadKind
                : undefined,
          });
        }
        handlers.onThreadStarted?.(workspaceId, thread as ThreadSummary);
      },
      onTurnStarted: (
        workspaceId: string,
        threadId: string,
        turnId: string,
      ) => {
        markImmediateCodexProcessingOwner(workspaceId, threadId, true);
        handlers.onTurnStarted?.(workspaceId, threadId, turnId);
      },
      onTurnCompleted: (
        workspaceId: string,
        threadId: string,
        turnId: string,
      ) => {
        handlers.onTurnCompleted?.(workspaceId, threadId, turnId);
      },
      onTurnError: (
        workspaceId: string,
        threadId: string,
        turnId: string,
        payload: {
          message: string;
          willRetry: boolean;
          suppressMessage?: boolean;
          engine?: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | null;
          executionTargetSnapshot?: TurnExecutionSnapshot;
        },
      ) => {
        handlers.onTurnError?.(workspaceId, threadId, turnId, payload);
      },
      onTurnStalled: (
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
          engine?: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | null;
        },
      ) => {
        handlers.onTurnStalled?.(workspaceId, threadId, turnId, payload);
      },
      getSingleProcessingCodexThreadId,
    }),
    [
      getSingleProcessingCodexThreadId,
      handlers,
      markImmediateCodexProcessingOwner,
      rememberImmediateThreadOwner,
    ],
  );

  useAppServerEvents(appServerEventHandlers, {
    useNormalizedRealtimeAdapters,
  });

  return {
    activeThreadId,
    setActiveThreadId,
    activeItems,
    threadItemsByThread: state.itemsByThread,
    historyRestoredAtMsByThread: state.historyRestoredAtMsByThread,
    approvals: state.approvals,
    userInputRequests: state.userInputRequests,
    threadsByWorkspace: state.threadsByWorkspace,
    threadParentById: state.threadParentById,
    threadStatusById: state.threadStatusById,
    historyLoadingByThreadId,
    historyLoadingProgressByThreadId,
    threadListLoadingByWorkspace: state.threadListLoadingByWorkspace,
    threadListPagingByWorkspace: state.threadListPagingByWorkspace,
    threadListCursorByWorkspace: state.threadListCursorByWorkspace,
    activeTurnIdByThread: state.activeTurnIdByThread,
    completionEmailIntentByThread,
    toggleCompletionEmailIntent,
    tokenUsageByThread: state.tokenUsageByThread,
    rateLimitsByWorkspace: state.rateLimitsByWorkspace,
    accountByWorkspace: state.accountByWorkspace,
    planByThread: state.planByThread,
    lastAgentMessageByThread: state.lastAgentMessageByThread,
    refreshAccountRateLimits,
    refreshAccountInfo,
    interruptTurn,
    removeThread,
    removeThreads,
    pinThread,
    unpinThread,
    isThreadPinned,
    getPinTimestamp,
    pinnedThreadsVersion,
    renameThread,
    autoNameThread,
    triggerAutoThreadTitle,
    isThreadAutoNaming,
    startThread,
    startThreadForWorkspace,
    finalizeCodexPendingThread,
    startSharedSessionForWorkspace,
    forkThreadForWorkspace,
    forkSessionFromMessageForWorkspace,
    forkClaudeSessionFromMessageForWorkspace,
    listThreadsForWorkspace,
    refreshThread,
    resetWorkspaceThreads,
    loadOlderThreadsForWorkspace,
    sendUserMessage,
    sendUserMessageToThread,
    handleFusionStalled,
    startFork,
    startReview,
    startResume,
    startMcp,
    startSpecRoot,
    startStatus,
    startContext,
    startCompact,
    startFast,
    startMode,
    startExport,
    startImport,
    startLsp,
    startShare,
    getThreadKind,
    getThreadEngine,
    getThreadProviderProfileId,
    updateThreadParent,
    resolveCanonicalThreadId,
    reviewPrompt,
    openReviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    confirmBranch,
    selectBranch,
    selectBranchAtIndex,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
    handleApprovalDecision,
    handleApprovalBatchAccept,
    handleApprovalRemember,
    handleUserInputSubmit,
    handleUserInputDismiss,
  };
}
