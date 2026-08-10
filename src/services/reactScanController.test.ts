// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scanMock = vi.fn();
const internalsMock = {
  instrumentation: { isPaused: { value: true } },
};

vi.mock("react-scan", () => ({
  scan: scanMock,
  ReactScanInternals: internalsMock,
}));

import {
  recoverFromReactScanUpdateDepthError,
  setReactScanEnabled,
} from "./reactScanController";

// react-scan 会把 enabled 持久化到自己的 localStorage 键并在启动时 restore。
// 控制器可修复 persisted options，但 mutation 必须只走 public scan() API。
describe("reactScanController persisted-pause recovery", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    scanMock.mockClear();
    internalsMock.instrumentation.isPaused.value = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rewrites a stale persisted enabled:false before enabling the overlay", async () => {
    window.localStorage.setItem(
      "react-scan-options",
      JSON.stringify({ enabled: false, showToolbar: true }),
    );

    await setReactScanEnabled(true);

    const persisted = JSON.parse(
      window.localStorage.getItem("react-scan-options") ?? "{}",
    );
    expect(persisted.enabled).toBe(true);
    expect(persisted.showToolbar).toBe(true);
    expect(scanMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, dangerouslyForceRunInProduction: true }),
    );
  });

  it("does not mutate internal instrumentation signals when enabling", async () => {
    await setReactScanEnabled(true);

    expect(internalsMock.instrumentation.isPaused.value).toBe(true);
    const options = scanMock.mock.calls.at(-1)?.[0];
    expect(typeof options?.onRender).toBe("function");
  });

  it("leaves instrumentation paused when disabling", async () => {
    await setReactScanEnabled(true);
    internalsMock.instrumentation.isPaused.value = true;

    await setReactScanEnabled(false);

    expect(internalsMock.instrumentation.isPaused.value).toBe(true);
    expect(scanMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it("disables a persisted production overlay and reloads once after React #185", () => {
    const reload = vi.fn();
    window.localStorage.setItem("doge.perf.reactScan", "1");
    window.localStorage.setItem(
      "react-scan-options",
      JSON.stringify({ enabled: true, showToolbar: true }),
    );

    expect(
      recoverFromReactScanUpdateDepthError(
        new Error("Minified React error #185"),
        reload,
      ),
    ).toBe("recovered");
    expect(reload).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem("doge.perf.reactScan")).toBeNull();
    expect(window.localStorage.getItem("react-scan-options")).toBeNull();

    window.localStorage.setItem("doge.perf.reactScan", "1");
    expect(
      recoverFromReactScanUpdateDepthError(
        new Error("Maximum update depth exceeded"),
        reload,
      ),
    ).toBe("already-attempted");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not recover unrelated renderer failures", () => {
    const reload = vi.fn();
    window.localStorage.setItem("doge.perf.reactScan", "1");

    expect(
      recoverFromReactScanUpdateDepthError(new Error("render failed"), reload),
    ).toBe("not-applicable");
    expect(reload).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("doge.perf.reactScan")).toBe("1");
  });

  it("allows a new recovery attempt after the user explicitly re-enables react-scan", async () => {
    const reload = vi.fn();
    window.localStorage.setItem("doge.perf.reactScan", "1");
    expect(
      recoverFromReactScanUpdateDepthError(
        new Error("Maximum update depth exceeded"),
        reload,
      ),
    ).toBe("recovered");

    await setReactScanEnabled(true);
    expect(
      recoverFromReactScanUpdateDepthError(
        new Error("Maximum update depth exceeded"),
        reload,
      ),
    ).toBe("recovered");
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("rolls back persisted state and the one-shot guard when cleanup fails", () => {
    const reload = vi.fn();
    const originalRemoveItem = window.localStorage.removeItem.bind(
      window.localStorage,
    );
    vi.spyOn(window.localStorage, "removeItem").mockImplementation((key) => {
      if (key === "react-scan-options") {
        throw new DOMException("storage unavailable", "SecurityError");
      }
      return originalRemoveItem(key);
    });
    window.localStorage.setItem("doge.perf.reactScan", "1");
    window.localStorage.setItem(
      "react-scan-options",
      JSON.stringify({ enabled: true, showToolbar: true }),
    );

    expect(
      recoverFromReactScanUpdateDepthError(
        new Error("Maximum update depth exceeded"),
        reload,
      ),
    ).toBe("failed");
    expect(reload).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("doge.perf.reactScan")).toBe("1");
    expect(window.localStorage.getItem("react-scan-options")).not.toBeNull();
    expect(
      window.sessionStorage.getItem(
        "doge.perf.reactScan.updateDepthRecoveryAttempted",
      ),
    ).toBeNull();

    vi.restoreAllMocks();
    expect(
      recoverFromReactScanUpdateDepthError(
        new Error("Maximum update depth exceeded"),
        reload,
      ),
    ).toBe("recovered");
  });
});
