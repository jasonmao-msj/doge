use super::persistence::*;
use rusqlite::Connection;
use sha2::{Digest, Sha256};

fn temporary_repository() -> AccountRepository {
    let path = std::env::temp_dir().join(format!(
        "doge-account-persistence-{}.sqlite3",
        uuid::Uuid::new_v4()
    ));
    AccountRepository::open(path).expect("open Account repository")
}

#[test]
fn session_and_dismissal_round_trip_without_secrets() {
    let repository = temporary_repository();
    let metadata = AccountMetadata {
        authority_origin_id: Some("authority_token-matrix-production-v1".to_string()),
        account_link_id: Some("link_0123456789abcdef0123456789abcdef".to_string()),
        device_id: Some("device_0123456789abcdef0123456789abcdef".to_string()),
        account_epoch: 4,
        profile_label: "Token service account".to_string(),
        primary_email_label: Some("u***@example.invalid".to_string()),
        session_status: "active".to_string(),
        vault_scope: Some("abc12345".to_string()),
        managed_key_id: Some(42),
        updated_at: "2030-01-01T00:00:00Z".to_string(),
    };
    repository.save_session(&metadata).expect("save");
    assert_eq!(repository.read_session().expect("read"), Some(metadata));
    repository
        .set_dismissed(
            "authority_token-matrix-production-v1",
            "link_0123456789abcdef0123456789abcdef",
            "device_0123456789abcdef0123456789abcdef",
            true,
            "2030-01-01T00:00:01Z",
        )
        .expect("dismiss");
    assert!(repository
        .is_dismissed(
            "authority_token-matrix-production-v1",
            "link_0123456789abcdef0123456789abcdef",
            "device_0123456789abcdef0123456789abcdef",
        )
        .expect("read dismissal"));
    assert!(!repository
        .is_dismissed(
            "authority_token-matrix-production-v1",
            "link_ffffffffffffffffffffffffffffffff",
            "device_0123456789abcdef0123456789abcdef",
        )
        .expect("other account dismissal"));
    let bytes = std::fs::read(repository.path()).expect("read database bytes");
    let text = String::from_utf8_lossy(&bytes);
    assert!(!text.contains("refresh_token"));
    assert!(!text.contains("OPENAI_API_KEY"));
    let _ = std::fs::remove_file(repository.path());
}

#[test]
fn configuration_result_ack_survives_handle_rebinding_write() {
    let repository = temporary_repository();
    let path = repository.path().to_path_buf();
    let result = serde_json::json!({
        "result": "handle~config-result~codex-configuration~e1~g1~x1900100000~0123456789abcdef",
        "overall": "applied",
        "files": [],
        "reload": { "requirement": "newSessions", "status": "pending" },
        "verification": "usable",
        "acknowledged": false,
    });
    repository
        .save_configuration_result(
            "link_0123456789abcdef0123456789abcdef",
            "device_0123456789abcdef0123456789abcdef",
            &result,
            false,
            1_900_000_000,
        )
        .expect("save result");
    repository
        .acknowledge_configuration_result(
            "handle~config-result~codex-configuration~e1~g1~x1900100000~0123456789abcdef",
        )
        .expect("ack");
    let acknowledged = repository
        .read_configuration_result(
            "link_0123456789abcdef0123456789abcdef",
            "device_0123456789abcdef0123456789abcdef",
        )
        .expect("read")
        .expect("result");
    assert_eq!(
        acknowledged.get("acknowledged"),
        Some(&serde_json::Value::Bool(true))
    );
    repository
        .save_configuration_result(
            "link_0123456789abcdef0123456789abcdef",
            "device_0123456789abcdef0123456789abcdef",
            &acknowledged,
            false,
            1_900_000_001,
        )
        .expect("rebind write");
    assert_eq!(
        repository
            .read_configuration_result(
                "link_0123456789abcdef0123456789abcdef",
                "device_0123456789abcdef0123456789abcdef",
            )
            .expect("read again")
            .expect("result")
            .get("acknowledged"),
        Some(&serde_json::Value::Bool(true)),
    );
    let _ = std::fs::remove_file(path);
}

#[test]
fn newer_schema_fails_closed() {
    let path = std::env::temp_dir().join(format!(
        "doge-account-newer-schema-{}.sqlite3",
        uuid::Uuid::new_v4()
    ));
    let connection = Connection::open(&path).expect("open");
    connection
        .pragma_update(None, "user_version", 9)
        .expect("version");
    drop(connection);
    let error = AccountRepository::open(path.clone())
        .err()
        .expect("newer schema must be rejected");
    assert!(error.contains("newer"));
    let _ = std::fs::remove_file(path);
}

#[test]
fn local_logout_can_preserve_managed_key_metadata_without_preserving_session() {
    let repository = temporary_repository();
    repository
        .save_session(&AccountMetadata {
            authority_origin_id: Some("authority_token-matrix-production-v1".to_string()),
            account_link_id: Some("link_0123456789abcdef0123456789abcdef".to_string()),
            device_id: Some("device_0123456789abcdef0123456789abcdef".to_string()),
            account_epoch: 2,
            profile_label: "Token service account".to_string(),
            primary_email_label: Some("u***@example.invalid".to_string()),
            session_status: "active".to_string(),
            vault_scope: Some("abc12345".to_string()),
            managed_key_id: Some(42),
            updated_at: "2030-01-01T00:00:00Z".to_string(),
        })
        .expect("save");
    repository
        .clear_session_preserving_managed_key("2030-01-01T00:00:01Z")
        .expect("clear");
    let metadata = repository.read_session().expect("read").expect("metadata");
    assert_eq!(metadata.session_status, "signedOut");
    assert_eq!(metadata.vault_scope.as_deref(), Some("abc12345"));
    assert_eq!(metadata.managed_key_id, Some(42));
    let _ = std::fs::remove_file(repository.path());
}

#[test]
fn managed_key_binding_isolated_by_authority_account_and_device() {
    let repository = temporary_repository();
    let authority = "authority_token-matrix-production-v1";
    let account_a = "link_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    let account_b = "link_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    let device = "device_0123456789abcdef0123456789abcdef";
    let binding = ManagedKeyBinding {
        authority_origin_id: authority.to_string(),
        account_link_id: account_a.to_string(),
        device_id: device.to_string(),
        vault_scope: "scopeaaa1".to_string(),
        managed_key_id: 41,
    };
    repository
        .save_managed_key_state(
            &binding,
            &AccountMetadata {
                authority_origin_id: Some(authority.to_string()),
                account_link_id: Some(account_a.to_string()),
                device_id: Some(device.to_string()),
                account_epoch: 3,
                profile_label: "Account A".to_string(),
                primary_email_label: None,
                session_status: "active".to_string(),
                vault_scope: Some(binding.vault_scope.clone()),
                managed_key_id: Some(binding.managed_key_id),
                updated_at: "2030-01-01T00:00:00Z".to_string(),
            },
            1_900_000_000,
        )
        .expect("save account A binding");

    assert_eq!(
        repository
            .read_managed_key_binding(authority, account_a, device)
            .expect("read account A binding"),
        Some(binding),
    );
    assert_eq!(
        repository
            .read_managed_key_binding(authority, account_b, device)
            .expect("read account B binding"),
        None,
    );
    assert_eq!(
        repository
            .read_managed_key_binding("authority_other-production-v1", account_a, device,)
            .expect("read other authority binding"),
        None,
    );
    assert_eq!(
        repository
            .read_managed_key_binding(
                authority,
                account_a,
                "device_ffffffffffffffffffffffffffffffff",
            )
            .expect("read other device binding"),
        None,
    );
    let _ = std::fs::remove_file(repository.path());
}

#[test]
fn external_flow_persists_only_digest_and_expires_pending_on_restart() {
    let repository = temporary_repository();
    let path = repository.path().to_path_buf();
    let raw_handle = "handle~oauth-attempt~oauth~e3~g17~x1893456060~synthetic-secret-handle-canary";
    let digest = format!("sha256:{:x}", Sha256::digest(raw_handle.as_bytes()));
    let secret_canaries = [
        raw_handle,
        "synthetic-state-canary",
        "synthetic-nonce-canary",
        "synthetic-pkce-canary",
        "synthetic-ticket-canary",
        "http://127.0.0.1:45678/doge-account/v1/callback/secret",
    ];
    repository
        .save_external_flow(&ExternalFlowRecord {
            handle_digest: digest.clone(),
            purpose: "oauth".to_string(),
            state_class: "waiting".to_string(),
            account_epoch: 3,
            process_generation: 17,
            status: "pending".to_string(),
            expires_at: 1_893_456_060,
            updated_at: 1_893_456_000,
        })
        .expect("save safe external flow");
    assert_eq!(
        repository
            .read_external_flow(&digest)
            .expect("read external flow")
            .expect("external flow")
            .status,
        "pending",
    );
    repository
        .connect()
        .expect("checkpoint connection")
        .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .expect("checkpoint safe metadata");
    let bytes = std::fs::read(&path).expect("read Account database");
    let text = String::from_utf8_lossy(&bytes);
    assert!(text.contains(&digest));
    for canary in secret_canaries {
        assert!(!text.contains(canary), "database leaked {canary}");
    }
    drop(repository);

    let reopened = AccountRepository::open(path.clone()).expect("reopen external-flow store");
    assert_eq!(reopened.expire_pending_external_flows(1_893_456_010), Ok(1));
    let expired = reopened
        .read_external_flow(&digest)
        .expect("read expired flow")
        .expect("expired flow");
    assert_eq!(expired.state_class, "terminal");
    assert_eq!(expired.status, "expired");
    let version: i32 = reopened
        .connect()
        .expect("schema connection")
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .expect("schema version");
    assert_eq!(version, ACCOUNT_DATABASE_VERSION);
    let _ = std::fs::remove_file(path);
}

#[test]
fn external_flow_terminal_receipt_is_idempotent_but_conflicts_fail_closed() {
    let repository = temporary_repository();
    let digest = format!("sha256:{}", "a".repeat(64));
    repository
        .save_external_flow(&ExternalFlowRecord {
            handle_digest: digest.clone(),
            purpose: "oauth".to_string(),
            state_class: "waiting".to_string(),
            account_epoch: 3,
            process_generation: 17,
            status: "pending".to_string(),
            expires_at: 1_893_456_060,
            updated_at: 1_893_456_000,
        })
        .expect("save external flow");
    repository
        .settle_external_flow(&digest, "terminal", "consumed", 1_893_456_010)
        .expect("consume external flow");
    repository
        .settle_external_flow(&digest, "terminal", "consumed", 1_893_456_011)
        .expect("idempotent consume replay");
    assert!(repository
        .settle_external_flow(&digest, "terminal", "cancelled", 1_893_456_012)
        .is_err());
    assert_eq!(
        repository
            .read_external_flow(&digest)
            .expect("read receipt")
            .expect("receipt")
            .status,
        "consumed",
    );
    let _ = std::fs::remove_file(repository.path());
}

#[test]
fn operation_ledger_survives_restart_and_recovers_interrupted_execution() {
    let repository = temporary_repository();
    let path = repository.path().to_path_buf();
    let accepted = AcceptedOperationRecord {
        operation_id: "operation_0123456789abcdef".to_string(),
        request_id: "request_0123456789abcdef".to_string(),
        intent_id: "intent_0123456789abcdef".to_string(),
        operation: "configuration.apply".to_string(),
        account_epoch: 7,
        request_fingerprint: "a".repeat(64),
        status: "accepted".to_string(),
        outcome: None,
        accepted_at: 1_900_000_000,
    };
    repository.accept_operation(&accepted).expect("accept");
    repository
        .mark_operation_executing(&accepted.operation_id, 1_900_000_001)
        .expect("mark executing");
    drop(repository);

    let reopened = AccountRepository::open(path.clone()).expect("reopen");
    assert_eq!(
        reopened
            .recover_interrupted_operations(1_900_000_002)
            .unwrap(),
        1
    );
    let recovered = reopened
        .read_operation_by_intent(&accepted.intent_id)
        .expect("read")
        .expect("operation");
    assert_eq!(recovered.status, "terminal");
    assert_eq!(recovered.outcome.as_deref(), Some("outcomeUnknown"));
    let _ = std::fs::remove_file(path);
}

#[test]
fn operation_ledger_reuses_acceptance_for_semantic_retry_and_rejects_rebinding() {
    let repository = temporary_repository();
    let path = repository.path().to_path_buf();
    let accepted = AcceptedOperationRecord {
        operation_id: "operation_0123456789abcdef".to_string(),
        request_id: "request_0123456789abcdef".to_string(),
        intent_id: "intent_0123456789abcdef".to_string(),
        operation: "managedKey.provision".to_string(),
        account_epoch: 2,
        request_fingerprint: "b".repeat(64),
        status: "accepted".to_string(),
        outcome: None,
        accepted_at: 1_900_000_000,
    };
    repository.accept_operation(&accepted).expect("accept");
    let mut retry = accepted.clone();
    retry.operation_id = "operation_fedcba9876543210".to_string();
    retry.request_id = "request_fedcba9876543210".to_string();
    let reused = repository.accept_operation(&retry).expect("reuse");
    assert_eq!(reused.operation_id, accepted.operation_id);
    let mut rebound = retry;
    rebound.request_fingerprint = "c".repeat(64);
    assert!(repository.accept_operation(&rebound).is_err());
    let _ = std::fs::remove_file(path);
}
