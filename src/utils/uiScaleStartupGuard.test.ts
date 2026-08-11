// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmUiScaleHealthy,
  markUiScalePending,
  readUiScaleStartupGuardRecord,
  resetUiScaleStartupGuardForTests,
  shouldForceUiScaleIdentity,
} from "./uiScaleStartupGuard";

const STORAGE_KEY = "doge.uiScaleStartupGuard.v1";

function flushRaf() {
  vi.runAllTimers();
}

describe("uiScaleStartupGuard", () => {
  const originalRaf = window.requestAnimationFrame;

  beforeEach(() => {
    vi.useFakeTimers();
    // Route rAF through the fake timer queue so advanceTimersByTime flushes it.
    window.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0)) as typeof window.requestAnimationFrame;
    resetUiScaleStartupGuardForTests();
    window.localStorage.clear();
  });

  afterEach(() => {
    resetUiScaleStartupGuardForTests();
    window.requestAnimationFrame = originalRaf;
    vi.useRealTimers();
  });

  it("starts clear: no pending record, no forced identity", () => {
    expect(shouldForceUiScaleIdentity()).toBe(false);
    expect(readUiScaleStartupGuardRecord()).toBeNull();
  });

  it("markUiScalePending writes a record and forces identity on next launch", () => {
    markUiScalePending(0.9);
    expect(shouldForceUiScaleIdentity()).toBe(true);
    expect(readUiScaleStartupGuardRecord()?.scale).toBe(0.9);
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('"scale":0.9');
  });

  it("healthy confirm clears the record after the delay + one painted frame", () => {
    markUiScalePending(1.2);
    vi.advanceTimersByTime(8_000);
    flushRaf();
    expect(shouldForceUiScaleIdentity()).toBe(false);
    expect(readUiScaleStartupGuardRecord()).toBeNull();
  });

  it("record survives when no healthy confirm ever runs (renderer froze)", () => {
    markUiScalePending(0.8);
    // Simulate freeze: no timers advance, session ends, next launch reads storage.
    resetUiScaleStartupGuardForTests(); // clears in-memory timer + record…
    // …so re-seed exactly what a frozen session would leave on disk:
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ scale: 0.8, markedAt: Date.now() }),
    );
    expect(shouldForceUiScaleIdentity()).toBe(true);
  });

  it("confirmUiScaleHealthy clears immediately (scale 1 applied)", () => {
    markUiScalePending(1.1);
    confirmUiScaleHealthy();
    expect(shouldForceUiScaleIdentity()).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("clean pagehide before the healthy delay clears the record (no false positive)", () => {
    markUiScalePending(1.3);
    window.dispatchEvent(new Event("pagehide"));
    expect(shouldForceUiScaleIdentity()).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("re-marking reschedules the healthy confirm (latest scale wins)", () => {
    markUiScalePending(1.2);
    vi.advanceTimersByTime(4_000);
    markUiScalePending(1.4);
    expect(readUiScaleStartupGuardRecord()?.scale).toBe(1.4);
    vi.advanceTimersByTime(8_000);
    flushRaf();
    expect(shouldForceUiScaleIdentity()).toBe(false);
  });

  it("ignores malformed stored records", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(shouldForceUiScaleIdentity()).toBe(false);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ scale: "x" }));
    expect(shouldForceUiScaleIdentity()).toBe(false);
  });
});
