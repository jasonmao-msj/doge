import type { AccountTerminalTruthV1 } from "./semantic";
import {
  ACCOUNT_IPC_CONTRACT_V1,
  brokerOperationIdV1,
  gatewayIntentIdV1,
  transportRequestIdV1,
} from "./semantic";
import type { AccountGatewayEventV1, GatewayOperationNameV1 } from "./gateway";
import { ACCOUNT_IPC_OPERATION_SCHEMAS_V1, ACCOUNT_IPC_EVENT_SCHEMAS_V1 } from "./ipcSchemas";
import type { RuntimeSchemaV1 } from "./schema";
import { safeLabelV1, safeTextV1, oneTimeTotpPresentationV1 } from "./safeValues";
import type { AccountSafeLabelFieldV1, AccountSafeTextFieldV1 } from "./safeValues";
import { ACCOUNT_IPC_READ_OPERATIONS_V1 } from "./ipcOperations";
import type {
  AccountScenarioStepV1,
  ScenarioPrivateFixtureRefV1,
  ScenarioScheduleV1,
} from "./scenario";
import type {
  AccountIpcResponseValidationContextV1,
} from "./ipcValidator";

export type ScenarioPrivateTransientFixtureV1 = {
  readonly scenarioId: string;
  readonly semanticRevision: 1;
  readonly operation: GatewayOperationNameV1;
  readonly terminalTruth: AccountTerminalTruthV1;
  readonly expectedEvents: readonly AccountGatewayEventV1["kind"][];
  readonly faultSchedule: ScenarioScheduleV1;
  readonly request: unknown;
  readonly result: unknown;
  readonly event: unknown;
  readonly expectedValidation: {
    readonly request: boolean;
    readonly result: boolean;
    readonly event: boolean;
  };
  /** Independently generated truth; never derive correlation from the response under validation. */
  readonly expectedResponseCorrelation: {
    readonly requestId: unknown;
    readonly operationId: unknown;
  };
};

export const ACCOUNT_SCENARIO_VALIDATION_CONTEXT_V1 = {
  accountEpoch: 1,
  processGeneration: 1,
  nowEpochSeconds: 1_893_456_000,
  maxHandleTtlSeconds: 7_200,
} as const;

const PRIVATE_TRANSIENT_FIXTURES_V1 = new Map<
  ScenarioPrivateFixtureRefV1,
  ScenarioPrivateTransientFixtureV1
>();

const READ_OPERATIONS_V1 = new Set<GatewayOperationNameV1>(ACCOUNT_IPC_READ_OPERATIONS_V1);

export function buildAccountScenarioStepsV1(
  scenarioId: string,
  operations: readonly GatewayOperationNameV1[],
  terminalTruth: AccountTerminalTruthV1,
  expectedEvents: readonly AccountGatewayEventV1["kind"][],
  faultSchedule: ScenarioScheduleV1,
): readonly AccountScenarioStepV1[] {
  return operations.map((operation, index) => {
    const eventKind = expectedEvents[index] ?? expectedEvents[0] ?? "capabilitiesChanged";
    const good = payloadCaseV1(scenarioId, operation, index, terminalTruth, expectedEvents, eventKind, "Good", false);
    const base = payloadCaseV1(scenarioId, operation, index, terminalTruth, expectedEvents, eventKind, "Base", true);
    const bad: ScenarioPrivateTransientFixtureV1 = {
      ...good,
      faultSchedule,
      request: addUnexpectedChildKeyV1(good.request, "payload"),
      result: addUnexpectedChildKeyV1(good.result, "value"),
      event: addUnexpectedChildKeyV1(good.event, "event"),
      expectedValidation: { request: false, result: false, event: false },
    };
    const refs = {
      Good: privateFixtureRefV1(scenarioId, index, "Good"),
      Base: privateFixtureRefV1(scenarioId, index, "Base"),
      Bad: privateFixtureRefV1(scenarioId, index, "Bad"),
    };
    PRIVATE_TRANSIENT_FIXTURES_V1.set(refs.Good, { ...good, faultSchedule });
    PRIVATE_TRANSIENT_FIXTURES_V1.set(refs.Base, { ...base, faultSchedule });
    PRIVATE_TRANSIENT_FIXTURES_V1.set(refs.Bad, { ...bad, faultSchedule });
    return {
      stepId: `${scenarioId}.step-${index + 1}`,
      operation,
      privateFixtureRefs: refs,
    };
  });
}

export function readScenarioPrivateTransientFixtureV1(
  ref: ScenarioPrivateFixtureRefV1,
): ScenarioPrivateTransientFixtureV1 {
  const fixture = PRIVATE_TRANSIENT_FIXTURES_V1.get(ref);
  if (!fixture) throw new Error("Unknown scenario private transient fixture reference");
  return fixture;
}

export function scenarioResponseValidationContextV1(
  fixture: ScenarioPrivateTransientFixtureV1,
): AccountIpcResponseValidationContextV1 {
  const isRead = READ_OPERATIONS_V1.has(fixture.operation);
  return {
    ...ACCOUNT_SCENARIO_VALIDATION_CONTEXT_V1,
    expectedKind: isRead ? "read" : "mutation",
    expectedOperation: fixture.operation,
    expectedRequestId: fixture.expectedResponseCorrelation.requestId,
    expectedOperationId: isRead ? null : fixture.expectedResponseCorrelation.operationId,
  } as AccountIpcResponseValidationContextV1;
}

function payloadCaseV1(
  scenarioId: string,
  operation: GatewayOperationNameV1,
  index: number,
  terminalTruth: AccountTerminalTruthV1,
  expectedEvents: readonly AccountGatewayEventV1["kind"][],
  eventKind: AccountGatewayEventV1["kind"],
  variant: "Good" | "Base",
  nullableBase: boolean,
): Omit<ScenarioPrivateTransientFixtureV1, "faultSchedule"> {
  const nonce = stableNonceV1(`${scenarioId}:${operation}:${index}:${variant}`);
  const requestId = transportRequestIdV1(`request_${nonce}`);
  const intentId = gatewayIntentIdV1(`intent_${nonce}`);
  const operationId = brokerOperationIdV1(`operation_${nonce}`);
  const materialize = (schema: RuntimeSchemaV1) =>
    materializeRuntimeFixtureV1(schema, nullableBase, `${nonce}fixture`);
  const requestBase = {
    contractId: ACCOUNT_IPC_CONTRACT_V1.id,
    contractVersion: ACCOUNT_IPC_CONTRACT_V1.version,
    requestId,
    operation,
    processGeneration: ACCOUNT_SCENARIO_VALIDATION_CONTEXT_V1.processGeneration,
    accountEpoch: ACCOUNT_SCENARIO_VALIDATION_CONTEXT_V1.accountEpoch,
    payload: materialize(ACCOUNT_IPC_OPERATION_SCHEMAS_V1[operation].request),
  };
  const request = READ_OPERATIONS_V1.has(operation)
    ? { ...requestBase, kind: "read" }
    : { ...requestBase, kind: "mutation", intentId };
  const result = variant === "Base" && isFailureTerminalV1(terminalTruth)
    ? {
        contractId: ACCOUNT_IPC_CONTRACT_V1.id,
        contractVersion: ACCOUNT_IPC_CONTRACT_V1.version,
        requestId,
        operation,
        processGeneration: ACCOUNT_SCENARIO_VALIDATION_CONTEXT_V1.processGeneration,
        accountEpoch: ACCOUNT_SCENARIO_VALIDATION_CONTEXT_V1.accountEpoch,
        operationId: READ_OPERATIONS_V1.has(operation) ? null : operationId,
        ok: false,
        error: {
          code: terminalTruth === "outcomeUnknown" ? "outcomeUnknown" : "validationRejected",
          stage: failureStageV1(operation),
          recovery: terminalTruth === "outcomeUnknown"
            ? { action: "reconcile", intent: intentId }
            : { action: "none" },
        },
      }
    : {
        contractId: ACCOUNT_IPC_CONTRACT_V1.id,
        contractVersion: ACCOUNT_IPC_CONTRACT_V1.version,
        requestId,
        operation,
        processGeneration: ACCOUNT_SCENARIO_VALIDATION_CONTEXT_V1.processGeneration,
        accountEpoch: ACCOUNT_SCENARIO_VALIDATION_CONTEXT_V1.accountEpoch,
        operationId: READ_OPERATIONS_V1.has(operation) ? null : operationId,
        ok: true,
        value: materialize(ACCOUNT_IPC_OPERATION_SCHEMAS_V1[operation].result),
      };
  const rawEvent = materialize(ACCOUNT_IPC_EVENT_SCHEMAS_V1[eventKind]) as Record<string, unknown>;
  const eventPayload = {
    ...rawEvent,
    eventId: `event_${nonce}`,
    emittedAt: "2030-01-01T00:00:01Z",
    processGeneration: ACCOUNT_SCENARIO_VALIDATION_CONTEXT_V1.processGeneration,
    eventSeq: index + (variant === "Good" ? 1 : 101),
    accountEpoch: ACCOUNT_SCENARIO_VALIDATION_CONTEXT_V1.accountEpoch,
  };
  const event = {
    contractId: ACCOUNT_IPC_CONTRACT_V1.id,
    contractVersion: ACCOUNT_IPC_CONTRACT_V1.version,
    event: eventPayload,
  };
  return {
    scenarioId,
    semanticRevision: 1,
    operation,
    terminalTruth,
    expectedEvents,
    request,
    result,
    event,
    expectedValidation: { request: true, result: true, event: true },
    expectedResponseCorrelation: {
      requestId,
      operationId: READ_OPERATIONS_V1.has(operation) ? null : operationId,
    },
  };
}

function privateFixtureRefV1(
  scenarioId: string,
  stepIndex: number,
  fixtureClass: "Good" | "Base" | "Bad",
): ScenarioPrivateFixtureRefV1 {
  return `private-fixture~${stableNonceV1(`${scenarioId}:${stepIndex}:${fixtureClass}`)}~${fixtureClass.toLowerCase()}` as ScenarioPrivateFixtureRefV1;
}

function materializeRuntimeFixtureV1(
  schema: RuntimeSchemaV1,
  nullableBase: boolean,
  nonce: string,
): unknown {
  switch (schema.kind) {
    case "string": return "synthetic-value";
    case "boolean": return false;
    case "integer": return Math.max(schema.minimum ?? 0, 0);
    case "literal": return schema.value;
    case "enum": return schema.values[0];
    case "timestamp": return "2030-01-01T00:00:02Z";
    case "decimal": return nullableBase ? "0" : "1.25";
    case "opaqueId": return `${schema.prefix}_${nonce}`;
    case "safeLabel": return safeLabelV1(
      nullableBase ? "Synthetic base" : "Synthetic good",
      schema.field as AccountSafeLabelFieldV1,
    );
    case "safeText": return safeTextV1(
      nullableBase ? "Synthetic base value" : "Synthetic good value",
      schema.field as AccountSafeTextFieldV1,
    );
    case "emailInput": return "fixture.user@example.invalid";
    case "secretInput": return "synthetic-transient-input";
    case "oneTimeTotp": return oneTimeTotpPresentationV1(
      nullableBase ? "totp-manual~syntheticBase001" : "totp-svg~syntheticGood001",
    );
    case "handle": {
      const purpose = Array.isArray(schema.purpose) ? schema.purpose[0] : schema.purpose;
      return `handle~${schema.handleKind}~${purpose}~e1~g1~x1893459600~${nonce}`;
    }
    case "array": {
      const count = Math.max(schema.minItems ?? 0, nullableBase ? 0 : 1);
      return Array.from({ length: count }, () => materializeRuntimeFixtureV1(schema.item, nullableBase, nonce));
    }
    case "record": return {};
    case "nullable": return nullableBase ? null : materializeRuntimeFixtureV1(schema.inner, false, nonce);
    case "object": return Object.fromEntries(
      Object.entries(schema.required).map(([key, child]) => [key, materializeRuntimeFixtureV1(child, nullableBase, nonce)]),
    );
    case "union": {
      const variant = Object.values(schema.variants)[0];
      return materializeRuntimeFixtureV1(variant, nullableBase, nonce);
    }
    case "anyOf": return materializeRuntimeFixtureV1(schema.variants[0], nullableBase, nonce);
  }
}

function addUnexpectedKeyV1(value: unknown): unknown {
  return typeof value === "object" && value !== null
    ? { ...(value as Record<string, unknown>), unexpectedV1: "strict-reject" }
    : value;
}

function addUnexpectedChildKeyV1(value: unknown, childKey: string): unknown {
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const child = record[childKey];
  return typeof child === "object" && child !== null && !Array.isArray(child)
    ? { ...record, [childKey]: addUnexpectedKeyV1(child) }
    : addUnexpectedKeyV1(record);
}

function isFailureTerminalV1(value: AccountTerminalTruthV1): boolean {
  return value === "rejected" || value === "outcomeUnknown";
}

function failureStageV1(operation: GatewayOperationNameV1) {
  if (operation.startsWith("configuration.")) return "configurationApply" as const;
  if (operation.startsWith("managedKey.")) return "managedKey" as const;
  if (operation.startsWith("profile.")) return "security" as const;
  if (operation.startsWith("humanVerification.")) return "challenge" as const;
  if (operation.startsWith("usage.")) return "usage" as const;
  if (operation.includes("OAuth")) return "oauth" as const;
  if (operation.includes("PasswordReset") || operation.includes("ExternalIntent")) return "recover" as const;
  if (operation === "auth.logout") return "logout" as const;
  if (operation === "gateway.bootstrap") return "capabilities" as const;
  return "login" as const;
}

function stableNonceV1(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `synthetic${(hash >>> 0).toString(36).padStart(7, "0")}`;
}
