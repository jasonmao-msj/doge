// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProductUsageDetailsV1 } from "../runtime/productAccountDetailsClient";
import {
  ProductUsageTrendChart,
  productUsageCacheHitRate,
} from "./ProductUsageTrendChart";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: "zh-CN" } }),
}));

describe("ProductUsageTrendChart", () => {
  it("matches upstream cache-hit math and toggles a series from its legend", () => {
    const usage = usageFixture();
    expect(productUsageCacheHitRate(usage.trend[0]!)).toBe(50);

    const { container } = render(<ProductUsageTrendChart usage={usage} />);
    const cacheHitToggle = screen.getByRole("button", { name: "Cache Hit Rate" });
    expect(cacheHitToggle.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-series="cacheHitRate"]')).toBeTruthy();

    fireEvent.click(cacheHitToggle);
    expect(cacheHitToggle.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector('[data-series="cacheHitRate"]')).toBeNull();

    const hoverTarget = container.querySelector('[data-trend-index="0"]');
    if (!hoverTarget) throw new Error("missing trend hover target");
    fireEvent.mouseEnter(hoverTarget);
    const tooltip = screen.getByRole("status");
    expect(tooltip.textContent).toContain("Input: 200");
    expect(tooltip.textContent).toContain("Cache Read: 500");
    expect(tooltip.textContent).toContain("Actual: $0.080");
    expect(tooltip.textContent).toContain("Standard: $0.100");
  });
});

function usageFixture(): ProductUsageDetailsV1 {
  return {
    query: { startDate: "2030-01-01", endDate: "2030-01-02", granularity: "day" },
    fetchedAt: "2030-01-02T12:00:00Z",
    range: { queryStartDate: "2030-01-01", queryEndDate: "2030-01-02" },
    totals: {
      requests: 2,
      inputTokens: 200,
      outputTokens: 50,
      cacheTokens: 800,
      totalTokens: 1_050,
      standardCostUsd: 0.1,
      actualCostUsd: 0.08,
      averageDurationMs: 1_000,
    },
    trendStatus: "available",
    trend: [{
      bucket: "2030-01-01",
      inputTokens: 200,
      outputTokens: 50,
      cacheCreationTokens: 300,
      cacheReadTokens: 500,
      totalTokens: 1_050,
      standardCostUsd: 0.1,
      actualCostUsd: 0.08,
    }],
    modelsStatus: "available",
    models: [],
  };
}
