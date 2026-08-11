use super::*;
use serde_json::json;
use tokio::sync::broadcast::error::TryRecvError;

fn test_workspace_path() -> PathBuf {
    std::env::temp_dir().join("ccgui-claude-test-workspace")
}

fn test_external_spec_root() -> String {
    std::env::temp_dir()
        .join("ccgui-external-openspec")
        .to_string_lossy()
        .to_string()
}

fn claude_settings_with_curated_skill() -> crate::types::AppSettings {
    let mut settings = crate::types::AppSettings::default();
    settings.enabled_curated_skill_ids = vec!["lazy-senior-dev".to_string()];
    settings
}

fn create_fake_claude_stream_environment(lines: &[&str]) -> (PathBuf, PathBuf, PathBuf) {
    let root = std::env::temp_dir().join(format!("ccgui-claude-stream-{}", uuid::Uuid::new_v4()));
    let workspace_path = root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create fake claude workspace");

    #[cfg(windows)]
    let script_path = root.join("fake-claude.cmd");
    #[cfg(not(windows))]
    let script_path = root.join("fake-claude.sh");

    #[cfg(windows)]
    {
        let mut script = String::from("@echo off\r\n");
        for line in lines {
            script.push_str("echo ");
            script.push_str(line);
            script.push_str("\r\n");
        }
        script.push_str("exit /b 0\r\n");
        std::fs::write(&script_path, script).expect("write fake claude cmd");
    }

    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;

        let mut script = String::from("#!/bin/sh\n");
        script.push_str("cat <<'EOF'\n");
        for line in lines {
            script.push_str(line);
            script.push('\n');
        }
        script.push_str("EOF\n");
        std::fs::write(&script_path, script).expect("write fake claude shell");

        let mut permissions = std::fs::metadata(&script_path)
            .expect("read fake claude metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&script_path, permissions).expect("chmod fake claude shell");
    }

    (root, workspace_path, script_path)
}

fn create_fake_claude_script(script_body: &str) -> (PathBuf, PathBuf, PathBuf) {
    let root = std::env::temp_dir().join(format!("ccgui-claude-script-{}", uuid::Uuid::new_v4()));
    let workspace_path = root.join("workspace");
    std::fs::create_dir_all(&workspace_path).expect("create fake claude workspace");

    #[cfg(windows)]
    let script_path = root.join("fake-claude.cmd");
    #[cfg(not(windows))]
    let script_path = root.join("fake-claude.sh");

    #[cfg(windows)]
    {
        std::fs::write(&script_path, script_body).expect("write fake claude cmd");
    }

    #[cfg(not(windows))]
    {
        use std::os::unix::fs::PermissionsExt;

        std::fs::write(&script_path, script_body).expect("write fake claude shell");
        let mut permissions = std::fs::metadata(&script_path)
            .expect("read fake claude metadata")
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&script_path, permissions).expect("chmod fake claude shell");
    }

    (root, workspace_path, script_path)
}

fn test_session_with_bin(workspace_path: PathBuf, script_path: PathBuf) -> ClaudeSession {
    ClaudeSession::new(
        "test-workspace".to_string(),
        workspace_path,
        Some(EngineConfig {
            bin_path: Some(script_path.to_string_lossy().to_string()),
            home_dir: None,
            custom_args: None,
            default_model: None,
        }),
    )
}

fn drain_turn_events(
    receiver: &mut tokio::sync::broadcast::Receiver<ClaudeTurnEvent>,
) -> Vec<ClaudeTurnEvent> {
    let mut events = Vec::new();
    loop {
        match receiver.try_recv() {
            Ok(event) => events.push(event),
            Err(TryRecvError::Empty) => break,
            Err(error) => panic!("unexpected broadcast error: {:?}", error),
        }
    }
    events
}

fn assert_no_empty_prompt_after_print_flag(args: &[String]) {
    let print_flag_index = args
        .iter()
        .position(|arg| arg == "-p")
        .expect("missing Claude print flag");
    let next_arg = args
        .get(print_flag_index + 1)
        .expect("missing arg after Claude print flag");

    assert_ne!(
        next_arg, "",
        "stream-json stdin mode must not add an empty positional prompt after -p"
    );
}

fn turn_error_event(events: &[ClaudeTurnEvent]) -> Option<(&String, &Option<String>)> {
    events.iter().find_map(|event| match &event.event {
        EngineEvent::TurnError { error, code, .. } => Some((error, code)),
        _ => None,
    })
}

#[test]
fn session_creation() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);

    assert_eq!(session.workspace_id, "test-workspace");
}

#[test]
fn format_synthetic_approval_completion_text_aggregates_multiple_entries() {
    let text = format_synthetic_approval_completion_text(&[
        SyntheticApprovalSummaryEntry {
            summary: "Approved and wrote aaa.txt".to_string(),
            path: Some("aaa.txt".to_string()),
            kind: Some("add".to_string()),
            status: "completed".to_string(),
        },
        SyntheticApprovalSummaryEntry {
            summary: "Approved and wrote bbb.txt".to_string(),
            path: Some("bbb.txt".to_string()),
            kind: Some("add".to_string()),
            status: "completed".to_string(),
        },
    ])
    .expect("aggregated summary");

    assert!(text.contains("Completed approved operations:"));
    assert!(text.contains("- Approved and wrote aaa.txt"));
    assert!(text.contains("- Approved and wrote bbb.txt"));
}

#[test]
fn format_synthetic_approval_resume_message_embeds_marker_payload() {
    let message = format_synthetic_approval_resume_message(&[SyntheticApprovalSummaryEntry {
        summary: "Approved and updated aaa.txt".to_string(),
        path: Some("aaa.txt".to_string()),
        kind: Some("modified".to_string()),
        status: "completed".to_string(),
    }]);

    assert!(message.contains(SYNTHETIC_APPROVAL_RESUME_MARKER_PREFIX));
    assert!(message.contains("\"path\":\"aaa.txt\""));
    assert!(message.contains("\"kind\":\"modified\""));
    assert!(message.contains("Please continue from the current workspace state"));
}

#[tokio::test]
async fn ask_user_question_registers_and_clears_pending_request() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let input = json!({
        "questions": [
            {
                "header": "确认",
                "question": "继续吗？",
                "options": [{ "label": "继续", "description": "继续执行" }]
            }
        ]
    });

    let event = session
        .convert_ask_user_question_to_request("tool-ask-1", &input, "turn-1")
        .expect("request user input event");

    let request_id = match event {
        EngineEvent::RequestUserInput { request_id, .. } => request_id,
        other => panic!("unexpected event: {:?}", other),
    };

    assert!(session.has_pending_user_input(&request_id));

    let result = json!({
        "answers": {
            "q-0": {
                "answers": ["继续"]
            }
        }
    });
    session
        .respond_to_user_input(request_id.clone(), result)
        .await
        .expect("respond success");

    assert!(!session.has_pending_user_input(&request_id));
}

#[test]
fn ask_user_question_preserves_multi_select_flag() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let input = json!({
        "questions": [
            {
                "header": "关注点",
                "question": "可多选",
                "multiSelect": true,
                "options": [{ "label": "性能", "description": "" }]
            }
        ]
    });

    let event = session
        .convert_ask_user_question_to_request("tool-ask-multi", &input, "turn-1")
        .expect("request user input event");

    let questions = match event {
        EngineEvent::RequestUserInput { questions, .. } => questions,
        other => panic!("unexpected event: {:?}", other),
    };
    let question = questions
        .as_array()
        .and_then(|arr| arr.first())
        .expect("first question");
    assert_eq!(question["multiSelect"], json!(true));
}

#[test]
fn has_pending_user_input_accepts_numeric_id_for_backward_compat() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    if let Ok(mut pending) = session.pending_user_inputs.lock() {
        pending.insert("42".to_string(), "turn-42".to_string());
    }
    assert!(session.has_pending_user_input(&json!(42)));
    assert!(session.has_pending_user_input(&json!("42")));
}

#[test]
fn has_any_pending_user_input_reports_presence() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    assert!(!session.has_any_pending_user_input());
    if let Ok(mut pending) = session.pending_user_inputs.lock() {
        pending.insert("ask-1".to_string(), "turn-1".to_string());
    }
    assert!(session.has_any_pending_user_input());
}

#[tokio::test]
async fn respond_to_user_input_rejects_mismatched_request_id() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    if let Ok(mut pending) = session.pending_user_inputs.lock() {
        pending.insert("ask-fallback".to_string(), "turn-1".to_string());
    }

    let result = json!({
        "answers": {
            "q-0": {
                "answers": ["继续"]
            }
        }
    });
    let err = session
        .respond_to_user_input(json!(999), result)
        .await
        .expect_err("mismatched request_id should fail");

    assert!(err.contains("unknown request_id"));
    assert!(session.has_any_pending_user_input());
}

#[tokio::test]
async fn respond_to_user_input_settles_note_only_mcp_answer() {
    // A note-only answer (free text, NO option selected) must still settle the
    // waiting MCP tool call — guards the ask_via_mcp oneshot delivery path.
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let request_id = "ask-note-only";
    if let Ok(mut pending) = session.pending_user_inputs.lock() {
        pending.insert(request_id.to_string(), "turn-note-only".to_string());
    }
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    if let Ok(mut waiters) = session.mcp_answer_waiters.lock() {
        waiters.insert(request_id.to_string(), tx);
    }

    // Note-only payload: the frontend emits the note under the question id with a
    // `user_note:` prefix and no option value.
    let result = json!({
        "answers": {
            "q-0": { "answers": ["user_note: just a note"] }
        }
    });
    session
        .respond_to_user_input(json!(request_id), result)
        .await
        .expect("note-only answer should settle, not error");

    let answer = rx
        .await
        .expect("MCP waiter must receive the note-only answer (else ask_via_mcp hangs)");
    assert!(
        answer.contains("just a note"),
        "settled answer should carry the note text, got: {answer}"
    );
    assert!(
        !session.has_any_pending_user_input(),
        "pending request should be consumed on settle"
    );
}

#[test]
fn build_command_adds_external_spec_root_when_configured() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let mut params = SendMessageParams::default();
    params.text = "hello".to_string();
    params.custom_spec_root = Some(test_external_spec_root());

    let command = session.build_command(&params, false, true, None, None);
    let args: Vec<String> = command
        .as_std()
        .get_args()
        .map(|arg| arg.to_string_lossy().to_string())
        .collect();

    assert!(args.windows(2).any(|window| {
        window[0] == "--add-dir" && window[1] == params.custom_spec_root.clone().unwrap()
    }));
}

#[tokio::test]
async fn build_command_raises_mcp_tool_timeout_when_ask_wired() {
    // Root cause of the "answers >60s are lost" bug (2026-07-04): the CLI's
    // per-request MCP tool-call fetch timeout defaults to 60s for remote HTTP
    // servers, so it abandons our AskUserQuestion call before a slow user answers.
    // build_command must raise MCP_TOOL_TIMEOUT to our 1800s server bound whenever
    // the MCP ask is wired (non-plan mode + server started).
    let manager = std::sync::Arc::new(ClaudeSessionManager::new());
    // Idempotent; starts the process-global in-process MCP server so the wiring
    // branch in build_command is taken.
    init_askuser_mcp_global(manager)
        .await
        .expect("MCP server should start for the test");
    // Don't fight a user-provided override if one is set in the test env.
    if std::env::var_os("MCP_TOOL_TIMEOUT").is_some() {
        return;
    }

    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let mut params = SendMessageParams::default();
    params.text = "hello".to_string();
    // Non-plan mode → MCP ask is wired.
    params.access_mode = Some("acceptEdits".to_string());

    let command = session.build_command(&params, false, true, None, None);
    let timeout_env = command
        .as_std()
        .get_envs()
        .find(|(key, _)| *key == "MCP_TOOL_TIMEOUT")
        .and_then(|(_, value)| value)
        .map(|value| value.to_string_lossy().to_string());

    assert_eq!(
        timeout_env.as_deref(),
        Some("1800000"),
        "MCP_TOOL_TIMEOUT must be raised to 1800s when the AskUserQuestion MCP ask is wired"
    );
}

#[test]
fn build_command_sets_disable_thinking_env_when_requested() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let mut params = SendMessageParams::default();
    params.text = "hello".to_string();
    params.disable_thinking = true;

    let command = session.build_command(&params, false, true, None, None);
    let disable_thinking_env = command
        .as_std()
        .get_envs()
        .find(|(key, _)| *key == "CLAUDE_CODE_DISABLE_THINKING")
        .and_then(|(_, value)| value)
        .map(|value| value.to_string_lossy().to_string());

    assert_eq!(disable_thinking_env.as_deref(), Some("1"));
}

#[test]
fn should_use_stream_json_input_for_multiline_text_without_images() {
    let mut params = SendMessageParams::default();
    params.text = "line1\nline2".to_string();
    assert!(ClaudeSession::should_use_stream_json_input(&params));
}

#[test]
fn should_use_stream_json_input_for_single_line_text_without_images() {
    let mut params = SendMessageParams::default();
    params.text = "single line".to_string();
    assert!(ClaudeSession::should_use_stream_json_input(&params));
}

#[test]
fn build_command_uses_stream_json_for_single_line_text() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let mut params = SendMessageParams::default();
    params.text = "single line".to_string();

    let use_stream_json_input = ClaudeSession::should_use_stream_json_input(&params);
    let command = session.build_command(&params, use_stream_json_input, true, None, None);
    let args: Vec<String> = command
        .as_std()
        .get_args()
        .map(|arg| arg.to_string_lossy().to_string())
        .collect();

    assert!(args
        .windows(2)
        .any(|window| { window[0] == "--input-format" && window[1] == "stream-json" }));
    assert!(args.iter().all(|arg| arg != "single line"));
    assert_no_empty_prompt_after_print_flag(&args);
}

#[test]
fn build_command_skips_curated_append_on_windows() {
    assert!(ClaudeSession::should_skip_curated_skill_append_for_binary(
        r"C:\Users\demo\AppData\Roaming\npm\claude.cmd",
        true,
    ));
    assert!(ClaudeSession::should_skip_curated_skill_append_for_binary(
        r"C:\Users\demo\AppData\Roaming\npm\claude.ps1",
        true,
    ));
    assert!(!ClaudeSession::should_skip_curated_skill_append_for_binary(
        "/opt/homebrew/bin/claude",
        false,
    ));
    assert!(ClaudeSession::should_skip_curated_skill_append_for_binary(
        r"C:\Program Files\Claude\claude.exe",
        true,
    ));
    assert!(ClaudeSession::should_skip_curated_skill_append_for_binary(
        "claude", true,
    ));
}

#[test]
#[cfg(not(windows))]
fn build_command_keeps_curated_append_on_non_wrapper_path() {
    let (_root, workspace_path, script_path) = create_fake_claude_script("#!/bin/sh\n");
    let session = test_session_with_bin(workspace_path, script_path);
    let mut params = SendMessageParams::default();
    params.text = "single line".to_string();
    let settings = claude_settings_with_curated_skill();

    let command = session.build_command(&params, true, true, Some(&settings), None);
    let args: Vec<String> = command
        .as_std()
        .get_args()
        .map(|arg| arg.to_string_lossy().to_string())
        .collect();

    assert!(args.iter().any(|arg| arg == "--append-system-prompt"));
    assert!(args.iter().any(|arg| arg.contains("lazy-senior-dev")));
}

#[test]
#[cfg(windows)]
fn build_command_omits_curated_append_on_windows() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let mut params = SendMessageParams::default();
    params.text = "single line".to_string();
    let settings = claude_settings_with_curated_skill();

    let command = session.build_command(&params, true, true, Some(&settings), None);
    let args: Vec<String> = command
        .as_std()
        .get_args()
        .map(|arg| arg.to_string_lossy().to_string())
        .collect();

    assert!(!args.iter().any(|arg| arg == "--append-system-prompt"));
    assert!(!args.iter().any(|arg| arg.contains("lazy-senior-dev")));
}

#[test]
fn build_command_accepts_curated_activation_hint_file_path() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let mut params = SendMessageParams::default();
    params.text = "single line".to_string();
    let hint_path = std::env::temp_dir()
        .join("ccgui-claude-hints")
        .join("enabled-curated-skills.md");

    let command = session.build_command(&params, true, true, None, Some(&hint_path));
    let args: Vec<String> = command
        .as_std()
        .get_args()
        .map(|arg| arg.to_string_lossy().to_string())
        .collect();

    assert!(args.windows(2).any(|window| {
        window[0] == "--append-system-prompt-file"
            && window[1] == hint_path.to_string_lossy().as_ref()
    }));
    assert!(!args.iter().any(|arg| arg == "--append-system-prompt"));
    assert!(!args.iter().any(|arg| arg.contains("Ponytail")));
}

#[test]
fn build_command_keeps_special_character_prompt_out_of_argv() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let mut params = SendMessageParams::default();
    params.text = "run skill /review & echo %PATH% | more > out (test)!".to_string();

    let use_stream_json_input = ClaudeSession::should_use_stream_json_input(&params);
    let command = session.build_command(&params, use_stream_json_input, true, None, None);
    let args: Vec<String> = command
        .as_std()
        .get_args()
        .map(|arg| arg.to_string_lossy().to_string())
        .collect();

    assert!(args
        .windows(2)
        .any(|window| { window[0] == "--input-format" && window[1] == "stream-json" }));
    assert!(args.iter().all(|arg| arg != &params.text));
    assert_no_empty_prompt_after_print_flag(&args);
}

#[test]
fn build_command_uses_stream_json_for_multiline_text() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let mut params = SendMessageParams::default();
    params.text = "line1\nline2".to_string();

    let use_stream_json_input = ClaudeSession::should_use_stream_json_input(&params);
    let command = session.build_command(&params, use_stream_json_input, true, None, None);
    let args: Vec<String> = command
        .as_std()
        .get_args()
        .map(|arg| arg.to_string_lossy().to_string())
        .collect();

    assert!(args
        .windows(2)
        .any(|window| { window[0] == "--input-format" && window[1] == "stream-json" }));
    assert!(args.iter().all(|arg| arg != "line1\nline2"));
    assert_no_empty_prompt_after_print_flag(&args);
}

#[test]
fn build_resume_command_uses_stream_json_for_multiline_answer() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    let mut params = SendMessageParams::default();
    params.text = "line1\r\nline2".to_string();
    params.continue_session = true;
    params.session_id = Some("33333333-3333-4333-8333-333333333333".to_string());
    params.images = None;

    let use_stream_json_input = ClaudeSession::should_use_stream_json_input(&params);
    let command = session.build_command(&params, use_stream_json_input, true, None, None);
    let args: Vec<String> = command
        .as_std()
        .get_args()
        .map(|arg| arg.to_string_lossy().to_string())
        .collect();

    assert!(args.windows(2).any(|window| {
        window[0] == "--resume" && window[1] == "33333333-3333-4333-8333-333333333333"
    }));
    assert!(args
        .windows(2)
        .any(|window| { window[0] == "--input-format" && window[1] == "stream-json" }));
    assert!(args.iter().all(|arg| arg != "line1\r\nline2"));
    assert_no_empty_prompt_after_print_flag(&args);
}

#[test]
fn claude_cli_binary_diagnostics_classifies_configured_wrapper() {
    let session = ClaudeSession::new(
        "test-workspace".to_string(),
        test_workspace_path(),
        Some(EngineConfig {
            bin_path: Some("C:/tools/claude.ps1".to_string()),
            home_dir: None,
            custom_args: None,
            default_model: None,
        }),
    );

    let (bin, wrapper_kind) = session.cli_binary_diagnostics();

    assert_eq!(bin, "C:/tools/claude.ps1");
    assert_eq!(wrapper_kind, "ps1-wrapper");
}

#[test]
fn ask_user_question_response_summary_does_not_require_answer_text() {
    let result = json!({
        "answers": {
            "q-0": { "answers": ["secret selection"] },
            "q-1": { "answers": [] }
        },
        "skippedQuestionIds": ["q-1"]
    });

    let (answer_count, non_empty_answer_count, has_skipped_questions) =
        ClaudeSession::summarize_user_input_response(&result);

    assert_eq!(answer_count, 2);
    assert_eq!(non_empty_answer_count, 1);
    assert!(has_skipped_questions);
}

#[tokio::test]
async fn ask_user_question_resume_fails_explicitly_without_session_id() {
    let session = ClaudeSession::new("test-workspace".to_string(), test_workspace_path(), None);
    #[cfg(windows)]
    let script = "@echo off\r\nping -n 6 127.0.0.1 > nul\r\n";
    #[cfg(not(windows))]
    let script = "#!/bin/sh\nsleep 5\n";
    let (root, workspace_path, script_path) = create_fake_claude_script(script);
    let child = Command::new(script_path)
        .current_dir(workspace_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("fake active Claude child should spawn");
    {
        let mut active = session.active_processes.lock().await;
        active.insert("turn-missing-session".to_string(), child);
    }
    if let Ok(mut pending) = session.pending_user_inputs.lock() {
        pending.insert(
            "request-missing-session".to_string(),
            "turn-missing-session".to_string(),
        );
    }
    session
        .respond_to_user_input(
            json!("request-missing-session"),
            json!({ "answers": { "q-0": { "answers": ["answer"] } } }),
        )
        .await
        .expect("response should be accepted before resume");

    let params = SendMessageParams::default();
    let error = session
        .handle_ask_user_question_resume("turn-missing-session", &params, &None, true, None)
        .await
        .expect_err("missing session id should fail explicitly");

    assert!(error.contains("no Claude session_id"));
    assert!(error.contains("wrapper_kind="));
    assert!(
        session.active_process_ids().await.is_empty(),
        "missing-session resume failure should remove the active child"
    );
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn ask_user_question_resume_spawn_failure_includes_wrapper_context() {
    let missing_bin = std::env::temp_dir()
        .join(format!("missing-claude-{}", uuid::Uuid::new_v4()))
        .to_string_lossy()
        .to_string();
    let session = ClaudeSession::new(
        "test-workspace".to_string(),
        test_workspace_path(),
        Some(EngineConfig {
            bin_path: Some(missing_bin),
            home_dir: None,
            custom_args: None,
            default_model: None,
        }),
    );
    let diagnostics = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let diagnostics_for_sink = std::sync::Arc::clone(&diagnostics);
    session.set_ask_user_question_resume_diagnostic_sink(Some(std::sync::Arc::new(
        move |diagnostic| {
            diagnostics_for_sink
                .lock()
                .expect("diagnostic sink should lock")
                .push(diagnostic);
        },
    )));
    session.register_turn_thread_id("turn-spawn-failure", "thread-spawn-failure");
    if let Ok(mut pending) = session.pending_user_inputs.lock() {
        pending.insert(
            "request-spawn-failure".to_string(),
            "turn-spawn-failure".to_string(),
        );
    }
    session
        .respond_to_user_input(
            json!("request-spawn-failure"),
            json!({ "answers": { "q-0": { "answers": ["answer"] } } }),
        )
        .await
        .expect("response should be accepted before resume");

    let mut params = SendMessageParams::default();
    params.session_id = Some("33333333-3333-4333-8333-333333333333".to_string());
    params.continue_session = true;
    let error = session
        .handle_ask_user_question_resume(
            "turn-spawn-failure",
            &params,
            &Some("33333333-3333-4333-8333-333333333333".to_string()),
            true,
            None,
        )
        .await
        .expect_err("missing resume binary should fail spawn");

    assert!(error.contains("Failed to spawn AskUserQuestion resume process"));
    assert!(error.contains("wrapper_kind="));
    assert!(error.contains("bin="));
    let captured = diagnostics.lock().expect("diagnostic list should lock");
    let diagnostic = captured
        .last()
        .expect("spawn failure should emit a resume diagnostic");
    assert_eq!(diagnostic.workspace_id, "test-workspace");
    assert_eq!(
        diagnostic.thread_id.as_deref(),
        Some("thread-spawn-failure")
    );
    assert_eq!(diagnostic.turn_id, "turn-spawn-failure");
    assert_eq!(
        diagnostic.request_id.as_deref(),
        Some("request-spawn-failure")
    );
    assert!(!diagnostic.succeeded);
    assert!(diagnostic
        .error
        .as_deref()
        .unwrap_or_default()
        .contains("Failed to spawn AskUserQuestion resume process"));
}

#[test]
fn empty_ask_user_question_answer_skips_question_without_reasking() {
    let answer = format_ask_user_answer(&json!({ "answers": {} }));

    assert!(answer.contains("skipped this AskUserQuestion"));
    assert!(answer.contains("Do not ask the same question again"));
    assert!(answer.contains("continue the original task"));
}

#[test]
fn partial_ask_user_question_answer_preserves_answers_and_skips_remaining_questions() {
    let answer = format_ask_user_answer(&json!({
        "answers": {
            "q-1": { "answers": ["Docs"] },
            "q-2": { "answers": [] }
        },
        "skippedQuestionIds": ["q-2"]
    }));

    assert!(answer.contains("q-1=Docs"));
    assert!(answer.contains("AskUserQuestionResultBase64:"));
    assert!(answer.contains("skipped 1 remaining question"));
    assert!(answer.contains("Do not ask the skipped question"));
}

#[tokio::test]
async fn send_message_batches_windows_text_deltas_without_delaying_other_platforms() {
    let stream_lines = [
        r#"{"type":"assistant_message_delta","delta":"a"}"#,
        r#"{"type":"assistant_message_delta","delta":"b"}"#,
        r#"{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"think"}]}}"#,
    ];
    let (root, workspace_path, script_path) = create_fake_claude_stream_environment(&stream_lines);

    let session = ClaudeSession::new(
        "test-workspace".to_string(),
        workspace_path,
        Some(EngineConfig {
            bin_path: Some(script_path.to_string_lossy().to_string()),
            home_dir: None,
            custom_args: None,
            default_model: None,
        }),
    );
    let mut receiver = session.subscribe();
    let mut params = SendMessageParams::default();
    params.text = "hello".to_string();

    let response = session
        .send_message(params, "turn-stream")
        .await
        .expect("fake claude stream should succeed");
    let events = drain_turn_events(&mut receiver);
    let _ = std::fs::remove_dir_all(&root);

    assert_eq!(response, "ab");
    assert!(events.iter().all(|event| event.turn_id == "turn-stream"));

    match &events[0].event {
        EngineEvent::SessionStarted { session_id, .. } => assert_eq!(session_id, "pending"),
        other => panic!("expected pending session started, got {:?}", other),
    }
    assert!(matches!(&events[1].event, EngineEvent::TurnStarted { .. }));

    let text_deltas: Vec<(usize, String)> = events
        .iter()
        .enumerate()
        .filter_map(|(index, event)| match &event.event {
            EngineEvent::TextDelta { text, .. } => Some((index, text.clone())),
            _ => None,
        })
        .collect();
    let first_text_timing = events
        .iter()
        .find_map(|event| {
            matches!(&event.event, EngineEvent::TextDelta { .. })
                .then(|| event.stream_timing.as_ref())
                .flatten()
        })
        .expect("first text delta should include stream startup timing");
    assert!(first_text_timing.process_spawn_started_at_ms.is_some());
    assert!(first_text_timing.process_spawned_at_ms.is_some());
    assert!(first_text_timing.stdin_closed_at_ms.is_some());
    assert!(first_text_timing.turn_started_at_ms.is_some());
    assert!(first_text_timing.first_stdout_line_at_ms.is_some());
    assert!(first_text_timing.first_valid_stream_event_at_ms.is_some());
    assert!(first_text_timing.first_text_delta_at_ms.is_some());
    assert!(first_text_timing.session_emitted_at_ms > 0);
    let reasoning_index = events
        .iter()
        .position(|event| matches!(&event.event, EngineEvent::ReasoningDelta { .. }))
        .expect("expected reasoning delta");
    let completed_index = events
        .iter()
        .position(|event| matches!(&event.event, EngineEvent::TurnCompleted { .. }))
        .expect("expected turn completed");

    if cfg!(windows) {
        assert_eq!(
            text_deltas,
            vec![(2, "ab".to_string())],
            "windows should batch adjacent text deltas before the next non-text event"
        );
    } else {
        assert_eq!(
            text_deltas,
            vec![(2, "a".to_string()), (3, "b".to_string())],
            "non-windows platforms should keep immediate per-delta flushing"
        );
    }
    assert!(text_deltas
        .iter()
        .all(|(index, _)| *index < reasoning_index));
    assert!(reasoning_index < completed_index);

    match &events[completed_index].event {
        EngineEvent::TurnCompleted { result, .. } => {
            assert_eq!(result.as_ref(), Some(&json!({ "text": "ab" })));
        }
        other => panic!("expected turn completed, got {:?}", other),
    }
}

#[tokio::test]
async fn send_message_emits_text_delta_before_process_completion() {
    #[cfg(windows)]
    let script_body = concat!(
        "@echo off\r\n",
        "echo {\"type\":\"assistant_message_delta\",\"delta\":\"live\"}\r\n",
        "powershell -NoProfile -Command \"Start-Sleep -Milliseconds 3000\"\r\n",
        "echo {\"type\":\"assistant_message_delta\",\"delta\":\" tail\"}\r\n",
        "echo {\"type\":\"result\",\"session_id\":\"11111111-1111-4111-8111-111111111111\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"live tail\"}]}}\r\n",
        "exit /b 0\r\n"
    );
    #[cfg(not(windows))]
    let script_body = concat!(
        "#!/bin/sh\n",
        "printf '%s\\n' '{\"type\":\"assistant_message_delta\",\"delta\":\"live\"}'\n",
        "sleep 3\n",
        "printf '%s\\n' '{\"type\":\"assistant_message_delta\",\"delta\":\" tail\"}'\n",
        "printf '%s\\n' '{\"type\":\"result\",\"session_id\":\"11111111-1111-4111-8111-111111111111\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"live tail\"}]}}'\n"
    );
    let (root, workspace_path, script_path) = create_fake_claude_script(script_body);
    let session = test_session_with_bin(workspace_path, script_path);
    let mut receiver = session.subscribe();
    let mut params = SendMessageParams::default();
    params.text = "hello".to_string();

    let send_future = session.send_message(params, "turn-live-before-exit");
    tokio::pin!(send_future);

    let first_text = loop {
        tokio::select! {
            result = &mut send_future => {
                panic!("send_message completed before a live text delta was observed: {:?}", result);
            }
            event = receiver.recv() => {
                let event = event.expect("receive claude event before completion");
                if let EngineEvent::TextDelta { text, .. } = event.event {
                    break text;
                }
            }
            _ = tokio::time::sleep(std::time::Duration::from_secs(10)) => {
                panic!("expected a text delta before the delayed fake Claude process completed");
            }
        }
    };

    assert_eq!(first_text, "live");

    let response = send_future
        .await
        .expect("fake claude stream should eventually complete");
    let _ = std::fs::remove_dir_all(&root);

    assert_eq!(response, "live tail");
}

#[tokio::test]
async fn send_message_treats_stream_result_as_raw_and_emits_single_final_completion() {
    let stream_lines = [
        r#"{"type":"result","session_id":"11111111-1111-4111-8111-111111111111","message":{"content":[{"type":"text","text":"final answer"}]}}"#,
    ];
    let (root, workspace_path, script_path) = create_fake_claude_stream_environment(&stream_lines);

    let session = ClaudeSession::new(
        "test-workspace".to_string(),
        workspace_path,
        Some(EngineConfig {
            bin_path: Some(script_path.to_string_lossy().to_string()),
            home_dir: None,
            custom_args: None,
            default_model: None,
        }),
    );
    let mut receiver = session.subscribe();
    let mut params = SendMessageParams::default();
    params.text = "hello".to_string();

    let response = session
        .send_message(params, "turn-result")
        .await
        .expect("fake claude result stream should succeed");
    let events = drain_turn_events(&mut receiver);
    let _ = std::fs::remove_dir_all(&root);

    assert_eq!(response, "final answer");
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event.event, EngineEvent::TurnCompleted { .. }))
            .count(),
        1
    );
    assert!(events.iter().any(|event| matches!(
        event.event,
        EngineEvent::Raw {
            engine: EngineType::Claude,
            ..
        }
    )));
    let completed = events
        .iter()
        .find_map(|event| match &event.event {
            EngineEvent::TurnCompleted { result, .. } => result.as_ref(),
            _ => None,
        })
        .expect("final completion payload");
    assert_eq!(completed, &json!({ "text": "final answer" }));
}

/// Issue #983: structured `backgroundTaskId` must suppress post-result grace
/// tree-kill so a still-running Claude background shell can outlive 5s and
/// settle via provider EOF (D4) instead of force-kill.
///
/// Fake stream: tool result with backgroundTaskId → result → sleep 7s.
/// Without blockers the grace path would kill ~5s; with blockers we must wait
/// until the process exits (~7s) and still complete successfully.
#[cfg(unix)]
#[tokio::test]
async fn send_message_waits_past_grace_when_structured_background_task_active() {
    let script_body = concat!(
        "#!/bin/sh\n",
        "echo '{\"type\":\"user\",\"toolUseResult\":{\"backgroundTaskId\":\"bg-wait-1\",\"output\":\"started\"}}'\n",
        "echo '{\"type\":\"result\",\"session_id\":\"11111111-1111-4111-8111-111111111111\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"final answer\"}]}}'\n",
        "# Keep the CLI process (and stdout pipe) alive past CLAUDE_POST_RESULT_GRACE.\n",
        "sleep 7\n",
        "exit 0\n",
    );
    let (root, workspace_path, script_path) = create_fake_claude_script(script_body);

    let session = ClaudeSession::new(
        "test-workspace".to_string(),
        workspace_path,
        Some(EngineConfig {
            bin_path: Some(script_path.to_string_lossy().to_string()),
            home_dir: None,
            custom_args: None,
            default_model: None,
        }),
    );
    let mut receiver = session.subscribe();
    let mut params = SendMessageParams::default();
    params.text = "run background".to_string();

    let started = std::time::Instant::now();
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        session.send_message(params, "turn-bg-blocker"),
    )
    .await
    .expect("send_message must finish when provider exits after WaitBgTasks")
    .expect("background-blocked turn should succeed without grace force-kill");
    let elapsed = started.elapsed();

    let events = drain_turn_events(&mut receiver);
    let _ = std::fs::remove_dir_all(&root);

    assert_eq!(response, "final answer");
    assert!(
        elapsed >= std::time::Duration::from_secs(6),
        "expected wait past 5s grace when backgroundTaskId is active; elapsed={elapsed:?}"
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event.event, EngineEvent::TurnCompleted { .. }))
            .count(),
        1,
        "exactly one TurnCompleted after provider EOF with blockers"
    );
}

/// Matching terminal task-notification must release the blocker and allow
/// subsequent grace settlement if the pipe remains open (re-arm path).
#[cfg(unix)]
#[tokio::test]
async fn send_message_releases_background_blocker_on_matching_terminal_notification() {
    let script_body = concat!(
        "#!/bin/sh\n",
        "echo '{\"type\":\"user\",\"toolUseResult\":{\"backgroundTaskId\":\"bg-release-1\"}}'\n",
        "echo '{\"type\":\"result\",\"session_id\":\"11111111-1111-4111-8111-111111111111\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"final answer\"}]}}'\n",
        "sleep 1\n",
        "echo '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"<task-notification><task-id>bg-release-1</task-id><status>completed</status><result>done</result></task-notification>\"}]}}'\n",
        "# After release, pipe held open by background sleep → grace should re-arm and settle.\n",
        "sleep 30 &\n",
        "exit 0\n",
    );
    let (root, workspace_path, script_path) = create_fake_claude_script(script_body);

    let session = ClaudeSession::new(
        "test-workspace".to_string(),
        workspace_path,
        Some(EngineConfig {
            bin_path: Some(script_path.to_string_lossy().to_string()),
            home_dir: None,
            custom_args: None,
            default_model: None,
        }),
    );
    let mut receiver = session.subscribe();
    let mut params = SendMessageParams::default();
    params.text = "bg then notify".to_string();

    let response = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        session.send_message(params, "turn-bg-release"),
    )
    .await
    .expect("send_message must settle after notification + re-armed grace")
    .expect("release + grace path should succeed");

    let events = drain_turn_events(&mut receiver);
    let _ = std::fs::remove_dir_all(&root);

    assert!(
        response.contains("final answer"),
        "response should keep the result text; got {response:?}"
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event.event, EngineEvent::TurnCompleted { .. }))
            .count(),
        1,
        "notification release + re-armed grace must still emit one TurnCompleted"
    );
}

/// Regression: once Claude emits its final `result`, the turn must settle even
/// if an MCP child / Stop hook inherits stdout and keeps the pipe open past the
/// CLI leader's exit. Before the post-result grace was wired into the read loop,
/// stdout never reached EOF and the turn hung on "generating" forever. The grace
/// now bounds that wait and force-kills the lingering process group.
///
/// ponytail: unix-only. It relies on a backgrounded `sleep` inheriting stdout
/// and on POSIX process-group kill; Windows pipe-inheritance / taskkill would
/// need a separate harness. The 5s grace makes the test take ~5s.
#[cfg(unix)]
#[tokio::test]
async fn send_message_settles_turn_when_child_holds_stdout_open_after_result() {
    let script_body = concat!(
        "#!/bin/sh\n",
        "echo '{\"type\":\"result\",\"session_id\":\"11111111-1111-4111-8111-111111111111\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"final answer\"}]}}'\n",
        "# Inherit stdout in a background child that outlives the CLI leader, so\n",
        "# the read loop never sees EOF until the process group is force-killed.\n",
        "sleep 30 &\n",
        "exit 0\n",
    );
    let (root, workspace_path, script_path) = create_fake_claude_script(script_body);

    let session = ClaudeSession::new(
        "test-workspace".to_string(),
        workspace_path,
        Some(EngineConfig {
            bin_path: Some(script_path.to_string_lossy().to_string()),
            home_dir: None,
            custom_args: None,
            default_model: None,
        }),
    );
    let mut receiver = session.subscribe();
    let mut params = SendMessageParams::default();
    params.text = "hello".to_string();

    // Bound the whole call well above the 5s grace: a regression would hang here
    // (stdout never EOFs) until the outer timeout fires and fails the test.
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        session.send_message(params, "turn-grace"),
    )
    .await
    .expect("send_message must settle within the post-result grace, not hang")
    .expect("grace-settled turn should report success");

    let events = drain_turn_events(&mut receiver);
    let _ = std::fs::remove_dir_all(&root);

    assert_eq!(response, "final answer");
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event.event, EngineEvent::TurnCompleted { .. }))
            .count(),
        1,
        "exactly one TurnCompleted must be emitted once the grace settles the turn",
    );
}

/// Companion to the stdout case above, for the *stderr* drain — the second,
/// subtler wedge. A descendant that escapes the CLI's process group (setsid)
/// and keeps ONLY the inherited stderr write end open (stdout closed) lets
/// stdout EOF normally — so there is no post-result grace at all — yet the
/// stderr reader task would hang on EOF forever, so `TurnCompleted` never fired
/// and the UI stayed stuck on "generating…". CLAUDE_POST_RESULT_STDERR_DRAIN
/// now bounds that drain. Because the escapee lives in its own session, killpg
/// cannot reach it, so this exercises the abort path — not the group kill.
///
/// ponytail: unix-only, and relies on `perl` (present on macOS and typical CI)
/// for POSIX::setsid. If perl is missing the backgrounded child exits
/// immediately, stderr EOFs, and the turn still settles (degrades to a no-op
/// rather than a false failure). Bounded well under the 20s outer timeout.
#[cfg(unix)]
#[tokio::test]
async fn send_message_settles_turn_when_escaped_child_holds_stderr_open_after_result() {
    let script_body = concat!(
        "#!/bin/sh\n",
        "echo '{\"type\":\"result\",\"session_id\":\"11111111-1111-4111-8111-111111111111\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"final answer\"}]}}'\n",
        "# Detach a child into its own session (escapes the process group, so\n",
        "# killpg cannot reach it) that keeps ONLY the inherited stderr write end\n",
        "# open. stdout EOFs normally; the stderr reader would hang forever\n",
        "# without the bounded drain.\n",
        "perl -e 'use POSIX qw(setsid); setsid(); close STDOUT; sleep 30' &\n",
        "exit 0\n",
    );
    let (root, workspace_path, script_path) = create_fake_claude_script(script_body);

    let session = ClaudeSession::new(
        "test-workspace".to_string(),
        workspace_path,
        Some(EngineConfig {
            bin_path: Some(script_path.to_string_lossy().to_string()),
            home_dir: None,
            custom_args: None,
            default_model: None,
        }),
    );
    let mut receiver = session.subscribe();
    let mut params = SendMessageParams::default();
    params.text = "hello".to_string();

    // A regression hangs on `stderr_handle.await` (stderr never EOFs) until this
    // outer timeout fires and fails the test.
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(20),
        session.send_message(params, "turn-stderr-drain"),
    )
    .await
    .expect("send_message must settle within the stderr drain, not hang")
    .expect("stderr-drain-settled turn should report success");

    let events = drain_turn_events(&mut receiver);
    let _ = std::fs::remove_dir_all(&root);

    assert_eq!(response, "final answer");
    assert_eq!(
        events
            .iter()
            .filter(|event| matches!(event.event, EngineEvent::TurnCompleted { .. }))
            .count(),
        1,
        "exactly one TurnCompleted must be emitted once the stderr drain settles the turn",
    );
}

#[tokio::test]
async fn send_message_reports_exit_metadata_when_claude_fails_without_output() {
    #[cfg(windows)]
    let script = "@echo off\r\nexit /b 1\r\n";
    #[cfg(not(windows))]
    let script = "#!/bin/sh\nexit 1\n";
    let (root, workspace_path, script_path) = create_fake_claude_script(script);
    let session = test_session_with_bin(workspace_path, script_path);
    let mut receiver = session.subscribe();
    let mut params = SendMessageParams::default();
    params.text = "line1\nline2".to_string();
    params.access_mode = Some("read-only".to_string());

    let error = session
        .send_message(params, "turn-exit-no-output")
        .await
        .expect_err("non-zero fake claude should fail");
    let events = drain_turn_events(&mut receiver);
    let _ = std::fs::remove_dir_all(&root);

    assert!(error.contains("Claude exited with status"));
    assert!(error.contains("Diagnostics:"));
    assert!(error.contains("input_format=stream-json"));
    assert!(error.contains("include_hook_events=true"));
    assert!(error.contains("permission_mode=read-only"));
    assert!(error.contains("No stdout/stderr diagnostics were observed"));
    let (turn_error, code) = turn_error_event(&events).expect("turn error event");
    assert!(turn_error.contains("input_format=stream-json"));
    assert!(code.is_none());
}

#[tokio::test]
async fn send_message_times_out_when_claude_stream_never_emits_valid_event() {
    #[cfg(windows)]
    let script = "@echo off\r\nping 127.0.0.1 -n 15 >nul\r\nexit /b 0\r\n";
    #[cfg(not(windows))]
    let script = "#!/bin/sh\nsleep 12\n";
    let (root, workspace_path, script_path) = create_fake_claude_script(script);
    let session = test_session_with_bin(workspace_path, script_path);
    let mut receiver = session.subscribe();
    let mut params = SendMessageParams::default();
    params.text = "hello".to_string();

    let error = session
        .send_message(params, "turn-silent")
        .await
        .expect_err("silent fake claude should time out");
    let events = drain_turn_events(&mut receiver);
    let active_process_ids = session.active_process_ids().await;
    let _ = std::fs::remove_dir_all(&root);

    assert!(error.contains("Claude stream-json startup timed out"));
    assert!(active_process_ids.is_empty());
    let (turn_error, code) = turn_error_event(&events).expect("turn error event");
    assert!(turn_error.contains("No stdout/stderr diagnostics were observed"));
    assert_eq!(code.as_deref(), Some("claude_stream_no_event_timeout"));
    assert!(!events
        .iter()
        .any(|event| matches!(event.event, EngineEvent::TurnCompleted { .. })));
}

#[tokio::test]
async fn send_message_times_out_after_malformed_claude_stream_output() {
    #[cfg(windows)]
    let script = "@echo off\r\necho not-json-from-provider\r\nping 127.0.0.1 -n 15 >nul\r\n";
    #[cfg(not(windows))]
    let script = "#!/bin/sh\necho 'not-json-from-provider'\nsleep 12\n";
    let (root, workspace_path, script_path) = create_fake_claude_script(script);
    let session = test_session_with_bin(workspace_path, script_path);
    let mut receiver = session.subscribe();
    let mut params = SendMessageParams::default();
    params.text = "hello".to_string();

    let error = session
        .send_message(params, "turn-malformed")
        .await
        .expect_err("malformed fake claude should time out");
    let events = drain_turn_events(&mut receiver);
    let _ = std::fs::remove_dir_all(&root);

    assert!(error.contains("Claude stream-json startup timed out"));
    assert!(error.contains("not-json-from-provider"));
    let (turn_error, code) = turn_error_event(&events).expect("turn error event");
    assert!(turn_error.contains("not-json-from-provider"));
    assert_eq!(code.as_deref(), Some("claude_stream_no_event_timeout"));
}

#[tokio::test]
async fn send_message_does_not_treat_json_without_type_as_valid_stream_liveness() {
    #[cfg(windows)]
    let script = "@echo off\r\necho {}\r\nping 127.0.0.1 -n 15 >nul\r\n";
    #[cfg(not(windows))]
    let script = "#!/bin/sh\necho '{}'\nsleep 12\n";
    let (root, workspace_path, script_path) = create_fake_claude_script(script);
    let session = test_session_with_bin(workspace_path, script_path);
    let mut receiver = session.subscribe();
    let mut params = SendMessageParams::default();
    params.text = "hello".to_string();

    let error = session
        .send_message(params, "turn-json-without-type")
        .await
        .expect_err("json without type should not satisfy stream liveness");
    let events = drain_turn_events(&mut receiver);
    let _ = std::fs::remove_dir_all(&root);

    assert!(error.contains("Claude stream-json startup timed out"));
    assert!(error.contains("{}"));
    let (turn_error, code) = turn_error_event(&events).expect("turn error event");
    assert!(turn_error.contains("{}"));
    assert_eq!(code.as_deref(), Some("claude_stream_no_event_timeout"));
}

#[tokio::test]
async fn send_message_does_not_treat_unknown_json_type_as_valid_stream_liveness() {
    #[cfg(windows)]
    let script =
        "@echo off\r\necho {\"type\":\"provider_banner\"}\r\nping 127.0.0.1 -n 15 >nul\r\n";
    #[cfg(not(windows))]
    let script = "#!/bin/sh\necho '{\"type\":\"provider_banner\"}'\nsleep 12\n";
    let (root, workspace_path, script_path) = create_fake_claude_script(script);
    let session = test_session_with_bin(workspace_path, script_path);
    let mut receiver = session.subscribe();
    let mut params = SendMessageParams::default();
    params.text = "hello".to_string();

    let error = session
        .send_message(params, "turn-unknown-json-type")
        .await
        .expect_err("unknown json event type should not satisfy stream liveness");
    let events = drain_turn_events(&mut receiver);
    let _ = std::fs::remove_dir_all(&root);

    assert!(error.contains("Claude stream-json startup timed out"));
    assert!(error.contains("provider_banner"));
    let (turn_error, code) = turn_error_event(&events).expect("turn error event");
    assert!(turn_error.contains("provider_banner"));
    assert_eq!(code.as_deref(), Some("claude_stream_no_event_timeout"));
}
