// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetRealtimePerfFlagCacheForTests,
  getActiveRealtimePerfFlags,
  isBackgroundBufferedFlushEnabled,
  isBackgroundRenderGatingEnabled,
  isRealtimeBatchingEnabled,
  resetRealtimePerfFlags,
  isStagedHydrationEnabled,
} from "./realtimePerfFlags";

describe("realtimePerfFlags background scheduling rollback flags", () => {
  afterEach(() => {
    window.localStorage.clear();
    __resetRealtimePerfFlagCacheForTests();
  });

  it("enables background scheduling layers by default", () => {
    expect(isBackgroundRenderGatingEnabled()).toBe(true);
    expect(isBackgroundBufferedFlushEnabled()).toBe(true);
    expect(isStagedHydrationEnabled()).toBe(true);
  });

  it("allows each background scheduling layer to be disabled independently", () => {
    window.localStorage.setItem("doge.perf.backgroundRenderGating", "off");
    window.localStorage.setItem("doge.perf.backgroundBufferedFlush", "false");
    window.localStorage.setItem("doge.perf.stagedHydration", "0");

    expect(isBackgroundRenderGatingEnabled()).toBe(false);
    expect(isBackgroundBufferedFlushEnabled()).toBe(false);
    expect(isStagedHydrationEnabled()).toBe(false);
  });

  it("reports all active flag values with source metadata", () => {
    window.localStorage.setItem("doge.perf.realtimeBatching", "0");

    const flags = getActiveRealtimePerfFlags();

    expect(Object.keys(flags)).toHaveLength(9);
    expect(flags.realtimeBatching.value).toBe(false);
    expect(flags.realtimeBatching.source).toBe("localStorage");
    expect(flags.realtimeBatching.storageKey).toBe("doge.perf.realtimeBatching");
    expect(flags.appServerEventBatch.source).toBe("default");
    expect(flags.appServerEventBatch.defaultValue).toBe(true);
    expect(flags.appServerEventBatch.testDefaultValue).toBe(false);
    expect(flags.reducerNoopGuard.metric).toContain("no-op");
    expect(flags.liveTextExternalization.defaultValue).toBe(true);
    expect(flags.liveTextExternalization.testDefaultValue).toBe(false);
  });

  it("resets known localStorage overrides and clears the cache", () => {
    window.localStorage.setItem("doge.perf.realtimeBatching", "0");
    window.localStorage.setItem("doge.perf.backgroundRenderGating", "off");

    expect(isRealtimeBatchingEnabled()).toBe(false);
    expect(isBackgroundRenderGatingEnabled()).toBe(false);

    const removed = resetRealtimePerfFlags();

    expect(removed).toEqual([
      "doge.perf.realtimeBatching",
      "doge.perf.backgroundRenderGating",
    ]);
    expect(window.localStorage.getItem("doge.perf.realtimeBatching")).toBeNull();
    expect(window.localStorage.getItem("doge.perf.backgroundRenderGating")).toBeNull();
    expect(isRealtimeBatchingEnabled()).toBe(false);
    expect(isBackgroundRenderGatingEnabled()).toBe(true);
  });
});
