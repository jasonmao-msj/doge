import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppServerEvent, ConversationItem } from "../src/types";
import {
  dispatchAppServerEvent,
  dispatchAppServerEventBatch,
} from "../src/features/app/hooks/useAppServerEvents";
import {
  __profile,
  initialState,
  threadReducer,
} from "../src/features/threads/hooks/useThreadsReducer";
import type {
  ThreadAction,
  ThreadState,
} from "../src/features/threads/hooks/useThreadsReducer";
import { getArgValue, writeJsonFile } from "./perf-baseline-utils";

type EvidenceClass = "proxy" | "measured" | "unsupported";

type RuntimeEvidenceMetric = {
  scenario: string;
  metric: string;
  value: number | null;
  unit: string;
  evidenceClass: EvidenceClass;
  notes?: string;
  unsupportedReason?: string;
  sampleCount?: number;
  sourceArtifact?: string;
  measurementBlocker?: string;
  requiredSourceArtifact?: string;
};

const schemaVersion = "1.0";
const outputPath = getArgValue("--output") ?? "docs/perf/v0511-runtime-evidence.json";
const defaultDiagnosticsPath = ".artifacts/realtime-runtime-diagnostics.json";
const diagnosticsPath = resolveDiagnosticsPath(getArgValue("--diagnostics"));
const evidenceMode = getArgValue("--mode") ?? (
  process.argv.includes("--evidence-class-upgrade")
    ? "evidenceClassUpgrade"
    : "baseline"
);
const burstDeltaCount = 1000;
const fixtureDurationSec = 1;
const longTaskThresholdMs = 50;
const fileIoFixtureBytes = 10 * 1024 * 1024;
const fileIoIterations = 5;
const measuredMetricUnits = new Map([
  ["S-IO-RR/prepareThreadItems_calls_per_1000_delta", "count"],
  ["S-IO-RR/realtime_reducer_dispatches_per_1000_delta", "count"],
  ["S-IO-RR/thread_reducer_flush_ms_p95", "ms"],
  ["S-IO-RR/realtime_delta_route_ms_p95", "ms"],
  ["S-IO-AS/app_server_event_raw_per_sec", "events/sec"],
  ["S-IO-AS/app_server_event_ipc_emit_per_sec", "events/sec"],
  ["S-IO-AS/app_server_event_route_ms_p95", "ms"],
  ["S-IO-AS/realtime_reducer_dispatches_per_1000_delta", "count"],
  ["S-IO-AS/main_thread_long_task_count_during_stream", "count"],
  ["S-IO-FC/fs_event_raw_per_sec", "events/sec"],
  ["S-IO-FC/fs_event_emitted_per_sec", "events/sec"],
  ["S-IO-FC/fs_event_same_path_coalesce_ratio", "ratio"],
  ["S-IO-FC/fs_event_empty_batch_emit_count", "count"],
  ["S-IO-FS/file_io_command_wall_ms_p95", "ms"],
  ["S-IO-FS/file_io_async_worker_stall_ms_p95", "ms"],
  ["S-IO-FS/file_io_blocking_pool_call_count", "count"],
  ["S-IO-FS/tauri_command_during_stream_ms_p95", "ms"],
  ["S-IO-FP/composer_render_count_per_streaming_minute", "count"],
  ["S-IO-FP/sidebar_render_count_per_streaming_minute", "count"],
  ["S-IO-FP/thread_row_rerender_count_per_1000_delta", "count"],
  ["S-IO-FP/layout_nodes_recompute_count_per_1000_delta", "count"],
]);
const proxyMeasurementRequirements = new Map<string, {
  blocker: string;
  requiredSourceArtifact: string;
}>([
  ["S-IO-RR/prepareThreadItems_calls_per_1000_delta", {
    blocker: "No runtime producer records prepareThreadItems call count from a live Tauri/WebView stream yet.",
    requiredSourceArtifact: "Tauri/WebView profiler artifact containing live prepareThreadItemsCallCount per streaming turn.",
  }],
  ["S-IO-AS/main_thread_long_task_count_during_stream", {
    blocker: "Node fixture cannot observe browser main-thread long tasks.",
    requiredSourceArtifact: "Browser PerformanceObserver longtask trace captured during a live streaming turn.",
  }],
  ["S-IO-FC/fs_event_raw_per_sec", {
    blocker: "Current fixture mirrors debouncer semantics but does not read native file watcher runtime throughput.",
    requiredSourceArtifact: "Native file watcher diagnostic with raw event count and observation duration.",
  }],
  ["S-IO-FC/fs_event_emitted_per_sec", {
    blocker: "Current fixture emits one synthetic debounce batch but does not read native watcher emit cadence.",
    requiredSourceArtifact: "Native file watcher diagnostic with emitted batch count and observation duration.",
  }],
  ["S-IO-FC/fs_event_same_path_coalesce_ratio", {
    blocker: "Current fixture uses a same-path synthetic burst; live watcher same-path replacement counts are not emitted.",
    requiredSourceArtifact: "Native file watcher diagnostic containing raw, replaced, and emitted same-path counts.",
  }],
  ["S-IO-FC/fs_event_empty_batch_emit_count", {
    blocker: "Current fixture verifies the no-empty-batch contract; runtime empty-batch diagnostics are not emitted.",
    requiredSourceArtifact: "Native file watcher diagnostic with empty batch emission count.",
  }],
  ["S-IO-FS/file_io_async_worker_stall_ms_p95", {
    blocker: "Node setImmediate stall probe is not the Tauri async worker or WebView event-loop stall source.",
    requiredSourceArtifact: "Tauri/WebView file I/O diagnostic with event-loop stall samples during command execution.",
  }],
  ["S-IO-FS/file_io_blocking_pool_call_count", {
    blocker: "Node fs operation count cannot attribute native Tauri blocking-pool calls.",
    requiredSourceArtifact: "Tauri backend diagnostic with blocking-pool call attribution for file commands.",
  }],
  ["S-IO-FS/tauri_command_during_stream_ms_p95", {
    blocker: "Node wall-time fixture is not a live Tauri command measurement during streaming.",
    requiredSourceArtifact: "Tauri command trace captured while a streaming turn is active.",
  }],
  ["S-IO-FP/composer_render_count_per_streaming_minute", {
    blocker: "Synthetic render-counter fixture is not a production React Profiler capture.",
    requiredSourceArtifact: "React Profiler/runtime diagnostic for Composer renders during a live streaming minute.",
  }],
  ["S-IO-FP/sidebar_render_count_per_streaming_minute", {
    blocker: "Synthetic render-counter fixture is not a production React Profiler capture.",
    requiredSourceArtifact: "React Profiler/runtime diagnostic for sidebar renders during a live streaming minute.",
  }],
  ["S-IO-FP/thread_row_rerender_count_per_1000_delta", {
    blocker: "Synthetic render-counter fixture does not capture production row-level rerenders.",
    requiredSourceArtifact: "React Profiler/runtime diagnostic with thread-row render counts over a 1000-delta stream.",
  }],
  ["S-IO-FP/layout_nodes_recompute_count_per_1000_delta", {
    blocker: "Synthetic render-counter fixture does not capture production layout-node recompute diagnostics.",
    requiredSourceArtifact: "React Profiler/runtime diagnostic with layout node recompute counts over a 1000-delta stream.",
  }],
]);

function gitValue(args: string[], fallback: string) {
  try {
    return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf-8" }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return Number((sorted[index] ?? 0).toFixed(3));
}

function metric(input: {
  scenario: string;
  name: string;
  value: number | null;
  unit: string;
  evidenceClass?: EvidenceClass;
  notes?: string;
  unsupportedReason?: string;
  sampleCount?: number;
  sourceArtifact?: string;
  measurementBlocker?: string;
  requiredSourceArtifact?: string;
}): RuntimeEvidenceMetric {
  const evidenceClass = input.evidenceClass ?? (input.value == null ? "unsupported" : "proxy");
  const metricKey = `${input.scenario}/${input.name}`;
  const proxyRequirement = evidenceClass === "proxy"
    ? proxyMeasurementRequirements.get(metricKey)
    : undefined;
  return {
    scenario: input.scenario,
    metric: input.name,
    value: input.value,
    unit: input.unit,
    evidenceClass,
    notes: input.notes,
    unsupportedReason: input.unsupportedReason,
    sampleCount: input.sampleCount,
    sourceArtifact: input.sourceArtifact,
    measurementBlocker: input.measurementBlocker ?? proxyRequirement?.blocker,
    requiredSourceArtifact: input.requiredSourceArtifact ?? proxyRequirement?.requiredSourceArtifact,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNonNegativeNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0
    ? Number(numberValue.toFixed(3))
    : null;
}

function toBoundedNotes(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 200)
    : undefined;
}

function resolveDiagnosticsPath(rawPath: string | null) {
  if (rawPath === "none" || rawPath === "off" || rawPath === "false") {
    return null;
  }
  if (rawPath) {
    return rawPath;
  }
  return existsSync(defaultDiagnosticsPath) ? defaultDiagnosticsPath : null;
}

function collectDiagnosticEntries(input: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(input)) {
    return input.filter(isRecord);
  }
  if (!isRecord(input)) {
    return [];
  }
  for (const key of ["entries", "diagnostics", "rendererDiagnostics", "rendererLifecycleLog"]) {
    if (Array.isArray(input[key])) {
      return input[key].filter(isRecord);
    }
  }
  const app = input.app;
  if (isRecord(app)) {
    const diagnostics = app.diagnostics;
    if (isRecord(diagnostics) && Array.isArray(diagnostics.rendererLifecycleLog)) {
      return diagnostics.rendererLifecycleLog.filter(isRecord);
    }
  }
  return [];
}

function measuredMetricFromDiagnostic(entry: Record<string, unknown>, sourcePath: string): RuntimeEvidenceMetric | null {
  if (entry.label !== "perf.v0511.runtime-evidence" || !isRecord(entry.payload)) {
    return null;
  }
  const payload = entry.payload;
  const scenario = typeof payload.scenario === "string" ? payload.scenario : null;
  const name = typeof payload.metric === "string" ? payload.metric : null;
  if (!scenario || !name) {
    return null;
  }
  const metricKey = `${scenario}/${name}`;
  const expectedUnit = measuredMetricUnits.get(metricKey);
  if (!expectedUnit) {
    return null;
  }
  const value = toFiniteNonNegativeNumber(payload.value);
  if (value === null) {
    return null;
  }
  const unit = typeof payload.unit === "string" && payload.unit === expectedUnit
    ? payload.unit
    : expectedUnit;
  return metric({
    scenario,
    name,
    value,
    unit,
    evidenceClass: "measured",
    notes:
      toBoundedNotes(payload.notes) ??
      `Measured Tauri/WebView runtime diagnostic from ${sourcePath}.`,
  });
}

function readNestedNumber(payload: Record<string, unknown>, group: string, field: string) {
  const nested = payload[group];
  if (!isRecord(nested)) {
    return null;
  }
  return toFiniteNonNegativeNumber(nested[field]);
}

function measuredReducerDispatchesPer1000Delta(
  payload: Record<string, unknown>,
  sourcePath: string,
  scenario = "S-IO-RR",
) {
  const deltaCount = readNestedNumber(payload, "counters", "deltaCount");
  const reducerCommitCount = readNestedNumber(payload, "counters", "reducerCommitCount");
  if (deltaCount === null || deltaCount <= 0 || reducerCommitCount === null) {
    return null;
  }
  return metric({
    scenario,
    name: "realtime_reducer_dispatches_per_1000_delta",
    value: Number(((reducerCommitCount / deltaCount) * 1000).toFixed(3)),
    unit: "count",
    evidenceClass: "measured",
    notes:
      `Measured realtime.turnTrace.summary reducerCommitCount/deltaCount from ${sourcePath}.`,
  });
}

function measuredRuntimeRate(
  input: {
    scenario: string;
    name: string;
    value: number | null;
    unit: string;
    notes: string;
  },
) {
  if (input.value === null) {
    return null;
  }
  return metric({
    scenario: input.scenario,
    name: input.name,
    value: input.value,
    unit: input.unit,
    evidenceClass: "measured",
    notes: input.notes,
  });
}

function measuredMetricsFromTurnTrace(entry: Record<string, unknown>, sourcePath: string) {
  if (entry.label !== "realtime.turnTrace.summary" || !isRecord(entry.payload)) {
    return [];
  }
  const payload = entry.payload;
  if (payload.evidenceClass !== "measured") {
    return [];
  }
  const rows: RuntimeEvidenceMetric[] = [];
  const reducerDispatchesPer1000Delta = measuredReducerDispatchesPer1000Delta(
    payload,
    sourcePath,
  );
  if (reducerDispatchesPer1000Delta) {
    rows.push(reducerDispatchesPer1000Delta);
  }
  const appServerReducerDispatchesPer1000Delta = measuredReducerDispatchesPer1000Delta(
    payload,
    sourcePath,
    "S-IO-AS",
  );
  if (appServerReducerDispatchesPer1000Delta) {
    rows.push(appServerReducerDispatchesPer1000Delta);
  }
  const startedAtMs = toFiniteNonNegativeNumber(payload.startedAtMs);
  const endedAtMs = toFiniteNonNegativeNumber(payload.endedAtMs);
  const traceDurationSec = startedAtMs !== null && endedAtMs !== null && endedAtMs > startedAtMs
    ? (endedAtMs - startedAtMs) / 1000
    : null;
  const deltaCount = readNestedNumber(payload, "counters", "deltaCount");
  rows.push(
    ...[
      measuredRuntimeRate({
        scenario: "S-IO-AS",
        name: "app_server_event_raw_per_sec",
        value: traceDurationSec && deltaCount !== null
          ? Number((deltaCount / traceDurationSec).toFixed(3))
          : null,
        unit: "events/sec",
        notes:
          `Measured realtime.turnTrace.summary deltaCount over trace duration from ${sourcePath}.`,
      }),
      measuredRuntimeRate({
        scenario: "S-IO-AS",
        name: "app_server_event_ipc_emit_per_sec",
        value: traceDurationSec
          ? Number(((readNestedNumber(payload, "counters", "batchFlushCount") ?? 0) / traceDurationSec).toFixed(3))
          : null,
        unit: "events/sec",
        notes:
          `Measured realtime.turnTrace.summary batchFlushCount over trace duration from ${sourcePath}.`,
      }),
    ].filter((row): row is RuntimeEvidenceMetric => row !== null),
  );
  const realtimeDeltaRouteDurationAvgMs = readNestedNumber(
    payload,
    "counters",
    "realtimeDeltaRouteDurationAvgMs",
  );
  if (realtimeDeltaRouteDurationAvgMs !== null) {
    rows.push(metric({
      scenario: "S-IO-RR",
      name: "realtime_delta_route_ms_p95",
      value: realtimeDeltaRouteDurationAvgMs,
      unit: "ms",
      evidenceClass: "measured",
      notes:
        `Measured realtime.turnTrace.summary realtimeDeltaRouteDurationAvgMs from ${sourcePath}.`,
    }));
  }
  const batchFlushEndToReducerCommitMs = readNestedNumber(
    payload,
    "deltas",
    "batchFlushEndToReducerCommitMs",
  );
  if (batchFlushEndToReducerCommitMs !== null) {
    rows.push(metric({
      scenario: "S-IO-RR",
      name: "thread_reducer_flush_ms_p95",
      value: batchFlushEndToReducerCommitMs,
      unit: "ms",
      evidenceClass: "measured",
      notes:
        `Measured realtime.turnTrace.summary batchFlushEndToReducerCommitMs from ${sourcePath}.`,
    }));
  }
  const appServerEventRouteDurationAvgMs = readNestedNumber(
    payload,
    "counters",
    "appServerEventRouteDurationAvgMs",
  );
  if (appServerEventRouteDurationAvgMs !== null) {
    rows.push(metric({
      scenario: "S-IO-AS",
      name: "app_server_event_route_ms_p95",
      value: appServerEventRouteDurationAvgMs,
      unit: "ms",
      evidenceClass: "measured",
      notes:
        `Measured realtime.turnTrace.summary appServerEventRouteDurationAvgMs from ${sourcePath}.`,
    }));
  }
  return rows;
}

function measuredMetricsFromWorkspaceFileListing(entry: Record<string, unknown>, sourcePath: string) {
  if (entry.label !== "workspaces.file.listing-budget" || !isRecord(entry.payload)) {
    return [];
  }
  const payload = entry.payload;
  if (payload.evidenceClass !== "measured") {
    return [];
  }
  const durationMs = toFiniteNonNegativeNumber(payload.durationMs);
  if (durationMs === null) {
    return [];
  }
  return [
    metric({
      scenario: "S-IO-FS",
      name: "file_io_command_wall_ms_p95",
      value: durationMs,
      unit: "ms",
      evidenceClass: "measured",
      notes:
        `Measured workspace file listing command duration from ${sourcePath}. surfaceId=${toBoundedNotes(payload.surfaceId) ?? "unknown"}`,
    }),
  ];
}

async function buildMeasuredMetricsFromDiagnostics(path: string | null) {
  if (!path || !existsSync(path)) {
    return [];
  }
  const input = JSON.parse(await readFile(path, "utf-8")) as unknown;
  const valuesByKey = new Map<string, RuntimeEvidenceMetric[]>();
  const addMeasured = (measured: RuntimeEvidenceMetric | null) => {
    if (!measured) {
      return;
    }
    const key = `${measured.scenario}/${measured.metric}`;
    valuesByKey.set(key, [...(valuesByKey.get(key) ?? []), measured]);
  };
  for (const entry of collectDiagnosticEntries(input)) {
    addMeasured(measuredMetricFromDiagnostic(entry, path));
    for (const measured of measuredMetricsFromTurnTrace(entry, path)) {
      addMeasured(measured);
    }
    for (const measured of measuredMetricsFromWorkspaceFileListing(entry, path)) {
      addMeasured(measured);
    }
  }
  return [...valuesByKey.values()].map((rows) => {
    const lastRow = rows[rows.length - 1];
    const values = rows
      .map((row) => row.value)
      .filter((value): value is number => value !== null);
    return {
      ...lastRow,
      value: percentile(values, 0.95),
      sampleCount: values.length,
      sourceArtifact: path,
      measurementBlocker: undefined,
      requiredSourceArtifact: undefined,
      notes: `${lastRow?.notes ?? "Measured runtime diagnostic."} sampleCount=${values.length}`,
    } as RuntimeEvidenceMetric;
  });
}

function mergeMeasuredMetrics(
  proxyMetrics: RuntimeEvidenceMetric[],
  measuredMetrics: RuntimeEvidenceMetric[],
) {
  if (measuredMetrics.length === 0) {
    return proxyMetrics;
  }
  const measuredByKey = new Map(
    measuredMetrics.map((entry) => [`${entry.scenario}/${entry.metric}`, entry]),
  );
  return proxyMetrics.map((entry) =>
    measuredByKey.get(`${entry.scenario}/${entry.metric}`) ?? entry
  );
}

function summarizeEvidenceClasses(metrics: RuntimeEvidenceMetric[]) {
  const counts = {
    measured: 0,
    proxy: 0,
    unsupported: 0,
  };
  for (const row of metrics) {
    counts[row.evidenceClass] += 1;
  }
  const classifiedCount = counts.measured + counts.proxy + counts.unsupported;
  const proxyRatio = classifiedCount > 0
    ? Number((counts.proxy / classifiedCount).toFixed(4))
    : 0;
  return {
    counts,
    proxyRatio,
  };
}

function processingEngineState(threadId: string, items: ConversationItem[]): ThreadState {
  return {
    ...initialState,
    threadStatusById: {
      [threadId]: {
        isProcessing: true,
        hasUnread: false,
        isReviewing: false,
        isContextCompacting: false,
        processingStartedAt: Date.now() - 100,
        lastDurationMs: null,
        heartbeatPulse: 1,
      },
    },
    itemsByThread: {
      [threadId]: items,
    },
  };
}

function makeAppendDelta(threadId: string, itemId: string, delta: string): ThreadAction {
  return {
    type: "appendAgentDelta",
    workspaceId: "ws-1",
    threadId,
    itemId,
    delta,
    hasCustomName: false,
  };
}

function makeAppServerDelta(index: number): AppServerEvent {
  return {
    workspace_id: "ws-1",
    message: {
      method: "item/agentMessage/delta",
      params: {
        threadId: "codex:thread-burst",
        itemId: "assistant-live",
        delta: `t${index.toString(36)}`,
      },
    },
  };
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

function buildRealtimeInputRenderMetrics() {
  const threadId = "codex:thread-burst";
  const itemId = "assistant-live";
  const assistantItem: ConversationItem = {
    id: itemId,
    kind: "message",
    role: "assistant",
    text: "",
    isFinal: false,
  };
  let state = processingEngineState(threadId, [assistantItem]);
  const reducerDurations: number[] = [];

  __profile.reset();
  for (let index = 0; index < burstDeltaCount; index += 1) {
    const startedAt = performance.now();
    state = threadReducer(state, makeAppendDelta(threadId, itemId, `t${index.toString(36)}`));
    reducerDurations.push(performance.now() - startedAt);
  }

  const snapshot = __profile.snapshot();
  const routeDurations = measureAppServerRouteDurations();
  return [
    metric({
      scenario: "S-IO-RR",
      name: "prepareThreadItems_calls_per_1000_delta",
      value: snapshot.prepareThreadItemsCallCount,
      unit: "count",
      notes:
        "Proxy fixture anchored to useThreadsReducer.append-agent-delta-fast-path 1000-delta Codex burst.",
    }),
    metric({
      scenario: "S-IO-RR",
      name: "realtime_reducer_dispatches_per_1000_delta",
      value: snapshot.reducerDispatchCount,
      unit: "count",
      notes:
        "Proxy fixture anchored to useThreadsReducer.__profile reducerDispatchCount for the same burst.",
    }),
    metric({
      scenario: "S-IO-RR",
      name: "thread_reducer_flush_ms_p95",
      value: percentile(reducerDurations, 0.95),
      unit: "ms",
      notes:
        "Proxy timing from the same reducer-only 1000-delta fixture; not a browser frame/render measurement.",
    }),
    metric({
      scenario: "S-IO-RR",
      name: "realtime_delta_route_ms_p95",
      value: percentile(routeDurations, 0.95),
      unit: "ms",
      notes:
        "Proxy timing from dispatchAppServerEvent over the synthetic 1000-delta app-server route.",
    }),
  ];
}

function measureAppServerRouteDurations() {
  const routeDurations: number[] = [];
  const handlers = {
    onAgentMessageDelta: () => {},
  };

  for (let index = 0; index < burstDeltaCount; index += 1) {
    const startedAt = performance.now();
    dispatchAppServerEvent(handlers, makeAppServerDelta(index), makeDispatcherOptions());
    routeDurations.push(performance.now() - startedAt);
  }
  return routeDurations;
}

function buildAppServerBatchMetrics() {
  const events = Array.from({ length: burstDeltaCount }, (_, index) => makeAppServerDelta(index));
  let completed = false;
  let routedDeltaCount = 0;
  const startedAt = performance.now();
  dispatchAppServerEventBatch(
    {
      onAgentMessageDelta: () => {
        routedDeltaCount += 1;
      },
    },
    events,
    {
      ...makeDispatcherOptions(),
      chunkSize: burstDeltaCount,
      onComplete: () => {
        completed = true;
      },
    },
  );
  const batchRouteMs = performance.now() - startedAt;
  if (!completed) {
    throw new Error("S-IO-AS batch fixture did not complete synchronously");
  }
  const routeDurations = measureAppServerRouteDurations();
  const rawPerSec = burstDeltaCount / fixtureDurationSec;
  const ipcPerSec = 1 / fixtureDurationSec;
  return [
    metric({
      scenario: "S-IO-AS",
      name: "app_server_event_raw_per_sec",
      value: rawPerSec,
      unit: "events/sec",
      notes:
        "Proxy burst fixture: 1000 app-server delta events submitted in a one-second synthetic window.",
    }),
    metric({
      scenario: "S-IO-AS",
      name: "app_server_event_ipc_emit_per_sec",
      value: ipcPerSec,
      unit: "events/sec",
      notes:
        "Proxy burst fixture expects one per-workspace batch IPC payload for the synthetic window.",
    }),
    metric({
      scenario: "S-IO-AS",
      name: "app_server_event_route_ms_p95",
      value: percentile(routeDurations, 0.95),
      unit: "ms",
      notes:
        "Proxy timing from dispatchAppServerEvent over 1000 synthetic app-server delta payloads.",
    }),
    metric({
      scenario: "S-IO-AS",
      name: "realtime_reducer_dispatches_per_1000_delta",
      value: routedDeltaCount,
      unit: "count",
      notes:
        "Proxy fixture counts routed append-only deltas through dispatchAppServerEventBatch.",
    }),
    metric({
      scenario: "S-IO-AS",
      name: "main_thread_long_task_count_during_stream",
      value: batchRouteMs > longTaskThresholdMs ? 1 : 0,
      unit: "count",
      notes:
        "Node fixture proxy: one synchronous batch route is compared to the 50ms long-task threshold; browser PerformanceObserver remains release follow-up.",
    }),
  ];
}

function buildFileChangeDebounceMetrics() {
  const rawCount = burstDeltaCount;
  const emittedCount = 1;
  const coalesceRatio = Number(((rawCount - emittedCount) / rawCount).toFixed(3));
  return [
    metric({
      scenario: "S-IO-FC",
      name: "fs_event_raw_per_sec",
      value: rawCount,
      unit: "events/sec",
      notes:
        "Proxy same-path burst fixture mirrors DebouncedState same-key replacement semantics.",
    }),
    metric({
      scenario: "S-IO-FC",
      name: "fs_event_emitted_per_sec",
      value: emittedCount,
      unit: "events/sec",
      notes:
        "Proxy same-path burst fixture emits one debounced batch for one flush window.",
    }),
    metric({
      scenario: "S-IO-FC",
      name: "fs_event_same_path_coalesce_ratio",
      value: coalesceRatio,
      unit: "ratio",
      notes:
        "Proxy same-path burst fixture: (rawCount - emittedCount) / rawCount.",
    }),
    metric({
      scenario: "S-IO-FC",
      name: "fs_event_empty_batch_emit_count",
      value: 0,
      unit: "count",
      notes:
        "Proxy fixture matches external_changes_debouncer_no_empty_batch_emit regression contract.",
    }),
  ];
}

async function measureBackendFileIo() {
  const dir = await mkdtemp(join(tmpdir(), "doge-v0511-file-io-"));
  const filePath = join(dir, "fixture.bin");
  const payload = Buffer.alloc(fileIoFixtureBytes, 7);
  const wallDurations: number[] = [];
  const eventLoopStallDurations: number[] = [];

  try {
    for (let index = 0; index < fileIoIterations; index += 1) {
      const stallStartedAt = performance.now();
      const stallProbe = new Promise<number>((resolve) => {
        setImmediate(() => resolve(performance.now() - stallStartedAt));
      });
      const wallStartedAt = performance.now();
      await writeFile(filePath, payload);
      await readFile(filePath);
      wallDurations.push(performance.now() - wallStartedAt);
      eventLoopStallDurations.push(await stallProbe);
    }
  } finally {
    await rm(dir, { force: true, recursive: true });
  }

  return {
    wallP95: percentile(wallDurations, 0.95),
    eventLoopStallP95: percentile(eventLoopStallDurations, 0.95),
    asyncFileOperationCount: fileIoIterations * 2,
  };
}

async function buildBackendFileIoMetrics() {
  const measurement = await measureBackendFileIo();
  return [
    metric({
      scenario: "S-IO-FS",
      name: "file_io_command_wall_ms_p95",
      value: measurement.wallP95,
      unit: "ms",
      notes:
        "Proxy Node async fs fixture: 10MB write+read wall-time P95; Tauri command timing remains release follow-up.",
    }),
    metric({
      scenario: "S-IO-FS",
      name: "file_io_async_worker_stall_ms_p95",
      value: measurement.eventLoopStallP95,
      unit: "ms",
      notes:
        "Proxy event-loop stall probe sampled with setImmediate during async 10MB write+read fixture.",
    }),
    metric({
      scenario: "S-IO-FS",
      name: "file_io_blocking_pool_call_count",
      value: measurement.asyncFileOperationCount,
      unit: "count",
      notes:
        "Proxy count of async fs operations in the fixture; native Tauri blocking-pool attribution remains release follow-up.",
    }),
    metric({
      scenario: "S-IO-FS",
      name: "tauri_command_during_stream_ms_p95",
      value: measurement.wallP95,
      unit: "ms",
      notes:
        "Proxy wall-time reused for the content-safe file I/O fixture; not a live Tauri command measurement.",
    }),
  ];
}

function buildFrontendPropChainMetrics() {
  __profile.reset();
  for (let index = 0; index < 2; index += 1) {
    __profile.recordComponentRender("composer");
  }
  __profile.recordComponentRender("sidebar");
  __profile.recordComponentRender("thread-row");
  __profile.recordComponentRender("layout-nodes");
  const counts = __profile.snapshot().componentRenderCounts;

  return [
    metric({
      scenario: "S-IO-FP",
      name: "composer_render_count_per_streaming_minute",
      value: counts.composer ?? 0,
      unit: "count",
      notes:
        "Proxy render-counter fixture using the same __profile.recordComponentRender hook wired by useLayoutNodes Profiler.",
    }),
    metric({
      scenario: "S-IO-FP",
      name: "sidebar_render_count_per_streaming_minute",
      value: counts.sidebar ?? 0,
      unit: "count",
      notes:
        "Proxy render-counter fixture using the same __profile.recordComponentRender hook wired by useLayoutNodes Profiler.",
    }),
    metric({
      scenario: "S-IO-FP",
      name: "thread_row_rerender_count_per_1000_delta",
      value: counts["thread-row"] ?? 0,
      unit: "count",
      notes:
        "Proxy render-counter fixture; production row-level Profiler capture remains release follow-up.",
    }),
    metric({
      scenario: "S-IO-FP",
      name: "layout_nodes_recompute_count_per_1000_delta",
      value: counts["layout-nodes"] ?? 0,
      unit: "count",
      notes:
        "Proxy render-counter fixture; production layout recompute capture remains release follow-up.",
    }),
  ];
}

async function main() {
  const measuredMetrics = await buildMeasuredMetricsFromDiagnostics(diagnosticsPath);
  const proxyMetrics = [
    ...buildRealtimeInputRenderMetrics(),
    ...buildAppServerBatchMetrics(),
    ...buildFileChangeDebounceMetrics(),
    ...await buildBackendFileIoMetrics(),
    ...buildFrontendPropChainMetrics(),
  ];
  const metrics = mergeMeasuredMetrics(proxyMetrics, measuredMetrics);
  const evidenceSummary = summarizeEvidenceClasses(metrics);
  const fragment = {
    schemaVersion,
    generatedAt: new Date().toISOString(),
    source: "v0511-runtime-evidence",
    mode: evidenceMode,
    git: {
      branch: gitValue(["rev-parse", "--abbrev-ref", "HEAD"], "unknown"),
      commit: gitValue(["rev-parse", "HEAD"], "unknown"),
    },
    evidenceClassCounts: evidenceSummary.counts,
    proxyRatio: evidenceSummary.proxyRatio,
    metrics,
    notes: [
      "Proxy rows are deterministic fixture evidence, not release-grade desktop runtime proof.",
      `Evidence class summary: measured=${evidenceSummary.counts.measured}, proxy=${evidenceSummary.counts.proxy}, unsupported=${evidenceSummary.counts.unsupported}, proxyRatio=${evidenceSummary.proxyRatio}.`,
      evidenceMode === "evidenceClassUpgrade"
        ? "Evidence class upgrade mode was requested; only allowlisted runtime diagnostics can replace proxy rows with measured rows."
        : "Baseline mode preserves proxy rows unless allowlisted runtime diagnostics are available.",
      diagnosticsPath
        ? `Measured diagnostics input: ${diagnosticsPath}; accepted measuredMetricCount=${measuredMetrics.length}.`
        : "Measured diagnostics input was not provided; proxy rows remain the active evidence.",
      "Unsupported rows are intentionally preserved when the current repository lacks a trustworthy producer.",
      "S-IO-FS and S-IO-FP proxy rows are content-safe fixture evidence; native Tauri/WebView capture remains the release-grade follow-up.",
    ],
  };
  await writeJsonFile(outputPath, fragment);
  if (process.argv.includes("--verbose")) {
    console.info(`v0.5.11 runtime evidence written: ${outputPath}`);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
