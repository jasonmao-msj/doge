// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetRealtimePerfFlagCacheForTests,
  resetRealtimePerfFlags,
} from "@/conversation-presentation/realtimePerfFlags";
import { RENDER_TIER_FLAG_KEY } from "@/conversation-presentation/renderSchedulingPolicy";
import { useThreadItemEvents } from "./useThreadItemEvents";

const flushIdleAndMicrotasks = async () => {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const buildOptions = (
  overrides: {
    activeThreadId?: string | null;
  } = {},
) => {
  const dispatch = vi.fn();
  const markProcessing = vi.fn();
  const markReviewing = vi.fn();
  const safeMessageActivity = vi.fn();
  const recordThreadActivity = vi.fn();
  const applyCollabThreadLinks = vi.fn();
  const interruptedThreadsRef = {
    current: new Map<string, Map<string, true>>(),
  } as { current: Map<string, Map<string, true>> };

  const { result } = renderHook(() =>
    useThreadItemEvents({
      activeThreadId: overrides.activeThreadId ?? "ws-1:active",
      dispatch,
      getCustomName: vi.fn(() => undefined),
      markProcessing,
      markReviewing,
      safeMessageActivity,
      recordThreadActivity,
      applyCollabThreadLinks,
      interruptedThreadsRef,
    }),
  );
  return { result, dispatch, markProcessing };
};

describe("useThreadItemEvents §6.3 dispatchWithSchedule", () => {
  afterEach(() => {
    resetRealtimePerfFlags();
    __resetRealtimePerfFlagCacheForTests();
  });

  it("baseline tier always routes through urgent (sync dispatch)", async () => {
    window.localStorage.setItem(RENDER_TIER_FLAG_KEY, "baseline");
    const { result, dispatch } = buildOptions({ activeThreadId: "ws-1:other" });
    act(() => {
      result.current.onItemStarted("ws-1", "ws-1:active", { id: "tool-1" });
    });
    expect(
      dispatch.mock.calls.some(([action]) => action && action.type === "ensureThread"),
    ).toBe(true);
    const inst = result.current.__getSubmitScheduleInstrumentationForTests();
    expect(inst.urgentDispatchCount).toBeGreaterThanOrEqual(1);
    expect(inst.transitionDispatchCount).toBe(0);
    expect(inst.idleDispatchCount).toBe(0);
  });

  it("guarded tier non-live non-critical routes through transition", async () => {
    window.localStorage.setItem(RENDER_TIER_FLAG_KEY, "guarded");
    const { result, dispatch } = buildOptions({ activeThreadId: "ws-1:other" });
    act(() => {
      result.current.onItemStarted("ws-1", "ws-1:background", { id: "tool-1" });
    });
    // transition 路径: instrumentation 记 transition, dispatch 同步调用 (mock 的 vi.fn)
    const inst = result.current.__getSubmitScheduleInstrumentationForTests();
    expect(inst.transitionDispatchCount).toBeGreaterThanOrEqual(1);
    expect(inst.urgentDispatchCount).toBe(0);
    expect(inst.idleDispatchCount).toBe(0);
    const ensureThreadCalls = dispatch.mock.calls.filter(
      ([action]) => action && action.type === "ensureThread",
    );
    expect(ensureThreadCalls.length).toBeGreaterThanOrEqual(1);
  });
  it("aggressive tier non-live non-critical routes through idle (requestIdleCallback)", async () => {
    window.localStorage.setItem(RENDER_TIER_FLAG_KEY, "aggressive");
    const { result, dispatch } = buildOptions({ activeThreadId: "ws-1:other" });
    act(() => {
      result.current.onItemStarted("ws-1", "ws-1:background", { id: "tool-1" });
    });
    const inst = result.current.__getSubmitScheduleInstrumentationForTests();
    expect(inst.idleDispatchCount).toBeGreaterThanOrEqual(1);
    expect(inst.urgentDispatchCount).toBe(0);
    expect(inst.transitionDispatchCount).toBe(0);
    await flushIdleAndMicrotasks();
    expect(dispatch.mock.calls.length).toBeGreaterThan(0);
  });

  it("activeThreadId rows are always urgent (live row fast-path)", async () => {
    window.localStorage.setItem(RENDER_TIER_FLAG_KEY, "guarded");
    const { result } = buildOptions({ activeThreadId: "ws-1:active" });
    act(() => {
      result.current.onItemStarted("ws-1", "ws-1:active", { id: "tool-1" });
    });
    const inst = result.current.__getSubmitScheduleInstrumentationForTests();
    expect(inst.urgentDispatchCount).toBeGreaterThanOrEqual(1);
    expect(inst.transitionDispatchCount).toBe(0);
  });

  it("instrumentation accumulates totalDispatchCostMs and lastDispatchAtMs", () => {
    window.localStorage.setItem(RENDER_TIER_FLAG_KEY, "baseline");
    const { result } = buildOptions({ activeThreadId: "ws-1:active" });
    const inst0 = result.current.__getSubmitScheduleInstrumentationForTests();
    expect(inst0.totalDispatchCostMs).toBe(0);
    expect(inst0.lastDispatchAtMs).toBe(0);
    act(() => {
      result.current.onItemStarted("ws-1", "ws-1:active", { id: "tool-1" });
      result.current.onItemStarted("ws-1", "ws-1:active", { id: "tool-2" });
    });
    const inst1 = result.current.__getSubmitScheduleInstrumentationForTests();
    expect(inst1.urgentDispatchCount).toBeGreaterThanOrEqual(2);
    expect(inst1.lastDispatchAtMs).toBeGreaterThan(0);
  });
});
