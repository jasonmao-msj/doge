import { startTransition, useCallback, useMemo, useRef } from "react";
import { yieldToInteractiveInput } from "../../../utils/interactiveMainThread";
import type { ThreadSummary, WorkspaceInfo } from "../../../types";
import {
  connectWorkspace as connectWorkspaceService,
  listThreadTitles as listThreadTitlesService,
  listThreads as listThreadsService,
  listClaudeSessions as listClaudeSessionsForFallbackSeedService,
  listGeminiSessions as listGeminiSessionsService,
  listGrokSessions as listGrokSessionsService,
  listKimiSessions as listKimiSessionsService,
  getOpenCodeSessionList as getOpenCodeSessionListService,
} from "../../../services/tauri";
import * as tauriServices from "../../../services/tauri";
import {
  getThreadTimestamp,
  previewThreadName,
} from "../../../utils/threadItems";
import { listSharedSessions as listSharedSessionsService } from "../../shared-session/services/sharedSessions";
import {
  buildNativeOwnerToSharedThreadMap,
  expandHiddenSharedBindingIds,
  normalizeSharedSessionSummaries,
  remapThreadParentsToSharedOwners,
  toSharedThreadSummary,
} from "../../shared-session/runtime/sharedSessionSummaries";
import { getCollabWorkerNativeHideIds } from "../../multi-agent/runtime/collabNativeHideRegistry";
import { asString } from "../utils/threadNormalize";
import { clearLiveAssistantText } from "../utils/liveAssistantTextChannel";
import { resolveCodexSubagentIdentity } from "../utils/codexSubagentIdentity";
import { saveThreadActivity } from "../utils/threadStorage";
import {
  collectKnownCodexThreadIds,
  normalizeComparableWorkspacePath,
} from "./useThreadActions.workspacePath";
import {
  useAutomaticRuntimeRecovery,
  type AutomaticRuntimeRecoverySource,
} from "./useAutomaticRuntimeRecovery";
import {
  createArchiveClaudeThreadAction,
  createArchiveThreadAction,
  createDeleteThreadForWorkspaceAction,
  createRenameThreadTitleMappingAction,
} from "./useThreadActions.sessionActions";
import {
  buildHiddenAutomaticSessionIdSet,
  extractThreadSizeBytes,
  filterHiddenAutomaticThreadSummaries,
  filterRetainableContinuitySummaries,
  hasHealthyThreadSummaries,
  isLocalSessionScanUnavailable,
  isRetainableEngineContinuitySummary,
  isWorkspaceNotConnectedError,
  markThreadSummariesDegraded,
  mergeCodexCatalogSessionSummaries,
  mergeDegradedCodexContinuitySummaries,
  mergeDegradedClaudeContinuitySummaries,
  mergeGeminiSessionSummaries,
  mergeGrokSessionSummaries,
  mergeKimiSessionSummaries,
  mergeThreadSummaryPreservingStableIdentity,
  normalizeGeminiSessionSummaries,
  normalizeGrokSessionSummaries,
  normalizeKimiSessionSummaries,
  normalizeThreadListPartialSource,
  resolveThreadSourceMeta,
  seedLastGoodClaudeIntoMerged,
  seedLastGoodOpenCodeIntoMerged,
  shouldIncludeWorkspaceThreadEntry,
  shouldApplyCodexSidebarContinuity,
  shouldApplyClaudeSidebarContinuity,
  isSharedCollabWorkerSpawnTitle,
  isSharedControlPlaneSpawnTitle,
  stripHiddenSharedBindingSummaries,
  threadIdMatchesHiddenAutomaticSessionSet,
  withTimeout,
  type GeminiSessionSummary,
  type GrokSessionSummary,
  type KimiSessionSummary,
} from "./useThreadActions.helpers";
import { buildPartialHistoryDiagnostic } from "../utils/stabilityDiagnostics";
import { buildThreadDebugCorrelation } from "../utils/threadDebugCorrelation";
import { useThreadActionsSessionRuntime } from "./useThreadActionsSessionRuntime";
import { useThreadActionsSessionCatalog } from "./useThreadActionsSessionCatalog";
import {
  applySessionArchiveState,
  useReconcileMissingClaudeThread,
} from "./useThreadActions.localState";
import { useThreadActionsResumeThreadForWorkspace } from "./useThreadActionsResumeThread";
import { useLoadOlderThreadsForWorkspace } from "./useThreadActionsLoadOlder";
import { useThreadHistoryLoadingState } from "./useThreadHistoryLoadingState";
import {
  GEMINI_SESSION_CACHE_TTL_MS,
  GEMINI_SESSION_FETCH_TIMEOUT_MS,
  GROK_SESSION_CACHE_TTL_MS,
  GROK_SESSION_FETCH_TIMEOUT_MS,
  KIMI_SESSION_CACHE_TTL_MS,
  KIMI_SESSION_FETCH_TIMEOUT_MS,
  NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
  OPENCODE_FULL_CATALOG_FETCH_TIMEOUT_MS,
  THREAD_LIST_LIVE_REQUEST_TIMEOUT_MS,
  THREAD_LIST_MAX_EMPTY_PAGES,
  THREAD_LIST_MAX_EMPTY_PAGES_WITH_ACTIVITY,
  THREAD_LIST_MAX_FETCH_DURATION_MS,
  THREAD_LIST_MAX_TOTAL_PAGES,
  THREAD_LIST_PAGE_SIZE,
  countCatalogSessionsByEngine,
  countSummariesByEngine,
  resolveInitialThreadListTargetCount,
  resolveNativeSessionListLimit,
  resolveThreadListCursorForDisplay,
  type StartupThreadHydrationMode,
} from "./useThreadActions.threadList";
import {
  buildLastGoodSnapshotBlockedEngines,
  findCatalogSourceStatusForEngine,
  hasAuthoritativeCatalogMembershipProof,
  isIncompleteCatalogSourceStatus,
  type ThreadEngineSource,
  type LastGoodThreadSummariesByEngine,
  useThreadActionsLastGoodSnapshots,
} from "./useThreadActions.lastGoodSnapshots";
import type { UseThreadActionsOptions } from "./useThreadActions.types";

export function useThreadActions({
  dispatch,
  itemsByThread,
  tokenUsageByThread = {},
  userInputRequests,
  threadsByWorkspace,
  activeThreadIdByWorkspace,
  threadListCursorByWorkspace,
  threadStatusById,
  onDebug,
  getCustomName,
  threadActivityRef,
  loadedThreadsRef,
  replaceOnResumeRef,
  applyCollabThreadLinksFromThread,
  updateThreadParent,
  onThreadTitleMappingsLoaded,
  onRenameThreadTitleMapping,
  onCodexPendingThreadFinalized,
  resolveCanonicalThreadId,
  rememberThreadAlias,
  clearThreadAlias,
  resolveWorkspacePath,
  useUnifiedHistoryLoader = false,
  sessionAttributionMode = "related",
}: UseThreadActionsOptions) {
  const {
    historyLoadingByThreadId,
    historyLoadingProgressByThreadId,
    setThreadHistoryLoading,
    setThreadHistoryLoadingProgress,
    setThreadHistoryRecoveryFailed,
  } = useThreadHistoryLoadingState();
  // Map workspaceId → filesystem path, populated in listThreadsForWorkspace
  const workspacePathsByIdRef = useRef<Record<string, string>>({});
  const geminiSessionCacheRef = useRef<
    Record<string, { fetchedAt: number; sessions: GeminiSessionSummary[] }>
  >({});
  const geminiRefreshAttemptedRef = useRef<Record<string, boolean>>({});
  const kimiSessionCacheRef = useRef<
    Record<string, { fetchedAt: number; sessions: KimiSessionSummary[] }>
  >({});
  const kimiRefreshAttemptedRef = useRef<Record<string, boolean>>({});
  const grokSessionCacheRef = useRef<
    Record<string, { fetchedAt: number; sessions: GrokSessionSummary[] }>
  >({});
  const grokRefreshAttemptedRef = useRef<Record<string, boolean>>({});
  const threadListRequestSeqRef = useRef<Record<string, number>>({});
  const lastGoodThreadSummariesByWorkspaceEngineRef = useRef<
    Record<string, LastGoodThreadSummariesByEngine>
  >({});
  const previousThreadsByWorkspaceRef = useRef(threadsByWorkspace);
  const latestThreadsByWorkspaceRef = useRef(threadsByWorkspace);
  if (latestThreadsByWorkspaceRef.current !== threadsByWorkspace) {
    previousThreadsByWorkspaceRef.current = latestThreadsByWorkspaceRef.current;
  }
  latestThreadsByWorkspaceRef.current = threadsByWorkspace;
  const listWorkspaceSessionsService = Object.prototype.hasOwnProperty.call(
    tauriServices,
    "listWorkspaceSessions",
  )
    ? tauriServices.listWorkspaceSessions
    : null;
  const canListWorkspaceSessions =
    typeof listWorkspaceSessionsService === "function";
  const listWorkspaceSessionArchiveEvidenceService =
    Object.prototype.hasOwnProperty.call(
      tauriServices,
      "listWorkspaceSessionArchiveEvidence",
    )
      ? tauriServices.listWorkspaceSessionArchiveEvidence
      : null;
  const { loadActiveProjectCatalogSessions, loadArchivedSessionMap } =
    useThreadActionsSessionCatalog({
      canListWorkspaceSessions,
      listWorkspaceSessionsService,
      listWorkspaceSessionArchiveEvidenceService,
    });
  const {
    beginAutomaticRuntimeRecovery,
    getAutomaticRuntimeRecoveryPartialSource,
  } = useAutomaticRuntimeRecovery(connectWorkspaceService);
  const {
    getLastGoodThreadSummaries,
    getLastGoodThreadSummariesForEngine,
    rememberLastGoodThreadSummariesByEngine,
    removeThreadFromCachedSummaries,
  } = useThreadActionsLastGoodSnapshots({
    latestThreadsByWorkspaceRef,
    previousThreadsByWorkspaceRef,
    lastGoodThreadSummariesByWorkspaceEngineRef,
    threadsByWorkspace,
  });

  const reconcileMissingClaudeThread = useReconcileMissingClaudeThread({
    activeThreadIdByWorkspace,
    dispatch,
    itemsByThread,
    loadedThreadsRef,
    onDebug,
    removeThreadFromCachedSummaries,
  });

  const renameThreadTitleMapping = useMemo(
    () =>
      createRenameThreadTitleMappingAction({
        getCustomName,
        onRenameThreadTitleMapping,
      }),
    [getCustomName, onRenameThreadTitleMapping],
  );

  const resumeThreadForWorkspace = useThreadActionsResumeThreadForWorkspace({
    activeThreadIdByWorkspace,
    applyCollabThreadLinksFromThread,
    dispatch,
    getCustomName,
    itemsByThread,
    tokenUsageByThread,
    loadedThreadsRef,
    onDebug,
    resolveCanonicalThreadId,
    rememberThreadAlias,
    clearThreadAlias,
    replaceOnResumeRef,
    reconcileMissingClaudeThread,
    resolveWorkspacePath,
    threadActivityRef,
    threadStatusById,
    threadsByWorkspace,
    updateThreadParent,
    userInputRequests,
    useUnifiedHistoryLoader,
    workspacePathsByIdRef,
    latestThreadsByWorkspaceRef,
    previousThreadsByWorkspaceRef,
    threadListCursorByWorkspace,
    setThreadHistoryRecoveryFailed,
    setThreadHistoryLoadingProgress,
  });

  const {
    startThreadForWorkspace,
    finalizeCodexPendingThread,
    startSharedSessionForWorkspace,
    forkThreadForWorkspace,
    forkClaudeSessionFromMessageForWorkspace,
    forkSessionFromMessageForWorkspace,
  } = useThreadActionsSessionRuntime({
    activeThreadIdByWorkspace,
    dispatch,
    itemsByThread,
    loadedThreadsRef,
    onCodexPendingThreadFinalized,
    onDebug,
    renameThreadTitleMapping,
    resumeThreadForWorkspace,
    threadsByWorkspace,
    workspacePathsByIdRef,
  });

  const refreshThread = useCallback(
    async (workspaceId: string, threadId: string) => {
      if (!threadId) {
        return null;
      }
      replaceOnResumeRef.current[threadId] = true;
      return resumeThreadForWorkspace(workspaceId, threadId, true, true);
    },
    [replaceOnResumeRef, resumeThreadForWorkspace],
  );

  const resetWorkspaceThreads = useCallback(
    (workspaceId: string) => {
      const threadIds = new Set<string>();
      const list = threadsByWorkspace[workspaceId] ?? [];
      list.forEach((thread) => threadIds.add(thread.id));
      const activeThread = activeThreadIdByWorkspace[workspaceId];
      if (activeThread) {
        threadIds.add(activeThread);
      }
      threadIds.forEach((threadId) => {
        loadedThreadsRef.current[threadId] = false;
      });
    },
    [activeThreadIdByWorkspace, loadedThreadsRef, threadsByWorkspace],
  );

  const listThreadsForWorkspace = useCallback(
    async (
      workspace: WorkspaceInfo,
      options?: {
        preserveState?: boolean;
        includeOpenCodeSessions?: boolean;
        deletedThreadIds?: string[];
        recoverySource?: AutomaticRuntimeRecoverySource;
        allowRuntimeReconnect?: boolean;
        startupHydrationMode?: StartupThreadHydrationMode;
        /** Orchestrator cancel/stale flag — skip late setThreads after soft-ignore cancel. */
        isStale?: () => boolean;
      },
    ) => {
      // Store workspace path for Claude session loading
      workspacePathsByIdRef.current[workspace.id] = workspace.path;
      const requestSeq =
        (threadListRequestSeqRef.current[workspace.id] ?? 0) + 1;
      threadListRequestSeqRef.current[workspace.id] = requestSeq;
      const isLatestThreadListRequest = () =>
        threadListRequestSeqRef.current[workspace.id] === requestSeq &&
        !(options?.isStale?.() ?? false);
      // Runtime workspace switch (soft-ignore cancel): stop further IPC/merge
      // stages after isStale. In-flight single invoke may finish; no fan-out after.
      const abandonIfStale = (): { applied: false; stale: true } | null =>
        isLatestThreadListRequest() ? null : { applied: false, stale: true };
      const preserveState = options?.preserveState ?? false;
      const isFirstPaintHydration =
        options?.startupHydrationMode === "first-paint";
      // First-paint never fans out OpenCode/native multi-engine lists.
      const includeOpenCodeSessions =
        !isFirstPaintHydration && (options?.includeOpenCodeSessions ?? true);
      const deletedThreadIds = [
        ...new Set(
          (options?.deletedThreadIds ?? [])
            .map((threadId) => threadId.trim())
            .filter(Boolean),
        ),
      ];
      const deletedThreadIdSet = new Set(deletedThreadIds);
      const filterDeletedSummaries = (summaries: ThreadSummary[]) =>
        deletedThreadIdSet.size === 0
          ? summaries
          : summaries.filter((summary) => !deletedThreadIdSet.has(summary.id));
      const filterRootVisibleAutomaticSummaries = (
        summaries: ThreadSummary[],
      ) =>
        summaries.filter(
          (summary) => summary.autoSession?.visibility !== "hidden",
        );
      const getLastGoodThreadSummariesWithoutDeleted = () =>
        filterRootVisibleAutomaticSummaries(
          filterDeletedSummaries(getLastGoodThreadSummaries(workspace.id)),
        );
      const getLastGoodThreadSummariesForEngineWithoutDeleted = (
        engine: ThreadEngineSource,
      ) =>
        filterRootVisibleAutomaticSummaries(
          filterDeletedSummaries(
            getLastGoodThreadSummariesForEngine(workspace.id, engine),
          ),
        );
      const recoverySource = options?.recoverySource ?? "thread-list-live";
      const allowRuntimeReconnect = options?.allowRuntimeReconnect ?? true;
      let appliedThreadListUpdate = false;
      const workspacePath = normalizeComparableWorkspacePath(workspace.path);
      deletedThreadIds.forEach((threadId) => {
        loadedThreadsRef.current[threadId] = false;
        removeThreadFromCachedSummaries(workspace.id, threadId);
        clearLiveAssistantText(threadId);
        dispatch({ type: "removeThread", workspaceId: workspace.id, threadId });
      });
      if (!preserveState) {
        dispatch({
          type: "setThreadListLoading",
          workspaceId: workspace.id,
          isLoading: true,
        });
        dispatch({
          type: "setThreadListCursor",
          workspaceId: workspace.id,
          cursor: null,
        });
      }
      onDebug?.({
        id: `${Date.now()}-client-thread-list`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/list",
        payload: buildThreadDebugCorrelation(
          {
            workspaceId: workspace.id,
            action: "thread-list-refresh",
            engine: "multi",
          },
          { path: workspace.path },
        ),
      });
      const archivedSessionMapPromise = loadArchivedSessionMap(workspace.id);
      try {
        let degradedPartialSource: string | null = null;
        const partialSourcesSeen = new Set<string>();
        const rememberPartialSource = (value: unknown) => {
          const normalized = normalizeThreadListPartialSource(value);
          if (normalized) {
            partialSourcesSeen.add(normalized);
            if (!degradedPartialSource) {
              degradedPartialSource = normalized;
            }
          }
        };
        {
          const abandoned = abandonIfStale();
          if (abandoned) {
            return abandoned;
          }
        }
        let mappedTitles: Record<string, string> = {};
        try {
          // Titles/shared must not hang the whole list path forever: orchestrator
          // timeout alone still leaves this promise running under soft-ignore.
          const titlesResult = await withTimeout(
            // Coerce null→{} before the race so withTimeout's null strictly
            // means "timed out" (invoke may legitimately resolve null).
            listThreadTitlesService(workspace.id).then((value) => value ?? {}),
            NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
          );
          if (titlesResult === null) {
            mappedTitles = {};
            rememberPartialSource("thread-titles-timeout");
          } else {
            mappedTitles = titlesResult;
            onThreadTitleMappingsLoaded?.(workspace.id, mappedTitles);
          }
        } catch {
          mappedTitles = {};
        }
        {
          const abandoned = abandonIfStale();
          if (abandoned) {
            return abandoned;
          }
        }
        const sharedSessionsResult = await withTimeout(
          // Coerce null→[] so the null sentinel only means timeout (see above).
          listSharedSessionsService(workspace.id)
            .catch(() => [])
            .then((value) => value ?? []),
          NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
        );
        if (sharedSessionsResult === null) {
          rememberPartialSource("shared-sessions-timeout");
        }
        {
          const abandoned = abandonIfStale();
          if (abandoned) {
            return abandoned;
          }
        }
        const sharedSessions = normalizeSharedSessionSummaries(
          sharedSessionsResult ?? [],
        );
        const hiddenSharedBindingIds = expandHiddenSharedBindingIds([
          ...sharedSessions.flatMap((session) => session.nativeThreadIds),
          // 协作 worker realtime 登记的 native id（改名 Agent N 后仍能 strip）
          ...getCollabWorkerNativeHideIds(),
        ]);
        const nativeOwnerToSharedThreadId =
          buildNativeOwnerToSharedThreadMap(sharedSessions);
        const existingThreads = filterDeletedSummaries(
          threadsByWorkspace[workspace.id] ?? [],
        );
        const activeThreadId = activeThreadIdByWorkspace[workspace.id] ?? "";
        const knownCodexThreadIds = collectKnownCodexThreadIds(
          existingThreads,
          activeThreadId,
        );
        const engineById = new Map(
          existingThreads.map((thread) => [thread.id, thread.engineSource]),
        );
        const hasGeminiSignal =
          existingThreads.some(
            (thread) =>
              thread.engineSource === "gemini" ||
              thread.id.startsWith("gemini:") ||
              thread.id.startsWith("gemini-pending-"),
          ) ||
          activeThreadId.startsWith("gemini:") ||
          activeThreadId.startsWith("gemini-pending-") ||
          Object.keys(mappedTitles).some((id) => id.startsWith("gemini:"));
        const cachedGemini = geminiSessionCacheRef.current[workspace.id];
        const hasFreshGeminiCache =
          !!cachedGemini &&
          Date.now() - cachedGemini.fetchedAt <= GEMINI_SESSION_CACHE_TTL_MS;
        const hasKimiSignal =
          existingThreads.some(
            (thread) =>
              thread.engineSource === "kimi" ||
              thread.id.startsWith("kimi:") ||
              thread.id.startsWith("kimi-pending-"),
          ) ||
          activeThreadId.startsWith("kimi:") ||
          activeThreadId.startsWith("kimi-pending-") ||
          Object.keys(mappedTitles).some((id) => id.startsWith("kimi:"));
        const cachedKimi = kimiSessionCacheRef.current[workspace.id];
        const hasFreshKimiCache =
          !!cachedKimi &&
          Date.now() - cachedKimi.fetchedAt <= KIMI_SESSION_CACHE_TTL_MS;
        const hasGrokSignal =
          existingThreads.some(
            (thread) =>
              thread.engineSource === "grok" ||
              thread.id.startsWith("grok:") ||
              thread.id.startsWith("grok-pending-"),
          ) ||
          activeThreadId.startsWith("grok:") ||
          activeThreadId.startsWith("grok-pending-") ||
          Object.keys(mappedTitles).some((id) => id.startsWith("grok:"));
        const cachedGrok = grokSessionCacheRef.current[workspace.id];
        const hasFreshGrokCache =
          !!cachedGrok &&
          Date.now() - cachedGrok.fetchedAt <= GROK_SESSION_CACHE_TTL_MS;
        const knownActivityByThread =
          threadActivityRef.current[workspace.id] ?? {};
        const hasKnownActivity = Object.keys(knownActivityByThread).length > 0;
        const matchingThreads: Record<string, unknown>[] = [];
        // First paint: only the visible root budget (default 5). More via Load older.
        const targetCount = resolveInitialThreadListTargetCount(workspace);
        const pageSize = Math.max(THREAD_LIST_PAGE_SIZE, targetCount);
        const maxPagesWithoutMatch = hasKnownActivity
          ? THREAD_LIST_MAX_EMPTY_PAGES_WITH_ACTIVITY
          : THREAD_LIST_MAX_EMPTY_PAGES;
        let pagesFetched = 0;
        const fetchStartedAt = Date.now();
        let cursor: string | null = null;
        do {
          {
            const abandoned = abandonIfStale();
            if (abandoned) {
              return abandoned;
            }
          }
          pagesFetched += 1;
          let response: Record<string, unknown>;
          try {
            const liveResponse = await withTimeout(
              (async () => {
                try {
                  return await listThreadsService(
                    workspace.id,
                    cursor,
                    pageSize,
                  );
                } catch (error) {
                  if (
                    !isWorkspaceNotConnectedError(error) ||
                    !allowRuntimeReconnect
                  ) {
                    throw error;
                  }
                  const recovery = beginAutomaticRuntimeRecovery(
                    workspace.id,
                    recoverySource,
                  );
                  if (recovery.kind === "waiter") {
                    rememberPartialSource("guarded-recovery-waiter");
                    onDebug?.({
                      id: `${Date.now()}-client-workspace-recovery-waiter`,
                      timestamp: Date.now(),
                      source: "client",
                      label: "workspace/recovery waiter before thread list",
                      payload: buildThreadDebugCorrelation(
                        {
                          workspaceId: workspace.id,
                          action: "thread-list-refresh",
                          engine: "codex",
                          recoveryState: "degraded",
                        },
                        { recoverySource },
                      ),
                    });
                    throw error;
                  }
                  if (recovery.kind === "cooldown") {
                    rememberPartialSource("automatic-recovery-cooldown");
                    onDebug?.({
                      id: `${Date.now()}-client-workspace-recovery-cooldown`,
                      timestamp: Date.now(),
                      source: "client",
                      label: "workspace/recovery cooldown before thread list",
                      payload: buildThreadDebugCorrelation(
                        {
                          workspaceId: workspace.id,
                          action: "thread-list-refresh",
                          engine: "codex",
                          recoveryState: "degraded",
                        },
                        { recoverySource },
                      ),
                    });
                    throw error;
                  }
                  onDebug?.({
                    id: `${Date.now()}-client-workspace-reconnect-before-thread-list`,
                    timestamp: Date.now(),
                    source: "client",
                    label: "workspace/reconnect before thread list",
                    payload: buildThreadDebugCorrelation(
                      {
                        workspaceId: workspace.id,
                        action: "thread-list-refresh",
                        engine: "codex",
                        recoveryState: "recovering",
                      },
                      { recoverySource },
                    ),
                  });
                  await recovery.promise;
                  return await listThreadsService(
                    workspace.id,
                    cursor,
                    pageSize,
                  );
                }
              })(),
              THREAD_LIST_LIVE_REQUEST_TIMEOUT_MS,
            );
            if (liveResponse === null) {
              rememberPartialSource(
                getAutomaticRuntimeRecoveryPartialSource(workspace.id) ??
                  "thread-list-live-timeout",
              );
              onDebug?.({
                id: `${Date.now()}-client-thread-list-live-timeout`,
                timestamp: Date.now(),
                source: "error",
                label: "thread/list live timeout",
                payload: {
                  workspaceId: workspace.id,
                  cursor,
                  timeoutMs: THREAD_LIST_LIVE_REQUEST_TIMEOUT_MS,
                },
              });
              break;
            }
            response = liveResponse as Record<string, unknown>;
          } catch (error) {
            if (!isWorkspaceNotConnectedError(error)) {
              throw error;
            }
            rememberPartialSource("workspace-not-connected");
            onDebug?.({
              id: `${Date.now()}-client-thread-list-codex-unavailable`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list codex unavailable",
              payload: buildThreadDebugCorrelation(
                {
                  workspaceId: workspace.id,
                  action: "thread-list-codex-unavailable",
                  engine: "codex",
                  recoveryState: "recovering",
                },
                {
                  reason:
                    error instanceof Error ? error.message : String(error),
                },
              ),
            });
            break;
          }
          onDebug?.({
            id: `${Date.now()}-server-thread-list`,
            timestamp: Date.now(),
            source: "server",
            label: "thread/list response",
            payload: response,
          });
          const result = (response.result ?? response) as Record<
            string,
            unknown
          >;
          rememberPartialSource(result.partialSource ?? result.partial_source);
          const data = Array.isArray(result?.data)
            ? (result.data as Record<string, unknown>[])
            : [];
          const allowKnownCodexWithoutCwd =
            isLocalSessionScanUnavailable(result);
          const nextCursor = (result?.nextCursor ??
            result?.next_cursor ??
            null) as string | null;
          matchingThreads.push(
            ...data.filter((thread) =>
              shouldIncludeWorkspaceThreadEntry(
                thread,
                workspacePath,
                knownCodexThreadIds,
                allowKnownCodexWithoutCwd,
              ),
            ),
          );
          cursor = nextCursor;
          if (
            matchingThreads.length === 0 &&
            pagesFetched >= maxPagesWithoutMatch
          ) {
            onDebug?.({
              id: `${Date.now()}-client-thread-list-stop-empty-pages`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list stop",
              payload: {
                workspaceId: workspace.id,
                reason: "too-many-empty-pages",
                pagesFetched,
                maxPagesWithoutMatch,
              },
            });
            break;
          }
          if (pagesFetched >= THREAD_LIST_MAX_TOTAL_PAGES) {
            onDebug?.({
              id: `${Date.now()}-client-thread-list-stop-page-cap`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list stop",
              payload: {
                workspaceId: workspace.id,
                reason: "page-cap",
                pagesFetched,
                pageCap: THREAD_LIST_MAX_TOTAL_PAGES,
              },
            });
            break;
          }
          if (
            Date.now() - fetchStartedAt >=
            THREAD_LIST_MAX_FETCH_DURATION_MS
          ) {
            onDebug?.({
              id: `${Date.now()}-client-thread-list-stop-time-budget`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list stop",
              payload: {
                workspaceId: workspace.id,
                reason: "time-budget",
                pagesFetched,
                budgetMs: THREAD_LIST_MAX_FETCH_DURATION_MS,
              },
            });
            break;
          }
        } while (cursor && matchingThreads.length < targetCount);

        const uniqueById = new Map<string, Record<string, unknown>>();
        matchingThreads.forEach((thread) => {
          const id = String(thread?.id ?? "");
          if (id && !uniqueById.has(id)) {
            uniqueById.set(id, thread);
          }
        });
        const uniqueThreads = Array.from(uniqueById.values());
        const activityByThread = threadActivityRef.current[workspace.id] ?? {};
        const nextActivityByThread = { ...activityByThread };
        let didChangeActivity = false;
        uniqueThreads.forEach((thread) => {
          const threadId = String(thread?.id ?? "");
          if (!threadId) {
            return;
          }
          const timestamp = getThreadTimestamp(thread);
          if (timestamp > (nextActivityByThread[threadId] ?? 0)) {
            nextActivityByThread[threadId] = timestamp;
            didChangeActivity = true;
          }
        });
        uniqueThreads.sort((a, b) => {
          const aId = String(a?.id ?? "");
          const bId = String(b?.id ?? "");
          const aCreated = getThreadTimestamp(a);
          const bCreated = getThreadTimestamp(b);
          const aActivity = Math.max(nextActivityByThread[aId] ?? 0, aCreated);
          const bActivity = Math.max(nextActivityByThread[bId] ?? 0, bCreated);
          return bActivity - aActivity;
        });
        const summaries = uniqueThreads
          .slice(0, targetCount)
          .map((thread, index) => {
            const id = String(thread?.id ?? "");
            const preview = asString(thread?.preview ?? "").trim();
            const nativeTitle = asString(thread?.nativeTitle ?? "").trim();
            const mappedTitle = mappedTitles[id];
            const customName = getCustomName(workspace.id, id) || mappedTitle;
            const liveIdentity = resolveCodexSubagentIdentity(id, thread);
            const fallbackName = `Agent ${index + 1}`;
            const name = customName
              ? customName
              : nativeTitle ||
                (liveIdentity.name ??
                  (preview.length > 0
                    ? previewThreadName(preview, fallbackName)
                    : fallbackName));
            const engineSource = engineById.get(id) ?? ("codex" as const);
            const sourceMeta = resolveThreadSourceMeta(thread);
            return {
              id,
              name,
              updatedAt: getThreadTimestamp(thread),
              sizeBytes: extractThreadSizeBytes(thread),
              engineSource,
              threadKind: "native" as const,
              folderId:
                typeof thread.folderId === "string" &&
                thread.folderId.trim().length > 0
                  ? thread.folderId.trim()
                  : null,
              ...sourceMeta,
              ...(liveIdentity.parentThreadId
                ? { parentThreadId: liveIdentity.parentThreadId }
                : {}),
            };
          })
          .filter((entry) => entry.id && !hiddenSharedBindingIds.has(entry.id));

        let allSummaries: ThreadSummary[] = summaries;
        const mergedById = new Map<string, ThreadSummary>();
        allSummaries.forEach((entry) => mergedById.set(entry.id, entry));
        const lastGoodThreadSummaries = getLastGoodThreadSummaries(
          workspace.id,
        );
        const nativeSessionListLimit = resolveNativeSessionListLimit(workspace);
        // Yield so clicks queued during codex paging can run before catalog.
        // Must abandon BEFORE starting multi-engine fan-out (soft-ignore cancel).
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
        {
          const abandoned = abandonIfStale();
          if (abandoned) {
            return abandoned;
          }
        }
        // Budget is applied inside getOpenCodeSessionList so command-cost trace
        // reflects the budget (not zombie IPC wall-clock after withTimeout).
        const opencodeSessionsPromise = includeOpenCodeSessions
          ? getOpenCodeSessionListService(workspace.id, {
              timeoutMs: OPENCODE_FULL_CATALOG_FETCH_TIMEOUT_MS,
              timeoutResult: "null",
            })
          : Promise.resolve(
              [] as Awaited<ReturnType<typeof getOpenCodeSessionListService>>,
            );
        // Cold-start first-paint: skip multi-engine project catalog + Claude
        // disk seed. That path is the multi-second main-thread/IPC freeze window
        // (list_workspace_sessions walks every engine). Full-catalog runs idle.
        const projectCatalogSessionsPromise =
          !isFirstPaintHydration && canListWorkspaceSessions
            ? loadActiveProjectCatalogSessions(
                workspace.id,
                sessionAttributionMode,
              )
            : Promise.resolve(null);
        const claudeSessionsPromise = isFirstPaintHydration
          ? Promise.resolve(
              null as Awaited<
                ReturnType<typeof listClaudeSessionsForFallbackSeedService>
              > | null,
            )
          : withTimeout(
              listClaudeSessionsForFallbackSeedService(
                workspace.path,
                nativeSessionListLimit,
              ),
              NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
            );
        const [claudeResult, opencodeResult, projectCatalogResult] =
          await Promise.allSettled([
            claudeSessionsPromise,
            opencodeSessionsPromise,
            projectCatalogSessionsPromise,
          ]);
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
        {
          const abandoned = abandonIfStale();
          if (abandoned) {
            return abandoned;
          }
        }
        const projectCatalogValue =
          projectCatalogResult.status === "fulfilled"
            ? projectCatalogResult.value
            : null;
        const hiddenAutomaticSessionIds = buildHiddenAutomaticSessionIdSet(
          projectCatalogValue?.hiddenAutomaticSessionIds,
        );
        const catalogClaudeSourceStatus = findCatalogSourceStatusForEngine(
          projectCatalogValue?.sourceStatuses,
          "claude",
        );
        // Native Claude history is a legacy fallback/diagnostic seed here.
        // When catalog reports Claude source status, catalog projection owns
        // membership and native rows must not widen or erase that projection.
        const shouldMergeNativeClaudeSessions = !catalogClaudeSourceStatus;
        if (isIncompleteCatalogSourceStatus(catalogClaudeSourceStatus)) {
          rememberPartialSource(
            catalogClaudeSourceStatus?.reason ??
              `claude-${catalogClaudeSourceStatus?.completeness}`,
          );
        }
        const claudeSuccessfulEmpty =
          shouldMergeNativeClaudeSessions &&
          claudeResult.status === "fulfilled" &&
          Array.isArray(claudeResult.value) &&
          claudeResult.value.length === 0;
        if (claudeResult.status === "fulfilled") {
          if (shouldMergeNativeClaudeSessions && claudeResult.value === null) {
            rememberPartialSource("claude-session-timeout");
            onDebug?.({
              id: `${Date.now()}-client-claude-session-timeout`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list claude timeout",
              payload: {
                workspaceId: workspace.id,
                timeoutMs: OPENCODE_FULL_CATALOG_FETCH_TIMEOUT_MS,
              },
            });
            // 在 partial-source merge 之前先 seed last-good Claude 条目，
            // 避免下游 catalog merge / archive merge 因看到空 Claude 子源而形成残缺基底。
            // 即便下游 partial-source 路径被绕过或将来重构，最终列表也不会丢失 Claude 历史。
            seedLastGoodClaudeIntoMerged(
              mergedById,
              getLastGoodThreadSummariesForEngineWithoutDeleted("claude"),
              hiddenSharedBindingIds,
            );
          }
          const claudeSessions =
            shouldMergeNativeClaudeSessions && Array.isArray(claudeResult.value)
              ? claudeResult.value
              : [];
          claudeSessions.forEach(
            (session: {
              sessionId: string;
              firstMessage: string;
              nativeTitle?: string | null;
              updatedAt: number;
              fileSizeBytes?: number;
              parentSessionId?: string | null;
            }) => {
              const id = `claude:${session.sessionId}`;
              const parentThreadId = session.parentSessionId
                ? `claude:${session.parentSessionId}`
                : null;
              if (hiddenSharedBindingIds.has(id)) {
                return;
              }
              if (
                threadIdMatchesHiddenAutomaticSessionSet(
                  id,
                  hiddenAutomaticSessionIds,
                )
              ) {
                return;
              }
              // Shared/control-plane 内部 session：raw 首包或 nativeTitle 行首 MOSSX_*
              if (
                isSharedControlPlaneSpawnTitle(session.firstMessage) ||
                isSharedControlPlaneSpawnTitle(session.nativeTitle)
              ) {
                return;
              }
              const prev = mergedById.get(id);
              const updatedAt = session.updatedAt;
              const mappedTitle = mappedTitles[id];
              const customTitle = getCustomName(workspace.id, id);
              const nativeTitle = asString(session.nativeTitle).trim();
              const previewName = previewThreadName(
                session.firstMessage,
                "Claude Session",
              );
              if (
                isSharedControlPlaneSpawnTitle(mappedTitle) ||
                isSharedControlPlaneSpawnTitle(previewName)
              ) {
                return;
              }
              const next: ThreadSummary = {
                id,
                name:
                  customTitle ||
                  mappedTitle ||
                  nativeTitle ||
                  previewName,
                updatedAt,
                sizeBytes: extractThreadSizeBytes(
                  session as Record<string, unknown>,
                ),
                engineSource: "claude",
                threadKind: "native",
                parentThreadId,
              };
              if (!prev || next.updatedAt >= prev.updatedAt) {
                mergedById.set(
                  id,
                  mergeThreadSummaryPreservingStableIdentity(prev, next, {
                    mappedTitle,
                    customTitle,
                    nativeTitle,
                  }),
                );
              }
            },
          );
        } else if (shouldMergeNativeClaudeSessions) {
          rememberPartialSource("claude-session-error");
          onDebug?.({
            id: `${Date.now()}-client-claude-session-error`,
            timestamp: Date.now(),
            source: "client",
            label: "thread/list claude error",
            payload: {
              workspaceId: workspace.id,
              error: String(claudeResult.reason ?? "unknown error"),
            },
          });
          // 同 timeout 路径：reject 时也 seed last-good Claude，确保兜底前置。
          seedLastGoodClaudeIntoMerged(
            mergedById,
            getLastGoodThreadSummariesForEngineWithoutDeleted("claude"),
            hiddenSharedBindingIds,
          );
        }
        if (opencodeResult.status === "fulfilled") {
          if (opencodeResult.value === null) {
            rememberPartialSource("opencode-session-timeout");
            onDebug?.({
              id: `${Date.now()}-client-opencode-session-timeout`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list opencode timeout",
              payload: {
                workspaceId: workspace.id,
                timeoutMs: NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
              },
            });
            // 与 Claude timeout 分支对称：seed last-good OpenCode 条目，
            // 防止下游 catalog merge / archive merge 因看到空 OpenCode 子源而形成残缺基底。
            seedLastGoodOpenCodeIntoMerged(
              mergedById,
              getLastGoodThreadSummariesForEngineWithoutDeleted("opencode"),
              hiddenSharedBindingIds,
            );
          }
          const opencodeSessions = Array.isArray(opencodeResult.value)
            ? opencodeResult.value
            : [];
          opencodeSessions.forEach((session) => {
            const id = `opencode:${session.sessionId}`;
            if (hiddenSharedBindingIds.has(id)) {
              return;
            }
            if (
              threadIdMatchesHiddenAutomaticSessionSet(
                id,
                hiddenAutomaticSessionIds,
              )
            ) {
              return;
            }
            if (
              isSharedControlPlaneSpawnTitle(session.title) ||
              isSharedControlPlaneSpawnTitle(mappedTitles[id])
            ) {
              return;
            }
            const prev = mergedById.get(id);
            const sessionUpdatedAt =
              typeof session.updatedAt === "number" &&
              Number.isFinite(session.updatedAt)
                ? Math.max(0, session.updatedAt)
                : 0;
            const updatedAt =
              sessionUpdatedAt ||
              nextActivityByThread[id] ||
              prev?.updatedAt ||
              0;
            if (updatedAt > (nextActivityByThread[id] ?? 0)) {
              nextActivityByThread[id] = updatedAt;
              didChangeActivity = true;
            }
            const previewName = previewThreadName(
              session.title,
              "OpenCode Session",
            );
            if (isSharedControlPlaneSpawnTitle(previewName)) {
              return;
            }
            const next: ThreadSummary = {
              id,
              name:
                mappedTitles[id] ||
                getCustomName(workspace.id, id) ||
                previewName,
              updatedAt,
              sizeBytes: extractThreadSizeBytes(
                session as Record<string, unknown>,
              ),
              engineSource: "opencode",
              threadKind: "native",
            };
            if (!prev || next.updatedAt >= prev.updatedAt) {
              mergedById.set(id, next);
            }
          });
        } else {
          // 与 Claude rejected 分支对称：补全此前缺失的 else，
          // 确保 OpenCode 子源抛错时仍发出可观测诊断并 seed last-good，避免静默吞错。
          rememberPartialSource("opencode-session-error");
          onDebug?.({
            id: `${Date.now()}-client-opencode-session-error`,
            timestamp: Date.now(),
            source: "client",
            label: "thread/list opencode error",
            payload: {
              workspaceId: workspace.id,
              error: String(opencodeResult.reason ?? "unknown error"),
            },
          });
          seedLastGoodOpenCodeIntoMerged(
            mergedById,
            getLastGoodThreadSummariesForEngineWithoutDeleted("opencode"),
            hiddenSharedBindingIds,
          );
        }
        if (projectCatalogResult.status === "fulfilled") {
          if (projectCatalogValue === null) {
            rememberPartialSource("codex-catalog-timeout");
            onDebug?.({
              id: `${Date.now()}-client-codex-catalog-timeout`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list codex catalog timeout",
              payload: {
                workspaceId: workspace.id,
                timeoutMs: NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
              },
            });
          }
          rememberPartialSource(projectCatalogValue?.partialSource);
          const projectCatalogSessions = (
            projectCatalogValue?.sessions ?? []
          ).filter((entry) => {
            if (deletedThreadIdSet.has(entry.sessionId)) return false;
            // id 命中 Shared hidden binding（含 codex:uuid / raw uuid）
            if (
              hiddenSharedBindingIds.has(entry.sessionId) ||
              (() => {
                const colon = entry.sessionId.indexOf(":");
                if (colon <= 0) return false;
                const bare = entry.sessionId.slice(colon + 1).trim();
                return Boolean(bare && hiddenSharedBindingIds.has(bare));
              })()
            ) {
              return false;
            }
            // 协作 worker multi-line MOSSX+squad（改名成 Agent N 之前）
            // 不用任意 MOSSX 单行，避免 Provider Continuation 被误杀
            if (
              isSharedCollabWorkerSpawnTitle(entry.title) ||
              isSharedCollabWorkerSpawnTitle(entry.nativeTitle)
            ) {
              return false;
            }
            return true;
          });
          if (claudeSuccessfulEmpty && projectCatalogValue?.partialSource) {
            onDebug?.({
              id: `${Date.now()}-client-claude-successful-empty-degraded`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list claude successful empty degraded",
              payload: {
                workspaceId: workspace.id,
                partialSource: projectCatalogValue.partialSource,
                lastGoodCount: lastGoodThreadSummaries.length,
                currentEngineCounts: countSummariesByEngine(
                  Array.from(mergedById.values()),
                ),
                catalogEngineCounts: countCatalogSessionsByEngine(
                  projectCatalogSessions,
                ),
              },
            });
          }
          allSummaries = mergeCodexCatalogSessionSummaries(
            Array.from(mergedById.values()).sort(
              (a, b) => b.updatedAt - a.updatedAt,
            ),
            projectCatalogSessions,
            workspace.id,
            mappedTitles,
            getCustomName,
            hiddenSharedBindingIds,
          );
          mergedById.clear();
          allSummaries.forEach((entry) => mergedById.set(entry.id, entry));
        } else {
          rememberPartialSource("codex-catalog-error");
        }
        if (!includeOpenCodeSessions) {
          existingThreads.forEach((thread) => {
            if (
              thread.threadKind === "shared" ||
              hiddenSharedBindingIds.has(thread.id)
            ) {
              return;
            }
            const isOpenCodeThread =
              thread.engineSource === "opencode" ||
              thread.id.startsWith("opencode:") ||
              thread.id.startsWith("opencode-pending-");
            if (
              !isOpenCodeThread ||
              !isRetainableEngineContinuitySummary("opencode", thread)
            ) {
              return;
            }
            const prev = mergedById.get(thread.id);
            const threadUpdatedAt = Number.isFinite(thread.updatedAt)
              ? Math.max(0, thread.updatedAt)
              : 0;
            const updatedAt =
              threadUpdatedAt ||
              nextActivityByThread[thread.id] ||
              prev?.updatedAt ||
              0;
            if (updatedAt > (nextActivityByThread[thread.id] ?? 0)) {
              nextActivityByThread[thread.id] = updatedAt;
              didChangeActivity = true;
            }
            const next: ThreadSummary = {
              ...thread,
              updatedAt,
              engineSource: "opencode",
              threadKind: thread.threadKind ?? "native",
            };
            if (!prev || next.updatedAt >= prev.updatedAt) {
              mergedById.set(thread.id, next);
            }
          });
        }
        allSummaries = Array.from(mergedById.values()).sort(
          (a, b) => b.updatedAt - a.updatedAt,
        );
        if (hasFreshGeminiCache && cachedGemini.sessions.length > 0) {
          allSummaries = mergeGeminiSessionSummaries(
            allSummaries,
            cachedGemini.sessions.filter(
              (session) =>
                !hiddenSharedBindingIds.has(`gemini:${session.sessionId}`),
            ),
            workspace.id,
            mappedTitles,
            getCustomName,
            hiddenSharedBindingIds,
          );
        }
        if (hasFreshKimiCache && cachedKimi.sessions.length > 0) {
          allSummaries = mergeKimiSessionSummaries(
            allSummaries,
            cachedKimi.sessions.filter(
              (session) =>
                !hiddenSharedBindingIds.has(`kimi:${session.sessionId}`),
            ),
            workspace.id,
            mappedTitles,
            getCustomName,
            hiddenSharedBindingIds,
          );
        }
        if (hasFreshGrokCache && cachedGrok.sessions.length > 0) {
          allSummaries = mergeGrokSessionSummaries(
            allSummaries,
            cachedGrok.sessions.filter(
              (session) =>
                !hiddenSharedBindingIds.has(`grok:${session.sessionId}`),
            ),
            workspace.id,
            mappedTitles,
            getCustomName,
            nativeOwnerToSharedThreadId,
            hiddenSharedBindingIds,
          );
        }
        // fix-shared-session-target-race-and-merge T5b：
        // 仅当 list 空/失败（catch→[]）时，用 previous frame existingThreads 补回 shared:。
        // 非空 list 视为权威全集：不得把「已删除但不在 list 中」的 shared 复活。
        const existingSharedSummaries = existingThreads.filter((s) =>
          s.id.startsWith("shared:"),
        );
        if (sharedSessions.length > 0) {
          const sharedSummaries = sharedSessions.map(toSharedThreadSummary);
          const merged = new Map<string, ThreadSummary>();
          [...sharedSummaries, ...allSummaries].forEach((entry) => {
            const previous = merged.get(entry.id);
            if (!previous || entry.updatedAt >= previous.updatedAt) {
              merged.set(entry.id, entry);
            }
          });
          allSummaries = Array.from(merged.values()).sort(
            (a, b) => b.updatedAt - a.updatedAt,
          );
          // Shared 合并后再次 remap：兜底 cache miss / 其它路径写入的 parent
          allSummaries = remapThreadParentsToSharedOwners(
            allSummaries,
            nativeOwnerToSharedThreadId,
          );
        } else if (existingSharedSummaries.length > 0) {
          // 空 list（含 error→[]）：补回 previous shared，避免侧栏整段丢 Shared
          const mergedBack = new Map<string, ThreadSummary>();
          allSummaries.forEach((entry) => mergedBack.set(entry.id, entry));
          existingSharedSummaries.forEach((entry) => {
            if (!mergedBack.has(entry.id)) {
              mergedBack.set(entry.id, entry);
            }
          });
          allSummaries = Array.from(mergedBack.values()).sort(
            (a, b) => b.updatedAt - a.updatedAt,
          );
        }
        const archivedSessionMap = await archivedSessionMapPromise;
        rememberPartialSource(archivedSessionMap?.partialSource);
        if (didChangeActivity) {
          const next = {
            ...threadActivityRef.current,
            [workspace.id]: nextActivityByThread,
          };
          threadActivityRef.current = next;
          saveThreadActivity(next);
        }

        {
          const abandoned = abandonIfStale();
          if (abandoned) {
            return abandoned;
          }
        }

        let visibleSummaries = allSummaries;
        let lastGoodSnapshotCandidates: ThreadSummary[] | null = allSummaries;
        const hasAuthoritativeEmptyCatalog =
          visibleSummaries.length === 0 &&
          !degradedPartialSource &&
          hasAuthoritativeCatalogMembershipProof(
            projectCatalogValue?.sourceStatuses,
          );
        const emptyListFallbackSource =
          visibleSummaries.length === 0 && !hasAuthoritativeEmptyCatalog
            ? (degradedPartialSource ?? "empty-thread-list")
            : null;
        if (emptyListFallbackSource) {
          lastGoodSnapshotCandidates = null;
          const fallbackThreads = filterRetainableContinuitySummaries(
            getLastGoodThreadSummariesWithoutDeleted(),
            hiddenSharedBindingIds,
          );
          if (fallbackThreads.length > 0) {
            visibleSummaries = markThreadSummariesDegraded(
              fallbackThreads,
              emptyListFallbackSource,
              "last-good-fallback",
            );
            const diagnostic = buildPartialHistoryDiagnostic(
              `thread list fallback: ${emptyListFallbackSource}`,
            );
            onDebug?.({
              id: `${Date.now()}-client-thread-list-fallback`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list fallback",
              payload: buildThreadDebugCorrelation(
                {
                  workspaceId: workspace.id,
                  action: "thread-list-fallback",
                  engine: "multi",
                  diagnosticCategory: diagnostic.category,
                  recoveryState: "degraded",
                },
                {
                  partialSource: emptyListFallbackSource,
                  fallbackCount: visibleSummaries.length,
                  diagnosticMessage: diagnostic.rawMessage,
                },
              ),
            });
          }
        } else if (degradedPartialSource) {
          if (shouldApplyClaudeSidebarContinuity(degradedPartialSource)) {
            visibleSummaries = mergeDegradedClaudeContinuitySummaries(
              visibleSummaries,
              getLastGoodThreadSummariesForEngineWithoutDeleted("claude"),
              hiddenSharedBindingIds,
            );
          }
          if (shouldApplyCodexSidebarContinuity(degradedPartialSource)) {
            visibleSummaries = mergeDegradedCodexContinuitySummaries(
              visibleSummaries,
              getLastGoodThreadSummariesForEngineWithoutDeleted("codex"),
            );
          }
          lastGoodSnapshotCandidates = visibleSummaries;
          visibleSummaries = markThreadSummariesDegraded(
            visibleSummaries,
            degradedPartialSource,
            "partial-thread-list",
          );
        }
        visibleSummaries = applySessionArchiveState(
          filterRootVisibleAutomaticSummaries(
            filterHiddenAutomaticThreadSummaries(
              filterDeletedSummaries(visibleSummaries),
              hiddenAutomaticSessionIds,
            ),
          ),
          archivedSessionMap,
        );
        if (lastGoodSnapshotCandidates) {
          rememberLastGoodThreadSummariesByEngine(
            workspace.id,
            applySessionArchiveState(
              filterRootVisibleAutomaticSummaries(
                filterHiddenAutomaticThreadSummaries(
                  filterDeletedSummaries(lastGoodSnapshotCandidates),
                  hiddenAutomaticSessionIds,
                ),
              ),
              archivedSessionMap,
            ),
            buildLastGoodSnapshotBlockedEngines(
              projectCatalogValue?.sourceStatuses,
              partialSourcesSeen,
            ),
          );
        }

        // 最终 hide 闸门：任何路径（cache merge / continuity / last-good）
        // 都不得把 Shared-owned native binding 写进侧栏。
        visibleSummaries = stripHiddenSharedBindingSummaries(
          visibleSummaries,
          hiddenSharedBindingIds,
        );
        {
          const abandoned = abandonIfStale();
          if (abandoned) {
            return abandoned;
          }
        }
        // Prefer input over list commit: if user is clicking, wait a few frames.
        await yieldToInteractiveInput({ maxRounds: 32 });
        {
          const abandoned = abandonIfStale();
          if (abandoned) {
            return abandoned;
          }
        }
        const cursorForDisplay = resolveThreadListCursorForDisplay({
          catalogCursor: projectCatalogValue?.nextCursor ?? null,
          catalogPartialSource: projectCatalogValue?.partialSource ?? null,
          runtimeCursor: cursor,
        });
        const previewUpdates: Array<{
          threadId: string;
          text: string;
          timestamp: number;
        }> = [];
        uniqueThreads.forEach((thread) => {
          const threadId = String(thread?.id ?? "");
          const preview = asString(thread?.preview ?? "").trim();
          if (!threadId || !preview) {
            return;
          }
          previewUpdates.push({
            threadId,
            text: preview,
            timestamp: getThreadTimestamp(thread) ?? Date.now(),
          });
        });
        // Background lane: clicks stay urgent.
        startTransition(() => {
          if (!isLatestThreadListRequest()) {
            return;
          }
          dispatch({
            type: "setThreads",
            workspaceId: workspace.id,
            threads: visibleSummaries,
          });
          dispatch({
            type: "setThreadListCursor",
            workspaceId: workspace.id,
            cursor: cursorForDisplay,
          });
          previewUpdates.forEach((entry) => {
            dispatch({
              type: "setLastAgentMessage",
              threadId: entry.threadId,
              text: entry.text,
              timestamp: entry.timestamp,
            });
          });
        });
        appliedThreadListUpdate = true;
        if (hasHealthyThreadSummaries(visibleSummaries)) {
          latestThreadsByWorkspaceRef.current = {
            ...latestThreadsByWorkspaceRef.current,
            [workspace.id]: visibleSummaries,
          };
        }

        const hasAttemptedGeminiRefresh =
          geminiRefreshAttemptedRef.current[workspace.id] === true;
        const shouldRefreshGeminiSessions =
          isLatestThreadListRequest() &&
          !isFirstPaintHydration &&
          (hasGeminiSignal || !!cachedGemini || !hasAttemptedGeminiRefresh);
        if (shouldRefreshGeminiSessions) {
          void (async () => {
            geminiRefreshAttemptedRef.current[workspace.id] = true;
            const geminiResult = await withTimeout(
              listGeminiSessionsService(workspace.path, 50),
              GEMINI_SESSION_FETCH_TIMEOUT_MS,
            );
            if (!isLatestThreadListRequest()) {
              return;
            }
            if (geminiResult === null) {
              onDebug?.({
                id: `${Date.now()}-client-gemini-session-timeout`,
                timestamp: Date.now(),
                source: "client",
                label: "thread/list gemini timeout",
                payload: {
                  workspaceId: workspace.id,
                  timeoutMs: GEMINI_SESSION_FETCH_TIMEOUT_MS,
                },
              });
              return;
            }
            const normalizedGeminiSessions =
              normalizeGeminiSessionSummaries(geminiResult);
            geminiSessionCacheRef.current[workspace.id] = {
              fetchedAt: Date.now(),
              sessions: normalizedGeminiSessions,
            };
            const currentSnapshot =
              latestThreadsByWorkspaceRef.current[workspace.id] ?? [];
            const baselineSummaries =
              currentSnapshot.length > 0 ? currentSnapshot : allSummaries;
            // Gemini Shared 已退役，但仍走同一 hide 契约，避免 stale set 误注入。
            const sharedSessionsForGeminiHide = normalizeSharedSessionSummaries(
              (await withTimeout(
                listSharedSessionsService(workspace.id).catch(() => []),
                NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
              )) ?? [],
            );
            if (!isLatestThreadListRequest()) {
              return;
            }
            // fresh ∪ outer：shared list 失败回空时不得放宽已有 hide 可见性。
            const freshHiddenSharedBindingIds = expandHiddenSharedBindingIds([
              ...sharedSessionsForGeminiHide.flatMap(
                (session) => session.nativeThreadIds,
              ),
              ...hiddenSharedBindingIds,
              ...getCollabWorkerNativeHideIds(),
            ]);
            const nextSummaries = mergeGeminiSessionSummaries(
              baselineSummaries,
              normalizedGeminiSessions.filter(
                (session) =>
                  !freshHiddenSharedBindingIds.has(
                    `gemini:${session.sessionId}`,
                  ),
              ),
              workspace.id,
              mappedTitles,
              getCustomName,
              freshHiddenSharedBindingIds,
            );
            const visibleNextSummaries = applySessionArchiveState(
              stripHiddenSharedBindingSummaries(
                nextSummaries,
                freshHiddenSharedBindingIds,
              ),
              await archivedSessionMapPromise,
            );
            const unchanged =
              visibleNextSummaries.length === baselineSummaries.length &&
              visibleNextSummaries.every((entry, index) => {
                const prev = baselineSummaries[index];
                return (
                  !!prev &&
                  prev.id === entry.id &&
                  prev.name === entry.name &&
                  prev.updatedAt === entry.updatedAt &&
                  prev.engineSource === entry.engineSource &&
                  prev.threadKind === entry.threadKind
                );
              });
            if (!unchanged && isLatestThreadListRequest()) {
              dispatch({
                type: "setThreads",
                workspaceId: workspace.id,
                threads: visibleNextSummaries,
              });
              latestThreadsByWorkspaceRef.current = {
                ...latestThreadsByWorkspaceRef.current,
                [workspace.id]: visibleNextSummaries,
              };
            }
          })();
        }

        const hasAttemptedKimiRefresh =
          kimiRefreshAttemptedRef.current[workspace.id] === true;
        const shouldRefreshKimiSessions =
          isLatestThreadListRequest() &&
          !isFirstPaintHydration &&
          (hasKimiSignal || !!cachedKimi || !hasAttemptedKimiRefresh);
        const hasAttemptedGrokRefresh =
          grokRefreshAttemptedRef.current[workspace.id] === true;
        const shouldRefreshGrokSessions =
          isLatestThreadListRequest() &&
          !isFirstPaintHydration &&
          (hasGrokSignal || !!cachedGrok || !hasAttemptedGrokRefresh);
        if (shouldRefreshGrokSessions) {
          void (async () => {
            grokRefreshAttemptedRef.current[workspace.id] = true;
            const grokResult = await withTimeout(
              listGrokSessionsService(workspace.path, 50),
              GROK_SESSION_FETCH_TIMEOUT_MS,
            );
            if (!isLatestThreadListRequest()) {
              return;
            }
            if (grokResult === null) {
              onDebug?.({
                id: `${Date.now()}-client-grok-session-timeout`,
                timestamp: Date.now(),
                source: "client",
                label: "thread/list grok timeout",
                payload: {
                  workspaceId: workspace.id,
                  timeoutMs: GROK_SESSION_FETCH_TIMEOUT_MS,
                },
              });
              return;
            }
            const normalizedGrokSessions =
              normalizeGrokSessionSummaries(grokResult);
            grokSessionCacheRef.current[workspace.id] = {
              fetchedAt: Date.now(),
              sessions: normalizedGrokSessions,
            };
            const currentSnapshot =
              latestThreadsByWorkspaceRef.current[workspace.id] ?? [];
            const baselineSummaries =
              currentSnapshot.length > 0 ? currentSnapshot : allSummaries;
            // 异步 refresh 时 binding 可能已 materialize；必须重建 hide set，
            // 禁止复用 listThreads 开头的 stale 闭包（创建 Shared 时往往是空集）。
            const sharedSessionsForRemap = normalizeSharedSessionSummaries(
              (await withTimeout(
                listSharedSessionsService(workspace.id).catch(() => []),
                NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
              )) ?? [],
            );
            if (!isLatestThreadListRequest()) {
              return;
            }
            // fresh ∪ outer：shared list 失败回空时不得放宽已有 hide 可见性。
            const freshHiddenSharedBindingIds = expandHiddenSharedBindingIds([
              ...sharedSessionsForRemap.flatMap((session) => session.nativeThreadIds),
              ...hiddenSharedBindingIds,
              ...getCollabWorkerNativeHideIds(),
            ]);
            const nativeOwnerToShared =
              buildNativeOwnerToSharedThreadMap(sharedSessionsForRemap);
            const nextSummaries = mergeGrokSessionSummaries(
              baselineSummaries,
              normalizedGrokSessions.filter(
                (session) =>
                  !freshHiddenSharedBindingIds.has(
                    `grok:${session.sessionId}`,
                  ),
              ),
              workspace.id,
              mappedTitles,
              getCustomName,
              nativeOwnerToShared,
              freshHiddenSharedBindingIds,
            );
            const visibleNextSummaries = applySessionArchiveState(
              stripHiddenSharedBindingSummaries(
                nextSummaries,
                freshHiddenSharedBindingIds,
              ),
              await archivedSessionMapPromise,
            );
            const unchanged =
              visibleNextSummaries.length === baselineSummaries.length &&
              visibleNextSummaries.every((entry, index) => {
                const prev = baselineSummaries[index];
                return (
                  !!prev &&
                  prev.id === entry.id &&
                  prev.name === entry.name &&
                  prev.updatedAt === entry.updatedAt &&
                  prev.engineSource === entry.engineSource &&
                  prev.threadKind === entry.threadKind &&
                  (prev.parentThreadId ?? null) === (entry.parentThreadId ?? null)
                );
              });
            if (!unchanged && isLatestThreadListRequest()) {
              dispatch({
                type: "setThreads",
                workspaceId: workspace.id,
                threads: visibleNextSummaries,
              });
              latestThreadsByWorkspaceRef.current = {
                ...latestThreadsByWorkspaceRef.current,
                [workspace.id]: visibleNextSummaries,
              };
            }
          })();
        }
        if (shouldRefreshKimiSessions) {
          void (async () => {
            kimiRefreshAttemptedRef.current[workspace.id] = true;
            const kimiResult = await withTimeout(
              listKimiSessionsService(workspace.path, 50),
              KIMI_SESSION_FETCH_TIMEOUT_MS,
            );
            if (!isLatestThreadListRequest()) {
              return;
            }
            if (kimiResult === null) {
              onDebug?.({
                id: `${Date.now()}-client-kimi-session-timeout`,
                timestamp: Date.now(),
                source: "client",
                label: "thread/list kimi timeout",
                payload: {
                  workspaceId: workspace.id,
                  timeoutMs: KIMI_SESSION_FETCH_TIMEOUT_MS,
                },
              });
              return;
            }
            const normalizedKimiSessions =
              normalizeKimiSessionSummaries(kimiResult);
            kimiSessionCacheRef.current[workspace.id] = {
              fetchedAt: Date.now(),
              sessions: normalizedKimiSessions,
            };
            const currentSnapshot =
              latestThreadsByWorkspaceRef.current[workspace.id] ?? [];
            const baselineSummaries =
              currentSnapshot.length > 0 ? currentSnapshot : allSummaries;
            // 与 Grok 同构：异步路径用 fresh hide set，避免 pending→established
            // rebind 后仍按 list 开头的空/旧 hide set 注入 native 行。
            const sharedSessionsForKimiHide = normalizeSharedSessionSummaries(
              (await withTimeout(
                listSharedSessionsService(workspace.id).catch(() => []),
                NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
              )) ?? [],
            );
            if (!isLatestThreadListRequest()) {
              return;
            }
            // fresh ∪ outer：shared list 失败回空时不得放宽已有 hide 可见性。
            const freshHiddenSharedBindingIds = expandHiddenSharedBindingIds([
              ...sharedSessionsForKimiHide.flatMap(
                (session) => session.nativeThreadIds,
              ),
              ...hiddenSharedBindingIds,
              ...getCollabWorkerNativeHideIds(),
            ]);
            const nextSummaries = mergeKimiSessionSummaries(
              baselineSummaries,
              normalizedKimiSessions.filter(
                (session) =>
                  !freshHiddenSharedBindingIds.has(
                    `kimi:${session.sessionId}`,
                  ),
              ),
              workspace.id,
              mappedTitles,
              getCustomName,
              freshHiddenSharedBindingIds,
            );
            const visibleNextSummaries = applySessionArchiveState(
              stripHiddenSharedBindingSummaries(
                nextSummaries,
                freshHiddenSharedBindingIds,
              ),
              await archivedSessionMapPromise,
            );
            const unchanged =
              visibleNextSummaries.length === baselineSummaries.length &&
              visibleNextSummaries.every((entry, index) => {
                const prev = baselineSummaries[index];
                return (
                  !!prev &&
                  prev.id === entry.id &&
                  prev.name === entry.name &&
                  prev.updatedAt === entry.updatedAt &&
                  prev.engineSource === entry.engineSource &&
                  prev.threadKind === entry.threadKind
                );
              });
            if (!unchanged && isLatestThreadListRequest()) {
              dispatch({
                type: "setThreads",
                workspaceId: workspace.id,
                threads: visibleNextSummaries,
              });
              latestThreadsByWorkspaceRef.current = {
                ...latestThreadsByWorkspaceRef.current,
                [workspace.id]: visibleNextSummaries,
              };
            }
          })();
        }
      } catch (error) {
        const fallbackThreads = filterRetainableContinuitySummaries(
          getLastGoodThreadSummaries(workspace.id),
        );
        if (isLatestThreadListRequest() && fallbackThreads.length > 0) {
          const fallbackMessage =
            error instanceof Error ? error.message : String(error);
          const archivedSessionMap = await archivedSessionMapPromise.catch(
            () => null,
          );
          const degradedThreads = markThreadSummariesDegraded(
            applySessionArchiveState(fallbackThreads, archivedSessionMap),
            fallbackMessage,
            "last-good-fallback",
          );
          dispatch({
            type: "setThreads",
            workspaceId: workspace.id,
            threads: degradedThreads,
          });
          appliedThreadListUpdate = true;
          const diagnostic = buildPartialHistoryDiagnostic(
            `thread list error fallback: ${fallbackMessage}`,
          );
          onDebug?.({
            id: `${Date.now()}-client-thread-list-error-fallback`,
            timestamp: Date.now(),
            source: "client",
            label: "thread/list error fallback",
            payload: buildThreadDebugCorrelation(
              {
                workspaceId: workspace.id,
                action: "thread-list-error-fallback",
                engine: "multi",
                diagnosticCategory: diagnostic.category,
                recoveryState: "degraded",
              },
              {
                fallbackCount: degradedThreads.length,
                diagnosticMessage: diagnostic.rawMessage,
              },
            ),
          });
        }
        onDebug?.({
          id: `${Date.now()}-client-thread-list-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/list error",
          payload: buildThreadDebugCorrelation(
            {
              workspaceId: workspace.id,
              action: "thread-list-error",
              engine: "multi",
              recoveryState: "recovering",
            },
            {
              error: error instanceof Error ? error.message : String(error),
            },
          ),
        });
      } finally {
        // Clear loading if this request still owns the seq (even when isStale
        // made isLatestThreadListRequest false — cancelled hydrate must not
        // leave the spinner stuck).
        const ownsRequest =
          threadListRequestSeqRef.current[workspace.id] === requestSeq;
        if (!preserveState && ownsRequest) {
          dispatch({
            type: "setThreadListLoading",
            workspaceId: workspace.id,
            isLoading: false,
          });
        }
      }
      return { applied: appliedThreadListUpdate };
    },
    [
      beginAutomaticRuntimeRecovery,
      canListWorkspaceSessions,
      dispatch,
      getCustomName,
      getAutomaticRuntimeRecoveryPartialSource,
      getLastGoodThreadSummaries,
      getLastGoodThreadSummariesForEngine,
      loadActiveProjectCatalogSessions,
      loadArchivedSessionMap,
      loadedThreadsRef,
      onDebug,
      onThreadTitleMappingsLoaded,
      rememberLastGoodThreadSummariesByEngine,
      removeThreadFromCachedSummaries,
      sessionAttributionMode,
      activeThreadIdByWorkspace,
      threadActivityRef,
      threadsByWorkspace,
    ],
  );

  const loadOlderThreadsForWorkspace = useLoadOlderThreadsForWorkspace({
    activeThreadIdByWorkspace,
    applySessionArchiveState,
    canListWorkspaceSessions,
    dispatch,
    getCustomName,
    latestThreadsByWorkspaceRef,
    listWorkspaceSessionsService,
    loadArchivedSessionMap,
    onDebug,
    onThreadTitleMappingsLoaded,
    sessionAttributionMode,
    threadListCursorByWorkspace,
    threadsByWorkspace,
    workspacePathsByIdRef,
  });

  const archiveThread = useMemo(
    () => createArchiveThreadAction({ onDebug }),
    [onDebug],
  );

  const archiveClaudeThread = useMemo(
    () => createArchiveClaudeThreadAction({ onDebug, workspacePathsByIdRef }),
    [onDebug, workspacePathsByIdRef],
  );

  const deleteThreadForWorkspace = useMemo(() => {
    const deleteThread = createDeleteThreadForWorkspaceAction({
      archiveClaudeThread,
      threadsByWorkspace,
      workspacePathsByIdRef,
    });
    return async (workspaceId: string, threadId: string) => {
      await deleteThread(workspaceId, threadId);
      removeThreadFromCachedSummaries(workspaceId, threadId);
    };
  }, [
    archiveClaudeThread,
    removeThreadFromCachedSummaries,
    threadsByWorkspace,
    workspacePathsByIdRef,
  ]);

  return {
    startThreadForWorkspace,
    finalizeCodexPendingThread,
    startSharedSessionForWorkspace,
    forkThreadForWorkspace,
    forkSessionFromMessageForWorkspace,
    forkClaudeSessionFromMessageForWorkspace,
    resumeThreadForWorkspace,
    refreshThread,
    resetWorkspaceThreads,
    listThreadsForWorkspace,
    loadOlderThreadsForWorkspace,
    archiveThread,
    archiveClaudeThread,
    deleteThreadForWorkspace,
    renameThreadTitleMapping,
    setThreadHistoryLoading,
    setThreadHistoryLoadingProgress,
    historyLoadingByThreadId,
    historyLoadingProgressByThreadId,
  };
}
