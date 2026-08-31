use super::*;
use std::{cell::RefCell, rc::Rc};

#[test]
fn daemon_active_engine_normalizes_legacy_gemini_to_supported_fallback() {
    let mut settings = AppSettings::default();
    settings.gemini_enabled = true;
    settings.default_engine = Some("gemini".to_string());

    assert_eq!(
        resolve_supported_daemon_active_engine(&settings, settings.default_engine.as_deref()),
        engine::EngineType::Codex
    );
}

fn codex_summary(session_id: &str, timestamp: i64) -> crate::types::LocalUsageSessionSummary {
    crate::types::LocalUsageSessionSummary {
        session_id: session_id.to_string(),
        timestamp,
        cwd: Some("/repo".to_string()),
        model: "gpt-5".to_string(),
        summary: Some(format!("Session {session_id}")),
        ..Default::default()
    }
}

#[test]
fn daemon_codex_local_thread_response_marks_live_unavailable() {
    let sessions = vec![codex_summary("s1", 20), codex_summary("s2", 10)];
    let response =
        build_codex_daemon_local_thread_response("/repo", sessions, None, Some(1), &HashMap::new());
    let result = response.get("result").and_then(Value::as_object).unwrap();
    let data = result.get("data").and_then(Value::as_array).unwrap();

    assert_eq!(
        result.get("partialSource").and_then(Value::as_str),
        Some(CODEX_DAEMON_LOCAL_THREAD_LIST_PARTIAL_SOURCE)
    );
    assert_eq!(data.len(), 1);
    assert_eq!(data[0].get("id").and_then(Value::as_str), Some("s1"));
    assert_eq!(
        data[0].get("partialSource").and_then(Value::as_str),
        Some(CODEX_DAEMON_LOCAL_THREAD_LIST_PARTIAL_SOURCE)
    );
    assert_eq!(
        result.get("nextCursor").and_then(Value::as_str),
        Some("codex-daemon-local:1")
    );
}

#[test]
fn daemon_codex_local_thread_entry_preserves_parent_session_id() {
    let mut session = codex_summary("child-session", 20);
    session.parent_session_id = Some("parent-session".to_string());

    let response = build_codex_daemon_local_thread_response(
        "/repo",
        vec![session],
        None,
        Some(1),
        &HashMap::new(),
    );
    let entry = &response["result"]["data"][0];

    assert_eq!(
        entry.get("parentSessionId").and_then(Value::as_str),
        Some("parent-session")
    );
}

#[test]
fn daemon_codex_empty_thread_response_still_marks_partial_source() {
    let response =
        build_codex_daemon_empty_thread_response(CODEX_DAEMON_LOCAL_THREAD_LIST_PARTIAL_SOURCE);
    let result = response.get("result").and_then(Value::as_object).unwrap();

    assert_eq!(
        result.get("data").and_then(Value::as_array).unwrap().len(),
        0
    );
    assert!(result.get("nextCursor").unwrap().is_null());
    assert_eq!(
        result.get("partialSource").and_then(Value::as_str),
        Some(CODEX_DAEMON_LOCAL_THREAD_LIST_PARTIAL_SOURCE)
    );
}

#[test]
fn daemon_provider_profile_rejects_managed_ids() {
    assert_eq!(normalize_daemon_disk_provider_profile(None).unwrap(), None);
    assert_eq!(
        normalize_daemon_disk_provider_profile(Some("  ".to_string())).unwrap(),
        None
    );
    assert_eq!(
        normalize_daemon_disk_provider_profile(Some(
            codex::provider_profile::CODEX_DISK_PROVIDER_PROFILE_ID.to_string(),
        ))
        .unwrap(),
        Some(codex::provider_profile::CODEX_DISK_PROVIDER_PROFILE_ID.to_string())
    );
    let error =
        normalize_daemon_disk_provider_profile(Some("managed-provider".to_string())).unwrap_err();
    assert!(error.contains("provider-scoped runtime is unavailable in daemon mode"));
}

#[test]
fn daemon_rejects_account_managed_claude_without_exposing_the_vault() {
    assert!(reject_account_managed_claude_for_daemon(None).is_ok());
    let error = reject_account_managed_claude_for_daemon(Some(
        engine::claude::provider_profile::CLAUDE_ACCOUNT_MANAGED_PROVIDER_PROFILE_ID,
    ))
    .unwrap_err();
    assert!(error.contains("desktop runtime"));
}

#[tokio::test(flavor = "current_thread")]
async fn daemon_disk_start_confirms_ready_before_returning() {
    let events = Rc::new(RefCell::new(Vec::<String>::new()));
    let result = run_daemon_disk_start_thread_with_readiness(
        "ws-1",
        || {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push("ensure".to_string());
                Ok(())
            }
        },
        || {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push("start".to_string());
                Ok(json!({ "result": { "threadId": "thread-1" } }))
            }
        },
        |thread_id| {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push(format!("confirm:{thread_id}"));
                Ok(())
            }
        },
    )
    .await
    .unwrap();

    assert_eq!(
        codex_core::extract_thread_id_from_response(&result).as_deref(),
        Some("thread-1")
    );
    assert_eq!(
        events.borrow().as_slice(),
        ["ensure", "start", "confirm:thread-1"]
    );
}

#[tokio::test(flavor = "current_thread")]
async fn daemon_disk_start_propagates_ready_confirmation_failure() {
    let events = Rc::new(RefCell::new(Vec::<String>::new()));
    let error = run_daemon_disk_start_thread_with_readiness(
        "ws-1",
        || {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push("ensure".to_string());
                Ok(())
            }
        },
        || {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push("start".to_string());
                Ok(json!({ "result": { "threadId": "thread-1" } }))
            }
        },
        |thread_id| {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push(format!("confirm:{thread_id}"));
                Err("thread/resume failed".to_string())
            }
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error, "thread/resume failed");
    assert_eq!(
        events.borrow().as_slice(),
        ["ensure", "start", "confirm:thread-1"]
    );
}

#[tokio::test(flavor = "current_thread")]
async fn daemon_disk_start_retries_stopping_runtime_before_confirming() {
    let events = Rc::new(RefCell::new(Vec::<String>::new()));
    let start_count = Rc::new(RefCell::new(0_u8));
    let result = run_daemon_disk_start_thread_with_readiness(
        "ws-1",
        || {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push("ensure".to_string());
                Ok(())
            }
        },
        || {
            let events = Rc::clone(&events);
            let start_count = Rc::clone(&start_count);
            async move {
                let mut count = start_count.borrow_mut();
                *count += 1;
                events.borrow_mut().push(format!("start:{count}"));
                if *count == 1 {
                    Err("[RUNTIME_ENDED] stopped after manual_shutdown".to_string())
                } else {
                    Ok(json!({ "result": { "threadId": "thread-2" } }))
                }
            }
        },
        |thread_id| {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push(format!("confirm:{thread_id}"));
                Ok(())
            }
        },
    )
    .await
    .unwrap();

    assert_eq!(
        codex_core::extract_thread_id_from_response(&result).as_deref(),
        Some("thread-2")
    );
    assert_eq!(
        events.borrow().as_slice(),
        ["ensure", "start:1", "ensure", "start:2", "confirm:thread-2"]
    );
}

#[tokio::test(flavor = "current_thread")]
async fn daemon_disk_start_retries_broken_pipe_before_confirming() {
    let events = Rc::new(RefCell::new(Vec::<String>::new()));
    let start_count = Rc::new(RefCell::new(0_u8));
    let result = run_daemon_disk_start_thread_with_readiness(
        "ws-1",
        || {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push("ensure".to_string());
                Ok(())
            }
        },
        || {
            let events = Rc::clone(&events);
            let start_count = Rc::clone(&start_count);
            async move {
                let mut count = start_count.borrow_mut();
                *count += 1;
                events.borrow_mut().push(format!("start:{count}"));
                if *count == 1 {
                    Err("Broken pipe (os error 32)".to_string())
                } else {
                    Ok(json!({ "result": { "threadId": "thread-2" } }))
                }
            }
        },
        |thread_id| {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push(format!("confirm:{thread_id}"));
                Ok(())
            }
        },
    )
    .await
    .unwrap();

    assert_eq!(
        codex_core::extract_thread_id_from_response(&result).as_deref(),
        Some("thread-2")
    );
    assert_eq!(
        events.borrow().as_slice(),
        ["ensure", "start:1", "ensure", "start:2", "confirm:thread-2"]
    );
}

#[tokio::test(flavor = "current_thread")]
async fn daemon_disk_start_redacts_persistent_broken_pipe() {
    let error = run_daemon_disk_start_thread_with_readiness(
        "ws-1",
        || async { Ok(()) },
        || async { Err("Broken pipe (os error 32)".to_string()) },
        |_| async { Ok(()) },
    )
    .await
    .unwrap_err();

    assert!(error.starts_with("[SESSION_CREATE_RUNTIME_RECOVERING]"));
    assert!(!error.to_ascii_lowercase().contains("broken pipe"));
    assert!(!error.contains("os error 32"));
}

#[test]
fn daemon_codex_local_thread_response_excludes_background_sessions() {
    let mut guardian = codex_summary("guardian-1", 30);
    guardian.background_kind = Some("guardian-review".to_string());
    let visible = codex_summary("visible-1", 20);

    let response = build_codex_daemon_local_thread_response(
        "/repo",
        vec![guardian, visible],
        None,
        Some(10),
        &HashMap::new(),
    );
    let data = response["result"]["data"].as_array().expect("data array");

    assert_eq!(data.len(), 1);
    assert_eq!(data[0].get("id").and_then(Value::as_str), Some("visible-1"));
}

#[tokio::test]
async fn daemon_live_thread_entries_filter_background_by_id_and_text() {
    let base =
        std::env::temp_dir().join(format!("daemon-guardian-filter-{}", uuid::Uuid::new_v4()));
    let day_dir = base
        .join("codex-home")
        .join("sessions")
        .join("2026")
        .join("08")
        .join("31");
    std::fs::create_dir_all(&day_dir).expect("create day dir");
    let workspace_path = base.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace dir");
    let cwd = workspace_path.to_string_lossy().to_string();
    let guardian_meta = serde_json::json!({
        "timestamp": "2026-08-31T01:00:00.000Z",
        "type": "session_meta",
        "payload": {
            "id": "guardian-live-test",
            "cwd": cwd,
            "originator": "Codex Desktop",
            "source": {"subagent": {"other": "guardian"}},
            "thread_source": "guardian_review"
        }
    })
    .to_string();
    std::fs::write(
        day_dir.join("rollout-2026-08-31T01-00-00-guardian-live-test.jsonl"),
        guardian_meta + "\n",
    )
    .expect("write guardian fixture");

    let mut settings = crate::types::WorkspaceSettings::default();
    settings.codex_home = Some(base.join("codex-home").to_string_lossy().to_string());
    let workspace = crate::types::WorkspaceEntry {
        id: "main".to_string(),
        name: "Main".to_string(),
        path: cwd.clone(),
        codex_bin: None,
        kind: crate::types::WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    };
    let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));

    let response = json!({
        "result": {
            "data": [
                {"id": "guardian-live-test", "preview": "some guardian preview"},
                {"id": "legacy-helper", "preview": "Generate a concise title for a coding chat thread from the first user message."},
                {"id": "normal-live", "preview": "fix the bug"}
            ],
            "nextCursor": Value::Null
        }
    });
    let filtered =
        filter_codex_daemon_background_thread_entries(&workspaces, "main", response, 10).await;
    let data = filtered["result"]["data"].as_array().expect("data array");
    let ids: Vec<&str> = data
        .iter()
        .filter_map(|entry| entry.get("id").and_then(Value::as_str))
        .collect();

    assert_eq!(ids, vec!["normal-live"]);

    std::fs::remove_dir_all(base).ok();
}
