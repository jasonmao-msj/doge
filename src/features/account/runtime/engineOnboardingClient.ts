import {
  createAccountEngineCheckoutV1,
  prepareAccountEngineV1,
  readAccountEngineCatalogV1,
  readAccountEngineCheckoutV1,
  readPendingAccountEngineCheckoutV1,
  readAccountEnginePlansV1,
  readAccountEngineReadinessV1,
} from "../../../services/accountEngineCommands";

export const MANAGED_ENGINE_IDS_V1 = ["codex", "claude-code"] as const;
export type ManagedEngineIdV1 = (typeof MANAGED_ENGINE_IDS_V1)[number];

export type EngineEntitlementV1 = {
  readonly status: "active" | "none";
  readonly expiresAt: string | null;
};

export type ManagedEngineViewV1 = {
  readonly id: ManagedEngineIdV1;
  readonly displayName: string;
  readonly entitlement: EngineEntitlementV1;
};

export type SubscriptionPlanViewV1 = {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  readonly price: number;
  readonly originalPrice: number | null;
  readonly currency: string;
  readonly validityDays: number;
  readonly validityUnit: string;
  readonly features: readonly string[];
  readonly dailyLimitUsd: number | null;
  readonly weeklyLimitUsd: number | null;
  readonly monthlyLimitUsd: number | null;
};

export type PaymentMethodViewV1 = {
  readonly id: string;
  readonly displayName: string;
  readonly currency: string;
};

export type EnginePlansViewV1 = {
  readonly engineId: ManagedEngineIdV1;
  readonly plans: readonly SubscriptionPlanViewV1[];
  readonly paymentMethods: readonly PaymentMethodViewV1[];
};

export type CheckoutViewV1 = {
  readonly checkoutId: number;
  readonly status: "pending" | "processing" | "paid" | "cancelled" | "expired" | "failed";
  readonly expiresAt: string;
  readonly action: null | {
    readonly kind: "open_url" | "show_qr" | "unsupported";
    readonly url: string | null;
    readonly data: string | null;
  };
};

export type EngineReadinessViewV1 = {
  readonly engineId: ManagedEngineIdV1;
  readonly status: "signedOut" | "needsPreparation" | "ready";
};

export type PendingEngineCheckoutViewV1 = {
  readonly engineId: ManagedEngineIdV1;
  readonly checkout: CheckoutViewV1;
};

export type EngineOnboardingFailureV1 = {
  readonly code: string;
};

export type EngineOnboardingResultV1<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: EngineOnboardingFailureV1 };

export type AccountEngineOnboardingClientV1 = {
  readonly catalog: () => Promise<EngineOnboardingResultV1<readonly ManagedEngineViewV1[]>>;
  readonly plans: (engineId: ManagedEngineIdV1) => Promise<EngineOnboardingResultV1<EnginePlansViewV1>>;
  readonly readiness: (engineId: ManagedEngineIdV1) => Promise<EngineOnboardingResultV1<EngineReadinessViewV1>>;
  readonly checkout: (
    engineId: ManagedEngineIdV1,
    planId: number,
    paymentType: string,
  ) => Promise<EngineOnboardingResultV1<CheckoutViewV1>>;
  readonly readCheckout: (checkoutId: number) => Promise<EngineOnboardingResultV1<CheckoutViewV1>>;
  readonly resumeCheckout: () => Promise<EngineOnboardingResultV1<PendingEngineCheckoutViewV1 | null>>;
  readonly prepare: (engineId: ManagedEngineIdV1) => Promise<EngineOnboardingResultV1<EngineReadinessViewV1>>;
};

export function createAccountEngineOnboardingClientV1(): AccountEngineOnboardingClientV1 {
  return {
    catalog: async () => parseCatalog(await readAccountEngineCatalogV1()),
    plans: async (engineId) => parsePlans(await readAccountEnginePlansV1(engineId)),
    readiness: async (engineId) => parseReadiness(await readAccountEngineReadinessV1(engineId)),
    checkout: async (engineId, planId, paymentType) => parseCheckout(
      await createAccountEngineCheckoutV1({
        engineId,
        planId,
        paymentType,
        operationId: newOperationId(),
      }),
    ),
    readCheckout: async (checkoutId) => parseCheckout(
      await readAccountEngineCheckoutV1(checkoutId),
    ),
    resumeCheckout: async () => parsePendingCheckout(
      await readPendingAccountEngineCheckoutV1(),
    ),
    prepare: async (engineId) => parseReadiness(
      await prepareAccountEngineV1(engineId, newOperationId()),
    ),
  };
}

function parsePendingCheckout(
  value: unknown,
): EngineOnboardingResultV1<PendingEngineCheckoutViewV1 | null> {
  const envelope = readEnvelope(value);
  if (!envelope.ok) return envelope;
  if (envelope.value === null) return { ok: true, value: null };
  const root = asObject(envelope.value);
  if (!root || !isManagedEngineId(root.engine_id)) return protocolFailure();
  const checkout = parseCheckout({ ok: true, value: root.checkout });
  if (!checkout.ok) return checkout;
  return { ok: true, value: { engineId: root.engine_id, checkout: checkout.value } };
}

function parseCatalog(value: unknown): EngineOnboardingResultV1<readonly ManagedEngineViewV1[]> {
  const envelope = readEnvelope(value);
  if (!envelope.ok) return envelope;
  const root = asObject(envelope.value);
  if (!root || !Array.isArray(root.engines) || root.engines.length !== MANAGED_ENGINE_IDS_V1.length) {
    return protocolFailure();
  }
  const engines = root && Array.isArray(root.engines)
    ? root.engines.map(parseEngine).filter((entry): entry is ManagedEngineViewV1 => entry !== null)
    : [];
  if (engines.length !== MANAGED_ENGINE_IDS_V1.length) return protocolFailure();
  if (!MANAGED_ENGINE_IDS_V1.every((id) => engines.some((engine) => engine.id === id))) {
    return protocolFailure();
  }
  return { ok: true, value: engines };
}

function parseEngine(value: unknown): ManagedEngineViewV1 | null {
  const object = asObject(value);
  const entitlement = asObject(object?.entitlement);
  const id = object?.id;
  const status = entitlement?.status;
  if (!object || !entitlement || !isManagedEngineId(id) || typeof object.display_name !== "string" ||
    (status !== "active" && status !== "none")) return null;
  const expiresAt = entitlement.expires_at;
  if (!isNullish(expiresAt) && typeof expiresAt !== "string") return null;
  return {
    id,
    displayName: object.display_name,
    entitlement: { status, expiresAt: expiresAt ?? null },
  };
}

function parsePlans(value: unknown): EngineOnboardingResultV1<EnginePlansViewV1> {
  const envelope = readEnvelope(value);
  if (!envelope.ok) return envelope;
  const root = asObject(envelope.value);
  if (!root || !isManagedEngineId(root.engine_id) || !Array.isArray(root.plans) ||
    !Array.isArray(root.payment_methods)) return protocolFailure();
  const plans = root.plans.map(parsePlan);
  const paymentMethods = root.payment_methods.map(parsePaymentMethod);
  if (plans.some((plan) => plan === null) || paymentMethods.some((method) => method === null)) {
    return protocolFailure();
  }
  return {
    ok: true,
    value: {
      engineId: root.engine_id,
      plans: plans as SubscriptionPlanViewV1[],
      paymentMethods: paymentMethods as PaymentMethodViewV1[],
    },
  };
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
  if (!method || typeof method.id !== "string" || method.id.length === 0 ||
    typeof method.display_name !== "string" || typeof method.currency !== "string") return null;
  return { id: method.id, displayName: method.display_name, currency: method.currency };
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
      action,
    },
  };
}

function parseCheckoutAction(value: unknown): CheckoutViewV1["action"] {
  const action = asObject(value);
  if (!action || !["open_url", "show_qr", "unsupported"].includes(String(action.kind))) return null;
  if (!isNullish(action.url) && typeof action.url !== "string") return null;
  if (!isNullish(action.data) && typeof action.data !== "string") return null;
  if (action.kind === "open_url") {
    if (typeof action.url !== "string" || action.url.length > 2_048 || !isNullish(action.data)) return null;
    try {
      const url = new URL(action.url);
      if (url.protocol !== "https:" || url.username !== "" || url.password !== "") return null;
    } catch {
      return null;
    }
  }
  if (action.kind === "show_qr") {
    if (typeof action.data !== "string" || action.data.trim() === "" || action.data.length > 4_096 ||
      containsControlCharacter(action.data) || !isNullish(action.url)) return null;
  }
  if (action.kind === "unsupported" && (!isNullish(action.url) || !isNullish(action.data))) return null;
  return {
    kind: action.kind as NonNullable<CheckoutViewV1["action"]>["kind"],
    url: typeof action.url === "string" ? action.url : null,
    data: typeof action.data === "string" ? action.data : null,
  };
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) return true;
  }
  return false;
}

function parseReadiness(value: unknown): EngineOnboardingResultV1<EngineReadinessViewV1> {
  const envelope = readEnvelope(value);
  if (!envelope.ok) return envelope;
  const readiness = asObject(envelope.value);
  if (!readiness || !isManagedEngineId(readiness.engineId) ||
    !["signedOut", "needsPreparation", "ready"].includes(String(readiness.status))) {
    return protocolFailure();
  }
  return {
    ok: true,
    value: {
      engineId: readiness.engineId,
      status: readiness.status as EngineReadinessViewV1["status"],
    },
  };
}

function readEnvelope(value: unknown): EngineOnboardingResultV1<unknown> {
  const envelope = asObject(value);
  if (!envelope || typeof envelope.ok !== "boolean") return protocolFailure();
  if (envelope.ok) return { ok: true, value: envelope.value };
  const error = asObject(envelope.error);
  return {
    ok: false,
    error: { code: typeof error?.code === "string" ? error.code : "serviceUnavailable" },
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isManagedEngineId(value: unknown): value is ManagedEngineIdV1 {
  return MANAGED_ENGINE_IDS_V1.includes(value as ManagedEngineIdV1);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
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
