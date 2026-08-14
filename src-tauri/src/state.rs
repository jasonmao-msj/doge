use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;
use tokio::sync::Mutex;

use crate::app_paths;
use crate::dictation::DictationState;
use crate::engine::{EngineConfig, EngineManager, EngineType};
use crate::shared::proxy_core;
use crate::shared::settings_core::{SettingsRecoveryNotice, WorkspacesRecoveryNotice};
use crate::storage::{backup_corrupted_file, read_settings, read_workspaces};
use crate::types::{AppSettings, WorkspaceEntry};
use crate::workspaces::DetachedExternalChangeRuntime;

pub(crate) struct AppState {
    pub(crate) account_runtime: crate::account::AccountRuntime,
    pub(crate) workspaces: Mutex<HashMap<String, WorkspaceEntry>>,
    pub(crate) sessions: Mutex<HashMap<String, Arc<crate::codex::WorkspaceSession>>>,
    pub(crate) terminal_sessions: Mutex<HashMap<String, Arc<crate::terminal::TerminalSession>>>,
    pub(crate) runtime_log_sessions:
        Mutex<HashMap<String, crate::runtime_log::RuntimeSessionRecord>>,
    pub(crate) browser_sessions: Mutex<HashMap<String, crate::browser_agent::BrowserSession>>,
    pub(crate) browser_evidence:
        Mutex<HashMap<String, crate::browser_agent::BrowserEvidenceRecord>>,
    pub(crate) remote_backend: Mutex<Option<crate::remote_backend::RemoteBackend>>,
    pub(crate) storage_path: PathBuf,
    pub(crate) settings_path: PathBuf,
    pub(crate) app_settings: Mutex<AppSettings>,
    /// One-shot notice recorded when startup quarantines a corrupted settings.json;
    /// consumed by the `take_settings_recovery_notice` command exactly once.
    pub(crate) settings_recovery_notice: Mutex<Option<SettingsRecoveryNotice>>,
    /// One-shot notice recorded when startup quarantines a corrupted workspaces.json;
    /// consumed by the `take_workspaces_recovery_notice` command exactly once.
    pub(crate) workspaces_recovery_notice: Mutex<Option<WorkspacesRecoveryNotice>>,
    pub(crate) codex_runtime_reload_lock: Mutex<()>,
    pub(crate) computer_use_activation_lock: Mutex<()>,
    pub(crate) computer_use_activation_verification:
        Mutex<Option<crate::computer_use::ComputerUseActivationVerification>>,
    pub(crate) dictation: Mutex<DictationState>,
    pub(crate) codex_login_cancels: Mutex<HashMap<String, oneshot::Sender<()>>>,
    pub(crate) detached_external_change_runtime: Mutex<DetachedExternalChangeRuntime>,
    pub(crate) claude_commands_watches: Mutex<crate::claude_commands_watch::CommandsWatchRegistry>,
    pub(crate) runtime_manager: Arc<crate::runtime::RuntimeManager>,
    pub(crate) shared_event_writer: Option<crate::shared_event_log::SharedEventWriter>,
    pub(crate) shared_runtime_coordinator:
        crate::shared_runtime_coordinator::SharedRuntimeCoordinator,
    pub(crate) renderer_heartbeats: Mutex<crate::renderer_stability::RendererHeartbeatStore>,
    pub(crate) semantic_navigation_runtime: crate::code_intel_lsp::SemanticNavigationRuntime,
    pub(crate) engine_manager: EngineManager,
}

impl AppState {
    /// Push current app_settings binary paths into the EngineManager so that
    /// new engine sessions pick up user-configured CLI paths (e.g. reclaude).
    /// Also drops cached Claude sessions whose bin_path is stale so the next
    /// turn rebuilds them with the new config.
    pub(crate) async fn sync_engine_configs_from_settings(&self) {
        let settings = self.app_settings.lock().await.clone();

        let new_claude_bin = settings.claude_bin.clone();
        let previous_claude_bin = self
            .engine_manager
            .get_engine_config(EngineType::Claude)
            .await
            .and_then(|cfg| cfg.bin_path);

        self.engine_manager
            .set_engine_config(
                EngineType::Claude,
                EngineConfig {
                    bin_path: new_claude_bin.clone(),
                    ..Default::default()
                },
            )
            .await;

        if previous_claude_bin != new_claude_bin {
            let workspace_ids = self
                .engine_manager
                .claude_manager
                .list_sessions()
                .await
                .into_iter()
                .map(|(workspace_id, _session)| workspace_id)
                .collect::<HashSet<_>>();
            for workspace_id in workspace_ids {
                self.engine_manager
                    .remove_claude_session(&workspace_id)
                    .await;
            }
        }

        self.engine_manager
            .set_engine_config(
                EngineType::Codex,
                EngineConfig {
                    bin_path: settings.codex_bin.clone(),
                    custom_args: settings.codex_args.clone(),
                    ..Default::default()
                },
            )
            .await;

        self.engine_manager
            .set_engine_config(
                EngineType::OpenCode,
                EngineConfig {
                    bin_path: settings.opencode_bin.clone(),
                    ..Default::default()
                },
            )
            .await;
    }

    pub(crate) fn load(app: &AppHandle) -> Self {
        let data_dir = app
            .path()
            .app_data_dir()
            .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| ".".into()));
        if let Err(error) = app_paths::prepare_app_data_dir(&data_dir) {
            eprintln!("[storage] failed to prepare app data dir migration: {error}");
        }
        let storage_path = data_dir.join("workspaces.json");
        let settings_path = data_dir.join("settings.json");
        let mut workspaces_recovery_notice = None;
        let workspaces = read_workspaces(&storage_path).unwrap_or_else(|error| {
            // Quarantine the corrupted file first so a later save never destroys it,
            // and record a one-shot notice so the frontend can tell the user what happened.
            let backup_path = backup_corrupted_file(&storage_path, &error);
            workspaces_recovery_notice = Some(WorkspacesRecoveryNotice {
                backup_file_name: backup_path
                    .as_ref()
                    .and_then(|path| path.file_name())
                    .map(|name| name.to_string_lossy().into_owned()),
            });
            HashMap::new()
        });
        let mut settings_recovery_notice = None;
        let app_settings = read_settings(&settings_path).unwrap_or_else(|error| {
            // Quarantine the corrupted file first so a later save never destroys it,
            // and record a one-shot notice so the frontend can tell the user what happened.
            let backup_path = backup_corrupted_file(&settings_path, &error);
            settings_recovery_notice = Some(SettingsRecoveryNotice {
                backup_file_name: backup_path
                    .as_ref()
                    .and_then(|path| path.file_name())
                    .map(|name| name.to_string_lossy().into_owned()),
            });
            AppSettings::default()
        });
        if let Err(error) = proxy_core::apply_app_proxy_settings(&app_settings) {
            eprintln!("[proxy] failed to apply persisted proxy settings: {error}");
        }
        let runtime_manager = Arc::new(crate::runtime::RuntimeManager::new(&data_dir));
        runtime_manager.orphan_sweep_on_startup(app_settings.runtime_orphan_sweep_on_launch);
        let shared_event_writer = match crate::shared_event_log::open(
            &data_dir.join("shared-event-log-v2.sqlite3"),
        ) {
            Ok(crate::shared_event_log::OpenOutcome::Ready(writer)) => Some(writer),
            Ok(crate::shared_event_log::OpenOutcome::ReadOnlyRecovery { reason, .. }) => {
                eprintln!(
                        "[shared-event-log] read-only recovery active; shadow writes disabled: {reason:?}"
                    );
                None
            }
            Err(error) => {
                eprintln!("[shared-event-log] failed to open shadow store: {error}");
                None
            }
        };
        let engine_manager = EngineManager::new();
        let claude_resume_diagnostics_runtime = Arc::clone(&runtime_manager);
        engine_manager
            .claude_manager
            .set_ask_user_question_resume_diagnostic_sink(Some(Arc::new(move |diagnostic| {
                let runtime_manager = Arc::clone(&claude_resume_diagnostics_runtime);
                tauri::async_runtime::spawn(async move {
                    runtime_manager
                        .record_claude_ask_user_question_resume_result(
                            &diagnostic.workspace_id,
                            diagnostic.thread_id.as_deref(),
                            Some(diagnostic.turn_id.as_str()),
                            diagnostic.request_id.as_deref(),
                            diagnostic.succeeded,
                            diagnostic.error.as_deref(),
                        )
                        .await;
                });
            })));
        let account_runtime = crate::account::AccountRuntime::load(&data_dir);
        account_runtime.install_external_wakeup_bridge(app.clone());
        Self {
            account_runtime,
            workspaces: Mutex::new(workspaces),
            sessions: Mutex::new(HashMap::new()),
            terminal_sessions: Mutex::new(HashMap::new()),
            runtime_log_sessions: Mutex::new(HashMap::new()),
            browser_sessions: Mutex::new(HashMap::new()),
            browser_evidence: Mutex::new(HashMap::new()),
            remote_backend: Mutex::new(None),
            storage_path,
            settings_path,
            app_settings: Mutex::new(app_settings),
            settings_recovery_notice: Mutex::new(settings_recovery_notice),
            workspaces_recovery_notice: Mutex::new(workspaces_recovery_notice),
            codex_runtime_reload_lock: Mutex::new(()),
            computer_use_activation_lock: Mutex::new(()),
            computer_use_activation_verification: Mutex::new(None),
            dictation: Mutex::new(DictationState::default()),
            codex_login_cancels: Mutex::new(HashMap::new()),
            detached_external_change_runtime: Mutex::new(DetachedExternalChangeRuntime::default()),
            claude_commands_watches: Mutex::new(
                crate::claude_commands_watch::CommandsWatchRegistry::default(),
            ),
            runtime_manager,
            shared_event_writer,
            shared_runtime_coordinator:
                crate::shared_runtime_coordinator::SharedRuntimeCoordinator::default(),
            renderer_heartbeats: Mutex::new(
                crate::renderer_stability::RendererHeartbeatStore::default(),
            ),
            semantic_navigation_runtime: crate::code_intel_lsp::SemanticNavigationRuntime::new(
                crate::code_intel_lsp::cache_root_for_channel(&data_dir, cfg!(debug_assertions)),
            ),
            engine_manager,
        }
    }
}
