use super::authority::{
    AuthWire, AuthorityCapabilityDescriptor, AuthorityError, LoginWire, PublicSettingsWire,
    TokenMatrixAuthority,
};
use super::configuration::{self, ConfigurationPlanState, ACCOUNT_RECIPE_ID};
use super::desktop_continuation::DesktopContinuationBroker;
use super::persistence::{
    AcceptedOperationRecord, AccountMetadata, AccountRepository, EngineCheckoutRecord,
    ExternalFlowRecord,
};
use super::vault::{AccountVaultStatus, DurableAccountVault, OsAccountVault};
use chrono::{SecondsFormat, TimeZone, Utc};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;
use uuid::Uuid;
use zeroize::Zeroizing;

pub(super) const CONTRACT_ID: &str = "doge-account-ipc";
pub(super) const CONTRACT_VERSION: &str = "1.0.0";
const REFRESH_PURPOSE_PREFIX: &str = "refresh-session:";
const MANAGED_KEY_PURPOSE_PREFIX: &str = "managed-key:codex-token-service:";
const MANAGED_ENGINE_PURPOSE_PREFIX: &str = "managed-engine:";
const AUTHORITY_ORIGIN_ID: &str = "authority_token-matrix-production-v1";

pub(super) const READ_OPERATIONS: &[&str] = &[
    "gateway.bootstrap",
    "gateway.reconcileIntent",
    "humanVerification.readRequirement",
    "auth.readOAuthAttempt",
    "auth.inspectExternalIntent",
    "profile.read",
    "usage.read",
    "managedKey.readStatus",
    "managedKey.listCandidates",
    "configuration.readOffer",
    "configuration.readFileDetail",
    "configuration.readCurrentTask",
];

pub(super) const OPERATIONS: &[&str] = &[
    "gateway.bootstrap",
    "gateway.reconcileIntent",
    "humanVerification.readRequirement",
    "humanVerification.submitProof",
    "auth.beginRegistration",
    "auth.resendRegistrationCode",
    "auth.submitRegistrationCode",
    "auth.login",
    "auth.verifyMfa",
    "auth.startOAuth",
    "auth.cancelOAuth",
    "auth.readOAuthAttempt",
    "auth.completeOAuthAccount",
    "auth.requestPasswordReset",
    "auth.inspectExternalIntent",
    "auth.resetPassword",
    "auth.logout",
    "profile.read",
    "profile.updateProfile",
    "profile.changePassword",
    "profile.requestTotpEmailCode",
    "profile.beginTotpEnrollment",
    "profile.confirmTotpEnrollment",
    "profile.disableTotp",
    "profile.startIdentityBinding",
    "profile.unbindIdentity",
    "profile.revokeAllSessions",
    "usage.read",
    "managedKey.readStatus",
    "managedKey.listCandidates",
    "managedKey.selectExisting",
    "managedKey.provision",
    "managedKey.rotate",
    "managedKey.revoke",
    "configuration.readOffer",
    "configuration.createPlan",
    "configuration.readFileDetail",
    "configuration.apply",
    "configuration.readCurrentTask",
    "configuration.acknowledgeResult",
    "configuration.hardDismiss",
];

struct RegistrationDraft {
    email: String,
    password: Zeroizing<String>,
    invitation_code: Option<Zeroizing<String>>,
    promo_code: Option<String>,
    expires_at: i64,
}

struct MfaDraft {
    token: Zeroizing<String>,
    expires_at: i64,
}

#[derive(Clone)]
struct DesktopAuthorizationBinding {
    authorization_id: String,
    exchange_operation_id: String,
    provider: String,
    expires_at: i64,
}

#[derive(Clone)]
struct ApiKeyCandidateBinding {
    key_id: i64,
    expires_at: i64,
}

struct RuntimeState {
    initialized: bool,
    account_epoch: u64,
    access_token: Option<Zeroizing<String>>,
    access_expires_at: i64,
    profile: Option<Value>,
    public_settings: Option<PublicSettingsWire>,
    authority_descriptor: Option<AuthorityCapabilityDescriptor>,
    authority_contract_fetched_at: i64,
    metadata: Option<AccountMetadata>,
    registration_attempts: HashMap<String, RegistrationDraft>,
    mfa_attempts: HashMap<String, MfaDraft>,
    desktop_authorizations: HashMap<String, DesktopAuthorizationBinding>,
    api_key_candidates: HashMap<String, ApiKeyCandidateBinding>,
    configuration_plan: Option<ConfigurationPlanState>,
    configuration_result: Option<Value>,
}

pub(crate) struct AccountRuntime {
    enabled: bool,
    authority: Option<TokenMatrixAuthority>,
    repository: Option<AccountRepository>,
    vault: Arc<dyn DurableAccountVault>,
    state: Mutex<RuntimeState>,
    device_id: Option<String>,
    process_generation: u64,
    event_sequence: Arc<AtomicU64>,
    desktop_continuations: DesktopContinuationBroker,
}

impl AccountRuntime {
    pub(crate) fn load(data_dir: &Path) -> Self {
        if !account_convenience_enabled_for_build() {
            return Self {
                enabled: false,
                authority: None,
                repository: None,
                vault: Arc::new(OsAccountVault),
                state: Mutex::new(RuntimeState {
                    initialized: true,
                    account_epoch: 1,
                    access_token: None,
                    access_expires_at: 0,
                    profile: None,
                    public_settings: None,
                    authority_descriptor: None,
                    authority_contract_fetched_at: 0,
                    metadata: None,
                    registration_attempts: HashMap::new(),
                    mfa_attempts: HashMap::new(),
                    desktop_authorizations: HashMap::new(),
                    api_key_candidates: HashMap::new(),
                    configuration_plan: None,
                    configuration_result: None,
                }),
                device_id: None,
                process_generation: random_process_generation(),
                event_sequence: Arc::new(AtomicU64::new(0)),
                desktop_continuations: DesktopContinuationBroker::new(),
            };
        }
        let repository = AccountRepository::open(data_dir.join("account-v1.sqlite3")).ok();
        if let Some(repository) = &repository {
            let now = now_epoch();
            let _ = repository.recover_interrupted_operations(now);
            let _ = repository.expire_pending_external_flows(now);
            let _ = repository.prune_operations(now.saturating_sub(7 * 24 * 60 * 60));
        }
        let metadata = repository
            .as_ref()
            .and_then(|repository| repository.read_session().ok().flatten());
        let recovered_configuration_result = configuration::recover_interrupted_transactions()
            .ok()
            .flatten();
        let recovered_configuration_receipt_saved =
            if let (Some(repository), Some(metadata), Some(result)) = (
                repository.as_ref(),
                metadata.as_ref(),
                recovered_configuration_result.as_ref(),
            ) {
                if let (Some(account_link_id), Some(device_id)) = (
                    metadata.account_link_id.as_deref(),
                    metadata.device_id.as_deref(),
                ) {
                    repository
                        .save_configuration_result(
                            account_link_id,
                            device_id,
                            result,
                            result.get("overall")
                                == Some(&Value::String("rollbackIncomplete".to_string())),
                            now_epoch(),
                        )
                        .is_ok()
                } else {
                    false
                }
            } else {
                false
            };
        if recovered_configuration_receipt_saved {
            let _ = configuration::commit_completed_transactions();
        }
        let device_id = repository
            .as_ref()
            .and_then(|repository| repository.load_or_create_device_id(now_epoch()).ok());
        let account_epoch = metadata
            .as_ref()
            .map(|value| value.account_epoch)
            .unwrap_or(1);
        Self {
            enabled: true,
            authority: TokenMatrixAuthority::new().ok(),
            repository,
            vault: Arc::new(OsAccountVault),
            device_id,
            process_generation: random_process_generation(),
            event_sequence: Arc::new(AtomicU64::new(0)),
            desktop_continuations: DesktopContinuationBroker::new(),
            state: Mutex::new(RuntimeState {
                initialized: false,
                account_epoch,
                access_token: None,
                access_expires_at: 0,
                profile: None,
                public_settings: None,
                authority_descriptor: None,
                authority_contract_fetched_at: 0,
                metadata,
                registration_attempts: HashMap::new(),
                mfa_attempts: HashMap::new(),
                desktop_authorizations: HashMap::new(),
                api_key_candidates: HashMap::new(),
                configuration_plan: None,
                // Re-read the durable receipt on demand so it receives a handle bound to
                // this process generation and the current account epoch.
                configuration_result: None,
            }),
        }
    }

    pub(crate) async fn managed_codex_key_for_launch(&self) -> Result<Zeroizing<String>, String> {
        let state = self.state.lock().await;
        let scope = active_vault_scope(&state)
            .ok_or_else(|| "Doge Token Matrix account session is unavailable".to_string())?;
        let legacy_binding_available = state
            .metadata
            .as_ref()
            .is_some_and(|metadata| metadata.managed_key_id.is_some());
        self.vault
            .read(&format!("{MANAGED_ENGINE_PURPOSE_PREFIX}codex:{scope}"))?
            .or_else(|| {
                legacy_binding_available
                    .then(|| {
                        self.vault
                            .read(&format!("{MANAGED_KEY_PURPOSE_PREFIX}{scope}"))
                            .ok()
                            .flatten()
                    })
                    .flatten()
            })
            .filter(|value| !value.trim().is_empty())
            .map(Zeroizing::new)
            .ok_or_else(|| "Doge Token Matrix credential is unavailable".to_string())
    }

    pub(crate) async fn managed_engine_key_for_launch(
        &self,
        engine_id: &str,
    ) -> Result<Zeroizing<String>, String> {
        if !matches!(engine_id, "codex" | "claude-code") {
            return Err("Doge managed engine is unsupported".to_string());
        }
        let state = self.state.lock().await;
        let scope = active_vault_scope(&state)
            .ok_or_else(|| "Doge Token Matrix account session is unavailable".to_string())?;
        self.vault
            .read(&format!(
                "{MANAGED_ENGINE_PURPOSE_PREFIX}{engine_id}:{scope}"
            ))?
            .filter(|value| !value.trim().is_empty())
            .map(Zeroizing::new)
            .ok_or_else(|| "Doge Token Matrix credential is unavailable".to_string())
    }

    pub(crate) async fn hydrate_managed_claude_launch_profile(
        &self,
        mut profile: Option<crate::engine::claude::provider_profile::ClaudeProviderLaunchProfile>,
    ) -> Result<Option<crate::engine::claude::provider_profile::ClaudeProviderLaunchProfile>, String>
    {
        let Some(profile) = profile.as_mut() else {
            return Ok(None);
        };
        if profile.binding.provider_profile_id
            != crate::account::configuration::ACCOUNT_CLAUDE_PROVIDER_ID
            || profile
                .env
                .get("DOGE_MANAGED_ACCOUNT_ENGINE")
                .map(String::as_str)
                != Some("claude-code")
        {
            return Ok(Some(profile.clone()));
        }
        let token = self.managed_engine_key_for_launch("claude-code").await?;
        profile.env.remove("DOGE_MANAGED_ACCOUNT_ENGINE");
        profile
            .env
            .insert("ANTHROPIC_AUTH_TOKEN".to_string(), token.to_string());
        Ok(Some(profile.clone()))
    }

    pub(super) async fn contract_context(&self) -> Value {
        if !self.enabled {
            return json!({
                "processGeneration": self.process_generation,
                "accountEpoch": 1,
            });
        }
        let mut state = self.state.lock().await;
        self.initialize_session(&mut state).await;
        json!({
            "processGeneration": self.process_generation,
            "accountEpoch": state.account_epoch,
        })
    }

    pub(super) async fn prepare_mutation(&self, request: &Value) -> Result<String, String> {
        if !self.enabled {
            return Err("Account convenience is disabled in this build".to_string());
        }
        let validated = validate_request(request, self.process_generation)?;
        validate_operation_payload(validated.operation, validated.payload)?;
        if validated.kind != "mutation" {
            return Err("only Account mutations require preparation".to_string());
        }
        let mut state = self.state.lock().await;
        self.initialize_session(&mut state).await;
        if validated.account_epoch != Some(state.account_epoch) {
            return Err("stale Account epoch".to_string());
        }
        let intent_id = validated
            .intent_id
            .ok_or_else(|| "Account mutation intent is missing".to_string())?;
        let repository = self
            .repository
            .as_ref()
            .ok_or_else(|| "Account operation ledger is unavailable".to_string())?;
        let request_fingerprint = mutation_fingerprint(validated.operation, validated.payload)?;
        let accepted = repository.accept_operation(&AcceptedOperationRecord {
            operation_id: format!("operation_{}", Uuid::new_v4().simple()),
            request_id: validated.request_id.to_string(),
            intent_id: intent_id.to_string(),
            operation: validated.operation.to_string(),
            account_epoch: state.account_epoch,
            request_fingerprint,
            status: "accepted".to_string(),
            outcome: None,
            accepted_at: now_epoch(),
        })?;
        Ok(accepted.operation_id)
    }

    pub(super) async fn execute(
        &self,
        request: Value,
        operation_id: Option<String>,
    ) -> Result<Value, String> {
        if !self.enabled {
            return Err("Account convenience is disabled in this build".to_string());
        }
        let validated = validate_request(&request, self.process_generation)?;
        validate_operation_payload(validated.operation, validated.payload)?;
        let mut state = self.state.lock().await;
        self.initialize_session(&mut state).await;
        if validated.kind == "mutation" {
            let operation_id = operation_id
                .as_deref()
                .ok_or_else(|| "Account mutation was not prepared".to_string())?;
            let repository = self
                .repository
                .as_ref()
                .ok_or_else(|| "Account operation ledger is unavailable".to_string())?;
            let accepted = repository
                .read_operation(operation_id)?
                .ok_or_else(|| "Account mutation acceptance is invalid".to_string())?;
            if accepted.operation != validated.operation
                || accepted.account_epoch != state.account_epoch
                || Some(accepted.intent_id.as_str()) != validated.intent_id
                || accepted.request_fingerprint
                    != mutation_fingerprint(validated.operation, validated.payload)?
            {
                return Err("Account mutation acceptance correlation mismatch".to_string());
            }
            if accepted.status != "accepted" {
                return Ok(replayed_terminal_response(
                    validated.request_id,
                    validated.operation,
                    self.process_generation,
                    state.account_epoch,
                    operation_id,
                    accepted.outcome.as_deref(),
                    validated.intent_id.unwrap_or_default(),
                ));
            }
            repository.mark_operation_executing(operation_id, now_epoch())?;
        } else if operation_id.is_some() {
            return Err("Account read cannot carry an operation id".to_string());
        }
        if validated.kind == "mutation" && validated.account_epoch != Some(state.account_epoch) {
            return Err("stale Account epoch".to_string());
        }

        let outcome = self
            .execute_operation(
                &mut state,
                validated.operation,
                validated.payload,
                operation_id.as_deref(),
            )
            .await;
        let response_epoch = if validated.kind == "mutation" {
            validated.account_epoch
        } else {
            Some(state.account_epoch)
        };
        let base = json!({
            "contractId": CONTRACT_ID,
            "contractVersion": CONTRACT_VERSION,
            "requestId": validated.request_id,
            "operation": validated.operation,
            "processGeneration": self.process_generation,
            "accountEpoch": response_epoch,
            "operationId": operation_id,
        });
        let outcome = if validated.kind == "mutation" {
            let operation_id = operation_id
                .as_deref()
                .expect("validated mutation operation id");
            let terminal = if outcome.is_ok() {
                "succeeded"
            } else {
                "rejected"
            };
            if self
                .repository
                .as_ref()
                .ok_or_else(|| "Account operation ledger is unavailable".to_string())?
                .finish_operation(operation_id, terminal, now_epoch())
                .is_err()
            {
                Err(outcome_unknown_failure(
                    validated.intent_id.unwrap_or_default(),
                ))
            } else {
                outcome
            }
        } else {
            outcome
        };
        Ok(match outcome {
            Ok(value) => merge_object(base, json!({ "ok": true, "value": value })),
            Err(failure) => merge_object(base, json!({ "ok": false, "error": failure })),
        })
    }

    pub(super) fn wakeup_event(&self, operation: &str, account_epoch: u64) -> Option<Value> {
        let kind = match operation {
            "auth.beginRegistration"
            | "auth.submitRegistrationCode"
            | "auth.login"
            | "auth.verifyMfa"
            | "auth.logout"
            | "profile.changePassword"
            | "profile.revokeAllSessions" => "sessionChanged",
            "configuration.apply"
            | "configuration.acknowledgeResult"
            | "configuration.hardDismiss" => "configurationTaskChanged",
            _ => return None,
        };
        let event_seq = self.event_sequence.fetch_add(1, Ordering::Relaxed);
        Some(json!({
            "contractId": CONTRACT_ID,
            "contractVersion": CONTRACT_VERSION,
            "event": {
                "kind": kind,
                "eventId": format!("event_{}-{event_seq}-wakeup", self.process_generation),
                "emittedAt": rfc3339_now(),
                "processGeneration": self.process_generation,
                "eventSeq": event_seq,
                "accountEpoch": account_epoch,
            }
        }))
    }

    pub(crate) fn install_external_wakeup_bridge(&self, app: tauri::AppHandle) {
        if !self.enabled {
            return;
        }
        let mut wakeups = self.desktop_continuations.subscribe();
        let event_sequence = Arc::clone(&self.event_sequence);
        let process_generation = self.process_generation;
        tauri::async_runtime::spawn(async move {
            loop {
                let wakeup = match wakeups.recv().await {
                    Ok(value) => value,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                };
                let event_seq = event_sequence.fetch_add(1, Ordering::Relaxed);
                let envelope = json!({
                    "contractId": CONTRACT_ID,
                    "contractVersion": CONTRACT_VERSION,
                    "event": {
                        "kind": "oauthAttemptChanged",
                        "eventId": format!("event_{process_generation}-{event_seq}-oauth"),
                        "emittedAt": rfc3339_now(),
                        "processGeneration": process_generation,
                        "eventSeq": event_seq,
                        "accountEpoch": wakeup.account_epoch,
                        "attempt": wakeup.handle,
                    }
                });
                let _ = app.emit("doge://account-v1/wakeup", envelope);
            }
        });
    }

    pub(super) async fn current_epoch(&self) -> u64 {
        self.state.lock().await.account_epoch
    }
}

fn account_convenience_enabled_for_build() -> bool {
    cfg!(feature = "account-convenience")
        && !matches!(option_env!("VITE_DOGE_ACCOUNT_CONVENIENCE_V1"), Some("0"))
        && !matches!(option_env!("VITE_DOGE_ACCOUNT_UI_PREVIEW_V1"), Some("1"))
}

mod runtime_auth;
mod runtime_engine;
#[cfg(test)]
mod runtime_live_e2e_tests;
mod runtime_oauth;
mod runtime_operations;
mod runtime_projection;

use super::runtime_ipc::{
    fingerprint, mutation_fingerprint, validate_operation_payload, validate_request,
};
pub(crate) use runtime_projection::rfc3339_from_epoch;
use runtime_projection::*;
#[cfg(test)]
mod tests {
    use super::*;
    use crate::account::vault::tests::MemoryVault;

    #[test]
    fn account_disabled_build_does_not_create_account_store() {
        if account_convenience_enabled_for_build() {
            return;
        }
        let root = std::env::temp_dir().join(format!(
            "doge-account-disabled-runtime-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).expect("create test root");
        let runtime = AccountRuntime::load(&root);
        assert!(!runtime.enabled);
        assert!(!root.join("account-v1.sqlite3").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn engine_scoped_launch_uses_the_active_session_without_a_legacy_key_marker() {
        let scope = "scopeengine123456";
        let vault = Arc::new(MemoryVault::default());
        vault
            .write(
                &format!("{MANAGED_ENGINE_PURPOSE_PREFIX}codex:{scope}"),
                "sk-managed-engine-secret",
            )
            .expect("seed engine credential");
        let runtime = AccountRuntime {
            enabled: true,
            authority: None,
            repository: None,
            vault,
            state: Mutex::new(RuntimeState {
                initialized: true,
                account_epoch: 1,
                access_token: None,
                access_expires_at: 0,
                profile: None,
                public_settings: None,
                authority_descriptor: None,
                authority_contract_fetched_at: 0,
                metadata: Some(AccountMetadata {
                    authority_origin_id: Some(AUTHORITY_ORIGIN_ID.to_string()),
                    account_link_id: Some("link_account123456".to_string()),
                    device_id: Some("device123456".to_string()),
                    account_epoch: 1,
                    profile_label: "Account".to_string(),
                    primary_email_label: None,
                    session_status: "active".to_string(),
                    vault_scope: Some(scope.to_string()),
                    managed_key_id: None,
                    updated_at: "2030-01-01T00:00:00Z".to_string(),
                }),
                registration_attempts: HashMap::new(),
                mfa_attempts: HashMap::new(),
                desktop_authorizations: HashMap::new(),
                api_key_candidates: HashMap::new(),
                configuration_plan: None,
                configuration_result: None,
            }),
            device_id: Some("device123456".to_string()),
            process_generation: 1,
            event_sequence: Arc::new(AtomicU64::new(0)),
            desktop_continuations: DesktopContinuationBroker::new(),
        };

        let credential = runtime
            .managed_codex_key_for_launch()
            .await
            .expect("active session reads engine credential");
        assert_eq!(credential.as_str(), "sk-managed-engine-secret");

        runtime
            .state
            .lock()
            .await
            .metadata
            .as_mut()
            .expect("metadata")
            .session_status = "signedOut".to_string();
        assert!(runtime.managed_codex_key_for_launch().await.is_err());
    }

    #[test]
    fn request_boundary_rejects_unknown_fields() {
        let request = json!({
            "contractId": CONTRACT_ID,
            "contractVersion": CONTRACT_VERSION,
            "requestId": "request_abcdefgh",
            "operation": "gateway.bootstrap",
            "kind": "read",
            "processGeneration": 1,
            "accountEpoch": 1,
            "payload": Value::Null,
            "unexpected": true,
        });
        assert!(validate_request(&request, 1).is_err());
    }

    #[test]
    fn authority_requirement_inventory_fails_remote_operations_closed() {
        let login = authority_requirement("auth.login").expect("login requirement");
        assert_eq!(login.capability, "passwordLogin");
        assert_eq!(
            login.guarantees,
            &[
                "durable_token_pair_v1",
                "atomic_refresh_replay_v1",
                "stable_account_reasons_v1"
            ]
        );
        let revoke =
            authority_requirement("profile.revokeAllSessions").expect("revoke requirement");
        assert!(revoke
            .guarantees
            .contains(&"durable_revocation_generation_v1"));
        assert!(revoke.guarantees.contains(&"typed_logout_outcome_v1"));
        assert!(authority_requirement("managedKey.provision")
            .expect("managed key requirement")
            .guarantees
            .contains(&"api_key_one_time_secret_v1"));
        assert!(authority_requirement("managedKey.listCandidates")
            .expect("key list requirement")
            .guarantees
            .contains(&"api_key_metadata_only_reads_v1"));
        assert!(authority_requirement("managedKey.selectExisting")
            .expect("key handoff requirement")
            .guarantees
            .contains(&"api_key_owner_handoff_v1"));
        assert!(authority_requirement("usage.read").is_some());

        // These actions are local-only, truthful logout, or explicitly
        // unsupported shells. They must not accidentally inherit a remote
        // success claim from the generic requirement gate.
        for operation in [
            "gateway.bootstrap",
            "auth.logout",
            "managedKey.revoke",
            "configuration.apply",
        ] {
            assert!(authority_requirement(operation).is_none(), "{operation}");
        }
        let password_reset =
            authority_requirement("auth.requestPasswordReset").expect("password reset requirement");
        assert_eq!(password_reset.capability, "passwordReset");
        assert_eq!(password_reset.guarantees, &["stable_account_reasons_v1"]);
    }

    #[test]
    fn oauth_provider_and_authorize_url_are_closed_to_github() {
        let github = oauth_provider_spec("auth.oauth.github").expect("GitHub provider");
        assert_eq!(github.capability, "oauth.github");
        assert_eq!(github.authority_name, "github");
        assert!(oauth_provider_spec("auth.oauth.google").is_none());
        assert!(valid_authorize_url(
            "https://github.com/login/oauth/authorize?client_id=synthetic",
            github.authorize_host,
        ));
        for invalid in [
            "http://github.com/login/oauth/authorize",
            "https://github.com.evil.invalid/login/oauth/authorize",
            "https://user@github.com/login/oauth/authorize",
            "https://github.com/login/oauth/authorize#token",
        ] {
            assert!(
                !valid_authorize_url(invalid, github.authorize_host),
                "{invalid}"
            );
        }
    }

    #[test]
    fn bootstrap_projection_requires_server_guarantees_but_never_gates_local_mode() {
        let mut state = RuntimeState {
            initialized: true,
            account_epoch: 1,
            access_token: None,
            access_expires_at: 0,
            profile: None,
            public_settings: None,
            authority_descriptor: None,
            authority_contract_fetched_at: 0,
            metadata: None,
            registration_attempts: HashMap::new(),
            mfa_attempts: HashMap::new(),
            desktop_authorizations: HashMap::new(),
            api_key_candidates: HashMap::new(),
            configuration_plan: None,
            configuration_result: None,
        };
        let settings = PublicSettingsWire {
            registration_enabled: true,
            email_verify_enabled: true,
            password_reset_enabled: true,
            totp_enabled: true,
            github_oauth_enabled: true,
            google_oauth_enabled: false,
            linuxdo_oauth_enabled: false,
            wechat_oauth_enabled: false,
            oidc_oauth_enabled: false,
            dingtalk_oauth_enabled: false,
            invitation_code_enabled: false,
            promo_code_enabled: false,
            login_agreement_enabled: false,
            turnstile_enabled: false,
            tencent_captcha_enabled: false,
            aliyun_captcha_enabled: false,
            api_base_url: Some(super::super::authority::TOKEN_MATRIX_ORIGIN.to_string()),
            version: Some("0.1.172".to_string()),
        };
        let missing = bootstrap_value(
            &state,
            Some(&settings),
            None,
            AccountVaultStatus::Ready,
            "ready",
        );
        assert_eq!(missing["localMode"]["status"], "available");
        assert_eq!(missing["localMode"]["blockedByAccount"], false);
        assert_eq!(
            missing["capabilities"]["entries"]["auth.emailPasswordLogin"]["reason"],
            "serverGuaranteeMissing"
        );

        state.authority_descriptor = Some(AuthorityCapabilityDescriptor::test_fixture(
            HashMap::from([
                ("passwordLogin".to_string(), true),
                ("passwordReset".to_string(), true),
            ]),
            &[
                "durable_token_pair_v1",
                "atomic_refresh_replay_v1",
                "stable_account_reasons_v1",
            ],
        ));
        let enabled = bootstrap_value(
            &state,
            Some(&settings),
            state.authority_descriptor.as_ref(),
            AccountVaultStatus::Ready,
            "ready",
        );
        assert_eq!(
            enabled["capabilities"]["entries"]["auth.emailPasswordLogin"]["status"],
            "enabled"
        );
        assert_eq!(
            enabled["capabilities"]["entries"]["auth.passwordReset"]["status"],
            "enabled"
        );
        assert_eq!(
            enabled["capabilities"]["entries"]["auth.oauth.github"]["reason"],
            "serverGuaranteeMissing"
        );

        state.authority_descriptor = Some(AuthorityCapabilityDescriptor::test_fixture(
            HashMap::from([("oauth.github".to_string(), true)]),
            &[
                "desktop_oauth_ticket_v1",
                "durable_token_pair_v1",
                "atomic_refresh_replay_v1",
                "stable_account_reasons_v1",
            ],
        ));
        let oauth_enabled = bootstrap_value(
            &state,
            Some(&settings),
            state.authority_descriptor.as_ref(),
            AccountVaultStatus::Ready,
            "ready",
        );
        assert_eq!(
            oauth_enabled["capabilities"]["entries"]["auth.oauth.github"]["status"],
            "enabled"
        );
        assert_eq!(
            oauth_enabled["capabilities"]["entries"]["auth.oauth.google"]["status"],
            "disabled"
        );
    }

    #[test]
    fn mutation_payload_requires_exact_consent_and_fingerprint_changes_with_payload() {
        let valid = json!({
            "recipeId": ACCOUNT_RECIPE_ID,
            "recipeVersion": 1,
            "consent": "provisionDedicatedKey",
        });
        validate_operation_payload("managedKey.provision", &valid).expect("valid payload");
        let swapped = json!({
            "recipeId": ACCOUNT_RECIPE_ID,
            "recipeVersion": 1,
            "consent": "rotateDedicatedKey",
        });
        assert!(validate_operation_payload("managedKey.provision", &swapped).is_err());
        assert_ne!(fingerprint(&valid).unwrap(), fingerprint(&swapped).unwrap());
    }

    #[test]
    fn masking_never_returns_raw_email() {
        let masked = mask_email("person@example.invalid");
        assert_eq!(masked, "p***@example.invalid");
        assert!(!masked.contains("person"));
    }

    #[test]
    fn quota_projection_uses_canonical_strings() {
        let view = quota_value(
            &[json!({
                "platform": "openai",
                "monthly_limit_usd": 20.0,
                "monthly_usage_usd": 3.25,
                "monthly_window_resets_at": "2030-01-01T00:00:00Z",
            })],
            "2030-01-01T00:00:00Z",
        );
        assert_eq!(view["remaining"]["value"], "16.75");
        assert_eq!(view["used"]["value"], "3.25");
    }
}
