//! Shared Session V2 Send 写路径集成测试（Wave 4 / Change B：tasks 3.8 + 4.4）。
//!
//! 覆盖 OpenSpec「Shared Session Send V2 / Durable Provisioning」场景：
//! - begin → commit 全链路：Tx1 turnRequested（含 TurnExecutionSnapshot）先于 runtime，
//!   Tx2 turnCommitted 落最终事实；只有已接受的 context delivery 才推进 committed cursor；
//! - duplicate settled → 第二次 commit 幂等（Duplicate，单条 turnCommitted）；
//! - 崩溃窗口故障注入：attempt 停在 creating 后再次 begin → fail closed
//!   （recovery-required + controlFact），不产生第二条 turnRequested，禁止盲目重建；
//! - 显式 rebuild：归档旧 native identity、清空 cursor、provisioning 回 prepared；
//! - 不支持的 engine → target-unavailable，零副作用。

mod common;

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::time::Duration;

use common::TempStoreDir;
use doge_lib::shared_context::{
    compile_context, prepare_delivery, CompileContextRequest, PrepareDeliveryRequest,
    RuntimeContextCapabilities,
};
use doge_lib::shared_event_log::canonical::CanonicalProviderProfileSource;
use doge_lib::shared_event_log::{
    open, BindingStateUpdate, OpenOutcome, SharedEventWriter, StoreError,
};
use doge_lib::shared_session_v2::{
    accept_turn_core, begin_turn_core, cancel_pre_dispatch_attempt_core, commit_turn_core,
    rebuild_binding_core, validate_prepare_target_core, BeginTurnStatus, CommitOutcomeInput,
    EngineType, ExecutionTargetInput,
};
use serde_json::json;

const SESSION: &str = "v2-session-a";
const V2_VICTIM_DB_ENV: &str = "MOSSX_SHARED_V2_VICTIM_DB";

fn open_writer(path: &std::path::Path) -> Result<SharedEventWriter, StoreError> {
    match open(path)? {
        OpenOutcome::Ready(writer) => Ok(writer),
        OpenOutcome::ReadOnlyRecovery { reason, .. } => Err(StoreError::Corruption {
            detail: reason.to_string(),
        }),
    }
}

fn claude_target(provider: Option<&str>) -> ExecutionTargetInput {
    ExecutionTargetInput {
        engine: EngineType::Claude,
        provider_profile_id: provider.map(str::to_string),
        model_catalog_entry_id: None,
        model: Some("claude-sonnet-4-5".to_string()),
        reasoning_effort: None,
        provider_profile_name_snapshot: provider.map(|_| "OpenRouter".to_string()),
        provider_profile_source: provider.map(|_| CanonicalProviderProfileSource::Managed),
        runtime_capability_fingerprint: Some("fp-1".to_string()),
    }
}

fn completed_outcome() -> CommitOutcomeInput {
    CommitOutcomeInput {
        status: "completed".to_string(),
        error_code: None,
        error_message: None,
        stop_reason: Some("end_turn".to_string()),
    }
}

fn provisioning_state(writer: &SharedEventWriter, binding_key: &str) -> Option<String> {
    let row = writer.binding_state(SESSION, binding_key).ok().flatten()?;
    let raw = row.provisioning_json?;
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()?
        .get("state")?
        .as_str()
        .map(str::to_string)
}

fn mark_binding_creating(writer: &SharedEventWriter, binding_key: &str) {
    let row = writer
        .binding_state(SESSION, binding_key)
        .expect("binding row")
        .expect("binding exists");
    let mut provisioning: serde_json::Value = serde_json::from_str(
        row.provisioning_json
            .as_deref()
            .expect("provisioning state"),
    )
    .expect("provisioning json");
    provisioning["state"] = json!("creating");
    provisioning["startedAt"] = json!(row.updated_at + 1);
    writer
        .upsert_binding_state(&BindingStateUpdate {
            session_id: row.session_id,
            binding_key: row.binding_key,
            engine: row.engine,
            provider_profile_id: row.provider_profile_id,
            native_session_id: row.native_session_id,
            accepted_through_sequence: row.accepted_through_sequence,
            committed_through_sequence: row.committed_through_sequence,
            provisioning_json: Some(provisioning.to_string()),
            pending_delivery_json: row.pending_delivery_json,
            availability: "provisioning".to_string(),
            updated_at: row.updated_at + 1,
        })
        .expect("mark binding creating");
}

fn fact_types(writer: &SharedEventWriter) -> Vec<String> {
    writer
        .events_for_session(SESSION)
        .expect("events")
        .iter()
        .map(|event| event.fact_type.clone())
        .collect()
}

#[test]
fn v2_provisioning_victim() {
    let Ok(db_path) = std::env::var(V2_VICTIM_DB_ENV) else {
        return;
    };
    let writer = open_writer(std::path::Path::new(&db_path)).expect("victim writer");
    begin_turn_core(
        &writer,
        SESSION,
        &claude_target(None),
        "victim".to_string(),
        None,
    )
    .expect("victim begin");
    mark_binding_creating(&writer, "claude:default");
    println!("ready:creating");
    std::io::stdout().flush().expect("flush victim signal");
    loop {
        std::thread::sleep(Duration::from_secs(3600));
    }
}

fn accept(
    writer: &SharedEventWriter,
    target: &ExecutionTargetInput,
    attempt_id: &str,
    logical_turn_id: &str,
    native_session_id: &str,
) {
    accept_turn_core(
        writer,
        SESSION,
        attempt_id,
        logical_turn_id,
        target,
        native_session_id,
    )
    .expect("accept");
}

/// 3.8(a)：begin → commit 全链路，Tx1/Tx2 fact 顺序与 cursor 推进正确。
#[test]
fn begin_then_commit_writes_requested_and_committed_and_advances_cursor() {
    let store = TempStoreDir::new("v2-happy");
    let writer = open_writer(&store.db_path).expect("open writer");
    let target = claude_target(Some("openrouter"));

    let begin =
        begin_turn_core(&writer, SESSION, &target, "hello".to_string(), None).expect("begin");
    assert_eq!(begin.status, BeginTurnStatus::Creating);
    assert_eq!(begin.binding_key, "claude:openrouter");
    let attempt_id = begin.attempt_id.clone().expect("attempt id");
    let logical_turn_id = begin.logical_turn_id.clone().expect("logical turn id");

    // Tx1：turnRequested 先于任何 runtime side effect，携带完整 snapshot。
    let events = writer.events_for_session(SESSION).expect("events");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].fact_type, "conversation.turnRequested");
    let payload: serde_json::Value =
        serde_json::from_str(&events[0].payload_json).expect("payload json");
    assert_eq!(payload["target"]["engine"], "claude");
    assert_eq!(payload["target"]["providerProfileId"], "openrouter");
    assert_eq!(payload["target"]["model"], "claude-sonnet-4-5");
    assert_eq!(payload["input"]["text"], "hello");
    assert_eq!(
        provisioning_state(&writer, &begin.binding_key).as_deref(),
        Some("prepared")
    );

    accept(
        &writer,
        &target,
        &attempt_id,
        &logical_turn_id,
        "native-thread-1",
    );
    // Tx2：settled 后 commit，provisioning → ready。该测试未准备 context delivery，
    // 因此不得把 terminal event sequence 冒充 context committed cursor。
    let commit = commit_turn_core(
        &writer,
        SESSION,
        &attempt_id,
        &logical_turn_id,
        &target,
        Some("hi there".to_string()),
        &completed_outcome(),
        Some("native-thread-1".to_string()),
    )
    .expect("commit");
    assert!(!commit.duplicate);
    assert_eq!(commit.binding_key, "claude:openrouter");

    assert_eq!(
        fact_types(&writer),
        vec![
            "conversation.turnRequested".to_string(),
            "conversation.turnAccepted".to_string(),
            "conversation.turnCommitted".to_string(),
        ]
    );
    let row = writer
        .binding_state(SESSION, &commit.binding_key)
        .expect("binding row")
        .expect("binding row exists");
    assert_eq!(row.committed_through_sequence, None);
    assert_eq!(row.native_session_id.as_deref(), Some("native-thread-1"));
    assert_eq!(
        provisioning_state(&writer, &commit.binding_key).as_deref(),
        Some("ready")
    );

    let committed_payload: serde_json::Value =
        serde_json::from_str(&writer.events_for_session(SESSION).expect("events")[2].payload_json)
            .expect("committed payload");
    assert_eq!(committed_payload["outcome"]["status"], "completed");
    assert_eq!(
        committed_payload["target"]["providerProfileId"],
        "openrouter"
    );
}

/// 3.8(b)：duplicate settled → 幂等，不产生第二条 turnCommitted。
#[test]
fn duplicate_commit_is_idempotent() {
    let store = TempStoreDir::new("v2-dup");
    let writer = open_writer(&store.db_path).expect("open writer");
    let target = claude_target(None);

    let begin =
        begin_turn_core(&writer, SESSION, &target, "hello".to_string(), None).expect("begin");
    assert_eq!(begin.binding_key, "claude:default");
    let attempt_id = begin.attempt_id.clone().expect("attempt id");
    let logical_turn_id = begin.logical_turn_id.clone().expect("logical turn id");
    accept(&writer, &target, &attempt_id, &logical_turn_id, "native-1");

    let first = commit_turn_core(
        &writer,
        SESSION,
        &attempt_id,
        &logical_turn_id,
        &target,
        Some("answer".to_string()),
        &completed_outcome(),
        Some("native-1".to_string()),
    )
    .expect("first commit");
    let second = commit_turn_core(
        &writer,
        SESSION,
        &attempt_id,
        &logical_turn_id,
        &target,
        Some("answer".to_string()),
        &completed_outcome(),
        Some("native-1".to_string()),
    )
    .expect("second commit");

    assert!(!first.duplicate);
    assert!(second.duplicate);
    assert_eq!(first.sequence, second.sequence);
    let types = fact_types(&writer);
    assert_eq!(
        types
            .iter()
            .filter(|fact_type| fact_type.as_str() == "conversation.turnCommitted")
            .count(),
        1
    );
    assert_eq!(
        types
            .iter()
            .filter(|fact_type| fact_type.as_str() == "conversation.turnAccepted")
            .count(),
        1
    );
}

#[test]
fn settled_before_typed_acceptance_is_rejected() {
    let store = TempStoreDir::new("v2-settled-before-accept");
    let writer = open_writer(&store.db_path).expect("open writer");
    let target = claude_target(None);
    let begin =
        begin_turn_core(&writer, SESSION, &target, "hello".to_string(), None).expect("begin");
    let result = commit_turn_core(
        &writer,
        SESSION,
        begin.attempt_id.as_deref().expect("attempt"),
        begin.logical_turn_id.as_deref().expect("turn"),
        &target,
        Some("answer".to_string()),
        &completed_outcome(),
        Some("native-1".to_string()),
    );

    assert!(result
        .expect_err("settled without ACK must fail")
        .contains("before typed prompt ACK"));
    assert!(!fact_types(&writer)
        .iter()
        .any(|fact_type| fact_type == "conversation.turnCommitted"));
}

/// Provider 的确定性拒绝可落 failed terminal，但没有已接受的 context delivery，
/// 因此绝不能推进 committed cursor；否则下一轮会跳过尚未交付的历史。
#[test]
fn known_rejection_does_not_advance_context_committed_cursor() {
    let store = TempStoreDir::new("v2-known-rejection-cursor");
    let writer = open_writer(&store.db_path).expect("open writer");
    let target = claude_target(None);
    let begin =
        begin_turn_core(&writer, SESSION, &target, "hello".to_string(), None).expect("begin");
    let failed = CommitOutcomeInput {
        status: "failed".to_string(),
        error_code: Some("target-provider-rejected".to_string()),
        error_message: Some("provider rejected requested model".to_string()),
        stop_reason: None,
    };

    let committed = commit_turn_core(
        &writer,
        SESSION,
        begin.attempt_id.as_deref().expect("attempt"),
        begin.logical_turn_id.as_deref().expect("turn"),
        &target,
        None,
        &failed,
        None,
    )
    .expect("known rejection must persist a failed terminal");

    assert!(!committed.duplicate);
    let row = writer
        .binding_state(SESSION, &begin.binding_key)
        .expect("binding")
        .expect("binding exists");
    assert_eq!(row.committed_through_sequence, None);

    let events = writer.events_for_session(SESSION).expect("events");
    let committed_payload: serde_json::Value = serde_json::from_str(
        &events
            .iter()
            .find(|event| event.fact_type == "conversation.turnCommitted")
            .expect("failed terminal")
            .payload_json,
    )
    .expect("committed payload");
    assert_eq!(committed_payload["outcome"]["status"], "failed");
    assert_eq!(
        committed_payload["outcome"]["errorCode"],
        "target-provider-rejected"
    );
}

#[test]
fn invalid_target_after_begin_commits_context_prepare_failure() {
    let store = TempStoreDir::new("v2-invalid-prepare-target");
    let writer = open_writer(&store.db_path).expect("open writer");
    let mut removed_target = claude_target(None);
    removed_target.model = Some("removed-after-begin".to_string());
    let begin = begin_turn_core(&writer, SESSION, &removed_target, "hello".to_string(), None)
        .expect("begin");

    let error = validate_prepare_target_core(
        &writer,
        SESSION,
        begin.attempt_id.as_deref().expect("attempt"),
    )
    .expect_err("prepare-time target validation must fail");
    assert!(error.starts_with("context-prepare-failed:"));
    assert!(!error.contains("canonical-failure-persistence:"));

    let events = writer.events_for_session(SESSION).expect("events");
    assert_eq!(
        events
            .iter()
            .filter(|event| event.fact_type == "conversation.turnCommitted")
            .count(),
        1
    );
    let payload: serde_json::Value = serde_json::from_str(
        &events
            .iter()
            .find(|event| event.fact_type == "conversation.turnCommitted")
            .expect("failed terminal")
            .payload_json,
    )
    .expect("terminal payload");
    assert_eq!(payload["outcome"]["status"], "failed");
    assert_eq!(payload["outcome"]["errorCode"], "context-prepare-failed");

    let binding = writer
        .binding_state(SESSION, &begin.binding_key)
        .expect("binding")
        .expect("binding exists");
    assert_eq!(binding.committed_through_sequence, None);
    assert_eq!(binding.pending_delivery_json, None);
}

#[test]
fn cancelling_pre_dispatch_confirmation_terminalizes_exact_prepared_attempt() {
    let store = TempStoreDir::new("v2-cancel-before-dispatch");
    let writer = open_writer(&store.db_path).expect("open writer");
    let target = claude_target(None);
    let begin =
        begin_turn_core(&writer, SESSION, &target, "hello".to_string(), None).expect("begin");
    let attempt_id = begin.attempt_id.expect("attempt");
    let logical_turn_id = begin.logical_turn_id.expect("turn");
    let package = compile_context(
        &writer.events_for_session(SESSION).expect("events"),
        &CompileContextRequest {
            session_id: SESSION.to_string(),
            binding_key: begin.binding_key.clone(),
            destination: json!({ "engine": "claude" }),
            destination_native_session_id: None,
            from_sequence_exclusive: None,
            through_sequence_inclusive: Some(0),
            exclude_attempt_id: Some(attempt_id.clone()),
            capabilities: RuntimeContextCapabilities {
                native_delta: false,
                structured_history_import: false,
                native_clone: false,
                user_channel_transcript: true,
                tool_history: false,
                image_history: false,
                strong_context_ack: true,
            },
            budget_estimated_tokens: None,
        },
    )
    .expect("compile empty history");
    prepare_delivery(
        &writer,
        &PrepareDeliveryRequest {
            session_id: SESSION.to_string(),
            binding_key: begin.binding_key.clone(),
            engine: "claude".to_string(),
            provider_profile_id: None,
            logical_turn_id,
            attempt_id: attempt_id.clone(),
            binding_operation_id: "test-operation".to_string(),
            package,
            prepared_at: 2,
        },
    )
    .expect("prepare delivery");

    cancel_pre_dispatch_attempt_core(
        &writer,
        SESSION,
        &attempt_id,
        "user-cancelled-degraded-context",
    )
    .expect("cancel prepared attempt");

    let binding = writer
        .binding_state(SESSION, &begin.binding_key)
        .expect("binding")
        .expect("binding exists");
    assert!(binding.pending_delivery_json.is_none());
    let committed = writer
        .events_for_session(SESSION)
        .expect("events")
        .into_iter()
        .find(|event| {
            event.fact_type == "conversation.turnCommitted"
                && event.attempt_id.as_deref() == Some(attempt_id.as_str())
        })
        .expect("cancelled terminal");
    let payload: serde_json::Value =
        serde_json::from_str(&committed.payload_json).expect("terminal payload");
    assert_eq!(payload["outcome"]["status"], "cancelled");
    assert_eq!(
        payload["outcome"]["stopReason"],
        "user-cancelled-degraded-context"
    );

    let next =
        begin_turn_core(&writer, SESSION, &target, "retry".to_string(), None).expect("retry");
    assert_eq!(next.status, BeginTurnStatus::Creating);
}

/// 3.8(b')：同一 attempt 但语义不同的 retry 是真冲突，必须 fail loud（禁止伪装成重放）。
#[test]
fn conflicting_retry_for_same_attempt_fails_loud() {
    let store = TempStoreDir::new("v2-conflict");
    let writer = open_writer(&store.db_path).expect("open writer");
    let target = claude_target(None);

    let begin =
        begin_turn_core(&writer, SESSION, &target, "hello".to_string(), None).expect("begin");
    let attempt_id = begin.attempt_id.clone().expect("attempt id");
    let logical_turn_id = begin.logical_turn_id.clone().expect("logical turn id");
    accept(&writer, &target, &attempt_id, &logical_turn_id, "native-1");

    commit_turn_core(
        &writer,
        SESSION,
        &attempt_id,
        &logical_turn_id,
        &target,
        Some("answer-a".to_string()),
        &completed_outcome(),
        Some("native-1".to_string()),
    )
    .expect("first commit");

    let conflict = commit_turn_core(
        &writer,
        SESSION,
        &attempt_id,
        &logical_turn_id,
        &target,
        Some("answer-b".to_string()),
        &completed_outcome(),
        Some("native-1".to_string()),
    );
    assert!(conflict.is_err());
    assert!(conflict
        .expect_err("conflict error")
        .contains("semantic conflict"));
}

#[test]
fn acceptance_rejects_a_target_different_from_requested_snapshot() {
    let store = TempStoreDir::new("v2-accept-owner-mismatch");
    let writer = open_writer(&store.db_path).expect("open writer");
    let requested_target = claude_target(None);
    let begin = begin_turn_core(
        &writer,
        SESSION,
        &requested_target,
        "hello".to_string(),
        None,
    )
    .expect("begin");

    let error = accept_turn_core(
        &writer,
        SESSION,
        begin.attempt_id.as_deref().expect("attempt id"),
        begin.logical_turn_id.as_deref().expect("logical turn id"),
        &claude_target(Some("openrouter")),
        "native-wrong-owner",
    )
    .expect_err("owner mismatch must fail");

    assert!(error.contains("owner mismatch"));
    assert_eq!(
        fact_types(&writer)
            .iter()
            .filter(|fact_type| fact_type.as_str() == "conversation.turnAccepted")
            .count(),
        0
    );
}

/// 4.4 故障注入：attempt 停在 creating 窗口（模拟崩溃），再次 begin 必须 fail closed。
#[test]
fn begin_on_creating_window_fails_closed_without_blind_rebuild() {
    let store = TempStoreDir::new("v2-crash");
    let writer = open_writer(&store.db_path).expect("open writer");
    let target = claude_target(None);

    let first =
        begin_turn_core(&writer, SESSION, &target, "hello".to_string(), None).expect("begin");
    assert_eq!(first.status, BeginTurnStatus::Creating);

    // 模拟 Runtime materialization 已开始、尚未写回 Native identity 时进程崩溃。
    mark_binding_creating(&writer, "claude:default");
    let second = begin_turn_core(&writer, SESSION, &target, "hello again".to_string(), None)
        .expect("second begin");
    assert_eq!(second.status, BeginTurnStatus::RecoveryRequired);
    assert_eq!(second.reason.as_deref(), Some("provisioning-crash-window"));

    // 无第二条 turnRequested；有 recovery controlFact；provisioning 落为 recovery-required。
    let types = fact_types(&writer);
    assert_eq!(
        types
            .iter()
            .filter(|t| t.as_str() == "conversation.turnRequested")
            .count(),
        1
    );
    assert_eq!(
        types
            .iter()
            .filter(|t| t.as_str() == "conversation.controlFact")
            .count(),
        1
    );
    assert_eq!(
        provisioning_state(&writer, "claude:default").as_deref(),
        Some("recovery-required")
    );

    // recovery-required 状态下继续 begin 仍然拒绝（禁止盲目重建）。
    let third = begin_turn_core(&writer, SESSION, &target, "hello third".to_string(), None)
        .expect("third begin");
    assert_eq!(third.status, BeginTurnStatus::RecoveryRequired);
    assert_eq!(
        fact_types(&writer)
            .iter()
            .filter(|t| t.as_str() == "conversation.turnRequested")
            .count(),
        1
    );
}

#[test]
fn process_kill_in_creating_window_never_creates_a_second_binding() {
    let store = TempStoreDir::new("v2-process-kill");
    let mut child = Command::new(std::env::current_exe().expect("test binary"))
        .args([
            "v2_provisioning_victim",
            "--exact",
            "--nocapture",
            "--test-threads=1",
        ])
        .env(V2_VICTIM_DB_ENV, &store.db_path)
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn victim");
    let stdout = child.stdout.take().expect("victim stdout");
    let ready = BufReader::new(stdout)
        .lines()
        .map_while(Result::ok)
        .find(|line| line.contains("ready:creating"))
        .expect("victim creating signal");
    assert!(ready.contains("ready:creating"));
    child.kill().expect("kill victim");
    child.wait().expect("reap victim");

    let writer = open_writer(&store.db_path).expect("reopen after kill");
    let result = begin_turn_core(
        &writer,
        SESSION,
        &claude_target(None),
        "must-not-redeliver".to_string(),
        None,
    )
    .expect("probe begin");
    assert_eq!(result.status, BeginTurnStatus::RecoveryRequired);
    assert_eq!(
        fact_types(&writer)
            .iter()
            .filter(|fact_type| fact_type.as_str() == "conversation.turnRequested")
            .count(),
        1
    );
    assert_eq!(
        writer
            .binding_state(SESSION, "claude:default")
            .expect("binding")
            .expect("binding exists")
            .provider_profile_id,
        None
    );
}

/// 4.4(b)：显式 rebuild 归档旧 native identity、清空 cursor、回到 prepared，随后可重新 begin。
#[test]
fn explicit_rebuild_archives_native_identity_and_allows_new_begin() {
    let store = TempStoreDir::new("v2-rebuild");
    let writer = open_writer(&store.db_path).expect("open writer");
    let target = claude_target(Some("openrouter"));

    let begin =
        begin_turn_core(&writer, SESSION, &target, "hello".to_string(), None).expect("begin");
    let attempt_id = begin.attempt_id.clone().expect("attempt id");
    let logical_turn_id = begin.logical_turn_id.clone().expect("logical turn id");
    accept(
        &writer,
        &target,
        &attempt_id,
        &logical_turn_id,
        "native-old",
    );
    commit_turn_core(
        &writer,
        SESSION,
        &attempt_id,
        &logical_turn_id,
        &target,
        Some("answer".to_string()),
        &completed_outcome(),
        Some("native-old".to_string()),
    )
    .expect("commit");

    let archived = rebuild_binding_core(&writer, SESSION, "claude:openrouter").expect("rebuild");
    assert_eq!(
        archived.archived_native_session_id.as_deref(),
        Some("native-old")
    );
    assert!(archived.replaced_attempt_ids.is_empty());
    assert!(!archived.binding_operation_id.is_empty());

    let row = writer
        .binding_state(SESSION, "claude:openrouter")
        .expect("binding row")
        .expect("binding row exists");
    assert_eq!(row.native_session_id, None);
    assert_eq!(row.committed_through_sequence, None);
    assert_eq!(
        provisioning_state(&writer, "claude:openrouter").as_deref(),
        Some("prepared")
    );
    let provisioning: serde_json::Value =
        serde_json::from_str(&row.provisioning_json.expect("provisioning json"))
            .expect("provisioning parse");
    assert_eq!(provisioning["archivedNativeSessionId"], "native-old");

    // 归档留痕 controlFact。
    let types = fact_types(&writer);
    assert!(types.contains(&"conversation.controlFact".to_string()));

    // 新 binding 未消费任何历史：可以重新 begin 走完整 provisioning。
    let restarted =
        begin_turn_core(&writer, SESSION, &target, "fresh".to_string(), None).expect("begin again");
    assert_eq!(restarted.status, BeginTurnStatus::Creating);
}

/// 3.8(c)：不支持的 engine → target-unavailable，零副作用。
#[test]
fn unsupported_engine_returns_target_unavailable_without_side_effects() {
    let store = TempStoreDir::new("v2-unsupported");
    let writer = open_writer(&store.db_path).expect("open writer");
    let target = ExecutionTargetInput {
        engine: EngineType::Gemini,
        provider_profile_id: None,
        model_catalog_entry_id: None,
        model: None,
        reasoning_effort: None,
        provider_profile_name_snapshot: None,
        provider_profile_source: None,
        runtime_capability_fingerprint: None,
    };

    let begin =
        begin_turn_core(&writer, SESSION, &target, "hello".to_string(), None).expect("begin");
    assert_eq!(begin.status, BeginTurnStatus::TargetUnavailable);
    assert!(begin.reason.is_some());
    assert!(writer
        .events_for_session(SESSION)
        .expect("events")
        .is_empty());
}

/// 3.7：V0 快照路径并行保留——默认 provider binding key 与 V0 `engine` 键一致（`claude:default`），
/// 同一 session 下 default 与 managed-provider 绑定互不串线。
#[test]
fn default_and_managed_provider_bindings_do_not_cross_wire() {
    let store = TempStoreDir::new("v2-parallel");
    let writer = open_writer(&store.db_path).expect("open writer");

    let default_target = claude_target(None);
    let managed_target = claude_target(Some("openrouter"));

    let begin_default = begin_turn_core(&writer, SESSION, &default_target, "a".to_string(), None)
        .expect("begin default");
    let default_attempt_id = begin_default
        .attempt_id
        .clone()
        .expect("default attempt id");
    let default_logical_turn_id = begin_default
        .logical_turn_id
        .clone()
        .expect("default logical turn id");
    accept(
        &writer,
        &default_target,
        &default_attempt_id,
        &default_logical_turn_id,
        "native-default",
    );
    commit_turn_core(
        &writer,
        SESSION,
        &default_attempt_id,
        &default_logical_turn_id,
        &default_target,
        Some("default answer".to_string()),
        &completed_outcome(),
        Some("native-default".to_string()),
    )
    .expect("commit default");

    let begin_managed = begin_turn_core(&writer, SESSION, &managed_target, "b".to_string(), None)
        .expect("begin managed");

    assert_eq!(begin_default.binding_key, "claude:default");
    assert_eq!(begin_managed.binding_key, "claude:openrouter");

    let default_row = writer
        .binding_state(SESSION, "claude:default")
        .expect("default row")
        .expect("default row exists");
    let managed_row = writer
        .binding_state(SESSION, "claude:openrouter")
        .expect("managed row")
        .expect("managed row exists");
    assert_eq!(default_row.provider_profile_id, None);
    assert_eq!(
        managed_row.provider_profile_id.as_deref(),
        Some("openrouter")
    );

    // 两条 binding 各有独立 provisioning 状态。
    assert_eq!(
        provisioning_state(&writer, "claude:default").as_deref(),
        Some("ready")
    );
    assert_eq!(
        provisioning_state(&writer, "claude:openrouter").as_deref(),
        Some("prepared")
    );
}
