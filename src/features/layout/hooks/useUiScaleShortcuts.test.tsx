/* @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  setUiScaleColdStartDeferForTests,
  useUiScaleShortcuts,
  UI_SCALE_AFTER_FORCE_ENTER_DELAY_MS,
} from "./useUiScaleShortcuts";
import type { AppSettings } from "../../../types";
import type { RendererPlatform } from "../../../utils/rendererPlatform";
import { resetApplyUiScaleQueueForTests } from "../../../utils/applyUiScale";
import {
  readUiScaleStartupGuardRecord,
  resetUiScaleStartupGuardForTests,
} from "../../../utils/uiScaleStartupGuard";
import {
  markStartupForceEnter,
  resetStartupForceEnterForTests,
} from "../../startup-orchestration/utils/startupForceEnter";
import {
  recordStartupMilestone,
  resetStartupTraceForTests,
} from "../../startup-orchestration/utils/startupTrace";

const platformMocks = vi.hoisted(() => ({
  platform: "macos" as RendererPlatform,
}));

vi.mock("../../../utils/rendererPlatform", async () => {
  const actual = await vi.importActual<
    typeof import("../../../utils/rendererPlatform")
  >("../../../utils/rendererPlatform");
  return {
    ...actual,
    detectRendererPlatform: () => platformMocks.platform,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function createSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    uiScale: 1,
    increaseUiScaleShortcut: "Mod+=",
    decreaseUiScaleShortcut: "Mod+-",
    resetUiScaleShortcut: "Mod+0",
    ...overrides,
  } as AppSettings;
}

describe("useUiScaleShortcuts", () => {
  afterEach(() => {
    setUiScaleColdStartDeferForTests(false);
    resetStartupForceEnterForTests();
    resetStartupTraceForTests();
    vi.useRealTimers();
  });

  beforeEach(() => {
    resetApplyUiScaleQueueForTests();
    resetUiScaleStartupGuardForTests();
    resetStartupForceEnterForTests();
    resetStartupTraceForTests();
    setUiScaleColdStartDeferForTests(false);
    platformMocks.platform = "macos";
    document.documentElement.style.zoom = "";
    document.documentElement.style.width = "";
    document.documentElement.style.height = "";
    document.documentElement.style.transform = "";
    document.documentElement.style.removeProperty("--ui-scale");
    document.body.style.zoom = "";
    document.body.style.width = "";
    document.body.style.height = "";
    document.body.style.transform = "";
    document.body.style.position = "";
  });

  it("macos: applies CSS zoom on body", async () => {
    platformMocks.platform = "macos";
    document.documentElement.style.zoom = "0.8";
    document.body.style.zoom = "0.8";
    const settings = createSettings({ uiScale: 1.1 });
    renderHook(() =>
      useUiScaleShortcuts({
        settings,
        setSettings: vi.fn(),
        saveSettings: vi.fn(async (next) => next),
      }),
    );

    await waitFor(() => {
      expect(document.documentElement.style.zoom).toBe("");
      expect(document.body.style.zoom).toBe("1.1");
      expect(document.body.style.transform).toBe("");
    });
  });

  it("linux: applies the CSS zoom path", async () => {
    platformMocks.platform = "linux";
    renderHook(() =>
      useUiScaleShortcuts({
        settings: createSettings({ uiScale: 0.8 }),
        setSettings: vi.fn(),
        saveSettings: vi.fn(async (next) => next),
      }),
    );

    await waitFor(() => {
      expect(document.body.style.zoom).toBe("0.8");
      expect(document.body.style.transform).toBe("");
    });
  });

  it("windows: applies CSS zoom on body without transform fill", async () => {
    platformMocks.platform = "windows";
    renderHook(() =>
      useUiScaleShortcuts({
        settings: createSettings({ uiScale: 0.8 }),
        setSettings: vi.fn(),
        saveSettings: vi.fn(async (next) => next),
      }),
    );

    await waitFor(() => {
      expect(document.documentElement.style.zoom).toBe("");
      expect(document.body.style.zoom).toBe("0.8");
      expect(document.body.style.transform).toBe("");
      expect(document.body.style.width).toBe("");
      expect(document.body.style.position).toBe("");
    });
  });

  it("works in browser previews without Tauri window metadata", async () => {
    platformMocks.platform = "unknown";

    expect(() =>
      renderHook(() =>
        useUiScaleShortcuts({
          settings: createSettings({ uiScale: 0.9 }),
          setSettings: vi.fn(),
          saveSettings: vi.fn(async (next) => next),
        }),
      ),
    ).not.toThrow();

    await waitFor(() => {
      expect(document.body.style.zoom).toBe("0.9");
      expect(document.body.style.transform).toBe("");
    });
  });

  it("non-identity apply records a pending startup-guard mark", async () => {
    platformMocks.platform = "macos";
    renderHook(() =>
      useUiScaleShortcuts({
        settings: createSettings({ uiScale: 0.9 }),
        setSettings: vi.fn(),
        saveSettings: vi.fn(async (next) => next),
      }),
    );

    await waitFor(() => {
      expect(readUiScaleStartupGuardRecord()?.scale).toBe(0.9);
    });
  });

  it("cold-start defer: waits for startup-gate-ready before applying any ≠1 scale", async () => {
    setUiScaleColdStartDeferForTests(true);
    vi.useFakeTimers({ shouldAdvanceTime: false });
    platformMocks.platform = "macos";
    renderHook(() =>
      useUiScaleShortcuts({
        settings: createSettings({ uiScale: 1.2 }),
        setSettings: vi.fn(),
        saveSettings: vi.fn(async (next) => next),
      }),
    );

    // Phase 1 identity only.
    expect(document.body.style.zoom).toBe("");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    // Still deferred without gate-ready.
    expect(document.body.style.zoom).toBe("");

    await act(async () => {
      recordStartupMilestone("startup-gate-ready");
    });
    expect(document.body.style.zoom).toBe("1.2");
    vi.useRealTimers();
  });

  it("cold-start defer: force-enter applies ≠1 only after quiet delay", async () => {
    setUiScaleColdStartDeferForTests(true);
    vi.useFakeTimers({ shouldAdvanceTime: false });
    renderHook(() =>
      useUiScaleShortcuts({
        settings: createSettings({ uiScale: 0.8 }),
        setSettings: vi.fn(),
        saveSettings: vi.fn(async (next) => next),
      }),
    );
    expect(document.body.style.zoom).toBe("");

    await act(async () => {
      markStartupForceEnter();
      await vi.advanceTimersByTimeAsync(UI_SCALE_AFTER_FORCE_ENTER_DELAY_MS - 50);
    });
    expect(document.body.style.zoom).toBe("");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(document.body.style.zoom).toBe("0.8");
    vi.useRealTimers();
  });

  it("startup guard forces identity scale for one session after an unhealthy ≠1 launch", async () => {
    platformMocks.platform = "macos";
    window.localStorage.setItem(
      "doge.uiScaleStartupGuard.v1",
      JSON.stringify({ scale: 0.9, markedAt: Date.now() }),
    );
    document.body.style.zoom = "0.9";
    document.body.style.transform = "scale(0.9)";
    document.body.style.width = `${100 / 0.9}%`;
    document.body.style.position = "fixed";

    renderHook(() =>
      useUiScaleShortcuts({
        settings: createSettings({ uiScale: 0.9 }),
        setSettings: vi.fn(),
        saveSettings: vi.fn(async (next) => next),
      }),
    );

    await waitFor(() => {
      expect(document.body.style.zoom).toBe("");
      expect(document.body.style.transform).toBe("");
      expect(document.body.style.width).toBe("");
      expect(document.body.style.position).toBe("");
      expect(readUiScaleStartupGuardRecord()).toBeNull();
    });
  });
});
