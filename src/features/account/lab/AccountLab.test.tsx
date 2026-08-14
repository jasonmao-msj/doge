/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccountLab, isAccountLabAvailableV1 } from "./AccountLab";

describe("AccountLab", () => {
  it("is available to tests without registering a global route", () => {
    expect(isAccountLabAvailableV1()).toBe(true);
  });

  it("renders the consumer shell from a canonical mock scenario", () => {
    render(<AccountLab language="en" />);

    expect(screen.getByRole("heading", { name: "Account Lab" })).not.toBeNull();
    expect(
      screen.getByLabelText("Account Gateway contract").textContent,
    ).toContain("@");
    expect(
      screen.getByRole("heading", { name: "bootstrap.signed-out-happy" }),
    ).not.toBeNull();
    expect(screen.getByRole("option", { name: "login.happy" })).not.toBeNull();
    expect(
      screen.getByRole("option", { name: "configuration.conflict-review" }),
    ).not.toBeNull();
    expect(screen.getByRole("option", { name: "bootstrap.offline" })).not.toBeNull();
  });

  it("runs a zero-latency transition and exposes debug-safe history", async () => {
    render(<AccountLab />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Run next transition" }),
      );
      await Promise.resolve();
    });

    expect(screen.getByLabelText("Last scenario outcome").textContent).toBe(
      "success",
    );
    expect(screen.getByText("operationSettled")).not.toBeNull();
    expect(screen.getAllByText("gateway.bootstrap").length).toBeGreaterThan(0);
  });

  it("selects a latency scenario and advances only with the virtual clock", async () => {
    render(<AccountLab />);

    fireEvent.change(screen.getByLabelText("Scenario"), {
      target: { value: "bootstrap.capabilities-loading-slow" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Run next transition" }),
    );

    expect(screen.getByLabelText("Last scenario outcome").textContent).toBe(
      "pending",
    );
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Reset scenario",
      }).disabled,
    ).toBe(true);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Advance to next settlement" }),
      );
      await Promise.resolve();
    });

    expect(screen.getByLabelText("Last scenario outcome").textContent).toBe(
      "nonterminal",
    );
    expect(screen.getByText("2032-04-05T10:00:01.500Z")).not.toBeNull();
  });

  it("fails an unknown scenario closed while keeping Local Mode copy available", () => {
    render(<AccountLab initialScenarioId="unknown.account.scenario" language="zh" />);

    expect(screen.getByRole("alert")).not.toBeNull();
    expect(screen.getByText("请求的场景不可用，已安全关闭。")).not.toBeNull();
    expect(screen.getByText("unknown.account.scenario")).not.toBeNull();
  });
});
