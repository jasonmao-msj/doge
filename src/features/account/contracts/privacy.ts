import type { SchemaIssueV1, SchemaValidationV1 } from "./schema";
import { issueV1, validationV1 } from "./schema";

/** Field names that may never appear in a safe renderer/fixture artifact. */
export const ACCOUNT_FORBIDDEN_FIELD_CORPUS_V1 = [
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "refreshCredential",
  "password",
  "currentPassword",
  "newPassword",
  "verifyCode",
  "verificationCode",
  "totpCode",
  "totpSecret",
  "setupToken",
  "desktopTicket",
  "oauthTicket",
  "resetToken",
  "pkceVerifier",
  "clientSecret",
  "apiKey",
  "managedApiKey",
  "humanVerificationProof",
  "authToken",
  "bearerToken",
  "sessionToken",
  "idToken",
  "tokenValue",
  "oauthCode",
  "callbackUrl",
  "serverMessage",
  "rawMessage",
  "token",
  "authorization",
  "cookie",
  "rawUrl",
  "url",
  "path",
  "filePath",
  "rawPath",
  "content",
  "rawContent",
  "diff",
  "patch",
  "message",
  "messageKey",
  "httpBody",
  "headers",
] as const;

/** Synthetic attack strings; never real credentials, users, hosts, or paths. */
export const ACCOUNT_FORBIDDEN_VALUE_CORPUS_V1 = [
  "Bearer synthetic-secret-material",
  "sk-synthetic-secret-material",
  "eyJhbGciOiJub25lIn0.synthetic.signature",
  "https://account.invalid/callback?ticket=synthetic",
  "doge://account/callback?ticket=synthetic",
  "file:///etc/passwd",
  "refreshCredential=synthetic-secret-material",
  "managedApiKey=synthetic-secret-material",
  "humanVerificationProof=synthetic-proof-material",
  "oauthTicket=synthetic-ticket-material",
  "access_token=synthetic-secret-material",
  "server raw message: synthetic upstream detail",
  "/Users/synthetic/private/config.toml",
  "/opt/private/config.toml",
  "C:\\Users\\synthetic\\private\\config.toml",
  "C:\\private\\config.toml",
  "\\\\server\\share\\config.toml",
  "../synthetic/private/config.toml",
  "../secret",
  "synthetic.person@example.invalid",
  "@@ -1,2 +1,2 @@\n-secret\n+replacement",
] as const;

const FORBIDDEN_FIELD_NORMALIZED = new Set(
  ACCOUNT_FORBIDDEN_FIELD_CORPUS_V1.map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, "")),
);

const FORBIDDEN_VALUE_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bsk-[A-Za-z0-9_-]{8,}/i,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s]+/i,
  /^(?:file|data|javascript|mailto|tel|ssh|ftp|smb):[^\s]+/i,
  /(?:^|[\s"'])\/(?!\/)[^\s"']+/,
  /(?:^|[\s"'])[A-Za-z]:\\[^\s"']+/,
  /(?:^|[\s"'])\\\\[^\\\s"']+\\[^\s"']+/,
  /(?:^|[\s"'])\.\.\/(?:[^\s"']+)/,
  /(?:^|[\s"'])\.\/(?:[^\s"']+)/,
  /^(?:[A-Za-z0-9._-]+[\\/])+(?:[A-Za-z0-9._-]+)$/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m,
  /\b(?:refresh[_-]?credential|managed[_-]?api[_-]?key|human[_-]?verification[_-]?proof|oauth[_-]?ticket|access[_-]?token|refresh[_-]?token|auth[_-]?token|bearer[_-]?token|session[_-]?token|id[_-]?token|token[_-]?value)\b/i,
  /\b(?:server|upstream)\s+(?:raw\s+)?(?:message|error)\s*[:=]/i,
  /^(?:totp-svg|totp-manual)~[A-Za-z0-9_-]{8,128}$/,
];

function normalizedFieldV1(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isForbiddenAccountFieldV1(field: string): boolean {
  return FORBIDDEN_FIELD_NORMALIZED.has(normalizedFieldV1(field));
}

export function isForbiddenAccountValueV1(value: string): boolean {
  return FORBIDDEN_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

export type PrivacyScanOptionsV1 = {
  readonly allowTotpOneTimeAtPaths?: readonly string[];
};

function scanValueV1(
  value: unknown,
  path: string,
  issues: SchemaIssueV1[],
  seen: Set<object>,
  options: PrivacyScanOptionsV1,
): void {
  if (typeof value === "string") {
    const oneTimeTotpAllowed = options.allowTotpOneTimeAtPaths?.includes(path) === true &&
      /^(?:totp-svg|totp-manual)~[A-Za-z0-9_-]{8,128}$/.test(value);
    if (!oneTimeTotpAllowed && isForbiddenAccountValueV1(value)) {
      issues.push(issueV1(path, "forbidden", "secret, PII, URL, path, or raw diff-like value"));
    }
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  if (seen.has(value)) {
    issues.push(issueV1(path, "invariant", "cyclic values are not contract artifacts"));
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanValueV1(entry, `${path}[${index}]`, issues, seen, options));
  } else {
    for (const [key, entry] of Object.entries(value)) {
      if (isForbiddenAccountFieldV1(key)) {
        issues.push(issueV1(`${path}.${key}`, "forbidden", "forbidden safe-artifact field"));
      }
      scanValueV1(entry, `${path}.${key}`, issues, seen, options);
    }
  }
  seen.delete(value);
}

export function validateAccountSafeArtifactV1<T>(
  value: T,
  options: PrivacyScanOptionsV1 = {},
): SchemaValidationV1<T> {
  const issues: SchemaIssueV1[] = [];
  scanValueV1(value, "$", issues, new Set<object>(), options);
  return validationV1(value, issues);
}
