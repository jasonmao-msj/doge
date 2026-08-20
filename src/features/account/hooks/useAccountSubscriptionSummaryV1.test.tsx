// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  AccountSubscriptionSummaryViewV1,
  GatewayResultV1,
} from "../contracts";
import { AccountGatewayProvider } from "../gateway/AccountGatewayProvider";
import { createMockAccountGatewayV1 } from "../mock/MockAccountGatewayV1";
import { createScenarioRuntimeV1 } from "../mock/ScenarioRuntimeV1";
import {
  useAccountSubscriptionSummaryV1,
} from "./useAccountSubscriptionSummaryV1";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: "zh-CN" } }),
}));

function summaryV1(label: string): AccountSubscriptionSummaryViewV1 {
  return {
    status: "available",
    source: "token2apiSubscription",
    fetchedAt: "2032-01-01T00:00:00.000Z",
    subscriptions: [{
      id: label,
      engineId: "codex",
      engineLabel: "Codex",
      subscriptionLabel: label,
      status: "active",
      expiresAt: null,
      windows: { daily: null, weekly: null, monthly: null },
    }],
  };
}

function Probe() {
  const state = useAccountSubscriptionSummaryV1({ autoLoad: false });
  return (
    <>
      <button type="button" onClick={() => void state.load()}>load</button>
      <output>{state.summary?.subscriptions[0]?.subscriptionLabel ?? ""}</output>
    </>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useAccountSubscriptionSummaryV1", () => {
  it("aborts and ignores a stale response when a newer generation loads", async () => {
    const runtime = createScenarioRuntimeV1("subscription.summary");
    if (!runtime.ok) throw new Error("missing subscription scenario");
    const gateway = createMockAccountGatewayV1(runtime.value);
    let firstSignal: AbortSignal | undefined;
    let resolveFirst: ((result: GatewayResultV1<AccountSubscriptionSummaryViewV1>) => void) | null = null;
    let resolveSecond: ((result: GatewayResultV1<AccountSubscriptionSummaryViewV1>) => void) | null = null;
    vi.spyOn(gateway.subscription, "read")
      .mockImplementationOnce((context) => {
        firstSignal = context.signal;
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveSecond = resolve;
      }));

    render(
      <AccountGatewayProvider gateway={gateway}>
        <Probe />
      </AccountGatewayProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "load" }));
    fireEvent.click(screen.getByRole("button", { name: "load" }));
    expect(firstSignal?.aborted).toBe(true);

    await act(async () => {
      resolveFirst?.({ ok: true, value: summaryV1("stale") });
      resolveSecond?.({ ok: true, value: summaryV1("latest") });
    });
    await waitFor(() => expect(screen.getByText("latest")).toBeTruthy());
    expect(screen.queryByText("stale")).toBeNull();
  });

  it("aborts the active read when the owning surface unmounts", () => {
    const runtime = createScenarioRuntimeV1("subscription.summary");
    if (!runtime.ok) throw new Error("missing subscription scenario");
    const gateway = createMockAccountGatewayV1(runtime.value);
    let signal: AbortSignal | undefined;
    vi.spyOn(gateway.subscription, "read").mockImplementation((context) => {
      signal = context.signal;
      return new Promise(() => undefined);
    });
    const view = render(
      <AccountGatewayProvider gateway={gateway}>
        <Probe />
      </AccountGatewayProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "load" }));
    view.unmount();
    expect(signal?.aborted).toBe(true);
  });
});
