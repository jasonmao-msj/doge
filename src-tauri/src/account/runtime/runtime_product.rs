use super::runtime_product_models::safe_product_models;
use super::*;
use crate::account::authority::{
    ProductApiKeyCreatedWire, ProductOrderCreatedWire, ProductOrderWire, ProductPaymentMethodWire,
    ProductSubscriptionPlanWire,
};
use crate::account::configuration::ApplyError;

pub(super) const PRODUCT_PLATFORM: &str = "composite";
// token2api names the checkout conversion setting `subscription_usd_to_cny_rate`;
// the plan's raw `price` is therefore an upstream USD-denominated commercial fact.
const PRODUCT_PLAN_BASE_CURRENCY: &str = "USD";
const PRODUCT_CHECKOUT_STORAGE_SLOT: &str = "codex";
pub(super) const PRODUCT_FULFILLMENT_GRACE_SECONDS: i64 = 15 * 60;
const PRODUCT_ENGINES: &[(&str, &str)] = &[
    ("codex", "Codex"),
    ("claude-code", "Claude"),
    ("kimi", "Kimi CLI"),
];

impl AccountRuntime {
    pub(crate) async fn product_catalog_snapshot(&self) -> Value {
        let mut state = self.state.lock().await;
        self.initialize_session(&mut state).await;
        let access = match self.authorized_access_token(&mut state).await {
            Ok(access) => access,
            Err(error) => return product_failure(error),
        };
        let authority = match self.authority_required() {
            Ok(authority) => authority,
            Err(error) => return product_failure(error),
        };
        let (checkout, subscriptions) = match tokio::join!(
            authority.product_checkout_info(&access),
            authority.subscription_summary(&access),
        ) {
            (Ok(checkout), Ok(subscriptions)) => (checkout, subscriptions),
            (Err(error), _) => {
                return product_failure(authority_failure(error, "productCatalog"));
            }
            (_, Err(error)) => {
                return product_failure(authority_failure(error, "productEntitlement"));
            }
        };
        match product_catalog_value(checkout.plans, checkout.methods, subscriptions) {
            Ok(value) => product_success(value),
            Err(()) => product_failure(protocol_failure("productCatalog")),
        }
    }

    pub(crate) async fn product_models_snapshot(&self) -> Value {
        let mut state = self.state.lock().await;
        self.initialize_session(&mut state).await;
        if let Err(error) = self.authorized_access_token(&mut state).await {
            return product_failure(error);
        }
        let Some(scope) = active_vault_scope(&state) else {
            return product_failure(session_failure());
        };
        let secret = match self
            .vault
            .read(&format!("{MANAGED_ENGINE_PURPOSE_PREFIX}codex:{scope}"))
        {
            Ok(Some(secret)) if !secret.trim().is_empty() => secret,
            Ok(_) => return product_failure(vault_failure()),
            Err(_) => return product_failure(vault_failure()),
        };
        let authority = match self.authority_required() {
            Ok(authority) => authority,
            Err(error) => return product_failure(error),
        };
        drop(state);
        let models = match authority.product_models(&secret).await {
            Ok(value) => match safe_product_models(value.data) {
                Ok(models) => models,
                Err(()) => return product_failure(protocol_failure("productModels")),
            },
            Err(error) => return product_failure(authority_failure(error, "productModels")),
        };
        product_success(json!({
            "models": models,
            "fetched_at": rfc3339_from_epoch(now_epoch()),
        }))
    }

    pub(crate) async fn product_checkout_create(
        &self,
        plan_id: i64,
        payment_type: &str,
        operation_id: &str,
    ) -> Value {
        if plan_id <= 0 || !valid_payment_type(payment_type) || operation_id.trim().is_empty() {
            return product_failure(code_failure(
                "validationRejected",
                "productCheckout",
                "retry",
            ));
        }
        let mut state = self.state.lock().await;
        self.initialize_session(&mut state).await;
        let access = match self.authorized_access_token(&mut state).await {
            Ok(access) => access,
            Err(error) => return product_failure(error),
        };
        let authority = match self.authority_required() {
            Ok(authority) => authority,
            Err(error) => return product_failure(error),
        };
        let checkout_info = match authority.product_checkout_info(&access).await {
            Ok(value) => value,
            Err(error) => {
                return product_failure(authority_failure(error, "productCheckout"));
            }
        };
        let Some(plan) = checkout_info.plans.into_iter().find(|plan| {
            plan.id == plan_id
                && plan.group_platform.eq_ignore_ascii_case(PRODUCT_PLATFORM)
                && valid_product_plan(plan)
        }) else {
            return product_failure(code_failure("stalePlan", "productCheckout", "retry"));
        };
        if !checkout_info
            .methods
            .iter()
            .any(|(id, method)| id == payment_type && valid_payment_method(id, method))
        {
            return product_failure(code_failure(
                "validationRejected",
                "productCheckout",
                "retry",
            ));
        }
        let created = match authority
            .create_product_order(&access, plan.id, plan.price, payment_type, operation_id)
            .await
        {
            Ok(value) => value,
            Err(error) => {
                return product_failure(authority_failure(error, "productCheckout"));
            }
        };
        let checkout = match checkout_from_created(created, Some(&plan)) {
            Ok(value) => value,
            Err(()) => return product_failure(protocol_failure("productCheckout")),
        };
        if self.persist_product_checkout(&state, &checkout).is_err() {
            return product_failure(persistence_failure());
        }
        product_success(checkout)
    }

    pub(crate) async fn product_checkout_snapshot(&self, checkout_id: i64) -> Value {
        if checkout_id <= 0 {
            return product_failure(code_failure(
                "validationRejected",
                "productCheckout",
                "retry",
            ));
        }
        let mut state = self.state.lock().await;
        self.initialize_session(&mut state).await;
        let access = match self.authorized_access_token(&mut state).await {
            Ok(access) => access,
            Err(error) => return product_failure(error),
        };
        let authority = match self.authority_required() {
            Ok(authority) => authority,
            Err(error) => return product_failure(error),
        };
        let order = match authority.product_order(&access, checkout_id).await {
            Ok(value) => value,
            Err(error) => {
                return product_failure(authority_failure(error, "productCheckout"));
            }
        };
        let plan = if let Some(plan_id) = order.plan_id {
            authority
                .product_checkout_info(&access)
                .await
                .ok()
                .and_then(|info| info.plans.into_iter().find(|plan| plan.id == plan_id))
        } else {
            None
        };
        let checkout = match checkout_from_order(order, plan.as_ref()) {
            Ok(value) => value,
            Err(()) => return product_failure(protocol_failure("productCheckout")),
        };
        if self.persist_product_checkout(&state, &checkout).is_err() {
            return product_failure(persistence_failure());
        }
        product_success(checkout)
    }

    pub(crate) async fn product_pending_checkout_snapshot(&self) -> Value {
        let state = self.state.lock().await;
        let Some((account_link_id, device_id)) =
            super::runtime_engine::checkout_identity(&state, self.device_id.as_deref())
        else {
            return product_success(Value::Null);
        };
        let Some(repository) = self.repository.as_ref() else {
            return product_failure(persistence_failure());
        };
        let record = match repository.read_engine_checkout(
            AUTHORITY_ORIGIN_ID,
            account_link_id,
            device_id,
        ) {
            Ok(Some(record)) if record.engine_id == PRODUCT_CHECKOUT_STORAGE_SLOT => record,
            Ok(_) => return product_success(Value::Null),
            Err(_) => return product_failure(persistence_failure()),
        };
        if record.expires_at <= now_epoch() {
            let _ =
                repository.clear_engine_checkout(AUTHORITY_ORIGIN_ID, account_link_id, device_id);
            return product_success(Value::Null);
        }
        drop(state);
        self.product_checkout_snapshot(record.checkout_id).await
    }

    pub(crate) async fn product_checkout_abandon(&self, checkout_id: i64) -> Value {
        if checkout_id <= 0 {
            return product_failure(code_failure(
                "validationRejected",
                "productCheckout",
                "retry",
            ));
        }
        let state = self.state.lock().await;
        let Some((account_link_id, device_id)) =
            super::runtime_engine::checkout_identity(&state, self.device_id.as_deref())
        else {
            return product_failure(session_failure());
        };
        let Some(repository) = self.repository.as_ref() else {
            return product_failure(persistence_failure());
        };
        match repository.clear_engine_checkout_if_matches(
            AUTHORITY_ORIGIN_ID,
            account_link_id,
            device_id,
            checkout_id,
        ) {
            Ok(true) => product_success(Value::Null),
            Ok(false) => {
                product_failure(code_failure("concurrentEdit", "productCheckout", "retry"))
            }
            Err(_) => product_failure(persistence_failure()),
        }
    }

    pub(crate) async fn product_prepare(&self, operation_id: &str) -> Value {
        if operation_id.trim().is_empty() {
            return product_failure(code_failure(
                "validationRejected",
                "productPrepare",
                "retry",
            ));
        }
        let mut state = self.state.lock().await;
        self.initialize_session(&mut state).await;
        let access = match self.authorized_access_token(&mut state).await {
            Ok(access) => access,
            Err(error) => return product_failure(error),
        };
        let Some(scope) = active_vault_scope(&state).map(str::to_string) else {
            return product_failure(session_failure());
        };
        let Some(device_id) = self.device_id.as_deref() else {
            return product_failure(persistence_failure());
        };
        let authority = match self.authority_required() {
            Ok(authority) => authority,
            Err(error) => return product_failure(error),
        };
        let (checkout, subscriptions) = match tokio::join!(
            authority.product_checkout_info(&access),
            authority.subscription_summary(&access),
        ) {
            (Ok(checkout), Ok(subscriptions)) => (checkout, subscriptions),
            (Err(error), _) => {
                return product_failure(authority_failure(error, "productPrepare"));
            }
            (_, Err(error)) => {
                return product_failure(authority_failure(error, "productPrepare"));
            }
        };
        let plans = checkout
            .plans
            .into_iter()
            .filter(|plan| {
                plan.group_platform.eq_ignore_ascii_case(PRODUCT_PLATFORM)
                    && valid_product_plan(plan)
            })
            .collect::<Vec<_>>();
        let Some((subscription, plan)) = active_product_subscription(&subscriptions, &plans) else {
            return product_failure(code_failure(
                "subscriptionRequired",
                "productPrepare",
                "subscribe",
            ));
        };
        let key_name = managed_product_key_name(plan.group_id, device_id);
        let listed = match authority.product_api_keys(&access, plan.group_id).await {
            Ok(value) => value,
            Err(error) => {
                return product_failure(authority_failure(error, "productPrepare"));
            }
        };
        let existing = listed.items.into_iter().find(|key| {
            key.group_id == Some(plan.group_id)
                && key.name == key_name
                && key.status.eq_ignore_ascii_case("active")
                && key.id > 0
        });
        let secret = if let Some(existing) = existing {
            match authority
                .handoff_api_key(&access, existing.id, device_id, operation_id)
                .await
            {
                Ok(value) if value.id == existing.id && !value.secret.trim().is_empty() => {
                    value.secret
                }
                Ok(_) => return product_failure(protocol_failure("productPrepare")),
                Err(error) => {
                    return product_failure(authority_failure(error, "productPrepare"));
                }
            }
        } else {
            match authority
                .create_product_api_key(&access, plan.group_id, &key_name, operation_id)
                .await
            {
                Ok(created) if valid_created_product_key(&created, plan.group_id) => created.secret,
                Ok(_) => return product_failure(protocol_failure("productPrepare")),
                Err(error) => {
                    return product_failure(authority_failure(error, "productPrepare"));
                }
            }
        };
        for (engine_id, _) in PRODUCT_ENGINES {
            if self
                .vault
                .write(
                    &format!("{MANAGED_ENGINE_PURPOSE_PREFIX}{engine_id}:{scope}"),
                    &secret,
                )
                .is_err()
            {
                return product_failure(vault_failure());
            }
            match configuration::apply_managed_engine(
                engine_id,
                state.account_epoch,
                self.process_generation,
                now_epoch(),
            ) {
                Ok(_) => {
                    if let Err(error) = configuration::commit_completed_transactions() {
                        log::warn!(
                            "[account] product provider configured but journal cleanup failed: {}",
                            error
                        );
                    }
                }
                Err(ApplyError::ConcurrentEdit) => {
                    return product_failure(code_failure(
                        "concurrentEdit",
                        "productPrepare",
                        "retry",
                    ));
                }
                Err(ApplyError::RollbackIncomplete) => {
                    return product_failure(code_failure(
                        "rollbackIncomplete",
                        "productPrepare",
                        "retry",
                    ));
                }
                Err(ApplyError::Rejected(reason)) => {
                    let code = product_configuration_rejection_code(&reason);
                    log::warn!(
                        "[account] product provider configuration rejected: engine_id={engine_id}, code={code}"
                    );
                    return product_failure(code_failure(code, "productPrepare", "retry"));
                }
            }
        }
        let models = match authority.product_models(&secret).await {
            Ok(value) => match safe_product_models(value.data) {
                Ok(models) => models,
                Err(()) => return product_failure(protocol_failure("productModels")),
            },
            Err(error) if error.safe.code == "rateLimited" => {
                log::warn!(
                    "[account] product engines prepared but model catalog is rate limited; continuing with empty catalog"
                );
                Vec::new()
            }
            Err(error) => return product_failure(authority_failure(error, "productModels")),
        };
        if let Some((account_link_id, checkpoint_device_id)) =
            super::runtime_engine::checkout_identity(&state, self.device_id.as_deref())
        {
            if let Some(repository) = self.repository.as_ref() {
                if let Err(error) = repository.clear_engine_checkout(
                    AUTHORITY_ORIGIN_ID,
                    account_link_id,
                    checkpoint_device_id,
                ) {
                    log::warn!(
                        "[account] product prepare succeeded but checkout cleanup failed: {error}"
                    );
                }
            }
        }
        product_success(json!({
            "status": "ready",
            "entitlement": entitlement_value(subscription, plan),
            "models": models,
            "engines": product_engines_value(),
        }))
    }

    fn persist_product_checkout(&self, state: &RuntimeState, checkout: &Value) -> Result<(), ()> {
        let Some((account_link_id, device_id)) =
            super::runtime_engine::checkout_identity(state, self.device_id.as_deref())
        else {
            return Err(());
        };
        let Some(repository) = self.repository.as_ref() else {
            return Err(());
        };
        let status = checkout.get("status").and_then(Value::as_str).ok_or(())?;
        let checkout_id = checkout
            .get("checkout_id")
            .and_then(Value::as_i64)
            .filter(|value| *value > 0)
            .ok_or(())?;
        let expires_at = checkout
            .get("expires_at")
            .and_then(Value::as_str)
            .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
            .map(|value| value.timestamp())
            .ok_or(())?;
        let updated_at = now_epoch();
        let Some((checkpoint_status, checkpoint_expires_at)) =
            product_checkout_checkpoint(status, expires_at, updated_at)
        else {
            return repository
                .clear_engine_checkout(AUTHORITY_ORIGIN_ID, account_link_id, device_id)
                .map_err(|_| ());
        };
        // The existing checkout table predates product-scoped checkout and has
        // a closed engine-id constraint. The product gate owns this legacy slot;
        // no engine-scoped checkout is started while the product gate is active.
        repository
            .save_engine_checkout(&EngineCheckoutRecord {
                authority_origin_id: AUTHORITY_ORIGIN_ID.to_string(),
                account_link_id: account_link_id.to_string(),
                device_id: device_id.to_string(),
                engine_id: PRODUCT_CHECKOUT_STORAGE_SLOT.to_string(),
                checkout_id,
                status: checkpoint_status.to_string(),
                expires_at: checkpoint_expires_at,
                updated_at,
            })
            .map_err(|_| ())
    }
}

pub(super) fn product_checkout_checkpoint<'a>(
    status: &'a str,
    expires_at: i64,
    updated_at: i64,
) -> Option<(&'a str, i64)> {
    match status {
        "pending" | "processing" => Some((status, expires_at)),
        "paid" => Some((
            "processing",
            expires_at.max(updated_at.saturating_add(PRODUCT_FULFILLMENT_GRACE_SECONDS)),
        )),
        _ => None,
    }
}

fn product_catalog_value(
    plans: Vec<ProductSubscriptionPlanWire>,
    methods: HashMap<String, ProductPaymentMethodWire>,
    subscriptions: SubscriptionSummaryWire,
) -> Result<Value, ()> {
    let plans = plans
        .into_iter()
        .filter(|plan| {
            plan.group_platform.eq_ignore_ascii_case(PRODUCT_PLATFORM) && valid_product_plan(plan)
        })
        .collect::<Vec<_>>();
    if plans.is_empty() {
        return Err(());
    }
    let entitlement = active_product_subscription(&subscriptions, &plans)
        .map(|(subscription, plan)| entitlement_value(subscription, plan))
        .unwrap_or_else(|| json!({ "status": "required" }));
    let plan_views = plans.iter().map(product_plan_value).collect::<Vec<_>>();
    let methods = methods
        .into_iter()
        .filter(|(id, method)| valid_payment_method(id, method))
        .map(|(id, method)| {
            json!({
                "id": id,
                "display_name": method.display_name,
                "currency": method.currency,
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "entitlement": entitlement,
        "plans": plan_views,
        "payment_methods": methods,
        "engines": product_engines_value(),
    }))
}

fn product_engines_value() -> Vec<Value> {
    PRODUCT_ENGINES
        .iter()
        .map(|(id, display_name)| json!({ "id": id, "display_name": display_name }))
        .collect()
}

pub(super) fn active_product_subscription<'a>(
    subscriptions: &'a SubscriptionSummaryWire,
    plans: &'a [ProductSubscriptionPlanWire],
) -> Option<(
    &'a crate::account::authority::SubscriptionSummaryItemWire,
    &'a ProductSubscriptionPlanWire,
)> {
    subscriptions.subscriptions.iter().find_map(|subscription| {
        if !subscription.status.eq_ignore_ascii_case("active") {
            return None;
        }
        plans
            .iter()
            .find(|plan| plan.group_id == subscription.group_id)
            .map(|plan| (subscription, plan))
    })
}

fn entitlement_value(
    subscription: &crate::account::authority::SubscriptionSummaryItemWire,
    plan: &ProductSubscriptionPlanWire,
) -> Value {
    json!({
        "status": "active",
        "subscription_id": subscription.id,
        "plan_id": plan.id,
        "group_id": subscription.group_id,
        "group_name": subscription.group_name,
        "plan_name": plan.name,
        "validity_days": plan.validity_days,
        "expires_at": subscription.expires_at,
        "usage": {
            "daily": usage_window(subscription.daily_used_usd, subscription.daily_limit_usd),
            "weekly": usage_window(subscription.weekly_used_usd, subscription.weekly_limit_usd),
            "monthly": usage_window(subscription.monthly_used_usd, subscription.monthly_limit_usd),
        }
    })
}

pub(super) fn product_plan_value(plan: &ProductSubscriptionPlanWire) -> Value {
    json!({
        "id": plan.id,
        "name": plan.name,
        "description": plan.description,
        "price": plan.price,
        "original_price": plan.original_price.filter(|value| value.is_finite() && *value >= 0.0),
        "currency": PRODUCT_PLAN_BASE_CURRENCY,
        "validity_days": plan.validity_days,
        "validity_unit": plan.validity_unit,
        "features": plan.features,
        "daily_limit_usd": plan.daily_limit_usd,
        "weekly_limit_usd": plan.weekly_limit_usd,
        "monthly_limit_usd": plan.monthly_limit_usd,
    })
}

fn usage_window(used: f64, limit: f64) -> Value {
    let percentage = if limit > 0.0 {
        ((used / limit) * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };
    json!({ "used_usd": used, "limit_usd": limit, "percentage": percentage })
}

fn checkout_from_created(
    value: ProductOrderCreatedWire,
    plan: Option<&ProductSubscriptionPlanWire>,
) -> Result<Value, ()> {
    let payment_action = match (value.pay_url.as_deref(), value.qr_code.as_deref()) {
        (Some(pay_url), Some(qr_code)) => Some((pay_url, qr_code)),
        (Some(pay_url), None) => Some((pay_url, "")),
        (None, Some(qr_code)) => Some(("", qr_code)),
        (None, None) => None,
    };
    checkout_value(
        value.order_id,
        &value.status,
        &value.expires_at,
        plan,
        payment_action,
    )
}

fn checkout_from_order(
    value: ProductOrderWire,
    plan: Option<&ProductSubscriptionPlanWire>,
) -> Result<Value, ()> {
    checkout_value(value.id, &value.status, &value.expires_at, plan, None)
}

fn checkout_value(
    checkout_id: i64,
    status: &str,
    expires_at: &str,
    plan: Option<&ProductSubscriptionPlanWire>,
    payment_action: Option<(&str, &str)>,
) -> Result<Value, ()> {
    let status = normalize_order_status(status).ok_or(())?;
    if checkout_id <= 0 || chrono::DateTime::parse_from_rfc3339(expires_at).is_err() {
        return Err(());
    }
    let action = payment_action.and_then(|(pay_url, qr_code)| {
        if let Some(url) = safe_payment_url(pay_url) {
            Some(json!({ "kind": "open_url", "url": url }))
        } else if valid_qr_payload(qr_code) {
            Some(json!({ "kind": "show_qr", "data": qr_code }))
        } else {
            None
        }
    });
    Ok(json!({
        "checkout_id": checkout_id,
        "status": status,
        "expires_at": expires_at,
        "plan_name": plan.map(|value| value.name.as_str()),
        "action": action,
    }))
}

pub(super) fn normalize_order_status(status: &str) -> Option<&'static str> {
    match status.trim().to_ascii_lowercase().as_str() {
        "pending" | "created" => Some("pending"),
        "processing" => Some("processing"),
        "paid" | "completed" => Some("paid"),
        "cancelled" | "canceled" => Some("cancelled"),
        "expired" => Some("expired"),
        "failed" | "refunded" | "partially_refunded" => Some("failed"),
        _ => None,
    }
}

pub(super) fn valid_product_plan(plan: &ProductSubscriptionPlanWire) -> bool {
    plan.id > 0
        && plan.group_id > 0
        && plan.price.is_finite()
        && plan.price >= 0.0
        && plan.name.len() <= 160
        && !plan.name.trim().is_empty()
        && !plan.name.chars().any(char::is_control)
        && plan.description.len() <= 2_000
        && !plan.description.chars().any(char::is_control)
        && plan.validity_days > 0
        && plan.validity_days <= 3_650
        && !plan.validity_unit.trim().is_empty()
        && plan.validity_unit.len() <= 24
        && !plan.validity_unit.chars().any(char::is_control)
        && plan.features.len() <= 32
        && plan
            .features
            .iter()
            .all(|feature| feature.len() <= 240 && !feature.chars().any(char::is_control))
        && optional_non_negative(plan.original_price)
        && optional_non_negative(plan.daily_limit_usd)
        && optional_non_negative(plan.weekly_limit_usd)
        && optional_non_negative(plan.monthly_limit_usd)
}

fn optional_non_negative(value: Option<f64>) -> bool {
    value.is_none_or(|value| value.is_finite() && value >= 0.0)
}

fn valid_payment_type(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
}

pub(super) fn valid_payment_method(id: &str, method: &ProductPaymentMethodWire) -> bool {
    valid_payment_type(id)
        && method.payment_type == id
        && method.display_name.len() <= 80
        && !method.display_name.chars().any(char::is_control)
        && method.currency.len() <= 12
}

pub(super) fn safe_payment_url(value: &str) -> Option<&str> {
    if value.len() > 2_048 {
        return None;
    }
    let parsed = reqwest::Url::parse(value).ok()?;
    (parsed.scheme() == "https"
        && parsed.host_str().is_some()
        && parsed.username().is_empty()
        && parsed.password().is_none())
    .then_some(value)
}

fn valid_qr_payload(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 4_096 && !value.chars().any(char::is_control)
}

pub(super) fn managed_product_key_name(group_id: i64, device_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"doge-product-managed-key-v1\0");
    hasher.update(group_id.to_be_bytes());
    hasher.update(device_id.as_bytes());
    let fingerprint = format!("{:x}", hasher.finalize());
    format!("Doge Managed {group_id} {}", &fingerprint[..24])
}

fn valid_created_product_key(value: &ProductApiKeyCreatedWire, group_id: i64) -> bool {
    value.id > 0
        && value.group_id == Some(group_id)
        && !value.secret.trim().is_empty()
        && value.secret.len() <= 4_096
}

fn product_configuration_rejection_code(reason: &str) -> &'static str {
    let normalized = reason.to_ascii_lowercase();
    if normalized.contains("access is denied")
        || normalized.contains("permission denied")
        || normalized.contains("os error 5")
    {
        "configurationAccessDenied"
    } else if normalized.contains("used by another process")
        || normalized.contains("sharing violation")
        || normalized.contains("os error 32")
    {
        "configurationBusy"
    } else if normalized.contains("unsafe") || normalized.contains("not a regular file") {
        "configurationUnsafeTarget"
    } else {
        "configurationRejected"
    }
}

pub(super) fn product_success(value: Value) -> Value {
    json!({ "ok": true, "value": value })
}

pub(super) fn product_failure(error: Value) -> Value {
    json!({ "ok": false, "error": error })
}
