// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedThreadEvent } from "../contracts/conversationCurtainContracts";
import { useThreadItemEvents } from "./useThreadItemEvents";

const WORKSPACE_ID = "ws-1";
const THREAD_ID = "shared:thread-1";
const TURN_ID = "turn-1";
const ITEM_ID = "msg-1";

const makeHook = () => {
  const dispatch = vi.fn();
  const markProcessing = vi.fn();
  const { result } = renderHook(() =>
    useThreadItemEvents({
      activeThreadId: THREAD_ID,
      dispatch,
      getCustomName: vi.fn(() => undefined),
      markProcessing,
      markReviewing: vi.fn(),
      safeMessageActivity: vi.fn(),
      recordThreadActivity: vi.fn(),
      applyCollabThreadLinks: vi.fn(),
      interruptedThreadsRef: { current: new Map<string, Map<string, true>>() },
    }),
  );
  return { result, dispatch, markProcessing };
};

const agentDeltaEvent = (delta: string): NormalizedThreadEvent => ({
  engine: "codex",
  workspaceId: WORKSPACE_ID,
  threadId: THREAD_ID,
  eventId: `${ITEM_ID}:delta`,
  itemKind: "message",
  timestampMs: Date.now(),
  item: {
    id: ITEM_ID,
    kind: "message",
    role: "assistant",
    text: delta,
  },
  operation: "appendAgentMessageDelta",
  sourceMethod: "item/agentMessage/delta",
  delta,
  turnId: TURN_ID,
});

const completeEvent = (text: string): NormalizedThreadEvent => ({
  engine: "codex",
  workspaceId: WORKSPACE_ID,
  threadId: THREAD_ID,
  eventId: `${ITEM_ID}:completed`,
  itemKind: "message",
  timestampMs: Date.now(),
  item: {
    id: ITEM_ID,
    kind: "message",
    role: "assistant",
    text,
  },
  operation: "completeAgentMessage",
  sourceMethod: "item/completed",
  turnId: TURN_ID,
});

const appliedEvents = (dispatch: ReturnType<typeof vi.fn>) =>
  dispatch.mock.calls
    .map(([action]) => action as Record<string, unknown>)
    .filter((action) => action.type === "applyNormalizedRealtimeEvent")
    .map((action) => action.event as NormalizedThreadEvent);

describe("useThreadItemEvents terminal text integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem("doge.perf.realtimeBatching", "1");
    vi.useFakeTimers();
  });

  afterEach(() => {
    window.localStorage.removeItem("doge.perf.realtimeBatching");
    vi.useRealTimers();
  });

  it("drains contract-batcher deltas synchronously before terminal", () => {
    const { result, dispatch } = makeHook();

    act(() => {
      result.current.onNormalizedRealtimeEvent(agentDeltaEvent("完全"));
      result.current.onNormalizedRealtimeEvent(
        agentDeltaEvent("顶得住，而且非常轻松。"),
      );
    });
    expect(appliedEvents(dispatch).map((event) => event.delta)).toEqual(["完全"]);

    act(() => result.current.flushPendingRealtimeEvents());

    expect(appliedEvents(dispatch).map((event) => event.delta)).toEqual([
      "完全",
      "顶得住，而且非常轻松。",
    ]);
  });

  it("leaves the cadence callback empty after terminal drain", () => {
    const { result, dispatch } = makeHook();

    act(() => {
      result.current.onNormalizedRealtimeEvent(agentDeltaEvent("完全"));
      result.current.onNormalizedRealtimeEvent(agentDeltaEvent("顶得住。"));
      result.current.flushPendingRealtimeEvents();
      result.current.markRealtimeTurnTerminal(THREAD_ID, TURN_ID);
    });
    const appliedAfterSettle = appliedEvents(dispatch).length;

    act(() => vi.advanceTimersByTime(1000));

    expect(appliedEvents(dispatch)).toHaveLength(appliedAfterSettle);
  });

  it("salvages a late full completion without reviving processing", () => {
    const { result, dispatch, markProcessing } = makeHook();

    act(() => {
      result.current.onNormalizedRealtimeEvent(agentDeltaEvent("完全"));
      result.current.markRealtimeTurnTerminal(THREAD_ID, TURN_ID);
    });
    dispatch.mockClear();
    markProcessing.mockClear();

    act(() => {
      result.current.onNormalizedRealtimeEvent(
        completeEvent("完全顶得住，而且非常轻松。"),
      );
    });

    expect(appliedEvents(dispatch)).toEqual([
      expect.objectContaining({
        operation: "completeAgentMessage",
        item: expect.objectContaining({
          text: "完全顶得住，而且非常轻松。",
        }),
      }),
    ]);
    expect(markProcessing).not.toHaveBeenCalledWith(THREAD_ID, true);
  });

  it("still drops late deltas and empty completions", () => {
    const { result, dispatch } = makeHook();

    act(() => {
      result.current.onNormalizedRealtimeEvent(agentDeltaEvent("完全"));
      result.current.markRealtimeTurnTerminal(THREAD_ID, TURN_ID);
    });
    dispatch.mockClear();

    act(() => {
      result.current.onNormalizedRealtimeEvent(agentDeltaEvent("迟到尾巴"));
      result.current.onNormalizedRealtimeEvent(completeEvent(""));
      vi.advanceTimersByTime(1000);
    });

    expect(appliedEvents(dispatch)).toHaveLength(0);
  });
});
