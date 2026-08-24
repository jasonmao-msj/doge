// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearProductEntitlementV1,
  publishProductReadyV1,
} from "../runtime/productEntitlementStore";
import { AccountSidebarShortcut } from "./AccountSidebarShortcut";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: "zh-CN" } }),
}));

function renderShortcut() {
  const onOpenAccount = vi.fn();
  render(
    <AccountSidebarShortcut
      accountLabel="Synthetic doge account"
      onOpenAccount={onOpenAccount}
    />,
  );
  return { onOpenAccount };
}

afterEach(() => {
  act(() => clearProductEntitlementV1());
  vi.restoreAllMocks();
});

describe("AccountSidebarShortcut", () => {
  it("renders the unified product snapshot without an engine-scoped read", () => {
    act(() =>
      publishProductReadyV1({
        entitlement: {
          status: "active",
          subscriptionId: 9,
          groupId: 5,
          groupName: "Doge APP",
          planName: "Doge APP",
          expiresAt: "2030-02-01T00:00:00Z",
          usage: {
            daily: { usedUsd: 0.23, limitUsd: 1, percentage: 23.4 },
            weekly: { usedUsd: 0.23, limitUsd: 7, percentage: 3.3 },
            monthly: { usedUsd: 0.23, limitUsd: 30, percentage: 0.8 },
          },
        },
        engines: [
          { id: "codex", displayName: "Codex" },
          { id: "claude-code", displayName: "Claude" },
          { id: "kimi", displayName: "Kimi CLI" },
        ],
        models: [
          {
            id: "gpt-5.6-luna",
            displayName: "gpt-5.6-luna",
            model: "gpt-5.6-luna",
            compatibleEngines: ["codex"],
            capabilities: ["chat"],
          },
        ],
      }),
    );
    renderShortcut();

    fireEvent.click(screen.getByRole("button", { name: /账号中心/ }));
    expect(screen.getByText("Doge APP")).toBeTruthy();
    expect(screen.getByText("23%")).toBeTruthy();
  });

  it("hands off to Settings account from the compact surface", () => {
    const { onOpenAccount } = renderShortcut();
    fireEvent.click(screen.getByRole("button", { name: /账号中心/ }));
    fireEvent.click(screen.getByRole("button", { name: "账号中心" }));
    expect(onOpenAccount).toHaveBeenCalledTimes(1);
  });

  it("keeps the unknown snapshot safe without reviving engine subscriptions", () => {
    renderShortcut();
    fireEvent.click(screen.getByRole("button", { name: /账号中心/ }));
    expect(screen.getByRole("status")).toBeTruthy();
    expect(
      document.querySelector('[data-summary-status="unknown"]'),
    ).toBeTruthy();
    expect(screen.queryByText(/Codex plan|Claude plan/)).toBeNull();
  });
});
