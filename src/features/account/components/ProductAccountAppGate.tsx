import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { useAccountExperienceControllerV1 } from "../hooks/useAccountExperienceController";
import { useAccountExperienceCopyV1 } from "../hooks/useAccountExperienceCopy";
import {
  createAccountProductOnboardingClientV1,
  type AccountProductOnboardingClientV1,
  type ProductCatalogViewV1,
} from "../runtime/productOnboardingClient";
import {
  clearProductEntitlementV1,
  publishProductReadyV1,
  publishProductRequiredV1,
} from "../runtime/productEntitlementStore";
import { refreshProductModelsV1 } from "../runtime/productModelCatalogRefresh";
import {
  prepareProductEngineProvisioningV1,
  type ProductEngineProvisioningResultV1,
  type ProductProvisioningEngineIdV1,
} from "../runtime/productEngineProvisioning";
import type {
  CheckoutViewV1,
  PaymentMethodViewV1,
  SubscriptionPlanViewV1,
  EngineOnboardingFailureV1,
} from "../runtime/engineOnboardingClient";
import { openAccountExternalUrl } from "../../../services/accountExternalLinks";
import { AccountAuthPanel } from "./AccountExperience";
import {
  CheckoutQrCode,
  GateFailure,
  GateFrame,
  GateInlineFailure,
  GateLoading,
  PaymentMethodList,
  gateFailureMessage,
  interpolate,
  type GateAccountExit,
} from "./AccountAppGateViews";

type ProductGatePhase =
  | "catalog"
  | "subscription"
  | "paymentMethod"
  | "checkout"
  | "fulfilling"
  | "preparing"
  | "ready";

const PRODUCT_FULFILLMENT_MAX_ATTEMPTS = 15;
const PRODUCT_MODEL_REFRESH_INTERVAL_MS = 60_000;

export function ProductAccountAppGate({
  client: injectedClient,
  prepareToolchains = prepareProductEngineProvisioningV1,
  readyContent,
}: {
  readonly client?: AccountProductOnboardingClientV1;
  readonly prepareToolchains?: (options?: {
    readonly onEngine?: (engineId: ProductProvisioningEngineIdV1) => void;
  }) => Promise<ProductEngineProvisioningResultV1>;
  readonly readyContent?: ReactNode;
}) {
  const client = useMemo(
    () => injectedClient ?? createAccountProductOnboardingClientV1(),
    [injectedClient],
  );
  const controller = useAccountExperienceControllerV1({ loadAuthenticatedExtras: false });
  const copy = useAccountExperienceCopyV1();
  const [phase, setPhase] = useState<ProductGatePhase>("catalog");
  const [catalog, setCatalog] = useState<ProductCatalogViewV1 | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlanViewV1 | null>(null);
  const [checkout, setCheckout] = useState<CheckoutViewV1 | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutFailure, setLogoutFailure] = useState<string | null>(null);
  const [retryUntil, setRetryUntil] = useState(0);
  const [retryClock, setRetryClock] = useState(() => Date.now());
  const [fulfillmentRun, setFulfillmentRun] = useState(0);
  const [preparingEngine, setPreparingEngine] =
    useState<ProductProvisioningEngineIdV1 | null>(null);
  const generation = useRef(0);
  const loadingCatalog = useRef(false);
  const preparing = useRef(false);
  const retryUntilRef = useRef(0);

  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((retryUntil - retryClock) / 1_000),
  );
  const recordFailure = useCallback((error: EngineOnboardingFailureV1 | null | undefined) => {
    setFailure(error?.code ?? "serviceUnavailable");
    const retryAfterMs = Math.min(60_000, Math.max(0, error?.retryAfterMs ?? 0));
    const nextRetryUntil = retryAfterMs > 0 ? Date.now() + retryAfterMs : 0;
    retryUntilRef.current = nextRetryUntil;
    setRetryUntil(nextRetryUntil);
  }, []);

  useEffect(() => {
    if (retryUntil <= Date.now()) return;
    const timer = window.setInterval(() => setRetryClock(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [retryUntil]);

  const prepare = useCallback(async (requestGeneration: number) => {
    if (preparing.current || retryUntilRef.current > Date.now()) return;
    preparing.current = true;
    setPhase("preparing");
    setFailure(null);
    try {
      const provisioned = await prepareToolchains({
        onEngine: setPreparingEngine,
      }).catch(() => null);
      if (requestGeneration !== generation.current) return;
      if (!provisioned?.ok) {
        recordFailure(provisioned?.error);
        return;
      }
      const result = await client.prepare().catch(() => null);
      if (requestGeneration !== generation.current) return;
      if (!result?.ok) {
        recordFailure(result?.error);
        return;
      }
      retryUntilRef.current = 0;
      setRetryUntil(0);
      publishProductReadyV1(result.value);
      setPhase("ready");
    } finally {
      preparing.current = false;
      setPreparingEngine(null);
    }
  }, [client, prepareToolchains, recordFailure]);

  const loadCatalog = useCallback(async () => {
    if (loadingCatalog.current || retryUntilRef.current > Date.now()) return;
    loadingCatalog.current = true;
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    setPhase("catalog");
    setFailure(null);
    try {
      const result = await client.catalog();
      if (requestGeneration !== generation.current) return;
      if (!result.ok) {
        recordFailure(result.error);
        return;
      }
      retryUntilRef.current = 0;
      setRetryUntil(0);
      setCatalog(result.value);
      if (result.value.entitlement.status === "active") {
        await prepare(requestGeneration);
        return;
      }
      publishProductRequiredV1(result.value.engines);
      const pending = await client.resumeCheckout();
      if (requestGeneration !== generation.current) return;
      if (!pending.ok) {
        recordFailure(pending.error);
        return;
      }
      if (pending.value && ["pending", "processing"].includes(pending.value.status)) {
        setCheckout(pending.value);
        setPhase("checkout");
        await openCheckoutAction(pending.value, setFailure);
        return;
      }
      if (pending.value?.status === "paid") {
        setCheckout(pending.value);
        setPhase("fulfilling");
        return;
      }
      setCheckout(null);
      setSelectedPlan(null);
      setPhase("subscription");
    } finally {
      loadingCatalog.current = false;
    }
  }, [client, prepare, recordFailure]);

  useEffect(() => {
    if (controller.bootstrap?.session.status !== "authenticated") {
      generation.current += 1;
      clearProductEntitlementV1();
      return;
    }
    void loadCatalog();
  }, [controller.bootstrap?.session.status, loadCatalog]);

  useEffect(() => {
    if (phase !== "ready") return;
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshProductModelsV1();
      }
    };
    const interval = window.setInterval(
      refreshIfVisible,
      PRODUCT_MODEL_REFRESH_INTERVAL_MS,
    );
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [phase]);

  const startCheckout = useCallback(async (
    plan: SubscriptionPlanViewV1,
    method: PaymentMethodViewV1,
  ) => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await client.checkout(plan.id, method.id);
      if (!result.ok) {
        recordFailure(result.error);
        return;
      }
      setSelectedPlan(plan);
      setCheckout(result.value);
      setPhase("checkout");
      await openCheckoutAction(result.value, setFailure);
    } catch {
      setFailure("serviceUnavailable");
    } finally {
      setBusy(false);
    }
  }, [busy, client, recordFailure]);

  const abandonCheckout = useCallback(async () => {
    if (!checkout || busy) return;
    setBusy(true);
    const result = await client.abandonCheckout(checkout.checkoutId).catch(() => null);
    if (!result?.ok) {
      recordFailure(result?.error);
      setBusy(false);
      return;
    }
    setCheckout(null);
    setSelectedPlan(null);
    setFailure(null);
    setPhase("subscription");
    setBusy(false);
  }, [busy, checkout, client, recordFailure]);

  useEffect(() => {
    if (phase !== "checkout" || !checkout ||
      !["pending", "processing"].includes(checkout.status)) return;
    const requestGeneration = generation.current;
    let disposed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      const result = await client.readCheckout(checkout.checkoutId).catch(() => null);
      if (disposed || requestGeneration !== generation.current) return;
      if (!result?.ok) {
        recordFailure(result?.error);
        return;
      }
      setCheckout((current) => mergeProductCheckoutRefreshV1(current, result.value));
      if (result.value.status === "paid") {
        setPhase("fulfilling");
        return;
      }
      if (["cancelled", "expired", "failed"].includes(result.value.status)) return;
      attempt += 1;
      timer = setTimeout(() => void poll(), Math.min(15_000, 2_000 + attempt * 1_000));
    };
    timer = setTimeout(() => void poll(), 2_000);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [checkout, client, loadCatalog, phase, recordFailure]);

  useEffect(() => {
    if (phase !== "fulfilling") return;
    const requestGeneration = generation.current;
    let disposed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reconcile = async () => {
      const result = await client.catalog({ forceRefresh: true }).catch(() => null);
      if (disposed || requestGeneration !== generation.current) return;
      if (!result?.ok) {
        recordFailure(result?.error);
        return;
      }
      setCatalog(result.value);
      if (result.value.entitlement.status === "active") {
        await prepare(requestGeneration);
        return;
      }
      attempt += 1;
      if (attempt >= PRODUCT_FULFILLMENT_MAX_ATTEMPTS) {
        setFailure("fulfillmentDelayed");
        return;
      }
      timer = setTimeout(
        () => void reconcile(),
        productFulfillmentPollDelayMs(attempt),
      );
    };
    setFailure(null);
    void reconcile();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [client, fulfillmentRun, phase, prepare, recordFailure]);

  const logoutFromGate = useCallback(async () => {
    if (logoutBusy || controller.busy) return;
    setLogoutBusy(true);
    setLogoutFailure(null);
    const signedOut = await controller.logout("thisDevice");
    if (signedOut) {
      generation.current += 1;
      clearProductEntitlementV1();
    } else {
      setLogoutFailure("serviceUnavailable");
    }
    setLogoutBusy(false);
  }, [controller, logoutBusy]);

  const accountExit: GateAccountExit = {
    copy,
    busy: logoutBusy || controller.busy || busy,
    failureCode: logoutFailure,
    onLogout: () => void logoutFromGate(),
  };

  if (controller.loading) return <GateLoading label={copy.gateConnecting} />;
  if (controller.bootstrap === null) {
    return <GateFailure copy={copy} code={controller.failure?.code ?? "serviceUnavailable"} onRetry={() => void controller.retry()} />;
  }
  if (controller.bootstrap.session.status !== "authenticated") {
    return (
      <GateFrame>
        <div className="account-gate-auth">
          <AccountAuthPanel controller={controller} />
          {controller.failure ? <GateInlineFailure copy={copy} code={controller.failure.code} /> : null}
        </div>
      </GateFrame>
    );
  }
  if (phase === "ready") return <>{readyContent ?? null}</>;
  if (phase === "catalog") {
    return failure
      ? <GateFailure copy={copy} code={failure} onRetry={() => void loadCatalog()} retryAfterSeconds={retryAfterSeconds} accountExit={accountExit} />
      : <GateLoading label={copy.gateConfirmingServices} accountExit={accountExit} />;
  }
  if (phase === "preparing") {
    return (
      <GateFrame accountExit={accountExit}>
        <div className="account-gate-centered" role={failure ? "alert" : "status"}>
          {failure ? null : <LoaderCircle className="account-gate-spin" aria-hidden />}
          {failure ? (
            <p className="account-gate-preparation-failure">
              {gateFailureMessage(failure, copy)}
            </p>
          ) : (
            <h1>
              {interpolate(
                copy.gatePreparingTemplate,
                "engine",
                productProvisioningEngineLabel(preparingEngine),
              )}
            </h1>
          )}
          {failure ? (
            <>
              <button
                className="account-gate-primary"
                type="button"
                disabled={retryAfterSeconds > 0}
                onClick={() => void prepare(generation.current)}
              >
                {retryAfterSeconds > 0
                  ? interpolate(copy.gateRetryAfterSecondsTemplate, "seconds", String(retryAfterSeconds))
                  : copy.retry}
              </button>
            </>
          ) : null}
        </div>
      </GateFrame>
    );
  }
  if (phase === "fulfilling") {
    return (
      <GateFrame accountExit={accountExit}>
        <div className="account-gate-centered" role={failure ? "alert" : "status"}>
          {failure ? <CircleAlert aria-hidden /> : <LoaderCircle className="account-gate-spin" aria-hidden />}
          <h1>
            {failure ? copy.gateFulfillingDelayed : copy.gateFulfillingSubscription}
          </h1>
          {failure ? (
            <button
              className="account-gate-primary"
              type="button"
              onClick={() => setFulfillmentRun((current) => current + 1)}
            >
              {copy.retry}
            </button>
          ) : null}
        </div>
      </GateFrame>
    );
  }
  if (phase === "paymentMethod" && catalog && selectedPlan) {
    return (
      <GateFrame accountExit={accountExit}>
        <div className="account-product-plan-heading">
          <strong>{selectedPlan.name}</strong>
          <span>{selectedPlan.description}</span>
        </div>
        <PaymentMethodList
          copy={copy}
          methods={catalog.paymentMethods}
          onSelect={(method) => void startCheckout(selectedPlan, method)}
        />
        <button className="account-gate-text-button" type="button" onClick={() => setPhase("subscription")}>{copy.gateBackToPlans}</button>
        {failure ? <GateInlineFailure copy={copy} code={failure} /> : null}
      </GateFrame>
    );
  }
  if (phase === "subscription" && catalog) {
    return (
      <GateFrame accountExit={accountExit} brandLabel="Doge">
        <div className="account-product-plan-list">
          {catalog.plans.map((plan) => (
            <article className="account-product-plan" key={plan.id}>
              <div className="account-product-plan-head">
                <div className="account-product-plan-title">
                  <h1>{plan.name}</h1>
                  {plan.description ? <p title={plan.description}>{plan.description}</p> : null}
                </div>
                <span className="account-product-plan-price">
                  <strong>{formatMoney(plan.price, plan.currency)}</strong>
                  <small>{formatProductPlanValidity(plan, copy)}</small>
                </span>
              </div>
              <div className="account-product-plan-lines">
                <div className="account-product-plan-line">
                  <span>{copy.gateProductEngines}</span>
                  <span>{catalog.engines.map((engine) => engine.displayName).join(" · ")}</span>
                </div>
                <div className="account-product-plan-line">
                  <span>{copy.gateProductModels}</span>
                  <span>{productPlanModelSummary(plan, copy)}</span>
                </div>
              </div>
              <button
                className="account-product-plan-cta"
                type="button"
                disabled={busy}
                onClick={() => {
                  setSelectedPlan(plan);
                  if (catalog.paymentMethods.length === 1) {
                    void startCheckout(plan, catalog.paymentMethods[0]!);
                  } else {
                    setPhase("paymentMethod");
                  }
                }}
              >
                {copy.gateSubscribeNow}
              </button>
            </article>
          ))}
        </div>
        {failure ? <GateInlineFailure copy={copy} code={failure} /> : null}
      </GateFrame>
    );
  }
  if (phase === "checkout" && checkout) {
    const terminal = ["cancelled", "expired", "failed"].includes(checkout.status);
    return (
      <GateFrame accountExit={accountExit}>
        <div className="account-gate-centered" role="status">
          {terminal ? <CircleAlert aria-hidden /> : <LoaderCircle className="account-gate-spin" aria-hidden />}
          <h1>{terminal ? copy.gatePaymentFailed : (selectedPlan?.name ?? checkout.planName ?? copy.gateWaitingPayment)}</h1>
          {checkout.action?.kind === "show_qr" && checkout.action.data ? (
            <CheckoutQrCode copy={copy} value={checkout.action.data} />
          ) : null}
          {checkout.action?.kind === "open_url" && checkout.action.url ? (
            <button className="account-gate-secondary" type="button" onClick={() => void openCheckoutAction(checkout, setFailure)}>
              {copy.gateReopenPayment}
            </button>
          ) : null}
          <button className="account-gate-text-button" type="button" disabled={busy} onClick={() => void abandonCheckout()}>
            {copy.gateBackToPlans}
          </button>
          {failure ? <GateInlineFailure copy={copy} code={failure} /> : null}
        </div>
      </GateFrame>
    );
  }
  return <GateFailure copy={copy} code="protocolMismatch" onRetry={() => void loadCatalog()} accountExit={accountExit} />;
}

function productProvisioningEngineLabel(
  engineId: ProductProvisioningEngineIdV1 | null,
): string {
  if (engineId === "codex") return "Codex";
  if (engineId === "claude-code") return "Claude Code";
  if (engineId === "kimi") return "Kimi CLI";
  return "Doge";
}

async function openCheckoutAction(
  checkout: CheckoutViewV1,
  setFailure: (code: string | null) => void,
) {
  if (checkout.action?.kind !== "open_url" || !checkout.action.url) return;
  try {
    await openAccountExternalUrl(checkout.action.url);
  } catch {
    setFailure("checkoutOpenFailed");
  }
}

export function mergeProductCheckoutRefreshV1(
  current: CheckoutViewV1 | null,
  refreshed: CheckoutViewV1,
): CheckoutViewV1 {
  return current?.checkoutId === refreshed.checkoutId
    ? { ...refreshed, action: refreshed.action ?? current.action }
    : refreshed;
}

function formatMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "CNY",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`.trim();
  }
}

export function productFulfillmentPollDelayMs(attempt: number): number {
  return Math.min(5_000, 1_000 + Math.max(0, attempt - 1) * 500);
}

function formatProductPlanValidity(
  plan: SubscriptionPlanViewV1,
  copy: ReturnType<typeof useAccountExperienceCopyV1>,
): string {
  if (plan.validityDays === 30) return copy.gateMonth;
  return interpolate(copy.gateDaysTemplate, "days", String(plan.validityDays));
}

function productPlanModelSummary(
  plan: SubscriptionPlanViewV1,
  copy: ReturnType<typeof useAccountExperienceCopyV1>,
): string {
  const features = plan.features.map((feature) => feature.trim()).filter(Boolean);
  return features.length > 0
    ? features.join(" · ")
    : copy.gateProductModelsAfterActivation;
}
