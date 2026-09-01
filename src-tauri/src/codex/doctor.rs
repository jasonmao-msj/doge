use serde_json::{json, Value};
use std::io::ErrorKind;
use std::time::Duration;
use tokio::time::timeout;

use crate::backend::app_server::{
    build_codex_path_env, build_engine_environment_diagnosis, check_cli_binary,
    check_codex_installation, classify_endpoint_failure, find_claude_code_binary,
    get_cli_debug_info, probe_codex_app_server, resolve_codex_launch_context,
};
use crate::backend::app_server_cli::resolve_safe_opencode_binary;
use crate::codex::launch_profile::resolve_global_codex_launch_profile;
use crate::engine::kimi_launch::{
    probe_kimi_shell_runtime, probe_kimi_version, resolve_kimi_launch_context,
};
use crate::types::AppSettings;

async fn probe_node_runtime(path_env: Option<&String>) -> (bool, Option<String>, Option<String>) {
    let mut node_command = crate::utils::async_command("node");
    if let Some(path_env) = path_env {
        node_command.env("PATH", path_env);
    }
    node_command.arg("--version");
    node_command.stdout(std::process::Stdio::piped());
    node_command.stderr(std::process::Stdio::piped());
    match timeout(Duration::from_secs(5), node_command.output()).await {
        Ok(result) => match result {
            Ok(output) => {
                if output.status.success() {
                    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    (
                        !version.is_empty(),
                        if version.is_empty() {
                            None
                        } else {
                            Some(version)
                        },
                        None,
                    )
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    let detail = if stderr.trim().is_empty() {
                        stdout.trim()
                    } else {
                        stderr.trim()
                    };
                    (
                        false,
                        None,
                        Some(if detail.is_empty() {
                            "Node failed to start.".to_string()
                        } else {
                            detail.to_string()
                        }),
                    )
                }
            }
            Err(err) => {
                if err.kind() == ErrorKind::NotFound {
                    (false, None, Some("Node not found on PATH.".to_string()))
                } else {
                    (false, None, Some(err.to_string()))
                }
            }
        },
        Err(_) => (
            false,
            None,
            Some("Timed out while checking Node.".to_string()),
        ),
    }
}

pub(crate) async fn run_codex_doctor_with_settings(
    codex_bin: Option<String>,
    codex_args: Option<String>,
    settings: &AppSettings,
) -> Result<Value, String> {
    let resolved_profile = resolve_global_codex_launch_profile(codex_bin, codex_args, settings);
    let resolved = resolved_profile.codex_bin;
    let resolved_args = resolved_profile.codex_args;
    let path_env = build_codex_path_env(resolved.as_deref());

    let debug_info = get_cli_debug_info(resolved.as_deref());
    let version_result = check_codex_installation(resolved.clone()).await;
    let (version, cli_error) = match version_result {
        Ok(v) => (v, None),
        Err(e) => (None, Some(e)),
    };

    let launch_context = resolve_codex_launch_context(resolved.as_deref());
    let probe_status = if version.is_some() {
        Some(probe_codex_app_server(resolved.clone(), resolved_args.as_deref()).await?)
    } else {
        None
    };
    let app_server_ok = probe_status
        .as_ref()
        .map(|status| status.ok)
        .unwrap_or(false);

    let (node_ok, node_version, node_details) = probe_node_runtime(path_env.as_ref()).await;

    let details = if let Some(ref err) = cli_error {
        Some(err.clone())
    } else if let Some(status) = probe_status.as_ref() {
        if status.ok {
            None
        } else {
            status
                .details
                .clone()
                .or_else(|| Some("Failed to run `codex app-server --help`.".to_string()))
        }
    } else {
        None
    };
    let environment_diagnosis =
        build_engine_environment_diagnosis("codex", resolved.as_deref(), &debug_info);
    let proxy_diagnosis = debug_info
        .get("proxyDiagnosis")
        .cloned()
        .unwrap_or(Value::Null);
    let network_diagnosis = if app_server_ok {
        Value::Null
    } else {
        json!({
            "category": classify_endpoint_failure(details.as_deref()),
            "proxy": proxy_diagnosis,
        })
    };

    Ok(json!({
        "ok": version.is_some() && app_server_ok,
        "codexBin": resolved,
        "version": version,
        "appServerOk": app_server_ok,
        "details": details,
        "path": path_env,
        "nodeOk": node_ok,
        "nodeVersion": node_version,
        "nodeDetails": node_details,
        "resolvedBinaryPath": launch_context.resolved_bin,
        "wrapperKind": launch_context.wrapper_kind,
        "pathEnvUsed": launch_context.path_env,
        "proxyEnvSnapshot": debug_info.get("proxyEnvSnapshot").cloned().unwrap_or(Value::Null),
        "appServerProbeStatus": probe_status.as_ref().map(|status| status.status.clone()),
        "fallbackRetried": probe_status.as_ref().map(|status| status.fallback_retried).unwrap_or(false),
        "environmentDiagnosis": environment_diagnosis,
        "proxyDiagnosis": proxy_diagnosis,
        "networkDiagnosis": network_diagnosis,
        "debug": debug_info,
    }))
}

pub(crate) async fn run_claude_doctor_with_settings(
    claude_bin: Option<String>,
    settings: &AppSettings,
) -> Result<Value, String> {
    let default_bin = settings.claude_bin.clone();
    let resolved = claude_bin
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or(default_bin);
    let requested_bin = resolved
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| find_claude_code_binary(None).map(|path| path.to_string_lossy().to_string()))
        .unwrap_or_else(|| "claude".to_string());
    let path_env = build_codex_path_env(Some(requested_bin.as_str()));
    let debug_info = get_cli_debug_info(Some(requested_bin.as_str()));
    let version_result = check_cli_binary(&requested_bin, path_env.clone()).await;
    let (version, cli_error, fallback_retried) = match version_result {
        Ok(Some(version)) => (Some(version), None, false),
        Ok(None) => (Some("unknown".to_string()), None, true),
        Err(error) => (None, Some(error), false),
    };
    let launch_context = resolve_codex_launch_context(Some(requested_bin.as_str()));

    let (node_ok, node_version, node_details) = probe_node_runtime(path_env.as_ref()).await;
    let environment_diagnosis =
        build_engine_environment_diagnosis("claude", Some(requested_bin.as_str()), &debug_info);
    let proxy_diagnosis = debug_info
        .get("proxyDiagnosis")
        .cloned()
        .unwrap_or(Value::Null);
    let network_diagnosis = if version.is_some() {
        Value::Null
    } else {
        json!({
            "category": classify_endpoint_failure(cli_error.as_deref()),
            "proxy": proxy_diagnosis,
        })
    };

    Ok(json!({
        "ok": version.is_some(),
        "codexBin": resolved,
        "version": version,
        "appServerOk": false,
        "details": cli_error,
        "path": path_env,
        "nodeOk": node_ok,
        "nodeVersion": node_version,
        "nodeDetails": node_details,
        "resolvedBinaryPath": launch_context.resolved_bin,
        "wrapperKind": launch_context.wrapper_kind,
        "pathEnvUsed": launch_context.path_env,
        "proxyEnvSnapshot": debug_info.get("proxyEnvSnapshot").cloned().unwrap_or(Value::Null),
        "appServerProbeStatus": Value::Null,
        "fallbackRetried": fallback_retried,
        "environmentDiagnosis": environment_diagnosis,
        "proxyDiagnosis": proxy_diagnosis,
        "networkDiagnosis": network_diagnosis,
        "debug": debug_info,
    }))
}

pub(crate) async fn run_kimi_doctor_with_settings(
    kimi_bin: Option<String>,
    settings: &AppSettings,
) -> Result<Value, String> {
    let default_bin = settings.kimi_bin.clone();
    let resolved = kimi_bin
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or(default_bin);
    let requested_bin = resolved.clone().filter(|value| !value.trim().is_empty());
    let requested_bin_text = requested_bin.as_deref().unwrap_or("kimi");
    let debug_info = get_cli_debug_info(requested_bin.as_deref());
    let kimi_home = std::env::var_os("KIMI_CODE_HOME").map(std::path::PathBuf::from);
    let launch = resolve_kimi_launch_context(requested_bin.as_deref(), kimi_home.as_deref());
    let (version, cli_error, shell_diagnosis, path_env, resolved_binary_path) = match launch {
        Ok(context) => {
            let version_result = probe_kimi_version(&context).await;
            let shell_diagnosis = probe_kimi_shell_runtime(&context).await;
            let version_error = version_result.as_ref().err().cloned();
            (
                version_result.ok(),
                version_error,
                shell_diagnosis,
                Some(context.path_env.clone()),
                Some(context.binary.to_string_lossy().to_string()),
            )
        }
        Err(error) => (
            None,
            Some(error.clone()),
            json!({
                "ok": false,
                "category": kimi_diagnostic_category(&error),
                "message": safe_kimi_diagnostic_message(&error),
            }),
            None,
            None,
        ),
    };
    let shell_ok = shell_diagnosis
        .get("ok")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let (node_ok, node_version, node_details) = (true, None::<String>, None::<String>);
    let cli_doctor = Value::Null;
    let environment_diagnosis =
        build_engine_environment_diagnosis("kimi", Some(requested_bin_text), &debug_info);
    let proxy_diagnosis = debug_info
        .get("proxyDiagnosis")
        .cloned()
        .unwrap_or(Value::Null);
    let network_diagnosis = if version.is_some() && shell_ok {
        Value::Null
    } else {
        json!({
            "category": classify_endpoint_failure(cli_error.as_deref()),
            "proxy": proxy_diagnosis,
        })
    };

    Ok(json!({
        "ok": version.is_some() && shell_ok,
        "codexBin": resolved,
        "version": version,
        "appServerOk": false,
        "details": cli_error,
        "path": path_env,
        "nodeOk": node_ok,
        "nodeRequired": false,
        "nodeVersion": node_version,
        "nodeDetails": node_details,
        "resolvedBinaryPath": resolved_binary_path,
        "wrapperKind": "direct",
        "pathEnvUsed": path_env,
        "proxyEnvSnapshot": debug_info.get("proxyEnvSnapshot").cloned().unwrap_or(Value::Null),
        "appServerProbeStatus": Value::Null,
        "fallbackRetried": false,
        "environmentDiagnosis": environment_diagnosis,
        "proxyDiagnosis": proxy_diagnosis,
        "networkDiagnosis": network_diagnosis,
        "kimiDoctor": cli_doctor,
        "kimiShell": shell_diagnosis,
        "debug": debug_info,
    }))
}

fn kimi_diagnostic_category(error: &str) -> &'static str {
    if error.contains("KIMI_BINARY_MISSING") || error.contains("KIMI_SHELL_MISSING") {
        "missing"
    } else if error.contains("KIMI_SHELL_UNSUPPORTED_PLATFORM") {
        "unsupported-platform"
    } else if error.contains("KIMI_SHELL_CHECKSUM_MISMATCH") {
        "checksum-mismatch"
    } else if error.contains("KIMI_SHELL_PERMISSION_DENIED") {
        "permission-denied"
    } else if error.contains("KIMI_SHELL_INVALID") {
        "invalid"
    } else if error.contains("KIMI_PROBE_TIMEOUT") || error.contains("KIMI_PROBE_FAILED") {
        "probe-failed"
    } else {
        "invalid"
    }
}

fn safe_kimi_diagnostic_message(error: &str) -> String {
    error
        .split_once(']')
        .map(|(_, message)| message.trim().to_string())
        .unwrap_or_else(|| "Kimi runtime is unavailable".to_string())
}

/// Run `grok doctor` (terminal/config self-check, exit 0 = healthy) best-effort.
async fn probe_grok_cli_doctor(binary: &str, path_env: Option<&String>) -> Value {
    let mut command = crate::utils::async_command(binary);
    if let Some(path_env) = path_env {
        command.env("PATH", path_env);
    }
    command.arg("doctor");
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());
    match timeout(Duration::from_secs(15), command.output()).await {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let combined = if stdout.is_empty() {
                stderr
            } else if stderr.is_empty() {
                stdout
            } else {
                format!("{stdout}\n{stderr}")
            };
            let summary = if combined.chars().count() > 2_000 {
                format!("{}…", combined.chars().take(2_000).collect::<String>())
            } else {
                combined
            };
            json!({
                "ok": output.status.success(),
                "exitCode": output.status.code(),
                "output": summary,
            })
        }
        Ok(Err(error)) => json!({
            "ok": false,
            "exitCode": Value::Null,
            "output": format!("failed to run `grok doctor`: {error}"),
        }),
        Err(_) => json!({
            "ok": false,
            "exitCode": Value::Null,
            "output": "`grok doctor` timed out",
        }),
    }
}

pub(crate) async fn run_grok_doctor_with_settings(
    grok_bin: Option<String>,
    settings: &AppSettings,
) -> Result<Value, String> {
    let default_bin = settings.grok_bin.clone();
    let resolved = grok_bin
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or(default_bin);
    let requested_bin = resolved
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "grok".to_string());
    let path_env = build_codex_path_env(Some(requested_bin.as_str()));
    let debug_info = get_cli_debug_info(Some(requested_bin.as_str()));
    let version_result = check_cli_binary(&requested_bin, path_env.clone()).await;
    let (version, cli_error, fallback_retried) = match version_result {
        Ok(Some(version)) => (Some(version), None, false),
        Ok(None) => (Some("unknown".to_string()), None, true),
        Err(error) => (None, Some(error), false),
    };
    let launch_context = resolve_codex_launch_context(Some(requested_bin.as_str()));

    let (node_ok, node_version, node_details) = probe_node_runtime(path_env.as_ref()).await;
    let cli_doctor = if version.is_some() {
        probe_grok_cli_doctor(&requested_bin, path_env.as_ref()).await
    } else {
        Value::Null
    };
    let cli_doctor_ok = cli_doctor
        .get("ok")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let environment_diagnosis =
        build_engine_environment_diagnosis("grok", Some(requested_bin.as_str()), &debug_info);
    let proxy_diagnosis = debug_info
        .get("proxyDiagnosis")
        .cloned()
        .unwrap_or(Value::Null);
    let network_diagnosis = if version.is_some() {
        Value::Null
    } else {
        json!({
            "category": classify_endpoint_failure(cli_error.as_deref()),
            "proxy": proxy_diagnosis,
        })
    };

    Ok(json!({
        "ok": version.is_some() && (cli_doctor.is_null() || cli_doctor_ok),
        "codexBin": resolved,
        "version": version,
        "appServerOk": false,
        "details": cli_error,
        "path": path_env,
        "nodeOk": node_ok,
        "nodeVersion": node_version,
        "nodeDetails": node_details,
        "resolvedBinaryPath": launch_context.resolved_bin,
        "wrapperKind": launch_context.wrapper_kind,
        "pathEnvUsed": launch_context.path_env,
        "proxyEnvSnapshot": debug_info.get("proxyEnvSnapshot").cloned().unwrap_or(Value::Null),
        "appServerProbeStatus": Value::Null,
        "fallbackRetried": fallback_retried,
        "environmentDiagnosis": environment_diagnosis,
        "proxyDiagnosis": proxy_diagnosis,
        "networkDiagnosis": network_diagnosis,
        "grokDoctor": cli_doctor,
        "debug": debug_info,
    }))
}

/// Pure decision step of the default-model check, split out for unit tests.
///
/// A configured default model that is missing from the `opencode models`
/// output makes `opencode run` fail with "Model not found", so it is reported
/// as a warning. Strict-JSON parse failures (JSONC syntax) and a missing
/// models list degrade to `unknown` instead of a false warning; a missing
/// config file or missing `model` key is `skipped` (OpenCode then falls back
/// to its built-in default, which cannot be probed cheaply — actually running
/// a turn is intentionally avoided as too expensive for a doctor check).
fn opencode_default_model_probe_from_document(
    status: &str,
    config_path: Option<String>,
    document: &Value,
    diagnostic: Option<String>,
    model_ids: Option<&[String]>,
) -> Value {
    match status {
        "loaded" => {
            let model = document
                .get("model")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(String::from);
            match model {
                None => json!({
                    "status": "skipped",
                    "configPath": config_path,
                    "diagnostic": "config has no `model` key; OpenCode falls back to its built-in default",
                }),
                Some(model) => match model_ids {
                    None => json!({
                        "status": "unknown",
                        "model": model,
                        "configPath": config_path,
                        "diagnostic": "models list unavailable; cannot verify the configured default model",
                    }),
                    Some(ids) if ids.iter().any(|id| id == &model) => json!({
                        "status": "pass",
                        "model": model,
                        "configPath": config_path,
                    }),
                    Some(_) => json!({
                        "status": "warning",
                        "model": model,
                        "configPath": config_path,
                        "diagnostic": format!(
                            "configured default model `{model}` is not listed by `opencode models`; `opencode run` may fail with \"Model not found\""
                        ),
                    }),
                },
            }
        }
        "missing" => json!({
            "status": "skipped",
            "diagnostic": "no opencode config file found; OpenCode uses its built-in default model",
        }),
        _ => json!({
            "status": "unknown",
            "configPath": config_path,
            "diagnostic": diagnostic.unwrap_or_else(|| format!("config status: {status}")),
        }),
    }
}

/// Check 3 (warning-level): the default model configured in the user's
/// opencode config must resolve against the `opencode models` list.
fn probe_opencode_default_model(model_ids: Option<&[String]>) -> Value {
    let (status, path, document, diagnostic) =
        crate::engine::status::read_opencode_config_document();
    let config_path = path.map(|path| path.to_string_lossy().to_string());
    opencode_default_model_probe_from_document(
        status.as_str(),
        config_path,
        &document,
        diagnostic,
        model_ids,
    )
}

pub(crate) async fn run_opencode_doctor_with_settings(
    opencode_bin: Option<String>,
    settings: &AppSettings,
) -> Result<Value, String> {
    let default_bin = settings.opencode_bin.clone();
    let resolved = opencode_bin
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or(default_bin);

    // Check 1: binary reachability + version. Resolution mirrors
    // detect_opencode_status (resolve_safe_opencode_binary) so custom bins and
    // the Windows background-safety gate behave the same as engine detection.
    let (requested_bin, resolution_error) = match resolve_safe_opencode_binary(resolved.as_deref())
    {
        Ok(path) => (path.to_string_lossy().to_string(), None),
        Err(error) => (
            resolved
                .clone()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "opencode".to_string()),
            Some(error),
        ),
    };
    let path_env = build_codex_path_env(Some(requested_bin.as_str()));
    let debug_info = get_cli_debug_info(Some(requested_bin.as_str()));
    let version_result = check_cli_binary(&requested_bin, path_env.clone()).await;
    let (version, mut cli_error, fallback_retried) = match version_result {
        Ok(Some(version)) => (Some(version), None, false),
        Ok(None) => (Some("unknown".to_string()), None, true),
        Err(error) => (None, Some(error), false),
    };
    if version.is_none() {
        if let Some(error) = resolution_error {
            cli_error = Some(error);
        }
    }
    let launch_context = resolve_codex_launch_context(Some(requested_bin.as_str()));

    let (node_ok, node_version, node_details) = probe_node_runtime(path_env.as_ref()).await;

    // Check 2: `opencode models` must list at least one model.
    let (models_probe, model_ids) = if version.is_some() {
        match crate::engine::status::load_opencode_models(resolved.as_deref()).await {
            Ok(models) => {
                let ids: Vec<String> = models.iter().map(|model| model.id.clone()).collect();
                (
                    json!({
                        "ok": !models.is_empty(),
                        "count": models.len(),
                        "error": if models.is_empty() {
                            Some("`opencode models` returned an empty list".to_string())
                        } else {
                            None::<String>
                        },
                    }),
                    Some(ids),
                )
            }
            Err(error) => (
                json!({
                    "ok": false,
                    "count": 0,
                    "error": Some(error),
                }),
                None,
            ),
        }
    } else {
        (Value::Null, None)
    };
    let models_ok = models_probe
        .get("ok")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    let default_model_probe = if version.is_some() {
        probe_opencode_default_model(model_ids.as_deref())
    } else {
        Value::Null
    };

    let environment_diagnosis =
        build_engine_environment_diagnosis("opencode", Some(requested_bin.as_str()), &debug_info);
    let proxy_diagnosis = debug_info
        .get("proxyDiagnosis")
        .cloned()
        .unwrap_or(Value::Null);
    let network_diagnosis = if version.is_some() {
        Value::Null
    } else {
        json!({
            "category": classify_endpoint_failure(cli_error.as_deref()),
            "proxy": proxy_diagnosis,
        })
    };

    Ok(json!({
        "ok": version.is_some() && models_ok,
        "codexBin": resolved,
        "version": version,
        "appServerOk": false,
        "details": cli_error,
        "path": path_env,
        "nodeOk": node_ok,
        "nodeVersion": node_version,
        "nodeDetails": node_details,
        "resolvedBinaryPath": launch_context.resolved_bin,
        "wrapperKind": launch_context.wrapper_kind,
        "pathEnvUsed": launch_context.path_env,
        "proxyEnvSnapshot": debug_info.get("proxyEnvSnapshot").cloned().unwrap_or(Value::Null),
        "appServerProbeStatus": Value::Null,
        "fallbackRetried": fallback_retried,
        "environmentDiagnosis": environment_diagnosis,
        "proxyDiagnosis": proxy_diagnosis,
        "networkDiagnosis": network_diagnosis,
        "opencodeModels": models_probe,
        "opencodeDefaultModel": default_model_probe,
        "debug": debug_info,
    }))
}

#[cfg(test)]
mod tests {
    use super::{
        kimi_diagnostic_category, opencode_default_model_probe_from_document,
        run_claude_doctor_with_settings, run_grok_doctor_with_settings,
        run_kimi_doctor_with_settings, run_opencode_doctor_with_settings,
        safe_kimi_diagnostic_message,
    };
    use crate::types::AppSettings;
    use serde_json::{json, Value};

    #[tokio::test]
    async fn kimi_doctor_failure_keeps_structured_diagnostics_fields() {
        let diagnostics = run_kimi_doctor_with_settings(
            Some("/definitely/missing/kimi".to_string()),
            &AppSettings::default(),
        )
        .await
        .expect("doctor should return structured diagnostics even on failure");

        for key in [
            "ok",
            "codexBin",
            "version",
            "details",
            "nodeOk",
            "environmentDiagnosis",
            "networkDiagnosis",
            "kimiDoctor",
            "kimiShell",
            "debug",
        ] {
            assert!(
                diagnostics.get(key).is_some(),
                "missing structured diagnostics field: {key}"
            );
        }

        assert_eq!(diagnostics["codexBin"], "/definitely/missing/kimi");
        assert_eq!(diagnostics["ok"], false);
        assert_eq!(diagnostics["kimiShell"]["category"], "missing");
        assert!(diagnostics["kimiDoctor"].is_null());
        assert!(diagnostics["debug"].is_object());
    }

    #[test]
    fn kimi_diagnostic_categories_are_stable_and_frontend_safe() {
        assert_eq!(
            kimi_diagnostic_category("[KIMI_BINARY_MISSING] missing"),
            "missing"
        );
        assert_eq!(
            kimi_diagnostic_category("[KIMI_SHELL_CHECKSUM_MISMATCH] mismatch"),
            "checksum-mismatch"
        );
        assert_eq!(
            kimi_diagnostic_category("[KIMI_SHELL_PERMISSION_DENIED] denied"),
            "permission-denied"
        );
        assert_eq!(
            kimi_diagnostic_category("[KIMI_SHELL_UNSUPPORTED_PLATFORM] unsupported"),
            "unsupported-platform"
        );
        assert_eq!(
            kimi_diagnostic_category("[KIMI_PROBE_FAILED] failed"),
            "probe-failed"
        );
        assert_eq!(
            safe_kimi_diagnostic_message("[KIMI_PROBE_FAILED] secret-free detail"),
            "secret-free detail"
        );
    }

    #[tokio::test]
    async fn grok_doctor_failure_keeps_structured_diagnostics_fields() {
        let diagnostics = run_grok_doctor_with_settings(
            Some("/definitely/missing/grok".to_string()),
            &AppSettings::default(),
        )
        .await
        .expect("doctor should return structured diagnostics even on failure");

        for key in [
            "ok",
            "codexBin",
            "version",
            "details",
            "nodeOk",
            "environmentDiagnosis",
            "networkDiagnosis",
            "grokDoctor",
            "debug",
        ] {
            assert!(
                diagnostics.get(key).is_some(),
                "missing structured diagnostics field: {key}"
            );
        }

        assert_eq!(diagnostics["codexBin"], "/definitely/missing/grok");
        assert_eq!(diagnostics["ok"], false);
        assert!(diagnostics["grokDoctor"].is_null());
        assert!(diagnostics["debug"].is_object());
    }

    #[tokio::test]
    async fn claude_doctor_failure_keeps_structured_diagnostics_fields() {
        let diagnostics = run_claude_doctor_with_settings(
            Some("/definitely/missing/claude".to_string()),
            &AppSettings::default(),
        )
        .await
        .expect("doctor should return structured diagnostics even on failure");

        for key in [
            "ok",
            "codexBin",
            "version",
            "appServerOk",
            "details",
            "path",
            "nodeOk",
            "nodeVersion",
            "nodeDetails",
            "resolvedBinaryPath",
            "wrapperKind",
            "pathEnvUsed",
            "proxyEnvSnapshot",
            "appServerProbeStatus",
            "fallbackRetried",
            "environmentDiagnosis",
            "proxyDiagnosis",
            "networkDiagnosis",
            "debug",
        ] {
            assert!(
                diagnostics.get(key).is_some(),
                "missing structured diagnostics field: {key}"
            );
        }

        assert_eq!(diagnostics["codexBin"], "/definitely/missing/claude");
        assert_eq!(diagnostics["ok"], false);
        assert!(diagnostics["details"].is_string() || diagnostics["details"].is_null());
        assert!(diagnostics["debug"].is_object());
    }

    #[cfg(unix)]
    fn write_fake_opencode_script(body: &str) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;
        let unique = format!(
            "ccgui-opencode-doctor-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock")
                .as_nanos()
        );
        let dir = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(&dir).expect("create temp cli dir");
        let script_path = dir.join("opencode");
        std::fs::write(&script_path, body).expect("write temp cli script");
        let mut permissions = std::fs::metadata(&script_path)
            .expect("stat temp cli script")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&script_path, permissions).expect("chmod temp cli script");
        script_path
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn opencode_doctor_failure_keeps_structured_diagnostics_fields() {
        // A failing fake binary keeps the probe deterministic even on machines
        // where a real `opencode` is installed (custom-bin resolution falls
        // back to PATH search for missing paths).
        let script_path = write_fake_opencode_script("#!/bin/sh\nexit 1\n");
        let script_bin = script_path.to_string_lossy().to_string();

        let diagnostics =
            run_opencode_doctor_with_settings(Some(script_bin.clone()), &AppSettings::default())
                .await
                .expect("doctor should return structured diagnostics even on failure");

        for key in [
            "ok",
            "codexBin",
            "version",
            "details",
            "nodeOk",
            "environmentDiagnosis",
            "networkDiagnosis",
            "opencodeModels",
            "opencodeDefaultModel",
            "debug",
        ] {
            assert!(
                diagnostics.get(key).is_some(),
                "missing structured diagnostics field: {key}"
            );
        }

        assert_eq!(diagnostics["codexBin"], script_bin);
        assert_eq!(diagnostics["ok"], false);
        assert!(diagnostics["version"].is_null());
        assert!(diagnostics["opencodeModels"].is_null());
        assert!(diagnostics["opencodeDefaultModel"].is_null());
        assert!(diagnostics["debug"].is_object());

        let _ = std::fs::remove_file(&script_path);
        let _ = std::fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn opencode_doctor_models_check_reports_listed_models() {
        let script_path = write_fake_opencode_script(
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo '1.2.3'\n  exit 0\nfi\nif [ \"$1\" = \"models\" ]; then\n  echo 'opencode/gpt-5-nano'\n  echo 'openai/gpt-5.3-codex'\n  exit 0\nfi\nexit 0\n",
        );
        let script_bin = script_path.to_string_lossy().to_string();

        let diagnostics =
            run_opencode_doctor_with_settings(Some(script_bin), &AppSettings::default())
                .await
                .expect("doctor should succeed against the fake cli");

        assert_eq!(diagnostics["ok"], true);
        assert_eq!(diagnostics["version"], "1.2.3");
        assert_eq!(diagnostics["opencodeModels"]["ok"], true);
        assert_eq!(diagnostics["opencodeModels"]["count"], 2);
        // The default-model probe reads the real user config; only its
        // structure is deterministic across machines.
        assert!(diagnostics["opencodeDefaultModel"]["status"].is_string());

        let _ = std::fs::remove_file(&script_path);
        let _ = std::fs::remove_dir_all(script_path.parent().unwrap_or(std::path::Path::new("")));
    }

    #[test]
    fn opencode_default_model_probe_warns_when_configured_model_is_unlisted() {
        let probe = opencode_default_model_probe_from_document(
            "loaded",
            Some("/tmp/opencode.json".to_string()),
            &json!({ "model": "openai/gpt-5.3-codex" }),
            None,
            Some(&["opencode/gpt-5-nano".to_string()]),
        );
        assert_eq!(probe["status"], "warning");
        assert_eq!(probe["model"], "openai/gpt-5.3-codex");
        assert!(probe["diagnostic"]
            .as_str()
            .unwrap_or_default()
            .contains("Model not found"));
    }

    #[test]
    fn opencode_default_model_probe_passes_when_model_is_listed() {
        let probe = opencode_default_model_probe_from_document(
            "loaded",
            Some("/tmp/opencode.json".to_string()),
            &json!({ "model": "openai/gpt-5.3-codex" }),
            None,
            Some(&[
                "opencode/gpt-5-nano".to_string(),
                "openai/gpt-5.3-codex".to_string(),
            ]),
        );
        assert_eq!(probe["status"], "pass");
        assert_eq!(probe["model"], "openai/gpt-5.3-codex");
    }

    #[test]
    fn opencode_default_model_probe_degrades_without_models_list_or_config() {
        let unknown = opencode_default_model_probe_from_document(
            "loaded",
            None,
            &json!({ "model": "a/b" }),
            None,
            None,
        );
        assert_eq!(unknown["status"], "unknown");

        let missing =
            opencode_default_model_probe_from_document("missing", None, &Value::Null, None, None);
        assert_eq!(missing["status"], "skipped");

        let no_model_key =
            opencode_default_model_probe_from_document("loaded", None, &json!({}), None, Some(&[]));
        assert_eq!(no_model_key["status"], "skipped");

        let malformed = opencode_default_model_probe_from_document(
            "malformed",
            Some("/tmp/opencode.json".to_string()),
            &Value::Null,
            Some("bad json".to_string()),
            Some(&[]),
        );
        assert_eq!(malformed["status"], "unknown");
        assert_eq!(malformed["diagnostic"], "bad json");
    }
}
