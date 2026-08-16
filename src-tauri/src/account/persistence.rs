use super::persistence_operations::{
    validate_isolation_id, validate_metadata, validate_vault_scope,
};
use rusqlite::{params, Connection, OpenFlags};
use std::path::PathBuf;

pub(super) const ACCOUNT_DATABASE_VERSION: i32 = 8;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AcceptedOperationRecord {
    pub(crate) operation_id: String,
    pub(crate) request_id: String,
    pub(crate) intent_id: String,
    pub(crate) operation: String,
    pub(crate) account_epoch: u64,
    pub(crate) request_fingerprint: String,
    pub(crate) status: String,
    pub(crate) outcome: Option<String>,
    pub(crate) accepted_at: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct AccountMetadata {
    pub(crate) authority_origin_id: Option<String>,
    pub(crate) account_link_id: Option<String>,
    pub(crate) device_id: Option<String>,
    pub(crate) account_epoch: u64,
    pub(crate) profile_label: String,
    pub(crate) primary_email_label: Option<String>,
    pub(crate) session_status: String,
    pub(crate) vault_scope: Option<String>,
    pub(crate) managed_key_id: Option<i64>,
    pub(crate) updated_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ManagedKeyBinding {
    pub(crate) authority_origin_id: String,
    pub(crate) account_link_id: String,
    pub(crate) device_id: String,
    pub(crate) vault_scope: String,
    pub(crate) managed_key_id: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct ExternalFlowRecord {
    pub(crate) handle_digest: String,
    pub(crate) purpose: String,
    pub(crate) state_class: String,
    pub(crate) account_epoch: u64,
    pub(crate) process_generation: u64,
    pub(crate) status: String,
    pub(crate) expires_at: i64,
    pub(crate) updated_at: i64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct EngineCheckoutRecord {
    pub(crate) authority_origin_id: String,
    pub(crate) account_link_id: String,
    pub(crate) device_id: String,
    pub(crate) engine_id: String,
    pub(crate) checkout_id: i64,
    pub(crate) status: String,
    pub(crate) expires_at: i64,
    pub(crate) updated_at: i64,
}

pub(crate) struct AccountRepository {
    pub(super) path: PathBuf,
}

impl AccountRepository {
    pub(crate) fn open(path: PathBuf) -> Result<Self, String> {
        let repository = Self { path };
        repository.initialize()?;
        Ok(repository)
    }

    pub(super) fn connect(&self) -> Result<Connection, String> {
        Connection::open_with_flags(
            &self.path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )
        .map_err(|error| format!("failed to open Account metadata store: {error}"))
    }

    pub(crate) fn read_session(&self) -> Result<Option<AccountMetadata>, String> {
        let connection = self.connect()?;
        let mut statement = connection
            .prepare(
                "SELECT authority_origin_id, account_link_id, device_id, account_epoch,
                        profile_label, primary_email_label, session_status,
                        vault_scope, managed_key_id, updated_at
                 FROM account_session WHERE singleton = 1",
            )
            .map_err(|error| format!("failed to prepare Account session read: {error}"))?;
        let mut rows = statement
            .query([])
            .map_err(|error| format!("failed to read Account session: {error}"))?;
        let Some(row) = rows
            .next()
            .map_err(|error| format!("failed to decode Account session: {error}"))?
        else {
            return Ok(None);
        };
        let account_epoch: i64 = row
            .get(3)
            .map_err(|error| format!("failed to decode Account epoch: {error}"))?;
        Ok(Some(AccountMetadata {
            authority_origin_id: row
                .get(0)
                .map_err(|error| format!("failed to decode Account authority: {error}"))?,
            account_link_id: row
                .get(1)
                .map_err(|error| format!("failed to decode Account link: {error}"))?,
            device_id: row
                .get(2)
                .map_err(|error| format!("failed to decode Account device: {error}"))?,
            account_epoch: u64::try_from(account_epoch)
                .map_err(|_| "Account epoch is outside the supported range".to_string())?,
            profile_label: row
                .get(4)
                .map_err(|error| format!("failed to decode Account label: {error}"))?,
            primary_email_label: row
                .get(5)
                .map_err(|error| format!("failed to decode Account email label: {error}"))?,
            session_status: row
                .get(6)
                .map_err(|error| format!("failed to decode Account session status: {error}"))?,
            vault_scope: row
                .get(7)
                .map_err(|error| format!("failed to decode Account vault scope: {error}"))?,
            managed_key_id: row
                .get(8)
                .map_err(|error| format!("failed to decode managed key id: {error}"))?,
            updated_at: row
                .get(9)
                .map_err(|error| format!("failed to decode Account update time: {error}"))?,
        }))
    }

    pub(crate) fn load_or_create_device_id(
        &self,
        now_epoch_seconds: i64,
    ) -> Result<String, String> {
        let connection = self.connect()?;
        let existing = connection.query_row(
            "SELECT device_id FROM account_device WHERE singleton = 1",
            [],
            |row| row.get::<_, String>(0),
        );
        match existing {
            Ok(device_id) => return Ok(device_id),
            Err(rusqlite::Error::QueryReturnedNoRows) => {}
            Err(error) => return Err(format!("failed to read Account device identity: {error}")),
        }
        let device_id = format!("device_{}", uuid::Uuid::new_v4().simple());
        connection
            .execute(
                "INSERT INTO account_device (singleton, device_id, created_at) VALUES (1, ?1, ?2)",
                params![device_id, now_epoch_seconds],
            )
            .map_err(|error| format!("failed to persist Account device identity: {error}"))?;
        Ok(device_id)
    }

    pub(crate) fn save_external_flow(&self, record: &ExternalFlowRecord) -> Result<(), String> {
        validate_external_flow(record)?;
        let connection = self.connect()?;
        connection
            .execute(
                "INSERT INTO account_external_flow (
                    handle_digest, purpose, state_class, account_epoch,
                    process_generation, status, expires_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    record.handle_digest,
                    record.purpose,
                    record.state_class,
                    i64::try_from(record.account_epoch)
                        .map_err(|_| "Account epoch is outside the supported range".to_string())?,
                    i64::try_from(record.process_generation).map_err(|_| {
                        "Account process generation is outside the supported range".to_string()
                    })?,
                    record.status,
                    record.expires_at,
                    record.updated_at,
                ],
            )
            .map_err(|error| format!("failed to persist Account external flow: {error}"))?;
        Ok(())
    }

    pub(crate) fn settle_external_flow(
        &self,
        handle_digest: &str,
        state_class: &str,
        status: &str,
        updated_at: i64,
    ) -> Result<(), String> {
        if !valid_handle_digest(handle_digest)
            || !matches!(state_class, "returned" | "terminal")
            || !matches!(status, "pending" | "consumed" | "expired" | "cancelled")
            || updated_at <= 0
        {
            return Err("Account external-flow settlement is invalid".to_string());
        }
        let connection = self.connect()?;
        let changed = connection
            .execute(
                "UPDATE account_external_flow
                 SET state_class = ?2, status = ?3, updated_at = ?4
                 WHERE handle_digest = ?1 AND status = 'pending'",
                params![handle_digest, state_class, status, updated_at],
            )
            .map_err(|error| format!("failed to settle Account external flow: {error}"))?;
        if changed == 1 {
            return Ok(());
        }
        match self.read_external_flow(handle_digest)? {
            Some(record) if record.state_class == state_class && record.status == status => Ok(()),
            Some(_) => Err("Account external-flow terminal state conflicts".to_string()),
            None => Err("Account external flow does not exist".to_string()),
        }
    }

    pub(crate) fn expire_pending_external_flows(&self, updated_at: i64) -> Result<usize, String> {
        let connection = self.connect()?;
        connection
            .execute(
                "UPDATE account_external_flow
                 SET state_class = 'terminal', status = 'expired', updated_at = ?1
                 WHERE status = 'pending'",
                params![updated_at],
            )
            .map_err(|error| format!("failed to expire Account external flows: {error}"))
    }

    pub(crate) fn read_external_flow(
        &self,
        handle_digest: &str,
    ) -> Result<Option<ExternalFlowRecord>, String> {
        if !valid_handle_digest(handle_digest) {
            return Err("Account external-flow digest is invalid".to_string());
        }
        let connection = self.connect()?;
        let row = connection.query_row(
            "SELECT handle_digest, purpose, state_class, account_epoch,
                    process_generation, status, expires_at, updated_at
             FROM account_external_flow WHERE handle_digest = ?1",
            params![handle_digest],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7)?,
                ))
            },
        );
        match row {
            Ok((
                digest,
                purpose,
                state_class,
                epoch,
                generation,
                status,
                expires_at,
                updated_at,
            )) => Ok(Some(ExternalFlowRecord {
                handle_digest: digest,
                purpose,
                state_class,
                account_epoch: u64::try_from(epoch)
                    .map_err(|_| "Account external-flow epoch is invalid".to_string())?,
                process_generation: u64::try_from(generation)
                    .map_err(|_| "Account external-flow generation is invalid".to_string())?,
                status,
                expires_at,
                updated_at,
            })),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(format!("failed to read Account external flow: {error}")),
        }
    }

    pub(crate) fn read_managed_key_binding(
        &self,
        authority_origin_id: &str,
        account_link_id: &str,
        device_id: &str,
    ) -> Result<Option<ManagedKeyBinding>, String> {
        let connection = self.connect()?;
        let row = connection.query_row(
            "SELECT vault_scope, managed_key_id FROM managed_key_binding
             WHERE authority_origin_id = ?1 AND account_link_id = ?2 AND device_id = ?3",
            params![authority_origin_id, account_link_id, device_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        );
        match row {
            Ok((vault_scope, managed_key_id)) => Ok(Some(ManagedKeyBinding {
                authority_origin_id: authority_origin_id.to_string(),
                account_link_id: account_link_id.to_string(),
                device_id: device_id.to_string(),
                vault_scope,
                managed_key_id,
            })),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(format!(
                "failed to read Account managed-key binding: {error}"
            )),
        }
    }

    pub(crate) fn save_managed_key_state(
        &self,
        binding: &ManagedKeyBinding,
        metadata: &AccountMetadata,
        updated_at: i64,
    ) -> Result<(), String> {
        validate_isolation_id(&binding.authority_origin_id, "authority")?;
        validate_isolation_id(&binding.account_link_id, "link")?;
        validate_isolation_id(&binding.device_id, "device")?;
        validate_vault_scope(&binding.vault_scope)?;
        validate_metadata(metadata)?;
        if binding.managed_key_id <= 0
            || metadata.managed_key_id != Some(binding.managed_key_id)
            || metadata.authority_origin_id.as_deref() != Some(&binding.authority_origin_id)
            || metadata.account_link_id.as_deref() != Some(&binding.account_link_id)
            || metadata.device_id.as_deref() != Some(&binding.device_id)
            || metadata.vault_scope.as_deref() != Some(&binding.vault_scope)
        {
            return Err("Account managed-key state correlation is invalid".to_string());
        }
        let connection = self.connect()?;
        let transaction = connection
            .unchecked_transaction()
            .map_err(|error| format!("failed to begin Account managed-key transaction: {error}"))?;
        transaction
            .execute(
                "INSERT INTO managed_key_binding (
                    authority_origin_id, account_link_id, device_id, vault_scope,
                    managed_key_id, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(authority_origin_id, account_link_id, device_id) DO UPDATE SET
                    vault_scope = excluded.vault_scope,
                    managed_key_id = excluded.managed_key_id,
                    updated_at = excluded.updated_at",
                params![
                    binding.authority_origin_id,
                    binding.account_link_id,
                    binding.device_id,
                    binding.vault_scope,
                    binding.managed_key_id,
                    updated_at,
                ],
            )
            .map_err(|error| format!("failed to persist Account managed-key binding: {error}"))?;
        transaction
            .execute(
                "INSERT INTO account_session (
                    singleton, authority_origin_id, account_link_id, device_id, account_epoch,
                    profile_label, primary_email_label, session_status, vault_scope,
                    managed_key_id, updated_at
                 ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(singleton) DO UPDATE SET
                    authority_origin_id = excluded.authority_origin_id,
                    account_link_id = excluded.account_link_id,
                    device_id = excluded.device_id,
                    account_epoch = excluded.account_epoch,
                    profile_label = excluded.profile_label,
                    primary_email_label = excluded.primary_email_label,
                    session_status = excluded.session_status,
                    vault_scope = excluded.vault_scope,
                    managed_key_id = excluded.managed_key_id,
                    updated_at = excluded.updated_at",
                params![
                    metadata.authority_origin_id,
                    metadata.account_link_id,
                    metadata.device_id,
                    i64::try_from(metadata.account_epoch)
                        .map_err(|_| "Account epoch is outside the supported range".to_string())?,
                    metadata.profile_label,
                    metadata.primary_email_label,
                    metadata.session_status,
                    metadata.vault_scope,
                    metadata.managed_key_id,
                    metadata.updated_at,
                ],
            )
            .map_err(|error| format!("failed to persist Account managed-key session: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("failed to commit Account managed-key transaction: {error}"))
    }

    pub(crate) fn delete_managed_key_binding(
        &self,
        authority_origin_id: &str,
        account_link_id: &str,
        device_id: &str,
    ) -> Result<(), String> {
        let connection = self.connect()?;
        connection
            .execute(
                "DELETE FROM managed_key_binding
                 WHERE authority_origin_id = ?1 AND account_link_id = ?2 AND device_id = ?3",
                params![authority_origin_id, account_link_id, device_id],
            )
            .map_err(|error| format!("failed to delete Account managed-key binding: {error}"))?;
        Ok(())
    }

    pub(crate) fn save_configuration_result(
        &self,
        account_link_id: &str,
        device_id: &str,
        result: &serde_json::Value,
        recovery_required: bool,
        updated_at: i64,
    ) -> Result<(), String> {
        validate_isolation_id(account_link_id, "link")?;
        validate_isolation_id(device_id, "device")?;
        let safe_result = serde_json::to_string(result)
            .map_err(|_| "failed to encode Account configuration result".to_string())?;
        if safe_result.len() > 16_384 {
            return Err("Account configuration result is too large".to_string());
        }
        let connection = self.connect()?;
        connection
            .execute(
                "INSERT INTO configuration_task (
                    singleton, account_link_id, device_id, state, safe_result,
                    acknowledged, updated_at
                 ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(singleton) DO UPDATE SET
                    account_link_id = excluded.account_link_id,
                    device_id = excluded.device_id,
                    state = excluded.state,
                    safe_result = excluded.safe_result,
                    acknowledged = excluded.acknowledged,
                    updated_at = excluded.updated_at",
                params![
                    account_link_id,
                    device_id,
                    if recovery_required {
                        "recoveryRequired"
                    } else {
                        "terminal"
                    },
                    safe_result,
                    if result
                        .get("acknowledged")
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false)
                    {
                        1
                    } else {
                        0
                    },
                    updated_at,
                ],
            )
            .map_err(|error| format!("failed to persist Account configuration result: {error}"))?;
        Ok(())
    }

    pub(crate) fn read_configuration_result(
        &self,
        account_link_id: &str,
        device_id: &str,
    ) -> Result<Option<serde_json::Value>, String> {
        let connection = self.connect()?;
        let value = connection.query_row(
            "SELECT safe_result, acknowledged FROM configuration_task
             WHERE singleton = 1 AND account_link_id = ?1 AND device_id = ?2",
            params![account_link_id, device_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        );
        match value {
            Ok((safe_result, acknowledged)) => {
                let mut result: serde_json::Value = serde_json::from_str(&safe_result)
                    .map_err(|_| "Account configuration result is corrupt".to_string())?;
                let object = result
                    .as_object_mut()
                    .ok_or_else(|| "Account configuration result is invalid".to_string())?;
                object.insert(
                    "acknowledged".to_string(),
                    serde_json::Value::Bool(acknowledged == 1),
                );
                Ok(Some(result))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(format!(
                "failed to read Account configuration result: {error}"
            )),
        }
    }

    pub(crate) fn acknowledge_configuration_result(
        &self,
        result_handle: &str,
    ) -> Result<(), String> {
        let connection = self.connect()?;
        let safe_result: String = connection
            .query_row(
                "SELECT safe_result FROM configuration_task WHERE singleton = 1",
                [],
                |row| row.get(0),
            )
            .map_err(|error| format!("failed to read Account configuration result: {error}"))?;
        let parsed: serde_json::Value = serde_json::from_str(&safe_result)
            .map_err(|_| "Account configuration result is corrupt".to_string())?;
        if parsed.get("result").and_then(serde_json::Value::as_str) != Some(result_handle) {
            return Err("Account configuration result handle mismatch".to_string());
        }
        connection
            .execute(
                "UPDATE configuration_task SET acknowledged = 1 WHERE singleton = 1",
                [],
            )
            .map_err(|error| {
                format!("failed to acknowledge Account configuration result: {error}")
            })?;
        Ok(())
    }

    pub(crate) fn clear_configuration_result(&self) -> Result<(), String> {
        let connection = self.connect()?;
        connection
            .execute("DELETE FROM configuration_task WHERE singleton = 1", [])
            .map_err(|error| format!("failed to clear Account configuration result: {error}"))?;
        Ok(())
    }

    pub(crate) fn save_engine_checkout(&self, record: &EngineCheckoutRecord) -> Result<(), String> {
        validate_isolation_id(&record.authority_origin_id, "authority")?;
        validate_isolation_id(&record.account_link_id, "link")?;
        validate_isolation_id(&record.device_id, "device")?;
        if !matches!(record.engine_id.as_str(), "codex" | "claude-code")
            || record.checkout_id <= 0
            || !matches!(record.status.as_str(), "pending" | "processing")
            || record.expires_at <= record.updated_at
            || record.updated_at <= 0
        {
            return Err("Account engine checkout record is invalid".to_string());
        }
        let connection = self.connect()?;
        connection
            .execute(
                "INSERT INTO account_engine_checkout (
                    authority_origin_id, account_link_id, device_id, engine_id,
                    checkout_id, status, expires_at, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(authority_origin_id, account_link_id, device_id) DO UPDATE SET
                    engine_id = excluded.engine_id,
                    checkout_id = excluded.checkout_id,
                    status = excluded.status,
                    expires_at = excluded.expires_at,
                    updated_at = excluded.updated_at",
                params![
                    record.authority_origin_id,
                    record.account_link_id,
                    record.device_id,
                    record.engine_id,
                    record.checkout_id,
                    record.status,
                    record.expires_at,
                    record.updated_at,
                ],
            )
            .map_err(|error| format!("failed to persist Account engine checkout: {error}"))?;
        Ok(())
    }

    pub(crate) fn read_engine_checkout(
        &self,
        authority_origin_id: &str,
        account_link_id: &str,
        device_id: &str,
    ) -> Result<Option<EngineCheckoutRecord>, String> {
        let connection = self.connect()?;
        let row = connection.query_row(
            "SELECT engine_id, checkout_id, status, expires_at, updated_at
             FROM account_engine_checkout
             WHERE authority_origin_id = ?1 AND account_link_id = ?2 AND device_id = ?3",
            params![authority_origin_id, account_link_id, device_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            },
        );
        match row {
            Ok((engine_id, checkout_id, status, expires_at, updated_at)) => {
                Ok(Some(EngineCheckoutRecord {
                    authority_origin_id: authority_origin_id.to_string(),
                    account_link_id: account_link_id.to_string(),
                    device_id: device_id.to_string(),
                    engine_id,
                    checkout_id,
                    status,
                    expires_at,
                    updated_at,
                }))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(format!("failed to read Account engine checkout: {error}")),
        }
    }

    pub(crate) fn clear_engine_checkout(
        &self,
        authority_origin_id: &str,
        account_link_id: &str,
        device_id: &str,
    ) -> Result<(), String> {
        let connection = self.connect()?;
        connection
            .execute(
                "DELETE FROM account_engine_checkout
                 WHERE authority_origin_id = ?1 AND account_link_id = ?2 AND device_id = ?3",
                params![authority_origin_id, account_link_id, device_id],
            )
            .map_err(|error| format!("failed to clear Account engine checkout: {error}"))?;
        Ok(())
    }

    pub(crate) fn save_session(&self, metadata: &AccountMetadata) -> Result<(), String> {
        validate_metadata(metadata)?;
        let connection = self.connect()?;
        connection
            .execute(
                "INSERT INTO account_session (
                    singleton, authority_origin_id, account_link_id, device_id, account_epoch,
                    profile_label, primary_email_label, session_status, vault_scope,
                    managed_key_id, updated_at
                 ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(singleton) DO UPDATE SET
                    authority_origin_id = excluded.authority_origin_id,
                    account_link_id = excluded.account_link_id,
                    device_id = excluded.device_id,
                    account_epoch = excluded.account_epoch,
                    profile_label = excluded.profile_label,
                    primary_email_label = excluded.primary_email_label,
                    session_status = excluded.session_status,
                    vault_scope = excluded.vault_scope,
                    managed_key_id = excluded.managed_key_id,
                    updated_at = excluded.updated_at",
                params![
                    metadata.authority_origin_id,
                    metadata.account_link_id,
                    metadata.device_id,
                    i64::try_from(metadata.account_epoch)
                        .map_err(|_| "Account epoch is outside the supported range".to_string())?,
                    metadata.profile_label,
                    metadata.primary_email_label,
                    metadata.session_status,
                    metadata.vault_scope,
                    metadata.managed_key_id,
                    metadata.updated_at,
                ],
            )
            .map_err(|error| format!("failed to save Account session metadata: {error}"))?;
        Ok(())
    }

    pub(crate) fn clear_session(&self, updated_at: &str) -> Result<(), String> {
        let mut current = self.read_session()?.unwrap_or(AccountMetadata {
            account_epoch: 0,
            authority_origin_id: None,
            account_link_id: None,
            device_id: None,
            profile_label: "Token service account".to_string(),
            primary_email_label: None,
            session_status: "signedOut".to_string(),
            vault_scope: None,
            managed_key_id: None,
            updated_at: updated_at.to_string(),
        });
        current.account_epoch = current.account_epoch.saturating_add(1);
        current.session_status = "signedOut".to_string();
        current.primary_email_label = None;
        current.vault_scope = None;
        current.managed_key_id = None;
        current.updated_at = updated_at.to_string();
        self.save_session(&current)
    }

    pub(crate) fn clear_session_preserving_managed_key(
        &self,
        updated_at: &str,
    ) -> Result<(), String> {
        let mut current = self.read_session()?.unwrap_or(AccountMetadata {
            account_epoch: 0,
            authority_origin_id: None,
            account_link_id: None,
            device_id: None,
            profile_label: "Token service account".to_string(),
            primary_email_label: None,
            session_status: "signedOut".to_string(),
            vault_scope: None,
            managed_key_id: None,
            updated_at: updated_at.to_string(),
        });
        current.account_epoch = current.account_epoch.saturating_add(1);
        current.session_status = "signedOut".to_string();
        current.primary_email_label = None;
        current.updated_at = updated_at.to_string();
        self.save_session(&current)
    }

    pub(crate) fn set_dismissed(
        &self,
        authority_origin_id: &str,
        account_link_id: &str,
        device_id: &str,
        dismissed: bool,
        updated_at: &str,
    ) -> Result<(), String> {
        let connection = self.connect()?;
        connection
            .execute(
                "INSERT INTO account_configuration_dismissal (
                    authority_origin_id, account_link_id, device_id,
                    recipe_id, recipe_version, dismissed, updated_at
                 ) VALUES (?1, ?2, ?3, 'doge.account.codex-token-service', 1, ?4, ?5)
                 ON CONFLICT(
                    authority_origin_id, account_link_id, device_id,
                    recipe_id, recipe_version
                 ) DO UPDATE SET
                    dismissed = excluded.dismissed,
                    updated_at = excluded.updated_at",
                params![
                    authority_origin_id,
                    account_link_id,
                    device_id,
                    if dismissed { 1 } else { 0 },
                    updated_at,
                ],
            )
            .map_err(|error| {
                format!("failed to persist Account configuration dismissal: {error}")
            })?;
        Ok(())
    }

    pub(crate) fn is_dismissed(
        &self,
        authority_origin_id: &str,
        account_link_id: &str,
        device_id: &str,
    ) -> Result<bool, String> {
        let connection = self.connect()?;
        let value = connection.query_row(
            "SELECT dismissed FROM account_configuration_dismissal
             WHERE authority_origin_id = ?1 AND account_link_id = ?2 AND device_id = ?3
               AND recipe_id = 'doge.account.codex-token-service' AND recipe_version = 1",
            params![authority_origin_id, account_link_id, device_id],
            |row| row.get::<_, i64>(0),
        );
        match value {
            Ok(value) => Ok(value == 1),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
            Err(error) => Err(format!(
                "failed to read Account configuration dismissal: {error}"
            )),
        }
    }
}

fn valid_handle_digest(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn validate_external_flow(record: &ExternalFlowRecord) -> Result<(), String> {
    if !valid_handle_digest(&record.handle_digest)
        || !matches!(
            record.purpose.as_str(),
            "oauth" | "password-reset" | "identity-bind"
        )
        || record.state_class != "waiting"
        || record.status != "pending"
        || record.process_generation == 0
        || record.expires_at <= record.updated_at
        || record.updated_at <= 0
    {
        return Err("Account external-flow record is invalid".to_string());
    }
    Ok(())
}
