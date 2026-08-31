    #[tokio::test]
    async fn catalog_workspace_scope_includes_child_worktrees_for_main_workspace() {
        let main = workspace_entry("main", "Main", "/tmp/main", WorkspaceKind::Main, None);
        let worktree_b = workspace_entry(
            "worktree-b",
            "B",
            "/tmp/worktree-b",
            WorkspaceKind::Worktree,
            Some("main"),
        );
        let worktree_a = workspace_entry(
            "worktree-a",
            "A",
            "/tmp/worktree-a",
            WorkspaceKind::Worktree,
            Some("main"),
        );
        let unrelated = workspace_entry("other", "Other", "/tmp/other", WorkspaceKind::Main, None);
        let workspaces = Mutex::new(HashMap::from([
            (main.id.clone(), main),
            (worktree_b.id.clone(), worktree_b),
            (worktree_a.id.clone(), worktree_a),
            (unrelated.id.clone(), unrelated),
        ]));

        let scope = catalog_workspace_scope(&workspaces, "main")
            .await
            .expect("resolve scope");

        let ids: Vec<_> = scope.into_iter().map(|entry| entry.id).collect();
        assert_eq!(ids, vec!["main", "worktree-a", "worktree-b"]);
    }

    #[tokio::test]
    async fn catalog_workspace_scope_keeps_worktree_selection_isolated() {
        let main = workspace_entry("main", "Main", "/tmp/main", WorkspaceKind::Main, None);
        let worktree = workspace_entry(
            "worktree-a",
            "A",
            "/tmp/worktree-a",
            WorkspaceKind::Worktree,
            Some("main"),
        );
        let sibling = workspace_entry(
            "worktree-b",
            "B",
            "/tmp/worktree-b",
            WorkspaceKind::Worktree,
            Some("main"),
        );
        let workspaces = Mutex::new(HashMap::from([
            (main.id.clone(), main),
            (worktree.id.clone(), worktree),
            (sibling.id.clone(), sibling),
        ]));

        let scope = catalog_workspace_scope(&workspaces, "worktree-a")
            .await
            .expect("resolve isolated scope");

        let ids: Vec<_> = scope.into_iter().map(|entry| entry.id).collect();
        assert_eq!(ids, vec!["worktree-a"]);
    }

    #[tokio::test]
    async fn claude_child_workspace_session_is_not_claimed_by_parent_projection() {
        let base = std::env::temp_dir().join(format!("claude-child-owner-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");

        let repo_path = base.join("repo");
        let child_path = repo_path.join("sub");
        std::fs::create_dir_all(&child_path).expect("create child workspace path");

        let claude_home = base.join("claude-home");
        let claude_projects_dir = claude_home.join("projects");
        let session_id = "child-claude-session";
        write_claude_session_fixture(
            &claude_projects_dir,
            &repo_path,
            session_id,
            &child_path,
            "child workspace task",
        );

        let parent = workspace_entry(
            "parent",
            "Parent",
            &repo_path.to_string_lossy(),
            WorkspaceKind::Main,
            None,
        );
        let child = workspace_entry(
            "child",
            "Child",
            &child_path.to_string_lossy(),
            WorkspaceKind::Worktree,
            Some("parent"),
        );
        let workspaces = Mutex::new(HashMap::from([
            (parent.id.clone(), parent),
            (child.id.clone(), child),
        ]));
        let engine_manager = engine::EngineManager::new();
        engine_manager
            .set_engine_config(
                engine::EngineType::Claude,
                engine::EngineConfig {
                    home_dir: Some(claude_home.to_string_lossy().to_string()),
                    ..engine::EngineConfig::default()
                },
            )
            .await;

        let parent_data = build_workspace_scope_catalog_data(
            &workspaces,
            &engine_manager,
            &storage_path,
            "parent",
            SessionCatalogScanMode::Bounded(20),
            WorkspaceSessionAttributionMode::Related,
        )
        .await
        .expect("build parent catalog data");
        let child_data = build_workspace_scope_catalog_data(
            &workspaces,
            &engine_manager,
            &storage_path,
            "child",
            SessionCatalogScanMode::Bounded(20),
            WorkspaceSessionAttributionMode::Related,
        )
        .await
        .expect("build child catalog data");

        let parent_claude_entries = parent_data
            .entries
            .iter()
            .filter(|entry| entry.session_id == format!("claude:{session_id}"))
            .collect::<Vec<_>>();
        assert_eq!(parent_claude_entries.len(), 1);
        assert_eq!(parent_claude_entries[0].workspace_id, "child");
        assert_eq!(
            parent_claude_entries[0].matched_workspace_id.as_deref(),
            Some("child")
        );

        let child_claude_entries = child_data
            .entries
            .iter()
            .filter(|entry| entry.session_id == format!("claude:{session_id}"))
            .collect::<Vec<_>>();
        assert_eq!(child_claude_entries.len(), 1);
        assert_eq!(child_claude_entries[0].workspace_id, "child");
        assert_eq!(
            child_claude_entries[0].matched_workspace_id.as_deref(),
            Some("child")
        );

        std::fs::remove_dir_all(base).ok();
    }
    #[tokio::test]
    async fn workspace_only_excludes_unrelated_claude_project_dir_with_matching_cwd() {
        let base = std::env::temp_dir().join(format!("claude-workspace-only-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");

        let workspace_path = base.join("workspace");
        let unrelated_path = base.join("unrelated");
        std::fs::create_dir_all(&workspace_path).expect("create workspace path");
        std::fs::create_dir_all(&unrelated_path).expect("create unrelated path");

        let claude_home = base.join("claude-home");
        let claude_projects_dir = claude_home.join("projects");
        write_claude_session_fixture(
            &claude_projects_dir,
            &unrelated_path,
            "foreign-project-matching-cwd",
            &workspace_path,
            "foreign project but matching cwd",
        );

        let workspace = workspace_entry(
            "workspace",
            "Workspace",
            &workspace_path.to_string_lossy(),
            WorkspaceKind::Main,
            None,
        );
        let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));
        let sessions = Mutex::new(HashMap::new());
        let engine_manager = engine::EngineManager::new();
        engine_manager
            .set_engine_config(
                engine::EngineType::Claude,
                engine::EngineConfig {
                    home_dir: Some(claude_home.to_string_lossy().to_string()),
                    ..engine::EngineConfig::default()
                },
            )
            .await;

        let related_page = list_workspace_sessions_core(
            &workspaces,
            &sessions,
            &engine_manager,
            &storage_path,
            "workspace".to_string(),
            Some(WorkspaceSessionCatalogQuery {
                engine: Some("claude".to_string()),
                status: Some("all".to_string()),
                ..Default::default()
            }),
            None,
            Some(20),
        )
        .await
        .expect("list related sessions");
        assert!(related_page
            .data
            .iter()
            .any(|entry| entry.session_id == "claude:foreign-project-matching-cwd"));

        let workspace_only_page = list_workspace_sessions_core(
            &workspaces,
            &sessions,
            &engine_manager,
            &storage_path,
            "workspace".to_string(),
            Some(WorkspaceSessionCatalogQuery {
                engine: Some("claude".to_string()),
                status: Some("all".to_string()),
                session_attribution_mode: Some(WorkspaceSessionAttributionMode::WorkspaceOnly),
                ..Default::default()
            }),
            None,
            Some(20),
        )
        .await
        .expect("list workspace-only sessions");

        assert!(workspace_only_page
            .data
            .iter()
            .all(|entry| entry.session_id != "claude:foreign-project-matching-cwd"));
        std::fs::remove_dir_all(base).ok();
    }

    #[tokio::test]
    async fn workspace_only_keeps_claude_child_prefix_project_dir() {
        let base = std::env::temp_dir().join(format!("claude-child-prefix-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");

        let workspace_path = base.join("workspace");
        let child_path = workspace_path.join("nested");
        std::fs::create_dir_all(&child_path).expect("create child workspace path");

        let claude_home = base.join("claude-home");
        let claude_projects_dir = claude_home.join("projects");
        write_claude_session_fixture(
            &claude_projects_dir,
            &child_path,
            "child-prefix-session",
            &child_path,
            "child prefix task",
        );

        let workspace = workspace_entry(
            "workspace",
            "Workspace",
            &workspace_path.to_string_lossy(),
            WorkspaceKind::Main,
            None,
        );
        let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));
        let sessions = Mutex::new(HashMap::new());
        let engine_manager = engine::EngineManager::new();
        engine_manager
            .set_engine_config(
                engine::EngineType::Claude,
                engine::EngineConfig {
                    home_dir: Some(claude_home.to_string_lossy().to_string()),
                    ..engine::EngineConfig::default()
                },
            )
            .await;

        let page = list_workspace_sessions_core(
            &workspaces,
            &sessions,
            &engine_manager,
            &storage_path,
            "workspace".to_string(),
            Some(WorkspaceSessionCatalogQuery {
                engine: Some("claude".to_string()),
                status: Some("all".to_string()),
                session_attribution_mode: Some(WorkspaceSessionAttributionMode::WorkspaceOnly),
                ..Default::default()
            }),
            None,
            Some(20),
        )
        .await
        .expect("list workspace-only sessions");

        assert!(page
            .data
            .iter()
            .any(|entry| entry.session_id == "claude:child-prefix-session"));
        std::fs::remove_dir_all(base).ok();
    }

    #[tokio::test]
    async fn project_aggregate_child_claude_mutations_use_owner_stable_key() {
        let base = std::env::temp_dir().join(format!("claude-child-mutate-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");

        let repo_path = base.join("repo");
        let child_path = repo_path.join("sub");
        std::fs::create_dir_all(&child_path).expect("create child workspace path");

        let claude_home = base.join("claude-home");
        let claude_projects_dir = claude_home.join("projects");
        let session_id = "child-mutation-session";
        write_claude_session_fixture(
            &claude_projects_dir,
            &child_path,
            session_id,
            &child_path,
            "child mutation task",
        );
        let child_project_dir = create_claude_project_dir(&claude_projects_dir, &child_path);
        let session_path = child_project_dir.join(format!("{session_id}.jsonl"));

        let parent = workspace_entry(
            "parent",
            "Parent",
            &repo_path.to_string_lossy(),
            WorkspaceKind::Main,
            None,
        );
        let child = workspace_entry(
            "child",
            "Child",
            &child_path.to_string_lossy(),
            WorkspaceKind::Worktree,
            Some("parent"),
        );
        let workspaces = Mutex::new(HashMap::from([
            (parent.id.clone(), parent),
            (child.id.clone(), child),
        ]));
        let sessions = Mutex::new(HashMap::new());
        let engine_manager = engine::EngineManager::new();
        engine_manager
            .set_engine_config(
                engine::EngineType::Claude,
                engine::EngineConfig {
                    home_dir: Some(claude_home.to_string_lossy().to_string()),
                    ..engine::EngineConfig::default()
                },
            )
            .await;

        let requested_session_id = format!("claude:{session_id}");
        let stable_key = format!("claude:child:{session_id}");
        let archive_response = archive_workspace_sessions_core(
            &workspaces,
            &sessions,
            &engine_manager,
            &storage_path,
            "parent".to_string(),
            vec![requested_session_id.clone()],
        )
        .await
        .expect("archive child from parent aggregate");

        assert_eq!(archive_response.results.len(), 1);
        assert!(archive_response.results[0].ok);
        assert_eq!(
            archive_response.results[0].owner_workspace_id.as_deref(),
            Some("child")
        );
        assert_eq!(
            archive_response.results[0].stable_session_key.as_deref(),
            Some(stable_key.as_str())
        );
        let parent_metadata = read_catalog_metadata(&storage_path, "parent").expect("parent metadata");
        let child_metadata = read_catalog_metadata(&storage_path, "child").expect("child metadata");
        assert!(!parent_metadata
            .archived_at_by_session_id
            .contains_key(&stable_key));
        assert!(child_metadata
            .archived_at_by_session_id
            .contains_key(&stable_key));

        let unarchive_response = unarchive_workspace_sessions_core(
            &workspaces,
            &engine_manager,
            &storage_path,
            "parent".to_string(),
            vec![requested_session_id.clone()],
        )
        .await
        .expect("unarchive child from parent aggregate");

        assert!(unarchive_response.results[0].ok);
        assert_eq!(
            unarchive_response.results[0].owner_workspace_id.as_deref(),
            Some("child")
        );
        let child_metadata = read_catalog_metadata(&storage_path, "child").expect("child metadata");
        assert!(!child_metadata
            .archived_at_by_session_id
            .contains_key(&stable_key));

        let folder = create_workspace_session_folder_core(
            &workspaces,
            &storage_path,
            "child".to_string(),
            "Child folder".to_string(),
            None,
        )
        .await
        .expect("create child folder")
        .folder;
        let move_response = assign_workspace_session_folders_core(
            &workspaces,
            &engine_manager,
            &storage_path,
            "parent".to_string(),
            vec![requested_session_id.clone()],
            Some(folder.id.clone()),
        )
        .await
        .expect("move child row from parent aggregate");

        assert!(move_response.results[0].ok);
        assert_eq!(
            move_response.results[0].owner_workspace_id.as_deref(),
            Some("child")
        );
        let parent_metadata = read_catalog_metadata(&storage_path, "parent").expect("parent metadata");
        let child_metadata = read_catalog_metadata(&storage_path, "child").expect("child metadata");
        assert!(!parent_metadata
            .folder_id_by_session_id
            .contains_key(&stable_key));
        assert_eq!(
            child_metadata.folder_id_by_session_id.get(&stable_key),
            Some(&folder.id)
        );

        let delete_response = delete_workspace_sessions_core(
            &workspaces,
            &sessions,
            &engine_manager,
            &storage_path,
            "parent".to_string(),
            vec![requested_session_id],
        )
        .await
        .expect("delete child from parent aggregate");

        assert!(delete_response.results[0].ok);
        assert_eq!(
            delete_response.results[0].owner_workspace_id.as_deref(),
            Some("child")
        );
        assert!(!session_path.exists());
        let child_metadata = read_catalog_metadata(&storage_path, "child").expect("child metadata");
        assert!(!child_metadata
            .folder_id_by_session_id
            .contains_key(&stable_key));

        std::fs::remove_dir_all(base).ok();
    }

    #[tokio::test]
    async fn folder_assignment_returns_partial_results_when_owner_folder_is_missing() {
        let base = std::env::temp_dir().join(format!("folder-partial-owner-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");

        let repo_path = base.join("repo");
        let child_path = repo_path.join("sub");
        std::fs::create_dir_all(&child_path).expect("create child workspace path");

        let claude_home = base.join("claude-home");
        let claude_projects_dir = claude_home.join("projects");
        write_claude_session_fixture(
            &claude_projects_dir,
            &repo_path,
            "parent-session",
            &repo_path,
            "parent mutation task",
        );
        write_claude_session_fixture(
            &claude_projects_dir,
            &child_path,
            "child-session",
            &child_path,
            "child mutation task",
        );

        let parent = workspace_entry(
            "parent",
            "Parent",
            &repo_path.to_string_lossy(),
            WorkspaceKind::Main,
            None,
        );
        let child = workspace_entry(
            "child",
            "Child",
            &child_path.to_string_lossy(),
            WorkspaceKind::Worktree,
            Some("parent"),
        );
        let workspaces = Mutex::new(HashMap::from([
            (parent.id.clone(), parent),
            (child.id.clone(), child),
        ]));
        let engine_manager = engine::EngineManager::new();
        engine_manager
            .set_engine_config(
                engine::EngineType::Claude,
                engine::EngineConfig {
                    home_dir: Some(claude_home.to_string_lossy().to_string()),
                    ..engine::EngineConfig::default()
                },
            )
            .await;

        let parent_folder = create_workspace_session_folder_core(
            &workspaces,
            &storage_path,
            "parent".to_string(),
            "Parent folder".to_string(),
            None,
        )
        .await
        .expect("create parent folder")
        .folder;

        let response = assign_workspace_session_folders_core(
            &workspaces,
            &engine_manager,
            &storage_path,
            "parent".to_string(),
            vec![
                "claude:parent-session".to_string(),
                "claude:child-session".to_string(),
            ],
            Some(parent_folder.id.clone()),
        )
        .await
        .expect("partial folder assignment should stay request-successful");

        assert_eq!(response.results.len(), 2);
        let parent_result = response
            .results
            .iter()
            .find(|result| result.session_id == "claude:parent-session")
            .expect("parent result");
        let child_result = response
            .results
            .iter()
            .find(|result| result.session_id == "claude:child-session")
            .expect("child result");
        assert!(parent_result.ok);
        assert_eq!(parent_result.owner_workspace_id.as_deref(), Some("parent"));
        assert!(!child_result.ok);
        assert_eq!(child_result.owner_workspace_id.as_deref(), Some("child"));
        assert_eq!(
            child_result.code.as_deref(),
            Some("FOLDER_METADATA_UNAVAILABLE")
        );

        let parent_metadata = read_catalog_metadata(&storage_path, "parent").expect("parent metadata");
        let child_metadata = read_catalog_metadata(&storage_path, "child").expect("child metadata");
        assert_eq!(
            parent_metadata
                .folder_id_by_session_id
                .get("claude:parent:parent-session"),
            Some(&parent_folder.id)
        );
        assert!(child_metadata.folder_id_by_session_id.is_empty());

        std::fs::remove_dir_all(base).ok();
    }

    #[tokio::test]
    async fn claude_independent_nested_workspace_session_is_not_claimed_by_parent_projection() {
        let base = std::env::temp_dir().join(format!("claude-nested-owner-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&base).expect("create temp dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");

        let repo_path = base.join("repo");
        let child_path = repo_path.join("sub");
        std::fs::create_dir_all(&child_path).expect("create child workspace path");

        let claude_home = base.join("claude-home");
        let claude_projects_dir = claude_home.join("projects");
        let session_id = "nested-claude-session";
        write_claude_session_fixture(
            &claude_projects_dir,
            &repo_path,
            session_id,
            &child_path,
            "nested workspace task",
        );

        let parent = workspace_entry(
            "parent",
            "Parent",
            &repo_path.to_string_lossy(),
            WorkspaceKind::Main,
            None,
        );
        let child = workspace_entry(
            "child",
            "Child",
            &child_path.to_string_lossy(),
            WorkspaceKind::Main,
            None,
        );
        let workspaces = Mutex::new(HashMap::from([
            (parent.id.clone(), parent),
            (child.id.clone(), child),
        ]));
        let engine_manager = engine::EngineManager::new();
        engine_manager
            .set_engine_config(
                engine::EngineType::Claude,
                engine::EngineConfig {
                    home_dir: Some(claude_home.to_string_lossy().to_string()),
                    ..engine::EngineConfig::default()
                },
            )
            .await;

        let parent_data = build_workspace_scope_catalog_data(
            &workspaces,
            &engine_manager,
            &storage_path,
            "parent",
            SessionCatalogScanMode::Bounded(20),
            WorkspaceSessionAttributionMode::Related,
        )
        .await
        .expect("build parent catalog data");
        let child_data = build_workspace_scope_catalog_data(
            &workspaces,
            &engine_manager,
            &storage_path,
            "child",
            SessionCatalogScanMode::Bounded(20),
            WorkspaceSessionAttributionMode::Related,
        )
        .await
        .expect("build child catalog data");

        assert!(!parent_data
            .entries
            .iter()
            .any(|entry| entry.session_id == format!("claude:{session_id}")));

        let child_claude_entry = child_data
            .entries
            .iter()
            .find(|entry| entry.session_id == format!("claude:{session_id}"))
            .expect("child projection should include nested claude session");
        assert_eq!(child_claude_entry.workspace_id, "child");
        assert_eq!(
            child_claude_entry.matched_workspace_id.as_deref(),
            Some("child")
        );

        std::fs::remove_dir_all(base).ok();
    }

    #[tokio::test]
    async fn codex_background_guardian_session_is_excluded_from_catalog_projection() {
        let base = std::env::temp_dir().join(format!("codex-guardian-catalog-{}", Uuid::new_v4()));
        let day_dir = base
            .join("codex-home")
            .join("sessions")
            .join("2026")
            .join("08")
            .join("31");
        std::fs::create_dir_all(&day_dir).expect("create sessions day dir");
        let workspace_path = base.join("workspace");
        std::fs::create_dir_all(&workspace_path).expect("create workspace dir");
        let storage_path = base.join("workspaces.json");
        std::fs::write(&storage_path, "[]").expect("seed storage path");

        let cwd = workspace_path.to_string_lossy().to_string();
        let guardian_meta = serde_json::json!({
            "timestamp": "2026-08-31T01:00:00.000Z",
            "type": "session_meta",
            "payload": {
                "id": "guardian-catalog-test",
                "cwd": cwd,
                "originator": "Codex Desktop",
                "source": {"subagent": {"other": "guardian"}},
                "thread_source": "guardian_review"
            }
        })
        .to_string();
        let normal_meta = serde_json::json!({
            "timestamp": "2026-08-31T01:01:00.000Z",
            "type": "session_meta",
            "payload": {
                "id": "normal-catalog-test",
                "cwd": cwd,
                "originator": "Codex Desktop",
                "source": "cli"
            }
        })
        .to_string();
        std::fs::write(
            day_dir.join("rollout-2026-08-31T01-00-00-guardian-catalog-test.jsonl"),
            guardian_meta + "\n",
        )
        .expect("write guardian fixture");
        std::fs::write(
            day_dir.join("rollout-2026-08-31T01-01-00-normal-catalog-test.jsonl"),
            normal_meta + "\n",
        )
        .expect("write normal fixture");

        let mut workspace =
            workspace_entry("main", "Main", &cwd, WorkspaceKind::Main, None);
        workspace.settings.codex_home =
            Some(base.join("codex-home").to_string_lossy().to_string());
        let workspaces = Mutex::new(HashMap::from([(workspace.id.clone(), workspace)]));
        let engine_manager = engine::EngineManager::new();

        let data = build_workspace_scope_catalog_data(
            &workspaces,
            &engine_manager,
            &storage_path,
            "main",
            SessionCatalogScanMode::Bounded(20),
            WorkspaceSessionAttributionMode::Related,
        )
        .await
        .expect("build catalog data");

        assert!(
            data.entries
                .iter()
                .any(|entry| entry.session_id == "normal-catalog-test"),
            "visible session should produce a catalog entry"
        );
        assert!(
            !data.entries
                .iter()
                .any(|entry| entry.session_id == "guardian-catalog-test"),
            "guardian background session must not produce a catalog entry"
        );

        std::fs::remove_dir_all(base).ok();
    }
