// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import { engineInterrupt, engineInterruptTurn, interruptTurn } from "../../../services/tauri";
import {
  clearGlobalRuntimeNotices,
  getGlobalRuntimeNoticesSnapshot,
} from "../../../services/globalRuntimeNotices";
import {
  normalizePlanUpdate,
  normalizeRateLimits,
  normalizeTokenUsage,
} from "../utils/threadNormalize";
import {
  registerCodexPrewarm,
  releaseCodexPrewarm,
  resetCodexPendingPrewarmForTests,
  settleCodexPrewarm,
} from "../utils/codexPendingPrewarm";
import {
  appendLiveAssistantText,
  getLiveAssistantTextSnapshot,
  resetLiveAssistantTextChannelForTests,
} from "../utils/liveAssistantTextChannel";
import { useThreadTurnEvents } from "./useThreadTurnEvents";
import { initialState, threadReducer } from "./useThreadsReducer";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";
import { workspaceScopedHas } from "./workspaceScopedMap";

vi.mock("../../../services/tauri", () => ({
  engineInterrupt: vi.fn(),
  engineInterruptTurn: vi.fn(),
  interruptTurn: vi.fn(),
}));

vi.mock("../utils/threadNormalize", () => ({
  asString: (value: unknown) =>
    typeof value === "string" ? value : value ? String(value) : "",
  normalizePlanUpdate: vi.fn(),
  normalizeRateLimits: vi.fn(),
  normalizeTokenUsage: vi.fn(),
}));

type SetupOverrides = {
  pendingInterrupts?: string[];
  interruptedThreads?: string[];
  activeThreadId?: string | null;
  activeTurnIdByThread?: Record<string, string | null>;
  resolveCanonicalThreadId?: (threadId: string) => string;
  onDebug?: ReturnType<typeof vi.fn>;
  activeWorkspaceId?: string;
  establishedThreadIds?: string[];
};

const makeOptions = (overrides: SetupOverrides = {}) => {
  const dispatch = vi.fn();
  const getCustomName = vi.fn();
  const resolveCanonicalThreadId =
    overrides.resolveCanonicalThreadId ?? ((threadId: string) => threadId);
  const isAutoTitlePending = vi.fn(() => false);
  const isThreadHidden = vi.fn(() => false);
  const markProcessing = vi.fn();
  const markReviewing = vi.fn();
  const setActiveTurnId = vi.fn();
  const pushThreadErrorMessage = vi.fn();
  const safeMessageActivity = vi.fn();
  const recordThreadActivity = vi.fn();
  const renameCustomNameKey = vi.fn();
  const renameAutoTitlePendingKey = vi.fn();
  const renameThreadTitleMapping = vi.fn();
  const resolvePendingThreadForSession = vi.fn();
  const resolvePendingThreadForTurn = vi.fn();
  const activeTurnIdByThread = overrides.activeTurnIdByThread ?? {};
  const getActiveTurnIdForThread = vi.fn(
    (threadId: string) => activeTurnIdByThread[threadId] ?? null,
  );
  const establishedThreadIds = overrides.establishedThreadIds ?? [];
  const hasEstablishedThreadItems = vi.fn((threadId: string) =>
    establishedThreadIds.includes(threadId),
  );
  const renamePendingMemoryCaptureKey = vi.fn();
  // chat-stream-render-isolation-2026-06 task 8: workspace-scope ref
  // shape migrated from Set<threadId> to Map<workspaceId, Map<threadId, true>>.
  const seedWorkspace = overrides.activeWorkspaceId ?? "ws-1";
  const seedWorkspaceScoped = (ids: string[]) => {
    const store = new Map<string, Map<string, true>>();
    if (ids.length === 0) {
      return store;
    }
    const bucket = new Map<string, true>();
    for (const id of ids) {
      bucket.set(id, true);
    }
    store.set(seedWorkspace, bucket);
    return store;
  };
  const pendingInterruptsRef = {
    current: seedWorkspaceScoped(overrides.pendingInterrupts ?? []),
  };
  const interruptedThreadsRef = {
    current: seedWorkspaceScoped(overrides.interruptedThreads ?? []),
  };
  const codexCompactionInFlightByThreadRef = {
    current: {} as Record<string, boolean>,
  };

  const { result } = renderHook(() =>
    useThreadTurnEvents({
      activeThreadId: overrides.activeThreadId ?? null,
      dispatch,
      getCustomName,
      resolveCanonicalThreadId,
      isAutoTitlePending,
      isThreadHidden,
      markProcessing,
      markReviewing,
      setActiveTurnId,
      codexCompactionInFlightByThreadRef,
      pendingInterruptsRef,
      interruptedThreadsRef,
      pushThreadErrorMessage,
      safeMessageActivity,
      recordThreadActivity,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
      resolvePendingThreadForTurn,
      getActiveTurnIdForThread,
      hasEstablishedThreadItems,
      renamePendingMemoryCaptureKey,
      onDebug: overrides.onDebug,
    }),
  );

  return {
    result,
    dispatch,
    getCustomName,
    resolveCanonicalThreadId,
    isAutoTitlePending,
    isThreadHidden,
    markProcessing,
    markReviewing,
    setActiveTurnId,
    pushThreadErrorMessage,
    safeMessageActivity,
    recordThreadActivity,
    renameCustomNameKey,
    renameAutoTitlePendingKey,
    renameThreadTitleMapping,
    resolvePendingThreadForSession,
    resolvePendingThreadForTurn,
    getActiveTurnIdForThread,
    hasEstablishedThreadItems,
    renamePendingMemoryCaptureKey,
    codexCompactionInFlightByThreadRef,
    pendingInterruptsRef,
    interruptedThreadsRef,
  };
};

describe("useThreadTurnEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGlobalRuntimeNotices();
    resetCodexPendingPrewarmForTests();
    resetLiveAssistantTextChannelForTests();
    vi.mocked(engineInterrupt).mockResolvedValue();
    vi.mocked(engineInterruptTurn).mockResolvedValue();
  });

  it("upserts thread summaries when a thread starts", () => {
    const { result, dispatch, recordThreadActivity, safeMessageActivity } =
      makeOptions();

    act(() => {
      result.current.onThreadStarted("ws-1", {
        id: "thread-1",
        preview: "A brand new thread",
        updatedAt: 1_700_000_000_000,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "markCodexAcceptedTurn",
      threadId: "thread-1",
      fact: "empty-draft",
      source: "thread-start",
      timestamp: expect.any(Number),
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadTimestamp",
      workspaceId: "ws-1",
      threadId: "thread-1",
      timestamp: 1_700_000_000_000,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadName",
      workspaceId: "ws-1",
      threadId: "thread-1",
      name: "A brand new thread",
    });
    expect(recordThreadActivity).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      1_700_000_000_000,
    );
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("projects live Codex subagent identity in the initial ensure action", () => {
    const { result, dispatch } = makeOptions();

    act(() => {
      result.current.onThreadStarted("ws-1", {
        id: "child-thread",
        parentThreadId: "parent-thread",
        agentNickname: "Herschel",
        preview: "我",
        source: {
          subagent: {
            thread_spawn: {
              parent_thread_id: "parent-thread",
              depth: 1,
              agent_path: "/root/cohesion_audit",
              agent_nickname: "Herschel",
              agent_role: null,
            },
          },
        },
        threadSource: "subagent",
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "child-thread",
      engine: "codex",
      parentThreadId: "parent-thread",
      name: "Herschel",
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadName",
        workspaceId: "ws-1",
        threadId: "child-thread",
        name: "我",
      }),
    );
  });

  it("falls back to live subagent source metadata when the nickname is absent", () => {
    const { result, dispatch } = makeOptions();

    act(() => {
      result.current.onThreadStarted("ws-1", {
        id: "child-thread",
        preview: "我",
        source: {
          subagent: {
            thread_spawn: {
              parent_thread_id: "parent-thread",
              depth: 1,
              agent_path: "C:\\agents\\cohesion_audit",
              agent_nickname: null,
              agent_role: null,
            },
          },
        },
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "child-thread",
      engine: "codex",
      parentThreadId: "parent-thread",
      name: "cohesion_audit",
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadName",
        workspaceId: "ws-1",
        threadId: "child-thread",
        name: "我",
      }),
    );
  });

  it("suppresses the thread/started raised by an in-flight codex prewarm", () => {
    // 乐观创建刚发出 thread/start，真 id 未知：此刻到达的 codex thread/started
    // 只可能是预热自己触发的，放进侧边栏就会与 codex-pending-* 并列成两条空会话。
    registerCodexPrewarm("ws-1", "codex-pending-1");
    const { result, dispatch, recordThreadActivity, safeMessageActivity } =
      makeOptions();

    act(() => {
      result.current.onThreadStarted("ws-1", {
        id: "thread-1",
        preview: "A brand new thread",
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(recordThreadActivity).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();
  });

  it("narrows prewarm suppression to the real thread id once the start resolves", () => {
    registerCodexPrewarm("ws-1", "codex-pending-1");
    settleCodexPrewarm("codex-pending-1", "thread-1");
    const { result, dispatch } = makeOptions();

    act(() => {
      result.current.onThreadStarted("ws-1", { id: "thread-1" });
    });
    expect(dispatch).not.toHaveBeenCalled();

    act(() => {
      result.current.onThreadStarted("ws-1", { id: "thread-other" });
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-other",
      engine: "codex",
    });
  });

  it("stops suppressing the real thread once the pending thread is finalized", () => {
    registerCodexPrewarm("ws-1", "codex-pending-1");
    settleCodexPrewarm("codex-pending-1", "thread-1");
    releaseCodexPrewarm("codex-pending-1");
    const { result, dispatch } = makeOptions();

    act(() => {
      result.current.onThreadStarted("ws-1", { id: "thread-1" });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
  });

  it("still hides codex background helper threads inside a prewarm window", () => {
    registerCodexPrewarm("ws-1", "codex-pending-1");
    const { result, dispatch } = makeOptions();

    act(() => {
      result.current.onThreadStarted("ws-1", {
        id: "thread-helper",
        preview:
          "Generate a concise title for a coding chat thread from the first user message.",
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "hideThread",
      workspaceId: "ws-1",
      threadId: "thread-helper",
    });
  });

  it("keeps codex provider metadata from thread started events", () => {
    const { result, dispatch } = makeOptions();

    act(() => {
      result.current.onThreadStarted("ws-1", {
        id: "thread-provider-a",
        preview: "A provider thread",
        providerProfileId: "provider-a",
        providerProfileSource: "managed",
        providerProfileName: "AskUs",
        providerAvailability: "available",
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-provider-a",
      engine: "codex",
      providerProfileId: "provider-a",
      providerProfileSource: "managed",
      providerProfileName: "AskUs",
      providerAvailability: "available",
    });
  });

  it("does not override custom thread names on thread started", () => {
    const { result, dispatch, getCustomName } = makeOptions();
    getCustomName.mockReturnValue("Custom name");

    act(() => {
      result.current.onThreadStarted("ws-1", {
        id: "thread-2",
        preview: "Preview text",
        updatedAt: 1_700_000_000_100,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-2",
      engine: "codex",
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadName",
        workspaceId: "ws-1",
        threadId: "thread-2",
      }),
    );
  });

  it("does not override thread name when auto-title generation is pending", () => {
    const { result, dispatch, isAutoTitlePending } = makeOptions();
    isAutoTitlePending.mockReturnValue(true);

    act(() => {
      result.current.onThreadStarted("ws-1", {
        id: "thread-3",
        preview: "Preview that should be ignored",
        updatedAt: 1_700_000_000_300,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-3",
      engine: "codex",
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadName",
        workspaceId: "ws-1",
        threadId: "thread-3",
      }),
    );
  });

  it("ignores thread started events for hidden threads", () => {
    const { result, dispatch, isThreadHidden, recordThreadActivity, safeMessageActivity } =
      makeOptions();
    isThreadHidden.mockReturnValue(true);

    act(() => {
      result.current.onThreadStarted("ws-1", {
        id: "thread-hidden",
        preview: "Hidden thread",
        updatedAt: 1_700_000_000_200,
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(recordThreadActivity).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();
  });

  it("suppresses Codex helper threads on thread started", () => {
    const { result, dispatch, recordThreadActivity, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onThreadStarted("ws-1", {
        id: "thread-helper-1",
        preview:
          "## Memory Writing Agent: Phase 2 (Consolidation)\n\nConsolidate raw memories.",
        updatedAt: 1_700_000_000_250,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "hideThread",
      workspaceId: "ws-1",
      threadId: "thread-helper-1",
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ensureThread",
        workspaceId: "ws-1",
        threadId: "thread-helper-1",
      }),
    );
    expect(recordThreadActivity).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();
  });

  it("does not suppress non-Codex threads even when preview resembles helper prompts", () => {
    const { result, dispatch, recordThreadActivity, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onThreadStarted("ws-1", {
        id: "claude:session-1",
        preview:
          "You are generating OpenSpec project context.\nReturn ONLY valid JSON with keys:",
        updatedAt: 1_700_000_000_260,
      });
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "hideThread",
        workspaceId: "ws-1",
        threadId: "claude:session-1",
      }),
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      engine: "claude",
    });
    expect(recordThreadActivity).toHaveBeenCalledWith(
      "ws-1",
      "claude:session-1",
      1_700_000_000_260,
    );
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("marks processing and active turn on turn started", () => {
    const { result, dispatch, markProcessing, setActiveTurnId } = makeOptions();

    act(() => {
      result.current.onTurnStarted("ws-1", "thread-1", "turn-1");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(markProcessing).toHaveBeenCalledWith("thread-1", true);
    expect(setActiveTurnId).toHaveBeenCalledWith("thread-1", "turn-1");
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("interrupts immediately when a pending interrupt is queued", () => {
    const { result, markProcessing, setActiveTurnId, pendingInterruptsRef } =
      makeOptions({ pendingInterrupts: ["thread-1"] });
    vi.mocked(interruptTurn).mockResolvedValue({});

    act(() => {
      result.current.onTurnStarted("ws-1", "thread-1", "turn-2");
    });

    expect(workspaceScopedHas(pendingInterruptsRef.current, "ws-1", "thread-1")).toBe(false);
    expect(interruptTurn).toHaveBeenCalledWith("ws-1", "thread-1", "turn-2");
    expect(markProcessing).not.toHaveBeenCalled();
    expect(setActiveTurnId).not.toHaveBeenCalled();
  });

  it("routes pending gemini interrupts through engine interrupt only", () => {
    const { result, markProcessing, setActiveTurnId, pendingInterruptsRef } =
      makeOptions({ pendingInterrupts: ["gemini:session-1"] });
    vi.mocked(engineInterruptTurn).mockResolvedValue();

    act(() => {
      result.current.onTurnStarted("ws-1", "gemini:session-1", "turn-2");
    });

    expect(workspaceScopedHas(pendingInterruptsRef.current, "ws-1", "gemini:session-1")).toBe(false);
    expect(engineInterruptTurn).toHaveBeenCalledWith("ws-1", "turn-2", "gemini");
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(setActiveTurnId).not.toHaveBeenCalled();
  });

  it("routes pending claude interrupts through turn-scoped engine interrupt", () => {
    const { result, pendingInterruptsRef } =
      makeOptions({ pendingInterrupts: ["claude:session-1"] });

    act(() => {
      result.current.onTurnStarted("ws-1", "claude:session-1", "turn-7");
    });

    expect(workspaceScopedHas(pendingInterruptsRef.current, "ws-1", "claude:session-1")).toBe(false);
    expect(engineInterruptTurn).toHaveBeenCalledWith("ws-1", "turn-7", "claude");
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("clears pending interrupt and active turn on turn completed", () => {
    const {
      result,
      dispatch,
      markProcessing,
      setActiveTurnId,
      pendingInterruptsRef,
    } =
      makeOptions({ pendingInterrupts: ["thread-1"] });

    act(() => {
      result.current.onTurnCompleted("ws-1", "thread-1", "turn-1");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "finalizePendingToolStatuses",
      threadId: "thread-1",
      status: "completed",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "clearProcessingGeneratedImages",
      threadId: "thread-1",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "settleThreadPlanInProgress",
      threadId: "thread-1",
      targetStatus: "completed",
    });
    expect(markProcessing).toHaveBeenCalledWith("thread-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("thread-1", null);
    expect(workspaceScopedHas(pendingInterruptsRef.current, "ws-1", "thread-1")).toBe(false);
  });

  it("drains externalized Grok text before marking the assistant message final", () => {
    const threadId = "grok:session-1";
    const itemId = "assistant-1";
    const shellText = "直接";
    const tailText = "说我眼睛里扫到的东西";
    const { result, dispatch } = makeOptions({
      activeTurnIdByThread: { [threadId]: "turn-1" },
    });
    appendLiveAssistantText(threadId, itemId, shellText);
    appendLiveAssistantText(threadId, itemId, tailText);

    act(() => {
      result.current.onTurnCompleted("ws-1", threadId, "turn-1");
    });

    const actions = dispatch.mock.calls.map(
      ([action]) => action as ThreadAction,
    );
    const drainIndex = actions.findIndex(
      (action) => action.type === "appendAgentDelta",
    );
    const finalIndex = actions.findIndex(
      (action) => action.type === "markLatestAssistantMessageFinal",
    );
    expect(actions[drainIndex]).toEqual({
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId,
      itemId,
      delta: tailText,
      hasCustomName: true,
    });
    expect(drainIndex).toBeLessThan(finalIndex);
    expect(getLiveAssistantTextSnapshot(threadId)).toBeNull();

    const shellItem: ConversationItem = {
      id: itemId,
      kind: "message",
      role: "assistant",
      text: shellText,
      isFinal: false,
    };
    const baseState: ThreadState = {
      ...initialState,
      itemsByThread: { [threadId]: [shellItem] },
    };
    const textSettlementActions = actions.filter(
      (action) =>
        action.type === "appendAgentDelta" ||
        action.type === "markLatestAssistantMessageFinal",
    );
    const settledState = textSettlementActions.reduce<ThreadState>(
      (state, action) => threadReducer(state, action),
      baseState,
    );
    const settledItem = settledState.itemsByThread[threadId]?.[0];
    expect(settledItem).toMatchObject({
      id: itemId,
      kind: "message",
      role: "assistant",
      text: `${shellText}${tailText}`,
      isFinal: true,
    });
  });

  it("also settles pending alias thread on completed event", () => {
    const {
      result,
      dispatch,
      markProcessing,
      setActiveTurnId,
      resolvePendingThreadForSession,
    } = makeOptions({
      activeTurnIdByThread: {
        "opencode-pending-abc": "turn-1",
      },
    });
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "opencode" ? "opencode-pending-abc" : null,
    );

    act(() => {
      result.current.onTurnCompleted("ws-1", "opencode:session-1", "turn-1");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "finalizePendingToolStatuses",
      threadId: "opencode:session-1",
      status: "completed",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "settleThreadPlanInProgress",
      threadId: "opencode:session-1",
      targetStatus: "completed",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "finalizePendingToolStatuses",
      threadId: "opencode-pending-abc",
      status: "completed",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "settleThreadPlanInProgress",
      threadId: "opencode-pending-abc",
      targetStatus: "completed",
    });
    expect(markProcessing).toHaveBeenCalledWith("opencode:session-1", false);
    expect(markProcessing).toHaveBeenCalledWith("opencode-pending-abc", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("opencode:session-1", null);
    expect(setActiveTurnId).toHaveBeenCalledWith("opencode-pending-abc", null);
  });

  it("settles a turn-bound pending alias even when session resolution misses it", () => {
    const {
      result,
      markProcessing,
      setActiveTurnId,
      resolvePendingThreadForSession,
      resolvePendingThreadForTurn,
    } = makeOptions({
      activeTurnIdByThread: {
        "opencode-pending-turn-bound": "turn-1",
      },
    });
    resolvePendingThreadForSession.mockReturnValue(null);
    resolvePendingThreadForTurn.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode", turnId: string | null | undefined) =>
        engine === "opencode" && turnId === "turn-1" ? "opencode-pending-turn-bound" : null,
    );

    act(() => {
      result.current.onTurnCompleted("ws-1", "opencode:session-1", "turn-1");
    });

    expect(markProcessing).toHaveBeenCalledWith("opencode:session-1", false);
    expect(markProcessing).toHaveBeenCalledWith("opencode-pending-turn-bound", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("opencode:session-1", null);
    expect(setActiveTurnId).toHaveBeenCalledWith("opencode-pending-turn-bound", null);
  });

  it("falls back to turn-bound alias when session resolution returns a mismatched pending thread", () => {
    const {
      result,
      markProcessing,
      setActiveTurnId,
      resolvePendingThreadForSession,
      resolvePendingThreadForTurn,
    } = makeOptions({
      activeTurnIdByThread: {
        "opencode-pending-wrong": "turn-2",
        "opencode-pending-right": "turn-1",
      },
    });
    resolvePendingThreadForSession.mockReturnValue("opencode-pending-wrong");
    resolvePendingThreadForTurn.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode", turnId: string | null | undefined) =>
        engine === "opencode" && turnId === "turn-1" ? "opencode-pending-right" : null,
    );

    act(() => {
      result.current.onTurnCompleted("ws-1", "opencode:session-1", "turn-1");
    });

    expect(markProcessing).toHaveBeenCalledWith("opencode:session-1", false);
    expect(markProcessing).toHaveBeenCalledWith("opencode-pending-right", false);
    expect(markProcessing).not.toHaveBeenCalledWith("opencode-pending-wrong", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("opencode:session-1", null);
    expect(setActiveTurnId).toHaveBeenCalledWith("opencode-pending-right", null);
    expect(setActiveTurnId).not.toHaveBeenCalledWith("opencode-pending-wrong", null);
  });

  it("does not clear a newer canonical turn when settling an older pending alias", () => {
    const {
      result,
      markProcessing,
      setActiveTurnId,
      resolvePendingThreadForSession,
    } = makeOptions({
      activeTurnIdByThread: {
        "opencode:session-1": "turn-2",
        "opencode-pending-abc": "turn-1",
      },
    });
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "opencode" ? "opencode-pending-abc" : null,
    );

    act(() => {
      result.current.onTurnCompleted("ws-1", "opencode:session-1", "turn-1");
    });

    expect(markProcessing).not.toHaveBeenCalledWith("opencode:session-1", false);
    expect(setActiveTurnId).not.toHaveBeenCalledWith("opencode:session-1", null);
    expect(markProcessing).toHaveBeenCalledWith("opencode-pending-abc", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("opencode-pending-abc", null);
  });

  it("records a settlement rejection when completed turn does not match active turn", () => {
    const onDebug = vi.fn();
    const { result, markProcessing, setActiveTurnId } = makeOptions({
      activeTurnIdByThread: { "thread-1": "turn-2" },
      onDebug,
    });

    act(() => {
      result.current.onTurnCompleted("ws-1", "thread-1", "turn-1");
    });

    expect(markProcessing).not.toHaveBeenCalledWith("thread-1", false);
    expect(setActiveTurnId).not.toHaveBeenCalledWith("thread-1", null);
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "client",
        label: "thread/session:turn-settlement:rejected",
        payload: expect.objectContaining({
          diagnosticCategory: "foreground-terminal-settlement",
          settlementResult: "rejected",
          engine: "codex",
          workspaceId: "ws-1",
          threadId: "thread-1",
          turnId: "turn-1",
          incomingTurnId: "turn-1",
          currentActiveTurnId: "turn-2",
          activeTurnId: "turn-2",
          reason: "turn-mismatch",
        }),
      }),
    );
  });

  it("does not settle pending alias thread when turn id does not match", () => {
    const {
      result,
      dispatch,
      markProcessing,
      setActiveTurnId,
      resolvePendingThreadForSession,
    } = makeOptions({
      activeTurnIdByThread: {
        "opencode-pending-abc": "turn-new",
      },
    });
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "opencode" ? "opencode-pending-abc" : null,
    );

    act(() => {
      result.current.onTurnCompleted("ws-1", "opencode:session-1", "turn-old");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "finalizePendingToolStatuses",
      threadId: "opencode:session-1",
      status: "completed",
    });
    expect(dispatch).not.toHaveBeenCalledWith({
      type: "finalizePendingToolStatuses",
      threadId: "opencode-pending-abc",
      status: "completed",
    });
    expect(markProcessing).toHaveBeenCalledWith("opencode:session-1", false);
    expect(markProcessing).not.toHaveBeenCalledWith("opencode-pending-abc", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("opencode:session-1", null);
    expect(setActiveTurnId).not.toHaveBeenCalledWith("opencode-pending-abc", null);
  });

  it("does not settle pending alias thread when completed event has empty turn id", () => {
    const {
      result,
      dispatch,
      markProcessing,
      setActiveTurnId,
      resolvePendingThreadForSession,
    } = makeOptions({
      activeTurnIdByThread: {
        "opencode-pending-abc": "turn-new",
      },
    });
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "opencode" ? "opencode-pending-abc" : null,
    );

    act(() => {
      result.current.onTurnCompleted("ws-1", "opencode:session-1", "");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "finalizePendingToolStatuses",
      threadId: "opencode:session-1",
      status: "completed",
    });
    expect(dispatch).not.toHaveBeenCalledWith({
      type: "finalizePendingToolStatuses",
      threadId: "opencode-pending-abc",
      status: "completed",
    });
    expect(markProcessing).toHaveBeenCalledWith("opencode:session-1", false);
    expect(markProcessing).not.toHaveBeenCalledWith("opencode-pending-abc", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("opencode:session-1", null);
    expect(setActiveTurnId).not.toHaveBeenCalledWith("opencode-pending-abc", null);
  });

  it("renames local mappings when claude pending thread gets real session id", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      renamePendingMemoryCaptureKey,
    } = makeOptions();

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "claude-pending-abc",
        "session-xyz",
      );
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: "claude-pending-abc",
      newThreadId: "claude:session-xyz",
    });
    expect(renameCustomNameKey).toHaveBeenCalledWith(
      "ws-1",
      "claude-pending-abc",
      "claude:session-xyz",
    );
    expect(renameAutoTitlePendingKey).toHaveBeenCalledWith(
      "ws-1",
      "claude-pending-abc",
      "claude:session-xyz",
    );
    expect(renamePendingMemoryCaptureKey).toHaveBeenCalledWith(
      "claude-pending-abc",
      "claude:session-xyz",
    );
    expect(renameThreadTitleMapping).toHaveBeenCalledWith(
      "ws-1",
      "claude-pending-abc",
      "claude:session-xyz",
    );
  });

  it("migrates interrupt guards when claude pending thread gets real session id", () => {
    const {
      result,
      pendingInterruptsRef,
      interruptedThreadsRef,
    } = makeOptions({
      pendingInterrupts: ["claude-pending-abc"],
      interruptedThreads: ["claude-pending-abc"],
    });

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "claude-pending-abc",
        "session-xyz",
      );
    });

    expect(workspaceScopedHas(pendingInterruptsRef.current, "ws-1", "claude-pending-abc")).toBe(false);
    expect(workspaceScopedHas(pendingInterruptsRef.current, "ws-1", "claude:session-xyz")).toBe(true);
    expect(workspaceScopedHas(interruptedThreadsRef.current, "ws-1", "claude-pending-abc")).toBe(false);
    expect(workspaceScopedHas(interruptedThreadsRef.current, "ws-1", "claude:session-xyz")).toBe(true);
  });

  it("executes migrated pending interrupt immediately when finalized thread already has an active turn", () => {
    const {
      result,
      pendingInterruptsRef,
    } = makeOptions({
      pendingInterrupts: ["claude-pending-abc"],
      activeTurnIdByThread: { "claude:session-xyz": "turn-42" },
    });

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "claude-pending-abc",
        "session-xyz",
      );
    });

    expect(engineInterruptTurn).toHaveBeenCalledWith("ws-1", "turn-42", "claude");
    expect(workspaceScopedHas(pendingInterruptsRef.current, "ws-1", "claude:session-xyz")).toBe(false);
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("renames local mappings when opencode pending thread gets real session id", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
    } = makeOptions();

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "opencode-pending-abc",
        "session-xyz",
      );
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: "opencode-pending-abc",
      newThreadId: "opencode:session-xyz",
    });
    expect(renameCustomNameKey).toHaveBeenCalledWith(
      "ws-1",
      "opencode-pending-abc",
      "opencode:session-xyz",
    );
    expect(renameAutoTitlePendingKey).toHaveBeenCalledWith(
      "ws-1",
      "opencode-pending-abc",
      "opencode:session-xyz",
    );
    expect(renameThreadTitleMapping).toHaveBeenCalledWith(
      "ws-1",
      "opencode-pending-abc",
      "opencode:session-xyz",
    );
  });

  it("migrates pending interrupt guards when opencode pending thread gets real session id", () => {
    const {
      result,
      pendingInterruptsRef,
      interruptedThreadsRef,
    } = makeOptions({
      pendingInterrupts: ["opencode-pending-abc"],
      interruptedThreads: ["opencode-pending-abc"],
    });

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "opencode-pending-abc",
        "session-xyz",
      );
    });

    expect(workspaceScopedHas(pendingInterruptsRef.current, "ws-1", "opencode-pending-abc")).toBe(false);
    expect(workspaceScopedHas(pendingInterruptsRef.current, "ws-1", "opencode:session-xyz")).toBe(true);
    expect(workspaceScopedHas(interruptedThreadsRef.current, "ws-1", "opencode-pending-abc")).toBe(false);
    expect(workspaceScopedHas(interruptedThreadsRef.current, "ws-1", "opencode:session-xyz")).toBe(true);
  });

  it("does not fallback to pending when event thread id is same-engine finalized", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
    } = makeOptions();
    resolvePendingThreadForSession.mockReturnValue("opencode-pending-active");

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "opencode:temp",
        "session-xyz",
      );
    });

    expect(resolvePendingThreadForSession).toHaveBeenCalledWith("ws-1", "opencode");
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renameThreadId",
      }),
    );
    expect(renameCustomNameKey).not.toHaveBeenCalled();
    expect(renameAutoTitlePendingKey).not.toHaveBeenCalled();
    expect(renameThreadTitleMapping).not.toHaveBeenCalled();
  });

  it("does not remap pending thread when event thread id is already finalized", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
      renamePendingMemoryCaptureKey,
    } = makeOptions();
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "claude" ? "claude-pending-active" : null,
    );

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "claude:session-xyz",
        "session-xyz",
      );
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renameThreadId",
      }),
    );
    expect(renameCustomNameKey).not.toHaveBeenCalled();
    expect(renameAutoTitlePendingKey).not.toHaveBeenCalled();
    expect(renamePendingMemoryCaptureKey).not.toHaveBeenCalled();
    expect(renameThreadTitleMapping).not.toHaveBeenCalled();
  });

  it("rebinds active pending thread when session update arrives with finalized thread id", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
      renamePendingMemoryCaptureKey,
    } = makeOptions({
      activeThreadId: "claude-pending-active",
    });
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "claude" ? "claude-pending-active" : null,
    );

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "claude:session-xyz",
        "session-xyz",
      );
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: "claude-pending-active",
      newThreadId: "claude:session-xyz",
    });
    expect(renameCustomNameKey).toHaveBeenCalledWith(
      "ws-1",
      "claude-pending-active",
      "claude:session-xyz",
    );
    expect(renameAutoTitlePendingKey).toHaveBeenCalledWith(
      "ws-1",
      "claude-pending-active",
      "claude:session-xyz",
    );
    expect(renamePendingMemoryCaptureKey).toHaveBeenCalledWith(
      "claude-pending-active",
      "claude:session-xyz",
    );
    expect(renameThreadTitleMapping).toHaveBeenCalledWith(
      "ws-1",
      "claude-pending-active",
      "claude:session-xyz",
    );
  });

  it("rebinds the anchored Claude pending thread when the active selection already points at the finalized target", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
      renamePendingMemoryCaptureKey,
    } = makeOptions({
      activeThreadId: "claude:session-xyz",
    });
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "claude" ? "claude-pending-active" : null,
    );

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "claude:session-xyz",
        "session-xyz",
      );
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: "claude-pending-active",
      newThreadId: "claude:session-xyz",
    });
    expect(renameCustomNameKey).toHaveBeenCalledWith(
      "ws-1",
      "claude-pending-active",
      "claude:session-xyz",
    );
    expect(renameAutoTitlePendingKey).toHaveBeenCalledWith(
      "ws-1",
      "claude-pending-active",
      "claude:session-xyz",
    );
    expect(renamePendingMemoryCaptureKey).toHaveBeenCalledWith(
      "claude-pending-active",
      "claude:session-xyz",
    );
    expect(renameThreadTitleMapping).toHaveBeenCalledWith(
      "ws-1",
      "claude-pending-active",
      "claude:session-xyz",
    );
  });

  it("does not steal the active pending thread when an established thread re-announces its session id", () => {
    // Regression: an in-flight conversation (claude:session-old) emits
    // thread/started with its own session id on every turn. A freshly created
    // pending tab must not be renamed onto it, or the new conversation's
    // optimistic user message merges into the old timeline.
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      renamePendingMemoryCaptureKey,
      resolvePendingThreadForSession,
    } = makeOptions({
      activeThreadId: "claude-pending-active",
      establishedThreadIds: ["claude:session-old"],
      activeTurnIdByThread: {
        "claude:session-old": "turn-old",
        "claude-pending-active": "turn-new",
      },
    });
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "claude" ? "claude-pending-active" : null,
    );

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "claude:session-old",
        "session-old",
        "claude",
        "turn-old",
      );
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renameThreadId",
      }),
    );
    expect(renameCustomNameKey).not.toHaveBeenCalled();
    expect(renameAutoTitlePendingKey).not.toHaveBeenCalled();
    expect(renamePendingMemoryCaptureKey).not.toHaveBeenCalled();
    expect(renameThreadTitleMapping).not.toHaveBeenCalled();
  });

  it("prefers turn-bound Claude pending thread when concurrent realtime sessions exist", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      renamePendingMemoryCaptureKey,
      resolvePendingThreadForSession,
      resolvePendingThreadForTurn,
    } = makeOptions({
      activeThreadId: "claude-pending-other",
      activeTurnIdByThread: {
        "claude-pending-target": "turn-target",
        "claude-pending-other": "turn-other",
      },
    });
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "claude" ? "claude-pending-other" : null,
    );
    resolvePendingThreadForTurn.mockImplementation(
      (
        _workspaceId: string,
        engine: "claude" | "gemini" | "opencode",
        turnId: string | null | undefined,
      ) => (engine === "claude" && turnId === "turn-target" ? "claude-pending-target" : null),
    );

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "claude:session-xyz",
        "session-xyz",
        "claude",
        "turn-target",
      );
    });

    expect(resolvePendingThreadForTurn).toHaveBeenCalledWith(
      "ws-1",
      "claude",
      "turn-target",
    );
    expect(resolvePendingThreadForSession).toHaveBeenCalledWith("ws-1", "claude");
    expect(dispatch).toHaveBeenCalledWith({
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: "claude-pending-target",
      newThreadId: "claude:session-xyz",
    });
    expect(renameCustomNameKey).toHaveBeenCalledWith(
      "ws-1",
      "claude-pending-target",
      "claude:session-xyz",
    );
    expect(renameAutoTitlePendingKey).toHaveBeenCalledWith(
      "ws-1",
      "claude-pending-target",
      "claude:session-xyz",
    );
    expect(renamePendingMemoryCaptureKey).toHaveBeenCalledWith(
      "claude-pending-target",
      "claude:session-xyz",
    );
    expect(renameThreadTitleMapping).toHaveBeenCalledWith(
      "ws-1",
      "claude-pending-target",
      "claude:session-xyz",
    );
  });

  it("promotes and settles an unprefixed Kimi provisional owner in the same tick", () => {
    const provisionalThreadId = "01a-product-provisional";
    const canonicalThreadId = "kimi:session-xyz";
    const turnId = "kimi-turn-target";
    const {
      result,
      dispatch,
      markProcessing,
      setActiveTurnId,
      resolvePendingThreadForTurn,
      renamePendingMemoryCaptureKey,
    } = makeOptions({
      activeThreadId: provisionalThreadId,
      activeTurnIdByThread: {
        [provisionalThreadId]: turnId,
      },
    });
    resolvePendingThreadForTurn.mockImplementation(
      (_workspaceId, engine, candidateTurnId) =>
        engine === "kimi" && candidateTurnId === turnId
          ? provisionalThreadId
          : null,
    );

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        provisionalThreadId,
        "session-xyz",
        "kimi",
        turnId,
      );
      result.current.onTurnCompleted("ws-1", canonicalThreadId, turnId);
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: provisionalThreadId,
      newThreadId: canonicalThreadId,
    });
    expect(renamePendingMemoryCaptureKey).toHaveBeenCalledWith(
      provisionalThreadId,
      canonicalThreadId,
    );
    expect(markProcessing).toHaveBeenCalledWith(canonicalThreadId, false);
    expect(markProcessing).toHaveBeenCalledWith(provisionalThreadId, false);
    expect(setActiveTurnId).toHaveBeenCalledWith(canonicalThreadId, null);
    expect(setActiveTurnId).toHaveBeenCalledWith(provisionalThreadId, null);
  });

  it("renames Claude fork thread when realtime session id is finalized", () => {
    const forkThreadId = "claude-fork:parent-session:local-1";
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      renamePendingMemoryCaptureKey,
      resolvePendingThreadForSession,
      resolvePendingThreadForTurn,
    } = makeOptions({
      activeThreadId: forkThreadId,
      activeTurnIdByThread: {
        [forkThreadId]: "turn-target",
      },
    });
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "claude" ? forkThreadId : null,
    );
    resolvePendingThreadForTurn.mockImplementation(
      (
        _workspaceId: string,
        engine: "claude" | "gemini" | "opencode",
        turnId: string | null | undefined,
      ) => (engine === "claude" && turnId === "turn-target" ? forkThreadId : null),
    );

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "claude:child-session",
        "child-session",
        "claude",
        "turn-target",
      );
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: forkThreadId,
      newThreadId: "claude:child-session",
    });
    expect(renameCustomNameKey).toHaveBeenCalledWith(
      "ws-1",
      forkThreadId,
      "claude:child-session",
    );
    expect(renameAutoTitlePendingKey).toHaveBeenCalledWith(
      "ws-1",
      forkThreadId,
      "claude:child-session",
    );
    expect(renamePendingMemoryCaptureKey).toHaveBeenCalledWith(
      forkThreadId,
      "claude:child-session",
    );
    expect(renameThreadTitleMapping).toHaveBeenCalledWith(
      "ws-1",
      forkThreadId,
      "claude:child-session",
    );
  });

  it("prefers turn-bound Claude pending thread for non-prefixed realtime session updates", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      renamePendingMemoryCaptureKey,
      resolvePendingThreadForSession,
      resolvePendingThreadForTurn,
    } = makeOptions({
      activeThreadId: "claude-pending-other",
      activeTurnIdByThread: {
        "claude-pending-target": "turn-target",
        "claude-pending-other": "turn-other",
      },
    });
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "claude" ? "claude-pending-other" : null,
    );
    resolvePendingThreadForTurn.mockImplementation(
      (
        _workspaceId: string,
        engine: "claude" | "gemini" | "opencode",
        turnId: string | null | undefined,
      ) => (engine === "claude" && turnId === "turn-target" ? "claude-pending-target" : null),
    );

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "session-raw-id",
        "session-xyz",
        "claude",
        "turn-target",
      );
    });

    expect(resolvePendingThreadForTurn).toHaveBeenCalledWith(
      "ws-1",
      "claude",
      "turn-target",
    );
    expect(resolvePendingThreadForSession).toHaveBeenCalledWith("ws-1", "claude");
    expect(dispatch).toHaveBeenCalledWith({
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: "claude-pending-target",
      newThreadId: "claude:session-xyz",
    });
    expect(renameCustomNameKey).toHaveBeenCalledWith(
      "ws-1",
      "claude-pending-target",
      "claude:session-xyz",
    );
    expect(renameAutoTitlePendingKey).toHaveBeenCalledWith(
      "ws-1",
      "claude-pending-target",
      "claude:session-xyz",
    );
    expect(renamePendingMemoryCaptureKey).toHaveBeenCalledWith(
      "claude-pending-target",
      "claude:session-xyz",
    );
    expect(renameThreadTitleMapping).toHaveBeenCalledWith(
      "ws-1",
      "claude-pending-target",
      "claude:session-xyz",
    );
  });

  it("does not rename finalized opencode thread when no pending mapping exists", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
    } = makeOptions();
    resolvePendingThreadForSession.mockReturnValue(null);

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "opencode:session-old",
        "session-new",
      );
    });

    expect(resolvePendingThreadForSession).toHaveBeenCalledWith("ws-1", "opencode");
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renameThreadId",
      }),
    );
    expect(renameCustomNameKey).not.toHaveBeenCalled();
    expect(renameAutoTitlePendingKey).not.toHaveBeenCalled();
    expect(renameThreadTitleMapping).not.toHaveBeenCalled();
  });

  it("does not rename finalized claude thread when no pending mapping exists", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
    } = makeOptions();
    resolvePendingThreadForSession.mockReturnValue(null);

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "claude:session-old",
        "session-new",
      );
    });

    expect(resolvePendingThreadForSession).toHaveBeenCalledWith("ws-1", "claude");
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renameThreadId",
      }),
    );
    expect(renameCustomNameKey).not.toHaveBeenCalled();
    expect(renameAutoTitlePendingKey).not.toHaveBeenCalled();
    expect(renameThreadTitleMapping).not.toHaveBeenCalled();
  });

  it("does not rebind active finalized claude thread when session id rotates", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      renamePendingMemoryCaptureKey,
      resolvePendingThreadForSession,
    } = makeOptions({
      activeThreadId: "claude:session-old",
    });
    resolvePendingThreadForSession.mockReturnValue(null);

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "claude:session-old",
        "session-new",
      );
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renameThreadId",
      }),
    );
    expect(renameCustomNameKey).not.toHaveBeenCalled();
    expect(renameAutoTitlePendingKey).not.toHaveBeenCalled();
    expect(renamePendingMemoryCaptureKey).not.toHaveBeenCalled();
    expect(renameThreadTitleMapping).not.toHaveBeenCalled();
  });

  it("infers engine from pending threads when session update thread id has no engine prefix", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
    } = makeOptions({
      activeThreadId: "opencode-pending-active",
    });
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "opencode" ? "opencode-pending-active" : null,
    );

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "session-raw-id",
        "session-xyz",
      );
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: "opencode-pending-active",
      newThreadId: "opencode:session-xyz",
    });
    expect(renameCustomNameKey).toHaveBeenCalledWith(
      "ws-1",
      "opencode-pending-active",
      "opencode:session-xyz",
    );
    expect(renameAutoTitlePendingKey).toHaveBeenCalledWith(
      "ws-1",
      "opencode-pending-active",
      "opencode:session-xyz",
    );
    expect(renameThreadTitleMapping).toHaveBeenCalledWith(
      "ws-1",
      "opencode-pending-active",
      "opencode:session-xyz",
    );
  });

  it("does not rebind non-prefixed session update when resolved pending is not active", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
    } = makeOptions({
      activeThreadId: "opencode-pending-new",
    });
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "opencode" ? "opencode-pending-old" : null,
    );

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "session-raw-id",
        "session-xyz",
      );
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renameThreadId",
      }),
    );
    expect(renameCustomNameKey).not.toHaveBeenCalled();
    expect(renameAutoTitlePendingKey).not.toHaveBeenCalled();
    expect(renameThreadTitleMapping).not.toHaveBeenCalled();
  });

  it("does not rename ambiguously when both claude and opencode pending threads exist", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
    } = makeOptions();
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "opencode" ? "opencode-pending-active" : "claude-pending-active",
    );

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "session-raw-id",
        "session-xyz",
      );
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renameThreadId",
      }),
    );
    expect(renameCustomNameKey).not.toHaveBeenCalled();
    expect(renameAutoTitlePendingKey).not.toHaveBeenCalled();
    expect(renameThreadTitleMapping).not.toHaveBeenCalled();
  });

  it("does not rename ambiguously when both claude and gemini pending threads exist", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
    } = makeOptions();
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "gemini" ? "gemini-pending-active" : "claude-pending-active",
    );

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "session-raw-id",
        "session-xyz",
      );
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renameThreadId",
      }),
    );
    expect(renameCustomNameKey).not.toHaveBeenCalled();
    expect(renameAutoTitlePendingKey).not.toHaveBeenCalled();
    expect(renameThreadTitleMapping).not.toHaveBeenCalled();
  });

  it("does not rename non-prefixed source thread id when no pending mapping exists", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
    } = makeOptions();
    resolvePendingThreadForSession.mockReturnValue(null);

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "2112",
        "ses_abc",
        "opencode",
      );
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renameThreadId",
      }),
    );
    expect(renameCustomNameKey).not.toHaveBeenCalled();
    expect(renameAutoTitlePendingKey).not.toHaveBeenCalled();
    expect(renameThreadTitleMapping).not.toHaveBeenCalled();
  });

  it("dispatches normalized plan updates", () => {
    const { result, dispatch } = makeOptions();
    const normalized = { id: "turn-3", steps: [] };

    vi.mocked(normalizePlanUpdate).mockReturnValue(normalized as never);

    act(() => {
      result.current.onTurnPlanUpdated("ws-1", "thread-1", "turn-3", {
        explanation: "Plan",
        plan: [{ id: "step-1" }],
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadPlan",
      threadId: "thread-1",
      plan: normalized,
    });
  });

  it("dispatches normalized token usage updates", () => {
    const { result, dispatch } = makeOptions();
    const normalized = { total: 123 };

    vi.mocked(normalizeTokenUsage).mockReturnValue(normalized as never);

    act(() => {
      result.current.onThreadTokenUsageUpdated("ws-1", "thread-1", {
        total: 123,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadTokenUsage",
      threadId: "thread-1",
      tokenUsage: normalized,
    });
  });

  it("dispatches normalized rate limits updates", () => {
    const { result, dispatch } = makeOptions();
    const normalized = { primary: { usedPercent: 10 } };

    vi.mocked(normalizeRateLimits).mockReturnValue(normalized as never);

    act(() => {
      result.current.onAccountRateLimitsUpdated("ws-1", { primary: {} });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "setRateLimits",
      workspaceId: "ws-1",
      rateLimits: normalized,
    });
  });

  it("handles turn errors when retries are disabled", () => {
    const {
      result,
      dispatch,
      markProcessing,
      markReviewing,
      setActiveTurnId,
      pushThreadErrorMessage,
      safeMessageActivity,
    } = makeOptions();

    act(() => {
      result.current.onTurnError("ws-1", "thread-1", "turn-1", {
        message: "boom",
        willRetry: false,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "clearProcessingGeneratedImages",
      threadId: "thread-1",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "finalizePendingToolStatuses",
      threadId: "thread-1",
      status: "failed",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "settleThreadPlanInProgress",
      threadId: "thread-1",
      targetStatus: "pending",
    });
    expect(markProcessing).toHaveBeenCalledWith("thread-1", false);
    expect(markReviewing).toHaveBeenCalledWith("thread-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("thread-1", null);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "会话失败：boom",
    );
    expect(getGlobalRuntimeNoticesSnapshot()).toEqual([
      expect.objectContaining({
        severity: "error",
        category: "user-action-error",
        messageKey: "runtimeNotice.error.threadTurnFailed",
        messageParams: {
          engine: "Codex",
          message: "boom",
        },
      }),
    ]);
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("keeps the Shared attempt target on the realtime error row", () => {
    const { result, pushThreadErrorMessage } = makeOptions();
    const executionTargetSnapshot = {
      engine: "claude" as const,
      providerProfileId: "provider-a",
      modelCatalogEntryId: "catalog-a",
      model: "runtime-a",
      reasoning: { effort: "medium" },
      providerProfileNameSnapshot: "Provider A",
      providerProfileSource: "managed" as const,
    };

    act(() => {
      result.current.onTurnError("ws-1", "shared:thread-1", "turn-1", {
        message: "provider rejected",
        willRetry: false,
        executionTargetSnapshot,
      });
    });

    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      "ws-1",
      "shared:thread-1",
      "会话失败：provider rejected",
      executionTargetSnapshot,
    );
  });

  it("does not settle pending alias thread on error when turn id is empty", () => {
    const {
      result,
      dispatch,
      markProcessing,
      markReviewing,
      setActiveTurnId,
      resolvePendingThreadForSession,
    } = makeOptions({
      activeTurnIdByThread: {
        "opencode-pending-abc": "turn-new",
      },
    });
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "opencode" ? "opencode-pending-abc" : null,
    );

    act(() => {
      result.current.onTurnError("ws-1", "opencode:session-1", "", {
        message: "boom",
        willRetry: false,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "finalizePendingToolStatuses",
      threadId: "opencode:session-1",
      status: "failed",
    });
    expect(dispatch).not.toHaveBeenCalledWith({
      type: "finalizePendingToolStatuses",
      threadId: "opencode-pending-abc",
      status: "failed",
    });
    expect(markProcessing).toHaveBeenCalledWith("opencode:session-1", false);
    expect(markProcessing).not.toHaveBeenCalledWith("opencode-pending-abc", false);
    expect(markReviewing).toHaveBeenCalledWith("opencode:session-1", false);
    expect(markReviewing).not.toHaveBeenCalledWith("opencode-pending-abc", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("opencode:session-1", null);
    expect(setActiveTurnId).not.toHaveBeenCalledWith("opencode-pending-abc", null);
  });

  it("ignores turn errors that will retry", () => {
    const { result, dispatch, markProcessing } = makeOptions();

    act(() => {
      result.current.onTurnError("ws-1", "thread-1", "turn-1", {
        message: "boom",
        willRetry: true,
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
  });

  it("settles stalled resume turns without finalizing the whole turn as failed", () => {
    const {
      result,
      dispatch,
      markProcessing,
      markReviewing,
      setActiveTurnId,
      pushThreadErrorMessage,
      safeMessageActivity,
    } = makeOptions();

    act(() => {
      result.current.onTurnStalled("ws-1", "thread-1", "turn-1", {
        message: "resume timeout",
        reasonCode: "resume_timeout",
        stage: "resume-pending",
        source: "user-input-resume",
        startedAtMs: 123,
        timeoutMs: 360_000,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "settleThreadPlanInProgress",
      threadId: "thread-1",
      targetStatus: "pending",
    });
    expect(dispatch).not.toHaveBeenCalledWith({
      type: "finalizePendingToolStatuses",
      threadId: "thread-1",
      status: "failed",
    });
    expect(markProcessing).toHaveBeenCalledWith("thread-1", false);
    expect(markReviewing).toHaveBeenCalledWith("thread-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("thread-1", null);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "threads.turnStalledWithMessage",
    );
    expect(getGlobalRuntimeNoticesSnapshot()).toEqual([
      expect.objectContaining({
        severity: "error",
        category: "user-action-error",
        messageKey: "runtimeNotice.error.threadTurnFailed",
        messageParams: {
          engine: "Codex",
          message: "resume timeout",
        },
      }),
    ]);
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("appends a context compacted message and records activity", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(2222);
    const { result, dispatch, recordThreadActivity, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onContextCompacted("ws-1", "thread-1", "turn-9");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: false,
      timestamp: 2222,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendContextCompacted",
      threadId: "thread-1",
      turnId: "turn-9",
    });
    expect(recordThreadActivity).toHaveBeenCalledWith("ws-1", "thread-1", 2222);
    expect(safeMessageActivity).toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  it("marks context compacting immediately when compaction starts", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1111);
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onContextCompacting("ws-1", "thread-1", {
        usagePercent: 96,
        thresholdPercent: 92,
        targetPercent: 70,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: true,
      timestamp: 1111,
    });
    expect(markProcessing).not.toHaveBeenCalledWith("thread-1", true);
    expect(safeMessageActivity).toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  it("writes a visible Codex compaction message and settles it on completion", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(5555);
    const { result, dispatch } = makeOptions();

    act(() => {
      result.current.onContextCompacting("ws-1", "thread-1", {
        usagePercent: 96,
        thresholdPercent: 92,
        targetPercent: 70,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "appendCodexCompactionMessage",
      threadId: "thread-1",
      text: "threads.codexCompactionStarted",
    });

    dispatch.mockClear();

    act(() => {
      result.current.onContextCompacted("ws-1", "thread-1", "turn-10");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: false,
      timestamp: 5555,
      completionStatus: "completed",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "settleCodexCompactionMessage",
      threadId: "thread-1",
      text: "threads.codexCompactionCompleted",
      fallbackMessageId: "context-compacted-codex-compact-thread-1-completed-turn-10",
      appendIfAlreadyCompleted: false,
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "appendContextCompacted" }),
    );

    nowSpy.mockRestore();
  });

  it("writes the same visible message for manual Codex compaction", () => {
    const { result, dispatch } = makeOptions();

    act(() => {
      result.current.onContextCompacting("ws-1", "thread-1", {
        usagePercent: null,
        thresholdPercent: null,
        targetPercent: null,
        auto: false,
        manual: true,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "appendCodexCompactionMessage",
      threadId: "thread-1",
      text: "threads.codexCompactionStarted",
    });

    dispatch.mockClear();

    act(() => {
      result.current.onContextCompacted("ws-1", "thread-1", "manual-turn");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: false,
      timestamp: expect.any(Number),
      completionStatus: "completed",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "settleCodexCompactionMessage",
      threadId: "thread-1",
      text: "threads.codexCompactionCompleted",
      fallbackMessageId: "context-compacted-codex-compact-thread-1-completed-manual-turn",
      appendIfAlreadyCompleted: false,
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "appendContextCompacted" }),
    );
  });

  it("mirrors Codex compaction lifecycle onto canonical thread aliases", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(6666);
    const { result, dispatch, recordThreadActivity, pushThreadErrorMessage } = makeOptions({
      resolveCanonicalThreadId: (threadId) =>
        threadId === "codex-stale-thread" ? "codex-canonical-thread" : threadId,
    });

    act(() => {
      result.current.onContextCompacting("ws-1", "codex-stale-thread", {
        usagePercent: 131,
        thresholdPercent: 130,
        targetPercent: 70,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "codex-stale-thread",
      isCompacting: true,
      timestamp: 6666,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "codex-canonical-thread",
      isCompacting: true,
      timestamp: 6666,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendCodexCompactionMessage",
      threadId: "codex-canonical-thread",
      text: "threads.codexCompactionStarted",
    });
    expect(recordThreadActivity).toHaveBeenCalledWith(
      "ws-1",
      "codex-canonical-thread",
      6666,
    );

    dispatch.mockClear();

    act(() => {
      result.current.onContextCompacted("ws-1", "codex-stale-thread", "turn-compact");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "settleCodexCompactionMessage",
      threadId: "codex-stale-thread",
      text: "threads.codexCompactionCompleted",
      fallbackMessageId: "context-compacted-codex-compact-codex-stale-thread-completed-turn-compact",
      appendIfAlreadyCompleted: false,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "settleCodexCompactionMessage",
      threadId: "codex-canonical-thread",
      text: "threads.codexCompactionCompleted",
      fallbackMessageId: "context-compacted-codex-compact-codex-canonical-thread-completed-turn-compact",
      appendIfAlreadyCompleted: false,
    });

    dispatch.mockClear();

    act(() => {
      result.current.onContextCompactionFailed(
        "ws-1",
        "codex-stale-thread",
        "alias route failed",
      );
    });

    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      "ws-1",
      "codex-canonical-thread",
      "threads.contextCompactionFailedWithMessage",
    );

    nowSpy.mockRestore();
  });

  it("falls back to synthetic turn id when context compacted event has no turn id", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(3333);
    const { result, dispatch } = makeOptions();

    act(() => {
      result.current.onContextCompacted("ws-1", "thread-1", "");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "appendContextCompacted",
      threadId: "thread-1",
      turnId: "auto-3333",
    });

    nowSpy.mockRestore();
  });

  it("treats payload-less completion as Codex compaction when manual compact already marked the thread in flight", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(3333);
    const { result, dispatch, codexCompactionInFlightByThreadRef } = makeOptions();
    codexCompactionInFlightByThreadRef.current["thread-1"] = true;

    act(() => {
      result.current.onContextCompacted("ws-1", "thread-1", "");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "settleCodexCompactionMessage",
      threadId: "thread-1",
      text: "threads.codexCompactionCompleted",
      fallbackMessageId: "context-compacted-codex-compact-thread-1-completed-auto-3333",
      appendIfAlreadyCompleted: false,
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "appendContextCompacted" }),
    );
    expect(codexCompactionInFlightByThreadRef.current["thread-1"]).toBeUndefined();

    nowSpy.mockRestore();
  });

  it("appends a fresh completed fallback when Codex completion arrives without a visible start", () => {
    const { result, dispatch } = makeOptions();

    act(() => {
      result.current.onContextCompacted("ws-1", "thread-1", "turn-20", {
        auto: true,
        manual: false,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: false,
      timestamp: expect.any(Number),
      completionStatus: "completed",
      source: "auto",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "settleCodexCompactionMessage",
      threadId: "thread-1",
      text: "threads.codexCompactionCompleted",
      fallbackMessageId: "context-compacted-codex-compact-thread-1-completed-turn-20",
      appendIfAlreadyCompleted: true,
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "appendContextCompacted" }),
    );
  });

  it("pushes thread error when context compaction fails", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(4444);
    const { result, dispatch, pushThreadErrorMessage, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onContextCompactionFailed("ws-1", "thread-1", "rpc failed");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: false,
      timestamp: 4444,
    });
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "threads.contextCompactionFailedWithMessage",
    );
    expect(getGlobalRuntimeNoticesSnapshot()).toEqual([
      expect.objectContaining({
        severity: "error",
        category: "user-action-error",
        messageKey: "runtimeNotice.error.threadTurnFailed",
        messageParams: {
          engine: "Codex",
          message: "rpc failed",
        },
      }),
    ]);
    expect(safeMessageActivity).toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  it("suppresses error message for user-interrupted threads", () => {
    const {
      result,
      dispatch,
      markProcessing,
      markReviewing,
      setActiveTurnId,
      pushThreadErrorMessage,
      safeMessageActivity,
      interruptedThreadsRef,
    } = makeOptions({ interruptedThreads: ["thread-1"] });

    act(() => {
      result.current.onTurnError("ws-1", "thread-1", "turn-1", {
        message: "Session stopped.",
        willRetry: false,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "finalizePendingToolStatuses",
      threadId: "thread-1",
      status: "failed",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "settleThreadPlanInProgress",
      threadId: "thread-1",
      targetStatus: "pending",
    });
    expect(markProcessing).toHaveBeenCalledWith("thread-1", false);
    expect(markReviewing).toHaveBeenCalledWith("thread-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("thread-1", null);
    // Error message should NOT be shown for interrupted threads
    expect(pushThreadErrorMessage).not.toHaveBeenCalled();
    expect(safeMessageActivity).toHaveBeenCalled();
    // Interrupted flag should be cleared
    expect(workspaceScopedHas(interruptedThreadsRef.current, "ws-1", "thread-1")).toBe(false);
  });

  it("keeps gemini interrupted flag until a later terminal cleanup", () => {
    const { result, interruptedThreadsRef, pushThreadErrorMessage } = makeOptions({
      interruptedThreads: ["gemini:session-1"],
    });

    act(() => {
      result.current.onTurnError("ws-1", "gemini:session-1", "turn-1", {
        message: "Session stopped.",
        willRetry: false,
      });
    });

    expect(pushThreadErrorMessage).not.toHaveBeenCalled();
    expect(workspaceScopedHas(interruptedThreadsRef.current, "ws-1", "gemini:session-1")).toBe(true);
  });

  it("clears interrupted thread flag on turn completed", () => {
    const { result, interruptedThreadsRef } = makeOptions({
      interruptedThreads: ["thread-1"],
    });

    act(() => {
      result.current.onTurnCompleted("ws-1", "thread-1", "turn-1");
    });

    expect(workspaceScopedHas(interruptedThreadsRef.current, "ws-1", "thread-1")).toBe(false);
  });

  it("ignores stale turn completed events when a newer active turn is already running", () => {
    const { result, markProcessing, setActiveTurnId, dispatch, safeMessageActivity } =
      makeOptions({
        activeTurnIdByThread: { "thread-1": "turn-2" },
      });

    act(() => {
      result.current.onTurnCompleted("ws-1", "thread-1", "turn-1");
    });

    expect(markProcessing).not.toHaveBeenCalledWith("thread-1", false);
    expect(setActiveTurnId).not.toHaveBeenCalledWith("thread-1", null);
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "finalizePendingToolStatuses",
        threadId: "thread-1",
      }),
    );
    expect(safeMessageActivity).not.toHaveBeenCalled();
  });

  it("ignores stale turn error events when a newer active turn is already running", () => {
    const {
      result,
      markProcessing,
      markReviewing,
      setActiveTurnId,
      pushThreadErrorMessage,
      safeMessageActivity,
    } = makeOptions({
      activeTurnIdByThread: { "thread-1": "turn-2" },
    });

    act(() => {
      result.current.onTurnError("ws-1", "thread-1", "turn-1", {
        message: "Session stopped.",
        willRetry: false,
      });
    });

    expect(markProcessing).not.toHaveBeenCalledWith("thread-1", false);
    expect(markReviewing).not.toHaveBeenCalledWith("thread-1", false);
    expect(setActiveTurnId).not.toHaveBeenCalledWith("thread-1", null);
    expect(pushThreadErrorMessage).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();
  });
});
