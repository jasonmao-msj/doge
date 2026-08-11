//! Grok CLI vendor/provider management.
//!
//! Provider definitions live in doge's `config.json` under the `grok` section
//! (same pattern as claude/codex/kimi providers). Switching a provider
//! materializes it into `~/.grok/config.toml` under namespaced keys so
//! user-managed entries stay untouched:
//!
//! - `model."doge/<model>"` with `model` / `base_url` / `name` / `api_key` /
//!   `api_backend` / `context_window`
//! - `models.default = "doge/<model>"`
//!
//! The special `__local_config_toml__` provider means "leave config.toml alone".

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;

use crate::types::GrokProviderConfig;

use super::commands::{
    derive_model_list_candidates, extract_vendor_model_ids, next_provider_created_at, read_config,
    set_provider_created_at, updated_provider_created_at, write_config, VendorModelListResult,
};

use crate::engine::grok_provider_profile::{
    materialize_grok_provider_at, value_to_grok_provider, GROK_LOCAL_PROVIDER_PROFILE_ID,
};

const LOCAL_GROK_PROVIDER_ID: &str = GROK_LOCAL_PROVIDER_PROFILE_ID;
const LOCAL_GROK_PROVIDER_NAME: &str = "Local config.toml";
const LOCAL_GROK_PROVIDER_REMARK: &str = "Use configuration directly from ~/.grok/config.toml";
const GROK_MODEL_TOML_PREFIX: &str = "doge/";
const LEGACY_GROK_MODEL_TOML_PREFIXES: &[&str] = &["ccgui/"];

fn grok_config_toml_path() -> Result<PathBuf, String> {
    if let Some(home) = std::env::var_os("GROK_HOME").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(home).join("config.toml"));
    }
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    Ok(home.join(".grok").join("config.toml"))
}

fn build_local_provider(is_active: bool) -> GrokProviderConfig {
    GrokProviderConfig {
        id: LOCAL_GROK_PROVIDER_ID.to_string(),
        name: LOCAL_GROK_PROVIDER_NAME.to_string(),
        remark: Some(LOCAL_GROK_PROVIDER_REMARK.to_string()),
        website_url: None,
        created_at: Some(0),
        sort_order: None,
        is_active,
        is_local_provider: Some(true),
        base_url: String::new(),
        api_key: String::new(),
        model: String::new(),
        provider_type: None,
        max_context_size: None,
        display_name: None,
        api_backend: None,
    }
}

fn grok_provider_to_value(provider: &GrokProviderConfig) -> Value {
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
    map.insert("model".into(), Value::String(provider.model.clone()));
    if let Some(ref provider_type) = provider.provider_type {
        map.insert("providerType".into(), Value::String(provider_type.clone()));
    }
    if let Some(max_context_size) = provider.max_context_size {
        map.insert(
            "maxContextSize".into(),
            Value::Number(max_context_size.into()),
        );
    }
    if let Some(ref display_name) = provider.display_name {
        map.insert("displayName".into(), Value::String(display_name.clone()));
    }
    if let Some(ref api_backend) = provider.api_backend {
        map.insert("apiBackend".into(), Value::String(api_backend.clone()));
    }
    Value::Object(map)
}

fn sort_grok_providers(providers: &mut [GrokProviderConfig]) {
    providers.sort_by(|a, b| {
        a.sort_order
            .unwrap_or(i64::MAX)
            .cmp(&b.sort_order.unwrap_or(i64::MAX))
            .then_with(|| a.created_at.unwrap_or(0).cmp(&b.created_at.unwrap_or(0)))
            .then_with(|| a.id.cmp(&b.id))
    });
}

/// Materialize the given provider into ~/.grok/config.toml.
/// The original file is backed up to config.toml.bak before rewriting.
fn apply_provider_to_grok_config(provider: &GrokProviderConfig) -> Result<(), String> {
    let path = grok_config_toml_path()?;
    materialize_grok_provider_at(provider, &path, true)
}

/// Remove the provider's doge and legacy namespaced model entries (and a dangling
/// `[models].default` pointing at it) while keeping durable provider deletion
/// independent from external config cleanup.
fn cleanup_provider_from_grok_config(provider: &GrokProviderConfig) -> Result<(), String> {
    let path = grok_config_toml_path()?;
    cleanup_provider_from_grok_config_at(&path, provider)
}

fn cleanup_provider_from_grok_config_at(
    path: &Path,
    provider: &GrokProviderConfig,
) -> Result<(), String> {
    let original = match std::fs::read_to_string(path) {
        Ok(original) => original,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Failed to read residual Grok config {}: {}",
                path.display(),
                error
            ))
        }
    };
    if original.trim().is_empty() {
        return Ok(());
    }
    let mut doc = toml::from_str::<toml::Table>(&original)
        .map_err(|error| format!("Failed to parse residual Grok config: {error}"))?;

    let model = provider.model.trim();
    if model.is_empty() {
        return Ok(());
    }
    let model_toml_aliases = std::iter::once(GROK_MODEL_TOML_PREFIX)
        .chain(LEGACY_GROK_MODEL_TOML_PREFIXES.iter().copied())
        .map(|prefix| format!("{prefix}{model}"))
        .collect::<Vec<_>>();
    let mut dirty = false;

    if let Some(models) = doc.get_mut("model").and_then(|v| v.as_table_mut()) {
        for model_toml_alias in &model_toml_aliases {
            dirty |= models.remove(model_toml_alias).is_some();
        }
    }

    let default_is_dangling = doc
        .get("models")
        .and_then(|v| v.as_table())
        .and_then(|models| models.get("default"))
        .and_then(|v| v.as_str())
        .is_some_and(|value| model_toml_aliases.iter().any(|alias| alias == value));
    if default_is_dangling {
        if let Some(models) = doc.get_mut("models").and_then(|v| v.as_table_mut()) {
            models.remove("default");
            dirty = true;
        }
    }

    if !dirty {
        return Ok(());
    }
    let rendered = toml::to_string_pretty(&doc)
        .map_err(|error| format!("Failed to serialize residual Grok config: {error}"))?;
    replace_grok_config(path, rendered)
}

fn replace_grok_config(path: &Path, rendered: String) -> Result<(), String> {
    let tmp_path = path.with_extension("toml.tmp");
    std::fs::write(&tmp_path, rendered)
        .map_err(|error| format!("Failed to write residual Grok config: {error}"))?;
    std::fs::rename(&tmp_path, path)
        .map_err(|error| format!("Failed to replace residual Grok config: {error}"))
}

// ==================== Grok Provider Commands ====================

#[tauri::command]
pub(crate) async fn vendor_get_grok_providers() -> Result<Vec<GrokProviderConfig>, String> {
    let config = read_config()?;
    let current = config.grok.current.as_deref();
    let mut regular_providers: Vec<GrokProviderConfig> = config
        .grok
        .providers
        .iter()
        .filter_map(|(id, value)| {
            if id == LOCAL_GROK_PROVIDER_ID {
                return None;
            }
            let is_active = current == Some(id.as_str());
            value_to_grok_provider(id, value, is_active).ok()
        })
        .collect();
    sort_grok_providers(&mut regular_providers);

    let mut providers = Vec::with_capacity(regular_providers.len() + 1);
    providers.push(build_local_provider(
        current == Some(LOCAL_GROK_PROVIDER_ID),
    ));
    providers.extend(regular_providers);

    Ok(providers)
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GrokCurrentConfig {
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

fn read_grok_config_document(path: &Path) -> (String, toml::Table, Option<String>) {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return ("missing".to_string(), toml::Table::new(), None)
        }
        Err(error) => {
            return (
                "io-error".to_string(),
                toml::Table::new(),
                Some(format!("Failed to read {}: {}", path.display(), error)),
            )
        }
    };
    if raw.trim().is_empty() {
        return ("loaded".to_string(), toml::Table::new(), None);
    }
    match toml::from_str(&raw) {
        Ok(doc) => ("loaded".to_string(), doc, None),
        Err(error) => (
            "malformed".to_string(),
            toml::Table::new(),
            Some(format!("Failed to parse {}: {}", path.display(), error)),
        ),
    }
}

fn model_entry_has_credentials(table: &toml::Table) -> bool {
    table
        .get("base_url")
        .and_then(|x| x.as_str())
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false)
        || table
            .get("api_key")
            .and_then(|x| x.as_str())
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false)
}

fn extract_base_url_api_key_from_model_table(table: &toml::Table) -> (String, String) {
    let base_url = table
        .get("base_url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let api_key = table
        .get("api_key")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    (base_url, api_key)
}

/// 从已解析的 Grok config.toml 表中抽取 default model 的 base_url + api_key。
/// 兼容：`models.default` 与 `[model.<key>]` 键名不一致（例如 default=`grok-4.5` 但表键为 `grok`）。
pub(crate) fn extract_base_url_api_key_from_grok_toml(doc: &toml::Table) -> (String, String) {
    let default_model = doc
        .get("models")
        .and_then(|v| v.as_table())
        .and_then(|models| models.get("default"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    let Some(model_table) = doc.get("model").and_then(|v| v.as_table()) else {
        return (String::new(), String::new());
    };

    // 1) 精确键：model.<default>
    if !default_model.is_empty() {
        if let Some(table) = model_table.get(&default_model).and_then(|v| v.as_table()) {
            if model_entry_has_credentials(table) {
                return extract_base_url_api_key_from_model_table(table);
            }
        }
        // 2) model 字段值 == default
        for value in model_table.values() {
            let Some(table) = value.as_table() else {
                continue;
            };
            let model_name = table
                .get("model")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if model_name == default_model && model_entry_has_credentials(table) {
                return extract_base_url_api_key_from_model_table(table);
            }
        }
    }

    // 3) 任意带凭据的 model 条目
    for value in model_table.values() {
        let Some(table) = value.as_table() else {
            continue;
        };
        if model_entry_has_credentials(table) {
            return extract_base_url_api_key_from_model_table(table);
        }
    }

    (String::new(), String::new())
}

/// 从 `$GROK_HOME/config.toml` / `~/.grok/config.toml` 读取当前 default model 的 base_url + api_key。
/// Local provider（`__local_config_toml__`）额度查询依赖此路径：用户可能直接改 toml 指向中转站。
pub(crate) fn read_local_grok_base_url_and_key() -> Result<(String, String), String> {
    let path = grok_config_toml_path()?;
    let (status, doc, diagnostic) = read_grok_config_document(&path);
    if status == "io-error" || status == "malformed" {
        return Err(
            diagnostic.unwrap_or_else(|| format!("Failed to read Grok config.toml ({status})"))
        );
    }
    if status == "missing" {
        return Ok((String::new(), String::new()));
    }
    Ok(extract_base_url_api_key_from_grok_toml(&doc))
}

#[tauri::command]
pub(crate) async fn vendor_get_current_grok_config() -> Result<GrokCurrentConfig, String> {
    let path = grok_config_toml_path()?;
    let (config_status, doc, diagnostic) = read_grok_config_document(&path);

    let default_model = doc
        .get("models")
        .and_then(|v| v.as_table())
        .and_then(|models| models.get("default"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let (mut api_key, mut base_url) = (String::new(), String::new());
    if !default_model.is_empty() {
        if let Some(model_entry) = doc
            .get("model")
            .and_then(|v| v.as_table())
            .and_then(|models| models.get(&default_model))
            .and_then(|v| v.as_table())
        {
            api_key = model_entry
                .get("api_key")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            base_url = model_entry
                .get("base_url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
        }
    }

    let config = read_config()?;
    let provider_id = config.grok.current.clone();
    let provider_name = provider_id.as_ref().and_then(|id| {
        if id == LOCAL_GROK_PROVIDER_ID {
            return Some(LOCAL_GROK_PROVIDER_NAME.to_string());
        }
        config
            .grok
            .providers
            .get(id)
            .and_then(|provider| provider.get("name"))
            .and_then(|name| name.as_str())
            .map(String::from)
    });

    Ok(GrokCurrentConfig {
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

/// Read raw official Grok Build config (`$GROK_HOME/config.toml` or
/// `~/.grok/config.toml`). Missing file returns an empty string so the editor
/// can create one.
#[tauri::command]
pub(crate) async fn vendor_read_grok_config_toml() -> Result<String, String> {
    let path = grok_config_toml_path()?;
    match std::fs::read_to_string(&path) {
        Ok(content) => Ok(content),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(format!("Failed to read {}: {}", path.display(), error)),
    }
}

/// Write official Grok Build config after validating TOML table syntax.
#[tauri::command]
pub(crate) async fn vendor_save_grok_config_toml(content: String) -> Result<(), String> {
    let path = grok_config_toml_path()?;
    if !content.trim().is_empty() {
        toml::from_str::<toml::Table>(&content)
            .map_err(|error| format!("Invalid TOML in {}: {error}", path.display()))?;
    }
    atomic_write_text_file(&path, &content, "toml")
}

fn atomic_write_text_file(path: &Path, content: &str, tmp_ext: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }
    let tmp_path = path.with_extension(format!("{tmp_ext}.tmp"));
    std::fs::write(&tmp_path, content)
        .map_err(|error| format!("Failed to write temp file {}: {error}", tmp_path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp_path, std::fs::Permissions::from_mode(0o600));
    }
    std::fs::rename(&tmp_path, path).map_err(|error| {
        let _ = std::fs::remove_file(&tmp_path);
        format!("Failed to replace {}: {error}", path.display())
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn vendor_add_grok_provider(provider: GrokProviderConfig) -> Result<(), String> {
    if provider.id == LOCAL_GROK_PROVIDER_ID {
        return Err("Reserved provider id".to_string());
    }
    let mut config = read_config()?;
    if config.grok.providers.contains_key(&provider.id) {
        return Err(format!("Provider with id {} already exists", provider.id));
    }
    let created_at = provider
        .created_at
        .unwrap_or_else(|| next_provider_created_at(&config.grok.providers));
    let mut provider_value = grok_provider_to_value(&provider);
    set_provider_created_at(&mut provider_value, created_at);
    config
        .grok
        .providers
        .insert(provider.id.clone(), provider_value);
    write_config(&config)
}

#[tauri::command]
pub(crate) async fn vendor_update_grok_provider(
    id: String,
    updates: GrokProviderConfig,
) -> Result<(), String> {
    if id == LOCAL_GROK_PROVIDER_ID {
        return Err("Local config.toml provider cannot be updated".to_string());
    }
    let mut config = read_config()?;
    if !config.grok.providers.contains_key(&id) {
        return Err(format!("Provider {} not found", id));
    }
    let existing_created_at =
        updated_provider_created_at(config.grok.providers.get(&id), updates.created_at);
    let mut provider_value = grok_provider_to_value(&updates);
    if let Some(created_at) = existing_created_at {
        set_provider_created_at(&mut provider_value, created_at);
    }
    let is_current = config.grok.current.as_deref() == Some(id.as_str());
    config.grok.providers.insert(id.clone(), provider_value);
    write_config(&config)?;

    // Keep the materialized config.toml in sync when editing the active provider.
    if is_current {
        apply_provider_to_grok_config(&updates)?;
    }
    Ok(())
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GrokProviderDeleteResult {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    warning: Option<String>,
}

#[tauri::command]
pub(crate) async fn vendor_delete_grok_provider(
    id: String,
) -> Result<GrokProviderDeleteResult, String> {
    if id == LOCAL_GROK_PROVIDER_ID {
        return Err("Local config.toml provider cannot be deleted".to_string());
    }
    let mut config = read_config()?;
    let provider_value = config
        .grok
        .providers
        .remove(&id)
        .ok_or_else(|| format!("Provider {} not found", id))?;
    if config.grok.current.as_ref() == Some(&id) {
        config.grok.current = None;
    }
    write_config(&config)?;
    let provider = value_to_grok_provider(&id, &provider_value, false)?;
    match cleanup_provider_from_grok_config(&provider) {
        Ok(()) => Ok(GrokProviderDeleteResult {
            status: "success".to_string(),
            warning: None,
        }),
        Err(warning) => Ok(GrokProviderDeleteResult {
            status: "partial-warning".to_string(),
            warning: Some(format!(
                "Provider deleted, but residual ~/.grok/config.toml cleanup failed: {warning}"
            )),
        }),
    }
}

/// Pseudo id: clear `grok.current` so no managed/local provider is active.
const DISABLED_GROK_PROVIDER_ID: &str = "__disabled__";

#[tauri::command]
pub(crate) async fn vendor_switch_grok_provider(id: String) -> Result<(), String> {
    let mut config = read_config()?;
    // 「取消使用」: 清空 current，不改 ~/.grok/config.toml
    if id == DISABLED_GROK_PROVIDER_ID {
        config.grok.current = None;
        write_config(&config)?;
        return Ok(());
    }
    if id == LOCAL_GROK_PROVIDER_ID {
        config.grok.current = Some(id);
        write_config(&config)?;
        return Ok(());
    }
    let provider_value = config
        .grok
        .providers
        .get(&id)
        .ok_or_else(|| format!("Provider {} not found", id))?
        .clone();
    let provider = value_to_grok_provider(&id, &provider_value, true)?;
    config.grok.current = Some(id.clone());
    write_config(&config)?;

    apply_provider_to_grok_config(&provider)?;

    Ok(())
}

#[tauri::command]
pub(crate) async fn vendor_fetch_grok_models(
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
    use std::time::{SystemTime, UNIX_EPOCH};

    fn config_test_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "ccgui-grok-config-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ))
    }

    fn sample_provider() -> GrokProviderConfig {
        GrokProviderConfig {
            id: "xai".to_string(),
            name: "xAI".to_string(),
            remark: None,
            website_url: None,
            created_at: Some(1),
            sort_order: None,
            is_active: false,
            is_local_provider: None,
            base_url: "https://api.x.ai/v1".to_string(),
            api_key: "sk-test".to_string(),
            model: "grok-build".to_string(),
            provider_type: None,
            max_context_size: Some(128000),
            display_name: Some("Grok Build".to_string()),
            api_backend: Some("responses".to_string()),
        }
    }

    #[test]
    fn provider_value_round_trips_all_fields() {
        let provider = sample_provider();
        let value = grok_provider_to_value(&provider);
        let parsed = value_to_grok_provider(&provider.id, &value, true).expect("round-trip");
        assert_eq!(parsed.name, "xAI");
        assert_eq!(parsed.base_url, "https://api.x.ai/v1");
        assert_eq!(parsed.api_key, "sk-test");
        assert_eq!(parsed.model, "grok-build");
        assert_eq!(parsed.max_context_size, Some(128000));
        assert_eq!(parsed.display_name.as_deref(), Some("Grok Build"));
        assert_eq!(parsed.api_backend.as_deref(), Some("responses"));
        assert!(parsed.is_active);
    }

    #[test]
    fn local_provider_uses_reserved_id() {
        let local = build_local_provider(true);
        assert_eq!(local.id, LOCAL_GROK_PROVIDER_ID);
        assert!(local.is_active);
        assert_eq!(local.is_local_provider, Some(true));
    }

    #[test]
    fn grok_section_defaults_are_empty() {
        let section: super::super::commands::GrokSection = Default::default();
        assert!(section.providers.is_empty());
        assert!(section.current.is_none());
        let _: HashMap<String, Value> = section.providers;
    }

    #[test]
    fn extract_base_url_when_default_key_matches_table() {
        // TOML 中带点的表键必须加引号，否则 grok-4.5 会被解析成嵌套路径
        let doc: toml::Table = toml::from_str(
            r#"
[models]
default = "grok-4.5"

[model."grok-4.5"]
model = "grok-4.5"
base_url = "https://relay.example.com/v1"
api_key = "sk-relay-test"
"#,
        )
        .expect("parse");
        let (base, key) = extract_base_url_api_key_from_grok_toml(&doc);
        assert_eq!(base, "https://relay.example.com/v1");
        assert_eq!(key, "sk-relay-test");
    }

    #[test]
    fn extract_base_url_when_default_name_differs_from_table_key() {
        // 用户真实形态：default=grok-4.5，表键为 model.grok
        let doc: toml::Table = toml::from_str(
            r#"
[models]
default = "grok-4.5"

[model.grok]
model = "grok-4.5"
base_url = "https://relay.example.com/v1"
api_key = "sk-relay-test"
api_backend = "responses"
"#,
        )
        .expect("parse");
        let (base, key) = extract_base_url_api_key_from_grok_toml(&doc);
        assert_eq!(base, "https://relay.example.com/v1");
        assert_eq!(key, "sk-relay-test");
    }

    #[test]
    fn config_diagnostics_distinguish_missing_loaded_malformed_and_io_error() {
        let missing = config_test_path("missing");
        assert_eq!(read_grok_config_document(&missing).0, "missing");

        let loaded = config_test_path("loaded");
        std::fs::write(&loaded, "[models]\ndefault = \"grok-build\"").expect("write loaded");
        assert_eq!(read_grok_config_document(&loaded).0, "loaded");
        std::fs::remove_file(&loaded).expect("remove loaded");

        let malformed = config_test_path("malformed");
        std::fs::write(&malformed, "[models").expect("write malformed");
        let malformed_result = read_grok_config_document(&malformed);
        assert_eq!(malformed_result.0, "malformed");
        assert!(malformed_result.2.is_some());
        std::fs::remove_file(&malformed).expect("remove malformed");

        let io_error = config_test_path("io");
        std::fs::create_dir(&io_error).expect("create directory at config path");
        let io_result = read_grok_config_document(&io_error);
        assert_eq!(io_result.0, "io-error");
        assert!(io_result.2.is_some());
        std::fs::remove_dir(&io_error).expect("remove io directory");
    }

    #[test]
    fn cleanup_removes_namespaced_model_and_dangling_default_but_preserves_user_content() {
        let path = config_test_path("cleanup");
        std::fs::write(
            &path,
            r#"[models]
default = "ccgui/grok-build"
web_search = true

[model."ccgui/grok-build"]
model = "grok-build"
api_key = "secret"

[model.grok-build]
model = "grok-build"
name = "Official"
"#,
        )
        .expect("write config");

        cleanup_provider_from_grok_config_at(&path, &sample_provider()).expect("cleanup");

        let rendered = std::fs::read_to_string(&path).expect("read cleaned config");
        let parsed: toml::Table = toml::from_str(&rendered).expect("parse cleaned config");
        let models = parsed
            .get("model")
            .and_then(|value| value.as_table())
            .expect("model table");
        assert!(!models.contains_key("ccgui/grok-build"));
        assert!(models.contains_key("grok-build"));
        let models_table = parsed
            .get("models")
            .and_then(|value| value.as_table())
            .expect("models table");
        assert!(models_table.get("default").is_none());
        assert_eq!(
            models_table
                .get("web_search")
                .and_then(toml::Value::as_bool),
            Some(true)
        );
        std::fs::remove_file(&path).expect("remove config");
    }

    #[test]
    fn cleanup_reports_read_parse_write_and_rename_failures() {
        let read_error = config_test_path("cleanup-read");
        std::fs::create_dir(&read_error).expect("create read-error directory");
        assert!(
            cleanup_provider_from_grok_config_at(&read_error, &sample_provider())
                .expect_err("read failure")
                .contains("Failed to read residual Grok config")
        );
        std::fs::remove_dir(&read_error).expect("remove read-error directory");

        let malformed = config_test_path("cleanup-parse");
        std::fs::write(&malformed, "[model").expect("write malformed config");
        assert!(
            cleanup_provider_from_grok_config_at(&malformed, &sample_provider())
                .expect_err("parse failure")
                .contains("Failed to parse residual Grok config")
        );
        std::fs::remove_file(&malformed).expect("remove malformed config");

        let write_error = config_test_path("cleanup-write");
        let write_tmp = write_error.with_extension("toml.tmp");
        std::fs::create_dir(&write_tmp).expect("create tmp directory");
        assert!(
            replace_grok_config(&write_error, "[models]\ndefault = \"demo\"".to_string())
                .expect_err("write failure")
                .contains("Failed to write residual Grok config")
        );
        std::fs::remove_dir(&write_tmp).expect("remove tmp directory");

        let rename_error = config_test_path("cleanup-rename");
        std::fs::create_dir(&rename_error).expect("create target directory");
        assert!(
            replace_grok_config(&rename_error, "[models]\ndefault = \"demo\"".to_string())
                .expect_err("rename failure")
                .contains("Failed to replace residual Grok config")
        );
        std::fs::remove_file(rename_error.with_extension("toml.tmp"))
            .expect("remove rename temp file");
        std::fs::remove_dir(&rename_error).expect("remove rename target directory");
    }
}
