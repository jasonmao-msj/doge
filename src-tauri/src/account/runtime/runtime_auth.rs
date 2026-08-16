use super::*;
use crate::account::authority::AuthWire;
use crate::account::persistence::AccountMetadata;
use serde_json::{json, Value};
use zeroize::Zeroizing;

impl AccountRuntime {
    pub(super) async fn execute_operation(
        &self,
        state: &mut RuntimeState,
        operation: &str,
        payload: &Value,
        operation_id: Option<&str>,
    ) -> Result<Value, Value> {
        prune_attempts(state);
        if let Some(requirement) = authority_requirement(operation) {
            self.require_authority_capability(state, requirement)
                .await?;
        }
        match operation {
            "gateway.bootstrap" => self.bootstrap(state).await,
            "gateway.reconcileIntent" => self.reconcile_intent(payload),
            "humanVerification.readRequirement" => self.read_human_requirement(state),
            "humanVerification.submitProof" => Err(capability_failure("challenge")),
            "auth.beginRegistration" => self.begin_registration(state, payload).await,
            "auth.resendRegistrationCode" => self.resend_registration(state, payload).await,
            "auth.submitRegistrationCode" => self.submit_registration(state, payload).await,
            "auth.login" => self.login(state, payload).await,
            "auth.verifyMfa" => self.verify_mfa(state, payload).await,
            "auth.startOAuth" => self.start_oauth(state, payload, operation_id).await,
            "auth.completeOAuthAccount" | "profile.startIdentityBinding" => {
                Err(capability_failure("oauth"))
            }
            "auth.cancelOAuth" => self.cancel_oauth(state, payload).await,
            "auth.readOAuthAttempt" => self.read_oauth_attempt(state, payload).await,
            "auth.requestPasswordReset" => self.request_password_reset(payload).await,
            "auth.inspectExternalIntent" | "auth.resetPassword" => Err(capability_failure("reset")),
            "auth.logout" => self.logout(state, payload).await,
            "profile.read" => self.read_profile(state).await,
            "profile.updateProfile" => self.update_profile(state, payload).await,
            "profile.changePassword" => self.change_password(state, payload).await,
            "profile.requestTotpEmailCode"
            | "profile.beginTotpEnrollment"
            | "profile.confirmTotpEnrollment"
            | "profile.disableTotp"
            | "profile.unbindIdentity" => Err(capability_failure("security")),
            "profile.revokeAllSessions" => self.revoke_all(state).await,
            "usage.read" => self.read_usage(state).await,
            "managedKey.readStatus" => self.managed_key_status(state),
            "managedKey.listCandidates" => self.list_api_key_candidates(state).await,
            "managedKey.selectExisting" => {
                self.select_existing_api_key(state, payload, operation_id.unwrap_or_default())
                    .await
            }
            "managedKey.provision" => {
                self.provision_managed_key(state, operation_id.unwrap_or_default())
                    .await
            }
            "managedKey.rotate" => {
                self.rotate_managed_key(state, operation_id.unwrap_or_default())
                    .await
            }
            "managedKey.revoke" => self.revoke_managed_key(state).await,
            "configuration.readOffer" => self.configuration_offer(state),
            "configuration.createPlan" => self.create_configuration_plan(state),
            "configuration.readFileDetail" => self.read_configuration_file(state, payload),
            "configuration.apply" => {
                self.apply_configuration(state, payload, operation_id.unwrap_or_default())
                    .await
            }
            "configuration.readCurrentTask" => self.read_current_configuration(state),
            "configuration.acknowledgeResult" => self.acknowledge_configuration(state, payload),
            "configuration.hardDismiss" => self.hard_dismiss_configuration(state),
            _ => Err(protocol_failure("capabilities")),
        }
    }

    pub(super) async fn bootstrap(&self, state: &mut RuntimeState) -> Result<Value, Value> {
        if self.ensure_public_settings(state).await.is_err() {
            // Public settings are retained only when that fixed-origin request
            // succeeded but descriptor validation failed. In that case the
            // service is reachable while every affected action is explicitly
            // disabled for a missing guarantee.
            let availability = if state.public_settings.is_some() {
                "ready"
            } else {
                "serviceUnavailable"
            };
            return Ok(bootstrap_value(
                state,
                state.public_settings.as_ref(),
                None,
                self.vault.status(),
                availability,
            ));
        }
        if state.access_token.is_none()
            && state
                .metadata
                .as_ref()
                .is_some_and(|metadata| metadata.session_status == "active")
            && self.vault.status() == AccountVaultStatus::Ready
        {
            self.try_restore_session(state).await;
        }
        Ok(bootstrap_value(
            state,
            state.public_settings.as_ref(),
            state.authority_descriptor.as_ref(),
            self.vault.status(),
            "ready",
        ))
    }

    pub(super) async fn refresh_authority_contract(
        &self,
        state: &mut RuntimeState,
    ) -> Result<(), Value> {
        let authority = self.authority_required()?;
        let settings = match authority.public_settings().await {
            Ok(value) => value,
            Err(error) => {
                state.public_settings = None;
                state.authority_descriptor = None;
                state.authority_contract_fetched_at = now_epoch();
                return Err(authority_failure(error, "capabilities"));
            }
        };
        let descriptor = match authority.capability_descriptor().await {
            Ok(value) => value,
            Err(error) => {
                state.public_settings = Some(settings);
                state.authority_descriptor = None;
                state.authority_contract_fetched_at = now_epoch();
                return Err(authority_failure(error, "capabilities"));
            }
        };
        state.public_settings = Some(settings);
        state.authority_descriptor = Some(descriptor);
        state.authority_contract_fetched_at = now_epoch();
        Ok(())
    }

    pub(super) fn reconcile_intent(&self, payload: &Value) -> Result<Value, Value> {
        let intent = required_string(payload, "intent", "login")?;
        let expected = required_string(payload, "expected", "login")?;
        let record = self
            .repository
            .as_ref()
            .ok_or_else(persistence_failure)?
            .read_operation_by_intent(&intent)
            .map_err(|_| persistence_failure())?;
        let Some(record) = record else {
            return Ok(json!({ "status": "pending" }));
        };
        if record.operation != expected {
            return Err(code_failure(
                "protocolMismatch",
                stage_for_operation(&expected),
                "contactSupport",
            ));
        }
        match (record.status.as_str(), record.outcome.as_deref()) {
            ("terminal", Some("outcomeUnknown")) => Ok(json!({
                "status": "outcomeUnknown",
                "operation": record.operation,
            })),
            ("terminal", Some(outcome @ ("succeeded" | "rejected" | "cancelledBeforeSend"))) => {
                Ok(json!({
                    "status": "knownTerminal",
                    "operation": record.operation,
                    "outcome": outcome,
                }))
            }
            _ => Ok(json!({ "status": "pending" })),
        }
    }

    pub(super) async fn initialize_session(&self, state: &mut RuntimeState) {
        if state.initialized {
            return;
        }
        state.initialized = true;
        // Initialization is local-only so Account Convenience can never delay
        // or gate the Local Mode shell. Network restore happens lazily inside
        // gateway.bootstrap after capability/guarantee negotiation.
    }

    pub(super) async fn try_restore_session(&self, state: &mut RuntimeState) {
        let Some(metadata) = state.metadata.as_ref() else {
            return;
        };
        if metadata.session_status != "active" {
            return;
        }
        let Some(scope) = metadata.vault_scope.as_deref() else {
            return;
        };
        let scope = scope.to_string();
        if self
            .ensure_authority_guarantees(
                state,
                &[
                    "durable_token_pair_v1",
                    "atomic_refresh_replay_v1",
                    "stable_account_reasons_v1",
                ],
            )
            .await
            .is_err()
        {
            return;
        }
        let purpose = format!("{REFRESH_PURPOSE_PREFIX}{scope}");
        let Ok(Some(refresh_token)) = self.vault.read(&purpose) else {
            return;
        };
        let Some(authority) = self.authority.as_ref() else {
            return;
        };
        let auth = match authority.refresh(&refresh_token).await {
            Ok(auth) => auth,
            Err(error)
                if matches!(
                    error.safe.code.as_str(),
                    "sessionExpired" | "sessionRevoked"
                ) =>
            {
                let _ = self.clear_local_session(state, false);
                return;
            }
            Err(_) => return,
        };
        if self.activate_auth(state, auth, Some(scope)).await.is_err() {
            let _ = self.clear_local_session(state, false);
        }
    }

    pub(super) fn read_human_requirement(&self, state: &RuntimeState) -> Result<Value, Value> {
        match state.public_settings.as_ref() {
            Some(settings) if settings.requires_human_verification() => Ok(json!({
                "status": "unavailable",
                "reason": "platformUnsupported",
            })),
            _ => Ok(json!({ "status": "notRequired" })),
        }
    }

    pub(super) async fn begin_registration(
        &self,
        state: &mut RuntimeState,
        payload: &Value,
    ) -> Result<Value, Value> {
        let settings = self.ensure_public_settings(state).await?;
        if !settings.registration_enabled || settings.requires_human_verification() {
            return Err(capability_failure("register"));
        }
        if settings.login_agreement_enabled
            && payload.get("agreementAccepted").and_then(Value::as_bool) != Some(true)
        {
            return Err(edit_failure("validationRejected", "register", "agreement"));
        }
        if settings.invitation_code_enabled && optional_string(payload, "invitationCode").is_none()
        {
            return Err(edit_failure("validationRejected", "register", "invitation"));
        }
        if self.vault.status() != AccountVaultStatus::Ready {
            return Err(vault_failure());
        }
        let email = required_email(payload, "email", "register")?;
        let password = required_secret(payload, "password", "register")?;
        if password.len() < 6 {
            return Err(edit_failure("validationRejected", "register", "password"));
        }
        if settings.email_verify_enabled {
            self.authority_required()?
                .send_registration_code(&email)
                .await
                .map_err(|error| authority_failure(error, "register"))?;
            let expires_at = now_epoch().saturating_add(600);
            let attempt = bound_handle(
                "auth-attempt",
                "registration",
                state.account_epoch,
                self.process_generation,
                expires_at,
            );
            state.registration_attempts.insert(
                attempt.clone(),
                RegistrationDraft {
                    email: email.clone(),
                    password: Zeroizing::new(password),
                    invitation_code: optional_string(payload, "invitationCode").map(Zeroizing::new),
                    promo_code: optional_string(payload, "promoCode"),
                    expires_at,
                },
            );
            return Ok(json!({
                "next": "verification",
                "attempt": attempt,
                "emailLabel": mask_email(&email),
                "resendAt": rfc3339_from_epoch(now_epoch().saturating_add(60)),
            }));
        }
        let auth = self
            .authority_required()?
            .register(
                &email,
                &password,
                None,
                optional_string(payload, "invitationCode").as_deref(),
                optional_string(payload, "promoCode").as_deref(),
            )
            .await
            .map_err(|error| authority_failure(error, "register"))?;
        self.activate_auth(state, auth, None).await
    }

    pub(super) async fn resend_registration(
        &self,
        state: &mut RuntimeState,
        payload: &Value,
    ) -> Result<Value, Value> {
        let attempt = required_string(payload, "attempt", "verifyEmail")?;
        let email = state
            .registration_attempts
            .get(&attempt)
            .filter(|draft| draft.expires_at > now_epoch())
            .map(|draft| draft.email.clone())
            .ok_or_else(|| code_failure("verificationExpired", "verifyEmail", "requestNewCode"))?;
        self.authority_required()?
            .send_registration_code(&email)
            .await
            .map_err(|error| authority_failure(error, "verifyEmail"))?;
        Ok(json!({
            "next": "verification",
            "attempt": attempt,
            "emailLabel": mask_email(&email),
            "resendAt": rfc3339_from_epoch(now_epoch().saturating_add(60)),
        }))
    }

    pub(super) async fn submit_registration(
        &self,
        state: &mut RuntimeState,
        payload: &Value,
    ) -> Result<Value, Value> {
        self.require_authority_capability(
            state,
            AuthorityRequirement::new(
                "registration",
                &[
                    "durable_token_pair_v1",
                    "atomic_refresh_replay_v1",
                    "stable_account_reasons_v1",
                ],
            ),
        )
        .await?;
        let attempt = required_string(payload, "attempt", "verifyEmail")?;
        let code = required_secret(payload, "code", "verifyEmail")?;
        let draft = state
            .registration_attempts
            .get(&attempt)
            .filter(|draft| draft.expires_at > now_epoch())
            .ok_or_else(|| code_failure("verificationExpired", "verifyEmail", "requestNewCode"))?;
        let auth = self
            .authority_required()?
            .register(
                &draft.email,
                &draft.password,
                Some(&code),
                draft.invitation_code.as_deref().map(String::as_str),
                draft.promo_code.as_deref(),
            )
            .await
            .map_err(|error| authority_failure(error, "verifyEmail"))?;
        state.registration_attempts.remove(&attempt);
        self.activate_auth(state, auth, None).await
    }

    pub(super) async fn login(
        &self,
        state: &mut RuntimeState,
        payload: &Value,
    ) -> Result<Value, Value> {
        if self.vault.status() != AccountVaultStatus::Ready {
            return Err(vault_failure());
        }
        let settings = self.ensure_public_settings(state).await?;
        if settings.requires_human_verification() {
            return Err(capability_failure("login"));
        }
        let email = required_email(payload, "email", "login")?;
        let password = Zeroizing::new(required_secret(payload, "password", "login")?);
        let login = self
            .authority_required()?
            .login(&email, &password)
            .await
            .map_err(|error| authority_failure(error, "login"))?;
        if login.requires_2fa == Some(true) {
            let temp_token = login
                .temp_token
                .filter(|value| !value.is_empty())
                .ok_or_else(|| protocol_failure("mfa"))?;
            let expires_at = now_epoch().saturating_add(300);
            let attempt = bound_handle(
                "auth-attempt",
                "mfa",
                state.account_epoch,
                self.process_generation,
                expires_at,
            );
            state.mfa_attempts.insert(
                attempt.clone(),
                MfaDraft {
                    token: Zeroizing::new(temp_token),
                    expires_at,
                },
            );
            return Ok(json!({
                "next": "mfa",
                "attempt": attempt,
                "expiresAt": rfc3339_from_epoch(expires_at),
            }));
        }
        let auth = auth_from_login(login)?;
        self.activate_auth(state, auth, None).await
    }

    pub(super) async fn request_password_reset(&self, payload: &Value) -> Result<Value, Value> {
        let email = required_email(payload, "email", "recover")?;
        self.authority_required()?
            .request_password_reset(&email)
            .await
            .map_err(|error| authority_failure(error, "recover"))?;
        Ok(json!({
            "next": "resetRequested",
            "requestAccepted": true,
        }))
    }

    pub(super) async fn verify_mfa(
        &self,
        state: &mut RuntimeState,
        payload: &Value,
    ) -> Result<Value, Value> {
        let attempt = required_string(payload, "attempt", "mfa")?;
        let code = required_secret(payload, "code", "mfa")?;
        let draft = state
            .mfa_attempts
            .get(&attempt)
            .filter(|draft| draft.expires_at > now_epoch())
            .ok_or_else(|| code_failure("mfaExpired", "mfa", "loginAgain"))?;
        let auth = self
            .authority_required()?
            .verify_mfa(&draft.token, &code)
            .await
            .map_err(|error| authority_failure(error, "mfa"))?;
        state.mfa_attempts.remove(&attempt);
        self.activate_auth(state, auth, None).await
    }

    pub(super) async fn activate_auth(
        &self,
        state: &mut RuntimeState,
        auth: AuthWire,
        existing_scope: Option<String>,
    ) -> Result<Value, Value> {
        let refresh_token = auth
            .refresh_token
            .filter(|value| !value.is_empty())
            .ok_or_else(|| capability_failure("vault"))?;
        let access_token = Zeroizing::new(auth.access_token);
        let profile = match auth.user {
            Some(profile) => profile,
            None => self
                .authority_required()?
                .me(&access_token)
                .await
                .map_err(|error| authority_failure(error, "login"))?,
        };
        let account_link_id = account_link_id(&profile)?;
        let device_id = self.device_id.as_deref().ok_or_else(persistence_failure)?;
        let repository = self.repository.as_ref().ok_or_else(persistence_failure)?;
        let binding = repository
            .read_managed_key_binding(AUTHORITY_ORIGIN_ID, &account_link_id, device_id)
            .map_err(|_| persistence_failure())?;
        let same_existing_session = state.metadata.as_ref().is_some_and(|metadata| {
            metadata.authority_origin_id.as_deref() == Some(AUTHORITY_ORIGIN_ID)
                && metadata.account_link_id.as_deref() == Some(account_link_id.as_str())
                && metadata.device_id.as_deref() == Some(device_id)
        });
        let scope = existing_scope
            .filter(|_| same_existing_session)
            .or_else(|| binding.as_ref().map(|value| value.vault_scope.clone()))
            .unwrap_or_else(|| Uuid::new_v4().simple().to_string());
        let refresh_purpose = format!("{REFRESH_PURPOSE_PREFIX}{scope}");
        let previous_refresh = self
            .vault
            .read(&refresh_purpose)
            .map_err(|_| vault_failure())?;
        self.vault
            .write(&refresh_purpose, &refresh_token)
            .map_err(|_| vault_failure())?;
        let metadata = AccountMetadata {
            authority_origin_id: Some(AUTHORITY_ORIGIN_ID.to_string()),
            account_link_id: Some(account_link_id),
            device_id: Some(device_id.to_string()),
            account_epoch: state.account_epoch,
            profile_label: profile_label(Some(&profile)),
            primary_email_label: profile_email_label(Some(&profile)),
            session_status: "active".to_string(),
            vault_scope: Some(scope),
            managed_key_id: binding.map(|value| value.managed_key_id),
            updated_at: rfc3339_now(),
        };
        if repository.save_session(&metadata).is_err() {
            if let Some(previous_refresh) = previous_refresh {
                let _ = self.vault.write(&refresh_purpose, &previous_refresh);
            } else {
                let _ = self.vault.delete(&refresh_purpose);
            }
            return Err(persistence_failure());
        }
        state.access_token = Some(access_token);
        state.access_expires_at = now_epoch().saturating_add(auth.expires_in.unwrap_or(900) as i64);
        state.profile = Some(profile);
        state.metadata = Some(metadata);
        state.api_key_candidates.clear();
        Ok(json!({
            "next": "authenticated",
            "session": session_value(state),
        }))
    }

    pub(super) async fn logout(
        &self,
        state: &mut RuntimeState,
        payload: &Value,
    ) -> Result<Value, Value> {
        let scope = optional_string(payload, "scope").unwrap_or_else(|| "thisDevice".to_string());
        let refresh = state
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.vault_scope.as_deref())
            .and_then(|vault_scope| {
                self.vault
                    .read(&format!("{REFRESH_PURPOSE_PREFIX}{vault_scope}"))
                    .ok()
                    .flatten()
            })
            .map(Zeroizing::new);
        let access = state
            .access_token
            .as_ref()
            .filter(|_| state.access_expires_at > now_epoch())
            .map(|value| Zeroizing::new(value.to_string()));
        let descriptor = state.authority_descriptor.as_ref();
        let may_logout_one = descriptor.is_some_and(|value| {
            value.has_guarantees(&["typed_logout_outcome_v1", "stable_account_reasons_v1"])
        });
        let may_revoke_all = descriptor.is_some_and(|value| {
            value.supports(
                "revokeAllSessions",
                &[
                    "durable_revocation_generation_v1",
                    "typed_logout_outcome_v1",
                    "stable_account_reasons_v1",
                ],
            )
        });
        // Account-session revocation and the separately managed Codex API key
        // have different lifecycles. Keep the latter usable in Local Mode until
        // the user explicitly revokes or rotates that key.
        self.clear_local_session(state, false)?;
        // Local sign-out is the terminal user action and never waits on the
        // network. When a previously validated descriptor permits the remote
        // operation, dispatch a bounded best-effort cleanup without changing
        // the truthful `unconfirmed` receipt returned below.
        if let Some(authority) = self.authority.as_ref().cloned() {
            if scope == "allSessions" && may_revoke_all {
                if let Some(access) = access {
                    tokio::spawn(async move {
                        let _ = authority.revoke_all(&access).await;
                    });
                }
            } else if scope != "allSessions" && may_logout_one {
                if let Some(refresh) = refresh {
                    tokio::spawn(async move {
                        let _ = authority.logout(&refresh).await;
                    });
                }
            }
        }
        Ok(json!({
            "localSessionCleared": true,
            // The current adapter intentionally does not project a bare 2xx as
            // typed revocation truth. A future target-envelope parser may
            // promote this only after validating the closed outcome schema.
            "remoteRevocation": "unconfirmed",
        }))
    }

    pub(super) async fn revoke_all(&self, state: &mut RuntimeState) -> Result<Value, Value> {
        let access = self.authorized_access_token(state).await?;
        let _ = self.authority_required()?.revoke_all(&access).await;
        self.clear_local_session(state, false)?;
        Ok(json!({
            // A bare HTTP success is not the typed, durable revocation receipt
            // required to claim confirmation.
            "remoteRevocation": "outcomeUnknown",
        }))
    }

    pub(super) fn clear_local_session(
        &self,
        state: &mut RuntimeState,
        clear_managed_key: bool,
    ) -> Result<(), Value> {
        let previous_scope = state
            .metadata
            .as_ref()
            .and_then(|metadata| metadata.vault_scope.clone());
        if let Some(repository) = &self.repository {
            if clear_managed_key {
                repository.clear_session(&rfc3339_now())
            } else {
                repository.clear_session_preserving_managed_key(&rfc3339_now())
            }
            .map_err(|_| persistence_failure())?;
            state.metadata = repository.read_session().ok().flatten();
            if let Some(metadata) = state.metadata.as_mut() {
                state.account_epoch = metadata.account_epoch;
            }
        } else {
            return Err(persistence_failure());
        }
        state.access_token = None;
        state.profile = None;
        state.configuration_plan = None;
        state.configuration_result = None;
        state.api_key_candidates.clear();
        // SQLite is the authority for whether a local account session exists.
        // Vault cleanup follows the durable signed-out commit. A transient
        // Keychain failure can leave only an unreachable stale credential; it
        // must not resurrect a session or leave renderer state half signed-out.
        if let Some(scope) = previous_scope {
            let _ = self
                .vault
                .delete(&format!("{REFRESH_PURPOSE_PREFIX}{scope}"));
            if clear_managed_key {
                let _ = self
                    .vault
                    .delete(&format!("{MANAGED_KEY_PURPOSE_PREFIX}{scope}"));
            }
        }
        Ok(())
    }

    pub(super) async fn authorized_access_token(
        &self,
        state: &mut RuntimeState,
    ) -> Result<Zeroizing<String>, Value> {
        if let Some(access) = state
            .access_token
            .as_ref()
            .filter(|_| state.access_expires_at > now_epoch().saturating_add(30))
        {
            return Ok(Zeroizing::new(access.to_string()));
        }
        self.ensure_authority_guarantees(
            state,
            &[
                "durable_token_pair_v1",
                "atomic_refresh_replay_v1",
                "stable_account_reasons_v1",
            ],
        )
        .await?;
        let metadata = state
            .metadata
            .as_ref()
            .filter(|metadata| metadata.session_status == "active")
            .ok_or_else(session_failure)?;
        let scope = metadata
            .vault_scope
            .as_deref()
            .ok_or_else(session_failure)?;
        let refresh = self
            .vault
            .read(&format!("{REFRESH_PURPOSE_PREFIX}{scope}"))
            .map_err(|_| vault_failure())?
            .ok_or_else(session_failure)?;
        let auth = self
            .authority_required()?
            .refresh(&refresh)
            .await
            .map_err(|error| authority_failure(error, "refresh"))?;
        let access = Zeroizing::new(auth.access_token.clone());
        self.activate_auth(state, auth, Some(scope.to_string()))
            .await?;
        Ok(access)
    }

    pub(super) async fn read_profile(&self, state: &mut RuntimeState) -> Result<Value, Value> {
        let access = self.authorized_access_token(state).await?;
        let profile = self
            .authority_required()?
            .profile(&access)
            .await
            .map_err(|error| authority_failure(error, "profile"))?;
        state.profile = Some(profile.clone());
        Ok(account_center_value(state, &profile))
    }

    pub(super) async fn update_profile(
        &self,
        state: &mut RuntimeState,
        payload: &Value,
    ) -> Result<Value, Value> {
        let display_name = required_string(payload, "displayName", "profile")?;
        if display_name.chars().count() > 80 {
            return Err(edit_failure("validationRejected", "profile", "displayName"));
        }
        let access = self.authorized_access_token(state).await?;
        let profile = self
            .authority_required()?
            .update_profile(&access, &display_name)
            .await
            .map_err(|error| authority_failure(error, "profile"))?;
        state.profile = Some(profile.clone());
        if let Some(metadata) = state.metadata.as_mut() {
            metadata.profile_label = profile_label(Some(&profile));
            metadata.primary_email_label = profile_email_label(Some(&profile));
            metadata.updated_at = rfc3339_now();
            self.repository
                .as_ref()
                .ok_or_else(persistence_failure)?
                .save_session(metadata)
                .map_err(|_| persistence_failure())?;
        }
        Ok(account_center_value(state, &profile))
    }

    pub(super) async fn change_password(
        &self,
        state: &mut RuntimeState,
        payload: &Value,
    ) -> Result<Value, Value> {
        let current_password =
            Zeroizing::new(required_secret(payload, "currentPassword", "security")?);
        let new_password = Zeroizing::new(required_secret(payload, "newPassword", "security")?);
        if new_password.chars().count() < 6 {
            return Err(edit_failure("validationRejected", "security", "password"));
        }
        let access = self.authorized_access_token(state).await?;
        self.authority_required()?
            .change_password(&access, &current_password, &new_password)
            .await
            .map_err(|error| authority_failure(error, "security"))?;
        self.clear_local_session(state, false)?;
        Ok(json!({ "changed": true }))
    }

    pub(super) async fn read_usage(&self, state: &mut RuntimeState) -> Result<Value, Value> {
        let access = self.authorized_access_token(state).await?;
        let fetched_at = rfc3339_now();
        let quota = self
            .authority_required()?
            .quota(&access)
            .await
            .map_err(|error| authority_failure(error, "usage"))?;
        Ok(quota_value(&quota.platform_quotas, &fetched_at))
    }

    pub(super) fn managed_key_status(&self, state: &RuntimeState) -> Result<Value, Value> {
        let Some(scope) = managed_vault_scope(state) else {
            return Ok(json!({ "status": "absent" }));
        };
        match self
            .vault
            .read(&format!("{MANAGED_KEY_PURPOSE_PREFIX}{scope}"))
        {
            Ok(Some(value)) if !value.is_empty() => Ok(json!({
                "status": "ready",
                "recipeId": ACCOUNT_RECIPE_ID,
                "recipeVersion": 1,
            })),
            Ok(_) => Ok(json!({ "status": "absent" })),
            Err(_) => Ok(json!({ "status": "unavailable", "reason": "vaultUnavailable" })),
        }
    }
}
