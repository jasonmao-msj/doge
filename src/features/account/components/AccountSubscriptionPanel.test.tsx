// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountGatewayProvider } from "../gateway/AccountGatewayProvider";
import { createMockAccountGatewayV1 } from "../mock/MockAccountGatewayV1";
import { createScenarioRuntimeV1 } from "../mock/ScenarioRuntimeV1";
import { subscribeAccountEngineSwitchV1 } from "../runtime/engineSwitchSignal";
import { AccountSubscriptionPanel } from "./AccountSubscriptionPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: "zh-CN" } }),
}));

function renderScenarioV1(scenarioId: string, enabled = true) {
  const runtime = createScenarioRuntimeV1(scenarioId);
  if (!runtime.ok) throw new Error(`missing scenario ${scenarioId}`);
  const gateway = createMockAccountGatewayV1(runtime.value);
  vi.spyOn(gateway.subscription, "read");
  render(
    <AccountGatewayProvider gateway={gateway}>
      <AccountSubscriptionPanel enabled={enabled} />
    </AccountGatewayProvider>,
  );
  return gateway;
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(1_893_456_000_000);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AccountSubscriptionPanel", () => {
  it("renders authority plan facts, daily usage, and expiry", async () => {
    const gateway = renderScenarioV1("subscription.summary");
    expect(await screen.findByText("Synthetic Codex plan")).toBeTruthy();
    expect(screen.getByText("US$1.00 / US$10.00")).toBeTruthy();
    expect(screen.getAllByText(/订阅到期/).length).toBeGreaterThan(0);
    expect(gateway.subscription.read).toHaveBeenCalledTimes(1);
  });

  it("keeps multiple identities and unmapped plans separate", async () => {
    renderScenarioV1("subscription.summary-multiple");
    expect(await screen.findByText("Synthetic Codex team plan")).toBeTruthy();
    expect(screen.getByText("Synthetic future plan")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Synthetic future plan/ })).toBeNull();
    expect(screen.getAllByText("Synthetic Codex plan")).toHaveLength(1);
    expect(screen.getAllByText("Synthetic Codex team plan")).toHaveLength(1);
  });

  it("hands mapped cards to the engine switch flow without making unmapped cards actionable", async () => {
    renderScenarioV1("subscription.summary");
    const intents: unknown[] = [];
    const unsubscribe = subscribeAccountEngineSwitchV1((intent) => intents.push(intent));
    fireEvent.click(await screen.findByRole("button", { name: /Claude: Synthetic Claude plan/ }));
    unsubscribe();
    expect(intents).toEqual([{
      source: "accountCenter",
      targetEngineId: "claude-code",
      openNewConversation: true,
    }]);
  });

  it("shows a safe unavailable state without fabricating subscription facts", async () => {
    renderScenarioV1("subscription.summary-unavailable");
    expect(await screen.findByText("暂时无法读取额度，本地功能不受影响。")).toBeTruthy();
    expect(screen.queryByText("Synthetic Codex plan")).toBeNull();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
  });

  it("does not read when the subscription capability is disabled", async () => {
    const gateway = renderScenarioV1("subscription.summary", false);
    await waitFor(() => expect(gateway.subscription.read).not.toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
  });
});
