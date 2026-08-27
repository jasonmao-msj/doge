// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProductAccountDetailsStateV1 } from "../hooks/useProductAccountDetails";
import type { ProductEntitlementSnapshotV1 } from "../runtime/productEntitlementStore";
import { ProductAccountDetails } from "./ProductAccountDetails";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: "zh-CN" } }),
}));

describe("ProductAccountDetails", () => {
  it("keeps real usage visible while billing has its own loading skeleton", () => {
    const { container } = render(
      <ProductAccountDetails
        product={productSnapshot()}
        details={detailsState({
          billing: { value: null, loading: true, failure: null },
        })}
      />,
    );

    expect(screen.getByText("7")).toBeTruthy();
    const modelTable = screen.getByRole("table", { name: "模型用量" });
    expect(within(modelTable).getByRole("columnheader", { name: "请求" })).toBeTruthy();
    expect(within(modelTable).getByRole("columnheader", { name: "Token" })).toBeTruthy();
    expect(within(modelTable).getByRole("columnheader", { name: "实际用量" })).toBeTruthy();
    expect(within(modelTable).getByRole("columnheader", { name: "标准用量" })).toBeTruthy();
    expect(within(modelTable).getByText("gpt-5.6-sol")).toBeTruthy();
    expect(within(modelTable).getByText("US$0.80")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Token 使用趋势" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cache Hit Rate" })).toBeTruthy();
    expect(screen.queryByText("按引擎")).toBeNull();
    expect(container.querySelector(".account-billing-skeleton")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /下载/ })).toBeNull();
    expect(screen.queryByText(/发票/)).toBeNull();
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

  it("does not render quota or engine-unavailable filler copy", () => {
    const current = detailsState();
    render(
      <ProductAccountDetails
        product={productSnapshot()}
        details={{
          ...current,
          usage: current.usage,
        }}
      />,
    );

    expect(screen.queryByText(/暂未返回本期套餐额度窗口/)).toBeNull();
    expect(screen.queryByText(/上期额度上限未由服务保留/)).toBeNull();
    expect(screen.queryByText(/暂未记录 Doge 的运行引擎/)).toBeNull();
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

  it("progressively expands and collapses available models by vendor", () => {
    render(
      <ProductAccountDetails
        product={productSnapshot()}
        details={detailsState()}
      />,
    );

    const openaiToggle = screen.getByRole("button", {
      name: "展开 OpenAI 模型",
    });
    expect(openaiToggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("2 个模型")).toBeTruthy();
    expect(screen.getByRole("button", { name: "展开 Kimi 模型" })).toBeTruthy();
    expect(screen.queryByText("GPT-5.5")).toBeNull();

    fireEvent.click(openaiToggle);
    expect(screen.getByRole("button", { name: "收起 OpenAI 模型" })).toBeTruthy();
    expect(screen.getByText("GPT-5.5")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "收起 OpenAI 模型" }));
    expect(screen.queryByText("GPT-5.5")).toBeNull();
    expect(screen.queryByText(/发票/)).toBeNull();
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
    models: [
      {
        id: "gpt-5.6-sol",
        displayName: "GPT-5.6 Sol",
        model: "gpt-5.6-sol",
        apiProtocols: ["openai-responses"],
        capabilities: ["chat"],
      },
      {
        id: "gpt-5.5",
        displayName: "GPT-5.5",
        model: "gpt-5.5",
        apiProtocols: ["openai-responses"],
        capabilities: ["chat"],
      },
      {
        id: "kimi-for-coding",
        displayName: "Kimi for Coding",
        model: "kimi-for-coding",
        apiProtocols: ["openai-responses", "openai-chat-completions"],
        capabilities: ["chat"],
      },
    ],
    modelsStatus: "ready",
    modelsUpdatedAt: 1_893_456_000_000,
    modelsError: null,
  };
}

function detailsState(
  overrides: Partial<ProductAccountDetailsStateV1> = {},
): ProductAccountDetailsStateV1 {
  return {
    selectedUsageQuery: {
      startDate: "2030-01-02",
      endDate: "2030-01-10",
      granularity: "day",
    },
    usage: {
      value: {
        query: {
          startDate: "2030-01-02",
          endDate: "2030-01-10",
          granularity: "day",
        },
        fetchedAt: "2030-01-10T12:00:00Z",
        range: {
          queryStartDate: "2030-01-02",
          queryEndDate: "2030-01-10",
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
        trendStatus: "available",
        trend: [{
          bucket: "2030-01-02",
          inputTokens: 100,
          outputTokens: 20,
          cacheCreationTokens: 4,
          cacheReadTokens: 6,
          totalTokens: 130,
          standardCostUsd: 0.1,
          actualCostUsd: 0.08,
        }, {
          bucket: "2030-01-10",
          inputTokens: 180,
          outputTokens: 30,
          cacheCreationTokens: 8,
          cacheReadTokens: 12,
          totalTokens: 230,
          standardCostUsd: 0.2,
          actualCostUsd: 0.16,
        }],
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
        orders: [],
      },
      loading: false,
      failure: null,
    },
    refreshing: false,
    lastUpdatedAt: "2030-01-10T12:00:00Z",
    selectUsageQuery: () => undefined,
    refreshUsage: async () => undefined,
    refreshBilling: async () => undefined,
    refreshAll: async () => undefined,
    ...overrides,
  };
}
