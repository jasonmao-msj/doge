/**
 * Canonical, renderer-safe Account Convenience semantics.
 *
 * This module deliberately contains no wire DTOs, persistence entities, URLs,
 * filesystem locations, raw messages, or credentials. Changes to a closed
 * union are breaking unless capability negotiation proves an old consumer can
 * never receive the new member.
 */

export const ACCOUNT_CONTRACT_VERSION_V1 = "1.0.0" as const;

export const ACCOUNT_SEMANTIC_CONTRACT_V1 = {
  id: "doge-account-semantic",
  version: ACCOUNT_CONTRACT_VERSION_V1,
} as const;

export const ACCOUNT_GATEWAY_CONTRACT_V1 = {
  id: "doge-account-gateway",
  version: ACCOUNT_CONTRACT_VERSION_V1,
} as const;

export const ACCOUNT_IPC_CONTRACT_V1 = {
  id: "doge-account-ipc",
  version: ACCOUNT_CONTRACT_VERSION_V1,
} as const;

export const ACCOUNT_BROKER_CONTRACT_V1 = {
  id: "doge-account-broker",
  version: ACCOUNT_CONTRACT_VERSION_V1,
} as const;

export const TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1 = {
  id: "token2api-account-authority",
  version: ACCOUNT_CONTRACT_VERSION_V1,
} as const;

export const DOGE_CONFIG_RECIPE_CONTRACT_V1 = {
  id: "doge-config-recipe",
  version: ACCOUNT_CONTRACT_VERSION_V1,
} as const;

export const ACCOUNT_CONTRACT_FIXTURE_V1 = {
  id: "doge-account-contract-fixture",
  version: ACCOUNT_CONTRACT_VERSION_V1,
} as const;

export const CODEX_TOKEN_SERVICE_RECIPE_V1 = {
  id: "doge.account.codex-token-service",
  version: 1,
} as const;

export const ACCOUNT_PERSISTENCE_SCHEMA_V1 = {
  id: "doge-account-persistence",
  version: 1,
} as const;

export type AccountContractRefV1 =
  | typeof ACCOUNT_SEMANTIC_CONTRACT_V1
  | typeof ACCOUNT_GATEWAY_CONTRACT_V1
  | typeof ACCOUNT_IPC_CONTRACT_V1
  | typeof ACCOUNT_BROKER_CONTRACT_V1
  | typeof TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1
  | typeof DOGE_CONFIG_RECIPE_CONTRACT_V1
  | typeof ACCOUNT_CONTRACT_FIXTURE_V1;

declare const opaqueAccountIdBrand: unique symbol;
type OpaqueAccountIdV1<Kind extends string> = string & {
  readonly [opaqueAccountIdBrand]: Kind;
};

/** Stable across retry/reconcile for one user action. */
export type GatewayIntentIdV1 = OpaqueAccountIdV1<"gateway-intent">;
/** Unique to one frontend-to-IPC attempt; diagnostics only. */
export type TransportRequestIdV1 = OpaqueAccountIdV1<"transport-request">;
/** Broker-created durable idempotency identity; never product state. */
export type BrokerOperationIdV1 = OpaqueAccountIdV1<"broker-operation">;

export type AuthAttemptHandleV1 = OpaqueAccountIdV1<"auth-attempt">;
export type OAuthAttemptHandleV1 = OpaqueAccountIdV1<"oauth-attempt">;
export type ExternalIntentHandleV1 = OpaqueAccountIdV1<"external-intent">;
export type HumanVerificationHandleV1 = OpaqueAccountIdV1<"human-verification">;
export type ApiKeyCandidateHandleV1 = OpaqueAccountIdV1<"api-key-candidate">;
export type ConfigPlanHandleV1 = OpaqueAccountIdV1<"config-plan">;
export type ConfigFileHandleV1 = OpaqueAccountIdV1<"config-file">;
export type ConfigResultHandleV1 = OpaqueAccountIdV1<"config-result">;

export type AccountHandleKindV1 =
  | "auth-attempt"
  | "oauth-attempt"
  | "external-intent"
  | "human-verification"
  | "api-key-candidate"
  | "config-plan"
  | "config-file"
  | "config-result";

export type AccountHandleBindingV1 = {
  readonly purpose: string;
  readonly accountEpoch: number;
  readonly processGeneration: number;
  readonly expiresAtEpochSeconds: number;
};

const OPAQUE_ACCOUNT_ID_PATTERN_V1 = /^[a-z][a-z0-9-]{1,31}_[A-Za-z0-9_-]{6,96}$/;

function checkedOpaqueIdV1<Kind extends string>(
  value: string,
  expectedPrefix: string,
): OpaqueAccountIdV1<Kind> {
  if (!OPAQUE_ACCOUNT_ID_PATTERN_V1.test(value) || !value.startsWith(`${expectedPrefix}_`)) {
    throw new Error(`Invalid opaque Account v1 ${expectedPrefix} id`);
  }
  return value as OpaqueAccountIdV1<Kind>;
}

export function gatewayIntentIdV1(value: string): GatewayIntentIdV1 {
  return checkedOpaqueIdV1(value, "intent");
}

export function transportRequestIdV1(value: string): TransportRequestIdV1 {
  return checkedOpaqueIdV1(value, "request");
}

export function brokerOperationIdV1(value: string): BrokerOperationIdV1 {
  return checkedOpaqueIdV1(value, "operation");
}

function accountHandleV1<Kind extends AccountHandleKindV1>(
  kind: Kind,
  binding: AccountHandleBindingV1,
  nonce: string,
): OpaqueAccountIdV1<Kind> {
  if (
    !/^[a-z][a-z0-9-]{1,31}$/.test(binding.purpose) ||
    !Number.isSafeInteger(binding.accountEpoch) || binding.accountEpoch < 0 ||
    !Number.isSafeInteger(binding.processGeneration) || binding.processGeneration < 1 ||
    !Number.isSafeInteger(binding.expiresAtEpochSeconds) || binding.expiresAtEpochSeconds < 1 ||
    !/^[A-Za-z0-9_-]{8,64}$/.test(nonce)
  ) {
    throw new Error(`Invalid bound Account v1 ${kind} handle`);
  }
  return `handle~${kind}~${binding.purpose}~e${binding.accountEpoch}~g${binding.processGeneration}~x${binding.expiresAtEpochSeconds}~${nonce}` as OpaqueAccountIdV1<Kind>;
}

export function authAttemptHandleV1(
  binding: AccountHandleBindingV1,
  nonce: string,
): AuthAttemptHandleV1 {
  return accountHandleV1("auth-attempt", binding, nonce);
}

export function oauthAttemptHandleV1(
  binding: AccountHandleBindingV1,
  nonce: string,
): OAuthAttemptHandleV1 {
  return accountHandleV1("oauth-attempt", binding, nonce);
}

export function externalIntentHandleV1(
  binding: AccountHandleBindingV1,
  nonce: string,
): ExternalIntentHandleV1 {
  return accountHandleV1("external-intent", binding, nonce);
}

export function humanVerificationHandleV1(
  binding: AccountHandleBindingV1,
  nonce: string,
): HumanVerificationHandleV1 {
  return accountHandleV1("human-verification", binding, nonce);
}

export function apiKeyCandidateHandleV1(
  binding: AccountHandleBindingV1,
  nonce: string,
): ApiKeyCandidateHandleV1 {
  return accountHandleV1("api-key-candidate", binding, nonce);
}

export function configPlanHandleV1(
  binding: AccountHandleBindingV1,
  nonce: string,
): ConfigPlanHandleV1 {
  return accountHandleV1("config-plan", binding, nonce);
}

export function configFileHandleV1(
  binding: AccountHandleBindingV1,
  nonce: string,
): ConfigFileHandleV1 {
  return accountHandleV1("config-file", binding, nonce);
}

export function configResultHandleV1(
  binding: AccountHandleBindingV1,
  nonce: string,
): ConfigResultHandleV1 {
  return accountHandleV1("config-result", binding, nonce);
}

declare const transientSecretBrand: unique symbol;
/** Form-local only. Never persist, trace, fixture, stringify, or return. */
export type SecretInputV1 = string & {
  readonly [transientSecretBrand]: "transient-secret-input";
};

export const ACCOUNT_CAPABILITY_KEYS_V1 = [
  "auth.emailPasswordLogin",
  "auth.registration",
  "auth.registrationEmailVerification",
  "auth.passwordReset",
  "auth.humanVerification",
  "auth.mfa",
  "auth.oauth.github",
  "auth.oauth.google",
  "auth.oauth.linuxdo",
  "auth.oauth.wechat",
  "auth.oauth.oidc",
  "auth.oauth.dingtalk",
  "account.profile",
  "account.passwordChange",
  "account.totp",
  "account.identityBindings",
  "account.revokeAllSessions",
  "usage.quotaPull",
  "subscription.summary",
  "managedKey.listCandidates",
  "managedKey.selectExisting",
  "managedKey.provision",
  "managedKey.rotate",
  "managedKey.revoke",
  "configuration.plan",
  "configuration.apply",
  "recipe.codex.v1",
] as const;

export type AccountCapabilityKeyV1 = (typeof ACCOUNT_CAPABILITY_KEYS_V1)[number];
export type OAuthProviderCapabilityKeyV1 = Extract<
  AccountCapabilityKeyV1,
  `auth.oauth.${string}`
>;

export const ACCOUNT_MODULE_STATES_V1 = [
  "disabled",
  "booting",
  "ready",
  "unavailable",
] as const;
export type AccountModuleStateV1 = (typeof ACCOUNT_MODULE_STATES_V1)[number];

export const ACCOUNT_CONNECTIVITY_STATES_V1 = [
  "online",
  "offline",
  "serviceUnavailable",
] as const;
export type AccountConnectivityStateV1 =
  (typeof ACCOUNT_CONNECTIVITY_STATES_V1)[number];

export const ACCOUNT_VAULT_STATES_V1 = [
  "ready",
  "locked",
  "unavailable",
  "inconsistent",
] as const;
export type AccountVaultStateV1 = (typeof ACCOUNT_VAULT_STATES_V1)[number];

export const ACCOUNT_FRESHNESS_STATES_V1 = [
  "fresh",
  "softStale",
  "hardExpired",
] as const;
export type AccountFreshnessV1 = (typeof ACCOUNT_FRESHNESS_STATES_V1)[number];

export const ACCOUNT_FAILURE_CODES_V1 = [
  "cancelled",
  "offline",
  "serviceUnavailable",
  "capabilityUnavailable",
  "contractUnsupported",
  "rateLimited",
  "validationRejected",
  "credentialsRejected",
  "accountNotAllowed",
  "humanVerificationRejected",
  "humanVerificationExpired",
  "verificationRejected",
  "verificationExpired",
  "mfaRejected",
  "mfaExpired",
  "oauthStateMismatch",
  "oauthDenied",
  "externalIntentInvalid",
  "externalIntentExpired",
  "externalIntentConsumed",
  "sessionExpired",
  "sessionRevoked",
  "vaultLocked",
  "vaultUnavailable",
  "vaultInconsistent",
  "staleAccountEpoch",
  "stalePlan",
  "concurrentEdit",
  "permissionDenied",
  "unsafeTarget",
  "rollbackIncomplete",
  "outcomeUnknown",
  "protocolMismatch",
  "unknownSafeFailure",
] as const;
export type AccountFailureCodeV1 = (typeof ACCOUNT_FAILURE_CODES_V1)[number];

export const ACCOUNT_FAILURE_STAGES_V1 = [
  "capabilities",
  "challenge",
  "register",
  "verifyEmail",
  "login",
  "mfa",
  "oauth",
  "recover",
  "reset",
  "refresh",
  "logout",
  "profile",
  "security",
  "usage",
  "subscription",
  "managedKey",
  "configurationPlan",
  "configurationApply",
  "reload",
  "vault",
  "persistence",
] as const;
export type AccountFailureStageV1 = (typeof ACCOUNT_FAILURE_STAGES_V1)[number];

export const ACCOUNT_GATEWAY_FIELDS_V1 = [
  "email",
  "password",
  "code",
  "invitation",
  "promo",
] as const;
export type AccountGatewayFieldV1 = (typeof ACCOUNT_GATEWAY_FIELDS_V1)[number];

export type GatewayRecoveryV1 =
  | { readonly action: "none" }
  | { readonly action: "retry"; readonly afterMs: number | null }
  | { readonly action: "editInput"; readonly field: AccountGatewayFieldV1 }
  | { readonly action: "requestNewCode"; readonly afterMs: number | null }
  | { readonly action: "requestNewLink" }
  | { readonly action: "loginAgain" }
  | { readonly action: "openBrowser" }
  | { readonly action: "unlockVault" }
  | { readonly action: "replan" }
  | { readonly action: "reviewFiles" }
  | { readonly action: "reconcile"; readonly intent: GatewayIntentIdV1 }
  | { readonly action: "useLocalMode" }
  | { readonly action: "contactSupport" };

export type GatewayFailureV1 = {
  readonly code: AccountFailureCodeV1;
  readonly stage: AccountFailureStageV1;
  readonly recovery: GatewayRecoveryV1;
};

export type GatewayResultV1<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: GatewayFailureV1 };

export const BROKER_TERMINAL_OUTCOMES_V1 = [
  "succeeded",
  "rejected",
  "cancelledBeforeSend",
  "outcomeUnknown",
] as const;
export type BrokerTerminalOutcomeV1 =
  (typeof BROKER_TERMINAL_OUTCOMES_V1)[number];

export const BROKER_AUTHORITY_SCOPES_V1 = [
  "notContacted",
  "contacted",
  "confirmed",
  "reconciliationPending",
] as const;
export type BrokerAuthorityScopeV1 =
  (typeof BROKER_AUTHORITY_SCOPES_V1)[number];

export const BROKER_SESSION_EFFECTS_V1 = [
  "unchanged",
  "activated",
  "refreshed",
  "locallyCleared",
  "remotelyRevoked",
] as const;
export type BrokerSessionEffectV1 = (typeof BROKER_SESSION_EFFECTS_V1)[number];

export const ACCOUNT_TERMINAL_TRUTHS_V1 = [
  "nonterminal",
  "succeeded",
  "rejected",
  "cancelledBeforeSend",
  "outcomeUnknown",
  "locallyCompleteRemoteUnconfirmed",
] as const;
export type AccountTerminalTruthV1 =
  (typeof ACCOUNT_TERMINAL_TRUTHS_V1)[number];

export type LocalModeInvariantV1 = {
  readonly status: "available";
  readonly blockedByAccount: false;
  readonly accountFailureCanGateLocalMode: false;
};

export const LOCAL_MODE_INVARIANT_V1: LocalModeInvariantV1 = {
  status: "available",
  blockedByAccount: false,
  accountFailureCanGateLocalMode: false,
};

export const ACCOUNT_SECRET_CLASSES_V1 = [
  "accessCredential",
  "refreshCredential",
  "password",
  "verificationCode",
  "totpCode",
  "totpSeed",
  "desktopTicket",
  "resetCredential",
  "pkceVerifier",
  "humanVerificationProof",
  "managedApiKey",
  "authorizationHeader",
  "cookie",
] as const;
export type AccountSecretClassV1 = (typeof ACCOUNT_SECRET_CLASSES_V1)[number];

export type AccountSessionViewV1 =
  | { readonly status: "signedOut" }
  | {
      readonly status: "authenticated";
      readonly accountEpoch: number;
      readonly sessionCapability: "persistent";
      readonly profileLabel: string;
      readonly primaryEmailLabel: string | null;
    }
  | {
      readonly status: "expired" | "revoked";
      readonly previousProfileLabel: string | null;
    };

export type AccountCapabilityAvailabilityV1 =
  | { readonly status: "enabled" }
  | {
      readonly status: "disabled";
      readonly reason:
        | "serverDisabled"
        | "serverGuaranteeMissing"
        | "desktopUnsupported"
        | "platformUnverified"
        | "featureFlagOff"
        | "vaultUnavailable";
    }
  | {
      readonly status: "unknown";
      readonly reason: "loading" | "offline" | "serviceUnavailable";
    };

export type AccountCapabilitiesViewV1 = {
  readonly contractVersion: typeof ACCOUNT_CONTRACT_VERSION_V1;
  readonly observedAt: string;
  readonly freshness: AccountFreshnessV1;
  readonly entries: Readonly<
    Partial<Record<AccountCapabilityKeyV1, AccountCapabilityAvailabilityV1>>
  >;
  readonly registration: {
    readonly emailSuffixHint: string | null;
    readonly invitationCode: "hidden" | "optional" | "required";
    readonly promoCode: "hidden" | "optional";
    readonly agreementRequired: boolean;
    readonly humanVerificationRequired: boolean;
  };
};

export type AccountBootstrapViewV1 = {
  readonly localMode: LocalModeInvariantV1;
  readonly gatewayAvailability: "ready" | "offline" | "serviceUnavailable";
  readonly vault: AccountVaultStateV1;
  readonly capabilities: AccountCapabilitiesViewV1;
  readonly session: AccountSessionViewV1;
};

export type QuotaMeasureV1 = {
  /** Canonical non-negative decimal string; never a JS number. */
  readonly value: string;
  readonly unit: "requests" | "credits" | "tokens" | "usd";
};

export type QuotaUsageViewV1 = {
  readonly status: "available" | "unavailable";
  readonly source:
    | "token2apiAccount"
    | "token2apiPlatformQuota"
    | "token2apiSubscription";
  readonly freshness: AccountFreshnessV1;
  readonly observedAt: string | null;
  readonly fetchedAt: string | null;
  readonly remaining: QuotaMeasureV1 | null;
  readonly used: QuotaMeasureV1 | null;
  readonly resetsAt: string | null;
  readonly subscriptionLabel: string | null;
};

export type AccountConvenienceCompatibilityV1 =
  | {
      readonly available: true;
      readonly localMode: LocalModeInvariantV1;
      readonly supportedVersion: typeof ACCOUNT_CONTRACT_VERSION_V1;
    }
  | {
      readonly available: false;
      readonly localMode: LocalModeInvariantV1;
      readonly reason:
        | "contractUnsupported"
        | "capabilityUnavailable"
        | "protocolMismatch";
    };

export function assertAccountNever(value: never): never {
  throw new Error(`Unhandled closed Account v1 variant: ${String(value)}`);
}
