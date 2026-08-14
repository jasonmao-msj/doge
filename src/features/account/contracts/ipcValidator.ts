import {
  ACCOUNT_GATEWAY_EVENT_KINDS_V1,
  ACCOUNT_GATEWAY_OPERATION_NAMES_V1,
  type GatewayOperationNameV1,
} from "./gateway";
import {
  ACCOUNT_IPC_EVENT_SCHEMAS_V1,
  ACCOUNT_IPC_OPERATION_SCHEMAS_V1,
  ACCOUNT_IPC_OPERATION_RUNTIME_SCHEMAS_V1,
} from "./ipcSchemas";
import {
  ACCOUNT_IPC_CONTRACT_V1,
  type BrokerOperationIdV1,
  type TransportRequestIdV1,
} from "./semantic";
import type {
  AccountIpcEventEnvelopeV1,
  AccountIpcRequestEnvelopeV1,
  AccountIpcResponseEnvelopeV1,
} from "./transport";
import { ACCOUNT_IPC_READ_OPERATIONS_V1 } from "./ipcOperations";
import type {
  RuntimeSchemaExtensionV1,
  RuntimeSchemaV1,
  SchemaIssueV1,
  SchemaValidationV1,
} from "./schema";
import {
  isEnumValueV1,
  isNonNegativeIntegerV1,
  isOpaqueSafeIdV1,
  isRecordV1,
  issueV1,
  validateExactKeysV1,
  validateRuntimeSchemaV1,
  validationV1,
} from "./schema";
import { parseAccountHandleV1 } from "./handleValidator";
import {
  isOneTimeTotpPresentationV1,
  validateSafeLabelForFieldV1,
  validateSafeTextForFieldV1,
  type AccountSafeLabelFieldV1,
  type AccountSafeTextFieldV1,
} from "./safeValues";
import {
  validateAccountSafeArtifactV1,
} from "./privacy";
import { validateGatewayFailureV1 } from "./semanticValidator";

export type AccountIpcValidationContextV1 = {
  readonly accountEpoch: number;
  readonly processGeneration: number;
  readonly nowEpochSeconds: number;
  readonly maxHandleTtlSeconds: number;
};

export type AccountIpcResponseCorrelationV1 =
  | {
      readonly expectedKind: "read";
      readonly expectedOperation: (typeof ACCOUNT_IPC_READ_OPERATIONS_V1)[number];
      readonly expectedRequestId: TransportRequestIdV1;
      readonly expectedOperationId: null;
    }
  | {
      readonly expectedKind: "mutation";
      readonly expectedOperation: Exclude<
        GatewayOperationNameV1,
        (typeof ACCOUNT_IPC_READ_OPERATIONS_V1)[number]
      >;
      readonly expectedRequestId: TransportRequestIdV1;
      /** Filled only after the Broker accepts the intent and creates this id. */
      readonly expectedOperationId: BrokerOperationIdV1;
    };

export type AccountIpcResponseValidationContextV1 =
  AccountIpcValidationContextV1 & AccountIpcResponseCorrelationV1;

export type AccountEventCursorV1 = {
  readonly processGeneration: number;
  readonly eventSeq: number;
  readonly accountEpoch: number | null;
};

const READ_SET_V1 = new Set<GatewayOperationNameV1>(ACCOUNT_IPC_READ_OPERATIONS_V1);
const EMAIL_PATTERN_V1 = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function shiftedIssuesV1(
  issues: readonly SchemaIssueV1[],
  prefix: string,
): readonly SchemaIssueV1[] {
  return issues.map((entry) => ({
    ...entry,
    path: `${prefix}${entry.path === "$" ? "" : entry.path.slice(1)}`,
  }));
}

function extensionV1(
  context: AccountIpcValidationContextV1,
): RuntimeSchemaExtensionV1 {
  return (schema, value, path, issues) => {
    switch (schema.kind) {
      case "safeLabel": {
        if (!["profileDisplayName", "primaryEmailLabel", "providerLabel", "targetLabel", "fieldLabel", "subscriptionLabel", "maskedPresentation"].includes(schema.field)) {
          issues.push(issueV1(path, "enum", "unknown SafeLabel field scope"));
          return;
        }
        const result = validateSafeLabelForFieldV1(schema.field as AccountSafeLabelFieldV1, value);
        if (!result.ok) {
          issues.push(...shiftedIssuesV1(result.issues, path));
        }
        return;
      }
      case "safeText": {
        if (schema.field !== "configurationValue") {
          issues.push(issueV1(path, "enum", "unknown SafeText field scope"));
          return;
        }
        const result = validateSafeTextForFieldV1(schema.field as AccountSafeTextFieldV1, value);
        if (!result.ok) {
          issues.push(...shiftedIssuesV1(result.issues, path));
        }
        return;
      }
      case "emailInput":
        if (typeof value !== "string" || value.length > 254 || !EMAIL_PATTERN_V1.test(value)) {
          issues.push(issueV1(path, "format", "invalid transient email input"));
        }
        return;
      case "secretInput":
        if (typeof value !== "string" || value.length < 1 || value.length > 1024) {
          issues.push(issueV1(path, "format", "invalid bounded transient secret input"));
        }
        return;
      case "oneTimeTotp":
        if (!isOneTimeTotpPresentationV1(value)) {
          issues.push(issueV1(path, "format", "invalid one-time TOTP presentation"));
        }
        return;
      case "handle": {
        const parsed = parseAccountHandleV1(value);
        const purposes = Array.isArray(schema.purpose)
          ? schema.purpose
          : [schema.purpose];
        if (!parsed) {
          issues.push(issueV1(path, "format", "invalid bound Account handle"));
          return;
        }
        if (parsed.kind !== schema.handleKind) {
          issues.push(issueV1(path, "enum", "cross-kind Account handle rejected"));
        }
        if (!purposes.includes(parsed.purpose)) {
          issues.push(issueV1(path, "invariant", "Account handle purpose mismatch"));
        }
        if (parsed.accountEpoch !== context.accountEpoch) {
          issues.push(issueV1(path, "invariant", "stale Account handle epoch"));
        }
        if (parsed.processGeneration !== context.processGeneration) {
          issues.push(issueV1(path, "invariant", "stale Account handle process generation"));
        }
        const ttl = parsed.expiresAtEpochSeconds - context.nowEpochSeconds;
        if (ttl <= 0 || ttl > context.maxHandleTtlSeconds) {
          issues.push(issueV1(path, "range", "expired or overlong Account handle TTL"));
        }
      }
    }
  };
}

function validateContractIdentityV1(
  value: Record<string, unknown>,
  issues: SchemaIssueV1[],
): void {
  if (value.contractId !== ACCOUNT_IPC_CONTRACT_V1.id) {
    issues.push(issueV1("$.contractId", "enum", "unexpected IPC contract id"));
  }
  if (value.contractVersion !== ACCOUNT_IPC_CONTRACT_V1.version) {
    issues.push(issueV1("$.contractVersion", "enum", "unsupported IPC contract version"));
  }
}

function validateOperationV1(
  value: unknown,
  issues: SchemaIssueV1[],
): GatewayOperationNameV1 | null {
  if (!isEnumValueV1(value, ACCOUNT_GATEWAY_OPERATION_NAMES_V1)) {
    issues.push(issueV1("$.operation", "enum", "unknown IPC operation"));
    return null;
  }
  return value;
}

export function validateAccountIpcRequestV1(
  value: unknown,
  context: AccountIpcValidationContextV1,
): SchemaValidationV1<AccountIpcRequestEnvelopeV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected IPC request object")] };
  }
  const operation = validateOperationV1(value.operation, issues);
  const expectedKind = operation && READ_SET_V1.has(operation) ? "read" : "mutation";
  const required = expectedKind === "read"
    ? [
        "contractId",
        "contractVersion",
        "requestId",
        "operation",
        "kind",
        "processGeneration",
        "accountEpoch",
        "payload",
      ]
    : [
        "contractId",
        "contractVersion",
        "requestId",
        "operation",
        "kind",
        "processGeneration",
        "accountEpoch",
        "intentId",
        "payload",
      ];
  validateExactKeysV1(value, required, [], "$", issues);
  validateContractIdentityV1(value, issues);
  if (value.kind !== expectedKind) {
    issues.push(issueV1("$.kind", "invariant", "IPC read/mutation discriminator mismatch"));
  }
  if (typeof value.requestId !== "string" ||
    !value.requestId.startsWith("request_") ||
    !isOpaqueSafeIdV1(value.requestId)
  ) {
    issues.push(issueV1("$.requestId", "format", "invalid TransportRequestIdV1"));
  }
  if (!Number.isSafeInteger(value.processGeneration) || value.processGeneration !== context.processGeneration) {
    issues.push(issueV1("$.processGeneration", "invariant", "stale IPC request process generation"));
  }
  if (value.accountEpoch !== null && !isNonNegativeIntegerV1(value.accountEpoch)) {
    issues.push(issueV1("$.accountEpoch", "range", "invalid account epoch"));
  }
  if (expectedKind === "mutation") {
    if (!isNonNegativeIntegerV1(value.accountEpoch) || value.accountEpoch !== context.accountEpoch) {
      issues.push(issueV1("$.accountEpoch", "invariant", "mutation requires current account epoch"));
    }
    if (typeof value.intentId !== "string" ||
      !value.intentId.startsWith("intent_") ||
      !isOpaqueSafeIdV1(value.intentId)
    ) {
      issues.push(issueV1("$.intentId", "format", "invalid GatewayIntentIdV1"));
    }
  }
  if (operation) {
    validateRuntimeSchemaV1(
      ACCOUNT_IPC_OPERATION_SCHEMAS_V1[operation].request,
      value.payload,
      "$.payload",
      issues,
      extensionV1(context),
    );
  }
  return validationV1(value as AccountIpcRequestEnvelopeV1, issues);
}

export function validateAccountIpcResponseEnvelopeV1(
  value: unknown,
  context: AccountIpcResponseValidationContextV1,
): SchemaValidationV1<AccountIpcResponseEnvelopeV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected IPC response object")] };
  }
  validateExactKeysV1(
    value,
    [
      "contractId",
      "contractVersion",
      "requestId",
      "operation",
      "processGeneration",
      "accountEpoch",
      "operationId",
      "ok",
      value.ok === true ? "value" : "error",
    ],
    [],
    "$",
    issues,
  );
  validateContractIdentityV1(value, issues);
  const operation = context.expectedOperation;
  if (value.operation !== context.expectedOperation) {
    issues.push(issueV1("$.operation", "invariant", "response operation correlation mismatch"));
  }
  if (typeof value.requestId !== "string" ||
    !value.requestId.startsWith("request_") ||
    !isOpaqueSafeIdV1(value.requestId)
  ) {
    issues.push(issueV1("$.requestId", "format", "invalid TransportRequestIdV1"));
  }
  if (value.requestId !== context.expectedRequestId) {
    issues.push(issueV1("$.requestId", "invariant", "response request correlation mismatch"));
  }
  if (value.processGeneration !== context.processGeneration) {
    issues.push(issueV1("$.processGeneration", "invariant", "stale IPC response process generation"));
  }
  if (value.accountEpoch !== null && value.accountEpoch !== context.accountEpoch) {
    issues.push(issueV1("$.accountEpoch", "invariant", "stale IPC response account epoch"));
  }
  if (value.operationId !== null && (
    typeof value.operationId !== "string" ||
    !value.operationId.startsWith("operation_") ||
    !isOpaqueSafeIdV1(value.operationId)
  )) {
    issues.push(issueV1("$.operationId", "format", "invalid BrokerOperationIdV1"));
  }
  if (context.expectedKind === "read" && value.operationId !== null) {
    issues.push(issueV1("$.operationId", "invariant", "read response cannot carry mutation operation id"));
  }
  if (context.expectedKind === "mutation" && value.operationId === null) {
    issues.push(issueV1("$.operationId", "invariant", "mutation response requires Broker operation id"));
  }
  if (value.operationId !== context.expectedOperationId) {
    issues.push(issueV1("$.operationId", "invariant", "response Broker operation correlation mismatch"));
  }
  if (context.expectedKind === "mutation" && value.accountEpoch !== context.accountEpoch) {
    issues.push(issueV1("$.accountEpoch", "invariant", "mutation response requires current account epoch"));
  }
  if (typeof value.ok !== "boolean") {
    issues.push(issueV1("$.ok", "type", "expected response discriminator"));
  } else if (value.ok) {
    validateRuntimeSchemaV1(
      ACCOUNT_IPC_OPERATION_SCHEMAS_V1[operation].result,
      value.value,
      "$.value",
      issues,
      extensionV1(context),
    );
    const totpPaths = operation === "profile.beginTotpEnrollment"
      ? ["$.presentation.qrSvg", "$.presentation.manualSecret"]
      : [];
    const privacy = validateAccountSafeArtifactV1(value.value, {
      allowTotpOneTimeAtPaths: totpPaths,
    });
    if (!privacy.ok) {
      issues.push(...shiftedIssuesV1(privacy.issues, "$.value"));
    }
  } else if (value.ok === false) {
    const failure = validateGatewayFailureV1(value.error);
    if (!failure.ok) {
      issues.push(...shiftedIssuesV1(failure.issues, "$.error"));
    }
  }
  return validationV1(value as AccountIpcResponseEnvelopeV1, issues);
}

export function validateAccountIpcEventEnvelopeV1(
  value: unknown,
  previousCursor: AccountEventCursorV1 | null,
): SchemaValidationV1<AccountIpcEventEnvelopeV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected IPC event envelope")] };
  }
  validateExactKeysV1(value, ["contractId", "contractVersion", "event"], [], "$", issues);
  validateContractIdentityV1(value, issues);
  if (!isRecordV1(value.event) ||
    !isEnumValueV1(value.event.kind, ACCOUNT_GATEWAY_EVENT_KINDS_V1)
  ) {
    issues.push(issueV1("$.event.kind", "enum", "unknown Account event kind"));
  } else {
    const event = value.event;
    const eventContext: AccountIpcValidationContextV1 = {
      accountEpoch: typeof event.accountEpoch === "number" ? event.accountEpoch : 0,
      processGeneration:
        typeof event.processGeneration === "number" ? event.processGeneration : 0,
      nowEpochSeconds: 0,
      maxHandleTtlSeconds: Number.MAX_SAFE_INTEGER,
    };
    validateRuntimeSchemaV1(
      ACCOUNT_IPC_EVENT_SCHEMAS_V1[value.event.kind],
      event,
      "$.event",
      issues,
      extensionV1(eventContext),
    );
    if (previousCursor) {
      const processGeneration = typeof event.processGeneration === "number"
        ? event.processGeneration
        : -1;
      const eventSeq = typeof event.eventSeq === "number" ? event.eventSeq : -1;
      const accountEpoch = typeof event.accountEpoch === "number" || event.accountEpoch === null
        ? event.accountEpoch
        : null;
      if (processGeneration < previousCursor.processGeneration) {
        issues.push(issueV1("$.event.processGeneration", "invariant", "old process generation event"));
      } else if (
        processGeneration === previousCursor.processGeneration &&
        eventSeq <= previousCursor.eventSeq
      ) {
        issues.push(issueV1("$.event.eventSeq", "invariant", "non-monotonic event sequence"));
      }
      if (
        previousCursor.accountEpoch !== null &&
        accountEpoch !== null &&
        accountEpoch < previousCursor.accountEpoch
      ) {
        issues.push(issueV1("$.event.accountEpoch", "invariant", "old account epoch event"));
      }
    }
    const privacy = validateAccountSafeArtifactV1(event);
    if (!privacy.ok) {
      issues.push(...shiftedIssuesV1(privacy.issues, "$.event"));
    }
  }
  return validationV1(value as AccountIpcEventEnvelopeV1, issues);
}

export function validateAccountOperationPayloadV1(
  operation: GatewayOperationNameV1,
  phase: "request" | "result" | "event",
  payload: unknown,
  context: AccountIpcValidationContextV1,
): SchemaValidationV1<unknown> {
  const issues: SchemaIssueV1[] = [];
  const schema: RuntimeSchemaV1 = ACCOUNT_IPC_OPERATION_RUNTIME_SCHEMAS_V1[operation][phase];
  validateRuntimeSchemaV1(schema, payload, "$", issues, extensionV1(context));
  return validationV1(payload, issues);
}
