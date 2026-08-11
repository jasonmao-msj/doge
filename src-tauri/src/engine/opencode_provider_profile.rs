//! OpenCode vendor provider launch profiles.
//!
//! Unlike kimi/grok (which materialize provider configs into the CLI's own
//! config file under an isolated home), OpenCode providers are injected at
//! spawn time through the `OPENCODE_CONFIG_CONTENT` environment variable, so
//! doge never modifies the user's own `opencode.json`.

use std::collections::HashMap;
use std::fs;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::app_paths;
use crate::session_management::EngineProviderBinding;
use crate::types::OpenCodeProviderConfig;

#[derive(Debug, Serialize, Deserialize, Default)]
struct DogeConfig {
    #[serde(default)]
    opencode: OpenCodeSection,
    #[serde(flatten)]
    _extra: HashMap<String, Value>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct OpenCodeSection {
    #[serde(default)]
    providers: HashMap<String, Value>,
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

/// Convert a raw config.json `opencode.providers` entry into a typed provider.
/// Kept self-contained (same pattern as kimi/grok launch profiles) so this
/// module also compiles into the daemon crate, which has no vendors module.
fn value_to_opencode_provider(id: &str, value: &Value) -> Result<OpenCodeProviderConfig, String> {
    let read_string = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    Ok(OpenCodeProviderConfig {
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
        is_active: false,
        is_local_provider: value.get("isLocalProvider").and_then(Value::as_bool),
        base_url: read_string("baseUrl"),
        api_key: read_string("apiKey"),
        models: value
            .get("models")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default(),
    })
}

/// Resolve a stored managed provider by id from doge's config.json.
/// Returns `None` for the reserved local profile id or unknown ids.
fn resolve_managed_provider(profile_id: &str) -> Result<Option<OpenCodeProviderConfig>, String> {
    let profile_id = profile_id.trim();
    if profile_id.is_empty() || profile_id == OPENCODE_LOCAL_PROVIDER_PROFILE_ID {
        return Ok(None);
    }
    let Some(value) = read_config()?.opencode.providers.remove(profile_id) else {
        return Ok(None);
    };
    value_to_opencode_provider(profile_id, &value).map(Some)
}

/// Reserved profile id meaning "use the user's own opencode.json as-is".
pub(crate) const OPENCODE_LOCAL_PROVIDER_PROFILE_ID: &str = "__local_opencode_json__";

/// Stable provider key inside the injected `OPENCODE_CONFIG_CONTENT`.
/// Model refs under a managed provider look like `doge/<model>`.
pub(crate) const OPENCODE_MANAGED_PROVIDER_KEY: &str = "doge";
const LEGACY_OPENCODE_MANAGED_PROVIDER_KEYS: &[&str] = &["ccgui"];

#[derive(Debug, Clone)]
pub(crate) struct OpenCodeProviderLaunchProfile {
    pub(crate) binding: Option<EngineProviderBinding>,
    /// Inline opencode.json injected as `OPENCODE_CONFIG_CONTENT`;
    /// `None` for the local profile.
    pub(crate) config_content: Option<String>,
    /// First configured model of the managed provider (bare id, no prefix).
    pub(crate) default_model: Option<String>,
    pub(crate) runtime_key: String,
}

pub(crate) fn opencode_runtime_key(
    workspace_id: &str,
    provider_profile_id: Option<&str>,
) -> String {
    let profile_id = provider_profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(OPENCODE_LOCAL_PROVIDER_PROFILE_ID);
    format!("opencode::{workspace_id}::{profile_id}")
}

/// Qualify a bare or legacy model id with the managed provider key (`doge/<model>`).
pub(crate) fn qualify_managed_model_ref(model: &str) -> String {
    let trimmed = model.trim();
    if trimmed.starts_with(&format!("{OPENCODE_MANAGED_PROVIDER_KEY}/")) {
        trimmed.to_string()
    } else if let Some(model_id) = LEGACY_OPENCODE_MANAGED_PROVIDER_KEYS
        .iter()
        .find_map(|key| trimmed.strip_prefix(&format!("{key}/")))
    {
        format!("{OPENCODE_MANAGED_PROVIDER_KEY}/{model_id}")
    } else {
        format!("{OPENCODE_MANAGED_PROVIDER_KEY}/{trimmed}")
    }
}

/// Build the inline opencode.json document for a managed provider.
pub(crate) fn render_opencode_provider_config_content(
    provider: &OpenCodeProviderConfig,
) -> Result<String, String> {
    let base_url = provider.base_url.trim();
    if base_url.is_empty() {
        return Err(format!(
            "OpenCode provider {} has empty base URL",
            provider.name
        ));
    }
    let models: Vec<&str> = provider
        .models
        .iter()
        .map(|model| model.trim())
        .filter(|model| !model.is_empty())
        .collect();
    if models.is_empty() {
        return Err(format!("OpenCode provider {} has no models", provider.name));
    }

    let mut options = serde_json::Map::new();
    options.insert("baseURL".to_string(), Value::String(base_url.to_string()));
    if !provider.api_key.trim().is_empty() {
        options.insert(
            "apiKey".to_string(),
            Value::String(provider.api_key.trim().to_string()),
        );
    }
    let models_object: serde_json::Map<String, Value> = models
        .into_iter()
        .map(|model| (model.to_string(), json!({})))
        .collect();

    let document = json!({
        "$schema": "https://opencode.ai/config.json",
        "provider": {
            OPENCODE_MANAGED_PROVIDER_KEY: {
                "npm": "@ai-sdk/openai-compatible",
                "name": provider.name,
                "options": Value::Object(options),
                "models": Value::Object(models_object),
            }
        }
    });
    serde_json::to_string(&document)
        .map_err(|error| format!("failed to encode OpenCode provider config: {error}"))
}

pub(crate) fn resolve_opencode_provider_launch_profile(
    workspace_id: &str,
    provider_profile_id: Option<&str>,
) -> Result<OpenCodeProviderLaunchProfile, String> {
    let normalized = provider_profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    // The reserved local profile id means "use the user's own opencode.json":
    // it is a valid selection, not a lookup failure.
    let profile_id = match normalized {
        Some(id) if id != OPENCODE_LOCAL_PROVIDER_PROFILE_ID => id,
        _ => {
            return Ok(OpenCodeProviderLaunchProfile {
                binding: None,
                config_content: None,
                default_model: None,
                runtime_key: opencode_runtime_key(workspace_id, None),
            });
        }
    };
    let provider = resolve_managed_provider(&profile_id)?
        .ok_or_else(|| format!("OpenCode provider {profile_id} not found"))?;
    if provider.name.trim().is_empty() {
        return Err(format!("OpenCode provider {profile_id} is missing a name"));
    }
    let config_content = render_opencode_provider_config_content(&provider)?;
    let default_model = provider
        .models
        .iter()
        .map(|model| model.trim())
        .find(|model| !model.is_empty())
        .map(str::to_string);
    Ok(OpenCodeProviderLaunchProfile {
        binding: Some(EngineProviderBinding {
            provider_profile_id: profile_id.clone(),
            provider_profile_source: "managed".to_string(),
            provider_profile_name: provider.name,
            provider_availability: "available".to_string(),
        }),
        config_content: Some(config_content),
        default_model,
        runtime_key: opencode_runtime_key(workspace_id, Some(&profile_id)),
    })
}

/// Resolve a managed provider's config for the provider-scoped model catalog.
/// Returns `None` for the local profile id.
pub(crate) fn resolve_opencode_provider_model_config(
    provider_profile_id: &str,
) -> Result<Option<OpenCodeProviderConfig>, String> {
    let profile_id = provider_profile_id.trim();
    if profile_id.is_empty() || profile_id == OPENCODE_LOCAL_PROVIDER_PROFILE_ID {
        return Ok(None);
    }
    let provider = resolve_managed_provider(profile_id)?
        .ok_or_else(|| format!("OpenCode provider {profile_id} not found"))?;
    if provider.name.trim().is_empty() {
        return Err(format!("OpenCode provider {profile_id} is missing a name"));
    }
    Ok(Some(provider))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_provider() -> OpenCodeProviderConfig {
        OpenCodeProviderConfig {
            id: "relay".to_string(),
            name: "Relay".to_string(),
            remark: None,
            website_url: None,
            created_at: Some(1),
            sort_order: None,
            is_active: true,
            is_local_provider: None,
            base_url: "https://relay.example.com/v1".to_string(),
            api_key: "sk-test".to_string(),
            models: vec!["gpt-5.3-codex".to_string(), " claude-sonnet-5 ".to_string()],
        }
    }

    #[test]
    fn runtime_key_scopes_by_workspace_and_profile() {
        assert_eq!(
            opencode_runtime_key("ws-1", Some("relay")),
            "opencode::ws-1::relay"
        );
        assert_eq!(
            opencode_runtime_key("ws-1", None),
            "opencode::ws-1::__local_opencode_json__"
        );
    }

    #[test]
    fn qualify_managed_model_ref_prefixes_bare_models_only() {
        assert_eq!(qualify_managed_model_ref("gpt-5"), "doge/gpt-5");
        assert_eq!(qualify_managed_model_ref("doge/gpt-5"), "doge/gpt-5");
        assert_eq!(qualify_managed_model_ref("ccgui/gpt-5"), "doge/gpt-5");
    }

    #[test]
    fn local_profile_id_resolves_to_local_launch_profile() {
        for id in [None, Some(OPENCODE_LOCAL_PROVIDER_PROFILE_ID)] {
            let profile =
                resolve_opencode_provider_launch_profile("ws-1", id).expect("local resolves");
            assert!(profile.binding.is_none());
            assert!(profile.config_content.is_none());
            assert_eq!(profile.runtime_key, opencode_runtime_key("ws-1", None));
        }
    }

    #[test]
    fn render_config_content_injects_openai_compatible_provider() {
        let content = render_opencode_provider_config_content(&sample_provider())
            .expect("config content renders");
        let document: Value = serde_json::from_str(&content).expect("valid json");
        let provider = &document["provider"]["doge"];
        assert_eq!(provider["npm"], "@ai-sdk/openai-compatible");
        assert_eq!(provider["name"], "Relay");
        assert_eq!(
            provider["options"]["baseURL"],
            "https://relay.example.com/v1"
        );
        assert_eq!(provider["options"]["apiKey"], "sk-test");
        assert!(provider["models"]["gpt-5.3-codex"].is_object());
        assert!(provider["models"]["claude-sonnet-5"].is_object());
    }

    #[test]
    fn render_config_content_rejects_empty_base_url_or_models() {
        let mut provider = sample_provider();
        provider.base_url = "  ".to_string();
        assert!(render_opencode_provider_config_content(&provider).is_err());

        let mut provider = sample_provider();
        provider.models = Vec::new();
        assert!(render_opencode_provider_config_content(&provider).is_err());
    }
}
