use super::persistence::*;
use rusqlite::{params, Connection};

impl AccountRepository {
    pub(crate) fn accept_operation(
        &self,
        record: &AcceptedOperationRecord,
    ) -> Result<AcceptedOperationRecord, String> {
        validate_operation_record(record)?;
        let connection = self.connect()?;
        let transaction = connection
            .unchecked_transaction()
            .map_err(|error| format!("failed to begin Account operation acceptance: {error}"))?;
        let existing = transaction.query_row(
            "SELECT operation_id, request_id, operation, account_epoch, request_fingerprint
             FROM account_operation WHERE intent_id = ?1",
            params![record.intent_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        );
        match existing {
            Ok((operation_id, _request_id, operation, epoch, fingerprint)) => {
                if operation != record.operation
                    || u64::try_from(epoch).ok() != Some(record.account_epoch)
                    || fingerprint != record.request_fingerprint
                {
                    return Err("Account intent is already bound to another mutation".to_string());
                }
                transaction.commit().map_err(|error| {
                    format!("failed to commit Account operation lookup: {error}")
                })?;
                return self
                    .read_operation(&operation_id)?
                    .ok_or_else(|| "Account intent binding disappeared".to_string());
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                transaction
                    .execute(
                        "INSERT INTO account_operation (
                            operation_id, request_id, intent_id, operation, account_epoch,
                            request_fingerprint, status, outcome, accepted_at, updated_at
                         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'accepted', NULL, ?7, ?7)",
                        params![
                            record.operation_id,
                            record.request_id,
                            record.intent_id,
                            record.operation,
                            i64::try_from(record.account_epoch).map_err(|_| {
                                "Account epoch is outside the supported range".to_string()
                            })?,
                            record.request_fingerprint,
                            record.accepted_at,
                        ],
                    )
                    .map_err(|error| {
                        format!("failed to persist Account operation acceptance: {error}")
                    })?;
            }
            Err(error) => return Err(format!("failed to read Account intent binding: {error}")),
        }
        transaction
            .commit()
            .map_err(|error| format!("failed to commit Account operation acceptance: {error}"))?;
        Ok(record.clone())
    }

    pub(crate) fn read_operation(
        &self,
        operation_id: &str,
    ) -> Result<Option<AcceptedOperationRecord>, String> {
        let connection = self.connect()?;
        read_operation_where(&connection, "operation_id", operation_id)
    }

    pub(crate) fn read_operation_by_intent(
        &self,
        intent_id: &str,
    ) -> Result<Option<AcceptedOperationRecord>, String> {
        let connection = self.connect()?;
        read_operation_where(&connection, "intent_id", intent_id)
    }

    pub(crate) fn mark_operation_executing(
        &self,
        operation_id: &str,
        updated_at: i64,
    ) -> Result<(), String> {
        let connection = self.connect()?;
        let changed = connection
            .execute(
                "UPDATE account_operation SET status = 'executing', outcome = NULL, updated_at = ?2
                 WHERE operation_id = ?1 AND status = 'accepted'",
                params![operation_id, updated_at],
            )
            .map_err(|error| format!("failed to mark Account operation executing: {error}"))?;
        if changed == 1 {
            Ok(())
        } else {
            Err("Account operation is not in the accepted state".to_string())
        }
    }

    pub(crate) fn finish_operation(
        &self,
        operation_id: &str,
        outcome: &str,
        updated_at: i64,
    ) -> Result<(), String> {
        if !matches!(
            outcome,
            "succeeded" | "rejected" | "cancelledBeforeSend" | "outcomeUnknown"
        ) {
            return Err("Account operation outcome is invalid".to_string());
        }
        let connection = self.connect()?;
        let changed = connection
            .execute(
                "UPDATE account_operation SET status = 'terminal', outcome = ?2, updated_at = ?3
                 WHERE operation_id = ?1",
                params![operation_id, outcome, updated_at],
            )
            .map_err(|error| format!("failed to persist Account operation receipt: {error}"))?;
        if changed == 1 {
            Ok(())
        } else {
            Err("Account operation receipt has no acceptance".to_string())
        }
    }

    pub(crate) fn recover_interrupted_operations(&self, updated_at: i64) -> Result<usize, String> {
        let connection = self.connect()?;
        connection
            .execute(
                "UPDATE account_operation SET status = 'terminal', outcome = 'outcomeUnknown', updated_at = ?1
                 WHERE status = 'executing'",
                params![updated_at],
            )
            .map_err(|error| format!("failed to recover interrupted Account operations: {error}"))
    }

    pub(crate) fn prune_operations(&self, cutoff_epoch_seconds: i64) -> Result<usize, String> {
        let connection = self.connect()?;
        connection
            .execute(
                "DELETE FROM account_operation WHERE updated_at < ?1",
                params![cutoff_epoch_seconds],
            )
            .map_err(|error| format!("failed to prune Account operation ledger: {error}"))
    }

    #[cfg(test)]
    pub(crate) fn path(&self) -> &std::path::Path {
        &self.path
    }
}

fn read_operation_where(
    connection: &Connection,
    column: &str,
    value: &str,
) -> Result<Option<AcceptedOperationRecord>, String> {
    let sql = format!(
        "SELECT operation_id, request_id, intent_id, operation, account_epoch,
                request_fingerprint, status, outcome, accepted_at
         FROM account_operation WHERE {column} = ?1"
    );
    let record = connection.query_row(&sql, params![value], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, i64>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, String>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, i64>(8)?,
        ))
    });
    match record {
        Ok((
            operation_id,
            request_id,
            intent_id,
            operation,
            epoch,
            request_fingerprint,
            status,
            outcome,
            accepted_at,
        )) => Ok(Some(AcceptedOperationRecord {
            operation_id,
            request_id,
            intent_id,
            operation,
            account_epoch: u64::try_from(epoch)
                .map_err(|_| "Account operation epoch is invalid".to_string())?,
            request_fingerprint,
            status,
            outcome,
            accepted_at,
        })),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(format!("failed to read Account operation: {error}")),
    }
}

fn validate_operation_record(record: &AcceptedOperationRecord) -> Result<(), String> {
    if !record.operation_id.starts_with("operation_")
        || !record.request_id.starts_with("request_")
        || !record.intent_id.starts_with("intent_")
        || record.operation.is_empty()
        || record.request_fingerprint.len() != 64
        || record.accepted_at <= 0
        || record.status != "accepted"
        || record.outcome.is_some()
    {
        return Err("Account operation acceptance is invalid".to_string());
    }
    Ok(())
}

pub(super) fn validate_metadata(metadata: &AccountMetadata) -> Result<(), String> {
    if metadata.profile_label.is_empty() || metadata.profile_label.len() > 80 {
        return Err("Account profile label is outside the safe display range".to_string());
    }
    if !matches!(
        metadata.session_status.as_str(),
        "active" | "signedOut" | "revoked"
    ) {
        return Err("Account session status is not supported".to_string());
    }
    for (value, label) in [
        (metadata.authority_origin_id.as_deref(), "authority"),
        (metadata.account_link_id.as_deref(), "link"),
        (metadata.device_id.as_deref(), "device"),
    ] {
        if let Some(value) = value {
            validate_isolation_id(value, label)?;
        }
    }
    let isolation_count = [
        metadata.authority_origin_id.is_some(),
        metadata.account_link_id.is_some(),
        metadata.device_id.is_some(),
    ]
    .into_iter()
    .filter(|present| *present)
    .count();
    if isolation_count != 0 && isolation_count != 3 {
        return Err("Account isolation identity is incomplete".to_string());
    }
    if metadata.session_status == "active" && isolation_count != 3 {
        return Err("Active Account session requires an isolation identity".to_string());
    }
    if let Some(value) = metadata.vault_scope.as_deref() {
        validate_vault_scope(value)?;
    }
    if metadata.managed_key_id.is_some_and(|value| value <= 0) {
        return Err("Account managed key id is invalid".to_string());
    }
    if metadata.updated_at.is_empty() {
        return Err("Account metadata update time is required".to_string());
    }
    Ok(())
}

pub(super) fn validate_isolation_id(value: &str, label: &str) -> Result<(), String> {
    if !(8..=96).contains(&value.len())
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err(format!("Account {label} identity is invalid"));
    }
    Ok(())
}

pub(super) fn validate_vault_scope(value: &str) -> Result<(), String> {
    if !(8..=64).contains(&value.len())
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
    {
        return Err("Account vault scope is invalid".to_string());
    }
    Ok(())
}
