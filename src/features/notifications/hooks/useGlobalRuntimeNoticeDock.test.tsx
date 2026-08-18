// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearGlobalRuntimeNotices,
  getGlobalRuntimeNoticesSnapshot,
  pushGlobalRuntimeNotice,
} from "../../../services/globalRuntimeNotices";
import {
  recordStartupMilestone,
  recordStartupTaskTrace,
  resetStartupTraceForTests,
  traceStartupCommand,
} from "../../startup-orchestration/utils/startupTrace";
import {
  sanitizeGlobalRuntimeNoticeDockVisibility,
  useGlobalRuntimeNoticeDock,
} from "./useGlobalRuntimeNoticeDock";

const clientStorageMocks = vi.hoisted(() => ({
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

const tauriMocks = vi.hoisted(() => ({
  getRuntimePoolSnapshot: vi.fn(),
}));
const originalConsoleError = console.error;

function isReactActWarning(args: unknown[]): boolean {
  return args.some(
    (value) => typeof value === "string" && value.includes("not wrapped in act"),
  );
}

vi.mock("../../../services/clientStorage", () => ({
  getClientStoreSync: clientStorageMocks.getClientStoreSync,
  writeClientStoreValue: clientStorageMocks.writeClientStoreValue,
}));

vi.mock("../../../services/tauri", () => ({
  getRuntimePoolSnapshot: tauriMocks.getRuntimePoolSnapshot,
}));

function createEmptyRuntimePoolSnapshot() {
  return {
    rows: [],
    summary: {
      totalRuntimes: 0,
      acquiredRuntimes: 0,
      streamingRuntimes: 0,
      gracefulIdleRuntimes: 0,
      evictableRuntimes: 0,
      activeWorkProtectedRuntimes: 0,
      pinnedRuntimes: 0,
      codexRuntimes: 0,
      claudeRuntimes: 0,
    },
    budgets: {
      maxHotCodex: 0,
      maxWarmCodex: 0,
      warmTtlSeconds: 0,
      restoreThreadsOnlyOnLaunch: false,
      forceCleanupOnExit: false,
      orphanSweepOnLaunch: false,
    },
    diagnostics: {
      orphanEntriesFound: 0,
      orphanEntriesCleaned: 0,
      orphanEntriesFailed: 0,
      forceKillCount: 0,
      leaseBlockedEvictionCount: 0,
      coordinatorAbortCount: 0,
      startupManagedNodeProcesses: 0,
      startupResumeHelperNodeProcesses: 0,
      startupOrphanResidueProcesses: 0,
      lastOrphanSweepAtMs: null,
      lastShutdownAtMs: null,
    },
    engineObservability: [],
  };
}

describe("useGlobalRuntimeNoticeDock", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T09:00:00"));
    clearGlobalRuntimeNotices();
    resetStartupTraceForTests();
    clientStorageMocks.getClientStoreSync.mockReset();
    clientStorageMocks.writeClientStoreValue.mockReset();
    tauriMocks.getRuntimePoolSnapshot.mockReset();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      if (isReactActWarning(args)) {
        return;
      }
      originalConsoleError(...args);
    });
    clientStorageMocks.getClientStoreSync.mockReturnValue(undefined);
    tauriMocks.getRuntimePoolSnapshot.mockResolvedValue(createEmptyRuntimePoolSnapshot());
  });

  afterEach(() => {
    clearGlobalRuntimeNotices();
    resetStartupTraceForTests();
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
    vi.useRealTimers();
  });

  it("sanitizes invalid persisted visibility values", () => {
    expect(sanitizeGlobalRuntimeNoticeDockVisibility("expanded")).toBe("expanded");
    expect(sanitizeGlobalRuntimeNoticeDockVisibility("broken")).toBe("minimized");
    expect(sanitizeGlobalRuntimeNoticeDockVisibility(null)).toBe("minimized");
  });

  it("persists visibility changes through client storage", async () => {
    clientStorageMocks.getClientStoreSync.mockReturnValue("broken-value");

    const { result } = renderHook(() =>
      useGlobalRuntimeNoticeDock([
        {
          id: "ws-1",
          name: "Moss X",
          path: "/tmp/mossx",
          connected: true,
          settings: { sidebarCollapsed: false },
        },
      ]),
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.visibility).toBe("minimized");

    act(() => {
      result.current.expand();
    });

    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenLastCalledWith(
      "app",
      "globalRuntimeNoticeDock.visibility",
      "expanded",
    );

    act(() => {
      result.current.minimize();
    });

    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenLastCalledWith(
      "app",
      "globalRuntimeNoticeDock.visibility",
      "minimized",
    );
  });

  it("records runtime pool transitions but exposes only error notices to the dock", async () => {
    const initialSnapshot = {
      ...createEmptyRuntimePoolSnapshot(),
      rows: [
        {
          workspaceId: "ws-1",
          workspaceName: "Repo A",
          workspacePath: "/tmp/repo-a",
          engine: "codex",
          state: "streaming",
          pid: null,
          wrapperKind: null,
          resolvedBin: null,
          startedAtMs: null,
          lastUsedAtMs: 0,
          pinned: false,
          turnLeaseCount: 0,
          streamLeaseCount: 0,
          leaseSources: [],
          activeWorkProtected: false,
          evictCandidate: false,
          evictionReason: null,
          error: null,
          foregroundWorkState: "resume-pending",
          startupState: "suspect-stale",
        },
      ],
    };
    tauriMocks.getRuntimePoolSnapshot.mockResolvedValue(initialSnapshot);

    const { result } = renderHook(() =>
      useGlobalRuntimeNoticeDock([
        {
          id: "ws-1",
          name: "Moss X",
          path: "/tmp/mossx",
          connected: true,
          settings: { sidebarCollapsed: false },
        },
      ]),
    );
    const initialLoadPromise = tauriMocks.getRuntimePoolSnapshot.mock.results[0]?.value;

    await act(async () => {
      await initialLoadPromise;
    });

    expect(getGlobalRuntimeNoticesSnapshot()[0]).toEqual(
      expect.objectContaining({
        messageKey: "runtimeNotice.runtime.resumePending",
        messageParams: {
          workspace: "Repo A",
          engine: "Codex",
        },
      }),
    );
    expect(result.current.notices).toEqual([]);
    expect(result.current.status).toBe("idle");
    expect(result.current.runtimeRows).toEqual(initialSnapshot.rows);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8100);
    });

    expect(result.current.status).toBe("idle");
  });

  it("keeps exposed notices stable when invisible info notices are appended", async () => {
    const { result } = renderHook(() => useGlobalRuntimeNoticeDock([]));

    await act(async () => {
      await tauriMocks.getRuntimePoolSnapshot.mock.results[0]?.value;
    });

    const exposedNotices = result.current.notices;

    act(() => {
      pushGlobalRuntimeNotice({
        severity: "info",
        category: "diagnostic",
        messageKey: "runtimeNotice.startup.commandCompleted",
      });
    });

    expect(getGlobalRuntimeNoticesSnapshot()).toHaveLength(1);
    expect(result.current.notices).toBe(exposedNotices);
    expect(result.current.status).toBe("idle");
  });

  it("keeps runtime row signal state stable when snapshot order changes only", async () => {
    const rowA = {
      workspaceId: "ws-a",
      workspaceName: "Repo A",
      workspacePath: "/tmp/repo-a",
      engine: "codex",
      state: "streaming",
      lifecycleState: "active",
      pid: null,
      wrapperKind: null,
      resolvedBin: null,
      startedAtMs: null,
      lastUsedAtMs: 0,
      pinned: false,
      turnLeaseCount: 0,
      streamLeaseCount: 0,
      leaseSources: [],
      activeWorkProtected: false,
      evictCandidate: false,
      evictionReason: null,
      error: null,
      foregroundWorkState: null,
      startupState: "ready",
    };
    const rowB = {
      ...rowA,
      workspaceId: "ws-b",
      workspaceName: "Repo B",
      workspacePath: "/tmp/repo-b",
      engine: "claude",
    };
    tauriMocks.getRuntimePoolSnapshot
      .mockResolvedValueOnce({
        ...createEmptyRuntimePoolSnapshot(),
        rows: [rowA, rowB],
      })
      .mockResolvedValueOnce({
        ...createEmptyRuntimePoolSnapshot(),
        rows: [rowB, rowA],
      });

    const { result } = renderHook(() => useGlobalRuntimeNoticeDock([]));
    await act(async () => {
      await tauriMocks.getRuntimePoolSnapshot.mock.results[0]?.value;
    });
    const firstRows = result.current.runtimeRows;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      await tauriMocks.getRuntimePoolSnapshot.mock.results[1]?.value;
    });

    expect(result.current.runtimeRows).toBe(firstRows);
  });

  it("writes back initial ready runtime snapshots with engine-aware copy and stable path fallback", async () => {
    const initialSnapshot = {
      ...createEmptyRuntimePoolSnapshot(),
      rows: [
        {
          workspaceId: "ws-ready",
          workspaceName: "   ",
          workspacePath: "C:\\Users\\me\\Workspace Ready\\",
          engine: "claude",
          state: "graceful-idle",
          pid: null,
          wrapperKind: null,
          resolvedBin: null,
          startedAtMs: null,
          lastUsedAtMs: 0,
          pinned: false,
          turnLeaseCount: 0,
          streamLeaseCount: 0,
          leaseSources: [],
          activeWorkProtected: false,
          evictCandidate: false,
          evictionReason: null,
          error: null,
          foregroundWorkState: null,
          startupState: "ready",
        },
        {
          workspaceId: "ws-empty",
          workspaceName: "   ",
          workspacePath: "   ",
          engine: "codex",
          state: "graceful-idle",
          pid: null,
          wrapperKind: null,
          resolvedBin: null,
          startedAtMs: null,
          lastUsedAtMs: 0,
          pinned: false,
          turnLeaseCount: 0,
          streamLeaseCount: 0,
          leaseSources: [],
          activeWorkProtected: false,
          evictCandidate: false,
          evictionReason: null,
          error: null,
          foregroundWorkState: null,
          startupState: "ready",
        },
      ],
    };
    tauriMocks.getRuntimePoolSnapshot.mockResolvedValue(initialSnapshot);

    const { result } = renderHook(() =>
      useGlobalRuntimeNoticeDock([
        {
          id: "ws-1",
          name: "Moss X",
          path: "/tmp/mossx",
          connected: true,
          settings: { sidebarCollapsed: false },
        },
      ]),
    );
    const initialLoadPromise = tauriMocks.getRuntimePoolSnapshot.mock.results[0]?.value;

    await act(async () => {
      await initialLoadPromise;
    });

    const storedNotices = getGlobalRuntimeNoticesSnapshot();
    expect(storedNotices).toHaveLength(2);
    expect(storedNotices[0]).toEqual(
      expect.objectContaining({
        messageKey: "runtimeNotice.runtime.ready",
        messageParams: {
          workspace: "Workspace Ready",
          engine: "Claude",
        },
      }),
    );
    expect(storedNotices[1]).toEqual(
      expect.objectContaining({
        messageKey: "runtimeNotice.runtime.ready",
        messageParams: {
          workspace: "ws-empty",
          engine: "Codex",
        },
      }),
    );
    expect(result.current.notices).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      const nextLoadPromise = tauriMocks.getRuntimePoolSnapshot.mock.results[1]?.value;
      await nextLoadPromise;
    });

    expect(getGlobalRuntimeNoticesSnapshot()).toHaveLength(2);
    expect(result.current.notices).toEqual([]);
  });

  it("mirrors only abnormal startup trace events into the notice channel", async () => {
    const { result } = renderHook(() =>
      useGlobalRuntimeNoticeDock([
        {
          id: "ws-1",
          name: "Moss X",
          path: "/tmp/mossx",
          connected: true,
          settings: { sidebarCollapsed: false },
        },
      ]),
    );

    await act(async () => {
      await tauriMocks.getRuntimePoolSnapshot.mock.results[0]?.value;
    });

    act(() => {
      recordStartupTaskTrace({
        type: "task",
        taskId: "thread-list:first-page:ws-1",
        phase: "active-workspace",
        traceLabel: "Load active workspace threads",
        workspaceScope: { workspaceId: "ws-1" },
        lifecycleState: "started",
        durationMs: null,
        fallbackReason: null,
        cancellationMode: null,
        commandLabel: "list_threads",
      });
      recordStartupTaskTrace({
        type: "task",
        taskId: "thread-list:first-page:ws-1",
        phase: "active-workspace",
        traceLabel: "Load active workspace threads",
        workspaceScope: { workspaceId: "ws-1" },
        lifecycleState: "degraded",
        durationMs: 42.4,
        fallbackReason: "timeout",
        cancellationMode: null,
        commandLabel: "list_threads",
      });
      recordStartupTaskTrace({
        type: "task",
        taskId: "thread-list:first-page:ws-1",
        phase: "active-workspace",
        traceLabel: "Load active workspace threads",
        workspaceScope: { workspaceId: "ws-1" },
        lifecycleState: "failed",
        durationMs: 45.6,
        fallbackReason: "failure",
        cancellationMode: null,
        commandLabel: "list_threads",
      });
      recordStartupMilestone("active-workspace-ready");
    });

    await act(async () => {
      await traceStartupCommand("list_threads", { workspaceId: "ws-1" }, async () => "ok");
      await traceStartupCommand("list_threads", { workspaceId: "ws-1" }, async () => {
        throw new Error("boom");
      }).catch(() => undefined);
    });

    const mirroredNotices = getGlobalRuntimeNoticesSnapshot();
    expect(mirroredNotices).toHaveLength(3);
    expect(mirroredNotices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          messageKey: "runtimeNotice.startup.taskDegraded",
          messageParams: {
            phase: "active-workspace",
            task: "Load active workspace threads",
            workspace: "Moss X",
            durationMs: 42,
            reason: "timeout",
          },
        }),
        expect.objectContaining({
          severity: "error",
          messageKey: "runtimeNotice.startup.taskFailed",
          messageParams: {
            phase: "active-workspace",
            task: "Load active workspace threads",
            workspace: "Moss X",
            durationMs: 46,
            reason: "failure",
          },
        }),
        expect.objectContaining({
          severity: "error",
          messageKey: "runtimeNotice.startup.commandFailed",
          messageParams: {
            command: "list_threads",
            workspace: "Moss X",
            durationMs: 0,
          },
        }),
      ]),
    );
    expect(result.current.notices).toHaveLength(2);
    expect(result.current.notices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          messageKey: "runtimeNotice.startup.taskFailed",
          messageParams: {
            phase: "active-workspace",
            task: "Load active workspace threads",
            workspace: "Moss X",
            durationMs: 46,
            reason: "failure",
          },
        }),
        expect.objectContaining({
          severity: "error",
          messageKey: "runtimeNotice.startup.commandFailed",
          messageParams: {
            command: "list_threads",
            workspace: "Moss X",
            durationMs: 0,
          },
        }),
      ]),
    );
  });

  it("does not mirror repeated successful startup commands", async () => {
    const { result } = renderHook(() =>
      useGlobalRuntimeNoticeDock([
        {
          id: "ws-git",
          name: "Git Repo",
          path: "/tmp/git-repo",
          connected: true,
          settings: { sidebarCollapsed: false },
        },
      ]),
    );

    await act(async () => {
      await tauriMocks.getRuntimePoolSnapshot.mock.results[0]?.value;
    });

    await act(async () => {
      await traceStartupCommand("get_git_status", { workspaceId: "ws-git" }, async () => "ok");
      await traceStartupCommand("get_git_status", { workspaceId: "ws-git" }, async () => "ok");
    });

    const commandNotices = getGlobalRuntimeNoticesSnapshot().filter(
      (notice) => notice.messageKey === "runtimeNotice.startup.commandCompleted",
    );
    expect(commandNotices).toEqual([]);
    expect(result.current.notices).toEqual([]);
  });

  it("keeps successful startup commands out of notices across projects", async () => {
    const { result } = renderHook(() =>
      useGlobalRuntimeNoticeDock([
        {
          id: "ws-alpha",
          name: "Alpha",
          path: "/tmp/alpha",
          connected: true,
          settings: { sidebarCollapsed: false },
        },
        {
          id: "ws-beta",
          name: "Beta",
          path: "/tmp/beta",
          connected: true,
          settings: { sidebarCollapsed: false },
        },
      ]),
    );

    await act(async () => {
      await tauriMocks.getRuntimePoolSnapshot.mock.results[0]?.value;
    });

    await act(async () => {
      await traceStartupCommand("list_threads", { workspaceId: "ws-alpha" }, async () => "ok");
      await traceStartupCommand("list_thread_titles", { workspaceId: "ws-alpha" }, async () => "ok");
      await traceStartupCommand("list_threads", { workspaceId: "ws-beta" }, async () => "ok");
      await traceStartupCommand("list_threads", { workspaceId: "ws-alpha" }, async () => "ok");
    });

    const commandNotices = getGlobalRuntimeNoticesSnapshot().filter(
      (notice) => notice.messageKey === "runtimeNotice.startup.commandCompleted",
    );
    expect(commandNotices).toEqual([]);
    expect(result.current.notices).toEqual([]);
  });

  it("does not mirror successful startup trace events before or after remount", async () => {
    const workspace = {
      id: "ws-alpha",
      name: "Alpha",
      path: "/tmp/alpha",
      connected: true,
      settings: { sidebarCollapsed: false },
    };
    const firstRender = renderHook(() => useGlobalRuntimeNoticeDock([workspace]));

    await act(async () => {
      await tauriMocks.getRuntimePoolSnapshot.mock.results[0]?.value;
    });

    await act(async () => {
      await traceStartupCommand("list_threads", { workspaceId: "ws-alpha" }, async () => "ok");
    });

    expect(
      getGlobalRuntimeNoticesSnapshot().filter(
        (notice) => notice.messageKey === "runtimeNotice.startup.commandCompleted",
      ),
    ).toHaveLength(0);

    firstRender.unmount();
    renderHook(() => useGlobalRuntimeNoticeDock([workspace]));

    await act(async () => {
      await tauriMocks.getRuntimePoolSnapshot.mock.results[1]?.value;
    });

    expect(
      getGlobalRuntimeNoticesSnapshot().filter(
        (notice) => notice.messageKey === "runtimeNotice.startup.commandCompleted",
      ),
    ).toHaveLength(0);

    await act(async () => {
      await traceStartupCommand("list_thread_titles", { workspaceId: "ws-alpha" }, async () => "ok");
    });

    expect(
      getGlobalRuntimeNoticesSnapshot().filter(
        (notice) => notice.messageKey === "runtimeNotice.startup.commandCompleted",
      ),
    ).toHaveLength(0);
  });

  it("mirrors a failed command without retaining surrounding successful chatter", async () => {
    const { result } = renderHook(() =>
      useGlobalRuntimeNoticeDock([
        {
          id: "ws-alpha",
          name: "Alpha",
          path: "/tmp/alpha",
          connected: true,
          settings: { sidebarCollapsed: false },
        },
      ]),
    );

    await act(async () => {
      await tauriMocks.getRuntimePoolSnapshot.mock.results[0]?.value;
    });

    await act(async () => {
      await traceStartupCommand("list_threads", { workspaceId: "ws-alpha" }, async () => "ok");
      await traceStartupCommand("list_threads", { workspaceId: "ws-alpha" }, async () => {
        throw new Error("boom");
      }).catch(() => undefined);
      await traceStartupCommand("list_threads", { workspaceId: "ws-alpha" }, async () => "ok");
    });

    const successfulNotices = getGlobalRuntimeNoticesSnapshot().filter(
      (notice) => notice.messageKey === "runtimeNotice.startup.commandCompleted",
    );
    const failedNotices = result.current.notices.filter(
      (notice) => notice.messageKey === "runtimeNotice.startup.commandFailed",
    );
    expect(successfulNotices).toEqual([]);
    expect(failedNotices).toHaveLength(1);
    expect(failedNotices[0]).toEqual(
      expect.objectContaining({
        repeatCount: 1,
        messageParams: {
          command: "list_threads",
          workspace: "Alpha",
          durationMs: 0,
        },
      }),
    );
  });
});
