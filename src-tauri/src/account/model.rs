use std::fmt;

pub(crate) const ACCOUNT_BROKER_CONTRACT_ID_V1: &str = "doge-account-broker";
pub(crate) const ACCOUNT_BROKER_CONTRACT_VERSION_V1: &str = "1.0.0";

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub(crate) struct GatewayIntentIdV1(String);

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub(crate) struct TransportRequestIdV1(String);

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub(crate) struct BrokerOperationIdV1(String);

macro_rules! opaque_id {
    ($name:ident, $prefix:literal) => {
        impl $name {
            pub(crate) fn parse(value: impl Into<String>) -> Result<Self, BrokerErrorV1> {
                let value = value.into();
                if is_valid_opaque_id(&value, $prefix) {
                    Ok(Self(value))
                } else {
                    Err(BrokerErrorV1::InvalidIdentity)
                }
            }
        }
    };
}

opaque_id!(GatewayIntentIdV1, "intent");
opaque_id!(TransportRequestIdV1, "request");
opaque_id!(BrokerOperationIdV1, "operation");

fn is_valid_opaque_id(value: &str, expected_prefix: &str) -> bool {
    let Some((prefix, suffix)) = value.split_once('_') else {
        return false;
    };
    prefix == expected_prefix
        && (2..=32).contains(&prefix.len())
        && prefix
            .bytes()
            .enumerate()
            .all(|(index, byte)| match (index, byte) {
                (0, b'a'..=b'z') => true,
                (_, b'a'..=b'z' | b'0'..=b'9' | b'-') => true,
                _ => false,
            })
        && (6..=96).contains(&suffix.len())
        && suffix
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RequestFingerprintV1(String);

impl RequestFingerprintV1 {
    pub(crate) fn parse(value: impl Into<String>) -> Result<Self, BrokerErrorV1> {
        let value = value.into();
        let Some(digest) = value.strip_prefix("sha256:") else {
            return Err(BrokerErrorV1::InvalidRequestFingerprint);
        };
        if digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
        {
            Ok(Self(value))
        } else {
            Err(BrokerErrorV1::InvalidRequestFingerprint)
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum GatewayOperationV1 {
    GatewayBootstrap,
    GatewayReconcileIntent,
    HumanVerificationReadRequirement,
    HumanVerificationSubmitProof,
    AuthBeginRegistration,
    AuthResendRegistrationCode,
    AuthSubmitRegistrationCode,
    AuthLogin,
    AuthVerifyMfa,
    AuthStartOauth,
    AuthCancelOauth,
    AuthReadOauthAttempt,
    AuthCompleteOauthAccount,
    AuthRequestPasswordReset,
    AuthInspectExternalIntent,
    AuthResetPassword,
    AuthLogout,
    ProfileRead,
    ProfileUpdateProfile,
    ProfileChangePassword,
    ProfileRequestTotpEmailCode,
    ProfileBeginTotpEnrollment,
    ProfileConfirmTotpEnrollment,
    ProfileDisableTotp,
    ProfileStartIdentityBinding,
    ProfileUnbindIdentity,
    ProfileRevokeAllSessions,
    UsageRead,
    ManagedKeyReadStatus,
    ManagedKeyListCandidates,
    ManagedKeySelectExisting,
    ManagedKeyProvision,
    ManagedKeyRotate,
    ManagedKeyRevoke,
    ConfigurationReadOffer,
    ConfigurationCreatePlan,
    ConfigurationReadFileDetail,
    ConfigurationApply,
    ConfigurationReadCurrentTask,
    ConfigurationAcknowledgeResult,
    ConfigurationHardDismiss,
}

pub(crate) const GATEWAY_OPERATIONS_V1: [GatewayOperationV1; 41] = [
    GatewayOperationV1::GatewayBootstrap,
    GatewayOperationV1::GatewayReconcileIntent,
    GatewayOperationV1::HumanVerificationReadRequirement,
    GatewayOperationV1::HumanVerificationSubmitProof,
    GatewayOperationV1::AuthBeginRegistration,
    GatewayOperationV1::AuthResendRegistrationCode,
    GatewayOperationV1::AuthSubmitRegistrationCode,
    GatewayOperationV1::AuthLogin,
    GatewayOperationV1::AuthVerifyMfa,
    GatewayOperationV1::AuthStartOauth,
    GatewayOperationV1::AuthCancelOauth,
    GatewayOperationV1::AuthReadOauthAttempt,
    GatewayOperationV1::AuthCompleteOauthAccount,
    GatewayOperationV1::AuthRequestPasswordReset,
    GatewayOperationV1::AuthInspectExternalIntent,
    GatewayOperationV1::AuthResetPassword,
    GatewayOperationV1::AuthLogout,
    GatewayOperationV1::ProfileRead,
    GatewayOperationV1::ProfileUpdateProfile,
    GatewayOperationV1::ProfileChangePassword,
    GatewayOperationV1::ProfileRequestTotpEmailCode,
    GatewayOperationV1::ProfileBeginTotpEnrollment,
    GatewayOperationV1::ProfileConfirmTotpEnrollment,
    GatewayOperationV1::ProfileDisableTotp,
    GatewayOperationV1::ProfileStartIdentityBinding,
    GatewayOperationV1::ProfileUnbindIdentity,
    GatewayOperationV1::ProfileRevokeAllSessions,
    GatewayOperationV1::UsageRead,
    GatewayOperationV1::ManagedKeyReadStatus,
    GatewayOperationV1::ManagedKeyListCandidates,
    GatewayOperationV1::ManagedKeySelectExisting,
    GatewayOperationV1::ManagedKeyProvision,
    GatewayOperationV1::ManagedKeyRotate,
    GatewayOperationV1::ManagedKeyRevoke,
    GatewayOperationV1::ConfigurationReadOffer,
    GatewayOperationV1::ConfigurationCreatePlan,
    GatewayOperationV1::ConfigurationReadFileDetail,
    GatewayOperationV1::ConfigurationApply,
    GatewayOperationV1::ConfigurationReadCurrentTask,
    GatewayOperationV1::ConfigurationAcknowledgeResult,
    GatewayOperationV1::ConfigurationHardDismiss,
];

impl GatewayOperationV1 {
    pub(crate) fn as_contract_name(self) -> &'static str {
        match self {
            Self::GatewayBootstrap => "gateway.bootstrap",
            Self::GatewayReconcileIntent => "gateway.reconcileIntent",
            Self::HumanVerificationReadRequirement => "humanVerification.readRequirement",
            Self::HumanVerificationSubmitProof => "humanVerification.submitProof",
            Self::AuthBeginRegistration => "auth.beginRegistration",
            Self::AuthResendRegistrationCode => "auth.resendRegistrationCode",
            Self::AuthSubmitRegistrationCode => "auth.submitRegistrationCode",
            Self::AuthLogin => "auth.login",
            Self::AuthVerifyMfa => "auth.verifyMfa",
            Self::AuthStartOauth => "auth.startOAuth",
            Self::AuthCancelOauth => "auth.cancelOAuth",
            Self::AuthReadOauthAttempt => "auth.readOAuthAttempt",
            Self::AuthCompleteOauthAccount => "auth.completeOAuthAccount",
            Self::AuthRequestPasswordReset => "auth.requestPasswordReset",
            Self::AuthInspectExternalIntent => "auth.inspectExternalIntent",
            Self::AuthResetPassword => "auth.resetPassword",
            Self::AuthLogout => "auth.logout",
            Self::ProfileRead => "profile.read",
            Self::ProfileUpdateProfile => "profile.updateProfile",
            Self::ProfileChangePassword => "profile.changePassword",
            Self::ProfileRequestTotpEmailCode => "profile.requestTotpEmailCode",
            Self::ProfileBeginTotpEnrollment => "profile.beginTotpEnrollment",
            Self::ProfileConfirmTotpEnrollment => "profile.confirmTotpEnrollment",
            Self::ProfileDisableTotp => "profile.disableTotp",
            Self::ProfileStartIdentityBinding => "profile.startIdentityBinding",
            Self::ProfileUnbindIdentity => "profile.unbindIdentity",
            Self::ProfileRevokeAllSessions => "profile.revokeAllSessions",
            Self::UsageRead => "usage.read",
            Self::ManagedKeyReadStatus => "managedKey.readStatus",
            Self::ManagedKeyListCandidates => "managedKey.listCandidates",
            Self::ManagedKeySelectExisting => "managedKey.selectExisting",
            Self::ManagedKeyProvision => "managedKey.provision",
            Self::ManagedKeyRotate => "managedKey.rotate",
            Self::ManagedKeyRevoke => "managedKey.revoke",
            Self::ConfigurationReadOffer => "configuration.readOffer",
            Self::ConfigurationCreatePlan => "configuration.createPlan",
            Self::ConfigurationReadFileDetail => "configuration.readFileDetail",
            Self::ConfigurationApply => "configuration.apply",
            Self::ConfigurationReadCurrentTask => "configuration.readCurrentTask",
            Self::ConfigurationAcknowledgeResult => "configuration.acknowledgeResult",
            Self::ConfigurationHardDismiss => "configuration.hardDismiss",
        }
    }

    pub(crate) fn is_read(self) -> bool {
        matches!(
            self,
            Self::GatewayBootstrap
                | Self::GatewayReconcileIntent
                | Self::HumanVerificationReadRequirement
                | Self::AuthReadOauthAttempt
                | Self::AuthInspectExternalIntent
                | Self::ProfileRead
                | Self::UsageRead
                | Self::ManagedKeyReadStatus
                | Self::ManagedKeyListCandidates
                | Self::ConfigurationReadOffer
                | Self::ConfigurationReadFileDetail
                | Self::ConfigurationReadCurrentTask
        )
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TerminalOutcomeV1 {
    Succeeded,
    Rejected,
    CancelledBeforeSend,
    OutcomeUnknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AuthorityScopeV1 {
    NotContacted,
    Contacted,
    Confirmed,
    ReconciliationPending,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SessionEffectV1 {
    Unchanged,
    Activated,
    Refreshed,
    LocallyCleared,
    RemotelyRevoked,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum NextActionV1 {
    None,
    Retry,
    Reauthenticate,
    UnlockVault,
    Reconcile,
    ContactSupport,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum CancellationPointV1 {
    None,
    BeforeSend,
    AfterPossibleSend,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AccountBrokerRequestV1 {
    pub(crate) contract_id: &'static str,
    pub(crate) contract_version: &'static str,
    pub(crate) transport_request_id: TransportRequestIdV1,
    pub(crate) intent_id: GatewayIntentIdV1,
    pub(crate) operation: GatewayOperationV1,
    pub(crate) account_epoch: Option<u64>,
    pub(crate) process_generation: u64,
    pub(crate) request_fingerprint: RequestFingerprintV1,
}

impl AccountBrokerRequestV1 {
    pub(crate) fn new(
        transport_request_id: TransportRequestIdV1,
        intent_id: GatewayIntentIdV1,
        operation: GatewayOperationV1,
        account_epoch: Option<u64>,
        process_generation: u64,
        request_fingerprint: RequestFingerprintV1,
    ) -> Self {
        Self {
            contract_id: ACCOUNT_BROKER_CONTRACT_ID_V1,
            contract_version: ACCOUNT_BROKER_CONTRACT_VERSION_V1,
            transport_request_id,
            intent_id,
            operation,
            account_epoch,
            process_generation,
            request_fingerprint,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct BrokerIntentBindingV1 {
    pub(crate) intent_id: GatewayIntentIdV1,
    pub(crate) operation_id: BrokerOperationIdV1,
    pub(crate) operation: GatewayOperationV1,
    pub(crate) account_epoch: Option<u64>,
    pub(crate) process_generation: u64,
    pub(crate) request_fingerprint: RequestFingerprintV1,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct BrokerReceiptV1 {
    pub(crate) operation_id: BrokerOperationIdV1,
    pub(crate) operation: GatewayOperationV1,
    pub(crate) terminal: TerminalOutcomeV1,
    pub(crate) authority_scope: AuthorityScopeV1,
    pub(crate) session_effect: SessionEffectV1,
    pub(crate) next_action: NextActionV1,
    pub(crate) safe_projection_handle: Option<String>,
}

impl BrokerReceiptV1 {
    pub(crate) fn is_renderer_safe(&self) -> bool {
        self.safe_projection_handle
            .as_deref()
            .map(is_safe_projection_handle)
            .unwrap_or(true)
    }

    pub(crate) fn has_legal_terminal_combination(&self) -> bool {
        let base_legal = match self.terminal {
            TerminalOutcomeV1::CancelledBeforeSend => {
                self.authority_scope == AuthorityScopeV1::NotContacted
                    && self.session_effect == SessionEffectV1::Unchanged
                    && self.next_action == NextActionV1::None
            }
            TerminalOutcomeV1::OutcomeUnknown => {
                self.authority_scope == AuthorityScopeV1::ReconciliationPending
                    && self.session_effect == SessionEffectV1::Unchanged
                    && self.next_action == NextActionV1::Reconcile
            }
            TerminalOutcomeV1::Succeeded => {
                self.authority_scope == AuthorityScopeV1::Confirmed
                    && self.next_action == NextActionV1::None
            }
            TerminalOutcomeV1::Rejected => {
                matches!(
                    self.authority_scope,
                    AuthorityScopeV1::NotContacted
                        | AuthorityScopeV1::Contacted
                        | AuthorityScopeV1::Confirmed
                ) && self.session_effect == SessionEffectV1::Unchanged
                    && matches!(
                        self.next_action,
                        NextActionV1::Retry
                            | NextActionV1::Reauthenticate
                            | NextActionV1::UnlockVault
                            | NextActionV1::ContactSupport
                    )
            }
        };
        base_legal
            && (!matches!(
                self.session_effect,
                SessionEffectV1::Activated
                    | SessionEffectV1::Refreshed
                    | SessionEffectV1::RemotelyRevoked
            ) || self.terminal == TerminalOutcomeV1::Succeeded)
    }
}

fn is_safe_projection_handle(value: &str) -> bool {
    is_valid_opaque_id(value, "projection")
        && !value.contains("//")
        && !value.contains('/')
        && !value.contains('\\')
        && !value.contains("@@")
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct OperationLedgerEntryV1 {
    pub(crate) binding: BrokerIntentBindingV1,
    pub(crate) transport_request_ids: Vec<TransportRequestIdV1>,
    pub(crate) receipt: Option<BrokerReceiptV1>,
    pub(crate) created_at_ms: u64,
    pub(crate) updated_at_ms: u64,
}

impl OperationLedgerEntryV1 {
    pub(crate) fn matches(&self, request: &AccountBrokerRequestV1) -> bool {
        self.binding.intent_id == request.intent_id
            && self.binding.operation == request.operation
            && self.binding.account_epoch == request.account_epoch
            && self.binding.process_generation == request.process_generation
            && self.binding.request_fingerprint == request.request_fingerprint
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum BrokerErrorV1 {
    ContractUnsupported,
    InvalidIdentity,
    InvalidRequestFingerprint,
    IdempotencyConflict,
    StaleAccountEpoch,
    StaleProcessGeneration,
    ClockUnavailable,
    PersistenceUnavailable,
}

impl fmt::Display for BrokerErrorV1 {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let value = match self {
            Self::ContractUnsupported => "account broker contract unsupported",
            Self::InvalidIdentity => "account operation identity invalid",
            Self::InvalidRequestFingerprint => "account request fingerprint invalid",
            Self::IdempotencyConflict => "account intent idempotency conflict",
            Self::StaleAccountEpoch => "account epoch is stale",
            Self::StaleProcessGeneration => "account process generation is stale",
            Self::ClockUnavailable => "account broker clock unavailable",
            Self::PersistenceUnavailable => "account operation ledger unavailable",
        };
        formatter.write_str(value)
    }
}
