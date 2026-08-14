import {
  ACCOUNT_CONTRACT_VERSION_V1,
  LOCAL_MODE_INVARIANT_V1,
  type AccountConvenienceCompatibilityV1,
} from "./semantic";
import { isRecordV1, isSemVerV1 } from "./schema";

export const AUTHORITY_GUARANTEES_V1 = [
  "durable_token_pair_v1",
  "atomic_refresh_replay_v1",
  "durable_revocation_generation_v1",
  "desktop_oauth_ticket_v1",
  "desktop_reset_handoff_v1",
  "desktop_human_verification_v1",
  "api_key_one_time_secret_v1",
  "api_key_metadata_only_reads_v1",
  "api_key_owner_handoff_v1",
  "api_key_recoverable_encryption_v1",
  "stable_account_reasons_v1",
  "typed_logout_outcome_v1",
] as const;

export type AuthorityGuaranteeV1 = (typeof AUTHORITY_GUARANTEES_V1)[number];

export type AccountContractDescriptorV1 = {
  readonly id: string;
  readonly version: string;
  readonly guarantees: readonly AuthorityGuaranteeV1[];
};

function parseMajorV1(version: string): number | null {
  if (!isSemVerV1(version)) {
    return null;
  }
  return Number(version.slice(0, version.indexOf(".")));
}

export function evaluateAccountConvenienceCompatibilityV1(
  value: unknown,
  expectedId: string,
  requiredGuarantees: readonly AuthorityGuaranteeV1[],
): AccountConvenienceCompatibilityV1 {
  if (!isRecordV1(value)) {
    return {
      available: false,
      localMode: LOCAL_MODE_INVARIANT_V1,
      reason: "protocolMismatch",
    };
  }

  const id = value.id ?? value.contractId;
  const version = value.version ?? value.contractVersion;
  const guarantees = value.guarantees;
  if (id !== expectedId || typeof version !== "string") {
    return {
      available: false,
      localMode: LOCAL_MODE_INVARIANT_V1,
      reason: "protocolMismatch",
    };
  }
  if (parseMajorV1(version) !== 1) {
    return {
      available: false,
      localMode: LOCAL_MODE_INVARIANT_V1,
      reason: "contractUnsupported",
    };
  }
  if (!Array.isArray(guarantees)) {
    return {
      available: false,
      localMode: LOCAL_MODE_INVARIANT_V1,
      reason: "protocolMismatch",
    };
  }
  if (!guarantees.every((entry) =>
    typeof entry === "string" &&
    (AUTHORITY_GUARANTEES_V1 as readonly string[]).includes(entry)
  )) {
    return {
      available: false,
      localMode: LOCAL_MODE_INVARIANT_V1,
      reason: "protocolMismatch",
    };
  }
  const guaranteeSet = new Set(guarantees);
  if (requiredGuarantees.some((guarantee) => !guaranteeSet.has(guarantee))) {
    return {
      available: false,
      localMode: LOCAL_MODE_INVARIANT_V1,
      reason: "capabilityUnavailable",
    };
  }
  return {
    available: true,
    localMode: LOCAL_MODE_INVARIANT_V1,
    supportedVersion: ACCOUNT_CONTRACT_VERSION_V1,
  };
}
