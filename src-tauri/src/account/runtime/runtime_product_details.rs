use super::runtime_product::{
    active_product_subscription, product_failure, product_success, valid_product_plan,
    PRODUCT_PLATFORM,
};
use super::runtime_product_models::safe_product_model_id;
use super::*;
use crate::account::authority::{
    ProductOrderWire, ProductOrdersWire, ProductSubscriptionPlanWire, ProductUsageStatsWire,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ProductUsagePeriod {
    Current,
    Previous,
}

impl ProductUsagePeriod {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "current" => Some(Self::Current),
            "previous" => Some(Self::Previous),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Current => "current",
            Self::Previous => "previous",
        }
    }
}

#[derive(Clone, Debug)]
struct ProductUsageRange {
    query_start_date: String,
    query_end_date: String,
    period_start_date: String,
    period_end_date: String,
    resets_at: Option<String>,
    source: &'static str,
    quota: Option<Value>,
}

impl AccountRuntime {
    pub(crate) async fn product_usage_snapshot(&self, period: &str) -> Value {
        let Some(period) = ProductUsagePeriod::parse(period) else {
            return product_failure(code_failure("validationRejected", "productUsage", "retry"));
        };
        let access = {
            let mut state = self.state.lock().await;
            self.initialize_session(&mut state).await;
            match self.authorized_access_token(&mut state).await {
                Ok(access) => access,
                Err(error) => return product_failure(error),
            }
        };
        let authority = match self.authority_required() {
            Ok(authority) => authority,
            Err(error) => return product_failure(error),
        };
        let (checkout, subscriptions, progress_entries) = match tokio::join!(
            authority.product_checkout_info(&access),
            authority.subscription_summary(&access),
            authority.subscription_progress(&access),
        ) {
            (Ok(checkout), Ok(subscriptions), Ok(progress_entries)) => {
                (checkout, subscriptions, progress_entries)
            }
            (Err(error), _, _) | (_, Err(error), _) | (_, _, Err(error)) => {
                return product_failure(authority_failure(error, "productUsage"));
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
                "productUsage",
                "subscribe",
            ));
        };
        let matching_progress = progress_entries.iter().find(|entry| {
            entry.subscription.id == subscription.id
                && entry.subscription.group_id == subscription.group_id
                && entry.progress.id == subscription.id
        });
        let range = product_usage_range(period, matching_progress, Utc::now().date_naive());
        let (stats, model_snapshot) = tokio::join!(
            authority.product_usage_stats(
                &access,
                plan.group_id,
                &range.query_start_date,
                &range.query_end_date,
            ),
            authority.usage_dashboard_snapshot(
                &access,
                plan.group_id,
                &range.query_start_date,
                &range.query_end_date,
                false,
                true,
            ),
        );
        let stats = match stats {
            Ok(stats) => stats,
            Err(error) => {
                return product_failure(authority_failure(error, "productUsage"));
            }
        };
        let (models_status, models) = match model_snapshot {
            Ok(snapshot) => ("available", safe_product_usage_models(snapshot.models)),
            Err(error) => {
                log::warn!(
                    "[account] product usage model breakdown unavailable: code={}",
                    error.safe.code
                );
                ("unavailable", Vec::new())
            }
        };
        match product_usage_value(period, &range, &stats, models_status, models) {
            Ok(value) => product_success(value),
            Err(()) => product_failure(protocol_failure("productUsage")),
        }
    }

    pub(crate) async fn product_billing_snapshot(&self) -> Value {
        let access = {
            let mut state = self.state.lock().await;
            self.initialize_session(&mut state).await;
            match self.authorized_access_token(&mut state).await {
                Ok(access) => access,
                Err(error) => return product_failure(error),
            }
        };
        let authority = match self.authority_required() {
            Ok(authority) => authority,
            Err(error) => return product_failure(error),
        };
        let (checkout, orders) = match tokio::join!(
            authority.product_checkout_info(&access),
            authority.product_orders(&access),
        ) {
            (Ok(checkout), Ok(orders)) => (checkout, orders),
            (Err(error), _) | (_, Err(error)) => {
                return product_failure(authority_failure(error, "productBilling"));
            }
        };
        match product_billing_value(checkout.plans, orders) {
            Ok(value) => product_success(value),
            Err(()) => product_failure(protocol_failure("productBilling")),
        }
    }
}

fn product_usage_range(
    period: ProductUsagePeriod,
    progress: Option<&SubscriptionProgressEntryWire>,
    today: chrono::NaiveDate,
) -> ProductUsageRange {
    let monthly = progress.and_then(|entry| entry.progress.monthly.as_ref());
    if let Some(window) = monthly {
        let parsed_start = chrono::DateTime::parse_from_rfc3339(&window.window_start).ok();
        let parsed_reset = chrono::DateTime::parse_from_rfc3339(&window.resets_at).ok();
        if let (Some(start), Some(reset)) = (parsed_start, parsed_reset) {
            let start_date = start.date_naive();
            let reset_date = reset.date_naive();
            let cycle_days = reset_date.signed_duration_since(start_date).num_days();
            if (29..=31).contains(&cycle_days) && today >= start_date && today < reset_date {
                let current_end = reset_date - chrono::Duration::days(1);
                let (period_start, period_end, query_end, quota, resets_at) = match period {
                    ProductUsagePeriod::Current => {
                        let normalized_reset = reset
                            .with_timezone(&Utc)
                            .to_rfc3339_opts(SecondsFormat::Secs, true);
                        (
                            start_date,
                            current_end,
                            today.min(current_end),
                            product_usage_quota(window),
                            Some(normalized_reset),
                        )
                    }
                    ProductUsagePeriod::Previous => {
                        let previous_start = start_date - chrono::Duration::days(30);
                        let previous_end = start_date - chrono::Duration::days(1);
                        (previous_start, previous_end, previous_end, None, None)
                    }
                };
                return ProductUsageRange {
                    query_start_date: period_start.format("%Y-%m-%d").to_string(),
                    query_end_date: query_end.format("%Y-%m-%d").to_string(),
                    period_start_date: period_start.format("%Y-%m-%d").to_string(),
                    period_end_date: period_end.format("%Y-%m-%d").to_string(),
                    resets_at,
                    source: "subscriptionMonthly",
                    quota,
                };
            }
        }
    }

    let (start, end) = match period {
        ProductUsagePeriod::Current => (today - chrono::Duration::days(29), today),
        ProductUsagePeriod::Previous => (
            today - chrono::Duration::days(59),
            today - chrono::Duration::days(30),
        ),
    };
    ProductUsageRange {
        query_start_date: start.format("%Y-%m-%d").to_string(),
        query_end_date: end.format("%Y-%m-%d").to_string(),
        period_start_date: start.format("%Y-%m-%d").to_string(),
        period_end_date: end.format("%Y-%m-%d").to_string(),
        resets_at: None,
        source: "rolling30Days",
        quota: None,
    }
}

fn product_usage_quota(window: &SubscriptionUsageWindowWire) -> Option<Value> {
    if !window.limit_usd.is_finite()
        || window.limit_usd <= 0.0
        || !window.used_usd.is_finite()
        || window.used_usd < 0.0
        || !window.percentage.is_finite()
    {
        return None;
    }
    Some(json!({
        "used_usd": window.used_usd,
        "limit_usd": window.limit_usd,
        "percentage": window.percentage.clamp(0.0, 100.0),
        "resets_at": window.resets_at,
    }))
}

fn product_usage_value(
    period: ProductUsagePeriod,
    range: &ProductUsageRange,
    stats: &ProductUsageStatsWire,
    models_status: &str,
    models: Vec<Value>,
) -> Result<Value, ()> {
    if !product_usage_stats_valid(stats) || !matches!(models_status, "available" | "unavailable") {
        return Err(());
    }
    let cache_tokens = if stats.total_cache_tokens > 0 {
        stats.total_cache_tokens
    } else {
        stats
            .total_cache_creation_tokens
            .saturating_add(stats.total_cache_read_tokens)
    };
    Ok(json!({
        "period": period.as_str(),
        "fetched_at": rfc3339_now(),
        "range": {
            "query_start_date": range.query_start_date,
            "query_end_date": range.query_end_date,
            "period_start_date": range.period_start_date,
            "period_end_date": range.period_end_date,
            "resets_at": range.resets_at,
            "source": range.source,
        },
        "totals": {
            "requests": stats.total_requests,
            "input_tokens": stats.total_input_tokens,
            "output_tokens": stats.total_output_tokens,
            "cache_tokens": cache_tokens,
            "total_tokens": stats.total_tokens,
            "standard_cost_usd": stats.total_cost,
            "actual_cost_usd": stats.total_actual_cost,
            "average_duration_ms": stats.average_duration_ms,
        },
        "quota": range.quota,
        "engine_breakdown_status": "unsupported",
        "models_status": models_status,
        "models": models,
    }))
}

fn product_usage_stats_valid(stats: &ProductUsageStatsWire) -> bool {
    stats.total_requests >= 0
        && stats.total_input_tokens >= 0
        && stats.total_output_tokens >= 0
        && stats.total_cache_tokens >= 0
        && stats.total_cache_creation_tokens >= 0
        && stats.total_cache_read_tokens >= 0
        && stats.total_tokens >= 0
        && stats.total_cost.is_finite()
        && stats.total_cost >= 0.0
        && stats.total_actual_cost.is_finite()
        && stats.total_actual_cost >= 0.0
        && stats.average_duration_ms.is_finite()
        && stats.average_duration_ms >= 0.0
}

fn safe_product_usage_models(values: Vec<UsageModelWire>) -> Vec<Value> {
    let mut rows = values
        .into_iter()
        .filter_map(|model| {
            let id = model.model.trim();
            if !safe_product_model_id(id)
                || model.requests < 0
                || model.total_tokens < 0
                || !model.cost.is_finite()
                || model.cost < 0.0
                || !model.actual_cost.is_finite()
                || model.actual_cost < 0.0
            {
                return None;
            }
            Some(json!({
                "id": id,
                "display_name": id,
                "requests": model.requests,
                "total_tokens": model.total_tokens,
                "standard_cost_usd": model.cost,
                "actual_cost_usd": model.actual_cost,
            }))
        })
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        right
            .get("requests")
            .and_then(Value::as_i64)
            .cmp(&left.get("requests").and_then(Value::as_i64))
            .then_with(|| {
                left.get("id")
                    .and_then(Value::as_str)
                    .cmp(&right.get("id").and_then(Value::as_str))
            })
    });
    rows.truncate(12);
    rows
}

fn product_billing_value(
    plans: Vec<ProductSubscriptionPlanWire>,
    orders: ProductOrdersWire,
) -> Result<Value, ()> {
    let plan_names = plans
        .into_iter()
        .filter(|plan| {
            plan.group_platform.eq_ignore_ascii_case(PRODUCT_PLATFORM) && valid_product_plan(plan)
        })
        .map(|plan| (plan.id, plan.name))
        .collect::<HashMap<_, _>>();
    let mut rows = orders
        .items
        .into_iter()
        .filter_map(|order| product_billing_row(order, &plan_names))
        .collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        right
            .get("occurred_at")
            .and_then(Value::as_str)
            .cmp(&left.get("occurred_at").and_then(Value::as_str))
    });
    rows.truncate(12);
    Ok(json!({
        "fetched_at": rfc3339_now(),
        "invoice_download_status": "unsupported",
        "orders": rows,
    }))
}

fn product_billing_row(
    order: ProductOrderWire,
    plan_names: &HashMap<i64, String>,
) -> Option<Value> {
    if !order.order_type.eq_ignore_ascii_case("subscription") {
        return None;
    }
    let plan_id = order.plan_id.filter(|value| *value > 0)?;
    let plan_name = plan_names.get(&plan_id)?;
    let status = normalize_product_billing_status(&order.status)?;
    let occurred_at = [
        order.paid_at.as_deref(),
        order.completed_at.as_deref(),
        Some(order.created_at.as_str()),
    ]
    .into_iter()
    .flatten()
    .find_map(normalize_product_order_timestamp)?;
    let amount = if order.pay_amount.is_finite() && order.pay_amount > 0.0 {
        order.pay_amount
    } else {
        order.amount
    };
    if order.id <= 0
        || !amount.is_finite()
        || amount < 0.0
        || order.currency.is_empty()
        || order.currency.len() > 12
        || !order.currency.chars().all(|ch| ch.is_ascii_alphanumeric())
    {
        return None;
    }
    Some(json!({
        "id": order.id,
        "plan_name": plan_name,
        "occurred_at": occurred_at,
        "amount": amount,
        "currency": order.currency,
        "status": status,
        "invoice_available": false,
    }))
}

fn normalize_product_billing_status(value: &str) -> Option<&'static str> {
    match value.trim().to_ascii_lowercase().as_str() {
        "paid" | "completed" => Some("paid"),
        "pending" | "created" | "processing" => Some("pending"),
        "refunded" | "partially_refunded" | "refund_pending" => Some("refunded"),
        "cancelled" | "canceled" | "expired" | "failed" => Some("failed"),
        _ => None,
    }
}

fn normalize_product_order_timestamp(value: &str) -> Option<String> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| {
            timestamp
                .with_timezone(&Utc)
                .to_rfc3339_opts(SecondsFormat::Secs, true)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn product_plan() -> ProductSubscriptionPlanWire {
        ProductSubscriptionPlanWire {
            id: 5,
            group_id: 11,
            group_platform: "composite".into(),
            group_name: "Doge".into(),
            name: "Doge Pro".into(),
            description: "All models".into(),
            price: 12.0,
            original_price: Some(16.0),
            validity_days: 30,
            validity_unit: "day".into(),
            features: vec!["All models".into()],
            daily_limit_usd: Some(2.0),
            weekly_limit_usd: Some(8.0),
            monthly_limit_usd: Some(20.0),
        }
    }

    #[test]
    fn product_usage_range_uses_current_and_previous_subscription_windows() {
        let progress = SubscriptionProgressEntryWire {
            subscription: crate::account::authority::SubscriptionIdentityWire {
                id: 7,
                group_id: 11,
            },
            progress: crate::account::authority::SubscriptionProgressWire {
                id: 7,
                group_name: "Doge".into(),
                expires_at: "2030-03-01T00:00:00Z".into(),
                daily: None,
                weekly: None,
                monthly: Some(SubscriptionUsageWindowWire {
                    limit_usd: 20.0,
                    used_usd: 3.0,
                    remaining_usd: 17.0,
                    percentage: 15.0,
                    window_start: "2030-01-02T00:00:00Z".into(),
                    resets_at: "2030-02-01T00:00:00Z".into(),
                }),
            },
        };
        let today = chrono::NaiveDate::from_ymd_opt(2030, 1, 10).expect("date");

        let current = product_usage_range(ProductUsagePeriod::Current, Some(&progress), today);
        assert_eq!(current.query_start_date, "2030-01-02");
        assert_eq!(current.query_end_date, "2030-01-10");
        assert_eq!(current.period_end_date, "2030-01-31");
        assert_eq!(current.source, "subscriptionMonthly");
        assert!(current.quota.is_some());

        let previous = product_usage_range(ProductUsagePeriod::Previous, Some(&progress), today);
        assert_eq!(previous.query_start_date, "2029-12-03");
        assert_eq!(previous.query_end_date, "2030-01-01");
        assert!(previous.quota.is_none());
    }

    #[test]
    fn product_usage_projection_keeps_summary_when_models_are_unavailable() {
        let range = ProductUsageRange {
            query_start_date: "2030-01-02".into(),
            query_end_date: "2030-01-10".into(),
            period_start_date: "2030-01-02".into(),
            period_end_date: "2030-01-31".into(),
            resets_at: Some("2030-02-01T00:00:00Z".into()),
            source: "subscriptionMonthly",
            quota: Some(json!({
                "used_usd": 1.0,
                "limit_usd": 10.0,
                "percentage": 10.0,
                "resets_at": "2030-02-01T00:00:00Z",
            })),
        };
        let stats = ProductUsageStatsWire {
            total_requests: 7,
            total_input_tokens: 100,
            total_output_tokens: 20,
            total_cache_tokens: 10,
            total_cache_creation_tokens: 4,
            total_cache_read_tokens: 6,
            total_tokens: 130,
            total_cost: 1.25,
            total_actual_cost: 1.0,
            average_duration_ms: 7200.0,
        };
        let value = product_usage_value(
            ProductUsagePeriod::Current,
            &range,
            &stats,
            "unavailable",
            Vec::new(),
        )
        .expect("usage projection");
        assert_eq!(value["totals"]["requests"], 7);
        assert_eq!(value["models_status"], "unavailable");
        assert_eq!(value["models"], json!([]));
    }

    #[test]
    fn product_billing_only_projects_safe_composite_subscription_orders() {
        let value = product_billing_value(
            vec![product_plan()],
            ProductOrdersWire {
                items: vec![ProductOrderWire {
                    id: 91,
                    status: "completed".into(),
                    expires_at: "2030-01-01T00:30:00Z".into(),
                    plan_id: Some(5),
                    amount: 12.0,
                    pay_amount: 86.4,
                    currency: "CNY".into(),
                    order_type: "subscription".into(),
                    created_at: "2030-01-01T00:00:00Z".into(),
                    paid_at: Some("2030-01-01T00:01:00Z".into()),
                    completed_at: None,
                }],
            },
        )
        .expect("billing projection");
        assert_eq!(value["orders"][0]["plan_name"], "Doge Pro");
        assert_eq!(value["orders"][0]["amount"], 86.4);
        assert_eq!(value["orders"][0]["status"], "paid");
        assert_eq!(value["orders"][0]["invoice_available"], false);
    }
}
