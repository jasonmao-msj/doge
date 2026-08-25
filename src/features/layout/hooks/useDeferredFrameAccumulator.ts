import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readStreamingScheduleTier } from "@/conversation-presentation/realtimePerfFlags";

// 2026-06-24-harden-realtime-interaction-jank-during-tool-call
// Accumulates an arbitrary value across N rendering frames before exposing
// it. When `tier === "aggressive"` the frame count is dropped to 1 so
// streaming feels snappier; when `"baseline"` we fall back to a single
// `useState` commit (effectively zero frames of delay).
//
// The hook keeps the most recent "fresh" value in a ref, and uses
// `requestAnimationFrame` to schedule commits. Each new "fresh" value
// resets the chain so the next `framesToAccumulate` rAF ticks all use
// the same fresh value.

export type UseDeferredFrameAccumulatorOptions<T> = {
  /** Source value that should accumulate across frames. */
  value: T;
  /** Number of rAF ticks to wait before committing. Default 3. */
  framesToAccumulate?: number;
  /** Reset key — when this changes, the accumulator drains immediately. */
  resetKey?: string | number | null;
  /** Force a specific tier override (test surface). */
  tierOverride?: ReturnType<typeof readStreamingScheduleTier>;
  /** Optional rAF override for tests. */
  requestAnimationFrameFn?: (callback: FrameRequestCallback) => number;
  /** Optional cancelAnimationFrame override for tests. */
  cancelAnimationFrameFn?: (handle: number) => void;
};

export type UseDeferredFrameAccumulatorResult<T> = {
  /** The value exposed to consumers — committed only after the frame chain settles. */
  committed: T;
  /** Diagnostics surface for tests. */
  __getDiagnosticsForTests: () => {
    pendingFrames: number;
    commitCount: number;
    resetCount: number;
  };
};

export function useDeferredFrameAccumulator<T>(
  options: UseDeferredFrameAccumulatorOptions<T>,
): UseDeferredFrameAccumulatorResult<T> {
  const {
    value,
    framesToAccumulate = 3,
    resetKey,
    tierOverride,
    requestAnimationFrameFn,
    cancelAnimationFrameFn,
  } = options;

  const tier = tierOverride ?? readStreamingScheduleTier();
  const effectiveFrames = tier === "baseline"
    ? 1
    : tier === "aggressive"
      ? Math.max(1, framesToAccumulate - 2)
      : framesToAccumulate;

  const rafFn = useMemo(
    () =>
      requestAnimationFrameFn ??
      (typeof window !== "undefined"
        ? window.requestAnimationFrame.bind(window)
        : ((cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number)),
    [requestAnimationFrameFn],
  );
  const cafFn = useMemo(
    () =>
      cancelAnimationFrameFn ??
      (typeof window !== "undefined"
        ? window.cancelAnimationFrame.bind(window)
        : ((handle: number) => clearTimeout(handle))),
    [cancelAnimationFrameFn],
  );

  const [committed, setCommitted] = useState<T>(value);
  const committedRef = useRef<T>(value);
  const pendingFramesRef = useRef(0);
  const rafHandleRef = useRef<number | null>(null);
  const commitCountRef = useRef(1);
  const resetCountRef = useRef(0);
  const resetKeyRef = useRef(resetKey);

  const commitValue = useCallback((nextValue: T) => {
    if (Object.is(committedRef.current, nextValue)) {
      return false;
    }
    committedRef.current = nextValue;
    setCommitted(nextValue);
    commitCountRef.current += 1;
    return true;
  }, []);

  useEffect(() => {
    // Drain any in-flight rAF chain.
    if (rafHandleRef.current !== null) {
      cafFn(rafHandleRef.current);
      rafHandleRef.current = null;
    }
    pendingFramesRef.current = effectiveFrames;
    if (effectiveFrames <= 1) {
      // Baseline / aggressive-with-1-frame: commit immediately.
      commitValue(value);
      pendingFramesRef.current = 0;
      return;
    }
    const tick = () => {
      rafHandleRef.current = null;
      pendingFramesRef.current -= 1;
      if (pendingFramesRef.current <= 0) {
        commitValue(value);
        return;
      }
      rafHandleRef.current = rafFn(tick);
    };
    rafHandleRef.current = rafFn(tick);
    return () => {
      if (rafHandleRef.current !== null) {
        cafFn(rafHandleRef.current);
        rafHandleRef.current = null;
      }
    };
  }, [value, effectiveFrames, rafFn, cafFn, commitValue]);

  // Drain-on-resetKey: only a real reset key transition drains immediately.
  // Ordinary value reference churn must stay on the frame accumulator path;
  // otherwise effect -> setState -> render -> new object -> effect can hit
  // React #185 in large layout trees.
  useEffect(() => {
    if (Object.is(resetKeyRef.current, resetKey)) {
      return;
    }
    resetKeyRef.current = resetKey;
    if (resetKey == null) {
      return;
    }
    if (rafHandleRef.current !== null) {
      cafFn(rafHandleRef.current);
      rafHandleRef.current = null;
    }
    pendingFramesRef.current = 0;
    commitValue(value);
    resetCountRef.current += 1;
  }, [resetKey, value, cafFn, commitValue]);

  return {
    committed,
    __getDiagnosticsForTests: () => ({
      pendingFrames: pendingFramesRef.current,
      commitCount: commitCountRef.current,
      resetCount: resetCountRef.current,
    }),
  };
}
