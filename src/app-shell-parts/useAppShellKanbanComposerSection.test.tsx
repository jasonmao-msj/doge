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

    expect(context.setActiveEngine).toHaveBeenCalledWith("codex");
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
});
