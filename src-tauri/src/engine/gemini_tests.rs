use super::EngineEvent;
use super::{
    collect_latest_turn_reasoning_texts, extract_latest_thought_text, extract_session_id,
    extract_tool_events_from_snapshot, parse_gemini_event, should_extract_thought_fallback,
    GeminiSession, GeminiSessionMessage, GeminiSnapshotToolState, SendMessageParams,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::json;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(unix)]
use crate::engine::{EngineConfig, EngineManager};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
#[cfg(unix)]
use std::process::Stdio;
#[cfg(unix)]
use std::sync::Arc;
#[cfg(unix)]
use std::time::Duration;
#[cfg(unix)]
use tokio::process::Command;

fn with_image_refs_for_test(text: &str, images: &[String]) -> String {
    let workspace_path = std::env::temp_dir();
    with_image_refs_for_test_in_workspace(text, images, workspace_path.as_path())
}

fn with_image_refs_for_test_in_workspace(
    text: &str,
    images: &[String],
    workspace_path: &Path,
) -> String {
    GeminiSession::with_image_references(text, Some(images), workspace_path)
}

fn unique_temp_path(prefix: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time")
        .as_nanos();
    std::env::temp_dir().join(format!("{}-{}-{}", prefix, std::process::id(), timestamp))
}

fn unescape_at_path(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut escaping = false;
    for ch in value.chars() {
        if escaping {
            output.push(ch);
            escaping = false;
            continue;
        }
        if ch == '\\' {
            escaping = true;
            continue;
        }
        output.push(ch);
    }
    if escaping {
        output.push('\\');
    }
    output
}

fn extract_first_image_path(prompt: &str) -> String {
    let marker = '@';
    let start = prompt.find(marker).expect("image marker missing") + 1;
    let tail = &prompt[start..];
    if let Some(quoted_tail) = tail.strip_prefix('"') {
        let end = quoted_tail.find('"').expect("closing quote missing");
        return unescape_at_path(&quoted_tail[..end]);
    }

    let token = tail.split_whitespace().next().expect("missing image path");
    unescape_at_path(token)
}

fn command_args(cmd: &super::Command) -> Vec<String> {
    cmd.as_std()
        .get_args()
        .map(|value| value.to_string_lossy().to_string())
        .collect()
}

#[test]
fn selected_auth_type_for_api_key_modes() {
    assert_eq!(
        GeminiSession::selected_auth_type_for_mode(Some("custom")),
        "gemini-api-key"
    );
    assert_eq!(
        GeminiSession::selected_auth_type_for_mode(Some("gemini_api_key")),
        "gemini-api-key"
    );
}

#[test]
fn selected_auth_type_for_vertex_modes() {
    assert_eq!(
        GeminiSession::selected_auth_type_for_mode(Some("vertex_api_key")),
        "vertex-ai"
    );
    assert_eq!(
        GeminiSession::selected_auth_type_for_mode(Some("vertex_adc")),
        "vertex-ai"
    );
    assert_eq!(
        GeminiSession::selected_auth_type_for_mode(Some("vertex_service_account")),
        "vertex-ai"
    );
}

#[test]
fn selected_auth_type_for_login_google_mode() {
    assert_eq!(
        GeminiSession::selected_auth_type_for_mode(Some("login_google")),
        "oauth-personal"
    );
    assert_eq!(
        GeminiSession::selected_auth_type_for_mode(Some("unknown")),
        "oauth-personal"
    );
}

#[test]
fn locale_hint_detects_chinese_locale() {
    let hint = GeminiSession::locale_to_prompt_language_hint("zh_CN.UTF-8");
    assert_eq!(hint, Some("Output language: Simplified Chinese."));
}

#[test]
fn locale_hint_skips_non_chinese_locale() {
    let hint = GeminiSession::locale_to_prompt_language_hint("en_US.UTF-8");
    assert_eq!(hint, None);
}

#[test]
fn with_image_references_appends_deduped_at_paths() {
    let images = vec![
        "/tmp/screen 1.png".to_string(),
        "/tmp/screen 1.png".to_string(),
        "/tmp/screen-2.jpg".to_string(),
    ];
    let prompt = with_image_refs_for_test("Describe screenshots", images.as_slice());
    assert_eq!(
        prompt,
        "Describe screenshots\n\n@/tmp/screen\\ 1.png @/tmp/screen-2.jpg"
    );
}

#[test]
fn with_image_references_strips_file_uri_prefix() {
    let images = vec!["file:///Users/demo/a.png".to_string()];
    let prompt = with_image_refs_for_test("Describe", images.as_slice());
    assert_eq!(prompt, "Describe\n\n@/Users/demo/a.png");
}

#[test]
fn with_image_references_normalizes_localhost_file_uri() {
    let images = vec!["file://localhost/Users/demo/a.png".to_string()];
    let prompt = with_image_refs_for_test("Describe", images.as_slice());
    assert_eq!(prompt, "Describe\n\n@/Users/demo/a.png");
}

#[test]
fn with_image_references_preserves_unc_host_file_uri() {
    let images = vec!["file://server/share/folder/a%20b.png".to_string()];
    let prompt = with_image_refs_for_test("Describe", images.as_slice());
    assert_eq!(prompt, "Describe\n\n@//server/share/folder/a\\ b.png");
}

#[test]
fn with_image_references_decodes_percent_escaped_file_uri() {
    let images = vec!["file:///Users/demo/a%20b.png".to_string()];
    let prompt = with_image_refs_for_test("Describe", images.as_slice());
    assert_eq!(prompt, "Describe\n\n@/Users/demo/a\\ b.png");
}

#[test]
fn with_image_references_supports_windows_drive_host_form() {
    let images = vec!["file://C:/Users/demo/a%20b.png".to_string()];
    let prompt = with_image_refs_for_test("Describe", images.as_slice());
    let expected = if cfg!(windows) {
        "Describe\n\n@C:/Users/demo/a\\ b.png"
    } else {
        "Describe\n\n@/C:/Users/demo/a\\ b.png"
    };
    assert_eq!(prompt, expected);
}

#[cfg(windows)]
#[test]
fn with_image_references_normalizes_windows_backslashes() {
    let images = vec![r"C:\Users\demo\Desktop\bug image.png".to_string()];
    let prompt = with_image_refs_for_test("Describe", images.as_slice());
    assert_eq!(prompt, "Describe\n\n@C:/Users/demo/Desktop/bug\\ image.png");
}

#[cfg(windows)]
#[test]
fn with_image_references_normalizes_windows_unc_backslashes() {
    let images = vec![r"\\server\share\folder\bug image.png".to_string()];
    let prompt = with_image_refs_for_test("Describe", images.as_slice());
    assert_eq!(prompt, "Describe\n\n@//server/share/folder/bug\\ image.png");
}

#[test]
fn with_image_references_recovers_miswrapped_data_url_file_uri() {
    let images = vec!["data:image/png;base64,file:///Users/demo/c%20d.png".to_string()];
    let prompt = with_image_refs_for_test("Describe", images.as_slice());
    assert_eq!(prompt, "Describe\n\n@/Users/demo/c\\ d.png");
}

#[test]
fn with_image_references_materializes_base64_data_urls_to_temp_files() {
    let encoded = STANDARD.encode([0x89, b'P', b'N', b'G']);
    let images = vec![format!("data:image/png;base64,{}", encoded)];
    let workspace_path = unique_temp_path("moss-x-gemini-workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace");
    let prompt = with_image_refs_for_test_in_workspace(
        "Describe",
        images.as_slice(),
        workspace_path.as_path(),
    );
    assert!(prompt.starts_with("Describe\n\n@"));

    let normalized_path = extract_first_image_path(&prompt);

    let path = std::path::Path::new(&normalized_path);
    assert!(path.exists(), "workspace image file should exist");
    assert!(
        path.starts_with(&workspace_path),
        "materialized path should stay inside workspace"
    );
    let bytes = std::fs::read(path).expect("read temp image");
    assert_eq!(bytes, vec![0x89, b'P', b'N', b'G']);
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_dir_all(&workspace_path);
}

#[test]
fn with_image_references_copies_external_local_paths_into_workspace() {
    let workspace_path = unique_temp_path("moss-x-gemini-workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace");
    let source_path = unique_temp_path("moss-x-gemini-source.png");
    std::fs::write(&source_path, [0x89, b'P', b'N', b'G']).expect("write source image");

    let images = vec![source_path.to_string_lossy().to_string()];
    let prompt = with_image_refs_for_test_in_workspace(
        "Describe",
        images.as_slice(),
        workspace_path.as_path(),
    );
    let normalized_path = extract_first_image_path(&prompt);
    let copied_path = PathBuf::from(normalized_path);

    assert!(
        copied_path.starts_with(&workspace_path),
        "copied image path should stay inside workspace"
    );
    let copied_bytes = std::fs::read(&copied_path).expect("read copied image");
    assert_eq!(copied_bytes, vec![0x89, b'P', b'N', b'G']);

    let _ = std::fs::remove_file(&source_path);
    let _ = std::fs::remove_file(&copied_path);
    let _ = std::fs::remove_dir_all(&workspace_path);
}

#[test]
fn with_image_references_skips_unsupported_data_urls() {
    let images = vec!["data:text/plain;base64,SGVsbG8=".to_string()];
    let prompt = with_image_refs_for_test("Describe", images.as_slice());
    assert_eq!(prompt, "Describe");
}

#[test]
fn build_command_routes_short_prompt_to_stdin_without_argv_exposure() {
    let workspace_path = unique_temp_path("moss-x-gemini-workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace");
    let session = GeminiSession::new("workspace-1".to_string(), workspace_path.clone(), None);
    let params = SendMessageParams {
        text: "Output language: Simplified Chinese.\n\n短提示".to_string(),
        ..Default::default()
    };

    let built = session.build_command(&params);
    assert_eq!(built.prompt_stdin_payload, params.text);
    let args = command_args(&built.command);
    let prompt_idx = args
        .iter()
        .position(|value| value == "--prompt")
        .expect("missing --prompt arg");
    let prompt_value = args
        .get(prompt_idx + 1)
        .expect("missing prompt value after --prompt");
    assert_eq!(prompt_value, "");
    assert!(
        args.iter().all(|arg| !arg.contains("短提示")),
        "raw prompt must not appear in argv"
    );

    let _ = std::fs::remove_dir_all(&workspace_path);
}

#[test]
fn build_command_routes_long_prompt_to_stdin() {
    let workspace_path = unique_temp_path("moss-x-gemini-workspace");
    std::fs::create_dir_all(&workspace_path).expect("create workspace");
    let session = GeminiSession::new("workspace-1".to_string(), workspace_path.clone(), None);
    let params = SendMessageParams {
        text: format!(
            "Output language: Simplified Chinese.\n\n{}",
            "a".repeat(16 * 1024)
        ),
        ..Default::default()
    };

    let built = session.build_command(&params);
    assert_eq!(built.prompt_stdin_payload, params.text);

    let args = command_args(&built.command);
    let prompt_idx = args
        .iter()
        .position(|value| value == "--prompt")
        .expect("missing --prompt arg");
    let prompt_value = args
        .get(prompt_idx + 1)
        .expect("missing prompt value after --prompt");
    assert_eq!(
        prompt_value, "",
        "long prompt should use empty argv placeholder"
    );
    assert!(
        args.iter().all(|arg| !arg.contains(&"a".repeat(256))),
        "raw prompt must not appear in argv"
    );

    let _ = std::fs::remove_dir_all(&workspace_path);
}

#[test]
fn parse_result_error_maps_to_turn_error() {
    let payload = json!({
        "type": "result",
        "status": "error",
        "error": {
            "message": "quota exceeded"
        }
    });
    let parsed = parse_gemini_event("workspace-1", &payload);
    match parsed {
        Some(EngineEvent::TurnError { error, .. }) => {
            assert!(error.contains("quota exceeded"));
        }
        _ => panic!("expected TurnError"),
    }
}

#[test]
fn parse_result_success_maps_to_turn_completed() {
    let payload = json!({
        "type": "result",
        "status": "success",
        "text": "你好"
    });
    let parsed = parse_gemini_event("workspace-1", &payload);
    assert!(matches!(parsed, Some(EngineEvent::TurnCompleted { .. })));
}

#[test]
fn parse_reasoning_delta_alias_maps_to_reasoning_delta() {
    let payload = json!({
        "type": "reasoning_delta",
        "delta": "先规划，再执行"
    });
    let parsed = parse_gemini_event("workspace-1", &payload);
    match parsed {
        Some(EngineEvent::ReasoningDelta { text, .. }) => {
            assert_eq!(text, "先规划，再执行");
        }
        _ => panic!("expected ReasoningDelta"),
    }
}

#[test]
fn parse_thought_event_with_subject_description_maps_to_reasoning_delta() {
    let payload = json!({
        "type": "thought",
        "subject": "读取项目结构",
        "description": "先检查 README 和 pom.xml"
    });
    let parsed = parse_gemini_event("workspace-1", &payload);
    match parsed {
        Some(EngineEvent::ReasoningDelta { text, .. }) => {
            assert_eq!(text, "读取项目结构: 先检查 README 和 pom.xml");
        }
        _ => panic!("expected ReasoningDelta"),
    }
}

#[test]
fn parse_reasoning_keyword_event_with_nested_thought_maps_to_reasoning_delta() {
    let payload = json!({
        "type": "assistant_thinking_update",
        "thought": {
            "subject": "规划步骤",
            "description": "先看配置再看源码"
        }
    });
    let parsed = parse_gemini_event("workspace-1", &payload);
    match parsed {
        Some(EngineEvent::ReasoningDelta { text, .. }) => {
            assert_eq!(text, "规划步骤: 先看配置再看源码");
        }
        _ => panic!("expected ReasoningDelta"),
    }
}

#[test]
fn parse_reasoning_keyword_event_with_nested_message_thoughts_maps_to_reasoning_delta() {
    let payload = json!({
        "type": "assistant_thinking_update",
        "message": {
            "thoughts": [
                {
                    "subject": "读取项目结构",
                    "description": "先看 README 和 package.json"
                }
            ]
        }
    });
    let parsed = parse_gemini_event("workspace-1", &payload);
    match parsed {
        Some(EngineEvent::ReasoningDelta { text, .. }) => {
            assert_eq!(text, "读取项目结构: 先看 README 和 package.json");
        }
        _ => panic!("expected ReasoningDelta"),
    }
}

#[test]
fn parse_message_with_reasoning_role_maps_to_reasoning_delta() {
    let payload = json!({
        "type": "message",
        "role": "assistant_reasoning",
        "delta": "分析上下文..."
    });
    let parsed = parse_gemini_event("workspace-1", &payload);
    match parsed {
        Some(EngineEvent::ReasoningDelta { text, .. }) => {
            assert_eq!(text, "分析上下文...");
        }
        _ => panic!("expected ReasoningDelta"),
    }
}

#[test]
fn thought_fallback_triggers_for_non_reasoning_events() {
    let parsed = EngineEvent::TextDelta {
        workspace_id: "workspace-1".to_string(),
        text: "正文".to_string(),
    };
    assert!(should_extract_thought_fallback(Some(&parsed)));
    assert!(should_extract_thought_fallback(None));
}

#[test]
fn thought_fallback_skips_reasoning_events() {
    let parsed = EngineEvent::ReasoningDelta {
        workspace_id: "workspace-1".to_string(),
        text: "思考".to_string(),
    };
    assert!(!should_extract_thought_fallback(Some(&parsed)));
}

#[test]
fn parse_message_delta_alias_maps_to_text_delta() {
    let payload = json!({
        "type": "message_delta",
        "delta": "回复片段"
    });
    let parsed = parse_gemini_event("workspace-1", &payload);
    match parsed {
        Some(EngineEvent::TextDelta { text, .. }) => {
            assert_eq!(text, "回复片段");
        }
        _ => panic!("expected TextDelta"),
    }
}

#[test]
fn parse_response_item_payload_message_maps_to_text_delta() {
    let payload = json!({
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "assistant",
            "content": [
                {
                    "type": "output_text",
                    "text": "第一段正文"
                }
            ]
        }
    });
    let parsed = parse_gemini_event("workspace-1", &payload);
    match parsed {
        Some(EngineEvent::TextDelta { text, .. }) => {
            assert_eq!(text, "第一段正文");
        }
        _ => panic!("expected TextDelta"),
    }
}

#[test]
fn parse_response_output_item_added_maps_to_text_delta() {
    let payload = json!({
        "type": "response.output_item.added",
        "item": {
            "type": "message",
            "role": "assistant",
            "content": [
                {
                    "type": "output_text",
                    "text": "第二段正文"
                }
            ]
        }
    });
    let parsed = parse_gemini_event("workspace-1", &payload);
    match parsed {
        Some(EngineEvent::TextDelta { text, .. }) => {
            assert_eq!(text, "第二段正文");
        }
        _ => panic!("expected TextDelta"),
    }
}

#[test]
fn parse_response_item_with_user_role_is_ignored() {
    let payload = json!({
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "user",
            "content": [
                {
                    "type": "output_text",
                    "text": "用户输入"
                }
            ]
        }
    });
    let parsed = parse_gemini_event("workspace-1", &payload);
    assert!(parsed.is_none());
}

#[test]
fn parse_gemini_snapshot_content_maps_to_text_delta() {
    let payload = json!({
        "type": "gemini",
        "content": "接下来，我将创建 PhoneRequest.java 文件。"
    });
    let parsed = parse_gemini_event("workspace-1", &payload);
    match parsed {
        Some(EngineEvent::TextDelta { text, .. }) => {
            assert_eq!(text, "接下来，我将创建 PhoneRequest.java 文件。");
        }
        _ => panic!("expected TextDelta"),
    }
}

#[test]
fn parse_gemini_snapshot_ignores_user_role() {
    let payload = json!({
        "type": "gemini",
        "role": "user",
        "content": "用户输入"
    });
    let parsed = parse_gemini_event("workspace-1", &payload);
    assert!(parsed.is_none());
}

#[test]
fn extract_session_id_reads_init_event_shape() {
    let payload = json!({
        "type": "init",
        "session_id": "ses_init_123"
    });
    assert_eq!(
        extract_session_id(&payload).as_deref(),
        Some("ses_init_123")
    );
}

#[test]
fn extract_session_id_reads_nested_result_shape() {
    let payload = json!({
        "type": "result",
        "result": {
            "session": {
                "id": "ses_nested_456"
            }
        }
    });
    assert_eq!(
        extract_session_id(&payload).as_deref(),
        Some("ses_nested_456")
    );
}

#[test]
fn extract_session_id_rejects_invalid_path_like_value() {
    let payload = json!({
        "type": "result",
        "sessionId": "../tmp/session"
    });
    assert!(extract_session_id(&payload).is_none());
}

#[test]
fn parse_done_alias_maps_to_turn_completed() {
    let payload = json!({
        "type": "done",
        "status": "success",
        "text": "完成"
    });
    let parsed = parse_gemini_event("workspace-1", &payload);
    assert!(matches!(parsed, Some(EngineEvent::TurnCompleted { .. })));
}

#[test]
fn extract_tool_events_from_snapshot_emits_started_then_completed_once() {
    let mut tool_states: HashMap<String, GeminiSnapshotToolState> = HashMap::new();
    let started_payload = json!({
        "type": "gemini",
        "toolCalls": [
            {
                "id": "tool-1",
                "displayName": "ReadFile",
                "args": {
                    "path": "README.md"
                }
            }
        ]
    });

    let started_events =
        extract_tool_events_from_snapshot("workspace-1", &started_payload, &mut tool_states);
    assert_eq!(started_events.len(), 1);
    match &started_events[0] {
        EngineEvent::ToolStarted {
            tool_id, tool_name, ..
        } => {
            assert_eq!(tool_id, "tool-1");
            assert_eq!(tool_name, "ReadFile");
        }
        _ => panic!("expected ToolStarted"),
    }

    // Replayed snapshots should not duplicate tool started rows.
    let replay_started =
        extract_tool_events_from_snapshot("workspace-1", &started_payload, &mut tool_states);
    assert!(replay_started.is_empty());

    let completed_payload = json!({
        "type": "gemini",
        "toolCalls": [
            {
                "id": "tool-1",
                "displayName": "ReadFile",
                "args": {
                    "path": "README.md"
                },
                "resultDisplay": "ok",
                "result": {
                    "status": "ok"
                }
            }
        ]
    });
    let completed_events =
        extract_tool_events_from_snapshot("workspace-1", &completed_payload, &mut tool_states);
    assert_eq!(completed_events.len(), 1);
    match &completed_events[0] {
        EngineEvent::ToolCompleted { tool_id, .. } => {
            assert_eq!(tool_id, "tool-1");
        }
        _ => panic!("expected ToolCompleted"),
    }

    // Completed snapshot replay should also stay deduped.
    let replay_completed =
        extract_tool_events_from_snapshot("workspace-1", &completed_payload, &mut tool_states);
    assert!(replay_completed.is_empty());
}

#[test]
fn extract_tool_events_from_snapshot_emits_started_for_completed_only_payload() {
    let mut tool_states: HashMap<String, GeminiSnapshotToolState> = HashMap::new();
    let payload = json!({
        "type": "gemini",
        "message": {
            "toolCalls": [
                {
                    "id": "tool-2",
                    "displayName": "EditFile",
                    "args": {
                        "path": "src/App.tsx"
                    },
                    "status": "completed",
                    "resultDisplay": "updated"
                }
            ]
        }
    });

    let events = extract_tool_events_from_snapshot("workspace-1", &payload, &mut tool_states);
    assert_eq!(events.len(), 2);
    assert!(matches!(events[0], EngineEvent::ToolStarted { .. }));
    assert!(matches!(events[1], EngineEvent::ToolCompleted { .. }));
}

#[test]
fn extract_latest_thought_text_prefers_latest_non_empty_entry() {
    let payload = json!({
        "thoughts": [
            {
                "subject": "先检查上下文",
                "description": "确认用户意图"
            },
            {
                "subject": "再输出答案",
                "description": "整理最终结论"
            }
        ]
    });
    let extracted = extract_latest_thought_text(&payload);
    assert_eq!(extracted.as_deref(), Some("再输出答案: 整理最终结论"));
}

#[test]
fn extract_latest_thought_text_reads_nested_message_payload() {
    let payload = json!({
        "type": "message",
        "message": {
            "messages": [
                {
                    "type": "assistant",
                    "thoughts": [
                        {
                            "subject": "先收集上下文",
                            "description": "读取 docs 和 src 目录"
                        },
                        {
                            "subject": "再生成结论",
                            "description": "整理关键变更点"
                        }
                    ]
                }
            ]
        }
    });
    let extracted = extract_latest_thought_text(&payload);
    assert_eq!(extracted.as_deref(), Some("再生成结论: 整理关键变更点"));
}

#[test]
fn approval_mode_current_uses_cli_default() {
    assert_eq!(GeminiSession::resolve_approval_mode(Some("current")), None);
}

#[test]
fn approval_mode_full_access_maps_to_yolo() {
    assert_eq!(
        GeminiSession::resolve_approval_mode(Some("full-access")),
        Some("yolo")
    );
}

#[test]
fn collect_latest_turn_reasoning_texts_stops_at_latest_user_boundary() {
    let messages = vec![
        GeminiSessionMessage {
            id: "old-r1".to_string(),
            role: "assistant".to_string(),
            text: "旧思考".to_string(),
            images: None,
            timestamp: None,
            kind: "reasoning".to_string(),
            tool_type: None,
            title: None,
            tool_input: None,
            tool_output: None,
        },
        GeminiSessionMessage {
            id: "old-a1".to_string(),
            role: "assistant".to_string(),
            text: "旧正文".to_string(),
            images: None,
            timestamp: None,
            kind: "message".to_string(),
            tool_type: None,
            title: None,
            tool_input: None,
            tool_output: None,
        },
        GeminiSessionMessage {
            id: "u-last".to_string(),
            role: "user".to_string(),
            text: "新的提问".to_string(),
            images: None,
            timestamp: None,
            kind: "message".to_string(),
            tool_type: None,
            title: None,
            tool_input: None,
            tool_output: None,
        },
        GeminiSessionMessage {
            id: "r-last-1".to_string(),
            role: "assistant".to_string(),
            text: "先看目录".to_string(),
            images: None,
            timestamp: None,
            kind: "reasoning".to_string(),
            tool_type: None,
            title: None,
            tool_input: None,
            tool_output: None,
        },
        GeminiSessionMessage {
            id: "r-last-2".to_string(),
            role: "assistant".to_string(),
            text: "再读 README".to_string(),
            images: None,
            timestamp: None,
            kind: "reasoning".to_string(),
            tool_type: None,
            title: None,
            tool_input: None,
            tool_output: None,
        },
    ];
    let collected = collect_latest_turn_reasoning_texts(&messages);
    assert_eq!(
        collected,
        vec!["先看目录".to_string(), "再读 README".to_string()]
    );
}

#[tokio::test]
async fn active_process_ids_is_empty_when_no_processes_running() {
    let session = GeminiSession::new(
        "ws-drop-test".to_string(),
        PathBuf::from("/tmp/ws-drop-test"),
        None,
    );
    assert!(session.active_process_ids().await.is_empty());
    drop(session);
}

#[tokio::test]
async fn drop_fallback_does_not_panic_on_empty_active_processes() {
    let session = GeminiSession::new(
        "ws-drop-test-2".to_string(),
        PathBuf::from("/tmp/ws-drop-test-2"),
        None,
    );
    drop(session);
}

#[cfg(unix)]
fn write_unix_test_script(prefix: &str, body: &str) -> (PathBuf, PathBuf) {
    let directory = unique_temp_path(prefix);
    std::fs::create_dir_all(&directory).expect("create fake Gemini directory");
    let script_path = directory.join("fake-gemini");
    std::fs::write(&script_path, format!("#!/bin/sh\nset -eu\n{body}\n"))
        .expect("write fake Gemini script");
    let mut permissions = std::fs::metadata(&script_path)
        .expect("fake Gemini metadata")
        .permissions();
    permissions.set_mode(0o755);
    std::fs::set_permissions(&script_path, permissions).expect("make fake Gemini executable");
    (directory, script_path)
}

#[cfg(unix)]
fn unix_process_exists(pid: u32) -> bool {
    let result = unsafe { libc::kill(pid as libc::pid_t, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(unix)]
async fn wait_for_process_exit(pid: u32) -> bool {
    for _ in 0..500 {
        if !unix_process_exists(pid) {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    false
}

#[cfg(unix)]
async fn wait_for_pid_file(path: &Path) -> u32 {
    for _ in 0..500 {
        if let Ok(value) = std::fs::read_to_string(path) {
            if let Ok(pid) = value.trim().parse::<u32>() {
                return pid;
            }
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("timed out waiting for pid file: {}", path.display());
}

#[cfg(unix)]
async fn register_grouped_sleep_child(session: &GeminiSession, turn_id: &str) -> u32 {
    let mut command = Command::new("sleep");
    command
        .arg("60")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    GeminiSession::configure_spawn_command(&mut command);
    let child = command.spawn().expect("spawn grouped sleep child");
    let pid = child.id().expect("sleep child pid");
    session
        .process_registry
        .lock()
        .await
        .active_processes
        .insert(
            turn_id.to_string(),
            super::ActiveGeminiChildProcess::new(child),
        );
    pid
}

#[cfg(unix)]
#[tokio::test]
async fn production_policy_rejects_gemini_before_fake_cli_spawn() {
    let (directory, script_path) = write_unix_test_script(
        "ccgui-gemini-disabled-policy",
        r#"
printf 'spawned' > "${0}.spawned"
cat >/dev/null
"#,
    );
    let spawn_marker = PathBuf::from(format!("{}.spawned", script_path.display()));
    let session = GeminiSession::new(
        "workspace-disabled-policy".to_string(),
        directory.clone(),
        Some(EngineConfig {
            bin_path: Some(script_path.to_string_lossy().to_string()),
            ..Default::default()
        }),
    );

    let error = session
        .send_message(
            SendMessageParams {
                text: "must not reach Gemini".to_string(),
                ..Default::default()
            },
            "turn-disabled-policy",
        )
        .await
        .expect_err("production Gemini launch must stay disabled");

    assert_eq!(error, crate::engine_policy::GEMINI_DISABLED_DIAGNOSTIC);
    assert!(!spawn_marker.exists());
    assert!(session.active_process_ids().await.is_empty());
    let _ = std::fs::remove_dir_all(directory);
}

#[cfg(unix)]
#[tokio::test]
async fn interrupt_before_process_registration_prevents_late_spawn() {
    let (directory, script_path) = write_unix_test_script(
        "ccgui-gemini-pre-registration-interrupt",
        r#"
printf 'spawned' > "${0}.spawned"
cat >/dev/null
"#,
    );
    let spawn_marker = PathBuf::from(format!("{}.spawned", script_path.display()));
    let session = GeminiSession::new_process_test(
        "workspace-pre-registration-interrupt".to_string(),
        directory.clone(),
        Some(EngineConfig {
            bin_path: Some(script_path.to_string_lossy().to_string()),
            ..Default::default()
        }),
    );

    session
        .interrupt_turn("turn-pre-registration-interrupt")
        .await
        .expect("record pre-registration interrupt");
    let error = session
        .send_message(
            SendMessageParams {
                text: "cancel before spawn".to_string(),
                ..Default::default()
            },
            "turn-pre-registration-interrupt",
        )
        .await
        .expect_err("interrupted turn must not spawn later");

    assert_eq!(error, "Session stopped.");
    assert!(!spawn_marker.exists());
    assert!(session.active_process_ids().await.is_empty());
    let _ = std::fs::remove_dir_all(directory);
}

#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn session_interrupt_during_pre_registration_window_prevents_spawn() {
    let (directory, script_path) = write_unix_test_script(
        "ccgui-gemini-session-interrupt-generation",
        r#"
printf 'spawned' > "${0}.spawned"
cat >/dev/null
"#,
    );
    let spawn_marker = PathBuf::from(format!("{}.spawned", script_path.display()));
    let launch_checked = Arc::new(tokio::sync::Notify::new());
    let continue_launch = Arc::new(tokio::sync::Notify::new());
    let session = Arc::new(
        GeminiSession::new_process_test(
            "workspace-session-interrupt-generation".to_string(),
            directory.clone(),
            Some(EngineConfig {
                bin_path: Some(script_path.to_string_lossy().to_string()),
                ..Default::default()
            }),
        )
        .with_process_launch_test_hook(Arc::clone(&launch_checked), Arc::clone(&continue_launch)),
    );
    let send_task = tokio::spawn({
        let session = Arc::clone(&session);
        async move {
            session
                .send_message(
                    SendMessageParams {
                        text: "must not spawn".to_string(),
                        ..Default::default()
                    },
                    "turn-session-interrupt-generation",
                )
                .await
        }
    });

    launch_checked.notified().await;
    session
        .interrupt()
        .await
        .expect("session interrupt should establish a launch barrier");
    continue_launch.notify_one();
    let error = send_task
        .await
        .expect("send task should join")
        .expect_err("pre-registration send must be interrupted");

    assert_eq!(error, "Session stopped.");
    assert!(!spawn_marker.exists());
    assert!(session.active_process_ids().await.is_empty());
    let _ = std::fs::remove_dir_all(directory);
}

#[cfg(unix)]
#[tokio::test]
async fn closed_session_rejects_stale_arc_before_fake_cli_spawn() {
    let (directory, script_path) = write_unix_test_script(
        "ccgui-gemini-closed-session",
        r#"
printf 'spawned' > "${0}.spawned"
cat >/dev/null
"#,
    );
    let spawn_marker = PathBuf::from(format!("{}.spawned", script_path.display()));
    let session = GeminiSession::new_process_test(
        "workspace-closed-session".to_string(),
        directory.clone(),
        Some(EngineConfig {
            bin_path: Some(script_path.to_string_lossy().to_string()),
            ..Default::default()
        }),
    );

    session.close().await.expect("close empty session");
    let error = session
        .send_message(
            SendMessageParams {
                text: "stale owner must not spawn".to_string(),
                ..Default::default()
            },
            "turn-after-close",
        )
        .await
        .expect_err("closed session must reject stale Arc");

    assert_eq!(error, "Gemini session is closed");
    assert!(!spawn_marker.exists());
    assert!(session.active_process_ids().await.is_empty());
    let _ = std::fs::remove_dir_all(directory);
}

#[cfg(unix)]
#[tokio::test]
async fn normal_terminal_state_reaps_child_and_preserves_stdin_payload() {
    let (directory, script_path) = write_unix_test_script(
        "moss-x-gemini-terminal",
        r#"
cat > "${0}.prompt"
printf '%s\n' '{"type":"result","status":"success","text":"terminal ok"}'
"#,
    );
    let prompt_path = PathBuf::from(format!("{}.prompt", script_path.display()));
    let session = GeminiSession::new_process_test(
        "workspace-terminal".to_string(),
        directory.clone(),
        Some(EngineConfig {
            bin_path: Some(script_path.to_string_lossy().to_string()),
            ..Default::default()
        }),
    );
    let params = SendMessageParams {
        text: "Output language: Simplified Chinese.\n\n终态 prompt".to_string(),
        ..Default::default()
    };

    let response = session
        .send_message(params.clone(), "turn-terminal")
        .await
        .expect("fake Gemini terminal response");

    assert_eq!(response, "terminal ok");
    assert_eq!(
        std::fs::read_to_string(&prompt_path).expect("captured stdin prompt"),
        params.text
    );
    assert!(session.active_process_ids().await.is_empty());
    let _ = std::fs::remove_dir_all(directory);
}

#[cfg(unix)]
#[tokio::test]
async fn large_stdin_and_early_stdout_do_not_pipe_deadlock() {
    let (directory, script_path) = write_unix_test_script(
        "moss-x-gemini-concurrent-pipes",
        r#"
i=0
while [ "$i" -lt 8192 ]; do
  printf 'early-output-padding-0123456789'
  i=$((i + 1))
done
printf '\n'
cat > "${0}.prompt"
printf '%s\n' '{"type":"result","status":"success","text":"concurrent io ok"}'
"#,
    );
    let prompt_path = PathBuf::from(format!("{}.prompt", script_path.display()));
    let session = GeminiSession::new_process_test(
        "workspace-concurrent-pipes".to_string(),
        directory.clone(),
        Some(EngineConfig {
            bin_path: Some(script_path.to_string_lossy().to_string()),
            ..Default::default()
        }),
    );
    let params = SendMessageParams {
        text: format!(
            "Output language: Simplified Chinese.\n\n{}",
            "large-prompt".repeat(64 * 1024)
        ),
        ..Default::default()
    };

    let response = tokio::time::timeout(
        Duration::from_secs(5),
        session.send_message(params.clone(), "turn-concurrent-pipes"),
    )
    .await
    .expect("concurrent pipe transport should not time out")
    .expect("fake Gemini should complete");

    assert_eq!(response, "concurrent io ok");
    assert_eq!(
        std::fs::read_to_string(&prompt_path).expect("captured large stdin prompt"),
        params.text
    );
    assert!(session.active_process_ids().await.is_empty());
    let _ = std::fs::remove_dir_all(directory);
}

#[cfg(unix)]
#[tokio::test]
async fn interrupt_turn_terminates_owned_process_tree_and_reaps_registry() {
    let (directory, script_path) = write_unix_test_script(
        "moss-x-gemini-interrupt-tree",
        r#"
sleep 60 &
descendant_pid=$!
printf '%s' "$$" > "${0}.root.pid"
printf '%s' "$descendant_pid" > "${0}.descendant.pid"
wait "$descendant_pid"
"#,
    );
    let root_pid_path = PathBuf::from(format!("{}.root.pid", script_path.display()));
    let descendant_pid_path = PathBuf::from(format!("{}.descendant.pid", script_path.display()));
    let session = Arc::new(GeminiSession::new_process_test(
        "workspace-interrupt".to_string(),
        directory.clone(),
        Some(EngineConfig {
            bin_path: Some(script_path.to_string_lossy().to_string()),
            ..Default::default()
        }),
    ));
    let params = SendMessageParams {
        text: "Output language: Simplified Chinese.\n\ninterrupt tree".to_string(),
        ..Default::default()
    };
    let send_task = tokio::spawn({
        let session = Arc::clone(&session);
        async move { session.send_message(params, "turn-interrupt-tree").await }
    });

    let root_pid = wait_for_pid_file(&root_pid_path).await;
    let descendant_pid = wait_for_pid_file(&descendant_pid_path).await;
    session
        .interrupt_turn("turn-interrupt-tree")
        .await
        .expect("interrupt owned Gemini tree");
    let send_result = tokio::time::timeout(Duration::from_secs(3), send_task)
        .await
        .expect("send task should settle")
        .expect("send task join");

    assert!(send_result.is_err());
    assert!(session.active_process_ids().await.is_empty());
    assert!(wait_for_process_exit(root_pid).await);
    assert!(wait_for_process_exit(descendant_pid).await);
    let _ = std::fs::remove_dir_all(directory);
}

#[cfg(unix)]
#[tokio::test]
async fn timeout_terminates_owned_process_tree_and_reaps_registry() {
    let (directory, script_path) = write_unix_test_script(
        "moss-x-gemini-timeout-tree",
        r#"
sleep 60 &
descendant_pid=$!
printf '%s' "$$" > "${0}.root.pid"
printf '%s' "$descendant_pid" > "${0}.descendant.pid"
wait "$descendant_pid"
"#,
    );
    let root_pid_path = PathBuf::from(format!("{}.root.pid", script_path.display()));
    let descendant_pid_path = PathBuf::from(format!("{}.descendant.pid", script_path.display()));
    let session = GeminiSession::new_process_test(
        "workspace-timeout".to_string(),
        directory.clone(),
        Some(EngineConfig {
            bin_path: Some(script_path.to_string_lossy().to_string()),
            ..Default::default()
        }),
    );
    let params = SendMessageParams {
        text: "Output language: Simplified Chinese.\n\ntimeout tree".to_string(),
        ..Default::default()
    };

    let result = session
        .send_message_with_timeout(params, "turn-timeout-tree", Duration::from_secs(5))
        .await;
    let root_pid = wait_for_pid_file(&root_pid_path).await;
    let descendant_pid = wait_for_pid_file(&descendant_pid_path).await;

    assert_eq!(
        result.expect_err("turn should time out"),
        "Gemini response timed out"
    );
    assert!(session.active_process_ids().await.is_empty());
    assert!(wait_for_process_exit(root_pid).await);
    assert!(wait_for_process_exit(descendant_pid).await);
    let _ = std::fs::remove_dir_all(directory);
}

#[cfg(unix)]
#[tokio::test]
async fn timeout_after_stdout_eof_terminates_and_reaps_owned_tree() {
    let (directory, script_path) = write_unix_test_script(
        "moss-x-gemini-timeout-after-stdout-eof",
        r#"
sleep 60 >/dev/null 2>&1 &
descendant_pid=$!
printf '%s' "$$" > "${0}.root.pid"
printf '%s' "$descendant_pid" > "${0}.descendant.pid"
exec 1>&-
wait "$descendant_pid"
"#,
    );
    let root_pid_path = PathBuf::from(format!("{}.root.pid", script_path.display()));
    let descendant_pid_path = PathBuf::from(format!("{}.descendant.pid", script_path.display()));
    let session = GeminiSession::new_process_test(
        "workspace-timeout-after-stdout-eof".to_string(),
        directory.clone(),
        Some(EngineConfig {
            bin_path: Some(script_path.to_string_lossy().to_string()),
            ..Default::default()
        }),
    );
    let params = SendMessageParams {
        text: "Output language: Simplified Chinese.\n\ntimeout after stdout EOF".to_string(),
        ..Default::default()
    };

    let result = session
        .send_message_with_timeout(
            params,
            "turn-timeout-after-stdout-eof",
            Duration::from_secs(5),
        )
        .await;
    let root_pid = wait_for_pid_file(&root_pid_path).await;
    let descendant_pid = wait_for_pid_file(&descendant_pid_path).await;

    assert_eq!(
        result.expect_err("turn should time out after stdout EOF"),
        "Gemini response timed out"
    );
    assert!(session.active_process_ids().await.is_empty());
    assert!(wait_for_process_exit(root_pid).await);
    assert!(wait_for_process_exit(descendant_pid).await);
    let _ = std::fs::remove_dir_all(directory);
}

#[cfg(unix)]
#[tokio::test]
async fn shared_termination_escalates_when_descendant_ignores_term() {
    let (directory, script_path) = write_unix_test_script(
        "moss-x-shared-termination-term-resistant-descendant",
        r#"
(
  trap '' TERM
  printf '1' > "${0}.descendant.ready"
  while :; do sleep 1; done
) &
descendant_pid=$!
printf '%s' "$$" > "${0}.root.pid"
printf '%s' "$descendant_pid" > "${0}.descendant.pid"
wait "$descendant_pid"
"#,
    );
    let root_pid_path = PathBuf::from(format!("{}.root.pid", script_path.display()));
    let descendant_pid_path = PathBuf::from(format!("{}.descendant.pid", script_path.display()));
    let descendant_ready_path =
        PathBuf::from(format!("{}.descendant.ready", script_path.display()));
    let mut command = Command::new(&script_path);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    GeminiSession::configure_spawn_command(&mut command);
    let mut child = command.spawn().expect("spawn grouped process tree");
    let root_pid = wait_for_pid_file(&root_pid_path).await;
    let descendant_pid = wait_for_pid_file(&descendant_pid_path).await;
    wait_for_pid_file(&descendant_ready_path).await;

    let forced = crate::runtime::terminate_workspace_session_process(&mut child)
        .await
        .expect("terminate shared process group");

    assert!(forced, "TERM-resistant descendant requires SIGKILL");
    assert!(wait_for_process_exit(root_pid).await);
    assert!(wait_for_process_exit(descendant_pid).await);
    let _ = std::fs::remove_dir_all(directory);
}

#[cfg(unix)]
#[tokio::test]
async fn stdin_write_failure_terminates_and_reaps_registered_child() {
    let (directory, script_path) = write_unix_test_script(
        "moss-x-gemini-stdin-failure",
        r#"
printf '%s' "$$" > "${0}.root.pid"
exec 0<&-
sleep 60
"#,
    );
    let root_pid_path = PathBuf::from(format!("{}.root.pid", script_path.display()));
    let session = GeminiSession::new_process_test(
        "workspace-stdin-failure".to_string(),
        directory.clone(),
        Some(EngineConfig {
            bin_path: Some(script_path.to_string_lossy().to_string()),
            ..Default::default()
        }),
    );
    let params = SendMessageParams {
        text: format!(
            "Output language: Simplified Chinese.\n\n{}",
            "payload".repeat(256 * 1024)
        ),
        ..Default::default()
    };

    let result = tokio::time::timeout(
        Duration::from_secs(3),
        session.send_message(params, "turn-stdin-failure"),
    )
    .await
    .expect("stdin failure should settle");
    let root_pid = wait_for_pid_file(&root_pid_path).await;

    assert!(result
        .expect_err("stdin write should fail")
        .contains("Failed to write Gemini prompt to stdin"));
    assert!(session.active_process_ids().await.is_empty());
    assert!(wait_for_process_exit(root_pid).await);
    let _ = std::fs::remove_dir_all(directory);
}

#[cfg(unix)]
#[tokio::test]
async fn manager_removal_interrupts_owned_child_without_waiting_for_drop() {
    let manager = EngineManager::new();
    let workspace_path = unique_temp_path("moss-x-gemini-manager-remove");
    std::fs::create_dir_all(&workspace_path).expect("create workspace");
    let session = manager
        .get_or_create_gemini_session("workspace-remove", &workspace_path)
        .await
        .expect("create managed Gemini session");
    let pid = register_grouped_sleep_child(&session, "turn-remove").await;

    manager
        .remove_gemini_session("workspace-remove")
        .await
        .expect("remove managed Gemini session");

    assert!(manager
        .get_gemini_session("workspace-remove")
        .await
        .is_none());
    assert!(session.process_registry.lock().await.closed);
    assert!(session.active_process_ids().await.is_empty());
    assert!(wait_for_process_exit(pid).await);
    let _ = std::fs::remove_dir_all(workspace_path);
}

#[cfg(unix)]
#[tokio::test]
async fn manager_removal_propagates_cleanup_failure_and_retains_owner() {
    let manager = EngineManager::new();
    let workspace_path = unique_temp_path("ccgui-gemini-manager-remove-failure");
    std::fs::create_dir_all(&workspace_path).expect("create workspace");
    let session = manager
        .get_or_create_gemini_session("workspace-remove-failure", &workspace_path)
        .await
        .expect("create managed Gemini session");
    let mut command = Command::new("sleep");
    command
        .arg("60")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let ungrouped_child = command.spawn().expect("spawn ungrouped child");
    session
        .process_registry
        .lock()
        .await
        .active_processes
        .insert(
            "turn-remove-failure".to_string(),
            super::ActiveGeminiChildProcess::new(ungrouped_child),
        );

    let error = manager
        .remove_gemini_session("workspace-remove-failure")
        .await
        .expect_err("cleanup failure must propagate");

    assert!(error.contains("Failed to terminate Gemini process"));
    let retained = manager
        .get_gemini_session("workspace-remove-failure")
        .await
        .expect("failed cleanup must retain manager ownership");
    assert!(Arc::ptr_eq(&retained, &session));
    assert!(session
        .process_registry
        .lock()
        .await
        .active_processes
        .contains_key("turn-remove-failure"));

    session
        .process_registry
        .lock()
        .await
        .active_processes
        .clear();
    let _ = std::fs::remove_dir_all(workspace_path);
}

#[cfg(unix)]
#[tokio::test]
async fn manager_rejects_creation_while_workspace_removal_owns_session() {
    let manager = Arc::new(EngineManager::new());
    let workspace_path = unique_temp_path("moss-x-gemini-manager-remove-gate");
    std::fs::create_dir_all(&workspace_path).expect("create workspace");
    let session = manager
        .get_or_create_gemini_session("workspace-remove-gate", &workspace_path)
        .await
        .expect("create managed Gemini session");
    let pid = register_grouped_sleep_child(&session, "turn-remove-gate").await;
    let remove_task = tokio::spawn({
        let manager = Arc::clone(&manager);
        async move {
            manager
                .remove_gemini_session("workspace-remove-gate")
                .await
                .expect("remove managed Gemini session");
        }
    });

    let mut removal_gate_observed = false;
    for _ in 0..100 {
        match manager
            .get_or_create_gemini_session("workspace-remove-gate", &workspace_path)
            .await
        {
            Err(error) if error.contains("removed workspace") => {
                removal_gate_observed = true;
                break;
            }
            Ok(current) => assert!(Arc::ptr_eq(&current, &session)),
            Err(error) => panic!("unexpected creation error: {error}"),
        }
        tokio::task::yield_now().await;
    }
    assert!(
        removal_gate_observed,
        "concurrent creation should observe the workspace removal gate"
    );
    remove_task.await.expect("remove task should join");

    let delayed_create_error = match manager
        .get_or_create_gemini_session("workspace-remove-gate", &workspace_path)
        .await
    {
        Err(error) => error,
        Ok(_) => panic!("a delayed request must not recreate a removed workspace session"),
    };
    assert!(delayed_create_error.contains("removed workspace"));
    assert!(session.process_registry.lock().await.closed);
    assert!(session.active_process_ids().await.is_empty());
    assert!(wait_for_process_exit(pid).await);
    let _ = std::fs::remove_dir_all(workspace_path);
}

#[cfg(unix)]
#[tokio::test]
async fn app_exit_shutdown_drains_sessions_and_reaps_owned_children() {
    let manager = EngineManager::new();
    let workspace_path = unique_temp_path("moss-x-gemini-manager-shutdown");
    std::fs::create_dir_all(&workspace_path).expect("create workspace");
    let session = manager
        .get_or_create_gemini_session("workspace-shutdown", &workspace_path)
        .await
        .expect("create managed Gemini session");
    let pid = register_grouped_sleep_child(&session, "turn-shutdown").await;

    manager
        .shutdown_gemini_sessions()
        .await
        .expect("shutdown managed Gemini sessions");

    assert!(manager
        .get_gemini_session("workspace-shutdown")
        .await
        .is_none());
    assert!(session.process_registry.lock().await.closed);
    assert!(session.active_process_ids().await.is_empty());
    assert!(wait_for_process_exit(pid).await);
    let _ = std::fs::remove_dir_all(workspace_path);
}

#[cfg(unix)]
#[tokio::test]
async fn shutdown_aggregates_failure_while_removing_success_and_retaining_failed_owner() {
    let manager = EngineManager::new();
    let workspace_path = unique_temp_path("ccgui-gemini-manager-mixed-shutdown");
    std::fs::create_dir_all(&workspace_path).expect("create workspace");
    let failed_session = manager
        .get_or_create_gemini_session("workspace-shutdown-failure", &workspace_path)
        .await
        .expect("create failure Gemini session");
    let successful_session = manager
        .get_or_create_gemini_session("workspace-shutdown-success", &workspace_path)
        .await
        .expect("create successful Gemini session");
    let mut ungrouped_command = Command::new("sleep");
    ungrouped_command
        .arg("60")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let ungrouped_child = ungrouped_command
        .spawn()
        .expect("spawn ungrouped failure child");
    let failed_pid = ungrouped_child.id().expect("failure child pid");
    failed_session
        .process_registry
        .lock()
        .await
        .active_processes
        .insert(
            "turn-shutdown-failure".to_string(),
            super::ActiveGeminiChildProcess::new(ungrouped_child),
        );
    let successful_pid =
        register_grouped_sleep_child(&successful_session, "turn-shutdown-success").await;

    let error = manager
        .shutdown_gemini_sessions()
        .await
        .expect_err("mixed shutdown must aggregate cleanup failure");

    assert!(error.contains("workspace-shutdown-failure"));
    let retained = manager
        .get_gemini_session("workspace-shutdown-failure")
        .await
        .expect("failed owner must stay registered");
    assert!(Arc::ptr_eq(&retained, &failed_session));
    assert!(manager
        .get_gemini_session("workspace-shutdown-success")
        .await
        .is_none());
    assert!(failed_session
        .process_registry
        .lock()
        .await
        .active_processes
        .contains_key("turn-shutdown-failure"));
    assert!(successful_session.active_process_ids().await.is_empty());
    assert!(wait_for_process_exit(failed_pid).await);
    assert!(wait_for_process_exit(successful_pid).await);

    failed_session
        .process_registry
        .lock()
        .await
        .active_processes
        .clear();
    let _ = std::fs::remove_dir_all(workspace_path);
}

#[cfg(unix)]
#[tokio::test]
async fn manager_shutdown_gate_rejects_concurrent_and_future_creation() {
    let manager = Arc::new(EngineManager::new());
    let workspace_path = unique_temp_path("moss-x-gemini-manager-shutdown-gate");
    std::fs::create_dir_all(&workspace_path).expect("create workspace");
    let session = manager
        .get_or_create_gemini_session("workspace-shutdown-gate", &workspace_path)
        .await
        .expect("create managed Gemini session");
    let pid = register_grouped_sleep_child(&session, "turn-shutdown-gate").await;
    let shutdown_task = tokio::spawn({
        let manager = Arc::clone(&manager);
        async move {
            manager
                .shutdown_gemini_sessions()
                .await
                .expect("shutdown managed Gemini sessions");
        }
    });

    let concurrent_error = loop {
        match manager
            .get_or_create_gemini_session("workspace-shutdown-gate", &workspace_path)
            .await
        {
            Err(error) => break error,
            Ok(current) => assert!(Arc::ptr_eq(&current, &session)),
        }
        tokio::task::yield_now().await;
    };
    assert!(concurrent_error.contains("shutting down"));
    shutdown_task.await.expect("shutdown task should join");

    let future_error = match manager
        .get_or_create_gemini_session("workspace-shutdown-gate", &workspace_path)
        .await
    {
        Err(error) => error,
        Ok(_) => panic!("shutdown manager must stay closed to new Gemini sessions"),
    };
    assert!(future_error.contains("shutting down"));
    assert!(session.process_registry.lock().await.closed);
    assert!(session.active_process_ids().await.is_empty());
    assert!(wait_for_process_exit(pid).await);
    let _ = std::fs::remove_dir_all(workspace_path);
}
