import {
  CODEX_TOKEN_SERVICE_RECIPE_V1,
  DOGE_CONFIG_RECIPE_CONTRACT_V1,
} from "./semantic";
import type { SchemaIssueV1, SchemaValidationV1 } from "./schema";
import {
  collectDuplicateStringsV1,
  isEnumValueV1,
  isRecordV1,
  issueV1,
  validateExactKeysV1,
  validationV1,
} from "./schema";
import { validateAccountSafeArtifactV1 } from "./privacy";

export const CONFIG_RECIPE_WRITE_SLOTS_V1 = [
  "doge-managed-provider-registry",
  "codex-provider-config",
] as const;
export type ConfigRecipeWriteSlotV1 = (typeof CONFIG_RECIPE_WRITE_SLOTS_V1)[number];

export const CONFIG_RECIPE_FORBIDDEN_WRITE_SLOTS_V1 = [
  "codex-auth-json",
  "shell-profile",
  "arbitrary-user-path",
] as const;
export type ConfigRecipeForbiddenWriteSlotV1 =
  (typeof CONFIG_RECIPE_FORBIDDEN_WRITE_SLOTS_V1)[number];

export const CONFIG_FILES_OUTCOMES_V1 = [
  "unchanged",
  "applied",
  "rolledBack",
  "rollbackIncomplete",
  "aborted",
] as const;

export const CONFIG_FILE_OUTCOMES_V1 = [
  "unchanged",
  "applied",
  "rolledBack",
  "rollbackFailed",
  "skippedPrecondition",
  "failedBeforeWrite",
] as const;

export const CONFIG_RELOAD_OUTCOMES_V1 = [
  "notNeeded",
  "pending",
  "applied",
  "failed",
] as const;

export type ConfigRecipeSchemaV1 = {
  readonly contractId: typeof DOGE_CONFIG_RECIPE_CONTRACT_V1.id;
  readonly contractVersion: typeof DOGE_CONFIG_RECIPE_CONTRACT_V1.version;
  readonly recipeId: typeof CODEX_TOKEN_SERVICE_RECIPE_V1.id;
  readonly recipeVersion: typeof CODEX_TOKEN_SERVICE_RECIPE_V1.version;
  readonly targetEngine: "codex";
  readonly targetHostClass: "local-desktop";
  readonly credentialPurpose: "codex-token-service";
  readonly writeSlots: readonly ConfigRecipeWriteSlotV1[];
  readonly forbiddenWriteSlots: readonly ConfigRecipeForbiddenWriteSlotV1[];
  readonly runtimeCredentialMode: "child-process-env-from-vault";
  readonly reloadRequirement: "newSessions";
  readonly authorityOriginSource: "signed-build-channel";
};

export const CODEX_TOKEN_SERVICE_RECIPE_SCHEMA_V1: ConfigRecipeSchemaV1 = {
  contractId: DOGE_CONFIG_RECIPE_CONTRACT_V1.id,
  contractVersion: DOGE_CONFIG_RECIPE_CONTRACT_V1.version,
  recipeId: CODEX_TOKEN_SERVICE_RECIPE_V1.id,
  recipeVersion: CODEX_TOKEN_SERVICE_RECIPE_V1.version,
  targetEngine: "codex",
  targetHostClass: "local-desktop",
  credentialPurpose: "codex-token-service",
  writeSlots: CONFIG_RECIPE_WRITE_SLOTS_V1,
  forbiddenWriteSlots: CONFIG_RECIPE_FORBIDDEN_WRITE_SLOTS_V1,
  runtimeCredentialMode: "child-process-env-from-vault",
  reloadRequirement: "newSessions",
  authorityOriginSource: "signed-build-channel",
};

export function validateConfigRecipeV1(
  value: unknown,
): SchemaValidationV1<ConfigRecipeSchemaV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected config recipe object")] };
  }
  validateExactKeysV1(
    value,
    [
      "contractId", "contractVersion", "recipeId", "recipeVersion", "targetEngine",
      "targetHostClass", "credentialPurpose", "writeSlots", "forbiddenWriteSlots",
      "runtimeCredentialMode", "reloadRequirement", "authorityOriginSource",
    ],
    [],
    "$",
    issues,
  );
  const exactScalars: Readonly<Record<string, string | number>> = {
    contractId: DOGE_CONFIG_RECIPE_CONTRACT_V1.id,
    contractVersion: DOGE_CONFIG_RECIPE_CONTRACT_V1.version,
    recipeId: CODEX_TOKEN_SERVICE_RECIPE_V1.id,
    recipeVersion: CODEX_TOKEN_SERVICE_RECIPE_V1.version,
    targetEngine: "codex",
    targetHostClass: "local-desktop",
    credentialPurpose: "codex-token-service",
    runtimeCredentialMode: "child-process-env-from-vault",
    reloadRequirement: "newSessions",
    authorityOriginSource: "signed-build-channel",
  };
  for (const [key, expected] of Object.entries(exactScalars)) {
    if (value[key] !== expected) {
      issues.push(issueV1(`$.${key}`, "enum", `expected immutable recipe value ${String(expected)}`));
    }
  }
  validateSlotsV1(value.writeSlots, CONFIG_RECIPE_WRITE_SLOTS_V1, "$.writeSlots", issues);
  validateSlotsV1(
    value.forbiddenWriteSlots,
    CONFIG_RECIPE_FORBIDDEN_WRITE_SLOTS_V1,
    "$.forbiddenWriteSlots",
    issues,
  );
  const privacy = validateAccountSafeArtifactV1(value);
  if (!privacy.ok) {
    issues.push(...privacy.issues);
  }
  return validationV1(value as ConfigRecipeSchemaV1, issues);
}

function validateSlotsV1<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
  issues: SchemaIssueV1[],
): void {
  if (!Array.isArray(value)) {
    issues.push(issueV1(path, "type", "expected slot array"));
    return;
  }
  const strings: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== "string") {
      issues.push(issueV1(`${path}[${index}]`, "type", "expected string recipe slot"));
    } else if (!isEnumValueV1(entry, allowed)) {
      issues.push(issueV1(`${path}[${index}]`, "enum", "unknown recipe slot"));
    } else {
      strings.push(entry);
    }
  });
  collectDuplicateStringsV1(strings).forEach((duplicate) => {
    issues.push(issueV1(path, "duplicate", `duplicate recipe slot ${duplicate}`));
  });
  for (const required of allowed) {
    if (!strings.includes(required)) {
      issues.push(issueV1(path, "required", `missing immutable recipe slot ${required}`));
    }
  }
}
