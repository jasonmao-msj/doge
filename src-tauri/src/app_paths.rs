use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const APP_HOME_DIR_NAME: &str = ".doge";
const LEGACY_APP_HOME_DIR_NAMES: &[&str] = &[".ccgui", ".mossx", ".codemoss"];
const MIGRATION_SENTINEL_FILENAME: &str = ".migration.json";
const MIGRATION_SCHEMA_VERSION: u8 = 1;

pub(crate) fn app_home_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Unable to resolve home directory")?;
    ensure_app_home_dir_from_home(&home)
}

pub(crate) fn config_file_path() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("config.json"))
}

pub(crate) fn client_storage_dir() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("client"))
}

pub(crate) fn error_log_dir() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("error-log"))
}

pub(crate) fn input_history_file_path() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("inputHistory.json"))
}

pub(crate) fn project_memory_dir() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("project-memory"))
}

pub(crate) fn codex_provider_homes_dir() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("codex-provider-homes"))
}

pub(crate) fn kimi_provider_homes_dir() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("kimi-provider-homes"))
}

pub(crate) fn grok_provider_homes_dir() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("grok-provider-homes"))
}

pub(crate) fn project_canvas_dir() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("project-canvas"))
}

pub(crate) fn note_card_dir() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("note_card"))
}

pub(crate) fn agent_file_path() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("agent.json"))
}

pub(crate) fn workspace_root_candidates() -> Result<Vec<PathBuf>, String> {
    let home = dirs::home_dir().ok_or("Unable to resolve home directory")?;
    Ok(workspace_root_candidates_from_home(&home))
}

pub(crate) fn project_local_data_dir(
    workspace_root: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
    {
        return Err(format!("Invalid project-local data path: {relative_path}"));
    }

    let current = workspace_root.join(APP_HOME_DIR_NAME).join(relative);
    if current.exists() {
        return Ok(current);
    }

    for legacy_name in LEGACY_APP_HOME_DIR_NAMES {
        let legacy = workspace_root.join(legacy_name).join(relative);
        if !legacy.exists() {
            continue;
        }
        copy_dir_recursive(&legacy, &current)?;
        let source = format!(
            "{legacy_name}/{}",
            relative.to_string_lossy().replace('\\', "/")
        );
        write_migration_sentinel(&current, &source)?;
        return Ok(current);
    }

    Ok(current)
}

pub(crate) fn prepare_app_data_dir(current_data_dir: &Path) -> Result<(), String> {
    prepare_app_data_dir_from_path(current_data_dir)
}

fn ensure_app_home_dir_from_home(home: &Path) -> Result<PathBuf, String> {
    let current = home.join(APP_HOME_DIR_NAME);
    if current.exists() {
        return Ok(current);
    }

    for legacy_name in LEGACY_APP_HOME_DIR_NAMES {
        let legacy_path = home.join(legacy_name);
        if !legacy_path.exists() {
            continue;
        }
        copy_dir_recursive(&legacy_path, &current)?;
        write_migration_sentinel(&current, legacy_name)?;
        return Ok(current);
    }

    Ok(current)
}

fn workspace_root_candidates_from_home(home: &Path) -> Vec<PathBuf> {
    let mut roots = vec![home.join(APP_HOME_DIR_NAME).join("workspace")];
    for legacy in LEGACY_APP_HOME_DIR_NAMES {
        roots.push(home.join(legacy).join("workspace"));
    }
    roots.push(home.join(".moss-x").join("workspace"));
    roots
}

fn prepare_app_data_dir_from_path(current_data_dir: &Path) -> Result<(), String> {
    if has_existing_app_data(current_data_dir) {
        return Ok(());
    }

    let Some(parent_dir) = current_data_dir.parent() else {
        return Ok(());
    };

    for legacy_dir in legacy_app_data_candidates(parent_dir) {
        if !legacy_dir.exists() || !has_existing_app_data(&legacy_dir) {
            continue;
        }
        copy_dir_recursive(&legacy_dir, current_data_dir)?;
        let source_name = legacy_dir
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("legacy-app-data");
        write_migration_sentinel(current_data_dir, source_name)?;
        return Ok(());
    }

    Ok(())
}

fn has_existing_app_data(dir: &Path) -> bool {
    has_valid_json_file(&dir.join("workspaces.json"))
        || has_valid_json_file(&dir.join("settings.json"))
        || dir.join("workspaces").is_dir()
        || dir.join("models").is_dir()
}

fn has_valid_json_file(path: &Path) -> bool {
    path.is_file()
        && fs::read_to_string(path)
            .ok()
            .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
            .is_some()
}

fn legacy_app_data_candidates(parent_dir: &Path) -> Vec<PathBuf> {
    [
        "com.zhukunpenglinyutong.ccgui",
        "com.zhukunpenglinyutong.codemoss",
        "com.zhukunpenglinyutong.mossx",
        "com.dimillian.codemoss",
    ]
    .into_iter()
    .map(|name| parent_dir.join(name))
    .collect()
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    if source.is_file() {
        copy_file(source, destination)?;
        return Ok(());
    }

    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    let entries = fs::read_dir(source).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| error.to_string())?;

        if file_type.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
            continue;
        }

        if file_type.is_file() {
            copy_file(&source_path, &destination_path)?;
            continue;
        }

        if file_type.is_symlink() {
            let resolved = source_path
                .canonicalize()
                .unwrap_or_else(|_| source_path.clone());
            if resolved.is_dir() {
                copy_dir_recursive(&resolved, &destination_path)?;
            } else if resolved.is_file() {
                copy_file(&resolved, &destination_path)?;
            }
        }
    }

    Ok(())
}

fn copy_file(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        return Ok(());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(source, destination)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn write_migration_sentinel(destination: &Path, legacy_name: &str) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    let migrated_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let payload = serde_json::json!({
        "schemaVersion": MIGRATION_SCHEMA_VERSION,
        "source": legacy_name,
        "migratedAtMs": migrated_at_ms,
    })
    .to_string();
    fs::write(destination.join(MIGRATION_SENTINEL_FILENAME), payload)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn resolves_fresh_install_to_doge_home() {
        let base = std::env::temp_dir().join(format!("doge-home-fresh-{}", Uuid::new_v4()));

        let resolved = ensure_app_home_dir_from_home(&base).expect("resolve fresh app home");

        assert_eq!(resolved, base.join(".doge"));
        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn prefers_existing_doge_home_without_overwriting_it() {
        let base = std::env::temp_dir().join(format!("doge-home-existing-{}", Uuid::new_v4()));
        let doge_dir = base.join(".doge");
        let ccgui_dir = base.join(".ccgui");
        std::fs::create_dir_all(&doge_dir).expect("create .doge");
        std::fs::create_dir_all(&ccgui_dir).expect("create .ccgui");
        std::fs::write(doge_dir.join("config.json"), "{\"brand\":\"doge\"}").expect("write doge");
        std::fs::write(ccgui_dir.join("config.json"), "{\"brand\":\"ccgui\"}")
            .expect("write ccgui");

        let resolved = ensure_app_home_dir_from_home(&base).expect("resolve app home");

        assert_eq!(resolved, doge_dir);
        assert_eq!(
            std::fs::read_to_string(doge_dir.join("config.json")).expect("read doge"),
            "{\"brand\":\"doge\"}",
        );

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn migrates_ccgui_home_into_doge_before_older_candidates() {
        let base = std::env::temp_dir().join(format!("doge-home-migrate-ccgui-{}", Uuid::new_v4()));
        let ccgui_dir = base.join(".ccgui");
        let mossx_dir = base.join(".mossx");
        std::fs::create_dir_all(ccgui_dir.join("client")).expect("create ccgui client dir");
        std::fs::create_dir_all(mossx_dir.join("client")).expect("create mossx client dir");
        std::fs::write(ccgui_dir.join("config.json"), "{\"brand\":\"ccgui\"}")
            .expect("write ccgui");
        std::fs::write(mossx_dir.join("config.json"), "{\"brand\":\"mossx\"}")
            .expect("write mossx");
        std::fs::write(
            ccgui_dir.join("client").join("layout.json"),
            "{\"sidebarWidth\":320}",
        )
        .expect("write legacy layout");

        let resolved = ensure_app_home_dir_from_home(&base).expect("resolve migrated app home");
        let doge_dir = base.join(".doge");

        assert_eq!(resolved, doge_dir);
        assert_eq!(
            std::fs::read_to_string(doge_dir.join("config.json")).expect("read migrated config"),
            "{\"brand\":\"ccgui\"}",
        );
        assert!(ccgui_dir.join("client").join("layout.json").exists());
        let sentinel = std::fs::read_to_string(doge_dir.join(MIGRATION_SENTINEL_FILENAME))
            .expect("read migration sentinel");
        assert!(sentinel.contains("\"schemaVersion\":1"));
        assert!(sentinel.contains("\"source\":\".ccgui\""));
        assert!(!sentinel.contains(&base.to_string_lossy().to_string()));

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn migrates_mossx_only_home_into_doge() {
        let base = std::env::temp_dir().join(format!("doge-home-mossx-only-{}", Uuid::new_v4()));
        let mossx_dir = base.join(".mossx");
        std::fs::create_dir_all(&mossx_dir).expect("create mossx app home");
        std::fs::write(mossx_dir.join("config.json"), r#"{"source":"mossx"}"#)
            .expect("write mossx config");

        let doge_dir = ensure_app_home_dir_from_home(&base).expect("migrate mossx app home");
        let sentinel: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(doge_dir.join(MIGRATION_SENTINEL_FILENAME))
                .expect("read migration sentinel"),
        )
        .expect("parse migration sentinel");

        assert_eq!(
            std::fs::read_to_string(doge_dir.join("config.json")).expect("read migrated config"),
            r#"{"source":"mossx"}"#,
        );
        assert_eq!(sentinel["source"], ".mossx");
        assert!(mossx_dir.join("config.json").is_file());

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn repeated_app_home_migration_keeps_doge_changes_and_legacy_source() {
        let base = std::env::temp_dir().join(format!("doge-home-idempotent-{}", Uuid::new_v4()));
        let legacy_dir = base.join(".ccgui");
        std::fs::create_dir_all(&legacy_dir).expect("create legacy app home");
        std::fs::write(legacy_dir.join("config.json"), r#"{"revision":1}"#)
            .expect("write legacy config");

        let doge_dir = ensure_app_home_dir_from_home(&base).expect("first migration");
        let first_sentinel = std::fs::read_to_string(doge_dir.join(MIGRATION_SENTINEL_FILENAME))
            .expect("read first sentinel");
        std::fs::write(doge_dir.join("config.json"), r#"{"revision":2}"#)
            .expect("update doge config");

        ensure_app_home_dir_from_home(&base).expect("repeat migration");

        assert_eq!(
            std::fs::read_to_string(doge_dir.join("config.json")).expect("read doge config"),
            r#"{"revision":2}"#,
        );
        assert_eq!(
            std::fs::read_to_string(legacy_dir.join("config.json")).expect("read legacy config"),
            r#"{"revision":1}"#,
        );
        assert_eq!(
            std::fs::read_to_string(doge_dir.join(MIGRATION_SENTINEL_FILENAME))
                .expect("read repeated sentinel"),
            first_sentinel,
        );

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn migration_sentinel_never_serializes_file_contents_or_absolute_paths() {
        let base =
            std::env::temp_dir().join(format!("doge-home-private-migration-{}", Uuid::new_v4()));
        let legacy_dir = base.join(".ccgui");
        let fake_secret = "sk-doge-private-fixture-123456";
        std::fs::create_dir_all(&legacy_dir).expect("create legacy app home");
        std::fs::write(
            legacy_dir.join("config.json"),
            format!(r#"{{"apiKey":"{fake_secret}","token":"fixture-token"}}"#),
        )
        .expect("write secret-bearing legacy fixture");

        let doge_dir = ensure_app_home_dir_from_home(&base).expect("migrate legacy app home");
        let sentinel_text = std::fs::read_to_string(doge_dir.join(MIGRATION_SENTINEL_FILENAME))
            .expect("read migration sentinel");
        let sentinel: serde_json::Value =
            serde_json::from_str(&sentinel_text).expect("parse migration sentinel");

        assert_eq!(sentinel["schemaVersion"], MIGRATION_SCHEMA_VERSION);
        assert_eq!(sentinel["source"], ".ccgui");
        assert!(sentinel["migratedAtMs"].is_number());
        assert_eq!(sentinel.as_object().map(serde_json::Map::len), Some(3));
        assert!(!sentinel_text.contains(fake_secret));
        assert!(!sentinel_text.contains("fixture-token"));
        assert!(!sentinel_text.contains(&base.to_string_lossy().to_string()));

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn falls_back_to_codemoss_when_mossx_is_missing() {
        let base =
            std::env::temp_dir().join(format!("doge-home-migrate-codemoss-{}", Uuid::new_v4()));
        let codemoss_dir = base.join(".codemoss");
        std::fs::create_dir_all(&codemoss_dir).expect("create codemoss dir");
        std::fs::write(codemoss_dir.join("agent.json"), "{\"id\":\"legacy-agent\"}")
            .expect("write codemoss agent");

        let resolved = ensure_app_home_dir_from_home(&base).expect("resolve migrated app home");
        let doge_dir = base.join(".doge");

        assert_eq!(resolved, doge_dir);
        assert_eq!(
            std::fs::read_to_string(doge_dir.join("agent.json")).expect("read migrated agent"),
            "{\"id\":\"legacy-agent\"}",
        );

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn workspace_root_candidates_put_doge_first_and_keep_legacy_paths() {
        let home = PathBuf::from("/Users/demo");

        let roots = workspace_root_candidates_from_home(&home);

        assert_eq!(roots[0], home.join(".doge").join("workspace"));
        assert!(roots.contains(&home.join(".ccgui").join("workspace")));
        assert!(roots.contains(&home.join(".mossx").join("workspace")));
        assert!(roots.contains(&home.join(".codemoss").join("workspace")));
        assert!(roots.contains(&home.join(".moss-x").join("workspace")));
    }

    #[test]
    fn migrates_project_local_ccgui_data_into_doge() {
        let workspace = std::env::temp_dir().join(format!("doge-project-local-{}", Uuid::new_v4()));
        let legacy_dir = workspace.join(".ccgui").join("project-map");
        std::fs::create_dir_all(legacy_dir.join("project-12345678"))
            .expect("create legacy project map");
        std::fs::write(
            legacy_dir.join("project-12345678").join("manifest.json"),
            "{\"storageKey\":\"project-12345678\"}",
        )
        .expect("write legacy manifest");

        let resolved = project_local_data_dir(&workspace, "project-map")
            .expect("resolve migrated project-local data");

        assert_eq!(resolved, workspace.join(".doge").join("project-map"));
        assert_eq!(
            std::fs::read_to_string(resolved.join("project-12345678").join("manifest.json"))
                .expect("read migrated manifest"),
            "{\"storageKey\":\"project-12345678\"}",
        );
        let sentinel = std::fs::read_to_string(resolved.join(MIGRATION_SENTINEL_FILENAME))
            .expect("read project-local migration sentinel");
        assert!(sentinel.contains("\"source\":\".ccgui/project-map\""));
        assert!(!sentinel.contains(&workspace.to_string_lossy().to_string()));

        std::fs::remove_dir_all(&workspace).ok();
    }

    #[test]
    fn preserves_existing_doge_project_local_data() {
        let workspace =
            std::env::temp_dir().join(format!("doge-project-local-wins-{}", Uuid::new_v4()));
        let doge_dir = workspace.join(".doge").join("project-map");
        let legacy_dir = workspace.join(".ccgui").join("project-map");
        std::fs::create_dir_all(&doge_dir).expect("create doge project map");
        std::fs::create_dir_all(&legacy_dir).expect("create legacy project map");
        std::fs::write(doge_dir.join("manifest.json"), "doge").expect("write doge manifest");
        std::fs::write(legacy_dir.join("manifest.json"), "legacy").expect("write legacy manifest");

        let resolved = project_local_data_dir(&workspace, "project-map")
            .expect("resolve current project-local data");

        assert_eq!(resolved, doge_dir);
        assert_eq!(
            std::fs::read_to_string(resolved.join("manifest.json"))
                .expect("read preserved manifest"),
            "doge",
        );

        std::fs::remove_dir_all(&workspace).ok();
    }

    #[test]
    fn migrates_legacy_app_data_when_new_bundle_dir_only_has_window_state() {
        let base = std::env::temp_dir().join(format!("doge-app-data-{}", Uuid::new_v4()));
        let legacy_dir = base.join("com.zhukunpenglinyutong.ccgui");
        let current_dir = base.join("io.github.jasonmao-msj.doge");

        std::fs::create_dir_all(legacy_dir.join("workspaces"))
            .expect("create legacy workspaces dir");
        std::fs::create_dir_all(&current_dir).expect("create current dir");
        std::fs::write(current_dir.join(".window-state.json"), "{\"window\":true}")
            .expect("write current window state");
        std::fs::write(legacy_dir.join("workspaces.json"), "{\"workspace\":1}")
            .expect("write legacy workspaces");
        std::fs::write(legacy_dir.join("settings.json"), "{\"theme\":\"light\"}")
            .expect("write legacy settings");
        std::fs::write(legacy_dir.join("workspaces").join("note.txt"), "hello")
            .expect("write legacy workspace payload");

        prepare_app_data_dir_from_path(&current_dir).expect("prepare app data");

        assert_eq!(
            std::fs::read_to_string(current_dir.join("workspaces.json"))
                .expect("read migrated workspaces"),
            "{\"workspace\":1}",
        );
        assert_eq!(
            std::fs::read_to_string(current_dir.join("settings.json"))
                .expect("read migrated settings"),
            "{\"theme\":\"light\"}",
        );
        assert_eq!(
            std::fs::read_to_string(current_dir.join("workspaces").join("note.txt"))
                .expect("read migrated workspace payload"),
            "hello",
        );
        assert_eq!(
            std::fs::read_to_string(current_dir.join(".window-state.json"))
                .expect("read preserved window state"),
            "{\"window\":true}",
        );

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn skips_empty_bundle_candidate_and_uses_next_valid_source() {
        let base = std::env::temp_dir().join(format!("doge-app-data-empty-{}", Uuid::new_v4()));
        let empty_first = base.join("com.zhukunpenglinyutong.ccgui");
        let valid_second = base.join("com.zhukunpenglinyutong.codemoss");
        let current_dir = base.join("io.github.jasonmao-msj.doge");
        std::fs::create_dir_all(&empty_first).expect("create empty first candidate");
        std::fs::create_dir_all(&valid_second).expect("create valid second candidate");
        std::fs::write(valid_second.join("settings.json"), r#"{"source":"second"}"#)
            .expect("write valid settings");

        prepare_app_data_dir_from_path(&current_dir).expect("prepare app data");
        let sentinel: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(current_dir.join(MIGRATION_SENTINEL_FILENAME))
                .expect("read migration sentinel"),
        )
        .expect("parse migration sentinel");

        assert_eq!(
            std::fs::read_to_string(current_dir.join("settings.json"))
                .expect("read migrated settings"),
            r#"{"source":"second"}"#,
        );
        assert_eq!(sentinel["source"], "com.zhukunpenglinyutong.codemoss");

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn skips_corrupt_and_non_app_data_bundle_candidates() {
        let base = std::env::temp_dir().join(format!("doge-app-data-invalid-{}", Uuid::new_v4()));
        let corrupt_first = base.join("com.zhukunpenglinyutong.ccgui");
        let unrelated_second = base.join("com.zhukunpenglinyutong.codemoss");
        let valid_third = base.join("com.zhukunpenglinyutong.mossx");
        let current_dir = base.join("io.github.jasonmao-msj.doge");
        std::fs::create_dir_all(&corrupt_first).expect("create corrupt first candidate");
        std::fs::create_dir_all(&unrelated_second).expect("create unrelated second candidate");
        std::fs::create_dir_all(valid_third.join("models")).expect("create valid third candidate");
        std::fs::write(corrupt_first.join("settings.json"), "not-json")
            .expect("write corrupt settings");
        std::fs::write(unrelated_second.join("readme.txt"), "not app data")
            .expect("write unrelated file");
        std::fs::write(
            valid_third.join("models").join("model.json"),
            r#"{"id":"model"}"#,
        )
        .expect("write valid model");

        prepare_app_data_dir_from_path(&current_dir).expect("prepare app data");
        let sentinel: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(current_dir.join(MIGRATION_SENTINEL_FILENAME))
                .expect("read migration sentinel"),
        )
        .expect("parse migration sentinel");

        assert!(current_dir.join("models").join("model.json").is_file());
        assert!(!current_dir.join("settings.json").exists());
        assert!(!current_dir.join("readme.txt").exists());
        assert_eq!(sentinel["source"], "com.zhukunpenglinyutong.mossx");

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn multiple_valid_bundle_candidates_use_documented_priority() {
        let base = std::env::temp_dir().join(format!("doge-app-data-priority-{}", Uuid::new_v4()));
        let first = base.join("com.zhukunpenglinyutong.ccgui");
        let second = base.join("com.zhukunpenglinyutong.codemoss");
        let current_dir = base.join("io.github.jasonmao-msj.doge");
        std::fs::create_dir_all(&first).expect("create first candidate");
        std::fs::create_dir_all(&second).expect("create second candidate");
        std::fs::write(first.join("settings.json"), r#"{"priority":1}"#)
            .expect("write first settings");
        std::fs::write(second.join("settings.json"), r#"{"priority":2}"#)
            .expect("write second settings");

        prepare_app_data_dir_from_path(&current_dir).expect("prepare app data");
        let sentinel: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(current_dir.join(MIGRATION_SENTINEL_FILENAME))
                .expect("read migration sentinel"),
        )
        .expect("parse migration sentinel");

        assert_eq!(
            std::fs::read_to_string(current_dir.join("settings.json"))
                .expect("read migrated settings"),
            r#"{"priority":1}"#,
        );
        assert_eq!(sentinel["source"], "com.zhukunpenglinyutong.ccgui");

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn repeated_bundle_migration_keeps_doge_changes_and_legacy_source() {
        let base =
            std::env::temp_dir().join(format!("doge-app-data-idempotent-{}", Uuid::new_v4()));
        let legacy_dir = base.join("com.zhukunpenglinyutong.ccgui");
        let current_dir = base.join("io.github.jasonmao-msj.doge");
        std::fs::create_dir_all(&legacy_dir).expect("create legacy candidate");
        std::fs::write(legacy_dir.join("workspaces.json"), r#"{"revision":1}"#)
            .expect("write legacy workspaces");

        prepare_app_data_dir_from_path(&current_dir).expect("first migration");
        let first_sentinel = std::fs::read_to_string(current_dir.join(MIGRATION_SENTINEL_FILENAME))
            .expect("read first sentinel");
        std::fs::write(current_dir.join("workspaces.json"), r#"{"revision":2}"#)
            .expect("update doge workspaces");

        prepare_app_data_dir_from_path(&current_dir).expect("repeat migration");

        assert_eq!(
            std::fs::read_to_string(current_dir.join("workspaces.json"))
                .expect("read doge workspaces"),
            r#"{"revision":2}"#,
        );
        assert_eq!(
            std::fs::read_to_string(legacy_dir.join("workspaces.json"))
                .expect("read legacy workspaces"),
            r#"{"revision":1}"#,
        );
        assert_eq!(
            std::fs::read_to_string(current_dir.join(MIGRATION_SENTINEL_FILENAME))
                .expect("read repeated sentinel"),
            first_sentinel,
        );

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn does_not_overwrite_existing_doge_app_data() {
        let base = std::env::temp_dir().join(format!("doge-app-data-preserve-{}", Uuid::new_v4()));
        let legacy_dir = base.join("com.zhukunpenglinyutong.ccgui");
        let current_dir = base.join("io.github.jasonmao-msj.doge");

        std::fs::create_dir_all(&legacy_dir).expect("create legacy dir");
        std::fs::create_dir_all(&current_dir).expect("create current dir");
        std::fs::write(legacy_dir.join("workspaces.json"), "{\"workspace\":1}")
            .expect("write legacy workspaces");
        std::fs::write(current_dir.join("workspaces.json"), "{\"workspace\":2}")
            .expect("write current workspaces");

        prepare_app_data_dir_from_path(&current_dir).expect("prepare app data");

        assert_eq!(
            std::fs::read_to_string(current_dir.join("workspaces.json"))
                .expect("read current workspaces"),
            "{\"workspace\":2}",
        );

        std::fs::remove_dir_all(&base).ok();
    }
}
