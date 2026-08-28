import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRenderScheduler } from "../hooks/useRenderScheduler";
import type { MutableRefObject } from "react";
import type { WorkspaceInfo } from "../types";
import {
  startupOrchestrator,
  type StartupTaskDescriptor,
} from "../features/startup-orchestration/utils/startupOrchestrator";
import {
  getStartupTraceSnapshot,
  recordStartupMilestone,
  type StartupMilestoneName,
} from "../features/startup-orchestration/utils/startupTrace";
import { isStartupForceEntered } from "../features/startup-orchestration/utils/startupForceEnter";
import {
  clearFullCatalogAutoRetryCooldown,
  isFullCatalogAutoRetryBlocked,
  markFullCatalogAutoRetryCooldown,
} from "../features/startup-orchestration/utils/fullCatalogAutoRetry";
import { stampStartupGateReady } from "../features/startup-orchestration/utils/startupGateReady";
import {
  resolveNextWorkspaceThreadListHydrationId,
  shouldSkipWorkspaceThreadListLoad,
} from "./workspaceThreadListLoadGuard";
import { ensureInteractiveInputHooks } from "../utils/interactiveMainThread";

function hasStartupGateReady(): boolean {
  return Boolean(getStartupTraceSnapshot().milestones["startup-gate-ready"]);
}

/**
 * Cold-start list guard until gate-ready / force-enter:
 * - only the current active workspace may hydrate (first-paint or full)
 * - no active yet → block all (wait for active assignment)
 * No implicit full-catalog prewarm runs after the gate; complete history is
 * loaded only by explicit Load older / Session Management / force refresh.
 */
function isColdStartListGuardActive(): boolean {
  return !hasStartupGateReady() && !isStartupForceEntered();
}

function shouldSkipWorkspaceDuringColdStart(
  workspaceId: string,
  activeWorkspaceId: string | null,
): boolean {
  if (!isColdStartListGuardActive()) {
    return false;
  }
  // Home has no active-list cold-start owner. Explicit on-demand/session-radar
  // requests remain allowed; automatic full-catalog scheduling is removed.
  if (!activeWorkspaceId) {
    return false;
  }
  return workspaceId !== activeWorkspaceId;
}

type ListThreadsForWorkspace = (
  workspace: WorkspaceInfo,
  options?: {
    preserveState?: boolean;
    includeOpenCodeSessions?: boolean;
    deletedThreadIds?: string[];
    startupHydrationMode?: "full-catalog" | "first-paint";
    allowRuntimeReconnect?: boolean;
    /** When true mid-flight, list apply must no-op (workspace cancelled/switched). */
    isStale?: () => boolean;
  },
) => Promise<void | { applied?: boolean; stale?: boolean }>;

type UseWorkspaceThreadListHydrationOptions = {
  activeWorkspaceId: string | null;
  activeWorkspaceProjectionOwnerIds: readonly string[];
  listThreadsForWorkspace: ListThreadsForWorkspace;
  threadListLoadingByWorkspace: Record<string, boolean>;
  workspaces: WorkspaceInfo[];
  workspacesById: Map<string, WorkspaceInfo>;
};

type UseWorkspaceThreadListHydrationResult = {
  ensureWorkspaceThreadListLoaded: (
    workspaceId: string,
    options?: {
      preserveState?: boolean;
      force?: boolean;
      deletedThreadIds?: string[];
    },
  ) => void;
  /** Immutable snapshot identity for UI (memo-safe). Prefer this over the ref for render props. */
  hydratedThreadListWorkspaceIds: ReadonlySet<string>;
  hydratedThreadListWorkspaceIdsRef: MutableRefObject<Set<string>>;
  listThreadsForWorkspaceTracked: ListThreadsForWorkspace;
  prewarmSessionRadarForWorkspace: (workspaceId: string) => void;
};

type ThreadHydrationPhase = "active-workspace" | "idle-prewarm" | "on-demand";
type ThreadHydrationKind = "full-catalog" | "session-radar" | "first-paint";

/** Delay before first active list so open + first clicks stay free (0.7.15 often skipped load via race). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const COLD_START_FIRST_PAINT_DELAY_MS =
  typeof import.meta !== "undefined" &&
  (import.meta as any).env?.MODE === "test"
    ? 0
    : 500;
function isDiscardedStaleHydrationResult(
  result: ThreadListHydrationResult,
): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    result.applied === false &&
    result.stale === true
  );
}

function isTimeoutHydrationResult(result: ThreadListHydrationResult): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "timeout" in result &&
    (result as { timeout?: boolean }).timeout === true
  );
}

function hasRecordedActiveWorkspaceReady() {
  return Boolean(
    getStartupTraceSnapshot().milestones[ACTIVE_WORKSPACE_READY_MILESTONE],
  );
}

function createThreadHydrationTask(
  workspace: WorkspaceInfo,
  phase: ThreadHydrationPhase,
  kind: ThreadHydrationKind,
  run: (
    context: Parameters<
      StartupTaskDescriptor<ThreadListHydrationResult>["run"]
    >[0],
  ) => Promise<ThreadListHydrationResult>,
): StartupTaskDescriptor<ThreadListHydrationResult> {
  const dedupeKey = `thread-list:${kind}:${workspace.id}`;
  return {
    id: `thread-list:${kind}:${workspace.id}`,
    phase,
    priority:
      kind === "first-paint"
        ? 95
        : phase === "active-workspace"
          ? 90
          : phase === "on-demand"
            ? 85
            : kind === "session-radar"
              ? 30
              : 20,
    dedupeKey,
    concurrencyKey: "thread-session-scan",
    timeoutMs:
      kind === "first-paint"
        ? 8_000
        : phase === "active-workspace"
          ? 12_000
          : 20_000,
    workspaceScope: { workspaceId: workspace.id },
    // soft-ignore: timeout/cancel settle UI without hard-aborting native IPC,
    // but run() + list apply must honor isStale so late setThreads do not
    // storm the main thread after the user already moved on.
    cancelPolicy: "soft-ignore",
    traceLabel:
      kind === "session-radar"
        ? "session-radar workspace prewarm"
        : kind === "first-paint"
          ? "thread/list first-paint hydration"
          : `thread/list ${kind} hydration`,
    commandLabel: "list_threads",
    run,
    fallback: (reason) => {
      // cancelAllTasks / cancelWorkspaceTasks / abort: all must look "stale"
      // so finally skips publish-hydrate + full-catalog re-schedule.
      if (reason === "stale" || reason === "cancelled") {
        return { applied: false, stale: true };
      }
      // timeout/failure: distinguish from successful void so cooldown can apply
      // without treating every successful list (void) as timeout.
      if (reason === "timeout") {
        return { applied: false, stale: false, timeout: true };
      }
      return { applied: false, stale: false, timeout: false };
    },
  };
}

function publishHydrationUiState(
  setHydrated: (next: Set<string>) => void,
  nextHydrated: Set<string>,
): void {
  // Background lane — clicks stay urgent.
  startTransition(() => {
    setHydrated(nextHydrated);
  });
}

type ThreadListHydrationResult = void | {
  applied?: boolean;
  stale?: boolean;
  timeout?: boolean;
};
const ACTIVE_WORKSPACE_READY_MILESTONE: StartupMilestoneName =
  "active-workspace-ready";
const IDLE_PREWARM_DELAY_MS = 120;

/**
 * Publish a new Set identity so memo(Sidebar) can see hydration progress.
 * Mutating a shared Set in place is not enough:
 * layout passes the same Set reference into a memoized Sidebar and the
 * "加载中…" placeholder never leaves even after orchestrator timeout.
 */
function publishHydratedWorkspaceId(
  targetRef: MutableRefObject<Set<string>>,
  workspaceId: string,
): Set<string> {
  if (targetRef.current.has(workspaceId)) {
    return targetRef.current;
  }
  const next = new Set(targetRef.current);
  next.add(workspaceId);
  targetRef.current = next;
  return next;
}

export function useWorkspaceThreadListHydration({
  activeWorkspaceId,
  activeWorkspaceProjectionOwnerIds,
  listThreadsForWorkspace,
  threadListLoadingByWorkspace,
  workspacesById,
}: UseWorkspaceThreadListHydrationOptions): UseWorkspaceThreadListHydrationResult {
  const hydratedThreadListWorkspaceIdsRef = useRef(new Set<string>());
  const fullyHydratedThreadListWorkspaceIdsRef = useRef(new Set<string>());
  const hydratingThreadListWorkspaceIdsRef = useRef(new Set<string>());
  const hydrationPhaseByWorkspaceIdRef = useRef(
    new Map<string, ThreadHydrationPhase>(),
  );
  const hydrationKindByWorkspaceIdRef = useRef(
    new Map<string, ThreadHydrationKind>(),
  );
  const autoHydratedActiveWorkspaceIdRef = useRef<string | null>(null);
  const previousActiveWorkspaceIdRef = useRef<string | null>(null);
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  activeWorkspaceIdRef.current = activeWorkspaceId;
  const ensureWorkspaceThreadListLoadedRef = useRef<
    | ((
        workspaceId: string,
        options?: {
          preserveState?: boolean;
          force?: boolean;
          deletedThreadIds?: string[];
        },
      ) => void)
    | null
  >(null);
  const idleHydrationCleanupByWorkspaceIdRef = useRef(
    new Map<string, () => void>(),
  );
  // State carries the published Set identity for consumers (Sidebar via layout).
  // Ref stays the sync source of truth for in-flight guards.
  const [hydratedThreadListWorkspaceIds, setHydratedThreadListWorkspaceIds] =
    useState<ReadonlySet<string>>(
      () => hydratedThreadListWorkspaceIdsRef.current,
    );
  const renderScheduler = useRenderScheduler({
    budgetMs: 0,
    idleTimeoutMs: IDLE_PREWARM_DELAY_MS,
  });
  const scheduleIdleHydration = useCallback(
    (callback: () => void): (() => void) => {
      let cancelled = false;
      renderScheduler.scheduleChunk(() => {
        if (cancelled) {
          return false;
        }
        callback();
        return false;
      });
      return () => {
        cancelled = true;
      };
    },
    [renderScheduler],
  );

  const listThreadsForWorkspaceTracked = useCallback<ListThreadsForWorkspace>(
    async (workspace, options) => {
      // Cold-start: restore/focus/reload must not dual-scan non-active workspaces
      // (dump: two workspaces first-painted on-demand together at t≈1.7s).
      if (
        shouldSkipWorkspaceDuringColdStart(
          workspace.id,
          activeWorkspaceIdRef.current,
        )
      ) {
        return { applied: false, stale: true };
      }

      hydratingThreadListWorkspaceIdsRef.current.add(workspace.id);
      // Default path for direct callers (reload / rename): never assume full-catalog
      // on a never-hydrated workspace — that was the cold-start "no first-paint" bug.
      const uiAlreadyHydrated = hydratedThreadListWorkspaceIdsRef.current.has(
        workspace.id,
      );
      const kind: ThreadHydrationKind =
        hydrationKindByWorkspaceIdRef.current.get(workspace.id) ??
        (uiAlreadyHydrated ? "full-catalog" : "first-paint");
      const phase: ThreadHydrationPhase =
        hydrationPhaseByWorkspaceIdRef.current.get(workspace.id) ??
        (workspace.id === activeWorkspaceIdRef.current
          ? "active-workspace"
          : "on-demand");
      // Keep maps aligned for concurrent ensure/skip guards.
      hydrationKindByWorkspaceIdRef.current.set(workspace.id, kind);
      hydrationPhaseByWorkspaceIdRef.current.set(workspace.id, phase);

      let hydrationResult: ThreadListHydrationResult = undefined;
      const finishedKind = kind;
      try {
        const mode = kind === "first-paint" ? "first-paint" : "full-catalog";
        hydrationResult = await startupOrchestrator.run(
          createThreadHydrationTask(workspace, phase, kind, async (context) => {
            if (context.isStale()) {
              return { applied: false, stale: true };
            }
            return listThreadsForWorkspace(workspace, {
              ...options,
              startupHydrationMode: mode,
              allowRuntimeReconnect: false,
              isStale: context.isStale,
            });
          }),
        );
      } finally {
        const discardedAsStale =
          isDiscardedStaleHydrationResult(hydrationResult);
        const settledAsTimeout =
          !discardedAsStale && isTimeoutHydrationResult(hydrationResult);
        const isStillActive = workspace.id === activeWorkspaceIdRef.current;

        if (
          !discardedAsStale &&
          isStillActive &&
          (phase === "active-workspace" || finishedKind === "first-paint") &&
          !hasRecordedActiveWorkspaceReady()
        ) {
          // Only the active workspace first-paint/list marks this notice milestone.
          recordStartupMilestone(ACTIVE_WORKSPACE_READY_MILESTONE);
        }
        hydratingThreadListWorkspaceIdsRef.current.delete(workspace.id);
        hydrationPhaseByWorkspaceIdRef.current.delete(workspace.id);
        hydrationKindByWorkspaceIdRef.current.delete(workspace.id);
        if (!discardedAsStale) {
          const nextHydrated = publishHydratedWorkspaceId(
            hydratedThreadListWorkspaceIdsRef,
            workspace.id,
          );
          if (finishedKind !== "first-paint") {
            // Mark full attempted so sidebar drops loading; cooldown on timeout.
            publishHydratedWorkspaceId(
              fullyHydratedThreadListWorkspaceIdsRef,
              workspace.id,
            );
            if (settledAsTimeout) {
              markFullCatalogAutoRetryCooldown(workspace.id, "timeout");
            }
            // MUST NOT stamp startup-gate-ready from full-catalog settle.
          } else if (isStillActive) {
            // Only active first-paint opens the click gate (not a side workspace).
            stampStartupGateReady("first-paint-complete");
          }
          publishHydrationUiState(
            setHydratedThreadListWorkspaceIds,
            nextHydrated,
          );
        } else {
          // Stale discard: re-ensure first-paint only for the still-active owner.
          if (finishedKind === "first-paint") {
            autoHydratedActiveWorkspaceIdRef.current = null;
            Promise.resolve().then(() => {
              // Do not re-ensure a workspace the user already left.
              if (activeWorkspaceIdRef.current !== workspace.id) {
                return;
              }
              ensureWorkspaceThreadListLoadedRef.current?.(workspace.id, {
                preserveState: true,
              });
            });
          }
        }
      }
    },
    [listThreadsForWorkspace],
  );

  const ensureWorkspaceThreadListLoaded = useCallback(
    (
      workspaceId: string,
      options?: {
        preserveState?: boolean;
        force?: boolean;
        deletedThreadIds?: string[];
      },
    ) => {
      const workspace = workspacesById.get(workspaceId);
      if (!workspace) {
        return;
      }
      const force = options?.force ?? false;
      const isLoading = threadListLoadingByWorkspace[workspaceId] ?? false;
      const uiHydrated =
        hydratedThreadListWorkspaceIdsRef.current.has(workspaceId);
      const fullyHydrated =
        fullyHydratedThreadListWorkspaceIdsRef.current.has(workspaceId);
      // first-paint if UI never ready; else full-catalog until fully done.
      const kind: ThreadHydrationKind = force
        ? "full-catalog"
        : !uiHydrated
          ? "first-paint"
          : "full-catalog";
      // Cold-start: only active workspace may hydrate until gate-ready.
      // User force refresh may target any workspace after gate; during cold-start
      // force still restricted to active to avoid dual-scan storms.
      if (
        !force &&
        shouldSkipWorkspaceDuringColdStart(workspaceId, activeWorkspaceId)
      ) {
        return;
      }
      if (
        force &&
        isColdStartListGuardActive() &&
        workspaceId !== activeWorkspaceId
      ) {
        return;
      }
      if (
        kind === "full-catalog" &&
        !force &&
        (isFullCatalogAutoRetryBlocked(workspaceId) || isStartupForceEntered())
      ) {
        return;
      }
      if (force && kind === "full-catalog") {
        clearFullCatalogAutoRetryCooldown(workspaceId);
      }
      const hasHydratedThreadList =
        kind === "first-paint" ? uiHydrated : fullyHydrated;
      const isHydratingThreadList =
        hydratingThreadListWorkspaceIdsRef.current.has(workspaceId);
      if (
        shouldSkipWorkspaceThreadListLoad({
          force,
          isLoading,
          isHydratingThreadList,
          hasHydratedThreadList,
        })
      ) {
        return;
      }
      const phase: ThreadHydrationPhase = force
        ? "on-demand"
        : workspaceId === activeWorkspaceId
          ? "active-workspace"
          : "idle-prewarm";
      hydrationPhaseByWorkspaceIdRef.current.set(workspaceId, phase);
      hydrationKindByWorkspaceIdRef.current.set(workspaceId, kind);
      void listThreadsForWorkspaceTracked(workspace, {
        preserveState: options?.preserveState,
        deletedThreadIds: options?.deletedThreadIds,
        startupHydrationMode:
          kind === "first-paint" ? "first-paint" : "full-catalog",
      });
    },
    [
      activeWorkspaceId,
      listThreadsForWorkspaceTracked,
      threadListLoadingByWorkspace,
      workspacesById,
    ],
  );

  ensureWorkspaceThreadListLoadedRef.current = ensureWorkspaceThreadListLoaded;

  const prewarmSessionRadarForWorkspace = useCallback(
    (workspaceId: string) => {
      const workspace = workspacesById.get(workspaceId);
      if (!workspace) {
        return;
      }
      if (threadListLoadingByWorkspace[workspaceId] ?? false) {
        return;
      }
      if (hydratingThreadListWorkspaceIdsRef.current.has(workspaceId)) {
        return;
      }
      if (fullyHydratedThreadListWorkspaceIdsRef.current.has(workspaceId)) {
        return;
      }
      if (idleHydrationCleanupByWorkspaceIdRef.current.has(workspaceId)) {
        return;
      }
      const cleanup = scheduleIdleHydration(() => {
        idleHydrationCleanupByWorkspaceIdRef.current.delete(workspaceId);
        if (threadListLoadingByWorkspace[workspaceId] ?? false) {
          return;
        }
        if (hydratingThreadListWorkspaceIdsRef.current.has(workspaceId)) {
          return;
        }
        if (fullyHydratedThreadListWorkspaceIdsRef.current.has(workspaceId)) {
          return;
        }
        hydrationPhaseByWorkspaceIdRef.current.set(workspaceId, "idle-prewarm");
        hydrationKindByWorkspaceIdRef.current.set(workspaceId, "session-radar");
        void listThreadsForWorkspaceTracked(workspace, {
          preserveState: true,
        });
      });
      idleHydrationCleanupByWorkspaceIdRef.current.set(workspaceId, cleanup);
    },
    [
      listThreadsForWorkspaceTracked,
      scheduleIdleHydration,
      threadListLoadingByWorkspace,
      workspacesById,
    ],
  );

  useEffect(() => {
    ensureInteractiveInputHooks();
  }, []);

  useEffect(() => {
    const previousActiveWorkspaceId = previousActiveWorkspaceIdRef.current;
    if (
      previousActiveWorkspaceId &&
      previousActiveWorkspaceId !== activeWorkspaceId
    ) {
      // Spec: stale workspace hydration is cancelled on switch. Soft-ignore
      // marks the generation stale so late list apply no-ops via isStale.
      startupOrchestrator.cancelWorkspaceTasks(
        previousActiveWorkspaceId,
        "stale",
      );
      const idleCleanup = idleHydrationCleanupByWorkspaceIdRef.current.get(
        previousActiveWorkspaceId,
      );
      if (idleCleanup) {
        idleCleanup();
        idleHydrationCleanupByWorkspaceIdRef.current.delete(
          previousActiveWorkspaceId,
        );
      }
    }
    previousActiveWorkspaceIdRef.current = activeWorkspaceId;

    if (!activeWorkspaceId) {
      autoHydratedActiveWorkspaceIdRef.current = null;
      return;
    }
    if (autoHydratedActiveWorkspaceIdRef.current === activeWorkspaceId) {
      return;
    }
    // Do not mark the active workspace as auto-hydrated until it exists in the
    // workspace map. On cold start activeWorkspaceId can land before workspacesById
    // is populated; marking early permanently skips ensure and leaves the sidebar
    // on "加载中…".
    if (!workspacesById.has(activeWorkspaceId)) {
      return;
    }
    // Defer first-paint list so cold-start clicks stay interactive. 0.7.15 often
    // skipped load via the workspacesById race; we keep correctness of 9e3c1bdd8
    // but do not start multi-engine work in the same frame as first paint.
    const targetId = activeWorkspaceId;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) {
        return;
      }
      if (autoHydratedActiveWorkspaceIdRef.current === targetId) {
        return;
      }
      autoHydratedActiveWorkspaceIdRef.current = targetId;
      ensureWorkspaceThreadListLoaded(targetId, { preserveState: true });
    }, COLD_START_FIRST_PAINT_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeWorkspaceId, ensureWorkspaceThreadListLoaded, workspacesById]);

  useEffect(() => {
    if (!activeWorkspaceId || activeWorkspaceProjectionOwnerIds.length <= 1) {
      return;
    }
    // Projection owners: defer until gate-ready so cold-start does not dual-scan.
    if (isColdStartListGuardActive() && activeWorkspaceId) {
      return;
    }
    activeWorkspaceProjectionOwnerIds.forEach((workspaceId) => {
      if (workspaceId === activeWorkspaceId) {
        return;
      }
      if (!workspacesById.has(workspaceId)) {
        return;
      }
      if (hydratedThreadListWorkspaceIdsRef.current.has(workspaceId)) {
        return;
      }
      ensureWorkspaceThreadListLoaded(workspaceId, { preserveState: true });
    });
  }, [
    activeWorkspaceId,
    activeWorkspaceProjectionOwnerIds,
    ensureWorkspaceThreadListLoaded,
    workspacesById,
  ]);

  useEffect(() => {
    if (!activeWorkspaceId || isColdStartListGuardActive()) {
      return;
    }
    const eligibleWorkspaces = Array.from(workspacesById.values()).filter(
      (workspace) => workspace.connected && !workspace.settings.sidebarCollapsed,
    );
    const nextWorkspaceId = resolveNextWorkspaceThreadListHydrationId({
      workspaces: eligibleWorkspaces,
      activeWorkspaceProjectionOwnerIds,
      // first-paint completion is enough for Sidebar visibility; using the
      // full-catalog set here would select the same background workspace again.
      hydratedWorkspaceIds: hydratedThreadListWorkspaceIdsRef.current,
      hydratingWorkspaceIds: hydratingThreadListWorkspaceIdsRef.current,
      loadingByWorkspace: threadListLoadingByWorkspace,
    });
    if (
      !nextWorkspaceId ||
      idleHydrationCleanupByWorkspaceIdRef.current.has(nextWorkspaceId)
    ) {
      return;
    }
    const workspace = workspacesById.get(nextWorkspaceId);
    if (!workspace) {
      return;
    }
    const cleanup = scheduleIdleHydration(() => {
      idleHydrationCleanupByWorkspaceIdRef.current.delete(nextWorkspaceId);
      ensureWorkspaceThreadListLoaded(nextWorkspaceId, { preserveState: true });
    });
    idleHydrationCleanupByWorkspaceIdRef.current.set(nextWorkspaceId, cleanup);
  }, [
    activeWorkspaceId,
    activeWorkspaceProjectionOwnerIds,
    ensureWorkspaceThreadListLoaded,
    hydratedThreadListWorkspaceIds,
    scheduleIdleHydration,
    threadListLoadingByWorkspace,
    workspacesById,
  ]);

  useEffect(() => {
    const cleanupByWorkspaceId = idleHydrationCleanupByWorkspaceIdRef.current;
    return () => {
      cleanupByWorkspaceId.forEach((cleanup) => cleanup());
      cleanupByWorkspaceId.clear();
    };
  }, []);

  return {
    ensureWorkspaceThreadListLoaded,
    hydratedThreadListWorkspaceIds,
    hydratedThreadListWorkspaceIdsRef,
    listThreadsForWorkspaceTracked,
    prewarmSessionRadarForWorkspace,
  };
}
