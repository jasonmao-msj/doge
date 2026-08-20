// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuotaUsageViewV1 } from "../../account/contracts";
import {
  loadManagedAccountQuotaSnapshots,
  managedAccountQuotaSnapshot,
} from "./managedAccountQuota";

const mocks = vi.hoisted(() => ({
  readUsage: vi.fn(),
}));

vi.mock("../../../services/accountGateway", () => ({
  createRealAccountGatewayV1: () => ({
    usage: { read: mocks.readUsage },
  }),
}));

const availableUsage = {
  status: "available",
  source: "token2apiSubscription",
  freshness: "fresh",
  observedAt: "2026-08-18T12:00:00Z",
  fetchedAt: "2026-08-18T12:00:00Z",
  remaining: null,
  used: null,
  resetsAt: null,
  subscriptionLabel: null,
  range: null,
  engines: [
    {
      engineId: "codex",
      engineLabel: "Codex",
      subscriptionLabel: "Doge Pro",
      expiresAt: null,
      analyticsStatus: "available",
      windows: {
        daily: {
          limit: { value: "20", unit: "usd" },
          used: { value: "5", unit: "usd" },
          remaining: { value: "15", unit: "usd" },
          percentage: "25",
          resetsAt: "2026-08-19T00:00:00Z",
        },
        weekly: null,
        monthly: null,
      },
      totals: {
        requests: 4,
        inputTokens: 20,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 30,
        cost: { value: "5", unit: "usd" },
        actualCost: { value: "5", unit: "usd" },
      },
      days: [],
      models: [],
    },
  ],
} satisfies QuotaUsageViewV1;

describe("managedAccountQuotaSnapshot", () => {
  beforeEach(() => {
    mocks.readUsage.mockReset();
  });

  it("projects a subscribed managed engine without a credential", () => {
    const snapshot = managedAccountQuotaSnapshot(availableUsage, "codex");

    expect(snapshot).toMatchObject({
      source: "token_matrix",
      success: true,
      planLabel: "Doge Pro",
      windows: [
        {
          id: "daily",
          usedPercent: 25,
          usedAmount: "USD 5",
          limitAmount: "USD 20",
        },
      ],
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /apiKey|accessToken|refreshToken|secret/i,
    );
  });

  it("keeps an absent managed entitlement distinct from an unavailable authority", () => {
    const snapshot = managedAccountQuotaSnapshot(availableUsage, "claude");

    expect(snapshot.source).toBe("token_matrix_not_subscribed");
    expect(snapshot.success).toBe(true);
    expect(snapshot.error).toContain("未订阅");
  });

  it("uses one authority read for all managed targets in a refresh", async () => {
    mocks.readUsage.mockResolvedValue({ ok: true, value: availableUsage });

    const results = await loadManagedAccountQuotaSnapshots([
      {
        key: "codex::doge-token-matrix",
        engine: "codex",
        providerProfileId: "doge-token-matrix",
        providerLabel: "Token Matrix",
        model: null,
      },
      {
        key: "claude::doge-token-matrix",
        engine: "claude",
        providerProfileId: "doge-token-matrix",
        providerLabel: "Token Matrix",
        model: null,
      },
    ]);

    expect(mocks.readUsage).toHaveBeenCalledTimes(1);
    expect(mocks.readUsage).toHaveBeenCalledWith({});
    expect(results.map((result) => result.target.engine)).toEqual([
      "codex",
      "claude",
    ]);
    expect(results[0]?.snapshot.source).toBe("token_matrix");
    expect(results[1]?.snapshot.source).toBe("token_matrix_not_subscribed");
  });
});
