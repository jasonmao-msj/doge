import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAccountProductOnboardingClientV1,
  parseProductCatalog,
  parseProductModels,
  parseProductReady,
} from "./productOnboardingClient";

const commands = vi.hoisted(() => ({
  readCatalog: vi.fn(),
  readModels: vi.fn(),
  createCheckout: vi.fn(),
  readCheckout: vi.fn(),
  readPendingCheckout: vi.fn(),
  abandonCheckout: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock("../../../services/accountProductCommands", () => ({
  readAccountProductCatalogV1: commands.readCatalog,
  readAccountProductModelsV1: commands.readModels,
  createAccountProductCheckoutV1: commands.createCheckout,
  readAccountProductCheckoutV1: commands.readCheckout,
  readPendingAccountProductCheckoutV1: commands.readPendingCheckout,
  abandonAccountProductCheckoutV1: commands.abandonCheckout,
  prepareAccountProductV1: commands.prepare,
}));

beforeEach(() => vi.clearAllMocks());

describe("product onboarding contract", () => {
  it("projects upstream-owned plan and Composite model data", () => {
    const catalog = parseProductCatalog({
      ok: true,
      value: {
        entitlement: { status: "required" },
        plans: [{
          id: 5,
          name: "Doge订阅",
          description: "由上游维护的套餐说明",
          price: 0.99,
          original_price: null,
          currency: "CNY",
          validity_days: 30,
          validity_unit: "day",
          features: ["全部模型"],
        }],
        payment_methods: [{ id: "alipay", display_name: "", currency: "CNY" }],
        engines: engines(),
      },
    });
    expect(catalog).toMatchObject({
      ok: true,
      value: {
        plans: [{ id: 5, name: "Doge订阅", price: 0.99 }],
        paymentMethods: [{ id: "alipay", displayName: "" }],
      },
    });

    const ready = parseProductReady({
      ok: true,
      value: {
        status: "ready",
        entitlement: activeEntitlement(),
        engines: engines(),
        models: [
          rawModel("gpt-5.6-sol"),
          rawModel("doubao-entry", "豆包", "ark-code-latest"),
        ],
      },
    });
    expect(ready).toMatchObject({
      ok: true,
      value: {
        models: [
          { id: "gpt-5.6-sol" },
          {
            id: "doubao-entry",
            displayName: "豆包",
            model: "ark-code-latest",
          },
        ],
      },
    });
  });

  it("fails closed when a mandatory local engine or usage window is absent", () => {
    expect(parseProductCatalog({
      ok: true,
      value: {
        entitlement: { status: "required" },
        plans: [],
        payment_methods: [],
        engines: engines().slice(0, 2),
      },
    })).toEqual({ ok: false, error: { code: "protocolMismatch" } });

    expect(parseProductReady({
      ok: true,
      value: {
        status: "ready",
        entitlement: { ...activeEntitlement(), usage: { daily: usageWindow() } },
        engines: engines(),
        models: [rawModel("gpt-5.6-sol")],
      },
    })).toEqual({ ok: false, error: { code: "protocolMismatch" } });
  });

  it("accepts ready state while the model catalog is temporarily unavailable", () => {
    expect(parseProductReady({
      ok: true,
      value: {
        status: "ready",
        entitlement: activeEntitlement(),
        engines: engines(),
        models: [],
      },
    })).toMatchObject({
      ok: true,
      value: {
        status: "ready",
        entitlement: { status: "active" },
        engines: [
          { id: "codex", displayName: "Codex" },
          { id: "claude-code", displayName: "Claude" },
          { id: "kimi", displayName: "Kimi" },
        ],
        models: [],
      },
    });
  });

  it("parses refresh payloads with separate display and runtime model identity", () => {
    expect(parseProductModels({
      ok: true,
      value: {
        fetched_at: "2030-01-01T00:00:00Z",
        models: [rawModel("doubao-entry", "豆包", "ark-code-latest")],
      },
    })).toEqual({
      ok: true,
      value: {
        fetchedAt: "2030-01-01T00:00:00Z",
        models: [{
          id: "doubao-entry",
          displayName: "豆包",
          model: "ark-code-latest",
          compatibleEngines: ["codex", "claude", "kimi"],
          capabilities: ["chat"],
        }],
      },
    });
  });

  it("deduplicates concurrent catalog reads and reuses the bounded session cache", async () => {
    let resolveCatalog: (value: unknown) => void = () => undefined;
    commands.readCatalog.mockReturnValueOnce(new Promise((resolve) => {
      resolveCatalog = resolve;
    }));
    const client = createAccountProductOnboardingClientV1();

    const first = client.catalog();
    const second = client.catalog();
    expect(commands.readCatalog).toHaveBeenCalledTimes(1);

    resolveCatalog(rawCatalog());
    await expect(first).resolves.toMatchObject({ ok: true });
    await expect(second).resolves.toMatchObject({ ok: true });
    await expect(client.catalog()).resolves.toMatchObject({ ok: true });
    expect(commands.readCatalog).toHaveBeenCalledTimes(1);

    commands.readCatalog.mockResolvedValueOnce(rawCatalog());
    await expect(client.catalog({ forceRefresh: true })).resolves.toMatchObject({ ok: true });
    expect(commands.readCatalog).toHaveBeenCalledTimes(2);
  });
});

function rawCatalog() {
  return {
    ok: true,
    value: {
      entitlement: { status: "required" },
      plans: [{
        id: 5,
        name: "Doge订阅",
        description: "由上游维护的套餐说明",
        price: 0.99,
        original_price: null,
        currency: "CNY",
        validity_days: 30,
        validity_unit: "day",
        features: ["全部模型"],
      }],
      payment_methods: [{ id: "alipay", display_name: "支付宝", currency: "CNY" }],
      engines: engines(),
    },
  };
}

function engines() {
  return [
    { id: "codex", display_name: "Codex" },
    { id: "claude-code", display_name: "Claude" },
    { id: "kimi", display_name: "Kimi" },
  ];
}

function activeEntitlement() {
  return {
    status: "active",
    subscription_id: 9,
    group_id: 5,
    group_name: "Doge APP",
    plan_name: "Doge订阅",
    expires_at: "2030-01-01T00:00:00Z",
    usage: {
      daily: usageWindow(),
      weekly: usageWindow(),
      monthly: usageWindow(),
    },
  };
}

function usageWindow() {
  return { used_usd: 1, limit_usd: 10, percentage: 10 };
}

function rawModel(id: string, displayName = id, model = id) {
  return {
    id,
    display_name: displayName,
    model,
    compatible_engines: ["codex", "claude", "kimi"],
    capabilities: ["chat"],
  };
}
