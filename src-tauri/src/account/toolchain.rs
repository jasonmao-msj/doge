use crate::backend::app_server::{build_cli_path_env, find_cli_binary};
use crate::types::AppSettings;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const BUNDLED_ENGINE_RESOURCE_DIR: &str = "bundled-engines/current";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ToolchainChoice {
    Bundled,
    External,
}

impl ToolchainChoice {
    pub(super) fn parse(value: Option<&str>) -> Result<Option<Self>, ToolchainError> {
        match value {
            None => Ok(None),
            Some("bundled") => Ok(Some(Self::Bundled)),
            Some("external") => Ok(Some(Self::External)),
            Some(_) => Err(ToolchainError::InvalidChoice),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum ToolchainError {
    UnsupportedEngine,
    InvalidChoice,
    BundleUnavailable,
    BundleInvalid,
    BundleVerificationFailed,
}

impl ToolchainError {
    pub(super) fn code(&self) -> &'static str {
        match self {
            Self::UnsupportedEngine => "capabilityUnavailable",
            Self::InvalidChoice => "validationRejected",
            Self::BundleUnavailable | Self::BundleInvalid => "engineBundleUnavailable",
            Self::BundleVerificationFailed => "engineBundleVerificationFailed",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ToolchainResolution {
    pub(super) engine_id: String,
    pub(super) status: &'static str,
    pub(super) bundled_version: String,
    pub(super) external_version: Option<String>,
    pub(super) selected_source: Option<&'static str>,
    #[serde(skip)]
    pub(super) selected_binary: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeManifest {
    schema_version: u64,
    architectures: HashMap<String, RuntimeArchitecture>,
}

#[derive(Debug, Deserialize)]
struct RuntimeArchitecture {
    engines: HashMap<String, RuntimeEngine>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeEngine {
    version: String,
    executable: String,
    archive_sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct SemanticVersion(u64, u64, u64);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SourceDecision {
    Bundled,
    External,
    ChoiceRequired,
}

pub(super) async fn resolve(
    resource_dir: &Path,
    engine_id: &str,
    choice: Option<ToolchainChoice>,
    settings: &AppSettings,
) -> Result<ToolchainResolution, ToolchainError> {
    if !matches!(engine_id, "codex" | "claude-code" | "kimi") {
        return Err(ToolchainError::UnsupportedEngine);
    }
    let bundle_root = resource_dir.join(BUNDLED_ENGINE_RESOURCE_DIR);
    let manifest_path = bundle_root.join("manifest.json");
    let raw =
        std::fs::read_to_string(&manifest_path).map_err(|_| ToolchainError::BundleUnavailable)?;
    let manifest: RuntimeManifest =
        serde_json::from_str(&raw).map_err(|_| ToolchainError::BundleInvalid)?;
    if manifest.schema_version != 1 {
        return Err(ToolchainError::BundleInvalid);
    }
    let architecture = runtime_architecture();
    let bundled = manifest
        .architectures
        .get(architecture)
        .and_then(|entry| entry.engines.get(engine_id))
        .ok_or(ToolchainError::BundleUnavailable)?;
    if parse_semver(&bundled.version).is_none()
        || bundled.archive_sha256.len() != 64
        || !bundled
            .archive_sha256
            .bytes()
            .all(|value| value.is_ascii_hexdigit())
    {
        return Err(ToolchainError::BundleInvalid);
    }
    let bundled_binary = safe_bundled_executable(&bundle_root, &bundled.executable)?;
    let bundled_version_text = verify_binary(&bundled_binary)
        .await
        .map_err(|_| ToolchainError::BundleVerificationFailed)?;
    if parse_semver(&bundled_version_text) != parse_semver(&bundled.version) {
        return Err(ToolchainError::BundleVerificationFailed);
    }

    let external_binary = external_binary(engine_id, settings);
    let external_verified = match external_binary {
        Some(path) => verify_binary(&path)
            .await
            .ok()
            .map(|version| (path, version)),
        None => None,
    };
    let decision = decide_source(
        parse_semver(&bundled.version),
        external_verified
            .as_ref()
            .and_then(|(_, version)| parse_semver(version)),
        external_verified.is_some(),
        choice,
    );
    let external_version = external_verified
        .as_ref()
        .and_then(|(_, version)| parse_semver(version))
        .map(|version| format!("{}.{}.{}", version.0, version.1, version.2));
    let (status, selected_source, selected_binary) = match decision {
        SourceDecision::Bundled => ("ready", Some("bundled"), Some(bundled_binary)),
        SourceDecision::External => (
            "ready",
            Some("external"),
            external_verified.map(|(path, _)| path),
        ),
        SourceDecision::ChoiceRequired => ("choiceRequired", None, None),
    };
    Ok(ToolchainResolution {
        engine_id: engine_id.to_string(),
        status,
        bundled_version: bundled.version.clone(),
        external_version,
        selected_source,
        selected_binary,
    })
}

fn safe_bundled_executable(
    root: &Path,
    relative_executable: &str,
) -> Result<PathBuf, ToolchainError> {
    if relative_executable.trim().is_empty() || Path::new(relative_executable).is_absolute() {
        return Err(ToolchainError::BundleInvalid);
    }
    let canonical_root = root
        .canonicalize()
        .map_err(|_| ToolchainError::BundleUnavailable)?;
    let candidate = root.join(relative_executable);
    let canonical_candidate = candidate
        .canonicalize()
        .map_err(|_| ToolchainError::BundleUnavailable)?;
    if !canonical_candidate.starts_with(&canonical_root) || !canonical_candidate.is_file() {
        return Err(ToolchainError::BundleInvalid);
    }
    Ok(canonical_candidate)
}

fn external_binary(engine_id: &str, settings: &AppSettings) -> Option<PathBuf> {
    match engine_id {
        "codex" => find_cli_binary("codex", settings.codex_bin.as_deref()),
        "claude-code" => find_cli_binary("claude", settings.claude_bin.as_deref()),
        "kimi" => find_cli_binary("kimi", settings.kimi_bin.as_deref()),
        _ => None,
    }
}

async fn verify_binary(path: &Path) -> Result<String, ()> {
    let raw = path.to_string_lossy().to_string();
    let path_env = build_cli_path_env(Some(&raw));
    crate::engine::status::probe_engine_version_text(&raw, path_env.as_ref())
        .await
        .map_err(|_| ())
}

fn decide_source(
    bundled_version: Option<SemanticVersion>,
    external_version: Option<SemanticVersion>,
    external_verified: bool,
    choice: Option<ToolchainChoice>,
) -> SourceDecision {
    if !external_verified {
        return SourceDecision::Bundled;
    }
    match choice {
        Some(ToolchainChoice::Bundled) => SourceDecision::Bundled,
        Some(ToolchainChoice::External) => SourceDecision::External,
        None => match (bundled_version, external_version) {
            (Some(bundled), Some(external)) if external >= bundled => SourceDecision::External,
            _ => SourceDecision::ChoiceRequired,
        },
    }
}

fn parse_semver(raw: &str) -> Option<SemanticVersion> {
    let bytes = raw.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if !bytes[index].is_ascii_digit() {
            index += 1;
            continue;
        }
        let major_start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        if bytes.get(index) != Some(&b'.') {
            continue;
        }
        let major = raw[major_start..index].parse().ok()?;
        index += 1;
        let minor_start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        if minor_start == index || bytes.get(index) != Some(&b'.') {
            continue;
        }
        let minor = raw[minor_start..index].parse().ok()?;
        index += 1;
        let patch_start = index;
        while index < bytes.len() && bytes[index].is_ascii_digit() {
            index += 1;
        }
        if patch_start == index {
            continue;
        }
        let patch = raw[patch_start..index].parse().ok()?;
        return Some(SemanticVersion(major, minor, patch));
    }
    None
}

fn runtime_architecture() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "aarch64",
        _ => "x86_64",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn write_version_binary(path: &Path, version: &str) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(path.parent().expect("binary parent"))
            .expect("create binary parent");
        std::fs::write(path, format!("#!/bin/sh\nprintf '%s\\n' '{version}'\n"))
            .expect("write version binary");
        let mut permissions = std::fs::metadata(path)
            .expect("binary metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(path, permissions).expect("make binary executable");
    }

    #[test]
    fn version_choice_matrix_preserves_user_install() {
        let bundled = parse_semver("0.147.0");
        assert_eq!(
            decide_source(bundled, None, false, None),
            SourceDecision::Bundled
        );
        assert_eq!(
            decide_source(bundled, parse_semver("0.147.0"), true, None),
            SourceDecision::External
        );
        assert_eq!(
            decide_source(bundled, parse_semver("0.148.0"), true, None),
            SourceDecision::External
        );
        assert_eq!(
            decide_source(bundled, parse_semver("0.146.0"), true, None),
            SourceDecision::ChoiceRequired
        );
        assert_eq!(
            decide_source(
                bundled,
                parse_semver("0.146.0"),
                true,
                Some(ToolchainChoice::Bundled)
            ),
            SourceDecision::Bundled
        );
        assert_eq!(
            decide_source(
                bundled,
                parse_semver("0.146.0"),
                true,
                Some(ToolchainChoice::External)
            ),
            SourceDecision::External
        );
    }

    #[test]
    fn parses_noisy_engine_versions() {
        assert_eq!(
            parse_semver("codex-cli 0.147.0"),
            Some(SemanticVersion(0, 147, 0))
        );
        assert_eq!(
            parse_semver("2.1.233 (Claude Code)"),
            Some(SemanticVersion(2, 1, 233))
        );
        assert_eq!(parse_semver("unknown"), None);
    }

    #[test]
    fn rejects_unknown_toolchain_choices() {
        assert_eq!(
            ToolchainChoice::parse(Some("system")),
            Err(ToolchainError::InvalidChoice)
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn resolver_requires_choice_for_an_older_external_engine_without_disclosing_paths() {
        let root = std::env::temp_dir().join(format!("doge-toolchain-{}", uuid::Uuid::new_v4()));
        let bundle_root = root.join(BUNDLED_ENGINE_RESOURCE_DIR);
        let bundled_relative = format!("{}/codex/bin/codex", runtime_architecture());
        let bundled_binary = bundle_root.join(&bundled_relative);
        let external_binary = root.join("external/codex");
        write_version_binary(&bundled_binary, "codex-cli 9.0.0");
        write_version_binary(&external_binary, "codex-cli 8.0.0");
        std::fs::write(
            bundle_root.join("manifest.json"),
            serde_json::to_vec(&serde_json::json!({
                "schemaVersion": 1,
                "architectures": {
                    runtime_architecture(): {
                        "engines": {
                            "codex": {
                                "version": "9.0.0",
                                "executable": bundled_relative,
                                "archiveSha256": "a".repeat(64)
                            }
                        }
                    }
                }
            }))
            .expect("serialize manifest"),
        )
        .expect("write manifest");
        let mut settings = AppSettings::default();
        settings.codex_bin = Some(external_binary.to_string_lossy().to_string());

        let inspected = resolve(&root, "codex", None, &settings)
            .await
            .expect("inspect toolchain");
        assert_eq!(inspected.status, "choiceRequired");
        assert_eq!(inspected.external_version.as_deref(), Some("8.0.0"));
        assert!(inspected.selected_binary.is_none());
        let serialized = serde_json::to_string(&inspected).expect("serialize safe view");
        assert!(!serialized.contains(root.to_string_lossy().as_ref()));

        let selected = resolve(&root, "codex", Some(ToolchainChoice::Bundled), &settings)
            .await
            .expect("select bundled engine");
        assert_eq!(selected.selected_source, Some("bundled"));
        assert_eq!(
            selected.selected_binary.as_deref(),
            Some(bundled_binary.canonicalize().unwrap().as_path())
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
