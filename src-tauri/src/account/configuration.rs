use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) const ACCOUNT_CODEX_PROVIDER_ID: &str = "doge-token-matrix";
pub(crate) const ACCOUNT_CLAUDE_PROVIDER_ID: &str =
    crate::engine::claude::provider_profile::CLAUDE_ACCOUNT_MANAGED_PROVIDER_PROFILE_ID;
pub(crate) const ACCOUNT_RECIPE_ID: &str = "doge.account.codex-token-service";

pub(crate) const ACCOUNT_CODEX_CONFIG_TOML: &str = r#"model_provider = "DogeTokenMatrix"
model = "gpt-5.5"
review_model = "gpt-5.5"
disable_response_storage = true
network_access = "enabled"
windows_wsl_setup_acknowledged = true

[model_providers.DogeTokenMatrix]
name = "Doge Token Matrix"
base_url = "https://token-matrix.com"
wire_api = "responses"
requires_openai_auth = true
env_key = "OPENAI_API_KEY"
"#;

#[derive(Clone)]
pub(super) struct PlannedFile {
    pub(super) handle: String,
    pub(super) label: &'static str,
    pub(super) path: PathBuf,
    pub(super) expected_hash: String,
    pub(super) content: String,
}

#[derive(Clone)]
pub(crate) struct ConfigurationPlanState {
    pub(crate) handle: String,
    pub(crate) expires_at_epoch_seconds: i64,
    pub(super) files: Vec<PlannedFile>,
    pub(super) view: Value,
}

pub(crate) fn create_plan(
    account_epoch: u64,
    process_generation: u64,
    now_epoch_seconds: i64,
) -> Result<(ConfigurationPlanState, Value), String> {
    let doge_config_path = crate::app_paths::config_file_path()?;
    let provider_home =
        crate::app_paths::codex_provider_homes_dir()?.join(ACCOUNT_CODEX_PROVIDER_ID);
    let provider_config_path = provider_home.join("config.toml");
    reject_unsafe_target(&doge_config_path)?;
    reject_unsafe_target(&provider_config_path)?;

    let doge_before = read_optional_file(&doge_config_path)?;
    let provider_before = read_optional_file(&provider_config_path)?;
    let doge_after = build_doge_config(doge_before.as_deref())?;
    let expires_at = now_epoch_seconds.saturating_add(300);
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let handle = bound_handle(
        "config-plan",
        "codex-configuration",
        account_epoch,
        process_generation,
        expires_at,
        &nonce,
    );
    let doge_file_handle = bound_handle(
        "config-file",
        "codex-configuration",
        account_epoch,
        process_generation,
        expires_at,
        &format!("d{}", &nonce[..31]),
    );
    let provider_file_handle = bound_handle(
        "config-file",
        "codex-configuration",
        account_epoch,
        process_generation,
        expires_at,
        &format!("p{}", &nonce[..31]),
    );
    let files = vec![
        PlannedFile {
            handle: doge_file_handle,
            label: "Doge provider registry",
            path: doge_config_path,
            expected_hash: hash_optional(doge_before.as_deref()),
            content: doge_after,
        },
        PlannedFile {
            handle: provider_file_handle,
            label: "Codex settings",
            path: provider_config_path,
            expected_hash: hash_optional(provider_before.as_deref()),
            content: ACCOUNT_CODEX_CONFIG_TOML.to_string(),
        },
    ];
    let visible_files = files
        .iter()
        .map(|file| {
            let current = read_optional_file(&file.path)?;
            Ok(json!({
                "file": file.handle,
                "targetLabel": file.label,
                "outcome": if hash_optional(current.as_deref()) == hash_optional(Some(&file.content)) {
                    "unchanged"
                } else {
                    "willChange"
                },
            }))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let summary = if visible_files
        .iter()
        .all(|file| file.get("outcome") == Some(&Value::String("unchanged".to_string())))
    {
        "noop"
    } else {
        "changesPlanned"
    };
    let view = json!({
        "plan": handle.clone(),
        "recipeId": ACCOUNT_RECIPE_ID,
        "recipeVersion": 1,
        "targetLabel": "Codex",
        "expiresAt": crate::account::runtime::rfc3339_from_epoch(expires_at),
        "summary": summary,
        "files": visible_files,
    });
    let plan = ConfigurationPlanState {
        handle,
        expires_at_epoch_seconds: expires_at,
        files,
        view: view.clone(),
    };
    Ok((plan, view))
}

pub(crate) fn create_managed_engine_plan(
    engine_id: &str,
    account_epoch: u64,
    process_generation: u64,
    now_epoch_seconds: i64,
) -> Result<(ConfigurationPlanState, Value), String> {
    if engine_id == "codex" {
        return create_plan(account_epoch, process_generation, now_epoch_seconds);
    }
    if engine_id != "claude-code" {
        return Err("managed engine is unsupported".to_string());
    }
    let doge_config_path = crate::app_paths::config_file_path()?;
    reject_unsafe_target(&doge_config_path)?;
    let before = read_optional_file(&doge_config_path)?;
    let after = build_doge_config_for_claude(before.as_deref())?;
    let expires_at = now_epoch_seconds.saturating_add(300);
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let handle = bound_handle(
        "config-plan",
        "claude-code-configuration",
        account_epoch,
        process_generation,
        expires_at,
        &nonce,
    );
    let file_handle = bound_handle(
        "config-file",
        "claude-code-configuration",
        account_epoch,
        process_generation,
        expires_at,
        &format!("c{}", &nonce[..31]),
    );
    let files = vec![PlannedFile {
        handle: file_handle,
        label: "Doge Claude provider registry",
        path: doge_config_path,
        expected_hash: hash_optional(before.as_deref()),
        content: after,
    }];
    let view = json!({
        "plan": handle.clone(),
        "recipeId": "doge.account.claude-code-token-service",
        "recipeVersion": 1,
        "targetLabel": "Claude Code",
        "expiresAt": crate::account::runtime::rfc3339_from_epoch(expires_at),
        "summary": if hash_optional(before.as_deref()) == hash_optional(Some(&files[0].content)) { "noop" } else { "changesPlanned" },
        "files": [{ "file": files[0].handle, "targetLabel": files[0].label, "outcome": "willChange" }],
    });
    Ok((
        ConfigurationPlanState {
            handle,
            expires_at_epoch_seconds: expires_at,
            files,
            view: view.clone(),
        },
        view,
    ))
}

pub(crate) fn apply_managed_engine(
    engine_id: &str,
    account_epoch: u64,
    process_generation: u64,
    now_epoch_seconds: i64,
) -> Result<Value, ApplyError> {
    let (plan, _) = create_managed_engine_plan(
        engine_id,
        account_epoch,
        process_generation,
        now_epoch_seconds,
    )
    .map_err(ApplyError::Rejected)?;
    apply_plan(
        &plan,
        &plan.handle,
        account_epoch,
        process_generation,
        now_epoch_seconds,
    )
}

pub(crate) fn verify_managed_engine_configuration(engine_id: &str) -> Result<(), String> {
    let doge_config_path = crate::app_paths::config_file_path()?;
    let content = read_optional_file(&doge_config_path)?
        .ok_or_else(|| "Doge managed provider registry is absent".to_string())?;
    let root: Value = serde_json::from_str(&content)
        .map_err(|_| "Doge managed provider registry is invalid".to_string())?;
    match engine_id {
        "codex" => {
            if root.pointer("/codex/current").and_then(Value::as_str)
                != Some(ACCOUNT_CODEX_PROVIDER_ID)
            {
                return Err("Codex managed provider is not active".to_string());
            }
            let provider_config = crate::app_paths::codex_provider_homes_dir()?
                .join(ACCOUNT_CODEX_PROVIDER_ID)
                .join("config.toml");
            let provider_content = read_optional_file(&provider_config)?
                .ok_or_else(|| "Codex managed settings are absent".to_string())?;
            let parsed: toml::Value = toml::from_str(&provider_content)
                .map_err(|_| "Codex managed settings are invalid".to_string())?;
            if parsed.get("model_provider").and_then(toml::Value::as_str) != Some("DogeTokenMatrix")
            {
                return Err("Codex managed provider binding is invalid".to_string());
            }
        }
        "claude-code" => {
            let provider = root
                .pointer("/claude/providers/doge-token-matrix")
                .ok_or_else(|| "Claude Code managed provider is absent".to_string())?;
            if root.pointer("/claude/current").and_then(Value::as_str)
                != Some(ACCOUNT_CLAUDE_PROVIDER_ID)
                || provider.get("source").and_then(Value::as_str) != Some("doge-account")
                || provider
                    .pointer("/settingsConfig/env/DOGE_MANAGED_ACCOUNT_ENGINE")
                    .and_then(Value::as_str)
                    != Some("claude-code")
                || provider
                    .pointer("/settingsConfig/env/ANTHROPIC_AUTH_TOKEN")
                    .is_some()
            {
                return Err("Claude Code managed provider binding is invalid".to_string());
            }
        }
        _ => return Err("managed engine is unsupported".to_string()),
    }
    Ok(())
}

pub(crate) fn current_plan_view(
    plan: &ConfigurationPlanState,
    now_epoch_seconds: i64,
) -> Option<Value> {
    (now_epoch_seconds <= plan.expires_at_epoch_seconds).then(|| plan.view.clone())
}

pub(crate) fn read_file_detail(
    plan: &ConfigurationPlanState,
    plan_handle: &str,
    file_handle: &str,
    now_epoch_seconds: i64,
) -> Result<Value, String> {
    validate_live_plan(plan, plan_handle, now_epoch_seconds)?;
    let file = plan
        .files
        .iter()
        .find(|file| file.handle == file_handle)
        .ok_or_else(|| "configuration file handle is not part of this plan".to_string())?;
    let entries = if file.label == "Doge provider registry" {
        vec![
            safe_change("Provider", "Doge Token Matrix"),
            safe_change("Selection", "Use for new Codex sessions"),
            safe_secret_change("Managed credential"),
        ]
    } else {
        vec![
            safe_change("Provider", "Doge Token Matrix"),
            safe_change("Endpoint", "Token Matrix"),
            safe_change("Protocol", "Responses API"),
            safe_change("Model", "gpt-5.5"),
        ]
    };
    Ok(json!({
        "file": file.handle,
        "targetLabel": file.label,
        "sections": [{
            "label": "Planned changes",
            "entries": entries,
        }],
    }))
}

pub(crate) fn apply_plan(
    plan: &ConfigurationPlanState,
    plan_handle: &str,
    account_epoch: u64,
    process_generation: u64,
    now_epoch_seconds: i64,
) -> Result<Value, ApplyError> {
    let lock_root = plan
        .files
        .first()
        .and_then(|file| file.path.parent())
        .map(Path::to_path_buf)
        .ok_or_else(|| ApplyError::Rejected("configuration plan has no lock root".to_string()))?;
    let locked =
        crate::storage::with_storage_lock(&lock_root.join("account-configuration"), || {
            apply_plan_locked(
                plan,
                plan_handle,
                account_epoch,
                process_generation,
                now_epoch_seconds,
            )
            .map_err(|error| match error {
                ApplyError::ConcurrentEdit => "account-config:concurrent-edit".to_string(),
                ApplyError::RollbackIncomplete => "account-config:rollback-incomplete".to_string(),
                ApplyError::Rejected(message) => format!("account-config:rejected:{message}"),
            })
        });
    match locked {
        Ok(value) => Ok(value),
        Err(error) if error == "account-config:concurrent-edit" => Err(ApplyError::ConcurrentEdit),
        Err(error) if error == "account-config:rollback-incomplete" => {
            Err(ApplyError::RollbackIncomplete)
        }
        Err(error) => Err(ApplyError::Rejected(
            error
                .strip_prefix("account-config:rejected:")
                .unwrap_or(&error)
                .to_string(),
        )),
    }
}

fn apply_plan_locked(
    plan: &ConfigurationPlanState,
    plan_handle: &str,
    account_epoch: u64,
    process_generation: u64,
    now_epoch_seconds: i64,
) -> Result<Value, ApplyError> {
    preflight_plan(plan, plan_handle, now_epoch_seconds)?;

    let originals = plan
        .files
        .iter()
        .map(|file| read_optional_file(&file.path).map(|content| (file.path.clone(), content)))
        .collect::<Result<Vec<_>, _>>()
        .map_err(ApplyError::Rejected)?;
    let recovery = RecoveryJournal::create(plan, &originals).map_err(ApplyError::Rejected)?;
    let mut written = Vec::new();
    for (index, file) in plan.files.iter().enumerate() {
        if hash_optional(Some(&file.content)) == file.expected_hash {
            continue;
        }
        if let Err(error) = atomic_write(&file.path, &file.content) {
            let rollback_ok = rollback_files(&written, &originals).is_ok();
            let _ = if rollback_ok {
                recovery.discard()
            } else {
                recovery.mark_recovery_required()
            };
            return if rollback_ok {
                Err(ApplyError::Rejected(error))
            } else {
                Err(ApplyError::RollbackIncomplete)
            };
        }
        written.push(file.path.clone());
        recovery
            .checkpoint(index + 1)
            .map_err(ApplyError::Rejected)?;
    }

    if let Err(error) = verify_applied_plan(plan) {
        if rollback_files(&written, &originals).is_ok() {
            let _ = recovery.discard();
            return Err(ApplyError::Rejected(error));
        }
        let _ = recovery.mark_recovery_required();
        return Err(ApplyError::RollbackIncomplete);
    }
    recovery.mark_verified().map_err(ApplyError::Rejected)?;

    let result_handle = bound_handle(
        "config-result",
        "codex-configuration",
        account_epoch,
        process_generation,
        now_epoch_seconds.saturating_add(3_600),
        &uuid::Uuid::new_v4().simple().to_string(),
    );
    Ok(json!({
        "result": result_handle,
        "overall": if written.is_empty() { "unchanged" } else { "applied" },
        "files": plan.files.iter().map(|file| json!({
            "targetLabel": file.label,
            "outcome": if written.contains(&file.path) { "applied" } else { "unchanged" },
        })).collect::<Vec<_>>(),
        "reload": {
            "requirement": "newSessions",
            "status": "pending",
        },
        "verification": "usable",
        "acknowledged": false,
    }))
}

struct RecoveryJournal {
    directory: PathBuf,
    journal_path: PathBuf,
}

impl RecoveryJournal {
    fn create(
        plan: &ConfigurationPlanState,
        originals: &[(PathBuf, Option<String>)],
    ) -> Result<Self, String> {
        let lock_root = plan
            .files
            .first()
            .and_then(|file| file.path.parent())
            .ok_or_else(|| "configuration recovery root is unavailable".to_string())?;
        let directory = lock_root
            .join("account-configuration-recovery")
            .join(uuid::Uuid::new_v4().simple().to_string());
        fs::create_dir_all(&directory).map_err(|error| {
            format!("failed to create configuration recovery directory: {error}")
        })?;
        protect_owner_only(&directory)?;
        for (index, (_, content)) in originals.iter().enumerate() {
            if let Some(content) = content {
                atomic_write(&directory.join(format!("slot-{index}.backup")), content)?;
            }
        }
        let journal_path = directory.join("journal.json");
        let recipe_id = if plan
            .files
            .iter()
            .any(|file| file.label == "Doge Claude provider registry")
        {
            "doge.account.claude-code-token-service"
        } else {
            ACCOUNT_RECIPE_ID
        };
        let journal = json!({
            "version": 1,
            "recipeId": recipe_id,
            "fileCount": plan.files.len(),
            "originalPresent": originals.iter().map(|(_, value)| value.is_some()).collect::<Vec<_>>(),
            "checkpoint": 0,
            "state": "applying",
        });
        atomic_write(
            &journal_path,
            &serde_json::to_string(&journal)
                .map_err(|_| "failed to encode configuration journal".to_string())?,
        )?;
        Ok(Self {
            directory,
            journal_path,
        })
    }

    fn checkpoint(&self, checkpoint: usize) -> Result<(), String> {
        self.write_state(checkpoint, "applying")
    }

    fn mark_recovery_required(&self) -> Result<(), String> {
        self.write_state(0, "recoveryRequired")
    }

    fn write_state(&self, checkpoint: usize, state: &str) -> Result<(), String> {
        let content = fs::read_to_string(&self.journal_path)
            .map_err(|error| format!("failed to read configuration journal: {error}"))?;
        let mut journal: Value = serde_json::from_str(&content)
            .map_err(|_| "configuration journal is corrupt".to_string())?;
        let object = journal
            .as_object_mut()
            .ok_or_else(|| "configuration journal is invalid".to_string())?;
        object.insert("checkpoint".to_string(), json!(checkpoint));
        object.insert("state".to_string(), json!(state));
        atomic_write(
            &self.journal_path,
            &serde_json::to_string(&journal)
                .map_err(|_| "failed to encode configuration journal".to_string())?,
        )
    }

    fn mark_verified(&self) -> Result<(), String> {
        self.write_state(usize::MAX, "verified")
    }

    fn discard(self) -> Result<(), String> {
        fs::remove_dir_all(&self.directory)
            .map_err(|error| format!("failed to remove configuration recovery directory: {error}"))
    }
}

pub(crate) fn commit_completed_transactions() -> Result<(), String> {
    let doge_config_path = crate::app_paths::config_file_path()?;
    let root = doge_config_path
        .parent()
        .ok_or_else(|| "configuration recovery root is unavailable".to_string())?
        .join("account-configuration-recovery");
    commit_completed_transactions_at(&root)
}

pub(super) fn commit_completed_transactions_at(root: &Path) -> Result<(), String> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "failed to inspect completed configuration transactions: {error}"
            ))
        }
    };
    for entry in entries {
        let directory = entry
            .map_err(|error| format!("failed to inspect completed configuration entry: {error}"))?
            .path();
        let content = match fs::read_to_string(directory.join("journal.json")) {
            Ok(content) => content,
            Err(_) => continue,
        };
        let journal: Value = match serde_json::from_str(&content) {
            Ok(journal) => journal,
            Err(_) => continue,
        };
        if journal.get("state").and_then(Value::as_str) == Some("verified") {
            fs::remove_dir_all(&directory).map_err(|error| {
                format!("failed to clear completed configuration transaction: {error}")
            })?;
        }
    }
    Ok(())
}

fn protect_owner_only(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|error| {
            format!("failed to protect configuration recovery directory: {error}")
        })?;
    }
    Ok(())
}

fn verify_applied_plan(plan: &ConfigurationPlanState) -> Result<(), String> {
    for file in &plan.files {
        let content = read_optional_file(&file.path)?
            .ok_or_else(|| "configuration verification target is absent".to_string())?;
        if hash_optional(Some(&content)) != hash_optional(Some(&file.content)) {
            return Err("configuration verification fingerprint mismatch".to_string());
        }
        if file.label == "Doge provider registry" {
            let root: Value = serde_json::from_str(&content)
                .map_err(|_| "configured Doge provider registry is invalid".to_string())?;
            let provider = root
                .pointer("/codex/providers/doge-token-matrix")
                .ok_or_else(|| "configured Doge provider is missing".to_string())?;
            if provider.get("source").and_then(Value::as_str) != Some("doge-account") {
                return Err("configured Doge provider ownership is invalid".to_string());
            }
        } else if file.label == "Doge Claude provider registry" {
            let root: Value = serde_json::from_str(&content)
                .map_err(|_| "configured Doge provider registry is invalid".to_string())?;
            let provider = root
                .pointer("/claude/providers/doge-token-matrix")
                .ok_or_else(|| "configured Claude provider is missing".to_string())?;
            if provider.get("source").and_then(Value::as_str) != Some("doge-account")
                || provider
                    .pointer("/settingsConfig/env/ANTHROPIC_AUTH_TOKEN")
                    .is_some()
            {
                return Err("configured Claude provider ownership is invalid".to_string());
            }
        } else {
            let parsed: toml::Value = toml::from_str(&content)
                .map_err(|_| "configured Codex settings are invalid".to_string())?;
            if parsed.get("model_provider").and_then(toml::Value::as_str) != Some("DogeTokenMatrix")
            {
                return Err("configured Codex provider binding is invalid".to_string());
            }
        }
    }
    Ok(())
}

pub(crate) fn preflight_plan(
    plan: &ConfigurationPlanState,
    plan_handle: &str,
    now_epoch_seconds: i64,
) -> Result<(), ApplyError> {
    validate_live_plan(plan, plan_handle, now_epoch_seconds).map_err(ApplyError::Rejected)?;
    for file in &plan.files {
        reject_unsafe_target(&file.path).map_err(ApplyError::Rejected)?;
        let current = read_optional_file(&file.path).map_err(ApplyError::Rejected)?;
        if hash_optional(current.as_deref()) != file.expected_hash {
            return Err(ApplyError::ConcurrentEdit);
        }
    }
    Ok(())
}

pub(crate) enum ApplyError {
    ConcurrentEdit,
    RollbackIncomplete,
    Rejected(String),
}

pub(crate) fn recover_interrupted_transactions() -> Result<Option<Value>, String> {
    let doge_config_path = crate::app_paths::config_file_path()?;
    let provider_config_path = crate::app_paths::codex_provider_homes_dir()?
        .join(ACCOUNT_CODEX_PROVIDER_ID)
        .join("config.toml");
    let root = doge_config_path
        .parent()
        .ok_or_else(|| "configuration recovery root is unavailable".to_string())?
        .join("account-configuration-recovery");
    recover_interrupted_transactions_at(&root, &[doge_config_path, provider_config_path])
}

pub(super) fn recover_interrupted_transactions_at(
    root: &Path,
    targets: &[PathBuf],
) -> Result<Option<Value>, String> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("failed to inspect configuration recovery: {error}")),
    };
    let mut outcomes = Vec::new();
    let mut incomplete = false;
    for entry in entries {
        let entry = entry.map_err(|error| format!("failed to inspect recovery entry: {error}"))?;
        let directory = entry.path();
        let journal_path = directory.join("journal.json");
        let content = match fs::read_to_string(&journal_path) {
            Ok(content) => content,
            Err(_) => {
                incomplete = true;
                continue;
            }
        };
        let journal: Value = match serde_json::from_str(&content) {
            Ok(journal) => journal,
            Err(_) => {
                incomplete = true;
                continue;
            }
        };
        let file_count = journal
            .get("fileCount")
            .and_then(Value::as_u64)
            .and_then(|value| usize::try_from(value).ok())
            .filter(|value| *value > 0 && *value <= targets.len())
            .unwrap_or(targets.len());
        if journal.get("state").and_then(Value::as_str) == Some("verified") {
            for (index, _) in targets.iter().take(file_count).enumerate() {
                outcomes.push(json!({
                    "targetLabel": if index == 0 { "Doge provider registry" } else { "Codex settings" },
                    "outcome": "applied",
                }));
            }
            // Keep the verified journal until the safe SQLite receipt is durable.
            // AccountRuntime commits it only after save_configuration_result succeeds.
            continue;
        }
        let original_present = journal
            .get("originalPresent")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut transaction_ok = true;
        for (index, target) in targets.iter().take(file_count).enumerate().rev() {
            let existed = original_present
                .get(index)
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let restored = if existed {
                fs::read_to_string(directory.join(format!("slot-{index}.backup")))
                    .and_then(|backup| atomic_write(target, &backup).map_err(std::io::Error::other))
                    .is_ok()
            } else if target.exists() {
                fs::remove_file(target).is_ok()
            } else {
                true
            };
            transaction_ok &= restored;
            outcomes.push(json!({
                "targetLabel": if index == 0 { "Doge provider registry" } else { "Codex settings" },
                "outcome": if restored { "rolledBack" } else { "rollbackFailed" },
            }));
        }
        if transaction_ok {
            let _ = fs::remove_dir_all(&directory);
        } else {
            incomplete = true;
        }
    }
    if outcomes.is_empty() && !incomplete {
        return Ok(None);
    }
    let applied = !outcomes.is_empty()
        && outcomes
            .iter()
            .all(|outcome| outcome.get("outcome").and_then(Value::as_str) == Some("applied"));
    Ok(Some(json!({
        "result": bound_handle(
            "config-result",
            "codex-configuration",
            0,
            1,
            chrono::Utc::now().timestamp().saturating_add(86_400),
            &uuid::Uuid::new_v4().simple().to_string(),
        ),
        "overall": if incomplete { "rollbackIncomplete" } else if applied { "applied" } else { "rolledBack" },
        "files": outcomes,
        "reload": if applied {
            json!({ "requirement": "newSessions", "status": "pending" })
        } else {
            json!({ "requirement": "none", "status": "notNeeded" })
        },
        "verification": if incomplete { "failed" } else if applied { "usable" } else { "notRequired" },
        "acknowledged": false,
    })))
}

pub(crate) fn rebind_result_handle(
    mut result: Value,
    account_epoch: u64,
    process_generation: u64,
    now_epoch_seconds: i64,
) -> Result<Value, String> {
    let object = result
        .as_object_mut()
        .ok_or_else(|| "configuration result is invalid".to_string())?;
    object.insert(
        "result".to_string(),
        Value::String(bound_handle(
            "config-result",
            "codex-configuration",
            account_epoch,
            process_generation,
            now_epoch_seconds.saturating_add(86_400),
            &uuid::Uuid::new_v4().simple().to_string(),
        )),
    );
    Ok(result)
}

fn validate_live_plan(
    plan: &ConfigurationPlanState,
    plan_handle: &str,
    now_epoch_seconds: i64,
) -> Result<(), String> {
    if plan.handle != plan_handle {
        return Err("configuration plan handle mismatch".to_string());
    }
    if plan.expires_at_epoch_seconds <= now_epoch_seconds {
        return Err("configuration plan expired".to_string());
    }
    Ok(())
}

pub(super) fn build_doge_config(before: Option<&str>) -> Result<String, String> {
    let mut root = match before.map(str::trim).filter(|value| !value.is_empty()) {
        Some(content) => serde_json::from_str::<Value>(content)
            .map_err(|_| "Doge configuration is not valid JSON".to_string())?,
        None => json!({}),
    };
    let root_object = root
        .as_object_mut()
        .ok_or_else(|| "Doge configuration root must be an object".to_string())?;
    let codex = object_child(root_object, "codex")?;
    let providers = object_child(codex, "providers")?;
    providers.insert(
        ACCOUNT_CODEX_PROVIDER_ID.to_string(),
        json!({
            "id": ACCOUNT_CODEX_PROVIDER_ID,
            "name": "Doge Token Matrix",
            "remark": "Managed by Doge Account",
            "source": "doge-account",
            "configToml": ACCOUNT_CODEX_CONFIG_TOML,
        }),
    );
    codex.insert(
        "current".to_string(),
        Value::String(ACCOUNT_CODEX_PROVIDER_ID.to_string()),
    );
    serde_json::to_string_pretty(&root)
        .map(|content| format!("{content}\n"))
        .map_err(|_| "failed to serialize Doge configuration".to_string())
}

pub(super) fn build_doge_config_for_claude(before: Option<&str>) -> Result<String, String> {
    let mut root = match before.map(str::trim).filter(|value| !value.is_empty()) {
        Some(content) => serde_json::from_str::<Value>(content)
            .map_err(|_| "Doge configuration is not valid JSON".to_string())?,
        None => json!({}),
    };
    let root_object = root
        .as_object_mut()
        .ok_or_else(|| "Doge configuration root must be an object".to_string())?;
    let claude = object_child(root_object, "claude")?;
    let providers = object_child(claude, "providers")?;
    providers.insert(
        ACCOUNT_CLAUDE_PROVIDER_ID.to_string(),
        json!({
            "id": ACCOUNT_CLAUDE_PROVIDER_ID,
            "name": "Doge Token Matrix",
            "remark": "Managed by Doge Account",
            "source": "doge-account",
            "settingsConfig": {
                "env": {
                    "ANTHROPIC_BASE_URL": "https://token-matrix.com",
                    "DOGE_MANAGED_ACCOUNT_ENGINE": "claude-code"
                }
            }
        }),
    );
    claude.insert(
        "current".to_string(),
        Value::String(ACCOUNT_CLAUDE_PROVIDER_ID.to_string()),
    );
    serde_json::to_string_pretty(&root)
        .map(|content| format!("{content}\n"))
        .map_err(|_| "failed to serialize Doge configuration".to_string())
}

fn object_child<'a>(
    parent: &'a mut Map<String, Value>,
    key: &str,
) -> Result<&'a mut Map<String, Value>, String> {
    if !parent.contains_key(key) {
        parent.insert(key.to_string(), json!({}));
    }
    parent
        .get_mut(key)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| format!("Doge configuration field {key} must be an object"))
}

fn safe_change(field: &str, after: &str) -> Value {
    json!({
        "kind": "change",
        "fieldLabel": field,
        "before": { "kind": "redacted", "label": "userValue" },
        "after": { "kind": "safeText", "text": after },
    })
}

fn safe_secret_change(field: &str) -> Value {
    json!({
        "kind": "change",
        "fieldLabel": field,
        "before": { "kind": "redacted", "label": "userValue" },
        "after": { "kind": "redacted", "label": "managedCredential" },
    })
}

fn read_optional_file(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("failed to read configuration target: {error}")),
    }
}

fn reject_unsafe_target(path: &Path) -> Result<(), String> {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("configuration target is not a regular file".to_string());
        }
    }
    if let Some(parent) = path.parent() {
        if let Ok(metadata) = fs::symlink_metadata(parent) {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("configuration target parent is unsafe".to_string());
            }
        }
    }
    Ok(())
}

fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "configuration target has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create configuration directory: {error}"))?;
    reject_unsafe_target(path)?;
    let temporary = parent.join(format!(".doge-account-{}.tmp", uuid::Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut staged = options
        .open(&temporary)
        .map_err(|error| format!("failed to stage configuration: {error}"))?;
    {
        use std::io::Write;
        staged
            .write_all(content.as_bytes())
            .map_err(|error| format!("failed to write staged configuration: {error}"))?;
        staged
            .sync_all()
            .map_err(|error| format!("failed to sync staged configuration: {error}"))?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("failed to protect staged configuration: {error}"))?;
    }
    fs::rename(&temporary, path)
        .map_err(|error| format!("failed to commit configuration: {error}"))?;
    #[cfg(unix)]
    fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("failed to sync configuration directory: {error}"))?;
    Ok(())
}

fn rollback_files(
    written: &[PathBuf],
    originals: &[(PathBuf, Option<String>)],
) -> Result<(), String> {
    for path in written.iter().rev() {
        let original = originals
            .iter()
            .find(|(candidate, _)| candidate == path)
            .and_then(|(_, content)| content.as_deref());
        if let Some(content) = original {
            atomic_write(path, content)?;
        } else if path.exists() {
            fs::remove_file(path).map_err(|error| {
                format!("failed to remove new configuration during rollback: {error}")
            })?;
        }
    }
    Ok(())
}

pub(super) fn hash_optional(content: Option<&str>) -> String {
    let mut hasher = Sha256::new();
    match content {
        Some(content) => {
            hasher.update([1]);
            hasher.update(content.as_bytes());
        }
        None => hasher.update([0]),
    }
    format!("{:x}", hasher.finalize())
}

fn bound_handle(
    kind: &str,
    purpose: &str,
    account_epoch: u64,
    process_generation: u64,
    expires_at: i64,
    nonce: &str,
) -> String {
    format!("handle~{kind}~{purpose}~e{account_epoch}~g{process_generation}~x{expires_at}~{nonce}")
}
