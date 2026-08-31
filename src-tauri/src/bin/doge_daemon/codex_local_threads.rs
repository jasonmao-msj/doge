use super::*;
use std::collections::HashSet;
use tokio::time::timeout;

pub const CODEX_DAEMON_LOCAL_THREAD_LIST_TIMEOUT_MS: u64 = 5_000;
pub const CODEX_DAEMON_LOCAL_THREAD_LIST_PARTIAL_SOURCE: &str = "live-thread-list-unavailable";
pub(super) const CODEX_DAEMON_LOCAL_THREAD_CURSOR_PREFIX: &str = "codex-daemon-local:";

pub(super) fn prefixed_session_id(engine_prefix: &str, session_id: &str) -> String {
    if session_id.starts_with(&format!("{engine_prefix}:")) {
        session_id.to_string()
    } else {
        format!("{engine_prefix}:{session_id}")
    }
}

pub(super) fn parse_codex_daemon_local_thread_cursor(cursor: Option<&str>) -> usize {
    let Some(cursor) = cursor.map(str::trim).filter(|value| !value.is_empty()) else {
        return 0;
    };
    cursor
        .strip_prefix(CODEX_DAEMON_LOCAL_THREAD_CURSOR_PREFIX)
        .unwrap_or(cursor)
        .parse::<usize>()
        .unwrap_or(0)
}

pub(super) fn build_codex_daemon_local_thread_cursor(offset: usize) -> Value {
    Value::String(format!("{CODEX_DAEMON_LOCAL_THREAD_CURSOR_PREFIX}{offset}"))
}

pub(super) fn normalize_optional_thread_source(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

pub(super) fn build_codex_daemon_thread_source_label(
    source: Option<&str>,
    provider: Option<&str>,
) -> Option<String> {
    let source = normalize_optional_thread_source(source);
    let provider = normalize_optional_thread_source(provider);
    match (source, provider) {
        (Some(source), Some(provider)) => Some(format!("{source}/{provider}")),
        (Some(source), None) => Some(source),
        (None, Some(provider)) => Some(provider),
        (None, None) => None,
    }
}

pub(super) fn build_codex_daemon_local_thread_entry(
    workspace_path: &str,
    session: &crate::types::LocalUsageSessionSummary,
) -> Value {
    let preview = session
        .summary
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("Codex session ({})", session.model));
    let source_label = build_codex_daemon_thread_source_label(
        session.source.as_deref(),
        session.provider.as_deref(),
    );
    json!({
        "id": &session.session_id,
        "engine": "codex",
        "canonicalSessionId": &session.session_id,
        "parentSessionId": &session.parent_session_id,
        "attributionStatus": "strict-match",
        "preview": preview,
        "title": preview,
        "nativeTitle": &session.native_title,
        "cwd": session.cwd.as_deref().unwrap_or(workspace_path),
        "createdAt": session.timestamp,
        "updatedAt": session.timestamp,
        "model": &session.model,
        "source": &session.source,
        "provider": &session.provider,
        "sourceLabel": source_label,
        "partialSource": CODEX_DAEMON_LOCAL_THREAD_LIST_PARTIAL_SOURCE,
    })
}

pub(super) fn apply_codex_daemon_thread_folder_assignments(
    entries: &mut [Value],
    folder_id_by_session_id: &HashMap<String, String>,
) {
    if folder_id_by_session_id.is_empty() {
        return;
    }
    for entry in entries {
        let Some(entry_map) = entry.as_object_mut() else {
            continue;
        };
        let Some(session_id) = entry_map
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        if let Some(folder_id) = folder_id_by_session_id.get(session_id) {
            entry_map.insert("folderId".to_string(), Value::String(folder_id.clone()));
        }
    }
}

/// Remote 模式 live thread/list 透传前的 background 过滤：
/// 用有界 local preview scan 的结构化分类构造 id 集合，文本前缀作 legacy 兜底；
/// scan 失败时降级为仅文本过滤，不阻塞列表返回。
pub(super) async fn filter_codex_daemon_background_thread_entries(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    mut response: Value,
    requested_scan_limit: usize,
) -> Value {
    let background_ids: HashSet<String> = match timeout(
        Duration::from_millis(CODEX_DAEMON_LOCAL_THREAD_LIST_TIMEOUT_MS),
        local_usage::list_codex_session_previews_for_workspace(
            workspaces,
            workspace_id,
            requested_scan_limit,
        ),
    )
    .await
    {
        Ok(Ok((_, sessions))) => sessions
            .iter()
            .filter(|session| local_usage::is_codex_background_helper_session(session))
            .flat_map(local_usage::codex_session_identifier_candidates)
            .collect(),
        Ok(Err(error)) => {
            log::debug!(
                "[daemon:list_threads] background id scan unavailable for {}: {}",
                workspace_id,
                error
            );
            HashSet::new()
        }
        Err(_) => {
            log::debug!(
                "[daemon:list_threads] background id scan timed out for {} after {}ms",
                workspace_id,
                CODEX_DAEMON_LOCAL_THREAD_LIST_TIMEOUT_MS
            );
            HashSet::new()
        }
    };
    let Some(data) = response
        .pointer_mut("/result/data")
        .and_then(Value::as_array_mut)
    else {
        return response;
    };
    data.retain(|entry| {
        let id = entry
            .get("id")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("");
        if !id.is_empty() && background_ids.contains(id) {
            return false;
        }
        !local_usage::is_codex_background_helper_thread_entry(entry)
    });
    response
}
pub(super) fn build_codex_daemon_local_thread_response(
    workspace_path: &str,
    sessions: Vec<crate::types::LocalUsageSessionSummary>,
    cursor: Option<&str>,
    limit: Option<u32>,
    folder_id_by_session_id: &HashMap<String, String>,
) -> Value {
    let requested_limit = limit.unwrap_or(50).clamp(1, 200) as usize;
    let offset = parse_codex_daemon_local_thread_cursor(cursor);
    let entries: Vec<Value> = sessions
        .iter()
        // guardian 等 background 会话与桌面端 list_threads 统一口径：不进 daemon 本地列表。
        .filter(|session| !local_usage::is_codex_background_helper_session(session))
        .map(|session| build_codex_daemon_local_thread_entry(workspace_path, session))
        .collect();
    let mut data: Vec<Value> = entries
        .iter()
        .skip(offset)
        .take(requested_limit)
        .cloned()
        .collect();
    apply_codex_daemon_thread_folder_assignments(&mut data, folder_id_by_session_id);
    let next_cursor = if offset + data.len() < entries.len() {
        build_codex_daemon_local_thread_cursor(offset + data.len())
    } else {
        Value::Null
    };
    json!({
        "result": {
            "data": data,
            "nextCursor": next_cursor,
            "partialSource": CODEX_DAEMON_LOCAL_THREAD_LIST_PARTIAL_SOURCE,
        }
    })
}

pub(super) fn build_codex_daemon_empty_thread_response(partial_source: &str) -> Value {
    json!({
        "result": {
            "data": [],
            "nextCursor": null,
            "partialSource": partial_source,
        }
    })
}
