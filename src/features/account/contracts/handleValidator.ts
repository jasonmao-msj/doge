import type {
  AccountHandleBindingV1,
  AccountHandleKindV1,
} from "./semantic";
import type { SchemaIssueV1, SchemaValidationV1 } from "./schema";
import { issueV1, validationV1 } from "./schema";

export type AccountHandleExpectationV1 = {
  readonly kind: AccountHandleKindV1;
  readonly purpose: string;
  readonly accountEpoch: number;
  readonly processGeneration: number;
  readonly nowEpochSeconds: number;
  readonly maxTtlSeconds: number;
};

export type ParsedAccountHandleV1 = AccountHandleBindingV1 & {
  readonly kind: AccountHandleKindV1;
  readonly nonce: string;
};

const HANDLE_PATTERN_V1 =
  /^handle~(auth-attempt|oauth-attempt|external-intent|human-verification|api-key-candidate|config-plan|config-file|config-result)~([a-z][a-z0-9-]{1,31})~e(\d+)~g(\d+)~x(\d+)~([A-Za-z0-9_-]{8,64})$/;

export function parseAccountHandleV1(value: unknown): ParsedAccountHandleV1 | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = HANDLE_PATTERN_V1.exec(value);
  if (!match) {
    return null;
  }
  const [, kind, purpose, epochText, generationText, expiryText, nonce] = match;
  const accountEpoch = Number(epochText);
  const processGeneration = Number(generationText);
  const expiresAtEpochSeconds = Number(expiryText);
  if (
    !Number.isSafeInteger(accountEpoch) ||
    !Number.isSafeInteger(processGeneration) ||
    !Number.isSafeInteger(expiresAtEpochSeconds)
  ) {
    return null;
  }
  return {
    kind: kind as AccountHandleKindV1,
    purpose,
    accountEpoch,
    processGeneration,
    expiresAtEpochSeconds,
    nonce,
  };
}

export function validateAccountHandleV1(
  value: unknown,
  expected: AccountHandleExpectationV1,
): SchemaValidationV1<ParsedAccountHandleV1> {
  const issues: SchemaIssueV1[] = [];
  const parsed = parseAccountHandleV1(value);
  if (!parsed) {
    return { ok: false, issues: [issueV1("$", "format", "invalid bound Account handle")] };
  }
  if (parsed.kind !== expected.kind) {
    issues.push(issueV1("$.kind", "enum", "cross-kind Account handle rejected"));
  }
  if (parsed.purpose !== expected.purpose) {
    issues.push(issueV1("$.purpose", "invariant", "handle purpose mismatch"));
  }
  if (parsed.accountEpoch !== expected.accountEpoch) {
    issues.push(issueV1("$.accountEpoch", "invariant", "stale or wrong-account handle"));
  }
  if (parsed.processGeneration !== expected.processGeneration) {
    issues.push(issueV1("$.processGeneration", "invariant", "stale process-generation handle"));
  }
  const ttl = parsed.expiresAtEpochSeconds - expected.nowEpochSeconds;
  if (ttl <= 0 || ttl > expected.maxTtlSeconds) {
    issues.push(issueV1("$.expiresAtEpochSeconds", "range", "expired or overlong handle TTL"));
  }
  return validationV1(parsed, issues);
}
