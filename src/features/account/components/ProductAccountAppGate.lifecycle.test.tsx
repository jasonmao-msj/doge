// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountGatewayProvider } from "../gateway/AccountGatewayProvider";
import { createMockAccountGatewayV1 } from "../mock/MockAccountGatewayV1";
import { createScenarioRuntimeV1 } from "../mock/ScenarioRuntimeV1";
import {
  clearProductEntitlementV1,
} from "../runtime/productEntitlementStore";
import type {
  AccountProductOnboardingClientV1,
  ProductCatalogViewV1,
  ProductReadyViewV1,
} from "../runtime/productOnboardingClient";
import {
  ProductAccountAppGate,
  productCheckoutPollDelayMs,
  productFulfillmentPollDelayMs,
} from "./ProductAccountAppGate";
import { productPrepareRetryDelaysMs } from "../runtime/productPrepareRetry";

const refreshModels = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const appendDiagnostic = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: "zh-CN" } }),
}));

vi.mock("../../../services/accountExternalLinks", () => ({
  openAccountExternalUrl: vi.fn(async () => undefined),
}));

vi.mock("../runtime/productModelCatalogRefresh", () => ({
  refreshProductModelsV1: refreshModels,
}));

vi.mock("../../../services/rendererDiagnostics", () => ({
  appendRendererDiagnostic: appendDiagnostic,
}));

afterEach(() => {
  refreshModels.mockClear();
  appendDiagnostic.mockClear();
  vi.useRealTimers();
  act(() => clearProductEntitlementV1());
});

describe("ProductAccountAppGate lifecycle", () => {
  it("renders the upstream plan as the structured product card", async () => {
    const client = productClient();
    renderGate(client);

    expect(await screen.findByRole("button", { name: "立即订阅" })).toBeTruthy();
    const card = document.querySelector(".account-product-plan");
    expect(card).toBeTruthy();
    expect(card?.querySelector(".account-product-plan-head")?.textContent)
      .toContain("Doge 全功能订阅");
    expect(card?.querySelector(".account-product-plan-price")?.textContent)
      .toContain("$0.99");
    expect(card?.textContent).toContain("Codex · Claude · Kimi CLI");
    expect(card?.textContent).toContain("GPT · Claude · 豆包 · Kimi · GLM · DeepSeek");
  });

  it("keeps paid checkout in fulfillment until entitlement becomes active", async () => {
    vi.useFakeTimers();
    const required = requiredCatalog();
    const client = productClient();
    vi.mocked(client.catalog)
      .mockResolvedValueOnce({ ok: true, value: required })
      .mockResolvedValueOnce({ ok: true, value: required })
      .mockResolvedValueOnce({ ok: true, value: activeCatalog() });
    vi.mocked(client.resumeCheckout).mockResolvedValueOnce({
      ok: true,
      value: {
        checkoutId: 77,
        status: "paid",
        expiresAt: "2030-01-01T00:30:00Z",
        planName: "Doge 全功能订阅",
        action: null,
      },
    });

    renderGate(client);
    await act(async () => {
      await flushMicrotasks();
    });

    expect(screen.getByRole("heading", { name: "支付已完成，正在开通订阅" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "立即订阅" })).toBeNull();
    expect(client.catalog).toHaveBeenNthCalledWith(2, { forceRefresh: true });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(productFulfillmentPollDelayMs(1));
      await flushMicrotasks();
    });

    expect(screen.getByText("主应用已挂载")).toBeTruthy();
    expect(client.prepare).toHaveBeenCalledTimes(1);
  });

  it("bounds fulfillment polling delay", () => {
    expect(productFulfillmentPollDelayMs(1)).toBe(1_000);
    expect(productFulfillmentPollDelayMs(99)).toBe(5_000);
  });

  it("retains checkout backoff across snapshots and retries transient failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2029-12-31T00:00:00Z"));
    const client = productClient();
    vi.mocked(client.resumeCheckout).mockResolvedValueOnce({
      ok: true,
      value: pendingCheckout(),
    });
    vi.mocked(client.readCheckout)
      .mockResolvedValueOnce({ ok: true, value: pendingCheckout() })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "serviceUnavailable", retryAfterMs: 6_000 },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { ...pendingCheckout(), status: "paid" },
      });

    renderGate(client);
    await act(async () => flushMicrotasks());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(productCheckoutPollDelayMs(0));
      await flushMicrotasks();
    });
    expect(client.readCheckout).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(productCheckoutPollDelayMs(1) - 1);
    });
    expect(client.readCheckout).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await flushMicrotasks();
    });
    expect(client.readCheckout).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(productCheckoutPollDelayMs(2));
    });
    expect(client.readCheckout).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000 - productCheckoutPollDelayMs(2));
      await flushMicrotasks();
    });
    expect(client.readCheckout).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("heading", { name: "支付已完成，正在开通订阅" })).toBeTruthy();
  });

  it("stops checkout polling at the authoritative expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:31:00Z"));
    const client = productClient();
    vi.mocked(client.resumeCheckout).mockResolvedValueOnce({
      ok: true,
      value: pendingCheckout(),
    });

    renderGate(client);
    await act(async () => flushMicrotasks());

    expect(screen.getByRole("heading", { name: "支付没有完成" })).toBeTruthy();
    expect(client.readCheckout).not.toHaveBeenCalled();
  });

  it("refreshes the dynamic model catalog when a ready app regains focus", async () => {
    const client = productClient();
    vi.mocked(client.catalog).mockResolvedValue({
      ok: true,
      value: activeCatalog(),
    });
    renderGate(client);

    expect(await screen.findByText("主应用已挂载")).toBeTruthy();
    expect(client.prepare).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await flushMicrotasks();
    });

    expect(refreshModels).toHaveBeenCalledTimes(1);
  });

  it("absorbs one transient product prepare failure without showing service unavailable", async () => {
    vi.useFakeTimers();
    const client = productClient();
    vi.mocked(client.catalog).mockResolvedValue({
      ok: true,
      value: activeCatalog(),
    });
    vi.mocked(client.prepare)
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "serviceUnavailable", stage: "productPrepare" },
      })
      .mockResolvedValueOnce({ ok: true, value: readyView() });

    renderGate(client);
    await act(async () => flushMicrotasks());
    expect(screen.queryByText("服务暂时不可用")).toBeNull();
    expect(appendDiagnostic).toHaveBeenCalledWith(
      "account/product-prepare-attempt-failed",
      expect.objectContaining({
        code: "serviceUnavailable",
        stage: "productPrepare",
        attempt: 1,
        maxAttempts: productPrepareRetryDelaysMs().length,
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(productPrepareRetryDelaysMs()[1] ?? 0);
      await flushMicrotasks();
    });

    expect(screen.getByText("主应用已挂载")).toBeTruthy();
    expect(client.prepare).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("服务暂时不可用")).toBeNull();
  });

  it("shows Doge rather than Kimi while remote product preparation is pending", async () => {
    let resolvePrepare: ((value: { ok: true; value: ProductReadyViewV1 }) => void) | null = null;
    const client = productClient();
    vi.mocked(client.catalog).mockResolvedValue({
      ok: true,
      value: activeCatalog(),
    });
    vi.mocked(client.prepare).mockReturnValue(new Promise((resolve) => {
      resolvePrepare = resolve;
    }));

    renderGate(client, async ({ onEngine } = {}) => {
      onEngine?.("kimi");
      return { ok: true };
    });
    await act(async () => flushMicrotasks());

    expect(screen.getByRole("heading", { name: "正在准备 Doge" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "正在准备 Kimi CLI" })).toBeNull();

    await act(async () => {
      resolvePrepare?.({ ok: true, value: readyView() });
      await flushMicrotasks();
    });
    expect(screen.getByText("主应用已挂载")).toBeTruthy();
  });

  it("does not configure providers when automatic engine provisioning fails", async () => {
    const client = productClient();
    vi.mocked(client.catalog).mockResolvedValue({
      ok: true,
      value: activeCatalog(),
    });
    renderGate(client, async ({ onEngine } = {}) => {
      onEngine?.("kimi");
      return {
        ok: false,
        error: { code: "engineInstallFailed", engineId: "kimi" },
      };
    });

    expect(await screen.findByText(/内置引擎暂时不可用/)).toBeTruthy();
    expect(client.prepare).not.toHaveBeenCalled();
  });
});

function renderGate(
  client: AccountProductOnboardingClientV1,
  prepareToolchains: NonNullable<
    ComponentProps<typeof ProductAccountAppGate>["prepareToolchains"]
  > = async () => ({ ok: true }),
) {
  const runtime = createScenarioRuntimeV1("session.cold-restore");
  if (!runtime.ok) throw new Error("missing authenticated account scenario");
  const gateway = createMockAccountGatewayV1(runtime.value);
  return render(
    <AccountGatewayProvider gateway={gateway}>
      <ProductAccountAppGate
        client={client}
        prepareToolchains={prepareToolchains}
        readyContent={<div>主应用已挂载</div>}
      />
    </AccountGatewayProvider>,
  );
}

function productClient(): AccountProductOnboardingClientV1 {
  return {
    catalog: vi.fn(async () => ({ ok: true as const, value: requiredCatalog() })),
    checkout: vi.fn(async () => ({
      ok: false as const,
      error: { code: "unused" },
    })),
    readCheckout: vi.fn(async () => ({
      ok: false as const,
      error: { code: "unused" },
    })),
    resumeCheckout: vi.fn(async () => ({ ok: true as const, value: null })),
    abandonCheckout: vi.fn(async () => ({ ok: true as const, value: null })),
    prepare: vi.fn(async () => ({ ok: true as const, value: readyView() })),
    models: vi.fn(async () => ({
      ok: true as const,
      value: {
        fetchedAt: "2030-01-01T00:00:00Z",
        models: readyView().models,
      },
    })),
  };
}

function requiredCatalog(): ProductCatalogViewV1 {
  return {
    entitlement: {
      status: "required",
      subscriptionId: null,
      groupId: null,
      groupName: null,
      planName: null,
      expiresAt: null,
      usage: null,
    },
    plans: [{
      id: 5,
      name: "Doge 全功能订阅",
      description: "Doge 测试描述",
      price: 0.99,
      originalPrice: null,
      currency: "USD",
      validityDays: 30,
      validityUnit: "day",
      features: ["GPT", "Claude", "豆包", "Kimi", "GLM", "DeepSeek"],
      dailyLimitUsd: null,
      weeklyLimitUsd: null,
      monthlyLimitUsd: null,
    }],
    paymentMethods: [{ id: "alipay", displayName: "支付宝", currency: "CNY" }],
    engines: productEngines(),
  };
}

function activeCatalog(): ProductCatalogViewV1 {
  return {
    ...requiredCatalog(),
    entitlement: activeEntitlement(),
  };
}

function readyView(): ProductReadyViewV1 {
  return {
    status: "ready",
    entitlement: activeEntitlement(),
    models: [{
      id: "gpt-5.6-sol",
      displayName: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      apiProtocols: ["openai-responses"],
      capabilities: ["chat"],
    }],
    engines: productEngines(),
  };
}

function pendingCheckout() {
  return {
    checkoutId: 77,
    status: "pending" as const,
    expiresAt: "2030-01-01T00:30:00Z",
    planName: "Doge 全功能订阅",
    action: null,
  };
}

function activeEntitlement() {
  const usageWindow = { usedUsd: 1, limitUsd: 10, percentage: 10 };
  return {
    status: "active" as const,
    subscriptionId: 9,
    groupId: 5,
    groupName: "Doge",
    planName: "Doge 全功能订阅",
    expiresAt: "2030-02-01T00:00:00Z",
    usage: { daily: usageWindow, weekly: usageWindow, monthly: usageWindow },
  };
}

function productEngines() {
  return [
    { id: "codex" as const, displayName: "Codex" },
    { id: "claude-code" as const, displayName: "Claude" },
    { id: "kimi" as const, displayName: "Kimi CLI" },
  ];
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}
