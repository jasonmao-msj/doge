use super::*;
use zip::write::SimpleFileOptions;

fn unique_test_dir(prefix: &str) -> PathBuf {
    std::env::temp_dir().join(format!("{prefix}-{}", Uuid::new_v4().as_simple()))
}

fn write_valid_installation(root: &Path, version: &str) {
    fs::create_dir_all(root.join("assets")).expect("create assets directory");
    fs::write(
        root.join("index.html"),
        r#"<!doctype html><div id="root"></div><script type="module" src="/assets/app.js"></script>"#,
    )
    .expect("write index");
    fs::write(root.join("assets/app.js"), "app").expect("write asset");
    fs::write(
        root.join(MANIFEST_FILE),
        serde_json::to_vec(&WebAssetsManifest {
            schema_version: MANIFEST_SCHEMA_VERSION,
            assets_version: version.to_string(),
            entrypoint: "index.html".to_string(),
        })
        .expect("serialize manifest"),
    )
    .expect("write manifest");
    fs::write(root.join(VERSION_MARKER_FILE), version).expect("write marker");
}

fn create_zip(path: &Path, entries: &[(&str, &[u8])]) {
    let file = File::create(path).expect("create zip");
    let mut writer = zip::ZipWriter::new(file);
    for (name, contents) in entries {
        writer
            .start_file(*name, SimpleFileOptions::default())
            .expect("start zip file");
        writer.write_all(contents).expect("write zip file");
    }
    writer.finish().expect("finish zip");
}

fn write_archive_checksum(path: &Path) {
    let bytes = fs::read(path).expect("read archive for checksum");
    let checksum = format!("{:x}", Sha256::digest(bytes));
    fs::write(
        adjacent_checksum_path(path),
        format!("{checksum}  archive.zip\n"),
    )
    .expect("write checksum");
}

#[test]
fn validates_current_version_and_rejects_mismatch() {
    let root = unique_test_dir("managed-web-assets-version");
    write_valid_installation(&root, "1.2.3");

    assert!(validate_installation(&root, "1.2.3").is_ok());
    assert!(validate_installation(&root, "1.2.4")
        .expect_err("version mismatch")
        .contains("does not match"));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn validates_legacy_marker_but_new_installations_write_doge_marker() {
    let root = unique_test_dir("managed-web-assets-legacy-marker");
    write_valid_installation(&root, "1.2.3");
    fs::rename(
        root.join(VERSION_MARKER_FILE),
        root.join(LEGACY_VERSION_MARKER_FILES[0]),
    )
    .expect("replace current marker with legacy marker");

    assert!(validate_installation(&root, "1.2.3").is_ok());
    assert_eq!(read_installed_version(&root).as_deref(), Some("1.2.3"));
    assert!(!root.join(VERSION_MARKER_FILE).exists());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn extracts_valid_archive_and_rejects_path_traversal() {
    let root = unique_test_dir("managed-web-assets-zip");
    fs::create_dir_all(&root).expect("create root");
    let valid_zip = root.join("valid.zip");
    create_zip(
        &valid_zip,
        &[("index.html", b"index"), ("assets/app.js", b"app")],
    );
    let valid_staging = root.join("valid-staging");
    extract_archive(&valid_zip, &valid_staging).expect("extract valid archive");
    assert_eq!(
        fs::read(valid_staging.join("assets/app.js")).expect("read extracted asset"),
        b"app"
    );

    let unsafe_zip = root.join("unsafe.zip");
    let current = root.join("current");
    write_valid_installation(&current, "1.0.0");
    create_zip(&unsafe_zip, &[("../escape.txt", b"escape")]);
    let error =
        extract_archive(&unsafe_zip, &root.join("unsafe-staging")).expect_err("reject traversal");
    assert!(error.contains("unsafe Web assets ZIP path"));
    assert!(!root.join("escape.txt").exists());
    assert!(validate_installation(&current, "1.0.0").is_ok());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn rejects_checksum_mismatch() {
    let root = unique_test_dir("managed-web-assets-checksum");
    fs::create_dir_all(&root).expect("create root");
    let archive = root.join("archive.zip");
    fs::write(&archive, b"archive").expect("write archive");

    let error =
        verify_archive_checksum(&archive, &"0".repeat(64)).expect_err("reject checksum mismatch");
    assert!(error.contains("checksum mismatch"));

    let _ = fs::remove_dir_all(root);
}

#[test]
fn activation_replaces_current_and_keeps_valid_result() {
    let root = unique_test_dir("managed-web-assets-activation");
    let current = root.join("current");
    let staging = root.join("staging");
    write_valid_installation(&current, "1.0.0");
    write_valid_installation(&staging, "2.0.0");

    activate_staging(&root, &staging).expect("activate staging");

    assert!(validate_installation(&current, "2.0.0").is_ok());
    assert!(!staging.exists());
    assert_eq!(
        fs::read_to_string(current.join(VERSION_MARKER_FILE)).expect("read current marker"),
        "2.0.0"
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn rejects_missing_entrypoint_and_invalid_checksum_text() {
    let root = unique_test_dir("managed-web-assets-entrypoint");
    fs::create_dir_all(root.join("assets")).expect("create assets");
    fs::write(
        root.join(MANIFEST_FILE),
        r#"{"schemaVersion":1,"assetsVersion":"1.0.0","entrypoint":"index.html"}"#,
    )
    .expect("write manifest");

    assert!(validate_installation_contents(&root, "1.0.0")
        .expect_err("missing entrypoint")
        .contains("entrypoint"));
    assert!(parse_checksum("not-a-checksum").is_err());
    assert_eq!(
        parse_checksum(&"A".repeat(64)).expect("valid checksum"),
        "a".repeat(64)
    );

    let _ = fs::remove_dir_all(root);
}

#[test]
fn status_serializes_with_frontend_camel_case_contract() {
    let value = serde_json::to_value(WebAssetsStatus {
        state: WebAssetsState::Ready,
        installed_version: Some("1.2.3".to_string()),
        required_version: "1.2.3".to_string(),
        last_error: None,
        installation_required: true,
    })
    .expect("serialize status");

    assert_eq!(value["state"], "ready");
    assert_eq!(value["installedVersion"], "1.2.3");
    assert_eq!(value["requiredVersion"], "1.2.3");
    assert_eq!(value["lastError"], serde_json::Value::Null);
    assert_eq!(value["installationRequired"], true);
}

#[test]
fn failed_reinstall_keeps_valid_current_ready_and_reports_operation_error() {
    let root = unique_test_dir("managed-web-assets-failed-reinstall");
    let current = root.join("current");
    write_valid_installation(&current, "1.2.3");

    let status = status_after_install_failure(
        &current,
        "1.2.3".to_string(),
        "HTTP status client error (404 Not Found)".to_string(),
    );

    assert_eq!(status.state, WebAssetsState::Ready);
    assert_eq!(status.installed_version.as_deref(), Some("1.2.3"));
    assert!(status
        .last_error
        .as_deref()
        .is_some_and(|error| error.contains("404 Not Found")));
    assert!(validate_installation(&current, "1.2.3").is_ok());

    let _ = fs::remove_dir_all(root);
}

#[test]
fn failed_initial_install_remains_failed() {
    let root = unique_test_dir("managed-web-assets-failed-initial-install");
    let current = root.join("current");

    let status = status_after_install_failure(
        &current,
        "1.2.3".to_string(),
        "HTTP status client error (404 Not Found)".to_string(),
    );

    assert_eq!(status.state, WebAssetsState::Failed);
    assert_eq!(status.installed_version, None);
    assert!(status
        .last_error
        .as_deref()
        .is_some_and(|error| error.contains("404 Not Found")));

    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn installs_local_package_with_adjacent_checksum() {
    let root = unique_test_dir("managed-web-assets-local");
    fs::create_dir_all(&root).expect("create root");
    let source = root.join("doge-web-assets_2.0.0.zip");
    create_zip(
        &source,
        &[
            (
                "index.html",
                br#"<div id="root"></div><script type="module" src="/assets/app.js"></script>"#,
            ),
            ("assets/app.js", b"app"),
            (
                "manifest.json",
                br#"{"schemaVersion":1,"assetsVersion":"2.0.0","entrypoint":"index.html"}"#,
            ),
        ],
    );
    write_archive_checksum(&source);

    install_from_local_package(
        &source,
        &root.join("copied.zip"),
        &root.join("staging"),
        &root,
        "2.0.0",
    )
    .await
    .expect("install local package");

    assert!(validate_installation(&root.join("current"), "2.0.0").is_ok());
    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn rejects_tampered_local_package_without_replacing_current() {
    let root = unique_test_dir("managed-web-assets-local-tampered");
    let current = root.join("current");
    fs::create_dir_all(&root).expect("create root");
    write_valid_installation(&current, "1.0.0");
    let source = root.join("doge-web-assets_2.0.0.zip");
    create_zip(&source, &[("index.html", b"tampered")]);
    fs::write(
        adjacent_checksum_path(&source),
        format!("{}\n", "0".repeat(64)),
    )
    .expect("write invalid checksum");

    let error = install_from_local_package(
        &source,
        &root.join("copied.zip"),
        &root.join("staging"),
        &root,
        "2.0.0",
    )
    .await
    .expect_err("reject tampered package");

    assert!(error.contains("checksum mismatch"));
    assert!(validate_installation(&current, "1.0.0").is_ok());
    let _ = fs::remove_dir_all(root);
}
