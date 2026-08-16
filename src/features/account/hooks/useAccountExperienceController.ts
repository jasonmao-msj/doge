import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  AccountBootstrapViewV1,
  AccountCenterViewV1,
  AccountGatewayV1,
  ApiKeyCandidateHandleV1,
  AuthNextViewV1,
  ConfigurationTaskViewV1,
  ExternalIntentHandleV1,
  GatewayFailureV1,
  OAuthAttemptHandleV1,
  QuotaUsageViewV1,
} from "../contracts";
import { useAccountGatewayV1 } from "../gateway/AccountGatewayProvider";
import {
  createAccountCallContextV1,
  transientSecretInputV1,
} from "../utils/accountFormValues";
import {
  consumeAccountConfigurationReopenV1,
  setAccountConfigurationBubbleVisibleV1,
  useAccountConfigurationReopenRequestedV1,
} from "../runtime/configurationBubbleStore";
import {
  isTerminalOAuthFailureV1,
  OAuthWakeupCoordinatorV1,
} from "../runtime/oauthWakeupCoordinator";
import { PasswordResetWakeupCoordinatorV1 } from "../runtime/passwordResetWakeupCoordinator";
import {
  isTerminalPasswordResetFailureV1,
  oauthAttemptToAuthNextV1,
} from "../runtime/authFlowTransitions";
import {
  INITIAL_CONFIGURATION_SURFACE_V1,
  type AccountAuthSurfaceV1,
  type AccountCenterTabV1,
  type AccountConfigurationSurfaceV1,
} from "./accountExperienceControllerTypes";

export type {
  AccountAuthSurfaceV1,
  AccountCenterTabV1,
  AccountConfigurationSurfaceV1,
} from "./accountExperienceControllerTypes";

export type AccountExperienceControllerOptionsV1 = {
  readonly loadAuthenticatedExtras?: boolean;
};

export function useAccountExperienceControllerV1(
  options: AccountExperienceControllerOptionsV1 = {},
) {
  const gateway = useAccountGatewayV1();
  const loadExtras = options.loadAuthenticatedExtras !== false;
  const [bootstrap, setBootstrap] = useState<AccountBootstrapViewV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [bootstrapRetrying, setBootstrapRetrying] = useState(false);
  const [bootstrapRetryCompleted, setBootstrapRetryCompleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<GatewayFailureV1 | null>(null);
  const [authSurface, setAuthSurface] = useState<AccountAuthSurfaceV1>("login");
  const [authNext, setAuthNext] = useState<AuthNextViewV1 | null>(null);
  const [profile, setProfile] = useState<AccountCenterViewV1 | null>(null);
  const [centerTab, setCenterTab] = useState<AccountCenterTabV1>("overview");
  const [usage, setUsage] = useState<QuotaUsageViewV1 | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [securityNotice, setSecurityNotice] = useState<"profileUpdated" | "passwordChanged" | null>(null);
  const [configuration, setConfiguration] = useState<AccountConfigurationSurfaceV1>(
    INITIAL_CONFIGURATION_SURFACE_V1,
  );
  const generationRef = useRef(0);
  const bootstrapRetryInFlightRef = useRef(false);
  const oauthWakeupsRef = useRef(new OAuthWakeupCoordinatorV1());
  const readOAuthAttemptRef = useRef<(attempt: OAuthAttemptHandleV1) => void>(() => undefined);
  const passwordResetWakeupsRef = useRef(new PasswordResetWakeupCoordinatorV1());
  const inspectPasswordResetRef = useRef<(intent: ExternalIntentHandleV1) => void>(() => undefined);
  const [retryableResetIntent, setRetryableResetIntent] = useState<ExternalIntentHandleV1 | null>(null);
  const reopenRequested = useAccountConfigurationReopenRequestedV1();

  const readOffer = useCallback(async () => {
    const result = await gateway.configuration.readOffer({});
    if (!result.ok || result.value.status !== "available") return;
    setConfiguration((current) => ({
      ...current,
      offer: result.value,
      open: true,
      bubbleVisible: true,
    }));
    setAccountConfigurationBubbleVisibleV1(false);
  }, [gateway]);

  const readManagedKeyStatus = useCallback(async () => {
    const result = await gateway.managedKey.readStatus(
      { recipeId: "doge.account.codex-token-service", recipeVersion: 1 },
      {},
    );
    if (result.ok) {
      setConfiguration((current) => ({
        ...current,
        managedKeyReady: result.value.status === "ready",
      }));
      return result.value.status === "ready";
    }
    return false;
  }, [gateway]);

  const loadApiKeyCandidates = useCallback(async () => {
    setConfiguration((current) => ({ ...current, loadingKeys: true }));
    const result = await gateway.managedKey.listCandidates(
      { recipeId: "doge.account.codex-token-service", recipeVersion: 1 },
      {},
    );
    setConfiguration((current) => ({
      ...current,
      loadingKeys: false,
      keyCandidates: result.ok ? result.value : current.keyCandidates,
      selectedKey: result.ok && current.selectedKey &&
        result.value.keys.some((candidate) => candidate.key === current.selectedKey &&
          candidate.status === "active" && candidate.availability === "selectable")
        ? current.selectedKey
        : null,
    }));
    if (!result.ok) setFailure(result.error);
  }, [gateway]);

  const reconcileConfigurationTask = useCallback((task: ConfigurationTaskViewV1) => {
    if ("result" in task) {
      setConfiguration((current) => ({ ...current, result: task }));
      if (task.acknowledged) setAccountConfigurationBubbleVisibleV1(true);
      return;
    }
    if ("plan" in task) {
      setConfiguration((current) => ({ ...current, plan: task }));
      return;
    }
    if (task.status === "available") {
      setConfiguration((current) => ({ ...current, offer: task }));
      return;
    }
    if (task.status === "none") {
      setConfiguration(INITIAL_CONFIGURATION_SURFACE_V1);
      return;
    }
    setConfiguration((current) => ({ ...current, offer: null }));
  }, []);

  const readCurrentConfigurationTask = useCallback(async () => {
    const result = await gateway.configuration.readCurrentTask({});
    if (result.ok) reconcileConfigurationTask(result.value);
  }, [gateway, reconcileConfigurationTask]);

  const reopenCurrentConfigurationTask = useCallback(async () => {
    const result = await gateway.configuration.readCurrentTask({});
    if (!result.ok) {
      setFailure(result.error);
      return;
    }
    reconcileConfigurationTask(result.value);
    if (!("status" in result.value && result.value.status === "none")) {
      setConfiguration((current) => ({ ...current, open: true, bubbleVisible: true }));
      setAccountConfigurationBubbleVisibleV1(false);
    }
  }, [gateway, reconcileConfigurationTask]);

  const loadAuthenticatedExtras = useCallback(async () => {
    if (!loadExtras) return;
    const profileResult = await gateway.profile.read({});
    if (profileResult.ok) setProfile(profileResult.value);
    await readManagedKeyStatus();
    await loadApiKeyCandidates();
    const taskResult = await gateway.configuration.readCurrentTask({});
    if (taskResult.ok) {
      reconcileConfigurationTask(taskResult.value);
      if ("plan" in taskResult.value ||
        ("result" in taskResult.value && !taskResult.value.acknowledged)
      ) {
        setConfiguration((current) => ({ ...current, open: true }));
        return;
      }
      if ("result" in taskResult.value) return;
    }
    await readOffer();
  }, [gateway, loadApiKeyCandidates, loadExtras, readManagedKeyStatus, readOffer, reconcileConfigurationTask]);

  const bootstrapAccount = useCallback(async (
    options: { readonly indicateLoading?: boolean } = {},
  ) => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const indicateLoading = options.indicateLoading !== false;
    if (indicateLoading) setLoading(true);
    setFailure(null);
    const result = await gateway.bootstrap({});
    if (generationRef.current !== generation) return;
    if (indicateLoading) setLoading(false);
    if (!result.ok) {
      setFailure(result.error);
      return;
    }
    setBootstrap(result.value);
    if (result.value.session.status === "authenticated") {
      await loadAuthenticatedExtras();
    }
  }, [gateway, loadAuthenticatedExtras]);

  const retryBootstrapAccount = useCallback(async () => {
    if (bootstrapRetryInFlightRef.current) return;
    bootstrapRetryInFlightRef.current = true;
    setBootstrapRetrying(true);
    setBootstrapRetryCompleted(false);
    try {
      await bootstrapAccount({ indicateLoading: false });
    } finally {
      bootstrapRetryInFlightRef.current = false;
      setBootstrapRetrying(false);
      setBootstrapRetryCompleted(true);
    }
  }, [bootstrapAccount]);

  useEffect(() => {
    if (!reopenRequested) return;
    consumeAccountConfigurationReopenV1();
    void reopenCurrentConfigurationTask();
  }, [reopenCurrentConfigurationTask, reopenRequested]);

  const settleAuthNext = useCallback(async (next: AuthNextViewV1) => {
    setAuthNext(next);
    switch (next.next) {
      case "verification":
        setAuthSurface("verification");
        break;
      case "mfa":
        setAuthSurface("mfa");
        break;
      case "oauthWaiting":
        setAuthSurface("oauthWaiting");
        if (oauthWakeupsRef.current.activate(next.attempt)) {
          readOAuthAttemptRef.current(next.attempt);
        }
        break;
      case "resetRequested":
        setAuthSurface("resetRequested");
        break;
      case "passwordResetReady":
        setAuthSurface("resetPassword");
        break;
      case "passwordResetCompleted":
        passwordResetWakeupsRef.current.clear();
        setAuthNext(null);
        setAuthSurface("login");
        setSecurityNotice("passwordChanged");
        break;
      case "authenticated":
        setBootstrap((current) => current ? { ...current, session: next.session } : current);
        setFailure(null);
        await loadAuthenticatedExtras();
        break;
      case "oauthAccountCompletion":
        setAuthSurface("oauthAccountCompletion");
        break;
    }
  }, [loadAuthenticatedExtras]);

  const runAuth = useCallback(async (
    action: () => Promise<{ readonly ok: true; readonly value: AuthNextViewV1 } | { readonly ok: false; readonly error: GatewayFailureV1 }>,
  ) => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await action();
      if (result.ok) await settleAuthNext(result.value);
      else setFailure(result.error);
    } finally {
      setBusy(false);
    }
  }, [settleAuthNext]);

  const login = useCallback((email: string, password: string) => runAuth(() =>
    gateway.auth.login(
      { email, password: transientSecretInputV1(password) },
      createAccountCallContextV1(),
    )), [gateway, runAuth]);

  const register = useCallback((
    email: string,
    password: string,
    options: {
      readonly invitationCode?: string;
      readonly promoCode?: string;
      readonly agreementAccepted: boolean;
    },
  ) => runAuth(() =>
    gateway.auth.beginRegistration(
      {
        email,
        password: transientSecretInputV1(password),
        ...(options.invitationCode
          ? { invitationCode: transientSecretInputV1(options.invitationCode) }
          : {}),
        ...(options.promoCode ? { promoCode: options.promoCode } : {}),
        agreementAccepted: options.agreementAccepted,
      },
      createAccountCallContextV1(),
    )), [gateway, runAuth]);

  const resendRegistrationCode = useCallback(() => {
    if (!authNext || authNext.next !== "verification") return;
    void runAuth(() => gateway.auth.resendRegistrationCode(
      { attempt: authNext.attempt },
      createAccountCallContextV1(),
    ));
  }, [authNext, gateway, runAuth]);

  const requestPasswordReset = useCallback(async (email: string) => {
    passwordResetWakeupsRef.current.startRequest();
    setBusy(true);
    setFailure(null);
    const result = await gateway.auth.requestPasswordReset(
      { email },
      createAccountCallContextV1(),
    );
    if (!result.ok) {
      passwordResetWakeupsRef.current.finishRequest(false);
      setFailure(result.error);
      setBusy(false);
      return;
    }
    await settleAuthNext(result.value);
    const queuedIntent = passwordResetWakeupsRef.current.finishRequest(
      result.value.next === "resetRequested",
    );
    setBusy(false);
    if (queuedIntent) {
      setRetryableResetIntent(queuedIntent);
      inspectPasswordResetRef.current(queuedIntent);
    }
  }, [gateway, settleAuthNext]);

  const inspectPasswordReset = useCallback(async (intent: ExternalIntentHandleV1) => {
    if (!passwordResetWakeupsRef.current.beginRead(intent)) return;
    setRetryableResetIntent(intent);
    setBusy(true);
    let terminal = false;
    try {
      const result = await gateway.auth.inspectExternalIntent({ intent }, {});
      if (!result.ok) {
        terminal = isTerminalPasswordResetFailureV1(result.error.code);
        if (terminal) {
          setRetryableResetIntent(null);
          setAuthNext(null);
          setAuthSurface("recover");
        }
        setFailure(result.error);
        return;
      }
      terminal = result.value.next !== "passwordResetReady";
      if (result.value.next === "passwordResetReady") {
        setRetryableResetIntent(null);
      }
      await settleAuthNext(result.value);
    } finally {
      passwordResetWakeupsRef.current.finishRead(intent, terminal);
      setBusy(false);
    }
  }, [gateway, settleAuthNext]);

  const resetPassword = useCallback(async (newPassword: string) => {
    if (!authNext || authNext.next !== "passwordResetReady") return;
    setBusy(true);
    setFailure(null);
    const result = await gateway.auth.resetPassword(
      {
        intent: authNext.intent,
        newPassword: transientSecretInputV1(newPassword),
      },
      createAccountCallContextV1(),
    );
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error);
      return;
    }
    await settleAuthNext(result.value);
  }, [authNext, gateway, settleAuthNext]);

  const cancelPasswordReset = useCallback(() => {
    passwordResetWakeupsRef.current.clear();
    setRetryableResetIntent(null);
    setAuthNext(null);
    setAuthSurface("login");
  }, []);

  const submitCode = useCallback((code: string) => {
    if (!authNext || (authNext.next !== "verification" && authNext.next !== "mfa")) return;
    const attempt = authNext.attempt;
    void runAuth(() => authNext.next === "verification"
      ? gateway.auth.submitRegistrationCode(
        { attempt, code: transientSecretInputV1(code) },
        createAccountCallContextV1(),
      )
      : gateway.auth.verifyMfa(
        { attempt, code: transientSecretInputV1(code) },
        createAccountCallContextV1(),
      ));
  }, [authNext, gateway, runAuth]);

  const startOAuth = useCallback(() => runAuth(() => gateway.auth.startOAuth(
    { provider: "auth.oauth.github" },
    createAccountCallContextV1(),
  )), [gateway, runAuth]);

  const completeOAuthAccount = useCallback((input: {
    readonly email?: string;
    readonly invitationCode?: string;
    readonly mfaCode?: string;
    readonly bindConfirmed?: boolean;
  }) => {
    if (!authNext || authNext.next !== "oauthAccountCompletion") return;
    void runAuth(() => gateway.auth.completeOAuthAccount(
      {
        attempt: authNext.attempt,
        ...(input.email ? { email: input.email } : {}),
        ...(input.invitationCode
          ? { invitationCode: transientSecretInputV1(input.invitationCode) }
          : {}),
        ...(input.mfaCode ? { mfaCode: transientSecretInputV1(input.mfaCode) } : {}),
        ...(input.bindConfirmed === undefined
          ? {}
          : { bindConfirmed: input.bindConfirmed }),
      },
      createAccountCallContextV1(),
    ));
  }, [authNext, gateway, runAuth]);

  const readOAuthAttempt = useCallback(async (attempt: OAuthAttemptHandleV1) => {
    if (!oauthWakeupsRef.current.beginRead(attempt)) return;
    setBusy(true);
    let terminal = false;
    try {
      const result = await gateway.auth.readOAuthAttempt({ attempt }, {});
      if (!result.ok) {
        terminal = isTerminalOAuthFailureV1(result.error.code);
        if (terminal) {
          setAuthNext(null);
          setAuthSurface("login");
        }
        setFailure(result.error);
        return;
      }
      const next = oauthAttemptToAuthNextV1(result.value);
      if (next) await settleAuthNext(next);
      terminal = result.value.status !== "waiting";
      if (result.value.status === "denied") {
        setAuthNext(null);
        setAuthSurface("login");
        setFailure({
          code: "oauthDenied",
          stage: "oauth",
          recovery: { action: "retry", afterMs: null },
        });
      }
      if (result.value.status === "expired") {
        setAuthNext(null);
        setAuthSurface("login");
        setFailure({
          code: "externalIntentExpired",
          stage: "oauth",
          recovery: { action: "loginAgain" },
        });
      }
      if (result.value.status === "cancelled") {
        setAuthNext(null);
        setAuthSurface("login");
      }
    } finally {
      oauthWakeupsRef.current.finishRead(attempt, terminal);
      setBusy(false);
    }
  }, [gateway, settleAuthNext]);

  useEffect(() => {
    readOAuthAttemptRef.current = (attempt) => {
      void readOAuthAttempt(attempt);
    };
    return () => {
      readOAuthAttemptRef.current = () => undefined;
    };
  }, [readOAuthAttempt]);

  useEffect(() => {
    inspectPasswordResetRef.current = (intent) => {
      void inspectPasswordReset(intent);
    };
    return () => {
      inspectPasswordResetRef.current = () => undefined;
    };
  }, [inspectPasswordReset]);

  useEffect(() => {
    void bootstrapAccount();
    return gateway.subscribe((event) => {
      if (event.kind === "sessionChanged" || event.kind === "capabilitiesChanged") {
        void bootstrapAccount();
      }
      if (event.kind === "configurationTaskChanged") {
        void readCurrentConfigurationTask();
      }
      if (event.kind === "oauthAttemptChanged") {
        if (oauthWakeupsRef.current.observe(event.attempt)) {
          readOAuthAttemptRef.current(event.attempt);
        }
      }
      if (event.kind === "externalIntentReady" && event.purpose === "passwordReset") {
        if (passwordResetWakeupsRef.current.observe(event.intent)) {
          setRetryableResetIntent(event.intent);
          inspectPasswordResetRef.current(event.intent);
        }
      }
      // usageInvalidated intentionally does not fetch. It is pull-only.
    });
  }, [bootstrapAccount, gateway, readCurrentConfigurationTask]);

  const checkOAuth = useCallback(() => {
    if (!authNext || authNext.next !== "oauthWaiting") return;
    void readOAuthAttempt(authNext.attempt);
  }, [authNext, readOAuthAttempt]);

  const cancelOAuth = useCallback(async () => {
    if (!authNext || (authNext.next !== "oauthWaiting" &&
      authNext.next !== "oauthAccountCompletion")) return;
    if (authNext.next === "oauthWaiting") {
      await gateway.auth.cancelOAuth(
        { attempt: authNext.attempt },
        createAccountCallContextV1(),
      );
      oauthWakeupsRef.current.clear(authNext.attempt);
    }
    setAuthNext(null);
    setAuthSurface("login");
  }, [authNext, gateway]);

  const logout = useCallback(async (scope: "thisDevice" | "allSessions") => {
    setBusy(true);
    const result = await gateway.auth.logout({ scope }, createAccountCallContextV1());
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error);
      return;
    }
    generationRef.current += 1;
    setBootstrap((current) => current ? { ...current, session: { status: "signedOut" } } : current);
    setProfile(null);
    setUsage(null);
    setConfiguration(INITIAL_CONFIGURATION_SURFACE_V1);
    setAuthSurface("login");
  }, [gateway]);

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    const result = await gateway.usage.read({});
    setUsageLoading(false);
    if (result.ok) setUsage(result.value);
    else setFailure(result.error);
  }, [gateway]);

  const openUsage = useCallback(() => {
    setCenterTab("usage");
    if (usage === null && !usageLoading) void loadUsage();
  }, [loadUsage, usage, usageLoading]);

  const updateProfile = useCallback(async (displayName: string) => {
    setBusy(true);
    setFailure(null);
    setSecurityNotice(null);
    const result = await gateway.profile.updateProfile(
      { displayName },
      createAccountCallContextV1(),
    );
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error);
      return;
    }
    setProfile(result.value);
    setBootstrap((current) => current && current.session.status === "authenticated"
      ? {
          ...current,
          session: {
            ...current.session,
            profileLabel: result.value.profile.displayName,
            primaryEmailLabel: result.value.profile.primaryEmailLabel,
          },
        }
      : current);
    setSecurityNotice("profileUpdated");
  }, [gateway]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    setBusy(true);
    setFailure(null);
    setSecurityNotice(null);
    const result = await gateway.profile.changePassword(
      {
        currentPassword: transientSecretInputV1(currentPassword),
        newPassword: transientSecretInputV1(newPassword),
      },
      createAccountCallContextV1(),
    );
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error);
      return;
    }
    generationRef.current += 1;
    setBootstrap((current) => current ? { ...current, session: { status: "signedOut" } } : current);
    setProfile(null);
    setUsage(null);
    setConfiguration(INITIAL_CONFIGURATION_SURFACE_V1);
    setAuthSurface("login");
    setSecurityNotice("passwordChanged");
  }, [gateway]);

  const createConfigurationPlan = useCallback(async () => {
    if (!configuration.managedKeyReady) return;
    await createConfigurationPlanViewV1(gateway, setBusy, setFailure, setConfiguration);
  }, [configuration.managedKeyReady, gateway]);

  const selectConfigurationKey = useCallback(async (key: ApiKeyCandidateHandleV1) => {
    setConfiguration((current) => ({
      ...current,
      selectedKey: key,
      selectingKey: true,
    }));
    setFailure(null);
    const selected = await gateway.managedKey.selectExisting(
      {
        recipeId: "doge.account.codex-token-service",
        recipeVersion: 1,
        key,
        consent: "useSelectedApiKey",
      },
      createAccountCallContextV1(),
    );
    const ready = selected.ok && selected.value.status === "ready";
    setConfiguration((current) => ({
      ...current,
      selectingKey: false,
      managedKeyReady: ready,
    }));
    if (!selected.ok) {
      setFailure(selected.error);
      return;
    }
    if (ready) {
      await createConfigurationPlanViewV1(gateway, setBusy, setFailure, setConfiguration);
    }
  }, [gateway]);

  const toggleFileDetail = useCallback(async (fileHandle: string) => {
    const currentPlan = configuration.plan;
    const file = currentPlan?.files.find((candidate) => candidate.file === fileHandle);
    if (!currentPlan || !file) return;
    if (configuration.expandedFile === fileHandle) {
      setConfiguration((current) => ({ ...current, expandedFile: null, fileDetail: null }));
      return;
    }
    setConfiguration((current) => ({
      ...current,
      expandedFile: fileHandle,
      fileDetail: null,
      loadingDetail: true,
    }));
    const result = await gateway.configuration.readFileDetail(
      { plan: currentPlan.plan, file: file.file },
      {},
    );
    setConfiguration((current) => ({
      ...current,
      loadingDetail: false,
      fileDetail: result.ok ? result.value : null,
    }));
    if (!result.ok) setFailure(result.error);
  }, [configuration.expandedFile, configuration.plan, gateway]);

  const applyConfiguration = useCallback(async () => {
    if (!configuration.plan) return;
    setConfiguration((current) => ({ ...current, applying: true }));
    const result = await gateway.configuration.apply(
      { plan: configuration.plan.plan, consent: "applyExactPlan" },
      createAccountCallContextV1(),
    );
    if (!result.ok) {
      setFailure(result.error);
      setConfiguration((current) => ({ ...current, applying: false }));
      return;
    }
    setConfiguration((current) => ({
      ...current,
      applying: false,
      result: result.value,
      open: true,
      bubbleVisible: true,
    }));
  }, [configuration.plan, gateway]);

  const closeConfiguration = useCallback(() => {
    setConfiguration((current) => ({ ...current, open: false, bubbleVisible: true }));
    setAccountConfigurationBubbleVisibleV1(true);
  }, []);

  const acknowledgeConfiguration = useCallback(async () => {
    const resultHandle = configuration.result?.result;
    if (resultHandle) {
      await gateway.configuration.acknowledgeResult(
        { result: resultHandle },
        createAccountCallContextV1(),
      );
    }
    setConfiguration((current) => ({ ...current, open: false, bubbleVisible: true }));
    setAccountConfigurationBubbleVisibleV1(true);
  }, [configuration.result, gateway]);

  const hardDismissConfiguration = useCallback(async () => {
    if (configuration.applying) return;
    await gateway.configuration.hardDismiss(
      { recipeId: "doge.account.codex-token-service", recipeVersion: 1 },
      createAccountCallContextV1(),
    );
    setConfiguration(INITIAL_CONFIGURATION_SURFACE_V1);
    setAccountConfigurationBubbleVisibleV1(false);
  }, [configuration.applying, gateway]);

  const changeManagedKey = useCallback(async () => {
    setConfiguration((current) => ({
      ...current,
      open: true,
      bubbleVisible: true,
      plan: null,
      result: null,
      expandedFile: null,
      fileDetail: null,
      selectedKey: null,
    }));
    setAccountConfigurationBubbleVisibleV1(false);
    await loadApiKeyCandidates();
  }, [loadApiKeyCandidates]);

  const revokeManagedKey = useCallback(async () => {
    setBusy(true);
    const result = await gateway.managedKey.revoke(
      {
        recipeId: "doge.account.codex-token-service",
        recipeVersion: 1,
        consent: "removeLocalKey",
      },
      createAccountCallContextV1(),
    );
    setBusy(false);
    setConfiguration((current) => ({ ...current, managedKeyReady: false }));
    if (!result.ok) setFailure(result.error);
  }, [gateway]);

  return {
    bootstrap,
    loading,
    bootstrapRetrying,
    bootstrapRetryCompleted,
    busy,
    failure,
    authSurface,
    authNext,
    profile,
    centerTab,
    usage,
    usageLoading,
    securityNotice,
    configuration,
    setAuthSurface,
    setCenterTab,
    retry: retryBootstrapAccount,
    login,
    register,
    requestPasswordReset,
    retryPasswordReset: retryableResetIntent
      ? () => void inspectPasswordReset(retryableResetIntent)
      : null,
    resetPassword,
    cancelPasswordReset,
    resendRegistrationCode,
    submitCode,
    startOAuth,
    completeOAuthAccount,
    checkOAuth,
    cancelOAuth,
    logout,
    openUsage,
    loadUsage,
    updateProfile,
    changePassword,
    createConfigurationPlan,
    loadApiKeyCandidates,
    selectConfigurationKey,
    chooseConfigurationKey: (key: ApiKeyCandidateHandleV1) => {
      setConfiguration((current) => ({ ...current, selectedKey: key }));
    },
    toggleFileDetail,
    applyConfiguration,
    closeConfiguration,
    acknowledgeConfiguration,
    reopenConfiguration: () => {
      setAccountConfigurationBubbleVisibleV1(false);
      setConfiguration((current) => ({ ...current, open: true }));
    },
    hardDismissConfiguration,
    changeManagedKey,
    revokeManagedKey,
  };
}

async function createConfigurationPlanViewV1(
  gateway: AccountGatewayV1,
  setBusy: (value: boolean) => void,
  setFailure: (value: GatewayFailureV1 | null) => void,
  setConfiguration: Dispatch<SetStateAction<AccountConfigurationSurfaceV1>>,
) {
  setBusy(true);
  const result = await gateway.configuration.createPlan(
    {
      recipeId: "doge.account.codex-token-service",
      recipeVersion: 1,
      intent: "configure",
    },
    createAccountCallContextV1(),
  );
  setBusy(false);
  if (!result.ok) {
    setFailure(result.error);
    return;
  }
  setConfiguration((current) => ({ ...current, plan: result.value, open: true }));
}
