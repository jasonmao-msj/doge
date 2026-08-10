// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SessionControlQuotaPane } from "./SessionControlQuotaPane";
import type { SessionOverviewQuotaView } from "../../../../status-panel/utils/sessionOverviewViewModel";

const windowsQuota: SessionOverviewQuotaView = {
  source: "coding_plan",
  providerLabel: "minimax",
  showRemaining: false,
  planType: null,
  windows: [
    {
      id: "five_hour",
      label: "5小时",
      displayPercent: 42,
      usedPercent: 42,
      resetsAt: null,
    },
  ],
  creditsBalance: null,
  creditsUnlimited: false,
  hasCredits: false,
  usageSummary: null,
  error: null,
  loading: false,
};

const balanceQuota: SessionOverviewQuotaView = {
  source: "coding_plan",
  providerLabel: "deepseek",
  showRemaining: false,
  planType: null,
  windows: [],
  creditsBalance: "CNY 110.00",
  creditsUnlimited: false,
  hasCredits: true,
  usageSummary: null,
  error: null,
  loading: false,
};

const sub2apiQuota: SessionOverviewQuotaView = {
  source: "coding_plan",
  providerLabel: "https://relay.example.com sub2api",
  showRemaining: false,
  planType: "钱包余额",
  windows: [],
  creditsBalance: "USD 0.57",
  creditsUnlimited: false,
  hasCredits: true,
  usageSummary: {
    totalRequests: 1,
    totalActualCost: "0.01",
    totalInputTokens: 6608,
    totalOutputTokens: 11,
    totalTokens: 19675,
    averageDurationMs: 3885,
  },
  error: null,
  loading: false,
};

describe("formatCompactTokenCount", () => {
  it("uses B for billion-scale tokens", async () => {
    const { formatCompactTokenCount } = await import(
      "./SessionControlQuotaPane"
    );
    expect(formatCompactTokenCount(2_419_000_000)).toMatch(/2\.42B|2\.4B/);
    expect(formatCompactTokenCount(6608)).toBe("6.6K");
  });
});

describe("SessionControlQuotaPane", () => {
  it("renders coding-plan window metrics from overview view model", () => {
    render(<SessionControlQuotaPane quota={windowsQuota} />);

    const pane = screen.getByTestId("composer-session-quota-pane");
    expect(pane.textContent).toMatch(/42%/);
    expect(pane.textContent).toMatch(/minimax/i);
  });

  it("renders balance-only deepseek credits without windows", () => {
    render(<SessionControlQuotaPane quota={balanceQuota} />);

    const pane = screen.getByTestId("composer-session-quota-pane");
    expect(pane.textContent).toContain("CNY 110.00");
    expect(pane.textContent).toMatch(/deepseek/i);
  });

  it("renders sub2api usage summary rows", () => {
    render(<SessionControlQuotaPane quota={sub2apiQuota} />);

    const pane = screen.getByTestId("composer-session-quota-pane");
    expect(pane.textContent).toContain("USD 0.57");
    expect(pane.textContent).toMatch(/1/);
    expect(pane.textContent).toContain("$0.01");
    expect(pane.textContent).toMatch(/6\.6K\s*\/\s*11/);
    expect(pane.textContent).toMatch(/19\.7K/);
    expect(pane.textContent).toMatch(/3\.88s/);
    expect(pane.textContent).toContain("https://relay.example.com sub2api");
  });

  it("shows friendly error without raw http body", () => {
    render(
      <SessionControlQuotaPane
        quota={{
          ...balanceQuota,
          hasCredits: false,
          creditsBalance: null,
          source: "error",
          error: "该中转站暂不支持额度查询",
        }}
      />,
    );
    const pane = screen.getByTestId("composer-session-quota-pane");
    expect(pane.textContent).toContain("该中转站暂不支持额度查询");
    expect(pane.textContent).not.toMatch(/HTTP|404|stack/i);
  });

  it("invokes onRefresh when refresh is clicked", () => {
    const onRefresh = vi.fn();
    render(
      <SessionControlQuotaPane quota={windowsQuota} onRefresh={onRefresh} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
