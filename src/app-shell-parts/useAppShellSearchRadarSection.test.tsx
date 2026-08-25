// @vitest-environment jsdom
import { useState } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSearchFileSnapshot } from "../features/search/types";
import {
  RADAR_STORE_NAME,
  SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY,
  SESSION_RADAR_RECENT_STORAGE_KEY,
} from "../features/session-activity/utils/sessionRadarPersistence";
import { getClientStoreSync, writeClientStoreValue } from "../services/clientStorage";
import type { AppSettings, WorkspaceInfo } from "../types";
import { useAppShellSearchRadarSection } from "./useAppShellSearchRadarSection";

const prewarmSessionRadarForWorkspaceMock = vi.hoisted(() => vi.fn());
const useUnifiedSearchMock = vi.hoisted(() => vi.fn(() => []));
const isBackgroundRenderGatingEnabledMock = vi.hoisted(() => vi.fn(() => true));
const getWorkspaceFilesMock = vi.hoisted(() => vi.fn());
const readProjectMapRelationshipsMock = vi.hoisted(() => vi.fn());
const scanProjectMapRelationshipsMock = vi.hoisted(() => vi.fn());
const useWorkspaceSessionProjectionSummaryMock = vi.hoisted(() =>
  vi.fn(() => ({ summary: { ownerWorkspaceIds: ["ws-1"] } })),
);
const useWorkspaceThreadListHydrationMock = vi.hoisted(() =>
  vi.fn(() => ({
    ensureWorkspaceThreadListLoaded: vi.fn(),
    hydratedThreadListWorkspaceIds: new Set<string>(),
    hydratedThreadListWorkspaceIdsRef: { current: new Set<string>() },
    listThreadsForWorkspaceTracked: vi.fn(),
    prewarmSessionRadarForWorkspace: prewarmSessionRadarForWorkspaceMock,
  })),
);

vi.mock("../features/app/hooks/useComposerInsert", () => ({
  useComposerInsert: vi.fn(() => vi.fn()),
}));

vi.mock("../features/composer/hooks/useInputHistoryStore", () => ({
  loadHistoryWithImportance: vi.fn(() => []),
}));

vi.mock("../features/search/hooks/useUnifiedSearch", () => ({
  useUnifiedSearch: useUnifiedSearchMock,
}));

vi.mock("../features/project-map/services/projectMapPersistence", () => ({
  readProjectMapRelationships: readProjectMapRelationshipsMock,
  scanProjectMapRelationships: scanProjectMapRelationshipsMock,
}));

vi.mock("../features/project-map/utils/relationshipDashboardModel", () => ({
  normalizeProjectMapRelationshipDashboardData: (response: {
    apiContracts?: unknown;
    staleSummary?: unknown;
  }) => ({
    apiContracts: response.apiContracts ?? null,
    staleSummary: response.staleSummary ?? null,
  }),
}));

vi.mock("@/conversation-presentation/realtimePerfFlags", () => ({
  isBackgroundRenderGatingEnabled: isBackgroundRenderGatingEnabledMock,
}));

vi.mock("../features/session-activity/hooks/useWorkspaceSessionActivity", () => ({
  useWorkspaceSessionActivity: vi.fn(() => ({ sections: [] })),
}));

vi.mock("../features/session-activity/hooks/useSessionRadarFeed", () => ({
  useSessionRadarFeed: vi.fn(() => ({
    runningSessions: [],
    recentCompletedSessions: [],
    runningCountByWorkspaceId: {},
    recentCountByWorkspaceId: {},
  })),
}));

vi.mock("../features/workspaces/hooks/useWorkspaceSessionProjectionSummary", () => ({
  useWorkspaceSessionProjectionSummary: useWorkspaceSessionProjectionSummaryMock,
}));

vi.mock("./useWorkspaceThreadListHydration", () => ({
  useWorkspaceThreadListHydration: useWorkspaceThreadListHydrationMock,
}));

vi.mock("../services/clientStorage", () => ({
  getClientStoreSync: vi.fn(() => null),
  writeClientStoreValue: vi.fn(),
}));

vi.mock("../services/systemNotification", () => ({
  sendSystemNotification: vi.fn(),
}));

vi.mock("../services/tauri", () => ({
  getWorkspaceFiles: getWorkspaceFilesMock,
}));

function createWorkspace(id: string, name: string): WorkspaceInfo {
  return {
    id,
    name,
    path: `/tmp/${id}`,
    settings: { sidebarCollapsed: false },
    connected: true,
    kind: "main",
  } as unknown as WorkspaceInfo;
}

type SearchRadarOptions = Parameters<typeof useAppShellSearchRadarSection>[0];

function createSearchRadarOptions(
  overrides: Partial<SearchRadarOptions> = {},
): SearchRadarOptions {
  const workspace = createWorkspace("ws-1", "Workspace 1");
  return {
    activeItems: [],
    activeThreadId: null,
    activeWorkspace: workspace,
    activeWorkspaceId: workspace.id,
    appSettings: { systemNotificationEnabled: false } as AppSettings,
    commands: [],
    composerInputRef: { current: null },
    completionTrackerBySessionRef: { current: {} },
    completionTrackerReadyRef: { current: false },
    directories: [],
    filePanelMode: "git",
    fileTreeSourceVersion: "shallow-v1",
    files: ["README.md"],
    getActiveDraft: () => "",
    globalSearchFilesByWorkspace: {},
    handleDraftChange: vi.fn(),
    isCompact: false,
    isFilesLoading: false,
    isProcessing: false,
    isSearchPaletteOpen: true,
    kanbanTasks: [],
    lastAgentMessageByThread: {},
    listThreadsForWorkspace: vi.fn(async () => {}),
    rightPanelCollapsed: false,
    searchContentFilters: ["files"],
    searchPaletteQuery: "nested",
    searchScope: "active-workspace",
    setGlobalSearchFilesByWorkspace: vi.fn(),
    skills: [],
    t: (key: string) => key,
    threadItemsByThread: {},
    threadListLoadingByWorkspace: {},
    threadParentById: {},
    threadStatusById: {},
    threadsByWorkspace: {},
    workspaces: [workspace],
    workspacesById: new Map([[workspace.id, workspace]]),
    ...overrides,
  };
}

describe("useAppShellSearchRadarSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prewarmSessionRadarForWorkspaceMock.mockReset();
    useUnifiedSearchMock.mockClear();
    isBackgroundRenderGatingEnabledMock.mockReset();
    isBackgroundRenderGatingEnabledMock.mockReturnValue(true);
    getWorkspaceFilesMock.mockReset();
    getWorkspaceFilesMock.mockResolvedValue({
      files: [],
      directories: [],
      gitignored_files: [],
      gitignored_directories: [],
      scan_state: "complete",
    });
    readProjectMapRelationshipsMock.mockReset();
    scanProjectMapRelationshipsMock.mockReset();
    readProjectMapRelationshipsMock.mockResolvedValue({ apiContracts: null });
    scanProjectMapRelationshipsMock.mockResolvedValue({});
  });

  it("derives projection owners locally without starting an exhaustive summary scan", () => {
    const main = createWorkspace("ws-main", "Main");
    const worktreeB = {
      ...createWorkspace("ws-worktree-b", "Worktree B"),
      path: "/tmp/z-worktree",
      kind: "worktree" as const,
      parentId: main.id,
    };
    const worktreeA = {
      ...createWorkspace("ws-worktree-a", "Worktree A"),
      path: "/tmp/a-worktree",
      kind: "worktree" as const,
      parentId: main.id,
    };
    const unrelated = createWorkspace("ws-other", "Other");

    renderHook(() =>
      useAppShellSearchRadarSection(
        createSearchRadarOptions({
          activeWorkspace: main,
          activeWorkspaceId: main.id,
          workspaces: [worktreeB, unrelated, main, worktreeA],
          workspacesById: new Map(
            [main, worktreeA, worktreeB, unrelated].map((workspace) => [
              workspace.id,
              workspace,
            ]),
          ),
        }),
      ),
    );

    expect(useWorkspaceSessionProjectionSummaryMock).not.toHaveBeenCalled();
    expect(useWorkspaceThreadListHydrationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeWorkspaceId: main.id,
        activeWorkspaceProjectionOwnerIds: [
          main.id,
          worktreeA.id,
          worktreeB.id,
        ],
      }),
    );
  });

  it("keeps recent thread titles aligned with sidebar thread summaries", () => {
    const workspace = createWorkspace("ws-1", "Workspace 1");
    const appSettings = {
      systemNotificationEnabled: false,
    } as AppSettings;

    const { result } = renderHook(() =>
      useAppShellSearchRadarSection({
        activeItems: [],
        activeThreadId: null,
        activeWorkspace: workspace,
        activeWorkspaceId: "ws-1",
        appSettings,
        commands: [],
        composerInputRef: { current: null },
        completionTrackerBySessionRef: { current: {} },
        completionTrackerReadyRef: { current: false },
        directories: [],
        filePanelMode: "radar",
        files: [],
        getActiveDraft: () => "",
        globalSearchFilesByWorkspace: {},
        handleDraftChange: vi.fn(),
        isCompact: false,
        isFilesLoading: false,
        isProcessing: false,
        isSearchPaletteOpen: false,
        kanbanTasks: [],
        lastAgentMessageByThread: {},
        listThreadsForWorkspace: vi.fn(async () => {}),
        rightPanelCollapsed: false,
        searchContentFilters: [],
        searchPaletteQuery: "",
        searchScope: "active-workspace",
        setGlobalSearchFilesByWorkspace: vi.fn(),
        skills: [],
        t: (key: string) => key,
        threadItemsByThread: {},
        threadListLoadingByWorkspace: {},
        threadParentById: {},
        threadStatusById: {},
        threadsByWorkspace: {
          "ws-1": [
            {
              id: "codex-agent-1",
              name: "项目分析",
              updatedAt: 2_000,
              engineSource: "codex",
              isDegraded: true,
              partialSource: "local-session-scan-unavailable",
              degradedReason: "partial-thread-list",
            },
            {
              id: "codex-agent-2",
              name: "Agent 20",
              updatedAt: 1_000,
              engineSource: "codex",
            },
          ],
        },
        workspaces: [workspace],
        workspacesById: new Map([[workspace.id, workspace]]),
      }),
    );

    expect(result.current.recentThreads).toEqual([
      expect.objectContaining({
        id: "codex-agent-1",
        threadId: "codex-agent-1",
        title: "项目分析",
        updatedAt: 2_000,
      }),
      expect.objectContaining({
        id: "codex-agent-2",
        threadId: "codex-agent-2",
        title: "Agent 20",
        updatedAt: 1_000,
      }),
    ]);
  });

  it("prewarms session radar through the orchestrated hydration path when radar is visible", () => {
    const workspace = createWorkspace("ws-1", "Workspace 1");
    const appSettings = {
      systemNotificationEnabled: false,
    } as AppSettings;

    renderHook(() =>
      useAppShellSearchRadarSection({
        activeItems: [],
        activeThreadId: null,
        activeWorkspace: workspace,
        activeWorkspaceId: "ws-1",
        appSettings,
        commands: [],
        composerInputRef: { current: null },
        completionTrackerBySessionRef: { current: {} },
        completionTrackerReadyRef: { current: false },
        directories: [],
        filePanelMode: "radar",
        files: [],
        getActiveDraft: () => "",
        globalSearchFilesByWorkspace: {},
        handleDraftChange: vi.fn(),
        isCompact: false,
        isFilesLoading: false,
        isProcessing: false,
        isSearchPaletteOpen: false,
        kanbanTasks: [],
        lastAgentMessageByThread: {},
        listThreadsForWorkspace: vi.fn(async () => {}),
        rightPanelCollapsed: false,
        searchContentFilters: [],
        searchPaletteQuery: "",
        searchScope: "active-workspace",
        setGlobalSearchFilesByWorkspace: vi.fn(),
        skills: [],
        t: (key: string) => key,
        threadItemsByThread: {},
        threadListLoadingByWorkspace: {},
        threadParentById: {},
        threadStatusById: {},
        threadsByWorkspace: {},
        workspaces: [workspace],
        workspacesById: new Map([[workspace.id, workspace]]),
      }),
    );

    expect(prewarmSessionRadarForWorkspaceMock).toHaveBeenCalledWith("ws-1");
  });

  it("does not feed hot thread items into search while the palette is closed", () => {
    const workspace = createWorkspace("ws-1", "Workspace 1");
    const appSettings = {
      systemNotificationEnabled: false,
    } as AppSettings;

    renderHook(() =>
      useAppShellSearchRadarSection({
        activeItems: [],
        activeThreadId: "thread-1",
        activeWorkspace: workspace,
        activeWorkspaceId: "ws-1",
        appSettings,
        commands: [],
        composerInputRef: { current: null },
        completionTrackerBySessionRef: { current: {} },
        completionTrackerReadyRef: { current: false },
        directories: [],
        filePanelMode: "git",
        files: [],
        getActiveDraft: () => "",
        globalSearchFilesByWorkspace: {},
        handleDraftChange: vi.fn(),
        isCompact: false,
        isFilesLoading: false,
        isProcessing: true,
        isSearchPaletteOpen: false,
        kanbanTasks: [],
        lastAgentMessageByThread: {},
        listThreadsForWorkspace: vi.fn(async () => {}),
        rightPanelCollapsed: false,
        searchContentFilters: [],
        searchPaletteQuery: "",
        searchScope: "active-workspace",
        setGlobalSearchFilesByWorkspace: vi.fn(),
        skills: [],
        t: (key: string) => key,
        threadItemsByThread: {
          "thread-1": [
            {
              id: "item-1",
              kind: "message",
              role: "assistant",
              text: "streaming output",
            },
          ],
        },
        threadListLoadingByWorkspace: {},
        threadParentById: {},
        threadStatusById: {
          "thread-1": {
            isProcessing: true,
          },
        },
        threadsByWorkspace: {
          "ws-1": [{ id: "thread-1", name: "Thread", updatedAt: 1 }],
        },
        workspaces: [workspace],
        workspacesById: new Map([[workspace.id, workspace]]),
      }),
    );

    expect(useUnifiedSearchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadItemsByThread: {},
      }),
    );
  });

  it("hydrates nested files for active-workspace search despite a shallow cache", async () => {
    getWorkspaceFilesMock.mockResolvedValue({
      files: ["README.md", "src/deep/NestedTarget.ts"],
      directories: ["src", "src/deep"],
      gitignored_files: [],
      gitignored_directories: [],
      scan_state: "complete",
      sourceVersion: "full-v2",
    });
    const baseOptions = createSearchRadarOptions();

    const { result } = renderHook(() => {
      const [cache, setCache] = useState<
        Record<string, WorkspaceSearchFileSnapshot>
      >({
        "ws-1": {
          files: ["README.md"],
          status: "shallow",
          sourceVersion: "shallow-v1",
          error: null,
        },
      });
      const search = useAppShellSearchRadarSection(
        {
          ...baseOptions,
          globalSearchFilesByWorkspace: cache,
          setGlobalSearchFilesByWorkspace: setCache,
        },
      );
      return { cache, search };
    });

    await waitFor(() => {
      expect(result.current.cache["ws-1"]).toMatchObject({
        status: "complete",
        sourceVersion: "full-v2",
        files: ["README.md", "src/deep/NestedTarget.ts"],
      });
    });
    expect(getWorkspaceFilesMock).toHaveBeenCalledTimes(1);
    expect(useUnifiedSearchMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        workspaceSources: [
          expect.objectContaining({
            workspaceId: "ws-1",
            files: ["README.md", "src/deep/NestedTarget.ts"],
          }),
        ],
      }),
    );
    expect(result.current.search.searchFileHydrationStatus).toBe("complete");
  });

  it("does not treat a shallow global cache key as fully hydrated", async () => {
    const workspace2 = createWorkspace("ws-2", "Workspace 2");
    getWorkspaceFilesMock.mockImplementation(async (workspaceId: string) => ({
      files: [`src/${workspaceId}-target.ts`],
      directories: ["src"],
      gitignored_files: [],
      gitignored_directories: [],
      scan_state: workspaceId === "ws-2" ? "partial" : "complete",
      limit_hit: workspaceId === "ws-2",
    }));
    const workspace1 = createWorkspace("ws-1", "Workspace 1");
    const baseOptions = createSearchRadarOptions({
      activeWorkspace: workspace1,
      searchScope: "global",
      workspaces: [workspace1, workspace2],
      workspacesById: new Map([
        ["ws-1", workspace1],
        ["ws-2", workspace2],
      ]),
    });

    const { result } = renderHook(() => {
      const [cache, setCache] = useState<
        Record<string, WorkspaceSearchFileSnapshot>
      >({
        "ws-1": {
          files: [],
          status: "shallow",
          sourceVersion: null,
          error: null,
        },
      });
      const search = useAppShellSearchRadarSection(
        {
          ...baseOptions,
          globalSearchFilesByWorkspace: cache,
          setGlobalSearchFilesByWorkspace: setCache,
        },
      );
      return { cache, search };
    });

    await waitFor(() => {
      expect(result.current.cache["ws-1"]?.status).toBe("complete");
      expect(result.current.cache["ws-2"]?.status).toBe("partial");
    });
    expect(getWorkspaceFilesMock.mock.calls.map(([workspaceId]) => workspaceId)).toEqual([
      "ws-1",
      "ws-2",
    ]);
    expect(result.current.search.searchFileHydrationStatus).toBe("partial");
  });

  it("keeps failed hydration retryable on the next palette lifecycle", async () => {
    getWorkspaceFilesMock
      .mockRejectedValueOnce(new Error("scan failed"))
      .mockResolvedValueOnce({
        files: ["src/recovered.ts"],
        directories: ["src"],
        gitignored_files: [],
        gitignored_directories: [],
        scan_state: "complete",
      });
    const baseOptions = createSearchRadarOptions();

    const { result, rerender } = renderHook(
      ({ isOpen }) => {
        const [cache, setCache] = useState<
          Record<string, WorkspaceSearchFileSnapshot>
        >({});
        const search = useAppShellSearchRadarSection(
          {
            ...baseOptions,
            globalSearchFilesByWorkspace: cache,
            isSearchPaletteOpen: isOpen,
            setGlobalSearchFilesByWorkspace: setCache,
          },
        );
        return { cache, search };
      },
      { initialProps: { isOpen: true } },
    );

    await waitFor(() => {
      expect(result.current.cache["ws-1"]?.status).toBe("error");
    });
    rerender({ isOpen: false });
    rerender({ isOpen: true });
    await waitFor(() => {
      expect(result.current.cache["ws-1"]?.status).toBe("complete");
    });
    expect(getWorkspaceFilesMock).toHaveBeenCalledTimes(2);
  });

  it("scans disk when the API cache is missing and then publishes endpoints", async () => {
    const apiEndpoint = {
      id: "http:get:/users",
      protocol: "http",
      language: "java",
      method: "GET",
      path: "/users",
      sourceFile: "src/UserController.java",
      parameters: [],
      responses: [],
      groupIds: [],
      callChainIds: [],
      confidence: "high",
      evidence: [],
    };
    readProjectMapRelationshipsMock
      .mockResolvedValueOnce({ apiContracts: null })
      .mockResolvedValueOnce({
        apiContracts: { endpoints: [apiEndpoint] },
        staleSummary: { isFresh: true },
      });
    const options = createSearchRadarOptions({
      searchContentFilters: ["apis"],
      searchPaletteQuery: "/users",
    });

    const { result } = renderHook(() =>
      useAppShellSearchRadarSection(options),
    );

    expect(result.current.searchApiHydrationStatus).toBe("loading");
    await waitFor(() => {
      expect(result.current.searchApiHydrationStatus).toBe("complete");
    });
    expect(scanProjectMapRelationshipsMock).toHaveBeenCalledWith({
      workspaceId: "ws-1",
    });
    expect(useUnifiedSearchMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        apiSources: [
          expect.objectContaining({
            workspaceId: "ws-1",
            endpoints: [apiEndpoint],
          }),
        ],
      }),
    );
  });

  it("uses a fresh API cache without scanning disk", async () => {
    const apiEndpoint = {
      id: "cached-endpoint",
      protocol: "graphql",
      language: "typescript",
      operationName: "cachedQuery",
      sourceFile: "src/schema.ts",
      parameters: [],
      responses: [],
      groupIds: [],
      callChainIds: [],
      confidence: "high",
      evidence: [],
    };
    readProjectMapRelationshipsMock.mockResolvedValue({
      apiContracts: { endpoints: [apiEndpoint] },
      staleSummary: { isFresh: true },
    });

    const options = createSearchRadarOptions({
      searchContentFilters: ["apis"],
      searchPaletteQuery: "cachedQuery",
    });
    const { result } = renderHook(() =>
      useAppShellSearchRadarSection(options),
    );

    await waitFor(() => {
      expect(result.current.searchApiHydrationStatus).toBe("complete");
    });
    expect(scanProjectMapRelationshipsMock).not.toHaveBeenCalled();
  });

  it("keeps stale API endpoints searchable while refreshing them", async () => {
    const staleEndpoint = {
      id: "stale-endpoint",
      protocol: "http",
      language: "java",
      method: "GET",
      path: "/stale",
      sourceFile: "src/StaleController.java",
      parameters: [],
      responses: [],
      groupIds: [],
      callChainIds: [],
      confidence: "medium",
      evidence: [],
    };
    const freshEndpoint = { ...staleEndpoint, id: "fresh-endpoint", path: "/fresh" };
    let resolveScan: (() => void) | undefined;
    scanProjectMapRelationshipsMock.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveScan = resolve;
      }),
    );
    readProjectMapRelationshipsMock
      .mockResolvedValueOnce({
        apiContracts: { endpoints: [staleEndpoint] },
        staleSummary: { isFresh: false },
      })
      .mockResolvedValueOnce({
        apiContracts: { endpoints: [freshEndpoint] },
        staleSummary: { isFresh: true },
      });

    const options = createSearchRadarOptions({
      searchContentFilters: ["apis"],
      searchPaletteQuery: "/stale",
    });
    const { result } = renderHook(() =>
      useAppShellSearchRadarSection(options),
    );

    await waitFor(() => {
      expect(useUnifiedSearchMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          apiSources: [
            expect.objectContaining({ endpoints: [staleEndpoint] }),
          ],
        }),
      );
    });
    expect(result.current.searchApiHydrationStatus).toBe("refreshing");
    resolveScan?.();
    await waitFor(() => {
      expect(result.current.searchApiHydrationStatus).toBe("complete");
      expect(useUnifiedSearchMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          apiSources: [
            expect.objectContaining({ endpoints: [freshEndpoint] }),
          ],
        }),
      );
    });
  });

  it("reuses an in-flight API scan after the palette closes and reopens", async () => {
    const refreshedEndpoint = {
      id: "refreshed-endpoint",
      protocol: "http",
      language: "java",
      method: "DELETE",
      path: "/api/web/bs-cs/v1/faq/{id}",
      sourceFile: "src/FaqController.java",
      parameters: [],
      responses: [],
      groupIds: [],
      callChainIds: [],
      confidence: "high",
      evidence: [],
    };
    let resolveScan: (() => void) | undefined;
    scanProjectMapRelationshipsMock.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveScan = resolve;
      }),
    );
    readProjectMapRelationshipsMock
      .mockResolvedValueOnce({ apiContracts: null })
      .mockResolvedValueOnce({ apiContracts: null })
      .mockResolvedValueOnce({
        apiContracts: { endpoints: [refreshedEndpoint] },
        staleSummary: { isFresh: true },
      });
    const options = createSearchRadarOptions({
      searchContentFilters: ["apis"],
      searchPaletteQuery: "/api/web/bs-cs/v1/faq",
    });
    const { result, rerender } = renderHook(
      ({ isOpen }) =>
        useAppShellSearchRadarSection({
          ...options,
          isSearchPaletteOpen: isOpen,
        }),
      { initialProps: { isOpen: true } },
    );

    await waitFor(() => {
      expect(scanProjectMapRelationshipsMock).toHaveBeenCalledTimes(1);
    });
    rerender({ isOpen: false });
    rerender({ isOpen: true });
    await waitFor(() => {
      expect(readProjectMapRelationshipsMock).toHaveBeenCalledTimes(2);
    });
    expect(scanProjectMapRelationshipsMock).toHaveBeenCalledTimes(1);

    resolveScan?.();
    await waitFor(() => {
      expect(result.current.searchApiHydrationStatus).toBe("complete");
      expect(useUnifiedSearchMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          apiSources: [
            expect.objectContaining({ endpoints: [refreshedEndpoint] }),
          ],
        }),
      );
    });
  });

  it("does not block global API search when one workspace already has cached endpoints", async () => {
    const cachedEndpoint = {
      id: "cached-product-endpoint",
      protocol: "http",
      language: "java",
      method: "POST",
      path: "/api/mobile/pd-sub/v1/plan/product/page",
      sourceFile: "src/ProductController.java",
      parameters: [],
      responses: [],
      groupIds: [],
      callChainIds: [],
      confidence: "high",
      evidence: [],
    };
    readProjectMapRelationshipsMock
      .mockResolvedValueOnce({
        apiContracts: { endpoints: [cachedEndpoint] },
        staleSummary: { isFresh: false },
      })
      .mockResolvedValueOnce({ apiContracts: null });
    scanProjectMapRelationshipsMock.mockImplementation(
      () => new Promise<void>(() => undefined),
    );
    const options = createSearchRadarOptions({
      workspaces: [
        createWorkspace("ws-1", "mall-v2"),
        createWorkspace("ws-2", "other"),
      ],
      searchScope: "global",
      searchContentFilters: ["apis"],
      searchPaletteQuery: "/api/mobile/pd-sub/v1/plan/product",
    });

    const { result } = renderHook(() =>
      useAppShellSearchRadarSection(options),
    );

    await waitFor(() => {
      expect(result.current.searchApiHydrationStatus).toBe("refreshing");
      expect(useUnifiedSearchMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          apiSources: expect.arrayContaining([
            expect.objectContaining({
              workspaceId: "ws-1",
              endpoints: [cachedEndpoint],
            }),
          ]),
        }),
      );
    });
  });

  it("exposes API scan errors without starting file hydration", async () => {
    readProjectMapRelationshipsMock.mockResolvedValue({ apiContracts: null });
    scanProjectMapRelationshipsMock.mockRejectedValue(new Error("API scan failed"));

    const options = createSearchRadarOptions({
      searchContentFilters: ["apis"],
      searchPaletteQuery: "/users",
    });
    const { result } = renderHook(() =>
      useAppShellSearchRadarSection(options),
    );

    await waitFor(() => {
      expect(result.current.searchApiHydrationStatus).toBe("error");
    });
    expect(getWorkspaceFilesMock).not.toHaveBeenCalled();
  });

  it("persists a bounded completion entry when a session finishes", () => {
    const baseOptions = createSearchRadarOptions({
      threadsByWorkspace: {
        "ws-1": [
          { id: "thread-1", name: "Finished Thread", updatedAt: 1000, engineSource: "codex" },
        ],
      },
    });

    const { rerender } = renderHook(
      ({ isProcessingNow }: { isProcessingNow: boolean }) =>
        useAppShellSearchRadarSection({
          ...baseOptions,
          threadStatusById: {
            "thread-1": isProcessingNow
              ? { isProcessing: true }
              : { isProcessing: false, lastDurationMs: 1200 },
          },
        }),
      { initialProps: { isProcessingNow: true } },
    );

    rerender({ isProcessingNow: false });

    const recentWrites = vi
      .mocked(writeClientStoreValue)
      .mock.calls.filter(
        ([store, key]) => store === RADAR_STORE_NAME && key === SESSION_RADAR_RECENT_STORAGE_KEY,
      );
    expect(recentWrites).toHaveLength(1);
    expect(recentWrites[0]?.[2]).toEqual([
      expect.objectContaining({
        id: "ws-1:thread-1",
        workspaceId: "ws-1",
        threadId: "thread-1",
        durationMs: 1200,
      }),
    ]);
  });

  it("clamps the persisted startedAt to zero when duration exceeds completedAt", () => {
    const baseOptions = createSearchRadarOptions({
      threadsByWorkspace: {
        "ws-1": [
          { id: "thread-1", name: "Finished Thread", updatedAt: 1000, engineSource: "codex" },
        ],
      },
    });

    const { rerender } = renderHook(
      ({ isProcessingNow }: { isProcessingNow: boolean }) =>
        useAppShellSearchRadarSection({
          ...baseOptions,
          threadStatusById: {
            "thread-1": isProcessingNow
              ? { isProcessing: true }
              : // durationMs 远超 completedAt：startedAt = max(0, completedAt - durationMs) 钳到 0。
                { isProcessing: false, lastDurationMs: Number.MAX_SAFE_INTEGER },
          },
        }),
      { initialProps: { isProcessingNow: true } },
    );

    rerender({ isProcessingNow: false });

    const recentWrites = vi
      .mocked(writeClientStoreValue)
      .mock.calls.filter(
        ([store, key]) => store === RADAR_STORE_NAME && key === SESSION_RADAR_RECENT_STORAGE_KEY,
      );
    expect(recentWrites).toHaveLength(1);
    expect(recentWrites[0]?.[2]).toEqual([
      expect.objectContaining({
        id: "ws-1:thread-1",
        startedAt: 0,
        durationMs: Number.MAX_SAFE_INTEGER,
      }),
    ]);
  });

  it("cleans dismissed records for entries pruned by persistence bounds on completion merge", () => {
    const now = Date.now();
    const oversizedRecent = Array.from({ length: 201 }, (_, index) => ({
      id: `ws-old-${index}:t-1`,
      workspaceId: `ws-old-${index}`,
      threadId: "t-1",
      completedAt: now - (index + 1) * 1000,
      updatedAt: now - (index + 1) * 1000,
      startedAt: null,
      durationMs: null,
    }));
    vi.mocked(getClientStoreSync).mockImplementation(((_store: string, key: string) => {
      if (key === SESSION_RADAR_RECENT_STORAGE_KEY) {
        return oversizedRecent;
      }
      if (key === SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY) {
        return { "ws-old-200:t-1": now - 201_000 };
      }
      return null;
    }) as typeof getClientStoreSync);

    const baseOptions = createSearchRadarOptions({
      threadsByWorkspace: {
        "ws-1": [
          { id: "thread-1", name: "Finished Thread", updatedAt: now, engineSource: "codex" },
        ],
      },
    });

    const { rerender } = renderHook(
      ({ isProcessingNow }: { isProcessingNow: boolean }) =>
        useAppShellSearchRadarSection({
          ...baseOptions,
          threadStatusById: {
            "thread-1": isProcessingNow
              ? { isProcessing: true }
              : { isProcessing: false, lastDurationMs: 1200 },
          },
        }),
      { initialProps: { isProcessingNow: true } },
    );

    rerender({ isProcessingNow: false });

    const recentWrite = vi
      .mocked(writeClientStoreValue)
      .mock.calls.find(
        ([store, key]) => store === RADAR_STORE_NAME && key === SESSION_RADAR_RECENT_STORAGE_KEY,
      );
    expect(recentWrite?.[2]).toHaveLength(200);

    const dismissedWrite = vi
      .mocked(writeClientStoreValue)
      .mock.calls.find(
        ([store, key]) =>
          store === RADAR_STORE_NAME && key === SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY,
      );
    expect(dismissedWrite?.[2]).toEqual({});
  });
});
