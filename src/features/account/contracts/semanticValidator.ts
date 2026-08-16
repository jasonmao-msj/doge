import type {
  AccountSessionViewV1,
  GatewayFailureV1,
  QuotaMeasureV1,
  QuotaUsageViewV1,
} from "./semantic";
import {
  ACCOUNT_FAILURE_CODES_V1,
  ACCOUNT_FAILURE_STAGES_V1,
  ACCOUNT_FRESHNESS_STATES_V1,
  ACCOUNT_GATEWAY_FIELDS_V1,
} from "./semantic";
import {
  ACCOUNT_GATEWAY_EVENT_KINDS_V1,
  type AccountGatewayEventV1,
} from "./gateway";
import type { SchemaIssueV1, SchemaValidationV1 } from "./schema";
import {
  isCanonicalDecimalStringV1,
  isEnumValueV1,
  isNonNegativeIntegerV1,
  isOpaqueSafeIdV1,
  isRecordV1,
  isRfc3339UtcV1,
  issueV1,
  validateKeysV1,
  validationV1,
} from "./schema";
import { validateAccountSafeArtifactV1 } from "./privacy";

const RECOVERY_ACTIONS_V1 = [
  "none",
  "retry",
  "editInput",
  "requestNewCode",
  "requestNewLink",
  "loginAgain",
  "openBrowser",
  "unlockVault",
  "replan",
  "reviewFiles",
  "reconcile",
  "useLocalMode",
  "contactSupport",
] as const;

export function validateGatewayFailureV1(
  value: unknown,
): SchemaValidationV1<GatewayFailureV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected Gateway failure object")] };
  }
  validateKeysV1(value, ["code", "stage", "recovery"], "$", issues);
  if (!isEnumValueV1(value.code, ACCOUNT_FAILURE_CODES_V1)) {
    issues.push(issueV1("$.code", "enum", "unknown Gateway failure code"));
  }
  if (!isEnumValueV1(value.stage, ACCOUNT_FAILURE_STAGES_V1)) {
    issues.push(issueV1("$.stage", "enum", "unknown Gateway failure stage"));
  }
  validateRecoveryV1(value.recovery, issues);
  const privacy = validateAccountSafeArtifactV1(value);
  if (!privacy.ok) {
    issues.push(...privacy.issues);
  }
  return validationV1(value as GatewayFailureV1, issues);
}

export function validateAccountSessionViewV1(
  value: unknown,
): SchemaValidationV1<AccountSessionViewV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected Account session object")] };
  }
  switch (value.status) {
    case "signedOut":
      validateKeysV1(value, ["status"], "$", issues);
      break;
    case "authenticated":
      validateKeysV1(
        value,
        ["status", "accountEpoch", "sessionCapability", "profileLabel", "primaryEmailLabel"],
        "$",
        issues,
      );
      if (!isNonNegativeIntegerV1(value.accountEpoch)) {
        issues.push(issueV1("$.accountEpoch", "range", "expected non-negative account epoch"));
      }
      if (value.sessionCapability !== "persistent") {
        issues.push(issueV1("$.sessionCapability", "invariant", "authenticated session must be OS-vault-backed persistent"));
      }
      if (typeof value.profileLabel !== "string" || value.profileLabel.length === 0) {
        issues.push(issueV1("$.profileLabel", "format", "expected non-empty profile label"));
      }
      if (value.primaryEmailLabel !== null && typeof value.primaryEmailLabel !== "string") {
        issues.push(issueV1("$.primaryEmailLabel", "type", "expected null or presentation label"));
      }
      break;
    case "expired":
    case "revoked":
      validateKeysV1(value, ["status", "previousProfileLabel"], "$", issues);
      if (value.previousProfileLabel !== null && typeof value.previousProfileLabel !== "string") {
        issues.push(issueV1("$.previousProfileLabel", "type", "expected null or prior presentation label"));
      }
      break;
    default:
      issues.push(issueV1("$.status", "enum", "unknown Account session state"));
  }
  const privacy = validateAccountSafeArtifactV1(value);
  if (!privacy.ok) {
    issues.push(...privacy.issues);
  }
  return validationV1(value as AccountSessionViewV1, issues);
}

function validateRecoveryV1(value: unknown, issues: SchemaIssueV1[]): void {
  if (!isRecordV1(value) || !isEnumValueV1(value.action, RECOVERY_ACTIONS_V1)) {
    issues.push(issueV1("$.recovery", "enum", "unknown Gateway recovery"));
    return;
  }
  switch (value.action) {
    case "retry":
    case "requestNewCode":
      validateKeysV1(value, ["action", "afterMs"], "$.recovery", issues);
      if (value.afterMs !== null && !isNonNegativeIntegerV1(value.afterMs)) {
        issues.push(issueV1("$.recovery.afterMs", "range", "expected null or non-negative safe integer"));
      }
      break;
    case "editInput":
      validateKeysV1(value, ["action", "field"], "$.recovery", issues);
      if (!isEnumValueV1(value.field, ACCOUNT_GATEWAY_FIELDS_V1)) {
        issues.push(issueV1("$.recovery.field", "enum", "unknown editable field"));
      }
      break;
    case "reconcile":
      validateKeysV1(value, ["action", "intent"], "$.recovery", issues);
      if (!isOpaqueSafeIdV1(value.intent)) {
        issues.push(issueV1("$.recovery.intent", "format", "invalid Gateway intent id"));
      }
      break;
    default:
      validateKeysV1(value, ["action"], "$.recovery", issues);
  }
}

export function validateQuotaUsageViewV1(
  value: unknown,
): SchemaValidationV1<QuotaUsageViewV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected quota usage object")] };
  }
  validateKeysV1(
    value,
    [
      "status",
      "source",
      "freshness",
      "observedAt",
      "fetchedAt",
      "remaining",
      "used",
      "resetsAt",
      "subscriptionLabel",
    ],
    "$",
    issues,
  );
  if (value.status !== "available" && value.status !== "unavailable") {
    issues.push(issueV1("$.status", "enum", "unknown quota status"));
  }
  if (
    value.source !== "token2apiAccount" &&
    value.source !== "token2apiPlatformQuota" &&
    value.source !== "token2apiSubscription"
  ) {
    issues.push(issueV1("$.source", "enum", "unknown quota source"));
  }
  if (!isEnumValueV1(value.freshness, ACCOUNT_FRESHNESS_STATES_V1)) {
    issues.push(issueV1("$.freshness", "enum", "unknown freshness state"));
  }
  for (const key of ["observedAt", "fetchedAt", "resetsAt"] as const) {
    if (value[key] !== null && !isRfc3339UtcV1(value[key])) {
      issues.push(issueV1(`$.${key}`, "format", "expected null or RFC 3339 UTC timestamp"));
    }
  }
  validateQuotaMeasureV1(value.remaining, "$.remaining", issues);
  validateQuotaMeasureV1(value.used, "$.used", issues);
  if (value.subscriptionLabel !== null && typeof value.subscriptionLabel !== "string") {
    issues.push(issueV1("$.subscriptionLabel", "type", "expected null or presentation string"));
  }
  if (value.status === "available" && value.fetchedAt === null) {
    issues.push(issueV1("$.fetchedAt", "invariant", "available quota requires broker fetch time"));
  }
  const privacy = validateAccountSafeArtifactV1(value);
  if (!privacy.ok) {
    issues.push(...privacy.issues);
  }
  return validationV1(value as QuotaUsageViewV1, issues);
}

function validateQuotaMeasureV1(
  value: unknown,
  path: string,
  issues: SchemaIssueV1[],
): void {
  if (value === null) {
    return;
  }
  if (!isRecordV1(value)) {
    issues.push(issueV1(path, "type", "expected null or quota measure"));
    return;
  }
  validateKeysV1(value, ["value", "unit"], path, issues);
  if (!isCanonicalDecimalStringV1(value.value)) {
    issues.push(issueV1(`${path}.value`, "format", "expected canonical non-negative decimal string"));
  }
  if (value.unit !== "requests" && value.unit !== "credits" && value.unit !== "tokens" && value.unit !== "usd") {
    issues.push(issueV1(`${path}.unit`, "enum", "unknown quota unit"));
  }
}

export function validateAccountGatewayEventV1(
  value: unknown,
): SchemaValidationV1<AccountGatewayEventV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected Account event object")] };
  }
  if (!isEnumValueV1(value.kind, ACCOUNT_GATEWAY_EVENT_KINDS_V1)) {
    issues.push(issueV1("$.kind", "enum", "unknown Account event kind"));
  }
  if (typeof value.eventId !== "string" || value.eventId.length === 0) {
    issues.push(issueV1("$.eventId", "format", "expected event id"));
  }
  if (!isRfc3339UtcV1(value.emittedAt)) {
    issues.push(issueV1("$.emittedAt", "format", "expected RFC 3339 UTC timestamp"));
  }
  if (!isNonNegativeIntegerV1(value.processGeneration) || value.processGeneration < 1) {
    issues.push(issueV1("$.processGeneration", "range", "expected positive process generation"));
  }
  if (!isNonNegativeIntegerV1(value.eventSeq)) {
    issues.push(issueV1("$.eventSeq", "range", "expected non-negative event sequence"));
  }
  const baseKeys = ["kind", "eventId", "emittedAt", "processGeneration", "eventSeq", "accountEpoch"];
  switch (value.kind) {
    case "sessionChanged":
      validateKeysV1(value, baseKeys, "$", issues);
      if (value.accountEpoch !== null && !isNonNegativeIntegerV1(value.accountEpoch)) {
        issues.push(issueV1("$.accountEpoch", "range", "expected null or non-negative account epoch"));
      }
      break;
    case "oauthAttemptChanged":
      validateKeysV1(value, [...baseKeys, "attempt"], "$", issues);
      if (!isOpaqueSafeIdV1(value.attempt)) {
        issues.push(issueV1("$.attempt", "format", "invalid OAuth attempt handle"));
      }
      break;
    case "externalIntentReady":
      validateKeysV1(value, [...baseKeys, "intent", "purpose"], "$", issues);
      if (!isOpaqueSafeIdV1(value.intent) || value.purpose !== "passwordReset") {
        issues.push(issueV1("$.intent", "format", "invalid password-reset external intent"));
      }
      break;
    case "usageInvalidated":
      validateKeysV1(value, baseKeys, "$", issues);
      if (!isNonNegativeIntegerV1(value.accountEpoch)) {
        issues.push(issueV1("$.accountEpoch", "range", "expected non-negative account epoch"));
      }
      break;
    case "capabilitiesChanged":
    case "configurationTaskChanged":
      validateKeysV1(value, baseKeys, "$", issues);
      if (value.accountEpoch !== null && !isNonNegativeIntegerV1(value.accountEpoch)) {
        issues.push(issueV1("$.accountEpoch", "range", "expected null or non-negative account epoch"));
      }
      break;
    default:
      break;
  }
  const privacy = validateAccountSafeArtifactV1(value);
  if (!privacy.ok) {
    issues.push(...privacy.issues);
  }
  return validationV1(value as AccountGatewayEventV1, issues);
}

export function isQuotaMeasureV1(value: unknown): value is QuotaMeasureV1 {
  const issues: SchemaIssueV1[] = [];
  validateQuotaMeasureV1(value, "$", issues);
  return issues.length === 0 && value !== null;
}
