// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("startup perf markers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("NODE_ENV", "development");
  });

  it("stays disabled unless perf baseline collection is enabled", async () => {
    const markers = await import("./startupMarkers");

    expect(markers.recordStartupPerfMarker("first-paint")).toBeNull();
    expect(window.__DOGE_STARTUP_PERF__).toBeUndefined();
  });

  it("records bounded content-safe startup markers once", async () => {
    vi.stubEnv("VITE_ENABLE_PERF_BASELINE", "1");
    const markSpy = vi.spyOn(performance, "mark");
    const markers = await import("./startupMarkers");

    markers.resetStartupPerfMarkersForTests();
    const firstPaint = markers.recordStartupPerfMarker("first-paint");
    const duplicate = markers.recordStartupPerfMarker("first-paint");
    const firstInteractive = markers.recordStartupPerfMarker("first-interactive");

    expect(firstPaint).toEqual(expect.objectContaining({ name: "first-paint" }));
    expect(duplicate).toBe(firstPaint);
    expect(firstInteractive).toEqual(expect.objectContaining({ name: "first-interactive" }));
    expect(window.__DOGE_STARTUP_PERF__).toEqual({
      schemaVersion: "1.0",
      source: "startup-perf-markers",
      platform: expect.any(String),
      markers: [
        expect.objectContaining({ name: "first-paint", atMs: expect.any(Number) }),
        expect.objectContaining({ name: "first-interactive", atMs: expect.any(Number) }),
      ],
    });
    expect(markSpy).toHaveBeenCalledWith("doge:first-paint");
    expect(markSpy).toHaveBeenCalledWith("doge:first-interactive");

    markSpy.mockRestore();
  });
});
