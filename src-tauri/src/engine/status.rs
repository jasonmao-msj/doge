//! Engine status detection
//!
//! Detects installed CLI tools and their capabilities.

use serde::Deserialize;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{OnceLock, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::process::Command;
use tokio::time::timeout;

use super::{disabled_engine_status, EngineFeatures, EngineStatus, EngineType, ModelInfo};
use crate::app_paths;
use crate::backend::app_server::{build_codex_path_env, find_claude_code_binary, find_cli_binary};
use crate::backend::app_server_cli::resolve_safe_opencode_binary;

/// Timeout for CLI commands
const DETECTION_TIMEOUT: Duration = Duration::from_secs(10);
/// OpenCode model listing can be significantly slower than version probes.
const OPENCODE_MODELS_TIMEOUT: Duration = Duration::from_secs(30);
const GENERATED_MODEL_CATALOG_JSON: &str =
    include_str!("../../../src/features/models/generatedModelCatalog.json");
static OPENCODE_RUNTIME_MODEL_CATALOG: OnceLock<RwLock<Vec<ModelInfo>>> = OnceLock::new();

#[derive(Deserialize)]
struct GeneratedModelCatalog {
    #[serde(rename = "lastVerifiedAt")]
    last_verified_at: String,
    engines: GeneratedModelCatalogEngines,
}

#[derive(Deserialize)]
struct GeneratedModelCatalogEngines {
    codex: Vec<GeneratedModelEntry>,
    gemini: Vec<GeneratedModelEntry>,
    grok: Vec<GeneratedModelEntry>,
    kimi: Vec<GeneratedModelEntry>,
    #[serde(default)]
    opencode: Vec<GeneratedModelEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeneratedModelEntry {
    id: String,
    label: String,
    #[serde(default)]
    description: String,
    provider: String,
    protocol: String,
    lifecycle: String,
    #[serde(default)]
    default: bool,
}

fn get_generated_fallback_models(engine: EngineType) -> Vec<ModelInfo> {
    let Ok(catalog) = serde_json::from_str::<GeneratedModelCatalog>(GENERATED_MODEL_CATALOG_JSON)
    else {
        log::error!("[model-catalog] generated fallback artifact is invalid");
        return Vec::new();
    };
    let last_verified_at = catalog.last_verified_at;
    let entries = match engine {
        EngineType::Codex => catalog.engines.codex,
        EngineType::Gemini => catalog.engines.gemini,
        EngineType::Grok => catalog.engines.grok,
        EngineType::Kimi => catalog.engines.kimi,
        EngineType::OpenCode => catalog.engines.opencode,
        _ => return Vec::new(),
    };
    entries
        .into_iter()
        .map(|entry| {
            let mut model = ModelInfo::new(entry.id, entry.label)
                .with_description(entry.description)
                .with_provider(entry.provider)
                .with_protocol(entry.protocol)
                .with_provenance("generated:model-catalog")
                .with_fallback_freshness(last_verified_at.clone(), entry.lifecycle)
                .with_source("fallback");
            if entry.default {
                model = model.as_default();
            }
            model
        })
        .collect()
}

fn model_catalog_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn merge_provider_models_with_public(
    provider_models: Vec<ModelInfo>,
    public_models: Vec<ModelInfo>,
) -> Vec<ModelInfo> {
    dedupe_models_preserve_order(provider_models.into_iter().chain(public_models).collect())
}

fn public_models_for_engine(engine_type: EngineType) -> Vec<ModelInfo> {
    match engine_type {
        EngineType::Claude => get_builtin_claude_models(),
        EngineType::Codex | EngineType::Grok | EngineType::Kimi | EngineType::OpenCode => {
            get_generated_fallback_models(engine_type)
        }
        EngineType::Gemini => Vec::new(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UnlistedRuntimeModelPolicy {
    Allow,
    Reject,
}

pub(crate) fn validate_model_catalog_pair(
    model_catalog_entry_id: Option<&str>,
    runtime_model: Option<&str>,
    catalog: &[ModelInfo],
    unlisted_runtime_model_policy: UnlistedRuntimeModelPolicy,
) -> Result<(), String> {
    let model_catalog_entry_id = model_catalog_entry_id
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let runtime_model = runtime_model
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if let Some(entry_id) = model_catalog_entry_id {
        if let Some(entry) = catalog.iter().find(|entry| entry.id.trim() == entry_id) {
            let expected_runtime_model = if entry.model.trim().is_empty() {
                entry.id.trim()
            } else {
                entry.model.trim()
            };
            if runtime_model != Some(expected_runtime_model) {
                return Err(format!(
                    "invalid-target-model: catalog entry '{entry_id}' requires runtime model '{expected_runtime_model}'"
                ));
            }
            return Ok(());
        }
        // Catalog 未登记的自定义 / 自由模型名：Allow 时不拦截用户输入的 model id。
        // Reject 仍 fail-closed（旧 Shared 语义）；调用方若允许自定义应传 Allow。
        if unlisted_runtime_model_policy == UnlistedRuntimeModelPolicy::Allow {
            return Ok(());
        }
        return Err(format!(
            "invalid-target-model: catalog entry '{entry_id}' is unavailable for the selected Provider"
        ));
    }

    let Some(runtime_model) = runtime_model else {
        return Ok(());
    };
    if let Some(entry) = catalog.iter().find(|entry| {
        entry.id.trim() == runtime_model
            && !entry.model.trim().is_empty()
            && entry.model.trim() != runtime_model
    }) {
        return Err(format!(
            "invalid-target-model: '{}' is a catalog entry id; use runtime model '{}'",
            entry.id.trim(),
            entry.model.trim()
        ));
    }
    if catalog
        .iter()
        .any(|entry| entry.model.trim() == runtime_model)
        || unlisted_runtime_model_policy == UnlistedRuntimeModelPolicy::Allow
    {
        return Ok(());
    }
    Err(format!(
        "invalid-target-model: runtime model '{runtime_model}' is unavailable for the selected Provider"
    ))
}

pub(crate) fn get_local_engine_models_for_validation(
    engine_type: EngineType,
) -> Option<Vec<ModelInfo>> {
    match engine_type {
        EngineType::Claude => {
            let mut models = get_builtin_claude_models();
            apply_claude_model_overrides(&mut models, read_claude_model_overrides());
            ensure_default_model(&mut models);
            Some(dedupe_models_preserve_order(models))
        }
        EngineType::Codex => Some(get_codex_models()),
        EngineType::Kimi => Some(get_kimi_models(get_kimi_home_dir().as_deref()).0),
        EngineType::Grok => Some(get_grok_models(get_grok_home_dir().as_deref()).0),
        EngineType::OpenCode => Some(resolve_opencode_validation_catalog(
            cached_opencode_runtime_models(),
            public_models_for_engine(EngineType::OpenCode),
        )),
        EngineType::Gemini => None,
    }
}

fn claude_provider_models_from_env(
    provider_profile_id: &str,
    env: &std::collections::BTreeMap<String, String>,
) -> Vec<ModelInfo> {
    let overrides = ClaudeModelOverrides {
        main: normalize_non_empty(env.get("ANTHROPIC_MODEL").cloned()),
        fable: normalize_non_empty(env.get("ANTHROPIC_DEFAULT_FABLE_MODEL").cloned()),
        sonnet: normalize_non_empty(env.get("ANTHROPIC_DEFAULT_SONNET_MODEL").cloned()),
        opus: normalize_non_empty(env.get("ANTHROPIC_DEFAULT_OPUS_MODEL").cloned()),
        haiku: normalize_non_empty(env.get("ANTHROPIC_DEFAULT_HAIKU_MODEL").cloned()),
        reasoning: normalize_non_empty(env.get("ANTHROPIC_REASONING_MODEL").cloned()),
    };
    let mut models = get_builtin_claude_models();
    apply_claude_model_overrides(&mut models, overrides);
    ensure_default_model(&mut models);
    dedupe_models_preserve_order(models)
        .into_iter()
        .map(|model| model.with_provider_profile_id(provider_profile_id))
        .collect()
}

fn codex_provider_models_from_config(
    provider_profile_id: &str,
    config_toml: &str,
    custom_models: Vec<crate::types::CodexCustomModel>,
) -> Result<Vec<ModelInfo>, String> {
    let config: toml::Value = config_toml
        .parse()
        .map_err(|error| format!("invalid Codex provider configToml: {error}"))?;
    let configured_model = config
        .get("model")
        .and_then(toml::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let configured_provider = config
        .get("model_provider")
        .and_then(toml::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mut models = custom_models
        .into_iter()
        .filter_map(|custom_model| {
            let id = custom_model.id.trim().to_string();
            if id.is_empty() {
                return None;
            }
            let label = custom_model.label.trim();
            let mut model = ModelInfo::new(
                id.clone(),
                if label.is_empty() { id.as_str() } else { label },
            )
            .with_runtime_model(id)
            .with_source("provider-custom")
            .with_provenance("provider:codex-custom-model")
            .with_provider_profile_id(provider_profile_id);
            if let Some(description) = custom_model
                .description
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                model = model.with_description(description);
            }
            if let Some(provider) = configured_provider {
                model = model.with_provider(provider);
            }
            Some(model)
        })
        .collect::<Vec<_>>();
    if let Some(runtime_model) = configured_model {
        if let Some(existing) = models
            .iter_mut()
            .find(|model| model.model.trim() == runtime_model)
        {
            existing.default = true;
        } else {
            let mut model = ModelInfo::new(runtime_model, runtime_model)
                .with_runtime_model(runtime_model)
                .with_source("provider-config")
                .with_provenance("provider:codex-config-toml")
                .with_provider_profile_id(provider_profile_id)
                .as_default();
            if let Some(provider) = configured_provider {
                model = model.with_provider(provider);
            }
            models.insert(0, model);
        }
    }
    Ok(dedupe_models_preserve_order(models))
}

fn kimi_provider_models_from_config(
    provider_profile_id: &str,
    provider: crate::types::KimiProviderConfig,
) -> Vec<ModelInfo> {
    let runtime_model = provider.model.trim();
    if runtime_model.is_empty() {
        return Vec::new();
    }
    let display_name = provider
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(runtime_model);
    let provider_name = provider
        .provider_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("kimi");
    vec![ModelInfo::new(runtime_model, display_name)
        .with_runtime_model(runtime_model)
        .with_provider(provider_name)
        .with_protocol("kimi")
        .with_source("provider-config")
        .with_provenance("provider:kimi-config")
        .with_provider_profile_id(provider_profile_id)
        .as_default()]
}

fn grok_provider_models_from_config(
    provider_profile_id: &str,
    provider: crate::types::GrokProviderConfig,
) -> Vec<ModelInfo> {
    let runtime_model = provider.model.trim();
    if runtime_model.is_empty() {
        return Vec::new();
    }
    // Managed providers are materialized into the isolated GROK_HOME as
    // `[model."doge/<model>"]`. Grok's `-m` resolves config section aliases
    // (not inner `model` fields), so the catalog id must be the materialized
    // alias — passing the bare API model name would select the built-in model
    // and bypass the provider's base_url/api_key.
    let alias = format!(
        "{}{}",
        crate::engine::grok_provider_profile::GROK_MODEL_TOML_PREFIX,
        runtime_model
    );
    let display_name = provider
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(runtime_model);
    let provider_name = provider
        .provider_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("grok");
    vec![ModelInfo::new(alias, display_name)
        .with_provider(provider_name)
        .with_protocol("grok")
        .with_source("provider-config")
        .with_provenance("provider:grok-config")
        .with_provider_profile_id(provider_profile_id)
        .as_default()]
}

fn opencode_provider_models_from_config(
    provider_profile_id: &str,
    provider: &crate::types::OpenCodeProviderConfig,
) -> Vec<ModelInfo> {
    // Managed providers are injected via OPENCODE_CONFIG_CONTENT under the
    // stable `doge` provider key, so the catalog id must be the qualified
    // `doge/<model>` ref — passing the bare API model name would bypass the
    // provider's base_url/api_key.
    let provider_name = provider.name.trim();
    let provider_name = if provider_name.is_empty() {
        "opencode"
    } else {
        provider_name
    };
    let mut models = Vec::new();
    for raw_model in &provider.models {
        let runtime_model = raw_model.trim();
        if runtime_model.is_empty() {
            continue;
        }
        let qualified =
            crate::engine::opencode_provider_profile::qualify_managed_model_ref(runtime_model);
        models.push(
            ModelInfo::new(qualified.clone(), runtime_model)
                .with_runtime_model(qualified)
                .with_provider(provider_name)
                .with_protocol("opencode")
                .with_source("provider-config")
                .with_provenance("provider:opencode-config")
                .with_provider_profile_id(provider_profile_id),
        );
    }
    if let Some(first) = models.first_mut() {
        *first = first.clone().as_default();
    }
    models
}

pub(crate) fn get_provider_scoped_engine_models(
    engine_type: EngineType,
    provider_profile_id: Option<&str>,
) -> Result<Option<Vec<ModelInfo>>, String> {
    let Some(provider_profile_id) = provider_profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let provider_models = match engine_type {
        EngineType::Claude => {
            let Some(env) =
                crate::engine::claude::provider_profile::resolve_claude_provider_model_env(
                    provider_profile_id,
                )?
            else {
                return Ok(None);
            };
            claude_provider_models_from_env(provider_profile_id, &env)
        }
        EngineType::Codex => {
            let Some((config_toml, custom_models)) =
                crate::codex::provider_profile::resolve_codex_provider_model_config(
                    provider_profile_id,
                )?
            else {
                return Ok(None);
            };
            codex_provider_models_from_config(provider_profile_id, &config_toml, custom_models)?
        }
        EngineType::Kimi => {
            let Some(provider) =
                crate::engine::kimi_provider_profile::resolve_kimi_provider_model_config(
                    provider_profile_id,
                )?
            else {
                return Ok(None);
            };
            kimi_provider_models_from_config(provider_profile_id, provider)
        }
        EngineType::Grok => {
            let Some(provider) =
                crate::engine::grok_provider_profile::resolve_grok_provider_model_config(
                    provider_profile_id,
                )?
            else {
                return Ok(None);
            };
            grok_provider_models_from_config(provider_profile_id, provider)
        }
        EngineType::OpenCode => {
            let Some(provider) =
                crate::engine::opencode_provider_profile::resolve_opencode_provider_model_config(
                    provider_profile_id,
                )?
            else {
                return Ok(None);
            };
            // Unlike kimi/grok (materialized configs that keep built-in
            // providers working), an env-injected OPENCODE_CONFIG_CONTENT
            // disturbs the CLI's own provider auth resolution (observed: zen
            // 401 on 1.4.6 once a custom npm provider is declared). Managed
            // profiles therefore expose only their own models.
            return Ok(Some(opencode_provider_models_from_config(
                provider_profile_id,
                &provider,
            )));
        }
        EngineType::Gemini => return Ok(None),
    };
    Ok(Some(merge_provider_models_with_public(
        provider_models,
        public_models_for_engine(engine_type),
    )))
}

/// Build a tokio Command that correctly handles .cmd/.bat files on Windows.
/// Uses CREATE_NO_WINDOW to prevent visible console windows.
#[allow(unused_variables)]
fn build_async_command(bin: &str) -> Command {
    #[cfg(windows)]
    {
        // On Windows, .cmd/.bat files need to be run through cmd.exe
        let bin_lower = bin.to_lowercase();
        if bin_lower.ends_with(".cmd") || bin_lower.ends_with(".bat") {
            let mut cmd = crate::utils::async_command("cmd");
            cmd.arg("/c");
            cmd.arg(bin);
            return cmd;
        }
    }
    crate::utils::async_command(bin)
}

fn resolve_bin_path(name: &str, custom_bin: Option<&str>) -> Option<PathBuf> {
    if let Some(custom) = custom_bin.filter(|v| !v.trim().is_empty()) {
        let custom_path = PathBuf::from(custom);
        if custom_path.exists() {
            return Some(custom_path);
        }
    }
    if name == "claude" {
        return find_claude_code_binary(None);
    }
    find_cli_binary(name, None)
}

/// Probe a CLI binary for its version using `--version`.
/// Returns `(installed, version, error)`.
async fn probe_cli_version(
    bin: &str,
    cli_name: &str,
    path_env: Option<&String>,
) -> (bool, Option<String>, Option<String>) {
    let version_result = timeout(DETECTION_TIMEOUT, async {
        let mut cmd = build_async_command(bin);
        if let Some(path) = path_env {
            cmd.env("PATH", path);
        }
        let output = cmd
            .arg("--version")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .await;

        match output {
            Ok(out) if out.status.success() => {
                let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
                Ok(version)
            }
            Ok(out) => {
                let stderr = String::from_utf8_lossy(&out.stderr);
                Err(format!("{} --version failed: {}", cli_name, stderr.trim()))
            }
            Err(e) => Err(format!("Failed to execute {}: {}", cli_name, e)),
        }
    })
    .await;

    match version_result {
        Ok(Ok(v)) => (true, Some(v), None),
        Ok(Err(e)) => (false, None, Some(e)),
        Err(_) => (
            false,
            None,
            Some(format!("Timeout detecting {} CLI", cli_name)),
        ),
    }
}

async fn probe_cli_help(bin: &str, path_env: Option<&String>) -> bool {
    let help_result = timeout(DETECTION_TIMEOUT, async {
        let mut cmd = build_async_command(bin);
        if let Some(path) = path_env {
            cmd.env("PATH", path);
        }
        cmd.arg("--help")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .await
    })
    .await;

    matches!(help_result, Ok(Ok(output)) if output.status.success())
}

/// Build an uninstalled EngineStatus stub.
fn not_installed_status(engine_type: EngineType, error: Option<String>) -> EngineStatus {
    EngineStatus {
        engine_type,
        installed: false,
        version: None,
        bin_path: None,
        home_dir: None,
        models: Vec::new(),
        default_model: None,
        features: EngineFeatures::default(),
        error,
    }
}

/// Detect Claude Code CLI installation status
pub async fn detect_claude_status(custom_bin: Option<&str>) -> EngineStatus {
    let bin_path = resolve_bin_path("claude", custom_bin);
    let bin = bin_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "claude".to_string());
    let path_env = build_codex_path_env(custom_bin);

    let (mut installed, mut version, mut error) =
        probe_cli_version(&bin, "claude", path_env.as_ref()).await;

    if !installed && probe_cli_help(&bin, path_env.as_ref()).await {
        installed = true;
        if version.is_none() {
            version = Some("unknown".to_string());
        }
        error = None;
    }

    if !installed {
        return not_installed_status(EngineType::Claude, error);
    }

    let home_dir = get_claude_home_dir();
    let models = get_claude_models(&bin, path_env.as_ref()).await;
    let default_model = models.iter().find(|m| m.default).map(|m| m.id.clone());

    EngineStatus {
        engine_type: EngineType::Claude,
        installed: true,
        version,
        bin_path: Some(bin.to_string()),
        home_dir: home_dir.map(|p| p.to_string_lossy().to_string()),
        models,
        default_model,
        features: EngineFeatures::claude(),
        error: None,
    }
}

/// Detect Codex CLI installation status
pub async fn detect_codex_status(custom_bin: Option<&str>) -> EngineStatus {
    let Some(bin_path) = resolve_bin_path("codex", custom_bin) else {
        return not_installed_status(
            EngineType::Codex,
            Some("Codex CLI not found during startup detection".to_string()),
        );
    };
    let bin = bin_path.to_string_lossy().to_string();

    let home_dir = get_codex_home_dir();
    let models = get_codex_models();
    let default_model = models.iter().find(|m| m.default).map(|m| m.id.clone());

    EngineStatus {
        engine_type: EngineType::Codex,
        installed: true,
        version: None,
        bin_path: Some(bin.to_string()),
        home_dir: home_dir.map(|p| p.to_string_lossy().to_string()),
        models,
        default_model,
        features: EngineFeatures::codex(),
        error: None,
    }
}

async fn detect_opencode_status_with_options(
    custom_bin: Option<&str>,
    include_models: bool,
) -> EngineStatus {
    let safe_bin = resolve_safe_opencode_binary(custom_bin);
    let bin_path = match safe_bin {
        Ok(path) => Some(path),
        Err(error) if error == "OpenCode CLI not found" => None,
        Err(error) => {
            return not_installed_status(EngineType::OpenCode, Some(error));
        }
    };
    let bin = bin_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "opencode".to_string());
    let path_env = build_codex_path_env(custom_bin);

    let (mut installed, mut version, mut error) =
        probe_cli_version(&bin, "opencode", path_env.as_ref()).await;

    // OpenCode CLI in GUI-launched environments can intermittently fail `--version`
    // due to startup env quirks. Use a lightweight second probe to avoid false
    // "not installed" states in engine selector.
    if !installed {
        let help_probe = timeout(DETECTION_TIMEOUT, async {
            let mut cmd = build_async_command(&bin);
            if let Some(ref path) = &path_env {
                cmd.env("PATH", path);
            }
            cmd.arg("--help")
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .output()
                .await
        })
        .await;

        if let Ok(Ok(output)) = help_probe {
            if output.status.success() {
                installed = true;
                if version.is_none() {
                    version = Some("unknown".to_string());
                }
                error = None;
            }
        }
    }

    if !installed {
        return not_installed_status(EngineType::OpenCode, error);
    }

    let home_dir = get_opencode_home_dir();
    let (models, models_error) = if include_models {
        match get_opencode_models(&bin, path_env.as_ref()).await {
            Ok(models) if !models.is_empty() => {
                remember_opencode_runtime_models(&models);
                (models, None)
            }
            Ok(_) => (public_models_for_engine(EngineType::OpenCode), None),
            Err(err) => {
                let fallback = public_models_for_engine(EngineType::OpenCode);
                if fallback.is_empty() {
                    (Vec::new(), Some(err))
                } else {
                    (fallback, None)
                }
            }
        }
    } else {
        (Vec::new(), None)
    };
    let default_model = models.iter().find(|m| m.default).map(|m| m.id.clone());

    EngineStatus {
        engine_type: EngineType::OpenCode,
        installed: true,
        version,
        bin_path: Some(bin.to_string()),
        home_dir: home_dir.map(|p| p.to_string_lossy().to_string()),
        models,
        default_model,
        features: EngineFeatures::opencode(),
        error: models_error,
    }
}

/// Detect OpenCode CLI installation status. Probes the CLI model catalog
/// (like the kimi/grok detection paths) so engine selectors can render the
/// model list without a second round trip; falls back to the generated
/// roster when the probe is unavailable.
pub async fn detect_opencode_status(custom_bin: Option<&str>) -> EngineStatus {
    detect_opencode_status_with_options(custom_bin, true).await
}

/// Query OpenCode CLI for available models on demand.
pub async fn load_opencode_models(custom_bin: Option<&str>) -> Result<Vec<ModelInfo>, String> {
    let safe_bin = resolve_safe_opencode_binary(custom_bin)?;
    let bin = safe_bin.to_string_lossy().to_string();
    let path_env = build_codex_path_env(custom_bin);
    let models = get_opencode_models(&bin, path_env.as_ref()).await?;
    remember_opencode_runtime_models(&models);
    Ok(models)
}

/// Detect Gemini CLI installation status
pub async fn detect_gemini_status(custom_bin: Option<&str>) -> EngineStatus {
    if !crate::engine_policy::GEMINI_RUNTIME_ENABLED {
        return disabled_engine_status(EngineType::Gemini);
    }

    let bin_path = resolve_bin_path("gemini", custom_bin);
    let bin = bin_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "gemini".to_string());
    let path_env = build_codex_path_env(custom_bin);

    let (installed, version, error) = probe_cli_version(&bin, "gemini", path_env.as_ref()).await;

    if !installed {
        return not_installed_status(EngineType::Gemini, error);
    }

    let home_dir = get_gemini_home_dir();
    let models = get_gemini_models();
    let default_model = models.iter().find(|m| m.default).map(|m| m.id.clone());

    EngineStatus {
        engine_type: EngineType::Gemini,
        installed: true,
        version,
        bin_path: Some(bin.to_string()),
        home_dir: home_dir.map(|p| p.to_string_lossy().to_string()),
        models,
        default_model,
        features: EngineFeatures::gemini(),
        error: None,
    }
}

/// Detect Kimi CLI installation status
pub async fn detect_kimi_status(custom_bin: Option<&str>) -> EngineStatus {
    let bin_path = resolve_bin_path("kimi", custom_bin);
    let bin = bin_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "kimi".to_string());
    let path_env = build_codex_path_env(custom_bin);

    let (installed, version, error) = probe_cli_version(&bin, "kimi", path_env.as_ref()).await;

    if !installed {
        return not_installed_status(EngineType::Kimi, error);
    }

    let home_dir = get_kimi_home_dir();
    let (models, config_diagnostic) = get_kimi_models(home_dir.as_deref());
    let default_model = models.iter().find(|m| m.default).map(|m| m.id.clone());

    EngineStatus {
        engine_type: EngineType::Kimi,
        installed: true,
        version,
        bin_path: Some(bin.to_string()),
        home_dir: home_dir.map(|p| p.to_string_lossy().to_string()),
        models,
        default_model,
        features: EngineFeatures::kimi(),
        error: config_diagnostic,
    }
}

/// Detect Grok CLI installation status
pub async fn detect_grok_status(custom_bin: Option<&str>) -> EngineStatus {
    let bin_path = resolve_bin_path("grok", custom_bin);
    let bin = bin_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "grok".to_string());
    let path_env = build_codex_path_env(custom_bin);

    let (installed, version, error) = probe_cli_version(&bin, "grok", path_env.as_ref()).await;

    if !installed {
        return not_installed_status(EngineType::Grok, error);
    }

    let home_dir = get_grok_home_dir();
    let (models, config_diagnostic) = get_grok_models(home_dir.as_deref());
    let default_model = models.iter().find(|m| m.default).map(|m| m.id.clone());

    EngineStatus {
        engine_type: EngineType::Grok,
        installed: true,
        version,
        bin_path: Some(bin.to_string()),
        home_dir: home_dir.map(|p| p.to_string_lossy().to_string()),
        models,
        default_model,
        features: EngineFeatures::grok(),
        error: config_diagnostic,
    }
}

/// Get Claude Code home directory
fn get_claude_home_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".claude"))
}

/// Get Codex home directory
fn get_codex_home_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".codex"))
}

/// Get OpenCode home directory
fn get_opencode_home_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".opencode"))
}

/// Candidate OpenCode config file paths in probe order: `$OPENCODE_CONFIG`,
/// then `~/.config/opencode/opencode.json(c)`, then `~/.opencode/opencode.json(c)`.
pub fn opencode_config_candidate_paths() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(config) = std::env::var_os("OPENCODE_CONFIG").filter(|value| !value.is_empty()) {
        candidates.push(PathBuf::from(config));
    }
    if let Some(home) = dirs::home_dir() {
        for file_name in ["opencode.json", "opencode.jsonc"] {
            candidates.push(home.join(".config").join("opencode").join(file_name));
        }
        for file_name in ["opencode.json", "opencode.jsonc"] {
            candidates.push(home.join(".opencode").join(file_name));
        }
    }
    candidates
}

/// Read the first existing OpenCode config document best-effort.
///
/// Returns `(status, path, document, diagnostic)` where status is one of
/// `loaded` / `missing` / `malformed` / `io-error`. JSONC-only syntax
/// (comments, trailing commas) is not stripped; such files report `malformed`
/// and callers should treat dependent checks as inconclusive rather than broken.
pub fn read_opencode_config_document() -> (String, Option<PathBuf>, Value, Option<String>) {
    let Some(path) = opencode_config_candidate_paths()
        .into_iter()
        .find(|candidate| candidate.is_file())
    else {
        return ("missing".to_string(), None, Value::Null, None);
    };
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) => {
            return (
                "io-error".to_string(),
                Some(path.clone()),
                Value::Null,
                Some(format!("Failed to read {}: {}", path.display(), error)),
            )
        }
    };
    if raw.trim().is_empty() {
        return ("loaded".to_string(), Some(path), Value::Null, None);
    }
    match serde_json::from_str::<Value>(&raw) {
        Ok(document) => ("loaded".to_string(), Some(path), document, None),
        Err(error) => (
            "malformed".to_string(),
            Some(path.clone()),
            Value::Null,
            Some(format!("Failed to parse {}: {}", path.display(), error)),
        ),
    }
}

/// Get Gemini home directory
fn get_gemini_home_dir() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("GEMINI_CLI_HOME").filter(|v| !v.is_empty()) {
        let configured = PathBuf::from(home);
        let configured_text = configured.to_string_lossy();
        if configured_text == "~" {
            return dirs::home_dir();
        }
        if let Some(relative) = configured_text
            .strip_prefix("~/")
            .or_else(|| configured_text.strip_prefix("~\\"))
            .filter(|value| !value.is_empty())
        {
            return dirs::home_dir().map(|home| home.join(relative));
        }
        return Some(configured);
    }
    dirs::home_dir().map(|home| home.join(".gemini"))
}

/// Get Kimi home directory
fn get_kimi_home_dir() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("KIMI_CODE_HOME").filter(|v| !v.is_empty()) {
        let configured = PathBuf::from(home);
        let configured_text = configured.to_string_lossy();
        if configured_text == "~" {
            return dirs::home_dir();
        }
        if let Some(relative) = configured_text
            .strip_prefix("~/")
            .or_else(|| configured_text.strip_prefix("~\\"))
            .filter(|value| !value.is_empty())
        {
            return dirs::home_dir().map(|home| home.join(relative));
        }
        return Some(configured);
    }
    dirs::home_dir().map(|home| home.join(".kimi-code"))
}

/// Get Grok home directory
fn get_grok_home_dir() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("GROK_HOME").filter(|v| !v.is_empty()) {
        let configured = PathBuf::from(home);
        let configured_text = configured.to_string_lossy();
        if configured_text == "~" {
            return dirs::home_dir();
        }
        if let Some(relative) = configured_text
            .strip_prefix("~/")
            .or_else(|| configured_text.strip_prefix("~\\"))
            .filter(|value| !value.is_empty())
        {
            return dirs::home_dir().map(|home| home.join(relative));
        }
        return Some(configured);
    }
    dirs::home_dir().map(|home| home.join(".grok"))
}

/// Built-in fallback models used when `~/.grok/config.toml` is missing
/// or has no `[model]` tables yet (e.g. fresh install before first run).
fn get_builtin_grok_models() -> Vec<ModelInfo> {
    get_generated_fallback_models(EngineType::Grok)
}

/// Get Grok CLI available models by parsing `$GROK_HOME/config.toml`.
/// Falls back to the built-in catalog when the config file is missing or
/// defines no models.
fn get_grok_models(home_dir: Option<&std::path::Path>) -> (Vec<ModelInfo>, Option<String>) {
    let (models, config_diagnostic) = match read_grok_models_from_config(home_dir) {
        Ok(models) => (models.unwrap_or_default(), None),
        Err(error) => (Vec::new(), Some(error)),
    };

    if models.is_empty() {
        return (get_builtin_grok_models(), config_diagnostic);
    }
    (models, config_diagnostic)
}

/// Parse `[model.*]` entries and `[models].default` from grok's config.toml.
fn read_grok_models_from_config(
    home_dir: Option<&std::path::Path>,
) -> Result<Option<Vec<ModelInfo>>, String> {
    let Some(home_dir) = home_dir else {
        return Ok(None);
    };
    let config_path = home_dir.join("config.toml");
    let content = match std::fs::read_to_string(&config_path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Grok config io-error at {}: {}",
                config_path.display(),
                error
            ))
        }
    };
    let root = content.parse::<toml::Value>().map_err(|error| {
        format!(
            "Grok config malformed at {}: {}",
            config_path.display(),
            error
        )
    })?;
    let default_alias = root
        .get("models")
        .and_then(|value| value.get("default"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let Some(models_table) = root.get("model").and_then(|value| value.as_table()) else {
        return Ok(Some(Vec::new()));
    };

    let mut models = Vec::new();
    for (alias, entry) in models_table {
        let display_name = entry
            .get("name")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| alias.clone());
        // Grok's `-m/--model` resolves a `[model.<alias>]` section (or a
        // built-in model name), NOT the section's inner `model` field. Keep
        // `ModelInfo.model` equal to the alias so the composer sends the
        // alias and the CLI resolves base_url/api_key from the config
        // section (same alias semantics as kimi's `--model`).
        let mut info = ModelInfo::new(alias.clone(), display_name)
            .with_protocol("grok-config")
            .with_provenance("config:GROK_HOME/config.toml")
            .with_observed_at(model_catalog_now_ms())
            .with_source("config");
        if default_alias.as_deref() == Some(alias.as_str()) {
            info = info.as_default();
        }
        models.push(info);
    }
    models.sort_by(|a, b| a.id.cmp(&b.id));
    if let Some(index) = models.iter().position(|model| model.default) {
        let default = models.remove(index);
        models.insert(0, default);
    }
    Ok(Some(models))
}

/// Built-in fallback models used when `~/.kimi-code/config.toml` is missing
/// or has no `[models]` table yet (e.g. fresh install before first run).
fn get_builtin_kimi_models() -> Vec<ModelInfo> {
    get_generated_fallback_models(EngineType::Kimi)
}

/// Get Kimi CLI available models by parsing `$KIMI_CODE_HOME/config.toml`.
/// Falls back to the built-in catalog when the config file is missing or
/// defines no models.
fn get_kimi_models(home_dir: Option<&std::path::Path>) -> (Vec<ModelInfo>, Option<String>) {
    let (mut models, config_diagnostic) = match read_kimi_models_from_config(home_dir) {
        Ok(models) => (models.unwrap_or_default(), None),
        Err(error) => (Vec::new(), Some(error)),
    };

    // KIMI_MODEL_NAME synthesizes a temporary model that takes priority over
    // default_model in config.toml (mirrors the CLI's own precedence).
    if let Ok(env_model) = std::env::var("KIMI_MODEL_NAME") {
        let env_model = env_model.trim().to_string();
        if !env_model.is_empty() {
            for model in &mut models {
                model.default = false;
            }
            if let Some(index) = models.iter().position(|model| model.id == env_model) {
                let mut existing = models.remove(index);
                existing.default = true;
                models.insert(0, existing);
            } else {
                let display = std::env::var("KIMI_MODEL_DISPLAY_NAME")
                    .ok()
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                    .unwrap_or_else(|| env_model.clone());
                models.insert(
                    0,
                    ModelInfo::new(env_model, display)
                        .as_default()
                        .with_provider("kimi")
                        .with_protocol("kimi")
                        .with_provenance("env:KIMI_MODEL_NAME")
                        .with_observed_at(model_catalog_now_ms())
                        .with_description("Configured via KIMI_MODEL_NAME")
                        .with_source("env"),
                );
            }
        }
    }

    if models.is_empty() {
        return (get_builtin_kimi_models(), config_diagnostic);
    }
    (models, config_diagnostic)
}

/// Parse `[models.*]` entries and `default_model` from kimi's config.toml.
fn read_kimi_models_from_config(
    home_dir: Option<&std::path::Path>,
) -> Result<Option<Vec<ModelInfo>>, String> {
    let Some(home_dir) = home_dir else {
        return Ok(None);
    };
    let config_path = home_dir.join("config.toml");
    let content = match std::fs::read_to_string(&config_path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(format!(
                "Kimi config io-error at {}: {}",
                config_path.display(),
                error
            ))
        }
    };
    let root = content.parse::<toml::Value>().map_err(|error| {
        format!(
            "Kimi config malformed at {}: {}",
            config_path.display(),
            error
        )
    })?;
    let default_alias = root
        .get("default_model")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let Some(models_table) = root.get("models").and_then(|value| value.as_table()) else {
        return Ok(Some(Vec::new()));
    };

    let mut models = Vec::new();
    for (alias, entry) in models_table {
        let display_name = entry
            .get("display_name")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| {
                entry
                    .get("model")
                    .and_then(|value| value.as_str())
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
            })
            .unwrap_or_else(|| alias.clone());
        let provider = entry
            .get("provider")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let mut info = ModelInfo::new(alias.clone(), display_name)
            .with_protocol("kimi-config")
            .with_provenance("config:KIMI_CODE_HOME/config.toml")
            .with_observed_at(model_catalog_now_ms())
            .with_source("config");
        if let Some(provider) = provider {
            info = info.with_provider(provider);
        }
        if default_alias.as_deref() == Some(alias.as_str()) {
            info = info.as_default();
        }
        models.push(info);
    }
    models.sort_by(|a, b| a.id.cmp(&b.id));
    if let Some(index) = models.iter().position(|model| model.default) {
        let default = models.remove(index);
        models.insert(0, default);
    }
    Ok(Some(models))
}

/// Get Codex CLI available models (hardcoded as they don't change frequently)
fn get_codex_models() -> Vec<ModelInfo> {
    get_generated_fallback_models(EngineType::Codex)
}

/// Get Gemini CLI available models (stable defaults + preview model).
fn get_gemini_models() -> Vec<ModelInfo> {
    let mut models = get_generated_fallback_models(EngineType::Gemini);

    if let Some(configured_model) = read_configured_gemini_model() {
        for model in &mut models {
            model.default = false;
        }
        if let Some(existing_index) = models.iter().position(|model| model.id == configured_model) {
            let mut existing = models.remove(existing_index);
            existing.default = true;
            models.insert(0, existing);
        } else {
            models.insert(
                0,
                ModelInfo::new(configured_model.clone(), configured_model)
                    .as_default()
                    .with_provider("google")
                    .with_description("Configured in Gemini vendor settings"),
            );
        }
    }

    models
}

fn read_configured_gemini_model() -> Option<String> {
    if let Some(from_config) = read_gemini_model_from_doge_config() {
        return Some(from_config);
    }
    std::env::var("GEMINI_MODEL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn read_gemini_model_from_doge_config() -> Option<String> {
    let config_path = app_paths::config_file_path().ok()?;
    let content = std::fs::read_to_string(config_path).ok()?;
    let root = serde_json::from_str::<Value>(&content).ok()?;
    parse_gemini_model_from_config_json(&root)
}

fn parse_gemini_model_from_config_json(root: &Value) -> Option<String> {
    root.get("gemini")?
        .get("env")?
        .get("GEMINI_MODEL")?
        .as_str()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// Built-in Claude Code model catalog (mirrors the CLI `/model` roster).
///
/// The Claude CLI does not expose a model-list RPC, so this catalog is
/// hardcoded like `get_codex_models`. Settings/env overrides rewrite each
/// tier's runtime model + display name via `apply_claude_model_overrides`
/// (tier ids stay unique so the picker can keep one row per family).
fn get_builtin_claude_models() -> Vec<ModelInfo> {
    vec![
        ModelInfo::new("claude-fable-5", "Fable 5")
            .with_provider("anthropic")
            .with_protocol("anthropic-messages")
            .with_provenance("curated:claude-builtin")
            .with_description("Fable 5 · Most powerful · Mythos-class")
            .with_source("builtin"),
        ModelInfo::new("claude-opus-5", "Opus 5")
            .as_default()
            .with_provider("anthropic")
            .with_protocol("anthropic-messages")
            .with_provenance("curated:claude-builtin")
            .with_description("Opus 5 · Latest Opus upgrade")
            .with_source("builtin"),
        ModelInfo::new("claude-sonnet-5", "Sonnet 5")
            .with_provider("anthropic")
            .with_protocol("anthropic-messages")
            .with_provenance("curated:claude-builtin")
            .with_description("Sonnet 5 · Upgraded Sonnet model")
            .with_source("builtin"),
        ModelInfo::new("claude-haiku-4-5-20251001", "Haiku 4.5")
            .with_provider("anthropic")
            .with_protocol("anthropic-messages")
            .with_provenance("curated:claude-builtin")
            .with_description("Haiku 4.5 · Fastest for quick answers")
            .with_source("builtin"),
    ]
}

/// Build Claude model list.
///
/// Priority:
/// 1. Local Claude settings (`~/.claude/settings.json`) and env overrides
/// 2. Built-in catalog (see `get_builtin_claude_models`)
/// 3. Frontend user custom models (merged in the webview layer)
///
/// `claude --help` examples are intentionally not treated as a model catalog:
/// they are documentation snippets, not the current provider's configured list.
async fn get_claude_models(_bin: &str, _path_env: Option<&String>) -> Vec<ModelInfo> {
    let mut models = get_builtin_claude_models();
    apply_claude_model_overrides(&mut models, read_claude_model_overrides());
    ensure_default_model(&mut models);
    dedupe_models_preserve_order(models)
}

#[derive(Default, Clone)]
struct ClaudeModelOverrides {
    main: Option<String>,
    fable: Option<String>,
    sonnet: Option<String>,
    opus: Option<String>,
    haiku: Option<String>,
    reasoning: Option<String>,
}

fn normalize_non_empty(input: Option<String>) -> Option<String> {
    input.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

fn read_claude_model_overrides() -> ClaudeModelOverrides {
    let mut overrides = ClaudeModelOverrides {
        main: normalize_non_empty(std::env::var("ANTHROPIC_MODEL").ok()),
        fable: normalize_non_empty(std::env::var("ANTHROPIC_DEFAULT_FABLE_MODEL").ok()),
        sonnet: normalize_non_empty(std::env::var("ANTHROPIC_DEFAULT_SONNET_MODEL").ok()),
        opus: normalize_non_empty(std::env::var("ANTHROPIC_DEFAULT_OPUS_MODEL").ok()),
        haiku: normalize_non_empty(std::env::var("ANTHROPIC_DEFAULT_HAIKU_MODEL").ok()),
        reasoning: normalize_non_empty(std::env::var("ANTHROPIC_REASONING_MODEL").ok()),
    };

    if let Some(file_overrides) = read_claude_model_overrides_from_settings() {
        if file_overrides.main.is_some() {
            overrides.main = file_overrides.main;
        }
        if file_overrides.fable.is_some() {
            overrides.fable = file_overrides.fable;
        }
        if file_overrides.sonnet.is_some() {
            overrides.sonnet = file_overrides.sonnet;
        }
        if file_overrides.opus.is_some() {
            overrides.opus = file_overrides.opus;
        }
        if file_overrides.haiku.is_some() {
            overrides.haiku = file_overrides.haiku;
        }
        if file_overrides.reasoning.is_some() {
            overrides.reasoning = file_overrides.reasoning;
        }
    }

    overrides
}

fn read_claude_model_overrides_from_settings() -> Option<ClaudeModelOverrides> {
    let path = get_claude_home_dir()?.join("settings.json");
    let content = std::fs::read_to_string(path).ok()?;
    let root = serde_json::from_str::<Value>(&content).ok()?;
    let env = root.get("env")?;
    Some(ClaudeModelOverrides {
        main: normalize_non_empty(
            env.get("ANTHROPIC_MODEL")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        ),
        fable: normalize_non_empty(
            env.get("ANTHROPIC_DEFAULT_FABLE_MODEL")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        ),
        sonnet: normalize_non_empty(
            env.get("ANTHROPIC_DEFAULT_SONNET_MODEL")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        ),
        opus: normalize_non_empty(
            env.get("ANTHROPIC_DEFAULT_OPUS_MODEL")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        ),
        haiku: normalize_non_empty(
            env.get("ANTHROPIC_DEFAULT_HAIKU_MODEL")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        ),
        reasoning: normalize_non_empty(
            env.get("ANTHROPIC_REASONING_MODEL")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        ),
    })
}

/// Infer Claude model family for ANTHROPIC_DEFAULT_* slot resolution.
fn claude_model_family_key(model_id: &str) -> Option<&'static str> {
    let normalized = model_id.to_ascii_lowercase();
    if normalized.contains("fable") {
        return Some("fable");
    }
    if normalized.contains("haiku") {
        return Some("haiku");
    }
    if normalized.contains("sonnet") {
        return Some("sonnet");
    }
    if normalized.contains("opus") {
        return Some("opus");
    }
    None
}

fn resolve_override_for_family<'a>(
    family: &str,
    overrides: &'a ClaudeModelOverrides,
) -> Option<&'a str> {
    let tier = match family {
        "fable" => overrides.fable.as_deref(),
        "haiku" => overrides.haiku.as_deref(),
        "sonnet" => overrides.sonnet.as_deref(),
        "opus" => overrides.opus.as_deref(),
        _ => None,
    };
    tier.or(overrides.main.as_deref())
}

/// Apply settings/env model mapping onto the builtin tier catalog.
///
/// Keeps stable catalog ids (claude-opus-5, …) so the UI can still present
/// one row per family with the original tier description, while rewriting:
/// - `model` (runtime id sent to CLI)
/// - `name` / displayName (what the picker shows when mapping is active)
///
/// Mapping changes labels, not the tier list.
fn apply_claude_model_overrides(models: &mut Vec<ModelInfo>, overrides: ClaudeModelOverrides) {
    let has_any = overrides.main.is_some()
        || overrides.fable.is_some()
        || overrides.sonnet.is_some()
        || overrides.opus.is_some()
        || overrides.haiku.is_some();
    if !has_any {
        return;
    }

    for model in models.iter_mut() {
        let Some(family) = claude_model_family_key(&model.id) else {
            continue;
        };
        let Some(mapped) = resolve_override_for_family(family, &overrides) else {
            continue;
        };
        model.model = mapped.to_string();
        model.name = mapped.to_string();
        model.provenance = Some("settings:claude-model-override".to_string());
        // Keep builtin tier descriptions so the subtitle still explains the family.
        if model.source == "builtin" || model.source.is_empty() {
            model.source = "settings-mapped".to_string();
        }
    }
}

fn ensure_default_model(models: &mut [ModelInfo]) {
    if models.is_empty() {
        return;
    }
    if models.iter().any(|model| model.default) {
        return;
    }
    if let Some(first) = models.first_mut() {
        first.default = true;
    }
}

fn dedupe_models_preserve_order(models: Vec<ModelInfo>) -> Vec<ModelInfo> {
    let mut seen = std::collections::HashSet::new();
    let mut deduped = Vec::with_capacity(models.len());
    for model in models {
        // Prefer stable catalog id so family-mapped tiers (same runtime model)
        // remain distinct rows in the picker.
        let identity = if model.id.trim().is_empty() {
            if model.model.trim().is_empty() {
                continue;
            }
            model.model.clone()
        } else {
            model.id.clone()
        };
        if seen.insert(identity) {
            deduped.push(model);
        }
    }
    deduped
}

fn opencode_runtime_model_catalog() -> &'static RwLock<Vec<ModelInfo>> {
    OPENCODE_RUNTIME_MODEL_CATALOG.get_or_init(|| RwLock::new(Vec::new()))
}

fn remember_opencode_runtime_models(models: &[ModelInfo]) {
    if models.is_empty() {
        return;
    }
    let mut cached = opencode_runtime_model_catalog()
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *cached = models.to_vec();
}

fn cached_opencode_runtime_models() -> Option<Vec<ModelInfo>> {
    let cached = opencode_runtime_model_catalog()
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    (!cached.is_empty()).then(|| cached.clone())
}

fn resolve_opencode_validation_catalog(
    runtime_snapshot: Option<Vec<ModelInfo>>,
    generated_fallback: Vec<ModelInfo>,
) -> Vec<ModelInfo> {
    runtime_snapshot
        .filter(|models| !models.is_empty())
        .unwrap_or(generated_fallback)
}

/// Query OpenCode CLI for available models.
async fn get_opencode_models(
    bin: &str,
    path_env: Option<&String>,
) -> Result<Vec<ModelInfo>, String> {
    let output_result = timeout(OPENCODE_MODELS_TIMEOUT, async {
        let mut cmd = build_async_command(bin);
        if let Some(path) = path_env {
            cmd.env("PATH", path);
        }
        cmd.arg("models")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .await
    })
    .await;

    let output = match output_result {
        Ok(Ok(out)) => out,
        Ok(Err(err)) => return Err(format!("Failed to execute opencode models: {}", err)),
        Err(_) => return Err("Timeout listing OpenCode models".to_string()),
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("opencode models failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_opencode_models_output(&stdout))
}

fn parse_opencode_models_output(stdout: &str) -> Vec<ModelInfo> {
    fn strip_ansi_codes(input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        let mut chars = input.chars().peekable();
        while let Some(ch) = chars.next() {
            if ch == '\u{1b}' {
                if let Some('[') = chars.peek().copied() {
                    let _ = chars.next();
                    for c in chars.by_ref() {
                        if ('@'..='~').contains(&c) {
                            break;
                        }
                    }
                    continue;
                }
            }
            out.push(ch);
        }
        out
    }

    let clean = strip_ansi_codes(stdout);
    let mut models: Vec<ModelInfo> = clean
        .lines()
        .map(str::trim)
        .filter_map(|line| {
            if line.is_empty() {
                return None;
            }
            line.split_whitespace().find(|token| token.contains('/'))
        })
        .map(|full_id| {
            let (provider, model_id) = full_id.split_once('/').unwrap_or(("opencode", full_id));
            ModelInfo::new(full_id, format_opencode_model_name(provider, model_id))
                .with_provider(provider)
        })
        .collect();

    if models.is_empty() {
        return models;
    }

    let default_index = models
        .iter()
        .position(|m| m.id == "openai/gpt-5.3-codex")
        .or_else(|| models.iter().position(|m| m.id.starts_with("openai/")))
        .unwrap_or(0);

    if let Some(model) = models.get_mut(default_index) {
        model.default = true;
    }

    models
}

fn format_opencode_model_name(provider: &str, model_id: &str) -> String {
    let provider_name = match provider {
        "openai" => "OpenAI",
        "opencode" => "OpenCode",
        _ => provider,
    };
    let model_name = model_id
        .split('-')
        .map(|part| {
            if part.chars().all(|c| c.is_ascii_digit()) {
                part.to_string()
            } else {
                let mut chars = part.chars();
                match chars.next() {
                    Some(first) => {
                        let mut chunk = first.to_uppercase().to_string();
                        chunk.push_str(chars.as_str());
                        chunk
                    }
                    None => String::new(),
                }
            }
        })
        .collect::<Vec<_>>()
        .join("-");
    format!("{}/{}", provider_name, model_name)
}

/// Detect all supported engines
pub async fn detect_all_engines(
    claude_bin: Option<&str>,
    codex_bin: Option<&str>,
    gemini_bin: Option<&str>,
    opencode_bin: Option<&str>,
    kimi_bin: Option<&str>,
    grok_bin: Option<&str>,
    gemini_enabled: bool,
) -> Vec<EngineStatus> {
    // Run detections in parallel
    let (claude_status, codex_status, gemini_status, opencode_status, kimi_status, grok_status) = tokio::join!(
        detect_claude_status(claude_bin),
        detect_codex_status(codex_bin),
        async {
            if gemini_enabled && crate::engine_policy::GEMINI_RUNTIME_ENABLED {
                detect_gemini_status(gemini_bin).await
            } else {
                disabled_engine_status(EngineType::Gemini)
            }
        },
        detect_opencode_status(opencode_bin),
        detect_kimi_status(kimi_bin),
        detect_grok_status(grok_bin),
    );

    vec![
        claude_status,
        codex_status,
        gemini_status,
        opencode_status,
        kimi_status,
        grok_status,
    ]
}

/// Detect available engines and return the preferred default engine.
/// Priority: Claude > Codex > OpenCode (user can override in settings)
pub async fn detect_preferred_engine(
    claude_bin: Option<&str>,
    codex_bin: Option<&str>,
    gemini_bin: Option<&str>,
    opencode_bin: Option<&str>,
    kimi_bin: Option<&str>,
    grok_bin: Option<&str>,
) -> EngineType {
    let (claude_status, codex_status, gemini_status, opencode_status, kimi_status, grok_status) = tokio::join!(
        detect_claude_status(claude_bin),
        detect_codex_status(codex_bin),
        async {
            if crate::engine_policy::GEMINI_RUNTIME_ENABLED {
                detect_gemini_status(gemini_bin).await
            } else {
                disabled_engine_status(EngineType::Gemini)
            }
        },
        detect_opencode_status(opencode_bin),
        detect_kimi_status(kimi_bin),
        detect_grok_status(grok_bin),
    );

    // Priority: Claude first (more users have it installed)
    if claude_status.installed {
        return EngineType::Claude;
    }
    if codex_status.installed {
        return EngineType::Codex;
    }
    if crate::engine_policy::GEMINI_RUNTIME_ENABLED && gemini_status.installed {
        return EngineType::Gemini;
    }
    if opencode_status.installed {
        return EngineType::OpenCode;
    }
    if kimi_status.installed {
        return EngineType::Kimi;
    }
    if grok_status.installed {
        return EngineType::Grok;
    }

    // Default to Claude so error message is helpful
    EngineType::Claude
}

/// Resolve the engine type from user settings or auto-detect.
/// Priority:
/// 1. Workspace-specific setting (entry.settings.engine_type)
/// 2. App default setting (app_settings.default_engine)
/// 3. Auto-detect based on installed CLIs
pub async fn resolve_engine_type(
    workspace_engine: Option<&str>,
    app_default_engine: Option<&str>,
    claude_bin: Option<&str>,
    codex_bin: Option<&str>,
    gemini_bin: Option<&str>,
    opencode_bin: Option<&str>,
    kimi_bin: Option<&str>,
    grok_bin: Option<&str>,
) -> EngineType {
    // 1. Check workspace-specific setting
    if let Some(engine) = workspace_engine.filter(|s| !s.is_empty()) {
        match engine.to_lowercase().as_str() {
            "claude" => return EngineType::Claude,
            "codex" => return EngineType::Codex,
            "gemini" if crate::engine_policy::GEMINI_RUNTIME_ENABLED => return EngineType::Gemini,
            "gemini" => {}
            "opencode" => return EngineType::OpenCode,
            "kimi" => return EngineType::Kimi,
            "grok" => return EngineType::Grok,
            _ => {} // Invalid value, fall through
        }
    }

    // 2. Check app default setting
    if let Some(engine) = app_default_engine.filter(|s| !s.is_empty()) {
        match engine.to_lowercase().as_str() {
            "claude" => return EngineType::Claude,
            "codex" => return EngineType::Codex,
            "gemini" if crate::engine_policy::GEMINI_RUNTIME_ENABLED => return EngineType::Gemini,
            "gemini" => {}
            "opencode" => return EngineType::OpenCode,
            "kimi" => return EngineType::Kimi,
            "grok" => return EngineType::Grok,
            _ => {} // Invalid value, fall through
        }
    }

    // 3. Auto-detect based on installed CLIs
    detect_preferred_engine(
        claude_bin,
        codex_bin,
        gemini_bin,
        opencode_bin,
        kimi_bin,
        grok_bin,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn model_catalog_pair_separates_selection_id_from_runtime_model() {
        let catalog =
            vec![ModelInfo::new("settings-reasoning", "Reasoning")
                .with_runtime_model("deepseek-v4-pro")];

        assert!(validate_model_catalog_pair(
            Some("settings-reasoning"),
            Some("deepseek-v4-pro"),
            &catalog,
            UnlistedRuntimeModelPolicy::Reject,
        )
        .is_ok());
        assert!(validate_model_catalog_pair(
            Some("settings-reasoning"),
            Some("settings-reasoning"),
            &catalog,
            UnlistedRuntimeModelPolicy::Reject,
        )
        .expect_err("catalog id must not become the runtime model")
        .contains("requires runtime model 'deepseek-v4-pro'"));
        assert!(validate_model_catalog_pair(
            None,
            Some("settings-reasoning"),
            &catalog,
            UnlistedRuntimeModelPolicy::Reject,
        )
        .expect_err("legacy target must not treat a catalog id as runtime")
        .contains("is a catalog entry id"));
    }

    #[test]
    fn unlisted_runtime_policy_allow_accepts_custom_model_names() {
        let catalog = vec![ModelInfo::new("known", "Known")];

        assert!(validate_model_catalog_pair(
            None,
            Some("custom/provider-model"),
            &catalog,
            UnlistedRuntimeModelPolicy::Allow,
        )
        .is_ok());
        // 自定义 catalog entry id：Allow 不拦截用户模型名
        assert!(validate_model_catalog_pair(
            Some("gpt-5.3-codex-spark"),
            Some("gpt-5.3-codex-spark"),
            &catalog,
            UnlistedRuntimeModelPolicy::Allow,
        )
        .is_ok());
        assert!(validate_model_catalog_pair(
            None,
            Some("custom/provider-model"),
            &catalog,
            UnlistedRuntimeModelPolicy::Reject,
        )
        .expect_err("Reject still fail-closes unknown runtime models")
        .contains("runtime model 'custom/provider-model' is unavailable"));
        assert!(validate_model_catalog_pair(
            Some("gpt-5.3-codex-spark"),
            Some("gpt-5.3-codex-spark"),
            &catalog,
            UnlistedRuntimeModelPolicy::Reject,
        )
        .expect_err("Reject still fail-closes unknown catalog entries")
        .contains("catalog entry 'gpt-5.3-codex-spark' is unavailable"));
    }

    #[test]
    fn shared_local_validation_catalog_covers_all_supported_cli_engines() {
        for engine in [
            EngineType::Claude,
            EngineType::Codex,
            EngineType::Kimi,
            EngineType::Grok,
            EngineType::OpenCode,
        ] {
            let catalog = get_local_engine_models_for_validation(engine)
                .unwrap_or_else(|| panic!("missing local validation catalog for {engine:?}"));
            let selected = catalog
                .first()
                .unwrap_or_else(|| panic!("empty local validation catalog for {engine:?}"));

            assert!(
                validate_model_catalog_pair(
                    Some(&selected.id),
                    Some(&selected.model),
                    &catalog,
                    UnlistedRuntimeModelPolicy::Reject,
                )
                .is_ok(),
                "{engine:?}"
            );
        }
        assert!(get_local_engine_models_for_validation(EngineType::Gemini).is_none());
    }

    #[test]
    fn claude_settings_overrides_rewrite_builtin_tier_runtime_models() {
        let mut models = get_builtin_claude_models();
        apply_claude_model_overrides(
            &mut models,
            ClaudeModelOverrides {
                main: Some("MiniMax-M1[1m]".to_string()),
                fable: Some("kimi-k3".to_string()),
                sonnet: Some("GLM-5.1".to_string()),
                opus: Some("MiniMax-M4[1m]".to_string()),
                haiku: Some("deepseek-v4-flash".to_string()),
                ..ClaudeModelOverrides::default()
            },
        );
        // Tier ids stay stable; runtime model + display name are rewritten.
        let fable = models.iter().find(|m| m.id == "claude-fable-5").unwrap();
        assert_eq!(fable.model, "kimi-k3");
        assert_eq!(fable.name, "kimi-k3");
        assert!(fable.description.contains("Fable 5"));

        let opus = models.iter().find(|m| m.id == "claude-opus-5").unwrap();
        assert_eq!(opus.model, "MiniMax-M4[1m]");
        assert_eq!(opus.name, "MiniMax-M4[1m]");

        let sonnet = models.iter().find(|m| m.id == "claude-sonnet-5").unwrap();
        assert_eq!(sonnet.model, "GLM-5.1");
        assert_eq!(sonnet.name, "GLM-5.1");

        let haiku = models
            .iter()
            .find(|m| m.id == "claude-haiku-4-5-20251001")
            .unwrap();
        assert_eq!(haiku.model, "deepseek-v4-flash");
        assert_eq!(haiku.name, "deepseek-v4-flash");

        // No synthetic settings-* catalog rows.
        assert!(!models.iter().any(|model| model.id.starts_with("settings-")));
        assert_eq!(models.len(), 4);
    }

    #[tokio::test]
    async fn claude_models_include_builtin_catalog() {
        let models = get_claude_models("claude", None).await;
        // Builtin tier catalog ids always remain, even when settings rewrite the
        // runtime model (e.g. all tiers → kimi-k3).
        for catalog_id in [
            "claude-opus-5",
            "claude-fable-5",
            "claude-sonnet-5",
            "claude-haiku-4-5-20251001",
        ] {
            assert!(
                models.iter().any(|model| model.id == catalog_id),
                "missing builtin catalog id {catalog_id}"
            );
        }
        // Bare help aliases are still not synthesized as catalog entries.
        assert!(!models.iter().any(|model| model.id == "sonnet"));
        assert!(!models.iter().any(|model| model.id == "opus"));
        assert!(!models.iter().any(|model| model.id == "haiku"));
        assert_eq!(models.iter().filter(|model| model.default).count(), 1);
    }

    #[test]
    fn claude_settings_overrides_map_all_tiers_to_same_runtime_without_collapse() {
        let mut models = get_builtin_claude_models();
        apply_claude_model_overrides(
            &mut models,
            ClaudeModelOverrides {
                fable: Some("kimi-k3".to_string()),
                sonnet: Some("kimi-k3".to_string()),
                opus: Some("kimi-k3".to_string()),
                haiku: Some("kimi-k3".to_string()),
                ..ClaudeModelOverrides::default()
            },
        );
        ensure_default_model(&mut models);
        let models = dedupe_models_preserve_order(models);

        // All four tiers remain visible even when they share the same runtime model.
        assert_eq!(models.len(), 4);
        assert!(models.iter().all(|model| model.model == "kimi-k3"));
        assert!(models.iter().all(|model| model.name == "kimi-k3"));
        assert!(models.iter().any(|model| model.id == "claude-fable-5"));
        assert!(models.iter().any(|model| model.id == "claude-opus-5"));
        assert!(models.iter().any(|model| model.id == "claude-sonnet-5"));
        assert!(models
            .iter()
            .any(|model| model.id == "claude-haiku-4-5-20251001"));
        // Tier descriptions are preserved for the subtitle row.
        assert!(models
            .iter()
            .find(|model| model.id == "claude-fable-5")
            .unwrap()
            .description
            .contains("Mythos"));
    }

    #[test]
    fn claude_builtin_catalog_defaults_to_opus() {
        let mut models = get_builtin_claude_models();
        apply_claude_model_overrides(&mut models, ClaudeModelOverrides::default());
        ensure_default_model(&mut models);
        let models = dedupe_models_preserve_order(models);

        assert_eq!(models.len(), 4);
        assert!(models
            .iter()
            .all(|model| model.provider.as_deref() == Some("anthropic")));
        assert!(models.iter().all(|model| model.source == "builtin"));
        let default_model = models.iter().find(|model| model.default).unwrap();
        assert_eq!(default_model.id, "claude-opus-5");
        assert_eq!(default_model.name, "Opus 5");
    }

    #[test]
    fn claude_model_dedupe_uses_catalog_id() {
        // Same catalog id collapses.
        let same_id = dedupe_models_preserve_order(vec![
            ModelInfo::new("cli-sonnet", "Sonnet")
                .with_runtime_model("sonnet")
                .with_source("cli-discovered"),
            ModelInfo::new("cli-sonnet", "Fallback Sonnet")
                .with_runtime_model("sonnet")
                .with_source("builtin-fallback"),
        ]);
        assert_eq!(same_id.len(), 1);
        assert_eq!(same_id[0].source, "cli-discovered");

        // Different catalog ids with the same runtime model stay distinct
        // (required when ANTHROPIC_DEFAULT_* map every tier to one model).
        let shared_runtime = dedupe_models_preserve_order(vec![
            ModelInfo::new("claude-opus-5", "kimi-k3")
                .with_runtime_model("kimi-k3")
                .with_source("settings-mapped"),
            ModelInfo::new("claude-sonnet-5", "kimi-k3")
                .with_runtime_model("kimi-k3")
                .with_source("settings-mapped"),
        ]);
        assert_eq!(shared_runtime.len(), 2);
    }

    #[test]
    fn claude_provider_catalog_precedes_and_appends_public_models() {
        let env = std::collections::BTreeMap::from([(
            "ANTHROPIC_MODEL".to_string(),
            "claude-opus-5".to_string(),
        )]);
        let models = merge_provider_models_with_public(
            claude_provider_models_from_env("provider-a", &env),
            public_models_for_engine(EngineType::Claude),
        );

        // Provider catalog carries the full tier list, all scoped to the profile.
        // With only ANTHROPIC_MODEL set, every family falls back to that main slot.
        assert!(
            models
                .iter()
                .filter(|model| model.provider_profile_id.as_deref() == Some("provider-a"))
                .count()
                >= 4
        );
        assert_eq!(models[0].provider_profile_id.as_deref(), Some("provider-a"));
        assert!(models.iter().any(|model| model.id == "claude-opus-5"));
        assert!(models.iter().any(|model| model.id == "claude-sonnet-5"));
        assert!(models
            .iter()
            .filter(|model| model.provider_profile_id.as_deref() == Some("provider-a"))
            .all(|model| model.model == "claude-opus-5"));
    }

    #[test]
    fn codex_provider_catalog_merges_config_custom_and_public_models() {
        let provider_models = codex_provider_models_from_config(
            "provider-a",
            "model = \"gpt-5.3-codex\"\nmodel_provider = \"proxy-a\"\n",
            vec![crate::types::CodexCustomModel {
                id: "provider-only".to_string(),
                label: "Provider Only".to_string(),
                description: None,
            }],
        )
        .expect("parse provider catalog");
        let models = merge_provider_models_with_public(
            provider_models,
            public_models_for_engine(EngineType::Codex),
        );

        assert_eq!(
            models
                .iter()
                .filter(|model| model.model == "gpt-5.3-codex")
                .count(),
            1
        );
        assert!(models.iter().any(|model| {
            model.model == "provider-only"
                && model.provider_profile_id.as_deref() == Some("provider-a")
        }));
        assert!(models
            .iter()
            .any(|model| { model.source == "fallback" && model.provider_profile_id.is_none() }));
    }

    #[test]
    fn kimi_provider_catalog_precedes_duplicate_public_model() {
        let provider = crate::types::KimiProviderConfig {
            id: "provider-a".to_string(),
            name: "Provider A".to_string(),
            remark: None,
            website_url: None,
            created_at: None,
            sort_order: None,
            is_active: false,
            is_local_provider: None,
            base_url: "https://example.test".to_string(),
            api_key: "secret".to_string(),
            model: "kimi-for-coding".to_string(),
            provider_type: Some("openai".to_string()),
            max_context_size: None,
            display_name: Some("Provider Kimi".to_string()),
        };
        let models = merge_provider_models_with_public(
            kimi_provider_models_from_config("provider-a", provider),
            public_models_for_engine(EngineType::Kimi),
        );

        assert_eq!(
            models
                .iter()
                .filter(|model| model.model == "kimi-for-coding")
                .count(),
            1
        );
        assert_eq!(models[0].name, "Provider Kimi");
        assert_eq!(models[0].provider_profile_id.as_deref(), Some("provider-a"));
    }

    #[test]
    fn grok_config_models_use_alias_as_runtime_model() {
        let home = std::env::temp_dir().join(format!("ccgui-grok-alias-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&home).expect("create temp grok home");
        std::fs::write(
            home.join("config.toml"),
            "[models]\ndefault = \"grok\"\n\n[model.grok]\nmodel = \"grok-4.5\"\nname = \"Grok 4.5\"\nbase_url = \"https://relay.example.test/v1\"\napi_key = \"sk-test\"\n",
        )
        .expect("write config.toml");

        let models = read_grok_models_from_config(Some(home.as_path()))
            .expect("parse config")
            .expect("models present");

        assert_eq!(models.len(), 1);
        // `-m` must receive the section alias so the CLI resolves the custom
        // base_url/api_key; the inner `model` field would select the built-in.
        assert_eq!(models[0].id, "grok");
        assert_eq!(models[0].model, "grok");
        assert_eq!(models[0].name, "Grok 4.5");
        assert!(models[0].default);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn grok_provider_models_use_materialized_alias() {
        let provider = crate::types::GrokProviderConfig {
            id: "provider-a".to_string(),
            name: "Provider A".to_string(),
            remark: None,
            website_url: None,
            created_at: None,
            sort_order: None,
            is_active: false,
            is_local_provider: None,
            base_url: "https://example.test".to_string(),
            api_key: "secret".to_string(),
            model: "grok-4.5".to_string(),
            provider_type: None,
            api_backend: Some("responses".to_string()),
            max_context_size: None,
            display_name: Some("Provider Grok".to_string()),
        };
        let models = grok_provider_models_from_config("provider-a", provider);

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "doge/grok-4.5");
        assert_eq!(models[0].model, "doge/grok-4.5");
        assert_eq!(models[0].name, "Provider Grok");
        assert!(models[0].default);
    }

    #[test]
    fn generated_fallback_round_trips_provider_protocol_and_provenance() {
        let codex = get_codex_models();
        let gemini = get_gemini_models();
        let grok = get_builtin_grok_models();
        let kimi = get_builtin_kimi_models();
        assert!(!codex.is_empty());
        assert!(!gemini.is_empty());
        assert!(!grok.is_empty());
        assert!(!kimi.is_empty());
        assert!(codex.iter().all(|model| {
            model.provider.as_deref() == Some("openai")
                && model.protocol.as_deref() == Some("openai-responses")
                && model.provenance.as_deref() == Some("generated:model-catalog")
        }));
        assert!(grok.iter().all(|model| {
            model.provider.as_deref() == Some("grok")
                && model.protocol.as_deref() == Some("grok")
                && model.provenance.as_deref() == Some("generated:model-catalog")
        }));
        assert!(kimi.iter().all(|model| {
            model.provider.as_deref() == Some("kimi")
                && model.protocol.as_deref() == Some("kimi")
                && model.provenance.as_deref() == Some("generated:model-catalog")
        }));
        assert!(gemini.iter().all(|model| {
            model.provider.as_deref() == Some("google")
                && model.protocol.as_deref() == Some("google-gemini")
                && model.provenance.as_deref() == Some("generated:model-catalog")
        }));
        let serialized = serde_json::to_value(&codex[0]).expect("serialize model");
        assert_eq!(serialized["provider"], "openai");
        assert_eq!(serialized["protocol"], "openai-responses");
        assert_eq!(serialized["lastVerifiedAt"], "2026-07-27");
        assert_eq!(serialized["lifecycle"], "fallback");
    }

    #[test]
    fn home_dir_detection() {
        // These should not panic
        let _ = get_claude_home_dir();
        let _ = get_codex_home_dir();
        let _ = get_gemini_home_dir();
        let _ = get_opencode_home_dir();
        let _ = get_kimi_home_dir();
        let _ = get_grok_home_dir();
    }

    #[tokio::test]
    async fn resolve_engine_type_supports_opencode() {
        let resolved = resolve_engine_type(
            Some("opencode"),
            Some("claude"),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await;
        assert_eq!(resolved, EngineType::OpenCode);
    }

    #[tokio::test]
    async fn resolve_engine_type_normalizes_retired_workspace_gemini_to_allowed_default() {
        let resolved = resolve_engine_type(
            Some("gemini"),
            Some("claude"),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await;
        assert_eq!(resolved, EngineType::Claude);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn preferred_engine_detection_never_spawns_or_selects_disabled_gemini() {
        let marker_path = std::env::temp_dir().join(format!(
            "ccgui-gemini-preferred-probe-marker-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let script_path = write_unix_test_cli(&format!(
            "#!/bin/sh\nprintf spawned > '{}'\necho '1.2.3'\n",
            marker_path.display()
        ));

        let resolved = detect_preferred_engine(
            None,
            None,
            Some(script_path.to_string_lossy().as_ref()),
            None,
            None,
            None,
        )
        .await;

        assert_ne!(resolved, EngineType::Gemini);
        assert!(
            !marker_path.exists(),
            "preferred detection must skip Gemini"
        );
        let _ = fs::remove_file(&script_path);
        let _ = fs::remove_file(&marker_path);
        let _ = fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn add_workspace_resolver_normalizes_legacy_gemini_default_without_spawn() {
        let marker_path = std::env::temp_dir().join(format!(
            "ccgui-gemini-workspace-resolver-marker-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let script_path = write_unix_test_cli(&format!(
            "#!/bin/sh\nprintf spawned > '{}'\necho '1.2.3'\n",
            marker_path.display()
        ));

        let resolved = resolve_engine_type(
            None,
            Some("gemini"),
            None,
            None,
            Some(script_path.to_string_lossy().as_ref()),
            None,
            None,
            None,
        )
        .await;

        assert_ne!(resolved, EngineType::Gemini);
        assert!(
            !marker_path.exists(),
            "add-workspace resolution must skip Gemini"
        );
        let _ = fs::remove_file(&script_path);
        let _ = fs::remove_file(&marker_path);
        let _ = fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
    }

    #[tokio::test]
    async fn resolve_engine_type_supports_kimi() {
        let resolved = resolve_engine_type(
            Some("kimi"),
            Some("claude"),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await;
        assert_eq!(resolved, EngineType::Kimi);
    }

    #[tokio::test]
    async fn resolve_engine_type_supports_grok() {
        let resolved = resolve_engine_type(
            Some("grok"),
            Some("claude"),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await;
        assert_eq!(resolved, EngineType::Grok);
    }

    #[test]
    fn opencode_models_have_defaults() {
        let output = r#"
openai/gpt-5.3-codex
openai/gpt-5.4
opencode/gpt-5-nano
"#;
        let models = parse_opencode_models_output(output);
        assert!(!models.is_empty());
        assert!(models.iter().any(|m| m.default));
        assert!(models.iter().any(|m| m.id == "openai/gpt-5.3-codex"));
        assert!(models.iter().any(|m| m.id == "openai/gpt-5.4"));
    }

    #[test]
    fn opencode_model_name_formatting() {
        let name = format_opencode_model_name("openai", "gpt-5.3-codex");
        assert_eq!(name, "OpenAI/Gpt-5.3-Codex");
    }

    #[test]
    fn parse_opencode_models_output_handles_ansi_and_extra_columns() {
        let output = "\u{1b}[32mopenai/gpt-5.3-codex\u{1b}[0m  default\nminimax-cn-coding-plan/MiniMax-M2.5 available\n";
        let models = parse_opencode_models_output(output);
        assert_eq!(models.len(), 2);
        assert!(models.iter().any(|m| m.id == "openai/gpt-5.3-codex"));
        assert!(models
            .iter()
            .any(|m| m.id == "minimax-cn-coding-plan/MiniMax-M2.5"));
    }

    #[test]
    fn opencode_validation_prefers_runtime_snapshot_over_generated_fallback() {
        let runtime_models =
            parse_opencode_models_output("minimax-cn-coding-plan/MiniMax-M2.5 available\n");
        let selected = resolve_opencode_validation_catalog(
            Some(runtime_models),
            public_models_for_engine(EngineType::OpenCode),
        );

        assert!(selected
            .iter()
            .any(|model| model.id == "minimax-cn-coding-plan/MiniMax-M2.5"));
    }

    #[test]
    fn parse_gemini_model_from_config_json_extracts_trimmed_model() {
        let config = json!({
            "gemini": {
                "env": {
                    "GEMINI_MODEL": "  [L]gemini-3-pro-preview  "
                }
            }
        });
        let model = parse_gemini_model_from_config_json(&config);
        assert_eq!(model.as_deref(), Some("[L]gemini-3-pro-preview"));
    }

    #[cfg(unix)]
    fn write_unix_test_cli(script_body: &str) -> PathBuf {
        let unique = format!(
            "ccgui-engine-status-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let dir = std::env::temp_dir().join(unique);
        fs::create_dir_all(&dir).expect("create temp cli dir");
        let script_path = dir.join("codex-status-cli");
        fs::write(&script_path, script_body).expect("write temp cli script");
        let mut permissions = fs::metadata(&script_path)
            .expect("stat temp cli script")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&script_path, permissions).expect("chmod temp cli script");
        script_path
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn disabled_gemini_shared_detection_never_spawns_configured_cli() {
        let marker_path = std::env::temp_dir().join(format!(
            "ccgui-gemini-shared-probe-marker-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let script_path = write_unix_test_cli(&format!(
            "#!/bin/sh\nprintf spawned > '{}'\necho '1.2.3'\n",
            marker_path.display()
        ));

        let status = detect_gemini_status(Some(script_path.to_string_lossy().as_ref())).await;

        assert!(!status.installed);
        assert_eq!(
            status.error.as_deref(),
            Some(crate::engine_policy::GEMINI_DISABLED_DIAGNOSTIC)
        );
        assert!(!marker_path.exists(), "shared Gemini probe must not spawn");
        let _ = fs::remove_file(&script_path);
        let _ = fs::remove_file(&marker_path);
        let _ = fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn detect_codex_status_does_not_execute_resolved_cli() {
        let marker_path = std::env::temp_dir().join(format!(
            "ccgui-codex-startup-probe-marker-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let script_body = format!(
            "#!/bin/sh\nprintf '%s\\n' \"$1\" >> {}\necho 'codex 0.0.0'\nexit 0\n",
            marker_path.to_string_lossy()
        );
        let script_path = write_unix_test_cli(&script_body);

        let status = detect_codex_status(Some(script_path.to_string_lossy().as_ref())).await;

        assert!(status.installed);
        assert_eq!(status.engine_type, EngineType::Codex);
        assert!(
            !marker_path.exists(),
            "startup Codex status detection must not execute the resolved CLI"
        );

        let _ = fs::remove_file(&script_path);
        let _ = fs::remove_file(&marker_path);
        let _ = fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn detect_codex_status_reports_metadata_for_unprobeable_cli() {
        let script_path = write_unix_test_cli(
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo 'broken version' >&2\n  exit 1\nfi\nif [ \"$1\" = \"--help\" ]; then\n  echo 'usage'\n  exit 0\nfi\nexit 1\n",
        );

        let status = detect_codex_status(Some(script_path.to_string_lossy().as_ref())).await;
        assert!(status.installed);
        assert!(status.version.is_none());
        assert_eq!(status.engine_type, EngineType::Codex);
        assert!(status.bin_path.is_some());
        assert!(status.error.is_none());

        let _ = fs::remove_file(&script_path);
        let _ = fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn detect_opencode_status_falls_back_to_generated_roster_when_models_probe_fails() {
        let unique = format!(
            "ccgui-opencode-light-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let dir = std::env::temp_dir().join(unique);
        fs::create_dir_all(&dir).expect("create temp cli dir");
        let script_path = dir.join("opencode");
        let script_body =
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo '1.2.3'\n  exit 0\nfi\nif [ \"$1\" = \"--help\" ]; then\n  echo 'usage'\n  exit 0\nfi\nif [ \"$1\" = \"models\" ]; then\n  echo 'models should not run' >&2\n  exit 7\nfi\nexit 0\n";
        fs::write(&script_path, script_body).expect("write temp cli script");
        let mut permissions = fs::metadata(&script_path)
            .expect("stat temp cli script")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&script_path, permissions).expect("chmod temp cli script");

        let status = detect_opencode_status(Some(script_path.to_string_lossy().as_ref())).await;
        assert!(status.installed);
        assert!(
            !status.models.is_empty(),
            "failed models probe must fall back to the generated roster"
        );
        assert!(status.error.is_none());

        let _ = fs::remove_file(&script_path);
        let _ = fs::remove_dir_all(&dir);
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn detect_opencode_status_rejects_launcher_like_windows_candidate() {
        let unique = format!(
            "ccgui-opencode-launcher-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        let bin_path = root
            .join("AppData")
            .join("Local")
            .join("Programs")
            .join("OpenCode")
            .join("opencode.exe");
        fs::create_dir_all(bin_path.parent().expect("launcher dir")).expect("create launcher dir");
        fs::write(&bin_path, []).expect("create fake launcher");

        let status = detect_opencode_status(Some(bin_path.to_string_lossy().as_ref())).await;
        assert!(!status.installed);
        assert!(status
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("[OPENCODE_CLI_UNSAFE]"));

        let _ = fs::remove_file(&bin_path);
        let _ = fs::remove_dir_all(&root);
    }
}
