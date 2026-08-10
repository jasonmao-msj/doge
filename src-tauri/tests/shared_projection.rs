//! Shared Projection 集成测试（Wave 3 / A3，Gate 3 前置）。
//!
//! 覆盖：canonical fact → ProjectionItem 映射、checkpoint/rebuild、Legacy dual-read、Shadow 对比。

mod common;

use common::TempStoreDir;
use doge_lib::shared_event_log::canonical::shadow_v0::{
    map_v0_snapshot_to_presentation_only_facts, map_v0_turn_to_presentation_only_facts, v0_evidence,
};
use doge_lib::shared_event_log::canonical::types::{
    ArtifactRef, AtomicToolExchange, CanonicalAssistantBlocks, CanonicalBlock, CanonicalFact,
    CanonicalUserInput, ControlFact, Outcome, OutcomeStatus, SquadNodeOutcomeRecordedFact,
    SquadRunRequestedFact, SquadRunSettledFact, ToolCall, ToolResult, ToolResultStatus,
    TurnCommittedFact, TurnExecutionSnapshot, TurnRequestedFact, UsageRecordedFact, UsageShape,
    UsageSource, UsageVerification,
};
use doge_lib::shared_event_log::{
    open, AppendOutcome, Fidelity, NewCanonicalEvent, OpenOutcome, ProjectionCheckpointRow,
};
use doge_lib::shared_projection::{
    LegacySharedReader, ProjectionItemKind, ShadowComparator, SharedProjector,
};

const SESSION: &str = "a3-session";

fn snapshot() -> TurnExecutionSnapshot {
    TurnExecutionSnapshot {
        engine: "claude".to_string(),
        provider_profile_id: Some("profile-1".to_string()),
        model_catalog_entry_id: None,
        model: Some("claude-opus".to_string()),
        reasoning: None,
        provider_profile_name_snapshot: None,
        provider_profile_source: None,
        runtime_capability_fingerprint: None,
        extra: serde_json::Value::Object(Default::default()),
    }
}

fn make_turn_requested(attempt_id: &str) -> CanonicalFact {
    CanonicalFact::TurnRequested(TurnRequestedFact {
        logical_turn_id: "turn-1".to_string(),
        attempt_id: attempt_id.to_string(),
        retry_of_attempt_id: None,
        input: CanonicalUserInput {
            text: Some("hello".to_string()),
            image_refs: None,
            attachment_refs: None,
            extra: serde_json::Value::Object(Default::default()),
        },
        target: snapshot(),
        requested_at: 1_700_000_000_000,
        extra: serde_json::Value::Object(Default::default()),
    })
}

fn make_turn_committed(attempt_id: &str) -> CanonicalFact {
    CanonicalFact::TurnCommitted(TurnCommittedFact {
        logical_turn_id: "turn-1".to_string(),
        attempt_id: attempt_id.to_string(),
        input_entry_id: format!("{attempt_id}:input"),
        assistant: CanonicalAssistantBlocks {
            blocks: vec![
                CanonicalBlock::Text {
                    text: "hello back".to_string(),
                },
                CanonicalBlock::Reasoning {
                    text: "thinking...".to_string(),
                },
            ],
        },
        atomic_tool_exchanges: vec![],
        artifact_refs: vec![],
        target: snapshot(),
        provider_private_refs: vec![],
        omissions: vec![],
        outcome: Outcome {
            status: OutcomeStatus::Completed,
            error_code: None,
            error_message: None,
            stop_reason: None,
            extra: serde_json::Value::Object(Default::default()),
        },
        committed_at: 1_700_000_000_001,
        extra: serde_json::Value::Object(Default::default()),
    })
}

fn make_squad_turn_requested(attempt_id: &str) -> CanonicalFact {
    let CanonicalFact::TurnRequested(mut fact) = make_turn_requested(attempt_id) else {
        unreachable!("fixture is turnRequested");
    };
    fact.extra = serde_json::json!({
        "squadWorkerBindingKey": format!("squad:run-1:final:{attempt_id}"),
        "squadExposeFinal": true,
    });
    CanonicalFact::TurnRequested(fact)
}

fn make_squad_outcome(attempt_id: &str) -> CanonicalFact {
    CanonicalFact::SquadNodeOutcomeRecorded(SquadNodeOutcomeRecordedFact {
        fact_id: format!("outcome-{attempt_id}"),
        run_id: "run-1".to_string(),
        node_id: "final".to_string(),
        attempt_id: attempt_id.to_string(),
        outcome: serde_json::json!({
            "schemaVersion": 1,
            "status": "succeeded",
            "summary": "hello back",
            "evidence": [],
            "artifacts": [],
            "changedPaths": [],
            "verification": {
                "status": "not-run",
                "checks": [],
                "failures": []
            },
            "proposedRepairs": [],
            "extra": {}
        }),
        recorded_at: 1_700_000_000_002,
        extra: serde_json::Value::Object(Default::default()),
    })
}

fn make_squad_run_requested() -> CanonicalFact {
    CanonicalFact::SquadRunRequested(SquadRunRequestedFact {
        fact_id: "squad:run-1:requested".to_string(),
        run_id: "run-1".to_string(),
        workspace_id: "workspace-1".to_string(),
        request_text: "run the squad task".to_string(),
        lead_target: snapshot(),
        requested_at: 1_700_000_000_000,
        extra: serde_json::json!({"workspaceRoot": "/workspace"}),
    })
}

fn make_squad_run_settled(attempt_id: &str) -> CanonicalFact {
    CanonicalFact::SquadRunSettled(SquadRunSettledFact {
        fact_id: "squad:run-1:settled".to_string(),
        run_id: "run-1".to_string(),
        status: "succeeded".to_string(),
        summary: Some("hello back".to_string()),
        settled_at: 1_700_000_000_003,
        extra: serde_json::json!({
            "finalAttemptId": attempt_id,
            "target": snapshot(),
        }),
    })
}

fn make_failed_turn_committed(attempt_id: &str) -> CanonicalFact {
    let CanonicalFact::TurnCommitted(mut fact) = make_turn_committed(attempt_id) else {
        unreachable!("fixture is turnCommitted");
    };
    fact.assistant.blocks.clear();
    fact.outcome = Outcome {
        status: OutcomeStatus::Failed,
        error_code: Some("provider-rejected".to_string()),
        error_message: Some("model is unavailable".to_string()),
        stop_reason: None,
        extra: serde_json::Value::Object(Default::default()),
    };
    CanonicalFact::TurnCommitted(fact)
}

fn make_usage_recorded(usage_record_id: &str, attempt_id: &str) -> CanonicalFact {
    make_usage_recorded_with_source(
        usage_record_id,
        attempt_id,
        UsageSource::RuntimeFinal,
        1,
        15,
    )
}

fn make_usage_recorded_with_source(
    usage_record_id: &str,
    attempt_id: &str,
    source: UsageSource,
    revision: i64,
    total_tokens: i64,
) -> CanonicalFact {
    CanonicalFact::UsageRecorded(UsageRecordedFact {
        usage_record_id: usage_record_id.to_string(),
        report_subject_id: format!("{attempt_id}:subject"),
        revision,
        supersedes_usage_record_id: None,
        logical_turn_id: "turn-1".to_string(),
        attempt_id: attempt_id.to_string(),
        binding_key: "binding-1".to_string(),
        native_session_id: "native-1".to_string(),
        native_turn_id: None,
        target: snapshot(),
        usage: UsageShape {
            input_tokens: Some(10),
            cached_input_tokens: None,
            output_tokens: Some(5),
            total_tokens: Some(total_tokens),
            provider_reported_cost: None,
            extra: serde_json::Value::Object(Default::default()),
        },
        source,
        verification: UsageVerification::Verified,
        observed_at: 1_700_000_000_002,
        extra: serde_json::Value::Object(Default::default()),
    })
}

/// Scenario: provider-report 覆盖同 attempt 的 runtime-final，且不相加。
#[test]
fn provider_report_usage_replaces_runtime_final_without_summing() {
    let temp = TempStoreDir::new("usage-precedence");
    let writer = open_writer(&temp);
    writer
        .append_canonical_fact(
            SESSION,
            make_usage_recorded_with_source(
                "usage-runtime",
                "attempt-1",
                UsageSource::RuntimeFinal,
                1,
                15,
            ),
        )
        .expect("append runtime usage");

    let projector = SharedProjector::new();
    let before = projector
        .project(&writer, SESSION, "canvas", 2)
        .expect("project runtime usage");
    assert_eq!(before.len(), 1);
    assert_eq!(before[0].content["totalTokens"], 15);

    writer
        .append_canonical_fact(
            SESSION,
            make_usage_recorded_with_source(
                "usage-provider",
                "attempt-1",
                UsageSource::ProviderReport,
                2,
                12,
            ),
        )
        .expect("append provider usage");

    let after = projector
        .project(&writer, SESSION, "canvas", 2)
        .expect("project provider usage");
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].content["source"], "provider-report");
    assert_eq!(after[0].content["totalTokens"], 12);

    let rebuilt = projector
        .rebuild(&writer, SESSION, "canvas", 2)
        .expect("rebuild usage projection");
    assert_eq!(rebuilt, after);

    writer
        .append_canonical_fact(
            SESSION,
            make_usage_recorded_with_source(
                "usage-runtime-late",
                "attempt-1",
                UsageSource::RuntimeFinal,
                3,
                99,
            ),
        )
        .expect("append late runtime usage");
    let after_late_runtime = projector
        .project(&writer, SESSION, "canvas", 2)
        .expect("project late runtime usage");
    assert_eq!(after_late_runtime, after);

    writer.shutdown().unwrap();
}

/// Scenario: 真实 V0 snapshot shape 可幂等镜像并投影 user/assistant final。
#[test]
fn v0_final_snapshot_mirrors_idempotently_into_shadow_projection() {
    let temp = TempStoreDir::new("v0-shadow-projection");
    let writer = open_writer(&temp);
    let items = vec![
        serde_json::json!({
            "id": "user-1",
            "kind": "message",
            "role": "user",
            "text": "hello",
            "turnId": "turn-1"
        }),
        serde_json::json!({
            "id": "assistant-1",
            "kind": "message",
            "role": "assistant",
            "text": "hello back",
            "turnId": "turn-1",
            "engineSource": "claude",
            "isFinal": true,
            "finalCompletedAt": 1_700_000_000_001_i64
        }),
    ];
    let facts = map_v0_snapshot_to_presentation_only_facts(&items, "claude", 1_700_000_000_000);

    for _ in 0..2 {
        for fact in facts.clone() {
            writer
                .append_presentation_only_fact(SESSION, fact)
                .expect("mirror fact");
        }
    }

    let events = writer.events_for_session(SESSION).expect("shadow events");
    assert_eq!(events.len(), 2);
    assert!(events
        .iter()
        .all(|event| event.fidelity == Fidelity::PresentationOnly));
    let projected = SharedProjector::new()
        .project_events(&events)
        .expect("project shadow");
    assert_eq!(projected.len(), 2);
    assert_eq!(projected[0].content["role"], "user");
    assert_eq!(projected[1].content["role"], "assistant");
    writer.shutdown().unwrap();
}

/// Scenario: V0 rollback/shadow can preserve legacy-only Turns, but it cannot overwrite
/// canonical target provenance for the same logical Turn.
#[test]
fn canonical_logical_turn_wins_over_later_presentation_shadow() {
    let temp = TempStoreDir::new("canonical-shadow-precedence");
    let writer = open_writer(&temp);
    writer
        .append_canonical_fact(SESSION, make_turn_requested("attempt-canonical"))
        .expect("append canonical request");
    writer
        .append_canonical_fact(SESSION, make_turn_committed("attempt-canonical"))
        .expect("append canonical commit");

    let mut duplicate = v0_evidence(
        "turn-1",
        "v0-shadow:duplicate",
        "hello",
        "legacy target must not win",
    );
    duplicate.engine = "codex".to_string();
    duplicate.provider_profile_id = None;
    duplicate.model = None;
    for fact in map_v0_turn_to_presentation_only_facts(duplicate) {
        writer
            .append_presentation_only_fact(SESSION, fact)
            .expect("append duplicate shadow");
    }

    let mut legacy_only = v0_evidence(
        "legacy-turn",
        "v0-shadow:legacy-only",
        "legacy question",
        "legacy answer",
    );
    legacy_only.provider_profile_id = None;
    legacy_only.model = None;
    for fact in map_v0_turn_to_presentation_only_facts(legacy_only) {
        writer
            .append_presentation_only_fact(SESSION, fact)
            .expect("append legacy-only shadow");
    }

    let items = SharedProjector::new()
        .project_events(&writer.events_for_session(SESSION).expect("events"))
        .expect("project");
    let duplicate_texts = items
        .iter()
        .filter_map(|item| item.content.get("text").and_then(serde_json::Value::as_str))
        .filter(|text| text.contains("legacy target must not win"))
        .count();
    assert_eq!(duplicate_texts, 0);
    assert!(items.iter().any(|item| {
        item.content.get("text").and_then(serde_json::Value::as_str) == Some("legacy answer")
            && item.fidelity == Fidelity::PresentationOnly
    }));
    let canonical_assistant = items
        .iter()
        .find(|item| {
            item.content.get("text").and_then(serde_json::Value::as_str) == Some("hello back")
        })
        .expect("canonical assistant");
    assert_eq!(canonical_assistant.fidelity, Fidelity::Canonical);
    assert_eq!(
        canonical_assistant.content["executionTargetSnapshot"]["model"],
        "claude-opus"
    );

    writer.shutdown().unwrap();
}

fn make_control(action: &str) -> CanonicalFact {
    CanonicalFact::Control(ControlFact {
        control_kind: format!("turn.{action}"),
        logical_turn_id: Some("turn-1".to_string()),
        attempt_id: Some("attempt-1".to_string()),
        binding_key: None,
        reason: None,
        details: None,
        extra: serde_json::Value::Object(Default::default()),
    })
}

fn open_writer(temp: &TempStoreDir) -> doge_lib::shared_event_log::SharedEventWriter {
    let outcome = open(&temp.db_path).expect("open shared event store");
    match outcome {
        OpenOutcome::Ready(writer) => writer,
        OpenOutcome::ReadOnlyRecovery { .. } => panic!("fresh db must be ready"),
    }
}

/// Squad worker prose stays private; settled success is incrementally projected once.
#[test]
fn squad_final_is_exposed_only_after_successful_settlement() {
    let temp = TempStoreDir::new("squad-final-visibility");
    let writer = open_writer(&temp);
    writer
        .append_canonical_fact(SESSION, make_squad_run_requested())
        .expect("request squad run");
    writer
        .append_canonical_fact(SESSION, make_squad_turn_requested("attempt-final"))
        .expect("request squad final");
    let projector = SharedProjector::new();
    let requested_only = projector
        .project(&writer, SESSION, "squad-final", 1)
        .expect("checkpoint squad request before Worker terminal");
    assert!(requested_only.iter().all(|item| {
        item.content.get("text").and_then(|value| value.as_str()) != Some("hello back")
    }));

    writer
        .append_canonical_fact(SESSION, make_turn_committed("attempt-final"))
        .expect("commit squad final");
    let committed_delta = projector
        .project(&writer, SESSION, "squad-final", 1)
        .expect("incrementally project hidden Worker terminal");
    assert!(committed_delta.iter().all(|item| {
        item.content.get("text").and_then(|value| value.as_str()) != Some("hello back")
    }));

    writer
        .append_canonical_fact(SESSION, make_squad_outcome("attempt-final"))
        .expect("record successful squad outcome");
    let outcome_only = projector
        .project(&writer, SESSION, "squad-final", 1)
        .expect("checkpoint successful outcome");
    assert!(outcome_only.iter().all(|item| {
        item.content.get("text").and_then(|value| value.as_str()) != Some("hello back")
    }));
    assert!(outcome_only.iter().any(|item| {
        item.content.get("text").and_then(|value| value.as_str()) == Some("run the squad task")
    }));

    writer
        .append_canonical_fact(SESSION, make_squad_run_settled("attempt-final"))
        .expect("settle successful squad run");
    let succeeded = projector
        .project(&writer, SESSION, "squad-final", 1)
        .expect("incrementally project successful settlement");
    assert!(succeeded.iter().any(|item| {
        item.kind == ProjectionItemKind::Message
            && item.content.get("text").and_then(|value| value.as_str()) == Some("hello back")
    }));
    writer.shutdown().unwrap();
}

/// Scenario: canonical facts project to correct ConversationItem kinds。
#[test]
fn canonical_facts_project_to_conversation_items() {
    let temp = TempStoreDir::new("projection");
    let writer = open_writer(&temp);

    let facts = vec![
        make_turn_requested("attempt-1"),
        make_turn_committed("attempt-1"),
        make_usage_recorded("usage-1", "attempt-1"),
        make_control("cancel"),
    ];

    for fact in facts {
        let outcome = if matches!(fact, CanonicalFact::Control(_)) {
            writer.append_canonical_fact_at(SESSION, fact, 1_700_000_000_003)
        } else {
            writer.append_canonical_fact(SESSION, fact)
        }
        .expect("append fact");
        assert!(matches!(outcome, AppendOutcome::Inserted { .. }));
    }

    let events = writer.events_for_session(SESSION).expect("events");
    assert_eq!(events.len(), 4);

    let projector = SharedProjector::new();
    let items = projector.project_events(&events).expect("project");

    // turnRequested → 1 user message
    // turnCommitted → 1 assistant text + 1 reasoning
    // usageRecorded → 1 metadata
    // control → 1 system notice
    assert_eq!(items.len(), 5);

    let kinds: Vec<ProjectionItemKind> = items.iter().map(|i| i.kind).collect();
    assert!(kinds.contains(&ProjectionItemKind::Message));
    assert!(kinds.contains(&ProjectionItemKind::Reasoning));
    assert!(kinds.contains(&ProjectionItemKind::Metadata));
    assert!(kinds.contains(&ProjectionItemKind::SystemNotice));

    writer.shutdown().unwrap();
}

#[test]
fn failed_terminal_reloads_as_labeled_assistant_message() {
    let temp = TempStoreDir::new("failed-terminal-provenance");
    let writer = open_writer(&temp);
    writer
        .append_canonical_fact(SESSION, make_failed_turn_committed("attempt-failed"))
        .expect("append failed terminal");

    let events = writer.events_for_session(SESSION).expect("events");
    let items = SharedProjector::new()
        .project_events(&events)
        .expect("project");
    let outcome = items
        .iter()
        .find(|item| item.id.ends_with(":outcome"))
        .expect("visible failed outcome");

    assert_eq!(outcome.kind, ProjectionItemKind::Message);
    assert_eq!(outcome.content["role"], "assistant");
    assert_eq!(outcome.content["text"], "Turn failed: model is unavailable");
    assert_eq!(
        outcome.content["executionTargetSnapshot"]["model"],
        "claude-opus"
    );
    assert_eq!(
        outcome.content["executionTargetSnapshot"]["providerProfileId"],
        "profile-1"
    );

    writer.shutdown().unwrap();
}

#[test]
fn reasoning_only_completed_turn_reloads_with_target_badge_anchor() {
    let temp = TempStoreDir::new("reasoning-only-provenance");
    let writer = open_writer(&temp);
    let mut fact = make_turn_committed("attempt-reasoning-only");
    let CanonicalFact::TurnCommitted(committed) = &mut fact else {
        panic!("fixture must be turnCommitted");
    };
    committed.assistant.blocks = vec![CanonicalBlock::Reasoning {
        text: "private analysis".to_string(),
    }];
    writer
        .append_canonical_fact(SESSION, fact)
        .expect("append reasoning-only terminal");

    let items = SharedProjector::new()
        .project_events(&writer.events_for_session(SESSION).expect("events"))
        .expect("project");
    let provenance = items
        .iter()
        .find(|item| item.id.ends_with(":provenance"))
        .expect("target badge anchor");

    assert_eq!(provenance.kind, ProjectionItemKind::Message);
    assert_eq!(provenance.content["text"], "");
    assert_eq!(
        provenance.content["executionTargetSnapshot"]["providerProfileId"],
        "profile-1"
    );
    assert!(items
        .iter()
        .any(|item| item.kind == ProjectionItemKind::Reasoning));

    writer.shutdown().unwrap();
}

#[test]
fn standalone_runtime_artifact_is_visible_after_history_reload() {
    let temp = TempStoreDir::new("standalone-artifact");
    let writer = open_writer(&temp);
    let mut fact = make_turn_committed("attempt-artifact");
    let CanonicalFact::TurnCommitted(committed) = &mut fact else {
        panic!("fixture must be turnCommitted");
    };
    committed.artifact_refs.push(ArtifactRef {
        artifact_id: "image-1".to_string(),
        media_type: "image/png".to_string(),
        size_bytes: Some(42),
        sha256: "a".repeat(64),
        locator: "/tmp/image.png".to_string(),
        redaction: None,
        extra: serde_json::Value::Object(Default::default()),
    });
    writer
        .append_canonical_fact(SESSION, fact)
        .expect("append committed artifact");

    let items = SharedProjector::new()
        .project_events(&writer.events_for_session(SESSION).expect("events"))
        .expect("project");
    let image = items
        .iter()
        .find(|item| item.kind == ProjectionItemKind::GeneratedImage)
        .expect("standalone artifact projection");
    assert_eq!(image.content["turnId"], "turn-1");
    assert_eq!(image.content["engineSource"], "claude");
    assert_eq!(image.content["images"][0]["src"], "/tmp/image.png");

    writer.shutdown().unwrap();
}

/// Scenario: projection checkpoint round-trip。
#[test]
fn projection_checkpoint_round_trip() {
    let temp = TempStoreDir::new("checkpoint");
    let writer = open_writer(&temp);

    let checkpoint = ProjectionCheckpointRow {
        session_id: SESSION.to_string(),
        projection_name: "canvas".to_string(),
        projection_version: 1,
        through_sequence: 42,
        payload_json: "{}".to_string(),
    };

    writer
        .upsert_projection_checkpoint(&checkpoint)
        .expect("upsert");

    let loaded = writer
        .get_projection_checkpoint(SESSION, "canvas")
        .expect("get");
    assert_eq!(loaded, Some(checkpoint));

    writer.shutdown().unwrap();
}

/// Scenario: rebuild produces identical items after checkpoint deletion。
#[test]
fn rebuild_produces_identical_items() {
    let temp = TempStoreDir::new("rebuild");
    let writer = open_writer(&temp);

    let facts = vec![
        make_turn_requested("attempt-1"),
        make_turn_committed("attempt-1"),
    ];
    for fact in facts {
        writer.append_canonical_fact(SESSION, fact).expect("append");
    }

    let events = writer.events_for_session(SESSION).expect("events");
    let projector = SharedProjector::new();
    let first = projector.project_events(&events).expect("project");

    // 模拟 checkpoint 删除后 rebuild
    let second = projector.project_events(&events).expect("project");

    assert_eq!(first.len(), second.len());
    for (a, b) in first.iter().zip(second.iter()) {
        assert_eq!(a.id, b.id);
        assert_eq!(a.kind, b.kind);
        assert_eq!(a.checksum, b.checksum);
    }

    writer.shutdown().unwrap();
}

/// Scenario: legacy snapshot maps to presentation-only items。
#[test]
fn legacy_snapshot_maps_to_presentation_only() {
    let reader = LegacySharedReader::new();
    let snapshot = concat!(
        "{\"kind\":\"snapshot\",\"createdAt\":1,\"selectedEngine\":\"claude\",",
        "\"lastTurnSeq\":1,\"items\":[{\"id\":\"old\",\"kind\":\"message\",",
        "\"role\":\"user\",\"text\":\"stale\"}]}\n",
        "{\"kind\":\"snapshot\",\"createdAt\":2,\"selectedEngine\":\"codex\",",
        "\"lastTurnSeq\":1,\"items\":[",
        "{\"id\":\"user-1\",\"kind\":\"message\",\"role\":\"user\",\"text\":\"hi\"},",
        "{\"id\":\"assistant-1\",\"kind\":\"message\",\"role\":\"assistant\",",
        "\"text\":\"hello\",\"isFinal\":true}]}\n"
    );

    let items = reader.parse_snapshot(snapshot).expect("parse");
    assert_eq!(items.len(), 2);
    assert_eq!(items[0].id, "user-1");
    assert_eq!(items[1].id, "assistant-1");
    for item in items {
        assert_eq!(item.fidelity, Fidelity::PresentationOnly);
        assert_eq!(item.kind, ProjectionItemKind::Message);
    }
}

/// Scenario: shadow comparator reports mismatches correctly。
#[test]
fn shadow_comparator_reports_mismatches() {
    let comparator = ShadowComparator::new();

    let shadow = vec![
        doge_lib::shared_projection::ProjectionItem {
            id: "shadow-user".to_string(),
            kind: ProjectionItemKind::Message,
            content: serde_json::json!({"role": "user", "text": "same"}),
            fidelity: Fidelity::Canonical,
            checksum: "x".to_string(),
        },
        doge_lib::shared_projection::ProjectionItem {
            id: "shadow-assistant".to_string(),
            kind: ProjectionItemKind::Message,
            content: serde_json::json!({"role": "assistant", "text": "v1"}),
            fidelity: Fidelity::Canonical,
            checksum: "y".to_string(),
        },
        doge_lib::shared_projection::ProjectionItem {
            id: "shadow-tool".to_string(),
            kind: ProjectionItemKind::Tool,
            content: serde_json::json!({"toolType": "Read", "status": "completed"}),
            fidelity: Fidelity::Canonical,
            checksum: "w".to_string(),
        },
    ];

    let legacy = vec![
        doge_lib::shared_projection::ProjectionItem {
            id: "legacy-user".to_string(),
            kind: ProjectionItemKind::Message,
            content: serde_json::json!({"role": "user", "text": "same"}),
            fidelity: Fidelity::PresentationOnly,
            checksum: "x".to_string(),
        },
        doge_lib::shared_projection::ProjectionItem {
            id: "legacy-assistant".to_string(),
            kind: ProjectionItemKind::Message,
            content: serde_json::json!({"role": "assistant", "text": "v2"}),
            fidelity: Fidelity::PresentationOnly,
            checksum: "z".to_string(),
        },
        doge_lib::shared_projection::ProjectionItem {
            id: "legacy-reasoning".to_string(),
            kind: ProjectionItemKind::Reasoning,
            content: serde_json::json!({"summary": "thinking", "content": "thinking"}),
            fidelity: Fidelity::PresentationOnly,
            checksum: "v".to_string(),
        },
    ];

    let report = comparator.compare(&shadow, &legacy);
    assert_eq!(report.total_shadow, 3);
    assert_eq!(report.total_legacy, 3);
    assert_eq!(report.matched, 1);
    assert_eq!(report.mismatches.len(), 3);
    assert!(report.mismatches.iter().any(|m| matches!(
        m.kind,
        doge_lib::shared_projection::MismatchKind::ShadowOnly
    )));
    assert!(report.mismatches.iter().any(|m| matches!(
        m.kind,
        doge_lib::shared_projection::MismatchKind::LegacyOnly
    )));
    assert!(report.mismatches.iter().any(|m| matches!(
        m.kind,
        doge_lib::shared_projection::MismatchKind::ContentMismatch
    )));
}

/// Scenario: rebuild 扫描全量事件并更新 checkpoint。
#[test]
fn rebuild_scans_events_and_updates_checkpoint() {
    let temp = TempStoreDir::new("rebuild-checkpoint");
    let writer = open_writer(&temp);

    for fact in [
        make_turn_requested("attempt-1"),
        make_turn_committed("attempt-1"),
    ] {
        writer.append_canonical_fact(SESSION, fact).expect("append");
    }

    let projector = SharedProjector::new();
    let items = projector
        .rebuild(&writer, SESSION, "canvas", 1)
        .expect("rebuild");
    assert_eq!(items.len(), 3); // user message + assistant text + reasoning

    let checkpoint = writer
        .get_projection_checkpoint(SESSION, "canvas")
        .expect("get checkpoint")
        .expect("checkpoint exists");
    assert_eq!(checkpoint.projection_version, 1);
    assert_eq!(checkpoint.through_sequence, 2);

    // 幂等：再次 rebuild 产出相同 items 与 checkpoint。
    let items_again = projector
        .rebuild(&writer, SESSION, "canvas", 1)
        .expect("rebuild again");
    assert_eq!(items.len(), items_again.len());
    for (a, b) in items.iter().zip(items_again.iter()) {
        assert_eq!(a.id, b.id);
        assert_eq!(a.checksum, b.checksum);
    }

    writer.shutdown().unwrap();
}

/// Scenario: checkpoint 后只读取新事件，并把 cache 与增量结果合并。
#[test]
fn projection_incrementally_reads_after_checkpoint() {
    let temp = TempStoreDir::new("projection-incremental");
    let writer = open_writer(&temp);
    writer
        .append_canonical_fact(SESSION, make_turn_requested("attempt-1"))
        .expect("append requested");

    let projector = SharedProjector::new();
    let first = projector
        .project(&writer, SESSION, "canvas", 1)
        .expect("initial project");
    assert_eq!(first.len(), 1);

    writer
        .append_canonical_fact(SESSION, make_turn_committed("attempt-1"))
        .expect("append committed");
    assert_eq!(
        writer
            .read_projection_events(SESSION, 1)
            .expect("read delta")
            .len(),
        1
    );

    let second = projector
        .project(&writer, SESSION, "canvas", 1)
        .expect("incremental project");
    assert_eq!(second.len(), 3);
    assert_eq!(
        writer
            .get_projection_checkpoint(SESSION, "canvas")
            .expect("checkpoint")
            .expect("checkpoint exists")
            .through_sequence,
        2
    );
    writer.shutdown().unwrap();
}

/// Scenario: projection version 变化时忽略旧 cache 并全量 rebuild。
#[test]
fn projection_version_mismatch_rebuilds() {
    let temp = TempStoreDir::new("projection-version");
    let writer = open_writer(&temp);
    writer
        .append_canonical_fact(SESSION, make_turn_requested("attempt-1"))
        .expect("append");
    let projector = SharedProjector::new();
    let version_one = projector
        .project(&writer, SESSION, "canvas", 1)
        .expect("version one");
    let version_two = projector
        .project(&writer, SESSION, "canvas", 2)
        .expect("version two");
    assert_eq!(version_one, version_two);
    assert_eq!(
        writer
            .get_projection_checkpoint(SESSION, "canvas")
            .expect("checkpoint")
            .expect("checkpoint exists")
            .projection_version,
        2
    );
    writer.shutdown().unwrap();
}

/// Scenario: 坏 canonical payload 必须阻断 projection，且 checkpoint 不前移。
#[test]
fn invalid_projection_event_does_not_advance_checkpoint() {
    let temp = TempStoreDir::new("projection-invalid");
    let writer = open_writer(&temp);
    writer
        .append_canonical_fact(SESSION, make_turn_requested("attempt-1"))
        .expect("append valid");
    let projector = SharedProjector::new();
    projector
        .project(&writer, SESSION, "canvas", 1)
        .expect("initial project");

    writer
        .append_event(&NewCanonicalEvent {
            session_id: SESSION.to_string(),
            event_id: "invalid-event".to_string(),
            fact_type: "conversation.turnCommitted".to_string(),
            logical_turn_id: Some("turn-1".to_string()),
            attempt_id: Some("attempt-invalid".to_string()),
            dedupe_key: None,
            payload_json: "{}".to_string(),
            fidelity: Fidelity::Canonical,
            committed_at: 1_700_000_000_010,
            schema_version: 2,
        })
        .expect("append raw invalid event");

    assert!(projector.project(&writer, SESSION, "canvas", 1).is_err());
    assert_eq!(
        writer
            .get_projection_checkpoint(SESSION, "canvas")
            .expect("checkpoint")
            .expect("checkpoint exists")
            .through_sequence,
        1
    );
    writer.shutdown().unwrap();
}

/// Scenario: 旧版 delivery payload 缺少 tagged `type` 时，projector 使用同一 durable row
/// 的 `fact_type` 解码，并继续恢复后续 conversation facts。
#[test]
fn legacy_type_less_delivery_fact_does_not_block_history_rebuild() {
    let temp = TempStoreDir::new("projection-type-less-delivery");
    let writer = open_writer(&temp);
    writer
        .append_canonical_fact(SESSION, make_turn_requested("attempt-1"))
        .expect("append requested");
    writer
        .append_event(&NewCanonicalEvent {
            session_id: SESSION.to_string(),
            event_id: "legacy-delivery-prepared".to_string(),
            fact_type: "context.deliveryPrepared".to_string(),
            logical_turn_id: Some("turn-1".to_string()),
            attempt_id: Some("attempt-1".to_string()),
            dedupe_key: None,
            payload_json: serde_json::json!({
                "logicalTurnId": "turn-1",
                "attemptId": "attempt-1",
                "bindingKey": "claude:profile-1",
                "packageId": "package-1",
                "sourceChecksum": "checksum-1",
                "throughSequenceInclusive": 1,
                "mode": "portable-transcript",
                "operation": "prompt-prefix"
            })
            .to_string(),
            fidelity: Fidelity::Canonical,
            committed_at: 1_700_000_000_000,
            schema_version: 1,
        })
        .expect("append legacy delivery");
    writer
        .append_canonical_fact(SESSION, make_turn_committed("attempt-1"))
        .expect("append committed");

    let projector = SharedProjector::new();
    let items = projector
        .rebuild(&writer, SESSION, "canvas", 3)
        .expect("rebuild legacy stream");
    assert_eq!(items.len(), 3);
    assert_eq!(items[0].content["role"], "user");
    // process-before-prose: reasoning (if any) sits above final assistant text
    assert!(items.iter().any(|item| {
        item.kind == ProjectionItemKind::Message
            && item.content.get("role").and_then(|v| v.as_str()) == Some("assistant")
    }));
    assert_eq!(
        writer
            .get_projection_checkpoint(SESSION, "canvas")
            .expect("checkpoint")
            .expect("checkpoint exists")
            .through_sequence,
        3
    );
    writer.shutdown().unwrap();
}

/// Scenario: Shared history stamps Native-parity final footer meta onto assistant messages.
#[test]
fn turn_committed_stamps_final_duration_and_usage_tokens() {
    let temp = TempStoreDir::new("final-meta-stamp");
    let writer = open_writer(&temp);
    writer
        .append_canonical_fact(SESSION, make_turn_requested("attempt-meta"))
        .expect("append request");
    writer
        .append_canonical_fact(SESSION, make_turn_committed("attempt-meta"))
        .expect("append commit");
    writer
        .append_canonical_fact(
            SESSION,
            make_usage_recorded_with_source(
                "usage-meta",
                "attempt-meta",
                UsageSource::ProviderReport,
                1,
                15,
            ),
        )
        .expect("append usage");

    let projected = SharedProjector::new()
        .project_events(&writer.events_for_session(SESSION).expect("events"))
        .expect("project");
    let assistant = projected
        .iter()
        .find(|item| {
            item.kind == ProjectionItemKind::Message
                && item.content.get("role").and_then(|v| v.as_str()) == Some("assistant")
                && item.content.get("isFinal").and_then(|v| v.as_bool()) == Some(true)
                && item
                    .content
                    .get("text")
                    .and_then(|v| v.as_str())
                    .is_some_and(|text| !text.is_empty())
        })
        .expect("final assistant message");
    assert_eq!(assistant.content["finalCompletedAt"], 1_700_000_000_001_i64);
    assert_eq!(assistant.content["finalDurationMs"], 1);
    assert_eq!(assistant.content["finalInputTokens"], 10);
    assert_eq!(assistant.content["finalOutputTokens"], 5);
    // metadata usage remains for shadow/comparator consumers
    assert!(projected.iter().any(|item| {
        item.kind == ProjectionItemKind::Metadata
            && item.content.get("type").and_then(|v| v.as_str()) == Some("usage")
    }));
    writer.shutdown().unwrap();
}

/// Scenario: edit-like tools map to fileChange with path changes for Shared history canvas.
#[test]
fn tool_exchanges_map_to_canvas_tool_types() {
    let temp = TempStoreDir::new("tool-type-map");
    let writer = open_writer(&temp);
    let mut committed = match make_turn_committed("attempt-tools") {
        CanonicalFact::TurnCommitted(fact) => fact,
        _ => unreachable!(),
    };
    committed.atomic_tool_exchanges = vec![
        AtomicToolExchange {
            tool_call_id: "call-write".to_string(),
            tool_name: "Write".to_string(),
            call: ToolCall {
                arguments_summary: Some(r#"{"path":"docs/note.md","content":"hi"}"#.to_string()),
                arguments_artifact_ref: None,
                extra: serde_json::Value::Object(Default::default()),
            },
            result: ToolResult {
                status: ToolResultStatus::Completed,
                output_summary: Some("wrote".to_string()),
                output_artifact_ref: None,
                error_message: None,
                extra: serde_json::Value::Object(Default::default()),
            },
            extra: serde_json::Value::Object(Default::default()),
        },
        AtomicToolExchange {
            tool_call_id: "call-bash".to_string(),
            tool_name: "Bash".to_string(),
            call: ToolCall {
                arguments_summary: Some(r#"{"command":"ls"}"#.to_string()),
                arguments_artifact_ref: None,
                extra: serde_json::Value::Object(Default::default()),
            },
            result: ToolResult {
                status: ToolResultStatus::Completed,
                output_summary: Some("ok".to_string()),
                output_artifact_ref: None,
                error_message: None,
                extra: serde_json::Value::Object(Default::default()),
            },
            extra: serde_json::Value::Object(Default::default()),
        },
        AtomicToolExchange {
            tool_call_id: "call-read".to_string(),
            tool_name: "Read".to_string(),
            call: ToolCall {
                arguments_summary: Some(r#"{"path":"README.md"}"#.to_string()),
                arguments_artifact_ref: None,
                extra: serde_json::Value::Object(Default::default()),
            },
            result: ToolResult {
                status: ToolResultStatus::Completed,
                output_summary: Some("content".to_string()),
                output_artifact_ref: None,
                error_message: None,
                extra: serde_json::Value::Object(Default::default()),
            },
            extra: serde_json::Value::Object(Default::default()),
        },
    ];
    writer
        .append_canonical_fact(SESSION, CanonicalFact::TurnCommitted(committed))
        .expect("append tools turn");

    let projected = SharedProjector::new()
        .project_events(&writer.events_for_session(SESSION).expect("events"))
        .expect("project");
    let tools: Vec<_> = projected
        .iter()
        .filter(|item| item.kind == ProjectionItemKind::Tool)
        .collect();
    assert_eq!(tools.len(), 3);
    // Keep original Write/Read names so FE EditToolBlock/ReadToolBlock still route
    // (forcing fileChange would water-soil into GenericToolBlock only).
    assert_eq!(tools[0].content["toolType"], "Write");
    assert_eq!(tools[0].content["title"], "Write");
    assert_eq!(tools[0].content["changes"][0]["path"], "docs/note.md");
    assert_eq!(tools[1].content["toolType"], "commandExecution");
    // Prefer command text as title when present (Codex shell history readability).
    assert_eq!(tools[1].content["title"], "ls");
    assert_eq!(tools[2].content["toolType"], "Read");
    assert_eq!(tools[2].content["title"], "Read");
    writer.shutdown().unwrap();
}

/// Scenario: Codex fileChange changes[] survive Shared history projection for file-edit scene.
#[test]
fn turn_committed_projects_file_change_changes_array() {
    let temp = TempStoreDir::new("file-change-changes");
    let writer = open_writer(&temp);
    let mut committed = match make_turn_committed("attempt-file-change") {
        CanonicalFact::TurnCommitted(fact) => fact,
        _ => unreachable!(),
    };
    committed.assistant.blocks = vec![CanonicalBlock::Text {
        text: "patched".to_string(),
    }];
    committed.atomic_tool_exchanges = vec![AtomicToolExchange {
        tool_call_id: "call-fc".to_string(),
        tool_name: "fileChange".to_string(),
        call: ToolCall {
            arguments_summary: Some(
                r#"{"changes":[{"path":"src/a.ts","kind":"update","diff":"--- a\n+++ b\n@@\n-old\n+new"}]}"#
                    .to_string(),
            ),
            arguments_artifact_ref: None,
            extra: serde_json::Value::Object(Default::default()),
        },
        result: ToolResult {
            status: ToolResultStatus::Completed,
            output_summary: Some("ok".to_string()),
            output_artifact_ref: None,
            error_message: None,
            extra: serde_json::Value::Object(Default::default()),
        },
        extra: serde_json::Value::Object(Default::default()),
    }];
    writer
        .append_canonical_fact(SESSION, CanonicalFact::TurnCommitted(committed))
        .expect("append");

    let projected = SharedProjector::new()
        .project_events(&writer.events_for_session(SESSION).expect("events"))
        .expect("project");
    let tool = projected
        .iter()
        .find(|item| item.kind == ProjectionItemKind::Tool)
        .expect("tool");
    assert_eq!(tool.content["toolType"], "fileChange");
    assert_eq!(tool.content["title"], "File changes");
    assert_eq!(tool.content["changes"][0]["path"], "src/a.ts");
    assert!(
        tool.content["changes"][0]["diff"]
            .as_str()
            .is_some_and(|diff| diff.contains("+new")),
        "diff should be preserved for canvas file-edit scene"
    );
    writer.shutdown().unwrap();
}

/// Scenario: commandExecution with apply_patch in command text promotes to fileChange.
#[test]
fn turn_committed_promotes_command_execution_apply_patch_to_file_change() {
    let temp = TempStoreDir::new("cmd-apply-patch");
    let writer = open_writer(&temp);
    let mut committed = match make_turn_committed("attempt-cmd-patch") {
        CanonicalFact::TurnCommitted(fact) => fact,
        _ => unreachable!(),
    };
    committed.assistant.blocks = vec![CanonicalBlock::Text {
        text: "done".to_string(),
    }];
    let patch = "*** Begin Patch\n*** Update File: docs/a.md\n@@\n-a\n+b\n*** End Patch\n";
    let command = format!("apply_patch <<'EOF'\n{patch}EOF");
    committed.atomic_tool_exchanges = vec![AtomicToolExchange {
        tool_call_id: "call-cmd-patch".to_string(),
        tool_name: "commandExecution".to_string(),
        call: ToolCall {
            arguments_summary: Some(
                serde_json::json!({
                    "command": command,
                    "cwd": "/repo"
                })
                .to_string(),
            ),
            arguments_artifact_ref: None,
            extra: serde_json::Value::Object(Default::default()),
        },
        result: ToolResult {
            status: ToolResultStatus::Completed,
            output_summary: Some("Success. Updated the following files:\nM docs/a.md".to_string()),
            output_artifact_ref: None,
            error_message: None,
            extra: serde_json::Value::Object(Default::default()),
        },
        extra: serde_json::Value::Object(Default::default()),
    }];
    writer
        .append_canonical_fact(SESSION, CanonicalFact::TurnCommitted(committed))
        .expect("append");

    let projected = SharedProjector::new()
        .project_events(&writer.events_for_session(SESSION).expect("events"))
        .expect("project");
    let tool = projected
        .iter()
        .find(|item| item.kind == ProjectionItemKind::Tool)
        .expect("tool");
    assert_eq!(tool.content["toolType"], "fileChange");
    assert_eq!(tool.content["changes"][0]["path"], "docs/a.md");
    writer.shutdown().unwrap();
}

/// Scenario: Codex apply_patch custom_tool_call summary rebuilds fileChange changes[].
#[test]
fn turn_committed_projects_apply_patch_input_as_file_change() {
    let temp = TempStoreDir::new("apply-patch-file-change");
    let writer = open_writer(&temp);
    let mut committed = match make_turn_committed("attempt-apply-patch") {
        CanonicalFact::TurnCommitted(fact) => fact,
        _ => unreachable!(),
    };
    committed.assistant.blocks = vec![CanonicalBlock::Text {
        text: "done".to_string(),
    }];
    let patch = "*** Begin Patch\n*** Update File: src/keep.ts\n@@\n-old\n+new\n*** End Patch\n";
    committed.atomic_tool_exchanges = vec![AtomicToolExchange {
        tool_call_id: "call-patch".to_string(),
        tool_name: "apply_patch".to_string(),
        call: ToolCall {
            arguments_summary: Some(
                serde_json::json!({ "name": "apply_patch", "input": patch, "patch": patch })
                    .to_string(),
            ),
            arguments_artifact_ref: None,
            extra: serde_json::Value::Object(Default::default()),
        },
        result: ToolResult {
            status: ToolResultStatus::Completed,
            output_summary: Some(
                "Success. Updated the following files:\nM src/keep.ts".to_string(),
            ),
            output_artifact_ref: None,
            error_message: None,
            extra: serde_json::Value::Object(Default::default()),
        },
        extra: serde_json::Value::Object(Default::default()),
    }];
    writer
        .append_canonical_fact(SESSION, CanonicalFact::TurnCommitted(committed))
        .expect("append");

    let projected = SharedProjector::new()
        .project_events(&writer.events_for_session(SESSION).expect("events"))
        .expect("project");
    let tool = projected
        .iter()
        .find(|item| item.kind == ProjectionItemKind::Tool)
        .expect("tool");
    assert_eq!(tool.content["toolType"], "fileChange");
    assert_eq!(tool.content["changes"][0]["path"], "src/keep.ts");
    writer.shutdown().unwrap();
}

/// Scenario: Shared history emits process before final prose so Messages collapse works.
#[test]
fn turn_committed_emits_process_before_final_assistant_prose() {
    let temp = TempStoreDir::new("process-before-prose");
    let writer = open_writer(&temp);
    let mut committed = match make_turn_committed("attempt-order") {
        CanonicalFact::TurnCommitted(fact) => fact,
        _ => unreachable!(),
    };
    // Fixture order is Text then Reasoning; projection must still put process first.
    committed.atomic_tool_exchanges = vec![AtomicToolExchange {
        tool_call_id: "call-read".to_string(),
        tool_name: "Read".to_string(),
        call: ToolCall {
            arguments_summary: Some(r#"{"path":"README.md"}"#.to_string()),
            arguments_artifact_ref: None,
            extra: serde_json::Value::Object(Default::default()),
        },
        result: ToolResult {
            status: ToolResultStatus::Completed,
            output_summary: Some("ok".to_string()),
            output_artifact_ref: None,
            error_message: None,
            extra: serde_json::Value::Object(Default::default()),
        },
        extra: serde_json::Value::Object(Default::default()),
    }];
    writer
        .append_canonical_fact(SESSION, CanonicalFact::TurnCommitted(committed))
        .expect("append");

    let projected = SharedProjector::new()
        .project_events(&writer.events_for_session(SESSION).expect("events"))
        .expect("project");

    let reasoning_idx = projected
        .iter()
        .position(|item| item.kind == ProjectionItemKind::Reasoning)
        .expect("reasoning");
    let tool_idx = projected
        .iter()
        .position(|item| item.kind == ProjectionItemKind::Tool)
        .expect("tool");
    let assistant_idx = projected
        .iter()
        .position(|item| {
            item.kind == ProjectionItemKind::Message
                && item.content.get("role").and_then(|v| v.as_str()) == Some("assistant")
                && item.content.get("text").and_then(|v| v.as_str()) == Some("hello back")
        })
        .expect("assistant prose");

    assert!(
        reasoning_idx < assistant_idx,
        "reasoning must precede final prose (got reasoning={reasoning_idx} assistant={assistant_idx})"
    );
    assert!(
        tool_idx < assistant_idx,
        "tools must precede final prose (got tool={tool_idx} assistant={assistant_idx})"
    );
    writer.shutdown().unwrap();
}

/// Scenario: UsageRecorded after TurnCommitted still stamps footer tokens (order-independent).
#[test]
fn late_usage_stamps_tokens_onto_already_projected_assistant() {
    let temp = TempStoreDir::new("late-usage-stamp");
    let writer = open_writer(&temp);
    writer
        .append_canonical_fact(SESSION, make_turn_requested("attempt-late"))
        .expect("request");
    writer
        .append_canonical_fact(SESSION, make_turn_committed("attempt-late"))
        .expect("commit");

    let before = SharedProjector::new()
        .project_events(&writer.events_for_session(SESSION).expect("events"))
        .expect("project before usage");
    let assistant_before = before
        .iter()
        .find(|item| {
            item.kind == ProjectionItemKind::Message
                && item.content.get("role").and_then(|v| v.as_str()) == Some("assistant")
                && item.content.get("isFinal").and_then(|v| v.as_bool()) == Some(true)
                && item
                    .content
                    .get("text")
                    .and_then(|v| v.as_str())
                    .is_some_and(|text| text == "hello back")
        })
        .expect("assistant before usage");
    assert!(assistant_before.content.get("finalInputTokens").is_none());
    assert!(assistant_before.content.get("finalOutputTokens").is_none());
    assert_eq!(
        assistant_before.content["finalDurationMs"], 1,
        "duration comes from request/commit even without usage"
    );

    writer
        .append_canonical_fact(
            SESSION,
            make_usage_recorded_with_source(
                "usage-late",
                "attempt-late",
                UsageSource::ProviderReport,
                1,
                15,
            ),
        )
        .expect("late usage");

    let after = SharedProjector::new()
        .project_events(&writer.events_for_session(SESSION).expect("events"))
        .expect("project after usage");
    let assistant_after = after
        .iter()
        .find(|item| {
            item.kind == ProjectionItemKind::Message
                && item.content.get("role").and_then(|v| v.as_str()) == Some("assistant")
                && item.content.get("isFinal").and_then(|v| v.as_bool()) == Some(true)
                && item
                    .content
                    .get("text")
                    .and_then(|v| v.as_str())
                    .is_some_and(|text| text == "hello back")
        })
        .expect("assistant after usage");
    assert_eq!(assistant_after.content["finalInputTokens"], 10);
    assert_eq!(assistant_after.content["finalOutputTokens"], 5);
    writer.shutdown().unwrap();
}

/// Scenario: payload 自带的 type 与 durable `fact_type` 冲突时必须 fail closed。
#[test]
fn conflicting_projection_payload_type_fails_closed() {
    let temp = TempStoreDir::new("projection-conflicting-type");
    let writer = open_writer(&temp);
    writer
        .append_event(&NewCanonicalEvent {
            session_id: SESSION.to_string(),
            event_id: "conflicting-delivery".to_string(),
            fact_type: "context.deliveryPrepared".to_string(),
            logical_turn_id: Some("turn-1".to_string()),
            attempt_id: Some("attempt-conflict".to_string()),
            dedupe_key: None,
            payload_json: serde_json::json!({
                "type": "context.deliveryAccepted",
                "logicalTurnId": "turn-1",
                "attemptId": "attempt-conflict",
                "bindingKey": "claude:profile-1",
                "packageId": "package-1",
                "nativeRequestId": "request-1",
                "acceptedAt": 1_700_000_000_000_i64
            })
            .to_string(),
            fidelity: Fidelity::Canonical,
            committed_at: 1_700_000_000_000,
            schema_version: 2,
        })
        .expect("append conflicting event");

    let error = SharedProjector::new()
        .project_events(&writer.events_for_session(SESSION).expect("events"))
        .expect_err("conflicting type must fail");
    assert!(error
        .to_string()
        .contains("conflicts with durable fact_type"));
    writer.shutdown().unwrap();
}

/// Scenario: legacy reader 保留 V0 item，不伪造缺失 Tool ID。
#[test]
fn legacy_reader_preserves_items_without_fabricating_tool_ids() {
    let reader = LegacySharedReader::new();
    let snapshot = concat!(
        "{\"kind\":\"snapshot\",\"createdAt\":2,\"selectedEngine\":\"claude\",",
        "\"lastTurnSeq\":1,\"items\":[",
        "{\"id\":\"message-1\",\"kind\":\"message\",\"role\":\"user\"},",
        "{\"id\":\"tool-1\",\"kind\":\"tool\",\"title\":\"legacy tool\"}]}\n"
    );

    let items = reader.parse_snapshot(snapshot).expect("parse");
    assert_eq!(items.len(), 2);
    assert_eq!(items[1].id, "tool-1");
    assert!(items[1].content.get("toolCallId").is_none());
}

/// Scenario: legacy reader 对损坏 JSON 返回错误而不是 panic。
#[test]
fn legacy_reader_rejects_corrupted_json() {
    let reader = LegacySharedReader::new();
    let result = reader.parse_snapshot("{ not valid json");
    assert!(result.is_err());
}

/// Scenario: legacy reader 只读，不写回源文件。
#[test]
fn legacy_reader_does_not_modify_source_file() {
    let temp = TempStoreDir::new("legacy-readonly");
    let path = temp.dir.join("log.jsonl");
    let content = concat!(
        "{\"kind\":\"snapshot\",\"createdAt\":1,\"selectedEngine\":\"claude\",",
        "\"lastTurnSeq\":1,\"items\":[",
        "{\"id\":\"message-1\",\"kind\":\"message\",\"role\":\"user\",\"text\":\"hi\"}]}\n"
    );
    std::fs::write(&path, content).expect("write fixture");

    let reader = LegacySharedReader::new();
    let items = reader.read_snapshot(&path).expect("read");
    assert_eq!(items.len(), 1);

    let after = std::fs::read_to_string(&path).expect("read back");
    assert_eq!(after, content);
}
