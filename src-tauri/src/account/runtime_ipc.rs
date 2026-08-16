use super::configuration::ACCOUNT_RECIPE_ID;
use super::runtime::{CONTRACT_ID, CONTRACT_VERSION, OPERATIONS, READ_OPERATIONS};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub(crate) async fn account_v1_context(
    state: State<'_, crate::state::AppState>,
    window: tauri::Window,
) -> Result<Value, String> {
    require_main_account_window(&window)?;
    Ok(state.account_runtime.contract_context().await)
}

#[tauri::command]
pub(crate) async fn account_v1_prepare_mutation(
    request: Value,
    state: State<'_, crate::state::AppState>,
    window: tauri::Window,
) -> Result<String, String> {
    require_main_account_window(&window)?;
    state
        .account_runtime
        .prepare_mutation(&request)
        .await
        .map_err(|_| "Account request could not be prepared".to_string())
}

#[tauri::command]
pub(crate) async fn account_v1_execute(
    request: Value,
    operation_id: Option<String>,
    app: AppHandle,
    state: State<'_, crate::state::AppState>,
    window: tauri::Window,
) -> Result<Value, String> {
    require_main_account_window(&window)?;
    let operation = request
        .get("operation")
        .and_then(Value::as_str)
        .map(str::to_string);
    let response = state
        .account_runtime
        .execute(request, operation_id)
        .await
        .map_err(|_| "Account request was rejected at the native boundary".to_string())?;
    if response.get("ok") == Some(&Value::Bool(true)) {
        if let Some(operation) = operation.as_deref() {
            // Mutation responses correlate to the request epoch; wake-up
            // events publish the authoritative post-mutation epoch.
            let account_epoch = state.account_runtime.current_epoch().await;
            if let Some(event) = state.account_runtime.wakeup_event(operation, account_epoch) {
                let _ = app.emit("doge://account-v1/wakeup", event);
            }
        }
    }
    Ok(response)
}

#[tauri::command]
pub(crate) async fn account_engine_v1_catalog(
    state: State<'_, crate::state::AppState>,
    window: tauri::Window,
) -> Result<Value, String> {
    require_main_account_window(&window)?;
    Ok(state.account_runtime.engine_catalog_snapshot().await)
}

#[tauri::command]
pub(crate) async fn account_engine_v1_plans(
    engine_id: String,
    state: State<'_, crate::state::AppState>,
    window: tauri::Window,
) -> Result<Value, String> {
    require_main_account_window(&window)?;
    Ok(state
        .account_runtime
        .engine_plans_snapshot(&engine_id)
        .await)
}

#[tauri::command]
pub(crate) async fn account_engine_v1_create_checkout(
    engine_id: String,
    plan_id: i64,
    payment_type: String,
    operation_id: String,
    state: State<'_, crate::state::AppState>,
    window: tauri::Window,
) -> Result<Value, String> {
    require_main_account_window(&window)?;
    Ok(state
        .account_runtime
        .engine_checkout_create(&engine_id, plan_id, &payment_type, &operation_id)
        .await)
}

#[tauri::command]
pub(crate) async fn account_engine_v1_checkout(
    checkout_id: i64,
    state: State<'_, crate::state::AppState>,
    window: tauri::Window,
) -> Result<Value, String> {
    require_main_account_window(&window)?;
    Ok(state
        .account_runtime
        .engine_checkout_snapshot(checkout_id)
        .await)
}

#[tauri::command]
pub(crate) async fn account_engine_v1_pending_checkout(
    state: State<'_, crate::state::AppState>,
    window: tauri::Window,
) -> Result<Value, String> {
    require_main_account_window(&window)?;
    Ok(state
        .account_runtime
        .engine_pending_checkout_snapshot()
        .await)
}

#[tauri::command]
pub(crate) async fn account_engine_v1_readiness(
    engine_id: String,
    state: State<'_, crate::state::AppState>,
    window: tauri::Window,
) -> Result<Value, String> {
    require_main_account_window(&window)?;
    Ok(state
        .account_runtime
        .engine_readiness_snapshot(&engine_id)
        .await)
}

#[tauri::command]
pub(crate) async fn account_engine_v1_prepare(
    engine_id: String,
    operation_id: String,
    state: State<'_, crate::state::AppState>,
    window: tauri::Window,
) -> Result<Value, String> {
    require_main_account_window(&window)?;
    Ok(state
        .account_runtime
        .engine_prepare(&engine_id, &operation_id)
        .await)
}

pub(super) fn require_main_account_window(window: &tauri::Window) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Account request was rejected at the native boundary".to_string())
    }
}

pub(super) struct ValidatedRequest<'a> {
    pub(super) kind: &'a str,
    pub(super) request_id: &'a str,
    pub(super) operation: &'a str,
    pub(super) account_epoch: Option<u64>,
    pub(super) intent_id: Option<&'a str>,
    pub(super) payload: &'a Value,
}

pub(super) fn validate_request(
    value: &Value,
    expected_process_generation: u64,
) -> Result<ValidatedRequest<'_>, String> {
    let object = value
        .as_object()
        .ok_or_else(|| "Account IPC request must be an object".to_string())?;
    let operation = object
        .get("operation")
        .and_then(Value::as_str)
        .filter(|value| OPERATIONS.contains(value))
        .ok_or_else(|| "Account IPC operation is unsupported".to_string())?;
    let expected_kind = if READ_OPERATIONS.contains(&operation) {
        "read"
    } else {
        "mutation"
    };
    let required_keys = if expected_kind == "read" { 8 } else { 9 };
    if object.len() != required_keys
        || object.get("contractId").and_then(Value::as_str) != Some(CONTRACT_ID)
        || object.get("contractVersion").and_then(Value::as_str) != Some(CONTRACT_VERSION)
        || object.get("kind").and_then(Value::as_str) != Some(expected_kind)
        || object.get("processGeneration").and_then(Value::as_u64)
            != Some(expected_process_generation)
        || !object.contains_key("payload")
    {
        return Err("Account IPC envelope is invalid".to_string());
    }
    let allowed = if expected_kind == "read" {
        [
            "contractId",
            "contractVersion",
            "requestId",
            "operation",
            "kind",
            "processGeneration",
            "accountEpoch",
            "payload",
            "",
        ]
    } else {
        [
            "contractId",
            "contractVersion",
            "requestId",
            "operation",
            "kind",
            "processGeneration",
            "accountEpoch",
            "intentId",
            "payload",
        ]
    };
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err("Account IPC envelope contains an unexpected field".to_string());
    }
    let request_id = object
        .get("requestId")
        .and_then(Value::as_str)
        .filter(|value| valid_opaque_id(value, "request"))
        .ok_or_else(|| "Account request id is invalid".to_string())?;
    let intent_id = if expected_kind == "mutation" {
        Some(
            object
                .get("intentId")
                .and_then(Value::as_str)
                .filter(|value| valid_opaque_id(value, "intent"))
                .ok_or_else(|| "Account intent id is invalid".to_string())?,
        )
    } else {
        None
    };
    let account_epoch = match object.get("accountEpoch") {
        Some(Value::Number(value)) => value.as_u64(),
        Some(Value::Null) => None,
        _ => return Err("Account epoch is invalid".to_string()),
    };
    if expected_kind == "mutation" && account_epoch.is_none() {
        return Err("Account mutation requires an epoch".to_string());
    }
    Ok(ValidatedRequest {
        kind: expected_kind,
        request_id,
        operation,
        account_epoch,
        intent_id,
        payload: &object["payload"],
    })
}

pub(super) fn validate_operation_payload(operation: &str, payload: &Value) -> Result<(), String> {
    let null = || {
        if payload.is_null() {
            Ok(())
        } else {
            Err("Account operation requires a null payload".to_string())
        }
    };
    match operation {
        "gateway.bootstrap"
        | "profile.read"
        | "usage.read"
        | "configuration.readOffer"
        | "configuration.readCurrentTask"
        | "profile.requestTotpEmailCode" => null(),
        "gateway.reconcileIntent" => {
            exact_payload(payload, &["intent", "expected"], &[]).and_then(|object| {
                let intent = object
                    .get("intent")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let expected = object
                    .get("expected")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if valid_opaque_id(intent, "intent") && OPERATIONS.contains(&expected) {
                    Ok(())
                } else {
                    Err("Account reconciliation payload is invalid".to_string())
                }
            })
        }
        "humanVerification.readRequirement" => {
            exact_payload(payload, &["purpose"], &[]).and_then(|object| {
                closed_value(
                    object,
                    "purpose",
                    &["register", "login", "registrationCode", "passwordReset"],
                )
            })
        }
        "humanVerification.submitProof" => exact_payload(payload, &["purpose", "proof"], &[])
            .and_then(|object| {
                closed_value(
                    object,
                    "purpose",
                    &["register", "login", "registrationCode", "passwordReset"],
                )
            }),
        "auth.beginRegistration" => exact_payload(
            payload,
            &["email", "password", "agreementAccepted"],
            &["invitationCode", "promoCode", "humanVerification"],
        )
        .and_then(|object| {
            if object
                .get("agreementAccepted")
                .and_then(Value::as_bool)
                .is_none()
            {
                Err("Account registration agreement field is invalid".to_string())
            } else {
                Ok(())
            }
        }),
        "auth.resendRegistrationCode" => {
            exact_payload(payload, &["attempt"], &["humanVerification"]).map(drop)
        }
        "auth.submitRegistrationCode" | "auth.verifyMfa" => {
            exact_payload(payload, &["attempt", "code"], &[]).map(drop)
        }
        "auth.login" => {
            exact_payload(payload, &["email", "password"], &["humanVerification"]).map(drop)
        }
        "auth.startOAuth" | "profile.startIdentityBinding" | "profile.unbindIdentity" => {
            exact_payload(payload, &["provider"], &[]).and_then(|object| {
                closed_value(
                    object,
                    "provider",
                    &[
                        "auth.oauth.github",
                        "auth.oauth.google",
                        "auth.oauth.linuxdo",
                        "auth.oauth.wechat",
                        "auth.oauth.oidc",
                        "auth.oauth.dingtalk",
                    ],
                )
            })
        }
        "auth.cancelOAuth" | "auth.readOAuthAttempt" => {
            exact_payload(payload, &["attempt"], &[]).map(drop)
        }
        "auth.completeOAuthAccount" => exact_payload(
            payload,
            &["attempt"],
            &["email", "invitationCode", "mfaCode", "bindConfirmed"],
        )
        .map(drop),
        "auth.requestPasswordReset" => {
            exact_payload(payload, &["email"], &["humanVerification"]).map(drop)
        }
        "auth.inspectExternalIntent" => exact_payload(payload, &["intent"], &[]).map(drop),
        "auth.resetPassword" => exact_payload(payload, &["intent", "newPassword"], &[]).map(drop),
        "auth.logout" => exact_payload(payload, &["scope"], &[])
            .and_then(|object| closed_value(object, "scope", &["thisDevice", "allSessions"])),
        "profile.updateProfile" => exact_payload(payload, &["displayName"], &[]).map(drop),
        "profile.changePassword" => {
            exact_payload(payload, &["currentPassword", "newPassword"], &[]).map(drop)
        }
        "profile.beginTotpEnrollment" | "profile.disableTotp" => {
            exact_payload(payload, &["verification"], &[]).map(drop)
        }
        "profile.confirmTotpEnrollment" => {
            exact_payload(payload, &["enrollment", "code"], &[]).map(drop)
        }
        "profile.revokeAllSessions" => exact_payload(payload, &["consent"], &[])
            .and_then(|object| closed_value(object, "consent", &["revokeAllSessions"])),
        "managedKey.readStatus" | "managedKey.listCandidates" | "configuration.hardDismiss" => {
            validate_recipe_payload(payload, None)
        }
        "managedKey.selectExisting" => exact_payload(
            payload,
            &["recipeId", "recipeVersion", "key", "consent"],
            &[],
        )
        .and_then(validate_recipe_object)
        .and_then(|object| closed_value(object, "consent", &["useSelectedApiKey"])),
        "managedKey.provision" => {
            validate_recipe_payload(payload, Some(("consent", "provisionDedicatedKey")))
        }
        "managedKey.rotate" => {
            validate_recipe_payload(payload, Some(("consent", "rotateDedicatedKey")))
        }
        "managedKey.revoke" => {
            validate_recipe_payload(payload, Some(("consent", "removeLocalKey")))
        }
        "configuration.createPlan" => {
            exact_payload(payload, &["recipeId", "recipeVersion", "intent"], &[])
                .and_then(|object| validate_recipe_object(object))
                .and_then(|object| closed_value(object, "intent", &["configure", "review"]))
        }
        "configuration.readFileDetail" => exact_payload(payload, &["plan", "file"], &[]).map(drop),
        "configuration.apply" => exact_payload(payload, &["plan", "consent"], &[])
            .and_then(|object| closed_value(object, "consent", &["applyExactPlan"])),
        "configuration.acknowledgeResult" => exact_payload(payload, &["result"], &[]).map(drop),
        _ => Err("Account operation payload validation is missing".to_string()),
    }
}

pub(super) fn exact_payload<'a>(
    payload: &'a Value,
    required: &[&str],
    optional: &[&str],
) -> Result<&'a serde_json::Map<String, Value>, String> {
    let object = payload
        .as_object()
        .ok_or_else(|| "Account operation payload must be an object".to_string())?;
    if required.iter().any(|key| !object.contains_key(*key))
        || object
            .keys()
            .any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str()))
    {
        return Err("Account operation payload fields are invalid".to_string());
    }
    Ok(object)
}

pub(super) fn closed_value(
    object: &serde_json::Map<String, Value>,
    key: &str,
    values: &[&str],
) -> Result<(), String> {
    if object
        .get(key)
        .and_then(Value::as_str)
        .is_some_and(|value| values.contains(&value))
    {
        Ok(())
    } else {
        Err(format!("Account payload field {key} is invalid"))
    }
}

pub(super) fn validate_recipe_payload(
    payload: &Value,
    extra: Option<(&str, &str)>,
) -> Result<(), String> {
    let mut required = vec!["recipeId", "recipeVersion"];
    if let Some((key, _)) = extra {
        required.push(key);
    }
    let object = exact_payload(payload, &required, &[])?;
    validate_recipe_object(object)?;
    if let Some((key, expected)) = extra {
        closed_value(object, key, &[expected])?;
    }
    Ok(())
}

pub(super) fn validate_recipe_object(
    object: &serde_json::Map<String, Value>,
) -> Result<&serde_json::Map<String, Value>, String> {
    if object.get("recipeId").and_then(Value::as_str) == Some(ACCOUNT_RECIPE_ID)
        && object.get("recipeVersion").and_then(Value::as_u64) == Some(1)
    {
        Ok(object)
    } else {
        Err("Account recipe identity is invalid".to_string())
    }
}

pub(super) fn fingerprint(value: &Value) -> Result<String, String> {
    let bytes =
        serde_json::to_vec(value).map_err(|_| "Account request fingerprint failed".to_string())?;
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

fn valid_opaque_id(value: &str, prefix: &str) -> bool {
    value.starts_with(&format!("{prefix}_"))
        && value.len() >= prefix.len() + 9
        && value.len() <= 160
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
}

pub(super) fn mutation_fingerprint(operation: &str, payload: &Value) -> Result<String, String> {
    fingerprint(&json!({ "operation": operation, "payload": payload }))
}
