use std::collections::HashMap;
use std::fs;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::app_paths;
use crate::session_management::EngineProviderBinding;
use crate::storage::with_storage_lock;
use crate::types::KimiProviderConfig;

pub(crate) const KIMI_LOCAL_PROVIDER_PROFILE_ID: &str = "__local_config_toml__";
const KIMI_PROVIDER_TOML_PREFIX: &str = "doge:";
const KIMI_MODEL_TOML_PREFIX: &str = "doge/";
const DEFAULT_KIMI_PROVIDER_TYPE: &str = "openai";

#[derive(Debug, Clone)]
pub(crate) struct KimiProviderLaunchProfile {
    pub(crate) binding: Option<EngineProviderBinding>,
    pub(crate) home_dir: Option<PathBuf>,
    pub(crate) runtime_key: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct DogeConfig {
    #[serde(default)]
    kimi: KimiSection,
    #[serde(flatten)]
    _extra: HashMap<String, Value>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct KimiSection {
    #[serde(default)]
    providers: HashMap<String, Value>,
}

fn normalize_profile_id(profile_id: Option<&str>) -> &str {
    profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(KIMI_LOCAL_PROVIDER_PROFILE_ID)
}

fn sanitize_provider_path_segment(provider_id: &str) -> Result<&str, String> {
    let trimmed = provider_id.trim();
    let windows_reserved_stem = trimmed
        .split('.')
        .next()
        .unwrap_or(trimmed)
        .to_ascii_uppercase();
    let is_windows_reserved_name = matches!(
        windows_reserved_stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL"
    ) || (windows_reserved_stem.len() == 4
        && (windows_reserved_stem.starts_with("COM") || windows_reserved_stem.starts_with("LPT"))
        && windows_reserved_stem[3..]
            .chars()
            .all(|ch| ('1'..='9').contains(&ch)));
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed.ends_with('.')
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || trimmed
            .chars()
            .any(|ch| ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
        || is_windows_reserved_name
    {
        return Err("invalid Kimi provider id".to_string());
    }
    Ok(trimmed)
}

fn read_config() -> Result<DogeConfig, String> {
    let path = app_paths::config_file_path()?;
    if !path.exists() {
        return Ok(DogeConfig::default());
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("failed to read provider config {}: {error}", path.display()))?;
    if content.trim().is_empty() {
        return Ok(DogeConfig::default());
    }
    serde_json::from_str(&content).map_err(|error| {
        format!(
            "failed to parse provider config {}: {error}",
            path.display()
        )
    })
}

pub(crate) fn value_to_kimi_provider(
    id: &str,
    value: &Value,
    is_active: bool,
) -> Result<KimiProviderConfig, String> {
    let read_string = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    Ok(KimiProviderConfig {
        id: id.to_string(),
        name: read_string("name"),
        remark: value
            .get("remark")
            .and_then(Value::as_str)
            .map(String::from),
        website_url: value
            .get("websiteUrl")
            .and_then(Value::as_str)
            .map(String::from),
        created_at: value.get("createdAt").and_then(Value::as_i64),
        sort_order: value.get("sortOrder").and_then(Value::as_i64),
        is_active,
        is_local_provider: value.get("isLocalProvider").and_then(Value::as_bool),
        base_url: read_string("baseUrl"),
        api_key: read_string("apiKey"),
        model: read_string("model"),
        provider_type: value
            .get("providerType")
            .and_then(Value::as_str)
            .map(String::from),
        max_context_size: value.get("maxContextSize").and_then(Value::as_i64),
        display_name: value
            .get("displayName")
            .and_then(Value::as_str)
            .map(String::from),
    })
}

pub(crate) fn kimi_runtime_key(workspace_id: &str, provider_profile_id: &str) -> String {
    format!(
        "kimi::{workspace_id}::{}",
        normalize_profile_id(Some(provider_profile_id))
    )
}

pub(crate) fn render_kimi_provider_config(
    original: &str,
    provider: &KimiProviderConfig,
) -> Result<String, String> {
    let mut doc: toml::Table = if original.trim().is_empty() {
        toml::Table::new()
    } else {
        toml::from_str(original).map_err(|error| format!("invalid Kimi config.toml: {error}"))?
    };
    let model = provider.model.trim();
    if model.is_empty() {
        return Err(format!("Kimi provider {} has empty model", provider.name));
    }

    let provider_toml_id = format!("{KIMI_PROVIDER_TOML_PREFIX}{}", provider.id);
    let model_toml_alias = format!("{KIMI_MODEL_TOML_PREFIX}{model}");
    let mut provider_table = toml::Table::new();
    provider_table.insert(
        "type".to_string(),
        toml::Value::String(
            provider
                .provider_type
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(DEFAULT_KIMI_PROVIDER_TYPE)
                .to_string(),
        ),
    );
    provider_table.insert(
        "base_url".to_string(),
        toml::Value::String(provider.base_url.trim().to_string()),
    );
    if !provider.api_key.trim().is_empty() {
        provider_table.insert(
            "api_key".to_string(),
            toml::Value::String(provider.api_key.trim().to_string()),
        );
    }

    let mut model_table = toml::Table::new();
    model_table.insert(
        "provider".to_string(),
        toml::Value::String(provider_toml_id.clone()),
    );
    model_table.insert("model".to_string(), toml::Value::String(model.to_string()));
    if let Some(max_context_size) = provider.max_context_size {
        model_table.insert(
            "max_context_size".to_string(),
            toml::Value::Integer(max_context_size),
        );
    }
    if let Some(display_name) = provider
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        model_table.insert(
            "display_name".to_string(),
            toml::Value::String(display_name.to_string()),
        );
    }

    doc.entry("providers")
        .or_insert_with(|| toml::Value::Table(toml::Table::new()))
        .as_table_mut()
        .ok_or_else(|| "`providers` in Kimi config.toml is not a table".to_string())?
        .insert(provider_toml_id, toml::Value::Table(provider_table));
    doc.entry("models")
        .or_insert_with(|| toml::Value::Table(toml::Table::new()))
        .as_table_mut()
        .ok_or_else(|| "`models` in Kimi config.toml is not a table".to_string())?
        .insert(model_toml_alias.clone(), toml::Value::Table(model_table));
    doc.insert(
        "default_model".to_string(),
        toml::Value::String(model_toml_alias),
    );
    toml::to_string_pretty(&doc)
        .map_err(|error| format!("failed to serialize Kimi config: {error}"))
}

pub(crate) fn materialize_kimi_provider_at(
    provider: &KimiProviderConfig,
    config_path: &Path,
    backup_existing: bool,
) -> Result<(), String> {
    with_storage_lock(config_path, || {
        materialize_kimi_provider_at_unlocked(provider, config_path, backup_existing)
    })
}

fn write_kimi_provider_temp_file(path: &Path, content: &str) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|error| format!("failed to create {}: {error}", path.display()))?;
    if let Err(error) = file
        .write_all(content.as_bytes())
        .and_then(|_| file.sync_all())
    {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(format!("failed to write {}: {error}", path.display()));
    }
    Ok(())
}

fn secure_kimi_provider_file(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("failed to secure {}: {error}", path.display()))?;
    }
    Ok(())
}

fn materialize_kimi_provider_at_unlocked(
    provider: &KimiProviderConfig,
    config_path: &Path,
    backup_existing: bool,
) -> Result<(), String> {
    let original = match fs::read_to_string(config_path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => {
            return Err(format!(
                "failed to read Kimi config {}: {error}",
                config_path.display()
            ))
        }
    };
    let rendered = render_kimi_provider_config(&original, provider)?;
    if original == rendered && config_path.exists() {
        return secure_kimi_provider_file(config_path);
    }
    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create {}: {error}", parent.display()))?;
    }
    if backup_existing && config_path.exists() {
        let backup_path = config_path.with_extension("toml.bak");
        fs::copy(config_path, &backup_path)
            .map_err(|error| format!("failed to back up {}: {error}", config_path.display()))?;
    }
    let tmp_path = config_path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    write_kimi_provider_temp_file(&tmp_path, &rendered)?;
    #[cfg(windows)]
    if config_path.exists() {
        if let Err(error) = fs::remove_file(config_path) {
            let _ = fs::remove_file(&tmp_path);
            return Err(format!(
                "failed to replace {}: {error}",
                config_path.display()
            ));
        }
    }
    if let Err(error) = fs::rename(&tmp_path, config_path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(format!(
            "failed to replace {}: {error}",
            config_path.display()
        ));
    }
    secure_kimi_provider_file(config_path)
}

pub(crate) fn resolve_kimi_provider_launch_profile(
    workspace_id: &str,
    provider_profile_id: Option<&str>,
) -> Result<KimiProviderLaunchProfile, String> {
    let profile_id = normalize_profile_id(provider_profile_id);
    if profile_id == KIMI_LOCAL_PROVIDER_PROFILE_ID {
        return Ok(KimiProviderLaunchProfile {
            binding: None,
            home_dir: None,
            runtime_key: kimi_runtime_key(workspace_id, KIMI_LOCAL_PROVIDER_PROFILE_ID),
        });
    }

    let value = read_config()?
        .kimi
        .providers
        .remove(profile_id)
        .ok_or_else(|| format!("Kimi provider {profile_id} not found"))?;
    let provider = value_to_kimi_provider(profile_id, &value, false)?;
    if provider.name.trim().is_empty() {
        return Err(format!("Kimi provider {profile_id} is missing a name"));
    }
    let segment = sanitize_provider_path_segment(profile_id)?;
    let home_dir = app_paths::kimi_provider_homes_dir()?.join(segment);
    materialize_kimi_provider_at(&provider, &home_dir.join("config.toml"), false)?;
    Ok(KimiProviderLaunchProfile {
        binding: Some(EngineProviderBinding {
            provider_profile_id: profile_id.to_string(),
            provider_profile_source: "managed".to_string(),
            provider_profile_name: provider.name,
            provider_availability: "available".to_string(),
        }),
        home_dir: Some(home_dir),
        runtime_key: kimi_runtime_key(workspace_id, profile_id),
    })
}

pub(crate) fn resolve_kimi_provider_model_config(
    provider_profile_id: &str,
) -> Result<Option<KimiProviderConfig>, String> {
    let profile_id = normalize_profile_id(Some(provider_profile_id));
    if profile_id == KIMI_LOCAL_PROVIDER_PROFILE_ID {
        return Ok(None);
    }
    let value = read_config()?
        .kimi
        .providers
        .remove(profile_id)
        .ok_or_else(|| format!("Kimi provider {profile_id} not found"))?;
    let provider = value_to_kimi_provider(profile_id, &value, false)?;
    if provider.name.trim().is_empty() {
        return Err(format!("Kimi provider {profile_id} is missing a name"));
    }
    if provider.model.trim().is_empty() {
        return Err(format!("Kimi provider {} has empty model", provider.name));
    }
    Ok(Some(provider))
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn sample_provider() -> KimiProviderConfig {
        KimiProviderConfig {
            id: "provider-a".to_string(),
            name: "Provider A".to_string(),
            remark: None,
            website_url: None,
            created_at: None,
            sort_order: None,
            is_active: false,
            is_local_provider: None,
            base_url: "https://example.test/v1".to_string(),
            api_key: "secret".to_string(),
            model: "kimi-k2".to_string(),
            provider_type: None,
            max_context_size: Some(128_000),
            display_name: Some("Kimi K2".to_string()),
        }
    }

    #[test]
    fn runtime_key_includes_provider_profile() {
        assert_ne!(
            kimi_runtime_key("ws-1", "provider-a"),
            kimi_runtime_key("ws-1", "provider-b")
        );
    }

    #[test]
    fn local_launch_profile_uses_canonical_runtime_key() {
        let profile =
            resolve_kimi_provider_launch_profile("ws-1", None).expect("local launch profile");

        assert_eq!(
            profile.runtime_key,
            kimi_runtime_key("ws-1", KIMI_LOCAL_PROVIDER_PROFILE_ID)
        );
    }

    #[test]
    fn provider_path_rejects_traversal_and_reserved_names() {
        for invalid in ["../escape", "a/b", "CON", "name."] {
            assert!(
                sanitize_provider_path_segment(invalid).is_err(),
                "{invalid}"
            );
        }
    }

    #[test]
    fn materialized_config_is_scoped_and_owner_only() {
        let root = std::env::temp_dir().join(format!("mossx-kimi-{}", Uuid::new_v4()));
        let path = root.join("provider-a").join("config.toml");
        materialize_kimi_provider_at(&sample_provider(), &path, false).expect("materialize");
        let rendered = fs::read_to_string(&path).expect("read");
        assert!(rendered.contains("doge:provider-a"));
        assert!(rendered.contains("api_key = \"secret\""));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).expect("metadata").permissions().mode() & 0o777,
                0o600
            );
        }
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn provider_temp_file_is_owner_only_from_creation() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!("mossx-kimi-temp-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).expect("create temp root");
        let path = root.join("provider.tmp");

        write_kimi_provider_temp_file(&path, "api_key = \"secret\"").expect("write secure temp");

        assert_eq!(
            fs::metadata(&path).expect("metadata").permissions().mode() & 0o777,
            0o600
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn concurrent_materialization_keeps_valid_provider_config() {
        let root = std::env::temp_dir().join(format!("mossx-kimi-concurrent-{}", Uuid::new_v4()));
        let path = root.join("provider-a").join("config.toml");
        let provider = sample_provider();
        let workers = (0..4)
            .map(|_| {
                let path = path.clone();
                let provider = provider.clone();
                std::thread::spawn(move || materialize_kimi_provider_at(&provider, &path, false))
            })
            .collect::<Vec<_>>();

        for worker in workers {
            worker
                .join()
                .expect("materialization worker")
                .expect("materialize provider");
        }

        let rendered = fs::read_to_string(&path).expect("read final config");
        let parsed: toml::Table = toml::from_str(&rendered).expect("parse final config");
        assert_eq!(
            parsed.get("default_model").and_then(toml::Value::as_str),
            Some("doge/kimi-k2")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn unchanged_materialization_keeps_existing_inode() {
        use std::os::unix::fs::MetadataExt;

        let root = std::env::temp_dir().join(format!("mossx-kimi-idempotent-{}", Uuid::new_v4()));
        let path = root.join("provider-a").join("config.toml");
        let provider = sample_provider();
        materialize_kimi_provider_at(&provider, &path, false).expect("first materialization");
        let first_inode = fs::metadata(&path).expect("first metadata").ino();

        materialize_kimi_provider_at(&provider, &path, false).expect("second materialization");

        assert_eq!(
            fs::metadata(&path).expect("second metadata").ino(),
            first_inode
        );
        let _ = fs::remove_dir_all(root);
    }
}
