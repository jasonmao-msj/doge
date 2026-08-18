import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: tauri.invoke }));

import { abandonAccountEngineCheckoutV1 } from "./accountEngine";

beforeEach(() => vi.clearAllMocks());

describe("account engine Tauri commands", () => {
  it("maps checkout abandonment to the exact native command and camelCase payload", async () => {
    tauri.invoke.mockResolvedValue({ ok: true, value: null });

    await expect(abandonAccountEngineCheckoutV1(88)).resolves.toEqual({
      ok: true,
      value: null,
    });
    expect(tauri.invoke).toHaveBeenCalledWith(
      "account_engine_v1_abandon_checkout",
      { checkoutId: 88 },
    );
  });
});
