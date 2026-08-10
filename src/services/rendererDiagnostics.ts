import {
  getClientStoreSync,
  isPreloaded,
  writeClientStoreValue,
} from "./clientStorage";
import { recordHotspotSample } from "./perfBaseline/hotspotTracker";
import type {
  RendererHeartbeatInput,
  RendererSupportState,
} from "./tauri/rendererStability";

export type RendererDiagnosticEntry = {
  timestamp: number;
  label: string;
  payload: Record<string, unknown>;
};

const RENDERER_DIAGNOSTICS_KEY = "diagnostics.rendererLifecycleLog";
const RENDERER_DIAGNOSTICS_STORE = "diagnostics";
const LEGACY_RENDERER_DIAGNOSTICS_STORE = "app";
const MAX_RENDERER_DIAGNOSTICS = 200;
const MAX_ACTIONABLE_DIAGNOSTICS = 100;
const MAX_PERF_ENTRIES = 1000;
const MAX_REALTIME_TURN_SUMMARIES = 100;
const MAX_STREAM_LATENCY_EVIDENCE_ENTRIES = 200;
const MAX_STREAM_LATENCY_TELEMETRY_ENTRIES = 400;
const MAX_COMPOSER_RENDER_DIAGNOSTIC_SIGNATURES = 80;
const COMPOSER_RENDER_DIAGNOSTIC_MIN_INTERVAL_MS = 5_000;
const COMPOSER_RENDER_DIAGNOSTIC_RENDER_COUNT_STEP = 20;
const MAX_MESSAGE_ROW_RENDER_DIAGNOSTIC_SIGNATURES = 400;
const MESSAGE_ROW_RENDER_DIAGNOSTIC_MIN_INTERVAL_MS = 5_000;
const MESSAGE_ROW_RENDER_DIAGNOSTIC_RENDER_COUNT_STEP = 20;
const EARLY_RENDERER_DIAGNOSTICS_STORAGE_KEY =
  "doge.bootstrapRendererDiagnostics";
const DEFAULT_BLANK_WATCHDOG_INTERVAL_MS = 1_500;
const DEFAULT_BLANK_WATCHDOG_MIN_CONSECUTIVE_SAMPLES = 2;
const DEFAULT_BLANK_WATCHDOG_MAX_REPORTS = 6;
const DEFAULT_RENDERER_HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_HEARTBEAT_FAILURE_REPORTS = 3;
const MAX_PERSISTED_RENDERER_DIAGNOSTICS_BYTES = 256 * 1024;
const MAX_VOLATILE_RENDERER_DIAGNOSTICS = 200;
const MAX_VOLATILE_RENDERER_DIAGNOSTICS_BYTES = 256 * 1024;
// 高频 append（流式期间可达每秒数十次）不允许逐次触发全量 read-merge-write，
// 统一进内存 pending buffer，按该间隔 leading+trailing 节流合并落盘。
const DIAGNOSTICS_PERSIST_THROTTLE_MS = 30_000;
const MAX_PENDING_DIAGNOSTIC_ENTRIES = 2_000;
const MAX_DIAGNOSTIC_LABEL_LENGTH = 160;
const MAX_DIAGNOSTIC_PAYLOAD_DEPTH = 4;
const MAX_DIAGNOSTIC_PAYLOAD_KEYS = 40;
const MAX_DIAGNOSTIC_ARRAY_ITEMS = 40;
const MAX_DIAGNOSTIC_STRING_LENGTH = 512;
const MAX_DIAGNOSTIC_KEY_LENGTH = 80;
const REDACTED_DIAGNOSTIC_VALUE = "[redacted]";
const TRUNCATED_DIAGNOSTIC_VALUE = "[truncated]";

let installed = false;
let bufferedEntries: RendererDiagnosticEntry[] = [];
let pendingPersistEntries: RendererDiagnosticEntry[] = [];
let volatileEntries: RendererDiagnosticEntry[] = [];
let persistedDiagnosticsCache: RendererDiagnosticEntry[] | null = null;
let persistedDiagnosticSignatures = new Set<string>();
const diagnosticEntrySignatureCache = new WeakMap<
  RendererDiagnosticEntry,
  string
>();
let diagnosticsPersistTimer: ReturnType<typeof setTimeout> | null = null;
let lastDiagnosticsPersistAt = Number.NEGATIVE_INFINITY;
let diagnosticsFlushHooksInstalled = false;
let diagnosticsRevision = 0;
let blankWatchdogTimer: number | null = null;
let blankWatchdogConsecutiveSamples = 0;
let blankWatchdogReports = 0;
let rendererHeartbeatTimer: number | null = null;
let rendererHeartbeatInFlight = false;
let rendererHeartbeatSequence = 0;
let rendererHeartbeatFailureReports = 0;
const messageRowRenderDiagnosticSamples = new Map<
  string,
  {
    lastAt: number;
    renderCount: number;
  }
>();
const composerRenderDiagnosticSamples = new Map<
  string,
  {
    lastAt: number;
    renderCount: number;
  }
>();

type BlankScreenWatchdogOptions = {
  rootId?: string;
  intervalMs?: number;
  minConsecutiveSamples?: number;
  maxReports?: number;
  /** Skip checks for this initial duration (ms) — avoids forced layout during cold-start gate. */
  startDelayMs?: number;
};

type RendererHeartbeatOptions = {
  intervalMs?: number;
  appScope?: string;
  rendererId?: string;
  workspaceId?: string | null;
  threadId?: string | null;
};

const ACTIONABLE_RENDERER_DIAGNOSTIC_LABELS = new Set([
  "window/error",
  "window/unhandledrejection",
  "messages/row-error-boundary",
  "renderer/blank-screen-suspected",
  "renderer/heartbeat-send-failed",
]);

const STREAM_LATENCY_EVIDENCE_LABELS = new Set([
  "stream-latency/mitigation-activated",
  "stream-latency/mitigation-candidate-selected",
  "stream-latency/long-live-row-render",
  "stream-latency/recovery-source",
  "stream-latency/repeat-turn-blanking",
  "stream-latency/first-visible-render",
  "stream-latency/first-visible-latency",
  "stream-latency/render-amplification",
  "stream-latency/visible-output-stall-after-first-delta",
  "stream-latency/upstream-pending",
]);

function isActionableRendererDiagnostic(label: string): boolean {
  const normalized = label.toLowerCase();
  return (
    ACTIONABLE_RENDERER_DIAGNOSTIC_LABELS.has(normalized) ||
    normalized.startsWith("react/error-boundary") ||
    (normalized.startsWith("bootstrap/") && normalized.endsWith("failed")) ||
    (normalized.includes("worker") &&
      (normalized.endsWith("/error") || normalized.endsWith("failed")))
  );
}

function isStreamLatencyEvidence(label: string): boolean {
  return STREAM_LATENCY_EVIDENCE_LABELS.has(label.toLowerCase());
}

function utf8ByteLength(value: string): number {
  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit < 0x80) {
      byteLength += 1;
    } else if (codeUnit < 0x800) {
      byteLength += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      byteLength += 4;
      index += 1;
    } else {
      byteLength += 3;
    }
  }
  return byteLength;
}

function trimDiagnosticsToByteBudget(
  entries: RendererDiagnosticEntry[],
  maxBytes: number,
): RendererDiagnosticEntry[] {
  if (entries.length === 0) {
    return entries;
  }
  const entryBytes = entries.map((entry) =>
    utf8ByteLength(getDiagnosticEntrySignature(entry)),
  );
  let retainedCount = entries.length;
  let serializedBytes =
    2 +
    Math.max(0, entries.length - 1) +
    entryBytes.reduce((sum, size) => sum + size, 0);
  if (serializedBytes <= maxBytes) {
    return entries;
  }

  const removed = new Set<number>();
  const removalOrder = [
    ...entries.flatMap((entry, index) =>
      isActionableRendererDiagnostic(entry.label) ? [] : [index],
    ),
    ...entries.flatMap((entry, index) =>
      isActionableRendererDiagnostic(entry.label) ? [index] : [],
    ),
  ];
  for (const index of removalOrder) {
    if (serializedBytes <= maxBytes || retainedCount === 0) {
      break;
    }
    removed.add(index);
    serializedBytes -= entryBytes[index] ?? 0;
    if (retainedCount > 1) {
      serializedBytes -= 1;
    }
    retainedCount -= 1;
  }
  return entries.filter((_, index) => !removed.has(index));
}

function trimDiagnostics(entries: RendererDiagnosticEntry[]) {
  const regularEntries: RendererDiagnosticEntry[] = [];
  const actionableEntries: RendererDiagnosticEntry[] = [];
  const perfEntries: RendererDiagnosticEntry[] = [];
  const realtimeTurnSummaryEntries: RendererDiagnosticEntry[] = [];
  const streamLatencyEvidenceEntries: RendererDiagnosticEntry[] = [];
  const streamLatencyTelemetryEntries: RendererDiagnosticEntry[] = [];
  for (const entry of entries) {
    if (isActionableRendererDiagnostic(entry.label)) {
      actionableEntries.push(entry);
    } else if (entry.label === "realtime.turnTrace.summary") {
      realtimeTurnSummaryEntries.push(entry);
    } else if (isStreamLatencyEvidence(entry.label)) {
      streamLatencyEvidenceEntries.push(entry);
    } else if (entry.label.startsWith("stream-latency/")) {
      streamLatencyTelemetryEntries.push(entry);
    } else if (entry.label.startsWith("perf.")) {
      perfEntries.push(entry);
    } else {
      regularEntries.push(entry);
    }
  }
  const countBoundedEntries = [
    ...regularEntries.slice(
      Math.max(0, regularEntries.length - MAX_RENDERER_DIAGNOSTICS),
    ),
    ...actionableEntries.slice(
      Math.max(0, actionableEntries.length - MAX_ACTIONABLE_DIAGNOSTICS),
    ),
    ...perfEntries.slice(Math.max(0, perfEntries.length - MAX_PERF_ENTRIES)),
    ...realtimeTurnSummaryEntries.slice(
      Math.max(
        0,
        realtimeTurnSummaryEntries.length - MAX_REALTIME_TURN_SUMMARIES,
      ),
    ),
    ...streamLatencyEvidenceEntries.slice(
      Math.max(
        0,
        streamLatencyEvidenceEntries.length -
          MAX_STREAM_LATENCY_EVIDENCE_ENTRIES,
      ),
    ),
    ...streamLatencyTelemetryEntries.slice(
      Math.max(
        0,
        streamLatencyTelemetryEntries.length -
          MAX_STREAM_LATENCY_TELEMETRY_ENTRIES,
      ),
    ),
  ].sort((left, right) => left.timestamp - right.timestamp);
  return trimDiagnosticsToByteBudget(
    countBoundedEntries,
    MAX_PERSISTED_RENDERER_DIAGNOSTICS_BYTES,
  );
}

function mergeDiagnostics(
  ...groups: RendererDiagnosticEntry[][]
): RendererDiagnosticEntry[] {
  const seen = new Set<string>();
  const merged: RendererDiagnosticEntry[] = [];
  for (const group of groups) {
    for (const entry of group) {
      const signature = getDiagnosticEntrySignature(entry);
      if (seen.has(signature)) {
        continue;
      }
      seen.add(signature);
      merged.push(entry);
    }
  }
  return trimDiagnostics(merged);
}

function getDiagnosticEntrySignature(entry: RendererDiagnosticEntry): string {
  const cached = diagnosticEntrySignatureCache.get(entry);
  if (cached) {
    return cached;
  }
  const signature = JSON.stringify(entry);
  diagnosticEntrySignatureCache.set(entry, signature);
  return signature;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeDiagnosticFieldName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .toLowerCase();
}

function isSafeDiagnosticToken(value: unknown): boolean {
  return (
    (typeof value === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,127}$/.test(value)) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function isSafeDiagnosticHash(value: unknown): boolean {
  return typeof value === "string" && /^[a-z0-9]{1,16}$/i.test(value);
}

function isSensitiveDiagnosticField(
  fieldName: string,
  value: unknown,
): boolean {
  const normalized = normalizeDiagnosticFieldName(fieldName);
  if (
    /(?:^|_)(?:token|secret|password|authorization|cookie|api_key)(?:_|$)/.test(
      normalized,
    )
  ) {
    return true;
  }
  const containsContentToken =
    /(?:^|_)(?:message|error|reason|stack|prompt|raw|output|html|content|text|command|argv|args|filename|href|url|path|data)(?:_|$)/.test(
      normalized,
    );
  if (!containsContentToken) {
    return false;
  }
  if (
    /(?:^|_)(?:count|length)(?:_|$)/.test(normalized) &&
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return false;
  }
  if (/(?:^|_)hash(?:_|$)/.test(normalized) && isSafeDiagnosticHash(value)) {
    return false;
  }
  if (
    /(?:^|_)(?:id|code|state|kind|category|mode|source|label|profile|engine|status|type|name)(?:_|$)/.test(
      normalized,
    ) &&
    isSafeDiagnosticToken(value)
  ) {
    return false;
  }
  if (
    normalized !== "reason" &&
    normalized.endsWith("_reason") &&
    isSafeDiagnosticToken(value)
  ) {
    return false;
  }
  return true;
}

function clipDiagnosticString(value: string, maxLength: number): string {
  const withoutControls = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? " " : character;
  }).join("");
  if (withoutControls.length <= maxLength) {
    return withoutControls;
  }
  return `${withoutControls.slice(0, maxLength)}…`;
}

function sanitizeDiagnosticValue(
  value: unknown,
  fieldName: string,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null) {
    return value;
  }
  if (isSensitiveDiagnosticField(fieldName, value)) {
    return REDACTED_DIAGNOSTIC_VALUE;
  }
  if (
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value === "string") {
    return clipDiagnosticString(value, MAX_DIAGNOSTIC_STRING_LENGTH);
  }
  if (depth >= MAX_DIAGNOSTIC_PAYLOAD_DEPTH) {
    return TRUNCATED_DIAGNOSTIC_VALUE;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return TRUNCATED_DIAGNOSTIC_VALUE;
    }
    seen.add(value);
    const sanitized = value
      .slice(0, MAX_DIAGNOSTIC_ARRAY_ITEMS)
      .map((entry) => sanitizeDiagnosticValue(entry, "", depth + 1, seen));
    seen.delete(value);
    if (value.length > MAX_DIAGNOSTIC_ARRAY_ITEMS) {
      sanitized.push(TRUNCATED_DIAGNOSTIC_VALUE);
    }
    return sanitized;
  }
  if (isRecord(value)) {
    if (seen.has(value)) {
      return TRUNCATED_DIAGNOSTIC_VALUE;
    }
    seen.add(value);
    const sanitized: Record<string, unknown> = {};
    const entries = Object.entries(value);
    for (const [rawKey, entry] of entries.slice(
      0,
      MAX_DIAGNOSTIC_PAYLOAD_KEYS,
    )) {
      const key = clipDiagnosticString(rawKey, MAX_DIAGNOSTIC_KEY_LENGTH);
      sanitized[key] = sanitizeDiagnosticValue(entry, key, depth + 1, seen);
    }
    if (entries.length > MAX_DIAGNOSTIC_PAYLOAD_KEYS) {
      sanitized.__truncated__ = entries.length - MAX_DIAGNOSTIC_PAYLOAD_KEYS;
    }
    seen.delete(value);
    return sanitized;
  }
  return TRUNCATED_DIAGNOSTIC_VALUE;
}

function sanitizeDiagnosticPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeDiagnosticValue(
    payload,
    "",
    0,
    new WeakSet<object>(),
  ) as Record<string, unknown>;
}

function normalizeDiagnosticEntry(
  value: unknown,
): RendererDiagnosticEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const { timestamp, label, payload } = value;
  if (
    typeof timestamp !== "number" ||
    !Number.isFinite(timestamp) ||
    typeof label !== "string" ||
    label.trim().length === 0
  ) {
    return null;
  }
  return {
    timestamp,
    label: clipDiagnosticString(label, MAX_DIAGNOSTIC_LABEL_LENGTH),
    payload: isRecord(payload) ? sanitizeDiagnosticPayload(payload) : {},
  };
}

function normalizeDiagnosticEntries(value: unknown): RendererDiagnosticEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    const normalized = normalizeDiagnosticEntry(entry);
    return normalized ? [normalized] : [];
  });
}

function formatUnknown(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function collectWindowSnapshot(extra: Record<string, unknown> = {}) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return extra;
  }
  return {
    visibilityState: document.visibilityState,
    readyState: document.readyState,
    hasFocus:
      typeof document.hasFocus === "function" ? document.hasFocus() : null,
    href: window.location.href,
    ...extra,
  };
}

function collectElementSnapshot(element: HTMLElement | null) {
  if (!element || typeof window === "undefined") {
    return {
      exists: false,
      childElementCount: 0,
      textLength: 0,
      width: 0,
      height: 0,
      display: null,
      visibility: null,
      opacity: null,
    };
  }
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return {
    exists: true,
    childElementCount: element.childElementCount,
    textLength: element.textContent?.trim().length ?? 0,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
  };
}

function collectRendererBlankScreenSnapshot(rootId: string) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  const root = document.getElementById(rootId);
  const rootElement = root instanceof HTMLElement ? root : null;
  const rootSnapshot = collectElementSnapshot(rootElement);
  const bodySnapshot = collectElementSnapshot(document.body);
  const activeElement = document.activeElement;
  return collectWindowSnapshot({
    rootId,
    root: rootSnapshot,
    body: bodySnapshot,
    activeElementTag:
      activeElement instanceof HTMLElement
        ? activeElement.tagName.toLowerCase()
        : null,
  });
}

function isBlankRendererSnapshot(snapshot: Record<string, unknown> | null) {
  if (!snapshot) {
    return false;
  }
  const root = snapshot.root;
  const body = snapshot.body;
  if (!isRecord(root) || !isRecord(body)) {
    return false;
  }
  if (root.exists !== true) {
    return true;
  }
  const rootChildElementCount =
    typeof root.childElementCount === "number" ? root.childElementCount : 0;
  const rootTextLength =
    typeof root.textLength === "number" ? root.textLength : 0;
  const rootWidth = typeof root.width === "number" ? root.width : 0;
  const rootHeight = typeof root.height === "number" ? root.height : 0;
  const bodyWidth = typeof body.width === "number" ? body.width : 0;
  const bodyHeight = typeof body.height === "number" ? body.height : 0;
  const rootHidden =
    root.display === "none" ||
    root.visibility === "hidden" ||
    root.opacity === "0";
  const rootHasNoContent = rootChildElementCount === 0 && rootTextLength === 0;
  const rootHasNoArea = rootWidth <= 0 || rootHeight <= 0;
  const bodyHasArea = bodyWidth > 0 && bodyHeight > 0;
  return rootHidden || rootHasNoContent || (bodyHasArea && rootHasNoArea);
}

function persistDiagnostics(
  entries: RendererDiagnosticEntry[],
  options: { immediate?: boolean } = {},
) {
  if (options.immediate) {
    writeClientStoreValue(
      RENDERER_DIAGNOSTICS_STORE,
      RENDERER_DIAGNOSTICS_KEY,
      entries,
      { immediate: true },
    );
    return;
  }
  writeClientStoreValue(
    RENDERER_DIAGNOSTICS_STORE,
    RENDERER_DIAGNOSTICS_KEY,
    entries,
  );
}

function canUseLocalStorage() {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.localStorage !== "undefined"
  );
}

function readEarlyPersistedDiagnostics(): RendererDiagnosticEntry[] {
  if (!canUseLocalStorage()) {
    return [];
  }
  try {
    const raw = globalThis.localStorage.getItem(
      EARLY_RENDERER_DIAGNOSTICS_STORAGE_KEY,
    );
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    return normalizeDiagnosticEntries(parsed);
  } catch {
    return [];
  }
}

function persistEarlyDiagnostics(entries: RendererDiagnosticEntry[]) {
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    if (entries.length === 0) {
      globalThis.localStorage.removeItem(
        EARLY_RENDERER_DIAGNOSTICS_STORAGE_KEY,
      );
      return;
    }
    globalThis.localStorage.setItem(
      EARLY_RENDERER_DIAGNOSTICS_STORAGE_KEY,
      JSON.stringify(trimDiagnostics(entries)),
    );
  } catch {
    // Ignore localStorage failures, diagnostics are best effort.
  }
}

function readNowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function bumpDiagnosticsRevision(): void {
  diagnosticsRevision += 1;
}

function readPersistedDiagnosticsFromStores() {
  const stored = getClientStoreSync<RendererDiagnosticEntry[] | unknown>(
    RENDERER_DIAGNOSTICS_STORE,
    RENDERER_DIAGNOSTICS_KEY,
  );
  const legacyStored = getClientStoreSync<RendererDiagnosticEntry[] | unknown>(
    LEGACY_RENDERER_DIAGNOSTICS_STORE,
    RENDERER_DIAGNOSTICS_KEY,
  );
  return mergeDiagnostics(
    normalizeDiagnosticEntries(legacyStored),
    normalizeDiagnosticEntries(stored),
    readEarlyPersistedDiagnostics(),
  );
}

function getPersistedDiagnosticsSnapshot(): RendererDiagnosticEntry[] {
  if (persistedDiagnosticsCache === null) {
    let loadedEntries = readPersistedDiagnosticsFromStores();
    if (!isPreloaded()) {
      return loadedEntries;
    }
    // Defensive: the persisted file can grow beyond the byte budget across
    // multi-day sessions (field evidence: 401 KB on disk vs 256 KB budget).
    // Trim once at cache-population so in-memory state stays bounded and the
    // next persist writes a smaller file.
    const untrimmedBytes =
      2 +
      Math.max(0, loadedEntries.length - 1) +
      loadedEntries.reduce(
        (sum, entry) => sum + utf8ByteLength(getDiagnosticEntrySignature(entry)),
        0,
      );
    if (untrimmedBytes > MAX_PERSISTED_RENDERER_DIAGNOSTICS_BYTES) {
      loadedEntries = trimDiagnosticsToByteBudget(
        loadedEntries,
        MAX_PERSISTED_RENDERER_DIAGNOSTICS_BYTES,
      );
    }
    persistedDiagnosticsCache = loadedEntries;
    persistedDiagnosticSignatures = new Set(
      persistedDiagnosticsCache.map(getDiagnosticEntrySignature),
    );
  }
  return persistedDiagnosticsCache;
}

function mergeIntoPersistedDiagnostics(
  ...groups: RendererDiagnosticEntry[][]
): RendererDiagnosticEntry[] {
  const merged = [...getPersistedDiagnosticsSnapshot()];
  for (const group of groups) {
    for (const entry of group) {
      const signature = getDiagnosticEntrySignature(entry);
      if (persistedDiagnosticSignatures.has(signature)) {
        continue;
      }
      persistedDiagnosticSignatures.add(signature);
      merged.push(entry);
    }
  }
  persistedDiagnosticsCache = trimDiagnostics(merged);
  persistedDiagnosticSignatures = new Set(
    persistedDiagnosticsCache.map(getDiagnosticEntrySignature),
  );
  return persistedDiagnosticsCache;
}

/**
 * 导出合并后的诊断条目(只读),供设置页「复制卡顿现场」等外部消费。
 * pending buffer 中尚未落盘的条目一并合入，避免节流窗口内丢失最新现场。
 */
export function exportRendererDiagnostics(): RendererDiagnosticEntry[] {
  const startedAt = readNowMs();
  const entries = mergeDiagnostics(
    getPersistedDiagnosticsSnapshot(),
    bufferedEntries,
    pendingPersistEntries,
    volatileEntries,
  );
  recordHotspotSample(
    "diagnostics-export",
    readNowMs() - startedAt,
    `entries=${entries.length}`,
  );
  return entries;
}

/**
 * Cheap change counter for live diagnostic UIs. Exporting diagnostics may merge
 * and stringify many entries, so polling surfaces should check this before doing
 * a full export.
 */
export function getRendererDiagnosticsRevision(): number {
  return diagnosticsRevision;
}

/**
 * 清空全部诊断条目。初始 snapshot 会合并三个来源(当前 store、legacy
 * store、preload 前的 early localStorage),漏掉任何一个都会让旧条目"复活",
 * 所以必须三处一起清。供设置页「最近卡顿」面板的清空按钮使用。
 */
export function clearRendererDiagnostics(): void {
  bufferedEntries = [];
  pendingPersistEntries = [];
  volatileEntries = [];
  persistedDiagnosticsCache = [];
  persistedDiagnosticSignatures = new Set();
  if (diagnosticsPersistTimer !== null) {
    clearTimeout(diagnosticsPersistTimer);
    diagnosticsPersistTimer = null;
  }
  persistEarlyDiagnostics([]);
  persistDiagnostics([]);
  writeClientStoreValue(
    LEGACY_RENDERER_DIAGNOSTICS_STORE,
    RENDERER_DIAGNOSTICS_KEY,
    [],
  );
  bumpDiagnosticsRevision();
}

/**
 * 将 legacy `app` store 里的 renderer lifecycle 日志合并进当前 diagnostics store
 * 并清空 legacy key，避免后续 reload 重复读入已经迁移的存量。
 */
export function migrateLegacyRendererDiagnostics(): void {
  const legacyStored = getClientStoreSync<unknown>(
    LEGACY_RENDERER_DIAGNOSTICS_STORE,
    RENDERER_DIAGNOSTICS_KEY,
  );
  if (!Array.isArray(legacyStored) || legacyStored.length === 0) {
    return;
  }
  persistDiagnostics(
    mergeIntoPersistedDiagnostics(normalizeDiagnosticEntries(legacyStored)),
  );
  writeClientStoreValue(
    LEGACY_RENDERER_DIAGNOSTICS_STORE,
    RENDERER_DIAGNOSTICS_KEY,
    [],
  );
}

function persistPendingDiagnostics(options: { immediate?: boolean } = {}) {
  if (diagnosticsPersistTimer !== null) {
    clearTimeout(diagnosticsPersistTimer);
    diagnosticsPersistTimer = null;
  }
  if (pendingPersistEntries.length === 0 && bufferedEntries.length === 0) {
    return;
  }
  const persistStartedAt =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  lastDiagnosticsPersistAt = Date.now();
  const nextEntries = mergeIntoPersistedDiagnostics(
    bufferedEntries,
    pendingPersistEntries,
  );
  bufferedEntries = [];
  pendingPersistEntries = [];
  persistEarlyDiagnostics([]);
  persistDiagnostics(nextEntries, options);
  recordHotspotSample(
    "diagnostics-persist",
    (typeof performance !== "undefined" ? performance.now() : Date.now()) -
      persistStartedAt,
    `entries=${nextEntries.length}`,
  );
}

function installDiagnosticsFlushHooks() {
  if (
    diagnosticsFlushHooksInstalled ||
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof window.addEventListener !== "function" ||
    typeof document.addEventListener !== "function"
  ) {
    return;
  }
  diagnosticsFlushHooksInstalled = true;
  window.addEventListener("pagehide", () => {
    persistPendingDiagnostics({ immediate: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      persistPendingDiagnostics({ immediate: true });
    }
  });
}

export function appendRendererDiagnostic(
  label: string,
  payload: Record<string, unknown> = {},
) {
  appendRendererDiagnosticEntry(label, payload, false);
}

/**
 * Session-only diagnostic ring for high-frequency samplers. Entries remain
 * visible to live/export surfaces without triggering client-store persistence.
 */
export function appendVolatileRendererDiagnostic(
  label: string,
  payload: Record<string, unknown> = {},
) {
  const entry = normalizeDiagnosticEntry({
    timestamp: Date.now(),
    label,
    payload,
  });
  if (!entry) {
    return;
  }
  const countBoundedEntries = [...volatileEntries, entry].slice(
    -MAX_VOLATILE_RENDERER_DIAGNOSTICS,
  );
  volatileEntries = trimDiagnosticsToByteBudget(
    countBoundedEntries,
    MAX_VOLATILE_RENDERER_DIAGNOSTICS_BYTES,
  );
  bumpDiagnosticsRevision();
}

function appendRendererDiagnosticEntry(
  label: string,
  payload: Record<string, unknown>,
  immediate: boolean,
) {
  const entry = normalizeDiagnosticEntry({
    timestamp: Date.now(),
    label,
    payload,
  });
  if (!entry) {
    return;
  }

  if (!isPreloaded()) {
    bufferedEntries = trimDiagnostics([...bufferedEntries, entry]);
    persistEarlyDiagnostics(bufferedEntries);
    bumpDiagnosticsRevision();
    return;
  }

  pendingPersistEntries.push(entry);
  if (pendingPersistEntries.length > MAX_PENDING_DIAGNOSTIC_ENTRIES) {
    pendingPersistEntries = trimDiagnostics(pendingPersistEntries);
  }
  bumpDiagnosticsRevision();
  installDiagnosticsFlushHooks();
  if (immediate) {
    persistPendingDiagnostics({ immediate: true });
    return;
  }
  const now = Date.now();
  const elapsedSincePersist = now - lastDiagnosticsPersistAt;
  if (elapsedSincePersist >= DIAGNOSTICS_PERSIST_THROTTLE_MS) {
    persistPendingDiagnostics();
    return;
  }
  if (diagnosticsPersistTimer === null) {
    diagnosticsPersistTimer = setTimeout(
      () => {
        diagnosticsPersistTimer = null;
        persistPendingDiagnostics();
      },
      Math.max(0, DIAGNOSTICS_PERSIST_THROTTLE_MS - elapsedSincePersist),
    );
  }
}

export function appendRendererPerfDiagnostic(
  label: "perf.web-vital",
  payload: Record<string, unknown> = {},
) {
  appendRendererDiagnostic(label, payload);
}

export type ClientInteractionPerfEvidenceKind =
  "measured" | "proxy" | "manual-only" | "unsupported";

export type ClientInteractionPerfDiagnosticInput = {
  area:
    | "typing"
    | "streaming-controls"
    | "thread-switch"
    | "sidebar-projection"
    | "catalog-hydration";
  evidenceKind: ClientInteractionPerfEvidenceKind;
  workspaceId?: string | null;
  threadId?: string | null;
  engine?: string | null;
  turnId?: string | null;
  inputEventCount?: number | null;
  renderCount?: number | null;
  commitDurationMs?: number | null;
  longTaskCount?: number | null;
  requestCount?: number | null;
  foregroundLatencyMs?: number | null;
  hydrationLatencyMs?: number | null;
  notes?: string | null;
};

export type ComposerRenderBudgetDiagnosticInput = {
  surfaceId: "chat-input-adapter" | "chat-input-box";
  evidenceKind: ClientInteractionPerfEvidenceKind;
  workspaceId?: string | null;
  renderCount: number;
  isProcessing?: boolean;
  disabled?: boolean;
  streamActivityPhase?: string | null;
  textLength?: number | null;
};

export type MessageRowRenderBudgetDiagnosticInput = {
  threadId?: string | null;
  itemId: string;
  role: "user" | "assistant";
  subtype: string;
  evidenceKind: ClientInteractionPerfEvidenceKind;
  renderCount: number;
  isStreaming?: boolean;
  textLength?: number | null;
};

export type EventBackpressureDiagnosticInput = {
  surfaceId: string;
  eventKind: string;
  queueDepth: number;
  droppedCount: number;
  coalescedCount: number;
  flushCount: number;
  lastFlushDurationMs: number;
  criticalBypassCount: number;
  deliveredCount: number;
  rawRetainedCount: number;
  evidenceClass: ClientInteractionPerfEvidenceKind;
};

export type ListenerOwnerDiagnosticInput = {
  activeCount: number;
  inactiveCount: number;
  evidenceClass: ClientInteractionPerfEvidenceKind;
};

export type MediaOwnerDiagnosticInput = {
  activeCount: number;
  revokedCount: number;
  retainedBytes?: number | null;
  unsupportedReason?: string | null;
  evidenceClass: ClientInteractionPerfEvidenceKind;
};

export type MarkdownPrecomputeDiagnosticInput = {
  mode: "worker-precompute" | "main" | "cache-hit" | "fallback";
  durationMs: number;
  contentLength: number;
  contentHash: string;
  thresholdReason: string;
  cacheState: string;
  fallbackReason?: string | null;
  evidenceClass: ClientInteractionPerfEvidenceKind;
  heavyCategoryCounts?: Record<string, number> | null;
  totalHeadings?: number | null;
  totalHeavyBlocks?: number | null;
  totalSourceLines?: number | null;
};

export type WorkspaceFileListingBudgetDiagnosticInput = {
  surfaceId:
    | "initial-listing"
    | "subtree-listing"
    | "fallback-full-listing"
    | "shared-index";
  workspaceId?: string | null;
  durationMs?: number | null;
  returnedEntries: number;
  payloadBytes?: number | null;
  cacheState: string;
  scanState?: string | null;
  partial: boolean;
  limitHit: boolean;
  sourceVersion?: string | null;
  requestedPathHash?: string | null;
  evidenceClass: ClientInteractionPerfEvidenceKind;
  fallbackReason?: string | null;
};

export type RenderSchedulerResourceDiagnosticInput = {
  surfaceId: string;
  chunkCount: number;
  yieldCount: number;
  inputPendingYieldCount: number;
  budgetMissCount: number;
  idleCallbackCount: number;
  timeoutFallbackCount: number;
  pendingCallback: boolean;
  idleCallbackPending: boolean;
  timeoutFallbackPending: boolean;
  cancelled: boolean;
  evidenceClass: ClientInteractionPerfEvidenceKind;
};

function toFiniteDiagnosticNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : null;
}

function toBoundedDiagnosticString(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

function toBoundedDiagnosticCountRecord(
  value: Record<string, number> | null | undefined,
) {
  if (!value) {
    return null;
  }
  const result: Record<string, number> = {};
  for (const [key, count] of Object.entries(value).slice(0, 20)) {
    if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) {
      continue;
    }
    result[toBoundedDiagnosticString(key) ?? "unknown"] = Math.round(count);
  }
  return Object.keys(result).length > 0 ? result : null;
}

function shouldAppendMessageRowRenderBudgetDiagnostic(
  input: MessageRowRenderBudgetDiagnosticInput,
) {
  const signature = [
    input.threadId ?? "thread:unknown",
    input.itemId,
    input.role,
    input.subtype,
  ].join(":");
  const now = Date.now();
  const previous = messageRowRenderDiagnosticSamples.get(signature);
  const renderCount = toFiniteDiagnosticNumber(input.renderCount) ?? 0;
  const shouldAppend =
    !previous ||
    now - previous.lastAt >= MESSAGE_ROW_RENDER_DIAGNOSTIC_MIN_INTERVAL_MS ||
    renderCount - previous.renderCount >=
      MESSAGE_ROW_RENDER_DIAGNOSTIC_RENDER_COUNT_STEP;
  if (!shouldAppend) {
    return false;
  }
  messageRowRenderDiagnosticSamples.delete(signature);
  messageRowRenderDiagnosticSamples.set(signature, {
    lastAt: now,
    renderCount,
  });
  while (
    messageRowRenderDiagnosticSamples.size >
    MAX_MESSAGE_ROW_RENDER_DIAGNOSTIC_SIGNATURES
  ) {
    const oldestKey = messageRowRenderDiagnosticSamples.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    messageRowRenderDiagnosticSamples.delete(oldestKey);
  }
  return true;
}

function shouldAppendComposerRenderBudgetDiagnostic(
  input: ComposerRenderBudgetDiagnosticInput,
) {
  const signature = [
    input.surfaceId,
    input.workspaceId ?? "workspace:unknown",
    input.streamActivityPhase ?? "phase:unknown",
    input.isProcessing ? "processing" : "not-processing",
    input.disabled ? "disabled" : "enabled",
  ].join(":");
  const now = Date.now();
  const previous = composerRenderDiagnosticSamples.get(signature);
  const renderCount = toFiniteDiagnosticNumber(input.renderCount) ?? 0;
  const shouldAppend =
    !previous ||
    renderCount < previous.renderCount ||
    now - previous.lastAt >= COMPOSER_RENDER_DIAGNOSTIC_MIN_INTERVAL_MS ||
    renderCount - previous.renderCount >=
      COMPOSER_RENDER_DIAGNOSTIC_RENDER_COUNT_STEP;
  if (!shouldAppend) {
    return false;
  }
  composerRenderDiagnosticSamples.delete(signature);
  composerRenderDiagnosticSamples.set(signature, { lastAt: now, renderCount });
  while (
    composerRenderDiagnosticSamples.size >
    MAX_COMPOSER_RENDER_DIAGNOSTIC_SIGNATURES
  ) {
    const oldestKey = composerRenderDiagnosticSamples.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }
    composerRenderDiagnosticSamples.delete(oldestKey);
  }
  return true;
}

function isPerfDiagnosticCollectionEnabled() {
  const env = (import.meta.env ?? {}) as Record<
    string,
    string | boolean | undefined
  >;
  const nodeEnv =
    typeof process === "undefined" ? undefined : process.env?.NODE_ENV;
  return (
    env.DEV === true ||
    env.VITE_ENABLE_PERF_BASELINE === "1" ||
    nodeEnv === "test"
  );
}

function toSupportState(supported: boolean): RendererSupportState {
  return supported ? "supported" : "unsupported";
}

function getNavigatorPlatform() {
  if (typeof navigator === "undefined") {
    return "unknown";
  }
  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  return (
    navigatorWithUserAgentData.userAgentData?.platform ||
    navigator.platform ||
    "unknown"
  ).slice(0, 80);
}

function getAppVersion() {
  const env = (import.meta.env ?? {}) as Record<string, string | undefined>;
  return (env.VITE_APP_VERSION || env.PACKAGE_VERSION || "unknown").slice(
    0,
    80,
  );
}

function getLongTaskSupportState(): RendererSupportState {
  if (typeof PerformanceObserver === "undefined") {
    return "unsupported";
  }
  const observer = PerformanceObserver as typeof PerformanceObserver & {
    supportedEntryTypes?: readonly string[];
  };
  return toSupportState(
    Boolean(observer.supportedEntryTypes?.includes("longtask")),
  );
}

function getMemorySnapshot() {
  if (typeof performance === "undefined" || !("memory" in performance)) {
    return {
      memorySupportState: "unsupported" as RendererSupportState,
      usedJsHeapSize: null,
      totalJsHeapSize: null,
      jsHeapSizeLimit: null,
    };
  }
  const memory = (
    performance as Performance & {
      memory?: {
        usedJSHeapSize?: number;
        totalJSHeapSize?: number;
        jsHeapSizeLimit?: number;
      };
    }
  ).memory;
  return {
    memorySupportState: "supported" as RendererSupportState,
    usedJsHeapSize: toFiniteDiagnosticNumber(memory?.usedJSHeapSize),
    totalJsHeapSize: toFiniteDiagnosticNumber(memory?.totalJSHeapSize),
    jsHeapSizeLimit: toFiniteDiagnosticNumber(memory?.jsHeapSizeLimit),
  };
}

export function buildRendererHeartbeatPayload(
  options: RendererHeartbeatOptions = {},
): RendererHeartbeatInput {
  const memorySnapshot = getMemorySnapshot();
  const longTaskSupportState = getLongTaskSupportState();
  rendererHeartbeatSequence += 1;
  return {
    appScope: toBoundedDiagnosticString(options.appScope) ?? "main",
    rendererId: toBoundedDiagnosticString(options.rendererId) ?? "main",
    sequence: rendererHeartbeatSequence,
    sentAt: Date.now(),
    platform: getNavigatorPlatform(),
    appVersion: getAppVersion(),
    workspaceId: toBoundedDiagnosticString(options.workspaceId),
    threadId: toBoundedDiagnosticString(options.threadId),
    visibilityState:
      typeof document === "undefined" ? "unknown" : document.visibilityState,
    documentReadyState:
      typeof document === "undefined" ? "unknown" : document.readyState,
    support: {
      nativeProcessFailureHook: "not-implemented",
      memory: memorySnapshot.memorySupportState,
      longTask: longTaskSupportState,
      processCount: "unsupported",
    },
    pressure: {
      activeEngineCount: null,
      activeStreamingTurnCount: null,
      helperProcessCount: null,
      memorySupportState: memorySnapshot.memorySupportState,
      usedJsHeapSize: memorySnapshot.usedJsHeapSize,
      totalJsHeapSize: memorySnapshot.totalJsHeapSize,
      jsHeapSizeLimit: memorySnapshot.jsHeapSizeLimit,
      longTaskSupportState,
      recoveryAttemptCount: 0,
    },
  };
}

async function sendRendererHeartbeat(options: RendererHeartbeatOptions) {
  if (rendererHeartbeatInFlight) {
    return;
  }
  rendererHeartbeatInFlight = true;
  try {
    const { recordRendererHeartbeat } =
      await import("./tauri/rendererStability");
    await recordRendererHeartbeat(buildRendererHeartbeatPayload(options));
    rendererHeartbeatFailureReports = 0;
  } catch (error) {
    if (rendererHeartbeatFailureReports < MAX_HEARTBEAT_FAILURE_REPORTS) {
      rendererHeartbeatFailureReports += 1;
      appendRendererDiagnostic("renderer/heartbeat-send-failed", {
        error: formatUnknown(error),
        reportCount: rendererHeartbeatFailureReports,
      });
    }
  } finally {
    rendererHeartbeatInFlight = false;
  }
}

export function appendClientInteractionPerfDiagnostic(
  input: ClientInteractionPerfDiagnosticInput,
) {
  appendRendererDiagnostic("perf.client-interaction", {
    area: input.area,
    evidenceKind: input.evidenceKind,
    workspaceId: toBoundedDiagnosticString(input.workspaceId),
    threadId: toBoundedDiagnosticString(input.threadId),
    engine: toBoundedDiagnosticString(input.engine),
    turnId: toBoundedDiagnosticString(input.turnId),
    inputEventCount: toFiniteDiagnosticNumber(input.inputEventCount),
    renderCount: toFiniteDiagnosticNumber(input.renderCount),
    commitDurationMs: toFiniteDiagnosticNumber(input.commitDurationMs),
    longTaskCount: toFiniteDiagnosticNumber(input.longTaskCount),
    requestCount: toFiniteDiagnosticNumber(input.requestCount),
    foregroundLatencyMs: toFiniteDiagnosticNumber(input.foregroundLatencyMs),
    hydrationLatencyMs: toFiniteDiagnosticNumber(input.hydrationLatencyMs),
    notes: toBoundedDiagnosticString(input.notes),
  });
}

export function appendComposerRenderBudgetDiagnostic(
  input: ComposerRenderBudgetDiagnosticInput,
) {
  if (!isPerfDiagnosticCollectionEnabled()) {
    return;
  }
  if (
    !input.isProcessing &&
    input.streamActivityPhase === "idle" &&
    toFiniteDiagnosticNumber(input.textLength) === 0
  ) {
    return;
  }
  if (!shouldAppendComposerRenderBudgetDiagnostic(input)) {
    return;
  }
  appendRendererDiagnostic("perf.composer.render-budget", {
    surfaceId: input.surfaceId,
    evidenceKind: input.evidenceKind,
    workspaceId: toBoundedDiagnosticString(input.workspaceId),
    renderCount: toFiniteDiagnosticNumber(input.renderCount),
    isProcessing: Boolean(input.isProcessing),
    disabled: Boolean(input.disabled),
    streamActivityPhase: toBoundedDiagnosticString(input.streamActivityPhase),
    textLength: toFiniteDiagnosticNumber(input.textLength),
  });
}

export function appendMessageRowRenderBudgetDiagnostic(
  input: MessageRowRenderBudgetDiagnosticInput,
) {
  if (!isPerfDiagnosticCollectionEnabled()) {
    return;
  }
  if (!shouldAppendMessageRowRenderBudgetDiagnostic(input)) {
    return;
  }
  appendRendererDiagnostic("perf.messages.row-render-budget", {
    threadId: toBoundedDiagnosticString(input.threadId),
    itemId: toBoundedDiagnosticString(input.itemId),
    role: input.role,
    subtype: toBoundedDiagnosticString(input.subtype),
    evidenceKind: input.evidenceKind,
    renderCount: toFiniteDiagnosticNumber(input.renderCount),
    isStreaming: Boolean(input.isStreaming),
    textLength: toFiniteDiagnosticNumber(input.textLength),
  });
}

export function appendEventBackpressureDiagnostic(
  input: EventBackpressureDiagnosticInput,
) {
  if (!isPerfDiagnosticCollectionEnabled()) {
    return;
  }
  appendRendererDiagnostic("events.backpressure", {
    surfaceId: toBoundedDiagnosticString(input.surfaceId),
    eventKind: toBoundedDiagnosticString(input.eventKind),
    queueDepth: toFiniteDiagnosticNumber(input.queueDepth),
    droppedCount: toFiniteDiagnosticNumber(input.droppedCount),
    coalescedCount: toFiniteDiagnosticNumber(input.coalescedCount),
    flushCount: toFiniteDiagnosticNumber(input.flushCount),
    lastFlushDurationMs: toFiniteDiagnosticNumber(input.lastFlushDurationMs),
    criticalBypassCount: toFiniteDiagnosticNumber(input.criticalBypassCount),
    deliveredCount: toFiniteDiagnosticNumber(input.deliveredCount),
    rawRetainedCount: toFiniteDiagnosticNumber(input.rawRetainedCount),
    evidenceClass: input.evidenceClass,
  });
}

export function appendListenerOwnerDiagnostic(
  input: ListenerOwnerDiagnosticInput,
) {
  if (!isPerfDiagnosticCollectionEnabled()) {
    return;
  }
  appendRendererDiagnostic("listeners.owner-budget", {
    activeCount: toFiniteDiagnosticNumber(input.activeCount),
    inactiveCount: toFiniteDiagnosticNumber(input.inactiveCount),
    evidenceClass: input.evidenceClass,
  });
}

export function appendMediaOwnerDiagnostic(input: MediaOwnerDiagnosticInput) {
  if (!isPerfDiagnosticCollectionEnabled()) {
    return;
  }
  appendRendererDiagnostic("media.owner-budget", {
    activeCount: toFiniteDiagnosticNumber(input.activeCount),
    revokedCount: toFiniteDiagnosticNumber(input.revokedCount),
    retainedBytes: toFiniteDiagnosticNumber(input.retainedBytes),
    unsupportedReason: toBoundedDiagnosticString(input.unsupportedReason),
    evidenceClass: input.evidenceClass,
  });
}

export function appendMarkdownPrecomputeDiagnostic(
  input: MarkdownPrecomputeDiagnosticInput,
) {
  if (!isPerfDiagnosticCollectionEnabled()) {
    return;
  }
  appendRendererDiagnostic("perf.messages.markdown.precompute", {
    mode: input.mode,
    durationMs: toFiniteDiagnosticNumber(input.durationMs),
    contentLength: toFiniteDiagnosticNumber(input.contentLength),
    contentHash: toBoundedDiagnosticString(input.contentHash),
    thresholdReason: toBoundedDiagnosticString(input.thresholdReason),
    cacheState: toBoundedDiagnosticString(input.cacheState),
    fallbackReason: toBoundedDiagnosticString(input.fallbackReason),
    evidenceClass: input.evidenceClass,
    heavyCategoryCounts: toBoundedDiagnosticCountRecord(
      input.heavyCategoryCounts,
    ),
    totalHeadings: toFiniteDiagnosticNumber(input.totalHeadings),
    totalHeavyBlocks: toFiniteDiagnosticNumber(input.totalHeavyBlocks),
    totalSourceLines: toFiniteDiagnosticNumber(input.totalSourceLines),
  });
}

export function appendWorkspaceFileListingBudgetDiagnostic(
  input: WorkspaceFileListingBudgetDiagnosticInput,
) {
  if (!isPerfDiagnosticCollectionEnabled()) {
    return;
  }
  appendRendererDiagnostic("workspaces.file.listing-budget", {
    surfaceId: input.surfaceId,
    workspaceId: toBoundedDiagnosticString(input.workspaceId),
    durationMs: toFiniteDiagnosticNumber(input.durationMs),
    returnedEntries: toFiniteDiagnosticNumber(input.returnedEntries),
    payloadBytes: toFiniteDiagnosticNumber(input.payloadBytes),
    cacheState: toBoundedDiagnosticString(input.cacheState),
    scanState: toBoundedDiagnosticString(input.scanState),
    partial: Boolean(input.partial),
    limitHit: Boolean(input.limitHit),
    sourceVersion: toBoundedDiagnosticString(input.sourceVersion),
    requestedPathHash: toBoundedDiagnosticString(input.requestedPathHash),
    evidenceClass: input.evidenceClass,
    fallbackReason: toBoundedDiagnosticString(input.fallbackReason),
  });
}

export function appendRenderSchedulerResourceDiagnostic(
  input: RenderSchedulerResourceDiagnosticInput,
) {
  if (!isPerfDiagnosticCollectionEnabled()) {
    return;
  }
  appendRendererDiagnostic("render-scheduler.resource", {
    surfaceId: toBoundedDiagnosticString(input.surfaceId),
    chunkCount: toFiniteDiagnosticNumber(input.chunkCount),
    yieldCount: toFiniteDiagnosticNumber(input.yieldCount),
    inputPendingYieldCount: toFiniteDiagnosticNumber(
      input.inputPendingYieldCount,
    ),
    budgetMissCount: toFiniteDiagnosticNumber(input.budgetMissCount),
    idleCallbackCount: toFiniteDiagnosticNumber(input.idleCallbackCount),
    timeoutFallbackCount: toFiniteDiagnosticNumber(input.timeoutFallbackCount),
    pendingCallback: Boolean(input.pendingCallback),
    idleCallbackPending: Boolean(input.idleCallbackPending),
    timeoutFallbackPending: Boolean(input.timeoutFallbackPending),
    cancelled: Boolean(input.cancelled),
    evidenceClass: input.evidenceClass,
  });
}

export function stopRendererBlankScreenWatchdog() {
  if (blankWatchdogTimer === null || typeof window === "undefined") {
    blankWatchdogTimer = null;
    return;
  }
  window.clearInterval(blankWatchdogTimer);
  blankWatchdogTimer = null;
}

export function stopRendererHeartbeat() {
  if (
    rendererHeartbeatTimer === null ||
    typeof window === "undefined" ||
    typeof window.clearInterval !== "function"
  ) {
    rendererHeartbeatTimer = null;
    return;
  }
  window.clearInterval(rendererHeartbeatTimer);
  rendererHeartbeatTimer = null;
}

export function startRendererHeartbeat(options: RendererHeartbeatOptions = {}) {
  if (
    typeof window === "undefined" ||
    typeof document === "undefined" ||
    typeof window.setInterval !== "function"
  ) {
    return;
  }
  if (rendererHeartbeatTimer !== null) {
    return;
  }
  const intervalMs = Math.max(
    5_000,
    options.intervalMs ?? DEFAULT_RENDERER_HEARTBEAT_INTERVAL_MS,
  );
  void sendRendererHeartbeat(options);
  rendererHeartbeatTimer = window.setInterval(() => {
    void sendRendererHeartbeat(options);
  }, intervalMs);
}

export function startRendererBlankScreenWatchdog(
  options: BlankScreenWatchdogOptions = {},
) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }
  if (blankWatchdogTimer !== null) {
    return;
  }
  const rootId = options.rootId ?? "root";
  const intervalMs = Math.max(
    250,
    options.intervalMs ?? DEFAULT_BLANK_WATCHDOG_INTERVAL_MS,
  );
  const minConsecutiveSamples = Math.max(
    1,
    options.minConsecutiveSamples ??
      DEFAULT_BLANK_WATCHDOG_MIN_CONSECUTIVE_SAMPLES,
  );
  const maxReports = Math.max(
    1,
    options.maxReports ?? DEFAULT_BLANK_WATCHDOG_MAX_REPORTS,
  );
  blankWatchdogConsecutiveSamples = 0;
  blankWatchdogReports = 0;

  const startDelayMs = Math.max(0, options.startDelayMs ?? 0);
  const startedAt = Date.now();

  blankWatchdogTimer = window.setInterval(() => {
    // The full-screen StartupGate overlay covers everything during cold start
    // so blank-screen detection has no user-facing value; getBoundingClientRect
    // + getComputedStyle inside the check force a synchronous layout that
    // competes with first-paint React commits on WebView2 (Chromium Blink).
    if (startDelayMs > 0 && Date.now() - startedAt < startDelayMs) {
      blankWatchdogConsecutiveSamples = 0;
      return;
    }
    // 隐藏窗口不存在"用户看到白屏"，跳过采样避免后台每 1.5s 两次强制回流
    // （getBoundingClientRect + getComputedStyle），并清零连续计数。
    if (document.visibilityState === "hidden") {
      blankWatchdogConsecutiveSamples = 0;
      return;
    }
    const snapshot = collectRendererBlankScreenSnapshot(rootId);
    if (!isBlankRendererSnapshot(snapshot)) {
      blankWatchdogConsecutiveSamples = 0;
      return;
    }
    blankWatchdogConsecutiveSamples += 1;
    if (
      blankWatchdogConsecutiveSamples < minConsecutiveSamples ||
      blankWatchdogReports >= maxReports
    ) {
      return;
    }
    blankWatchdogReports += 1;
    appendRendererDiagnostic("renderer/blank-screen-suspected", {
      consecutiveSamples: blankWatchdogConsecutiveSamples,
      intervalMs,
      ...snapshot,
    });
  }, intervalMs);
}

export function flushRendererDiagnosticsBuffer() {
  if (
    bufferedEntries.length === 0 &&
    pendingPersistEntries.length === 0 &&
    readEarlyPersistedDiagnostics().length === 0
  ) {
    return;
  }
  if (!isPreloaded()) {
    persistEarlyDiagnostics(bufferedEntries);
    return;
  }
  const nextEntries = mergeIntoPersistedDiagnostics(
    bufferedEntries,
    pendingPersistEntries,
  );
  bufferedEntries = [];
  pendingPersistEntries = [];
  if (diagnosticsPersistTimer !== null) {
    clearTimeout(diagnosticsPersistTimer);
    diagnosticsPersistTimer = null;
  }
  lastDiagnosticsPersistAt = Date.now();
  persistEarlyDiagnostics([]);
  persistDiagnostics(nextEntries);
}

export function installRendererLifecycleDiagnostics() {
  if (
    installed ||
    typeof window === "undefined" ||
    typeof document === "undefined"
  ) {
    return;
  }
  installed = true;

  appendRendererDiagnostic("renderer/install", collectWindowSnapshot());
  startRendererHeartbeat();

  window.addEventListener("focus", () => {
    appendRendererDiagnostic("window/focus", collectWindowSnapshot());
  });

  window.addEventListener("blur", () => {
    appendRendererDiagnostic("window/blur", collectWindowSnapshot());
  });

  document.addEventListener("visibilitychange", () => {
    appendRendererDiagnosticEntry(
      "document/visibilitychange",
      collectWindowSnapshot({
        hidden: document.hidden,
      }),
      document.visibilityState === "hidden",
    );
  });

  window.addEventListener("pageshow", (event) => {
    appendRendererDiagnostic(
      "window/pageshow",
      collectWindowSnapshot({
        persisted: event.persisted,
      }),
    );
  });

  window.addEventListener("pagehide", (event) => {
    appendRendererDiagnosticEntry(
      "window/pagehide",
      collectWindowSnapshot({
        persisted: event.persisted,
      }),
      true,
    );
  });

  window.addEventListener("error", (event) => {
    appendRendererDiagnostic(
      "window/error",
      collectWindowSnapshot({
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: formatUnknown(event.error),
      }),
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    appendRendererDiagnostic(
      "window/unhandledrejection",
      collectWindowSnapshot({
        reason: formatUnknown(event.reason),
      }),
    );
  });

  void import("./perfBaseline")
    .then((module) => {
      module.installPerfBaselineWebVitals();
    })
    .catch((error: unknown) => {
      appendRendererDiagnostic("perf.web-vital/install-failed", {
        error: formatUnknown(error),
      });
    });

  // rAF 掉帧监视器 / longtask 观测 / 交互跟踪:受运行时开关控制,打包版同样可用。
  void import("./perfBaseline/perfDiagnosticsController")
    .then((module) => {
      module.startPerfDiagnosticsIfEnabled();
    })
    .catch((error: unknown) => {
      appendRendererDiagnostic("perf.diagnostics/install-failed", {
        error: formatUnknown(error),
      });
    });
}
