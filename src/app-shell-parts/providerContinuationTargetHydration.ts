import type { EngineModelInfo, EngineType } from "../types";

export type ProviderContinuationTargetHydrationInput = {
  workspaceId: string;
  threadId: string;
  engine: string;
  providerProfileId: string | null;
  modelId: string | null;
  modelRuntime?: string | null;
  effort: string | null;
};

type ProviderContinuationTargetHydrationDependencies = {
  setActiveEngine: (engine: EngineType) => Promise<void> | void;
  getEngineModels: (
    engine: EngineType,
    options: { providerProfileId: string | null; forceRefresh: true },
  ) => Promise<EngineModelInfo[]>;
  refreshEngineModels: (
    engine: EngineType,
    options: {
      providerProfileId: string | null;
      forceRefresh: true;
      phase: "on-demand";
    },
  ) => Promise<void> | void;
  persistComposerSelectionForThread: (
    workspaceId: string,
    threadId: string,
    selection: { modelId: string | null; effort: string | null },
  ) => void;
  onCatalogError?: (error: unknown) => void;
};

const PROVIDER_CONTINUATION_ENGINES = new Set<EngineType>([
  "claude",
  "codex",
  "kimi",
  "grok",
  "opencode",
]);

function resolveProviderContinuationEngine(engine: string): EngineType {
  const normalized = engine.trim() as EngineType;
  if (!PROVIDER_CONTINUATION_ENGINES.has(normalized)) {
    throw new Error(`unsupported provider continuation engine: ${engine}`);
  }
  return normalized;
}

export async function hydrateProviderContinuationTarget(
  input: ProviderContinuationTargetHydrationInput,
  dependencies: ProviderContinuationTargetHydrationDependencies,
): Promise<void> {
  const engine = resolveProviderContinuationEngine(input.engine);
  const providerProfileId = input.providerProfileId?.trim() || null;
  let resolvedModelId = input.modelId?.trim() || null;
  const runtimeHint = input.modelRuntime?.trim() || resolvedModelId;
  const effort = input.effort?.trim() || null;

  // Catalog reload and thread selection can settle in one React batch. The
  // approved destination snapshot is authoritative; do not infer its engine
  // from a possibly stale threadsByWorkspace closure.
  await dependencies.setActiveEngine(engine);

  try {
    const models = await dependencies.getEngineModels(engine, {
      providerProfileId,
      forceRefresh: true,
    });
    await dependencies.refreshEngineModels(engine, {
      providerProfileId,
      forceRefresh: true,
      phase: "on-demand",
    });
    const byCatalogId = resolvedModelId
      ? models.find((model) => model.id === resolvedModelId)
      : undefined;
    if (byCatalogId) {
      resolvedModelId = byCatalogId.id;
    } else if (runtimeHint) {
      const byRuntime = models.find(
        (model) => (model.model?.trim() || model.id) === runtimeHint,
      );
      if (byRuntime) {
        resolvedModelId = byRuntime.id;
      }
    }
    if (
      !resolvedModelId ||
      !models.some((model) => model.id === resolvedModelId)
    ) {
      const defaultModel =
        models.find((model) => model.isDefault) ?? models[0] ?? null;
      if (defaultModel) {
        resolvedModelId = defaultModel.id;
      }
    }
  } catch (error) {
    // Frozen destination model identity remains the bounded fallback. The
    // diagnostic is still surfaced so a catalog outage is not silently lost.
    dependencies.onCatalogError?.(error);
  }

  if (resolvedModelId || effort) {
    dependencies.persistComposerSelectionForThread(
      input.workspaceId,
      input.threadId,
      { modelId: resolvedModelId, effort },
    );
  }
}
