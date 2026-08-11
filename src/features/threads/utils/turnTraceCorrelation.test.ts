// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendRendererDiagnostic: vi.fn(),
}));

vi.mock("../../../services/rendererDiagnostics", () => ({
  appendRendererDiagnostic: mocks.appendRendererDiagnostic,
}));

import {
  __turnTraceInternals,
  completeTurnTrace,
  getTurnTraceSummary,
  isTurnTraceEnabled,
  listTurnTraceSummaries,
  noteTurnBatchFlushBoundary,
  noteTurnDeltaIngress,
  noteTurnFirstEngineDeltaIngress,
  noteTurnFirstVisibleRowRender,
  noteTurnFirstVisibleTextGrowth,
  noteTurnReducerCommit,
  noteTurnRuntimeProcessStarted,
  noteTurnSendCommitted,
  registerTurnTraceSink,
  resetTurnTraceCorrelationForTests,
  type TurnTraceDimensions,
  type TurnTraceSummary,
  type TurnTraceSummarySink,
} from "./turnTraceCorrelation";

const baseDimensions: TurnTraceDimensions = {
  workspaceId: "ws-1",
  threadId: "thread-1",
  turnId: "turn-1",
  engine: "claude",
  providerId: "anthropic",
  providerName: "Anthropic",
  baseUrl: "https://api.anthropic.com",
  model: "claude-3-7-sonnet",
  platform: "macos",
};

describe("turnTraceCorrelation", () => {
  beforeEach(() => {
    mocks.appendRendererDiagnostic.mockReset();
    window.localStorage.clear();
    window.localStorage.setItem("doge.debug.streamLatencyTrace", "1");
    resetTurnTraceCorrelationForTests();
  });

  afterEach(() => {
    resetTurnTraceCorrelationForTests();
    window.localStorage.clear();
  });

  it("records correlated milestones and computes deltas", () => {
    const t0 = 1_000;
    noteTurnSendCommitted(baseDimensions, t0);
    noteTurnRuntimeProcessStarted(baseDimensions, t0 + 50);
    noteTurnFirstEngineDeltaIngress(baseDimensions, t0 + 200);
    noteTurnBatchFlushBoundary({
      dimensions: baseDimensions,
      startedAt: t0 + 200,
      endedAt: t0 + 220,
      routeStartedAt: t0 + 221,
      routeEndedAt: t0 + 227,
      eventCount: 3,
      queueDepthAfter: 0,
    });
    noteTurnReducerCommit({
      dimensions: baseDimensions,
      atMs: t0 + 230,
      isAssistantDelta: true,
      cadenceSampleMs: 12,
    });
    noteTurnFirstVisibleRowRender(baseDimensions, t0 + 260);
    noteTurnFirstVisibleTextGrowth(baseDimensions, {
      atMs: t0 + 280,
      visibleTextGrowthCount: 1,
    });
    completeTurnTrace(baseDimensions, { atMs: t0 + 500, reason: "completed" });

    const summary = getTurnTraceSummary("thread-1", "turn-1");
    expect(summary).not.toBeNull();
    const s = summary as TurnTraceSummary;
    expect(s.dimensions).toEqual(baseDimensions);
    expect(s.evidenceClass).toBe("measured");
    expect(s.evidenceReason).toMatch(/measured/);
    expect(s.counters.deltaCount).toBe(1);
    expect(s.counters.reducerCommitCount).toBe(1);
    expect(s.counters.batchFlushCount).toBe(1);
    expect(s.counters.batchFlushDurationSumMs).toBe(20);
    expect(s.counters.batchFlushDurationCount).toBe(1);
    expect(s.counters.batchFlushDurationAvgMs).toBe(20);
    expect(s.counters.realtimeDeltaRouteDurationSumMs).toBe(2);
    expect(s.counters.realtimeDeltaRouteDurationCount).toBe(1);
    expect(s.counters.realtimeDeltaRouteDurationAvgMs).toBe(2);
    expect(s.counters.appServerEventRouteDurationSumMs).toBe(6);
    expect(s.counters.appServerEventRouteDurationCount).toBe(1);
    expect(s.counters.appServerEventRouteDurationAvgMs).toBe(6);
    expect(s.counters.reducerAmplification).toBe(1);
    expect(s.counters.terminalSettlementLagMs).toBe(270);

    expect(s.deltas.sendToFirstDeltaMs).toBe(200);
    expect(s.deltas.firstDeltaToBatchFlushEndMs).toBe(20);
    expect(s.deltas.batchFlushEndToReducerCommitMs).toBe(10);
    expect(s.deltas.reducerCommitToFirstVisibleRowMs).toBe(30);
    expect(s.deltas.firstDeltaToFirstVisibleTextMs).toBe(80);
    expect(s.deltas.lastReducerCommitToTerminalSettlementMs).toBe(270);

    expect(s.endedAtMs).toBe(t0 + 500);
    expect(s.endedReason).toBe("completed");

    // Renderer diagnostic should fire on completion
    expect(mocks.appendRendererDiagnostic).toHaveBeenCalledWith(
      "realtime.turnTrace.summary",
      expect.objectContaining({
        traceId: expect.any(String),
        evidenceClass: "measured",
      }),
    );
  });

  it("classifies as proxy when visible render milestones are missing", () => {
    noteTurnSendCommitted(baseDimensions, 0);
    noteTurnFirstEngineDeltaIngress(baseDimensions, 100);
    noteTurnReducerCommit({
      dimensions: baseDimensions,
      atMs: 110,
      isAssistantDelta: true,
    });
    completeTurnTrace(baseDimensions, { atMs: 200, reason: "completed" });
    const summary = getTurnTraceSummary("thread-1", "turn-1") as TurnTraceSummary;
    expect(summary.evidenceClass).toBe("proxy");
    expect(summary.evidenceReason).toMatch(/proxy/);
  });

  it("keeps first visible text milestone while advancing latest growth count", () => {
    noteTurnSendCommitted(baseDimensions, 0);
    noteTurnFirstEngineDeltaIngress(baseDimensions, 10);
    noteTurnReducerCommit({
      dimensions: baseDimensions,
      atMs: 20,
      isAssistantDelta: true,
    });
    noteTurnFirstVisibleRowRender(baseDimensions, 30);
    noteTurnFirstVisibleTextGrowth(baseDimensions, {
      atMs: 40,
      visibleTextGrowthCount: 1,
    });
    noteTurnFirstVisibleTextGrowth(baseDimensions, {
      atMs: 80,
      visibleTextGrowthCount: 4,
    });
    completeTurnTrace(baseDimensions, { atMs: 100, reason: "completed" });

    const summary = getTurnTraceSummary("thread-1", "turn-1") as TurnTraceSummary;
    expect(summary.milestones["first-visible-text-growth"]).toBe(40);
    expect(summary.deltas.firstDeltaToFirstVisibleTextMs).toBe(30);
    expect(summary.counters.visibleTextGrowthCount).toBe(4);
  });

  it("classifies as manual-only when only send/runtime started but no ingress", () => {
    noteTurnSendCommitted(baseDimensions, 0);
    noteTurnRuntimeProcessStarted(baseDimensions, 5);
    const summary = getTurnTraceSummary("thread-1", "turn-1") as TurnTraceSummary;
    expect(summary.evidenceClass).toBe("manual-only");
  });

  it("classifies as unsupported when no milestones recorded", () => {
    // No notes
    const summaries = listTurnTraceSummaries();
    expect(summaries).toEqual([]);
  });

  it("is content-safe: never stores prompt/assistant body/tool/terminal text", () => {
    noteTurnSendCommitted(baseDimensions, 0);
    noteTurnFirstEngineDeltaIngress(baseDimensions, 10);
    completeTurnTrace(baseDimensions, { atMs: 50, reason: "completed" });
    const summary = getTurnTraceSummary("thread-1", "turn-1") as TurnTraceSummary;
    // Forbid text-shaped fields explicitly.
    expect(Object.keys(summary)).toEqual(expect.arrayContaining([
      "traceId",
      "dimensions",
      "startedAtMs",
      "endedAtMs",
      "endedReason",
      "milestones",
      "deltas",
      "counters",
      "evidenceClass",
      "evidenceReason",
    ]));
    for (const key of ["prompt", "assistantText", "toolOutput", "terminalOutput", "body", "text"]) {
      expect((summary as unknown as Record<string, unknown>)[key]).toBeUndefined();
    }
    // Dimensions object must not contain text-bearing fields
    for (const forbidden of ["prompt", "assistantText", "toolOutput", "terminalOutput", "body", "text"]) {
      expect((summary.dimensions as unknown as Record<string, unknown>)[forbidden]).toBeUndefined();
    }
  });

  it("bounds the per-turn ring by FIFO eviction", () => {
    const max = __turnTraceInternals.DEFAULT_MAX_TURNS;
    for (let i = 0; i < max + 5; i += 1) {
      const dims: TurnTraceDimensions = { ...baseDimensions, turnId: `turn-${i}` };
      noteTurnSendCommitted(dims, i);
    }
    const summaries = listTurnTraceSummaries();
    expect(summaries.length).toBe(max);
    // Earliest turns (turn-0..turn-4) should be evicted
    expect(summaries[0]?.dimensions.turnId).toBe(`turn-5`);
  });

  it("keeps long turn ids distinct even when their readable prefixes match", () => {
    const prefix = "turn-with-a-long-shared-prefix-";
    noteTurnSendCommitted(
      { ...baseDimensions, turnId: `${prefix}alpha` },
      0,
    );
    noteTurnSendCommitted(
      { ...baseDimensions, turnId: `${prefix}bravo` },
      1,
    );

    const summaries = listTurnTraceSummaries();
    expect(summaries).toHaveLength(2);
    expect(new Set(summaries.map((summary) => summary.traceId)).size).toBe(2);
  });

  it("emits to a registered sink and the renderer diagnostic channel on completion", () => {
    const seen: TurnTraceSummary[] = [];
    const sink: TurnTraceSummarySink = (s) => {
      seen.push(s);
    };
    registerTurnTraceSink(sink);
    noteTurnSendCommitted(baseDimensions, 0);
    noteTurnFirstEngineDeltaIngress(baseDimensions, 5);
    noteTurnFirstVisibleRowRender(baseDimensions, 20);
    noteTurnFirstVisibleTextGrowth(baseDimensions, {
      atMs: 30,
      visibleTextGrowthCount: 1,
    });
    completeTurnTrace(baseDimensions, { atMs: 100, reason: "completed" });
    expect(seen.length).toBe(1);
    expect(seen[0]?.evidenceClass).toBe("measured");
    expect(mocks.appendRendererDiagnostic).toHaveBeenCalledWith(
      "realtime.turnTrace.summary",
      expect.objectContaining({ traceId: expect.any(String) }),
    );
  });

  it("ignores all writes when the trace gate is off", () => {
    window.localStorage.setItem("doge.debug.streamLatencyTrace", "0");
    window.localStorage.setItem("doge.debug.turnTrace.enabled", "0");
    resetTurnTraceCorrelationForTests();
    expect(isTurnTraceEnabled()).toBe(false);
    noteTurnSendCommitted(baseDimensions, 0);
    noteTurnFirstEngineDeltaIngress(baseDimensions, 10);
    completeTurnTrace(baseDimensions, { atMs: 50, reason: "completed" });
    expect(listTurnTraceSummaries()).toEqual([]);
  });

  it("counts every delta ingress without overwriting the first-delta milestone", () => {
    noteTurnSendCommitted(baseDimensions, 0);
    noteTurnFirstEngineDeltaIngress(baseDimensions, 10);
    noteTurnDeltaIngress(baseDimensions, 20);
    noteTurnDeltaIngress(baseDimensions, 25);
    noteTurnReducerCommit({ dimensions: baseDimensions, atMs: 15, isAssistantDelta: true });
    noteTurnReducerCommit({ dimensions: baseDimensions, atMs: 20, isAssistantDelta: true });
    noteTurnReducerCommit({ dimensions: baseDimensions, atMs: 25, isAssistantDelta: true });
    noteTurnFirstVisibleRowRender(baseDimensions, 30);
    noteTurnFirstVisibleTextGrowth(baseDimensions, { atMs: 35, visibleTextGrowthCount: 1 });
    completeTurnTrace(baseDimensions, { atMs: 100, reason: "completed" });
    const summary = getTurnTraceSummary("thread-1", "turn-1") as TurnTraceSummary;
    expect(summary.counters.reducerCommitCount).toBe(3);
    expect(summary.counters.deltaCount).toBe(3);
    expect(summary.milestones["first-engine-delta-ingress"]).toBe(10);
    // 3 commits / 3 deltas = 1
    expect(summary.counters.reducerAmplification).toBe(1);
    expect(summary.deltas.firstDeltaToFirstVisibleTextMs).toBe(25);
  });

  it("emits renderer diagnostic payload that is content-safe and bounded", () => {
    noteTurnSendCommitted(baseDimensions, 0);
    noteTurnFirstEngineDeltaIngress(baseDimensions, 10);
    noteTurnBatchFlushBoundary({
      dimensions: baseDimensions,
      startedAt: 10,
      endedAt: 20,
      eventCount: 1,
      queueDepthAfter: 0,
    });
    noteTurnReducerCommit({ dimensions: baseDimensions, atMs: 12, isAssistantDelta: true });
    noteTurnFirstVisibleRowRender(baseDimensions, 16);
    noteTurnFirstVisibleTextGrowth(baseDimensions, { atMs: 18, visibleTextGrowthCount: 1 });
    completeTurnTrace(baseDimensions, { atMs: 30, reason: "completed" });

    // Inspect every emit
    expect(mocks.appendRendererDiagnostic).toHaveBeenCalled();
    for (const call of mocks.appendRendererDiagnostic.mock.calls) {
      const label = call[0];
      const payload = call[1];
      const json = JSON.stringify(payload);
      // No conversation content.
      for (const forbidden of [
        "prompt", "assistantText", "toolOutput", "terminalOutput", "body", "text",
        "assistantBody", "toolBody", "terminalBody",
      ]) {
        expect(json.includes(forbidden)).toBe(false);
      }
      // Only the trace summary emit happens on completion.
      if (label === "realtime.turnTrace.summary") {
        expect(payload.traceId).toBeDefined();
        expect(payload.counters.deltaCount).toBeGreaterThan(0);
      }
    }
  });

  it("generateTraceId tolerates null/empty/non-string threadId/turnId without throwing", () => {
    // The defensive coercion in generateTraceId means these calls must not
    // throw even if the runtime passes a malformed dimensions shape.
    const asMalformedDimensions = (value: unknown): TurnTraceDimensions =>
      value as TurnTraceDimensions;
    expect(() => {
      noteTurnSendCommitted(
        asMalformedDimensions({
          workspaceId: null,
          threadId: null,
          turnId: null,
          engine: null,
          providerId: null,
          providerName: null,
          baseUrl: null,
          model: null,
          platform: "macos",
        }),
        0,
      );
      noteTurnFirstEngineDeltaIngress(
        asMalformedDimensions({
          workspaceId: null,
          threadId: undefined,
          turnId: "",
          engine: null,
          providerId: null,
          providerName: null,
          baseUrl: null,
          model: null,
          platform: "macos",
        }),
        10,
      );
    }).not.toThrow();
  });

  it("computeDeltas returns null for non-finite milestone timestamps", () => {
    // Cover the sanitizeTimestamp branch indirectly: record NaN / Infinity as
    // milestone and ensure deltas are null, not NaN.
    noteTurnSendCommitted(baseDimensions, 0);
    noteTurnFirstEngineDeltaIngress(baseDimensions, 100);
    noteTurnReducerCommit({ dimensions: baseDimensions, atMs: 110, isAssistantDelta: true });
    noteTurnFirstVisibleRowRender(baseDimensions, Number.NaN);
    noteTurnFirstVisibleTextGrowth(baseDimensions, { atMs: Number.POSITIVE_INFINITY, visibleTextGrowthCount: 1 });
    completeTurnTrace(baseDimensions, { atMs: 200, reason: "completed" });
    const summary = getTurnTraceSummary("thread-1", "turn-1") as TurnTraceSummary;
    // deltas should be null (not NaN) because we now sanitize timestamps.
    expect(summary.deltas.reducerCommitToFirstVisibleRowMs).toBeNull();
    expect(summary.deltas.firstDeltaToFirstVisibleTextMs).toBeNull();
  });

  it("captures maxQueueDepth from batch flushes", () => {
    noteTurnSendCommitted(baseDimensions, 0);
    noteTurnFirstEngineDeltaIngress(baseDimensions, 10);
    noteTurnBatchFlushBoundary({
      dimensions: baseDimensions,
      startedAt: 10,
      endedAt: 20,
      eventCount: 4,
      queueDepthAfter: 7,
    });
    noteTurnBatchFlushBoundary({
      dimensions: baseDimensions,
      startedAt: 30,
      endedAt: 40,
      eventCount: 3,
      queueDepthAfter: 4,
    });
    noteTurnReducerCommit({ dimensions: baseDimensions, atMs: 25, isAssistantDelta: true });
    noteTurnFirstVisibleRowRender(baseDimensions, 50);
    noteTurnFirstVisibleTextGrowth(baseDimensions, { atMs: 60, visibleTextGrowthCount: 1 });
    completeTurnTrace(baseDimensions, { atMs: 100, reason: "completed" });
    const summary = getTurnTraceSummary("thread-1", "turn-1") as TurnTraceSummary;
    expect(summary.counters.maxQueueDepth).toBe(7);
    expect(summary.counters.batchFlushCount).toBe(2);
  });

  it("keeps route work duration separate from the batch wait window", () => {
    noteTurnSendCommitted(baseDimensions, 0);
    noteTurnFirstEngineDeltaIngress(baseDimensions, 10);
    noteTurnBatchFlushBoundary({
      dimensions: baseDimensions,
      startedAt: 10,
      endedAt: 1_010,
      routeStartedAt: 1_011,
      routeEndedAt: 1_019,
      eventCount: 4,
      queueDepthAfter: 0,
    });
    noteTurnReducerCommit({ dimensions: baseDimensions, atMs: 1_020, isAssistantDelta: true });
    noteTurnFirstVisibleRowRender(baseDimensions, 1_030);
    noteTurnFirstVisibleTextGrowth(baseDimensions, { atMs: 1_040, visibleTextGrowthCount: 1 });
    completeTurnTrace(baseDimensions, { atMs: 1_050, reason: "completed" });

    const summary = getTurnTraceSummary("thread-1", "turn-1") as TurnTraceSummary;
    expect(summary.counters.batchFlushDurationAvgMs).toBe(1_000);
    expect(summary.counters.appServerEventRouteDurationAvgMs).toBe(8);
    expect(summary.counters.realtimeDeltaRouteDurationAvgMs).toBe(2);
  });

  it("ignores invalid precise route timing without dropping legacy batch counters", () => {
    noteTurnSendCommitted(baseDimensions, 0);
    noteTurnFirstEngineDeltaIngress(baseDimensions, 10);
    noteTurnBatchFlushBoundary({
      dimensions: baseDimensions,
      startedAt: 10,
      endedAt: 30,
      routeStartedAt: 40,
      routeEndedAt: 35,
      eventCount: 2,
      queueDepthAfter: 0,
    });
    completeTurnTrace(baseDimensions, { atMs: 50, reason: "completed" });

    const summary = getTurnTraceSummary("thread-1", "turn-1") as TurnTraceSummary;
    expect(summary.counters.batchFlushDurationAvgMs).toBe(20);
    expect(summary.counters.appServerEventRouteDurationAvgMs).toBeNull();
    expect(summary.counters.realtimeDeltaRouteDurationAvgMs).toBeNull();
  });
});
