use super::super::claude::ClaudeStreamTiming;
use super::claude_forwarder::{
    handle_claude_forwarder_event, ClaudeForwarderFuture, ClaudeForwarderRuntimeOps,
    ClaudeForwarderState, CLAUDE_RUNTIME_SYNC_HEARTBEAT_SECS,
};
use super::{
    build_claude_dispatch_receipt, build_engine_active_process_diagnostics,
    build_provider_engine_dispatch_receipt, build_provider_prefill_query,
    collect_stale_child_candidates, delete_opencode_session_files,
    delete_opencode_session_from_datastore, ensure_engine_enabled, extract_turn_result_text,
    filter_opencode_sessions_for_workspace, gemini_agent_completion_item_id,
    is_likely_foreign_model_for_gemini, is_likely_legacy_claude_model_id,
    is_valid_claude_model_for_passthrough, merge_opencode_agents, next_gemini_routed_item_id,
    normalize_provider_key, opencode_data_candidate_roots, opencode_session_candidate_paths,
    parse_imported_session_id, parse_json_value, parse_opencode_agent_list,
    parse_opencode_auth_providers, parse_opencode_debug_config_agents,
    parse_opencode_help_commands, parse_opencode_mcp_servers, parse_opencode_session_list,
    parse_opencode_updated_at, provider_keys_match,
    record_claude_auto_session_metadata_for_sync_result,
    resolve_claude_auto_session_metadata_session_id, resolve_claude_session_id_for_engine_send,
    resolve_enabled_engine_for_send, validate_remote_requested_engine, EngineConfig,
    EngineWorkspaceActiveProcessDiagnostics, GeminiRenderLane, GeminiRenderRoutingState,
    OpenCodeAgentEntry, OpenCodeSessionEntry, RegisteredEngineActiveProcessDiagnostic,
    StaleChildCandidate,
};
use crate::backend::events::AppServerEvent;
use crate::engine::commands::require_image_support;
use crate::engine::events::EngineEvent;
use crate::session_management::{AutoSessionCreatedBy, AutoSessionMetadata, AutoSessionVisibility};
use crate::types::{WorkspaceEntry, WorkspaceKind, WorkspaceSettings};
use chrono::{Local, TimeZone};
use rusqlite::{params, Connection};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use uuid::Uuid;

use crate::engine::kimi::resolve_kimi_session_id_for_engine_send;
use crate::engine::SendMessageParams;

#[test]
fn claude_dispatch_receipt_normalizes_explicit_local_provider_sentinel() {
    let receipt = build_claude_dispatch_receipt(
        "workspace-local",
        Some(crate::engine::claude::CLAUDE_LOCAL_PROVIDER_PROFILE_ID),
        Some("claude-sonnet-4-5"),
        Some("high"),
    );

    assert_eq!(receipt["engine"], "claude");
    assert!(receipt["providerProfileId"].is_null());
    assert_eq!(receipt["providerProfileSource"], "local");
    assert_eq!(
        receipt["providerRuntimeKey"],
        format!(
            "claude::workspace-local::{}",
            crate::engine::claude::CLAUDE_LOCAL_PROVIDER_PROFILE_ID
        )
    );
    assert_eq!(receipt["model"], "claude-sonnet-4-5");
    assert_eq!(receipt["reasoningEffort"], "high");
}

#[test]
fn claude_dispatch_receipt_preserves_managed_provider_identity() {
    let receipt = build_claude_dispatch_receipt(
        "workspace-managed",
        Some("provider-anthropic"),
        Some("claude-opus-4-1"),
        None,
    );

    assert_eq!(receipt["providerProfileId"], "provider-anthropic");
    assert_eq!(receipt["providerProfileSource"], "managed");
    assert_eq!(
        receipt["providerRuntimeKey"],
        "claude::workspace-managed::provider-anthropic"
    );
    assert!(receipt["reasoningEffort"].is_null());
}

#[test]
fn image_support_guard_follows_engine_feature_matrix() {
    use crate::engine::EngineType;

    let non_empty = Some(vec!["/tmp/example.png".to_string()]);
    let whitespace_only = Some(vec!["  ".to_string(), "".to_string(), " \n ".to_string()]);

    // All current CLI engines support image input at the capability gate.
    // (Transport differs: Claude/Codex native, Grok prompt-file, OpenCode -f,
    //  Kimi path+ReadMediaFile.)
    for engine in [
        EngineType::Claude,
        EngineType::Codex,
        EngineType::Gemini,
        EngineType::Grok,
        EngineType::Kimi,
        EngineType::OpenCode,
    ] {
        assert_eq!(require_image_support(engine, &non_empty), Ok(()));
        assert_eq!(require_image_support(engine, &whitespace_only), Ok(()));
        assert_eq!(require_image_support(engine, &None), Ok(()));
    }
}

#[test]
fn provider_engine_dispatch_receipt_normalizes_local_sentinels() {
    for (engine, local_profile_id) in [
        (
            crate::engine::EngineType::Kimi,
            crate::engine::kimi_provider_profile::KIMI_LOCAL_PROVIDER_PROFILE_ID,
        ),
        (
            crate::engine::EngineType::Grok,
            crate::engine::grok_provider_profile::GROK_LOCAL_PROVIDER_PROFILE_ID,
        ),
        (
            crate::engine::EngineType::OpenCode,
            crate::engine::opencode_provider_profile::OPENCODE_LOCAL_PROVIDER_PROFILE_ID,
        ),
    ] {
        let runtime_key = format!("{}::workspace-local::{local_profile_id}", engine.icon());
        let receipt = build_provider_engine_dispatch_receipt(
            engine,
            Some(local_profile_id),
            &runtime_key,
            Some("runtime-model"),
            Some("high"),
        );

        assert_eq!(receipt["engine"], engine.icon());
        assert!(receipt["providerProfileId"].is_null());
        assert_eq!(receipt["providerProfileSource"], "local");
        assert_eq!(receipt["providerRuntimeKey"], runtime_key);
        assert_eq!(receipt["model"], "runtime-model");
        assert_eq!(receipt["reasoningEffort"], "high");
    }
}

#[test]
fn kimi_new_turn_waits_for_cli_canonical_session_id() {
    assert_eq!(
        resolve_kimi_session_id_for_engine_send(false, None, None),
        None
    );
    assert_eq!(
        resolve_kimi_session_id_for_engine_send(
            true,
            Some("session-explicit".to_string()),
            Some("session-current".to_string()),
        ),
        Some("session-explicit".to_string())
    );
    assert_eq!(
        resolve_kimi_session_id_for_engine_send(true, None, Some("session-current".to_string())),
        Some("session-current".to_string())
    );
}

#[test]
fn gui_send_gate_rejects_legacy_gemini_setting_before_remote_forwarding() {
    let mut settings = crate::types::AppSettings::default();
    settings.gemini_enabled = true;

    assert_eq!(
        resolve_enabled_engine_for_send(
            &settings,
            Some(crate::engine::EngineType::Gemini),
            crate::engine::EngineType::Claude,
        ),
        Err(crate::engine_policy::GEMINI_DISABLED_DIAGNOSTIC.to_string())
    );
    assert_eq!(
        resolve_enabled_engine_for_send(&settings, None, crate::engine::EngineType::Gemini,),
        Err(crate::engine_policy::GEMINI_DISABLED_DIAGNOSTIC.to_string())
    );
}

#[test]
fn gui_switch_gate_rejects_legacy_gemini_setting_before_remote_forwarding() {
    let mut settings = crate::types::AppSettings::default();
    settings.gemini_enabled = true;

    assert_eq!(
        ensure_engine_enabled(&settings, crate::engine::EngineType::Gemini),
        Err(crate::engine_policy::GEMINI_DISABLED_DIAGNOSTIC.to_string())
    );
}

#[test]
fn gui_models_gate_rejects_legacy_gemini_setting_before_remote_forwarding() {
    let mut settings = crate::types::AppSettings::default();
    settings.gemini_enabled = true;

    assert_eq!(
        ensure_engine_enabled(&settings, crate::engine::EngineType::Gemini),
        Err(crate::engine_policy::GEMINI_DISABLED_DIAGNOSTIC.to_string())
    );
}

#[test]
fn remote_send_validation_preserves_authoritative_none_and_rejects_explicit_gemini() {
    let mut settings = crate::types::AppSettings::default();
    settings.gemini_enabled = true;

    assert_eq!(validate_remote_requested_engine(&settings, None), Ok(None));
    assert_eq!(
        validate_remote_requested_engine(&settings, Some(crate::engine::EngineType::Gemini)),
        Err(crate::engine_policy::GEMINI_DISABLED_DIAGNOSTIC.to_string())
    );
}

#[test]
fn engine_active_process_diagnostics_sorts_workspaces_and_counts_processes() {
    let diagnostics = build_engine_active_process_diagnostics(
        1_765_647_000_000,
        vec![
            EngineWorkspaceActiveProcessDiagnostics {
                workspace_id: "ws-z".to_string(),
                engine: crate::engine::EngineType::Claude,
                active_process_ids: vec![301],
                registered_active_processes: vec![RegisteredEngineActiveProcessDiagnostic {
                    pid: 301,
                    registered_age_ms: 0,
                }],
            },
            EngineWorkspaceActiveProcessDiagnostics {
                workspace_id: "ws-a".to_string(),
                engine: crate::engine::EngineType::Claude,
                active_process_ids: vec![101, 102],
                registered_active_processes: vec![
                    RegisteredEngineActiveProcessDiagnostic {
                        pid: 101,
                        registered_age_ms: 0,
                    },
                    RegisteredEngineActiveProcessDiagnostic {
                        pid: 102,
                        registered_age_ms: 0,
                    },
                ],
            },
        ],
        Vec::new(),
    );

    assert!(diagnostics.measured);
    assert_eq!(diagnostics.sampled_at_ms, 1_765_647_000_000);
    assert_eq!(diagnostics.total_active_process_count, 3);
    assert_eq!(
        diagnostics
            .workspaces
            .iter()
            .map(|workspace| workspace.workspace_id.as_str())
            .collect::<Vec<_>>(),
        vec!["ws-a", "ws-z"]
    );
    assert_eq!(diagnostics.workspaces[0].active_process_ids, vec![101, 102]);
    assert!(diagnostics.unsupported_reason.is_none());
    assert_eq!(diagnostics.os_child_liveness.evidence_class, "unsupported");
    assert!(diagnostics.os_child_liveness.rationale.is_some());
    assert!(diagnostics.stale_child_candidates.is_empty());
}

#[test]
fn engine_active_process_diagnostics_records_stale_candidates_separately_from_os_liveness() {
    let diagnostics = build_engine_active_process_diagnostics(
        1_765_647_000_000,
        vec![EngineWorkspaceActiveProcessDiagnostics {
            workspace_id: "ws-a".to_string(),
            engine: crate::engine::EngineType::OpenCode,
            active_process_ids: vec![777],
            registered_active_processes: vec![RegisteredEngineActiveProcessDiagnostic {
                pid: 777,
                registered_age_ms: 5 * 60 * 1000,
            }],
        }],
        vec![StaleChildCandidate {
            workspace_id: "ws-a".to_string(),
            engine: "opencode".to_string(),
            pid: 777,
            registered_age_ms: 0,
            stale_reason: "diagnostics-only-candidate".to_string(),
            progress_evidence: "unsupported".to_string(),
        }],
    );

    // Registry count is one; OS-liveness evidence remains unsupported; the
    // stale candidate is recorded separately with progressEvidence="unsupported"
    // because OpenCode does not expose structured IO/progress metadata.
    assert_eq!(diagnostics.total_active_process_count, 1);
    assert_eq!(diagnostics.os_child_liveness.evidence_class, "unsupported");
    assert_eq!(diagnostics.stale_child_candidates.len(), 1);
    assert_eq!(
        diagnostics.stale_child_candidates[0].progress_evidence,
        "unsupported"
    );
}

#[test]
fn stale_child_candidates_respect_registered_age_threshold() {
    let fresh = collect_stale_child_candidates(
        &[EngineWorkspaceActiveProcessDiagnostics {
            workspace_id: "ws-fresh".to_string(),
            engine: crate::engine::EngineType::OpenCode,
            active_process_ids: vec![701],
            registered_active_processes: vec![RegisteredEngineActiveProcessDiagnostic {
                pid: 701,
                registered_age_ms: 4 * 60 * 1000,
            }],
        }],
        1_765_647_000_000,
    );
    assert!(fresh.is_empty());

    let stale = collect_stale_child_candidates(
        &[EngineWorkspaceActiveProcessDiagnostics {
            workspace_id: "ws-stale".to_string(),
            engine: crate::engine::EngineType::Gemini,
            active_process_ids: vec![702],
            registered_active_processes: vec![RegisteredEngineActiveProcessDiagnostic {
                pid: 702,
                registered_age_ms: 5 * 60 * 1000,
            }],
        }],
        1_765_647_000_000,
    );
    assert_eq!(stale.len(), 1);
    assert_eq!(stale[0].pid, 702);
    assert_eq!(stale[0].progress_evidence, "unsupported");
}

#[test]
fn resolve_claude_session_id_for_sync_new_auto_session_generates_identity() {
    let session_id = resolve_claude_session_id_for_engine_send(None, None, false, None)
        .expect("new sync Claude session should get stable identity");

    Uuid::parse_str(&session_id).expect("generated session id should be UUID-shaped");
}

#[test]
fn resolve_claude_session_id_for_sync_keeps_resume_and_fork_boundaries() {
    assert_eq!(
        resolve_claude_session_id_for_engine_send(
            None,
            None,
            true,
            Some("tracked-session".to_string()),
        )
        .as_deref(),
        Some("tracked-session"),
    );
    assert_eq!(
        resolve_claude_session_id_for_engine_send(
            Some("fork-source"),
            Some("must-not-use".to_string()),
            false,
            None,
        ),
        None,
    );
}

#[test]
fn resolve_claude_auto_session_metadata_id_keeps_success_path() {
    assert_eq!(
        resolve_claude_auto_session_metadata_session_id(
            true,
            Some("11111111-1111-4111-8111-111111111111"),
            None,
        )
        .as_deref(),
        Some("11111111-1111-4111-8111-111111111111"),
    );
}

#[test]
fn resolve_claude_auto_session_metadata_id_uses_observed_failed_identity() {
    assert_eq!(
        resolve_claude_auto_session_metadata_session_id(
            false,
            Some("22222222-2222-4222-8222-222222222222"),
            Some("22222222-2222-4222-8222-222222222222"),
        )
        .as_deref(),
        Some("22222222-2222-4222-8222-222222222222"),
    );
}

#[test]
fn resolve_claude_auto_session_metadata_id_ignores_unobserved_failed_identity() {
    assert_eq!(
        resolve_claude_auto_session_metadata_session_id(
            false,
            Some("33333333-3333-4333-8333-333333333333"),
            None,
        ),
        None,
    );
    assert_eq!(
        resolve_claude_auto_session_metadata_session_id(
            false,
            Some("33333333-3333-4333-8333-333333333333"),
            Some("different-session"),
        ),
        None,
    );
}

#[tokio::test]
async fn failed_claude_sync_auto_session_persists_metadata_after_identity_is_observed() {
    let base = std::env::temp_dir().join(format!(
        "claude-sync-failed-auto-session-{}",
        Uuid::new_v4()
    ));
    fs::create_dir_all(&base).expect("create temp dir");
    let storage_path = base.join("workspaces.json");
    fs::write(&storage_path, "[]").expect("seed storage path");
    let workspace = WorkspaceEntry {
        id: "ws-1".to_string(),
        name: "Workspace".to_string(),
        path: "/tmp/ws-1".to_string(),
        codex_bin: None,
        kind: WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings: WorkspaceSettings::default(),
    };
    let workspaces = tokio::sync::Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));
    let session_id = "22222222-2222-4222-8222-222222222222";

    record_claude_auto_session_metadata_for_sync_result(
        &workspaces,
        &storage_path,
        "ws-1",
        false,
        Some(session_id),
        Some(session_id),
        Some(AutoSessionMetadata {
            session_purpose: "spec-hub-apply".to_string(),
            visibility: AutoSessionVisibility::SystemAuto,
            owner_feature: "spec-hub".to_string(),
            auto_archive: Some(false),
            created_by: AutoSessionCreatedBy::System,
        }),
    )
    .await;

    let metadata_path = base
        .join("session-management")
        .join("workspaces")
        .join("ws-1.json");
    let stored: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(&metadata_path).expect("metadata file should exist"),
    )
    .expect("metadata json");
    let stable_key = format!("claude:ws-1:{session_id}");
    let stored_metadata = stored
        .get("autoSessionBySessionId")
        .and_then(|entries| entries.get(&stable_key))
        .expect("failed automatic session metadata should be persisted");
    assert_eq!(
        stored_metadata
            .get("visibility")
            .and_then(|value| value.as_str()),
        Some("system-auto")
    );
    assert_eq!(
        stored_metadata
            .get("sessionPurpose")
            .and_then(|value| value.as_str()),
        Some("spec-hub-apply")
    );

    fs::remove_dir_all(base).ok();
}

#[derive(Clone, Default)]
struct FakeClaudeRuntimeOps {
    calls: Arc<StdMutex<Vec<String>>>,
}

impl FakeClaudeRuntimeOps {
    fn calls(&self) -> Vec<String> {
        self.calls.lock().expect("calls lock").clone()
    }

    fn push_call(&self, value: &str) {
        self.calls
            .lock()
            .expect("calls lock")
            .push(value.to_string());
    }
}

impl ClaudeForwarderRuntimeOps for FakeClaudeRuntimeOps {
    fn touch_turn_activity<'a>(&'a self) -> ClaudeForwarderFuture<'a> {
        Box::pin(async move {
            self.push_call("touch-turn");
        })
    }

    fn touch_stream_activity<'a>(&'a self) -> ClaudeForwarderFuture<'a> {
        Box::pin(async move {
            self.push_call("touch-stream");
        })
    }

    fn release_terminal<'a>(&'a self) -> ClaudeForwarderFuture<'a> {
        Box::pin(async move {
            self.push_call("release-terminal");
        })
    }

    fn queue_runtime_sync(&self, reason: &'static str) {
        self.push_call(&format!("sync-queued:{reason}"));
    }
}

fn emitted_methods(events: &[AppServerEvent]) -> Vec<String> {
    events
        .iter()
        .filter_map(|event| {
            event
                .message
                .get("method")?
                .as_str()
                .map(ToString::to_string)
        })
        .collect()
}

fn call_index(calls: &[String], needle: &str) -> usize {
    calls
        .iter()
        .position(|call| call == needle)
        .unwrap_or_else(|| panic!("missing call {needle}; calls={calls:?}"))
}

fn emitted_index(calls: &[String], method: &str) -> usize {
    call_index(calls, &format!("emit:{method}"))
}

#[tokio::test]
async fn claude_forwarder_queues_turn_start_sync_after_emitting_turn_started() {
    let runtime_ops = FakeClaudeRuntimeOps::default();
    let mut state = ClaudeForwarderState::new(
        "thread-1".to_string(),
        "assistant-1".to_string(),
        "reasoning-1".to_string(),
        "turn-1".to_string(),
    );
    let mut emitted = Vec::<AppServerEvent>::new();

    let finished = handle_claude_forwarder_event(
        EngineEvent::TurnStarted {
            workspace_id: "ws-1".to_string(),
            turn_id: "turn-1".to_string(),
        },
        None,
        &mut state,
        &runtime_ops,
        &mut |event| {
            runtime_ops.push_call(
                event
                    .message
                    .get("method")
                    .and_then(|value| value.as_str())
                    .map(|method| format!("emit:{method}"))
                    .as_deref()
                    .unwrap_or("emit:unknown"),
            );
            emitted.push(event);
        },
    )
    .await;

    assert!(!finished);
    assert_eq!(emitted_methods(&emitted), vec!["turn/started"]);
    let calls = runtime_ops.calls();
    assert!(
        call_index(&calls, "touch-turn") < emitted_index(&calls, "turn/started"),
        "turn activity must be a cheap in-memory touch before emit: {calls:?}",
    );
    assert!(
        emitted_index(&calls, "turn/started") < call_index(&calls, "sync-queued:turn-start"),
        "turn-start runtime sync must be queued after emit: {calls:?}",
    );
}

#[tokio::test]
async fn claude_forwarder_emits_realtime_deltas_before_runtime_sync() {
    let runtime_ops = FakeClaudeRuntimeOps::default();
    let mut state = ClaudeForwarderState::new(
        "thread-1".to_string(),
        "assistant-1".to_string(),
        "reasoning-1".to_string(),
        "turn-1".to_string(),
    );
    state.last_runtime_sync_queued_at =
        Some(Instant::now() - Duration::from_secs(CLAUDE_RUNTIME_SYNC_HEARTBEAT_SECS + 1));
    let mut emitted = Vec::<AppServerEvent>::new();

    let finished = handle_claude_forwarder_event(
        EngineEvent::TextDelta {
            workspace_id: "ws-1".to_string(),
            text: "hello".to_string(),
        },
        None,
        &mut state,
        &runtime_ops,
        &mut |event| {
            runtime_ops.push_call(
                event
                    .message
                    .get("method")
                    .and_then(|value| value.as_str())
                    .map(|method| format!("emit:{method}"))
                    .as_deref()
                    .unwrap_or("emit:unknown"),
            );
            emitted.push(event);
        },
    )
    .await;

    assert!(!finished);
    assert_eq!(emitted_methods(&emitted), vec!["item/agentMessage/delta"]);
    let calls = runtime_ops.calls();
    assert!(
        emitted_index(&calls, "item/agentMessage/delta") < call_index(&calls, "touch-stream"),
        "text delta must be visible before stream activity touch: {calls:?}",
    );
    assert!(
        emitted_index(&calls, "item/agentMessage/delta")
            < call_index(&calls, "sync-queued:stream-heartbeat"),
        "text delta must be visible before runtime sync is queued: {calls:?}",
    );
}

#[tokio::test]
async fn claude_forwarder_attaches_redacted_stream_timing_to_realtime_delta() {
    let runtime_ops = FakeClaudeRuntimeOps::default();
    let mut state = ClaudeForwarderState::new(
        "thread-1".to_string(),
        "assistant-1".to_string(),
        "reasoning-1".to_string(),
        "turn-1".to_string(),
    );
    let mut emitted = Vec::<AppServerEvent>::new();

    handle_claude_forwarder_event(
        EngineEvent::TextDelta {
            workspace_id: "ws-1".to_string(),
            text: "hello".to_string(),
        },
        Some(&ClaudeStreamTiming {
            stdout_received_at_ms: Some(1_000),
            process_spawn_started_at_ms: Some(900),
            process_spawned_at_ms: Some(910),
            stdin_write_started_at_ms: Some(915),
            stdin_closed_at_ms: Some(930),
            turn_started_at_ms: Some(940),
            first_stdout_line_at_ms: Some(1_000),
            first_valid_stream_event_at_ms: Some(1_005),
            first_text_delta_at_ms: Some(1_010),
            session_emitted_at_ms: 1_020,
        }),
        &mut state,
        &runtime_ops,
        &mut |event| emitted.push(event),
    )
    .await;

    let timing = emitted
        .first()
        .and_then(|event| event.message.pointer("/params/dogeTiming"))
        .expect("stream timing metadata");
    assert_eq!(timing["source"], "claude-stream");
    assert_eq!(timing["stdoutReceivedAtMs"], 1_000);
    assert_eq!(timing["processSpawnStartedAtMs"], 900);
    assert_eq!(timing["processSpawnedAtMs"], 910);
    assert_eq!(timing["stdinWriteStartedAtMs"], 915);
    assert_eq!(timing["stdinClosedAtMs"], 930);
    assert_eq!(timing["turnStartedAtMs"], 940);
    assert_eq!(timing["firstStdoutLineAtMs"], 1_000);
    assert_eq!(timing["firstValidStreamEventAtMs"], 1_005);
    assert_eq!(timing["firstTextDeltaAtMs"], 1_010);
    assert_eq!(timing["sessionEmittedAtMs"], 1_020);
    assert_eq!(timing["spawnToStdinClosedMs"], 30);
    assert_eq!(timing["stdinClosedToFirstStdoutMs"], 70);
    assert_eq!(timing["firstStdoutToFirstValidEventMs"], 5);
    assert_eq!(timing["firstValidEventToFirstTextDeltaMs"], 5);
    assert_eq!(timing["stdinClosedToFirstTextDeltaMs"], 80);
    assert_eq!(timing["stdoutToSessionEmitMs"], 20);
    assert!(timing.get("text").is_none());
    assert!(timing.get("delta").is_none());
}

#[tokio::test]
async fn claude_forwarder_uses_same_low_latency_path_for_reasoning_and_tool_deltas() {
    for (event, expected_method) in [
        (
            EngineEvent::ReasoningDelta {
                workspace_id: "ws-1".to_string(),
                text: "thinking".to_string(),
            },
            "item/reasoning/textDelta",
        ),
        (
            EngineEvent::ToolOutputDelta {
                workspace_id: "ws-1".to_string(),
                tool_id: "tool-1".to_string(),
                tool_name: Some("bash".to_string()),
                delta: "out".to_string(),
            },
            "item/commandExecution/outputDelta",
        ),
    ] {
        let runtime_ops = FakeClaudeRuntimeOps::default();
        let mut state = ClaudeForwarderState::new(
            "thread-1".to_string(),
            "assistant-1".to_string(),
            "reasoning-1".to_string(),
            "turn-1".to_string(),
        );
        state.last_runtime_sync_queued_at =
            Some(Instant::now() - Duration::from_secs(CLAUDE_RUNTIME_SYNC_HEARTBEAT_SECS + 1));
        let mut emitted = Vec::<AppServerEvent>::new();

        let finished =
            handle_claude_forwarder_event(event, None, &mut state, &runtime_ops, &mut |event| {
                runtime_ops.push_call(
                    event
                        .message
                        .get("method")
                        .and_then(|value| value.as_str())
                        .map(|method| format!("emit:{method}"))
                        .as_deref()
                        .unwrap_or("emit:unknown"),
                );
                emitted.push(event);
            })
            .await;

        assert!(!finished);
        assert_eq!(emitted_methods(&emitted), vec![expected_method]);
        let calls = runtime_ops.calls();
        assert!(
            emitted_index(&calls, expected_method) < call_index(&calls, "touch-stream"),
            "{expected_method} must emit before runtime touch: {calls:?}",
        );
        assert!(
            emitted_index(&calls, expected_method)
                < call_index(&calls, "sync-queued:stream-heartbeat"),
            "{expected_method} must emit before runtime sync queue: {calls:?}",
        );
    }
}

#[tokio::test]
async fn claude_forwarder_captures_burst_gap_and_preserves_streamed_final_text() {
    let runtime_ops = FakeClaudeRuntimeOps::default();
    let mut state = ClaudeForwarderState::new(
        "thread-1".to_string(),
        "assistant-1".to_string(),
        "reasoning-1".to_string(),
        "turn-1".to_string(),
    );
    state.last_emit_at = Some(Instant::now() - Duration::from_millis(1_500));
    let mut emitted = Vec::<AppServerEvent>::new();

    handle_claude_forwarder_event(
        EngineEvent::TextDelta {
            workspace_id: "ws-1".to_string(),
            text: "streamed ".to_string(),
        },
        None,
        &mut state,
        &runtime_ops,
        &mut |event| emitted.push(event),
    )
    .await;
    handle_claude_forwarder_event(
        EngineEvent::TextDelta {
            workspace_id: "ws-1".to_string(),
            text: "answer".to_string(),
        },
        None,
        &mut state,
        &runtime_ops,
        &mut |event| emitted.push(event),
    )
    .await;
    let finished = handle_claude_forwarder_event(
        EngineEvent::TurnCompleted {
            workspace_id: "ws-1".to_string(),
            result: Some(json!({ "text": "fallback final" })),
        },
        None,
        &mut state,
        &runtime_ops,
        &mut |event| emitted.push(event),
    )
    .await;

    assert!(finished);
    assert!(state.max_forwarding_gap_ms >= 1_000);
    assert_eq!(state.delta_count, 2);
    let completed_agent = emitted
        .iter()
        .find(|event| {
            event.message.get("method").and_then(|value| value.as_str()) == Some("item/completed")
        })
        .expect("synthetic completed agent event");
    assert_eq!(
        completed_agent
            .message
            .pointer("/params/item/text")
            .and_then(|value| value.as_str()),
        Some("streamed answer")
    );
    let completed_turn = emitted
        .iter()
        .find(|event| {
            event.message.get("method").and_then(|value| value.as_str()) == Some("turn/completed")
        })
        .expect("turn completed event");
    assert_eq!(
        completed_turn
            .message
            .pointer("/params/turnId")
            .and_then(|value| value.as_str()),
        Some("turn-1")
    );
}

#[tokio::test]
async fn claude_forwarder_completed_text_carries_only_the_trailing_segment() {
    let runtime_ops = FakeClaudeRuntimeOps::default();
    let mut state = ClaudeForwarderState::new(
        "thread-1".to_string(),
        "assistant-1".to_string(),
        "reasoning-1".to_string(),
        "turn-1".to_string(),
    );
    let mut emitted = Vec::<AppServerEvent>::new();

    // 正文 → 工具 → 正文：前端在 item/started(tool) 上 incrementAgentSegment，
    // 尾段正文落到新的 assistant item。completed 只能带最后一段，否则整轮文字
    // 会被重灌进最后一段，造成前面各段内容重复。
    for event in [
        EngineEvent::TextDelta {
            workspace_id: "ws-1".to_string(),
            text: "first segment.".to_string(),
        },
        EngineEvent::ToolStarted {
            workspace_id: "ws-1".to_string(),
            tool_id: "tool-1".to_string(),
            tool_name: "bash".to_string(),
            input: None,
        },
        EngineEvent::TextDelta {
            workspace_id: "ws-1".to_string(),
            text: "second segment.".to_string(),
        },
    ] {
        handle_claude_forwarder_event(event, None, &mut state, &runtime_ops, &mut |event| {
            emitted.push(event)
        })
        .await;
    }
    let finished = handle_claude_forwarder_event(
        EngineEvent::TurnCompleted {
            workspace_id: "ws-1".to_string(),
            result: Some(json!({ "text": "fallback final" })),
        },
        None,
        &mut state,
        &runtime_ops,
        &mut |event| emitted.push(event),
    )
    .await;

    assert!(finished);
    let completed_agent = emitted
        .iter()
        .find(|event| {
            event
                .message
                .pointer("/params/item/type")
                .and_then(|value| value.as_str())
                == Some("agentMessage")
        })
        .expect("synthetic completed agent event");
    assert_eq!(
        completed_agent
            .message
            .pointer("/params/item/text")
            .and_then(|value| value.as_str()),
        Some("second segment."),
    );
}

#[tokio::test]
async fn claude_forwarder_skips_completed_text_when_turn_ends_on_a_tool() {
    let runtime_ops = FakeClaudeRuntimeOps::default();
    let mut state = ClaudeForwarderState::new(
        "thread-1".to_string(),
        "assistant-1".to_string(),
        "reasoning-1".to_string(),
        "turn-1".to_string(),
    );
    let mut emitted = Vec::<AppServerEvent>::new();

    // 回合以工具收尾：尾段无正文。不能回退到整轮 result 文本（会把整轮内容
    // 重复灌进最后一段）；前面各段的正文已由前端在分段前灌回 reducer。
    for event in [
        EngineEvent::TextDelta {
            workspace_id: "ws-1".to_string(),
            text: "only segment.".to_string(),
        },
        EngineEvent::ToolStarted {
            workspace_id: "ws-1".to_string(),
            tool_id: "tool-1".to_string(),
            tool_name: "bash".to_string(),
            input: None,
        },
    ] {
        handle_claude_forwarder_event(event, None, &mut state, &runtime_ops, &mut |event| {
            emitted.push(event)
        })
        .await;
    }
    handle_claude_forwarder_event(
        EngineEvent::TurnCompleted {
            workspace_id: "ws-1".to_string(),
            result: Some(json!({ "text": "only segment." })),
        },
        None,
        &mut state,
        &runtime_ops,
        &mut |event| emitted.push(event),
    )
    .await;

    let agent_completed_count = emitted
        .iter()
        .filter(|event| {
            event
                .message
                .pointer("/params/item/type")
                .and_then(|value| value.as_str())
                == Some("agentMessage")
        })
        .count();
    assert_eq!(
        agent_completed_count,
        0,
        "methods={:?}",
        emitted_methods(&emitted),
    );
}

#[tokio::test]
async fn claude_forwarder_falls_back_to_result_text_when_nothing_streamed() {
    let runtime_ops = FakeClaudeRuntimeOps::default();
    let mut state = ClaudeForwarderState::new(
        "thread-1".to_string(),
        "assistant-1".to_string(),
        "reasoning-1".to_string(),
        "turn-1".to_string(),
    );
    let mut emitted = Vec::<AppServerEvent>::new();

    handle_claude_forwarder_event(
        EngineEvent::ToolStarted {
            workspace_id: "ws-1".to_string(),
            tool_id: "tool-1".to_string(),
            tool_name: "bash".to_string(),
            input: None,
        },
        None,
        &mut state,
        &runtime_ops,
        &mut |event| emitted.push(event),
    )
    .await;
    handle_claude_forwarder_event(
        EngineEvent::TurnCompleted {
            workspace_id: "ws-1".to_string(),
            result: Some(json!({ "text": "fallback final" })),
        },
        None,
        &mut state,
        &runtime_ops,
        &mut |event| emitted.push(event),
    )
    .await;

    let completed_agent = emitted
        .iter()
        .find(|event| {
            event
                .message
                .pointer("/params/item/type")
                .and_then(|value| value.as_str())
                == Some("agentMessage")
        })
        .expect("fallback completed agent event");
    assert_eq!(
        completed_agent
            .message
            .pointer("/params/item/text")
            .and_then(|value| value.as_str()),
        Some("fallback final"),
    );
}

#[test]
fn extract_turn_result_text_supports_nested_payload() {
    let payload = json!({
        "result": {
            "response": {
                "content": [
                    { "text": "hello" },
                    { "text": "world" }
                ]
            }
        }
    });
    let text = extract_turn_result_text(Some(&payload));
    assert_eq!(text.as_deref(), Some("hello\nworld"));
}

#[test]
fn extract_turn_result_text_prefers_top_level_text() {
    let payload = json!({
        "text": "final answer",
        "result": { "text": "ignored" }
    });
    let text = extract_turn_result_text(Some(&payload));
    assert_eq!(text.as_deref(), Some("final answer"));
}

#[test]
fn gemini_model_guard_rejects_foreign_engine_defaults() {
    assert!(is_likely_foreign_model_for_gemini("claude-sonnet-4-6"));
    assert!(is_likely_foreign_model_for_gemini("openai/gpt-5.3-codex"));
    assert!(is_likely_foreign_model_for_gemini("gpt-5.1"));
}

#[test]
fn gemini_model_guard_allows_gemini_and_custom_aliases() {
    assert!(!is_likely_foreign_model_for_gemini("gemini-2.5-pro"));
    assert!(!is_likely_foreign_model_for_gemini(
        "[L]gemini-3-pro-preview"
    ));
    assert!(!is_likely_foreign_model_for_gemini("123"));
}

#[test]
fn gemini_routing_segments_text_and_reasoning_runs() {
    let base_item_id = "gemini-item-1";
    let mut state = GeminiRenderRoutingState::default();

    let text_1 = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Text, base_item_id);
    let text_1_cont = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Text, base_item_id);
    let reasoning_1 =
        next_gemini_routed_item_id(&mut state, GeminiRenderLane::Reasoning, base_item_id);
    let reasoning_1_cont =
        next_gemini_routed_item_id(&mut state, GeminiRenderLane::Reasoning, base_item_id);
    let text_2 = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Text, base_item_id);
    let text_2_cont = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Text, base_item_id);
    let _tool = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Tool, base_item_id);
    let reasoning_2 =
        next_gemini_routed_item_id(&mut state, GeminiRenderLane::Reasoning, base_item_id);

    assert_eq!(text_1, "gemini-item-1");
    assert_eq!(text_1_cont, "gemini-item-1");
    assert_eq!(reasoning_1, "gemini-item-1:reasoning-seg-1");
    assert_eq!(reasoning_1_cont, "gemini-item-1:reasoning-seg-1");
    assert_eq!(text_2, "gemini-item-1:text-2");
    assert_eq!(text_2_cont, "gemini-item-1:text-2");
    assert_eq!(reasoning_2, "gemini-item-1:reasoning-seg-2");
}

#[test]
fn gemini_routing_does_not_split_on_other_lane_events() {
    let base_item_id = "gemini-item-2";
    let mut state = GeminiRenderRoutingState::default();

    let text_1 = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Text, base_item_id);
    let _other = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Other, base_item_id);
    let text_1_after_other =
        next_gemini_routed_item_id(&mut state, GeminiRenderLane::Text, base_item_id);

    assert_eq!(text_1, "gemini-item-2");
    assert_eq!(text_1_after_other, "gemini-item-2");
}

#[test]
fn gemini_agent_completion_item_id_matches_streamed_text_lane_after_delta() {
    let base_item_id = "kimi-item-1";
    let mut state = GeminiRenderRoutingState::default();

    let streamed_id = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Text, base_item_id);
    state.saw_text_delta = true;
    // TurnCompleted arrives as Other lane; completion id must still equal text lane.
    let _other = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Other, base_item_id);
    let completion_id = gemini_agent_completion_item_id(&state, base_item_id);

    assert_eq!(streamed_id, "kimi-item-1");
    assert_eq!(completion_id, streamed_id);
}

#[test]
fn gemini_agent_completion_item_id_reconstructs_after_tool_clears_active_text() {
    let base_item_id = "grok-item-1";
    let mut state = GeminiRenderRoutingState::default();

    let text_1 = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Text, base_item_id);
    let _tool = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Tool, base_item_id);
    let text_2 = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Text, base_item_id);
    let _tool_again = next_gemini_routed_item_id(&mut state, GeminiRenderLane::Tool, base_item_id);
    // active_text_item_id cleared by Tool; reconstruct last text run.
    let completion_id = gemini_agent_completion_item_id(&state, base_item_id);

    assert_eq!(text_1, "grok-item-1");
    assert_eq!(text_2, "grok-item-1:text-2");
    assert_eq!(completion_id, text_2);
}

#[test]
fn opencode_model_guard_rejects_legacy_claude_ids() {
    assert!(is_likely_legacy_claude_model_id("claude-sonnet-4-6"));
    assert!(is_likely_legacy_claude_model_id("Claude-Haiku-4-5"));
}

#[test]
fn opencode_model_guard_allows_provider_scoped_models() {
    assert!(!is_likely_legacy_claude_model_id("openai/gpt-5.3-codex"));
    assert!(!is_likely_legacy_claude_model_id("google/gemini-2.5-pro"));
    assert!(!is_likely_legacy_claude_model_id("123"));
}

#[test]
fn claude_model_passthrough_accepts_custom_model_ids() {
    assert!(is_valid_claude_model_for_passthrough("GLM-5.1"));
    assert!(is_valid_claude_model_for_passthrough(
        "anthropic/claude-sonnet-4-6"
    ));
    assert!(is_valid_claude_model_for_passthrough("cxn_test.model-v1"));
    assert!(is_valid_claude_model_for_passthrough("Cxn[1m]"));
}

#[test]
fn claude_model_passthrough_rejects_invalid_ids() {
    assert!(!is_valid_claude_model_for_passthrough(""));
    assert!(!is_valid_claude_model_for_passthrough(
        "bad model with spaces"
    ));
    assert!(!is_valid_claude_model_for_passthrough("bad\nmodel"));
    assert!(!is_valid_claude_model_for_passthrough("bad\tmodel"));
    assert!(!is_valid_claude_model_for_passthrough(&"a".repeat(129)));
}

#[test]
fn parse_opencode_commands_from_help() {
    let help = r#"
Commands:
  opencode run [message..]     run opencode with a message
  opencode agent               manage agents

Options:
  -h, --help                   show help
"#;
    let commands = parse_opencode_help_commands(help);
    assert!(commands.iter().any(|entry| entry.name == "run"));
    assert!(commands.iter().any(|entry| entry.name == "agent"));
}

#[test]
fn parse_opencode_agents_from_list() {
    let output = r#"
build (primary)
reviewer
"#;
    let agents = parse_opencode_agent_list(output);
    assert!(agents
        .iter()
        .any(|entry| entry.id == "build" && entry.is_primary));
    assert!(agents
        .iter()
        .any(|entry| entry.id == "reviewer" && !entry.is_primary));
}

#[test]
fn parse_opencode_agents_ignores_json_like_noise() {
    let output = r#"
build (primary)
}
},
{
"#;
    let agents = parse_opencode_agent_list(output);
    assert_eq!(agents.len(), 1);
    assert_eq!(agents[0].id, "build");
}

#[test]
fn parse_opencode_debug_config_agents_extracts_all_agent_ids() {
    let output = r#"
{
  "agent": {
    "build": { "mode": "primary", "description": "Build things" },
    "prometheus": { "mode": "all" },
    "hephaestus": { "mode": "primary" },
    "oracle": { "mode": "subagent", "description": "Read-only consultant" }
  }
}
"#;
    let agents = parse_opencode_debug_config_agents(output);
    assert!(agents
        .iter()
        .any(|entry| entry.id == "build" && entry.is_primary));
    assert!(agents
        .iter()
        .any(|entry| entry.id == "prometheus" && !entry.is_primary));
    assert!(agents
        .iter()
        .any(|entry| entry.id == "hephaestus" && entry.is_primary));
    assert!(agents
        .iter()
        .any(|entry| entry.id == "oracle" && !entry.is_primary));
}

#[test]
fn merge_opencode_agents_adds_plugin_agents_and_preserves_primary_flags() {
    let base = vec![OpenCodeAgentEntry {
        id: "build".to_string(),
        description: None,
        is_primary: true,
    }];
    let supplemental = vec![
        OpenCodeAgentEntry {
            id: "prometheus".to_string(),
            description: Some("planner".to_string()),
            is_primary: false,
        },
        OpenCodeAgentEntry {
            id: "build".to_string(),
            description: Some("builder".to_string()),
            is_primary: false,
        },
    ];
    let merged = merge_opencode_agents(base, supplemental);
    assert!(merged.iter().any(|entry| entry.id == "prometheus"));
    assert!(merged
        .iter()
        .any(|entry| entry.id == "build" && entry.is_primary));
    let build = merged
        .iter()
        .find(|entry| entry.id == "build")
        .expect("build should exist");
    assert_eq!(build.description.as_deref(), Some("builder"));
}

#[test]
fn parse_imported_session_id_from_output() {
    let output = "Imported session: ses_12345abc\nExporting session: ses_12345abc";
    assert_eq!(
        parse_imported_session_id(output),
        Some("ses_12345abc".to_string())
    );
}

#[test]
fn parse_json_value_accepts_valid_json() {
    let parsed = parse_json_value("{\"ok\":true,\"items\":[]}");
    assert_eq!(parsed, Some(json!({ "ok": true, "items": [] })));
}

#[test]
fn parse_opencode_auth_list_providers() {
    let output = r#"
┌  Credentials ~/.local/share/opencode/auth.json
│
●  OpenAI oauth
│
●  MiniMax Coding Plan (minimaxi.com) api
│
└  2 credentials
"#;
    let providers = parse_opencode_auth_providers(output);
    assert!(providers.iter().any(|item| item == "openai"));
    assert!(providers.iter().any(|item| item == "minimax coding plan"));
}

#[test]
fn parse_opencode_mcp_servers_empty() {
    let output = r#"
┌  MCP Servers
│
▲  No MCP servers configured
│
└  Add servers with: opencode mcp add
"#;
    let servers = parse_opencode_mcp_servers(output);
    assert!(servers.is_empty());
}

#[test]
fn parse_opencode_session_list_rows() {
    let output = r#"
Session ID                      Title                                            Updated
────────────────────────────────────────────────────────────────────────────────────────
ses_3aab47663ffegTpCFd6UN8ri40  Health check 3 status review                     11:27 AM · 2/13/2026
ses_3aaf6e47cffesEP8ro2EePcJAQ  New session - 2026-02-13T02:24:24.582Z           10:24 AM · 2/13/2026
"#;
    let entries = parse_opencode_session_list(output);
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].session_id, "ses_3aab47663ffegTpCFd6UN8ri40");
    assert_eq!(entries[0].title, "Health check 3 status review");
    assert!(entries[0].updated_at.is_some());
    assert!(entries[0].directory.is_none());
}

#[test]
fn parse_opencode_session_list_json_rows() {
    let output = r#"[
  {
    "id": "ses_05b8ad9ccffeds79p735fLh45H",
    "title": "New session - 2026-07-27T16:42:48.755Z",
    "updated": 1785170596606,
    "directory": "/private/tmp",
    "projectId": "global"
  },
  {
    "id": "ses_047af0f9affeFDNwlCKWkaRVts",
    "title": "only mine",
    "updated": 1785503752964,
    "directory": "/Users/demo/Desktop/新的空文件夹",
    "projectId": "abc"
  }
]"#;
    let entries = parse_opencode_session_list(output);
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].directory.as_deref(), Some("/private/tmp"));
    assert_eq!(
        entries[1].directory.as_deref(),
        Some("/Users/demo/Desktop/新的空文件夹")
    );
}

#[test]
fn filter_opencode_sessions_drops_global_foreign_directories() {
    let workspace = std::path::Path::new("/Users/demo/Desktop/新的空文件夹");
    let entries = vec![
        OpenCodeSessionEntry {
            session_id: "ses_foreign".to_string(),
            title: "New session - 2026-07-27".to_string(),
            updated_label: String::new(),
            updated_at: Some(1),
            directory: Some("/private/tmp".to_string()),
        },
        OpenCodeSessionEntry {
            session_id: "ses_home".to_string(),
            title: "Greeting".to_string(),
            updated_label: String::new(),
            updated_at: Some(2),
            directory: Some("/Users/demo".to_string()),
        },
        OpenCodeSessionEntry {
            session_id: "ses_own".to_string(),
            title: "mine".to_string(),
            updated_label: String::new(),
            updated_at: Some(3),
            directory: Some("/Users/demo/Desktop/新的空文件夹".to_string()),
        },
        OpenCodeSessionEntry {
            session_id: "ses_nodir".to_string(),
            title: "table layout".to_string(),
            updated_label: String::new(),
            updated_at: Some(4),
            directory: None,
        },
    ];
    let filtered = filter_opencode_sessions_for_workspace(entries, workspace);
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].session_id, "ses_own");
}

#[test]
fn parse_opencode_updated_at_with_date_and_time() {
    let now = Local
        .with_ymd_and_hms(2026, 2, 15, 0, 0, 0)
        .single()
        .expect("valid now");
    let parsed =
        parse_opencode_updated_at("11:27 AM · 2/13/2026", now).expect("updated_at should parse");
    let expected = Local
        .with_ymd_and_hms(2026, 2, 13, 11, 27, 0)
        .single()
        .expect("valid expected")
        .timestamp_millis();
    assert_eq!(parsed, expected);
}

#[test]
fn normalize_provider_key_handles_hyphen_and_spaces() {
    let left = normalize_provider_key("minimax-cn-coding-plan");
    let right = normalize_provider_key("MiniMax Coding Plan");
    assert_ne!(left, right);
    assert!(provider_keys_match(
        "minimax-cn-coding-plan",
        "MiniMax Coding Plan"
    ));
}

#[test]
fn build_provider_prefill_query_uses_search_keywords() {
    assert_eq!(
        build_provider_prefill_query("minimax-cn-coding-plan"),
        Some("minimax".to_string())
    );
    assert_eq!(
        build_provider_prefill_query("z-ai"),
        Some("zhipu".to_string())
    );
    assert_eq!(
        build_provider_prefill_query("openai"),
        Some("openai".to_string())
    );
}

#[test]
fn opencode_session_candidates_include_home_and_workspace() {
    let workspace = PathBuf::from("/tmp/workspace");
    let config = EngineConfig {
        home_dir: Some("/tmp/opencode-home".to_string()),
        ..Default::default()
    };

    let candidates = opencode_session_candidate_paths(&workspace, "ses_123", Some(&config));

    assert!(candidates
        .iter()
        .any(|path| path == &PathBuf::from("/tmp/opencode-home/sessions/ses_123")));
    assert!(candidates
        .iter()
        .any(|path| path == &workspace.join(".opencode").join("sessions").join("ses_123")));
}

#[test]
fn delete_opencode_session_files_rejects_invalid_session_id() {
    let workspace = PathBuf::from("/tmp/workspace");
    let result = delete_opencode_session_files(&workspace, "../bad-id", None);
    assert!(result.is_err());
    assert!(result
        .err()
        .unwrap_or_default()
        .contains("[SESSION_NOT_FOUND]"));
}

#[test]
fn delete_opencode_session_files_removes_workspace_fallback_path() {
    let base = std::env::temp_dir().join(format!(
        "moss-x-opencode-delete-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));
    let workspace = base.join("workspace");
    let target = workspace
        .join(".opencode")
        .join("sessions")
        .join("ses_test_for_delete");
    std::fs::create_dir_all(&target).expect("should create session directory");

    let result = delete_opencode_session_files(&workspace, "ses_test_for_delete", None);
    assert!(result.is_ok());
    assert!(!target.exists());

    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn opencode_data_candidate_roots_include_xdg_data_path() {
    let workspace = PathBuf::from("/tmp/workspace");
    let config = EngineConfig {
        home_dir: Some("/tmp/opencode-home".to_string()),
        ..Default::default()
    };

    let roots = opencode_data_candidate_roots(&workspace, Some(&config));

    assert!(roots
        .iter()
        .any(|path| path == &PathBuf::from("/tmp/opencode-home")));
    assert!(roots
        .iter()
        .any(|path| path == &workspace.join(".opencode")));
}

#[test]
fn delete_opencode_session_from_datastore_removes_session_and_storage_json() {
    let base = std::env::temp_dir().join(format!(
        "moss-x-opencode-datastore-delete-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(&base).expect("should create temp base");
    let db_path = base.join("opencode.db");
    {
        let connection = Connection::open(&db_path).expect("should create sqlite database");
        connection
            .execute_batch(
                r#"
                    PRAGMA foreign_keys = ON;
                    CREATE TABLE session (
                        id TEXT PRIMARY KEY
                    );
                    INSERT INTO session (id) VALUES ('ses_test_for_datastore_delete');
                    "#,
            )
            .expect("should create session table and seed row");
    }

    let reminder_dir = base.join("storage").join("agent-usage-reminder");
    std::fs::create_dir_all(&reminder_dir).expect("should create storage subdir");
    let reminder_file = reminder_dir.join("ses_test_for_datastore_delete.json");
    std::fs::write(&reminder_file, "{}").expect("should write reminder file");

    let result = delete_opencode_session_from_datastore(&base, "ses_test_for_datastore_delete");
    assert!(result.is_ok());
    assert_eq!(result.ok(), Some(true));

    let remaining = Connection::open(&db_path)
        .expect("should reopen sqlite database")
        .query_row(
            "SELECT COUNT(*) FROM session WHERE id = ?1",
            params!["ses_test_for_datastore_delete"],
            |row| row.get::<_, i64>(0),
        )
        .expect("should count remaining rows");
    assert_eq!(remaining, 0);
    assert!(!reminder_file.exists());

    let _ = std::fs::remove_dir_all(&base);
}

#[test]
fn remote_claude_doctor_request_normalizes_explicit_bin() {
    let (method, params) = crate::codex::remote_claude_doctor_request(Some(
        "\\\\wsl$\\Ubuntu\\home\\demo\\claude".to_string(),
    ));

    assert_eq!(method, "claude_doctor");
    assert_eq!(params, json!({ "claudeBin": "/home/demo/claude" }));
}

#[test]
fn send_message_params_default_keeps_claude_thinking_enabled() {
    let params = SendMessageParams::default();

    assert!(!params.disable_thinking);
}
