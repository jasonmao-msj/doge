use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use super::{persist_ledger, WechatExecutionTarget};
use crate::engine::{engine_enabled_in_settings, EngineType, ModelInfo};
use crate::state::AppState;

const MANAGED_PROVIDER_PROFILE_ID: &str = "doge-token-matrix";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkspaceChoice {
    id: String,
    label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct EngineChoice {
    engine: EngineType,
    label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(super) struct ModelChoice {
    label: String,
    target: WechatExecutionTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(super) enum PendingTargetSelection {
    Workspace {
        choices: Vec<WorkspaceChoice>,
    },
    Engine {
        workspace: WorkspaceChoice,
        choices: Vec<EngineChoice>,
    },
    Model {
        workspace: WorkspaceChoice,
        engine: EngineChoice,
        choices: Vec<ModelChoice>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TargetControlInput {
    Status,
    Help,
    NewSession,
    Workspace,
    Engine,
    Model,
    Cancel,
    Choice(usize),
    InvalidSelectionReply,
    Other,
}

#[derive(Debug, Clone)]
struct ProviderChoice {
    lookup_id: String,
    target_id: Option<String>,
    label: String,
}

#[derive(Debug, Clone)]
struct ProductEngineCatalog {
    choice: EngineChoice,
    models: Vec<ProductModel>,
}

#[derive(Debug, Clone)]
struct ProductModel {
    id: String,
    label: String,
    runtime_model: String,
}

pub(super) async fn handle_target_control_message(
    app: &AppHandle,
    wxid: &str,
    text: &str,
) -> Result<Option<String>, String> {
    let state = app.state::<AppState>();
    let (current_target, pending) = {
        let ledger = state.wechat.ledger.lock().await;
        (ledger.selected_target(wxid), ledger.pending_selection(wxid))
    };
    let input = parse_target_control_input(text, pending.is_some());
    let reply = match input {
        TargetControlInput::Other => return Ok(None),
        TargetControlInput::Status | TargetControlInput::Help => {
            target_status(&state, current_target.as_ref()).await
        }
        TargetControlInput::NewSession => {
            if current_target.is_none() {
                "尚未选择会话目标，请先发送 /workspace。".to_string()
            } else {
                persist_ledger_change(&state, |ledger| {
                    ledger.reset_session(wxid);
                })
                .await?;
                "已开启新会话，当前工作区、引擎和模型保持不变。下一条普通消息将创建新的对话。\n需要查看当前目标可发送 /target，需要切换目标可发送 /workspace。".to_string()
            }
        }
        TargetControlInput::Workspace => {
            let choices = workspace_choices(&state).await;
            if choices.is_empty() {
                "Doge 中还没有可用工作区，请先在桌面端添加工作区。".to_string()
            } else {
                persist_pending(
                    &state,
                    wxid,
                    PendingTargetSelection::Workspace {
                        choices: choices.clone(),
                    },
                )
                .await?;
                format_choices("请选择工作区，回复数字：", &choices, |choice| {
                    choice.label.as_str()
                })
            }
        }
        TargetControlInput::Engine => {
            let Some(target) = current_target else {
                return Ok(Some("尚未选择工作区。请先发送 /workspace。".to_string()));
            };
            let Some(workspace) = workspace_choice(&state, &target.workspace_id).await else {
                return Ok(Some(
                    "当前工作区已不存在，请发送 /workspace 重新选择。".to_string(),
                ));
            };
            begin_engine_selection(&state, wxid, workspace).await?
        }
        TargetControlInput::Model => {
            let Some(target) = current_target else {
                return Ok(Some("尚未选择会话目标。请先发送 /workspace。".to_string()));
            };
            let Some(workspace) = workspace_choice(&state, &target.workspace_id).await else {
                return Ok(Some(
                    "当前工作区已不存在，请发送 /workspace 重新选择。".to_string(),
                ));
            };
            begin_model_selection(
                &state,
                wxid,
                workspace,
                EngineChoice {
                    engine: target.engine,
                    label: target.engine.display_name().to_string(),
                },
            )
            .await?
        }
        TargetControlInput::Cancel => {
            let cleared = clear_pending(&state, wxid).await?;
            if cleared {
                "已取消本次选择，当前会话目标保持不变。".to_string()
            } else {
                "当前没有待完成的选择。".to_string()
            }
        }
        TargetControlInput::Choice(index) => {
            handle_number_choice(&state, wxid, index, pending).await?
        }
        TargetControlInput::InvalidSelectionReply => {
            "当前正在选择会话目标，请回复列表中的数字，或发送 /cancel 取消。".to_string()
        }
    };
    Ok(Some(reply))
}

fn parse_target_control_input(text: &str, has_pending: bool) -> TargetControlInput {
    let normalized = text.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "/target" | "/目标" => TargetControlInput::Status,
        "/help" | "/帮助" => TargetControlInput::Help,
        "/new" | "/new-session" | "/新会话" | "/重新开始" => TargetControlInput::NewSession,
        "/workspace" | "/工作区" => TargetControlInput::Workspace,
        "/engine" | "/引擎" => TargetControlInput::Engine,
        "/model" | "/模型" => TargetControlInput::Model,
        "/cancel" | "/取消" => TargetControlInput::Cancel,
        _ if has_pending
            && normalized
                .chars()
                .all(|character| character.is_ascii_digit()) =>
        {
            normalized
                .parse::<usize>()
                .ok()
                .map(TargetControlInput::Choice)
                .unwrap_or(TargetControlInput::InvalidSelectionReply)
        }
        _ if has_pending => TargetControlInput::InvalidSelectionReply,
        _ => TargetControlInput::Other,
    }
}

async fn handle_number_choice(
    state: &AppState,
    wxid: &str,
    index: usize,
    pending: Option<PendingTargetSelection>,
) -> Result<String, String> {
    let Some(pending) = pending else {
        return Ok("当前没有待选择项目，请发送 /workspace、/engine 或 /model。".to_string());
    };
    match pending {
        PendingTargetSelection::Workspace { choices } => {
            let Some(choice) = numbered_choice(&choices, index) else {
                return Ok(invalid_choice(choices.len()));
            };
            let Some(current) = workspace_choice(state, &choice.id).await else {
                clear_pending(state, wxid).await?;
                return Ok("该工作区已不存在，请发送 /workspace 重新选择。".to_string());
            };
            begin_engine_selection(state, wxid, current).await
        }
        PendingTargetSelection::Engine { workspace, choices } => {
            let Some(choice) = numbered_choice(&choices, index) else {
                return Ok(invalid_choice(choices.len()));
            };
            let Some(current_workspace) = workspace_choice(state, &workspace.id).await else {
                clear_pending(state, wxid).await?;
                return Ok("该工作区已不存在，请发送 /workspace 重新选择。".to_string());
            };
            let current_engines = engine_choices(state).await?;
            let Some(current_engine) = current_engines
                .into_iter()
                .find(|candidate| candidate.engine == choice.engine)
            else {
                clear_pending(state, wxid).await?;
                return Ok("该引擎已不可用，请发送 /engine 重新选择。".to_string());
            };
            begin_model_selection(state, wxid, current_workspace, current_engine).await
        }
        PendingTargetSelection::Model {
            workspace,
            engine,
            choices,
        } => {
            let Some(choice) = numbered_choice(&choices, index) else {
                return Ok(invalid_choice(choices.len()));
            };
            if workspace_choice(state, &workspace.id).await.is_none() {
                clear_pending(state, wxid).await?;
                return Ok("该工作区已不存在，请发送 /workspace 重新选择。".to_string());
            }
            let current_choices = model_choices(state, &workspace, &engine).await?;
            let Some(current) = current_choices
                .into_iter()
                .find(|candidate| candidate.target == choice.target)
            else {
                clear_pending(state, wxid).await?;
                return Ok("该模型已不可用，请发送 /model 重新选择。".to_string());
            };
            persist_target(state, wxid, current.target.clone()).await?;
            Ok(format!(
                "会话目标已切换：\n工作区：{}\n引擎：{}\n模型：{}\n下一条普通消息将使用此目标。\n需要重新开聊可发送 /new，需要查看目标可发送 /target。",
                workspace.label, engine.label, current.label
            ))
        }
    }
}

async fn begin_engine_selection(
    state: &AppState,
    wxid: &str,
    workspace: WorkspaceChoice,
) -> Result<String, String> {
    let choices = engine_choices(state).await?;
    if choices.is_empty() {
        return Ok("当前没有可用引擎，请先在 Doge 中完成引擎准备。".to_string());
    }
    persist_pending(
        state,
        wxid,
        PendingTargetSelection::Engine {
            workspace: workspace.clone(),
            choices: choices.clone(),
        },
    )
    .await?;
    Ok(format_choices(
        &format!(
            "已选择工作区「{}」。请选择引擎，回复数字：",
            workspace.label
        ),
        &choices,
        |choice| choice.label.as_str(),
    ))
}

async fn begin_model_selection(
    state: &AppState,
    wxid: &str,
    workspace: WorkspaceChoice,
    engine: EngineChoice,
) -> Result<String, String> {
    let choices = model_choices(state, &workspace, &engine).await?;
    if choices.is_empty() {
        return Ok(format!(
            "引擎「{}」当前没有可用模型，请发送 /engine 重新选择。",
            engine.label
        ));
    }
    persist_pending(
        state,
        wxid,
        PendingTargetSelection::Model {
            workspace,
            engine: engine.clone(),
            choices: choices.clone(),
        },
    )
    .await?;
    Ok(format_choices(
        &format!("已选择引擎「{}」。请选择模型，回复数字：", engine.label),
        &choices,
        |choice| choice.label.as_str(),
    ))
}

async fn target_status(state: &AppState, target: Option<&WechatExecutionTarget>) -> String {
    let help = "可用指令：/workspace、/engine、/model、/new、/target、/help、/cancel";
    let Some(target) = target else {
        return format!("尚未选择会话目标。\n请发送 /workspace 开始选择。\n{help}");
    };
    let workspace = workspace_choice(state, &target.workspace_id)
        .await
        .map(|choice| choice.label)
        .unwrap_or_else(|| target.workspace_id.clone());
    format!(
        "当前会话目标：\n工作区：{}\n引擎：{}\n模型：{}\n{}",
        workspace,
        target.engine.display_name(),
        target.model.as_deref().unwrap_or("未选择"),
        help
    )
}

async fn workspace_choices(state: &AppState) -> Vec<WorkspaceChoice> {
    let mut choices = state
        .workspaces
        .lock()
        .await
        .values()
        .map(|workspace| WorkspaceChoice {
            id: workspace.id.clone(),
            label: workspace.name.trim().to_string(),
        })
        .collect::<Vec<_>>();
    choices.sort_by(|left, right| {
        left.label
            .to_lowercase()
            .cmp(&right.label.to_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    choices
}

async fn workspace_choice(state: &AppState, workspace_id: &str) -> Option<WorkspaceChoice> {
    state
        .workspaces
        .lock()
        .await
        .get(workspace_id)
        .map(|workspace| WorkspaceChoice {
            id: workspace.id.clone(),
            label: workspace.name.trim().to_string(),
        })
}

async fn engine_choices(state: &AppState) -> Result<Vec<EngineChoice>, String> {
    if let Some(catalog) = product_target_catalog(state).await? {
        return Ok(catalog.into_iter().map(|engine| engine.choice).collect());
    }
    let settings = state.app_settings.lock().await.clone();
    let available = state
        .engine_manager
        .get_available_engines()
        .await
        .into_iter()
        .collect::<HashSet<_>>();
    let all = [
        EngineType::Claude,
        EngineType::Codex,
        EngineType::Kimi,
        EngineType::Grok,
        EngineType::OpenCode,
    ];
    Ok(all
        .into_iter()
        .filter(|engine| {
            engine_enabled_in_settings(&settings, *engine)
                && (available.is_empty() || available.contains(engine))
        })
        .map(|engine| EngineChoice {
            engine,
            label: engine.display_name().to_string(),
        })
        .collect())
}

async fn model_choices(
    state: &AppState,
    workspace: &WorkspaceChoice,
    engine: &EngineChoice,
) -> Result<Vec<ModelChoice>, String> {
    if let Some(catalog) = product_target_catalog(state).await? {
        let Some(product_engine) = catalog
            .into_iter()
            .find(|candidate| candidate.choice.engine == engine.engine)
        else {
            return Ok(Vec::new());
        };
        return Ok(product_engine
            .models
            .into_iter()
            .map(|model| ModelChoice {
                label: model.label,
                target: WechatExecutionTarget {
                    workspace_id: workspace.id.clone(),
                    engine: engine.engine,
                    model: Some(model.runtime_model),
                    model_catalog_entry_id: Some(model.id),
                    provider_profile_id: Some(MANAGED_PROVIDER_PROFILE_ID.to_string()),
                },
            })
            .collect());
    }
    local_provider_model_choices(workspace, engine.engine).await
}

async fn local_provider_model_choices(
    workspace: &WorkspaceChoice,
    engine: EngineType,
) -> Result<Vec<ModelChoice>, String> {
    let profiles = provider_choices(engine).await;
    let mut choices = Vec::new();
    let mut seen = HashSet::new();
    for profile in profiles {
        let models = if profile.target_id.is_none() {
            crate::engine::status::get_local_engine_models_for_validation(engine)
                .unwrap_or_default()
        } else {
            match crate::engine::status::get_provider_scoped_engine_models(
                engine,
                Some(&profile.lookup_id),
            ) {
                Ok(Some(models)) => models,
                Ok(None) | Err(_) => Vec::new(),
            }
        };
        for model in filter_profile_models(models, &profile) {
            let catalog_id = model.id.trim().to_string();
            let runtime_model = if model.model.trim().is_empty() {
                catalog_id.clone()
            } else {
                model.model.trim().to_string()
            };
            let identity = format!(
                "{}:{}:{}",
                profile.target_id.as_deref().unwrap_or("local"),
                catalog_id.to_lowercase(),
                runtime_model.to_lowercase()
            );
            if catalog_id.is_empty() || runtime_model.is_empty() || !seen.insert(identity) {
                continue;
            }
            choices.push(ModelChoice {
                label: format!("[{}] {}", profile.label, model.name.trim()),
                target: WechatExecutionTarget {
                    workspace_id: workspace.id.clone(),
                    engine,
                    model: Some(runtime_model),
                    model_catalog_entry_id: Some(catalog_id),
                    provider_profile_id: profile.target_id.clone(),
                },
            });
        }
    }
    Ok(choices)
}

fn filter_profile_models(models: Vec<ModelInfo>, profile: &ProviderChoice) -> Vec<ModelInfo> {
    models
        .into_iter()
        .filter(|model| {
            let owner = model
                .provider_profile_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            match profile.target_id.as_deref() {
                None => owner.is_none() || owner == Some(profile.lookup_id.as_str()),
                Some(profile_id) => {
                    owner == Some(profile_id)
                        || (owner.is_none()
                            && (model.source == "fallback" || model.source == "builtin"))
                }
            }
        })
        .collect()
}

async fn provider_choices(engine: EngineType) -> Vec<ProviderChoice> {
    let mut choices = vec![local_provider_choice(engine)];
    match engine {
        EngineType::Claude => {
            if let Ok(providers) = crate::vendors::vendor_get_claude_providers().await {
                choices.extend(providers.into_iter().filter_map(|provider| {
                    managed_provider_choice(
                        engine,
                        provider.id,
                        provider.name,
                        provider.is_local_provider == Some(true),
                    )
                }));
            }
        }
        EngineType::Codex => {
            if let Ok(providers) = crate::vendors::vendor_get_codex_providers().await {
                choices.extend(providers.into_iter().filter_map(|provider| {
                    managed_provider_choice(engine, provider.id, provider.name, false)
                }));
            }
        }
        EngineType::Kimi => {
            if let Ok(providers) = crate::vendors::vendor_get_kimi_providers().await {
                choices.extend(providers.into_iter().filter_map(|provider| {
                    managed_provider_choice(
                        engine,
                        provider.id,
                        provider.name,
                        provider.is_local_provider == Some(true),
                    )
                }));
            }
        }
        EngineType::Grok => {
            if let Ok(providers) = crate::vendors::vendor_get_grok_providers().await {
                choices.extend(providers.into_iter().filter_map(|provider| {
                    managed_provider_choice(
                        engine,
                        provider.id,
                        provider.name,
                        provider.is_local_provider == Some(true),
                    )
                }));
            }
        }
        EngineType::OpenCode => {
            if let Ok(providers) = crate::vendors::vendor_get_opencode_providers().await {
                choices.extend(providers.into_iter().filter_map(|provider| {
                    managed_provider_choice(
                        engine,
                        provider.id,
                        provider.name,
                        provider.is_local_provider == Some(true),
                    )
                }));
            }
        }
        EngineType::Gemini => {}
    }
    let mut seen = HashSet::new();
    choices
        .into_iter()
        .filter(|profile| seen.insert(profile.lookup_id.clone()))
        .collect()
}

fn managed_provider_choice(
    engine: EngineType,
    id: String,
    name: String,
    is_local: bool,
) -> Option<ProviderChoice> {
    let id = id.trim().to_string();
    if id.is_empty() || is_local || id == local_provider_id(engine) {
        return None;
    }
    let name = name.trim();
    Some(ProviderChoice {
        lookup_id: id.clone(),
        target_id: Some(id.clone()),
        label: if name.is_empty() {
            id
        } else {
            name.to_string()
        },
    })
}

fn local_provider_choice(engine: EngineType) -> ProviderChoice {
    ProviderChoice {
        lookup_id: local_provider_id(engine).to_string(),
        target_id: None,
        label: "本地配置".to_string(),
    }
}

fn local_provider_id(engine: EngineType) -> &'static str {
    match engine {
        EngineType::Claude => crate::engine::claude::CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
        EngineType::Codex => crate::codex::provider_profile::CODEX_DISK_PROVIDER_PROFILE_ID,
        EngineType::Kimi => crate::engine::kimi_provider_profile::KIMI_LOCAL_PROVIDER_PROFILE_ID,
        EngineType::Grok => crate::engine::grok_provider_profile::GROK_LOCAL_PROVIDER_PROFILE_ID,
        EngineType::OpenCode => {
            crate::engine::opencode_provider_profile::OPENCODE_LOCAL_PROVIDER_PROFILE_ID
        }
        EngineType::Gemini => "__disabled_gemini__",
    }
}

async fn product_target_catalog(
    state: &AppState,
) -> Result<Option<Vec<ProductEngineCatalog>>, String> {
    let catalog = state.account_runtime.product_catalog_snapshot().await;
    if catalog.get("ok").and_then(Value::as_bool) != Some(true) {
        return Ok(None);
    }
    if catalog
        .pointer("/value/entitlement/status")
        .and_then(Value::as_str)
        != Some("active")
    {
        return Ok(None);
    }
    let models = state.account_runtime.product_models_snapshot().await;
    if models.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err("Product 模型目录暂时不可用".to_string());
    }
    project_product_target_catalog(&catalog, &models).map(Some)
}

fn project_product_target_catalog(
    catalog: &Value,
    models: &Value,
) -> Result<Vec<ProductEngineCatalog>, String> {
    let engines = catalog
        .pointer("/value/engines")
        .and_then(Value::as_array)
        .ok_or_else(|| "Product 引擎目录格式无效".to_string())?;
    let models = models
        .pointer("/value/models")
        .and_then(Value::as_array)
        .ok_or_else(|| "Product 模型目录格式无效".to_string())?;
    let mut projected = Vec::new();
    for engine in engines {
        let Some(catalog_id) = engine.get("id").and_then(Value::as_str) else {
            continue;
        };
        let Some(runtime_engine) = product_runtime_engine(catalog_id) else {
            continue;
        };
        let label = engine
            .get("display_name")
            .and_then(Value::as_str)
            .unwrap_or_else(|| runtime_engine.display_name())
            .trim()
            .to_string();
        let compatible_models = models
            .iter()
            .filter(|model| product_model_supports_engine(model, runtime_engine))
            .filter_map(project_product_model)
            .collect::<Vec<_>>();
        if !compatible_models.is_empty() {
            projected.push(ProductEngineCatalog {
                choice: EngineChoice {
                    engine: runtime_engine,
                    label,
                },
                models: compatible_models,
            });
        }
    }
    Ok(projected)
}

fn product_runtime_engine(id: &str) -> Option<EngineType> {
    match id.trim() {
        "codex" => Some(EngineType::Codex),
        "claude-code" => Some(EngineType::Claude),
        "kimi" => Some(EngineType::Kimi),
        _ => None,
    }
}

fn product_model_supports_engine(model: &Value, engine: EngineType) -> bool {
    let protocol = match engine {
        EngineType::Codex => "openai-responses",
        EngineType::Claude => "anthropic-messages",
        EngineType::Kimi => "openai-chat-completions",
        EngineType::Gemini | EngineType::Grok | EngineType::OpenCode => return false,
    };
    model
        .get("api_protocols")
        .and_then(Value::as_array)
        .is_some_and(|protocols| {
            protocols
                .iter()
                .any(|value| value.as_str() == Some(protocol))
        })
}

fn project_product_model(model: &Value) -> Option<ProductModel> {
    let id = model.get("id")?.as_str()?.trim();
    let raw_runtime = model
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or(id)
        .trim();
    if id.is_empty() || raw_runtime.is_empty() {
        return None;
    }
    let label = model
        .get("display_name")
        .and_then(Value::as_str)
        .unwrap_or(id)
        .trim()
        .to_string();
    let identity = format!("{id} {raw_runtime} {label}").to_lowercase();
    let runtime_model = if identity.contains("豆包")
        || identity.contains("doubao")
        || identity.contains("ark-code")
    {
        "豆包".to_string()
    } else {
        strip_kimi_catalog_prefix(raw_runtime).to_string()
    };
    Some(ProductModel {
        id: id.to_string(),
        label,
        runtime_model,
    })
}

fn strip_kimi_catalog_prefix(value: &str) -> &str {
    value
        .get(..10)
        .filter(|prefix| prefix.eq_ignore_ascii_case("kimi-code/"))
        .map(|_| &value[10..])
        .unwrap_or(value)
}

async fn persist_pending(
    state: &AppState,
    wxid: &str,
    pending: PendingTargetSelection,
) -> Result<(), String> {
    persist_ledger_change(state, |ledger| {
        ledger.set_pending_selection(wxid, pending);
    })
    .await
}

async fn clear_pending(state: &AppState, wxid: &str) -> Result<bool, String> {
    let mut cleared = false;
    persist_ledger_change(state, |ledger| {
        cleared = ledger.clear_pending_selection(wxid);
    })
    .await?;
    Ok(cleared)
}

async fn persist_target(
    state: &AppState,
    wxid: &str,
    target: WechatExecutionTarget,
) -> Result<(), String> {
    persist_ledger_change(state, |ledger| {
        ledger.select_target(wxid, target);
    })
    .await
}

async fn persist_ledger_change(
    state: &AppState,
    change: impl FnOnce(&mut super::WechatMessageLedger),
) -> Result<(), String> {
    let mut ledger = state.wechat.ledger.lock().await;
    let before = ledger.clone();
    change(&mut ledger);
    if let Err(error) = persist_ledger(&state.settings_path, &ledger) {
        *ledger = before;
        return Err(error);
    }
    Ok(())
}

fn format_choices<T>(heading: &str, choices: &[T], label: impl Fn(&T) -> &str) -> String {
    let mut output = String::from(heading);
    for (index, choice) in choices.iter().enumerate() {
        output.push_str(&format!("\n{}. {}", index + 1, label(choice)));
    }
    output.push_str("\n发送 /cancel 可取消，发送 /help 可查看命令。");
    output
}

fn invalid_choice(count: usize) -> String {
    format!("请输入 1 到 {count} 之间的数字，或发送 /cancel 取消。")
}

fn numbered_choice<T: Clone>(choices: &[T], index: usize) -> Option<T> {
    index
        .checked_sub(1)
        .and_then(|offset| choices.get(offset))
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_commands_and_only_treats_numbers_as_control_during_selection() {
        assert_eq!(
            parse_target_control_input(" /workspace ", false),
            TargetControlInput::Workspace
        );
        assert_eq!(
            parse_target_control_input("/帮助", false),
            TargetControlInput::Help
        );
        assert_eq!(
            parse_target_control_input(" /new-session ", true),
            TargetControlInput::NewSession
        );
        assert_eq!(
            parse_target_control_input("/重新开始", false),
            TargetControlInput::NewSession
        );
        assert_eq!(
            parse_target_control_input("2", false),
            TargetControlInput::Other
        );
        assert_eq!(
            parse_target_control_input("2", true),
            TargetControlInput::Choice(2)
        );
        assert_eq!(
            parse_target_control_input("0", true),
            TargetControlInput::Choice(0)
        );
        assert_eq!(
            parse_target_control_input("继续聊天", true),
            TargetControlInput::InvalidSelectionReply
        );
        assert_eq!(numbered_choice(&["first"], 0), None);
        assert_eq!(numbered_choice(&["first"], 2), None);
        assert_eq!(numbered_choice(&["first"], 1), Some("first"));
    }

    #[test]
    fn projects_product_models_with_conversation_page_protocol_rules() {
        let catalog = json!({
            "value": {
                "engines": [
                    {"id": "codex", "display_name": "Codex"},
                    {"id": "claude-code", "display_name": "Claude"},
                    {"id": "kimi", "display_name": "Kimi"}
                ]
            }
        });
        let models = json!({
            "value": {
                "models": [
                    {"id": "sol", "display_name": "Sol", "model": "gpt-sol", "api_protocols": ["openai-responses"]},
                    {"id": "sonnet", "display_name": "Sonnet", "model": "claude-sonnet", "api_protocols": ["anthropic-messages"]},
                    {"id": "kimi-code/k3", "display_name": "K3", "model": "kimi-code/k3", "api_protocols": ["openai-chat-completions"]}
                ]
            }
        });
        let projected = project_product_target_catalog(&catalog, &models).unwrap();
        assert_eq!(projected.len(), 3);
        assert_eq!(projected[0].models[0].runtime_model, "gpt-sol");
        assert_eq!(projected[1].models[0].runtime_model, "claude-sonnet");
        assert_eq!(projected[2].models[0].runtime_model, "k3");
    }

    #[test]
    fn product_doubao_runtime_mapping_matches_conversation_page() {
        let projected = project_product_model(&json!({
            "id": "ark-code-latest",
            "display_name": "Doubao Coding",
            "model": "ark-code-latest"
        }))
        .unwrap();
        assert_eq!(projected.runtime_model, "豆包");
    }
}
