// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CostBudgetSection } from "../../../../status-panel/components/CostBudgetSection";
import { CostBudgetSettingsSection } from "./CostBudgetSettingsSection";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      const values = params ? Object.values(params).map(String).join("|") : "";
      return values ? `${key}:${values}` : key;
    },
  }),
}));

const usage = {
  total: {
    totalTokens: 2000,
    inputTokens: 1200,
    cachedInputTokens: 200,
    outputTokens: 800,
    reasoningOutputTokens: 100,
  },
  last: {
    totalTokens: 2000,
    inputTokens: 1200,
    cachedInputTokens: 200,
    outputTokens: 800,
    reasoningOutputTokens: 100,
  },
  modelContextWindow: 200000,
};

describe("CostBudgetSettingsSection", () => {
  afterEach(() => {
    window.localStorage.removeItem("doge.flags.statusPanel.costV2");
    window.localStorage.removeItem("doge.statusPanel.monthlyBudget.v1");
  });

  it("updates the StatusPanel budget bar in the same app session", async () => {
    window.localStorage.setItem("doge.flags.statusPanel.costV2", "1");
    render(
      <>
        <CostBudgetSettingsSection />
        <CostBudgetSection
          engine="codex"
          model="gpt-5.4"
          sessionId="budget-settings-session"
          usage={usage}
        />
      </>,
    );

    expect(screen.getByText("statusPanel.budget.unsetShort")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("settings.costBudgetMonthlyLimit"), {
      target: { value: "1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "settings.costBudgetSave" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("statusPanel.budget.progress:$0.01|$1.00"),
      ).toBeTruthy();
    });
    expect(screen.queryByText("statusPanel.budget.unconfigured")).toBeNull();
  });
});
