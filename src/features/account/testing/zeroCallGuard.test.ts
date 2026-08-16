import { describe, expect, it, vi } from "vitest";
import { installAccountZeroCallGuardV1 } from "./zeroCallGuard";

describe("installAccountZeroCallGuardV1", () => {
  it("allows a mock-only flow with zero external attempts", () => {
    const root = {
      fetch: vi.fn(),
      __TAURI_INTERNALS__: { invoke: vi.fn() },
      __TAURI__: {
        core: { invoke: vi.fn() },
        opener: { openUrl: vi.fn() },
      },
    };
    const guard = installAccountZeroCallGuardV1(root);

    expect(() => guard.assertNoCalls()).not.toThrow();
    expect(guard.attempts).toEqual([]);
    guard.restore();
  });

  it("blocks network and native boundaries and restores their originals", () => {
    const fetch = vi.fn();
    const internalInvoke = vi.fn();
    const coreInvoke = vi.fn();
    const openUrl = vi.fn();
    const root = {
      fetch,
      __TAURI_INTERNALS__: { invoke: internalInvoke },
      __TAURI__: {
        core: { invoke: coreInvoke },
        opener: { openUrl },
      },
    };
    const guard = installAccountZeroCallGuardV1(root);

    expect(() => root.fetch()).toThrow("blocked fetch");
    expect(() => root.__TAURI_INTERNALS__.invoke()).toThrow(
      "blocked tauriInvoke",
    );
    expect(() => root.__TAURI__.core.invoke()).toThrow(
      "blocked tauriInvoke",
    );
    expect(() => root.__TAURI__.opener.openUrl()).toThrow(
      "blocked nativeOpen",
    );
    expect(guard.attempts.map((attempt) => attempt.kind)).toEqual([
      "fetch",
      "tauriInvoke",
      "tauriInvoke",
      "nativeOpen",
    ]);
    expect(() => guard.assertNoCalls()).toThrow(
      "Account Mock performed external calls",
    );

    guard.restore();
    root.fetch();
    root.__TAURI_INTERNALS__.invoke();
    root.__TAURI__.core.invoke();
    root.__TAURI__.opener.openUrl();
    expect(fetch).toHaveBeenCalledOnce();
    expect(internalInvoke).toHaveBeenCalledOnce();
    expect(coreInvoke).toHaveBeenCalledOnce();
    expect(openUrl).toHaveBeenCalledOnce();
  });
});
