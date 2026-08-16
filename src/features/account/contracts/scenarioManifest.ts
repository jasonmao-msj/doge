import type {
  AccountScenarioV1,
  ScenarioAliasV1,
  ScenarioAuthorityDeltaV1,
  ScenarioBrokerReceiptClassV1,
  ScenarioExpectedResultV1,
  ScenarioInitialAuthorityStateClassV1,
  ScenarioInitialBrokerStateClassV1,
  ScenarioInitialProductStateV1,
  ScenarioManifestV1,
  ScenarioScheduleV1,
} from "./scenario";
import {
  ACCOUNT_SCENARIO_MANIFEST_CONTRACT_V1,
  SCENARIO_LOCAL_MODE_INVARIANT_V1,
  SCENARIO_SECRET_NEGATIVE_ASSERTIONS_V1,
} from "./scenario";
import {
  ACCOUNT_SEMANTIC_CONTRACT_V1,
  type AccountCapabilityKeyV1,
  type AccountTerminalTruthV1,
} from "./semantic";
import type {
  AccountGatewayEventV1,
  GatewayOperationNameV1,
} from "./gateway";
import type { AccountContractLaneV1 } from "./laneProjection";
import { buildAccountScenarioStepsV1 } from "./scenarioPayloadFixtures";
import { ACCOUNT_CANONICAL_SCENARIO_IDS_V1 } from "./scenarioIds";

const NO_SCHEDULE_V1: ScenarioScheduleV1 = {
  latencyMs: [],
  faults: [],
  cancellationsAtAction: [],
};

type ScenarioOptionsV1 = {
  readonly capabilities?: readonly AccountCapabilityKeyV1[];
  readonly lanes?: readonly AccountContractLaneV1[];
  readonly terminal?: AccountTerminalTruthV1;
  readonly result?: ScenarioExpectedResultV1;
  readonly brokerReceipt?: ScenarioBrokerReceiptClassV1;
  readonly authorityDelta?: ScenarioAuthorityDeltaV1;
  readonly productState?: ScenarioInitialProductStateV1;
  readonly brokerState?: ScenarioInitialBrokerStateClassV1;
  readonly authorityState?: ScenarioInitialAuthorityStateClassV1;
  readonly events?: readonly AccountGatewayEventV1["kind"][];
  readonly schedule?: ScenarioScheduleV1;
  readonly replay?: "deterministic" | "idempotentTerminal" | "failClosed";
  readonly releaseCut?: "A0" | "deferred";
};

function scenarioV1(
  id: string,
  operations: readonly GatewayOperationNameV1[],
  options: ScenarioOptionsV1 = {},
): AccountScenarioV1 {
  const terminal = options.terminal ?? "succeeded";
  const result = options.result ?? resultForTerminalV1(terminal);
  const brokerReceipt = options.brokerReceipt ?? receiptForTerminalV1(terminal);
  return {
    id,
    semanticRevision: 1,
    releaseCut: options.releaseCut ?? "A0",
    requiredLanes: options.lanes ?? ["frontend", "broker", "authority", "integration"],
    requiredCapabilities: options.capabilities ?? [],
    initialProductState: options.productState ?? "signedOut",
    initialBrokerStateClass: options.brokerState ?? "idle",
    initialAuthorityStateClass: options.authorityState ?? "anonymous",
    orderedActions: operations.map((operation, index) => `${index + 1}:${operation}`),
    steps: buildAccountScenarioStepsV1(
      id,
      operations,
      terminal,
      options.events ?? [],
      options.schedule ?? NO_SCHEDULE_V1,
    ),
    schedule: options.schedule ?? NO_SCHEDULE_V1,
    expectedGateway: {
      operations,
      results: [result],
      events: options.events ?? [],
    },
    expectedBrokerReceipt: brokerReceipt,
    expectedAuthorityStateDelta: options.authorityDelta ?? "none",
    terminalTruth: terminal,
    localModeInvariant: SCENARIO_LOCAL_MODE_INVARIANT_V1,
    secretNegativeAssertions: SCENARIO_SECRET_NEGATIVE_ASSERTIONS_V1,
    resetAndReplay: {
      reset: "restoreInitialState",
      replay: options.replay ?? (terminal === "succeeded" ? "idempotentTerminal" : "failClosed"),
      existingSemanticRevision: 1,
    },
  };
}

function resultForTerminalV1(terminal: AccountTerminalTruthV1): ScenarioExpectedResultV1 {
  switch (terminal) {
    case "nonterminal":
      return "nonterminal";
    case "succeeded":
    case "cancelledBeforeSend":
      return "success";
    case "rejected":
      return "safeFailure";
    case "outcomeUnknown":
      return "outcomeUnknown";
    case "locallyCompleteRemoteUnconfirmed":
      return "locallyCompleteRemoteUnconfirmed";
  }
}

function receiptForTerminalV1(terminal: AccountTerminalTruthV1): ScenarioBrokerReceiptClassV1 {
  switch (terminal) {
    case "nonterminal":
      return "nonterminal";
    case "succeeded":
      return "succeeded";
    case "rejected":
      return "rejected";
    case "cancelledBeforeSend":
      return "cancelledBeforeSend";
    case "outcomeUnknown":
      return "outcomeUnknown";
    case "locallyCompleteRemoteUnconfirmed":
      return "succeeded";
  }
}

const aliasesV1: readonly ScenarioAliasV1[] = [
  { alias: "auth.register.direct-happy", canonical: ["register.direct-success"] },
  { alias: "auth.register.verify-happy", canonical: ["register.email-verification"] },
  { alias: "auth.register.session-expired", canonical: ["register.verification-session-expired"] },
  { alias: "auth.register.disabled", canonical: ["register.disabled"] },
  { alias: "auth.login.happy", canonical: ["login.happy"] },
  { alias: "auth.login.wrong-then-success", canonical: ["login.credentials-rejected-then-success"] },
  { alias: "auth.login.latency-timeout-reconcile", canonical: ["race.login-timeout-reconcile"] },
  { alias: "auth.mfa.retry-happy", canonical: ["login.mfa-invalid-then-success"] },
  { alias: "auth.mfa.challenge-expired", canonical: ["login.mfa-expiry-then-retry"] },
  { alias: "auth.password.link-happy", canonical: ["password-reset.request-and-return"] },
  { alias: "auth.password.link-expired", canonical: ["password-reset.expired-link"] },
  { alias: "auth.oauth.happy", canonical: ["oauth.happy-return"] },
  {
    alias: "auth.oauth.cancel-expire-offline",
    canonical: ["oauth.user-denied", "oauth.ticket-expired", "oauth.exchange-offline"],
  },
  {
    alias: "auth.oauth.create-link-mfa",
    canonical: ["oauth.completion-bind-confirmation", "oauth.completion-mfa"],
  },
  { alias: "auth.post-success.quota-error", canonical: ["handoff.quota-unavailable"] },
  {
    alias: "config.adaptive.four-contexts",
    canonical: [
      "configuration.no-config-success",
      "configuration.healthy-manual-preserve",
      "configuration.already-configured-noop",
      "configuration.conflict-review",
    ],
  },
  {
    alias: "config.result.matrix",
    canonical: [
      "configuration.partial-rollback",
      "configuration.rollback-incomplete",
      "configuration.close-while-applying",
      "configuration.ack-reopen-dismiss",
    ],
  },
];

const scenariosV1: readonly AccountScenarioV1[] = [
  scenarioV1("bootstrap.signed-out-happy", ["gateway.bootstrap"]),
  scenarioV1("bootstrap.capabilities-loading-slow", ["gateway.bootstrap"], {
    terminal: "nonterminal",
    schedule: { latencyMs: [1_500], faults: [], cancellationsAtAction: [] },
  }),
  scenarioV1("bootstrap.offline", ["gateway.bootstrap"], {
    terminal: "rejected",
    productState: "localOnly",
    authorityState: "serviceUnavailable",
    schedule: { latencyMs: [], faults: ["offline"], cancellationsAtAction: [] },
  }),
  scenarioV1("bootstrap.service-unavailable-last-known", ["gateway.bootstrap"], {
    terminal: "rejected",
    productState: "accountUnavailable",
    authorityState: "serviceUnavailable",
  }),
  scenarioV1("vault.locked", ["gateway.bootstrap"], {
    terminal: "rejected",
    productState: "localOnly",
    lanes: ["frontend", "broker", "integration"],
  }),
  scenarioV1("vault.unavailable-no-session-only", ["auth.login"], {
    capabilities: ["auth.emailPasswordLogin"],
    terminal: "rejected",
    lanes: ["frontend", "broker", "integration"],
    schedule: { latencyMs: [], faults: ["vaultUnavailable"], cancellationsAtAction: [] },
  }),
  scenarioV1("challenge.required-success", ["humanVerification.readRequirement", "humanVerification.submitProof"], {
    capabilities: ["auth.humanVerification"],
    terminal: "nonterminal",
    authorityDelta: "challengeIssued",
  }),
  scenarioV1("challenge.expired-then-retry", ["humanVerification.submitProof", "humanVerification.submitProof"], {
    capabilities: ["auth.humanVerification"],
  }),
  scenarioV1("challenge.unavailable", ["humanVerification.readRequirement"], {
    capabilities: ["auth.humanVerification"],
    terminal: "rejected",
  }),
  scenarioV1("register.direct-success", ["auth.beginRegistration"], {
    capabilities: ["auth.registration"],
    authorityDelta: "accountCreated",
  }),
  scenarioV1("register.email-verification", ["auth.beginRegistration", "auth.submitRegistrationCode"], {
    capabilities: ["auth.registration", "auth.registrationEmailVerification"],
    authorityDelta: "accountCreated",
  }),
  scenarioV1("register.verification-session-expired", ["auth.beginRegistration", "auth.submitRegistrationCode"], {
    capabilities: ["auth.registration", "auth.registrationEmailVerification"],
    terminal: "rejected",
  }),
  scenarioV1("register.resend-cooldown", ["auth.beginRegistration", "auth.resendRegistrationCode"], {
    capabilities: ["auth.registrationEmailVerification"],
    terminal: "nonterminal",
  }),
  scenarioV1("register.policy-fields", ["auth.beginRegistration"], {
    capabilities: ["auth.registration"],
    terminal: "rejected",
  }),
  scenarioV1("register.disabled", ["gateway.bootstrap"], {
    capabilities: ["auth.registration"],
    terminal: "rejected",
    authorityState: "capabilityDisabled",
  }),
  scenarioV1("register.access-only-session-rejected", ["auth.beginRegistration"], {
    capabilities: ["auth.registration"],
    terminal: "rejected",
    authorityDelta: "accountCreated",
  }),
  scenarioV1("login.happy", ["auth.login"], {
    capabilities: ["auth.emailPasswordLogin"],
    authorityDelta: "sessionCreated",
  }),
  scenarioV1("login.credentials-rejected", ["auth.login"], {
    capabilities: ["auth.emailPasswordLogin"],
    terminal: "rejected",
  }),
  scenarioV1("login.credentials-rejected-then-success", ["auth.login", "auth.login"], {
    capabilities: ["auth.emailPasswordLogin"],
    authorityDelta: "sessionCreated",
  }),
  scenarioV1("login.rate-limited", ["auth.login"], {
    capabilities: ["auth.emailPasswordLogin"],
    terminal: "rejected",
  }),
  scenarioV1("login.account-policy-blocked", ["auth.login"], {
    capabilities: ["auth.emailPasswordLogin"],
    terminal: "rejected",
  }),
  scenarioV1("login.mfa-happy", ["auth.login", "auth.verifyMfa"], {
    capabilities: ["auth.emailPasswordLogin", "auth.mfa"],
    authorityDelta: "sessionCreated",
  }),
  scenarioV1("login.mfa-invalid-then-success", ["auth.login", "auth.verifyMfa", "auth.verifyMfa"], {
    capabilities: ["auth.emailPasswordLogin", "auth.mfa"],
    authorityDelta: "sessionCreated",
  }),
  scenarioV1("login.mfa-expiry-then-retry", ["auth.login", "auth.verifyMfa", "auth.login", "auth.verifyMfa"], {
    capabilities: ["auth.emailPasswordLogin", "auth.mfa"],
    authorityDelta: "sessionCreated",
  }),
  scenarioV1("oauth.happy-return", ["auth.startOAuth", "auth.readOAuthAttempt"], {
    capabilities: ["auth.oauth.github"],
    events: ["oauthAttemptChanged"],
    authorityDelta: "sessionCreated",
  }),
  scenarioV1("oauth.user-denied", ["auth.startOAuth", "auth.readOAuthAttempt"], {
    capabilities: ["auth.oauth.github"],
    terminal: "rejected",
    events: ["oauthAttemptChanged"],
  }),
  scenarioV1("oauth.state-mismatch", ["auth.startOAuth", "auth.readOAuthAttempt"], {
    capabilities: ["auth.oauth.github"],
    terminal: "rejected",
  }),
  scenarioV1("oauth.provider-disabled", ["gateway.bootstrap"], {
    capabilities: ["auth.oauth.github"],
    terminal: "rejected",
    authorityState: "capabilityDisabled",
  }),
  scenarioV1("oauth.completion-bind-confirmation", ["auth.startOAuth", "auth.readOAuthAttempt", "auth.completeOAuthAccount"], {
    capabilities: ["auth.oauth.github"],
    authorityDelta: "sessionCreated",
  }),
  scenarioV1("oauth.completion-mfa", ["auth.startOAuth", "auth.readOAuthAttempt", "auth.completeOAuthAccount", "auth.verifyMfa"], {
    capabilities: ["auth.oauth.github", "auth.mfa"],
    authorityDelta: "sessionCreated",
  }),
  scenarioV1("oauth.cancel-late-callback", ["auth.startOAuth", "auth.cancelOAuth", "auth.readOAuthAttempt"], {
    capabilities: ["auth.oauth.github"],
    terminal: "cancelledBeforeSend",
  }),
  scenarioV1("oauth.ticket-expired", ["auth.startOAuth", "auth.readOAuthAttempt"], {
    capabilities: ["auth.oauth.github"],
    terminal: "rejected",
  }),
  scenarioV1("oauth.ticket-replayed", ["auth.startOAuth", "auth.readOAuthAttempt", "auth.readOAuthAttempt"], {
    capabilities: ["auth.oauth.github"],
    terminal: "rejected",
  }),
  scenarioV1("oauth.exchange-offline", ["auth.startOAuth", "auth.readOAuthAttempt"], {
    capabilities: ["auth.oauth.github"],
    terminal: "rejected",
    schedule: { latencyMs: [], faults: ["offline"], cancellationsAtAction: [] },
  }),
  scenarioV1("oauth.restart-invalidates-attempt", ["auth.startOAuth", "auth.readOAuthAttempt"], {
    capabilities: ["auth.oauth.github"],
    terminal: "rejected",
    brokerState: "pendingFlow",
  }),
  scenarioV1("password-reset.request-and-return", ["auth.requestPasswordReset", "auth.inspectExternalIntent", "auth.resetPassword"], {
    capabilities: ["auth.passwordReset"],
    events: ["externalIntentReady"],
  }),
  scenarioV1("password-reset.expired-link", ["auth.requestPasswordReset", "auth.inspectExternalIntent"], {
    capabilities: ["auth.passwordReset"],
    terminal: "rejected",
  }),
  scenarioV1("password-reset.consumed-replay", ["auth.inspectExternalIntent", "auth.resetPassword", "auth.resetPassword"], {
    capabilities: ["auth.passwordReset"],
    terminal: "rejected",
  }),
  scenarioV1("password-reset.disabled", ["gateway.bootstrap"], {
    capabilities: ["auth.passwordReset"],
    terminal: "rejected",
    authorityState: "capabilityDisabled",
  }),
  scenarioV1("session.cold-restore", ["gateway.bootstrap"], {
    productState: "authenticatedPersistent",
    brokerState: "committedSession",
    authorityState: "activeSession",
    authorityDelta: "sessionRefreshed",
  }),
  scenarioV1("session.refresh-lost-response", ["gateway.bootstrap", "gateway.reconcileIntent"], {
    productState: "authenticatedPersistent",
    brokerState: "committedSession",
    authorityState: "activeSession",
    terminal: "outcomeUnknown",
    schedule: { latencyMs: [], faults: ["lostResponse"], cancellationsAtAction: [] },
  }),
  scenarioV1("session.refresh-concurrent-singleflight", ["gateway.bootstrap"], {
    productState: "authenticatedPersistent",
    brokerState: "committedSession",
    authorityState: "activeSession",
    authorityDelta: "sessionRefreshed",
  }),
  scenarioV1("session.logout-remote-unconfirmed", ["auth.logout"], {
    productState: "authenticatedPersistent",
    brokerState: "committedSession",
    authorityState: "activeSession",
    terminal: "locallyCompleteRemoteUnconfirmed",
  }),
  scenarioV1("session.revoke-all-confirmed", ["profile.revokeAllSessions"], {
    capabilities: ["account.revokeAllSessions"],
    productState: "authenticatedPersistent",
    authorityState: "activeSession",
    authorityDelta: "sessionRevoked",
  }),
  scenarioV1("session.revoke-all-unconfirmed", ["profile.revokeAllSessions", "gateway.reconcileIntent"], {
    capabilities: ["account.revokeAllSessions"],
    productState: "authenticatedPersistent",
    authorityState: "activeSession",
    terminal: "outcomeUnknown",
  }),
  scenarioV1("account.profile-update-happy", ["profile.read", "profile.updateProfile"], {
    capabilities: ["account.profile"],
    productState: "authenticatedPersistent",
    authorityState: "activeSession",
    authorityDelta: "profileUpdated",
  }),
  scenarioV1("account.profile-update-rejected", ["profile.updateProfile"], {
    capabilities: ["account.profile"],
    productState: "authenticatedPersistent",
    terminal: "rejected",
  }),
  scenarioV1("account.change-password-happy", ["profile.changePassword"], {
    capabilities: ["account.passwordChange"],
    productState: "authenticatedPersistent",
    authorityDelta: "securityUpdated",
  }),
  scenarioV1("account.totp-enroll-password", ["profile.beginTotpEnrollment", "profile.confirmTotpEnrollment"], {
    capabilities: ["account.totp"],
    productState: "authenticatedPersistent",
    authorityDelta: "securityUpdated",
  }),
  scenarioV1("account.totp-enroll-email", ["profile.requestTotpEmailCode", "profile.beginTotpEnrollment", "profile.confirmTotpEnrollment"], {
    capabilities: ["account.totp"],
    productState: "authenticatedPersistent",
    authorityDelta: "securityUpdated",
  }),
  scenarioV1("account.totp-enrollment-expired", ["profile.beginTotpEnrollment", "profile.confirmTotpEnrollment"], {
    capabilities: ["account.totp"],
    productState: "authenticatedPersistent",
    terminal: "rejected",
  }),
  scenarioV1("account.totp-disable-rejected", ["profile.disableTotp"], {
    capabilities: ["account.totp"],
    productState: "authenticatedPersistent",
    terminal: "rejected",
  }),
  scenarioV1("account.identity-bind-happy", ["profile.startIdentityBinding"], {
    capabilities: ["account.identityBindings"],
    productState: "authenticatedPersistent",
    authorityDelta: "securityUpdated",
  }),
  scenarioV1("account.identity-bind-choice", ["profile.startIdentityBinding", "auth.completeOAuthAccount"], {
    capabilities: ["account.identityBindings"],
    productState: "authenticatedPersistent",
    authorityDelta: "securityUpdated",
  }),
  scenarioV1("account.identity-unbind-last-method-blocked", ["profile.unbindIdentity"], {
    capabilities: ["account.identityBindings"],
    productState: "authenticatedPersistent",
    terminal: "rejected",
  }),
  scenarioV1("usage.fresh-normal", ["usage.read"], {
    capabilities: ["usage.quotaPull"],
    productState: "authenticatedPersistent",
    authorityDelta: "usageObserved",
  }),
  scenarioV1("usage.soft-stale-refresh-fails", ["usage.read"], {
    capabilities: ["usage.quotaPull"],
    productState: "authenticatedPersistent",
    authorityState: "serviceUnavailable",
    terminal: "rejected",
  }),
  scenarioV1("usage.exhausted", ["usage.read"], {
    capabilities: ["usage.quotaPull"],
    productState: "authenticatedPersistent",
    authorityDelta: "usageObserved",
  }),
  scenarioV1("handoff.quota-unavailable", ["usage.read", "configuration.readOffer"], {
    capabilities: ["usage.quotaPull", "configuration.plan"],
    productState: "configurationEligible",
    terminal: "rejected",
  }),
  scenarioV1("managed-key.provision-success", ["managedKey.provision"], {
    capabilities: ["managedKey.provision", "recipe.codex.v1"],
    productState: "configurationEligible",
    authorityDelta: "managedKeyChanged",
  }),
  scenarioV1("managed-key.response-lost-replay", ["managedKey.provision", "gateway.reconcileIntent"], {
    capabilities: ["managedKey.provision", "recipe.codex.v1"],
    productState: "configurationEligible",
    terminal: "outcomeUnknown",
    schedule: { latencyMs: [], faults: ["lostResponse"], cancellationsAtAction: [] },
  }),
  scenarioV1("managed-key.vault-failure", ["managedKey.provision"], {
    capabilities: ["managedKey.provision"],
    terminal: "rejected",
    schedule: { latencyMs: [], faults: ["vaultUnavailable"], cancellationsAtAction: [] },
  }),
  scenarioV1("managed-key.orphan-revoked", ["managedKey.provision", "managedKey.revoke"], {
    capabilities: ["managedKey.provision", "managedKey.revoke"],
    productState: "configurationEligible",
    authorityDelta: "managedKeyChanged",
    schedule: { latencyMs: [], faults: ["metadataFailure"], cancellationsAtAction: [] },
  }),
  scenarioV1("managed-key.rotate", ["managedKey.rotate"], {
    capabilities: ["managedKey.rotate"],
    productState: "configurationEligible",
    authorityDelta: "managedKeyChanged",
  }),
  scenarioV1("managed-key.revoke", ["managedKey.revoke"], {
    capabilities: ["managedKey.revoke"],
    productState: "configurationEligible",
    authorityDelta: "managedKeyChanged",
  }),
  scenarioV1("configuration.no-config-success", ["managedKey.readStatus", "managedKey.listCandidates", "configuration.readOffer", "managedKey.selectExisting", "configuration.createPlan", "configuration.apply", "configuration.readCurrentTask"], {
    capabilities: ["managedKey.listCandidates", "managedKey.selectExisting", "configuration.plan", "configuration.apply", "recipe.codex.v1"],
    productState: "configurationEligible",
    brokerState: "configurationReady",
    events: ["configurationTaskChanged"],
    lanes: ["frontend", "broker", "integration"],
  }),
  scenarioV1("configuration.healthy-manual-preserve", ["configuration.readOffer", "configuration.readCurrentTask", "configuration.hardDismiss"], {
    capabilities: ["configuration.plan", "recipe.codex.v1"],
    productState: "configurationEligible",
    lanes: ["frontend", "broker", "integration"],
  }),
  scenarioV1("configuration.already-configured-noop", ["configuration.readOffer", "configuration.createPlan"], {
    capabilities: ["configuration.plan", "recipe.codex.v1"],
    productState: "configurationEligible",
    lanes: ["frontend", "broker", "integration"],
  }),
  scenarioV1("configuration.conflict-review", ["configuration.readOffer", "configuration.createPlan", "configuration.readFileDetail"], {
    capabilities: ["configuration.plan", "recipe.codex.v1"],
    productState: "configurationEligible",
    lanes: ["frontend", "broker", "integration"],
  }),
  scenarioV1("configuration.lazy-detail-race", ["configuration.readFileDetail", "configuration.readFileDetail"], {
    capabilities: ["configuration.plan"],
    productState: "configurationEligible",
    lanes: ["frontend", "broker", "integration"],
  }),
  scenarioV1("configuration.plan-expired", ["configuration.createPlan", "configuration.apply"], {
    capabilities: ["configuration.plan", "configuration.apply"],
    productState: "configurationEligible",
    terminal: "rejected",
    lanes: ["frontend", "broker", "integration"],
  }),
  scenarioV1("configuration.concurrent-edit", ["configuration.createPlan", "configuration.apply"], {
    capabilities: ["configuration.plan", "configuration.apply"],
    productState: "configurationEligible",
    terminal: "rejected",
    schedule: { latencyMs: [], faults: ["concurrentEdit"], cancellationsAtAction: [] },
    lanes: ["frontend", "broker", "integration"],
  }),
  scenarioV1("configuration.partial-rollback", ["configuration.apply", "configuration.readCurrentTask"], {
    capabilities: ["configuration.apply"],
    productState: "configurationEligible",
    terminal: "rejected",
    lanes: ["frontend", "broker", "integration"],
  }),
  scenarioV1("configuration.rollback-incomplete", ["configuration.apply", "configuration.readCurrentTask"], {
    capabilities: ["configuration.apply"],
    productState: "configurationEligible",
    terminal: "rejected",
    schedule: { latencyMs: [], faults: ["rollbackFailure"], cancellationsAtAction: [] },
    lanes: ["frontend", "broker", "integration"],
  }),
  scenarioV1("configuration.reload-failure", ["configuration.apply", "configuration.readCurrentTask"], {
    capabilities: ["configuration.apply"],
    productState: "configurationEligible",
    lanes: ["frontend", "broker", "integration"],
  }),
  scenarioV1("configuration.close-while-applying", ["configuration.apply", "configuration.readCurrentTask"], {
    capabilities: ["configuration.apply"],
    productState: "configurationEligible",
    lanes: ["frontend", "broker", "integration"],
  }),
  scenarioV1("configuration.ack-reopen-dismiss", ["configuration.acknowledgeResult", "configuration.readCurrentTask", "configuration.hardDismiss"], {
    capabilities: ["configuration.apply"],
    productState: "configurationEligible",
    lanes: ["frontend", "broker", "integration"],
  }),
  scenarioV1("configuration.apply-outcome-unknown-reconcile", ["configuration.apply", "gateway.reconcileIntent", "configuration.readCurrentTask"], {
    capabilities: ["configuration.apply"],
    productState: "configurationEligible",
    terminal: "outcomeUnknown",
    schedule: { latencyMs: [], faults: ["lostResponse"], cancellationsAtAction: [] },
    lanes: ["frontend", "broker", "integration"],
  }),
  scenarioV1("race.older-login-response-after-newer", ["auth.login", "auth.login"], {
    capabilities: ["auth.emailPasswordLogin"],
    authorityDelta: "sessionCreated",
    schedule: { latencyMs: [1_000, 100], faults: [], cancellationsAtAction: [] },
  }),
  scenarioV1("race.offline-after-request-accepted", ["auth.login", "gateway.reconcileIntent"], {
    capabilities: ["auth.emailPasswordLogin"],
    terminal: "outcomeUnknown",
    schedule: { latencyMs: [], faults: ["lostResponse"], cancellationsAtAction: [] },
  }),
  scenarioV1("race.login-timeout-reconcile", ["auth.login", "gateway.reconcileIntent"], {
    capabilities: ["auth.emailPasswordLogin"],
    terminal: "outcomeUnknown",
    schedule: { latencyMs: [30_000], faults: ["lostResponse"], cancellationsAtAction: [] },
  }),
  scenarioV1("session.expire-while-usage-loading", ["usage.read", "gateway.bootstrap"], {
    capabilities: ["usage.quotaPull"],
    productState: "authenticatedPersistent",
    authorityState: "activeSession",
    terminal: "rejected",
    events: ["sessionChanged"],
  }),
  scenarioV1("auth.offline-recover", ["auth.login", "auth.login"], {
    capabilities: ["auth.emailPasswordLogin"],
    schedule: { latencyMs: [], faults: ["offline"], cancellationsAtAction: [] },
    authorityDelta: "sessionCreated",
  }),
  scenarioV1("version.transport-major-unsupported", ["gateway.bootstrap"], {
    terminal: "rejected",
    schedule: { latencyMs: [], faults: ["unsupportedMajor"], cancellationsAtAction: [] },
  }),
  scenarioV1("version.authority-guarantee-missing", ["gateway.bootstrap"], {
    terminal: "rejected",
    schedule: { latencyMs: [], faults: ["missingGuarantee"], cancellationsAtAction: [] },
  }),
  scenarioV1("version.unknown-enum-fails-closed", ["auth.login"], {
    capabilities: ["auth.emailPasswordLogin"],
    terminal: "rejected",
    schedule: { latencyMs: [], faults: ["unknownEnum"], cancellationsAtAction: [] },
  }),
  scenarioV1("local-mode.flags-off", ["gateway.bootstrap"], {
    productState: "localOnly",
    terminal: "rejected",
    lanes: ["frontend", "broker", "integration"],
  }),
  scenarioV1("local-mode.authority-outage", ["gateway.bootstrap"], {
    productState: "localOnly",
    authorityState: "serviceUnavailable",
    terminal: "rejected",
  }),
  scenarioV1("local-mode.persistence-quarantined", ["gateway.bootstrap"], {
    productState: "localOnly",
    brokerState: "quarantined",
    terminal: "rejected",
    lanes: ["frontend", "broker", "integration"],
  }),
];

if (scenariosV1.some((scenario, index) => scenario.id !== ACCOUNT_CANONICAL_SCENARIO_IDS_V1[index]) ||
  scenariosV1.length !== ACCOUNT_CANONICAL_SCENARIO_IDS_V1.length
) {
  throw new Error("Canonical Account v1 scenario identities drifted");
}

/** The only canonical v1 scenario manifest. Lane fixtures are projections by id. */
export const ACCOUNT_SCENARIO_MANIFEST_V1: ScenarioManifestV1 = {
  contract: ACCOUNT_SCENARIO_MANIFEST_CONTRACT_V1,
  semanticContract: ACCOUNT_SEMANTIC_CONTRACT_V1,
  aliases: aliasesV1,
  scenarios: scenariosV1,
};
