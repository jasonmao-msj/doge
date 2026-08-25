import type { EngineType } from "../../../types";
import type {
  ProductModelViewV1,
  ProductRuntimeEngineIdV1,
} from "./productOnboardingClient";

export type { ProductRuntimeEngineIdV1 } from "./productOnboardingClient";

const KIMI_CATALOG_MODEL_PREFIX = "kimi-code/";

export function normalizeProductModelIdentityV1(
  identity?: string | null,
): string {
  const normalized = identity?.trim() ?? "";
  if (normalized.toLowerCase().startsWith(KIMI_CATALOG_MODEL_PREFIX)) {
    return normalized.slice(KIMI_CATALOG_MODEL_PREFIX.length);
  }
  return normalized;
}

export function isProductModelCompatibleWithEngineV1(
  engine: ProductRuntimeEngineIdV1,
  model: ProductModelViewV1,
): boolean {
  return model.compatibleEngines.includes(engine);
}

export function compatibleProductModelsForEngineV1(
  engine: ProductRuntimeEngineIdV1,
  models: readonly ProductModelViewV1[],
): readonly ProductModelViewV1[] {
  return models.filter((model) =>
    isProductModelCompatibleWithEngineV1(engine, model),
  );
}

export function productModelMatchesIdentityV1(
  model: ProductModelViewV1,
  identity?: string | null,
): boolean {
  const normalized = normalizeProductModelIdentityV1(identity);
  return Boolean(
    normalized &&
      (normalizeProductModelIdentityV1(model.id) === normalized ||
        normalizeProductModelIdentityV1(model.model) === normalized),
  );
}

export function isProductRuntimeEngineV1(
  engine: EngineType,
): engine is ProductRuntimeEngineIdV1 {
  return engine === "codex" || engine === "claude" || engine === "kimi";
}
