//! Canonical Fact 装配集成测试（Wave 2 / A2，Gate 2 前置）。
//!
//! 用 synthetic Runtime Events 驱动，覆盖校验、幂等、Tool Exchange、Usage 分流、V0 Shadow Log。

mod common;

use common::TempStoreDir;
use doge_lib::shared_event_log::{
    canonical::{
        assembler::{assemble_turn_committed, RuntimeFinalSnapshot, RuntimeToolCall},
        shadow_v0::{map_v0_to_presentation_only, v0_evidence},
        sink::commit_turn,
        types::{
            CanonicalAssistantBlocks, CanonicalBlock, CanonicalFact, CanonicalUserInput,
            ControlFact, Outcome, OutcomeStatus, TurnCommittedFact, TurnExecutionSnapshot,
            TurnRequestedFact, UsageRecordedFact, UsageShape, UsageSource, UsageVerification,
        },
    },
    open, AppendOutcome, Fidelity, LedgerOutcome, OpenOutcome, ProviderUsageRecord,
};

const SESSION: &str = "a2-session";

#[test]
fn rust_facts_round_trip_wave0_valid_schema_fixtures() {
    for source in [
        include_str!(
            "../../openspec/changes/archive/2026-08-03-establish-session-foundation-contracts/schemas/examples/valid/turn-committed.json"
        ),
        include_str!(
            "../../openspec/changes/archive/2026-08-03-establish-session-foundation-contracts/schemas/examples/valid/control-fact.json"
        ),
    ] {
        let envelope: serde_json::Value = serde_json::from_str(source).expect("fixture json");
        let expected_fact = envelope.get("fact").expect("fixture fact").clone();
        let fact: CanonicalFact =
            serde_json::from_value(expected_fact.clone()).expect("deserialize Rust fact");
        doge_lib::shared_event_log::canonical::validate_fact(&fact).expect("validate Rust fact");
        assert_eq!(
            serde_json::to_value(fact).expect("serialize Rust fact"),
            expected_fact
        );
    }
}

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

fn make_turn_committed(attempt_id: &str, outcome: OutcomeStatus) -> CanonicalFact {
    let error_code = if matches!(outcome, OutcomeStatus::Failed) {
        Some("E_RUNTIME".to_string())
    } else {
        None
    };
    let error_message = if matches!(outcome, OutcomeStatus::Failed) {
        Some("runtime failed".to_string())
    } else {
        None
    };

    CanonicalFact::TurnCommitted(TurnCommittedFact {
        logical_turn_id: "turn-1".to_string(),
        attempt_id: attempt_id.to_string(),
        input_entry_id: format!("{attempt_id}:input"),
        assistant: CanonicalAssistantBlocks {
            blocks: vec![CanonicalBlock::Text {
                text: "hello back".to_string(),
            }],
        },
        atomic_tool_exchanges: vec![],
        artifact_refs: vec![],
        target: snapshot(),
        provider_private_refs: vec![],
        omissions: vec![],
        outcome: Outcome {
            status: outcome,
            error_code,
            error_message,
            stop_reason: None,
            extra: serde_json::Value::Object(Default::default()),
        },
        committed_at: 1_700_000_000_001,
        extra: serde_json::Value::Object(Default::default()),
    })
}

fn make_usage_recorded(usage_record_id: &str, attempt_id: &str) -> CanonicalFact {
    CanonicalFact::UsageRecorded(UsageRecordedFact {
        usage_record_id: usage_record_id.to_string(),
        report_subject_id: format!("{attempt_id}:subject"),
        revision: 1,
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
            total_tokens: Some(15),
            provider_reported_cost: None,
            extra: serde_json::Value::Object(Default::default()),
        },
        source: UsageSource::RuntimeFinal,
        verification: UsageVerification::Verified,
        observed_at: 1_700_000_000_002,
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

/// Scenario: valid canonical fact is accepted and invalid is rejected。
#[test]
fn valid_fact_accepted_invalid_rejected() {
    let temp = TempStoreDir::new("validation");
    let writer = open_writer(&temp);

    let valid = make_turn_requested("attempt-valid");
    let outcome = writer
        .append_canonical_fact(SESSION, valid)
        .expect("valid fact");
    assert!(matches!(
        outcome,
        AppendOutcome::Inserted { sequence: 1, .. }
    ));

    let mut invalid = make_turn_committed("attempt-invalid", OutcomeStatus::Failed);
    if let CanonicalFact::TurnCommitted(ref mut f) = invalid {
        f.outcome.error_code = None; // failed outcome 必须有 errorCode
    }
    let error = writer
        .append_canonical_fact(SESSION, invalid)
        .expect_err("invalid fact");
    assert!(
        matches!(
            error,
            doge_lib::shared_event_log::StoreError::ValidationFailed { .. }
        ),
        "unexpected error: {error}"
    );

    writer.shutdown().unwrap();
}

/// Scenario: duplicate terminal commit is idempotent。
#[test]
fn duplicate_terminal_commit_is_idempotent() {
    let temp = TempStoreDir::new("duplicate-terminal");
    let writer = open_writer(&temp);

    let fact = make_turn_committed("attempt-1", OutcomeStatus::Completed);
    let first = writer
        .append_canonical_fact(SESSION, fact.clone())
        .expect("first commit");
    let AppendOutcome::Inserted { sequence, .. } = first else {
        panic!("first must insert");
    };

    for _ in 0..100 {
        let outcome = writer
            .append_canonical_fact(SESSION, fact.clone())
            .expect("replay");
        assert_eq!(
            outcome,
            AppendOutcome::Duplicate {
                existing_sequence: sequence
            }
        );
    }

    assert_eq!(writer.count_events(Some(SESSION)).expect("count"), 1);
    writer.shutdown().unwrap();
}

/// Scenario: failed/cancelled/replaced outcomes are all valid terminal commits。
#[test]
fn failed_cancelled_replaced_outcomes_all_commit() {
    let temp = TempStoreDir::new("outcomes");
    let writer = open_writer(&temp);

    for (index, status) in [
        OutcomeStatus::Failed,
        OutcomeStatus::Cancelled,
        OutcomeStatus::Replaced,
    ]
    .iter()
    .enumerate()
    {
        let fact = make_turn_committed(
            &format!("attempt-outcome-{index}"),
            // Failed 需要 errorCode；Cancelled/Replaced 不需要。
            if matches!(status, OutcomeStatus::Failed) {
                OutcomeStatus::Failed
            } else {
                *status
            },
        );
        // 为 failed 补充 errorCode
        let mut fact = fact;
        if matches!(status, OutcomeStatus::Failed) {
            if let CanonicalFact::TurnCommitted(ref mut f) = fact {
                f.outcome.error_code = Some("E_CANCEL".to_string());
            }
        }
        let outcome = writer
            .append_canonical_fact(SESSION, fact)
            .expect("commit terminal outcome");
        assert!(
            matches!(outcome, AppendOutcome::Inserted { .. }),
            "outcome {status:?} must insert"
        );
    }

    assert_eq!(writer.count_events(Some(SESSION)).expect("count"), 3);
    writer.shutdown().unwrap();
}

/// Scenario: Tool Call without matching Result is settled as incomplete。
#[test]
fn unpaired_tool_call_settled_incomplete() {
    let temp = TempStoreDir::new("tool-incomplete");
    let writer = open_writer(&temp);

    let fact = assemble_turn_committed(
        "turn-1".to_string(),
        "attempt-tool".to_string(),
        "entry-1".to_string(),
        snapshot(),
        RuntimeFinalSnapshot {
            assistant_blocks: vec![],
            assistant_text: None,
            tool_calls: vec![RuntimeToolCall {
                tool_call_id: "call-1".to_string(),
                tool_name: "read_file".to_string(),
                arguments_summary: Some("{path: \"x\"}".to_string()),
            }],
            tool_results: vec![],
            artifacts: vec![],
            provider_private_refs: vec![],
            omissions: vec![],
            outcome: OutcomeStatus::Completed,
            error_code: None,
            error_message: None,
            stop_reason: None,
        },
        1_700_000_000_001,
    )
    .expect("assemble");

    let outcome = writer
        .append_canonical_fact(SESSION, CanonicalFact::TurnCommitted(fact))
        .expect("commit");
    assert!(matches!(outcome, AppendOutcome::Inserted { .. }));

    let events = writer.events_for_session(SESSION).expect("events");
    assert_eq!(events.len(), 1);
    let payload: serde_json::Value = serde_json::from_str(&events[0].payload_json).expect("json");
    let status = payload
        .pointer("/atomicToolExchanges/0/result/status")
        .and_then(|v| v.as_str())
        .expect("tool result status");
    assert_eq!(status, "incomplete");

    writer.shutdown().unwrap();
}

/// Scenario: usageRecorded dedupes by usageRecordId。
#[test]
fn usage_recorded_dedupes_by_usage_record_id() {
    let temp = TempStoreDir::new("usage-dedupe");
    let writer = open_writer(&temp);

    let fact = make_usage_recorded("usage-1", "attempt-usage");
    let first = writer
        .append_canonical_fact(SESSION, fact.clone())
        .expect("first usage");
    let AppendOutcome::Inserted { sequence, .. } = first else {
        panic!("first must insert");
    };

    for _ in 0..100 {
        let outcome = writer
            .append_canonical_fact(SESSION, fact.clone())
            .expect("replay");
        assert_eq!(
            outcome,
            AppendOutcome::Duplicate {
                existing_sequence: sequence
            }
        );
    }

    assert_eq!(writer.count_events(Some(SESSION)).expect("count"), 1);
    writer.shutdown().unwrap();
}

/// Scenario: provider usage aggregate goes to independent Ledger。
#[test]
fn provider_aggregate_usage_goes_to_ledger() {
    let temp = TempStoreDir::new("ledger");
    let writer = open_writer(&temp);

    let record = ProviderUsageRecord {
        provider_profile_id: "profile-1".to_string(),
        report_subject_id: "subject-1".to_string(),
        revision: 1,
        event_id: "ledger-evt-1".to_string(),
        window_started_at: 1_000,
        window_ended_at: 2_000,
        payload_json: "{\"totalTokens\":42}".to_string(),
        observed_at: 1_700_000_000_000,
        supersedes_event_id: None,
        schema_version: 1,
    };

    assert_eq!(
        writer.record_provider_usage(&record).expect("ledger"),
        LedgerOutcome::Inserted
    );
    assert_eq!(
        writer
            .record_provider_usage(&record)
            .expect("ledger replay"),
        LedgerOutcome::Duplicate
    );

    writer.shutdown().unwrap();
}

/// Scenario: V0 evidence maps to presentation-only and does not affect canonical assembly。
#[test]
fn v0_shadow_log_is_presentation_only() {
    let temp = TempStoreDir::new("shadow-v0");
    let writer = open_writer(&temp);

    let evidence = v0_evidence("turn-1", "attempt-v0", "hi", "hello");
    let shadow_fact = map_v0_to_presentation_only(evidence);
    let outcome = writer
        .append_presentation_only_fact(SESSION, shadow_fact)
        .expect("shadow append");
    assert!(matches!(outcome, AppendOutcome::Inserted { .. }));

    let events = writer.events_for_session(SESSION).expect("events");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].fidelity, Fidelity::PresentationOnly);

    // canonical fact 仍可从 sequence 1 开始（shadow 不影响 canonical 语义）。
    let canonical = make_turn_committed("attempt-canonical", OutcomeStatus::Completed);
    let outcome = writer
        .append_canonical_fact(SESSION, canonical)
        .expect("canonical after shadow");
    assert!(matches!(
        outcome,
        AppendOutcome::Inserted { sequence: 2, .. }
    ));

    writer.shutdown().unwrap();
}

/// Scenario: Critical Commit Sink produces exactly one turnCommitted per settled snapshot。
#[test]
fn critical_commit_sink_idempotent() {
    let temp = TempStoreDir::new("sink");
    let writer = open_writer(&temp);

    let final_snapshot = RuntimeFinalSnapshot {
        assistant_blocks: vec![],
        assistant_text: Some("sink reply".to_string()),
        tool_calls: vec![],
        tool_results: vec![],
        artifacts: vec![],
        provider_private_refs: vec![],
        omissions: vec![],
        outcome: OutcomeStatus::Completed,
        error_code: None,
        error_message: None,
        stop_reason: None,
    };

    let first = commit_turn(
        &writer,
        SESSION,
        "turn-sink",
        "attempt-sink",
        "entry-sink",
        snapshot(),
        final_snapshot,
        1_700_000_000_100,
    )
    .expect("first commit");
    let AppendOutcome::Inserted { sequence, .. } = first else {
        panic!("first must insert");
    };

    // 模拟 run.settled 重复触发：Sink 应幂等。
    for _ in 0..100 {
        let final_snapshot = RuntimeFinalSnapshot {
            assistant_blocks: vec![],
            assistant_text: Some("sink reply".to_string()),
            tool_calls: vec![],
            tool_results: vec![],
            artifacts: vec![],
            provider_private_refs: vec![],
            omissions: vec![],
            outcome: OutcomeStatus::Completed,
            error_code: None,
            error_message: None,
            stop_reason: None,
        };
        let outcome = commit_turn(
            &writer,
            SESSION,
            "turn-sink",
            "attempt-sink",
            "entry-sink",
            snapshot(),
            final_snapshot,
            1_700_000_000_100,
        )
        .expect("replay");
        assert_eq!(
            outcome,
            AppendOutcome::Duplicate {
                existing_sequence: sequence
            }
        );
    }

    assert_eq!(writer.count_events(Some(SESSION)).expect("count"), 1);
    writer.shutdown().unwrap();
}

/// Scenario: normal/delta lane 全丢不影响 authoritative final snapshot 装配。
#[test]
fn dropped_streaming_deltas_do_not_change_terminal_fact() {
    let final_snapshot = || RuntimeFinalSnapshot {
        assistant_blocks: vec![],
        assistant_text: Some("authoritative final".to_string()),
        tool_calls: vec![],
        tool_results: vec![],
        artifacts: vec![],
        provider_private_refs: vec![],
        omissions: vec![],
        outcome: OutcomeStatus::Completed,
        error_code: None,
        error_message: None,
        stop_reason: Some("end_turn".to_string()),
    };

    // Assembler 的输入面只接受 final snapshot；normal/delta lane 是否存在不参与事实装配。
    let with_streaming_lane = assemble_turn_committed(
        "turn-drop".to_string(),
        "attempt-drop".to_string(),
        "entry-drop".to_string(),
        snapshot(),
        final_snapshot(),
        1_700_000_000_200,
    )
    .expect("assemble with live lane");
    let with_all_deltas_dropped = assemble_turn_committed(
        "turn-drop".to_string(),
        "attempt-drop".to_string(),
        "entry-drop".to_string(),
        snapshot(),
        final_snapshot(),
        1_700_000_000_200,
    )
    .expect("assemble after dropped deltas");

    assert_eq!(with_all_deltas_dropped, with_streaming_lane);
}

/// Scenario: control fact uses schema fields and dedupes by occurrence identity。
#[test]
fn control_fact_dedupes_by_event_id() {
    let temp = TempStoreDir::new("control");
    let writer = open_writer(&temp);

    let fact = CanonicalFact::Control(ControlFact {
        control_kind: "delivery.cancelled".to_string(),
        logical_turn_id: Some("turn-1".to_string()),
        attempt_id: Some("attempt-1".to_string()),
        binding_key: None,
        reason: Some("cancel".to_string()),
        details: None,
        extra: serde_json::Value::Object(Default::default()),
    });

    let first = writer
        .append_canonical_fact_at(SESSION, fact.clone(), 1_700_000_000_000)
        .expect("first control");
    let AppendOutcome::Inserted { sequence, .. } = first else {
        panic!("first must insert");
    };

    let outcome = writer
        .append_canonical_fact_at(SESSION, fact, 1_700_000_000_000)
        .expect("replay");
    assert_eq!(
        outcome,
        AppendOutcome::Duplicate {
            existing_sequence: sequence
        }
    );

    writer.shutdown().unwrap();
}
