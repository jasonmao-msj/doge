//! Canvas 防回归门禁（Wave 3 / A3.5，§17.6）。
//!
//! 四条硬门禁在 Rust 侧的代理验证：
//! 1. Native golden fixtures 不被 Shared projector 消费（Shared/Native 隔离，不伪造事实）
//! 2. 重复 commit 事件不产生重复 Assistant Final（写入幂等 → 投影唯一）
//! 3. rebuild 输出逐字节一致（数据源零抖动，无 render storm 输入）
//! 4. 不同 engine target 的 session 投影互不串扰（target switch 安全）

mod common;

use std::fs;
use std::path::PathBuf;

use common::TempStoreDir;
use doge_lib::shared_event_log::canonical::types::{
    CanonicalAssistantBlocks, CanonicalBlock, CanonicalFact, CanonicalUserInput, Outcome,
    OutcomeStatus, TurnCommittedFact, TurnExecutionSnapshot, TurnRequestedFact,
};
use doge_lib::shared_event_log::{open, AppendOutcome, OpenOutcome};
use doge_lib::shared_projection::SharedProjector;

fn snapshot(engine: &str) -> TurnExecutionSnapshot {
    TurnExecutionSnapshot {
        engine: engine.to_string(),
        provider_profile_id: Some("profile-1".to_string()),
        model_catalog_entry_id: None,
        model: Some("model-1".to_string()),
        reasoning: None,
        provider_profile_name_snapshot: None,
        provider_profile_source: None,
        runtime_capability_fingerprint: None,
        extra: serde_json::Value::Object(Default::default()),
    }
}

fn make_turn_requested(attempt_id: &str, engine: &str) -> CanonicalFact {
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
        target: snapshot(engine),
        requested_at: 1_700_000_000_000,
        extra: serde_json::Value::Object(Default::default()),
    })
}

fn make_turn_committed(attempt_id: &str, engine: &str) -> CanonicalFact {
    CanonicalFact::TurnCommitted(TurnCommittedFact {
        logical_turn_id: "turn-1".to_string(),
        attempt_id: attempt_id.to_string(),
        input_entry_id: format!("{attempt_id}:input"),
        assistant: CanonicalAssistantBlocks {
            blocks: vec![CanonicalBlock::Text {
                text: "final answer".to_string(),
            }],
        },
        atomic_tool_exchanges: vec![],
        artifact_refs: vec![],
        target: snapshot(engine),
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

fn open_writer(temp: &TempStoreDir) -> doge_lib::shared_event_log::SharedEventWriter {
    match open(&temp.db_path).expect("open shared event store") {
        OpenOutcome::Ready(writer) => writer,
        OpenOutcome::ReadOnlyRecovery { .. } => panic!("fresh db must be ready"),
    }
}

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("session-foundation")
}

/// 硬门禁 1：Native golden fixtures 不会被 Shared projector 当作 Canonical Fact 消费。
///
/// Shared projector 对无法解析为 CanonicalFact 的 payload 一律跳过；
/// 这里直接断言四套 Native fixture 的每一行都不是合法 CanonicalFact，
/// 从数据源层面保证 Native 原始事件永远不会被伪造为 Shared 投影项。
#[test]
fn native_golden_fixtures_are_not_consumed_as_canonical_facts() {
    for file in [
        "claude-live-events.ndjson",
        "claude-native-history.jsonl",
        "codex-live-events.ndjson",
        "codex-native-history.jsonl",
    ] {
        let path = fixtures_dir().join(file);
        let contents = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("Failed to read {path:?}: {error}"));
        let mut line_count = 0usize;
        for (index, line) in contents.lines().enumerate() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            line_count += 1;
            assert!(
                serde_json::from_str::<CanonicalFact>(trimmed).is_err(),
                "{file} line {} unexpectedly parses as CanonicalFact（Shared/Native 隔离被破坏）",
                index + 1
            );
        }
        assert!(line_count > 0, "{file} must not be empty");
    }
}

/// 硬门禁 2：重复 replay 的 turnCommitted 不产生重复 Assistant Final。
#[test]
fn duplicate_terminal_facts_yield_single_assistant_final() {
    let temp = TempStoreDir::new("canvas-no-dup-final");
    let writer = open_writer(&temp);
    let session = "canvas-dedupe";

    writer
        .append_canonical_fact(session, make_turn_requested("attempt-1", "claude"))
        .expect("append requested");

    // 终端 fact 幂等：同一 turnCommitted 重放 50 次只落盘一次。
    for _ in 0..50 {
        writer
            .append_canonical_fact(session, make_turn_committed("attempt-1", "claude"))
            .expect("append committed");
    }

    let events = writer.events_for_session(session).expect("events");
    assert_eq!(events.len(), 2);

    let projector = SharedProjector::new();
    let items = projector.project_events(&events).expect("project");
    let assistant_finals = items
        .iter()
        .filter(|item| item.content.get("role").and_then(|r| r.as_str()) == Some("assistant"))
        .count();
    assert_eq!(assistant_finals, 1, "must not duplicate Assistant Final");

    writer.shutdown().unwrap();
}

/// 硬门禁 3：rebuild 输出逐字节一致（数据源零抖动）。
#[test]
fn rebuild_output_is_byte_identical_across_runs() {
    let temp = TempStoreDir::new("canvas-determinism");
    let writer = open_writer(&temp);
    let session = "canvas-determinism";

    for fact in [
        make_turn_requested("attempt-1", "claude"),
        make_turn_committed("attempt-1", "claude"),
    ] {
        let outcome = writer.append_canonical_fact(session, fact).expect("append");
        assert!(matches!(outcome, AppendOutcome::Inserted { .. }));
    }

    let projector = SharedProjector::new();
    let first = projector
        .rebuild(&writer, session, "canvas", 1)
        .expect("rebuild 1");
    let second = projector
        .rebuild(&writer, session, "canvas", 1)
        .expect("rebuild 2");

    let first_json = serde_json::to_string(&first).expect("serialize first");
    let second_json = serde_json::to_string(&second).expect("serialize second");
    assert_eq!(
        first_json, second_json,
        "rebuild output must be byte-identical"
    );

    writer.shutdown().unwrap();
}

/// 硬门禁 4：不同 engine target 的 session 投影互不串扰。
#[test]
fn projections_for_different_engine_targets_do_not_cross_contaminate() {
    let temp = TempStoreDir::new("canvas-targets");
    let writer = open_writer(&temp);

    writer
        .append_canonical_fact("session-claude", make_turn_committed("attempt-c", "claude"))
        .expect("append claude");
    writer
        .append_canonical_fact("session-codex", make_turn_committed("attempt-x", "codex"))
        .expect("append codex");

    let projector = SharedProjector::new();
    let claude_items = projector
        .project_events(
            &writer
                .events_for_session("session-claude")
                .expect("claude events"),
        )
        .expect("project claude");
    let codex_items = projector
        .project_events(
            &writer
                .events_for_session("session-codex")
                .expect("codex events"),
        )
        .expect("project codex");

    assert_eq!(claude_items.len(), 1);
    assert_eq!(codex_items.len(), 1);
    assert_eq!(
        claude_items[0]
            .content
            .get("engineSource")
            .and_then(|v| v.as_str()),
        Some("claude")
    );
    assert_eq!(
        codex_items[0]
            .content
            .get("engineSource")
            .and_then(|v| v.as_str()),
        Some("codex")
    );

    writer.shutdown().unwrap();
}
