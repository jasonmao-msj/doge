use super::model::{
    AccountBrokerRequestV1, AuthorityScopeV1, BrokerErrorV1, BrokerIntentBindingV1,
    BrokerOperationIdV1, BrokerReceiptV1, CancellationPointV1, GatewayIntentIdV1, NextActionV1,
    OperationLedgerEntryV1, SessionEffectV1, TerminalOutcomeV1, ACCOUNT_BROKER_CONTRACT_ID_V1,
    ACCOUNT_BROKER_CONTRACT_VERSION_V1,
};

pub(crate) trait BrokerClockV1 {
    fn now_ms(&mut self) -> Result<u64, BrokerErrorV1>;
}

pub(crate) trait AccountEpochFenceV1 {
    fn current_epoch(&self) -> Option<u64>;
    fn activate_next_epoch(&mut self);
}

pub(crate) trait AccountOperationRepositoryV1 {
    fn find_by_intent(
        &mut self,
        intent: &GatewayIntentIdV1,
    ) -> Result<Option<OperationLedgerEntryV1>, BrokerErrorV1>;
    fn insert(&mut self, entry: OperationLedgerEntryV1) -> Result<(), BrokerErrorV1>;
    fn append_transport_request(
        &mut self,
        intent: &GatewayIntentIdV1,
        request: super::model::TransportRequestIdV1,
        updated_at_ms: u64,
    ) -> Result<(), BrokerErrorV1>;
    fn save_receipt(
        &mut self,
        intent: &GatewayIntentIdV1,
        receipt: BrokerReceiptV1,
        updated_at_ms: u64,
    ) -> Result<(), BrokerErrorV1>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum VaultAvailabilityV1 {
    Ready,
    Locked,
    Unavailable,
    Inconsistent,
}

pub(crate) struct PrivateSecretV1(Vec<u8>);

impl PrivateSecretV1 {
    #[cfg(test)]
    pub(super) fn synthetic_canary(value: &str) -> Self {
        Self(value.as_bytes().to_vec())
    }

    pub(super) fn bytes(&self) -> &[u8] {
        &self.0
    }
}

impl std::fmt::Debug for PrivateSecretV1 {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("PrivateSecretV1([REDACTED])")
    }
}

impl Drop for PrivateSecretV1 {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

pub(crate) trait AccountCredentialVaultV1 {
    fn availability(&mut self) -> VaultAvailabilityV1;
    fn stage(&mut self, secret: PrivateSecretV1) -> Result<u64, ()>;
    fn activate(&mut self, generation: u64) -> Result<(), ()>;
    fn delete(&mut self, generation: u64) -> Result<(), ()>;
}

#[derive(Debug)]
pub(crate) struct AuthorityReplyV1 {
    pub(crate) terminal: TerminalOutcomeV1,
    pub(crate) session_effect: SessionEffectV1,
    pub(crate) refresh_secret: Option<PrivateSecretV1>,
    pub(crate) safe_projection_handle: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AuthorityDispatchFailureV1 {
    NotSent,
    ResponseLostAfterPossibleCommit,
}

#[derive(Debug)]
pub(crate) enum AuthorityReconciliationV1 {
    Pending,
    Known(AuthorityReplyV1),
    Unknown,
}

pub(crate) trait Token2ApiAuthorityV1 {
    fn execute(
        &mut self,
        operation_id: &BrokerOperationIdV1,
        request: &AccountBrokerRequestV1,
    ) -> Result<AuthorityReplyV1, AuthorityDispatchFailureV1>;
    fn reconcile(&mut self, operation_id: &BrokerOperationIdV1) -> AuthorityReconciliationV1;
}

pub(crate) struct AccountBrokerV1<A, V, R, C, E> {
    authority: A,
    vault: V,
    repository: R,
    clock: C,
    epoch_fence: E,
    process_generation: u64,
    next_operation_sequence: u64,
}

impl<A, V, R, C, E> AccountBrokerV1<A, V, R, C, E>
where
    A: Token2ApiAuthorityV1,
    V: AccountCredentialVaultV1,
    R: AccountOperationRepositoryV1,
    C: BrokerClockV1,
    E: AccountEpochFenceV1,
{
    pub(crate) fn new(
        authority: A,
        vault: V,
        repository: R,
        clock: C,
        epoch_fence: E,
        process_generation: u64,
    ) -> Self {
        Self {
            authority,
            vault,
            repository,
            clock,
            epoch_fence,
            process_generation,
            next_operation_sequence: 1,
        }
    }

    pub(crate) fn execute(
        &mut self,
        request: AccountBrokerRequestV1,
        cancellation: CancellationPointV1,
    ) -> Result<BrokerReceiptV1, BrokerErrorV1> {
        self.validate_contract(&request)?;
        self.require_process_generation(request.process_generation)?;
        if let Some(existing) = self.repository.find_by_intent(&request.intent_id)? {
            if !existing.matches(&request) {
                return Err(BrokerErrorV1::IdempotencyConflict);
            }
            let now_ms = self.clock.now_ms()?;
            self.repository.append_transport_request(
                &request.intent_id,
                request.transport_request_id,
                now_ms,
            )?;
            if let Some(receipt) = existing.receipt {
                return Ok(receipt);
            }
            return self.reconcile_existing(existing);
        }

        self.require_current_epoch(request.account_epoch)?;
        let now_ms = self.clock.now_ms()?;
        let operation_id = self.mint_operation_id(now_ms)?;
        let entry = OperationLedgerEntryV1 {
            binding: BrokerIntentBindingV1 {
                intent_id: request.intent_id.clone(),
                operation_id: operation_id.clone(),
                operation: request.operation,
                account_epoch: request.account_epoch,
                process_generation: request.process_generation,
                request_fingerprint: request.request_fingerprint.clone(),
            },
            transport_request_ids: vec![request.transport_request_id.clone()],
            receipt: None,
            created_at_ms: now_ms,
            updated_at_ms: now_ms,
        };
        self.repository.insert(entry)?;

        if cancellation == CancellationPointV1::BeforeSend {
            return self.finish(
                &request.intent_id,
                BrokerReceiptV1 {
                    operation_id,
                    operation: request.operation,
                    terminal: TerminalOutcomeV1::CancelledBeforeSend,
                    authority_scope: AuthorityScopeV1::NotContacted,
                    session_effect: SessionEffectV1::Unchanged,
                    next_action: NextActionV1::None,
                    safe_projection_handle: None,
                },
            );
        }

        let dispatch = self.authority.execute(&operation_id, &request);
        if cancellation == CancellationPointV1::AfterPossibleSend {
            return self.finish(
                &request.intent_id,
                unknown_receipt(operation_id, request.operation),
            );
        }

        match dispatch {
            Ok(reply) => self.finish_authority_reply(&request, operation_id, reply),
            Err(AuthorityDispatchFailureV1::NotSent) => self.finish(
                &request.intent_id,
                BrokerReceiptV1 {
                    operation_id,
                    operation: request.operation,
                    terminal: TerminalOutcomeV1::Rejected,
                    authority_scope: AuthorityScopeV1::NotContacted,
                    session_effect: SessionEffectV1::Unchanged,
                    next_action: NextActionV1::Retry,
                    safe_projection_handle: None,
                },
            ),
            Err(AuthorityDispatchFailureV1::ResponseLostAfterPossibleCommit) => self.finish(
                &request.intent_id,
                unknown_receipt(operation_id, request.operation),
            ),
        }
    }

    pub(crate) fn reconcile_intent(
        &mut self,
        intent: &GatewayIntentIdV1,
        expected_operation: super::model::GatewayOperationV1,
    ) -> Result<Option<BrokerReceiptV1>, BrokerErrorV1> {
        let Some(entry) = self.repository.find_by_intent(intent)? else {
            return Ok(None);
        };
        if entry.binding.operation != expected_operation {
            return Err(BrokerErrorV1::IdempotencyConflict);
        }
        if let Some(receipt) = &entry.receipt {
            if receipt.terminal != TerminalOutcomeV1::OutcomeUnknown {
                return Ok(Some(receipt.clone()));
            }
        }
        self.reconcile_existing(entry).map(Some)
    }

    fn reconcile_existing(
        &mut self,
        entry: OperationLedgerEntryV1,
    ) -> Result<BrokerReceiptV1, BrokerErrorV1> {
        match self.authority.reconcile(&entry.binding.operation_id) {
            AuthorityReconciliationV1::Known(reply) => self.finish_reconciled_reply(entry, reply),
            AuthorityReconciliationV1::Pending | AuthorityReconciliationV1::Unknown => self.finish(
                &entry.binding.intent_id,
                unknown_receipt(entry.binding.operation_id, entry.binding.operation),
            ),
        }
    }

    fn finish_reconciled_reply(
        &mut self,
        entry: OperationLedgerEntryV1,
        reply: AuthorityReplyV1,
    ) -> Result<BrokerReceiptV1, BrokerErrorV1> {
        let request = AccountBrokerRequestV1::new(
            entry.transport_request_ids[0].clone(),
            entry.binding.intent_id,
            entry.binding.operation,
            entry.binding.account_epoch,
            entry.binding.process_generation,
            entry.binding.request_fingerprint,
        );
        self.finish_authority_reply(&request, entry.binding.operation_id, reply)
    }

    fn finish_authority_reply(
        &mut self,
        request: &AccountBrokerRequestV1,
        operation_id: BrokerOperationIdV1,
        mut reply: AuthorityReplyV1,
    ) -> Result<BrokerReceiptV1, BrokerErrorV1> {
        if request.process_generation != self.process_generation {
            return self.finish(
                &request.intent_id,
                BrokerReceiptV1 {
                    operation_id,
                    operation: request.operation,
                    terminal: TerminalOutcomeV1::Rejected,
                    authority_scope: AuthorityScopeV1::Contacted,
                    session_effect: SessionEffectV1::Unchanged,
                    next_action: NextActionV1::Reauthenticate,
                    safe_projection_handle: None,
                },
            );
        }
        if request.account_epoch != self.epoch_fence.current_epoch() {
            return self.finish(
                &request.intent_id,
                BrokerReceiptV1 {
                    operation_id,
                    operation: request.operation,
                    terminal: TerminalOutcomeV1::Rejected,
                    authority_scope: AuthorityScopeV1::Contacted,
                    session_effect: SessionEffectV1::Unchanged,
                    next_action: NextActionV1::Reauthenticate,
                    safe_projection_handle: None,
                },
            );
        }

        if !matches!(
            reply.terminal,
            TerminalOutcomeV1::Succeeded | TerminalOutcomeV1::Rejected
        ) {
            return self.finish(
                &request.intent_id,
                protocol_failure(operation_id, request.operation),
            );
        }
        let receipt = BrokerReceiptV1 {
            operation_id: operation_id.clone(),
            operation: request.operation,
            terminal: reply.terminal,
            authority_scope: AuthorityScopeV1::Confirmed,
            session_effect: reply.session_effect,
            next_action: if reply.terminal == TerminalOutcomeV1::Succeeded {
                NextActionV1::None
            } else {
                NextActionV1::Retry
            },
            safe_projection_handle: reply.safe_projection_handle,
        };
        if !receipt.is_renderer_safe() || !receipt.has_legal_terminal_combination() {
            return self.finish(
                &request.intent_id,
                protocol_failure(receipt.operation_id, request.operation),
            );
        }

        let mut activated_generation = None;
        if receipt.terminal == TerminalOutcomeV1::Succeeded
            && receipt.session_effect == SessionEffectV1::Activated
        {
            let Some(secret) = reply.refresh_secret.take() else {
                return self.finish(
                    &request.intent_id,
                    protocol_failure(operation_id, request.operation),
                );
            };
            if self.vault.availability() != VaultAvailabilityV1::Ready {
                return self.finish(
                    &request.intent_id,
                    vault_rejection(operation_id, request.operation),
                );
            }
            let Ok(generation) = self.vault.stage(secret) else {
                return self.finish(
                    &request.intent_id,
                    vault_rejection(operation_id, request.operation),
                );
            };
            if self.vault.activate(generation).is_err() {
                let _ = self.vault.delete(generation);
                return self.finish(
                    &request.intent_id,
                    vault_rejection(operation_id, request.operation),
                );
            }
            activated_generation = Some(generation);
        }

        match self.finish(&request.intent_id, receipt) {
            Ok(receipt) => {
                if activated_generation.is_some() {
                    self.epoch_fence.activate_next_epoch();
                }
                Ok(receipt)
            }
            Err(error) => {
                if let Some(generation) = activated_generation {
                    let _ = self.vault.delete(generation);
                }
                Err(error)
            }
        }
    }

    fn finish(
        &mut self,
        intent: &GatewayIntentIdV1,
        receipt: BrokerReceiptV1,
    ) -> Result<BrokerReceiptV1, BrokerErrorV1> {
        if !receipt.is_renderer_safe() || !receipt.has_legal_terminal_combination() {
            return Err(BrokerErrorV1::ContractUnsupported);
        }
        let now_ms = self.clock.now_ms()?;
        self.repository
            .save_receipt(intent, receipt.clone(), now_ms)?;
        Ok(receipt)
    }

    fn validate_contract(&self, request: &AccountBrokerRequestV1) -> Result<(), BrokerErrorV1> {
        if request.contract_id == ACCOUNT_BROKER_CONTRACT_ID_V1
            && request.contract_version == ACCOUNT_BROKER_CONTRACT_VERSION_V1
        {
            Ok(())
        } else {
            Err(BrokerErrorV1::ContractUnsupported)
        }
    }

    fn require_current_epoch(&self, account_epoch: Option<u64>) -> Result<(), BrokerErrorV1> {
        if account_epoch == self.epoch_fence.current_epoch() {
            Ok(())
        } else {
            Err(BrokerErrorV1::StaleAccountEpoch)
        }
    }

    fn require_process_generation(&self, process_generation: u64) -> Result<(), BrokerErrorV1> {
        if process_generation > 0 && process_generation == self.process_generation {
            Ok(())
        } else {
            Err(BrokerErrorV1::StaleProcessGeneration)
        }
    }

    fn mint_operation_id(&mut self, now_ms: u64) -> Result<BrokerOperationIdV1, BrokerErrorV1> {
        let value = format!(
            "operation_{now_ms:016x}{:016x}",
            self.next_operation_sequence
        );
        self.next_operation_sequence = self.next_operation_sequence.saturating_add(1);
        BrokerOperationIdV1::parse(value)
    }

    #[cfg(test)]
    pub(super) fn authority(&self) -> &A {
        &self.authority
    }

    #[cfg(test)]
    pub(super) fn vault(&self) -> &V {
        &self.vault
    }

    #[cfg(test)]
    pub(super) fn repository(&self) -> &R {
        &self.repository
    }

    #[cfg(test)]
    pub(super) fn repository_mut(&mut self) -> &mut R {
        &mut self.repository
    }

    #[cfg(test)]
    pub(super) fn epoch(&self) -> Option<u64> {
        self.epoch_fence.current_epoch()
    }
}

fn unknown_receipt(
    operation_id: BrokerOperationIdV1,
    operation: super::model::GatewayOperationV1,
) -> BrokerReceiptV1 {
    BrokerReceiptV1 {
        operation_id,
        operation,
        terminal: TerminalOutcomeV1::OutcomeUnknown,
        authority_scope: AuthorityScopeV1::ReconciliationPending,
        session_effect: SessionEffectV1::Unchanged,
        next_action: NextActionV1::Reconcile,
        safe_projection_handle: None,
    }
}

fn vault_rejection(
    operation_id: BrokerOperationIdV1,
    operation: super::model::GatewayOperationV1,
) -> BrokerReceiptV1 {
    BrokerReceiptV1 {
        operation_id,
        operation,
        terminal: TerminalOutcomeV1::Rejected,
        authority_scope: AuthorityScopeV1::Contacted,
        session_effect: SessionEffectV1::Unchanged,
        next_action: NextActionV1::UnlockVault,
        safe_projection_handle: None,
    }
}

fn protocol_failure(
    operation_id: BrokerOperationIdV1,
    operation: super::model::GatewayOperationV1,
) -> BrokerReceiptV1 {
    if !operation.is_read() {
        return unknown_receipt(operation_id, operation);
    }
    BrokerReceiptV1 {
        operation_id,
        operation,
        terminal: TerminalOutcomeV1::Rejected,
        authority_scope: AuthorityScopeV1::Contacted,
        session_effect: SessionEffectV1::Unchanged,
        next_action: NextActionV1::ContactSupport,
        safe_projection_handle: None,
    }
}
