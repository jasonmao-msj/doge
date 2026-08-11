import { useSyncExternalStore } from "react";
import { appendRendererDiagnostic } from "../../../services/rendererDiagnostics";
import { getCurrentClaudeConfig } from "../../../services/tauri";
import { isMacPlatform, isWindowsPlatform } from "../../../utils/platform";
import type { ConversationEngine } from "../contracts/conversationCurtainContracts";
import {
  completeTurnTrace,
  isTurnTraceEnabled,
  noteTurnBatchFlushBoundary,
  noteTurnDeltaIngress,
  noteTurnFirstEngineDeltaIngress,
  noteTurnFirstVisibleRowRender,
  noteTurnFirstVisibleTextGrowth,
  noteTurnReducerCommit,
  noteTurnRuntimeProcessStarted,
  noteTurnSendCommitted,
  type TurnTraceDimensions,
} from "./turnTraceCorrelation";
import { resetTurnTraceCorrelationForTests } from "./turnTraceCorrelation";

export type StreamPlatform = "windows" | "macos" | "linux" | "unknown";
export type StreamLatencyCategory =
  | "upstream-pending"
  | "claude-first-token-latency"
  | "claude-stdout-without-valid-event"
  | "claude-valid-event-without-text"
  | "render-amplification"
  | "visible-output-stall-after-first-delta"
  | "repeat-turn-blanking";
export type StreamMitigationProfileId =
  | "claude-qwen-windows-render-safe"
  | "claude-windows-visible-stream"
  | "claude-markdown-stream-recovery"
  | "codex-markdown-stream-recovery";

export type StreamMitigationProfile = {
  id: StreamMitigationProfileId;
  messageStreamingThrottleMs: number;
  reasoningStreamingThrottleMs: number;
  renderPlainTextWhileStreaming?: boolean;
};

export type StreamIngressSource = "delta" | "snapshot" | "completion";
export type StreamRecoverySource = "provider-final" | "live-shadow";

export type ThreadStreamLatencySnapshot = {
  threadId: string;
  workspaceId: string | null;
  turnId: string | null;
  engine: ConversationEngine | null;
  model: string | null;
  providerId: string | null;
  providerName: string | null;
  baseUrl: string | null;
  platform: StreamPlatform;
  startedAt: number | null;
  firstDeltaAt: number | null;
  lastDeltaAt: number | null;
  lastIngressAt: number | null;
  lastIngressGapMs: number | null;
  lastIngressSource: StreamIngressSource | null;
  lastIngressItemId: string | null;
  lastIngressTextLength: number;
  lastReducerMergeCostMs: number | null;
  lastNormalizationCostMs: number | null;
  lastRenderCostMs: number | null;
  lastRecoverySource: StreamRecoverySource | null;
  lastRecoverySourceId: string | null;
  pendingRenderSinceDeltaAt: number | null;
  deltaCount: number;
  cadenceSamplesMs: number[];
  firstVisibleRenderAt: number | null;
  firstVisibleRenderAfterDeltaMs: number | null;
  firstVisibleTextRenderAt: number | null;
  firstVisibleTextAfterDeltaMs: number | null;
  lastNonEmptyVisibleRenderAt: number | null;
  lastNonEmptyVisibleItemCount: number;
  lastVisibleTextRenderAt: number | null;
  lastVisibleTextAfterDeltaMs: number | null;
  lastVisibleTextItemId: string | null;
  lastVisibleTextLength: number;
  visibleTextGrowthCount: number;
  pendingVisibleTextSinceDeltaAt: number | null;
  lastRenderLagMs: number | null;
  latencyCategory: StreamLatencyCategory | null;
  candidateMitigationProfile: StreamMitigationProfileId | null;
  candidateMitigationReason: string | null;
  mitigationProfile: StreamMitigationProfileId | null;
  mitigationReason: string | null;
  upstreamPendingReported: boolean;
  firstTokenLatencyReported: boolean;
  renderAmplificationReported: boolean;
  visibleOutputStallReported: boolean;
  repeatTurnBlankingReported: boolean;
};

const CADENCE_SAMPLE_LIMIT = 12;
const DEFAULT_FIRST_VISIBLE_LATENCY_THRESHOLD_MS = 120;
const DEFAULT_RENDER_AMPLIFICATION_THRESHOLD_MS = 160;
const DEFAULT_VISIBLE_OUTPUT_STALL_THRESHOLD_MS = 700;
const CODEX_INGRESS_GAP_DIAGNOSTIC_MS = 2_000;
const LARGE_INGRESS_TEXT_DIAGNOSTIC_CHARS = 1_000;
const LONG_LIVE_ROW_DIAGNOSTIC_CHARS = 20_000;
const STREAM_MITIGATION_DISABLE_FLAG_KEY = "doge.debug.streamMitigation.disabled";
const STREAM_LATENCY_TRACE_FLAG_KEY = "doge.debug.streamLatencyTrace";
const STREAM_LATENCY_FIRST_VISIBLE_THRESHOLD_KEY =
  "doge.debug.streamLatency.firstVisibleLatencyMs";
const STREAM_LATENCY_RENDER_AMPLIFICATION_THRESHOLD_KEY =
  "doge.debug.streamLatency.renderAmplificationMs";
const STREAM_LATENCY_VISIBLE_OUTPUT_STALL_THRESHOLD_KEY =
  "doge.debug.streamLatency.visibleOutputStallMs";

const STREAM_MITIGATION_PROFILES: Readonly<Record<StreamMitigationProfileId, StreamMitigationProfile>> = {
  "claude-qwen-windows-render-safe": {
    id: "claude-qwen-windows-render-safe",
    messageStreamingThrottleMs: 120,
    reasoningStreamingThrottleMs: 260,
    renderPlainTextWhileStreaming: true,
  },
  "claude-windows-visible-stream": {
    id: "claude-windows-visible-stream",
    messageStreamingThrottleMs: 120,
    reasoningStreamingThrottleMs: 260,
    renderPlainTextWhileStreaming: true,
  },
  "claude-markdown-stream-recovery": {
    id: "claude-markdown-stream-recovery",
    messageStreamingThrottleMs: 120,
    reasoningStreamingThrottleMs: 260,
    renderPlainTextWhileStreaming: true,
  },
  "codex-markdown-stream-recovery": {
    id: "codex-markdown-stream-recovery",
    messageStreamingThrottleMs: 120,
    reasoningStreamingThrottleMs: 220,
  },
};

const snapshotByThread = new Map<string, ThreadStreamLatencySnapshot>();
// useSyncExternalStore 的读取源。内部快照每个流式 delta 都换引用（计时/测量字段），
// 若直接暴露给 getSnapshot，React 的渲染一致性检查会把每次 delta 判成 tearing 并强制
// 同步重渲染——双会话高频流式下连环 50 次即 Maximum update depth (#185) 白屏。
// 该 Map 只在可观察字段（shouldNotifyThreadStreamLatencySnapshotListeners）变化时更新，
// 保证 getSnapshot 引用与订阅通知同步变化。
const publishedSnapshotByThread = new Map<string, ThreadStreamLatencySnapshot>();
const latestProviderConfigRequestByThread = new Map<string, number>();
const visibleOutputStallTimerByThread = new Map<string, ReturnType<typeof setTimeout>>();
const snapshotListeners = new Set<() => void>();
let streamLatencyTraceEnabledCache: boolean | null = null;

type ObservableThreadStreamLatencySnapshotFields = Pick<
  ThreadStreamLatencySnapshot,
  | "latencyCategory"
  | "candidateMitigationProfile"
  | "candidateMitigationReason"
  | "mitigationProfile"
  | "mitigationReason"
>;

function notifySnapshotListeners() {
  snapshotListeners.forEach((listener) => {
    listener();
  });
}

function pickObservableThreadStreamLatencySnapshotFields(
  snapshot: ThreadStreamLatencySnapshot,
): ObservableThreadStreamLatencySnapshotFields {
  return {
    latencyCategory: snapshot.latencyCategory,
    candidateMitigationProfile: snapshot.candidateMitigationProfile,
    candidateMitigationReason: snapshot.candidateMitigationReason,
    mitigationProfile: snapshot.mitigationProfile,
    mitigationReason: snapshot.mitigationReason,
  };
}

function buildTraceDimensionsFromSnapshot(
  snapshot: ThreadStreamLatencySnapshot,
): TurnTraceDimensions | null {
  if (!snapshot.turnId) {
    return null;
  }
  return {
    workspaceId: snapshot.workspaceId,
    threadId: snapshot.threadId,
    turnId: snapshot.turnId,
    engine: snapshot.engine,
    providerId: snapshot.providerId,
    providerName: snapshot.providerName,
    baseUrl: snapshot.baseUrl,
    model: snapshot.model,
    platform: snapshot.platform,
  };
}

export function shouldNotifyThreadStreamLatencySnapshotListeners(
  previous: ThreadStreamLatencySnapshot,
  next: ThreadStreamLatencySnapshot,
) {
  const previousObservableFields = pickObservableThreadStreamLatencySnapshotFields(previous);
  const nextObservableFields = pickObservableThreadStreamLatencySnapshotFields(next);
  return (
    previousObservableFields.latencyCategory !== nextObservableFields.latencyCategory ||
    previousObservableFields.candidateMitigationProfile
      !== nextObservableFields.candidateMitigationProfile ||
    previousObservableFields.candidateMitigationReason
      !== nextObservableFields.candidateMitigationReason ||
    previousObservableFields.mitigationProfile !== nextObservableFields.mitigationProfile ||
    previousObservableFields.mitigationReason !== nextObservableFields.mitigationReason
  );
}

function normalizeNullableString(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeVisibleTextLength(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function createInitialSnapshot(threadId: string): ThreadStreamLatencySnapshot {
  return {
    threadId,
    workspaceId: null,
    turnId: null,
    engine: null,
    model: null,
    providerId: null,
    providerName: null,
    baseUrl: null,
    platform: "unknown",
    startedAt: null,
    firstDeltaAt: null,
    lastDeltaAt: null,
    lastIngressAt: null,
    lastIngressGapMs: null,
    lastIngressSource: null,
    lastIngressItemId: null,
    lastIngressTextLength: 0,
    lastReducerMergeCostMs: null,
    lastNormalizationCostMs: null,
    lastRenderCostMs: null,
    lastRecoverySource: null,
    lastRecoverySourceId: null,
    pendingRenderSinceDeltaAt: null,
    deltaCount: 0,
    cadenceSamplesMs: [],
    firstVisibleRenderAt: null,
    firstVisibleRenderAfterDeltaMs: null,
    firstVisibleTextRenderAt: null,
    firstVisibleTextAfterDeltaMs: null,
    lastNonEmptyVisibleRenderAt: null,
    lastNonEmptyVisibleItemCount: 0,
    lastVisibleTextRenderAt: null,
    lastVisibleTextAfterDeltaMs: null,
    lastVisibleTextItemId: null,
    lastVisibleTextLength: 0,
    visibleTextGrowthCount: 0,
    pendingVisibleTextSinceDeltaAt: null,
    lastRenderLagMs: null,
    latencyCategory: null,
    candidateMitigationProfile: null,
    candidateMitigationReason: null,
    mitigationProfile: null,
    mitigationReason: null,
    upstreamPendingReported: false,
    firstTokenLatencyReported: false,
    renderAmplificationReported: false,
    visibleOutputStallReported: false,
    repeatTurnBlankingReported: false,
  };
}

function getOrCreateSnapshot(threadId: string) {
  return snapshotByThread.get(threadId) ?? createInitialSnapshot(threadId);
}

function updateThreadSnapshot(
  threadId: string,
  updater: (snapshot: ThreadStreamLatencySnapshot) => ThreadStreamLatencySnapshot,
) {
  const current = getOrCreateSnapshot(threadId);
  const next = updater(current);
  if (next === current) {
    return current;
  }
  snapshotByThread.set(threadId, next);
  if (shouldNotifyThreadStreamLatencySnapshotListeners(current, next)) {
    publishedSnapshotByThread.set(threadId, next);
    notifySnapshotListeners();
  }
  return next;
}

function appendCadenceSample(samples: number[], nextSampleMs: number) {
  const sample = Math.max(0, nextSampleMs);
  const nextSamples = [...samples, sample];
  return nextSamples.length > CADENCE_SAMPLE_LIMIT
    ? nextSamples.slice(nextSamples.length - CADENCE_SAMPLE_LIMIT)
    : nextSamples;
}

function resolvePlatform(): StreamPlatform {
  if (isWindowsPlatform()) {
    return "windows";
  }
  if (isMacPlatform()) {
    return "macos";
  }
  if (typeof navigator !== "undefined") {
    const normalizedPlatform = (
      (
        navigator as Navigator & {
          userAgentData?: { platform?: string };
        }
      ).userAgentData?.platform ??
      navigator.platform ??
      ""
    ).toLowerCase();
    if (normalizedPlatform.includes("linux")) {
      return "linux";
    }
  }
  return "unknown";
}

function summarizeCadence(samples: number[]) {
  if (!samples.length) {
    return {
      chunkCadenceAvgMs: null,
      chunkCadenceMaxMs: null,
    };
  }
  const total = samples.reduce((sum, sample) => sum + sample, 0);
  return {
    chunkCadenceAvgMs: Number((total / samples.length).toFixed(1)),
    chunkCadenceMaxMs: Math.max(...samples),
  };
}

function isStreamMitigationDisabled() {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const value = window.localStorage.getItem(STREAM_MITIGATION_DISABLE_FLAG_KEY);
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "on";
  } catch {
    return false;
  }
}

function readBooleanDebugFlag(key: string) {
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

function readNonNegativeNumberDebugConfig(key: string, fallback: number) {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const rawValue = window.localStorage.getItem(key);
    const normalizedValue = rawValue?.trim() ?? "";
    if (!normalizedValue) {
      return fallback;
    }
    const parsed = Number(normalizedValue);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function getStreamLatencyThresholds() {
  return {
    firstVisibleLatencyMs: readNonNegativeNumberDebugConfig(
      STREAM_LATENCY_FIRST_VISIBLE_THRESHOLD_KEY,
      DEFAULT_FIRST_VISIBLE_LATENCY_THRESHOLD_MS,
    ),
    renderAmplificationMs: readNonNegativeNumberDebugConfig(
      STREAM_LATENCY_RENDER_AMPLIFICATION_THRESHOLD_KEY,
      DEFAULT_RENDER_AMPLIFICATION_THRESHOLD_MS,
    ),
    visibleOutputStallMs: readNonNegativeNumberDebugConfig(
      STREAM_LATENCY_VISIBLE_OUTPUT_STALL_THRESHOLD_KEY,
      DEFAULT_VISIBLE_OUTPUT_STALL_THRESHOLD_MS,
    ),
  };
}

/**
 * stream-latency trace 必须显式 opt-in（localStorage flag 或 perf baseline 构建）。
 * 历史上 DEV 模式默认开启，导致每个 delta dispatch 都触发 per-delta 诊断 append，
 * 是对话流式期间主线程被诊断链路拖垮（5 FPS）的直接根因之一。
 */
export function isStreamLatencyTraceEnabled() {
  if (streamLatencyTraceEnabledCache === null) {
    const env = (import.meta.env ?? {}) as Record<string, string | boolean | undefined>;
    streamLatencyTraceEnabledCache = readBooleanDebugFlag(STREAM_LATENCY_TRACE_FLAG_KEY)
      || (env.MODE !== "test" && env.VITE_ENABLE_PERF_BASELINE === "1");
  }
  return streamLatencyTraceEnabledCache;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeNonNegativeFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeString(item).trim())
    .filter((item) => item.length > 0);
}

function clearVisibleOutputStallTimer(threadId: string) {
  const timer = visibleOutputStallTimerByThread.get(threadId);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  visibleOutputStallTimerByThread.delete(threadId);
}

function isClaudeWindowsStream(
  snapshot: Pick<ThreadStreamLatencySnapshot, "engine" | "platform">,
) {
  return snapshot.engine === "claude" && snapshot.platform === "windows";
}

function isClaudeStream(
  snapshot: Pick<ThreadStreamLatencySnapshot, "engine">,
) {
  return snapshot.engine === "claude";
}

function isCodexStream(
  snapshot: Pick<ThreadStreamLatencySnapshot, "engine">,
) {
  return snapshot.engine === "codex";
}

function isVisibleTextDiagnosticsStream(
  snapshot: Pick<ThreadStreamLatencySnapshot, "engine">,
) {
  return (
    snapshot.engine === "claude" ||
    snapshot.engine === "codex" ||
    snapshot.engine === "gemini" ||
    snapshot.engine === "grok" ||
    snapshot.engine === "kimi" ||
    snapshot.engine === "opencode"
  );
}

export function matchesQwenCompatibleClaudeWindowsFingerprint(
  snapshot: Pick<
    ThreadStreamLatencySnapshot,
    "engine" | "platform" | "providerId" | "providerName" | "baseUrl" | "model"
  >,
) {
  if (snapshot.engine !== "claude" || snapshot.platform !== "windows") {
    return false;
  }
  const providerId = normalizeNullableString(snapshot.providerId)?.toLowerCase() ?? "";
  const providerName = normalizeNullableString(snapshot.providerName)?.toLowerCase() ?? "";
  const baseUrl = normalizeNullableString(snapshot.baseUrl)?.toLowerCase() ?? "";
  const model = normalizeNullableString(snapshot.model)?.toLowerCase() ?? "";
  return (
    providerId === "qwen" ||
    providerName.includes("qwen") ||
    baseUrl.includes("dashscope.aliyuncs.com/apps/anthropic") ||
    model.includes("qwen")
  );
}

function resolveClaudeWindowsMitigationProfileId(
  snapshot: ThreadStreamLatencySnapshot,
): StreamMitigationProfileId | null {
  if (!isClaudeWindowsStream(snapshot)) {
    return null;
  }
  return matchesQwenCompatibleClaudeWindowsFingerprint(snapshot)
    ? "claude-qwen-windows-render-safe"
    : "claude-windows-visible-stream";
}

function resolveClaudeVisibleStallMitigationProfileId(
  snapshot: ThreadStreamLatencySnapshot,
): StreamMitigationProfileId | null {
  if (!isClaudeStream(snapshot)) {
    return null;
  }
  return resolveClaudeWindowsMitigationProfileId(snapshot)
    ?? "claude-markdown-stream-recovery";
}

function resolveEngineVisibleStallMitigationProfileId(
  snapshot: ThreadStreamLatencySnapshot,
): StreamMitigationProfileId | null {
  if (isClaudeStream(snapshot)) {
    return resolveClaudeVisibleStallMitigationProfileId(snapshot);
  }
  if (isCodexStream(snapshot)) {
    return "codex-markdown-stream-recovery";
  }
  return null;
}

function activateMitigationProfile(
  snapshot: ThreadStreamLatencySnapshot,
  profileId: StreamMitigationProfileId,
  reason: string,
  extra: Record<string, unknown> = {},
) {
  if (snapshot.mitigationProfile) {
    return snapshot;
  }
  const nextSnapshot: ThreadStreamLatencySnapshot = {
    ...snapshot,
    mitigationProfile: profileId,
    mitigationReason: reason,
  };
  appendRendererDiagnostic(
    "stream-latency/mitigation-activated",
    buildCorrelationPayload(nextSnapshot, {
      activationReason: reason,
      mitigationSuppressed: isStreamMitigationDisabled() ? "disabled-flag" : null,
      ...extra,
    }),
  );
  return nextSnapshot;
}

function maybeActivateClaudeWindowsMitigation(
  snapshot: ThreadStreamLatencySnapshot,
  reason: string,
  extra: Record<string, unknown> = {},
) {
  const profileId = resolveClaudeWindowsMitigationProfileId(snapshot);
  if (!profileId) {
    return snapshot;
  }
  return activateMitigationProfile(snapshot, profileId, reason, extra);
}

function maybeActivateEngineVisibleStallMitigation(
  snapshot: ThreadStreamLatencySnapshot,
  reason: string,
  extra: Record<string, unknown> = {},
) {
  const profileId = resolveEngineVisibleStallMitigationProfileId(snapshot);
  if (!profileId) {
    return snapshot;
  }
  return activateMitigationProfile(snapshot, profileId, reason, extra);
}

function primeClaudeWindowsVisibleStreamCandidate(
  snapshot: ThreadStreamLatencySnapshot,
  reason: string,
) {
  if (!isClaudeWindowsStream(snapshot) || snapshot.firstDeltaAt === null) {
    return snapshot;
  }
  const candidateProfile = resolveClaudeWindowsMitigationProfileId(snapshot);
  if (!candidateProfile || snapshot.candidateMitigationProfile === candidateProfile) {
    return snapshot;
  }
  const nextSnapshot: ThreadStreamLatencySnapshot = {
    ...snapshot,
    candidateMitigationProfile: candidateProfile,
    candidateMitigationReason: reason,
  };
  appendRendererDiagnostic(
    "stream-latency/mitigation-candidate-selected",
    buildCorrelationPayload(nextSnapshot, {
      candidateReason: reason,
    }),
  );
  return nextSnapshot;
}

export function getThreadStreamLatencySnapshot(threadId: string | null) {
  if (!threadId) {
    return null;
  }
  return snapshotByThread.get(threadId) ?? null;
}

function buildCorrelationPayload(
  snapshot: ThreadStreamLatencySnapshot,
  extra: Record<string, unknown> = {},
) {
  const cadenceSummary = summarizeCadence(snapshot.cadenceSamplesMs);
  return {
    workspaceId: snapshot.workspaceId,
    threadId: snapshot.threadId,
    turnId: snapshot.turnId,
    engine: snapshot.engine,
    providerId: snapshot.providerId,
    providerName: snapshot.providerName,
    baseUrl: snapshot.baseUrl,
    model: snapshot.model,
    platform: snapshot.platform,
    firstDeltaAtMs:
      snapshot.startedAt !== null && snapshot.firstDeltaAt !== null
        ? Math.max(0, snapshot.firstDeltaAt - snapshot.startedAt)
        : null,
    firstVisibleRenderAtMs:
      snapshot.startedAt !== null && snapshot.firstVisibleRenderAt !== null
        ? Math.max(0, snapshot.firstVisibleRenderAt - snapshot.startedAt)
        : null,
    firstVisibleRenderAfterDeltaMs: snapshot.firstVisibleRenderAfterDeltaMs,
    firstVisibleTextRenderAtMs:
      snapshot.startedAt !== null && snapshot.firstVisibleTextRenderAt !== null
        ? Math.max(0, snapshot.firstVisibleTextRenderAt - snapshot.startedAt)
        : null,
    firstVisibleTextAfterDeltaMs: snapshot.firstVisibleTextAfterDeltaMs,
    lastNonEmptyVisibleRenderAtMs:
      snapshot.startedAt !== null && snapshot.lastNonEmptyVisibleRenderAt !== null
        ? Math.max(0, snapshot.lastNonEmptyVisibleRenderAt - snapshot.startedAt)
        : null,
    lastNonEmptyVisibleItemCount: snapshot.lastNonEmptyVisibleItemCount,
    lastVisibleTextRenderAtMs:
      snapshot.startedAt !== null && snapshot.lastVisibleTextRenderAt !== null
        ? Math.max(0, snapshot.lastVisibleTextRenderAt - snapshot.startedAt)
        : null,
    lastVisibleTextAfterDeltaMs: snapshot.lastVisibleTextAfterDeltaMs,
    lastVisibleTextItemId: snapshot.lastVisibleTextItemId,
    lastVisibleTextLength: snapshot.lastVisibleTextLength,
    visibleTextGrowthCount: snapshot.visibleTextGrowthCount,
    lastIngressAtMs:
      snapshot.startedAt !== null && snapshot.lastIngressAt !== null
        ? Math.max(0, snapshot.lastIngressAt - snapshot.startedAt)
        : null,
    lastIngressGapMs: snapshot.lastIngressGapMs,
    lastIngressSource: snapshot.lastIngressSource,
    lastIngressItemId: snapshot.lastIngressItemId,
    lastIngressTextLength: snapshot.lastIngressTextLength,
    lastReducerMergeCostMs: snapshot.lastReducerMergeCostMs,
    lastNormalizationCostMs: snapshot.lastNormalizationCostMs,
    lastRenderCostMs: snapshot.lastRenderCostMs,
    lastRecoverySource: snapshot.lastRecoverySource,
    lastRecoverySourceId: snapshot.lastRecoverySourceId,
    pendingVisibleTextSinceDeltaAtMs:
      snapshot.startedAt !== null && snapshot.pendingVisibleTextSinceDeltaAt !== null
        ? Math.max(0, snapshot.pendingVisibleTextSinceDeltaAt - snapshot.startedAt)
        : null,
    lastRenderLagMs: snapshot.lastRenderLagMs,
    deltaCount: snapshot.deltaCount,
    latencyCategory: snapshot.latencyCategory,
    candidateMitigationProfile: snapshot.candidateMitigationProfile,
    candidateMitigationReason: snapshot.candidateMitigationReason,
    mitigationProfile: snapshot.mitigationProfile,
    mitigationReason: snapshot.mitigationReason,
    activeMitigationProfile:
      snapshot.mitigationProfile ?? snapshot.candidateMitigationProfile,
    mitigationSuppressed:
      (snapshot.mitigationProfile ?? snapshot.candidateMitigationProfile) &&
      isStreamMitigationDisabled()
        ? "disabled-flag"
        : null,
    ...cadenceSummary,
    ...extra,
  };
}

function nonNegativeGapMs(later: number, earlier: number | null) {
  return earlier === null ? null : Math.max(0, later - earlier);
}

function normalizeTimestampMs(value: unknown) {
  return normalizeNonNegativeFiniteNumber(value) ?? Date.now();
}

function resolveClaudeFirstTokenLatencyCategory(input: {
  firstStdoutLineAtMs: number | null;
  firstValidStreamEventAtMs: number | null;
  firstTextDeltaAtMs: number | null;
}): StreamLatencyCategory | null {
  if (input.firstTextDeltaAtMs !== null) {
    return null;
  }
  if (input.firstValidStreamEventAtMs !== null) {
    return "claude-valid-event-without-text";
  }
  if (input.firstStdoutLineAtMs !== null) {
    return "claude-stdout-without-valid-event";
  }
  return "claude-first-token-latency";
}

function extractThreadIdFromAppServerParams(params: Record<string, unknown>) {
  return normalizeNullableString(
    normalizeString(params.threadId) ||
      normalizeString(params.thread_id) ||
      normalizeString(asRecord(params.turn)?.threadId) ||
      normalizeString(asRecord(params.turn)?.thread_id),
  );
}

function extractItemIdFromAppServerParams(params: Record<string, unknown>) {
  const item = asRecord(params.item);
  return normalizeNullableString(
    normalizeString(params.itemId) ||
      normalizeString(params.item_id) ||
      normalizeString(item?.id),
  );
}

export function noteThreadAppServerEventReceived(input: {
  workspaceId: string;
  method: string;
  params: unknown;
  receivedAt?: unknown;
}) {
  if (!isStreamLatencyTraceEnabled()) {
    return;
  }
  const params = asRecord(input.params);
  if (!params) {
    return;
  }
  const timing = asRecord(params.dogeTiming) ?? asRecord(params.ccguiTiming);
  if (!timing) {
    return;
  }
  const traceSource = normalizeString(timing.source) || "unknown";
  const threadId = extractThreadIdFromAppServerParams(params);
  if (!threadId) {
    return;
  }
  const receivedAt = normalizeTimestampMs(input.receivedAt);
  const stdoutReceivedAtMs = normalizeNonNegativeFiniteNumber(timing.stdoutReceivedAtMs);
  const processSpawnStartedAtMs = normalizeNonNegativeFiniteNumber(
    timing.processSpawnStartedAtMs,
  );
  const processSpawnedAtMs = normalizeNonNegativeFiniteNumber(timing.processSpawnedAtMs);
  const stdinWriteStartedAtMs = normalizeNonNegativeFiniteNumber(
    timing.stdinWriteStartedAtMs,
  );
  const stdinClosedAtMs = normalizeNonNegativeFiniteNumber(timing.stdinClosedAtMs);
  const turnStartedAtMs = normalizeNonNegativeFiniteNumber(timing.turnStartedAtMs);
  const firstStdoutLineAtMs = normalizeNonNegativeFiniteNumber(timing.firstStdoutLineAtMs);
  const firstValidStreamEventAtMs = normalizeNonNegativeFiniteNumber(
    timing.firstValidStreamEventAtMs,
  );
  const firstTextDeltaAtMs = normalizeNonNegativeFiniteNumber(timing.firstTextDeltaAtMs);
  const sessionEmittedAtMs = normalizeNonNegativeFiniteNumber(timing.sessionEmittedAtMs);
  const forwarderReceivedAtMs = normalizeNonNegativeFiniteNumber(timing.forwarderReceivedAtMs);
  const appServerEmittedAtMs = normalizeNonNegativeFiniteNumber(timing.appServerEmittedAtMs);
  const turnStartRequestStartedAtMs = normalizeNonNegativeFiniteNumber(
    timing.turnStartRequestStartedAtMs,
  );
  const turnStartResponseReceivedAtMs = normalizeNonNegativeFiniteNumber(
    timing.turnStartResponseReceivedAtMs,
  );
  const firstRuntimeEventReceivedAtMs = normalizeNonNegativeFiniteNumber(
    timing.firstRuntimeEventReceivedAtMs,
  );
  const firstStreamEventReceivedAtMs = normalizeNonNegativeFiniteNumber(
    timing.firstStreamEventReceivedAtMs,
  );
  const firstReasoningEventReceivedAtMs = normalizeNonNegativeFiniteNumber(
    timing.firstReasoningEventReceivedAtMs,
  );
  const firstAssistantItemEventReceivedAtMs = normalizeNonNegativeFiniteNumber(
    timing.firstAssistantItemEventReceivedAtMs,
  );
  const firstAgentMessageEventReceivedAtMs = normalizeNonNegativeFiniteNumber(
    timing.firstAgentMessageEventReceivedAtMs,
  );
  const firstToolEventReceivedAtMs = normalizeNonNegativeFiniteNumber(
    timing.firstToolEventReceivedAtMs,
  );
  const firstTextDeltaReceivedAtMs = normalizeNonNegativeFiniteNumber(
    timing.firstTextDeltaReceivedAtMs,
  );
  const firstRuntimeEventMethod = normalizeNullableString(
    normalizeString(timing.firstRuntimeEventMethod),
  );
  const firstStreamEventMethod = normalizeNullableString(
    normalizeString(timing.firstStreamEventMethod),
  );
  const firstReasoningEventMethod = normalizeNullableString(
    normalizeString(timing.firstReasoningEventMethod),
  );
  const firstAssistantItemEventMethod = normalizeNullableString(
    normalizeString(timing.firstAssistantItemEventMethod),
  );
  const firstAgentMessageEventMethod = normalizeNullableString(
    normalizeString(timing.firstAgentMessageEventMethod),
  );
  const firstToolEventMethod = normalizeNullableString(
    normalizeString(timing.firstToolEventMethod),
  );
  const firstTextDeltaMethod = normalizeNullableString(
    normalizeString(timing.firstTextDeltaMethod),
  );
  const snapshot =
    snapshotByThread.get(threadId) ?? {
      ...createInitialSnapshot(threadId),
      workspaceId: input.workspaceId,
      platform: resolvePlatform(),
    };
  appendRendererDiagnostic(
    "stream-latency/app-server-event",
    buildCorrelationPayload(snapshot, {
      method: input.method,
      itemId: extractItemIdFromAppServerParams(params),
      deltaLength: normalizeString(params.delta).length,
      traceSource,
      stdoutReceivedAtMs,
      processSpawnStartedAtMs,
      processSpawnedAtMs,
      stdinWriteStartedAtMs,
      stdinClosedAtMs,
      turnStartedAtMs,
      firstStdoutLineAtMs,
      firstValidStreamEventAtMs,
      firstTextDeltaAtMs,
      sessionEmittedAtMs,
      forwarderReceivedAtMs,
      appServerEmittedAtMs,
      turnStartRequestStartedAtMs,
      turnStartResponseReceivedAtMs,
      firstRuntimeEventReceivedAtMs,
      firstStreamEventReceivedAtMs,
      firstReasoningEventReceivedAtMs,
      firstAssistantItemEventReceivedAtMs,
      firstAgentMessageEventReceivedAtMs,
      firstToolEventReceivedAtMs,
      firstTextDeltaReceivedAtMs,
      firstRuntimeEventMethod,
      firstStreamEventMethod,
      firstReasoningEventMethod,
      firstAssistantItemEventMethod,
      firstAgentMessageEventMethod,
      firstToolEventMethod,
      firstTextDeltaMethod,
      eventCountBeforeFirstTextDelta: normalizeNonNegativeFiniteNumber(
        timing.eventCountBeforeFirstTextDelta,
      ),
      reasoningEventCountBeforeFirstTextDelta: normalizeNonNegativeFiniteNumber(
        timing.reasoningEventCountBeforeFirstTextDelta,
      ),
      toolEventCountBeforeFirstTextDelta: normalizeNonNegativeFiniteNumber(
        timing.toolEventCountBeforeFirstTextDelta,
      ),
      methodsBeforeFirstTextDelta: normalizeStringArray(timing.methodsBeforeFirstTextDelta),
      rendererReceivedAtMs: receivedAt,
      spawnToStdinClosedMs: normalizeNonNegativeFiniteNumber(timing.spawnToStdinClosedMs),
      stdinClosedToFirstStdoutMs: normalizeNonNegativeFiniteNumber(
        timing.stdinClosedToFirstStdoutMs,
      ),
      firstStdoutToFirstValidEventMs: normalizeNonNegativeFiniteNumber(
        timing.firstStdoutToFirstValidEventMs,
      ),
      firstValidEventToFirstTextDeltaMs: normalizeNonNegativeFiniteNumber(
        timing.firstValidEventToFirstTextDeltaMs,
      ),
      stdinClosedToFirstTextDeltaMs: normalizeNonNegativeFiniteNumber(
        timing.stdinClosedToFirstTextDeltaMs,
      ),
      stdoutToSessionEmitMs: normalizeNonNegativeFiniteNumber(timing.stdoutToSessionEmitMs),
      sessionEmitToForwarderMs: normalizeNonNegativeFiniteNumber(
        timing.sessionEmitToForwarderMs,
      ),
      forwarderToAppServerEmitMs: normalizeNonNegativeFiniteNumber(
        timing.forwarderToAppServerEmitMs,
      ),
      stdoutToAppServerEmitMs: normalizeNonNegativeFiniteNumber(
        timing.stdoutToAppServerEmitMs,
      ),
      turnStartRequestToResponseMs: normalizeNonNegativeFiniteNumber(
        timing.turnStartRequestToResponseMs,
      ),
      turnStartResponseToFirstStreamEventMs: normalizeNonNegativeFiniteNumber(
        timing.turnStartResponseToFirstStreamEventMs,
      ),
      turnStartResponseToFirstRuntimeEventMs: normalizeNonNegativeFiniteNumber(
        timing.turnStartResponseToFirstRuntimeEventMs,
      ),
      turnStartResponseToFirstTextDeltaMs: normalizeNonNegativeFiniteNumber(
        timing.turnStartResponseToFirstTextDeltaMs,
      ),
      firstRuntimeEventToFirstTextDeltaMs: normalizeNonNegativeFiniteNumber(
        timing.firstRuntimeEventToFirstTextDeltaMs,
      ),
      firstRuntimeEventToFirstAssistantItemEventMs: normalizeNonNegativeFiniteNumber(
        timing.firstRuntimeEventToFirstAssistantItemEventMs,
      ),
      firstAssistantItemEventToFirstTextDeltaMs: normalizeNonNegativeFiniteNumber(
        timing.firstAssistantItemEventToFirstTextDeltaMs,
      ),
      turnStartResponseToThisEventMs: normalizeNonNegativeFiniteNumber(
        timing.turnStartResponseToThisEventMs,
      ),
      appServerEmitToRendererMs: nonNegativeGapMs(receivedAt, appServerEmittedAtMs),
      stdoutToRendererMs: nonNegativeGapMs(receivedAt, stdoutReceivedAtMs),
      turnStartResponseToRendererMs: nonNegativeGapMs(
        receivedAt,
        turnStartResponseReceivedAtMs,
      ),
    }),
  );

  const firstTokenCategory = resolveClaudeFirstTokenLatencyCategory({
    firstStdoutLineAtMs,
    firstValidStreamEventAtMs,
    firstTextDeltaAtMs,
  });
  if (normalizeString(timing.source) !== "claude-stream" || firstTokenCategory === null) {
    return;
  }
  updateThreadSnapshot(threadId, (current) => {
    const nextSnapshot: ThreadStreamLatencySnapshot = {
      ...current,
      workspaceId: current.workspaceId ?? input.workspaceId,
      platform: current.platform === "unknown" ? resolvePlatform() : current.platform,
      latencyCategory: current.latencyCategory ?? firstTokenCategory,
      firstTokenLatencyReported: true,
    };
    if (!current.firstTokenLatencyReported) {
      appendRendererDiagnostic(
        "stream-latency/claude-first-token-phase",
        buildCorrelationPayload(nextSnapshot, {
          method: input.method,
          itemId: extractItemIdFromAppServerParams(params),
          latencyCategory: firstTokenCategory,
          processSpawnStartedAtMs,
          processSpawnedAtMs,
          stdinClosedAtMs,
          firstStdoutLineAtMs,
          firstValidStreamEventAtMs,
          firstTextDeltaAtMs,
          spawnToStdinClosedMs: normalizeNonNegativeFiniteNumber(timing.spawnToStdinClosedMs),
          stdinClosedToFirstStdoutMs: normalizeNonNegativeFiniteNumber(
            timing.stdinClosedToFirstStdoutMs,
          ),
          firstStdoutToFirstValidEventMs: normalizeNonNegativeFiniteNumber(
            timing.firstStdoutToFirstValidEventMs,
          ),
          firstValidEventToFirstTextDeltaMs: normalizeNonNegativeFiniteNumber(
            timing.firstValidEventToFirstTextDeltaMs,
          ),
        }),
      );
    }
    return nextSnapshot;
  });
}

export function buildThreadStreamCorrelationDimensions(threadId: string | null) {
  const snapshot = getThreadStreamLatencySnapshot(threadId);
  if (!snapshot) {
    return {
      engine: null,
      providerId: null,
      providerName: null,
      baseUrl: null,
      model: null,
      platform: resolvePlatform(),
      firstVisibleRenderAtMs: null,
      firstVisibleRenderAfterDeltaMs: null,
      firstVisibleTextRenderAtMs: null,
      firstVisibleTextAfterDeltaMs: null,
      lastVisibleTextRenderAtMs: null,
      lastVisibleTextAfterDeltaMs: null,
      lastVisibleTextItemId: null,
      lastVisibleTextLength: 0,
      visibleTextGrowthCount: 0,
      lastIngressAtMs: null,
      lastIngressGapMs: null,
      lastIngressSource: null,
      lastIngressItemId: null,
      lastIngressTextLength: 0,
      lastReducerMergeCostMs: null,
      lastNormalizationCostMs: null,
      lastRenderCostMs: null,
      lastRecoverySource: null,
      lastRecoverySourceId: null,
      pendingVisibleTextSinceDeltaAtMs: null,
      lastRenderLagMs: null,
      chunkCadenceAvgMs: null,
      chunkCadenceMaxMs: null,
      latencyCategory: null,
      candidateMitigationProfile: null,
      candidateMitigationReason: null,
      mitigationProfile: null,
      mitigationReason: null,
      activeMitigationProfile: null,
      mitigationSuppressed: null,
    };
  }
  const {
    workspaceId: _workspaceId,
    threadId: _threadId,
    turnId: _turnId,
    deltaCount: _deltaCount,
    ...dimensions
  } = buildCorrelationPayload(snapshot);
  return dimensions;
}

export async function primeThreadStreamLatencyContext(input: {
  workspaceId: string;
  threadId: string;
  engine: ConversationEngine;
  model?: string | null;
}) {
  const requestId = (latestProviderConfigRequestByThread.get(input.threadId) ?? 0) + 1;
  latestProviderConfigRequestByThread.set(input.threadId, requestId);
  const normalizedModel = normalizeNullableString(input.model);
  const primedSnapshot = updateThreadSnapshot(input.threadId, (current) => ({
    ...current,
    workspaceId: input.workspaceId,
    engine: input.engine,
    model: normalizedModel,
    platform: resolvePlatform(),
    providerId: null,
    providerName: null,
    baseUrl: null,
  }));
  if (primedSnapshot.firstDeltaAt !== null) {
    updateThreadSnapshot(input.threadId, (current) =>
      primeClaudeWindowsVisibleStreamCandidate(
        current,
        "first-delta-visible-stream-candidate",
      ),
    );
  }
  if (input.engine !== "claude") {
    return;
  }
  try {
    const config = await getCurrentClaudeConfig();
    if (latestProviderConfigRequestByThread.get(input.threadId) !== requestId) {
      return;
    }
    updateThreadSnapshot(input.threadId, (current) => {
      const nextSnapshot = {
        ...current,
        providerId: normalizeNullableString(config.providerId),
        providerName: normalizeNullableString(config.providerName),
        baseUrl: normalizeNullableString(config.baseUrl),
      };
      if (nextSnapshot.firstDeltaAt === null) {
        return nextSnapshot;
      }
      return primeClaudeWindowsVisibleStreamCandidate(
        nextSnapshot,
        "first-delta-visible-stream-candidate",
      );
    });
  } catch {
    // Provider fingerprint is best effort. Diagnostics can still rely on model + platform.
  }
}

export function noteThreadTurnStarted(input: {
  workspaceId: string;
  threadId: string;
  turnId: string;
  startedAt?: number;
}) {
  const startedAt = input.startedAt ?? Date.now();
  clearVisibleOutputStallTimer(input.threadId);
  const priorForTrace = snapshotByThread.get(input.threadId);
  const traceDimensions: TurnTraceDimensions = {
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    turnId: input.turnId,
    engine: priorForTrace?.engine ?? null,
    providerId: priorForTrace?.providerId ?? null,
    providerName: priorForTrace?.providerName ?? null,
    baseUrl: priorForTrace?.baseUrl ?? null,
    model: priorForTrace?.model ?? null,
    platform: priorForTrace?.platform ?? "unknown",
  };
  noteTurnSendCommitted(traceDimensions, startedAt);
  noteTurnRuntimeProcessStarted(traceDimensions, startedAt);
  updateThreadSnapshot(input.threadId, (current) => ({
    ...current,
    workspaceId: input.workspaceId,
    turnId: input.turnId,
    startedAt,
    firstDeltaAt: null,
    lastDeltaAt: null,
    lastIngressAt: null,
    lastIngressGapMs: null,
    lastIngressSource: null,
    lastIngressItemId: null,
    lastIngressTextLength: 0,
    lastReducerMergeCostMs: null,
    lastNormalizationCostMs: null,
    lastRenderCostMs: null,
    lastRecoverySource: null,
    lastRecoverySourceId: null,
    pendingRenderSinceDeltaAt: null,
    deltaCount: 0,
    cadenceSamplesMs: [],
    firstVisibleRenderAt: null,
    firstVisibleRenderAfterDeltaMs: null,
    firstVisibleTextRenderAt: null,
    firstVisibleTextAfterDeltaMs: null,
    lastNonEmptyVisibleRenderAt: null,
    lastNonEmptyVisibleItemCount: 0,
    lastVisibleTextRenderAt: null,
    lastVisibleTextAfterDeltaMs: null,
    lastVisibleTextItemId: null,
    lastVisibleTextLength: 0,
    visibleTextGrowthCount: 0,
    pendingVisibleTextSinceDeltaAt: null,
    lastRenderLagMs: null,
    latencyCategory: null,
    candidateMitigationProfile: null,
    candidateMitigationReason: null,
    mitigationProfile: null,
    mitigationReason: null,
    upstreamPendingReported: false,
    firstTokenLatencyReported: false,
    renderAmplificationReported: false,
    visibleOutputStallReported: false,
    repeatTurnBlankingReported: false,
  }));
}

export function noteThreadDeltaReceived(
  threadId: string,
  timestamp = Date.now(),
  ingress?: {
    source: Exclude<StreamIngressSource, "completion">;
    itemId: string;
    textLength: number;
  },
) {
  const beforeSnapshot = snapshotByThread.get(threadId);
  const wasFirstDeltaPending = beforeSnapshot?.firstDeltaAt === null
    || beforeSnapshot?.firstDeltaAt === undefined;
  const nextSnapshot = updateThreadSnapshot(threadId, (current) => {
    const cadenceSamplesMs =
      current.lastDeltaAt === null
        ? current.cadenceSamplesMs
        : appendCadenceSample(current.cadenceSamplesMs, timestamp - current.lastDeltaAt);
    const snapshotWithDelta: ThreadStreamLatencySnapshot = {
      ...current,
      firstDeltaAt: current.firstDeltaAt ?? timestamp,
      lastDeltaAt: timestamp,
      pendingRenderSinceDeltaAt: current.pendingRenderSinceDeltaAt ?? timestamp,
      pendingVisibleTextSinceDeltaAt: current.pendingVisibleTextSinceDeltaAt ?? timestamp,
      deltaCount: current.deltaCount + 1,
      cadenceSamplesMs,
    };
    return primeClaudeWindowsVisibleStreamCandidate(
      ingress
        ? applyThreadTextIngress(snapshotWithDelta, timestamp, ingress)
        : snapshotWithDelta,
      "first-delta-visible-stream-candidate",
    );
  });
  maybeEmitCodexIngressDiagnostic(nextSnapshot, ingress);
  scheduleVisibleOutputStallTimer(threadId, nextSnapshot);
  if (isTurnTraceEnabled()) {
    const dimensions = buildTraceDimensionsFromSnapshot(nextSnapshot);
    if (dimensions) {
      const cadenceSampleMs = beforeSnapshot?.lastDeltaAt !== null
        && beforeSnapshot?.lastDeltaAt !== undefined
        ? Math.max(0, timestamp - beforeSnapshot.lastDeltaAt)
        : undefined;
      if (wasFirstDeltaPending) {
        noteTurnFirstEngineDeltaIngress(dimensions, timestamp);
      } else {
        noteTurnDeltaIngress(dimensions, timestamp);
      }
      noteTurnReducerCommit({
        dimensions,
        atMs: timestamp,
        isAssistantDelta: ingress?.source !== "snapshot" && ingress?.itemId !== undefined,
        isReasoningDelta: false,
        isToolDelta: false,
        cadenceSampleMs,
      });
    }
  }
}

function applyThreadTextIngress(
  snapshot: ThreadStreamLatencySnapshot,
  timestamp: number,
  ingress: {
    source: StreamIngressSource;
    itemId: string;
    textLength: number;
  },
): ThreadStreamLatencySnapshot {
  const lastIngressGapMs =
    snapshot.lastIngressAt === null
      ? null
      : Math.max(0, timestamp - snapshot.lastIngressAt);
  return {
    ...snapshot,
    lastIngressAt: timestamp,
    lastIngressGapMs,
    lastIngressSource: ingress.source,
    lastIngressItemId: ingress.itemId,
    lastIngressTextLength: normalizeVisibleTextLength(ingress.textLength),
  };
}

function maybeEmitCodexIngressDiagnostic(
  snapshot: ThreadStreamLatencySnapshot,
  ingress?: {
    source: StreamIngressSource;
    itemId: string;
    textLength: number;
  },
) {
  if (!ingress || !isCodexStream(snapshot)) {
    return;
  }
  const textLength = normalizeVisibleTextLength(ingress.textLength);
  const shouldEmit =
    ingress.source === "completion" ||
    textLength >= LARGE_INGRESS_TEXT_DIAGNOSTIC_CHARS ||
    (
      snapshot.lastIngressGapMs !== null &&
      snapshot.lastIngressGapMs >= CODEX_INGRESS_GAP_DIAGNOSTIC_MS
    );
  if (!shouldEmit) {
    return;
  }
  appendRendererDiagnostic(
    "stream-latency/codex-text-ingress",
    buildCorrelationPayload(snapshot, {
      ingressSource: ingress.source,
      itemId: ingress.itemId,
      textLength,
    }),
  );
}

export function noteThreadTextIngressReceived(
  threadId: string,
  input: {
    source: StreamIngressSource;
    itemId: string;
    textLength: number;
    timestamp?: number;
  },
) {
  const timestamp = input.timestamp ?? Date.now();
  let shouldEmitCodexIngressDiagnostic = false;
  const nextSnapshot = updateThreadSnapshot(threadId, (current) => {
    if (
      input.source === "completion" &&
      current.lastIngressSource === "completion" &&
      current.lastIngressItemId === input.itemId &&
      current.lastIngressTextLength === normalizeVisibleTextLength(input.textLength)
    ) {
      return current;
    }
    const nextSnapshot = applyThreadTextIngress(current, timestamp, input);
    shouldEmitCodexIngressDiagnostic = (
      isCodexStream(nextSnapshot) &&
      (
        input.source === "completion" ||
        nextSnapshot.lastIngressTextLength >= LARGE_INGRESS_TEXT_DIAGNOSTIC_CHARS ||
        (
          nextSnapshot.lastIngressGapMs !== null &&
          nextSnapshot.lastIngressGapMs >= CODEX_INGRESS_GAP_DIAGNOSTIC_MS
        )
      )
    );
    return nextSnapshot;
  });
  if (shouldEmitCodexIngressDiagnostic) {
    appendRendererDiagnostic(
      "stream-latency/codex-text-ingress",
      buildCorrelationPayload(nextSnapshot, {
        ingressSource: input.source,
        itemId: input.itemId,
        textLength: normalizeVisibleTextLength(input.textLength),
      }),
    );
  }
}

function maybeActivateMitigation(
  snapshot: ThreadStreamLatencySnapshot,
  renderLagMs: number,
  visibleItemCount: number,
) {
  const { renderAmplificationMs } = getStreamLatencyThresholds();
  if (snapshot.mitigationProfile || renderLagMs < renderAmplificationMs) {
    return snapshot;
  }
  return maybeActivateClaudeWindowsMitigation(
    snapshot,
    "render-lag-after-first-delta",
    {
      renderLagMs,
      visibleItemCount,
    },
  );
}

export function noteThreadReducerWorkMeasured(
  threadId: string,
  input: {
    itemId: string;
    textLength: number;
    mergeCostMs: number;
    normalizationCostMs: number;
    measuredAt?: number;
  },
) {
  const measuredAt = input.measuredAt ?? Date.now();
  const textLength = normalizeVisibleTextLength(input.textLength);
  const mergeCostMs = normalizeNonNegativeFiniteNumber(input.mergeCostMs) ?? 0;
  const normalizationCostMs =
    normalizeNonNegativeFiniteNumber(input.normalizationCostMs) ?? 0;
  const nextSnapshot = updateThreadSnapshot(threadId, (current) => ({
    ...current,
    lastReducerMergeCostMs: mergeCostMs,
    lastNormalizationCostMs: normalizationCostMs,
  }));
  if (textLength < LONG_LIVE_ROW_DIAGNOSTIC_CHARS && !isStreamLatencyTraceEnabled()) {
    return;
  }
  appendRendererDiagnostic(
    "stream-latency/reducer-work",
    buildCorrelationPayload(nextSnapshot, {
      itemId: input.itemId,
      textLength,
      mergeCostMs,
      normalizationCostMs,
      measuredAtMs:
        nextSnapshot.startedAt !== null
          ? Math.max(0, measuredAt - nextSnapshot.startedAt)
          : null,
    }),
  );
}

export function noteThreadLiveRowRenderMeasured(
  threadId: string,
  input: {
    itemId: string;
    textLength: number;
    renderCostMs: number;
    renderAt?: number;
  },
) {
  const renderAt = input.renderAt ?? Date.now();
  const textLength = normalizeVisibleTextLength(input.textLength);
  const renderCostMs = normalizeNonNegativeFiniteNumber(input.renderCostMs) ?? 0;
  const nextSnapshot = updateThreadSnapshot(threadId, (current) => ({
    ...current,
    lastRenderCostMs: renderCostMs,
  }));
  if (textLength < LONG_LIVE_ROW_DIAGNOSTIC_CHARS && !isStreamLatencyTraceEnabled()) {
    return;
  }
  appendRendererDiagnostic(
    "stream-latency/long-live-row-render",
    buildCorrelationPayload(nextSnapshot, {
      itemId: input.itemId,
      textLength,
      renderCostMs,
      renderAtMs:
        nextSnapshot.startedAt !== null
          ? Math.max(0, renderAt - nextSnapshot.startedAt)
          : null,
    }),
  );
}

export function noteThreadRecoverySourceObserved(
  threadId: string,
  input: {
    source: StreamRecoverySource;
    sourceId?: string | null;
    itemId?: string | null;
    textLength?: number;
    observedAt?: number;
  },
) {
  const observedAt = input.observedAt ?? Date.now();
  const nextSnapshot = updateThreadSnapshot(threadId, (current) => ({
    ...current,
    lastRecoverySource: input.source,
    lastRecoverySourceId: normalizeNullableString(input.sourceId),
  }));
  appendRendererDiagnostic(
    "stream-latency/recovery-source",
    buildCorrelationPayload(nextSnapshot, {
      recoverySource: input.source,
      recoverySourceId: normalizeNullableString(input.sourceId),
      itemId: normalizeNullableString(input.itemId),
      textLength: normalizeVisibleTextLength(input.textLength ?? 0),
      observedAtMs:
        nextSnapshot.startedAt !== null
          ? Math.max(0, observedAt - nextSnapshot.startedAt)
          : null,
    }),
  );
}

export function noteThreadVisibleRender(
  threadId: string,
  input: { visibleItemCount: number; renderAt?: number },
) {
  const renderAt = input.renderAt ?? Date.now();
  updateThreadSnapshot(threadId, (current) => {
    if (current.startedAt === null) {
      return current;
    }

    let nextSnapshot: ThreadStreamLatencySnapshot =
      input.visibleItemCount > 0
        ? {
            ...current,
            lastNonEmptyVisibleRenderAt: renderAt,
            lastNonEmptyVisibleItemCount: input.visibleItemCount,
          }
        : current;

    if (
      isClaudeStream(current) &&
      input.visibleItemCount === 0 &&
      current.firstDeltaAt !== null &&
      current.lastNonEmptyVisibleRenderAt !== null &&
      !current.repeatTurnBlankingReported
    ) {
      const blankingDurationMs = Math.max(
        0,
        renderAt - current.lastNonEmptyVisibleRenderAt,
      );
      nextSnapshot = {
        ...nextSnapshot,
        latencyCategory: "repeat-turn-blanking",
        pendingRenderSinceDeltaAt: null,
        repeatTurnBlankingReported: true,
      };
      nextSnapshot = maybeActivateEngineVisibleStallMitigation(
        nextSnapshot,
        "repeat-turn-blanking",
        {
          blankingDurationMs,
          visibleItemCount: input.visibleItemCount,
          lastNonEmptyVisibleItemCount: current.lastNonEmptyVisibleItemCount,
        },
      );
      appendRendererDiagnostic(
        "stream-latency/repeat-turn-blanking",
        buildCorrelationPayload(nextSnapshot, {
          blankingDurationMs,
          visibleItemCount: input.visibleItemCount,
          lastNonEmptyVisibleItemCount: current.lastNonEmptyVisibleItemCount,
        }),
      );
      return nextSnapshot;
    }

    if (
      current.pendingRenderSinceDeltaAt === null ||
      current.firstDeltaAt === null
    ) {
      return nextSnapshot;
    }
    const renderLagMs = Math.max(0, renderAt - current.pendingRenderSinceDeltaAt);
    const isFirstVisibleRender = current.firstVisibleRenderAt === null;
    nextSnapshot = {
      ...nextSnapshot,
      firstVisibleRenderAt: current.firstVisibleRenderAt ?? renderAt,
      firstVisibleRenderAfterDeltaMs:
        current.firstVisibleRenderAfterDeltaMs ?? renderLagMs,
      lastRenderLagMs: renderLagMs,
      pendingRenderSinceDeltaAt: null,
    };
    if (isFirstVisibleRender && isTurnTraceEnabled()) {
      const dimensions = buildTraceDimensionsFromSnapshot(nextSnapshot);
      if (dimensions) {
        noteTurnFirstVisibleRowRender(dimensions, renderAt);
      }
    }

    if (current.firstVisibleRenderAt === null) {
      const { firstVisibleLatencyMs, renderAmplificationMs } =
        getStreamLatencyThresholds();
      appendRendererDiagnostic(
        "stream-latency/first-visible-render",
        buildCorrelationPayload(nextSnapshot, {
          renderLagMs,
          visibleItemCount: input.visibleItemCount,
          firstVisibleLatencyThresholdMs: firstVisibleLatencyMs,
        }),
      );
      if (
        input.visibleItemCount > 0 &&
        renderLagMs >= firstVisibleLatencyMs &&
        renderLagMs < renderAmplificationMs &&
        isClaudeWindowsStream(nextSnapshot)
      ) {
        appendRendererDiagnostic(
          "stream-latency/first-visible-latency",
          buildCorrelationPayload(nextSnapshot, {
            renderLagMs,
            visibleItemCount: input.visibleItemCount,
            firstVisibleLatencyThresholdMs: firstVisibleLatencyMs,
            renderAmplificationThresholdMs: renderAmplificationMs,
          }),
        );
      }
    }

    if (
      renderLagMs >= getStreamLatencyThresholds().renderAmplificationMs &&
      !current.renderAmplificationReported
    ) {
      nextSnapshot = {
        ...nextSnapshot,
        latencyCategory: "render-amplification",
        renderAmplificationReported: true,
      };
      appendRendererDiagnostic(
        "stream-latency/render-amplification",
        buildCorrelationPayload(nextSnapshot, {
          renderLagMs,
          visibleItemCount: input.visibleItemCount,
          mitigationEligible: resolveClaudeWindowsMitigationProfileId(nextSnapshot) !== null,
          providerMitigationEligible:
            matchesQwenCompatibleClaudeWindowsFingerprint(nextSnapshot),
          mitigationSuppressed: isStreamMitigationDisabled() ? "disabled-flag" : null,
        }),
      );
      nextSnapshot = maybeActivateMitigation(
        nextSnapshot,
        renderLagMs,
        input.visibleItemCount,
      );
    }
    return nextSnapshot;
  });
}

function scheduleVisibleOutputStallTimer(
  threadId: string,
  snapshot: ThreadStreamLatencySnapshot,
) {
  if (
    (!isClaudeStream(snapshot) && !isCodexStream(snapshot)) ||
    snapshot.firstDeltaAt === null ||
    snapshot.pendingVisibleTextSinceDeltaAt === null ||
    snapshot.visibleOutputStallReported ||
    visibleOutputStallTimerByThread.has(threadId)
  ) {
    return;
  }
  const pendingSince = snapshot.pendingVisibleTextSinceDeltaAt;
  const elapsedMs = Math.max(0, (snapshot.lastDeltaAt ?? Date.now()) - pendingSince);
  const { visibleOutputStallMs } = getStreamLatencyThresholds();
  const delayMs = Math.max(0, visibleOutputStallMs - elapsedMs);
  const timer = setTimeout(() => {
    visibleOutputStallTimerByThread.delete(threadId);
    reportThreadVisibleOutputStallAfterFirstDelta(threadId, {
      stallAt: Date.now(),
      reason: "visible-text-not-growing",
    });
  }, delayMs);
  visibleOutputStallTimerByThread.set(threadId, timer);
}

export function noteThreadVisibleTextRendered(
  threadId: string,
  input: { itemId: string; visibleTextLength: number; renderAt?: number },
) {
  const renderAt = input.renderAt ?? Date.now();
  updateThreadSnapshot(threadId, (current) => {
    if (current.startedAt === null || current.firstDeltaAt === null) {
      return current;
    }
    const visibleTextLength = normalizeVisibleTextLength(input.visibleTextLength);
    const previousVisibleTextLength =
      current.lastVisibleTextItemId === input.itemId ? current.lastVisibleTextLength : 0;
    if (visibleTextLength <= previousVisibleTextLength) {
      return {
        ...current,
        lastVisibleTextItemId: input.itemId,
        lastVisibleTextRenderAt: renderAt,
      };
    }
    const visibleTextLagMs =
      current.pendingVisibleTextSinceDeltaAt === null
        ? null
        : Math.max(0, renderAt - current.pendingVisibleTextSinceDeltaAt);
    clearVisibleOutputStallTimer(threadId);
    const nextSnapshotAfterText: ThreadStreamLatencySnapshot = {
      ...current,
      firstVisibleTextRenderAt: current.firstVisibleTextRenderAt ?? renderAt,
      firstVisibleTextAfterDeltaMs:
        current.firstVisibleTextAfterDeltaMs ?? visibleTextLagMs,
      lastVisibleTextRenderAt: renderAt,
      lastVisibleTextAfterDeltaMs: visibleTextLagMs,
      lastVisibleTextItemId: input.itemId,
      lastVisibleTextLength: visibleTextLength,
      visibleTextGrowthCount: current.visibleTextGrowthCount + 1,
      pendingVisibleTextSinceDeltaAt: null,
    };
    if (isTurnTraceEnabled()) {
      const dimensions = buildTraceDimensionsFromSnapshot(nextSnapshotAfterText);
      if (dimensions) {
        noteTurnFirstVisibleTextGrowth(dimensions, {
          atMs: renderAt,
          visibleTextGrowthCount: nextSnapshotAfterText.visibleTextGrowthCount,
        });
      }
    }
    return nextSnapshotAfterText;
  });
}

export function reportThreadVisibleOutputStallAfterFirstDelta(
  threadId: string,
  input: { stallAt?: number; reason?: string } = {},
) {
  const stallAt = input.stallAt ?? Date.now();
  updateThreadSnapshot(threadId, (current) => {
    if (
      !isVisibleTextDiagnosticsStream(current) ||
      current.startedAt === null ||
      current.firstDeltaAt === null ||
      current.pendingVisibleTextSinceDeltaAt === null ||
      current.visibleOutputStallReported
    ) {
      return current;
    }
    const visibleStallMs = Math.max(0, stallAt - current.pendingVisibleTextSinceDeltaAt);
    let nextSnapshot: ThreadStreamLatencySnapshot = {
      ...current,
      latencyCategory: "visible-output-stall-after-first-delta",
      visibleOutputStallReported: true,
    };
    nextSnapshot = maybeActivateEngineVisibleStallMitigation(
      nextSnapshot,
      "visible-output-stall-after-first-delta",
      {
        visibleStallMs,
        reason: input.reason ?? "visible-output-stall-after-first-delta",
      },
    );
    appendRendererDiagnostic(
      "stream-latency/visible-output-stall-after-first-delta",
      buildCorrelationPayload(nextSnapshot, {
        visibleStallMs,
        reason: input.reason ?? "visible-output-stall-after-first-delta",
      }),
    );
    return nextSnapshot;
  });
}

export function reportThreadUpstreamPending(
  threadId: string,
  extra: Record<string, unknown> = {},
) {
  updateThreadSnapshot(threadId, (current) => {
    const nextSnapshot: ThreadStreamLatencySnapshot = current.upstreamPendingReported
      ? current
      : {
          ...current,
          latencyCategory: current.latencyCategory ?? "upstream-pending",
          upstreamPendingReported: true,
        };
    if (!current.upstreamPendingReported) {
      appendRendererDiagnostic(
        "stream-latency/upstream-pending",
        buildCorrelationPayload(nextSnapshot, extra),
      );
    }
    return nextSnapshot;
  });
}

export function completeThreadStreamTurn(threadId: string) {
  clearVisibleOutputStallTimer(threadId);
  const priorSnapshot = snapshotByThread.get(threadId);
  updateThreadSnapshot(threadId, (current) => ({
    ...current,
    turnId: null,
    startedAt: null,
    firstDeltaAt: null,
    lastDeltaAt: null,
    lastIngressAt: null,
    lastIngressGapMs: null,
    lastIngressSource: null,
    lastIngressItemId: null,
    lastIngressTextLength: 0,
    lastReducerMergeCostMs: null,
    lastNormalizationCostMs: null,
    lastRenderCostMs: null,
    lastRecoverySource: null,
    lastRecoverySourceId: null,
    pendingRenderSinceDeltaAt: null,
    deltaCount: 0,
    cadenceSamplesMs: [],
    firstVisibleRenderAt: null,
    firstVisibleRenderAfterDeltaMs: null,
    firstVisibleTextRenderAt: null,
    firstVisibleTextAfterDeltaMs: null,
    lastNonEmptyVisibleRenderAt: null,
    lastNonEmptyVisibleItemCount: 0,
    lastVisibleTextRenderAt: null,
    lastVisibleTextAfterDeltaMs: null,
    lastVisibleTextItemId: null,
    lastVisibleTextLength: 0,
    visibleTextGrowthCount: 0,
    pendingVisibleTextSinceDeltaAt: null,
    lastRenderLagMs: null,
    latencyCategory: null,
    candidateMitigationProfile: null,
    candidateMitigationReason: null,
    mitigationProfile: null,
    mitigationReason: null,
    upstreamPendingReported: false,
    firstTokenLatencyReported: false,
    renderAmplificationReported: false,
    visibleOutputStallReported: false,
    repeatTurnBlankingReported: false,
  }));
  if (isTurnTraceEnabled() && priorSnapshot) {
    const dimensions = buildTraceDimensionsFromSnapshot(priorSnapshot);
    if (dimensions) {
      completeTurnTrace(dimensions, { atMs: Date.now(), reason: "completed" });
    }
  }
}

export function resolveActiveThreadStreamMitigation(
  snapshot: ThreadStreamLatencySnapshot | null,
) {
  const profileId = snapshot?.mitigationProfile ?? snapshot?.candidateMitigationProfile;
  if (!profileId || isStreamMitigationDisabled()) {
    return null;
  }
  return STREAM_MITIGATION_PROFILES[profileId] ?? null;
}

function subscribeToThreadStreamLatencySnapshots(listener: () => void) {
  snapshotListeners.add(listener);
  return () => {
    snapshotListeners.delete(listener);
  };
}

export function useThreadStreamLatencySnapshot(threadId: string | null) {
  return useSyncExternalStore(
    subscribeToThreadStreamLatencySnapshots,
    () => (threadId ? publishedSnapshotByThread.get(threadId) ?? null : null),
    () => null,
  );
}

export function resetThreadStreamLatencyDiagnosticsForTests() {
  visibleOutputStallTimerByThread.forEach((timer) => {
    clearTimeout(timer);
  });
  visibleOutputStallTimerByThread.clear();
  snapshotByThread.clear();
  publishedSnapshotByThread.clear();
  latestProviderConfigRequestByThread.clear();
  streamLatencyTraceEnabledCache = null;
  notifySnapshotListeners();
  // Also clear the per-turn trace correlation aggregator so tests
  // see an empty ring even if the trace gate is on.
  resetTurnTraceCorrelationForTests();
}
const STREAMING_PRESSURE_DIAGNOSTIC_MIN_INTERVAL_MS = 15_000;
let lastStreamingPressureDiagnosticAt = 0;

export function noteRealtimeCoalescedFlush(input: {
  reason: "cadence" | "terminal" | "manual" | "first-token";
  eventCount: number;
  engine: ConversationEngine | null;
  workspaceId: string | null;
  threadId: string;
  turnId: string | null;
  itemKind: string;
  startedAt?: number;
  endedAt?: number;
  routeStartedAt?: number;
  routeEndedAt?: number;
  queueDepthAfter?: number;
}) {
  // endedAt defaults to wall-clock now; callers (the realtime batcher in
  // useThreadItemEvents) should pass it explicitly so the batch-flush window
  // does not drift into the next tick of the calling microtask.
  const now = typeof input.endedAt === "number" && Number.isFinite(input.endedAt)
    ? input.endedAt
    : Date.now();
  if (input.reason === "first-token" || input.eventCount <= 0) {
    return;
  }
  if (now - lastStreamingPressureDiagnosticAt < STREAMING_PRESSURE_DIAGNOSTIC_MIN_INTERVAL_MS) {
    return;
  }
  lastStreamingPressureDiagnosticAt = now;
  appendRendererDiagnostic("renderer/streaming-pressure", {
    reason: input.reason,
    eventCount: Math.min(100, Math.max(0, input.eventCount)),
    engine: normalizeNullableString(input.engine),
    workspaceId: normalizeNullableString(input.workspaceId),
    threadId: normalizeNullableString(input.threadId),
    turnId: normalizeNullableString(input.turnId),
    itemKind: normalizeNullableString(input.itemKind),
    diagnosticKind: "coalesced-realtime-flush",
  });
  if (
    isTurnTraceEnabled()
    && input.turnId !== null
    && typeof input.startedAt === "number"
  ) {
    const snapshot = snapshotByThread.get(input.threadId);
    if (snapshot) {
      const routeTiming =
        typeof input.routeStartedAt === "number" && typeof input.routeEndedAt === "number"
          ? { routeStartedAt: input.routeStartedAt, routeEndedAt: input.routeEndedAt }
          : {};
      noteTurnBatchFlushBoundary({
        dimensions: {
          workspaceId: input.workspaceId,
          threadId: input.threadId,
          turnId: input.turnId,
          engine: input.engine,
          providerId: snapshot.providerId,
          providerName: snapshot.providerName,
          baseUrl: snapshot.baseUrl,
          model: snapshot.model,
          platform: snapshot.platform,
        },
        startedAt: input.startedAt,
        endedAt: now,
        ...routeTiming,
        eventCount: input.eventCount,
        queueDepthAfter: input.queueDepthAfter ?? 0,
      });
    }
  }
}

export function noteThreadBatchFlushBoundary(input: {
  threadId: string;
  turnId: string;
  startedAt: number;
  endedAt: number;
  routeStartedAt?: number;
  routeEndedAt?: number;
  eventCount: number;
  queueDepthAfter?: number;
}) {
  if (!isTurnTraceEnabled()) {
    return;
  }
  // Reject non-finite timestamps up front so a bad call does not pollute the
  // bounded trace ring with NaN deltas.
  if (
    typeof input.startedAt !== "number"
    || !Number.isFinite(input.startedAt)
    || typeof input.endedAt !== "number"
    || !Number.isFinite(input.endedAt)
    || (
      input.routeStartedAt !== undefined &&
      (typeof input.routeStartedAt !== "number" || !Number.isFinite(input.routeStartedAt))
    )
    || (
      input.routeEndedAt !== undefined &&
      (typeof input.routeEndedAt !== "number" || !Number.isFinite(input.routeEndedAt))
    )
    || input.eventCount < 0
  ) {
    return;
  }
  const snapshot = snapshotByThread.get(input.threadId);
  if (!snapshot) {
    return;
  }
  const routeTiming =
    typeof input.routeStartedAt === "number" && typeof input.routeEndedAt === "number"
      ? { routeStartedAt: input.routeStartedAt, routeEndedAt: input.routeEndedAt }
      : {};
  noteTurnBatchFlushBoundary({
    dimensions: {
      workspaceId: snapshot.workspaceId,
      threadId: input.threadId,
      turnId: input.turnId,
      engine: snapshot.engine,
      providerId: snapshot.providerId,
      providerName: snapshot.providerName,
      baseUrl: snapshot.baseUrl,
      model: snapshot.model,
      platform: snapshot.platform,
    },
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    ...routeTiming,
    eventCount: input.eventCount,
    queueDepthAfter: input.queueDepthAfter ?? 0,
  });
}
