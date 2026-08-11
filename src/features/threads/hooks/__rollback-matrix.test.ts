// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRealtimePerfFlagCacheForTests,
  resetRealtimePerfFlags,
} from "../utils/realtimePerfFlags";
import {
  buildToolOutputKey,
  createToolOutputTailGate,
} from "./useToolOutputTailGate";
import { RENDER_TIER_FLAG_KEY } from "../utils/renderSchedulingPolicy";
import { TOOL_OUTPUT_TAIL_GATE_FLAG_KEY } from "../utils/realtimePerfFlags";

describe("§11.3 rollback matrix", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetRealtimePerfFlags();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.localStorage.clear();
    __resetRealtimePerfFlagCacheForTests();
  });

  it("path 1: baseline tier bypasses tail gate and submits every delta directly", () => {
    window.localStorage.setItem(RENDER_TIER_FLAG_KEY, "baseline");
    const flushed: Array<[string, string]> = [];
    const gateBaseline = createToolOutputTailGate({
      flushHandler: (k, t) => flushed.push([k, t]),
    });
    const key1 = buildToolOutputKey("ws-1", "b-item", "commandExecution");
    for (let i = 0; i < 50; i++) {
      gateBaseline.submit(key1, `b-${i}\n`);
    }
    const baselineDiag = gateBaseline.__getDiagnosticsForTests();
    expect(flushed).toHaveLength(50);
    expect(baselineDiag.gateSaturationCount).toBe(0);
    expect(baselineDiag.activeKeys).toBe(0);
  });

  it("path 2: toolOutputTailGate=off -> handler called 1 per delta (1024 deltas -> 1024 flushes)", () => {
    window.localStorage.setItem(TOOL_OUTPUT_TAIL_GATE_FLAG_KEY, "off");
    const flushed: Array<[string, string]> = [];
    const gate = createToolOutputTailGate({
      flushHandler: (k, t) => flushed.push([k, t]),
    });
    const key = buildToolOutputKey("ws-1", "item-1", "commandExecution");
    for (let i = 0; i < 1024; i++) {
      gate.submit(key, `chunk-${i}\n`);
    }
    // off 路径: submit 同步调 handler,每次 1 flush
    expect(flushed.length).toBe(1024);
  });

  it("path 3: toolOutputTailGate=off + baseline -> fully bypass (regression baseline parity)", () => {
    window.localStorage.setItem(RENDER_TIER_FLAG_KEY, "baseline");
    window.localStorage.setItem(TOOL_OUTPUT_TAIL_GATE_FLAG_KEY, "off");
    const flushed: Array<[string, string]> = [];
    const gate = createToolOutputTailGate({
      flushHandler: (k, t) => flushed.push([k, t]),
    });
    const key = buildToolOutputKey("ws-1", "item-1", "commandExecution");
    for (let i = 0; i < 100; i++) {
      gate.submit(key, `delta-${i}\n`);
    }
    expect(flushed.length).toBe(100);
    // 全部同步 flush,无 buffer
    const diag = gate.__getDiagnosticsForTests();
    expect(diag.activeKeys).toBe(0);
  });

  it("path 4: aggressive tier coalesces 2048 deltas into < 2048 flushes", () => {
    window.localStorage.setItem(RENDER_TIER_FLAG_KEY, "aggressive");
    const flushed: Array<[string, string]> = [];
    const gate = createToolOutputTailGate({
      flushHandler: (k, t) => flushed.push([k, t]),
    });
    const key = buildToolOutputKey("ws-1", "item-1", "commandExecution");
    // aggressive 16ms 间隔;submit 期间 fakeTimers 不前进,所有 delta 被 buffer
    for (let i = 0; i < 2048; i++) {
      gate.submit(key, `delta-${i}\n`);
    }
    // 前 256 条保持实时直送;超过 256 后才进入 append-buffer backpressure。
    expect(flushed.length).toBe(256);
    // 推进 16ms -> 触发一次 flush
    vi.advanceTimersByTime(16);
    expect(flushed.length).toBe(257);
    // 2048 条里 256 条直送,剩余 1792 条被合成 1 次 flush。
    expect(flushed[256][1].length).toBeGreaterThan(1792 * 5);
  });
});


describe("§11.3 path 4: appServerEventBatch=off", () => {
  beforeEach(() => {
    resetRealtimePerfFlags();
  });
  afterEach(() => {
    window.localStorage.clear();
    __resetRealtimePerfFlagCacheForTests();
  });

  it("flag off makes webview batch consumer return false (no batch subscription)", async () => {
    // §11.3 path 4: when appServerEventBatch=off, webview 端 batch consumer 不生效,
    // 走 v1 single-event dispatch path. 直接验证 flag reader 行为.
    const { isAppServerEventBatchConsumerEnabled } = await import(
      "../utils/realtimePerfFlags"
    );
    // test mode 下 default = false
    expect(isAppServerEventBatchConsumerEnabled()).toBe(false);
    window.localStorage.setItem("doge.perf.appServerEventBatch", "on");
    expect(isAppServerEventBatchConsumerEnabled()).toBe(true);
    window.localStorage.setItem("doge.perf.appServerEventBatch", "off");
    expect(isAppServerEventBatchConsumerEnabled()).toBe(false);
  });
});
