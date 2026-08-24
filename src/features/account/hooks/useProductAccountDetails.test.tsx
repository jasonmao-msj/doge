// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProductAccountDetailsClientV1,
  ProductUsageQueryV1,
} from "../runtime/productAccountDetailsClient";
import {
  clearProductEntitlementV1,
  publishProductReadyV1,
} from "../runtime/productEntitlementStore";
import { useProductAccountDetailsV1 } from "./useProductAccountDetails";

describe("useProductAccountDetailsV1", () => {
  beforeEach(() => act(() => publishReady(9)));
  afterEach(() => act(() => clearProductEntitlementV1()));

  it("loads usage and billing independently and keeps successful usage on billing failure", async () => {
    const usageRequest = deferred<Awaited<ReturnType<ProductAccountDetailsClientV1["usage"]>>>();
    const billingRequest = deferred<Awaited<ReturnType<ProductAccountDetailsClientV1["billing"]>>>();
    const client: ProductAccountDetailsClientV1 = {
      usage: vi.fn(() => usageRequest.promise),
      billing: vi.fn(() => billingRequest.promise),
    };
    const { result } = renderHook(() => useProductAccountDetailsV1(client));

    await act(async () => {
      usageRequest.resolve({
        ok: true,
        value: usageView(result.current.selectedUsageQuery, 7),
      });
      billingRequest.resolve({ ok: false, error: { code: "serviceUnavailable" } });
      await Promise.all([usageRequest.promise, billingRequest.promise]);
    });
    await waitFor(() => expect(result.current.usage.value?.totals.requests).toBe(7));
    await waitFor(() => expect(result.current.billing.failure?.code).toBe("serviceUnavailable"));
    expect(result.current.usage.failure).toBeNull();

    const rangeRequest = deferred<Awaited<ReturnType<ProductAccountDetailsClientV1["usage"]>>>();
    vi.mocked(client.usage).mockReturnValueOnce(rangeRequest.promise);
    const rangeQuery: ProductUsageQueryV1 = {
      startDate: "2030-01-01",
      endDate: "2030-01-31",
      granularity: "day",
    };
    act(() => result.current.selectUsageQuery(rangeQuery));
    await waitFor(() => expect(client.usage).toHaveBeenCalledTimes(2));
    await act(async () => {
      rangeRequest.resolve({ ok: true, value: usageView(rangeQuery, 8) });
      await rangeRequest.promise;
    });
    await waitFor(() => expect(result.current.usage.value?.query).toEqual(rangeQuery));
  });

  it("rejects a stale account generation without clearing the newer request owner", async () => {
    const first = deferred<Awaited<ReturnType<ProductAccountDetailsClientV1["usage"]>>>();
    const second = deferred<Awaited<ReturnType<ProductAccountDetailsClientV1["usage"]>>>();
    const usage = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const client: ProductAccountDetailsClientV1 = {
      usage,
      billing: vi.fn(() => new Promise<
        Awaited<ReturnType<ProductAccountDetailsClientV1["billing"]>>
      >(() => undefined)),
    };
    const { result } = renderHook(() => useProductAccountDetailsV1(client));
    await waitFor(() => expect(usage).toHaveBeenCalledTimes(1));

    act(() => publishReady(10));
    await waitFor(() => expect(usage).toHaveBeenCalledTimes(2));

    await act(async () => {
      first.resolve({
        ok: true,
        value: usageView(result.current.selectedUsageQuery, 1),
      });
      await first.promise;
    });
    expect(result.current.usage.value).toBeNull();
    expect(result.current.usage.loading).toBe(true);

    await act(async () => {
      second.resolve({
        ok: true,
        value: usageView(result.current.selectedUsageQuery, 12),
      });
      await second.promise;
    });
    await waitFor(() => expect(result.current.usage.value?.totals.requests).toBe(12));
  });

  it("keeps a slow previous range from overwriting the newly selected query", async () => {
    const first = deferred<Awaited<ReturnType<ProductAccountDetailsClientV1["usage"]>>>();
    const second = deferred<Awaited<ReturnType<ProductAccountDetailsClientV1["usage"]>>>();
    const usage = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const client: ProductAccountDetailsClientV1 = {
      usage,
      billing: vi.fn(() => new Promise<
        Awaited<ReturnType<ProductAccountDetailsClientV1["billing"]>>
      >(() => undefined)),
    };
    const { result } = renderHook(() => useProductAccountDetailsV1(client));
    await waitFor(() => expect(usage).toHaveBeenCalledTimes(1));
    const firstQuery = vi.mocked(usage).mock.calls[0]?.[0];
    if (!firstQuery) throw new Error("missing initial usage query");
    const secondQuery: ProductUsageQueryV1 = {
      startDate: "2030-01-01",
      endDate: "2030-01-07",
      granularity: "hour",
    };

    act(() => result.current.selectUsageQuery(secondQuery));
    await waitFor(() => expect(usage).toHaveBeenCalledTimes(2));

    await act(async () => {
      first.resolve({ ok: true, value: usageView(firstQuery, 1) });
      await first.promise;
    });
    expect(result.current.usage.value).toBeNull();
    expect(result.current.usage.loading).toBe(true);

    await act(async () => {
      second.resolve({ ok: true, value: usageView(secondQuery, 9) });
      await second.promise;
    });
    await waitFor(() => expect(result.current.usage.value?.query).toEqual(secondQuery));
    expect(result.current.usage.value?.totals.requests).toBe(9);
  });
});

function publishReady(subscriptionId: number): void {
  publishProductReadyV1({
    entitlement: {
      status: "active",
      subscriptionId,
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
  });
}

function usageView(query: ProductUsageQueryV1, requests: number) {
  return {
    query,
    fetchedAt: "2030-01-10T12:00:00Z",
    range: {
      queryStartDate: query.startDate,
      queryEndDate: query.endDate,
    },
    totals: {
      requests,
      inputTokens: 100,
      outputTokens: 20,
      cacheTokens: 10,
      totalTokens: 130,
      standardCostUsd: 1.25,
      actualCostUsd: 1,
      averageDurationMs: 7200,
    },
    trendStatus: "available" as const,
    trend: [{
      bucket: query.startDate,
      inputTokens: 100,
      outputTokens: 20,
      cacheCreationTokens: 4,
      cacheReadTokens: 6,
      totalTokens: 130,
      standardCostUsd: 0.1,
      actualCostUsd: 0.08,
    }],
    modelsStatus: "available" as const,
    models: [],
  };
}

function deferred<Value>() {
  let resolve: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
