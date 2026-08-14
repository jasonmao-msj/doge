import {
  ACCOUNT_GATEWAY_EVENT_KINDS_V1,
  ACCOUNT_GATEWAY_OPERATION_NAMES_V1,
} from "./gateway";
import { ACCOUNT_CONTRACT_LANES_V1 } from "./laneProjection";
import { validateAccountSafeArtifactV1 } from "./privacy";
import type {
  AccountScenarioV1,
  ScenarioManifestV1,
} from "./scenario";
import { ACCOUNT_SCENARIO_MANIFEST_CONTRACT_V1 } from "./scenario";
import { ACCOUNT_CANONICAL_SCENARIO_IDS_V1 } from "./scenarioIds";
import {
  ACCOUNT_CAPABILITY_KEYS_V1,
  ACCOUNT_SEMANTIC_CONTRACT_V1,
  ACCOUNT_TERMINAL_TRUTHS_V1,
} from "./semantic";
import type { SchemaIssueV1, SchemaValidationV1 } from "./schema";
import {
  collectDuplicateStringsV1,
  isBooleanV1,
  isEnumValueV1,
  isNonNegativeIntegerV1,
  isRecordV1,
  issueV1,
  validateKeysV1,
  validateExactKeysV1,
  validationV1,
} from "./schema";

const REQUIRED_MANIFEST_SCENARIOS_V1 = [
  "bootstrap.signed-out-happy",
  "bootstrap.offline",
  "vault.unavailable-no-session-only",
  "register.direct-success",
  "register.email-verification",
  "register.access-only-session-rejected",
  "login.happy",
  "login.account-policy-blocked",
  "login.mfa-happy",
  "oauth.happy-return",
  "oauth.provider-disabled",
  "oauth.ticket-expired",
  "oauth.ticket-replayed",
  "password-reset.request-and-return",
  "password-reset.expired-link",
  "password-reset.disabled",
  "session.cold-restore",
  "session.refresh-lost-response",
  "session.refresh-concurrent-singleflight",
  "session.logout-remote-unconfirmed",
  "account.profile-update-happy",
  "account.change-password-happy",
  "account.totp-enroll-password",
  "account.identity-bind-happy",
  "session.revoke-all-confirmed",
  "usage.fresh-normal",
  "usage.soft-stale-refresh-fails",
  "usage.exhausted",
  "managed-key.provision-success",
  "managed-key.response-lost-replay",
  "configuration.no-config-success",
  "configuration.healthy-manual-preserve",
  "configuration.already-configured-noop",
  "configuration.conflict-review",
  "configuration.plan-expired",
  "configuration.concurrent-edit",
  "configuration.rollback-incomplete",
  "configuration.apply-outcome-unknown-reconcile",
  "version.transport-major-unsupported",
  "version.authority-guarantee-missing",
  "version.unknown-enum-fails-closed",
  "local-mode.flags-off",
  "local-mode.authority-outage",
] as const;

const SCENARIO_ID_PATTERN_V1 = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const ALLOWED_INITIAL_PRODUCT_STATES_V1 = [
  "localOnly",
  "signedOut",
  "authenticatedPersistent",
  "accountUnavailable",
  "configurationEligible",
] as const;
const ALLOWED_INITIAL_BROKER_STATES_V1 = [
  "idle",
  "committedSession",
  "pendingFlow",
  "configurationReady",
  "quarantined",
] as const;
const ALLOWED_INITIAL_AUTHORITY_STATES_V1 = [
  "anonymous",
  "activeAccount",
  "activeSession",
  "capabilityDisabled",
  "serviceUnavailable",
] as const;
const ALLOWED_RESULTS_V1 = [
  "success",
  "safeFailure",
  "nonterminal",
  "outcomeUnknown",
  "locallyCompleteRemoteUnconfirmed",
] as const;
const ALLOWED_BROKER_RECEIPTS_V1 = [
  "none",
  "nonterminal",
  "succeeded",
  "rejected",
  "cancelledBeforeSend",
  "outcomeUnknown",
] as const;
const ALLOWED_AUTHORITY_DELTAS_V1 = [
  "none",
  "challengeIssued",
  "accountCreated",
  "sessionCreated",
  "sessionRefreshed",
  "sessionRevoked",
  "profileUpdated",
  "securityUpdated",
  "managedKeyChanged",
  "usageObserved",
] as const;
const ALLOWED_FAULTS_V1 = [
  "offline",
  "serviceUnavailable",
  "lostResponse",
  "vaultUnavailable",
  "metadataFailure",
  "concurrentEdit",
  "unsafeTarget",
  "rollbackFailure",
  "unknownEnum",
  "unsupportedMajor",
  "missingGuarantee",
] as const;

export function validateScenarioManifestV1(
  value: unknown,
): SchemaValidationV1<ScenarioManifestV1> {
  const issues: SchemaIssueV1[] = [];
  if (!isRecordV1(value)) {
    return { ok: false, issues: [issueV1("$", "type", "expected ScenarioManifestV1 object")] };
  }
  validateKeysV1(value, ["contract", "semanticContract", "aliases", "scenarios"], "$", issues);
  validateContractRefsV1(value, issues);
  const scenarios = validateScenariosV1(value.scenarios, issues);
  validateAliasesV1(value.aliases, new Set(scenarios.map((scenario) => scenario.id)), issues);

  const ids = scenarios.map((scenario) => scenario.id);
  for (const duplicate of collectDuplicateStringsV1(ids)) {
    issues.push(issueV1("$.scenarios", "duplicate", `duplicate scenario id ${duplicate}`));
  }
  const idsSet = new Set(ids);
  for (const required of REQUIRED_MANIFEST_SCENARIOS_V1) {
    if (!idsSet.has(required)) {
      issues.push(issueV1("$.scenarios", "required", `missing required scenario ${required}`));
    }
  }
  if (ids.length !== ACCOUNT_CANONICAL_SCENARIO_IDS_V1.length ||
    ids.some((id, index) => id !== ACCOUNT_CANONICAL_SCENARIO_IDS_V1[index])
  ) {
    issues.push(issueV1("$.scenarios", "invariant", "canonical v1 manifest must contain exactly 89 scenarios"));
  }
  const privacy = validateAccountSafeArtifactV1(value);
  if (!privacy.ok) {
    issues.push(...privacy.issues);
  }
  return validationV1(value as ScenarioManifestV1, issues);
}


function validateContractRefsV1(
  value: Record<string, unknown>,
  issues: SchemaIssueV1[],
): void {
  if (!isRecordV1(value.contract) ||
    value.contract.id !== ACCOUNT_SCENARIO_MANIFEST_CONTRACT_V1.id ||
    value.contract.version !== ACCOUNT_SCENARIO_MANIFEST_CONTRACT_V1.version
  ) {
    issues.push(issueV1("$.contract", "enum", "unexpected scenario manifest identity/version"));
  }
  if (!isRecordV1(value.semanticContract) ||
    value.semanticContract.id !== ACCOUNT_SEMANTIC_CONTRACT_V1.id ||
    value.semanticContract.version !== ACCOUNT_SEMANTIC_CONTRACT_V1.version
  ) {
    issues.push(issueV1("$.semanticContract", "enum", "unexpected semantic contract identity/version"));
  }
}

function validateScenariosV1(
  value: unknown,
  issues: SchemaIssueV1[],
): readonly AccountScenarioV1[] {
  if (!Array.isArray(value)) {
    issues.push(issueV1("$.scenarios", "type", "expected scenario array"));
    return [];
  }
  const validShape: AccountScenarioV1[] = [];
  value.forEach((entry, index) => {
    const path = `$.scenarios[${index}]`;
    if (!isRecordV1(entry)) {
      issues.push(issueV1(path, "type", "expected scenario object"));
      return;
    }
    validateScenarioV1(entry, path, issues);
    if (typeof entry.id === "string") {
      validShape.push(entry as AccountScenarioV1);
    }
  });
  return validShape;
}

function validateScenarioV1(
  value: Record<string, unknown>,
  path: string,
  issues: SchemaIssueV1[],
): void {
  if (typeof value.id !== "string" || !SCENARIO_ID_PATTERN_V1.test(value.id)) {
    issues.push(issueV1(`${path}.id`, "format", "expected canonical lower-case scenario id"));
  }
  if (value.semanticRevision !== 1) {
    issues.push(issueV1(`${path}.semanticRevision`, "invariant", "scenario semantic revision is frozen at 1"));
  }
  validateKeysV1(
    value,
    [
      "id",
      "semanticRevision",
      "releaseCut",
      "requiredLanes",
      "requiredCapabilities",
      "initialProductState",
      "initialBrokerStateClass",
      "initialAuthorityStateClass",
      "orderedActions",
      "steps",
      "schedule",
      "expectedGateway",
      "expectedBrokerReceipt",
      "expectedAuthorityStateDelta",
      "terminalTruth",
      "localModeInvariant",
      "secretNegativeAssertions",
      "resetAndReplay",
    ],
    path,
    issues,
  );
  if (value.releaseCut !== "A0" && value.releaseCut !== "deferred") {
    issues.push(issueV1(`${path}.releaseCut`, "enum", "unknown release cut"));
  }
  validateClosedStringArrayV1(value.requiredLanes, ACCOUNT_CONTRACT_LANES_V1, `${path}.requiredLanes`, issues, true);
  validateClosedStringArrayV1(value.requiredCapabilities, ACCOUNT_CAPABILITY_KEYS_V1, `${path}.requiredCapabilities`, issues, false);
  validateEnumV1(value.initialProductState, ALLOWED_INITIAL_PRODUCT_STATES_V1, `${path}.initialProductState`, issues);
  validateEnumV1(value.initialBrokerStateClass, ALLOWED_INITIAL_BROKER_STATES_V1, `${path}.initialBrokerStateClass`, issues);
  validateEnumV1(value.initialAuthorityStateClass, ALLOWED_INITIAL_AUTHORITY_STATES_V1, `${path}.initialAuthorityStateClass`, issues);
  validateStringArrayV1(value.orderedActions, `${path}.orderedActions`, issues, true);
  validateScenarioStepsV1(value.steps, value.expectedGateway, `${path}.steps`, issues);
  validateScheduleV1(value.schedule, `${path}.schedule`, issues);
  validateExpectedGatewayV1(value.expectedGateway, `${path}.expectedGateway`, issues);
  validateEnumV1(value.expectedBrokerReceipt, ALLOWED_BROKER_RECEIPTS_V1, `${path}.expectedBrokerReceipt`, issues);
  validateEnumV1(value.expectedAuthorityStateDelta, ALLOWED_AUTHORITY_DELTAS_V1, `${path}.expectedAuthorityStateDelta`, issues);
  validateEnumV1(value.terminalTruth, ACCOUNT_TERMINAL_TRUTHS_V1, `${path}.terminalTruth`, issues);
  validateLocalModeV1(value.localModeInvariant, `${path}.localModeInvariant`, issues);
  validateSecretAssertionsV1(value.secretNegativeAssertions, `${path}.secretNegativeAssertions`, issues);
  validateReplayV1(value.resetAndReplay, `${path}.resetAndReplay`, issues);
  validateTerminalTruthV1(value, path, issues);
}

function validateScenarioStepsV1(
  value: unknown,
  expectedGateway: unknown,
  path: string,
  issues: SchemaIssueV1[],
): void {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(issueV1(path, "required", "scenario requires executable payload steps"));
    return;
  }
  const operations = isRecordV1(expectedGateway) && Array.isArray(expectedGateway.operations)
    ? expectedGateway.operations
    : [];
  if (value.length !== operations.length) {
    issues.push(issueV1(path, "invariant", "scenario steps must match expected operation count"));
  }
  value.forEach((step, index) => {
    const stepPath = `${path}[${index}]`;
    if (!isRecordV1(step)) {
      issues.push(issueV1(stepPath, "type", "expected executable scenario step"));
      return;
    }
    validateExactKeysV1(step, ["stepId", "operation", "privateFixtureRefs"], [], stepPath, issues);
    if (step.operation !== operations[index]) {
      issues.push(issueV1(`${stepPath}.operation`, "invariant", "step operation projection mismatch"));
    }
    if (typeof step.stepId !== "string" || step.stepId.length < 8) {
      issues.push(issueV1(`${stepPath}.stepId`, "format", "invalid immutable step id"));
    }
    if (!isRecordV1(step.privateFixtureRefs)) {
      issues.push(issueV1(`${stepPath}.privateFixtureRefs`, "type", "expected Good/Base/Bad private fixture references"));
      return;
    }
    validateExactKeysV1(step.privateFixtureRefs, ["Good", "Base", "Bad"], [], `${stepPath}.privateFixtureRefs`, issues);
    for (const fixtureClass of ["Good", "Base", "Bad"] as const) {
      const ref = step.privateFixtureRefs[fixtureClass];
      const fixturePath = `${stepPath}.privateFixtureRefs.${fixtureClass}`;
      if (typeof ref !== "string" || !/^private-fixture~synthetic[a-z0-9]+~(?:good|base|bad)$/.test(ref)) {
        issues.push(issueV1(fixturePath, "format", "invalid opaque private fixture reference"));
      }
    }
  });
}

function validateTerminalTruthV1(
  scenario: Record<string, unknown>,
  path: string,
  issues: SchemaIssueV1[],
): void {
  const expected = isRecordV1(scenario.expectedGateway) && Array.isArray(scenario.expectedGateway.results)
    ? scenario.expectedGateway.results
    : [];
  const receipt = scenario.expectedBrokerReceipt;
  switch (scenario.terminalTruth) {
    case "nonterminal":
      if (!expected.includes("nonterminal") || receipt !== "nonterminal") {
        issues.push(issueV1(path, "invariant", "nonterminal truth requires nonterminal Gateway and Broker evidence"));
      }
      break;
    case "succeeded":
      if (!expected.includes("success") || receipt !== "succeeded") {
        issues.push(issueV1(path, "invariant", "succeeded truth requires successful Gateway and Broker evidence"));
      }
      break;
    case "rejected":
      if (!expected.includes("safeFailure") || receipt !== "rejected") {
        issues.push(issueV1(path, "invariant", "rejected truth requires safe failure and rejected receipt"));
      }
      break;
    case "cancelledBeforeSend":
      if (receipt !== "cancelledBeforeSend") {
        issues.push(issueV1(path, "invariant", "cancel-before-send requires matching Broker receipt"));
      }
      break;
    case "outcomeUnknown":
      if (!expected.includes("outcomeUnknown") || receipt !== "outcomeUnknown") {
        issues.push(issueV1(path, "invariant", "outcomeUnknown requires explicit Gateway and Broker uncertainty"));
      }
      if (!isRecordV1(scenario.expectedGateway) ||
        !Array.isArray(scenario.expectedGateway.operations) ||
        !scenario.expectedGateway.operations.includes("gateway.reconcileIntent")
      ) {
        issues.push(issueV1(`${path}.expectedGateway.operations`, "invariant", "outcomeUnknown must expose reconcileIntent"));
      }
      break;
    case "locallyCompleteRemoteUnconfirmed":
      if (!expected.includes("locallyCompleteRemoteUnconfirmed") || receipt !== "succeeded") {
        issues.push(issueV1(path, "invariant", "local completion must remain distinct from remote confirmation"));
      }
      break;
    default:
      break;
  }
}

function validateExpectedGatewayV1(
  value: unknown,
  path: string,
  issues: SchemaIssueV1[],
): void {
  if (!isRecordV1(value)) {
    issues.push(issueV1(path, "type", "expected Gateway expectation object"));
    return;
  }
  validateKeysV1(value, ["operations", "results", "events"], path, issues);
  validateOrderedClosedStringArrayV1(value.operations, ACCOUNT_GATEWAY_OPERATION_NAMES_V1, `${path}.operations`, issues, true);
  validateOrderedClosedStringArrayV1(value.results, ALLOWED_RESULTS_V1, `${path}.results`, issues, true);
  validateOrderedClosedStringArrayV1(value.events, ACCOUNT_GATEWAY_EVENT_KINDS_V1, `${path}.events`, issues, false);
}

function validateScheduleV1(
  value: unknown,
  path: string,
  issues: SchemaIssueV1[],
): void {
  if (!isRecordV1(value)) {
    issues.push(issueV1(path, "type", "expected schedule object"));
    return;
  }
  validateKeysV1(value, ["latencyMs", "faults", "cancellationsAtAction"], path, issues);
  if (!Array.isArray(value.latencyMs) || value.latencyMs.some((entry) => !isNonNegativeIntegerV1(entry))) {
    issues.push(issueV1(`${path}.latencyMs`, "range", "expected non-negative integer latency list"));
  }
  validateClosedStringArrayV1(value.faults, ALLOWED_FAULTS_V1, `${path}.faults`, issues, false);
  if (!Array.isArray(value.cancellationsAtAction) ||
    value.cancellationsAtAction.some((entry) => !isNonNegativeIntegerV1(entry))
  ) {
    issues.push(issueV1(`${path}.cancellationsAtAction`, "range", "expected action index list"));
  }
}

function validateLocalModeV1(value: unknown, path: string, issues: SchemaIssueV1[]): void {
  if (!isRecordV1(value) ||
    value.status !== "available" ||
    value.blockedByAccount !== false ||
    value.accountFailureCanGateLocalMode !== false
  ) {
    issues.push(issueV1(path, "invariant", "Local Mode must remain available and account-independent"));
  }
  if (isRecordV1(value)) {
    validateKeysV1(
      value,
      ["status", "blockedByAccount", "accountFailureCanGateLocalMode"],
      path,
      issues,
    );
  }
}

function validateSecretAssertionsV1(value: unknown, path: string, issues: SchemaIssueV1[]): void {
  if (!isRecordV1(value)) {
    issues.push(issueV1(path, "type", "expected secret-negative assertion object"));
    return;
  }
  validateKeysV1(
    value,
    [
      "forbiddenFieldCorpus",
      "forbiddenValueCorpus",
      "noRealEmail",
      "noCredential",
      "noProductionUrl",
      "noRawPathOrDiff",
    ],
    path,
    issues,
  );
  for (const key of [
    "forbiddenFieldCorpus",
    "forbiddenValueCorpus",
    "noRealEmail",
    "noCredential",
    "noProductionUrl",
    "noRawPathOrDiff",
  ]) {
    if (!isBooleanV1(value[key]) || value[key] !== true) {
      issues.push(issueV1(`${path}.${key}`, "invariant", "secret-negative assertion must be true"));
    }
  }
}

function validateReplayV1(value: unknown, path: string, issues: SchemaIssueV1[]): void {
  if (!isRecordV1(value)) {
    issues.push(issueV1(path, "type", "expected reset/replay object"));
    return;
  }
  validateKeysV1(value, ["reset", "replay", "existingSemanticRevision"], path, issues);
  if (value.reset !== "restoreInitialState") {
    issues.push(issueV1(`${path}.reset`, "invariant", "scenario reset must restore its frozen initial state"));
  }
  if (value.replay !== "deterministic" && value.replay !== "idempotentTerminal" && value.replay !== "failClosed") {
    issues.push(issueV1(`${path}.replay`, "enum", "unknown replay behavior"));
  }
  if (value.existingSemanticRevision !== 1) {
    issues.push(issueV1(`${path}.existingSemanticRevision`, "invariant", "existing v1 scenario meaning is immutable"));
  }
}

function validateAliasesV1(
  value: unknown,
  scenarioIds: ReadonlySet<string>,
  issues: SchemaIssueV1[],
): void {
  if (!Array.isArray(value)) {
    issues.push(issueV1("$.aliases", "type", "expected alias array"));
    return;
  }
  const aliases: string[] = [];
  value.forEach((entry, index) => {
    const path = `$.aliases[${index}]`;
    if (!isRecordV1(entry) || typeof entry.alias !== "string" || !Array.isArray(entry.canonical)) {
      issues.push(issueV1(path, "type", "expected alias and canonical scenario list"));
      return;
    }
    validateKeysV1(entry, ["alias", "canonical"], path, issues);
    aliases.push(entry.alias);
    if (scenarioIds.has(entry.alias)) {
      issues.push(issueV1(`${path}.alias`, "duplicate", "research alias cannot also be a canonical scenario id"));
    }
    if (entry.canonical.length === 0) {
      issues.push(issueV1(`${path}.canonical`, "required", "alias must resolve to at least one canonical scenario"));
    }
    entry.canonical.forEach((canonical, canonicalIndex) => {
      if (typeof canonical !== "string" || !scenarioIds.has(canonical)) {
        issues.push(issueV1(`${path}.canonical[${canonicalIndex}]`, "invariant", "alias target must exist in canonical manifest"));
      }
    });
  });
  collectDuplicateStringsV1(aliases).forEach((duplicate) => {
    issues.push(issueV1("$.aliases", "duplicate", `duplicate research alias ${duplicate}`));
  });
}

function validateEnumV1<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
  issues: SchemaIssueV1[],
): void {
  if (!isEnumValueV1(value, allowed)) {
    issues.push(issueV1(path, "enum", "unknown closed v1 value"));
  }
}

function validateClosedStringArrayV1<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
  issues: SchemaIssueV1[],
  requireNonEmpty: boolean,
): void {
  if (!Array.isArray(value)) {
    issues.push(issueV1(path, "type", "expected array"));
    return;
  }
  if (requireNonEmpty && value.length === 0) {
    issues.push(issueV1(path, "required", "array must not be empty"));
  }
  const strings: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || !isEnumValueV1(entry, allowed)) {
      issues.push(issueV1(`${path}[${index}]`, "enum", "unknown closed v1 array member"));
      return;
    }
    strings.push(entry);
  });
  collectDuplicateStringsV1(strings).forEach((duplicate) => {
    issues.push(issueV1(path, "duplicate", `duplicate value ${duplicate}`));
  });
}

function validateOrderedClosedStringArrayV1<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
  issues: SchemaIssueV1[],
  requireNonEmpty: boolean,
): void {
  if (!Array.isArray(value)) {
    issues.push(issueV1(path, "type", "expected ordered array"));
    return;
  }
  if (requireNonEmpty && value.length === 0) {
    issues.push(issueV1(path, "required", "ordered array must not be empty"));
  }
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || !isEnumValueV1(entry, allowed)) {
      issues.push(issueV1(`${path}[${index}]`, "enum", "unknown closed v1 ordered member"));
    }
  });
}

function validateStringArrayV1(
  value: unknown,
  path: string,
  issues: SchemaIssueV1[],
  requireNonEmpty: boolean,
): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    issues.push(issueV1(path, "type", "expected string array"));
    return;
  }
  if (requireNonEmpty && value.length === 0) {
    issues.push(issueV1(path, "required", "array must not be empty"));
  }
}
