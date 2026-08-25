import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react";
import { useComposerInsert } from "../features/app/hooks/useComposerInsert";
import { loadHistoryWithImportance } from "../features/composer/hooks/useInputHistoryStore";
import type { HistoryItem } from "../features/composer/hooks/useInputHistoryStore";
import type { KanbanTask } from "../features/kanban/types";
import {
  readProjectMapRelationships,
  scanProjectMapRelationships,
} from "../features/project-map/services/projectMapPersistence";
import { normalizeProjectMapRelationshipDashboardData } from "../features/project-map/utils/relationshipDashboardModel";
import { useUnifiedSearch } from "../features/search/hooks/useUnifiedSearch";
import type {
  SearchContentFilter,
  SearchApiHydrationStatus,
  SearchFileHydrationStatus,
  SearchScope,
  WorkspaceSearchApiSnapshot,
  WorkspaceSearchFileSnapshot,
} from "../features/search/types";
// DISABLED: disable-session-activity-and-solo-mode — empty stub only (radar stays live)
import { DISABLED_WORKSPACE_SESSION_ACTIVITY } from "../features/session-activity/adapters/buildWorkspaceSessionActivity";
import { useSessionRadarFeed } from "../features/session-activity/hooks/useSessionRadarFeed";
import { isBackgroundRenderGatingEnabled } from "@/conversation-presentation/realtimePerfFlags";
import {
  RADAR_STORE_NAME,
  SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY,
  SESSION_RADAR_RECENT_STORAGE_KEY,
  buildRadarCompletionId,
  dispatchSessionRadarHistoryUpdatedEvent,
  mergePersistedRadarRecentEntries,
  parsePersistedRadarRecentEntry,
  type PersistedRadarRecentEntry,
  resolveLatestUserMessage,
} from "../features/session-activity/utils/sessionRadarPersistence";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../services/clientStorage";
import { sendSystemNotification } from "../services/systemNotification";
import { getWorkspaceFiles } from "../services/tauri";
import type {
  AppSettings,
  ConversationItem,
  CustomCommandOption,
  SkillOption,
  ThreadSummary,
  WorkspaceInfo,
} from "../types";
import { useWorkspaceThreadListHydration } from "./useWorkspaceThreadListHydration";
import { resolveWorkspaceProjectionOwnerIds } from "./workspaceThreadListLoadGuard";
import {
  LOCK_LIVE_SESSION_LIMIT,
  isJankDebugEnabled,
  resolveLockLivePreview,
} from "./utils";

const INVISIBLE_SEARCH_QUERY_CHARS_REGEX = /[\u200B-\u200D\uFEFF]/g;
const RECENT_THREAD_LIMIT = 8;

type FilePanelMode =
  | "git"
  | "files"
  | "search"
  | "notes"
  | "prompts"
  | "memory"
  | "activity"
  | "radar";

type Translator = (key: string) => string;

type ThreadStatusSnapshot = {
  isProcessing?: boolean;
  isReviewing?: boolean;
  lastDurationMs?: number | null;
};

type LastAgentMessageSnapshot = {
  text: string;
  timestamp: number;
};

type CompletionTrackerSnapshot = {
  isProcessing: boolean;
  lastDurationMs: number | null;
  lastAgentTimestamp: number;
};

type ListThreadsForWorkspace = (
  workspace: WorkspaceInfo,
  options?: {
    preserveState?: boolean;
    includeOpenCodeSessions?: boolean;
    deletedThreadIds?: string[];
  },
) => Promise<void | { applied?: boolean; stale?: boolean }>;

type UseAppShellSearchRadarSectionOptions = {
  activeItems: ConversationItem[];
  activeThreadId: string | null;
  activeWorkspace: WorkspaceInfo | null;
  activeWorkspaceId: string | null;
  appSettings: AppSettings;
  commands: CustomCommandOption[];
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  completionTrackerBySessionRef: MutableRefObject<
    Record<string, CompletionTrackerSnapshot>
  >;
  completionTrackerReadyRef: MutableRefObject<boolean>;
  directories: string[];
  filePanelMode: FilePanelMode;
  fileTreeSourceVersion?: string | null;
  files: string[];
  getActiveDraft: () => string;
  globalSearchFilesByWorkspace: Record<string, WorkspaceSearchFileSnapshot>;
  handleDraftChange: (next: string) => void;
  isCompact: boolean;
  isFilesLoading: boolean;
  isProcessing: boolean;
  isSearchPaletteOpen: boolean;
  kanbanTasks: KanbanTask[];
  lastAgentMessageByThread: Record<
    string,
    LastAgentMessageSnapshot | undefined
  >;
  listThreadsForWorkspace: ListThreadsForWorkspace;
  rightPanelCollapsed: boolean;
  searchContentFilters: SearchContentFilter[];
  searchPaletteQuery: string;
  searchScope: SearchScope;
  setGlobalSearchFilesByWorkspace: Dispatch<
    SetStateAction<Record<string, WorkspaceSearchFileSnapshot>>
  >;
  skills: SkillOption[];
  t: Translator;
  threadItemsByThread: Record<string, ConversationItem[]>;
  threadListLoadingByWorkspace: Record<string, boolean>;
  threadParentById: Record<string, string>;
  threadStatusById: Record<string, ThreadStatusSnapshot | undefined>;
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  workspaces: WorkspaceInfo[];
  workspacesById: Map<string, WorkspaceInfo>;
};

export function useAppShellSearchRadarSection({
  activeItems,
  activeThreadId,
  activeWorkspace,
  activeWorkspaceId,
  appSettings,
  commands,
  composerInputRef,
  completionTrackerBySessionRef,
  completionTrackerReadyRef,
  directories,
  filePanelMode,
  fileTreeSourceVersion = null,
  files,
  getActiveDraft,
  globalSearchFilesByWorkspace,
  handleDraftChange,
  isCompact,
  isFilesLoading,
  isProcessing,
  isSearchPaletteOpen,
  kanbanTasks,
  lastAgentMessageByThread,
  listThreadsForWorkspace,
  rightPanelCollapsed,
  searchContentFilters,
  searchPaletteQuery,
  searchScope,
  setGlobalSearchFilesByWorkspace,
  skills,
  t,
  threadItemsByThread,
  threadListLoadingByWorkspace,
  threadParentById: _threadParentById,
  threadStatusById,
  threadsByWorkspace,
  workspaces,
  workspacesById,
}: UseAppShellSearchRadarSectionOptions) {
  const handleInsertComposerText = useComposerInsert({
    activeThreadId,
    getDraftText: getActiveDraft,
    onDraftChange: handleDraftChange,
    textareaRef: composerInputRef,
  });

  const perfSnapshotRef = useRef({
    activeThreadId: null as string | null,
    isProcessing: false,
    activeItems: 0,
    filesLoading: false,
    files: 0,
    directories: 0,
    filePanelMode: "git" as FilePanelMode,
    rightPanelCollapsed: false,
    isCompact: false,
    draftLength: 0,
  });

  useEffect(() => {
    perfSnapshotRef.current = {
      activeThreadId,
      isProcessing,
      activeItems: activeItems.length,
      filesLoading: isFilesLoading,
      files: files.length,
      directories: directories.length,
      filePanelMode,
      rightPanelCollapsed,
      isCompact,
      draftLength: getActiveDraft().length,
    };
  }, [
    getActiveDraft,
    activeItems.length,
    activeThreadId,
    directories.length,
    filePanelMode,
    files.length,
    isCompact,
    isFilesLoading,
    isProcessing,
    rightPanelCollapsed,
  ]);

  useEffect(() => {
    if (
      !import.meta.env.DEV ||
      !isJankDebugEnabled() ||
      typeof window === "undefined"
    ) {
      return;
    }
    let rafId = 0;
    let lastFrameAt = performance.now();
    const monitor = (timestamp: number) => {
      const delta = timestamp - lastFrameAt;
      if (delta >= 120) {
        const snapshot = perfSnapshotRef.current;
        console.warn("[perf][jank]", {
          frameGapMs: Number(delta.toFixed(2)),
          ...snapshot,
        });
      }
      lastFrameAt = timestamp;
      rafId = window.requestAnimationFrame(monitor);
    };
    rafId = window.requestAnimationFrame(monitor);
    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  const activePath = activeWorkspace?.path ?? null;
  const globalSearchFilesByWorkspaceRef = useRef(globalSearchFilesByWorkspace);
  globalSearchFilesByWorkspaceRef.current = globalSearchFilesByWorkspace;
  const attemptedSearchFileHydrationWorkspaceIdsRef = useRef(new Set<string>());
  const [apiSnapshotsByWorkspace, setApiSnapshotsByWorkspace] = useState<
    Record<string, WorkspaceSearchApiSnapshot>
  >({});
  const apiSnapshotsByWorkspaceRef = useRef(apiSnapshotsByWorkspace);
  apiSnapshotsByWorkspaceRef.current = apiSnapshotsByWorkspace;
  const apiHydrationInFlightByWorkspaceRef = useRef(
    new Map<string, Promise<import("../features/project-map/types").ProjectMapApiEndpoint[]>>(),
  );
  const backgroundRenderGatingEnabled = isBackgroundRenderGatingEnabled();
  const deferredThreadItemsByThreadValue =
    useDeferredValue(threadItemsByThread);
  const deferredThreadItemsByThread = backgroundRenderGatingEnabled
    ? deferredThreadItemsByThreadValue
    : threadItemsByThread;
  const activeWorkspaceKanbanTasks = useMemo(
    () =>
      activePath
        ? kanbanTasks.filter((task) => task.workspaceId === activePath)
        : [],
    [activePath, kanbanTasks],
  );

  const activeWorkspaceProjectionOwnerIds = useMemo(
    () => resolveWorkspaceProjectionOwnerIds(workspaces, activeWorkspaceId),
    [activeWorkspaceId, workspaces],
  );

  const {
    ensureWorkspaceThreadListLoaded,
    hydratedThreadListWorkspaceIds,
    hydratedThreadListWorkspaceIdsRef,
    listThreadsForWorkspaceTracked,
    prewarmSessionRadarForWorkspace,
  } = useWorkspaceThreadListHydration({
    activeWorkspaceId,
    activeWorkspaceProjectionOwnerIds,
    listThreadsForWorkspace,
    threadListLoadingByWorkspace,
    workspaces,
    workspacesById,
  });

  useEffect(() => {
    if (!activeWorkspaceId || filePanelMode !== "radar") {
      return;
    }
    prewarmSessionRadarForWorkspace(activeWorkspaceId);
  }, [activeWorkspaceId, filePanelMode, prewarmSessionRadarForWorkspace]);

  const handleEnsureWorkspaceThreadsForSettings = useCallback(
    (workspaceId: string, options?: { deletedThreadIds?: string[] }) => {
      ensureWorkspaceThreadListLoaded(workspaceId, {
        preserveState: false,
        force: true,
        deletedThreadIds: options?.deletedThreadIds,
      });
    },
    [ensureWorkspaceThreadListLoaded],
  );

  const activeWorkspaceThreads = useMemo(
    () =>
      activeWorkspaceProjectionOwnerIds.flatMap(
        (workspaceId) => threadsByWorkspace[workspaceId] ?? [],
      ),
    [activeWorkspaceProjectionOwnerIds, threadsByWorkspace],
  );

  // DISABLED: disable-session-activity-and-solo-mode — no activity derivation
  const workspaceActivity = DISABLED_WORKSPACE_SESSION_ACTIVITY;

  const recentThreads = useMemo(() => {
    if (!activeWorkspaceId || activeWorkspaceProjectionOwnerIds.length === 0) {
      return [];
    }
    const threads = activeWorkspaceProjectionOwnerIds.flatMap((workspaceId) =>
      (threadsByWorkspace[workspaceId] ?? []).map((thread) => ({
        thread,
        ownerWorkspaceId: workspaceId,
      })),
    );
    if (threads.length === 0) {
      return [];
    }
    return [...threads]
      .sort((left, right) => right.thread.updatedAt - left.thread.updatedAt)
      .slice(0, RECENT_THREAD_LIMIT)
      .map(({ thread, ownerWorkspaceId }) => {
        const status = threadStatusById[thread.id];
        return {
          id: thread.id,
          workspaceId: ownerWorkspaceId,
          threadId: thread.id,
          title: thread.name?.trim() || t("threads.untitledThread"),
          updatedAt: thread.updatedAt,
          isProcessing: status?.isProcessing ?? false,
          isReviewing: status?.isReviewing ?? false,
        };
      });
  }, [
    activeWorkspaceId,
    activeWorkspaceProjectionOwnerIds,
    threadStatusById,
    threadsByWorkspace,
    t,
  ]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }
    setGlobalSearchFilesByWorkspace((prev) => {
      const previousSnapshot = prev[activeWorkspaceId];
      if (
        previousSnapshot?.status === "loading" ||
        previousSnapshot?.status === "complete" ||
        previousSnapshot?.status === "partial" ||
        previousSnapshot?.status === "error"
      ) {
        return prev;
      }
      if (
        previousSnapshot?.status === "shallow" &&
        previousSnapshot.files === files &&
        previousSnapshot.sourceVersion === fileTreeSourceVersion
      ) {
        return prev;
      }
      return {
        ...prev,
        [activeWorkspaceId]: {
          files,
          status: "shallow",
          sourceVersion: fileTreeSourceVersion,
          error: null,
        },
      };
    });
  }, [
    activeWorkspaceId,
    files,
    fileTreeSourceVersion,
    setGlobalSearchFilesByWorkspace,
  ]);

  useEffect(() => {
    if (!isSearchPaletteOpen) {
      attemptedSearchFileHydrationWorkspaceIdsRef.current.clear();
      return;
    }
    const includesFiles =
      searchContentFilters.includes("all") ||
      searchContentFilters.includes("files");
    if (!includesFiles) {
      return;
    }
    const targetWorkspaceIds =
      searchScope === "global"
        ? workspaces.map((workspace) => workspace.id)
        : activeWorkspaceId
          ? [activeWorkspaceId]
          : [];
    const workspaceIdsToHydrate = targetWorkspaceIds.filter((workspaceId) => {
      const status =
        globalSearchFilesByWorkspaceRef.current[workspaceId]?.status;
      return (
        !attemptedSearchFileHydrationWorkspaceIdsRef.current.has(workspaceId) &&
        status !== "loading" &&
        status !== "complete" &&
        status !== "partial"
      );
    });
    if (workspaceIdsToHydrate.length === 0) {
      return;
    }
    const prioritizedWorkspaceIds = activeWorkspaceId && workspaceIdsToHydrate.includes(activeWorkspaceId)
      ? [
          activeWorkspaceId,
          ...workspaceIdsToHydrate.filter((workspaceId) => workspaceId !== activeWorkspaceId),
        ]
      : workspaceIdsToHydrate;
    let cancelled = false;
    for (const workspaceId of prioritizedWorkspaceIds) {
      attemptedSearchFileHydrationWorkspaceIdsRef.current.add(workspaceId);
    }
    setGlobalSearchFilesByWorkspace((prev) => {
      const next = { ...prev };
      for (const workspaceId of prioritizedWorkspaceIds) {
        const previousSnapshot = next[workspaceId];
        next[workspaceId] = {
          files: previousSnapshot?.files ?? [],
          status: "loading",
          sourceVersion: previousSnapshot?.sourceVersion ?? null,
          error: null,
        };
      }
      return next;
    });
    const hydrateWorkspaceFiles = async () => {
      const queue = [...prioritizedWorkspaceIds];
      const hydrateNext = async (): Promise<void> => {
        const workspaceId = queue.shift();
        if (!workspaceId || cancelled) {
          return;
        }
        try {
          const response = await getWorkspaceFiles(workspaceId);
          if (cancelled) {
            return;
          }
          setGlobalSearchFilesByWorkspace((prev) => ({
            ...prev,
            [workspaceId]: {
              files: Array.isArray(response.files) ? response.files : [],
              status:
                response.scan_state === "partial" || response.limit_hit
                  ? "partial"
                  : "complete",
              sourceVersion:
                response.sourceVersion ??
                response.listingBudget?.sourceVersion ??
                null,
              error: null,
            },
          }));
        } catch (error) {
          if (cancelled) {
            return;
          }
          setGlobalSearchFilesByWorkspace((prev) => ({
            ...prev,
            [workspaceId]: {
              files: prev[workspaceId]?.files ?? [],
              status: "error",
              sourceVersion: prev[workspaceId]?.sourceVersion ?? null,
              error: error instanceof Error ? error.message : String(error),
            },
          }));
        }
        await hydrateNext();
      };
      await Promise.all(
        Array.from({ length: Math.min(2, queue.length) }, () => hydrateNext()),
      );
    };
    void hydrateWorkspaceFiles();

    return () => {
      cancelled = true;
    };
  }, [
    activeWorkspaceId,
    isSearchPaletteOpen,
    searchContentFilters,
    searchScope,
    setGlobalSearchFilesByWorkspace,
    workspaces,
  ]);

  useEffect(() => {
    if (!isSearchPaletteOpen) return;
    const includesApis =
      searchContentFilters.includes("all") ||
      searchContentFilters.includes("apis");
    if (!includesApis) return;
    const targetWorkspaceIds =
      searchScope === "global"
        ? workspaces.map((workspace) => workspace.id)
        : activeWorkspaceId
          ? [activeWorkspaceId]
          : [];
    const workspaceIdsToHydrate = targetWorkspaceIds.filter(
      (workspaceId) =>
        apiSnapshotsByWorkspaceRef.current[workspaceId]?.status !== "complete",
    );
    const queue =
      activeWorkspaceId && workspaceIdsToHydrate.includes(activeWorkspaceId)
        ? [
            activeWorkspaceId,
            ...workspaceIdsToHydrate.filter(
              (workspaceId) => workspaceId !== activeWorkspaceId,
            ),
          ]
        : workspaceIdsToHydrate;
    if (queue.length > 0) {
      setApiSnapshotsByWorkspace((current) => {
        const next = { ...current };
        for (const workspaceId of queue) {
          next[workspaceId] = {
            endpoints: current[workspaceId]?.endpoints ?? [],
            status: "loading",
            error: null,
          };
        }
        return next;
      });
    }
    let cancelled = false;
    const refreshEndpoints = (workspaceId: string) => {
      const inFlight =
        apiHydrationInFlightByWorkspaceRef.current.get(workspaceId);
      if (inFlight) return inFlight;
      const request = (async () => {
        await scanProjectMapRelationships({ workspaceId });
        const refreshed = await readProjectMapRelationships({ workspaceId });
        return (
          normalizeProjectMapRelationshipDashboardData(refreshed)
            .apiContracts?.endpoints ?? []
        );
      })();
      apiHydrationInFlightByWorkspaceRef.current.set(workspaceId, request);
      const clearCompletedRequest = () => {
        if (
          apiHydrationInFlightByWorkspaceRef.current.get(workspaceId) ===
          request
        ) {
          apiHydrationInFlightByWorkspaceRef.current.delete(workspaceId);
        }
      };
      void request.then(clearCompletedRequest, clearCompletedRequest);
      return request;
    };
    const hydrate = async (workspaceId: string) => {
      try {
        const response = await readProjectMapRelationships({ workspaceId });
        const dashboard =
          normalizeProjectMapRelationshipDashboardData(response);
        const graph = dashboard.apiContracts;
        if (graph && dashboard.staleSummary?.isFresh === false && !cancelled) {
          setApiSnapshotsByWorkspace((current) => ({
            ...current,
            [workspaceId]: {
              endpoints: graph?.endpoints ?? [],
              status: "refreshing",
              error: null,
            },
          }));
        }
        if (!graph || dashboard.staleSummary?.isFresh === false) {
          const endpoints = await refreshEndpoints(workspaceId);
          if (!cancelled) {
            setApiSnapshotsByWorkspace((current) => ({
              ...current,
              [workspaceId]: {
                endpoints,
                status: "complete",
                error: null,
              },
            }));
          }
          return;
        }
        if (!cancelled) {
          setApiSnapshotsByWorkspace((current) => ({
            ...current,
            [workspaceId]: {
              endpoints: graph?.endpoints ?? [],
              status: "complete",
              error: null,
            },
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setApiSnapshotsByWorkspace((current) => ({
            ...current,
            [workspaceId]: {
              endpoints: current[workspaceId]?.endpoints ?? [],
              status: "error",
              error: error instanceof Error ? error.message : String(error),
            },
          }));
        }
      }
    };
    void (async () => {
      while (!cancelled && queue.length > 0) {
        const workspaceId = queue.shift();
        if (workspaceId) await hydrate(workspaceId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeWorkspaceId,
    isSearchPaletteOpen,
    searchContentFilters,
    searchScope,
    workspaces,
  ]);

  const apiSearchSources = useMemo(
    () =>
      (searchScope === "global"
        ? workspaces
        : activeWorkspace
          ? [activeWorkspace]
          : []
      ).map((workspace) => ({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        endpoints: apiSnapshotsByWorkspace[workspace.id]?.endpoints ?? [],
      })),
    [activeWorkspace, apiSnapshotsByWorkspace, searchScope, workspaces],
  );

  const workspaceSearchSources = useMemo(() => {
    if (searchScope === "global") {
      return workspaces.map((workspace) => ({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        files: globalSearchFilesByWorkspace[workspace.id]?.files ?? [],
        sourceVersion:
          globalSearchFilesByWorkspace[workspace.id]?.sourceVersion ?? null,
        threads: threadsByWorkspace[workspace.id] ?? [],
      }));
    }
    if (!activeWorkspaceId || !activeWorkspace) {
      return [];
    }
    const activeSearchSnapshot =
      globalSearchFilesByWorkspace[activeWorkspaceId];
    return [
      {
        workspaceId: activeWorkspaceId,
        workspaceName: activeWorkspace.name,
        files: activeSearchSnapshot?.files ?? files,
        sourceVersion:
          activeSearchSnapshot?.sourceVersion ?? fileTreeSourceVersion,
        threads: activeWorkspaceThreads,
      },
    ];
  }, [
    activeWorkspace,
    activeWorkspaceId,
    activeWorkspaceThreads,
    files,
    fileTreeSourceVersion,
    globalSearchFilesByWorkspace,
    searchScope,
    threadsByWorkspace,
    workspaces,
  ]);
  const searchFileHydrationStatus = useMemo<SearchFileHydrationStatus>(() => {
    const includesFiles =
      searchContentFilters.includes("all") ||
      searchContentFilters.includes("files");
    if (!isSearchPaletteOpen || !includesFiles) {
      return "idle";
    }
    const targetWorkspaceIds =
      searchScope === "global"
        ? workspaces.map((workspace) => workspace.id)
        : activeWorkspaceId
          ? [activeWorkspaceId]
          : [];
    if (targetWorkspaceIds.length === 0) {
      return "idle";
    }
    const statuses = targetWorkspaceIds.map(
      (workspaceId) => globalSearchFilesByWorkspace[workspaceId]?.status,
    );
    if (
      statuses.some(
        (status) => !status || status === "shallow" || status === "loading",
      )
    ) {
      return "loading";
    }
    if (statuses.some((status) => status === "error")) {
      return "error";
    }
    if (statuses.some((status) => status === "partial")) {
      return "partial";
    }
    return "complete";
  }, [
    activeWorkspaceId,
    globalSearchFilesByWorkspace,
    isSearchPaletteOpen,
    searchContentFilters,
    searchScope,
    workspaces,
  ]);
  const searchApiHydrationStatus = useMemo<SearchApiHydrationStatus>(() => {
    const includesApis =
      searchContentFilters.includes("all") ||
      searchContentFilters.includes("apis");
    if (!isSearchPaletteOpen || !includesApis) return "idle";
    const targetWorkspaceIds =
      searchScope === "global"
        ? workspaces.map((workspace) => workspace.id)
        : activeWorkspaceId
          ? [activeWorkspaceId]
          : [];
    if (targetWorkspaceIds.length === 0) return "idle";
    const statuses = targetWorkspaceIds.map(
      (workspaceId) => apiSnapshotsByWorkspace[workspaceId]?.status,
    );
    const hasSearchableEndpoints = targetWorkspaceIds.some(
      (workspaceId) =>
        (apiSnapshotsByWorkspace[workspaceId]?.endpoints.length ?? 0) > 0,
    );
    if (statuses.some((status) => !status || status === "loading")) {
      return hasSearchableEndpoints ? "refreshing" : "loading";
    }
    if (statuses.some((status) => status === "refreshing")) return "refreshing";
    if (statuses.some((status) => status === "error")) return "error";
    return "complete";
  }, [
    activeWorkspaceId,
    apiSnapshotsByWorkspace,
    isSearchPaletteOpen,
    searchContentFilters,
    searchScope,
    workspaces,
  ]);

  const scopedKanbanTasks = useMemo(
    () => (searchScope === "global" ? kanbanTasks : activeWorkspaceKanbanTasks),
    [activeWorkspaceKanbanTasks, kanbanTasks, searchScope],
  );
  const historySearchItems = useMemo<HistoryItem[]>(
    () => (isSearchPaletteOpen ? loadHistoryWithImportance() : []),
    [isSearchPaletteOpen],
  );
  const workspaceNameByPath = useMemo(
    () =>
      new Map(workspaces.map((workspace) => [workspace.path, workspace.name])),
    [workspaces],
  );
  const rawSearchResults = useUnifiedSearch({
    query: searchPaletteQuery,
    contentFilters: searchContentFilters,
    workspaceSources: workspaceSearchSources,
    kanbanTasks: scopedKanbanTasks,
    threadItemsByThread: isSearchPaletteOpen ? deferredThreadItemsByThread : {},
    historyItems: historySearchItems,
    skills,
    commands,
    apiSources: apiSearchSources,
    activeWorkspaceId,
    workspaceNameByPath,
  });
  const normalizedSearchPaletteQuery = searchPaletteQuery
    .replace(INVISIBLE_SEARCH_QUERY_CHARS_REGEX, "")
    .trim();
  const searchResults = useMemo(
    () => (normalizedSearchPaletteQuery ? rawSearchResults : []),
    [normalizedSearchPaletteQuery, rawSearchResults],
  );

  const sessionRadarFeed = useSessionRadarFeed({
    workspaces,
    threadsByWorkspace,
    threadStatusById,
    threadItemsByThread: deferredThreadItemsByThread,
    lastAgentMessageByThread,
    runningLimit: LOCK_LIVE_SESSION_LIMIT,
  });
  const lockLiveSessions = sessionRadarFeed.runningSessions;

  // 完成态 preview 只在检测到「完成」的那一刻才需要 items；通过 ref 读取
  // 最新快照，避免把 deferredThreadItemsByThread（流式期间高频换引用）放进
  // completion tracker effect 的依赖里触发 W×T 全量扫描。
  const completionPreviewItemsRef = useRef(deferredThreadItemsByThread);
  completionPreviewItemsRef.current = deferredThreadItemsByThread;

  useEffect(() => {
    const previous = completionTrackerBySessionRef.current;
    const next: Record<string, CompletionTrackerSnapshot> = {};
    const completed: PersistedRadarRecentEntry[] = [];

    for (const workspace of workspaces) {
      const threads = threadsByWorkspace[workspace.id] ?? [];
      for (const thread of threads) {
        const key = `${workspace.id}:${thread.id}`;
        const status = threadStatusById[thread.id];
        const isProcessingNow = status?.isProcessing ?? false;
        const lastDurationMs = status?.lastDurationMs ?? null;
        const lastAgentTimestamp =
          lastAgentMessageByThread[thread.id]?.timestamp ?? 0;
        const previousTracker = previous[key];
        const wasProcessing = previousTracker?.isProcessing ?? false;
        const previousDurationMs = previousTracker?.lastDurationMs ?? null;
        const previousAgentTimestamp = previousTracker?.lastAgentTimestamp ?? 0;
        const finishedByDuration =
          !isProcessingNow &&
          lastDurationMs !== null &&
          lastDurationMs !== previousDurationMs;
        const finishedByAgentUpdate =
          !isProcessingNow &&
          lastAgentTimestamp > previousAgentTimestamp &&
          (wasProcessing || previousDurationMs !== null);

        if (
          (wasProcessing && !isProcessingNow) ||
          finishedByDuration ||
          finishedByAgentUpdate
        ) {
          const lastAgent = lastAgentMessageByThread[thread.id];
          const completedAt = Math.max(
            thread.updatedAt ?? 0,
            lastAgent?.timestamp ?? 0,
            Date.now(),
          );
          const durationMs =
            typeof lastDurationMs === "number"
              ? Math.max(0, lastDurationMs)
              : null;
          const startedAt =
            durationMs != null
              ? Math.max(0, completedAt - durationMs)
              : previousTracker?.isProcessing && previousTracker?.lastDurationMs
                ? Math.max(0, completedAt - previousTracker.lastDurationMs)
                : null;
          const latestUserMessage = resolveLatestUserMessage(
            completionPreviewItemsRef.current[thread.id],
          );
          completed.push({
            id: buildRadarCompletionId(workspace.id, thread.id),
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            threadId: thread.id,
            threadName: thread.name?.trim() || t("threads.untitledThread"),
            engine: (thread.engineSource || "codex").toUpperCase(),
            preview:
              latestUserMessage ||
              resolveLockLivePreview(
                completionPreviewItemsRef.current[thread.id],
                lastAgent?.text,
              ) ||
              thread.name?.trim() ||
              t("threads.untitledThread"),
            updatedAt: completedAt,
            startedAt,
            completedAt,
            durationMs,
          });
        }

        next[key] = {
          isProcessing: isProcessingNow,
          lastDurationMs,
          lastAgentTimestamp,
        };
      }
    }

    if (!completionTrackerReadyRef.current) {
      completionTrackerReadyRef.current = true;
      completionTrackerBySessionRef.current = next;
      return;
    }

    completionTrackerBySessionRef.current = next;
    if (completed.length === 0) {
      return;
    }

    const rawPersistedRecent = getClientStoreSync(
      RADAR_STORE_NAME,
      SESSION_RADAR_RECENT_STORAGE_KEY,
    );
    // dismissed 联动清理只覆盖「曾物理存在于 persisted 快照」的 id：新合成的完成
    // 条目若被 bounds 淘汰，不得连带销毁用户删除留下的 cutoff（防复活循环）。
    const physicallyPersistedEntryIds = new Set(
      (Array.isArray(rawPersistedRecent) ? rawPersistedRecent : [])
        .map(parsePersistedRadarRecentEntry)
        .filter((entry): entry is PersistedRadarRecentEntry => Boolean(entry))
        .map((entry) => entry.id),
    );
    const { entries: nextPersistedRecent, prunedEntryIds } =
      mergePersistedRadarRecentEntries(rawPersistedRecent, completed);
    const physicallyPrunedEntryIds = prunedEntryIds.filter((entryId) =>
      physicallyPersistedEntryIds.has(entryId),
    );
    writeClientStoreValue(
      RADAR_STORE_NAME,
      SESSION_RADAR_RECENT_STORAGE_KEY,
      nextPersistedRecent,
      { immediate: true },
    );
    // merge 惰性修剪物理移除的条目，其 dismissed 记录一并清除；用户主动删除的
    // 条目不经 bounds 修剪，cutoff 保留以防完成记录复活。
    if (physicallyPrunedEntryIds.length > 0) {
      const prunedIdSet = new Set(physicallyPrunedEntryIds);
      const existingDismissed =
        getClientStoreSync<Record<string, number>>(
          RADAR_STORE_NAME,
          SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY,
        ) ?? {};
      const nextDismissed = Object.fromEntries(
        Object.entries(existingDismissed).filter(
          ([entryId]) => !prunedIdSet.has(entryId),
        ),
      );
      if (
        Object.keys(nextDismissed).length !== Object.keys(existingDismissed).length
      ) {
        writeClientStoreValue(
          RADAR_STORE_NAME,
          SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY,
          nextDismissed,
          { immediate: true },
        );
      }
    }
    dispatchSessionRadarHistoryUpdatedEvent();

    if (appSettings.systemNotificationEnabled) {
      for (const entry of completed) {
        void sendSystemNotification({
          title: t("threadCompletion.title"),
          body: `${t("threadCompletion.project")}: ${entry.workspaceName}\n${t("threadCompletion.session")}: ${entry.threadName}`,
          extra: {
            workspaceId: entry.workspaceId,
            threadId: entry.threadId,
          },
        });
      }
    }
  }, [
    appSettings.systemNotificationEnabled,
    completionTrackerBySessionRef,
    completionTrackerReadyRef,
    lastAgentMessageByThread,
    t,
    threadStatusById,
    threadsByWorkspace,
    workspaces,
  ]);

  return {
    activePath,
    activeWorkspaceKanbanTasks,
    activeWorkspaceThreads,
    ensureWorkspaceThreadListLoaded,
    handleEnsureWorkspaceThreadsForSettings,
    handleInsertComposerText,
    historySearchItems,
    hydratedThreadListWorkspaceIds,
    hydratedThreadListWorkspaceIdsRef,
    listThreadsForWorkspaceTracked,
    lockLiveSessions,
    perfSnapshotRef,
    RECENT_THREAD_LIMIT,
    recentThreads,
    scopedKanbanTasks,
    searchApiHydrationStatus,
    searchFileHydrationStatus,
    searchResults,
    sessionRadarFeed,
    workspaceActivity,
    workspaceNameByPath,
    workspaceSearchSources,
  };
}
