// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSelectedComposerSession } from "./useSelectedComposerSession";

type Store = Record<string, unknown>;

const { composerStore, getClientStoreSync, writeClientStoreValue } = vi.hoisted(() => {
  const composerStore: Store = {};
  return {
    composerStore,
    getClientStoreSync: vi.fn((store: string, key: string) => {
      if (store !== "composer") {
        return undefined;
      }
      return composerStore[key];
    }),
    writeClientStoreValue: vi.fn((store: string, key: string, value: unknown) => {
      if (store === "composer") {
        composerStore[key] = value;
      }
    }),
  };
});

vi.mock("../services/clientStorage", () => ({
  getClientStoreSync,
  writeClientStoreValue,
}));

describe("useSelectedComposerSession", () => {
  beforeEach(() => {
    Object.keys(composerStore).forEach((key) => delete composerStore[key]);
    getClientStoreSync.mockClear();
    writeClientStoreValue.mockClear();
  });

  it("applies a draft selection to a pending thread and migrates it to the finalized thread", async () => {
    type HookProps = {
      activeWorkspaceId: string | null;
      activeThreadId: string | null;
      resolveCanonicalThreadId: (threadId: string) => string;
    };

    const initialProps: HookProps = {
      activeWorkspaceId: "ws-a",
      activeThreadId: null,
      resolveCanonicalThreadId: (threadId: string) => threadId,
    };

    const { result, rerender } = renderHook(
      ({ activeWorkspaceId, activeThreadId, resolveCanonicalThreadId }: HookProps) =>
        useSelectedComposerSession({
          activeWorkspaceId,
          activeThreadId,
          resolveCanonicalThreadId,
        }),
      {
        initialProps,
      },
    );

    act(() => {
      result.current.handleSelectComposerSelection({
        modelId: "gpt-5.4",
        effort: "high",
      });
    });

    expect(result.current.selectedComposerSelection).toEqual({
      modelId: "gpt-5.4",
      effort: "high",
    });
    expect(writeClientStoreValue).not.toHaveBeenCalled();

    rerender({
      activeWorkspaceId: "ws-a",
      activeThreadId: "codex-pending-1",
      resolveCanonicalThreadId: (threadId: string) => threadId,
    });

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "gpt-5.4",
        effort: "high",
      });
    });
    expect(writeClientStoreValue).toHaveBeenCalledWith(
      "composer",
      "selectedModelByThread.ws-a:codex-pending-1",
      { modelId: "gpt-5.4", effort: "high" },
    );

    rerender({
      activeWorkspaceId: "ws-a",
      activeThreadId: "codex:session-1",
      resolveCanonicalThreadId: (threadId: string) =>
        threadId === "codex-pending-1" ? "codex:session-1" : threadId,
    });

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "gpt-5.4",
        effort: "high",
      });
    });
    expect(writeClientStoreValue).toHaveBeenCalledWith(
      "composer",
      "selectedModelByThread.ws-a:codex:session-1",
      { modelId: "gpt-5.4", effort: "high" },
    );
  });

  it("does not repeat the same pending-to-finalized migration after the migration state update", async () => {
    type HookProps = {
      activeWorkspaceId: string | null;
      activeThreadId: string | null;
      resolveCanonicalThreadId: (threadId: string) => string;
    };
    const resolveCanonicalThreadId = (threadId: string) =>
      threadId === "codex-pending-1" ? "codex:session-1" : threadId;

    composerStore["selectedModelByThread.ws-a:codex-pending-1"] = {
      modelId: "gpt-5.4",
      effort: "high",
    };

    const { result, rerender } = renderHook(
      ({ activeWorkspaceId, activeThreadId }: HookProps) =>
        useSelectedComposerSession({
          activeWorkspaceId,
          activeThreadId,
          resolveCanonicalThreadId,
        }),
      {
        initialProps: {
          activeWorkspaceId: "ws-a",
          activeThreadId: "codex-pending-1",
          resolveCanonicalThreadId,
        },
      },
    );

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "gpt-5.4",
        effort: "high",
      });
    });
    writeClientStoreValue.mockClear();

    rerender({
      activeWorkspaceId: "ws-a",
      activeThreadId: "codex:session-1",
      resolveCanonicalThreadId,
    });

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "gpt-5.4",
        effort: "high",
      });
    });
    expect(writeClientStoreValue).toHaveBeenCalledTimes(1);
    expect(writeClientStoreValue).toHaveBeenLastCalledWith(
      "composer",
      "selectedModelByThread.ws-a:codex:session-1",
      { modelId: "gpt-5.4", effort: "high" },
    );

    rerender({
      activeWorkspaceId: "ws-a",
      activeThreadId: "codex:session-1",
      resolveCanonicalThreadId,
    });

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "gpt-5.4",
        effort: "high",
      });
    });
    expect(writeClientStoreValue).toHaveBeenCalledTimes(1);
  });

  it("keeps identical thread ids isolated across workspaces", async () => {
    composerStore["selectedModelByThread.ws-a:codex:session-1"] = {
      modelId: "gpt-5.4",
      effort: "high",
    };
    composerStore["selectedModelByThread.ws-b:codex:session-1"] = {
      modelId: "gpt-5.5",
      effort: "medium",
    };

    const { result, rerender } = renderHook(
      ({ activeWorkspaceId }: { activeWorkspaceId: string | null }) =>
        useSelectedComposerSession({
          activeWorkspaceId,
          activeThreadId: "codex:session-1",
          resolveCanonicalThreadId: (threadId: string) => threadId,
        }),
      {
        initialProps: { activeWorkspaceId: "ws-a" },
      },
    );

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "gpt-5.4",
        effort: "high",
      });
    });

    rerender({ activeWorkspaceId: "ws-b" });

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "gpt-5.5",
        effort: "medium",
      });
    });
  });

  it("does not rewrite an equivalent stored thread selection during startup reload", async () => {
    composerStore["selectedModelByThread.ws-a:codex:session-1"] = {
      modelId: "gpt-5.5",
      effort: "medium",
    };

    const { result, rerender } = renderHook(
      ({ activeThreadId }: { activeThreadId: string }) =>
        useSelectedComposerSession({
          activeWorkspaceId: "ws-a",
          activeThreadId,
          resolveCanonicalThreadId: (threadId: string) => threadId,
        }),
      {
        initialProps: { activeThreadId: "codex:session-1" },
      },
    );

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "gpt-5.5",
        effort: "medium",
      });
    });
    expect(writeClientStoreValue).not.toHaveBeenCalled();

    rerender({ activeThreadId: "codex:session-1" });

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "gpt-5.5",
        effort: "medium",
      });
    });
    expect(writeClientStoreValue).not.toHaveBeenCalled();
  });

  it("does not persist an equivalent repaired thread selection twice", async () => {
    composerStore["selectedModelByThread.ws-a:codex:session-1"] = {
      modelId: "gpt-5.5",
      effort: "medium",
    };

    const { result } = renderHook(() =>
      useSelectedComposerSession({
        activeWorkspaceId: "ws-a",
        activeThreadId: "codex:session-1",
        resolveCanonicalThreadId: (threadId: string) => threadId,
      }),
    );

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "gpt-5.5",
        effort: "medium",
      });
    });

    act(() => {
      result.current.persistComposerSelectionForThread(
        "ws-a",
        "codex:session-1",
        {
          modelId: "gpt-5.5",
          effort: "medium",
        },
      );
    });

    expect(writeClientStoreValue).not.toHaveBeenCalled();
  });

  it("inherits composer selection from a Claude fork parent thread", async () => {
    composerStore["selectedModelByThread.ws-a:claude:parent-session"] = {
      modelId: "claude-opus-4-1",
      effort: "high",
    };

    const { result } = renderHook(() =>
      useSelectedComposerSession({
        activeWorkspaceId: "ws-a",
        activeThreadId: "claude-fork:parent-session:local-1",
        resolveCanonicalThreadId: (threadId: string) => threadId,
      }),
    );

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "claude-opus-4-1",
        effort: "high",
      });
    });
    expect(writeClientStoreValue).toHaveBeenCalledWith(
      "composer",
      "selectedModelByThread.ws-a:claude-fork:parent-session:local-1",
      { modelId: "claude-opus-4-1", effort: "high" },
    );
  });

  it("seeds a brand-new pending thread from the engine default selection", async () => {
    const { result } = renderHook(() =>
      useSelectedComposerSession({
        activeWorkspaceId: "ws-a",
        activeThreadId: "claude-pending-1",
        resolveCanonicalThreadId: (threadId: string) => threadId,
        resolveEngineDefaultComposerSelection: () => ({
          modelId: "fable-5",
          effort: "high",
        }),
      }),
    );

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "fable-5",
        effort: "high",
      });
    });
    expect(writeClientStoreValue).toHaveBeenCalledWith(
      "composer",
      "selectedModelByThread.ws-a:claude-pending-1",
      { modelId: "fable-5", effort: "high" },
    );
  });

  it("waits for engine defaults to be ready before seeding a pending thread", async () => {
    type HookProps = { engineDefaultSelectionReady: boolean };
    let engineDefaultSelection: { modelId: string; effort: string } | null = null;
    const resolveEngineDefaultComposerSelection = () => engineDefaultSelection;

    const { result, rerender } = renderHook(
      ({ engineDefaultSelectionReady }: HookProps) =>
        useSelectedComposerSession({
          activeWorkspaceId: "ws-a",
          activeThreadId: "claude-pending-late-settings",
          resolveCanonicalThreadId: (threadId: string) => threadId,
          engineDefaultSelectionReady,
          resolveEngineDefaultComposerSelection,
        }),
      {
        initialProps: {
          engineDefaultSelectionReady: false,
        },
      },
    );

    expect(result.current.selectedComposerSelection).toBeNull();
    expect(writeClientStoreValue).not.toHaveBeenCalled();

    engineDefaultSelection = {
      modelId: "fable-5",
      effort: "high",
    };
    rerender({ engineDefaultSelectionReady: true });

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "fable-5",
        effort: "high",
      });
    });
    expect(writeClientStoreValue).toHaveBeenCalledWith(
      "composer",
      "selectedModelByThread.ws-a:claude-pending-late-settings",
      { modelId: "fable-5", effort: "high" },
    );
  });

  it("keeps selection continuous when readiness and pending finalization overlap", async () => {
    type HookProps = {
      activeThreadId: string;
      engineDefaultSelectionReady: boolean;
    };
    const pendingThreadId = "claude-pending-startup";
    const canonicalThreadId = "claude:startup-session";
    const observedSelections: Array<string | null> = [];
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    );
    const resolveCanonicalThreadId = (threadId: string) =>
      threadId === pendingThreadId ? canonicalThreadId : threadId;

    const { result, rerender } = renderHook(
      ({ activeThreadId, engineDefaultSelectionReady }: HookProps) => {
        const session = useSelectedComposerSession({
          activeWorkspaceId: "ws-a",
          activeThreadId,
          resolveCanonicalThreadId,
          engineDefaultSelectionReady,
          resolveEngineDefaultComposerSelection: () => ({
            modelId: "fable-5",
            effort: "high",
          }),
        });
        observedSelections.push(session.selectedComposerSelection?.modelId ?? null);
        return session;
      },
      {
        initialProps: {
          activeThreadId: pendingThreadId,
          engineDefaultSelectionReady: false,
        },
        wrapper,
      },
    );

    rerender({
      activeThreadId: pendingThreadId,
      engineDefaultSelectionReady: true,
    });
    await waitFor(() => {
      expect(result.current.selectedComposerSelection?.modelId).toBe("fable-5");
    });

    observedSelections.length = 0;
    writeClientStoreValue.mockClear();
    rerender({
      activeThreadId: canonicalThreadId,
      engineDefaultSelectionReady: true,
    });

    await waitFor(() => {
      expect(result.current.selectedComposerSelection?.modelId).toBe("fable-5");
    });
    expect(observedSelections).not.toContain(null);
    expect(observedSelections.length).toBeLessThanOrEqual(6);
    expect(
      result.current.resolveComposerSelectionForThread("ws-a", canonicalThreadId),
    ).toEqual({ modelId: "fable-5", effort: "high" });
    expect(writeClientStoreValue).toHaveBeenCalledTimes(1);
    expect(writeClientStoreValue).toHaveBeenCalledWith(
      "composer",
      `selectedModelByThread.ws-a:${canonicalThreadId}`,
      { modelId: "fable-5", effort: "high" },
    );
  });

  it("does not override a thread's own stored selection with the engine default", async () => {
    composerStore["selectedModelByThread.ws-a:claude-pending-2"] = {
      modelId: "claude-opus-4-8",
      effort: "medium",
    };

    const { result } = renderHook(() =>
      useSelectedComposerSession({
        activeWorkspaceId: "ws-a",
        activeThreadId: "claude-pending-2",
        resolveCanonicalThreadId: (threadId: string) => threadId,
        resolveEngineDefaultComposerSelection: () => ({
          modelId: "fable-5",
          effort: "high",
        }),
      }),
    );

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "claude-opus-4-8",
        effort: "medium",
      });
    });
  });

  it("does not seed an already-finalized thread from the engine default", async () => {
    const { result } = renderHook(() =>
      useSelectedComposerSession({
        activeWorkspaceId: "ws-a",
        activeThreadId: "claude:session-9",
        resolveCanonicalThreadId: (threadId: string) => threadId,
        resolveEngineDefaultComposerSelection: () => ({
          modelId: "fable-5",
          effort: "high",
        }),
      }),
    );

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toBeNull();
    });
    expect(writeClientStoreValue).not.toHaveBeenCalled();
  });

  it("drops stale stored effort for unsupported thread engines", async () => {
    composerStore["selectedModelByThread.ws-a:gemini:session-1"] = {
      modelId: "gemini-2.5-pro",
      effort: "high",
    };

    const { result } = renderHook(() =>
      useSelectedComposerSession({
        activeWorkspaceId: "ws-a",
        activeThreadId: "gemini:session-1",
        resolveCanonicalThreadId: (threadId: string) => threadId,
      }),
    );

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "gemini-2.5-pro",
        effort: null,
      });
    });
  });

  it("persists draft selections without unsupported engine effort", async () => {
    type HookProps = {
      activeThreadId: string | null;
    };
    const initialProps: HookProps = { activeThreadId: null };

    const { result, rerender } = renderHook(
      ({ activeThreadId }: HookProps) =>
        useSelectedComposerSession({
          activeWorkspaceId: "ws-a",
          activeThreadId,
          resolveCanonicalThreadId: (threadId: string) => threadId,
        }),
      {
        initialProps,
      },
    );

    act(() => {
      result.current.handleSelectComposerSelection({
        modelId: "gemini-2.5-pro",
        effort: "high",
      });
    });

    rerender({ activeThreadId: "gemini-pending-1" });

    await waitFor(() => {
      expect(result.current.selectedComposerSelection).toEqual({
        modelId: "gemini-2.5-pro",
        effort: null,
      });
    });
    expect(writeClientStoreValue).toHaveBeenCalledWith(
      "composer",
      "selectedModelByThread.ws-a:gemini-pending-1",
      { modelId: "gemini-2.5-pro", effort: null },
    );
  });
});
