export const PRODUCT_RUNTIME_ENGINE_IDS_V1 = [
  "codex",
  "claude",
  "kimi",
] as const;
export type ProductRuntimeEngineIdV1 =
  (typeof PRODUCT_RUNTIME_ENGINE_IDS_V1)[number];

const PRODUCT_MANAGED_ENGINE_ID_SET: ReadonlySet<string> = new Set(
  PRODUCT_RUNTIME_ENGINE_IDS_V1,
);

/** Product users never manage CLI/provider visibility from a shipping UI. */
export const PRODUCT_ENGINE_MANAGEMENT_USER_VISIBLE = false;

export function isProductManagedEngineId(engineId: string): boolean {
  return PRODUCT_MANAGED_ENGINE_ID_SET.has(engineId);
}
