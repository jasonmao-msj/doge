// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedThreadEvent } from "../contracts/conversationCurtainContracts";
import { useThreadItemEvents } from "./useThreadItemEvents";

type SetupOverrides = {
  scheduleRealtimeDispatch?: (run: () => void) => void;
};

function makeOptions(overrides: SetupOverrides = {}) {
  const dispatch = vi.fn();
  const markProcessing = vi.fn();
  const markReviewing = vi.fn();
  const safeMessageActivity = vi.fn();
  const recordThreadActivity = vi.fn();
  const applyCollabThreadLinks = vi.fn();
  const interruptedThreadsRef = {
    current: new Map<string, Map<string, true>>(),
  };

  const { result, unmount } = renderHook(() =>
    useThreadItemEvents({
      activeThreadId: null,
      dispatch,
      getCustomName: vi.fn(() => undefined),
      markProcessing,
      markReviewing,
      safeMessageActivity,
      recordThreadActivity,
      applyCollabThreadLinks,
      interruptedThreadsRef,
      scheduleRealtimeDispatch: overrides.scheduleRealtimeDispatch,
    }),
  );

  return {
    result,
    unmount,
    dispatch,
    markProcessing,
    safeMessageActivity,
  };
}

function reasoningDelta(delta: string, eventId: string): NormalizedThreadEvent {
  return {
    engine: "codex",
    workspaceId: "ws-1",
    threadId: "thread-1",
    turnId: "turn-1",
    eventId,
    itemKind: "reasoning",
    timestampMs: 1,
    operation: "appendReasoningContentDelta",
    sourceMethod: "response.reasoning_summary_text.delta",
    delta,
    item: {
      id: "reasoning-1",
      kind: "reasoning",
      summary: "",
      content: delta,
    },
  };
}

describe("useThreadItemEvents first-token reasoning dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem("doge.perf.realtimeBatching");
  });

  it("dispatches the first reasoning content delta urgently", () => {
    window.localStorage.setItem("doge.perf.realtimeBatching", "1");
    const queuedTransitions: Array<() => void> = [];
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions({
      scheduleRealtimeDispatch: (callback) => {
        queuedTransitions.push(callback);
      },
    });

    act(() => {
      result.current.onNormalizedRealtimeEvent(reasoningDelta("先检查上下文", "evt-1"));
    });

    expect(queuedTransitions).toHaveLength(0);
    expect(dispatch).toHaveBeenCalledWith({
      type: "applyNormalizedRealtimeEvent",
      workspaceId: "ws-1",
      threadId: "thread-1",
      event: expect.objectContaining({
        eventId: "evt-1",
        operation: "appendReasoningContentDelta",
      }),
      hasCustomName: false,
    });
    expect(markProcessing).not.toHaveBeenCalled();
    expect(safeMessageActivity).toHaveBeenCalledTimes(1);
  });

  it("keeps steady-state reasoning content deltas batched", () => {
    vi.useFakeTimers();
    window.localStorage.setItem("doge.perf.realtimeBatching", "1");
    const queuedTransitions: Array<() => void> = [];
    const { result, dispatch, safeMessageActivity } = makeOptions({
      scheduleRealtimeDispatch: (callback) => {
        queuedTransitions.push(callback);
      },
    });

    act(() => {
      result.current.onNormalizedRealtimeEvent(reasoningDelta("先检查上下文", "evt-1"));
      result.current.onNormalizedRealtimeEvent(reasoningDelta("，再读取文件", "evt-2"));
    });

    expect(queuedTransitions).toHaveLength(0);
    expect(dispatch).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(40);
    });

    expect(queuedTransitions).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledTimes(2);

    act(() => {
      queuedTransitions.forEach((callback) => callback());
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "applyNormalizedRealtimeEvent",
      workspaceId: "ws-1",
      threadId: "thread-1",
      event: expect.objectContaining({
        eventId: "evt-2",
        operation: "appendReasoningContentDelta",
      }),
      hasCustomName: false,
    });
    expect(safeMessageActivity).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
