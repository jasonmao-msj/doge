use std::path::{Path, PathBuf};
use std::time::Instant;

use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};

use crate::engine::{EngineConfig, EngineType};
use crate::native_history::{
    probe_history_file, read_history_file, NativeHistoryEngine, NativeHistorySource,
};
use crate::shared_context::{
    compile_native_context, read_artifact, read_typed_artifact, write_artifact,
    write_typed_artifact, ArtifactReadRequest, CompileNativeContextRequest, ContextPackage,
    ProjectionMode,
};
use crate::shared_event_log::canonical::CanonicalProviderProfileSource;
use crate::shared_event_log::deterministic_json_bytes;
use crate::shared_session_v2::{
    codex_import_items, codex_import_projection, context_capabilities, ExecutionTargetInput,
};
use crate::state::AppState;

use super::{
    delete_prepared_operation, load_operation, prepare_operation, update_operation_phase,
    ArtifactRef, NativeHistoryMaterialization, NativeProviderContinuationOperation,
};

const NATIVE_PROVIDER_CONTINUATION_PROGRESS_EVENT: &str = "native-provider-continuation-progress";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum ProviderContinuationProgressPhase {
    ReadingSource,
    CompilingContext,
    Prepared,
    StartingTarget,
    DeliveringContext,
    VerifyingTarget,
    Finalizing,
    Ready,
}

impl ProviderContinuationProgressPhase {
    const fn percent(self) -> u8 {
        match self {
            Self::ReadingSource => 8,
            Self::CompilingContext => 22,
            Self::Prepared => 32,
            Self::StartingTarget => 45,
            Self::DeliveringContext => 68,
            Self::VerifyingTarget => 86,
            Self::Finalizing => 96,
            Self::Ready => 100,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderContinuationProgressEvent {
    workspace_id: String,
    operation_id: String,
    phase: ProviderContinuationProgressPhase,
    percent: u8,
}

fn emit_progress(
    app: &AppHandle,
    workspace_id: &str,
    operation_id: &str,
    phase: ProviderContinuationProgressPhase,
) {
    let event = ProviderContinuationProgressEvent {
        workspace_id: workspace_id.to_string(),
        operation_id: operation_id.to_string(),
        phase,
        percent: phase.percent(),
    };
    if let Err(error) = app.emit(NATIVE_PROVIDER_CONTINUATION_PROGRESS_EVENT, event) {
        log::warn!(
            "[native-continuation] operation_id={} progress_emit_failed phase={:?} error={}",
            operation_id,
            phase,
            error
        );
    }
}

fn now_millis() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn app_data_root(state: &AppState) -> Result<&Path, String> {
    state
        .storage_path
        .parent()
        .ok_or_else(|| "app data directory unavailable".to_string())
}

fn request_checksum(
    source: &NativeHistorySource,
    destination: &ExecutionTargetInput,
) -> Result<String, String> {
    let bytes = deterministic_json_bytes(&json!({
        "source": source,
        "destination": destination,
    }))
    .map_err(|error| error.to_string())?;
    Ok(format!("sha256:{:x}", Sha256::digest(bytes)))
}

fn engine_name(engine: NativeHistoryEngine) -> &'static str {
    match engine {
        NativeHistoryEngine::Claude => "claude",
        NativeHistoryEngine::Codex => "codex",
        NativeHistoryEngine::Kimi => "kimi",
    }
}

fn source_engine_type(engine: NativeHistoryEngine) -> EngineType {
    match engine {
        NativeHistoryEngine::Claude => EngineType::Claude,
        NativeHistoryEngine::Codex => EngineType::Codex,
        NativeHistoryEngine::Kimi => EngineType::Kimi,
    }
}

fn validate_provider_continuation_shape(
    operation_id: &str,
    source: &NativeHistorySource,
    destination: &ExecutionTargetInput,
) -> Result<(), String> {
    if operation_id.trim().is_empty() {
        return Err("operation_id is required".to_string());
    }
    let source_session_id = source.session_id.trim();
    let native_session_id = source.native_session_id.trim();
    if source_session_id.is_empty() || native_session_id.is_empty() {
        return Err("source session identity is required".to_string());
    }
    let expected_source_session_id =
        format!("{}:{}", engine_name(source.engine), native_session_id);
    let source_identity_matches = source_session_id == expected_source_session_id
        || (source.engine == NativeHistoryEngine::Codex && source_session_id == native_session_id);
    if !source_identity_matches {
        return Err("source session identity does not match native session identity".to_string());
    }
    if destination.normalized_provider().is_none() {
        return Err("destination provider identity is required".to_string());
    }
    if !matches!(destination.engine, EngineType::Codex | EngineType::Claude) {
        return Err(
            "unsupported-target-acceptance: target adapter cannot prove context acceptance"
                .to_string(),
        );
    }
    if source_engine_type(source.engine) == destination.engine
        && source.provider_profile_id.as_deref() == destination.normalized_provider().as_deref()
    {
        return Err("destination provider must differ from the source provider".to_string());
    }
    Ok(())
}

fn validate_provider_continuation_request(
    state: &AppState,
    workspace_id: &str,
    operation_id: &str,
    source: &NativeHistorySource,
    destination: &ExecutionTargetInput,
) -> Result<(), String> {
    validate_provider_continuation_shape(operation_id, source, destination)?;
    let authoritative_provider =
        crate::session_management::provider_profile_id_for_session_at_path(
            state.storage_path.as_path(),
            workspace_id,
            &source.session_id,
            engine_name(source.engine),
        )?;
    if authoritative_provider.is_some()
        && authoritative_provider.as_deref() != source.provider_profile_id.as_deref()
    {
        return Err("source provider identity changed; reload the session catalog".to_string());
    }
    Ok(())
}

fn context_fidelity(destination: &ExecutionTargetInput, package: &ContextPackage) -> (usize, bool) {
    let adapter_dropped_entries = if destination.engine == EngineType::Codex
        && package.manifest.mode == ProjectionMode::NativeHistoryImport
    {
        codex_import_projection(package).1
    } else {
        0
    };
    let degraded = !package.manifest.omitted.is_empty()
        || (destination.engine == EngineType::Codex
            && package.manifest.mode != ProjectionMode::NativeHistoryImport)
        || adapter_dropped_entries > 0;
    (adapter_dropped_entries, degraded)
}

fn native_provider_source(source: Option<CanonicalProviderProfileSource>) -> &'static str {
    match source {
        Some(CanonicalProviderProfileSource::Managed) => "managed",
        Some(CanonicalProviderProfileSource::Local) | None => "disk",
    }
}

fn context_acceptance_marker(package: &ContextPackage) -> String {
    let namespace = context_protocol_namespace(package);
    format!(
        "{namespace}_CONTEXT_ACCEPTED:{}:{}",
        package.package_id, package.manifest.source_checksum
    )
}

fn context_package_marker(package: &ContextPackage) -> String {
    let namespace = context_protocol_namespace(package);
    format!(
        "{namespace}_CONTEXT_PACKAGE:{}:{}",
        package.package_id, package.manifest.source_checksum
    )
}

fn context_protocol_namespace(package: &ContextPackage) -> &'static str {
    if package.prompt_prefix.contains("MOSSX_CONTEXT_PACKAGE:") {
        "MOSSX"
    } else {
        "DOGE"
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CodexContextTransport {
    Import,
    Prompt,
}

fn codex_context_transport(mode: ProjectionMode) -> Result<CodexContextTransport, String> {
    match mode {
        ProjectionMode::NativeHistoryImport => Ok(CodexContextTransport::Import),
        ProjectionMode::PortableTranscript | ProjectionMode::Checkpoint => {
            Ok(CodexContextTransport::Prompt)
        }
        _ => Err(format!("unsupported-target-context-mode: {mode:?}")),
    }
}

async fn workspace_path(state: &AppState, workspace_id: &str) -> Result<PathBuf, String> {
    state
        .workspaces
        .lock()
        .await
        .get(workspace_id)
        .map(|workspace| PathBuf::from(&workspace.path))
        .ok_or_else(|| "workspace not found".to_string())
}

fn engine_config_with_home(
    config: Option<EngineConfig>,
    home: Option<PathBuf>,
) -> Option<EngineConfig> {
    if let Some(home) = home {
        let mut config = config.unwrap_or_default();
        config.home_dir = Some(home.to_string_lossy().to_string());
        Some(config)
    } else {
        config
    }
}

async fn resolve_source_path(
    state: &AppState,
    workspace_id: &str,
    source: &NativeHistorySource,
) -> Result<PathBuf, String> {
    let workspace_path = workspace_path(state, workspace_id).await?;
    match source.engine {
        NativeHistoryEngine::Claude => {
            let config = state
                .engine_manager
                .get_engine_config(EngineType::Claude)
                .await;
            crate::engine::claude_history::resolve_claude_session_file_with_config(
                &workspace_path,
                &source.native_session_id,
                config.as_ref(),
            )
        }
        NativeHistoryEngine::Codex => {
            let provider = source
                .provider_profile_id
                .as_deref()
                .ok_or_else(|| "source Codex provider identity is required".to_string())?;
            crate::codex::resolve_codex_native_history_path(
                state,
                workspace_id,
                &source.native_session_id,
                provider,
            )
            .await
        }
        NativeHistoryEngine::Kimi => {
            let launch_profile =
                crate::engine::kimi_provider_profile::resolve_kimi_provider_launch_profile(
                    workspace_id,
                    source.provider_profile_id.as_deref(),
                )?;
            let config = engine_config_with_home(
                state
                    .engine_manager
                    .get_engine_config(EngineType::Kimi)
                    .await,
                launch_profile.home_dir,
            );
            crate::engine::kimi_history::resolve_kimi_session_history_path(
                &workspace_path,
                &source.native_session_id,
                config
                    .as_ref()
                    .and_then(|config| config.home_dir.as_deref()),
            )
            .await
        }
    }
}

fn validate_artifacts(
    root: &Path,
    workspace_id: &str,
    operation: &NativeProviderContinuationOperation,
) -> Result<ContextPackage, String> {
    let session_id = &operation.materialization.source.session_id;
    read_typed_artifact(
        root,
        &ArtifactReadRequest {
            workspace_id: workspace_id.to_string(),
            session_id: session_id.clone(),
            artifact_id: operation
                .materialization
                .normalized_entries
                .artifact_id
                .clone(),
            checksum: operation
                .materialization
                .normalized_entries
                .checksum
                .clone(),
        },
    )
    .map_err(|error| format!("artifact-integrity: {error}"))?;
    read_artifact(
        root,
        &ArtifactReadRequest {
            workspace_id: workspace_id.to_string(),
            session_id: session_id.clone(),
            artifact_id: operation
                .materialization
                .context_package
                .artifact_id
                .clone(),
            checksum: operation.materialization.context_package.checksum.clone(),
        },
    )
    .map(|record| record.package)
    .map_err(|error| format!("artifact-integrity: {error}"))
}

async fn prepare(
    state: &AppState,
    app: &AppHandle,
    workspace_id: &str,
    operation_id: &str,
    source: &NativeHistorySource,
    destination: &ExecutionTargetInput,
) -> Result<(NativeProviderContinuationOperation, ContextPackage), String> {
    let root = app_data_root(state)?;
    let checksum = request_checksum(source, destination)?;
    if let Some(existing) = load_operation(root, operation_id).map_err(|error| error.to_string())? {
        if existing.request_checksum != checksum {
            return Err("operation-conflict".to_string());
        }
        match validate_artifacts(root, workspace_id, &existing) {
            Ok(package) => return Ok((existing, package)),
            Err(error)
                if existing.phase == "prepared"
                    && existing.result_session_id.is_none()
                    && delete_prepared_operation(root, operation_id, &checksum)
                        .map_err(|delete_error| delete_error.to_string())? =>
            {
                log::warn!(
                    "[native-continuation] operation_id={} invalid prepared artifact replaced: {}",
                    operation_id,
                    error
                );
            }
            Err(error) => {
                let _ = update_operation_phase(
                    root,
                    operation_id,
                    "recovery-required",
                    existing.result_session_id.as_deref(),
                    Some("artifact-integrity"),
                    now_millis(),
                );
                return Err(error);
            }
        }
    }

    let path = resolve_source_path(state, workspace_id, source).await?;
    let source_for_read = source.clone();
    let history = tokio::task::spawn_blocking(move || {
        let capability =
            probe_history_file(&path, source_for_read.engine).map_err(|error| error.to_string())?;
        let cursor = capability
            .stable_cursor
            .then_some(capability.current_through_cursor)
            .flatten()
            .ok_or_else(|| "unsupported-stable-cursor".to_string())?;
        read_history_file(&path, &source_for_read, &cursor).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("native-history-worker: {error}"))??;
    emit_progress(
        app,
        workspace_id,
        operation_id,
        ProviderContinuationProgressPhase::CompilingContext,
    );
    let mut capabilities = context_capabilities(destination);
    if destination.engine == EngineType::Codex {
        let provider_profile_id = destination
            .normalized_provider()
            .ok_or_else(|| "destination provider identity is required".to_string())?;
        crate::codex::ensure_codex_session_for_provider(
            workspace_id,
            &provider_profile_id,
            state,
            app,
        )
        .await?;
        let structured_history_import = crate::shared::codex_core::probe_thread_inject_items_core(
            &state.sessions,
            workspace_id,
            Some(&provider_profile_id),
        )
        .await?;
        capabilities.structured_history_import = structured_history_import;
        capabilities.tool_history = structured_history_import;
        capabilities.strong_context_ack = structured_history_import;
    }
    let package = compile_native_context(&CompileNativeContextRequest {
        session_id: source.session_id.clone(),
        binding_key: format!("continuation:{operation_id}"),
        destination: serde_json::to_value(destination).map_err(|error| error.to_string())?,
        source: source.clone(),
        history: history.clone(),
        capabilities,
        budget_estimated_tokens: None,
    })?;
    let prepared_at = now_millis();
    let normalized_entries = write_typed_artifact(
        root,
        workspace_id,
        &source.session_id,
        "application/vnd.doge.native-history-entries+json",
        &serde_json::to_value(&history.entries).map_err(|error| error.to_string())?,
        prepared_at,
    )?;
    let context_package = write_artifact(
        root,
        workspace_id,
        &source.session_id,
        &package,
        prepared_at,
    )?;
    let operation = NativeProviderContinuationOperation {
        materialization: NativeHistoryMaterialization {
            operation_id: operation_id.to_string(),
            source: source.clone(),
            reader_id: history.reader_id,
            source_fingerprint: history.source_fingerprint,
            through_cursor: history.through_cursor,
            normalized_entries: ArtifactRef {
                artifact_id: normalized_entries.artifact_id,
                checksum: normalized_entries.checksum,
                media_type: normalized_entries.media_type,
            },
            context_package_id: package.package_id.clone(),
            context_package: ArtifactRef {
                artifact_id: context_package.artifact_id,
                checksum: context_package.checksum,
                media_type: context_package.media_type,
            },
            destination: serde_json::to_value(destination).map_err(|error| error.to_string())?,
            prepared_at,
        },
        request_checksum: checksum,
        phase: "prepared".to_string(),
        result_session_id: None,
        error_code: None,
        updated_at: prepared_at,
    };
    let operation = prepare_operation(root, &operation).map_err(|error| error.to_string())?;
    Ok((operation, package))
}

async fn persist_target_metadata(
    state: &AppState,
    workspace_id: &str,
    operation: &NativeProviderContinuationOperation,
    destination: &ExecutionTargetInput,
    target_session_id: &str,
) -> Result<(), String> {
    let provider_profile_id = destination
        .normalized_provider()
        .ok_or_else(|| "destination provider identity is required".to_string())?;
    match destination.engine {
        EngineType::Codex => {
            crate::codex::record_codex_provider_binding_checked(
                state,
                workspace_id,
                target_session_id,
                &provider_profile_id,
            )
            .await?;
        }
        EngineType::Claude => {
            let binding = crate::engine::claude::resolve_claude_provider_launch_profile(Some(
                &provider_profile_id,
            ))?
            .map(|profile| profile.binding)
            .unwrap_or_else(|| crate::session_management::EngineProviderBinding {
                provider_profile_id: provider_profile_id.clone(),
                provider_profile_source: native_provider_source(
                    destination.provider_profile_source,
                )
                .to_string(),
                provider_profile_name: destination
                    .provider_profile_name_snapshot
                    .clone()
                    .unwrap_or_else(|| provider_profile_id.clone()),
                provider_availability: "available".to_string(),
            });
            crate::session_management::record_engine_provider_binding_core(
                &state.workspaces,
                state.storage_path.as_path(),
                workspace_id.to_string(),
                target_session_id.to_string(),
                "claude".to_string(),
                binding,
            )
            .await?;
        }
        _ => return Err("unsupported target engine".to_string()),
    }
    crate::session_management::record_provider_continuation_metadata_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id.to_string(),
        target_session_id.to_string(),
        operation.materialization.source.session_id.clone(),
        operation.materialization.source.provider_profile_id.clone(),
    )
    .await?;
    Ok(())
}

fn raw_codex_thread_id(session_id: &str) -> Option<&str> {
    let raw_session_id = session_id.trim_start_matches("codex:").trim();
    (!raw_session_id.is_empty()).then_some(raw_session_id)
}

async fn execute_codex(
    state: &AppState,
    app: &AppHandle,
    workspace_id: &str,
    operation: NativeProviderContinuationOperation,
    destination: &ExecutionTargetInput,
    package: &ContextPackage,
) -> Result<NativeProviderContinuationOperation, String> {
    let root = app_data_root(state)?;
    if operation.phase == "ready" {
        if let Some(legacy_result_session_id) = operation
            .result_session_id
            .as_deref()
            .filter(|session_id| session_id.starts_with("codex:"))
        {
            if let Some(target_session_id) = raw_codex_thread_id(legacy_result_session_id) {
                return update_operation_phase(
                    root,
                    &operation.materialization.operation_id,
                    "ready",
                    Some(target_session_id),
                    None,
                    now_millis(),
                )
                .map_err(|error| error.to_string());
            }
        }
        return Ok(operation);
    }
    if operation.phase == "recovery-required" {
        if let Some(result_session_id) = operation.result_session_id.as_deref() {
            // 新 operation 保存 raw Codex thread id；这里保留旧 `codex:` result 的
            // recovery compatibility，runtime command 始终只接收 raw id。
            let target_session_id = raw_codex_thread_id(result_session_id)
                .ok_or_else(|| "Codex target thread identity is invalid".to_string())?;
            let provider_profile_id = destination
                .normalized_provider()
                .ok_or_else(|| "destination provider identity is required".to_string())?;
            crate::codex::ensure_codex_session_for_provider(
                workspace_id,
                &provider_profile_id,
                state,
                app,
            )
            .await?;
            emit_progress(
                app,
                workspace_id,
                &operation.materialization.operation_id,
                ProviderContinuationProgressPhase::VerifyingTarget,
            );
            let response = crate::shared::codex_core::resume_thread_core(
                &state.sessions,
                workspace_id.to_string(),
                Some(provider_profile_id),
                target_session_id.to_string(),
            )
            .await?;
            let marker = context_package_marker(package);
            if response.to_string().contains(&marker) {
                emit_progress(
                    app,
                    workspace_id,
                    &operation.materialization.operation_id,
                    ProviderContinuationProgressPhase::Finalizing,
                );
                persist_target_metadata(
                    state,
                    workspace_id,
                    &operation,
                    destination,
                    target_session_id,
                )
                .await?;
                return update_operation_phase(
                    root,
                    &operation.materialization.operation_id,
                    "ready",
                    Some(target_session_id),
                    None,
                    now_millis(),
                )
                .map_err(|error| error.to_string());
            }
        }
        return Err(format!(
            "recovery-required: {}",
            operation.error_code.as_deref().unwrap_or("unknown")
        ));
    }
    if operation.phase == "creating" && operation.result_session_id.is_none() {
        let _ = update_operation_phase(
            root,
            &operation.materialization.operation_id,
            "recovery-required",
            None,
            Some("acceptance-ambiguous"),
            now_millis(),
        );
        return Err("acceptance-ambiguous: target creation state is unknown".to_string());
    }
    if let Some(result_session_id) = operation.result_session_id.as_deref() {
        let target_session_id = raw_codex_thread_id(result_session_id)
            .ok_or_else(|| "Codex target thread identity is invalid".to_string())?;
        if operation.error_code.as_deref() == Some("catalog-commit-failed") {
            emit_progress(
                app,
                workspace_id,
                &operation.materialization.operation_id,
                ProviderContinuationProgressPhase::Finalizing,
            );
            persist_target_metadata(
                state,
                workspace_id,
                &operation,
                destination,
                target_session_id,
            )
            .await?;
            return update_operation_phase(
                root,
                &operation.materialization.operation_id,
                "ready",
                Some(target_session_id),
                None,
                now_millis(),
            )
            .map_err(|error| error.to_string());
        }
        let _ = update_operation_phase(
            root,
            &operation.materialization.operation_id,
            "recovery-required",
            Some(target_session_id),
            Some("acceptance-ambiguous"),
            now_millis(),
        );
        return Err("acceptance-ambiguous: target identity already exists".to_string());
    }

    let provider_profile_id = destination
        .normalized_provider()
        .ok_or_else(|| "destination provider identity is required".to_string())?;
    crate::codex::ensure_codex_session_for_provider(workspace_id, &provider_profile_id, state, app)
        .await?;
    update_operation_phase(
        root,
        &operation.materialization.operation_id,
        "creating",
        None,
        None,
        now_millis(),
    )
    .map_err(|error| error.to_string())?;
    let response = match crate::shared::codex_core::start_thread_core(
        &state.sessions,
        workspace_id.to_string(),
        Some(provider_profile_id.clone()),
        destination.model.clone(),
    )
    .await
    {
        Ok(response) => response,
        Err(error) => {
            let _ = update_operation_phase(
                root,
                &operation.materialization.operation_id,
                "recovery-required",
                None,
                Some("acceptance-ambiguous"),
                now_millis(),
            );
            return Err(format!("acceptance-ambiguous: {error}"));
        }
    };
    let Some(target_session_id) =
        crate::shared::codex_core::extract_thread_id_from_response(&response)
    else {
        let _ = update_operation_phase(
            root,
            &operation.materialization.operation_id,
            "recovery-required",
            None,
            Some("acceptance-ambiguous"),
            now_millis(),
        );
        return Err("acceptance-ambiguous: Codex thread identity missing".to_string());
    };
    let operation = update_operation_phase(
        root,
        &operation.materialization.operation_id,
        "creating",
        Some(&target_session_id),
        None,
        now_millis(),
    )
    .map_err(|error| error.to_string())?;
    emit_progress(
        app,
        workspace_id,
        &operation.materialization.operation_id,
        ProviderContinuationProgressPhase::DeliveringContext,
    );
    let acceptance = match codex_context_transport(package.manifest.mode) {
        Ok(CodexContextTransport::Import) => {
            let items = codex_import_items(package);
            if items.is_empty() {
                Err("empty-context-package: no portable history items".to_string())
            } else {
                crate::shared::codex_core::inject_thread_items_core(
                    &state.sessions,
                    workspace_id,
                    Some(&provider_profile_id),
                    &target_session_id,
                    items,
                )
                .await
                .map(|_| ())
            }
        }
        Ok(CodexContextTransport::Prompt) => {
            let mode_enforcement_enabled = state
                .app_settings
                .lock()
                .await
                .codex_mode_enforcement_enabled;
            crate::shared::codex_core::send_user_message_core(
                &state.sessions,
                workspace_id.to_string(),
                Some(provider_profile_id.clone()),
                target_session_id.clone(),
                package.prompt_prefix.clone(),
                destination.model.clone(),
                destination.reasoning_effort.clone(),
                None,
                None,
                None,
                None,
                None,
                mode_enforcement_enabled,
                None,
            )
            .await
            .and_then(|response| {
                if response.get("error").is_some() {
                    Err(format!("context-prompt-rejected: {response}"))
                } else {
                    Ok(())
                }
            })
        }
        Err(error) => Err(error),
    };
    if let Err(error) = acceptance {
        let _ = update_operation_phase(
            root,
            &operation.materialization.operation_id,
            "recovery-required",
            Some(&target_session_id),
            Some("acceptance-ambiguous"),
            now_millis(),
        );
        return Err(format!("acceptance-ambiguous: {error}"));
    }
    emit_progress(
        app,
        workspace_id,
        &operation.materialization.operation_id,
        ProviderContinuationProgressPhase::VerifyingTarget,
    );
    emit_progress(
        app,
        workspace_id,
        &operation.materialization.operation_id,
        ProviderContinuationProgressPhase::Finalizing,
    );
    if let Err(error) = persist_target_metadata(
        state,
        workspace_id,
        &operation,
        destination,
        &target_session_id,
    )
    .await
    {
        let _ = update_operation_phase(
            root,
            &operation.materialization.operation_id,
            "creating",
            Some(&target_session_id),
            Some("catalog-commit-failed"),
            now_millis(),
        );
        return Err(format!("catalog-commit-failed: {error}"));
    }
    update_operation_phase(
        root,
        &operation.materialization.operation_id,
        "ready",
        Some(&target_session_id),
        None,
        now_millis(),
    )
    .map_err(|error| error.to_string())
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ClaudeBootstrapEvidence {
    Missing,
    BootstrapPersisted,
    Accepted,
    Rejected {
        status: Option<u64>,
        message: String,
    },
}

fn claude_rejection_error(status: Option<u64>, message: &str) -> String {
    let message = message.trim();
    if !message.is_empty() {
        return format!("target-provider-rejected: {message}");
    }
    match status {
        Some(status) => format!("target-provider-rejected: API Error: {status}"),
        None => "target-provider-rejected: target Provider rejected bootstrap".to_string(),
    }
}

async fn claude_history_bootstrap_evidence(
    state: &AppState,
    workspace_id: &str,
    target_session_id: &str,
    package_marker: &str,
    acceptance_marker: &str,
) -> Result<ClaudeBootstrapEvidence, String> {
    let workspace_path = workspace_path(state, workspace_id).await?;
    let config = state
        .engine_manager
        .get_engine_config(EngineType::Claude)
        .await;
    let path = crate::engine::claude_history::resolve_claude_session_file_with_config(
        &workspace_path,
        target_session_id,
        config.as_ref(),
    )?;
    let package_marker = package_marker.to_string();
    let acceptance_marker = acceptance_marker.to_string();
    tokio::task::spawn_blocking(move || {
        let content = crate::native_history::read_history_text_bounded(&path)
            .map_err(|error| error.to_string())?;
        Ok(claude_bootstrap_evidence_in_jsonl(
            &content,
            &package_marker,
            &acceptance_marker,
        ))
    })
    .await
    .map_err(|error| format!("native-history-worker: {error}"))?
}

fn claude_bootstrap_evidence_in_jsonl(
    content: &str,
    package_marker: &str,
    acceptance_marker: &str,
) -> ClaudeBootstrapEvidence {
    let mut bootstrap_persisted = false;
    let mut assistant_ack = false;
    let mut rejection = None;

    for line in content.lines() {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let role = entry
            .pointer("/message/role")
            .and_then(Value::as_str)
            .or_else(|| entry.get("type").and_then(Value::as_str));
        let text_blocks = entry.pointer("/message/content").and_then(Value::as_array);
        match role {
            Some("user") => {
                let is_current_bootstrap = text_blocks.is_some_and(|blocks| {
                    blocks.iter().any(|block| {
                        block
                            .get("text")
                            .and_then(Value::as_str)
                            .is_some_and(|text| {
                                text.contains(package_marker)
                                    && (text.contains("DOGE_NATIVE_CONTEXT_V1")
                                        || text.contains("MOSSX_NATIVE_CONTEXT_V1"))
                            })
                    })
                });
                bootstrap_persisted |= is_current_bootstrap;
            }
            Some("assistant") => {
                assistant_ack |= text_blocks.is_some_and(|blocks| {
                    blocks.iter().any(|block| {
                        block.get("text").and_then(Value::as_str).map(str::trim)
                            == Some(acceptance_marker)
                    })
                });
                if bootstrap_persisted
                    && (entry.get("isApiErrorMessage").and_then(Value::as_bool) == Some(true)
                        || entry
                            .get("apiErrorStatus")
                            .and_then(Value::as_u64)
                            .is_some())
                {
                    let message = text_blocks
                        .into_iter()
                        .flatten()
                        .filter_map(|block| block.get("text").and_then(Value::as_str))
                        .collect::<Vec<_>>()
                        .join("\n");
                    rejection = Some(ClaudeBootstrapEvidence::Rejected {
                        status: entry.get("apiErrorStatus").and_then(Value::as_u64),
                        message,
                    });
                }
            }
            _ => {}
        }
    }

    rejection.unwrap_or_else(|| {
        if assistant_ack {
            ClaudeBootstrapEvidence::Accepted
        } else if bootstrap_persisted {
            ClaudeBootstrapEvidence::BootstrapPersisted
        } else {
            ClaudeBootstrapEvidence::Missing
        }
    })
}

fn claude_assistant_ack_in_jsonl(content: &str, marker: &str) -> bool {
    claude_bootstrap_evidence_in_jsonl(content, "__no_package_marker__", marker)
        == ClaudeBootstrapEvidence::Accepted
}

fn validate_claude_model_against_catalog(
    model_catalog_entry_id: Option<&str>,
    runtime_model: Option<&str>,
    catalog: &[crate::engine::ModelInfo],
) -> Result<(), String> {
    crate::engine::status::validate_model_catalog_pair(
        model_catalog_entry_id,
        runtime_model,
        catalog,
        crate::engine::status::UnlistedRuntimeModelPolicy::Allow,
    )
}

fn validate_claude_continuation_model(
    destination: &ExecutionTargetInput,
    provider_profile_id: &str,
) -> Result<(), String> {
    let catalog = crate::engine::status::get_provider_scoped_engine_models(
        EngineType::Claude,
        Some(provider_profile_id),
    )?;
    match catalog {
        Some(catalog) => validate_claude_model_against_catalog(
            destination.model_catalog_entry_id.as_deref(),
            destination.model.as_deref(),
            &catalog,
        ),
        None if destination.model_catalog_entry_id.is_some() => {
            Err("invalid-target-model: Provider-scoped catalog is unavailable".to_string())
        }
        None => Ok(()),
    }
}

async fn execute_claude(
    state: &AppState,
    app: &AppHandle,
    workspace_id: &str,
    operation: NativeProviderContinuationOperation,
    destination: &ExecutionTargetInput,
    package: &ContextPackage,
) -> Result<NativeProviderContinuationOperation, String> {
    let root = app_data_root(state)?;
    if operation.phase == "ready" {
        return Ok(operation);
    }

    let marker = context_acceptance_marker(package);
    let package_marker = context_package_marker(package);
    if let Some(target_session_id) = operation.result_session_id.as_deref() {
        if operation.error_code.as_deref() == Some("catalog-commit-failed") {
            emit_progress(
                app,
                workspace_id,
                &operation.materialization.operation_id,
                ProviderContinuationProgressPhase::Finalizing,
            );
            persist_target_metadata(
                state,
                workspace_id,
                &operation,
                destination,
                target_session_id,
            )
            .await?;
            return update_operation_phase(
                root,
                &operation.materialization.operation_id,
                "ready",
                Some(target_session_id),
                None,
                now_millis(),
            )
            .map_err(|error| error.to_string());
        }
        let evidence = if operation.phase == "recovery-required" {
            emit_progress(
                app,
                workspace_id,
                &operation.materialization.operation_id,
                ProviderContinuationProgressPhase::VerifyingTarget,
            );
            claude_history_bootstrap_evidence(
                state,
                workspace_id,
                target_session_id.trim_start_matches("claude:"),
                &package_marker,
                &marker,
            )
            .await
            .map_err(|error| format!("recovery-required: {error}"))?
        } else {
            ClaudeBootstrapEvidence::Missing
        };
        match evidence {
            ClaudeBootstrapEvidence::Accepted | ClaudeBootstrapEvidence::BootstrapPersisted => {
                let canonical_target_session_id =
                    format!("claude:{}", target_session_id.trim_start_matches("claude:"));
                emit_progress(
                    app,
                    workspace_id,
                    &operation.materialization.operation_id,
                    ProviderContinuationProgressPhase::Finalizing,
                );
                persist_target_metadata(
                    state,
                    workspace_id,
                    &operation,
                    destination,
                    &canonical_target_session_id,
                )
                .await?;
                return update_operation_phase(
                    root,
                    &operation.materialization.operation_id,
                    "ready",
                    Some(&canonical_target_session_id),
                    None,
                    now_millis(),
                )
                .map_err(|error| error.to_string());
            }
            ClaudeBootstrapEvidence::Rejected { status, message } => {
                let _ = update_operation_phase(
                    root,
                    &operation.materialization.operation_id,
                    "recovery-required",
                    Some(target_session_id),
                    Some("target-provider-rejected"),
                    now_millis(),
                );
                return Err(claude_rejection_error(status, &message));
            }
            ClaudeBootstrapEvidence::Missing => {}
        }
        return Err(format!(
            "recovery-required: {}",
            operation
                .error_code
                .as_deref()
                .unwrap_or("acceptance-ambiguous")
        ));
    }
    if operation.phase == "creating" {
        let _ = update_operation_phase(
            root,
            &operation.materialization.operation_id,
            "recovery-required",
            None,
            Some("acceptance-ambiguous"),
            now_millis(),
        );
        return Err("acceptance-ambiguous: target creation state is unknown".to_string());
    }

    let provider_profile_id = destination
        .normalized_provider()
        .ok_or_else(|| "destination provider identity is required".to_string())?;
    validate_claude_continuation_model(destination, &provider_profile_id)?;
    let provider_launch_profile =
        crate::engine::claude::resolve_claude_provider_launch_profile(Some(&provider_profile_id))?;
    let workspace_path = workspace_path(state, workspace_id).await?;
    let session = state
        .engine_manager
        .get_claude_session_for_provider(workspace_id, &workspace_path, Some(&provider_profile_id))
        .await;
    let target_native_session_id = uuid::Uuid::new_v4().to_string();
    let canonical_target_session_id = format!("claude:{target_native_session_id}");
    let operation = update_operation_phase(
        root,
        &operation.materialization.operation_id,
        "creating",
        Some(&canonical_target_session_id),
        None,
        now_millis(),
    )
    .map_err(|error| error.to_string())?;
    let prompt = format!(
        "{}\n\n\
         The context above was prepared by doge from an existing native session. \
         Treat it as prior conversation context. Reply with exactly this acceptance marker \
         and no other text:\n{}",
        package.prompt_prefix, marker
    );
    let params = crate::engine::SendMessageParams {
        text: prompt,
        model: destination.model.clone(),
        session_id: Some(target_native_session_id),
        continue_session: false,
        disable_thinking: true,
        ..Default::default()
    };
    let turn_id = format!(
        "provider-continuation-{}",
        operation.materialization.operation_id
    );
    emit_progress(
        app,
        workspace_id,
        &operation.materialization.operation_id,
        ProviderContinuationProgressPhase::DeliveringContext,
    );
    let response = match session
        .send_context_bootstrap_with_provider_env(
            params,
            &turn_id,
            provider_launch_profile.as_ref().map(|profile| &profile.env),
        )
        .await
    {
        Ok(response) => response,
        Err(error) => {
            let evidence = claude_history_bootstrap_evidence(
                state,
                workspace_id,
                canonical_target_session_id.trim_start_matches("claude:"),
                &package_marker,
                &marker,
            )
            .await
            .unwrap_or(ClaudeBootstrapEvidence::Missing);
            if let ClaudeBootstrapEvidence::Rejected { status, message } = evidence {
                let _ = update_operation_phase(
                    root,
                    &operation.materialization.operation_id,
                    "recovery-required",
                    Some(&canonical_target_session_id),
                    Some("target-provider-rejected"),
                    now_millis(),
                );
                return Err(claude_rejection_error(status, &message));
            }
            let _ = update_operation_phase(
                root,
                &operation.materialization.operation_id,
                "recovery-required",
                Some(&canonical_target_session_id),
                Some("acceptance-ambiguous"),
                now_millis(),
            );
            return Err(format!("acceptance-ambiguous: {error}"));
        }
    };
    emit_progress(
        app,
        workspace_id,
        &operation.materialization.operation_id,
        ProviderContinuationProgressPhase::VerifyingTarget,
    );
    if let Ok(ClaudeBootstrapEvidence::Rejected { status, message }) =
        claude_history_bootstrap_evidence(
            state,
            workspace_id,
            canonical_target_session_id.trim_start_matches("claude:"),
            &package_marker,
            &marker,
        )
        .await
    {
        let _ = update_operation_phase(
            root,
            &operation.materialization.operation_id,
            "recovery-required",
            Some(&canonical_target_session_id),
            Some("target-provider-rejected"),
            now_millis(),
        );
        return Err(claude_rejection_error(status, &message));
    }
    // Claude CLI 已完成该 bootstrap turn，说明 prompt transport 已被目标 Session
    // 接收。模型是否逐字复述 marker 不是 transport ACK；把模型服从性当成 ACK
    // 会造成“目标已创建但首次报错、二次 probe 才成功”的假失败。
    if response.trim() != marker {
        log::info!(
            "[native-continuation] operation_id={} target_session_id={} bootstrap completed without exact marker echo",
            operation.materialization.operation_id,
            canonical_target_session_id
        );
    }
    emit_progress(
        app,
        workspace_id,
        &operation.materialization.operation_id,
        ProviderContinuationProgressPhase::Finalizing,
    );
    if let Err(error) = persist_target_metadata(
        state,
        workspace_id,
        &operation,
        destination,
        &canonical_target_session_id,
    )
    .await
    {
        let _ = update_operation_phase(
            root,
            &operation.materialization.operation_id,
            "creating",
            Some(&canonical_target_session_id),
            Some("catalog-commit-failed"),
            now_millis(),
        );
        return Err(format!("catalog-commit-failed: {error}"));
    }
    update_operation_phase(
        root,
        &operation.materialization.operation_id,
        "ready",
        Some(&canonical_target_session_id),
        None,
        now_millis(),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn prepare_native_provider_continuation(
    workspace_id: String,
    operation_id: String,
    source: NativeHistorySource,
    destination: ExecutionTargetInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if crate::remote_backend::is_remote_mode(&*state).await {
        return crate::remote_backend::call_remote(
            &*state,
            app,
            "prepare_native_provider_continuation",
            json!({
                "workspaceId": workspace_id,
                "operationId": operation_id,
                "source": source,
                "destination": destination,
            }),
        )
        .await;
    }
    let started_at = Instant::now();
    validate_provider_continuation_request(
        &state,
        &workspace_id,
        &operation_id,
        &source,
        &destination,
    )?;
    let operation_id = operation_id.trim();
    emit_progress(
        &app,
        &workspace_id,
        operation_id,
        ProviderContinuationProgressPhase::ReadingSource,
    );

    let (operation, package) = prepare(
        &state,
        &app,
        &workspace_id,
        operation_id,
        &source,
        &destination,
    )
    .await?;
    let (_, degraded) = context_fidelity(&destination, &package);
    emit_progress(
        &app,
        &workspace_id,
        operation_id,
        ProviderContinuationProgressPhase::Prepared,
    );
    log::info!(
        "[native-continuation] operation_id={} action=prepare completed elapsed_ms={}",
        operation_id,
        started_at.elapsed().as_millis()
    );
    Ok(json!({
        "status": "prepared",
        "operation": operation,
        "fidelity": if degraded { "degraded" } else { "strong" },
        "sourceEstimatedTokens": package.compression.source_estimated_tokens,
        "packageEstimatedTokens": package.compression.package_estimated_tokens,
    }))
}

#[tauri::command]
pub(crate) async fn discard_prepared_native_provider_continuation(
    workspace_id: String,
    operation_id: String,
    source: NativeHistorySource,
    destination: ExecutionTargetInput,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    if crate::remote_backend::is_remote_mode(&*state).await {
        let response = crate::remote_backend::call_remote(
            &*state,
            app,
            "discard_prepared_native_provider_continuation",
            json!({
                "workspaceId": workspace_id,
                "operationId": operation_id,
                "source": source,
                "destination": destination,
            }),
        )
        .await?;
        return serde_json::from_value(response).map_err(|error| error.to_string());
    }
    validate_provider_continuation_request(
        &state,
        &workspace_id,
        &operation_id,
        &source,
        &destination,
    )?;
    let operation_id = operation_id.trim();
    let checksum = request_checksum(&source, &destination)?;
    let discarded = delete_prepared_operation(app_data_root(&state)?, operation_id, &checksum)
        .map_err(|error| error.to_string())?;
    log::info!(
        "[native-continuation] operation_id={} action=discard_prepared discarded={}",
        operation_id,
        discarded
    );
    Ok(discarded)
}

#[tauri::command]
pub(crate) async fn create_native_provider_continuation(
    workspace_id: String,
    operation_id: String,
    source: NativeHistorySource,
    destination: ExecutionTargetInput,
    confirm_degraded: Option<bool>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if crate::remote_backend::is_remote_mode(&*state).await {
        return crate::remote_backend::call_remote(
            &*state,
            app,
            "create_native_provider_continuation",
            json!({
                "workspaceId": workspace_id,
                "operationId": operation_id,
                "source": source,
                "destination": destination,
                "confirmDegraded": confirm_degraded,
            }),
        )
        .await;
    }
    let started_at = Instant::now();
    validate_provider_continuation_request(
        &state,
        &workspace_id,
        &operation_id,
        &source,
        &destination,
    )?;
    let operation_id = operation_id.trim();
    emit_progress(
        &app,
        &workspace_id,
        operation_id,
        ProviderContinuationProgressPhase::ReadingSource,
    );

    let (operation, package) = prepare(
        &state,
        &app,
        &workspace_id,
        operation_id,
        &source,
        &destination,
    )
    .await?;
    let (adapter_dropped_entries, degraded) = context_fidelity(&destination, &package);
    emit_progress(
        &app,
        &workspace_id,
        operation_id,
        ProviderContinuationProgressPhase::Prepared,
    );
    if degraded && confirm_degraded != Some(true) {
        return Ok(json!({
            "status": "confirmation-required",
            "operation": operation,
            "fidelity": "degraded",
            "projectionMode": package.manifest.mode,
            "omissions": package.manifest.omitted,
            "adapterDroppedEntries": adapter_dropped_entries,
            "sourceEstimatedTokens": package.compression.source_estimated_tokens,
            "packageEstimatedTokens": package.compression.package_estimated_tokens,
        }));
    }
    emit_progress(
        &app,
        &workspace_id,
        operation_id,
        ProviderContinuationProgressPhase::StartingTarget,
    );
    let operation = match destination.engine {
        EngineType::Codex => {
            execute_codex(
                &state,
                &app,
                &workspace_id,
                operation,
                &destination,
                &package,
            )
            .await?
        }
        EngineType::Claude => {
            execute_claude(
                &state,
                &app,
                &workspace_id,
                operation,
                &destination,
                &package,
            )
            .await?
        }
        _ => unreachable!("target engine validated above"),
    };
    emit_progress(
        &app,
        &workspace_id,
        operation_id,
        ProviderContinuationProgressPhase::Ready,
    );
    log::info!(
        "[native-continuation] operation_id={} action=create completed elapsed_ms={}",
        operation_id,
        started_at.elapsed().as_millis()
    );
    Ok(json!({
        "status": operation.phase,
        "operation": operation,
        "fidelity": if degraded { "degraded" } else { "strong" },
    }))
}

#[cfg(test)]
mod tests {
    use super::{
        claude_assistant_ack_in_jsonl, claude_bootstrap_evidence_in_jsonl, codex_context_transport,
        native_provider_source, raw_codex_thread_id, validate_claude_model_against_catalog,
        validate_provider_continuation_shape, CanonicalProviderProfileSource,
        ClaudeBootstrapEvidence, CodexContextTransport, ProjectionMode,
        ProviderContinuationProgressPhase,
    };
    use crate::engine::EngineType;
    use crate::native_history::{NativeHistoryEngine, NativeHistorySource};
    use crate::shared_session_v2::ExecutionTargetInput;

    fn validate_source_identity(
        engine: NativeHistoryEngine,
        session_id: &str,
        native_session_id: &str,
    ) -> Result<(), String> {
        let destination = ExecutionTargetInput {
            engine: if engine == NativeHistoryEngine::Codex {
                EngineType::Claude
            } else {
                EngineType::Codex
            },
            provider_profile_id: Some("target-provider".to_string()),
            model_catalog_entry_id: None,
            model: None,
            reasoning_effort: None,
            provider_profile_name_snapshot: None,
            provider_profile_source: None,
            runtime_capability_fingerprint: None,
        };
        validate_provider_continuation_shape(
            "operation-1",
            &NativeHistorySource {
                session_id: session_id.to_string(),
                native_session_id: native_session_id.to_string(),
                engine,
                provider_profile_id: Some("source-provider".to_string()),
            },
            &destination,
        )
    }

    #[test]
    fn provider_continuation_source_identity_validation_is_engine_aware() {
        for (engine, session_id, native_session_id) in [
            (
                NativeHistoryEngine::Codex,
                "codex-history-1",
                "codex-history-1",
            ),
            (
                NativeHistoryEngine::Codex,
                "codex:codex-history-1",
                "codex-history-1",
            ),
            (
                NativeHistoryEngine::Claude,
                "claude:claude-history-1",
                "claude-history-1",
            ),
            (
                NativeHistoryEngine::Kimi,
                "kimi:kimi-history-1",
                "kimi-history-1",
            ),
        ] {
            assert!(
                validate_source_identity(engine, session_id, native_session_id).is_ok(),
                "{engine:?} identity should be accepted: {session_id}"
            );
        }

        for (engine, session_id, native_session_id) in [
            (
                NativeHistoryEngine::Codex,
                "codex-history-2",
                "codex-history-1",
            ),
            (
                NativeHistoryEngine::Codex,
                "codex:codex-history-2",
                "codex-history-1",
            ),
            (
                NativeHistoryEngine::Claude,
                "claude-history-1",
                "claude-history-1",
            ),
            (
                NativeHistoryEngine::Kimi,
                "kimi-history-1",
                "kimi-history-1",
            ),
        ] {
            assert_eq!(
                validate_source_identity(engine, session_id, native_session_id)
                    .expect_err("identity should be rejected"),
                "source session identity does not match native session identity"
            );
        }
    }

    #[test]
    fn codex_result_identity_normalizes_legacy_prefixes_to_raw_thread_id() {
        assert_eq!(raw_codex_thread_id("thread-1"), Some("thread-1"));
        assert_eq!(raw_codex_thread_id("codex:thread-1"), Some("thread-1"));
        assert_eq!(
            raw_codex_thread_id("codex:codex:thread-1"),
            Some("thread-1")
        );
        assert_eq!(raw_codex_thread_id("codex:"), None);
    }

    #[test]
    fn canonical_provider_source_maps_back_to_native_catalog_source_explicitly() {
        assert_eq!(
            native_provider_source(Some(CanonicalProviderProfileSource::Local)),
            "disk"
        );
        assert_eq!(
            native_provider_source(Some(CanonicalProviderProfileSource::Managed)),
            "managed"
        );
        assert_eq!(native_provider_source(None), "disk");
    }

    #[test]
    fn continuation_progress_milestones_are_monotonic_and_finish_at_one_hundred() {
        let milestones = [
            ProviderContinuationProgressPhase::ReadingSource,
            ProviderContinuationProgressPhase::CompilingContext,
            ProviderContinuationProgressPhase::Prepared,
            ProviderContinuationProgressPhase::StartingTarget,
            ProviderContinuationProgressPhase::DeliveringContext,
            ProviderContinuationProgressPhase::VerifyingTarget,
            ProviderContinuationProgressPhase::Finalizing,
            ProviderContinuationProgressPhase::Ready,
        ]
        .map(ProviderContinuationProgressPhase::percent);

        assert!(milestones.windows(2).all(|window| window[0] < window[1]));
        assert_eq!(milestones.last(), Some(&100));
    }

    #[test]
    fn claude_recovery_requires_assistant_ack_not_user_prompt_marker() {
        let marker = "MOSSX_CONTEXT_ACCEPTED:package:checksum";
        let user_only = format!(
            r#"{{"type":"user","message":{{"role":"user","content":[{{"type":"text","text":"{marker}"}}]}}}}"#
        );
        assert!(!claude_assistant_ack_in_jsonl(&user_only, marker));

        let assistant = format!(
            r#"{{"type":"assistant","message":{{"role":"assistant","content":[{{"type":"text","text":"{marker}"}}]}}}}"#
        );
        assert!(claude_assistant_ack_in_jsonl(&assistant, marker));
    }

    #[test]
    fn claude_recovery_accepts_durable_bootstrap_user_entry_without_model_echo() {
        let package_marker = "MOSSX_CONTEXT_PACKAGE:package:checksum";
        let acceptance_marker = "MOSSX_CONTEXT_ACCEPTED:package:checksum";
        let bootstrap = format!(
            r#"{{"type":"user","message":{{"role":"user","content":[{{"type":"text","text":"{package_marker}\nMOSSX_NATIVE_CONTEXT_V1\nsource:claude:source\nbinding:continuation:operation"}}]}}}}"#
        );
        assert_eq!(
            claude_bootstrap_evidence_in_jsonl(&bootstrap, package_marker, acceptance_marker,),
            ClaudeBootstrapEvidence::BootstrapPersisted
        );
    }

    #[test]
    fn claude_recovery_rejects_unrelated_user_marker_text() {
        let package_marker = "MOSSX_CONTEXT_PACKAGE:package:checksum";
        let unrelated = format!(
            r#"{{"type":"user","message":{{"role":"user","content":[{{"type":"text","text":"please explain {package_marker}"}}]}}}}"#
        );
        assert_eq!(
            claude_bootstrap_evidence_in_jsonl(
                &unrelated,
                package_marker,
                "MOSSX_CONTEXT_ACCEPTED:package:checksum",
            ),
            ClaudeBootstrapEvidence::Missing
        );
    }

    #[test]
    fn claude_recovery_prefers_structured_api_rejection_over_bootstrap_entry() {
        let package_marker = "MOSSX_CONTEXT_PACKAGE:package:checksum";
        let bootstrap = format!(
            r#"{{"type":"user","message":{{"role":"user","content":[{{"type":"text","text":"{package_marker}\nMOSSX_NATIVE_CONTEXT_V1"}}]}}}}
{{"type":"assistant","isApiErrorMessage":true,"apiErrorStatus":400,"message":{{"role":"assistant","content":[{{"type":"text","text":"API Error: 400 invalid model"}}]}}}}"#
        );
        assert_eq!(
            claude_bootstrap_evidence_in_jsonl(
                &bootstrap,
                package_marker,
                "MOSSX_CONTEXT_ACCEPTED:package:checksum",
            ),
            ClaudeBootstrapEvidence::Rejected {
                status: Some(400),
                message: "API Error: 400 invalid model".to_string(),
            }
        );
    }

    #[test]
    fn claude_recovery_ignores_api_error_text_inside_source_context() {
        let package_marker = "MOSSX_CONTEXT_PACKAGE:package:checksum";
        let bootstrap = format!(
            r#"{{"type":"user","message":{{"role":"user","content":[{{"type":"text","text":"{package_marker}\nMOSSX_NATIVE_CONTEXT_V1\nold API Error: 400"}}]}}}}"#
        );
        assert_eq!(
            claude_bootstrap_evidence_in_jsonl(
                &bootstrap,
                package_marker,
                "MOSSX_CONTEXT_ACCEPTED:package:checksum",
            ),
            ClaudeBootstrapEvidence::BootstrapPersisted
        );
    }

    #[test]
    fn claude_model_validation_separates_catalog_id_from_runtime_model() {
        let catalog = vec![
            crate::engine::ModelInfo::new("settings-reasoning", "Reasoning")
                .with_runtime_model("deepseek-v4-pro"),
        ];
        assert!(validate_claude_model_against_catalog(
            Some("settings-reasoning"),
            Some("deepseek-v4-pro"),
            &catalog,
        )
        .is_ok());
        assert!(validate_claude_model_against_catalog(
            Some("settings-reasoning"),
            Some("settings-reasoning"),
            &catalog,
        )
        .expect_err("UI id must not reach runtime")
        .contains("requires runtime model 'deepseek-v4-pro'"));
        assert!(
            validate_claude_model_against_catalog(None, Some("settings-reasoning"), &catalog,)
                .expect_err("legacy UI id must fail closed")
                .contains("is a catalog entry id")
        );
        assert!(validate_claude_model_against_catalog(
            None,
            Some("custom/provider-model"),
            &catalog,
        )
        .is_ok());
    }

    #[test]
    fn codex_unsupported_import_degrades_to_prompt_transport() {
        assert_eq!(
            codex_context_transport(ProjectionMode::NativeHistoryImport).expect("import"),
            CodexContextTransport::Import
        );
        assert_eq!(
            codex_context_transport(ProjectionMode::PortableTranscript).expect("transcript"),
            CodexContextTransport::Prompt
        );
        assert_eq!(
            codex_context_transport(ProjectionMode::Checkpoint).expect("checkpoint"),
            CodexContextTransport::Prompt
        );
        assert!(codex_context_transport(ProjectionMode::NativeDelta).is_err());
    }
}
