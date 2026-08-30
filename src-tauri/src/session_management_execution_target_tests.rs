#[test]
fn execution_target_projects_after_provider_continuation_metadata() {
    let target = SessionExecutionTarget {
        model_catalog_entry_id: "k3-256k".to_string(),
        model: "k3-256k".to_string(),
        reasoning_effort: Some("high".to_string()),
    };
    let continuation = ProviderContinuationMetadata {
        origin_kind: "provider-continuation".to_string(),
        source_session_id: "claude:source-1".to_string(),
        source_provider_profile_id: Some("claude-local".to_string()),
        family_id: "claude:ws-1:source-1".to_string(),
        family_root_session_id: "claude:ws-1:source-1".to_string(),
        lineage_parent_session_id: "claude:source-1".to_string(),
        lineage_kind: "provider-continuation".to_string(),
        lineage_depth: 1,
    };
    let metadata = WorkspaceSessionCatalogMetadata {
        execution_target_by_session_key: HashMap::from([(
            "codex:ws-1:target-1".to_string(),
            target,
        )]),
        provider_continuation_by_session_key: HashMap::from([(
            "codex:ws-1:target-1".to_string(),
            continuation,
        )]),
        ..Default::default()
    };
    let metadata_by_workspace_id = HashMap::from([("ws-1".to_string(), metadata)]);
    let entry = finalize_existing_catalog_entry(
        catalog_entry("target-1", "ws-1", None, None),
        &metadata_by_workspace_id,
    );

    assert_eq!(
        entry.continuation.model_catalog_entry_id.as_deref(),
        Some("k3-256k")
    );
    assert_eq!(entry.continuation.model.as_deref(), Some("k3-256k"));
    assert_eq!(entry.continuation.reasoning_effort.as_deref(), Some("high"));
    assert_eq!(
        entry.continuation.origin_kind.as_deref(),
        Some("provider-continuation")
    );
}

#[tokio::test]
async fn execution_target_is_idempotent_and_restart_readable() {
    let base = std::env::temp_dir().join(format!("execution-target-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&base).expect("create temp dir");
    let storage_path = base.join("workspaces.json");
    std::fs::write(&storage_path, "[]").expect("seed storage path");
    let workspace = workspace_entry("ws-1", "Workspace", "/tmp/ws-1", WorkspaceKind::Main, None);
    let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));

    assert!(record_session_execution_target_core(
        &workspaces,
        &storage_path,
        "ws-1".to_string(),
        "codex:session-1".to_string(),
        "codex".to_string(),
        "k3-256k".to_string(),
        "k3-256k".to_string(),
        Some("high".to_string()),
    )
    .await
    .expect("record target"));
    assert!(!record_session_execution_target_core(
        &workspaces,
        &storage_path,
        "ws-1".to_string(),
        "codex:session-1".to_string(),
        "codex".to_string(),
        "k3-256k".to_string(),
        "k3-256k".to_string(),
        Some("high".to_string()),
    )
    .await
    .expect("skip unchanged target"));

    let reloaded = read_catalog_metadata(&storage_path, "ws-1").expect("reload metadata");
    assert_eq!(
        reloaded
            .execution_target_by_session_key
            .get("codex:ws-1:session-1")
            .and_then(|target| target.reasoning_effort.as_deref()),
        Some("high")
    );
    let target = get_session_execution_target_core(
        &workspaces,
        &storage_path,
        "ws-1".to_string(),
        "codex:session-1".to_string(),
        "codex".to_string(),
    )
    .await
    .expect("read target");
    assert_eq!(
        target,
        reloaded
            .execution_target_by_session_key
            .get("codex:ws-1:session-1")
            .cloned()
    );
    std::fs::remove_dir_all(base).ok();
}

#[tokio::test]
async fn pending_execution_target_moves_to_canonical_thread_id() {
    let base = std::env::temp_dir().join(format!("execution-target-migrate-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&base).expect("create temp dir");
    let storage_path = base.join("workspaces.json");
    std::fs::write(&storage_path, "[]").expect("seed storage path");
    let workspace = workspace_entry("ws-1", "Workspace", "/tmp/ws-1", WorkspaceKind::Main, None);
    let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));

    record_session_execution_target_core(
        &workspaces,
        &storage_path,
        "ws-1".to_string(),
        "kimi-pending-1".to_string(),
        "kimi".to_string(),
        "豆包".to_string(),
        "豆包".to_string(),
        None,
    )
    .await
    .expect("record pending target");

    assert!(migrate_session_execution_target_for_thread_rename_core(
        &workspaces,
        &storage_path,
        "ws-1".to_string(),
        "kimi-pending-1".to_string(),
        "kimi:session-real-1".to_string(),
    )
    .await
    .expect("migrate pending target"));

    let target = get_session_execution_target_core(
        &workspaces,
        &storage_path,
        "ws-1".to_string(),
        "kimi:session-real-1".to_string(),
        "kimi".to_string(),
    )
    .await
    .expect("read canonical target");
    assert_eq!(
        target.as_ref().map(|value| value.model.as_str()),
        Some("豆包")
    );
    let metadata = read_catalog_metadata(&storage_path, "ws-1").expect("reload metadata");
    assert!(!metadata
        .execution_target_by_session_key
        .contains_key("kimi:ws-1:kimi-pending-1"));
    assert!(metadata
        .execution_target_by_session_key
        .contains_key("kimi:ws-1:session-real-1"));
    std::fs::remove_dir_all(base).ok();
}

#[test]
fn deleting_session_metadata_removes_execution_target() {
    let stable_key = "codex:ws-1:session-1".to_string();
    let mut metadata = WorkspaceSessionCatalogMetadata {
        execution_target_by_session_key: HashMap::from([(
            stable_key.clone(),
            SessionExecutionTarget {
                model_catalog_entry_id: "k3-256k".to_string(),
                model: "k3-256k".to_string(),
                reasoning_effort: None,
            },
        )]),
        ..Default::default()
    };

    remove_catalog_metadata_for_session(&mut metadata, "ws-1", "codex:session-1");

    assert!(!metadata
        .execution_target_by_session_key
        .contains_key(&stable_key));
}
