// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeAppServerEvents } from "../../../services/events";
import { resetRealtimePerfFlags } from "../../threads/utils/realtimePerfFlags";
import {
  type AppServerEventHandlers,
} from "./useAppServerEvents";
import { useAppServerEventBatchDispatch } from "./useAppServerEventBatchDispatch";

vi.mock("../../../services/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/events")>();
  return {
    ...actual,
    subscribeAppServerEvents: vi.fn(),
  };
});

const baseHandlers: AppServerEventHandlers = {};
const baseOptions = {
  useNormalizedRealtimeAdapters: false,
  threadAgentDeltaSeenRef: { current: {} } as React.MutableRefObject<
    Record<string, true>
  >,
  threadAgentCompletedSeenRef: { current: {} } as React.MutableRefObject<
    Record<string, Record<string, true>>
  >,
  threadAgentSnapshotSeenRef: { current: {} } as React.MutableRefObject<
    Record<string, Record<string, true>>
  >,
};

let eventListener: ((event: unknown) => void) | null = null;
let dispatchCount = 0;

function deliverBatch(batch: unknown[]) {
  for (const event of batch) {
    eventListener?.(event);
  }
}

describe("useAppServerEventBatchDispatch (v2)", () => {
  beforeEach(() => {
    eventListener = null;
    dispatchCount = 0;
    vi.mocked(subscribeAppServerEvents).mockImplementation((cb) => {
      eventListener = cb as (event: unknown) => void;
      return () => {
        eventListener = null;
      };
    });
    resetRealtimePerfFlags();
    window.localStorage.setItem("doge.perf.streamingScheduleTier", "guarded");
  });

  afterEach(() => {
    resetRealtimePerfFlags();
  });

  it("subscribes to the unified per-event stream exactly once on mount", () => {
    const { unmount } = renderHook(() =>
      useAppServerEventBatchDispatch(baseHandlers, baseOptions),
    );
    expect(subscribeAppServerEvents).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("forwards delivered events to dispatchAppServerEvent and clears the queue", async () => {
    const onAgentMessageDelta = vi.fn();
    const { result } = renderHook(() =>
      useAppServerEventBatchDispatch(
        { onAgentMessageDelta },
        baseOptions,
      ),
    );
    const events = Array.from({ length: 3 }, (_, i) => ({
      workspace_id: "ws-1",
      message: {
        method: "item/agentMessage/delta",
        params: { threadId: "thread-1", itemId: "item-1", delta: `d${i}` },
      },
    }));
    await act(async () => {
      deliverBatch(events);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const stats = result.current.__getBackpressureStatsForTests();
    expect(onAgentMessageDelta).toHaveBeenCalledTimes(3);
    expect(stats.queueDepth).toBe(0);
    dispatchCount = onAgentMessageDelta.mock.calls.length;
    void dispatchCount;
  });

  it("routes status snapshots delivered by the unified per-event stream", async () => {
    const onProcessingHeartbeat = vi.fn();
    renderHook(() =>
      useAppServerEventBatchDispatch(
        { onProcessingHeartbeat },
        baseOptions,
      ),
    );
    const events = [
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
    ];
    await act(async () => {
      deliverBatch(events);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(onProcessingHeartbeat).toHaveBeenCalledTimes(2);
    expect(onProcessingHeartbeat).toHaveBeenLastCalledWith(
      "ws-1",
      "thread-1",
      2,
    );
  });

  it("exposes instrumentation counters from the render scheduler", () => {
    const { result } = renderHook(() =>
      useAppServerEventBatchDispatch(baseHandlers, baseOptions),
    );
    const instr = result.current.__getInstrumentationForTests();
    expect(typeof instr.chunkCount).toBe("number");
    expect(typeof instr.yieldCount).toBe("number");
    expect(typeof instr.inputPendingYieldCount).toBe("number");
    expect(typeof instr.budgetMissCount).toBe("number");
  });

  it("does not use requestIdleCallback in baseline tier", async () => {
    window.localStorage.setItem("doge.perf.streamingScheduleTier", "baseline");
    const requestIdleCallback = vi.fn();
    const cancelIdleCallback = vi.fn();
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: requestIdleCallback,
    });
    Object.defineProperty(window, "cancelIdleCallback", {
      configurable: true,
      value: cancelIdleCallback,
    });

    const onProcessingHeartbeat = vi.fn();
    const { result } = renderHook(() =>
      useAppServerEventBatchDispatch(
        { onProcessingHeartbeat },
        baseOptions,
      ),
    );

    await act(async () => {
      deliverBatch([
        {
          workspace_id: "ws-1",
          message: {
            method: "processing/heartbeat",
            params: { threadId: "thread-1", pulse: 1 },
          },
        },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(onProcessingHeartbeat).toHaveBeenCalledTimes(1);
    expect(requestIdleCallback).not.toHaveBeenCalled();
    expect(result.current.__getInstrumentationForTests().idleCallbackCount).toBe(0);
    expect(result.current.__getInstrumentationForTests().timeoutFallbackCount).toBeGreaterThan(0);
  });
});
