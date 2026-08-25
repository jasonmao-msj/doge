import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

import {
  resolveAccountEngineToolchainV1,
} from "./accountEngine";

beforeEach(() => vi.clearAllMocks());

describe("account engine Tauri commands", () => {
  it("keeps only the product provisioning toolchain command", async () => {
    tauri.invoke.mockResolvedValue({ ok: true, value: { status: "ready" } });

    await expect(resolveAccountEngineToolchainV1("codex", "bundled")).resolves.toEqual({
      ok: true,
      value: { status: "ready" },
    });
    expect(tauri.invoke).toHaveBeenCalledWith(
      "account_engine_v1_toolchain",
      { engineId: "codex", choice: "bundled" },
    );
  });
});
