//! Shared Session V2 Send 写路径（Wave 4 / Change B：B.3 Send V2 + B.4 Durable Provisioning）。
//!
//! 事务边界：
//! - Tx1（`shared_session_v2_begin_turn`）：runtime side effect 之前 Commit
//!   `conversation.turnRequested` + `TurnExecutionSnapshot`，并把 durable provisioning
//!   推进到 `creating`。
//! - Tx2（`shared_session_v2_commit_turn`）：`run.settled` 后经既有 assembler/sink 写
//!   `conversation.turnCommitted`（duplicate 幂等），推进 committed cursor，provisioning → ready。
//! - ACK 不确定（`shared_session_v2_mark_recovery`）：provisioning → `recovery-required`，
//!   禁止盲目重建；只有显式 `shared_session_v2_rebuild_binding` 能归档旧 Binding 重建。
//!
//! 结构：`*_core` 纯逻辑（只依赖 `SharedEventWriter`，可集成测试）+ Tauri command 薄封装。
//! 红线：本模块只通过 `SharedEventWriter` 写库（单写者），不直接触 SQLite。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

pub use crate::engine::EngineType;
use crate::shared_context::{
    accept_delivery, compile_context, is_zero_transfer_package, mark_delivery_sent,
    prepare_delivery, read_artifact, scan_orphan_artifacts, session_needs_history,
    terminal_binding_update, write_artifact, AcceptDeliveryRequest, ArtifactReadRequest,
    CompileContextRequest, MarkDeliverySentRequest, PendingDelivery, PrepareDeliveryRequest,
    RuntimeContextCapabilities,
};
use crate::shared_event_log::canonical::assembler::{
    RuntimeFinalSnapshot, RuntimeToolCall, RuntimeToolResult,
};
use crate::shared_event_log::canonical::sink;
use crate::shared_event_log::canonical::types::{
    ArtifactRef, CanonicalFact, CanonicalProviderProfileSource, CanonicalUserInput, ControlFact,
    OutcomeStatus, ReasoningSelection, TurnAcceptedFact, TurnExecutionSnapshot, TurnRequestedFact,
};
use crate::shared_event_log::{
    deterministic_json_bytes, AppendOutcome, BindingStateUpdate, LegacyImportRow,
    SharedEventWriter, StoreError, StoredBindingState,
};
use crate::shared_sessions::{
    ensure_supported_shared_session_engine, now_millis, parse_shared_session_id,
    read_latest_shared_session_snapshot, read_shared_session_meta,
    shared_session_projection_source, shared_target_binding_key, SharedSelectedTarget,
};
use crate::state::AppState;

// ---------------------------------------------------------------------------
// 输入类型
// ---------------------------------------------------------------------------

/// 前端四级 Picker 固化的 Execution Target（含 provider 元信息快照）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionTargetInput {
    pub engine: EngineType,
    pub provider_profile_id: Option<String>,
    #[serde(default)]
    pub model_catalog_entry_id: Option<String>,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub provider_profile_name_snapshot: Option<String>,
    pub provider_profile_source: Option<CanonicalProviderProfileSource>,
    pub runtime_capability_fingerprint: Option<String>,
}

pub(crate) fn context_capabilities(target: &ExecutionTargetInput) -> RuntimeContextCapabilities {
    // Adapter capability 在这里显式声明；compiler 只消费 capability，不按 engine 分支。
    // 当前 runtime bridge 对五种 Shared CLI 都有 user-channel prompt ACK，
    // structured import 等待对应 CLI method probe 后再打开，禁止猜测支持。
    match target.engine {
        EngineType::Codex => {
            let structured_history_import = target
                .runtime_capability_fingerprint
                .as_deref()
                .is_some_and(|fingerprint| fingerprint.contains("thread/inject_items"));
            RuntimeContextCapabilities {
                native_delta: false,
                structured_history_import,
                native_clone: false,
                user_channel_transcript: true,
                tool_history: structured_history_import,
                image_history: false,
                strong_context_ack: structured_history_import,
            }
        }
        EngineType::Claude => RuntimeContextCapabilities {
            native_delta: false,
            structured_history_import: false,
            native_clone: false,
            user_channel_transcript: true,
            tool_history: false,
            image_history: false,
            // Shared Claude runtime 强制启用 `--replay-user-messages`，因此 prompt-prefix
            // delivery 必须等到 coordinator 观察到精确 checksum echo，不能把 send
            // response 当作 context acceptance。fingerprint 只用于审计，不参与降级。
            strong_context_ack: true,
        },
        EngineType::Kimi | EngineType::Grok | EngineType::OpenCode => RuntimeContextCapabilities {
            native_delta: false,
            structured_history_import: false,
            native_clone: false,
            user_channel_transcript: true,
            tool_history: false,
            image_history: false,
            strong_context_ack: false,
        },
        _ => RuntimeContextCapabilities {
            native_delta: false,
            structured_history_import: false,
            native_clone: false,
            user_channel_transcript: false,
            tool_history: false,
            image_history: false,
            strong_context_ack: false,
        },
    }
}

fn raw_claude_session_id(value: &str) -> Option<&str> {
    let raw = value.strip_prefix("claude:").unwrap_or(value).trim();
    (!raw.is_empty()).then_some(raw)
}

fn raw_engine_session_id(engine: EngineType, value: &str) -> Option<&str> {
    let prefix = format!("{}:", engine.icon());
    let raw = value.strip_prefix(prefix.as_str()).unwrap_or(value).trim();
    (!raw.is_empty()).then_some(raw)
}

pub(crate) fn codex_import_items(package: &crate::shared_context::ContextPackage) -> Vec<Value> {
    codex_import_projection(package).0
}

/// OpenAI / Responses / 多数三方兼容 API 只接受这些 message.role。
/// Codex 本地 rollout 经 native-history 归一后会有 `control`（session meta / 未知 type），
/// 若原样 inject 进目标 thread，续接到 DeepSeek 等会在下次 turn 反序列化失败：
/// `unknown variant control, expected one of user, assistant, system, developer`.
fn is_portable_codex_message_role(role: &str) -> bool {
    matches!(
        role.trim().to_ascii_lowercase().as_str(),
        "user" | "assistant" | "system" | "developer"
    )
}

pub(crate) fn codex_import_projection(
    package: &crate::shared_context::ContextPackage,
) -> (Vec<Value>, usize) {
    let mut dropped_entries = 0;
    let mut items: Vec<Value> = package
        .delta
        .iter()
        .flat_map(|entry| {
            let text = entry
                .blocks
                .iter()
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n");
            let mut items = Vec::new();
            let role = entry.role.trim().to_ascii_lowercase();
            if !text.trim().is_empty() && is_portable_codex_message_role(&role) {
                let content_type = if role == "assistant" {
                    "output_text"
                } else {
                    "input_text"
                };
                items.push(json!({
                    "type": "message",
                    "role": role,
                    "content": [{ "type": content_type, "text": text }],
                }));
            }
            for block in &entry.blocks {
                if block.get("kind").and_then(Value::as_str) == Some("atomic-tool-exchange") {
                    let exchange = &block["exchange"];
                    if let (Some(name), Some(call_id)) = (
                        exchange.get("toolName").and_then(Value::as_str),
                        exchange.get("toolCallId").and_then(Value::as_str),
                    ) {
                        items.push(json!({
                            "type": "function_call",
                            "name": name,
                            "arguments": exchange.pointer("/call/argumentsSummary").and_then(Value::as_str).unwrap_or("{}"),
                            "call_id": call_id,
                        }));
                        items.push(json!({
                            "type": "function_call_output",
                            "call_id": call_id,
                            "output": exchange.pointer("/result/outputSummary").and_then(Value::as_str).unwrap_or(""),
                        }));
                    }
                }
                if block.get("kind").and_then(Value::as_str) == Some("native-block") {
                    let value = &block["value"];
                    if matches!(
                        value.get("type").and_then(Value::as_str),
                        Some("function_call" | "function_call_output")
                    ) {
                        items.push(value.clone());
                    }
                }
            }
            if items.is_empty() {
                dropped_entries += 1;
            }
            items
        })
        .collect();
    if !items.is_empty() {
        let package_marker = format!(
            "DOGE_CONTEXT_PACKAGE:{}:{}",
            package.package_id, package.manifest.source_checksum
        );
        let accepted_marker = format!(
            "DOGE_CONTEXT_ACCEPTED:{}:{}",
            package.package_id, package.manifest.source_checksum
        );
        items.insert(
            0,
            json!({
                "type": "message",
                "role": "user",
                "content": [{ "type": "input_text", "text": package_marker }],
            }),
        );
        items.push(json!({
            "type": "message",
            "role": "user",
            "content": [{ "type": "input_text", "text": accepted_marker }],
        }));
    }
    (items, dropped_entries)
}

fn context_artifact_root(state: &AppState) -> Result<&std::path::Path, String> {
    state
        .storage_path
        .parent()
        .ok_or_else(|| "app data directory unavailable".to_string())
}

impl ExecutionTargetInput {
    pub(crate) fn normalized_provider(&self) -> Option<String> {
        self.provider_profile_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    }

    pub(crate) fn to_snapshot(&self) -> TurnExecutionSnapshot {
        TurnExecutionSnapshot {
            engine: self.engine.icon().to_string(),
            provider_profile_id: self.normalized_provider(),
            model_catalog_entry_id: self
                .model_catalog_entry_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            model: self
                .model
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            reasoning: self
                .reasoning_effort
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|effort| ReasoningSelection {
                    effort: effort.to_string(),
                    extra: Value::Object(Default::default()),
                }),
            provider_profile_name_snapshot: self.provider_profile_name_snapshot.clone(),
            provider_profile_source: self.provider_profile_source.clone(),
            runtime_capability_fingerprint: self.runtime_capability_fingerprint.clone(),
            extra: Value::Object(Default::default()),
        }
    }
}

fn collaboration_mode_for_attempt(
    collaboration_mode: Option<Value>,
    target: &ExecutionTargetInput,
) -> Option<Value> {
    collaboration_mode.map(|payload| {
        let mut root = payload.as_object().cloned().unwrap_or_default();
        let mut settings = root
            .get("settings")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        match target
            .model
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some(model) => {
                settings.insert("model".to_string(), Value::String(model.to_string()));
            }
            None => {
                settings.remove("model");
            }
        }
        settings.remove("reasoningEffort");
        match target
            .reasoning_effort
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            Some(effort) => {
                settings.insert(
                    "reasoning_effort".to_string(),
                    Value::String(effort.to_string()),
                );
            }
            None => {
                settings.remove("reasoning_effort");
            }
        }

        root.insert("settings".to_string(), Value::Object(settings));
        Value::Object(root)
    })
}

#[cfg(test)]
mod execution_target_contract_tests {
    use super::*;

    #[test]
    fn execution_target_input_accepts_canonical_local_and_rejects_catalog_disk() {
        let local = serde_json::from_value::<ExecutionTargetInput>(json!({
            "engine": "codex",
            "providerProfileId": null,
            "modelCatalogEntryId": "gpt-5.3-codex-spark",
            "model": "gpt-5.3-codex-spark",
            "reasoningEffort": null,
            "providerProfileNameSnapshot": "本地配置",
            "providerProfileSource": "local",
            "runtimeCapabilityFingerprint": null
        }))
        .expect("canonical local target");
        assert_eq!(
            local.to_snapshot().provider_profile_source,
            Some(CanonicalProviderProfileSource::Local)
        );
        assert_eq!(
            local.model_catalog_entry_id.as_deref(),
            Some("gpt-5.3-codex-spark")
        );
        assert_eq!(
            local.to_snapshot().model_catalog_entry_id.as_deref(),
            Some("gpt-5.3-codex-spark")
        );

        let error = serde_json::from_value::<ExecutionTargetInput>(json!({
            "engine": "codex",
            "providerProfileSource": "disk"
        }))
        .expect_err("catalog source must not cross canonical IPC boundary");
        assert!(error.to_string().contains("unknown variant"));
    }

    #[test]
    fn claude_session_identity_accepts_legacy_raw_and_canonical_prefix() {
        assert_eq!(raw_claude_session_id("legacy-uuid"), Some("legacy-uuid"));
        assert_eq!(
            raw_claude_session_id("claude:canonical-uuid"),
            Some("canonical-uuid")
        );
        assert_eq!(raw_claude_session_id("claude:"), None);
    }

    #[test]
    fn execution_target_validation_rejects_mismatched_catalog_runtime_pair() {
        let catalog =
            crate::engine::status::get_local_engine_models_for_validation(EngineType::Codex)
                .expect("Codex local catalog");
        let selected = catalog.first().expect("non-empty Codex local catalog");
        let valid = ExecutionTargetInput {
            engine: EngineType::Codex,
            provider_profile_id: None,
            model_catalog_entry_id: Some(selected.id.clone()),
            model: Some(selected.model.clone()),
            reasoning_effort: None,
            provider_profile_name_snapshot: Some("本地配置".to_string()),
            provider_profile_source: Some(CanonicalProviderProfileSource::Local),
            runtime_capability_fingerprint: None,
        };
        assert_eq!(
            validate_resolved_execution_target(&valid).expect("valid resolved local Codex pair"),
            EngineType::Codex
        );

        let poisoned = ExecutionTargetInput {
            model: Some("kimi-for-coding".to_string()),
            ..valid
        };
        assert!(validate_resolved_execution_target(&poisoned)
            .expect_err("mismatched runtime model must fail before the turn is persisted")
            .contains(&format!("requires runtime model '{}'", selected.model)));
    }

    #[test]
    fn execution_target_validation_accepts_new_shared_cli_local_catalogs() {
        for engine in [EngineType::Kimi, EngineType::Grok, EngineType::OpenCode] {
            let catalog = crate::engine::status::get_local_engine_models_for_validation(engine)
                .unwrap_or_else(|| panic!("missing local catalog for {engine:?}"));
            let selected = catalog
                .first()
                .unwrap_or_else(|| panic!("empty local catalog for {engine:?}"));
            let target = ExecutionTargetInput {
                engine,
                provider_profile_id: None,
                model_catalog_entry_id: Some(selected.id.clone()),
                model: Some(selected.model.clone()),
                reasoning_effort: None,
                provider_profile_name_snapshot: Some("本地配置".to_string()),
                provider_profile_source: Some(CanonicalProviderProfileSource::Local),
                runtime_capability_fingerprint: None,
            };

            assert_eq!(
                validate_resolved_execution_target(&target)
                    .unwrap_or_else(|error| panic!("{engine:?} local target rejected: {error}")),
                engine
            );
        }
    }

    #[test]
    fn resolved_execution_target_rejects_legacy_partial_identity() {
        let partial = ExecutionTargetInput {
            engine: EngineType::Codex,
            provider_profile_id: None,
            model_catalog_entry_id: None,
            model: None,
            reasoning_effort: None,
            provider_profile_name_snapshot: None,
            provider_profile_source: None,
            runtime_capability_fingerprint: None,
        };

        assert!(validate_resolved_execution_target(&partial)
            .expect_err("legacy partial target must fail closed")
            .contains("providerProfileSource"),);
    }

    #[test]
    fn resolved_execution_target_requires_source_to_match_provider_identity() {
        let managed_with_local_source = ExecutionTargetInput {
            engine: EngineType::Codex,
            provider_profile_id: Some("provider-kimi".to_string()),
            model_catalog_entry_id: Some("kimi-entry".to_string()),
            model: Some("kimi-for-coding".to_string()),
            reasoning_effort: None,
            provider_profile_name_snapshot: Some("Kimi".to_string()),
            provider_profile_source: Some(CanonicalProviderProfileSource::Local),
            runtime_capability_fingerprint: None,
        };

        assert!(
            validate_resolved_execution_target(&managed_with_local_source)
                .expect_err("managed provider cannot claim local provenance")
                .contains("must be 'managed'"),
        );
    }

    #[test]
    fn claude_shared_context_always_requires_exact_replay_echo() {
        let target = ExecutionTargetInput {
            engine: EngineType::Claude,
            provider_profile_id: None,
            model_catalog_entry_id: Some("claude-sonnet-4-5".to_string()),
            model: Some("claude-sonnet-4-5".to_string()),
            reasoning_effort: None,
            provider_profile_name_snapshot: Some("本地配置".to_string()),
            provider_profile_source: Some(CanonicalProviderProfileSource::Local),
            runtime_capability_fingerprint: None,
        };

        assert!(context_capabilities(&target).strong_context_ack);
    }

    #[test]
    fn newly_supported_shared_engines_use_weak_user_channel_context() {
        for engine in [EngineType::Kimi, EngineType::Grok, EngineType::OpenCode] {
            let target = ExecutionTargetInput {
                engine,
                provider_profile_id: None,
                model_catalog_entry_id: Some("runtime-model".to_string()),
                model: Some("runtime-model".to_string()),
                reasoning_effort: None,
                provider_profile_name_snapshot: Some("本地配置".to_string()),
                provider_profile_source: Some(CanonicalProviderProfileSource::Local),
                runtime_capability_fingerprint: None,
            };
            let capabilities = context_capabilities(&target);
            assert!(capabilities.user_channel_transcript, "{engine:?}");
            assert!(!capabilities.structured_history_import, "{engine:?}");
            assert!(!capabilities.strong_context_ack, "{engine:?}");
        }
    }

    #[test]
    fn newly_supported_shared_engines_use_provider_scoped_runtime_keys() {
        for (engine, local_suffix, managed_suffix) in [
            (
                EngineType::Kimi,
                crate::engine::kimi_provider_profile::KIMI_LOCAL_PROVIDER_PROFILE_ID,
                "provider-kimi",
            ),
            (
                EngineType::Grok,
                crate::engine::grok_provider_profile::GROK_LOCAL_PROVIDER_PROFILE_ID,
                "provider-grok",
            ),
            (
                EngineType::OpenCode,
                crate::engine::opencode_provider_profile::OPENCODE_LOCAL_PROVIDER_PROFILE_ID,
                "provider-opencode",
            ),
        ] {
            assert_eq!(
                provider_runtime_key_for_target("workspace-1", engine, None)
                    .expect("local runtime key"),
                format!("{}::workspace-1::{local_suffix}", engine.icon()),
            );
            assert_eq!(
                provider_runtime_key_for_target("workspace-1", engine, Some(managed_suffix))
                    .expect("managed runtime key"),
                format!("{}::workspace-1::{managed_suffix}", engine.icon()),
            );
        }
    }

    #[test]
    fn collaboration_mode_uses_attempt_model_and_clears_stale_reasoning() {
        let target = ExecutionTargetInput {
            engine: EngineType::Codex,
            provider_profile_id: Some("minimax".to_string()),
            model_catalog_entry_id: Some("minimax-m3".to_string()),
            model: Some("MiniMax-M3".to_string()),
            reasoning_effort: None,
            provider_profile_name_snapshot: Some("MiniMax".to_string()),
            provider_profile_source: Some(CanonicalProviderProfileSource::Managed),
            runtime_capability_fingerprint: None,
        };
        let rewritten = collaboration_mode_for_attempt(
            Some(json!({
                "mode": "default",
                "settings": {
                    "model": "gpt-5.6-sol",
                    "reasoning_effort": "high",
                    "developer_instructions": "keep-me"
                }
            })),
            &target,
        )
        .expect("collaboration mode");

        assert_eq!(
            rewritten.pointer("/settings/model").and_then(Value::as_str),
            Some("MiniMax-M3")
        );
        assert!(rewritten.pointer("/settings/reasoning_effort").is_none());
        assert_eq!(
            rewritten
                .pointer("/settings/developer_instructions")
                .and_then(Value::as_str),
            Some("keep-me")
        );
    }
}

/// commit_turn 的 outcome 输入。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitOutcomeInput {
    pub status: String,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub stop_reason: Option<String>,
}

fn parse_outcome_status(raw: &str) -> Result<OutcomeStatus, String> {
    match raw {
        "completed" => Ok(OutcomeStatus::Completed),
        "failed" => Ok(OutcomeStatus::Failed),
        "cancelled" => Ok(OutcomeStatus::Cancelled),
        "replaced" => Ok(OutcomeStatus::Replaced),
        other => Err(format!("Unknown outcome status: {other}")),
    }
}

// ---------------------------------------------------------------------------
// Durable provisioning（B.4）
// ---------------------------------------------------------------------------

const PROVISIONING_PREPARED: &str = "prepared";
const PROVISIONING_CREATING: &str = "creating";
const PROVISIONING_READY: &str = "ready";
const PROVISIONING_RECOVERY_REQUIRED: &str = "recovery-required";

/// Native context trust for Shared Binding（fix-shared-context-resume-integrity）。
/// `dirty`：不得依赖 native 已持有历史，zero-transfer 时须 rematerialize。
/// `trusted`：允许 destination-owned / accepted cursor 省略交接。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NativeContextTrust {
    Trusted,
    Dirty,
}

impl NativeContextTrust {
    fn as_str(self) -> &'static str {
        match self {
            Self::Trusted => "trusted",
            Self::Dirty => "dirty",
        }
    }

    fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "trusted" => Some(Self::Trusted),
            "dirty" => Some(Self::Dirty),
            _ => None,
        }
    }
}

/// Compatibility：缺字段时 **fail-closed 为 dirty**。
/// 升级后首次发送会 rematerialize 一次，accept/completed 再写回 trusted。
/// （旧逻辑 ready+native→trusted 会让已坏会话静默继续丢上下文。）
fn read_native_context_trust(row: &StoredBindingState) -> NativeContextTrust {
    if let Some(trust) = row
        .provisioning_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .and_then(|value| {
            value
                .get("nativeContextTrust")
                .and_then(Value::as_str)
                .and_then(NativeContextTrust::parse)
        })
    {
        return trust;
    }
    NativeContextTrust::Dirty
}

fn provisioning_json(
    state: &str,
    reason: Option<&str>,
    attempt_id: Option<&str>,
    binding_operation_id: Option<&str>,
    existing: Option<&StoredBindingState>,
    trust_override: Option<NativeContextTrust>,
) -> String {
    let updated_at = now_millis();
    let trust = trust_override.unwrap_or_else(|| {
        existing
            .map(read_native_context_trust)
            .unwrap_or(NativeContextTrust::Dirty)
    });
    json!({
        "state": state,
        "updatedAt": updated_at,
        "startedAt": (state == PROVISIONING_CREATING).then_some(updated_at),
        "reason": reason,
        "attemptId": attempt_id,
        "operationId": binding_operation_id,
        "nativeContextTrust": trust.as_str(),
    })
    .to_string()
}

/// RMW：只改 trust，保留其余 provisioning / cursor / native。
fn set_native_context_trust(
    writer: &SharedEventWriter,
    session_id: &str,
    binding_key: &str,
    trust: NativeContextTrust,
) -> Result<(), String> {
    let existing = writer
        .binding_state(session_id, binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {binding_key} is missing"))?;
    if read_native_context_trust(&existing) == trust {
        return Ok(());
    }
    let engine = serde_json::from_value::<EngineType>(Value::String(existing.engine.clone()))
        .map_err(|_| {
            format!(
                "binding {binding_key} has unsupported engine '{}'",
                existing.engine
            )
        })
        .and_then(ensure_supported_shared_session_engine)?;
    let state = provisioning_state_of(&existing);
    upsert_binding_row(
        writer,
        session_id,
        binding_key,
        engine,
        existing.provider_profile_id.clone(),
        Some(&existing),
        None,
        None,
        provisioning_json(
            &state,
            None,
            None,
            binding_operation_id_of(&existing).as_deref(),
            Some(&existing),
            Some(trust),
        ),
        &existing.availability,
    )
    .map_err(|error| error.to_string())
}

/// 从 durable 行解析 provisioning state；缺省视为 prepared（未开始）。
fn provisioning_state_of(row: &StoredBindingState) -> String {
    row.provisioning_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .and_then(|value| {
            value
                .get("state")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| PROVISIONING_PREPARED.to_string())
}

fn binding_operation_id_of(row: &StoredBindingState) -> Option<String> {
    row.provisioning_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .and_then(|value| {
            value
                .get("operationId")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|operation_id| !operation_id.is_empty())
                .map(str::to_string)
        })
}

fn requested_binding_operation_id(requested: &TurnRequestedFact) -> Option<String> {
    requested
        .extra
        .get("bindingOperationId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|operation_id| !operation_id.is_empty())
        .map(str::to_string)
}

/// 全行 read-modify-write upsert（upsert SQL 是整行覆盖，必须保留 cursor 等未变字段）。
#[allow(clippy::too_many_arguments)]
fn binding_row_update(
    session_id: &str,
    binding_key: &str,
    engine: EngineType,
    provider_profile_id: Option<String>,
    existing: Option<&StoredBindingState>,
    native_session_id: Option<String>,
    committed_through_sequence: Option<i64>,
    provisioning: String,
    availability: &str,
) -> BindingStateUpdate {
    BindingStateUpdate {
        session_id: session_id.to_string(),
        binding_key: binding_key.to_string(),
        engine: engine.icon().to_string(),
        provider_profile_id,
        native_session_id: native_session_id
            .or_else(|| existing.and_then(|row| row.native_session_id.clone())),
        accepted_through_sequence: existing.and_then(|row| row.accepted_through_sequence),
        committed_through_sequence: committed_through_sequence
            .or_else(|| existing.and_then(|row| row.committed_through_sequence)),
        provisioning_json: Some(provisioning),
        pending_delivery_json: existing.and_then(|row| row.pending_delivery_json.clone()),
        availability: availability.to_string(),
        updated_at: now_millis() as i64,
    }
}

#[allow(clippy::too_many_arguments)]
fn upsert_binding_row(
    writer: &SharedEventWriter,
    session_id: &str,
    binding_key: &str,
    engine: EngineType,
    provider_profile_id: Option<String>,
    existing: Option<&StoredBindingState>,
    native_session_id: Option<String>,
    committed_through_sequence: Option<i64>,
    provisioning: String,
    availability: &str,
) -> Result<(), StoreError> {
    writer.upsert_binding_state(&binding_row_update(
        session_id,
        binding_key,
        engine,
        provider_profile_id,
        existing,
        native_session_id,
        committed_through_sequence,
        provisioning,
        availability,
    ))
}

fn append_control_fact(
    writer: &SharedEventWriter,
    session_id: &str,
    control_kind: &str,
    binding_key: Option<&str>,
    reason: Option<&str>,
) -> Result<(), String> {
    let fact = CanonicalFact::Control(ControlFact {
        control_kind: control_kind.to_string(),
        logical_turn_id: None,
        attempt_id: None,
        binding_key: binding_key.map(str::to_string),
        reason: reason.map(str::to_string),
        details: None,
        extra: Value::Object(Default::default()),
    });
    writer
        .append_canonical_fact_at(session_id.to_string(), fact, now_millis() as i64)
        .map_err(|error| error.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// B.3 core：Tx1 begin_turn
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BeginTurnStatus {
    Creating,
    RecoveryRequired,
    TargetUnavailable,
}

fn validate_execution_target(target: &ExecutionTargetInput) -> Result<EngineType, String> {
    let engine = ensure_supported_shared_session_engine(target.engine)?;
    let provider_profile_id = target.normalized_provider();
    let models = match provider_profile_id.as_deref() {
        Some(provider_profile_id) => crate::engine::status::get_provider_scoped_engine_models(
            engine,
            Some(provider_profile_id),
        )?,
        None => crate::engine::status::get_local_engine_models_for_validation(engine),
    };
    let models = models.ok_or_else(|| {
        format!(
            "invalid-target-model: model catalog is unavailable for {} provider {}",
            engine.icon(),
            provider_profile_id.as_deref().unwrap_or("default")
        )
    })?;
    // 与 selection 持久化一致：不因 catalog 未登记而拒绝用户自定义模型名。
    crate::engine::status::validate_model_catalog_pair(
        target.model_catalog_entry_id.as_deref(),
        target.model.as_deref(),
        &models,
        crate::engine::status::UnlistedRuntimeModelPolicy::Allow,
    )?;
    Ok(engine)
}

pub(crate) fn validate_resolved_execution_target(
    target: &ExecutionTargetInput,
) -> Result<EngineType, String> {
    let provider_profile_id = target.normalized_provider();
    let expected_source = if provider_profile_id.is_some() {
        CanonicalProviderProfileSource::Managed
    } else {
        CanonicalProviderProfileSource::Local
    };
    if target.provider_profile_source != Some(expected_source) {
        return Err(format!(
            "invalid-target: providerProfileSource must be '{}'",
            match expected_source {
                CanonicalProviderProfileSource::Local => "local",
                CanonicalProviderProfileSource::Managed => "managed",
            }
        ));
    }
    if target
        .provider_profile_name_snapshot
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
    {
        return Err("invalid-target: providerProfileNameSnapshot is required".to_string());
    }
    if target
        .model_catalog_entry_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_none()
        || target
            .model
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
    {
        return Err(
            "invalid-target: modelCatalogEntryId and runtime model are required".to_string(),
        );
    }
    validate_execution_target(target)
}

#[derive(Debug)]
pub struct BeginTurnOutcome {
    pub status: BeginTurnStatus,
    pub reason: Option<String>,
    pub attempt_id: Option<String>,
    pub logical_turn_id: Option<String>,
    pub binding_key: String,
    pub snapshot: Option<TurnExecutionSnapshot>,
}

fn unresolved_session_operation(
    writer: &SharedEventWriter,
    session_id: &str,
) -> Result<Option<(String, String)>, String> {
    let events = writer
        .events_for_session(session_id)
        .map_err(|error| error.to_string())?;
    let committed_attempts = events
        .iter()
        .filter(|event| event.fact_type == "conversation.turnCommitted")
        .filter_map(|event| event.attempt_id.clone())
        .collect::<std::collections::HashSet<_>>();
    for event in &events {
        let Some(attempt_id) = event.attempt_id.as_deref() else {
            continue;
        };
        if event.fact_type != "conversation.turnRequested"
            || committed_attempts.contains(attempt_id)
        {
            continue;
        }
        let fact = serde_json::from_str::<CanonicalFact>(&event.payload_json)
            .map_err(|error| format!("parse unresolved turnRequested: {error}"))?;
        let CanonicalFact::TurnRequested(requested) = fact else {
            return Err("invalid unresolved turnRequested payload".to_string());
        };
        if requested
            .extra
            .get("squadWorkerBindingKey")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
        {
            continue;
        }
        let target = target_input_from_snapshot(&requested.target)?;
        let engine = ensure_supported_shared_session_engine(target.engine)?;
        let binding_key =
            shared_target_binding_key(engine, target.normalized_provider().as_deref());
        return Ok(Some((binding_key, attempt_id.to_string())));
    }
    Ok(None)
}

fn recover_creating_binding(
    writer: &SharedEventWriter,
    session_id: &str,
    row: &StoredBindingState,
) -> Result<(), String> {
    let engine = serde_json::from_value::<EngineType>(Value::String(row.engine.clone()))
        .map_err(|_| {
            format!(
                "binding {} has unsupported engine '{}'",
                row.binding_key, row.engine
            )
        })
        .and_then(ensure_supported_shared_session_engine)?;
    let durable_binding_key = shared_target_binding_key(engine, row.provider_profile_id.as_deref());
    if durable_binding_key != row.binding_key {
        return Err(format!(
            "binding owner mismatch: key '{}' does not match durable owner '{durable_binding_key}'",
            row.binding_key
        ));
    }
    mark_recovery_core(
        writer,
        session_id,
        &row.binding_key,
        engine,
        row.provider_profile_id.clone(),
        Some("provisioning-crash-window"),
    )
}

/// Dispatch 附图：调用方显式路径优先；否则从 durable TurnRequested.image_refs.locator 回填。
/// 协作编排只在 begin 写入 image_refs，drive 侧不重传图，必须走此 SSOT。
fn resolve_dispatch_images(
    images: Option<Vec<String>>,
    input: &crate::shared_event_log::canonical::types::CanonicalUserInput,
) -> Option<Vec<String>> {
    let from_param: Vec<String> = images
        .unwrap_or_default()
        .into_iter()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .collect();
    if !from_param.is_empty() {
        return Some(from_param);
    }
    let from_refs: Vec<String> = input
        .image_refs
        .as_ref()
        .into_iter()
        .flatten()
        .map(|artifact| artifact.locator.trim().to_string())
        .filter(|path| !path.is_empty())
        .collect();
    if from_refs.is_empty() {
        None
    } else {
        Some(from_refs)
    }
}

#[cfg(test)]
mod resolve_dispatch_images_tests {
    use super::resolve_dispatch_images;
    use crate::shared_event_log::canonical::types::{ArtifactRef, CanonicalUserInput};
    use serde_json::Value;

    fn artifact(locator: &str) -> ArtifactRef {
        ArtifactRef {
            artifact_id: "img-1".into(),
            media_type: "image/png".into(),
            size_bytes: Some(12),
            sha256: "a".repeat(64),
            locator: locator.into(),
            redaction: None,
            extra: Value::Object(Default::default()),
        }
    }

    #[test]
    fn prefers_explicit_param_over_image_refs() {
        let input = CanonicalUserInput {
            text: Some("hi".into()),
            image_refs: Some(vec![artifact("/from/ref.png")]),
            attachment_refs: None,
            extra: Value::Object(Default::default()),
        };
        let resolved = resolve_dispatch_images(Some(vec!["/from/param.png".into()]), &input);
        assert_eq!(resolved, Some(vec!["/from/param.png".into()]));
    }

    #[test]
    fn falls_back_to_durable_image_refs_when_param_empty() {
        let input = CanonicalUserInput {
            text: Some("这是什么".into()),
            image_refs: Some(vec![artifact("/Users/me/shot.png")]),
            attachment_refs: None,
            extra: Value::Object(Default::default()),
        };
        let resolved = resolve_dispatch_images(None, &input);
        assert_eq!(resolved, Some(vec!["/Users/me/shot.png".into()]));
        let resolved_empty = resolve_dispatch_images(Some(vec![]), &input);
        assert_eq!(resolved_empty, Some(vec!["/Users/me/shot.png".into()]));
    }

    #[test]
    fn returns_none_when_no_images_anywhere() {
        let input = CanonicalUserInput {
            text: Some("no images".into()),
            image_refs: None,
            attachment_refs: None,
            extra: Value::Object(Default::default()),
        };
        assert_eq!(resolve_dispatch_images(None, &input), None);
    }
}

/// 用户本地附图路径 → 合法 ArtifactRef（UI projection 用 locator）。
/// sha256 优先文件内容；不可读时用 path bytes，满足 validator 64 hex。
fn user_image_paths_to_artifact_refs(paths: Option<Vec<String>>) -> Option<Vec<ArtifactRef>> {
    let paths = paths?;
    let mut refs = Vec::new();
    for path in paths {
        let locator = path.trim().to_string();
        if locator.is_empty() {
            continue;
        }
        let (sha_hex, size_bytes) = match std::fs::read(&locator) {
            Ok(bytes) => {
                let size = bytes.len() as i64;
                (format!("{:x}", Sha256::digest(&bytes)), Some(size))
            }
            Err(_) => (format!("{:x}", Sha256::digest(locator.as_bytes())), None),
        };
        let media_type = guess_user_image_media_type(&locator);
        let artifact_id = format!(
            "user-image-{}",
            sha_hex.get(..16).unwrap_or(sha_hex.as_str())
        );
        refs.push(ArtifactRef {
            artifact_id,
            media_type,
            size_bytes,
            sha256: sha_hex,
            locator,
            redaction: None,
            extra: Value::Object(Default::default()),
        });
    }
    if refs.is_empty() {
        None
    } else {
        Some(refs)
    }
}

fn guess_user_image_media_type(path: &str) -> String {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png".to_string()
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg".to_string()
    } else if lower.ends_with(".gif") {
        "image/gif".to_string()
    } else if lower.ends_with(".webp") {
        "image/webp".to_string()
    } else if lower.ends_with(".bmp") {
        "image/bmp".to_string()
    } else if lower.ends_with(".svg") {
        "image/svg+xml".to_string()
    } else {
        "image/*".to_string()
    }
}

pub fn begin_turn_core(
    writer: &SharedEventWriter,
    session_id: &str,
    target: &ExecutionTargetInput,
    text: String,
    images: Option<Vec<String>>,
) -> Result<BeginTurnOutcome, String> {
    let engine = match ensure_supported_shared_session_engine(target.engine) {
        Ok(engine) => engine,
        Err(reason) => {
            return Ok(BeginTurnOutcome {
                status: BeginTurnStatus::TargetUnavailable,
                reason: Some(reason),
                attempt_id: None,
                logical_turn_id: None,
                binding_key: String::new(),
                snapshot: None,
            });
        }
    };
    let provider_profile_id = target.normalized_provider();
    let binding_key = shared_target_binding_key(engine, provider_profile_id.as_deref());
    if let Some((pending_binding_key, pending_attempt_id)) =
        unresolved_session_operation(writer, session_id)?
    {
        let pending_binding = writer
            .binding_state(session_id, &pending_binding_key)
            .map_err(|error| error.to_string())?;
        if let Some(row) = pending_binding.as_ref() {
            match provisioning_state_of(row).as_str() {
                PROVISIONING_CREATING => {
                    recover_creating_binding(writer, session_id, row)?;
                    return Ok(BeginTurnOutcome {
                        status: BeginTurnStatus::RecoveryRequired,
                        reason: Some("provisioning-crash-window".to_string()),
                        attempt_id: None,
                        logical_turn_id: None,
                        binding_key: pending_binding_key,
                        snapshot: None,
                    });
                }
                PROVISIONING_RECOVERY_REQUIRED => {
                    return Ok(BeginTurnOutcome {
                        status: BeginTurnStatus::RecoveryRequired,
                        reason: None,
                        attempt_id: None,
                        logical_turn_id: None,
                        binding_key: pending_binding_key,
                        snapshot: None,
                    });
                }
                _ => {}
            }
        }
        return Ok(BeginTurnOutcome {
            status: BeginTurnStatus::RecoveryRequired,
            reason: Some(format!(
                "session has unresolved context delivery for attempt {pending_attempt_id}"
            )),
            attempt_id: None,
            logical_turn_id: None,
            binding_key: pending_binding_key,
            snapshot: None,
        });
    }

    let existing = writer
        .binding_state(session_id, &binding_key)
        .map_err(|error| error.to_string())?;
    if let Some(row) = existing.as_ref() {
        match provisioning_state_of(row).as_str() {
            PROVISIONING_RECOVERY_REQUIRED => {
                return Ok(BeginTurnOutcome {
                    status: BeginTurnStatus::RecoveryRequired,
                    reason: None,
                    attempt_id: None,
                    logical_turn_id: None,
                    binding_key,
                    snapshot: None,
                });
            }
            // 上次 attempt 崩溃在 creating 窗口：fail closed，禁止盲目重建（D6）。
            PROVISIONING_CREATING => {
                recover_creating_binding(writer, session_id, row)?;
                return Ok(BeginTurnOutcome {
                    status: BeginTurnStatus::RecoveryRequired,
                    reason: Some("provisioning-crash-window".to_string()),
                    attempt_id: None,
                    logical_turn_id: None,
                    binding_key,
                    snapshot: None,
                });
            }
            _ => {}
        }
    }

    let snapshot = target.to_snapshot();
    let attempt_id = Uuid::new_v4().to_string();
    let logical_turn_id = Uuid::new_v4().to_string();
    let binding_operation_id = existing
        .as_ref()
        .and_then(binding_operation_id_of)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let binding_has_native_identity = existing
        .as_ref()
        .and_then(|row| row.native_session_id.as_deref())
        .is_some_and(|native_session_id| !native_session_id.trim().is_empty());
    let initial_provisioning_state = if binding_has_native_identity {
        PROVISIONING_READY
    } else {
        PROVISIONING_PREPARED
    };
    let initial_availability = if binding_has_native_identity {
        "ready"
    } else {
        "provisioning"
    };

    // Tx1：User Intent 与 provisioning owner 同一 transaction 落盘，先于任何
    // Runtime side effect。禁止 prepared / turnRequested / creating 三次独立写入，
    // 否则任一中间 crash 都会留下无法按 Attempt 恢复的半状态。
    let requested_at = now_millis() as i64;
    let fact = CanonicalFact::TurnRequested(TurnRequestedFact {
        logical_turn_id: logical_turn_id.clone(),
        attempt_id: attempt_id.clone(),
        retry_of_attempt_id: None,
        input: CanonicalUserInput {
            text: Some(text),
            // Shared 共有路径：用户附图必须 durable，否则 projection 无图 → 双气泡/丢图
            image_refs: user_image_paths_to_artifact_refs(images),
            attachment_refs: None,
            extra: Value::Object(Default::default()),
        },
        target: snapshot.clone(),
        requested_at,
        extra: json!({
            "bindingOperationId": binding_operation_id,
        }),
    });
    let binding = binding_row_update(
        session_id,
        &binding_key,
        engine,
        provider_profile_id,
        existing.as_ref(),
        None,
        None,
        provisioning_json(
            initial_provisioning_state,
            None,
            Some(&attempt_id),
            Some(&binding_operation_id),
            existing.as_ref(),
            // 新 attempt：有 ready native 则沿用 trust；无 native 默认 dirty。
            None,
        ),
        initial_availability,
    );
    writer
        .append_turn_requested_with_binding_at(session_id.to_string(), fact, requested_at, &binding)
        .map_err(|error| error.to_string())?;

    Ok(BeginTurnOutcome {
        status: BeginTurnStatus::Creating,
        reason: None,
        attempt_id: Some(attempt_id),
        logical_turn_id: Some(logical_turn_id),
        binding_key,
        snapshot: Some(snapshot),
    })
}

/// Squad Worker 专用 Tx1。它复用 Shared V2 lifecycle，但使用 run/node scoped Binding，
/// 因此不参与主对话的 linear unresolved-attempt guard。
#[allow(clippy::too_many_arguments)]
pub(crate) fn begin_squad_worker_turn_core(
    writer: &SharedEventWriter,
    session_id: &str,
    target: &ExecutionTargetInput,
    text: String,
    // 仅首段协作节点可带图；后续段传 None
    images: Option<Vec<String>>,
    run_id: &str,
    node_id: &str,
    worker_role: &str,
    permission_class: &str,
    expose_final: bool,
    context_identity: Value,
    attempt_id: String,
    logical_turn_id: String,
) -> Result<BeginTurnOutcome, String> {
    let engine = validate_resolved_execution_target(target)?;
    let provider_profile_id = target.normalized_provider();
    let base_binding_key = shared_target_binding_key(engine, provider_profile_id.as_deref());
    let binding_key = format!("squad:{run_id}:{node_id}:{base_binding_key}");
    let existing = writer
        .binding_state(session_id, &binding_key)
        .map_err(|error| error.to_string())?;
    if let Some(row) = existing.as_ref() {
        match provisioning_state_of(row).as_str() {
            PROVISIONING_RECOVERY_REQUIRED => {
                return Ok(BeginTurnOutcome {
                    status: BeginTurnStatus::RecoveryRequired,
                    reason: Some("squad-worker-binding-recovery-required".to_string()),
                    attempt_id: None,
                    logical_turn_id: None,
                    binding_key,
                    snapshot: None,
                });
            }
            PROVISIONING_CREATING => {
                mark_recovery_core(
                    writer,
                    session_id,
                    &binding_key,
                    engine,
                    provider_profile_id,
                    Some("squad-worker-provisioning-crash-window"),
                )?;
                return Ok(BeginTurnOutcome {
                    status: BeginTurnStatus::RecoveryRequired,
                    reason: Some("squad-worker-provisioning-crash-window".to_string()),
                    attempt_id: None,
                    logical_turn_id: None,
                    binding_key,
                    snapshot: None,
                });
            }
            _ => {}
        }
    }

    let snapshot = target.to_snapshot();
    let binding_operation_id = existing
        .as_ref()
        .and_then(binding_operation_id_of)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let binding_has_native_identity = existing
        .as_ref()
        .and_then(|row| row.native_session_id.as_deref())
        .is_some_and(|native_session_id| !native_session_id.trim().is_empty());
    let initial_provisioning_state = if binding_has_native_identity {
        PROVISIONING_READY
    } else {
        PROVISIONING_PREPARED
    };
    let initial_availability = if binding_has_native_identity {
        "ready"
    } else {
        "provisioning"
    };
    let requested_at = now_millis() as i64;
    let fact = CanonicalFact::TurnRequested(TurnRequestedFact {
        logical_turn_id: logical_turn_id.clone(),
        attempt_id: attempt_id.clone(),
        retry_of_attempt_id: None,
        input: CanonicalUserInput {
            text: Some(text),
            image_refs: user_image_paths_to_artifact_refs(images),
            attachment_refs: None,
            extra: Value::Object(Default::default()),
        },
        target: snapshot.clone(),
        requested_at,
        extra: json!({
            "bindingOperationId": binding_operation_id,
            "squadWorkerBindingKey": binding_key,
            "squadRunId": run_id,
            "squadNodeId": node_id,
            "squadWorkerRole": worker_role,
            "squadPermissionClass": permission_class,
            "squadExposeFinal": expose_final,
            "squadContextIdentity": context_identity,
        }),
    });
    let binding = binding_row_update(
        session_id,
        &binding_key,
        engine,
        provider_profile_id,
        existing.as_ref(),
        None,
        None,
        provisioning_json(
            initial_provisioning_state,
            None,
            Some(&attempt_id),
            Some(&binding_operation_id),
            existing.as_ref(),
            None,
        ),
        initial_availability,
    );
    writer
        .append_canonical_fact_with_binding_at(session_id.to_string(), fact, requested_at, &binding)
        .map_err(|error| error.to_string())?;

    Ok(BeginTurnOutcome {
        status: BeginTurnStatus::Creating,
        reason: None,
        attempt_id: Some(attempt_id),
        logical_turn_id: Some(logical_turn_id),
        binding_key,
        snapshot: Some(snapshot),
    })
}

// ---------------------------------------------------------------------------
// B.3 core：typed prompt ACK → turnAccepted
// ---------------------------------------------------------------------------

pub(crate) fn requested_fact_for_attempt(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
) -> Result<TurnRequestedFact, String> {
    let fact = writer
        .events_for_session(session_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|event| {
            event.fact_type == "conversation.turnRequested"
                && event.attempt_id.as_deref() == Some(attempt_id)
        })
        .ok_or_else(|| format!("no matching turnRequested for attempt {attempt_id}"))
        .and_then(|event| {
            serde_json::from_str::<CanonicalFact>(&event.payload_json)
                .map_err(|error| format!("parse turnRequested payload: {error}"))
        })?;
    match fact {
        CanonicalFact::TurnRequested(requested) => Ok(requested),
        _ => Err(format!(
            "invalid turnRequested payload for attempt {attempt_id}"
        )),
    }
}

#[derive(Debug, Clone)]
struct DurableAttemptOwner {
    requested: TurnRequestedFact,
    target: ExecutionTargetInput,
    engine: EngineType,
    provider_profile_id: Option<String>,
    binding_key: String,
    binding_operation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SharedAttemptInterruptRoute {
    attempt_id: String,
    engine: EngineType,
    provider_profile_id: Option<String>,
    binding_key: String,
    native_thread_id: String,
    runtime_turn_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SharedCompactionRoute {
    pub(crate) engine: EngineType,
    pub(crate) provider_profile_id: Option<String>,
    pub(crate) native_thread_id: String,
    pub(crate) has_unresolved_attempt: bool,
}

pub(crate) fn resolve_shared_compaction_route(
    state: &AppState,
    workspace_id: &str,
    thread_id: &str,
) -> Result<SharedCompactionRoute, String> {
    let writer = require_writer(state)?;
    let shared_session_id = parse_shared_session_id(thread_id)?;
    require_shared_session_workspace_owner(workspace_id, &shared_session_id)?;
    resolve_shared_compaction_route_core(writer, &shared_session_id, || {
        resolve_durable_shared_compaction_target(writer, &shared_session_id)
    })
}

fn resolve_durable_shared_compaction_target(
    writer: &SharedEventWriter,
    shared_session_id: &str,
) -> Result<(EngineType, Option<String>), String> {
    let stored_target = writer
        .session_target(shared_session_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            format!(
                "shared-compaction-target-unavailable: session {shared_session_id} has no durable V2 Target"
            )
        })?;
    let target: SharedSelectedTarget =
        serde_json::from_str(&stored_target.selected_target_json).map_err(|error| {
            format!(
                "shared-compaction-target-invalid: session {shared_session_id} durable Target is invalid: {error}"
            )
        })?;
    let engine = ensure_supported_shared_session_engine(target.engine)
        .map_err(|error| format!("shared-compaction-target-unavailable: {error}"))?;
    let provider_profile_id = target
        .provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    Ok((engine, provider_profile_id))
}

fn resolve_shared_compaction_route_core<F>(
    writer: &SharedEventWriter,
    shared_session_id: &str,
    resolve_selected_target: F,
) -> Result<SharedCompactionRoute, String>
where
    F: FnOnce() -> Result<(EngineType, Option<String>), String>,
{
    let unresolved = unresolved_attempt_evidence(writer, &shared_session_id, None)?;
    if unresolved.len() > 1 {
        return Err(format!(
            "shared-compaction-owner-ambiguous: session {shared_session_id} has {} unresolved attempts",
            unresolved.len()
        ));
    }

    let (engine, provider_profile_id, binding_key, binding_operation_id) =
        if let Some(evidence) = unresolved.first() {
            (
                evidence.owner.engine,
                evidence.owner.provider_profile_id.clone(),
                evidence.owner.binding_key.clone(),
                Some(evidence.owner.binding_operation_id.as_str()),
            )
        } else {
            let (engine, provider_profile_id) = resolve_selected_target()?;
            (
                engine,
                provider_profile_id.clone(),
                shared_target_binding_key(engine, provider_profile_id.as_deref()),
                None,
            )
        };

    if !matches!(engine, EngineType::Codex | EngineType::Claude) {
        return Err(format!(
            "shared-compaction-unsupported: {} does not support context compaction",
            engine.icon()
        ));
    }

    let binding = writer
        .binding_state(&shared_session_id, &binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            format!("shared-compaction-binding-unavailable: binding {binding_key} is missing")
        })?;
    if binding.engine != engine.icon()
        || binding.provider_profile_id.as_deref() != provider_profile_id.as_deref()
    {
        return Err(format!(
            "shared-compaction-owner-mismatch: binding {binding_key} does not match durable Target"
        ));
    }
    if let Some(expected_operation_id) = binding_operation_id {
        let actual_operation_id = binding_operation_id_of(&binding).unwrap_or_default();
        if actual_operation_id != expected_operation_id {
            return Err(format!(
                "shared-compaction-owner-mismatch: binding generation changed for {binding_key}"
            ));
        }
    }
    if binding.availability != "ready" {
        return Err(format!(
            "shared-compaction-binding-unavailable: binding {binding_key} is {}",
            binding.availability
        ));
    }
    let provisioning_state = provisioning_state_of(&binding);
    if provisioning_state != PROVISIONING_READY {
        return Err(format!(
            "shared-compaction-binding-unavailable: binding {binding_key} provisioning state is {provisioning_state}"
        ));
    }
    let native_thread_id = binding
        .native_session_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!(
                "shared-compaction-binding-unavailable: binding {binding_key} has no native session"
            )
        })?;

    Ok(SharedCompactionRoute {
        engine,
        provider_profile_id,
        native_thread_id,
        has_unresolved_attempt: !unresolved.is_empty(),
    })
}

fn resolve_shared_attempt_interrupt_route(
    writer: &SharedEventWriter,
    coordinator: &crate::shared_runtime_coordinator::SharedRuntimeCoordinator,
    workspace_id: &str,
    thread_id: &str,
    attempt_id: &str,
) -> Result<SharedAttemptInterruptRoute, String> {
    let shared_session_id = parse_shared_session_id(thread_id)?;
    let durable_owner = durable_attempt_owner(writer, &shared_session_id, attempt_id)?;
    let runtime_owner = coordinator.owner_for_attempt(attempt_id).ok_or_else(|| {
        format!("shared-control-owner-unavailable: runtime owner missing for attempt {attempt_id}")
    })?;
    let expected_provider_runtime_key = provider_runtime_key_for_target(
        workspace_id,
        durable_owner.engine,
        durable_owner.provider_profile_id.as_deref(),
    )?;
    if runtime_owner.workspace_id != workspace_id
        || runtime_owner.provider_runtime_key != expected_provider_runtime_key
        || runtime_owner.shared_thread_id != thread_id
        || runtime_owner.shared_session_id != shared_session_id
        || runtime_owner.attempt_id != attempt_id
        || runtime_owner.logical_turn_id != durable_owner.requested.logical_turn_id
        || runtime_owner.binding_key != durable_owner.binding_key
        || runtime_owner.binding_operation_id != durable_owner.binding_operation_id
        || runtime_owner.engine != durable_owner.engine
        || runtime_owner.execution_target_snapshot != durable_owner.requested.target
    {
        return Err(format!(
            "shared-control-owner-mismatch: durable/runtime owner mismatch for attempt {attempt_id}"
        ));
    }
    let native_thread_id = runtime_owner
        .native_session_id
        .as_deref()
        .map(str::trim)
        .filter(|identity| !identity.is_empty())
        .ok_or_else(|| {
            format!(
                "shared-control-owner-unavailable: native thread identity missing for attempt {attempt_id}"
            )
        })?
        .to_string();
    let runtime_turn_id = runtime_owner
        .runtime_turn_id
        .as_deref()
        .map(str::trim)
        .filter(|identity| !identity.is_empty())
        .ok_or_else(|| {
            format!(
                "shared-control-owner-unavailable: runtime turn identity missing for attempt {attempt_id}"
            )
        })?
        .to_string();
    Ok(SharedAttemptInterruptRoute {
        attempt_id: attempt_id.to_string(),
        engine: durable_owner.engine,
        provider_profile_id: durable_owner.provider_profile_id,
        binding_key: durable_owner.binding_key,
        native_thread_id,
        runtime_turn_id,
    })
}

pub(crate) fn target_input_from_snapshot(
    snapshot: &TurnExecutionSnapshot,
) -> Result<ExecutionTargetInput, String> {
    let engine = serde_json::from_value::<EngineType>(Value::String(snapshot.engine.clone()))
        .map_err(|_| {
            format!(
                "target-unavailable: unsupported engine '{}'",
                snapshot.engine
            )
        })?;
    Ok(ExecutionTargetInput {
        engine,
        provider_profile_id: snapshot.provider_profile_id.clone(),
        model_catalog_entry_id: snapshot.model_catalog_entry_id.clone(),
        model: snapshot.model.clone(),
        reasoning_effort: snapshot
            .reasoning
            .as_ref()
            .map(|reasoning| reasoning.effort.clone()),
        provider_profile_name_snapshot: snapshot.provider_profile_name_snapshot.clone(),
        provider_profile_source: snapshot.provider_profile_source,
        runtime_capability_fingerprint: snapshot.runtime_capability_fingerprint.clone(),
    })
}

fn durable_attempt_owner(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
) -> Result<DurableAttemptOwner, String> {
    let requested = requested_fact_for_attempt(writer, session_id, attempt_id)?;
    let target = target_input_from_snapshot(&requested.target)?;
    let engine = ensure_supported_shared_session_engine(target.engine)
        .map_err(|error| format!("target-unavailable: {error}"))?;
    let provider_profile_id = target.normalized_provider();
    let binding_key = requested
        .extra
        .get("squadWorkerBindingKey")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| shared_target_binding_key(engine, provider_profile_id.as_deref()));
    // Legacy V2 facts 没有 generation。只在 durable row 仍是同一旧 Binding 时
    // 兼容读取；重建后新 row 会持有新的 operationId，后续新 Attempt 都显式冻结。
    let binding_operation_id = requested_binding_operation_id(&requested)
        .or_else(|| {
            writer
                .binding_state(session_id, &binding_key)
                .ok()
                .flatten()
                .as_ref()
                .and_then(binding_operation_id_of)
        })
        .unwrap_or_else(|| format!("legacy:{}", requested.attempt_id));
    Ok(DurableAttemptOwner {
        requested,
        target,
        engine,
        provider_profile_id,
        binding_key,
        binding_operation_id,
    })
}

fn scoped_attempt_access_mode(
    owner: &DurableAttemptOwner,
    requested: Option<String>,
) -> Result<Option<String>, String> {
    let is_squad = owner
        .requested
        .extra
        .get("squadWorkerBindingKey")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    if !is_squad {
        return Ok(requested);
    }
    match owner
        .requested
        .extra
        .get("squadPermissionClass")
        .and_then(Value::as_str)
    {
        Some("read-only") => Ok(Some("read-only".to_string())),
        Some("current-workspace") => Ok(Some("squad-current-workspace".to_string())),
        _ => Err("squad-permission-invalid: durable permission class is missing".to_string()),
    }
}

fn validate_durable_attempt_target(owner: &DurableAttemptOwner) -> Result<(), String> {
    validate_resolved_execution_target(&owner.target)
        .map(|_| ())
        .map_err(|error| format!("target-unavailable: {error}"))
}

fn require_attempt_binding_generation(
    binding: &StoredBindingState,
    owner: &DurableAttemptOwner,
) -> Result<(), String> {
    let current_operation_id = binding_operation_id_of(binding).unwrap_or_else(|| {
        // Legacy rows and their legacy TurnRequested are one generation until an
        // explicit rebuild writes a real operationId.
        format!("legacy:{}", owner.requested.attempt_id)
    });
    if current_operation_id != owner.binding_operation_id {
        return Err(format!(
            "stale-runtime-terminal: binding generation changed for attempt {}",
            owner.requested.attempt_id
        ));
    }
    Ok(())
}

fn pending_delivery_for_owner(
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
) -> Result<(StoredBindingState, PendingDelivery), String> {
    let binding = writer
        .binding_state(session_id, &owner.binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {} is missing", owner.binding_key))?;
    if binding.engine != owner.engine.icon()
        || binding.provider_profile_id != owner.provider_profile_id
    {
        return Err(format!(
            "binding owner mismatch for attempt {}",
            owner.requested.attempt_id
        ));
    }
    require_attempt_binding_generation(&binding, owner)?;
    let pending = binding
        .pending_delivery_json
        .as_deref()
        .ok_or_else(|| {
            format!(
                "pending context delivery missing for attempt {}",
                owner.requested.attempt_id
            )
        })
        .and_then(|raw| serde_json::from_str::<PendingDelivery>(raw).map_err(|e| e.to_string()))?;
    if pending.attempt_id != owner.requested.attempt_id
        || pending.client_turn_id != owner.requested.logical_turn_id
        || pending
            .binding_operation_id
            .as_deref()
            .is_some_and(|operation_id| operation_id != owner.binding_operation_id)
    {
        return Err(format!(
            "pending delivery owner mismatch for attempt {}",
            owner.requested.attempt_id
        ));
    }
    Ok((binding, pending))
}

pub(crate) fn accept_turn_for_attempt_core(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
    native_session_id: &str,
    native_turn_id: Option<String>,
) -> Result<(), String> {
    let owner = durable_attempt_owner(writer, session_id, attempt_id)?;
    let native_session_id = native_session_id.trim();
    if native_session_id.is_empty() {
        return Err("typed prompt ACK missing native session identity".to_string());
    }
    let existing = writer
        .binding_state(session_id, &owner.binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {} is missing", owner.binding_key))?;
    require_attempt_binding_generation(&existing, &owner)?;
    let accepted_at = now_millis() as i64;
    let binding = binding_row_update(
        session_id,
        &owner.binding_key,
        owner.engine,
        owner.provider_profile_id.clone(),
        Some(&existing),
        Some(native_session_id.to_string()),
        None,
        provisioning_json(
            PROVISIONING_READY,
            None,
            Some(attempt_id),
            Some(&owner.binding_operation_id),
            Some(&existing),
            None,
        ),
        "ready",
    );
    writer
        .append_canonical_fact_with_binding_at(
            session_id.to_string(),
            CanonicalFact::TurnAccepted(TurnAcceptedFact {
                logical_turn_id: owner.requested.logical_turn_id.clone(),
                attempt_id: attempt_id.to_string(),
                client_turn_id: owner.requested.logical_turn_id.clone(),
                binding_key: owner.binding_key.clone(),
                native_session_id: native_session_id.to_string(),
                native_turn_id,
                accepted_at,
                extra: json!({
                    "bindingOperationId": owner.binding_operation_id,
                }),
            }),
            accepted_at,
            &binding,
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub fn accept_turn_core(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
    logical_turn_id: &str,
    target: &ExecutionTargetInput,
    native_session_id: &str,
) -> Result<(), String> {
    let requested = requested_fact_for_attempt(writer, session_id, attempt_id)
        .map_err(|error| format!("turnAccepted {error}"))?;
    if requested.logical_turn_id != logical_turn_id || requested.target != target.to_snapshot() {
        return Err(format!(
            "turnAccepted owner mismatch for attempt {attempt_id}"
        ));
    }
    accept_turn_for_attempt_core(writer, session_id, attempt_id, native_session_id, None)
}

// ---------------------------------------------------------------------------
// B.3 core：Tx2 commit_turn（settled → assembler/sink → turnCommitted，幂等）
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct CommitTurnOutcome {
    pub duplicate: bool,
    pub sequence: Option<i64>,
    pub binding_key: String,
}

pub(crate) fn commit_runtime_snapshot_core(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
    final_snapshot: RuntimeFinalSnapshot,
    native_session_id: Option<&str>,
) -> Result<CommitTurnOutcome, String> {
    let owner = durable_attempt_owner(writer, session_id, attempt_id)
        .map_err(|error| format!("run.settled {error}"))?;
    let existing_binding = writer
        .binding_state(session_id, &owner.binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {} is missing", owner.binding_key))?;
    require_attempt_binding_generation(&existing_binding, &owner)?;
    let events = writer
        .events_for_session(session_id)
        .map_err(|error| error.to_string())?;
    let accepted = events
        .iter()
        .find(|event| {
            event.fact_type == "conversation.turnAccepted"
                && event.attempt_id.as_deref() == Some(attempt_id)
        })
        .map(|event| {
            serde_json::from_str::<CanonicalFact>(&event.payload_json)
                .map_err(|error| format!("parse turnAccepted payload: {error}"))
        })
        .transpose()?
        .and_then(|fact| match fact {
            CanonicalFact::TurnAccepted(accepted) => Some(accepted),
            _ => None,
        });
    if final_snapshot.outcome == OutcomeStatus::Completed && accepted.is_none() {
        return Err(format!(
            "run.settled arrived before typed prompt ACK for attempt {attempt_id}"
        ));
    }
    let effective_native_session_id = native_session_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            accepted
                .as_ref()
                .map(|accepted| accepted.native_session_id.clone())
        });

    // 同一 authoritative terminal snapshot 可安全重放；不同 snapshot 必须 fail loud。
    if let Some(existing) = events.iter().find(|event| {
        event.fact_type == "conversation.turnCommitted"
            && event.attempt_id.as_deref() == Some(attempt_id)
    }) {
        let existing_fact = serde_json::from_str::<CanonicalFact>(&existing.payload_json)
            .map_err(|error| format!("parse existing turnCommitted payload: {error}"))?;
        let CanonicalFact::TurnCommitted(existing_fact) = existing_fact else {
            return Err(format!(
                "invalid turnCommitted payload for attempt {attempt_id}"
            ));
        };
        let replay = crate::shared_event_log::canonical::assembler::assemble_turn_committed(
            owner.requested.logical_turn_id.clone(),
            attempt_id.to_string(),
            format!("input:{attempt_id}"),
            owner.requested.target.clone(),
            final_snapshot,
            existing_fact.committed_at,
        )
        .map_err(|error| format!("{}: {}", error.context, error.detail))?;
        if replay != existing_fact {
            let prefix = if matches!(
                existing_fact.outcome.status,
                OutcomeStatus::Cancelled | OutcomeStatus::Replaced
            ) {
                "stale-runtime-terminal"
            } else {
                "turnCommitted semantic conflict"
            };
            return Err(format!(
                "{prefix} for attempt {attempt_id}: authoritative terminal snapshot changed"
            ));
        }
        return Ok(CommitTurnOutcome {
            duplicate: true,
            sequence: Some(existing.sequence),
            binding_key: owner.binding_key,
        });
    }

    let committed_at = now_millis() as i64;
    let binding_has_native_identity = effective_native_session_id.is_some()
        || accepted.is_some()
        || provisioning_state_of(&existing_binding) == PROVISIONING_READY;
    let terminal_provisioning_state = if binding_has_native_identity {
        PROVISIONING_READY
    } else {
        PROVISIONING_PREPARED
    };
    let terminal_availability = if binding_has_native_identity {
        "ready"
    } else {
        "provisioning"
    };
    // 失败 / 取消 / 替换：native 历史不可再盲信 → dirty。
    // completed：证明 native resume / 本轮交付可用 → trusted。
    let terminal_trust = match final_snapshot.outcome {
        OutcomeStatus::Failed | OutcomeStatus::Cancelled | OutcomeStatus::Replaced => {
            Some(NativeContextTrust::Dirty)
        }
        OutcomeStatus::Completed => Some(NativeContextTrust::Trusted),
    };
    let provisioning = provisioning_json(
        terminal_provisioning_state,
        None,
        Some(attempt_id),
        Some(&owner.binding_operation_id),
        Some(&existing_binding),
        terminal_trust,
    );
    let pending = existing_binding
        .pending_delivery_json
        .as_deref()
        .map(serde_json::from_str::<PendingDelivery>)
        .transpose()
        .map_err(|error| error.to_string())?;
    if pending
        .as_ref()
        .is_some_and(|pending| pending.attempt_id != attempt_id)
    {
        return Err("terminal commit does not own pending context delivery".to_string());
    }
    let mut terminal_binding = if pending
        .as_ref()
        .is_some_and(|pending| pending.phase == "accepted-awaiting-commit")
    {
        terminal_binding_update(
            &existing_binding,
            attempt_id,
            effective_native_session_id.clone(),
            Some(provisioning.clone()),
            committed_at,
        )?
        .ok_or_else(|| "accepted delivery missing terminal binding update".to_string())?
    } else {
        binding_row_update(
            session_id,
            &owner.binding_key,
            owner.engine,
            owner.provider_profile_id.clone(),
            Some(&existing_binding),
            effective_native_session_id.clone(),
            existing_binding.committed_through_sequence,
            provisioning.clone(),
            terminal_availability,
        )
    };
    if pending.is_some() {
        // A known negative/recovery terminal before ACK consumes only this Attempt's
        // pending intent. It must not advance the context cursor.
        terminal_binding.pending_delivery_json = None;
    }
    if !binding_has_native_identity {
        // Claude's locally generated requested session id is not an identity ACK.
        // A known terminal before Runtime ownership must not make the next Attempt
        // resume a Native Session that may never have existed.
        terminal_binding.native_session_id = None;
    }
    let append = sink::commit_turn_with_binding(
        writer,
        session_id.to_string(),
        owner.requested.logical_turn_id.clone(),
        attempt_id.to_string(),
        format!("input:{attempt_id}"),
        owner.requested.target.clone(),
        final_snapshot,
        committed_at,
        &terminal_binding,
    )
    .map_err(|error| format!("{}: {}", error.context, error.detail))?;
    let (duplicate, sequence) = match append {
        AppendOutcome::Inserted { sequence, .. } => (false, Some(sequence)),
        AppendOutcome::Duplicate { existing_sequence } => (true, Some(existing_sequence)),
    };

    Ok(CommitTurnOutcome {
        duplicate,
        sequence,
        binding_key: owner.binding_key,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn commit_turn_core(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
    logical_turn_id: &str,
    target: &ExecutionTargetInput,
    assistant_text: Option<String>,
    outcome: &CommitOutcomeInput,
    native_session_id: Option<String>,
) -> Result<CommitTurnOutcome, String> {
    let requested = requested_fact_for_attempt(writer, session_id, attempt_id)
        .map_err(|error| format!("run.settled {error}"))?;
    if requested.logical_turn_id != logical_turn_id || requested.target != target.to_snapshot() {
        return Err(format!(
            "run.settled owner mismatch for attempt {attempt_id}"
        ));
    }
    let final_snapshot = RuntimeFinalSnapshot {
        assistant_blocks: vec![],
        assistant_text,
        tool_calls: Vec::<RuntimeToolCall>::new(),
        tool_results: Vec::<RuntimeToolResult>::new(),
        artifacts: vec![],
        provider_private_refs: vec![],
        omissions: vec![],
        outcome: parse_outcome_status(&outcome.status)?,
        error_code: outcome.error_code.clone(),
        error_message: outcome.error_message.clone(),
        stop_reason: outcome.stop_reason.clone(),
    };
    commit_runtime_snapshot_core(
        writer,
        session_id,
        attempt_id,
        final_snapshot,
        native_session_id.as_deref(),
    )
}

// ---------------------------------------------------------------------------
// B.4 core：recovery / rebuild
// ---------------------------------------------------------------------------

pub fn mark_recovery_core(
    writer: &SharedEventWriter,
    session_id: &str,
    binding_key: &str,
    engine: EngineType,
    provider_profile_id: Option<String>,
    reason: Option<&str>,
) -> Result<(), String> {
    let provider_profile_id = provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let existing = writer
        .binding_state(session_id, binding_key)
        .map_err(|error| error.to_string())?;
    upsert_binding_row(
        writer,
        session_id,
        binding_key,
        engine,
        provider_profile_id,
        existing.as_ref(),
        None,
        None,
        provisioning_json(
            PROVISIONING_RECOVERY_REQUIRED,
            reason,
            None,
            existing
                .as_ref()
                .and_then(binding_operation_id_of)
                .as_deref(),
            existing.as_ref(),
            Some(NativeContextTrust::Dirty),
        ),
        "recovery-required",
    )
    .map_err(|error| error.to_string())?;
    append_control_fact(
        writer,
        session_id,
        "binding.recovery-required",
        Some(binding_key),
        reason,
    )
}

#[derive(Debug)]
pub struct RebuildBindingOutcome {
    pub archived_native_session_id: Option<String>,
    pub replaced_attempt_ids: Vec<String>,
    pub binding_operation_id: String,
}

fn recovery_terminal_snapshot(outcome: OutcomeStatus, stop_reason: &str) -> RuntimeFinalSnapshot {
    RuntimeFinalSnapshot {
        assistant_blocks: vec![],
        assistant_text: None,
        tool_calls: vec![],
        tool_results: vec![],
        artifacts: vec![],
        provider_private_refs: vec![],
        omissions: vec![],
        outcome,
        error_code: None,
        error_message: None,
        stop_reason: Some(stop_reason.to_string()),
    }
}

pub fn cancel_pre_dispatch_attempt_core(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
    reason: &str,
) -> Result<CommitTurnOutcome, String> {
    let owner = durable_attempt_owner(writer, session_id, attempt_id)?;
    let binding = writer
        .binding_state(session_id, &owner.binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {} is missing", owner.binding_key))?;
    require_attempt_binding_generation(&binding, &owner)?;
    let pending: PendingDelivery = serde_json::from_str(
        binding
            .pending_delivery_json
            .as_deref()
            .ok_or_else(|| "pre-dispatch cancellation requires prepared delivery".to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if pending.attempt_id != attempt_id || pending.phase != "prepared" {
        return Err(format!(
            "pre-dispatch cancellation owner/phase mismatch for attempt {attempt_id}: {}",
            pending.phase
        ));
    }
    commit_runtime_snapshot_core(
        writer,
        session_id,
        attempt_id,
        recovery_terminal_snapshot(OutcomeStatus::Cancelled, reason),
        None,
    )
}

/// 显式重建的 durable 部分：先把该 Binding 的唯一未决 Attempt 结算为
/// `replaced`，再在同一 transaction 归档旧 identity、切换 Binding generation。
/// late terminal 因 generation/terminal conflict 只能作为 stale evidence，不能复活旧行。
pub fn rebuild_binding_core(
    writer: &SharedEventWriter,
    session_id: &str,
    binding_key: &str,
) -> Result<RebuildBindingOutcome, String> {
    let existing = writer
        .binding_state(session_id, binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {binding_key} is missing"))?;
    let engine = serde_json::from_value::<EngineType>(Value::String(existing.engine.clone()))
        .map_err(|_| {
            format!(
                "binding {binding_key} has unsupported engine '{}'",
                existing.engine
            )
        })
        .and_then(ensure_supported_shared_session_engine)?;
    let provider_profile_id = existing.provider_profile_id.clone();
    // Squad worker binding key is first-class (`squad:{run}:{node}:{engine}:{provider}`).
    // Main durable path still requires key == engine:provider to prevent identity mix-ups.
    let is_squad_binding = binding_key.starts_with("squad:");
    if !is_squad_binding {
        let durable_binding_key = shared_target_binding_key(engine, provider_profile_id.as_deref());
        if durable_binding_key != binding_key {
            return Err(format!(
                "binding owner mismatch: key '{binding_key}' does not match durable owner '{durable_binding_key}'"
            ));
        }
    }
    let archived_native_session_id = existing.native_session_id.clone();
    // Squad worker turns are excluded from main unresolved evidence; filter is still safe.
    let unresolved = unresolved_attempt_evidence(writer, session_id, Some(binding_key))?;
    if unresolved.len() > 1 {
        return Err(format!(
            "recovery-owner-ambiguous: binding {binding_key} has {} unresolved attempts",
            unresolved.len()
        ));
    }
    let binding_operation_id = Uuid::new_v4().to_string();
    let rebuilt_at = now_millis() as i64;
    let rebuilt_binding = BindingStateUpdate {
        session_id: session_id.to_string(),
        binding_key: binding_key.to_string(),
        engine: engine.icon().to_string(),
        provider_profile_id,
        native_session_id: None,
        accepted_through_sequence: None,
        committed_through_sequence: None,
        provisioning_json: Some(
            json!({
                "state": PROVISIONING_PREPARED,
                "updatedAt": rebuilt_at,
                "rebuiltAt": rebuilt_at,
                "operationId": binding_operation_id,
                "archivedNativeSessionId": archived_native_session_id,
                "nativeContextTrust": NativeContextTrust::Dirty.as_str(),
            })
            .to_string(),
        ),
        pending_delivery_json: None,
        availability: "provisioning".to_string(),
        updated_at: rebuilt_at,
    };
    let mut replaced_attempt_ids = Vec::new();
    if let Some(evidence) = unresolved.first() {
        require_attempt_binding_generation(&existing, &evidence.owner)?;
        let attempt_id = evidence.owner.requested.attempt_id.clone();
        sink::commit_turn_with_binding(
            writer,
            session_id.to_string(),
            evidence.owner.requested.logical_turn_id.clone(),
            attempt_id.clone(),
            format!("input:{attempt_id}"),
            evidence.owner.requested.target.clone(),
            recovery_terminal_snapshot(OutcomeStatus::Replaced, "binding-rebuilt"),
            rebuilt_at,
            &rebuilt_binding,
        )
        .map_err(|error| format!("{}: {}", error.context, error.detail))?;
        replaced_attempt_ids.push(attempt_id);
    } else {
        writer
            .upsert_binding_state(&rebuilt_binding)
            .map_err(|error| error.to_string())?;
    }

    append_control_fact(
        writer,
        session_id,
        "binding.rebuilt",
        Some(binding_key),
        Some("explicit-user-rebuild"),
    )?;
    Ok(RebuildBindingOutcome {
        archived_native_session_id,
        replaced_attempt_ids,
        binding_operation_id,
    })
}

// ---------------------------------------------------------------------------
// Probe / turn_state（只读 evidence，供 B.4.3 定性与 B.6.5 重启恢复）
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct UnresolvedAttemptEvidence {
    owner: DurableAttemptOwner,
    accepted: bool,
    delivery_prepared: bool,
    pending_phase: Option<String>,
}

fn unresolved_attempt_evidence(
    writer: &SharedEventWriter,
    session_id: &str,
    binding_filter: Option<&str>,
) -> Result<Vec<UnresolvedAttemptEvidence>, String> {
    let events = writer
        .events_for_session(session_id)
        .map_err(|error| error.to_string())?;
    let mut requested: Vec<String> = Vec::new();
    let mut seen_requested = std::collections::HashSet::new();
    let mut committed = std::collections::HashSet::new();
    let mut accepted = std::collections::HashSet::new();
    let mut delivery_prepared = std::collections::HashSet::new();
    for event in &events {
        let Some(attempt_id) = event.attempt_id.clone() else {
            continue;
        };
        match event.fact_type.as_str() {
            "conversation.turnRequested" => {
                let squad_worker = serde_json::from_str::<Value>(&event.payload_json)
                    .ok()
                    .and_then(|payload| {
                        payload
                            .get("squadWorkerBindingKey")
                            .and_then(Value::as_str)
                            .map(|value| !value.trim().is_empty())
                    })
                    .unwrap_or(false);
                if squad_worker {
                    continue;
                }
                if seen_requested.insert(attempt_id.clone()) {
                    requested.push(attempt_id);
                }
            }
            "conversation.turnAccepted" => {
                accepted.insert(attempt_id);
            }
            "context.deliveryPrepared" => {
                delivery_prepared.insert(attempt_id);
            }
            "conversation.turnCommitted" => {
                committed.insert(attempt_id);
            }
            _ => {}
        }
    }
    let mut result = Vec::new();
    for attempt_id in requested {
        if committed.contains(&attempt_id) {
            continue;
        }
        let owner = durable_attempt_owner(writer, session_id, &attempt_id)?;
        if binding_filter.is_some_and(|binding_key| binding_key != owner.binding_key) {
            continue;
        }
        let pending_phase = writer
            .binding_state(session_id, &owner.binding_key)
            .map_err(|error| error.to_string())?
            .and_then(|binding| binding.pending_delivery_json)
            .and_then(|raw| serde_json::from_str::<PendingDelivery>(&raw).ok())
            .filter(|pending| pending.attempt_id == attempt_id)
            .map(|pending| pending.phase);
        result.push(UnresolvedAttemptEvidence {
            owner,
            accepted: accepted.contains(&attempt_id),
            delivery_prepared: delivery_prepared.contains(&attempt_id),
            pending_phase,
        });
    }
    Ok(result)
}

// ---------------------------------------------------------------------------
// Tauri commands（薄封装）
// ---------------------------------------------------------------------------

pub(crate) fn require_writer(state: &AppState) -> Result<&SharedEventWriter, String> {
    state
        .shared_event_writer
        .as_ref()
        .ok_or_else(|| "shared event log unavailable".to_string())
}

pub(crate) fn require_shared_session_workspace_owner(
    workspace_id: &str,
    shared_session_id: &str,
) -> Result<(), String> {
    let meta = read_shared_session_meta(workspace_id, shared_session_id).map_err(|error| {
        format!(
            "shared-session-owner-unavailable: session {shared_session_id} is not owned by workspace {workspace_id}: {error}"
        )
    })?;
    validate_shared_session_workspace_owner(
        &meta.id,
        &meta.workspace_id,
        shared_session_id,
        workspace_id,
    )
}

fn validate_shared_session_workspace_owner(
    meta_session_id: &str,
    meta_workspace_id: &str,
    shared_session_id: &str,
    workspace_id: &str,
) -> Result<(), String> {
    if meta_session_id != shared_session_id || meta_workspace_id != workspace_id {
        return Err(format!(
            "shared-session-owner-mismatch: session {shared_session_id} is not owned by workspace {workspace_id}"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod shared_session_workspace_owner_tests {
    use super::validate_shared_session_workspace_owner;

    #[test]
    fn workspace_owner_requires_exact_session_and_workspace_identity() {
        assert!(validate_shared_session_workspace_owner(
            "session-1",
            "workspace-a",
            "session-1",
            "workspace-a",
        )
        .is_ok());
        assert!(validate_shared_session_workspace_owner(
            "session-1",
            "workspace-a",
            "session-1",
            "workspace-b",
        )
        .expect_err("cross-workspace owner must fail closed")
        .contains("shared-session-owner-mismatch"));
        assert!(validate_shared_session_workspace_owner(
            "session-2",
            "workspace-a",
            "session-1",
            "workspace-a",
        )
        .expect_err("cross-session owner must fail closed")
        .contains("shared-session-owner-mismatch"));
    }
}

fn runtime_turn_id(response: &Value) -> Option<String> {
    response
        .pointer("/result/turn/id")
        .or_else(|| response.pointer("/turn/id"))
        .or_else(|| response.pointer("/result/turnId"))
        .or_else(|| response.get("turnId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn runtime_response_error(response: &Value) -> Option<String> {
    crate::shared::codex_core::extract_error_message_from_response(response).or_else(|| {
        response
            .pointer("/response/error/message")
            .or_else(|| response.pointer("/response/error"))
            .and_then(|value| value.as_str().map(str::to_string))
    })
}

fn receipt_nullable_string<'a>(receipt: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    let value = receipt
        .get(key)
        .ok_or_else(|| format!("dispatch receipt missing {key}"))?;
    if value.is_null() {
        return Ok(None);
    }
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(Some)
        .ok_or_else(|| format!("dispatch receipt has invalid {key}"))
}

pub(crate) fn provider_runtime_key_for_target(
    workspace_id: &str,
    engine: EngineType,
    provider_profile_id: Option<&str>,
) -> Result<String, String> {
    match engine {
        EngineType::Codex => Ok(crate::shared::codex_core::session_key_for_provider(
            workspace_id,
            provider_profile_id,
        )),
        EngineType::Claude => Ok(crate::engine::claude::provider_profile::claude_runtime_key(
            workspace_id,
            provider_profile_id,
        )),
        EngineType::Kimi => Ok(crate::engine::kimi_provider_profile::kimi_runtime_key(
            workspace_id,
            provider_profile_id
                .unwrap_or(crate::engine::kimi_provider_profile::KIMI_LOCAL_PROVIDER_PROFILE_ID),
        )),
        EngineType::Grok => Ok(crate::engine::grok_provider_profile::grok_runtime_key(
            workspace_id,
            provider_profile_id
                .unwrap_or(crate::engine::grok_provider_profile::GROK_LOCAL_PROVIDER_PROFILE_ID),
        )),
        EngineType::OpenCode => Ok(
            crate::engine::opencode_provider_profile::opencode_runtime_key(
                workspace_id,
                provider_profile_id,
            ),
        ),
        _ => Err("dispatch receipt has unsupported Shared engine".to_string()),
    }
}

fn validate_runtime_dispatch_receipt(
    response: &Value,
    owner: &DurableAttemptOwner,
    workspace_id: &str,
) -> Result<Value, String> {
    let receipt = response
        .get("dogeDispatchReceipt")
        .or_else(|| response.get("mossxDispatchReceipt"))
        .ok_or_else(|| "dispatch receipt is missing".to_string())?;
    if receipt_nullable_string(receipt, "engine")? != Some(owner.engine.icon()) {
        return Err("dispatch receipt engine does not match durable attempt".to_string());
    }
    if receipt_nullable_string(receipt, "providerProfileId")?
        != owner.provider_profile_id.as_deref()
    {
        return Err("dispatch receipt Provider does not match durable attempt".to_string());
    }
    let expected_provider_source = if owner.provider_profile_id.is_some() {
        "managed"
    } else {
        "local"
    };
    if receipt_nullable_string(receipt, "providerProfileSource")? != Some(expected_provider_source)
    {
        return Err("dispatch receipt Provider source does not match durable attempt".to_string());
    }
    if receipt_nullable_string(receipt, "model")? != owner.target.model.as_deref() {
        return Err("dispatch receipt Model does not match durable attempt".to_string());
    }
    if receipt_nullable_string(receipt, "reasoningEffort")?
        != owner.target.reasoning_effort.as_deref()
    {
        return Err("dispatch receipt Reasoning does not match durable attempt".to_string());
    }
    let expected_runtime_key = provider_runtime_key_for_target(
        workspace_id,
        owner.engine,
        owner.provider_profile_id.as_deref(),
    )?;
    if receipt_nullable_string(receipt, "providerRuntimeKey")?
        != Some(expected_runtime_key.as_str())
    {
        return Err(
            "dispatch receipt Provider Runtime key does not match durable attempt".to_string(),
        );
    }
    Ok(receipt.clone())
}

#[cfg(test)]
mod runtime_dispatch_receipt_tests {
    use super::*;
    use crate::shared_event_log::{open, OpenOutcome};

    fn durable_owner_for_receipt_test(
        engine: EngineType,
        provider_profile_id: Option<&str>,
        model: &str,
        reasoning_effort: Option<&str>,
    ) -> DurableAttemptOwner {
        let root = std::env::temp_dir().join(format!(
            "mossx-shared-dispatch-receipt-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).expect("create receipt test root");
        let writer = match open(&root.join("shared-events.db")).expect("open receipt test store") {
            OpenOutcome::Ready(writer) => writer,
            OpenOutcome::ReadOnlyRecovery { reason, .. } => {
                panic!("unexpected receipt test recovery store: {reason}")
            }
        };
        let attempt_id = "attempt-receipt";
        writer
            .append_canonical_fact(
                "receipt-session".to_string(),
                CanonicalFact::TurnRequested(TurnRequestedFact {
                    logical_turn_id: "logical-receipt".to_string(),
                    attempt_id: attempt_id.to_string(),
                    retry_of_attempt_id: None,
                    input: CanonicalUserInput {
                        text: Some("hello".to_string()),
                        image_refs: None,
                        attachment_refs: None,
                        extra: Value::Object(Default::default()),
                    },
                    target: TurnExecutionSnapshot {
                        engine: engine.icon().to_string(),
                        provider_profile_id: provider_profile_id.map(str::to_string),
                        model_catalog_entry_id: Some(model.to_string()),
                        model: Some(model.to_string()),
                        reasoning: reasoning_effort.map(|effort| ReasoningSelection {
                            effort: effort.to_string(),
                            extra: Value::Object(Default::default()),
                        }),
                        provider_profile_name_snapshot: Some(
                            provider_profile_id.unwrap_or("本地配置").to_string(),
                        ),
                        provider_profile_source: Some(if provider_profile_id.is_some() {
                            CanonicalProviderProfileSource::Managed
                        } else {
                            CanonicalProviderProfileSource::Local
                        }),
                        runtime_capability_fingerprint: None,
                        extra: Value::Object(Default::default()),
                    },
                    requested_at: 1,
                    extra: Value::Object(Default::default()),
                }),
            )
            .expect("append receipt owner");
        let owner =
            durable_attempt_owner(&writer, "receipt-session", attempt_id).expect("durable owner");
        writer.shutdown().expect("shutdown receipt test writer");
        std::fs::remove_dir_all(root).expect("remove receipt test root");
        owner
    }

    #[test]
    fn managed_codex_receipt_requires_exact_provider_runtime_key() {
        let owner = durable_owner_for_receipt_test(
            EngineType::Codex,
            Some("provider-kimi"),
            "kimi-for-coding",
            Some("high"),
        );
        let workspace_id = "workspace-managed";
        let expected_runtime_key = crate::shared::codex_core::session_key_for_provider(
            workspace_id,
            Some("provider-kimi"),
        );
        let receipt = json!({
            "mossxDispatchReceipt": {
                "engine": "codex",
                "providerProfileId": "provider-kimi",
                "providerProfileSource": "managed",
                "providerRuntimeKey": expected_runtime_key,
                "model": "kimi-for-coding",
                "reasoningEffort": "high",
            }
        });

        assert!(validate_runtime_dispatch_receipt(&receipt, &owner, workspace_id).is_ok());

        let mut poisoned = receipt;
        poisoned["mossxDispatchReceipt"]["providerRuntimeKey"] =
            Value::String("workspace-managed::different-provider".to_string());
        assert!(
            validate_runtime_dispatch_receipt(&poisoned, &owner, workspace_id)
                .expect_err("wrong Runtime owner must fail closed")
                .contains("Runtime key does not match")
        );
    }

    #[test]
    fn claude_receipt_accepts_local_and_managed_provider_identity() {
        let local_owner =
            durable_owner_for_receipt_test(EngineType::Claude, None, "claude-sonnet-4-5", None);
        let local_receipt = json!({
            "mossxDispatchReceipt": {
                "engine": "claude",
                "providerProfileId": null,
                "providerProfileSource": "local",
                "providerRuntimeKey": format!(
                    "claude::workspace-local::{}",
                    crate::engine::claude::CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
                ),
                "model": "claude-sonnet-4-5",
                "reasoningEffort": null,
            }
        });
        assert!(
            validate_runtime_dispatch_receipt(&local_receipt, &local_owner, "workspace-local",)
                .is_ok()
        );
        let mut wrong_local_runtime = local_receipt;
        wrong_local_runtime["mossxDispatchReceipt"]["providerRuntimeKey"] =
            json!("claude::workspace-local::provider-anthropic");
        assert!(validate_runtime_dispatch_receipt(
            &wrong_local_runtime,
            &local_owner,
            "workspace-local",
        )
        .is_err());

        let managed_owner = durable_owner_for_receipt_test(
            EngineType::Claude,
            Some("provider-anthropic"),
            "claude-opus-4-1",
            Some("high"),
        );
        assert!(validate_runtime_dispatch_receipt(
            &json!({
                "mossxDispatchReceipt": {
                    "engine": "claude",
                    "providerProfileId": "provider-anthropic",
                    "providerProfileSource": "managed",
                    "providerRuntimeKey": "claude::workspace-managed::provider-anthropic",
                    "model": "claude-opus-4-1",
                    "reasoningEffort": "high",
                }
            }),
            &managed_owner,
            "workspace-managed",
        )
        .is_ok());
    }

    #[test]
    fn newly_supported_engine_receipts_accept_local_and_managed_identity() {
        for (engine, model, managed_provider) in [
            (EngineType::Kimi, "kimi-k2", "provider-kimi"),
            (EngineType::Grok, "grok-code-fast-1", "provider-grok"),
            (
                EngineType::OpenCode,
                "ccgui/opencode-model",
                "provider-opencode",
            ),
        ] {
            let local_owner = durable_owner_for_receipt_test(engine, None, model, None);
            let local_runtime_key =
                provider_runtime_key_for_target("workspace-local", engine, None)
                    .expect("local runtime key");
            assert!(validate_runtime_dispatch_receipt(
                &json!({
                    "mossxDispatchReceipt": {
                        "engine": engine.icon(),
                        "providerProfileId": null,
                        "providerProfileSource": "local",
                        "providerRuntimeKey": local_runtime_key,
                        "model": model,
                        "reasoningEffort": null,
                    }
                }),
                &local_owner,
                "workspace-local",
            )
            .is_ok());

            let managed_owner =
                durable_owner_for_receipt_test(engine, Some(managed_provider), model, Some("high"));
            let managed_runtime_key = provider_runtime_key_for_target(
                "workspace-managed",
                engine,
                Some(managed_provider),
            )
            .expect("managed runtime key");
            assert!(validate_runtime_dispatch_receipt(
                &json!({
                    "mossxDispatchReceipt": {
                        "engine": engine.icon(),
                        "providerProfileId": managed_provider,
                        "providerProfileSource": "managed",
                        "providerRuntimeKey": managed_runtime_key,
                        "model": model,
                        "reasoningEffort": "high",
                    }
                }),
                &managed_owner,
                "workspace-managed",
            )
            .is_ok());
        }
    }

    #[test]
    fn dispatch_receipt_missing_or_mismatched_identity_fails_closed() {
        let owner = durable_owner_for_receipt_test(
            EngineType::Codex,
            Some("provider-kimi"),
            "kimi-for-coding",
            Some("high"),
        );
        let workspace_id = "workspace-managed";
        let expected_runtime_key = crate::shared::codex_core::session_key_for_provider(
            workspace_id,
            Some("provider-kimi"),
        );
        let valid_receipt = json!({
            "mossxDispatchReceipt": {
                "engine": "codex",
                "providerProfileId": "provider-kimi",
                "providerProfileSource": "managed",
                "providerRuntimeKey": expected_runtime_key,
                "model": "kimi-for-coding",
                "reasoningEffort": "high",
            }
        });

        assert!(
            validate_runtime_dispatch_receipt(&json!({}), &owner, workspace_id)
                .expect_err("missing receipt must fail closed")
                .contains("receipt is missing")
        );

        for (field, poisoned_value) in [
            ("engine", json!("claude")),
            ("providerProfileId", json!("provider-other")),
            ("providerProfileSource", json!("local")),
            ("model", json!("gpt-5.3-codex-spark")),
            ("reasoningEffort", json!("low")),
            ("providerRuntimeKey", Value::Null),
        ] {
            let mut poisoned = valid_receipt.clone();
            poisoned["mossxDispatchReceipt"][field] = poisoned_value;
            assert!(
                validate_runtime_dispatch_receipt(&poisoned, &owner, workspace_id).is_err(),
                "{field} mismatch must fail closed"
            );
        }

        let mut missing_model = valid_receipt;
        missing_model["mossxDispatchReceipt"]
            .as_object_mut()
            .expect("receipt object")
            .remove("model");
        assert!(
            validate_runtime_dispatch_receipt(&missing_model, &owner, workspace_id)
                .expect_err("missing field must fail closed")
                .contains("missing model")
        );
    }
}

fn typed_dispatch_error(code: &str, error: &str) -> String {
    let prefix = format!("{code}:");
    if error.starts_with(&prefix) {
        error.to_string()
    } else {
        format!("{code}: {error}")
    }
}

fn failed_runtime_snapshot(code: &str, message: &str) -> RuntimeFinalSnapshot {
    RuntimeFinalSnapshot {
        assistant_blocks: vec![],
        assistant_text: None,
        tool_calls: vec![],
        tool_results: vec![],
        artifacts: vec![],
        provider_private_refs: vec![],
        omissions: vec![],
        outcome: OutcomeStatus::Failed,
        error_code: Some(code.to_string()),
        error_message: Some(message.to_string()),
        stop_reason: Some("runtime-rejected".to_string()),
    }
}

fn persist_context_prepare_failure(
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
    error: &str,
) -> String {
    // empty-context-handoff 必须保持主前缀，供 FE includes/startsWith 分类；
    // 不可被 context-prepare-failed 吞掉。
    let typed = if error.starts_with("empty-context-handoff:") {
        error.to_string()
    } else if error.contains("empty-context-handoff:") {
        format!("empty-context-handoff: {error}")
    } else if error.starts_with("context-prepare-failed:") {
        error.to_string()
    } else {
        format!("context-prepare-failed: {error}")
    };
    match settle_known_dispatch_failure(writer, session_id, owner, None, &typed) {
        Ok(()) => typed,
        Err(persist_error) => {
            format!("{typed}; canonical-failure-persistence: {persist_error}")
        }
    }
}

/// `begin_turn` 已冻结 snapshot 后的 prepare-time revalidation。
///
/// Provider/model catalog 可能在 Tx1 与 Context compile 之间变化。此时尚无 Runtime
/// side effect，必须幂等落 failed terminal，不能留下 unresolved attempt 或误标
/// recovery-required。
pub fn validate_prepare_target_core(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
) -> Result<(), String> {
    let owner = durable_attempt_owner(writer, session_id, attempt_id)?;
    validate_durable_attempt_target(&owner)
        .map_err(|error| persist_context_prepare_failure(writer, session_id, &owner, &error))
}

fn settle_known_dispatch_failure(
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
    native_session_id: Option<&str>,
    typed_error: &str,
) -> Result<(), String> {
    let code = typed_error
        .split_once(':')
        .map(|(prefix, _)| prefix)
        .unwrap_or("target-unavailable");
    commit_runtime_snapshot_core(
        writer,
        session_id,
        &owner.requested.attempt_id,
        failed_runtime_snapshot(code, typed_error),
        if owner.engine == EngineType::Claude {
            // Generated Claude session id is only requested identity until an
            // exact Runtime event/Turn ACK proves ownership.
            None
        } else {
            native_session_id
        },
    )?;
    Ok(())
}

fn mark_ambiguous_dispatch(
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
    reason: &str,
) -> Result<(), String> {
    mark_recovery_core(
        writer,
        session_id,
        &owner.binding_key,
        owner.engine,
        owner.provider_profile_id.clone(),
        Some(reason),
    )
}

fn persist_not_accepted_dispatch(
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
    native_session_id: Option<&str>,
    code: &str,
    error: &str,
) -> String {
    let typed = typed_dispatch_error(code, error);
    let existing_terminal = writer
        .events_for_session(session_id)
        .map_err(|error| error.to_string())
        .and_then(|events| {
            events
                .into_iter()
                .find(|event| {
                    event.fact_type == "conversation.turnCommitted"
                        && event.attempt_id.as_deref() == Some(owner.requested.attempt_id.as_str())
                })
                .map(|event| {
                    serde_json::from_str::<CanonicalFact>(&event.payload_json)
                        .map_err(|error| format!("parse existing turnCommitted payload: {error}"))
                })
                .transpose()
        });
    let persisted = match existing_terminal {
        Ok(Some(CanonicalFact::TurnCommitted(fact)))
            if matches!(
                fact.outcome.status,
                OutcomeStatus::Failed | OutcomeStatus::Cancelled | OutcomeStatus::Replaced
            ) =>
        {
            // Runtime terminal 与 command response 可能并发到达。已有 authoritative
            // negative terminal 时复用它，禁止追加不同 errorCode 的第二份事实。
            Ok(())
        }
        Ok(_) => {
            settle_known_dispatch_failure(writer, session_id, owner, native_session_id, &typed)
        }
        Err(error) => Err(error),
    };
    match persisted {
        Ok(()) => typed,
        Err(persist_error) => format!("{typed}; canonical-failure-persistence: {persist_error}"),
    }
}

fn persist_binding_recovery_and_cleanup(
    state: &AppState,
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
    native_session_id: Option<&str>,
) -> String {
    const RECOVERY_REASON: &str = "native-session-not-found";
    let typed = persist_not_accepted_dispatch(
        writer,
        session_id,
        owner,
        native_session_id,
        "binding-recovery-required",
        RECOVERY_REASON,
    );
    let recovery_error = mark_recovery_core(
        writer,
        session_id,
        &owner.binding_key,
        owner.engine,
        owner.provider_profile_id.clone(),
        Some(RECOVERY_REASON),
    )
    .err();
    state
        .shared_runtime_coordinator
        .remove_attempt(&owner.requested.attempt_id);
    match recovery_error {
        Some(error) => format!("{typed}; binding-recovery-persistence: {error}"),
        None => typed,
    }
}

fn persist_not_accepted_dispatch_and_cleanup(
    state: &AppState,
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
    native_session_id: Option<&str>,
    code: &str,
    error: &str,
) -> String {
    let typed =
        persist_not_accepted_dispatch(writer, session_id, owner, native_session_id, code, error);
    state
        .shared_runtime_coordinator
        .remove_attempt(&owner.requested.attempt_id);
    typed
}

fn persist_ambiguous_dispatch(
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
    error: &str,
) -> String {
    let typed = typed_dispatch_error("ambiguous-runtime", error);
    match mark_ambiguous_dispatch(writer, session_id, owner, &typed) {
        Ok(()) => typed,
        Err(persist_error) => format!("{typed}; canonical-failure-persistence: {persist_error}"),
    }
}

pub(crate) fn commit_settled_runtime_attempt(
    writer: &SharedEventWriter,
    settled: crate::shared_runtime_coordinator::SettledSharedRuntimeAttempt,
) -> Result<CommitTurnOutcome, String> {
    commit_runtime_snapshot_core(
        writer,
        &settled.owner.shared_session_id,
        &settled.owner.attempt_id,
        settled.final_snapshot,
        settled.owner.native_session_id.as_deref(),
    )
}

pub(crate) fn commit_observed_runtime_settlement(
    state: &AppState,
    settled: crate::shared_runtime_coordinator::SettledSharedRuntimeAttempt,
) -> Result<CommitTurnOutcome, String> {
    let writer = require_writer(state)?;
    let owner = settled.owner.clone();
    let binding_recovery_required = owner.engine == EngineType::Claude
        && settled.final_snapshot.outcome == OutcomeStatus::Failed
        && settled
            .final_snapshot
            .error_message
            .as_deref()
            .is_some_and(crate::shared_runtime_coordinator::is_missing_native_session_error);
    match commit_settled_runtime_attempt(writer, settled) {
        Ok(committed) => {
            if binding_recovery_required {
                mark_recovery_core(
                    writer,
                    &owner.shared_session_id,
                    &owner.binding_key,
                    owner.engine,
                    owner.execution_target_snapshot.provider_profile_id.clone(),
                    Some("native-session-not-found"),
                )
                .map_err(|error| format!("binding-recovery-persistence: {error}"))?;
            }
            state
                .shared_runtime_coordinator
                .remove_attempt(&owner.attempt_id);
            Ok(committed)
        }
        Err(error) => {
            // Explicit recovery/rebuild already terminalized this generation.
            // A late Runtime final is diagnostic evidence only; it must not poison
            // the replacement Binding generation.
            if error.starts_with("stale-runtime-terminal:")
                || error.starts_with("stale-runtime-terminal ")
            {
                state
                    .shared_runtime_coordinator
                    .remove_attempt(&owner.attempt_id);
                return Err(error);
            }
            let provider_profile_id = writer
                .binding_state(&owner.shared_session_id, &owner.binding_key)
                .ok()
                .flatten()
                .and_then(|binding| binding.provider_profile_id);
            let _ = mark_recovery_core(
                writer,
                &owner.shared_session_id,
                &owner.binding_key,
                owner.engine,
                provider_profile_id,
                Some("canonical-terminal-commit-failed"),
            );
            Err(error)
        }
    }
}

fn runtime_terminal_delivery(
    settled: &crate::shared_runtime_coordinator::SettledSharedRuntimeAttempt,
) -> Value {
    let outcome = match settled.final_snapshot.outcome {
        OutcomeStatus::Completed => "completed",
        OutcomeStatus::Failed => "failed",
        OutcomeStatus::Cancelled | OutcomeStatus::Replaced => "cancelled",
    };
    let recovery_reason = (settled.owner.engine == EngineType::Claude
        && settled.final_snapshot.outcome == OutcomeStatus::Failed
        && settled
            .final_snapshot
            .error_message
            .as_deref()
            .is_some_and(crate::shared_runtime_coordinator::is_missing_native_session_error))
    .then_some("native-session-not-found");
    json!({
        "type": "run.settled",
        "outcome": outcome,
        "recoveryReason": recovery_reason,
    })
}

fn committed_terminal_response(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
    binding_key: &str,
) -> Result<Option<Value>, String> {
    let committed = writer
        .events_for_session(session_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|event| {
            event.fact_type == "conversation.turnCommitted"
                && event.attempt_id.as_deref() == Some(attempt_id)
        });
    let Some(event) = committed else {
        return Ok(None);
    };
    let fact = serde_json::from_str::<CanonicalFact>(&event.payload_json)
        .map_err(|error| format!("parse committed terminal for attempt {attempt_id}: {error}"))?;
    let CanonicalFact::TurnCommitted(committed) = fact else {
        return Err(format!(
            "invalid conversation.turnCommitted payload for attempt {attempt_id}"
        ));
    };
    let outcome = match committed.outcome.status {
        OutcomeStatus::Completed => "completed",
        OutcomeStatus::Failed => "failed",
        OutcomeStatus::Cancelled | OutcomeStatus::Replaced => "cancelled",
    };
    let recovery_reason = (committed.outcome.status == OutcomeStatus::Failed
        && committed
            .outcome
            .error_message
            .as_deref()
            .is_some_and(crate::shared_runtime_coordinator::is_missing_native_session_error))
    .then_some("native-session-not-found");
    Ok(Some(json!({
        "status": "committed",
        "duplicate": true,
        "sequence": event.sequence,
        "bindingKey": binding_key,
        "terminal": {
            "type": "run.settled",
            "outcome": outcome,
            "recoveryReason": recovery_reason,
        },
    })))
}

fn persist_materialized_binding(
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
    native_session_id: &str,
) -> Result<(), String> {
    let existing = writer
        .binding_state(session_id, &owner.binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {} is missing", owner.binding_key))?;
    require_attempt_binding_generation(&existing, owner)?;
    let identity_acknowledged = owner.engine == EngineType::Codex;
    let provisioning_state = if identity_acknowledged {
        PROVISIONING_READY
    } else {
        PROVISIONING_CREATING
    };
    let availability = if identity_acknowledged {
        "ready"
    } else {
        "provisioning"
    };
    upsert_binding_row(
        writer,
        session_id,
        &owner.binding_key,
        owner.engine,
        owner.provider_profile_id.clone(),
        Some(&existing),
        Some(native_session_id.to_string()),
        None,
        provisioning_json(
            provisioning_state,
            None,
            Some(&owner.requested.attempt_id),
            Some(&owner.binding_operation_id),
            Some(&existing),
            None,
        ),
        availability,
    )
    .map_err(|error| error.to_string())
}

fn mark_binding_materialization_started(
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
) -> Result<(), String> {
    let existing = writer
        .binding_state(session_id, &owner.binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {} is missing", owner.binding_key))?;
    require_attempt_binding_generation(&existing, owner)?;
    if existing
        .native_session_id
        .as_deref()
        .is_some_and(|native_session_id| !native_session_id.trim().is_empty())
    {
        return Ok(());
    }
    upsert_binding_row(
        writer,
        session_id,
        &owner.binding_key,
        owner.engine,
        owner.provider_profile_id.clone(),
        Some(&existing),
        None,
        None,
        provisioning_json(
            PROVISIONING_CREATING,
            None,
            Some(&owner.requested.attempt_id),
            Some(&owner.binding_operation_id),
            Some(&existing),
            None,
        ),
        "provisioning",
    )
    .map_err(|error| error.to_string())
}

async fn materialize_attempt_binding(
    workspace_id: &str,
    session_id: &str,
    owner: &DurableAttemptOwner,
    writer: &SharedEventWriter,
    state: &AppState,
    app: &AppHandle,
) -> Result<String, String> {
    let existing_binding = writer
        .binding_state(session_id, &owner.binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {} is missing", owner.binding_key))?;
    require_attempt_binding_generation(&existing_binding, owner)?;
    let existing = existing_binding
        .native_session_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if existing.is_none() {
        // CAS-like durable transition before native-session creation. A crash after
        // this point is ambiguous and must be recovered; a `prepared` row proves
        // that no materialization side effect started.
        mark_binding_materialization_started(writer, session_id, owner)?;
    }
    let native_session_id = match owner.engine {
        EngineType::Codex => {
            if let Some(thread_id) = existing {
                let provider_runtime_id = owner
                    .provider_profile_id
                    .as_deref()
                    .unwrap_or(crate::codex::provider_profile::CODEX_DISK_PROVIDER_PROFILE_ID);
                crate::codex::ensure_codex_session_for_provider(
                    workspace_id,
                    provider_runtime_id,
                    state,
                    app,
                )
                .await?;
                let resumed = crate::shared::codex_core::resume_thread_core(
                    &state.sessions,
                    workspace_id.to_string(),
                    owner.provider_profile_id.clone(),
                    thread_id.clone(),
                )
                .await?;
                if let Some(error) = runtime_response_error(&resumed) {
                    return Err(error);
                }
                thread_id
            } else {
                let started = crate::codex::start_thread_with_runtime_retry_for_provider(
                    workspace_id,
                    owner.target.model.clone(),
                    owner.provider_profile_id.clone(),
                    state,
                    app,
                )
                .await?;
                crate::shared::codex_core::extract_thread_id_from_response(&started).ok_or_else(
                    || {
                        "ambiguous-runtime: Codex binding start ACK missing thread identity"
                            .to_string()
                    },
                )?
            }
        }
        EngineType::Claude => {
            if let Some(model) = owner.target.model.as_deref() {
                if !crate::engine::is_valid_claude_model_for_passthrough(model) {
                    return Err(format!(
                        "target-unavailable: runtime model '{model}' cannot be passed to Claude CLI"
                    ));
                }
            }
            // 兼容 foundation 回归期间写入的 raw UUID；canonical identity 始终
            // 规范化为 `claude:<uuid>`，不能把 raw existing 误判成“无 Binding”。
            let raw_session_id = existing
                .as_deref()
                .and_then(raw_claude_session_id)
                .map(str::to_string)
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            format!("claude:{raw_session_id}")
        }
        // Grok 支持 `-s` 预分配：与 Claude 一样 materialize 时写入 established
        // `grok:{uuid}`，首轮 create 复用该 id，避免 pending 与落盘 id 分叉导致
        // Hidden Binding 无法从 sidebar hide set 匹配。
        EngineType::Grok => {
            let raw_session_id = existing
                .as_deref()
                .filter(|value| {
                    crate::shared_sessions::binding_uses_established_native_thread(
                        EngineType::Grok,
                        value,
                    )
                })
                .and_then(|value| raw_engine_session_id(EngineType::Grok, value))
                .map(str::to_string)
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            format!("grok:{raw_session_id}")
        }
        // Kimi / OpenCode 真实 id 由 CLI 事后回写；首轮可暂存 pending，settlement
        // 后 rebind 到 `engine:{raw}`。若已有 established 前缀 id 则复用。
        EngineType::Kimi | EngineType::OpenCode => {
            if let Some(existing_id) = existing.as_deref().filter(|value| {
                crate::shared_sessions::binding_uses_established_native_thread(owner.engine, value)
            }) {
                existing_id.to_string()
            } else if let Some(existing_id) = existing.as_deref().filter(|value| {
                !crate::shared_sessions::is_pending_shared_binding_thread_id(owner.engine, value)
            }) {
                // 兼容历史 raw id：规范化为 engine 前缀。
                let raw = raw_engine_session_id(owner.engine, existing_id)
                    .unwrap_or(existing_id)
                    .to_string();
                format!("{}:{raw}", owner.engine.icon())
            } else {
                crate::shared_sessions::engine_binding_thread_id(
                    owner.engine,
                    Uuid::new_v4().to_string().as_str(),
                )
            }
        }
        _ => {
            return Err(format!(
                "target-unavailable: unsupported Shared engine {}",
                owner.engine.icon()
            ));
        }
    };
    persist_materialized_binding(writer, session_id, owner, native_session_id.as_str())?;
    Ok(native_session_id)
}

fn accept_context_for_attempt_core(
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
    package_id: &str,
    native_session_id: &str,
    native_request_id: Option<String>,
) -> Result<(), String> {
    accept_delivery(
        writer,
        &AcceptDeliveryRequest {
            session_id: session_id.to_string(),
            binding_key: owner.binding_key.clone(),
            logical_turn_id: owner.requested.logical_turn_id.clone(),
            attempt_id: owner.requested.attempt_id.clone(),
            binding_operation_id: owner.binding_operation_id.clone(),
            package_id: package_id.to_string(),
            native_session_id: Some(native_session_id.to_string()),
            native_request_id,
            accepted_at: now_millis() as i64,
        },
    )
}

fn legacy_snapshot_fingerprint(path: &std::path::Path, items: &[Value]) -> Result<String, String> {
    let identity = json!({
        "sourcePath": path.to_string_lossy(),
        "items": items,
    });
    let bytes = deterministic_json_bytes(&identity).map_err(|error| error.to_string())?;
    let digest = Sha256::digest(bytes);
    Ok(format!(
        "sha256:{}",
        digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}

/// 在 Tx1 前把 Shared 自己的 V0 snapshot 幂等导入为 presentation-only facts。
///
/// 这是 Shared storage → Shared Event Log 的 compatibility handoff；不读取 Native CLI
/// history。Canonical logical Turn 在 Projector/ContextCompiler 中拥有更高优先级，所以
/// 历史 snapshot 即使包含已经 canonicalized 的 Turn，也只能补正文，不能覆盖 Target。
fn import_legacy_shared_snapshot(
    writer: &SharedEventWriter,
    workspace_id: &str,
    thread_id: &str,
    shared_session_id: &str,
) -> Result<(), String> {
    let (_, source_path) = shared_session_projection_source(workspace_id, thread_id)?;
    let Some(snapshot) = read_latest_shared_session_snapshot(workspace_id, shared_session_id)?
    else {
        return Ok(());
    };
    if snapshot.items.is_empty() {
        return Ok(());
    }
    let meta = read_shared_session_meta(workspace_id, shared_session_id)?;
    let selected_engine = meta
        .selected_target
        .as_ref()
        .map(|target| target.engine)
        .unwrap_or(EngineType::Claude);
    import_legacy_snapshot_items(
        writer,
        shared_session_id,
        &source_path,
        &snapshot.items,
        selected_engine,
        i64::try_from(now_millis()).unwrap_or(i64::MAX),
    )
}

fn import_legacy_snapshot_items(
    writer: &SharedEventWriter,
    shared_session_id: &str,
    source_path: &std::path::Path,
    items: &[Value],
    selected_engine: EngineType,
    imported_at: i64,
) -> Result<(), String> {
    let source_fingerprint = legacy_snapshot_fingerprint(source_path, items)?;
    if writer
        .legacy_import(shared_session_id)
        .map_err(|error| error.to_string())?
        .is_some_and(|marker| {
            marker.status == "completed" && marker.source_fingerprint == source_fingerprint
        })
    {
        return Ok(());
    }

    for fact in
        crate::shared_event_log::canonical::shadow_v0::map_v0_snapshot_to_presentation_only_facts(
            items,
            selected_engine.icon(),
            imported_at,
        )
    {
        writer
            .append_presentation_only_fact(shared_session_id, fact)
            .map_err(|error| error.to_string())?;
    }
    writer
        .upsert_legacy_import(&LegacyImportRow {
            session_id: shared_session_id.to_string(),
            source_path: source_path.to_string_lossy().into_owned(),
            source_fingerprint: source_fingerprint.clone(),
            imported_through_marker: Some(format!(
                "snapshot-items:{}:{source_fingerprint}",
                items.len()
            )),
            status: "completed".to_string(),
            imported_at: Some(imported_at),
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn shared_session_v2_begin_turn(
    workspace_id: String,
    thread_id: String,
    target: ExecutionTargetInput,
    text: String,
    images: Option<Vec<String>>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    if let Err(reason) = validate_resolved_execution_target(&target) {
        return Ok(json!({
            "status": "target-unavailable",
            "reason": reason,
        }));
    }
    import_legacy_shared_snapshot(writer, &workspace_id, &thread_id, &shared_session_id)?;
    let outcome = begin_turn_core(writer, &shared_session_id, &target, text, images)?;
    Ok(match outcome.status {
        BeginTurnStatus::Creating => json!({
            "status": "creating",
            "attemptId": outcome.attempt_id,
            "logicalTurnId": outcome.logical_turn_id,
            "bindingKey": outcome.binding_key,
            "snapshot": outcome
                .snapshot
                .map(|value| serde_json::to_value(value).ok())
                .flatten(),
        }),
        BeginTurnStatus::RecoveryRequired => json!({
            "status": "recovery-required",
            "bindingKey": outcome.binding_key,
            "reason": outcome.reason,
        }),
        BeginTurnStatus::TargetUnavailable => json!({
            "status": "target-unavailable",
            "reason": outcome.reason,
        }),
    })
}

#[tauri::command]
pub async fn shared_session_v2_prepare_context(
    workspace_id: String,
    thread_id: String,
    target: ExecutionTargetInput,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let engine = validate_resolved_execution_target(&target)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let binding_key = shared_target_binding_key(engine, target.normalized_provider().as_deref());
    let binding = writer
        .binding_state(&shared_session_id, &binding_key)
        .map_err(|error| error.to_string())?;
    let package = compile_context(
        &writer
            .events_for_session(&shared_session_id)
            .map_err(|error| error.to_string())?,
        &CompileContextRequest {
            session_id: shared_session_id,
            binding_key,
            destination: serde_json::to_value(&target).map_err(|error| error.to_string())?,
            destination_native_session_id: binding
                .as_ref()
                .and_then(|row| row.native_session_id.clone()),
            from_sequence_exclusive: binding
                .as_ref()
                .and_then(|row| row.accepted_through_sequence),
            through_sequence_inclusive: None,
            exclude_attempt_id: None,
            capabilities: context_capabilities(&target),
            budget_estimated_tokens: None,
        },
    )?;
    let omissions = package
        .manifest
        .omitted
        .iter()
        .filter(|omission| omission.requires_confirmation())
        .map(|omission| format!("{}: {}", omission.category, omission.reason))
        .collect::<Vec<_>>();
    Ok(json!({
        "status": if omissions.is_empty() { "ready" } else { "degraded" },
        "mode": package.manifest.mode,
        "omissions": omissions,
        "manifest": package.manifest,
        "compression": package.compression,
    }))
}

/// Tx3：基于 Tx1 之后的固定 source snapshot 编译 package，先原子保存 artifact，
/// 再原子追加 deliveryPrepared + pending。当前 attempt 自身不进入历史 package。
#[tauri::command]
pub async fn shared_session_v2_prepare_delivery(
    workspace_id: String,
    thread_id: String,
    attempt_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    validate_prepare_target_core(writer, &shared_session_id, &attempt_id)?;
    let owner = durable_attempt_owner(writer, &shared_session_id, &attempt_id)?;
    let preparation = (|| {
        let binding = writer
            .binding_state(&shared_session_id, &owner.binding_key)
            .map_err(|error| error.to_string())?;
        let events = writer
            .events_for_session(&shared_session_id)
            .map_err(|error| error.to_string())?;
        let source_upper = events
            .iter()
            .find(|event| {
                event.fact_type == "conversation.turnRequested"
                    && event.attempt_id.as_deref() == Some(attempt_id.as_str())
            })
            .map(|event| event.sequence.saturating_sub(1))
            .ok_or_else(|| "turnRequested missing before context prepare".to_string())?;
        let capabilities = context_capabilities(&owner.target);
        let destination =
            serde_json::to_value(&owner.requested.target).map_err(|error| error.to_string())?;
        let incremental_request = CompileContextRequest {
            session_id: shared_session_id.clone(),
            binding_key: owner.binding_key.clone(),
            destination: destination.clone(),
            destination_native_session_id: binding
                .as_ref()
                .and_then(|row| row.native_session_id.clone()),
            from_sequence_exclusive: binding
                .as_ref()
                .and_then(|row| row.accepted_through_sequence),
            through_sequence_inclusive: Some(source_upper),
            exclude_attempt_id: Some(attempt_id.clone()),
            capabilities: capabilities.clone(),
            budget_estimated_tokens: None,
        };
        let mut package = compile_context(&events, &incremental_request)?;
        let trust = binding
            .as_ref()
            .map(read_native_context_trust)
            .unwrap_or(NativeContextTrust::Dirty);
        let mut rematerialized = false;
        // P0：dirty 时只要 needs_history，一律全量 rematerialize。
        // 不可仅看 zero-transfer——失败轮「继续」未 turnAccepted 时增量 package
        // 非空但只有短指令，仍会丢原任务（图1）。
        let needs_history = session_needs_history(&events, &incremental_request)?;
        if trust == NativeContextTrust::Dirty && needs_history {
            package = compile_context(
                &events,
                &CompileContextRequest {
                    session_id: shared_session_id.clone(),
                    binding_key: owner.binding_key.clone(),
                    destination,
                    destination_native_session_id: None,
                    from_sequence_exclusive: None,
                    through_sequence_inclusive: Some(source_upper),
                    exclude_attempt_id: Some(attempt_id.clone()),
                    capabilities: capabilities.clone(),
                    budget_estimated_tokens: None,
                },
            )?;
            rematerialized = true;
            if is_zero_transfer_package(&package) {
                return Err(format!(
                    "empty-context-handoff: needs-history but package empty after rematerialize (binding={}, trust=dirty)",
                    owner.binding_key
                ));
            }
        }
        let prepared_at = now_millis() as i64;
        let artifact = write_artifact(
            context_artifact_root(&state)?,
            &workspace_id,
            &shared_session_id,
            &package,
            prepared_at,
        )?;
        prepare_delivery(
            writer,
            &PrepareDeliveryRequest {
                session_id: shared_session_id.clone(),
                binding_key: owner.binding_key.clone(),
                engine: owner.engine.icon().to_string(),
                provider_profile_id: owner.provider_profile_id.clone(),
                logical_turn_id: owner.requested.logical_turn_id.clone(),
                attempt_id: attempt_id.clone(),
                binding_operation_id: owner.binding_operation_id.clone(),
                package: package.clone(),
                prepared_at,
            },
        )?;
        Ok::<_, String>((package, artifact, rematerialized, trust))
    })();
    let (package, artifact, rematerialized, trust) = preparation.map_err(|error| {
        persist_context_prepare_failure(writer, &shared_session_id, &owner, &error)
    })?;
    Ok(json!({
        "status": if package
            .manifest
            .omitted
            .iter()
            .any(|omission| omission.requires_confirmation())
        {
            "degraded"
        } else {
            "ready"
        },
        "packageId": package.package_id,
        "artifactId": artifact.artifact_id,
        "artifactChecksum": artifact.checksum,
        "sourceChecksum": package.manifest.source_checksum,
        "throughSequenceInclusive": package.manifest.through_sequence_inclusive,
        "mode": package.manifest.mode,
        "operation": package.manifest.mode.operation(),
        "promptPrefix": package.prompt_prefix,
        "importItems": codex_import_items(&package),
        "manifest": package.manifest,
        "compression": package.compression,
        "ackFidelity": if context_capabilities(&owner.target).strong_context_ack { "strong" } else { "weak" },
        "rematerialized": rematerialized,
        "nativeContextTrust": trust.as_str(),
    }))
}

/// V2 actual-send boundary：IPC 只携带 durable attempt identity、artifact identity
/// 与非 Target 的 operational options。Engine/Provider/Model/Reasoning/Text 均从
/// `conversation.turnRequested` 读取；Binding 只读写 SQLite shared_binding_state。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn shared_session_v2_dispatch_turn(
    workspace_id: String,
    thread_id: String,
    attempt_id: String,
    artifact_id: String,
    artifact_checksum: String,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    collaboration_mode: Option<Value>,
    preferred_language: Option<String>,
    custom_spec_root: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let owner = durable_attempt_owner(writer, &shared_session_id, &attempt_id)?;
    let access_mode = scoped_attempt_access_mode(&owner, access_mode)?;
    validate_durable_attempt_target(&owner).map_err(|error| {
        persist_not_accepted_dispatch_and_cleanup(
            &state,
            writer,
            &shared_session_id,
            &owner,
            None,
            "target-unavailable",
            &error,
        )
    })?;
    let (binding_before_dispatch, pending) =
        pending_delivery_for_owner(writer, &shared_session_id, &owner).map_err(|error| {
            persist_not_accepted_dispatch_and_cleanup(
                &state,
                writer,
                &shared_session_id,
                &owner,
                None,
                "target-unavailable",
                &error,
            )
        })?;
    if pending.phase != "prepared" {
        return Err(persist_ambiguous_dispatch(
            writer,
            &shared_session_id,
            &owner,
            &format!(
                "attempt {attempt_id} delivery phase is '{}'; probe before retry",
                pending.phase
            ),
        ));
    }
    let artifact = read_artifact(
        context_artifact_root(&state)?,
        &ArtifactReadRequest {
            workspace_id: workspace_id.clone(),
            session_id: shared_session_id.clone(),
            artifact_id: artifact_id.clone(),
            checksum: artifact_checksum,
        },
    )
    .map_err(|error| {
        persist_not_accepted_dispatch_and_cleanup(
            &state,
            writer,
            &shared_session_id,
            &owner,
            None,
            "target-unavailable",
            &error,
        )
    })?;
    if artifact.artifact_id != artifact_id
        || artifact.package.package_id != pending.package_id
        || artifact.package.manifest.source_checksum != pending.source_checksum
        || artifact.package.manifest.mode.operation() != pending.operation
    {
        return Err(persist_not_accepted_dispatch_and_cleanup(
            &state,
            writer,
            &shared_session_id,
            &owner,
            None,
            "target-unavailable",
            &format!("context artifact owner mismatch for attempt {attempt_id}"),
        ));
    }
    let capabilities = context_capabilities(&owner.target);
    let had_native_binding = binding_before_dispatch
        .native_session_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let provider_runtime_key = provider_runtime_key_for_target(
        &workspace_id,
        owner.engine,
        owner.provider_profile_id.as_deref(),
    )
    .map_err(|error| {
        persist_not_accepted_dispatch_and_cleanup(
            &state,
            writer,
            &shared_session_id,
            &owner,
            None,
            "target-unavailable",
            &error,
        )
    })?;
    let initial_owner = crate::shared_runtime_coordinator::SharedRuntimeAttemptOwner {
        workspace_id: workspace_id.clone(),
        provider_runtime_key,
        shared_session_id: shared_session_id.clone(),
        shared_thread_id: thread_id.clone(),
        logical_turn_id: owner.requested.logical_turn_id.clone(),
        attempt_id: attempt_id.clone(),
        binding_key: owner.binding_key.clone(),
        binding_operation_id: owner.binding_operation_id.clone(),
        engine: owner.engine,
        execution_target_snapshot: owner.requested.target.clone(),
        // D8：复用 native Binding 时，上一 turn 的迟到事件也携带同一 native id。
        // send response 给出本次 runtimeTurnId 前不得注册 native fallback；否则迟到
        // terminal 可能被错误归给新 attempt。先缓存 unowned event，拿到 exact turn id
        // 后再一次性 bind + replay。
        native_session_id: None,
        runtime_turn_id: None,
        context_marker: (capabilities.strong_context_ack
            && pending.operation == "prompt-prefix"
            && !artifact.package.prompt_prefix.trim().is_empty())
        .then(
            || crate::shared_runtime_coordinator::SharedRuntimeContextMarker {
                package_id: pending.package_id.clone(),
                source_checksum: pending.source_checksum.clone(),
            },
        ),
    };
    if let Some(settled) = state
        .shared_runtime_coordinator
        .register_attempt(initial_owner)
        .map_err(|error| persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error))?
    {
        let terminal = runtime_terminal_delivery(&settled);
        let committed = commit_observed_runtime_settlement(&state, settled)?;
        return Ok(json!({
            "status": "accepted",
            "attemptId": attempt_id,
            "logicalTurnId": owner.requested.logical_turn_id,
            "engine": owner.engine,
            "providerProfileId": owner.provider_profile_id,
            "model": owner.target.model,
            "reasoningEffort": owner.target.reasoning_effort,
            "bindingKey": committed.binding_key,
            "nativeThreadId": binding_before_dispatch.native_session_id,
            "runtimeTurnId": Value::Null,
            "alreadySettled": true,
            "response": Value::Null,
            "delivery": {
                "promptAcceptance": "accepted",
                "contextAcceptance": {
                    "status": "accepted",
                    "packageId": pending.package_id,
                    "sourceChecksum": pending.source_checksum,
                    "ackFidelity": if capabilities.strong_context_ack { "strong" } else { "weak" },
                    "evidence": "runtime-terminal-replay",
                },
                "terminal": terminal,
            },
        }));
    }
    let needs_codex_provisioning_hold = owner.engine == EngineType::Codex && !had_native_binding;
    if needs_codex_provisioning_hold {
        state
            .shared_runtime_coordinator
            .hold_native_provisioning(&attempt_id)
            .map_err(|error| {
                persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error)
            })?;
    }
    let native_session_id = match materialize_attempt_binding(
        &workspace_id,
        &shared_session_id,
        &owner,
        writer,
        &state,
        &app,
    )
    .await
    {
        Ok(native_session_id) => native_session_id,
        Err(error) => {
            if needs_codex_provisioning_hold {
                // exact identity 未返回，隐藏这次 provisioning 窗口内的早到
                // thread/started；durable Binding 已进入显式 recovery。
                let _ = state
                    .shared_runtime_coordinator
                    .finish_native_provisioning(&attempt_id);
            }
            return Err(persist_ambiguous_dispatch(
                writer,
                &shared_session_id,
                &owner,
                &error,
            ));
        }
    };
    if let Err(error) = state
        .shared_runtime_coordinator
        .hold_native_session(&attempt_id, &native_session_id)
    {
        if needs_codex_provisioning_hold {
            let _ = state
                .shared_runtime_coordinator
                .finish_native_provisioning(&attempt_id);
        }
        return Err(persist_ambiguous_dispatch(
            writer,
            &shared_session_id,
            &owner,
            &error,
        ));
    }
    if needs_codex_provisioning_hold {
        for event in state
            .shared_runtime_coordinator
            .finish_native_provisioning(&attempt_id)
            .map_err(|error| {
                persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error)
            })?
        {
            let _ = app.emit("app-server-event", event);
        }
    }
    let delivery_request_id = format!("shared-delivery:{attempt_id}");
    mark_delivery_sent(
        writer,
        &MarkDeliverySentRequest {
            session_id: shared_session_id.clone(),
            binding_key: owner.binding_key.clone(),
            attempt_id: attempt_id.clone(),
            binding_operation_id: owner.binding_operation_id.clone(),
            native_session_id: native_session_id.clone(),
            native_request_id: delivery_request_id.clone(),
            sent_at: now_millis() as i64,
        },
    )
    .map_err(|error| {
        persist_not_accepted_dispatch_and_cleanup(
            &state,
            writer,
            &shared_session_id,
            &owner,
            Some(&native_session_id),
            "target-unavailable",
            &error,
        )
    })?;
    let no_context_transfer_required =
        artifact.package.delta.is_empty() && artifact.package.prompt_prefix.trim().is_empty();
    let mut context_evidence = if no_context_transfer_required {
        "no-context-transfer-required"
    } else {
        "typed-prompt-acceptance"
    };
    if pending.operation == "context-import" {
        if owner.engine != EngineType::Codex {
            let error =
                "target-unavailable: context-import is not supported by the selected Runtime";
            return Err(persist_not_accepted_dispatch_and_cleanup(
                &state,
                writer,
                &shared_session_id,
                &owner,
                Some(&native_session_id),
                "target-unavailable",
                error,
            ));
        }
        if !no_context_transfer_required {
            crate::shared::codex_core::inject_thread_items_core(
                &state.sessions,
                &workspace_id,
                owner.provider_profile_id.as_deref(),
                &native_session_id,
                codex_import_items(&artifact.package),
            )
            .await
            .map_err(|error| {
                persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error)
            })?;
            context_evidence = "thread/inject_items-jsonrpc-success";
        }
        accept_context_for_attempt_core(
            writer,
            &shared_session_id,
            &owner,
            &pending.package_id,
            &native_session_id,
            (!no_context_transfer_required).then(|| delivery_request_id.clone()),
        )?;
        // 非零交接 accept 后可再信任 native 省略。
        if !no_context_transfer_required {
            set_native_context_trust(
                writer,
                &shared_session_id,
                &owner.binding_key,
                NativeContextTrust::Trusted,
            )?;
        }
    }

    // 附图：调用方参数优先；缺省时从 durable TurnRequested.image_refs 回填。
    // 协作 driveAttempt 只传 attemptId、不重复传图，必须走这条 SSOT。
    let images = resolve_dispatch_images(images, &owner.requested.input);
    let has_images = images.as_ref().is_some_and(|paths| !paths.is_empty());
    let user_text = owner
        .requested
        .input
        .text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            if has_images {
                // 纯图轮：引擎侧至少需要占位文案，避免 silent empty prompt
                Some("（请根据附图回答）".to_string())
            } else {
                None
            }
        })
        .ok_or_else(|| {
            persist_ambiguous_dispatch(
                writer,
                &shared_session_id,
                &owner,
                "durable attempt has empty user text after context delivery started",
            )
        })?;
    let outbound_text = if pending.operation == "prompt-prefix"
        && !artifact.package.prompt_prefix.trim().is_empty()
    {
        format!(
            "{}\n\nCurrent user request:\n{}",
            artifact.package.prompt_prefix.trim(),
            user_text
        )
    } else {
        user_text
    };

    let response = match owner.engine {
        EngineType::Codex => {
            let (mode_enforcement_enabled, extra_developer_instructions) = {
                let settings = state.app_settings.lock().await;
                (
                    settings.codex_mode_enforcement_enabled,
                    crate::backend::app_server_cli::codex_generated_developer_instructions_for_turn(
                        &settings,
                    ),
                )
            };
            crate::shared::codex_core::send_user_message_core(
                &state.sessions,
                workspace_id.clone(),
                owner.provider_profile_id.clone(),
                native_session_id.clone(),
                outbound_text,
                owner.target.model.clone(),
                owner.target.reasoning_effort.clone(),
                access_mode,
                images,
                collaboration_mode_for_attempt(collaboration_mode, &owner.target),
                preferred_language,
                custom_spec_root,
                mode_enforcement_enabled,
                extra_developer_instructions,
            )
            .await
        }
        EngineType::Claude => {
            let raw_session_id = native_session_id
                .strip_prefix("claude:")
                .unwrap_or(native_session_id.as_str())
                .to_string();
            // `None` 在通用 Native send 中表示“允许从 session catalog 回退”。
            // Shared 的 durable local/default Target 不是缺省值，必须显式传 local
            // sentinel，防止旧 session metadata 把本轮悄悄切回 managed Provider。
            let runtime_provider_profile_id = owner.provider_profile_id.clone().or_else(|| {
                Some(crate::engine::claude::CLAUDE_LOCAL_PROVIDER_PROFILE_ID.to_string())
            });
            crate::engine::engine_send_message(
                workspace_id.clone(),
                outbound_text,
                Some(EngineType::Claude),
                owner.target.model.clone(),
                owner.target.reasoning_effort.clone(),
                disable_thinking,
                access_mode,
                images,
                had_native_binding,
                Some(native_session_id.clone()),
                Some(raw_session_id),
                None,
                None,
                None,
                runtime_provider_profile_id,
                custom_spec_root,
                None,
                None,
                app.clone(),
                state.clone(),
            )
            .await
        }
        EngineType::Kimi | EngineType::Grok | EngineType::OpenCode => {
            let runtime_provider_profile_id = owner.provider_profile_id.clone().or_else(|| {
                Some(
                    match owner.engine {
                        EngineType::Kimi => {
                            crate::engine::kimi_provider_profile::KIMI_LOCAL_PROVIDER_PROFILE_ID
                        }
                        EngineType::Grok => {
                            crate::engine::grok_provider_profile::GROK_LOCAL_PROVIDER_PROFILE_ID
                        }
                        EngineType::OpenCode => {
                            crate::engine::opencode_provider_profile::OPENCODE_LOCAL_PROVIDER_PROFILE_ID
                        }
                        _ => unreachable!("new Shared engine branch is exhaustively matched"),
                    }
                    .to_string(),
                )
            });
            // 对齐 Claude：established identity 始终把 raw session id 传给 runtime。
            // Grok 首轮 continue=false 仍带 pre-assigned id（`-s`）；Kimi/OpenCode
            // pending 时 raw 可能是 pending 占位，runtime 自行忽略/新建。
            let established = crate::shared_sessions::binding_uses_established_native_thread(
                owner.engine,
                &native_session_id,
            );
            let runtime_session_id = raw_engine_session_id(owner.engine, &native_session_id)
                .filter(|raw| {
                    !crate::shared_sessions::is_pending_shared_binding_thread_id(
                        owner.engine,
                        raw,
                    )
                })
                .map(str::to_string);
            let continue_session = had_native_binding && established;
            crate::engine::engine_send_message(
                workspace_id.clone(),
                outbound_text,
                Some(owner.engine),
                owner.target.model.clone(),
                owner.target.reasoning_effort.clone(),
                disable_thinking,
                access_mode,
                images,
                continue_session,
                Some(native_session_id.clone()),
                // Grok materialize 已预分配 `grok:{uuid}`：首轮 continue=false 仍传 raw 走 `-s`。
                // 禁止把 pending 占位塞给 runtime。Kimi/OpenCode 仅 established 后 resume。
                if owner.engine == EngineType::Grok {
                    runtime_session_id
                } else {
                    runtime_session_id.filter(|_| established)
                },
                None,
                None,
                None,
                runtime_provider_profile_id,
                custom_spec_root,
                None,
                None,
                app.clone(),
                state.clone(),
            )
            .await
        }
        _ => Err(format!(
            "target-unavailable: unsupported Shared engine {}",
            owner.engine.icon()
        )),
    }
    .map_err(|error| persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error))?;

    if let Some(error) = runtime_response_error(&response) {
        if owner.engine == EngineType::Claude
            && crate::shared_runtime_coordinator::is_missing_native_session_error(&error)
        {
            return Err(persist_binding_recovery_and_cleanup(
                &state,
                writer,
                &shared_session_id,
                &owner,
                Some(&native_session_id),
            ));
        }
        return Err(persist_not_accepted_dispatch_and_cleanup(
            &state,
            writer,
            &shared_session_id,
            &owner,
            Some(&native_session_id),
            "target-provider-rejected",
            &error,
        ));
    }
    let dispatch_receipt = validate_runtime_dispatch_receipt(&response, &owner, &workspace_id)
        .map_err(|error| persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error))?;
    if owner.engine == EngineType::Claude {
        if let Some(requested_model) = owner.target.model.as_deref() {
            let runtime_model = response
                .pointer("/modelResolution/runtimeModel")
                .or_else(|| response.pointer("/result/modelResolution/runtimeModel"))
                .and_then(Value::as_str);
            if runtime_model != Some(requested_model) {
                return Err(persist_ambiguous_dispatch(
                    writer,
                    &shared_session_id,
                    &owner,
                    &format!(
                        "Claude runtime model ACK mismatch; requested '{requested_model}', received '{}'",
                        runtime_model.unwrap_or("<missing>")
                    ),
                ));
            }
        }
    }
    let native_turn_id = runtime_turn_id(&response).ok_or_else(|| {
        persist_ambiguous_dispatch(
            writer,
            &shared_session_id,
            &owner,
            "Runtime ACK missing exact turn identity",
        )
    })?;
    state
        .shared_runtime_coordinator
        .bind_runtime_turn(&attempt_id, Some(&native_turn_id), Some(&native_session_id))
        .map_err(|error| persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error))?;

    if pending.operation == "prompt-prefix" {
        if capabilities.strong_context_ack && !artifact.package.prompt_prefix.trim().is_empty() {
            let wait_outcome = state
                .shared_runtime_coordinator
                .wait_for_context_ack_or_settlement(&attempt_id, Duration::from_secs(30))
                .await
                .map_err(|error| {
                    persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error)
                })?;
            let ack = match wait_outcome {
                crate::shared_runtime_coordinator::SharedRuntimeContextWaitOutcome::Acknowledged(
                    ack,
                ) => ack,
                crate::shared_runtime_coordinator::SharedRuntimeContextWaitOutcome::Settled(
                    settled,
                ) => {
                    let outcome = settled.final_snapshot.outcome;
                    let detail = settled
                        .final_snapshot
                        .error_message
                        .clone()
                        .unwrap_or_else(|| {
                            "Runtime terminated before Shared context ACK".to_string()
                        });
                    let binding_recovery_required = owner.engine == EngineType::Claude
                        && outcome == OutcomeStatus::Failed
                        && crate::shared_runtime_coordinator::is_missing_native_session_error(
                            &detail,
                        );
                    commit_observed_runtime_settlement(&state, settled)?;
                    if binding_recovery_required {
                        return Err(
                            "binding-recovery-required: native-session-not-found".to_string(),
                        );
                    }
                    return Err(match outcome {
                        OutcomeStatus::Failed => {
                            format!("target-provider-rejected: {detail}")
                        }
                        OutcomeStatus::Cancelled | OutcomeStatus::Replaced => {
                            format!("target-unavailable: {detail}")
                        }
                        OutcomeStatus::Completed => format!(
                            "ambiguous-runtime: Runtime completed before Shared context ACK: {detail}"
                        ),
                    });
                }
            };
            if ack.package_id != pending.package_id
                || ack.source_checksum != pending.source_checksum
            {
                return Err(persist_ambiguous_dispatch(
                    writer,
                    &shared_session_id,
                    &owner,
                    "Claude context echo ACK owner mismatch",
                ));
            }
            context_evidence = "claude-replay-echo-checksum";
        }
        accept_context_for_attempt_core(
            writer,
            &shared_session_id,
            &owner,
            &pending.package_id,
            &native_session_id,
            Some(native_turn_id.clone()),
        )
        .map_err(|error| persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error))?;
        if !no_context_transfer_required {
            if let Err(error) = set_native_context_trust(
                writer,
                &shared_session_id,
                &owner.binding_key,
                NativeContextTrust::Trusted,
            ) {
                return Err(persist_ambiguous_dispatch(
                    writer,
                    &shared_session_id,
                    &owner,
                    &error,
                ));
            }
        }
    }
    accept_turn_for_attempt_core(
        writer,
        &shared_session_id,
        &attempt_id,
        &native_session_id,
        Some(native_turn_id.clone()),
    )
    .map_err(|error| persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error))?;

    // durable prompt/context accept 完成后才能开放 Shared UI。循环 drain 时
    // barrier 始终保持：每个 ingress 先发布 authoritative observation，再发
    // projected AppServerEvent；一次空 drain 才在 coordinator lock 内原子放行
    // 后续实时 fan-out。
    let mut early_terminal = None;
    loop {
        let batch = state
            .shared_runtime_coordinator
            .drain_replay_barrier(&attempt_id)?;
        for event in batch.native_app_server_events {
            let _ = app.emit("app-server-event", event);
        }
        for delivery in batch.deliveries {
            if early_terminal.is_none() {
                early_terminal = delivery
                    .observation
                    .settled
                    .as_ref()
                    .map(runtime_terminal_delivery);
            }
            crate::event_sink::publish_shared_runtime_observation(&state, &delivery.observation);
            for event in delivery.app_server_events {
                let _ = app.emit("app-server-event", event);
            }
        }
        if batch.barrier_cleared {
            break;
        }
    }
    let acknowledged_provider_profile_id = dispatch_receipt
        .get("providerProfileId")
        .cloned()
        .unwrap_or(Value::Null);
    let acknowledged_model = dispatch_receipt
        .get("model")
        .cloned()
        .unwrap_or(Value::Null);
    let acknowledged_reasoning_effort = dispatch_receipt
        .get("reasoningEffort")
        .cloned()
        .unwrap_or(Value::Null);

    Ok(json!({
        "status": "accepted",
        "attemptId": attempt_id,
        "logicalTurnId": owner.requested.logical_turn_id,
        "engine": owner.engine,
        "providerProfileId": acknowledged_provider_profile_id,
        "model": acknowledged_model,
        "reasoningEffort": acknowledged_reasoning_effort,
        "bindingKey": owner.binding_key,
        "nativeThreadId": native_session_id,
        "runtimeTurnId": native_turn_id,
        "alreadySettled": early_terminal.is_some(),
        "result": response.get("result").cloned().unwrap_or_else(|| response.clone()),
        "turn": response
            .get("turn")
            .cloned()
            .or_else(|| response.pointer("/result/turn").cloned())
            .unwrap_or(Value::Null),
        "response": response,
        "dispatchReceipt": dispatch_receipt,
        "delivery": {
            "promptAcceptance": "accepted",
            "contextAcceptance": {
                "status": "accepted",
                "packageId": pending.package_id,
                "sourceChecksum": pending.source_checksum,
                "ackFidelity": if capabilities.strong_context_ack { "strong" } else { "weak" },
                "evidence": context_evidence,
            },
            "terminal": early_terminal,
        },
    }))
}

#[tauri::command]
pub async fn shared_context_retrieve_artifact(
    workspace_id: String,
    thread_id: String,
    artifact_id: String,
    checksum: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let artifact = read_artifact(
        context_artifact_root(&state)?,
        &ArtifactReadRequest {
            workspace_id,
            session_id: shared_session_id,
            artifact_id,
            checksum,
        },
    )?;
    serde_json::to_value(artifact).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn shared_context_scan_orphans(state: State<'_, AppState>) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    // ponytail: report-only maintenance path，按 artifact 读取 session events；
    // artifact 量显著增长后可升级为一次性 packageId index。
    let paths = scan_orphan_artifacts(context_artifact_root(&state)?, |artifact| {
        writer
            .events_for_session(&artifact.session_id)
            .ok()
            .is_some_and(|events| {
                events.iter().any(|event| {
                    if event.fact_type != "context.deliveryPrepared" {
                        return false;
                    }
                    serde_json::from_str::<Value>(&event.payload_json)
                        .ok()
                        .and_then(|payload| {
                            payload
                                .get("packageId")
                                .and_then(Value::as_str)
                                .map(|package_id| package_id == artifact.package.package_id)
                        })
                        .unwrap_or(false)
                })
            })
    })?;
    Ok(json!({
        "status": "report-only",
        "paths": paths,
    }))
}

#[tauri::command]
pub async fn shared_session_v2_await_turn_terminal(
    workspace_id: String,
    thread_id: String,
    attempt_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let owner = durable_attempt_owner(writer, &shared_session_id, &attempt_id)?;

    if let Some(committed) =
        committed_terminal_response(writer, &shared_session_id, &attempt_id, &owner.binding_key)?
    {
        return Ok(committed);
    }

    let settlement = state
        .shared_runtime_coordinator
        .wait_for_settlement(&attempt_id)
        .await;

    if let Some(settled) = settlement {
        if let Err(commit_error) = commit_observed_runtime_settlement(&state, settled) {
            // 另一 critical sink 可能已经抢先完成幂等 commit/remove。
            if let Some(committed) = committed_terminal_response(
                writer,
                &shared_session_id,
                &attempt_id,
                &owner.binding_key,
            )? {
                return Ok(committed);
            }
            return Err(commit_error);
        }
    }

    committed_terminal_response(writer, &shared_session_id, &attempt_id, &owner.binding_key)?
        .ok_or_else(|| {
            format!(
                "ambiguous-runtime: attempt {attempt_id} owner ended without durable conversation.turnCommitted"
            )
        })
}

#[tauri::command]
pub async fn shared_session_v2_commit_turn(
    workspace_id: String,
    thread_id: String,
    attempt_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let owner = durable_attempt_owner(writer, &shared_session_id, &attempt_id)?;
    let mut committed = writer
        .events_for_session(&shared_session_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|event| {
            event.fact_type == "conversation.turnCommitted"
                && event.attempt_id.as_deref() == Some(attempt_id.as_str())
        });
    if committed.is_none() {
        if let Some(settled) = state
            .shared_runtime_coordinator
            .settled_for_attempt(&attempt_id)
        {
            // D13：先持久化，成功后 helper 才清理 Runtime owner/cache。
            // 失败时必须保留 authoritative snapshot，供 probe/commit retry 使用。
            commit_observed_runtime_settlement(&state, settled)?;
            committed = writer
                .events_for_session(&shared_session_id)
                .map_err(|error| error.to_string())?
                .into_iter()
                .find(|event| {
                    event.fact_type == "conversation.turnCommitted"
                        && event.attempt_id.as_deref() == Some(attempt_id.as_str())
                });
        }
    }
    Ok(match committed {
        Some(event) => json!({
            "status": "committed",
            "duplicate": true,
            "sequence": event.sequence,
            "bindingKey": owner.binding_key,
        }),
        None => json!({
            "status": "pending",
            "attemptId": attempt_id,
            "bindingKey": owner.binding_key,
        }),
    })
}

/// ACK 不确定（超时/崩溃/未知）：provisioning → recovery-required，禁止盲目重建。
#[tauri::command]
pub async fn shared_session_v2_mark_recovery(
    workspace_id: String,
    thread_id: String,
    attempt_id: String,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let owner = durable_attempt_owner(writer, &shared_session_id, &attempt_id)?;
    let already_committed = writer
        .events_for_session(&shared_session_id)
        .map_err(|error| error.to_string())?
        .iter()
        .any(|event| {
            event.fact_type == "conversation.turnCommitted"
                && event.attempt_id.as_deref() == Some(attempt_id.as_str())
        });
    if already_committed {
        return Ok(json!({
            "status": "terminal-committed",
            "attemptId": attempt_id,
            "bindingKey": owner.binding_key,
        }));
    }
    if let Some(settled) = state
        .shared_runtime_coordinator
        .settled_for_attempt(&attempt_id)
    {
        let committed = commit_observed_runtime_settlement(&state, settled)?;
        return Ok(json!({
            "status": "terminal-committed",
            "attemptId": attempt_id,
            "bindingKey": committed.binding_key,
            "sequence": committed.sequence,
        }));
    }
    let binding = writer
        .binding_state(&shared_session_id, &owner.binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {} is missing", owner.binding_key))?;
    require_attempt_binding_generation(&binding, &owner)?;
    let unresolved = unresolved_attempt_evidence(writer, &shared_session_id, None)?;
    let evidence = unresolved
        .iter()
        .find(|evidence| evidence.owner.requested.attempt_id == attempt_id)
        .ok_or_else(|| format!("recovery-owner-missing: attempt {attempt_id} is not unresolved"))?;
    if let Some(active) = active_recovery_response(
        writer,
        &state.shared_runtime_coordinator,
        &workspace_id,
        &thread_id,
        evidence,
    )? {
        return Ok(active);
    }
    mark_recovery_core(
        writer,
        &shared_session_id,
        &owner.binding_key,
        owner.engine,
        owner.provider_profile_id,
        reason.as_deref(),
    )?;
    Ok(json!({
        "status": "recovery-required",
        "attemptId": attempt_id,
        "bindingKey": owner.binding_key,
    }))
}

/// 用户在 actual package 确认阶段取消：此时 Runtime side effect 尚未开始。
/// 只允许消费 exact prepared Attempt；任何已注册 Runtime owner 都 fail closed。
#[tauri::command]
pub async fn shared_session_v2_cancel_attempt(
    workspace_id: String,
    thread_id: String,
    attempt_id: String,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let owner = durable_attempt_owner(writer, &shared_session_id, &attempt_id)?;
    if let Some(committed) = writer
        .events_for_session(&shared_session_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|event| {
            event.fact_type == "conversation.turnCommitted"
                && event.attempt_id.as_deref() == Some(attempt_id.as_str())
        })
    {
        return Ok(json!({
            "status": "terminal-committed",
            "attemptId": attempt_id,
            "bindingKey": owner.binding_key,
            "sequence": committed.sequence,
        }));
    }
    if state.shared_runtime_coordinator.owns_attempt(&attempt_id) {
        return Err(format!(
            "pre-dispatch-cancel-refused: Runtime owner already exists for attempt {attempt_id}"
        ));
    }
    let reason = reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("user-cancelled-before-dispatch");
    let committed =
        cancel_pre_dispatch_attempt_core(writer, &shared_session_id, &attempt_id, reason)?;
    Ok(json!({
        "status": "cancelled",
        "attemptId": attempt_id,
        "bindingKey": committed.binding_key,
        "sequence": committed.sequence,
    }))
}

/// Shared V2 control plane：只接收 durable attempt identity。
///
/// Engine / Provider / Binding / native Thread / runtime Turn 全部从
/// `turnRequested` + `SharedRuntimeCoordinator` 的同一 owner 解析。任何 owner 缺失或
/// 不一致都 fail closed；禁止回退 active Engine、当前 Picker 或 workspace-wide interrupt。
fn committed_attempt_sequence(
    writer: &SharedEventWriter,
    shared_session_id: &str,
    attempt_id: &str,
) -> Result<Option<i64>, String> {
    Ok(writer
        .events_for_session(shared_session_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|event| {
            event.fact_type == "conversation.turnCommitted"
                && event.attempt_id.as_deref() == Some(attempt_id)
        })
        .map(|event| event.sequence))
}

#[tauri::command]
pub async fn shared_session_v2_interrupt_turn(
    workspace_id: String,
    thread_id: String,
    attempt_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    if let Some(sequence) = committed_attempt_sequence(writer, &shared_session_id, &attempt_id)? {
        return Ok(json!({
            "status": "terminal-committed",
            "attemptId": attempt_id,
            "sequence": sequence,
        }));
    }
    let route = resolve_shared_attempt_interrupt_route(
        writer,
        &state.shared_runtime_coordinator,
        &workspace_id,
        &thread_id,
        &attempt_id,
    )?;

    state
        .shared_runtime_coordinator
        .mark_cancel_intent(&attempt_id)?;
    let interrupt_result: Result<(), String> = async {
        match route.engine {
            EngineType::Codex => {
                crate::shared::codex_core::turn_interrupt_core(
                    &state.sessions,
                    workspace_id.clone(),
                    route.provider_profile_id.clone(),
                    route.native_thread_id.clone(),
                    route.runtime_turn_id.clone(),
                )
                .await
                .map(|_| ())
            }
            EngineType::Claude => {
                let session = state
                    .engine_manager
                    .claude_manager
                    .get_session_for_provider(
                        &workspace_id,
                        route.provider_profile_id.as_deref(),
                    )
                    .await
                    .ok_or_else(|| {
                        format!(
                            "shared-control-owner-unavailable: Claude runtime missing for attempt {}",
                            route.attempt_id
                        )
                    })?;
                if !session.has_active_turn(&route.runtime_turn_id).await {
                    return Err(format!(
                        "shared-control-owner-unavailable: Claude runtime turn missing for attempt {}",
                        route.attempt_id
                    ));
                }
                session.interrupt_turn(&route.runtime_turn_id).await
            }
            EngineType::OpenCode => {
                let runtime_key = provider_runtime_key_for_target(
                    &workspace_id,
                    route.engine,
                    route.provider_profile_id.as_deref(),
                )?;
                let session = state
                    .engine_manager
                    .get_opencode_session_for_runtime(&runtime_key)
                    .await
                    .ok_or_else(|| {
                        format!(
                            "shared-control-owner-unavailable: OpenCode runtime missing for attempt {}",
                            route.attempt_id
                        )
                    })?;
                session.interrupt_turn(&route.runtime_turn_id).await
            }
            EngineType::Kimi => {
                let runtime_key = provider_runtime_key_for_target(
                    &workspace_id,
                    route.engine,
                    route.provider_profile_id.as_deref(),
                )?;
                let session = state
                    .engine_manager
                    .get_kimi_session_for_runtime(&runtime_key)
                    .await
                    .ok_or_else(|| {
                        format!(
                            "shared-control-owner-unavailable: Kimi runtime missing for attempt {}",
                            route.attempt_id
                        )
                    })?;
                session.interrupt_turn(&route.runtime_turn_id).await
            }
            EngineType::Grok => {
                let runtime_key = provider_runtime_key_for_target(
                    &workspace_id,
                    route.engine,
                    route.provider_profile_id.as_deref(),
                )?;
                let session = state
                    .engine_manager
                    .get_grok_session_for_runtime(&runtime_key)
                    .await
                    .ok_or_else(|| {
                        format!(
                            "shared-control-owner-unavailable: Grok runtime missing for attempt {}",
                            route.attempt_id
                        )
                    })?;
                session.interrupt_turn(&route.runtime_turn_id).await
            }
            unsupported => Err(format!(
                "target-unavailable: unsupported Shared interrupt engine {}",
                unsupported.icon()
            )),
        }
    }
    .await;
    if let Err(error) = interrupt_result {
        state
            .shared_runtime_coordinator
            .clear_cancel_intent(&attempt_id);
        return Err(error);
    }

    Ok(json!({
        "status": "interrupted",
        "attemptId": route.attempt_id,
        "engine": route.engine,
        "bindingKey": route.binding_key,
        "nativeThreadId": route.native_thread_id,
        "runtimeTurnId": route.runtime_turn_id,
    }))
}

fn recovery_disposition(
    evidence: &UnresolvedAttemptEvidence,
    coordinator: &crate::shared_runtime_coordinator::SharedRuntimeCoordinator,
) -> &'static str {
    let attempt_id = &evidence.owner.requested.attempt_id;
    if coordinator.settled_for_attempt(attempt_id).is_some() {
        "terminal"
    } else if evidence.accepted && coordinator.owns_attempt(attempt_id) {
        "active"
    } else if !evidence.accepted
        && (!evidence.delivery_prepared || evidence.pending_phase.as_deref() == Some("prepared"))
    {
        "not-accepted"
    } else {
        "unknown"
    }
}

fn active_recovery_response(
    writer: &SharedEventWriter,
    coordinator: &crate::shared_runtime_coordinator::SharedRuntimeCoordinator,
    workspace_id: &str,
    thread_id: &str,
    evidence: &UnresolvedAttemptEvidence,
) -> Result<Option<Value>, String> {
    let attempt_id = &evidence.owner.requested.attempt_id;
    if !evidence.accepted || !coordinator.owns_attempt(attempt_id) {
        return Ok(None);
    }
    let route = resolve_shared_attempt_interrupt_route(
        writer,
        coordinator,
        workspace_id,
        thread_id,
        attempt_id,
    )?;
    Ok(Some(json!({
        "status": "active",
        "attemptId": route.attempt_id,
        "bindingKey": route.binding_key,
        "nativeThreadId": route.native_thread_id,
        "runtimeTurnId": route.runtime_turn_id,
        "executionTargetSnapshot": evidence.owner.requested.target,
    })))
}

/// Attempt-first recovery mutation。Probe 只是 UI 动作名；Backend 必须重新读取
/// durable evidence，并且只在强证据下落 Terminal Fact 后返回可解锁状态。
#[tauri::command]
pub async fn shared_session_v2_recover_attempt(
    workspace_id: String,
    thread_id: String,
    attempt_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let evidence = unresolved_attempt_evidence(writer, &shared_session_id, None)?
        .into_iter()
        .find(|evidence| evidence.owner.requested.attempt_id == attempt_id);
    let Some(evidence) = evidence else {
        let already_committed = writer
            .events_for_session(&shared_session_id)
            .map_err(|error| error.to_string())?
            .iter()
            .any(|event| {
                event.fact_type == "conversation.turnCommitted"
                    && event.attempt_id.as_deref() == Some(attempt_id.as_str())
            });
        return if already_committed {
            Ok(json!({
                "status": "terminal-committed",
                "attemptId": attempt_id,
            }))
        } else {
            Err(format!("recovery-owner-missing: attempt {attempt_id}"))
        };
    };
    let binding_key = evidence.owner.binding_key.clone();
    if let Some(settled) = state
        .shared_runtime_coordinator
        .settled_for_attempt(&attempt_id)
    {
        let committed = commit_observed_runtime_settlement(&state, settled)?;
        return Ok(json!({
            "status": "terminal-committed",
            "attemptId": attempt_id,
            "bindingKey": committed.binding_key,
            "sequence": committed.sequence,
        }));
    }
    if let Some(active) = active_recovery_response(
        writer,
        &state.shared_runtime_coordinator,
        &workspace_id,
        &thread_id,
        &evidence,
    )? {
        return Ok(active);
    }
    if recovery_disposition(&evidence, &state.shared_runtime_coordinator) == "not-accepted" {
        let committed = commit_runtime_snapshot_core(
            writer,
            &shared_session_id,
            &attempt_id,
            recovery_terminal_snapshot(OutcomeStatus::Cancelled, "probe-not-accepted"),
            None,
        )?;
        state.shared_runtime_coordinator.remove_attempt(&attempt_id);
        return Ok(json!({
            "status": "not-accepted-committed",
            "attemptId": attempt_id,
            "bindingKey": committed.binding_key,
            "sequence": committed.sequence,
        }));
    }
    Ok(json!({
        "status": "unknown",
        "attemptId": attempt_id,
        "bindingKey": binding_key,
        "pendingPhase": evidence.pending_phase,
    }))
}

/// 用户显式重建：归档旧 Binding（durable 留痕），新 Native Session 重新 provisioning。
/// Shared Session Identity 不变；committed cursor 清空（新 binding 未消费任何历史）。
#[tauri::command]
pub async fn shared_session_v2_rebuild_binding(
    workspace_id: String,
    thread_id: String,
    binding_key: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let unresolved = unresolved_attempt_evidence(writer, &shared_session_id, Some(&binding_key))?;
    if unresolved.len() > 1 {
        return Err(format!(
            "recovery-owner-ambiguous: binding {binding_key} has {} unresolved attempts",
            unresolved.len()
        ));
    }
    if let Some(evidence) = unresolved.first() {
        let attempt_id = &evidence.owner.requested.attempt_id;
        if let Some(settled) = state
            .shared_runtime_coordinator
            .settled_for_attempt(attempt_id)
        {
            commit_observed_runtime_settlement(&state, settled)?;
        } else if state.shared_runtime_coordinator.owns_attempt(attempt_id) {
            // 结构化前缀供前端映射 i18n；message 保留兼容旧 startsWith 解析。
            return Err(format!(
                "recovery-active: attempt {attempt_id} is still owned by Runtime; Probe/Stop before rebuild"
            ));
        }
    }
    let rebuilt = rebuild_binding_core(writer, &shared_session_id, &binding_key)?;
    for attempt_id in &rebuilt.replaced_attempt_ids {
        state.shared_runtime_coordinator.remove_attempt(attempt_id);
    }

    Ok(json!({
        "status": PROVISIONING_PREPARED,
        "bindingKey": binding_key,
        "nativeThreadId": Value::Null,
        "archivedNativeSessionId": rebuilt.archived_native_session_id,
        "replacedAttemptIds": rebuilt.replaced_attempt_ids,
        "bindingOperationId": rebuilt.binding_operation_id,
    }))
}

/// 用户显式「放弃本轮」：把唯一未决 Attempt durable 结算为 cancelled，
/// 并在无更多 unresolved 时清除 binding 的 recovery-required，使会话可重新发送。
///
/// Fail-closed：
/// - Runtime 仍 own attempt 且 `force_stop=false` → 拒绝（须先 Stop）
/// - 多 owner → ambiguous 拒绝
/// - 已 committed → 幂等返回 terminal-committed
pub fn abandon_unresolved_attempt_core(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
    stop_reason: &str,
) -> Result<CommitTurnOutcome, String> {
    let committed = commit_runtime_snapshot_core(
        writer,
        session_id,
        attempt_id,
        recovery_terminal_snapshot(OutcomeStatus::Cancelled, stop_reason),
        None,
    )?;
    clear_binding_recovery_if_idle(writer, session_id, &committed.binding_key)?;
    Ok(committed)
}

/// 当 binding 无 unresolved attempt 且 provisioning=recovery-required 时，
/// 回落 prepared（无 native）或 ready（有 native），避免「attempt 已结算但仍锁 begin」。
fn clear_binding_recovery_if_idle(
    writer: &SharedEventWriter,
    session_id: &str,
    binding_key: &str,
) -> Result<(), String> {
    let remaining = unresolved_attempt_evidence(writer, session_id, Some(binding_key))?;
    if !remaining.is_empty() {
        return Ok(());
    }
    let existing = match writer
        .binding_state(session_id, binding_key)
        .map_err(|error| error.to_string())?
    {
        Some(row) => row,
        None => return Ok(()),
    };
    if provisioning_state_of(&existing) != PROVISIONING_RECOVERY_REQUIRED {
        return Ok(());
    }
    let engine = serde_json::from_value::<EngineType>(Value::String(existing.engine.clone()))
        .map_err(|_| {
            format!(
                "binding {binding_key} has unsupported engine '{}'",
                existing.engine
            )
        })
        .and_then(ensure_supported_shared_session_engine)?;
    let has_native = existing
        .native_session_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let next_state = if has_native {
        PROVISIONING_READY
    } else {
        PROVISIONING_PREPARED
    };
    let availability = if has_native { "ready" } else { "provisioning" };
    upsert_binding_row(
        writer,
        session_id,
        binding_key,
        engine,
        existing.provider_profile_id.clone(),
        Some(&existing),
        None,
        None,
        // abandon 后即使保留 native，也不得盲信历史 → dirty。
        provisioning_json(
            next_state,
            Some("recovery-cleared-after-abandon"),
            None,
            binding_operation_id_of(&existing).as_deref(),
            Some(&existing),
            Some(NativeContextTrust::Dirty),
        ),
        availability,
    )
    .map_err(|error| error.to_string())?;
    append_control_fact(
        writer,
        session_id,
        "binding.recovery-cleared",
        Some(binding_key),
        Some("user-abandon-unresolved"),
    )?;
    Ok(())
}

/// 用户显式放弃未决 Attempt（durable cancel）。可选 `force_stop`：在 Runtime own 时先 interrupt。
///
/// 可完成出口合同（OpenSpec recovery exit / § interrupt capability missing）：
/// - `force_stop=false` 且 Runtime own → 拒绝（须先 Stop 或显式 force）
/// - `force_stop=true` → best-effort interrupt；**interrupt 失败也必须 durable cancel + 清 coordinator**
///   （否则停不掉时「跳过本轮」会永久锁死会话）
#[tauri::command]
pub async fn shared_session_v2_abandon_unresolved_attempt(
    workspace_id: String,
    thread_id: String,
    attempt_id: Option<String>,
    force_stop: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let force_stop = force_stop.unwrap_or(false);

    let unresolved = unresolved_attempt_evidence(writer, &shared_session_id, None)?;
    let attempt_id = match attempt_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(requested) => {
            if !unresolved
                .iter()
                .any(|evidence| evidence.owner.requested.attempt_id == requested)
            {
                // 幂等：若已 terminal-committed，返回已提交。
                if let Some(sequence) =
                    committed_attempt_sequence(writer, &shared_session_id, requested)?
                {
                    return Ok(json!({
                        "status": "terminal-committed",
                        "attemptId": requested,
                        "sequence": sequence,
                    }));
                }
                return Err(format!(
                    "recovery-owner-missing: attempt {requested} is not unresolved"
                ));
            }
            requested.to_string()
        }
        None => {
            if unresolved.is_empty() {
                return Ok(json!({
                    "status": "clear",
                    "reason": "no-unresolved-attempt",
                }));
            }
            if unresolved.len() > 1 {
                return Err(format!(
                    "recovery-owner-ambiguous: session has {} unresolved attempts",
                    unresolved.len()
                ));
            }
            unresolved[0].owner.requested.attempt_id.clone()
        }
    };

    if let Some(sequence) = committed_attempt_sequence(writer, &shared_session_id, &attempt_id)? {
        return Ok(json!({
            "status": "terminal-committed",
            "attemptId": attempt_id,
            "sequence": sequence,
        }));
    }

    let owned = state.shared_runtime_coordinator.owns_attempt(&attempt_id);
    let mut interrupt_warning: Option<String> = None;
    if owned {
        if !force_stop {
            return Err(format!(
                "recovery-active-requires-stop: attempt {attempt_id} is still owned by Runtime; Stop before abandon or pass forceStop"
            ));
        }
        // force_stop：best-effort interrupt。失败不阻断 durable abandon（可完成出口）。
        // 迟到 terminal 由 generation/terminal 冲突吸收，不得复活已 cancel 的 attempt。
        match shared_session_v2_interrupt_turn(
            workspace_id.clone(),
            thread_id.clone(),
            attempt_id.clone(),
            state.clone(),
        )
        .await
        {
            Ok(_) => {}
            Err(error) => {
                interrupt_warning = Some(error);
            }
        }
        // 不立即 remove_attempt —— 先检查 settled_for_attempt，
        // 以防 interrupt 与真实完成竞态导致 settled 证据被误删。
    }

    // 必须在 remove_attempt 之前读取：remove_attempt 会清掉 settled_by_attempt。
    // 场景：interrupt 调用时，后端恰好刚完成并写入 settled 证据，
    // 此时不应丢弃该证据（否则会丢失已完成的助手回复）。
    if let Some(settled) = state
        .shared_runtime_coordinator
        .settled_for_attempt(&attempt_id)
    {
        // 清理 coordinator 跟踪（不再需要）
        state.shared_runtime_coordinator.remove_attempt(&attempt_id);
        let committed = commit_observed_runtime_settlement(&state, settled)?;
        clear_binding_recovery_if_idle(writer, &shared_session_id, &committed.binding_key)?;
        return Ok(json!({
            "status": "terminal-committed",
            "attemptId": attempt_id,
            "bindingKey": committed.binding_key,
            "sequence": committed.sequence,
            "interruptWarning": interrupt_warning,
        }));
    }

    // 未 settled：强制清 coordinator 跟踪（含 force_stop 且 interrupt 失败），再 durable cancel。
    // 否则 Runtime own 会永久挡住 rebuild，跳过也无法解锁。
    state.shared_runtime_coordinator.remove_attempt(&attempt_id);

    let committed = abandon_unresolved_attempt_core(
        writer,
        &shared_session_id,
        &attempt_id,
        if interrupt_warning.is_some() {
            "user-abandon-unresolved-force-after-interrupt-fail"
        } else {
            "user-abandon-unresolved"
        },
    )?;
    // abandon_unresolved_attempt_core 不负责 coordinator；最终再清一次（幂等）。
    state.shared_runtime_coordinator.remove_attempt(&attempt_id);

    Ok(json!({
        "status": "cancelled-committed",
        "attemptId": attempt_id,
        "bindingKey": committed.binding_key,
        "sequence": committed.sequence,
        "duplicate": committed.duplicate,
        "interruptWarning": interrupt_warning,
        "forcedAfterInterruptFailure": interrupt_warning.is_some(),
    }))
}

/// Probe（B.4.3）：读取 durable evidence 供前端定性（active / terminal / not-accepted）。
/// 不触碰 runtime，不修改任何状态。
#[tauri::command]
pub async fn shared_session_v2_probe_binding(
    workspace_id: String,
    thread_id: String,
    binding_key: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;

    let existing = writer
        .binding_state(&shared_session_id, &binding_key)
        .map_err(|error| error.to_string())?;
    let in_flight = unresolved_attempt_evidence(writer, &shared_session_id, Some(&binding_key))?;
    let native_probe = match existing.as_ref() {
        Some(row) if row.engine == EngineType::Claude.icon() => {
            let session = state
                .engine_manager
                .claude_manager
                .get_session_for_provider(&workspace_id, row.provider_profile_id.as_deref())
                .await;
            match session {
                Some(session) => {
                    let runtime_session_id = session.get_session_id().await;
                    let expected_session_id = row
                        .native_session_id
                        .as_deref()
                        .and_then(|value| value.strip_prefix("claude:"))
                        .or(row.native_session_id.as_deref());
                    json!({
                        "status": if runtime_session_id.as_deref() == expected_session_id { "matched" } else { "mismatch" },
                        "runtimeSessionId": runtime_session_id,
                        "activeProcessIds": session.active_process_ids().await,
                    })
                }
                None => json!({ "status": "runtime-missing" }),
            }
        }
        Some(row) if row.engine == EngineType::Codex.icon() => {
            let provider = row.provider_profile_id.as_deref().unwrap_or("__disk__");
            let runtime_key =
                crate::codex::provider_profile::codex_runtime_key(&workspace_id, provider);
            let session = state.sessions.lock().await.get(&runtime_key).cloned();
            match session {
                Some(session) => {
                    let health = session.probe_health(Duration::from_secs(2)).await;
                    json!({
                        "status": if health.is_ok() { "matched" } else { "runtime-unhealthy" },
                        "runtimeKey": runtime_key,
                        "detail": health.err(),
                    })
                }
                None => json!({ "status": "runtime-missing", "runtimeKey": runtime_key }),
            }
        }
        Some(row) if row.engine == EngineType::OpenCode.icon() => {
            let runtime_key = provider_runtime_key_for_target(
                &workspace_id,
                EngineType::OpenCode,
                row.provider_profile_id.as_deref(),
            )?;
            match state
                .engine_manager
                .get_opencode_session_for_runtime(&runtime_key)
                .await
            {
                Some(session) => {
                    let runtime_session_id = session.get_session_id().await;
                    let expected_session_id = row
                        .native_session_id
                        .as_deref()
                        .and_then(|value| raw_engine_session_id(EngineType::OpenCode, value));
                    json!({
                        "status": if runtime_session_id.as_deref() == expected_session_id {
                            "matched"
                        } else if expected_session_id
                            .is_some_and(|value| value.starts_with("opencode-pending-shared-"))
                        {
                            "runtime-created-awaiting-session"
                        } else {
                            "mismatch"
                        },
                        "runtimeKey": runtime_key,
                        "runtimeSessionId": runtime_session_id,
                    })
                }
                None => json!({ "status": "runtime-missing", "runtimeKey": runtime_key }),
            }
        }
        Some(row) if row.engine == EngineType::Kimi.icon() => {
            let runtime_key = provider_runtime_key_for_target(
                &workspace_id,
                EngineType::Kimi,
                row.provider_profile_id.as_deref(),
            )?;
            match state
                .engine_manager
                .get_kimi_session_for_runtime(&runtime_key)
                .await
            {
                Some(session) => {
                    let runtime_session_id = session.get_session_id().await;
                    let expected_session_id = row
                        .native_session_id
                        .as_deref()
                        .and_then(|value| raw_engine_session_id(EngineType::Kimi, value));
                    json!({
                        "status": if runtime_session_id.as_deref() == expected_session_id {
                            "matched"
                        } else if expected_session_id
                            .is_some_and(|value| value.starts_with("kimi-pending-shared-"))
                        {
                            "runtime-created-awaiting-session"
                        } else {
                            "mismatch"
                        },
                        "runtimeKey": runtime_key,
                        "runtimeSessionId": runtime_session_id,
                    })
                }
                None => json!({ "status": "runtime-missing", "runtimeKey": runtime_key }),
            }
        }
        Some(row) if row.engine == EngineType::Grok.icon() => {
            let runtime_key = provider_runtime_key_for_target(
                &workspace_id,
                EngineType::Grok,
                row.provider_profile_id.as_deref(),
            )?;
            match state
                .engine_manager
                .get_grok_session_for_runtime(&runtime_key)
                .await
            {
                Some(session) => {
                    let runtime_session_id = session.get_session_id().await;
                    let expected_session_id = row
                        .native_session_id
                        .as_deref()
                        .and_then(|value| raw_engine_session_id(EngineType::Grok, value));
                    json!({
                        "status": if runtime_session_id.as_deref() == expected_session_id {
                            "matched"
                        } else if expected_session_id
                            .is_some_and(|value| value.starts_with("grok-pending-shared-"))
                        {
                            "runtime-created-awaiting-session"
                        } else {
                            "mismatch"
                        },
                        "runtimeKey": runtime_key,
                        "runtimeSessionId": runtime_session_id,
                    })
                }
                None => json!({ "status": "runtime-missing", "runtimeKey": runtime_key }),
            }
        }
        Some(_) => json!({ "status": "unsupported-engine" }),
        None => json!({ "status": "binding-missing" }),
    };

    Ok(json!({
        "status": "ok",
        "bindingKey": binding_key,
        "provisioningState": existing.as_ref().map(provisioning_state_of),
        "nativeSessionId": existing.as_ref().and_then(|row| row.native_session_id.clone()),
        "committedThroughSequence": existing.as_ref().and_then(|row| row.committed_through_sequence),
        "nativeProbe": native_probe,
        "inFlightAttempts": in_flight
            .iter()
            .map(|evidence| {
                let attempt_id = &evidence.owner.requested.attempt_id;
                json!({
                "attemptId": attempt_id,
                "logicalTurnId": evidence.owner.requested.logical_turn_id,
                "bindingKey": evidence.owner.binding_key,
                "bindingOperationId": evidence.owner.binding_operation_id,
                "accepted": evidence.accepted,
                "deliveryPrepared": evidence.delivery_prepared,
                "pendingPhase": evidence.pending_phase,
                "recoveryDisposition": recovery_disposition(
                    evidence,
                    &state.shared_runtime_coordinator,
                ),
                // Runtime owner 只在内存存在。重启后 durable accepted 仍在、owner 已丢失，
                // frontend 必须进入 recovery-required，不能伪装仍在 running。
                "runtimeObserverOwned": state
                    .shared_runtime_coordinator
                    .owns_attempt(attempt_id),
            })})
            .collect::<Vec<_>>(),
    }))
}

/// 重启恢复（B.6.5）：返回 durable evidence，前端据此恢复 running/settling/recovery-required，
/// 而不是落回 idle。只读。
#[tauri::command]
pub async fn shared_session_v2_turn_state(
    workspace_id: String,
    thread_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;

    let events = writer
        .events_for_session(&shared_session_id)
        .map_err(|error| error.to_string())?;
    let in_flight = unresolved_attempt_evidence(writer, &shared_session_id, None)?;
    let mut binding_keys = std::collections::HashSet::new();
    binding_keys.extend(
        in_flight
            .iter()
            .map(|evidence| evidence.owner.binding_key.clone()),
    );
    for event in &events {
        if let Ok(payload) = serde_json::from_str::<Value>(&event.payload_json) {
            if let Some(binding_key) = payload.get("bindingKey").and_then(Value::as_str) {
                binding_keys.insert(binding_key.to_string());
            }
        }
    }

    let mut bindings = Vec::new();
    for binding_key in binding_keys {
        if let Some(row) = writer
            .binding_state(&shared_session_id, &binding_key)
            .map_err(|error| error.to_string())?
        {
            bindings.push(json!({
                "bindingKey": row.binding_key,
                "provisioningState": provisioning_state_of(&row),
                "availability": row.availability,
            }));
        }
    }

    Ok(json!({
        "status": "ok",
        "inFlightAttempts": in_flight
            .iter()
            .map(|evidence| {
                let attempt_id = &evidence.owner.requested.attempt_id;
                json!({
                "attemptId": attempt_id,
                "logicalTurnId": evidence.owner.requested.logical_turn_id,
                "bindingKey": evidence.owner.binding_key,
                "bindingOperationId": evidence.owner.binding_operation_id,
                "accepted": evidence.accepted,
                "deliveryPrepared": evidence.delivery_prepared,
                "pendingPhase": evidence.pending_phase,
                "recoveryDisposition": recovery_disposition(
                    evidence,
                    &state.shared_runtime_coordinator,
                ),
                "runtimeObserverOwned": state
                    .shared_runtime_coordinator
                    .owns_attempt(attempt_id),
            })})
            .collect::<Vec<_>>(),
        "bindings": bindings,
    }))
}

#[cfg(test)]
mod legacy_import_tests {
    use super::*;
    use crate::shared_event_log::{open, Fidelity, OpenOutcome};

    #[test]
    fn legacy_snapshot_import_is_fingerprinted_and_idempotent() {
        let root = std::env::temp_dir().join(format!(
            "mossx-shared-legacy-import-{}-{}",
            std::process::id(),
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).expect("create test root");
        let writer = match open(&root.join("events.db")).expect("open store") {
            OpenOutcome::Ready(writer) => writer,
            OpenOutcome::ReadOnlyRecovery { reason, .. } => {
                panic!("unexpected recovery store: {reason}")
            }
        };
        let source_path = root.join("log.jsonl");
        let items = vec![
            json!({
                "id": "legacy-user-1",
                "kind": "message",
                "role": "user",
                "text": "legacy question",
                "turnId": "legacy-turn-1"
            }),
            json!({
                "id": "legacy-assistant-1",
                "kind": "message",
                "role": "assistant",
                "text": "legacy answer",
                "turnId": "legacy-turn-1",
                "isFinal": true
            }),
        ];

        for _ in 0..2 {
            import_legacy_snapshot_items(
                &writer,
                "legacy-session",
                &source_path,
                &items,
                EngineType::Claude,
                42,
            )
            .expect("import snapshot");
        }

        let events = writer
            .events_for_session("legacy-session")
            .expect("legacy events");
        assert_eq!(events.len(), 2);
        assert!(events
            .iter()
            .all(|event| event.fidelity == Fidelity::PresentationOnly));
        let marker = writer
            .legacy_import("legacy-session")
            .expect("read marker")
            .expect("marker");
        assert_eq!(marker.status, "completed");
        assert!(marker
            .imported_through_marker
            .as_deref()
            .is_some_and(|value| value.starts_with("snapshot-items:2:sha256:")));

        writer.shutdown().expect("shutdown writer");
        std::fs::remove_dir_all(root).expect("remove test root");
    }
}

#[cfg(test)]
mod shared_interrupt_owner_tests {
    use super::*;
    use crate::shared_event_log::{open, OpenOutcome, SessionTargetUpdate};
    use crate::shared_runtime_coordinator::{SharedRuntimeAttemptOwner, SharedRuntimeCoordinator};
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn open_test_writer(tag: &str) -> (PathBuf, SharedEventWriter) {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let root = std::env::temp_dir().join(format!(
            "mossx-shared-interrupt-{tag}-{}-{nonce}",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("create test root");
        let writer = match open(&root.join("shared-events.db")).expect("open store") {
            OpenOutcome::Ready(writer) => writer,
            OpenOutcome::ReadOnlyRecovery { reason, .. } => {
                panic!("unexpected recovery store: {reason}")
            }
        };
        (root, writer)
    }

    fn target(engine: EngineType, provider: &str) -> ExecutionTargetInput {
        ExecutionTargetInput {
            engine,
            provider_profile_id: Some(provider.to_string()),
            model_catalog_entry_id: Some(format!("{provider}-catalog-model")),
            model: Some(match engine {
                EngineType::Claude => "claude-sonnet-4-5".to_string(),
                EngineType::Codex => "gpt-5-codex".to_string(),
                EngineType::Kimi => "kimi-k2".to_string(),
                EngineType::Grok => "ccgui/grok-4.5".to_string(),
                EngineType::OpenCode => "ccgui/opencode-model".to_string(),
                EngineType::Gemini => "unsupported".to_string(),
            }),
            reasoning_effort: Some("medium".to_string()),
            provider_profile_name_snapshot: Some(provider.to_string()),
            provider_profile_source: Some(CanonicalProviderProfileSource::Managed),
            runtime_capability_fingerprint: None,
        }
    }

    fn assert_route(engine: EngineType, provider: &str) {
        let session_id = format!("interrupt-{provider}");
        let shared_thread_id = format!("shared:{session_id}");
        let (root, writer) = open_test_writer(provider);
        let begin = begin_turn_core(
            &writer,
            &session_id,
            &target(engine, provider),
            "hello".to_string(),
            None,
        )
        .expect("begin");
        let attempt_id = begin.attempt_id.expect("attempt");
        let logical_turn_id = begin.logical_turn_id.expect("logical turn");
        let binding_key = begin.binding_key;
        let snapshot = begin.snapshot.expect("snapshot");
        let binding_operation_id = durable_attempt_owner(&writer, &session_id, &attempt_id)
            .expect("durable owner")
            .binding_operation_id;
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(SharedRuntimeAttemptOwner {
                workspace_id: "ws-1".to_string(),
                provider_runtime_key: provider_runtime_key_for_target(
                    "ws-1",
                    engine,
                    Some(provider),
                )
                .expect("provider runtime key"),
                shared_session_id: session_id,
                shared_thread_id: shared_thread_id.clone(),
                logical_turn_id,
                attempt_id: attempt_id.clone(),
                binding_key: binding_key.clone(),
                binding_operation_id,
                engine,
                execution_target_snapshot: snapshot,
                native_session_id: Some(format!("native-{provider}")),
                runtime_turn_id: Some(format!("run-{provider}")),
                context_marker: None,
            })
            .expect("register owner");

        let route = resolve_shared_attempt_interrupt_route(
            &writer,
            &coordinator,
            "ws-1",
            &shared_thread_id,
            &attempt_id,
        )
        .expect("resolve route");
        assert_eq!(route.engine, engine);
        assert_eq!(route.provider_profile_id.as_deref(), Some(provider));
        assert_eq!(route.binding_key, binding_key);
        // 与 SharedRuntimeCoordinator::normalize_native_session_identity 对齐：
        // Claude/Kimi/Grok/OpenCode 使用 engine: 前缀；Codex 保持 raw。
        let expected_native_thread_id = match engine {
            EngineType::Claude | EngineType::Kimi | EngineType::Grok | EngineType::OpenCode => {
                format!("{}:native-{provider}", engine.icon())
            }
            EngineType::Codex | EngineType::Gemini => format!("native-{provider}"),
        };
        assert_eq!(route.native_thread_id, expected_native_thread_id);
        assert_eq!(route.runtime_turn_id, format!("run-{provider}"));

        coordinator.remove_attempt(&attempt_id);
        writer.shutdown().expect("shutdown writer");
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn active_recovery_returns_exact_accepted_owner_envelope() {
        let session_id = "recovery-active-owner";
        let shared_thread_id = format!("shared:{session_id}");
        let provider = "provider-active";
        let active_target = target(EngineType::Codex, provider);
        let (root, writer) = open_test_writer("recovery-active-owner");
        let begin = begin_turn_core(
            &writer,
            session_id,
            &active_target,
            "hello".to_string(),
            None,
        )
        .expect("begin");
        let attempt_id = begin.attempt_id.expect("attempt");
        let logical_turn_id = begin.logical_turn_id.expect("logical turn");
        let binding_key = begin.binding_key;
        let snapshot = begin.snapshot.expect("snapshot");
        let binding_operation_id = durable_attempt_owner(&writer, session_id, &attempt_id)
            .expect("durable owner")
            .binding_operation_id;
        accept_turn_core(
            &writer,
            session_id,
            &attempt_id,
            &logical_turn_id,
            &active_target,
            "native-active",
        )
        .expect("accept");
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(SharedRuntimeAttemptOwner {
                workspace_id: "ws-1".to_string(),
                provider_runtime_key: provider_runtime_key_for_target(
                    "ws-1",
                    EngineType::Codex,
                    Some(provider),
                )
                .expect("provider runtime key"),
                shared_session_id: session_id.to_string(),
                shared_thread_id: shared_thread_id.clone(),
                logical_turn_id,
                attempt_id: attempt_id.clone(),
                binding_key: binding_key.clone(),
                binding_operation_id,
                engine: EngineType::Codex,
                execution_target_snapshot: snapshot,
                native_session_id: Some("native-active".to_string()),
                runtime_turn_id: Some("run-active".to_string()),
                context_marker: None,
            })
            .expect("register owner");
        let evidence = unresolved_attempt_evidence(&writer, session_id, None)
            .expect("read evidence")
            .into_iter()
            .find(|evidence| evidence.owner.requested.attempt_id == attempt_id)
            .expect("unresolved accepted attempt");

        assert_eq!(recovery_disposition(&evidence, &coordinator), "active");
        let response =
            active_recovery_response(&writer, &coordinator, "ws-1", &shared_thread_id, &evidence)
                .expect("resolve active recovery")
                .expect("active response");
        assert_eq!(
            response.get("attemptId").and_then(Value::as_str),
            Some(attempt_id.as_str())
        );
        assert_eq!(
            response.get("bindingKey").and_then(Value::as_str),
            Some(binding_key.as_str())
        );
        assert_eq!(
            response.get("nativeThreadId").and_then(Value::as_str),
            Some("native-active")
        );
        assert_eq!(
            response.get("runtimeTurnId").and_then(Value::as_str),
            Some("run-active")
        );
        assert_eq!(
            response
                .pointer("/executionTargetSnapshot/providerProfileId")
                .and_then(Value::as_str),
            Some(provider)
        );

        coordinator.remove_attempt(&attempt_id);
        writer.shutdown().expect("shutdown writer");
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn preaccepted_runtime_owner_is_not_reported_active() {
        let session_id = "recovery-preaccepted-owner";
        let shared_thread_id = format!("shared:{session_id}");
        let provider = "provider-preaccepted";
        let (root, writer) = open_test_writer("recovery-preaccepted-owner");
        let begin = begin_turn_core(
            &writer,
            session_id,
            &target(EngineType::Codex, provider),
            "hello".to_string(),
            None,
        )
        .expect("begin");
        let attempt_id = begin.attempt_id.expect("attempt");
        let binding_operation_id = durable_attempt_owner(&writer, session_id, &attempt_id)
            .expect("durable owner")
            .binding_operation_id;
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(SharedRuntimeAttemptOwner {
                workspace_id: "ws-1".to_string(),
                provider_runtime_key: provider_runtime_key_for_target(
                    "ws-1",
                    EngineType::Codex,
                    Some(provider),
                )
                .expect("provider runtime key"),
                shared_session_id: session_id.to_string(),
                shared_thread_id: shared_thread_id.clone(),
                logical_turn_id: begin.logical_turn_id.expect("logical turn"),
                attempt_id: attempt_id.clone(),
                binding_key: begin.binding_key,
                binding_operation_id,
                engine: EngineType::Codex,
                execution_target_snapshot: begin.snapshot.expect("snapshot"),
                native_session_id: Some("native-preaccepted".to_string()),
                runtime_turn_id: Some("run-preaccepted".to_string()),
                context_marker: None,
            })
            .expect("register owner");
        let evidence = unresolved_attempt_evidence(&writer, session_id, None)
            .expect("read evidence")
            .into_iter()
            .find(|evidence| evidence.owner.requested.attempt_id == attempt_id)
            .expect("unresolved attempt");

        assert_ne!(recovery_disposition(&evidence, &coordinator), "active");
        assert!(active_recovery_response(
            &writer,
            &coordinator,
            "ws-1",
            &shared_thread_id,
            &evidence,
        )
        .expect("resolve recovery")
        .is_none());

        coordinator.remove_attempt(&attempt_id);
        writer.shutdown().expect("shutdown writer");
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn shared_compaction_selected_target_comes_from_v2_store() {
        let session_id = "compaction-v2-target";
        let (root, writer) = open_test_writer("compaction-v2-target");
        writer
            .upsert_session_target(&SessionTargetUpdate {
                session_id: session_id.to_string(),
                schema_version: 2,
                selected_target_json: json!({
                    "engine": "claude",
                    "providerProfileId": "provider-v2"
                })
                .to_string(),
                updated_at: 1,
            })
            .expect("persist V2 Target");

        let (engine, provider_profile_id) =
            resolve_durable_shared_compaction_target(&writer, session_id)
                .expect("resolve durable target");
        assert_eq!(engine, EngineType::Claude);
        assert_eq!(provider_profile_id.as_deref(), Some("provider-v2"));

        writer.shutdown().expect("shutdown writer");
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn shared_compaction_route_prefers_unresolved_attempt_owner() {
        let session_id = "compaction-active-attempt";
        let (root, writer) = open_test_writer("compaction-active-attempt");
        let active_target = target(EngineType::Codex, "provider-active");
        let begin = begin_turn_core(
            &writer,
            session_id,
            &active_target,
            "hello".to_string(),
            None,
        )
        .expect("begin");
        let attempt_id = begin.attempt_id.expect("attempt");
        let logical_turn_id = begin.logical_turn_id.expect("logical turn");
        accept_turn_core(
            &writer,
            session_id,
            &attempt_id,
            &logical_turn_id,
            &active_target,
            "native-active",
        )
        .expect("accept");

        let route = resolve_shared_compaction_route_core(&writer, session_id, || {
            panic!("selected Target must not override an unresolved Attempt owner")
        })
        .expect("resolve compaction route");
        assert_eq!(route.engine, EngineType::Codex);
        assert_eq!(
            route.provider_profile_id.as_deref(),
            Some("provider-active")
        );
        assert_eq!(route.native_thread_id, "native-active");
        assert!(route.has_unresolved_attempt);

        writer.shutdown().expect("shutdown writer");
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn shared_compaction_route_uses_selected_target_after_commit() {
        let session_id = "compaction-selected-target";
        let (root, writer) = open_test_writer("compaction-selected-target");
        let selected_target = target(EngineType::Codex, "provider-selected");
        let begin = begin_turn_core(
            &writer,
            session_id,
            &selected_target,
            "hello".to_string(),
            None,
        )
        .expect("begin");
        let attempt_id = begin.attempt_id.expect("attempt");
        let logical_turn_id = begin.logical_turn_id.expect("logical turn");
        accept_turn_core(
            &writer,
            session_id,
            &attempt_id,
            &logical_turn_id,
            &selected_target,
            "native-selected",
        )
        .expect("accept");
        commit_turn_core(
            &writer,
            session_id,
            &attempt_id,
            &logical_turn_id,
            &selected_target,
            None,
            &CommitOutcomeInput {
                status: "completed".to_string(),
                error_code: None,
                error_message: None,
                stop_reason: None,
            },
            None,
        )
        .expect("commit");

        let route = resolve_shared_compaction_route_core(&writer, session_id, || {
            Ok((EngineType::Codex, Some("provider-selected".to_string())))
        })
        .expect("resolve selected route");
        assert_eq!(route.engine, EngineType::Codex);
        assert_eq!(route.native_thread_id, "native-selected");
        assert!(!route.has_unresolved_attempt);

        writer.shutdown().expect("shutdown writer");
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn shared_compaction_route_preserves_selected_claude_provider() {
        let session_id = "compaction-selected-claude";
        let (root, writer) = open_test_writer("compaction-selected-claude");
        let selected_target = target(EngineType::Claude, "provider-managed");
        let begin = begin_turn_core(
            &writer,
            session_id,
            &selected_target,
            "hello".to_string(),
            None,
        )
        .expect("begin");
        let attempt_id = begin.attempt_id.expect("attempt");
        let logical_turn_id = begin.logical_turn_id.expect("logical turn");
        accept_turn_core(
            &writer,
            session_id,
            &attempt_id,
            &logical_turn_id,
            &selected_target,
            "claude:native-managed",
        )
        .expect("accept");
        commit_turn_core(
            &writer,
            session_id,
            &attempt_id,
            &logical_turn_id,
            &selected_target,
            None,
            &CommitOutcomeInput {
                status: "completed".to_string(),
                error_code: None,
                error_message: None,
                stop_reason: None,
            },
            None,
        )
        .expect("commit");

        let route = resolve_shared_compaction_route_core(&writer, session_id, || {
            Ok((EngineType::Claude, Some("provider-managed".to_string())))
        })
        .expect("resolve selected Claude route");
        assert_eq!(route.engine, EngineType::Claude);
        assert_eq!(
            route.provider_profile_id.as_deref(),
            Some("provider-managed")
        );
        assert_eq!(route.native_thread_id, "claude:native-managed");
        assert!(!route.has_unresolved_attempt);

        writer.shutdown().expect("shutdown writer");
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn shared_compaction_route_rejects_unsupported_engine_before_runtime_lookup() {
        let session_id = "compaction-unsupported";
        let (root, writer) = open_test_writer("compaction-unsupported");

        let error = resolve_shared_compaction_route_core(&writer, session_id, || {
            Ok((EngineType::Kimi, Some("provider-kimi".to_string())))
        })
        .expect_err("unsupported engine must fail closed");
        assert!(error.contains("shared-compaction-unsupported"));

        writer.shutdown().expect("shutdown writer");
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn shared_interrupt_route_isolates_same_engine_provider_owners() {
        assert_route(EngineType::Claude, "provider-a");
        assert_route(EngineType::Claude, "provider-b");
        assert_route(EngineType::Codex, "provider-codex");
        assert_route(EngineType::Kimi, "provider-kimi");
        assert_route(EngineType::Grok, "provider-grok");
        assert_route(EngineType::OpenCode, "provider-opencode");
    }

    #[test]
    fn committed_attempt_is_detected_without_a_live_runtime_owner() {
        let session_id = "interrupt-already-committed";
        let (root, writer) = open_test_writer("already-committed");
        let selected_target = target(EngineType::Claude, "provider-committed");
        let begin = begin_turn_core(
            &writer,
            session_id,
            &selected_target,
            "hello".to_string(),
            None,
        )
        .expect("begin");
        let attempt_id = begin.attempt_id.expect("attempt");
        let logical_turn_id = begin.logical_turn_id.expect("logical turn");
        commit_turn_core(
            &writer,
            session_id,
            &attempt_id,
            &logical_turn_id,
            &selected_target,
            None,
            &CommitOutcomeInput {
                status: "failed".to_string(),
                error_code: Some("test-terminal".to_string()),
                error_message: Some("terminal already committed".to_string()),
                stop_reason: None,
            },
            None,
        )
        .expect("commit terminal");

        assert!(committed_attempt_sequence(&writer, session_id, &attempt_id)
            .expect("query commit")
            .is_some());

        writer.shutdown().expect("shutdown writer");
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn durable_terminal_response_projects_committed_outcome_without_runtime_owner() {
        let session_id = "await-terminal-committed";
        let (root, writer) = open_test_writer("await-terminal-committed");
        let selected_target = target(EngineType::Claude, "provider-committed");
        let begin = begin_turn_core(
            &writer,
            session_id,
            &selected_target,
            "hello".to_string(),
            None,
        )
        .expect("begin");
        let attempt_id = begin.attempt_id.expect("attempt");
        let logical_turn_id = begin.logical_turn_id.expect("logical turn");
        let binding_key = begin.binding_key;
        commit_turn_core(
            &writer,
            session_id,
            &attempt_id,
            &logical_turn_id,
            &selected_target,
            None,
            &CommitOutcomeInput {
                status: "failed".to_string(),
                error_code: Some("test-terminal".to_string()),
                error_message: Some("terminal already committed".to_string()),
                stop_reason: None,
            },
            None,
        )
        .expect("commit terminal");

        let response = committed_terminal_response(&writer, session_id, &attempt_id, &binding_key)
            .expect("query durable terminal")
            .expect("committed response");
        assert_eq!(
            response.get("status").and_then(Value::as_str),
            Some("committed")
        );
        assert_eq!(
            response
                .pointer("/terminal/outcome")
                .and_then(Value::as_str),
            Some("failed")
        );
        assert_eq!(
            response.get("bindingKey").and_then(Value::as_str),
            Some(binding_key.as_str())
        );

        writer.shutdown().expect("shutdown writer");
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn shared_interrupt_route_rejects_runtime_owner_target_drift() {
        let session_id = "interrupt-drift";
        let shared_thread_id = format!("shared:{session_id}");
        let (root, writer) = open_test_writer("owner-drift");
        let begin = begin_turn_core(
            &writer,
            session_id,
            &target(EngineType::Codex, "provider-a"),
            "hello".to_string(),
            None,
        )
        .expect("begin");
        let attempt_id = begin.attempt_id.expect("attempt");
        let binding_operation_id = durable_attempt_owner(&writer, session_id, &attempt_id)
            .expect("durable owner")
            .binding_operation_id;
        let mut poisoned_snapshot = begin.snapshot.expect("snapshot");
        poisoned_snapshot.provider_profile_id = Some("provider-b".to_string());
        let coordinator = SharedRuntimeCoordinator::default();
        coordinator
            .register_attempt(SharedRuntimeAttemptOwner {
                workspace_id: "ws-1".to_string(),
                provider_runtime_key: provider_runtime_key_for_target(
                    "ws-1",
                    EngineType::Codex,
                    Some("provider-b"),
                )
                .expect("provider runtime key"),
                shared_session_id: session_id.to_string(),
                shared_thread_id: shared_thread_id.clone(),
                logical_turn_id: begin.logical_turn_id.expect("logical turn"),
                attempt_id: attempt_id.clone(),
                binding_key: "codex:provider-b".to_string(),
                binding_operation_id,
                engine: EngineType::Codex,
                execution_target_snapshot: poisoned_snapshot,
                native_session_id: Some("native-b".to_string()),
                runtime_turn_id: Some("run-b".to_string()),
                context_marker: None,
            })
            .expect("register poisoned owner");

        let error = resolve_shared_attempt_interrupt_route(
            &writer,
            &coordinator,
            "ws-1",
            &shared_thread_id,
            &attempt_id,
        )
        .expect_err("owner drift must fail closed");
        assert!(error.contains("shared-control-owner-mismatch"));

        coordinator.remove_attempt(&attempt_id);
        writer.shutdown().expect("shutdown writer");
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn abandon_unresolved_attempt_commits_cancelled_and_clears_recovery() {
        let session_id = "abandon-unresolved";
        let provider = "provider-abandon";
        let (root, writer) = open_test_writer("abandon-unresolved");
        let begin = begin_turn_core(
            &writer,
            session_id,
            &target(EngineType::Codex, provider),
            "hello".to_string(),
            None,
        )
        .expect("begin");
        let attempt_id = begin.attempt_id.expect("attempt");
        let binding_key = begin.binding_key.clone();
        mark_recovery_core(
            &writer,
            session_id,
            &binding_key,
            EngineType::Codex,
            Some(provider.to_string()),
            Some("test-ambiguous"),
        )
        .expect("mark recovery");
        assert_eq!(
            provisioning_state_of(
                &writer
                    .binding_state(session_id, &binding_key)
                    .expect("read binding")
                    .expect("binding exists")
            ),
            PROVISIONING_RECOVERY_REQUIRED
        );

        let committed = abandon_unresolved_attempt_core(
            &writer,
            session_id,
            &attempt_id,
            "user-abandon-unresolved",
        )
        .expect("abandon");
        assert_eq!(committed.binding_key, binding_key);
        assert!(unresolved_attempt_evidence(&writer, session_id, None)
            .expect("evidence")
            .is_empty());
        assert_ne!(
            provisioning_state_of(
                &writer
                    .binding_state(session_id, &binding_key)
                    .expect("read binding")
                    .expect("binding exists")
            ),
            PROVISIONING_RECOVERY_REQUIRED
        );

        // begin 不应再被旧 recovery 挡住。
        let next = begin_turn_core(
            &writer,
            session_id,
            &target(EngineType::Codex, provider),
            "again".to_string(),
            None,
        )
        .expect("begin after abandon");
        assert_eq!(next.status, BeginTurnStatus::Creating);

        writer.shutdown().expect("shutdown writer");
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn rebuild_binding_core_settles_single_unresolved() {
        let session_id = "rebuild-single-unresolved";
        let provider = "provider-multi";
        let (root, writer) = open_test_writer("rebuild-single-unresolved");
        let first = begin_turn_core(
            &writer,
            session_id,
            &target(EngineType::Codex, provider),
            "one".to_string(),
            None,
        )
        .expect("begin first");
        let binding_key = first.binding_key.clone();
        let rebuilt = rebuild_binding_core(&writer, session_id, &binding_key).expect("rebuild");
        assert_eq!(rebuilt.replaced_attempt_ids.len(), 1);
        let binding = writer
            .binding_state(session_id, &binding_key)
            .expect("read")
            .expect("binding");
        assert_eq!(
            read_native_context_trust(&binding),
            NativeContextTrust::Dirty,
            "rebuild must mark trust dirty"
        );

        writer.shutdown().expect("shutdown writer");
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn rebuild_binding_core_allows_squad_worker_key() {
        // Squad worker keys are first-class; rebuild must clear recovery-required
        // without durable-key mismatch refusal.
        let session_id = "rebuild-squad-worker-key";
        let provider = "provider-squad";
        let (root, writer) = open_test_writer("rebuild-squad-worker-key");
        let squad_key = format!("squad:run-1:node-plan:claude:{provider}");
        mark_recovery_core(
            &writer,
            session_id,
            &squad_key,
            EngineType::Claude,
            Some(provider.to_string()),
            Some("squad-worker-binding-recovery-required"),
        )
        .expect("mark squad recovery");
        let rebuilt = rebuild_binding_core(&writer, session_id, &squad_key).expect("rebuild squad");
        assert!(rebuilt.replaced_attempt_ids.is_empty());
        let binding = writer
            .binding_state(session_id, &squad_key)
            .expect("read")
            .expect("binding");
        assert_eq!(
            provisioning_state_of(&binding),
            PROVISIONING_PREPARED,
            "squad rebuild must return provisioning to prepared"
        );

        writer.shutdown().expect("shutdown writer");
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn mark_recovery_and_failed_terminal_mark_native_context_trust_dirty() {
        let session_id = "trust-dirty-on-failure";
        let provider = "provider-trust";
        let (root, writer) = open_test_writer("trust-dirty-on-failure");
        let begin = begin_turn_core(
            &writer,
            session_id,
            &target(EngineType::Claude, provider),
            "原任务正文".to_string(),
            None,
        )
        .expect("begin");
        let attempt_id = begin.attempt_id.expect("attempt");
        let binding_key = begin.binding_key.clone();

        // 先标 trusted，模拟曾成功 accept。
        set_native_context_trust(
            &writer,
            session_id,
            &binding_key,
            NativeContextTrust::Trusted,
        )
        .expect("set trusted");
        assert_eq!(
            read_native_context_trust(
                &writer
                    .binding_state(session_id, &binding_key)
                    .expect("read")
                    .expect("binding")
            ),
            NativeContextTrust::Trusted
        );

        mark_recovery_core(
            &writer,
            session_id,
            &binding_key,
            EngineType::Claude,
            Some(provider.to_string()),
            Some("runtime-delivery-ambiguous"),
        )
        .expect("mark recovery");
        assert_eq!(
            read_native_context_trust(
                &writer
                    .binding_state(session_id, &binding_key)
                    .expect("read")
                    .expect("binding")
            ),
            NativeContextTrust::Dirty
        );

        // 失败 terminal 也保持 dirty。
        commit_runtime_snapshot_core(
            &writer,
            session_id,
            &attempt_id,
            RuntimeFinalSnapshot {
                assistant_blocks: vec![],
                assistant_text: None,
                tool_calls: vec![],
                tool_results: vec![],
                artifacts: vec![],
                provider_private_refs: vec![],
                omissions: vec![],
                outcome: OutcomeStatus::Failed,
                error_code: Some("503".to_string()),
                error_message: Some("No available accounts".to_string()),
                stop_reason: None,
            },
            Some("claude:native-trust"),
        )
        .expect("failed terminal");
        assert_eq!(
            read_native_context_trust(
                &writer
                    .binding_state(session_id, &binding_key)
                    .expect("read")
                    .expect("binding")
            ),
            NativeContextTrust::Dirty
        );

        writer.shutdown().expect("shutdown writer");
        std::fs::remove_dir_all(root).expect("remove test root");
    }

    #[test]
    fn dirty_zero_transfer_needs_history_detects_original_task() {
        // 编译层：destination-owned 清空 transfer 后，session_needs_history 仍为 true。
        use crate::shared_context::{
            is_zero_transfer_package, session_needs_history, CompileContextRequest,
            RuntimeContextCapabilities,
        };
        use crate::shared_event_log::{Fidelity, StoredEvent};

        let stored =
            |sequence: i64, event_id: &str, fact_type: &str, attempt: &str, payload: Value| {
                StoredEvent {
                    session_id: "s-needs".to_string(),
                    sequence,
                    event_id: event_id.to_string(),
                    fact_type: fact_type.to_string(),
                    logical_turn_id: Some(format!("turn-{sequence}")),
                    attempt_id: Some(attempt.to_string()),
                    dedupe_key: None,
                    payload_json: payload.to_string(),
                    payload_checksum: format!("sha256:{event_id}"),
                    fidelity: Fidelity::Canonical,
                    committed_at: sequence,
                }
            };
        let events = vec![
            stored(
                1,
                "req-1",
                "conversation.turnRequested",
                "attempt-1",
                json!({"input": {"text": "原任务正文请实现登录"}}),
            ),
            stored(
                2,
                "acc-1",
                "conversation.turnAccepted",
                "attempt-1",
                json!({"bindingKey": "claude:provider-a"}),
            ),
        ];
        let caps = RuntimeContextCapabilities {
            native_delta: false,
            structured_history_import: false,
            native_clone: false,
            user_channel_transcript: true,
            tool_history: false,
            image_history: false,
            strong_context_ack: true,
        };
        let owned = compile_context(
            &events,
            &CompileContextRequest {
                session_id: "s-needs".to_string(),
                binding_key: "claude:provider-a".to_string(),
                destination: json!({"engine": "claude"}),
                destination_native_session_id: Some("claude:native-1".to_string()),
                from_sequence_exclusive: None,
                through_sequence_inclusive: None,
                exclude_attempt_id: None,
                capabilities: caps.clone(),
                budget_estimated_tokens: None,
            },
        )
        .expect("owned compile");
        assert!(
            is_zero_transfer_package(&owned),
            "destination-owned should empty transfer"
        );
        let needs = session_needs_history(
            &events,
            &CompileContextRequest {
                session_id: "s-needs".to_string(),
                binding_key: "claude:provider-a".to_string(),
                destination: json!({"engine": "claude"}),
                destination_native_session_id: Some("claude:native-1".to_string()),
                from_sequence_exclusive: None,
                through_sequence_inclusive: None,
                exclude_attempt_id: None,
                capabilities: caps,
                budget_estimated_tokens: None,
            },
        )
        .expect("needs");
        assert!(needs, "full rematerialize must see original task");
        let rematerialized = compile_context(
            &events,
            &CompileContextRequest {
                session_id: "s-needs".to_string(),
                binding_key: "claude:provider-a".to_string(),
                destination: json!({"engine": "claude"}),
                destination_native_session_id: None,
                from_sequence_exclusive: None,
                through_sequence_inclusive: None,
                exclude_attempt_id: None,
                capabilities: RuntimeContextCapabilities {
                    native_delta: false,
                    structured_history_import: false,
                    native_clone: false,
                    user_channel_transcript: true,
                    tool_history: false,
                    image_history: false,
                    strong_context_ack: true,
                },
                budget_estimated_tokens: None,
            },
        )
        .expect("rematerialize");
        assert!(!is_zero_transfer_package(&rematerialized));
        assert!(rematerialized
            .prompt_prefix
            .contains("原任务正文请实现登录"));
    }

    #[test]
    fn dirty_non_zero_continue_only_package_still_needs_full_rematerialize() {
        // 图1 P0：accepted 之后有未 Accepted 的「继续」turnRequested → 增量 package 非空
        // 但缺原任务；dirty 时仍必须判定 needs_history 并全量 rematerialize。
        use crate::shared_context::{
            is_zero_transfer_package, session_needs_history, CompileContextRequest,
            RuntimeContextCapabilities,
        };
        use crate::shared_event_log::{Fidelity, StoredEvent};

        let stored =
            |sequence: i64, event_id: &str, fact_type: &str, attempt: &str, payload: Value| {
                StoredEvent {
                    session_id: "s-continue-only".to_string(),
                    sequence,
                    event_id: event_id.to_string(),
                    fact_type: fact_type.to_string(),
                    logical_turn_id: Some(format!("turn-{sequence}")),
                    attempt_id: Some(attempt.to_string()),
                    dedupe_key: None,
                    payload_json: payload.to_string(),
                    payload_checksum: format!("sha256:{event_id}"),
                    fidelity: Fidelity::Canonical,
                    committed_at: sequence,
                }
            };
        let events = vec![
            stored(
                1,
                "req-orig",
                "conversation.turnRequested",
                "attempt-orig",
                json!({"input": {"text": "原任务：实现登录并写测试"}}),
            ),
            stored(
                2,
                "acc-orig",
                "conversation.turnAccepted",
                "attempt-orig",
                json!({"bindingKey": "claude:provider-a"}),
            ),
            // 失败轮：只有 turnRequested「继续」，无 turnAccepted → 不 destination-owned
            stored(
                3,
                "req-c1",
                "conversation.turnRequested",
                "attempt-c1",
                json!({"input": {"text": "继续"}}),
            ),
            stored(
                4,
                "req-c2",
                "conversation.turnRequested",
                "attempt-c2",
                json!({"input": {"text": "继续"}}),
            ),
        ];
        let caps = RuntimeContextCapabilities {
            native_delta: false,
            structured_history_import: false,
            native_clone: false,
            user_channel_transcript: true,
            tool_history: false,
            image_history: false,
            strong_context_ack: true,
        };
        // 模拟 accepted_through=2 后的增量 compile（当前 attempt-c3 排除）
        let incremental = compile_context(
            &events,
            &CompileContextRequest {
                session_id: "s-continue-only".to_string(),
                binding_key: "claude:provider-a".to_string(),
                destination: json!({"engine": "claude"}),
                destination_native_session_id: Some("claude:native-1".to_string()),
                from_sequence_exclusive: Some(2),
                through_sequence_inclusive: Some(4),
                exclude_attempt_id: Some("attempt-c3".to_string()),
                capabilities: caps.clone(),
                budget_estimated_tokens: None,
            },
        )
        .expect("incremental");
        assert!(
            !is_zero_transfer_package(&incremental),
            "continue-only package is non-empty"
        );
        assert!(
            !incremental.prompt_prefix.contains("原任务"),
            "incremental must NOT contain original task"
        );
        assert!(
            incremental.prompt_prefix.contains("继续"),
            "incremental only has continues"
        );
        let needs = session_needs_history(
            &events,
            &CompileContextRequest {
                session_id: "s-continue-only".to_string(),
                binding_key: "claude:provider-a".to_string(),
                destination: json!({"engine": "claude"}),
                destination_native_session_id: Some("claude:native-1".to_string()),
                from_sequence_exclusive: Some(2),
                through_sequence_inclusive: Some(4),
                exclude_attempt_id: Some("attempt-c3".to_string()),
                capabilities: caps.clone(),
                budget_estimated_tokens: None,
            },
        )
        .expect("needs");
        assert!(needs, "full history still needed");
        let full = compile_context(
            &events,
            &CompileContextRequest {
                session_id: "s-continue-only".to_string(),
                binding_key: "claude:provider-a".to_string(),
                destination: json!({"engine": "claude"}),
                destination_native_session_id: None,
                from_sequence_exclusive: None,
                through_sequence_inclusive: Some(4),
                exclude_attempt_id: Some("attempt-c3".to_string()),
                capabilities: caps,
                budget_estimated_tokens: None,
            },
        )
        .expect("full rematerialize");
        assert!(full.prompt_prefix.contains("原任务：实现登录并写测试"));
        assert!(full.prompt_prefix.contains("继续"));
    }

    #[test]
    fn missing_native_context_trust_field_defaults_dirty() {
        let (_, writer) = open_test_writer("legacy-trust-default");
        let session_id = "legacy-trust-session";
        let binding_key = "claude:legacy";
        writer
            .upsert_binding_state(&BindingStateUpdate {
                session_id: session_id.to_string(),
                binding_key: binding_key.to_string(),
                engine: "claude".to_string(),
                provider_profile_id: Some("legacy".to_string()),
                native_session_id: Some("claude:native-legacy".to_string()),
                accepted_through_sequence: Some(3),
                committed_through_sequence: Some(3),
                // 无 nativeContextTrust 字段
                provisioning_json: Some(json!({"state": "ready", "updatedAt": 1}).to_string()),
                pending_delivery_json: None,
                availability: "ready".to_string(),
                updated_at: 1,
            })
            .expect("upsert");
        let row = writer
            .binding_state(session_id, binding_key)
            .expect("read")
            .expect("row");
        assert_eq!(
            read_native_context_trust(&row),
            NativeContextTrust::Dirty,
            "legacy missing field must fail-closed to dirty"
        );
        writer.shutdown().expect("shutdown");
    }
}

#[cfg(test)]
mod native_continuation_import_tests {
    use super::*;
    use crate::native_history::{
        ContextSourceEntry, NativeHistoryEngine, NativeHistoryFidelity, NativeHistoryReadResult,
        NativeHistorySource,
    };
    use crate::shared_context::{compile_native_context, CompileNativeContextRequest};

    #[test]
    fn codex_projection_preserves_raw_tool_items_and_counts_unimportable_entries() {
        let source = NativeHistorySource {
            session_id: "codex:source".to_string(),
            native_session_id: "source".to_string(),
            engine: NativeHistoryEngine::Codex,
            provider_profile_id: Some("provider-a".to_string()),
        };
        let package = compile_native_context(&CompileNativeContextRequest {
            session_id: source.session_id.clone(),
            binding_key: "continuation:op".to_string(),
            destination: json!({"engine": "codex"}),
            source,
            history: NativeHistoryReadResult {
                reader_id: "codex-rollout-jsonl/v1".to_string(),
                source_fingerprint: "sha256:source".to_string(),
                through_cursor: "jsonl-v1:1:sha256:source".to_string(),
                entries: vec![
                    ContextSourceEntry {
                        source_entry_id: "tool".to_string(),
                        occurred_at: None,
                        role: "tool".to_string(),
                        blocks: vec![json!({
                            "kind": "native-block",
                            "value": {
                                "type": "function_call",
                                "name": "shell",
                                "arguments": "{}",
                                "call_id": "call-1"
                            }
                        })],
                        provenance: json!({}),
                        fidelity: NativeHistoryFidelity::Semantic,
                    },
                    ContextSourceEntry {
                        source_entry_id: "control".to_string(),
                        occurred_at: None,
                        role: "control".to_string(),
                        blocks: vec![json!({"kind": "native-block", "value": {"type": "unknown"}})],
                        provenance: json!({}),
                        fidelity: NativeHistoryFidelity::Lossy,
                    },
                ],
                fidelity: NativeHistoryFidelity::Semantic,
                omissions: Vec::new(),
            },
            capabilities: RuntimeContextCapabilities {
                native_delta: false,
                structured_history_import: true,
                native_clone: false,
                user_channel_transcript: true,
                tool_history: true,
                image_history: false,
                strong_context_ack: true,
            },
            budget_estimated_tokens: None,
        })
        .expect("compile");

        let (items, dropped) = codex_import_projection(&package);
        assert_eq!(items[0]["role"], "user");
        assert!(items[0]["content"][0]["text"]
            .as_str()
            .is_some_and(|text| text.starts_with("DOGE_CONTEXT_PACKAGE:")));
        assert_eq!(items[1]["type"], "function_call");
        let package_marker = items[0]["content"][0]["text"]
            .as_str()
            .expect("package marker");
        let accepted_marker = items
            .last()
            .and_then(|item| item["content"][0]["text"].as_str())
            .expect("accepted marker");
        assert_eq!(
            accepted_marker,
            package_marker.replacen("DOGE_CONTEXT_PACKAGE:", "DOGE_CONTEXT_ACCEPTED:", 1)
        );
        assert_eq!(dropped, 1);
        assert!(
            items
                .iter()
                .all(|item| item.get("role").and_then(Value::as_str) != Some("control")),
            "control roles must not be injected as messages"
        );
    }

    #[test]
    fn codex_import_projection_drops_control_role_text_messages() {
        // DeepSeek 等兼容 API：unknown variant `control`，只认 user/assistant/system/developer。
        let source = NativeHistorySource {
            session_id: "codex:source".to_string(),
            native_session_id: "source".to_string(),
            engine: NativeHistoryEngine::Codex,
            provider_profile_id: Some("provider-a".to_string()),
        };
        let package = compile_native_context(&CompileNativeContextRequest {
            session_id: source.session_id.clone(),
            binding_key: "continuation:op".to_string(),
            destination: json!({"engine": "codex"}),
            source,
            history: NativeHistoryReadResult {
                reader_id: "codex-rollout-jsonl/v1".to_string(),
                source_fingerprint: "sha256:source".to_string(),
                through_cursor: "jsonl-v1:2:sha256:source".to_string(),
                entries: vec![
                    ContextSourceEntry {
                        source_entry_id: "u1".to_string(),
                        occurred_at: None,
                        role: "user".to_string(),
                        blocks: vec![json!({"kind": "text", "text": "hello from user"})],
                        provenance: json!({}),
                        fidelity: NativeHistoryFidelity::Semantic,
                    },
                    ContextSourceEntry {
                        source_entry_id: "control-meta".to_string(),
                        occurred_at: None,
                        role: "control".to_string(),
                        blocks: vec![json!({
                            "kind": "text",
                            "text": "session meta that must not become a control message"
                        })],
                        provenance: json!({}),
                        fidelity: NativeHistoryFidelity::Lossy,
                    },
                    ContextSourceEntry {
                        source_entry_id: "a1".to_string(),
                        occurred_at: None,
                        role: "assistant".to_string(),
                        blocks: vec![json!({"kind": "text", "text": "hello from assistant"})],
                        provenance: json!({}),
                        fidelity: NativeHistoryFidelity::Semantic,
                    },
                ],
                fidelity: NativeHistoryFidelity::Semantic,
                omissions: Vec::new(),
            },
            capabilities: RuntimeContextCapabilities {
                native_delta: false,
                structured_history_import: true,
                native_clone: false,
                user_channel_transcript: true,
                tool_history: true,
                image_history: false,
                strong_context_ack: true,
            },
            budget_estimated_tokens: None,
        })
        .expect("compile");

        let (items, dropped) = codex_import_projection(&package);
        let roles: Vec<&str> = items
            .iter()
            .filter_map(|item| item.get("role").and_then(Value::as_str))
            .collect();
        assert!(roles.contains(&"user"));
        assert!(roles.contains(&"assistant"));
        assert!(
            !roles.iter().any(|role| *role == "control"),
            "control text must be dropped, got roles={roles:?}"
        );
        assert!(
            dropped >= 1,
            "control entry should count as dropped, dropped={dropped}"
        );
        assert!(
            items.iter().any(|item| {
                item.get("role") == Some(&json!("user"))
                    && item["content"][0]["text"]
                        .as_str()
                        .is_some_and(|text| text.contains("hello from user"))
            }),
            "user text preserved"
        );
        assert!(
            items.iter().any(|item| {
                item.get("role") == Some(&json!("assistant"))
                    && item["content"][0]["text"]
                        .as_str()
                        .is_some_and(|text| text.contains("hello from assistant"))
            }),
            "assistant text preserved"
        );
    }

    #[test]
    fn codex_zero_delta_projection_is_rejected_before_marker_import() {
        let source = NativeHistorySource {
            session_id: "codex:source".to_string(),
            native_session_id: "source".to_string(),
            engine: NativeHistoryEngine::Codex,
            provider_profile_id: Some("provider-a".to_string()),
        };
        let error = compile_native_context(&CompileNativeContextRequest {
            session_id: source.session_id.clone(),
            binding_key: "continuation:op".to_string(),
            destination: json!({"engine": "codex"}),
            source,
            history: NativeHistoryReadResult {
                reader_id: "codex-rollout-jsonl/v1".to_string(),
                source_fingerprint: "sha256:source".to_string(),
                through_cursor: "jsonl-v1:0:sha256:source".to_string(),
                entries: Vec::new(),
                fidelity: NativeHistoryFidelity::Semantic,
                omissions: Vec::new(),
            },
            capabilities: RuntimeContextCapabilities {
                native_delta: false,
                structured_history_import: true,
                native_clone: false,
                user_channel_transcript: true,
                tool_history: true,
                image_history: false,
                strong_context_ack: true,
            },
            budget_estimated_tokens: None,
        })
        .expect_err("empty projection must fail before marker-only import");

        assert_eq!(error, "native history has no portable context entries");
    }
}
