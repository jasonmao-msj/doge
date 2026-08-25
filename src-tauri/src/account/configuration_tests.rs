use super::configuration::*;
use serde_json::{json, Value};
use std::fs;

#[test]
fn atomic_write_replaces_an_existing_user_profile_target() {
    let root = std::env::temp_dir().join(format!(
        "doge-account-existing-config-test-{}",
        uuid::Uuid::new_v4()
    ));
    let target = root.join(".doge/config.json");
    fs::create_dir_all(target.parent().expect("target parent")).expect("create profile dir");
    fs::write(&target, "before").expect("write existing config");

    atomic_write(&target, "after").expect("replace existing config as current user");

    assert_eq!(
        fs::read_to_string(&target).expect("read replaced config"),
        "after"
    );
    assert_eq!(
        fs::read_dir(target.parent().expect("target parent"))
            .expect("read profile dir")
            .count(),
        1,
        "staged temporary files must be cleaned"
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn provider_recipe_has_fixed_authority_and_no_secret() {
    assert!(ACCOUNT_CODEX_CONFIG_TOML.contains("name = \"Doge\""));
    assert!(!ACCOUNT_CODEX_CONFIG_TOML.contains("name = \"Doge Token Matrix\""));
    assert!(ACCOUNT_CODEX_CONFIG_TOML.contains("https://token-matrix.com"));
    assert!(ACCOUNT_CODEX_CONFIG_TOML.contains("wire_api = \"responses\""));
    assert!(ACCOUNT_CODEX_CONFIG_TOML.contains("env_key = \"OPENAI_API_KEY\""));
    assert!(!ACCOUNT_CODEX_CONFIG_TOML.contains("sk-"));
    assert!(!ACCOUNT_CODEX_CONFIG_TOML.contains("auth.json"));
}

#[test]
fn config_merge_preserves_unrelated_root_data_and_never_writes_auth_json() {
    let merged = build_doge_config(Some(
        r#"{"unknown":{"keep":true},"codex":{"providers":{}}}"#,
    ))
    .expect("merge");
    let value: Value = serde_json::from_str(&merged).expect("json");
    assert_eq!(value["unknown"]["keep"], true);
    assert_eq!(value["codex"]["current"], ACCOUNT_CODEX_PROVIDER_ID);
    let provider = &value["codex"]["providers"][ACCOUNT_CODEX_PROVIDER_ID];
    assert_eq!(provider["name"], "Doge");
    assert!(provider.get("authJson").is_none());
    assert_eq!(provider["source"], "doge-account");
    assert_eq!(
        provider["managedRevision"],
        ACCOUNT_MANAGED_CONFIGURATION_REVISION
    );
}

#[test]
fn claude_managed_provider_uses_a_vault_marker_and_never_persists_the_token() {
    let merged = build_doge_config_for_claude(Some(
        r#"{"unknown":{"keep":true},"claude":{"providers":{}}}"#,
    ))
    .expect("merge Claude provider");
    let value: Value = serde_json::from_str(&merged).expect("json");
    assert_eq!(value["unknown"]["keep"], true);
    assert_eq!(value["claude"]["current"], ACCOUNT_CLAUDE_PROVIDER_ID);
    let provider = &value["claude"]["providers"][ACCOUNT_CLAUDE_PROVIDER_ID];
    assert_eq!(provider["name"], "Doge");
    assert_eq!(provider["source"], "doge-account");
    assert_eq!(
        provider["managedRevision"],
        ACCOUNT_MANAGED_CONFIGURATION_REVISION
    );
    assert_eq!(
        provider["settingsConfig"]["env"]["DOGE_MANAGED_ACCOUNT_ENGINE"],
        "claude-code"
    );
    assert_eq!(
        provider["settingsConfig"]["env"]["ANTHROPIC_BASE_URL"],
        "https://token-matrix.com"
    );
    assert!(provider["settingsConfig"]["env"]
        .get("ANTHROPIC_AUTH_TOKEN")
        .is_none());
    assert!(!merged.contains("sk-"));
}

#[test]
fn kimi_managed_provider_projects_base_url_and_never_persists_the_key() {
    let merged = build_doge_config_for_kimi(Some(
        r#"{"unknown":{"keep":true},"kimi":{"providers":{"doge-token-matrix":{"apiKey":"synthetic-legacy-secret","api_key":"synthetic-legacy-secret","token":"synthetic-legacy-secret","secret":"synthetic-legacy-secret"}}}}"#,
    ))
    .expect("merge Kimi provider");
    let value: Value = serde_json::from_str(&merged).expect("json");
    assert_eq!(value["unknown"]["keep"], true);
    assert_eq!(value["kimi"]["current"], ACCOUNT_KIMI_PROVIDER_ID);
    let provider = &value["kimi"]["providers"][ACCOUNT_KIMI_PROVIDER_ID];
    assert_eq!(provider["name"], "Doge");
    assert_eq!(provider["source"], "doge-account");
    assert_eq!(
        provider["managedRevision"],
        ACCOUNT_MANAGED_CONFIGURATION_REVISION
    );
    assert_eq!(provider["baseUrl"], ACCOUNT_MANAGED_KIMI_BASE_URL);
    assert_eq!(provider["model"], ACCOUNT_MANAGED_KIMI_MODEL);
    assert!(provider.get("apiKey").is_none());
    assert!(provider.get("api_key").is_none());
    assert!(provider.get("token").is_none());
    assert!(provider.get("secret").is_none());
    assert!(!merged.contains("synthetic-legacy-secret"));
    assert!(!merged.contains("sk-"));
}

#[test]
fn managed_projection_replaces_legacy_doge_entries_and_preserves_local_profiles() {
    let legacy = json!({
        "unrelated": { "keep": true },
        "codex": {
            "current": "local-codex",
            "providers": {
                "local-codex": { "id": "local-codex", "source": "local" },
                "doge-token-matrix": {
                    "id": "doge-token-matrix",
                    "name": "Legacy Doge",
                    "source": "legacy-doge",
                    "managedRevision": 0,
                    "configToml": "model_provider = 'legacy'"
                }
            }
        },
        "claude": {
            "current": "local-claude",
            "providers": {
                "local-claude": { "id": "local-claude", "source": "local" },
                "doge-token-matrix": {
                    "id": "doge-token-matrix",
                    "name": "Legacy Doge",
                    "source": "legacy-doge",
                    "managedRevision": 0,
                    "settingsConfig": {
                        "env": {
                            "ANTHROPIC_BASE_URL": "https://openrouter.ai",
                            "ANTHROPIC_AUTH_TOKEN": "synthetic-legacy-secret"
                        }
                    }
                }
            }
        },
        "kimi": {
            "current": "local-kimi",
            "providers": {
                "local-kimi": { "id": "local-kimi", "source": "local" },
                "doge-token-matrix": {
                    "id": "doge-token-matrix",
                    "name": "Legacy Doge",
                    "source": "legacy-doge",
                    "managedRevision": 0,
                    "baseUrl": "https://legacy.invalid/v1",
                    "apiKey": "synthetic-legacy-secret"
                }
            }
        }
    });
    let after_codex = build_doge_config(Some(&legacy.to_string())).expect("upgrade Codex");
    let after_claude = build_doge_config_for_claude(Some(&after_codex)).expect("upgrade Claude");
    let after_kimi = build_doge_config_for_kimi(Some(&after_claude)).expect("upgrade Kimi");
    let value: Value = serde_json::from_str(&after_kimi).expect("upgraded JSON");

    assert_eq!(value["unrelated"]["keep"], true);
    for (engine, local_id) in [
        ("codex", "local-codex"),
        ("claude", "local-claude"),
        ("kimi", "local-kimi"),
    ] {
        assert!(
            value[engine]["providers"][local_id].is_object(),
            "terminal-facing local provider for {engine} must survive"
        );
        let provider = &value[engine]["providers"]["doge-token-matrix"];
        assert_eq!(provider["name"], "Doge");
        assert_eq!(provider["source"], "doge-account");
        assert_eq!(
            provider["managedRevision"],
            ACCOUNT_MANAGED_CONFIGURATION_REVISION
        );
        assert_eq!(value[engine]["current"], "doge-token-matrix");
    }
    assert!(
        value["claude"]["providers"]["doge-token-matrix"]["settingsConfig"]["env"]
            .get("ANTHROPIC_AUTH_TOKEN")
            .is_none()
    );
    assert!(value["kimi"]["providers"]["doge-token-matrix"]
        .get("apiKey")
        .is_none());
    assert!(!after_kimi.contains("synthetic-legacy-secret"));
    assert!(!after_kimi.contains("openrouter.ai"));
}

#[test]
fn managed_registry_verification_rejects_a_stale_projection_revision() {
    let root = std::env::temp_dir().join(format!(
        "doge-account-managed-revision-test-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&root).expect("create revision test root");

    for (index, (label, engine, content)) in [
        (
            "Doge provider registry",
            "codex",
            build_doge_config(None).expect("build Codex registry"),
        ),
        (
            "Doge Claude provider registry",
            "claude",
            build_doge_config_for_claude(None).expect("build Claude registry"),
        ),
        (
            "Doge Kimi provider registry",
            "kimi",
            build_doge_config_for_kimi(None).expect("build Kimi registry"),
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let mut value: Value = serde_json::from_str(&content).expect("parse current registry");
        value[engine]["providers"]["doge-token-matrix"]["managedRevision"] = json!(0);
        let stale = format!(
            "{}\n",
            serde_json::to_string_pretty(&value).expect("serialize stale registry")
        );
        let target = root.join(format!("config-{index}.json"));
        fs::write(&target, &stale).expect("write stale registry");
        let plan = ConfigurationPlanState {
            handle: format!("config-plan-revision-{index}"),
            expires_at_epoch_seconds: i64::MAX,
            files: vec![PlannedFile {
                handle: format!("config-file-revision-{index}"),
                label,
                path: target,
                expected_hash: String::new(),
                content: stale,
            }],
            view: json!({}),
        };

        assert!(
            verify_applied_plan(&plan).is_err(),
            "{engine} stale managed revision must fail closed"
        );
    }

    let _ = fs::remove_dir_all(root);
}

#[test]
fn kimi_registry_verification_uses_json_and_rejects_secret_fields() {
    let root = std::env::temp_dir().join(format!(
        "doge-account-kimi-verifier-test-{}",
        uuid::Uuid::new_v4()
    ));
    let target = root.join("config.json");
    fs::create_dir_all(&root).expect("create verifier root");
    let content = build_doge_config_for_kimi(None).expect("build Kimi registry");
    fs::write(&target, &content).expect("write Kimi registry");
    let plan = ConfigurationPlanState {
        handle: "config-plan_synthetic0001".to_string(),
        expires_at_epoch_seconds: i64::MAX,
        files: vec![PlannedFile {
            handle: "config-file_synthetic0001".to_string(),
            label: "Doge Kimi provider registry",
            path: target,
            expected_hash: String::new(),
            content,
        }],
        view: json!({}),
    };

    verify_applied_plan(&plan).expect("Kimi JSON registry should verify");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn kimi_managed_provider_merge_preserves_unrelated_root_data() {
    let merged = build_doge_config_for_kimi(Some(
        r#"{"codex":{"current":"doge-token-matrix"},"kimi":{"providers":{"local":{"id":"local"}}}}"#,
    ))
    .expect("merge Kimi provider over existing entries");
    let value: Value = serde_json::from_str(&merged).expect("json");
    assert_eq!(value["codex"]["current"], "doge-token-matrix");
    assert!(
        value["kimi"]["providers"]["local"].is_object(),
        "existing local providers must survive the managed projection"
    );
    assert_eq!(value["kimi"]["current"], ACCOUNT_KIMI_PROVIDER_ID);
}

#[test]
fn single_file_claude_recovery_never_touches_the_codex_target() {
    let workspace = std::env::temp_dir().join(format!(
        "doge-account-claude-recovery-test-{}",
        uuid::Uuid::new_v4()
    ));
    let root = workspace.join("recovery");
    let targets = [workspace.join("doge.json"), workspace.join("config.toml")];
    fs::create_dir_all(root.join("tx-applying")).expect("mkdir");
    fs::write(root.join("tx-applying/slot-0.backup"), "before-doge").expect("backup");
    fs::write(
        root.join("tx-applying/journal.json"),
        r#"{"version":1,"recipeId":"doge.account.claude-code-token-service","fileCount":1,"originalPresent":[true],"checkpoint":1,"state":"applying"}"#,
    )
    .expect("journal");
    fs::write(&targets[0], "after-doge").expect("doge target");
    fs::write(&targets[1], "keep-codex").expect("codex target");

    recover_interrupted_transactions_at(&root, &targets).expect("recover");

    assert_eq!(
        fs::read_to_string(&targets[0]).expect("doge"),
        "before-doge"
    );
    assert_eq!(
        fs::read_to_string(&targets[1]).expect("codex"),
        "keep-codex"
    );
    let _ = fs::remove_dir_all(workspace);
}

#[test]
fn planned_file_detail_is_semantic_and_never_exposes_paths_or_credentials() {
    let root =
        std::env::temp_dir().join(format!("doge-account-safe-detail-{}", uuid::Uuid::new_v4()));
    let plan = ConfigurationPlanState {
        handle: "safe-plan".to_string(),
        expires_at_epoch_seconds: 2_000,
        files: vec![PlannedFile {
            handle: "safe-file".to_string(),
            label: "Codex settings",
            path: root.join("credential-bearing-path"),
            expected_hash: hash_optional(None),
            content: ACCOUNT_CODEX_CONFIG_TOML.to_string(),
        }],
        view: json!({ "plan": "safe-plan" }),
    };
    let view = read_file_detail(&plan, "safe-plan", "safe-file", 1_000).expect("safe detail");
    let encoded = serde_json::to_string(&view).expect("encode");
    assert!(!encoded.contains("credential-bearing-path"));
    assert!(!encoded.contains("OPENAI_API_KEY"));
    assert!(!encoded.contains("auth.json"));
    assert!(encoded.contains("Token Matrix"));
}

#[test]
fn interrupted_journal_rolls_back_and_verified_journal_restores_applied_truth() {
    let workspace = std::env::temp_dir().join(format!(
        "doge-account-recovery-test-{}",
        uuid::Uuid::new_v4()
    ));
    let root = workspace.join("recovery");
    let targets = [workspace.join("doge.json"), workspace.join("config.toml")];
    fs::create_dir_all(root.join("tx-applying")).expect("mkdir");
    fs::write(root.join("tx-applying/slot-0.backup"), "before-a").expect("backup a");
    fs::write(root.join("tx-applying/slot-1.backup"), "before-b").expect("backup b");
    fs::write(
            root.join("tx-applying/journal.json"),
            r#"{"version":1,"recipeId":"doge.account.codex-token-service","fileCount":2,"originalPresent":[true,true],"checkpoint":1,"state":"applying"}"#,
        )
        .expect("journal");
    fs::write(&targets[0], "after-a").expect("target a");
    fs::write(&targets[1], "after-b").expect("target b");

    let rolled_back = recover_interrupted_transactions_at(&root, &targets)
        .expect("recover")
        .expect("result");
    assert_eq!(rolled_back["overall"], "rolledBack");
    assert_eq!(fs::read_to_string(&targets[0]).expect("read a"), "before-a");
    assert_eq!(fs::read_to_string(&targets[1]).expect("read b"), "before-b");

    fs::create_dir_all(root.join("tx-verified")).expect("mkdir verified");
    fs::write(
            root.join("tx-verified/journal.json"),
            r#"{"version":1,"recipeId":"doge.account.codex-token-service","fileCount":2,"originalPresent":[true,true],"checkpoint":2,"state":"verified"}"#,
        )
        .expect("verified journal");
    fs::write(&targets[0], "verified-a").expect("verified a");
    fs::write(&targets[1], "verified-b").expect("verified b");

    let applied = recover_interrupted_transactions_at(&root, &targets)
        .expect("recover verified")
        .expect("applied result");
    assert_eq!(applied["overall"], "applied");
    assert_eq!(
        fs::read_to_string(&targets[0]).expect("read a"),
        "verified-a"
    );
    assert_eq!(
        fs::read_to_string(&targets[1]).expect("read b"),
        "verified-b"
    );
    assert!(root.join("tx-verified/journal.json").exists());
    commit_completed_transactions_at(&root).expect("commit verified receipt");
    assert!(!root.join("tx-verified").exists());
    let _ = fs::remove_dir_all(workspace);
}
