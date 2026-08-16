import {
  ACCOUNT_GATEWAY_EVENT_KINDS_V1,
  ACCOUNT_GATEWAY_OPERATION_NAMES_V1,
  type GatewayOperationNameV1,
} from "./gateway";
import { ACCOUNT_CAPABILITY_KEYS_V1 } from "./semantic";
import type { RuntimeSchemaV1 } from "./schema";

const literal = (value: string | number | boolean | null): RuntimeSchemaV1 => ({
  kind: "literal",
  value,
});
const text = (maxLength = 256): RuntimeSchemaV1 => ({ kind: "string", minLength: 1, maxLength });
const safeLabel = (field: string): RuntimeSchemaV1 => ({ kind: "safeLabel", field });
const safeText = (field: string): RuntimeSchemaV1 => ({ kind: "safeText", field });
const secretInput: RuntimeSchemaV1 = { kind: "secretInput" };
const timestamp: RuntimeSchemaV1 = { kind: "timestamp" };
const integer: RuntimeSchemaV1 = { kind: "integer", minimum: 0 };
const boolean: RuntimeSchemaV1 = { kind: "boolean" };
const nullable = (inner: RuntimeSchemaV1): RuntimeSchemaV1 => ({ kind: "nullable", inner });
const enumV1 = (values: readonly string[]): RuntimeSchemaV1 => ({ kind: "enum", values });
const array = (item: RuntimeSchemaV1, minItems?: number): RuntimeSchemaV1 => ({
  kind: "array",
  item,
  ...(minItems === undefined ? {} : { minItems }),
});
const object = (
  required: Readonly<Record<string, RuntimeSchemaV1>>,
  optional: Readonly<Record<string, RuntimeSchemaV1>> = {},
): RuntimeSchemaV1 => ({ kind: "object", required, optional });
const union = (
  discriminator: string,
  variants: Readonly<Record<string, RuntimeSchemaV1>>,
): RuntimeSchemaV1 => ({ kind: "union", discriminator, variants });
const handle = (
  handleKind: string,
  purpose: string | readonly string[],
): RuntimeSchemaV1 => ({ kind: "handle", handleKind, purpose });

const NULL_V1 = literal(null);
const emailInput: RuntimeSchemaV1 = { kind: "emailInput" };
const OAUTH_PROVIDERS_V1 = [
  "auth.oauth.github",
  "auth.oauth.google",
  "auth.oauth.linuxdo",
  "auth.oauth.wechat",
  "auth.oauth.oidc",
  "auth.oauth.dingtalk",
] as const;
const AUTH_REQUIREMENTS_V1 = ["email", "invitation", "mfa", "bindConfirmation"] as const;

const capabilityAvailabilityV1 = union("status", {
  enabled: object({ status: literal("enabled") }),
  disabled: object({
    status: literal("disabled"),
    reason: enumV1([
      "serverDisabled",
      "serverGuaranteeMissing",
      "desktopUnsupported",
      "platformUnverified",
      "featureFlagOff",
      "vaultUnavailable",
    ]),
  }),
  unknown: object({
    status: literal("unknown"),
    reason: enumV1(["loading", "offline", "serviceUnavailable"]),
  }),
});

const sessionV1 = union("status", {
  signedOut: object({ status: literal("signedOut") }),
  authenticated: object({
    status: literal("authenticated"),
    accountEpoch: integer,
    sessionCapability: literal("persistent"),
    profileLabel: safeLabel("profileDisplayName"),
    primaryEmailLabel: nullable(safeLabel("primaryEmailLabel")),
  }),
  expired: object({
    status: literal("expired"),
    previousProfileLabel: nullable(safeLabel("profileDisplayName")),
  }),
  revoked: object({
    status: literal("revoked"),
    previousProfileLabel: nullable(safeLabel("profileDisplayName")),
  }),
});

const authenticatedSessionV1 = object({
  status: literal("authenticated"),
  accountEpoch: integer,
  sessionCapability: literal("persistent"),
  profileLabel: safeLabel("profileDisplayName"),
  primaryEmailLabel: nullable(safeLabel("primaryEmailLabel")),
});

const capabilitiesV1 = object({
  contractVersion: literal("1.0.0"),
  observedAt: timestamp,
  freshness: enumV1(["fresh", "softStale", "hardExpired"]),
  entries: {
    kind: "record",
    allowedKeys: ACCOUNT_CAPABILITY_KEYS_V1,
    value: capabilityAvailabilityV1,
  },
  registration: object({
    emailSuffixHint: nullable(safeLabel("primaryEmailLabel")),
    invitationCode: enumV1(["hidden", "optional", "required"]),
    promoCode: enumV1(["hidden", "optional"]),
    agreementRequired: boolean,
    humanVerificationRequired: boolean,
  }),
});

const bootstrapV1 = object({
  localMode: object({
    status: literal("available"),
    blockedByAccount: literal(false),
    accountFailureCanGateLocalMode: literal(false),
  }),
  gatewayAvailability: enumV1(["ready", "offline", "serviceUnavailable"]),
  vault: enumV1(["ready", "locked", "unavailable", "inconsistent"]),
  capabilities: capabilitiesV1,
  session: sessionV1,
});

const authNextV1 = union("next", {
  verification: object({
    next: literal("verification"),
    attempt: handle("auth-attempt", "registration"),
    emailLabel: safeLabel("primaryEmailLabel"),
    resendAt: timestamp,
  }),
  mfa: object({
    next: literal("mfa"),
    attempt: handle("auth-attempt", "mfa"),
    expiresAt: timestamp,
  }),
  oauthWaiting: object({
    next: literal("oauthWaiting"),
    attempt: handle("oauth-attempt", "oauth"),
    providerLabel: safeLabel("providerLabel"),
    expiresAt: timestamp,
  }),
  oauthAccountCompletion: object({
    next: literal("oauthAccountCompletion"),
    attempt: handle("auth-attempt", "oauth-completion"),
    requirements: array(enumV1(AUTH_REQUIREMENTS_V1), 1),
  }),
  resetRequested: object({
    next: literal("resetRequested"),
    requestAccepted: literal(true),
  }),
  passwordResetReady: object({
    next: literal("passwordResetReady"),
    intent: handle("external-intent", "password-reset"),
    expiresAt: timestamp,
  }),
  passwordResetCompleted: object({
    next: literal("passwordResetCompleted"),
    reset: literal(true),
    nextAction: literal("login"),
  }),
  authenticated: object({
    next: literal("authenticated"),
    session: authenticatedSessionV1,
  }),
});

const oauthAttemptV1 = union("status", {
  waiting: object({
    status: literal("waiting"),
    attempt: handle("oauth-attempt", "oauth"),
    expiresAt: timestamp,
  }),
  completionRequired: object({
    status: literal("completionRequired"),
    attempt: handle("auth-attempt", "oauth-completion"),
    requirements: array(enumV1(AUTH_REQUIREMENTS_V1), 1),
  }),
  authenticated: object({ status: literal("authenticated"), session: authenticatedSessionV1 }),
  cancelled: object({ status: literal("cancelled") }),
  expired: object({ status: literal("expired") }),
  denied: object({ status: literal("denied") }),
});

const accountCenterV1 = object({
  profile: object({
    displayName: safeLabel("profileDisplayName"),
    primaryEmailLabel: safeLabel("primaryEmailLabel"),
    avatarKind: enumV1(["doge", "initials"]),
  }),
  security: object({
    totp: enumV1(["enabled", "disabled", "unavailable"]),
    passwordChange: enumV1(["available", "unavailable"]),
    identityBindings: array(object({
      provider: enumV1(OAUTH_PROVIDERS_V1),
      status: enumV1(["bound", "available", "unavailable"]),
    })),
  }),
});

const quotaMeasureV1 = object({
  value: { kind: "decimal" },
  unit: enumV1(["requests", "credits", "tokens", "usd"]),
});
const quotaV1 = object({
  status: enumV1(["available", "unavailable"]),
  source: enumV1([
    "token2apiAccount",
    "token2apiPlatformQuota",
    "token2apiSubscription",
  ]),
  freshness: enumV1(["fresh", "softStale", "hardExpired"]),
  observedAt: nullable(timestamp),
  fetchedAt: nullable(timestamp),
  remaining: nullable(quotaMeasureV1),
  used: nullable(quotaMeasureV1),
  resetsAt: nullable(timestamp),
  subscriptionLabel: nullable(safeLabel("subscriptionLabel")),
});

const managedKeyV1 = union("status", {
  absent: object({ status: literal("absent") }),
  ready: object({
    status: literal("ready"),
    recipeId: literal("doge.account.codex-token-service"),
    recipeVersion: literal(1),
  }),
  attention: object({
    status: literal("attention"),
    action: enumV1(["rotate", "reprovision", "revoke"]),
  }),
  unavailable: object({
    status: literal("unavailable"),
    reason: enumV1(["capabilityUnavailable", "vaultUnavailable"]),
  }),
});

const apiKeyCandidatesV1 = object({
  keys: array(object({
    key: handle("api-key-candidate", "codex-api-key"),
    name: safeLabel("targetLabel"),
    maskedPrefix: safeLabel("maskedPresentation"),
    status: enumV1(["active", "disabled", "expired"]),
    availability: enumV1(["selectable", "handoffUnavailable"]),
  })),
  fetchedAt: timestamp,
});

const configOfferV1 = union("status", {
  notEligible: object({
    status: literal("notEligible"),
    reason: enumV1(["notAuthenticated", "capabilityUnavailable"]),
  }),
  none: object({ status: literal("none") }),
  available: object({
    status: literal("available"),
    recipeId: literal("doge.account.codex-token-service"),
    recipeVersion: literal(1),
    targetLabel: safeLabel("targetLabel"),
    recommendation: enumV1([
      "configure",
      "preserve",
      "reviewConflict",
      "alreadyConfigured",
    ]),
  }),
});

const configPlanV1 = object({
  plan: handle("config-plan", "codex-configuration"),
  recipeId: literal("doge.account.codex-token-service"),
  recipeVersion: literal(1),
  targetLabel: safeLabel("targetLabel"),
  expiresAt: timestamp,
  summary: enumV1(["changesPlanned", "noop", "blocked"]),
  files: array(object({
    file: handle("config-file", "codex-configuration"),
    targetLabel: safeLabel("targetLabel"),
    outcome: enumV1(["willChange", "unchanged", "blocked"]),
  })),
});

const safePresentedValueV1 = union("kind", {
  absent: object({ kind: literal("absent") }),
  boolean: object({ kind: literal("boolean"), value: boolean }),
  number: object({ kind: literal("number"), value: { kind: "integer" } }),
  enum: object({ kind: literal("enum"), label: safeLabel("fieldLabel") }),
  safeText: object({ kind: literal("safeText"), text: safeText("configurationValue") }),
  redacted: object({
    kind: literal("redacted"),
    label: enumV1(["managedCredential", "userValue", "sensitiveValue"]),
  }),
});

const configFileDetailV1 = object({
  file: handle("config-file", "codex-configuration"),
  targetLabel: safeLabel("targetLabel"),
  sections: array(object({
    label: safeLabel("fieldLabel"),
    entries: array(object({
      kind: enumV1(["add", "remove", "change", "context"]),
      fieldLabel: safeLabel("fieldLabel"),
      before: safePresentedValueV1,
      after: safePresentedValueV1,
    })),
  })),
});

const configResultV1 = object({
  result: handle("config-result", "codex-configuration"),
  overall: enumV1(["unchanged", "applied", "rolledBack", "rollbackIncomplete", "aborted"]),
  files: array(object({
    targetLabel: safeLabel("targetLabel"),
    outcome: enumV1([
      "unchanged",
      "applied",
      "rolledBack",
      "rollbackFailed",
      "skippedPrecondition",
      "failedBeforeWrite",
    ]),
  })),
  reload: object({
    requirement: enumV1(["none", "newSessions", "restartRequired"]),
    status: enumV1(["notNeeded", "pending", "applied", "failed"]),
  }),
  verification: enumV1(["notRequired", "pending", "usable", "failed"]),
  acknowledged: boolean,
});

const reconciliationV1 = union("status", {
  pending: object({ status: literal("pending") }),
  knownTerminal: object({
    status: literal("knownTerminal"),
    operation: enumV1(ACCOUNT_GATEWAY_OPERATION_NAMES_V1),
    outcome: enumV1(["succeeded", "rejected", "cancelledBeforeSend"]),
  }),
  outcomeUnknown: object({
    status: literal("outcomeUnknown"),
    operation: enumV1(ACCOUNT_GATEWAY_OPERATION_NAMES_V1),
  }),
});

const humanRequirementV1 = union("status", {
  notRequired: object({ status: literal("notRequired") }),
  required: object({
    status: literal("required"),
    provider: literal("turnstile"),
    siteKey: safeText("configurationValue"),
    action: safeLabel("fieldLabel"),
  }),
  unavailable: object({
    status: literal("unavailable"),
    reason: enumV1(["offline", "platformUnsupported", "providerUnavailable"]),
  }),
});

const recipeRefV1 = object({
  recipeId: literal("doge.account.codex-token-service"),
  recipeVersion: literal(1),
});
const oauthProviderV1 = object({ provider: enumV1(OAUTH_PROVIDERS_V1) });
const verificationChoiceV1 = union("kind", {
  password: object({ kind: literal("password"), value: secretInput }),
  emailCode: object({ kind: literal("emailCode"), value: secretInput }),
});

export type AccountIpcOperationRuntimeSchemaV1 = {
  readonly request: RuntimeSchemaV1;
  readonly result: RuntimeSchemaV1;
};

export const ACCOUNT_IPC_OPERATION_SCHEMAS_V1: Readonly<
  Record<GatewayOperationNameV1, AccountIpcOperationRuntimeSchemaV1>
> = {
  "gateway.bootstrap": { request: NULL_V1, result: bootstrapV1 },
  "gateway.reconcileIntent": {
    request: object({
      intent: { kind: "opaqueId", prefix: "intent" },
      expected: enumV1(ACCOUNT_GATEWAY_OPERATION_NAMES_V1),
    }),
    result: reconciliationV1,
  },
  "humanVerification.readRequirement": {
    request: object({ purpose: enumV1(["register", "login", "registrationCode", "passwordReset"]) }),
    result: humanRequirementV1,
  },
  "humanVerification.submitProof": {
    request: object({
      purpose: enumV1(["register", "login", "registrationCode", "passwordReset"]),
      proof: secretInput,
    }),
    result: object({
      verification: handle("human-verification", ["register", "login", "registration-code", "password-reset"]),
      expiresAt: timestamp,
    }),
  },
  "auth.beginRegistration": {
    request: object({
      email: emailInput,
      password: secretInput,
      agreementAccepted: boolean,
    }, {
      invitationCode: secretInput,
      promoCode: text(64),
      humanVerification: handle("human-verification", "register"),
    }),
    result: authNextV1,
  },
  "auth.resendRegistrationCode": {
    request: object({ attempt: handle("auth-attempt", "registration") }, {
      humanVerification: handle("human-verification", "registration-code"),
    }),
    result: authNextV1,
  },
  "auth.submitRegistrationCode": {
    request: object({
      attempt: handle("auth-attempt", "registration"),
      code: secretInput,
    }),
    result: authNextV1,
  },
  "auth.login": {
    request: object({ email: emailInput, password: secretInput }, {
      humanVerification: handle("human-verification", "login"),
    }),
    result: authNextV1,
  },
  "auth.verifyMfa": {
    request: object({ attempt: handle("auth-attempt", "mfa"), code: secretInput }),
    result: authNextV1,
  },
  "auth.startOAuth": { request: oauthProviderV1, result: authNextV1 },
  "auth.cancelOAuth": {
    request: object({ attempt: handle("oauth-attempt", "oauth") }),
    result: object({ cancelled: literal(true) }),
  },
  "auth.readOAuthAttempt": {
    request: object({ attempt: handle("oauth-attempt", "oauth") }),
    result: oauthAttemptV1,
  },
  "auth.completeOAuthAccount": {
    request: object({ attempt: handle("auth-attempt", "oauth-completion") }, {
      email: emailInput,
      invitationCode: secretInput,
      mfaCode: secretInput,
      bindConfirmed: boolean,
    }),
    result: authNextV1,
  },
  "auth.requestPasswordReset": {
    request: object({ email: emailInput }, {
      humanVerification: handle("human-verification", "password-reset"),
    }),
    result: authNextV1,
  },
  "auth.inspectExternalIntent": {
    request: object({ intent: handle("external-intent", "password-reset") }),
    result: authNextV1,
  },
  "auth.resetPassword": {
    request: object({
      intent: handle("external-intent", "password-reset"),
      newPassword: secretInput,
    }),
    result: authNextV1,
  },
  "auth.logout": {
    request: object({ scope: enumV1(["thisDevice", "allSessions"]) }),
    result: object({
      localSessionCleared: literal(true),
      remoteRevocation: enumV1(["confirmed", "unconfirmed"]),
    }),
  },
  "profile.read": { request: NULL_V1, result: accountCenterV1 },
  "profile.updateProfile": {
    request: object({ displayName: safeLabel("profileDisplayName") }),
    result: accountCenterV1,
  },
  "profile.changePassword": {
    request: object({ currentPassword: secretInput, newPassword: secretInput }),
    result: object({ changed: literal(true) }),
  },
  "profile.requestTotpEmailCode": {
    request: NULL_V1,
    result: object({ resendAt: timestamp }),
  },
  "profile.beginTotpEnrollment": {
    request: object({ verification: verificationChoiceV1 }),
    result: object({
      enrollment: handle("auth-attempt", "totp-enrollment"),
      presentation: object({
        delivery: literal("oneTime"),
        qrSvg: { kind: "oneTimeTotp" },
        manualSecret: nullable({ kind: "oneTimeTotp" }),
        expiresAt: timestamp,
      }),
    }),
  },
  "profile.confirmTotpEnrollment": {
    request: object({
      enrollment: handle("auth-attempt", "totp-enrollment"),
      code: secretInput,
    }),
    result: object({ enabled: literal(true) }),
  },
  "profile.disableTotp": {
    request: object({ verification: verificationChoiceV1 }),
    result: object({ disabled: literal(true) }),
  },
  "profile.startIdentityBinding": { request: oauthProviderV1, result: authNextV1 },
  "profile.unbindIdentity": {
    request: oauthProviderV1,
    result: object({ unbound: literal(true) }),
  },
  "profile.revokeAllSessions": {
    request: object({ consent: literal("revokeAllSessions") }),
    result: object({ remoteRevocation: enumV1(["confirmed", "outcomeUnknown"]) }),
  },
  "usage.read": { request: NULL_V1, result: quotaV1 },
  "managedKey.readStatus": { request: recipeRefV1, result: managedKeyV1 },
  "managedKey.listCandidates": { request: recipeRefV1, result: apiKeyCandidatesV1 },
  "managedKey.selectExisting": {
    request: object({
      recipeId: literal("doge.account.codex-token-service"),
      recipeVersion: literal(1),
      key: handle("api-key-candidate", "codex-api-key"),
      consent: literal("useSelectedApiKey"),
    }),
    result: managedKeyV1,
  },
  "managedKey.provision": {
    request: object({
      recipeId: literal("doge.account.codex-token-service"),
      recipeVersion: literal(1),
      consent: literal("provisionDedicatedKey"),
    }),
    result: managedKeyV1,
  },
  "managedKey.rotate": {
    request: object({
      recipeId: literal("doge.account.codex-token-service"),
      recipeVersion: literal(1),
      consent: literal("rotateDedicatedKey"),
    }),
    result: managedKeyV1,
  },
  "managedKey.revoke": {
    request: object({
      recipeId: literal("doge.account.codex-token-service"),
      recipeVersion: literal(1),
      consent: literal("removeLocalKey"),
    }),
    result: managedKeyV1,
  },
  "configuration.readOffer": { request: NULL_V1, result: configOfferV1 },
  "configuration.createPlan": {
    request: object({
      recipeId: literal("doge.account.codex-token-service"),
      recipeVersion: literal(1),
      intent: enumV1(["configure", "review"]),
    }),
    result: configPlanV1,
  },
  "configuration.readFileDetail": {
    request: object({
      plan: handle("config-plan", "codex-configuration"),
      file: handle("config-file", "codex-configuration"),
    }),
    result: configFileDetailV1,
  },
  "configuration.apply": {
    request: object({
      plan: handle("config-plan", "codex-configuration"),
      consent: literal("applyExactPlan"),
    }),
    result: configResultV1,
  },
  "configuration.readCurrentTask": {
    request: NULL_V1,
    result: { kind: "anyOf", variants: [configOfferV1, configPlanV1, configResultV1] },
  },
  "configuration.acknowledgeResult": {
    request: object({ result: handle("config-result", "codex-configuration") }),
    result: object({ acknowledged: literal(true) }),
  },
  "configuration.hardDismiss": {
    request: recipeRefV1,
    result: object({ dismissed: literal(true) }),
  },
};

export const ACCOUNT_IPC_EVENT_SCHEMAS_V1: Readonly<
  Record<(typeof ACCOUNT_GATEWAY_EVENT_KINDS_V1)[number], RuntimeSchemaV1>
> = {
  sessionChanged: object({
    kind: literal("sessionChanged"),
    eventId: { kind: "opaqueId", prefix: "event" },
    emittedAt: timestamp,
    processGeneration: { kind: "integer", minimum: 1 },
    eventSeq: { kind: "integer", minimum: 0 },
    accountEpoch: nullable(integer),
  }),
  capabilitiesChanged: object({
    kind: literal("capabilitiesChanged"),
    eventId: { kind: "opaqueId", prefix: "event" },
    emittedAt: timestamp,
    processGeneration: { kind: "integer", minimum: 1 },
    eventSeq: { kind: "integer", minimum: 0 },
    accountEpoch: nullable(integer),
  }),
  oauthAttemptChanged: object({
    kind: literal("oauthAttemptChanged"),
    eventId: { kind: "opaqueId", prefix: "event" },
    emittedAt: timestamp,
    processGeneration: { kind: "integer", minimum: 1 },
    eventSeq: { kind: "integer", minimum: 0 },
    accountEpoch: nullable(integer),
    attempt: handle("oauth-attempt", "oauth"),
  }),
  externalIntentReady: object({
    kind: literal("externalIntentReady"),
    eventId: { kind: "opaqueId", prefix: "event" },
    emittedAt: timestamp,
    processGeneration: { kind: "integer", minimum: 1 },
    eventSeq: { kind: "integer", minimum: 0 },
    accountEpoch: nullable(integer),
    intent: handle("external-intent", "password-reset"),
    purpose: literal("passwordReset"),
  }),
  usageInvalidated: object({
    kind: literal("usageInvalidated"),
    eventId: { kind: "opaqueId", prefix: "event" },
    emittedAt: timestamp,
    processGeneration: { kind: "integer", minimum: 1 },
    eventSeq: { kind: "integer", minimum: 0 },
    accountEpoch: integer,
  }),
  configurationTaskChanged: object({
    kind: literal("configurationTaskChanged"),
    eventId: { kind: "opaqueId", prefix: "event" },
    emittedAt: timestamp,
    processGeneration: { kind: "integer", minimum: 1 },
    eventSeq: { kind: "integer", minimum: 0 },
    accountEpoch: nullable(integer),
  }),
};

export type AccountIpcOperationRuntimeSchemasV1 = {
  readonly request: RuntimeSchemaV1;
  readonly result: RuntimeSchemaV1;
  /** Closed wakeup union only; an event never carries operation result truth. */
  readonly event: RuntimeSchemaV1;
};

const eventWakeupUnionV1: RuntimeSchemaV1 = {
  kind: "anyOf",
  variants: ACCOUNT_GATEWAY_EVENT_KINDS_V1.map((kind) => ACCOUNT_IPC_EVENT_SCHEMAS_V1[kind]),
};

export const ACCOUNT_IPC_OPERATION_RUNTIME_SCHEMAS_V1: Readonly<
  Record<GatewayOperationNameV1, AccountIpcOperationRuntimeSchemasV1>
> = Object.fromEntries(
  ACCOUNT_GATEWAY_OPERATION_NAMES_V1.map((operation) => [
    operation,
    {
      request: ACCOUNT_IPC_OPERATION_SCHEMAS_V1[operation].request,
      result: ACCOUNT_IPC_OPERATION_SCHEMAS_V1[operation].result,
      event: eventWakeupUnionV1,
    },
  ]),
) as Readonly<Record<GatewayOperationNameV1, AccountIpcOperationRuntimeSchemasV1>>;
