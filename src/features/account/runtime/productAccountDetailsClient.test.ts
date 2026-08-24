import { describe, expect, it } from "vitest";
import {
  parseProductBillingDetails,
  parseProductUsageDetails,
} from "./productAccountDetailsClient";

describe("product account detail contracts", () => {
  it("maps a validated range query and upstream per-model usage facts", () => {
    const result = parseProductUsageDetails({
      ok: true,
      value: usageValue(),
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        query: {
          startDate: "2030-01-02",
          endDate: "2030-01-10",
          granularity: "day",
        },
        range: {
          queryStartDate: "2030-01-02",
          queryEndDate: "2030-01-10",
        },
        totals: {
          requests: 7,
          cacheTokens: 10,
          averageDurationMs: 7200,
        },
        trendStatus: "available",
        trend: [{ bucket: "2030-01-02", inputTokens: 100 }],
        models: [{
          id: "gpt-5.6-sol",
          requests: 5,
          totalTokens: 100,
          actualCostUsd: 0.8,
          standardCostUsd: 1,
        }],
      },
    });
  });

  it("rejects malformed ranges, granularities, and negative counters", () => {
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
      value: {
        ...usageValue(),
        query: { ...usageValue().query, granularity: "week" },
      },
    })).toEqual({ ok: false, error: { code: "protocolMismatch" } });
  });

  it("maps safe subscription orders without an invoice capability", () => {
    expect(parseProductBillingDetails({
      ok: true,
      value: {
        fetched_at: "2030-01-10T12:00:00Z",
        orders: [{
          id: 91,
          plan_name: "Doge Pro",
          occurred_at: "2030-01-01T00:01:00Z",
          amount: 86.4,
          currency: "CNY",
          status: "paid",
        }],
      },
    })).toMatchObject({
      ok: true,
      value: {
        orders: [{ id: 91, planName: "Doge Pro" }],
      },
    });
  });
});

function usageValue() {
  return {
    query: {
      start_date: "2030-01-02",
      end_date: "2030-01-10",
      granularity: "day",
    },
    fetched_at: "2030-01-10T12:00:00Z",
    range: {
      query_start_date: "2030-01-02",
      query_end_date: "2030-01-10",
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
    trend_status: "available",
    trend: [{
      bucket: "2030-01-02",
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_tokens: 4,
      cache_read_tokens: 6,
      total_tokens: 130,
      standard_cost_usd: 0.1,
      actual_cost_usd: 0.08,
    }],
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
