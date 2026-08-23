import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Check from "lucide-react/dist/esm/icons/check";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import type { AccountGatewayV1 } from "../contracts";
import { AccountGatewayProvider } from "../gateway/AccountGatewayProvider";
import { useAccountExperienceControllerV1 } from "../hooks/useAccountExperienceController";
import { useAccountExperienceCopyV1 } from "../hooks/useAccountExperienceCopy";
import {
  createAccountEngineOnboardingClientV1,
  managedEngineDisplayNameV1,
  type AccountEngineOnboardingClientV1,
  type CheckoutViewV1,
  type EnginePlansViewV1,
  type ManagedEngineIdV1,
  type ManagedEngineViewV1,
  type PaymentMethodViewV1,
  type SubscriptionPlanViewV1,
} from "../runtime/engineOnboardingClient";
import {
  publishAccountEngineReadyV1,
  subscribeAccountEngineSwitchV1,
  type AccountEngineSwitchIntentV1,
} from "../runtime/engineSwitchSignal";
import {
  clearManagedEngineEntitlementsV1,
  clearManagedEnginePreparedV1,
  MANAGED_PROVIDER_PROFILE_ID_V1,
  markManagedEnginePreparedV1,
  publishManagedEngineEntitlementsV1,
} from "../runtime/engineEntitlementStore";
import {
  readLastManagedEnginePreferenceV1,
  writeLastManagedEnginePreferenceV1,
} from "../runtime/enginePreference";
import {
  createManagedEngineToolchainClientV1,
  type ManagedEngineToolchainChoiceV1,
  type ManagedEngineToolchainClientV1,
  type ManagedEngineToolchainViewV1,
} from "../runtime/managedEngineToolchain";
import { AccountAuthPanel } from "./AccountExperience";
import {
  CheckoutQrCode,
  GateEmptyPlans,
  GateFailure,
  GateFailureBody,
  GateFrame,
  GateHeading,
  GateInlineFailure,
  GateLoading,
  GateStepBack,
  GateToolchainChoice,
  PaymentMethodList,
  PlanButton,
  interpolate,
  type GateAccountExit,
} from "./AccountAppGateViews";
import { EngineIcon } from "../../engine/components/EngineIcon";
import { activateEngineProviderProfileAndNotify } from "../../vendors/activateEngineProviderProfile";
import { activateAccountManagedEngine } from "../../../services/accountEngineActivation";
import { openAccountExternalUrl } from "../../../services/accountExternalLinks";

type GatePhase =
  | "catalog"
  | "engine"
  | "plans"
  | "paymentMethod"
  | "checkout"
  | "toolchainChoice"
  | "preparing"
  | "ready";

export type AccountAppGateProps = {
  readonly gateway: AccountGatewayV1;
  readonly engineClient?: AccountEngineOnboardingClientV1;
  readonly engineActivator?: (engineId: ManagedEngineIdV1) => Promise<void>;
  readonly engineProviderActivator?: (
    engine: "codex" | "claude",
    providerProfileId: string,
  ) => Promise<void>;
  readonly engineToolchain?: ManagedEngineToolchainClientV1;
  readonly readyContent?: ReactNode;
};

export function AccountAppGate({
  gateway,
  engineClient,
  engineActivator,
  engineProviderActivator,
  engineToolchain,
  readyContent,
}: AccountAppGateProps) {
  const client = useMemo(
    () => engineClient ?? createAccountEngineOnboardingClientV1(),
    [engineClient],
  );
  const toolchainClient = useMemo(
    () => engineToolchain ?? createManagedEngineToolchainClientV1(),
    [engineToolchain],
  );
  return (
    <AccountGatewayProvider gateway={gateway}>
      <AccountAppGateInner
        client={client}
        activateEngine={engineActivator ?? activateManagedEngine}
        activateProvider={engineProviderActivator ?? activateEngineProviderProfileAndNotify}
        toolchain={toolchainClient}
        readyContent={readyContent}
      />
    </AccountGatewayProvider>
  );
}

function AccountAppGateInner({
  client,
  activateEngine,
  activateProvider,
  toolchain,
  readyContent,
}: {
  readonly client: AccountEngineOnboardingClientV1;
  readonly activateEngine: (engineId: ManagedEngineIdV1) => Promise<void>;
  readonly activateProvider: (
    engine: "codex" | "claude",
    providerProfileId: string,
  ) => Promise<void>;
  readonly toolchain: ManagedEngineToolchainClientV1;
  readonly readyContent?: React.ReactNode;
}) {
  const controller = useAccountExperienceControllerV1({ loadAuthenticatedExtras: false });
  const copy = useAccountExperienceCopyV1();
  const accountBusy = controller.busy;
  const accountLogout = controller.logout;
  const [phase, setPhase] = useState<GatePhase>("catalog");
  const [engines, setEngines] = useState<readonly ManagedEngineViewV1[]>([]);
  const [selectedEngine, setSelectedEngine] = useState<ManagedEngineIdV1 | null>(null);
  const [plans, setPlans] = useState<EnginePlansViewV1 | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlanViewV1 | null>(null);
  const [checkout, setCheckout] = useState<CheckoutViewV1 | null>(null);
  const [toolchainChoice, setToolchainChoice] = useState<ManagedEngineToolchainViewV1 | null>(null);
  const [checkoutActionBusy, setCheckoutActionBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutFailure, setLogoutFailure] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [hasEnteredApp, setHasEnteredApp] = useState(false);
  const catalogGeneration = useRef(0);
  const flowGeneration = useRef(0);
  const checkoutActionBusyRef = useRef(false);
  const inAppFlow = useRef(false);
  const activeIntent = useRef<AccountEngineSwitchIntentV1 | null>(null);

  const commitReady = useCallback(async (
    engineId: ManagedEngineIdV1,
    generation = flowGeneration.current,
  ) => {
    try {
      await activateEngine(engineId);
      await activateProvider(
        engineId === "claude-code" ? "claude" : "codex",
        MANAGED_PROVIDER_PROFILE_ID_V1,
      );
    } catch {
      if (flowGeneration.current !== generation) return;
      setFailure("engineUnavailable");
      setSelectedEngine(engineId);
      setPhase("preparing");
      return;
    }
    if (flowGeneration.current !== generation) return;
    writeLastManagedEnginePreferenceV1(engineId);
    markManagedEnginePreparedV1(engineId);
    const completion = activeIntent.current;
    const shouldPublishCompletion = inAppFlow.current && completion !== null;
    inAppFlow.current = false;
    activeIntent.current = null;
    setHasEnteredApp(true);
    setPhase("ready");
    if (shouldPublishCompletion && completion) {
      publishAccountEngineReadyV1({
        engineId,
        openNewConversation: completion.openNewConversation,
      });
    }
  }, [activateEngine, activateProvider]);

  const finishPreparation = useCallback(async (
    engineId: ManagedEngineIdV1,
    generation = flowGeneration.current,
  ) => {
    setPhase("preparing");
    setFailure(null);
    clearManagedEnginePreparedV1(engineId);
    let result: Awaited<ReturnType<AccountEngineOnboardingClientV1["prepare"]>>;
    try {
      result = await client.prepare(engineId);
    } catch {
      if (flowGeneration.current !== generation) return;
      setFailure("serviceUnavailable");
      return;
    }
    if (flowGeneration.current !== generation) return;
    if (!result.ok || result.value.status !== "ready") {
      setFailure(result.ok ? "configurationRejected" : result.error.code);
      return;
    }
    await commitReady(engineId, generation);
  }, [client, commitReady]);

  const prepare = useCallback(async (
    engineId: ManagedEngineIdV1,
    generation = flowGeneration.current,
  ) => {
    setSelectedEngine(engineId);
    setToolchainChoice(null);
    setPhase("preparing");
    setFailure(null);
    let resolution: Awaited<ReturnType<ManagedEngineToolchainClientV1["inspect"]>>;
    try {
      resolution = await toolchain.inspect(engineId);
    } catch {
      if (flowGeneration.current !== generation) return;
      setFailure("engineBundleUnavailable");
      return;
    }
    if (flowGeneration.current !== generation) return;
    if (!resolution.ok) {
      setFailure(resolution.error.code);
      return;
    }
    if (resolution.value.status === "choiceRequired") {
      setToolchainChoice(resolution.value);
      setPhase("toolchainChoice");
      return;
    }
    await finishPreparation(engineId, generation);
  }, [finishPreparation, toolchain]);

  const chooseToolchain = useCallback(async (choice: ManagedEngineToolchainChoiceV1) => {
    if (!selectedEngine || !toolchainChoice) return;
    const generation = flowGeneration.current;
    setPhase("preparing");
    setFailure(null);
    let resolution: Awaited<ReturnType<ManagedEngineToolchainClientV1["choose"]>>;
    try {
      resolution = await toolchain.choose(selectedEngine, choice, toolchainChoice);
    } catch {
      if (flowGeneration.current !== generation) return;
      setFailure("engineBundleUnavailable");
      return;
    }
    if (flowGeneration.current !== generation) return;
    if (!resolution.ok || resolution.value.status !== "ready") {
      setFailure(resolution.ok ? "protocolMismatch" : resolution.error.code);
      return;
    }
    setToolchainChoice(null);
    await finishPreparation(selectedEngine, generation);
  }, [finishPreparation, selectedEngine, toolchain, toolchainChoice]);

  const openPlans = useCallback(async (
    engineId: ManagedEngineIdV1,
    generation = flowGeneration.current,
  ) => {
    setSelectedEngine(engineId);
    setPhase("catalog");
    setFailure(null);
    const result = await client.plans(engineId);
    if (flowGeneration.current !== generation) return;
    if (!result.ok) {
      setFailure(result.error.code);
      setPhase("plans");
      return;
    }
    setPlans(result.value);
    setPhase("plans");
  }, [client]);

  const chooseEngine = useCallback(async (
    engine: ManagedEngineViewV1,
    generation = flowGeneration.current,
  ) => {
    setSelectedEngine(engine.id);
    if (engine.entitlement.status !== "active") {
      await openPlans(engine.id, generation);
      return;
    }
    // A local vault/config hit is not enough to prove the credential still
    // belongs to the account's current subscription group. The Native prepare
    // operation is idempotent and re-confirms the server-owned binding before
    // AppShell is mounted.
    await prepare(engine.id, generation);
  }, [openPlans, prepare]);

  const returnToPlans = useCallback(async () => {
    if (selectedEngine === null || checkout === null || checkoutActionBusyRef.current) return;
    checkoutActionBusyRef.current = true;
    setCheckoutActionBusy(true);
    setFailure(null);
    try {
      const result = await client.abandonCheckout(checkout.checkoutId);
      if (!result.ok) {
        setFailure(result.error.code);
        return;
      }
      setCheckout(null);
      setToolchainChoice(null);
      setSelectedPlan(null);
      await openPlans(selectedEngine, flowGeneration.current);
    } catch {
      setFailure("serviceUnavailable");
    } finally {
      checkoutActionBusyRef.current = false;
      setCheckoutActionBusy(false);
    }
  }, [checkout, client, openPlans, selectedEngine]);

  const returnToApp = useCallback(async () => {
    if (!inAppFlow.current || checkoutActionBusyRef.current) return;
    checkoutActionBusyRef.current = true;
    setCheckoutActionBusy(true);
    setFailure(null);
    setToolchainChoice(null);
    try {
      if (checkout !== null) {
        const result = await client.abandonCheckout(checkout.checkoutId);
        if (!result.ok) {
          setFailure(result.error.code);
          return;
        }
      }
      flowGeneration.current += 1;
      catalogGeneration.current += 1;
      inAppFlow.current = false;
      activeIntent.current = null;
      setSelectedEngine(null);
      setPlans(null);
      setSelectedPlan(null);
      setCheckout(null);
      setPhase("ready");
    } catch {
      setFailure("serviceUnavailable");
    } finally {
      checkoutActionBusyRef.current = false;
      setCheckoutActionBusy(false);
    }
  }, [checkout, client]);

  const beginCheckout = useCallback(async (
    engineId: ManagedEngineIdV1,
    plan: SubscriptionPlanViewV1,
    method: PaymentMethodViewV1,
  ) => {
    if (checkoutActionBusyRef.current) return;
    checkoutActionBusyRef.current = true;
    setCheckoutActionBusy(true);
    try {
      await startCheckout(
        client,
        engineId,
        plan,
        method,
        setCheckout,
        setFailure,
        setPhase,
      );
    } catch {
      setFailure("serviceUnavailable");
    } finally {
      checkoutActionBusyRef.current = false;
      setCheckoutActionBusy(false);
    }
  }, [client]);

  const logoutFromGate = useCallback(async () => {
    if (checkoutActionBusy || logoutBusy || accountBusy) return;
    setLogoutBusy(true);
    setLogoutFailure(null);
    const signedOut = await accountLogout("thisDevice");
    if (signedOut) {
      catalogGeneration.current += 1;
      flowGeneration.current += 1;
      inAppFlow.current = false;
      activeIntent.current = null;
      setToolchainChoice(null);
      clearManagedEngineEntitlementsV1();
    }
    else setLogoutFailure("serviceUnavailable");
    setLogoutBusy(false);
  }, [accountBusy, accountLogout, checkoutActionBusy, logoutBusy]);

  const accountExit: GateAccountExit = {
    copy,
    busy: checkoutActionBusy || logoutBusy || accountBusy,
    failureCode: logoutFailure,
    onLogout: () => void logoutFromGate(),
  };

  const loadCatalog = useCallback(async () => {
    const generation = catalogGeneration.current + 1;
    const nextFlowGeneration = flowGeneration.current + 1;
    catalogGeneration.current = generation;
    flowGeneration.current = nextFlowGeneration;
    inAppFlow.current = false;
    activeIntent.current = null;
    clearManagedEngineEntitlementsV1();
    setToolchainChoice(null);
    setPhase("catalog");
    setFailure(null);
    const result = await client.catalog();
    if (catalogGeneration.current !== generation) return;
    if (!result.ok) {
      setFailure(result.error.code);
      return;
    }
    setEngines(result.value);
    publishManagedEngineEntitlementsV1(result.value);
    const pending = await client.resumeCheckout();
    if (catalogGeneration.current !== generation) return;
    if (!pending.ok) {
      setFailure(pending.error.code);
      return;
    }
    if (pending.value !== null) {
      setSelectedEngine(pending.value.engineId);
      setCheckout(pending.value.checkout);
      if (pending.value.checkout.status === "paid") {
        await prepare(pending.value.engineId, nextFlowGeneration);
      } else {
        setPhase("checkout");
        await openCheckoutAction(pending.value.checkout, setFailure);
      }
      return;
    }
    const remembered = readLastManagedEnginePreferenceV1();
    const rememberedEngine = result.value.find((engine) => engine.id === remembered);
    if (rememberedEngine?.entitlement.status === "active") {
      await chooseEngine(rememberedEngine, nextFlowGeneration);
      return;
    }
    setPhase("engine");
  }, [chooseEngine, client, prepare]);

  useEffect(() => {
    if (controller.bootstrap?.session.status !== "authenticated") {
      clearManagedEngineEntitlementsV1();
      return;
    }
    void loadCatalog();
  }, [controller.bootstrap?.session.status, loadCatalog]);

  const requestCatalogForActiveIntent = useCallback((
    nextIntent: AccountEngineSwitchIntentV1 | null = activeIntent.current,
  ) => {
    if (nextIntent === null) return;
    const generation = catalogGeneration.current + 1;
    const nextFlowGeneration = flowGeneration.current + 1;
    catalogGeneration.current = generation;
    flowGeneration.current = nextFlowGeneration;
    inAppFlow.current = true;
    activeIntent.current = nextIntent;
    if (nextIntent.targetEngineId !== null) {
      clearManagedEnginePreparedV1(nextIntent.targetEngineId);
    }
    setFailure(null);
    setSelectedEngine(nextIntent.targetEngineId);
    setPlans(null);
    setSelectedPlan(null);
    setCheckout(null);
    setToolchainChoice(null);
    setPhase("catalog");
    void client.catalog().then(async (result) => {
      if (
        catalogGeneration.current !== generation ||
        flowGeneration.current !== nextFlowGeneration
      ) return;
      if (!result.ok) {
        setFailure(result.error.code);
        return;
      }
      setEngines(result.value);
      publishManagedEngineEntitlementsV1(result.value);
      if (nextIntent.targetEngineId === null) {
        setPhase("engine");
        return;
      }
      const target = result.value.find((engine) => engine.id === nextIntent.targetEngineId);
      if (!target) {
        setFailure("protocolMismatch");
        setPhase("engine");
        return;
      }
      await chooseEngine(target, nextFlowGeneration);
    });
  }, [chooseEngine, client]);

  useEffect(() => subscribeAccountEngineSwitchV1((intent) => {
    if (controller.bootstrap?.session.status !== "authenticated" || !hasEnteredApp) return;
    requestCatalogForActiveIntent(intent);
  }), [controller.bootstrap?.session.status, hasEnteredApp, requestCatalogForActiveIntent]);

  const checkoutId = checkout?.checkoutId ?? null;
  const checkoutStatus = checkout?.status ?? null;
  const checkoutExpiresAt = checkout?.expiresAt ?? null;
  useEffect(() => {
    if (phase !== "checkout" || checkoutId === null || checkoutStatus === null ||
      checkoutExpiresAt === null || !["pending", "processing"].includes(checkoutStatus)) return;
    const generation = flowGeneration.current;
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
        await prepare(selectedEngine, generation);
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

  const keepReadyContentMounted =
    hasEnteredApp && controller.bootstrap?.session.status === "authenticated";
  const renderGate = (surface: ReactNode) => (
    <>
      {keepReadyContentMounted ? readyContent ?? null : null}
      {surface}
    </>
  );

  if (controller.loading) {
    return renderGate(<GateLoading label={copy.gateConnecting} />);
  }
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
    return renderGate(failure
      ? <GateFailure
          copy={copy}
          code={failure}
          onRetry={() => inAppFlow.current
            ? requestCatalogForActiveIntent()
            : void loadCatalog()}
          accountExit={accountExit}
          onReturnToApp={inAppFlow.current ? () => void returnToApp() : undefined}
          returnBusy={checkoutActionBusy}
        />
      : <GateLoading
          label={copy.gateConfirmingServices}
          accountExit={accountExit}
          onReturnToApp={inAppFlow.current ? () => void returnToApp() : undefined}
          returnBusy={checkoutActionBusy}
        />);
  }
  if (phase === "preparing" && selectedEngine) {
    return renderGate(
      <GateFrame
        accountExit={accountExit}
        onReturnToApp={failure && inAppFlow.current ? () => void returnToApp() : undefined}
        returnBusy={checkoutActionBusy}
      >
        <div className="account-gate-centered" role="status">
          {failure ? (
            <>
              <CircleAlert aria-hidden />
              <h1>{copy.gatePreparationFailed}</h1>
              <GateInlineFailure copy={copy} code={failure} />
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
  if (phase === "toolchainChoice" && selectedEngine && toolchainChoice) {
    return renderGate(
      <GateFrame
        accountExit={accountExit}
        onReturnToApp={inAppFlow.current ? () => void returnToApp() : undefined}
        returnBusy={checkoutActionBusy}
      >
        <GateToolchainChoice
          copy={copy}
          engineName={engineLabel(selectedEngine)}
          bundledVersion={toolchainChoice.bundledVersion}
          externalVersion={toolchainChoice.externalVersion ?? ""}
          onUseBundled={() => void chooseToolchain("bundled")}
          onKeepExternal={() => void chooseToolchain("external")}
        />
        {failure ? <GateInlineFailure copy={copy} code={failure} /> : null}
      </GateFrame>
    );
  }
  if (phase === "engine") {
    return renderGate(
      <GateFrame
        accountExit={accountExit}
        onReturnToApp={inAppFlow.current ? () => void returnToApp() : undefined}
        returnBusy={checkoutActionBusy}
      >
        <GateHeading
          copy={copy}
          title={inAppFlow.current ? copy.gateMyEngines : copy.gateChooseEngine}
          help={copy.gateEngineHelp}
        />
        <div className="account-gate-engine-grid">
          {engines.map((engine) => (
            <button key={engine.id} type="button" className="account-gate-engine" onClick={() => void chooseEngine(engine)}>
              <EngineIcon engine={engine.id === "codex" ? "codex" : "claude"} size={30} />
              <strong>{engine.displayName}</strong>
              <span className={engine.entitlement.status === "active" ? undefined : "account-gate-engine-subscribe"}>
                {engine.entitlement.status === "active" ? <Check size={14} aria-hidden /> : null}
                {engine.entitlement.status === "active" ? copy.gateSubscribed : copy.gateSubscribeToUse}
              </span>
            </button>
          ))}
        </div>
        {failure ? <GateInlineFailure copy={copy} code={failure} /> : null}
      </GateFrame>
    );
  }
  if ((phase === "plans" || phase === "paymentMethod") && selectedEngine) {
    return renderGate(
      <GateFrame accountExit={accountExit}>
        <GateStepBack copy={copy} onClick={() => {
          setFailure(null);
          if (phase === "paymentMethod") {
            setPhase("plans");
          } else if (inAppFlow.current) {
            void returnToApp();
          } else {
            setPhase("engine");
          }
        }} />
        <GateHeading copy={copy} title={interpolate(copy.gateChoosePlanTemplate, "engine", engineLabel(selectedEngine))} help={copy.gatePlanHelp} />
        {failure ? <GateFailureBody copy={copy} code={failure} onRetry={() => void openPlans(selectedEngine)} /> :
          plans?.plans.length ? (
            phase === "paymentMethod" && selectedPlan ? (
              <PaymentMethodList
                copy={copy}
                methods={plans.paymentMethods}
                onSelect={(method) => void beginCheckout(selectedEngine, selectedPlan, method)}
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
                        void beginCheckout(selectedEngine, plan, plans.paymentMethods[0]!);
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
    const checkoutTitle = terminal
      ? copy.gatePaymentFailed
      : checkout.action?.kind === "show_qr" && (selectedPlan?.name || checkout.planName)
        ? `Doge ${selectedPlan?.name ?? checkout.planName}`
        : copy.gateWaitingPayment;
    return renderGate(
      <GateFrame
        accountExit={accountExit}
        onReturnToApp={inAppFlow.current ? () => void returnToApp() : undefined}
        returnBusy={checkoutActionBusy}
      >
        <div className="account-gate-centered" role="status">
          {terminal ? <CircleAlert aria-hidden /> : <LoaderCircle className="account-gate-spin" aria-hidden />}
          <h1>{checkoutTitle}</h1>
          {checkout.action?.kind === "show_qr" && checkout.action.data ? (
            <CheckoutQrCode copy={copy} value={checkout.action.data} />
          ) : null}
          <div className="account-gate-checkout-actions">
            {!terminal && checkout.action?.kind === "open_url" && checkout.action.url ? (
              <button
                className="account-gate-secondary"
                type="button"
                disabled={checkoutActionBusy}
                onClick={() => void openCheckoutAction(checkout, setFailure)}
              >
                {copy.gateReopenPayment}
              </button>
            ) : null}
            <div className="account-gate-checkout-exits">
              <button
                className="account-gate-text-button"
                type="button"
                disabled={checkoutActionBusy}
                onClick={() => void returnToPlans()}
              >
                {copy.gateBackToPlans}
              </button>
              {inAppFlow.current ? (
                <button
                  className="account-gate-text-button"
                  type="button"
                  disabled={checkoutActionBusy}
                  onClick={() => void returnToApp()}
                >
                  {copy.gateReturnToApp}
                </button>
              ) : null}
            </div>
          </div>
          {failure ? <GateInlineFailure copy={copy} code={failure} /> : null}
        </div>
      </GateFrame>
    );
  }
  return renderGate(<GateFailure copy={copy} code="serviceUnavailable" onRetry={() => void loadCatalog()} accountExit={accountExit} />);
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

function engineLabel(engineId: ManagedEngineIdV1) {
  return managedEngineDisplayNameV1(engineId);
}

async function activateManagedEngine(engineId: ManagedEngineIdV1) {
  await activateAccountManagedEngine(engineId);
}
