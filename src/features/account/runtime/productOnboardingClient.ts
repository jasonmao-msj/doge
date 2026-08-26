import {
  abandonAccountProductCheckoutV1,
  createAccountProductCheckoutV1,
  prepareAccountProductV1,
  readAccountProductCatalogV1,
  readAccountProductCheckoutV1,
  readAccountProductModelsV1,
  readPendingAccountProductCheckoutV1,
} from "../../../services/accountProductCommands";
import type {
  CheckoutViewV1,
  EngineOnboardingFailureV1,
  EngineOnboardingResultV1,
  PaymentMethodViewV1,
  SubscriptionPlanViewV1,
} from "./onboardingTypes";
import {
  PRODUCT_RUNTIME_ENGINE_IDS_V1,
  type ProductRuntimeEngineIdV1,
} from "./productManagedEnginePolicy";
export {
  PRODUCT_RUNTIME_ENGINE_IDS_V1,
  type ProductRuntimeEngineIdV1,
} from "./productManagedEnginePolicy";

export const PRODUCT_ENGINE_IDS_V1 = ["codex", "claude-code", "kimi"] as const;
export type ProductEngineIdV1 = (typeof PRODUCT_ENGINE_IDS_V1)[number];

export type ProductEntitlementV1 = {
  readonly status: "active" | "required";
  readonly subscriptionId: number | null;
  readonly groupId: number | null;
  readonly groupName: string | null;
  readonly planName: string | null;
  readonly expiresAt: string | null;
  readonly usage: ProductUsageWindowsV1 | null;
};

export type ProductUsageWindowV1 = {
  readonly usedUsd: number;
  readonly limitUsd: number;
  readonly percentage: number;
};

export type ProductUsageWindowsV1 = {
  readonly daily: ProductUsageWindowV1;
  readonly weekly: ProductUsageWindowV1;
  readonly monthly: ProductUsageWindowV1;
};

export type ProductEngineViewV1 = {
  readonly id: ProductEngineIdV1;
  readonly displayName: string;
};

export type ProductModelViewV1 = {
  readonly id: string;
  readonly displayName: string;
  readonly model: string;
  readonly compatibleEngines: readonly ProductRuntimeEngineIdV1[];
  readonly capabilities: readonly string[];
};

export type ProductModelsViewV1 = {
  readonly models: readonly ProductModelViewV1[];
  readonly fetchedAt: string;
};

export type ProductCatalogViewV1 = {
  readonly entitlement: ProductEntitlementV1;
  readonly plans: readonly SubscriptionPlanViewV1[];
  readonly paymentMethods: readonly PaymentMethodViewV1[];
  readonly engines: readonly ProductEngineViewV1[];
};

export type ProductReadyViewV1 = {
  readonly status: "ready";
  readonly entitlement: ProductEntitlementV1;
  readonly models: readonly ProductModelViewV1[];
  readonly engines: readonly ProductEngineViewV1[];
};

export type AccountProductOnboardingClientV1 = {
  readonly catalog: (options?: {
    readonly forceRefresh?: boolean;
  }) => Promise<EngineOnboardingResultV1<ProductCatalogViewV1>>;
  readonly checkout: (
    planId: number,
    paymentType: string,
  ) => Promise<EngineOnboardingResultV1<CheckoutViewV1>>;
  readonly readCheckout: (checkoutId: number) => Promise<EngineOnboardingResultV1<CheckoutViewV1>>;
  readonly resumeCheckout: () => Promise<EngineOnboardingResultV1<CheckoutViewV1 | null>>;
  readonly abandonCheckout: (checkoutId: number) => Promise<EngineOnboardingResultV1<null>>;
  readonly prepare: () => Promise<EngineOnboardingResultV1<ProductReadyViewV1>>;
  readonly models: () => Promise<EngineOnboardingResultV1<ProductModelsViewV1>>;
};

const PRODUCT_CATALOG_CACHE_TTL_MS = 30_000;

export function createAccountProductOnboardingClientV1(): AccountProductOnboardingClientV1 {
  let catalogCache: {
    readonly expiresAt: number;
    readonly result: EngineOnboardingResultV1<ProductCatalogViewV1>;
  } | null = null;
  let catalogInFlight: Promise<EngineOnboardingResultV1<ProductCatalogViewV1>> | null = null;
  const invalidateCatalog = () => {
    catalogCache = null;
  };
  const catalog: AccountProductOnboardingClientV1["catalog"] = async (options = {}) => {
    if (!options.forceRefresh && catalogCache && catalogCache.expiresAt > Date.now()) {
      return catalogCache.result;
    }
    if (catalogInFlight) return catalogInFlight;
    catalogInFlight = readAccountProductCatalogV1()
      .then(parseProductCatalog)
      .then((result) => {
        if (result.ok) {
          catalogCache = {
            expiresAt: Date.now() + PRODUCT_CATALOG_CACHE_TTL_MS,
            result,
          };
        }
        return result;
      })
      .finally(() => {
        catalogInFlight = null;
      });
    return catalogInFlight;
  };
  return {
    catalog,
    checkout: async (planId, paymentType) => {
      const result = parseCheckout(await createAccountProductCheckoutV1({
        planId,
        paymentType,
        operationId: newOperationId(),
      }));
      if (result.ok) invalidateCatalog();
      return result;
    },
    readCheckout: async (checkoutId) => {
      const result = parseCheckout(await readAccountProductCheckoutV1(checkoutId));
      if (result.ok && result.value.status === "paid") invalidateCatalog();
      return result;
    },
    resumeCheckout: async () => parseOptionalCheckout(
      await readPendingAccountProductCheckoutV1(),
    ),
    abandonCheckout: async (checkoutId) => {
      const result = parseAcknowledgement(await abandonAccountProductCheckoutV1(checkoutId));
      if (result.ok) invalidateCatalog();
      return result;
    },
    prepare: async () => parseProductReady(
      await prepareAccountProductV1(newOperationId()),
    ),
    models: async () => parseProductModels(
      await readAccountProductModelsV1(),
    ),
  };
}

export function parseProductCatalog(
  value: unknown,
): EngineOnboardingResultV1<ProductCatalogViewV1> {
  const envelope = readEnvelope(value);
  if (!envelope.ok) return envelope;
  const root = asObject(envelope.value);
  if (!root || !Array.isArray(root.plans) || !Array.isArray(root.payment_methods) ||
    !Array.isArray(root.engines)) return protocolFailure();
  const entitlement = parseEntitlement(root.entitlement);
  const plans = root.plans.map(parsePlan);
  const methods = root.payment_methods.map(parsePaymentMethod);
  const engines = root.engines.map(parseEngine);
  if (!entitlement || plans.length === 0 || plans.some((item) => item === null) ||
    methods.some((item) => item === null) || engines.some((item) => item === null) ||
    !PRODUCT_ENGINE_IDS_V1.every((id) => engines.some((engine) => engine?.id === id))) {
    return protocolFailure();
  }
  return {
    ok: true,
    value: {
      entitlement,
      plans: plans as SubscriptionPlanViewV1[],
      paymentMethods: methods as PaymentMethodViewV1[],
      engines: engines as ProductEngineViewV1[],
    },
  };
}

export function parseProductReady(
  value: unknown,
): EngineOnboardingResultV1<ProductReadyViewV1> {
  const envelope = readEnvelope(value);
  if (!envelope.ok) return envelope;
  const root = asObject(envelope.value);
  if (!root || root.status !== "ready" || !Array.isArray(root.models) ||
    !Array.isArray(root.engines)) return protocolFailure();
  const entitlement = parseEntitlement(root.entitlement);
  const models = root.models.map(parseModel);
  const engines = root.engines.map(parseEngine);
  if (!entitlement || entitlement.status !== "active" ||
    models.some((item) => item === null) || engines.some((item) => item === null)) {
    return protocolFailure();
  }
  return {
    ok: true,
    value: {
      status: "ready",
      entitlement,
      models: models as ProductModelViewV1[],
      engines: engines as ProductEngineViewV1[],
    },
  };
}

export function parseProductModels(
  value: unknown,
): EngineOnboardingResultV1<ProductModelsViewV1> {
  const envelope = readEnvelope(value);
  if (!envelope.ok) return envelope;
  const root = asObject(envelope.value);
  if (!root || !Array.isArray(root.models) || typeof root.fetched_at !== "string") {
    return protocolFailure();
  }
  const models = root.models.map(parseModel);
  if (models.length === 0 || models.some((item) => item === null)) {
    return protocolFailure();
  }
  return {
    ok: true,
    value: {
      models: models as ProductModelViewV1[],
      fetchedAt: root.fetched_at,
    },
  };
}

function parseEntitlement(value: unknown): ProductEntitlementV1 | null {
  const item = asObject(value);
  if (!item || (item.status !== "active" && item.status !== "required")) return null;
  if (item.status === "required") {
    return {
      status: "required",
      subscriptionId: null,
      groupId: null,
      groupName: null,
      planName: null,
      expiresAt: null,
      usage: null,
    };
  }
  if (!positiveInteger(item.subscription_id) || !positiveInteger(item.group_id) ||
    typeof item.group_name !== "string" || typeof item.plan_name !== "string" ||
    item.plan_name.trim() === "" || typeof item.expires_at !== "string") return null;
  const usageRoot = asObject(item.usage);
  const daily = parseUsageWindow(usageRoot?.daily);
  const weekly = parseUsageWindow(usageRoot?.weekly);
  const monthly = parseUsageWindow(usageRoot?.monthly);
  if (!daily || !weekly || !monthly) return null;
  return {
    status: "active",
    subscriptionId: item.subscription_id,
    groupId: item.group_id,
    groupName: item.group_name,
    planName: item.plan_name,
    expiresAt: item.expires_at,
    usage: { daily, weekly, monthly },
  };
}

function parseUsageWindow(value: unknown): ProductUsageWindowV1 | null {
  const item = asObject(value);
  if (!item || !finiteNonNegative(item.used_usd) || !finiteNonNegative(item.limit_usd) ||
    !finitePercentage(item.percentage)) return null;
  return {
    usedUsd: item.used_usd,
    limitUsd: item.limit_usd,
    percentage: item.percentage,
  };
}

function parseEngine(value: unknown): ProductEngineViewV1 | null {
  const item = asObject(value);
  if (!item || !isProductEngineId(item.id) || typeof item.display_name !== "string" ||
    item.display_name.trim() === "") return null;
  return { id: item.id, displayName: item.display_name };
}

function parseModel(value: unknown): ProductModelViewV1 | null {
  const item = asObject(value);
  if (!item || typeof item.id !== "string" || item.id.trim() === "" || item.id.length > 128 ||
    typeof item.display_name !== "string" || item.display_name.trim() === "" ||
    typeof item.model !== "string" || item.model.trim() === "" || item.model.length > 128 ||
    !Array.isArray(item.compatible_engines) ||
    !item.compatible_engines.every(isProductRuntimeEngineId) ||
    item.compatible_engines.length === 0 ||
    !Array.isArray(item.capabilities) ||
    !item.capabilities.every((capability) => typeof capability === "string")) return null;
  return {
    id: item.id.trim(),
    displayName: item.display_name.trim(),
    model: item.model.trim(),
    compatibleEngines: [...new Set(item.compatible_engines)],
    capabilities: item.capabilities,
  };
}

function isProductRuntimeEngineId(value: unknown): value is ProductRuntimeEngineIdV1 {
  return typeof value === "string" &&
    PRODUCT_RUNTIME_ENGINE_IDS_V1.includes(value as ProductRuntimeEngineIdV1);
}

function parsePlan(value: unknown): SubscriptionPlanViewV1 | null {
  const plan = asObject(value);
  if (!plan || !positiveInteger(plan.id) || typeof plan.name !== "string" ||
    typeof plan.description !== "string" || !finiteNonNegative(plan.price) ||
    typeof plan.currency !== "string" || !positiveInteger(plan.validity_days) ||
    typeof plan.validity_unit !== "string" || !Array.isArray(plan.features) ||
    !plan.features.every((feature) => typeof feature === "string")) return null;
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    originalPrice: finiteNonNegative(plan.original_price) ? plan.original_price : null,
    currency: plan.currency,
    validityDays: plan.validity_days,
    validityUnit: plan.validity_unit,
    features: plan.features,
    dailyLimitUsd: optionalNumber(plan.daily_limit_usd),
    weeklyLimitUsd: optionalNumber(plan.weekly_limit_usd),
    monthlyLimitUsd: optionalNumber(plan.monthly_limit_usd),
  };
}

function parsePaymentMethod(value: unknown): PaymentMethodViewV1 | null {
  const method = asObject(value);
  if (!method || typeof method.id !== "string" || method.id.trim() === "" ||
    typeof method.display_name !== "string" || typeof method.currency !== "string") return null;
  return { id: method.id, displayName: method.display_name, currency: method.currency };
}

function parseOptionalCheckout(
  value: unknown,
): EngineOnboardingResultV1<CheckoutViewV1 | null> {
  const envelope = readEnvelope(value);
  if (!envelope.ok) return envelope;
  if (envelope.value === null) return { ok: true, value: null };
  return parseCheckout({ ok: true, value: envelope.value });
}

function parseAcknowledgement(value: unknown): EngineOnboardingResultV1<null> {
  const envelope = readEnvelope(value);
  if (!envelope.ok) return envelope;
  return envelope.value === null ? { ok: true, value: null } : protocolFailure();
}

function parseCheckout(value: unknown): EngineOnboardingResultV1<CheckoutViewV1> {
  const envelope = readEnvelope(value);
  if (!envelope.ok) return envelope;
  const checkout = asObject(envelope.value);
  const statuses = ["pending", "processing", "paid", "cancelled", "expired", "failed"] as const;
  if (!checkout || !positiveInteger(checkout.checkout_id) ||
    !statuses.includes(checkout.status as typeof statuses[number]) ||
    typeof checkout.expires_at !== "string") return protocolFailure();
  const action = checkout.action === undefined || checkout.action === null
    ? null
    : parseCheckoutAction(checkout.action);
  if (checkout.action !== undefined && checkout.action !== null && action === null) {
    return protocolFailure();
  }
  return {
    ok: true,
    value: {
      checkoutId: checkout.checkout_id,
      status: checkout.status as CheckoutViewV1["status"],
      expiresAt: checkout.expires_at,
      planName: typeof checkout.plan_name === "string" ? checkout.plan_name : null,
      action,
    },
  };
}

function parseCheckoutAction(value: unknown): CheckoutViewV1["action"] {
  const action = asObject(value);
  if (!action || (action.kind !== "open_url" && action.kind !== "show_qr")) return null;
  if (action.kind === "open_url") {
    if (typeof action.url !== "string" || action.url.length > 2_048) return null;
    try {
      const url = new URL(action.url);
      if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;
    } catch {
      return null;
    }
    return { kind: "open_url", url: action.url, data: null };
  }
  if (typeof action.data !== "string" || action.data.trim() === "" ||
    action.data.length > 4_096) return null;
  return { kind: "show_qr", url: null, data: action.data };
}

function readEnvelope(value: unknown): EngineOnboardingResultV1<unknown> {
  const envelope = asObject(value);
  if (!envelope || typeof envelope.ok !== "boolean") return protocolFailure();
  if (envelope.ok) return { ok: true, value: envelope.value };
  const error = asObject(envelope.error);
  const recovery = asObject(error?.recovery);
  return {
    ok: false,
    error: {
      code: typeof error?.code === "string" ? error.code : "serviceUnavailable",
      ...(typeof error?.stage === "string" ? { stage: error.stage } : {}),
      ...(typeof recovery?.afterMs === "number" ? { retryAfterMs: recovery.afterMs } : {}),
    } as EngineOnboardingFailureV1,
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isProductEngineId(value: unknown): value is ProductEngineIdV1 {
  return PRODUCT_ENGINE_IDS_V1.includes(value as ProductEngineIdV1);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finitePercentage(value: unknown): value is number {
  return finiteNonNegative(value) && value <= 100;
}

function optionalNumber(value: unknown): number | null {
  return finiteNonNegative(value) ? value : null;
}

function protocolFailure(): EngineOnboardingResultV1<never> {
  return { ok: false, error: { code: "protocolMismatch" } };
}

function newOperationId(): string {
  return `operation_${crypto.randomUUID().replaceAll("-", "")}`;
}
