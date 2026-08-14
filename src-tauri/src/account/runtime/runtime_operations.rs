use super::*;
use crate::account::authority::ApiKeyWire;
use crate::account::configuration::{self, ApplyError};
use crate::account::persistence::ManagedKeyBinding;
use serde_json::{json, Value};

impl AccountRuntime {
    pub(super) async fn list_api_key_candidates(
        &self,
        state: &mut RuntimeState,
    ) -> Result<Value, Value> {
        let access = self.authorized_access_token(state).await?;
        let candidates = self
            .authority_required()?
            .list_api_key_candidates(&access)
            .await
            .map_err(|error| authority_failure(error, "managedKey"))?;
        let now = now_epoch();
        let expires_at = now.saturating_add(300);
        state.api_key_candidates.clear();
        let mut safe_candidates = Vec::new();
        for candidate in candidates.keys.into_iter().take(100) {
            if candidate.id <= 0 {
                continue;
            }
            let status = match candidate.status.as_str() {
                "active" => "active",
                "disabled" => "disabled",
                "expired" => "expired",
                _ => continue,
            };
            let availability = match candidate.availability.as_str() {
                "selectable" => "selectable",
                "handoffUnavailable" => "handoffUnavailable",
                _ => continue,
            };
            let handle = bound_handle(
                "api-key-candidate",
                "codex-api-key",
                state.account_epoch,
                self.process_generation,
                expires_at,
            );
            if availability == "selectable" && status == "active" {
                state.api_key_candidates.insert(
                    handle.clone(),
                    ApiKeyCandidateBinding {
                        key_id: candidate.id,
                        expires_at,
                    },
                );
            }
            safe_candidates.push(json!({
                "key": handle,
                "name": safe_api_key_name(&candidate.name),
                "maskedPrefix": masked_api_key_prefix(&candidate.key_prefix),
                "status": status,
                "availability": availability,
            }));
        }
        Ok(json!({
            "keys": safe_candidates,
            "fetchedAt": rfc3339_now(),
        }))
    }

    pub(super) async fn select_existing_api_key(
        &self,
        state: &mut RuntimeState,
        payload: &Value,
        operation_id: &str,
    ) -> Result<Value, Value> {
        let handle = required_string(payload, "key", "managedKey")?;
        let now = now_epoch();
        state
            .api_key_candidates
            .retain(|_, candidate| candidate.expires_at > now);
        let candidate = state
            .api_key_candidates
            .get(&handle)
            .cloned()
            .ok_or_else(|| code_failure("staleHandle", "managedKey", "retry"))?;
        let access = self.authorized_access_token(state).await?;
        let scope = active_vault_scope(state)
            .ok_or_else(session_failure)?
            .to_string();
        let device_id = self.device_id.as_deref().ok_or_else(persistence_failure)?;
        let handed_off = self
            .authority_required()?
            .handoff_api_key(&access, candidate.key_id, device_id, operation_id)
            .await
            .map_err(|error| authority_failure(error, "managedKey"))?;
        if handed_off.id != candidate.key_id || handed_off.secret.trim().is_empty() {
            return Err(protocol_failure("managedKey"));
        }
        self.persist_managed_key(state, &scope, handed_off, &access, false)
            .await?;
        state.api_key_candidates.clear();
        self.managed_key_status(state)
    }

    pub(super) async fn provision_managed_key(
        &self,
        state: &mut RuntimeState,
        operation_id: &str,
    ) -> Result<Value, Value> {
        if matches!(self.managed_key_status(state), Ok(value) if value.get("status") == Some(&Value::String("ready".to_string())))
        {
            return self.managed_key_status(state);
        }
        let access = self.authorized_access_token(state).await?;
        let scope = active_vault_scope(state)
            .ok_or_else(session_failure)?
            .to_string();
        let created = self
            .authority_required()?
            .create_managed_key(&access, operation_id)
            .await
            .map_err(|error| authority_failure(error, "managedKey"))?;
        self.persist_managed_key(state, &scope, created, &access, true)
            .await?;
        self.managed_key_status(state)
    }

    pub(super) async fn persist_managed_key(
        &self,
        state: &mut RuntimeState,
        scope: &str,
        created: ApiKeyWire,
        access: &str,
        delete_remote_on_failure: bool,
    ) -> Result<(), Value> {
        let purpose = format!("{MANAGED_KEY_PURPOSE_PREFIX}{scope}");
        let previous_secret = self.vault.read(&purpose).map_err(|_| vault_failure())?;
        if self.vault.write(&purpose, &created.secret).is_err() {
            if delete_remote_on_failure {
                let _ = self
                    .authority_required()?
                    .delete_managed_key(access, created.id)
                    .await;
            }
            return Err(vault_failure());
        }
        let mut metadata = state.metadata.clone().ok_or_else(session_failure)?;
        let authority_origin_id = metadata
            .authority_origin_id
            .as_deref()
            .ok_or_else(session_failure)?;
        let account_link_id = metadata
            .account_link_id
            .as_deref()
            .ok_or_else(session_failure)?;
        let device_id = metadata.device_id.as_deref().ok_or_else(session_failure)?;
        metadata.managed_key_id = Some(created.id);
        metadata.updated_at = rfc3339_now();
        let Some(repository) = &self.repository else {
            return Err(persistence_failure());
        };
        let binding = ManagedKeyBinding {
            authority_origin_id: authority_origin_id.to_string(),
            account_link_id: account_link_id.to_string(),
            device_id: device_id.to_string(),
            vault_scope: scope.to_string(),
            managed_key_id: created.id,
        };
        if repository
            .save_managed_key_state(&binding, &metadata, now_epoch())
            .is_err()
        {
            if let Some(previous_secret) = previous_secret {
                let _ = self.vault.write(&purpose, &previous_secret);
            } else {
                let _ = self.vault.delete(&purpose);
            }
            if delete_remote_on_failure {
                let _ = self
                    .authority_required()?
                    .delete_managed_key(access, created.id)
                    .await;
            }
            return Err(persistence_failure());
        }
        state.metadata = Some(metadata);
        Ok(())
    }

    pub(super) async fn rotate_managed_key(
        &self,
        state: &mut RuntimeState,
        operation_id: &str,
    ) -> Result<Value, Value> {
        let old_id = state
            .metadata
            .as_ref()
            .and_then(|value| value.managed_key_id);
        let access = self.authorized_access_token(state).await?;
        let scope = active_vault_scope(state)
            .ok_or_else(session_failure)?
            .to_string();
        let created = self
            .authority_required()?
            .create_managed_key(&access, operation_id)
            .await
            .map_err(|error| authority_failure(error, "managedKey"))?;
        self.persist_managed_key(state, &scope, created, &access, true)
            .await?;
        if let Some(old_id) = old_id {
            let _ = self
                .authority_required()?
                .delete_managed_key(&access, old_id)
                .await;
        }
        self.managed_key_status(state)
    }

    pub(super) async fn revoke_managed_key(
        &self,
        state: &mut RuntimeState,
    ) -> Result<Value, Value> {
        let Some(metadata) = state.metadata.as_mut() else {
            return Err(session_failure());
        };
        let scope = metadata.vault_scope.clone().ok_or_else(session_failure)?;
        self.vault
            .delete(&format!("{MANAGED_KEY_PURPOSE_PREFIX}{scope}"))
            .map_err(|_| vault_failure())?;
        metadata.managed_key_id = None;
        metadata.updated_at = rfc3339_now();
        if let Some(repository) = &self.repository {
            let authority_origin_id = metadata
                .authority_origin_id
                .as_deref()
                .ok_or_else(session_failure)?;
            let account_link_id = metadata
                .account_link_id
                .as_deref()
                .ok_or_else(session_failure)?;
            let device_id = metadata.device_id.as_deref().ok_or_else(session_failure)?;
            repository
                .delete_managed_key_binding(authority_origin_id, account_link_id, device_id)
                .map_err(|_| persistence_failure())?;
            repository
                .save_session(metadata)
                .map_err(|_| persistence_failure())?;
        }
        Ok(json!({ "status": "absent" }))
    }

    pub(super) fn configuration_offer(&self, state: &RuntimeState) -> Result<Value, Value> {
        if !is_authenticated(state) {
            return Ok(json!({ "status": "notEligible", "reason": "notAuthenticated" }));
        }
        if self.vault.status() != AccountVaultStatus::Ready {
            return Ok(json!({ "status": "notEligible", "reason": "capabilityUnavailable" }));
        }
        if let Some(metadata) = state.metadata.as_ref() {
            if let (Some(authority_origin_id), Some(account_link_id), Some(device_id)) = (
                metadata.authority_origin_id.as_deref(),
                metadata.account_link_id.as_deref(),
                metadata.device_id.as_deref(),
            ) {
                if self
                    .repository
                    .as_ref()
                    .and_then(|repository| {
                        repository
                            .is_dismissed(authority_origin_id, account_link_id, device_id)
                            .ok()
                    })
                    .unwrap_or(false)
                {
                    return Ok(json!({ "status": "none" }));
                }
            }
        }
        Ok(json!({
            "status": "available",
            "recipeId": ACCOUNT_RECIPE_ID,
            "recipeVersion": 1,
            "targetLabel": "Codex",
            "recommendation": "configure",
        }))
    }

    pub(super) fn create_configuration_plan(
        &self,
        state: &mut RuntimeState,
    ) -> Result<Value, Value> {
        if !is_authenticated(state) {
            return Err(session_failure());
        }
        if !matches!(
            self.managed_key_status(state),
            Ok(value) if value.get("status") == Some(&Value::String("ready".to_string()))
        ) {
            return Err(code_failure("managedKeyUnavailable", "managedKey", "retry"));
        }
        let (plan, view) =
            configuration::create_plan(state.account_epoch, self.process_generation, now_epoch())
                .map_err(|_| code_failure("unsafeTarget", "configurationPlan", "reviewFiles"))?;
        state.configuration_plan = Some(plan);
        state.configuration_result = None;
        Ok(view)
    }

    pub(super) fn read_configuration_file(
        &self,
        state: &RuntimeState,
        payload: &Value,
    ) -> Result<Value, Value> {
        let plan_handle = required_string(payload, "plan", "configurationPlan")?;
        let file_handle = required_string(payload, "file", "configurationPlan")?;
        let plan = state
            .configuration_plan
            .as_ref()
            .ok_or_else(stale_plan_failure)?;
        configuration::read_file_detail(plan, &plan_handle, &file_handle, now_epoch())
            .map_err(|_| stale_plan_failure())
    }

    pub(super) async fn apply_configuration(
        &self,
        state: &mut RuntimeState,
        payload: &Value,
        _operation_id: &str,
    ) -> Result<Value, Value> {
        let plan_handle = required_string(payload, "plan", "configurationApply")?;
        if payload.get("consent").and_then(Value::as_str) != Some("applyExactPlan") {
            return Err(code_failure(
                "validationRejected",
                "configurationApply",
                "reviewFiles",
            ));
        }
        let plan = state
            .configuration_plan
            .as_ref()
            .ok_or_else(stale_plan_failure)?;
        configuration::preflight_plan(plan, &plan_handle, now_epoch()).map_err(
            |error| match error {
                ApplyError::ConcurrentEdit => {
                    code_failure("concurrentEdit", "configurationApply", "replan")
                }
                ApplyError::RollbackIncomplete => {
                    code_failure("rollbackIncomplete", "configurationApply", "reviewFiles")
                }
                ApplyError::Rejected(_) => {
                    code_failure("permissionDenied", "configurationApply", "reviewFiles")
                }
            },
        )?;
        if !matches!(
            self.managed_key_status(state),
            Ok(value) if value.get("status") == Some(&Value::String("ready".to_string()))
        ) {
            return Err(code_failure("managedKeyUnavailable", "managedKey", "retry"));
        }
        let plan = state
            .configuration_plan
            .as_ref()
            .ok_or_else(stale_plan_failure)?;
        let apply = configuration::apply_plan(
            plan,
            &plan_handle,
            state.account_epoch,
            self.process_generation,
            now_epoch(),
        );
        let result = match apply {
            Ok(result) => result,
            Err(error) => {
                return Err(match error {
                    ApplyError::ConcurrentEdit => {
                        code_failure("concurrentEdit", "configurationApply", "replan")
                    }
                    ApplyError::RollbackIncomplete => {
                        code_failure("rollbackIncomplete", "configurationApply", "reviewFiles")
                    }
                    ApplyError::Rejected(_) => {
                        code_failure("permissionDenied", "configurationApply", "reviewFiles")
                    }
                });
            }
        };
        let metadata = state.metadata.as_ref().ok_or_else(session_failure)?;
        let account_link_id = metadata
            .account_link_id
            .as_deref()
            .ok_or_else(session_failure)?;
        let device_id = metadata.device_id.as_deref().ok_or_else(session_failure)?;
        self.repository
            .as_ref()
            .ok_or_else(persistence_failure)?
            .save_configuration_result(
                account_link_id,
                device_id,
                &result,
                result.get("overall") == Some(&Value::String("rollbackIncomplete".to_string())),
                now_epoch(),
            )
            .map_err(|_| persistence_failure())?;
        configuration::commit_completed_transactions().map_err(|_| persistence_failure())?;
        state.configuration_result = Some(result.clone());
        state.configuration_plan = None;
        Ok(result)
    }

    pub(super) fn read_current_configuration(
        &self,
        state: &mut RuntimeState,
    ) -> Result<Value, Value> {
        if let Some(result) = state.configuration_result.as_ref() {
            return Ok(result.clone());
        }
        if let Some(plan) = state.configuration_plan.as_ref() {
            if let Some(view) = configuration::current_plan_view(plan, now_epoch()) {
                return Ok(view);
            }
            state.configuration_plan = None;
        }
        if let Some(metadata) = state.metadata.as_ref() {
            if let (Some(account_link_id), Some(device_id)) = (
                metadata.account_link_id.as_deref(),
                metadata.device_id.as_deref(),
            ) {
                if let Some(result) = self
                    .repository
                    .as_ref()
                    .ok_or_else(persistence_failure)?
                    .read_configuration_result(account_link_id, device_id)
                    .map_err(|_| persistence_failure())?
                {
                    let result = configuration::rebind_result_handle(
                        result,
                        state.account_epoch,
                        self.process_generation,
                        now_epoch(),
                    )
                    .map_err(|_| persistence_failure())?;
                    self.repository
                        .as_ref()
                        .ok_or_else(persistence_failure)?
                        .save_configuration_result(
                            account_link_id,
                            device_id,
                            &result,
                            result.get("overall")
                                == Some(&Value::String("rollbackIncomplete".to_string())),
                            now_epoch(),
                        )
                        .map_err(|_| persistence_failure())?;
                    state.configuration_result = Some(result.clone());
                    return Ok(result);
                }
            }
        }
        self.configuration_offer(state)
    }

    pub(super) fn acknowledge_configuration(
        &self,
        state: &mut RuntimeState,
        payload: &Value,
    ) -> Result<Value, Value> {
        let result_handle = required_string(payload, "result", "configurationApply")?;
        self.repository
            .as_ref()
            .ok_or_else(persistence_failure)?
            .acknowledge_configuration_result(&result_handle)
            .map_err(|_| stale_plan_failure())?;
        if let Some(result) = state.configuration_result.as_mut() {
            if let Some(object) = result.as_object_mut() {
                object.insert("acknowledged".to_string(), Value::Bool(true));
            }
        }
        Ok(json!({ "acknowledged": true }))
    }

    pub(super) fn hard_dismiss_configuration(
        &self,
        state: &mut RuntimeState,
    ) -> Result<Value, Value> {
        let metadata = state.metadata.as_ref().ok_or_else(session_failure)?;
        let authority_origin_id = metadata
            .authority_origin_id
            .as_deref()
            .ok_or_else(session_failure)?;
        let account_link_id = metadata
            .account_link_id
            .as_deref()
            .ok_or_else(session_failure)?;
        let device_id = metadata.device_id.as_deref().ok_or_else(session_failure)?;
        if let Some(repository) = &self.repository {
            repository
                .set_dismissed(
                    authority_origin_id,
                    account_link_id,
                    device_id,
                    true,
                    &rfc3339_now(),
                )
                .map_err(|_| persistence_failure())?;
            repository
                .clear_configuration_result()
                .map_err(|_| persistence_failure())?;
        } else {
            return Err(persistence_failure());
        }
        state.configuration_plan = None;
        state.configuration_result = None;
        Ok(json!({ "dismissed": true }))
    }

    pub(super) async fn ensure_public_settings<'a>(
        &'a self,
        state: &'a mut RuntimeState,
    ) -> Result<&'a PublicSettingsWire, Value> {
        if state.public_settings.is_none()
            || state.authority_contract_fetched_at < now_epoch().saturating_sub(60)
        {
            self.refresh_authority_contract(state).await?;
        }
        if state.authority_descriptor.is_none() {
            return Err(capability_failure("capabilities"));
        }
        state
            .public_settings
            .as_ref()
            .ok_or_else(|| protocol_failure("capabilities"))
    }

    pub(super) async fn require_authority_capability(
        &self,
        state: &mut RuntimeState,
        requirement: AuthorityRequirement,
    ) -> Result<(), Value> {
        self.ensure_public_settings(state).await?;
        if state
            .authority_descriptor
            .as_ref()
            .is_some_and(|descriptor| {
                descriptor.supports(requirement.capability, requirement.guarantees)
            })
        {
            Ok(())
        } else {
            Err(capability_failure("capabilities"))
        }
    }

    pub(super) async fn ensure_authority_guarantees(
        &self,
        state: &mut RuntimeState,
        guarantees: &[&str],
    ) -> Result<(), Value> {
        self.ensure_public_settings(state).await?;
        if state
            .authority_descriptor
            .as_ref()
            .is_some_and(|descriptor| descriptor.has_guarantees(guarantees))
        {
            Ok(())
        } else {
            Err(capability_failure("capabilities"))
        }
    }

    pub(super) fn authority_required(&self) -> Result<&TokenMatrixAuthority, Value> {
        self.authority
            .as_ref()
            .ok_or_else(|| service_failure("capabilities"))
    }
}

fn safe_api_key_name(value: &str) -> String {
    let trimmed = value.trim();
    let valid = !trimmed.is_empty()
        && trimmed.chars().count() <= 80
        && trimmed.chars().all(|character| {
            character.is_alphanumeric()
                || matches!(
                    character,
                    ' ' | '.' | '_' | '(' | ')' | '/' | ':' | '+' | '-'
                )
        });
    if valid {
        trimmed.to_string()
    } else {
        "API Key".to_string()
    }
}

fn masked_api_key_prefix(value: &str) -> String {
    let suffix: String = value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    if suffix.is_empty() {
        "Key".to_string()
    } else {
        format!("Key {}", suffix.to_ascii_uppercase())
    }
}
