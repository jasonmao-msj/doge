// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDeferredFrameAccumulator } from "./useDeferredFrameAccumulator";
import {
  __resetRealtimePerfFlagCacheForTests,
  resetRealtimePerfFlags,
} from "../../threads/utils/realtimePerfFlags";

describe("useDeferredFrameAccumulator", () => {
  beforeEach(() => {
    resetRealtimePerfFlags();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetRealtimePerfFlagCacheForTests();
  });

  it("commits after framesToAccumulate rAF ticks (default 3)", () => {
    let now = 0;
    const rafMock = (cb: FrameRequestCallback) => {
      // Each rAF call advances the clock by 16ms and fires the callback.
      now += 16;
      cb(now);
      return now;
    };
    const cafMock = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }) =>
        useDeferredFrameAccumulator({
          value,
          requestAnimationFrameFn: rafMock,
          cancelAnimationFrameFn: cafMock,
        }),
      { initialProps: { value: "v1" } },
    );
    // Default tier = "guarded" so framesToAccumulate=3.
    expect(result.current.committed).toBe("v1");
    const diag1 = result.current.__getDiagnosticsForTests();
    expect(diag1.commitCount).toBe(1);
    // New value: should commit after 3 ticks.
    rerender({ value: "v2" });
    const diag2 = result.current.__getDiagnosticsForTests();
    expect(diag2.commitCount).toBe(2);
    expect(result.current.committed).toBe("v2");
  });

  it("drains immediately when resetKey changes", () => {
    const rafMock = vi.fn(() => 1);
    const cafMock = vi.fn();
    const { result, rerender } = renderHook(
      ({ value, resetKey }) =>
        useDeferredFrameAccumulator({
          value,
          resetKey,
          requestAnimationFrameFn: rafMock as unknown as (cb: FrameRequestCallback) => number,
          cancelAnimationFrameFn: cafMock,
        }),
      { initialProps: { value: "a", resetKey: "k1" as string | null } },
    );
    rerender({ value: "b", resetKey: "k2" });
    const diag = result.current.__getDiagnosticsForTests();
    expect(diag.resetCount).toBeGreaterThanOrEqual(1);
  });

  it("does not drain on value reference churn when resetKey is stable", () => {
    const rafMock = vi.fn(() => 1);
    const cafMock = vi.fn();
    const { result, rerender } = renderHook(
      ({ value, resetKey }) =>
        useDeferredFrameAccumulator({
          value,
          resetKey,
          requestAnimationFrameFn: rafMock as unknown as (cb: FrameRequestCallback) => number,
          cancelAnimationFrameFn: cafMock,
        }),
      {
        initialProps: {
          value: { threadItemsByThread: {} },
          resetKey: "thread-1",
        },
      },
    );

    rerender({
      value: { threadItemsByThread: {} },
      resetKey: "thread-1",
    });

    const diag = result.current.__getDiagnosticsForTests();
    expect(diag.resetCount).toBe(0);
    expect(diag.commitCount).toBe(1);
  });

  it("commits in a single rAF tick when tier is baseline", () => {
    window.localStorage.setItem("doge.perf.streamingScheduleTier", "baseline");
    const rafMock = vi.fn(() => 1);
    const cafMock = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }) =>
        useDeferredFrameAccumulator({
          value,
          requestAnimationFrameFn: rafMock as unknown as (cb: FrameRequestCallback) => number,
          cancelAnimationFrameFn: cafMock,
        }),
      { initialProps: { value: "x" } },
    );
    rerender({ value: "y" });
    const diag = result.current.__getDiagnosticsForTests();
    expect(diag.commitCount).toBe(2); // initial + new value
    expect(result.current.committed).toBe("y");
  });

  it("uses tierOverride to bypass localStorage", () => {
    const rafMock = vi.fn(() => 1);
    const cafMock = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }) =>
        useDeferredFrameAccumulator({
          value,
          tierOverride: "baseline",
          requestAnimationFrameFn: rafMock as unknown as (cb: FrameRequestCallback) => number,
          cancelAnimationFrameFn: cafMock,
        }),
      { initialProps: { value: 1 } },
    );
    rerender({ value: 2 });
    expect(result.current.committed).toBe(2);
  });
});
