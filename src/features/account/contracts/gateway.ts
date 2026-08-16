import type {
  AccountBootstrapViewV1,
  AccountCapabilityKeyV1,
  AccountGatewayFieldV1,
  AccountSessionViewV1,
  AuthAttemptHandleV1,
  ApiKeyCandidateHandleV1,
  ConfigFileHandleV1,
  ConfigPlanHandleV1,
  ConfigResultHandleV1,
  ExternalIntentHandleV1,
  GatewayIntentIdV1,
  GatewayResultV1,
  HumanVerificationHandleV1,
  OAuthAttemptHandleV1,
  OAuthProviderCapabilityKeyV1,
  QuotaUsageViewV1,
  SecretInputV1,
} from "./semantic";
import { ACCOUNT_GATEWAY_CONTRACT_V1 } from "./semantic";
import type {
  OneTimeTotpPresentationV1,
  SafeLabelV1,
  SafePresentedValueV1,
  StaticRedactedSafePresentedValueV1,
} from "./safeValues";

export const ACCOUNT_GATEWAY_OPERATION_NAMES_V1 = [
  "gateway.bootstrap",
  "gateway.reconcileIntent",
  "humanVerification.readRequirement",
  "humanVerification.submitProof",
  "auth.beginRegistration",
  "auth.resendRegistrationCode",
  "auth.submitRegistrationCode",
  "auth.login",
  "auth.verifyMfa",
  "auth.startOAuth",
  "auth.cancelOAuth",
  "auth.readOAuthAttempt",
  "auth.completeOAuthAccount",
  "auth.requestPasswordReset",
  "auth.inspectExternalIntent",
  "auth.resetPassword",
  "auth.logout",
  "profile.read",
  "profile.updateProfile",
  "profile.changePassword",
  "profile.requestTotpEmailCode",
  "profile.beginTotpEnrollment",
  "profile.confirmTotpEnrollment",
  "profile.disableTotp",
  "profile.startIdentityBinding",
  "profile.unbindIdentity",
  "profile.revokeAllSessions",
  "usage.read",
  "managedKey.readStatus",
  "managedKey.listCandidates",
  "managedKey.selectExisting",
  "managedKey.provision",
  "managedKey.rotate",
  "managedKey.revoke",
  "configuration.readOffer",
  "configuration.createPlan",
  "configuration.readFileDetail",
  "configuration.apply",
  "configuration.readCurrentTask",
  "configuration.acknowledgeResult",
  "configuration.hardDismiss",
] as const;

export type GatewayOperationNameV1 =
  (typeof ACCOUNT_GATEWAY_OPERATION_NAMES_V1)[number];

export type GatewayReadContextV1 = {
  readonly signal?: AbortSignal;
};

export type GatewayCallContextV1 = GatewayReadContextV1 & {
  /** Stable for one logical user action; do not mint a new id for reconciliation. */
  readonly intent: GatewayIntentIdV1;
};

export type HumanVerificationPurposeV1 =
  | "register"
  | "login"
  | "registrationCode"
  | "passwordReset";

export type HumanVerificationRequirementViewV1 =
  | { readonly status: "notRequired" }
  | {
      readonly status: "required";
      readonly provider: "turnstile";
      readonly siteKey: string;
      readonly action: string;
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "offline"
        | "platformUnsupported"
        | "providerUnavailable";
    };

export type AuthNextViewV1 =
  | {
      readonly next: "verification";
      readonly attempt: AuthAttemptHandleV1;
      readonly emailLabel: string;
      readonly resendAt: string;
    }
  | {
      readonly next: "mfa";
      readonly attempt: AuthAttemptHandleV1;
      readonly expiresAt: string;
    }
  | {
      readonly next: "oauthWaiting";
      readonly attempt: OAuthAttemptHandleV1;
      readonly providerLabel: string;
      readonly expiresAt: string;
    }
  | {
      readonly next: "oauthAccountCompletion";
      readonly attempt: AuthAttemptHandleV1;
      readonly requirements: readonly (
        | "email"
        | "invitation"
        | "mfa"
        | "bindConfirmation"
      )[];
    }
  | { readonly next: "resetRequested"; readonly requestAccepted: true }
  | {
      readonly next: "passwordResetReady";
      readonly intent: ExternalIntentHandleV1;
      readonly expiresAt: string;
    }
  | {
      readonly next: "passwordResetCompleted";
      readonly reset: true;
      readonly nextAction: "login";
    }
  | {
      readonly next: "authenticated";
      readonly session: Extract<AccountSessionViewV1, { status: "authenticated" }>;
    };

export type OAuthAttemptViewV1 =
  | {
      readonly status: "waiting";
      readonly attempt: OAuthAttemptHandleV1;
      readonly expiresAt: string;
    }
  | {
      readonly status: "completionRequired";
      readonly attempt: AuthAttemptHandleV1;
      readonly requirements: readonly (
        | "email"
        | "invitation"
        | "mfa"
        | "bindConfirmation"
      )[];
    }
  | {
      readonly status: "authenticated";
      readonly session: Extract<AccountSessionViewV1, { status: "authenticated" }>;
    }
  | { readonly status: "cancelled" | "expired" | "denied" };

export type GatewayReconciliationViewV1 =
  | { readonly status: "pending" }
  | {
      readonly status: "knownTerminal";
      readonly operation: GatewayOperationNameV1;
      readonly outcome: "succeeded" | "rejected" | "cancelledBeforeSend";
    }
  | {
      readonly status: "outcomeUnknown";
      readonly operation: GatewayOperationNameV1;
    };

export type AccountCenterViewV1 = {
  readonly profile: {
    readonly displayName: SafeLabelV1;
    readonly primaryEmailLabel: SafeLabelV1;
    readonly avatarKind: "doge" | "initials";
  };
  readonly security: {
    readonly totp: "enabled" | "disabled" | "unavailable";
    readonly passwordChange: "available" | "unavailable";
    readonly identityBindings: readonly {
      readonly provider: OAuthProviderCapabilityKeyV1;
      readonly status: "bound" | "available" | "unavailable";
    }[];
  };
};

export type TotpEnrollmentPresentationV1 = {
  readonly delivery: "oneTime";
  readonly qrSvg: OneTimeTotpPresentationV1;
  readonly manualSecret: OneTimeTotpPresentationV1 | null;
  readonly expiresAt: string;
};

export type ManagedKeyStatusViewV1 =
  | { readonly status: "absent" }
  | {
      readonly status: "ready";
      readonly recipeId: "doge.account.codex-token-service";
      readonly recipeVersion: 1;
    }
  | {
      readonly status: "attention";
      readonly action: "rotate" | "reprovision" | "revoke";
    }
  | {
      readonly status: "unavailable";
      readonly reason: "capabilityUnavailable" | "vaultUnavailable";
    };

export type ApiKeyCandidateViewV1 = {
  readonly key: ApiKeyCandidateHandleV1;
  readonly name: SafeLabelV1;
  readonly maskedPrefix: SafeLabelV1;
  readonly status: "active" | "disabled" | "expired";
  readonly availability: "selectable" | "handoffUnavailable";
};

export type ApiKeyCandidateListViewV1 = {
  readonly keys: readonly ApiKeyCandidateViewV1[];
  readonly fetchedAt: string;
};

export type ConfigurationOfferViewV1 =
  | {
      readonly status: "notEligible";
      readonly reason: "notAuthenticated" | "capabilityUnavailable";
    }
  | { readonly status: "none" }
  | {
      readonly status: "available";
      readonly recipeId: "doge.account.codex-token-service";
      readonly recipeVersion: 1;
      readonly targetLabel: SafeLabelV1;
      readonly recommendation:
        | "configure"
        | "preserve"
        | "reviewConflict"
        | "alreadyConfigured";
    };

export type ConfigurationPlanViewV1 = {
  readonly plan: ConfigPlanHandleV1;
  readonly recipeId: "doge.account.codex-token-service";
  readonly recipeVersion: 1;
  readonly targetLabel: SafeLabelV1;
  readonly expiresAt: string;
  readonly summary: "changesPlanned" | "noop" | "blocked";
  readonly files: readonly {
    readonly file: ConfigFileHandleV1;
    readonly targetLabel: SafeLabelV1;
    readonly outcome: "willChange" | "unchanged" | "blocked";
  }[];
};

export type ConfigFileDetailViewV1 = {
  readonly file: ConfigFileHandleV1;
  readonly targetLabel: SafeLabelV1;
  readonly sections: readonly {
    readonly label: SafeLabelV1;
    readonly entries: readonly {
      readonly kind: "add" | "remove" | "change" | "context";
      readonly fieldLabel: SafeLabelV1;
      readonly before: SafePresentedValueV1 | StaticRedactedSafePresentedValueV1;
      readonly after: SafePresentedValueV1 | StaticRedactedSafePresentedValueV1;
    }[];
  }[];
};

export type ConfigurationResultViewV1 = {
  readonly result: ConfigResultHandleV1;
  readonly overall:
    | "unchanged"
    | "applied"
    | "rolledBack"
    | "rollbackIncomplete"
    | "aborted";
  readonly files: readonly {
    readonly targetLabel: SafeLabelV1;
    readonly outcome:
      | "unchanged"
      | "applied"
      | "rolledBack"
      | "rollbackFailed"
      | "skippedPrecondition"
      | "failedBeforeWrite";
  }[];
  readonly reload: {
    readonly requirement: "none" | "newSessions" | "restartRequired";
    readonly status: "notNeeded" | "pending" | "applied" | "failed";
  };
  readonly verification: "notRequired" | "pending" | "usable" | "failed";
  readonly acknowledged: boolean;
};

export type ConfigurationTaskViewV1 =
  | ConfigurationOfferViewV1
  | ConfigurationPlanViewV1
  | ConfigurationResultViewV1;

export type AccountGatewayEventV1 =
  | AccountGatewayEventBaseV1 & {
      readonly kind: "sessionChanged";
      readonly accountEpoch: number | null;
    }
  | AccountGatewayEventBaseV1 & { readonly kind: "capabilitiesChanged" }
  | AccountGatewayEventBaseV1 & {
      readonly kind: "oauthAttemptChanged";
      readonly attempt: OAuthAttemptHandleV1;
    }
  | AccountGatewayEventBaseV1 & {
      readonly kind: "externalIntentReady";
      readonly intent: ExternalIntentHandleV1;
      readonly purpose: "passwordReset";
    }
  | AccountGatewayEventBaseV1 & {
      readonly kind: "usageInvalidated";
      readonly accountEpoch: number;
    }
  | AccountGatewayEventBaseV1 & {
      readonly kind: "configurationTaskChanged";
    };

type AccountGatewayEventBaseV1 = {
  readonly eventId: string;
  readonly emittedAt: string;
  readonly processGeneration: number;
  readonly eventSeq: number;
  readonly accountEpoch: number | null;
};

export const ACCOUNT_GATEWAY_EVENT_KINDS_V1 = [
  "sessionChanged",
  "capabilitiesChanged",
  "oauthAttemptChanged",
  "externalIntentReady",
  "usageInvalidated",
  "configurationTaskChanged",
] as const satisfies readonly AccountGatewayEventV1["kind"][];

/** Event sequence starts at zero and is strictly increasing per process generation. */
export const ACCOUNT_EVENT_SEQUENCE_CONTRACT_V1 = {
  firstEventSeq: 0,
  scope: "processGeneration",
  nextAcceptance: "strictlyIncreasing",
  durableIdentity: false,
  semanticRole: "wakeupOnly",
} as const;

export interface AccountHumanVerificationPortV1 {
  readRequirement(
    input: { readonly purpose: HumanVerificationPurposeV1 },
    context: GatewayReadContextV1,
  ): Promise<GatewayResultV1<HumanVerificationRequirementViewV1>>;
  submitProof(
    input: {
      readonly purpose: HumanVerificationPurposeV1;
      readonly proof: SecretInputV1;
    },
    context: GatewayCallContextV1,
  ): Promise<
    GatewayResultV1<{
      readonly verification: HumanVerificationHandleV1;
      readonly expiresAt: string;
    }>
  >;
}

export interface AccountAuthPortV1 {
  beginRegistration(input: {
    readonly email: string;
    readonly password: SecretInputV1;
    readonly invitationCode?: SecretInputV1;
    readonly promoCode?: string;
    readonly agreementAccepted: boolean;
    readonly humanVerification?: HumanVerificationHandleV1;
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<AuthNextViewV1>>;
  resendRegistrationCode(input: {
    readonly attempt: AuthAttemptHandleV1;
    readonly humanVerification?: HumanVerificationHandleV1;
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<AuthNextViewV1>>;
  submitRegistrationCode(input: {
    readonly attempt: AuthAttemptHandleV1;
    readonly code: SecretInputV1;
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<AuthNextViewV1>>;
  login(input: {
    readonly email: string;
    readonly password: SecretInputV1;
    readonly humanVerification?: HumanVerificationHandleV1;
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<AuthNextViewV1>>;
  verifyMfa(input: {
    readonly attempt: AuthAttemptHandleV1;
    readonly code: SecretInputV1;
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<AuthNextViewV1>>;
  startOAuth(input: {
    readonly provider: OAuthProviderCapabilityKeyV1;
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<AuthNextViewV1>>;
  cancelOAuth(input: {
    readonly attempt: OAuthAttemptHandleV1;
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<{ readonly cancelled: true }>>;
  readOAuthAttempt(input: {
    readonly attempt: OAuthAttemptHandleV1;
  }, context: GatewayReadContextV1): Promise<GatewayResultV1<OAuthAttemptViewV1>>;
  completeOAuthAccount(input: {
    readonly attempt: AuthAttemptHandleV1;
    readonly email?: string;
    readonly invitationCode?: SecretInputV1;
    readonly mfaCode?: SecretInputV1;
    readonly bindConfirmed?: boolean;
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<AuthNextViewV1>>;
  requestPasswordReset(input: {
    readonly email: string;
    readonly humanVerification?: HumanVerificationHandleV1;
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<AuthNextViewV1>>;
  inspectExternalIntent(input: {
    readonly intent: ExternalIntentHandleV1;
  }, context: GatewayReadContextV1): Promise<GatewayResultV1<AuthNextViewV1>>;
  resetPassword(input: {
    readonly intent: ExternalIntentHandleV1;
    readonly newPassword: SecretInputV1;
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<AuthNextViewV1>>;
  logout(input: {
    readonly scope: "thisDevice" | "allSessions";
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<{
    readonly localSessionCleared: true;
    readonly remoteRevocation: "confirmed" | "unconfirmed";
  }>>;
}

export interface AccountProfilePortV1 {
  read(context: GatewayReadContextV1): Promise<GatewayResultV1<AccountCenterViewV1>>;
  updateProfile(input: {
    readonly displayName: string;
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<AccountCenterViewV1>>;
  changePassword(input: {
    readonly currentPassword: SecretInputV1;
    readonly newPassword: SecretInputV1;
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<{ readonly changed: true }>>;
  requestTotpEmailCode(context: GatewayCallContextV1): Promise<GatewayResultV1<{
    readonly resendAt: string;
  }>>;
  beginTotpEnrollment(input: {
    readonly verification:
      | { readonly kind: "password"; readonly value: SecretInputV1 }
      | { readonly kind: "emailCode"; readonly value: SecretInputV1 };
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<{
    readonly enrollment: AuthAttemptHandleV1;
    readonly presentation: TotpEnrollmentPresentationV1;
  }>>;
  confirmTotpEnrollment(input: {
    readonly enrollment: AuthAttemptHandleV1;
    readonly code: SecretInputV1;
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<{ readonly enabled: true }>>;
  disableTotp(input: {
    readonly verification:
      | { readonly kind: "password"; readonly value: SecretInputV1 }
      | { readonly kind: "emailCode"; readonly value: SecretInputV1 };
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<{ readonly disabled: true }>>;
  startIdentityBinding(input: {
    readonly provider: OAuthProviderCapabilityKeyV1;
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<AuthNextViewV1>>;
  unbindIdentity(input: {
    readonly provider: OAuthProviderCapabilityKeyV1;
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<{ readonly unbound: true }>>;
  revokeAllSessions(input: {
    readonly consent: "revokeAllSessions";
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<{
    readonly remoteRevocation: "confirmed" | "outcomeUnknown";
  }>>;
}

export interface AccountUsagePortV1 {
  /** Pull-only: callers may invoke only for an open usage surface or explicit refresh. */
  read(context: GatewayReadContextV1): Promise<GatewayResultV1<QuotaUsageViewV1>>;
}

export interface AccountManagedKeyPortV1 {
  readStatus(input: {
    readonly recipeId: "doge.account.codex-token-service";
    readonly recipeVersion: 1;
  }, context: GatewayReadContextV1): Promise<GatewayResultV1<ManagedKeyStatusViewV1>>;
  listCandidates(input: {
    readonly recipeId: "doge.account.codex-token-service";
    readonly recipeVersion: 1;
  }, context: GatewayReadContextV1): Promise<GatewayResultV1<ApiKeyCandidateListViewV1>>;
  selectExisting(input: {
    readonly recipeId: "doge.account.codex-token-service";
    readonly recipeVersion: 1;
    readonly key: ApiKeyCandidateHandleV1;
    readonly consent: "useSelectedApiKey";
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<ManagedKeyStatusViewV1>>;
  provision(input: {
    readonly recipeId: "doge.account.codex-token-service";
    readonly recipeVersion: 1;
    readonly consent: "provisionDedicatedKey";
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<ManagedKeyStatusViewV1>>;
  rotate(input: {
    readonly recipeId: "doge.account.codex-token-service";
    readonly recipeVersion: 1;
    readonly consent: "rotateDedicatedKey";
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<ManagedKeyStatusViewV1>>;
  revoke(input: {
    readonly recipeId: "doge.account.codex-token-service";
    readonly recipeVersion: 1;
    readonly consent: "removeLocalKey";
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<ManagedKeyStatusViewV1>>;
}

export interface AccountConfigurationPortV1 {
  readOffer(context: GatewayReadContextV1): Promise<GatewayResultV1<ConfigurationOfferViewV1>>;
  createPlan(input: {
    readonly recipeId: "doge.account.codex-token-service";
    readonly recipeVersion: 1;
    readonly intent: "configure" | "review";
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<ConfigurationPlanViewV1>>;
  readFileDetail(input: {
    readonly plan: ConfigPlanHandleV1;
    readonly file: ConfigFileHandleV1;
  }, context: GatewayReadContextV1): Promise<GatewayResultV1<ConfigFileDetailViewV1>>;
  apply(input: {
    readonly plan: ConfigPlanHandleV1;
    readonly consent: "applyExactPlan";
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<ConfigurationResultViewV1>>;
  readCurrentTask(context: GatewayReadContextV1): Promise<GatewayResultV1<ConfigurationTaskViewV1>>;
  acknowledgeResult(input: {
    readonly result: ConfigResultHandleV1;
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<{ readonly acknowledged: true }>>;
  hardDismiss(input: {
    readonly recipeId: "doge.account.codex-token-service";
    readonly recipeVersion: 1;
  }, context: GatewayCallContextV1): Promise<GatewayResultV1<{ readonly dismissed: true }>>;
}

export interface AccountGatewayV1 {
  readonly contract: typeof ACCOUNT_GATEWAY_CONTRACT_V1;
  bootstrap(context: GatewayReadContextV1): Promise<GatewayResultV1<AccountBootstrapViewV1>>;
  reconcileIntent(input: {
    readonly intent: GatewayIntentIdV1;
    readonly expected: GatewayOperationNameV1;
  }, context: GatewayReadContextV1): Promise<GatewayResultV1<GatewayReconciliationViewV1>>;
  subscribe(listener: (event: AccountGatewayEventV1) => void): () => void;
  readonly humanVerification: AccountHumanVerificationPortV1;
  readonly auth: AccountAuthPortV1;
  readonly profile: AccountProfilePortV1;
  readonly usage: AccountUsagePortV1;
  readonly managedKey: AccountManagedKeyPortV1;
  readonly configuration: AccountConfigurationPortV1;
}

export type GatewayFieldMappingV1 = Readonly<
  Record<AccountGatewayFieldV1, AccountCapabilityKeyV1 | null>
>;
