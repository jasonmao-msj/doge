//! Resolve provider-scoped environment references for GUI-launched Codex.
//!
//! Finder/Dock launches do not reliably inherit an interactive shell. Codex
//! providers may name credentials via `model_providers.*.env_key`; resolve only
//! those validated names, once per launch, without exposing values to logs or
//! renderer state. Semantic port of upstream `6c9c9cfc1` + `b4dcd1538`.

use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::AsyncReadExt;
use tokio::process::Command;

const FRAME_START_PREFIX: &str = "__DOGE_CODEX_ENV_START__";
const FRAME_END_PREFIX: &str = "__DOGE_CODEX_ENV_END__";
const RESOLUTION_TIMEOUT: Duration = Duration::from_secs(5);

const SHELL_SCRIPT: &str = r#"
for key in "$@"; do
  printf '%s%s\n' "__DOGE_CODEX_ENV_START__" "$key"
  value=$(/usr/bin/printenv -- "$key" 2>/dev/null || true)
  printf '%s\n' "$value"
  printf '%s%s\n' "__DOGE_CODEX_ENV_END__" "$key"
done
"#;

pub(crate) async fn apply_codex_provider_env(
    command: &mut Command,
    codex_home: Option<&Path>,
    launch_env: &BTreeMap<String, String>,
) -> Result<(), String> {
    let Some(config_path) = config_path(codex_home) else {
        return Ok(());
    };
    let contents = match tokio::fs::read_to_string(&config_path).await {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "failed to read Codex provider config {}: {error}",
                config_path.display()
            ))
        }
    };
    let env_keys = collect_env_keys(&contents)?;
    let missing = collect_missing_env_keys(env_keys, launch_env, env_has_non_empty_value);
    if missing.is_empty() {
        return Ok(());
    }

    let resolved = resolve_from_login_shell(&missing).await?;
    let unresolved = missing
        .iter()
        .filter(|key| !resolved.contains_key(*key))
        .cloned()
        .collect::<Vec<_>>();
    if !unresolved.is_empty() {
        return Err(format!(
            "Codex provider environment variable(s) unavailable: {}",
            unresolved.join(", ")
        ));
    }
    command.envs(resolved);
    Ok(())
}

fn env_has_non_empty_value(key: &str) -> bool {
    env::var_os(key).is_some_and(|value| !value.is_empty())
}

fn collect_missing_env_keys(
    env_keys: BTreeSet<String>,
    launch_env: &BTreeMap<String, String>,
    has_process_value: impl Fn(&str) -> bool,
) -> Vec<String> {
    env_keys
        .into_iter()
        .filter(|key| {
            !launch_env
                .get(key)
                .is_some_and(|value| !value.trim().is_empty())
                && !has_process_value(key)
        })
        .collect()
}

fn config_path(codex_home: Option<&Path>) -> Option<PathBuf> {
    codex_home
        .map(Path::to_path_buf)
        .or_else(crate::codex::home::resolve_default_codex_home)
        .map(|home| home.join("config.toml"))
}

fn collect_env_keys(contents: &str) -> Result<BTreeSet<String>, String> {
    let value = toml::from_str::<toml::Value>(contents)
        .map_err(|error| format!("failed to parse Codex provider config: {error}"))?;
    Ok(value
        .get("model_providers")
        .and_then(toml::Value::as_table)
        .into_iter()
        .flat_map(|providers| providers.values())
        .filter_map(|provider| provider.get("env_key"))
        .filter_map(toml::Value::as_str)
        .map(str::trim)
        .filter(|key| is_valid_env_name(key))
        .map(ToOwned::to_owned)
        .collect())
}

fn is_valid_env_name(value: &str) -> bool {
    !value.is_empty()
        && value.chars().enumerate().all(|(index, ch)| {
            (index == 0 && (ch == '_' || ch.is_ascii_alphabetic()))
                || (index > 0 && (ch == '_' || ch.is_ascii_alphanumeric()))
        })
}

async fn resolve_from_login_shell(keys: &[String]) -> Result<BTreeMap<String, String>, String> {
    let shell = allowed_shell().ok_or_else(|| {
        format!(
            "Codex provider environment requires a supported login shell for: {}",
            keys.join(", ")
        )
    })?;
    let mut command = Command::new(&shell);
    command
        .arg("-l")
        .arg("-i")
        .arg("-c")
        .arg(SHELL_SCRIPT)
        .arg("doge")
        .args(keys)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    configure_process_group(&mut command);
    let mut child = command.spawn().map_err(|error| {
        format!(
            "failed to start Codex provider environment resolver {}: {error}",
            shell.display()
        )
    })?;
    let process_id = child.id();
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Codex provider environment resolver stdout unavailable".to_string())?;
    let mut output = Vec::new();
    let read_task = tokio::spawn(async move {
        stdout
            .read_to_end(&mut output)
            .await
            .map(|_| output)
            .map_err(|error| error.to_string())
    });

    let status = match tokio::time::timeout(RESOLUTION_TIMEOUT, child.wait()).await {
        Ok(result) => result
            .map_err(|error| format!("Codex provider environment resolver failed: {error}"))?,
        Err(_) => {
            terminate_process_group(process_id);
            let _ = child.kill().await;
            let _ = child.wait().await;
            read_task.abort();
            return Err(format!(
                "Codex provider environment resolution timed out after {}s",
                RESOLUTION_TIMEOUT.as_secs()
            ));
        }
    };
    if !status.success() {
        read_task.abort();
        return Err(format!(
            "Codex provider environment resolver exited with status {status}"
        ));
    }
    let stdout = read_task
        .await
        .map_err(|error| format!("Codex provider environment resolver join failed: {error}"))??;
    Ok(parse_framed_values(&stdout, keys))
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    unsafe {
        command.pre_exec(|| {
            if libc::setpgid(0, 0) == 0 {
                Ok(())
            } else {
                Err(std::io::Error::last_os_error())
            }
        });
    }
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_process_group(process_id: Option<u32>) {
    if let Some(process_id) = process_id {
        unsafe {
            libc::kill(-(process_id as i32), libc::SIGKILL);
        }
    }
}

#[cfg(not(unix))]
fn terminate_process_group(_process_id: Option<u32>) {}

fn allowed_shell() -> Option<PathBuf> {
    #[cfg(not(unix))]
    {
        None
    }
    #[cfg(unix)]
    {
        if let Some(shell) = env::var_os("SHELL") {
            if let Some(shell) = allowlisted_shell(Path::new(&shell)) {
                return Some(shell.to_path_buf());
            }
        }
        let default = if cfg!(target_os = "macos") {
            Path::new("/bin/zsh")
        } else {
            Path::new("/bin/bash")
        };
        default.exists().then(|| default.to_path_buf())
    }
}

fn allowlisted_shell(path: &Path) -> Option<&Path> {
    let name = path.file_name()?.to_str()?;
    ((name == "zsh" || name == "bash") && path.is_absolute()).then_some(path)
}

fn parse_framed_values(stdout: &[u8], keys: &[String]) -> BTreeMap<String, String> {
    let text = String::from_utf8_lossy(stdout);
    let mut values = BTreeMap::new();
    for key in keys {
        let start_marker = format!("{FRAME_START_PREFIX}{key}\n");
        let end_marker = format!("{FRAME_END_PREFIX}{key}\n");
        let Some(start) = text.find(&start_marker) else {
            continue;
        };
        let value_start = start + start_marker.len();
        let Some(end) = text[value_start..].find(&end_marker) else {
            continue;
        };
        let value = text[value_start..value_start + end].trim();
        if !value.is_empty() {
            values.insert(key.clone(), value.to_string());
        }
    }
    values
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collects_only_valid_provider_env_keys() {
        let keys = collect_env_keys(
            r#"
[model_providers.a]
env_key = "OPENAI_API_KEY"
[model_providers.b]
env_key = "TEAM_OPENAI_KEY"
[model_providers.c]
env_key = "bad-name"
"#,
        )
        .expect("valid config");
        assert_eq!(
            keys.into_iter().collect::<Vec<_>>(),
            ["OPENAI_API_KEY", "TEAM_OPENAI_KEY"]
        );
    }

    #[test]
    fn parses_multiple_framed_values_amid_shell_noise() {
        let keys = vec!["OPENAI_API_KEY".to_string(), "TEAM_OPENAI_KEY".to_string()];
        let stdout = format!(
            "noise\n{FRAME_START_PREFIX}OPENAI_API_KEY\nsecret-one\n\
             {FRAME_END_PREFIX}OPENAI_API_KEY\n{FRAME_START_PREFIX}TEAM_OPENAI_KEY\n\
             secret-two\n{FRAME_END_PREFIX}TEAM_OPENAI_KEY\n"
        );
        let values = parse_framed_values(stdout.as_bytes(), &keys);
        assert_eq!(
            values.get("OPENAI_API_KEY").map(String::as_str),
            Some("secret-one")
        );
        assert_eq!(
            values.get("TEAM_OPENAI_KEY").map(String::as_str),
            Some("secret-two")
        );
    }

    #[test]
    fn rejects_injection_like_names_and_non_allowlisted_shells() {
        assert!(!is_valid_env_name("OPENAI_API_KEY; touch /tmp/pwned"));
        assert!(!is_valid_env_name("1INVALID"));
        assert!(is_valid_env_name("CUSTOM_RELAY_TOKEN"));
        assert_eq!(allowlisted_shell(Path::new("/bin/fish")), None);
        assert_eq!(allowlisted_shell(Path::new("zsh")), None);
    }

    #[test]
    fn authoritative_launch_and_process_env_precede_shell_resolution() {
        let env_keys = BTreeSet::from([
            "DOGE_MANAGED_KEY".to_string(),
            "PROCESS_KEY".to_string(),
            "MISSING_KEY".to_string(),
        ]);
        let launch_env = BTreeMap::from([(
            "DOGE_MANAGED_KEY".to_string(),
            "native-authority-value".to_string(),
        )]);
        let missing = collect_missing_env_keys(env_keys, &launch_env, |key| key == "PROCESS_KEY");

        assert_eq!(missing, vec!["MISSING_KEY"]);
    }
}
