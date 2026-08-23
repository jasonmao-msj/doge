// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProductAccountDetailsStateV1 } from "../hooks/useProductAccountDetails";
import type { ProductEntitlementSnapshotV1 } from "../runtime/productEntitlementStore";
import { ProductAccountDetails } from "./ProductAccountDetails";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: "zh-CN" } }),
}));

describe("ProductAccountDetails", () => {
  it("keeps real usage visible while billing has its own loading skeleton", () => {
    const selectPeriod = vi.fn();
    const { container } = render(
      <ProductAccountDetails
        product={productSnapshot()}
        details={detailsState({
          selectPeriod,
          billing: { value: null, loading: true, failure: null },
        })}
      />,
    );

    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("模型 TOP")).toBeTruthy();
    expect(screen.getByText(/暂未记录 Doge 的运行引擎/)).toBeTruthy();
    expect(container.querySelector(".account-billing-skeleton")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /下载/ })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "上期" }));
    expect(selectPeriod).toHaveBeenCalledWith("previous");
  });

  it("renders a section-local retry without clearing subscription details", () => {
    const refreshUsage = vi.fn(async () => undefined);
    render(
      <ProductAccountDetails
        product={productSnapshot()}
        details={detailsState({
          usage: {
            value: null,
            loading: false,
            failure: { code: "serviceUnavailable" },
          },
          refreshUsage,
        })}
      />,
    );

    expect(screen.getByText("Doge Pro")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(refreshUsage).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a missing current quota window from an unavailable historical limit", () => {
    const current = detailsState();
    render(
      <ProductAccountDetails
        product={productSnapshot()}
        details={{
          ...current,
          usage: {
            ...current.usage,
            value: current.usage.value
              ? { ...current.usage.value, quota: null }
              : null,
          },
        }}
      />,
    );

    expect(screen.getByText(/暂未返回本期套餐额度窗口/)).toBeTruthy();
    expect(screen.queryByText(/上期额度上限未由服务保留/)).toBeNull();
  });

  it("explains the icon-only billing refresh on pointer and keyboard access", async () => {
    render(
      <ProductAccountDetails
        product={productSnapshot()}
        details={detailsState()}
      />,
    );

    const refresh = screen.getByRole("button", { name: "刷新账单" });
    await act(async () => {
      fireEvent.pointerMove(refresh);
      fireEvent.mouseEnter(refresh);
    });
    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-popup"]')?.textContent)
        .toContain("刷新账单");
    });

    fireEvent.mouseLeave(refresh);
    fireEvent.focus(refresh);
    await waitFor(() => {
      expect(document.querySelector('[data-slot="tooltip-popup"]')?.textContent)
        .toContain("刷新账单");
    });
  });
});

function productSnapshot(): ProductEntitlementSnapshotV1 {
  return {
    status: "ready",
    entitlement: {
      status: "active",
      subscriptionId: 9,
      groupId: 5,
      groupName: "Doge",
      planName: "Doge Pro",
      expiresAt: "2030-02-01T00:00:00Z",
      usage: {
        daily: { usedUsd: 1, limitUsd: 10, percentage: 10 },
        weekly: { usedUsd: 2, limitUsd: 20, percentage: 10 },
        monthly: { usedUsd: 3, limitUsd: 30, percentage: 10 },
      },
    },
    engines: [
      { id: "codex", displayName: "Codex" },
      { id: "claude-code", displayName: "Claude" },
      { id: "kimi", displayName: "Kimi" },
    ],
    models: [{
      id: "gpt-5.6-sol",
      displayName: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      compatibleEngines: ["codex"],
      capabilities: ["chat"],
    }],
    modelsStatus: "ready",
    modelsUpdatedAt: 1_893_456_000_000,
    modelsError: null,
  };
}

function detailsState(
  overrides: Partial<ProductAccountDetailsStateV1> = {},
): ProductAccountDetailsStateV1 {
  return {
    selectedPeriod: "current",
    usage: {
      value: {
        period: "current",
        fetchedAt: "2030-01-10T12:00:00Z",
        range: {
          queryStartDate: "2030-01-02",
          queryEndDate: "2030-01-10",
          periodStartDate: "2030-01-02",
          periodEndDate: "2030-01-31",
          resetsAt: "2030-02-01T00:00:00Z",
          source: "subscriptionMonthly",
        },
        totals: {
          requests: 7,
          inputTokens: 100,
          outputTokens: 20,
          cacheTokens: 10,
          totalTokens: 130,
          standardCostUsd: 1.25,
          actualCostUsd: 1,
          averageDurationMs: 7200,
        },
        quota: {
          usedUsd: 1,
          limitUsd: 10,
          percentage: 10,
          resetsAt: "2030-02-01T00:00:00Z",
        },
        engineBreakdownStatus: "unsupported",
        modelsStatus: "available",
        models: [{
          id: "gpt-5.6-sol",
          displayName: "gpt-5.6-sol",
          requests: 5,
          totalTokens: 100,
          standardCostUsd: 1,
          actualCostUsd: 0.8,
        }],
      },
      loading: false,
      failure: null,
    },
    billing: {
      value: {
        fetchedAt: "2030-01-10T12:00:00Z",
        invoiceDownloadStatus: "unsupported",
        orders: [],
      },
      loading: false,
      failure: null,
    },
    refreshing: false,
    lastUpdatedAt: "2030-01-10T12:00:00Z",
    selectPeriod: () => undefined,
    refreshUsage: async () => undefined,
    refreshBilling: async () => undefined,
    refreshAll: async () => undefined,
    ...overrides,
  };
}
