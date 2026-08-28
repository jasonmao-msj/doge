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
  publishProductModelsRefreshFailedV1,
  publishProductReadyV1,
  publishProductRequiredV1,
  publishProductShellReadyV1,
} from "../runtime/productEntitlementStore";
import { refreshProductModelsV1 } from "../runtime/productModelCatalogRefresh";
import { clearProductEngineProvisioningV1 } from "../runtime/productEngineProvisioning";
import type {
  CheckoutViewV1,
  PaymentMethodViewV1,
  SubscriptionPlanViewV1,
  EngineOnboardingFailureV1,
} from "../runtime/onboardingTypes";
import { prepareProductWithBoundedRetryV1 } from "../runtime/productPrepareRetry";
import { openAccountExternalUrl } from "../../../services/accountExternalLinks";
import { appendRendererDiagnostic } from "../../../services/rendererDiagnostics";
import { AccountAuthPanel } from "./AccountExperience";
import {
  CheckoutQrCode,
  GateFailure,
  GateFrame,
  GateInlineFailure,
  GateLoading,
  PaymentMethodList,
  interpolate,
  type GateAccountExit,
} from "./ProductAccountAppGateViews";

type ProductGatePhase =
  | "catalog"
  | "subscription"
  | "paymentMethod"
  | "checkout"
  | "fulfilling"
  | "ready";

const PRODUCT_FULFILLMENT_MAX_ATTEMPTS = 15;
const PRODUCT_MODEL_REFRESH_INTERVAL_MS = 60_000;

export function ProductAccountAppGate({
  client: injectedClient,
  readyContent,
}: {
  readonly client?: AccountProductOnboardingClientV1;
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

  const prepare = useCallback(async (
    requestGeneration: number,
    subscriptionId: number,
  ) => {
    if (preparing.current || retryUntilRef.current > Date.now()) return;
    preparing.current = true;
    try {
      const result = await prepareProductWithBoundedRetryV1(
        () => client.prepare(null),
        {
          isCurrent: () => requestGeneration === generation.current,
          onAttemptFailure: ({ error, attempt, maxAttempts, retryDelayMs }) => {
            appendRendererDiagnostic("account/product-prepare-attempt-failed", {
              code: error.code,
              stage: error.stage ?? "unknown",
              attempt,
              maxAttempts,
              retryDelayMs,
            });
          },
        },
      );
      if (requestGeneration !== generation.current) return;
      if (!result?.ok) {
        publishProductModelsRefreshFailedV1({
          subscriptionId,
          code: result?.error.code ?? "serviceUnavailable",
        });
        appendRendererDiagnostic("account/product-background-prepare-failed", {
          code: result?.error.code ?? "serviceUnavailable",
          stage: result?.error.stage ?? "unknown",
        });
        return;
      }
      publishProductReadyV1(result.value);
    } finally {
      preparing.current = false;
    }
  }, [client]);

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
        const subscriptionId = result.value.entitlement.subscriptionId;
        if (subscriptionId === null) {
          recordFailure({ code: "protocolMismatch" });
          return;
        }
        publishProductShellReadyV1({
          entitlement: result.value.entitlement,
          engines: result.value.engines,
        });
        setPhase("ready");
        void prepare(requestGeneration, subscriptionId);
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
      clearProductEngineProvisioningV1();
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

  const checkoutId = checkout?.checkoutId ?? null;
  const checkoutStatus = checkout?.status ?? null;
  const checkoutExpiresAt = checkout?.expiresAt ?? null;

  useEffect(() => {
    if (
      phase !== "checkout" ||
      checkoutId === null ||
      checkoutExpiresAt === null ||
      !["pending", "processing"].includes(checkoutStatus ?? "")
    ) return;
    const requestGeneration = generation.current;
    const activeCheckoutId = checkoutId;
    const expiresAtMs = Date.parse(checkoutExpiresAt);
    let disposed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function markExpired() {
      setCheckout((current) =>
        current?.checkoutId === activeCheckoutId &&
        ["pending", "processing"].includes(current.status)
          ? { ...current, status: "expired" }
          : current,
      );
    }

    function schedule(delayMs: number) {
      if (disposed) return;
      const remainingMs = expiresAtMs - Date.now();
      if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
        markExpired();
        return;
      }
      timer = setTimeout(
        () => void poll(),
        Math.max(0, Math.min(delayMs, remainingMs)),
      );
    }

    async function poll() {
      if (Date.now() >= expiresAtMs) {
        markExpired();
        return;
      }
      const result = await client.readCheckout(activeCheckoutId).catch(() => null);
      if (disposed || requestGeneration !== generation.current) return;
      if (!result?.ok) {
        recordFailure(result?.error);
        attempt += 1;
        schedule(Math.max(
          productCheckoutPollDelayMs(attempt),
          retryUntilRef.current - Date.now(),
        ));
        return;
      }
      retryUntilRef.current = 0;
      setRetryUntil(0);
      setFailure(null);
      setCheckout((current) => mergeProductCheckoutRefreshV1(current, result.value));
      if (result.value.status === "paid") {
        setPhase("fulfilling");
        return;
      }
      if (["cancelled", "expired", "failed"].includes(result.value.status)) return;
      attempt += 1;
      schedule(productCheckoutPollDelayMs(attempt));
    }
    schedule(productCheckoutPollDelayMs(0));
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [checkoutExpiresAt, checkoutId, checkoutStatus, client, phase, recordFailure]);

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
        const subscriptionId = result.value.entitlement.subscriptionId;
        if (subscriptionId === null) {
          recordFailure({ code: "protocolMismatch" });
          return;
        }
        publishProductShellReadyV1({
          entitlement: result.value.entitlement,
          engines: result.value.engines,
        });
        setPhase("ready");
        void prepare(requestGeneration, subscriptionId);
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
      clearProductEngineProvisioningV1();
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

export function productCheckoutPollDelayMs(attempt: number): number {
  return Math.min(15_000, 2_000 + Math.max(0, attempt) * 1_000);
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
