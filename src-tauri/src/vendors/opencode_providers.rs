//! OpenCode CLI vendor/provider management.
//!
//! Provider definitions live in doge's `config.json` under the `opencode`
//! section (same pattern as claude/codex/kimi/grok providers). Unlike
//! kimi/grok, switching a provider does NOT materialize anything into the
//! OpenCode config file yet — the engine spawn path consumes
//! [`resolve_opencode_provider`] directly (OPENCODE_CONFIG_CONTENT injection
//! is wired separately).
//!
//! The special `__local_opencode_json__` provider means "leave the user's own
//! opencode.json alone".

use std::time::Duration;

use serde_json::Value;

use crate::types::OpenCodeProviderConfig;

use super::commands::{
    derive_model_list_candidates, extract_vendor_model_ids, next_provider_created_at, read_config,
    set_provider_created_at, updated_provider_created_at, write_config, VendorModelListResult,
};

const LOCAL_OPENCODE_PROVIDER_ID: &str = "__local_opencode_json__";
const LOCAL_OPENCODE_PROVIDER_NAME: &str = "Local opencode.json";
const LOCAL_OPENCODE_PROVIDER_REMARK: &str =
    "Use configuration directly from ~/.config/opencode/opencode.json";

fn build_local_provider(is_active: bool) -> OpenCodeProviderConfig {
    OpenCodeProviderConfig {
        id: LOCAL_OPENCODE_PROVIDER_ID.to_string(),
        name: LOCAL_OPENCODE_PROVIDER_NAME.to_string(),
        remark: Some(LOCAL_OPENCODE_PROVIDER_REMARK.to_string()),
        website_url: None,
        created_at: Some(0),
        sort_order: None,
        is_active,
        is_local_provider: Some(true),
        base_url: String::new(),
        api_key: String::new(),
        models: Vec::new(),
    }
}

fn opencode_provider_to_value(provider: &OpenCodeProviderConfig) -> Value {
    let mut map = serde_json::Map::new();
    map.insert("id".into(), Value::String(provider.id.clone()));
    map.insert("name".into(), Value::String(provider.name.clone()));
    if let Some(ref remark) = provider.remark {
        map.insert("remark".into(), Value::String(remark.clone()));
    }
    if let Some(ref url) = provider.website_url {
        map.insert("websiteUrl".into(), Value::String(url.clone()));
    }
    if let Some(ts) = provider.created_at {
        map.insert("createdAt".into(), Value::Number(ts.into()));
    }
    if let Some(order) = provider.sort_order {
        map.insert("sortOrder".into(), Value::Number(order.into()));
    }
    if let Some(local) = provider.is_local_provider {
        map.insert("isLocalProvider".into(), Value::Bool(local));
    }
    map.insert("baseUrl".into(), Value::String(provider.base_url.clone()));
    map.insert("apiKey".into(), Value::String(provider.api_key.clone()));
    map.insert(
        "models".into(),
        Value::Array(
            provider
                .models
                .iter()
                .map(|model| Value::String(model.clone()))
                .collect(),
        ),
    );
    Value::Object(map)
}

/// Convert a raw JSON Value from the config.json `opencode.providers` map
/// into an OpenCodeProviderConfig for the frontend.
fn value_to_opencode_provider(
    id: &str,
    value: &Value,
    is_active: bool,
) -> Result<OpenCodeProviderConfig, String> {
    let name = value
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let remark = value
        .get("remark")
        .and_then(|v| v.as_str())
        .map(String::from);
    let website_url = value
        .get("websiteUrl")
        .and_then(|v| v.as_str())
        .map(String::from);
    let created_at = value.get("createdAt").and_then(|v| v.as_i64());
    let sort_order = value.get("sortOrder").and_then(|v| v.as_i64());
    let is_local_provider = value.get("isLocalProvider").and_then(|v| v.as_bool());
    let base_url = value
        .get("baseUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let api_key = value
        .get("apiKey")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let models = value
        .get("models")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    Ok(OpenCodeProviderConfig {
        id: id.to_string(),
        name,
        remark,
        website_url,
        created_at,
        sort_order,
        is_active,
        is_local_provider,
        base_url,
        api_key,
        models,
    })
}

fn sort_opencode_providers(providers: &mut [OpenCodeProviderConfig]) {
    providers.sort_by(|a, b| {
        a.sort_order
            .unwrap_or(i64::MAX)
            .cmp(&b.sort_order.unwrap_or(i64::MAX))
            .then_with(|| a.created_at.unwrap_or(0).cmp(&b.created_at.unwrap_or(0)))
            .then_with(|| a.id.cmp(&b.id))
    });
}

/// Resolve a stored OpenCode provider definition by id.
///
/// Kept for vendor-surface callers; the engine spawn path uses the
/// self-contained resolver in `engine::opencode_provider_profile` (which also
/// compiles into the daemon crate).
#[allow(dead_code)]
pub(crate) fn resolve_opencode_provider(profile_id: &str) -> Option<OpenCodeProviderConfig> {
    let profile_id = profile_id.trim();
    if profile_id.is_empty() || profile_id == LOCAL_OPENCODE_PROVIDER_ID {
        return None;
    }
    let config = read_config().ok()?;
    let value = config.opencode.providers.get(profile_id)?;
    let is_active = config.opencode.current.as_deref() == Some(profile_id);
    value_to_opencode_provider(profile_id, value, is_active).ok()
}

// ==================== OpenCode Provider Commands ====================

#[tauri::command]
pub(crate) async fn vendor_get_opencode_providers() -> Result<Vec<OpenCodeProviderConfig>, String> {
    let config = read_config()?;
    let current = config.opencode.current.as_deref();
    let mut regular_providers: Vec<OpenCodeProviderConfig> = config
        .opencode
        .providers
        .iter()
        .filter_map(|(id, value)| {
            if id == LOCAL_OPENCODE_PROVIDER_ID {
                return None;
            }
            let is_active = current == Some(id.as_str());
            value_to_opencode_provider(id, value, is_active).ok()
        })
        .collect();
    sort_opencode_providers(&mut regular_providers);

    let mut providers = Vec::with_capacity(regular_providers.len() + 1);
    providers.push(build_local_provider(
        current == Some(LOCAL_OPENCODE_PROVIDER_ID),
    ));
    providers.extend(regular_providers);

    Ok(providers)
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenCodeCurrentConfig {
    api_key: String,
    base_url: String,
    auth_type: String,
    default_model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    provider_name: Option<String>,
    config_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    diagnostic: Option<String>,
}

#[tauri::command]
pub(crate) async fn vendor_get_current_opencode_config() -> Result<OpenCodeCurrentConfig, String> {
    let (config_status, _path, document, diagnostic) =
        crate::engine::status::read_opencode_config_document();

    let default_model = document
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // Best-effort: opencode keeps per-provider options under
    // `provider.<id>.options` (`apiKey` / `baseURL`); credentials usually live
    // in auth.json instead, so empty values are normal.
    let provider_prefix = default_model
        .split_once('/')
        .map(|(provider, _)| provider)
        .unwrap_or("");
    let provider_options = if provider_prefix.is_empty() {
        None
    } else {
        document
            .get("provider")
            .and_then(|v| v.as_object())
            .and_then(|providers| providers.get(provider_prefix))
            .and_then(|provider| provider.get("options"))
            .and_then(|v| v.as_object())
    };
    let api_key = provider_options
        .and_then(|options| options.get("apiKey"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let base_url = provider_options
        .and_then(|options| options.get("baseURL"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let config = read_config()?;
    let provider_id = config.opencode.current.clone();
    let provider_name = provider_id.as_ref().and_then(|id| {
        if id == LOCAL_OPENCODE_PROVIDER_ID {
            return Some(LOCAL_OPENCODE_PROVIDER_NAME.to_string());
        }
        config
            .opencode
            .providers
            .get(id)
            .and_then(|provider| provider.get("name"))
            .and_then(|name| name.as_str())
            .map(String::from)
    });

    Ok(OpenCodeCurrentConfig {
        auth_type: if api_key.is_empty() {
            "none".to_string()
        } else {
            "api_key".to_string()
        },
        api_key,
        base_url,
        default_model,
        provider_id,
        provider_name,
        config_status,
        diagnostic,
    })
}

/// Canonical write target for official OpenCode global config when no existing
/// candidate file is present: `~/.config/opencode/opencode.json` (docs default).
fn opencode_default_config_path() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    Ok(home.join(".config").join("opencode").join("opencode.json"))
}

/// Prefer an already-existing candidate (`$OPENCODE_CONFIG`,
/// `~/.config/opencode/opencode.json(c)`, `~/.opencode/opencode.json(c)`);
/// otherwise fall back to the documented global path.
fn opencode_config_write_path() -> Result<std::path::PathBuf, String> {
    if let Some(existing) = crate::engine::status::opencode_config_candidate_paths()
        .into_iter()
        .find(|candidate| candidate.is_file())
    {
        return Ok(existing);
    }
    opencode_default_config_path()
}

/// Read raw official OpenCode global config. Missing file returns empty string.
#[tauri::command]
pub(crate) async fn vendor_read_opencode_config_json() -> Result<String, String> {
    let path = match crate::engine::status::opencode_config_candidate_paths()
        .into_iter()
        .find(|candidate| candidate.is_file())
    {
        Some(path) => path,
        None => return Ok(String::new()),
    };
    std::fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {}", path.display(), error))
}

/// Write official OpenCode global config.
///
/// Validates as a JSON object when the target path ends with `.json`. For
/// existing `.jsonc` files, content is written as-is after a non-empty check
/// (JSONC comments are not re-serialized).
#[tauri::command]
pub(crate) async fn vendor_save_opencode_config_json(content: String) -> Result<(), String> {
    let path = opencode_config_write_path()?;
    let is_jsonc = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("jsonc"));

    let to_write = if content.trim().is_empty() {
        content
    } else if is_jsonc {
        // Preserve user JSONC as-is; full JSONC parse is not available in-tree.
        content
    } else {
        let value: serde_json::Value = serde_json::from_str(&content)
            .map_err(|error| format!("Invalid JSON in {}: {error}", path.display()))?;
        if !value.is_object() {
            return Err(format!("{} must contain a JSON object.", path.display()));
        }
        serde_json::to_string_pretty(&value)
            .map_err(|error| format!("Failed to serialize {}: {error}", path.display()))?
    };

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }
    let tmp_path = path.with_extension(format!(
        "{}.tmp",
        path.extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("json")
    ));
    std::fs::write(&tmp_path, &to_write)
        .map_err(|error| format!("Failed to write temp file {}: {error}", tmp_path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp_path, &path).map_err(|error| {
        let _ = std::fs::remove_file(&tmp_path);
        format!("Failed to replace {}: {error}", path.display())
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn vendor_add_opencode_provider(
    provider: OpenCodeProviderConfig,
) -> Result<(), String> {
    if provider.id == LOCAL_OPENCODE_PROVIDER_ID {
        return Err("Reserved provider id".to_string());
    }
    let mut config = read_config()?;
    if config.opencode.providers.contains_key(&provider.id) {
        return Err(format!("Provider with id {} already exists", provider.id));
    }
    let created_at = provider
        .created_at
        .unwrap_or_else(|| next_provider_created_at(&config.opencode.providers));
    let mut provider_value = opencode_provider_to_value(&provider);
    set_provider_created_at(&mut provider_value, created_at);
    config
        .opencode
        .providers
        .insert(provider.id.clone(), provider_value);
    write_config(&config)
}

#[tauri::command]
pub(crate) async fn vendor_update_opencode_provider(
    id: String,
    updates: OpenCodeProviderConfig,
) -> Result<(), String> {
    if id == LOCAL_OPENCODE_PROVIDER_ID {
        return Err("Local opencode.json provider cannot be updated".to_string());
    }
    let mut config = read_config()?;
    if !config.opencode.providers.contains_key(&id) {
        return Err(format!("Provider {} not found", id));
    }
    let existing_created_at =
        updated_provider_created_at(config.opencode.providers.get(&id), updates.created_at);
    let mut provider_value = opencode_provider_to_value(&updates);
    if let Some(created_at) = existing_created_at {
        set_provider_created_at(&mut provider_value, created_at);
    }
    config.opencode.providers.insert(id, provider_value);
    write_config(&config)
}

#[tauri::command]
pub(crate) async fn vendor_delete_opencode_provider(id: String) -> Result<(), String> {
    if id == LOCAL_OPENCODE_PROVIDER_ID {
        return Err("Local opencode.json provider cannot be deleted".to_string());
    }
    let mut config = read_config()?;
    if config.opencode.providers.remove(&id).is_none() {
        return Err(format!("Provider {} not found", id));
    }
    if config.opencode.current.as_ref() == Some(&id) {
        config.opencode.current = None;
    }
    write_config(&config)
}

/// Pseudo id: clear `opencode.current` so no managed/local provider is active.
const DISABLED_OPENCODE_PROVIDER_ID: &str = "__disabled__";

#[tauri::command]
pub(crate) async fn vendor_switch_opencode_provider(id: String) -> Result<(), String> {
    let mut config = read_config()?;
    // 「取消使用」: 清空 current，不改用户本地 opencode 配置
    if id == DISABLED_OPENCODE_PROVIDER_ID {
        config.opencode.current = None;
        write_config(&config)?;
        return Ok(());
    }
    if id == LOCAL_OPENCODE_PROVIDER_ID {
        config.opencode.current = Some(id);
        write_config(&config)?;
        return Ok(());
    }
    if !config.opencode.providers.contains_key(&id) {
        return Err(format!("Provider {} not found", id));
    }
    // No materialization into opencode.json: the spawn path resolves the
    // active provider via resolve_opencode_provider.
    config.opencode.current = Some(id);
    write_config(&config)?;

    Ok(())
}

#[tauri::command]
pub(crate) async fn vendor_fetch_opencode_models(
    base_url: String,
    api_key: String,
) -> Result<VendorModelListResult, String> {
    if base_url.trim().is_empty() {
        return Err("API URL is required".to_string());
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Failed to build HTTP client: {error}"))?;
    let api_key = api_key.trim().to_string();
    let mut last_error: Option<String> = None;

    for endpoint in derive_model_list_candidates(&base_url) {
        let response = match client
            .get(&endpoint)
            .header("Authorization", format!("Bearer {api_key}"))
            .header("x-api-key", api_key.as_str())
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                last_error = Some(format!("{endpoint}: {error}"));
                continue;
            }
        };

        let status = response.status();
        if !status.is_success() {
            last_error = Some(format!("{endpoint} returned HTTP {status}"));
            continue;
        }

        let body = match response.text().await {
            Ok(body) => body,
            Err(error) => {
                last_error = Some(format!("{endpoint}: failed to read response body: {error}"));
                continue;
            }
        };

        let value = match serde_json::from_str::<Value>(&body) {
            Ok(value) => value,
            Err(error) => {
                last_error = Some(format!(
                    "{endpoint}: failed to parse JSON response: {error}"
                ));
                continue;
            }
        };

        return Ok(VendorModelListResult {
            models: extract_vendor_model_ids(&value),
            endpoint,
        });
    }

    Err(format!(
        "Failed to fetch models: {}",
        last_error.unwrap_or_else(|| "no candidate endpoint succeeded".to_string())
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn sample_provider() -> OpenCodeProviderConfig {
        OpenCodeProviderConfig {
            id: "openai".to_string(),
            name: "OpenAI".to_string(),
            remark: None,
            website_url: None,
            created_at: Some(1),
            sort_order: None,
            is_active: false,
            is_local_provider: None,
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            models: vec![
                "openai/gpt-5.3-codex".to_string(),
                "openai/gpt-5-nano".to_string(),
            ],
        }
    }

    #[test]
    fn provider_value_round_trips_all_fields() {
        let provider = sample_provider();
        let value = opencode_provider_to_value(&provider);
        let parsed = value_to_opencode_provider(&provider.id, &value, true).expect("round-trip");
        assert_eq!(parsed.name, "OpenAI");
        assert_eq!(parsed.base_url, "https://api.openai.com/v1");
        assert_eq!(parsed.api_key, "sk-test");
        assert_eq!(
            parsed.models,
            vec![
                "openai/gpt-5.3-codex".to_string(),
                "openai/gpt-5-nano".to_string()
            ]
        );
        assert!(parsed.is_active);
    }

    #[test]
    fn provider_value_tolerates_missing_optional_fields() {
        let parsed =
            value_to_opencode_provider("demo", &serde_json::json!({ "name": "Demo" }), false)
                .expect("minimal value parses");
        assert_eq!(parsed.id, "demo");
        assert_eq!(parsed.name, "Demo");
        assert!(parsed.models.is_empty());
        assert!(parsed.base_url.is_empty());
        assert!(parsed.api_key.is_empty());
        assert!(!parsed.is_active);
    }

    #[test]
    fn local_provider_uses_reserved_id() {
        let local = build_local_provider(true);
        assert_eq!(local.id, LOCAL_OPENCODE_PROVIDER_ID);
        assert!(local.is_active);
        assert_eq!(local.is_local_provider, Some(true));
    }

    #[test]
    fn opencode_section_defaults_are_empty() {
        let section: super::super::commands::OpenCodeSection = Default::default();
        assert!(section.providers.is_empty());
        assert!(section.current.is_none());
        let _: HashMap<String, Value> = section.providers;
    }

    #[test]
    fn local_provider_id_is_never_resolvable() {
        assert!(resolve_opencode_provider(LOCAL_OPENCODE_PROVIDER_ID).is_none());
        assert!(resolve_opencode_provider("").is_none());
        assert!(resolve_opencode_provider("  ").is_none());
    }
}
