use super::configuration::*;
use serde_json::{json, Value};
use std::fs;

#[test]
fn provider_recipe_has_fixed_authority_and_no_secret() {
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
    assert!(provider.get("authJson").is_none());
    assert_eq!(provider["source"], "doge-account");
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
