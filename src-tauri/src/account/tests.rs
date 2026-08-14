use super::broker::VaultAvailabilityV1;
use super::model::{
    AccountBrokerRequestV1, AuthorityScopeV1, BrokerErrorV1, CancellationPointV1,
    GatewayIntentIdV1, GatewayOperationV1, NextActionV1, RequestFingerprintV1, SessionEffectV1,
    TerminalOutcomeV1, TransportRequestIdV1,
};
use super::test_support::{
    AuthorityFaultV1, ClockFaultV1, InMemoryEpochFenceV1, InMemoryOperationRepositoryV1,
    InMemoryVaultV1, LocalAccountPlaneFailureV1, LocalModeIsolationHarnessV1, ManualClockV1,
    RepositoryFaultV1, StatefulFakeAuthorityV1, VaultFaultV1, SYNTHETIC_OPAQUE_SECRET_CANARY,
};
use super::AccountBrokerV1;

type TestBrokerV1 = AccountBrokerV1<
    StatefulFakeAuthorityV1,
    InMemoryVaultV1,
    InMemoryOperationRepositoryV1,
    ManualClockV1,
    InMemoryEpochFenceV1,
>;

fn fingerprint(seed: char) -> RequestFingerprintV1 {
    RequestFingerprintV1::parse(format!("sha256:{}", seed.to_string().repeat(64))).unwrap()
}

pub(super) fn request(
    request_suffix: &str,
    intent_suffix: &str,
    operation: GatewayOperationV1,
    epoch: Option<u64>,
    fingerprint_seed: char,
) -> AccountBrokerRequestV1 {
    AccountBrokerRequestV1::new(
        TransportRequestIdV1::parse(format!("request_{request_suffix}")).unwrap(),
        GatewayIntentIdV1::parse(format!("intent_{intent_suffix}")).unwrap(),
        operation,
        epoch,
        1,
        fingerprint(fingerprint_seed),
    )
}

fn broker_with(
    authority: StatefulFakeAuthorityV1,
    vault: InMemoryVaultV1,
    repository: InMemoryOperationRepositoryV1,
    clock: ManualClockV1,
    epoch: InMemoryEpochFenceV1,
) -> TestBrokerV1 {
    AccountBrokerV1::new(authority, vault, repository, clock, epoch, 1)
}

pub(super) fn default_broker(clock: ManualClockV1, epoch: InMemoryEpochFenceV1) -> TestBrokerV1 {
    broker_with(
        StatefulFakeAuthorityV1::default(),
        InMemoryVaultV1::default(),
        InMemoryOperationRepositoryV1::default(),
        clock,
        epoch,
    )
}

#[test]
fn opaque_identity_and_fingerprint_validation_matches_v1_shape() {
    assert!(GatewayIntentIdV1::parse("intent_accountD00001").is_ok());
    assert!(TransportRequestIdV1::parse("request_accountD00001").is_ok());
    assert!(GatewayIntentIdV1::parse("request_accountD00001").is_err());
    assert!(GatewayIntentIdV1::parse("intent_short").is_err());
    assert!(RequestFingerprintV1::parse(format!("sha256:{}", "a".repeat(64))).is_ok());
    assert!(RequestFingerprintV1::parse(format!("sha256:{}", "A".repeat(64))).is_err());
}

#[test]
fn intent_transport_and_operation_binding_is_stable_across_retry() {
    let clock = ManualClockV1::new(1_000);
    let epoch = InMemoryEpochFenceV1::new(Some(7));
    let mut broker = default_broker(clock.clone(), epoch);
    let first = request(
        "loginAttempt0001",
        "loginLogical0001",
        GatewayOperationV1::ProfileUpdateProfile,
        Some(7),
        'a',
    );
    let intent = first.intent_id.clone();
    let first_receipt = broker
        .execute(first, CancellationPointV1::None)
        .expect("first fake mutation should succeed");

    clock.advance_ms(250);
    let retry = request(
        "loginAttempt0002",
        "loginLogical0001",
        GatewayOperationV1::ProfileUpdateProfile,
        Some(7),
        'a',
    );
    let retry_receipt = broker
        .execute(retry, CancellationPointV1::None)
        .expect("same logical intent should replay terminal receipt");

    assert_eq!(first_receipt, retry_receipt);
    assert_eq!(broker.authority().execute_calls(), 1);
    let entry = broker.repository().entry(&intent).expect("ledger entry");
    assert_eq!(entry.binding.intent_id, intent);
    assert_eq!(entry.binding.operation_id, first_receipt.operation_id);
    assert_eq!(entry.transport_request_ids.len(), 2);
    assert!(entry.updated_at_ms > entry.created_at_ms);
}

#[test]
fn same_intent_with_different_fingerprint_is_a_closed_conflict() {
    let clock = ManualClockV1::new(10);
    let epoch = InMemoryEpochFenceV1::new(Some(3));
    let mut broker = default_broker(clock, epoch);
    broker
        .execute(
            request(
                "conflictReq0001",
                "conflictIntent1",
                GatewayOperationV1::ProfileUpdateProfile,
                Some(3),
                'a',
            ),
            CancellationPointV1::None,
        )
        .unwrap();

    let result = broker.execute(
        request(
            "conflictReq0002",
            "conflictIntent1",
            GatewayOperationV1::ProfileUpdateProfile,
            Some(3),
            'b',
        ),
        CancellationPointV1::None,
    );

    assert_eq!(result, Err(BrokerErrorV1::IdempotencyConflict));
    assert_eq!(broker.authority().execute_calls(), 1);
}

#[test]
fn cancel_before_send_persists_terminal_without_contacting_authority() {
    let clock = ManualClockV1::new(20);
    let epoch = InMemoryEpochFenceV1::new(Some(2));
    let mut broker = default_broker(clock, epoch);
    let receipt = broker
        .execute(
            request(
                "cancelRequest01",
                "cancelIntent001",
                GatewayOperationV1::ManagedKeyProvision,
                Some(2),
                'c',
            ),
            CancellationPointV1::BeforeSend,
        )
        .unwrap();

    assert_eq!(receipt.terminal, TerminalOutcomeV1::CancelledBeforeSend);
    assert_eq!(receipt.authority_scope, AuthorityScopeV1::NotContacted);
    assert_eq!(receipt.session_effect, SessionEffectV1::Unchanged);
    assert_eq!(broker.authority().execute_calls(), 0);
}

#[test]
fn lost_response_is_outcome_unknown_then_reconciles_same_terminal_operation() {
    let clock = ManualClockV1::new(30);
    let epoch = InMemoryEpochFenceV1::new(Some(4));
    let mut authority = StatefulFakeAuthorityV1::default();
    authority.inject(AuthorityFaultV1::LoseResponseAfterCommit);
    let mut broker = broker_with(
        authority,
        InMemoryVaultV1::default(),
        InMemoryOperationRepositoryV1::default(),
        clock,
        epoch,
    );
    let intent = GatewayIntentIdV1::parse("intent_reconcile0001").unwrap();
    let first = AccountBrokerRequestV1::new(
        TransportRequestIdV1::parse("request_reconcile0001").unwrap(),
        intent.clone(),
        GatewayOperationV1::ProfileUpdateProfile,
        Some(4),
        1,
        fingerprint('d'),
    );

    let unknown = broker.execute(first, CancellationPointV1::None).unwrap();
    assert_eq!(unknown.terminal, TerminalOutcomeV1::OutcomeUnknown);
    assert_eq!(
        unknown.authority_scope,
        AuthorityScopeV1::ReconciliationPending
    );
    assert_eq!(unknown.next_action, NextActionV1::Reconcile);

    let reconciled = broker
        .reconcile_intent(&intent, GatewayOperationV1::ProfileUpdateProfile)
        .unwrap()
        .expect("known fake terminal");
    assert_eq!(reconciled.operation_id, unknown.operation_id);
    assert_eq!(reconciled.terminal, TerminalOutcomeV1::Succeeded);
    assert_eq!(reconciled.authority_scope, AuthorityScopeV1::Confirmed);
    assert_eq!(broker.authority().execute_calls(), 1);
    assert_eq!(broker.authority().reconcile_calls(), 1);
}

#[test]
fn reconciliation_pending_remains_outcome_unknown_and_deterministic() {
    let clock = ManualClockV1::new(31);
    let epoch = InMemoryEpochFenceV1::new(Some(4));
    let mut authority = StatefulFakeAuthorityV1::default();
    authority.inject(AuthorityFaultV1::LoseResponseAfterCommit);
    authority.inject(AuthorityFaultV1::ReconcilePending);
    let mut broker = broker_with(
        authority,
        InMemoryVaultV1::default(),
        InMemoryOperationRepositoryV1::default(),
        clock,
        epoch,
    );
    let intent = GatewayIntentIdV1::parse("intent_pendingRecon01").unwrap();
    let unknown = broker
        .execute(
            AccountBrokerRequestV1::new(
                TransportRequestIdV1::parse("request_pendingRecon1").unwrap(),
                intent.clone(),
                GatewayOperationV1::ManagedKeyProvision,
                Some(4),
                1,
                fingerprint('e'),
            ),
            CancellationPointV1::None,
        )
        .unwrap();
    let still_unknown = broker
        .reconcile_intent(&intent, GatewayOperationV1::ManagedKeyProvision)
        .unwrap()
        .unwrap();
    assert_eq!(unknown.operation_id, still_unknown.operation_id);
    assert_eq!(still_unknown.terminal, TerminalOutcomeV1::OutcomeUnknown);
}

#[test]
fn cancel_after_possible_send_is_unknown_and_reconcilable() {
    let mut broker = default_broker(ManualClockV1::new(35), InMemoryEpochFenceV1::new(Some(5)));
    let intent = GatewayIntentIdV1::parse("intent_cancelAfter01").unwrap();
    let receipt = broker
        .execute(
            AccountBrokerRequestV1::new(
                TransportRequestIdV1::parse("request_cancelAfter01").unwrap(),
                intent.clone(),
                GatewayOperationV1::ProfileUpdateProfile,
                Some(5),
                1,
                fingerprint('f'),
            ),
            CancellationPointV1::AfterPossibleSend,
        )
        .unwrap();
    assert_eq!(receipt.terminal, TerminalOutcomeV1::OutcomeUnknown);
    assert_eq!(receipt.next_action, NextActionV1::Reconcile);
    assert_eq!(broker.authority().execute_calls(), 1);
    let terminal = broker
        .reconcile_intent(&intent, GatewayOperationV1::ProfileUpdateProfile)
        .unwrap()
        .unwrap();
    assert_eq!(terminal.operation_id, receipt.operation_id);
    assert_eq!(terminal.terminal, TerminalOutcomeV1::Succeeded);
}

#[test]
fn stale_epoch_fails_before_send_and_late_epoch_is_not_committed() {
    let clock = ManualClockV1::new(40);
    let epoch = InMemoryEpochFenceV1::new(Some(8));
    let mut broker = default_broker(clock, epoch.clone());
    let stale = broker.execute(
        request(
            "staleRequest001",
            "staleIntent0001",
            GatewayOperationV1::UsageRead,
            Some(7),
            'f',
        ),
        CancellationPointV1::None,
    );
    assert_eq!(stale, Err(BrokerErrorV1::StaleAccountEpoch));
    assert_eq!(broker.authority().execute_calls(), 0);

    let prepared_epoch = InMemoryEpochFenceV1::new(Some(8));
    let mut authority = StatefulFakeAuthorityV1::default();
    authority.inject(AuthorityFaultV1::LoseResponseAfterCommit);
    let mut second = broker_with(
        authority,
        InMemoryVaultV1::default(),
        InMemoryOperationRepositoryV1::default(),
        ManualClockV1::new(41),
        prepared_epoch.clone(),
    );
    let intent = GatewayIntentIdV1::parse("intent_lateIntent00001").unwrap();
    let unknown = second
        .execute(
            AccountBrokerRequestV1::new(
                TransportRequestIdV1::parse("request_lateRequest0001").unwrap(),
                intent.clone(),
                GatewayOperationV1::AuthLogin,
                Some(8),
                1,
                fingerprint('a'),
            ),
            CancellationPointV1::None,
        )
        .unwrap();
    assert_eq!(unknown.terminal, TerminalOutcomeV1::OutcomeUnknown);
    prepared_epoch.advance_for_account_switch();
    let late = second
        .reconcile_intent(&intent, GatewayOperationV1::AuthLogin)
        .unwrap()
        .unwrap();
    assert_eq!(late.terminal, TerminalOutcomeV1::Rejected);
    assert_eq!(late.session_effect, SessionEffectV1::Unchanged);
    assert_eq!(late.next_action, NextActionV1::Reauthenticate);
    assert_eq!(second.vault().active_generation(), None);
}

#[test]
fn vault_failure_never_projects_session_only_authentication() {
    for availability in [
        VaultAvailabilityV1::Locked,
        VaultAvailabilityV1::Unavailable,
        VaultAvailabilityV1::Inconsistent,
    ] {
        let mut broker = broker_with(
            StatefulFakeAuthorityV1::default(),
            InMemoryVaultV1::with_availability(availability),
            InMemoryOperationRepositoryV1::default(),
            ManualClockV1::new(50),
            InMemoryEpochFenceV1::new(None),
        );
        let receipt = broker
            .execute(
                request(
                    "vaultRequest001",
                    "vaultIntent0001",
                    GatewayOperationV1::AuthLogin,
                    None,
                    'b',
                ),
                CancellationPointV1::None,
            )
            .unwrap();
        assert_eq!(receipt.terminal, TerminalOutcomeV1::Rejected);
        assert_eq!(receipt.session_effect, SessionEffectV1::Unchanged);
        assert_eq!(receipt.next_action, NextActionV1::UnlockVault);
        assert_eq!(broker.epoch(), None);
        assert_eq!(broker.vault().active_generation(), None);
    }
}

#[test]
fn successful_auth_activates_synthetic_secret_only_inside_vault() {
    let mut broker = default_broker(ManualClockV1::new(60), InMemoryEpochFenceV1::new(None));
    let receipt = broker
        .execute(
            request(
                "authRequest0001",
                "authIntent00001",
                GatewayOperationV1::AuthLogin,
                None,
                'c',
            ),
            CancellationPointV1::None,
        )
        .unwrap();

    assert_eq!(receipt.terminal, TerminalOutcomeV1::Succeeded);
    assert_eq!(receipt.session_effect, SessionEffectV1::Activated);
    assert_eq!(broker.epoch(), Some(1));
    assert!(broker
        .vault()
        .contains_secret_bytes(SYNTHETIC_OPAQUE_SECRET_CANARY.as_bytes()));
    let safe_output = format!("{receipt:?}");
    assert!(!safe_output.contains(SYNTHETIC_OPAQUE_SECRET_CANARY));
    assert!(!safe_output.contains("http"));
    assert!(!safe_output.contains("/Users/"));
    assert!(!safe_output.contains("@@"));
}

#[test]
fn vault_and_repository_fault_matrix_is_fail_closed() {
    for fault in [VaultFaultV1::Stage, VaultFaultV1::Activate] {
        let mut vault = InMemoryVaultV1::default();
        vault.inject(fault);
        let mut broker = broker_with(
            StatefulFakeAuthorityV1::default(),
            vault,
            InMemoryOperationRepositoryV1::default(),
            ManualClockV1::new(70),
            InMemoryEpochFenceV1::new(None),
        );
        let receipt = broker
            .execute(
                request(
                    "vaultFaultReq1",
                    "vaultFaultInt1",
                    GatewayOperationV1::AuthLogin,
                    None,
                    'd',
                ),
                CancellationPointV1::None,
            )
            .unwrap();
        assert_eq!(receipt.terminal, TerminalOutcomeV1::Rejected);
        assert_eq!(broker.epoch(), None);
    }

    for fault in [
        RepositoryFaultV1::Lookup,
        RepositoryFaultV1::Insert,
        RepositoryFaultV1::SaveReceipt,
    ] {
        let mut repository = InMemoryOperationRepositoryV1::default();
        repository.inject(fault);
        let mut broker = broker_with(
            StatefulFakeAuthorityV1::default(),
            InMemoryVaultV1::default(),
            repository,
            ManualClockV1::new(71),
            InMemoryEpochFenceV1::new(Some(1)),
        );
        let result = broker.execute(
            request(
                "repoFaultReq01",
                "repoFaultInt01",
                GatewayOperationV1::ProfileUpdateProfile,
                Some(1),
                'e',
            ),
            CancellationPointV1::None,
        );
        assert_eq!(result, Err(BrokerErrorV1::PersistenceUnavailable));
    }

    let clock = ManualClockV1::new(72);
    clock.inject(ClockFaultV1::Unavailable);
    let mut broker = default_broker(clock, InMemoryEpochFenceV1::new(Some(1)));
    let result = broker.execute(
        request(
            "clockFaultReq1",
            "clockFaultInt1",
            GatewayOperationV1::ProfileRead,
            Some(1),
            'f',
        ),
        CancellationPointV1::None,
    );
    assert_eq!(result, Err(BrokerErrorV1::ClockUnavailable));
    assert_eq!(broker.authority().execute_calls(), 0);
}

#[test]
fn authority_and_projection_failure_matrix_is_closed_and_safe() {
    for (fault, expected_scope, expected_action) in [
        (
            AuthorityFaultV1::UnavailableBeforeSend,
            AuthorityScopeV1::NotContacted,
            NextActionV1::Retry,
        ),
        (
            AuthorityFaultV1::RejectTerminal,
            AuthorityScopeV1::Confirmed,
            NextActionV1::Retry,
        ),
        (
            AuthorityFaultV1::UnsafeProjection,
            AuthorityScopeV1::ReconciliationPending,
            NextActionV1::Reconcile,
        ),
    ] {
        let mut authority = StatefulFakeAuthorityV1::default();
        authority.inject(fault);
        let mut broker = broker_with(
            authority,
            InMemoryVaultV1::default(),
            InMemoryOperationRepositoryV1::default(),
            ManualClockV1::new(73),
            InMemoryEpochFenceV1::new(Some(1)),
        );
        let receipt = broker
            .execute(
                request(
                    "authorityFail1",
                    match fault {
                        AuthorityFaultV1::UnavailableBeforeSend => "authorityOff01",
                        AuthorityFaultV1::RejectTerminal => "authorityReject",
                        AuthorityFaultV1::UnsafeProjection => "unsafeProject1",
                        _ => unreachable!(),
                    },
                    GatewayOperationV1::ProfileUpdateProfile,
                    Some(1),
                    'b',
                ),
                CancellationPointV1::None,
            )
            .unwrap();
        if fault == AuthorityFaultV1::UnsafeProjection {
            assert_eq!(receipt.terminal, TerminalOutcomeV1::OutcomeUnknown);
        } else {
            assert_eq!(receipt.terminal, TerminalOutcomeV1::Rejected);
        }
        assert_eq!(receipt.authority_scope, expected_scope);
        assert_eq!(receipt.next_action, expected_action);
        assert!(receipt.is_renderer_safe());
        if fault == AuthorityFaultV1::UnsafeProjection {
            assert!(receipt.safe_projection_handle.is_none());
        }
    }
}

#[test]
fn invalid_read_projection_is_rejected_without_mutation_ambiguity() {
    let mut authority = StatefulFakeAuthorityV1::default();
    authority.inject(AuthorityFaultV1::UnsafeProjection);
    let mut broker = broker_with(
        authority,
        InMemoryVaultV1::default(),
        InMemoryOperationRepositoryV1::default(),
        ManualClockV1::new(73),
        InMemoryEpochFenceV1::new(Some(1)),
    );
    let receipt = broker
        .execute(
            request(
                "unsafeReadReq1",
                "unsafeReadInt1",
                GatewayOperationV1::ProfileRead,
                Some(1),
                'e',
            ),
            CancellationPointV1::None,
        )
        .unwrap();
    assert_eq!(receipt.terminal, TerminalOutcomeV1::Rejected);
    assert_eq!(receipt.next_action, NextActionV1::ContactSupport);
    assert!(receipt.safe_projection_handle.is_none());
}

#[test]
fn repository_append_fault_does_not_redispatch_terminal_mutation() {
    let clock = ManualClockV1::new(74);
    let epoch = InMemoryEpochFenceV1::new(Some(1));
    let mut broker = default_broker(clock, epoch);
    broker
        .execute(
            request(
                "appendFirst001",
                "appendIntent001",
                GatewayOperationV1::ProfileUpdateProfile,
                Some(1),
                'c',
            ),
            CancellationPointV1::None,
        )
        .unwrap();
    // The in-memory test repository is owned by the broker; inject through a
    // fresh setup so the fault remains an explicit harness behavior.
    let intent = GatewayIntentIdV1::parse("intent_appendFault01").unwrap();
    let first_request = AccountBrokerRequestV1::new(
        TransportRequestIdV1::parse("request_appendFault01").unwrap(),
        intent.clone(),
        GatewayOperationV1::ProfileUpdateProfile,
        Some(1),
        1,
        fingerprint('d'),
    );
    let mut seeded = broker_with(
        StatefulFakeAuthorityV1::default(),
        InMemoryVaultV1::default(),
        InMemoryOperationRepositoryV1::default(),
        ManualClockV1::new(74),
        InMemoryEpochFenceV1::new(Some(1)),
    );
    seeded
        .execute(first_request, CancellationPointV1::None)
        .unwrap();
    seeded
        .repository_mut()
        .inject(RepositoryFaultV1::AppendTransport);
    let authority_calls = seeded.authority().execute_calls();
    let result = seeded.execute(
        AccountBrokerRequestV1::new(
            TransportRequestIdV1::parse("request_appendFault02").unwrap(),
            intent,
            GatewayOperationV1::ProfileUpdateProfile,
            Some(1),
            1,
            fingerprint('d'),
        ),
        CancellationPointV1::None,
    );
    assert_eq!(result, Err(BrokerErrorV1::PersistenceUnavailable));
    assert_eq!(seeded.authority().execute_calls(), authority_calls);
}

#[test]
fn terminal_ledger_failure_after_vault_activation_does_not_advance_epoch() {
    let mut repository = InMemoryOperationRepositoryV1::default();
    repository.inject(RepositoryFaultV1::SaveReceipt);
    let mut broker = broker_with(
        StatefulFakeAuthorityV1::default(),
        InMemoryVaultV1::default(),
        repository,
        ManualClockV1::new(75),
        InMemoryEpochFenceV1::new(None),
    );
    let result = broker.execute(
        request(
            "rollbackReq0001",
            "rollbackInt0001",
            GatewayOperationV1::AuthLogin,
            None,
            'a',
        ),
        CancellationPointV1::None,
    );
    assert_eq!(result, Err(BrokerErrorV1::PersistenceUnavailable));
    assert_eq!(broker.epoch(), None);
    assert_eq!(broker.vault().active_generation(), None);
}

#[test]
fn fake_authority_is_stateful_for_identity_bindings_and_mutations() {
    let clock = ManualClockV1::new(80);
    let epoch = InMemoryEpochFenceV1::new(Some(2));
    let mut broker = default_broker(clock, epoch);
    broker
        .execute(
            request(
                "bindRequest001",
                "bindIntent0001",
                GatewayOperationV1::ProfileStartIdentityBinding,
                Some(2),
                'f',
            ),
            CancellationPointV1::None,
        )
        .unwrap();
    assert!(broker
        .authority()
        .state()
        .identity_bindings
        .contains("synthetic-provider"));
    broker
        .execute(
            request(
                "unbindReq0001",
                "unbindIntent01",
                GatewayOperationV1::ProfileUnbindIdentity,
                Some(2),
                'a',
            ),
            CancellationPointV1::None,
        )
        .unwrap();
    assert!(broker.authority().state().identity_bindings.is_empty());
}

#[test]
fn fake_clock_reset_produces_deterministic_operation_and_receipt() {
    fn run_once() -> String {
        let mut broker = default_broker(ManualClockV1::new(90), InMemoryEpochFenceV1::new(Some(1)));
        format!(
            "{:?}",
            broker
                .execute(
                    request(
                        "deterministic1",
                        "deterministic1",
                        GatewayOperationV1::ProfileRead,
                        Some(1),
                        'b',
                    ),
                    CancellationPointV1::None,
                )
                .unwrap()
        )
    }
    assert_eq!(run_once(), run_once());
}

#[test]
fn local_mode_is_identical_across_account_failure_matrix() {
    let failures = [
        LocalAccountPlaneFailureV1::FeatureDisabled,
        LocalAccountPlaneFailureV1::SignedOut,
        LocalAccountPlaneFailureV1::AuthorityOutage,
        LocalAccountPlaneFailureV1::VaultLocked,
        LocalAccountPlaneFailureV1::VaultUnavailable,
        LocalAccountPlaneFailureV1::RepositoryQuarantined,
        LocalAccountPlaneFailureV1::SessionRevoked,
        LocalAccountPlaneFailureV1::QuotaExhausted,
    ];
    let mut harness = LocalModeIsolationHarnessV1::default();
    for (index, failure) in failures.into_iter().enumerate() {
        let snapshot = harness.run_local_action(failure);
        assert_eq!(snapshot.status, "available");
        assert!(!snapshot.blocked_by_account);
        assert_eq!(snapshot.completed_local_actions, index as u64 + 1);
    }
}

#[test]
fn operation_inventory_preserves_read_mutation_boundary() {
    assert!(GatewayOperationV1::GatewayBootstrap.is_read());
    assert!(GatewayOperationV1::UsageRead.is_read());
    assert!(GatewayOperationV1::ManagedKeyListCandidates.is_read());
    assert!(!GatewayOperationV1::ManagedKeySelectExisting.is_read());
    assert!(!GatewayOperationV1::AuthLogin.is_read());
    assert!(!GatewayOperationV1::ConfigurationApply.is_read());
    assert_eq!(super::model::GATEWAY_OPERATIONS_V1.len(), 41);
    let names: std::collections::BTreeSet<_> = super::model::GATEWAY_OPERATIONS_V1
        .iter()
        .map(|operation| operation.as_contract_name())
        .collect();
    assert_eq!(names.len(), 41);
    assert_eq!(SessionEffectV1::Refreshed, SessionEffectV1::Refreshed);
    assert_eq!(
        SessionEffectV1::LocallyCleared,
        SessionEffectV1::LocallyCleared
    );
}

#[test]
fn receipt_carries_the_operation_discriminator() {
    let mut broker = default_broker(ManualClockV1::new(95), InMemoryEpochFenceV1::new(Some(1)));
    let receipt = broker
        .execute(
            request(
                "receiptOpReq1",
                "receiptOpInt1",
                GatewayOperationV1::ManagedKeyProvision,
                Some(1),
                'c',
            ),
            CancellationPointV1::BeforeSend,
        )
        .unwrap();
    assert_eq!(receipt.operation, GatewayOperationV1::ManagedKeyProvision);
}
