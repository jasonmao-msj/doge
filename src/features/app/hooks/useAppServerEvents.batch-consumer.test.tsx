// @vitest-environment jsdom
//
// Batch-aware route tests for `useAppServerEvents` / `dispatchAppServerEvent`.
// Covers proposal §1.4 acceptance criteria:
//   (a) dispatcher routes a single `codex/connected` to onWorkspaceConnected
//   (b) dispatcher routes a single `item/agentMessage/delta` to onAgentMessageDelta
//   (c) dispatcher routes an `approval/request` to onApprovalRequest
//   (d) batch route preserves non-coalescible deltas, coalesces status
//       snapshots, and chunks large batches instead of a tight full loop
//   (e) batch-enabled mode remains compatible with legacy single-channel
//       producers while keeping the batch route active
//   (f) cleanup releases every active subscription
//
// The 1000-delta burst assertion for `prepareThreadItems_calls_per_1000_delta`
// lives in `useThreadsReducer.append-agent-delta-fast-path.test.ts` (the
// reducer fast-path tier); this file exercises the dispatcher/route tier.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServerEvent } from "../../../types";
import {
  subscribeAppServerEvents,
  subscribeRawAppServerEvents,
} from "../../../services/events";
import {
  coalesceAppServerEventBatch,
  dispatchAppServerEventBatch,
  dispatchAppServerEvent,
  useAppServerEvents,
} from "./useAppServerEvents";
import { isAppServerEventBatchConsumerEnabled } from "@/conversation-presentation/realtimePerfFlags";

vi.mock("../../../services/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/events")>();
  return {
    ...actual,
    subscribeAppServerEvents: vi.fn(),
    subscribeRawAppServerEvents: vi.fn(),
  };
});

vi.mock("@/conversation-presentation/realtimePerfFlags", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/conversation-presentation/realtimePerfFlags")
    >();
  return {
    ...actual,
    isAppServerEventBatchConsumerEnabled: vi.fn(() => true),
    // Force baseline tier so the v1 setTimeout chunk loop is exercised
    // (v2 path is covered by useAppServerEvents.idle-yield.test.tsx).
    readStreamingScheduleTier: vi.fn(() => "baseline"),
  };
});

type Handlers = Parameters<typeof useAppServerEvents>[0];

function TestHarness({ handlers }: { handlers: Handlers }) {
  useAppServerEvents(handlers);
  return null;
}

function makeDispatcherOptions() {
  return {
    useNormalizedRealtimeAdapters: false,
    threadAgentDeltaSeenRef: {
      current: {} as Record<string, true>,
    },
    threadAgentCompletedSeenRef: {
      current: {} as Record<string, Record<string, true>>,
    },
    threadAgentSnapshotSeenRef: {
      current: {} as Record<string, Record<string, true>>,
    },
  };
}

describe("dispatchAppServerEvent unit (proposal §1.4 a/b/c)", () => {
  it("routes a single `codex/connected` to onWorkspaceConnected", () => {
    const onWorkspaceConnected = vi.fn();
    dispatchAppServerEvent(
      { onWorkspaceConnected },
      { workspace_id: "ws-1", message: { method: "codex/connected" } },
      makeDispatcherOptions(),
    );
    expect(onWorkspaceConnected).toHaveBeenCalledWith("ws-1");
  });

  it("routes a single `item/agentMessage/delta` to onAgentMessageDelta", () => {
    const onAgentMessageDelta = vi.fn();
    dispatchAppServerEvent(
      { onAgentMessageDelta },
      {
        workspace_id: "ws-1",
        message: {
          method: "item/agentMessage/delta",
          params: { threadId: "thread-1", itemId: "item-1", delta: "hello" },
        },
      },
      makeDispatcherOptions(),
    );
    expect(onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "item-1",
      delta: "hello",
    });
  });

  it("routes an `approval/request` to onApprovalRequest with the resolved id", () => {
    const onApprovalRequest = vi.fn();
    dispatchAppServerEvent(
      { onApprovalRequest },
      {
        workspace_id: "ws-1",
        message: {
          id: 42,
          method: "approval/request",
          params: { foo: "bar" },
        },
      },
      makeDispatcherOptions(),
    );
    expect(onApprovalRequest).toHaveBeenCalledWith({
      workspace_id: "ws-1",
      request_id: 42,
      method: "approval/request",
      params: { foo: "bar" },
    });
  });
});

describe("dispatchAppServerEventBatch unit (proposal §1.4 d)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not coalesce text deltas because delta streams are append-only", () => {
    const events: AppServerEvent[] = [
      {
        workspace_id: "ws-1",
        message: {
          method: "item/agentMessage/delta",
          params: { threadId: "thread-1", itemId: "item-1", delta: "a" },
        },
      },
      {
        workspace_id: "ws-1",
        message: {
          method: "item/agentMessage/delta",
          params: { threadId: "thread-1", itemId: "item-1", delta: "b" },
        },
      },
    ];

    expect(coalesceAppServerEventBatch(events)).toHaveLength(2);
  });

  it("coalesces consecutive status snapshots by workspace/thread/method", () => {
    const events: AppServerEvent[] = [
      {
        workspace_id: "ws-1",
        message: {
          method: "processing/heartbeat",
          params: { threadId: "thread-1", pulse: 1 },
        },
      },
      {
        workspace_id: "ws-1",
        message: {
          method: "processing/heartbeat",
          params: { threadId: "thread-1", pulse: 2 },
        },
      },
      {
        workspace_id: "ws-1",
        message: {
          method: "processing/heartbeat",
          params: { threadId: "thread-2", pulse: 1 },
        },
      },
    ];

    expect(coalesceAppServerEventBatch(events)).toEqual([events[1], events[2]]);
  });

  it("routes large batches in chunks while preserving control event order", () => {
    vi.useFakeTimers();
    const onApprovalRequest = vi.fn();
    const onComplete = vi.fn();
    const events: AppServerEvent[] = [];
    for (let i = 0; i < 5; i++) {
      events.push({
        workspace_id: "ws-1",
        message: {
          id: i + 1,
          method: "approval/request",
          params: { approvalIndex: i },
        },
      });
    }

    dispatchAppServerEventBatch({ onApprovalRequest }, events, {
      ...makeDispatcherOptions(),
      chunkSize: 2,
      onComplete,
    });

    expect(onApprovalRequest).toHaveBeenCalledTimes(2);
    expect(
      onApprovalRequest.mock.calls.map(([request]) => request.request_id),
    ).toEqual([1, 2]);
    expect(onComplete).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();
    expect(onApprovalRequest).toHaveBeenCalledTimes(4);
    expect(
      onApprovalRequest.mock.calls.map(([request]) => request.request_id),
    ).toEqual([1, 2, 3, 4]);
    expect(onComplete).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();
    expect(onApprovalRequest).toHaveBeenCalledTimes(5);
    expect(
      onApprovalRequest.mock.calls.map(([request]) => request.request_id),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("useAppServerEvents channel subscription (proposal §1.4 e/f)", () => {
  let listener: ((event: AppServerEvent) => void) | null = null;
  const unlistenSingle = vi.fn();
  const unlistenRaw = vi.fn();

  beforeEach(() => {
    listener = null;
    unlistenSingle.mockReset();
    unlistenRaw.mockReset();
    vi.mocked(subscribeAppServerEvents).mockImplementation((cb) => {
      listener = cb;
      return unlistenSingle;
    });
    vi.mocked(subscribeRawAppServerEvents).mockImplementation((cb) => {
      listener = cb;
      return unlistenRaw;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function mount(handlers: Handlers) {
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(<TestHarness handlers={handlers} />);
    });
    return { root };
  }

  it("subscribes to the unified per-event stream when the runtime flag is on", async () => {
    vi.mocked(isAppServerEventBatchConsumerEnabled).mockReturnValue(true);
    const handlers: Handlers = { onAppServerEvent: vi.fn() };
    const { root } = await mount(handlers);

    expect(listener).toBeTypeOf("function");
    expect(vi.mocked(subscribeAppServerEvents)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(subscribeRawAppServerEvents)).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    expect(unlistenSingle).toHaveBeenCalledTimes(1);
    expect(unlistenRaw).not.toHaveBeenCalled();
  });

  it("subscribes to ONE channel (single) when the runtime flag is off", async () => {
    vi.mocked(isAppServerEventBatchConsumerEnabled).mockReturnValue(false);
    const handlers: Handlers = { onAppServerEvent: vi.fn() };
    const { root } = await mount(handlers);

    expect(listener).toBeTypeOf("function");
    expect(vi.mocked(subscribeRawAppServerEvents)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(subscribeAppServerEvents)).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    expect(unlistenRaw).toHaveBeenCalledTimes(1);
    expect(unlistenSingle).not.toHaveBeenCalled();
  });

  it("drains the raw fallback channel through the scheduler instead of dispatching synchronously", async () => {
    vi.useFakeTimers();
    vi.mocked(isAppServerEventBatchConsumerEnabled).mockReturnValue(false);
    const handlers: Handlers = { onAppServerEvent: vi.fn() };
    await mount(handlers);

    const payload: AppServerEvent = {
      workspace_id: "ws-1",
      message: { method: "ping" },
    };
    await act(async () => {
      listener?.(payload);
    });

    expect(handlers.onAppServerEvent).not.toHaveBeenCalled();

    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    expect(handlers.onAppServerEvent).toHaveBeenCalledWith(payload);
  });

  it("batch channel preserves non-coalescible delta events (proposal §1.4 d)", async () => {
    vi.mocked(isAppServerEventBatchConsumerEnabled).mockReturnValue(true);
    const onAgentMessageDelta = vi.fn();
    const handlers: Handlers = {
      onAppServerEvent: vi.fn(),
      onAgentMessageDelta,
    };
    await mount(handlers);

    const events: AppServerEvent[] = [];
    for (let i = 0; i < 5; i++) {
      events.push({
        workspace_id: "ws-1",
        message: {
          method: "item/agentMessage/delta",
          params: { threadId: "thread-1", itemId: "item-1", delta: `d${i}` },
        },
      });
    }
    await act(async () => {
      for (const event of events) {
        listener?.(event);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(onAgentMessageDelta).toHaveBeenCalledTimes(5);
    for (let i = 0; i < 5; i++) {
      expect(onAgentMessageDelta).toHaveBeenNthCalledWith(i + 1, {
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: "item-1",
        delta: `d${i}`,
      });
    }
  });

  it("preserves per-event delivery order after services split the batch", async () => {
    vi.mocked(isAppServerEventBatchConsumerEnabled).mockReturnValue(true);
    const onApprovalRequest = vi.fn();
    const handlers: Handlers = { onApprovalRequest };
    await mount(handlers);

    const makeApprovalEvent = (requestId: number): AppServerEvent => ({
      workspace_id: "ws-1",
      message: {
        id: requestId,
        method: "approval/request",
        params: { requestId },
      },
    });
    const events = Array.from({ length: 66 }, (_, index) =>
      makeApprovalEvent(index + 1),
    );

    await act(async () => {
      for (const event of events) {
        listener?.(event);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(onApprovalRequest).toHaveBeenCalledTimes(66);
    expect(
      onApprovalRequest.mock.calls.map(([request]) => request.request_id),
    ).toEqual(Array.from({ length: 66 }, (_, index) => index + 1));
  });

  it("single channel still routes events when the flag is off", async () => {
    vi.useFakeTimers();
    vi.mocked(isAppServerEventBatchConsumerEnabled).mockReturnValue(false);
    const onWorkspaceConnected = vi.fn();
    const handlers: Handlers = {
      onAppServerEvent: vi.fn(),
      onWorkspaceConnected,
    };
    await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: { method: "codex/connected" },
      });
    });
    expect(onWorkspaceConnected).not.toHaveBeenCalled();

    await act(async () => {
      vi.runOnlyPendingTimers();
    });
    expect(onWorkspaceConnected).toHaveBeenCalledTimes(1);
  });

  it("legacy single channel still routes agent deltas when the batch flag is on", async () => {
    vi.mocked(isAppServerEventBatchConsumerEnabled).mockReturnValue(true);
    const onAgentMessageDelta = vi.fn();
    const handlers: Handlers = {
      onAppServerEvent: vi.fn(),
      onAgentMessageDelta,
    };
    await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "claude:session-1",
            itemId: "claude-item-1",
            delta: "hello",
            turnId: "claude-turn-1",
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-claude",
      threadId: "claude:session-1",
      itemId: "claude-item-1",
      delta: "hello",
      turnId: "claude-turn-1",
    });
  });

  it("legacy single channel still routes turn completion when the batch flag is on", async () => {
    vi.mocked(isAppServerEventBatchConsumerEnabled).mockReturnValue(true);
    const onTurnCompleted = vi.fn();
    const handlers: Handlers = {
      onAppServerEvent: vi.fn(),
      onTurnCompleted,
    };
    await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "turn/completed",
          params: {
            threadId: "claude:session-1",
            turnId: "claude-turn-1",
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(onTurnCompleted).toHaveBeenCalledWith(
      "ws-claude",
      "claude:session-1",
      "claude-turn-1",
    );
  });
});
