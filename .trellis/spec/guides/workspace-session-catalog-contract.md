# Workspace Session Catalog Contract

本规范固化工作区会话列表的跨层 contract，适用于 `src-tauri/src/session_management.rs`、`src-tauri/src/engine/claude_history.rs`、`src/services/tauri/sessionManagement.ts`、`src/features/threads/hooks/useThreadActions*`、`src/features/settings/components/settings-view/**`、`src/features/workspaces/components/WorkspaceHome.tsx`。

## Scenario: Catalog Projection Is Membership Truth

### 1. Scope / Trigger

- Trigger：修改 workspace session listing、Claude/Codex/Gemini/OpenCode history scanner、Sidebar session merge、Session Management、Workspace Home session display、archive/folder/delete mutation。
- 目标：避免 Claude Code 会话因为 native scanner empty、exact `workspaceId` 二次过滤、或 project aggregate owner 漂移而从右侧工作区被吞。

### 2. Signatures

- `list_workspace_sessions_core(...) -> WorkspaceSessionCatalogPage`
- `build_workspace_scope_catalog_data(...) -> WorkspaceScopeCatalogData`
- `list_claude_session_source_facts_for_attribution_scopes_with_config(...) -> ClaudeSessionSourceFactList`
- `resolve_catalog_entry_attribution(...) -> SessionCatalogAttribution`
- `archive_workspace_sessions_core(...) -> WorkspaceSessionBatchMutationResponse`
- `unarchive_workspace_sessions_core(...) -> WorkspaceSessionBatchMutationResponse`
- `delete_workspace_sessions_core(...) -> WorkspaceSessionBatchMutationResponse`
- `assign_workspace_session_folders_core(...) -> WorkspaceSessionBatchMutationResponse`
- `useThreadActionsSessionCatalog(...).loadActiveProjectCatalogSessions`
- `resolveWorkspaceProjectionOwnerIds(workspaces, activeWorkspaceId) -> string[]`
- `buildWorkspaceSessionSelectionKey(entry)`
- `parse_codex_session_summary(...) -> Option<LocalUsageSessionSummary>`
- `scan_codex_session_summaries(...) -> Vec<LocalUsageSessionSummary>`
- `list_codex_session_previews_for_workspace(workspaces, workspaceId, limit) -> (workspacePath, Vec<LocalUsageSessionSummary>)`
- `scan_codex_session_summaries_bounded_with_mode(..., uniqueSessionLimit, CodexSessionParseMode)`
- `CodexSessionParseMode::{Full, ThreadPreview}`
- `CODEX_THREAD_PREVIEW_MAX_BYTES = 256 * 1024`
- `merge_duplicate_codex_session_summary(existing, candidate)`
- `merge_unified_codex_thread_entries(...) -> Vec<Value>`
- `dedupe_catalog_entries_and_apply_children_counts(...) -> Vec<WorkspaceSessionCatalogEntry>`
- `LocalUsageSessionSummary.parentSessionId?: string`
- `LocalUsageSessionSummary.nativeTitle?: string`
- `ClaudeSessionSourceFact.nativeTitle?: string`
- `WorkspaceSessionCatalogEntry.nativeTitle?: string`
- `selectProjectedSessionDisplayName({ customTitle?, mappedTitle?, nativeTitle?, nextName, previous? })`
- `resolveThreadSourceMeta(rawThread).parentThreadId?: string`
- `list_shared_sessions(workspaceId) -> SharedSessionSummary.nativeThreadIds`
- `SharedEventWriter.binding_states_for_session(sharedSessionId)`

### 3. Contracts

- Backend catalog active strict projection MUST be the default membership truth for Sidebar and Session Management.
- AppShell workspace navigation 若只需要 owner topology，MUST 通过 `resolveWorkspaceProjectionOwnerIds` 从已加载 workspace registry 推导：main = self + direct `parentId` children（path/name/id stable order），worktree = self，registry pending = active id fallback。MUST NOT 为 topology 调用 `get_workspace_session_projection_summary` 或等价 exhaustive inventory；session membership 仍由 bounded catalog projection 决定。
- Session Management may use a larger first-page catalog window than Sidebar. Current Settings catalog hook uses page size `9999` and does not expose user-visible pagination; Sidebar keeps its own startup/load-older catalog page size to avoid broadening startup pressure.
- Workspace Home MUST NOT derive an independent session membership set from `recentThreads`; if it later displays sessions, it MUST consume the same catalog projection or document an explicit display-window difference.
- Native engine list APIs such as `listClaudeSessions` MAY provide transcript restore, diagnostics, or continuity seed, but MUST NOT widen or shrink complete catalog membership.
- Shared Hidden Native Binding MUST be excluded from ordinary Native catalog projection. The
  exclusion identity MUST come from the union of legacy Shared metadata and canonical V2
  `shared_binding_state.native_session_id`; frontend dispatch memory alone is not durable evidence.
- `list_shared_sessions` MUST expose every non-empty V2 Hidden Binding native identity through
  `SharedSessionSummary.nativeThreadIds`, sorted and deduplicated. V0 `bindings_by_engine` is
  compatibility input only and MUST NOT be the sole authority after V2 activation.
- Frontend MUST NOT reapply exact `entry.workspaceId === selectedWorkspaceId` membership filtering on active strict projection rows. Project aggregate rows may have child/worktree `workspaceId`, and that owner must survive to UI state.
- `WorkspaceSessionSourceCompleteness` MUST preserve per-engine source status. `partial` / `degraded` / `uncertain_empty` cannot prove deletion; `authoritative_empty` only applies to the matching engine and requested scope.
- Metadata overlay is organization state only. `archive`, `folder`, and custom title metadata MUST NOT prove disk existence.
- Runtime 原生 rename MUST 通过 additive optional `nativeTitle` 保留 title source。frontend display precedence MUST 为 GUI `customTitle` → persisted `mappedTitle` → runtime `nativeTitle` → previous-vs-fallback strength heuristic；合法 native title 即使匹配 `Agent N`、generic session name 或 4–8 位 hex，也 MUST NOT 被 weak-title heuristic 丢弃。旧 backend 缺少 `nativeTitle` 时 MUST 保持现有 fallback 行为。
- Codex catalog source discovery MUST include managed provider homes under `codex-provider-homes/*/{sessions,archived_sessions}` in addition to disk/default and workspace Codex homes. Provider-home rows still MUST prove workspace ownership through source evidence such as `cwd`; provider id alone MUST NOT prove membership.
- Codex provider binding metadata MAY overlay `providerProfileId/source/name/availability` on an already discovered row. Metadata alone MUST NOT create an active strict catalog row. If a session is discovered from a provider home whose provider profile is no longer configured, the row MUST remain visible as managed provider history with `providerAvailability=unavailable`; it MUST NOT be rewritten to disk.
- Codex source completeness MUST distinguish disk/default/workspace roots from managed provider-home roots via `WorkspaceSessionCatalogSourceStatus.sourceKind` values such as `disk` and `provider-home`. Provider-home source diagnostics MUST degrade the Codex `provider-home` status and surface through `sourceStatuses[].diagnostics` instead of converting omitted provider-backed rows into authoritative deletion evidence. Frontend continuity may retain last-good provider-backed Codex rows while this Codex status is partial/degraded.
- Kimi catalog discovery MUST scan the configured/default Kimi home plus app-local `kimi-provider-homes/*` when `home_dir` is absent. Each managed root's directory name is exposed as optional `providerProfileId`; workspace membership still MUST come from `session_index.jsonl.workDir` matching, never from provider-home ownership alone.
- Kimi `list`, `load`, `delete`, and native continuation path resolution MUST share the same provider-aware root resolver. A discovered `sessionDir` MUST be resolved relative to its discovered root when it is not absolute, and delete MUST rewrite that root's `session_index.jsonl` without removing the provider home or unrelated sessions.
- Kimi managed-root enumeration failure MUST return a contextual error so catalog projection emits a degraded/partial Kimi source status; it MUST NOT be converted into `authoritative_empty`. An absent managed-root parent is a compatible empty result and does not hide the default Kimi root.
- Codex rollout `session_meta.payload.source.subagent.thread_spawn` 是 parent relationship 的 source fact。scanner MUST 兼容 snake_case / camelCase，保留首次有效 `parent_thread_id`，且后续 copied parent `session_meta` MUST NOT 覆盖 child canonical UUID 或 relationship。
- Codex child display title MUST 按 `agent_nickname` → `agent_path` basename → existing user-summary fallback 的顺序解析。不同 child UUID MUST NOT 因标题相同被合并；同一 canonical child UUID 的多个 physical rollout files MUST 在 usage aggregation 与 bounded truncation 前收敛为一个 source fact，usage/cost 不求和，并合并 aliases 与 relationship/title evidence。
- Codex workspace/global catalog、native local-thread fallback 与 daemon adapter MUST 输出 `parentSessionId`；frontend boundary MUST normalize 为 `ThreadSummary.parentThreadId`，并复用既有 Sidebar tree projection。local/live merge 若保留 rollout filename alias 作为 visible row id，MUST 同时保留 canonical `canonicalSessionId`，并把当前可见 parent 的 canonical UUID 解析为 visible parent id。child usage/cost/transcript 仍属于 child 自己，禁止改写为 parent UUID 或从统计中删除。
- Sidebar native local-thread fallback 与 daemon fallback MUST 共享 `ThreadPreview` scanner：候选按 mtime recent-first，`cursor + limit + next-page proof + fixed lookahead` 同时约束 unique session 与 candidate file work，单文件最多读取 256 KiB。MUST NOT 用 `usize::MAX` 完整解析全部 JSONL 后再 slice。
- `ThreadPreview` 的 timestamp MUST 使用 file mtime，title/identity/source 只消费 bounded prefix；prefix 缺少 title 时 MAY 使用既有 generic preview。Session Management、usage/cost 与显式 exhaustive catalog MUST 保留 `Full` parser；`Full` MUST 在 limit truncation 前扫描并合并全部 physical duplicate evidence，禁止用 preview 的 partial usage 伪装完整统计。
- Desktop unified list 与 daemon live fallback MUST 使用同一 preview API。只修 Desktop 而让 daemon fallback 继续 full parse 视为 parity regression。
- Mutation writes MUST route by the row owner workspace and stable key, not by the currently selected aggregate workspace. Batch mutation results SHOULD expose `ownerWorkspaceId` and `stableSessionKey` for frontend reconciliation.
- Stable metadata key MUST be `engine + ownerWorkspaceId + canonicalSessionId`; new writes use stable key while reads may keep legacy bare `sessionId` compatibility.
- Source-fact cache is read-through acceleration only. It may cache bounded source facts, diagnostics, fingerprint, scanner/schema version, and cache metrics; it MUST NOT cache owner workspace, strict membership, archive/folder/custom title overlay, display window, selected state, or processing state.
- `.omx/**`, `.trellis/.developer`, `.trellis/.current-task`, client-local state, and other runtime artifacts MUST NOT be treated as long-term session catalog facts.

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| AppShell 切换 main/worktree，只需 owner ids | 从 workspace registry 同步推导 topology；后续 bounded hydration 决定 membership | 调用 projection summary / `limit=9999` all-engine scan 回答 topology |
| parent project aggregate includes child Claude row | row keeps child `workspaceId` and stable key | frontend exact-filter drops child row |
| worktree-only scope | only own worktree sessions appear | parent/sibling rows leak into strict membership |
| native Claude list empty but catalog has complete row | keep catalog row | native empty clears row |
| Claude scan uncertain/partial/degraded | preserve last-good continuity and expose source status | treat omission as authoritative deletion |
| cwd and Claude project dir conflict | unresolved diagnostic; no strict membership | guess parent/child owner |
| archive/move/delete child row from aggregate | write child owner metadata by stable key | write selected parent metadata |
| settings delete success | remove deleted ids from sidebar/list/cache/curtain derived state | degraded fallback revives deleted row or leaves deleted curtain loading |
| source-fact cache hit | rerun ownership resolver and metadata overlay | reuse cached owner/membership |
| cache missing/corrupt/deleted | direct scan and rebuild when possible | convert cache failure into authoritative empty |
| Codex child rollout contains structured subagent source | preserve child UUID，project `parentSessionId`，title 使用 agent identity | 把 child 当顶层 row，或用 inherited parent prompt 作为同名标题 |
| later copied parent metadata appears in child rollout | keep first valid child identity / relationship | overwrite child UUID、parent link 或 agent title |
| two files share one child canonical UUID | converge by canonical identity | 按 physical path 显示两条，或按 title 合并其他 distinct child UUID |
| duplicate rollout lies inside bounded scan window | dedupe before limit；one page slot and one usage evidence | duplicate consumes multiple slots、false end-of-page 或 usage double count |
| Sidebar `limit=5` + large Codex archive | bounded recent-first preview，单文件 ≤256 KiB，fixed candidate lookahead | 完整读取全部 archive 或先 full scan 后 `.take(5)` |
| daemon live list unavailable | 使用同一 bounded preview fallback | daemon 独立走 full JSONL parser |
| Session Management / usage explicit scan | 使用 `Full` parser，保留完整 usage/cost | 把 preview partial usage 当 authoritative |
| Kimi managed provider home exists after restart | scan default + `kimi-provider-homes/*`, then filter by `workDir` | repeat scan of only the empty in-memory/default `home_dir` |
| Kimi managed provider root enumeration fails | preserve catalog continuity and mark Kimi source degraded/partial | treat missing provider rows as authoritative deletion |
| Kimi native load/delete | use the discovered root descriptor for wire path and index rewrite | resolve delete index from the current global/default home |
| visible parent id is a rollout filename alias | child link resolves canonical parent UUID to visible parent id | child remains a root because ids differ |
| runtime native rename looks like `Agent 12` / `Claude Session` / short hex | `nativeTitle` bypasses fallback strength heuristic，仍低于 GUI custom/mapped title | 仅传普通 `title`，导致旧 first-message title 被保留 |
| old backend omits `nativeTitle` | normalize 为 absent，继续既有 title projection | 把 optional field 当 required 而丢弃 catalog row |
| Shared V2 Codex Binding exists only in event store | exclude its Native row before/after refresh | show a duplicate ordinary Session |
| Shared summary contains V0 and V2 copy of one identity | sort/dedupe once | duplicate exclusion state or duplicate UI row |

### 5. Good / Base / Bad Cases

- Good：child rollout 保留自己的 UUID、usage 与 transcript，同时携带 `parentSessionId`；Sidebar 显示一个 parent root 与多个 agent-labelled children。
- Good：catalog 同时输出 display `title` 与 optional `nativeTitle`，central projection 能区分 authoritative rename 和 weak fallback。
- Good：Sidebar 与 daemon fallback 共用 bounded preview；Session Management 继续 full scan，read-path 意图清晰分离。
- Base：普通 Codex session 没有 structured subagent metadata，继续使用既有 summary/title 与顶层 projection。
- Base：preview prefix 有 session identity 但没有 user title，row 使用既有 generic Codex preview，Load older 仍可分页。
- Base：旧 backend 或未重命名 session 不提供 `nativeTitle`，frontend 继续使用现有 title-strength fallback。
- Bad：按 title 去重、把 child UUID 改成 parent UUID、忽略 object-form `source`，或只修 authoritative catalog 而遗漏 native/daemon fallback。
- Bad：给 first page 传小 `limit`，backend 内部仍 `scan(..., usize::MAX)`；timeout 返回后 `spawn_blocking` 继续吞吐完整 archive。
- Bad：把 runtime rename 只覆盖到 `title` / `firstMessage`，不保留来源，导致 `Agent N` 等合法名字被当成 fallback。

### 6. Tests Required

- Rust tests for parent/child owner resolution, ambiguous sibling, cwd/project-dir conflict, source completeness, and metadata orphan behavior.
- Rust mutation tests for archive, unarchive, delete, and folder assignment routing by owner workspace and stable key.
- Rust cache tests for hit/miss/stale/schema mismatch/corrupt/deleted rebuild, plus cache exclusion of transcript body and organization overlay.
- Rust parser/source tests for snake_case/camelCase subagent metadata、agent path basename fallback、later parent metadata sticky behavior，以及 canonical child UUID 在 aggregation/limit 前 dedupe（assert aliases、relationship/title、non-additive usage）。
- Rust bounded scanner tests MUST assert recent candidate order、duplicate 不消费 unique budget、fixed candidate cap、preview 读不到 256 KiB 之后的 usage event，并使用 mtime timestamp。
- Rust unified list tests MUST assert cursor offset + limit + fixed lookahead 的 scan target；source review MUST assert Desktop 与 daemon fallback 都调用 `list_codex_session_previews_for_workspace`。
- Rust catalog/native/daemon mapping tests MUST assert `parentSessionId` survives every local projection。
- Rust Kimi history tests MUST assert default + managed root discovery, explicit custom-home isolation, workspace `workDir` filtering, relative `sessionDir` resolution, and load/delete targeting the discovered root while preserving unrelated sessions/provider-home directories. Frontend Vitest MUST assert native Kimi `providerProfileId` survives normalization and merge into `ThreadSummary`.
- Rust event-store test MUST assert all Binding rows for one Shared Session are queryable; frontend
  catalog test MUST assert a V2-only Native identity is removed from ordinary rows while the Shared
  row remains.
- Rust local/live merge tests MUST combine canonical ids、rollout aliases 与 parent relationship，并 assert `canonicalSessionId` 和 visible `parentSessionId` 同时正确；catalog test MUST assert duplicate child 只计一次 `childrenCount`。
- Vitest coverage for Sidebar catalog normalization preserving child owner rows, Session Management stable selection keys, native empty not clearing catalog rows, and Workspace Home not deriving session membership from `recentThreads`.
- Vitest MUST cover navigation topology 的 no-active、main + direct child stable order、worktree isolation、registry-pending fallback，并 assert AppShell navigation 不调用 `useWorkspaceSessionProjectionSummary`。
- Vitest coverage MUST assert raw Codex `parentSessionId -> ThreadSummary.parentThreadId`，且 parent + child tree 只产生一个 root。
- Rust tests MUST assert Codex/Claude native rename 分别写入 `nativeTitle`，同时保留 first-message fallback 与 per-home isolation；native/daemon/catalog projection 都 MUST 保留该 optional field。
- Vitest MUST assert weak-looking `nativeTitle` 覆盖旧 first-message title，且 GUI custom/mapped title 仍有更高 precedence；catalog boundary MUST trim/narrow optional field。
- Contract validation: `openspec validate <change-id> --strict --no-interactive`, `cargo test --manifest-path src-tauri/Cargo.toml session_management claude_history`, focused Vitest for thread/settings session paths, `npm run typecheck`, and `npm run check:runtime-contracts`.

### 7. Wrong vs Correct

#### Wrong

```rust
WorkspaceSessionCatalogEntry {
    parent_session_id: None,
    title: inherited_parent_prompt,
    // distinct Codex child rollouts become duplicate-looking roots
}
```

#### Correct

```rust
WorkspaceSessionCatalogEntry {
    parent_session_id: summary.parent_session_id,
    title: summary.summary.unwrap_or_else(|| "Codex Session".to_string()),
    native_title: summary.native_title,
    // child canonical UUID remains unchanged
}
```

#### Wrong

```typescript
selectProjectedSessionDisplayName({ previous, nextName: entry.title });
// 合法 native rename "Agent 12" 会被当成 fallback。
```

#### Correct

```typescript
selectProjectedSessionDisplayName({
  previous,
  nextName: entry.title,
  nativeTitle: entry.nativeTitle,
});
```

#### Wrong

```ts
const visible = response.data.filter(
  (entry) => (entry.workspaceId ?? selectedWorkspaceId) === selectedWorkspaceId,
);
```

#### Correct

```ts
const visible = response.data.map(normalizeProjectCatalogSession).filter(Boolean);
```

#### Wrong

```ts
const { summary } = useWorkspaceSessionProjectionSummary({
  workspaceId: activeWorkspaceId,
  query: { status: "active" },
});
const ownerIds = summary?.ownerWorkspaceIds ?? [activeWorkspaceId];
// navigation 只要 topology，却触发 limit=9999 的 all-engine inventory。
```

#### Correct

```ts
const ownerIds = resolveWorkspaceProjectionOwnerIds(
  workspaces,
  activeWorkspaceId,
);
// inventory 仍由 bounded catalog hydration 负责。
```

#### Wrong

```ts
const hiddenIds = new Set(sharedSessions.flatMap(readLegacyBindingsByEngine));
```

#### Correct

```ts
const hiddenIds = new Set(
  sharedSessions.flatMap((session) => session.nativeThreadIds),
);
// nativeThreadIds 已由 backend 合并 V0 compatibility + V2 binding state。
```

#### Wrong

```rust
let key = metadata_stable_key_for_session_id(&selected_workspace_id, &session_id);
metadata.archived_at_by_session_id.insert(key, archived_at);
```

#### Correct

```rust
let target = resolve_session_mutation_target(&scope_entries, &workspaces, &session_id)?;
metadata_for(&target.owner_workspace_id)
    .archived_at_by_session_id
    .insert(target.stable_session_key, archived_at);
```

#### Wrong

```rust
let mut sessions = scan_codex_session_summaries(workspace, roots)?;
sessions.truncate(requested_limit);
// limit 只限制 response，不限制 JSONL read/parse work。
```

#### Correct

```rust
let (_, sessions) = list_codex_session_previews_for_workspace(
    workspaces,
    workspace_id,
    requested_scan_limit,
)
.await?;
// Sidebar/daemon preview bounded；显式 catalog 仍走 Full parser。
```

#### Kimi Provider-Home Routing

##### Wrong

```rust
let index_path = resolve_kimi_base_dir(custom_home).join("session_index.jsonl");
// restart 后 managed Kimi session 已从 provider home 发现，但 delete 仍写默认 home。
```

##### Correct

```rust
let location = find_workspace_index_entry(workspace, session_id, custom_home).await?;
let index_path = location.root.base_dir.join("session_index.jsonl");
// list/load/delete 使用同一 discovered root，provider metadata 只作为 overlay。
```
