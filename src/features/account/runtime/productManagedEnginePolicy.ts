export const PRODUCT_RUNTIME_ENGINE_IDS_V1 = [
  "codex",
  "claude",
  "kimi",
] as const;
export type ProductRuntimeEngineIdV1 =
  (typeof PRODUCT_RUNTIME_ENGINE_IDS_V1)[number];

export type ProductCatalogEngineIdV1 = "codex" | "claude-code" | "kimi";

const PRODUCT_ENGINE_RUNTIME_IDS: Readonly<
  Record<ProductCatalogEngineIdV1, ProductRuntimeEngineIdV1>
> = {
  codex: "codex",
  "claude-code": "claude",
  kimi: "kimi",
};

export function productEngineRuntimeIdV1(
  engine: ProductCatalogEngineIdV1,
): ProductRuntimeEngineIdV1 {
  return PRODUCT_ENGINE_RUNTIME_IDS[engine];
}

const PRODUCT_MANAGED_ENGINE_ID_SET: ReadonlySet<string> = new Set(
  PRODUCT_RUNTIME_ENGINE_IDS_V1,
);

/** Product users never manage CLI/provider visibility from a shipping UI. */
export const PRODUCT_ENGINE_MANAGEMENT_USER_VISIBLE = false;

export function isProductManagedEngineId(
  engineId: string,
): engineId is ProductRuntimeEngineIdV1 {
  return PRODUCT_MANAGED_ENGINE_ID_SET.has(engineId);
}
