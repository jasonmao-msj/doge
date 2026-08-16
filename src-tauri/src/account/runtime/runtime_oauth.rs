use super::*;
use crate::account::authority::TOKEN_MATRIX_ORIGIN;
use crate::account::desktop_continuation::{DesktopContinuationPurpose, DesktopContinuationStatus};
use serde_json::{json, Value};

const DESKTOP_OAUTH_GUARANTEES: &[&str] = &[
    "desktop_oauth_ticket_v1",
    "durable_token_pair_v1",
    "atomic_refresh_replay_v1",
    "stable_account_reasons_v1",
];

impl AccountRuntime {
    pub(super) async fn start_oauth(
        &self,
        state: &mut RuntimeState,
        payload: &Value,
        operation_id: Option<&str>,
    ) -> Result<Value, Value> {
        let provider = required_string(payload, "provider", "oauth")?;
        let provider_spec =
            oauth_provider_spec(&provider).ok_or_else(|| capability_failure("oauth"))?;
        self.require_authority_capability(
            state,
            AuthorityRequirement::new(provider_spec.capability, DESKTOP_OAUTH_GUARANTEES),
        )
        .await?;
        let device_id = self.device_id.as_deref().ok_or_else(persistence_failure)?;
        let operation_id = operation_id
            .filter(|value| !value.is_empty())
            .ok_or_else(|| protocol_failure("oauth"))?;
        let start = self
            .desktop_continuations
            .begin_loopback(
                DesktopContinuationPurpose::OAuth,
                TOKEN_MATRIX_ORIGIN,
                "doge-desktop",
                device_id,
                state.account_epoch,
                self.process_generation,
                now_epoch(),
                300,
            )
            .await
            .map_err(desktop_continuation_failure)?;
        let remote = match self
            .authority_required()?
            .begin_desktop_oauth(
                provider_spec.authority_name,
                "login",
                &start.callback_uri,
                &start.pkce_challenge,
                &start.state,
                &start.nonce,
                device_id,
                operation_id,
            )
            .await
        {
            Ok(value) => value,
            Err(error) => {
                self.cancel_oauth_listener(&start.handle, state).await;
                return Err(authority_failure(error, "oauth"));
            }
        };
        if !valid_remote_authorization_id(&remote.authorization_id) {
            self.cancel_oauth_listener(&start.handle, state).await;
            return Err(protocol_failure("oauth"));
        }
        let remote_expires_at = match parse_rfc3339_epoch(&remote.expires_at) {
            Ok(value) => value,
            Err(error) => {
                self.cancel_oauth_listener(&start.handle, state).await;
                return Err(error);
            }
        };
        if remote_expires_at <= now_epoch()
            || remote_expires_at > start.expires_at()
            || !valid_authorize_url(&remote.authorize_url, provider_spec.authorize_host)
        {
            self.cancel_oauth_listener(&start.handle, state).await;
            return Err(protocol_failure("oauth"));
        }
        let flow_digest = external_flow_handle_digest(&start.handle);
        if self
            .repository
            .as_ref()
            .ok_or_else(persistence_failure)?
            .save_external_flow(&ExternalFlowRecord {
                handle_digest: flow_digest,
                purpose: "oauth".to_string(),
                state_class: "waiting".to_string(),
                account_epoch: state.account_epoch,
                process_generation: self.process_generation,
                status: "pending".to_string(),
                expires_at: remote_expires_at,
                updated_at: now_epoch(),
            })
            .is_err()
        {
            self.cancel_oauth_listener(&start.handle, state).await;
            return Err(persistence_failure());
        }
        if let Err(error) = self
            .desktop_continuations
            .is_waiting(
                &start.handle,
                DesktopContinuationPurpose::OAuth,
                TOKEN_MATRIX_ORIGIN,
                "doge-desktop",
                device_id,
                state.account_epoch,
                self.process_generation,
                now_epoch(),
            )
            .await
        {
            let _ = self.settle_oauth_flow(&start.handle, "terminal", "cancelled");
            return Err(desktop_continuation_failure(error));
        }
        if tauri_plugin_opener::open_url(&remote.authorize_url, None::<&str>).is_err() {
            self.cancel_oauth_listener(&start.handle, state).await;
            let _ = self.settle_oauth_flow(&start.handle, "terminal", "cancelled");
            return Err(service_failure("oauth"));
        }
        state.desktop_authorizations.insert(
            start.handle.clone(),
            DesktopAuthorizationBinding {
                authorization_id: remote.authorization_id,
                exchange_operation_id: format!("operation_{}", Uuid::new_v4().simple()),
                provider: provider.clone(),
                expires_at: remote_expires_at,
            },
        );
        Ok(json!({
            "next": "oauthWaiting",
            "attempt": start.handle,
            "providerLabel": provider_spec.label,
            "expiresAt": rfc3339_from_epoch(remote_expires_at),
        }))
    }

    pub(super) async fn cancel_oauth(
        &self,
        state: &mut RuntimeState,
        payload: &Value,
    ) -> Result<Value, Value> {
        let handle = required_string(payload, "attempt", "oauth")?;
        self.desktop_continuations
            .cancel(&handle, state.account_epoch, self.process_generation)
            .await
            .map_err(desktop_continuation_failure)?;
        self.settle_oauth_flow(&handle, "terminal", "cancelled")?;
        state.desktop_authorizations.remove(&handle);
        Ok(json!({ "cancelled": true }))
    }

    pub(super) async fn read_oauth_attempt(
        &self,
        state: &mut RuntimeState,
        payload: &Value,
    ) -> Result<Value, Value> {
        let handle = required_string(payload, "attempt", "oauth")?;
        let Some(binding) = state.desktop_authorizations.get(&handle).cloned() else {
            return self.recover_settled_oauth_attempt(state, &handle);
        };
        if oauth_provider_spec(&binding.provider).is_none() {
            return Err(protocol_failure("oauth"));
        }
        let status = self
            .desktop_continuations
            .read(
                &handle,
                state.account_epoch,
                self.process_generation,
                now_epoch(),
            )
            .await
            .map_err(desktop_continuation_failure)?;
        match status {
            DesktopContinuationStatus::Waiting => Ok(json!({
                "status": "waiting",
                "attempt": handle,
                "expiresAt": rfc3339_from_epoch(binding.expires_at),
            })),
            DesktopContinuationStatus::Returned => {
                self.settle_oauth_flow(&handle, "returned", "pending")?;
                self.exchange_oauth_attempt(state, &handle, binding).await
            }
            DesktopContinuationStatus::Denied => {
                self.settle_oauth_flow(&handle, "terminal", "cancelled")?;
                state.desktop_authorizations.remove(&handle);
                Ok(json!({ "status": "denied" }))
            }
            DesktopContinuationStatus::Cancelled => {
                self.settle_oauth_flow(&handle, "terminal", "cancelled")?;
                state.desktop_authorizations.remove(&handle);
                Ok(json!({ "status": "cancelled" }))
            }
            DesktopContinuationStatus::Expired => {
                self.settle_oauth_flow(&handle, "terminal", "expired")?;
                state.desktop_authorizations.remove(&handle);
                Ok(json!({ "status": "expired" }))
            }
            DesktopContinuationStatus::StateMismatch => {
                self.settle_oauth_flow(&handle, "terminal", "cancelled")?;
                state.desktop_authorizations.remove(&handle);
                Err(code_failure("oauthStateMismatch", "oauth", "loginAgain"))
            }
            DesktopContinuationStatus::ProtocolRejected => {
                self.settle_oauth_flow(&handle, "terminal", "cancelled")?;
                state.desktop_authorizations.remove(&handle);
                Err(protocol_failure("oauth"))
            }
            DesktopContinuationStatus::Consumed => {
                state.desktop_authorizations.remove(&handle);
                self.recover_settled_oauth_attempt(state, &handle)
            }
        }
    }

    async fn exchange_oauth_attempt(
        &self,
        state: &mut RuntimeState,
        handle: &str,
        binding: DesktopAuthorizationBinding,
    ) -> Result<Value, Value> {
        let device_id = self.device_id.as_deref().ok_or_else(persistence_failure)?;
        let material = self
            .desktop_continuations
            .exchange_material(
                handle,
                DesktopContinuationPurpose::OAuth,
                TOKEN_MATRIX_ORIGIN,
                "doge-desktop",
                device_id,
                state.account_epoch,
                self.process_generation,
                now_epoch(),
            )
            .await
            .map_err(desktop_continuation_failure)?;
        let login = self
            .authority_required()?
            .exchange_desktop_oauth(
                &binding.authorization_id,
                &material,
                device_id,
                &binding.exchange_operation_id,
            )
            .await
            .map_err(|error| authority_failure(error, "oauth"))?;
        if login.requires_2fa == Some(true) {
            return Err(protocol_failure("oauth"));
        }
        let auth = auth_from_login(login)?;
        let next = self.activate_auth(state, auth, None).await?;
        self.settle_oauth_flow(handle, "terminal", "consumed")?;
        let _ = self
            .desktop_continuations
            .complete_exchange(handle, state.account_epoch, self.process_generation)
            .await;
        state.desktop_authorizations.remove(handle);
        Ok(json!({
            "status": "authenticated",
            "session": next["session"].clone(),
        }))
    }

    async fn cancel_oauth_listener(&self, handle: &str, state: &RuntimeState) {
        let _ = self
            .desktop_continuations
            .cancel(handle, state.account_epoch, self.process_generation)
            .await;
    }

    fn settle_oauth_flow(
        &self,
        handle: &str,
        state_class: &str,
        status: &str,
    ) -> Result<(), Value> {
        self.repository
            .as_ref()
            .ok_or_else(persistence_failure)?
            .settle_external_flow(
                &external_flow_handle_digest(handle),
                state_class,
                status,
                now_epoch(),
            )
            .map_err(|_| persistence_failure())
    }

    fn recover_settled_oauth_attempt(
        &self,
        state: &RuntimeState,
        handle: &str,
    ) -> Result<Value, Value> {
        let record = self
            .repository
            .as_ref()
            .ok_or_else(persistence_failure)?
            .read_external_flow(&external_flow_handle_digest(handle))
            .map_err(|_| persistence_failure())?;
        let Some(record) = record else {
            return Ok(json!({ "status": "expired" }));
        };
        if record.purpose != "oauth"
            || record.account_epoch != state.account_epoch
            || record.process_generation != self.process_generation
        {
            return Ok(json!({ "status": "expired" }));
        }
        match record.status.as_str() {
            "consumed" if is_authenticated(state) => Ok(json!({
                "status": "authenticated",
                "session": session_value(state),
            })),
            "expired" => Ok(json!({ "status": "expired" })),
            "cancelled" => Ok(json!({ "status": "cancelled" })),
            _ => Ok(json!({ "status": "expired" })),
        }
    }
}
