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
enum ProductUsageGranularity {
    Day,
    Hour,
}

impl ProductUsageGranularity {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "day" => Some(Self::Day),
            "hour" => Some(Self::Hour),
            _ => None,
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Day => "day",
            Self::Hour => "hour",
        }
    }
}

#[derive(Clone, Debug)]
struct ProductUsageQuery {
    start_date: String,
    end_date: String,
    granularity: ProductUsageGranularity,
}

impl AccountRuntime {
    pub(crate) async fn product_usage_snapshot(
        &self,
        start_date: &str,
        end_date: &str,
        granularity: &str,
    ) -> Value {
        let Some(query) = product_usage_query(
            start_date,
            end_date,
            granularity,
            chrono::Local::now().date_naive(),
        ) else {
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
        let (checkout, subscriptions) = match tokio::join!(
            authority.product_checkout_info(&access),
            authority.subscription_summary(&access),
        ) {
            (Ok(checkout), Ok(subscriptions)) => (checkout, subscriptions),
            (Err(error), _) | (_, Err(error)) => {
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
        let Some((_subscription, plan)) = active_product_subscription(&subscriptions, &plans)
        else {
            return product_failure(code_failure(
                "subscriptionRequired",
                "productUsage",
                "subscribe",
            ));
        };
        let (stats, model_snapshot) = tokio::join!(
            authority.product_usage_stats(
                &access,
                plan.group_id,
                &query.start_date,
                &query.end_date,
            ),
            authority.usage_dashboard_snapshot(
                &access,
                plan.group_id,
                &query.start_date,
                &query.end_date,
                query.granularity.as_str(),
                true,
                true,
            ),
        );
        let stats = match stats {
            Ok(stats) => stats,
            Err(error) => {
                return product_failure(authority_failure(error, "productUsage"));
            }
        };
        let (trend_status, trend, models_status, models) = match model_snapshot {
            Ok(snapshot) => (
                "available",
                safe_product_usage_trend(snapshot.trend),
                "available",
                safe_product_usage_models(snapshot.models),
            ),
            Err(error) => {
                log::warn!(
                    "[account] product usage analytics unavailable: code={}",
                    error.safe.code
                );
                ("unavailable", Vec::new(), "unavailable", Vec::new())
            }
        };
        match product_usage_value(&query, &stats, trend_status, trend, models_status, models) {
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

fn product_usage_query(
    start_date: &str,
    end_date: &str,
    granularity: &str,
    today: chrono::NaiveDate,
) -> Option<ProductUsageQuery> {
    let granularity = ProductUsageGranularity::parse(granularity)?;
    let start = chrono::NaiveDate::parse_from_str(start_date, "%Y-%m-%d").ok()?;
    let end = chrono::NaiveDate::parse_from_str(end_date, "%Y-%m-%d").ok()?;
    let range_days = end.signed_duration_since(start).num_days();
    if !(0..=365).contains(&range_days)
        || end > today
        || (granularity == ProductUsageGranularity::Hour && range_days > 31)
    {
        return None;
    }
    Some(ProductUsageQuery {
        start_date: start.format("%Y-%m-%d").to_string(),
        end_date: end.format("%Y-%m-%d").to_string(),
        granularity,
    })
}

fn product_usage_value(
    query: &ProductUsageQuery,
    stats: &ProductUsageStatsWire,
    trend_status: &str,
    trend: Vec<Value>,
    models_status: &str,
    models: Vec<Value>,
) -> Result<Value, ()> {
    if !product_usage_stats_valid(stats)
        || !matches!(trend_status, "available" | "unavailable")
        || !matches!(models_status, "available" | "unavailable")
    {
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
        "query": {
            "start_date": query.start_date,
            "end_date": query.end_date,
            "granularity": query.granularity.as_str(),
        },
        "fetched_at": rfc3339_now(),
        "range": {
            "query_start_date": query.start_date,
            "query_end_date": query.end_date,
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
        "trend_status": trend_status,
        "trend": trend,
        "models_status": models_status,
        "models": models,
    }))
}

fn safe_product_usage_trend(values: Vec<UsageTrendWire>) -> Vec<Value> {
    values
        .into_iter()
        .filter_map(|point| {
            let bucket = point.date.trim();
            if bucket.is_empty()
                || bucket.len() > 32
                || bucket.chars().any(|character| character.is_control())
                || point.input_tokens < 0
                || point.output_tokens < 0
                || point.cache_creation_tokens < 0
                || point.cache_read_tokens < 0
                || point.total_tokens < 0
                || !point.cost.is_finite()
                || point.cost < 0.0
                || !point.actual_cost.is_finite()
                || point.actual_cost < 0.0
            {
                return None;
            }
            Some(json!({
                "bucket": bucket,
                "input_tokens": point.input_tokens,
                "output_tokens": point.output_tokens,
                "cache_creation_tokens": point.cache_creation_tokens,
                "cache_read_tokens": point.cache_read_tokens,
                "total_tokens": point.total_tokens,
                "standard_cost_usd": point.cost,
                "actual_cost_usd": point.actual_cost,
            }))
        })
        .take(800)
        .collect()
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
    fn product_usage_query_accepts_safe_ranges_and_rejects_unbounded_hourly_reads() {
        let today = chrono::NaiveDate::from_ymd_opt(2030, 1, 10).expect("date");

        let query =
            product_usage_query("2030-01-02", "2030-01-10", "hour", today).expect("safe query");
        assert_eq!(query.start_date, "2030-01-02");
        assert_eq!(query.end_date, "2030-01-10");
        assert_eq!(query.granularity, ProductUsageGranularity::Hour);

        assert!(product_usage_query("2030-01-10", "2030-01-02", "day", today).is_none());
        assert!(product_usage_query("2029-12-01", "2030-01-10", "hour", today).is_none());
        assert!(product_usage_query("2030-01-01", "2030-01-12", "day", today).is_none());
        assert!(product_usage_query("2030-01-01", "2030-01-10", "week", today).is_none());
    }

    #[test]
    fn product_usage_projection_keeps_summary_when_models_are_unavailable() {
        let query = ProductUsageQuery {
            start_date: "2030-01-02".into(),
            end_date: "2030-01-10".into(),
            granularity: ProductUsageGranularity::Day,
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
            &query,
            &stats,
            "unavailable",
            Vec::new(),
            "unavailable",
            Vec::new(),
        )
        .expect("usage projection");
        assert_eq!(value["totals"]["requests"], 7);
        assert_eq!(value["query"]["granularity"], "day");
        assert_eq!(value["models_status"], "unavailable");
        assert_eq!(value["models"], json!([]));
    }

    #[test]
    fn product_usage_trend_projects_only_safe_token_buckets() {
        let projected = safe_product_usage_trend(vec![
            UsageTrendWire {
                date: "2030-01-10 12:00".into(),
                input_tokens: 100,
                output_tokens: 20,
                cache_creation_tokens: 4,
                cache_read_tokens: 6,
                total_tokens: 130,
                ..UsageTrendWire::default()
            },
            UsageTrendWire {
                date: "bad\nbucket".into(),
                input_tokens: 1,
                ..UsageTrendWire::default()
            },
        ]);

        assert_eq!(projected.len(), 1);
        assert_eq!(projected[0]["bucket"], "2030-01-10 12:00");
        assert_eq!(projected[0]["cache_read_tokens"], 6);
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
        assert!(value["orders"][0].get("invoice_available").is_none());
    }
}
