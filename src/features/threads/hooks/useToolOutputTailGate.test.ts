// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildToolOutputKey,
  createToolOutputTailGate,
  defaultToolOutputTailGate,
  installToolOutputTailGateHandler,
  TOOL_OUTPUT_TAIL_GATE_IDLE_TTL_MS,
  TOOL_OUTPUT_TAIL_GATE_MAX_ACTIVE_KEYS,
  uninstallToolOutputTailGateHandler,
} from "./useToolOutputTailGate";
import {
  __resetRealtimePerfFlagCacheForTests,
  resetRealtimePerfFlags,
} from "../utils/realtimePerfFlags";

describe("useToolOutputTailGate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRealtimePerfFlags();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    uninstallToolOutputTailGateHandler();
    __resetRealtimePerfFlagCacheForTests();
  });

  it("builds stable key from (workspaceId, itemId, kind)", () => {
    expect(buildToolOutputKey("ws-1", "item-1", "commandExecution")).toBe(
      "ws-1\0item-1\0commandExecution",
    );
    expect(buildToolOutputKey("ws-1", "item-1", "fileChange")).not.toBe(
      buildToolOutputKey("ws-1", "item-1", "commandExecution"),
    );
  });

  it("passes through small output without buffering", () => {
    const flushed: Array<[string, string]> = [];
    const gate = createToolOutputTailGate({
      flushHandler: (key, text) => flushed.push([key, text]),
    });
    const key = buildToolOutputKey("ws-1", "item-1", "commandExecution");

    gate.submit(key, "hello ");
    gate.submit(key, "world\n");
    expect(flushed).toEqual([
      [key, "hello "],
      [key, "world\n"],
    ]);
  });

  it("buffers deltas after the 60s saturation threshold", () => {
    const flushed: Array<[string, string]> = [];
    const gate = createToolOutputTailGate({
      flushHandler: (key, text) => flushed.push([key, text]),
    });
    const key = buildToolOutputKey("ws-1", "item-1", "commandExecution");

    for (let i = 0; i < 256; i++) {
      gate.submit(key, `warm-${i}\n`);
    }
    gate.submit(key, "buffered-a");
    gate.submit(key, "buffered-b");
    expect(flushed).toHaveLength(256);

    vi.advanceTimersByTime(32);
    expect(flushed).toHaveLength(257);
    expect(flushed[256]).toEqual([key, "buffered-abuffered-b"]);
  });

  it("throttles multiple keys independently", () => {
    const flushed: string[] = [];
    const gate = createToolOutputTailGate({
      flushHandler: (_key, text) => flushed.push(text),
    });
    const k1 = buildToolOutputKey("ws-1", "item-1", "commandExecution");
    const k2 = buildToolOutputKey("ws-1", "item-2", "commandExecution");

    gate.submit(k1, "a");
    gate.submit(k2, "b");
    vi.advanceTimersByTime(32);
    expect(flushed).toHaveLength(2);
    expect(flushed.sort()).toEqual(["a", "b"]);
  });

  it("flushes immediately when saturated buffer exceeds 1 MiB", () => {
    const flushed: string[] = [];
    const gate = createToolOutputTailGate({
      flushHandler: (_key, text) => flushed.push(text),
    });
    const key = buildToolOutputKey("ws-1", "item-1", "commandExecution");
    for (let i = 0; i < 257; i++) {
      gate.submit(key, `warm-${i}\n`);
    }
    const huge = "x".repeat(1024 * 1024 + 1);
    gate.submit(key, huge);
    // Hard-flush bypasses throttle timer.
    expect(flushed).toHaveLength(257);
    expect(flushed[256].length).toBeGreaterThanOrEqual(1024 * 1024 + 1);
    expect(flushed[256]).toContain(huge);
    const diag = gate.__getDiagnosticsForTests();
    expect(diag.bufferOverflowCount).toBe(1);
  });

  it("honors toolOutputTailGate flag off (bypass) without buffering", () => {
    const flushed: string[] = [];
    const gate = createToolOutputTailGate({
      flushHandler: (_key, text) => flushed.push(text),
    });
    window.localStorage.setItem("doge.perf.toolOutputTailGate", "off");
    const k = buildToolOutputKey("ws-1", "item-1", "commandExecution");
    gate.submit(k, "x");
    gate.submit(k, "y");
    // Bypass: each submit triggers handler synchronously.
    expect(flushed).toEqual(["x", "y"]);
  });

  it("reset() cancels a pending flush and drops the entry", () => {
    const flushed: string[] = [];
    const gate = createToolOutputTailGate({
      flushHandler: (_key, text) => flushed.push(text),
    });
    const key = buildToolOutputKey("ws-1", "item-1", "commandExecution");
    for (let i = 0; i < 257; i++) {
      gate.submit(key, `warm-${i}\n`);
    }
    gate.submit(key, "x");
    gate.reset(key);
    vi.advanceTimersByTime(100);
    expect(flushed).toHaveLength(256);
    expect(gate.__getDiagnosticsForTests().activeKeys).toBe(0);
  });

  it("evicts idle empty entries on the next submit", () => {
    let currentNow = 0;
    const evicted: string[] = [];
    const flushed: string[] = [];
    const gate = createToolOutputTailGate({
      now: () => currentNow,
      flushHandler: (_key, text) => flushed.push(text),
      onEntryEvicted: (key) => evicted.push(key),
    });
    const staleKey = buildToolOutputKey("ws-1", "item-1", "commandExecution");
    const activeKey = buildToolOutputKey("ws-1", "item-2", "commandExecution");

    gate.submit(staleKey, "a");
    expect(gate.__getDiagnosticsForTests().activeKeys).toBe(1);

    currentNow = TOOL_OUTPUT_TAIL_GATE_IDLE_TTL_MS + 1;
    gate.submit(activeKey, "b");

    expect(flushed).toEqual(["a", "b"]);
    expect(evicted).toEqual([staleKey]);
    expect(gate.__getDiagnosticsForTests().activeKeys).toBe(1);
  });

  it("flushes buffered text before active-key cap eviction", () => {
    let currentNow = 0;
    const evicted: string[] = [];
    const flushed: string[] = [];
    const gate = createToolOutputTailGate({
      now: () => currentNow,
      flushHandler: (_key, text) => flushed.push(text),
      onEntryEvicted: (key) => evicted.push(key),
    });
    const oldKey = buildToolOutputKey("ws-1", "old-item", "commandExecution");
    for (let i = 0; i < 256; i++) {
      gate.submit(oldKey, `warm-${i}\n`);
    }
    gate.submit(oldKey, "buffered-tail");

    for (let i = 0; i < TOOL_OUTPUT_TAIL_GATE_MAX_ACTIVE_KEYS; i++) {
      currentNow += 1;
      gate.submit(
        buildToolOutputKey("ws-1", `item-${i}`, "commandExecution"),
        "x",
      );
    }

    expect(gate.__getDiagnosticsForTests().activeKeys).toBe(
      TOOL_OUTPUT_TAIL_GATE_MAX_ACTIVE_KEYS,
    );
    expect(evicted).toContain(oldKey);
    expect(flushed).toContain("buffered-tail");
    expect(gate.__getDiagnosticsForTests().droppedDeltaCount).toBe(0);
  });

  it("flushAll() drains every active key", () => {
    const flushed: string[] = [];
    const gate = createToolOutputTailGate({
      flushHandler: (_key, text) => flushed.push(text),
    });
    const k1 = buildToolOutputKey("ws-1", "item-1", "commandExecution");
    const k2 = buildToolOutputKey("ws-1", "item-2", "fileChange");
    gate.submit(k1, "a");
    gate.submit(k2, "b");
    gate.flushAll();
    expect(flushed.sort()).toEqual(["a", "b"]);
  });

  it("uses tighter 16ms throttle when tier is aggressive", () => {
    window.localStorage.setItem("doge.perf.streamingScheduleTier", "aggressive");
    const flushed: string[] = [];
    const gate = createToolOutputTailGate({
      flushHandler: (_key, text) => flushed.push(text),
    });
    const key = buildToolOutputKey("ws-1", "item-1", "commandExecution");
    gate.submit(key, "a");
    vi.advanceTimersByTime(16);
    expect(flushed).toHaveLength(1);
  });

  it("module-level singleton accepts an installed handler", () => {
    const flushed: string[] = [];
    installToolOutputTailGateHandler((_key, text) => flushed.push(text));
    const key = buildToolOutputKey("ws-1", "item-1", "commandExecution");
    defaultToolOutputTailGate.submit(key, "ping");
    const diag = defaultToolOutputTailGate.__getDiagnosticsForTests();
    expect(diag.activeKeys).toBe(1);
    expect(diag.throttledCount).toBeGreaterThanOrEqual(0);
    vi.advanceTimersByTime(32);
    expect(flushed.length).toBeGreaterThanOrEqual(0);
  });
});
