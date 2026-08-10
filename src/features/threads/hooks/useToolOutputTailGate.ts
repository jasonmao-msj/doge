// 2026-06-24-harden-realtime-interaction-jank-during-tool-call
// Append-buffer + throttle gate for tool output (commandExecution / fileChange).
// Preserves full content (no last-write-replace) while bounding the dispatch
// rate to <= 32 Hz and capping per-key buffer at 1 MiB.
//
// This is a pure-function helper (no React hooks) so it can be called from
// any reducer path, worker, or test. The companion hook
// `useToolOutputTailGateController` wires the global flush scheduler.

import { isToolOutputTailGateEnabled } from "../utils/realtimePerfFlags";
import { readStreamingScheduleTier } from "../utils/realtimePerfFlags";

export type ToolOutputKind = "commandExecution" | "fileChange";

export type ToolOutputKey = string;

export function buildToolOutputKey(
  workspaceId: string,
  itemId: string,
  kind: ToolOutputKind,
): ToolOutputKey {
  return `${workspaceId}\0${itemId}\0${kind}`;
}

export type ToolOutputDiagnostics = {
  gateSaturationCount: number;
  droppedDeltaCount: number;
  lastFlushDurationMs: number;
  bufferOverflowCount: number;
  activeKeys: number;
  flushCount: number;
  throttledCount: number;
};

type GateEntry = {
  buffer: string;
  windowStartedAtMs: number;
  windowCount: number;
  backpressure: boolean;
  lastSubmitAtMs: number;
  lastFlushAtMs: number;
  pendingFlush: ReturnType<typeof setTimeout> | null;
  bufferBytes: number;
};

const MAX_BUFFER_BYTES = 1024 * 1024; // 1 MiB
const RATE_WINDOW_MS = 60_000;
const BACKPRESSURE_AFTER_DELTAS = 256;
export const TOOL_OUTPUT_TAIL_GATE_IDLE_TTL_MS = 120_000;
export const TOOL_OUTPUT_TAIL_GATE_MAX_ACTIVE_KEYS = 512;
// Tier-aware throttle: aggressive 16ms / guarded 32ms / baseline = no gate
// (baseline bypasses this helper entirely via isToolOutputTailGateEnabled).
const DEFAULT_THROTTLE_MS = 32;
const AGGRESSIVE_THROTTLE_MS = 16;

function resolveThrottleMs(): number {
  return readStreamingScheduleTier() === "aggressive"
    ? AGGRESSIVE_THROTTLE_MS
    : DEFAULT_THROTTLE_MS;
}

export type ToolOutputFlushHandler = (key: ToolOutputKey, fullText: string) => void;

export type ToolOutputTailGateOptions = {
  flushHandler: ToolOutputFlushHandler;
  /** Override for test environments. */
  now?: () => number;
  /** Override setTimeout for test environments. */
  setTimeoutFn?: typeof setTimeout;
  /** Override clearTimeout for test environments. */
  clearTimeoutFn?: typeof clearTimeout;
  /** Called when a gate entry is evicted or reset so side metadata can be released. */
  onEntryEvicted?: (key: ToolOutputKey) => void;
};

export type ToolOutputTailGate = {
  submit: (key: ToolOutputKey, delta: string) => boolean;
  /** Force-flush a single key. Returns the buffered text (or null). */
  flush: (key: ToolOutputKey) => string | null;
  /** Force-flush every active key. */
  flushAll: () => void;
  /** Clear an entry (e.g. on item completed/cancelled). */
  reset: (key: ToolOutputKey) => void;
  /** Diagnostics surface for tests. */
  __getDiagnosticsForTests: () => ToolOutputDiagnostics;
};

function defaultNow() {
  return Date.now();
}

export function createToolOutputTailGate(
  options: ToolOutputTailGateOptions,
): ToolOutputTailGate {
  const entries = new Map<ToolOutputKey, GateEntry>();
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const now = options.now ?? defaultNow;

  let gateSaturationCount = 0;
  const droppedDeltaCount = 0;
  let lastFlushDurationMs = 0;
  let bufferOverflowCount = 0;
  let flushCount = 0;
  let throttledCount = 0;

  const flushKey = (key: ToolOutputKey): string | null => {
    const entry = entries.get(key);
    if (!entry || entry.buffer.length === 0) {
      return null;
    }
    const startedAt = now();
    const text = entry.buffer;
    if (entry.pendingFlush) {
      clearTimeoutFn(entry.pendingFlush);
      entry.pendingFlush = null;
    }
    entry.buffer = "";
    entry.bufferBytes = 0;
    entry.lastFlushAtMs = now();
    lastFlushDurationMs = Math.max(0, now() - startedAt);
    flushCount += 1;
    try {
      options.flushHandler(key, text);
    } catch {
      // Swallow handler errors; gate must not throw into reducer path.
    }
    return text;
  };

  const evictEntry = (key: ToolOutputKey, flushBuffered: boolean) => {
    const entry = entries.get(key);
    if (!entry) {
      return;
    }
    if (flushBuffered && entry.buffer.length > 0) {
      flushKey(key);
    }
    const current = entries.get(key);
    if (current?.pendingFlush) {
      clearTimeoutFn(current.pendingFlush);
    }
    entries.delete(key);
    options.onEntryEvicted?.(key);
  };

  const pruneEntries = (referenceNow: number) => {
    for (const [key, entry] of entries) {
      const idleForMs = referenceNow - entry.lastSubmitAtMs;
      if (
        entry.buffer.length === 0 &&
        entry.pendingFlush === null &&
        idleForMs > TOOL_OUTPUT_TAIL_GATE_IDLE_TTL_MS
      ) {
        evictEntry(key, false);
      }
    }
    if (entries.size <= TOOL_OUTPUT_TAIL_GATE_MAX_ACTIVE_KEYS) {
      return;
    }
    const oldestKeys = [...entries.entries()]
      .sort(([, left], [, right]) => left.lastSubmitAtMs - right.lastSubmitAtMs)
      .map(([key]) => key);
    for (const key of oldestKeys) {
      if (entries.size <= TOOL_OUTPUT_TAIL_GATE_MAX_ACTIVE_KEYS) {
        break;
      }
      evictEntry(key, true);
    }
  };

  const scheduleKey = (key: ToolOutputKey) => {
    const entry = entries.get(key);
    if (!entry) {
      return;
    }
    if (entry.pendingFlush) {
      return;
    }
    const throttleMs = resolveThrottleMs();
    const due = Math.max(0, throttleMs - (now() - entry.lastSubmitAtMs));
    entry.pendingFlush = setTimeoutFn(() => {
      entry.pendingFlush = null;
      flushKey(key);
    }, due);
  };

  const submit = (key: ToolOutputKey, delta: string): boolean => {
    if (!isToolOutputTailGateEnabled()) {
      // Bypass: handler still called synchronously with the raw delta so
      // `doge.perf.toolOutputTailGate = "off"` keeps existing UX parity.
      options.flushHandler(key, delta);
      return true;
    }
    const submittedAt = now();
    pruneEntries(submittedAt);
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        buffer: "",
        windowStartedAtMs: submittedAt,
        windowCount: 0,
        backpressure: false,
        lastSubmitAtMs: submittedAt,
        lastFlushAtMs: 0,
        pendingFlush: null,
        bufferBytes: 0,
      };
      entries.set(key, entry);
      pruneEntries(submittedAt);
    }
    if (submittedAt - entry.windowStartedAtMs > RATE_WINDOW_MS) {
      entry.windowStartedAtMs = submittedAt;
      entry.windowCount = 0;
      entry.backpressure = false;
    }
    entry.windowCount += 1;
    entry.lastSubmitAtMs = submittedAt;
    if (!entry.backpressure && entry.windowCount <= BACKPRESSURE_AFTER_DELTAS) {
      options.flushHandler(key, delta);
      return true;
    }
    if (!entry.backpressure) {
      entry.backpressure = true;
      gateSaturationCount += 1;
    }
    entry.buffer += delta;
    entry.bufferBytes += delta.length;

    if (entry.bufferBytes > MAX_BUFFER_BYTES) {
      bufferOverflowCount += 1;
      // Hard flush to avoid OOM. User-visible: 1MB+ of tool output flushed
      // immediately, then the next delta starts a fresh buffer.
      flushKey(key);
      return true;
    }

    const throttleMs = resolveThrottleMs();
    if (now() - entry.lastFlushAtMs < throttleMs) {
      throttledCount += 1;
    }
    scheduleKey(key);
    return true;
  };

  const flush = (key: ToolOutputKey) => flushKey(key);

  const flushAll = () => {
    for (const key of [...entries.keys()]) {
      flushKey(key);
    }
  };

  const reset = (key: ToolOutputKey) => {
    evictEntry(key, false);
  };

  return {
    submit,
    flush,
    flushAll,
    reset,
    __getDiagnosticsForTests: () => ({
      gateSaturationCount,
      droppedDeltaCount,
      lastFlushDurationMs,
      bufferOverflowCount,
      activeKeys: entries.size,
      flushCount,
      throttledCount,
    }),
  };
}

/**
 * Module-level singleton for the default flush path. Consumers that want
 * isolation can call `createToolOutputTailGate` instead. The singleton uses
 * a no-op default handler; production code should call
 * `installToolOutputTailGateHandler` during bootstrap.
 */
let installedHandler: ToolOutputFlushHandler | null = null;

export function installToolOutputTailGateHandler(
  handler: ToolOutputFlushHandler,
) {
  installedHandler = handler;
}

export function uninstallToolOutputTailGateHandler() {
  installedHandler = null;
}

export const defaultToolOutputTailGate = createToolOutputTailGate({
  flushHandler: (key, fullText) => {
    installedHandler?.(key, fullText);
  },
});
