import { describe, expect, it, vi } from "vitest";

import type { EngineModelInfo } from "../types";
import { hydrateProviderContinuationTarget } from "./providerContinuationTargetHydration";

function model(
  id: string,
  runtime: string,
  isDefault = false,
): EngineModelInfo {
  return {
    id,
    model: runtime,
    displayName: id,
    description: "",
    isDefault,
  };
}

describe("hydrateProviderContinuationTarget", () => {
  it("sets the destination engine and persists the exact target before navigation", async () => {
    const order: string[] = [];
    const persistComposerSelectionForThread = vi.fn(() => {
      order.push("persist-target");
    });

    await hydrateProviderContinuationTarget(
      {
        workspaceId: "ws-1",
        threadId: "claude:target-1",
        engine: "claude",
        providerProfileId: "doge-token-matrix",
        modelId: "upstream-claude",
        modelRuntime: "claude-opus-4-8",
        effort: "high",
      },
      {
        setActiveEngine: async (engine, options) => {
          order.push(`engine:${engine}`);
          expect(options).toEqual({
            ensureRuntime: true,
            providerProfileId: "doge-token-matrix",
          });
          return true;
        },
        getEngineModels: async () => {
          order.push("load-catalog");
          return [model("claude-opus-catalog", "claude-opus-4-8", true)];
        },
        refreshEngineModels: async () => {
          order.push("publish-catalog");
        },
        persistComposerSelectionForThread,
      },
    );

    expect(order).toEqual([
      "engine:claude",
      "load-catalog",
      "publish-catalog",
      "persist-target",
    ]);
    expect(persistComposerSelectionForThread).toHaveBeenCalledWith(
      "ws-1",
      "claude:target-1",
      { modelId: "claude-opus-catalog", effort: "high" },
    );
  });

  it("keeps the frozen destination model when catalog refresh fails", async () => {
    const catalogError = new Error("catalog unavailable");
    const onCatalogError = vi.fn();
    const refreshEngineModels = vi.fn();
    const persistComposerSelectionForThread = vi.fn();

    await hydrateProviderContinuationTarget(
      {
        workspaceId: "ws-1",
        threadId: "claude:target-1",
        engine: "claude",
        providerProfileId: "doge-token-matrix",
        modelId: "claude-opus-4-8",
        modelRuntime: "claude-opus-4-8",
        effort: null,
      },
      {
        setActiveEngine: vi.fn(),
        getEngineModels: vi.fn(async () => {
          throw catalogError;
        }),
        refreshEngineModels,
        persistComposerSelectionForThread,
        onCatalogError,
      },
    );

    expect(onCatalogError).toHaveBeenCalledWith(catalogError);
    expect(refreshEngineModels).not.toHaveBeenCalled();
    expect(persistComposerSelectionForThread).toHaveBeenCalledWith(
      "ws-1",
      "claude:target-1",
      { modelId: "claude-opus-4-8", effort: null },
    );
  });

  it("fails before state mutation for an unsupported destination engine", async () => {
    const setActiveEngine = vi.fn();
    const persistComposerSelectionForThread = vi.fn();

    await expect(
      hydrateProviderContinuationTarget(
        {
          workspaceId: "ws-1",
          threadId: "gemini:target-1",
          engine: "gemini",
          providerProfileId: "provider-a",
          modelId: "gemini-model",
          effort: null,
        },
        {
          setActiveEngine,
          getEngineModels: vi.fn(),
          refreshEngineModels: vi.fn(),
          persistComposerSelectionForThread,
        },
      ),
    ).rejects.toThrow("unsupported provider continuation engine: gemini");
    expect(setActiveEngine).not.toHaveBeenCalled();
    expect(persistComposerSelectionForThread).not.toHaveBeenCalled();
  });

  it("does not persist or hydrate a continuation when its engine is not activated", async () => {
    const setActiveEngine = vi.fn(async () => false);
    const getEngineModels = vi.fn();
    const refreshEngineModels = vi.fn();
    const persistComposerSelectionForThread = vi.fn();

    await expect(
      hydrateProviderContinuationTarget(
        {
          workspaceId: "ws-1",
          threadId: "codex:target-1",
          engine: "codex",
          providerProfileId: "provider-a",
          modelId: "gpt-5",
          effort: "high",
        },
        {
          setActiveEngine,
          getEngineModels,
          refreshEngineModels,
          persistComposerSelectionForThread,
        },
      ),
    ).rejects.toThrow("provider continuation engine activation failed: codex");

    expect(setActiveEngine).toHaveBeenCalledWith("codex", {
      ensureRuntime: true,
      providerProfileId: "provider-a",
    });
    expect(getEngineModels).not.toHaveBeenCalled();
    expect(refreshEngineModels).not.toHaveBeenCalled();
    expect(persistComposerSelectionForThread).not.toHaveBeenCalled();
  });

  it("keeps Kimi continuation hydration when native active-engine switching is unavailable", async () => {
    const setActiveEngine = vi.fn(async () => false);
    const getEngineModels = vi.fn(async () => [model("kimi-k2", "kimi-k2", true)]);
    const refreshEngineModels = vi.fn();
    const persistComposerSelectionForThread = vi.fn();

    await hydrateProviderContinuationTarget(
      {
        workspaceId: "ws-1",
        threadId: "kimi:target-1",
        engine: "kimi",
        providerProfileId: "provider-kimi",
        modelId: "kimi-k2",
        effort: null,
      },
      {
        setActiveEngine,
        getEngineModels,
        refreshEngineModels,
        persistComposerSelectionForThread,
      },
    );

    expect(setActiveEngine).toHaveBeenCalledWith("kimi", {
      providerProfileId: "provider-kimi",
    });
    expect(getEngineModels).toHaveBeenCalledWith("kimi", {
      providerProfileId: "provider-kimi",
      forceRefresh: true,
    });
    expect(persistComposerSelectionForThread).toHaveBeenCalledWith(
      "ws-1",
      "kimi:target-1",
      { modelId: "kimi-k2", effort: null },
    );
  });
});
