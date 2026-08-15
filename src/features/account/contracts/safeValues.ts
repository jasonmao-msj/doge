import type { SchemaIssueV1, SchemaValidationV1 } from "./schema";
import { issueV1, validationV1 } from "./schema";
import {
  isForbiddenAccountFieldV1,
  isForbiddenAccountValueV1,
  validateAccountSafeArtifactV1,
} from "./privacy";

declare const safeLabelBrandV1: unique symbol;
declare const safeTextBrandV1: unique symbol;
declare const oneTimeTotpBrandV1: unique symbol;
declare const safePresentedValueBrandV1: unique symbol;

export type SafeLabelV1 = string & { readonly [safeLabelBrandV1]: "safe-label" };
export type SafeTextV1 = string & { readonly [safeTextBrandV1]: "safe-text" };
export const ACCOUNT_SAFE_LABEL_FIELDS_V1 = [
  "profileDisplayName",
  "primaryEmailLabel",
  "providerLabel",
  "targetLabel",
  "fieldLabel",
  "subscriptionLabel",
  "maskedPresentation",
] as const;
export type AccountSafeLabelFieldV1 = (typeof ACCOUNT_SAFE_LABEL_FIELDS_V1)[number];
export const ACCOUNT_SAFE_TEXT_FIELDS_V1 = ["configurationValue"] as const;
export type AccountSafeTextFieldV1 = (typeof ACCOUNT_SAFE_TEXT_FIELDS_V1)[number];
export type AccountClosedSafeLabelV1 =
  | "Synthetic doge account"
  | "Synthetic account email"
  | "Synthetic label"
  | "Synthetic good"
  | "Synthetic base"
  | "Codex"
  | "Codex settings"
  | "Provider"
  | "Managed credential";
export type AccountClosedSafeTextV1 =
  | "Synthetic value"
  | "Synthetic good value"
  | "Synthetic base value";
export type OneTimeTotpPresentationV1 = string & {
  readonly [oneTimeTotpBrandV1]: "one-time-totp-presentation";
};
export type SafePresentedValueInputV1 =
  | { readonly kind: "absent" }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "enum"; readonly label: SafeLabelV1 }
  | { readonly kind: "safeText"; readonly text: SafeTextV1 }
  | {
      readonly kind: "redacted";
      readonly label: "managedCredential" | "userValue" | "sensitiveValue";
    };
export type StaticRedactedSafePresentedValueV1 = Extract<
  SafePresentedValueInputV1,
  { readonly kind: "redacted" }
>;
export type SafePresentedValueV1 = SafePresentedValueInputV1 & {
  readonly [safePresentedValueBrandV1]: "safe-presented-value";
};
export type ValidatedSafePresentedValueV1 = SafePresentedValueV1;

const SAFE_LABEL_PATTERN_V1 = /^[\p{L}\p{N}][\p{L}\p{N} ._()/:+-]{0,79}$/u;
const PRIMARY_EMAIL_LABEL_PATTERN_V1 =
  /^[\p{L}\p{N}][\p{L}\p{N} ._()@*+-]{0,79}$/u;
const ONE_TIME_TOTP_PATTERN_V1 = /^(?:totp-svg|totp-manual)~[A-Za-z0-9_-]{8,128}$/;
const URI_SCHEME_PREFIX_V1 = /^[a-z][a-z0-9+.-]*:/i;

export function validateSafeLabelV1(value: unknown): SchemaValidationV1<SafeLabelV1> {
  return validateSafeLabelForFieldV1("targetLabel", value);
}

export function validateSafeLabelForFieldV1(
  field: AccountSafeLabelFieldV1,
  value: unknown,
): SchemaValidationV1<SafeLabelV1> {
  const issues: SchemaIssueV1[] = [];
  const pattern = field === "primaryEmailLabel"
    ? PRIMARY_EMAIL_LABEL_PATTERN_V1
    : SAFE_LABEL_PATTERN_V1;
  if (
    typeof value !== "string" ||
    !pattern.test(value) ||
    URI_SCHEME_PREFIX_V1.test(value) ||
    isForbiddenAccountValueV1(value) ||
    isForbiddenAccountFieldV1(value)
  ) {
    issues.push(issueV1("$", "forbidden", "value is not an allowlisted safe label"));
  }
  return validationV1(value as SafeLabelV1, issues);
}

export function safeLabelV1(value: AccountClosedSafeLabelV1): SafeLabelV1;
export function safeLabelV1(value: string, field: AccountSafeLabelFieldV1): SafeLabelV1;
export function safeLabelV1(value: string, field: AccountSafeLabelFieldV1 = "targetLabel"): SafeLabelV1 {
  const result = validateSafeLabelForFieldV1(field, value);
  if (!result.ok) {
    throw new Error("Invalid Account SafeLabelV1");
  }
  return result.value;
}

export function validateSafeTextV1(value: unknown): SchemaValidationV1<SafeTextV1> {
  return validateSafeTextForFieldV1("configurationValue", value);
}

export function validateSafeTextForFieldV1(
  _field: AccountSafeTextFieldV1,
  value: unknown,
): SchemaValidationV1<SafeTextV1> {
  const issues: SchemaIssueV1[] = [];
  if (
    typeof value !== "string" ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < 32 || codePoint === 127;
    }) ||
    value.length < 1 ||
    value.length > 256 ||
    URI_SCHEME_PREFIX_V1.test(value) ||
    isForbiddenAccountValueV1(value)
  ) {
    issues.push(issueV1("$", "forbidden", "value is not allowlisted safe text"));
  }
  return validationV1(value as SafeTextV1, issues);
}

export function safeTextV1(value: AccountClosedSafeTextV1): SafeTextV1;
export function safeTextV1(value: string, field: AccountSafeTextFieldV1): SafeTextV1;
export function safeTextV1(value: string, field: AccountSafeTextFieldV1 = "configurationValue"): SafeTextV1 {
  const result = validateSafeTextForFieldV1(field, value);
  if (!result.ok) {
    throw new Error("Invalid Account SafeTextV1");
  }
  return result.value;
}

export function oneTimeTotpPresentationV1(
  value: string,
): OneTimeTotpPresentationV1 {
  if (!ONE_TIME_TOTP_PATTERN_V1.test(value)) {
    throw new Error("Invalid one-time TOTP presentation value");
  }
  return value as OneTimeTotpPresentationV1;
}

export function isOneTimeTotpPresentationV1(
  value: unknown,
): value is OneTimeTotpPresentationV1 {
  return typeof value === "string" && ONE_TIME_TOTP_PATTERN_V1.test(value);
}

export function validateSafePresentedValueV1(
  value: unknown,
): SchemaValidationV1<ValidatedSafePresentedValueV1> {
  const issues: SchemaIssueV1[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected SafePresentedValueV1 object")] };
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const exact = (expected: readonly string[]) =>
    keys.length === expected.length && expected.every((key) => keys.includes(key));
  switch (record.kind) {
    case "absent":
      if (!exact(["kind"])) issues.push(issueV1("$", "invariant", "unexpected absent presentation field"));
      break;
    case "boolean":
      if (!exact(["kind", "value"]) || typeof record.value !== "boolean") {
        issues.push(issueV1("$.value", "type", "expected exact boolean presentation"));
      }
      break;
    case "number":
      if (!exact(["kind", "value"]) || !Number.isSafeInteger(record.value)) {
        issues.push(issueV1("$.value", "range", "expected exact safe-integer presentation"));
      }
      break;
    case "enum": {
      const label = validateSafeLabelV1(record.label);
      if (!exact(["kind", "label"]) || !label.ok) {
        issues.push(issueV1("$.label", "forbidden", "invalid enum presentation label"));
      }
      break;
    }
    case "safeText": {
      const text = validateSafeTextV1(record.text);
      if (!exact(["kind", "text"]) || !text.ok) {
        issues.push(issueV1("$.text", "forbidden", "invalid safe text presentation"));
      }
      break;
    }
    case "redacted":
      if (!exact(["kind", "label"]) ||
        !["managedCredential", "userValue", "sensitiveValue"].includes(String(record.label))
      ) {
        issues.push(issueV1("$.label", "enum", "invalid redacted presentation label"));
      }
      break;
    default:
      issues.push(issueV1("$.kind", "enum", "unknown SafePresentedValueV1 kind"));
  }
  const privacy = validateAccountSafeArtifactV1(value);
  if (!privacy.ok) issues.push(...privacy.issues);
  return validationV1(value as ValidatedSafePresentedValueV1, issues);
}

export function safePresentedValueV1(
  value: SafePresentedValueInputV1,
): ValidatedSafePresentedValueV1 {
  const validated = validateSafePresentedValueV1(value);
  if (!validated.ok) throw new Error("Invalid Account SafePresentedValueV1");
  return validated.value;
}
