fn build_shared_catalog_entry(
    summary: crate::shared_sessions::SharedSessionSummary,
    owner_workspace: &WorkspaceEntry,
    owner_metadata: &WorkspaceSessionCatalogMetadata,
    metadata_by_workspace_id: &HashMap<String, WorkspaceSessionCatalogMetadata>,
) -> WorkspaceSessionCatalogEntry {
    let session_id = summary.thread_id;
    let archived_at =
        archived_at_for_session(owner_metadata, &owner_workspace.id, &session_id);
    let entry = WorkspaceSessionCatalogEntry {
        session_id,
        stable_session_key: None,
        canonical_session_id: Some(summary.id),
        parent_session_id: None,
        workspace_id: owner_workspace.id.clone(),
        workspace_label: Some(owner_workspace.name.clone()),
        engine: "shared".to_string(),
        title: summary.title,
        native_title: None,
        updated_at: summary.updated_at as i64,
        archived_at,
        thread_kind: "shared".to_string(),
        source: Some(summary.selected_engine.icon().to_string()),
        source_label: Some(summary.selected_engine_label),
        provider_profile_id: None,
        provider_profile_source: None,
        provider_profile_name: None,
        provider_availability: None,
        source_completeness: Some(WorkspaceSessionSourceCompleteness::Complete),
        source_status_reason: None,
        size_bytes: None,
        cwd: Some(owner_workspace.path.clone()),
        attribution_status: Some(
            SessionCatalogAttributionStatus::StrictMatch
                .as_str()
                .to_string(),
        ),
        attribution_reason: None,
        attribution_confidence: None,
        matched_workspace_id: Some(owner_workspace.id.clone()),
        matched_workspace_label: Some(owner_workspace.name.clone()),
        folder_id: None,
        auto_session: None,
        exists_on_disk: false,
        inconsistency_code: None,
        delete_mode: None,
        physical_path: None,
        children_count: None,
        continuation: ProviderContinuationProjection::default(),
    };
    finalize_existing_catalog_entry(entry, metadata_by_workspace_id)
}

fn build_claude_catalog_entry_from_fact(
    fact: engine::claude_history::ClaudeSessionSourceFact,
    owner_workspace: &WorkspaceEntry,
    owner_metadata: &WorkspaceSessionCatalogMetadata,
) -> WorkspaceSessionCatalogEntry {
    let session_id = format!("claude:{}", fact.canonical_session_id);
    WorkspaceSessionCatalogEntry {
        archived_at: archived_at_for_session(owner_metadata, &owner_workspace.id, &session_id),
        session_id,
        stable_session_key: None,
        canonical_session_id: Some(fact.canonical_session_id),
        parent_session_id: fact
            .parent_session_id
            .as_ref()
            .map(|parent_session_id| format!("claude:{parent_session_id}")),
        workspace_id: owner_workspace.id.clone(),
        workspace_label: Some(owner_workspace.name.clone()),
        engine: "claude".to_string(),
        title: fact
            .native_title
            .clone()
            .or_else(|| fact.first_real_user_message.clone())
            .unwrap_or_else(|| "Claude Session".to_string()),
        native_title: fact.native_title,
        updated_at: fact.updated_at.max(0),
        thread_kind: "native".to_string(),
        source: None,
        source_label: None,
        provider_profile_id: None,
        provider_profile_source: None,
        provider_profile_name: None,
        provider_availability: None,
        source_completeness: Some(if fact.source_health.eq_ignore_ascii_case("partial") {
            WorkspaceSessionSourceCompleteness::Partial
        } else {
            WorkspaceSessionSourceCompleteness::Complete
        }),
        source_status_reason: if fact.source_health.eq_ignore_ascii_case("partial") {
            Some("claude-source-diagnostics".to_string())
        } else {
            None
        },
        size_bytes: fact.file_size_bytes,
        cwd: fact.cwd,
        attribution_status: fact.attribution_status,
        attribution_reason: fact.attribution_reason,
        attribution_confidence: None,
        matched_workspace_id: Some(owner_workspace.id.clone()),
        matched_workspace_label: Some(owner_workspace.name.clone()),
        folder_id: None,
        auto_session: None,
        exists_on_disk: false,
        inconsistency_code: None,
        delete_mode: None,
        physical_path: Some(fact.physical_path),
        children_count: None,
        continuation: ProviderContinuationProjection::default(),
    }
}

fn expand_hidden_session_id_aliases(session_id: &str) -> Vec<String> {
    let trimmed = session_id.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let mut keys = vec![trimmed.to_string()];
    let parts = trimmed.split(':').collect::<Vec<_>>();
    if let Some(last) = parts.last().copied().filter(|value| !value.is_empty()) {
        keys.push(last.to_string());
    }
    if parts.len() == 2 {
        if let Some(raw) = parts.get(1).copied().filter(|value| !value.is_empty()) {
            keys.push(raw.to_string());
        }
    } else if parts.len() >= 3 {
        let engine = parts[0];
        let raw = parts[parts.len() - 1];
        if !engine.is_empty() && !raw.is_empty() {
            keys.push(format!("{engine}:{raw}"));
        }
    }
    keys.sort();
    keys.dedup();
    keys
}

fn collect_hidden_automatic_session_ids_from_metadata(
    metadata_by_workspace_id: &HashMap<String, WorkspaceSessionCatalogMetadata>,
) -> Vec<String> {
    let mut ids = HashSet::new();
    for metadata in metadata_by_workspace_id.values() {
        for (session_id, auto_session) in &metadata.auto_session_by_session_id {
            if auto_session.visibility != AutoSessionVisibility::Hidden {
                continue;
            }
            for alias in expand_hidden_session_id_aliases(session_id) {
                ids.insert(alias);
            }
        }
    }
    let mut out = ids.into_iter().collect::<Vec<_>>();
    out.sort();
    out
}

fn collect_hidden_automatic_session_ids_from_entries(
    entries: &[WorkspaceSessionCatalogEntry],
) -> Vec<String> {
    let mut ids = HashSet::new();
    for entry in entries {
        if !entry_is_hidden_automatic_session(entry) {
            continue;
        }
        for alias in expand_hidden_session_id_aliases(&entry.session_id) {
            ids.insert(alias);
        }
        if let Some(stable_key) = entry.stable_session_key.as_deref() {
            for alias in expand_hidden_session_id_aliases(stable_key) {
                ids.insert(alias);
            }
        }
    }
    let mut out = ids.into_iter().collect::<Vec<_>>();
    out.sort();
    out
}

fn merge_hidden_automatic_session_ids(
    left: impl IntoIterator<Item = String>,
    right: impl IntoIterator<Item = String>,
) -> Vec<String> {
    let mut ids = HashSet::new();
    ids.extend(left);
    ids.extend(right);
    let mut out = ids.into_iter().collect::<Vec<_>>();
    out.sort();
    out
}

fn build_catalog_page(
    entries: Vec<WorkspaceSessionCatalogEntry>,
    query: WorkspaceSessionCatalogQuery,
    cursor: Option<String>,
    limit: Option<u32>,
    partial_source: Option<String>,
    source_statuses: Vec<WorkspaceSessionCatalogSourceStatus>,
    extra_hidden_automatic_session_ids: Vec<String>,
) -> WorkspaceSessionCatalogPage {
    let source_statuses = normalize_source_statuses(source_statuses);
    let cursor_state = parse_catalog_cursor_state(cursor.as_deref());
    let status_filter = parse_status_filter(query.status.as_deref());
    let keyword = query
        .keyword
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_lowercase());
    let engine_filter = query
        .engine
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_lowercase());
    let folder_filter = normalize_query_folder_filter(&query);

    let hidden_automatic_session_ids = merge_hidden_automatic_session_ids(
        extra_hidden_automatic_session_ids,
        collect_hidden_automatic_session_ids_from_entries(&entries),
    );

    let filtered: Vec<WorkspaceSessionCatalogEntry> = entries
        .into_iter()
        .filter(|entry| !entry_is_hidden_automatic_session(entry))
        .filter(|entry| {
            entry_matches_engine_and_keyword(entry, engine_filter.as_deref(), keyword.as_deref())
                && entry_matches_status(entry, status_filter)
        })
        .collect();
    let mut filtered = filter_catalog_entries_by_folder(filtered, folder_filter.as_deref());

    filtered.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| left.session_id.cmp(&right.session_id))
            .then_with(|| left.workspace_id.cmp(&right.workspace_id))
            .then_with(|| catalog_entry_sort_key(left).cmp(&catalog_entry_sort_key(right)))
    });

    let requested_limit = limit.map(|value| value as usize);
    let limit_capped = matches!(limit, Some(value) if value > SESSION_CATALOG_MAX_LIMIT as u32);
    let effective_limit = normalize_catalog_page_limit(limit);
    let offset = catalog_page_start_index(&filtered, &query, cursor_state);
    let data: Vec<WorkspaceSessionCatalogEntry> = filtered
        .iter()
        .skip(offset)
        .take(effective_limit)
        .cloned()
        .map(|entry| decorate_catalog_entry_for_response(entry, &source_statuses))
        .collect();
    let next_cursor = if offset + data.len() < filtered.len() {
        data.last()
            .map(|entry| build_catalog_stable_cursor(entry, &query, offset + data.len()))
    } else {
        None
    };

    WorkspaceSessionCatalogPage {
        data,
        next_cursor,
        requested_limit,
        effective_limit,
        limit_capped,
        partial_source,
        source_statuses,
        hidden_automatic_session_ids,
    }
}

fn dedupe_catalog_entries_and_apply_children_counts(
    entries: Vec<WorkspaceSessionCatalogEntry>,
) -> Vec<WorkspaceSessionCatalogEntry> {
    let mut deduped = Vec::new();
    let mut seen_ids = HashSet::new();
    for entry in entries {
        if !seen_ids.insert(build_catalog_entry_dedupe_key(&entry)) {
            continue;
        }
        deduped.push(entry);
    }
    apply_children_counts(&mut deduped);
    deduped
}

fn catalog_entry_sort_key(entry: &WorkspaceSessionCatalogEntry) -> String {
    entry
        .stable_session_key
        .clone()
        .unwrap_or_else(|| build_catalog_entry_stable_key(entry))
}

fn catalog_entry_is_after_stable_cursor(
    entry: &WorkspaceSessionCatalogEntry,
    cursor: &SessionCatalogStableCursor,
) -> bool {
    if entry.updated_at != cursor.updated_at {
        return entry.updated_at < cursor.updated_at;
    }
    if entry.session_id.as_str() != cursor.session_id.as_str() {
        return entry.session_id.as_str() > cursor.session_id.as_str();
    }
    if entry.workspace_id.as_str() != cursor.workspace_id.as_str() {
        return entry.workspace_id.as_str() > cursor.workspace_id.as_str();
    }
    let entry_stable_key = catalog_entry_sort_key(entry);
    let cursor_stable_key = cursor.stable_session_key.as_deref().unwrap_or("");
    entry_stable_key.as_str() > cursor_stable_key
}

fn catalog_page_start_index(
    filtered: &[WorkspaceSessionCatalogEntry],
    query: &WorkspaceSessionCatalogQuery,
    cursor: SessionCatalogCursor,
) -> usize {
    match cursor {
        SessionCatalogCursor::LegacyOffset(offset) => offset.min(filtered.len()),
        SessionCatalogCursor::Stable(payload) => {
            if payload.query_fingerprint != catalog_query_fingerprint(query) {
                return 0;
            }
            filtered
                .iter()
                .position(|entry| catalog_entry_is_after_stable_cursor(entry, &payload))
                .unwrap_or(filtered.len())
        }
    }
}

async fn build_workspace_scope_catalog_data(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    engine_manager: &engine::EngineManager,
    storage_path: &Path,
    workspace_id: &str,
    scan_mode: SessionCatalogScanMode,
    attribution_mode: WorkspaceSessionAttributionMode,
) -> Result<WorkspaceScopeCatalogData, String> {
    let workspace_scope = catalog_workspace_scope(workspaces, workspace_id).await?;
    let workspaces_snapshot = workspaces.lock().await.clone();
    let metadata_by_workspace_id = read_catalog_metadata_for_scope(storage_path, &workspace_scope)?;
    let mut partial_sources = Vec::new();
    let mut source_statuses = Vec::new();
    let mut entries = Vec::new();
    let scope_kind = workspace_scope
        .first()
        .map(|workspace| {
            if workspace.kind.is_worktree() {
                WorkspaceSessionProjectionScopeKind::Worktree
            } else {
                WorkspaceSessionProjectionScopeKind::Project
            }
        })
        .unwrap_or(WorkspaceSessionProjectionScopeKind::Project);
    let owner_workspace_ids = workspace_scope
        .iter()
        .map(|workspace| workspace.id.clone())
        .collect::<Vec<_>>();

    let gemini_config = engine_manager
        .get_engine_config(engine::EngineType::Gemini)
        .await;
    let kimi_config = engine_manager
        .get_engine_config(engine::EngineType::Kimi)
        .await;
    let grok_config = engine_manager
        .get_engine_config(engine::EngineType::Grok)
        .await;
    let claude_config = engine_manager
        .get_engine_config(engine::EngineType::Claude)
        .await;
    let claude_source_fact_cache_dir = source_fact_cache_dir(storage_path, "claude").ok();
    for workspace in &workspace_scope {
        let owner_workspace_id = workspace.id.clone();
        let owner_workspace_path = PathBuf::from(&workspace.path);
        let owner_metadata = metadata_by_workspace_id
            .get(&owner_workspace_id)
            .cloned()
            .unwrap_or_default();

        match local_usage::list_codex_session_summary_list_for_workspace(
            workspaces,
            &owner_workspace_id,
            scan_mode.limit(),
        )
        .await
        {
            Ok(summary_list) => {
                let has_provider_home_diagnostics =
                    !summary_list.provider_home_diagnostics.is_empty();
                let disk_session_count = summary_list
                    .sessions
                    .iter()
                    .filter(|summary| summary.provider_profile_id.is_none())
                    .count();
                let provider_home_session_count =
                    summary_list.sessions.len().saturating_sub(disk_session_count);
                let mut disk_status = build_success_source_status(
                    "codex",
                    disk_session_count,
                    scan_mode,
                    WorkspaceSessionSourceCompleteness::AuthoritativeEmpty,
                    None,
                );
                disk_status.source_kind = Some("disk".to_string());
                source_statuses.push(disk_status);

                if has_provider_home_diagnostics {
                    partial_sources.push(SESSION_CATALOG_PARTIAL_CODEX.to_string());
                    let mut status = build_degraded_source_status(
                        "codex",
                        "codex-provider-home-source-degraded",
                    );
                    status.source_kind = Some("provider-home".to_string());
                    status.scanned_candidates = Some(provider_home_session_count);
                    status.diagnostics = summary_list
                        .provider_home_diagnostics
                        .iter()
                        .map(|diagnostic| WorkspaceSessionCatalogDiagnostic {
                            engine: "codex".to_string(),
                            code: "codex-provider-home-source-degraded".to_string(),
                            reason: diagnostic.clone(),
                            session_id: None,
                            physical_locator: None,
                            cwd: None,
                            candidate_count: None,
                        })
                        .collect();
                    source_statuses.push(status);
                } else {
                    let mut provider_home_status = build_success_source_status(
                        "codex",
                        provider_home_session_count,
                        scan_mode,
                        WorkspaceSessionSourceCompleteness::AuthoritativeEmpty,
                        None,
                    );
                    provider_home_status.source_kind = Some("provider-home".to_string());
                    source_statuses.push(provider_home_status);
                }
                entries.extend(
                    summary_list
                        .sessions
                        .into_iter()
                        // guardian 等 background 会话与 list_threads 统一口径：不进 catalog。
                        .filter(|summary| {
                            !crate::local_usage::is_codex_background_helper_session(summary)
                        })
                        .map(|summary| {
                            let session_id = summary.session_id.clone();
                            let archived_at = archived_at_for_session(
                                &owner_metadata,
                                &owner_workspace_id,
                                &session_id,
                            );
                            let source_label = build_source_label(
                                summary.source.as_deref(),
                                summary.provider.as_deref(),
                            );
                            let entry = WorkspaceSessionCatalogEntry {
                                session_id,
                                stable_session_key: None,
                                canonical_session_id: Some(summary.session_id.clone()),
                                parent_session_id: summary.parent_session_id,
                                workspace_id: owner_workspace_id.clone(),
                                workspace_label: Some(workspace.name.clone()),
                                engine: "codex".to_string(),
                                title: summary
                                    .summary
                                    .unwrap_or_else(|| "Codex Session".to_string()),
                                native_title: summary.native_title,
                                updated_at: summary.timestamp.max(0),
                                archived_at,
                                thread_kind: "native".to_string(),
                                source: summary.source,
                                source_label,
                                provider_profile_id: summary.provider_profile_id,
                                provider_profile_source: summary.provider_profile_source,
                                provider_profile_name: summary.provider_profile_name,
                                provider_availability: summary.provider_availability,
                                source_completeness: None,
                                source_status_reason: None,
                                size_bytes: summary.file_size_bytes,
                                cwd: summary.cwd,
                                attribution_status: Some(
                                    SessionCatalogAttributionStatus::StrictMatch
                                        .as_str()
                                        .to_string(),
                                ),
                                attribution_reason: None,
                                attribution_confidence: None,
                                matched_workspace_id: Some(owner_workspace_id.clone()),
                                matched_workspace_label: Some(workspace.name.clone()),
                                folder_id: None,
                                auto_session: None,
                                exists_on_disk: false,
                                inconsistency_code: None,
                                delete_mode: None,
                                physical_path: summary.physical_path,
                                children_count: None,
                                continuation: ProviderContinuationProjection::default(),
                            };
                            finalize_existing_catalog_entry(entry, &metadata_by_workspace_id)
                        }),
                );
            }
            Err(error) => {
                log::warn!(
                    "[session_management.list_workspace_sessions] codex history unavailable for workspace {}: {}",
                    owner_workspace_id,
                    error
                );
                partial_sources.push(SESSION_CATALOG_PARTIAL_CODEX.to_string());
                source_statuses.push(build_degraded_source_status(
                    "codex",
                    SESSION_CATALOG_PARTIAL_CODEX,
                ));
            }
        }

        let claude_source_facts_result = match attribution_mode {
            WorkspaceSessionAttributionMode::Related => {
                engine::claude_history::list_claude_session_source_facts_for_attribution_scopes_with_config(
                    &owner_workspace_path,
                    build_claude_attribution_scopes(workspace),
                    Some(scan_mode.limit()),
                    claude_config.as_ref(),
                    claude_source_fact_cache_dir.as_deref(),
                )
                .await
            }
            WorkspaceSessionAttributionMode::WorkspaceOnly => {
                engine::claude_history::list_workspace_only_claude_session_source_facts_for_attribution_scopes_with_config(
                    &owner_workspace_path,
                    build_claude_attribution_scopes(workspace),
                    Some(scan_mode.limit()),
                    claude_config.as_ref(),
                    claude_source_fact_cache_dir.as_deref(),
                )
                .await
            }
        };

        match claude_source_facts_result {
            Ok(claude_source_facts) => {
                let claude_session_count = claude_source_facts.facts.len();
                if claude_session_count == 0 {
                    partial_sources
                        .push(SESSION_CATALOG_PARTIAL_CLAUDE_UNCERTAIN_EMPTY.to_string());
                }
                let mut unresolved_diagnostics = Vec::new();
                let claude_entries = claude_source_facts
                    .facts
                    .iter()
                    .cloned()
                    .filter_map(|fact| {
                        let mut entry =
                            build_claude_catalog_entry_from_fact(fact, workspace, &owner_metadata);
                        entry = apply_strict_attribution_owner(
                            entry,
                            &workspaces_snapshot,
                            &metadata_by_workspace_id,
                        );
                        if entry.attribution_status.as_deref()
                            == Some(SessionCatalogAttributionStatus::Unassigned.as_str())
                        {
                            unresolved_diagnostics
                                .push(unresolved_catalog_entry_to_diagnostic(&entry));
                            return None;
                        }
                        if !owner_workspace_ids.contains(&entry.workspace_id) {
                            return None;
                        }
                        Some(finalize_existing_catalog_entry(
                            entry,
                            &metadata_by_workspace_id,
                        ))
                    })
                    .collect::<Vec<_>>();
                source_statuses.push(build_claude_source_fact_status(
                    &claude_source_facts,
                    scan_mode,
                    unresolved_diagnostics,
                ));
                entries.extend(claude_entries);
            }
            Err(error) => {
                log::warn!(
                    "[session_management.list_workspace_sessions] claude history unavailable for workspace {}: {}",
                    owner_workspace_id,
                    error
                );
                partial_sources.push(SESSION_CATALOG_PARTIAL_CLAUDE.to_string());
                source_statuses.push(build_degraded_source_status(
                    "claude",
                    SESSION_CATALOG_PARTIAL_CLAUDE,
                ));
            }
        }

        match engine::gemini_history::list_gemini_sessions(
            &owner_workspace_path,
            Some(scan_mode.limit()),
            gemini_config
                .as_ref()
                .and_then(|item| item.home_dir.as_deref()),
        )
        .await
        {
            Ok(gemini_sessions) => {
                source_statuses.push(build_success_source_status(
                    "gemini",
                    gemini_sessions.len(),
                    scan_mode,
                    WorkspaceSessionSourceCompleteness::AuthoritativeEmpty,
                    None,
                ));
                entries.extend(gemini_sessions.into_iter().map(|session| {
                    let session_id = format!("gemini:{}", session.session_id);
                    let entry = WorkspaceSessionCatalogEntry {
                        archived_at: archived_at_for_session(
                            &owner_metadata,
                            &owner_workspace_id,
                            &session_id,
                        ),
                        session_id,
                        stable_session_key: None,
                        canonical_session_id: Some(session.session_id.clone()),
                        parent_session_id: None,
                        workspace_id: owner_workspace_id.clone(),
                        workspace_label: Some(workspace.name.clone()),
                        engine: "gemini".to_string(),
                        title: session.first_message,
                        native_title: None,
                        updated_at: session.updated_at.max(0),
                        thread_kind: "native".to_string(),
                        source: None,
                        source_label: None,
                        provider_profile_id: None,
                        provider_profile_source: None,
                        provider_profile_name: None,
                        provider_availability: None,
                        source_completeness: None,
                        source_status_reason: None,
                        size_bytes: session.file_size_bytes,
                        cwd: None,
                        attribution_status: Some(
                            SessionCatalogAttributionStatus::StrictMatch
                                .as_str()
                                .to_string(),
                        ),
                        attribution_reason: None,
                        attribution_confidence: None,
                        matched_workspace_id: Some(owner_workspace_id.clone()),
                        matched_workspace_label: Some(workspace.name.clone()),
                        folder_id: None,
                        auto_session: None,
                        exists_on_disk: false,
                        inconsistency_code: None,
                        delete_mode: None,
                        physical_path: None,
                        children_count: None,
                        continuation: ProviderContinuationProjection::default(),
                    };
                    finalize_existing_catalog_entry(entry, &metadata_by_workspace_id)
                }));
            }
            Err(error) => {
                log::warn!(
                    "[session_management.list_workspace_sessions] gemini history unavailable for workspace {}: {}",
                    owner_workspace_id,
                    error
                );
                partial_sources.push(SESSION_CATALOG_PARTIAL_GEMINI.to_string());
                source_statuses.push(build_degraded_source_status(
                    "gemini",
                    SESSION_CATALOG_PARTIAL_GEMINI,
                ));
            }
        }

        match engine::kimi_history::list_kimi_sessions(
            &owner_workspace_path,
            Some(scan_mode.limit()),
            kimi_config
                .as_ref()
                .and_then(|item| item.home_dir.as_deref()),
        )
        .await
        {
            Ok(kimi_sessions) => {
                source_statuses.push(build_success_source_status(
                    "kimi",
                    kimi_sessions.len(),
                    scan_mode,
                    WorkspaceSessionSourceCompleteness::AuthoritativeEmpty,
                    None,
                ));
                entries.extend(kimi_sessions.into_iter().map(|session| {
                    let session_id = format!("kimi:{}", session.session_id);
                    let entry = WorkspaceSessionCatalogEntry {
                        archived_at: archived_at_for_session(
                            &owner_metadata,
                            &owner_workspace_id,
                            &session_id,
                        ),
                        session_id,
                        stable_session_key: None,
                        canonical_session_id: Some(session.session_id.clone()),
                        parent_session_id: None,
                        workspace_id: owner_workspace_id.clone(),
                        workspace_label: Some(workspace.name.clone()),
                        engine: "kimi".to_string(),
                        title: session.first_message,
                        native_title: None,
                        updated_at: session.updated_at.max(0),
                        thread_kind: "native".to_string(),
                        source: None,
                        source_label: None,
                        provider_profile_id: session.provider_profile_id.clone(),
                        provider_profile_source: session
                            .provider_profile_id
                            .as_ref()
                            .map(|_| "managed".to_string()),
                        provider_profile_name: None,
                        provider_availability: None,
                        source_completeness: None,
                        source_status_reason: None,
                        size_bytes: session.file_size_bytes,
                        cwd: None,
                        attribution_status: Some(
                            SessionCatalogAttributionStatus::StrictMatch
                                .as_str()
                                .to_string(),
                        ),
                        attribution_reason: None,
                        attribution_confidence: None,
                        matched_workspace_id: Some(owner_workspace_id.clone()),
                        matched_workspace_label: Some(workspace.name.clone()),
                        folder_id: None,
                        auto_session: None,
                        exists_on_disk: false,
                        inconsistency_code: None,
                        delete_mode: None,
                        physical_path: None,
                        children_count: None,
                        continuation: ProviderContinuationProjection::default(),
                    };
                    finalize_existing_catalog_entry(entry, &metadata_by_workspace_id)
                }));
            }
            Err(error) => {
                log::warn!(
                    "[session_management.list_workspace_sessions] kimi history unavailable for workspace {}: {}",
                    owner_workspace_id,
                    error
                );
                partial_sources.push(SESSION_CATALOG_PARTIAL_KIMI.to_string());
                source_statuses.push(build_degraded_source_status(
                    "kimi",
                    SESSION_CATALOG_PARTIAL_KIMI,
                ));
            }
        }

        match engine::grok_history::list_grok_sessions(
            &owner_workspace_path,
            Some(scan_mode.limit()),
            grok_config
                .as_ref()
                .and_then(|item| item.home_dir.as_deref()),
        )
        .await
        {
            Ok(grok_sessions) => {
                source_statuses.push(build_success_source_status(
                    "grok",
                    grok_sessions.len(),
                    scan_mode,
                    WorkspaceSessionSourceCompleteness::AuthoritativeEmpty,
                    None,
                ));
                entries.extend(grok_sessions.into_iter().map(|session| {
                    let session_id = format!("grok:{}", session.session_id);
                    let entry = WorkspaceSessionCatalogEntry {
                        archived_at: archived_at_for_session(
                            &owner_metadata,
                            &owner_workspace_id,
                            &session_id,
                        ),
                        session_id,
                        stable_session_key: None,
                        canonical_session_id: Some(session.session_id.clone()),
                        parent_session_id: None,
                        workspace_id: owner_workspace_id.clone(),
                        workspace_label: Some(workspace.name.clone()),
                        engine: "grok".to_string(),
                        title: session.first_message,
                        native_title: None,
                        updated_at: session.updated_at.max(0),
                        thread_kind: "native".to_string(),
                        source: None,
                        source_label: None,
                        provider_profile_id: None,
                        provider_profile_source: None,
                        provider_profile_name: None,
                        provider_availability: None,
                        source_completeness: None,
                        source_status_reason: None,
                        size_bytes: session.file_size_bytes,
                        cwd: None,
                        attribution_status: Some(
                            SessionCatalogAttributionStatus::StrictMatch
                                .as_str()
                                .to_string(),
                        ),
                        attribution_reason: None,
                        attribution_confidence: None,
                        matched_workspace_id: Some(owner_workspace_id.clone()),
                        matched_workspace_label: Some(workspace.name.clone()),
                        folder_id: None,
                        auto_session: None,
                        exists_on_disk: false,
                        inconsistency_code: None,
                        delete_mode: None,
                        physical_path: None,
                        children_count: None,
                        continuation: ProviderContinuationProjection::default(),
                    };
                    finalize_existing_catalog_entry(entry, &metadata_by_workspace_id)
                }));
            }
            Err(error) => {
                log::warn!(
                    "[session_management.list_workspace_sessions] grok history unavailable for workspace {}: {}",
                    owner_workspace_id,
                    error
                );
                partial_sources.push(SESSION_CATALOG_PARTIAL_GROK.to_string());
                source_statuses.push(build_degraded_source_status(
                    "grok",
                    SESSION_CATALOG_PARTIAL_GROK,
                ));
            }
        }

        match engine::commands::opencode_session_list_core(
            workspaces,
            engine_manager,
            &owner_workspace_id,
        )
        .await
        {
            Ok(opencode_sessions) => {
                source_statuses.push(build_success_source_status(
                    "opencode",
                    opencode_sessions.len(),
                    scan_mode,
                    WorkspaceSessionSourceCompleteness::AuthoritativeEmpty,
                    None,
                ));
                entries.extend(opencode_sessions.into_iter().map(|session| {
                    let session_id = format!("opencode:{}", session.session_id);
                    let entry = WorkspaceSessionCatalogEntry {
                        archived_at: archived_at_for_session(
                            &owner_metadata,
                            &owner_workspace_id,
                            &session_id,
                        ),
                        session_id,
                        stable_session_key: None,
                        canonical_session_id: Some(session.session_id.clone()),
                        parent_session_id: None,
                        workspace_id: owner_workspace_id.clone(),
                        workspace_label: Some(workspace.name.clone()),
                        engine: "opencode".to_string(),
                        title: session.title,
                        native_title: None,
                        updated_at: session.updated_at.unwrap_or(0).max(0),
                        thread_kind: "native".to_string(),
                        source: None,
                        source_label: None,
                        provider_profile_id: None,
                        provider_profile_source: None,
                        provider_profile_name: None,
                        provider_availability: None,
                        source_completeness: None,
                        source_status_reason: None,
                        size_bytes: None,
                        cwd: session.directory.clone(),
                        attribution_status: Some(
                            SessionCatalogAttributionStatus::StrictMatch
                                .as_str()
                                .to_string(),
                        ),
                        attribution_reason: None,
                        attribution_confidence: None,
                        matched_workspace_id: Some(owner_workspace_id.clone()),
                        matched_workspace_label: Some(workspace.name.clone()),
                        folder_id: None,
                        auto_session: None,
                        exists_on_disk: false,
                        inconsistency_code: None,
                        delete_mode: None,
                        physical_path: None,
                        children_count: None,
                        continuation: ProviderContinuationProjection::default(),
                    };
                    finalize_existing_catalog_entry(entry, &metadata_by_workspace_id)
                }));
            }
            Err(error) => {
                if error.contains("OpenCode CLI not found") {
                    source_statuses.push(build_success_source_status(
                        "opencode",
                        0,
                        scan_mode,
                        WorkspaceSessionSourceCompleteness::AuthoritativeEmpty,
                        None,
                    ));
                    // Fall through so shared sessions are still collected for this workspace.
                } else {
                    log::warn!(
                    "[session_management.list_workspace_sessions] opencode history unavailable for workspace {}: {}",
                    owner_workspace_id,
                    error
                );
                    partial_sources.push(SESSION_CATALOG_PARTIAL_OPENCODE.to_string());
                    source_statuses.push(build_degraded_source_status(
                        "opencode",
                        SESSION_CATALOG_PARTIAL_OPENCODE,
                    ));
                }
            }
        }

        match crate::shared_sessions::list_workspace_shared_sessions(&owner_workspace_id, None) {
            Ok(shared_sessions) => {
                let shared_completeness = if shared_sessions.is_empty() {
                    WorkspaceSessionSourceCompleteness::AuthoritativeEmpty
                } else {
                    WorkspaceSessionSourceCompleteness::Complete
                };
                source_statuses.push(build_success_source_status(
                    "shared",
                    shared_sessions.len(),
                    scan_mode,
                    shared_completeness,
                    None,
                ));
                entries.extend(shared_sessions.into_iter().map(|summary| {
                    build_shared_catalog_entry(
                        summary,
                        workspace,
                        &owner_metadata,
                        &metadata_by_workspace_id,
                    )
                }));
            }
            Err(error) => {
                log::warn!(
                    "[session_management.list_workspace_sessions] shared history unavailable for workspace {}: {}",
                    owner_workspace_id,
                    error
                );
                partial_sources.push(SESSION_CATALOG_PARTIAL_SHARED.to_string());
                source_statuses.push(build_degraded_source_status(
                    "shared",
                    SESSION_CATALOG_PARTIAL_SHARED,
                ));
            }
        }
    }

    let source_statuses = normalize_source_statuses(source_statuses);
    push_orphan_entries_for_scope(
        &mut entries,
        &workspace_scope,
        &metadata_by_workspace_id,
        &source_statuses,
    );

    let deduped = dedupe_catalog_entries_and_apply_children_counts(entries);
    let hidden_automatic_session_ids =
        collect_hidden_automatic_session_ids_from_metadata(&metadata_by_workspace_id);

    Ok(WorkspaceScopeCatalogData {
        scope_kind,
        owner_workspace_ids,
        entries: deduped,
        partial_sources: normalize_partial_sources(partial_sources),
        source_statuses,
        hidden_automatic_session_ids,
    })
}
