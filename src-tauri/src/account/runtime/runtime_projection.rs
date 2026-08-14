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
        "usage.read" => AuthorityRequirement::new("quotaPull", stable),
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
    let turnstile = settings.is_some_and(|value| value.turnstile_enabled);
    let entries = json!({
        "auth.emailPasswordLogin": if settings_available && !turnstile { guaranteed("passwordLogin", &["durable_token_pair_v1", "atomic_refresh_replay_v1", "stable_account_reasons_v1"]) } else { enabled(false) },
        "auth.registration": if settings.is_some_and(|value| value.registration_enabled) && !turnstile { guaranteed("registration", &["durable_token_pair_v1", "atomic_refresh_replay_v1", "stable_account_reasons_v1"]) } else { enabled(false) },
        "auth.registrationEmailVerification": if settings.is_some_and(|value| value.email_verify_enabled) && !turnstile { guaranteed("registrationEmailVerification", &["durable_token_pair_v1", "stable_account_reasons_v1"]) } else { enabled(false) },
        "auth.passwordReset": desktop_gap(settings.is_some_and(|value| value.password_reset_enabled) && !turnstile),
        "auth.humanVerification": desktop_gap(turnstile),
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
        "subscription.summary": { "status": "disabled", "reason": "featureFlagOff" },
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
                "humanVerificationRequired": turnstile,
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

pub(super) fn quota_value(rows: &[Value], fetched_at: &str) -> Value {
    for row in rows {
        for prefix in ["monthly", "weekly", "daily"] {
            let limit_key = format!("{prefix}_limit_usd");
            let usage_key = format!("{prefix}_usage_usd");
            let reset_key = format!("{prefix}_window_resets_at");
            let Some(limit) = row.get(&limit_key).and_then(Value::as_f64) else {
                continue;
            };
            let used = row
                .get(&usage_key)
                .and_then(Value::as_f64)
                .unwrap_or(0.0)
                .max(0.0);
            return json!({
                "status": "available",
                "source": "token2apiPlatformQuota",
                "freshness": "fresh",
                "observedAt": fetched_at,
                "fetchedAt": fetched_at,
                "remaining": { "value": canonical_decimal((limit - used).max(0.0)), "unit": "usd" },
                "used": { "value": canonical_decimal(used), "unit": "usd" },
                "resetsAt": row.get(&reset_key).cloned().unwrap_or(Value::Null),
                "subscriptionLabel": row.get("platform").and_then(Value::as_str).map(safe_label).map(Value::String).unwrap_or(Value::Null),
            });
        }
    }
    json!({
        "status": "unavailable",
        "source": "token2apiPlatformQuota",
        "freshness": "fresh",
        "observedAt": fetched_at,
        "fetchedAt": fetched_at,
        "remaining": Value::Null,
        "used": Value::Null,
        "resetsAt": Value::Null,
        "subscriptionLabel": Value::Null,
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
    } else if operation == "usage.read" {
        "usage"
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
