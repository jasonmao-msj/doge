import type { EngineType } from "../../../types";
import type { ExecutionTarget } from "../../shared-session/target/types";
import { MANAGED_PROVIDER_PROFILE_ID_V1 } from "./engineEntitlementStore";
import type {
  ProductEngineIdV1,
  ProductEngineViewV1,
  ProductModelViewV1,
} from "./productOnboardingClient";
import {
  normalizeProductModelIdentityV1,
  compatibleProductModelsForEngineV1,
  productModelMatchesIdentityV1,
  type ProductRuntimeEngineIdV1,
} from "./productModelCompatibility";

export const PRODUCT_MANAGED_PROVIDER_LABEL = "Doge";
export const PRODUCT_DOUBAO_RUNTIME_MODEL = "豆包";

const PRODUCT_ENGINE_RUNTIME_IDS: Record<
  ProductEngineIdV1,
  ProductRuntimeEngineIdV1
> = {
  codex: "codex",
  "claude-code": "claude",
  kimi: "kimi",
};

export function productEngineRuntimeIdV1(
  engine: ProductEngineIdV1,
): ProductRuntimeEngineIdV1 {
  return PRODUCT_ENGINE_RUNTIME_IDS[engine];
}

export function resolveProductRuntimeModelIdV1(
  model: Pick<ProductModelViewV1, "id" | "model"> &
    Partial<Pick<ProductModelViewV1, "displayName">>,
): string {
  const identity = `${model.id} ${model.model} ${model.displayName ?? ""}`
    .toLocaleLowerCase();
  if (
    identity.includes("豆包") ||
    identity.includes("doubao") ||
    identity.includes("ark-code")
  ) {
    return PRODUCT_DOUBAO_RUNTIME_MODEL;
  }
  return normalizeProductModelIdentityV1(model.model || model.id);
}

export function resolveProductManagedExecutionTargetV1(input: {
  readonly target?: ExecutionTarget | null;
  readonly preferredEngine?: EngineType | null;
  readonly preferredModelId?: string | null;
  readonly preferredEffort?: string | null;
  readonly engines: readonly ProductEngineViewV1[];
  readonly models: readonly ProductModelViewV1[];
}): ExecutionTarget | null {
  if (input.engines.length === 0 || input.models.length === 0) {
    return null;
  }

  const engine =
    input.engines.find(
      (candidate) =>
        productEngineRuntimeIdV1(candidate.id) === input.target?.engine,
    ) ??
    input.engines.find(
      (candidate) =>
        productEngineRuntimeIdV1(candidate.id) === input.preferredEngine,
    ) ??
    input.engines[0];
  const runtimeEngine = productEngineRuntimeIdV1(engine.id);
  const compatibleModels = compatibleProductModelsForEngineV1(
    runtimeEngine,
    input.models,
  );
  if (compatibleModels.length === 0) {
    return null;
  }
  const model =
    compatibleModels.find((candidate) =>
      productModelMatchesIdentityV1(candidate, input.target?.modelCatalogEntryId),
    ) ??
    compatibleModels.find((candidate) =>
      productModelMatchesIdentityV1(candidate, input.target?.model),
    ) ??
    compatibleModels.find((candidate) =>
      productModelMatchesIdentityV1(candidate, input.preferredModelId),
    ) ??
    compatibleModels[0];

  const effort =
    (input.target?.engine === runtimeEngine
      ? input.target.reasoning?.effort?.trim()
      : null) ||
    input.preferredEffort?.trim() ||
    null;
  const runtimeModel = resolveProductRuntimeModelIdV1(model);
  const selectedCatalogEntryId = input.target?.modelCatalogEntryId?.trim();
  const modelCatalogEntryId =
    selectedCatalogEntryId &&
    normalizeProductModelIdentityV1(selectedCatalogEntryId) === runtimeModel
      ? selectedCatalogEntryId
      : model.id;
  return {
    engine: runtimeEngine,
    providerProfileId: MANAGED_PROVIDER_PROFILE_ID_V1,
    modelCatalogEntryId,
    model: runtimeModel,
    reasoning: effort ? { effort } : null,
    providerProfileNameSnapshot: PRODUCT_MANAGED_PROVIDER_LABEL,
    providerProfileSource: "managed",
  };
}

export function isSameProductExecutionTargetV1(
  left: ExecutionTarget | null | undefined,
  right: ExecutionTarget | null | undefined,
): boolean {
  return Boolean(
    left &&
    right &&
    left.engine === right.engine &&
    (left.providerProfileId?.trim() || null) ===
      (right.providerProfileId?.trim() || null) &&
    (left.modelCatalogEntryId?.trim() || null) ===
      (right.modelCatalogEntryId?.trim() || null) &&
    (left.model?.trim() || null) === (right.model?.trim() || null) &&
    (left.reasoning?.effort?.trim() || null) ===
      (right.reasoning?.effort?.trim() || null) &&
    left.providerProfileSource === right.providerProfileSource,
  );
}
