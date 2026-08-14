import { describe, expect, it } from "vitest";
import {
  ACCOUNT_CANONICAL_SCENARIO_IDS_V1,
  ACCOUNT_BROKER_OPERATION_POLICIES_V1,
  ACCOUNT_DIAGNOSTIC_CONTRACT_V1,
  ACCOUNT_GATEWAY_OPERATION_NAMES_V1,
  ACCOUNT_IPC_CONTRACT_V1,
  ACCOUNT_IPC_OPERATION_SCHEMAS_V1,
  ACCOUNT_IPC_OPERATION_RUNTIME_SCHEMAS_V1,
  ACCOUNT_SCENARIO_MANIFEST_V1,
  ACCOUNT_SCENARIO_IPC_ADAPTER_V1,
  ACCOUNT_SCENARIO_MOCK_ADAPTER_V1,
  ACCOUNT_SCENARIO_VALIDATION_CONTEXT_V1,
  ACCOUNT_SUPPORT_BUNDLE_CONTRACT_V1,
  ACCOUNT_FORBIDDEN_FIELD_CORPUS_V1,
  ACCOUNT_FORBIDDEN_VALUE_CORPUS_V1,
  CODEX_TOKEN_SERVICE_RECIPE_SCHEMA_V1,
  LOCAL_MODE_INVARIANT_V1,
  TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1,
  acceptsBrokerEventWakeupV1,
  acceptsBrokerSettlementV1,
  brokerOperationIdV1,
  deserializeAccountPersistenceRecordV1,
  gatewayIntentIdV1,
  isCanonicalDecimalStringV1,
  isRfc3339UtcV1,
  oneTimeTotpPresentationV1,
  readScenarioPrivateTransientFixtureV1,
  scenarioResponseValidationContextV1,
  safeLabelV1,
  safeTextV1,
  transportRequestIdV1,
  validateAccountDiagnosticSnapshotV1,
  validateAccountFeatureStateV1,
  validateAccountHandleV1,
  validateAccountIpcEventEnvelopeV1,
  validateAccountIpcRequestV1,
  validateAccountIpcResponseEnvelopeV1,
  validateAccountOperationPayloadV1,
  validateAccountPersistenceRecordV1,
  validateAccountPersistenceSchemaV1,
  validateAccountSafeArtifactV1,
  validateAccountSupportBundleV1,
  validateAuthorityCapabilityDescriptorV1,
  validateAuthorityPrivateRequestV1,
  validateAuthoritySafeResponseV1,
  validateBrokerIntentBindingV1,
  validateBrokerReceiptV1,
  validateConfigRecipeV1,
  validateRuntimeSchemaV1,
  validateScenarioManifestParityV1,
  validateSafeLabelV1,
  type RuntimeSchemaExtensionV1,
  type ScenarioLaneAdapterV1,
  type SchemaValidationV1,
  type SchemaIssueV1,
} from "./index";

const contextV1 = ACCOUNT_SCENARIO_VALIDATION_CONTEXT_V1;
const timestampV1 = "2030-01-01T00:00:00Z";
const operationIdV1 = brokerOperationIdV1("operation_syntheticblocker01");
const intentIdV1 = gatewayIntentIdV1("intent_syntheticblocker01");
const requestIdV1 = transportRequestIdV1("request_syntheticblocker01");

function loginRequestV1() {
  return {
    contractId: ACCOUNT_IPC_CONTRACT_V1.id,
    contractVersion: ACCOUNT_IPC_CONTRACT_V1.version,
    requestId: requestIdV1,
    operation: "auth.login",
    kind: "mutation",
    processGeneration: 1,
    accountEpoch: 1,
    intentId: intentIdV1,
    payload: { email: "fixture.user@example.invalid", password: "synthetic-input" },
  } as const;
}

function loginResponseContextV1() {
  return {
    ...contextV1,
    expectedKind: "mutation",
    expectedOperation: "auth.login",
    expectedRequestId: requestIdV1,
    expectedOperationId: operationIdV1,
  } as const;
}

function loginResponseV1() {
  return {
    contractId: ACCOUNT_IPC_CONTRACT_V1.id,
    contractVersion: ACCOUNT_IPC_CONTRACT_V1.version,
    requestId: requestIdV1,
    operation: "auth.login",
    processGeneration: 1,
    accountEpoch: 1,
    operationId: operationIdV1,
    ok: false,
    error: { code: "validationRejected", stage: "login", recovery: { action: "none" } },
  } as const;
}

function eventEnvelopeV1(eventSeq = 1) {
  return {
    contractId: ACCOUNT_IPC_CONTRACT_V1.id,
    contractVersion: ACCOUNT_IPC_CONTRACT_V1.version,
    event: {
      kind: "capabilitiesChanged",
      eventId: "event_syntheticblocker01",
      emittedAt: timestampV1,
      processGeneration: 1,
      eventSeq,
      accountEpoch: 1,
    },
  } as const;
}

function receiptV1() {
  return {
    operationId: operationIdV1,
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
    eventSeq: 1,
    nextAction: "none",
    safeProjectionHandle: null,
  } as const;
}

describe("A: IPC identity and 41 operation runtime schemas", () => {
  it("freezes exactly 41 request/result schema pairs", () => {
    expect(ACCOUNT_GATEWAY_OPERATION_NAMES_V1).toHaveLength(41);
    expect(Object.keys(ACCOUNT_IPC_OPERATION_SCHEMAS_V1)).toEqual(
      [...ACCOUNT_GATEWAY_OPERATION_NAMES_V1],
    );
    expect(Object.keys(ACCOUNT_IPC_OPERATION_RUNTIME_SCHEMAS_V1)).toEqual(
      [...ACCOUNT_GATEWAY_OPERATION_NAMES_V1],
    );
    expect(Object.values(ACCOUNT_IPC_OPERATION_RUNTIME_SCHEMAS_V1)
      .every((entry) => Boolean(entry.request && entry.result && entry.event))).toBe(true);
  });

  it("accepts renderer-owned request/intent identities and rejects bogus login {}", () => {
    expect(validateAccountIpcRequestV1(loginRequestV1(), contextV1).ok).toBe(true);
    expect(validateAccountIpcRequestV1({ ...loginRequestV1(), payload: {} }, contextV1).ok)
      .toBe(false);
  });

  it("rejects requestId/intentId swaps, renderer operationId injection, and discriminator drift", () => {
    expect(validateAccountIpcRequestV1({
      ...loginRequestV1(),
      requestId: intentIdV1,
      intentId: requestIdV1,
    }, contextV1).ok).toBe(false);
    expect(validateAccountIpcRequestV1({ ...loginRequestV1(), operationId: operationIdV1 }, contextV1).ok)
      .toBe(false);
    expect(validateAccountIpcRequestV1({ ...loginRequestV1(), kind: "read" }, contextV1).ok)
      .toBe(false);
  });

  it("rejects response extra keys and wrong operation identity kind", () => {
    expect(validateAccountIpcResponseEnvelopeV1({
      ...loginResponseV1(),
      extra: true,
    }, loginResponseContextV1()).ok).toBe(false);
    expect(validateAccountIpcResponseEnvelopeV1({
      ...loginResponseV1(),
      operationId: requestIdV1,
    }, loginResponseContextV1()).ok).toBe(false);
  });

  it("rejects two individually valid responses when their correlation contexts are swapped", () => {
    const fixtures = ACCOUNT_SCENARIO_MANIFEST_V1.scenarios
      .flatMap((scenario) => scenario.steps)
      .filter((step, index, steps) =>
        steps.findIndex((candidate) => candidate.operation === step.operation) === index)
      .slice(0, 2)
      .map((step) => readScenarioPrivateTransientFixtureV1(step.privateFixtureRefs.Good));
    expect(fixtures).toHaveLength(2);
    expect(validateAccountIpcResponseEnvelopeV1(
      fixtures[0].result,
      scenarioResponseValidationContextV1(fixtures[0]),
    ).ok).toBe(true);
    expect(validateAccountIpcResponseEnvelopeV1(
      fixtures[1].result,
      scenarioResponseValidationContextV1(fixtures[1]),
    ).ok).toBe(true);
    expect(validateAccountIpcResponseEnvelopeV1(
      fixtures[0].result,
      scenarioResponseValidationContextV1(fixtures[1]),
    ).ok).toBe(false);
    expect(validateAccountIpcResponseEnvelopeV1(
      fixtures[1].result,
      scenarioResponseValidationContextV1(fixtures[0]),
    ).ok).toBe(false);
    const replacedOperationId = brokerOperationIdV1("operation_replacedvalidcorrelation01");
    expect(validateAccountIpcResponseEnvelopeV1(
      { ...(fixtures[0].result as Record<string, unknown>), operationId: replacedOperationId },
      scenarioResponseValidationContextV1(fixtures[0]),
    ).ok).toBe(false);
  });
});

describe("B: Broker matrix and ordering", () => {
  it("binds retry/reconcile equality to operationId as well as intentId", () => {
    const base = {
      intentId: intentIdV1,
      operationId: operationIdV1,
      operation: "auth.login",
      accountEpoch: 1,
      processGeneration: 1,
      requestFingerprint: `sha256:${"a".repeat(64)}`,
    } as const;
    expect(validateBrokerIntentBindingV1(base).ok).toBe(true);
    expect(validateBrokerIntentBindingV1({ ...base, operationId: requestIdV1 }).ok).toBe(false);
  });

  it.each([
    ["success with no remote confirmation", { remoteDisposition: "pending" }],
    ["read activates session", { operation: "usage.read", activationState: "persistentActive" }],
    ["configuration state on auth", { configuration: "applying", status: "pending", lifecycle: "dispatched", remoteDisposition: "pending", activationState: "unchanged" }],
    ["hard-expired capability succeeds", { capabilityFreshness: "hardExpired" }],
    ["outcomeUnknown without reconcile matrix", { status: "outcomeUnknown", remoteDisposition: "confirmed", lifecycle: "terminal" }],
  ])("rejects illegal receipt: %s", (_label, changes) => {
    expect(validateBrokerReceiptV1({ ...receiptV1(), ...changes }).ok).toBe(false);
  });

  it("rejects stale epoch/generation/sequence and treats events only as monotonic wakeups", () => {
    const current = { accountEpoch: 4, processGeneration: 2, eventSeq: 9 };
    expect(acceptsBrokerSettlementV1(current, { ...current, eventSeq: 9 })).toBe(true);
    expect(acceptsBrokerSettlementV1(current, { ...current, accountEpoch: 3 })).toBe(false);
    expect(acceptsBrokerSettlementV1(current, { ...current, processGeneration: 1 })).toBe(false);
    expect(acceptsBrokerEventWakeupV1(current, { ...current, eventSeq: 9 })).toBe(false);
    expect(acceptsBrokerEventWakeupV1(current, { ...current, eventSeq: 10 })).toBe(true);
    expect(validateAccountIpcEventEnvelopeV1(eventEnvelopeV1(4), {
      accountEpoch: 1,
      processGeneration: 1,
      eventSeq: 4,
    }).ok).toBe(false);
  });

  it("accepts eventSeq zero only as the first event in an epoch/generation", () => {
    expect(validateAccountIpcEventEnvelopeV1(eventEnvelopeV1(0), null).ok).toBe(true);
    expect(validateAccountIpcEventEnvelopeV1(eventEnvelopeV1(0), {
      accountEpoch: 1,
      processGeneration: 1,
      eventSeq: 0,
    }).ok).toBe(false);
    expect(validateAccountIpcEventEnvelopeV1(eventEnvelopeV1(1), {
      accountEpoch: 1,
      processGeneration: 1,
      eventSeq: 0,
    }).ok).toBe(true);
  });

  it("accepts the intended logout and configuration terminal success states", () => {
    expect(validateBrokerReceiptV1({
      ...receiptV1(),
      operation: "auth.logout",
      remoteDisposition: "unconfirmed",
      activationState: "locallyCleared",
      sessionCapability: "none",
    }).ok).toBe(true);
    expect(validateBrokerReceiptV1({
      ...receiptV1(),
      operation: "configuration.apply",
      activationState: "unchanged",
      configuration: "terminal",
    }).ok).toBe(true);
  });

  it("provides a valid success policy and rejects pending-as-success for all 41 operations", () => {
    expect(Object.keys(ACCOUNT_BROKER_OPERATION_POLICIES_V1))
      .toEqual([...ACCOUNT_GATEWAY_OPERATION_NAMES_V1]);
    for (const operation of ACCOUNT_GATEWAY_OPERATION_NAMES_V1) {
      const policy = ACCOUNT_BROKER_OPERATION_POLICIES_V1[operation];
      const activationState = policy.successActivationStates[0];
      const success = {
        ...receiptV1(),
        operation,
        remoteDisposition: policy.successRemoteDispositions[0],
        activationState,
        sessionCapability: activationState === "persistentActive" ? "persistent" : "none",
        configuration: policy.successConfigurationStates[0],
      } as const;
      expect(validateBrokerReceiptV1(success).ok, operation).toBe(true);
      expect(validateBrokerReceiptV1({ ...success, remoteDisposition: "pending" }).ok, operation)
        .toBe(false);
    }
  });
});

describe("B2: orthogonal Account feature state", () => {
  const signedOutStateV1 = {
    module: "ready",
    localMode: LOCAL_MODE_INVARIANT_V1,
    lifecycle: "signedOut",
    sessionCapability: "none",
    vault: "ready",
    connectivity: "online",
    capabilityFreshness: "unknown",
    accountEpoch: null,
    processGeneration: 1,
    authFlow: { state: "landing", generation: 1 },
    usage: { state: "idle", generation: 1, hasValue: false },
    configuration: { state: "idle", generation: 1, unread: false },
  } as const;

  it("keeps Local Mode invariant while allowing an ordinary signed-out state", () => {
    expect(validateAccountFeatureStateV1(signedOutStateV1).ok).toBe(true);
  });

  it.each([
    ["persistent capability while signed out", { sessionCapability: "persistent" }],
    ["account epoch while signed out", { accountEpoch: 1 }],
    ["account flow gates Local Mode", {
      localMode: { ...LOCAL_MODE_INVARIANT_V1, blockedByAccount: true },
    }],
    ["stale usage without a retained value", {
      usage: { state: "stale", generation: 1, hasValue: false },
    }],
    ["active MFA flow outside authorizing lifecycle", { authFlow: { state: "mfa", generation: 1 } }],
    ["auth flow without a stale-response fence", { authFlow: { state: "landing" } }],
  ])("rejects illegal state: %s", (_label, changes) => {
    expect(validateAccountFeatureStateV1({ ...signedOutStateV1, ...changes }).ok).toBe(false);
  });
});

describe("C: exact 89-scenario real payload parity", () => {
  it("freezes every ID/revision and runs Good/Base/Bad through both adapters", () => {
    expect(ACCOUNT_CANONICAL_SCENARIO_IDS_V1).toHaveLength(89);
    expect(ACCOUNT_SCENARIO_MANIFEST_V1.scenarios.map((scenario) => scenario.id))
      .toEqual(ACCOUNT_CANONICAL_SCENARIO_IDS_V1);
    const parity = validateScenarioManifestParityV1(
      ACCOUNT_SCENARIO_MANIFEST_V1,
      contextV1,
    );
    expect(parity.ok, parity.ok ? undefined : JSON.stringify(parity.issues.slice(0, 10)))
      .toBe(true);
    if (parity.ok) {
      expect(parity.value).toHaveLength(89);
      expect(parity.value.reduce((count, scenario) => count + scenario.steps.length, 0))
        .toBe(159);
    }
  });

  it("keeps manifest secret-free and resolves 159 private fixture references", () => {
    const operations = new Set(
      ACCOUNT_SCENARIO_MANIFEST_V1.scenarios.flatMap((scenario) =>
        scenario.steps.map((step) => step.operation)),
    );
    expect(operations.size).toBe(41);
    expect(operations.has("managedKey.readStatus")).toBe(true);
    expect(operations.has("managedKey.listCandidates")).toBe(true);
    expect(operations.has("managedKey.selectExisting")).toBe(true);
    expect(Object.keys(ACCOUNT_IPC_OPERATION_RUNTIME_SCHEMAS_V1)).toHaveLength(41);
    const serializedManifest = JSON.stringify(ACCOUNT_SCENARIO_MANIFEST_V1);
    expect(serializedManifest).not.toMatch(/synthetic-transient-input|totp-(?:svg|manual)|@example\.invalid/i);
    expect(serializedManifest).not.toContain('"request":');
    expect(serializedManifest).not.toContain('"result":');
    expect(serializedManifest).not.toContain('"event":');
    expect(ACCOUNT_SCENARIO_MANIFEST_V1.scenarios
      .reduce((count, scenario) => count + scenario.steps.length, 0)).toBe(159);
    for (const scenario of ACCOUNT_SCENARIO_MANIFEST_V1.scenarios) {
      for (const step of scenario.steps) {
        for (const fixtureClass of ["Good", "Base", "Bad"] as const) {
          const fixture = readScenarioPrivateTransientFixtureV1(step.privateFixtureRefs[fixtureClass]);
          expect(fixture.request).toEqual(expect.any(Object));
          expect(fixture.result).toEqual(expect.any(Object));
          expect(fixture.event).toEqual(expect.any(Object));
        }
      }
    }
    for (const operation of operations) {
      const step = ACCOUNT_SCENARIO_MANIFEST_V1.scenarios
        .flatMap((scenario) => scenario.steps)
        .find((candidate) => candidate.operation === operation);
      expect(step, operation).toBeDefined();
      if (!step) continue;
      const good = readScenarioPrivateTransientFixtureV1(step.privateFixtureRefs.Good);
      const bad = readScenarioPrivateTransientFixtureV1(step.privateFixtureRefs.Bad);
      expect(validateAccountIpcRequestV1(good.request, contextV1).ok, operation)
        .toBe(true);
      expect(validateAccountIpcResponseEnvelopeV1(good.result, scenarioResponseValidationContextV1(good)).ok, operation)
        .toBe(true);
      expect(validateAccountIpcEventEnvelopeV1(good.event, null).ok, operation)
        .toBe(true);
      const goodEvent = (good.event as { event: unknown }).event;
      expect(validateAccountOperationPayloadV1(operation, "event", goodEvent, contextV1).ok, operation)
        .toBe(true);
      expect(validateAccountIpcRequestV1(bad.request, contextV1).ok, operation)
        .toBe(false);
      expect(validateAccountIpcResponseEnvelopeV1(bad.result, scenarioResponseValidationContextV1(bad)).ok, operation)
        .toBe(false);
      expect(validateAccountIpcEventEnvelopeV1(bad.event, null).ok, operation)
        .toBe(false);
      const badEvent = (bad.event as { event: unknown }).event;
      expect(validateAccountOperationPayloadV1(operation, "event", badEvent, contextV1).ok, operation)
        .toBe(false);
    }
  });

  it("fails parity when only one execution lane is mutated", () => {
    const mutatedMockAdapterV1: ScenarioLaneAdapterV1 = {
      lane: "mock",
      execute(scenario, context) {
        const trace = ACCOUNT_SCENARIO_MOCK_ADAPTER_V1.execute(scenario, context);
        return scenario === ACCOUNT_SCENARIO_MANIFEST_V1.scenarios[0]
          ? { ...trace, terminalTruth: `${trace.terminalTruth}.mutated` }
          : trace;
      },
    };
    expect(validateScenarioManifestParityV1(
      ACCOUNT_SCENARIO_MANIFEST_V1,
      contextV1,
      mutatedMockAdapterV1,
      ACCOUNT_SCENARIO_IPC_ADAPTER_V1,
    ).ok).toBe(false);
  });
});

describe("D: secret/privacy, nominal safe values, and bound handles", () => {
  it("blocks every expanded secret/path/diff/server-message canary", () => {
    expect(ACCOUNT_FORBIDDEN_FIELD_CORPUS_V1).toEqual(expect.arrayContaining([
      "refreshCredential", "managedApiKey", "humanVerificationProof", "oauthTicket",
      "authToken", "serverMessage",
    ]));
    expect(ACCOUNT_FORBIDDEN_VALUE_CORPUS_V1).toEqual(expect.arrayContaining([
      "doge://account/callback?ticket=synthetic",
      "server raw message: synthetic upstream detail",
    ]));
    for (const field of ACCOUNT_FORBIDDEN_FIELD_CORPUS_V1) {
      expect(validateAccountSafeArtifactV1({ [field]: "synthetic" }).ok, field).toBe(false);
    }
    for (const value of ACCOUNT_FORBIDDEN_VALUE_CORPUS_V1) {
      expect(validateAccountSafeArtifactV1({ label: value }).ok, value).toBe(false);
    }
  });

  it("allows TOTP presentation only in dedicated one-time IPC result", () => {
    const enrollmentScenario = ACCOUNT_SCENARIO_MANIFEST_V1.scenarios
      .find((scenario) => scenario.id === "account.totp-enroll-password");
    const ref = enrollmentScenario?.steps[0]?.privateFixtureRefs.Good;
    expect(ref).toBeDefined();
    const fixture = readScenarioPrivateTransientFixtureV1(ref!);
    expect(validateAccountIpcResponseEnvelopeV1(
      fixture.result,
      scenarioResponseValidationContextV1(fixture),
    ).ok).toBe(true);
    expect(validateAccountSafeArtifactV1({
      qrSvg: oneTimeTotpPresentationV1("totp-svg~syntheticLeak001"),
    }).ok).toBe(false);
    const supportBundle = supportBundleV1();
    expect(validateAccountSupportBundleV1({
      ...supportBundle,
      diagnostic: { ...supportBundle.diagnostic, totpSecret: "totp-manual~syntheticLeak001" },
    }).ok).toBe(false);
  });

  it("requires validated nominal SafeLabel constructors", () => {
    const label = safeLabelV1("Synthetic label");
    expect(validateSafeLabelV1(label).ok).toBe(true);
    expect(validateSafeLabelV1("https://account.invalid").ok).toBe(false);
    expect(() => safeLabelV1("/Users/synthetic/private", "targetLabel")).toThrow();
  });

  it.each([
    "/Users/synthetic/private",
    "C:\\Users\\synthetic\\private",
    "file:///Users/synthetic/private",
    "../synthetic/private",
    "server raw message: synthetic upstream detail",
  ])("rejects exact path/URI/server-detail canary from safe constructors: %s", (value) => {
    expect(() => safeLabelV1(value, "targetLabel")).toThrow();
    expect(() => safeTextV1(value, "configurationValue")).toThrow();
  });

  it("rejects cross-kind, wrong-purpose, stale, and expired handles", () => {
    const handle = "handle~oauth-attempt~oauth~e1~g1~x1893459600~synthetic001";
    expect(validateAccountHandleV1(handle, {
      kind: "oauth-attempt", purpose: "oauth", accountEpoch: 1, processGeneration: 1,
      nowEpochSeconds: contextV1.nowEpochSeconds, maxTtlSeconds: 7_200,
    }).ok).toBe(true);
    for (const changes of [
      { kind: "auth-attempt" as const },
      { purpose: "identity-bind" },
      { accountEpoch: 2 },
      { processGeneration: 2 },
      { nowEpochSeconds: 1_893_459_601 },
    ]) {
      expect(validateAccountHandleV1(handle, {
        kind: "oauth-attempt", purpose: "oauth", accountEpoch: 1, processGeneration: 1,
        nowEpochSeconds: contextV1.nowEpochSeconds, maxTtlSeconds: 7_200,
        ...changes,
      }).ok).toBe(false);
    }
  });
});

describe("E: exact Authority/recipe/persistence/diagnostic/support schemas", () => {
  it("rejects extra keys and wrong array members rather than filtering", () => {
    expect(validateConfigRecipeV1({ ...CODEX_TOKEN_SERVICE_RECIPE_SCHEMA_V1, extra: true }).ok)
      .toBe(false);
    expect(validateConfigRecipeV1({ ...CODEX_TOKEN_SERVICE_RECIPE_SCHEMA_V1, writeSlots: [42] }).ok)
      .toBe(false);
    expect(validateAccountPersistenceSchemaV1({
      id: "doge-account-persistence",
      version: 1,
      entities: [42],
      vaultPurposes: ["refresh-session", "managed-key:codex-token-service"],
      activeAccountCardinality: "at-most-one-exposed",
      accountIsolationKey: ["authorityOriginId", "accountLinkId", "deviceId"],
      newerOrCorruptSchema: "quarantine-account-module",
      localCoreStartupDependency: false,
    }).ok).toBe(false);
    expect(validateAuthorityCapabilityDescriptorV1({
      contractId: TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.id,
      contractVersion: TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.version,
      observedAt: timestampV1,
      capabilities: {},
      guarantees: [42],
    }).ok).toBe(false);
  });

  it("validates private request and safe response exact envelopes", () => {
    const payloadValidator = (payload: unknown): SchemaValidationV1<null> =>
      payload === null
        ? { ok: true, value: null }
        : { ok: false, issues: [{ path: "$", code: "type", detail: "expected null" }] };
    expect(validateAuthorityPrivateRequestV1({
      contractId: TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.id,
      contractVersion: TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.version,
      operation: "capabilities.read",
      idempotencyOperationId: null,
      payload: null,
    }, (_operation, payload) => payloadValidator(payload)).ok).toBe(true);
    expect(validateAuthoritySafeResponseV1({
      contractId: TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.id,
      contractVersion: TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.version,
      ok: true,
      value: null,
      extra: true,
    }, payloadValidator).ok).toBe(false);
  });

  it("validates actual persistence records and privacy-scans deserialize/rebuild", () => {
    const record = {
      entity: "operation_ledger",
      schemaVersion: 1,
      intentId: intentIdV1,
      operationId: operationIdV1,
      operation: "auth.login",
      requestFingerprint: `sha256:${"b".repeat(64)}`,
      status: "pending",
      remoteDisposition: "pending",
      accountEpoch: 1,
      processGeneration: 1,
      reconcileDeadlineAt: null,
    } as const;
    expect(validateAccountPersistenceRecordV1(record).ok).toBe(true);
    expect(validateAccountPersistenceRecordV1({ ...record, extra: true }).ok).toBe(false);
    expect(deserializeAccountPersistenceRecordV1(JSON.stringify(record)).ok).toBe(true);
    expect(deserializeAccountPersistenceRecordV1(JSON.stringify({
      ...record,
      serverMessage: "server raw message: synthetic detail",
    })).ok).toBe(false);
    expect(validateAccountPersistenceRecordV1({
      ...record,
      operation: "auth.futureUnknownOperation",
    }).ok).toBe(false);
    for (const changes of [
      { operation: "gateway.bootstrap" },
      { status: "succeeded", remoteDisposition: "pending" },
      { status: "rejected", remoteDisposition: "reconciliationPending" },
      { status: "outcomeUnknown", remoteDisposition: "reconciliationPending", reconcileDeadlineAt: null },
    ]) {
      expect(validateAccountPersistenceRecordV1({ ...record, ...changes }).ok).toBe(false);
    }
  });

  it("rejects invalid dates/decimals and exact diagnostic/support extras", () => {
    for (const date of [
      "2030-01-01T00:00:00Z",
      "2030-01-01T00:00:00.1Z",
      "2030-01-01T00:00:00.1234Z",
      "2030-01-01T00:00:00.123456Z",
      "2030-01-01T00:00:00.123456789Z",
    ]) {
      expect(isRfc3339UtcV1(date), date).toBe(true);
    }
    for (const date of ["2030-02-30T00:00:00Z", "2030-01-01T24:00:00Z", "2030-01-01T00:00:00+00:00"]) {
      expect(isRfc3339UtcV1(date), date).toBe(false);
    }
    for (const decimal of ["01", "1.0", "1.20", "-1", "1e3"]) {
      expect(isCanonicalDecimalStringV1(decimal), decimal).toBe(false);
    }
    const diagnostic = diagnosticV1();
    expect(validateAccountDiagnosticSnapshotV1(diagnostic).ok).toBe(true);
    expect(validateAccountDiagnosticSnapshotV1({ ...diagnostic, extra: true }).ok).toBe(false);
    const support = supportBundleV1();
    expect(validateAccountSupportBundleV1(support).ok).toBe(true);
    expect(validateAccountSupportBundleV1({ ...support, filePath: "/Users/synthetic/private" }).ok)
      .toBe(false);
  });
});

describe("runtime schema exact key and wrong-member sentinel", () => {
  const noExtensionV1: RuntimeSchemaExtensionV1 = (_schema, _value, path, issues) => {
    issues.push({ path, code: "invariant", detail: "unexpected extension" });
  };

  it("rejects object extras, wrong array members, invalid nullability, and unknown enums", () => {
    const schema = {
      kind: "object",
      required: {
        state: { kind: "enum", values: ["ready"] },
        values: { kind: "array", item: { kind: "literal", value: "member" } },
        optionalTime: { kind: "nullable", inner: { kind: "timestamp" } },
      },
    } as const;
    for (const value of [
      { state: "ready", values: ["member"], optionalTime: null, extra: true },
      { state: "ready", values: [42], optionalTime: null },
      { state: "ready", values: ["member"], optionalTime: undefined },
      { state: "unknown", values: ["member"], optionalTime: null },
    ]) {
      const issues: SchemaIssueV1[] = [];
      validateRuntimeSchemaV1(schema, value, "$", issues, noExtensionV1);
      expect(issues.length).toBeGreaterThan(0);
    }
  });
});

function diagnosticV1() {
  return {
    contractId: ACCOUNT_DIAGNOSTIC_CONTRACT_V1.id,
    contractVersion: ACCOUNT_DIAGNOSTIC_CONTRACT_V1.version,
    observedAt: timestampV1,
    lifecycle: "terminal",
    accountEpoch: 1,
    processGeneration: 1,
    eventSeq: 1,
    capabilityFreshness: "fresh",
    configuration: "idle",
    counters: { pendingOperations: 0, wakeupsObserved: 1, staleResponsesRejected: 0 },
    lastFailureCode: null,
  } as const;
}

function supportBundleV1() {
  return {
    contractId: ACCOUNT_SUPPORT_BUNDLE_CONTRACT_V1.id,
    contractVersion: ACCOUNT_SUPPORT_BUNDLE_CONTRACT_V1.version,
    generatedAt: timestampV1,
    diagnostic: diagnosticV1(),
    persistenceState: "healthy",
    localMode: "available",
  } as const;
}
