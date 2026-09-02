//! Cross-platform launch resolution for the Kimi CLI.
//!
//! The bundled Kimi executable and its process-only shell environment must be
//! resolved together. In particular, Windows Kimi requires a Git for Windows
//! runtime for shell-backed tools, while macOS uses its system shell.

use std::env;
use std::path::{Path, PathBuf};
use std::process::Output;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::process::Command;
use tokio::time::timeout;

use crate::backend::app_server::find_cli_binary;

const BUNDLED_ENGINE_RESOURCE_DIR: &str = "bundled-engines/current";
const WINDOWS_KIMI_SHELL_RUNTIME: &str = "kimi-windows-shell";
const TOOLCHAIN_PROBE_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum KimiBinarySource {
    Bundled,
    External,
}

#[derive(Debug, Clone)]
pub(crate) struct KimiLaunchContext {
    pub(crate) binary: PathBuf,
    pub(crate) source: KimiBinarySource,
    pub(crate) path_env: String,
    pub(crate) shell_path: Option<PathBuf>,
    pub(crate) kimi_code_home: Option<PathBuf>,
}

impl KimiLaunchContext {
    pub(crate) fn apply_environment(&self, command: &mut Command) {
        command.env("PATH", &self.path_env);
        if let Some(shell_path) = &self.shell_path {
            command.env("SHELL", shell_path);
        }
        if let Some(home) = &self.kimi_code_home {
            command.env("KIMI_CODE_HOME", home);
        }
        #[cfg(windows)]
        if self.shell_path.is_some() {
            command.env("MSYSTEM", "MINGW64");
            command.env("MSYS2_PATH_TYPE", "inherit");
        }
    }
}

pub(crate) fn resolve_kimi_launch_context(
    custom_bin: Option<&str>,
    kimi_code_home: Option<&Path>,
) -> Result<KimiLaunchContext, String> {
    let bundled_root = bundled_resource_root();
    let bundled_binary = bundled_root
        .as_ref()
        .and_then(|root| bundled_kimi_binary(root));
    let (binary, source) = match custom_bin
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_file())
    {
        Some(path) => {
            let source = if bundled_binary
                .as_ref()
                .map(|bundled| paths_equal(bundled, &path))
                .unwrap_or(false)
            {
                KimiBinarySource::Bundled
            } else {
                KimiBinarySource::External
            };
            (path, source)
        }
        None => match bundled_binary {
            Some(path) => (path, KimiBinarySource::Bundled),
            None => (
                find_cli_binary("kimi", None).ok_or_else(|| {
                    "[KIMI_BINARY_MISSING] Kimi CLI was not found in bundled resources or PATH"
                        .to_string()
                })?,
                KimiBinarySource::External,
            ),
        },
    };

    #[cfg(windows)]
    let (shell_path, extra_path) = resolve_windows_shell(&source, bundled_root.as_deref())?;
    #[cfg(not(windows))]
    let (shell_path, extra_path) = resolve_macos_shell()?;

    Ok(KimiLaunchContext {
        binary,
        source,
        path_env: build_process_path(extra_path),
        shell_path,
        kimi_code_home: kimi_code_home.map(Path::to_path_buf),
    })
}

pub(crate) fn bundled_resource_root() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(executable) = env::current_exe() {
        if let Some(executable_dir) = executable.parent() {
            candidates.push(executable_dir.join(BUNDLED_ENGINE_RESOURCE_DIR));
            candidates.push(
                executable_dir
                    .join("resources")
                    .join(BUNDLED_ENGINE_RESOURCE_DIR),
            );
            #[cfg(target_os = "macos")]
            if let Some(contents_dir) = executable_dir.parent() {
                candidates.push(
                    contents_dir
                        .join("Resources")
                        .join(BUNDLED_ENGINE_RESOURCE_DIR),
                );
            }
        }
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(BUNDLED_ENGINE_RESOURCE_DIR),
    );
    candidates.into_iter().find(|root| root.is_dir())
}

fn bundled_kimi_binary(root: &Path) -> Option<PathBuf> {
    let architecture = match env::consts::ARCH {
        "aarch64" => "aarch64",
        _ => "x86_64",
    };
    let file_name = if cfg!(windows) { "kimi.exe" } else { "kimi" };
    let candidate = root.join(architecture).join("kimi").join(file_name);
    candidate.is_file().then_some(candidate)
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    #[cfg(windows)]
    {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn build_process_path(extra_paths: Vec<PathBuf>) -> String {
    let mut paths = extra_paths;
    if let Ok(original) = env::var("PATH") {
        paths.extend(env::split_paths(&original));
    }
    env::join_paths(paths)
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

#[cfg(windows)]
fn resolve_windows_shell(
    source: &KimiBinarySource,
    bundled_root: Option<&Path>,
) -> Result<(Option<PathBuf>, Vec<PathBuf>), String> {
    if let Some(root) = bundled_root {
        let runtime_root = root
            .join("x86_64")
            .join("runtimes")
            .join(WINDOWS_KIMI_SHELL_RUNTIME);
        let bash = runtime_root.join("bin").join("bash.exe");
        let required_files = [
            runtime_root.join("bin").join("bash.exe"),
            runtime_root.join("bin").join("sh.exe"),
            runtime_root.join("cmd").join("git.exe"),
            runtime_root.join("usr").join("bin").join("msys-2.0.dll"),
            runtime_root.join("etc").join("bash.bashrc"),
        ];
        if let Some(error) = first_invalid_required_file(&required_files) {
            if *source == KimiBinarySource::Bundled {
                return Err(error);
            }
        } else {
            let extra = [
                runtime_root.join("bin"),
                runtime_root.join("cmd"),
                runtime_root.join("usr").join("bin"),
                runtime_root.join("mingw64").join("bin"),
            ]
            .into_iter()
            .filter(|path| path.is_dir())
            .collect();
            return Ok((Some(bash), extra));
        }
    }

    if *source == KimiBinarySource::Bundled {
        return Err(format!(
            "[KIMI_SHELL_MISSING] Bundled Kimi Windows shell runtime `{WINDOWS_KIMI_SHELL_RUNTIME}` is missing"
        ));
    }

    let mut candidates = Vec::new();
    for variable in ["ProgramFiles", "LOCALAPPDATA"] {
        if let Ok(value) = env::var(variable) {
            candidates.push(
                PathBuf::from(value)
                    .join("Git")
                    .join("bin")
                    .join("bash.exe"),
            );
        }
    }
    candidates.push(PathBuf::from(r"C:\Program Files\Git\bin\bash.exe"));
    candidates.push(PathBuf::from(r"C:\Program Files (x86)\Git\bin\bash.exe"));
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .map(|bash| (Some(bash.clone()), windows_git_path_entries(&bash)))
        .ok_or_else(|| {
            "[KIMI_SHELL_MISSING] Git Bash is required for the external Kimi CLI".to_string()
        })
}

#[cfg(windows)]
fn first_invalid_required_file(paths: &[PathBuf]) -> Option<String> {
    for path in paths {
        match std::fs::metadata(path) {
            Ok(metadata) if metadata.is_file() => continue,
            Ok(_) => {
                return Some(format!(
                    "[KIMI_SHELL_INVALID] Kimi shell runtime entry is not a file: {}",
                    path.display()
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::PermissionDenied => {
                return Some(format!(
                    "[KIMI_SHELL_PERMISSION_DENIED] Cannot read Kimi shell runtime entry {}: {error}",
                    path.display()
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Some(format!(
                    "[KIMI_SHELL_MISSING] Kimi shell runtime entry is missing: {}",
                    path.display()
                ));
            }
            Err(error) => {
                return Some(format!(
                    "[KIMI_SHELL_INVALID] Cannot inspect Kimi shell runtime entry {}: {error}",
                    path.display()
                ));
            }
        }
    }
    None
}

#[cfg(windows)]
fn windows_git_path_entries(bash: &Path) -> Vec<PathBuf> {
    let Some(bin_dir) = bash.parent() else {
        return Vec::new();
    };
    let Some(git_root) = bin_dir.parent() else {
        return vec![bin_dir.to_path_buf()];
    };
    [
        bin_dir.to_path_buf(),
        git_root.join("cmd"),
        git_root.join("usr").join("bin"),
        git_root.join("mingw64").join("bin"),
    ]
    .into_iter()
    .filter(|path| path.is_dir())
    .collect()
}

#[cfg(not(windows))]
fn resolve_macos_shell() -> Result<(Option<PathBuf>, Vec<PathBuf>), String> {
    let shell = ["/bin/bash", "/bin/sh"]
        .into_iter()
        .map(PathBuf::from)
        .find(|path| is_executable_file(path))
        .ok_or_else(|| {
            "[KIMI_SHELL_UNSUPPORTED_PLATFORM] A supported system shell was not found for Kimi"
                .to_string()
        })?;
    Ok((Some(shell), Vec::new()))
}

async fn run_probe(
    context: &KimiLaunchContext,
    program: &Path,
    args: &[&str],
) -> Result<Output, String> {
    let program_text = program.to_string_lossy();
    let mut command = crate::backend::app_server::build_command_for_binary(&program_text);
    context.apply_environment(&mut command);
    command
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    timeout(TOOLCHAIN_PROBE_TIMEOUT, command.output())
        .await
        .map_err(|_| {
            format!(
                "[KIMI_PROBE_TIMEOUT] probe timed out: {}",
                program.display()
            )
        })?
        .map_err(|error| {
            format!(
                "[KIMI_PROBE_FAILED] failed to run {}: {error}",
                program.display()
            )
        })
}

pub(crate) async fn probe_kimi_version(context: &KimiLaunchContext) -> Result<String, String> {
    let output = run_probe(context, &context.binary, &["--version"]).await?;
    if !output.status.success() {
        return Err(format!(
            "[KIMI_PROBE_FAILED] Kimi --version failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        return Err("[KIMI_PROBE_FAILED] Kimi --version returned no output".to_string());
    }
    Ok(version)
}

pub(crate) async fn probe_kimi_shell_runtime(context: &KimiLaunchContext) -> Value {
    let Some(shell) = context.shell_path.as_deref() else {
        return json!({
            "ok": false,
            "category": "missing",
            "message": "Kimi shell executable is not configured",
        });
    };

    let shell_probe = run_probe(context, shell, &["--version"]).await;
    let git_probe = run_probe(context, Path::new("git"), &["--version"]).await;
    let cwd_probe = env::current_dir()
        .map(|path| path.is_dir())
        .unwrap_or(false);
    let shell_ok = shell_probe
        .as_ref()
        .map(|output| output.status.success())
        .unwrap_or(false);
    let git_ok = git_probe
        .as_ref()
        .map(|output| output.status.success())
        .unwrap_or(false);
    let ok = shell_ok && git_ok && cwd_probe;
    let category = if ok {
        "resolved"
    } else if !cwd_probe {
        "probe-failed"
    } else if let Some(category) = shell_probe
        .as_ref()
        .err()
        .and_then(|error| kimi_probe_error_category(error))
    {
        category
    } else if let Some(category) = git_probe
        .as_ref()
        .err()
        .and_then(|error| kimi_probe_error_category(error))
    {
        category
    } else if !shell.is_file() {
        "missing"
    } else {
        "invalid"
    };

    json!({
        "ok": ok,
        "category": category,
        "source": if context.source == KimiBinarySource::Bundled { "bundled" } else { "external" },
        "shellPath": shell,
        "shellVersion": shell_probe.as_ref().ok().and_then(|output| {
            output.status.success().then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
        }),
        "gitVersion": git_probe.as_ref().ok().and_then(|output| {
            output.status.success().then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
        }),
        "cwdProbeOk": cwd_probe,
        "details": if ok { Value::Null } else {
            json!({
                "shell": probe_error_details(shell_probe),
                "git": probe_error_details(git_probe),
            })
        },
    })
}

fn kimi_probe_error_category(error: &str) -> Option<&'static str> {
    if error.contains("Permission denied") || error.contains("permission denied") {
        Some("permission-denied")
    } else if error.contains("KIMI_PROBE_TIMEOUT") {
        Some("probe-failed")
    } else if error.contains("KIMI_PROBE_FAILED") {
        Some("probe-failed")
    } else {
        None
    }
}

fn probe_error_details(probe: Result<Output, String>) -> Value {
    match probe {
        Ok(output) => json!({
            "ok": output.status.success(),
            "exitCode": output.status.code(),
            "stderr": String::from_utf8_lossy(&output.stderr).trim(),
        }),
        Err(error) => json!({ "ok": false, "error": error }),
    }
}

#[cfg(not(windows))]
fn is_executable_file(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;

    path.is_file()
        && std::fs::metadata(path)
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_path_keeps_original_entries_after_managed_entries() {
        let path = build_process_path(vec![PathBuf::from("managed-shell")]);
        assert!(path.starts_with("managed-shell"));
        assert!(path.contains("managed-shell"));
    }

    #[test]
    fn bundled_resource_root_is_a_directory_when_present() {
        if let Some(root) = bundled_resource_root() {
            assert!(root.is_dir());
        }
    }

    #[test]
    fn launch_context_keeps_kimi_home_explicit() {
        let home = PathBuf::from("workspace-kimi-home");
        let context = KimiLaunchContext {
            binary: PathBuf::from("kimi"),
            source: KimiBinarySource::External,
            path_env: String::from("path"),
            shell_path: None,
            kimi_code_home: Some(home.clone()),
        };
        assert_eq!(context.kimi_code_home.as_deref(), Some(home.as_path()));
    }
}
