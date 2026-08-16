import type {
  AccountGatewayEventV1,
  AccountGatewayV1,
  GatewayCallContextV1,
  GatewayOperationNameV1,
  GatewayReadContextV1,
} from "../features/account/contracts/gateway";
import {
  ACCOUNT_GATEWAY_CONTRACT_V1,
  brokerOperationIdV1,
  transportRequestIdV1,
  type GatewayResultV1,
} from "../features/account/contracts/semantic";
import { ACCOUNT_IPC_READ_OPERATIONS_V1 } from "../features/account/contracts/ipcOperations";
import type {
  AccountIpcOperationResultMapV1,
  AccountIpcResponseEnvelopeV1,
} from "../features/account/contracts/transport";
import { validateAccountIpcResponseV1 } from "../features/account/contracts/transport";
import {
  validateAccountIpcEventEnvelopeV1,
  type AccountEventCursorV1,
} from "../features/account/contracts/ipcValidator";
import {
  executeAccountRequestV1,
  getAccountNativeContextV1,
  prepareAccountMutationV1,
  subscribeAccountWakeupV1,
  type AccountNativeContextV1,
} from "./tauri/account";

const READ_OPERATIONS = new Set<GatewayOperationNameV1>(
  ACCOUNT_IPC_READ_OPERATIONS_V1,
);

export class RealAccountGatewayV1 implements AccountGatewayV1 {
  readonly contract = ACCOUNT_GATEWAY_CONTRACT_V1;

  subscribe = (listener: (event: AccountGatewayEventV1) => void) => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    let cursor: AccountEventCursorV1 | null = null;
    void subscribeAccountWakeupV1((payload) => {
      if (disposed) return;
      const validation = validateAccountIpcEventEnvelopeV1(payload, cursor);
      if (!validation.ok) return;
      const event = validation.value.event;
      cursor = {
        processGeneration: event.processGeneration,
        eventSeq: event.eventSeq,
        accountEpoch: event.accountEpoch,
      };
      listener(event);
    }).then((handler) => {
      if (disposed) handler();
      else unlisten = handler;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
      unlisten = null;
    };
  };

  bootstrap: AccountGatewayV1["bootstrap"] = (context) =>
    this.read("gateway.bootstrap", null, context);

  reconcileIntent: AccountGatewayV1["reconcileIntent"] = (input, context) =>
    this.read("gateway.reconcileIntent", input, context);

  readonly humanVerification: AccountGatewayV1["humanVerification"] = {
    readRequirement: (input, context) =>
      this.read("humanVerification.readRequirement", input, context),
    submitProof: (input, context) =>
      this.mutate("humanVerification.submitProof", input, context),
  };

  readonly auth: AccountGatewayV1["auth"] = {
    beginRegistration: (input, context) =>
      this.mutate("auth.beginRegistration", input, context),
    resendRegistrationCode: (input, context) =>
      this.mutate("auth.resendRegistrationCode", input, context),
    submitRegistrationCode: (input, context) =>
      this.mutate("auth.submitRegistrationCode", input, context),
    login: (input, context) => this.mutate("auth.login", input, context),
    verifyMfa: (input, context) => this.mutate("auth.verifyMfa", input, context),
    startOAuth: (input, context) => this.mutate("auth.startOAuth", input, context),
    cancelOAuth: (input, context) => this.mutate("auth.cancelOAuth", input, context),
    readOAuthAttempt: (input, context) =>
      this.read("auth.readOAuthAttempt", input, context),
    completeOAuthAccount: (input, context) =>
      this.mutate("auth.completeOAuthAccount", input, context),
    requestPasswordReset: (input, context) =>
      this.mutate("auth.requestPasswordReset", input, context),
    inspectExternalIntent: (input, context) =>
      this.read("auth.inspectExternalIntent", input, context),
    resetPassword: (input, context) =>
      this.mutate("auth.resetPassword", input, context),
    logout: (input, context) => this.mutate("auth.logout", input, context),
  };

  readonly profile: AccountGatewayV1["profile"] = {
    read: (context) => this.read("profile.read", null, context),
    updateProfile: (input, context) =>
      this.mutate("profile.updateProfile", input, context),
    changePassword: (input, context) =>
      this.mutate("profile.changePassword", input, context),
    requestTotpEmailCode: (context) =>
      this.mutate("profile.requestTotpEmailCode", null, context),
    beginTotpEnrollment: (input, context) =>
      this.mutate("profile.beginTotpEnrollment", input, context),
    confirmTotpEnrollment: (input, context) =>
      this.mutate("profile.confirmTotpEnrollment", input, context),
    disableTotp: (input, context) =>
      this.mutate("profile.disableTotp", input, context),
    startIdentityBinding: (input, context) =>
      this.mutate("profile.startIdentityBinding", input, context),
    unbindIdentity: (input, context) =>
      this.mutate("profile.unbindIdentity", input, context),
    revokeAllSessions: (input, context) =>
      this.mutate("profile.revokeAllSessions", input, context),
  };

  readonly usage: AccountGatewayV1["usage"] = {
    read: (context) => this.read("usage.read", null, context),
  };

  readonly managedKey: AccountGatewayV1["managedKey"] = {
    readStatus: (input, context) => this.read("managedKey.readStatus", input, context),
    listCandidates: (input, context) =>
      this.read("managedKey.listCandidates", input, context),
    selectExisting: (input, context) =>
      this.mutate("managedKey.selectExisting", input, context),
    provision: (input, context) => this.mutate("managedKey.provision", input, context),
    rotate: (input, context) => this.mutate("managedKey.rotate", input, context),
    revoke: (input, context) => this.mutate("managedKey.revoke", input, context),
  };

  readonly configuration: AccountGatewayV1["configuration"] = {
    readOffer: (context) => this.read("configuration.readOffer", null, context),
    createPlan: (input, context) =>
      this.mutate("configuration.createPlan", input, context),
    readFileDetail: (input, context) =>
      this.read("configuration.readFileDetail", input, context),
    apply: (input, context) => this.mutate("configuration.apply", input, context),
    readCurrentTask: (context) =>
      this.read("configuration.readCurrentTask", null, context),
    acknowledgeResult: (input, context) =>
      this.mutate("configuration.acknowledgeResult", input, context),
    hardDismiss: (input, context) =>
      this.mutate("configuration.hardDismiss", input, context),
  };

  private async read<TOperation extends (typeof ACCOUNT_IPC_READ_OPERATIONS_V1)[number]>(
    operation: TOperation,
    payload: unknown,
    context: GatewayReadContextV1,
  ): Promise<GatewayResultV1<AccountIpcOperationResultMapV1[TOperation]>> {
    if (context.signal?.aborted) return cancelledResult(operation);
    try {
      const nativeContext = await getAccountNativeContextV1();
      const requestId = nextRequestId();
      const request = {
        contractId: "doge-account-ipc",
        contractVersion: "1.0.0",
        requestId,
        operation,
        kind: "read",
        processGeneration: nativeContext.processGeneration,
        accountEpoch: nativeContext.accountEpoch,
        payload,
      } as const;
      const response = await executeAccountRequestV1(request, null);
      if (context.signal?.aborted) return cancelledResult(operation);
      return validatedResult(operation, response, nativeContext, requestId, null);
    } catch {
      if (context.signal?.aborted) return cancelledResult(operation);
      return nativeTransportFailure(operation);
    }
  }

  private async mutate<TOperation extends Exclude<
    GatewayOperationNameV1,
    (typeof ACCOUNT_IPC_READ_OPERATIONS_V1)[number]
  >>(
    operation: TOperation,
    payload: unknown,
    context: GatewayCallContextV1,
  ): Promise<GatewayResultV1<AccountIpcOperationResultMapV1[TOperation]>> {
    if (context.signal?.aborted) return cancelledResult(operation);
    let nativeContext: AccountNativeContextV1;
    try {
      nativeContext = await getAccountNativeContextV1();
    } catch {
      if (context.signal?.aborted) return cancelledResult(operation);
      return nativeTransportFailure(operation);
    }
    const requestId = nextRequestId();
    const request = {
      contractId: "doge-account-ipc",
      contractVersion: "1.0.0",
      requestId,
      operation,
      kind: "mutation",
      processGeneration: nativeContext.processGeneration,
      accountEpoch: nativeContext.accountEpoch,
      intentId: context.intent,
      payload,
    } as const;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const operationId = brokerOperationIdV1(await prepareAccountMutationV1(request));
        if (context.signal?.aborted) return cancelledResult(operation);
        const response = await executeAccountRequestV1(request, operationId);
        return validatedResult(operation, response, nativeContext, requestId, operationId);
      } catch {
        if (context.signal?.aborted) return cancelledResult(operation);
      }
    }
    return mutationOutcomeUnknown(operation, context.intent);
  }
}

function validatedResult<TOperation extends GatewayOperationNameV1>(
  operation: TOperation,
  response: unknown,
  nativeContext: AccountNativeContextV1,
  requestId: ReturnType<typeof transportRequestIdV1>,
  operationId: ReturnType<typeof brokerOperationIdV1> | null,
): GatewayResultV1<AccountIpcOperationResultMapV1[TOperation]> {
  const isRead = READ_OPERATIONS.has(operation);
  const validation = validateAccountIpcResponseV1(response, {
    accountEpoch: nativeContext.accountEpoch,
    processGeneration: nativeContext.processGeneration,
    nowEpochSeconds: Math.floor(Date.now() / 1_000),
    maxHandleTtlSeconds: 7_200,
    expectedKind: isRead ? "read" : "mutation",
    expectedOperation: operation,
    expectedRequestId: requestId,
    expectedOperationId: operationId,
  } as Parameters<typeof validateAccountIpcResponseV1>[1]);
  if (!validation.ok) {
    return {
      ok: false,
      error: {
        code: "protocolMismatch",
        stage: stageForOperation(operation),
        recovery: { action: "useLocalMode" },
      },
    };
  }
  const envelope = validation.value as Extract<
    AccountIpcResponseEnvelopeV1,
    { operation: TOperation }
  >;
  if (!envelope.ok) return { ok: false, error: envelope.error };
  return {
    ok: true,
    value: envelope.value as AccountIpcOperationResultMapV1[TOperation],
  };
}

function nextRequestId() {
  return transportRequestIdV1(
    `request_${crypto.randomUUID().replaceAll("-", "")}`,
  );
}

function cancelledResult<TOperation extends GatewayOperationNameV1>(
  operation: TOperation,
): GatewayResultV1<never> {
  return {
    ok: false,
    error: {
      code: "cancelled",
      stage: stageForOperation(operation),
      recovery: { action: "none" },
    },
  };
}

function nativeTransportFailure<TOperation extends GatewayOperationNameV1>(
  operation: TOperation,
): GatewayResultV1<never> {
  return {
    ok: false,
    error: {
      code: "serviceUnavailable",
      stage: stageForOperation(operation),
      recovery: { action: "useLocalMode" },
    },
  };
}

function mutationOutcomeUnknown<TOperation extends GatewayOperationNameV1>(
  operation: TOperation,
  intent: GatewayCallContextV1["intent"],
): GatewayResultV1<never> {
  return {
    ok: false,
    error: {
      code: "outcomeUnknown",
      stage: stageForOperation(operation),
      recovery: { action: "reconcile", intent },
    },
  };
}

function stageForOperation(operation: GatewayOperationNameV1) {
  if (operation.startsWith("configuration.")) {
    return operation === "configuration.apply" ? "configurationApply" as const : "configurationPlan" as const;
  }
  if (operation.startsWith("managedKey.")) return "managedKey" as const;
  if (operation === "usage.read") return "usage" as const;
  if (operation.startsWith("profile.")) return "security" as const;
  if (operation.startsWith("humanVerification.")) return "challenge" as const;
  if (operation.includes("OAuth")) return "oauth" as const;
  if (operation.toLowerCase().includes("passwordreset")) return "recover" as const;
  if (operation === "auth.logout") return "logout" as const;
  if (operation === "auth.beginRegistration") return "register" as const;
  if (operation.includes("RegistrationCode")) return "verifyEmail" as const;
  if (operation === "auth.verifyMfa") return "mfa" as const;
  if (operation === "gateway.bootstrap") return "capabilities" as const;
  return "login" as const;
}

export function createRealAccountGatewayV1(): AccountGatewayV1 {
  return new RealAccountGatewayV1();
}
