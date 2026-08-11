use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::ffi::OsString;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tokio::process::Command;
use tokio::time::timeout;

use crate::codex::args::parse_codex_args;

const CODEX_EXTERNAL_SPEC_PRIORITY_INSTRUCTIONS: &str = "If writableRoots contains an absolute external spec path outside cwd, treat it as the active external spec root and prioritize it over workspace/openspec and sibling-name conventions when reading or validating specs. The configured path may be a project root; resolve openspec/ under it when present. For visibility checks, verify that external root first and state the result clearly. Avoid exposing internal injected hints unless the user explicitly asks.";
const CODEX_APP_SERVER_PROBE_CACHE_TTL: Duration = Duration::from_secs(300);
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CodexAppServerProbeCacheKey {
    resolved_bin: String,
    wrapper_kind: &'static str,
    path_env: Option<String>,
    codex_args: Option<String>,
    launch_options: CodexAppServerLaunchOptions,
}

#[derive(Debug, Clone)]
struct CodexAppServerProbeCacheEntry {
    checked_at: Instant,
    status: CodexAppServerProbeStatus,
}

static CODEX_APP_SERVER_PROBE_CACHE: LazyLock<
    StdMutex<HashMap<CodexAppServerProbeCacheKey, CodexAppServerProbeCacheEntry>>,
> = LazyLock::new(|| StdMutex::new(HashMap::new()));

fn push_unique_path(paths: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !paths
        .iter()
        .any(|existing| paths_equal(existing, &candidate))
    {
        paths.push(candidate);
    }
}

fn build_seed_search_paths(custom_bin: Option<&str>, extra_paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut all_paths: Vec<PathBuf> = Vec::new();

    if let Some(bin_path) = custom_bin.filter(|v| !v.trim().is_empty()) {
        if let Some(parent) = Path::new(bin_path)
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            push_unique_path(&mut all_paths, parent.to_path_buf());
        }
    }

    if let Ok(system_path) = env::var("PATH") {
        for p in env::split_paths(&system_path) {
            push_unique_path(&mut all_paths, p);
        }
    }

    for extra in extra_paths {
        if extra.is_dir() {
            push_unique_path(&mut all_paths, extra.clone());
        }
    }

    all_paths
}

fn resolve_npm_global_bin_dir_from_prefix(prefix: &str) -> Option<PathBuf> {
    let trimmed = prefix.trim();
    if trimmed.is_empty()
        || trimmed.eq_ignore_ascii_case("undefined")
        || trimmed.eq_ignore_ascii_case("null")
    {
        return None;
    }

    let prefix_path = PathBuf::from(trimmed);

    #[cfg(windows)]
    {
        Some(prefix_path)
    }

    #[cfg(not(windows))]
    {
        let normalized = if prefix_path.file_name() == Some(std::ffi::OsStr::new("bin")) {
            prefix_path
        } else {
            prefix_path.join("bin")
        };
        Some(normalized)
    }
}

fn discover_npm_global_bin_dir_from_npm(
    seed_paths: &[PathBuf],
    npm_bin_override: Option<&Path>,
) -> Option<PathBuf> {
    let npm_bin = npm_bin_override.map(PathBuf::from).or_else(|| {
        let joined_paths = env::join_paths(seed_paths.iter()).ok()?;
        let cwd = env::current_dir().ok()?;
        which::which_in("npm", Some(&joined_paths), &cwd)
            .ok()
            .or_else(|| which::which("npm").ok())
    })?;
    let probe_paths = build_npm_probe_paths(seed_paths, &npm_bin);
    let joined_paths = env::join_paths(probe_paths.iter()).ok()?;

    let mut command = build_std_command_for_binary(&npm_bin);
    command.env("PATH", &joined_paths);
    command.arg("config");
    command.arg("get");
    command.arg("prefix");
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::null());

    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    resolve_npm_global_bin_dir_from_prefix(stdout.as_ref())
}

fn build_npm_probe_paths(seed_paths: &[PathBuf], npm_bin: &Path) -> Vec<PathBuf> {
    let mut probe_paths = npm_launcher_search_paths(npm_bin);
    for seed_path in seed_paths {
        push_unique_path(&mut probe_paths, seed_path.clone());
    }
    probe_paths
}

const MAX_NPM_SYMLINK_HOPS: usize = 8;

fn npm_launcher_file_names(windows: bool) -> &'static [&'static str] {
    if windows {
        &["npm.cmd", "npm.exe", "npm.bat", "npm.ps1", "npm"]
    } else {
        &["npm"]
    }
}

fn npm_launcher_search_paths(npm_bin: &Path) -> Vec<PathBuf> {
    let mut search_paths = Vec::new();
    let mut current_launcher = npm_bin.to_path_buf();

    for _ in 0..=MAX_NPM_SYMLINK_HOPS {
        let Some(parent) = current_launcher.parent() else {
            break;
        };
        push_unique_path(&mut search_paths, parent.to_path_buf());

        let Ok(metadata) = std::fs::symlink_metadata(&current_launcher) else {
            break;
        };
        if !metadata.file_type().is_symlink() {
            break;
        }
        let Ok(target) = std::fs::read_link(&current_launcher) else {
            break;
        };
        current_launcher = if target.is_absolute() {
            target
        } else {
            parent.join(target)
        };
    }

    search_paths
}

fn discover_npm_launcher_search_paths(seed_paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut discovered_paths = Vec::new();
    for seed_path in seed_paths {
        for file_name in npm_launcher_file_names(cfg!(windows)) {
            let launcher = seed_path.join(file_name);
            if std::fs::symlink_metadata(&launcher).is_err() {
                continue;
            }
            for search_path in npm_launcher_search_paths(&launcher) {
                if search_path.is_dir() {
                    push_unique_path(&mut discovered_paths, search_path);
                }
            }
        }
    }
    discovered_paths
}

fn build_std_command_for_binary(bin: &Path) -> std::process::Command {
    #[cfg(windows)]
    {
        let bin_lower = bin.to_string_lossy().to_ascii_lowercase();
        if bin_lower.ends_with(".cmd") || bin_lower.ends_with(".bat") {
            let mut command = crate::utils::std_command("cmd");
            command.arg("/c");
            command.arg(bin);
            return command;
        }
        if bin_lower.ends_with(".ps1") {
            let mut command = crate::utils::std_command("powershell");
            command.arg("-NoProfile");
            command.arg("-ExecutionPolicy");
            command.arg("Bypass");
            command.arg("-File");
            command.arg(bin);
            return command;
        }
    }

    crate::utils::std_command(bin)
}

fn discover_npm_global_bin_dir(seed_paths: &[PathBuf]) -> Option<PathBuf> {
    discover_npm_global_bin_dir_from_npm(seed_paths, None)
}

#[cfg(any(windows, test))]
fn build_windows_extra_search_paths(
    appdata: Option<&Path>,
    user_profile: Option<&Path>,
    local_app_data: Option<&Path>,
    program_files: Option<&Path>,
    program_files_x86: Option<&Path>,
) -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();

    if let Some(appdata) = appdata {
        paths.push(appdata.join("npm"));
    }
    if let Some(user_profile) = user_profile {
        // Fallback: npm global install path via USERPROFILE
        paths.push(user_profile.join("AppData\\Roaming\\npm"));
        // Common user-local launcher path used by CLI installers on Windows.
        paths.push(user_profile.join(".local\\bin"));
        // Cargo bin
        paths.push(user_profile.join(".cargo\\bin"));
        // Bun
        paths.push(user_profile.join(".bun\\bin"));
        // fnm (Fast Node Manager)
        let fnm_root = user_profile.join("AppData\\Local\\fnm\\node-versions");
        if let Ok(entries) = std::fs::read_dir(&fnm_root) {
            for entry in entries.flatten() {
                let bin_path = entry.path().join("installation");
                if bin_path.is_dir() {
                    paths.push(bin_path);
                }
            }
        }
        // nvm-windows
        let nvm_root = user_profile.join("AppData\\Roaming\\nvm");
        if let Ok(entries) = std::fs::read_dir(&nvm_root) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir()
                    && path
                        .file_name()
                        .map_or(false, |n| n.to_string_lossy().starts_with('v'))
                {
                    paths.push(path);
                }
            }
        }
    }
    if let Some(local_app_data) = local_app_data {
        // Volta
        paths.push(local_app_data.join("Volta\\bin"));
        // pnpm
        paths.push(local_app_data.join("pnpm"));
        // User-scoped Node.js installs (common on Windows when not installed to Program Files)
        let programs_root = local_app_data.join("Programs");
        if programs_root.is_dir() {
            paths.push(programs_root.join("nodejs"));
            if let Ok(entries) = std::fs::read_dir(&programs_root) {
                for entry in entries.flatten() {
                    let candidate = entry.path();
                    if !candidate.is_dir() {
                        continue;
                    }
                    let folder_name = entry.file_name().to_string_lossy().to_ascii_lowercase();
                    if folder_name == "nodejs"
                        || folder_name.starts_with("node-v")
                        || folder_name.starts_with("nodejs-v")
                    {
                        paths.push(candidate);
                    }
                }
            }
        }
    }
    if let Some(program_files) = program_files {
        paths.push(program_files.join("nodejs"));
    }
    if let Some(program_files_x86) = program_files_x86 {
        paths.push(program_files_x86.join("nodejs"));
    }

    paths
}

/// Build extra search paths for CLI tools (cross-platform)
fn get_extra_search_paths() -> Vec<PathBuf> {
    let mut paths: Vec<PathBuf> = Vec::new();

    #[cfg(windows)]
    {
        // Windows-specific paths
        let appdata = env::var("APPDATA").ok();
        let user_profile = env::var("USERPROFILE").ok();
        let local_app_data = env::var("LOCALAPPDATA").ok();
        let program_files = env::var("ProgramFiles").ok();
        let program_files_x86 = env::var("ProgramFiles(x86)").ok();
        paths.extend(build_windows_extra_search_paths(
            appdata.as_deref().map(Path::new),
            user_profile.as_deref().map(Path::new),
            local_app_data.as_deref().map(Path::new),
            program_files.as_deref().map(Path::new),
            program_files_x86.as_deref().map(Path::new),
        ));
    }

    #[cfg(not(windows))]
    {
        // Unix-specific paths (macOS/Linux)
        paths.extend(vec![
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
            PathBuf::from("/usr/sbin"),
            PathBuf::from("/sbin"),
        ]);
        if let Ok(home) = env::var("HOME") {
            let home = Path::new(&home);
            paths.push(home.join(".local/bin"));
            paths.push(home.join(".local/share/mise/shims"));
            paths.push(home.join(".cargo/bin"));
            paths.push(home.join(".bun/bin"));
            paths.push(home.join(".volta/bin"));
            // nvm
            let nvm_root = home.join(".nvm/versions/node");
            if let Ok(entries) = std::fs::read_dir(nvm_root) {
                for entry in entries.flatten() {
                    let bin_path = entry.path().join("bin");
                    if bin_path.is_dir() {
                        paths.push(bin_path);
                    }
                }
            }
        }
    }

    let seed_paths = build_seed_search_paths(None, &paths);
    for npm_search_path in discover_npm_launcher_search_paths(&seed_paths) {
        push_unique_path(&mut paths, npm_search_path);
    }
    for prefix_key in ["NPM_CONFIG_PREFIX", "npm_config_prefix"] {
        if let Some(env_prefix) = env::var_os(prefix_key)
            .and_then(|value| value.into_string().ok())
            .and_then(|value| resolve_npm_global_bin_dir_from_prefix(&value))
        {
            push_unique_path(&mut paths, env_prefix);
        }
    }

    let seed_paths = build_seed_search_paths(None, &paths);
    if let Some(npm_global_bin) = discover_npm_global_bin_dir(&seed_paths) {
        push_unique_path(&mut paths, npm_global_bin);
    }

    paths
}

/// Build combined search paths (system PATH + extra paths)
fn build_search_paths(custom_bin: Option<&str>) -> OsString {
    let all_paths = build_seed_search_paths(custom_bin, &get_extra_search_paths());
    env::join_paths(all_paths).unwrap_or_else(|_| OsString::from(""))
}

/// Compare paths (case-insensitive on Windows)
fn paths_equal(a: &Path, b: &Path) -> bool {
    #[cfg(windows)]
    {
        a.to_string_lossy()
            .eq_ignore_ascii_case(&b.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}

/// Find a CLI binary using the `which` crate with extended search paths
/// On Windows, also directly checks for .cmd files in common locations
pub fn find_cli_binary(name: &str, custom_bin: Option<&str>) -> Option<PathBuf> {
    // If custom binary is specified, check if it exists
    if let Some(bin) = custom_bin.filter(|v| !v.trim().is_empty()) {
        let bin_path = Path::new(bin);
        if bin_path.exists() {
            #[cfg(windows)]
            {
                return Some(prefer_windows_executable_variant(bin_path.to_path_buf()));
            }
            #[cfg(not(windows))]
            {
                return Some(bin_path.to_path_buf());
            }
        }
    }

    // On Windows, directly check for .cmd files in known locations first
    // This is more reliable than relying on PATH/PATHEXT
    #[cfg(windows)]
    {
        let extensions = ["cmd", "exe", "bat", "com", "ps1"];
        for search_path in get_extra_search_paths() {
            // Try with various extensions
            for ext in &extensions {
                let cmd_path = search_path.join(format!("{}.{}", name, ext));
                if cmd_path.exists() {
                    return Some(cmd_path);
                }
            }
        }
    }

    // Build extended search paths for which crate
    let search_paths = build_search_paths(custom_bin);

    // Use which crate to find the binary
    if let Some(cwd) = std::env::current_dir().ok() {
        if let Ok(found) = which::which_in(name, Some(&search_paths), &cwd) {
            #[cfg(windows)]
            {
                return Some(prefer_windows_executable_variant(found));
            }
            return Some(found);
        }
    }

    // Fallback: try standard which (uses system PATH only)
    #[cfg(windows)]
    {
        return which::which(name)
            .ok()
            .map(prefer_windows_executable_variant);
    }
    #[cfg(not(windows))]
    {
        which::which(name).ok()
    }
}

fn claude_native_bin_path() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local/bin/claude"))
}

fn push_unique_claude_candidate(candidates: &mut Vec<PathBuf>, path: PathBuf) {
    if !path.exists() {
        return;
    }
    if candidates
        .iter()
        .any(|existing| paths_equal(existing, &path))
    {
        return;
    }
    candidates.push(path);
}

/// Resolve `claude` the same way an interactive terminal does (login + interactive shell PATH / nvm).
fn resolve_claude_via_login_shell() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        return None;
    }

    #[cfg(not(windows))]
    {
        let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut command = crate::utils::std_command(&shell);
        // `-lic`: login + interactive so tools like nvm from `.zshrc` are available,
        // matching what users see from `claude -v` in Terminal.
        command.arg("-lic");
        command.arg("command -v claude");
        command.stdin(std::process::Stdio::null());
        command.stdout(std::process::Stdio::piped());
        command.stderr(std::process::Stdio::null());
        let output = command.output().ok()?;
        if !output.status.success() {
            return None;
        }
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if path.is_empty() {
            return None;
        }
        let path = PathBuf::from(path);
        path.exists().then_some(path)
    }
}

fn collect_claude_code_candidates(custom_bin: Option<&str>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(bin) = custom_bin.filter(|value| !value.trim().is_empty()) {
        push_unique_claude_candidate(&mut candidates, PathBuf::from(bin.trim()));
    }

    if let Some(native_bin) = claude_native_bin_path() {
        push_unique_claude_candidate(&mut candidates, native_bin);
    }

    if let Some(from_shell) = resolve_claude_via_login_shell() {
        push_unique_claude_candidate(&mut candidates, from_shell);
    }

    if let Ok(home) = env::var("HOME") {
        let nvm_root = Path::new(&home).join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(nvm_root) {
            for entry in entries.flatten() {
                push_unique_claude_candidate(&mut candidates, entry.path().join("bin/claude"));
            }
        }
    }

    for dir in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        push_unique_claude_candidate(&mut candidates, PathBuf::from(dir).join("claude"));
    }

    if let Some(found) = find_cli_binary("claude", None) {
        push_unique_claude_candidate(&mut candidates, found);
    }

    candidates
}

fn probe_claude_version_text(path: &Path) -> Option<String> {
    for arg in ["--version", "-v"] {
        let mut command = build_std_command_for_binary(path);
        command.arg(arg);
        command.stdout(std::process::Stdio::piped());
        command.stderr(std::process::Stdio::piped());
        let Ok(output) = command.output() else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stdout.is_empty() {
            return Some(stdout);
        }
    }
    None
}

fn parse_claude_semver(raw: &str) -> Option<(u64, u64, u64)> {
    let bytes = raw.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index].is_ascii_digit() {
            let start = index;
            while index < bytes.len() && bytes[index].is_ascii_digit() {
                index += 1;
            }
            if index < bytes.len() && bytes[index] == b'.' {
                let major: u64 = raw[start..index].parse().ok()?;
                index += 1;
                let minor_start = index;
                while index < bytes.len() && bytes[index].is_ascii_digit() {
                    index += 1;
                }
                if index < bytes.len() && bytes[index] == b'.' {
                    let minor: u64 = raw[minor_start..index].parse().ok()?;
                    index += 1;
                    let patch_start = index;
                    while index < bytes.len() && bytes[index].is_ascii_digit() {
                        index += 1;
                    }
                    if patch_start < index {
                        let patch: u64 = raw[patch_start..index].parse().ok()?;
                        return Some((major, minor, patch));
                    }
                }
            }
        } else {
            index += 1;
        }
    }
    None
}

/// Resolve Claude Code CLI binary.
/// Prefer explicit config, then official native path, then the same binary an interactive
/// terminal would resolve (login shell / nvm), falling back to the highest-version candidate.
pub fn find_claude_code_binary(custom_bin: Option<&str>) -> Option<PathBuf> {
    let candidates = collect_claude_code_candidates(custom_bin);
    if candidates.is_empty() {
        return None;
    }

    // Prefer configured / native / login-shell order when they report a Claude Code version.
    for candidate in &candidates {
        if let Some(version) = probe_claude_version_text(candidate) {
            let lower = version.to_ascii_lowercase();
            if lower.contains("claude") || parse_claude_semver(&version).is_some() {
                return Some(candidate.clone());
            }
        }
    }

    // Otherwise pick the highest parsed semver among candidates.
    let mut best: Option<(PathBuf, (u64, u64, u64))> = None;
    for candidate in candidates {
        let Some(version) = probe_claude_version_text(&candidate) else {
            continue;
        };
        let Some(semver) = parse_claude_semver(&version) else {
            continue;
        };
        match &best {
            None => best = Some((candidate, semver)),
            Some((_, best_semver)) if semver > *best_semver => best = Some((candidate, semver)),
            _ => {}
        }
    }
    best.map(|(path, _)| path)
}

fn matching_custom_bin<'a>(custom_bin: Option<&'a str>, cli_name: &str) -> Option<&'a str> {
    let candidate = custom_bin?.trim();
    if candidate.is_empty() {
        return None;
    }

    let path = Path::new(candidate);
    let file_stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(candidate);

    if file_stem.eq_ignore_ascii_case(cli_name) {
        Some(candidate)
    } else {
        None
    }
}

#[cfg(any(windows, test))]
fn normalized_windows_path_text(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase()
}

#[cfg(any(windows, test))]
fn is_known_windows_cli_install_path(path: &Path) -> bool {
    let normalized = normalized_windows_path_text(path);
    [
        "/appdata/roaming/npm/",
        "/.local/bin/",
        "/.cargo/bin/",
        "/.bun/bin/",
        "/appdata/local/volta/bin/",
        "/appdata/local/pnpm/",
        "/appdata/local/fnm/node-versions/",
        "/appdata/roaming/nvm/",
        "/program files/nodejs/",
        "/program files (x86)/nodejs/",
        "/appdata/local/programs/nodejs/",
    ]
    .iter()
    .any(|segment| normalized.contains(segment))
}

#[cfg(any(windows, test))]
fn is_windows_background_safe_opencode_candidate(path: &Path) -> bool {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    match extension.as_deref() {
        Some("cmd") | Some("bat") | Some("com") | Some("ps1") => true,
        Some("exe") => is_known_windows_cli_install_path(path),
        _ => false,
    }
}

pub fn resolve_safe_opencode_binary(custom_bin: Option<&str>) -> Result<PathBuf, String> {
    let custom = matching_custom_bin(custom_bin, "opencode");
    let candidate =
        find_cli_binary("opencode", custom).ok_or_else(|| "OpenCode CLI not found".to_string())?;

    #[cfg(windows)]
    {
        if !is_windows_background_safe_opencode_candidate(&candidate) {
            return Err(format!(
                "[OPENCODE_CLI_UNSAFE] Resolved OpenCode binary is not safe for background CLI probing on Windows: {}",
                candidate.display()
            ));
        }
    }

    Ok(candidate)
}

#[cfg(any(windows, test))]
fn prefer_windows_executable_variant(path: PathBuf) -> PathBuf {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    if matches!(
        ext.as_deref(),
        Some("cmd") | Some("exe") | Some("bat") | Some("com") | Some("ps1")
    ) {
        return path;
    }

    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return path;
    };
    let Some(parent) = path.parent() else {
        return path;
    };

    for preferred_ext in ["cmd", "exe", "bat", "com", "ps1"] {
        let candidate = parent.join(format!("{file_name}.{preferred_ext}"));
        if candidate.exists() {
            return candidate;
        }
    }

    path
}

pub(crate) fn build_codex_path_env(codex_bin: Option<&str>) -> Option<String> {
    build_cli_path_env(codex_bin)
}

pub(crate) fn build_cli_path_env(custom_bin: Option<&str>) -> Option<String> {
    let paths = build_search_paths(custom_bin);
    let path_str = paths.to_string_lossy().to_string();
    if path_str.is_empty() {
        None
    } else {
        Some(path_str)
    }
}

#[derive(Debug, Clone)]
pub(crate) struct CodexLaunchContext {
    pub(crate) resolved_bin: String,
    pub(crate) wrapper_kind: &'static str,
    pub(crate) path_env: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct CodexAppServerProbeStatus {
    pub(crate) ok: bool,
    pub(crate) status: String,
    pub(crate) details: Option<String>,
    pub(crate) fallback_retried: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum CodexAppServerLaunchMode {
    Normal,
    SessionHooksDisabled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum CodexGeneratedInstructionsTransport {
    Argv,
    OmitForWrapperRecovery,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct CodexAppServerLaunchOptions {
    pub(crate) hide_console: bool,
    pub(crate) inject_internal_spec_hint: bool,
    pub(crate) generated_instructions_transport: CodexGeneratedInstructionsTransport,
    pub(crate) launch_mode: CodexAppServerLaunchMode,
}

impl CodexAppServerLaunchOptions {
    pub(crate) fn primary() -> Self {
        Self::primary_for_platform(cfg!(windows))
    }

    pub(crate) fn primary_for_platform(is_windows: bool) -> Self {
        Self {
            hide_console: true,
            inject_internal_spec_hint: true,
            generated_instructions_transport: if is_windows {
                CodexGeneratedInstructionsTransport::OmitForWrapperRecovery
            } else {
                CodexGeneratedInstructionsTransport::Argv
            },
            launch_mode: CodexAppServerLaunchMode::Normal,
        }
    }

    pub(crate) fn wrapper_compatibility_retry() -> Self {
        Self::wrapper_compatibility_retry_for_mode(CodexAppServerLaunchMode::Normal)
    }

    pub(crate) fn wrapper_compatibility_retry_for_mode(
        launch_mode: CodexAppServerLaunchMode,
    ) -> Self {
        Self {
            hide_console: !wrapper_visible_console_retry_requested(),
            inject_internal_spec_hint: true,
            generated_instructions_transport:
                CodexGeneratedInstructionsTransport::OmitForWrapperRecovery,
            launch_mode,
        }
    }

    pub(crate) fn session_hooks_disabled() -> Self {
        Self::session_hooks_disabled_for_platform(cfg!(windows))
    }

    pub(crate) fn session_hooks_disabled_for_platform(is_windows: bool) -> Self {
        Self {
            hide_console: true,
            inject_internal_spec_hint: true,
            generated_instructions_transport: if is_windows {
                CodexGeneratedInstructionsTransport::OmitForWrapperRecovery
            } else {
                CodexGeneratedInstructionsTransport::Argv
            },
            launch_mode: CodexAppServerLaunchMode::SessionHooksDisabled,
        }
    }
}

fn resolve_codex_binary(codex_bin: Option<&str>) -> String {
    if let Some(custom) = codex_bin {
        let trimmed = custom.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    find_cli_binary("codex", None)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| "codex".to_string())
}

pub(crate) fn resolve_codex_launch_context(codex_bin: Option<&str>) -> CodexLaunchContext {
    let resolved_bin = resolve_codex_binary(codex_bin);
    CodexLaunchContext {
        wrapper_kind: wrapper_kind_for_binary(&resolved_bin),
        path_env: build_codex_path_env(codex_bin),
        resolved_bin,
    }
}

pub(crate) fn wrapper_kind_for_binary(bin: &str) -> &'static str {
    let normalized = bin.trim().to_ascii_lowercase();
    if normalized.ends_with(".cmd") {
        "cmd-wrapper"
    } else if normalized.ends_with(".bat") {
        "bat-wrapper"
    } else if normalized.ends_with(".ps1") {
        "ps1-wrapper"
    } else if normalized.ends_with(".exe") {
        "exe-binary"
    } else {
        "direct"
    }
}

#[allow(dead_code)]
pub(crate) fn launch_context_uses_command_wrapper(launch_context: &CodexLaunchContext) -> bool {
    matches!(
        launch_context.wrapper_kind,
        "cmd-wrapper" | "bat-wrapper" | "ps1-wrapper"
    )
}

fn codex_args_contain_instruction_override(args: &[String]) -> bool {
    let mut iter = args.iter().peekable();
    while let Some(arg) = iter.next() {
        if arg.starts_with("developer_instructions=") || arg.starts_with("instructions=") {
            return true;
        }
        if let Some(value) = arg.strip_prefix("--config=") {
            let key = value.split('=').next().unwrap_or_default().trim();
            if key == "developer_instructions" || key == "instructions" {
                return true;
            }
        }
        if arg == "-c" || arg == "--config" {
            if let Some(next) = iter.peek() {
                let key = next.split('=').next().unwrap_or_default().trim();
                if key == "developer_instructions" || key == "instructions" {
                    return true;
                }
            }
        }
    }
    false
}

#[allow(dead_code)]
pub(crate) fn codex_args_override_instructions(codex_args: Option<&str>) -> bool {
    let Ok(args) = parse_codex_args(codex_args) else {
        return false;
    };
    codex_args_contain_instruction_override(&args)
}

fn encode_toml_string(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n");
    format!("\"{escaped}\"")
}

#[allow(dead_code)]
pub(crate) fn codex_external_spec_priority_config_arg() -> String {
    format!(
        "developer_instructions={}",
        encode_toml_string(CODEX_EXTERNAL_SPEC_PRIORITY_INSTRUCTIONS)
    )
}

/// Walk a parsed `codex_args` argv and extract an existing
/// `-c developer_instructions="..."` / `-c instructions="..."` /
/// `--config developer_instructions=...` / `--config instructions=...` value,
/// TOML-decoded. Returns `None` if no override is present.
#[allow(dead_code)]
pub(crate) fn extract_existing_developer_instructions(args: &[String]) -> Option<String> {
    let mut iter = args.iter().enumerate().peekable();
    while let Some((idx, arg)) = iter.next() {
        let value_after_flag = |next: Option<&&String>| -> Option<String> {
            let v = next?.as_str();
            if v.starts_with("developer_instructions=") || v.starts_with("instructions=") {
                Some(decode_toml_string(&v.splitn(2, '=').nth(1).unwrap_or("")))
            } else {
                None
            }
        };
        if let Some(rest) = arg.strip_prefix("--config=") {
            let key = rest.split('=').next().unwrap_or_default().trim();
            if matches!(key, "developer_instructions" | "instructions") {
                let v = rest.splitn(2, '=').nth(1).unwrap_or("");
                return Some(decode_toml_string(v));
            }
        }
        // Concat forms: "-cinstructions=foo" or "--configinstructions=foo".
        if let Some(rest) = arg.strip_prefix("-c") {
            if rest.starts_with("developer_instructions=") || rest.starts_with("instructions=") {
                let v = rest.splitn(2, '=').nth(1).unwrap_or("");
                return Some(decode_toml_string(v));
            }
        }
        if let Some(rest) = arg.strip_prefix("--config") {
            if rest.starts_with("=") {
                // handled above
            } else if rest.starts_with("developer_instructions=")
                || rest.starts_with("instructions=")
            {
                let v = rest.splitn(2, '=').nth(1).unwrap_or("");
                return Some(decode_toml_string(v));
            }
        }
        if let Some(rest) = arg.strip_prefix("developer_instructions=") {
            return Some(decode_toml_string(rest));
        }
        if let Some(rest) = arg.strip_prefix("instructions=") {
            return Some(decode_toml_string(rest));
        }
        if arg == "-c" || arg == "--config" {
            if let Some((_, next)) = iter.peek() {
                if let Some(v) = value_after_flag(Some(next)) {
                    return Some(v);
                }
            }
            let _ = idx;
        }
    }
    None
}

/// Strip surrounding double quotes from a value produced by
/// `encode_toml_string`, returning the inner slice unchanged if it is not
/// double-quoted.
#[allow(dead_code)]
fn strip_toml_outer_quotes(value: &str) -> &str {
    if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
        &value[1..value.len() - 1]
    } else {
        value
    }
}

/// Inverse of `encode_toml_string` for the basic escapes we use:
/// backslash, double quote, newline. Outer double quotes (if present) are
/// stripped first so callers can pass the raw argv value.
#[allow(dead_code)]
fn decode_toml_string(value: &str) -> String {
    let inner = strip_toml_outer_quotes(value);
    let mut out = String::with_capacity(inner.len());
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('\\') => out.push('\\'),
                Some('"') => out.push('"'),
                Some('n') => out.push('\n'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Build the merged curated-skill `developer_instructions` value for the
/// Codex CLI, applying the same merge policy as
/// `merge_developer_instructions` (existing text is preserved, curated
/// directives appended as a `## Curated Skills` block).
#[allow(dead_code)]
pub(crate) fn codex_curated_skills_config_arg(
    app_settings: &crate::types::AppSettings,
    existing: Option<&str>,
) -> Option<String> {
    let block = codex_curated_skills_developer_instructions_block(app_settings)?;
    crate::codex::collaboration_policy::merge_developer_instructions(existing, &[block])
}

fn codex_curated_skills_developer_instructions_block(
    app_settings: &crate::types::AppSettings,
) -> Option<String> {
    use crate::curated_skills;
    let enabled = curated_skills::list_enabled_curated_skill_bodies(app_settings);
    let enabled_label = if enabled.is_empty() {
        "none".to_string()
    } else {
        enabled
            .iter()
            .map(|(id, _)| format!("`{id}`"))
            .collect::<Vec<_>>()
            .join(", ")
    };
    let mut snapshot = format!(
        "## Curated Skills\n\nThis section is the authoritative state for doge bundled curated skills in the current runtime or turn. Only `<skill>` blocks listed in this section are active. Any doge bundled curated-skill instructions from earlier turns whose id is not listed here are inactive and MUST NOT be followed. This state does not change user-supplied developer instructions, system instructions, or skills provided through other mechanisms.\n\nEnabled: {enabled_label}."
    );
    if !enabled.is_empty() {
        let bodies = enabled
            .into_iter()
            .map(|(id, body)| format!("<skill id=\"{}\">\n{}\n</skill>", id, body))
            .collect::<Vec<_>>()
            .join("\n");
        snapshot.push_str("\n\n");
        snapshot.push_str(&bodies);
    }
    Some(snapshot)
}

fn build_generated_developer_instructions(
    options: CodexAppServerLaunchOptions,
    app_settings: Option<&crate::types::AppSettings>,
) -> Option<String> {
    let mut directives = Vec::new();
    if options.inject_internal_spec_hint {
        directives.push(CODEX_EXTERNAL_SPEC_PRIORITY_INSTRUCTIONS.to_string());
    }
    if let Some(settings) = app_settings {
        if let Some(block) = codex_curated_skills_developer_instructions_block(settings) {
            directives.push(block);
        }
    }
    crate::codex::collaboration_policy::merge_developer_instructions(None, &directives)
}

pub(crate) fn codex_generated_developer_instructions_for_turn(
    app_settings: &crate::types::AppSettings,
) -> Option<String> {
    build_generated_developer_instructions(
        CodexAppServerLaunchOptions::primary_for_platform(false),
        Some(app_settings),
    )
}

pub(crate) fn build_codex_app_server_args(
    codex_args: Option<&str>,
    options: CodexAppServerLaunchOptions,
) -> Result<Vec<String>, String> {
    build_codex_app_server_args_with_settings(codex_args, options, None)
}

/// Same as `build_codex_app_server_args` but additionally injects the
/// enabled curated skills as a `-c developer_instructions="..."` arg right
/// before the final `app-server` arg, **only when**:
///   * `app_settings` is `Some`
///   * the user-supplied `codex_args` does NOT already contain a
///     `developer_instructions=` / `instructions=` override
///
/// The generated block is also present when no curated skill is enabled so a
/// resumed Codex thread receives an authoritative deactivation snapshot.
/// Existing developer instructions are preserved and the curated block is
/// appended under a `## Curated Skills` heading via the same merge policy
/// used by `merge_developer_instructions`.
pub(crate) fn build_codex_app_server_args_with_settings(
    codex_args: Option<&str>,
    options: CodexAppServerLaunchOptions,
    app_settings: Option<&crate::types::AppSettings>,
) -> Result<Vec<String>, String> {
    build_codex_app_server_args_with_settings_and_profile(codex_args, options, app_settings, None)
}

pub(crate) fn build_codex_app_server_args_with_settings_and_profile(
    codex_args: Option<&str>,
    options: CodexAppServerLaunchOptions,
    app_settings: Option<&crate::types::AppSettings>,
    _codex_home: Option<&Path>,
) -> Result<Vec<String>, String> {
    let mut args = parse_codex_args(codex_args)?;
    if !codex_args_contain_instruction_override(&args) {
        if let Some(merged) = build_generated_developer_instructions(options, app_settings) {
            match options.generated_instructions_transport {
                CodexGeneratedInstructionsTransport::Argv => {
                    args.push("-c".to_string());
                    args.push(format!(
                        "developer_instructions={}",
                        encode_toml_string(&merged)
                    ));
                }
                CodexGeneratedInstructionsTransport::OmitForWrapperRecovery => {}
            }
        }
    }
    args.push("app-server".to_string());
    Ok(args)
}

pub(crate) fn apply_codex_app_server_args(
    command: &mut Command,
    codex_args: Option<&str>,
    options: CodexAppServerLaunchOptions,
) -> Result<(), String> {
    command.args(build_codex_app_server_args(codex_args, options)?);
    Ok(())
}

/// Apply codex args **with** the live `AppSettings` so curated skills are
/// injected as a developer_instructions TOML arg. Spawn-time callers
/// (real workspace sessions) go through this variant.
pub(crate) fn apply_codex_app_server_args_with_settings(
    command: &mut Command,
    codex_args: Option<&str>,
    options: CodexAppServerLaunchOptions,
    app_settings: &crate::types::AppSettings,
    codex_home: Option<&Path>,
) -> Result<(), String> {
    command.args(build_codex_app_server_args_with_settings_and_profile(
        codex_args,
        options,
        Some(app_settings),
        codex_home,
    )?);
    Ok(())
}

const PROXY_ENV_KEYS: [&str; 8] = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
];

fn redact_proxy_env_value(key: &str, value: String) -> String {
    if key.eq_ignore_ascii_case("NO_PROXY") {
        return value;
    }

    let trimmed = value.trim();
    if trimmed.is_empty() {
        return value;
    }

    let Some(at_index) = trimmed.find('@') else {
        return value;
    };
    let credentials_start = trimmed.find("://").map(|index| index + 3).unwrap_or(0);
    if at_index <= credentials_start {
        return value;
    }

    format!(
        "{}[redacted]@{}",
        &trimmed[..credentials_start],
        &trimmed[at_index + 1..]
    )
}

fn proxy_env_snapshot() -> serde_json::Map<String, Value> {
    PROXY_ENV_KEYS
        .into_iter()
        .map(|key| {
            let value = env::var(key)
                .ok()
                .map(|raw_value| redact_proxy_env_value(key, raw_value));
            (key.to_string(), json!(value))
        })
        .collect()
}

pub(crate) fn build_proxy_diagnosis(proxy_snapshot: &serde_json::Map<String, Value>) -> Value {
    let configured_keys: Vec<String> = PROXY_ENV_KEYS
        .iter()
        .filter_map(|key| {
            let value = proxy_snapshot.get(*key).and_then(Value::as_str)?;
            if value.trim().is_empty() {
                None
            } else {
                Some((*key).to_string())
            }
        })
        .collect();

    let primary_source = configured_keys
        .iter()
        .find(|key| {
            matches!(
                key.as_str(),
                "HTTPS_PROXY"
                    | "https_proxy"
                    | "HTTP_PROXY"
                    | "http_proxy"
                    | "ALL_PROXY"
                    | "all_proxy"
            )
        })
        .map(|_| "processEnv");

    json!({
        "category": if primary_source.is_some() { "proxyConfigured" } else { "missingProxy" },
        "primarySource": primary_source,
        "configuredKeys": configured_keys,
        "processEnv": proxy_snapshot,
        "valuesRedacted": true,
    })
}

pub(crate) fn classify_endpoint_failure(details: Option<&str>) -> &'static str {
    let Some(details) = details else {
        return "unknown";
    };
    let normalized = details.to_ascii_lowercase();
    if normalized.contains("timed out") || normalized.contains("timeout") {
        "timeout"
    } else if normalized.contains("dns") || normalized.contains("could not resolve") {
        "dnsFailure"
    } else if normalized.contains("tls")
        || normalized.contains("certificate")
        || normalized.contains("ssl")
    {
        "tlsFailure"
    } else if normalized.contains("proxy") || normalized.contains("407") {
        "proxyUnreachable"
    } else if normalized.contains("status") || normalized.contains("http") {
        "httpStatus"
    } else {
        "unknown"
    }
}

fn value_string(debug_info: &Value, key: &str) -> Option<String> {
    debug_info
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn is_explicit_path(value: &str) -> bool {
    value.contains('/') || value.contains('\\')
}

pub(crate) fn build_engine_environment_diagnosis(
    engine_name: &str,
    requested_bin: Option<&str>,
    debug_info: &Value,
) -> Value {
    let engine_prefix = if engine_name.eq_ignore_ascii_case("claude") {
        "claude"
    } else {
        "codex"
    };
    let found_key = format!("{engine_prefix}Found");
    let standard_key = format!("{engine_prefix}StandardWhich");
    let fallback_binary = value_string(debug_info, &found_key);
    let gui_path_binary = value_string(debug_info, &standard_key);
    let resolved_binary = value_string(debug_info, "resolvedBinaryPath");
    let configured_path = requested_bin
        .map(str::trim)
        .filter(|value| !value.is_empty() && is_explicit_path(value))
        .map(ToString::to_string);
    let configured_path_missing = configured_path
        .as_deref()
        .map(|path| !Path::new(path).exists())
        .unwrap_or(false);
    let missed_by_gui_path = fallback_binary.is_some() && gui_path_binary.is_none();
    let category = if configured_path_missing {
        "configuredPathMissing"
    } else if missed_by_gui_path {
        "environmentDrift"
    } else if fallback_binary.is_some()
        && gui_path_binary.is_some()
        && fallback_binary != gui_path_binary
    {
        "pathPrecedenceDiffers"
    } else if fallback_binary.is_some() || gui_path_binary.is_some() {
        "resolved"
    } else {
        "notFound"
    };
    let message = match category {
        "configuredPathMissing" => "Configured executable path does not exist.",
        "environmentDrift" => {
            "Executable was found by platform fallback but not by the GUI process PATH."
        }
        "pathPrecedenceDiffers" => {
            "Extended resolver and GUI process PATH resolve different executables."
        }
        "resolved" => "Executable is visible to the runtime resolver.",
        _ => "Executable was not found by the runtime resolver.",
    };

    json!({
        "category": category,
        "message": message,
        "configuredPath": configured_path,
        "configuredPathMissing": configured_path_missing,
        "guiPathBinary": gui_path_binary,
        "fallbackBinary": fallback_binary,
        "resolvedBinaryPath": resolved_binary,
        "missedByGuiPath": missed_by_gui_path,
    })
}

/// Get debug information for CLI detection (useful for troubleshooting on Windows)
pub fn get_cli_debug_info(custom_bin: Option<&str>) -> serde_json::Value {
    let mut debug = serde_json::Map::new();
    let launch_context = resolve_codex_launch_context(custom_bin);

    // Platform info
    debug.insert("platform".to_string(), json!(std::env::consts::OS));
    debug.insert("arch".to_string(), json!(std::env::consts::ARCH));
    debug.insert(
        "resolvedBinaryPath".to_string(),
        json!(launch_context.resolved_bin),
    );
    debug.insert(
        "wrapperKind".to_string(),
        json!(launch_context.wrapper_kind),
    );
    debug.insert("pathEnvUsed".to_string(), json!(launch_context.path_env));
    let proxy_snapshot = proxy_env_snapshot();
    debug.insert(
        "proxyEnvSnapshot".to_string(),
        Value::Object(proxy_snapshot.clone()),
    );
    debug.insert(
        "proxyDiagnosis".to_string(),
        build_proxy_diagnosis(&proxy_snapshot),
    );

    // Environment variables (Windows-specific)
    let env_vars: Vec<(&str, Option<String>)> = vec![
        ("PATH", env::var("PATH").ok()),
        ("USERPROFILE", env::var("USERPROFILE").ok()),
        ("APPDATA", env::var("APPDATA").ok()),
        ("LOCALAPPDATA", env::var("LOCALAPPDATA").ok()),
        ("ProgramFiles", env::var("ProgramFiles").ok()),
        ("HOME", env::var("HOME").ok()),
    ];
    let env_info: serde_json::Map<String, serde_json::Value> = env_vars
        .into_iter()
        .map(|(k, v)| (k.to_string(), json!(v)))
        .collect();
    debug.insert("envVars".to_string(), json!(env_info));

    // Extra search paths and their existence
    let extra_paths = get_extra_search_paths();
    let extra_paths_info: Vec<serde_json::Value> = extra_paths
        .iter()
        .map(|p| {
            // Also check if CLI files exist in this path
            let codex_cmd = p.join("codex.cmd");
            let claude_cmd = p.join("claude.cmd");
            json!({
                "path": p.to_string_lossy(),
                "exists": p.exists(),
                "isDir": p.is_dir(),
                "hasCodexCmd": codex_cmd.exists(),
                "hasClaudeCmd": claude_cmd.exists()
            })
        })
        .collect();
    debug.insert("extraSearchPaths".to_string(), json!(extra_paths_info));

    // Try to find claude and codex binaries
    let claude_found = find_cli_binary("claude", matching_custom_bin(custom_bin, "claude"));
    let codex_found = find_cli_binary("codex", matching_custom_bin(custom_bin, "codex"));
    debug.insert(
        "claudeFound".to_string(),
        json!(claude_found.map(|p| p.to_string_lossy().to_string())),
    );
    debug.insert(
        "codexFound".to_string(),
        json!(codex_found.map(|p| p.to_string_lossy().to_string())),
    );

    // Also try standard which without extra paths
    let claude_standard = which::which("claude").ok();
    let codex_standard = which::which("codex").ok();
    debug.insert(
        "claudeStandardWhich".to_string(),
        json!(claude_standard.map(|p| p.to_string_lossy().to_string())),
    );
    debug.insert(
        "codexStandardWhich".to_string(),
        json!(codex_standard.map(|p| p.to_string_lossy().to_string())),
    );

    // Custom binary info
    debug.insert("customBin".to_string(), json!(custom_bin));

    // Combined search paths
    let search_paths = build_search_paths(custom_bin);
    debug.insert(
        "combinedSearchPaths".to_string(),
        json!(search_paths.to_string_lossy()),
    );

    serde_json::Value::Object(debug)
}

/// Build a command that correctly handles .cmd files on Windows.
/// Uses CREATE_NO_WINDOW to prevent visible console windows.
pub fn build_command_for_binary_with_console(bin: &str, hide_console: bool) -> Command {
    #[cfg(windows)]
    {
        // On Windows, .cmd files need to be run through cmd.exe
        let bin_lower = bin.to_lowercase();
        if bin_lower.ends_with(".cmd") || bin_lower.ends_with(".bat") {
            let mut cmd = crate::utils::async_command_with_console_visibility("cmd", hide_console);
            cmd.arg("/c");
            cmd.arg(bin);
            return cmd;
        }
        if bin_lower.ends_with(".ps1") {
            let mut cmd =
                crate::utils::async_command_with_console_visibility("powershell", hide_console);
            cmd.arg("-NoProfile");
            cmd.arg("-ExecutionPolicy");
            cmd.arg("Bypass");
            cmd.arg("-File");
            cmd.arg(bin);
            return cmd;
        }
    }
    crate::utils::async_command_with_console_visibility(bin, hide_console)
}

pub fn build_command_for_binary(bin: &str) -> Command {
    build_command_for_binary_with_console(bin, true)
}

pub(crate) fn build_codex_command_from_launch_context(
    launch_context: &CodexLaunchContext,
    hide_console: bool,
) -> Command {
    let mut command =
        build_command_for_binary_with_console(&launch_context.resolved_bin, hide_console);
    if let Some(path_env) = &launch_context.path_env {
        command.env("PATH", path_env);
    }
    command
}

pub(crate) fn build_codex_command_with_bin(codex_bin: Option<String>) -> Command {
    let launch_context = resolve_codex_launch_context(codex_bin.as_deref());
    build_codex_command_from_launch_context(&launch_context, true)
}

/// Check if a specific CLI binary is available and return its version
pub(crate) async fn check_cli_binary(
    bin: &str,
    path_env: Option<String>,
) -> Result<Option<String>, String> {
    async fn run_cli_version_check_once(
        launch_context: &CodexLaunchContext,
        hide_console: bool,
    ) -> Result<Option<String>, String> {
        let mut command =
            build_command_for_binary_with_console(&launch_context.resolved_bin, hide_console);
        if let Some(path) = &launch_context.path_env {
            command.env("PATH", path);
        }
        command.arg("--version");
        command.stdout(std::process::Stdio::piped());
        command.stderr(std::process::Stdio::piped());

        let output = match timeout(Duration::from_secs(5), command.output()).await {
            Ok(result) => match result {
                Ok(out) => out,
                Err(e) => {
                    if e.kind() == ErrorKind::NotFound {
                        return Err("not_found".to_string());
                    }
                    return Err(e.to_string());
                }
            },
            Err(_) => {
                return Err("timeout".to_string());
            }
        };

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let detail = if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            };
            if detail.is_empty() {
                return Err("failed".to_string());
            }
            return Err(format!("failed: {detail}"));
        }

        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(if version.is_empty() {
            None
        } else {
            Some(version)
        })
    }

    async fn run_cli_help_check_once(
        launch_context: &CodexLaunchContext,
        hide_console: bool,
    ) -> Result<(), String> {
        let mut command =
            build_command_for_binary_with_console(&launch_context.resolved_bin, hide_console);
        if let Some(path) = &launch_context.path_env {
            command.env("PATH", path);
        }
        command.arg("--help");
        command.stdout(std::process::Stdio::null());
        command.stderr(std::process::Stdio::null());

        let output = match timeout(Duration::from_secs(5), command.output()).await {
            Ok(result) => match result {
                Ok(out) => out,
                Err(e) => {
                    if e.kind() == ErrorKind::NotFound {
                        return Err("not_found".to_string());
                    }
                    return Err(e.to_string());
                }
            },
            Err(_) => return Err("timeout".to_string()),
        };

        if output.status.success() {
            Ok(())
        } else {
            Err("failed".to_string())
        }
    }

    async fn run_cli_help_check(launch_context: &CodexLaunchContext) -> Result<(), String> {
        match run_cli_help_check_once(launch_context, true).await {
            Ok(()) => Ok(()),
            Err(primary_error) => {
                if !can_retry_wrapper_launch(launch_context) {
                    return Err(primary_error);
                }
                run_cli_help_check_once(launch_context, false)
                    .await
                    .map_err(|retry_error| {
                        format!(
                            "Primary wrapper launch failed: {primary_error}\nFallback retry failed: {retry_error}"
                        )
                    })
            }
        }
    }

    let mut launch_context = resolve_codex_launch_context(Some(bin));
    launch_context.path_env = path_env;

    match run_cli_version_check_once(&launch_context, true).await {
        Ok(version) => Ok(version),
        Err(primary_error) => {
            let version_retry_result = if can_retry_wrapper_launch(&launch_context) {
                run_cli_version_check_once(&launch_context, false)
                    .await
                    .map_err(|retry_error| {
                        format!(
                            "Primary wrapper launch failed: {primary_error}\nFallback retry failed: {retry_error}"
                        )
                    })
            } else {
                Err(primary_error)
            };

            match version_retry_result {
                Ok(version) => Ok(version),
                Err(version_error) => match run_cli_help_check(&launch_context).await {
                    Ok(()) => Ok(None),
                    Err(_) => Err(version_error),
                },
            }
        }
    }
}

#[allow(dead_code)]
pub(crate) fn visible_console_fallback_enabled_from_env(value: Option<&str>) -> bool {
    matches!(value, Some("1") | Some("true"))
}

fn wrapper_visible_console_retry_requested() -> bool {
    let configured = env::var("DOGE_SHOW_CONSOLE")
        .or_else(|_| env::var("CODEMOSS_SHOW_CONSOLE"))
        .ok();
    visible_console_fallback_enabled_from_env(configured.as_deref())
}

#[cfg(windows)]
fn allow_wrapper_visible_console_fallback() -> bool {
    wrapper_visible_console_retry_requested()
}

#[cfg(windows)]
pub(crate) fn can_retry_wrapper_launch(launch_context: &CodexLaunchContext) -> bool {
    launch_context_uses_command_wrapper(launch_context) && allow_wrapper_visible_console_fallback()
}

#[cfg(not(windows))]
pub(crate) fn can_retry_wrapper_launch(_launch_context: &CodexLaunchContext) -> bool {
    false
}

#[cfg(windows)]
pub(crate) fn can_retry_wrapper_compatibility_launch(launch_context: &CodexLaunchContext) -> bool {
    launch_context_uses_command_wrapper(launch_context)
}

#[cfg(not(windows))]
pub(crate) fn can_retry_wrapper_compatibility_launch(_launch_context: &CodexLaunchContext) -> bool {
    false
}

async fn run_codex_app_server_probe_once(
    launch_context: &CodexLaunchContext,
    codex_args: Option<&str>,
    options: CodexAppServerLaunchOptions,
) -> Result<(), String> {
    let mut command = build_codex_command_from_launch_context(launch_context, options.hide_console);
    apply_codex_app_server_args(&mut command, codex_args, options)?;
    command.arg("--help");
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());

    let output = match timeout(Duration::from_secs(5), command.output()).await {
        Ok(result) => result.map_err(|err| err.to_string())?,
        Err(_) => {
            return Err("Timed out while checking `codex app-server --help`.".to_string());
        }
    };

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    if detail.is_empty() {
        Err("`codex app-server --help` exited with a non-zero status.".to_string())
    } else {
        Err(detail.to_string())
    }
}

fn codex_app_server_probe_cache_key(
    launch_context: &CodexLaunchContext,
    codex_args: Option<&str>,
    launch_options: CodexAppServerLaunchOptions,
) -> CodexAppServerProbeCacheKey {
    CodexAppServerProbeCacheKey {
        resolved_bin: launch_context.resolved_bin.clone(),
        wrapper_kind: launch_context.wrapper_kind,
        path_env: launch_context.path_env.clone(),
        codex_args: codex_args
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string),
        launch_options,
    }
}

fn read_codex_app_server_probe_cache(
    key: &CodexAppServerProbeCacheKey,
) -> Option<CodexAppServerProbeStatus> {
    let cache = CODEX_APP_SERVER_PROBE_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let entry = cache.get(key)?;
    if entry.checked_at.elapsed() <= CODEX_APP_SERVER_PROBE_CACHE_TTL {
        return Some(entry.status.clone());
    }
    None
}

fn write_codex_app_server_probe_cache(
    key: CodexAppServerProbeCacheKey,
    status: &CodexAppServerProbeStatus,
) {
    if !status.ok {
        return;
    }
    let mut cache = CODEX_APP_SERVER_PROBE_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    cache.insert(
        key,
        CodexAppServerProbeCacheEntry {
            checked_at: Instant::now(),
            status: status.clone(),
        },
    );
}

pub(crate) async fn probe_codex_app_server(
    codex_bin: Option<String>,
    codex_args: Option<&str>,
) -> Result<CodexAppServerProbeStatus, String> {
    let launch_context = resolve_codex_launch_context(codex_bin.as_deref());
    let primary_cache_key = codex_app_server_probe_cache_key(
        &launch_context,
        codex_args,
        CodexAppServerLaunchOptions::primary(),
    );
    if let Some(status) = read_codex_app_server_probe_cache(&primary_cache_key) {
        return Ok(status);
    }
    match run_codex_app_server_probe_once(
        &launch_context,
        codex_args,
        CodexAppServerLaunchOptions::primary(),
    )
    .await
    {
        Ok(()) => {
            let status = CodexAppServerProbeStatus {
                ok: true,
                status: "ok".to_string(),
                details: None,
                fallback_retried: false,
            };
            write_codex_app_server_probe_cache(primary_cache_key, &status);
            Ok(status)
        }
        Err(primary_error) => {
            if !can_retry_wrapper_compatibility_launch(&launch_context) {
                return Ok(CodexAppServerProbeStatus {
                    ok: false,
                    status: "failed".to_string(),
                    details: Some(primary_error),
                    fallback_retried: false,
                });
            }

            let fallback_options = CodexAppServerLaunchOptions::wrapper_compatibility_retry();
            let fallback_cache_key =
                codex_app_server_probe_cache_key(&launch_context, codex_args, fallback_options);
            if let Some(status) = read_codex_app_server_probe_cache(&fallback_cache_key) {
                return Ok(status);
            }

            match run_codex_app_server_probe_once(
                &launch_context,
                codex_args,
                fallback_options,
            )
            .await
            {
                Ok(()) => {
                    let status = CodexAppServerProbeStatus {
                    ok: true,
                    status: "fallback-ok".to_string(),
                    details: Some(primary_error),
                    fallback_retried: true,
                    };
                    write_codex_app_server_probe_cache(fallback_cache_key, &status);
                    Ok(status)
                }
                Err(retry_error) => Ok(CodexAppServerProbeStatus {
                    ok: false,
                    status: "fallback-failed".to_string(),
                    details: Some(format!(
                        "Primary wrapper launch failed: {primary_error}\nFallback retry failed: {retry_error}"
                    )),
                    fallback_retried: true,
                }),
            }
        }
    }
}

pub(crate) async fn check_codex_installation(
    codex_bin: Option<String>,
) -> Result<Option<String>, String> {
    let path_env = build_codex_path_env(codex_bin.as_deref());

    // If user specified a custom binary path, use it directly
    if let Some(ref bin) = codex_bin {
        if !bin.trim().is_empty() {
            return match check_cli_binary(bin, path_env).await {
                Ok(version) => Ok(version),
                Err(e) if e == "not_found" => Err(format!(
                    "Codex CLI not found at '{}'. Please check the Codex binary path is correct.",
                    bin
                )),
                Err(e) if e == "timeout" => Err(format!(
                    "Timed out while checking Codex CLI at '{}'. Make sure `codex --version` runs in Terminal.",
                    bin
                )),
                Err(e) if e == "failed" => Err(format!(
                    "Codex CLI at '{}' failed to start. Try running `codex --version` in Terminal.",
                    bin
                )),
                Err(e) => Err(format!("Codex CLI at '{}' failed: {}", bin, e)),
            };
        }
    }

    // Codex app-server must fail closed. Claude is a different engine and must
    // never satisfy Codex launch resolution.
    if let Some(codex_path) = find_cli_binary("codex", None) {
        let codex_bin = codex_path.to_string_lossy().to_string();
        if let Ok(version) = check_cli_binary(&codex_bin, path_env.clone()).await {
            return Ok(version);
        }
    }

    let codex_result = check_cli_binary("codex", path_env.clone()).await;
    if let Ok(version) = codex_result {
        return Ok(version);
    }

    Err(
        "CODEX_CLI_NOT_FOUND: Codex CLI was not found. Install Codex and make sure `codex app-server --help` works in Terminal."
            .to_string(),
    )
}

#[cfg(test)]
mod curated_skill_injection_tests {
    //! Black-box tests for the Codex curated-skill injection helpers.
    //!
    //! Covers:
    //! - `extract_existing_developer_instructions` parsing all four forms
    //! - `codex_curated_skills_config_arg` building the merged body
    //! - `build_codex_app_server_args_with_settings` end-to-end argv
    //!   (no enabled -> no arg; enabled -> -c developer_instructions=...;
    //!    user override -> curated skipped)
    use super::*;
    use crate::types::AppSettings;

    fn primary_no_hint() -> CodexAppServerLaunchOptions {
        CodexAppServerLaunchOptions {
            hide_console: true,
            inject_internal_spec_hint: false,
            generated_instructions_transport: CodexGeneratedInstructionsTransport::Argv,
            launch_mode: CodexAppServerLaunchMode::Normal,
        }
    }

    fn settings_with(ids: Vec<&str>) -> AppSettings {
        let mut s = AppSettings::default();
        s.enabled_curated_skill_ids = ids.into_iter().map(String::from).collect();
        s
    }

    #[test]
    fn extract_existing_finds_dash_c_form() {
        let args = vec![
            "-c".to_string(),
            "developer_instructions=hello world".to_string(),
        ];
        let v = extract_existing_developer_instructions(&args).expect("present");
        assert_eq!(v, "hello world");
    }

    #[test]
    fn extract_existing_finds_concat_form() {
        let args = vec!["-cinstructions=foo bar".to_string()];
        let v = extract_existing_developer_instructions(&args).expect("present");
        assert_eq!(v, "foo bar");
    }

    #[test]
    fn extract_existing_finds_long_config_form() {
        let args = vec!["--config=developer_instructions=cfg body".to_string()];
        let v = extract_existing_developer_instructions(&args).expect("present");
        assert_eq!(v, "cfg body");
    }

    #[test]
    fn extract_existing_returns_none_when_absent() {
        let args = vec![
            "app-server".to_string(),
            "--port".to_string(),
            "4732".to_string(),
        ];
        assert!(extract_existing_developer_instructions(&args).is_none());
    }

    #[test]
    fn extract_existing_decodes_toml_escapes() {
        // Simulate what encode_toml_string would produce: double-quote-wrapped
        // text with newlines escaped as "\n".
        let raw_body = "line1\nline2";
        let mut encoded = String::from("\"");
        encoded.push_str("line1");
        encoded.push_str("\\n");
        encoded.push_str("line2");
        encoded.push('"');
        let args = vec![
            "-c".to_string(),
            format!("developer_instructions={}", encoded),
        ];
        let v = extract_existing_developer_instructions(&args).expect("present");
        assert_eq!(v, raw_body);
    }

    #[test]
    fn codex_curated_skills_config_arg_emits_authoritative_snapshot_when_empty() {
        let s = settings_with(vec![]);
        let out = codex_curated_skills_config_arg(&s, None).expect("disabled snapshot");
        assert!(out.contains("authoritative state"));
        assert!(out.contains("Enabled: none."));
        assert!(!out.contains("<skill id="));
    }

    #[test]
    fn codex_curated_skills_config_arg_marks_unlisted_skills_inactive() {
        let s = settings_with(vec!["lazy-senior-dev"]);
        let out = codex_curated_skills_config_arg(&s, None).expect("enabled snapshot");
        assert!(out.contains("Enabled: `lazy-senior-dev`."));
        assert!(out.contains("whose id is not listed here are inactive"));
        assert!(out.contains("<skill id=\"lazy-senior-dev\">"));
        assert!(!out.contains("<skill id=\"caveman\">"));
    }

    #[test]
    fn build_codex_app_server_args_with_settings_injects_deactivation_when_disabled() {
        let s = settings_with(vec![]);
        let args =
            build_codex_app_server_args_with_settings(None, primary_no_hint(), Some(&s)).unwrap();
        let developer_instructions = args
            .iter()
            .find_map(|arg| arg.strip_prefix("developer_instructions="))
            .map(decode_toml_string)
            .expect("deactivation developer instructions");
        assert!(developer_instructions.contains("Enabled: none."));
        assert!(!developer_instructions.contains("<skill id="));
        // Final arg is "app-server".
        assert_eq!(args.last().map(String::as_str), Some("app-server"));
    }

    #[test]
    fn build_codex_app_server_args_with_settings_injects_when_enabled() {
        // Enable a curated skill (id matches what's in the lock).
        let s = settings_with(vec!["lazy-senior-dev"]);
        let args =
            build_codex_app_server_args_with_settings(None, primary_no_hint(), Some(&s)).unwrap();
        let mut found = false;
        for w in args.windows(2) {
            if w[0] == "-c" && w[1].starts_with("developer_instructions=") {
                found = true;
                let value = &w[1]["developer_instructions=".len()..];
                // The body should be wrapped in quotes and contain the
                // section header + skill id.
                assert!(
                    value.starts_with('"') && value.ends_with('"'),
                    "TOML-quoted: {}",
                    value
                );
                let unquoted = decode_toml_string(&value[1..value.len() - 1]);
                assert!(unquoted.contains("## Curated Skills"));
                assert!(unquoted.contains("lazy-senior-dev"));
            }
        }
        assert!(
            found,
            "expected a -c developer_instructions= arg, got {:?}",
            args
        );
    }

    #[test]
    fn build_codex_app_server_primary_args_merge_internal_hint_and_curated_skill() {
        let s = settings_with(vec!["lazy-senior-dev"]);
        let args = build_codex_app_server_args_with_settings(
            Some("--profile work"),
            CodexAppServerLaunchOptions::primary_for_platform(false),
            Some(&s),
        )
        .unwrap();

        assert_eq!(args.iter().filter(|arg| arg.as_str() == "-c").count(), 1);
        let arg = args
            .iter()
            .find(|arg| arg.starts_with("developer_instructions="))
            .expect("developer instructions arg");
        let value = &arg["developer_instructions=".len()..];
        let unquoted = decode_toml_string(value);
        assert!(unquoted.contains("writableRoots"), "got: {}", unquoted);
        assert!(unquoted.contains("## Curated Skills"), "got: {}", unquoted);
        assert!(unquoted.contains("lazy-senior-dev"), "got: {}", unquoted);
        assert_eq!(args.last().map(String::as_str), Some("app-server"));
    }

    #[test]
    fn build_codex_app_server_windows_primary_omits_generated_instructions_argv() {
        let s = settings_with(vec!["lazy-senior-dev"]);
        let args = build_codex_app_server_args_with_settings(
            Some("--profile work"),
            CodexAppServerLaunchOptions::primary_for_platform(true),
            Some(&s),
        )
        .unwrap();
        let joined_args = args.join(" ");

        assert_eq!(
            args,
            vec![
                "--profile".to_string(),
                "work".to_string(),
                "app-server".to_string(),
            ]
        );
        assert!(!joined_args.contains("developer_instructions="));
        assert!(!joined_args.contains("writableRoots"));
        assert!(!joined_args.contains("lazy-senior-dev"));
    }

    #[test]
    fn codex_generated_developer_instructions_for_turn_includes_hint_and_curated_skill() {
        let s = settings_with(vec!["lazy-senior-dev"]);
        let instructions =
            codex_generated_developer_instructions_for_turn(&s).expect("turn instructions");

        assert!(
            instructions.contains("writableRoots"),
            "got: {instructions}"
        );
        assert!(
            instructions.contains("## Curated Skills"),
            "got: {instructions}"
        );
        assert!(
            instructions.contains("lazy-senior-dev"),
            "got: {instructions}"
        );
    }

    #[test]
    fn codex_generated_developer_instructions_for_turn_includes_all_reenabled_skills() {
        let s = settings_with(vec!["lazy-senior-dev", "caveman"]);
        let instructions =
            codex_generated_developer_instructions_for_turn(&s).expect("turn instructions");

        assert!(
            instructions.contains("Enabled: `lazy-senior-dev`, `caveman`."),
            "got: {instructions}"
        );
        assert!(
            instructions.contains("<skill id=\"lazy-senior-dev\">"),
            "got: {instructions}"
        );
        assert!(
            instructions.contains("<skill id=\"caveman\">"),
            "got: {instructions}"
        );
    }

    #[test]
    fn codex_generated_developer_instructions_for_turn_deactivates_empty_snapshot() {
        let s = settings_with(vec![]);
        let instructions =
            codex_generated_developer_instructions_for_turn(&s).expect("turn instructions");

        assert!(
            instructions.contains("writableRoots"),
            "got: {instructions}"
        );
        assert!(
            instructions.contains("Enabled: none."),
            "got: {instructions}"
        );
        assert!(!instructions.contains("<skill id="), "got: {instructions}");
    }

    #[test]
    fn wrapper_retry_omits_generated_instructions_without_profile_transport() {
        let root = std::env::temp_dir().join(format!(
            "ccgui-codex-no-generated-profile-{}",
            uuid::Uuid::new_v4()
        ));
        let s = settings_with(vec!["lazy-senior-dev"]);
        let args = build_codex_app_server_args_with_settings_and_profile(
            Some("--profile work --sandbox read-only"),
            CodexAppServerLaunchOptions::wrapper_compatibility_retry(),
            Some(&s),
            Some(&root),
        )
        .expect("build retry args");

        assert_eq!(
            args,
            vec![
                "--profile".to_string(),
                "work".to_string(),
                "--sandbox".to_string(),
                "read-only".to_string(),
                "app-server".to_string(),
            ]
        );
        let joined_args = args.join(" ");
        assert!(!joined_args.contains("developer_instructions="));
        assert!(!joined_args.contains("writableRoots"));
        assert!(!joined_args.contains("## Curated Skills"));
        assert!(!joined_args.contains("lazy-senior-dev"));
        assert!(
            !root.exists()
                || !root
                    .join("ccgui-generated-instructions.config.toml")
                    .exists()
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn wrapper_retry_does_not_create_generated_transport_for_user_instruction_override() {
        let s = settings_with(vec!["lazy-senior-dev"]);
        let args = build_codex_app_server_args_with_settings_and_profile(
            Some(r#"-c developer_instructions="user policy""#),
            CodexAppServerLaunchOptions::wrapper_compatibility_retry(),
            Some(&s),
            None,
        )
        .expect("build retry args");

        assert_eq!(args.iter().filter(|arg| arg.as_str() == "-c").count(), 1);
        assert!(!args.iter().any(|arg| arg == "ccgui-generated-instructions"));
        assert_eq!(args.last().map(String::as_str), Some("app-server"));
    }

    #[test]
    fn build_codex_app_server_args_with_settings_skips_injection_on_user_override() {
        let s = settings_with(vec!["lazy-senior-dev"]);
        // User-supplied codex_args contain a developer_instructions= override.
        // After shell-style parsing the override value is "user" and the
        // trailing word "override" is a separate argv token; the production
        // parser (parse_codex_args / shell-words) splits on whitespace.
        let args = build_codex_app_server_args_with_settings(
            Some("-c developer_instructions=user override"),
            primary_no_hint(),
            Some(&s),
        )
        .unwrap();
        // There should be exactly one developer_instructions= arg and it
        // must contain the user override text (not the curated body).
        let count = args
            .iter()
            .filter(|a| a.starts_with("developer_instructions="))
            .count();
        assert_eq!(count, 1, "user override should not be duplicated");
        let arg = args
            .iter()
            .find(|a| a.starts_with("developer_instructions="))
            .unwrap();
        assert!(arg.contains("user"), "got arg: {}", arg);
        assert!(
            !arg.contains("lazy-senior-dev"),
            "curated must not be appended when user override exists"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[cfg(unix)]
    use std::os::unix::fs::{symlink, PermissionsExt};

    #[test]
    fn npm_prefix_resolution_uses_bin_on_unix() {
        #[cfg(not(windows))]
        {
            let resolved =
                resolve_npm_global_bin_dir_from_prefix("/Users/demo/.npm-global").unwrap();
            assert_eq!(resolved, PathBuf::from("/Users/demo/.npm-global/bin"));
        }
    }

    #[test]
    fn npm_prefix_resolution_ignores_empty_values() {
        assert!(resolve_npm_global_bin_dir_from_prefix("").is_none());
        assert!(resolve_npm_global_bin_dir_from_prefix("undefined").is_none());
        assert!(resolve_npm_global_bin_dir_from_prefix("null").is_none());
    }

    #[test]
    fn launch_context_uses_command_wrapper_only_for_windows_launch_wrappers() {
        let direct = CodexLaunchContext {
            resolved_bin: "codex".to_string(),
            wrapper_kind: wrapper_kind_for_binary("codex"),
            path_env: None,
        };
        let cmd_wrapper = CodexLaunchContext {
            resolved_bin: "C:/Users/demo/AppData/Roaming/npm/codex.cmd".to_string(),
            wrapper_kind: wrapper_kind_for_binary("C:/Users/demo/AppData/Roaming/npm/codex.cmd"),
            path_env: None,
        };
        let bat_wrapper = CodexLaunchContext {
            resolved_bin: "C:/tools/codex.bat".to_string(),
            wrapper_kind: wrapper_kind_for_binary("C:/tools/codex.bat"),
            path_env: None,
        };
        let ps1_wrapper = CodexLaunchContext {
            resolved_bin: "C:/tools/codex.ps1".to_string(),
            wrapper_kind: wrapper_kind_for_binary("C:/tools/codex.ps1"),
            path_env: None,
        };
        let exe_binary = CodexLaunchContext {
            resolved_bin: "C:/tools/codex.exe".to_string(),
            wrapper_kind: wrapper_kind_for_binary("C:/tools/codex.exe"),
            path_env: None,
        };

        assert!(!launch_context_uses_command_wrapper(&direct));
        assert!(launch_context_uses_command_wrapper(&cmd_wrapper));
        assert!(launch_context_uses_command_wrapper(&bat_wrapper));
        assert!(launch_context_uses_command_wrapper(&ps1_wrapper));
        assert!(!launch_context_uses_command_wrapper(&exe_binary));
    }

    #[test]
    fn prefer_windows_executable_variant_prefers_stable_wrapper_before_ps1() {
        let root =
            std::env::temp_dir().join(format!("ccgui-wrapper-preference-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("create temp dir");
        let base = root.join("claude");
        let cmd_path = root.join("claude.cmd");
        let exe_path = root.join("claude.exe");
        let ps1_path = root.join("claude.ps1");
        std::fs::write(&ps1_path, "").expect("write ps1");
        std::fs::write(&exe_path, "").expect("write exe");
        std::fs::write(&cmd_path, "").expect("write cmd");

        assert_eq!(prefer_windows_executable_variant(base), cmd_path);
        assert_eq!(
            prefer_windows_executable_variant(ps1_path.clone()),
            ps1_path
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn resolve_codex_binary_does_not_fallback_to_claude_name() {
        let launch_context = resolve_codex_launch_context(None);
        let file_name = Path::new(&launch_context.resolved_bin)
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(launch_context.resolved_bin.as_str())
            .to_ascii_lowercase();
        assert_ne!(file_name, "claude");
    }

    #[tokio::test]
    async fn check_codex_installation_missing_error_is_codex_specific() {
        let error = check_codex_installation(Some("/definitely/missing/codex".to_string()))
            .await
            .expect_err("missing custom Codex binary should fail");

        assert!(error.contains("Codex CLI"));
        assert!(!error.contains("Claude Code"));
    }

    #[test]
    fn wrapper_compatibility_retry_is_platform_gated() {
        let direct = CodexLaunchContext {
            resolved_bin: "codex".to_string(),
            wrapper_kind: wrapper_kind_for_binary("codex"),
            path_env: None,
        };
        let cmd_wrapper = CodexLaunchContext {
            resolved_bin: "C:/Users/demo/AppData/Roaming/npm/codex.cmd".to_string(),
            wrapper_kind: wrapper_kind_for_binary("C:/Users/demo/AppData/Roaming/npm/codex.cmd"),
            path_env: None,
        };

        assert!(!can_retry_wrapper_compatibility_launch(&direct));
        #[cfg(windows)]
        assert!(can_retry_wrapper_compatibility_launch(&cmd_wrapper));
        #[cfg(not(windows))]
        assert!(!can_retry_wrapper_compatibility_launch(&cmd_wrapper));
    }

    #[test]
    fn app_server_primary_args_append_internal_spec_hint() {
        let args = build_codex_app_server_args(
            Some("--profile work"),
            CodexAppServerLaunchOptions::primary_for_platform(false),
        )
        .expect("build args");

        assert_eq!(args.first().map(String::as_str), Some("--profile"));
        assert_eq!(args.get(1).map(String::as_str), Some("work"));
        assert!(args.iter().any(|arg| arg == "-c"));
        assert!(args.iter().any(|arg| {
            arg.starts_with("developer_instructions=\"") && arg.contains("writableRoots")
        }));
        assert_eq!(args.last().map(String::as_str), Some("app-server"));
    }

    #[test]
    fn app_server_primary_args_respect_user_instruction_override() {
        let args = build_codex_app_server_args(
            Some(r#"-c developer_instructions="follow workspace policy""#),
            CodexAppServerLaunchOptions::primary_for_platform(false),
        )
        .expect("build args");

        assert_eq!(args.iter().filter(|arg| arg.as_str() == "-c").count(), 1);
        assert!(!args.iter().any(|arg| arg.contains("writableRoots")));
        assert_eq!(args.last().map(String::as_str), Some("app-server"));
    }

    #[test]
    fn app_server_wrapper_retry_args_skip_internal_spec_hint_but_keep_user_args() {
        let args = build_codex_app_server_args(
            Some("--profile work --sandbox read-only"),
            CodexAppServerLaunchOptions::wrapper_compatibility_retry(),
        )
        .expect("build args");

        assert_eq!(
            args,
            vec![
                "--profile".to_string(),
                "work".to_string(),
                "--sandbox".to_string(),
                "read-only".to_string(),
                "app-server".to_string(),
            ]
        );
    }

    #[test]
    fn app_server_session_hooks_disabled_args_keep_primary_shape() {
        let options = CodexAppServerLaunchOptions::session_hooks_disabled_for_platform(false);
        let args =
            build_codex_app_server_args(Some("--profile work"), options).expect("build args");

        assert_eq!(
            options.launch_mode,
            CodexAppServerLaunchMode::SessionHooksDisabled
        );
        assert_eq!(options.hide_console, true);
        assert!(args.iter().any(|arg| {
            arg.starts_with("developer_instructions=\"") && arg.contains("writableRoots")
        }));
        assert_eq!(args.last().map(String::as_str), Some("app-server"));
    }

    #[test]
    fn app_server_windows_session_hooks_disabled_omits_generated_instructions_argv() {
        let options = CodexAppServerLaunchOptions::session_hooks_disabled_for_platform(true);
        let args =
            build_codex_app_server_args(Some("--profile work"), options).expect("build args");

        assert_eq!(
            options.launch_mode,
            CodexAppServerLaunchMode::SessionHooksDisabled
        );
        assert_eq!(
            options.generated_instructions_transport,
            CodexGeneratedInstructionsTransport::OmitForWrapperRecovery
        );
        assert!(!args.iter().any(|arg| arg.contains("writableRoots")));
        assert_eq!(args.last().map(String::as_str), Some("app-server"));
    }

    #[test]
    fn app_server_session_hooks_disabled_wrapper_retry_preserves_hook_safe_mode() {
        let options = CodexAppServerLaunchOptions::wrapper_compatibility_retry_for_mode(
            CodexAppServerLaunchMode::SessionHooksDisabled,
        );
        let args =
            build_codex_app_server_args(Some("--profile work"), options).expect("build args");

        assert_eq!(
            options.launch_mode,
            CodexAppServerLaunchMode::SessionHooksDisabled
        );
        assert_eq!(
            options.generated_instructions_transport,
            CodexGeneratedInstructionsTransport::OmitForWrapperRecovery
        );
        assert!(!args.iter().any(|arg| arg.contains("writableRoots")));
        assert_eq!(args.last().map(String::as_str), Some("app-server"));
    }

    #[test]
    fn custom_bin_parent_resolution_handles_macos_and_windows_style_paths() {
        let macos_paths = build_seed_search_paths(Some("/Users/demo/.npm-global/bin/codex"), &[]);
        assert!(macos_paths
            .iter()
            .any(|path| path == Path::new("/Users/demo/.npm-global/bin")));

        let windows_paths =
            build_seed_search_paths(Some("C:/Users/demo/AppData/Roaming/npm/codex.cmd"), &[]);
        assert!(windows_paths.iter().any(|path| {
            path.to_string_lossy()
                .replace('\\', "/")
                .ends_with("C:/Users/demo/AppData/Roaming/npm")
        }));
        assert_eq!(
            wrapper_kind_for_binary(r"C:\Users\demo\AppData\Roaming\npm\codex.cmd"),
            "cmd-wrapper"
        );
        assert_eq!(
            wrapper_kind_for_binary(r"C:\Users\demo\AppData\Roaming\npm\codex.exe"),
            "exe-binary"
        );
        assert_eq!(
            wrapper_kind_for_binary(r"C:\Users\demo\AppData\Roaming\npm\codex.ps1"),
            "ps1-wrapper"
        );
    }

    #[test]
    fn generic_cli_path_env_keeps_custom_parent_and_codex_compatibility() {
        let custom_bin = "/Users/demo/.npm-global/bin/jdtls";
        let generic_path = build_cli_path_env(Some(custom_bin)).expect("generic PATH");
        let paths = env::split_paths(&OsString::from(&generic_path)).collect::<Vec<_>>();

        assert!(paths
            .iter()
            .any(|path| path == Path::new("/Users/demo/.npm-global/bin")));
        assert_eq!(build_codex_path_env(Some(custom_bin)), Some(generic_path));
    }

    #[test]
    fn bare_cli_name_does_not_add_an_empty_path_entry() {
        let paths = build_seed_search_paths(Some("jdtls"), &[]);

        assert!(paths.iter().all(|path| !path.as_os_str().is_empty()));
    }

    #[test]
    fn proxy_diagnosis_reports_redacted_process_proxy_evidence() {
        let mut snapshot = serde_json::Map::new();
        snapshot.insert(
            "HTTPS_PROXY".to_string(),
            json!(redact_proxy_env_value(
                "HTTPS_PROXY",
                "https://user:secret@proxy.example:8080".to_string()
            )),
        );
        snapshot.insert("NO_PROXY".to_string(), json!("localhost,127.0.0.1"));

        let diagnosis = build_proxy_diagnosis(&snapshot);

        assert_eq!(diagnosis["category"], "proxyConfigured");
        assert_eq!(diagnosis["primarySource"], "processEnv");
        assert_eq!(
            snapshot["HTTPS_PROXY"],
            "https://[redacted]@proxy.example:8080"
        );
        assert_eq!(snapshot["NO_PROXY"], "localhost,127.0.0.1");
    }

    #[test]
    fn environment_diagnosis_classifies_gui_path_drift() {
        let debug_info = json!({
            "resolvedBinaryPath": "/opt/homebrew/bin/codex",
            "codexFound": "/opt/homebrew/bin/codex",
            "codexStandardWhich": null,
        });

        let diagnosis = build_engine_environment_diagnosis("codex", None, &debug_info);

        assert_eq!(diagnosis["category"], "environmentDrift");
        assert_eq!(diagnosis["missedByGuiPath"], true);
        assert_eq!(diagnosis["fallbackBinary"], "/opt/homebrew/bin/codex");
    }

    #[test]
    fn environment_diagnosis_prioritizes_missing_configured_path() {
        let debug_info = json!({
            "resolvedBinaryPath": "/opt/homebrew/bin/codex",
            "codexFound": "/opt/homebrew/bin/codex",
            "codexStandardWhich": null,
        });

        let diagnosis = build_engine_environment_diagnosis(
            "codex",
            Some("/definitely/missing/codex"),
            &debug_info,
        );

        assert_eq!(diagnosis["category"], "configuredPathMissing");
        assert_eq!(diagnosis["configuredPathMissing"], true);
    }

    #[test]
    fn endpoint_failure_classifier_maps_actionable_categories() {
        assert_eq!(
            classify_endpoint_failure(Some("Timed out while checking endpoint")),
            "timeout"
        );
        assert_eq!(
            classify_endpoint_failure(Some("DNS lookup failed")),
            "dnsFailure"
        );
        assert_eq!(
            classify_endpoint_failure(Some("TLS certificate rejected")),
            "tlsFailure"
        );
        assert_eq!(
            classify_endpoint_failure(Some("Proxy returned 407")),
            "proxyUnreachable"
        );
        assert_eq!(
            classify_endpoint_failure(Some("HTTP status 500")),
            "httpStatus"
        );
    }

    #[test]
    fn app_server_spawn_args_preserve_shell_sensitive_values_as_arg_array() {
        let launch_context = CodexLaunchContext {
            resolved_bin: "codex".to_string(),
            wrapper_kind: "direct",
            path_env: None,
        };
        let mut command = build_codex_command_from_launch_context(&launch_context, true);
        apply_codex_app_server_args(
            &mut command,
            Some(r#"--cd "C:/Users/demo/project with spaces" -c model="gpt-5" --note "a && b; c""#),
            CodexAppServerLaunchOptions::wrapper_compatibility_retry(),
        )
        .expect("apply app-server args");

        let args = command
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert_eq!(
            args,
            vec![
                "--cd".to_string(),
                "C:/Users/demo/project with spaces".to_string(),
                "-c".to_string(),
                "model=gpt-5".to_string(),
                "--note".to_string(),
                "a && b; c".to_string(),
                "app-server".to_string(),
            ]
        );
    }

    #[cfg(unix)]
    fn write_unix_test_cli(script_body: &str) -> PathBuf {
        let unique = format!(
            "ccgui-cli-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let dir = env::temp_dir().join(unique);
        fs::create_dir_all(&dir).expect("create temp cli dir");
        let script_path = dir.join("codex-test-cli");
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
    async fn check_cli_binary_accepts_help_fallback_when_version_fails() {
        let script_path = write_unix_test_cli(
            "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then\n  echo 'broken version' >&2\n  exit 1\nfi\nif [ \"$1\" = \"--help\" ]; then\n  echo 'usage'\n  exit 0\nfi\nexit 1\n",
        );

        let result = check_cli_binary(script_path.to_string_lossy().as_ref(), None).await;
        assert_eq!(result.expect("help fallback should pass"), None);

        let _ = fs::remove_file(&script_path);
        let _ = fs::remove_dir_all(script_path.parent().unwrap_or(Path::new("")));
    }

    #[test]
    fn matching_custom_bin_only_applies_to_same_cli_name() {
        assert_eq!(
            matching_custom_bin(Some("/tmp/codex.cmd"), "codex"),
            Some("/tmp/codex.cmd")
        );
        assert_eq!(matching_custom_bin(Some("/tmp/codex.cmd"), "claude"), None);
        assert_eq!(
            matching_custom_bin(Some("/tmp/Claude"), "claude"),
            Some("/tmp/Claude")
        );
        assert_eq!(matching_custom_bin(Some(""), "claude"), None);
    }

    #[test]
    fn windows_extra_search_paths_include_user_local_bin() {
        let paths = build_windows_extra_search_paths(
            Some(Path::new("C:\\Users\\Administrator\\AppData\\Roaming")),
            Some(Path::new("C:\\Users\\Administrator")),
            Some(Path::new("C:\\Users\\Administrator\\AppData\\Local")),
            Some(Path::new("C:\\Program Files")),
            Some(Path::new("C:\\Program Files (x86)")),
        );

        assert!(
            paths
                .iter()
                .any(|path| path.to_string_lossy().replace('/', "\\")
                    == "C:\\Users\\Administrator\\.local\\bin"),
            "expected Windows CLI search paths to include ~/.local/bin"
        );
    }

    #[test]
    fn windows_opencode_cmd_wrapper_is_considered_background_safe() {
        let path = Path::new("C:\\Users\\demo\\AppData\\Roaming\\npm\\opencode.cmd");
        assert!(is_windows_background_safe_opencode_candidate(path));
    }

    #[test]
    fn windows_opencode_cli_exe_in_known_cli_root_is_background_safe() {
        let path = Path::new("C:\\Users\\demo\\.cargo\\bin\\opencode.exe");
        assert!(is_windows_background_safe_opencode_candidate(path));
    }

    #[test]
    fn windows_opencode_launcher_exe_outside_cli_roots_is_rejected() {
        let path = Path::new("C:\\Users\\demo\\AppData\\Local\\Programs\\OpenCode\\opencode.exe");
        assert!(!is_windows_background_safe_opencode_candidate(path));
    }

    #[cfg(unix)]
    #[test]
    fn discover_npm_global_bin_dir_from_npm_uses_reported_prefix_and_finds_codex() {
        let unique = format!(
            "ccgui-npm-prefix-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let root = env::temp_dir().join(unique);
        let fake_npm = root.join("npm");
        let prefix_dir = root.join("custom-prefix");
        let prefix_bin = prefix_dir.join("bin");
        let codex_path = prefix_bin.join("codex");

        fs::create_dir_all(&prefix_bin).expect("create prefix/bin");

        {
            let mut npm_file = fs::File::create(&fake_npm).expect("create fake npm");
            writeln!(
                npm_file,
                "#!/bin/sh\nif [ \"$1\" = \"config\" ] && [ \"$2\" = \"get\" ] && [ \"$3\" = \"prefix\" ]; then\n  printf '{}\\n'\n  exit 0\nfi\nexit 1",
                prefix_dir.to_string_lossy()
            )
            .expect("write fake npm");
        }

        {
            let mut codex_file = fs::File::create(&codex_path).expect("create fake codex");
            writeln!(codex_file, "#!/bin/sh\nexit 0").expect("write fake codex");
        }

        for path in [&fake_npm, &codex_path] {
            let mut permissions = fs::metadata(path)
                .expect("stat fake executable")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(path, permissions).expect("chmod fake executable");
        }

        let resolved = discover_npm_global_bin_dir_from_npm(&[], Some(fake_npm.as_path()))
            .expect("resolve npm prefix");
        assert_eq!(resolved, prefix_bin);

        let joined_paths = env::join_paths([resolved.clone()]).expect("join search paths");
        let cwd = env::current_dir().expect("current dir");
        let found = which::which_in("codex", Some(&joined_paths), &cwd).expect("find codex");
        assert_eq!(found, codex_path);

        let _ = fs::remove_file(&fake_npm);
        let _ = fs::remove_file(&codex_path);
        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn discover_npm_global_bin_dir_prefers_symlinked_npm_runtime() {
        let unique = format!(
            "ccgui-symlinked-npm-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let root = env::temp_dir().join(unique);
        let launcher_bin = root.join("launcher-bin");
        let runtime_bin = root.join("runtime-bin");
        let competing_bin = root.join("competing-bin");
        let expected_prefix = root.join("expected-prefix");
        let competing_prefix = root.join("competing-prefix");
        let runtime_npm = runtime_bin.join("npm");
        let linked_npm = launcher_bin.join("npm");
        let runtime_node = runtime_bin.join("node");
        let competing_node = competing_bin.join("node");
        let npm_cli = runtime_bin.join("../lib/node_modules/npm/bin/npm-cli.js");

        for directory in [
            launcher_bin.as_path(),
            runtime_bin.as_path(),
            competing_bin.as_path(),
            npm_cli.parent().expect("npm cli parent"),
        ] {
            fs::create_dir_all(directory).expect("create test bin directory");
        }
        fs::write(&npm_cli, "#!/usr/bin/env node\n").expect("write npm cli");
        fs::write(
            &runtime_node,
            format!("#!/bin/sh\nprintf '{}\\n'\n", expected_prefix.display()),
        )
        .expect("write matching node runtime");
        fs::write(
            &competing_node,
            format!("#!/bin/sh\nprintf '{}\\n'\n", competing_prefix.display()),
        )
        .expect("write competing node runtime");

        for executable in [&npm_cli, &runtime_node, &competing_node] {
            let mut permissions = fs::metadata(executable)
                .expect("stat test executable")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(executable, permissions).expect("chmod test executable");
        }
        symlink("../lib/node_modules/npm/bin/npm-cli.js", &runtime_npm)
            .expect("create runtime npm symlink");
        symlink(&runtime_npm, &linked_npm).expect("create launcher npm symlink");

        let resolved = discover_npm_global_bin_dir_from_npm(
            std::slice::from_ref(&competing_bin),
            Some(linked_npm.as_path()),
        )
        .expect("resolve symlinked npm prefix");

        assert_eq!(resolved, expected_prefix.join("bin"));
        let probe_paths = build_npm_probe_paths(&[competing_bin], &linked_npm);
        assert_eq!(probe_paths.first(), Some(&launcher_bin));
        assert!(probe_paths.iter().any(|path| path == &runtime_bin));

        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn npm_launcher_discovery_includes_secondary_runtime_provider() {
        let unique = format!(
            "ccgui-multi-npm-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let root = env::temp_dir().join(unique);
        let primary_bin = root.join("primary/bin");
        let secondary_launcher_bin = root.join("secondary-launcher");
        let secondary_runtime_bin = root.join("secondary-runtime/bin");
        let secondary_npm_cli = root.join("secondary-runtime/lib/npm/npm-cli.js");
        let secondary_runtime_npm = secondary_runtime_bin.join("npm");
        let secondary_launcher_npm = secondary_launcher_bin.join("npm");
        let pyright = secondary_runtime_bin.join("pyright-langserver");

        for directory in [
            primary_bin.as_path(),
            secondary_launcher_bin.as_path(),
            secondary_runtime_bin.as_path(),
            secondary_npm_cli
                .parent()
                .expect("secondary npm cli parent"),
        ] {
            fs::create_dir_all(directory).expect("create multi-runtime test directory");
        }
        fs::write(primary_bin.join("npm"), "#!/bin/sh\nexit 0\n").expect("write primary npm");
        fs::write(&secondary_npm_cli, "#!/usr/bin/env node\n").expect("write secondary npm cli");
        fs::write(&pyright, "#!/bin/sh\nexit 0\n").expect("write secondary provider");
        symlink("../lib/npm/npm-cli.js", &secondary_runtime_npm)
            .expect("create secondary runtime npm symlink");
        symlink(&secondary_runtime_npm, &secondary_launcher_npm)
            .expect("create secondary launcher npm symlink");

        for executable in [primary_bin.join("npm"), secondary_npm_cli, pyright.clone()] {
            let mut permissions = fs::metadata(&executable)
                .expect("stat multi-runtime executable")
                .permissions();
            permissions.set_mode(0o755);
            fs::set_permissions(&executable, permissions).expect("chmod multi-runtime executable");
        }

        let discovered = discover_npm_launcher_search_paths(&[
            primary_bin.clone(),
            secondary_launcher_bin.clone(),
        ]);
        assert!(discovered.iter().any(|path| path == &primary_bin));
        assert!(discovered.iter().any(|path| path == &secondary_runtime_bin));

        let joined_paths = env::join_paths(&discovered).expect("join discovered npm paths");
        let cwd = env::current_dir().expect("current dir");
        let found = which::which_in("pyright-langserver", Some(&joined_paths), &cwd)
            .expect("find provider from secondary runtime");
        assert_eq!(found, pyright);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn npm_launcher_names_cover_unix_and_windows_wrappers() {
        assert_eq!(npm_launcher_file_names(false), &["npm"]);
        assert_eq!(
            npm_launcher_file_names(true),
            &["npm.cmd", "npm.exe", "npm.bat", "npm.ps1", "npm"]
        );
    }
}
