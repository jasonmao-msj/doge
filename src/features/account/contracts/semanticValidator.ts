import type {
  AccountSessionViewV1,
  GatewayFailureV1,
  QuotaMeasureV1,
  QuotaUsageViewV1,
  UsageDayModelsViewV1,
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
      "range",
      "engines",
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
  validateUsageRangeV1(value.range, "$.range", issues);
  if (!Array.isArray(value.engines)) {
    issues.push(issueV1("$.engines", "type", "expected engine usage array"));
  } else {
    const engineIds = new Set<string>();
    value.engines.forEach((engine, index) => {
      validateSubscriptionEngineUsageV1(engine, `$.engines[${index}]`, issues);
      if (isRecordV1(engine) && typeof engine.engineId === "string") {
        if (engineIds.has(engine.engineId)) {
          issues.push(issueV1(`$.engines[${index}].engineId`, "duplicate", "duplicate engine usage"));
        }
        engineIds.add(engine.engineId);
      }
    });
  }
  if (value.status === "available" && (!Array.isArray(value.engines) || value.engines.length === 0)) {
    issues.push(issueV1("$.engines", "invariant", "available usage requires an entitled engine"));
  }
  const privacy = validateAccountSafeArtifactV1(value);
  if (!privacy.ok) {
    issues.push(...privacy.issues);
  }
  return validationV1(value as QuotaUsageViewV1, issues);
}

export function validateUsageDayModelsViewV1(
  value: unknown,
): SchemaValidationV1<UsageDayModelsViewV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected day model usage object")] };
  }
  validateKeysV1(value, ["engineId", "date", "models"], "$", issues);
  validateManagedUsageEngineIdV1(value.engineId, "$.engineId", issues);
  validateIsoDateV1(value.date, "$.date", issues);
  if (!Array.isArray(value.models)) {
    issues.push(issueV1("$.models", "type", "expected model usage array"));
  } else {
    value.models.forEach((model, index) => {
      validateUsageModelV1(model, `$.models[${index}]`, issues);
    });
  }
  const privacy = validateAccountSafeArtifactV1(value);
  if (!privacy.ok) issues.push(...privacy.issues);
  return validationV1(value as UsageDayModelsViewV1, issues);
}

function validateUsageRangeV1(value: unknown, path: string, issues: SchemaIssueV1[]): void {
  if (value === null) return;
  if (!isRecordV1(value)) {
    issues.push(issueV1(path, "type", "expected null or usage range"));
    return;
  }
  validateKeysV1(value, ["startDate", "endDate", "days"], path, issues);
  validateIsoDateV1(value.startDate, `${path}.startDate`, issues);
  validateIsoDateV1(value.endDate, `${path}.endDate`, issues);
  if (!isNonNegativeIntegerV1(value.days) || value.days < 1 || value.days > 366) {
    issues.push(issueV1(`${path}.days`, "range", "expected usage range between 1 and 366 days"));
  }
}

function validateSubscriptionEngineUsageV1(
  value: unknown,
  path: string,
  issues: SchemaIssueV1[],
): void {
  if (!isRecordV1(value)) {
    issues.push(issueV1(path, "type", "expected engine usage object"));
    return;
  }
  validateKeysV1(value, [
    "engineId", "engineLabel", "subscriptionLabel", "expiresAt", "analyticsStatus",
    "windows", "totals", "days", "models",
  ], path, issues);
  validateManagedUsageEngineIdV1(value.engineId, `${path}.engineId`, issues);
  for (const key of ["engineLabel", "subscriptionLabel"] as const) {
    if (typeof value[key] !== "string" || value[key].length === 0 || value[key].length > 80) {
      issues.push(issueV1(`${path}.${key}`, "format", "expected safe non-empty label"));
    }
  }
  if (value.expiresAt !== null && !isRfc3339UtcV1(value.expiresAt)) {
    issues.push(issueV1(`${path}.expiresAt`, "format", "expected null or RFC 3339 UTC timestamp"));
  }
  if (value.analyticsStatus !== "available" && value.analyticsStatus !== "unavailable") {
    issues.push(issueV1(`${path}.analyticsStatus`, "enum", "unknown analytics status"));
  }
  if (!isRecordV1(value.windows)) {
    issues.push(issueV1(`${path}.windows`, "type", "expected usage windows"));
  } else {
    validateKeysV1(value.windows, ["daily", "weekly", "monthly"], `${path}.windows`, issues);
    for (const key of ["daily", "weekly", "monthly"] as const) {
      validateUsageWindowV1(value.windows[key], `${path}.windows.${key}`, issues);
    }
  }
  validateUsageTotalsV1(value.totals, `${path}.totals`, issues);
  if (!Array.isArray(value.days)) {
    issues.push(issueV1(`${path}.days`, "type", "expected daily usage array"));
  } else {
    const dates = new Set<string>();
    value.days.forEach((day, index) => {
      const dayPath = `${path}.days[${index}]`;
      if (!isRecordV1(day)) {
        issues.push(issueV1(dayPath, "type", "expected daily usage object"));
        return;
      }
      validateKeysV1(day, [
        "date", "intensity", "requests", "inputTokens", "outputTokens", "cacheReadTokens",
        "cacheWriteTokens", "totalTokens", "cost", "actualCost",
      ], dayPath, issues);
      validateIsoDateV1(day.date, `${dayPath}.date`, issues);
      if (!isNonNegativeIntegerV1(day.intensity) || day.intensity > 4) {
        issues.push(issueV1(`${dayPath}.intensity`, "range", "expected intensity from 0 to 4"));
      }
      validateUsageTotalsV1(day, dayPath, issues);
      if (typeof day.date === "string") {
        if (dates.has(day.date)) issues.push(issueV1(`${dayPath}.date`, "duplicate", "duplicate usage date"));
        dates.add(day.date);
      }
    });
  }
  if (!Array.isArray(value.models)) {
    issues.push(issueV1(`${path}.models`, "type", "expected model usage array"));
  } else {
    value.models.forEach((model, index) => validateUsageModelV1(model, `${path}.models[${index}]`, issues));
  }
}

function validateUsageWindowV1(value: unknown, path: string, issues: SchemaIssueV1[]): void {
  if (value === null) return;
  if (!isRecordV1(value)) {
    issues.push(issueV1(path, "type", "expected null or usage window"));
    return;
  }
  validateKeysV1(value, ["limit", "used", "remaining", "percentage", "resetsAt"], path, issues);
  validateQuotaMeasureV1(value.limit, `${path}.limit`, issues);
  validateQuotaMeasureV1(value.used, `${path}.used`, issues);
  validateQuotaMeasureV1(value.remaining, `${path}.remaining`, issues);
  if (!isCanonicalDecimalStringV1(value.percentage)) {
    issues.push(issueV1(`${path}.percentage`, "format", "expected canonical percentage"));
  }
  if (!isRfc3339UtcV1(value.resetsAt)) {
    issues.push(issueV1(`${path}.resetsAt`, "format", "expected RFC 3339 UTC timestamp"));
  }
}

function validateUsageModelV1(value: unknown, path: string, issues: SchemaIssueV1[]): void {
  if (!isRecordV1(value)) {
    issues.push(issueV1(path, "type", "expected model usage object"));
    return;
  }
  validateKeysV1(value, [
    "modelLabel", "requests", "inputTokens", "outputTokens", "cacheReadTokens",
    "cacheWriteTokens", "totalTokens", "cost", "actualCost",
  ], path, issues);
  if (typeof value.modelLabel !== "string" || value.modelLabel.length === 0 || value.modelLabel.length > 80) {
    issues.push(issueV1(`${path}.modelLabel`, "format", "expected safe model label"));
  }
  validateUsageTotalsV1(value, path, issues);
}

function validateUsageTotalsV1(value: unknown, path: string, issues: SchemaIssueV1[]): void {
  if (!isRecordV1(value)) {
    issues.push(issueV1(path, "type", "expected usage totals object"));
    return;
  }
  for (const key of [
    "requests", "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "totalTokens",
  ] as const) {
    if (!isNonNegativeIntegerV1(value[key])) {
      issues.push(issueV1(`${path}.${key}`, "range", "expected non-negative safe integer"));
    }
  }
  validateQuotaMeasureV1(value.cost, `${path}.cost`, issues);
  validateQuotaMeasureV1(value.actualCost, `${path}.actualCost`, issues);
}

function validateManagedUsageEngineIdV1(value: unknown, path: string, issues: SchemaIssueV1[]): void {
  if (value !== "codex" && value !== "claude-code") {
    issues.push(issueV1(path, "enum", "unknown managed usage engine"));
  }
}

function validateIsoDateV1(value: unknown, path: string, issues: SchemaIssueV1[]): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    issues.push(issueV1(path, "format", "expected YYYY-MM-DD date"));
    return;
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    issues.push(issueV1(path, "format", "expected valid calendar date"));
  }
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
