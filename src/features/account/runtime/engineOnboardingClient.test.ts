import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  catalog: vi.fn(),
  plans: vi.fn(),
  checkout: vi.fn(),
  readCheckout: vi.fn(),
  pendingCheckout: vi.fn(),
  readiness: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock("../../../services/tauri/accountEngine", () => ({
  readAccountEngineCatalogV1: tauri.catalog,
  readAccountEnginePlansV1: tauri.plans,
  createAccountEngineCheckoutV1: tauri.checkout,
  readAccountEngineCheckoutV1: tauri.readCheckout,
  readPendingAccountEngineCheckoutV1: tauri.pendingCheckout,
  readAccountEngineReadinessV1: tauri.readiness,
  prepareAccountEngineV1: tauri.prepare,
}));

import { createAccountEngineOnboardingClientV1 } from "./engineOnboardingClient";

beforeEach(() => {
  vi.clearAllMocks();
  tauri.pendingCheckout.mockResolvedValue({ ok: true, value: null });
});

describe("account engine onboarding client", () => {
  it("projects every server-provided public subscription plan without local pricing", async () => {
    tauri.plans.mockResolvedValue({
      ok: true,
      value: {
        engine_id: "codex",
        plans: [
          plan(11, "入门版", 9.9),
          plan(12, "标准版", 29.9),
          plan(13, "专业版", 59.9),
        ],
        payment_methods: [{ id: "alipay", display_name: "支付宝", currency: "CNY" }],
      },
    });

    const result = await createAccountEngineOnboardingClientV1().plans("codex");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.plans.map((entry) => [entry.id, entry.name, entry.price])).toEqual([
      [11, "入门版", 9.9],
      [12, "标准版", 29.9],
      [13, "专业版", 59.9],
    ]);
    expect(JSON.stringify(result.value)).not.toMatch(/balance|recharge|pay.?as.?you.?go/i);
  });

  it("accepts an empty public plan list without inventing a fallback", async () => {
    tauri.plans.mockResolvedValue({
      ok: true,
      value: { engine_id: "claude-code", plans: [], payment_methods: [] },
    });
    const result = await createAccountEngineOnboardingClientV1().plans("claude-code");
    expect(result).toEqual({
      ok: true,
      value: { engineId: "claude-code", plans: [], paymentMethods: [] },
    });
  });

  it("fails a malformed or expanded engine catalog closed", async () => {
    tauri.catalog.mockResolvedValue({
      ok: true,
      value: {
        engines: [
          { id: "codex", display_name: "Codex", entitlement: { status: "none" } },
          { id: "claude-code", display_name: "Claude Code", entitlement: { status: "active" } },
          { id: "unknown", display_name: "Unknown", entitlement: { status: "none" } },
        ],
      },
    });
    await expect(createAccountEngineOnboardingClientV1().catalog()).resolves.toEqual({
      ok: false,
      error: { code: "protocolMismatch" },
    });
  });

  it("accepts nullable optional fields emitted by the native wire contract", async () => {
    tauri.catalog.mockResolvedValue({
      ok: true,
      value: {
        engines: [
          {
            id: "codex",
            display_name: "Codex",
            entitlement: {
              status: "none",
              subscription_id: null,
              group_id: null,
              expires_at: null,
            },
          },
          {
            id: "claude-code",
            display_name: "Claude Code",
            entitlement: {
              status: "active",
              subscription_id: 42,
              group_id: 7,
              expires_at: "2030-01-01T00:00:00Z",
            },
          },
        ],
      },
    });
    tauri.readCheckout.mockResolvedValue({
      ok: true,
      value: {
        checkout_id: 9,
        status: "pending",
        expires_at: "2030-01-01T00:00:00Z",
        action: {
          kind: "open_url",
          url: "https://pay.example.com/orders/9",
          data: null,
        },
      },
    });

    const client = createAccountEngineOnboardingClientV1();
    await expect(client.catalog()).resolves.toMatchObject({ ok: true });
    await expect(client.readCheckout(9)).resolves.toEqual({
      ok: true,
      value: {
        checkoutId: 9,
        status: "pending",
        expiresAt: "2030-01-01T00:00:00Z",
        action: {
          kind: "open_url",
          url: "https://pay.example.com/orders/9",
          data: null,
        },
      },
    });
  });

  it("rejects unsafe checkout navigation before it reaches the UI", async () => {
    tauri.readCheckout.mockResolvedValue({
      ok: true,
      value: {
        checkout_id: 9,
        status: "pending",
        expires_at: "2030-01-01T00:00:00Z",
        action: { kind: "open_url", url: "javascript:alert(1)" },
      },
    });

    await expect(createAccountEngineOnboardingClientV1().readCheckout(9)).resolves.toEqual({
      ok: false,
      error: { code: "protocolMismatch" },
    });
  });
});

function plan(id: number, name: string, price: number) {
  return {
    id,
    name,
    description: "",
    price,
    currency: "CNY",
    validity_days: 30,
    validity_unit: "day",
    features: [],
    sort_order: id,
  };
}
