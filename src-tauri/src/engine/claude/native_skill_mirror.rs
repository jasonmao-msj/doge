use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::claude_home::{normalize_home_path, resolve_effective_claude_home};
use crate::types::AppSettings;

const SENTINEL_FILE: &str = ".doge-curated-skill";
const LEGACY_SENTINEL_FILES: &[&str] = &[".ccgui-curated-skill"];
const HINT_DIR: &str = "doge/curated-skill-hints";
const LEGACY_HINT_DIRS: &[&str] = &["ccgui/curated-skill-hints"];
const HINT_FILE: &str = "enabled-curated-skills.md";
const HINT_SENTINEL_FILE: &str = ".doge-curated-skill-hint";
const LEGACY_HINT_SENTINEL_FILES: &[&str] = &[".ccgui-curated-skill-hint"];

pub(super) fn sync_windows_curated_skill_mirror(
    configured_home_dir: Option<&str>,
    app_settings: Option<&AppSettings>,
    is_windows: bool,
) -> Result<Option<PathBuf>, String> {
    if !is_windows {
        return Ok(None);
    }
    let Some(settings) = app_settings else {
        return Ok(None);
    };
    let Some(claude_home) = resolve_session_claude_home(configured_home_dir) else {
        return Ok(None);
    };
    sync_curated_skill_mirror_at_home(&claude_home, settings)
}

fn resolve_session_claude_home(configured_home_dir: Option<&str>) -> Option<PathBuf> {
    configured_home_dir
        .and_then(normalize_home_path)
        .or_else(|| resolve_effective_claude_home(None))
}

fn sync_curated_skill_mirror_at_home(
    claude_home: &Path,
    app_settings: &AppSettings,
) -> Result<Option<PathBuf>, String> {
    let enabled: HashMap<String, String> =
        crate::curated_skills::list_enabled_curated_skill_bodies(app_settings)
            .into_iter()
            .collect();
    let known_ids: HashSet<String> = crate::curated_skills::load_curated_skills(None, None)
        .map(|entries| entries.into_iter().map(|entry| entry.name).collect())
        .unwrap_or_else(|error| {
            log::warn!("failed to load curated skills for Claude mirror cleanup: {error}");
            enabled.keys().cloned().collect()
        });
    let skills_dir = claude_home.join("skills");

    for (skill_id, body) in &enabled {
        mirror_one_skill(&skills_dir, skill_id, body)?;
    }
    for skill_id in known_ids {
        if !enabled.contains_key(&skill_id) {
            remove_managed_skill_mirror(&skills_dir, &skill_id)?;
        }
    }
    sync_activation_hint_file(claude_home, enabled.keys().map(String::as_str).collect())
}

fn mirror_one_skill(skills_dir: &Path, skill_id: &str, body: &str) -> Result<(), String> {
    let skill_dir = skills_dir.join(skill_id);
    let skill_file = skill_dir.join("SKILL.md");
    let sentinel_file = skill_dir.join(SENTINEL_FILE);

    if skill_dir.exists() && !is_managed_skill_dir(&skill_dir, skill_id) {
        log::warn!(
            "Claude skill mirror skipped `{}` because {} already exists and is not doge-managed",
            skill_id,
            skill_dir.display()
        );
        return Ok(());
    }

    fs::create_dir_all(&skill_dir).map_err(|error| {
        format!(
            "failed to create Claude curated skill mirror {}: {}",
            skill_dir.display(),
            error
        )
    })?;
    let _ = write_atomic_if_changed(&skill_file, body)?;
    let _ = write_atomic_if_changed(&sentinel_file, &sentinel_body(skill_id))?;
    for legacy_filename in LEGACY_SENTINEL_FILES {
        let _ = fs::remove_file(skill_dir.join(legacy_filename));
    }
    Ok(())
}

fn remove_managed_skill_mirror(skills_dir: &Path, skill_id: &str) -> Result<(), String> {
    let skill_dir = skills_dir.join(skill_id);
    if !is_managed_skill_dir(&skill_dir, skill_id) {
        return Ok(());
    }
    fs::remove_dir_all(&skill_dir).map_err(|error| {
        format!(
            "failed to remove Claude curated skill mirror {}: {}",
            skill_dir.display(),
            error
        )
    })
}

fn is_managed_skill_dir(skill_dir: &Path, skill_id: &str) -> bool {
    let current = fs::read_to_string(skill_dir.join(SENTINEL_FILE))
        .is_ok_and(|body| body == sentinel_body(skill_id));
    current
        || LEGACY_SENTINEL_FILES.iter().any(|filename| {
            fs::read_to_string(skill_dir.join(filename))
                .is_ok_and(|body| body == legacy_sentinel_body(skill_id))
        })
}

fn sentinel_body(skill_id: &str) -> String {
    format!("managed-by=doge\nkind=curated-skill\nid={skill_id}\n")
}

fn legacy_sentinel_body(skill_id: &str) -> String {
    format!("managed-by=ccgui\nkind=curated-skill\nid={skill_id}\n")
}

fn sync_activation_hint_file(
    claude_home: &Path,
    mut enabled_skill_ids: Vec<&str>,
) -> Result<Option<PathBuf>, String> {
    enabled_skill_ids.sort_unstable();
    enabled_skill_ids.dedup();

    let hint_dir = claude_home.join(HINT_DIR);
    let hint_file = hint_dir.join(HINT_FILE);
    let sentinel_file = hint_dir.join(HINT_SENTINEL_FILE);

    if enabled_skill_ids.is_empty() {
        remove_managed_activation_hint(&hint_file, &sentinel_file)?;
        remove_legacy_activation_hints(claude_home)?;
        return Ok(None);
    }

    fs::create_dir_all(&hint_dir).map_err(|error| {
        format!(
            "failed to create Claude curated skill hint directory {}: {}",
            hint_dir.display(),
            error
        )
    })?;
    let hint_body = activation_hint_body(&enabled_skill_ids);
    let sentinel_body = activation_hint_sentinel_body();
    let _ = write_atomic_if_changed(&hint_file, &hint_body)?;
    let _ = write_atomic_if_changed(&sentinel_file, sentinel_body)?;
    remove_legacy_activation_hints(claude_home)?;
    Ok(Some(hint_file))
}

fn remove_legacy_activation_hints(claude_home: &Path) -> Result<(), String> {
    for hint_dir_name in LEGACY_HINT_DIRS {
        let hint_dir = claude_home.join(hint_dir_name);
        let hint_file = hint_dir.join(HINT_FILE);
        for sentinel_name in LEGACY_HINT_SENTINEL_FILES {
            let sentinel_file = hint_dir.join(sentinel_name);
            remove_managed_activation_hint(&hint_file, &sentinel_file)?;
        }
    }
    Ok(())
}

fn remove_managed_activation_hint(hint_file: &Path, sentinel_file: &Path) -> Result<(), String> {
    if !is_managed_activation_hint(sentinel_file) {
        return Ok(());
    }
    for path in [hint_file, sentinel_file] {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "failed to remove Claude curated skill hint {}: {}",
                    path.display(),
                    error
                ));
            }
        }
    }
    if let Some(dir) = hint_file.parent() {
        let _ = fs::remove_dir(dir);
    }
    Ok(())
}

fn is_managed_activation_hint(sentinel_file: &Path) -> bool {
    fs::read_to_string(sentinel_file)
        .map(|body| {
            body == activation_hint_sentinel_body()
                || body == legacy_activation_hint_sentinel_body()
        })
        .unwrap_or(false)
}

fn activation_hint_sentinel_body() -> &'static str {
    "managed-by=doge\nkind=curated-skill-activation-hint\n"
}

fn legacy_activation_hint_sentinel_body() -> &'static str {
    "managed-by=ccgui\nkind=curated-skill-activation-hint\n"
}

fn activation_hint_body(enabled_skill_ids: &[&str]) -> String {
    let mut body = String::from(
        "doge curated skills are enabled for this Claude Code conversation.\n\
         These skills are installed in Claude native skills. For coding, debugging, code review,\n\
         refactoring, and implementation tasks, invoke the matching Skill before answering and\n\
         follow that Skill for the current turn. Do not mention this instruction unless asked.\n\n\
         Enabled skills:\n",
    );
    for skill_id in enabled_skill_ids {
        body.push_str("- ");
        body.push_str(skill_id);
        body.push_str(": invoke Skill(skill=\"");
        body.push_str(skill_id);
        body.push_str("\") when the user task matches.\n");
    }
    body
}

fn write_atomic_if_changed(path: &Path, body: &str) -> Result<bool, String> {
    if fs::read_to_string(path)
        .map(|current| current == body)
        .unwrap_or(false)
    {
        return Ok(false);
    }

    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, body).map_err(|error| {
        format!(
            "failed to write temporary Claude curated skill mirror {}: {}",
            tmp_path.display(),
            error
        )
    })?;
    if path.exists() {
        fs::remove_file(path).map_err(|error| {
            let _ = fs::remove_file(&tmp_path);
            format!(
                "failed to replace Claude curated skill mirror {}: {}",
                path.display(),
                error
            )
        })?;
    }
    fs::rename(&tmp_path, path).map_err(|error| {
        let _ = fs::remove_file(&tmp_path);
        format!(
            "failed to publish Claude curated skill mirror {}: {}",
            path.display(),
            error
        )
    })?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn temp_home(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ccgui-claude-mirror-{name}-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("create temp Claude home");
        dir
    }

    fn settings_with(ids: &[&str]) -> AppSettings {
        let mut settings = AppSettings::default();
        settings.enabled_curated_skill_ids = ids.iter().map(|id| id.to_string()).collect();
        settings
    }

    #[test]
    fn sync_windows_mirror_writes_enabled_curated_skill_to_claude_home() {
        let home = temp_home("enabled");
        let settings = settings_with(&["lazy-senior-dev"]);

        let hint_file = sync_windows_curated_skill_mirror(
            Some(home.to_string_lossy().as_ref()),
            Some(&settings),
            true,
        )
        .expect("sync mirror");

        let skill_dir = home.join("skills").join("lazy-senior-dev");
        let body = fs::read_to_string(skill_dir.join("SKILL.md")).expect("read mirrored skill");
        let sentinel = fs::read_to_string(skill_dir.join(SENTINEL_FILE)).expect("read sentinel");

        assert!(body.contains("Ponytail, lazy senior dev mode"));
        assert_eq!(sentinel, sentinel_body("lazy-senior-dev"));
        assert_eq!(
            hint_file,
            Some(home.join(HINT_DIR).join(HINT_FILE)),
            "enabled curated skills should produce an activation hint file"
        );
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn sync_windows_mirror_upgrades_legacy_managed_skill_marker() {
        let home = temp_home("legacy-managed");
        let skill_dir = home.join("skills").join("lazy-senior-dev");
        fs::create_dir_all(&skill_dir).expect("create legacy managed skill");
        fs::write(skill_dir.join("SKILL.md"), "legacy body").expect("write legacy body");
        fs::write(
            skill_dir.join(LEGACY_SENTINEL_FILES[0]),
            legacy_sentinel_body("lazy-senior-dev"),
        )
        .expect("write legacy sentinel");

        sync_windows_curated_skill_mirror(
            Some(home.to_string_lossy().as_ref()),
            Some(&settings_with(&["lazy-senior-dev"])),
            true,
        )
        .expect("sync legacy mirror");

        assert_eq!(
            fs::read_to_string(skill_dir.join(SENTINEL_FILE)).expect("read doge sentinel"),
            sentinel_body("lazy-senior-dev"),
        );
        assert!(!skill_dir.join(LEGACY_SENTINEL_FILES[0]).exists());
        assert!(fs::read_to_string(skill_dir.join("SKILL.md"))
            .expect("read upgraded skill")
            .contains("Ponytail, lazy senior dev mode"));
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn sync_windows_mirror_does_not_overwrite_user_owned_skill() {
        let home = temp_home("user-owned");
        let skill_dir = home.join("skills").join("lazy-senior-dev");
        fs::create_dir_all(&skill_dir).expect("create user skill dir");
        fs::write(skill_dir.join("SKILL.md"), "user body").expect("write user skill");
        let settings = settings_with(&["lazy-senior-dev"]);

        sync_windows_curated_skill_mirror(
            Some(home.to_string_lossy().as_ref()),
            Some(&settings),
            true,
        )
        .expect("sync mirror");

        let body = fs::read_to_string(skill_dir.join("SKILL.md")).expect("read skill");
        assert_eq!(body, "user body");
        assert!(!skill_dir.join(SENTINEL_FILE).exists());
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn sync_windows_mirror_removes_disabled_managed_skill() {
        let home = temp_home("disabled");
        let enabled = settings_with(&["lazy-senior-dev"]);
        sync_windows_curated_skill_mirror(
            Some(home.to_string_lossy().as_ref()),
            Some(&enabled),
            true,
        )
        .expect("create mirror");

        sync_windows_curated_skill_mirror(
            Some(home.to_string_lossy().as_ref()),
            Some(&settings_with(&[])),
            true,
        )
        .expect("remove mirror");

        assert!(!home.join("skills").join("lazy-senior-dev").exists());
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn sync_non_windows_mirror_is_noop() {
        let home = temp_home("non-windows");
        let settings = settings_with(&["lazy-senior-dev"]);

        sync_windows_curated_skill_mirror(
            Some(home.to_string_lossy().as_ref()),
            Some(&settings),
            false,
        )
        .expect("noop");

        assert!(!home.join("skills").exists());
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn write_atomic_if_changed_skips_unchanged_content() {
        let home = temp_home("unchanged");
        let path = home.join("SKILL.md");
        fs::write(&path, "same body").expect("seed file");

        let wrote = write_atomic_if_changed(&path, "same body").expect("check unchanged");

        assert!(!wrote);
        assert_eq!(
            fs::read_to_string(&path).expect("read unchanged file"),
            "same body"
        );
        assert!(!path.with_extension("tmp").exists());
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn write_atomic_if_changed_updates_changed_content() {
        let home = temp_home("changed");
        let path = home.join("SKILL.md");
        fs::write(&path, "old body").expect("seed file");

        let wrote = write_atomic_if_changed(&path, "new body").expect("update changed");

        assert!(wrote);
        assert_eq!(
            fs::read_to_string(&path).expect("read changed file"),
            "new body"
        );
        assert!(!path.with_extension("tmp").exists());
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn sync_windows_mirror_writes_activation_hint_file() {
        let home = temp_home("hint");
        let settings = settings_with(&["lazy-senior-dev"]);

        let hint_file = sync_windows_curated_skill_mirror(
            Some(home.to_string_lossy().as_ref()),
            Some(&settings),
            true,
        )
        .expect("sync hint")
        .expect("hint path");

        let hint = fs::read_to_string(&hint_file).expect("read hint");
        let sentinel =
            fs::read_to_string(home.join(HINT_DIR).join(HINT_SENTINEL_FILE)).expect("read marker");
        assert!(hint.contains("lazy-senior-dev"));
        assert!(hint.contains("Skill(skill=\"lazy-senior-dev\")"));
        assert!(!hint.contains("Ponytail, lazy senior dev mode"));
        assert_eq!(sentinel, activation_hint_sentinel_body());
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn sync_windows_mirror_removes_disabled_activation_hint() {
        let home = temp_home("hint-disabled");
        let enabled = settings_with(&["lazy-senior-dev"]);
        sync_windows_curated_skill_mirror(
            Some(home.to_string_lossy().as_ref()),
            Some(&enabled),
            true,
        )
        .expect("create hint");

        let disabled_hint = sync_windows_curated_skill_mirror(
            Some(home.to_string_lossy().as_ref()),
            Some(&settings_with(&[])),
            true,
        )
        .expect("disable hint");

        assert!(disabled_hint.is_none());
        assert!(!home.join(HINT_DIR).join(HINT_FILE).exists());
        assert!(!home.join(HINT_DIR).join(HINT_SENTINEL_FILE).exists());
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn sync_windows_mirror_removes_legacy_activation_hint() {
        let home = temp_home("legacy-hint");
        let legacy_hint_dir = home.join(LEGACY_HINT_DIRS[0]);
        fs::create_dir_all(&legacy_hint_dir).expect("create legacy hint dir");
        fs::write(legacy_hint_dir.join(HINT_FILE), "legacy hint").expect("write legacy hint");
        fs::write(
            legacy_hint_dir.join(LEGACY_HINT_SENTINEL_FILES[0]),
            legacy_activation_hint_sentinel_body(),
        )
        .expect("write legacy hint sentinel");

        sync_windows_curated_skill_mirror(
            Some(home.to_string_lossy().as_ref()),
            Some(&settings_with(&[])),
            true,
        )
        .expect("remove legacy hint");

        assert!(!legacy_hint_dir.join(HINT_FILE).exists());
        assert!(!legacy_hint_dir.join(LEGACY_HINT_SENTINEL_FILES[0]).exists());
        let _ = fs::remove_dir_all(home);
    }
}
