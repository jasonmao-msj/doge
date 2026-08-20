// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountGatewayProvider } from "../gateway/AccountGatewayProvider";
import { createMockAccountGatewayV1 } from "../mock/MockAccountGatewayV1";
import { createScenarioRuntimeV1 } from "../mock/ScenarioRuntimeV1";
import { AccountSidebarShortcut } from "./AccountSidebarShortcut";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: "zh-CN" } }),
}));

function renderShortcut(scenarioId = "subscription.summary") {
  const runtime = createScenarioRuntimeV1(scenarioId);
  if (!runtime.ok) throw new Error(`missing scenario ${scenarioId}`);
  const gateway = createMockAccountGatewayV1(runtime.value);
  const onOpenAccount = vi.fn();
  render(
    <AccountGatewayProvider gateway={gateway}>
      <AccountSidebarShortcut
        accountLabel="Synthetic doge account"
        onOpenAccount={onOpenAccount}
      />
    </AccountGatewayProvider>,
  );
  return { gateway, onOpenAccount };
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(1_893_456_000_000);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AccountSidebarShortcut", () => {
  it("does not prefetch and reads only after the popover opens", async () => {
    const { gateway } = renderShortcut();
    const read = vi.spyOn(gateway.subscription, "read");
    expect(read).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /账号中心/ }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Synthetic Codex plan")).toBeTruthy();
  });

  it("hands off to Settings account from the compact surface", async () => {
    const { onOpenAccount } = renderShortcut();
    fireEvent.click(screen.getByRole("button", { name: /账号中心/ }));
    expect(await screen.findByText("Synthetic Claude plan")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "账号中心" }));
    expect(onOpenAccount).toHaveBeenCalledTimes(1);
  });

  it("keeps an unavailable read safe and retryable", async () => {
    const { gateway } = renderShortcut("subscription.summary-unavailable");
    fireEvent.click(screen.getByRole("button", { name: /账号中心/ }));
    expect(await screen.findByText("暂时无法读取额度，本地功能不受影响。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
    expect(gateway.subscription.read).toBeDefined();
  });
});
