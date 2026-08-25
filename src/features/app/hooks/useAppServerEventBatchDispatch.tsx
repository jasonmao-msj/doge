import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRenderScheduler } from "../../../hooks/useRenderScheduler";
import {
  appServerEventBackpressure,
  resetAppServerEventBackpressureForTests,
  subscribeAppServerEvents,
} from "../../../services/events";
import type { AppServerEvent } from "../../../types";
import {
  dispatchAppServerEvent,
  type AppServerEventHandlers,
  type DispatchAppServerEventOptions,
} from "./useAppServerEvents";
import { resolveLaneSchedule } from "@/conversation-presentation/renderSchedulingPolicy";
import { readStreamingScheduleTier } from "@/conversation-presentation/realtimePerfFlags";

// 2026-06-24-harden-realtime-interaction-jank-during-tool-call
// v2 app-server event consumer. `services/events.ts` owns the raw+batch
// bridge and is the only layer allowed to push into appServerEventBackpressure.
// This hook consumes that per-event stream and schedules reducer dispatch with
// `useRenderScheduler`, so dispatch becomes budget-bounded and yieldable.
//
// The exported pure function `dispatchAppServerEventBatch` keeps its
// v1 behavior (existing `useAppServerEvents.batch-consumer.test.tsx`
// setTimeout assertions are preserved). v2 path is opt-in via
// `streamingScheduleTier === "guarded" | "aggressive"`.

export type UseAppServerEventBatchDispatchOptions = DispatchAppServerEventOptions & {
  /** Optional completion callback fired when the in-flight queue drains. */
  onComplete?: () => void;
  /**
   * Whether the hook should internally subscribe to the unified app-server
   * per-event stream. Default `true`. Set to `false` when the caller handles
   * the fallback raw channel directly.
   */
  enableInternalBatchSubscription?: boolean;
};

export type UseAppServerEventBatchDispatchResult = {
  /** Flush the in-flight queue synchronously. Test-only surface. */
  __flushForTests: () => void;
  /** Reset backpressure state between tests. Test-only surface. */
  __resetBackpressureForTests: () => void;
  /** Yield counters from the underlying `useRenderScheduler`. */
  __getInstrumentationForTests: () => {
    chunkCount: number;
    yieldCount: number;
    inputPendingYieldCount: number;
    budgetMissCount: number;
    idleCallbackCount: number;
    timeoutFallbackCount: number;
  };
  /** Snapshot of backpressure stats. */
  __getBackpressureStatsForTests: () => {
    queueDepth: number;
    droppedCount: number;
    coalescedCount: number;
    flushCount: number;
    criticalBypassCount: number;
  };
  /** Test-only / legacy helper for synthetic batches. Production batch
   * payloads are pushed into backpressure only by `services/events.ts`. */
  submitBatch: (batch: readonly AppServerEvent[]) => void;
};

export function useAppServerEventBatchDispatch(
  handlers: AppServerEventHandlers,
  options: UseAppServerEventBatchDispatchOptions,
): UseAppServerEventBatchDispatchResult {
  const enableInternalBatchSubscription =
    options.enableInternalBatchSubscription !== false;
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const dispatcherOptionsRef = useRef(options);
  dispatcherOptionsRef.current = options;

  const tier = readStreamingScheduleTier();
  const schedule = resolveLaneSchedule({
    lane: "canvas",
    tier,
    isLiveRow: false,
    isHeavy: false,
    isCritical: false,
  });

  const renderScheduler = useRenderScheduler({
    budgetMs: schedule.budgetMs,
    idleTimeoutMs: schedule.idleTimeoutMs,
    diagnosticSurfaceId: "app-server-event-dispatch",
  });

  const queueRef = useRef<AppServerEvent[]>([]);
  const completedRef = useRef(false);
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;

  const dispatchOneEvent = useCallback((event: AppServerEvent) => {
    try {
      dispatchAppServerEvent(
        handlersRef.current,
        event,
        dispatcherOptionsRef.current,
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(
        "[useAppServerEventBatchDispatch] dispatch failed",
        error,
      );
    }
  }, []);

  const dispatchAllPending = useCallback((): boolean => {
    let any = false;
    const startedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    let dispatchedInChunk = 0;
    while (queueRef.current.length > 0 && dispatchedInChunk < 64) {
      const elapsed =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) -
        startedAt;
      if (dispatchedInChunk > 0 && scheduleRef.current.budgetMs > 0 && elapsed >= scheduleRef.current.budgetMs) {
        break;
      }
      const next = queueRef.current.shift()!;
      any = true;
      dispatchedInChunk += 1;
      dispatchOneEvent(next);
    }
    if (any && completedRef.current) {
      completedRef.current = false;
      dispatcherOptionsRef.current.onComplete?.();
    }
    if (queueRef.current.length > 0) {
      // More work pending; ask the scheduler to keep draining.
      return true;
    }
    return false;
  }, [dispatchOneEvent]);

  const submitBatch = useCallback((batch: readonly AppServerEvent[]) => {
    for (const event of batch) {
      appServerEventBackpressure.push(event);
    }
  }, []);

  useEffect(() => {
    if (!enableInternalBatchSubscription) {
      return undefined;
    }
    return subscribeAppServerEvents(
      (event) => {
        queueRef.current.push(event);
        renderScheduler.scheduleChunk(dispatchAllPending);
      },
    );
  }, [dispatchAllPending, renderScheduler, enableInternalBatchSubscription]);

  return useMemo<UseAppServerEventBatchDispatchResult>(
    () => ({
      submitBatch,
      __flushForTests: () => {
        // Drain backpressure + queue immediately.
        resetAppServerEventBackpressureForTests();
        queueRef.current.length = 0;
        dispatchAllPending();
      },
      __resetBackpressureForTests: () => {
        resetAppServerEventBackpressureForTests();
        queueRef.current.length = 0;
      },
      __getInstrumentationForTests: () =>
        renderScheduler.__getInstrumentationForTests(),
      __getBackpressureStatsForTests: () => {
        const stats = appServerEventBackpressure.getStats();
        return {
          queueDepth: stats.queueDepth,
          droppedCount: stats.droppedCount,
          coalescedCount: stats.coalescedCount,
          flushCount: stats.flushCount,
          criticalBypassCount: stats.criticalBypassCount,
        };
      },
    }),
    [dispatchAllPending, renderScheduler, submitBatch],
  );
}
