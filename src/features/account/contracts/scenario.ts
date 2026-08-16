import type {
  AccountCapabilityKeyV1,
  AccountTerminalTruthV1,
  LocalModeInvariantV1,
} from "./semantic";
import {
  ACCOUNT_SEMANTIC_CONTRACT_V1,
  LOCAL_MODE_INVARIANT_V1,
} from "./semantic";
import type { AccountGatewayEventV1, GatewayOperationNameV1 } from "./gateway";
import type { AccountContractLaneV1 } from "./laneProjection";

export type ScenarioPrivateFixtureRefV1 = string & {
  readonly __scenarioPrivateFixtureRefV1: "scenario-private-transient-fixture";
};

export type AccountScenarioStepV1 = {
  readonly stepId: string;
  readonly operation: GatewayOperationNameV1;
  readonly privateFixtureRefs: {
    readonly Good: ScenarioPrivateFixtureRefV1;
    readonly Base: ScenarioPrivateFixtureRefV1;
    readonly Bad: ScenarioPrivateFixtureRefV1;
  };
};

export const ACCOUNT_SCENARIO_MANIFEST_CONTRACT_V1 = {
  id: "doge-account-scenario-manifest",
  version: "1.0.0",
} as const;

export type ScenarioInitialProductStateV1 =
  | "localOnly"
  | "signedOut"
  | "authenticatedPersistent"
  | "accountUnavailable"
  | "configurationEligible";

export type ScenarioInitialBrokerStateClassV1 =
  | "idle"
  | "committedSession"
  | "pendingFlow"
  | "configurationReady"
  | "quarantined";

export type ScenarioInitialAuthorityStateClassV1 =
  | "anonymous"
  | "activeAccount"
  | "activeSession"
  | "capabilityDisabled"
  | "serviceUnavailable";

export type ScenarioExpectedResultV1 =
  | "success"
  | "safeFailure"
  | "nonterminal"
  | "outcomeUnknown"
  | "locallyCompleteRemoteUnconfirmed";

export type ScenarioBrokerReceiptClassV1 =
  | "none"
  | "nonterminal"
  | "succeeded"
  | "rejected"
  | "cancelledBeforeSend"
  | "outcomeUnknown";

export type ScenarioAuthorityDeltaV1 =
  | "none"
  | "challengeIssued"
  | "accountCreated"
  | "sessionCreated"
  | "sessionRefreshed"
  | "sessionRevoked"
  | "profileUpdated"
  | "securityUpdated"
  | "managedKeyChanged"
  | "usageObserved";

export type ScenarioScheduleV1 = {
  readonly latencyMs: readonly number[];
  readonly faults: readonly (
    | "offline"
    | "serviceUnavailable"
    | "lostResponse"
    | "vaultUnavailable"
    | "metadataFailure"
    | "concurrentEdit"
    | "unsafeTarget"
    | "rollbackFailure"
    | "unknownEnum"
    | "unsupportedMajor"
    | "missingGuarantee"
  )[];
  readonly cancellationsAtAction: readonly number[];
};

export type ScenarioExpectedEventKindV1 = AccountGatewayEventV1["kind"];

export type ScenarioSecretNegativeAssertionsV1 = {
  readonly forbiddenFieldCorpus: true;
  readonly forbiddenValueCorpus: true;
  readonly noRealEmail: true;
  readonly noCredential: true;
  readonly noProductionUrl: true;
  readonly noRawPathOrDiff: true;
};

export type ScenarioReplayV1 = {
  readonly reset: "restoreInitialState";
  readonly replay: "deterministic" | "idempotentTerminal" | "failClosed";
  readonly existingSemanticRevision: 1;
};

export type AccountScenarioV1 = {
  readonly id: string;
  readonly semanticRevision: 1;
  readonly releaseCut: "A0" | "deferred";
  readonly requiredLanes: readonly AccountContractLaneV1[];
  readonly requiredCapabilities: readonly AccountCapabilityKeyV1[];
  readonly initialProductState: ScenarioInitialProductStateV1;
  readonly initialBrokerStateClass: ScenarioInitialBrokerStateClassV1;
  readonly initialAuthorityStateClass: ScenarioInitialAuthorityStateClassV1;
  readonly orderedActions: readonly string[];
  readonly steps: readonly AccountScenarioStepV1[];
  readonly schedule: ScenarioScheduleV1;
  readonly expectedGateway: {
    readonly operations: readonly GatewayOperationNameV1[];
    readonly results: readonly ScenarioExpectedResultV1[];
    readonly events: readonly ScenarioExpectedEventKindV1[];
  };
  readonly expectedBrokerReceipt: ScenarioBrokerReceiptClassV1;
  readonly expectedAuthorityStateDelta: ScenarioAuthorityDeltaV1;
  readonly terminalTruth: AccountTerminalTruthV1;
  readonly localModeInvariant: LocalModeInvariantV1;
  readonly secretNegativeAssertions: ScenarioSecretNegativeAssertionsV1;
  readonly resetAndReplay: ScenarioReplayV1;
};

export type ScenarioAliasV1 = {
  readonly alias: string;
  readonly canonical: readonly string[];
};

export type ScenarioManifestV1 = {
  readonly contract: typeof ACCOUNT_SCENARIO_MANIFEST_CONTRACT_V1;
  readonly semanticContract: typeof ACCOUNT_SEMANTIC_CONTRACT_V1;
  readonly aliases: readonly ScenarioAliasV1[];
  readonly scenarios: readonly AccountScenarioV1[];
};

export const SCENARIO_SECRET_NEGATIVE_ASSERTIONS_V1: ScenarioSecretNegativeAssertionsV1 = {
  forbiddenFieldCorpus: true,
  forbiddenValueCorpus: true,
  noRealEmail: true,
  noCredential: true,
  noProductionUrl: true,
  noRawPathOrDiff: true,
};

export const SCENARIO_LOCAL_MODE_INVARIANT_V1 = LOCAL_MODE_INVARIANT_V1;
