import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installWindowsReloadShortcutGuard,
  isWindowsBrowserReloadKey,
} from "./windowsReloadShortcutGuard";

describe("Windows reload shortcut guard", () => {
  afterEach(() => vi.restoreAllMocks());

  it("matches F5 by key or code without claiming other keys", () => {
    expect(isWindowsBrowserReloadKey({ key: "F5", code: "" })).toBe(true);
    expect(isWindowsBrowserReloadKey({ key: "r", code: "F5" })).toBe(true);
    expect(isWindowsBrowserReloadKey({ key: "F12", code: "F12" })).toBe(false);
  });

  it("does not attach outside Windows", () => {
    const target = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    installWindowsReloadShortcutGuard(target, false)();
    expect(target.addEventListener).not.toHaveBeenCalled();
    expect(target.removeEventListener).not.toHaveBeenCalled();
  });

  it("prevents F5 on Windows and cleans up", () => {
    const listeners = new Map<string, EventListener>();
    const target = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        if (listeners.get(type) === listener) {
          listeners.delete(type);
        }
      }),
    };
    const uninstall = installWindowsReloadShortcutGuard(target, true);
    const listener = listeners.get("keydown");
    const event = {
      key: "F5",
      code: "F5",
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;

    listener?.(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    uninstall();
    expect(target.removeEventListener).toHaveBeenCalledWith(
      "keydown",
      listener,
      true,
    );
  });
});
