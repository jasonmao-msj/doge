import type {
  AccountGatewayEventV1,
  AccountGatewayV1,
  ApiKeyCandidateListViewV1,
  AuthNextViewV1,
  ConfigFileDetailViewV1,
  ConfigurationOfferViewV1,
  ConfigurationPlanViewV1,
  ConfigurationResultViewV1,
  ConfigurationTaskViewV1,
  GatewayCallContextV1,
  GatewayOperationNameV1,
  GatewayReadContextV1,
  GatewayReconciliationViewV1,
  HumanVerificationRequirementViewV1,
  ManagedKeyStatusViewV1,
  OAuthAttemptViewV1,
  TotpEnrollmentPresentationV1,
} from "../contracts/gateway";
import {
  type AccountBootstrapViewV1,
  type AccountCapabilitiesViewV1,
  type AccountSessionViewV1,
  ACCOUNT_CAPABILITY_KEYS_V1,
  ACCOUNT_CONTRACT_VERSION_V1,
  ACCOUNT_GATEWAY_CONTRACT_V1,
  configFileHandleV1,
  configPlanHandleV1,
  configResultHandleV1,
  humanVerificationHandleV1,
  type GatewayResultV1,
  type QuotaUsageViewV1,
} from "../contracts/semantic";
import {
  oneTimeTotpPresentationV1,
  safeLabelV1,
} from "../contracts/safeValues";
import type {
  AccountCenterViewV1,
  GatewayCallContextV1 as MutationContextV1,
} from "../contracts/gateway";
import type {
  ScenarioOperationResolutionV1,
  ScenarioRuntimeSnapshotV1,
} from "./ScenarioRuntimeV1";
import { ScenarioRuntimeV1 } from "./ScenarioRuntimeV1";

type OperationContextV1 = GatewayReadContextV1 | GatewayCallContextV1;

import {
  CODEX_RECIPE_V1,
  apiKeyCandidateV1,
  authAttemptV1,
  cancelledFailureV1,
  externalIntentV1,
  failureForResolutionV1,
  handleBindingV1,
  handleNonceV1,
  oauthAttemptV1,
  successV1,
} from "./mockGatewaySupportV1";
function authenticatedSessionV1(
  runtime: ScenarioRuntimeV1,
): Extract<AccountSessionViewV1, { status: "authenticated" }> {
  return {
    status: "authenticated",
    accountEpoch: runtime.getSnapshot().scenarioEpoch,
    sessionCapability: "persistent",
    profileLabel: "Synthetic doge account",
    primaryEmailLabel: "Synthetic account email",
  };
}

function capabilitiesV1(runtime: ScenarioRuntimeV1): AccountCapabilitiesViewV1 {
  const entries = Object.fromEntries(
    ACCOUNT_CAPABILITY_KEYS_V1.map((key) => [
      key,
      runtime.scenario.requiredCapabilities.includes(key)
        ? { status: "enabled" as const }
        : {
            status: "disabled" as const,
            reason: "serverDisabled" as const,
          },
    ]),
  );
  return {
    contractVersion: ACCOUNT_CONTRACT_VERSION_V1,
    observedAt: runtime.nowIso(),
    freshness: runtime.scenario.id.includes("last-known")
      ? "softStale"
      : "fresh",
    entries,
    registration: {
      emailSuffixHint: null,
      invitationCode:
        runtime.scenario.id === "register.policy-fields"
          ? "required"
          : "hidden",
      promoCode:
        runtime.scenario.id === "register.policy-fields"
          ? "optional"
          : "hidden",
      agreementRequired: runtime.scenario.id === "register.policy-fields",
      humanVerificationRequired: runtime.scenario.requiredCapabilities.includes(
        "auth.humanVerification",
      ),
    },
  };
}

function bootstrapViewV1(runtime: ScenarioRuntimeV1): AccountBootstrapViewV1 {
  const snapshot = runtime.getSnapshot();
  const scenario = runtime.scenario;
  const availability =
    snapshot.injectedFault === "offline" ||
    scenario.schedule.faults.includes("offline")
      ? "offline"
      : scenario.initialAuthorityStateClass === "serviceUnavailable"
        ? "serviceUnavailable"
        : "ready";
  const session: AccountSessionViewV1 =
    scenario.initialProductState === "authenticatedPersistent" ||
    scenario.initialProductState === "configurationEligible"
      ? authenticatedSessionV1(runtime)
      : { status: "signedOut" };
  const vault =
    scenario.id === "vault.locked"
      ? "locked"
      : scenario.schedule.faults.includes("vaultUnavailable")
        ? "unavailable"
        : "ready";
  return {
    localMode: {
      status: "available",
      blockedByAccount: false,
      accountFailureCanGateLocalMode: false,
    },
    gatewayAvailability: availability,
    vault,
    capabilities: capabilitiesV1(runtime),
    session,
  };
}

function accountCenterViewV1(): AccountCenterViewV1 {
  return {
    profile: {
      displayName: safeLabelV1("Synthetic doge account"),
      primaryEmailLabel: safeLabelV1("Synthetic account email"),
      avatarKind: "doge",
    },
    security: {
      totp: "disabled",
      passwordChange: "available",
      identityBindings: [
        { provider: "auth.oauth.github", status: "available" },
      ],
    },
  };
}

function quotaViewV1(runtime: ScenarioRuntimeV1): QuotaUsageViewV1 {
  const exhausted = runtime.scenario.id === "usage.exhausted";
  return {
    status: "available",
    source: "token2apiPlatformQuota",
    freshness: runtime.scenario.id.includes("soft-stale")
      ? "softStale"
      : "fresh",
    observedAt: runtime.nowIso(),
    fetchedAt: runtime.nowIso(),
    remaining: { value: exhausted ? "0" : "840", unit: "credits" },
    used: { value: exhausted ? "1000" : "160", unit: "credits" },
    resetsAt: new Date(Date.parse(runtime.nowIso()) + 86_400_000).toISOString(),
    subscriptionLabel: "Synthetic plan",
  };
}

function offerViewV1(runtime: ScenarioRuntimeV1): ConfigurationOfferViewV1 {
  const id = runtime.scenario.id;
  const recommendation = id.includes("healthy-manual")
    ? "preserve"
    : id.includes("already-configured")
      ? "alreadyConfigured"
      : id.includes("conflict")
        ? "reviewConflict"
        : "configure";
  return {
    status: "available",
    ...CODEX_RECIPE_V1,
    targetLabel: safeLabelV1("Codex"),
    recommendation,
  };
}

function planViewV1(runtime: ScenarioRuntimeV1): ConfigurationPlanViewV1 {
  const noop = runtime.scenario.id.includes("already-configured");
  return {
    plan: configPlanHandleV1(
      handleBindingV1(runtime, "configuration-plan"),
      handleNonceV1(runtime),
    ),
    ...CODEX_RECIPE_V1,
    targetLabel: safeLabelV1("Codex"),
    expiresAt: new Date(Date.parse(runtime.nowIso()) + 300_000).toISOString(),
    summary: noop ? "noop" : "changesPlanned",
    files: noop
      ? []
      : [
          {
            file: configFileHandleV1(
              handleBindingV1(runtime, "configuration-file"),
              handleNonceV1(runtime),
            ),
            targetLabel: safeLabelV1("Codex settings"),
            outcome: "willChange",
          },
        ],
  };
}

function fileDetailViewV1(runtime: ScenarioRuntimeV1): ConfigFileDetailViewV1 {
  return {
    file: configFileHandleV1(
      handleBindingV1(runtime, "configuration-file"),
      handleNonceV1(runtime),
    ),
    targetLabel: safeLabelV1("Codex settings"),
    sections: [
      {
        label: safeLabelV1("Planned changes", "fieldLabel"),
        entries: [
          {
            kind: "change",
            fieldLabel: safeLabelV1("Managed credential"),
            before: { kind: "redacted", label: "userValue" },
            after: { kind: "redacted", label: "managedCredential" },
          },
        ],
      },
    ],
  };
}

function resultViewV1(runtime: ScenarioRuntimeV1): ConfigurationResultViewV1 {
  const rollbackIncomplete = runtime.scenario.id.includes(
    "rollback-incomplete",
  );
  const rolledBack = runtime.scenario.id.includes("partial-rollback");
  return {
    result: configResultHandleV1(
      handleBindingV1(runtime, "configuration-result", 600),
      handleNonceV1(runtime),
    ),
    overall: rollbackIncomplete
      ? "rollbackIncomplete"
      : rolledBack
        ? "rolledBack"
        : "applied",
    files: [
      {
        targetLabel: safeLabelV1("Codex settings"),
        outcome: rollbackIncomplete
          ? "rollbackFailed"
          : rolledBack
            ? "rolledBack"
            : "applied",
      },
    ],
    reload: {
      requirement: "newSessions",
      status: runtime.scenario.id.includes("reload-failure")
        ? "failed"
        : "applied",
    },
    verification: rollbackIncomplete ? "failed" : "usable",
    acknowledged: false,
  };
}

export class MockAccountGatewayV1 implements AccountGatewayV1 {
  readonly contract = ACCOUNT_GATEWAY_CONTRACT_V1;
  readonly runtime: ScenarioRuntimeV1;

  private readonly eventListeners = new Set<
    (event: AccountGatewayEventV1) => void
  >();
  private eventSequence = 0;
  private eventScenarioEpoch: number;

  constructor(runtime: ScenarioRuntimeV1) {
    this.runtime = runtime;
    this.eventScenarioEpoch = runtime.getSnapshot().scenarioEpoch;
  }

  subscribe = (
    listener: (event: AccountGatewayEventV1) => void,
  ): (() => void) => {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  };

  bootstrap = (context: GatewayReadContextV1) => {
    if (context.signal?.aborted)
      return Promise.resolve(cancelledFailureV1("gateway.bootstrap"));
    // Scenario operation lists describe the journey under review. Bootstrap is
    // an observational prerequisite for non-bootstrap journeys and must not
    // consume or reject their first canonical action.
    if (this.runtime.getSnapshot().nextOperation !== "gateway.bootstrap") {
      return Promise.resolve(successV1(bootstrapViewV1(this.runtime)));
    }
    return this.execute("gateway.bootstrap", context, () =>
      bootstrapViewV1(this.runtime),
    );
  };

  reconcileIntent = (
    input: {
      readonly intent: MutationContextV1["intent"];
      readonly expected: GatewayOperationNameV1;
    },
    context: GatewayReadContextV1,
  ) => {
    void input;
    return this.execute<GatewayReconciliationViewV1>(
      "gateway.reconcileIntent",
      context,
      () => ({
        status: "knownTerminal",
        operation: input.expected,
        outcome: "succeeded",
      }),
    );
  };

  readonly humanVerification: AccountGatewayV1["humanVerification"] = {
    readRequirement: (input, context) => {
      void input;
      return this.execute<HumanVerificationRequirementViewV1>(
        "humanVerification.readRequirement",
        context,
        () => ({
          status: "required",
          provider: "turnstile",
          siteKey: "synthetic-site-key",
          action: "account-auth",
        }),
      );
    },
    submitProof: (input, context) => {
      void input;
      return this.execute("humanVerification.submitProof", context, () => ({
        verification: humanVerificationHandleV1(
          handleBindingV1(this.runtime, "human-verification", 120),
          handleNonceV1(this.runtime),
        ),
        expiresAt: new Date(
          Date.parse(this.runtime.nowIso()) + 120_000,
        ).toISOString(),
      }));
    },
  };

  readonly auth: AccountGatewayV1["auth"] = {
    beginRegistration: (input, context) => {
      void input;
      return this.execute("auth.beginRegistration", context, (resolution) =>
        this.authNextForResolution(resolution),
      );
    },
    resendRegistrationCode: (input, context) => {
      void input;
      return this.execute("auth.resendRegistrationCode", context, () => ({
        next: "verification",
        attempt: authAttemptV1(this.runtime, "registration"),
        emailLabel: "Synthetic account email",
        resendAt: new Date(
          Date.parse(this.runtime.nowIso()) + 60_000,
        ).toISOString(),
      }));
    },
    submitRegistrationCode: (input, context) => {
      void input;
      return this.execute("auth.submitRegistrationCode", context, () => ({
        next: "authenticated",
        session: authenticatedSessionV1(this.runtime),
      }));
    },
    login: (input, context) => {
      void input;
      return this.execute("auth.login", context, (resolution) =>
        this.authNextForResolution(resolution),
      );
    },
    verifyMfa: (input, context) => {
      void input;
      return this.execute("auth.verifyMfa", context, () => ({
        next: "authenticated",
        session: authenticatedSessionV1(this.runtime),
      }));
    },
    startOAuth: (input, context) => {
      void input;
      return this.execute("auth.startOAuth", context, () => ({
        next: "oauthWaiting",
        attempt: oauthAttemptV1(this.runtime, "oauth-login"),
        providerLabel: "Synthetic provider",
        expiresAt: new Date(
          Date.parse(this.runtime.nowIso()) + 300_000,
        ).toISOString(),
      }));
    },
    cancelOAuth: (input, context) => {
      void input;
      return this.execute("auth.cancelOAuth", context, () => ({
        cancelled: true,
      }));
    },
    readOAuthAttempt: (input, context) => {
      void input;
      return this.execute<OAuthAttemptViewV1>(
        "auth.readOAuthAttempt",
        context,
        () =>
          (this.runtime.scenario.id.includes("completion-bind")
            ? {
                status: "completionRequired",
                attempt: authAttemptV1(this.runtime, "oauth-completion"),
                requirements: ["bindConfirmation"],
              }
            : this.runtime.scenario.id.includes("completion-mfa")
              ? {
                  status: "completionRequired",
                  attempt: authAttemptV1(this.runtime, "oauth-completion"),
                  requirements: ["mfa"],
                }
              : {
                  status: this.runtime.scenario.id.includes("denied")
                    ? "denied"
                    : "authenticated",
                  ...(this.runtime.scenario.id.includes("denied")
                    ? {}
                    : { session: authenticatedSessionV1(this.runtime) }),
                }) as OAuthAttemptViewV1,
      );
    },
    completeOAuthAccount: (input, context) => {
      void input;
      return this.execute("auth.completeOAuthAccount", context, () =>
        this.runtime.scenario.id.includes("completion-mfa")
          ? {
              next: "mfa",
              attempt: authAttemptV1(this.runtime, "oauth-mfa"),
              expiresAt: new Date(Date.parse(this.runtime.nowIso()) + 120_000).toISOString(),
            }
          : {
              next: "authenticated",
              session: authenticatedSessionV1(this.runtime),
            });
    },
    requestPasswordReset: (input, context) => {
      void input;
      return this.execute("auth.requestPasswordReset", context, () => ({
        next: "resetRequested",
        requestAccepted: true,
      }));
    },
    inspectExternalIntent: (input, context) => {
      void input;
      return this.execute("auth.inspectExternalIntent", context, () => ({
        next: "passwordResetReady",
        intent: externalIntentV1(this.runtime, "password-reset"),
        expiresAt: new Date(
          Date.parse(this.runtime.nowIso()) + 300_000,
        ).toISOString(),
      }));
    },
    resetPassword: (input, context) => {
      void input;
      return this.execute("auth.resetPassword", context, () => ({
        next: "passwordResetCompleted",
        reset: true,
        nextAction: "login",
      }));
    },
    logout: (input, context) => {
      void input;
      return this.execute("auth.logout", context, () => ({
        localSessionCleared: true,
        remoteRevocation: this.runtime.scenario.id.includes("unconfirmed")
          ? "unconfirmed"
          : "confirmed",
      }));
    },
  };

  readonly profile: AccountGatewayV1["profile"] = {
    read: (context) =>
      this.execute("profile.read", context, accountCenterViewV1),
    updateProfile: (input, context) => {
      void input;
      return this.execute(
        "profile.updateProfile",
        context,
        accountCenterViewV1,
      );
    },
    changePassword: (input, context) => {
      void input;
      return this.execute("profile.changePassword", context, () => ({
        changed: true,
      }));
    },
    requestTotpEmailCode: (context) =>
      this.execute("profile.requestTotpEmailCode", context, () => ({
        resendAt: new Date(
          Date.parse(this.runtime.nowIso()) + 60_000,
        ).toISOString(),
      })),
    beginTotpEnrollment: (input, context) => {
      void input;
      return this.execute("profile.beginTotpEnrollment", context, () => ({
        enrollment: authAttemptV1(this.runtime, "totp-enrollment"),
        presentation: {
          delivery: "oneTime",
          qrSvg: oneTimeTotpPresentationV1(
            `totp-svg~${handleNonceV1(this.runtime)}`,
          ),
          manualSecret: null,
          expiresAt: new Date(
            Date.parse(this.runtime.nowIso()) + 300_000,
          ).toISOString(),
        } satisfies TotpEnrollmentPresentationV1,
      }));
    },
    confirmTotpEnrollment: (input, context) => {
      void input;
      return this.execute("profile.confirmTotpEnrollment", context, () => ({
        enabled: true,
      }));
    },
    disableTotp: (input, context) => {
      void input;
      return this.execute("profile.disableTotp", context, () => ({
        disabled: true,
      }));
    },
    startIdentityBinding: (input, context) => {
      void input;
      return this.execute("profile.startIdentityBinding", context, () => ({
        next: "oauthWaiting",
        attempt: oauthAttemptV1(this.runtime, "identity-binding"),
        providerLabel: "Synthetic provider",
        expiresAt: new Date(
          Date.parse(this.runtime.nowIso()) + 300_000,
        ).toISOString(),
      }));
    },
    unbindIdentity: (input, context) => {
      void input;
      return this.execute("profile.unbindIdentity", context, () => ({
        unbound: true,
      }));
    },
    revokeAllSessions: (input, context) => {
      void input;
      return this.execute("profile.revokeAllSessions", context, () => ({
        remoteRevocation: this.runtime.scenario.id.includes("unconfirmed")
          ? "outcomeUnknown"
          : "confirmed",
      }));
    },
  };

  readonly usage: AccountGatewayV1["usage"] = {
    read: (context) =>
      this.execute("usage.read", context, () => quotaViewV1(this.runtime)),
  };

  readonly managedKey: AccountGatewayV1["managedKey"] = {
    readStatus: (input, context) => {
      void input;
      return this.execute<ManagedKeyStatusViewV1>(
        "managedKey.readStatus",
        context,
        () => ({ status: "absent" }),
      );
    },
    listCandidates: (_input, context) => {
      if (context.signal?.aborted) {
        return Promise.resolve(cancelledFailureV1("managedKey.listCandidates"));
      }
      const value = (): ApiKeyCandidateListViewV1 => ({
          keys: [{
            key: apiKeyCandidateV1(this.runtime),
            name: safeLabelV1("Codex Key", "targetLabel"),
            maskedPrefix: safeLabelV1("Key 8F2A", "maskedPresentation"),
            status: "active",
            availability: "selectable",
          }],
          fetchedAt: this.runtime.nowIso(),
      });
      if (this.runtime.getSnapshot().nextOperation === "managedKey.listCandidates") {
        return this.execute("managedKey.listCandidates", context, value);
      }
      return Promise.resolve({ ok: true, value: value() } satisfies GatewayResultV1<ApiKeyCandidateListViewV1>);
    },
    selectExisting: (input, context) => {
      void input;
      const operation = this.runtime.getSnapshot().nextOperation === "managedKey.selectExisting"
        ? "managedKey.selectExisting" as const
        : "managedKey.provision" as const;
      return this.execute(operation, context, () => ({
        status: "ready",
        ...CODEX_RECIPE_V1,
      }));
    },
    provision: (input, context) => {
      void input;
      return this.execute("managedKey.provision", context, () => ({
        status: "ready",
        ...CODEX_RECIPE_V1,
      }));
    },
    rotate: (input, context) => {
      void input;
      return this.execute("managedKey.rotate", context, () => ({
        status: "ready",
        ...CODEX_RECIPE_V1,
      }));
    },
    revoke: (input, context) => {
      void input;
      return this.execute<ManagedKeyStatusViewV1>(
        "managedKey.revoke",
        context,
        () => ({ status: "absent" }),
      );
    },
  };

  readonly configuration: AccountGatewayV1["configuration"] = {
    readOffer: (context) =>
      this.execute("configuration.readOffer", context, () =>
        offerViewV1(this.runtime),
      ),
    createPlan: (input, context) => {
      void input;
      return this.execute("configuration.createPlan", context, () =>
        planViewV1(this.runtime),
      );
    },
    readFileDetail: (input, context) => {
      void input;
      if (context.signal?.aborted) {
        return Promise.resolve(
          cancelledFailureV1("configuration.readFileDetail"),
        );
      }
      if (
        this.runtime.getSnapshot().nextOperation !==
        "configuration.readFileDetail"
      ) {
        return Promise.resolve(successV1(fileDetailViewV1(this.runtime)));
      }
      return this.execute("configuration.readFileDetail", context, () =>
        fileDetailViewV1(this.runtime),
      );
    },
    apply: (input, context) => {
      void input;
      return this.execute("configuration.apply", context, () =>
        resultViewV1(this.runtime),
      );
    },
    readCurrentTask: (context) =>
      this.execute<ConfigurationTaskViewV1>(
        "configuration.readCurrentTask",
        context,
        () => resultViewV1(this.runtime),
      ),
    acknowledgeResult: (input, context) => {
      void input;
      return this.execute("configuration.acknowledgeResult", context, () => ({
        acknowledged: true,
      }));
    },
    hardDismiss: (input, context) => {
      void input;
      return this.execute("configuration.hardDismiss", context, () => ({
        dismissed: true,
      }));
    },
  };

  private async execute<T>(
    operation: GatewayOperationNameV1,
    context: OperationContextV1,
    createValue: (resolution: ScenarioOperationResolutionV1) => T,
  ): Promise<GatewayResultV1<T>> {
    if (context.signal?.aborted) {
      return cancelledFailureV1(operation);
    }
    const resolution = await this.runtime.run(operation);
    if (context.signal?.aborted) {
      return cancelledFailureV1(operation);
    }
    if (
      resolution.result === "safeFailure" ||
      resolution.result === "outcomeUnknown"
    ) {
      return {
        ok: false,
        error: failureForResolutionV1(resolution, context),
      };
    }
    const value = createValue(resolution);
    this.emitExpectedEvents(resolution);
    return successV1(value);
  }

  private authNextForResolution(
    resolution: ScenarioOperationResolutionV1,
  ): AuthNextViewV1 {
    const id = resolution.scenarioId;
    if (id.includes("email-verification") || id.includes("resend")) {
      return {
        next: "verification",
        attempt: authAttemptV1(this.runtime, "registration"),
        emailLabel: "Synthetic account email",
        resendAt: new Date(
          Date.parse(this.runtime.nowIso()) + 60_000,
        ).toISOString(),
      };
    }
    if (id.includes("mfa") && resolution.operation === "auth.login") {
      return {
        next: "mfa",
        attempt: authAttemptV1(this.runtime, "mfa-login"),
        expiresAt: new Date(
          Date.parse(this.runtime.nowIso()) + 120_000,
        ).toISOString(),
      };
    }
    return {
      next: "authenticated",
      session: authenticatedSessionV1(this.runtime),
    };
  }

  private emitExpectedEvents(resolution: ScenarioOperationResolutionV1): void {
    if (this.eventListeners.size === 0) {
      return;
    }
    for (const kind of this.runtime.scenario.expectedGateway.events) {
      const emitsForAction = resolution.isFinalAction ||
        (kind === "externalIntentReady" &&
          resolution.operation === "auth.requestPasswordReset");
      if (!emitsForAction) continue;
      const scenarioEpoch = this.runtime.getSnapshot().scenarioEpoch;
      if (scenarioEpoch !== this.eventScenarioEpoch) {
        this.eventScenarioEpoch = scenarioEpoch;
        this.eventSequence = 0;
      }
      this.eventSequence += 1;
      const base = {
        eventId: this.runtime.nextSafeToken("event"),
        emittedAt: this.runtime.nowIso(),
        processGeneration: 1,
        eventSeq: this.eventSequence,
        accountEpoch: scenarioEpoch,
      } as const;
      const event: AccountGatewayEventV1 =
        kind === "sessionChanged"
          ? { ...base, kind }
          : kind === "oauthAttemptChanged"
            ? {
                ...base,
                kind,
                attempt: oauthAttemptV1(this.runtime, "oauth-login"),
              }
            : kind === "externalIntentReady"
              ? {
                  ...base,
                  kind,
                  intent: externalIntentV1(this.runtime, "password-reset"),
                  purpose: "passwordReset",
                }
              : kind === "usageInvalidated"
                ? {
                    ...base,
                    kind,
                    accountEpoch: this.runtime.getSnapshot().scenarioEpoch,
                  }
                : { ...base, kind };
      for (const listener of this.eventListeners) {
        listener(event);
      }
    }
  }
}

export function createMockAccountGatewayV1(
  runtime: ScenarioRuntimeV1,
): MockAccountGatewayV1 {
  return new MockAccountGatewayV1(runtime);
}

export function readMockGatewaySnapshotV1(
  gateway: MockAccountGatewayV1,
): ScenarioRuntimeSnapshotV1 {
  return gateway.runtime.getSnapshot();
}
