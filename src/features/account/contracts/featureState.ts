import type { SchemaIssueV1, SchemaValidationV1 } from "./schema";
import {
  isEnumValueV1,
  isNonNegativeIntegerV1,
  isRecordV1,
  issueV1,
  validateExactKeysV1,
  validationV1,
} from "./schema";
import { LOCAL_MODE_INVARIANT_V1 } from "./semantic";

export const ACCOUNT_FEATURE_MODULE_STATES_V1 = [
  "disabled", "booting", "ready", "unavailable",
] as const;
export const ACCOUNT_FEATURE_LIFECYCLES_V1 = [
  "signedOut", "authorizing", "authenticated", "expiring", "revoking",
] as const;
export const ACCOUNT_FEATURE_VAULT_STATES_V1 = [
  "ready", "locked", "unavailable", "inconsistent",
] as const;
export const ACCOUNT_FEATURE_CONNECTIVITY_STATES_V1 = [
  "online", "offline", "serviceUnavailable",
] as const;
export const ACCOUNT_FEATURE_CAPABILITY_FRESHNESS_V1 = [
  "unknown", "fresh", "softStale", "hardExpired",
] as const;
export const ACCOUNT_FEATURE_AUTH_FLOW_STATES_V1 = [
  "landing", "login", "register", "registrationVerification", "mfa",
  "forgotPassword", "resetRequested", "resetPassword", "oauthWaiting",
  "oauthAccountCompletion",
] as const;
export const ACCOUNT_FEATURE_USAGE_STATES_V1 = [
  "idle", "loading", "ready", "stale", "error",
] as const;
export const ACCOUNT_FEATURE_CONFIGURATION_STATES_V1 = [
  "idle", "offer", "planning", "planReady", "applying", "result", "attention",
  "acknowledged", "hardDismissed",
] as const;

export type AccountFeatureStateV1 = {
  readonly module: (typeof ACCOUNT_FEATURE_MODULE_STATES_V1)[number];
  readonly localMode: typeof LOCAL_MODE_INVARIANT_V1;
  readonly lifecycle: (typeof ACCOUNT_FEATURE_LIFECYCLES_V1)[number];
  readonly sessionCapability: "none" | "persistent";
  readonly vault: (typeof ACCOUNT_FEATURE_VAULT_STATES_V1)[number];
  readonly connectivity: (typeof ACCOUNT_FEATURE_CONNECTIVITY_STATES_V1)[number];
  readonly capabilityFreshness: (typeof ACCOUNT_FEATURE_CAPABILITY_FRESHNESS_V1)[number];
  readonly accountEpoch: number | null;
  readonly processGeneration: number;
  readonly authFlow: {
    readonly state: (typeof ACCOUNT_FEATURE_AUTH_FLOW_STATES_V1)[number];
    readonly generation: number;
  };
  readonly usage: {
    readonly state: (typeof ACCOUNT_FEATURE_USAGE_STATES_V1)[number];
    readonly generation: number;
    readonly hasValue: boolean;
  };
  readonly configuration: {
    readonly state: (typeof ACCOUNT_FEATURE_CONFIGURATION_STATES_V1)[number];
    readonly generation: number;
    readonly unread: boolean;
  };
};

export function validateAccountFeatureStateV1(
  value: unknown,
): SchemaValidationV1<AccountFeatureStateV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected AccountFeatureStateV1 object")] };
  }
  validateExactKeysV1(value, [
    "module", "localMode", "lifecycle", "sessionCapability", "vault", "connectivity",
    "capabilityFreshness", "accountEpoch", "processGeneration", "authFlow", "usage",
    "configuration",
  ], [], "$", issues);
  validateEnumV1(value.module, ACCOUNT_FEATURE_MODULE_STATES_V1, "$.module", issues);
  validateEnumV1(value.lifecycle, ACCOUNT_FEATURE_LIFECYCLES_V1, "$.lifecycle", issues);
  validateEnumV1(value.sessionCapability, ["none", "persistent"], "$.sessionCapability", issues);
  validateEnumV1(value.vault, ACCOUNT_FEATURE_VAULT_STATES_V1, "$.vault", issues);
  validateEnumV1(value.connectivity, ACCOUNT_FEATURE_CONNECTIVITY_STATES_V1, "$.connectivity", issues);
  validateEnumV1(value.capabilityFreshness, ACCOUNT_FEATURE_CAPABILITY_FRESHNESS_V1, "$.capabilityFreshness", issues);
  if (!isRecordV1(value.localMode)) {
    issues.push(issueV1("$.localMode", "type", "expected Local Mode invariant"));
  } else {
    validateExactKeysV1(value.localMode, ["status", "blockedByAccount", "accountFailureCanGateLocalMode"], [], "$.localMode", issues);
    if (value.localMode.status !== "available" || value.localMode.blockedByAccount !== false || value.localMode.accountFailureCanGateLocalMode !== false) {
      issues.push(issueV1("$.localMode", "invariant", "Account state cannot gate Local Mode"));
    }
  }
  if (value.accountEpoch !== null && !isNonNegativeIntegerV1(value.accountEpoch)) {
    issues.push(issueV1("$.accountEpoch", "range", "expected null or non-negative account epoch"));
  }
  validatePositiveIntegerV1(value.processGeneration, "$.processGeneration", issues);
  validateStateObjectV1(value.authFlow, "$.authFlow", ACCOUNT_FEATURE_AUTH_FLOW_STATES_V1, issues, true);
  validateResourceStateV1(value.usage, "$.usage", ACCOUNT_FEATURE_USAGE_STATES_V1, issues, "hasValue");
  validateResourceStateV1(value.configuration, "$.configuration", ACCOUNT_FEATURE_CONFIGURATION_STATES_V1, issues, "unread");

  const durableLifecycle = value.lifecycle === "authenticated" || value.lifecycle === "expiring" || value.lifecycle === "revoking";
  if (durableLifecycle && (value.sessionCapability !== "persistent" || !isNonNegativeIntegerV1(value.accountEpoch))) {
    issues.push(issueV1("$.sessionCapability", "invariant", "durable lifecycle requires persistent capability and account epoch"));
  }
  if (!durableLifecycle && value.sessionCapability !== "none") {
    issues.push(issueV1("$.sessionCapability", "invariant", "signed-out/authorizing lifecycle cannot claim persistent session"));
  }
  if (value.lifecycle === "signedOut" && value.accountEpoch !== null) {
    issues.push(issueV1("$.accountEpoch", "invariant", "signed-out state clears account epoch"));
  }
  const activeAuthFlows = new Set(["registrationVerification", "mfa", "resetPassword", "oauthWaiting", "oauthAccountCompletion"]);
  if (isRecordV1(value.authFlow) && activeAuthFlows.has(String(value.authFlow.state)) && value.lifecycle !== "authorizing") {
    issues.push(issueV1("$.authFlow.state", "invariant", "active auth flow requires authorizing lifecycle"));
  }
  if (value.module === "disabled" && value.lifecycle !== "signedOut") {
    issues.push(issueV1("$.module", "invariant", "disabled Account module must remain signed out"));
  }
  if (isRecordV1(value.usage) && value.usage.state === "stale" && value.usage.hasValue !== true) {
    issues.push(issueV1("$.usage.hasValue", "invariant", "stale usage must retain last-known value"));
  }
  if (isRecordV1(value.configuration) && value.configuration.state === "applying" && value.module !== "ready") {
    issues.push(issueV1("$.configuration.state", "invariant", "configuration apply requires ready Account module"));
  }
  return validationV1(value as AccountFeatureStateV1, issues);
}

export function acceptsAccountFeatureLaneSettlementV1(
  currentGeneration: number,
  settlementGeneration: number,
): boolean {
  return Number.isSafeInteger(currentGeneration) && currentGeneration >= 1 &&
    Number.isSafeInteger(settlementGeneration) &&
    settlementGeneration === currentGeneration;
}

function validateStateObjectV1<const T extends readonly string[]>(
  value: unknown,
  path: string,
  states: T,
  issues: SchemaIssueV1[],
  includeGeneration: boolean,
): void {
  if (!isRecordV1(value)) {
    issues.push(issueV1(path, "type", "expected state object"));
    return;
  }
  validateExactKeysV1(value, includeGeneration ? ["state", "generation"] : ["state"], [], path, issues);
  validateEnumV1(value.state, states, `${path}.state`, issues);
  if (includeGeneration) validatePositiveIntegerV1(value.generation, `${path}.generation`, issues);
}

function validateResourceStateV1<const T extends readonly string[]>(
  value: unknown,
  path: string,
  states: T,
  issues: SchemaIssueV1[],
  booleanKey: "hasValue" | "unread",
): void {
  if (!isRecordV1(value)) {
    issues.push(issueV1(path, "type", "expected resource state object"));
    return;
  }
  validateExactKeysV1(value, ["state", "generation", booleanKey], [], path, issues);
  validateEnumV1(value.state, states, `${path}.state`, issues);
  validatePositiveIntegerV1(value.generation, `${path}.generation`, issues);
  if (typeof value[booleanKey] !== "boolean") issues.push(issueV1(`${path}.${booleanKey}`, "type", "expected boolean state flag"));
}

function validatePositiveIntegerV1(value: unknown, path: string, issues: SchemaIssueV1[]): void {
  if (!Number.isSafeInteger(value) || Number(value) < 1) issues.push(issueV1(path, "range", "expected positive safe integer"));
}

function validateEnumV1<const T extends readonly string[]>(value: unknown, allowed: T, path: string, issues: SchemaIssueV1[]): void {
  if (!isEnumValueV1(value, allowed)) issues.push(issueV1(path, "enum", "unknown closed Account feature state"));
}
