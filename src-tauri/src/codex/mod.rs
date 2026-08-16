use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;
use tokio::time::timeout;

pub(crate) mod args;
pub(crate) mod collaboration_policy;
mod commit_message;
pub(crate) mod config;
mod doctor;
pub(crate) mod home;
mod installer;
pub(crate) mod launch_profile;
mod mcp_config;
mod model_selection;
mod provider_fork;
pub(crate) mod provider_profile;
pub(crate) mod rewind;
mod run_metadata;
mod session_runtime;
mod start_thread_retry;
mod thread_listing;
pub(crate) mod thread_mode_state;

use self::args::resolve_workspace_codex_args;
use self::commit_message::{build_commit_message_prompt, combine_repository_diff_sections};
pub(crate) use self::doctor::{
    run_claude_doctor_with_settings, run_codex_doctor_with_settings, run_grok_doctor_with_settings,
    run_kimi_doctor_with_settings, run_opencode_doctor_with_settings,
};
pub(crate) use self::home::{resolve_default_codex_home, resolve_workspace_codex_home};
pub(crate) use self::installer::{
    build_cli_install_plan_with_backend, resolve_cli_version_status,
    run_cli_installer_with_progress, CliInstallAction, CliInstallBackend, CliInstallEngine,
    CliInstallProgressEvent, CliInstallStrategy, CliVersionStatus,
};
use self::mcp_config::{
    list_global_mcp_servers as list_global_mcp_servers_impl,
    set_global_mcp_server_enabled as set_global_mcp_server_enabled_impl, GlobalMcpServerEntry,
};
use self::model_selection::{normalize_model_id, pick_model_from_model_list_response};
use self::provider_fork::resolve_codex_provider_history_path;

pub(crate) async fn resolve_codex_native_history_path(
    state: &AppState,
    workspace_id: &str,
    thread_id: &str,
    provider_profile_id: &str,
) -> Result<std::path::PathBuf, String> {
    resolve_codex_provider_history_path(state, workspace_id, thread_id, provider_profile_id).await
}
use self::provider_profile::{resolve_codex_provider_profile, CODEX_DISK_PROVIDER_PROFILE_ID};
use self::run_metadata::{extract_json_value, sanitize_run_worktree_name};
use self::thread_listing::{
    build_unified_codex_thread_page, resolve_provider_scoped_fallback_model,
};
use crate::backend::app_server::{
    spawn_workspace_session_inner_with_settings, CodexAppServerLaunchOptions,
};
pub(crate) use crate::backend::app_server::{ResumePendingSource, WorkspaceSession};
use crate::backend::events::AppServerEvent;
use crate::engine::{EngineType, SendMessageParams};
use crate::event_sink::build_event_sink;
use crate::local_usage;
use crate::remote_backend;
use crate::session_management::CodexProviderBinding;
use crate::shared::workspaces_core::disconnect_workspace_session_core;
use crate::shared::{codex_core, thread_titles_core};
use crate::state::AppState;
use crate::types::{AppSettings, WorkspaceEntry};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommitMessageRepositorySelection {
    repository_root: String,
    selected_paths: Vec<String>,
}

async fn collect_commit_message_diff(
    workspace_id: &str,
    state: &State<'_, AppState>,
    selected_paths: Option<&[String]>,
    repository_selections: Option<&[CommitMessageRepositorySelection]>,
) -> Result<String, String> {
    let Some(repository_selections) = repository_selections else {
        return crate::git::get_workspace_diff_for_commit_scope(
            workspace_id,
            state,
            selected_paths,
            None,
        )
        .await;
    };
    if repository_selections.is_empty() {
        return Ok(String::new());
    }

    let mut sections = Vec::with_capacity(repository_selections.len());
    for selection in repository_selections {
        let diff = crate::git::get_workspace_diff_for_commit_scope(
            workspace_id,
            state,
            Some(&selection.selected_paths),
            Some(&selection.repository_root),
        )
        .await?;
        let repository_label = if selection.repository_root.is_empty() {
            "."
        } else {
            selection.repository_root.as_str()
        };
        sections.push((repository_label.to_string(), diff));
    }
    Ok(combine_repository_diff_sections(sections))
}

fn codex_turn_developer_instructions(settings: &AppSettings) -> Option<String> {
    crate::backend::app_server_cli::codex_generated_developer_instructions_for_turn(settings)
}

fn hidden_auto_session_metadata(
    session_purpose: &str,
    owner_feature: &str,
) -> crate::session_management::AutoSessionMetadata {
    crate::session_management::AutoSessionMetadata {
        session_purpose: session_purpose.to_string(),
        visibility: crate::session_management::AutoSessionVisibility::Hidden,
        owner_feature: owner_feature.to_string(),
        auto_archive: Some(true),
        created_by: crate::session_management::AutoSessionCreatedBy::System,
    }
}

async fn record_hidden_codex_helper_thread(
    state: &AppState,
    workspace_id: &str,
    thread_id: &str,
    session_purpose: &str,
    owner_feature: &str,
) {
    let _ = crate::session_management::record_auto_session_metadata_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id.to_string(),
        thread_id.to_string(),
        hidden_auto_session_metadata(session_purpose, owner_feature),
    )
    .await;
}

async fn resolve_thread_provider_profile_id(
    state: &AppState,
    workspace_id: &str,
    thread_id: &str,
) -> String {
    let metadata = crate::session_management::read_codex_provider_bindings(
        state.storage_path.as_path(),
        workspace_id,
    )
    .unwrap_or_default();
    codex_provider_binding_lookup_keys(workspace_id, thread_id)
        .into_iter()
        .find_map(|key| metadata.get(&key).cloned())
        .map(|binding| binding.provider_profile_id.clone())
        .unwrap_or_else(|| CODEX_DISK_PROVIDER_PROFILE_ID.to_string())
}

fn codex_provider_binding_lookup_keys(workspace_id: &str, thread_id: &str) -> Vec<String> {
    let workspace_id = workspace_id.trim();
    let thread_id = thread_id.trim();
    let mut keys = Vec::new();
    if thread_id.is_empty() {
        return keys;
    }
    if !workspace_id.is_empty() {
        keys.push(format!("codex:{workspace_id}:{thread_id}"));
        keys.push(format!("codex::{workspace_id}::{thread_id}"));
    }
    keys.push(thread_id.to_string());
    if let Some(raw_thread_id) = thread_id.strip_prefix("codex:") {
        if !raw_thread_id.trim().is_empty() {
            keys.push(raw_thread_id.trim().to_string());
        }
    } else {
        keys.push(format!("codex:{thread_id}"));
    }
    let mut unique_keys = Vec::new();
    for key in keys {
        if !unique_keys.contains(&key) {
            unique_keys.push(key);
        }
    }
    unique_keys
}

pub(crate) async fn record_codex_provider_binding(
    state: &AppState,
    workspace_id: &str,
    thread_id: &str,
    provider_profile_id: &str,
) {
    let binding = match resolve_codex_provider_profile(Some(provider_profile_id)) {
        Ok(profile) => profile.binding(),
        Err(_) => CodexProviderBinding::disk().unavailable(),
    };
    let _ = crate::session_management::record_codex_provider_binding_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id.to_string(),
        thread_id.to_string(),
        binding,
    )
    .await;
}

pub(crate) async fn record_codex_provider_binding_checked(
    state: &AppState,
    workspace_id: &str,
    thread_id: &str,
    provider_profile_id: &str,
) -> Result<(), String> {
    let binding = resolve_codex_provider_profile(Some(provider_profile_id))?.binding();
    crate::session_management::record_codex_provider_binding_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id.to_string(),
        thread_id.to_string(),
        binding,
    )
    .await
}

pub(crate) use self::session_runtime::ensure_codex_session;
pub(crate) use self::session_runtime::{
    attach_hook_safe_fallback_metadata, create_session_runtime_recovering_error,
    ensure_codex_session_for_provider, ensure_codex_session_without_session_hooks_for_provider,
    is_create_session_runtime_recovery_error, is_hook_safe_fallback_trigger,
};
pub(crate) use self::start_thread_retry::start_thread_with_runtime_retry_for_provider;
#[cfg(test)]
use self::start_thread_retry::{
    run_start_thread_with_hook_safe_fallback,
    run_start_thread_with_hook_safe_fallback_and_recovery_probe, run_start_thread_with_retry,
    run_start_thread_with_retry_and_recovery_probe,
};

const DELETE_ARCHIVE_TIMEOUT_MS: u64 = 2_000;

fn emit_manual_compaction_event(
    app: &AppHandle,
    workspace_id: String,
    method: &str,
    params: Value,
) {
    let _ = app.emit(
        "app-server-event",
        AppServerEvent {
            workspace_id,
            message: json!({
                "method": method,
                "params": params,
            }),
        },
    );
}

async fn compact_claude_thread(
    workspace_id: String,
    thread_id: String,
    provider_profile_id_override: Option<String>,
    state: &AppState,
    app: &AppHandle,
) -> Result<Value, String> {
    let session_id = thread_id
        .strip_prefix("claude:")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Claude thread id is invalid: {thread_id}"))?
        .to_string();

    let workspace_entry = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .cloned()
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let workspace_path = PathBuf::from(&workspace_entry.path);
    let provider_profile_id = match provider_profile_id_override {
        Some(provider_profile_id) => Some(provider_profile_id),
        None => crate::session_management::resolve_engine_provider_profile_id(
            state.storage_path.as_path(),
            &workspace_id,
            Some(&session_id),
            "claude",
            None,
        )?,
    };
    let provider_launch_profile = state
        .account_runtime
        .hydrate_managed_claude_launch_profile(
            crate::engine::claude::resolve_claude_provider_launch_profile(
                provider_profile_id.as_deref(),
            )?,
        )
        .await?;
    let session = state
        .engine_manager
        .get_claude_session_for_provider(
            &workspace_id,
            &workspace_path,
            provider_profile_id.as_deref(),
        )
        .await;

    emit_manual_compaction_event(
        app,
        workspace_id.clone(),
        "thread/compacting",
        json!({
            "threadId": &thread_id,
            "thread_id": &thread_id,
            "auto": false,
            "manual": true,
        }),
    );

    let turn_id = format!("claude-compact-{}", uuid::Uuid::new_v4());
    let params = SendMessageParams {
        text: "/compact".to_string(),
        images: None,
        continue_session: true,
        session_id: Some(session_id),
        ..Default::default()
    };

    // No outer wall-clock cap: /compact is an LLM summarization over the whole
    // conversation and legitimately takes minutes on a large context. send_message
    // already has a 90s first-event watchdog (claude.rs) guarding a true hang, and
    // the auto-compact path (lifecycle.rs) runs uncapped too — matching it here.
    let app_settings = state.app_settings.lock().await.clone();
    let compact_result = session
        .send_message_with_app_settings_and_provider_env(
            params,
            &turn_id,
            Some(&app_settings),
            provider_launch_profile.as_ref().map(|profile| &profile.env),
        )
        .await;

    match compact_result {
        Ok(result_text) => {
            emit_manual_compaction_event(
                app,
                workspace_id,
                "thread/compacted",
                json!({
                    "threadId": &thread_id,
                    "thread_id": &thread_id,
                    "turnId": &turn_id,
                    "turn_id": &turn_id,
                    "auto": false,
                    "manual": true,
                }),
            );
            Ok(json!({
                "threadId": &thread_id,
                "turnId": &turn_id,
                "text": result_text,
                "status": "completed",
                "engine": "claude",
            }))
        }
        Err(error) => {
            emit_manual_compaction_event(
                app,
                workspace_id,
                "thread/compactionFailed",
                json!({
                    "threadId": &thread_id,
                    "thread_id": &thread_id,
                    "auto": false,
                    "manual": true,
                    "reason": error,
                }),
            );
            Err(error)
        }
    }
}

pub(crate) async fn spawn_workspace_session(
    entry: WorkspaceEntry,
    default_codex_bin: Option<String>,
    codex_args: Option<String>,
    app_handle: AppHandle,
    codex_home: Option<PathBuf>,
) -> Result<Arc<WorkspaceSession>, String> {
    let provider_runtime_key = crate::codex::provider_profile::legacy_codex_runtime_key(&entry.id);
    spawn_workspace_session_with_launch_options(
        entry,
        default_codex_bin,
        codex_args,
        app_handle,
        codex_home,
        provider_runtime_key,
        CodexAppServerLaunchOptions::primary(),
        std::collections::BTreeMap::new(),
    )
    .await
}

pub(crate) async fn spawn_workspace_session_with_launch_options(
    entry: WorkspaceEntry,
    default_codex_bin: Option<String>,
    codex_args: Option<String>,
    app_handle: AppHandle,
    codex_home: Option<PathBuf>,
    provider_runtime_key: String,
    launch_options: CodexAppServerLaunchOptions,
    launch_env: std::collections::BTreeMap<String, String>,
) -> Result<Arc<WorkspaceSession>, String> {
    let client_version = app_handle.package_info().version.to_string();
    let app_settings_snapshot = {
        let state = app_handle.state::<AppState>();
        let settings = state.app_settings.lock().await.clone();
        settings
    };
    let (auto_compaction_threshold_percent, auto_compaction_enabled) = (
        f64::from(app_settings_snapshot.codex_auto_compaction_threshold_percent),
        app_settings_snapshot.codex_auto_compaction_enabled,
    );
    let event_sink = build_event_sink(app_handle);
    spawn_workspace_session_inner_with_settings(
        entry,
        default_codex_bin,
        codex_args,
        codex_home,
        client_version,
        auto_compaction_threshold_percent,
        auto_compaction_enabled,
        event_sink,
        launch_options,
        provider_runtime_key,
        app_settings_snapshot,
        launch_env,
    )
    .await
}

#[tauri::command]
pub(crate) async fn codex_doctor(
    codex_bin: Option<String>,
    codex_args: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let codex_bin = codex_bin.map(remote_backend::normalize_path_for_remote);
        return remote_backend::call_remote(
            &*state,
            app,
            "codex_doctor",
            json!({ "codexBin": codex_bin, "codexArgs": codex_args }),
        )
        .await;
    }

    let settings = state.app_settings.lock().await.clone();
    run_codex_doctor_with_settings(codex_bin, codex_args, &settings).await
}

#[tauri::command]
pub(crate) async fn codex_preview_launch_profile(
    codex_bin: Option<String>,
    codex_args: Option<String>,
    workspace_id: Option<String>,
    use_workspace_draft: Option<bool>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let codex_bin = codex_bin.map(remote_backend::normalize_path_for_remote);
        return remote_backend::call_remote(
            &*state,
            app,
            "codex_preview_launch_profile",
            json!({
                "codexBin": codex_bin,
                "codexArgs": codex_args,
                "workspaceId": workspace_id,
                "useWorkspaceDraft": use_workspace_draft.unwrap_or(false),
            }),
        )
        .await;
    }

    let settings = state.app_settings.lock().await.clone();
    if let Some(workspace_id) = workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let workspaces = state.workspaces.lock().await.clone();
        return launch_profile::preview_workspace_codex_launch_profile(
            workspace_id,
            codex_bin,
            codex_args,
            use_workspace_draft.unwrap_or(false),
            &workspaces,
            &settings,
        );
    }

    Ok(launch_profile::preview_global_codex_launch_profile(
        codex_bin, codex_args, &settings,
    ))
}

pub(crate) fn remote_claude_doctor_request(claude_bin: Option<String>) -> (&'static str, Value) {
    (
        "claude_doctor",
        json!({
            "claudeBin": claude_bin.map(remote_backend::normalize_path_for_remote),
        }),
    )
}

pub(crate) fn remote_kimi_doctor_request(kimi_bin: Option<String>) -> (&'static str, Value) {
    (
        "kimi_doctor",
        json!({
            "kimiBin": kimi_bin.map(remote_backend::normalize_path_for_remote),
        }),
    )
}

pub(crate) fn remote_grok_doctor_request(grok_bin: Option<String>) -> (&'static str, Value) {
    (
        "grok_doctor",
        json!({
            "grokBin": grok_bin.map(remote_backend::normalize_path_for_remote),
        }),
    )
}

pub(crate) fn remote_opencode_doctor_request(
    opencode_bin: Option<String>,
) -> (&'static str, Value) {
    (
        "opencode_doctor",
        json!({
            "opencodeBin": opencode_bin.map(remote_backend::normalize_path_for_remote),
        }),
    )
}

#[tauri::command]
pub(crate) async fn opencode_doctor(
    opencode_bin: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let (method, params) = remote_opencode_doctor_request(opencode_bin);
        return remote_backend::call_remote(&*state, app, method, params).await;
    }

    let settings = state.app_settings.lock().await.clone();
    run_opencode_doctor_with_settings(opencode_bin, &settings).await
}

#[tauri::command]
pub(crate) async fn kimi_doctor(
    kimi_bin: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let (method, params) = remote_kimi_doctor_request(kimi_bin);
        return remote_backend::call_remote(&*state, app, method, params).await;
    }

    let settings = state.app_settings.lock().await.clone();
    run_kimi_doctor_with_settings(kimi_bin, &settings).await
}

#[tauri::command]
pub(crate) async fn grok_doctor(
    grok_bin: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let (method, params) = remote_grok_doctor_request(grok_bin);
        return remote_backend::call_remote(&*state, app, method, params).await;
    }

    let settings = state.app_settings.lock().await.clone();
    run_grok_doctor_with_settings(grok_bin, &settings).await
}

#[tauri::command]
pub(crate) async fn claude_doctor(
    claude_bin: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let (method, params) = remote_claude_doctor_request(claude_bin);
        return remote_backend::call_remote(&*state, app, method, params).await;
    }

    let settings = state.app_settings.lock().await.clone();
    run_claude_doctor_with_settings(claude_bin, &settings).await
}

#[tauri::command]
pub(crate) async fn cli_version_status(
    engine: CliInstallEngine,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "cli_version_status",
            json!({ "engine": engine }),
        )
        .await
        .map_err(|error| {
            if error.contains("unknown method") || error.contains("unsupported") {
                "Remote daemon does not support CLI version status RPC. Update the daemon or switch backend mode to local.".to_string()
            } else {
                error
            }
        });
    }

    let settings = state.app_settings.lock().await.clone();
    let status = resolve_cli_version_status(engine, &settings).await;
    serde_json::to_value(status).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn cli_install_plan(
    engine: CliInstallEngine,
    action: CliInstallAction,
    strategy: CliInstallStrategy,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "cli_install_plan",
            json!({ "engine": engine, "action": action, "strategy": strategy }),
        )
        .await
        .map_err(|error| {
            if error.contains("unknown method") || error.contains("unsupported") {
                "Remote daemon does not support CLI installer RPC. Update the daemon or switch backend mode to local.".to_string()
            } else {
                error
            }
        });
    }

    let settings = state.app_settings.lock().await.clone();
    let plan = build_cli_install_plan_with_backend(
        engine,
        action,
        strategy,
        CliInstallBackend::Local,
        &settings,
    )
    .await;
    serde_json::to_value(plan).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn cli_install_run(
    engine: CliInstallEngine,
    action: CliInstallAction,
    strategy: CliInstallStrategy,
    run_id: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "cli_install_run",
            json!({ "engine": engine, "action": action, "strategy": strategy, "runId": run_id }),
        )
        .await
        .map_err(|error| {
            if error.contains("unknown method") || error.contains("unsupported") {
                "Remote daemon does not support CLI installer RPC. Update the daemon or switch backend mode to local.".to_string()
            } else {
                error
            }
        });
    }

    let settings = state.app_settings.lock().await.clone();
    let event_app = app.clone();
    let progress_sink = std::sync::Arc::new(move |event: CliInstallProgressEvent| {
        let _ = event_app.emit("cli-installer-event", event);
    });
    let result = run_cli_installer_with_progress(
        engine,
        action,
        strategy,
        &settings,
        run_id,
        Some(progress_sink),
    )
    .await?;
    serde_json::to_value(result).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn start_thread(
    workspace_id: String,
    auto_session: Option<crate::session_management::AutoSessionMetadata>,
    provider_profile_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "start_thread",
            json!({
                "workspaceId": workspace_id,
                "autoSession": auto_session,
                "providerProfileId": provider_profile_id
            }),
        )
        .await;
    }

    let normalized_provider_profile_id =
        codex_core::normalize_provider_profile_id(provider_profile_id.as_deref());
    let resolved_model = resolve_provider_scoped_fallback_model(
        &state,
        &workspace_id,
        &normalized_provider_profile_id,
    )
    .await?;
    let response = start_thread_with_runtime_retry_for_provider(
        &workspace_id,
        resolved_model,
        Some(normalized_provider_profile_id.clone()),
        &state,
        &app,
    )
    .await?;
    if let Some(thread_id) = crate::shared::codex_core::extract_thread_id_from_response(&response) {
        record_codex_provider_binding(
            &state,
            &workspace_id,
            &thread_id,
            &normalized_provider_profile_id,
        )
        .await;
    }
    if let Some(metadata) = auto_session {
        if let Some(thread_id) =
            crate::shared::codex_core::extract_thread_id_from_response(&response)
        {
            let _ = crate::session_management::record_auto_session_metadata_core(
                &state.workspaces,
                state.storage_path.as_path(),
                workspace_id,
                thread_id,
                metadata,
            )
            .await;
        }
    }
    Ok(response)
}

#[tauri::command]
pub(crate) async fn resume_thread(
    workspace_id: String,
    thread_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "resume_thread",
            json!({ "workspaceId": workspace_id, "threadId": thread_id }),
        )
        .await;
    }

    // Ensure Codex session exists before resuming thread
    let provider_profile_id =
        resolve_thread_provider_profile_id(&state, &workspace_id, &thread_id).await;
    ensure_codex_session_for_provider(&workspace_id, &provider_profile_id, &state, &app).await?;

    codex_core::resume_thread_core(
        &state.sessions,
        workspace_id,
        Some(provider_profile_id),
        thread_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn fork_thread(
    workspace_id: String,
    thread_id: String,
    message_id: Option<String>,
    provider_profile_id: Option<String>,
    target_user_turn_index: Option<u32>,
    target_user_message_text: Option<String>,
    target_user_message_occurrence: Option<u32>,
    local_user_message_count: Option<u32>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "fork_thread",
            json!({
                "workspaceId": workspace_id,
                "threadId": thread_id,
                "messageId": message_id,
                "providerProfileId": provider_profile_id,
                "targetUserTurnIndex": target_user_turn_index,
                "targetUserMessageText": target_user_message_text,
                "targetUserMessageOccurrence": target_user_message_occurrence,
                "localUserMessageCount": local_user_message_count
            }),
        )
        .await;
    }

    let parent_provider_profile_id =
        resolve_thread_provider_profile_id(&state, &workspace_id, &thread_id).await;
    let selected_provider_profile_id = provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| parent_provider_profile_id.clone());
    let _selected_provider_profile =
        resolve_codex_provider_profile(Some(&selected_provider_profile_id))?;
    if selected_provider_profile_id != parent_provider_profile_id {
        return Err(
            "cross-provider-fork-moved-to-continuation: use 使用其他 Provider 继续".to_string(),
        );
    }
    ensure_codex_session_for_provider(&workspace_id, &parent_provider_profile_id, &state, &app)
        .await?;
    let resolved_message_id = rewind::resolve_fork_message_id(
        &state.sessions,
        workspace_id.clone(),
        thread_id.clone(),
        message_id,
        target_user_turn_index,
        target_user_message_text,
        target_user_message_occurrence,
        local_user_message_count,
        Some(parent_provider_profile_id.clone()),
    )
    .await?;
    let response = codex_core::fork_thread_core(
        &state.sessions,
        workspace_id.clone(),
        Some(parent_provider_profile_id.clone()),
        thread_id.clone(),
        resolved_message_id,
    )
    .await?;
    if let Some(child_thread_id) =
        crate::shared::codex_core::extract_thread_id_from_response(&response)
    {
        record_codex_provider_binding(
            &state,
            &workspace_id,
            &child_thread_id,
            &selected_provider_profile_id,
        )
        .await;
        return Ok(response);
    }
    Ok(response)
}

#[tauri::command]
pub(crate) async fn rewind_codex_thread(
    workspace_id: String,
    thread_id: String,
    message_id: Option<String>,
    target_user_turn_index: u32,
    target_user_message_text: Option<String>,
    target_user_message_occurrence: Option<u32>,
    local_user_message_count: Option<u32>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "rewind_codex_thread",
            json!({
                "workspaceId": workspace_id,
                "threadId": thread_id,
                "messageId": message_id,
                "targetUserTurnIndex": target_user_turn_index,
                "targetUserMessageText": target_user_message_text,
                "targetUserMessageOccurrence": target_user_message_occurrence,
                "localUserMessageCount": local_user_message_count
            }),
        )
        .await;
    }

    let provider_profile_id =
        resolve_thread_provider_profile_id(&state, &workspace_id, &thread_id).await;
    ensure_codex_session_for_provider(&workspace_id, &provider_profile_id, &state, &app).await?;
    let rewind_response = rewind::rewind_thread_from_message(
        &state.sessions,
        &state.workspaces,
        workspace_id.clone(),
        Some(provider_profile_id.clone()),
        thread_id,
        message_id,
        target_user_turn_index,
        target_user_message_text,
        target_user_message_occurrence,
        local_user_message_count,
    )
    .await?;

    let rewound_thread_id = rewind_response
        .get("thread")
        .and_then(|thread| thread.get("id"))
        .or_else(|| rewind_response.get("threadId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| "codex rewind response missing child thread id".to_string())?;

    record_codex_provider_binding(
        &state,
        &workspace_id,
        &rewound_thread_id,
        &provider_profile_id,
    )
    .await;

    if provider_profile_id == CODEX_DISK_PROVIDER_PROFILE_ID {
        disconnect_workspace_session_core(
            &state.sessions,
            Some(&state.runtime_manager),
            &workspace_id,
        )
        .await;
        ensure_codex_session_for_provider(&workspace_id, &provider_profile_id, &state, &app)
            .await?;
    }
    codex_core::resume_thread_core(
        &state.sessions,
        workspace_id,
        Some(provider_profile_id),
        rewound_thread_id,
    )
    .await?;

    Ok(rewind_response)
}

#[tauri::command]
pub(crate) async fn list_threads(
    workspace_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "list_threads",
            json!({ "workspaceId": workspace_id, "cursor": cursor, "limit": limit }),
        )
        .await;
    }

    let has_session = {
        let sessions = state.sessions.lock().await;
        sessions.contains_key(&workspace_id)
    };
    build_unified_codex_thread_page(&state, &workspace_id, cursor, limit, has_session).await
}

#[tauri::command]
pub(crate) async fn list_global_mcp_servers() -> Result<Vec<GlobalMcpServerEntry>, String> {
    list_global_mcp_servers_impl().await
}

#[tauri::command]
pub(crate) async fn set_global_mcp_server_enabled(
    name: String,
    source: String,
    enabled: bool,
) -> Result<(), String> {
    set_global_mcp_server_enabled_impl(name, source, enabled).await
}

#[tauri::command]
pub(crate) async fn list_mcp_server_status(
    workspace_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "list_mcp_server_status",
            json!({ "workspaceId": workspace_id, "cursor": cursor, "limit": limit }),
        )
        .await;
    }

    codex_core::list_mcp_server_status_core(&state.sessions, workspace_id, None, cursor, limit)
        .await
}

#[tauri::command]
pub(crate) async fn archive_thread(
    workspace_id: String,
    thread_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "archive_thread",
            json!({ "workspaceId": workspace_id, "threadId": thread_id }),
        )
        .await;
    }

    let provider_profile_id =
        resolve_thread_provider_profile_id(&state, &workspace_id, &thread_id).await;
    ensure_codex_session_for_provider(&workspace_id, &provider_profile_id, &state, &app).await?;
    codex_core::archive_thread_core(
        &state.sessions,
        workspace_id,
        Some(provider_profile_id),
        thread_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn delete_codex_session(
    workspace_id: String,
    session_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "delete_codex_session",
            json!({ "workspaceId": workspace_id, "sessionId": session_id }),
        )
        .await;
    }

    let normalized_session_id = session_id.trim().to_string();
    if normalized_session_id.is_empty() {
        return Err("session_id is required".to_string());
    }
    let provider_profile_id =
        resolve_thread_provider_profile_id(&state, &workspace_id, &normalized_session_id).await;

    let archive_result = codex_core::archive_thread_best_effort_core(
        &state.sessions,
        workspace_id.clone(),
        Some(provider_profile_id.clone()),
        normalized_session_id.clone(),
        Duration::from_millis(DELETE_ARCHIVE_TIMEOUT_MS),
    )
    .await;
    if let Err(error) = &archive_result {
        log::debug!(
            "[delete_codex_session] Best-effort archive skipped for workspace {} session {}: {}",
            workspace_id,
            normalized_session_id,
            error
        );
    }

    let deleted_count = local_usage::delete_codex_session_for_workspace(
        &state.workspaces,
        &workspace_id,
        &normalized_session_id,
    )
    .await?;

    let session = {
        let sessions = state.sessions.lock().await;
        let session_key =
            codex_core::session_key_for_provider(&workspace_id, Some(&provider_profile_id));
        sessions.get(&session_key).cloned()
    };
    if let Some(session) = session {
        session
            .clear_thread_effective_mode(&normalized_session_id)
            .await;
    }

    Ok(json!({
        "deleted": deleted_count > 0,
        "deletedCount": deleted_count,
        "method": "filesystem",
        "archivedBeforeDelete": archive_result.is_ok(),
    }))
}

#[tauri::command]
pub(crate) async fn delete_codex_sessions(
    workspace_id: String,
    session_ids: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "delete_codex_sessions",
            json!({ "workspaceId": workspace_id, "sessionIds": session_ids }),
        )
        .await;
    }

    let normalized_session_ids = session_ids
        .into_iter()
        .map(|session_id| session_id.trim().to_string())
        .filter(|session_id| !session_id.is_empty())
        .collect::<Vec<_>>();
    if normalized_session_ids.is_empty() {
        return Ok(json!({ "results": [] }));
    }

    for session_id in &normalized_session_ids {
        if session_id.contains('/') || session_id.contains('\\') || session_id.contains("..") {
            return Err("invalid session_id".to_string());
        }
    }

    let mut archive_results = HashMap::new();
    for session_id in &normalized_session_ids {
        let provider_profile_id =
            resolve_thread_provider_profile_id(&state, &workspace_id, session_id).await;
        let archive_result = codex_core::archive_thread_best_effort_core(
            &state.sessions,
            workspace_id.clone(),
            Some(provider_profile_id),
            session_id.clone(),
            Duration::from_millis(DELETE_ARCHIVE_TIMEOUT_MS),
        )
        .await;
        if let Err(error) = &archive_result {
            log::debug!(
                "[delete_codex_sessions] Best-effort archive skipped for workspace {} session {}: {}",
                workspace_id,
                session_id,
                error
            );
        }
        archive_results.insert(session_id.clone(), archive_result.is_ok());
    }

    let delete_results = local_usage::delete_codex_sessions_for_workspace(
        &state.workspaces,
        &workspace_id,
        &normalized_session_ids,
    )
    .await?;

    for result in &delete_results {
        if result.deleted {
            let provider_profile_id =
                resolve_thread_provider_profile_id(&state, &workspace_id, &result.session_id).await;
            let session = {
                let sessions = state.sessions.lock().await;
                let session_key =
                    codex_core::session_key_for_provider(&workspace_id, Some(&provider_profile_id));
                sessions.get(&session_key).cloned()
            };
            if let Some(session) = session {
                session
                    .clear_thread_effective_mode(&result.session_id)
                    .await;
            }
        }
    }

    let serialized_results = delete_results
        .into_iter()
        .map(|result| {
            json!({
                "sessionId": result.session_id,
                "deleted": result.deleted,
                "deletedCount": result.deleted_count,
                "method": "filesystem",
                "archivedBeforeDelete": archive_results
                    .get(&result.session_id)
                    .copied()
                    .unwrap_or(false),
                "error": result.error,
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({ "results": serialized_results }))
}

#[tauri::command]
pub(crate) async fn send_user_message(
    workspace_id: String,
    thread_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    collaboration_mode: Option<Value>,
    preferred_language: Option<String>,
    custom_spec_root: Option<String>,
    resume_source: Option<String>,
    resume_turn_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let normalized_model = normalize_model_id(model);
    let selected_mode = collaboration_mode
        .as_ref()
        .and_then(|value| {
            if let Some(text) = value.as_str() {
                return Some(text.to_string());
            }
            value
                .as_object()
                .and_then(|object| object.get("mode").or_else(|| object.get("id")))
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .map(|mode| {
            let normalized = mode.trim().to_lowercase();
            if normalized == "default" {
                "code".to_string()
            } else {
                normalized
            }
        })
        .filter(|mode| mode == "plan" || mode == "code");

    if remote_backend::is_remote_mode(&*state).await {
        let images = images.map(|paths| {
            paths
                .into_iter()
                .map(remote_backend::normalize_path_for_remote)
                .collect::<Vec<_>>()
        });
        let mut payload = Map::new();
        payload.insert("workspaceId".to_string(), json!(workspace_id));
        payload.insert("threadId".to_string(), json!(thread_id));
        payload.insert("text".to_string(), json!(text));
        payload.insert("model".to_string(), json!(normalized_model));
        payload.insert("effort".to_string(), json!(effort));
        payload.insert("accessMode".to_string(), json!(access_mode));
        payload.insert("images".to_string(), json!(images));
        payload.insert("preferredLanguage".to_string(), json!(preferred_language));
        payload.insert("resumeSource".to_string(), json!(resume_source));
        payload.insert("resumeTurnId".to_string(), json!(resume_turn_id));
        if let Some(spec_root) = custom_spec_root.clone() {
            if !spec_root.trim().is_empty() {
                payload.insert("customSpecRoot".to_string(), json!(spec_root));
            }
        }
        if let Some(mode) = collaboration_mode {
            if !mode.is_null() {
                payload.insert("collaborationMode".to_string(), mode);
            }
        }
        return remote_backend::call_remote(
            &*state,
            app,
            "send_user_message",
            Value::Object(payload),
        )
        .await;
    }

    let provider_profile_id =
        resolve_thread_provider_profile_id(&state, &workspace_id, &thread_id).await;
    ensure_codex_session_for_provider(&workspace_id, &provider_profile_id, &state, &app).await?;
    let effective_model = if normalized_model.is_some() {
        normalized_model
    } else {
        resolve_provider_scoped_fallback_model(&state, &workspace_id, &provider_profile_id).await?
    };
    let (mode_enforcement_enabled, extra_developer_instructions) = {
        let settings = state.app_settings.lock().await;
        (
            settings.codex_mode_enforcement_enabled,
            codex_turn_developer_instructions(&settings),
        )
    };

    let response = codex_core::send_user_message_core(
        &state.sessions,
        workspace_id.clone(),
        Some(provider_profile_id.clone()),
        thread_id.clone(),
        text,
        effective_model,
        effort,
        access_mode,
        images,
        collaboration_mode,
        preferred_language,
        custom_spec_root,
        mode_enforcement_enabled,
        extra_developer_instructions,
    )
    .await?;

    if resume_source.as_deref() == Some("queue-fusion-cutover") {
        let session = {
            let sessions = state.sessions.lock().await;
            let session_key =
                codex_core::session_key_for_provider(&workspace_id, Some(&provider_profile_id));
            sessions.get(&session_key).cloned()
        };
        if let Some(session) = session {
            session
                .start_resume_pending_watch(
                    app.clone(),
                    thread_id.clone(),
                    None,
                    ResumePendingSource::QueueFusionCutover {
                        previous_turn_id: resume_turn_id
                            .map(|value| value.trim().to_string())
                            .filter(|value| !value.is_empty()),
                    },
                )
                .await;
        }
    }

    let session = {
        let sessions = state.sessions.lock().await;
        let session_key =
            codex_core::session_key_for_provider(&workspace_id, Some(&provider_profile_id));
        sessions.get(&session_key).cloned()
    };
    let (effective_runtime_mode, fallback_reason) = if let Some(session) = session {
        let runtime_mode = session
            .get_thread_effective_mode(&thread_id)
            .await
            .unwrap_or_else(|| "code".to_string());
        let fallback_reason = if selected_mode.is_some() && !session.collaboration_mode_supported()
        {
            Some("collaboration_mode_capability_unsupported_prompt_fallback")
        } else {
            None
        };
        (runtime_mode, fallback_reason)
    } else {
        ("code".to_string(), None)
    };
    let effective_ui_mode = if effective_runtime_mode == "plan" {
        "plan"
    } else {
        "default"
    };
    let selected_ui_mode = match selected_mode.as_deref() {
        Some("plan") => "plan",
        Some("code") => "default",
        _ => effective_ui_mode,
    };
    let _ = app.emit(
        "app-server-event",
        AppServerEvent {
            workspace_id: workspace_id.clone(),
            message: json!({
                "method": "collaboration/modeResolved",
                "params": {
                    "threadId": thread_id.clone(),
                    "thread_id": thread_id,
                    "selectedUiMode": selected_ui_mode,
                    "selected_ui_mode": selected_ui_mode,
                    "effectiveRuntimeMode": effective_runtime_mode.clone(),
                    "effective_runtime_mode": effective_runtime_mode,
                    "effectiveUiMode": effective_ui_mode,
                    "effective_ui_mode": effective_ui_mode,
                    "fallbackReason": fallback_reason,
                    "fallback_reason": fallback_reason
                }
            }),
        },
    );

    Ok(response)
}

#[tauri::command]
pub(crate) async fn collaboration_mode_list(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "collaboration_mode_list",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    match codex_core::collaboration_mode_list_core(&state.sessions, workspace_id.clone()).await {
        Ok(response) => Ok(response),
        Err(error) if error == "workspace not connected" => {
            log::debug!(
                "[codex:collaboration_mode_list] passive collaborationMode/list skipped runtime acquisition for {}: {}",
                workspace_id,
                error
            );
            Ok(json!({
                "data": [],
                "degraded": true,
                "runtimeAvailable": false,
                "reason": "workspace not connected",
            }))
        }
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub(crate) async fn turn_interrupt(
    workspace_id: String,
    thread_id: String,
    turn_id: String,
    provider_profile_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    // B.5：Shared Thread owner 路由显式携带的 provider 优先；缺省时保持旧解析行为。
    let provider_profile_id = provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "turn_interrupt",
            json!({ "workspaceId": workspace_id, "threadId": thread_id, "turnId": turn_id, "providerProfileId": provider_profile_id }),
        )
        .await;
    }

    let provider_profile_id = match provider_profile_id {
        Some(provider) => provider,
        None => resolve_thread_provider_profile_id(&state, &workspace_id, &thread_id).await,
    };
    codex_core::turn_interrupt_core(
        &state.sessions,
        workspace_id,
        Some(provider_profile_id),
        thread_id,
        turn_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn thread_compact(
    workspace_id: String,
    thread_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let mut normalized_thread_id = thread_id.trim().to_string();
    if normalized_thread_id.is_empty() {
        return Err("thread_id is required".to_string());
    }

    let shared_route = if normalized_thread_id.starts_with("shared:") {
        let route = crate::shared_session_v2::resolve_shared_compaction_route(
            &state,
            &workspace_id,
            &normalized_thread_id,
        )?;
        if route.has_unresolved_attempt {
            return Err(
                "shared-compaction-busy: Shared Attempt is still active or unresolved".to_string(),
            );
        }
        Some(route)
    } else {
        None
    };

    if remote_backend::is_remote_mode(&*state).await {
        if let Some(route) = shared_route.as_ref() {
            match route.engine {
                EngineType::Codex => {
                    let provider_profile_id = route
                        .provider_profile_id
                        .as_deref()
                        .unwrap_or(CODEX_DISK_PROVIDER_PROFILE_ID);
                    if provider_profile_id != CODEX_DISK_PROVIDER_PROFILE_ID {
                        return Err(format!(
                            "shared-compaction-provider-unavailable: remote daemon cannot compact Codex provider {provider_profile_id}"
                        ));
                    }
                }
                EngineType::Claude => {
                    let provider_profile_id = route
                        .provider_profile_id
                        .as_deref()
                        .unwrap_or(crate::engine::claude::CLAUDE_LOCAL_PROVIDER_PROFILE_ID);
                    if provider_profile_id
                        != crate::engine::claude::CLAUDE_LOCAL_PROVIDER_PROFILE_ID
                    {
                        return Err(format!(
                            "shared-compaction-provider-unavailable: remote daemon cannot compact Claude provider {provider_profile_id}"
                        ));
                    }
                }
                engine => {
                    return Err(format!(
                        "shared-compaction-unsupported: {} does not support context compaction",
                        engine.icon()
                    ));
                }
            }
            normalized_thread_id = route.native_thread_id.clone();
        }
        return remote_backend::call_remote(
            &*state,
            app,
            "thread_compact",
            json!({ "workspaceId": workspace_id, "threadId": normalized_thread_id }),
        )
        .await;
    }

    let mut shared_codex_provider_profile_id = None;
    if let Some(route) = shared_route {
        match route.engine {
            EngineType::Codex => {
                normalized_thread_id = route.native_thread_id;
                shared_codex_provider_profile_id = Some(
                    route
                        .provider_profile_id
                        .unwrap_or_else(|| CODEX_DISK_PROVIDER_PROFILE_ID.to_string()),
                );
            }
            EngineType::Claude => {
                let provider_profile_id = Some(route.provider_profile_id.unwrap_or_else(|| {
                    crate::engine::claude::CLAUDE_LOCAL_PROVIDER_PROFILE_ID.to_string()
                }));
                return compact_claude_thread(
                    workspace_id,
                    route.native_thread_id,
                    provider_profile_id,
                    &state,
                    &app,
                )
                .await;
            }
            engine => {
                return Err(format!(
                    "shared-compaction-unsupported: {} does not support context compaction",
                    engine.icon()
                ));
            }
        }
    } else if normalized_thread_id.starts_with("claude:") {
        return compact_claude_thread(workspace_id, normalized_thread_id, None, &state, &app).await;
    }

    let provider_profile_id = match shared_codex_provider_profile_id {
        Some(provider_profile_id) => provider_profile_id,
        None => {
            resolve_thread_provider_profile_id(&state, &workspace_id, &normalized_thread_id).await
        }
    };
    ensure_codex_session_for_provider(&workspace_id, &provider_profile_id, &state, &app).await?;
    let _ = app.emit(
        "app-server-event",
        AppServerEvent {
            workspace_id: workspace_id.clone(),
            message: json!({
                "method": "thread/compacting",
                "params": {
                    "threadId": normalized_thread_id,
                    "thread_id": normalized_thread_id,
                    "auto": false,
                    "manual": true
                }
            }),
        },
    );

    match codex_core::thread_compact_core(
        &state.sessions,
        workspace_id.clone(),
        Some(provider_profile_id),
        normalized_thread_id.clone(),
    )
    .await
    {
        Ok(result) => Ok(result),
        Err(error) => {
            let _ = app.emit(
                "app-server-event",
                AppServerEvent {
                    workspace_id,
                    message: json!({
                        "method": "thread/compactionFailed",
                        "params": {
                            "threadId": normalized_thread_id,
                            "thread_id": normalized_thread_id,
                            "auto": false,
                            "manual": true,
                            "reason": error
                        }
                    }),
                },
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub(crate) async fn start_review(
    workspace_id: String,
    thread_id: String,
    target: Value,
    delivery: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "start_review",
            json!({
                "workspaceId": workspace_id,
                "threadId": thread_id,
                "target": target,
                "delivery": delivery,
            }),
        )
        .await;
    }

    let provider_profile_id =
        resolve_thread_provider_profile_id(&state, &workspace_id, &thread_id).await;
    ensure_codex_session_for_provider(&workspace_id, &provider_profile_id, &state, &app).await?;
    codex_core::start_review_core(
        &state.sessions,
        workspace_id,
        Some(provider_profile_id),
        thread_id,
        target,
        delivery,
    )
    .await
}

#[tauri::command]
pub(crate) async fn model_list(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "model_list",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    match codex_core::model_list_core(&state.sessions, workspace_id.clone()).await {
        Ok(response) => Ok(response),
        Err(error) if error == "workspace not connected" => {
            log::debug!(
                "[codex:model_list] passive model/list skipped runtime acquisition for {}: {}",
                workspace_id,
                error
            );
            Ok(json!({
                "data": [],
                "degraded": true,
                "runtimeAvailable": false,
                "reason": "workspace not connected",
            }))
        }
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub(crate) async fn discover_codex_models(
    workspace_id: String,
    provider_profile_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "discover_codex_models",
            json!({
                "workspaceId": workspace_id,
                "providerProfileId": provider_profile_id,
            }),
        )
        .await;
    }

    let provider_profile_id =
        codex_core::normalize_provider_profile_id(provider_profile_id.as_deref());
    ensure_codex_session_for_provider(&workspace_id, &provider_profile_id, &state, &app).await?;
    codex_core::model_list_for_provider_core(
        &state.sessions,
        workspace_id,
        Some(provider_profile_id),
    )
    .await
}

#[tauri::command]
pub(crate) async fn account_rate_limits(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "account_rate_limits",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    match codex_core::account_rate_limits_core(&state.sessions, workspace_id.clone()).await {
        Ok(response) => Ok(response),
        Err(error) if error == "workspace not connected" => {
            log::debug!(
                "[codex:account_rate_limits] passive account/rateLimits read skipped runtime acquisition for {}: {}",
                workspace_id,
                error
            );
            Ok(json!({
                "rateLimits": null,
                "degraded": true,
                "runtimeAvailable": false,
                "reason": "workspace not connected",
            }))
        }
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub(crate) async fn account_read(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "account_read",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    codex_core::account_read_core(&state.sessions, &state.workspaces, workspace_id).await
}

#[tauri::command]
pub(crate) async fn codex_login(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "codex_login",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    codex_core::codex_login_core(
        &state.workspaces,
        &state.app_settings,
        &state.codex_login_cancels,
        workspace_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn codex_login_cancel(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "codex_login_cancel",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    codex_core::codex_login_cancel_core(&state.codex_login_cancels, workspace_id).await
}

#[tauri::command]
pub(crate) async fn skills_list(
    workspace_id: String,
    custom_skill_roots: Option<Vec<String>>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let custom_skill_roots_for_remote = custom_skill_roots.clone().unwrap_or_default();
        return remote_backend::call_remote(
            &*state,
            app,
            "skills_list",
            json!({
                "workspaceId": workspace_id,
                "customSkillRoots": custom_skill_roots_for_remote,
            }),
        )
        .await;
    }

    // Local mode: try local file scanning first
    let custom_skill_roots_vec = custom_skill_roots.unwrap_or_default();
    let resource_dir = app.path().resource_dir().ok();
    match crate::skills::skills_list_local_for_workspace(
        &*state,
        &workspace_id,
        custom_skill_roots_vec.clone(),
        resource_dir,
    )
    .await
    {
        Ok(entries) => {
            let skills_json: Vec<Value> = entries
                .into_iter()
                .map(crate::skills::skill_entry_to_json)
                .collect();
            Ok(json!(skills_json))
        }
        Err(crate::skills::SkillScanError::WorkspaceNotFound(_)) => {
            Err("workspace not found".to_string())
        }
        Err(err) => {
            log::warn!(
                "Local skills scan failed for workspace {}: {}, falling back to Codex CLI",
                workspace_id,
                err
            );
            codex_core::skills_list_core(&state.sessions, workspace_id, custom_skill_roots_vec)
                .await
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SharedControlResponseRoute {
    workspace_id: String,
    engine: EngineType,
    provider_runtime_key: String,
    provider_profile_id: Option<String>,
    native_thread_id: String,
    runtime_turn_id: String,
}

fn normalize_control_identity(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(crate) fn resolve_shared_control_response_route(
    coordinator: &crate::shared_runtime_coordinator::SharedRuntimeCoordinator,
    workspace_id: &str,
    shared_attempt_id: Option<&str>,
    shared_thread_id: Option<&str>,
    provider_runtime_key: Option<&str>,
    provider_profile_id: Option<&str>,
    native_thread_id: Option<&str>,
    runtime_turn_id: Option<&str>,
) -> Result<Option<SharedControlResponseRoute>, String> {
    let has_shared_identity =
        shared_attempt_id.is_some() || shared_thread_id.is_some() || provider_runtime_key.is_some();
    if !has_shared_identity {
        if normalize_control_identity(native_thread_id)
            .as_deref()
            .is_some_and(|thread_id| thread_id.starts_with("shared:"))
        {
            return Err("shared control response is missing its Runtime owner".to_string());
        }
        return Ok(None);
    }
    let attempt_id = normalize_control_identity(shared_attempt_id)
        .ok_or_else(|| "shared control response is missing attemptId".to_string())?;
    let shared_thread_id = normalize_control_identity(shared_thread_id)
        .ok_or_else(|| "shared control response is missing sharedThreadId".to_string())?;
    let provider_runtime_key = normalize_control_identity(provider_runtime_key)
        .ok_or_else(|| "shared control response is missing providerRuntimeKey".to_string())?;
    let native_thread_id = normalize_control_identity(native_thread_id)
        .ok_or_else(|| "shared control response is missing nativeThreadId".to_string())?;
    let runtime_turn_id = normalize_control_identity(runtime_turn_id)
        .ok_or_else(|| "shared control response is missing runtimeTurnId".to_string())?;
    let owner = coordinator
        .owner_for_attempt(&attempt_id)
        .ok_or_else(|| format!("shared control response attempt is not owned: {attempt_id}"))?;
    if owner.workspace_id != workspace_id {
        return Err("shared control response workspace owner mismatch".to_string());
    }
    if owner.shared_thread_id != shared_thread_id {
        return Err("shared control response thread owner mismatch".to_string());
    }
    if owner.provider_runtime_key != provider_runtime_key {
        return Err("shared control response provider Runtime owner mismatch".to_string());
    }
    if owner.native_session_id.as_deref().map(str::trim) != Some(native_thread_id.as_str()) {
        return Err("shared control response native thread owner mismatch".to_string());
    }
    if owner.runtime_turn_id.as_deref() != Some(runtime_turn_id.as_str()) {
        return Err("shared control response Runtime turn owner mismatch".to_string());
    }
    let owner_provider_profile_id = normalize_control_identity(
        owner
            .execution_target_snapshot
            .provider_profile_id
            .as_deref(),
    );
    let provider_profile_id = normalize_control_identity(provider_profile_id);
    if owner_provider_profile_id != provider_profile_id {
        return Err("shared control response Provider Profile owner mismatch".to_string());
    }
    let expected_engine =
        crate::shared_sessions::ensure_supported_shared_session_engine(owner.engine)?.icon();
    if owner.execution_target_snapshot.engine.trim() != expected_engine {
        return Err("shared control response target engine owner mismatch".to_string());
    }
    let expected_runtime_key = crate::shared_session_v2::provider_runtime_key_for_target(
        workspace_id,
        owner.engine,
        owner_provider_profile_id.as_deref(),
    )?;
    if expected_runtime_key != provider_runtime_key {
        return Err("shared control response Provider Runtime key is not canonical".to_string());
    }
    Ok(Some(SharedControlResponseRoute {
        workspace_id: workspace_id.to_string(),
        engine: owner.engine,
        provider_runtime_key,
        provider_profile_id,
        native_thread_id,
        runtime_turn_id,
    }))
}

async fn respond_to_shared_control_request(
    state: &AppState,
    route: &SharedControlResponseRoute,
    request_id: Value,
    result: Value,
) -> Result<(), String> {
    match route.engine {
        EngineType::Claude => {
            let session = state
                .engine_manager
                .claude_manager
                .get_session_for_provider(&route.workspace_id, route.provider_profile_id.as_deref())
                .await
                .ok_or_else(|| {
                    format!(
                        "shared control response Runtime is not connected: {}",
                        route.provider_runtime_key
                    )
                })?;
            if result.get("answers").is_some() {
                if !session.has_pending_user_input(&request_id) {
                    return Err(
                        "shared control response request is not pending on its Claude Runtime"
                            .to_string(),
                    );
                }
                session.respond_to_user_input(request_id, result).await
            } else {
                if !session.has_pending_approval_request(&request_id) {
                    return Err(
                        "shared control response request is not pending on its Claude Runtime"
                            .to_string(),
                    );
                }
                session
                    .respond_to_approval_request(request_id, result)
                    .await
            }
        }
        EngineType::Codex => {
            codex_core::respond_to_server_request_for_runtime_core(
                &state.sessions,
                route.provider_runtime_key.clone(),
                request_id,
                result,
            )
            .await
        }
        _ => Err("shared control response owner uses an unsupported engine".to_string()),
    }
}

#[tauri::command]
pub(crate) async fn respond_to_server_request(
    workspace_id: String,
    request_id: Value,
    result: Value,
    thread_id: Option<String>,
    turn_id: Option<String>,
    provider_profile_id: Option<String>,
    shared_attempt_id: Option<String>,
    shared_thread_id: Option<String>,
    provider_runtime_key: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let is_user_input_response = result.get("answers").is_some();
    let normalized_thread_id = normalize_control_identity(thread_id.as_deref());
    let normalized_turn_id = normalize_control_identity(turn_id.as_deref());
    let provider_profile_id = normalize_control_identity(provider_profile_id.as_deref());
    let is_local_plan_prompt = request_id
        .as_str()
        .map(|value| value.starts_with("doge-plan-") || value.starts_with("ccgui-plan-"))
        .unwrap_or(false);
    let has_shared_identity =
        shared_attempt_id.is_some() || shared_thread_id.is_some() || provider_runtime_key.is_some();
    if remote_backend::is_remote_mode(&*state).await {
        if has_shared_identity {
            return Err(
                "Shared control responses are unavailable through the remote backend".to_string(),
            );
        }
        remote_backend::call_remote(
            &*state,
            app,
            "respond_to_server_request",
            json!({
                "workspaceId": workspace_id,
                "requestId": request_id,
                "result": result,
                "threadId": normalized_thread_id,
                "turnId": normalized_turn_id,
                "providerProfileId": provider_profile_id,
            }),
        )
        .await?;
        return Ok(());
    }

    let shared_route = resolve_shared_control_response_route(
        &state.shared_runtime_coordinator,
        &workspace_id,
        shared_attempt_id.as_deref(),
        shared_thread_id.as_deref(),
        provider_runtime_key.as_deref(),
        provider_profile_id.as_deref(),
        normalized_thread_id.as_deref(),
        normalized_turn_id.as_deref(),
    )?;
    if let Some(route) = shared_route.as_ref() {
        respond_to_shared_control_request(&state, route, request_id, result).await?;
        if is_user_input_response && route.engine == EngineType::Codex && !is_local_plan_prompt {
            let session = {
                let sessions = state.sessions.lock().await;
                sessions.get(&route.provider_runtime_key).cloned()
            };
            if let Some(session) = session {
                session
                    .start_resume_pending_watch(
                        app,
                        route.native_thread_id.clone(),
                        Some(route.runtime_turn_id.clone()),
                        ResumePendingSource::UserInputResume,
                    )
                    .await;
            }
        }
        return Ok(());
    }

    // Native control request keeps the existing request-id routing contract.
    for session in state
        .engine_manager
        .claude_manager
        .sessions_for_workspace(&workspace_id)
        .await
    {
        if session.has_pending_user_input(&request_id) {
            return session.respond_to_user_input(request_id, result).await;
        }
        if session.has_pending_approval_request(&request_id) {
            return session
                .respond_to_approval_request(request_id, result)
                .await;
        }
    }

    let codex_runtime_key =
        codex_core::session_key_for_provider(&workspace_id, provider_profile_id.as_deref());
    codex_core::respond_to_server_request_core(
        &state.sessions,
        workspace_id.clone(),
        provider_profile_id,
        request_id,
        result,
    )
    .await?;

    if is_user_input_response && !is_local_plan_prompt {
        if let Some(thread_id) = normalized_thread_id {
            let session = {
                let sessions = state.sessions.lock().await;
                sessions.get(&codex_runtime_key).cloned()
            };
            if let Some(session) = session {
                session
                    .start_resume_pending_watch(
                        app,
                        thread_id,
                        normalized_turn_id,
                        ResumePendingSource::UserInputResume,
                    )
                    .await;
            }
        }
    }

    Ok(())
}

/// Gets the diff content for commit message generation
#[tauri::command]
pub(crate) async fn get_commit_message_prompt(
    workspace_id: String,
    language: Option<String>,
    selected_paths: Option<Vec<String>>,
    repository_selections: Option<Vec<CommitMessageRepositorySelection>>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Get the diff from git
    let diff = collect_commit_message_diff(
        &workspace_id,
        &state,
        selected_paths.as_deref(),
        repository_selections.as_deref(),
    )
    .await?;

    if diff.trim().is_empty() {
        return Err("No changes to generate commit message for".to_string());
    }

    Ok(build_commit_message_prompt(&diff, language.as_deref()))
}

#[tauri::command]
pub(crate) async fn remember_approval_rule(
    workspace_id: String,
    command: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    codex_core::remember_approval_rule_core(&state.workspaces, workspace_id, command).await
}

#[tauri::command]
pub(crate) async fn get_config_model(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "get_config_model",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    codex_core::get_config_model_core(&state.workspaces, workspace_id).await
}

async fn resolve_codex_session_for_commit_message(
    workspace_id: &str,
    state: &AppState,
) -> Result<Arc<WorkspaceSession>, String> {
    let session = {
        let sessions = state.sessions.lock().await;
        sessions.get(workspace_id).cloned()
    };
    if let Some(session) = session {
        return Ok(session);
    }

    let is_claude = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(workspace_id)
            .map(|entry| {
                entry
                    .settings
                    .engine_type
                    .as_deref()
                    .map(|engine| engine.eq_ignore_ascii_case("claude"))
                    .unwrap_or(true)
            })
            .unwrap_or(false)
    };
    if is_claude {
        return Err("AI commit message generation requires the Codex CLI. \
             Please install it first: npm install -g @openai/codex"
            .to_string());
    }
    Err(
        "Workspace not connected. Please ensure the Codex CLI is installed \
         and reconnect the workspace."
            .to_string(),
    )
}

async fn generate_commit_message_on_session(
    workspace_id: &str,
    prompt: &str,
    session: Arc<WorkspaceSession>,
    state: &AppState,
    app: &AppHandle,
) -> Result<String, String> {
    // Create a background helper thread (hidden from the main chat sidebar).
    let thread_params = json!({
        "cwd": session.entry.path,
        "approvalPolicy": "never"
    });
    let thread_result = session.send_request("thread/start", thread_params).await?;

    if let Some(error) = thread_result.get("error") {
        let error_msg = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error starting thread");
        return Err(error_msg.to_string());
    }

    let thread_id = thread_result
        .get("result")
        .and_then(|r| r.get("threadId"))
        .or_else(|| {
            thread_result
                .get("result")
                .and_then(|r| r.get("thread"))
                .and_then(|t| t.get("id"))
        })
        .or_else(|| thread_result.get("threadId"))
        .or_else(|| thread_result.get("thread").and_then(|t| t.get("id")))
        .and_then(|t| t.as_str())
        .ok_or_else(|| {
            format!(
                "Failed to get threadId from thread/start response: {:?}",
                thread_result
            )
        })?
        .to_string();
    record_hidden_codex_helper_thread(state, workspace_id, &thread_id, "commit-message", "git")
        .await;

    // Hide background helper threads from the sidebar, even if a thread/started event leaked.
    let _ = app.emit(
        "app-server-event",
        AppServerEvent {
            workspace_id: workspace_id.to_string(),
            message: json!({
                "method": "codex/backgroundThread",
                "params": {
                    "threadId": thread_id,
                    "action": "hide"
                }
            }),
        },
    );

    let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
    {
        let mut callbacks = session.background_thread_callbacks.lock().await;
        callbacks.insert(thread_id.clone(), tx);
    }

    let turn_params = json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": prompt }],
        "cwd": session.entry.path,
        "approvalPolicy": "never",
        "sandboxPolicy": { "type": "readOnly" },
    });
    let turn_result = match session.send_request("turn/start", turn_params).await {
        Ok(result) => result,
        Err(error) => {
            {
                let mut callbacks = session.background_thread_callbacks.lock().await;
                callbacks.remove(&thread_id);
            }
            let archive_params = json!({ "threadId": thread_id.as_str() });
            let _ = session.send_request("thread/archive", archive_params).await;
            return Err(error);
        }
    };

    if let Some(error) = turn_result.get("error") {
        let error_msg = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error starting turn");
        {
            let mut callbacks = session.background_thread_callbacks.lock().await;
            callbacks.remove(&thread_id);
        }
        let archive_params = json!({ "threadId": thread_id.as_str() });
        let _ = session.send_request("thread/archive", archive_params).await;
        return Err(error_msg.to_string());
    }

    let mut commit_message = String::new();
    let timeout_duration = Duration::from_secs(60);
    let collect_result = timeout(timeout_duration, async {
        while let Some(event) = rx.recv().await {
            let method = event.get("method").and_then(|m| m.as_str()).unwrap_or("");

            match method {
                "item/agentMessage/delta" => {
                    if let Some(params) = event.get("params") {
                        if let Some(delta) = params.get("delta").and_then(|d| d.as_str()) {
                            commit_message.push_str(delta);
                        }
                    }
                }
                "turn/completed" => {
                    break;
                }
                "turn/error" => {
                    let error_msg = event
                        .get("params")
                        .and_then(|p| p.get("error"))
                        .and_then(|e| e.as_str())
                        .unwrap_or("Unknown error during commit message generation");
                    return Err(error_msg.to_string());
                }
                _ => {}
            }
        }
        Ok(())
    })
    .await;

    {
        let mut callbacks = session.background_thread_callbacks.lock().await;
        callbacks.remove(&thread_id);
    }

    let archive_params = json!({ "threadId": thread_id });
    let _ = session.send_request("thread/archive", archive_params).await;

    match collect_result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err("Timeout waiting for commit message generation".to_string()),
    }

    let trimmed = commit_message.trim().to_string();
    if trimmed.is_empty() {
        return Err("No commit message was generated".to_string());
    }

    Ok(trimmed)
}

/// Generates a commit message in the background without showing in the main chat.
///
/// Uses the same runtime ensure + bounded broken-pipe recovery as create-session:
/// stale Codex app-server transports are probed/replaced before `thread/start`, and a
/// single transport disconnect is retried after re-acquire.
#[tauri::command]
pub(crate) async fn generate_commit_message(
    workspace_id: String,
    language: Option<String>,
    selected_paths: Option<Vec<String>>,
    repository_selections: Option<Vec<CommitMessageRepositorySelection>>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    let diff = collect_commit_message_diff(
        &workspace_id,
        &state,
        selected_paths.as_deref(),
        repository_selections.as_deref(),
    )
    .await?;

    if diff.trim().is_empty() {
        return Err("No changes to generate commit message for".to_string());
    }

    let prompt = build_commit_message_prompt(&diff, language.as_deref());

    self::start_thread_retry::run_with_runtime_recovery_retry(
        &workspace_id,
        "generate_commit_message",
        || ensure_codex_session(&workspace_id, &state, &app),
        &|| async { Ok(()) },
        || async {
            let session = resolve_codex_session_for_commit_message(&workspace_id, &state).await?;
            generate_commit_message_on_session(&workspace_id, &prompt, session, &state, &app).await
        },
    )
    .await
}

#[tauri::command]
pub(crate) async fn list_thread_titles(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<HashMap<String, String>, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let value = remote_backend::call_remote(
            &*state,
            app,
            "list_thread_titles",
            json!({ "workspaceId": workspace_id }),
        )
        .await?;
        return serde_json::from_value(value)
            .map_err(|error| format!("Invalid thread titles payload: {error}"));
    }

    thread_titles_core::list_thread_titles_core(&state.workspaces, workspace_id).await
}

#[tauri::command]
pub(crate) async fn set_thread_title(
    workspace_id: String,
    thread_id: String,
    title: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let value = remote_backend::call_remote(
            &*state,
            app,
            "set_thread_title",
            json!({
                "workspaceId": workspace_id,
                "threadId": thread_id,
                "title": title,
            }),
        )
        .await?;
        return value
            .as_str()
            .map(|text| text.to_string())
            .ok_or_else(|| "Invalid set_thread_title response".to_string());
    }

    thread_titles_core::upsert_thread_title_core(&state.workspaces, workspace_id, thread_id, title)
        .await
}

#[tauri::command]
pub(crate) async fn rename_thread_title_key(
    workspace_id: String,
    old_thread_id: String,
    new_thread_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        remote_backend::call_remote(
            &*state,
            app,
            "rename_thread_title_key",
            json!({
                "workspaceId": workspace_id,
                "oldThreadId": old_thread_id,
                "newThreadId": new_thread_id,
            }),
        )
        .await?;
        return Ok(());
    }

    thread_titles_core::rename_thread_title_core(
        &state.workspaces,
        workspace_id,
        old_thread_id,
        new_thread_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn generate_thread_title(
    workspace_id: String,
    thread_id: String,
    user_message: String,
    preferred_language: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let value = remote_backend::call_remote(
            &*state,
            app,
            "generate_thread_title",
            json!({
                "workspaceId": workspace_id,
                "threadId": thread_id,
                "userMessage": user_message,
                "preferredLanguage": preferred_language,
            }),
        )
        .await?;
        return value
            .as_str()
            .map(|text| text.to_string())
            .ok_or_else(|| "Invalid generate_thread_title response".to_string());
    }

    ensure_codex_session(&workspace_id, &state, &app).await?;

    let cleaned_message = user_message.trim();
    if cleaned_message.is_empty() {
        return Err("Message is required to generate title".to_string());
    }

    let language_instruction = match preferred_language
        .unwrap_or_else(|| "en".to_string())
        .trim()
        .to_lowercase()
        .as_str()
    {
        "zh" | "zh-cn" | "zh-hans" | "chinese" => "Output language: Simplified Chinese.",
        _ => "Output language: English.",
    };

    let session = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&workspace_id)
            .ok_or("workspace not connected")?
            .clone()
    };

    let prompt = format!(
        "Generate a concise title for a coding chat thread from the first user message. \
Return only the title text, no quotes, no punctuation-only output, no markdown. \
Keep it between 3 and 8 words.\n\
{language_instruction}\n\nFirst user message:\n{cleaned_message}"
    );

    let thread_start_result = session
        .send_request(
            "thread/start",
            json!({
                "cwd": session.entry.path,
                "approvalPolicy": "never"
            }),
        )
        .await?;

    if let Some(error) = thread_start_result.get("error") {
        let message = error
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("Unknown error starting title thread");
        return Err(message.to_string());
    }

    let helper_thread_id = thread_start_result
        .get("result")
        .and_then(|result| result.get("threadId"))
        .or_else(|| {
            thread_start_result
                .get("result")
                .and_then(|result| result.get("thread"))
                .and_then(|thread| thread.get("id"))
        })
        .or_else(|| thread_start_result.get("threadId"))
        .or_else(|| {
            thread_start_result
                .get("thread")
                .and_then(|thread| thread.get("id"))
        })
        .and_then(|value| value.as_str())
        .ok_or_else(|| {
            format!(
                "Failed to get threadId from thread/start response: {:?}",
                thread_start_result
            )
        })?
        .to_string();
    record_hidden_codex_helper_thread(
        &state,
        &workspace_id,
        &helper_thread_id,
        "title-generation",
        "threads",
    )
    .await;

    let _ = app.emit(
        "app-server-event",
        AppServerEvent {
            workspace_id: workspace_id.clone(),
            message: json!({
                "method": "codex/backgroundThread",
                "params": {
                    "threadId": helper_thread_id,
                    "action": "hide"
                }
            }),
        },
    );

    let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
    {
        let mut callbacks = session.background_thread_callbacks.lock().await;
        callbacks.insert(helper_thread_id.clone(), tx);
    }

    let turn_start_result = session
        .send_request(
            "turn/start",
            json!({
                "threadId": helper_thread_id,
                "input": [{ "type": "text", "text": prompt }],
                "cwd": session.entry.path,
                "approvalPolicy": "never",
                "sandboxPolicy": { "type": "readOnly" },
            }),
        )
        .await;

    let turn_start_result = match turn_start_result {
        Ok(result) => result,
        Err(error) => {
            {
                let mut callbacks = session.background_thread_callbacks.lock().await;
                callbacks.remove(&helper_thread_id);
            }
            let _ = session
                .send_request(
                    "thread/archive",
                    json!({ "threadId": helper_thread_id.as_str() }),
                )
                .await;
            return Err(error);
        }
    };

    if let Some(error) = turn_start_result.get("error") {
        let message = error
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("Unknown error starting title generation turn")
            .to_string();
        {
            let mut callbacks = session.background_thread_callbacks.lock().await;
            callbacks.remove(&helper_thread_id);
        }
        let _ = session
            .send_request(
                "thread/archive",
                json!({ "threadId": helper_thread_id.as_str() }),
            )
            .await;
        return Err(message);
    }

    let mut generated = String::new();
    let collect_result = timeout(Duration::from_secs(30), async {
        while let Some(event) = rx.recv().await {
            let method = event
                .get("method")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            match method {
                "item/agentMessage/delta" => {
                    if let Some(delta) = event
                        .get("params")
                        .and_then(|params| params.get("delta"))
                        .and_then(|value| value.as_str())
                    {
                        generated.push_str(delta);
                    }
                }
                "turn/completed" => break,
                "turn/error" => {
                    let message = event
                        .get("params")
                        .and_then(|params| params.get("error"))
                        .and_then(|value| value.as_str())
                        .unwrap_or("Unknown error during title generation");
                    return Err(message.to_string());
                }
                _ => {}
            }
        }
        Ok(())
    })
    .await;

    {
        let mut callbacks = session.background_thread_callbacks.lock().await;
        callbacks.remove(&helper_thread_id);
    }

    let _ = session
        .send_request("thread/archive", json!({ "threadId": helper_thread_id }))
        .await;

    match collect_result {
        Ok(Ok(())) => {}
        Ok(Err(error)) => return Err(error),
        Err(_) => return Err("Timeout waiting for thread title generation".to_string()),
    }

    let normalized = generated
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches('"')
        .to_string();
    if normalized.is_empty() {
        return Err("No thread title was generated".to_string());
    }

    let saved = thread_titles_core::upsert_thread_title_core(
        &state.workspaces,
        workspace_id,
        thread_id,
        normalized,
    )
    .await?;

    Ok(saved)
}

#[tauri::command]
pub(crate) async fn generate_run_metadata(
    workspace_id: String,
    prompt: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "generate_run_metadata",
            json!({ "workspaceId": workspace_id, "prompt": prompt }),
        )
        .await;
    }

    let cleaned_prompt = prompt.trim();
    if cleaned_prompt.is_empty() {
        return Err("Prompt is required.".to_string());
    }

    let session = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&workspace_id)
            .ok_or("workspace not connected")?
            .clone()
    };

    let title_prompt = format!(
        "You create concise run metadata for a coding task.\n\
Return ONLY a JSON object with keys:\n\
- title: short, clear, 3-7 words, Title Case\n\
- worktreeName: lower-case, kebab-case slug prefixed with one of: \
feat/, fix/, chore/, test/, docs/, refactor/, perf/, build/, ci/, style/.\n\
\n\
Choose fix/ when the task is a bug fix, error, regression, crash, or cleanup. \
Use the closest match for chores/tests/docs/refactors/perf/build/ci/style. \
Otherwise use feat/.\n\
\n\
Examples:\n\
{{\"title\":\"Fix Login Redirect Loop\",\"worktreeName\":\"fix/login-redirect-loop\"}}\n\
{{\"title\":\"Add Workspace Home View\",\"worktreeName\":\"feat/workspace-home\"}}\n\
{{\"title\":\"Update Lint Config\",\"worktreeName\":\"chore/update-lint-config\"}}\n\
{{\"title\":\"Add Coverage Tests\",\"worktreeName\":\"test/add-coverage-tests\"}}\n\
\n\
Task:\n{cleaned_prompt}"
    );

    let thread_params = json!({
        "cwd": session.entry.path,
        "approvalPolicy": "never"
    });
    let thread_result = session.send_request("thread/start", thread_params).await?;

    if let Some(error) = thread_result.get("error") {
        let error_msg = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error starting thread");
        return Err(error_msg.to_string());
    }

    let thread_id = thread_result
        .get("result")
        .and_then(|r| r.get("threadId"))
        .or_else(|| {
            thread_result
                .get("result")
                .and_then(|r| r.get("thread"))
                .and_then(|t| t.get("id"))
        })
        .or_else(|| thread_result.get("threadId"))
        .or_else(|| thread_result.get("thread").and_then(|t| t.get("id")))
        .and_then(|t| t.as_str())
        .ok_or_else(|| {
            format!(
                "Failed to get threadId from thread/start response: {:?}",
                thread_result
            )
        })?
        .to_string();
    record_hidden_codex_helper_thread(&state, &workspace_id, &thread_id, "run-metadata", "tasks")
        .await;

    // Hide background helper threads from the sidebar, even if a thread/started event leaked.
    let _ = app.emit(
        "app-server-event",
        AppServerEvent {
            workspace_id: workspace_id.clone(),
            message: json!({
                "method": "codex/backgroundThread",
                "params": {
                    "threadId": thread_id,
                    "action": "hide"
                }
            }),
        },
    );

    let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
    {
        let mut callbacks = session.background_thread_callbacks.lock().await;
        callbacks.insert(thread_id.clone(), tx);
    }

    let turn_params = json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": title_prompt }],
        "cwd": session.entry.path,
        "approvalPolicy": "never",
        "sandboxPolicy": { "type": "readOnly" },
    });
    let turn_result = session.send_request("turn/start", turn_params).await;
    let turn_result = match turn_result {
        Ok(result) => result,
        Err(error) => {
            {
                let mut callbacks = session.background_thread_callbacks.lock().await;
                callbacks.remove(&thread_id);
            }
            let archive_params = json!({ "threadId": thread_id.as_str() });
            let _ = session.send_request("thread/archive", archive_params).await;
            return Err(error);
        }
    };

    if let Some(error) = turn_result.get("error") {
        let error_msg = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error starting turn");
        {
            let mut callbacks = session.background_thread_callbacks.lock().await;
            callbacks.remove(&thread_id);
        }
        let archive_params = json!({ "threadId": thread_id.as_str() });
        let _ = session.send_request("thread/archive", archive_params).await;
        return Err(error_msg.to_string());
    }

    let mut response_text = String::new();
    let timeout_duration = Duration::from_secs(60);
    let collect_result = timeout(timeout_duration, async {
        while let Some(event) = rx.recv().await {
            let method = event.get("method").and_then(|m| m.as_str()).unwrap_or("");
            match method {
                "item/agentMessage/delta" => {
                    if let Some(params) = event.get("params") {
                        if let Some(delta) = params.get("delta").and_then(|d| d.as_str()) {
                            response_text.push_str(delta);
                        }
                    }
                }
                "turn/completed" => break,
                "turn/error" => {
                    let error_msg = event
                        .get("params")
                        .and_then(|p| p.get("error"))
                        .and_then(|e| e.as_str())
                        .unwrap_or("Unknown error during metadata generation");
                    return Err(error_msg.to_string());
                }
                _ => {}
            }
        }
        Ok(())
    })
    .await;

    {
        let mut callbacks = session.background_thread_callbacks.lock().await;
        callbacks.remove(&thread_id);
    }

    let archive_params = json!({ "threadId": thread_id });
    let _ = session.send_request("thread/archive", archive_params).await;

    match collect_result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err("Timeout waiting for metadata generation".to_string()),
    }

    let trimmed = response_text.trim();
    if trimmed.is_empty() {
        return Err("No metadata was generated".to_string());
    }

    let json_value =
        extract_json_value(trimmed).ok_or_else(|| "Failed to parse metadata JSON".to_string())?;
    let title = json_value
        .get("title")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "Missing title in metadata".to_string())?;
    let worktree_name = json_value
        .get("worktreeName")
        .or_else(|| json_value.get("worktree_name"))
        .and_then(|v| v.as_str())
        .map(|v| sanitize_run_worktree_name(v))
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "Missing worktree name in metadata".to_string())?;

    Ok(json!({
        "title": title,
        "worktreeName": worktree_name
    }))
}

#[cfg(test)]
#[path = "codex_tests.rs"]
mod tests;
