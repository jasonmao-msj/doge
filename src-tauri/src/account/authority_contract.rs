use super::authority::{protocol_error, AuthorityError};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

pub(crate) const AUTHORITY_CONTRACT_ID: &str = "token2api-account-authority";
pub(crate) const AUTHORITY_CONTRACT_VERSION: &str = "1.0.0";

pub(crate) const AUTHORITY_GUARANTEES: &[&str] = &[
    "durable_token_pair_v1",
    "atomic_refresh_replay_v1",
    "durable_revocation_generation_v1",
    "desktop_oauth_ticket_v1",
    "desktop_reset_handoff_v1",
    "desktop_human_verification_v1",
    "api_key_one_time_secret_v1",
    "api_key_metadata_only_reads_v1",
    "api_key_owner_handoff_v1",
    "api_key_recoverable_encryption_v1",
    "stable_account_reasons_v1",
    "typed_logout_outcome_v1",
];

const AUTHORITY_CAPABILITIES: &[&str] = &[
    "registration",
    "registrationEmailVerification",
    "passwordLogin",
    "passwordReset",
    "humanVerification",
    "mfa",
    "oauth.github",
    "oauth.google",
    "oauth.linuxdo",
    "oauth.wechat",
    "oauth.oidc",
    "oauth.dingtalk",
    "profile",
    "passwordChange",
    "totp",
    "identityBindings",
    "revokeAllSessions",
    "quotaPull",
    "subscriptionSummary",
    "apiKeyList",
    "apiKeyHandoff",
    "managedKeyProvision",
    "managedKeyRotate",
    "managedKeyRevoke",
];

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthorityCapabilityDescriptorWire {
    contract_id: String,
    contract_version: String,
    observed_at: String,
    capabilities: HashMap<String, bool>,
    guarantees: Vec<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct AuthorityCapabilityDescriptor {
    capabilities: HashMap<String, bool>,
    guarantees: HashSet<String>,
}

impl AuthorityCapabilityDescriptor {
    pub(crate) fn try_from_wire(
        wire: AuthorityCapabilityDescriptorWire,
    ) -> Result<Self, AuthorityError> {
        if wire.contract_id != AUTHORITY_CONTRACT_ID
            || wire.contract_version != AUTHORITY_CONTRACT_VERSION
            || !wire.observed_at.ends_with('Z')
            || chrono::DateTime::parse_from_rfc3339(&wire.observed_at).is_err()
            || wire
                .capabilities
                .keys()
                .any(|key| !AUTHORITY_CAPABILITIES.contains(&key.as_str()))
            || wire
                .guarantees
                .iter()
                .any(|guarantee| !AUTHORITY_GUARANTEES.contains(&guarantee.as_str()))
        {
            return Err(protocol_error());
        }
        let guarantee_count = wire.guarantees.len();
        let guarantees: HashSet<String> = wire.guarantees.into_iter().collect();
        if guarantees.len() != guarantee_count {
            return Err(protocol_error());
        }
        Ok(Self {
            capabilities: wire.capabilities,
            guarantees,
        })
    }

    pub(crate) fn supports(&self, capability: &str, required_guarantees: &[&str]) -> bool {
        self.capabilities.get(capability) == Some(&true) && self.has_guarantees(required_guarantees)
    }

    pub(crate) fn has_guarantees(&self, required_guarantees: &[&str]) -> bool {
        required_guarantees
            .iter()
            .all(|guarantee| self.guarantees.contains(*guarantee))
    }

    #[cfg(test)]
    pub(crate) fn test_fixture(capabilities: HashMap<String, bool>, guarantees: &[&str]) -> Self {
        Self {
            capabilities,
            guarantees: guarantees
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
        }
    }
}

#[cfg(test)]
impl AuthorityCapabilityDescriptorWire {
    pub(crate) fn test_fixture(guarantees: Vec<&str>, capabilities: HashMap<String, bool>) -> Self {
        Self {
            contract_id: AUTHORITY_CONTRACT_ID.to_string(),
            contract_version: AUTHORITY_CONTRACT_VERSION.to_string(),
            observed_at: "2030-01-01T00:00:00Z".to_string(),
            capabilities,
            guarantees: guarantees.into_iter().map(str::to_string).collect(),
        }
    }

    pub(crate) fn with_contract_id(mut self, value: &str) -> Self {
        self.contract_id = value.to_string();
        self
    }

    pub(crate) fn with_contract_version(mut self, value: &str) -> Self {
        self.contract_version = value.to_string();
        self
    }

    pub(crate) fn with_observed_at(mut self, value: &str) -> Self {
        self.observed_at = value.to_string();
        self
    }
}
