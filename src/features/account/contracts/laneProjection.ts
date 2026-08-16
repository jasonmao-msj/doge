import type { GatewayOperationNameV1 } from "./gateway";
import { ACCOUNT_GATEWAY_OPERATION_NAMES_V1 } from "./gateway";

export const ACCOUNT_CONTRACT_LANES_V1 = [
  "frontend",
  "broker",
  "authority",
  "integration",
] as const;
export type AccountContractLaneV1 = (typeof ACCOUNT_CONTRACT_LANES_V1)[number];

export type AccountOperationProjectionV1 = {
  readonly gatewayOperation: GatewayOperationNameV1;
  readonly brokerOwner:
    | "capability-session"
    | "auth-flow"
    | "profile-security"
    | "usage"
    | "managed-key"
    | "configuration";
  readonly authorityOwner: "token2api" | "doge-local" | "composed";
  readonly resultNullability: "non-null" | "explicit-null-allowed";
  readonly decimalEncoding: "not-applicable" | "canonical-decimal-string";
  readonly rendererSafeOutput: true;
};

function projectionV1(
  gatewayOperation: GatewayOperationNameV1,
  brokerOwner: AccountOperationProjectionV1["brokerOwner"],
  authorityOwner: AccountOperationProjectionV1["authorityOwner"],
  options: Partial<
    Pick<AccountOperationProjectionV1, "resultNullability" | "decimalEncoding">
  > = {},
): AccountOperationProjectionV1 {
  return {
    gatewayOperation,
    brokerOwner,
    authorityOwner,
    resultNullability: options.resultNullability ?? "non-null",
    decimalEncoding: options.decimalEncoding ?? "not-applicable",
    rendererSafeOutput: true,
  };
}

export const ACCOUNT_OPERATION_PROJECTIONS_V1: readonly AccountOperationProjectionV1[] = [
  projectionV1("gateway.bootstrap", "capability-session", "composed"),
  projectionV1("gateway.reconcileIntent", "capability-session", "composed"),
  projectionV1("humanVerification.readRequirement", "auth-flow", "composed"),
  projectionV1("humanVerification.submitProof", "auth-flow", "doge-local"),
  projectionV1("auth.beginRegistration", "auth-flow", "token2api"),
  projectionV1("auth.resendRegistrationCode", "auth-flow", "token2api"),
  projectionV1("auth.submitRegistrationCode", "auth-flow", "token2api"),
  projectionV1("auth.login", "auth-flow", "token2api"),
  projectionV1("auth.verifyMfa", "auth-flow", "token2api"),
  projectionV1("auth.startOAuth", "auth-flow", "composed"),
  projectionV1("auth.cancelOAuth", "auth-flow", "composed"),
  projectionV1("auth.readOAuthAttempt", "auth-flow", "composed"),
  projectionV1("auth.completeOAuthAccount", "auth-flow", "token2api"),
  projectionV1("auth.requestPasswordReset", "auth-flow", "token2api"),
  projectionV1("auth.inspectExternalIntent", "auth-flow", "composed"),
  projectionV1("auth.resetPassword", "auth-flow", "token2api"),
  projectionV1("auth.logout", "capability-session", "composed"),
  projectionV1("profile.read", "profile-security", "token2api"),
  projectionV1("profile.updateProfile", "profile-security", "token2api"),
  projectionV1("profile.changePassword", "profile-security", "token2api"),
  projectionV1("profile.requestTotpEmailCode", "profile-security", "token2api"),
  projectionV1("profile.beginTotpEnrollment", "profile-security", "token2api"),
  projectionV1("profile.confirmTotpEnrollment", "profile-security", "token2api"),
  projectionV1("profile.disableTotp", "profile-security", "token2api"),
  projectionV1("profile.startIdentityBinding", "profile-security", "composed"),
  projectionV1("profile.unbindIdentity", "profile-security", "token2api"),
  projectionV1("profile.revokeAllSessions", "profile-security", "token2api"),
  projectionV1("usage.read", "usage", "token2api", {
    resultNullability: "explicit-null-allowed",
    decimalEncoding: "canonical-decimal-string",
  }),
  projectionV1("managedKey.readStatus", "managed-key", "composed"),
  projectionV1("managedKey.listCandidates", "managed-key", "composed"),
  projectionV1("managedKey.selectExisting", "managed-key", "composed"),
  projectionV1("managedKey.provision", "managed-key", "composed"),
  projectionV1("managedKey.rotate", "managed-key", "composed"),
  projectionV1("managedKey.revoke", "managed-key", "composed"),
  projectionV1("configuration.readOffer", "configuration", "doge-local"),
  projectionV1("configuration.createPlan", "configuration", "doge-local"),
  projectionV1("configuration.readFileDetail", "configuration", "doge-local"),
  projectionV1("configuration.apply", "configuration", "doge-local"),
  projectionV1("configuration.readCurrentTask", "configuration", "doge-local"),
  projectionV1("configuration.acknowledgeResult", "configuration", "doge-local"),
  projectionV1("configuration.hardDismiss", "configuration", "doge-local"),
];

export function hasCompleteAccountOperationProjectionV1(): boolean {
  const projected = new Set(
    ACCOUNT_OPERATION_PROJECTIONS_V1.map((entry) => entry.gatewayOperation),
  );
  return projected.size === ACCOUNT_GATEWAY_OPERATION_NAMES_V1.length &&
    ACCOUNT_GATEWAY_OPERATION_NAMES_V1.every((operation) => projected.has(operation));
}
