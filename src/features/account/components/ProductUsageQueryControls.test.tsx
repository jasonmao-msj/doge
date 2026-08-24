// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductUsageQueryControls } from "./ProductUsageQueryControls";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { resolvedLanguage: "zh-CN" } }),
}));

describe("ProductUsageQueryControls", () => {
  it("applies an upstream-compatible preset and recommends hourly granularity", () => {
    const onChange = vi.fn();
    render(
      <ProductUsageQueryControls
        query={{
          startDate: "2030-01-01",
          endDate: "2030-01-07",
          granularity: "day",
        }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "时间范围" }));
    fireEvent.click(screen.getByRole("button", { name: "今天" }));
    fireEvent.click(screen.getByRole("button", { name: "应用" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const nextQuery = onChange.mock.calls[0]?.[0];
    expect(nextQuery.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(nextQuery.endDate).toBe(nextQuery.startDate);
    expect(nextQuery.granularity).toBe("hour");
  });

  it("exposes day and hour as an explicit upstream granularity selector", () => {
    const onChange = vi.fn();
    render(
      <ProductUsageQueryControls
        query={{
          startDate: "2030-01-01",
          endDate: "2030-01-07",
          granularity: "day",
        }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "粒度" }));
    fireEvent.click(screen.getByRole("option", { name: "按小时" }));

    expect(onChange).toHaveBeenCalledWith({
      startDate: "2030-01-01",
      endDate: "2030-01-07",
      granularity: "hour",
    });
  });
});
