// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import type { useAppServerEvents } from "../../app/hooks/useAppServerEvents";
import { useThreadRows } from "../../app/hooks/useThreadRows";
import {
  archiveThread,
  deleteOpenCodeSession,
  engineInterruptTurn,
  interruptTurn,
  resumeThread,
  sendUserMessage,
  startThread,
} from "../../../services/tauri";
import { appendRendererDiagnostic } from "../../../services/rendererDiagnostics";
import { sendSharedSessionTurnRouted } from "../../shared-session/runtime/sendSharedSessionTurn";
import { resetSharedSendStateStoreForTests } from "../../shared-session/runtime/sharedSendStateStore";
import { startSharedSession } from "../../shared-session/services/sharedSessions";
import {
  resetSharedTargetStoreForTests,
  selectNextTarget,
} from "../../shared-session/target/targetStore";
import { computeThreadItemCacheMax, useThreads } from "./useThreads";

type AppServerHandlers = Parameters<typeof useAppServerEvents>[0];

let handlers: AppServerHandlers | null = null;
const rendererDiagnosticsMocks = vi.hoisted(() => ({
  appendRendererDiagnostic: vi.fn(),
}));

vi.mock("../../app/hooks/useAppServerEvents", () => ({
  useAppServerEvents: (incoming: AppServerHandlers) => {
    handlers = incoming;
  },
}));

vi.mock("../../../services/tauri", () => ({
  respondToServerRequest: vi.fn(),
  respondToUserInputRequest: vi.fn(),
  connectWorkspace: vi.fn().mockResolvedValue(undefined),
  listThreadTitles: vi.fn(),
  setThreadTitle: vi.fn().mockResolvedValue(undefined),
  renameThreadTitleKey: vi.fn(),
  generateThreadTitle: vi.fn(),
  rememberApprovalRule: vi.fn(),
  sendUserMessage: vi.fn(),
  startReview: vi.fn(),
  startThread: vi.fn(),
  listThreads: vi.fn(),
  resumeThread: vi.fn(),
  archiveThread: vi.fn(),
  deleteOpenCodeSession: vi.fn(),
  getAccountRateLimits: vi.fn(),
  getAccountInfo: vi.fn(),
  engineInterrupt: vi.fn(),
  engineInterruptTurn: vi.fn(),
  interruptTurn: vi.fn(),
  getEmailInboundListenerStatus: vi.fn().mockResolvedValue({
    enabled: false,
    readOnly: true,
    connectionState: "disabled",
    lastCheckedAt: null,
    nextCheckAt: null,
    acceptedCount: 0,
    queuedCount: 0,
    needsConfirmationCount: 0,
    rejectedCount: 0,
    ignoredCount: 0,
    pollingIntervalSeconds: 300,
  }),
  checkEmailInbox: vi.fn(),
  claimNextEmailMailCommand: vi.fn().mockResolvedValue({ command: null }),
  completeEmailMailCommand: vi.fn(),
}));

vi.mock("../../../services/rendererDiagnostics", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../services/rendererDiagnostics")>();
  return {
    ...actual,
    appendRendererDiagnostic: rendererDiagnosticsMocks.appendRendererDiagnostic,
  };
});

vi.mock("../../shared-session/runtime/sendSharedSessionTurn", () => ({
  sendSharedSessionTurn: vi.fn(),
  sendSharedSessionTurnRouted: vi.fn(),
}));

vi.mock("../../shared-session/services/sharedSessions", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../shared-session/services/sharedSessions")
    >();
  return {
    ...actual,
    startSharedSession: vi.fn(),
  };
});

const workspace: WorkspaceInfo = {
  id: "ws-1",
  name: "ccgui",
  path: "/tmp/codex",
  connected: true,
  settings: { sidebarCollapsed: false },
};

describe("useThreads UX integration", () => {
  let now: number;
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    handlers = null;
    vi.clearAllMocks();
    window.localStorage.clear();
    resetSharedTargetStoreForTests();
    resetSharedSendStateStoreForTests();
    now = 1000;
    nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    nowSpy.mockRestore();
    vi.useRealTimers();
  });

  it("refreshes the active workspace model catalog when Codex connects", async () => {
    const onWorkspaceConnected = vi.fn();
    const onWorkspaceModelsRefresh = vi.fn();

    renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected,
        onWorkspaceModelsRefresh,
      }),
    );

    await act(async () => {
      handlers?.onWorkspaceConnected?.("ws-1");
      await Promise.resolve();
    });

    expect(onWorkspaceConnected).toHaveBeenCalledWith("ws-1");
    expect(onWorkspaceModelsRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      handlers?.onWorkspaceConnected?.("ws-2");
      await Promise.resolve();
    });

    expect(onWorkspaceConnected).toHaveBeenCalledWith("ws-2");
    expect(onWorkspaceModelsRefresh).toHaveBeenCalledTimes(1);
  });

  it("resumes selected threads when no local items exist", async () => {
    vi.mocked(resumeThread).mockResolvedValue({
      result: {
        thread: {
          id: "thread-2",
          preview: "Remote preview",
          updated_at: 9999,
          turns: [
            {
              items: [
                {
                  type: "userMessage",
                  id: "server-user-1",
                  content: [{ type: "text", text: "Hello" }],
                },
                {
                  type: "agentMessage",
                  id: "assistant-1",
                  text: "Hello world",
                },
                {
                  type: "enteredReviewMode",
                  id: "review-1",
                },
              ],
            },
          ],
        },
      },
    });

    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    expect(handlers).not.toBeNull();

    act(() => {
      result.current.setActiveThreadId("thread-2");
    });

    await waitFor(() => {
      expect(vi.mocked(resumeThread)).toHaveBeenCalledWith("ws-1", "thread-2");
    });

    await waitFor(() => {
      expect(result.current.threadStatusById["thread-2"]?.isReviewing).toBe(true);
    });

    const activeItems = result.current.activeItems;
    const assistantMerged = activeItems.find(
      (item) =>
        item.kind === "message" &&
        item.role === "assistant" &&
        item.id === "assistant-1",
    );
    expect(assistantMerged?.kind).toBe("message");
    if (assistantMerged?.kind === "message") {
      expect(assistantMerged.text).toBe("Hello world");
    }
  });

  it("keeps the latest plan visible when a new turn starts", async () => {
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    await act(async () => {
      handlers?.onTurnPlanUpdated?.("ws-1", "thread-1", "turn-1", {
        explanation: " Plan note ",
        plan: [{ step: "Do it", status: "in_progress" }],
      });
    });

    expect(result.current.planByThread["thread-1"]).toEqual({
      turnId: "turn-1",
      explanation: "Plan note",
      steps: [{ step: "Do it", status: "inProgress" }],
    });

    await act(async () => {
      handlers?.onTurnStarted?.("ws-1", "thread-1", "turn-2");
    });

    expect(result.current.planByThread["thread-1"]).toEqual({
      turnId: "turn-1",
      explanation: "Plan note",
      steps: [{ step: "Do it", status: "inProgress" }],
    });
  });

  it("keeps local items when resume response does not overlap", async () => {
    vi.mocked(resumeThread).mockResolvedValue({
      result: {
        thread: {
          id: "thread-3",
          preview: "Remote preview",
          updated_at: 9999,
          turns: [
            {
              items: [
                {
                  type: "userMessage",
                  id: "server-user-1",
                  content: [{ type: "text", text: "Remote hello" }],
                },
                {
                  type: "agentMessage",
                  id: "server-assistant-1",
                  text: "Remote response",
                },
              ],
            },
          ],
        },
      },
    });

    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    expect(handlers).not.toBeNull();

    act(() => {
      handlers?.onAgentMessageCompleted?.({
        workspaceId: "ws-1",
        threadId: "thread-3",
        itemId: "local-assistant-1",
        text: "Local response",
      });
    });

    act(() => {
      result.current.setActiveThreadId("thread-3");
    });

    await waitFor(() => {
      expect(vi.mocked(resumeThread)).toHaveBeenCalledWith("ws-1", "thread-3");
    });

    await waitFor(() => {
      const activeItems = result.current.activeItems;
      const hasLocal = activeItems.some(
        (item) =>
          item.kind === "message" &&
          item.role === "assistant" &&
          item.id === "local-assistant-1",
      );
      const hasRemote = activeItems.some(
        (item) => item.kind === "message" && item.id === "server-user-1",
      );
      expect(hasLocal).toBe(true);
      expect(hasRemote).toBe(false);
    });
  });

  it("clears empty plan updates to null", async () => {
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    await act(async () => {
      handlers?.onTurnPlanUpdated?.("ws-1", "thread-1", "turn-1", {
        explanation: "   ",
        plan: [],
      });
    });

    expect(result.current.planByThread["thread-1"]).toBeNull();
  });

  it("normalizes plan step status values", async () => {
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    await act(async () => {
      handlers?.onTurnPlanUpdated?.("ws-1", "thread-1", "turn-1", {
        explanation: "",
        plan: [
          { step: "Step 1", status: "in_progress" },
          { step: "Step 2", status: "in-progress" },
          { step: "Step 3", status: "in progress" },
          { step: "Step 4", status: "completed" },
          { step: "Step 5", status: "unknown" },
        ],
      });
    });

    expect(result.current.planByThread["thread-1"]).toEqual({
      turnId: "turn-1",
      explanation: null,
      steps: [
        { step: "Step 1", status: "inProgress" },
        { step: "Step 2", status: "inProgress" },
        { step: "Step 3", status: "inProgress" },
        { step: "Step 4", status: "completed" },
        { step: "Step 5", status: "pending" },
      ],
    });
  });

  it("replaces the plan when a new turn updates it", async () => {
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    await act(async () => {
      handlers?.onTurnPlanUpdated?.("ws-1", "thread-1", "turn-1", {
        explanation: "First plan",
        plan: [{ step: "Step 1", status: "pending" }],
      });
      handlers?.onTurnPlanUpdated?.("ws-1", "thread-1", "turn-2", {
        explanation: "Next plan",
        plan: [{ step: "Step 2", status: "completed" }],
      });
    });

    expect(result.current.planByThread["thread-1"]).toEqual({
      turnId: "turn-2",
      explanation: "Next plan",
      steps: [{ step: "Step 2", status: "completed" }],
    });
  });

  it("keeps plans isolated per thread", async () => {
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    await act(async () => {
      handlers?.onTurnPlanUpdated?.("ws-1", "thread-1", "turn-1", {
        explanation: "Thread 1 plan",
        plan: [{ step: "Step 1", status: "pending" }],
      });
      handlers?.onTurnPlanUpdated?.("ws-1", "thread-2", "turn-2", {
        explanation: "Thread 2 plan",
        plan: [{ step: "Step 2", status: "completed" }],
      });
    });

    expect(result.current.planByThread["thread-1"]).toEqual({
      turnId: "turn-1",
      explanation: "Thread 1 plan",
      steps: [{ step: "Step 1", status: "pending" }],
    });
    expect(result.current.planByThread["thread-2"]).toEqual({
      turnId: "turn-2",
      explanation: "Thread 2 plan",
      steps: [{ step: "Step 2", status: "completed" }],
    });
  });

  it("deletes opencode sessions through backend hard-delete path", async () => {
    vi.mocked(deleteOpenCodeSession).mockResolvedValue({
      deleted: true,
      method: "filesystem",
    });
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    let output: Awaited<ReturnType<typeof result.current.removeThread>> | null = null;
    await act(async () => {
      output = await result.current.removeThread("ws-1", "opencode:ses_opc_1");
    });

    expect(output).toEqual({
      threadId: "opencode:ses_opc_1",
      success: true,
      code: null,
      message: null,
    });
    expect(archiveThread).not.toHaveBeenCalled();
    expect(deleteOpenCodeSession).toHaveBeenCalledWith("ws-1", "ses_opc_1");
  });

  it("maps workspace-not-connected errors from opencode hard-delete", async () => {
    vi.mocked(deleteOpenCodeSession).mockRejectedValue(
      new Error("[WORKSPACE_NOT_CONNECTED] Workspace not found"),
    );
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    let output: Awaited<ReturnType<typeof result.current.removeThread>> | null = null;
    await act(async () => {
      output = await result.current.removeThread("ws-1", "opencode:ses_opc_1");
    });

    expect(output).toEqual({
      threadId: "opencode:ses_opc_1",
      success: false,
      code: "WORKSPACE_NOT_CONNECTED",
      message: "[WORKSPACE_NOT_CONNECTED] Workspace not found",
    });
  });

  it("creates a new Codex thread when active Claude thread metadata is missing", async () => {
    const startThreadMock = vi.mocked(startThread);
    const sendUserMessageMock = vi.mocked(sendUserMessage);
    startThreadMock.mockResolvedValue({
      result: {
        thread: {
          id: "codex-thread-1",
        },
      },
    });
    sendUserMessageMock.mockResolvedValue({
      result: {
        turn: {
          id: "turn-1",
        },
      },
    });

    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
        activeEngine: "codex",
      }),
    );

    act(() => {
      result.current.setActiveThreadId("claude-pending-stale");
    });

    await act(async () => {
      await result.current.sendUserMessage("hello from codex");
    });

    expect(startThreadMock).toHaveBeenCalledWith("ws-1");
    expect(sendUserMessageMock).toHaveBeenCalledTimes(1);
    const sendArgs = sendUserMessageMock.mock.calls[0];
    expect(sendArgs?.[0]).toBe("ws-1");
    expect(sendArgs?.[1]).toBe("codex-thread-1");
    expect(sendArgs?.[2]).toBe("hello from codex");
  });

  it("queues a pending interrupt until a cli-managed turn id becomes available", async () => {
    const interruptMock = vi.mocked(interruptTurn);
    const engineInterruptTurnMock = vi.mocked(engineInterruptTurn);
    interruptMock.mockResolvedValue({ result: {} });
    engineInterruptTurnMock.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    act(() => {
      result.current.setActiveThreadId("claude:session-1");
    });

    await act(async () => {
      handlers?.onTurnStarted?.("ws-1", "claude:session-1", "");
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(interruptMock).not.toHaveBeenCalled();
    expect(engineInterruptTurnMock).not.toHaveBeenCalled();

    await act(async () => {
      handlers?.onTurnStarted?.("ws-1", "claude:session-1", "turn-1");
    });

    await waitFor(() => {
      expect(engineInterruptTurnMock).toHaveBeenCalledWith(
        "ws-1",
        "turn-1",
        "claude",
      );
    });
    expect(engineInterruptTurnMock).toHaveBeenCalledTimes(1);
  });

  it("does not revive processing from late normalized realtime updates after turn completion", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("doge.perf.realtimeBatching", "1");
    try {
      const { result } = renderHook(() =>
        useThreads({
          activeWorkspace: workspace,
          onWorkspaceConnected: vi.fn(),
        }),
      );

      act(() => {
        result.current.setActiveThreadId("thread-late-normalized");
      });

      // 先消化线程切换触发的 24ms lazy-resume 定时器，
      // 避免后续 advanceTimersByTime(40) 时 resume 把本地 items 清空。
      await act(async () => {
        vi.advanceTimersByTime(30);
        await Promise.resolve();
      });

      await act(async () => {
        handlers?.onTurnStarted?.("ws-1", "thread-late-normalized", "turn-1");
        handlers?.onAgentMessageCompleted?.({
          workspaceId: "ws-1",
          threadId: "thread-late-normalized",
          itemId: "assistant-late-1",
          text: "visible answer",
          turnId: "turn-1",
        });
      });

      let assistant = result.current.activeItems.find(
        (item) =>
          item.kind === "message" &&
          item.role === "assistant" &&
          item.id === "assistant-late-1",
      );
      expect(assistant?.kind).toBe("message");
      if (assistant?.kind === "message") {
        expect(assistant.text).toBe("visible answer");
      }

      await act(async () => {
        handlers?.onTurnCompleted?.("ws-1", "thread-late-normalized", "turn-1");
      });

      expect(result.current.threadStatusById["thread-late-normalized"]?.isProcessing).toBe(false);

      await act(async () => {
        handlers?.onNormalizedRealtimeEvent?.({
          engine: "codex",
          workspaceId: "ws-1",
          threadId: "thread-late-normalized",
          turnId: "turn-1",
          eventId: "evt-late-1",
          itemKind: "message",
          timestampMs: 2,
          operation: "itemUpdated",
          sourceMethod: "item/updated",
          item: {
            id: "assistant-late-1",
            kind: "message",
            role: "assistant",
            text: "visible answer\nlate delta",
          },
        });
      });

      await act(async () => {
        vi.advanceTimersByTime(40);
        await Promise.resolve();
      });

      expect(result.current.threadStatusById["thread-late-normalized"]?.isProcessing).toBe(false);
      assistant = result.current.activeItems.find(
        (item) =>
          item.kind === "message" &&
          item.role === "assistant" &&
          item.id === "assistant-late-1",
      );
      expect(assistant?.kind).toBe("message");
      if (assistant?.kind === "message") {
        expect(assistant.text).toBe("visible answer");
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["Kimi", "kimi-for-coding"],
    ["MiniMax", "MiniMax-M2.1"],
  ])(
    "keeps a durable Shared Claude + %s turn settled when late realtime events arrive",
    async (_providerLabel, runtimeModel) => {
      const sharedThreadId = `shared:durable-${runtimeModel.toLowerCase()}`;
      const runtimeTurnId = `runtime-${runtimeModel}`;
      const executionTarget = {
        engine: "claude",
        providerProfileId: "provider-shared",
        modelCatalogEntryId: `provider-shared:${runtimeModel}`,
        providerProfileNameSnapshot: "Shared Provider",
        providerProfileSource: "managed",
        model: runtimeModel,
        reasoning: null,
      } as const;
      vi.mocked(startSharedSession).mockResolvedValueOnce({
        result: {
          thread: {
            id: sharedThreadId,
            name: "Shared durable barrier",
            updatedAt: 1000,
            selectedTarget: executionTarget,
          },
        },
      });
      vi.mocked(sendSharedSessionTurnRouted).mockResolvedValueOnce({
        result: { turn: { id: runtimeTurnId } },
        nativeThreadId: "claude:native-shared",
        runtimeTurnId,
        v2: {
          attemptId: `attempt-${runtimeModel}`,
          logicalTurnId: `logical-${runtimeModel}`,
          committed: true,
          duplicate: false,
        },
      });
      const onDebug = vi.fn();
      const { result } = renderHook(() =>
        useThreads({
          activeWorkspace: workspace,
          onWorkspaceConnected: vi.fn(),
          activeEngine: "claude",
          onDebug,
        }),
      );

      await act(async () => {
        await result.current.startSharedSessionForWorkspace("ws-1", {
          initialTarget: executionTarget,
        });
      });
      selectNextTarget("ws-1", sharedThreadId, executionTarget);

      await act(async () => {
        await result.current.sendUserMessageToThread(
          workspace,
          sharedThreadId,
          "验证 durable terminal barrier",
        );
      });

      expect(
        result.current.threadStatusById[sharedThreadId]?.isProcessing,
      ).toBe(false);
      expect(onDebug).toHaveBeenCalledWith(
        expect.objectContaining({
          label: "thread/session:shared-durable-terminal-barrier-installed",
          payload: {
            threadId: sharedThreadId,
            runtimeTurnId,
          },
        }),
      );

      act(() => {
        handlers?.onSharedRuntimeTurnStarted?.(
          sharedThreadId,
          runtimeTurnId,
        );
      });
      expect(
        result.current.threadStatusById[sharedThreadId]?.isProcessing,
      ).toBe(false);

      await act(async () => {
        handlers?.onNormalizedRealtimeEvent?.({
          engine: "claude",
          workspaceId: "ws-1",
          threadId: sharedThreadId,
          turnId: runtimeTurnId,
          eventId: `late-${runtimeModel}`,
          itemKind: "message",
          timestampMs: 2,
          operation: "itemUpdated",
          sourceMethod: "item/updated",
          item: {
            id: `assistant-${runtimeModel}`,
            kind: "message",
            role: "assistant",
            text: "late snapshot",
          },
        });
      });
      expect(onDebug).toHaveBeenCalledWith(
        expect.objectContaining({
          label: "thread/session:realtime-terminal-exact-drop",
        }),
      );
      expect(
        result.current.threadStatusById[sharedThreadId]?.isProcessing,
      ).toBe(false);

      await act(async () => {
        handlers?.onReasoningTextDelta?.(
          "ws-1",
          sharedThreadId,
          `reasoning-${runtimeModel}`,
          "late reasoning",
          null,
          runtimeTurnId,
        );
      });
      expect(
        result.current.threadStatusById[sharedThreadId]?.isProcessing,
      ).toBe(false);

      await act(async () => {
        handlers?.onItemUpdated?.("ws-1", sharedThreadId, {
          id: `assistant-${runtimeModel}`,
          type: "agentMessage",
          text: "late raw snapshot",
          turnId: runtimeTurnId,
        });
      });

      expect(
        result.current.threadStatusById[sharedThreadId]?.isProcessing,
      ).toBe(false);
      expect(result.current.activeTurnIdByThread[sharedThreadId]).toBeNull();

      const nextRuntimeTurnId = `${runtimeTurnId}-next`;
      act(() => {
        handlers?.onSharedRuntimeTurnStarted?.(
          sharedThreadId,
          nextRuntimeTurnId,
        );
      });
      expect(
        result.current.threadStatusById[sharedThreadId]?.isProcessing,
      ).toBe(false);

      await act(async () => {
        handlers?.onNormalizedRealtimeEvent?.({
          engine: "claude",
          workspaceId: "ws-1",
          threadId: sharedThreadId,
          turnId: nextRuntimeTurnId,
          eventId: `next-${runtimeModel}`,
          itemKind: "message",
          timestampMs: 3,
          operation: "itemUpdated",
          sourceMethod: "item/updated",
          item: {
            id: `assistant-next-${runtimeModel}`,
            kind: "message",
            role: "assistant",
            text: "next turn snapshot",
          },
        });
      });
      expect(
        result.current.threadStatusById[sharedThreadId]?.isProcessing,
      ).toBe(true);
    },
  );

  it("does not revive processing from late raw item updates after turn completion", async () => {
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    act(() => {
      result.current.setActiveThreadId("thread-late-raw");
    });

    await act(async () => {
      handlers?.onTurnStarted?.("ws-1", "thread-late-raw", "turn-raw-1");
      handlers?.onAgentMessageCompleted?.({
        workspaceId: "ws-1",
        threadId: "thread-late-raw",
        itemId: "assistant-raw-1",
        text: "visible raw answer",
        turnId: "turn-raw-1",
      });
      handlers?.onTurnCompleted?.("ws-1", "thread-late-raw", "turn-raw-1");
    });

    expect(result.current.threadStatusById["thread-late-raw"]?.isProcessing).toBe(false);

    await act(async () => {
      handlers?.onItemUpdated?.("ws-1", "thread-late-raw", {
        id: "assistant-raw-1",
        type: "agentMessage",
        text: "visible raw answer\nlate raw update",
        turnId: "turn-raw-1",
      });
    });

    expect(result.current.threadStatusById["thread-late-raw"]?.isProcessing).toBe(false);
    const assistant = result.current.activeItems.find(
      (item) =>
        item.kind === "message" &&
        item.role === "assistant" &&
        item.id === "assistant-raw-1",
    );
    expect(assistant?.kind).toBe("message");
    if (assistant?.kind === "message") {
      expect(assistant.text).toBe("visible raw answer");
    }

    await act(async () => {
      handlers?.onItemUpdated?.("ws-1", "thread-late-raw", {
        id: "assistant-raw-1",
        type: "agentMessage",
        text: "visible raw answer\nturnless late raw update",
      });
    });

    expect(result.current.threadStatusById["thread-late-raw"]?.isProcessing).toBe(false);
    const assistantAfterTurnlessLateEvent = result.current.activeItems.find(
      (item) =>
        item.kind === "message" &&
        item.role === "assistant" &&
        item.id === "assistant-raw-1",
    );
    expect(assistantAfterTurnlessLateEvent?.kind).toBe("message");
    if (assistantAfterTurnlessLateEvent?.kind === "message") {
      expect(assistantAfterTurnlessLateEvent.text).toBe("visible raw answer");
    }
  });

  it("does not revive processing from turnless raw updates after ownerless runtime settlement", async () => {
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    act(() => {
      result.current.setActiveThreadId("thread-turnless-runtime-ended");
    });

    await act(async () => {
      handlers?.onTurnStarted?.(
        "ws-1",
        "thread-turnless-runtime-ended",
        "turn-runtime-ended-1",
      );
      handlers?.onAgentMessageCompleted?.({
        workspaceId: "ws-1",
        threadId: "thread-turnless-runtime-ended",
        itemId: "assistant-runtime-ended-1",
        text: "runtime ended answer",
        turnId: "turn-runtime-ended-1",
      });
      handlers?.onTurnError?.("ws-1", "thread-turnless-runtime-ended", "", {
        message: "[RUNTIME_ENDED] Runtime ended after the answer settled.",
        willRetry: false,
        engine: "codex",
      });
    });

    expect(
      result.current.threadStatusById["thread-turnless-runtime-ended"]
        ?.isProcessing,
    ).toBe(false);
    expect(
      result.current.activeTurnIdByThread["thread-turnless-runtime-ended"],
    ).toBeNull();

    await act(async () => {
      handlers?.onItemUpdated?.("ws-1", "thread-turnless-runtime-ended", {
        id: "assistant-runtime-ended-1",
        type: "agentMessage",
        text: "runtime ended answer\nlate turnless raw update",
      });
    });

    expect(
      result.current.threadStatusById["thread-turnless-runtime-ended"]
        ?.isProcessing,
    ).toBe(false);
    expect(
      result.current.activeTurnIdByThread["thread-turnless-runtime-ended"],
    ).toBeNull();
    const assistant = result.current.activeItems.find(
      (item) =>
        item.kind === "message" &&
        item.role === "assistant" &&
        item.id === "assistant-runtime-ended-1",
    );
    expect(assistant?.kind).toBe("message");
    if (assistant?.kind === "message") {
      expect(assistant.text).toBe("runtime ended answer");
    }
  });

  it("does not revive processing from a late duplicate Codex turn start after completion", async () => {
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    act(() => {
      result.current.setActiveThreadId("thread-late-start");
    });

    await act(async () => {
      handlers?.onTurnStarted?.("ws-1", "thread-late-start", "turn-late-start-1");
      handlers?.onAgentMessageCompleted?.({
        workspaceId: "ws-1",
        threadId: "thread-late-start",
        itemId: "assistant-late-start-1",
        text: "visible answer",
        turnId: "turn-late-start-1",
      });
      handlers?.onTurnCompleted?.("ws-1", "thread-late-start", "turn-late-start-1");
    });

    expect(result.current.threadStatusById["thread-late-start"]?.isProcessing).toBe(false);
    expect(result.current.activeTurnIdByThread["thread-late-start"]).toBeNull();

    await act(async () => {
      handlers?.onTurnStarted?.("ws-1", "thread-late-start", "turn-late-start-1");
    });

    expect(result.current.threadStatusById["thread-late-start"]?.isProcessing).toBe(false);
    expect(result.current.activeTurnIdByThread["thread-late-start"]).toBeNull();
  });

  it("keeps parallel Codex turns isolated when one settled turn emits a late duplicate start", async () => {
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    await act(async () => {
      handlers?.onTurnStarted?.("ws-1", "thread-parallel-a", "turn-parallel-a");
      handlers?.onTurnStarted?.("ws-1", "thread-parallel-b", "turn-parallel-b");
    });

    expect(result.current.threadStatusById["thread-parallel-a"]?.isProcessing).toBe(true);
    expect(result.current.threadStatusById["thread-parallel-b"]?.isProcessing).toBe(true);

    await act(async () => {
      handlers?.onTurnCompleted?.("ws-1", "thread-parallel-a", "turn-parallel-a");
    });

    expect(result.current.threadStatusById["thread-parallel-a"]?.isProcessing).toBe(false);
    expect(result.current.threadStatusById["thread-parallel-b"]?.isProcessing).toBe(true);

    await act(async () => {
      handlers?.onTurnStarted?.("ws-1", "thread-parallel-a", "turn-parallel-a");
    });

    expect(result.current.threadStatusById["thread-parallel-a"]?.isProcessing).toBe(false);
    expect(result.current.activeTurnIdByThread["thread-parallel-a"]).toBeNull();
    expect(result.current.threadStatusById["thread-parallel-b"]?.isProcessing).toBe(true);
    expect(result.current.activeTurnIdByThread["thread-parallel-b"]).toBe("turn-parallel-b");

    await act(async () => {
      handlers?.onTurnCompleted?.("ws-1", "thread-parallel-b", "turn-parallel-b");
    });

    expect(result.current.threadStatusById["thread-parallel-a"]?.isProcessing).toBe(false);
    expect(result.current.threadStatusById["thread-parallel-b"]?.isProcessing).toBe(false);
    expect(result.current.activeTurnIdByThread["thread-parallel-b"]).toBeNull();
  });

  it("keeps a settled Codex sibling idle while the parallel turn continues progress", async () => {
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    await act(async () => {
      handlers?.onTurnStarted?.("ws-1", "thread-authority-a", "turn-a-1");
      handlers?.onTurnStarted?.("ws-1", "thread-authority-b", "turn-b-1");
      handlers?.onTurnCompleted?.("ws-1", "thread-authority-a", "turn-a-1");
    });

    await act(async () => {
      handlers?.onItemUpdated?.("ws-1", "thread-authority-b", {
        id: "tool-b-1",
        type: "commandExecution",
        status: "inProgress",
        turnId: "turn-b-1",
      });
      handlers?.onItemUpdated?.("ws-1", "thread-authority-a", {
        id: "tool-a-late",
        type: "commandExecution",
        status: "inProgress",
      });
    });

    expect(result.current.threadStatusById["thread-authority-a"]?.isProcessing).toBe(false);
    expect(result.current.activeTurnIdByThread["thread-authority-a"]).toBeNull();
    expect(result.current.threadStatusById["thread-authority-b"]?.isProcessing).toBe(true);
    expect(result.current.activeTurnIdByThread["thread-authority-b"]).toBe("turn-b-1");

    await act(async () => {
      handlers?.onTurnStarted?.("ws-1", "thread-authority-a", "turn-a-2");
    });

    expect(result.current.threadStatusById["thread-authority-a"]?.isProcessing).toBe(true);
    expect(result.current.activeTurnIdByThread["thread-authority-a"]).toBe("turn-a-2");
  });

  it("exposes a Codex fallback owner only when exactly one Codex thread is processing", async () => {
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    await act(async () => {
      handlers?.onThreadStarted?.("ws-1", {
        id: "thread-provider-a",
        preview: "Provider A",
        providerProfileId: "provider-a",
        providerProfileSource: "managed",
        providerProfileName: "Provider A",
      });
      handlers?.onTurnStarted?.("ws-1", "thread-provider-a", "turn-a");
      handlers?.onThreadStarted?.("ws-1", {
        id: "claude:session-1",
        preview: "Claude",
      });
      handlers?.onTurnStarted?.("ws-1", "claude:session-1", "turn-claude");
    });

    expect(result.current.threadStatusById["thread-provider-a"]?.isProcessing).toBe(true);
    expect(result.current.threadStatusById["claude:session-1"]?.isProcessing).toBe(true);
    expect(handlers?.getSingleProcessingCodexThreadId?.("ws-1")).toBe(
      "thread-provider-a",
    );

    await act(async () => {
      handlers?.onThreadStarted?.("ws-1", {
        id: "thread-provider-a-sibling",
        preview: "Provider A sibling",
        providerProfileId: "provider-a",
        providerProfileSource: "managed",
        providerProfileName: "Provider A",
      });
      handlers?.onTurnStarted?.(
        "ws-1",
        "thread-provider-a-sibling",
        "turn-a-sibling",
      );
    });

    expect(handlers?.getSingleProcessingCodexThreadId?.("ws-1")).toBeNull();

    await act(async () => {
      handlers?.onThreadStarted?.("ws-1", {
        id: "thread-provider-b",
        preview: "Provider B",
        providerProfileId: "provider-b",
        providerProfileSource: "managed",
        providerProfileName: "Provider B",
      });
      handlers?.onTurnStarted?.("ws-1", "thread-provider-b", "turn-b");
    });

    expect(handlers?.getSingleProcessingCodexThreadId?.("ws-1")).toBeNull();
  });

  it("exposes a newly started Codex fallback owner before the React state ref effect runs", async () => {
    renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    let ownerDuringSameTick: string | null | undefined = undefined;

    await act(async () => {
      handlers?.onThreadStarted?.("ws-1", {
        id: "thread-immediate-owner",
        preview: "Immediate owner",
      });
      handlers?.onTurnStarted?.(
        "ws-1",
        "thread-immediate-owner",
        "turn-immediate-owner",
      );
      ownerDuringSameTick =
        handlers?.getSingleProcessingCodexThreadId?.("ws-1");
      await Promise.resolve();
    });

    expect(ownerDuringSameTick).toBe("thread-immediate-owner");
  });

  it("orders thread lists, applies custom names, and keeps pin ordering stable", async () => {
    const expectedThreadIds = new Set(["thread-a", "thread-b", "thread-c"]);
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    const { result: threadRowsResult } = renderHook(() =>
      useThreadRows(result.current.threadParentById),
    );

    await act(async () => {
      handlers?.onThreadStarted?.("ws-1", {
        id: "thread-a",
        preview: "Alpha",
        updated_at: 1000,
      });
      handlers?.onThreadStarted?.("ws-1", {
        id: "thread-c",
        preview: "Gamma",
        updated_at: 2000,
      });
      handlers?.onThreadStarted?.("ws-1", {
        id: "thread-b",
        preview: "Beta",
        updated_at: 3000,
      });
    });

    const listedThreads =
      result.current.threadsByWorkspace["ws-1"]?.filter((thread) =>
        expectedThreadIds.has(thread.id),
      ) ?? [];
    expect(listedThreads.map((thread) => thread.id)).toEqual([
      "thread-b",
      "thread-c",
      "thread-a",
    ]);

    act(() => {
      result.current.renameThread("ws-1", "thread-b", "Custom Beta");
    });

    await waitFor(() => {
      const refreshedThread = result.current.threadsByWorkspace["ws-1"]?.find(
        (thread) => thread.id === "thread-b",
      );
      expect(refreshedThread?.name).toBe("Custom Beta");
    });

    now = 5000;
    act(() => {
      result.current.pinThread("ws-1", "thread-c");
    });
    now = 6000;
    act(() => {
      result.current.pinThread("ws-1", "thread-a");
    });

    const rowsTargetThreads =
      result.current.threadsByWorkspace["ws-1"]?.filter((thread) =>
        expectedThreadIds.has(thread.id),
      ) ?? [];
    const { pinnedRows, unpinnedRows } = threadRowsResult.current.getThreadRows(
      rowsTargetThreads,
      true,
      "ws-1",
      result.current.getPinTimestamp,
    );

    expect(pinnedRows.map((row) => row.thread.id)).toEqual([
      "thread-c",
      "thread-a",
    ]);
    expect(unpinnedRows.map((row) => row.thread.id)).toEqual(["thread-b"]);
  });

  it("computes the adaptive thread item cache cap from in-flight count", () => {
    expect(computeThreadItemCacheMax(0)).toBe(12);
    expect(computeThreadItemCacheMax(8)).toBe(22);
    expect(computeThreadItemCacheMax(20)).toBe(46);
  });

  it("evicts stale loaded thread items and emits a chat-stream diagnostic", async () => {
    const startThreadMock = vi.mocked(startThread);
    startThreadMock.mockImplementation(async () => {
      const callIndex = startThreadMock.mock.calls.length;
      return {
        result: {
          thread: {
            id: `thread-${callIndex}`,
          },
        },
      } as never;
    });

    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
        activeEngine: "codex",
      }),
    );

    for (let index = 0; index < 15; index += 1) {
      const threadId = `thread-${index + 1}`;
      now += 100;
      await act(async () => {
        // Optimistic codex create returns a pending id; finalize swaps in the
        // real backend thread id like the first-send path does.
        const pendingThreadId = await result.current.startThread();
        if (pendingThreadId) {
          await result.current.finalizeCodexPendingThread(
            "ws-1",
            pendingThreadId,
          );
        }
        handlers?.onAgentMessageCompleted?.({
          workspaceId: "ws-1",
          threadId,
          itemId: `assistant-${index + 1}`,
          text: `answer ${index + 1}`,
          turnId: `turn-${index + 1}`,
        });
      });
    }

    await waitFor(() => {
      expect(result.current.threadItemsByThread["thread-1"]).toBeUndefined();
      expect(result.current.threadItemsByThread["thread-2"]).toBeUndefined();
      expect(result.current.threadItemsByThread["thread-3"]).toBeUndefined();
    });

    expect(result.current.threadItemsByThread["thread-4"]).toHaveLength(1);
    expect(result.current.threadItemsByThread["thread-15"]).toHaveLength(1);
    expect(appendRendererDiagnostic).toHaveBeenCalledWith(
      "chat-stream/evict-thread",
      expect.objectContaining({
        evictedCount: 3,
        cacheMax: 12,
        inFlightCount: 0,
      }),
    );
  });

  it("keeps interrupted guards scoped by workspace for matching thread ids", async () => {
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    await act(async () => {
      handlers?.onThreadStarted?.("ws-1", {
        id: "thread-shared",
        preview: "Workspace one",
        updated_at: 1000,
      });
      handlers?.onThreadStarted?.("ws-2", {
        id: "thread-shared",
        preview: "Workspace two",
        updated_at: 1000,
      });
      result.current.setActiveThreadId("thread-shared");
      handlers?.onTurnStarted?.("ws-1", "thread-shared", "turn-ws-1");
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    await act(async () => {
      handlers?.onAgentMessageCompleted?.({
        workspaceId: "ws-2",
        threadId: "thread-shared",
        itemId: "assistant-ws-2",
        text: "workspace two answer",
        turnId: "turn-ws-2",
      });
    });

    expect(result.current.threadItemsByThread["thread-shared"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "assistant-ws-2",
          kind: "message",
          role: "assistant",
          text: "workspace two answer",
        }),
      ]),
    );
  });

});
