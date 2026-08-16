use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::rc::Rc;

use super::broker::{
    AccountCredentialVaultV1, AccountEpochFenceV1, AccountOperationRepositoryV1,
    AuthorityDispatchFailureV1, AuthorityReconciliationV1, AuthorityReplyV1, BrokerClockV1,
    PrivateSecretV1, Token2ApiAuthorityV1, VaultAvailabilityV1,
};
use super::model::{
    AccountBrokerRequestV1, BrokerErrorV1, BrokerOperationIdV1, BrokerReceiptV1, GatewayIntentIdV1,
    GatewayOperationV1, OperationLedgerEntryV1, SessionEffectV1, TerminalOutcomeV1,
    TransportRequestIdV1,
};

pub(super) const SYNTHETIC_OPAQUE_SECRET_CANARY: &str = "synthetic-opaque-canary-account-d0-000001";

#[derive(Clone, Debug)]
pub(super) struct ManualClockV1 {
    now_ms: Rc<Cell<u64>>,
    faults: Rc<RefCell<VecDeque<ClockFaultV1>>>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum ClockFaultV1 {
    Unavailable,
}

impl ManualClockV1 {
    pub(super) fn new(now_ms: u64) -> Self {
        Self {
            now_ms: Rc::new(Cell::new(now_ms)),
            faults: Rc::new(RefCell::new(VecDeque::new())),
        }
    }

    pub(super) fn advance_ms(&self, delta_ms: u64) {
        self.now_ms.set(self.now_ms.get().saturating_add(delta_ms));
    }

    pub(super) fn inject(&self, fault: ClockFaultV1) {
        self.faults.borrow_mut().push_back(fault);
    }
}

impl BrokerClockV1 for ManualClockV1 {
    fn now_ms(&mut self) -> Result<u64, BrokerErrorV1> {
        if self.faults.borrow_mut().pop_front() == Some(ClockFaultV1::Unavailable) {
            Err(BrokerErrorV1::ClockUnavailable)
        } else {
            Ok(self.now_ms.get())
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct InMemoryEpochFenceV1 {
    epoch: Rc<Cell<Option<u64>>>,
}

impl InMemoryEpochFenceV1 {
    pub(super) fn new(epoch: Option<u64>) -> Self {
        Self {
            epoch: Rc::new(Cell::new(epoch)),
        }
    }

    pub(super) fn advance_for_account_switch(&self) {
        let next = self.epoch.get().unwrap_or(0).saturating_add(1);
        self.epoch.set(Some(next));
    }
}

impl AccountEpochFenceV1 for InMemoryEpochFenceV1 {
    fn current_epoch(&self) -> Option<u64> {
        self.epoch.get()
    }

    fn activate_next_epoch(&mut self) {
        self.advance_for_account_switch();
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum RepositoryFaultV1 {
    Lookup,
    Insert,
    AppendTransport,
    SaveReceipt,
}

#[derive(Debug, Default)]
pub(super) struct InMemoryOperationRepositoryV1 {
    entries: BTreeMap<GatewayIntentIdV1, OperationLedgerEntryV1>,
    faults: VecDeque<RepositoryFaultV1>,
}

impl InMemoryOperationRepositoryV1 {
    pub(super) fn inject(&mut self, fault: RepositoryFaultV1) {
        self.faults.push_back(fault);
    }

    pub(super) fn entry(&self, intent: &GatewayIntentIdV1) -> Option<&OperationLedgerEntryV1> {
        self.entries.get(intent)
    }

    fn consume_fault(&mut self, expected: RepositoryFaultV1) -> Result<(), BrokerErrorV1> {
        if self.faults.front() == Some(&expected) {
            self.faults.pop_front();
            Err(BrokerErrorV1::PersistenceUnavailable)
        } else {
            Ok(())
        }
    }
}

impl AccountOperationRepositoryV1 for InMemoryOperationRepositoryV1 {
    fn find_by_intent(
        &mut self,
        intent: &GatewayIntentIdV1,
    ) -> Result<Option<OperationLedgerEntryV1>, BrokerErrorV1> {
        self.consume_fault(RepositoryFaultV1::Lookup)?;
        Ok(self.entries.get(intent).cloned())
    }

    fn insert(&mut self, entry: OperationLedgerEntryV1) -> Result<(), BrokerErrorV1> {
        self.consume_fault(RepositoryFaultV1::Insert)?;
        self.entries.insert(entry.binding.intent_id.clone(), entry);
        Ok(())
    }

    fn append_transport_request(
        &mut self,
        intent: &GatewayIntentIdV1,
        request: TransportRequestIdV1,
        updated_at_ms: u64,
    ) -> Result<(), BrokerErrorV1> {
        self.consume_fault(RepositoryFaultV1::AppendTransport)?;
        let Some(entry) = self.entries.get_mut(intent) else {
            return Err(BrokerErrorV1::PersistenceUnavailable);
        };
        if !entry.transport_request_ids.contains(&request) {
            entry.transport_request_ids.push(request);
        }
        entry.updated_at_ms = updated_at_ms;
        Ok(())
    }

    fn save_receipt(
        &mut self,
        intent: &GatewayIntentIdV1,
        receipt: BrokerReceiptV1,
        updated_at_ms: u64,
    ) -> Result<(), BrokerErrorV1> {
        self.consume_fault(RepositoryFaultV1::SaveReceipt)?;
        let Some(entry) = self.entries.get_mut(intent) else {
            return Err(BrokerErrorV1::PersistenceUnavailable);
        };
        entry.receipt = Some(receipt);
        entry.updated_at_ms = updated_at_ms;
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum VaultFaultV1 {
    Stage,
    Activate,
    Delete,
}

pub(super) struct InMemoryVaultV1 {
    availability: VaultAvailabilityV1,
    staged: BTreeMap<u64, Vec<u8>>,
    active_generation: Option<u64>,
    next_generation: u64,
    faults: VecDeque<VaultFaultV1>,
}

impl Default for InMemoryVaultV1 {
    fn default() -> Self {
        Self {
            availability: VaultAvailabilityV1::Ready,
            staged: BTreeMap::new(),
            active_generation: None,
            next_generation: 1,
            faults: VecDeque::new(),
        }
    }
}

impl InMemoryVaultV1 {
    pub(super) fn with_availability(availability: VaultAvailabilityV1) -> Self {
        Self {
            availability,
            ..Self::default()
        }
    }

    pub(super) fn inject(&mut self, fault: VaultFaultV1) {
        self.faults.push_back(fault);
    }

    pub(super) fn active_generation(&self) -> Option<u64> {
        self.active_generation
    }

    pub(super) fn contains_secret_bytes(&self, expected: &[u8]) -> bool {
        self.staged.values().any(|value| value == expected)
    }

    fn consume_fault(&mut self, expected: VaultFaultV1) -> Result<(), ()> {
        if self.faults.front() == Some(&expected) {
            self.faults.pop_front();
            Err(())
        } else {
            Ok(())
        }
    }
}

impl AccountCredentialVaultV1 for InMemoryVaultV1 {
    fn availability(&mut self) -> VaultAvailabilityV1 {
        self.availability
    }

    fn stage(&mut self, secret: PrivateSecretV1) -> Result<u64, ()> {
        self.consume_fault(VaultFaultV1::Stage)?;
        let generation = self.next_generation;
        self.next_generation = self.next_generation.saturating_add(1);
        self.staged.insert(generation, secret.bytes().to_vec());
        Ok(generation)
    }

    fn activate(&mut self, generation: u64) -> Result<(), ()> {
        self.consume_fault(VaultFaultV1::Activate)?;
        if self.staged.contains_key(&generation) {
            self.active_generation = Some(generation);
            Ok(())
        } else {
            Err(())
        }
    }

    fn delete(&mut self, generation: u64) -> Result<(), ()> {
        self.consume_fault(VaultFaultV1::Delete)?;
        self.staged.remove(&generation);
        if self.active_generation == Some(generation) {
            self.active_generation = None;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum AuthorityFaultV1 {
    UnavailableBeforeSend,
    RejectTerminal,
    LoseResponseAfterCommit,
    ReconcilePending,
    UnsafeProjection,
}

#[derive(Clone)]
struct StoredAuthorityReplyV1 {
    terminal: TerminalOutcomeV1,
    session_effect: SessionEffectV1,
    refresh_secret: Option<String>,
    safe_projection_handle: Option<String>,
}

impl StoredAuthorityReplyV1 {
    fn materialize(&self) -> AuthorityReplyV1 {
        AuthorityReplyV1 {
            terminal: self.terminal,
            session_effect: self.session_effect,
            refresh_secret: self
                .refresh_secret
                .as_deref()
                .map(PrivateSecretV1::synthetic_canary),
            safe_projection_handle: self.safe_projection_handle.clone(),
        }
    }
}

#[derive(Debug, Default)]
pub(super) struct FakeAuthorityStateV1 {
    pub(super) account_count: u64,
    pub(super) active_sessions: u64,
    pub(super) profile_revision: u64,
    pub(super) identity_bindings: BTreeSet<&'static str>,
    pub(super) managed_key_generation: u64,
}

#[derive(Default)]
pub(super) struct StatefulFakeAuthorityV1 {
    state: FakeAuthorityStateV1,
    operation_ledger: BTreeMap<BrokerOperationIdV1, StoredAuthorityReplyV1>,
    faults: VecDeque<AuthorityFaultV1>,
    execute_calls: u64,
    reconcile_calls: u64,
}

impl StatefulFakeAuthorityV1 {
    pub(super) fn inject(&mut self, fault: AuthorityFaultV1) {
        self.faults.push_back(fault);
    }

    pub(super) fn execute_calls(&self) -> u64 {
        self.execute_calls
    }

    pub(super) fn reconcile_calls(&self) -> u64 {
        self.reconcile_calls
    }

    pub(super) fn state(&self) -> &FakeAuthorityStateV1 {
        &self.state
    }

    fn reply_for(&mut self, operation: GatewayOperationV1) -> StoredAuthorityReplyV1 {
        let mut session_effect = SessionEffectV1::Unchanged;
        let mut refresh_secret = None;
        match operation {
            GatewayOperationV1::AuthBeginRegistration => {
                self.state.account_count = self.state.account_count.saturating_add(1);
                self.state.active_sessions = self.state.active_sessions.saturating_add(1);
                session_effect = SessionEffectV1::Activated;
                refresh_secret = Some(SYNTHETIC_OPAQUE_SECRET_CANARY.to_owned());
            }
            GatewayOperationV1::AuthLogin
            | GatewayOperationV1::AuthVerifyMfa
            | GatewayOperationV1::AuthCompleteOauthAccount => {
                self.state.active_sessions = self.state.active_sessions.saturating_add(1);
                session_effect = SessionEffectV1::Activated;
                refresh_secret = Some(SYNTHETIC_OPAQUE_SECRET_CANARY.to_owned());
            }
            GatewayOperationV1::AuthLogout | GatewayOperationV1::ProfileRevokeAllSessions => {
                self.state.active_sessions = 0;
                session_effect = SessionEffectV1::RemotelyRevoked;
            }
            GatewayOperationV1::ProfileUpdateProfile
            | GatewayOperationV1::ProfileChangePassword
            | GatewayOperationV1::ProfileConfirmTotpEnrollment
            | GatewayOperationV1::ProfileDisableTotp => {
                self.state.profile_revision = self.state.profile_revision.saturating_add(1);
            }
            GatewayOperationV1::ProfileStartIdentityBinding => {
                self.state.identity_bindings.insert("synthetic-provider");
            }
            GatewayOperationV1::ProfileUnbindIdentity => {
                self.state.identity_bindings.remove("synthetic-provider");
            }
            GatewayOperationV1::ManagedKeyProvision
            | GatewayOperationV1::ManagedKeySelectExisting
            | GatewayOperationV1::ManagedKeyRotate
            | GatewayOperationV1::ManagedKeyRevoke => {
                self.state.managed_key_generation =
                    self.state.managed_key_generation.saturating_add(1);
            }
            _ => {}
        }
        StoredAuthorityReplyV1 {
            terminal: TerminalOutcomeV1::Succeeded,
            session_effect,
            refresh_secret,
            safe_projection_handle: Some("projection_accountD00001".to_owned()),
        }
    }
}

impl Token2ApiAuthorityV1 for StatefulFakeAuthorityV1 {
    fn execute(
        &mut self,
        operation_id: &BrokerOperationIdV1,
        request: &AccountBrokerRequestV1,
    ) -> Result<AuthorityReplyV1, AuthorityDispatchFailureV1> {
        self.execute_calls = self.execute_calls.saturating_add(1);
        if self.faults.front() == Some(&AuthorityFaultV1::UnavailableBeforeSend) {
            self.faults.pop_front();
            return Err(AuthorityDispatchFailureV1::NotSent);
        }
        if let Some(stored) = self.operation_ledger.get(operation_id) {
            return Ok(stored.materialize());
        }
        if self.faults.front() == Some(&AuthorityFaultV1::RejectTerminal) {
            self.faults.pop_front();
            let stored = StoredAuthorityReplyV1 {
                terminal: TerminalOutcomeV1::Rejected,
                session_effect: SessionEffectV1::Unchanged,
                refresh_secret: None,
                safe_projection_handle: None,
            };
            self.operation_ledger
                .insert(operation_id.clone(), stored.clone());
            return Ok(stored.materialize());
        }
        let mut stored = self.reply_for(request.operation);
        if self.faults.front() == Some(&AuthorityFaultV1::UnsafeProjection) {
            self.faults.pop_front();
            stored.safe_projection_handle = Some("projection_accountD00001/unsafe".to_owned());
        }
        self.operation_ledger
            .insert(operation_id.clone(), stored.clone());
        if self.faults.front() == Some(&AuthorityFaultV1::LoseResponseAfterCommit) {
            self.faults.pop_front();
            return Err(AuthorityDispatchFailureV1::ResponseLostAfterPossibleCommit);
        }
        Ok(stored.materialize())
    }

    fn reconcile(&mut self, operation_id: &BrokerOperationIdV1) -> AuthorityReconciliationV1 {
        self.reconcile_calls = self.reconcile_calls.saturating_add(1);
        if self.faults.front() == Some(&AuthorityFaultV1::ReconcilePending) {
            self.faults.pop_front();
            return AuthorityReconciliationV1::Pending;
        }
        self.operation_ledger
            .get(operation_id)
            .map(|stored| AuthorityReconciliationV1::Known(stored.materialize()))
            .unwrap_or(AuthorityReconciliationV1::Unknown)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum LocalAccountPlaneFailureV1 {
    FeatureDisabled,
    SignedOut,
    AuthorityOutage,
    VaultLocked,
    VaultUnavailable,
    RepositoryQuarantined,
    SessionRevoked,
    QuotaExhausted,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct LocalModeSnapshotV1 {
    pub(super) status: &'static str,
    pub(super) blocked_by_account: bool,
    pub(super) completed_local_actions: u64,
}

#[derive(Debug, Default)]
pub(super) struct LocalModeIsolationHarnessV1 {
    completed_local_actions: u64,
}

impl LocalModeIsolationHarnessV1 {
    pub(super) fn run_local_action(
        &mut self,
        _account_plane_failure: LocalAccountPlaneFailureV1,
    ) -> LocalModeSnapshotV1 {
        self.completed_local_actions = self.completed_local_actions.saturating_add(1);
        LocalModeSnapshotV1 {
            status: "available",
            blocked_by_account: false,
            completed_local_actions: self.completed_local_actions,
        }
    }
}
