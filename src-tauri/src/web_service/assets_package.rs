use std::collections::HashSet;
use std::env;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;
use zip::ZipArchive;

const VERSION_MARKER_FILE: &str = ".doge-web-assets-version";
const LEGACY_VERSION_MARKER_FILES: &[&str] = &[".ccgui-web-assets-version"];
const MANIFEST_FILE: &str = "manifest.json";
const MANIFEST_SCHEMA_VERSION: u32 = 1;
const RELEASE_BASE_URL_ENV: &str = "DOGE_WEB_ASSETS_BASE_URL";
const LEGACY_RELEASE_BASE_URL_ENV: &str = "MOSSX_WEB_ASSETS_BASE_URL";
const RELEASE_REPOSITORY_URL: &str = "https://github.com/jasonmao-msj/doge/releases/download";
const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_UNPACKED_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 100_000;

static INSTALL_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum WebAssetsState {
    Missing,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WebAssetsStatus {
    pub(crate) state: WebAssetsState,
    pub(crate) installed_version: Option<String>,
    pub(crate) required_version: String,
    pub(crate) last_error: Option<String>,
    pub(crate) installation_required: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct WebAssetsManifest {
    schema_version: u32,
    assets_version: String,
    entrypoint: String,
}

pub(crate) fn get_status(app: &AppHandle) -> WebAssetsStatus {
    let required_version = app.package_info().version.to_string();
    let current_dir = match current_assets_dir(app) {
        Ok(path) => path,
        Err(error) => return failed_status(required_version, None, error),
    };

    if !current_dir.exists() {
        return WebAssetsStatus {
            state: WebAssetsState::Missing,
            installed_version: None,
            required_version,
            last_error: None,
            installation_required: !cfg!(debug_assertions),
        };
    }

    match validate_installation(&current_dir, &required_version) {
        Ok(manifest) => WebAssetsStatus {
            state: WebAssetsState::Ready,
            installed_version: Some(manifest.assets_version),
            required_version,
            last_error: None,
            installation_required: !cfg!(debug_assertions),
        },
        Err(error) => failed_status(
            required_version,
            read_installed_version(&current_dir),
            error,
        ),
    }
}

pub(crate) fn ready_assets_dir(app: &AppHandle) -> Option<PathBuf> {
    let required_version = app.package_info().version.to_string();
    let current_dir = current_assets_dir(app).ok()?;
    validate_installation(&current_dir, &required_version).ok()?;
    Some(current_dir)
}

pub(crate) async fn install(app: &AppHandle) -> WebAssetsStatus {
    let install_lock = INSTALL_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
    let _install_guard = install_lock.lock().await;
    let required_version = app.package_info().version.to_string();
    let assets_root = match assets_root_dir(app) {
        Ok(path) => path,
        Err(error) => return failed_status(required_version, None, error),
    };
    if let Err(error) = tokio::fs::create_dir_all(&assets_root).await {
        return failed_status(
            required_version,
            None,
            format!(
                "failed to create Web assets directory {}: {error}",
                assets_root.display()
            ),
        );
    }

    let archive_name = format!("doge-web-assets_{required_version}.zip");
    let base_url = release_base_url(&required_version);
    let archive_url = format!("{base_url}/{archive_name}");
    let checksum_url = format!("{archive_url}.sha256");
    let operation_id = Uuid::new_v4().as_simple().to_string();
    let archive_path = assets_root.join(format!("download-{operation_id}.zip"));
    let staging_dir = assets_root.join(format!("staging-{operation_id}"));

    let result = install_from_release(
        &archive_url,
        &checksum_url,
        &archive_path,
        &staging_dir,
        &assets_root,
        &required_version,
    )
    .await;

    let _ = tokio::fs::remove_file(&archive_path).await;
    if result.is_err() {
        let _ = tokio::fs::remove_dir_all(&staging_dir).await;
    }

    match result {
        Ok(()) => get_status(app),
        Err(error) => {
            status_after_install_failure(&assets_root.join("current"), required_version, error)
        }
    }
}

pub(crate) async fn install_from_file(app: &AppHandle, source_path: &Path) -> WebAssetsStatus {
    let install_lock = INSTALL_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
    let _install_guard = install_lock.lock().await;
    let required_version = app.package_info().version.to_string();
    let assets_root = match assets_root_dir(app) {
        Ok(path) => path,
        Err(error) => return failed_status(required_version, None, error),
    };
    if let Err(error) = tokio::fs::create_dir_all(&assets_root).await {
        return failed_status(
            required_version,
            None,
            format!(
                "failed to create Web assets directory {}: {error}",
                assets_root.display()
            ),
        );
    }

    let operation_id = Uuid::new_v4().as_simple().to_string();
    let archive_path = assets_root.join(format!("local-{operation_id}.zip"));
    let staging_dir = assets_root.join(format!("staging-{operation_id}"));
    let result = install_from_local_package(
        source_path,
        &archive_path,
        &staging_dir,
        &assets_root,
        &required_version,
    )
    .await;

    let _ = tokio::fs::remove_file(&archive_path).await;
    if result.is_err() {
        let _ = tokio::fs::remove_dir_all(&staging_dir).await;
    }

    match result {
        Ok(()) => get_status(app),
        Err(error) => {
            status_after_install_failure(&assets_root.join("current"), required_version, error)
        }
    }
}

async fn install_from_release(
    archive_url: &str,
    checksum_url: &str,
    archive_path: &Path,
    staging_dir: &Path,
    assets_root: &Path,
    required_version: &str,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|error| format!("failed to create Web assets HTTP client: {error}"))?;
    let checksum_response = client
        .get(checksum_url)
        .send()
        .await
        .map_err(|error| format!("failed to download Web assets checksum: {error}"))?
        .error_for_status()
        .map_err(|error| format!("failed to download Web assets checksum: {error}"))?;
    if checksum_response
        .content_length()
        .is_some_and(|length| length > 4096)
    {
        return Err("Web assets checksum response is too large".to_string());
    }
    let checksum_source = checksum_response
        .text()
        .await
        .map_err(|error| format!("failed to read Web assets checksum: {error}"))?;
    if checksum_source.len() > 4096 {
        return Err("Web assets checksum response is too large".to_string());
    }
    let expected_checksum = parse_checksum(&checksum_source)?;

    download_archive(&client, archive_url, archive_path).await?;
    verify_archive_checksum(archive_path, &expected_checksum)?;

    install_verified_archive(archive_path, staging_dir, assets_root, required_version).await
}

async fn install_from_local_package(
    source_path: &Path,
    archive_path: &Path,
    staging_dir: &Path,
    assets_root: &Path,
    required_version: &str,
) -> Result<(), String> {
    if !source_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
    {
        return Err("Web assets local package must be a .zip file".to_string());
    }

    let source_metadata = tokio::fs::metadata(source_path).await.map_err(|error| {
        format!(
            "failed to read local Web assets package {}: {error}",
            source_path.display()
        )
    })?;
    if !source_metadata.is_file() {
        return Err(format!(
            "local Web assets package is not a file: {}",
            source_path.display()
        ));
    }
    if source_metadata.len() > MAX_ARCHIVE_BYTES {
        return Err(format!(
            "Web assets archive exceeds the {} byte limit",
            MAX_ARCHIVE_BYTES
        ));
    }

    let checksum_path = adjacent_checksum_path(source_path);
    let checksum_metadata = tokio::fs::metadata(&checksum_path).await.map_err(|error| {
        format!(
            "failed to read local Web assets checksum {}: {error}",
            checksum_path.display()
        )
    })?;
    if !checksum_metadata.is_file() || checksum_metadata.len() > 4096 {
        return Err("Web assets checksum file is invalid or too large".to_string());
    }
    let checksum_source = tokio::fs::read_to_string(&checksum_path)
        .await
        .map_err(|error| format!("failed to read local Web assets checksum: {error}"))?;
    let expected_checksum = parse_checksum(&checksum_source)?;

    tokio::fs::copy(source_path, archive_path)
        .await
        .map_err(|error| format!("failed to copy local Web assets package: {error}"))?;
    let copied_size = tokio::fs::metadata(archive_path)
        .await
        .map_err(|error| format!("failed to inspect copied Web assets package: {error}"))?
        .len();
    if copied_size > MAX_ARCHIVE_BYTES {
        return Err(format!(
            "Web assets archive exceeds the {} byte limit",
            MAX_ARCHIVE_BYTES
        ));
    }
    verify_archive_checksum(archive_path, &expected_checksum)?;

    install_verified_archive(archive_path, staging_dir, assets_root, required_version).await
}

async fn install_verified_archive(
    archive_path: &Path,
    staging_dir: &Path,
    assets_root: &Path,
    required_version: &str,
) -> Result<(), String> {
    let archive_path = archive_path.to_path_buf();
    let staging_dir = staging_dir.to_path_buf();
    let assets_root = assets_root.to_path_buf();
    let required_version = required_version.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        extract_archive(&archive_path, &staging_dir)?;
        validate_installation_contents(&staging_dir, &required_version)?;
        fs::write(staging_dir.join(VERSION_MARKER_FILE), &required_version)
            .map_err(|error| format!("failed to write Web assets version marker: {error}"))?;
        activate_staging(&assets_root, &staging_dir)
    })
    .await
    .map_err(|error| format!("Web assets installation task failed: {error}"))?
}

fn adjacent_checksum_path(archive_path: &Path) -> PathBuf {
    let mut checksum_path = archive_path.as_os_str().to_os_string();
    checksum_path.push(".sha256");
    PathBuf::from(checksum_path)
}

async fn download_archive(
    client: &reqwest::Client,
    archive_url: &str,
    archive_path: &Path,
) -> Result<(), String> {
    let mut response = client
        .get(archive_url)
        .send()
        .await
        .map_err(|error| format!("failed to download Web assets archive: {error}"))?
        .error_for_status()
        .map_err(|error| format!("failed to download Web assets archive: {error}"))?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_ARCHIVE_BYTES)
    {
        return Err(format!(
            "Web assets archive exceeds the {} byte limit",
            MAX_ARCHIVE_BYTES
        ));
    }

    let mut output = tokio::fs::File::create(archive_path)
        .await
        .map_err(|error| format!("failed to create Web assets download: {error}"))?;
    let mut downloaded = 0_u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("failed while downloading Web assets archive: {error}"))?
    {
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        if downloaded > MAX_ARCHIVE_BYTES {
            return Err(format!(
                "Web assets archive exceeds the {} byte limit",
                MAX_ARCHIVE_BYTES
            ));
        }
        output
            .write_all(&chunk)
            .await
            .map_err(|error| format!("failed to write Web assets download: {error}"))?;
    }
    output
        .flush()
        .await
        .map_err(|error| format!("failed to flush Web assets download: {error}"))?;
    Ok(())
}

fn extract_archive(archive_path: &Path, staging_dir: &Path) -> Result<(), String> {
    if staging_dir.exists() {
        fs::remove_dir_all(staging_dir).map_err(|error| {
            format!(
                "failed to clear Web assets staging directory {}: {error}",
                staging_dir.display()
            )
        })?;
    }
    fs::create_dir_all(staging_dir).map_err(|error| {
        format!(
            "failed to create Web assets staging directory {}: {error}",
            staging_dir.display()
        )
    })?;

    let archive_file = File::open(archive_path)
        .map_err(|error| format!("failed to open Web assets archive: {error}"))?;
    let mut archive = ZipArchive::new(archive_file)
        .map_err(|error| format!("failed to parse Web assets archive: {error}"))?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(format!(
            "Web assets archive exceeds the {} entry limit",
            MAX_ARCHIVE_ENTRIES
        ));
    }

    let mut extracted_paths = HashSet::new();
    let mut unpacked_bytes = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("failed to read Web assets ZIP entry: {error}"))?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| format!("unsafe Web assets ZIP path: {}", entry.name()))?
            .to_path_buf();
        if relative.as_os_str().is_empty() || !extracted_paths.insert(relative.clone()) {
            return Err(format!(
                "invalid or duplicate Web assets ZIP path: {}",
                entry.name()
            ));
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(format!(
                "symbolic links are not allowed in Web assets ZIP: {}",
                entry.name()
            ));
        }

        unpacked_bytes = unpacked_bytes.saturating_add(entry.size());
        if unpacked_bytes > MAX_UNPACKED_BYTES {
            return Err(format!(
                "Web assets archive exceeds the {} unpacked byte limit",
                MAX_UNPACKED_BYTES
            ));
        }

        let target = staging_dir.join(&relative);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|error| {
                format!(
                    "failed to create Web assets directory {}: {error}",
                    target.display()
                )
            })?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "failed to create Web assets directory {}: {error}",
                    parent.display()
                )
            })?;
        }
        let mut output = File::create(&target).map_err(|error| {
            format!(
                "failed to create Web assets file {}: {error}",
                target.display()
            )
        })?;
        std::io::copy(&mut entry, &mut output).map_err(|error| {
            format!(
                "failed to extract Web assets file {}: {error}",
                target.display()
            )
        })?;
        output.flush().map_err(|error| {
            format!(
                "failed to flush Web assets file {}: {error}",
                target.display()
            )
        })?;
    }
    Ok(())
}

fn activate_staging(assets_root: &Path, staging_dir: &Path) -> Result<(), String> {
    let current_dir = assets_root.join("current");
    let backup_dir = assets_root.join(format!("backup-{}", Uuid::new_v4().as_simple()));
    let had_current = current_dir.exists();

    if had_current {
        fs::rename(&current_dir, &backup_dir).map_err(|error| {
            format!(
                "failed to preserve current Web assets {}: {error}",
                current_dir.display()
            )
        })?;
    }

    if let Err(error) = fs::rename(staging_dir, &current_dir) {
        if had_current {
            if let Err(restore_error) = fs::rename(&backup_dir, &current_dir) {
                return Err(format!(
                    "failed to activate Web assets at {}: {error}; failed to restore backup {}: {restore_error}",
                    current_dir.display(),
                    backup_dir.display()
                ));
            }
        }
        return Err(format!(
            "failed to activate Web assets at {}: {error}",
            current_dir.display()
        ));
    }

    if had_current {
        if let Err(error) = fs::remove_dir_all(&backup_dir) {
            log::warn!(
                "[web-assets] failed to remove backup {}: {error}",
                backup_dir.display()
            );
        }
    }
    Ok(())
}

fn validate_installation(
    current_dir: &Path,
    required_version: &str,
) -> Result<WebAssetsManifest, String> {
    let marker = read_version_marker(current_dir)
        .ok_or_else(|| "failed to read Web assets version marker".to_string())?;
    if marker.trim() != required_version {
        return Err(format!(
            "Web assets version {} does not match required version {required_version}",
            marker.trim()
        ));
    }
    validate_installation_contents(current_dir, required_version)
}

fn validate_installation_contents(
    current_dir: &Path,
    required_version: &str,
) -> Result<WebAssetsManifest, String> {
    let manifest_source = fs::read_to_string(current_dir.join(MANIFEST_FILE))
        .map_err(|error| format!("failed to read Web assets manifest: {error}"))?;
    let manifest: WebAssetsManifest = serde_json::from_str(&manifest_source)
        .map_err(|error| format!("failed to parse Web assets manifest: {error}"))?;
    if manifest.schema_version != MANIFEST_SCHEMA_VERSION {
        return Err(format!(
            "unsupported Web assets manifest schema {}",
            manifest.schema_version
        ));
    }
    if manifest.assets_version != required_version {
        return Err(format!(
            "Web assets manifest version {} does not match required version {required_version}",
            manifest.assets_version
        ));
    }
    if manifest.entrypoint != "index.html" {
        return Err(format!(
            "unsupported Web assets entrypoint {}",
            manifest.entrypoint
        ));
    }
    if !current_dir.join("assets").is_dir() {
        return Err("Web assets directory is missing".to_string());
    }
    validate_index_html(&current_dir.join(&manifest.entrypoint))?;
    Ok(manifest)
}

fn validate_index_html(index_path: &Path) -> Result<(), String> {
    let source = fs::read_to_string(index_path)
        .map_err(|error| format!("failed to read Web assets entrypoint: {error}"))?;
    let has_root = source.contains("id=\"root\"") || source.contains("id='root'");
    let has_entry = source.contains("/assets/")
        || source.contains("type=\"module\"")
        || source.contains("type='module'");
    if !has_root || !has_entry {
        return Err("Web assets entrypoint is not a valid Vite application shell".to_string());
    }
    Ok(())
}

fn verify_archive_checksum(archive_path: &Path, expected: &str) -> Result<(), String> {
    let mut file = File::open(archive_path)
        .map_err(|error| format!("failed to open Web assets archive for checksum: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("failed to read Web assets archive: {error}"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if !actual.eq_ignore_ascii_case(expected) {
        return Err(format!(
            "Web assets checksum mismatch: expected {expected}, got {actual}"
        ));
    }
    Ok(())
}

fn parse_checksum(source: &str) -> Result<String, String> {
    let checksum = source
        .split_whitespace()
        .next()
        .ok_or_else(|| "Web assets checksum file is empty".to_string())?;
    if checksum.len() != 64 || !checksum.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Web assets checksum is not a valid SHA-256 value".to_string());
    }
    Ok(checksum.to_ascii_lowercase())
}

fn release_base_url(version: &str) -> String {
    [RELEASE_BASE_URL_ENV, LEGACY_RELEASE_BASE_URL_ENV]
        .into_iter()
        .find_map(|env_name| env::var(env_name).ok())
        .map(|value| value.trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("{RELEASE_REPOSITORY_URL}/v{version}"))
}

fn assets_root_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("web-assets"))
        .map_err(|error| format!("failed to resolve app data directory: {error}"))
}

fn current_assets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    assets_root_dir(app).map(|path| path.join("current"))
}

fn read_installed_version(current_dir: &Path) -> Option<String> {
    read_version_marker(current_dir)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            let source = fs::read_to_string(current_dir.join(MANIFEST_FILE)).ok()?;
            serde_json::from_str::<WebAssetsManifest>(&source)
                .ok()
                .map(|manifest| manifest.assets_version)
        })
}

fn read_version_marker(current_dir: &Path) -> Option<String> {
    std::iter::once(VERSION_MARKER_FILE)
        .chain(LEGACY_VERSION_MARKER_FILES.iter().copied())
        .find_map(|filename| fs::read_to_string(current_dir.join(filename)).ok())
}

fn failed_status(
    required_version: String,
    installed_version: Option<String>,
    error: String,
) -> WebAssetsStatus {
    WebAssetsStatus {
        state: WebAssetsState::Failed,
        installed_version,
        required_version,
        last_error: Some(error),
        installation_required: !cfg!(debug_assertions),
    }
}

fn status_after_install_failure(
    current_dir: &Path,
    required_version: String,
    error: String,
) -> WebAssetsStatus {
    match validate_installation(current_dir, &required_version) {
        Ok(manifest) => WebAssetsStatus {
            state: WebAssetsState::Ready,
            installed_version: Some(manifest.assets_version),
            required_version,
            last_error: Some(error),
            installation_required: !cfg!(debug_assertions),
        },
        Err(_) => failed_status(required_version, read_installed_version(current_dir), error),
    }
}

#[cfg(test)]
#[path = "assets_package_tests.rs"]
mod tests;
