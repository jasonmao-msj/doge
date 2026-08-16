//! PR title / body AI auto-generation.
//!
//! Collects the committed `base...head` range to feed the AI engine, then
//! formats a structured JSON prompt
//! so the model returns `{ "title": string, "body": string }` for the PR form.
//!
//! Engine dispatch goes through the existing `engine_send_message_sync` Tauri
//! command, which handles Claude / Codex / Gemini / OpenCode / Kimi uniformly
//! and returns `{ engine, text }`. We parse the text tolerantly into the
//! structured `PullRequestGeneratedContent` payload.

use serde_json::Value;
use tauri::{AppHandle, State};

use crate::engine::commands::engine_send_message_sync;
use crate::engine::EngineType;
use crate::git_utils::resolve_git_root;
use crate::state::AppState;
use crate::types::PullRequestGeneratedContent;
use crate::utils::{async_command, git_env_path, resolve_git_binary};

const MAX_TITLE_CHARS: usize = 72;
// ponytail: 60K 太长,大 PR 一次喂 60K chars ≈ 15K tokens,推理 + JSON 解析很容易超过 60s。
// 20K chars ≈ 5K tokens,绝大多数模型都能在 30-90s 内稳定给出 JSON 输出。
const MAX_PROMPT_DIFF_CHARS: usize = 20_000;

fn normalize_pull_request_language(language: Option<&str>) -> &'static str {
    if language.is_some_and(|value| value.trim().eq_ignore_ascii_case("en")) {
        "en"
    } else {
        "zh"
    }
}

/// Hard cap for diff feeding the AI prompt. Anything bigger is truncated and we
/// append a marker so the model knows the diff was clipped.
fn truncate_diff_for_prompt(diff: &str) -> String {
    if diff.chars().count() <= MAX_PROMPT_DIFF_CHARS {
        return diff.to_string();
    }
    let mut out = String::with_capacity(MAX_PROMPT_DIFF_CHARS + 64);
    let mut count = 0usize;
    for ch in diff.chars() {
        if count >= MAX_PROMPT_DIFF_CHARS {
            break;
        }
        out.push(ch);
        count += 1;
    }
    out.push_str("\n\n... (diff truncated for prompt length)\n");
    out
}

/// Build the PR title/body generation prompt.
///
/// Layout matches `build_commit_message_prompt` style:
/// - Chinese vs English templates share the same JSON schema constraint.
/// - title <= 72 chars; body uses `## 背景 / ## 改动点 / ## 验证` (zh) or
///   `## Background / ## Changes / ## Verification` (en) sections.
pub(super) fn build_pull_request_content_prompt(
    diff: &str,
    base_branch: &str,
    head_branch: &str,
    language: &str,
) -> String {
    let normalized = language.trim().to_ascii_lowercase();
    let truncated = truncate_diff_for_prompt(diff);

    let (intro, schema_label, body_template) = if normalized == "en" {
        (
            "You are drafting the title and body for a GitHub pull request. \
             Respond ENTIRELY in English. Use Conventional Commits style for the title.",
            "Schema",
            "## Background\n\
             - One bullet summarizing why this change exists.\n\
             ## Changes\n\
             - Bullets listing the actual modified files / subsystems.\n\
             ## Verification\n\
             - Bullets describing manual or automated checks already run.",
        )
    } else {
        (
            "你正在为一个 GitHub Pull Request 起草标题和正文。请全部使用中文回答，标题遵循 Conventional Commits 风格。",
            "输出 schema",
            "## 背景\n\
             - 一句话说明本次变更的目的。\n\
             ## 改动点\n\
             - 列出本次修改的具体文件 / 子系统要点。\n\
             ## 验证\n\
             - 列出已执行的人工或自动化校验项。",
        )
    };

    format!(
        "{intro}\n\n\
         Base branch: {base}\n\
         Head branch: {head}\n\n\
         Diff (between base and head, may be truncated):\n```\n{diff}\n```\n\n\
         {schema_label}: output ONLY a single JSON object, no prose around it:\n\
         {{\n  \
           \"title\": string (<= 72 chars, Conventional Commits style),\n  \
           \"body\": string (Markdown, follow this template):\n{body_template}\n\
         }}\n",
        intro = intro,
        base = base_branch,
        head = head_branch,
        diff = truncated,
        schema_label = schema_label,
        body_template = body_template,
    )
}

/// Tolerant JSON parser for AI responses.
///
/// Tries (in order):
/// 1. strict `serde_json::from_str` on the whole text.
/// 2. extract the first balanced `{...}` block and re-parse it.
/// Invalid model output fails closed so untrusted prose is never written into the form.
fn parse_pull_request_response(text: &str) -> Result<PullRequestGeneratedContent, String> {
    if let Ok(parsed) = serde_json::from_str::<PullRequestGeneratedContent>(text) {
        return validate_pull_request_content(parsed);
    }
    if let Some(slice) = extract_first_json_object(text) {
        if let Ok(parsed) = serde_json::from_str::<PullRequestGeneratedContent>(&slice) {
            return validate_pull_request_content(parsed);
        }
    }
    Err("Engine returned invalid pull request content JSON".to_string())
}

fn validate_pull_request_content(
    mut parsed: PullRequestGeneratedContent,
) -> Result<PullRequestGeneratedContent, String> {
    parsed.title = truncate_pr_title(parsed.title.trim());
    parsed.body = parsed.body.trim().to_string();
    if parsed.title.trim().is_empty() || parsed.body.trim().is_empty() {
        return Err("Engine returned incomplete pull request content".to_string());
    }
    Ok(parsed)
}

fn extract_first_json_object(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut depth: i32 = 0;
    let mut start: Option<usize> = None;
    let mut in_string = false;
    let mut escaped = false;
    for (idx, byte) in bytes.iter().enumerate() {
        if in_string {
            if escaped {
                escaped = false;
            } else if *byte == b'\\' {
                escaped = true;
            } else if *byte == b'"' {
                in_string = false;
            }
            continue;
        }
        if *byte == b'"' {
            in_string = true;
            continue;
        }
        match byte {
            b'{' => {
                if start.is_none() {
                    start = Some(idx);
                }
                depth += 1;
            }
            b'}' => {
                if let Some(s) = start {
                    depth -= 1;
                    if depth == 0 {
                        return Some(text[s..=idx].to_string());
                    }
                }
            }
            _ => {}
        }
    }
    None
}

/// Truncate the AI title to <= 72 chars and trim trailing whitespace / punctuation.
pub(super) fn truncate_pr_title(title: &str) -> String {
    let mut out: String = title.chars().take(MAX_TITLE_CHARS).collect();
    while let Some(character) = out.chars().last() {
        if !character.is_whitespace()
            && !character.is_ascii_punctuation()
            && !matches!(character, '。' | '，' | '：' | '；' | '！' | '？')
        {
            break;
        }
        out.pop();
    }
    out
}

async fn collect_pull_request_range_diff(
    workspace_id: &str,
    base_branch: &str,
    head_branch: &str,
    state: &State<'_, AppState>,
) -> Result<String, String> {
    let workspaces = state.workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .ok_or("workspace not found")?
        .clone();
    drop(workspaces);
    let repo_root = resolve_git_root(&entry)?;
    let base = base_branch.trim();
    let head = head_branch.trim();
    if base.is_empty() || head.is_empty() {
        return Err("Base and head branches are required".to_string());
    }
    let range = format!("{base}...{head}");
    let git_bin = resolve_git_binary().map_err(|error| format!("Failed to run git: {error}"))?;
    let output = async_command(git_bin)
        .args(["diff", "--no-color", "--find-renames", range.as_str()])
        .current_dir(repo_root)
        .env("PATH", git_env_path())
        .output()
        .await
        .map_err(|error| format!("Failed to run git: {error}"))?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).into_owned());
    }
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if detail.is_empty() {
        "Git pull request range diff failed".to_string()
    } else {
        detail
    })
}

pub(super) async fn get_pull_request_content_prompt_impl(
    workspace_id: &str,
    base_branch: &str,
    head_branch: &str,
    language: &str,
    state: &State<'_, AppState>,
) -> Result<String, String> {
    let diff =
        collect_pull_request_range_diff(workspace_id, base_branch, head_branch, state).await?;
    if diff.trim().is_empty() {
        return Err("No changes to generate pull request content for".to_string());
    }
    Ok(build_pull_request_content_prompt(
        &diff,
        base_branch,
        head_branch,
        language,
    ))
}

/// Public entry point. Returns the AI-generated PR title + body.
pub(super) async fn generate_pull_request_content_impl(
    workspace_id: &str,
    language: Option<&str>,
    engine: &str,
    base_branch: &str,
    head_branch: &str,
    state: &State<'_, AppState>,
    app: &AppHandle,
) -> Result<PullRequestGeneratedContent, String> {
    let normalized_language = normalize_pull_request_language(language);
    let prompt = get_pull_request_content_prompt_impl(
        workspace_id,
        base_branch,
        head_branch,
        &normalized_language,
        state,
    )
    .await?;

    let raw_text = dispatch_pull_request_prompt(workspace_id, &prompt, engine, state, app).await?;

    let mut parsed = parse_pull_request_response(&raw_text)?;
    parsed.engine = engine.to_string();
    parsed.language = normalized_language.to_string();
    Ok(parsed)
}

async fn dispatch_pull_request_prompt(
    workspace_id: &str,
    prompt: &str,
    engine: &str,
    state: &State<'_, AppState>,
    app: &AppHandle,
) -> Result<String, String> {
    let requested_engine = serde_json::from_value::<EngineType>(Value::String(engine.to_string()))
        .map_err(|_| format!("Unsupported engine: {engine}"))?;
    let value: Value = engine_send_message_sync(
        workspace_id.to_string(),
        prompt.to_string(),
        Some(requested_engine),
        None,
        None,
        Some(false),
        None,
        None,
        false,
        None,
        None,
        None,
        None,
        None,
        Some(crate::session_management::AutoSessionMetadata {
            session_purpose: "pull-request-content".to_string(),
            visibility: crate::session_management::AutoSessionVisibility::Hidden,
            owner_feature: "git".to_string(),
            auto_archive: Some(true),
            created_by: crate::session_management::AutoSessionCreatedBy::System,
        }),
        app.clone(),
        state.clone(),
    )
    .await?;

    if let Some(text) = value.get("text").and_then(|t| t.as_str()) {
        return Ok(text.to_string());
    }
    Err("Engine returned no text payload".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{AppSettings, WorkspaceEntry, WorkspaceKind, WorkspaceSettings};
    use std::fs;
    use std::process::Command;

    fn run_git(path: &std::path::Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(path)
            .status()
            .expect("run git");
        assert!(status.success());
    }

    fn tauri_state<'a>(state: &'a AppState) -> State<'a, AppState> {
        // SAFETY: Tauri 2 State is a single-field newtype over &T; test only.
        unsafe { std::mem::transmute::<&'a AppState, State<'a, AppState>>(state) }
    }

    fn test_state(workspace_id: &str, repo_root: &std::path::Path) -> AppState {
        let data_dir =
            std::env::temp_dir().join(format!("ccgui-pr-state-{}", uuid::Uuid::new_v4()));
        let mut workspaces = std::collections::HashMap::new();
        workspaces.insert(
            workspace_id.to_string(),
            WorkspaceEntry {
                id: workspace_id.to_string(),
                name: "test".to_string(),
                path: repo_root.to_string_lossy().into_owned(),
                codex_bin: None,
                kind: WorkspaceKind::Main,
                parent_id: None,
                worktree: None,
                settings: WorkspaceSettings::default(),
            },
        );
        AppState {
            account_runtime: crate::account::AccountRuntime::load(&data_dir),
            workspaces: tokio::sync::Mutex::new(workspaces),
            sessions: tokio::sync::Mutex::new(std::collections::HashMap::new()),
            terminal_sessions: tokio::sync::Mutex::new(std::collections::HashMap::new()),
            runtime_log_sessions: tokio::sync::Mutex::new(std::collections::HashMap::new()),
            browser_sessions: tokio::sync::Mutex::new(std::collections::HashMap::new()),
            browser_evidence: tokio::sync::Mutex::new(std::collections::HashMap::new()),
            remote_backend: tokio::sync::Mutex::new(None),
            storage_path: data_dir.join("workspaces.json"),
            settings_path: data_dir.join("settings.json"),
            app_settings: tokio::sync::Mutex::new(AppSettings::default()),
            settings_recovery_notice: tokio::sync::Mutex::new(None),
            workspaces_recovery_notice: tokio::sync::Mutex::new(None),
            codex_runtime_reload_lock: tokio::sync::Mutex::new(()),
            computer_use_activation_lock: tokio::sync::Mutex::new(()),
            computer_use_activation_verification: tokio::sync::Mutex::new(None),
            dictation: tokio::sync::Mutex::new(crate::dictation::DictationState::default()),
            codex_login_cancels: tokio::sync::Mutex::new(std::collections::HashMap::new()),
            detached_external_change_runtime: tokio::sync::Mutex::new(
                crate::workspaces::DetachedExternalChangeRuntime::default(),
            ),
            claude_commands_watches: tokio::sync::Mutex::new(
                crate::claude_commands_watch::CommandsWatchRegistry::default(),
            ),
            runtime_manager: std::sync::Arc::new(crate::runtime::RuntimeManager::new(&data_dir)),
            shared_event_writer: None,
            shared_runtime_coordinator:
                crate::shared_runtime_coordinator::SharedRuntimeCoordinator::default(),
            renderer_heartbeats: tokio::sync::Mutex::new(
                crate::renderer_stability::RendererHeartbeatStore::default(),
            ),
            semantic_navigation_runtime: crate::code_intel_lsp::SemanticNavigationRuntime::default(
            ),
            engine_manager: crate::engine::EngineManager::new(),
        }
    }

    #[test]
    fn builds_zh_prompt_with_diff_and_branches() {
        let prompt = build_pull_request_content_prompt(
            "diff --git a/foo.ts b/foo.ts\n@@\n-old\n+new\n",
            "main",
            "feature/v0.7.4",
            "zh",
        );
        assert!(prompt.contains("Base branch: main"));
        assert!(prompt.contains("Head branch: feature/v0.7.4"));
        assert!(prompt.contains("## 背景"));
        assert!(prompt.contains("title"));
        assert!(prompt.contains("body"));
    }

    #[test]
    fn builds_en_prompt_with_template_labels() {
        let prompt = build_pull_request_content_prompt(
            "diff --git a/foo.ts b/foo.ts\n",
            "main",
            "feature/x",
            "en",
        );
        assert!(prompt.contains("Background"));
        assert!(prompt.contains("Changes"));
        assert!(prompt.contains("Verification"));
    }

    #[test]
    fn normalizes_language_to_supported_values() {
        assert_eq!(normalize_pull_request_language(Some(" EN ")), "en");
        assert_eq!(normalize_pull_request_language(Some("fr")), "zh");
        assert_eq!(normalize_pull_request_language(None), "zh");
    }

    #[test]
    fn truncates_titles_to_seventy_two_chars() {
        let long = "a".repeat(120);
        let out = truncate_pr_title(&long);
        assert_eq!(out.chars().count(), 72);
        assert!(!out.ends_with('.'));
        assert!(!out.ends_with(' '));
    }

    #[test]
    fn strips_trailing_punctuation_from_short_titles() {
        let out = truncate_pr_title("feat: hello！？ ");
        assert_eq!(out, "feat: hello");
    }

    #[test]
    fn parses_strict_json_response() {
        let raw = "{\"title\":\"feat: x\",\"body\":\"## Bg - hi\",\"engine\":\"codex\",\"language\":\"zh\"}";
        let parsed = parse_pull_request_response(raw).expect("valid response");
        assert_eq!(parsed.title, "feat: x");
        assert!(parsed.body.contains("Bg"));
    }

    #[test]
    fn parses_first_balanced_object_from_prose_response() {
        let raw = "Some intro prose.\n{\"title\":\"feat: y\",\"body\":\"ok\"}\nThanks!";
        let parsed = parse_pull_request_response(raw).expect("valid response");
        assert_eq!(parsed.title, "feat: y");
        assert_eq!(parsed.body, "ok");
    }

    #[test]
    fn rejects_raw_body_when_no_json_found() {
        let raw = "no json here at all";
        assert!(parse_pull_request_response(raw).is_err());
    }

    #[test]
    fn parses_json_with_braces_inside_body_string() {
        let raw = r#"prefix {"title":"feat: x","body":"Use `const x = {}` safely"} suffix"#;
        let parsed = parse_pull_request_response(raw).expect("valid response");
        assert!(parsed.body.contains("{}"));
    }

    #[test]
    fn rejects_incomplete_json() {
        let raw = r#"{"title":"","body":"some body"}"#;
        assert!(parse_pull_request_response(raw).is_err());
    }

    #[test]
    fn rejects_title_that_becomes_empty_after_truncation() {
        let raw = r#"{"title":"...！？","body":"some body"}"#;
        assert!(parse_pull_request_response(raw).is_err());
    }

    #[test]
    fn diff_truncation_marker_present_for_huge_diffs() {
        let huge = "x".repeat(MAX_PROMPT_DIFF_CHARS + 1024);
        let truncated = truncate_diff_for_prompt(&huge);
        assert!(truncated.chars().count() <= MAX_PROMPT_DIFF_CHARS + 64);
        assert!(truncated.contains("truncated for prompt length"));
    }

    #[tokio::test]
    async fn range_diff_accepts_remote_tracking_base_ref() {
        let temp = std::env::temp_dir().join(format!("ccgui-pr-content-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp).expect("create temp repo");
        run_git(&temp, &["init"]);
        run_git(&temp, &["config", "user.email", "test@example.com"]);
        run_git(&temp, &["config", "user.name", "Test"]);
        fs::write(temp.join("file.txt"), "base\n").expect("write base");
        run_git(&temp, &["add", "."]);
        run_git(&temp, &["commit", "-m", "base"]);
        run_git(&temp, &["update-ref", "refs/remotes/upstream/main", "HEAD"]);
        fs::write(temp.join("file.txt"), "base\nfeature\n").expect("write feature");
        run_git(&temp, &["add", "."]);
        run_git(&temp, &["commit", "-m", "feature"]);

        let app_state = test_state("workspace-test", &temp);
        let state = tauri_state(&app_state);
        let diff =
            collect_pull_request_range_diff("workspace-test", "upstream/main", "HEAD", &state)
                .await
                .expect("range diff");
        assert!(diff.contains("+feature"));
        let _ = fs::remove_dir_all(temp);
    }
}
