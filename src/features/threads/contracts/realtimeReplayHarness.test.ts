import { describe, expect, it } from "vitest";
import {
  buildThreeThreadReplayEventsForMinutes,
  REALTIME_REPLAY_BATCH_WINDOW_MS,
} from "./realtimeReplayFixture";
import { runReplayProfile } from "./realtimeReplayHarness";

describe("realtime replay harness", () => {
  it("keeps replay deterministic for the same 3-thread input stream", async () => {
    const events = buildThreeThreadReplayEventsForMinutes(1);

    const first = await runReplayProfile({
      events,
      profile: "baseline",
      batchWindowMs: REALTIME_REPLAY_BATCH_WINDOW_MS,
    });
    const second = await runReplayProfile({
      events,
      profile: "baseline",
      batchWindowMs: REALTIME_REPLAY_BATCH_WINDOW_MS,
    });

    expect(first.semanticsHash).toBe(second.semanticsHash);
    expect(first.metrics.totalActions).toBe(second.metrics.totalActions);
    expect(first.integrity).toEqual({
      missingAgentMessages: [],
      missingReasoningItems: [],
      missingToolOutputs: [],
      stuckProcessingThreads: [],
    });
  });

  it("preserves semantics while reducing action/frame amplification in optimized profile", async () => {
    const events = buildThreeThreadReplayEventsForMinutes(1);

    const baseline = await runReplayProfile({
      events,
      profile: "baseline",
      batchWindowMs: REALTIME_REPLAY_BATCH_WINDOW_MS,
    });
    const optimized = await runReplayProfile({
      events,
      profile: "optimized",
      batchWindowMs: REALTIME_REPLAY_BATCH_WINDOW_MS,
    });

    expect(optimized.semanticsHash).toBe(baseline.semanticsHash);
    expect(optimized.metrics.totalActions).toBeLessThan(baseline.metrics.totalActions);
    expect(optimized.metrics.peakActionsPerFrame).toBeLessThan(baseline.metrics.peakActionsPerFrame);
    expect(optimized.integrity).toEqual({
      missingAgentMessages: [],
      missingReasoningItems: [],
      missingToolOutputs: [],
      stuckProcessingThreads: [],
    });
  });

  it("restores perf flags after profile run to avoid leaking state across runs", async () => {
    const localStorage = (() => {
      const store = new Map<string, string>();
      return {
        get length() {
          return store.size;
        },
        getItem(key: string) {
          return store.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          store.set(key, value);
        },
        removeItem(key: string) {
          store.delete(key);
        },
        clear() {
          store.clear();
        },
        key(index: number) {
          return Array.from(store.keys())[index] ?? null;
        },
      };
    })();
    const globalWithWindow = globalThis as unknown as {
      window?: { localStorage?: typeof localStorage };
    };
    const previousWindow = globalWithWindow.window;
    globalWithWindow.window = { localStorage };
    try {
      localStorage.setItem("doge.perf.reducerNoopGuard", "1");
      localStorage.setItem("doge.perf.incrementalDerivation", "0");

      const events = buildThreeThreadReplayEventsForMinutes(1);
      await runReplayProfile({
        events,
        profile: "baseline",
        batchWindowMs: REALTIME_REPLAY_BATCH_WINDOW_MS,
      });

      expect(localStorage.getItem("doge.perf.reducerNoopGuard")).toBe("1");
      expect(localStorage.getItem("doge.perf.incrementalDerivation")).toBe("0");
      expect(localStorage.getItem("doge.perf.debugLightPath")).toBeNull();
    } finally {
      globalWithWindow.window = previousWindow;
    }
  });
});
