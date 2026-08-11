//! Change C 增量集成测试：deterministic package、artifact ownership、two-phase cursor。

mod common;

use common::TempStoreDir;
use doge_lib::shared_context::{
    accept_delivery, compile_context, mark_delivery_sent, read_artifact, write_artifact,
    AcceptDeliveryRequest, ArtifactReadRequest, CompileContextRequest, MarkDeliverySentRequest,
    PrepareDeliveryRequest, RuntimeContextCapabilities,
};
use doge_lib::shared_event_log::canonical::shadow_v0::{
    map_v0_turn_to_presentation_only_facts, v0_evidence,
};
use doge_lib::shared_event_log::{open, OpenOutcome, SharedEventWriter};
use doge_lib::shared_session_v2::{
    accept_turn_core, begin_turn_core, commit_turn_core, CommitOutcomeInput, EngineType,
    ExecutionTargetInput,
};
use serde_json::json;

const SESSION: &str = "context-session";

fn writer(store: &TempStoreDir) -> SharedEventWriter {
    match open(&store.db_path).expect("open store") {
        OpenOutcome::Ready(writer) => writer,
        OpenOutcome::ReadOnlyRecovery { reason, .. } => panic!("unexpected recovery: {reason}"),
    }
}

fn target(provider: Option<&str>) -> ExecutionTargetInput {
    ExecutionTargetInput {
        engine: EngineType::Claude,
        provider_profile_id: provider.map(str::to_string),
        model_catalog_entry_id: None,
        model: Some("claude-sonnet-4-5".to_string()),
        reasoning_effort: None,
        provider_profile_name_snapshot: None,
        provider_profile_source: None,
        runtime_capability_fingerprint: Some("test".to_string()),
    }
}

fn completed() -> CommitOutcomeInput {
    CommitOutcomeInput {
        status: "completed".to_string(),
        error_code: None,
        error_message: None,
        stop_reason: Some("end_turn".to_string()),
    }
}

fn seed_history(writer: &SharedEventWriter) {
    let source = target(None);
    let begin =
        begin_turn_core(writer, SESSION, &source, "历史问题".to_string(), None).expect("begin");
    let attempt = begin.attempt_id.expect("attempt");
    let turn = begin.logical_turn_id.expect("turn");
    accept_turn_core(writer, SESSION, &attempt, &turn, &source, "claude:source").expect("accept");
    commit_turn_core(
        writer,
        SESSION,
        &attempt,
        &turn,
        &source,
        Some("历史答案".to_string()),
        &completed(),
        Some("claude:source".to_string()),
    )
    .expect("commit");
}

fn capabilities() -> RuntimeContextCapabilities {
    RuntimeContextCapabilities {
        native_delta: false,
        structured_history_import: false,
        native_clone: false,
        user_channel_transcript: true,
        tool_history: false,
        image_history: false,
        strong_context_ack: false,
    }
}

#[test]
fn package_artifact_and_two_phase_cursor_close_without_replay_gap() {
    let store = TempStoreDir::new("context-delivery");
    let writer = writer(&store);
    seed_history(&writer);

    let destination = target(Some("provider-b"));
    let begin = begin_turn_core(&writer, SESSION, &destination, "新问题".to_string(), None)
        .expect("begin B");
    let attempt_id = begin.attempt_id.expect("attempt B");
    let logical_turn_id = begin.logical_turn_id.expect("turn B");
    let requested_sequence = writer
        .events_for_session(SESSION)
        .expect("events")
        .into_iter()
        .find(|event| event.attempt_id.as_deref() == Some(&attempt_id))
        .expect("requested")
        .sequence;
    let compile_request = CompileContextRequest {
        session_id: SESSION.to_string(),
        binding_key: "claude:provider-b".to_string(),
        destination: json!({ "engine": "claude", "providerProfileId": "provider-b" }),
        destination_native_session_id: None,
        from_sequence_exclusive: None,
        through_sequence_inclusive: Some(requested_sequence - 1),
        exclude_attempt_id: Some(attempt_id.clone()),
        capabilities: capabilities(),
        budget_estimated_tokens: None,
    };
    let events = writer.events_for_session(SESSION).expect("events");
    let first = compile_context(&events, &compile_request).expect("compile");
    let second = compile_context(&events, &compile_request).expect("recompile");
    let mut changed_destination = compile_request.clone();
    changed_destination.destination =
        json!({ "engine": "claude", "providerProfileId": "provider-c" });
    let destination_package =
        compile_context(&events, &changed_destination).expect("destination compile");
    let mut changed_budget = compile_request.clone();
    changed_budget.budget_estimated_tokens = Some(1);
    let budget_package = compile_context(&events, &changed_budget).expect("budget compile");
    assert_eq!(first.package_id, second.package_id);
    assert_ne!(first.package_id, destination_package.package_id);
    assert_ne!(first.package_id, budget_package.package_id);
    assert_eq!(
        first.manifest.source_checksum,
        second.manifest.source_checksum
    );
    assert_eq!(
        first.stable_prefix.as_bytes(),
        second.stable_prefix.as_bytes()
    );
    assert!(first.prompt_prefix.contains("历史问题"));
    assert!(first.prompt_prefix.contains("历史答案"));
    assert!(!first.prompt_prefix.contains("新问题"));

    let artifact =
        write_artifact(&store.dir, "workspace-a", SESSION, &first, 100).expect("write artifact");
    let retrieved = read_artifact(
        &store.dir,
        &ArtifactReadRequest {
            workspace_id: "workspace-a".to_string(),
            session_id: SESSION.to_string(),
            artifact_id: artifact.artifact_id.clone(),
            checksum: artifact.checksum.clone(),
        },
    )
    .expect("read artifact");
    assert!(retrieved.reference_only);
    let cross_workspace = read_artifact(
        &store.dir,
        &ArtifactReadRequest {
            workspace_id: "workspace-b".to_string(),
            session_id: SESSION.to_string(),
            artifact_id: artifact.artifact_id,
            checksum: artifact.checksum,
        },
    );
    assert!(cross_workspace.is_err());

    doge_lib::shared_context::prepare_delivery(
        &writer,
        &PrepareDeliveryRequest {
            session_id: SESSION.to_string(),
            binding_key: "claude:provider-b".to_string(),
            engine: "claude".to_string(),
            provider_profile_id: Some("provider-b".to_string()),
            logical_turn_id: logical_turn_id.clone(),
            attempt_id: attempt_id.clone(),
            binding_operation_id: "operation-b".to_string(),
            package: first.clone(),
            prepared_at: 101,
        },
    )
    .expect("prepare delivery");
    let prepared = writer
        .binding_state(SESSION, "claude:provider-b")
        .expect("binding")
        .expect("binding exists");
    assert_eq!(prepared.accepted_through_sequence, None);
    assert_eq!(prepared.committed_through_sequence, None);
    assert!(prepared.pending_delivery_json.is_some());
    let prepared_event = writer
        .events_for_session(SESSION)
        .expect("prepared events")
        .into_iter()
        .find(|event| {
            event.attempt_id.as_deref() == Some(attempt_id.as_str())
                && event.fact_type == "context.deliveryPrepared"
        })
        .expect("delivery prepared fact");
    let prepared_payload: serde_json::Value =
        serde_json::from_str(&prepared_event.payload_json).expect("prepared payload");
    assert_eq!(prepared_payload["type"], prepared_event.fact_type);
    let duplicate_prepare = doge_lib::shared_context::prepare_delivery(
        &writer,
        &PrepareDeliveryRequest {
            session_id: SESSION.to_string(),
            binding_key: "claude:provider-b".to_string(),
            engine: "claude".to_string(),
            provider_profile_id: Some("provider-b".to_string()),
            logical_turn_id: logical_turn_id.clone(),
            attempt_id: attempt_id.clone(),
            binding_operation_id: "operation-b".to_string(),
            package: first.clone(),
            prepared_at: 101,
        },
    );
    assert!(duplicate_prepare.is_err());
    assert_eq!(
        writer
            .events_for_session(SESSION)
            .expect("events after duplicate prepare")
            .iter()
            .filter(|event| event.fact_type == "context.deliveryPrepared")
            .count(),
        1
    );
    let blocked_other_target = begin_turn_core(
        &writer,
        SESSION,
        &target(Some("provider-c")),
        "绕过".to_string(),
        None,
    )
    .expect("cross-target begin result");
    assert_eq!(
        blocked_other_target.status,
        doge_lib::shared_session_v2::BeginTurnStatus::RecoveryRequired
    );

    mark_delivery_sent(
        &writer,
        &MarkDeliverySentRequest {
            session_id: SESSION.to_string(),
            binding_key: "claude:provider-b".to_string(),
            attempt_id: attempt_id.clone(),
            binding_operation_id: "operation-b".to_string(),
            native_session_id: "claude:destination".to_string(),
            native_request_id: "request-1".to_string(),
            sent_at: 102,
        },
    )
    .expect("mark delivery sent");

    accept_delivery(
        &writer,
        &AcceptDeliveryRequest {
            session_id: SESSION.to_string(),
            binding_key: "claude:provider-b".to_string(),
            logical_turn_id: logical_turn_id.clone(),
            attempt_id: attempt_id.clone(),
            binding_operation_id: "operation-b".to_string(),
            package_id: first.package_id.clone(),
            native_session_id: Some("claude:destination".to_string()),
            native_request_id: Some("request-1".to_string()),
            accepted_at: 103,
        },
    )
    .expect("accept delivery");
    let accepted = writer
        .binding_state(SESSION, "claude:provider-b")
        .expect("binding")
        .expect("binding exists");
    assert_eq!(
        accepted.accepted_through_sequence,
        Some(requested_sequence - 1)
    );
    assert_eq!(accepted.committed_through_sequence, None);
    let accepted_event = writer
        .events_for_session(SESSION)
        .expect("accepted events")
        .into_iter()
        .find(|event| {
            event.attempt_id.as_deref() == Some(attempt_id.as_str())
                && event.fact_type == "context.deliveryAccepted"
        })
        .expect("delivery accepted fact");
    let accepted_payload: serde_json::Value =
        serde_json::from_str(&accepted_event.payload_json).expect("accepted payload");
    assert_eq!(accepted_payload["type"], accepted_event.fact_type);
    let duplicate_accept = accept_delivery(
        &writer,
        &AcceptDeliveryRequest {
            session_id: SESSION.to_string(),
            binding_key: "claude:provider-b".to_string(),
            logical_turn_id: logical_turn_id.clone(),
            attempt_id: attempt_id.clone(),
            binding_operation_id: "operation-b".to_string(),
            package_id: first.package_id.clone(),
            native_session_id: Some("claude:destination".to_string()),
            native_request_id: Some("request-1".to_string()),
            accepted_at: 103,
        },
    );
    assert!(duplicate_accept.is_err());
    assert_eq!(
        writer
            .events_for_session(SESSION)
            .expect("events after duplicate accept")
            .iter()
            .filter(|event| event.fact_type == "context.deliveryAccepted")
            .count(),
        1
    );

    accept_turn_core(
        &writer,
        SESSION,
        &attempt_id,
        &logical_turn_id,
        &destination,
        "claude:destination",
    )
    .expect("accept turn");
    commit_turn_core(
        &writer,
        SESSION,
        &attempt_id,
        &logical_turn_id,
        &destination,
        Some("新答案".to_string()),
        &completed(),
        Some("claude:destination".to_string()),
    )
    .expect("atomic terminal and delivery commit");
    let committed = writer
        .binding_state(SESSION, "claude:provider-b")
        .expect("binding")
        .expect("binding exists");
    assert_eq!(
        committed.committed_through_sequence,
        Some(requested_sequence - 1)
    );
    assert!(committed.pending_delivery_json.is_none());
}

#[test]
fn portable_context_excludes_destination_owned_history_on_a_b_a_reuse() {
    const SESSION_ABA: &str = "context-session-a-b-a";
    let store = TempStoreDir::new("context-a-b-a");
    let writer = writer(&store);
    let target_a = target(Some("provider-a"));
    let target_b = target(Some("provider-b"));

    let begin_a = begin_turn_core(&writer, SESSION_ABA, &target_a, "A 问题".to_string(), None)
        .expect("begin A");
    let attempt_a = begin_a.attempt_id.expect("attempt A");
    let turn_a = begin_a.logical_turn_id.expect("turn A");
    accept_turn_core(
        &writer,
        SESSION_ABA,
        &attempt_a,
        &turn_a,
        &target_a,
        "claude:native-a",
    )
    .expect("accept A");
    commit_turn_core(
        &writer,
        SESSION_ABA,
        &attempt_a,
        &turn_a,
        &target_a,
        Some("A 答案".to_string()),
        &completed(),
        Some("claude:native-a".to_string()),
    )
    .expect("commit A");

    let begin_b = begin_turn_core(&writer, SESSION_ABA, &target_b, "B 问题".to_string(), None)
        .expect("begin B");
    let attempt_b = begin_b.attempt_id.expect("attempt B");
    let turn_b = begin_b.logical_turn_id.expect("turn B");
    accept_turn_core(
        &writer,
        SESSION_ABA,
        &attempt_b,
        &turn_b,
        &target_b,
        "claude:native-b",
    )
    .expect("accept B");
    commit_turn_core(
        &writer,
        SESSION_ABA,
        &attempt_b,
        &turn_b,
        &target_b,
        Some("B 答案".to_string()),
        &completed(),
        Some("claude:native-b".to_string()),
    )
    .expect("commit B");

    let events = writer.events_for_session(SESSION_ABA).expect("events");
    let package = compile_context(
        &events,
        &CompileContextRequest {
            session_id: SESSION_ABA.to_string(),
            binding_key: "claude:provider-a".to_string(),
            destination: json!({ "engine": "claude", "providerProfileId": "provider-a" }),
            destination_native_session_id: Some("claude:native-a".to_string()),
            from_sequence_exclusive: None,
            through_sequence_inclusive: None,
            exclude_attempt_id: None,
            capabilities: capabilities(),
            budget_estimated_tokens: None,
        },
    )
    .expect("compile A reuse context");

    assert!(!package.prompt_prefix.contains("A 问题"));
    assert!(!package.prompt_prefix.contains("A 答案"));
    assert!(package.prompt_prefix.contains("B 问题"));
    assert!(package.prompt_prefix.contains("B 答案"));
    assert!(package
        .manifest
        .omitted
        .iter()
        .any(|omission| omission.category == "destination-owned"));
}

#[test]
fn portable_context_keeps_legacy_only_turns_without_shadowing_canonical_turns() {
    const MIXED_SESSION: &str = "context-session-mixed-history";
    let store = TempStoreDir::new("context-mixed-history");
    let writer = writer(&store);
    let canonical_target = target(None);
    let begin = begin_turn_core(
        &writer,
        MIXED_SESSION,
        &canonical_target,
        "canonical question".to_string(),
        None,
    )
    .expect("begin canonical");
    let attempt = begin.attempt_id.expect("attempt");
    let logical_turn = begin.logical_turn_id.expect("logical turn");
    accept_turn_core(
        &writer,
        MIXED_SESSION,
        &attempt,
        &logical_turn,
        &canonical_target,
        "claude:canonical",
    )
    .expect("accept canonical");
    commit_turn_core(
        &writer,
        MIXED_SESSION,
        &attempt,
        &logical_turn,
        &canonical_target,
        Some("canonical answer".to_string()),
        &completed(),
        Some("claude:canonical".to_string()),
    )
    .expect("commit canonical");

    for fact in map_v0_turn_to_presentation_only_facts(v0_evidence(
        &logical_turn,
        "v0-shadow:canonical-duplicate",
        "canonical question",
        "shadow duplicate must not win",
    )) {
        writer
            .append_presentation_only_fact(MIXED_SESSION, fact)
            .expect("append duplicate shadow");
    }
    for fact in map_v0_turn_to_presentation_only_facts(v0_evidence(
        "legacy-only-turn",
        "v0-shadow:legacy-only",
        "legacy question",
        "legacy answer",
    )) {
        writer
            .append_presentation_only_fact(MIXED_SESSION, fact)
            .expect("append legacy-only turn");
    }

    let package = compile_context(
        &writer
            .events_for_session(MIXED_SESSION)
            .expect("mixed events"),
        &CompileContextRequest {
            session_id: MIXED_SESSION.to_string(),
            binding_key: "claude:provider-b".to_string(),
            destination: json!({ "engine": "claude", "providerProfileId": "provider-b" }),
            destination_native_session_id: None,
            from_sequence_exclusive: None,
            through_sequence_inclusive: None,
            exclude_attempt_id: None,
            capabilities: capabilities(),
            budget_estimated_tokens: None,
        },
    )
    .expect("compile mixed history");

    assert!(package.prompt_prefix.contains("canonical question"));
    assert!(package.prompt_prefix.contains("canonical answer"));
    assert!(package.prompt_prefix.contains("legacy question"));
    assert!(package.prompt_prefix.contains("legacy answer"));
    assert!(!package
        .prompt_prefix
        .contains("shadow duplicate must not win"));
}
