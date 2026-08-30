import type { EngineType } from "../../../types";
import type { ExecutionTarget } from "../../shared-session/target/types";
import { MANAGED_PROVIDER_PROFILE_ID_V1 } from "./engineEntitlementStore";
import type {
  ProductEngineViewV1,
  ProductModelViewV1,
} from "./productOnboardingClient";
import {
  normalizeProductModelIdentityV1,
  productModelMatchesIdentityV1,
} from "./productModelCompatibility";
import {
  productEngineRuntimeIdV1,
} from "./productManagedEnginePolicy";
import {
  PRODUCT_DOUBAO_RUNTIME_MODEL,
  resolveProductRuntimeModelIdV1,
} from "./productModelRuntime";
import { projectProductTargetCatalogV1 } from "./productTargetCatalog";

export const PRODUCT_MANAGED_PROVIDER_LABEL = "Doge";
export {
  PRODUCT_DOUBAO_RUNTIME_MODEL,
  productEngineRuntimeIdV1,
  resolveProductRuntimeModelIdV1,
};

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

  const catalog = projectProductTargetCatalogV1({
    engines: input.engines,
    models: input.models,
  });
  const engine =
    catalog.engines.find(
      (candidate) => candidate.id === input.target?.engine,
    ) ??
    catalog.engines.find(
      (candidate) => candidate.id === input.preferredEngine,
    ) ??
    catalog.engines[0];
  if (!engine || engine.models.length === 0) {
    return null;
  }
  const runtimeEngine = engine.id;
  const model =
    engine.models.find((candidate) =>
      productModelMatchesIdentityV1(candidate, input.target?.modelCatalogEntryId),
    ) ??
    engine.models.find((candidate) =>
      productModelMatchesIdentityV1(candidate, input.target?.model),
    ) ??
    engine.models.find((candidate) =>
      [input.target?.modelCatalogEntryId, input.target?.model].some(
        (identity) =>
          normalizeProductModelIdentityV1(candidate.runtimeModel) ===
          normalizeProductModelIdentityV1(identity),
      ),
    ) ??
    engine.models.find((candidate) =>
      productModelMatchesIdentityV1(candidate, input.preferredModelId),
    ) ??
    engine.models[0];

  const effort =
    (input.target?.engine === runtimeEngine
      ? input.target.reasoning?.effort?.trim()
      : null) ||
    input.preferredEffort?.trim() ||
    null;
  const runtimeModel = model.runtimeModel;
  const selectedCatalogEntryId = input.target?.modelCatalogEntryId?.trim();
  const modelCatalogEntryId =
    selectedCatalogEntryId === model.id ||
    (selectedCatalogEntryId?.toLowerCase().startsWith("kimi-code/") &&
      normalizeProductModelIdentityV1(selectedCatalogEntryId) ===
        normalizeProductModelIdentityV1(model.runtimeModel))
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
