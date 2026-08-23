import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearProductEntitlementV1,
  publishProductReadyV1,
  readProductEntitlementSnapshotV1,
} from "./productEntitlementStore";
import { refreshProductModelsV1 } from "./productModelCatalogRefresh";

const productCommands = vi.hoisted(() => ({
  readModels: vi.fn(),
}));

vi.mock("../../../services/accountProductCommands", () => ({
  readAccountProductModelsV1: productCommands.readModels,
}));

beforeEach(() => {
  productCommands.readModels.mockReset();
  publishReady();
});

afterEach(() => {
  clearProductEntitlementV1();
});

describe("refreshProductModelsV1", () => {
  it("keeps last-known-good rows while one coalesced refresh is pending", async () => {
    let resolveRead: (value: unknown) => void = () => undefined;
    productCommands.readModels.mockReturnValue(new Promise((resolve) => {
      resolveRead = resolve;
    }));

    const first = refreshProductModelsV1({ force: true });
    const second = refreshProductModelsV1({ force: true });
    expect(productCommands.readModels).toHaveBeenCalledTimes(1);
    expect(readProductEntitlementSnapshotV1()).toMatchObject({
      modelsStatus: "refreshing",
      models: [{ id: "gpt-5.6" }],
    });

    resolveRead(modelsEnvelope("claude-opus-4-8", "Claude Opus 4.8"));
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(readProductEntitlementSnapshotV1()).toMatchObject({
      modelsStatus: "ready",
      models: [{ id: "claude-opus-4-8", displayName: "Claude Opus 4.8" }],
    });
  });

  it("retains rows and marks them stale when refresh fails", async () => {
    productCommands.readModels.mockResolvedValue({
      ok: false,
      error: { code: "serviceUnavailable" },
    });

    await expect(refreshProductModelsV1({ force: true })).resolves.toBe(false);
    expect(readProductEntitlementSnapshotV1()).toMatchObject({
      modelsStatus: "stale",
      modelsError: "serviceUnavailable",
      models: [{ id: "gpt-5.6" }],
    });
  });

  it("skips a non-forced read inside the freshness window", async () => {
    await expect(refreshProductModelsV1()).resolves.toBe(true);
    expect(productCommands.readModels).not.toHaveBeenCalled();
  });
});

function publishReady() {
  publishProductReadyV1({
    entitlement: {
      status: "active",
      subscriptionId: 9,
      groupId: 35,
      groupName: "Doge APP",
      planName: "Doge订阅",
      expiresAt: "2030-02-01T00:00:00Z",
      usage: {
        daily: { usedUsd: 0, limitUsd: 1, percentage: 0 },
        weekly: { usedUsd: 0, limitUsd: 7, percentage: 0 },
        monthly: { usedUsd: 0, limitUsd: 30, percentage: 0 },
      },
    },
    engines: [
      { id: "codex", displayName: "Codex" },
      { id: "claude-code", displayName: "Claude" },
      { id: "kimi", displayName: "Kimi CLI" },
    ],
    models: [{
      id: "gpt-5.6",
      displayName: "GPT-5.6",
      model: "gpt-5.6",
      compatibleEngines: ["codex", "claude", "kimi"],
      capabilities: ["chat"],
    }],
  });
}

function modelsEnvelope(id: string, displayName: string) {
  return {
    ok: true,
    value: {
      fetched_at: "2030-01-01T00:00:31Z",
      models: [{
        id,
        display_name: displayName,
        model: id,
        compatible_engines: ["codex", "claude", "kimi"],
        capabilities: ["chat"],
      }],
    },
  };
}
