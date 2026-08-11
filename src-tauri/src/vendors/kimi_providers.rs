//! Kimi CLI vendor/provider management.
//!
//! Provider definitions live in doge's `config.json` under the `kimi` section
//! (same pattern as claude/codex providers). Switching a provider materializes
//! it into `~/.kimi-code/config.toml` under namespaced keys so the managed
//! `managed:kimi-code` entries stay untouched:
//!
//! - `providers."doge:<id>"` with `type` / `base_url` / `api_key`
//! - `models."doge/<model>"` referencing that provider
//! - `default_model = "doge/<model>"`
//!
//! The special `__local_config_toml__` provider means "leave config.toml alone".

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;

use crate::types::KimiProviderConfig;

use super::commands::{
    derive_model_list_candidates, extract_vendor_model_ids, next_provider_created_at, read_config,
    set_provider_created_at, updated_provider_created_at, write_config, VendorModelListResult,
};

use crate::engine::kimi_provider_profile::{
    materialize_kimi_provider_at, value_to_kimi_provider, KIMI_LOCAL_PROVIDER_PROFILE_ID,
};

const LOCAL_KIMI_PROVIDER_ID: &str = KIMI_LOCAL_PROVIDER_PROFILE_ID;
const LOCAL_KIMI_PROVIDER_NAME: &str = "Local config.toml";
const LOCAL_KIMI_PROVIDER_REMARK: &str = "Use configuration directly from ~/.kimi-code/config.toml";
const KIMI_PROVIDER_TOML_PREFIX: &str = "doge:";
const LEGACY_KIMI_PROVIDER_TOML_PREFIXES: &[&str] = &["ccgui:"];

fn kimi_config_toml_path() -> Result<PathBuf, String> {
    if let Some(home) = std::env::var_os("KIMI_CODE_HOME").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(home).join("config.toml"));
    }
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    Ok(home.join(".kimi-code").join("config.toml"))
}

fn build_local_provider(is_active: bool) -> KimiProviderConfig {
    KimiProviderConfig {
        id: LOCAL_KIMI_PROVIDER_ID.to_string(),
        name: LOCAL_KIMI_PROVIDER_NAME.to_string(),
        remark: Some(LOCAL_KIMI_PROVIDER_REMARK.to_string()),
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
    }
}

fn kimi_provider_to_value(provider: &KimiProviderConfig) -> Value {
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
    Value::Object(map)
}

fn sort_kimi_providers(providers: &mut [KimiProviderConfig]) {
    providers.sort_by(|a, b| {
        a.sort_order
            .unwrap_or(i64::MAX)
            .cmp(&b.sort_order.unwrap_or(i64::MAX))
            .then_with(|| a.created_at.unwrap_or(0).cmp(&b.created_at.unwrap_or(0)))
            .then_with(|| a.id.cmp(&b.id))
    });
}

/// Materialize the given provider into ~/.kimi-code/config.toml.
/// The original file is backed up to config.toml.bak before rewriting.
fn apply_provider_to_kimi_config(provider: &KimiProviderConfig) -> Result<(), String> {
    let path = kimi_config_toml_path()?;
    materialize_kimi_provider_at(provider, &path, true)
}

/// Remove doge and legacy namespaced entries while keeping durable provider deletion
/// independent from external config cleanup.
fn cleanup_provider_from_kimi_config(provider_id: &str) -> Result<(), String> {
    let path = kimi_config_toml_path()?;
    cleanup_provider_from_kimi_config_at(&path, provider_id)
}

fn cleanup_provider_from_kimi_config_at(path: &Path, provider_id: &str) -> Result<(), String> {
    let original = match std::fs::read_to_string(&path) {
        Ok(original) => original,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Failed to read residual Kimi config {}: {}",
                path.display(),
                error
            ))
        }
    };
    if original.trim().is_empty() {
        return Ok(());
    }
    let mut doc = toml::from_str::<toml::Table>(&original)
        .map_err(|error| format!("Failed to parse residual Kimi config: {error}"))?;

    let provider_toml_ids = std::iter::once(KIMI_PROVIDER_TOML_PREFIX)
        .chain(LEGACY_KIMI_PROVIDER_TOML_PREFIXES.iter().copied())
        .map(|prefix| format!("{prefix}{provider_id}"))
        .collect::<Vec<_>>();
    let mut dirty = false;

    if let Some(providers) = doc.get_mut("providers").and_then(|v| v.as_table_mut()) {
        for provider_toml_id in &provider_toml_ids {
            dirty |= providers.remove(provider_toml_id).is_some();
        }
    }

    let mut removed_aliases = Vec::new();
    if let Some(models) = doc.get_mut("models").and_then(|v| v.as_table_mut()) {
        let dangling: Vec<String> = models
            .iter()
            .filter(|(_, model)| {
                model
                    .get("provider")
                    .and_then(|v| v.as_str())
                    .is_some_and(|value| provider_toml_ids.iter().any(|id| id == value))
            })
            .map(|(alias, _)| alias.clone())
            .collect();
        for alias in &dangling {
            models.remove(alias);
        }
        removed_aliases = dangling;
        dirty |= !removed_aliases.is_empty();
    }

    if let Some(default_model) = doc.get("default_model").and_then(|v| v.as_str()) {
        if removed_aliases.iter().any(|alias| alias == default_model) {
            doc.remove("default_model");
            dirty = true;
        }
    }

    if !dirty {
        return Ok(());
    }
    let rendered = toml::to_string_pretty(&doc)
        .map_err(|error| format!("Failed to serialize residual Kimi config: {error}"))?;
    replace_kimi_config(path, rendered)
}

fn replace_kimi_config(path: &Path, rendered: String) -> Result<(), String> {
    let tmp_path = path.with_extension("toml.tmp");
    std::fs::write(&tmp_path, rendered)
        .map_err(|error| format!("Failed to write residual Kimi config: {error}"))?;
    std::fs::rename(&tmp_path, &path)
        .map_err(|error| format!("Failed to replace residual Kimi config: {error}"))
}

// ==================== Kimi Provider Commands ====================

#[tauri::command]
pub(crate) async fn vendor_get_kimi_providers() -> Result<Vec<KimiProviderConfig>, String> {
    let config = read_config()?;
    let current = config.kimi.current.as_deref();
    let mut regular_providers: Vec<KimiProviderConfig> = config
        .kimi
        .providers
        .iter()
        .filter_map(|(id, value)| {
            if id == LOCAL_KIMI_PROVIDER_ID {
                return None;
            }
            let is_active = current == Some(id.as_str());
            value_to_kimi_provider(id, value, is_active).ok()
        })
        .collect();
    sort_kimi_providers(&mut regular_providers);

    let mut providers = Vec::with_capacity(regular_providers.len() + 1);
    providers.push(build_local_provider(
        current == Some(LOCAL_KIMI_PROVIDER_ID),
    ));
    providers.extend(regular_providers);

    Ok(providers)
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KimiCurrentConfig {
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

fn read_kimi_config_document(path: &Path) -> (String, toml::Table, Option<String>) {
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

#[tauri::command]
pub(crate) async fn vendor_get_current_kimi_config() -> Result<KimiCurrentConfig, String> {
    let path = kimi_config_toml_path()?;
    let (config_status, doc, diagnostic) = read_kimi_config_document(&path);

    let default_model = doc
        .get("default_model")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let provider_toml_id = doc
        .get("models")
        .and_then(|v| v.as_table())
        .and_then(|models| models.get(&default_model))
        .and_then(|model| model.get("provider"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let (mut api_key, mut base_url) = (String::new(), String::new());
    if let Some(ref provider_id) = provider_toml_id {
        if let Some(provider) = doc
            .get("providers")
            .and_then(|v| v.as_table())
            .and_then(|providers| providers.get(provider_id))
            .and_then(|v| v.as_table())
        {
            api_key = provider
                .get("api_key")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            base_url = provider
                .get("base_url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
        }
    }

    let config = read_config()?;
    let provider_id = config.kimi.current.clone();
    let provider_name = provider_id.as_ref().and_then(|id| {
        if id == LOCAL_KIMI_PROVIDER_ID {
            return Some(LOCAL_KIMI_PROVIDER_NAME.to_string());
        }
        config
            .kimi
            .providers
            .get(id)
            .and_then(|provider| provider.get("name"))
            .and_then(|name| name.as_str())
            .map(String::from)
    });

    Ok(KimiCurrentConfig {
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

/// Read raw official Kimi Code CLI config (`$KIMI_CODE_HOME/config.toml` or
/// `~/.kimi-code/config.toml`). Missing file returns an empty string so the
/// editor can create one.
#[tauri::command]
pub(crate) async fn vendor_read_kimi_config_toml() -> Result<String, String> {
    let path = kimi_config_toml_path()?;
    match std::fs::read_to_string(&path) {
        Ok(content) => Ok(content),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(format!("Failed to read {}: {}", path.display(), error)),
    }
}

/// Write official Kimi Code CLI config after validating TOML table syntax.
#[tauri::command]
pub(crate) async fn vendor_save_kimi_config_toml(content: String) -> Result<(), String> {
    let path = kimi_config_toml_path()?;
    // Allow empty (user clearing / starting fresh) but reject malformed TOML.
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
pub(crate) async fn vendor_add_kimi_provider(provider: KimiProviderConfig) -> Result<(), String> {
    if provider.id == LOCAL_KIMI_PROVIDER_ID {
        return Err("Reserved provider id".to_string());
    }
    let mut config = read_config()?;
    if config.kimi.providers.contains_key(&provider.id) {
        return Err(format!("Provider with id {} already exists", provider.id));
    }
    let created_at = provider
        .created_at
        .unwrap_or_else(|| next_provider_created_at(&config.kimi.providers));
    let mut provider_value = kimi_provider_to_value(&provider);
    set_provider_created_at(&mut provider_value, created_at);
    config
        .kimi
        .providers
        .insert(provider.id.clone(), provider_value);
    write_config(&config)
}

#[tauri::command]
pub(crate) async fn vendor_update_kimi_provider(
    id: String,
    updates: KimiProviderConfig,
) -> Result<(), String> {
    if id == LOCAL_KIMI_PROVIDER_ID {
        return Err("Local config.toml provider cannot be updated".to_string());
    }
    let mut config = read_config()?;
    if !config.kimi.providers.contains_key(&id) {
        return Err(format!("Provider {} not found", id));
    }
    let existing_created_at =
        updated_provider_created_at(config.kimi.providers.get(&id), updates.created_at);
    let mut provider_value = kimi_provider_to_value(&updates);
    if let Some(created_at) = existing_created_at {
        set_provider_created_at(&mut provider_value, created_at);
    }
    let is_current = config.kimi.current.as_deref() == Some(id.as_str());
    config.kimi.providers.insert(id.clone(), provider_value);
    write_config(&config)?;

    // Keep the materialized config.toml in sync when editing the active provider.
    if is_current {
        apply_provider_to_kimi_config(&updates)?;
    }
    Ok(())
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KimiProviderDeleteResult {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    warning: Option<String>,
}

#[tauri::command]
pub(crate) async fn vendor_delete_kimi_provider(
    id: String,
) -> Result<KimiProviderDeleteResult, String> {
    if id == LOCAL_KIMI_PROVIDER_ID {
        return Err("Local config.toml provider cannot be deleted".to_string());
    }
    let mut config = read_config()?;
    if config.kimi.providers.remove(&id).is_none() {
        return Err(format!("Provider {} not found", id));
    }
    if config.kimi.current.as_ref() == Some(&id) {
        config.kimi.current = None;
    }
    write_config(&config)?;
    match cleanup_provider_from_kimi_config(&id) {
        Ok(()) => Ok(KimiProviderDeleteResult {
            status: "success".to_string(),
            warning: None,
        }),
        Err(warning) => Ok(KimiProviderDeleteResult {
            status: "partial-warning".to_string(),
            warning: Some(format!(
                "Provider deleted, but residual ~/.kimi-code/config.toml cleanup failed: {warning}"
            )),
        }),
    }
}

/// Pseudo id: clear `kimi.current` so no managed/local provider is active.
const DISABLED_KIMI_PROVIDER_ID: &str = "__disabled__";

#[tauri::command]
pub(crate) async fn vendor_switch_kimi_provider(id: String) -> Result<(), String> {
    let mut config = read_config()?;
    // 「取消使用」: 清空 current，不改 ~/.kimi-code/config.toml
    if id == DISABLED_KIMI_PROVIDER_ID {
        config.kimi.current = None;
        write_config(&config)?;
        return Ok(());
    }
    if id == LOCAL_KIMI_PROVIDER_ID {
        config.kimi.current = Some(id);
        write_config(&config)?;
        return Ok(());
    }
    let provider_value = config
        .kimi
        .providers
        .get(&id)
        .ok_or_else(|| format!("Provider {} not found", id))?
        .clone();
    let provider = value_to_kimi_provider(&id, &provider_value, true)?;
    config.kimi.current = Some(id.clone());
    write_config(&config)?;

    apply_provider_to_kimi_config(&provider)?;

    Ok(())
}

#[tauri::command]
pub(crate) async fn vendor_fetch_kimi_models(
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
            "mossx-kimi-config-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        ))
    }

    fn sample_provider() -> KimiProviderConfig {
        KimiProviderConfig {
            id: "moonshot".to_string(),
            name: "Moonshot".to_string(),
            remark: None,
            website_url: None,
            created_at: Some(1),
            sort_order: None,
            is_active: false,
            is_local_provider: None,
            base_url: "https://api.moonshot.cn/v1".to_string(),
            api_key: "sk-test".to_string(),
            model: "kimi-k2".to_string(),
            provider_type: None,
            max_context_size: Some(262144),
            display_name: Some("Kimi K2".to_string()),
        }
    }

    #[test]
    fn provider_value_round_trips_all_fields() {
        let provider = sample_provider();
        let value = kimi_provider_to_value(&provider);
        let parsed = value_to_kimi_provider(&provider.id, &value, true).expect("round-trip");
        assert_eq!(parsed.name, "Moonshot");
        assert_eq!(parsed.base_url, "https://api.moonshot.cn/v1");
        assert_eq!(parsed.api_key, "sk-test");
        assert_eq!(parsed.model, "kimi-k2");
        assert_eq!(parsed.max_context_size, Some(262144));
        assert_eq!(parsed.display_name.as_deref(), Some("Kimi K2"));
        assert!(parsed.is_active);
    }

    #[test]
    fn local_provider_uses_reserved_id() {
        let local = build_local_provider(true);
        assert_eq!(local.id, LOCAL_KIMI_PROVIDER_ID);
        assert!(local.is_active);
        assert_eq!(local.is_local_provider, Some(true));
    }

    #[test]
    fn atomic_write_creates_parent_and_round_trips_toml() {
        let path = config_test_path("atomic")
            .join("nested")
            .join("config.toml");
        atomic_write_text_file(&path, "default_model = \"demo\"\n", "toml").expect("write");
        assert_eq!(
            std::fs::read_to_string(&path).expect("read"),
            "default_model = \"demo\"\n"
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn kimi_section_defaults_are_empty() {
        let section: super::super::commands::KimiSection = Default::default();
        assert!(section.providers.is_empty());
        assert!(section.current.is_none());
        let _: HashMap<String, Value> = section.providers;
    }

    #[test]
    fn config_diagnostics_distinguish_missing_loaded_malformed_and_io_error() {
        let missing = config_test_path("missing");
        assert_eq!(read_kimi_config_document(&missing).0, "missing");

        let loaded = config_test_path("loaded");
        std::fs::write(&loaded, "default_model = \"kimi-code/k3\"").expect("write loaded");
        assert_eq!(read_kimi_config_document(&loaded).0, "loaded");
        std::fs::remove_file(&loaded).expect("remove loaded");

        let malformed = config_test_path("malformed");
        std::fs::write(&malformed, "[models").expect("write malformed");
        let malformed_result = read_kimi_config_document(&malformed);
        assert_eq!(malformed_result.0, "malformed");
        assert!(malformed_result.2.is_some());
        std::fs::remove_file(&malformed).expect("remove malformed");

        let io_error = config_test_path("io");
        std::fs::create_dir(&io_error).expect("create directory at config path");
        let io_result = read_kimi_config_document(&io_error);
        assert_eq!(io_result.0, "io-error");
        assert!(io_result.2.is_some());
        std::fs::remove_dir(&io_error).expect("remove io directory");
    }

    #[test]
    fn cleanup_reports_read_parse_write_and_rename_failures() {
        let read_error = config_test_path("cleanup-read");
        std::fs::create_dir(&read_error).expect("create read-error directory");
        assert!(cleanup_provider_from_kimi_config_at(&read_error, "demo")
            .expect_err("read failure")
            .contains("Failed to read residual Kimi config"));
        std::fs::remove_dir(&read_error).expect("remove read-error directory");

        let malformed = config_test_path("cleanup-parse");
        std::fs::write(&malformed, "[providers").expect("write malformed config");
        assert!(cleanup_provider_from_kimi_config_at(&malformed, "demo")
            .expect_err("parse failure")
            .contains("Failed to parse residual Kimi config"));
        std::fs::remove_file(&malformed).expect("remove malformed config");

        let write_error = config_test_path("cleanup-write");
        let write_tmp = write_error.with_extension("toml.tmp");
        std::fs::create_dir(&write_tmp).expect("create tmp directory");
        assert!(
            replace_kimi_config(&write_error, "default_model = \"demo\"".to_string())
                .expect_err("write failure")
                .contains("Failed to write residual Kimi config")
        );
        std::fs::remove_dir(&write_tmp).expect("remove tmp directory");

        let rename_error = config_test_path("cleanup-rename");
        std::fs::create_dir(&rename_error).expect("create target directory");
        assert!(
            replace_kimi_config(&rename_error, "default_model = \"demo\"".to_string())
                .expect_err("rename failure")
                .contains("Failed to replace residual Kimi config")
        );
        std::fs::remove_file(rename_error.with_extension("toml.tmp"))
            .expect("remove rename temp file");
        std::fs::remove_dir(&rename_error).expect("remove rename target directory");
    }
}
