import type {
  AccountBootstrapViewV1,
  BrokerOperationIdV1,
  GatewayFailureV1,
  GatewayIntentIdV1,
  HumanVerificationHandleV1,
  AuthAttemptHandleV1,
  TransportRequestIdV1,
} from "./semantic";
import { ACCOUNT_IPC_CONTRACT_V1 } from "./semantic";
import type {
  AccountCenterViewV1,
  AccountAuthPortV1,
  AccountConfigurationPortV1,
  AccountGatewayEventV1,
  AccountHumanVerificationPortV1,
  AccountManagedKeyPortV1,
  ApiKeyCandidateListViewV1,
  AccountProfilePortV1,
  AuthNextViewV1,
  ConfigurationOfferViewV1,
  ConfigurationPlanViewV1,
  ConfigurationResultViewV1,
  ConfigurationTaskViewV1,
  ConfigFileDetailViewV1,
  GatewayOperationNameV1,
  GatewayReconciliationViewV1,
  HumanVerificationRequirementViewV1,
  ManagedKeyStatusViewV1,
  OAuthAttemptViewV1,
  TotpEnrollmentPresentationV1,
} from "./gateway";
import type { QuotaUsageViewV1 } from "./semantic";
import type { SchemaValidationV1 } from "./schema";
import { isEnumValueV1 } from "./schema";
import { ACCOUNT_GATEWAY_OPERATION_NAMES_V1 } from "./gateway";
import {
  validateAccountIpcResponseEnvelopeV1,
} from "./ipcValidator";

export const ACCOUNT_IPC_COMMAND_V1 = "account_v1_execute" as const;
export const ACCOUNT_IPC_EVENT_CHANNEL_V1 = "account-v1://event" as const;

import {
  ACCOUNT_IPC_READ_OPERATIONS_V1,
  type AccountIpcMutationOperationV1,
  type AccountIpcReadOperationV1,
} from "./ipcOperations";
export {
  ACCOUNT_IPC_READ_OPERATIONS_V1,
  type AccountIpcMutationOperationV1,
  type AccountIpcReadOperationV1,
} from "./ipcOperations";

export type AccountIpcOperationResultMapV1 = {
  readonly "gateway.bootstrap": AccountBootstrapViewV1;
  readonly "gateway.reconcileIntent": GatewayReconciliationViewV1;
  readonly "humanVerification.readRequirement": HumanVerificationRequirementViewV1;
  readonly "humanVerification.submitProof": {
    readonly verification: HumanVerificationHandleV1;
    readonly expiresAt: string;
  };
  readonly "auth.beginRegistration": AuthNextViewV1;
  readonly "auth.resendRegistrationCode": AuthNextViewV1;
  readonly "auth.submitRegistrationCode": AuthNextViewV1;
  readonly "auth.login": AuthNextViewV1;
  readonly "auth.verifyMfa": AuthNextViewV1;
  readonly "auth.startOAuth": AuthNextViewV1;
  readonly "auth.cancelOAuth": { readonly cancelled: true };
  readonly "auth.readOAuthAttempt": OAuthAttemptViewV1;
  readonly "auth.completeOAuthAccount": AuthNextViewV1;
  readonly "auth.requestPasswordReset": AuthNextViewV1;
  readonly "auth.inspectExternalIntent": AuthNextViewV1;
  readonly "auth.resetPassword": AuthNextViewV1;
  readonly "auth.logout": {
    readonly localSessionCleared: true;
    readonly remoteRevocation: "confirmed" | "unconfirmed";
  };
  readonly "profile.read": AccountCenterViewV1;
  readonly "profile.updateProfile": AccountCenterViewV1;
  readonly "profile.changePassword": { readonly changed: true };
  readonly "profile.requestTotpEmailCode": { readonly resendAt: string };
  readonly "profile.beginTotpEnrollment": {
    readonly enrollment: AuthAttemptHandleV1;
    readonly presentation: TotpEnrollmentPresentationV1;
  };
  readonly "profile.confirmTotpEnrollment": { readonly enabled: true };
  readonly "profile.disableTotp": { readonly disabled: true };
  readonly "profile.startIdentityBinding": AuthNextViewV1;
  readonly "profile.unbindIdentity": { readonly unbound: true };
  readonly "profile.revokeAllSessions": {
    readonly remoteRevocation: "confirmed" | "outcomeUnknown";
  };
  readonly "usage.read": QuotaUsageViewV1;
  readonly "managedKey.readStatus": ManagedKeyStatusViewV1;
  readonly "managedKey.listCandidates": ApiKeyCandidateListViewV1;
  readonly "managedKey.selectExisting": ManagedKeyStatusViewV1;
  readonly "managedKey.provision": ManagedKeyStatusViewV1;
  readonly "managedKey.rotate": ManagedKeyStatusViewV1;
  readonly "managedKey.revoke": ManagedKeyStatusViewV1;
  readonly "configuration.readOffer": ConfigurationOfferViewV1;
  readonly "configuration.createPlan": ConfigurationPlanViewV1;
  readonly "configuration.readFileDetail": ConfigFileDetailViewV1;
  readonly "configuration.apply": ConfigurationResultViewV1;
  readonly "configuration.readCurrentTask": ConfigurationTaskViewV1;
  readonly "configuration.acknowledgeResult": { readonly acknowledged: true };
  readonly "configuration.hardDismiss": { readonly dismissed: true };
};

export type AccountIpcGenericSafeOperationV1 = Exclude<
  GatewayOperationNameV1,
  "profile.beginTotpEnrollment"
>;

/** Generic safe stores can never hold the one-time TOTP enrollment result. */
export type AccountIpcSafeValueV1 =
  AccountIpcOperationResultMapV1[AccountIpcGenericSafeOperationV1];

export type AccountIpcTotpEnrollmentOneTimeValueV1 =
  AccountIpcOperationResultMapV1["profile.beginTotpEnrollment"];

export type AccountIpcSafeRequestPayloadMapV1 = {
  readonly "gateway.bootstrap": null;
  readonly "gateway.reconcileIntent": {
    readonly intent: GatewayIntentIdV1;
    readonly expected: GatewayOperationNameV1;
  };
  readonly "humanVerification.readRequirement": Parameters<AccountHumanVerificationPortV1["readRequirement"]>[0];
  readonly "humanVerification.submitProof": Parameters<AccountHumanVerificationPortV1["submitProof"]>[0];
  readonly "auth.beginRegistration": Parameters<AccountAuthPortV1["beginRegistration"]>[0];
  readonly "auth.resendRegistrationCode": Parameters<AccountAuthPortV1["resendRegistrationCode"]>[0];
  readonly "auth.submitRegistrationCode": Parameters<AccountAuthPortV1["submitRegistrationCode"]>[0];
  readonly "auth.login": Parameters<AccountAuthPortV1["login"]>[0];
  readonly "auth.verifyMfa": Parameters<AccountAuthPortV1["verifyMfa"]>[0];
  readonly "auth.startOAuth": Parameters<AccountAuthPortV1["startOAuth"]>[0];
  readonly "auth.cancelOAuth": Parameters<AccountAuthPortV1["cancelOAuth"]>[0];
  readonly "auth.readOAuthAttempt": Parameters<AccountAuthPortV1["readOAuthAttempt"]>[0];
  readonly "auth.completeOAuthAccount": Parameters<AccountAuthPortV1["completeOAuthAccount"]>[0];
  readonly "auth.requestPasswordReset": Parameters<AccountAuthPortV1["requestPasswordReset"]>[0];
  readonly "auth.inspectExternalIntent": Parameters<AccountAuthPortV1["inspectExternalIntent"]>[0];
  readonly "auth.resetPassword": Parameters<AccountAuthPortV1["resetPassword"]>[0];
  readonly "auth.logout": Parameters<AccountAuthPortV1["logout"]>[0];
  readonly "profile.read": null;
  readonly "profile.updateProfile": Parameters<AccountProfilePortV1["updateProfile"]>[0];
  readonly "profile.changePassword": Parameters<AccountProfilePortV1["changePassword"]>[0];
  readonly "profile.requestTotpEmailCode": null;
  readonly "profile.beginTotpEnrollment": Parameters<AccountProfilePortV1["beginTotpEnrollment"]>[0];
  readonly "profile.confirmTotpEnrollment": Parameters<AccountProfilePortV1["confirmTotpEnrollment"]>[0];
  readonly "profile.disableTotp": Parameters<AccountProfilePortV1["disableTotp"]>[0];
  readonly "profile.startIdentityBinding": Parameters<AccountProfilePortV1["startIdentityBinding"]>[0];
  readonly "profile.unbindIdentity": Parameters<AccountProfilePortV1["unbindIdentity"]>[0];
  readonly "profile.revokeAllSessions": Parameters<AccountProfilePortV1["revokeAllSessions"]>[0];
  readonly "usage.read": null;
  readonly "managedKey.readStatus": Parameters<AccountManagedKeyPortV1["readStatus"]>[0];
  readonly "managedKey.listCandidates": Parameters<AccountManagedKeyPortV1["listCandidates"]>[0];
  readonly "managedKey.selectExisting": Parameters<AccountManagedKeyPortV1["selectExisting"]>[0];
  readonly "managedKey.provision": Parameters<AccountManagedKeyPortV1["provision"]>[0];
  readonly "managedKey.rotate": Parameters<AccountManagedKeyPortV1["rotate"]>[0];
  readonly "managedKey.revoke": Parameters<AccountManagedKeyPortV1["revoke"]>[0];
  readonly "configuration.readOffer": null;
  readonly "configuration.createPlan": Parameters<AccountConfigurationPortV1["createPlan"]>[0];
  readonly "configuration.readFileDetail": Parameters<AccountConfigurationPortV1["readFileDetail"]>[0];
  readonly "configuration.apply": Parameters<AccountConfigurationPortV1["apply"]>[0];
  readonly "configuration.readCurrentTask": null;
  readonly "configuration.acknowledgeResult": Parameters<AccountConfigurationPortV1["acknowledgeResult"]>[0];
  readonly "configuration.hardDismiss": Parameters<AccountConfigurationPortV1["hardDismiss"]>[0];
};

/**
 * The request payload is operation-specific and may contain transient secret
 * inputs. It is deliberately not a safe-output type and must never be traced.
 */
type AccountIpcRequestBaseV1<TOperation extends GatewayOperationNameV1> = {
  readonly contractId: typeof ACCOUNT_IPC_CONTRACT_V1.id;
  readonly contractVersion: typeof ACCOUNT_IPC_CONTRACT_V1.version;
  readonly requestId: TransportRequestIdV1;
  readonly operation: TOperation;
  readonly processGeneration: number;
  readonly accountEpoch: number | null;
  readonly payload: AccountIpcSafeRequestPayloadMapV1[TOperation];
};

export type AccountIpcReadRequestEnvelopeV1 = {
  [TOperation in AccountIpcReadOperationV1]:
    AccountIpcRequestBaseV1<TOperation> & {
      readonly kind: "read";
    };
}[AccountIpcReadOperationV1];

export type AccountIpcMutationRequestEnvelopeV1 = {
  [TOperation in AccountIpcMutationOperationV1]:
    AccountIpcRequestBaseV1<TOperation> & {
      readonly kind: "mutation";
      readonly intentId: GatewayIntentIdV1;
      readonly accountEpoch: number;
    };
}[AccountIpcMutationOperationV1];

export type AccountIpcRequestEnvelopeV1 =
  | AccountIpcReadRequestEnvelopeV1
  | AccountIpcMutationRequestEnvelopeV1;

export type AccountIpcResponseEnvelopeV1 = {
  [TOperation in GatewayOperationNameV1]:
  | {
      readonly contractId: typeof ACCOUNT_IPC_CONTRACT_V1.id;
      readonly contractVersion: typeof ACCOUNT_IPC_CONTRACT_V1.version;
      readonly requestId: TransportRequestIdV1;
      readonly operation: TOperation;
      readonly processGeneration: number;
      readonly accountEpoch: number | null;
      readonly operationId: BrokerOperationIdV1 | null;
      readonly ok: true;
      readonly value: AccountIpcOperationResultMapV1[TOperation];
    }
  | {
      readonly contractId: typeof ACCOUNT_IPC_CONTRACT_V1.id;
      readonly contractVersion: typeof ACCOUNT_IPC_CONTRACT_V1.version;
      readonly requestId: TransportRequestIdV1;
      readonly operation: TOperation;
      readonly processGeneration: number;
      readonly accountEpoch: number | null;
      readonly operationId: BrokerOperationIdV1 | null;
      readonly ok: false;
      readonly error: GatewayFailureV1;
    };
}[GatewayOperationNameV1];

export type AccountIpcEventEnvelopeV1 = {
  readonly contractId: typeof ACCOUNT_IPC_CONTRACT_V1.id;
  readonly contractVersion: typeof ACCOUNT_IPC_CONTRACT_V1.version;
  readonly event: AccountGatewayEventV1;
};

export type AccountOperationBoundaryV1 = {
  readonly operation: GatewayOperationNameV1;
  readonly kind: "read" | "mutation";
  readonly authoritativeAfterEvent: boolean;
  readonly payloadMayContainTransientSecret: boolean;
  readonly safeOutputOnly: true;
};

const READ_OPERATIONS_V1 = new Set<GatewayOperationNameV1>(
  ACCOUNT_IPC_READ_OPERATIONS_V1,
);

const SECRET_INPUT_OPERATIONS_V1 = new Set<GatewayOperationNameV1>([
  "humanVerification.submitProof",
  "auth.beginRegistration",
  "auth.submitRegistrationCode",
  "auth.login",
  "auth.verifyMfa",
  "auth.completeOAuthAccount",
  "auth.resetPassword",
  "profile.changePassword",
  "profile.beginTotpEnrollment",
  "profile.confirmTotpEnrollment",
  "profile.disableTotp",
]);

const AUTHORITATIVE_AFTER_EVENT_V1 = new Set<GatewayOperationNameV1>([
  "gateway.bootstrap",
  "auth.readOAuthAttempt",
  "auth.inspectExternalIntent",
  "usage.read",
  "configuration.readCurrentTask",
]);

export const ACCOUNT_OPERATION_BOUNDARIES_V1: readonly AccountOperationBoundaryV1[] =
  ACCOUNT_GATEWAY_OPERATION_NAMES_V1.map((operation) => ({
    operation,
    kind: READ_OPERATIONS_V1.has(operation) ? "read" : "mutation",
    authoritativeAfterEvent: AUTHORITATIVE_AFTER_EVENT_V1.has(operation),
    payloadMayContainTransientSecret: SECRET_INPUT_OPERATIONS_V1.has(operation),
    safeOutputOnly: true,
  }));

export function validateAccountIpcResponseV1(
  value: unknown,
  context: import("./ipcValidator").AccountIpcResponseValidationContextV1,
): SchemaValidationV1<AccountIpcResponseEnvelopeV1> {
  return validateAccountIpcResponseEnvelopeV1(value, context);
}

export function validateAccountIpcOperationV1(value: unknown): value is GatewayOperationNameV1 {
  return isEnumValueV1(value, ACCOUNT_GATEWAY_OPERATION_NAMES_V1);
}
