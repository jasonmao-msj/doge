use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::Command;

use crate::backend::app_server_cli::{
    build_codex_command_from_launch_context, resolve_codex_launch_context,
};

use super::provider_profile::join_shell_escaped_codex_args;

const MANAGED_MODEL_CATALOG_FILE_NAME: &str = "managed-model-catalog.json";
const MANAGED_MODEL_CATALOG_ERROR_PREFIX: &str = "[MANAGED_CODEX_MODEL_CATALOG]";
const MODEL_CATALOG_EXPORT_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_MODEL_CATALOG_BYTES: usize = 4 * 1024 * 1024;
const MAX_MODEL_CATALOG_STDERR_BYTES: usize = 64 * 1024;
const TARGET_NON_LITE_MODELS: [&str; 3] = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];

pub(crate) async fn materialize_managed_codex_model_catalog(
    codex_bin: Option<&str>,
    codex_home: &Path,
) -> Result<PathBuf, String> {
    let launch_context = resolve_codex_launch_context(codex_bin);
    let mut command = build_codex_command_from_launch_context(&launch_context, true);
    command.arg("debug").arg("models").arg("--bundled");
    command.env("CODEX_HOME", codex_home);
    let exported = capture_bounded_command(
        command,
        MODEL_CATALOG_EXPORT_TIMEOUT,
        MAX_MODEL_CATALOG_BYTES,
        MAX_MODEL_CATALOG_STDERR_BYTES,
    )
    .await?;

    let destination = codex_home.join(MANAGED_MODEL_CATALOG_FILE_NAME);
    let destination_for_write = destination.clone();
    tokio::task::spawn_blocking(move || {
        let patched = patch_managed_model_catalog(&exported)?;
        write_private_file_atomically_if_changed(&destination_for_write, &patched)?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|error| {
        format!("{MANAGED_MODEL_CATALOG_ERROR_PREFIX} catalog materialization task failed: {error}")
    })??;
    Ok(destination)
}

pub(crate) fn managed_model_catalog_codex_args(path: &Path) -> String {
    let value = toml::Value::String(path.to_string_lossy().to_string());
    join_shell_escaped_codex_args(&["-c".to_string(), format!("model_catalog_json={value}")])
}

async fn capture_bounded_command(
    mut command: Command,
    timeout_duration: Duration,
    stdout_limit: usize,
    stderr_limit: usize,
) -> Result<Vec<u8>, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    configure_process_group(&mut command);

    let mut child = command.spawn().map_err(|error| {
        format!(
            "{MANAGED_MODEL_CATALOG_ERROR_PREFIX} failed to start Codex bundled catalog export: {error}"
        )
    })?;
    let process_id = child.id();
    let stdout = child.stdout.take().ok_or_else(|| {
        format!("{MANAGED_MODEL_CATALOG_ERROR_PREFIX} catalog exporter stdout is unavailable")
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        format!("{MANAGED_MODEL_CATALOG_ERROR_PREFIX} catalog exporter stderr is unavailable")
    })?;
    let stdout_task = tokio::spawn(read_bounded_stream(stdout, stdout_limit, "stdout"));
    let stderr_task = tokio::spawn(read_bounded_stream(stderr, stderr_limit, "stderr"));

    let status = match tokio::time::timeout(timeout_duration, child.wait()).await {
        Ok(result) => result.map_err(|error| {
            format!("{MANAGED_MODEL_CATALOG_ERROR_PREFIX} catalog exporter wait failed: {error}")
        })?,
        Err(_) => {
            terminate_process_owner(process_id, &mut child).await;
            stdout_task.abort();
            stderr_task.abort();
            return Err(format!(
                "{MANAGED_MODEL_CATALOG_ERROR_PREFIX} catalog export timed out after {}s",
                timeout_duration.as_secs()
            ));
        }
    };
    let stdout = stdout_task.await.map_err(|error| {
        format!("{MANAGED_MODEL_CATALOG_ERROR_PREFIX} catalog stdout task failed: {error}")
    })??;
    let stderr = stderr_task.await.map_err(|error| {
        format!("{MANAGED_MODEL_CATALOG_ERROR_PREFIX} catalog stderr task failed: {error}")
    })??;
    if !status.success() {
        let detail = String::from_utf8_lossy(&stderr);
        let detail = detail.trim().replace(['\r', '\n'], " ");
        let suffix = if detail.is_empty() {
            String::new()
        } else {
            format!(": {detail}")
        };
        return Err(format!(
            "{MANAGED_MODEL_CATALOG_ERROR_PREFIX} catalog exporter exited with status {status}{suffix}"
        ));
    }
    if stdout.is_empty() {
        return Err(format!(
            "{MANAGED_MODEL_CATALOG_ERROR_PREFIX} catalog exporter returned empty output"
        ));
    }
    Ok(stdout)
}

async fn read_bounded_stream<R>(
    mut reader: R,
    limit: usize,
    label: &'static str,
) -> Result<Vec<u8>, String>
where
    R: AsyncRead + Unpin,
{
    let mut output = Vec::new();
    let mut chunk = [0_u8; 8192];
    loop {
        let read = reader.read(&mut chunk).await.map_err(|error| {
            format!(
                "{MANAGED_MODEL_CATALOG_ERROR_PREFIX} failed to read catalog exporter {label}: {error}"
            )
        })?;
        if read == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(read) > limit {
            return Err(format!(
                "{MANAGED_MODEL_CATALOG_ERROR_PREFIX} catalog exporter {label} exceeded {limit} bytes"
            ));
        }
        output.extend_from_slice(&chunk[..read]);
    }
}

fn patch_managed_model_catalog(exported: &[u8]) -> Result<Vec<u8>, String> {
    if exported.len() > MAX_MODEL_CATALOG_BYTES {
        return Err(format!(
            "{MANAGED_MODEL_CATALOG_ERROR_PREFIX} bundled catalog exceeded {MAX_MODEL_CATALOG_BYTES} bytes"
        ));
    }
    let mut root: Value = serde_json::from_slice(exported).map_err(|error| {
        format!("{MANAGED_MODEL_CATALOG_ERROR_PREFIX} bundled catalog is not valid JSON: {error}")
    })?;
    let models = root
        .get_mut("models")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| {
            format!(
                "{MANAGED_MODEL_CATALOG_ERROR_PREFIX} bundled catalog is missing a models array"
            )
        })?;

    for target in TARGET_NON_LITE_MODELS {
        let mut matches = models
            .iter_mut()
            .filter(|model| model.get("slug").and_then(Value::as_str) == Some(target));
        let model = matches.next().ok_or_else(|| {
            format!(
                "{MANAGED_MODEL_CATALOG_ERROR_PREFIX} bundled catalog is missing required model {target}"
            )
        })?;
        if matches.next().is_some() {
            return Err(format!(
                "{MANAGED_MODEL_CATALOG_ERROR_PREFIX} bundled catalog contains duplicate model {target}"
            ));
        }
        let object = model.as_object_mut().ok_or_else(|| {
            format!("{MANAGED_MODEL_CATALOG_ERROR_PREFIX} model {target} is not a JSON object")
        })?;
        object.insert("use_responses_lite".to_string(), Value::Bool(false));
    }

    let mut encoded = serde_json::to_vec_pretty(&root).map_err(|error| {
        format!("{MANAGED_MODEL_CATALOG_ERROR_PREFIX} failed to encode bundled catalog: {error}")
    })?;
    encoded.push(b'\n');
    if encoded.len() > MAX_MODEL_CATALOG_BYTES {
        return Err(format!(
            "{MANAGED_MODEL_CATALOG_ERROR_PREFIX} patched catalog exceeded {MAX_MODEL_CATALOG_BYTES} bytes"
        ));
    }
    Ok(encoded)
}

fn write_private_file_atomically_if_changed(path: &Path, content: &[u8]) -> Result<(), String> {
    if fs::read(path).is_ok_and(|current| current == content) {
        return Ok(());
    }
    reject_unsafe_catalog_target(path)?;
    let parent = path.parent().ok_or_else(|| {
        format!("{MANAGED_MODEL_CATALOG_ERROR_PREFIX} catalog target has no parent")
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        format!("{MANAGED_MODEL_CATALOG_ERROR_PREFIX} failed to create catalog directory: {error}")
    })?;
    let temporary = parent.join(format!(
        ".doge-codex-model-catalog-{}.tmp",
        uuid::Uuid::new_v4()
    ));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut staged = options.open(&temporary).map_err(|error| {
        format!("{MANAGED_MODEL_CATALOG_ERROR_PREFIX} failed to stage catalog: {error}")
    })?;
    if let Err(error) = staged.write_all(content).and_then(|_| staged.sync_all()) {
        drop(staged);
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "{MANAGED_MODEL_CATALOG_ERROR_PREFIX} failed to persist staged catalog: {error}"
        ));
    }
    drop(staged);
    if let Err(error) = commit_staged_catalog(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "{MANAGED_MODEL_CATALOG_ERROR_PREFIX} failed to publish catalog: {error}"
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| {
            format!("{MANAGED_MODEL_CATALOG_ERROR_PREFIX} failed to protect catalog: {error}")
        })?;
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| {
                format!(
                    "{MANAGED_MODEL_CATALOG_ERROR_PREFIX} failed to sync catalog directory: {error}"
                )
            })?;
    }
    Ok(())
}

fn reject_unsafe_catalog_target(path: &Path) -> Result<(), String> {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!(
                "{MANAGED_MODEL_CATALOG_ERROR_PREFIX} catalog target is not a regular file"
            ));
        }
    }
    if let Some(parent) = path.parent() {
        if let Ok(metadata) = fs::symlink_metadata(parent) {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(format!(
                    "{MANAGED_MODEL_CATALOG_ERROR_PREFIX} catalog parent is unsafe"
                ));
            }
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn commit_staged_catalog(temporary: &Path, path: &Path) -> Result<(), String> {
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

#[cfg(windows)]
fn commit_staged_catalog(temporary: &Path, path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let target = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }
    Ok(())
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    unsafe {
        command.pre_exec(|| {
            if libc::setpgid(0, 0) == 0 {
                Ok(())
            } else {
                Err(std::io::Error::last_os_error())
            }
        });
    }
}

#[cfg(not(unix))]
fn configure_process_group(_command: &mut Command) {}

async fn terminate_process_owner(process_id: Option<u32>, child: &mut tokio::process::Child) {
    #[cfg(unix)]
    if let Some(process_id) = process_id {
        unsafe {
            libc::kill(-(process_id as i32), libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    if let Some(process_id) = process_id {
        let _ = crate::utils::async_command("taskkill")
            .args(["/PID", &process_id.to_string(), "/T", "/F"])
            .status()
            .await;
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_catalog() -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "models": [
                {"slug":"gpt-5.6-sol","use_responses_lite":true,"unknown":{"keep":1}},
                {"slug":"gpt-5.6-terra","use_responses_lite":true},
                {"slug":"gpt-5.6-luna","use_responses_lite":false},
                {"slug":"gpt-5.5","use_responses_lite":true}
            ],
            "unknown_top": {"keep": true}
        }))
        .expect("catalog fixture")
    }

    #[test]
    fn patches_only_required_models_and_preserves_unknown_fields() {
        let patched = patch_managed_model_catalog(&valid_catalog()).expect("patch catalog");
        let value: Value = serde_json::from_slice(&patched).expect("parse patched catalog");
        for slug in TARGET_NON_LITE_MODELS {
            let model = value["models"]
                .as_array()
                .expect("models")
                .iter()
                .find(|model| model["slug"] == slug)
                .expect("target model");
            assert_eq!(model["use_responses_lite"], false);
        }
        assert_eq!(value["models"][0]["unknown"]["keep"], 1);
        assert_eq!(value["models"][3]["use_responses_lite"], true);
        assert_eq!(value["unknown_top"]["keep"], true);
    }

    #[test]
    fn rejects_missing_duplicate_and_malformed_catalogs() {
        let missing = serde_json::json!({"models":[
            {"slug":"gpt-5.6-sol"},
            {"slug":"gpt-5.6-terra"}
        ]});
        assert!(patch_managed_model_catalog(missing.to_string().as_bytes())
            .expect_err("missing model")
            .contains("gpt-5.6-luna"));

        let duplicate = serde_json::json!({"models":[
            {"slug":"gpt-5.6-sol"},
            {"slug":"gpt-5.6-sol"},
            {"slug":"gpt-5.6-terra"},
            {"slug":"gpt-5.6-luna"}
        ]});
        assert!(
            patch_managed_model_catalog(duplicate.to_string().as_bytes())
                .expect_err("duplicate model")
                .contains("duplicate")
        );
        assert!(patch_managed_model_catalog(b"not-json")
            .expect_err("invalid json")
            .contains("valid JSON"));
        assert!(patch_managed_model_catalog(br#"{"models":{}}"#)
            .expect_err("invalid models")
            .contains("models array"));
    }

    #[test]
    fn builds_one_shell_safe_model_catalog_override() {
        let path = Path::new("/tmp/Doge Provider/models catalog.json");
        let encoded = managed_model_catalog_codex_args(path);
        let parsed = crate::codex::args::parse_codex_args(Some(&encoded)).expect("parse args");
        assert_eq!(parsed[0], "-c");
        assert_eq!(
            parsed[1],
            "model_catalog_json=\"/tmp/Doge Provider/models catalog.json\""
        );
    }

    #[test]
    fn atomic_catalog_write_is_idempotent_and_owner_only() {
        let root = std::env::temp_dir().join(format!(
            "doge-managed-model-catalog-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp root");
        let path = root.join(MANAGED_MODEL_CATALOG_FILE_NAME);
        write_private_file_atomically_if_changed(&path, b"first\n").expect("first write");
        write_private_file_atomically_if_changed(&path, b"first\n").expect("same write");
        write_private_file_atomically_if_changed(&path, b"second\n").expect("replace write");
        assert_eq!(fs::read(&path).expect("read catalog"), b"second\n");
        assert_eq!(
            fs::read_dir(&root).expect("read temp root").count(),
            1,
            "staged files must not leak"
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path)
                    .expect("catalog metadata")
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn bounded_capture_handles_success_nonzero_timeout_and_oversize() {
        let mut success = Command::new("/bin/sh");
        success.arg("-c").arg("printf '{\"models\":[]}'");
        let output = capture_bounded_command(success, Duration::from_secs(1), 128, 128)
            .await
            .expect("capture success");
        assert_eq!(output, br#"{"models":[]}"#);

        let mut nonzero = Command::new("/bin/sh");
        nonzero
            .arg("-c")
            .arg("printf 'fixture failure' >&2; exit 7");
        assert!(
            capture_bounded_command(nonzero, Duration::from_secs(1), 128, 128,)
                .await
                .expect_err("nonzero")
                .contains("fixture failure")
        );

        let mut slow = Command::new("/bin/sh");
        slow.arg("-c").arg("sleep 2");
        assert!(
            capture_bounded_command(slow, Duration::from_millis(20), 128, 128,)
                .await
                .expect_err("timeout")
                .contains("timed out")
        );

        let mut oversized = Command::new("/bin/sh");
        oversized.arg("-c").arg("printf '%128s' x");
        assert!(
            capture_bounded_command(oversized, Duration::from_secs(1), 32, 128,)
                .await
                .expect_err("oversized")
                .contains("exceeded 32 bytes")
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn materializes_catalog_through_the_exact_binary_contract() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "doge-managed-model-catalog-binary-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create temp root");
        let exporter = root.join("codex-fixture");
        let fixture = String::from_utf8(valid_catalog()).expect("utf8 fixture");
        fs::write(
            &exporter,
            format!(
                "#!/bin/sh\nprintf '%s' '{}'\n",
                fixture.replace('\'', "'\\''")
            ),
        )
        .expect("write exporter");
        fs::set_permissions(&exporter, fs::Permissions::from_mode(0o700))
            .expect("protect exporter");

        let catalog = materialize_managed_codex_model_catalog(exporter.to_str(), &root)
            .await
            .expect("materialize exact binary catalog");
        assert_eq!(catalog, root.join(MANAGED_MODEL_CATALOG_FILE_NAME));
        let value: Value = serde_json::from_slice(&fs::read(catalog).expect("read catalog"))
            .expect("parse catalog");
        for slug in TARGET_NON_LITE_MODELS {
            let model = value["models"]
                .as_array()
                .expect("models")
                .iter()
                .find(|model| model["slug"] == slug)
                .expect("target model");
            assert_eq!(model["use_responses_lite"], false);
        }

        let _ = fs::remove_dir_all(root);
    }
}
