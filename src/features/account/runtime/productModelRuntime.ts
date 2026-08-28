import type { ProductModelViewV1 } from "./productOnboardingClient";
import { normalizeProductModelIdentityV1 } from "./productModelCompatibility";

export const PRODUCT_DOUBAO_RUNTIME_MODEL = "豆包";

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

