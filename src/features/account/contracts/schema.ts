export type SchemaIssueV1 = {
  readonly path: string;
  readonly code:
    | "required"
    | "type"
    | "enum"
    | "format"
    | "range"
    | "duplicate"
    | "forbidden"
    | "invariant";
  readonly detail: string;
};

export type SchemaValidationV1<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly SchemaIssueV1[] };

export function isRecordV1(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStringV1(value: unknown): value is string {
  return typeof value === "string";
}

export function isBooleanV1(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isNonNegativeIntegerV1(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function isPositiveIntegerV1(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function isRfc3339UtcV1(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!match) {
    return false;
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fractionText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const milliseconds = Number((fractionText ?? "").slice(0, 3).padEnd(3, "0"));
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  const instant = new Date(Date.UTC(year, month - 1, day, hour, minute, second, milliseconds));
  return instant.getUTCFullYear() === year &&
    instant.getUTCMonth() === month - 1 &&
    instant.getUTCDate() === day &&
    instant.getUTCHours() === hour &&
    instant.getUTCMinutes() === minute &&
    instant.getUTCSeconds() === second &&
    instant.getUTCMilliseconds() === milliseconds;
}

export function isSemVerV1(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
}

export function isCanonicalDecimalStringV1(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/.test(value);
}

export function isOpaqueSafeIdV1(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{1,31}_[A-Za-z0-9_-]{6,96}$/.test(value);
}

export function isEnumValueV1<const T extends readonly string[]>(
  value: unknown,
  values: T,
): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function issueV1(
  path: string,
  code: SchemaIssueV1["code"],
  detail: string,
): SchemaIssueV1 {
  return { path, code, detail };
}

export function validationV1<T>(
  value: T,
  issues: readonly SchemaIssueV1[],
): SchemaValidationV1<T> {
  return issues.length === 0 ? { ok: true, value } : { ok: false, issues };
}

export function requireRecordV1(
  value: unknown,
  path: string,
  issues: SchemaIssueV1[],
): Record<string, unknown> | null {
  if (!isRecordV1(value)) {
    issues.push(issueV1(path, "type", "expected object"));
    return null;
  }
  return value;
}

export function requireStringV1(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: SchemaIssueV1[],
): string | null {
  const value = record[key];
  if (typeof value !== "string") {
    issues.push(issueV1(`${path}.${key}`, value === undefined ? "required" : "type", "expected string"));
    return null;
  }
  return value;
}

export function requireArrayV1(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: SchemaIssueV1[],
): readonly unknown[] | null {
  const value = record[key];
  if (!Array.isArray(value)) {
    issues.push(issueV1(`${path}.${key}`, value === undefined ? "required" : "type", "expected array"));
    return null;
  }
  return value;
}

export function requireBooleanV1(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: SchemaIssueV1[],
): boolean | null {
  const value = record[key];
  if (typeof value !== "boolean") {
    issues.push(issueV1(`${path}.${key}`, value === undefined ? "required" : "type", "expected boolean"));
    return null;
  }
  return value;
}

export function requireNonNegativeIntegerV1(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: SchemaIssueV1[],
): number | null {
  const value = record[key];
  if (!isNonNegativeIntegerV1(value)) {
    issues.push(issueV1(`${path}.${key}`, value === undefined ? "required" : "range", "expected non-negative safe integer"));
    return null;
  }
  return value;
}

export function validateKeysV1(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: SchemaIssueV1[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) {
      issues.push(issueV1(`${path}.${key}`, "invariant", "unexpected v1 field"));
    }
  }
}

export function validateExactKeysV1(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
  issues: SchemaIssueV1[],
): void {
  validateKeysV1(record, [...required, ...optional], path, issues);
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      issues.push(issueV1(`${path}.${key}`, "required", "missing required v1 field"));
    }
  }
}

export type RuntimeSchemaV1 =
  | { readonly kind: "string"; readonly minLength?: number; readonly maxLength?: number }
  | { readonly kind: "boolean" }
  | { readonly kind: "integer"; readonly minimum?: number }
  | { readonly kind: "literal"; readonly value: string | number | boolean | null }
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | { readonly kind: "timestamp" }
  | { readonly kind: "decimal" }
  | { readonly kind: "opaqueId"; readonly prefix: string }
  | { readonly kind: "safeLabel"; readonly field: string }
  | { readonly kind: "safeText"; readonly field: string }
  | { readonly kind: "emailInput" }
  | { readonly kind: "secretInput" }
  | { readonly kind: "oneTimeTotp" }
  | {
      readonly kind: "handle";
      readonly handleKind: string;
      readonly purpose: string | readonly string[];
    }
  | { readonly kind: "array"; readonly item: RuntimeSchemaV1; readonly minItems?: number }
  | {
      readonly kind: "record";
      readonly allowedKeys: readonly string[];
      readonly value: RuntimeSchemaV1;
    }
  | { readonly kind: "nullable"; readonly inner: RuntimeSchemaV1 }
  | {
      readonly kind: "object";
      readonly required: Readonly<Record<string, RuntimeSchemaV1>>;
      readonly optional?: Readonly<Record<string, RuntimeSchemaV1>>;
    }
  | {
      readonly kind: "union";
      readonly discriminator: string;
      readonly variants: Readonly<Record<string, RuntimeSchemaV1>>;
    }
  | { readonly kind: "anyOf"; readonly variants: readonly RuntimeSchemaV1[] };

export type RuntimeSchemaExtensionV1 = (
  schema: Extract<RuntimeSchemaV1, {
    kind:
      | "safeLabel"
      | "safeText"
      | "emailInput"
      | "secretInput"
      | "oneTimeTotp"
      | "handle";
  }>,
  value: unknown,
  path: string,
  issues: SchemaIssueV1[],
) => void;

export function validateRuntimeSchemaV1(
  schema: RuntimeSchemaV1,
  value: unknown,
  path: string,
  issues: SchemaIssueV1[],
  extension: RuntimeSchemaExtensionV1,
): void {
  switch (schema.kind) {
    case "string":
      if (typeof value !== "string" ||
        (schema.minLength !== undefined && value.length < schema.minLength) ||
        (schema.maxLength !== undefined && value.length > schema.maxLength)
      ) {
        issues.push(issueV1(path, "format", "invalid bounded string"));
      }
      return;
    case "boolean":
      if (typeof value !== "boolean") {
        issues.push(issueV1(path, "type", "expected boolean"));
      }
      return;
    case "integer":
      if (!Number.isSafeInteger(value) || Number(value) < (schema.minimum ?? Number.MIN_SAFE_INTEGER)) {
        issues.push(issueV1(path, "range", "invalid safe integer"));
      }
      return;
    case "literal":
      if (value !== schema.value) {
        issues.push(issueV1(path, "enum", `expected literal ${String(schema.value)}`));
      }
      return;
    case "enum":
      if (typeof value !== "string" || !schema.values.includes(value)) {
        issues.push(issueV1(path, "enum", "unknown closed v1 value"));
      }
      return;
    case "timestamp":
      if (!isRfc3339UtcV1(value)) {
        issues.push(issueV1(path, "format", "expected strict RFC 3339 UTC timestamp"));
      }
      return;
    case "decimal":
      if (!isCanonicalDecimalStringV1(value)) {
        issues.push(issueV1(path, "format", "expected canonical non-negative decimal string"));
      }
      return;
    case "opaqueId":
      if (typeof value !== "string" || !value.startsWith(`${schema.prefix}_`) || !isOpaqueSafeIdV1(value)) {
        issues.push(issueV1(path, "format", `expected opaque ${schema.prefix} id`));
      }
      return;
    case "safeLabel":
    case "safeText":
    case "emailInput":
    case "secretInput":
    case "oneTimeTotp":
    case "handle":
      extension(schema, value, path, issues);
      return;
    case "array":
      if (!Array.isArray(value)) {
        issues.push(issueV1(path, "type", "expected array"));
        return;
      }
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        issues.push(issueV1(path, "range", "array has too few members"));
      }
      value.forEach((entry, index) =>
        validateRuntimeSchemaV1(schema.item, entry, `${path}[${index}]`, issues, extension));
      return;
    case "record":
      if (!isRecordV1(value)) {
        issues.push(issueV1(path, "type", "expected record"));
        return;
      }
      for (const [key, entry] of Object.entries(value)) {
        if (!schema.allowedKeys.includes(key)) {
          issues.push(issueV1(`${path}.${key}`, "enum", "unknown closed record key"));
        } else {
          validateRuntimeSchemaV1(schema.value, entry, `${path}.${key}`, issues, extension);
        }
      }
      return;
    case "nullable":
      if (value !== null) {
        validateRuntimeSchemaV1(schema.inner, value, path, issues, extension);
      }
      return;
    case "object": {
      if (!isRecordV1(value)) {
        issues.push(issueV1(path, "type", "expected object"));
        return;
      }
      const optional = schema.optional ?? {};
      validateExactKeysV1(
        value,
        Object.keys(schema.required),
        Object.keys(optional),
        path,
        issues,
      );
      for (const [key, child] of Object.entries(schema.required)) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          validateRuntimeSchemaV1(child, value[key], `${path}.${key}`, issues, extension);
        }
      }
      for (const [key, child] of Object.entries(optional)) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          validateRuntimeSchemaV1(child, value[key], `${path}.${key}`, issues, extension);
        }
      }
      return;
    }
    case "union": {
      if (!isRecordV1(value)) {
        issues.push(issueV1(path, "type", "expected discriminated object"));
        return;
      }
      const discriminator = value[schema.discriminator];
      if (typeof discriminator !== "string" || !(discriminator in schema.variants)) {
        issues.push(issueV1(`${path}.${schema.discriminator}`, "enum", "unknown union discriminator"));
        return;
      }
      validateRuntimeSchemaV1(schema.variants[discriminator], value, path, issues, extension);
      return;
    }
    case "anyOf": {
      const attempts = schema.variants.map((variant) => {
        const attemptIssues: SchemaIssueV1[] = [];
        validateRuntimeSchemaV1(variant, value, path, attemptIssues, extension);
        return attemptIssues;
      });
      if (!attempts.some((attempt) => attempt.length === 0)) {
        issues.push(issueV1(path, "invariant", "value matches no closed v1 variant"));
      }
      return;
    }
  }
}

export function collectDuplicateStringsV1(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates].sort();
}
