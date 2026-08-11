//! Shared Event Storage 单元级集成测试（Wave 1 / A1，Gate 1 测试矩阵）。
//!
//! 覆盖 spec `shared-event-storage` 的 Requirement/Scenario：
//! - sequence 分配与 event insert 同事务原子提交 / 单调 / 回滚；
//! - 三条幂等路径 ×100；
//! - usage 例外（usageRecordId 去重）；
//! - Provider Usage Ledger 幂等与 supersede 链；
//! - checksum 跨生产者稳定；
//! - migration 幂等 / 六表存在；
//! - 损坏恢复 read-only / 缺失新建。

mod common;

use common::TempStoreDir;
use doge_lib::shared_event_log::{
    open, AppendOutcome, BindingStateUpdate, Fidelity, LedgerOutcome, NewCanonicalEvent,
    OpenOutcome, ProviderUsageRecord, SessionTargetUpdate, SharedEventWriter, StoreError,
    USAGE_FACT_TYPE,
};

const SESSION: &str = "session-a";

fn open_writer(path: &std::path::Path) -> Result<SharedEventWriter, StoreError> {
    match open(path)? {
        OpenOutcome::Ready(writer) => Ok(writer),
        OpenOutcome::ReadOnlyRecovery { reason, .. } => Err(StoreError::Corruption {
            detail: reason.to_string(),
        }),
    }
}

fn make_event(session_id: &str, event_id: &str) -> NewCanonicalEvent {
    NewCanonicalEvent {
        session_id: session_id.to_string(),
        event_id: event_id.to_string(),
        fact_type: "turn.userMessage".to_string(),
        logical_turn_id: None,
        attempt_id: None,
        dedupe_key: None,
        payload_json: "{\"text\":\"hello\"}".to_string(),
        fidelity: Fidelity::Canonical,
        committed_at: 1_700_000_000_000,
        schema_version: 1,
    }
}

fn make_binding(session_id: &str, binding_key: &str) -> BindingStateUpdate {
    BindingStateUpdate {
        session_id: session_id.to_string(),
        binding_key: binding_key.to_string(),
        engine: "claude".to_string(),
        provider_profile_id: Some("profile-1".to_string()),
        native_session_id: Some("native-1".to_string()),
        accepted_through_sequence: None,
        committed_through_sequence: None,
        provisioning_json: None,
        pending_delivery_json: None,
        availability: "available".to_string(),
        updated_at: 1_700_000_000_000,
    }
}

fn make_ledger_record(
    revision: i64,
    event_id: &str,
    supersedes: Option<&str>,
) -> ProviderUsageRecord {
    ProviderUsageRecord {
        provider_profile_id: "profile-1".to_string(),
        report_subject_id: "subject-1".to_string(),
        revision,
        event_id: event_id.to_string(),
        window_started_at: 1_000,
        window_ended_at: 2_000,
        payload_json: "{\"totalTokens\":42}".to_string(),
        observed_at: 1_700_000_000_000,
        supersedes_event_id: supersedes.map(str::to_string),
        schema_version: 1,
    }
}

/// Scenario: repeated open is stable（migration 幂等 + 六表存在）。
#[test]
fn repeated_open_is_stable_and_idempotent() {
    let temp = TempStoreDir::new("migration");
    let first_version = {
        let store = open_writer(&temp.db_path).expect("first open");
        let version = store.user_version().expect("user_version");
        assert!(
            version > 0,
            "migrated schema must have a positive user_version"
        );
        version
    };
    // 重复 open 不报错、user_version 保持在首次迁移后的 current version。
    let store = open_writer(&temp.db_path).expect("second open");
    assert_eq!(store.user_version().expect("user_version"), first_version);

    // 六表存在性经 store 行为间接验证：六张表任意缺失都会让对应读写报错。
    // 这里显式核对 sqlite_master，锁定 spec 列出的六个表名。
    let conn = rusqlite::Connection::open(&temp.db_path).expect("raw connection");
    for table in [
        "shared_sessions_v2",
        "shared_event_log",
        "shared_binding_state",
        "shared_projection_checkpoint",
        "shared_legacy_import",
        "provider_usage_aggregate_log",
    ] {
        let exists: bool = conn
            .query_row(
                "SELECT count(*) > 0 FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |row| row.get(0),
            )
            .expect("table lookup");
        assert!(exists, "missing table {table}");
    }
}

/// Scenario: sequence allocation and event insert are atomic + single writer authority。
/// 多 session 交错 append，各自 sequence 单调；模块不暴露外部 sequence 入口，
/// 序列只能由 store 从 1 开始连续分配。
#[test]
fn per_session_sequence_is_monotonic_across_interleaved_sessions() {
    let temp = TempStoreDir::new("sequence");
    let store = open_writer(&temp.db_path).expect("open");

    let sessions = ["session-x", "session-y", "session-z"];
    for round in 0..5 {
        for session in sessions {
            let event = make_event(session, &format!("{session}-evt-{round}"));
            let outcome = store.append_event(&event).expect("append");
            assert_eq!(
                outcome,
                AppendOutcome::Inserted {
                    sequence: round + 1,
                    payload_checksum: outcome_checksum(&outcome),
                },
                "session {session} round {round}"
            );
        }
    }

    for session in sessions {
        let events = store.events_for_session(session).expect("events");
        let sequences: Vec<i64> = events.iter().map(|event| event.sequence).collect();
        assert_eq!(sequences, vec![1, 2, 3, 4, 5]);
        assert_eq!(
            store.next_sequence(session).expect("next_sequence"),
            Some(6)
        );
    }
}

fn outcome_checksum(outcome: &AppendOutcome) -> String {
    match outcome {
        AppendOutcome::Inserted {
            payload_checksum, ..
        } => payload_checksum.clone(),
        AppendOutcome::Duplicate { .. } => String::new(),
    }
}

/// Scenario: 事务回滚——cursor/binding 更新失败时，event 与 next_sequence 同时回滚。
#[test]
fn transaction_rolls_back_event_and_sequence_on_binding_failure() {
    let temp = TempStoreDir::new("rollback");
    let store = open_writer(&temp.db_path).expect("open");

    let event = make_event(SESSION, "evt-rollback");
    let mut bad_binding = make_binding(SESSION, "target-main");
    // CHECK (length(availability) > 0) 在 SQLite 层失败，制造 insert 后的事务错误。
    bad_binding.availability = String::new();

    let error = store
        .append_event_with_binding(&event, &bad_binding)
        .expect_err("binding check must fail");
    assert!(
        matches!(error, StoreError::ConstraintViolation { .. }),
        "unexpected error: {error}"
    );

    // event 行与 session/next_sequence 一起回滚。
    assert_eq!(store.count_events(Some(SESSION)).expect("count"), 0);
    assert_eq!(store.next_sequence(SESSION).expect("next_sequence"), None);

    // 回滚后同一 event 可重新写入，且 sequence 从 1 开始（无空洞污染）。
    let good_binding = make_binding(SESSION, "target-main");
    let outcome = store
        .append_event_with_binding(&event, &good_binding)
        .expect("append after rollback");
    assert!(matches!(
        outcome,
        AppendOutcome::Inserted { sequence: 1, .. }
    ));
    let binding = store
        .binding_state(SESSION, "target-main")
        .expect("binding read")
        .expect("binding exists");
    assert_eq!(binding.engine, "claude");
}

#[test]
fn lists_all_hidden_bindings_for_one_shared_session() {
    let temp = TempStoreDir::new("binding-list");
    let store = open_writer(&temp.db_path).expect("open");

    let first = make_binding(SESSION, "claude:provider-a");
    let mut second = make_binding(SESSION, "codex:provider-b");
    second.engine = "codex".to_string();
    second.provider_profile_id = Some("provider-b".to_string());
    second.native_session_id = Some("codex-native-b".to_string());
    let other_session = make_binding("session-b", "claude:provider-a");
    store.upsert_binding_state(&first).expect("first binding");
    store.upsert_binding_state(&second).expect("second binding");
    store
        .upsert_binding_state(&other_session)
        .expect("other session binding");

    let bindings = store
        .binding_states_for_session(SESSION)
        .expect("binding list");
    assert_eq!(bindings.len(), 2);
    assert_eq!(bindings[0].binding_key, "claude:provider-a");
    assert_eq!(bindings[1].binding_key, "codex:provider-b");
    assert_eq!(
        bindings[1].native_session_id.as_deref(),
        Some("codex-native-b")
    );
}

/// Scenario: repeated append returns duplicate outcome（路径 1：event_id ×100）。
#[test]
fn repeated_append_same_event_id_x100_keeps_single_row() {
    let temp = TempStoreDir::new("idem-event-id");
    let store = open_writer(&temp.db_path).expect("open");

    let event = make_event(SESSION, "evt-dup");
    let first = store.append_event(&event).expect("first append");
    let AppendOutcome::Inserted { sequence, .. } = first else {
        panic!("first append must insert");
    };

    for _ in 0..100 {
        let outcome = store.append_event(&event).expect("replay");
        assert_eq!(
            outcome,
            AppendOutcome::Duplicate {
                existing_sequence: sequence
            }
        );
    }
    assert_eq!(store.count_events(Some(SESSION)).expect("count"), 1);
}

#[test]
fn idempotency_key_with_different_payload_is_rejected() {
    let temp = TempStoreDir::new("idem-conflict");
    let store = open_writer(&temp.db_path).expect("open");
    let original = make_event(SESSION, "evt-conflict");
    store.append_event(&original).expect("first append");

    let mut conflicting = original;
    conflicting.payload_json = "{\"text\":\"different\"}".to_string();
    let error = store
        .append_event(&conflicting)
        .expect_err("same id with different payload must fail");
    assert!(matches!(error, StoreError::IdempotencyConflict { .. }));
    assert_eq!(store.count_events(Some(SESSION)).expect("count"), 1);
}

/// Scenario: repeated append（路径 2：attempt_id + fact_type ×100，不同 event_id）。
#[test]
fn repeated_append_same_attempt_fact_x100_keeps_single_row() {
    let temp = TempStoreDir::new("idem-attempt");
    let store = open_writer(&temp.db_path).expect("open");

    let mut first_event = make_event(SESSION, "evt-attempt-0");
    first_event.attempt_id = Some("attempt-1".to_string());
    let first = store.append_event(&first_event).expect("first append");
    let AppendOutcome::Inserted { sequence, .. } = first else {
        panic!("first append must insert");
    };

    for index in 1..=100 {
        let mut replay = make_event(SESSION, &format!("evt-attempt-{index}"));
        replay.attempt_id = Some("attempt-1".to_string());
        let outcome = store.append_event(&replay).expect("replay");
        assert_eq!(
            outcome,
            AppendOutcome::Duplicate {
                existing_sequence: sequence
            }
        );
    }
    assert_eq!(store.count_events(Some(SESSION)).expect("count"), 1);
}

/// Scenario: repeated append（路径 3：dedupe_key ×100，不同 event_id）。
#[test]
fn repeated_append_same_dedupe_key_x100_keeps_single_row() {
    let temp = TempStoreDir::new("idem-dedupe");
    let store = open_writer(&temp.db_path).expect("open");

    let mut first_event = make_event(SESSION, "evt-dedupe-0");
    first_event.dedupe_key = Some("dedupe-1".to_string());
    let first = store.append_event(&first_event).expect("first append");
    let AppendOutcome::Inserted { sequence, .. } = first else {
        panic!("first append must insert");
    };

    for index in 1..=100 {
        let mut replay = make_event(SESSION, &format!("evt-dedupe-{index}"));
        replay.dedupe_key = Some("dedupe-1".to_string());
        let outcome = store.append_event(&replay).expect("replay");
        assert_eq!(
            outcome,
            AppendOutcome::Duplicate {
                existing_sequence: sequence
            }
        );
    }
    assert_eq!(store.count_events(Some(SESSION)).expect("count"), 1);
}

/// Scenario: usage facts dedupe by usageRecordId only。
#[test]
fn usage_facts_dedupe_by_usage_record_id_only() {
    let temp = TempStoreDir::new("usage-exception");
    let store = open_writer(&temp.db_path).expect("open");

    // 同 attempt、同 fact_type=usageRecorded，不同 usageRecordId（dedupe_key）→ 并存。
    let mut first = make_event(SESSION, "usage-1");
    first.fact_type = USAGE_FACT_TYPE.to_string();
    first.attempt_id = Some("attempt-1".to_string());
    first.dedupe_key = Some("usageRecordId-1".to_string());
    let mut second = make_event(SESSION, "usage-2");
    second.fact_type = USAGE_FACT_TYPE.to_string();
    second.attempt_id = Some("attempt-1".to_string());
    second.dedupe_key = Some("usageRecordId-2".to_string());

    assert!(matches!(
        store.append_event(&first).expect("first usage"),
        AppendOutcome::Inserted { sequence: 1, .. }
    ));
    assert!(
        matches!(
            store.append_event(&second).expect("second usage"),
            AppendOutcome::Inserted { sequence: 2, .. }
        ),
        "same attempt must allow multiple usageRecorded facts"
    );

    // 同 usageRecordId 重放 → 去重。
    let mut replay = make_event(SESSION, "usage-3");
    replay.fact_type = USAGE_FACT_TYPE.to_string();
    replay.attempt_id = Some("attempt-1".to_string());
    replay.dedupe_key = Some("usageRecordId-1".to_string());
    assert_eq!(
        store.append_event(&replay).expect("replay"),
        AppendOutcome::Duplicate {
            existing_sequence: 1
        }
    );
    assert_eq!(store.count_events(Some(SESSION)).expect("count"), 2);
}

/// Scenario: ledger replay and revision chain。
#[test]
fn ledger_replay_and_revision_chain() {
    let temp = TempStoreDir::new("ledger");
    let store = open_writer(&temp.db_path).expect("open");

    // rev1（aggregate-only：无 session 参与）合法。
    let rev1 = make_ledger_record(1, "ledger-evt-1", None);
    assert_eq!(
        store.record_provider_usage(&rev1).expect("rev1"),
        LedgerOutcome::Inserted
    );

    // PK 重放 ×100 → 只有一行。
    for _ in 0..100 {
        assert_eq!(
            store.record_provider_usage(&rev1).expect("rev1 replay"),
            LedgerOutcome::Duplicate
        );
    }
    let rows = store
        .ledger_rows("profile-1", 1_000, 2_000, "subject-1")
        .expect("ledger rows");
    assert_eq!(rows.len(), 1);

    // rev2 必须 = 当前最高 + 1 且 supersedes 指向当前最高 → 合法。
    let rev2 = make_ledger_record(2, "ledger-evt-2", Some("ledger-evt-1"));
    assert_eq!(
        store.record_provider_usage(&rev2).expect("rev2"),
        LedgerOutcome::Inserted
    );

    // 跳跃（rev4 无 rev3）→ typed error。
    let skipped = make_ledger_record(4, "ledger-evt-4", Some("ledger-evt-2"));
    let error = store
        .record_provider_usage(&skipped)
        .expect_err("revision skip must be rejected");
    assert!(
        matches!(
            error,
            StoreError::LedgerRevisionConflict {
                expected_revision: 3,
                actual_revision: 4,
                ..
            }
        ),
        "unexpected error: {error}"
    );

    // 倒挂 / supersedes 指向错误 → typed error。
    let wrong_supersedes = make_ledger_record(3, "ledger-evt-3", Some("ledger-evt-1"));
    let error = store
        .record_provider_usage(&wrong_supersedes)
        .expect_err("wrong supersedes must be rejected");
    assert!(matches!(error, StoreError::LedgerRevisionConflict { .. }));

    // 首个 revision 带 supersedes → typed error。
    let bad_first = ProviderUsageRecord {
        provider_profile_id: "profile-2".to_string(),
        ..make_ledger_record(1, "ledger-evt-x", Some("ghost"))
    };
    let error = store
        .record_provider_usage(&bad_first)
        .expect_err("first revision with supersedes must be rejected");
    assert!(matches!(error, StoreError::LedgerRevisionConflict { .. }));

    // Ledger 表无 session_id 列（独立归属，不伪造 session）。
    let conn = rusqlite::Connection::open(&temp.db_path).expect("raw connection");
    let mut stmt = conn
        .prepare("PRAGMA table_info(provider_usage_aggregate_log)")
        .expect("table_info");
    let columns: Vec<String> = stmt
        .query_map([], |row| row.get(1))
        .expect("columns")
        .collect::<Result<_, _>>()
        .expect("columns");
    assert!(!columns.iter().any(|column| column == "session_id"));

    let rows = store
        .ledger_rows("profile-1", 1_000, 2_000, "subject-1")
        .expect("ledger rows");
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[1].revision, 2);
}

#[test]
fn ledger_pk_with_different_payload_is_rejected() {
    let temp = TempStoreDir::new("ledger-conflict");
    let store = open_writer(&temp.db_path).expect("open");
    let original = make_ledger_record(1, "ledger-evt-1", None);
    store
        .record_provider_usage(&original)
        .expect("first ledger write");

    let mut conflicting = original;
    conflicting.payload_json = "{\"totalTokens\":43}".to_string();
    let error = store
        .record_provider_usage(&conflicting)
        .expect_err("same ledger pk with different payload must fail");
    assert!(matches!(error, StoreError::IdempotencyConflict { .. }));
}

/// Scenario: checksum stability across producers（writer 内部计算，键序/空白无关）。
#[test]
fn checksum_is_stable_across_key_order_and_whitespace() {
    let temp = TempStoreDir::new("checksum");
    let store_a = open_writer(&temp.db_path).expect("open");

    let mut compact = make_event(SESSION, "evt-checksum");
    compact.payload_json = "{\"a\":1,\"b\":{\"y\":2,\"x\":3}}".to_string();
    let outcome_a = store_a.append_event(&compact).expect("append compact");
    let checksum_a = outcome_checksum(&outcome_a);
    assert!(checksum_a.starts_with("sha256:"));
    drop(store_a);

    // 另一“生产者”：键序不同 + 空白不同，语义相同。
    let temp_b = TempStoreDir::new("checksum-b");
    let store_b = open_writer(&temp_b.db_path).expect("open b");
    let mut spaced = make_event(SESSION, "evt-checksum");
    spaced.payload_json = "{\n  \"b\": { \"x\": 3, \"y\": 2 },\n  \"a\": 1\n}".to_string();
    let outcome_b = store_b.append_event(&spaced).expect("append spaced");
    assert_eq!(checksum_a, outcome_checksum(&outcome_b));
}

#[test]
fn unknown_fidelity_fails_closed_on_read() {
    let temp = TempStoreDir::new("unknown-fidelity");
    let writer = open_writer(&temp.db_path).expect("open");
    writer
        .append_event(&make_event(SESSION, "evt-fidelity"))
        .expect("append");
    writer.shutdown().expect("shutdown writer");

    let conn = rusqlite::Connection::open(&temp.db_path).expect("raw connection");
    conn.execute(
        "UPDATE shared_event_log SET fidelity = 'future-value' WHERE session_id = ?1",
        [SESSION],
    )
    .expect("inject unknown fidelity");
    drop(conn);

    let writer = open_writer(&temp.db_path).expect("reopen");
    writer
        .events_for_session(SESSION)
        .expect_err("unknown enum must fail closed");
    writer.shutdown().expect("shutdown writer");
}

/// Scenario: damaged database enters read-only recovery（不覆盖原文件）。
#[test]
fn damaged_database_enters_read_only_recovery() {
    let temp = TempStoreDir::new("damaged");
    std::fs::write(&temp.db_path, b"definitely-not-a-sqlite-database-payload")
        .expect("write garbage");
    let original_len = std::fs::metadata(&temp.db_path).expect("metadata").len();

    let outcome = open(&temp.db_path).expect("open damaged db");
    match outcome {
        OpenOutcome::ReadOnlyRecovery { reason, events } => {
            assert!(!reason.to_string().is_empty(), "typed reason required");
            // 只读 reader 可用；quick_check 暴露损坏（报错或非 ok）。
            let check = events.quick_check();
            assert!(
                check.is_err() || check.expect("checked") != "ok",
                "damaged db must not pass quick_check"
            );
        }
        OpenOutcome::Ready(_) => panic!("damaged db must not open as ready"),
    }

    // 原文件保持原样：未被删除/重命名/新建覆盖。
    assert!(temp.db_path.exists());
    assert_eq!(
        std::fs::metadata(&temp.db_path).expect("metadata").len(),
        original_len
    );
}

/// Scenario: a missing database file MAY be created fresh。
#[test]
fn missing_database_file_is_created_fresh() {
    let temp = TempStoreDir::new("missing");
    assert!(!temp.db_path.exists());
    let outcome = open(&temp.db_path).expect("open missing db");
    let writer = match outcome {
        OpenOutcome::Ready(writer) => writer,
        OpenOutcome::ReadOnlyRecovery { .. } => panic!("missing db must be created fresh"),
    };
    let outcome = writer
        .append_event(&make_event(SESSION, "evt-fresh"))
        .expect("append via writer");
    assert!(matches!(
        outcome,
        AppendOutcome::Inserted { sequence: 1, .. }
    ));
    assert_eq!(writer.count_events(None).expect("count"), 1);
    writer.shutdown().expect("shutdown writer");
}

/// Scenario: single writer authority——Clone-able handle 并发写仍串行化，sequence 无重复。
#[test]
fn writer_actor_serializes_concurrent_appends() {
    let temp = TempStoreDir::new("actor");
    let outcome = open(&temp.db_path).expect("open");
    let writer = match outcome {
        OpenOutcome::Ready(writer) => writer,
        OpenOutcome::ReadOnlyRecovery { .. } => panic!("fresh db must be ready"),
    };

    let mut handles = Vec::new();
    for thread_index in 0..2 {
        let writer = writer.clone();
        handles.push(std::thread::spawn(move || {
            for event_index in 0..25 {
                writer
                    .append_event(&make_event(
                        SESSION,
                        &format!("evt-t{thread_index}-{event_index}"),
                    ))
                    .expect("concurrent append");
            }
        }));
    }
    for handle in handles {
        handle.join().expect("join writer thread");
    }

    let events = writer.events_for_session(SESSION).expect("events");
    assert_eq!(events.len(), 50);
    let sequences: Vec<i64> = events.iter().map(|event| event.sequence).collect();
    assert_eq!(sequences, (1..=50).collect::<Vec<_>>());

    // 只读查询 API：count_events。
    assert_eq!(writer.count_events(Some(SESSION)).expect("count"), 50);
    assert_eq!(writer.count_events(None).expect("count all"), 50);

    // writer 路径 upsert binding。
    writer
        .upsert_binding_state(&make_binding(SESSION, "target-main"))
        .expect("upsert binding");
    writer.shutdown().expect("shutdown writer");

    let store = open_writer(&temp.db_path).expect("reopen");
    assert!(store
        .binding_state(SESSION, "target-main")
        .expect("binding read")
        .is_some());
}

#[test]
fn session_target_upsert_creates_and_updates_v2_session_row_without_advancing_sequence() {
    let temp = TempStoreDir::new("session-target");
    let writer = open_writer(&temp.db_path).expect("open writer");
    writer
        .upsert_session_target(&SessionTargetUpdate {
            session_id: SESSION.to_string(),
            schema_version: 2,
            selected_target_json:
                r#"{"engine":"codex","model":"gpt-runtime","providerProfileSource":"local"}"#
                    .to_string(),
            updated_at: 100,
        })
        .expect("create session target");

    let created = writer
        .session_target(SESSION)
        .expect("read created target")
        .expect("created target row");
    assert!(created.selected_target_json.contains("\"gpt-runtime\""));
    assert_eq!(created.updated_at, 100);
    assert_eq!(
        writer.next_sequence(SESSION).expect("next sequence"),
        Some(1)
    );

    writer
        .upsert_session_target(&SessionTargetUpdate {
            session_id: SESSION.to_string(),
            schema_version: 2,
            selected_target_json:
                r#"{"engine":"claude","model":"claude-sonnet-4-5","providerProfileSource":"local"}"#
                    .to_string(),
            updated_at: 200,
        })
        .expect("update session target");
    let updated = writer
        .session_target(SESSION)
        .expect("read updated target")
        .expect("updated target row");
    assert!(updated
        .selected_target_json
        .contains("\"claude-sonnet-4-5\""));
    assert_eq!(updated.updated_at, 200);
    assert_eq!(
        writer.next_sequence(SESSION).expect("next sequence"),
        Some(1)
    );

    writer.shutdown().expect("shutdown writer");
}

#[test]
fn cloned_handle_cannot_shutdown_writer_for_other_callers() {
    let temp = TempStoreDir::new("actor-shutdown");
    let writer = match open(&temp.db_path).expect("open") {
        OpenOutcome::Ready(writer) => writer,
        OpenOutcome::ReadOnlyRecovery { .. } => panic!("fresh db must be ready"),
    };
    let clone = writer.clone();
    let error = clone
        .shutdown()
        .expect_err("clone must not terminate shared actor");
    assert!(matches!(
        error,
        StoreError::WriterStillShared { handle_count: 2 }
    ));
    writer
        .append_event(&make_event(SESSION, "evt-after-rejected-shutdown"))
        .expect("writer must remain usable");
    writer.shutdown().expect("last handle shuts down");
}
