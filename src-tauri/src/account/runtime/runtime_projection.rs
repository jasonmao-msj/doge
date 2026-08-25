use super::*;
use crate::account::desktop_continuation::DesktopContinuationError;

pub(super) struct OAuthProviderSpec {
    pub(super) capability: &'static str,
    pub(super) authority_name: &'static str,
    pub(super) label: &'static str,
    pub(super) authorize_host: &'static str,
}

pub(super) fn oauth_provider_spec(provider: &str) -> Option<OAuthProviderSpec> {
    match provider {
        "auth.oauth.github" => Some(OAuthProviderSpec {
            capability: "oauth.github",
            authority_name: "github",
            label: "GitHub",
            authorize_host: "github.com",
        }),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct AuthorityRequirement {
    pub(super) capability: &'static str,
    pub(super) guarantees: &'static [&'static str],
}

impl AuthorityRequirement {
    pub(super) const fn new(capability: &'static str, guarantees: &'static [&'static str]) -> Self {
        Self {
            capability,
            guarantees,
        }
    }
}

pub(super) fn authority_requirement(operation: &str) -> Option<AuthorityRequirement> {
    let durable_auth = &[
        "durable_token_pair_v1",
        "atomic_refresh_replay_v1",
        "stable_account_reasons_v1",
    ];
    let stable = &["stable_account_reasons_v1"];
    let managed = &[
        "api_key_one_time_secret_v1",
        "api_key_metadata_only_reads_v1",
        "stable_account_reasons_v1",
    ];
    Some(match operation {
        "auth.beginRegistration" => AuthorityRequirement::new("registration", durable_auth),
        "auth.resendRegistrationCode" => {
            AuthorityRequirement::new("registrationEmailVerification", stable)
        }
        "auth.submitRegistrationCode" => {
            AuthorityRequirement::new("registrationEmailVerification", durable_auth)
        }
        "auth.login" => AuthorityRequirement::new("passwordLogin", durable_auth),
        "auth.requestPasswordReset" => AuthorityRequirement::new("passwordReset", stable),
        "auth.verifyMfa" => AuthorityRequirement::new("mfa", durable_auth),
        "profile.read" | "profile.updateProfile" => AuthorityRequirement::new("profile", stable),
        "profile.changePassword" => AuthorityRequirement::new("passwordChange", stable),
        "profile.revokeAllSessions" => AuthorityRequirement::new(
            "revokeAllSessions",
            &[
                "durable_revocation_generation_v1",
                "typed_logout_outcome_v1",
                "stable_account_reasons_v1",
            ],
        ),
        "usage.read" | "usage.readDayModels" | "subscription.read" => {
            AuthorityRequirement::new("quotaPull", stable)
        }
        "managedKey.listCandidates" => AuthorityRequirement::new(
            "apiKeyList",
            &[
                "api_key_metadata_only_reads_v1",
                "stable_account_reasons_v1",
            ],
        ),
        "managedKey.selectExisting" => AuthorityRequirement::new(
            "apiKeyHandoff",
            &[
                "api_key_one_time_secret_v1",
                "api_key_metadata_only_reads_v1",
                "api_key_owner_handoff_v1",
                "api_key_recoverable_encryption_v1",
                "stable_account_reasons_v1",
            ],
        ),
        "managedKey.provision" => AuthorityRequirement::new("managedKeyProvision", managed),
        "managedKey.rotate" => AuthorityRequirement::new("managedKeyRotate", managed),
        _ => return None,
    })
}

pub(super) fn bootstrap_value(
    state: &RuntimeState,
    settings: Option<&PublicSettingsWire>,
    descriptor: Option<&AuthorityCapabilityDescriptor>,
    vault: AccountVaultStatus,
    availability: &str,
) -> Value {
    let vault_name = match vault {
        AccountVaultStatus::Ready => "ready",
        AccountVaultStatus::Locked => "locked",
        AccountVaultStatus::Unavailable => "unavailable",
    };
    let vault_ready = vault == AccountVaultStatus::Ready;
    let service_ready = availability == "ready";
    let enabled = |server: bool| {
        if !service_ready {
            json!({ "status": "unknown", "reason": if availability == "offline" { "offline" } else { "serviceUnavailable" } })
        } else if !vault_ready {
            json!({ "status": "disabled", "reason": "vaultUnavailable" })
        } else if server {
            json!({ "status": "enabled" })
        } else {
            json!({ "status": "disabled", "reason": "serverDisabled" })
        }
    };
    let desktop_gap = |server: bool| {
        if server {
            json!({ "status": "disabled", "reason": "desktopUnsupported" })
        } else {
            json!({ "status": "disabled", "reason": "serverDisabled" })
        }
    };
    let guaranteed = |capability: &str, required: &[&str]| {
        if !service_ready {
            enabled(false)
        } else if descriptor.is_none() {
            json!({ "status": "disabled", "reason": "serverGuaranteeMissing" })
        } else if descriptor.is_some_and(|value| value.supports(capability, required)) {
            enabled(true)
        } else {
            json!({ "status": "disabled", "reason": "serverGuaranteeMissing" })
        }
    };
    let settings_available = settings.is_some();
    let human_verification = settings.is_some_and(PublicSettingsWire::requires_human_verification);
    let entries = json!({
        "auth.emailPasswordLogin": if settings_available && !human_verification { guaranteed("passwordLogin", &["durable_token_pair_v1", "atomic_refresh_replay_v1", "stable_account_reasons_v1"]) } else { enabled(false) },
        "auth.registration": if settings.is_some_and(|value| value.registration_enabled) && !human_verification { guaranteed("registration", &["durable_token_pair_v1", "atomic_refresh_replay_v1", "stable_account_reasons_v1"]) } else { enabled(false) },
        "auth.registrationEmailVerification": if settings.is_some_and(|value| value.email_verify_enabled) && !human_verification { guaranteed("registrationEmailVerification", &["durable_token_pair_v1", "stable_account_reasons_v1"]) } else { enabled(false) },
        "auth.passwordReset": if settings.is_some_and(|value| value.password_reset_enabled) && !human_verification { guaranteed("passwordReset", &["stable_account_reasons_v1"]) } else { enabled(false) },
        "auth.humanVerification": desktop_gap(human_verification),
        "auth.mfa": if settings.is_some_and(|value| value.totp_enabled) { guaranteed("mfa", &["durable_token_pair_v1", "atomic_refresh_replay_v1", "stable_account_reasons_v1"]) } else { enabled(false) },
        "auth.oauth.github": if settings.is_some_and(|value| value.github_oauth_enabled) { guaranteed("oauth.github", &["desktop_oauth_ticket_v1", "durable_token_pair_v1", "atomic_refresh_replay_v1", "stable_account_reasons_v1"]) } else { enabled(false) },
        "auth.oauth.google": desktop_gap(settings.is_some_and(|value| value.google_oauth_enabled)),
        "auth.oauth.linuxdo": desktop_gap(settings.is_some_and(|value| value.linuxdo_oauth_enabled)),
        "auth.oauth.wechat": desktop_gap(settings.is_some_and(|value| value.wechat_oauth_enabled)),
        "auth.oauth.oidc": desktop_gap(settings.is_some_and(|value| value.oidc_oauth_enabled)),
        "auth.oauth.dingtalk": desktop_gap(settings.is_some_and(|value| value.dingtalk_oauth_enabled)),
        "account.profile": if settings_available { guaranteed("profile", &["stable_account_reasons_v1"]) } else { enabled(false) },
        "account.passwordChange": if settings_available { guaranteed("passwordChange", &["stable_account_reasons_v1"]) } else { enabled(false) },
        "account.totp": desktop_gap(settings.is_some_and(|value| value.totp_enabled)),
        "account.identityBindings": desktop_gap(false),
        "account.revokeAllSessions": if settings_available {
            json!({ "status": "disabled", "reason": "serverGuaranteeMissing" })
        } else {
            enabled(false)
        },
        "usage.quotaPull": if settings_available { guaranteed("quotaPull", &["stable_account_reasons_v1"]) } else { enabled(false) },
        "subscription.summary": if settings_available { guaranteed("quotaPull", &["stable_account_reasons_v1"]) } else { enabled(false) },
        "managedKey.listCandidates": if settings_available { guaranteed("apiKeyList", &["api_key_metadata_only_reads_v1", "stable_account_reasons_v1"]) } else { enabled(false) },
        "managedKey.selectExisting": if settings_available { guaranteed("apiKeyHandoff", &["api_key_one_time_secret_v1", "api_key_metadata_only_reads_v1", "api_key_owner_handoff_v1", "api_key_recoverable_encryption_v1", "stable_account_reasons_v1"]) } else { enabled(false) },
        "managedKey.provision": if settings_available { guaranteed("managedKeyProvision", &["api_key_one_time_secret_v1", "api_key_metadata_only_reads_v1", "stable_account_reasons_v1"]) } else { enabled(false) },
        "managedKey.rotate": if settings_available { guaranteed("managedKeyRotate", &["api_key_one_time_secret_v1", "api_key_metadata_only_reads_v1", "stable_account_reasons_v1"]) } else { enabled(false) },
        "managedKey.revoke": enabled(vault_ready),
        "configuration.plan": if settings_available { guaranteed("apiKeyHandoff", &["api_key_one_time_secret_v1", "api_key_owner_handoff_v1", "api_key_recoverable_encryption_v1"]) } else { enabled(false) },
        "configuration.apply": if settings_available { guaranteed("apiKeyHandoff", &["api_key_one_time_secret_v1", "api_key_owner_handoff_v1", "api_key_recoverable_encryption_v1"]) } else { enabled(false) },
        "recipe.codex.v1": if settings_available { guaranteed("apiKeyHandoff", &["api_key_one_time_secret_v1", "api_key_owner_handoff_v1", "api_key_recoverable_encryption_v1"]) } else { enabled(false) },
    });
    json!({
        "localMode": {
            "status": "available",
            "blockedByAccount": false,
            "accountFailureCanGateLocalMode": false,
        },
        "gatewayAvailability": availability,
        "vault": vault_name,
        "capabilities": {
            "contractVersion": CONTRACT_VERSION,
            "observedAt": rfc3339_now(),
            "freshness": if service_ready { "fresh" } else { "hardExpired" },
            "entries": entries,
            "registration": {
                "emailSuffixHint": Value::Null,
                "invitationCode": if settings.is_some_and(|value| value.invitation_code_enabled) { "required" } else { "hidden" },
                "promoCode": if settings.is_some_and(|value| value.promo_code_enabled) { "optional" } else { "hidden" },
                "agreementRequired": settings.is_some_and(|value| value.login_agreement_enabled),
                "humanVerificationRequired": human_verification,
            },
        },
        "session": session_value(state),
    })
}

pub(super) fn session_value(state: &RuntimeState) -> Value {
    if !is_authenticated(state) {
        return json!({ "status": "signedOut" });
    }
    let metadata = state.metadata.as_ref();
    json!({
        "status": "authenticated",
        "accountEpoch": state.account_epoch,
        "sessionCapability": "persistent",
        "profileLabel": metadata.map(|value| value.profile_label.as_str()).unwrap_or("Token service account"),
        "primaryEmailLabel": metadata.and_then(|value| value.primary_email_label.as_deref()),
    })
}

pub(super) fn is_authenticated(state: &RuntimeState) -> bool {
    state.access_token.is_some()
        && state.metadata.as_ref().is_some_and(|metadata| {
            metadata.session_status == "active" && metadata.vault_scope.is_some()
        })
}

pub(super) fn subscription_usage_value(
    catalog: &DesktopEngineCatalogWire,
    progress_entries: &[SubscriptionProgressEntryWire],
    snapshots: &HashMap<String, Option<UsageDashboardSnapshotWire>>,
    fetched_at: &str,
    start_date: &str,
    end_date: &str,
) -> Value {
    let mut engines = Vec::new();
    for engine in &catalog.engines {
        if engine.entitlement.status != "active"
            || !matches!(engine.id.as_str(), "codex" | "claude-code")
        {
            continue;
        }
        let Some(subscription_id) = engine
            .entitlement
            .subscription_id
            .filter(|value| *value > 0)
        else {
            continue;
        };
        let Some(group_id) = engine.entitlement.group_id.filter(|value| *value > 0) else {
            continue;
        };
        let progress = progress_entries.iter().find(|entry| {
            entry.subscription.id == subscription_id
                && entry.subscription.group_id == group_id
                && entry.progress.id == subscription_id
        });
        let snapshot = snapshots.get(&engine.id).and_then(Option::as_ref);
        let windows = progress
            .map(|entry| {
                json!({
                    "daily": entry.progress.daily.as_ref().and_then(usage_window_value),
                    "weekly": entry.progress.weekly.as_ref().and_then(usage_window_value),
                    "monthly": entry.progress.monthly.as_ref().and_then(usage_window_value),
                })
            })
            .unwrap_or_else(
                || json!({ "daily": Value::Null, "weekly": Value::Null, "monthly": Value::Null }),
            );
        let totals = snapshot
            .map(|value| usage_totals_value(&value.trend))
            .unwrap_or_else(empty_usage_totals_value);
        let max_actual_cost = snapshot
            .map(|value| {
                value
                    .trend
                    .iter()
                    .map(|day| finite_non_negative(day.actual_cost))
                    .fold(0.0, f64::max)
            })
            .unwrap_or(0.0);
        let days = snapshot
            .map(|value| {
                let mut values = value
                    .trend
                    .iter()
                    .take(366)
                    .map(|day| {
                        usage_day_value(day, usage_intensity(day.actual_cost, max_actual_cost))
                    })
                    .collect::<Vec<_>>();
                values.sort_by(|left, right| {
                    left.get("date")
                        .and_then(Value::as_str)
                        .cmp(&right.get("date").and_then(Value::as_str))
                });
                values
            })
            .unwrap_or_default();
        let models = snapshot
            .map(|value| usage_model_values(&value.models))
            .unwrap_or_default();
        let engine_label = match engine.id.as_str() {
            "codex" => "Codex".to_string(),
            "claude-code" => "Claude".to_string(),
            _ => safe_label(&engine.display_name),
        };
        let subscription_label = progress
            .map(|entry| safe_label(&entry.progress.group_name))
            .filter(|label| !label.is_empty())
            .unwrap_or_else(|| engine_label.clone());
        let expires_at = progress
            .and_then(|entry| normalize_authority_timestamp(&entry.progress.expires_at))
            .or_else(|| {
                engine
                    .entitlement
                    .expires_at
                    .as_deref()
                    .and_then(normalize_authority_timestamp)
            });
        engines.push(json!({
            "engineId": engine.id,
            "engineLabel": engine_label,
            "subscriptionLabel": subscription_label,
            "expiresAt": expires_at,
            "analyticsStatus": if snapshot.is_some() { "available" } else { "unavailable" },
            "windows": windows,
            "totals": totals,
            "days": days,
            "models": models,
        }));
    }

    let summary_window = engines.first().and_then(|engine| {
        let windows = engine.get("windows")?;
        ["monthly", "weekly", "daily"]
            .iter()
            .find_map(|key| windows.get(*key).filter(|value| !value.is_null()))
    });
    let summary_label = engines
        .first()
        .and_then(|engine| engine.get("subscriptionLabel"))
        .cloned()
        .unwrap_or(Value::Null);
    json!({
        "status": if engines.is_empty() { "unavailable" } else { "available" },
        "source": "token2apiSubscription",
        "freshness": "fresh",
        "observedAt": fetched_at,
        "fetchedAt": fetched_at,
        "remaining": summary_window.and_then(|window| window.get("remaining")).cloned().unwrap_or(Value::Null),
        "used": summary_window.and_then(|window| window.get("used")).cloned().unwrap_or(Value::Null),
        "resetsAt": summary_window.and_then(|window| window.get("resetsAt")).cloned().unwrap_or(Value::Null),
        "subscriptionLabel": summary_label,
        "range": { "startDate": start_date, "endDate": end_date, "days": 365 },
        "engines": engines,
    })
}

pub(super) fn subscription_summary_value(
    catalog: &DesktopEngineCatalogWire,
    summary: &SubscriptionSummaryWire,
    fetched_at: &str,
) -> Value {
    let subscriptions = summary
        .subscriptions
        .iter()
        .filter(|subscription| subscription.id > 0 && subscription.group_id > 0)
        .map(|subscription| {
            let engine = catalog.engines.iter().find(|engine| {
                engine.entitlement.status == "active"
                    && matches!(engine.id.as_str(), "codex" | "claude-code")
                    && engine.entitlement.subscription_id == Some(subscription.id)
                    && engine.entitlement.group_id == Some(subscription.group_id)
            });
            let engine_id = engine.map(|value| value.id.as_str());
            let engine_label = engine.map(|value| match value.id.as_str() {
                "codex" => "Codex".to_string(),
                "claude-code" => "Claude".to_string(),
                _ => safe_label(&value.display_name),
            });
            let subscription_label = safe_label(&subscription.group_name);
            let fallback_label = engine_label.clone().unwrap_or_else(|| "订阅套餐".to_string());
            json!({
                "id": format!("subscription-{}", subscription.id),
                "engineId": engine_id,
                "engineLabel": engine_label,
                "subscriptionLabel": if subscription_label.is_empty() { fallback_label } else { subscription_label },
                "status": if subscription.status == "active" { "active" } else { "unknown" },
                "expiresAt": subscription.expires_at.as_deref().and_then(normalize_authority_timestamp),
                "windows": {
                    "daily": subscription_summary_window_value(subscription.daily_used_usd, subscription.daily_limit_usd),
                    "weekly": subscription_summary_window_value(subscription.weekly_used_usd, subscription.weekly_limit_usd),
                    "monthly": subscription_summary_window_value(subscription.monthly_used_usd, subscription.monthly_limit_usd),
                },
            })
        })
        .collect::<Vec<_>>();
    json!({
        "status": "available",
        "source": "token2apiSubscription",
        "fetchedAt": fetched_at,
        "subscriptions": subscriptions,
    })
}

pub(super) fn usage_day_models_value(
    engine_id: &str,
    date: &str,
    snapshot: &UsageDashboardSnapshotWire,
) -> Value {
    json!({
        "engineId": engine_id,
        "date": date,
        "models": usage_model_values(&snapshot.models),
    })
}

fn usage_window_value(window: &SubscriptionUsageWindowWire) -> Option<Value> {
    let resets_at = normalize_authority_timestamp(&window.resets_at)?;
    Some(json!({
        "limit": money_measure(window.limit_usd),
        "used": money_measure(window.used_usd),
        "remaining": money_measure(window.remaining_usd),
        "percentage": canonical_decimal(window.percentage.clamp(0.0, 100.0)),
        "resetsAt": resets_at,
    }))
}

fn subscription_summary_window_value(used_usd: f64, limit_usd: f64) -> Option<Value> {
    let limit = finite_non_negative(limit_usd);
    if limit <= 0.0 {
        return None;
    }
    let used = finite_non_negative(used_usd);
    let remaining = (limit - used).max(0.0);
    let percentage = (used / limit * 100.0).clamp(0.0, 100.0);
    Some(json!({
        "limit": money_measure(limit),
        "used": money_measure(used),
        "remaining": money_measure(remaining),
        "percentage": canonical_decimal(percentage),
    }))
}

fn usage_totals_value(rows: &[UsageTrendWire]) -> Value {
    let mut requests = 0_i64;
    let mut input_tokens = 0_i64;
    let mut output_tokens = 0_i64;
    let mut cache_read_tokens = 0_i64;
    let mut cache_write_tokens = 0_i64;
    let mut total_tokens = 0_i64;
    let mut cost = 0.0;
    let mut actual_cost = 0.0;
    for row in rows {
        requests = requests.saturating_add(row.requests.max(0));
        input_tokens = input_tokens.saturating_add(row.input_tokens.max(0));
        output_tokens = output_tokens.saturating_add(row.output_tokens.max(0));
        cache_read_tokens = cache_read_tokens.saturating_add(row.cache_read_tokens.max(0));
        cache_write_tokens = cache_write_tokens.saturating_add(row.cache_creation_tokens.max(0));
        total_tokens = total_tokens.saturating_add(row.total_tokens.max(0));
        cost += finite_non_negative(row.cost);
        actual_cost += finite_non_negative(row.actual_cost);
    }
    json!({
        "requests": requests,
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "cacheReadTokens": cache_read_tokens,
        "cacheWriteTokens": cache_write_tokens,
        "totalTokens": total_tokens,
        "cost": money_measure(cost),
        "actualCost": money_measure(actual_cost),
    })
}

fn empty_usage_totals_value() -> Value {
    usage_totals_value(&[])
}

fn usage_day_value(row: &UsageTrendWire, intensity: u8) -> Value {
    json!({
        "date": row.date,
        "intensity": intensity,
        "requests": row.requests.max(0),
        "inputTokens": row.input_tokens.max(0),
        "outputTokens": row.output_tokens.max(0),
        "cacheReadTokens": row.cache_read_tokens.max(0),
        "cacheWriteTokens": row.cache_creation_tokens.max(0),
        "totalTokens": row.total_tokens.max(0),
        "cost": money_measure(row.cost),
        "actualCost": money_measure(row.actual_cost),
    })
}

fn usage_model_values(rows: &[UsageModelWire]) -> Vec<Value> {
    let mut rows = rows.iter().collect::<Vec<_>>();
    rows.sort_by(|left, right| {
        finite_non_negative(right.actual_cost)
            .partial_cmp(&finite_non_negative(left.actual_cost))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    rows.into_iter()
        .take(24)
        .map(|row| {
            json!({
                "modelLabel": safe_label(&row.model),
                "requests": row.requests.max(0),
                "inputTokens": row.input_tokens.max(0),
                "outputTokens": row.output_tokens.max(0),
                "cacheReadTokens": row.cache_read_tokens.max(0),
                "cacheWriteTokens": row.cache_creation_tokens.max(0),
                "totalTokens": row.total_tokens.max(0),
                "cost": money_measure(row.cost),
                "actualCost": money_measure(row.actual_cost),
            })
        })
        .collect()
}

fn usage_intensity(value: f64, maximum: f64) -> u8 {
    let value = finite_non_negative(value);
    let maximum = finite_non_negative(maximum);
    if value == 0.0 || maximum == 0.0 {
        return 0;
    }
    (((value.ln_1p() / maximum.ln_1p()) * 4.0).ceil() as u8).clamp(1, 4)
}

fn money_measure(value: f64) -> Value {
    json!({ "value": canonical_decimal(finite_non_negative(value)), "unit": "usd" })
}

fn finite_non_negative(value: f64) -> f64 {
    if value.is_finite() {
        value.max(0.0)
    } else {
        0.0
    }
}

fn normalize_authority_timestamp(value: &str) -> Option<String> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| {
            timestamp
                .with_timezone(&Utc)
                .to_rfc3339_opts(SecondsFormat::Secs, true)
        })
}

pub(super) fn oauth_binding_views(settings: Option<&PublicSettingsWire>) -> Vec<Value> {
    let Some(settings) = settings else {
        return Vec::new();
    };
    [
        ("auth.oauth.github", settings.github_oauth_enabled),
        ("auth.oauth.google", settings.google_oauth_enabled),
        ("auth.oauth.linuxdo", settings.linuxdo_oauth_enabled),
        ("auth.oauth.wechat", settings.wechat_oauth_enabled),
        ("auth.oauth.oidc", settings.oidc_oauth_enabled),
        ("auth.oauth.dingtalk", settings.dingtalk_oauth_enabled),
    ]
    .into_iter()
    .map(|(provider, _enabled)| {
        json!({
            "provider": provider,
            // Provider settings alone are not execution authority. Binding
            // remains unavailable until the Desktop continuation state
            // machine is implemented and separately guarantee-gated.
            "status": "unavailable",
        })
    })
    .collect()
}

pub(super) fn account_center_value(state: &RuntimeState, profile: &Value) -> Value {
    let display = profile_label(Some(profile));
    let email =
        profile_email_label(Some(profile)).unwrap_or_else(|| "Token service email".to_string());
    let settings = state.public_settings.as_ref();
    let descriptor = state.authority_descriptor.as_ref();
    json!({
        "profile": {
            "displayName": display,
            "primaryEmailLabel": email,
            "avatarKind": "doge",
        },
        "security": {
            "totp": if settings.is_some_and(|value| value.totp_enabled)
                && descriptor.is_some_and(|value| value.supports("totp", &["stable_account_reasons_v1"])) {
                if profile.get("totp_enabled").and_then(Value::as_bool).unwrap_or(false) { "enabled" } else { "disabled" }
            } else { "unavailable" },
            "passwordChange": if descriptor.is_some_and(|value| value.supports("passwordChange", &["stable_account_reasons_v1"])) { "available" } else { "unavailable" },
            "identityBindings": oauth_binding_views(settings),
        },
    })
}

pub(super) fn auth_from_login(login: LoginWire) -> Result<AuthWire, Value> {
    Ok(AuthWire {
        access_token: login
            .access_token
            .filter(|value| !value.is_empty())
            .ok_or_else(|| protocol_failure("login"))?,
        refresh_token: login.refresh_token,
        expires_in: login.expires_in,
        user: login.user,
    })
}

pub(super) fn active_vault_scope(state: &RuntimeState) -> Option<&str> {
    state
        .metadata
        .as_ref()
        .filter(|metadata| metadata.session_status == "active")
        .and_then(|metadata| metadata.vault_scope.as_deref())
}

pub(super) fn managed_vault_scope(state: &RuntimeState) -> Option<&str> {
    state
        .metadata
        .as_ref()
        .filter(|metadata| metadata.managed_key_id.is_some())
        .and_then(|metadata| metadata.vault_scope.as_deref())
}

pub(super) fn account_link_id(profile: &Value) -> Result<String, Value> {
    let remote_id = match profile.get("id") {
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::String(value)) if !value.trim().is_empty() => value.trim().to_string(),
        _ => return Err(protocol_failure("login")),
    };
    let mut hasher = Sha256::new();
    hasher.update(AUTHORITY_ORIGIN_ID.as_bytes());
    hasher.update(b":");
    hasher.update(remote_id.as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    Ok(format!("link_{}", &digest[..32]))
}

pub(super) fn profile_label(profile: Option<&Value>) -> String {
    let value = profile
        .and_then(|value| value.get("username"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Token service account");
    safe_label(value)
}

pub(super) fn profile_email_label(profile: Option<&Value>) -> Option<String> {
    profile
        .and_then(|value| value.get("email"))
        .and_then(Value::as_str)
        .map(mask_email)
}

pub(super) fn mask_email(email: &str) -> String {
    let Some((local, domain)) = email.split_once('@') else {
        return "Token service email".to_string();
    };
    let prefix = local.chars().next().unwrap_or('u');
    let domain = safe_label(domain);
    format!("{prefix}***@{domain}")
}

pub(super) fn safe_label(value: &str) -> String {
    let filtered = value
        .chars()
        .filter(|character| {
            character.is_alphanumeric()
                || matches!(
                    character,
                    ' ' | '.' | '_' | '(' | ')' | '/' | ':' | '+' | '-' | '@' | '*'
                )
        })
        .take(80)
        .collect::<String>();
    if filtered.is_empty() {
        "Token service".to_string()
    } else {
        filtered
    }
}

pub(super) fn prune_attempts(state: &mut RuntimeState) {
    let now = now_epoch();
    state
        .registration_attempts
        .retain(|_, value| value.expires_at > now);
    state.mfa_attempts.retain(|_, value| value.expires_at > now);
    state
        .desktop_authorizations
        .retain(|_, value| value.expires_at > now.saturating_sub(600));
}

pub(super) fn parse_rfc3339_epoch(value: &str) -> Result<i64, Value> {
    let parsed =
        chrono::DateTime::parse_from_rfc3339(value).map_err(|_| protocol_failure("oauth"))?;
    if !value.ends_with('Z') {
        return Err(protocol_failure("oauth"));
    }
    Ok(parsed.timestamp())
}

pub(super) fn valid_remote_authorization_id(value: &str) -> bool {
    (16..=128).contains(&value.len())
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

pub(super) fn external_flow_handle_digest(handle: &str) -> String {
    let digest = Sha256::digest(handle.as_bytes());
    format!("sha256:{digest:x}")
}

pub(super) fn valid_authorize_url(value: &str, expected_host: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(value) else {
        return false;
    };
    url.scheme() == "https"
        && url.host_str() == Some(expected_host)
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
}

pub(super) fn desktop_continuation_failure(error: DesktopContinuationError) -> Value {
    match error {
        DesktopContinuationError::ListenerUnavailable => service_failure("oauth"),
        DesktopContinuationError::AttemptExpired => {
            code_failure("externalIntentExpired", "oauth", "retry")
        }
        DesktopContinuationError::Replay => {
            code_failure("externalIntentConsumed", "oauth", "retry")
        }
        DesktopContinuationError::AttemptMissing
        | DesktopContinuationError::AttemptNotReturned
        | DesktopContinuationError::BindingMismatch
        | DesktopContinuationError::InvalidBinding
        | DesktopContinuationError::CapacityExceeded => protocol_failure("oauth"),
    }
}

pub(super) fn bound_handle(
    kind: &str,
    purpose: &str,
    account_epoch: u64,
    process_generation: u64,
    expires_at: i64,
) -> String {
    format!(
        "handle~{kind}~{purpose}~e{account_epoch}~g{process_generation}~x{expires_at}~{}",
        Uuid::new_v4().simple()
    )
}

pub(super) fn required_string(payload: &Value, key: &str, stage: &str) -> Result<String, Value> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 1024)
        .map(str::to_string)
        .ok_or_else(|| code_failure("validationRejected", stage, "none"))
}

pub(super) fn required_secret(payload: &Value, key: &str, stage: &str) -> Result<String, Value> {
    required_string(payload, key, stage)
}

pub(super) fn required_email(payload: &Value, key: &str, stage: &str) -> Result<String, Value> {
    let value = required_string(payload, key, stage)?;
    if value.len() > 254 || !value.contains('@') || value.chars().any(char::is_whitespace) {
        return Err(edit_failure("validationRejected", stage, "email"));
    }
    Ok(value)
}

pub(super) fn optional_string(payload: &Value, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 1024)
        .map(str::to_string)
}

pub(super) fn authority_failure(error: AuthorityError, stage: &str) -> Value {
    let recovery = match error.safe.code.as_str() {
        "credentialsRejected" => json!({ "action": "editInput", "field": "password" }),
        "rateLimited" => json!({ "action": "retry", "afterMs": error.safe.retry_after_ms }),
        "sessionExpired" | "sessionRevoked" => json!({ "action": "loginAgain" }),
        "serviceUnavailable" => json!({ "action": "retry", "afterMs": Value::Null }),
        "validationRejected" => json!({ "action": "editInput", "field": "code" }),
        _ => json!({ "action": "useLocalMode" }),
    };
    json!({ "code": error.safe.code, "stage": stage, "recovery": recovery })
}

pub(super) fn code_failure(code: &str, stage: &str, action: &str) -> Value {
    let recovery = match action {
        "requestNewCode" => json!({ "action": "requestNewCode", "afterMs": Value::Null }),
        "retry" => json!({ "action": "retry", "afterMs": Value::Null }),
        "editEmail" => json!({ "action": "editInput", "field": "email" }),
        "editPassword" => json!({ "action": "editInput", "field": "password" }),
        other => json!({ "action": other }),
    };
    json!({ "code": code, "stage": stage, "recovery": recovery })
}

pub(super) fn edit_failure(code: &str, stage: &str, field: &str) -> Value {
    json!({ "code": code, "stage": stage, "recovery": { "action": "editInput", "field": field } })
}

pub(super) fn capability_failure(stage: &str) -> Value {
    code_failure("capabilityUnavailable", stage, "useLocalMode")
}

pub(super) fn protocol_failure(stage: &str) -> Value {
    code_failure("protocolMismatch", stage, "useLocalMode")
}

pub(super) fn service_failure(stage: &str) -> Value {
    json!({ "code": "serviceUnavailable", "stage": stage, "recovery": { "action": "retry", "afterMs": Value::Null } })
}

pub(super) fn vault_failure() -> Value {
    code_failure("vaultUnavailable", "vault", "useLocalMode")
}

pub(super) fn persistence_failure() -> Value {
    code_failure("vaultInconsistent", "persistence", "useLocalMode")
}

pub(super) fn session_failure() -> Value {
    code_failure("sessionExpired", "refresh", "loginAgain")
}

pub(super) fn stale_plan_failure() -> Value {
    code_failure("stalePlan", "configurationPlan", "replan")
}

pub(super) fn outcome_unknown_failure(intent: &str) -> Value {
    json!({
        "code": "outcomeUnknown",
        "stage": "persistence",
        "recovery": { "action": "reconcile", "intent": intent },
    })
}

pub(super) fn replayed_terminal_response(
    request_id: &str,
    operation: &str,
    process_generation: u64,
    account_epoch: u64,
    operation_id: &str,
    outcome: Option<&str>,
    intent: &str,
) -> Value {
    let error = if outcome == Some("outcomeUnknown") {
        outcome_unknown_failure(intent)
    } else {
        json!({
            "code": "outcomeUnknown",
            "stage": stage_for_operation(operation),
            "recovery": { "action": "reconcile", "intent": intent },
        })
    };
    json!({
        "contractId": CONTRACT_ID,
        "contractVersion": CONTRACT_VERSION,
        "requestId": request_id,
        "operation": operation,
        "processGeneration": process_generation,
        "accountEpoch": account_epoch,
        "operationId": operation_id,
        "ok": false,
        "error": error,
    })
}

pub(super) fn stage_for_operation(operation: &str) -> &'static str {
    if operation.starts_with("configuration.") {
        if operation == "configuration.apply" {
            "configurationApply"
        } else {
            "configurationPlan"
        }
    } else if operation.starts_with("managedKey.") {
        "managedKey"
    } else if matches!(operation, "usage.read" | "usage.readDayModels") {
        "usage"
    } else if operation == "subscription.read" {
        "subscription"
    } else if operation.starts_with("profile.") {
        "security"
    } else if operation.starts_with("humanVerification.") {
        "challenge"
    } else if operation.contains("OAuth") {
        "oauth"
    } else if operation.contains("PasswordReset") {
        "recover"
    } else if operation == "auth.logout" {
        "logout"
    } else if operation == "auth.beginRegistration" {
        "register"
    } else if operation.contains("RegistrationCode") {
        "verifyEmail"
    } else if operation == "auth.verifyMfa" {
        "mfa"
    } else if operation == "gateway.bootstrap" {
        "capabilities"
    } else {
        "login"
    }
}

pub(super) fn merge_object(mut left: Value, right: Value) -> Value {
    let Some(left) = left.as_object_mut() else {
        return right;
    };
    if let Some(right) = right.as_object() {
        left.extend(right.clone());
    }
    Value::Object(std::mem::take(left))
}

pub(super) fn canonical_decimal(value: f64) -> String {
    let value = finite_non_negative(value);
    let formatted = format!("{value:.6}");
    let trimmed = formatted.trim_end_matches('0').trim_end_matches('.');
    if trimmed.is_empty() {
        "0".to_string()
    } else {
        trimmed.to_string()
    }
}

pub(super) fn now_epoch() -> i64 {
    Utc::now().timestamp()
}

pub(super) fn random_process_generation() -> u64 {
    let bytes = *Uuid::new_v4().as_bytes();
    let generation = u64::from_be_bytes(bytes[..8].try_into().expect("UUID prefix length"));
    generation & ((1_u64 << 53) - 1) | 1
}

pub(super) fn rfc3339_now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

pub(crate) fn rfc3339_from_epoch(epoch: i64) -> String {
    Utc.timestamp_opt(epoch, 0)
        .single()
        .unwrap_or_else(Utc::now)
        .to_rfc3339_opts(SecondsFormat::Secs, true)
}
