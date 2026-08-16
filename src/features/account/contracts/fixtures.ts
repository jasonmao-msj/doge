import type { AuthorityCapabilityDescriptorV1 } from "./authority";
import type { BrokerIntentBindingV1, BrokerReceiptV1 } from "./broker";
import { AUTHORITY_GUARANTEES_V1 } from "./compatibility";
import type { AccountIpcResponseEnvelopeV1 } from "./transport";
import {
  ACCOUNT_IPC_CONTRACT_V1,
  brokerOperationIdV1,
  gatewayIntentIdV1,
  transportRequestIdV1,
} from "./semantic";
import {
  ACCOUNT_PERSISTENCE_SCHEMA_DEFINITION_V1,
} from "./persistence";
import { CODEX_TOKEN_SERVICE_RECIPE_SCHEMA_V1 } from "./recipe";
import { ACCOUNT_SCENARIO_MANIFEST_V1 } from "./scenarioManifest";

export const ACCOUNT_GOOD_CONTRACT_FIXTURES_V1 = {
  manifest: ACCOUNT_SCENARIO_MANIFEST_V1,
  authorityDescriptor: {
    contractId: "token2api-account-authority",
    contractVersion: "1.0.0",
    observedAt: "2030-01-01T00:00:00Z",
    capabilities: {
      registration: true,
      registrationEmailVerification: true,
      passwordLogin: true,
      passwordReset: true,
      mfa: true,
      "oauth.github": true,
      profile: true,
      passwordChange: true,
      totp: true,
      identityBindings: true,
      revokeAllSessions: true,
      quotaPull: true,
      apiKeyList: true,
      apiKeyHandoff: true,
      managedKeyProvision: true,
      managedKeyRotate: true,
      managedKeyRevoke: true,
    },
    guarantees: AUTHORITY_GUARANTEES_V1,
  } satisfies AuthorityCapabilityDescriptorV1,
  brokerBinding: {
    intentId: gatewayIntentIdV1("intent_synthetic0001"),
    operationId: brokerOperationIdV1("operation_synthetic0001"),
    operation: "auth.login",
    accountEpoch: 1,
    processGeneration: 1,
    requestFingerprint: `sha256:${"a".repeat(64)}`,
  } as BrokerIntentBindingV1,
  brokerReceipt: {
    operationId: brokerOperationIdV1("operation_synthetic0001"),
    operation: "auth.login",
    status: "succeeded",
    remoteDisposition: "confirmed",
    activationState: "persistentActive",
    lifecycle: "terminal",
    sessionCapability: "persistent",
    capabilityFreshness: "fresh",
    configuration: "idle",
    accountEpoch: 1,
    processGeneration: 1,
    eventSeq: 0,
    nextAction: "none",
    safeProjectionHandle: null,
  } as BrokerReceiptV1,
  ipcResponse: {
    contractId: ACCOUNT_IPC_CONTRACT_V1.id,
    contractVersion: ACCOUNT_IPC_CONTRACT_V1.version,
    requestId: transportRequestIdV1("request_synthetic0001"),
    operation: "gateway.bootstrap",
    processGeneration: 1,
    accountEpoch: 1,
    operationId: null,
    ok: true,
    value: {
      localMode: {
        status: "available",
        blockedByAccount: false,
        accountFailureCanGateLocalMode: false,
      },
      gatewayAvailability: "ready",
      vault: "ready",
      capabilities: {
        contractVersion: "1.0.0",
        observedAt: "2030-01-01T00:00:00Z",
        freshness: "fresh",
        entries: {},
        registration: {
          emailSuffixHint: null,
          invitationCode: "hidden",
          promoCode: "hidden",
          agreementRequired: false,
          humanVerificationRequired: false,
        },
      },
      session: { status: "signedOut" },
    },
  } as AccountIpcResponseEnvelopeV1,
  recipe: CODEX_TOKEN_SERVICE_RECIPE_SCHEMA_V1,
  persistence: ACCOUNT_PERSISTENCE_SCHEMA_DEFINITION_V1,
} as const;

const goodBootstrapValueV1 = ACCOUNT_GOOD_CONTRACT_FIXTURES_V1.ipcResponse.ok
  ? ACCOUNT_GOOD_CONTRACT_FIXTURES_V1.ipcResponse.value
  : null;

export const ACCOUNT_BASE_CONTRACT_FIXTURES_V1 = {
  ipcExplicitNullSuccess: {
    contractId: ACCOUNT_IPC_CONTRACT_V1.id,
    contractVersion: ACCOUNT_IPC_CONTRACT_V1.version,
    requestId: transportRequestIdV1("request_synthetic0002"),
    operation: "gateway.bootstrap",
    processGeneration: 1,
    accountEpoch: 1,
    operationId: null,
    ok: true,
    value: goodBootstrapValueV1,
  } as AccountIpcResponseEnvelopeV1,
  quotaDecimalAndNullableTimes: {
    status: "unavailable",
    source: "token2apiPlatformQuota",
    freshness: "softStale",
    observedAt: null,
    fetchedAt: null,
    remaining: { value: "1000.25", unit: "credits" },
    used: null,
    resetsAt: null,
    subscriptionLabel: null,
  } as const,
  supportedMinorDescriptor: {
    id: "token2api-account-authority",
    version: "1.1.0",
    guarantees: ["durable_token_pair_v1"],
    additiveOptionalField: "ignored-at-ingress",
  } as const,
  quotaPullOnlyEvent: {
    eventId: "event_synthetic0001",
    emittedAt: "2030-01-01T00:00:00Z",
    kind: "usageInvalidated",
    processGeneration: 1,
    eventSeq: 1,
    accountEpoch: 7,
  } as const,
} as const;

export const ACCOUNT_GOOD_IPC_RESPONSE_CONTEXT_V1 = {
  accountEpoch: 1,
  processGeneration: 1,
  nowEpochSeconds: 1_893_456_000,
  maxHandleTtlSeconds: 86_400,
  expectedKind: "read",
  expectedOperation: "gateway.bootstrap",
  expectedRequestId: ACCOUNT_GOOD_CONTRACT_FIXTURES_V1.ipcResponse.requestId,
  expectedOperationId: null,
} as const;

export const ACCOUNT_BASE_IPC_RESPONSE_CONTEXT_V1 = {
  ...ACCOUNT_GOOD_IPC_RESPONSE_CONTEXT_V1,
  expectedRequestId: ACCOUNT_BASE_CONTRACT_FIXTURES_V1.ipcExplicitNullSuccess.requestId,
} as const;

function cloneManifestFixtureV1(): Record<string, unknown> {
  return structuredClone(ACCOUNT_SCENARIO_MANIFEST_V1) as unknown as Record<string, unknown>;
}

const duplicateManifestV1 = cloneManifestFixtureV1();
const duplicateScenariosV1 = duplicateManifestV1.scenarios as Record<string, unknown>[];
duplicateScenariosV1.push(structuredClone(duplicateScenariosV1[0]));

const malformedManifestV1 = cloneManifestFixtureV1();
delete (malformedManifestV1.scenarios as Record<string, unknown>[])[0].terminalTruth;

const secretBearingManifestV1 = cloneManifestFixtureV1();
(secretBearingManifestV1.scenarios as Record<string, unknown>[])[0].rawUrl =
  "https://account.invalid/callback?ticket=synthetic";

const unknownScenarioEnumV1 = cloneManifestFixtureV1();
(unknownScenarioEnumV1.scenarios as Record<string, unknown>[])[0].terminalTruth = "quietSuccess";

export const ACCOUNT_BAD_CONTRACT_FIXTURES_V1 = {
  manifestDuplicateId: duplicateManifestV1,
  manifestMissingRequiredField: malformedManifestV1,
  manifestSecretBearing: secretBearingManifestV1,
  manifestUnknownEnum: unknownScenarioEnumV1,
  unsupportedTransportMajor: {
    contractId: ACCOUNT_IPC_CONTRACT_V1.id,
    contractVersion: "2.0.0",
    requestId: "request_synthetic0003",
    operation: "gateway.bootstrap",
    ok: true,
    value: null,
  },
  unknownGatewayErrorEnum: {
    contractId: ACCOUNT_IPC_CONTRACT_V1.id,
    contractVersion: ACCOUNT_IPC_CONTRACT_V1.version,
    requestId: "request_synthetic0004",
    operation: "auth.login",
    ok: false,
    error: {
      code: "silentFallback",
      stage: "login",
      recovery: { action: "useLocalMode" },
    },
  },
  missingAuthorityGuarantee: {
    id: "token2api-account-authority",
    version: "1.0.0",
    guarantees: [],
  },
  brokerOutcomeUnknownWithoutReconcile: {
    operationId: "operation_synthetic0002",
    terminal: "outcomeUnknown",
    authorityScope: "reconciliationPending",
    sessionEffect: "unchanged",
    nextAction: "retry",
    safeProjectionHandle: null,
  },
  accountAuthenticatedSessionOnly: {
    status: "authenticated",
    accountEpoch: 4,
    sessionCapability: "sessionOnly",
    profileLabel: "Synthetic profile",
    primaryEmailLabel: null,
  },
  quotaNumberInsteadOfDecimalString: {
    status: "available",
    source: "token2apiAccount",
    freshness: "fresh",
    observedAt: "2030-01-01T00:00:00Z",
    fetchedAt: "2030-01-01T00:00:00Z",
    remaining: { value: 1000.25, unit: "credits" },
    used: null,
    resetsAt: null,
    subscriptionLabel: null,
  },
} as const;
