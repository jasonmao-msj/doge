import {
  TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1,
  type BrokerOperationIdV1,
} from "./semantic";
import {
  AUTHORITY_GUARANTEES_V1,
  type AuthorityGuaranteeV1,
} from "./compatibility";
import type { SchemaIssueV1, SchemaValidationV1 } from "./schema";
import {
  collectDuplicateStringsV1,
  isBooleanV1,
  isEnumValueV1,
  isRecordV1,
  isRfc3339UtcV1,
  issueV1,
  validateExactKeysV1,
  validationV1,
} from "./schema";
import { validateAccountSafeArtifactV1 } from "./privacy";

export const AUTHORITY_CAPABILITY_KEYS_V1 = [
  "registration",
  "registrationEmailVerification",
  "passwordLogin",
  "passwordReset",
  "humanVerification",
  "mfa",
  "oauth.github",
  "oauth.google",
  "oauth.linuxdo",
  "oauth.wechat",
  "oauth.oidc",
  "oauth.dingtalk",
  "profile",
  "passwordChange",
  "totp",
  "identityBindings",
  "revokeAllSessions",
  "quotaPull",
  "subscriptionSummary",
  "apiKeyList",
  "apiKeyHandoff",
  "managedKeyProvision",
  "managedKeyRotate",
  "managedKeyRevoke",
] as const;
export type AuthorityCapabilityKeyV1 = (typeof AUTHORITY_CAPABILITY_KEYS_V1)[number];

export const AUTHORITY_STABLE_REASONS_V1 = [
  "INVALID_INPUT",
  "INVALID_CREDENTIALS",
  "ACCOUNT_INACTIVE",
  "POLICY_BLOCKED",
  "CHALLENGE_REJECTED",
  "CHALLENGE_EXPIRED",
  "VERIFICATION_REJECTED",
  "VERIFICATION_EXPIRED",
  "MFA_REJECTED",
  "MFA_EXPIRED",
  "OAUTH_DENIED",
  "OAUTH_STATE_MISMATCH",
  "COMPLETION_EXPIRED",
  "COMPLETION_REPLAYED",
  "SESSION_EXPIRED",
  "SESSION_REVOKED",
  "RATE_LIMITED",
  "CAPABILITY_DISABLED",
  "IDEMPOTENCY_CONFLICT",
  "OUTCOME_UNKNOWN",
] as const;
export type AuthorityStableReasonV1 = (typeof AUTHORITY_STABLE_REASONS_V1)[number];

export const AUTHORITY_OPERATION_NAMES_V1 = [
  "capabilities.read",
  "registration.sendCode",
  "registration.complete",
  "auth.login",
  "auth.completeMfa",
  "oauth.beginDesktop",
  "oauth.observeDesktop",
  "oauth.completeDesktop",
  "passwordReset.request",
  "passwordReset.observeDesktop",
  "passwordReset.complete",
  "session.refresh",
  "session.logout",
  "session.revokeAll",
  "profile.read",
  "profile.update",
  "security.changePassword",
  "security.totpStatus",
  "security.totpSendCode",
  "security.totpBegin",
  "security.totpConfirm",
  "security.totpDisable",
  "security.identityBind",
  "security.identityUnbind",
  "usage.read",
  "apiKey.listMetadata",
  "apiKey.handoffDesktop",
  "managedKey.readMetadata",
  "managedKey.provision",
  "managedKey.rotate",
  "managedKey.revoke",
] as const;
export type AuthorityOperationNameV1 =
  (typeof AUTHORITY_OPERATION_NAMES_V1)[number];

export type AuthorityCapabilityDescriptorV1 = {
  readonly contractId: typeof TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.id;
  readonly contractVersion: typeof TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.version;
  readonly observedAt: string;
  readonly capabilities: Readonly<Partial<Record<AuthorityCapabilityKeyV1, boolean>>>;
  readonly guarantees: readonly AuthorityGuaranteeV1[];
};

export type AuthoritySafeFailureEnvelopeV1 = {
  readonly contractId: typeof TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.id;
  readonly contractVersion: typeof TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.version;
  readonly ok: false;
  readonly reason: AuthorityStableReasonV1;
  readonly retryAfterMs: number | null;
};

export type AuthoritySafeOutcomeEnvelopeV1<T> = {
  readonly contractId: typeof TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.id;
  readonly contractVersion: typeof TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.version;
  readonly ok: true;
  readonly value: T;
};

/** Private Rust-to-Authority request. Its payload never crosses IPC or traces. */
export type AuthorityPrivateRequestEnvelopeV1<TPrivatePayload> = {
  readonly contractId: typeof TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.id;
  readonly contractVersion: typeof TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.version;
  readonly operation: AuthorityOperationNameV1;
  readonly idempotencyOperationId: BrokerOperationIdV1 | null;
  readonly payload: TPrivatePayload;
};

export type AuthoritySafeResponseEnvelopeV1<TSafeValue> =
  | AuthoritySafeOutcomeEnvelopeV1<TSafeValue>
  | AuthoritySafeFailureEnvelopeV1;

export function validateAuthorityCapabilityDescriptorV1(
  value: unknown,
): SchemaValidationV1<AuthorityCapabilityDescriptorV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected Authority descriptor object")] };
  }
  validateExactKeysV1(
    value,
    ["contractId", "contractVersion", "observedAt", "capabilities", "guarantees"],
    [],
    "$",
    issues,
  );
  if (value.contractId !== TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.id) {
    issues.push(issueV1("$.contractId", "enum", "unexpected Authority contract id"));
  }
  if (value.contractVersion !== TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.version) {
    issues.push(issueV1("$.contractVersion", "enum", "unsupported Authority contract major/version"));
  }
  if (!isRfc3339UtcV1(value.observedAt)) {
    issues.push(issueV1("$.observedAt", "format", "expected RFC 3339 UTC timestamp"));
  }
  if (!isRecordV1(value.capabilities)) {
    issues.push(issueV1("$.capabilities", "type", "expected capability map"));
  } else {
    for (const [key, enabled] of Object.entries(value.capabilities)) {
      if (!isEnumValueV1(key, AUTHORITY_CAPABILITY_KEYS_V1)) {
        issues.push(issueV1(`$.capabilities.${key}`, "enum", "unknown Authority capability"));
      }
      if (!isBooleanV1(enabled)) {
        issues.push(issueV1(`$.capabilities.${key}`, "type", "expected boolean capability state"));
      }
    }
  }
  if (!Array.isArray(value.guarantees)) {
    issues.push(issueV1("$.guarantees", "type", "expected guarantee array"));
  } else {
    const guarantees: string[] = [];
    value.guarantees.forEach((entry, index) => {
      if (typeof entry !== "string") {
        issues.push(issueV1(`$.guarantees[${index}]`, "type", "expected string guarantee"));
      } else if (!isEnumValueV1(entry, AUTHORITY_GUARANTEES_V1)) {
        issues.push(issueV1(`$.guarantees[${index}]`, "enum", "unknown Authority guarantee"));
      } else {
        guarantees.push(entry);
      }
    });
    collectDuplicateStringsV1(guarantees).forEach((duplicate) => {
      issues.push(issueV1("$.guarantees", "duplicate", `duplicate guarantee ${duplicate}`));
    });
  }
  return validationV1(value as AuthorityCapabilityDescriptorV1, issues);
}

export function validateAuthoritySafeResponseV1<TSafeValue>(
  value: unknown,
  validateSafeValue: (value: unknown) => SchemaValidationV1<TSafeValue>,
): SchemaValidationV1<AuthoritySafeResponseEnvelopeV1<TSafeValue>> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected Authority response object")] };
  }
  validateExactKeysV1(
    value,
    value.ok === true
      ? ["contractId", "contractVersion", "ok", "value"]
      : ["contractId", "contractVersion", "ok", "reason", "retryAfterMs"],
    [],
    "$",
    issues,
  );
  if (value.contractId !== TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.id ||
    value.contractVersion !== TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.version
  ) {
    issues.push(issueV1("$.contractVersion", "enum", "unsupported Authority response contract"));
  }
  if (value.ok === true) {
    const validated = validateSafeValue(value.value);
    if (!validated.ok) {
      issues.push(...validated.issues.map((entry) => ({
        ...entry,
        path: `$.value${entry.path === "$" ? "" : entry.path.slice(1)}`,
      })));
    }
  } else if (value.ok === false) {
    if (!isEnumValueV1(value.reason, AUTHORITY_STABLE_REASONS_V1)) {
      issues.push(issueV1("$.reason", "enum", "unknown stable Authority reason"));
    }
    if (value.retryAfterMs !== null &&
      (!Number.isSafeInteger(value.retryAfterMs) || Number(value.retryAfterMs) < 0)
    ) {
      issues.push(issueV1("$.retryAfterMs", "range", "expected null or non-negative milliseconds"));
    }
  } else {
    issues.push(issueV1("$.ok", "type", "expected Authority response discriminator"));
  }
  const privacy = validateAccountSafeArtifactV1(value);
  if (!privacy.ok) issues.push(...privacy.issues);
  return validationV1(value as AuthoritySafeResponseEnvelopeV1<TSafeValue>, issues);
}

export function validateAuthorityPrivateRequestV1<TPrivatePayload>(
  value: unknown,
  validatePrivatePayload: (operation: AuthorityOperationNameV1, value: unknown) => SchemaValidationV1<TPrivatePayload>,
): SchemaValidationV1<AuthorityPrivateRequestEnvelopeV1<TPrivatePayload>> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected private Authority request object")] };
  }
  validateExactKeysV1(
    value,
    ["contractId", "contractVersion", "operation", "idempotencyOperationId", "payload"],
    [],
    "$",
    issues,
  );
  if (value.contractId !== TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.id ||
    value.contractVersion !== TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.version
  ) {
    issues.push(issueV1("$.contractVersion", "enum", "unsupported private Authority contract"));
  }
  if (!isEnumValueV1(value.operation, AUTHORITY_OPERATION_NAMES_V1)) {
    issues.push(issueV1("$.operation", "enum", "unknown private Authority operation"));
  } else {
    const payload = validatePrivatePayload(value.operation, value.payload);
    if (!payload.ok) {
      issues.push(...payload.issues.map((entry) => ({
        ...entry,
        path: `$.payload${entry.path === "$" ? "" : entry.path.slice(1)}`,
      })));
    }
  }
  if (value.idempotencyOperationId !== null && (
    typeof value.idempotencyOperationId !== "string" ||
    !/^operation_[A-Za-z0-9_-]{6,96}$/.test(value.idempotencyOperationId)
  )) {
    issues.push(issueV1("$.idempotencyOperationId", "format", "invalid Broker operation identity"));
  }
  return validationV1(value as AuthorityPrivateRequestEnvelopeV1<TPrivatePayload>, issues);
}
