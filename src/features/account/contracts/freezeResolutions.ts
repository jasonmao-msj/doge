export const ACCOUNT_V1_FREEZE_RESOLUTIONS = [
  {
    id: "B-01",
    resolution: "single-account-gateway-v1",
    enforcement: "gateway.ts:AccountGatewayV1",
  },
  {
    id: "B-02",
    resolution: "composed-gateway-ports",
    enforcement: "gateway.ts:AccountGatewayV1",
  },
  {
    id: "B-03",
    resolution: "persistent-session-only",
    enforcement: "semanticValidator.ts:validateAccountSessionViewV1",
  },
  {
    id: "B-04",
    resolution: "three-distinct-identities",
    enforcement: "semantic.ts:GatewayIntentIdV1|TransportRequestIdV1|BrokerOperationIdV1",
  },
  {
    id: "B-05",
    resolution: "oauth-authoritative-read",
    enforcement: "gateway.ts:AccountAuthPortV1.readOAuthAttempt",
  },
  {
    id: "B-06",
    resolution: "broker-configuration-operations",
    enforcement: "laneProjection.ts:ACCOUNT_OPERATION_PROJECTIONS_V1",
  },
  {
    id: "B-07",
    resolution: "discriminated-gateway-recovery",
    enforcement: "semanticValidator.ts:validateGatewayFailureV1",
  },
  {
    id: "B-08",
    resolution: "canonical-ids-and-semver",
    enforcement: "semantic.ts:ACCOUNT_*_CONTRACT_V1",
  },
  {
    id: "B-09",
    resolution: "single-scenario-manifest-and-aliases",
    enforcement: "scenarioValidator.ts:validateScenarioManifestV1",
  },
  {
    id: "B-10",
    resolution: "no-renderer-url",
    enforcement: "privacy.ts:validateAccountSafeArtifactV1",
  },
  {
    id: "B-11",
    resolution: "events-are-wakeups",
    enforcement: "semanticValidator.ts:validateAccountGatewayEventV1",
  },
  {
    id: "B-12",
    resolution: "closed-variant-is-major",
    enforcement: "compatibility.ts:evaluateAccountConvenienceCompatibilityV1",
  },
] as const;

export type AccountFreezeResolutionIdV1 =
  (typeof ACCOUNT_V1_FREEZE_RESOLUTIONS)[number]["id"];
