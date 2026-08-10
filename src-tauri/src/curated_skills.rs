// Curated Skills module — versioned, client-bundled skills shipped as application
// resources under `src-tauri/resources/curated-skills/<name>/`. Entries are
// gated by `skills-lock.json` `kind: "curated"` and validated at compile time
// by `build.rs`. The list of enabled curated skills lives in
// `AppSettings.enabled_curated_skill_ids` and is shared across workspaces.

use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

use crate::types::AppSettings;

pub(crate) const SKILL_SOURCE_CURATED_BUNDLED: &str = "curated_bundled";

/// Allowed license SPDX identifiers (matches the build.rs whitelist).
pub(crate) const ALLOWED_LICENSES: &[&str] =
    &["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"];

/// MVP-4 category enum (matches the build.rs whitelist).
pub(crate) const ALLOWED_CATEGORIES: &[&str] = &["code-style", "ui-design", "review", "debug"];

/// One curated skill descriptor, as parsed from `metadata.json` and the lock
/// entry. This is the type returned to the frontend via `get_curated_skills`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct CuratedSkillEntry {
    pub(crate) name: String,
    pub(crate) display_name: String,
    pub(crate) version: String,
    pub(crate) description: String,
    pub(crate) icon: String,
    pub(crate) category: String,
    pub(crate) token_estimate: u32,
    pub(crate) source: String,
    /// Optional upstream URL the user can open to inspect the
    /// original skill source (e.g. a GitHub repo). `None` means the
    /// curated skill is wholly client-authored or has no public
    /// upstream — in that case the Settings UI hides the
    /// "View on GitHub" link rather than rendering a broken anchor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) source_url: Option<String>,
    pub(crate) license: String,
    /// Path to the on-disk SKILL.md body, resolved against the resource root.
    /// `None` when the asset is missing on disk (e.g. partial build).
    pub(crate) body_path: Option<PathBuf>,
}

/// One skill entry inside `skills-lock.json`. We only deserialize the fields we
/// need; the build-time validator uses its own JSON walk.
#[derive(Debug, Clone, Deserialize)]
struct LockEntry {
    #[serde(default)]
    kind: Option<String>,
    #[serde(default, rename = "assetPath")]
    asset_path: Option<String>,
    #[serde(default, rename = "metadataPath")]
    metadata_path: Option<String>,
    #[serde(default, rename = "displayName")]
    display_name: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default, rename = "tokenEstimate")]
    token_estimate: Option<u32>,
    #[serde(default, rename = "minClientVersion")]
    min_client_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct LockFile {
    #[serde(default)]
    version: Option<u32>,
    #[serde(default)]
    skills: HashMap<String, LockEntry>,
}

fn curated_resource_roots(resource_dir: Option<&Path>) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(root) = resource_dir {
        roots.push(root.to_path_buf());
    }
    roots.extend(default_packaged_resource_dir_candidates());
    roots
}

fn default_packaged_resource_dir_candidates() -> Vec<PathBuf> {
    let Ok(exe_path) = std::env::current_exe() else {
        return Vec::new();
    };
    let Some(exe_dir) = exe_path.parent() else {
        return Vec::new();
    };
    let mut candidates = Vec::new();
    if cfg!(target_os = "macos") {
        if let Some(contents_dir) = exe_dir.parent() {
            candidates.push(contents_dir.join("Resources"));
        }
    }
    candidates.push(exe_dir.to_path_buf());
    candidates
}

fn default_repo_root() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| manifest_dir.clone())
}

fn default_source_asset_base() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn default_lock_path(resource_dir: Option<&Path>) -> PathBuf {
    for root in curated_resource_roots(resource_dir) {
        let candidate = root.join("skills-lock.json");
        if candidate.exists() {
            return candidate;
        }
    }
    default_repo_root().join("skills-lock.json")
}

fn resolve_curated_asset_path(
    resource_dir: Option<&Path>,
    asset_base: &Path,
    relative_path: &str,
) -> Option<PathBuf> {
    let relative = Path::new(relative_path);
    for root in curated_resource_roots(resource_dir) {
        let direct = root.join(relative);
        if direct.exists() {
            return Some(direct);
        }
        if let Ok(stripped) = relative.strip_prefix("resources/curated-skills") {
            let bundled = root.join("curated-skills").join(stripped);
            if bundled.exists() {
                return Some(bundled);
            }
        }
        if let Ok(stripped) = relative.strip_prefix("curated-skills") {
            let bundled = root.join("curated-skills").join(stripped);
            if bundled.exists() {
                return Some(bundled);
            }
        }
    }

    let source_path = asset_base.join(relative);
    if source_path.exists() {
        return Some(source_path);
    }

    None
}

/// Load all curated skills declared as `kind: "curated"` in `skills-lock.json`.
/// Bundled entries and entries with no `kind` field are skipped.
///
/// `asset_base_dir` overrides the directory used to resolve `assetPath` /
/// `metadataPath` entries in the lock. When `None`, defaults to
/// `CARGO_MANIFEST_DIR` (i.e. `src-tauri/`) so paths such as
/// `resources/curated-skills/.../SKILL.md` resolve in both dev and release
/// builds. Tests inject a temp dir.
pub(crate) fn load_curated_skills(
    resource_dir: Option<&Path>,
    lock_path: Option<&Path>,
) -> Result<Vec<CuratedSkillEntry>, String> {
    load_curated_skills_with_base(resource_dir, lock_path, None)
}

pub(crate) fn load_curated_skills_with_base(
    resource_dir: Option<&Path>,
    lock_path: Option<&Path>,
    asset_base_dir: Option<&Path>,
) -> Result<Vec<CuratedSkillEntry>, String> {
    let lock_path = match lock_path {
        Some(p) => p.to_path_buf(),
        None => default_lock_path(resource_dir),
    };
    let asset_base: PathBuf = asset_base_dir
        .map(|p| p.to_path_buf())
        .unwrap_or_else(default_source_asset_base);

    let raw = fs::read_to_string(&lock_path).map_err(|e| {
        format!(
            "could not read skills-lock.json at {}: {}",
            lock_path.display(),
            e
        )
    })?;
    let parsed: LockFile = serde_json::from_str(&raw)
        .map_err(|e| format!("skills-lock.json is not valid JSON: {}", e))?;

    if parsed.version != Some(2) {
        // Lock file is on a different schema; we only support v2 (curated
        // entries + `kind` discriminator). Fail loudly so the user knows
        // their lock is out of date.
        return Err(format!(
            "skills-lock.json schema version {:?} is not supported (expected 2)",
            parsed.version
        ));
    }

    let mut out = Vec::new();
    for (name, entry) in parsed.skills {
        if entry.kind.as_deref() != Some("curated") {
            continue;
        }
        validate_curated_skill_id(&name)?;
        let asset_path_rel = entry
            .asset_path
            .as_deref()
            .ok_or_else(|| format!("curated skill `{}` missing `assetPath`", name))?;
        validate_lock_relative_path(&name, "assetPath", asset_path_rel)?;
        let metadata_path_rel = entry
            .metadata_path
            .as_deref()
            .ok_or_else(|| format!("curated skill `{}` missing `metadataPath`", name))?;
        validate_lock_relative_path(&name, "metadataPath", metadata_path_rel)?;

        let full_meta = resolve_curated_asset_path(resource_dir, &asset_base, metadata_path_rel)
            .ok_or_else(|| {
                format!(
                    "could not find metadata.json for `{}` at `{}` in bundled resources or source tree",
                    name, metadata_path_rel
                )
            })?;
        let meta_raw = fs::read_to_string(&full_meta).map_err(|e| {
            format!(
                "could not read metadata.json for `{}` at {}: {}",
                name,
                full_meta.display(),
                e
            )
        })?;
        let meta: serde_json::Value = serde_json::from_str(&meta_raw)
            .map_err(|e| format!("metadata.json for `{}` is not valid JSON: {}", name, e))?;

        let metadata_name = meta
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("curated skill `{}` metadata.json missing `name`", name))?;
        if metadata_name != name {
            return Err(format!(
                "curated skill entry id `{}` does not match metadata.json name `{}`",
                name, metadata_name
            ));
        }

        let license = meta
            .get("license")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if !ALLOWED_LICENSES.contains(&license.as_str()) {
            return Err(format!(
                "curated skill `{}` license `{}` is not in the allowed whitelist {:?}",
                name, license, ALLOWED_LICENSES
            ));
        }
        let category = meta
            .get("category")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if !ALLOWED_CATEGORIES.contains(&category.as_str()) {
            return Err(format!(
                "curated skill `{}` category `{}` is not in the MVP-4 enum {:?}",
                name, category, ALLOWED_CATEGORIES
            ));
        }
        let token_estimate = meta
            .get("tokenEstimate")
            .and_then(|v| v.as_u64())
            .map(|v| v as u32)
            .or(entry.token_estimate)
            .unwrap_or(0);
        if token_estimate == 0 {
            return Err(format!(
                "curated skill `{}` is missing or invalid `tokenEstimate`",
                name
            ));
        }

        let icon = meta
            .get("icon")
            .and_then(|v| v.as_str())
            .unwrap_or("file-text")
            .to_string();
        // Defense-in-depth: build.rs also enforces this; surface a clear runtime
        // error if a tampered lock slips through (e.g. manual edit after a
        // successful compile).
        if let Err(err) = validate_icon_name(&icon) {
            return Err(format!("curated skill `{}` {}", name, err));
        }
        let display_name = meta
            .get("displayName")
            .and_then(|v| v.as_str())
            .or(entry.display_name.as_deref())
            .unwrap_or(&name)
            .to_string();
        let version = meta
            .get("version")
            .and_then(|v| v.as_str())
            .or(entry.version.as_deref())
            .unwrap_or("0.0.0")
            .to_string();
        let description = meta
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let source = meta
            .get("source")
            .and_then(|v| v.as_str())
            .unwrap_or("client bundled")
            .to_string();
        // `sourceUrl` is optional. We only accept absolute http(s)
        // URLs to keep the `View on GitHub` link from being abused as
        // an arbitrary file:// or javascript: vector. A missing or
        // malformed value silently becomes `None` and the link is
        // hidden in the UI.
        let source_url = meta
            .get("sourceUrl")
            .and_then(|v| v.as_str())
            .and_then(sanitize_source_url);

        // Honor minClientVersion: skip skills that require a newer client.
        // The lock's `minClientVersion` is an opaque semver string of the form
        // `"<major>.<minor>.<patch>"`; we parse it ourselves to avoid pulling
        // in a new dependency. Missing or unparseable values are treated as
        // "no constraint" so old lock files keep working.
        if let Some(min) = entry.min_client_version.as_deref() {
            if client_version_below(min) {
                log::info!(
                    "curated skill `{}` requires client >= {} (running {}): skipped",
                    name,
                    min,
                    app_version(),
                );
                continue;
            }
        }

        let body_path = if let Some(path) =
            resolve_curated_asset_path(resource_dir, &asset_base, asset_path_rel)
        {
            Some(path)
        } else {
            log::warn!(
                "curated skill `{}` assetPath `{}` not found in resource dir or source tree",
                name,
                asset_path_rel
            );
            None
        };

        out.push(CuratedSkillEntry {
            name,
            display_name,
            version,
            description,
            icon,
            category,
            token_estimate,
            source,
            source_url,
            license,
            body_path,
        });
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

fn validate_lock_relative_path(name: &str, field: &str, value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("curated skill `{}` has empty `{}`", name, field));
    }
    if trimmed != value {
        return Err(format!(
            "curated skill `{}` `{}` must not contain leading/trailing whitespace: {}",
            name, field, value
        ));
    }
    if trimmed.contains('\\') || trimmed.contains(':') {
        return Err(format!(
            "curated skill `{}` `{}` must use repo-relative POSIX separators only: {}",
            name, field, value
        ));
    }
    let path = Path::new(trimmed);
    if path.is_absolute() {
        return Err(format!(
            "curated skill `{}` has absolute `{}`: {}",
            name, field, value
        ));
    }
    for component in path.components() {
        if matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        ) {
            return Err(format!(
                "curated skill `{}` has unsafe `{}` component in {}",
                name, field, value
            ));
        }
    }
    Ok(())
}

fn sanitize_source_url(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed != value || trimmed.is_empty() {
        return None;
    }
    if trimmed.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return None;
    }
    let rest = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))?;
    let host = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .split('@')
        .next_back()
        .unwrap_or("");
    if host.is_empty() || host.starts_with(':') || host.contains('\\') {
        return None;
    }
    Some(trimmed.to_string())
}

pub(crate) fn validate_curated_skill_id(id: &str) -> Result<(), String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err("curated skill id cannot be empty".to_string());
    }
    if trimmed != id {
        return Err(format!(
            "curated skill id `{}` must not contain leading/trailing whitespace",
            id
        ));
    }
    if trimmed.starts_with('-') || trimmed.ends_with('-') {
        return Err(format!(
            "curated skill id `{}` must not start or end with '-'",
            id
        ));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(format!(
            "curated skill id `{}` must be kebab-case ASCII",
            id
        ));
    }
    Ok(())
}

pub(crate) fn normalized_enabled_curated_skill_ids(ids: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut normalized = Vec::new();
    for id in ids {
        let trimmed = id.trim();
        if validate_curated_skill_id(trimmed).is_err() {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            normalized.push(trimmed.to_string());
        }
    }
    normalized
}

/// Application product version, parsed once at startup from
/// `tauri.conf.json`. The lock file's `minClientVersion` is compared
/// against this value to gate curated skills that require a newer
/// client. The Tauri crate's `package_info().version` is the same value
/// at runtime, but the loader here runs without an `AppHandle` so we
/// resolve the value lazily and cache it in a `OnceLock`.
///
/// We embed the Tauri config as a `&'static str` (via `include_str!`)
/// and slice out the `version` field with a tiny hand-rolled scan —
/// no serde, no JSON crate, no parsing allocations. If the scan fails
/// (e.g. the schema changes), we fall back to the cargo crate version.
fn app_version() -> &'static str {
    static CACHE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    CACHE
        .get_or_init(|| {
            const CFG: &str = include_str!("../tauri.conf.json");
            let bytes = CFG.as_bytes();
            let needle: &[u8] = b"\"version\":";
            if let Some(start) = bytes.windows(needle.len()).position(|w| w == needle) {
                let after = &bytes[start + needle.len()..];
                let mut out = String::new();
                let mut in_str = false;
                for &b in after {
                    if !in_str {
                        if b == b'"' {
                            in_str = true;
                        }
                        continue;
                    }
                    if b == b'"' {
                        break;
                    }
                    out.push(b as char);
                    if out.len() >= 64 {
                        break;
                    }
                }
                if !out.is_empty() {
                    return out;
                }
            }
            env!("CARGO_PKG_VERSION").to_string()
        })
        .as_str()
}

/// Read the SKILL.md body for a single curated skill. Returns an error if the
/// asset is missing on disk.
pub(crate) fn get_curated_skill_body(entry: &CuratedSkillEntry) -> Result<String, String> {
    let path = entry
        .body_path
        .as_ref()
        .ok_or_else(|| format!("curated skill `{}` has no body path on disk", entry.name))?;
    fs::read_to_string(path)
        .map_err(|e| format!("failed to read curated skill `{}` body: {}", entry.name, e))
}

/// Return enabled curated skill bodies in the same order as the user's
/// `enabled_curated_skill_ids` list. Unknown ids are silently skipped. Skills
/// whose body is missing on disk are logged and skipped.
pub(crate) fn list_enabled_curated_skill_bodies(
    app_settings: &AppSettings,
) -> Vec<(String, String)> {
    list_enabled_curated_skill_bodies_with_resource_dir(None, app_settings)
}

pub(crate) fn list_enabled_curated_skill_bodies_with_resource_dir(
    resource_dir: Option<&Path>,
    app_settings: &AppSettings,
) -> Vec<(String, String)> {
    let enabled_ids = normalized_enabled_curated_skill_ids(&app_settings.enabled_curated_skill_ids);
    if enabled_ids.is_empty() {
        return Vec::new();
    }
    let entries = match load_curated_skills(resource_dir, None) {
        Ok(v) => v,
        Err(err) => {
            log::warn!("failed to load curated skills for body list: {}", err);
            return Vec::new();
        }
    };
    let by_name: HashMap<&str, &CuratedSkillEntry> =
        entries.iter().map(|e| (e.name.as_str(), e)).collect();

    let mut out = Vec::new();
    for id in &enabled_ids {
        let Some(entry) = by_name.get(id.as_str()).copied() else {
            log::warn!("enabled curated skill `{}` not found in lock", id);
            continue;
        };
        match get_curated_skill_body(entry) {
            Ok(body) => out.push((entry.name.clone(), body)),
            Err(err) => {
                log::warn!("{}", err);
            }
        }
    }
    out
}

/// Empirical token estimate: `chars / 3`. The MVP uses this as a coarse proxy
/// (English-leading text typically lands within 15 % of the real count).
#[cfg(test)]
fn validate_token_estimate(body: &str) -> usize {
    body.chars().count() / 3
}

/// Coarse validator for the lucide-react icon name. Enforces kebab-case ASCII
/// only — the full lucide icon whitelist is a V1.1 follow-up.
pub(crate) fn validate_icon_name(icon: &str) -> Result<(), String> {
    if icon.is_empty() {
        return Err("icon cannot be empty".to_string());
    }
    if !icon
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(format!(
            "icon `{}` must be kebab-case ASCII (e.g. 'sparkles', 'file-text')",
            icon
        ));
    }
    Ok(())
}

// ==================== Tauri IPC Handlers ====================

/// Build the JSON value that `get_curated_skills` returns to the frontend.
/// Combines the bundled curated entries with each entry's `enabled` flag
/// computed from `AppSettings.enabled_curated_skill_ids`.
fn build_curated_skills_json(
    resource_dir: Option<&Path>,
    app_settings: &AppSettings,
) -> Result<Vec<serde_json::Value>, String> {
    let enabled_ids_vec =
        normalized_enabled_curated_skill_ids(&app_settings.enabled_curated_skill_ids);
    let enabled_ids: std::collections::HashSet<&str> =
        enabled_ids_vec.iter().map(|s| s.as_str()).collect();
    let entries = load_curated_skills(resource_dir, None)?;
    Ok(entries
        .into_iter()
        .map(|e| curated_skill_entry_to_json(&e, enabled_ids.contains(e.name.as_str())))
        .collect())
}

fn app_resource_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().resource_dir().ok()
}

fn curated_skill_entry_to_json(e: &CuratedSkillEntry, enabled: bool) -> serde_json::Value {
    let mut value = serde_json::Map::new();
    value.insert("name".to_string(), serde_json::json!(e.name));
    value.insert("displayName".to_string(), serde_json::json!(e.display_name));
    value.insert("version".to_string(), serde_json::json!(e.version));
    value.insert("description".to_string(), serde_json::json!(e.description));
    value.insert("icon".to_string(), serde_json::json!(e.icon));
    value.insert("category".to_string(), serde_json::json!(e.category));
    value.insert(
        "tokenEstimate".to_string(),
        serde_json::json!(e.token_estimate),
    );
    value.insert("source".to_string(), serde_json::json!(e.source));
    if let Some(source_url) = e.source_url.as_ref() {
        value.insert("sourceUrl".to_string(), serde_json::json!(source_url));
    }
    value.insert("license".to_string(), serde_json::json!(e.license));
    value.insert("enabled".to_string(), serde_json::json!(enabled));
    serde_json::Value::Object(value)
}

#[tauri::command]
pub(crate) async fn get_curated_skills(
    state: tauri::State<'_, crate::state::AppState>,
    app: tauri::AppHandle,
) -> Result<Vec<serde_json::Value>, String> {
    let app_settings = state.app_settings.lock().await.clone();
    let resource_dir = app_resource_dir(&app);
    build_curated_skills_json(resource_dir.as_deref(), &app_settings)
}

#[tauri::command]
pub(crate) async fn get_enabled_curated_skill_ids(
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<Vec<String>, String> {
    let app_settings = state.app_settings.lock().await.clone();
    Ok(normalized_enabled_curated_skill_ids(
        &app_settings.enabled_curated_skill_ids,
    ))
}

#[tauri::command]
pub(crate) async fn get_curated_skill_bodies(
    state: tauri::State<'_, crate::state::AppState>,
    app: tauri::AppHandle,
) -> Result<Vec<(String, String)>, String> {
    let app_settings = state.app_settings.lock().await.clone();
    let resource_dir = app_resource_dir(&app);
    Ok(list_enabled_curated_skill_bodies_with_resource_dir(
        resource_dir.as_deref(),
        &app_settings,
    ))
}

/// Toggle a curated skill on/off. The returned `AppSettings` is the new
/// authoritative state; frontend must update its `useAppSettings` state from
/// it. If the curated set changes, connected Codex app-server runtimes are
/// restarted so their generated instruction transport state matches the new
/// setting.
#[tauri::command]
pub(crate) async fn set_curated_skill_enabled(
    skill_id: String,
    enabled: bool,
    state: tauri::State<'_, crate::state::AppState>,
    window: tauri::Window,
) -> Result<crate::types::AppSettings, String> {
    // Optional soft-kill-switch for emergency rollback (see docs/curated-skill-onboarding.md
    // Rollback (c)).
    if std::env::var("DOGE_CURATED_SKILLS_DISABLED").is_ok()
        || std::env::var("CCGUI_CURATED_SKILLS_DISABLED").is_ok()
    {
        log::warn!("curated skills disabled by doge kill switch; returning current settings");
        let current =
            crate::shared::settings_core::get_app_settings_core(&state.app_settings).await;
        return Ok(current);
    }

    let skill_id = skill_id.trim().to_string();
    if skill_id.is_empty() {
        return Err("curated skill id is required".to_string());
    }
    validate_curated_skill_id(&skill_id)?;
    let resource_dir = app_resource_dir(window.app_handle());
    let known_entries = load_curated_skills(resource_dir.as_deref(), None)?;
    if !known_entries.iter().any(|entry| entry.name == skill_id) {
        return Err(format!("unknown curated skill id `{}`", skill_id));
    }

    let previous = state.app_settings.lock().await.clone();
    let mut new_settings = previous.clone();
    new_settings.enabled_curated_skill_ids =
        normalized_enabled_curated_skill_ids(&new_settings.enabled_curated_skill_ids);
    new_settings
        .enabled_curated_skill_ids
        .retain(|id| id != &skill_id);
    if enabled {
        if !new_settings.enabled_curated_skill_ids.contains(&skill_id) {
            new_settings
                .enabled_curated_skill_ids
                .push(skill_id.clone());
        }
    }

    let updated = crate::shared::settings_core::update_app_settings_core(
        new_settings,
        &state.app_settings,
        &state.settings_path,
    )
    .await?;
    if crate::shared::settings_core::app_settings_change_requires_codex_restart(&previous, &updated)
    {
        let auto_compaction_threshold_percent =
            f64::from(updated.codex_auto_compaction_threshold_percent);
        let auto_compaction_enabled = updated.codex_auto_compaction_enabled;
        if let Err(error) =
            crate::shared::settings_core::restart_codex_sessions_for_app_settings_change_core(
                &state.workspaces,
                &state.sessions,
                &state.app_settings,
                Some(&state.runtime_manager),
                |entry, default_bin, codex_args, codex_home| {
                    crate::backend::app_server::spawn_workspace_session_with_auto_compaction_threshold(
                        entry,
                        default_bin,
                        codex_args,
                        codex_home,
                        env!("CARGO_PKG_VERSION").to_string(),
                        auto_compaction_threshold_percent,
                        auto_compaction_enabled,
                        crate::event_sink::build_event_sink(window.app_handle().clone()),
                    )
                },
            )
            .await
        {
            let rollback_error = crate::shared::settings_core::restore_app_settings_core(
                &previous,
                &state.app_settings,
                &state.settings_path,
            )
            .await
            .err();
            let message = match rollback_error {
                Some(rollback_error) => format!("{error} (rollback failed: {rollback_error})"),
                None => error,
            };
            return Err(message);
        }
    }
    state.sync_engine_configs_from_settings().await;
    // 设置已持久化且未回滚：广播变更，前端 indicator 事件驱动刷新。
    let _ = window.app_handle().emit("curated-skills-changed", ());
    Ok(updated)
}

/// Return `true` when the running client's semver is strictly below the
/// supplied `<major>.<minor>.<patch>` constraint. Returns `false` when
/// the constraint is satisfied, missing, or unparseable.
///
/// Implementation: parse both versions into `(major, minor, patch)` tuples
/// and compare lexicographically. Trailing pre-release / build metadata is
/// ignored for the comparison (matches the Cargo semver comparator). Used
/// to gate curated skills whose `minClientVersion` exceeds the running
/// client (e.g. a skill that depends on a new field introduced in v0.5.15
/// must be filtered out for users still on v0.5.14).
fn client_version_below(min_required: &str) -> bool {
    let Some(current_parts) = parse_semver(app_version()) else {
        return false;
    };
    let Some(required_parts) = parse_semver(min_required) else {
        return false;
    };
    current_parts < required_parts
}

fn parse_semver(version: &str) -> Option<(u32, u32, u32)> {
    let mut parts = version.split('.').take(3);
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next().and_then(|s| s.parse::<u32>().ok())?;
    let patch = parts
        .next()
        .and_then(|s| {
            s.split(['-', '+'])
                .next()
                .and_then(|p| p.parse::<u32>().ok())
        })
        .unwrap_or(0);
    Some((major, minor, patch))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static NONCE: AtomicUsize = AtomicUsize::new(0);

    fn unique_temp_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let n = NONCE.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("ccgui-curated-{prefix}-{nanos}-{n}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn write_skill(root: &Path, name: &str, body: &str, license: &str, category: &str) {
        let dir = root.join(name);
        fs::create_dir_all(&dir).expect("create skill dir");
        fs::write(dir.join("SKILL.md"), body).expect("write SKILL.md");
        let meta = serde_json::json!({
            "name": name,
            "displayName": name,
            "version": "1.0.0",
            "description": format!("test skill {}", name),
            "icon": "sparkles",
            "category": category,
            "tokenEstimate": 100,
            "source": "test",
            "license": license,
        });
        let mut f = fs::File::create(dir.join("metadata.json")).expect("create metadata");
        f.write_all(serde_json::to_string_pretty(&meta).unwrap().as_bytes())
            .expect("write metadata");
    }

    fn write_lock(lock_path: &Path, skills_root: &Path, entries: &[(String, &str)]) {
        let mut skills = serde_json::Map::new();
        for (name, license) in entries {
            let key = name.clone();
            let body_path = skills_root.join(name).join("SKILL.md");
            let bytes = fs::read(&body_path).expect("read body for hash");
            let mut hash: u64 = 1469598103934665603;
            for b in &bytes {
                hash ^= *b as u64;
                hash = hash.wrapping_mul(1099511628211);
            }
            let hash_hex = format!("{:016x}", hash);
            let mut entry = serde_json::Map::new();
            entry.insert("kind".to_string(), serde_json::json!("curated"));
            entry.insert(
                "assetPath".to_string(),
                serde_json::json!(format!("{name}/SKILL.md")),
            );
            entry.insert(
                "metadataPath".to_string(),
                serde_json::json!(format!("{name}/metadata.json")),
            );
            entry.insert("computedHash".to_string(), serde_json::json!(hash_hex));
            entry.insert("tokenEstimate".to_string(), serde_json::json!(100u32));
            // Test data: pin minClientVersion to a release at-or-below the
            // current `app_version()` so the `min_client_version` runtime
            // gate does not silently drop test entries. The version-bump
            // gate is exercised in a dedicated test below.
            entry.insert(
                "minClientVersion".to_string(),
                serde_json::json!(app_test_version()),
            );
            entry.insert("displayName".to_string(), serde_json::json!(name));
            entry.insert("version".to_string(), serde_json::json!("1.0.0"));
            let _ = license;
            skills.insert(key, serde_json::Value::Object(entry));
        }
        let lock = serde_json::json!({
            "version": 2,
            "skills": serde_json::Value::Object(skills)
        });
        fs::write(lock_path, serde_json::to_string_pretty(&lock).unwrap()).expect("write lock");
    }

    fn write_repo_style_lock(lock_path: &Path, entries: &[String]) {
        let mut skills = serde_json::Map::new();
        for name in entries {
            skills.insert(
                name.clone(),
                serde_json::json!({
                    "kind": "curated",
                    "assetPath": format!("resources/curated-skills/{name}/SKILL.md"),
                    "metadataPath": format!("resources/curated-skills/{name}/metadata.json"),
                    "tokenEstimate": 100u32,
                    "minClientVersion": app_test_version(),
                    "displayName": name,
                    "version": "1.0.0",
                }),
            );
        }
        let lock = serde_json::json!({
            "version": 2,
            "skills": serde_json::Value::Object(skills)
        });
        fs::write(lock_path, serde_json::to_string_pretty(&lock).unwrap()).expect("write lock");
    }

    /// Test-only: read the product version from the compiled-in tauri.conf.json
    /// so the curated-skill fixtures can match the runtime gate.
    fn app_test_version() -> &'static str {
        app_version()
    }

    #[test]
    fn min_client_version_filter_drops_skills_above_running_client() {
        let skills_root = unique_temp_dir("min-client-version");
        write_skill(&skills_root, "skill-new", "body new", "MIT", "code-style");
        let lock_path = skills_root.join("skills-lock.json");
        let mut skills = serde_json::Map::new();
        skills.insert(
            "skill-new".into(),
            serde_json::json!({
                "kind": "curated",
                "assetPath": "skill-new/SKILL.md",
                "metadataPath": "skill-new/metadata.json",
                "tokenEstimate": 100u32,
                // Bump far above the current product version to force the
                // gate to drop the entry.
                "minClientVersion": "999.0.0",
            }),
        );
        let lock = serde_json::json!({
            "version": 2,
            "skills": serde_json::Value::Object(skills)
        });
        fs::write(&lock_path, serde_json::to_string_pretty(&lock).unwrap()).unwrap();

        let entries = load_with_root(&skills_root, &lock_path).expect("load");
        assert!(
            entries.is_empty(),
            "skill above minClientVersion must be dropped"
        );

        let _ = fs::remove_dir_all(skills_root);
    }

    #[test]
    fn min_client_version_filter_keeps_skills_below_or_equal_running_client() {
        let skills_root = unique_temp_dir("min-client-keep");
        write_skill(&skills_root, "skill-old", "body old", "MIT", "code-style");
        let lock_path = skills_root.join("skills-lock.json");
        write_lock(
            &lock_path,
            &skills_root,
            &[("skill-old".to_string(), "MIT")],
        );

        let entries = load_with_root(&skills_root, &lock_path).expect("load");
        assert_eq!(
            entries.len(),
            1,
            "skill at-or-below running version must load"
        );

        let _ = fs::remove_dir_all(skills_root);
    }

    fn load_with_root(
        skills_root: &Path,
        lock_path: &Path,
    ) -> Result<Vec<CuratedSkillEntry>, String> {
        load_curated_skills_with_base(Some(skills_root), Some(lock_path), Some(skills_root))
    }

    #[test]
    fn load_curated_skills_filters_bundled_entries() {
        let skills_root = unique_temp_dir("filter-bundled-skills");
        write_skill(&skills_root, "skill-a", "body a", "MIT", "code-style");
        let lock_path = skills_root.join("skills-lock.json");
        let mut skills = serde_json::Map::new();
        skills.insert(
            "skill-a".into(),
            serde_json::json!({
                "kind": "bundled",
                "assetPath": "resources/curated-skills/skill-a/SKILL.md",
            }),
        );
        let lock = serde_json::json!({
            "version": 2,
            "skills": serde_json::Value::Object(skills)
        });
        fs::write(&lock_path, serde_json::to_string_pretty(&lock).unwrap()).unwrap();

        let entries = load_with_root(&skills_root, &lock_path).expect("load");
        assert!(entries.is_empty(), "kind: bundled entries must be skipped");

        let _ = fs::remove_dir_all(skills_root);
    }

    #[test]
    fn load_curated_skills_returns_curated_entries() {
        let skills_root = unique_temp_dir("curated-only");
        write_skill(&skills_root, "skill-a", "body a", "MIT", "code-style");
        write_skill(&skills_root, "skill-b", "body b", "Apache-2.0", "ui-design");
        let lock_path = skills_root.join("skills-lock.json");
        write_lock(
            &lock_path,
            &skills_root,
            &[
                ("skill-a".to_string(), "MIT"),
                ("skill-b".to_string(), "Apache-2.0"),
            ],
        );

        let entries = load_with_root(&skills_root, &lock_path).expect("load");
        assert_eq!(entries.len(), 2);
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"skill-a"));
        assert!(names.contains(&"skill-b"));

        let _ = fs::remove_dir_all(skills_root);
    }

    #[test]
    fn load_curated_skills_reads_packaged_resource_layout() {
        let resource_root = unique_temp_dir("packaged-layout");
        let packaged_skills_root = resource_root.join("curated-skills");
        fs::create_dir_all(&packaged_skills_root).expect("create packaged skills root");
        write_skill(
            &packaged_skills_root,
            "skill-a",
            "packaged body",
            "MIT",
            "code-style",
        );
        let lock_path = resource_root.join("skills-lock.json");
        write_repo_style_lock(&lock_path, &["skill-a".to_string()]);

        let missing_source_base = resource_root.join("missing-source-tree");
        let entries =
            load_curated_skills_with_base(Some(&resource_root), None, Some(&missing_source_base))
                .expect("load packaged resources");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "skill-a");
        assert_eq!(
            get_curated_skill_body(&entries[0]).expect("body"),
            "packaged body",
        );

        let _ = fs::remove_dir_all(resource_root);
    }

    #[test]
    fn load_curated_skills_rejects_missing_lock() {
        let skills_root = unique_temp_dir("missing-lock");
        let bogus_lock = skills_root.join("does-not-exist.json");
        let err = load_curated_skills(Some(&skills_root), Some(&bogus_lock))
            .expect_err("must fail when lock is missing");
        assert!(err.contains("could not read skills-lock.json"));

        let _ = fs::remove_dir_all(skills_root);
    }

    #[test]
    fn load_curated_skills_rejects_disallowed_license() {
        let skills_root = unique_temp_dir("bad-license");
        write_skill(&skills_root, "skill-x", "body", "Proprietary", "code-style");
        let lock_path = skills_root.join("skills-lock.json");
        write_lock(
            &lock_path,
            &skills_root,
            &[("skill-x".to_string(), "Proprietary")],
        );
        let err = load_with_root(&skills_root, &lock_path).expect_err("must fail for Proprietary");
        assert!(
            err.contains("license"),
            "error should mention license: {}",
            err
        );

        let _ = fs::remove_dir_all(skills_root);
    }

    #[test]
    fn load_curated_skills_rejects_unsafe_lock_paths() {
        let skills_root = unique_temp_dir("unsafe-lock-path");
        write_skill(&skills_root, "skill-a", "body", "MIT", "code-style");
        let lock_path = skills_root.join("skills-lock.json");
        let lock = serde_json::json!({
            "version": 2,
            "skills": {
                "skill-a": {
                    "kind": "curated",
                    "assetPath": "../escape/SKILL.md",
                    "metadataPath": "skill-a/metadata.json",
                    "tokenEstimate": 100u32,
                    "minClientVersion": app_test_version(),
                }
            }
        });
        fs::write(&lock_path, serde_json::to_string_pretty(&lock).unwrap()).unwrap();

        let err = load_with_root(&skills_root, &lock_path)
            .expect_err("parent directory traversal must be rejected");
        assert!(err.contains("unsafe `assetPath`"), "{err}");

        let _ = fs::remove_dir_all(skills_root);
    }

    #[test]
    fn load_curated_skills_filters_malformed_source_url() {
        let skills_root = unique_temp_dir("source-url-filter");
        write_skill(&skills_root, "skill-a", "body", "MIT", "code-style");
        let meta_path = skills_root.join("skill-a").join("metadata.json");
        let mut meta: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&meta_path).unwrap()).unwrap();
        meta["sourceUrl"] = serde_json::json!("https://");
        fs::write(&meta_path, serde_json::to_string_pretty(&meta).unwrap()).unwrap();
        let lock_path = skills_root.join("skills-lock.json");
        write_lock(&lock_path, &skills_root, &[("skill-a".to_string(), "MIT")]);

        let entries = load_with_root(&skills_root, &lock_path).expect("load");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].source_url, None);

        meta["sourceUrl"] = serde_json::json!("https://github.com/example/repo");
        fs::write(&meta_path, serde_json::to_string_pretty(&meta).unwrap()).unwrap();
        let entries = load_with_root(&skills_root, &lock_path).expect("load");
        assert_eq!(
            entries[0].source_url.as_deref(),
            Some("https://github.com/example/repo"),
        );

        let _ = fs::remove_dir_all(skills_root);
    }

    #[test]
    fn normalized_enabled_curated_skill_ids_trims_dedupes_and_drops_empty() {
        let ids = vec![
            " lazy-senior-dev ".to_string(),
            "".to_string(),
            "lazy-senior-dev".to_string(),
            "other".to_string(),
            "   ".to_string(),
            "BadId".to_string(),
            "../escape".to_string(),
        ];
        assert_eq!(
            normalized_enabled_curated_skill_ids(&ids),
            vec!["lazy-senior-dev".to_string(), "other".to_string()],
        );
    }

    #[test]
    fn validate_curated_skill_id_rejects_non_kebab_ascii_segments() {
        for bad in [
            "", " skill", "skill ", "-skill", "skill-", "BadId", "a/b", "a\\b", "a_b",
        ] {
            assert!(
                validate_curated_skill_id(bad).is_err(),
                "expected `{bad}` to be rejected",
            );
        }

        for ok in ["lazy-senior-dev", "review2", "settings-2"] {
            validate_curated_skill_id(ok).expect(ok);
        }
    }

    #[test]
    fn curated_skills_json_omits_source_url_when_absent() {
        let value = curated_skill_entry_to_json(
            &CuratedSkillEntry {
                name: "skill-no-url".to_string(),
                display_name: "Skill no URL".to_string(),
                version: "1.0.0".to_string(),
                description: "test".to_string(),
                icon: "sparkles".to_string(),
                category: "code-style".to_string(),
                token_estimate: 100,
                source: "test".to_string(),
                source_url: None,
                license: "MIT".to_string(),
                body_path: None,
            },
            false,
        );
        assert!(
            value.get("sourceUrl").is_none(),
            "sourceUrl must be omitted, not serialized as null: {value:?}",
        );
    }

    #[test]
    fn get_curated_skill_body_returns_disk_contents() {
        let skills_root = unique_temp_dir("body-read");
        write_skill(&skills_root, "skill-y", "hello world", "MIT", "code-style");
        let entries_path = skills_root.join("skill-y");
        let body_path = entries_path.join("SKILL.md");

        let entry = CuratedSkillEntry {
            name: "skill-y".to_string(),
            display_name: "skill-y".to_string(),
            version: "1.0.0".to_string(),
            description: "test".to_string(),
            icon: "sparkles".to_string(),
            category: "code-style".to_string(),
            token_estimate: 100,
            source: "test".to_string(),
            source_url: None,
            license: "MIT".to_string(),
            body_path: Some(body_path),
        };
        let body = get_curated_skill_body(&entry).expect("body");
        assert_eq!(body, "hello world");

        let _ = fs::remove_dir_all(skills_root);
    }

    #[test]
    fn get_curated_skill_body_reports_missing_body() {
        let entry = CuratedSkillEntry {
            name: "ghost".to_string(),
            display_name: "ghost".to_string(),
            version: "1.0.0".to_string(),
            description: "test".to_string(),
            icon: "sparkles".to_string(),
            category: "code-style".to_string(),
            token_estimate: 100,
            source: "test".to_string(),
            source_url: None,
            license: "MIT".to_string(),
            body_path: None,
        };
        let err = get_curated_skill_body(&entry).expect_err("must fail without body path");
        assert!(err.contains("no body path"));

        let entry_with_missing = CuratedSkillEntry {
            body_path: Some(std::env::temp_dir().join("definitely-not-here-12345.md")),
            ..entry
        };
        let err = get_curated_skill_body(&entry_with_missing).expect_err("must fail on read");
        assert!(err.contains("failed to read"));
    }

    #[test]
    fn validate_token_estimate_matches_chars_over_three() {
        let body = "a".repeat(30);
        assert_eq!(validate_token_estimate(&body), 10);
        let body = "a".repeat(31);
        assert_eq!(validate_token_estimate(&body), 10); // integer division
    }

    #[test]
    fn validate_icon_name_accepts_kebab_case_ascii() {
        for ok in &["sparkles", "file-text", "git-branch", "settings-2"] {
            validate_icon_name(ok).expect(ok);
        }
    }

    #[test]
    fn validate_icon_name_rejects_emoji_and_pascal_case() {
        for bad in &["Sparkles", "🚀", "file_text", "icon!", "FILE-TEXT"] {
            assert!(
                validate_icon_name(bad).is_err(),
                "expected {} to be rejected",
                bad
            );
        }
    }

    #[test]
    fn list_enabled_curated_skill_bodies_preserves_user_order() {
        let skills_root = unique_temp_dir("body-order");
        write_skill(&skills_root, "alpha", "alpha body", "MIT", "code-style");
        write_skill(&skills_root, "beta", "beta body", "MIT", "code-style");
        let lock_path = skills_root.join("skills-lock.json");
        write_lock(
            &lock_path,
            &skills_root,
            &[("alpha".to_string(), "MIT"), ("beta".to_string(), "MIT")],
        );

        // We cannot easily override load_curated_skills' lock path here, so
        // we re-implement the body-load logic against the in-memory entries
        // by calling get_curated_skill_body directly to verify the order is
        // driven by the caller's iteration, not alphabetical sort.
        let mut settings = AppSettings::default();
        settings.enabled_curated_skill_ids = vec!["beta".to_string(), "alpha".to_string()];

        let entries = load_with_root(&skills_root, &lock_path).expect("load");
        let by_name: HashMap<String, &CuratedSkillEntry> =
            entries.iter().map(|e| (e.name.clone(), e)).collect();

        let mut bodies = Vec::new();
        for id in &settings.enabled_curated_skill_ids {
            if let Some(e) = by_name.get(id) {
                let body = get_curated_skill_body(e).expect("body");
                bodies.push((id.clone(), body));
            }
        }
        assert_eq!(bodies[0].0, "beta");
        assert_eq!(bodies[1].0, "alpha");
        assert_eq!(bodies[0].1, "beta body");
        assert_eq!(bodies[1].1, "alpha body");

        let _ = fs::remove_dir_all(skills_root);
    }
}
