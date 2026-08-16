use std::collections::BTreeMap;

use serde_json::Value;

use crate::session_management::EngineProviderBinding;

pub(crate) const CLAUDE_LOCAL_PROVIDER_PROFILE_ID: &str = "__local_settings_json__";
pub(crate) const CLAUDE_ACCOUNT_MANAGED_PROVIDER_PROFILE_ID: &str = "doge-token-matrix";

pub(crate) fn claude_runtime_key(workspace_id: &str, provider_profile_id: Option<&str>) -> String {
    let profile_id = provider_profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(CLAUDE_LOCAL_PROVIDER_PROFILE_ID);
    format!("claude::{workspace_id}::{profile_id}")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ClaudeProviderLaunchProfile {
    pub(crate) binding: EngineProviderBinding,
    pub(crate) env: BTreeMap<String, String>,
}

fn normalize_provider_env_scalar(
    provider_profile_id: &str,
    key: &str,
    value: &Value,
) -> Result<String, String> {
    match value {
        Value::String(value) => Ok(value.clone()),
        Value::Number(value) => Ok(value.to_string()),
        Value::Bool(value) => Ok(value.to_string()),
        Value::Null | Value::Array(_) | Value::Object(_) => Err(format!(
            "Claude provider {provider_profile_id} env {key} must be a string, number, or boolean"
        )),
    }
}

fn read_claude_provider_config() -> Result<Value, String> {
    let path = crate::app_paths::config_file_path()?;
    if !path.exists() {
        return Ok(Value::Object(serde_json::Map::new()));
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    if content.trim().is_empty() {
        return Ok(Value::Object(serde_json::Map::new()));
    }
    serde_json::from_str(&content)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))
}

fn resolve_claude_provider_launch_profile_from_config(
    config: &Value,
    provider_profile_id: &str,
) -> Result<Option<ClaudeProviderLaunchProfile>, String> {
    let provider_profile_id = provider_profile_id.trim();
    if provider_profile_id.is_empty() || provider_profile_id == CLAUDE_LOCAL_PROVIDER_PROFILE_ID {
        return Ok(None);
    }
    let provider = config
        .get("claude")
        .and_then(|claude| claude.get("providers"))
        .and_then(|providers| providers.get(provider_profile_id))
        .ok_or_else(|| format!("Claude provider {provider_profile_id} not found"))?;
    let provider_name = provider
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(provider_profile_id)
        .to_string();
    let env = provider
        .get("settingsConfig")
        .and_then(Value::as_object)
        .and_then(|settings| settings.get("env"))
        .and_then(Value::as_object)
        .ok_or_else(|| {
            format!("Claude provider {provider_profile_id} has no settingsConfig.env object")
        })?;
    let mut launch_env = BTreeMap::new();
    for (key, value) in env {
        launch_env.insert(
            key.clone(),
            normalize_provider_env_scalar(provider_profile_id, key, value)?,
        );
    }
    if launch_env.is_empty() {
        return Err(format!(
            "Claude provider {provider_profile_id} settingsConfig.env is empty"
        ));
    }
    Ok(Some(ClaudeProviderLaunchProfile {
        binding: EngineProviderBinding {
            provider_profile_id: provider_profile_id.to_string(),
            provider_profile_source: "managed".to_string(),
            provider_profile_name: provider_name,
            provider_availability: "available".to_string(),
        },
        env: launch_env,
    }))
}

pub(crate) fn resolve_claude_provider_launch_profile(
    provider_profile_id: Option<&str>,
) -> Result<Option<ClaudeProviderLaunchProfile>, String> {
    let Some(provider_profile_id) = provider_profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    if provider_profile_id == CLAUDE_LOCAL_PROVIDER_PROFILE_ID {
        return Ok(None);
    }
    resolve_claude_provider_launch_profile_from_config(
        &read_claude_provider_config()?,
        provider_profile_id,
    )
}

pub(crate) fn resolve_claude_provider_model_env(
    provider_profile_id: &str,
) -> Result<Option<BTreeMap<String, String>>, String> {
    resolve_claude_provider_launch_profile(Some(provider_profile_id))
        .map(|profile| profile.map(|profile| profile.env))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn resolves_managed_env_and_binding() {
        let config = json!({
            "claude": {
                "providers": {
                    "provider-a": {
                        "name": "Provider A",
                        "settingsConfig": {
                            "env": {
                                "ANTHROPIC_AUTH_TOKEN": "secret-token",
                                "ANTHROPIC_BASE_URL": "https://provider.example.test"
                            }
                        }
                    }
                }
            }
        });

        let profile = resolve_claude_provider_launch_profile_from_config(&config, "provider-a")
            .expect("resolve managed profile")
            .expect("managed profile");

        assert_eq!(profile.binding.provider_profile_id, "provider-a");
        assert_eq!(profile.binding.provider_profile_name, "Provider A");
        assert_eq!(
            profile.env.get("ANTHROPIC_BASE_URL").map(String::as_str),
            Some("https://provider.example.test")
        );
    }

    #[test]
    fn normalizes_legacy_scalar_env_values_for_catalog_and_launch() {
        let config = json!({
            "claude": {
                "providers": {
                    "deepseek": {
                        "name": "DeepSeek",
                        "settingsConfig": {
                            "env": {
                                "ANTHROPIC_MODEL": "deepseek-v4-pro",
                                "max_history": 3,
                                "max_tokens": 50000,
                                "stream": true
                            }
                        }
                    }
                }
            }
        });

        let profile = resolve_claude_provider_launch_profile_from_config(&config, "deepseek")
            .expect("legacy scalar env should resolve")
            .expect("managed profile");

        assert_eq!(
            profile.env.get("ANTHROPIC_MODEL").map(String::as_str),
            Some("deepseek-v4-pro")
        );
        assert_eq!(
            profile.env.get("max_history").map(String::as_str),
            Some("3")
        );
        assert_eq!(
            profile.env.get("max_tokens").map(String::as_str),
            Some("50000")
        );
        assert_eq!(profile.env.get("stream").map(String::as_str), Some("true"));
    }

    #[test]
    fn rejects_composite_and_null_env_values_with_context() {
        for (key, value) in [
            ("null_value", Value::Null),
            ("array_value", json!(["unsafe"])),
            ("object_value", json!({ "unsafe": true })),
        ] {
            let error = normalize_provider_env_scalar("provider-a", key, &value)
                .expect_err("non-scalar env must fail");

            assert!(error.contains("provider-a"));
            assert!(error.contains(key));
            assert!(error.contains("string, number, or boolean"));
        }
    }

    #[test]
    fn treats_local_as_default() {
        assert_eq!(
            resolve_claude_provider_launch_profile_from_config(
                &Value::Null,
                CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
            )
            .expect("resolve local profile"),
            None
        );
    }

    #[test]
    fn runtime_key_is_scoped_by_workspace_and_provider() {
        assert_eq!(
            claude_runtime_key("ws-1", Some("provider-a")),
            "claude::ws-1::provider-a"
        );
        assert_eq!(
            claude_runtime_key("ws-1", None),
            format!("claude::ws-1::{CLAUDE_LOCAL_PROVIDER_PROFILE_ID}")
        );
        assert_ne!(
            claude_runtime_key("ws-1", Some("provider-a")),
            claude_runtime_key("ws-1", Some("provider-b"))
        );
    }

    #[test]
    fn rejects_missing_or_invalid_env() {
        let config = json!({
            "claude": {
                "providers": {
                    "missing-env": { "name": "Missing Env" },
                    "invalid-env": {
                        "name": "Invalid Env",
                        "settingsConfig": {
                            "env": {
                                "ANTHROPIC_BASE_URL": "https://provider.example.test",
                                "nested": { "unsafe": true }
                            }
                        }
                    }
                }
            }
        });

        let missing =
            resolve_claude_provider_launch_profile_from_config(&config, "deleted-provider")
                .expect_err("missing provider must fail");
        let missing_env =
            resolve_claude_provider_launch_profile_from_config(&config, "missing-env")
                .expect_err("missing env must fail");
        let invalid_env =
            resolve_claude_provider_launch_profile_from_config(&config, "invalid-env")
                .expect_err("invalid env must fail");

        assert!(missing.contains("deleted-provider"));
        assert!(missing_env.contains("missing-env"));
        assert!(invalid_env.contains("invalid-env"));
        assert!(invalid_env.contains("nested"));
        assert!(invalid_env.contains("string, number, or boolean"));
    }
}
