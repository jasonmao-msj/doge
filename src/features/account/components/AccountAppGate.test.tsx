// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockAccountGatewayV1 } from "../mock/MockAccountGatewayV1";
import { createScenarioRuntimeV1 } from "../mock/ScenarioRuntimeV1";
import type { AccountGatewayEventV1, AccountGatewayV1 } from "../contracts";
import type { AccountEngineOnboardingClientV1 } from "../runtime/engineOnboardingClient";
import { writeLastManagedEnginePreferenceV1 } from "../runtime/enginePreference";
import { AccountAppGate } from "./AccountAppGate";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: "zh-CN" } }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => undefined) }));

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

describe("AccountAppGate", () => {
  it("does not mount the app before an entitled engine is ready", async () => {
    const client = engineClient({ codexEntitled: true });
    render(<AccountAppGate gateway={authenticatedGateway()} engineClient={client} engineActivator={async () => undefined} readyContent={<div>主应用已挂载</div>} />);

    expect(screen.queryByText("主应用已挂载")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /Codex/ }));

    expect(await screen.findByText("主应用已挂载")).toBeTruthy();
    expect(client.prepare).toHaveBeenCalledWith("codex");
  });

  it("shows exactly the server plans when the engine has no entitlement", async () => {
    const client = engineClient({ codexEntitled: false });
    render(<AccountAppGate gateway={authenticatedGateway()} engineClient={client} engineActivator={async () => undefined} readyContent={<div>主应用已挂载</div>} />);

    fireEvent.click(await screen.findByRole("button", { name: /Codex/ }));

    expect(await screen.findByRole("button", { name: /Starter/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Pro/ })).toBeTruthy();
    expect(screen.queryByText(/充值|按量|API Key/i)).toBeNull();
    expect(screen.queryByText("主应用已挂载")).toBeNull();
  });

  it("automatically prepares after a paid checkout receipt", async () => {
    const client = engineClient({ codexEntitled: false });
    vi.mocked(client.readCheckout).mockResolvedValue({
      ok: true,
      value: { checkoutId: 77, status: "paid", expiresAt: "2030-01-01T00:00:00Z", action: null },
    });
    render(<AccountAppGate gateway={authenticatedGateway()} engineClient={client} engineActivator={async () => undefined} readyContent={<div>主应用已挂载</div>} />);
    fireEvent.click(await screen.findByRole("button", { name: /Codex/ }));
    const planButton = await screen.findByRole("button", { name: /Starter/ });
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(planButton);
      await Promise.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText("主应用已挂载")).toBeTruthy());
    expect(client.prepare).toHaveBeenCalledWith("codex");
  });

  it("restores a durable pending checkout before offering another plan", async () => {
    const client = engineClient({ codexEntitled: false });
    vi.mocked(client.resumeCheckout).mockResolvedValue({
      ok: true,
      value: {
        engineId: "codex",
        checkout: {
          checkoutId: 88,
          status: "pending",
          expiresAt: "2030-01-01T00:00:00Z",
          action: { kind: "open_url", url: "https://token-matrix.com/pay/88", data: null },
        },
      },
    });

    render(<AccountAppGate gateway={authenticatedGateway()} engineClient={client} engineActivator={async () => undefined} readyContent={<div>主应用已挂载</div>} />);

    expect(await screen.findByText("等待完成支付")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新打开支付" })).toBeTruthy();
    expect(client.plans).not.toHaveBeenCalled();
    expect(screen.queryByText("主应用已挂载")).toBeNull();
  });

  it("removes the app immediately when the account session signs out", async () => {
    const { gateway, expireSession } = expiringGateway();
    const client = engineClient({ codexEntitled: true });
    writeLastManagedEnginePreferenceV1("codex");
    render(<AccountAppGate gateway={gateway} engineClient={client} engineActivator={async () => undefined} readyContent={<div>主应用已挂载</div>} />);

    expect(await screen.findByText("主应用已挂载")).toBeTruthy();

    act(() => expireSession());

    await waitFor(() => expect(screen.queryByText("主应用已挂载")).toBeNull());
  });
});

function expiringGateway(): {
  readonly gateway: AccountGatewayV1;
  readonly expireSession: () => void;
} {
  const base = authenticatedGateway();
  const originalBootstrap = base.bootstrap.bind(base);
  let expired = false;
  let listener: ((event: AccountGatewayEventV1) => void) | null = null;
  const gateway = Object.create(base) as AccountGatewayV1;
  gateway.bootstrap = async (context) => {
    const result = await originalBootstrap(context);
    if (!result.ok || !expired) return result;
    return { ...result, value: { ...result.value, session: { status: "signedOut" } } };
  };
  gateway.subscribe = (next) => {
    listener = next;
    return () => { listener = null; };
  };
  return {
    gateway,
    expireSession: () => {
      expired = true;
      if (!listener) throw new Error("account event listener is unavailable");
      listener({
        kind: "sessionChanged",
        eventId: "event_test_session_expired_0001",
        emittedAt: "2030-01-01T00:00:00Z",
        processGeneration: 1,
        eventSeq: 1,
        accountEpoch: 2,
      });
    },
  };
}

function authenticatedGateway() {
  const runtime = createScenarioRuntimeV1("session.cold-restore");
  if (!runtime.ok) throw new Error("missing session scenario");
  return createMockAccountGatewayV1(runtime.value);
}

function engineClient({ codexEntitled }: { readonly codexEntitled: boolean }): AccountEngineOnboardingClientV1 {
  return {
    catalog: vi.fn(async () => ({
      ok: true as const,
      value: [
        { id: "codex" as const, displayName: "Codex", entitlement: { status: codexEntitled ? "active" as const : "none" as const, expiresAt: null } },
        { id: "claude-code" as const, displayName: "Claude Code", entitlement: { status: "none" as const, expiresAt: null } },
      ],
    })),
    plans: vi.fn(async (engineId) => ({
      ok: true as const,
      value: {
        engineId,
        plans: [plan(1, "Starter", 9), plan(2, "Pro", 29)],
        paymentMethods: [{ id: "alipay", displayName: "支付宝", currency: "CNY" }],
      },
    })),
    readiness: vi.fn(async (engineId) => ({ ok: true as const, value: { engineId, status: "ready" as const } })),
    checkout: vi.fn(async () => ({
      ok: true as const,
      value: {
        checkoutId: 77,
        status: "pending" as const,
        expiresAt: "2030-01-01T00:00:00Z",
        action: { kind: "open_url" as const, url: "https://token-matrix.com/pay/77", data: null },
      },
    })),
    readCheckout: vi.fn(async () => ({
      ok: true as const,
      value: { checkoutId: 77, status: "pending" as const, expiresAt: "2030-01-01T00:00:00Z", action: null },
    })),
    resumeCheckout: vi.fn(async () => ({ ok: true as const, value: null })),
    prepare: vi.fn(async (engineId) => ({ ok: true as const, value: { engineId, status: "ready" as const } })),
  };
}

function plan(id: number, name: string, price: number) {
  return {
    id,
    name,
    description: "",
    price,
    originalPrice: null,
    currency: "CNY",
    validityDays: 30,
    validityUnit: "day",
    features: [],
    dailyLimitUsd: null,
    weeklyLimitUsd: null,
    monthlyLimitUsd: null,
  };
}
