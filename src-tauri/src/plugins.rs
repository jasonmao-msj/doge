use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::app_paths;
use crate::claude_home::resolve_effective_claude_home;

const MANIFEST_FILE_NAME: &str = "plugin.json";
const MAX_MANIFEST_SIZE_BYTES: u64 = 256 * 1024;
const SUPPORTED_MANIFEST_VERSION: u32 = 1;
const GIT_CLONE_TIMEOUT_SECS: u64 = 180;
const INSTALL_STAGING_PREFIX: &str = ".staging-";
const SKILL_COPY_SENTINEL_FILE: &str = ".ccgui-plugin-skill";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginSkillCapability {
    pub entry: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginGlossaryCapability {
    pub entry: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginViewerCapability {
    pub file_pattern: String,
    pub action: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginCapabilities {
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill: Option<PluginSkillCapability>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewer: Option<PluginViewerCapability>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub glossary: Option<PluginGlossaryCapability>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub manifest_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub capabilities: PluginCapabilities,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub manifest: PluginManifest,
    pub install_path: String,
    pub skill_linked: bool,
}

fn plugins_dir() -> Result<PathBuf, String> {
    app_paths::plugins_dir().map_err(|error| format!("Cannot determine plugins dir: {error}"))
}

fn claude_skills_dir() -> Option<PathBuf> {
    resolve_effective_claude_home(None).map(|home| home.join("skills"))
}

fn is_valid_plugin_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
        && !id.starts_with('-')
        && !id.ends_with('-')
}

fn read_manifest_in_dir(dir: &Path) -> Result<PluginManifest, String> {
    let manifest_path = dir.join(MANIFEST_FILE_NAME);
    let metadata = fs::metadata(&manifest_path)
        .map_err(|_| format!("插件缺少 {MANIFEST_FILE_NAME}（每个插件必须自带 manifest）"))?;
    if metadata.len() > MAX_MANIFEST_SIZE_BYTES {
        return Err(format!(
            "{MANIFEST_FILE_NAME} exceeds size limit ({} bytes)",
            MAX_MANIFEST_SIZE_BYTES
        ));
    }
    let raw = fs::read_to_string(&manifest_path)
        .map_err(|error| format!("Failed to read {MANIFEST_FILE_NAME}: {error}"))?;
    let manifest: PluginManifest = serde_json::from_str(&raw)
        .map_err(|error| format!("Invalid {MANIFEST_FILE_NAME}: {error}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    if manifest.manifest_version != SUPPORTED_MANIFEST_VERSION {
        return Err(format!(
            "Unsupported manifestVersion {} (expected {})",
            manifest.manifest_version, SUPPORTED_MANIFEST_VERSION
        ));
    }
    if !is_valid_plugin_id(&manifest.id) {
        return Err(format!(
            "Invalid plugin id `{}` (expected lowercase letters, digits and dashes)",
            manifest.id
        ));
    }
    if manifest.name.trim().is_empty() || manifest.version.trim().is_empty() {
        return Err("Plugin name and version must not be empty".to_string());
    }
    if let Some(skill) = &manifest.capabilities.skill {
        let entry = skill.entry.trim();
        if entry.is_empty() || entry.contains("..") || Path::new(entry).is_absolute() {
            return Err("capabilities.skill.entry must be a relative path".to_string());
        }
    }
    if let Some(viewer) = &manifest.capabilities.viewer {
        if viewer.file_pattern.trim().is_empty() {
            return Err("capabilities.viewer.filePattern must not be empty".to_string());
        }
        if viewer.action != "html-preview" {
            return Err(format!(
                "Unsupported capabilities.viewer.action `{}`",
                viewer.action
            ));
        }
    }
    if let Some(glossary) = &manifest.capabilities.glossary {
        let entry = glossary.entry.trim();
        if entry.is_empty() || entry.contains("..") || Path::new(entry).is_absolute() {
            return Err("capabilities.glossary.entry must be a relative path".to_string());
        }
        if !entry.ends_with(".json") {
            return Err("capabilities.glossary.entry must be a .json file".to_string());
        }
    }
    Ok(())
}

fn skill_link_state(skills_dir: &Path, plugins_root: &Path, plugin_id: &str) -> bool {
    let link_path = skills_dir.join(plugin_id);
    owned_skill_entry_kind(&link_path, plugins_root, plugin_id).is_some()
}

#[derive(Debug, PartialEq)]
enum OwnedSkillEntry {
    Symlink,
    Copy,
}

/// A `~/.claude/skills/<id>` entry is "ours" only when it is a symlink into the
/// plugins root, or a copied dir carrying our sentinel — user-authored skill
/// dirs with the same name must never be touched.
fn owned_skill_entry_kind(
    link_path: &Path,
    plugins_root: &Path,
    plugin_id: &str,
) -> Option<OwnedSkillEntry> {
    let metadata = fs::symlink_metadata(link_path).ok()?;
    if metadata.file_type().is_symlink() {
        let target = fs::read_link(link_path).ok()?;
        let resolved = if target.is_absolute() {
            target
        } else {
            link_path.parent()?.join(target)
        };
        let expected = plugins_root.join(plugin_id);
        let resolved = resolved.canonicalize().unwrap_or(resolved);
        let expected = expected.canonicalize().unwrap_or(expected);
        if resolved == expected {
            return Some(OwnedSkillEntry::Symlink);
        }
        return None;
    }
    if metadata.is_dir() {
        let sentinel = link_path.join(SKILL_COPY_SENTINEL_FILE);
        let body = fs::read_to_string(sentinel).ok()?;
        if body.trim() == skill_sentinel_body(plugin_id).trim() {
            return Some(OwnedSkillEntry::Copy);
        }
    }
    None
}

fn skill_sentinel_body(plugin_id: &str) -> String {
    format!("managed-by=ccgui\nkind=plugin-skill\nid={plugin_id}\n")
}

fn link_plugin_skill(plugins_root: &Path, plugin_id: &str) -> Result<bool, String> {
    let Some(skills_dir) = claude_skills_dir() else {
        return Ok(false);
    };
    fs::create_dir_all(&skills_dir)
        .map_err(|error| format!("Failed to create {}: {error}", skills_dir.display()))?;
    let link_path = skills_dir.join(plugin_id);
    let target = plugins_root.join(plugin_id);

    match owned_skill_entry_kind(&link_path, plugins_root, plugin_id) {
        Some(OwnedSkillEntry::Symlink) => return Ok(true),
        Some(OwnedSkillEntry::Copy) => {
            fs::remove_dir_all(&link_path)
                .map_err(|error| format!("Failed to refresh skill copy: {error}"))?;
        }
        None => {
            if link_path.exists() || fs::symlink_metadata(&link_path).is_ok() {
                log::warn!(
                    "plugin skill link skipped: {} exists and is not ccgui-managed",
                    link_path.display()
                );
                return Ok(false);
            }
        }
    }

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&target, &link_path)
            .map_err(|error| format!("Failed to link plugin skill: {error}"))?;
        Ok(true)
    }
    #[cfg(not(unix))]
    {
        copy_dir_recursive_excluding_git(&target, &link_path)?;
        fs::write(
            link_path.join(SKILL_COPY_SENTINEL_FILE),
            skill_sentinel_body(plugin_id),
        )
        .map_err(|error| format!("Failed to write skill sentinel: {error}"))?;
        Ok(true)
    }
}

fn unlink_plugin_skill(plugins_root: &Path, plugin_id: &str) -> Result<(), String> {
    let Some(skills_dir) = claude_skills_dir() else {
        return Ok(());
    };
    let link_path = skills_dir.join(plugin_id);
    match owned_skill_entry_kind(&link_path, plugins_root, plugin_id) {
        Some(OwnedSkillEntry::Symlink) => {
            #[cfg(unix)]
            fs::remove_file(&link_path)
                .map_err(|error| format!("Failed to remove skill link: {error}"))?;
            #[cfg(not(unix))]
            {
                let _ = fs::remove_dir_all(&link_path).or_else(|_| fs::remove_file(&link_path));
            }
            Ok(())
        }
        Some(OwnedSkillEntry::Copy) => fs::remove_dir_all(&link_path)
            .map_err(|error| format!("Failed to remove skill copy: {error}")),
        None => Ok(()),
    }
}

fn copy_dir_recursive_excluding_git(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    let entries = fs::read_dir(source).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_name() == ".git" {
            continue;
        }
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_dir() {
            copy_dir_recursive_excluding_git(&source_path, &destination_path)?;
        } else if file_type.is_file() {
            if let Some(parent) = destination_path.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::copy(&source_path, &destination_path)
                .map(|_| ())
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn list_installed_in(plugins_root: &Path) -> Vec<InstalledPlugin> {
    let Ok(entries) = fs::read_dir(plugins_root) else {
        return Vec::new();
    };
    let skills_dir = claude_skills_dir();
    let mut installed = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !metadata.is_dir() {
            continue;
        }
        let dir_name = entry.file_name().to_string_lossy().to_string();
        if dir_name.starts_with('.') {
            continue;
        }
        let manifest = match read_manifest_in_dir(&path) {
            Ok(manifest) => manifest,
            Err(error) => {
                log::warn!("skip plugin dir {}: {error}", path.display());
                continue;
            }
        };
        let skill_linked = manifest.capabilities.skill.is_some()
            && skills_dir
                .as_deref()
                .map(|dir| skill_link_state(dir, plugins_root, &manifest.id))
                .unwrap_or(false);
        installed.push(InstalledPlugin {
            manifest,
            install_path: path.to_string_lossy().to_string(),
            skill_linked,
        });
    }
    installed.sort_by(|a, b| a.manifest.id.cmp(&b.manifest.id));
    installed
}

fn looks_like_git_url(source: &str) -> bool {
    source.starts_with("https://") || source.starts_with("http://") || source.starts_with("git@")
}

async fn clone_repo_into(source: &str, destination: &Path) -> Result<(), String> {
    let git_bin = crate::utils::resolve_git_binary()
        .map_err(|error| format!("Failed to run git: {error}"))?;
    let mut command = crate::utils::async_command(git_bin);
    command
        .args([
            "clone",
            "--depth",
            "1",
            source,
            &destination.to_string_lossy(),
        ])
        .env("PATH", crate::utils::git_env_path())
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let output = tokio::time::timeout(
        Duration::from_secs(GIT_CLONE_TIMEOUT_SECS),
        command.output(),
    )
    .await
    .map_err(|_| format!("git clone timed out after {GIT_CLONE_TIMEOUT_SECS}s"))?
    .map_err(|error| format!("Failed to run git clone: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let detail = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            stderr.trim().to_string()
        };
        return Err(format!("git clone failed: {detail}"));
    }
    Ok(())
}

fn promote_staging_to_install(
    plugins_root: &Path,
    staging_dir: &Path,
    manifest: &PluginManifest,
) -> Result<PathBuf, String> {
    let install_dir = plugins_root.join(&manifest.id);
    if install_dir.exists() {
        unlink_plugin_skill(plugins_root, &manifest.id)?;
        fs::remove_dir_all(&install_dir)
            .map_err(|error| format!("Failed to replace existing plugin: {error}"))?;
    }
    fs::rename(staging_dir, &install_dir)
        .map_err(|error| format!("Failed to finalize plugin install: {error}"))?;
    Ok(install_dir)
}

#[tauri::command]
pub(crate) async fn plugin_list_installed() -> Result<Vec<InstalledPlugin>, String> {
    let plugins_root = plugins_dir()?;
    tokio::task::spawn_blocking(move || list_installed_in(&plugins_root))
        .await
        .map_err(|error| format!("plugin scan failed: {error}"))
}

#[tauri::command]
pub(crate) async fn plugin_install(source: String) -> Result<InstalledPlugin, String> {
    let source = source.trim().to_string();
    if source.is_empty() {
        return Err("Plugin source must not be empty".to_string());
    }
    let plugins_root = plugins_dir()?;
    fs::create_dir_all(&plugins_root)
        .map_err(|error| format!("Failed to create plugins dir: {error}"))?;
    let staging_dir =
        plugins_root.join(format!("{INSTALL_STAGING_PREFIX}{}", uuid::Uuid::new_v4()));

    let stage_result: Result<(), String> = if looks_like_git_url(&source) {
        clone_repo_into(&source, &staging_dir).await
    } else {
        let source_path = PathBuf::from(&source);
        let staging_clone = staging_dir.clone();
        tokio::task::spawn_blocking(move || {
            if !source_path.is_dir() {
                return Err(format!("Local plugin path is not a directory: {source}"));
            }
            copy_dir_recursive_excluding_git(&source_path, &staging_clone)
        })
        .await
        .map_err(|error| format!("plugin copy failed: {error}"))?
    };

    if let Err(error) = stage_result {
        let _ = tokio::fs::remove_dir_all(&staging_dir).await;
        return Err(error);
    }

    let plugins_root_clone = plugins_root.clone();
    let staging_clone = staging_dir.clone();
    let finalize = tokio::task::spawn_blocking(move || -> Result<InstalledPlugin, String> {
        let manifest = read_manifest_in_dir(&staging_clone)?;
        let install_dir =
            promote_staging_to_install(&plugins_root_clone, &staging_clone, &manifest)?;
        let skill_linked = if manifest.capabilities.skill.is_some() {
            link_plugin_skill(&plugins_root_clone, &manifest.id)?
        } else {
            false
        };
        Ok(InstalledPlugin {
            install_path: install_dir.to_string_lossy().to_string(),
            manifest,
            skill_linked,
        })
    })
    .await
    .map_err(|error| format!("plugin install failed: {error}"))?;

    if finalize.is_err() {
        let _ = tokio::fs::remove_dir_all(&staging_dir).await;
    }
    finalize
}

const MAX_GLOSSARY_SIZE_BYTES: u64 = 1024 * 1024;

fn read_glossary_in(plugins_root: &Path, plugin_id: &str) -> Result<String, String> {
    let plugin_dir = plugins_root.join(plugin_id);
    let manifest = read_manifest_in_dir(&plugin_dir)?;
    let Some(glossary) = manifest.capabilities.glossary else {
        return Err(format!(
            "Plugin `{plugin_id}` does not declare a glossary capability"
        ));
    };
    let entry_path = plugin_dir.join(glossary.entry.trim());
    let metadata = fs::metadata(&entry_path)
        .map_err(|_| format!("Glossary entry not found: {}", entry_path.display()))?;
    if metadata.len() > MAX_GLOSSARY_SIZE_BYTES {
        return Err(format!(
            "Glossary entry exceeds size limit ({MAX_GLOSSARY_SIZE_BYTES} bytes)"
        ));
    }
    fs::read_to_string(&entry_path)
        .map_err(|error| format!("Failed to read glossary entry: {error}"))
}

#[tauri::command]
pub(crate) async fn plugin_read_glossary(plugin_id: String) -> Result<String, String> {
    if !is_valid_plugin_id(&plugin_id) {
        return Err(format!("Invalid plugin id `{plugin_id}`"));
    }
    let plugins_root = plugins_dir()?;
    tokio::task::spawn_blocking(move || read_glossary_in(&plugins_root, &plugin_id))
        .await
        .map_err(|error| format!("glossary read failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn plugin_uninstall(plugin_id: String) -> Result<(), String> {
    if !is_valid_plugin_id(&plugin_id) {
        return Err(format!("Invalid plugin id `{plugin_id}`"));
    }
    let plugins_root = plugins_dir()?;
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        unlink_plugin_skill(&plugins_root, &plugin_id)?;
        let install_dir = plugins_root.join(&plugin_id);
        if install_dir.exists() {
            fs::remove_dir_all(&install_dir)
                .map_err(|error| format!("Failed to remove plugin: {error}"))?;
        }
        Ok(())
    })
    .await
    .map_err(|error| format!("plugin uninstall failed: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ccgui-plugins-{tag}-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn write_manifest(dir: &Path, id: &str, capabilities: &str) {
        let body = format!(
            r#"{{
  "manifestVersion": 1,
  "id": "{id}",
  "name": "示例插件",
  "version": "1.0.0",
  "description": "test plugin",
  "capabilities": {capabilities}
}}"#
        );
        fs::write(dir.join(MANIFEST_FILE_NAME), body).expect("write manifest");
    }

    #[test]
    fn validates_plugin_ids() {
        assert!(is_valid_plugin_id("gzh-design"));
        assert!(is_valid_plugin_id("a1"));
        assert!(!is_valid_plugin_id(""));
        assert!(!is_valid_plugin_id("-lead"));
        assert!(!is_valid_plugin_id("trail-"));
        assert!(!is_valid_plugin_id("Upper"));
        assert!(!is_valid_plugin_id("has space"));
        assert!(!is_valid_plugin_id("dot./slip"));
    }

    #[test]
    fn reads_and_validates_manifest() {
        let dir = temp_dir("manifest");
        write_manifest(
            &dir,
            "gzh-design",
            r#"{ "skill": { "entry": "SKILL.md" }, "viewer": { "filePattern": "**/*.gzh.html", "action": "html-preview" } }"#,
        );

        let manifest = read_manifest_in_dir(&dir).expect("manifest parses");
        assert_eq!(manifest.id, "gzh-design");
        assert_eq!(
            manifest
                .capabilities
                .viewer
                .as_ref()
                .map(|v| v.action.as_str()),
            Some("html-preview")
        );

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rejects_missing_manifest_and_bad_entries() {
        let dir = temp_dir("missing");
        assert!(read_manifest_in_dir(&dir).is_err());

        write_manifest(&dir, "ok-id", r#"{ "skill": { "entry": "../escape.md" } }"#);
        assert!(read_manifest_in_dir(&dir)
            .unwrap_err()
            .contains("relative path"));

        write_manifest(
            &dir,
            "ok-id",
            r#"{ "viewer": { "filePattern": "**/*.html", "action": "run-script" } }"#,
        );
        assert!(read_manifest_in_dir(&dir)
            .unwrap_err()
            .contains("Unsupported capabilities.viewer.action"));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn validates_glossary_capability_and_reads_entry() {
        let root = temp_dir("glossary");
        let plugin = root.join("tech-glossary");
        fs::create_dir_all(&plugin).expect("create plugin dir");

        write_manifest(
            &plugin,
            "tech-glossary",
            r#"{ "glossary": { "entry": "../escape.json" } }"#,
        );
        assert!(read_manifest_in_dir(&plugin)
            .unwrap_err()
            .contains("relative path"));

        write_manifest(
            &plugin,
            "tech-glossary",
            r#"{ "glossary": { "entry": "glossary.md" } }"#,
        );
        assert!(read_manifest_in_dir(&plugin)
            .unwrap_err()
            .contains(".json file"));

        write_manifest(
            &plugin,
            "tech-glossary",
            r#"{ "glossary": { "entry": "glossary.json" } }"#,
        );
        assert!(read_glossary_in(&root, "tech-glossary")
            .unwrap_err()
            .contains("not found"));

        let body = r#"{ "version": 1, "terms": [] }"#;
        fs::write(plugin.join("glossary.json"), body).expect("write glossary");
        assert_eq!(
            read_glossary_in(&root, "tech-glossary").expect("read"),
            body
        );

        write_manifest(&plugin, "tech-glossary", "{}");
        assert!(read_glossary_in(&root, "tech-glossary")
            .unwrap_err()
            .contains("does not declare a glossary capability"));

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn lists_only_valid_plugin_dirs() {
        let root = temp_dir("list");
        let good = root.join("good-plugin");
        fs::create_dir_all(&good).expect("create good");
        write_manifest(&good, "good-plugin", "{}");
        fs::create_dir_all(root.join("no-manifest")).expect("create bad");
        fs::create_dir_all(root.join(".staging-abc")).expect("create staging");

        let installed = list_installed_in(&root);
        assert_eq!(installed.len(), 1);
        assert_eq!(installed[0].manifest.id, "good-plugin");

        fs::remove_dir_all(&root).ok();
    }

    #[cfg(unix)]
    #[test]
    fn owned_skill_entry_detects_only_our_symlinks() {
        let plugins_root = temp_dir("own-plugins");
        let skills_dir = temp_dir("own-skills");
        let plugin_dir = plugins_root.join("demo");
        fs::create_dir_all(&plugin_dir).expect("create plugin dir");

        let ours = skills_dir.join("demo");
        std::os::unix::fs::symlink(&plugin_dir, &ours).expect("symlink ours");
        assert_eq!(
            owned_skill_entry_kind(&ours, &plugins_root, "demo"),
            Some(OwnedSkillEntry::Symlink)
        );

        let foreign_target = temp_dir("own-foreign");
        let foreign = skills_dir.join("foreign");
        std::os::unix::fs::symlink(&foreign_target, &foreign).expect("symlink foreign");
        assert_eq!(
            owned_skill_entry_kind(&foreign, &plugins_root, "foreign"),
            None
        );

        let user_dir = skills_dir.join("user-skill");
        fs::create_dir_all(&user_dir).expect("create user skill");
        assert_eq!(
            owned_skill_entry_kind(&user_dir, &plugins_root, "user-skill"),
            None
        );

        for dir in [&plugins_root, &skills_dir, &foreign_target] {
            fs::remove_dir_all(dir).ok();
        }
    }

    #[test]
    fn promote_staging_replaces_existing_install() {
        let root = temp_dir("promote");
        let staging = root.join(".staging-new");
        fs::create_dir_all(&staging).expect("create staging");
        write_manifest(&staging, "demo", "{}");

        let existing = root.join("demo");
        fs::create_dir_all(&existing).expect("create existing");
        fs::write(existing.join("old.txt"), "old").expect("write old");

        let manifest = read_manifest_in_dir(&staging).expect("manifest");
        let install_dir = promote_staging_to_install(&root, &staging, &manifest).expect("promote");

        assert_eq!(install_dir, root.join("demo"));
        assert!(install_dir.join(MANIFEST_FILE_NAME).exists());
        assert!(!install_dir.join("old.txt").exists());
        assert!(!staging.exists());

        fs::remove_dir_all(&root).ok();
    }
}
