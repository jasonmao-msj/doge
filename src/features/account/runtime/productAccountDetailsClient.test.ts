import { describe, expect, it } from "vitest";
import {
  parseProductBillingDetails,
  parseProductUsageDetails,
} from "./productAccountDetailsClient";

describe("product account detail contracts", () => {
  it("maps period usage and keeps engine attribution explicitly unsupported", () => {
    const result = parseProductUsageDetails({
      ok: true,
      value: usageValue(),
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        period: "current",
        range: {
          periodStartDate: "2030-01-02",
          periodEndDate: "2030-01-31",
          source: "subscriptionMonthly",
        },
        totals: {
          requests: 7,
          cacheTokens: 10,
          averageDurationMs: 7200,
        },
        engineBreakdownStatus: "unsupported",
        models: [{ id: "gpt-5.6-sol", requests: 5 }],
      },
    });
  });

  it("rejects malformed ranges, negative counters, and invented engine breakdowns", () => {
    expect(parseProductUsageDetails({
      ok: true,
      value: {
        ...usageValue(),
        range: { ...usageValue().range, query_start_date: "not-a-date" },
      },
    })).toEqual({ ok: false, error: { code: "protocolMismatch" } });

    expect(parseProductUsageDetails({
      ok: true,
      value: {
        ...usageValue(),
        totals: { ...usageValue().totals, requests: -1 },
      },
    })).toEqual({ ok: false, error: { code: "protocolMismatch" } });

    expect(parseProductUsageDetails({
      ok: true,
      value: { ...usageValue(), engine_breakdown_status: "available" },
    })).toEqual({ ok: false, error: { code: "protocolMismatch" } });
  });

  it("maps safe subscription orders and rejects a fake invoice capability", () => {
    expect(parseProductBillingDetails({
      ok: true,
      value: {
        fetched_at: "2030-01-10T12:00:00Z",
        invoice_download_status: "unsupported",
        orders: [{
          id: 91,
          plan_name: "Doge Pro",
          occurred_at: "2030-01-01T00:01:00Z",
          amount: 86.4,
          currency: "CNY",
          status: "paid",
          invoice_available: false,
        }],
      },
    })).toMatchObject({
      ok: true,
      value: {
        orders: [{ id: 91, planName: "Doge Pro", invoiceAvailable: false }],
      },
    });

    expect(parseProductBillingDetails({
      ok: true,
      value: {
        fetched_at: "2030-01-10T12:00:00Z",
        invoice_download_status: "available",
        orders: [],
      },
    })).toEqual({ ok: false, error: { code: "protocolMismatch" } });
  });
});

function usageValue() {
  return {
    period: "current",
    fetched_at: "2030-01-10T12:00:00Z",
    range: {
      query_start_date: "2030-01-02",
      query_end_date: "2030-01-10",
      period_start_date: "2030-01-02",
      period_end_date: "2030-01-31",
      resets_at: "2030-02-01T00:00:00Z",
      source: "subscriptionMonthly",
    },
    totals: {
      requests: 7,
      input_tokens: 100,
      output_tokens: 20,
      cache_tokens: 10,
      total_tokens: 130,
      standard_cost_usd: 1.25,
      actual_cost_usd: 1,
      average_duration_ms: 7200,
    },
    quota: {
      used_usd: 1,
      limit_usd: 10,
      percentage: 10,
      resets_at: "2030-02-01T00:00:00Z",
    },
    engine_breakdown_status: "unsupported",
    models_status: "available",
    models: [{
      id: "gpt-5.6-sol",
      display_name: "gpt-5.6-sol",
      requests: 5,
      total_tokens: 100,
      standard_cost_usd: 1,
      actual_cost_usd: 0.8,
    }],
  };
}
