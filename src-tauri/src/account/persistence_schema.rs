use super::persistence::{AccountRepository, ACCOUNT_DATABASE_VERSION};

impl AccountRepository {
    pub(super) fn initialize(&self) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create Account metadata directory: {error}"))?;
        }
        let connection = self.connect()?;
        connection
            .execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA foreign_keys = ON;
                 PRAGMA synchronous = FULL;",
            )
            .map_err(|error| format!("failed to configure Account metadata store: {error}"))?;
        let version: i32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|error| format!("failed to read Account metadata schema: {error}"))?;
        if version > ACCOUNT_DATABASE_VERSION {
            return Err("Account metadata schema is newer than this Doge build".to_string());
        }
        if version == 0 {
            let transaction = connection
                .unchecked_transaction()
                .map_err(|error| format!("failed to begin Account metadata migration: {error}"))?;
            transaction
                .execute_batch(
                    "CREATE TABLE account_session (
                        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                        authority_origin_id TEXT,
                        account_link_id TEXT,
                        device_id TEXT,
                        account_epoch INTEGER NOT NULL CHECK (account_epoch >= 0),
                        profile_label TEXT NOT NULL CHECK (length(profile_label) BETWEEN 1 AND 80),
                        primary_email_label TEXT,
                        session_status TEXT NOT NULL CHECK (session_status IN ('active', 'signedOut', 'revoked')),
                        vault_scope TEXT,
                        managed_key_id INTEGER,
                        updated_at TEXT NOT NULL
                    );
                    CREATE TABLE configuration_dismissal (
                        recipe_id TEXT NOT NULL,
                        recipe_version INTEGER NOT NULL,
                        dismissed INTEGER NOT NULL CHECK (dismissed IN (0, 1)),
                        updated_at TEXT NOT NULL,
                        PRIMARY KEY (recipe_id, recipe_version)
                    );
                    CREATE TABLE account_operation (
                        operation_id TEXT PRIMARY KEY,
                        request_id TEXT NOT NULL,
                        intent_id TEXT NOT NULL UNIQUE,
                        operation TEXT NOT NULL,
                        account_epoch INTEGER NOT NULL CHECK (account_epoch >= 0),
                        request_fingerprint TEXT NOT NULL,
                        status TEXT NOT NULL CHECK (status IN ('accepted', 'executing', 'terminal')),
                        outcome TEXT CHECK (outcome IN ('succeeded', 'rejected', 'cancelledBeforeSend', 'outcomeUnknown')),
                        accepted_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL
                    );
                    CREATE INDEX account_operation_updated_at_idx ON account_operation(updated_at);
                    CREATE TABLE account_device (
                        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                        device_id TEXT NOT NULL UNIQUE,
                        created_at INTEGER NOT NULL
                    );
                    CREATE TABLE managed_key_binding (
                        authority_origin_id TEXT NOT NULL,
                        account_link_id TEXT NOT NULL,
                        device_id TEXT NOT NULL,
                        vault_scope TEXT NOT NULL,
                        managed_key_id INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL,
                        PRIMARY KEY (authority_origin_id, account_link_id, device_id)
                    );
                    CREATE TABLE configuration_task (
                        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                        account_link_id TEXT NOT NULL,
                        device_id TEXT NOT NULL,
                        state TEXT NOT NULL CHECK (state IN ('terminal', 'recoveryRequired')),
                        safe_result TEXT NOT NULL,
                        acknowledged INTEGER NOT NULL CHECK (acknowledged IN (0, 1)),
                        updated_at INTEGER NOT NULL
                    );
                    CREATE TABLE account_external_flow (
                        handle_digest TEXT PRIMARY KEY,
                        purpose TEXT NOT NULL CHECK (purpose IN ('oauth', 'password-reset', 'identity-bind')),
                        state_class TEXT NOT NULL CHECK (state_class IN ('waiting', 'returned', 'terminal')),
                        account_epoch INTEGER NOT NULL CHECK (account_epoch >= 0),
                        process_generation INTEGER NOT NULL CHECK (process_generation > 0),
                        status TEXT NOT NULL CHECK (status IN ('pending', 'consumed', 'expired', 'cancelled')),
                        expires_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL
                    );
                    CREATE INDEX account_external_flow_status_idx
                        ON account_external_flow(status, updated_at);
                    PRAGMA user_version = 7;",
                )
                .map_err(|error| format!("failed to migrate Account metadata schema: {error}"))?;
            transaction
                .commit()
                .map_err(|error| format!("failed to commit Account metadata migration: {error}"))?;
        } else if version == 1 {
            let transaction = connection
                .unchecked_transaction()
                .map_err(|error| format!("failed to begin Account metadata migration: {error}"))?;
            transaction
                .execute_batch(
                    "ALTER TABLE account_session ADD COLUMN vault_scope TEXT;
                     ALTER TABLE account_session ADD COLUMN managed_key_id INTEGER;
                     ALTER TABLE account_session ADD COLUMN authority_origin_id TEXT;
                     ALTER TABLE account_session ADD COLUMN account_link_id TEXT;
                     ALTER TABLE account_session ADD COLUMN device_id TEXT;
                     CREATE TABLE account_operation (
                        operation_id TEXT PRIMARY KEY,
                        request_id TEXT NOT NULL,
                        intent_id TEXT NOT NULL UNIQUE,
                        operation TEXT NOT NULL,
                        account_epoch INTEGER NOT NULL CHECK (account_epoch >= 0),
                        request_fingerprint TEXT NOT NULL,
                        status TEXT NOT NULL CHECK (status IN ('accepted', 'executing', 'terminal')),
                        outcome TEXT CHECK (outcome IN ('succeeded', 'rejected', 'cancelledBeforeSend', 'outcomeUnknown')),
                        accepted_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL
                     );
                     CREATE INDEX account_operation_updated_at_idx ON account_operation(updated_at);
                     CREATE TABLE account_device (
                        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                        device_id TEXT NOT NULL UNIQUE,
                        created_at INTEGER NOT NULL
                     );
                     CREATE TABLE managed_key_binding (
                        authority_origin_id TEXT NOT NULL,
                        account_link_id TEXT NOT NULL,
                        device_id TEXT NOT NULL,
                        vault_scope TEXT NOT NULL,
                        managed_key_id INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL,
                        PRIMARY KEY (authority_origin_id, account_link_id, device_id)
                     );
                     CREATE TABLE configuration_task (
                        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                        account_link_id TEXT NOT NULL,
                        device_id TEXT NOT NULL,
                        state TEXT NOT NULL CHECK (state IN ('terminal', 'recoveryRequired')),
                        safe_result TEXT NOT NULL,
                        acknowledged INTEGER NOT NULL CHECK (acknowledged IN (0, 1)),
                        updated_at INTEGER NOT NULL
                     );
                     PRAGMA user_version = 5;",
                )
                .map_err(|error| format!("failed to migrate Account metadata schema: {error}"))?;
            transaction
                .commit()
                .map_err(|error| format!("failed to commit Account metadata migration: {error}"))?;
        } else if version == 2 {
            let transaction = connection
                .unchecked_transaction()
                .map_err(|error| format!("failed to begin Account metadata migration: {error}"))?;
            transaction
                .execute_batch(
                    "CREATE TABLE account_operation (
                        operation_id TEXT PRIMARY KEY,
                        request_id TEXT NOT NULL,
                        intent_id TEXT NOT NULL UNIQUE,
                        operation TEXT NOT NULL,
                        account_epoch INTEGER NOT NULL CHECK (account_epoch >= 0),
                        request_fingerprint TEXT NOT NULL,
                        status TEXT NOT NULL CHECK (status IN ('accepted', 'executing', 'terminal')),
                        outcome TEXT CHECK (outcome IN ('succeeded', 'rejected', 'cancelledBeforeSend', 'outcomeUnknown')),
                        accepted_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL
                     );
                     CREATE INDEX account_operation_updated_at_idx ON account_operation(updated_at);
                     ALTER TABLE account_session ADD COLUMN authority_origin_id TEXT;
                     ALTER TABLE account_session ADD COLUMN account_link_id TEXT;
                     ALTER TABLE account_session ADD COLUMN device_id TEXT;
                     CREATE TABLE account_device (
                        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                        device_id TEXT NOT NULL UNIQUE,
                        created_at INTEGER NOT NULL
                     );
                     CREATE TABLE managed_key_binding (
                        authority_origin_id TEXT NOT NULL,
                        account_link_id TEXT NOT NULL,
                        device_id TEXT NOT NULL,
                        vault_scope TEXT NOT NULL,
                        managed_key_id INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL,
                        PRIMARY KEY (authority_origin_id, account_link_id, device_id)
                     );
                     CREATE TABLE configuration_task (
                        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                        account_link_id TEXT NOT NULL,
                        device_id TEXT NOT NULL,
                        state TEXT NOT NULL CHECK (state IN ('terminal', 'recoveryRequired')),
                        safe_result TEXT NOT NULL,
                        acknowledged INTEGER NOT NULL CHECK (acknowledged IN (0, 1)),
                        updated_at INTEGER NOT NULL
                     );
                     PRAGMA user_version = 5;",
                )
                .map_err(|error| format!("failed to migrate Account operation ledger: {error}"))?;
            transaction
                .commit()
                .map_err(|error| format!("failed to commit Account operation ledger: {error}"))?;
        } else if version == 3 {
            let transaction = connection
                .unchecked_transaction()
                .map_err(|error| format!("failed to begin Account isolation migration: {error}"))?;
            transaction
                .execute_batch(
                    "ALTER TABLE account_session ADD COLUMN authority_origin_id TEXT;
                     ALTER TABLE account_session ADD COLUMN account_link_id TEXT;
                     ALTER TABLE account_session ADD COLUMN device_id TEXT;
                     CREATE TABLE account_device (
                        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                        device_id TEXT NOT NULL UNIQUE,
                        created_at INTEGER NOT NULL
                     );
                     CREATE TABLE managed_key_binding (
                        authority_origin_id TEXT NOT NULL,
                        account_link_id TEXT NOT NULL,
                        device_id TEXT NOT NULL,
                        vault_scope TEXT NOT NULL,
                        managed_key_id INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL,
                        PRIMARY KEY (authority_origin_id, account_link_id, device_id)
                     );
                     CREATE TABLE configuration_task (
                        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                        account_link_id TEXT NOT NULL,
                        device_id TEXT NOT NULL,
                        state TEXT NOT NULL CHECK (state IN ('terminal', 'recoveryRequired')),
                        safe_result TEXT NOT NULL,
                        acknowledged INTEGER NOT NULL CHECK (acknowledged IN (0, 1)),
                        updated_at INTEGER NOT NULL
                     );
                     PRAGMA user_version = 5;",
                )
                .map_err(|error| format!("failed to migrate Account isolation schema: {error}"))?;
            transaction
                .commit()
                .map_err(|error| format!("failed to commit Account isolation schema: {error}"))?;
        } else if version == 4 {
            let transaction = connection.unchecked_transaction().map_err(|error| {
                format!("failed to begin Account configuration-task migration: {error}")
            })?;
            transaction
                .execute_batch(
                    "CREATE TABLE configuration_task (
                        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                        account_link_id TEXT NOT NULL,
                        device_id TEXT NOT NULL,
                        state TEXT NOT NULL CHECK (state IN ('terminal', 'recoveryRequired')),
                        safe_result TEXT NOT NULL,
                        acknowledged INTEGER NOT NULL CHECK (acknowledged IN (0, 1)),
                        updated_at INTEGER NOT NULL
                     );
                     PRAGMA user_version = 5;",
                )
                .map_err(|error| {
                    format!("failed to migrate Account configuration-task schema: {error}")
                })?;
            transaction.commit().map_err(|error| {
                format!("failed to commit Account configuration-task schema: {error}")
            })?;
        }
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS account_configuration_dismissal (
                    authority_origin_id TEXT NOT NULL,
                    account_link_id TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    recipe_id TEXT NOT NULL,
                    recipe_version INTEGER NOT NULL,
                    dismissed INTEGER NOT NULL CHECK (dismissed IN (0, 1)),
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (
                        authority_origin_id, account_link_id, device_id,
                        recipe_id, recipe_version
                    )
                 );
                 CREATE TABLE IF NOT EXISTS account_external_flow (
                    handle_digest TEXT PRIMARY KEY,
                    purpose TEXT NOT NULL CHECK (purpose IN ('oauth', 'password-reset', 'identity-bind')),
                    state_class TEXT NOT NULL CHECK (state_class IN ('waiting', 'returned', 'terminal')),
                    account_epoch INTEGER NOT NULL CHECK (account_epoch >= 0),
                    process_generation INTEGER NOT NULL CHECK (process_generation > 0),
                    status TEXT NOT NULL CHECK (status IN ('pending', 'consumed', 'expired', 'cancelled')),
                    expires_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS account_external_flow_status_idx
                    ON account_external_flow(status, updated_at);
                 CREATE TABLE IF NOT EXISTS account_engine_checkout (
                    authority_origin_id TEXT NOT NULL,
                    account_link_id TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    engine_id TEXT NOT NULL CHECK (engine_id IN ('codex', 'claude-code')),
                    checkout_id INTEGER NOT NULL CHECK (checkout_id > 0),
                    status TEXT NOT NULL CHECK (status IN ('pending', 'processing')),
                    expires_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    PRIMARY KEY (authority_origin_id, account_link_id, device_id)
                 );
                 CREATE INDEX IF NOT EXISTS account_engine_checkout_expiry_idx
                    ON account_engine_checkout(expires_at);
                 PRAGMA user_version = 8;",
            )
            .map_err(|error| format!("failed to migrate Account dismissal isolation: {error}"))?;
        let quick_check: String = connection
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .map_err(|error| format!("failed to verify Account metadata store: {error}"))?;
        if quick_check != "ok" {
            return Err("Account metadata store failed integrity verification".to_string());
        }
        Ok(())
    }
}
