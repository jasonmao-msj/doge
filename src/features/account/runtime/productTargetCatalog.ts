import type {
  ProductEngineViewV1,
  ProductModelViewV1,
} from "./productOnboardingClient";
import {
  compatibleProductModelsForEngineV1,
  type ProductRuntimeEngineIdV1,
} from "./productModelCompatibility";
import { productEngineRuntimeIdV1 } from "./productManagedEnginePolicy";
import { resolveProductRuntimeModelIdV1 } from "./productModelRuntime";

export type ProductTargetModelV1 = ProductModelViewV1 & {
  readonly runtimeModel: string;
};

export type ProductTargetEngineV1 = {
  readonly id: ProductRuntimeEngineIdV1;
  readonly displayName: string;
  readonly models: readonly ProductTargetModelV1[];
};

export type ProductTargetCatalogV1 = {
  readonly engines: readonly ProductTargetEngineV1[];
  readonly modelsStatus: "ready" | "refreshing" | "stale";
  readonly modelsUpdatedAt: number | null;
};

export function projectProductTargetCatalogV1(input: {
  readonly engines: readonly ProductEngineViewV1[];
  readonly models: readonly ProductModelViewV1[];
  readonly modelsStatus?: "idle" | "ready" | "refreshing" | "stale";
  readonly modelsUpdatedAt?: number | null;
}): ProductTargetCatalogV1 {
  return {
    engines: input.engines.map((engine) => {
      const runtimeEngine = productEngineRuntimeIdV1(engine.id);
      return {
        id: runtimeEngine,
        displayName: engine.displayName,
        models: compatibleProductModelsForEngineV1(
          runtimeEngine,
          input.models,
        ).map((model) => ({
          ...model,
          runtimeModel: resolveProductRuntimeModelIdV1(model),
        })),
      };
    }),
    modelsStatus:
      input.modelsStatus === "refreshing" || input.modelsStatus === "stale"
        ? input.modelsStatus
        : "ready",
    modelsUpdatedAt: input.modelsUpdatedAt ?? null,
  };
}

