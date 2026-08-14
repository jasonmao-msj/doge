import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  DEFAULT_DOCK_ICON_ID,
  DOCK_ICON_OPTIONS,
  isDockIconId,
  resolveDockIconSrc,
  sanitizeDockIconId,
  applyDockIconPreference,
} from "./dockIcon";

vi.mock("../../../services/tauri/settings", () => ({
  setDockIcon: vi.fn(async () => ({
    iconId: "default",
    applied: true,
    platform: "macos",
    reason: null,
  })),
}));

import { setDockIcon } from "../../../services/tauri/settings";

describe("dockIcon", () => {
  beforeEach(() => {
    vi.mocked(setDockIcon).mockClear();
  });

  it("keeps default as the first catalog option", () => {
    expect(DOCK_ICON_OPTIONS[0]?.id).toBe(DEFAULT_DOCK_ICON_ID);
    expect(DOCK_ICON_OPTIONS[0]?.src).toBe("/app-icon.png");
    expect(DOCK_ICON_OPTIONS).toHaveLength(9);
  });

  it("sanitizes unknown ids to default", () => {
    expect(sanitizeDockIconId(undefined)).toBe("default");
    expect(sanitizeDockIconId("not-real")).toBe("default");
    expect(sanitizeDockIconId("multi-orbit-hub")).toBe("multi-orbit-hub");
    expect(isDockIconId("triadic-router")).toBe(true);
    expect(isDockIconId("")).toBe(false);
  });

  it("resolves a stable src for every catalog id", () => {
    for (const option of DOCK_ICON_OPTIONS) {
      const src = resolveDockIconSrc(option.id);
      expect(typeof src).toBe("string");
      expect(src.length).toBeGreaterThan(0);
    }
    expect(resolveDockIconSrc("bogus")).toBe(resolveDockIconSrc("default"));
  });

  it("loads Uint8Array png bytes for every catalog id including default", async () => {
    // Valid PNG magic + padding so assertPngBytes accepts the payload.
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      })),
    );

    await applyDockIconPreference("default");
    expect(setDockIcon).toHaveBeenCalledTimes(1);
    const defaultCall = vi.mocked(setDockIcon).mock.calls[0]?.[0];
    expect(defaultCall?.iconId).toBe("default");
    expect(defaultCall?.pngBytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(defaultCall?.pngBytes as Uint8Array)).toEqual(Array.from(bytes));

    vi.mocked(setDockIcon).mockClear();
    await applyDockIconPreference("multi-orbit-hub");
    const customCall = vi.mocked(setDockIcon).mock.calls[0]?.[0];
    expect(customCall?.iconId).toBe("multi-orbit-hub");
    expect(customCall?.pngBytes).toBeInstanceOf(Uint8Array);

    vi.unstubAllGlobals();
  });

  it("rejects non-png payloads before invoking the backend", async () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => junk.buffer.slice(0),
      })),
    );

    await expect(applyDockIconPreference("default")).rejects.toThrow(/not a PNG/i);
    expect(setDockIcon).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("drops stale applies when a newer preference is requested", async () => {
    type DeferredFetchResponse = {
      ok: boolean;
      arrayBuffer: () => Promise<ArrayBuffer>;
    };
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let resolveFirstFetch!: (value: DeferredFetchResponse) => void;
    const firstFetchGate = new Promise<DeferredFetchResponse>((resolve) => {
      resolveFirstFetch = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(() => firstFetchGate),
    );

    const first = applyDockIconPreference("default");
    // Second request starts while first fetch is still pending.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () =>
          png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
      })),
    );
    await applyDockIconPreference("multi-orbit-hub");
    expect(setDockIcon).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setDockIcon).mock.calls[0]?.[0]?.iconId).toBe(
      "multi-orbit-hub",
    );

    // Complete the first fetch; its apply must be skipped.
    resolveFirstFetch({
      ok: true,
      arrayBuffer: async () =>
        png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength),
    });
    await first;
    expect(setDockIcon).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });
});
