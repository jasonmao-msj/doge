import { describe, expect, it } from "vitest";
import {
  ACCOUNT_BAD_CONTRACT_FIXTURES_V1,
  ACCOUNT_BASE_CONTRACT_FIXTURES_V1,
  ACCOUNT_CONTRACT_VERSION_V1,
  ACCOUNT_FORBIDDEN_FIELD_CORPUS_V1,
  ACCOUNT_FORBIDDEN_VALUE_CORPUS_V1,
  ACCOUNT_GATEWAY_CONTRACT_V1,
  ACCOUNT_GATEWAY_OPERATION_NAMES_V1,
  ACCOUNT_GOOD_CONTRACT_FIXTURES_V1,
  ACCOUNT_GOOD_IPC_RESPONSE_CONTEXT_V1,
  ACCOUNT_BASE_IPC_RESPONSE_CONTEXT_V1,
  ACCOUNT_CROSS_LAYER_ROUND_TRIP_FIXTURES_V1,
  ACCOUNT_OPERATION_BOUNDARIES_V1,
  ACCOUNT_SCENARIO_MANIFEST_V1,
  ACCOUNT_SEMANTIC_CONTRACT_V1,
  ACCOUNT_V1_FREEZE_RESOLUTIONS,
  AUTHORITY_GUARANTEES_V1,
  AUTHORITY_OPERATION_NAMES_V1,
  LOCAL_MODE_INVARIANT_V1,
  TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1,
  evaluateAccountConvenienceCompatibilityV1,
  hasCompleteAccountOperationProjectionV1,
  validateAccountGatewayEventV1,
  validateAccountIpcResponseV1,
  validateAccountPersistenceSchemaV1,
  validateAccountSafeArtifactV1,
  validateAccountSessionViewV1,
  validateAuthorityCapabilityDescriptorV1,
  brokerOperationIdV1,
  transportRequestIdV1,
  validateBrokerIntentBindingV1,
  validateBrokerReceiptV1,
  validateConfigRecipeV1,
  validateGatewayFailureV1,
  validateQuotaUsageViewV1,
  validateScenarioManifestV1,
} from "./index";

describe("canonical account v1 contract identities", () => {
  it("freezes the canonical semantic and Gateway ids with SemVer", () => {
    expect(ACCOUNT_SEMANTIC_CONTRACT_V1).toEqual({
      id: "doge-account-semantic",
      version: "1.0.0",
    });
    expect(ACCOUNT_GATEWAY_CONTRACT_V1).toEqual({
      id: "doge-account-gateway",
      version: "1.0.0",
    });
    expect(ACCOUNT_CONTRACT_VERSION_V1).toBe("1.0.0");
  });

  it("keeps a complete, unique operation projection across Gateway/Broker/Authority lanes", () => {
    expect(new Set(ACCOUNT_GATEWAY_OPERATION_NAMES_V1).size).toBe(
      ACCOUNT_GATEWAY_OPERATION_NAMES_V1.length,
    );
    expect(hasCompleteAccountOperationProjectionV1()).toBe(true);
    expect(ACCOUNT_OPERATION_BOUNDARIES_V1).toHaveLength(
      ACCOUNT_GATEWAY_OPERATION_NAMES_V1.length,
    );
    expect(ACCOUNT_GATEWAY_OPERATION_NAMES_V1).toContain("gateway.reconcileIntent");
    expect(ACCOUNT_GATEWAY_OPERATION_NAMES_V1).toContain("auth.readOAuthAttempt");
    expect(ACCOUNT_GATEWAY_OPERATION_NAMES_V1).toContain("managedKey.provision");
    expect(ACCOUNT_GATEWAY_OPERATION_NAMES_V1).toContain("configuration.apply");
    expect(new Set(AUTHORITY_OPERATION_NAMES_V1).size).toBe(
      AUTHORITY_OPERATION_NAMES_V1.length,
    );
  });

  it("round-trips every safe operation boundary without widening its closed shape", () => {
    for (const boundary of ACCOUNT_OPERATION_BOUNDARIES_V1) {
      expect(JSON.parse(JSON.stringify(boundary))).toEqual(boundary);
      expect(validateAccountSafeArtifactV1(boundary).ok).toBe(true);
    }
  });

  it("freezes B-01 through B-12 at exact executable enforcement sites", () => {
    expect(ACCOUNT_V1_FREEZE_RESOLUTIONS.map((entry) => entry.id)).toEqual(
      Array.from({ length: 12 }, (_value, index) => `B-${String(index + 1).padStart(2, "0")}`),
    );
    expect(ACCOUNT_V1_FREEZE_RESOLUTIONS.every((entry) => entry.enforcement.includes(":")))
      .toBe(true);
  });

  it("provides serializable TS/Rust/Authority operation round-trip fixtures", () => {
    const targets = new Set(
      ACCOUNT_CROSS_LAYER_ROUND_TRIP_FIXTURES_V1.map((fixture) => fixture.target),
    );
    expect(targets).toEqual(new Set(["typescript-ipc", "rust-broker", "authority-wire"]));
    expect(new Set(ACCOUNT_CROSS_LAYER_ROUND_TRIP_FIXTURES_V1.map((fixture) => fixture.fixtureId)).size)
      .toBe(ACCOUNT_CROSS_LAYER_ROUND_TRIP_FIXTURES_V1.length);
    for (const fixture of ACCOUNT_CROSS_LAYER_ROUND_TRIP_FIXTURES_V1) {
      expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture);
      expect(validateAccountSafeArtifactV1(fixture).ok).toBe(true);
      expect(fixture.semantics).toEqual({
        optionalFields: "omitted-unless-present",
        nullableFields: "explicit-null-preserved",
        decimalValues: "canonical-non-negative-string",
        semver: "major-minor-patch-string",
      });
    }
  });
});

describe("Good/Base/Bad executable schema fixtures", () => {
  it("accepts the Good contract foundation fixtures", () => {
    expect(validateScenarioManifestV1(ACCOUNT_GOOD_CONTRACT_FIXTURES_V1.manifest).ok).toBe(true);
    expect(validateAuthorityCapabilityDescriptorV1(
      ACCOUNT_GOOD_CONTRACT_FIXTURES_V1.authorityDescriptor,
    ).ok).toBe(true);
    expect(validateBrokerIntentBindingV1(
      ACCOUNT_GOOD_CONTRACT_FIXTURES_V1.brokerBinding,
    ).ok).toBe(true);
    expect(validateBrokerReceiptV1(
      ACCOUNT_GOOD_CONTRACT_FIXTURES_V1.brokerReceipt,
    ).ok).toBe(true);
    expect(validateAccountIpcResponseV1(
      ACCOUNT_GOOD_CONTRACT_FIXTURES_V1.ipcResponse,
      ACCOUNT_GOOD_IPC_RESPONSE_CONTEXT_V1,
    ).ok).toBe(true);
    expect(validateConfigRecipeV1(ACCOUNT_GOOD_CONTRACT_FIXTURES_V1.recipe).ok).toBe(true);
    expect(validateAccountPersistenceSchemaV1(
      ACCOUNT_GOOD_CONTRACT_FIXTURES_V1.persistence,
    ).ok).toBe(true);
  });

  it("accepts explicit null and canonical decimal-string Base semantics", () => {
    expect(validateAccountIpcResponseV1(
      ACCOUNT_BASE_CONTRACT_FIXTURES_V1.ipcExplicitNullSuccess,
      ACCOUNT_BASE_IPC_RESPONSE_CONTEXT_V1,
    ).ok).toBe(true);
    expect(validateQuotaUsageViewV1(
      ACCOUNT_BASE_CONTRACT_FIXTURES_V1.quotaDecimalAndNullableTimes,
    ).ok).toBe(true);
    expect(validateAccountGatewayEventV1(
      ACCOUNT_BASE_CONTRACT_FIXTURES_V1.quotaPullOnlyEvent,
    ).ok).toBe(true);
  });

  it("accepts the masked primary email label returned by a successful native login", () => {
    const requestId = transportRequestIdV1("request_loginmasked0001");
    const operationId = brokerOperationIdV1("operation_loginmasked0001");
    const result = validateAccountIpcResponseV1({
      contractId: "doge-account-ipc",
      contractVersion: "1.0.0",
      requestId,
      operation: "auth.login",
      processGeneration: 1,
      accountEpoch: 1,
      operationId,
      ok: true,
      value: {
        next: "authenticated",
        session: {
          status: "authenticated",
          accountEpoch: 1,
          sessionCapability: "persistent",
          profileLabel: "Token Matrix",
          primaryEmailLabel: "a***@token-matrix.com",
        },
      },
    }, {
      ...ACCOUNT_GOOD_IPC_RESPONSE_CONTEXT_V1,
      expectedKind: "mutation",
      expectedOperation: "auth.login",
      expectedRequestId: requestId,
      expectedOperationId: operationId,
    });

    expect(result.ok, result.ok ? undefined : JSON.stringify(result.issues)).toBe(true);
  });

  it.each([
    ["duplicate manifest id", ACCOUNT_BAD_CONTRACT_FIXTURES_V1.manifestDuplicateId],
    ["missing required manifest field", ACCOUNT_BAD_CONTRACT_FIXTURES_V1.manifestMissingRequiredField],
    ["secret-bearing manifest", ACCOUNT_BAD_CONTRACT_FIXTURES_V1.manifestSecretBearing],
    ["unknown manifest enum", ACCOUNT_BAD_CONTRACT_FIXTURES_V1.manifestUnknownEnum],
  ])("rejects Bad %s", (_label, fixture) => {
    expect(validateScenarioManifestV1(fixture).ok).toBe(false);
  });

  it("rejects unsupported IPC major and unknown Gateway failure enums", () => {
    expect(validateAccountIpcResponseV1(
      ACCOUNT_BAD_CONTRACT_FIXTURES_V1.unsupportedTransportMajor,
      ACCOUNT_GOOD_IPC_RESPONSE_CONTEXT_V1,
    ).ok).toBe(false);
    expect(validateAccountIpcResponseV1(
      ACCOUNT_BAD_CONTRACT_FIXTURES_V1.unknownGatewayErrorEnum,
      {
        ...ACCOUNT_GOOD_IPC_RESPONSE_CONTEXT_V1,
        expectedKind: "mutation",
        expectedOperation: "auth.login",
        expectedRequestId: transportRequestIdV1("request_synthetic0004"),
        expectedOperationId: brokerOperationIdV1("operation_synthetic0004"),
      },
    ).ok).toBe(false);
  });

  it("rejects outcomeUnknown without a reconcile next action", () => {
    expect(validateBrokerReceiptV1(
      ACCOUNT_BAD_CONTRACT_FIXTURES_V1.brokerOutcomeUnknownWithoutReconcile,
    ).ok).toBe(false);
  });

  it("rejects session-only authentication and numeric quota precision", () => {
    expect(validateAccountSessionViewV1(
      ACCOUNT_BAD_CONTRACT_FIXTURES_V1.accountAuthenticatedSessionOnly,
    ).ok).toBe(false);
    expect(validateQuotaUsageViewV1(
      ACCOUNT_BAD_CONTRACT_FIXTURES_V1.quotaNumberInsteadOfDecimalString,
    ).ok).toBe(false);
  });
});

describe("single canonical ScenarioManifestV1", () => {
  it("has unique immutable IDs, valid aliases, required lanes, and terminal truth", () => {
    const result = validateScenarioManifestV1(ACCOUNT_SCENARIO_MANIFEST_V1);
    expect(result.ok, result.ok ? undefined : JSON.stringify(result.issues)).toBe(true);
    expect(new Set(ACCOUNT_SCENARIO_MANIFEST_V1.scenarios.map((entry) => entry.id)).size)
      .toBe(ACCOUNT_SCENARIO_MANIFEST_V1.scenarios.length);
    expect(ACCOUNT_SCENARIO_MANIFEST_V1.scenarios).toHaveLength(89);
    expect(ACCOUNT_SCENARIO_MANIFEST_V1.scenarios.every((entry) => entry.semanticRevision === 1))
      .toBe(true);
  });

  it("keeps Local Mode invariant in every remote, vault, version, and configuration scenario", () => {
    for (const scenario of ACCOUNT_SCENARIO_MANIFEST_V1.scenarios) {
      expect(scenario.localModeInvariant).toEqual(LOCAL_MODE_INVARIANT_V1);
      expect(scenario.requiredLanes.length).toBeGreaterThan(0);
      expect(scenario.resetAndReplay.reset).toBe("restoreInitialState");
      expect(scenario.secretNegativeAssertions).toEqual({
        forbiddenFieldCorpus: true,
        forbiddenValueCorpus: true,
        noRealEmail: true,
        noCredential: true,
        noProductionUrl: true,
        noRawPathOrDiff: true,
      });
    }
  });

  it("normalizes research aliases without creating alternate scenario truth", () => {
    const scenarioIds = new Set(
      ACCOUNT_SCENARIO_MANIFEST_V1.scenarios.map((scenario) => scenario.id),
    );
    for (const alias of ACCOUNT_SCENARIO_MANIFEST_V1.aliases) {
      expect(scenarioIds.has(alias.alias)).toBe(false);
      for (const canonical of alias.canonical) {
        expect(scenarioIds.has(canonical)).toBe(true);
      }
    }
  });
});

describe("secret, PII, URL, path, and raw-diff corpus", () => {
  it("rejects every forbidden field independently", () => {
    for (const field of ACCOUNT_FORBIDDEN_FIELD_CORPUS_V1) {
      const result = validateAccountSafeArtifactV1({ safe: { [field]: "synthetic" } });
      expect(result.ok, field).toBe(false);
    }
  });

  it("rejects every synthetic forbidden value independently", () => {
    for (const value of ACCOUNT_FORBIDDEN_VALUE_CORPUS_V1) {
      const result = validateAccountSafeArtifactV1({ safeLabel: value });
      expect(result.ok, value).toBe(false);
    }
  });

  it("keeps safe-output fixtures recursively safe while requests stay transient", () => {
    const {
      manifest: _transientScenarioManifest,
      ...safeGoodOutputs
    } = ACCOUNT_GOOD_CONTRACT_FIXTURES_V1;
    expect(validateAccountSafeArtifactV1(safeGoodOutputs).ok).toBe(true);
    expect(validateAccountSafeArtifactV1(ACCOUNT_BASE_CONTRACT_FIXTURES_V1).ok).toBe(true);
  });

  it("rejects event snapshots because events are wakeups, not truth", () => {
    expect(validateAccountGatewayEventV1({
      kind: "sessionChanged",
      eventId: "event_synthetic0002",
      emittedAt: "2030-01-01T00:00:00Z",
      accountEpoch: 8,
      session: { status: "authenticated" },
    }).ok).toBe(false);
  });

  it("rejects legacy retryable/action mixtures and additional event truth fields", () => {
    expect(validateGatewayFailureV1({
      code: "offline",
      stage: "login",
      recovery: { action: "retry", afterMs: null },
      retryable: true,
    }).ok).toBe(false);
    expect(validateAccountGatewayEventV1({
      kind: "configurationTaskChanged",
      eventId: "event_synthetic0003",
      emittedAt: "2030-01-01T00:00:00Z",
      terminal: "succeeded",
    }).ok).toBe(false);
  });
});

describe("closed compatibility and recovery", () => {
  it("fails unsupported major closed while Local Mode remains unchanged", () => {
    expect(evaluateAccountConvenienceCompatibilityV1(
      ACCOUNT_BAD_CONTRACT_FIXTURES_V1.unsupportedTransportMajor,
      "doge-account-ipc",
      [],
    )).toEqual({
      available: false,
      localMode: LOCAL_MODE_INVARIANT_V1,
      reason: "contractUnsupported",
    });
  });

  it("fails missing guarantees closed while Local Mode remains unchanged", () => {
    expect(evaluateAccountConvenienceCompatibilityV1(
      ACCOUNT_BAD_CONTRACT_FIXTURES_V1.missingAuthorityGuarantee,
      TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.id,
      ["durable_token_pair_v1"],
    )).toEqual({
      available: false,
      localMode: LOCAL_MODE_INVARIANT_V1,
      reason: "capabilityUnavailable",
    });
  });

  it("accepts a supported additive minor only with known required guarantees", () => {
    expect(evaluateAccountConvenienceCompatibilityV1(
      ACCOUNT_BASE_CONTRACT_FIXTURES_V1.supportedMinorDescriptor,
      TOKEN2API_ACCOUNT_AUTHORITY_CONTRACT_V1.id,
      ["durable_token_pair_v1"],
    )).toEqual({
      available: true,
      localMode: LOCAL_MODE_INVARIANT_V1,
      supportedVersion: "1.0.0",
    });
    expect(AUTHORITY_GUARANTEES_V1).toContain("typed_logout_outcome_v1");
  });

  it("rejects an unknown error enum without raw message fallback", () => {
    expect(validateGatewayFailureV1({
      code: "newServerReason",
      stage: "login",
      recovery: { action: "none" },
      message: "fallback copy",
    }).ok).toBe(false);
  });
});
