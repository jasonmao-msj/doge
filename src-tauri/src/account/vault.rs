use keyring::Entry;

const ACCOUNT_VAULT_SERVICE: &str = "com.doge.account";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AccountVaultStatus {
    Ready,
    Locked,
    Unavailable,
}

pub(crate) trait DurableAccountVault: Send + Sync {
    fn status(&self) -> AccountVaultStatus;
    fn read(&self, purpose: &str) -> Result<Option<String>, String>;
    fn write(&self, purpose: &str, secret: &str) -> Result<(), String>;
    fn delete(&self, purpose: &str) -> Result<(), String>;
}

#[derive(Default)]
pub(crate) struct OsAccountVault;

impl OsAccountVault {
    fn entry(purpose: &str) -> Result<Entry, String> {
        let valid = purpose
            .strip_prefix("refresh-session:")
            .or_else(|| purpose.strip_prefix("managed-key:codex-token-service:"))
            .or_else(|| purpose.strip_prefix("managed-engine:codex:"))
            .or_else(|| purpose.strip_prefix("managed-engine:claude-code:"))
            .is_some_and(valid_scope);
        if !valid {
            return Err("account vault purpose is not allowlisted".to_string());
        }
        Entry::new(ACCOUNT_VAULT_SERVICE, purpose)
            .map_err(|_| "account vault is unavailable".to_string())
    }

    fn normalize_error(error: keyring::Error) -> String {
        match error {
            keyring::Error::NoStorageAccess(_) | keyring::Error::PlatformFailure(_) => {
                "account vault is locked or unavailable".to_string()
            }
            _ => "account vault operation failed".to_string(),
        }
    }
}

fn valid_scope(value: &str) -> bool {
    (8..=64).contains(&value.len())
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
}

impl DurableAccountVault for OsAccountVault {
    fn status(&self) -> AccountVaultStatus {
        match Self::entry("refresh-session:statusprobe").and_then(|entry| {
            entry.get_password().map(Some).or_else(|error| match error {
                keyring::Error::NoEntry => Ok(None),
                error => Err(Self::normalize_error(error)),
            })
        }) {
            Ok(_) => AccountVaultStatus::Ready,
            Err(error) if error.contains("locked") => AccountVaultStatus::Locked,
            Err(_) => AccountVaultStatus::Unavailable,
        }
    }

    fn read(&self, purpose: &str) -> Result<Option<String>, String> {
        match Self::entry(purpose)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(Self::normalize_error(error)),
        }
    }

    fn write(&self, purpose: &str, secret: &str) -> Result<(), String> {
        if secret.is_empty() {
            return Err("account vault refuses an empty secret".to_string());
        }
        Self::entry(purpose)?
            .set_password(secret)
            .map_err(Self::normalize_error)
    }

    fn delete(&self, purpose: &str) -> Result<(), String> {
        match Self::entry(purpose)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(Self::normalize_error(error)),
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    pub(crate) struct MemoryVault {
        values: Mutex<HashMap<String, String>>,
    }

    impl DurableAccountVault for MemoryVault {
        fn status(&self) -> AccountVaultStatus {
            AccountVaultStatus::Ready
        }

        fn read(&self, purpose: &str) -> Result<Option<String>, String> {
            Ok(self.values.lock().unwrap().get(purpose).cloned())
        }

        fn write(&self, purpose: &str, secret: &str) -> Result<(), String> {
            self.values
                .lock()
                .unwrap()
                .insert(purpose.to_string(), secret.to_string());
            Ok(())
        }

        fn delete(&self, purpose: &str) -> Result<(), String> {
            self.values.lock().unwrap().remove(purpose);
            Ok(())
        }
    }

    #[test]
    fn rejects_unknown_vault_purpose_before_platform_access() {
        assert!(OsAccountVault::entry("../../unknown").is_err());
        assert!(OsAccountVault::entry("refresh-session:abc12345").is_ok());
    }
}
