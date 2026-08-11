#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DEFAULT_INPUT_PATH = ".artifacts/realtime-runtime-diagnostics.json";
const DEFAULT_OUTPUT_PATH = "docs/perf/realtime-runtime-evidence.json";

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index !== -1) {
    return process.argv[index + 1] ?? null;
  }
  const prefix = `${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

function percentile(values, ratio) {
  const finite = values
    .map(toFiniteNumber)
    .filter((value) => value !== null)
    .sort((left, right) => left - right);
  if (finite.length === 0) {
    return null;
  }
  const index = Math.min(finite.length - 1, Math.max(0, Math.ceil(finite.length * ratio) - 1));
  return Number((finite[index] ?? 0).toFixed(2));
}

function median(values) {
  const finite = values
    .map(toFiniteNumber)
    .filter((value) => value !== null)
    .sort((left, right) => left - right);
  if (finite.length === 0) {
    return null;
  }
  const middle = Math.floor(finite.length / 2);
  const value = finite.length % 2 === 0
    ? ((finite[middle - 1] ?? 0) + (finite[middle] ?? 0)) / 2
    : (finite[middle] ?? 0);
  return Number(value.toFixed(3));
}

function collectEntries(input) {
  if (Array.isArray(input)) {
    return input;
  }
  if (!isRecord(input)) {
    return [];
  }
  for (const key of ["entries", "diagnostics", "rendererDiagnostics", "rendererLifecycleLog"]) {
    if (Array.isArray(input[key])) {
      return input[key];
    }
  }
  if (isRecord(input.app) && Array.isArray(input.app.diagnostics?.rendererLifecycleLog)) {
    return input.app.diagnostics.rendererLifecycleLog;
  }
  return [];
}

function collectMeasuredSummaries(entries) {
  return entries
    .filter((entry) => isRecord(entry) && entry.label === "realtime.turnTrace.summary")
    .map((entry) => (isRecord(entry.payload) ? entry.payload : null))
    .filter((payload) => payload !== null)
    .filter((payload) => payload.evidenceClass === "measured");
}

function collectCodexTurnStartAckDiagnostics(entries) {
  return entries
    .filter((entry) => isRecord(entry) && entry.label === "stream-latency/codex-turn-start-ack")
    .map((entry) => (isRecord(entry.payload) ? entry.payload : null))
    .filter((payload) => payload !== null);
}

function collectCodexAppServerTimingDiagnostics(entries) {
  return entries
    .filter((entry) => isRecord(entry) && entry.label === "stream-latency/app-server-event")
    .map((entry) => (isRecord(entry.payload) ? entry.payload : null))
    .filter((payload) => payload !== null)
    .filter((payload) => payload.traceSource === "codex-app-server");
}

function collectCodexPostAckFirstDeltaByTurn(codexTimingDiagnostics) {
  const byTurn = new Map();
  let fallbackIndex = 0;
  for (const diagnostic of codexTimingDiagnostics) {
    const firstTextDeltaMs = toFiniteNumber(diagnostic.turnStartResponseToFirstTextDeltaMs);
    if (firstTextDeltaMs === null) {
      continue;
    }
    const rawTurnId = typeof diagnostic.turnId === "string"
      ? diagnostic.turnId.trim()
      : "";
    const turnKey = rawTurnId || `event-${fallbackIndex += 1}`;
    const existing = byTurn.get(turnKey);
    if (existing && existing.firstTextDeltaMs <= firstTextDeltaMs) {
      existing.eventCount += 1;
      continue;
    }
    byTurn.set(turnKey, {
      turnId: rawTurnId || null,
      threadId: typeof diagnostic.threadId === "string" ? diagnostic.threadId : null,
      model: typeof diagnostic.model === "string" ? diagnostic.model : null,
      firstTextDeltaMs,
      firstRuntimeEventMs: toFiniteNumber(diagnostic.turnStartResponseToFirstRuntimeEventMs),
      firstRuntimeEventToFirstTextDeltaMs: toFiniteNumber(
        diagnostic.firstRuntimeEventToFirstTextDeltaMs,
      ),
      firstRuntimeEventToFirstAssistantItemEventMs: toFiniteNumber(
        diagnostic.firstRuntimeEventToFirstAssistantItemEventMs,
      ),
      firstAssistantItemEventToFirstTextDeltaMs: toFiniteNumber(
        diagnostic.firstAssistantItemEventToFirstTextDeltaMs,
      ),
      firstStreamEventMs: toFiniteNumber(diagnostic.turnStartResponseToFirstStreamEventMs),
      turnStartAckMs: toFiniteNumber(diagnostic.turnStartRequestToResponseMs),
      eventCountBeforeFirstTextDelta: toFiniteNumber(
        diagnostic.eventCountBeforeFirstTextDelta,
      ),
      reasoningEventCountBeforeFirstTextDelta: toFiniteNumber(
        diagnostic.reasoningEventCountBeforeFirstTextDelta,
      ),
      toolEventCountBeforeFirstTextDelta: toFiniteNumber(
        diagnostic.toolEventCountBeforeFirstTextDelta,
      ),
      methodsBeforeFirstTextDelta: normalizeStringList(
        diagnostic.methodsBeforeFirstTextDelta,
      ),
      firstRuntimeEventMethod:
        typeof diagnostic.firstRuntimeEventMethod === "string"
          ? diagnostic.firstRuntimeEventMethod
          : null,
      firstReasoningEventMethod:
        typeof diagnostic.firstReasoningEventMethod === "string"
          ? diagnostic.firstReasoningEventMethod
          : null,
      firstAssistantItemEventMethod:
        typeof diagnostic.firstAssistantItemEventMethod === "string"
          ? diagnostic.firstAssistantItemEventMethod
          : null,
      firstToolEventMethod:
        typeof diagnostic.firstToolEventMethod === "string"
          ? diagnostic.firstToolEventMethod
          : null,
      firstTextDeltaMethod:
        typeof diagnostic.firstTextDeltaMethod === "string"
          ? diagnostic.firstTextDeltaMethod
          : null,
      eventCount: existing ? existing.eventCount + 1 : 1,
    });
  }
  return [...byTurn.values()].sort(
    (left, right) => right.firstTextDeltaMs - left.firstTextDeltaMs,
  );
}

function metricFromValues({ scenario, metric, values, unit, notes, unsupportedReason }) {
  const value = metric === "reducerAmplificationMedian"
    ? median(values)
    : percentile(values, 0.95);
  return {
    scenario,
    metric,
    value,
    unit,
    evidenceClass: value === null ? "unsupported" : "measured",
    notes: value === null ? undefined : notes,
    unsupportedReason: value === null ? unsupportedReason : undefined,
  };
}

function collectTraceConsistencyCautions(summaries) {
  const cautions = [];
  for (const [index, summary] of summaries.entries()) {
    const visibleTextLagMs = toFiniteNumber(summary.deltas?.firstDeltaToFirstVisibleTextMs);
    const batchFlushWindowMs = toFiniteNumber(summary.deltas?.firstDeltaToBatchFlushEndMs);
    const reducerCommitWindowMs = toFiniteNumber(summary.deltas?.batchFlushEndToReducerCommitMs);
    const batchFlushDurationAvgMs = toFiniteNumber(summary.counters?.batchFlushDurationAvgMs);
    const visibleTextGrowthCount = toFiniteNumber(summary.counters?.visibleTextGrowthCount);
    const hasFastVisibleOutput = visibleTextLagMs !== null && visibleTextLagMs <= 500;
    const hasLargeSummaryWindow = [batchFlushWindowMs, reducerCommitWindowMs, batchFlushDurationAvgMs]
      .some((value) => value !== null && value >= 2_000);
    if (!hasFastVisibleOutput || !hasLargeSummaryWindow) {
      continue;
    }
    const traceId = typeof summary.traceId === "string" && summary.traceId.length > 0
      ? summary.traceId
      : `summary-${index + 1}`;
    const growthNote = visibleTextGrowthCount === null
      ? "visibleTextGrowthCount=missing"
      : `visibleTextGrowthCount=${visibleTextGrowthCount}`;
    cautions.push(
      `traceConsistencyCaution=${traceId}: fast visible text lag (${visibleTextLagMs}ms) coexists with large batch/reducer summary windows; ${growthNote}; inspect turnTrace/snapshot consistency before claiming client batch or reducer lag`,
    );
  }
  return cautions;
}

function collectFirstDeltaDominanceNotes(summaries) {
  const notes = [];
  for (const [index, summary] of summaries.entries()) {
    const firstDeltaLatencyMs = toFiniteNumber(summary.deltas?.sendToFirstDeltaMs);
    const visibleTextLagMs = toFiniteNumber(summary.deltas?.firstDeltaToFirstVisibleTextMs);
    const reducerAmplification = toFiniteNumber(summary.counters?.reducerAmplification);
    if (
      firstDeltaLatencyMs === null ||
      visibleTextLagMs === null ||
      firstDeltaLatencyMs < 2_000 ||
      visibleTextLagMs > 500 ||
      (reducerAmplification !== null && reducerAmplification > 1)
    ) {
      continue;
    }
    const traceId = typeof summary.traceId === "string" && summary.traceId.length > 0
      ? summary.traceId
      : `summary-${index + 1}`;
    const engine = typeof summary.engine === "string" && summary.engine.length > 0
      ? summary.engine
      : "unknown-engine";
    const model = typeof summary.model === "string" && summary.model.length > 0
      ? summary.model
      : "unknown-model";
    notes.push(
      `firstDeltaDominates=${traceId}: ${engine}/${model} waited ${firstDeltaLatencyMs}ms before first delta while visible lag was ${visibleTextLagMs}ms and reducerAmplification=${reducerAmplification ?? "missing"}; investigate upstream/provider/startup phase before client render optimization`,
    );
  }
  return notes;
}

function collectTurnStartAckComparisonNotes(summaries, ackDiagnostics) {
  const firstDeltaP95 = percentile(
    summaries.map((summary) => summary.deltas?.sendToFirstDeltaMs),
    0.95,
  );
  const turnStartAckP95 = percentile(
    ackDiagnostics.map((diagnostic) => diagnostic.durationMs),
    0.95,
  );
  if (firstDeltaP95 === null || turnStartAckP95 === null) {
    return [];
  }
  const postAckWaitMs = Math.max(0, Number((firstDeltaP95 - turnStartAckP95).toFixed(2)));
  return [
    `turnStartAckComparison=firstDeltaLatencyP95:${firstDeltaP95}ms turnStartAckLatencyP95:${turnStartAckP95}ms postAckFirstDeltaWaitApprox:${postAckWaitMs}ms`,
  ];
}

function collectCodexPostAckComparisonNotes(summaries, ackDiagnostics, codexTimingDiagnostics) {
  const firstDeltaP95 = percentile(
    summaries.map((summary) => summary.deltas?.sendToFirstDeltaMs),
    0.95,
  );
  const turnStartAckP95 = percentile(
    ackDiagnostics.map((diagnostic) => diagnostic.durationMs),
    0.95,
  );
  const codexPostAckByTurn = collectCodexPostAckFirstDeltaByTurn(codexTimingDiagnostics);
  const postAckFirstDeltaP95 = percentile(
    codexPostAckByTurn.map((diagnostic) => diagnostic.firstTextDeltaMs),
    0.95,
  );
  if (firstDeltaP95 === null || turnStartAckP95 === null || postAckFirstDeltaP95 === null) {
    return [];
  }
  return [
    `codexPostAckComparison=firstDeltaLatencyP95:${firstDeltaP95}ms turnStartAckLatencyP95:${turnStartAckP95}ms codexPostAckFirstDeltaP95:${postAckFirstDeltaP95}ms`,
  ];
}

function collectCodexPostAckPhaseNotes(codexPostAckFirstDeltaByTurn) {
  const postAckFirstRuntimeP95 = percentile(
    codexPostAckFirstDeltaByTurn.map((diagnostic) => diagnostic.firstRuntimeEventMs),
    0.95,
  );
  const firstRuntimeToTextP95 = percentile(
    codexPostAckFirstDeltaByTurn.map(
      (diagnostic) => diagnostic.firstRuntimeEventToFirstTextDeltaMs,
    ),
    0.95,
  );
  const firstRuntimeToAssistantItemP95 = percentile(
    codexPostAckFirstDeltaByTurn.map(
      (diagnostic) => diagnostic.firstRuntimeEventToFirstAssistantItemEventMs,
    ),
    0.95,
  );
  const firstAssistantItemToTextP95 = percentile(
    codexPostAckFirstDeltaByTurn.map(
      (diagnostic) => diagnostic.firstAssistantItemEventToFirstTextDeltaMs,
    ),
    0.95,
  );
  const postAckFirstTextP95 = percentile(
    codexPostAckFirstDeltaByTurn.map((diagnostic) => diagnostic.firstTextDeltaMs),
    0.95,
  );
  if (
    postAckFirstRuntimeP95 === null ||
    firstRuntimeToTextP95 === null ||
    postAckFirstTextP95 === null
  ) {
    return [];
  }
  const assistantItemBreakdown =
    firstRuntimeToAssistantItemP95 === null || firstAssistantItemToTextP95 === null
      ? ""
      : ` firstRuntimeEventToFirstAssistantItemP95:${firstRuntimeToAssistantItemP95}ms firstAssistantItemToFirstTextDeltaP95:${firstAssistantItemToTextP95}ms`;
  return [
    `codexPostAckPhaseBreakdown=firstRuntimeEventP95:${postAckFirstRuntimeP95}ms firstRuntimeEventToFirstTextDeltaP95:${firstRuntimeToTextP95}ms${assistantItemBreakdown} firstTextDeltaP95:${postAckFirstTextP95}ms`,
  ];
}

function collectCodexProviderFirstResponseDominanceNotes(codexPostAckFirstDeltaByTurn) {
  const notes = [];
  for (const diagnostic of codexPostAckFirstDeltaByTurn.slice(0, 5)) {
    const firstRuntimeToTextMs = toFiniteNumber(
      diagnostic.firstRuntimeEventToFirstTextDeltaMs,
    );
    const firstRuntimeToAssistantItemMs = toFiniteNumber(
      diagnostic.firstRuntimeEventToFirstAssistantItemEventMs,
    );
    const firstAssistantItemToTextMs = toFiniteNumber(
      diagnostic.firstAssistantItemEventToFirstTextDeltaMs,
    );
    const hasDominantAssistantItemWait =
      firstRuntimeToTextMs !== null &&
      firstRuntimeToAssistantItemMs !== null &&
      firstAssistantItemToTextMs !== null &&
      firstRuntimeToAssistantItemMs >= 2_000 &&
      firstRuntimeToAssistantItemMs >= firstRuntimeToTextMs * 0.75 &&
      firstAssistantItemToTextMs <= 500;
    if (!hasDominantAssistantItemWait) {
      continue;
    }
    const turnId = diagnostic.turnId ?? "unknown-turn";
    const model = diagnostic.model ?? "unknown-model";
    const reasoningCount = diagnostic.reasoningEventCountBeforeFirstTextDelta ?? "missing";
    const toolCount = diagnostic.toolEventCountBeforeFirstTextDelta ?? "missing";
    notes.push(
      `providerFirstResponseDominates=${turnId}: ${model} waited ${firstRuntimeToAssistantItemMs}ms from first runtime event to first assistant item, then ${firstAssistantItemToTextMs}ms to first text; reasoningBeforeFirstText=${reasoningCount} toolBeforeFirstText=${toolCount}; firstRuntimeEventMethod=${diagnostic.firstRuntimeEventMethod ?? "missing"} firstAssistantItemEventMethod=${diagnostic.firstAssistantItemEventMethod ?? "missing"}; investigate provider/model first-response phase before client render optimization`,
    );
  }
  return notes;
}

function buildFragment(summaries, ackDiagnostics, codexTimingDiagnostics, sourcePath) {
  const unsupportedReason = summaries.length === 0
    ? "No measured realtime.turnTrace.summary diagnostics were found. Enable turn trace in a Tauri/webview session and export renderer diagnostics."
    : undefined;
  const missingPreciseRouteTimingReason =
    "Measured realtime.turnTrace.summary diagnostics do not contain appServerEventRouteDurationAvgMs. Run a build with precise route timing instrumentation before claiming batch flush duration.";
  const visibleTextLagValues = summaries.map((summary) => summary.deltas?.firstDeltaToFirstVisibleTextMs);
  const firstDeltaLatencyValues = summaries.map((summary) => summary.deltas?.sendToFirstDeltaMs);
  const reducerAmplificationValues = summaries.map((summary) => summary.counters?.reducerAmplification);
  const batchFlushDurationValues = summaries.map((summary) =>
    summary.counters?.appServerEventRouteDurationAvgMs
  );
  const terminalSettlementValues = summaries.map((summary) =>
    summary.counters?.terminalSettlementLagMs ?? summary.deltas?.lastReducerCommitToTerminalSettlementMs
  );
  const turnStartAckLatencyValues = ackDiagnostics.map((diagnostic) => diagnostic.durationMs);
  const codexPostAckFirstDeltaByTurn =
    collectCodexPostAckFirstDeltaByTurn(codexTimingDiagnostics);
  const codexPostAckFirstDeltaValues = codexPostAckFirstDeltaByTurn.map(
    (diagnostic) => diagnostic.firstTextDeltaMs,
  );
  const codexPostAckFirstRuntimeEventValues = codexPostAckFirstDeltaByTurn.map(
    (diagnostic) => diagnostic.firstRuntimeEventMs,
  );
  const codexFirstRuntimeEventToFirstTextDeltaValues = codexPostAckFirstDeltaByTurn.map(
    (diagnostic) => diagnostic.firstRuntimeEventToFirstTextDeltaMs,
  );
  const codexFirstRuntimeEventToFirstAssistantItemValues = codexPostAckFirstDeltaByTurn.map(
    (diagnostic) => diagnostic.firstRuntimeEventToFirstAssistantItemEventMs,
  );
  const codexFirstAssistantItemToFirstTextDeltaValues = codexPostAckFirstDeltaByTurn.map(
    (diagnostic) => diagnostic.firstAssistantItemEventToFirstTextDeltaMs,
  );
  return {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    source: "realtime-runtime",
    metrics: [
      metricFromValues({
        scenario: "S-RS-FT",
        metric: "firstDeltaLatencyP95",
        values: firstDeltaLatencyValues,
        unit: "ms",
        notes: `measured runtime turn trace sendToFirstDeltaMs from ${sourcePath}`,
        unsupportedReason,
      }),
      metricFromValues({
        scenario: "S-RS-TA",
        metric: "turnStartAckLatencyP95",
        values: turnStartAckLatencyValues,
        unit: "ms",
        notes: `measured renderer Codex send_user_message ack diagnostics from ${sourcePath}`,
        unsupportedReason:
          unsupportedReason ??
          "No stream-latency/codex-turn-start-ack diagnostics were found. Run a build with Codex turn-start ack instrumentation.",
      }),
      metricFromValues({
        scenario: "S-RS-PA",
        metric: "codexPostAckFirstDeltaP95",
        values: codexPostAckFirstDeltaValues,
        unit: "ms",
        notes: `measured renderer stream-latency/app-server-event Codex dogeTiming from ${sourcePath}`,
        unsupportedReason:
          unsupportedReason ??
          "No Codex stream-latency/app-server-event diagnostics with turnStartResponseToFirstTextDeltaMs were found. Run a build with Codex backend post-ack timing instrumentation.",
      }),
      metricFromValues({
        scenario: "S-RS-PR",
        metric: "codexPostAckFirstRuntimeEventP95",
        values: codexPostAckFirstRuntimeEventValues,
        unit: "ms",
        notes: `measured renderer stream-latency/app-server-event Codex first runtime event from ${sourcePath}`,
        unsupportedReason:
          unsupportedReason ??
          "No Codex dogeTiming.turnStartResponseToFirstRuntimeEventMs diagnostics were found. Run a build with Codex backend phase timing instrumentation.",
      }),
      metricFromValues({
        scenario: "S-RS-RT",
        metric: "codexFirstRuntimeEventToFirstTextDeltaP95",
        values: codexFirstRuntimeEventToFirstTextDeltaValues,
        unit: "ms",
        notes: `measured renderer stream-latency/app-server-event Codex runtime-event-to-text phase from ${sourcePath}`,
        unsupportedReason:
          unsupportedReason ??
          "No Codex dogeTiming.firstRuntimeEventToFirstTextDeltaMs diagnostics were found. Run a build with Codex backend phase timing instrumentation.",
      }),
      metricFromValues({
        scenario: "S-RS-RI",
        metric: "codexFirstRuntimeEventToFirstAssistantItemP95",
        values: codexFirstRuntimeEventToFirstAssistantItemValues,
        unit: "ms",
        notes: `measured renderer stream-latency/app-server-event Codex runtime-event-to-assistant-item phase from ${sourcePath}`,
        unsupportedReason:
          unsupportedReason ??
          "No Codex dogeTiming.firstRuntimeEventToFirstAssistantItemEventMs diagnostics were found. Run a build with Codex assistant item phase timing instrumentation.",
      }),
      metricFromValues({
        scenario: "S-RS-IT",
        metric: "codexFirstAssistantItemToFirstTextDeltaP95",
        values: codexFirstAssistantItemToFirstTextDeltaValues,
        unit: "ms",
        notes: `measured renderer stream-latency/app-server-event Codex assistant-item-to-text phase from ${sourcePath}`,
        unsupportedReason:
          unsupportedReason ??
          "No Codex dogeTiming.firstAssistantItemEventToFirstTextDeltaMs diagnostics were found. Run a build with Codex assistant item phase timing instrumentation.",
      }),
      metricFromValues({
        scenario: "S-RS-VL",
        metric: "visibleTextLagP95",
        values: visibleTextLagValues,
        unit: "ms",
        notes: `measured runtime turn trace from ${sourcePath}`,
        unsupportedReason,
      }),
      metricFromValues({
        scenario: "S-RS-RA",
        metric: "reducerAmplificationMedian",
        values: reducerAmplificationValues,
        unit: "ratio",
        notes: `measured runtime turn trace from ${sourcePath}`,
        unsupportedReason,
      }),
      metricFromValues({
        scenario: "S-RS-FD",
        metric: "batchFlushDurationP95",
        values: batchFlushDurationValues,
        unit: "ms",
        notes: `measured runtime turn trace appServerEventRouteDurationAvgMs from ${sourcePath}`,
        unsupportedReason: unsupportedReason ?? missingPreciseRouteTimingReason,
      }),
      metricFromValues({
        scenario: "S-RS-TS",
        metric: "terminalSettlementP95",
        values: terminalSettlementValues,
        unit: "ms",
        notes: `measured runtime turn trace from ${sourcePath}`,
        unsupportedReason,
      }),
    ],
    diagnostics: {
      codexPostAckFirstDeltaByTurn: codexPostAckFirstDeltaByTurn.slice(0, 20),
    },
    notes: [
      `input=${sourcePath}`,
      `measuredSummaryCount=${summaries.length}`,
      `turnStartAckDiagnosticCount=${ackDiagnostics.length}`,
      `codexAppServerTimingDiagnosticCount=${codexTimingDiagnostics.length}`,
      `codexPostAckFirstDeltaTurnCount=${codexPostAckFirstDeltaByTurn.length}`,
      "contentSafety=ids, durations, counters, and dimensions only; no prompt, assistant text, tool output, or file content",
      ...collectTraceConsistencyCautions(summaries),
      ...collectFirstDeltaDominanceNotes(summaries),
      ...collectTurnStartAckComparisonNotes(summaries, ackDiagnostics),
      ...collectCodexPostAckComparisonNotes(summaries, ackDiagnostics, codexTimingDiagnostics),
      ...collectCodexPostAckPhaseNotes(codexPostAckFirstDeltaByTurn),
      ...collectCodexProviderFirstResponseDominanceNotes(codexPostAckFirstDeltaByTurn),
    ],
  };
}

async function writeJson(path, value) {
  const absolutePath = resolve(process.cwd(), path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

async function collectStreamPacingMetrics() {
  // 2026-06-24-harden-realtime-interaction-jank-during-tool-call
  // Reads docs/perf/v0.5.13-baseline.json (preferred) or v0511-runtime-evidence.json
  // (fallback) and surfaces 3 new capability metrics. Returns [] when neither
  // file is present so the script remains useful without the new feature.
  const candidates = [
    "docs/perf/v0.5.13-baseline.json",
    "docs/perf/v0511-runtime-evidence.json",
  ];
  let parsed = null;
  let source = null;
  for (const candidate of candidates) {
    const absolute = resolve(process.cwd(), candidate);
    if (!existsSync(absolute)) continue;
    try {
      parsed = JSON.parse(await readFile(absolute, "utf-8"));
      source = candidate;
      break;
    } catch {
      continue;
    }
  }
  if (!parsed) return [];
  const metrics = Array.isArray(parsed.metrics) ? parsed.metrics : [];
  const findMetric = (key) => metrics.find((m) => m.metric === key) ?? null;
  const make = (record, capabilityId, scenario) => {
    if (!record) return null;
    return {
      scenario: record.scenario ?? scenario,
      metric: record.metric,
      capabilityId,
      value: record.value,
      unit: record.unit,
      evidenceClass: record.evidenceClass ?? "proxy",
      notes: record.notes ?? null,
      source: `realtime-runtime-report:stream-pacing:${source}`,
    };
  };
  const out = [];
  for (const m of [
    make(findMetric("app_server_event_dropped_snapshot_count"), "app-server-event-stream-pacing", "S-IO-AS"),
    make(findMetric("app_server_event_payload_bytes_per_flush_p95"), "app-server-event-stream-pacing", "S-BATCH-BYTES"),
    make(findMetric("main_thread_long_task_count_during_stream"), "streaming-schedule-tier-rollback", "S-RS-SP"),
    make(findMetric("app_server_event_idle_yield_count"), "streaming-schedule-tier-rollback", "S-RS-SP"),
    make(findMetric("realtime_reducer_dispatches_per_active_turn_per_sec"), "streaming-schedule-tier-rollback", "S-RSC-TIER"),
    make(findMetric("toolOutputTailGateSaturated"), "tool-output-tail-gate", "S-TAIL-GATE"),
    make(findMetric("appendAgentMessageDelta_first_token_p95"), "streaming-schedule-tier-rollback", "S-RSC-TIER"),
    make(findMetric("snapshot_throttle_count"), "streaming-schedule-tier-rollback", "S-RSC-TIER"),
  ]) {
    if (m) out.push(m);
  }
  return out;
}

async function main() {
  const inputPath = getArgValue("--input") ?? DEFAULT_INPUT_PATH;
  const outputPath = getArgValue("--output") ?? DEFAULT_OUTPUT_PATH;
  const includeStreamPacing = hasArg("--include-stream-pacing");
  let input = null;
  if (existsSync(resolve(process.cwd(), inputPath))) {
    input = JSON.parse(await readFile(resolve(process.cwd(), inputPath), "utf-8"));
  }
  const entries = collectEntries(input);
  const summaries = collectMeasuredSummaries(entries);
  const ackDiagnostics = collectCodexTurnStartAckDiagnostics(entries);
  const codexTimingDiagnostics = collectCodexAppServerTimingDiagnostics(entries);
  const streamPacingMetrics = includeStreamPacing
    ? await collectStreamPacingMetrics()
    : [];
  const fragment = buildFragment(
    summaries,
    ackDiagnostics,
    codexTimingDiagnostics,
    inputPath,
  );
  if (includeStreamPacing) {
    fragment.streamPacingMetrics = streamPacingMetrics;
    fragment.streamPacingCapabilityIds = [
      "app-server-event-stream-pacing",
      "streaming-schedule-tier-rollback",
      "tool-output-tail-gate",
    ];
  }
  await writeJson(outputPath, fragment);
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(fragment, null, 2)}\n`);
  }
  if (process.argv.includes("--verbose")) {
    console.info(`realtime runtime measured summaries: ${summaries.length}`);
    if (includeStreamPacing) {
      console.info(`stream-pacing metrics: ${streamPacingMetrics.length}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
