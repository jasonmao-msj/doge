import type {
  BrokerOperationIdV1,
  GatewayIntentIdV1,
  TransportRequestIdV1,
} from "./semantic";
import { ACCOUNT_BROKER_CONTRACT_V1 } from "./semantic";
import type { GatewayOperationNameV1 } from "./gateway";
import { ACCOUNT_GATEWAY_OPERATION_NAMES_V1 } from "./gateway";
import type { SchemaIssueV1, SchemaValidationV1 } from "./schema";
import {
  isEnumValueV1,
  isNonNegativeIntegerV1,
  isOpaqueSafeIdV1,
  isRecordV1,
  issueV1,
  validateExactKeysV1,
  validationV1,
} from "./schema";
import { validateAccountSafeArtifactV1 } from "./privacy";

export const BROKER_NEXT_ACTIONS_V1 = [
  "none",
  "retry",
  "reauthenticate",
  "unlockVault",
  "reconcile",
  "contactSupport",
] as const;
export type BrokerNextActionV1 = (typeof BROKER_NEXT_ACTIONS_V1)[number];

export const BROKER_RECEIPT_STATUSES_V1 = [
  "accepted",
  "pending",
  "succeeded",
  "rejected",
  "cancelledBeforeSend",
  "outcomeUnknown",
] as const;
export type BrokerReceiptStatusV1 = (typeof BROKER_RECEIPT_STATUSES_V1)[number];

export const BROKER_REMOTE_DISPOSITIONS_V1 = [
  "notContacted",
  "pending",
  "confirmed",
  "unconfirmed",
  "reconciliationPending",
] as const;
export type BrokerRemoteDispositionV1 =
  (typeof BROKER_REMOTE_DISPOSITIONS_V1)[number];

export const BROKER_ACTIVATION_STATES_V1 = [
  "unchanged",
  "pendingVaultCommit",
  "persistentActive",
  "locallyCleared",
  "revoked",
] as const;
export type BrokerActivationStateV1 =
  (typeof BROKER_ACTIVATION_STATES_V1)[number];

export const BROKER_LIFECYCLE_STATES_V1 = [
  "received",
  "validated",
  "dispatched",
  "reconciling",
  "terminal",
] as const;
export type BrokerLifecycleStateV1 =
  (typeof BROKER_LIFECYCLE_STATES_V1)[number];

export const BROKER_SESSION_CAPABILITIES_V1 = ["none", "persistent"] as const;
export type BrokerSessionCapabilityV1 =
  (typeof BROKER_SESSION_CAPABILITIES_V1)[number];

export const BROKER_CAPABILITY_FRESHNESS_V1 = [
  "unknown",
  "fresh",
  "softStale",
  "hardExpired",
] as const;
export type BrokerCapabilityFreshnessV1 =
  (typeof BROKER_CAPABILITY_FRESHNESS_V1)[number];

export const BROKER_CONFIGURATION_STATES_V1 = [
  "idle",
  "offerAvailable",
  "planning",
  "planReady",
  "applying",
  "terminal",
  "recoveryRequired",
] as const;
export type BrokerConfigurationStateV1 =
  (typeof BROKER_CONFIGURATION_STATES_V1)[number];

export type BrokerIntentBindingV1 = {
  readonly intentId: GatewayIntentIdV1;
  readonly operationId: BrokerOperationIdV1;
  readonly operation: GatewayOperationNameV1;
  readonly accountEpoch: number;
  readonly processGeneration: number;
  readonly requestFingerprint: string;
};

export type BrokerReceiptV1 = {
  readonly operationId: BrokerOperationIdV1;
  readonly operation: GatewayOperationNameV1;
  readonly status: BrokerReceiptStatusV1;
  readonly remoteDisposition: BrokerRemoteDispositionV1;
  readonly activationState: BrokerActivationStateV1;
  readonly lifecycle: BrokerLifecycleStateV1;
  readonly sessionCapability: BrokerSessionCapabilityV1;
  readonly capabilityFreshness: BrokerCapabilityFreshnessV1;
  readonly configuration: BrokerConfigurationStateV1;
  readonly accountEpoch: number;
  readonly processGeneration: number;
  readonly eventSeq: number;
  readonly nextAction: BrokerNextActionV1;
  readonly safeProjectionHandle: string | null;
};

export type AccountBrokerRequestEnvelopeV1 = {
  readonly contractId: typeof ACCOUNT_BROKER_CONTRACT_V1.id;
  readonly contractVersion: typeof ACCOUNT_BROKER_CONTRACT_V1.version;
  readonly transportRequestId: TransportRequestIdV1;
  readonly intentId: GatewayIntentIdV1;
  readonly operationId: BrokerOperationIdV1;
  readonly operation: GatewayOperationNameV1;
  readonly accountEpoch: number;
  readonly processGeneration: number;
  readonly requestFingerprint: string;
};

export type AccountBrokerResponseEnvelopeV1 = {
  readonly contractId: typeof ACCOUNT_BROKER_CONTRACT_V1.id;
  readonly contractVersion: typeof ACCOUNT_BROKER_CONTRACT_V1.version;
  readonly receipt: BrokerReceiptV1;
};

export type BrokerOrderingSnapshotV1 = {
  readonly accountEpoch: number;
  readonly processGeneration: number;
  readonly eventSeq: number;
};

export type BrokerOperationPolicyV1 = {
  readonly successActivationStates: readonly BrokerActivationStateV1[];
  readonly successRemoteDispositions: readonly BrokerRemoteDispositionV1[];
  readonly successConfigurationStates: readonly BrokerConfigurationStateV1[];
  readonly pendingConfigurationStates: readonly BrokerConfigurationStateV1[];
  readonly uncertaintyConfigurationStates: readonly BrokerConfigurationStateV1[];
};

const SAFE_FINGERPRINT_PATTERN_V1 = /^sha256:[a-f0-9]{64}$/;
const READ_ONLY_OPERATIONS_V1 = new Set<GatewayOperationNameV1>([
  "gateway.bootstrap",
  "gateway.reconcileIntent",
  "humanVerification.readRequirement",
  "auth.readOAuthAttempt",
  "auth.inspectExternalIntent",
  "profile.read",
  "usage.read",
  "managedKey.readStatus",
  "configuration.readOffer",
  "configuration.readFileDetail",
  "configuration.readCurrentTask",
]);
const SESSION_ACTIVATING_OPERATIONS_V1 = new Set<GatewayOperationNameV1>([
  "auth.beginRegistration",
  "auth.submitRegistrationCode",
  "auth.login",
  "auth.verifyMfa",
  "auth.completeOAuthAccount",
]);
const CONFIGURATION_OPERATIONS_V1 = new Set<GatewayOperationNameV1>(
  ACCOUNT_GATEWAY_OPERATION_NAMES_V1.filter((operation) => operation.startsWith("configuration.")),
);

function operationPolicyV1(operation: GatewayOperationNameV1): BrokerOperationPolicyV1 {
  if (operation === "auth.logout") {
    return {
      successActivationStates: ["locallyCleared"],
      successRemoteDispositions: ["confirmed", "unconfirmed"],
      successConfigurationStates: ["idle"],
      pendingConfigurationStates: ["idle"],
      uncertaintyConfigurationStates: ["idle"],
    };
  }
  if (operation === "profile.revokeAllSessions") {
    return {
      successActivationStates: ["revoked"],
      successRemoteDispositions: ["confirmed"],
      successConfigurationStates: ["idle"],
      pendingConfigurationStates: ["idle"],
      uncertaintyConfigurationStates: ["idle"],
    };
  }
  if (operation.startsWith("configuration.")) {
    const successConfigurationStates: readonly BrokerConfigurationStateV1[] =
      operation === "configuration.readOffer"
        ? ["offerAvailable"]
        : operation === "configuration.createPlan" || operation === "configuration.readFileDetail"
          ? ["planReady"]
          : operation === "configuration.readCurrentTask"
            ? ["idle", "offerAvailable", "planning", "planReady", "applying", "terminal", "recoveryRequired"]
            : ["terminal"];
    return {
      successActivationStates: ["unchanged"],
      successRemoteDispositions: ["confirmed"],
      successConfigurationStates,
      pendingConfigurationStates: operation === "configuration.apply" ? ["applying"] : ["planning"],
      uncertaintyConfigurationStates: ["recoveryRequired"],
    };
  }
  return {
    successActivationStates: SESSION_ACTIVATING_OPERATIONS_V1.has(operation)
      ? ["unchanged", "persistentActive"]
      : ["unchanged"],
    successRemoteDispositions: ["confirmed"],
    successConfigurationStates: ["idle"],
    pendingConfigurationStates: ["idle"],
    uncertaintyConfigurationStates: ["idle"],
  };
}

export const ACCOUNT_BROKER_OPERATION_POLICIES_V1: Readonly<
  Record<GatewayOperationNameV1, BrokerOperationPolicyV1>
> = Object.fromEntries(
  ACCOUNT_GATEWAY_OPERATION_NAMES_V1.map((operation) => [operation, operationPolicyV1(operation)]),
) as Readonly<Record<GatewayOperationNameV1, BrokerOperationPolicyV1>>;

const STATUS_MATRIX_V1: Readonly<Record<BrokerReceiptStatusV1, readonly string[]>> = {
  accepted: ["notContacted|unchanged|received", "notContacted|unchanged|validated"],
  pending: ["pending|unchanged|dispatched", "pending|pendingVaultCommit|dispatched"],
  succeeded: [
    "confirmed|unchanged|terminal",
    "unconfirmed|unchanged|terminal",
    "confirmed|persistentActive|terminal",
    "confirmed|locallyCleared|terminal",
    "unconfirmed|locallyCleared|terminal",
    "confirmed|revoked|terminal",
  ],
  rejected: ["notContacted|unchanged|terminal", "confirmed|unchanged|terminal"],
  cancelledBeforeSend: ["notContacted|unchanged|terminal"],
  outcomeUnknown: [
    "reconciliationPending|unchanged|reconciling",
    "reconciliationPending|locallyCleared|reconciling",
  ],
};

export function validateBrokerIntentBindingV1(
  value: unknown,
): SchemaValidationV1<BrokerIntentBindingV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected Broker intent binding object")] };
  }
  validateExactKeysV1(
    value,
    [
      "intentId",
      "operationId",
      "operation",
      "accountEpoch",
      "processGeneration",
      "requestFingerprint",
    ],
    [],
    "$",
    issues,
  );
  validatePrefixedIdV1(value.intentId, "intent", "$.intentId", issues);
  validatePrefixedIdV1(value.operationId, "operation", "$.operationId", issues);
  if (!isEnumValueV1(value.operation, ACCOUNT_GATEWAY_OPERATION_NAMES_V1)) {
    issues.push(issueV1("$.operation", "enum", "unknown closed Broker operation"));
  }
  validateOrderingIntegerV1(value.accountEpoch, 0, "$.accountEpoch", issues);
  validateOrderingIntegerV1(value.processGeneration, 1, "$.processGeneration", issues);
  if (typeof value.requestFingerprint !== "string" || !SAFE_FINGERPRINT_PATTERN_V1.test(value.requestFingerprint)) {
    issues.push(issueV1("$.requestFingerprint", "format", "expected canonical nonsecret SHA-256 fingerprint"));
  }
  return validationV1(value as BrokerIntentBindingV1, issues);
}

export function validateBrokerReceiptV1(
  value: unknown,
): SchemaValidationV1<BrokerReceiptV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected Broker receipt object")] };
  }
  validateExactKeysV1(
    value,
    [
      "operationId",
      "operation",
      "status",
      "remoteDisposition",
      "activationState",
      "lifecycle",
      "sessionCapability",
      "capabilityFreshness",
      "configuration",
      "accountEpoch",
      "processGeneration",
      "eventSeq",
      "nextAction",
      "safeProjectionHandle",
    ],
    [],
    "$",
    issues,
  );
  validatePrefixedIdV1(value.operationId, "operation", "$.operationId", issues);
  validateClosedEnumV1(value.operation, ACCOUNT_GATEWAY_OPERATION_NAMES_V1, "$.operation", issues);
  validateClosedEnumV1(value.status, BROKER_RECEIPT_STATUSES_V1, "$.status", issues);
  validateClosedEnumV1(value.remoteDisposition, BROKER_REMOTE_DISPOSITIONS_V1, "$.remoteDisposition", issues);
  validateClosedEnumV1(value.activationState, BROKER_ACTIVATION_STATES_V1, "$.activationState", issues);
  validateClosedEnumV1(value.lifecycle, BROKER_LIFECYCLE_STATES_V1, "$.lifecycle", issues);
  validateClosedEnumV1(value.sessionCapability, BROKER_SESSION_CAPABILITIES_V1, "$.sessionCapability", issues);
  validateClosedEnumV1(value.capabilityFreshness, BROKER_CAPABILITY_FRESHNESS_V1, "$.capabilityFreshness", issues);
  validateClosedEnumV1(value.configuration, BROKER_CONFIGURATION_STATES_V1, "$.configuration", issues);
  validateClosedEnumV1(value.nextAction, BROKER_NEXT_ACTIONS_V1, "$.nextAction", issues);
  validateOrderingIntegerV1(value.accountEpoch, 0, "$.accountEpoch", issues);
  validateOrderingIntegerV1(value.processGeneration, 1, "$.processGeneration", issues);
  validateOrderingIntegerV1(value.eventSeq, 0, "$.eventSeq", issues);
  if (value.safeProjectionHandle !== null && (
    typeof value.safeProjectionHandle !== "string" ||
    !/^projection_[A-Za-z0-9_-]{6,96}$/.test(value.safeProjectionHandle)
  )) {
    issues.push(issueV1("$.safeProjectionHandle", "format", "expected null or opaque safe handle"));
  }
  validateReceiptMatrixV1(value, issues);
  const privacy = validateAccountSafeArtifactV1(value);
  if (!privacy.ok) {
    issues.push(...privacy.issues);
  }
  return validationV1(value as BrokerReceiptV1, issues);
}

export function validateAccountBrokerRequestEnvelopeV1(
  value: unknown,
): SchemaValidationV1<AccountBrokerRequestEnvelopeV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected Broker request envelope")] };
  }
  validateExactKeysV1(value, [
    "contractId", "contractVersion", "transportRequestId", "intentId", "operationId",
    "operation", "accountEpoch", "processGeneration", "requestFingerprint",
  ], [], "$", issues);
  if (value.contractId !== ACCOUNT_BROKER_CONTRACT_V1.id || value.contractVersion !== ACCOUNT_BROKER_CONTRACT_V1.version) {
    issues.push(issueV1("$.contractVersion", "enum", "unsupported Broker request contract"));
  }
  validatePrefixedIdV1(value.transportRequestId, "request", "$.transportRequestId", issues);
  const binding = validateBrokerIntentBindingV1({
    intentId: value.intentId,
    operationId: value.operationId,
    operation: value.operation,
    accountEpoch: value.accountEpoch,
    processGeneration: value.processGeneration,
    requestFingerprint: value.requestFingerprint,
  });
  if (!binding.ok) issues.push(...binding.issues);
  return validationV1(value as AccountBrokerRequestEnvelopeV1, issues);
}

export function validateAccountBrokerResponseEnvelopeV1(
  value: unknown,
): SchemaValidationV1<AccountBrokerResponseEnvelopeV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected Broker response envelope")] };
  }
  validateExactKeysV1(value, ["contractId", "contractVersion", "receipt"], [], "$", issues);
  if (value.contractId !== ACCOUNT_BROKER_CONTRACT_V1.id || value.contractVersion !== ACCOUNT_BROKER_CONTRACT_V1.version) {
    issues.push(issueV1("$.contractVersion", "enum", "unsupported Broker response contract"));
  }
  const receipt = validateBrokerReceiptV1(value.receipt);
  if (!receipt.ok) issues.push(...receipt.issues);
  return validationV1(value as AccountBrokerResponseEnvelopeV1, issues);
}

function validateReceiptMatrixV1(
  value: Record<string, unknown>,
  issues: SchemaIssueV1[],
): void {
  const operation = isEnumValueV1(value.operation, ACCOUNT_GATEWAY_OPERATION_NAMES_V1)
    ? value.operation
    : null;
  if (isEnumValueV1(value.status, BROKER_RECEIPT_STATUSES_V1)) {
    const tuple = `${String(value.remoteDisposition)}|${String(value.activationState)}|${String(value.lifecycle)}`;
    if (!STATUS_MATRIX_V1[value.status].includes(tuple)) {
      issues.push(issueV1("$", "invariant", "illegal status/remoteDisposition/activationState/lifecycle tuple"));
    }
  }
  if (value.status === "outcomeUnknown" && value.nextAction !== "reconcile") {
    issues.push(issueV1("$.nextAction", "invariant", "outcomeUnknown requires reconcile action"));
  }
  if (["accepted", "pending", "succeeded", "cancelledBeforeSend"].includes(String(value.status)) &&
    value.nextAction !== "none"
  ) {
    issues.push(issueV1("$.nextAction", "invariant", "non-failure receipt cannot prescribe failure recovery"));
  }
  if (value.activationState === "persistentActive" && (
    value.status !== "succeeded" ||
    value.remoteDisposition !== "confirmed" ||
    value.sessionCapability !== "persistent" ||
    value.lifecycle !== "terminal"
  )) {
    issues.push(issueV1("$", "invariant", "persistent activation requires confirmed terminal success"));
  }
  if (value.status === "pending" && value.lifecycle === "terminal") {
    issues.push(issueV1("$", "invariant", "pending status cannot have terminal lifecycle"));
  }
  if (["succeeded", "rejected", "cancelledBeforeSend"].includes(String(value.status)) &&
    value.lifecycle !== "terminal"
  ) {
    issues.push(issueV1("$", "invariant", "settled status requires terminal lifecycle"));
  }
  if (value.configuration === "applying" && value.status !== "pending") {
    issues.push(issueV1("$", "invariant", "applying configuration requires pending status"));
  }
  if (value.operation === "configuration.apply" && value.status === "succeeded" &&
    value.configuration !== "terminal"
  ) {
    issues.push(issueV1("$.configuration", "invariant", "successful configuration apply requires terminal configuration state"));
  }
  if (value.operation === "configuration.apply" && value.status === "pending" &&
    value.configuration !== "applying"
  ) {
    issues.push(issueV1("$.configuration", "invariant", "pending configuration apply requires applying state"));
  }
  if (value.operation === "auth.logout" && value.status === "succeeded" && (
    value.activationState !== "locallyCleared" ||
    !["confirmed", "unconfirmed"].includes(String(value.remoteDisposition))
  )) {
    issues.push(issueV1("$", "invariant", "successful logout must be locally cleared with explicit remote disposition"));
  }
  if (value.operation === "auth.logout" && value.activationState === "locallyCleared" &&
    !["confirmed", "unconfirmed", "reconciliationPending"].includes(String(value.remoteDisposition))
  ) {
    issues.push(issueV1("$", "invariant", "logout local clear has invalid remote disposition"));
  }
  if (typeof value.operation === "string" && READ_ONLY_OPERATIONS_V1.has(value.operation as GatewayOperationNameV1) &&
    value.activationState !== "unchanged"
  ) {
    issues.push(issueV1("$.activationState", "invariant", "read operation cannot mutate activation state"));
  }
  if (value.activationState === "persistentActive" &&
    (typeof value.operation !== "string" || !SESSION_ACTIVATING_OPERATIONS_V1.has(value.operation as GatewayOperationNameV1))
  ) {
    issues.push(issueV1("$.operation", "invariant", "operation cannot activate a persistent session"));
  }
  if (value.activationState === "locallyCleared" && value.operation !== "auth.logout") {
    issues.push(issueV1("$.operation", "invariant", "only logout may locally clear session state"));
  }
  if (value.activationState === "revoked" && value.operation !== "profile.revokeAllSessions") {
    issues.push(issueV1("$.operation", "invariant", "only revoke-all may report revoked activation state"));
  }
  if (typeof value.operation === "string" && CONFIGURATION_OPERATIONS_V1.has(value.operation as GatewayOperationNameV1)) {
    if (value.configuration === "idle" && value.operation !== "configuration.readCurrentTask") {
      issues.push(issueV1("$.configuration", "invariant", "configuration operation must expose configuration state"));
    }
  } else if (value.configuration !== "idle") {
    issues.push(issueV1("$.configuration", "invariant", "non-configuration operation cannot mutate configuration state"));
  }
  if (value.capabilityFreshness === "hardExpired" && value.status === "succeeded") {
    issues.push(issueV1("$.capabilityFreshness", "invariant", "hard-expired capability cannot authorize success"));
  }
  if (operation) {
    const policy = ACCOUNT_BROKER_OPERATION_POLICIES_V1[operation];
    if (value.status === "succeeded" && (
      !policy.successActivationStates.includes(value.activationState as BrokerActivationStateV1) ||
      !policy.successRemoteDispositions.includes(value.remoteDisposition as BrokerRemoteDispositionV1) ||
      !policy.successConfigurationStates.includes(value.configuration as BrokerConfigurationStateV1)
    )) {
      issues.push(issueV1("$", "invariant", "operation success violates its closed Broker receipt policy"));
    }
    if (value.status === "pending" &&
      !policy.pendingConfigurationStates.includes(value.configuration as BrokerConfigurationStateV1)
    ) {
      issues.push(issueV1("$.configuration", "invariant", "operation pending state violates its Broker policy"));
    }
    if (value.status === "outcomeUnknown" &&
      !policy.uncertaintyConfigurationStates.includes(value.configuration as BrokerConfigurationStateV1)
    ) {
      issues.push(issueV1("$.configuration", "invariant", "operation uncertainty violates its Broker policy"));
    }
  }
}

function validatePrefixedIdV1(
  value: unknown,
  prefix: string,
  path: string,
  issues: SchemaIssueV1[],
): void {
  if (typeof value !== "string" || !value.startsWith(`${prefix}_`) || !isOpaqueSafeIdV1(value)) {
    issues.push(issueV1(path, "format", `invalid ${prefix} identity`));
  }
}

function validateClosedEnumV1<const T extends readonly string[]>(
  value: unknown,
  values: T,
  path: string,
  issues: SchemaIssueV1[],
): void {
  if (!isEnumValueV1(value, values)) {
    issues.push(issueV1(path, "enum", "unknown closed Broker value"));
  }
}

function validateOrderingIntegerV1(
  value: unknown,
  minimum: number,
  path: string,
  issues: SchemaIssueV1[],
): void {
  if (!isNonNegativeIntegerV1(value) || Number(value) < minimum) {
    issues.push(issueV1(path, "range", `expected safe integer >= ${minimum}`));
  }
}

export function isSameBrokerIntentBindingV1(
  previous: BrokerIntentBindingV1,
  next: BrokerIntentBindingV1,
): boolean {
  return previous.intentId === next.intentId &&
    previous.operationId === next.operationId &&
    previous.operation === next.operation &&
    previous.requestFingerprint === next.requestFingerprint &&
    previous.accountEpoch === next.accountEpoch &&
    previous.processGeneration === next.processGeneration;
}

export function acceptsBrokerSettlementV1(
  current: BrokerOrderingSnapshotV1,
  incoming: BrokerOrderingSnapshotV1,
): boolean {
  return incoming.accountEpoch === current.accountEpoch &&
    incoming.processGeneration === current.processGeneration &&
    incoming.eventSeq >= current.eventSeq;
}

export function acceptsBrokerEventWakeupV1(
  current: BrokerOrderingSnapshotV1,
  incoming: BrokerOrderingSnapshotV1,
): boolean {
  return incoming.accountEpoch === current.accountEpoch &&
    incoming.processGeneration === current.processGeneration &&
    incoming.eventSeq > current.eventSeq;
}
