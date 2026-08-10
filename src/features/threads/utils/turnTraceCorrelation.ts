// Per-turn trace correlation aggregator.
// Bounded, content-safe, dev/perf gated.
//
// Design / 验证：openspec/changes/realtime-trace-correlation-gate/design.md
// 关联：streamLatencyDiagnostics.ts（事件源），rendererDiagnostics（输出通道）。
//
// 关键约束：
// 1. 不存储 prompt、assistant body、tool output body、terminal content；只存 ids、durations、counts、booleans、bounded reason strings。
// 2. Per-turn summary 数量有界（默认 64 turns，TTL 30 min），避免长 session 无界增长。
// 3. trace 写入 dev/perf gate 内；非 dev/perf 模式下所有函数为 no-op。

import { appendRendererDiagnostic } from "../../../services/rendererDiagnostics";

export type TurnTraceMilestoneName =
  | "user-send-committed"
  | "runtime-process-started"
  | "first-engine-delta-ingress"
  | "batch-flush-start"
  | "batch-flush-end"
  | "reducer-commit"
  | "first-visible-row-render"
  | "first-visible-text-growth"
  | "terminal-settlement";

export const TURN_TRACE_MILESTONE_NAMES: readonly TurnTraceMilestoneName[] = [
  "user-send-committed",
  "runtime-process-started",
  "first-engine-delta-ingress",
  "batch-flush-start",
  "batch-flush-end",
  "reducer-commit",
  "first-visible-row-render",
  "first-visible-text-growth",
  "terminal-settlement",
] as const;

export type TurnTraceEvidenceClass = "measured" | "proxy" | "manual-only" | "unsupported";

export type TurnTraceDimensions = {
  workspaceId: string | null;
  threadId: string;
  turnId: string;
  engine: string | null;
  providerId: string | null;
  providerName: string | null;
  baseUrl: string | null;
  model: string | null;
  platform: string;
};

export type TurnTraceMilestones = Partial<Record<TurnTraceMilestoneName, number>>;

export type TurnTraceCounters = {
  deltaCount: number;
  batchFlushCount: number;
  reducerCommitCount: number;
  reasoningDeltaCount: number;
  toolDeltaCount: number;
  toolCompletedCount: number;
  visibleTextGrowthCount: number;
  cadenceSamples: number[];
  maxQueueDepth: number;
  reducerAmplification: number | null;
  batchFlushDurationSumMs: number;
  batchFlushDurationCount: number;
  batchFlushDurationAvgMs: number | null;
  realtimeDeltaRouteDurationSumMs: number;
  realtimeDeltaRouteDurationCount: number;
  realtimeDeltaRouteDurationAvgMs: number | null;
  appServerEventRouteDurationSumMs: number;
  appServerEventRouteDurationCount: number;
  appServerEventRouteDurationAvgMs: number | null;
  terminalSettlementLagMs: number | null;
};

export type TurnTraceSummary = {
  traceId: string;
  dimensions: TurnTraceDimensions;
  startedAtMs: number;
  endedAtMs: number | null;
  endedReason: "completed" | "abandoned" | "expired" | null;
  milestones: TurnTraceMilestones;
  deltas: {
    sendToFirstDeltaMs: number | null;
    firstDeltaToBatchFlushEndMs: number | null;
    batchFlushEndToReducerCommitMs: number | null;
    reducerCommitToFirstVisibleRowMs: number | null;
    firstDeltaToFirstVisibleTextMs: number | null;
    lastReducerCommitToTerminalSettlementMs: number | null;
  };
  counters: TurnTraceCounters;
  evidenceClass: TurnTraceEvidenceClass;
  evidenceReason: string;
};

export type TurnTraceSummarySink = (summary: TurnTraceSummary) => void;

const DEFAULT_MAX_TURNS = 64;
const DEFAULT_TTL_MS = 30 * 60 * 1000;
const STREAM_LATENCY_TRACE_FLAG_KEY = "doge.debug.streamLatencyTrace";
const TURN_TRACE_GATE_KEY = "doge.debug.turnTrace.enabled";
const FIRST_OBSERVED_MILESTONES = new Set<TurnTraceMilestoneName>([
  "first-engine-delta-ingress",
  "first-visible-row-render",
  "first-visible-text-growth",
]);

let traceSink: TurnTraceSummarySink | null = null;
let cachedTraceEnabled: boolean | null = null;
let forcedOn = false;

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function readBooleanFlag(key: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const value = window.localStorage.getItem(key);
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "on";
  } catch {
    return false;
  }
}

function isDevOrPerfTraceEnabled(): boolean {
  const env = (import.meta.env ?? {}) as Record<string, string | boolean | undefined>;
  if (env.MODE === "test") {
    return false;
  }
  return env.DEV === true || env.VITE_ENABLE_PERF_BASELINE === "1";
}

function isTraceEnabled(): boolean {
  if (forcedOn) {
    return true;
  }
  if (cachedTraceEnabled !== null) {
    return cachedTraceEnabled;
  }
  cachedTraceEnabled = readBooleanFlag(STREAM_LATENCY_TRACE_FLAG_KEY)
    || readBooleanFlag(TURN_TRACE_GATE_KEY)
    || isDevOrPerfTraceEnabled();
  return cachedTraceEnabled;
}

function generateTraceId(dimensions: Pick<TurnTraceDimensions, "workspaceId" | "threadId" | "turnId">): string {
  const safeFragment = (value: unknown): string => {
    if (typeof value !== "string") {
      return "unknown";
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return "unknown";
    }
    return trimmed.replace(/[^a-zA-Z0-9:_-]/g, "-").slice(0, 24);
  };
  const hash = hashTraceKey([
    dimensions.workspaceId ?? "",
    dimensions.threadId ?? "",
    dimensions.turnId ?? "",
  ].join("\u0000"));
  return `tt-${safeFragment(dimensions.threadId)}-${hash}`;
}

function hashTraceKey(value: string): string {
  // FNV-1a 32-bit: small, deterministic, browser-safe, and sufficient for
  // avoiding collisions caused by bounded human-readable trace id prefixes.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function sanitizeTimestamp(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function computeStrictDurationMs(startedAt: number | null | undefined, endedAt: number | null | undefined) {
  const started = sanitizeTimestamp(startedAt);
  const ended = sanitizeTimestamp(endedAt);
  if (started === null || ended === null || ended < started) {
    return null;
  }
  return ended - started;
}

function computeDeltas(milestones: TurnTraceMilestones): TurnTraceSummary["deltas"] {
  const get = (name: TurnTraceMilestoneName) => sanitizeTimestamp(milestones[name]);
  const firstDelta = get("first-engine-delta-ingress");
  const batchFlushEnd = get("batch-flush-end");
  const reducerCommit = get("reducer-commit");
  const firstVisibleRow = get("first-visible-row-render");
  const firstVisibleText = get("first-visible-text-growth");
  const terminalSettlement = get("terminal-settlement");
  const sendCommitted = get("user-send-committed");
  return {
    sendToFirstDeltaMs: sendCommitted !== null && firstDelta !== null
      ? Math.max(0, firstDelta - sendCommitted)
      : null,
    firstDeltaToBatchFlushEndMs: firstDelta !== null && batchFlushEnd !== null
      ? Math.max(0, batchFlushEnd - firstDelta)
      : null,
    batchFlushEndToReducerCommitMs: batchFlushEnd !== null && reducerCommit !== null
      ? Math.max(0, reducerCommit - batchFlushEnd)
      : null,
    reducerCommitToFirstVisibleRowMs: reducerCommit !== null && firstVisibleRow !== null
      ? Math.max(0, firstVisibleRow - reducerCommit)
      : null,
    firstDeltaToFirstVisibleTextMs: firstDelta !== null && firstVisibleText !== null
      ? Math.max(0, firstVisibleText - firstDelta)
      : null,
    lastReducerCommitToTerminalSettlementMs: reducerCommit !== null && terminalSettlement !== null
      ? Math.max(0, terminalSettlement - reducerCommit)
      : null,
  };
}

function appendCadenceSample(samples: number[], next: number, limit = 24): number[] {
  const sample = Math.max(0, next);
  const nextSamples = [...samples, sample];
  return nextSamples.length > limit
    ? nextSamples.slice(nextSamples.length - limit)
    : nextSamples;
}

type TurnRecord = {
  summary: TurnTraceSummary;
  lastUpdatedAtMs: number;
};

const turns = new Map<string, TurnRecord>();
const turnOrder: string[] = [];

function upsertTurn(record: TurnRecord) {
  const previous = turns.get(record.summary.traceId);
  turns.set(record.summary.traceId, record);
  if (!previous) {
    turnOrder.push(record.summary.traceId);
  }
  record.lastUpdatedAtMs = nowMs();
  trim();
}

function trim(maxTurns = DEFAULT_MAX_TURNS, ttlMs = DEFAULT_TTL_MS) {
  const cutoff = nowMs() - ttlMs;
  for (let i = turnOrder.length - 1; i >= 0; i -= 1) {
    const traceId = turnOrder[i];
    if (!traceId) continue;
    const record = turns.get(traceId);
    if (!record) {
      turnOrder.splice(i, 1);
      continue;
    }
    if (record.lastUpdatedAtMs < cutoff) {
      turns.delete(traceId);
      turnOrder.splice(i, 1);
    }
  }
  while (turnOrder.length > maxTurns) {
    const traceId = turnOrder.shift();
    if (traceId) {
      turns.delete(traceId);
    }
  }
}

function resolveEvidenceClass(
  counters: TurnTraceCounters,
  milestones: TurnTraceMilestones,
): { class: TurnTraceEvidenceClass; reason: string } {
  if (
    milestones["first-engine-delta-ingress"] !== undefined
    && milestones["first-visible-row-render"] !== undefined
    && milestones["first-visible-text-growth"] !== undefined
  ) {
    return {
      class: "measured",
      reason: "measured: ingress / batch / reducer / render milestones all timestamped in same clock domain (performance.now)",
    };
  }
  if (counters.deltaCount > 0) {
    return {
      class: "proxy",
      reason: "proxy: ingress recorded but visible render milestones are missing (replay/jsdom path)",
    };
  }
  if (milestones["user-send-committed"] !== undefined || milestones["runtime-process-started"] !== undefined) {
    return {
      class: "manual-only",
      reason: "manual-only: send / runtime started but no ingress observed",
    };
  }
  return {
    class: "unsupported",
    reason: "unsupported: no milestone recorded; realtime path not exercised in this session",
  };
}

function pushSink(summary: TurnTraceSummary) {
  if (traceSink) {
    try {
      traceSink(summary);
    } catch {
      // sink failure must not impact realtime hot path
    }
  }
  if (typeof window !== "undefined") {
    appendRendererDiagnostic("realtime.turnTrace.summary", {
      traceId: summary.traceId,
      workspaceId: summary.dimensions.workspaceId,
      threadId: summary.dimensions.threadId,
      turnId: summary.dimensions.turnId,
      engine: summary.dimensions.engine,
      providerId: summary.dimensions.providerId,
      model: summary.dimensions.model,
      platform: summary.dimensions.platform,
      startedAtMs: summary.startedAtMs,
      endedAtMs: summary.endedAtMs,
      endedReason: summary.endedReason,
      evidenceClass: summary.evidenceClass,
      evidenceReason: summary.evidenceReason,
      deltas: summary.deltas,
      counters: {
        deltaCount: summary.counters.deltaCount,
        batchFlushCount: summary.counters.batchFlushCount,
        reducerCommitCount: summary.counters.reducerCommitCount,
        reasoningDeltaCount: summary.counters.reasoningDeltaCount,
        toolDeltaCount: summary.counters.toolDeltaCount,
        toolCompletedCount: summary.counters.toolCompletedCount,
        visibleTextGrowthCount: summary.counters.visibleTextGrowthCount,
        maxQueueDepth: summary.counters.maxQueueDepth,
        reducerAmplification: summary.counters.reducerAmplification,
        batchFlushDurationSumMs: summary.counters.batchFlushDurationSumMs,
        batchFlushDurationCount: summary.counters.batchFlushDurationCount,
        batchFlushDurationAvgMs: summary.counters.batchFlushDurationAvgMs,
        realtimeDeltaRouteDurationSumMs: summary.counters.realtimeDeltaRouteDurationSumMs,
        realtimeDeltaRouteDurationCount: summary.counters.realtimeDeltaRouteDurationCount,
        realtimeDeltaRouteDurationAvgMs: summary.counters.realtimeDeltaRouteDurationAvgMs,
        appServerEventRouteDurationSumMs: summary.counters.appServerEventRouteDurationSumMs,
        appServerEventRouteDurationCount: summary.counters.appServerEventRouteDurationCount,
        appServerEventRouteDurationAvgMs: summary.counters.appServerEventRouteDurationAvgMs,
        terminalSettlementLagMs: summary.counters.terminalSettlementLagMs,
      },
    });
  }
}

function ensureTurn(dimensions: TurnTraceDimensions, startedAtMs: number): TurnTraceSummary {
  const traceId = generateTraceId(dimensions);
  const existing = turns.get(traceId);
  if (existing) {
    return existing.summary;
  }
  const summary: TurnTraceSummary = {
    traceId,
    dimensions: { ...dimensions },
    startedAtMs,
    endedAtMs: null,
    endedReason: null,
    milestones: {},
    deltas: {
      sendToFirstDeltaMs: null,
      firstDeltaToBatchFlushEndMs: null,
      batchFlushEndToReducerCommitMs: null,
      reducerCommitToFirstVisibleRowMs: null,
      firstDeltaToFirstVisibleTextMs: null,
      lastReducerCommitToTerminalSettlementMs: null,
    },
    counters: {
      deltaCount: 0,
      batchFlushCount: 0,
      reducerCommitCount: 0,
      reasoningDeltaCount: 0,
      toolDeltaCount: 0,
      toolCompletedCount: 0,
      visibleTextGrowthCount: 0,
      cadenceSamples: [],
      maxQueueDepth: 0,
      reducerAmplification: null,
      batchFlushDurationSumMs: 0,
      batchFlushDurationCount: 0,
      batchFlushDurationAvgMs: null,
      realtimeDeltaRouteDurationSumMs: 0,
      realtimeDeltaRouteDurationCount: 0,
      realtimeDeltaRouteDurationAvgMs: null,
      appServerEventRouteDurationSumMs: 0,
      appServerEventRouteDurationCount: 0,
      appServerEventRouteDurationAvgMs: null,
      terminalSettlementLagMs: null,
    },
    evidenceClass: "unsupported",
    evidenceReason: "not yet classified",
  };
  return summary;
}

function recordMilestone(
  dimensions: TurnTraceDimensions,
  name: TurnTraceMilestoneName,
  atMs: number,
  patchCounters?: (counters: TurnTraceCounters) => void,
) {
  if (!isTraceEnabled()) {
    return;
  }
  const traceId = generateTraceId(dimensions);
  const existing = turns.get(traceId);
  const baseSummary = existing?.summary ?? ensureTurn(dimensions, atMs);
  const milestoneAtMs =
    FIRST_OBSERVED_MILESTONES.has(name) && baseSummary.milestones[name] !== undefined
      ? baseSummary.milestones[name]
      : atMs;
  const summary: TurnTraceSummary = {
    ...baseSummary,
    dimensions: { ...baseSummary.dimensions, ...dimensions },
    milestones: {
      ...baseSummary.milestones,
      [name]: milestoneAtMs,
    },
    counters: { ...baseSummary.counters },
  };
  if (patchCounters) {
    patchCounters(summary.counters);
  }
  summary.deltas = computeDeltas(summary.milestones);
  if (summary.counters.deltaCount > 0 && summary.counters.reducerCommitCount > 0) {
    summary.counters.reducerAmplification = Number(
      (summary.counters.reducerCommitCount / Math.max(1, summary.counters.deltaCount)).toFixed(3),
    );
  }
  if (summary.counters.batchFlushDurationCount > 0) {
    summary.counters.batchFlushDurationAvgMs = Number(
      (summary.counters.batchFlushDurationSumMs / summary.counters.batchFlushDurationCount).toFixed(2),
    );
  }
  if (summary.counters.realtimeDeltaRouteDurationCount > 0) {
    summary.counters.realtimeDeltaRouteDurationAvgMs = Number(
      (
        summary.counters.realtimeDeltaRouteDurationSumMs /
        summary.counters.realtimeDeltaRouteDurationCount
      ).toFixed(3),
    );
  }
  if (summary.counters.appServerEventRouteDurationCount > 0) {
    summary.counters.appServerEventRouteDurationAvgMs = Number(
      (
        summary.counters.appServerEventRouteDurationSumMs /
        summary.counters.appServerEventRouteDurationCount
      ).toFixed(3),
    );
  }
  const evidence = resolveEvidenceClass(summary.counters, summary.milestones);
  summary.evidenceClass = evidence.class;
  summary.evidenceReason = evidence.reason;
  upsertTurn({ summary, lastUpdatedAtMs: nowMs() });
}

export function noteTurnSendCommitted(dimensions: TurnTraceDimensions, atMs: number = nowMs()) {
  recordMilestone(dimensions, "user-send-committed", atMs);
}

export function noteTurnRuntimeProcessStarted(
  dimensions: TurnTraceDimensions,
  atMs: number = nowMs(),
) {
  recordMilestone(dimensions, "runtime-process-started", atMs);
}

export function noteTurnFirstEngineDeltaIngress(
  dimensions: TurnTraceDimensions,
  atMs: number = nowMs(),
) {
  noteTurnDeltaIngress(dimensions, atMs);
}

export function noteTurnDeltaIngress(
  dimensions: TurnTraceDimensions,
  atMs: number = nowMs(),
) {
  recordMilestone(dimensions, "first-engine-delta-ingress", atMs, (counters) => {
    counters.deltaCount += 1;
  });
}

export function noteTurnBatchFlushBoundary(input: {
  dimensions: TurnTraceDimensions;
  startedAt: number;
  endedAt: number;
  routeStartedAt?: number;
  routeEndedAt?: number;
  eventCount: number;
  queueDepthAfter: number;
}) {
  if (!isTraceEnabled()) {
    return;
  }
  const flushDurationMs = Math.max(0, input.endedAt - input.startedAt);
  const routeDurationMs = computeStrictDurationMs(input.routeStartedAt, input.routeEndedAt);
  const perDeltaRouteDurationMs =
    routeDurationMs !== null && input.eventCount > 0
      ? routeDurationMs / input.eventCount
      : null;
  recordMilestone(
    input.dimensions,
    "batch-flush-start",
    input.startedAt,
    (counters) => {
      counters.batchFlushCount += 1;
      counters.batchFlushDurationSumMs += flushDurationMs;
      counters.batchFlushDurationCount += 1;
      if (routeDurationMs !== null) {
        counters.appServerEventRouteDurationSumMs += routeDurationMs;
        counters.appServerEventRouteDurationCount += 1;
      }
      if (perDeltaRouteDurationMs !== null) {
        counters.realtimeDeltaRouteDurationSumMs += perDeltaRouteDurationMs;
        counters.realtimeDeltaRouteDurationCount += 1;
      }
      if (input.queueDepthAfter > counters.maxQueueDepth) {
        counters.maxQueueDepth = input.queueDepthAfter;
      }
    },
  );
  recordMilestone(input.dimensions, "batch-flush-end", input.endedAt);
}

export function noteTurnReducerCommit(input: {
  dimensions: TurnTraceDimensions;
  atMs: number;
  isAssistantDelta: boolean;
  isReasoningDelta?: boolean;
  isToolDelta?: boolean;
  isToolCompleted?: boolean;
  cadenceSampleMs?: number;
}) {
  if (!isTraceEnabled()) {
    return;
  }
  const atMs = input.atMs;
  recordMilestone(
    input.dimensions,
    "reducer-commit",
    atMs,
    (counters) => {
      counters.reducerCommitCount += 1;
      // deltaCount is incremented by noteTurnDeltaIngress for every content
      // delta. The amplification ratio therefore reflects reducer work per
      // actual runtime delta, not per first-token stream.
      if (input.isReasoningDelta) {
        counters.reasoningDeltaCount += 1;
      }
      if (input.isToolDelta) {
        counters.toolDeltaCount += 1;
      }
      if (input.isToolCompleted) {
        counters.toolCompletedCount += 1;
      }
      if (typeof input.cadenceSampleMs === "number" && Number.isFinite(input.cadenceSampleMs)) {
        counters.cadenceSamples = appendCadenceSample(counters.cadenceSamples, input.cadenceSampleMs);
      }
    },
  );
}

export function noteTurnFirstVisibleRowRender(
  dimensions: TurnTraceDimensions,
  atMs: number = nowMs(),
) {
  recordMilestone(dimensions, "first-visible-row-render", atMs);
}

export function noteTurnFirstVisibleTextGrowth(
  dimensions: TurnTraceDimensions,
  input: { atMs: number; visibleTextGrowthCount: number },
) {
  recordMilestone(
    dimensions,
    "first-visible-text-growth",
    input.atMs,
    (counters) => {
      counters.visibleTextGrowthCount = input.visibleTextGrowthCount;
    },
  );
}

export function completeTurnTrace(
  dimensions: TurnTraceDimensions,
  input: { atMs: number; reason: "completed" | "abandoned" | "expired" },
) {
  if (!isTraceEnabled()) {
    return;
  }
  const traceId = generateTraceId(dimensions);
  const existing = turns.get(traceId);
  if (!existing) {
    return;
  }
  const next: TurnTraceSummary = {
    ...existing.summary,
    endedAtMs: input.atMs,
    endedReason: input.reason,
    milestones: {
      ...existing.summary.milestones,
      "terminal-settlement": input.atMs,
    },
    counters: { ...existing.summary.counters },
  };
  next.deltas = computeDeltas(next.milestones);
  if (existing.summary.counters.reducerCommitCount > 0 && next.milestones["reducer-commit"] !== undefined) {
    next.counters.terminalSettlementLagMs = Math.max(
      0,
      input.atMs - (next.milestones["reducer-commit"] ?? input.atMs),
    );
  }
  const evidence = resolveEvidenceClass(next.counters, next.milestones);
  next.evidenceClass = evidence.class;
  next.evidenceReason = evidence.reason;
  upsertTurn({ summary: next, lastUpdatedAtMs: nowMs() });
  pushSink(next);
}

export function listTurnTraceSummaries(): TurnTraceSummary[] {
  trim();
  return turnOrder
    .map((traceId) => turns.get(traceId)?.summary)
    .filter((summary): summary is TurnTraceSummary => Boolean(summary));
}

export function getTurnTraceSummary(
  threadId: string,
  turnId: string,
): TurnTraceSummary | null {
  trim();
  for (const summary of turnOrder.map((traceId) => turns.get(traceId)?.summary)) {
    if (!summary) continue;
    if (summary.dimensions.threadId === threadId && summary.dimensions.turnId === turnId) {
      return summary;
    }
  }
  return null;
}

export function registerTurnTraceSink(sink: TurnTraceSummarySink | null) {
  traceSink = sink;
}

export function isTurnTraceEnabled(): boolean {
  return isTraceEnabled();
}

export function resetTurnTraceCorrelationForTests() {
  turns.clear();
  turnOrder.length = 0;
  traceSink = null;
  cachedTraceEnabled = null;
  forcedOn = false;
}

export function __forceTurnTraceForTests(value: boolean) {
  forcedOn = value;
}

// Internal exports for testing only.
export const __turnTraceInternals = {
  DEFAULT_MAX_TURNS,
  DEFAULT_TTL_MS,
  trim,
  resolveEvidenceClass,
  computeDeltas,
};
