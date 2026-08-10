import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientStorageMocks = vi.hoisted(() => ({
  getClientStoreSync: vi.fn(),
  isPreloaded: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

vi.mock("./clientStorage", () => clientStorageMocks);

const EARLY_RENDERER_DIAGNOSTICS_STORAGE_KEY =
  "doge.bootstrapRendererDiagnostics";
const testLocalStorage = globalThis.localStorage;

function installLifecycleEventTargets(visibilityState = "visible") {
  const windowTarget = Object.assign(new EventTarget(), {
    location: { href: "tauri://localhost" },
  });
  const documentTarget = Object.assign(new EventTarget(), {
    visibilityState,
    readyState: "complete",
    hidden: visibilityState === "hidden",
    hasFocus: () => true,
  });
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);
  return { windowTarget, documentTarget };
}

describe("rendererDiagnostics", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.unstubAllGlobals();
    if (typeof document !== "undefined") {
      document.body.innerHTML = "";
    }
    testLocalStorage.clear();
    clientStorageMocks.getClientStoreSync.mockReset();
    clientStorageMocks.isPreloaded.mockReset();
    clientStorageMocks.writeClientStoreValue.mockReset();
  });

  afterEach(async () => {
    await vi.dynamicImportSettled();
    const diagnostics = await import("./rendererDiagnostics");
    diagnostics.stopRendererBlankScreenWatchdog();
    diagnostics.stopRendererHeartbeat();
    // 冲刷 pending buffer，避免节流 timer 泄漏到后续用例。
    diagnostics.flushRendererDiagnosticsBuffer();
    vi.useRealTimers();
  });

  it("buffers diagnostics until client stores are preloaded", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(false);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendRendererDiagnostic("window/focus", { hasFocus: true });
    expect(clientStorageMocks.writeClientStoreValue).not.toHaveBeenCalled();

    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);

    diagnostics.flushRendererDiagnosticsBuffer();

    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenCalledWith(
      "diagnostics",
      "diagnostics.rendererLifecycleLog",
      [
        expect.objectContaining({
          label: "window/focus",
          payload: { hasFocus: true },
        }),
      ],
    );
  });

  it("batches rapid diagnostic appends behind the 30s durable window", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendRendererDiagnostic("burst/first");
    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenCalledTimes(1);

    diagnostics.appendRendererDiagnostic("burst/second");
    diagnostics.appendRendererDiagnostic("burst/third");
    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2_000);
    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(28_000);
    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenCalledTimes(2);
    const [, , persistedEntries] =
      clientStorageMocks.writeClientStoreValue.mock.calls[1] ?? [];
    const labels = (persistedEntries as Array<{ label: string }>).map(
      (entry) => entry.label,
    );
    expect(labels).toContain("burst/second");
    expect(labels).toContain("burst/third");
  });

  it("reads persisted history once and incrementally flushes later entries", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([
      {
        timestamp: 1,
        label: "persisted/entry",
        payload: { count: 1 },
      },
    ]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendRendererDiagnostic("incremental/first");
    expect(clientStorageMocks.getClientStoreSync).toHaveBeenCalledTimes(2);

    diagnostics.appendRendererDiagnostic("incremental/second");
    vi.advanceTimersByTime(30_000);

    expect(clientStorageMocks.getClientStoreSync).toHaveBeenCalledTimes(2);
    const [, , persistedEntries] =
      clientStorageMocks.writeClientStoreValue.mock.calls.at(-1) ?? [];
    expect(
      (persistedEntries as Array<{ label: string }>).map(
        (entry) => entry.label,
      ),
    ).toEqual(
      expect.arrayContaining([
        "persisted/entry",
        "incremental/first",
        "incremental/second",
      ]),
    );
  });

  it("keeps cleared diagnostics from being resurrected by the canonical cache", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([
      {
        timestamp: 1,
        label: "persisted/old",
        payload: {},
      },
    ]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendRendererDiagnostic("before/clear");
    diagnostics.clearRendererDiagnostics();
    clientStorageMocks.getClientStoreSync.mockClear();
    diagnostics.appendRendererDiagnostic("after/clear");
    diagnostics.flushRendererDiagnosticsBuffer();

    expect(clientStorageMocks.getClientStoreSync).not.toHaveBeenCalled();
    const [, , persistedEntries] =
      clientStorageMocks.writeClientStoreValue.mock.calls.at(-1) ?? [];
    expect(
      (persistedEntries as Array<{ label: string }>).map(
        (entry) => entry.label,
      ),
    ).toEqual(["after/clear"]);
  });

  it("merges pending throttled entries into exported diagnostics", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendRendererDiagnostic("export/persisted");
    diagnostics.appendRendererDiagnostic("export/pending");

    const exported = diagnostics.exportRendererDiagnostics();
    const labels = exported.map((entry) => entry.label);
    expect(labels).toContain("export/pending");
  });

  it("keeps volatile diagnostics exportable without scheduling a durable write", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendVolatileRendererDiagnostic("perf.frame-drop", {
      deltaMs: 72,
      level: "warn",
    });

    expect(clientStorageMocks.writeClientStoreValue).not.toHaveBeenCalled();
    expect(diagnostics.exportRendererDiagnostics()).toEqual([
      expect.objectContaining({
        label: "perf.frame-drop",
        payload: expect.objectContaining({ deltaMs: 72, level: "warn" }),
      }),
    ]);

    diagnostics.clearRendererDiagnostics();
    expect(diagnostics.exportRendererDiagnostics()).toEqual([]);
  });

  it("exposes a cheap diagnostics revision for polling UIs", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    const initialRevision = diagnostics.getRendererDiagnosticsRevision();
    diagnostics.appendRendererDiagnostic("revision/first");
    const afterFirstAppend = diagnostics.getRendererDiagnosticsRevision();
    diagnostics.appendRendererDiagnostic("revision/pending");
    const afterPendingAppend = diagnostics.getRendererDiagnosticsRevision();

    vi.advanceTimersByTime(2_000);
    const afterPersistFlush = diagnostics.getRendererDiagnosticsRevision();
    diagnostics.clearRendererDiagnostics();

    expect(afterFirstAppend).toBe(initialRevision + 1);
    expect(afterPendingAppend).toBe(afterFirstAppend + 1);
    expect(afterPersistFlush).toBe(afterPendingAppend);
    expect(diagnostics.getRendererDiagnosticsRevision()).toBe(
      afterPersistFlush + 1,
    );
  });

  it("persists buffered diagnostics to localStorage before preload completes", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(false);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendRendererDiagnostic("bootstrap/start");
    diagnostics.flushRendererDiagnosticsBuffer();

    expect(clientStorageMocks.writeClientStoreValue).not.toHaveBeenCalled();
    expect(
      JSON.parse(
        testLocalStorage.getItem(EARLY_RENDERER_DIAGNOSTICS_STORAGE_KEY) ??
          "[]",
      ),
    ).toEqual([
      expect.objectContaining({
        label: "bootstrap/start",
      }),
    ]);
  });

  it("merges early persisted diagnostics into the client store after preload", async () => {
    testLocalStorage.setItem(
      EARLY_RENDERER_DIAGNOSTICS_STORAGE_KEY,
      JSON.stringify([
        {
          timestamp: 1,
          label: "bootstrap/failed",
          payload: { error: "Error: preload failed" },
        },
      ]),
    );
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.flushRendererDiagnosticsBuffer();

    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenCalledWith(
      "diagnostics",
      "diagnostics.rendererLifecycleLog",
      [
        expect.objectContaining({
          label: "bootstrap/failed",
          payload: { error: "[redacted]" },
        }),
      ],
    );
    expect(
      testLocalStorage.getItem(EARLY_RENDERER_DIAGNOSTICS_STORAGE_KEY),
    ).toBeNull();
  });

  it("does not seal an incomplete canonical cache when exported before preload", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(false);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendRendererDiagnostic("bootstrap/early");
    expect(
      diagnostics.exportRendererDiagnostics().map((entry) => entry.label),
    ).toContain("bootstrap/early");

    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([
      {
        timestamp: 1,
        label: "persisted/from-disk",
        payload: {},
      },
    ]);
    diagnostics.flushRendererDiagnosticsBuffer();

    const [, , persistedEntries] =
      clientStorageMocks.writeClientStoreValue.mock.calls.at(-1) ?? [];
    expect(
      (persistedEntries as Array<{ label: string }>).map(
        (entry) => entry.label,
      ),
    ).toEqual(
      expect.arrayContaining(["persisted/from-disk", "bootstrap/early"]),
    );
  });

  it("sanitizes and bounds legacy payloads before they are retained", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([
      {
        timestamp: 1,
        label: "window/error",
        payload: {
          error: "private prompt text",
          filename: "/Users/private/project/source.ts",
          token: 123456,
          rawMessageLength: "private prompt disguised as a length",
          contentLength: "private output disguised as a length",
          filenameHash: "private path disguised as a hash",
          reasonCode: "renderer-crash",
          nested: {
            generatedHtml: "<script>private output</script>",
          },
          samples: Array.from({ length: 50 }, (_, index) => index),
        },
      },
    ]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendRendererDiagnostic("window/pageshow", {
      persisted: false,
    });

    const [, , persistedEntries] =
      clientStorageMocks.writeClientStoreValue.mock.calls[0] ?? [];
    const retainedError = (
      persistedEntries as Array<{
        label: string;
        payload: Record<string, unknown>;
      }>
    ).find((entry) => entry.label === "window/error");
    expect(retainedError?.payload).toMatchObject({
      error: "[redacted]",
      filename: "[redacted]",
      token: "[redacted]",
      rawMessageLength: "[redacted]",
      contentLength: "[redacted]",
      filenameHash: "[redacted]",
      reasonCode: "renderer-crash",
      nested: {
        generatedHtml: "[redacted]",
      },
    });
    expect(retainedError?.payload.samples).toHaveLength(41);
    expect(JSON.stringify(retainedError)).not.toContain("private");
    expect(JSON.stringify(retainedError)).not.toContain("<script>");
  });

  it("uses an immediate client-store write for pagehide flushes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { windowTarget } = installLifecycleEventTargets();
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendRendererDiagnostic("lifecycle/persisted");
    diagnostics.appendRendererDiagnostic("lifecycle/pending");
    windowTarget.dispatchEvent(new Event("pagehide"));

    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenLastCalledWith(
      "diagnostics",
      "diagnostics.rendererLifecycleLog",
      [
        expect.objectContaining({ label: "lifecycle/persisted" }),
        expect.objectContaining({ label: "lifecycle/pending" }),
      ],
      { immediate: true },
    );
  });

  it("includes the pagehide lifecycle entry in the immediate write", async () => {
    const { windowTarget } = installLifecycleEventTargets();
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.installRendererLifecycleDiagnostics();
    clientStorageMocks.writeClientStoreValue.mockClear();
    windowTarget.dispatchEvent(new Event("pagehide"));

    const immediateWrites = clientStorageMocks.writeClientStoreValue.mock.calls
      .filter(
        (call) => (call[3] as { immediate?: boolean } | undefined)?.immediate,
      )
      .map((call) => call[2] as Array<{ label: string }>);
    expect(immediateWrites).not.toHaveLength(0);
    expect(
      immediateWrites
        .at(-1)
        ?.some((entry) => entry.label === "window/pagehide"),
    ).toBe(true);
  });

  it("includes the hidden visibility lifecycle entry in the immediate write", async () => {
    const { documentTarget } = installLifecycleEventTargets("hidden");
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.installRendererLifecycleDiagnostics();
    clientStorageMocks.writeClientStoreValue.mockClear();
    documentTarget.dispatchEvent(new Event("visibilitychange"));

    const immediateWrites = clientStorageMocks.writeClientStoreValue.mock.calls
      .filter(
        (call) => (call[3] as { immediate?: boolean } | undefined)?.immediate,
      )
      .map((call) => call[2] as Array<{ label: string }>);
    expect(immediateWrites).not.toHaveLength(0);
    expect(
      immediateWrites
        .at(-1)
        ?.some((entry) => entry.label === "document/visibilitychange"),
    ).toBe(true);
  });

  it("trims persisted diagnostics to the newest 200 entries", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue(
      Array.from({ length: 200 }, (_, index) => ({
        timestamp: index,
        label: `old-${index}`,
        payload: { index },
      })),
    );
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendRendererDiagnostic("window/pageshow", {
      persisted: false,
    });

    const [, , persistedEntries] =
      clientStorageMocks.writeClientStoreValue.mock.calls[0] ?? [];
    expect(Array.isArray(persistedEntries)).toBe(true);
    expect(persistedEntries).toHaveLength(200);
    expect(persistedEntries[0]).toMatchObject({ label: "old-1" });
    expect(persistedEntries[199]).toMatchObject({ label: "window/pageshow" });
  });

  it("keeps perf diagnostics in an independent 1000-entry bucket", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([
      ...Array.from({ length: 200 }, (_, index) => ({
        timestamp: index,
        label: `old-${index}`,
        payload: { index },
      })),
      ...Array.from({ length: 1000 }, (_, index) => ({
        timestamp: 1_000 + index,
        label: "perf.web-vital",
        payload: { index },
      })),
    ]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendRendererPerfDiagnostic("perf.web-vital", { index: 1000 });

    const [, , persistedValue] =
      clientStorageMocks.writeClientStoreValue.mock.calls[0] ?? [];
    expect(Array.isArray(persistedValue)).toBe(true);
    const persistedEntries = persistedValue as Array<{
      label: string;
      payload: { index?: number };
    }>;
    expect(persistedEntries).toHaveLength(1200);
    expect(
      persistedEntries.filter((entry) => entry.label.startsWith("perf.")),
    ).toHaveLength(1000);
    expect(
      persistedEntries.filter((entry) => !entry.label.startsWith("perf.")),
    ).toHaveLength(200);
    expect(
      persistedEntries.some(
        (entry) =>
          entry.payload.index === 0 && entry.label === "perf.web-vital",
      ),
    ).toBe(false);
    expect(
      persistedEntries.some(
        (entry) =>
          entry.payload.index === 1000 && entry.label === "perf.web-vital",
      ),
    ).toBe(true);
  });

  it("caps durable renderer diagnostics by serialized byte size", async () => {
    const largePerfEntries = Array.from({ length: 1_000 }, (_, index) => ({
      timestamp: 1_000 + index,
      label: "perf.frame-drop",
      payload: {
        index,
        samples: Array.from({ length: 40 }, (__, sampleIndex) => ({
          sampleIndex,
          durationMs: 100 + sampleIndex,
        })),
      },
    }));
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([
      {
        timestamp: 1,
        label: "window/error",
        payload: { reasonCode: "renderer-crash" },
      },
      ...largePerfEntries,
    ]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendRendererDiagnostic("window/pageshow", {
      persisted: false,
    });

    const [, , persistedValue] =
      clientStorageMocks.writeClientStoreValue.mock.calls[0] ?? [];
    const serialized = JSON.stringify(persistedValue);
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(
      256 * 1024,
    );
    expect(
      (persistedValue as Array<{ label: string }>).some(
        (entry) => entry.label === "window/error",
      ),
    ).toBe(true);
  });

  it("drops a single normalized diagnostic that exceeds the byte budget", async () => {
    const oversizedPayload = Object.fromEntries(
      Array.from({ length: 40 }, (_, keyIndex) => [
        `metric${keyIndex}`,
        Array.from({ length: 40 }, () => "x".repeat(512)),
      ]),
    );
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([
      {
        timestamp: 1,
        label: "perf.oversized-sample",
        payload: oversizedPayload,
      },
    ]);
    const diagnostics = await import("./rendererDiagnostics");

    const exported = diagnostics.exportRendererDiagnostics();

    expect(
      new TextEncoder().encode(JSON.stringify(exported)).byteLength,
    ).toBeLessThanOrEqual(256 * 1024);
    expect(exported).toEqual([]);
  });

  it("keeps realtime summaries and stream latency diagnostics in independent buckets", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([
      ...Array.from({ length: 200 }, (_, index) => ({
        timestamp: index,
        label: `old-${index}`,
        payload: { index },
      })),
      ...Array.from({ length: 1000 }, (_, index) => ({
        timestamp: 1_000 + index,
        label: "perf.web-vital",
        payload: { index },
      })),
      ...Array.from({ length: 100 }, (_, index) => ({
        timestamp: 2_000 + index,
        label: "realtime.turnTrace.summary",
        payload: { index },
      })),
      ...Array.from({ length: 400 }, (_, index) => ({
        timestamp: 3_000 + index,
        label: "stream-latency/app-server-event",
        payload: { index },
      })),
      ...Array.from({ length: 200 }, (_, index) => ({
        timestamp: 4_000 + index,
        label: "stream-latency/first-visible-render",
        payload: { index },
      })),
    ]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendRendererDiagnostic("realtime.turnTrace.summary", {
      index: 100,
    });

    const [, , persistedValue] =
      clientStorageMocks.writeClientStoreValue.mock.calls[0] ?? [];
    expect(Array.isArray(persistedValue)).toBe(true);
    const persistedEntries = persistedValue as Array<{
      label: string;
      payload: { index?: number };
    }>;
    const regularEntries = persistedEntries.filter(
      (entry) =>
        !entry.label.startsWith("perf.") &&
        !entry.label.startsWith("stream-latency/") &&
        entry.label !== "realtime.turnTrace.summary",
    );
    const perfEntries = persistedEntries.filter((entry) =>
      entry.label.startsWith("perf."),
    );
    const turnSummaryEntries = persistedEntries.filter(
      (entry) => entry.label === "realtime.turnTrace.summary",
    );
    const streamLatencyEntries = persistedEntries.filter((entry) =>
      entry.label.startsWith("stream-latency/"),
    );

    expect(persistedEntries).toHaveLength(1900);
    expect(regularEntries).toHaveLength(200);
    expect(perfEntries).toHaveLength(1000);
    expect(turnSummaryEntries).toHaveLength(100);
    expect(streamLatencyEntries).toHaveLength(600);
    expect(turnSummaryEntries.some((entry) => entry.payload.index === 0)).toBe(
      false,
    );
    expect(
      turnSummaryEntries.some((entry) => entry.payload.index === 100),
    ).toBe(true);
    expect(
      streamLatencyEntries.filter(
        (entry) => entry.label === "stream-latency/app-server-event",
      ),
    ).toHaveLength(400);
    expect(
      streamLatencyEntries.filter(
        (entry) => entry.label === "stream-latency/first-visible-render",
      ),
    ).toHaveLength(200);
  });

  it("reserves an actionable bucket under regular diagnostic pressure", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([
      {
        timestamp: 1,
        label: "window/error",
        payload: { message: "worker failed" },
      },
      ...Array.from({ length: 250 }, (_, index) => ({
        timestamp: 10 + index,
        label: `window/focus-${index}`,
        payload: { index },
      })),
    ]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendRendererDiagnostic("window/pageshow", {
      persisted: false,
    });

    const [, , persistedValue] =
      clientStorageMocks.writeClientStoreValue.mock.calls[0] ?? [];
    const persistedEntries = persistedValue as Array<{ label: string }>;
    expect(
      persistedEntries.some((entry) => entry.label === "window/error"),
    ).toBe(true);
    expect(
      persistedEntries.filter(
        (entry) =>
          entry.label !== "window/error" &&
          !entry.label.startsWith("perf.") &&
          !entry.label.startsWith("stream-latency/"),
      ),
    ).toHaveLength(200);
  });

  it("keeps stream stall evidence when ingress telemetry reaches its cap", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([
      {
        timestamp: 1,
        label: "stream-latency/visible-output-stall-after-first-delta",
        payload: { threadId: "thread-stalled" },
      },
      {
        timestamp: 2,
        label: "stream-latency/first-visible-render",
        payload: { threadId: "thread-first-visible" },
      },
      ...Array.from({ length: 700 }, (_, index) => ({
        timestamp: 10 + index,
        label: "stream-latency/codex-text-ingress",
        payload: { index },
      })),
    ]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendRendererDiagnostic("stream-latency/app-server-event", {
      index: 701,
    });

    const [, , persistedValue] =
      clientStorageMocks.writeClientStoreValue.mock.calls[0] ?? [];
    const persistedEntries = persistedValue as Array<{ label: string }>;
    expect(
      persistedEntries.some(
        (entry) =>
          entry.label ===
          "stream-latency/visible-output-stall-after-first-delta",
      ),
    ).toBe(true);
    expect(
      persistedEntries.some(
        (entry) => entry.label === "stream-latency/first-visible-render",
      ),
    ).toBe(true);
    expect(
      persistedEntries.filter(
        (entry) =>
          entry.label === "stream-latency/codex-text-ingress" ||
          entry.label === "stream-latency/app-server-event",
      ),
    ).toHaveLength(400);
  });

  it("records content-safe client interaction performance diagnostics", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendClientInteractionPerfDiagnostic({
      area: "typing",
      evidenceKind: "proxy",
      workspaceId: "workspace-1",
      threadId: "thread-1",
      engine: "codex",
      turnId: "turn-1",
      inputEventCount: 50,
      renderCount: 3,
      commitDurationMs: 12.5,
      longTaskCount: 0,
      requestCount: 1,
      foregroundLatencyMs: 16,
      hydrationLatencyMs: 44,
      notes: "prompt text and assistant text must not be included",
      // @ts-expect-error content-bearing fields are intentionally rejected.
      promptText: "secret prompt body",
      assistantText: "secret assistant body",
      toolOutput: "secret tool output",
    });

    const [, , persistedValue] =
      clientStorageMocks.writeClientStoreValue.mock.calls[0] ?? [];
    expect(Array.isArray(persistedValue)).toBe(true);
    const [entry] = persistedValue as Array<{
      label: string;
      payload: Record<string, unknown>;
    }>;
    expect(entry.label).toBe("perf.client-interaction");
    expect(entry.payload).toMatchObject({
      area: "typing",
      evidenceKind: "proxy",
      workspaceId: "workspace-1",
      threadId: "thread-1",
      engine: "codex",
      turnId: "turn-1",
      inputEventCount: 50,
      renderCount: 3,
      commitDurationMs: 12.5,
      longTaskCount: 0,
      requestCount: 1,
      foregroundLatencyMs: 16,
      hydrationLatencyMs: 44,
    });
    expect(entry.payload).not.toHaveProperty("promptText");
    expect(entry.payload).not.toHaveProperty("assistantText");
    expect(entry.payload).not.toHaveProperty("toolOutput");
  });

  it("records content-safe composer render budget diagnostics", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendComposerRenderBudgetDiagnostic({
      surfaceId: "chat-input-adapter",
      evidenceKind: "proxy",
      workspaceId: "workspace-1",
      renderCount: 2,
      isProcessing: true,
      disabled: false,
      streamActivityPhase: "streaming",
      textLength: 42,
      // @ts-expect-error content-bearing fields are intentionally rejected.
      promptText: "secret prompt body",
    });

    const [, , persistedValue] =
      clientStorageMocks.writeClientStoreValue.mock.calls[0] ?? [];
    const [entry] = persistedValue as Array<{
      label: string;
      payload: Record<string, unknown>;
    }>;
    expect(entry.label).toBe("perf.composer.render-budget");
    expect(entry.payload).toMatchObject({
      surfaceId: "chat-input-adapter",
      evidenceKind: "proxy",
      workspaceId: "workspace-1",
      renderCount: 2,
      isProcessing: true,
      disabled: false,
      streamActivityPhase: "streaming",
      textLength: 42,
    });
    expect(entry.payload).not.toHaveProperty("promptText");
  });

  it("skips idle empty composer render budget diagnostics to avoid store churn", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendComposerRenderBudgetDiagnostic({
      surfaceId: "chat-input-adapter",
      evidenceKind: "proxy",
      workspaceId: "workspace-1",
      renderCount: 170,
      isProcessing: false,
      disabled: false,
      streamActivityPhase: "idle",
      textLength: 0,
    });

    expect(clientStorageMocks.writeClientStoreValue).not.toHaveBeenCalled();
  });

  it("samples repeated composer render diagnostics to avoid active stream store churn", async () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendComposerRenderBudgetDiagnostic({
      surfaceId: "chat-input-adapter",
      evidenceKind: "proxy",
      workspaceId: "workspace-1",
      renderCount: 1,
      isProcessing: true,
      disabled: false,
      streamActivityPhase: "ingress",
      textLength: 0,
    });
    diagnostics.appendComposerRenderBudgetDiagnostic({
      surfaceId: "chat-input-adapter",
      evidenceKind: "proxy",
      workspaceId: "workspace-1",
      renderCount: 2,
      isProcessing: true,
      disabled: false,
      streamActivityPhase: "ingress",
      textLength: 0,
    });

    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenCalledTimes(1);

    dateNowSpy.mockReturnValue(7_000);
    diagnostics.appendComposerRenderBudgetDiagnostic({
      surfaceId: "chat-input-adapter",
      evidenceKind: "proxy",
      workspaceId: "workspace-1",
      renderCount: 3,
      isProcessing: true,
      disabled: false,
      streamActivityPhase: "ingress",
      textLength: 0,
    });

    diagnostics.flushRendererDiagnosticsBuffer();
    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenCalledTimes(2);
    dateNowSpy.mockRestore();
  });

  it("records content-safe message row render budget diagnostics", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendMessageRowRenderBudgetDiagnostic({
      threadId: "thread-1",
      itemId: "assistant-1",
      role: "assistant",
      subtype: "assistant",
      evidenceKind: "proxy",
      renderCount: 3,
      isStreaming: true,
      textLength: 120,
      // @ts-expect-error content-bearing fields are intentionally rejected.
      assistantText: "secret assistant body",
    });

    const [, , persistedValue] =
      clientStorageMocks.writeClientStoreValue.mock.calls[0] ?? [];
    const [entry] = persistedValue as Array<{
      label: string;
      payload: Record<string, unknown>;
    }>;
    expect(entry.label).toBe("perf.messages.row-render-budget");
    expect(entry.payload).toMatchObject({
      threadId: "thread-1",
      itemId: "assistant-1",
      role: "assistant",
      subtype: "assistant",
      evidenceKind: "proxy",
      renderCount: 3,
      isStreaming: true,
      textLength: 120,
    });
    expect(entry.payload).not.toHaveProperty("assistantText");
  });

  it("samples repeated message row render diagnostics to avoid store churn", async () => {
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendMessageRowRenderBudgetDiagnostic({
      threadId: "thread-1",
      itemId: "assistant-1",
      role: "assistant",
      subtype: "assistant",
      evidenceKind: "proxy",
      renderCount: 1,
      isStreaming: true,
      textLength: 120,
    });
    diagnostics.appendMessageRowRenderBudgetDiagnostic({
      threadId: "thread-1",
      itemId: "assistant-1",
      role: "assistant",
      subtype: "assistant",
      evidenceKind: "proxy",
      renderCount: 2,
      isStreaming: true,
      textLength: 121,
    });

    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenCalledTimes(1);

    dateNowSpy.mockReturnValue(7_000);
    diagnostics.appendMessageRowRenderBudgetDiagnostic({
      threadId: "thread-1",
      itemId: "assistant-1",
      role: "assistant",
      subtype: "assistant",
      evidenceKind: "proxy",
      renderCount: 3,
      isStreaming: true,
      textLength: 122,
    });

    diagnostics.flushRendererDiagnosticsBuffer();
    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenCalledTimes(2);
    dateNowSpy.mockRestore();
  });

  it("records content-safe resource backpressure diagnostics", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendEventBackpressureDiagnostic({
      surfaceId: "terminal-output",
      eventKind: "runtime-line",
      queueDepth: 3,
      droppedCount: 1,
      coalescedCount: 2,
      flushCount: 4,
      lastFlushDurationMs: 6,
      criticalBypassCount: 1,
      deliveredCount: 10,
      rawRetainedCount: 20,
      evidenceClass: "proxy",
      // @ts-expect-error output bodies are intentionally rejected.
      terminalOutput: "secret terminal output",
    });

    const [, , persistedValue] =
      clientStorageMocks.writeClientStoreValue.mock.calls[0] ?? [];
    const [entry] = persistedValue as Array<{
      label: string;
      payload: Record<string, unknown>;
    }>;
    expect(entry.label).toBe("events.backpressure");
    expect(entry.payload).toMatchObject({
      surfaceId: "terminal-output",
      eventKind: "runtime-line",
      queueDepth: 3,
      droppedCount: 1,
      coalescedCount: 2,
      flushCount: 4,
      lastFlushDurationMs: 6,
      criticalBypassCount: 1,
      deliveredCount: 10,
      rawRetainedCount: 20,
      evidenceClass: "proxy",
    });
    expect(entry.payload).not.toHaveProperty("terminalOutput");
  });

  it("records content-safe render scheduler resource diagnostics", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendRenderSchedulerResourceDiagnostic({
      surfaceId: "app-server-event-dispatch",
      chunkCount: 8,
      yieldCount: 4,
      inputPendingYieldCount: 2,
      budgetMissCount: 1,
      idleCallbackCount: 3,
      timeoutFallbackCount: 5,
      pendingCallback: false,
      idleCallbackPending: false,
      timeoutFallbackPending: false,
      cancelled: true,
      evidenceClass: "proxy",
      // @ts-expect-error queue payloads are intentionally rejected.
      assistantText: "secret assistant body",
    });

    const [, , persistedValue] =
      clientStorageMocks.writeClientStoreValue.mock.calls[0] ?? [];
    const [entry] = persistedValue as Array<{
      label: string;
      payload: Record<string, unknown>;
    }>;
    expect(entry.label).toBe("render-scheduler.resource");
    expect(entry.payload).toMatchObject({
      surfaceId: "app-server-event-dispatch",
      chunkCount: 8,
      yieldCount: 4,
      inputPendingYieldCount: 2,
      budgetMissCount: 1,
      idleCallbackCount: 3,
      timeoutFallbackCount: 5,
      pendingCallback: false,
      idleCallbackPending: false,
      timeoutFallbackPending: false,
      cancelled: true,
      evidenceClass: "proxy",
    });
    expect(entry.payload).not.toHaveProperty("assistantText");
  });

  it("records content-safe listener and media owner diagnostics", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendListenerOwnerDiagnostic({
      activeCount: 2,
      inactiveCount: 1,
      evidenceClass: "proxy",
    });
    diagnostics.appendMediaOwnerDiagnostic({
      activeCount: 1,
      revokedCount: 3,
      retainedBytes: 2048,
      unsupportedReason: null,
      evidenceClass: "proxy",
      // @ts-expect-error media source URL is intentionally rejected.
      objectUrl: "blob:secret",
    });
    // 第二条落在节流窗口内，显式冲刷后再断言两次写入。
    diagnostics.flushRendererDiagnosticsBuffer();

    const [, , listenerPersistedValue] =
      clientStorageMocks.writeClientStoreValue.mock.calls[0] ?? [];
    const [listenerEntry] = listenerPersistedValue as Array<{
      label: string;
      payload: Record<string, unknown>;
    }>;
    const [, , mediaPersistedValue] =
      clientStorageMocks.writeClientStoreValue.mock.calls[1] ?? [];
    const mediaEntry = (
      mediaPersistedValue as Array<{
        label: string;
        payload: Record<string, unknown>;
      }>
    ).find((candidate) => candidate.label === "media.owner-budget");
    expect(listenerEntry.label).toBe("listeners.owner-budget");
    expect(mediaEntry?.label).toBe("media.owner-budget");
    expect(mediaEntry?.payload).toMatchObject({
      activeCount: 1,
      revokedCount: 3,
      retainedBytes: 2048,
      evidenceClass: "proxy",
    });
    expect(mediaEntry?.payload).not.toHaveProperty("objectUrl");
  });

  it("records content-safe markdown precompute diagnostics", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendMarkdownPrecomputeDiagnostic({
      mode: "worker-precompute",
      durationMs: 18,
      contentLength: 12_000,
      contentHash: "abc123",
      thresholdReason: "length",
      cacheState: "miss",
      fallbackReason: "none",
      evidenceClass: "measured",
      heavyCategoryCounts: {
        table: 1,
        "tool-call-xml": 2,
      },
      totalHeadings: 4,
      totalHeavyBlocks: 2,
      totalSourceLines: 300,
      // @ts-expect-error markdown body is intentionally rejected.
      rawMarkdown: "# secret prompt body",
    });

    const [, , persistedValue] =
      clientStorageMocks.writeClientStoreValue.mock.calls[0] ?? [];
    const [entry] = persistedValue as Array<{
      label: string;
      payload: Record<string, unknown>;
    }>;
    expect(entry.label).toBe("perf.messages.markdown.precompute");
    expect(entry.payload).toMatchObject({
      mode: "worker-precompute",
      durationMs: 18,
      contentLength: 12_000,
      contentHash: "abc123",
      thresholdReason: "length",
      cacheState: "miss",
      fallbackReason: "none",
      evidenceClass: "measured",
      heavyCategoryCounts: {
        table: 1,
        "tool-call-xml": 2,
      },
      totalHeadings: 4,
      totalHeavyBlocks: 2,
      totalSourceLines: 300,
    });
    expect(entry.payload).not.toHaveProperty("rawMarkdown");
    expect(entry.payload).not.toHaveProperty("assistantText");
  });

  it("records content-safe workspace file listing budget diagnostics", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendWorkspaceFileListingBudgetDiagnostic({
      surfaceId: "subtree-listing",
      workspaceId: "workspace-1",
      durationMs: 33,
      returnedEntries: 120,
      payloadBytes: 4096,
      cacheState: "unsupported",
      scanState: "partial",
      partial: true,
      limitHit: true,
      sourceVersion: "source-hash",
      requestedPathHash: "def456",
      evidenceClass: "measured",
      fallbackReason: null,
      // @ts-expect-error raw paths are intentionally rejected.
      requestedPath: "secret/project/path",
      fileContents: "secret file body",
    });

    const [, , persistedValue] =
      clientStorageMocks.writeClientStoreValue.mock.calls[0] ?? [];
    const [entry] = persistedValue as Array<{
      label: string;
      payload: Record<string, unknown>;
    }>;
    expect(entry.label).toBe("workspaces.file.listing-budget");
    expect(entry.payload).toMatchObject({
      surfaceId: "subtree-listing",
      workspaceId: "workspace-1",
      durationMs: 33,
      returnedEntries: 120,
      payloadBytes: 4096,
      cacheState: "unsupported",
      scanState: "partial",
      partial: true,
      limitHit: true,
      sourceVersion: "source-hash",
      requestedPathHash: "def456",
      evidenceClass: "measured",
    });
    expect(entry.payload).not.toHaveProperty("requestedPath");
    expect(entry.payload).not.toHaveProperty("fileContents");
  });

  it("falls back to an empty diagnostics list when persisted cache is malformed", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue({ broken: true });
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.appendRendererDiagnostic("bootstrap/start");

    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenCalledWith(
      "diagnostics",
      "diagnostics.rendererLifecycleLog",
      [
        expect.objectContaining({
          label: "bootstrap/start",
        }),
      ],
    );
  });

  it("ignores malformed entries inside persisted diagnostic arrays", async () => {
    testLocalStorage.setItem(
      EARLY_RENDERER_DIAGNOSTICS_STORAGE_KEY,
      JSON.stringify([
        { timestamp: 1, label: "bootstrap/valid", payload: { ok: true } },
        { timestamp: 2, label: null, payload: { broken: true } },
        {
          timestamp: "3",
          label: "bootstrap/broken",
          payload: { broken: true },
        },
      ]),
    );
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([
      { timestamp: 4, label: "stored/valid", payload: { ok: true } },
      { timestamp: 5, label: { broken: true }, payload: { broken: true } },
    ]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.flushRendererDiagnosticsBuffer();

    const [, , persistedEntries] =
      clientStorageMocks.writeClientStoreValue.mock.calls[0] ?? [];
    expect(persistedEntries).toEqual([
      expect.objectContaining({ label: "bootstrap/valid" }),
      expect.objectContaining({ label: "stored/valid" }),
    ]);
  });

  it("installs lifecycle listeners only once", async () => {
    clientStorageMocks.isPreloaded.mockReturnValue(false);
    const windowMock = {
      addEventListener: vi.fn(),
      location: { href: "https://example.test/renderer" },
    };
    const documentMock = {
      addEventListener: vi.fn(),
      visibilityState: "visible",
      readyState: "complete",
      hidden: false,
      hasFocus: () => true,
    };
    vi.stubGlobal("window", windowMock);
    vi.stubGlobal("document", documentMock);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.installRendererLifecycleDiagnostics();
    const windowListenerCallsAfterFirstInstall =
      windowMock.addEventListener.mock.calls.length;
    const documentListenerCallsAfterFirstInstall =
      documentMock.addEventListener.mock.calls.length;

    diagnostics.installRendererLifecycleDiagnostics();

    expect(windowListenerCallsAfterFirstInstall).toBeGreaterThan(0);
    expect(documentListenerCallsAfterFirstInstall).toBeGreaterThan(0);
    expect(windowMock.addEventListener).toHaveBeenCalledTimes(
      windowListenerCallsAfterFirstInstall,
    );
    expect(documentMock.addEventListener).toHaveBeenCalledTimes(
      documentListenerCallsAfterFirstInstall,
    );
  });

  it("records a blank-screen suspicion after repeated empty root samples", async () => {
    class TestHTMLElement {
      childElementCount = 0;
      textContent = "";
      tagName = "DIV";

      constructor(private readonly rect: { width: number; height: number }) {}

      getBoundingClientRect() {
        return this.rect;
      }
    }
    const rootElement = new TestHTMLElement({ width: 800, height: 600 });
    const bodyElement = new TestHTMLElement({ width: 800, height: 600 });
    vi.stubGlobal("HTMLElement", TestHTMLElement);
    vi.stubGlobal("document", {
      body: bodyElement,
      activeElement: bodyElement,
      visibilityState: "visible",
      readyState: "complete",
      hasFocus: () => true,
      getElementById: (id: string) => (id === "root" ? rootElement : null),
    });
    vi.stubGlobal("window", {
      clearInterval: globalThis.clearInterval,
      location: { href: "tauri://localhost" },
      setInterval: globalThis.setInterval,
      getComputedStyle: () => ({
        display: "block",
        opacity: "1",
        visibility: "visible",
      }),
    });
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.startRendererBlankScreenWatchdog({
      rootId: "root",
      intervalMs: 250,
      minConsecutiveSamples: 2,
      maxReports: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 550));

    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenCalledWith(
      "diagnostics",
      "diagnostics.rendererLifecycleLog",
      [
        expect.objectContaining({
          label: "renderer/blank-screen-suspected",
          payload: expect.objectContaining({
            rootId: "root",
            consecutiveSamples: 2,
            root: expect.objectContaining({
              exists: true,
              childElementCount: 0,
              textLength: 0,
            }),
          }),
        }),
      ],
    );
  });

  it("does not report a blank screen when the root has visible content", async () => {
    class TestHTMLElement {
      tagName = "DIV";

      constructor(
        readonly childElementCount: number,
        readonly textContent: string,
        private readonly rect: { width: number; height: number },
      ) {}

      getBoundingClientRect() {
        return this.rect;
      }
    }
    const rootElement = new TestHTMLElement(1, "ready", {
      width: 800,
      height: 600,
    });
    const bodyElement = new TestHTMLElement(1, "ready", {
      width: 800,
      height: 600,
    });
    vi.stubGlobal("HTMLElement", TestHTMLElement);
    vi.stubGlobal("document", {
      body: bodyElement,
      activeElement: bodyElement,
      visibilityState: "visible",
      readyState: "complete",
      hasFocus: () => true,
      getElementById: (id: string) => (id === "root" ? rootElement : null),
    });
    vi.stubGlobal("window", {
      clearInterval: globalThis.clearInterval,
      location: { href: "tauri://localhost" },
      setInterval: globalThis.setInterval,
      getComputedStyle: () => ({
        display: "block",
        opacity: "1",
        visibility: "visible",
      }),
    });
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    diagnostics.startRendererBlankScreenWatchdog({
      rootId: "root",
      intervalMs: 250,
      minConsecutiveSamples: 2,
      maxReports: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 550));

    expect(clientStorageMocks.writeClientStoreValue).not.toHaveBeenCalled();
  });

  it("builds privacy-safe renderer heartbeat payload without conversation content fields", async () => {
    vi.stubGlobal("navigator", {
      platform: "MacIntel",
    });
    vi.stubGlobal("document", {
      visibilityState: "visible",
      readyState: "complete",
    });
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue([]);
    const diagnostics = await import("./rendererDiagnostics");

    const payload = diagnostics.buildRendererHeartbeatPayload({
      workspaceId: "workspace-1",
      threadId: "thread-1",
    });
    const serialized = JSON.stringify(payload);

    expect(payload.workspaceId).toBe("workspace-1");
    expect(payload.threadId).toBe("thread-1");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("assistant");
    expect(serialized).not.toContain("toolOutput");
    expect(serialized).not.toContain("fileContent");
    expect(serialized).not.toContain("environment");
  });
});
