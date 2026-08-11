use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::app_paths;
use crate::session_management::CodexProviderBinding;
use crate::types::CodexProviderConfig;

pub(crate) const CODEX_DISK_PROVIDER_PROFILE_ID: &str = "__disk__";
pub(crate) const CODEX_DISK_PROVIDER_PROFILE_NAME: &str = "codex-tui/default-config";
pub(crate) const CODEX_PROVIDER_WIRE_API_UNSUPPORTED_ERROR_PREFIX: &str =
    "[codex_provider_wire_api_unsupported]";
pub(crate) const CODEX_PROVIDER_CONFIG_INVALID_ERROR_PREFIX: &str =
    "[codex_provider_config_invalid]";

impl CodexProviderBinding {
    pub(crate) fn disk() -> Self {
        Self {
            provider_profile_id: CODEX_DISK_PROVIDER_PROFILE_ID.to_string(),
            provider_profile_source: "disk".to_string(),
            provider_profile_name: CODEX_DISK_PROVIDER_PROFILE_NAME.to_string(),
            provider_availability: "available".to_string(),
        }
    }

    pub(crate) fn unavailable(mut self) -> Self {
        self.provider_availability = "unavailable".to_string();
        self
    }
}

pub(crate) fn codex_provider_binding_for_profile_id(
    provider_profile_id: &str,
) -> CodexProviderBinding {
    let profile_id = normalize_profile_id(Some(provider_profile_id));
    if profile_id == CODEX_DISK_PROVIDER_PROFILE_ID {
        return CodexProviderBinding::disk();
    }

    match read_config()
        .ok()
        .and_then(|config| config.codex.providers.get(&profile_id).cloned())
        .and_then(|value| value_to_codex_provider(&profile_id, &value).ok())
    {
        Some(provider) => CodexProviderBinding {
            provider_profile_id: profile_id,
            provider_profile_source: "managed".to_string(),
            provider_profile_name: provider.name,
            provider_availability: "available".to_string(),
        },
        None => CodexProviderBinding {
            provider_profile_id: profile_id.clone(),
            provider_profile_source: "managed".to_string(),
            provider_profile_name: profile_id,
            provider_availability: "unavailable".to_string(),
        },
    }
}

#[derive(Debug, Clone)]
pub(crate) enum CodexProviderProfile {
    Disk,
    Managed {
        id: String,
        name: String,
        config_toml: String,
        auth_json: Option<String>,
    },
}

impl CodexProviderProfile {
    pub(crate) fn id(&self) -> &str {
        match self {
            Self::Disk => CODEX_DISK_PROVIDER_PROFILE_ID,
            Self::Managed { id, .. } => id.as_str(),
        }
    }

    pub(crate) fn source(&self) -> &'static str {
        match self {
            Self::Disk => "disk",
            Self::Managed { .. } => "managed",
        }
    }

    pub(crate) fn name(&self) -> &str {
        match self {
            Self::Disk => CODEX_DISK_PROVIDER_PROFILE_NAME,
            Self::Managed { name, .. } => name.as_str(),
        }
    }

    pub(crate) fn binding(&self) -> CodexProviderBinding {
        CodexProviderBinding {
            provider_profile_id: self.id().to_string(),
            provider_profile_source: self.source().to_string(),
            provider_profile_name: self.name().to_string(),
            provider_availability: "available".to_string(),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct MaterializedCodexProviderProfile {
    pub(crate) codex_home: Option<PathBuf>,
    pub(crate) codex_args_override: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct DogeConfig {
    #[serde(default)]
    codex: CodexSection,
    #[serde(flatten)]
    _extra: HashMap<String, Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct CodexSection {
    #[serde(default)]
    providers: HashMap<String, Value>,
}

fn config_path() -> Result<PathBuf, String> {
    app_paths::config_file_path()
}

fn read_config() -> Result<DogeConfig, String> {
    let path = config_path()?;
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

fn value_to_codex_provider(id: &str, value: &Value) -> Result<CodexProviderConfig, String> {
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Codex provider {id} is missing a name"))?
        .to_string();
    let remark = value
        .get("remark")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let created_at = value.get("createdAt").and_then(Value::as_i64);
    let config_toml = value
        .get("configToml")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let auth_json = value
        .get("authJson")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let custom_models = value
        .get("customModels")
        .and_then(|value| serde_json::from_value(value.clone()).ok());

    Ok(CodexProviderConfig {
        id: id.to_string(),
        name,
        remark,
        created_at,
        sort_order: None,
        is_active: false,
        source: None,
        config_toml,
        auth_json,
        custom_models,
    })
}

fn normalize_profile_id(profile_id: Option<&str>) -> String {
    profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(CODEX_DISK_PROVIDER_PROFILE_ID)
        .to_string()
}

fn sanitize_provider_path_segment(provider_id: &str) -> Result<String, String> {
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
        return Err("invalid Codex provider id".to_string());
    }
    Ok(trimmed.to_string())
}

pub(crate) fn codex_runtime_key(workspace_id: &str, provider_profile_id: &str) -> String {
    let provider_profile_id = normalize_profile_id(Some(provider_profile_id));
    format!("codex::{workspace_id}::{provider_profile_id}")
}

pub(crate) fn legacy_codex_runtime_key(workspace_id: &str) -> String {
    workspace_id.to_string()
}

pub(crate) fn resolve_codex_provider_profile(
    provider_profile_id: Option<&str>,
) -> Result<CodexProviderProfile, String> {
    let profile_id = normalize_profile_id(provider_profile_id);
    if profile_id == CODEX_DISK_PROVIDER_PROFILE_ID {
        return Ok(CodexProviderProfile::Disk);
    }

    let config = read_config()?;
    let value = config
        .codex
        .providers
        .get(&profile_id)
        .ok_or_else(|| format!("Codex provider {profile_id} not found"))?;
    let provider = value_to_codex_provider(&profile_id, value)?;
    let config_toml = provider
        .config_toml
        .clone()
        .unwrap_or_default()
        .trim()
        .to_string();
    if config_toml.is_empty() {
        return Err(format!(
            "Codex provider {} has empty configToml",
            provider.name
        ));
    }
    Ok(CodexProviderProfile::Managed {
        id: provider.id,
        name: provider.name,
        config_toml,
        auth_json: provider
            .auth_json
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    })
}

pub(crate) fn resolve_codex_provider_model_config(
    provider_profile_id: &str,
) -> Result<Option<(String, Vec<crate::types::CodexCustomModel>)>, String> {
    let profile_id = normalize_profile_id(Some(provider_profile_id));
    if profile_id == CODEX_DISK_PROVIDER_PROFILE_ID {
        return Ok(None);
    }
    let config = read_config()?;
    let value = config
        .codex
        .providers
        .get(&profile_id)
        .ok_or_else(|| format!("Codex provider {profile_id} not found"))?;
    let provider = value_to_codex_provider(&profile_id, value)?;
    let config_toml = provider.config_toml.unwrap_or_default().trim().to_string();
    if config_toml.is_empty() {
        return Err(format!(
            "Codex provider {} has empty configToml",
            provider.name
        ));
    }
    Ok(Some((
        config_toml,
        provider.custom_models.unwrap_or_default(),
    )))
}

pub(crate) fn resolve_codex_provider_default_model(
    provider_profile_id: &str,
) -> Result<Option<String>, String> {
    let Some((config_toml, _)) = resolve_codex_provider_model_config(provider_profile_id)? else {
        return Ok(None);
    };
    configured_model_from_config_toml(&config_toml)
}

fn configured_model_from_config_toml(config_toml: &str) -> Result<Option<String>, String> {
    let value = parse_codex_provider_config(config_toml)?;
    Ok(value
        .get("model")
        .and_then(toml::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string))
}

fn parse_codex_provider_config(config_toml: &str) -> Result<toml::Value, String> {
    config_toml.parse().map_err(|_| {
        format!("{CODEX_PROVIDER_CONFIG_INVALID_ERROR_PREFIX} Codex provider configToml is not valid TOML.")
    })
}

fn validate_codex_provider_wire_api(config_toml: &str, provider_name: &str) -> Result<(), String> {
    let value = parse_codex_provider_config(config_toml)?;
    let Some(model_providers) = value.get("model_providers").and_then(toml::Value::as_table) else {
        return Ok(());
    };
    for (model_provider, provider) in model_providers {
        let wire_api = provider
            .get("wire_api")
            .and_then(toml::Value::as_str)
            .map(str::trim);
        if wire_api.is_some_and(|wire_api| wire_api.eq_ignore_ascii_case("chat")) {
            return Err(format!(
                "{CODEX_PROVIDER_WIRE_API_UNSUPPORTED_ERROR_PREFIX} Codex provider {provider_name} configures model provider {model_provider} with wire_api = \"chat\", which is not supported by the current Codex CLI."
            ));
        }
    }
    Ok(())
}

fn provider_home_for_id_in_root(root: &Path, provider_id: &str) -> Result<PathBuf, String> {
    let segment = sanitize_provider_path_segment(provider_id)?;
    Ok(root.join(segment))
}

fn write_file_with_owner_only_permissions(path: &Path, content: &str) -> Result<(), String> {
    fs::write(path, content)
        .map_err(|error| format!("failed to write {}: {error}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(path, permissions)
            .map_err(|error| format!("failed to set permissions on {}: {error}", path.display()))?;
    }
    Ok(())
}

fn extract_launch_critical_overrides(config_toml: &str) -> Result<Vec<String>, String> {
    let value = parse_codex_provider_config(config_toml)?;
    let mut overrides = Vec::new();
    for key in ["model", "model_provider", "approval_policy", "sandbox_mode"] {
        if let Some(raw_value) = value.get(key) {
            overrides.push(format!("{key}={}", raw_value));
        }
    }
    Ok(overrides)
}

fn shell_escape_codex_arg(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }
    if value.chars().all(|ch| {
        ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '/' | ':' | '=' | '+')
    }) {
        return value.to_string();
    }
    let escaped = value.replace('\'', "'\"'\"'");
    format!("'{escaped}'")
}

fn join_shell_escaped_codex_args(args: &[String]) -> String {
    args.iter()
        .map(|arg| shell_escape_codex_arg(arg))
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn materialize_codex_provider_profile(
    profile: CodexProviderProfile,
) -> Result<MaterializedCodexProviderProfile, String> {
    let provider_homes_root = app_paths::codex_provider_homes_dir()?;
    materialize_codex_provider_profile_in_root(profile, &provider_homes_root)
}

fn materialize_codex_provider_profile_in_root(
    profile: CodexProviderProfile,
    provider_homes_root: &Path,
) -> Result<MaterializedCodexProviderProfile, String> {
    match profile {
        CodexProviderProfile::Disk => Ok(MaterializedCodexProviderProfile {
            codex_home: None,
            codex_args_override: None,
        }),
        CodexProviderProfile::Managed {
            id,
            name,
            config_toml,
            auth_json,
        } => {
            validate_codex_provider_wire_api(&config_toml, &name)?;
            let provider_home = provider_home_for_id_in_root(provider_homes_root, &id)?;
            fs::create_dir_all(&provider_home).map_err(|error| {
                format!(
                    "failed to create Codex provider home {}: {error}",
                    provider_home.display()
                )
            })?;
            write_file_with_owner_only_permissions(
                &provider_home.join("config.toml"),
                &config_toml,
            )?;
            if let Some(auth_json) = auth_json.as_deref() {
                serde_json::from_str::<Value>(auth_json).map_err(|error| {
                    format!("invalid authJson for Codex provider {name}: {error}")
                })?;
                write_file_with_owner_only_permissions(
                    &provider_home.join("auth.json"),
                    auth_json,
                )?;
            }
            let overrides = extract_launch_critical_overrides(&config_toml)?;
            let codex_args_override = if overrides.is_empty() {
                None
            } else {
                let args = overrides
                    .into_iter()
                    .flat_map(|item| ["-c".to_string(), item])
                    .collect::<Vec<_>>();
                Some(join_shell_escaped_codex_args(&args))
            };
            Ok(MaterializedCodexProviderProfile {
                codex_home: Some(provider_home),
                codex_args_override,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn codex_runtime_key_includes_provider_profile() {
        assert_eq!(
            codex_runtime_key("ws-1", "provider-a"),
            "codex::ws-1::provider-a"
        );
        assert_eq!(
            codex_runtime_key("ws-1", CODEX_DISK_PROVIDER_PROFILE_ID),
            "codex::ws-1::__disk__"
        );
    }

    #[test]
    fn extract_launch_critical_overrides_reads_top_level_values() {
        let overrides = extract_launch_critical_overrides(
            r#"
model = "gpt-5"
model_provider = "openai"
sandbox_mode = "workspace-write"
[model_providers.openai]
base_url = "https://example.test"
"#,
        )
        .expect("overrides");
        assert!(overrides.contains(&r#"model="gpt-5""#.to_string()));
        assert!(overrides.contains(&r#"model_provider="openai""#.to_string()));
        assert!(overrides.contains(&r#"sandbox_mode="workspace-write""#.to_string()));
    }

    #[test]
    fn configured_model_reads_only_non_empty_top_level_model() {
        assert_eq!(
            configured_model_from_config_toml(
                r#"
model = "kimi-for-coding"
[model_providers.crs]
model = "ignored-nested-model"
"#,
            )
            .expect("valid config"),
            Some("kimi-for-coding".to_string())
        );
        assert_eq!(
            configured_model_from_config_toml("model_provider = \"crs\"")
                .expect("valid config without model"),
            None
        );
    }

    #[test]
    fn validate_wire_api_rejects_chat_in_any_model_provider_table() {
        let error = validate_codex_provider_wire_api(
            r#"
model_provider = "crs"

[model_providers.crs]
wire_api = "chat"
"#,
            "Kimi",
        )
        .expect_err("chat wire API must fail before launch");
        assert!(error.starts_with(CODEX_PROVIDER_WIRE_API_UNSUPPORTED_ERROR_PREFIX));
        assert!(error.contains("wire_api = \"chat\""));
        assert!(!error.contains("sk-"));
    }

    #[test]
    fn parse_provider_config_rejects_smart_quotes_without_echoing_source() {
        let config_toml = "wire_api = “chat\"";
        let error =
            parse_codex_provider_config(config_toml).expect_err("smart quote is invalid TOML");

        assert!(error.starts_with(CODEX_PROVIDER_CONFIG_INVALID_ERROR_PREFIX));
        assert!(!error.contains("“chat"));
        assert!(!error.contains("wire_api"));
    }

    #[test]
    fn validate_wire_api_allows_responses_and_missing_wire_api() {
        for config_toml in [
            r#"
model_provider = "crs"
[model_providers.crs]
wire_api = "responses"
"#,
            r#"model = "gpt-5""#,
            r#"
model_provider = "responses-provider"
[model_providers.responses-provider]
wire_api = "responses"
[model_providers.unused-chat-provider]
base_url = "https://example.test/v1"
"#,
        ] {
            validate_codex_provider_wire_api(config_toml, "Provider")
                .expect("supported or missing wire API must keep existing launch behavior");
        }
    }

    #[test]
    fn validate_wire_api_rejects_chat_in_unselected_provider_table() {
        let error = validate_codex_provider_wire_api(
            r#"
model_provider = "responses-provider"
[model_providers.responses-provider]
wire_api = "responses"
[model_providers.unused-chat-provider]
wire_api = "chat"
"#,
            "Mixed Provider",
        )
        .expect_err("Codex parses every model provider table during config loading");
        assert!(error.starts_with(CODEX_PROVIDER_WIRE_API_UNSUPPORTED_ERROR_PREFIX));
        assert!(error.contains("unused-chat-provider"));
    }

    #[test]
    fn join_shell_escaped_codex_args_preserves_values_with_spaces_and_quotes() {
        let args = vec![
            "-c".to_string(),
            r#"model="gpt-5 codex""#.to_string(),
            "-c".to_string(),
            "model_provider='open ai'".to_string(),
        ];
        let joined = join_shell_escaped_codex_args(&args);
        let parsed = crate::codex::args::parse_codex_args(Some(&joined)).expect("parse");

        assert_eq!(parsed, args);
    }

    #[test]
    fn materialize_managed_provider_writes_scoped_home_files() {
        let root =
            std::env::temp_dir().join(format!("ccgui-codex-provider-profile-{}", Uuid::new_v4()));
        let profile = CodexProviderProfile::Managed {
            id: "provider-a".to_string(),
            name: "Provider A".to_string(),
            config_toml: r#"
model = "gpt-5"
model_provider = "openai"
"#
            .to_string(),
            auth_json: Some(r#"{"OPENAI_API_KEY":"secret"}"#.to_string()),
        };

        let materialized =
            materialize_codex_provider_profile_in_root(profile, &root).expect("materialize");
        let provider_home = materialized.codex_home.expect("provider home");

        assert_eq!(provider_home, root.join("provider-a"));
        assert_eq!(
            fs::read_to_string(provider_home.join("config.toml")).expect("config"),
            r#"
model = "gpt-5"
model_provider = "openai"
"#
        );
        assert_eq!(
            fs::read_to_string(provider_home.join("auth.json")).expect("auth"),
            r#"{"OPENAI_API_KEY":"secret"}"#
        );
        assert!(materialized
            .codex_args_override
            .as_deref()
            .unwrap_or_default()
            .contains(r#"model="gpt-5""#));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(provider_home.join("auth.json"))
                .expect("auth metadata")
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn materialize_managed_provider_rejects_unsafe_provider_id() {
        let root =
            std::env::temp_dir().join(format!("ccgui-codex-provider-profile-{}", Uuid::new_v4()));
        let profile = CodexProviderProfile::Managed {
            id: "../provider-a".to_string(),
            name: "Provider A".to_string(),
            config_toml: "model = \"gpt-5\"".to_string(),
            auth_json: None,
        };

        let error =
            materialize_codex_provider_profile_in_root(profile, &root).expect_err("invalid id");
        assert!(error.contains("invalid Codex provider id"));
        assert!(!root.join("provider-a").exists());
    }

    #[test]
    fn materialize_managed_provider_rejects_chat_before_writing_provider_home() {
        let root =
            std::env::temp_dir().join(format!("ccgui-codex-provider-profile-{}", Uuid::new_v4()));
        let profile = CodexProviderProfile::Managed {
            id: "chat-provider".to_string(),
            name: "Chat Provider".to_string(),
            config_toml: r#"
model_provider = "crs"
[model_providers.crs]
wire_api = "chat"
"#
            .to_string(),
            auth_json: None,
        };

        let error =
            materialize_codex_provider_profile_in_root(profile, &root).expect_err("unsupported");
        assert!(error.starts_with(CODEX_PROVIDER_WIRE_API_UNSUPPORTED_ERROR_PREFIX));
        assert!(!root.join("chat-provider").exists());
    }

    #[test]
    fn materialize_managed_provider_rejects_invalid_toml_before_writing_provider_home() {
        let root =
            std::env::temp_dir().join(format!("ccgui-codex-provider-profile-{}", Uuid::new_v4()));
        let profile = CodexProviderProfile::Managed {
            id: "invalid-provider".to_string(),
            name: "Invalid Provider".to_string(),
            config_toml: "wire_api = “chat\"".to_string(),
            auth_json: None,
        };

        let error =
            materialize_codex_provider_profile_in_root(profile, &root).expect_err("invalid TOML");
        assert!(error.starts_with(CODEX_PROVIDER_CONFIG_INVALID_ERROR_PREFIX));
        assert!(!root.join("invalid-provider").exists());
    }

    #[test]
    fn materialize_managed_provider_rejects_windows_unsafe_provider_id() {
        let root =
            std::env::temp_dir().join(format!("ccgui-codex-provider-profile-{}", Uuid::new_v4()));
        for provider_id in ["CON", "com1", "provider:a", "provider*", "provider."] {
            let profile = CodexProviderProfile::Managed {
                id: provider_id.to_string(),
                name: "Provider A".to_string(),
                config_toml: "model = \"gpt-5\"".to_string(),
                auth_json: None,
            };
            let error =
                materialize_codex_provider_profile_in_root(profile, &root).expect_err("invalid id");
            assert!(
                error.contains("invalid Codex provider id"),
                "provider id {provider_id:?} should be rejected before filesystem access",
            );
        }
    }
}
