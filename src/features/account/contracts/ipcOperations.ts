import type { GatewayOperationNameV1 } from "./gateway";

export const ACCOUNT_IPC_READ_OPERATIONS_V1 = [
  "gateway.bootstrap",
  "gateway.reconcileIntent",
  "humanVerification.readRequirement",
  "auth.readOAuthAttempt",
  "auth.inspectExternalIntent",
  "profile.read",
  "usage.read",
  "managedKey.readStatus",
  "managedKey.listCandidates",
  "configuration.readOffer",
  "configuration.readFileDetail",
  "configuration.readCurrentTask",
] as const satisfies readonly GatewayOperationNameV1[];

export type AccountIpcReadOperationV1 =
  (typeof ACCOUNT_IPC_READ_OPERATIONS_V1)[number];
export type AccountIpcMutationOperationV1 = Exclude<
  GatewayOperationNameV1,
  AccountIpcReadOperationV1
>;
