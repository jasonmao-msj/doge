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

export type CheckoutViewV1 = {
  readonly checkoutId: number;
  readonly status:
    | "pending"
    | "processing"
    | "paid"
    | "cancelled"
    | "expired"
    | "failed";
  readonly expiresAt: string;
  readonly planName: string | null;
  readonly action: null | {
    readonly kind: "open_url" | "show_qr" | "unsupported";
    readonly url: string | null;
    readonly data: string | null;
  };
};

export type EngineOnboardingFailureV1 = {
  readonly code: string;
  readonly stage?: string;
  readonly retryAfterMs?: number;
};

export type EngineOnboardingResultV1<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: EngineOnboardingFailureV1 };
