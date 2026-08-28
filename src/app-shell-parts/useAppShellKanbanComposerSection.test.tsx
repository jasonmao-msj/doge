/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MessageSendOptions, WorkspaceInfo } from "../types";
import { useAppShellKanbanComposerSection } from "./useAppShellKanbanComposerSection";

function createContext(overrides: Record<string, unknown> = {}) {
  const workspace: WorkspaceInfo = {
    id: "workspace-1",
    name: "Workspace",
    path: "/tmp/workspace",
    connected: true,
    settings: {
      sidebarCollapsed: false,
    },
  };
  return {
    activeWorkspace: workspace,
    workspaces: [workspace],
    kanbanPanels: [],
    setKanbanViewState: vi.fn(),
    setAppMode: vi.fn(),
    activeEngine: "claude",
    selectedAgent: null,
    selectedAgentRef: { current: null },
    activeWorkspaceId: workspace.id,
    activeThreadId: null,
    normalizePath: (value: string) => value,
    addWorkspaceFromPath: vi.fn(),
    alertError: vi.fn(),
    workspacesById: new Map([[workspace.id, workspace]]),
    exitDiffView: vi.fn(),
    connectWorkspace: vi.fn(),
    startThreadForWorkspace: vi.fn().mockResolvedValue("thread-created"),
    persistComposerSelectionForThread: vi.fn(),
    setActiveEngine: vi.fn().mockResolvedValue(undefined),
    setHomeOpen: vi.fn(),
    setCenterMode: vi.fn(),
    selectWorkspace: vi.fn(),
    setActiveThreadId: vi.fn(),
    sendUserMessageToThread: vi.fn().mockResolvedValue(undefined),
    handleComposerSend: vi.fn(),
    isPullRequestComposer: false,
    resetPullRequestSelection: vi.fn(),
    threadsByWorkspace: { [workspace.id]: [] },
    addDebugEntry: vi.fn(),
    effectiveSelectedModelId: "fallback-model",
    kanbanCreateTask: vi.fn(),
    kanbanUpdateTask: vi.fn(),
    forkThreadForWorkspace: vi.fn(),
    setWorkspaceHomeWorkspaceId: vi.fn(),
    handleComposerQueue: vi.fn(),
    ...overrides,
  };
}

describe("useAppShellKanbanComposerSection Home target creation", () => {
  it("creates and sends with one selected Engine/Provider/Model target", async () => {
    const context = createContext();
    const { result } = renderHook(() =>
      useAppShellKanbanComposerSection(context as never),
    );
    const options: MessageSendOptions = {
      selectedMemoryIds: ["memory-1"],
      createSessionTarget: {
        engine: "codex",
        providerProfileId: "provider-b",
        providerProfileName: "Provider B",
        providerProfileSource: "managed",
        modelCatalogEntryId: "catalog-model",
        model: "runtime-model",
        effort: "high",
      },
    };

    await act(async () => {
      await result.current.handleComposerSendWithEditorFallback(
        "hello",
        [],
        options,
      );
    });

    expect(context.setActiveEngine).toHaveBeenCalledWith("codex", {
      ensureRuntime: true,
      providerProfileId: "provider-b",
    });
    expect(context.startThreadForWorkspace).toHaveBeenCalledWith(
      "workspace-1",
      {
        engine: "codex",
        activate: true,
        providerProfileId: "provider-b",
        providerProfile: {
          id: "provider-b",
          name: "Provider B",
          source: "managed",
        },
      },
    );
    expect(context.persistComposerSelectionForThread).toHaveBeenCalledWith(
      "workspace-1",
      "thread-created",
      {
        modelId: "catalog-model",
        effort: "high",
      },
    );
    expect(context.sendUserMessageToThread).toHaveBeenCalledWith(
      context.activeWorkspace,
      "thread-created",
      "hello",
      [],
      expect.objectContaining({
        selectedMemoryIds: ["memory-1"],
        model: "runtime-model",
        effort: "high",
      }),
    );
    const forwardedOptions = vi.mocked(context.sendUserMessageToThread).mock
      .calls[0]?.[4] as MessageSendOptions;
    expect(forwardedOptions.createSessionTarget).toEqual(
      options.createSessionTarget,
    );
  });

  it("does not create a session when target engine activation fails", async () => {
    const context = createContext({
      setActiveEngine: vi.fn().mockResolvedValue(false),
    });
    const { result } = renderHook(() =>
      useAppShellKanbanComposerSection(context as never),
    );

    await act(async () => {
      await result.current.handleComposerSendWithEditorFallback("hello", [], {
        createSessionTarget: {
          engine: "codex",
          providerProfileId: "doge-token-matrix",
          providerProfileName: "Doge",
          providerProfileSource: "managed",
          modelCatalogEntryId: "catalog-model",
          model: "runtime-model",
          effort: "high",
        },
      });
    });

    expect(context.setActiveEngine).toHaveBeenCalledWith("codex", {
      ensureRuntime: true,
      providerProfileId: "doge-token-matrix",
    });
    expect(context.startThreadForWorkspace).not.toHaveBeenCalled();
  });

  it("creates a Kimi target without requiring native active-engine confirmation", async () => {
    const context = createContext({
      setActiveEngine: vi.fn().mockResolvedValue(false),
    });
    const { result } = renderHook(() =>
      useAppShellKanbanComposerSection(context as never),
    );

    await act(async () => {
      await result.current.handleComposerSendWithEditorFallback("hello", [], {
        createSessionTarget: {
          engine: "kimi",
          providerProfileId: "provider-kimi",
          providerProfileName: "Kimi",
          providerProfileSource: "managed",
          modelCatalogEntryId: "kimi-k2",
          model: "kimi-k2",
          effort: null,
        },
      });
    });

    expect(context.setActiveEngine).toHaveBeenCalledWith("kimi", {
      providerProfileId: "provider-kimi",
    });
    expect(context.startThreadForWorkspace).toHaveBeenCalledWith(
      "workspace-1",
      {
        engine: "kimi",
        activate: true,
        providerProfileId: "provider-kimi",
        providerProfile: {
          id: "provider-kimi",
          name: "Kimi",
          source: "managed",
        },
      },
    );
    expect(context.sendUserMessageToThread).toHaveBeenCalled();
  });
});

describe("useAppShellKanbanComposerSection kanban engine routing", () => {
  it.each(["kimi", "grok"] as const)(
    "routes &@ kanban task thread creation to the selected %s engine",
    async (engine) => {
      const context = createContext({
        activeEngine: engine,
        kanbanPanels: [
          {
            id: "panel-1",
            name: "Backlog",
            workspaceId: "/tmp/workspace",
            createdAt: 1,
            sortOrder: 0,
          },
        ],
        kanbanCreateTask: vi.fn().mockReturnValue({ id: "task-1" }),
      });
      const { result } = renderHook(() =>
        useAppShellKanbanComposerSection(context as never),
      );

      await act(async () => {
        await result.current.handleComposerSendWithEditorFallback(
          "&@Backlog do something",
          [],
        );
      });

      expect(context.startThreadForWorkspace).toHaveBeenCalledWith(
        "workspace-1",
        {
          engine,
          activate: false,
        },
      );
      expect(context.kanbanCreateTask).toHaveBeenCalledWith(
        expect.objectContaining({ engineType: engine }),
      );
    },
  );

  it("falls back to claude when no engine is selected for kanban sends", async () => {
    const context = createContext({
      activeEngine: null,
      kanbanPanels: [
        {
          id: "panel-1",
          name: "Backlog",
          workspaceId: "/tmp/workspace",
          createdAt: 1,
          sortOrder: 0,
        },
      ],
      kanbanCreateTask: vi.fn().mockReturnValue({ id: "task-1" }),
    });
    const { result } = renderHook(() =>
      useAppShellKanbanComposerSection(context as never),
    );

    await act(async () => {
      await result.current.handleComposerSendWithEditorFallback(
        "&@Backlog do something",
        [],
      );
    });

    expect(context.startThreadForWorkspace).toHaveBeenCalledWith(
      "workspace-1",
      {
        engine: "claude",
        activate: false,
      },
    );
  });
});
