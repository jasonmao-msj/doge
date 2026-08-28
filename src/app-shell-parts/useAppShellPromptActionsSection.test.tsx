/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkspaceInfo } from "../types";
import { useAppShellPromptActionsSection } from "./useAppShellPromptActionsSection";

vi.mock("../services/tauri", () => ({
  revealInFileManager: vi.fn(),
}));

function createContext(overrides: Record<string, unknown> = {}) {
  const workspace: WorkspaceInfo = {
    id: "ws-id",
    name: "Workspace",
    path: "/tmp/workspace",
    connected: true,
    settings: {
      sidebarCollapsed: false,
    },
  };
  return {
    activeEngine: null,
    activeWorkspace: workspace,
    alertError: vi.fn(),
    connectWorkspace: vi.fn().mockResolvedValue(undefined),
    createPrompt: vi.fn().mockResolvedValue(undefined),
    deletePrompt: vi.fn().mockResolvedValue(undefined),
    getGlobalPromptsDir: vi.fn().mockResolvedValue(null),
    getWorkspacePromptsDir: vi.fn().mockResolvedValue("/tmp/workspace/prompts"),
    movePrompt: vi.fn().mockResolvedValue(undefined),
    sendUserMessageToThread: vi.fn().mockResolvedValue(undefined),
    startThreadForWorkspace: vi.fn().mockResolvedValue("thread-1"),
    updatePrompt: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("useAppShellPromptActionsSection engine routing", () => {
  it("passes the selected engine to startThreadForWorkspace", async () => {
    const context = createContext({ activeEngine: "kimi" });
    const { result } = renderHook(() =>
      useAppShellPromptActionsSection(context as never),
    );

    await act(async () => {
      await result.current.handleSendPromptToNewAgent("hello");
    });

    expect(context.startThreadForWorkspace).toHaveBeenCalledWith("ws-id", {
      activate: false,
      engine: "kimi",
    });
    expect(context.sendUserMessageToThread).toHaveBeenCalledWith(
      context.activeWorkspace,
      "thread-1",
      "hello",
      [],
    );
  });

  it("falls back to the default engine when no engine is selected", async () => {
    const context = createContext({ activeEngine: null });
    const { result } = renderHook(() =>
      useAppShellPromptActionsSection(context as never),
    );

    await act(async () => {
      await result.current.handleSendPromptToNewAgent("hello");
    });

    expect(context.startThreadForWorkspace).toHaveBeenCalledWith("ws-id", {
      activate: false,
      engine: "codex",
    });
  });
});
