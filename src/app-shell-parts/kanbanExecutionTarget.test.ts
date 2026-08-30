import { describe, expect, it, vi } from "vitest";

import type { ProductEntitlementSnapshotV1 } from "../features/account/runtime/productEntitlementStore";
import {
  prepareKanbanExecutionTarget,
  resolveKanbanExecutionTarget,
} from "./kanbanExecutionTarget";

const product: ProductEntitlementSnapshotV1 = {
  status: "ready",
  entitlement: {
    status: "active",
    subscriptionId: 1,
    groupId: 2,
    groupName: "Doge",
    planName: "Pro",
    expiresAt: null,
    usage: null,
  },
  engines: [
    { id: "codex", displayName: "Codex" },
    { id: "kimi", displayName: "Kimi CLI" },
  ],
  models: [{
    id: "kimi-code/kimi-for-coding",
    displayName: "Kimi For Coding",
    model: "kimi-for-coding",
    apiProtocols: ["openai-responses", "openai-chat-completions"],
    capabilities: [],
  }],
  modelsStatus: "ready",
  modelsUpdatedAt: 1,
  modelsError: null,
};

describe("resolveKanbanExecutionTarget", () => {
  it("keeps a Claude model on the exact managed Codex target", () => {
    const claudeProduct: ProductEntitlementSnapshotV1 = {
      ...product,
      engines: [
        { id: "codex", displayName: "Codex" },
        { id: "claude-code", displayName: "Claude" },
        { id: "kimi", displayName: "Kimi CLI" },
      ],
      models: [{
        id: "claude-opus-4-8",
        displayName: "Claude Opus 4.8",
        model: "claude-opus-4-8",
        apiProtocols: ["openai-responses", "anthropic-messages"],
        capabilities: [],
      }],
    };

    expect(resolveKanbanExecutionTarget({
      task: {
        engineType: "codex",
        modelId: "claude-opus-4-8",
        executionTarget: null,
      },
      product: claudeProduct,
    })).toEqual({
      ok: true,
      target: {
        engine: "codex",
        providerProfileId: "doge-token-matrix",
        modelCatalogEntryId: "claude-opus-4-8",
        model: "claude-opus-4-8",
        reasoning: null,
        providerProfileNameSnapshot: "Doge",
        providerProfileSource: "managed",
      },
    });
  });

  it("upgrades a legacy Product task to an exact managed runtime target", () => {
    expect(resolveKanbanExecutionTarget({
      task: {
        engineType: "codex",
        modelId: "kimi-code/kimi-for-coding",
        executionTarget: null,
      },
      product,
    })).toEqual({
      ok: true,
      target: {
        engine: "codex",
        providerProfileId: "doge-token-matrix",
        modelCatalogEntryId: "kimi-code/kimi-for-coding",
        model: "kimi-for-coding",
        reasoning: null,
        providerProfileNameSnapshot: "Doge",
        providerProfileSource: "managed",
      },
    });
  });

  it("repairs a persisted Product target against the current engine catalog", () => {
    expect(resolveKanbanExecutionTarget({
      task: {
        engineType: "kimi",
        modelId: "kimi-code/kimi-for-coding",
        executionTarget: {
          engine: "kimi",
          providerProfileId: "doge-token-matrix",
          modelCatalogEntryId: "stale",
          model: "stale",
          providerProfileNameSnapshot: "Doge",
          providerProfileSource: "managed",
        },
      },
      product,
    })).toMatchObject({
      ok: true,
      target: {
        engine: "kimi",
        modelCatalogEntryId: "kimi-code/kimi-for-coding",
        model: "kimi-for-coding",
      },
    });
  });

  it("fails closed when a managed target cannot be revalidated", () => {
    expect(resolveKanbanExecutionTarget({
      task: {
        engineType: "claude",
        modelId: "missing",
        executionTarget: null,
      },
      product,
    })).toEqual({ ok: false, reason: "product_target_unavailable" });

    expect(resolveKanbanExecutionTarget({
      task: {
        engineType: "codex",
        modelId: "gpt",
        executionTarget: {
          engine: "codex",
          providerProfileId: "doge-token-matrix",
          modelCatalogEntryId: "gpt",
          model: "gpt",
          providerProfileNameSnapshot: "Doge",
          providerProfileSource: "managed",
        },
      },
      product: { ...product, status: "unknown", entitlement: null },
    })).toEqual({
      ok: false,
      reason: "managed_target_catalog_unavailable",
    });
  });

  it("keeps Local Mode legacy tasks compatible without inventing a provider", () => {
    expect(resolveKanbanExecutionTarget({
      task: {
        engineType: "opencode",
        modelId: "openrouter/model",
        executionTarget: null,
      },
      product: { ...product, status: "unknown", entitlement: null },
    })).toMatchObject({
      ok: true,
      target: {
        engine: "opencode",
        providerProfileId: null,
        modelCatalogEntryId: "openrouter/model",
        model: "openrouter/model",
        providerProfileSource: "disk",
      },
    });
  });
});

describe("prepareKanbanExecutionTarget", () => {
  it("prepares the exact managed engine before returning session options", async () => {
    const ensureReady = vi.fn(async () => undefined);
    const options = await prepareKanbanExecutionTarget({
      engine: "kimi",
      providerProfileId: " doge-token-matrix ",
      modelCatalogEntryId: "kimi-entry",
      model: "kimi-runtime",
      providerProfileNameSnapshot: "Doge",
      providerProfileSource: "managed",
    }, ensureReady);

    expect(ensureReady).toHaveBeenCalledWith({
      engine: "kimi",
      providerProfileId: " doge-token-matrix ",
    });
    expect(options).toEqual({
      engine: "kimi",
      providerProfileId: "doge-token-matrix",
    });
  });
});
