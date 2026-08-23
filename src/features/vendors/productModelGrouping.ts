import {
  resolveVendorFromModelId,
  type ProviderBrandVendor,
} from "./providerBrandIcon";

export type ProductModelIdentity = {
  readonly id: string;
  readonly displayName: string;
};

export type ProductModelVendorGroupId =
  | "openai"
  | "anthropic"
  | "doubao"
  | "kimi"
  | "zhipu"
  | "deepseek"
  | "bailian"
  | "minimax"
  | "xiaomi"
  | "longcat"
  | "opencode"
  | "openrouter"
  | "other";

export type ProductModelVendorGroup<
  Model extends ProductModelIdentity = ProductModelIdentity,
> = {
  readonly id: ProductModelVendorGroupId;
  readonly models: readonly Model[];
};

const PRODUCT_MODEL_VENDOR_ORDER: readonly ProductModelVendorGroupId[] = [
  "openai",
  "anthropic",
  "doubao",
  "kimi",
  "zhipu",
  "deepseek",
  "bailian",
  "minimax",
  "xiaomi",
  "longcat",
  "opencode",
  "openrouter",
  "other",
];

const PRODUCT_VENDOR_GROUP_BY_BRAND: Readonly<
  Record<ProviderBrandVendor, ProductModelVendorGroupId>
> = {
  openai: "openai",
  claude: "anthropic",
  doubao: "doubao",
  kimi: "kimi",
  moonshot: "kimi",
  zhipu: "zhipu",
  deepseek: "deepseek",
  bailian: "bailian",
  minimax: "minimax",
  xiaomi: "xiaomi",
  longcat: "longcat",
  opencode: "opencode",
  openrouter: "openrouter",
};

const PRODUCT_VENDOR_BRAND_BY_GROUP: Readonly<
  Record<ProductModelVendorGroupId, ProviderBrandVendor | null>
> = {
  openai: "openai",
  anthropic: "claude",
  doubao: "doubao",
  kimi: "kimi",
  zhipu: "zhipu",
  deepseek: "deepseek",
  bailian: "bailian",
  minimax: "minimax",
  xiaomi: "xiaomi",
  longcat: "longcat",
  opencode: "opencode",
  openrouter: "openrouter",
  other: null,
};

function resolveProductModelVendorGroup(
  model: ProductModelIdentity,
): ProductModelVendorGroupId {
  const vendor =
    resolveVendorFromModelId(model.id) ??
    resolveVendorFromModelId(model.displayName);
  return vendor ? PRODUCT_VENDOR_GROUP_BY_BRAND[vendor] : "other";
}

export function productModelVendorBrand(
  groupId: ProductModelVendorGroupId,
): ProviderBrandVendor | null {
  return PRODUCT_VENDOR_BRAND_BY_GROUP[groupId];
}

/**
 * 将上游 product catalog 仅按展示厂商分组。
 *
 * 该函数不会根据 engine 过滤模型，也不会改变同一厂商内的上游顺序。
 */
export function groupProductModelsForDisplay<
  Model extends ProductModelIdentity,
>(
  models: readonly Model[],
  searchQuery = "",
): ProductModelVendorGroup<Model>[] {
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const buckets = new Map<ProductModelVendorGroupId, Model[]>();

  for (const model of models) {
    if (
      normalizedQuery &&
      !`${model.displayName}\n${model.id}`
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    ) {
      continue;
    }

    const groupId = resolveProductModelVendorGroup(model);
    const bucket = buckets.get(groupId);
    if (bucket) {
      bucket.push(model);
    } else {
      buckets.set(groupId, [model]);
    }
  }

  return PRODUCT_MODEL_VENDOR_ORDER.flatMap((groupId) => {
    const groupModels = buckets.get(groupId);
    return groupModels?.length ? [{ id: groupId, models: groupModels }] : [];
  });
}
