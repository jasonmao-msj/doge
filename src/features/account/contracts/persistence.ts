import { ACCOUNT_PERSISTENCE_SCHEMA_V1 } from "./semantic";
import type { GatewayOperationNameV1 } from "./gateway";
import { ACCOUNT_GATEWAY_OPERATION_NAMES_V1 } from "./gateway";
import { ACCOUNT_IPC_READ_OPERATIONS_V1 } from "./ipcOperations";
import { validateAccountSafeArtifactV1 } from "./privacy";
import type { SchemaIssueV1, SchemaValidationV1 } from "./schema";
import {
  collectDuplicateStringsV1,
  isEnumValueV1,
  isRecordV1,
  isRfc3339UtcV1,
  issueV1,
  validateExactKeysV1,
  validationV1,
} from "./schema";

export const ACCOUNT_PERSISTENCE_ENTITIES_V1 = [
  "account_links",
  "devices",
  "session_generations",
  "operation_ledger",
  "account_cache",
  "external_flows",
  "config_tasks",
  "config_file_receipts",
  "schema_meta",
] as const;
export type AccountPersistenceEntityV1 =
  (typeof ACCOUNT_PERSISTENCE_ENTITIES_V1)[number];

export const ACCOUNT_VAULT_PURPOSES_V1 = [
  "refresh-session",
  "managed-key:codex-token-service",
] as const;
export type AccountVaultPurposeV1 = (typeof ACCOUNT_VAULT_PURPOSES_V1)[number];

type PersistenceBaseV1<TEntity extends AccountPersistenceEntityV1> = {
  readonly entity: TEntity;
  readonly schemaVersion: 1;
};

export type AccountPersistenceRecordV1 =
  | (PersistenceBaseV1<"account_links"> & {
      readonly authorityOriginId: string;
      readonly accountLinkId: string;
      readonly deviceId: string;
      readonly accountEpoch: number;
      readonly maskedPresentation: string | null;
      readonly status: "active" | "signedOut" | "revoked";
      readonly createdAt: string;
      readonly lastSeenAt: string;
      readonly updatedAt: string;
    })
  | (PersistenceBaseV1<"devices"> & {
      readonly deviceId: string;
      readonly platformClass: "macos" | "windows" | "linux";
      readonly remoteRegistrationRef: string | null;
      readonly createdAt: string;
    })
  | (PersistenceBaseV1<"session_generations"> & {
      readonly accountLinkId: string;
      readonly deviceId: string;
      readonly generation: number;
      readonly vaultPurpose: "refresh-session";
      readonly vaultAliasRef: string;
      readonly status: "active" | "superseded" | "revoked";
      readonly authorityRevision: number;
      readonly createdAt: string;
      readonly updatedAt: string;
    })
  | (PersistenceBaseV1<"operation_ledger"> & {
      readonly intentId: string;
      readonly operationId: string;
      readonly operation: GatewayOperationNameV1;
      readonly requestFingerprint: string;
      readonly status: "pending" | "succeeded" | "rejected" | "outcomeUnknown";
      readonly remoteDisposition: "notContacted" | "pending" | "confirmed" | "unconfirmed" | "reconciliationPending";
      readonly accountEpoch: number;
      readonly processGeneration: number;
      readonly reconcileDeadlineAt: string | null;
    })
  | (PersistenceBaseV1<"account_cache"> & {
      readonly slice: "bootstrap" | "profile" | "usage" | "configuration";
      readonly safeViewKind: "bootstrap" | "profile" | "usage" | "configuration";
      readonly source: "authority" | "broker";
      readonly freshness: "fresh" | "softStale" | "hardExpired";
      readonly accountEpoch: number;
      readonly observedAt: string;
      readonly expiresAt: string;
    })
  | (PersistenceBaseV1<"external_flows"> & {
      readonly purpose: "oauth" | "password-reset" | "identity-bind";
      readonly handleDigest: string;
      readonly stateClass: "waiting" | "returned" | "terminal";
      readonly accountEpoch: number;
      readonly processGeneration: number;
      readonly status: "pending" | "consumed" | "expired" | "cancelled";
      readonly expiresAt: string;
    })
  | (PersistenceBaseV1<"config_tasks"> & {
      readonly taskId: string;
      readonly accountLinkId: string;
      readonly deviceId: string;
      readonly recipeId: "doge.account.codex-token-service";
      readonly recipeVersion: 1;
      readonly state: "planned" | "applying" | "terminal" | "recoveryRequired";
      readonly safeSummaryClass: "offer" | "plan" | "result" | "attention";
      readonly unread: boolean;
      readonly acknowledged: boolean;
      readonly dismissed: boolean;
      readonly receiptRef: string | null;
      readonly updatedAt: string;
    })
  | (PersistenceBaseV1<"config_file_receipts"> & {
      readonly transactionId: string;
      readonly fileSlot: "doge-managed-provider-registry" | "codex-provider-config";
      readonly fingerprint: string;
      readonly fingerprintClass: "precondition" | "committed" | "rollback";
      readonly outcome: "unchanged" | "applied" | "rolledBack" | "rollbackFailed";
      readonly checkpoint: number;
    })
  | (PersistenceBaseV1<"schema_meta"> & {
      readonly databaseVersion: 1;
      readonly migrationState: "current" | "migrating" | "failed";
      readonly recoveryState: "none" | "quarantined";
      readonly updatedAt: string;
    });

export type AccountPersistenceSchemaDefinitionV1 = {
  readonly id: typeof ACCOUNT_PERSISTENCE_SCHEMA_V1.id;
  readonly version: typeof ACCOUNT_PERSISTENCE_SCHEMA_V1.version;
  readonly entities: readonly AccountPersistenceEntityV1[];
  readonly vaultPurposes: readonly AccountVaultPurposeV1[];
  readonly activeAccountCardinality: "at-most-one-exposed";
  readonly accountIsolationKey: readonly [
    "authorityOriginId",
    "accountLinkId",
    "deviceId",
  ];
  readonly newerOrCorruptSchema: "quarantine-account-module";
  readonly localCoreStartupDependency: false;
};

export const ACCOUNT_PERSISTENCE_SCHEMA_DEFINITION_V1: AccountPersistenceSchemaDefinitionV1 = {
  id: ACCOUNT_PERSISTENCE_SCHEMA_V1.id,
  version: ACCOUNT_PERSISTENCE_SCHEMA_V1.version,
  entities: ACCOUNT_PERSISTENCE_ENTITIES_V1,
  vaultPurposes: ACCOUNT_VAULT_PURPOSES_V1,
  activeAccountCardinality: "at-most-one-exposed",
  accountIsolationKey: ["authorityOriginId", "accountLinkId", "deviceId"],
  newerOrCorruptSchema: "quarantine-account-module",
  localCoreStartupDependency: false,
};

export function validateAccountPersistenceSchemaV1(
  value: unknown,
): SchemaValidationV1<AccountPersistenceSchemaDefinitionV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected persistence schema object")] };
  }
  validateExactKeysV1(
    value,
    [
      "id", "version", "entities", "vaultPurposes", "activeAccountCardinality",
      "accountIsolationKey", "newerOrCorruptSchema", "localCoreStartupDependency",
    ],
    [],
    "$",
    issues,
  );
  if (value.id !== ACCOUNT_PERSISTENCE_SCHEMA_V1.id || value.version !== 1) {
    issues.push(issueV1("$.id", "enum", "unexpected persistence schema identity"));
  }
  validateClosedArrayV1(value.entities, ACCOUNT_PERSISTENCE_ENTITIES_V1, "$.entities", issues);
  validateClosedArrayV1(value.vaultPurposes, ACCOUNT_VAULT_PURPOSES_V1, "$.vaultPurposes", issues);
  const exactFields: Readonly<Record<string, unknown>> = {
    activeAccountCardinality: "at-most-one-exposed",
    newerOrCorruptSchema: "quarantine-account-module",
    localCoreStartupDependency: false,
  };
  for (const [key, expected] of Object.entries(exactFields)) {
    if (value[key] !== expected) {
      issues.push(issueV1(`$.${key}`, "invariant", `expected ${String(expected)}`));
    }
  }
  if (
    !Array.isArray(value.accountIsolationKey) ||
    value.accountIsolationKey.join("|") !== "authorityOriginId|accountLinkId|deviceId"
  ) {
    issues.push(issueV1("$.accountIsolationKey", "invariant", "invalid account isolation key"));
  }
  const privacy = validateAccountSafeArtifactV1(value);
  if (!privacy.ok) {
    issues.push(...privacy.issues);
  }
  return validationV1(value as AccountPersistenceSchemaDefinitionV1, issues);
}

const SHA256_V1 = /^sha256:[a-f0-9]{64}$/;
const PERSISTED_READ_OPERATIONS_V1 = new Set<GatewayOperationNameV1>(
  ACCOUNT_IPC_READ_OPERATIONS_V1,
);

export function validateAccountPersistenceRecordV1(
  value: unknown,
): SchemaValidationV1<AccountPersistenceRecordV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value) || !isEnumValueV1(value.entity, ACCOUNT_PERSISTENCE_ENTITIES_V1)) {
    return { ok: false, issues: [issueV1("$.entity", "enum", "unknown persistence record entity")] };
  }
  const keysByEntity: Readonly<Record<AccountPersistenceEntityV1, readonly string[]>> = {
    account_links: ["entity", "schemaVersion", "authorityOriginId", "accountLinkId", "deviceId", "accountEpoch", "maskedPresentation", "status", "createdAt", "lastSeenAt", "updatedAt"],
    devices: ["entity", "schemaVersion", "deviceId", "platformClass", "remoteRegistrationRef", "createdAt"],
    session_generations: ["entity", "schemaVersion", "accountLinkId", "deviceId", "generation", "vaultPurpose", "vaultAliasRef", "status", "authorityRevision", "createdAt", "updatedAt"],
    operation_ledger: ["entity", "schemaVersion", "intentId", "operationId", "operation", "requestFingerprint", "status", "remoteDisposition", "accountEpoch", "processGeneration", "reconcileDeadlineAt"],
    account_cache: ["entity", "schemaVersion", "slice", "safeViewKind", "source", "freshness", "accountEpoch", "observedAt", "expiresAt"],
    external_flows: ["entity", "schemaVersion", "purpose", "handleDigest", "stateClass", "accountEpoch", "processGeneration", "status", "expiresAt"],
    config_tasks: ["entity", "schemaVersion", "taskId", "accountLinkId", "deviceId", "recipeId", "recipeVersion", "state", "safeSummaryClass", "unread", "acknowledged", "dismissed", "receiptRef", "updatedAt"],
    config_file_receipts: ["entity", "schemaVersion", "transactionId", "fileSlot", "fingerprint", "fingerprintClass", "outcome", "checkpoint"],
    schema_meta: ["entity", "schemaVersion", "databaseVersion", "migrationState", "recoveryState", "updatedAt"],
  };
  validateExactKeysV1(value, keysByEntity[value.entity], [], "$", issues);
  if (value.schemaVersion !== 1) {
    issues.push(issueV1("$.schemaVersion", "enum", "unsupported persistence record version"));
  }
  switch (value.entity) {
    case "account_links":
      validateIdV1(value.authorityOriginId, "origin", "$.authorityOriginId", issues);
      validateIdV1(value.accountLinkId, "account", "$.accountLinkId", issues);
      validateIdV1(value.deviceId, "device", "$.deviceId", issues);
      validateIntegerV1(value.accountEpoch, 0, "$.accountEpoch", issues);
      if (value.maskedPresentation !== null && (typeof value.maskedPresentation !== "string" || value.maskedPresentation.length > 80)) {
        issues.push(issueV1("$.maskedPresentation", "format", "invalid bounded masked presentation"));
      }
      validateMemberV1(value.status, ["active", "signedOut", "revoked"], "$.status", issues);
      validateTimestampV1(value.createdAt, "$.createdAt", issues);
      validateTimestampV1(value.lastSeenAt, "$.lastSeenAt", issues);
      validateTimestampV1(value.updatedAt, "$.updatedAt", issues);
      break;
    case "devices":
      validateIdV1(value.deviceId, "device", "$.deviceId", issues);
      validateMemberV1(value.platformClass, ["macos", "windows", "linux"], "$.platformClass", issues);
      if (value.remoteRegistrationRef !== null) validateIdV1(value.remoteRegistrationRef, "registration", "$.remoteRegistrationRef", issues);
      validateTimestampV1(value.createdAt, "$.createdAt", issues);
      break;
    case "session_generations":
      validateIdV1(value.accountLinkId, "account", "$.accountLinkId", issues);
      validateIdV1(value.deviceId, "device", "$.deviceId", issues);
      validateIntegerV1(value.generation, 1, "$.generation", issues);
      validateMemberV1(value.vaultPurpose, ["refresh-session"], "$.vaultPurpose", issues);
      validateIdV1(value.vaultAliasRef, "vaultref", "$.vaultAliasRef", issues);
      validateMemberV1(value.status, ["active", "superseded", "revoked"], "$.status", issues);
      validateIntegerV1(value.authorityRevision, 0, "$.authorityRevision", issues);
      validateTimestampV1(value.createdAt, "$.createdAt", issues);
      validateTimestampV1(value.updatedAt, "$.updatedAt", issues);
      break;
    case "operation_ledger":
      validateIdV1(value.intentId, "intent", "$.intentId", issues);
      validateIdV1(value.operationId, "operation", "$.operationId", issues);
      if (!isEnumValueV1(value.operation, ACCOUNT_GATEWAY_OPERATION_NAMES_V1)) {
        issues.push(issueV1("$.operation", "enum", "unknown closed Gateway operation"));
      } else if (PERSISTED_READ_OPERATIONS_V1.has(value.operation)) {
        issues.push(issueV1("$.operation", "invariant", "read operations cannot enter the mutation operation ledger"));
      }
      validateShaV1(value.requestFingerprint, "$.requestFingerprint", issues);
      validateMemberV1(value.status, ["pending", "succeeded", "rejected", "outcomeUnknown"], "$.status", issues);
      validateMemberV1(value.remoteDisposition, ["notContacted", "pending", "confirmed", "unconfirmed", "reconciliationPending"], "$.remoteDisposition", issues);
      validateIntegerV1(value.accountEpoch, 0, "$.accountEpoch", issues);
      validateIntegerV1(value.processGeneration, 1, "$.processGeneration", issues);
      if (value.reconcileDeadlineAt !== null) validateTimestampV1(value.reconcileDeadlineAt, "$.reconcileDeadlineAt", issues);
      validateOperationLedgerMatrixV1(value, issues);
      break;
    case "account_cache":
      validateMemberV1(value.slice, ["bootstrap", "profile", "usage", "configuration"], "$.slice", issues);
      validateMemberV1(value.safeViewKind, ["bootstrap", "profile", "usage", "configuration"], "$.safeViewKind", issues);
      if (value.safeViewKind !== value.slice) issues.push(issueV1("$.safeViewKind", "invariant", "cache safe-view kind must match slice"));
      validateMemberV1(value.source, ["authority", "broker"], "$.source", issues);
      validateMemberV1(value.freshness, ["fresh", "softStale", "hardExpired"], "$.freshness", issues);
      validateIntegerV1(value.accountEpoch, 0, "$.accountEpoch", issues);
      validateTimestampV1(value.observedAt, "$.observedAt", issues);
      validateTimestampV1(value.expiresAt, "$.expiresAt", issues);
      break;
    case "external_flows":
      validateMemberV1(value.purpose, ["oauth", "password-reset", "identity-bind"], "$.purpose", issues);
      validateShaV1(value.handleDigest, "$.handleDigest", issues);
      validateMemberV1(value.stateClass, ["waiting", "returned", "terminal"], "$.stateClass", issues);
      validateIntegerV1(value.accountEpoch, 0, "$.accountEpoch", issues);
      validateIntegerV1(value.processGeneration, 1, "$.processGeneration", issues);
      validateMemberV1(value.status, ["pending", "consumed", "expired", "cancelled"], "$.status", issues);
      validateTimestampV1(value.expiresAt, "$.expiresAt", issues);
      break;
    case "config_tasks":
      validateIdV1(value.taskId, "task", "$.taskId", issues);
      validateIdV1(value.accountLinkId, "account", "$.accountLinkId", issues);
      validateIdV1(value.deviceId, "device", "$.deviceId", issues);
      if (value.recipeId !== "doge.account.codex-token-service" || value.recipeVersion !== 1) {
        issues.push(issueV1("$.recipeId", "enum", "unsupported configuration recipe"));
      }
      validateMemberV1(value.state, ["planned", "applying", "terminal", "recoveryRequired"], "$.state", issues);
      validateMemberV1(value.safeSummaryClass, ["offer", "plan", "result", "attention"], "$.safeSummaryClass", issues);
      for (const key of ["unread", "acknowledged", "dismissed"]) {
        if (typeof value[key] !== "boolean") issues.push(issueV1(`$.${key}`, "type", "expected boolean"));
      }
      if (value.receiptRef !== null) validateIdV1(value.receiptRef, "receipt", "$.receiptRef", issues);
      validateTimestampV1(value.updatedAt, "$.updatedAt", issues);
      break;
    case "config_file_receipts":
      validateIdV1(value.transactionId, "transaction", "$.transactionId", issues);
      validateMemberV1(value.fileSlot, ["doge-managed-provider-registry", "codex-provider-config"], "$.fileSlot", issues);
      validateShaV1(value.fingerprint, "$.fingerprint", issues);
      validateMemberV1(value.fingerprintClass, ["precondition", "committed", "rollback"], "$.fingerprintClass", issues);
      validateMemberV1(value.outcome, ["unchanged", "applied", "rolledBack", "rollbackFailed"], "$.outcome", issues);
      validateIntegerV1(value.checkpoint, 0, "$.checkpoint", issues);
      break;
    case "schema_meta":
      if (value.databaseVersion !== 1) issues.push(issueV1("$.databaseVersion", "enum", "unsupported database version"));
      validateMemberV1(value.migrationState, ["current", "migrating", "failed"], "$.migrationState", issues);
      validateMemberV1(value.recoveryState, ["none", "quarantined"], "$.recoveryState", issues);
      validateTimestampV1(value.updatedAt, "$.updatedAt", issues);
      break;
  }
  const privacy = validateAccountSafeArtifactV1(value);
  if (!privacy.ok) issues.push(...privacy.issues);
  return validationV1(value as AccountPersistenceRecordV1, issues);
}

function validateOperationLedgerMatrixV1(
  value: Record<string, unknown>,
  issues: SchemaIssueV1[],
): void {
  const allowedRemoteByStatus: Readonly<Record<string, readonly string[]>> = {
    pending: ["notContacted", "pending"],
    succeeded: ["confirmed", "unconfirmed"],
    rejected: ["notContacted", "confirmed"],
    outcomeUnknown: ["reconciliationPending"],
  };
  if (typeof value.status === "string" && typeof value.remoteDisposition === "string") {
    const allowed = allowedRemoteByStatus[value.status];
    if (allowed && !allowed.includes(value.remoteDisposition)) {
      issues.push(issueV1("$.remoteDisposition", "invariant", "operation ledger status has illegal remote disposition"));
    }
  }
  if (value.status === "outcomeUnknown" && value.reconcileDeadlineAt === null) {
    issues.push(issueV1("$.reconcileDeadlineAt", "invariant", "outcomeUnknown requires a reconciliation deadline"));
  }
  if (value.status !== "outcomeUnknown" && value.reconcileDeadlineAt !== null) {
    issues.push(issueV1("$.reconcileDeadlineAt", "invariant", "only outcomeUnknown may carry a reconciliation deadline"));
  }
}

export function deserializeAccountPersistenceRecordV1(
  serialized: string,
): SchemaValidationV1<AccountPersistenceRecordV1> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return { ok: false, issues: [issueV1("$", "format", "invalid persistence JSON")] };
  }
  const validated = validateAccountPersistenceRecordV1(parsed);
  if (!validated.ok) return validated;
  const rebuilt = rebuildPersistenceRecordV1(validated.value);
  const privacy = validateAccountSafeArtifactV1(rebuilt);
  return privacy.ok ? { ok: true, value: rebuilt } : privacy;
}

function rebuildPersistenceRecordV1(value: AccountPersistenceRecordV1): AccountPersistenceRecordV1 {
  const rebuilt: Record<string, unknown> = {};
  for (const key of Object.keys(value)) rebuilt[key] = value[key as keyof typeof value];
  return rebuilt as AccountPersistenceRecordV1;
}

function validateIdV1(value: unknown, prefix: string, path: string, issues: SchemaIssueV1[]): void {
  if (typeof value !== "string" || !value.startsWith(`${prefix}_`) || !/^[a-z][a-z0-9-]{1,31}_[A-Za-z0-9_-]{6,96}$/.test(value)) {
    issues.push(issueV1(path, "format", `invalid ${prefix} id`));
  }
}

function validateShaV1(value: unknown, path: string, issues: SchemaIssueV1[]): void {
  if (typeof value !== "string" || !SHA256_V1.test(value)) issues.push(issueV1(path, "format", "invalid canonical fingerprint"));
}

function validateTimestampV1(value: unknown, path: string, issues: SchemaIssueV1[]): void {
  if (!isRfc3339UtcV1(value)) issues.push(issueV1(path, "format", "invalid strict RFC3339 UTC timestamp"));
}

function validateIntegerV1(value: unknown, minimum: number, path: string, issues: SchemaIssueV1[]): void {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) issues.push(issueV1(path, "range", `expected safe integer >= ${minimum}`));
}

function validateMemberV1(value: unknown, allowed: readonly string[], path: string, issues: SchemaIssueV1[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) issues.push(issueV1(path, "enum", "unknown closed persistence value"));
}

function validateClosedArrayV1<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
  issues: SchemaIssueV1[],
): void {
  if (!Array.isArray(value)) {
    issues.push(issueV1(path, "type", "expected array"));
    return;
  }
  const strings: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== "string") {
      issues.push(issueV1(`${path}[${index}]`, "type", "expected string persistence member"));
    } else if (!isEnumValueV1(entry, allowed)) {
      issues.push(issueV1(`${path}[${index}]`, "enum", "unknown closed persistence member"));
    } else {
      strings.push(entry);
    }
  });
  collectDuplicateStringsV1(strings).forEach((duplicate) => {
    issues.push(issueV1(path, "duplicate", `duplicate persistence member ${duplicate}`));
  });
  for (const required of allowed) {
    if (!strings.includes(required)) {
      issues.push(issueV1(path, "required", `missing required persistence member ${required}`));
    }
  }
}
