#[cfg(any(not(all(debug_assertions, target_os = "macos")), test))]
use keyring::Entry;
use std::path::Path;
use std::sync::Arc;

#[cfg(all(debug_assertions, target_os = "macos"))]
use {
    serde::{Deserialize, Serialize},
    std::collections::BTreeMap,
    std::fs::{self, OpenOptions},
    std::io::Write,
    std::os::unix::fs::{OpenOptionsExt, PermissionsExt},
    std::path::PathBuf,
    uuid::Uuid,
    zeroize::{Zeroize, Zeroizing},
};

#[cfg(any(not(all(debug_assertions, target_os = "macos")), test))]
const ACCOUNT_VAULT_SERVICE: &str = "com.doge.account";

#[cfg(all(debug_assertions, target_os = "macos"))]
const DEBUG_VAULT_DIRECTORY: &str = "debug-account-vault";
#[cfg(all(debug_assertions, target_os = "macos"))]
const DEBUG_VAULT_FILENAME: &str = "credentials.json";
#[cfg(all(debug_assertions, target_os = "macos"))]
const DEBUG_VAULT_SCHEMA_VERSION: u8 = 1;
#[cfg(all(debug_assertions, target_os = "macos"))]
const DEBUG_VAULT_MAX_BYTES: u64 = 1024 * 1024;
#[cfg(all(debug_assertions, target_os = "macos"))]
const DEBUG_VAULT_MAX_ENTRIES: usize = 128;
#[cfg(all(debug_assertions, target_os = "macos"))]
const DEBUG_VAULT_MAX_SECRET_BYTES: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[cfg_attr(all(debug_assertions, target_os = "macos"), allow(dead_code))]
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

pub(crate) fn account_vault_for_data_dir(data_dir: &Path) -> Arc<dyn DurableAccountVault> {
    #[cfg(all(debug_assertions, target_os = "macos"))]
    {
        return Arc::new(DevelopmentFileAccountVault::new(
            data_dir.join(DEBUG_VAULT_DIRECTORY),
        ));
    }

    #[cfg(not(all(debug_assertions, target_os = "macos")))]
    {
        let _ = data_dir;
        Arc::new(OsAccountVault)
    }
}

#[derive(Default)]
#[cfg(any(not(all(debug_assertions, target_os = "macos")), test))]
pub(crate) struct OsAccountVault;

#[cfg(any(not(all(debug_assertions, target_os = "macos")), test))]
impl OsAccountVault {
    fn entry(purpose: &str) -> Result<Entry, String> {
        validate_purpose(purpose)?;
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

fn validate_purpose(purpose: &str) -> Result<(), String> {
    let valid = purpose
        .strip_prefix("refresh-session:")
        .or_else(|| purpose.strip_prefix("managed-key:codex-token-service:"))
        .or_else(|| purpose.strip_prefix("managed-engine:codex:"))
        .or_else(|| purpose.strip_prefix("managed-engine:claude-code:"))
        .or_else(|| purpose.strip_prefix("managed-engine:kimi:"))
        .is_some_and(valid_scope);
    if valid {
        Ok(())
    } else {
        Err("account vault purpose is not allowlisted".to_string())
    }
}

fn valid_scope(value: &str) -> bool {
    (8..=64).contains(&value.len())
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric())
}

#[cfg(any(not(all(debug_assertions, target_os = "macos")), test))]
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

#[cfg(all(debug_assertions, target_os = "macos"))]
struct DevelopmentFileAccountVault {
    directory: PathBuf,
    path: PathBuf,
}

#[cfg(all(debug_assertions, target_os = "macos"))]
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct DevelopmentVaultDocument {
    version: u8,
    entries: BTreeMap<String, String>,
}

#[cfg(all(debug_assertions, target_os = "macos"))]
impl Default for DevelopmentVaultDocument {
    fn default() -> Self {
        Self {
            version: DEBUG_VAULT_SCHEMA_VERSION,
            entries: BTreeMap::new(),
        }
    }
}

#[cfg(all(debug_assertions, target_os = "macos"))]
impl Drop for DevelopmentVaultDocument {
    fn drop(&mut self) {
        for secret in self.entries.values_mut() {
            secret.zeroize();
        }
    }
}

#[cfg(all(debug_assertions, target_os = "macos"))]
impl DevelopmentFileAccountVault {
    fn new(directory: PathBuf) -> Self {
        let path = directory.join(DEBUG_VAULT_FILENAME);
        Self { directory, path }
    }

    fn ensure_directory(&self) -> Result<(), String> {
        match fs::symlink_metadata(&self.directory) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err("development account vault is unsafe".to_string());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir_all(&self.directory)
                    .map_err(|_| "development account vault is unavailable".to_string())?;
            }
            Err(_) => return Err("development account vault is unavailable".to_string()),
        }
        let metadata = fs::symlink_metadata(&self.directory)
            .map_err(|_| "development account vault is unavailable".to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("development account vault is unsafe".to_string());
        }
        fs::set_permissions(&self.directory, fs::Permissions::from_mode(0o700))
            .map_err(|_| "development account vault is unavailable".to_string())
    }

    fn existing_file_metadata(&self) -> Result<Option<fs::Metadata>, String> {
        match fs::symlink_metadata(&self.path) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
                Err("development account vault is unsafe".to_string())
            }
            Ok(metadata) if metadata.len() > DEBUG_VAULT_MAX_BYTES => {
                Err("development account vault is invalid".to_string())
            }
            Ok(metadata) => {
                fs::set_permissions(&self.path, fs::Permissions::from_mode(0o600))
                    .map_err(|_| "development account vault is unavailable".to_string())?;
                Ok(Some(metadata))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(_) => Err("development account vault is unavailable".to_string()),
        }
    }

    fn read_document(&self) -> Result<DevelopmentVaultDocument, String> {
        self.ensure_directory()?;
        if self.existing_file_metadata()?.is_none() {
            return Ok(DevelopmentVaultDocument::default());
        }
        let bytes = Zeroizing::new(
            fs::read(&self.path)
                .map_err(|_| "development account vault is unavailable".to_string())?,
        );
        let document: DevelopmentVaultDocument = serde_json::from_slice(bytes.as_slice())
            .map_err(|_| "development account vault is invalid".to_string())?;
        if document.version != DEBUG_VAULT_SCHEMA_VERSION
            || document.entries.len() > DEBUG_VAULT_MAX_ENTRIES
            || document.entries.iter().any(|(purpose, secret)| {
                validate_purpose(purpose).is_err()
                    || secret.is_empty()
                    || secret.len() > DEBUG_VAULT_MAX_SECRET_BYTES
            })
        {
            return Err("development account vault is invalid".to_string());
        }
        Ok(document)
    }

    fn write_document(&self, document: &DevelopmentVaultDocument) -> Result<(), String> {
        self.ensure_directory()?;
        self.existing_file_metadata()?;
        let serialized = Zeroizing::new(
            serde_json::to_string(document)
                .map_err(|_| "development account vault operation failed".to_string())?,
        );
        if serialized.len() as u64 > DEBUG_VAULT_MAX_BYTES {
            return Err("development account vault is invalid".to_string());
        }

        let temporary = self
            .directory
            .join(format!(".{DEBUG_VAULT_FILENAME}.{}.tmp", Uuid::new_v4()));
        let result = (|| {
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .mode(0o600)
                .open(&temporary)
                .map_err(|_| "development account vault is unavailable".to_string())?;
            file.write_all(serialized.as_bytes())
                .map_err(|_| "development account vault operation failed".to_string())?;
            file.sync_all()
                .map_err(|_| "development account vault operation failed".to_string())?;
            fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600))
                .map_err(|_| "development account vault operation failed".to_string())?;

            self.existing_file_metadata()?;
            fs::rename(&temporary, &self.path)
                .map_err(|_| "development account vault operation failed".to_string())?;
            fs::set_permissions(&self.path, fs::Permissions::from_mode(0o600))
                .map_err(|_| "development account vault operation failed".to_string())?;
            fs::File::open(&self.directory)
                .and_then(|directory| directory.sync_all())
                .map_err(|_| "development account vault operation failed".to_string())?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }

    fn with_lock<T>(&self, operation: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        self.ensure_directory()?;
        crate::storage::with_storage_lock(&self.path, operation)
    }
}

#[cfg(all(debug_assertions, target_os = "macos"))]
impl DurableAccountVault for DevelopmentFileAccountVault {
    fn status(&self) -> AccountVaultStatus {
        match self.read_document() {
            Ok(_) => AccountVaultStatus::Ready,
            Err(_) => AccountVaultStatus::Unavailable,
        }
    }

    fn read(&self, purpose: &str) -> Result<Option<String>, String> {
        validate_purpose(purpose)?;
        self.with_lock(|| {
            let document = self.read_document()?;
            Ok(document.entries.get(purpose).cloned())
        })
    }

    fn write(&self, purpose: &str, secret: &str) -> Result<(), String> {
        validate_purpose(purpose)?;
        if secret.is_empty() || secret.len() > DEBUG_VAULT_MAX_SECRET_BYTES {
            return Err("account vault refuses an invalid secret".to_string());
        }
        self.with_lock(|| {
            let mut document = self.read_document()?;
            document
                .entries
                .insert(purpose.to_string(), secret.to_string());
            self.write_document(&document)
        })
    }

    fn delete(&self, purpose: &str) -> Result<(), String> {
        validate_purpose(purpose)?;
        self.with_lock(|| {
            let mut document = self.read_document()?;
            document.entries.remove(purpose);
            self.write_document(&document)
        })
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    };

    #[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
    pub(crate) struct VaultAccessCounts {
        pub(crate) status: usize,
        pub(crate) reads: usize,
        pub(crate) writes: usize,
        pub(crate) deletes: usize,
    }

    #[derive(Default)]
    pub(crate) struct MemoryVault {
        values: Mutex<HashMap<String, String>>,
        status_calls: AtomicUsize,
        read_calls: AtomicUsize,
        write_calls: AtomicUsize,
        delete_calls: AtomicUsize,
    }

    impl MemoryVault {
        pub(crate) fn access_counts(&self) -> VaultAccessCounts {
            VaultAccessCounts {
                status: self.status_calls.load(Ordering::SeqCst),
                reads: self.read_calls.load(Ordering::SeqCst),
                writes: self.write_calls.load(Ordering::SeqCst),
                deletes: self.delete_calls.load(Ordering::SeqCst),
            }
        }
    }

    impl DurableAccountVault for MemoryVault {
        fn status(&self) -> AccountVaultStatus {
            self.status_calls.fetch_add(1, Ordering::SeqCst);
            AccountVaultStatus::Ready
        }

        fn read(&self, purpose: &str) -> Result<Option<String>, String> {
            self.read_calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.values.lock().unwrap().get(purpose).cloned())
        }

        fn write(&self, purpose: &str, secret: &str) -> Result<(), String> {
            self.write_calls.fetch_add(1, Ordering::SeqCst);
            self.values
                .lock()
                .unwrap()
                .insert(purpose.to_string(), secret.to_string());
            Ok(())
        }

        fn delete(&self, purpose: &str) -> Result<(), String> {
            self.delete_calls.fetch_add(1, Ordering::SeqCst);
            self.values.lock().unwrap().remove(purpose);
            Ok(())
        }
    }

    #[test]
    fn rejects_unknown_vault_purpose_before_platform_access() {
        assert!(OsAccountVault::entry("../../unknown").is_err());
        assert!(OsAccountVault::entry("refresh-session:abc12345").is_ok());
    }

    #[cfg(all(debug_assertions, target_os = "macos"))]
    struct TestDirectory(std::path::PathBuf);

    #[cfg(all(debug_assertions, target_os = "macos"))]
    impl TestDirectory {
        fn new(label: &str) -> Self {
            Self(std::env::temp_dir().join(format!("doge-debug-vault-{label}-{}", Uuid::new_v4())))
        }
    }

    #[cfg(all(debug_assertions, target_os = "macos"))]
    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[cfg(all(debug_assertions, target_os = "macos"))]
    #[test]
    fn development_vault_round_trips_and_enforces_owner_only_permissions() {
        let root = TestDirectory::new("round-trip");
        let vault = DevelopmentFileAccountVault::new(root.0.join(DEBUG_VAULT_DIRECTORY));
        let purpose = "managed-engine:kimi:abcdefgh";

        assert_eq!(vault.status(), AccountVaultStatus::Ready);
        vault.write(purpose, "synthetic-secret").unwrap();
        assert_eq!(
            vault.read(purpose).unwrap().as_deref(),
            Some("synthetic-secret")
        );

        let directory_mode = std::fs::metadata(&vault.directory)
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        let file_mode = std::fs::metadata(&vault.path).unwrap().permissions().mode() & 0o777;
        assert_eq!(directory_mode, 0o700);
        assert_eq!(file_mode, 0o600);

        std::fs::set_permissions(&vault.path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(vault.read(purpose).unwrap().is_some());
        assert_eq!(
            std::fs::metadata(&vault.path).unwrap().permissions().mode() & 0o777,
            0o600
        );

        vault.delete(purpose).unwrap();
        assert_eq!(vault.read(purpose).unwrap(), None);
    }

    #[cfg(all(debug_assertions, target_os = "macos"))]
    #[test]
    fn development_vault_fails_closed_for_corruption_and_symlinks() {
        use std::os::unix::fs::symlink;

        let corrupt_root = TestDirectory::new("corrupt");
        let corrupt = DevelopmentFileAccountVault::new(corrupt_root.0.join(DEBUG_VAULT_DIRECTORY));
        corrupt.ensure_directory().unwrap();
        std::fs::write(&corrupt.path, b"{not-json").unwrap();
        assert_eq!(corrupt.status(), AccountVaultStatus::Unavailable);
        assert_eq!(
            corrupt.read("refresh-session:abcdefgh").unwrap_err(),
            "development account vault is invalid"
        );

        let symlink_root = TestDirectory::new("symlink");
        let symlinked =
            DevelopmentFileAccountVault::new(symlink_root.0.join(DEBUG_VAULT_DIRECTORY));
        symlinked.ensure_directory().unwrap();
        let target = symlink_root.0.join("outside-target.json");
        std::fs::write(&target, b"unchanged").unwrap();
        symlink(&target, &symlinked.path).unwrap();
        assert_eq!(symlinked.status(), AccountVaultStatus::Unavailable);
        assert!(symlinked
            .write("refresh-session:abcdefgh", "synthetic-secret")
            .is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"unchanged");

        let directory_link_root = TestDirectory::new("directory-symlink");
        std::fs::create_dir_all(&directory_link_root.0).unwrap();
        let redirected_directory = directory_link_root.0.join("redirected");
        std::fs::create_dir(&redirected_directory).unwrap();
        let linked_directory = directory_link_root.0.join(DEBUG_VAULT_DIRECTORY);
        symlink(&redirected_directory, &linked_directory).unwrap();
        let directory_link = DevelopmentFileAccountVault::new(linked_directory);
        let error = directory_link
            .write("refresh-session:abcdefgh", "synthetic-secret")
            .unwrap_err();
        assert_eq!(error, "development account vault is unsafe");
        assert!(!error.contains("synthetic-secret"));
        assert!(!error.contains(redirected_directory.to_string_lossy().as_ref()));
        assert_eq!(std::fs::read_dir(&redirected_directory).unwrap().count(), 0);
    }

    #[cfg(all(debug_assertions, target_os = "macos"))]
    #[test]
    fn development_vault_rejects_unknown_schema_purpose_and_oversize_data() {
        let schema_root = TestDirectory::new("unknown-schema");
        let schema = DevelopmentFileAccountVault::new(schema_root.0.join(DEBUG_VAULT_DIRECTORY));
        schema.ensure_directory().unwrap();
        std::fs::write(
            &schema.path,
            br#"{"version":2,"entries":{"refresh-session:abcdefgh":"synthetic"}}"#,
        )
        .unwrap();
        assert_eq!(schema.status(), AccountVaultStatus::Unavailable);

        let purpose_root = TestDirectory::new("unknown-purpose");
        let purpose = DevelopmentFileAccountVault::new(purpose_root.0.join(DEBUG_VAULT_DIRECTORY));
        purpose.ensure_directory().unwrap();
        std::fs::write(
            &purpose.path,
            br#"{"version":1,"entries":{"unexpected:abcdefgh":"synthetic"}}"#,
        )
        .unwrap();
        assert_eq!(purpose.status(), AccountVaultStatus::Unavailable);

        let field_root = TestDirectory::new("unknown-field");
        let field = DevelopmentFileAccountVault::new(field_root.0.join(DEBUG_VAULT_DIRECTORY));
        field.ensure_directory().unwrap();
        std::fs::write(
            &field.path,
            br#"{"version":1,"entries":{},"unexpected":true}"#,
        )
        .unwrap();
        assert_eq!(field.status(), AccountVaultStatus::Unavailable);

        let oversize_root = TestDirectory::new("oversize");
        let oversize =
            DevelopmentFileAccountVault::new(oversize_root.0.join(DEBUG_VAULT_DIRECTORY));
        oversize.ensure_directory().unwrap();
        std::fs::write(
            &oversize.path,
            vec![b'x'; DEBUG_VAULT_MAX_BYTES as usize + 1],
        )
        .unwrap();
        assert_eq!(oversize.status(), AccountVaultStatus::Unavailable);
        let secret = "x".repeat(DEBUG_VAULT_MAX_SECRET_BYTES + 1);
        let error = oversize
            .write("refresh-session:abcdefgh", &secret)
            .unwrap_err();
        assert_eq!(error, "account vault refuses an invalid secret");
        assert!(!error.contains(&secret));
    }

    #[cfg(all(debug_assertions, target_os = "macos"))]
    #[test]
    fn macos_debug_selector_uses_the_file_vault_without_platform_access() {
        let root = TestDirectory::new("selector");
        let vault = account_vault_for_data_dir(&root.0);
        vault
            .write("refresh-session:abcdefgh", "synthetic-refresh")
            .unwrap();
        assert_eq!(
            vault.read("refresh-session:abcdefgh").unwrap().as_deref(),
            Some("synthetic-refresh")
        );
        assert!(root
            .0
            .join(DEBUG_VAULT_DIRECTORY)
            .join(DEBUG_VAULT_FILENAME)
            .is_file());
    }
}
