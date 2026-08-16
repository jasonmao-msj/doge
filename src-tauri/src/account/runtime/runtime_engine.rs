use super::*;
use crate::account::authority::DesktopCheckoutWire;
use crate::account::configuration::ApplyError;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EngineReadinessView<'a> {
    engine_id: &'a str,
    status: &'static str,
}

impl AccountRuntime {
    pub(crate) async fn engine_catalog_snapshot(&self) -> Value {
        let mut state = self.state.lock().await;
        self.initialize_session(&mut state).await;
        if let Err(error) = self
            .require_authority_capability(
                &mut state,
                AuthorityRequirement::new(
                    "engineCatalog",
                    &[
                        "subscription_only_engine_checkout_v1",
                        "stable_account_reasons_v1",
                    ],
                ),
            )
            .await
        {
            return engine_failure(error);
        }
        let access = match self.authorized_access_token(&mut state).await {
            Ok(access) => access,
            Err(error) => return engine_failure(error),
        };
        match self.authority_required() {
            Ok(authority) => match authority.desktop_engines(&access).await {
                Ok(value) => engine_success(serde_json::to_value(value).unwrap_or(Value::Null)),
                Err(error) => engine_failure(authority_failure(error, "engineCatalog")),
            },
            Err(error) => engine_failure(error),
        }
    }

    pub(crate) async fn engine_plans_snapshot(&self, engine_id: &str) -> Value {
        if !valid_managed_engine(engine_id) {
            return engine_failure(code_failure(
                "capabilityUnavailable",
                "enginePlans",
                "retry",
            ));
        }
        let mut state = self.state.lock().await;
        self.initialize_session(&mut state).await;
        if let Err(error) = self
            .require_authority_capability(
                &mut state,
                AuthorityRequirement::new(
                    "engineSubscriptionPlans",
                    &[
                        "subscription_only_engine_checkout_v1",
                        "stable_account_reasons_v1",
                    ],
                ),
            )
            .await
        {
            return engine_failure(error);
        }
        let access = match self.authorized_access_token(&mut state).await {
            Ok(access) => access,
            Err(error) => return engine_failure(error),
        };
        match self.authority_required() {
            Ok(authority) => match authority.desktop_engine_plans(&access, engine_id).await {
                Ok(value) => engine_success(serde_json::to_value(value).unwrap_or(Value::Null)),
                Err(error) => engine_failure(authority_failure(error, "enginePlans")),
            },
            Err(error) => engine_failure(error),
        }
    }

    pub(crate) async fn engine_checkout_create(
        &self,
        engine_id: &str,
        plan_id: i64,
        payment_type: &str,
        operation_id: &str,
    ) -> Value {
        if !valid_managed_engine(engine_id) || plan_id <= 0 || payment_type.trim().is_empty() {
            return engine_failure(code_failure("validationRejected", "checkout", "retry"));
        }
        let mut state = self.state.lock().await;
        self.initialize_session(&mut state).await;
        if let Err(error) = self
            .require_authority_capability(
                &mut state,
                AuthorityRequirement::new(
                    "engineSubscriptionCheckout",
                    &[
                        "subscription_only_engine_checkout_v1",
                        "stable_account_reasons_v1",
                    ],
                ),
            )
            .await
        {
            return engine_failure(error);
        }
        let access = match self.authorized_access_token(&mut state).await {
            Ok(access) => access,
            Err(error) => return engine_failure(error),
        };
        match self
            .authority_required()
            .and_then(|authority| Ok(authority))
        {
            Ok(authority) => match authority
                .create_desktop_checkout(&access, engine_id, plan_id, payment_type, operation_id)
                .await
            {
                Ok(value) => match validate_desktop_checkout(value) {
                    Ok(value) => {
                        if self
                            .persist_engine_checkout(&state, engine_id, &value)
                            .is_err()
                        {
                            return engine_failure(persistence_failure());
                        }
                        engine_success(serde_json::to_value(value).unwrap_or(Value::Null))
                    }
                    Err(()) => engine_failure(protocol_failure("checkout")),
                },
                Err(error) => engine_failure(authority_failure(error, "checkout")),
            },
            Err(error) => engine_failure(error),
        }
    }

    pub(crate) async fn engine_checkout_snapshot(&self, checkout_id: i64) -> Value {
        if checkout_id <= 0 {
            return engine_failure(code_failure("validationRejected", "checkout", "retry"));
        }
        let mut state = self.state.lock().await;
        self.initialize_session(&mut state).await;
        if let Err(error) = self
            .require_authority_capability(
                &mut state,
                AuthorityRequirement::new(
                    "engineSubscriptionCheckout",
                    &[
                        "subscription_only_engine_checkout_v1",
                        "stable_account_reasons_v1",
                    ],
                ),
            )
            .await
        {
            return engine_failure(error);
        }
        let access = match self.authorized_access_token(&mut state).await {
            Ok(access) => access,
            Err(error) => return engine_failure(error),
        };
        match self.authority_required() {
            Ok(authority) => match authority.desktop_checkout(&access, checkout_id).await {
                Ok(value) => match validate_desktop_checkout(value) {
                    Ok(value) => {
                        if self.persist_known_engine_checkout(&state, &value).is_err() {
                            return engine_failure(persistence_failure());
                        }
                        engine_success(serde_json::to_value(value).unwrap_or(Value::Null))
                    }
                    Err(()) => engine_failure(protocol_failure("checkout")),
                },
                Err(error) => engine_failure(authority_failure(error, "checkout")),
            },
            Err(error) => engine_failure(error),
        }
    }

    pub(crate) async fn engine_pending_checkout_snapshot(&self) -> Value {
        let mut state = self.state.lock().await;
        self.initialize_session(&mut state).await;
        let Some((account_link_id, device_id)) =
            checkout_identity(&state, self.device_id.as_deref())
        else {
            return engine_success(Value::Null);
        };
        let Some(repository) = self.repository.as_ref() else {
            return engine_failure(persistence_failure());
        };
        let record = match repository.read_engine_checkout(
            AUTHORITY_ORIGIN_ID,
            account_link_id,
            device_id,
        ) {
            Ok(Some(record)) => record,
            Ok(None) => return engine_success(Value::Null),
            Err(_) => return engine_failure(persistence_failure()),
        };
        if record.expires_at <= now_epoch() {
            let _ =
                repository.clear_engine_checkout(AUTHORITY_ORIGIN_ID, account_link_id, device_id);
            return engine_success(Value::Null);
        }
        if let Err(error) = self
            .require_authority_capability(
                &mut state,
                AuthorityRequirement::new(
                    "engineSubscriptionCheckout",
                    &[
                        "subscription_only_engine_checkout_v1",
                        "stable_account_reasons_v1",
                    ],
                ),
            )
            .await
        {
            return engine_failure(error);
        }
        let access = match self.authorized_access_token(&mut state).await {
            Ok(access) => access,
            Err(error) => return engine_failure(error),
        };
        let checkout = match self.authority_required() {
            Ok(authority) => {
                authority
                    .desktop_checkout(&access, record.checkout_id)
                    .await
            }
            Err(error) => return engine_failure(error),
        };
        let checkout = match checkout {
            Ok(value) => match validate_desktop_checkout(value) {
                Ok(value) => value,
                Err(()) => return engine_failure(protocol_failure("checkout")),
            },
            Err(error) => return engine_failure(authority_failure(error, "checkout")),
        };
        if self
            .persist_engine_checkout(&state, &record.engine_id, &checkout)
            .is_err()
        {
            return engine_failure(persistence_failure());
        }
        engine_success(json!({
            "engine_id": record.engine_id,
            "checkout": checkout,
        }))
    }

    pub(crate) async fn engine_readiness_snapshot(&self, engine_id: &str) -> Value {
        if !valid_managed_engine(engine_id) {
            return engine_failure(code_failure(
                "capabilityUnavailable",
                "enginePrepare",
                "retry",
            ));
        }
        let state = self.state.lock().await;
        if !is_authenticated(&state) {
            return engine_success(
                serde_json::to_value(EngineReadinessView {
                    engine_id,
                    status: "signedOut",
                })
                .unwrap_or(Value::Null),
            );
        }
        let Some(scope) = active_vault_scope(&state) else {
            return engine_success(
                serde_json::to_value(EngineReadinessView {
                    engine_id,
                    status: "needsPreparation",
                })
                .unwrap_or(Value::Null),
            );
        };
        let has_secret = self
            .vault
            .read(&format!(
                "{MANAGED_ENGINE_PURPOSE_PREFIX}{engine_id}:{scope}"
            ))
            .ok()
            .flatten()
            .is_some_and(|secret| !secret.trim().is_empty());
        let configured = configuration::verify_managed_engine_configuration(engine_id).is_ok();
        engine_success(
            serde_json::to_value(EngineReadinessView {
                engine_id,
                status: if has_secret && configured {
                    "ready"
                } else {
                    "needsPreparation"
                },
            })
            .unwrap_or(Value::Null),
        )
    }

    pub(crate) async fn engine_prepare(&self, engine_id: &str, operation_id: &str) -> Value {
        if !valid_managed_engine(engine_id) {
            return engine_failure(code_failure(
                "capabilityUnavailable",
                "enginePrepare",
                "retry",
            ));
        }
        let mut state = self.state.lock().await;
        self.initialize_session(&mut state).await;
        if let Err(error) = self
            .require_authority_capability(
                &mut state,
                AuthorityRequirement::new(
                    "managedEngineAccess",
                    &[
                        "managed_engine_binding_v1",
                        "api_key_one_time_secret_v1",
                        "api_key_metadata_only_reads_v1",
                        "stable_account_reasons_v1",
                    ],
                ),
            )
            .await
        {
            return engine_failure(error);
        }
        let access = match self.authorized_access_token(&mut state).await {
            Ok(access) => access,
            Err(error) => return engine_failure(error),
        };
        let Some(device_id) = self.device_id.as_deref() else {
            return engine_failure(persistence_failure());
        };
        let managed = match self.authority_required() {
            Ok(authority) => {
                authority
                    .ensure_desktop_managed_access(&access, engine_id, device_id, operation_id)
                    .await
            }
            Err(error) => return engine_failure(error),
        };
        let managed = match managed {
            Ok(managed)
                if managed.engine_id == engine_id
                    && managed.binding_id > 0
                    && managed.group_id.is_some()
                    && managed.status == "ready"
                    && !managed.key_prefix.trim().is_empty()
                    && !managed.secret.trim().is_empty() =>
            {
                managed
            }
            Ok(_) => return engine_failure(protocol_failure("enginePrepare")),
            Err(error) => return engine_failure(authority_failure(error, "enginePrepare")),
        };
        let Some(scope) = active_vault_scope(&state).map(str::to_string) else {
            return engine_failure(session_failure());
        };
        if self
            .vault
            .write(
                &format!("{MANAGED_ENGINE_PURPOSE_PREFIX}{engine_id}:{scope}"),
                &managed.secret,
            )
            .is_err()
        {
            return engine_failure(vault_failure());
        }
        let configured = configuration::apply_managed_engine(
            engine_id,
            state.account_epoch,
            self.process_generation,
            now_epoch(),
        );
        match configured {
            Ok(_) => engine_success(json!({ "engineId": engine_id, "status": "ready" })),
            Err(ApplyError::ConcurrentEdit) => {
                engine_failure(code_failure("concurrentEdit", "enginePrepare", "retry"))
            }
            Err(ApplyError::RollbackIncomplete) => {
                engine_failure(code_failure("rollbackIncomplete", "enginePrepare", "retry"))
            }
            Err(ApplyError::Rejected(_)) => engine_failure(code_failure(
                "configurationRejected",
                "enginePrepare",
                "retry",
            )),
        }
    }

    fn persist_known_engine_checkout(
        &self,
        state: &RuntimeState,
        checkout: &DesktopCheckoutWire,
    ) -> Result<(), ()> {
        let Some((account_link_id, device_id)) =
            checkout_identity(state, self.device_id.as_deref())
        else {
            return Ok(());
        };
        let Some(repository) = self.repository.as_ref() else {
            return Err(());
        };
        let record = repository
            .read_engine_checkout(AUTHORITY_ORIGIN_ID, account_link_id, device_id)
            .map_err(|_| ())?;
        if let Some(record) = record.filter(|record| record.checkout_id == checkout.checkout_id) {
            self.persist_engine_checkout(state, &record.engine_id, checkout)?;
        }
        Ok(())
    }

    fn persist_engine_checkout(
        &self,
        state: &RuntimeState,
        engine_id: &str,
        checkout: &DesktopCheckoutWire,
    ) -> Result<(), ()> {
        let Some((account_link_id, device_id)) =
            checkout_identity(state, self.device_id.as_deref())
        else {
            return Err(());
        };
        let Some(repository) = self.repository.as_ref() else {
            return Err(());
        };
        if !matches!(checkout.status.as_str(), "pending" | "processing") {
            return repository
                .clear_engine_checkout(AUTHORITY_ORIGIN_ID, account_link_id, device_id)
                .map_err(|_| ());
        }
        let expires_at = chrono::DateTime::parse_from_rfc3339(&checkout.expires_at)
            .map_err(|_| ())?
            .timestamp();
        repository
            .save_engine_checkout(&EngineCheckoutRecord {
                authority_origin_id: AUTHORITY_ORIGIN_ID.to_string(),
                account_link_id: account_link_id.to_string(),
                device_id: device_id.to_string(),
                engine_id: engine_id.to_string(),
                checkout_id: checkout.checkout_id,
                status: checkout.status.clone(),
                expires_at,
                updated_at: now_epoch(),
            })
            .map_err(|_| ())
    }
}

fn checkout_identity<'a>(
    state: &'a RuntimeState,
    device_id: Option<&'a str>,
) -> Option<(&'a str, &'a str)> {
    let metadata = state
        .metadata
        .as_ref()
        .filter(|metadata| metadata.session_status == "active")?;
    let account_link_id = metadata.account_link_id.as_deref()?;
    let device_id = device_id?;
    if metadata.device_id.as_deref() != Some(device_id) {
        return None;
    }
    Some((account_link_id, device_id))
}

fn valid_managed_engine(engine_id: &str) -> bool {
    matches!(engine_id, "codex" | "claude-code")
}

fn validate_desktop_checkout(value: DesktopCheckoutWire) -> Result<DesktopCheckoutWire, ()> {
    if value.checkout_id <= 0
        || !matches!(
            value.status.as_str(),
            "pending" | "processing" | "paid" | "cancelled" | "expired" | "failed"
        )
        || chrono::DateTime::parse_from_rfc3339(&value.expires_at).is_err()
    {
        return Err(());
    }
    let Some(action) = value.action.as_ref() else {
        return Ok(value);
    };
    match action.kind.as_str() {
        "open_url" => {
            let raw = action
                .url
                .as_deref()
                .filter(|url| url.len() <= 2_048)
                .ok_or(())?;
            let parsed = reqwest::Url::parse(raw).map_err(|_| ())?;
            if parsed.scheme() != "https"
                || parsed.host_str().is_none()
                || !parsed.username().is_empty()
                || parsed.password().is_some()
                || action.data.is_some()
            {
                return Err(());
            }
        }
        "show_qr" => {
            let raw = action
                .data
                .as_deref()
                .filter(|data| !data.trim().is_empty() && data.len() <= 4_096)
                .ok_or(())?;
            if raw.chars().any(char::is_control) || action.url.is_some() {
                return Err(());
            }
        }
        "unsupported" if action.url.is_none() && action.data.is_none() => {}
        _ => return Err(()),
    }
    Ok(value)
}

fn engine_success(value: Value) -> Value {
    json!({ "ok": true, "value": value })
}

fn engine_failure(error: Value) -> Value {
    json!({ "ok": false, "error": error })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::account::authority::DesktopCheckoutActionWire;

    fn checkout(action: Option<DesktopCheckoutActionWire>) -> DesktopCheckoutWire {
        DesktopCheckoutWire {
            checkout_id: 7,
            status: "pending".to_string(),
            expires_at: "2030-01-01T00:00:00Z".to_string(),
            action,
        }
    }

    #[test]
    fn checkout_action_allows_only_safe_https_navigation() {
        let safe = checkout(Some(DesktopCheckoutActionWire {
            kind: "open_url".to_string(),
            url: Some("https://pay.example.com/order/7?token=opaque".to_string()),
            data: None,
        }));
        assert!(validate_desktop_checkout(safe).is_ok());

        for url in [
            "http://pay.example.com/order/7",
            "javascript:alert(1)",
            "https://user:password@pay.example.com/order/7",
        ] {
            let unsafe_value = checkout(Some(DesktopCheckoutActionWire {
                kind: "open_url".to_string(),
                url: Some(url.to_string()),
                data: None,
            }));
            assert!(validate_desktop_checkout(unsafe_value).is_err());
        }
    }

    #[test]
    fn checkout_action_accepts_bounded_qr_payload_without_treating_it_as_a_url() {
        let value = checkout(Some(DesktopCheckoutActionWire {
            kind: "show_qr".to_string(),
            url: None,
            data: Some("weixin://wxpay/bizpayurl?pr=opaque".to_string()),
        }));
        assert!(validate_desktop_checkout(value).is_ok());
    }
}
