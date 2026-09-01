use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use super::provider_profile::{
    materialize_codex_provider_profile, resolve_codex_provider_profile,
    resolve_managed_codex_provider_home, CodexProviderProfile,
};
use super::{resolve_default_codex_home, resolve_workspace_codex_home};
use crate::shared::workspace_snapshot::resolve_workspace_and_parent;
use crate::state::AppState;

fn codex_session_roots_for_home(codex_home: &Path) -> [PathBuf; 2] {
    [
        codex_home.join("sessions"),
        codex_home.join("archived_sessions"),
    ]
}

fn collect_codex_jsonl_files(root: &Path, output: &mut Vec<PathBuf>) {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    let mut paths = entries
        .flatten()
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    paths.sort_by(|left, right| left.to_string_lossy().cmp(&right.to_string_lossy()));
    for path in paths {
        if path.is_dir() {
            collect_codex_jsonl_files(&path, output);
            continue;
        }
        if path.extension().and_then(|value| value.to_str()) == Some("jsonl") {
            output.push(path);
        }
    }
}

fn codex_history_file_matches_thread(path: &Path, thread_id: &str) -> bool {
    if path.file_stem().and_then(|value| value.to_str()) == Some(thread_id) {
        return true;
    }

    let Ok(file) = fs::File::open(path) else {
        return false;
    };
    let reader = BufReader::new(file);
    for line in reader.lines().take(64).flatten() {
        if line.len() > 512_000 {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let payload = value.get("payload").unwrap_or(&value);
        let Some(id) = payload
            .get("id")
            .or_else(|| payload.get("threadId"))
            .or_else(|| payload.get("thread_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if id == thread_id {
            return true;
        }
    }
    false
}

fn find_codex_history_file(codex_home: &Path, thread_id: &str) -> Option<PathBuf> {
    let mut files = Vec::new();
    for root in codex_session_roots_for_home(codex_home) {
        collect_codex_jsonl_files(&root, &mut files);
    }
    files
        .into_iter()
        .find(|path| codex_history_file_matches_thread(path, thread_id))
}

async fn resolve_codex_home_for_provider(
    state: &AppState,
    workspace_id: &str,
    provider_profile_id: &str,
) -> Result<PathBuf, String> {
    let profile = resolve_codex_provider_profile(Some(provider_profile_id))?;
    match profile {
        CodexProviderProfile::Disk => {
            let (entry, parent_entry) =
                resolve_workspace_and_parent(&state.workspaces, workspace_id).await?;
            resolve_workspace_codex_home(&entry, parent_entry.as_ref())
                .or_else(resolve_default_codex_home)
                .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())
        }
        managed_profile => materialize_codex_provider_profile(managed_profile)?
            .codex_home
            .ok_or_else(|| "managed Codex provider did not resolve CODEX_HOME".to_string()),
    }
}

pub(super) async fn resolve_codex_provider_history_path(
    state: &AppState,
    workspace_id: &str,
    thread_id: &str,
    provider_profile_id: &str,
) -> Result<PathBuf, String> {
    let home = resolve_codex_home_for_provider(state, workspace_id, provider_profile_id).await?;
    find_codex_history_file(&home, thread_id).ok_or_else(|| {
        format!(
            "[CODEX_HISTORY_NOT_FOUND] workspaceId={workspace_id}; threadId={thread_id}; providerProfileId={provider_profile_id}"
        )
    })
}

pub(super) fn resolve_managed_codex_provider_history_path(
    provider_profile_id: &str,
    thread_id: &str,
) -> Result<PathBuf, String> {
    let home = resolve_managed_codex_provider_home(provider_profile_id)?;
    find_codex_history_file(&home, thread_id).ok_or_else(|| {
        format!(
            "[CODEX_HISTORY_NOT_FOUND] threadId={thread_id}; providerProfileId={provider_profile_id}"
        )
    })
}
