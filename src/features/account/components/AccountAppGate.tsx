import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import Check from "lucide-react/dist/esm/icons/check";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import QRCode from "qrcode";
import dogeMascot from "../../../assets/brand/doge-mascot-avatar.png";
import type { AccountGatewayV1 } from "../contracts";
import { AccountGatewayProvider } from "../gateway/AccountGatewayProvider";
import { useAccountExperienceControllerV1 } from "../hooks/useAccountExperienceController";
import { useAccountExperienceCopyV1 } from "../hooks/useAccountExperienceCopy";
import type { AccountExperienceCopyV1 } from "../locale/accountExperienceCopy";
import {
  createAccountEngineOnboardingClientV1,
  type AccountEngineOnboardingClientV1,
  type CheckoutViewV1,
  type EnginePlansViewV1,
  type ManagedEngineIdV1,
  type ManagedEngineViewV1,
  type PaymentMethodViewV1,
  type SubscriptionPlanViewV1,
} from "../runtime/engineOnboardingClient";
import { subscribeAccountEngineSwitchV1 } from "../runtime/engineSwitchSignal";
import {
  readLastManagedEnginePreferenceV1,
  writeLastManagedEnginePreferenceV1,
} from "../runtime/enginePreference";
import { AccountAuthPanel } from "./AccountExperience";
import { AccountHelpTooltip } from "./AccountHelpTooltip";
import { EngineIcon } from "../../engine/components/EngineIcon";
import { activateAccountManagedEngine } from "../../../services/accountEngineActivation";
import { openAccountExternalUrl } from "../../../services/accountExternalLinks";
import "./account-app-gate.css";

type GatePhase =
  | "catalog"
  | "engine"
  | "plans"
  | "paymentMethod"
  | "checkout"
  | "preparing"
  | "ready";

export type AccountAppGateProps = {
  readonly gateway: AccountGatewayV1;
  readonly engineClient?: AccountEngineOnboardingClientV1;
  readonly engineActivator?: (engineId: ManagedEngineIdV1) => Promise<void>;
  readonly readyContent?: ReactNode;
};

export function AccountAppGate({
  gateway,
  engineClient,
  engineActivator,
  readyContent,
}: AccountAppGateProps) {
  const client = useMemo(
    () => engineClient ?? createAccountEngineOnboardingClientV1(),
    [engineClient],
  );
  return (
    <AccountGatewayProvider gateway={gateway}>
      <AccountAppGateInner
        client={client}
        activateEngine={engineActivator ?? activateManagedEngine}
        readyContent={readyContent}
      />
    </AccountGatewayProvider>
  );
}

function AccountAppGateInner({
  client,
  activateEngine,
  readyContent,
}: {
  readonly client: AccountEngineOnboardingClientV1;
  readonly activateEngine: (engineId: ManagedEngineIdV1) => Promise<void>;
  readonly readyContent?: React.ReactNode;
}) {
  const controller = useAccountExperienceControllerV1({ loadAuthenticatedExtras: false });
  const copy = useAccountExperienceCopyV1();
  const [phase, setPhase] = useState<GatePhase>("catalog");
  const [engines, setEngines] = useState<readonly ManagedEngineViewV1[]>([]);
  const [selectedEngine, setSelectedEngine] = useState<ManagedEngineIdV1 | null>(null);
  const [plans, setPlans] = useState<EnginePlansViewV1 | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlanViewV1 | null>(null);
  const [checkout, setCheckout] = useState<CheckoutViewV1 | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const catalogGeneration = useRef(0);

  const commitReady = useCallback(async (engineId: ManagedEngineIdV1) => {
    try {
      await activateEngine(engineId);
    } catch {
      setFailure("engineUnavailable");
      setSelectedEngine(engineId);
      setPhase("preparing");
      return;
    }
    writeLastManagedEnginePreferenceV1(engineId);
    setPhase("ready");
  }, [activateEngine]);

  const prepare = useCallback(async (engineId: ManagedEngineIdV1) => {
    setSelectedEngine(engineId);
    setPhase("preparing");
    setFailure(null);
    const result = await client.prepare(engineId);
    if (!result.ok || result.value.status !== "ready") {
      setFailure(result.ok ? "configurationRejected" : result.error.code);
      return;
    }
    await commitReady(engineId);
  }, [client, commitReady]);

  const openPlans = useCallback(async (engineId: ManagedEngineIdV1) => {
    setSelectedEngine(engineId);
    setPhase("catalog");
    setFailure(null);
    const result = await client.plans(engineId);
    if (!result.ok) {
      setFailure(result.error.code);
      setPhase("plans");
      return;
    }
    setPlans(result.value);
    setPhase("plans");
  }, [client]);

  const chooseEngine = useCallback(async (engine: ManagedEngineViewV1) => {
    setSelectedEngine(engine.id);
    if (engine.entitlement.status !== "active") {
      await openPlans(engine.id);
      return;
    }
    // A local vault/config hit is not enough to prove the credential still
    // belongs to the account's current subscription group. The Native prepare
    // operation is idempotent and re-confirms the server-owned binding before
    // AppShell is mounted.
    await prepare(engine.id);
  }, [openPlans, prepare]);

  const loadCatalog = useCallback(async () => {
    const generation = catalogGeneration.current + 1;
    catalogGeneration.current = generation;
    setPhase("catalog");
    setFailure(null);
    const result = await client.catalog();
    if (catalogGeneration.current !== generation) return;
    if (!result.ok) {
      setFailure(result.error.code);
      return;
    }
    setEngines(result.value);
    const pending = await client.resumeCheckout();
    if (!pending.ok) {
      setFailure(pending.error.code);
      return;
    }
    if (pending.value !== null) {
      setSelectedEngine(pending.value.engineId);
      setCheckout(pending.value.checkout);
      if (pending.value.checkout.status === "paid") {
        await prepare(pending.value.engineId);
      } else {
        setPhase("checkout");
        await openCheckoutAction(pending.value.checkout, setFailure);
      }
      return;
    }
    const remembered = readLastManagedEnginePreferenceV1();
    const rememberedEngine = result.value.find((engine) => engine.id === remembered);
    if (rememberedEngine?.entitlement.status === "active") {
      await chooseEngine(rememberedEngine);
      return;
    }
    setPhase("engine");
  }, [chooseEngine, client, prepare]);

  useEffect(() => {
    if (controller.bootstrap?.session.status !== "authenticated") return;
    void loadCatalog();
  }, [controller.bootstrap?.session.status, loadCatalog]);

  useEffect(() => subscribeAccountEngineSwitchV1(() => {
    setFailure(null);
    setSelectedEngine(null);
    setPlans(null);
    setCheckout(null);
    setPhase("engine");
  }), []);

  const checkoutId = checkout?.checkoutId ?? null;
  const checkoutStatus = checkout?.status ?? null;
  const checkoutExpiresAt = checkout?.expiresAt ?? null;
  useEffect(() => {
    if (phase !== "checkout" || checkoutId === null || checkoutStatus === null ||
      checkoutExpiresAt === null || !["pending", "processing"].includes(checkoutStatus)) return;
    const expiresAt = Date.parse(checkoutExpiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      setCheckout((current) => current ? { ...current, status: "expired" } : current);
      return;
    }
    let disposed = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = async () => {
      const result = await client.readCheckout(checkoutId);
      if (disposed) return;
      if (!result.ok) {
        setFailure(result.error.code);
        return;
      }
      setCheckout(result.value);
      if (result.value.status === "paid" && selectedEngine) {
        await prepare(selectedEngine);
        return;
      }
      if (["cancelled", "expired", "failed"].includes(result.value.status)) return;
      attempt += 1;
      const delay = Math.min(15_000, 2_000 + attempt * 1_000);
      timer = setTimeout(() => void read(), delay);
    };
    timer = setTimeout(() => void read(), 2_000);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [checkoutExpiresAt, checkoutId, checkoutStatus, client, phase, prepare, selectedEngine]);

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
      ? <GateFailure copy={copy} code={failure} onRetry={() => void loadCatalog()} />
      : <GateLoading label={copy.gateConfirmingServices} />;
  }
  if (phase === "preparing" && selectedEngine) {
    return (
      <GateFrame>
        <GateStepBack copy={copy} onClick={() => setPhase("engine")} />
        <div className="account-gate-centered" role="status">
          {failure ? (
            <>
              <CircleAlert aria-hidden />
              <h1>{copy.gatePreparationFailed}</h1>
              <button className="account-gate-primary" type="button" onClick={() => void prepare(selectedEngine)}>{copy.retry}</button>
            </>
          ) : (
            <>
              <LoaderCircle className="account-gate-spin" aria-hidden />
              <h1>{interpolate(copy.gatePreparingTemplate, "engine", engineLabel(selectedEngine))}</h1>
            </>
          )}
        </div>
      </GateFrame>
    );
  }
  if (phase === "engine") {
    return (
      <GateFrame>
        <GateHeading copy={copy} title={copy.gateChooseEngine} help={copy.gateEngineHelp} />
        <div className="account-gate-engine-grid">
          {engines.map((engine) => (
            <button key={engine.id} type="button" className="account-gate-engine" onClick={() => void chooseEngine(engine)}>
              <EngineIcon engine={engine.id === "codex" ? "codex" : "claude"} size={30} />
              <strong>{engine.displayName}</strong>
              {engine.entitlement.status === "active" ? <span><Check size={14} aria-hidden />{copy.gateAvailable}</span> : null}
            </button>
          ))}
        </div>
        {failure ? <GateInlineFailure copy={copy} code={failure} /> : null}
      </GateFrame>
    );
  }
  if ((phase === "plans" || phase === "paymentMethod") && selectedEngine) {
    return (
      <GateFrame>
        <GateStepBack copy={copy} onClick={() => { setFailure(null); setPhase("engine"); }} />
        <GateHeading copy={copy} title={interpolate(copy.gateChoosePlanTemplate, "engine", engineLabel(selectedEngine))} help={copy.gatePlanHelp} />
        {failure ? <GateFailureBody copy={copy} code={failure} onRetry={() => void openPlans(selectedEngine)} /> :
          plans?.plans.length ? (
            phase === "paymentMethod" && selectedPlan ? (
              <PaymentMethodList
                copy={copy}
                methods={plans.paymentMethods}
                onSelect={(method) => void startCheckout(client, selectedEngine, selectedPlan, method, setCheckout, setFailure, setPhase)}
              />
            ) : (
              <div className="account-gate-plan-list">
                {plans.plans.map((plan) => (
                  <PlanButton
                    copy={copy}
                    key={plan.id}
                    plan={plan}
                    onClick={() => {
                      setSelectedPlan(plan);
                      if (plans.paymentMethods.length === 1) {
                        void startCheckout(client, selectedEngine, plan, plans.paymentMethods[0]!, setCheckout, setFailure, setPhase);
                      } else {
                        setPhase("paymentMethod");
                      }
                    }}
                  />
                ))}
              </div>
            )
          ) : <GateEmptyPlans copy={copy} onRetry={() => void openPlans(selectedEngine)} />}
      </GateFrame>
    );
  }
  if (phase === "checkout" && checkout) {
    const terminal = ["cancelled", "expired", "failed"].includes(checkout.status);
    return (
      <GateFrame>
        <GateStepBack copy={copy} onClick={() => setPhase("plans")} />
        <div className="account-gate-centered" role="status">
          {terminal ? <CircleAlert aria-hidden /> : <LoaderCircle className="account-gate-spin" aria-hidden />}
          <h1>{terminal ? copy.gatePaymentFailed : copy.gateWaitingPayment}</h1>
          {checkout.action?.kind === "show_qr" && checkout.action.data ? (
            <CheckoutQrCode copy={copy} value={checkout.action.data} />
          ) : null}
          {!terminal && checkout.action?.kind === "open_url" && checkout.action.url ? (
            <button
              className="account-gate-secondary"
              type="button"
              onClick={() => void openCheckoutAction(checkout, setFailure)}
            >
              {copy.gateReopenPayment}
            </button>
          ) : null}
          {terminal ? (
            <button className="account-gate-primary" type="button" onClick={() => setPhase("plans")}>{copy.gateChooseAgain}</button>
          ) : null}
          {failure ? <GateInlineFailure copy={copy} code={failure} /> : null}
        </div>
      </GateFrame>
    );
  }
  return <GateFailure copy={copy} code="serviceUnavailable" onRetry={() => void loadCatalog()} />;
}

function CheckoutQrCode({ copy, value }: { readonly copy: AccountExperienceCopyV1; readonly value: string }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    setImageUrl(null);
    void QRCode.toDataURL(value, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
      color: { dark: "#111111", light: "#ffffff" },
    }).then((url) => {
      if (!disposed) setImageUrl(url);
    }).catch(() => {
      if (!disposed) setImageUrl("");
    });
    return () => { disposed = true; };
  }, [value]);
  if (imageUrl === null) return <LoaderCircle className="account-gate-spin" aria-label={copy.gateQrGenerating} />;
  if (imageUrl === "") return <GateInlineFailure copy={copy} code="checkoutQrUnavailable" />;
  return <img className="account-gate-qr" src={imageUrl} alt={copy.gateQrAlt} />;
}

async function startCheckout(
  client: AccountEngineOnboardingClientV1,
  engineId: ManagedEngineIdV1,
  plan: SubscriptionPlanViewV1,
  method: PaymentMethodViewV1,
  setCheckout: (checkout: CheckoutViewV1 | null) => void,
  setFailure: (code: string | null) => void,
  setPhase: (phase: GatePhase) => void,
) {
  setFailure(null);
  const result = await client.checkout(engineId, plan.id, method.id);
  if (!result.ok) {
    setFailure(result.error.code);
    return;
  }
  setCheckout(result.value);
  setPhase("checkout");
  await openCheckoutAction(result.value, setFailure);
}

async function openCheckoutAction(
  checkout: CheckoutViewV1,
  setFailure: (code: string | null) => void,
) {
  if (checkout.action?.kind === "open_url" && checkout.action.url) {
    try {
      await openAccountExternalUrl(checkout.action.url);
    } catch {
      setFailure("checkoutOpenFailed");
    }
  }
}

function GateFrame({ children }: { readonly children: ReactNode }) {
  return (
    <main className="account-app-gate">
      <div className="account-gate-window-drag" data-tauri-drag-region />
      <section className="account-gate-card">
        <img className="account-gate-logo" src={dogeMascot} alt="Doge" />
        {children}
      </section>
    </main>
  );
}

function GateHeading({ copy, title, help }: {
  readonly copy: AccountExperienceCopyV1;
  readonly title: string;
  readonly help: string;
}) {
  return (
    <header className="account-gate-heading">
      <h1>{title}</h1>
      <AccountHelpTooltip label={`${title}${copy.gateHelpSuffix}`} side="bottom">{help}</AccountHelpTooltip>
    </header>
  );
}

function GateLoading({ label }: { readonly label: string }) {
  return (
    <GateFrame>
      <div className="account-gate-centered" role="status">
        <LoaderCircle className="account-gate-spin" aria-hidden />
        <h1>{label}</h1>
      </div>
    </GateFrame>
  );
}

function GateFailure({ copy, code, onRetry }: {
  readonly copy: AccountExperienceCopyV1;
  readonly code: string;
  readonly onRetry: () => void;
}) {
  return <GateFrame><GateFailureBody copy={copy} code={code} onRetry={onRetry} /></GateFrame>;
}

function GateFailureBody({ copy, code, onRetry }: {
  readonly copy: AccountExperienceCopyV1;
  readonly code: string;
  readonly onRetry: () => void;
}) {
  return (
    <div className="account-gate-centered" role="alert">
      <CircleAlert aria-hidden />
      <h1>{failureMessage(code, copy)}</h1>
      <button className="account-gate-primary" type="button" onClick={onRetry}><RefreshCw size={16} aria-hidden />{copy.retry}</button>
    </div>
  );
}

function GateInlineFailure({ copy, code }: {
  readonly copy: AccountExperienceCopyV1;
  readonly code: string;
}) {
  return <div className="account-gate-inline-error" role="alert"><CircleAlert size={16} aria-hidden />{failureMessage(code, copy)}</div>;
}

function GateStepBack({ copy, onClick }: {
  readonly copy: AccountExperienceCopyV1;
  readonly onClick: () => void;
}) {
  return <button type="button" className="account-gate-back" onClick={onClick} aria-label={copy.gateBack}><ArrowLeft aria-hidden /></button>;
}

function GateEmptyPlans({ copy, onRetry }: {
  readonly copy: AccountExperienceCopyV1;
  readonly onRetry: () => void;
}) {
  return (
    <div className="account-gate-centered">
      <CircleAlert aria-hidden />
      <h2>{copy.gateNoPlans}</h2>
      <button type="button" className="account-gate-secondary" onClick={onRetry}>{copy.gateRefresh}</button>
    </div>
  );
}

function PlanButton({ copy, plan, onClick }: {
  readonly copy: AccountExperienceCopyV1;
  readonly plan: SubscriptionPlanViewV1;
  readonly onClick: () => void;
}) {
  const limit = plan.monthlyLimitUsd ?? plan.weeklyLimitUsd ?? plan.dailyLimitUsd;
  return (
    <button type="button" className="account-gate-plan" onClick={onClick}>
      <span className="account-gate-plan-main"><strong>{plan.name}</strong><small>{plan.features.slice(0, 2).join(" · ")}</small></span>
      <span className="account-gate-plan-price"><strong>{formatMoney(plan.price, plan.currency)}</strong><small>{validityLabel(plan, copy)}</small></span>
      {limit !== null ? <span className="account-gate-plan-limit">${limit}</span> : null}
    </button>
  );
}

function PaymentMethodList({ copy, methods, onSelect }: {
  readonly copy: AccountExperienceCopyV1;
  readonly methods: readonly PaymentMethodViewV1[];
  readonly onSelect: (method: PaymentMethodViewV1) => void;
}) {
  if (methods.length === 0) return <GateInlineFailure copy={copy} code="paymentUnavailable" />;
  return (
    <div className="account-gate-methods">
      {methods.map((method) => <button type="button" key={method.id} onClick={() => onSelect(method)}>{method.displayName}</button>)}
    </div>
  );
}

function engineLabel(engineId: ManagedEngineIdV1) {
  return engineId === "codex" ? "Codex" : "Claude Code";
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`.trim();
  }
}

function validityLabel(plan: SubscriptionPlanViewV1, copy: AccountExperienceCopyV1) {
  if (plan.validityDays === 30) return copy.gateMonth;
  return interpolate(copy.gateDaysTemplate, "days", String(plan.validityDays));
}

function failureMessage(code: string, copy: AccountExperienceCopyV1) {
  if (code === "subscriptionRequired") return copy.gateSubscriptionRequired;
  if (code === "planUnavailable") return copy.gatePlanUnavailable;
  if (code === "vaultUnavailable" || code === "vaultLocked") return copy.gateVaultUnavailable;
  if (code === "credentialsRejected") return copy.gateCredentialsRejected;
  if (code === "rateLimited") return copy.gateRateLimited;
  if (code === "checkoutOpenFailed") return copy.gateCheckoutOpenFailed;
  if (code === "paymentUnavailable") return copy.gatePaymentUnavailable;
  if (code === "configurationRejected" || code === "concurrentEdit") return copy.gateConfigurationRejected;
  if (code === "engineUnavailable") return copy.gateEngineUnavailable;
  return copy.gateServiceUnavailable;
}

function interpolate(template: string, key: string, value: string): string {
  return template.replace(`{${key}}`, value);
}

async function activateManagedEngine(engineId: ManagedEngineIdV1) {
  await activateAccountManagedEngine(engineId);
}
