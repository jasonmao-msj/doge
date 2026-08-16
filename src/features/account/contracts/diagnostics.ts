import {
  BROKER_CAPABILITY_FRESHNESS_V1,
  BROKER_CONFIGURATION_STATES_V1,
  BROKER_LIFECYCLE_STATES_V1,
} from "./broker";
import { ACCOUNT_FAILURE_CODES_V1 } from "./semantic";
import { validateAccountSafeArtifactV1 } from "./privacy";
import type { SchemaIssueV1, SchemaValidationV1 } from "./schema";
import {
  isEnumValueV1,
  isNonNegativeIntegerV1,
  isRecordV1,
  isRfc3339UtcV1,
  issueV1,
  validateExactKeysV1,
  validationV1,
} from "./schema";

export const ACCOUNT_DIAGNOSTIC_CONTRACT_V1 = {
  id: "doge-account-diagnostic",
  version: "1.0.0",
} as const;

export const ACCOUNT_SUPPORT_BUNDLE_CONTRACT_V1 = {
  id: "doge-account-support-bundle",
  version: "1.0.0",
} as const;

export type AccountDiagnosticSnapshotV1 = {
  readonly contractId: typeof ACCOUNT_DIAGNOSTIC_CONTRACT_V1.id;
  readonly contractVersion: typeof ACCOUNT_DIAGNOSTIC_CONTRACT_V1.version;
  readonly observedAt: string;
  readonly lifecycle: (typeof BROKER_LIFECYCLE_STATES_V1)[number];
  readonly accountEpoch: number | null;
  readonly processGeneration: number;
  readonly eventSeq: number;
  readonly capabilityFreshness: (typeof BROKER_CAPABILITY_FRESHNESS_V1)[number];
  readonly configuration: (typeof BROKER_CONFIGURATION_STATES_V1)[number];
  readonly counters: {
    readonly pendingOperations: number;
    readonly wakeupsObserved: number;
    readonly staleResponsesRejected: number;
  };
  readonly lastFailureCode: (typeof ACCOUNT_FAILURE_CODES_V1)[number] | null;
};

export type AccountSupportBundleV1 = {
  readonly contractId: typeof ACCOUNT_SUPPORT_BUNDLE_CONTRACT_V1.id;
  readonly contractVersion: typeof ACCOUNT_SUPPORT_BUNDLE_CONTRACT_V1.version;
  readonly generatedAt: string;
  readonly diagnostic: AccountDiagnosticSnapshotV1;
  readonly persistenceState: "healthy" | "quarantined" | "unavailable";
  readonly localMode: "available";
};

export function validateAccountDiagnosticSnapshotV1(
  value: unknown,
): SchemaValidationV1<AccountDiagnosticSnapshotV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected diagnostic snapshot object")] };
  }
  validateExactKeysV1(value, [
    "contractId", "contractVersion", "observedAt", "lifecycle", "accountEpoch",
    "processGeneration", "eventSeq", "capabilityFreshness", "configuration", "counters",
    "lastFailureCode",
  ], [], "$", issues);
  if (value.contractId !== ACCOUNT_DIAGNOSTIC_CONTRACT_V1.id ||
    value.contractVersion !== ACCOUNT_DIAGNOSTIC_CONTRACT_V1.version
  ) issues.push(issueV1("$.contractVersion", "enum", "unsupported diagnostic contract"));
  if (!isRfc3339UtcV1(value.observedAt)) issues.push(issueV1("$.observedAt", "format", "invalid strict UTC time"));
  validateEnumV1(value.lifecycle, BROKER_LIFECYCLE_STATES_V1, "$.lifecycle", issues);
  if (value.accountEpoch !== null && !isNonNegativeIntegerV1(value.accountEpoch)) {
    issues.push(issueV1("$.accountEpoch", "range", "invalid account epoch"));
  }
  validateIntegerV1(value.processGeneration, 1, "$.processGeneration", issues);
  validateIntegerV1(value.eventSeq, 0, "$.eventSeq", issues);
  validateEnumV1(value.capabilityFreshness, BROKER_CAPABILITY_FRESHNESS_V1, "$.capabilityFreshness", issues);
  validateEnumV1(value.configuration, BROKER_CONFIGURATION_STATES_V1, "$.configuration", issues);
  if (!isRecordV1(value.counters)) {
    issues.push(issueV1("$.counters", "type", "expected exact diagnostic counters"));
  } else {
    validateExactKeysV1(value.counters, ["pendingOperations", "wakeupsObserved", "staleResponsesRejected"], [], "$.counters", issues);
    validateIntegerV1(value.counters.pendingOperations, 0, "$.counters.pendingOperations", issues);
    validateIntegerV1(value.counters.wakeupsObserved, 0, "$.counters.wakeupsObserved", issues);
    validateIntegerV1(value.counters.staleResponsesRejected, 0, "$.counters.staleResponsesRejected", issues);
  }
  if (value.lastFailureCode !== null && !isEnumValueV1(value.lastFailureCode, ACCOUNT_FAILURE_CODES_V1)) {
    issues.push(issueV1("$.lastFailureCode", "enum", "unknown diagnostic failure code"));
  }
  addPrivacyIssuesV1(value, issues);
  return validationV1(value as AccountDiagnosticSnapshotV1, issues);
}

export function validateAccountSupportBundleV1(
  value: unknown,
): SchemaValidationV1<AccountSupportBundleV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected support bundle object")] };
  }
  validateExactKeysV1(value, ["contractId", "contractVersion", "generatedAt", "diagnostic", "persistenceState", "localMode"], [], "$", issues);
  if (value.contractId !== ACCOUNT_SUPPORT_BUNDLE_CONTRACT_V1.id ||
    value.contractVersion !== ACCOUNT_SUPPORT_BUNDLE_CONTRACT_V1.version
  ) issues.push(issueV1("$.contractVersion", "enum", "unsupported support bundle contract"));
  if (!isRfc3339UtcV1(value.generatedAt)) issues.push(issueV1("$.generatedAt", "format", "invalid strict UTC time"));
  const diagnostic = validateAccountDiagnosticSnapshotV1(value.diagnostic);
  if (!diagnostic.ok) {
    issues.push(...diagnostic.issues.map((entry) => ({ ...entry, path: `$.diagnostic${entry.path === "$" ? "" : entry.path.slice(1)}` })));
  }
  validateEnumV1(value.persistenceState, ["healthy", "quarantined", "unavailable"], "$.persistenceState", issues);
  if (value.localMode !== "available") issues.push(issueV1("$.localMode", "invariant", "support bundle cannot gate Local Mode"));
  addPrivacyIssuesV1(value, issues);
  return validationV1(value as AccountSupportBundleV1, issues);
}

function validateEnumV1<const T extends readonly string[]>(value: unknown, allowed: T, path: string, issues: SchemaIssueV1[]): void {
  if (!isEnumValueV1(value, allowed)) issues.push(issueV1(path, "enum", "unknown closed diagnostic value"));
}

function validateIntegerV1(value: unknown, minimum: number, path: string, issues: SchemaIssueV1[]): void {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) issues.push(issueV1(path, "range", `expected safe integer >= ${minimum}`));
}

function addPrivacyIssuesV1(value: unknown, issues: SchemaIssueV1[]): void {
  const privacy = validateAccountSafeArtifactV1(value);
  if (!privacy.ok) issues.push(...privacy.issues);
}
