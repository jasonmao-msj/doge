use reqwest::{Client, Method, StatusCode};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

pub(crate) use super::authority_contract::{
    AuthorityCapabilityDescriptor, AuthorityCapabilityDescriptorWire,
};
#[cfg(test)]
use super::authority_contract::{AUTHORITY_CONTRACT_ID, AUTHORITY_CONTRACT_VERSION};
use super::desktop_continuation::{DesktopAuthorizationStartWire, DesktopExchangeMaterial};

const PRODUCTION_TOKEN_MATRIX_ORIGIN: &str = "https://token-matrix.com";
pub(crate) const TOKEN_MATRIX_ORIGIN: &str = match option_env!("DOGE_ACCOUNT_AUTHORITY_ORIGIN") {
    Some(value) => value,
    None => PRODUCTION_TOKEN_MATRIX_ORIGIN,
};
const ACCOUNT_AUTHORITY_DESCRIPTOR_PATH: &str = "/api/v1/desktop/v1/authority";
const MAX_AUTHORITY_RESPONSE_BYTES: usize = 1_048_576;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SafeAuthorityFailure {
    pub(crate) code: String,
    pub(crate) retry_after_ms: Option<u64>,
}

#[derive(Debug)]
pub(crate) struct AuthorityError {
    pub(crate) safe: SafeAuthorityFailure,
}

#[derive(Debug, Deserialize)]
struct Envelope<T> {
    code: i64,
    data: Option<T>,
    reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct PublicSettingsWire {
    pub(crate) registration_enabled: bool,
    pub(crate) email_verify_enabled: bool,
    pub(crate) password_reset_enabled: bool,
    pub(crate) totp_enabled: bool,
    pub(crate) github_oauth_enabled: bool,
    pub(crate) google_oauth_enabled: bool,
    #[serde(default)]
    pub(crate) linuxdo_oauth_enabled: bool,
    #[serde(default)]
    pub(crate) wechat_oauth_enabled: bool,
    #[serde(default)]
    pub(crate) oidc_oauth_enabled: bool,
    #[serde(default)]
    pub(crate) dingtalk_oauth_enabled: bool,
    #[serde(default)]
    pub(crate) invitation_code_enabled: bool,
    #[serde(default)]
    pub(crate) promo_code_enabled: bool,
    #[serde(default)]
    pub(crate) login_agreement_enabled: bool,
    #[serde(default)]
    pub(crate) turnstile_enabled: bool,
    pub(crate) api_base_url: Option<String>,
    pub(crate) version: Option<String>,
}

impl PublicSettingsWire {
    pub(crate) fn validate_fixed_authority(&self) -> Result<(), AuthorityError> {
        if self.api_base_url.as_deref() != Some(TOKEN_MATRIX_ORIGIN) {
            return Err(protocol_error());
        }
        let version = self.version.as_deref().ok_or_else(protocol_error)?;
        let mut parts = version.split('.');
        if parts.clone().count() != 3
            || parts.any(|part| part.is_empty() || !part.bytes().all(|byte| byte.is_ascii_digit()))
        {
            return Err(protocol_error());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct AuthWire {
    pub(crate) access_token: String,
    pub(crate) refresh_token: Option<String>,
    pub(crate) expires_in: Option<u64>,
    pub(crate) user: Option<Value>,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct LoginWire {
    pub(crate) requires_2fa: Option<bool>,
    pub(crate) temp_token: Option<String>,
    pub(crate) user_email_masked: Option<String>,
    pub(crate) access_token: Option<String>,
    pub(crate) refresh_token: Option<String>,
    pub(crate) expires_in: Option<u64>,
    pub(crate) user: Option<Value>,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct PlatformQuotaWire {
    pub(crate) platform_quotas: Vec<Value>,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct ApiKeyWire {
    #[serde(alias = "key")]
    pub(crate) secret: String,
    pub(crate) id: i64,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct ApiKeyCandidatesWire {
    pub(crate) keys: Vec<ApiKeyCandidateWire>,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct ApiKeyCandidateWire {
    pub(crate) id: i64,
    pub(crate) name: String,
    pub(crate) key_prefix: String,
    pub(crate) status: String,
    pub(crate) availability: String,
}

#[derive(Clone)]
pub(crate) struct TokenMatrixAuthority {
    client: Client,
    origin: String,
    descriptor_path: Option<&'static str>,
}

impl TokenMatrixAuthority {
    pub(crate) fn new() -> Result<Self, String> {
        if !valid_compiled_authority_origin(TOKEN_MATRIX_ORIGIN) {
            return Err("invalid compiled Account authority origin".to_string());
        }
        let client = Client::builder()
            .https_only(TOKEN_MATRIX_ORIGIN == PRODUCTION_TOKEN_MATRIX_ORIGIN)
            .timeout(Duration::from_secs(20))
            .connect_timeout(Duration::from_secs(8))
            .user_agent(concat!(
                "doge/",
                env!("CARGO_PKG_VERSION"),
                " account-client"
            ))
            .build()
            .map_err(|_| "failed to initialize Account HTTPS client".to_string())?;
        Ok(Self {
            client,
            origin: TOKEN_MATRIX_ORIGIN.to_string(),
            descriptor_path: Some(ACCOUNT_AUTHORITY_DESCRIPTOR_PATH),
        })
    }

    #[cfg(test)]
    pub(super) fn new_for_protocol_test(
        origin: String,
        descriptor_path: Option<&'static str>,
    ) -> Self {
        Self {
            client: Client::builder()
                // Live protocol tests may traverse the production CDN and
                // should exercise the same timeout budget as the runtime
                // client. A two-second test-only budget made healthy public
                // settings requests flaky without proving a protocol fault.
                .timeout(Duration::from_secs(20))
                .build()
                .expect("build protocol-test client"),
            origin,
            descriptor_path,
        }
    }

    pub(crate) async fn public_settings(&self) -> Result<PublicSettingsWire, AuthorityError> {
        let settings: PublicSettingsWire = self
            .request(Method::GET, "/api/v1/settings/public", None, None, None)
            .await?;
        settings.validate_fixed_authority()?;
        Ok(settings)
    }

    pub(crate) async fn capability_descriptor(
        &self,
    ) -> Result<AuthorityCapabilityDescriptor, AuthorityError> {
        let path = self.descriptor_path.ok_or_else(protocol_error)?;
        let wire: AuthorityCapabilityDescriptorWire =
            self.request(Method::GET, path, None, None, None).await?;
        AuthorityCapabilityDescriptor::try_from_wire(wire)
    }

    pub(crate) async fn begin_desktop_oauth(
        &self,
        provider: &str,
        intent: &str,
        callback_uri: &str,
        pkce_challenge: &str,
        state: &str,
        nonce: &str,
        device_id: &str,
        operation_id: &str,
    ) -> Result<DesktopAuthorizationStartWire, AuthorityError> {
        self.request(
            Method::POST,
            "/api/v1/desktop/v1/oauth/authorizations",
            Some(json!({
                "provider": provider,
                "intent": intent,
                "redirect_uri": callback_uri,
                "pkce_challenge": pkce_challenge,
                "pkce_challenge_method": "S256",
                "state": state,
                "nonce": nonce,
                "audience": "doge-desktop",
                "device_id": device_id,
            })),
            None,
            Some(operation_id),
        )
        .await
    }

    pub(crate) async fn exchange_desktop_oauth(
        &self,
        authorization_id: &str,
        material: &DesktopExchangeMaterial,
        device_id: &str,
        operation_id: &str,
    ) -> Result<LoginWire, AuthorityError> {
        let path = format!("/api/v1/desktop/v1/oauth/authorizations/{authorization_id}/exchange");
        self.request(
            Method::POST,
            &path,
            Some(json!({
                "desktop_ticket": material.ticket(),
                "pkce_verifier": material.pkce_verifier(),
                "nonce": material.nonce(),
                "redirect_uri": material.callback_uri(),
                "audience": "doge-desktop",
                "device_id": device_id,
            })),
            None,
            Some(operation_id),
        )
        .await
    }

    pub(crate) async fn send_registration_code(
        &self,
        email: &str,
    ) -> Result<Value, AuthorityError> {
        self.request(
            Method::POST,
            "/api/v1/auth/send-verify-code",
            Some(json!({ "email": email })),
            None,
            None,
        )
        .await
    }

    pub(crate) async fn register(
        &self,
        email: &str,
        password: &str,
        verify_code: Option<&str>,
        invitation_code: Option<&str>,
        promo_code: Option<&str>,
    ) -> Result<AuthWire, AuthorityError> {
        self.request(
            Method::POST,
            "/api/v1/auth/register",
            Some(json!({
                "email": email,
                "password": password,
                "verify_code": verify_code.unwrap_or_default(),
                "invitation_code": invitation_code.unwrap_or_default(),
                "promo_code": promo_code.unwrap_or_default(),
            })),
            None,
            None,
        )
        .await
    }

    pub(crate) async fn login(
        &self,
        email: &str,
        password: &str,
    ) -> Result<LoginWire, AuthorityError> {
        self.request(
            Method::POST,
            "/api/v1/auth/login",
            Some(json!({ "email": email, "password": password })),
            None,
            None,
        )
        .await
    }

    pub(crate) async fn verify_mfa(
        &self,
        temp_token: &str,
        totp_code: &str,
    ) -> Result<AuthWire, AuthorityError> {
        self.request(
            Method::POST,
            "/api/v1/auth/login/2fa",
            Some(json!({ "temp_token": temp_token, "totp_code": totp_code })),
            None,
            None,
        )
        .await
    }

    pub(crate) async fn refresh(&self, refresh_token: &str) -> Result<AuthWire, AuthorityError> {
        self.request(
            Method::POST,
            "/api/v1/auth/refresh",
            Some(json!({ "refresh_token": refresh_token })),
            None,
            None,
        )
        .await
    }

    pub(crate) async fn me(&self, access_token: &str) -> Result<Value, AuthorityError> {
        self.request(
            Method::GET,
            "/api/v1/auth/me",
            None,
            Some(access_token),
            None,
        )
        .await
    }

    pub(crate) async fn profile(&self, access_token: &str) -> Result<Value, AuthorityError> {
        self.request(
            Method::GET,
            "/api/v1/user/profile",
            None,
            Some(access_token),
            None,
        )
        .await
    }

    pub(crate) async fn update_profile(
        &self,
        access_token: &str,
        display_name: &str,
    ) -> Result<Value, AuthorityError> {
        self.request(
            Method::PUT,
            "/api/v1/user",
            Some(json!({ "username": display_name })),
            Some(access_token),
            None,
        )
        .await
    }

    pub(crate) async fn change_password(
        &self,
        access_token: &str,
        current_password: &str,
        new_password: &str,
    ) -> Result<Value, AuthorityError> {
        self.request(
            Method::PUT,
            "/api/v1/user/password",
            Some(json!({
                "old_password": current_password,
                "new_password": new_password,
            })),
            Some(access_token),
            None,
        )
        .await
    }

    pub(crate) async fn quota(
        &self,
        access_token: &str,
    ) -> Result<PlatformQuotaWire, AuthorityError> {
        self.request(
            Method::GET,
            "/api/v1/user/platform-quotas",
            None,
            Some(access_token),
            None,
        )
        .await
    }

    pub(crate) async fn create_managed_key(
        &self,
        access_token: &str,
        operation_id: &str,
    ) -> Result<ApiKeyWire, AuthorityError> {
        self.request(
            Method::POST,
            "/api/v1/desktop/v1/managed-keys",
            Some(json!({
                "name": "Doge Codex managed key",
                "ip_whitelist": [],
                "ip_blacklist": [],
            })),
            Some(access_token),
            Some(operation_id),
        )
        .await
    }

    pub(crate) async fn list_api_key_candidates(
        &self,
        access_token: &str,
    ) -> Result<ApiKeyCandidatesWire, AuthorityError> {
        self.request(
            Method::GET,
            "/api/v1/desktop/v1/api-keys",
            None,
            Some(access_token),
            None,
        )
        .await
    }

    pub(crate) async fn handoff_api_key(
        &self,
        access_token: &str,
        key_id: i64,
        device_id: &str,
        operation_id: &str,
    ) -> Result<ApiKeyWire, AuthorityError> {
        self.request(
            Method::POST,
            &format!("/api/v1/desktop/v1/api-keys/{key_id}/handoffs"),
            Some(json!({
                "audience": "doge-desktop",
                "device_id": device_id,
                "recipe_id": "doge.account.codex-token-service",
                "recipe_version": 1,
            })),
            Some(access_token),
            Some(operation_id),
        )
        .await
    }

    pub(crate) async fn delete_managed_key(
        &self,
        access_token: &str,
        key_id: i64,
    ) -> Result<Value, AuthorityError> {
        self.request(
            Method::DELETE,
            &format!("/api/v1/keys/{key_id}"),
            None,
            Some(access_token),
            None,
        )
        .await
    }

    pub(crate) async fn logout(&self, refresh_token: &str) -> Result<Value, AuthorityError> {
        self.request(
            Method::POST,
            "/api/v1/auth/logout",
            Some(json!({ "refresh_token": refresh_token })),
            None,
            None,
        )
        .await
    }

    pub(crate) async fn revoke_all(&self, access_token: &str) -> Result<Value, AuthorityError> {
        self.request(
            Method::POST,
            "/api/v1/auth/revoke-all-sessions",
            Some(json!({})),
            Some(access_token),
            None,
        )
        .await
    }

    async fn request<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        access_token: Option<&str>,
        idempotency_key: Option<&str>,
    ) -> Result<T, AuthorityError> {
        if !path.starts_with("/api/v1/") || path.contains("..") {
            return Err(authority_error("protocolMismatch", None));
        }
        let url = format!("{}{path}", self.origin);
        let mut request = self
            .client
            .request(method, url)
            .header("Accept", "application/json");
        if let Some(body) = body {
            request = request.json(&body);
        }
        if let Some(access_token) = access_token {
            request = request.bearer_auth(access_token);
        }
        if let Some(idempotency_key) = idempotency_key {
            request = request.header("Idempotency-Key", idempotency_key);
        }
        let mut response = request
            .send()
            .await
            .map_err(|_| authority_error("serviceUnavailable", None))?;
        let status = response.status();
        let retry_after_ms = retry_after_ms(response.headers().get("retry-after"));
        if response
            .content_length()
            .is_some_and(|length| length > MAX_AUTHORITY_RESPONSE_BYTES as u64)
        {
            return Err(authority_error("protocolMismatch", retry_after_ms));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| authority_error("protocolMismatch", retry_after_ms))?
        {
            if bytes.len().saturating_add(chunk.len()) > MAX_AUTHORITY_RESPONSE_BYTES {
                return Err(authority_error("protocolMismatch", retry_after_ms));
            }
            bytes.extend_from_slice(&chunk);
        }
        let envelope: Envelope<T> = serde_json::from_slice(&bytes)
            .map_err(|_| authority_error("protocolMismatch", retry_after_ms))?;
        if status.is_success() && envelope.code == 0 {
            return envelope
                .data
                .ok_or_else(|| authority_error("protocolMismatch", retry_after_ms));
        }
        let reason = envelope.reason.as_deref().unwrap_or_default();
        Err(authority_error(map_reason(status, reason), retry_after_ms))
    }
}

fn valid_compiled_authority_origin(origin: &str) -> bool {
    if origin == PRODUCTION_TOKEN_MATRIX_ORIGIN {
        return true;
    }
    let Ok(url) = reqwest::Url::parse(origin) else {
        return false;
    };
    url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1" | "localhost"))
        && url.port().is_some()
        && url.path() == "/"
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
}

fn authority_error(code: &str, retry_after_ms: Option<u64>) -> AuthorityError {
    AuthorityError {
        safe: SafeAuthorityFailure {
            code: code.to_string(),
            retry_after_ms,
        },
    }
}

pub(super) fn protocol_error() -> AuthorityError {
    authority_error("protocolMismatch", None)
}

fn map_reason(status: StatusCode, reason: &str) -> &'static str {
    match reason {
        "INVALID_CREDENTIALS" => "credentialsRejected",
        "EMAIL_EXISTS" | "EMAIL_RESERVED" => "accountNotAllowed",
        "REGISTRATION_DISABLED" | "PASSWORD_RESET_DISABLED" => "capabilityUnavailable",
        "INVALID_VERIFY_CODE" => "verificationRejected",
        "VERIFY_CODE_MAX_ATTEMPTS" => "verificationExpired",
        "TOTP_INVALID_CODE" => "mfaRejected",
        "REFRESH_TOKEN_INVALID" | "REFRESH_TOKEN_EXPIRED" | "TOKEN_EXPIRED" => "sessionExpired",
        "REFRESH_TOKEN_REUSED" | "TOKEN_REVOKED" => "sessionRevoked",
        "INVALID_IP_PATTERN" => "validationRejected",
        _ if status == StatusCode::TOO_MANY_REQUESTS => "rateLimited",
        _ if status.is_server_error() => "serviceUnavailable",
        // Unknown mutation reasons are contract drift, never editable validation.
        _ if status.is_client_error() => "protocolMismatch",
        _ => "unknownSafeFailure",
    }
}

fn retry_after_ms(value: Option<&reqwest::header::HeaderValue>) -> Option<u64> {
    value
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .and_then(|seconds| seconds.checked_mul(1_000))
        .map(|milliseconds| milliseconds.min(300_000))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::State,
        http::HeaderMap,
        routing::{get, post},
        Json, Router,
    };
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    fn settings(api_base_url: Option<&str>, version: Option<&str>) -> PublicSettingsWire {
        PublicSettingsWire {
            registration_enabled: true,
            email_verify_enabled: true,
            password_reset_enabled: true,
            totp_enabled: false,
            github_oauth_enabled: false,
            google_oauth_enabled: false,
            linuxdo_oauth_enabled: false,
            wechat_oauth_enabled: false,
            oidc_oauth_enabled: false,
            dingtalk_oauth_enabled: false,
            invitation_code_enabled: false,
            promo_code_enabled: false,
            login_agreement_enabled: false,
            turnstile_enabled: false,
            api_base_url: api_base_url.map(str::to_string),
            version: version.map(str::to_string),
        }
    }

    #[test]
    fn public_settings_must_attest_fixed_origin_and_semver_shape() {
        settings(Some(TOKEN_MATRIX_ORIGIN), Some("0.1.172"))
            .validate_fixed_authority()
            .expect("current production descriptor shape");
        for invalid in [
            settings(None, Some("0.1.172")),
            settings(Some("https://unexpected.invalid"), Some("0.1.172")),
            settings(Some(TOKEN_MATRIX_ORIGIN), None),
            settings(Some(TOKEN_MATRIX_ORIGIN), Some("latest")),
        ] {
            assert_eq!(
                invalid
                    .validate_fixed_authority()
                    .expect_err("invalid authority descriptor")
                    .safe
                    .code,
                "protocolMismatch"
            );
        }
    }

    #[test]
    fn origin_is_fixed_https_and_error_mapping_never_uses_raw_message() {
        assert_eq!(TOKEN_MATRIX_ORIGIN, "https://token-matrix.com");
        assert_eq!(
            map_reason(StatusCode::UNAUTHORIZED, "untrusted raw server text"),
            "protocolMismatch"
        );
        assert_eq!(map_reason(StatusCode::TOO_MANY_REQUESTS, ""), "rateLimited");
    }

    #[test]
    fn compiled_authority_override_is_loopback_only() {
        assert!(valid_compiled_authority_origin("https://token-matrix.com"));
        assert!(valid_compiled_authority_origin("http://127.0.0.1:18080"));
        assert!(valid_compiled_authority_origin("http://localhost:18080"));
        for invalid in [
            "http://token-matrix.com:18080",
            "https://127.0.0.1:18080",
            "http://user@127.0.0.1:18080",
            "http://127.0.0.1:18080/path",
        ] {
            assert!(!valid_compiled_authority_origin(invalid), "{invalid}");
        }
    }

    #[test]
    fn authority_descriptor_is_closed_and_capability_scoped() {
        let descriptor = AuthorityCapabilityDescriptor::try_from_wire(
            AuthorityCapabilityDescriptorWire::test_fixture(
                vec!["durable_token_pair_v1", "stable_account_reasons_v1"],
                HashMap::from([
                    ("passwordLogin".to_string(), true),
                    ("profile".to_string(), false),
                ]),
            ),
        )
        .expect("valid descriptor");
        assert!(descriptor.supports(
            "passwordLogin",
            &["durable_token_pair_v1", "stable_account_reasons_v1"]
        ));
        assert!(!descriptor.supports("profile", &["stable_account_reasons_v1"]));
        assert!(!descriptor.supports("passwordLogin", &["atomic_refresh_replay_v1"]));

        for invalid in [
            AuthorityCapabilityDescriptorWire::test_fixture(Vec::new(), HashMap::new())
                .with_contract_id("unexpected-authority"),
            AuthorityCapabilityDescriptorWire::test_fixture(Vec::new(), HashMap::new())
                .with_contract_version("2.0.0"),
            AuthorityCapabilityDescriptorWire::test_fixture(Vec::new(), HashMap::new())
                .with_observed_at("2030-01-01T00:00:00+01:00"),
            AuthorityCapabilityDescriptorWire::test_fixture(
                vec!["unknown_guarantee_v1"],
                HashMap::new(),
            ),
            AuthorityCapabilityDescriptorWire::test_fixture(
                vec!["durable_token_pair_v1", "durable_token_pair_v1"],
                HashMap::new(),
            ),
            AuthorityCapabilityDescriptorWire::test_fixture(
                Vec::new(),
                HashMap::from([("futureCapability".to_string(), true)]),
            ),
        ] {
            assert_eq!(
                AuthorityCapabilityDescriptor::try_from_wire(invalid)
                    .expect_err("closed descriptor must fail")
                    .safe
                    .code,
                "protocolMismatch"
            );
        }
    }

    async fn spawn_protocol_server(app: Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind protocol server");
        let address = listener.local_addr().expect("protocol address");
        tokio::spawn(async move {
            axum::serve(listener, app)
                .await
                .expect("serve protocol test");
        });
        format!("http://{address}")
    }

    #[tokio::test]
    async fn production_adapter_parses_current_envelope_and_sends_scoped_headers() {
        let captured = Arc::new(Mutex::new(Vec::<(String, String)>::new()));
        let app = Router::new()
            .route(
                "/api/v1/settings/public",
                get(|| async {
                    Json(json!({
                        "code": 0,
                        "message": "success",
                        "data": {
                            "registration_enabled": true,
                            "email_verify_enabled": true,
                            "password_reset_enabled": true,
                            "totp_enabled": false,
                            "github_oauth_enabled": false,
                            "google_oauth_enabled": false,
                            "api_base_url": "https://token-matrix.com",
                            "version": "0.1.172",
                        },
                    }))
                }),
            )
            .route(
                "/api/v1/desktop/v1/managed-keys",
                post({
                    move |State(captured): State<Arc<Mutex<Vec<(String, String)>>>>,
                          headers: HeaderMap,
                          Json(body): Json<Value>| async move {
                        captured.lock().expect("capture headers").push((
                            headers
                                .get("authorization")
                                .and_then(|value| value.to_str().ok())
                                .unwrap_or_default()
                                .to_string(),
                            headers
                                .get("idempotency-key")
                                .and_then(|value| value.to_str().ok())
                                .unwrap_or_default()
                                .to_string(),
                        ));
                        assert_eq!(body["name"], "Doge Codex managed key");
                        Json(json!({ "code": 0, "data": { "secret": "synthetic-key", "id": 7 } }))
                    }
                }),
            )
            .with_state(Arc::clone(&captured));
        let origin = spawn_protocol_server(app).await;
        let authority = TokenMatrixAuthority::new_for_protocol_test(origin, None);

        let settings = authority.public_settings().await.expect("public settings");
        assert!(settings.registration_enabled);
        let key = authority
            .create_managed_key("synthetic-access", "operation_abcdefgh")
            .await
            .expect("managed key");
        assert_eq!(key.id, 7);
        assert_eq!(key.secret, "synthetic-key");
        assert_eq!(
            captured.lock().expect("captured request").as_slice(),
            &[(
                "Bearer synthetic-access".to_string(),
                "operation_abcdefgh".to_string(),
            )],
        );
    }

    #[tokio::test]
    async fn production_adapter_fails_closed_for_rate_limit_and_malformed_envelope() {
        let app = Router::new()
            .route(
                "/api/v1/settings/public",
                get(|| async { (StatusCode::OK, "not-json") }),
            )
            .route(
                "/api/v1/auth/login",
                post(|| async {
                    (
                        StatusCode::TOO_MANY_REQUESTS,
                        [("retry-after", "9")],
                        Json(json!({ "code": 429, "reason": "UNTRUSTED_SERVER_TEXT" })),
                    )
                }),
            );
        let origin = spawn_protocol_server(app).await;
        let authority = TokenMatrixAuthority::new_for_protocol_test(origin, None);

        let malformed = authority
            .public_settings()
            .await
            .expect_err("malformed response");
        assert_eq!(malformed.safe.code, "protocolMismatch");
        let limited = authority
            .login("synthetic@example.invalid", "synthetic-password")
            .await
            .expect_err("rate limited");
        assert_eq!(limited.safe.code, "rateLimited");
        assert_eq!(limited.safe.retry_after_ms, Some(9_000));
    }

    #[tokio::test]
    async fn production_descriptor_path_is_frozen() {
        let app = Router::new().route(
            ACCOUNT_AUTHORITY_DESCRIPTOR_PATH,
            get(|| async {
                Json(json!({
                    "code": 0,
                    "data": {
                        "contractId": AUTHORITY_CONTRACT_ID,
                        "contractVersion": AUTHORITY_CONTRACT_VERSION,
                        "observedAt": "2030-01-01T00:00:00Z",
                        "capabilities": { "passwordLogin": true },
                        "guarantees": [
                            "durable_token_pair_v1",
                            "atomic_refresh_replay_v1",
                            "stable_account_reasons_v1"
                        ]
                    }
                }))
            }),
        );
        let origin = spawn_protocol_server(app).await;
        let descriptor = TokenMatrixAuthority::new_for_protocol_test(
            origin,
            Some(ACCOUNT_AUTHORITY_DESCRIPTOR_PATH),
        )
        .capability_descriptor()
        .await
        .expect("frozen test route descriptor");
        assert!(descriptor.supports(
            "passwordLogin",
            &[
                "durable_token_pair_v1",
                "atomic_refresh_replay_v1",
                "stable_account_reasons_v1"
            ]
        ));
    }
}
