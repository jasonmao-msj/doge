use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::codex::config as codex_config;
use crate::shared::proxy_core;
use crate::storage::write_settings;
use crate::types::{AppSettings, CodexUnifiedExecExternalStatus};

const UI_SCALE_MIN: f64 = 0.8;
const UI_SCALE_MAX: f64 = 2.6;
const UI_SCALE_DEFAULT: f64 = 1.0;
const CANVAS_WIDTH_MODE_NARROW: &str = "narrow";
const CANVAS_WIDTH_MODE_WIDE: &str = "wide";
const LAYOUT_MODE_DEFAULT: &str = "default";
const LAYOUT_MODE_SWAPPED: &str = "swapped";
const THEME_SYSTEM: &str = "system";
const THEME_LIGHT: &str = "light";
const THEME_DARK: &str = "dark";
const THEME_DIM: &str = "dim";
const THEME_CUSTOM: &str = "custom";
const LIGHT_THEME_PRESET_MODERN: &str = "vscode-light-modern";
const LIGHT_THEME_PRESET_PLUS: &str = "vscode-light-plus";
const LIGHT_THEME_PRESET_GITHUB: &str = "vscode-github-light";
const LIGHT_THEME_PRESET_SOLARIZED: &str = "vscode-solarized-light";
const LIGHT_THEME_PRESET_CATPPUCCIN_LATTE: &str = "vscode-catppuccin-latte";
const LIGHT_THEME_PRESET_TOKYO_DAY: &str = "vscode-tokyo-day";
const LIGHT_THEME_PRESET_ROSE_PINE_DAWN: &str = "vscode-rose-pine-dawn";
const LIGHT_THEME_PRESET_EVERFOREST: &str = "vscode-everforest-light";
const LIGHT_THEME_PRESET_AYU: &str = "vscode-ayu-light";
const DARK_THEME_PRESET_MODERN: &str = "vscode-dark-modern";
const DARK_THEME_PRESET_PLUS: &str = "vscode-dark-plus";
const DARK_THEME_PRESET_GITHUB: &str = "vscode-github-dark";
const DARK_THEME_PRESET_GITHUB_DIMMED: &str = "vscode-github-dark-dimmed";
const DARK_THEME_PRESET_ONE_DARK_PRO: &str = "vscode-one-dark-pro";
const DARK_THEME_PRESET_MONOKAI: &str = "vscode-monokai";
const DARK_THEME_PRESET_SOLARIZED: &str = "vscode-solarized-dark";
const DARK_THEME_PRESET_DRACULA: &str = "vscode-dracula";
const DARK_THEME_PRESET_NORD: &str = "vscode-nord";
const DARK_THEME_PRESET_CATPPUCCIN_MOCHA: &str = "vscode-catppuccin-mocha";
const DARK_THEME_PRESET_TOKYO_NIGHT: &str = "vscode-tokyo-night";
const DARK_THEME_PRESET_ROSE_PINE: &str = "vscode-rose-pine";
const PRODUCT_MANAGED_ENGINE_IDS: [&str; 3] = ["claude", "codex", "kimi"];

fn sanitize_ui_scale(scale: f64) -> f64 {
    if !scale.is_finite() || scale < UI_SCALE_MIN || scale > UI_SCALE_MAX {
        return UI_SCALE_DEFAULT;
    }
    (scale * 100.0).round() / 100.0
}

fn sanitize_canvas_width_mode(mode: &str) -> String {
    match mode {
        CANVAS_WIDTH_MODE_NARROW | CANVAS_WIDTH_MODE_WIDE => mode.to_string(),
        _ => CANVAS_WIDTH_MODE_NARROW.to_string(),
    }
}

fn sanitize_layout_mode(mode: &str) -> String {
    match mode {
        LAYOUT_MODE_DEFAULT | LAYOUT_MODE_SWAPPED => mode.to_string(),
        _ => LAYOUT_MODE_DEFAULT.to_string(),
    }
}

fn sanitize_theme(theme: &str) -> String {
    match theme {
        THEME_SYSTEM | THEME_LIGHT | THEME_DARK | THEME_DIM | THEME_CUSTOM => theme.to_string(),
        _ => THEME_SYSTEM.to_string(),
    }
}

fn sanitize_light_theme_preset_id(preset_id: &str) -> String {
    match preset_id {
        LIGHT_THEME_PRESET_MODERN
        | LIGHT_THEME_PRESET_PLUS
        | LIGHT_THEME_PRESET_GITHUB
        | LIGHT_THEME_PRESET_SOLARIZED
        | LIGHT_THEME_PRESET_CATPPUCCIN_LATTE
        | LIGHT_THEME_PRESET_TOKYO_DAY
        | LIGHT_THEME_PRESET_ROSE_PINE_DAWN
        | LIGHT_THEME_PRESET_EVERFOREST
        | LIGHT_THEME_PRESET_AYU => preset_id.to_string(),
        _ => LIGHT_THEME_PRESET_MODERN.to_string(),
    }
}

fn sanitize_dark_theme_preset_id(preset_id: &str) -> String {
    match preset_id {
        DARK_THEME_PRESET_MODERN
        | DARK_THEME_PRESET_PLUS
        | DARK_THEME_PRESET_GITHUB
        | DARK_THEME_PRESET_GITHUB_DIMMED
        | DARK_THEME_PRESET_ONE_DARK_PRO
        | DARK_THEME_PRESET_MONOKAI
        | DARK_THEME_PRESET_SOLARIZED
        | DARK_THEME_PRESET_DRACULA
        | DARK_THEME_PRESET_NORD
        | DARK_THEME_PRESET_CATPPUCCIN_MOCHA
        | DARK_THEME_PRESET_TOKYO_NIGHT
        | DARK_THEME_PRESET_ROSE_PINE => preset_id.to_string(),
        _ => DARK_THEME_PRESET_MODERN.to_string(),
    }
}

fn sanitize_theme_preset_id(preset_id: &str) -> String {
    match preset_id {
        LIGHT_THEME_PRESET_MODERN
        | LIGHT_THEME_PRESET_PLUS
        | LIGHT_THEME_PRESET_GITHUB
        | LIGHT_THEME_PRESET_SOLARIZED
        | LIGHT_THEME_PRESET_CATPPUCCIN_LATTE
        | LIGHT_THEME_PRESET_TOKYO_DAY
        | LIGHT_THEME_PRESET_ROSE_PINE_DAWN
        | LIGHT_THEME_PRESET_EVERFOREST
        | LIGHT_THEME_PRESET_AYU
        | DARK_THEME_PRESET_MODERN
        | DARK_THEME_PRESET_PLUS
        | DARK_THEME_PRESET_GITHUB
        | DARK_THEME_PRESET_GITHUB_DIMMED
        | DARK_THEME_PRESET_ONE_DARK_PRO
        | DARK_THEME_PRESET_MONOKAI
        | DARK_THEME_PRESET_SOLARIZED
        | DARK_THEME_PRESET_DRACULA
        | DARK_THEME_PRESET_NORD
        | DARK_THEME_PRESET_CATPPUCCIN_MOCHA
        | DARK_THEME_PRESET_TOKYO_NIGHT
        | DARK_THEME_PRESET_ROSE_PINE => preset_id.to_string(),
        _ => DARK_THEME_PRESET_MODERN.to_string(),
    }
}

fn resolve_theme_preset_appearance(preset_id: &str) -> &'static str {
    match preset_id {
        LIGHT_THEME_PRESET_MODERN
        | LIGHT_THEME_PRESET_PLUS
        | LIGHT_THEME_PRESET_GITHUB
        | LIGHT_THEME_PRESET_SOLARIZED
        | LIGHT_THEME_PRESET_CATPPUCCIN_LATTE
        | LIGHT_THEME_PRESET_TOKYO_DAY
        | LIGHT_THEME_PRESET_ROSE_PINE_DAWN
        | LIGHT_THEME_PRESET_EVERFOREST
        | LIGHT_THEME_PRESET_AYU => THEME_LIGHT,
        _ => THEME_DARK,
    }
}

fn sanitize_theme_settings(settings: &mut AppSettings) {
    settings.theme = sanitize_theme(&settings.theme);
    settings.canvas_width_mode = sanitize_canvas_width_mode(&settings.canvas_width_mode);
    settings.layout_mode = sanitize_layout_mode(&settings.layout_mode);
    settings.light_theme_preset_id =
        sanitize_light_theme_preset_id(&settings.light_theme_preset_id);
    settings.dark_theme_preset_id = sanitize_dark_theme_preset_id(&settings.dark_theme_preset_id);
    settings.custom_theme_preset_id = sanitize_theme_preset_id(&settings.custom_theme_preset_id);
}

fn sanitize_terminal_shell_path(settings: &mut AppSettings) {
    settings.terminal_shell_path = settings
        .terminal_shell_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(ToOwned::to_owned);
}

fn sanitize_web_service_token(settings: &mut AppSettings) {
    settings.web_service_token = settings
        .web_service_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(ToOwned::to_owned);
}

fn sanitize_custom_skill_directories(settings: &mut AppSettings) {
    let mut seen = HashSet::new();
    settings.custom_skill_directories = settings
        .custom_skill_directories
        .iter()
        .filter_map(|path| {
            let normalized = path.trim();
            if normalized.is_empty() || !seen.insert(normalized.to_string()) {
                return None;
            }
            Some(normalized.to_string())
        })
        .collect();
}

fn sanitize_enabled_curated_skill_ids(settings: &mut AppSettings) {
    settings.enabled_curated_skill_ids =
        crate::curated_skills::normalized_enabled_curated_skill_ids(
            &settings.enabled_curated_skill_ids,
        );
}

fn sanitize_enabled_builtin_agent_ids(settings: &mut AppSettings) {
    settings.enabled_builtin_agent_ids = crate::agent_catalog::normalized_enabled_builtin_agent_ids(
        &settings.enabled_builtin_agent_ids,
    );
}

fn sanitize_disabled_cli_engines(settings: &mut AppSettings) {
    let mut seen = HashSet::new();
    settings.disabled_cli_engines = settings
        .disabled_cli_engines
        .iter()
        .filter_map(|engine_id| {
            let normalized = engine_id.trim();
            if normalized.is_empty()
                || PRODUCT_MANAGED_ENGINE_IDS.contains(&normalized)
                || !seen.insert(normalized.to_string())
            {
                return None;
            }
            Some(normalized.to_string())
        })
        .collect();
}

pub(crate) fn resolve_window_theme_preference(settings: &AppSettings) -> String {
    if settings.theme == THEME_CUSTOM {
        return resolve_theme_preset_appearance(&settings.custom_theme_preset_id).to_string();
    }
    settings.theme.clone()
}

fn validate_ui_scale(scale: f64) -> Result<(), String> {
    if !scale.is_finite() {
        return Err("uiScale must be a finite number".to_string());
    }
    if scale < UI_SCALE_MIN || scale > UI_SCALE_MAX {
        return Err(format!(
            "uiScale must be within [{UI_SCALE_MIN}, {UI_SCALE_MAX}]"
        ));
    }
    Ok(())
}

fn official_unified_exec_default_enabled() -> bool {
    !cfg!(windows)
}

pub(crate) async fn get_app_settings_core(app_settings: &Mutex<AppSettings>) -> AppSettings {
    let mut settings = app_settings.lock().await.clone();
    settings.normalize_unified_exec_policy();
    settings.sanitize_runtime_pool_settings();
    settings.sanitize_engine_gates();
    sanitize_disabled_cli_engines(&mut settings);
    sanitize_terminal_shell_path(&mut settings);
    sanitize_web_service_token(&mut settings);
    sanitize_custom_skill_directories(&mut settings);
    sanitize_enabled_curated_skill_ids(&mut settings);
    sanitize_enabled_builtin_agent_ids(&mut settings);
    settings.experimental_collab_enabled = false;
    settings.ui_scale = sanitize_ui_scale(settings.ui_scale);
    sanitize_theme_settings(&mut settings);
    settings
}

/// One-shot notice recorded when startup quarantines a corrupted settings.json.
/// `backup_file_name` is `None` when the quarantine rename itself failed.
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsRecoveryNotice {
    pub(crate) backup_file_name: Option<String>,
}

/// Take semantics: returns the pending notice once and clears it, so the frontend
/// surfaces the corruption recovery toast exactly once per startup quarantine.
pub(crate) async fn take_settings_recovery_notice_core(
    notice: &Mutex<Option<SettingsRecoveryNotice>>,
) -> Option<SettingsRecoveryNotice> {
    notice.lock().await.take()
}

/// One-shot notice recorded when startup quarantines a corrupted workspaces.json.
/// `backup_file_name` is `None` when the quarantine rename itself failed.
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspacesRecoveryNotice {
    pub(crate) backup_file_name: Option<String>,
}

/// Take semantics: returns the pending notice once and clears it, so the frontend
/// surfaces the corruption recovery toast exactly once per startup quarantine.
pub(crate) async fn take_workspaces_recovery_notice_core(
    notice: &Mutex<Option<WorkspacesRecoveryNotice>>,
) -> Option<WorkspacesRecoveryNotice> {
    notice.lock().await.take()
}

pub(crate) async fn update_app_settings_core(
    settings: AppSettings,
    app_settings: &Mutex<AppSettings>,
    settings_path: &PathBuf,
) -> Result<AppSettings, String> {
    let mut normalized = settings;
    normalized.normalize_unified_exec_policy();
    normalized.experimental_collab_enabled = false;
    normalized.sanitize_runtime_pool_settings();
    normalized.sanitize_engine_gates();
    sanitize_disabled_cli_engines(&mut normalized);
    sanitize_terminal_shell_path(&mut normalized);
    sanitize_web_service_token(&mut normalized);
    sanitize_custom_skill_directories(&mut normalized);
    sanitize_enabled_curated_skill_ids(&mut normalized);
    sanitize_enabled_builtin_agent_ids(&mut normalized);
    sanitize_theme_settings(&mut normalized);
    validate_ui_scale(normalized.ui_scale)?;
    proxy_core::validate_proxy_settings(&normalized)?;
    write_settings(settings_path, &normalized)?;
    proxy_core::apply_app_proxy_settings(&normalized)?;
    let mut current = app_settings.lock().await;
    *current = normalized.clone();
    Ok(normalized)
}

pub(crate) async fn restore_app_settings_core(
    previous: &AppSettings,
    app_settings: &Mutex<AppSettings>,
    settings_path: &PathBuf,
) -> Result<(), String> {
    let mut normalized = previous.clone();
    normalized.normalize_unified_exec_policy();
    normalized.experimental_collab_enabled = false;
    normalized.sanitize_engine_gates();
    sanitize_disabled_cli_engines(&mut normalized);
    sanitize_terminal_shell_path(&mut normalized);
    sanitize_web_service_token(&mut normalized);
    sanitize_custom_skill_directories(&mut normalized);
    sanitize_enabled_curated_skill_ids(&mut normalized);
    sanitize_enabled_builtin_agent_ids(&mut normalized);
    normalized.ui_scale = sanitize_ui_scale(normalized.ui_scale);
    sanitize_theme_settings(&mut normalized);
    write_settings(settings_path, &normalized)?;
    proxy_core::apply_app_proxy_settings(&normalized)?;
    let mut current = app_settings.lock().await;
    *current = normalized;
    Ok(())
}

pub(crate) async fn restart_codex_sessions_for_app_settings_change_core<F, Fut>(
    workspaces: &Mutex<std::collections::HashMap<String, crate::types::WorkspaceEntry>>,
    sessions: &Mutex<
        std::collections::HashMap<String, Arc<crate::backend::app_server::WorkspaceSession>>,
    >,
    app_settings: &Mutex<AppSettings>,
    runtime_manager: Option<&Arc<crate::runtime::RuntimeManager>>,
    spawn_session: F,
) -> Result<(), String>
where
    F: Fn(crate::types::WorkspaceEntry, Option<String>, Option<String>, Option<PathBuf>) -> Fut
        + Copy,
    Fut: std::future::Future<
        Output = Result<Arc<crate::backend::app_server::WorkspaceSession>, String>,
    >,
{
    Box::pin(
        crate::shared::workspaces_core::restart_all_connected_sessions_core(
            workspaces,
            sessions,
            app_settings,
            runtime_manager,
            spawn_session,
        ),
    )
    .await
}

pub(crate) fn app_settings_change_requires_codex_restart(
    previous: &AppSettings,
    updated: &AppSettings,
) -> bool {
    let proxy_changed = previous.system_proxy_enabled != updated.system_proxy_enabled
        || previous.system_proxy_url != updated.system_proxy_url;
    let unified_exec_policy_changed =
        previous.codex_unified_exec_policy != updated.codex_unified_exec_policy;
    let auto_compaction_threshold_changed = previous.codex_auto_compaction_threshold_percent
        != updated.codex_auto_compaction_threshold_percent;
    let auto_compaction_enabled_changed =
        previous.codex_auto_compaction_enabled != updated.codex_auto_compaction_enabled;
    let enabled_curated_skill_ids_changed =
        previous.enabled_curated_skill_ids != updated.enabled_curated_skill_ids;
    proxy_changed
        || unified_exec_policy_changed
        || auto_compaction_threshold_changed
        || auto_compaction_enabled_changed
        || enabled_curated_skill_ids_changed
}

pub(crate) fn get_codex_config_path_core() -> Result<String, String> {
    codex_config::config_toml_path()
        .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())
        .and_then(|path| {
            path.to_str()
                .map(|value| value.to_string())
                .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())
        })
}

pub(crate) fn get_codex_unified_exec_external_status_core(
) -> Result<CodexUnifiedExecExternalStatus, String> {
    let flag_status = codex_config::inspect_unified_exec_override()?;
    Ok(CodexUnifiedExecExternalStatus {
        config_path: codex_config::config_toml_path()
            .and_then(|path| path.to_str().map(|value| value.to_string())),
        has_explicit_unified_exec: flag_status.has_explicit_key,
        explicit_unified_exec_value: flag_status.value,
        official_default_enabled: official_unified_exec_default_enabled(),
    })
}

pub(crate) fn restore_codex_unified_exec_official_default_core(
) -> Result<CodexUnifiedExecExternalStatus, String> {
    codex_config::clear_unified_exec_override()?;
    get_codex_unified_exec_external_status_core()
}

pub(crate) fn set_codex_unified_exec_official_override_core(
    enabled: bool,
) -> Result<CodexUnifiedExecExternalStatus, String> {
    codex_config::write_unified_exec_override(enabled)?;
    get_codex_unified_exec_external_status_core()
}

#[cfg(test)]
mod tests {
    use std::env;
    use std::fs;
    use std::path::Path;
    use std::sync::Mutex as StdMutex;

    use super::{
        app_settings_change_requires_codex_restart, get_app_settings_core,
        get_codex_unified_exec_external_status_core, resolve_window_theme_preference,
        restore_app_settings_core, restore_codex_unified_exec_official_default_core,
        sanitize_canvas_width_mode, sanitize_dark_theme_preset_id, sanitize_layout_mode,
        sanitize_light_theme_preset_id, sanitize_theme, sanitize_theme_preset_id,
        sanitize_ui_scale, set_codex_unified_exec_official_override_core,
        take_settings_recovery_notice_core, take_workspaces_recovery_notice_core,
        update_app_settings_core, validate_ui_scale, SettingsRecoveryNotice,
        WorkspacesRecoveryNotice, DARK_THEME_PRESET_CATPPUCCIN_MOCHA, DARK_THEME_PRESET_DRACULA,
        DARK_THEME_PRESET_GITHUB, DARK_THEME_PRESET_GITHUB_DIMMED, DARK_THEME_PRESET_MODERN,
        DARK_THEME_PRESET_MONOKAI, DARK_THEME_PRESET_NORD, DARK_THEME_PRESET_ONE_DARK_PRO,
        DARK_THEME_PRESET_PLUS, DARK_THEME_PRESET_ROSE_PINE, DARK_THEME_PRESET_SOLARIZED,
        DARK_THEME_PRESET_TOKYO_NIGHT, LIGHT_THEME_PRESET_AYU, LIGHT_THEME_PRESET_CATPPUCCIN_LATTE,
        LIGHT_THEME_PRESET_EVERFOREST, LIGHT_THEME_PRESET_GITHUB, LIGHT_THEME_PRESET_MODERN,
        LIGHT_THEME_PRESET_PLUS, LIGHT_THEME_PRESET_ROSE_PINE_DAWN, LIGHT_THEME_PRESET_SOLARIZED,
        LIGHT_THEME_PRESET_TOKYO_DAY, UI_SCALE_DEFAULT,
    };
    use crate::types::{AppSettings, CodexUnifiedExecPolicy};
    use tokio::sync::Mutex;

    static ENV_LOCK: StdMutex<()> = StdMutex::new(());

    struct CodexHomeTestGuard {
        previous: Option<String>,
        cleanup_path: Option<std::path::PathBuf>,
    }

    impl CodexHomeTestGuard {
        fn new(path: &Path) -> Self {
            let previous = env::var("CODEX_HOME").ok();
            env::set_var("CODEX_HOME", path);
            Self {
                previous,
                cleanup_path: Some(path.to_path_buf()),
            }
        }
    }

    impl Drop for CodexHomeTestGuard {
        fn drop(&mut self) {
            if let Some(previous) = self.previous.take() {
                env::set_var("CODEX_HOME", previous);
            } else {
                env::remove_var("CODEX_HOME");
            }
            if let Some(path) = self.cleanup_path.take() {
                let _ = fs::remove_dir_all(path);
            }
        }
    }

    #[test]
    fn sanitize_ui_scale_falls_back_for_out_of_range() {
        assert!((sanitize_ui_scale(0.2) - UI_SCALE_DEFAULT).abs() < f64::EPSILON);
        assert!((sanitize_ui_scale(2.7) - UI_SCALE_DEFAULT).abs() < f64::EPSILON);
    }

    #[test]
    fn sanitize_ui_scale_keeps_supported_values() {
        assert!((sanitize_ui_scale(0.8) - 0.8).abs() < f64::EPSILON);
        assert!((sanitize_ui_scale(1.25) - 1.25).abs() < f64::EPSILON);
        assert!((sanitize_ui_scale(2.6) - 2.6).abs() < f64::EPSILON);
    }

    #[test]
    fn sanitize_canvas_width_mode_falls_back_for_invalid_values() {
        assert_eq!(sanitize_canvas_width_mode("foo"), "narrow");
        assert_eq!(sanitize_canvas_width_mode(""), "narrow");
    }

    #[test]
    fn sanitize_canvas_width_mode_keeps_supported_values() {
        assert_eq!(sanitize_canvas_width_mode("narrow"), "narrow");
        assert_eq!(sanitize_canvas_width_mode("wide"), "wide");
    }

    #[test]
    fn sanitize_layout_mode_falls_back_for_invalid_values() {
        assert_eq!(sanitize_layout_mode("foo"), "default");
        assert_eq!(sanitize_layout_mode(""), "default");
    }

    #[test]
    fn sanitize_layout_mode_keeps_supported_values() {
        assert_eq!(sanitize_layout_mode("default"), "default");
        assert_eq!(sanitize_layout_mode("swapped"), "swapped");
    }

    #[test]
    fn sanitize_theme_falls_back_for_invalid_values() {
        assert_eq!(sanitize_theme("invalid"), "system");
    }

    #[test]
    fn sanitize_theme_keeps_supported_values() {
        assert_eq!(sanitize_theme("custom"), "custom");
        assert_eq!(sanitize_theme("dark"), "dark");
    }

    #[test]
    fn sanitize_theme_preset_ids_fall_back_for_invalid_values() {
        assert_eq!(
            sanitize_light_theme_preset_id("vscode-dark-modern"),
            LIGHT_THEME_PRESET_MODERN
        );
        assert_eq!(
            sanitize_dark_theme_preset_id("vscode-light-modern"),
            DARK_THEME_PRESET_MODERN
        );
        assert_eq!(
            sanitize_theme_preset_id("invalid"),
            DARK_THEME_PRESET_MODERN
        );
    }

    #[test]
    fn sanitize_theme_preset_ids_keep_supported_values() {
        assert_eq!(
            sanitize_light_theme_preset_id(LIGHT_THEME_PRESET_PLUS),
            LIGHT_THEME_PRESET_PLUS
        );
        assert_eq!(
            sanitize_light_theme_preset_id(LIGHT_THEME_PRESET_GITHUB),
            LIGHT_THEME_PRESET_GITHUB
        );
        assert_eq!(
            sanitize_light_theme_preset_id(LIGHT_THEME_PRESET_SOLARIZED),
            LIGHT_THEME_PRESET_SOLARIZED
        );
        assert_eq!(
            sanitize_light_theme_preset_id(LIGHT_THEME_PRESET_CATPPUCCIN_LATTE),
            LIGHT_THEME_PRESET_CATPPUCCIN_LATTE
        );
        assert_eq!(
            sanitize_light_theme_preset_id(LIGHT_THEME_PRESET_TOKYO_DAY),
            LIGHT_THEME_PRESET_TOKYO_DAY
        );
        assert_eq!(
            sanitize_light_theme_preset_id(LIGHT_THEME_PRESET_ROSE_PINE_DAWN),
            LIGHT_THEME_PRESET_ROSE_PINE_DAWN
        );
        assert_eq!(
            sanitize_light_theme_preset_id(LIGHT_THEME_PRESET_EVERFOREST),
            LIGHT_THEME_PRESET_EVERFOREST
        );
        assert_eq!(
            sanitize_light_theme_preset_id(LIGHT_THEME_PRESET_AYU),
            LIGHT_THEME_PRESET_AYU
        );
        assert_eq!(
            sanitize_dark_theme_preset_id(DARK_THEME_PRESET_PLUS),
            DARK_THEME_PRESET_PLUS
        );
        assert_eq!(
            sanitize_dark_theme_preset_id(DARK_THEME_PRESET_GITHUB),
            DARK_THEME_PRESET_GITHUB
        );
        assert_eq!(
            sanitize_dark_theme_preset_id(DARK_THEME_PRESET_GITHUB_DIMMED),
            DARK_THEME_PRESET_GITHUB_DIMMED
        );
        assert_eq!(
            sanitize_dark_theme_preset_id(DARK_THEME_PRESET_ONE_DARK_PRO),
            DARK_THEME_PRESET_ONE_DARK_PRO
        );
        assert_eq!(
            sanitize_dark_theme_preset_id(DARK_THEME_PRESET_MONOKAI),
            DARK_THEME_PRESET_MONOKAI
        );
        assert_eq!(
            sanitize_dark_theme_preset_id(DARK_THEME_PRESET_SOLARIZED),
            DARK_THEME_PRESET_SOLARIZED
        );
        assert_eq!(
            sanitize_dark_theme_preset_id(DARK_THEME_PRESET_DRACULA),
            DARK_THEME_PRESET_DRACULA
        );
        assert_eq!(
            sanitize_dark_theme_preset_id(DARK_THEME_PRESET_NORD),
            DARK_THEME_PRESET_NORD
        );
        assert_eq!(
            sanitize_dark_theme_preset_id(DARK_THEME_PRESET_CATPPUCCIN_MOCHA),
            DARK_THEME_PRESET_CATPPUCCIN_MOCHA
        );
        assert_eq!(
            sanitize_dark_theme_preset_id(DARK_THEME_PRESET_TOKYO_NIGHT),
            DARK_THEME_PRESET_TOKYO_NIGHT
        );
        assert_eq!(
            sanitize_dark_theme_preset_id(DARK_THEME_PRESET_ROSE_PINE),
            DARK_THEME_PRESET_ROSE_PINE
        );
        assert_eq!(
            sanitize_theme_preset_id(LIGHT_THEME_PRESET_GITHUB),
            LIGHT_THEME_PRESET_GITHUB
        );
        assert_eq!(
            sanitize_theme_preset_id(LIGHT_THEME_PRESET_CATPPUCCIN_LATTE),
            LIGHT_THEME_PRESET_CATPPUCCIN_LATTE
        );
        assert_eq!(
            sanitize_theme_preset_id(DARK_THEME_PRESET_TOKYO_NIGHT),
            DARK_THEME_PRESET_TOKYO_NIGHT
        );
    }

    #[test]
    fn resolve_window_theme_preference_maps_custom_to_preset_appearance() {
        let mut settings = AppSettings::default();
        settings.theme = "custom".to_string();
        settings.custom_theme_preset_id = LIGHT_THEME_PRESET_GITHUB.to_string();
        assert_eq!(resolve_window_theme_preference(&settings), "light");

        settings.custom_theme_preset_id = DARK_THEME_PRESET_ONE_DARK_PRO.to_string();
        assert_eq!(resolve_window_theme_preference(&settings), "dark");

        settings.custom_theme_preset_id = LIGHT_THEME_PRESET_ROSE_PINE_DAWN.to_string();
        assert_eq!(resolve_window_theme_preference(&settings), "light");

        settings.custom_theme_preset_id = DARK_THEME_PRESET_CATPPUCCIN_MOCHA.to_string();
        assert_eq!(resolve_window_theme_preference(&settings), "dark");
    }

    #[test]
    fn validate_ui_scale_rejects_invalid_values() {
        assert!(validate_ui_scale(0.7).is_err());
        assert!(validate_ui_scale(2.7).is_err());
        assert!(validate_ui_scale(f64::NAN).is_err());
    }

    #[test]
    fn app_settings_change_requires_restart_when_proxy_changes() {
        let previous = AppSettings::default();
        let mut updated = previous.clone();
        updated.system_proxy_enabled = !previous.system_proxy_enabled;

        assert!(app_settings_change_requires_codex_restart(
            &previous, &updated
        ));
    }

    #[test]
    fn app_settings_change_requires_restart_when_unified_exec_policy_changes() {
        let previous = AppSettings::default();
        let mut updated = previous.clone();
        updated.codex_unified_exec_policy = CodexUnifiedExecPolicy::ForceEnabled;

        assert!(app_settings_change_requires_codex_restart(
            &previous, &updated
        ));
    }

    #[test]
    fn app_settings_change_requires_restart_when_auto_compaction_threshold_changes() {
        let previous = AppSettings::default();
        let mut updated = previous.clone();
        updated.codex_auto_compaction_threshold_percent = 120;

        assert!(app_settings_change_requires_codex_restart(
            &previous, &updated
        ));
    }

    #[test]
    fn app_settings_change_requires_restart_when_auto_compaction_enabled_changes() {
        let previous = AppSettings::default();
        let mut updated = previous.clone();
        updated.codex_auto_compaction_enabled = false;

        assert!(app_settings_change_requires_codex_restart(
            &previous, &updated
        ));
    }

    #[test]
    fn app_settings_change_skips_restart_for_unrelated_fields() {
        let previous = AppSettings::default();
        let mut updated = previous.clone();
        updated.theme = "dark".to_string();

        assert!(!app_settings_change_requires_codex_restart(
            &previous, &updated
        ));
    }

    #[test]
    fn app_settings_change_skips_restart_for_performance_compatibility_mode() {
        let previous = AppSettings::default();
        let mut updated = previous.clone();
        updated.performance_compatibility_mode_enabled =
            !previous.performance_compatibility_mode_enabled;

        assert!(!app_settings_change_requires_codex_restart(
            &previous, &updated
        ));
    }

    #[test]
    fn enabled_curated_skill_ids_change_requires_restart_when_adding() {
        let mut previous = AppSettings::default();
        previous.enabled_curated_skill_ids.clear();
        let mut updated = previous.clone();
        updated.enabled_curated_skill_ids = vec!["lazy-senior-dev".to_string()];
        assert!(
            app_settings_change_requires_codex_restart(&previous, &updated),
            "toggling curated skill on must restart Codex so app-server developer_instructions refresh"
        );
    }

    #[test]
    fn enabled_curated_skill_ids_change_requires_restart_when_growing() {
        let mut previous = AppSettings::default();
        previous.enabled_curated_skill_ids = vec!["lazy-senior-dev".to_string()];
        let mut updated = previous.clone();
        updated.enabled_curated_skill_ids =
            vec!["lazy-senior-dev".to_string(), "another-skill".to_string()];
        assert!(
            app_settings_change_requires_codex_restart(&previous, &updated),
            "growing the curated set must restart Codex so app-server developer_instructions refresh"
        );
    }

    #[test]
    fn enabled_curated_skill_ids_change_requires_restart_when_clearing() {
        let mut previous = AppSettings::default();
        previous.enabled_curated_skill_ids =
            vec!["lazy-senior-dev".to_string(), "another-skill".to_string()];
        let mut updated = previous.clone();
        updated.enabled_curated_skill_ids.clear();
        assert!(
            app_settings_change_requires_codex_restart(&previous, &updated),
            "clearing the curated set must restart Codex so app-server developer_instructions refresh"
        );
    }

    #[tokio::test]
    async fn take_settings_recovery_notice_core_returns_notice_once_then_clears() {
        let notice = Mutex::new(Some(SettingsRecoveryNotice {
            backup_file_name: Some("settings.json.corrupted-20260724T000000Z.bak".to_string()),
        }));

        let taken = take_settings_recovery_notice_core(&notice).await;
        assert_eq!(
            taken,
            Some(SettingsRecoveryNotice {
                backup_file_name: Some("settings.json.corrupted-20260724T000000Z.bak".to_string()),
            })
        );

        let second_take = take_settings_recovery_notice_core(&notice).await;
        assert_eq!(second_take, None, "notice must be cleared after the take");
    }

    #[tokio::test]
    async fn take_settings_recovery_notice_core_returns_none_when_no_notice() {
        let notice: Mutex<Option<SettingsRecoveryNotice>> = Mutex::new(None);

        let taken = take_settings_recovery_notice_core(&notice).await;

        assert_eq!(taken, None);
    }

    #[tokio::test]
    async fn take_workspaces_recovery_notice_core_returns_notice_once_then_clears() {
        let notice = Mutex::new(Some(WorkspacesRecoveryNotice {
            backup_file_name: Some("workspaces.json.corrupted-20260724T000000Z.bak".to_string()),
        }));

        let taken = take_workspaces_recovery_notice_core(&notice).await;
        assert_eq!(
            taken,
            Some(WorkspacesRecoveryNotice {
                backup_file_name: Some(
                    "workspaces.json.corrupted-20260724T000000Z.bak".to_string()
                ),
            })
        );

        let second_take = take_workspaces_recovery_notice_core(&notice).await;
        assert_eq!(second_take, None, "notice must be cleared after the take");
    }

    #[tokio::test]
    async fn take_workspaces_recovery_notice_core_returns_none_when_no_notice() {
        let notice: Mutex<Option<WorkspacesRecoveryNotice>> = Mutex::new(None);

        let taken = take_workspaces_recovery_notice_core(&notice).await;

        assert_eq!(taken, None);
    }

    #[tokio::test]
    async fn get_app_settings_core_sanitizes_enabled_curated_skill_ids() {
        let mut settings = AppSettings::default();
        settings.enabled_curated_skill_ids = vec![
            " lazy-senior-dev ".to_string(),
            "lazy-senior-dev".to_string(),
            "".to_string(),
            "BadId".to_string(),
            "../escape".to_string(),
            "review2".to_string(),
        ];
        let mutex = Mutex::new(settings);

        let sanitized = get_app_settings_core(&mutex).await;

        assert_eq!(
            sanitized.enabled_curated_skill_ids,
            vec!["lazy-senior-dev".to_string(), "review2".to_string()]
        );
    }

    #[tokio::test]
    async fn settings_core_forces_product_managed_engines_visible() {
        let test_root = env::temp_dir().join(format!(
            "doge-product-engine-visibility-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&test_root);
        fs::create_dir_all(&test_root).unwrap();
        let settings_path = test_root.join("settings.json");

        let mut legacy = AppSettings::default();
        legacy.disabled_cli_engines = vec![
            "claude".to_string(),
            "codex".to_string(),
            "kimi".to_string(),
            " grok ".to_string(),
            "grok".to_string(),
            "opencode".to_string(),
        ];

        let read = get_app_settings_core(&Mutex::new(legacy.clone())).await;
        assert_eq!(
            read.disabled_cli_engines,
            vec!["grok".to_string(), "opencode".to_string()]
        );

        let current = Mutex::new(AppSettings::default());
        let updated = update_app_settings_core(legacy.clone(), &current, &settings_path)
            .await
            .unwrap();
        assert_eq!(
            updated.disabled_cli_engines,
            vec!["grok".to_string(), "opencode".to_string()]
        );

        restore_app_settings_core(&legacy, &current, &settings_path)
            .await
            .unwrap();
        let restored = get_app_settings_core(&current).await;
        assert_eq!(
            restored.disabled_cli_engines,
            vec!["grok".to_string(), "opencode".to_string()]
        );

        let persisted: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&settings_path).unwrap()).unwrap();
        assert_eq!(
            persisted.get("disabledCliEngines"),
            Some(&serde_json::json!(["grok", "opencode"]))
        );
        let _ = fs::remove_dir_all(&test_root);
    }

    #[tokio::test]
    async fn get_app_settings_core_sanitizes_terminal_shell_path() {
        let mut settings = AppSettings::default();
        settings.terminal_shell_path =
            Some("  C:\\Program Files\\PowerShell\\7\\pwsh.exe  ".to_string());

        let resolved = get_app_settings_core(&Mutex::new(settings)).await;

        assert_eq!(
            resolved.terminal_shell_path.as_deref(),
            Some("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
        );

        let mut blank_settings = AppSettings::default();
        blank_settings.terminal_shell_path = Some("   ".to_string());

        let resolved_blank = get_app_settings_core(&Mutex::new(blank_settings)).await;

        assert_eq!(resolved_blank.terminal_shell_path, None);
    }

    #[tokio::test]
    async fn get_app_settings_core_sanitizes_web_service_token() {
        let mut settings = AppSettings::default();
        settings.web_service_token = Some("  durable-token  ".to_string());

        let resolved = get_app_settings_core(&Mutex::new(settings)).await;

        assert_eq!(resolved.web_service_token.as_deref(), Some("durable-token"));

        let mut blank_settings = AppSettings::default();
        blank_settings.web_service_token = Some("   ".to_string());

        let resolved_blank = get_app_settings_core(&Mutex::new(blank_settings)).await;

        assert_eq!(resolved_blank.web_service_token, None);
    }

    #[tokio::test]
    async fn get_app_settings_core_ignores_external_unified_exec_override() {
        let _guard = ENV_LOCK.lock().unwrap();
        let codex_home =
            env::temp_dir().join(format!("ccgui-settings-core-{}", std::process::id()));
        let _ = fs::remove_dir_all(&codex_home);
        fs::create_dir_all(&codex_home).unwrap();
        fs::write(
            codex_home.join("config.toml"),
            "[features]\ncollab = true\ncollaboration_modes = false\nsteer = true\ncollaboration_mode_enforcement = false\nunified_exec = true\n",
        )
        .unwrap();
        let _codex_home_guard = CodexHomeTestGuard::new(&codex_home);

        let mut settings = AppSettings::default();
        settings.experimental_collab_enabled = true;
        settings.experimental_collaboration_modes_enabled = true;
        settings.experimental_steer_enabled = false;
        settings.codex_mode_enforcement_enabled = true;
        settings.codex_unified_exec_policy = CodexUnifiedExecPolicy::Inherit;

        let resolved = get_app_settings_core(&Mutex::new(settings)).await;

        assert!(!resolved.experimental_collab_enabled);
        assert!(resolved.experimental_collaboration_modes_enabled);
        assert!(!resolved.experimental_steer_enabled);
        assert!(resolved.codex_mode_enforcement_enabled);
        assert_eq!(
            resolved.codex_unified_exec_policy,
            CodexUnifiedExecPolicy::Inherit
        );
    }

    #[tokio::test]
    async fn update_app_settings_core_stops_syncing_unified_exec_to_external_config() {
        let _guard = ENV_LOCK.lock().unwrap();
        let test_root =
            env::temp_dir().join(format!("ccgui-settings-core-update-{}", std::process::id()));
        let _ = fs::remove_dir_all(&test_root);
        fs::create_dir_all(&test_root).unwrap();
        let codex_home = test_root.join("codex-home");
        fs::create_dir_all(&codex_home).unwrap();
        let settings_path = test_root.join("settings.json");
        let _codex_home_guard = CodexHomeTestGuard::new(&codex_home);

        let mut settings = AppSettings::default();
        settings.experimental_collab_enabled = true;
        settings.experimental_collaboration_modes_enabled = true;
        settings.experimental_steer_enabled = true;
        settings.codex_mode_enforcement_enabled = false;
        settings.codex_unified_exec_policy = CodexUnifiedExecPolicy::ForceEnabled;

        let result = update_app_settings_core(
            settings,
            &Mutex::new(AppSettings::default()),
            &settings_path,
        )
        .await
        .unwrap();

        assert!(!result.experimental_collab_enabled);
        assert!(!codex_home.join("config.toml").exists());
        let _ = fs::remove_dir_all(&test_root);
    }

    #[tokio::test]
    async fn get_app_settings_core_resets_legacy_unified_exec_true_to_inherit() {
        let mut settings = AppSettings::default();
        settings.experimental_unified_exec_enabled = Some(true);

        let resolved = get_app_settings_core(&Mutex::new(settings)).await;

        assert_eq!(
            resolved.codex_unified_exec_policy,
            CodexUnifiedExecPolicy::Inherit
        );
        assert_eq!(resolved.experimental_unified_exec_enabled, None);
    }

    #[test]
    fn unified_exec_external_status_reports_explicit_override() {
        let _guard = ENV_LOCK.lock().unwrap();
        let codex_home =
            env::temp_dir().join(format!("ccgui-settings-core-status-{}", std::process::id()));
        let _ = fs::remove_dir_all(&codex_home);
        fs::create_dir_all(&codex_home).unwrap();
        fs::write(
            codex_home.join("config.toml"),
            "[features]\nunified_exec = false\n",
        )
        .unwrap();
        let _codex_home_guard = CodexHomeTestGuard::new(&codex_home);

        let status = get_codex_unified_exec_external_status_core().unwrap();

        assert!(status.has_explicit_unified_exec);
        assert_eq!(status.explicit_unified_exec_value, Some(false));
        assert_eq!(status.official_default_enabled, !cfg!(windows));
    }

    #[test]
    fn restore_codex_unified_exec_official_default_removes_override() {
        let _guard = ENV_LOCK.lock().unwrap();
        let codex_home =
            env::temp_dir().join(format!("ccgui-settings-core-repair-{}", std::process::id()));
        let _ = fs::remove_dir_all(&codex_home);
        fs::create_dir_all(&codex_home).unwrap();
        fs::write(
            codex_home.join("config.toml"),
            "[features]\nunified_exec = true\nsteer = false\n",
        )
        .unwrap();
        let _codex_home_guard = CodexHomeTestGuard::new(&codex_home);

        let status = restore_codex_unified_exec_official_default_core().unwrap();
        let config_contents = fs::read_to_string(codex_home.join("config.toml")).unwrap();

        assert!(!status.has_explicit_unified_exec);
        assert_eq!(status.explicit_unified_exec_value, None);
        assert!(!config_contents.contains("unified_exec ="));
        assert!(config_contents.contains("steer = false"));
    }

    #[test]
    fn set_codex_unified_exec_official_override_writes_explicit_value() {
        let _guard = ENV_LOCK.lock().unwrap();
        let codex_home =
            env::temp_dir().join(format!("ccgui-settings-core-set-{}", std::process::id()));
        let _ = fs::remove_dir_all(&codex_home);
        fs::create_dir_all(&codex_home).unwrap();
        let _codex_home_guard = CodexHomeTestGuard::new(&codex_home);

        let status = set_codex_unified_exec_official_override_core(true).unwrap();
        let config_contents = fs::read_to_string(codex_home.join("config.toml")).unwrap();

        assert!(status.has_explicit_unified_exec);
        assert_eq!(status.explicit_unified_exec_value, Some(true));
        assert!(config_contents.contains("unified_exec = true"));
    }
}
