//! Gate 4 / task 7.1：Target 切换矩阵集成测试（Wave 4 / Change B）。
//!
//! 矩阵：Claude/Official → Claude/OpenRouter → Codex/OpenAI → 切回 Claude/Official。
//! 断言：
//! - 一个 Shared Session 下三条 Hidden Binding 各自独立（claude:default /
//!   claude:openrouter / codex:openai），互不串线；
//! - 切回旧 target 复用既有 binding（native identity 保留，不重新 provisioning）；
//! - Provenance 正确：每个 turn 的 turnRequested / turnCommitted 都携带当次 target；
//! - 单个 binding 的失败 commit 不污染其他 binding 状态（失败不重路由）。

mod common;

use common::TempStoreDir;
use doge_lib::shared_event_log::canonical::CanonicalProviderProfileSource;
use doge_lib::shared_event_log::{open, OpenOutcome, SharedEventWriter, StoreError};
use doge_lib::shared_session_v2::{
    accept_turn_core, begin_turn_core, commit_turn_core, BeginTurnStatus, CommitOutcomeInput,
    EngineType, ExecutionTargetInput,
};

const SESSION: &str = "v2-matrix-session";

fn open_writer(path: &std::path::Path) -> Result<SharedEventWriter, StoreError> {
    match open(path)? {
        OpenOutcome::Ready(writer) => Ok(writer),
        OpenOutcome::ReadOnlyRecovery { reason, .. } => Err(StoreError::Corruption {
            detail: reason.to_string(),
        }),
    }
}

fn target(engine: EngineType, provider: Option<&str>, model: &str) -> ExecutionTargetInput {
    ExecutionTargetInput {
        engine,
        provider_profile_id: provider.map(str::to_string),
        model_catalog_entry_id: None,
        model: Some(model.to_string()),
        reasoning_effort: None,
        provider_profile_name_snapshot: None,
        provider_profile_source: provider.map(|_| CanonicalProviderProfileSource::Managed),
        runtime_capability_fingerprint: None,
    }
}

fn completed() -> CommitOutcomeInput {
    CommitOutcomeInput {
        status: "completed".to_string(),
        error_code: None,
        error_message: None,
        stop_reason: Some("end_turn".to_string()),
    }
}

fn failed() -> CommitOutcomeInput {
    CommitOutcomeInput {
        status: "failed".to_string(),
        error_code: Some("runtime-error".to_string()),
        error_message: Some("boom".to_string()),
        stop_reason: None,
    }
}

fn provisioning_state(writer: &SharedEventWriter, binding_key: &str) -> Option<String> {
    let row = writer.binding_state(SESSION, binding_key).ok().flatten()?;
    let raw = row.provisioning_json?;
    serde_json::from_str::<serde_json::Value>(&raw)
        .ok()?
        .get("state")?
        .as_str()
        .map(str::to_string)
}

/// 执行一轮 begin + commit，返回 binding_key。
fn run_turn(
    writer: &SharedEventWriter,
    target: &ExecutionTargetInput,
    text: &str,
    outcome: &CommitOutcomeInput,
    native_id: &str,
) -> String {
    let begin = begin_turn_core(writer, SESSION, target, text.to_string(), None).expect("begin");
    assert_eq!(begin.status, BeginTurnStatus::Creating);
    let attempt_id = begin.attempt_id.clone().expect("attempt id");
    let logical_turn_id = begin.logical_turn_id.clone().expect("logical turn id");
    accept_turn_core(
        writer,
        SESSION,
        &attempt_id,
        &logical_turn_id,
        target,
        native_id,
    )
    .expect("accept");
    let commit = commit_turn_core(
        writer,
        SESSION,
        &attempt_id,
        &logical_turn_id,
        target,
        Some(format!("answer:{text}")),
        outcome,
        Some(native_id.to_string()),
    )
    .expect("commit");
    commit.binding_key
}

/// 收集指定 fact_type 的全部 payload。
fn payloads(writer: &SharedEventWriter, fact_type: &str) -> Vec<serde_json::Value> {
    writer
        .events_for_session(SESSION)
        .expect("events")
        .iter()
        .filter(|event| event.fact_type == fact_type)
        .map(|event| serde_json::from_str(&event.payload_json).expect("payload json"))
        .collect()
}

#[test]
fn target_switch_matrix_reuses_bindings_and_keeps_provenance() {
    let store = TempStoreDir::new("v2-matrix");
    let writer = open_writer(&store.db_path).expect("open writer");

    let claude_official = target(EngineType::Claude, None, "claude-sonnet-4-5");
    let claude_openrouter = target(EngineType::Claude, Some("openrouter"), "claude-sonnet-4-5");
    let codex_openai = target(EngineType::Codex, Some("openai"), "gpt-5-codex");

    // Phase 1：Claude/Official。
    let key1 = run_turn(
        &writer,
        &claude_official,
        "turn-1",
        &completed(),
        "claude-native-1",
    );
    assert_eq!(key1, "claude:default");

    // Phase 2：Claude/OpenRouter（新建 Hidden Binding，不动 default）。
    let key2 = run_turn(
        &writer,
        &claude_openrouter,
        "turn-2",
        &completed(),
        "or-native-1",
    );
    assert_eq!(key2, "claude:openrouter");
    let default_row = writer
        .binding_state(SESSION, "claude:default")
        .expect("default row")
        .expect("default row exists");
    assert_eq!(
        default_row.native_session_id.as_deref(),
        Some("claude-native-1")
    );
    assert_eq!(
        provisioning_state(&writer, "claude:default").as_deref(),
        Some("ready")
    );

    // Phase 3：Codex/OpenAI（第三条 Hidden Binding）。
    let key3 = run_turn(
        &writer,
        &codex_openai,
        "turn-3",
        &completed(),
        "codex-native-1",
    );
    assert_eq!(key3, "codex:openai");

    // Phase 4：切回 Claude/Official——复用既有 binding，native identity 不丢。
    let key4 = run_turn(
        &writer,
        &claude_official,
        "turn-4",
        &completed(),
        "claude-native-1",
    );
    assert_eq!(key4, "claude:default");
    let default_row = writer
        .binding_state(SESSION, "claude:default")
        .expect("default row")
        .expect("default row exists");
    assert_eq!(
        default_row.native_session_id.as_deref(),
        Some("claude-native-1")
    );
    assert_eq!(
        provisioning_state(&writer, "claude:default").as_deref(),
        Some("ready")
    );

    // 整个 session 恰好三条 Hidden Binding。
    let binding_count = ["claude:default", "claude:openrouter", "codex:openai"]
        .iter()
        .filter(|key| {
            writer
                .binding_state(SESSION, key)
                .expect("binding lookup")
                .is_some()
        })
        .count();
    assert_eq!(binding_count, 3);

    // Provenance：四个 turn 的 turnRequested 各自携带当次 target。
    let requested = payloads(&writer, "conversation.turnRequested");
    assert_eq!(requested.len(), 4);
    let provenance: Vec<(String, Option<String>)> = requested
        .iter()
        .map(|payload| {
            (
                payload["target"]["engine"]
                    .as_str()
                    .expect("engine")
                    .to_string(),
                payload["target"]["providerProfileId"]
                    .as_str()
                    .map(str::to_string),
            )
        })
        .collect();
    assert_eq!(
        provenance,
        vec![
            ("claude".to_string(), None),
            ("claude".to_string(), Some("openrouter".to_string())),
            ("codex".to_string(), Some("openai".to_string())),
            ("claude".to_string(), None),
        ]
    );
    // turnCommitted 同样带 target provenance。
    let committed = payloads(&writer, "conversation.turnCommitted");
    assert_eq!(committed.len(), 4);
    assert_eq!(committed[1]["target"]["providerProfileId"], "openrouter");
    assert_eq!(committed[2]["target"]["engine"], "codex");

    // Phase 5：Codex/OpenAI 上一轮失败——只影响自己的 binding，其他 binding 不被污染。
    let key5 = run_turn(
        &writer,
        &codex_openai,
        "turn-5",
        &failed(),
        "codex-native-1",
    );
    assert_eq!(key5, "codex:openai");
    // 失败 outcome 同样落 turnCommitted（explicit rejection 入正史），binding 回 ready。
    assert_eq!(
        provisioning_state(&writer, "codex:openai").as_deref(),
        Some("ready")
    );
    assert_eq!(
        provisioning_state(&writer, "claude:default").as_deref(),
        Some("ready")
    );
    assert_eq!(
        provisioning_state(&writer, "claude:openrouter").as_deref(),
        Some("ready")
    );
    // native 已显式接受后，即使最终失败，turnAccepted 仍是不可撤销的正史事实。
    let accepted = payloads(&writer, "conversation.turnAccepted");
    assert_eq!(accepted.len(), 5);
}
