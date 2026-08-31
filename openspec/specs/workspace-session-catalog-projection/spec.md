# workspace-session-catalog-projection Specification

## Purpose

Defines the workspace-session-catalog-projection behavior contract, covering Shared Workspace Session Projection MUST Use One Scope Resolver.

## Requirements

### Requirement: Shared Workspace Session Projection MUST Use One Scope Resolver

系统 MUST 为 sidebar、`Workspace Home` 与 `Session Management` 复用同一套 workspace session scope resolver，不得让不同 surface 各自推导 main/worktree 边界。

#### Scenario: main workspace resolves to project scope

- **WHEN** 用户以某个 main workspace 作为当前项目上下文读取默认会话投影
- **THEN** 系统 MUST 将该 scope 解析为 main workspace 与其 child worktrees
- **AND** 该 scope 解析规则 MUST 与 `Session Management` 的 strict project view 一致

#### Scenario: worktree resolves to isolated scope

- **WHEN** 用户以某个 worktree 作为当前项目上下文读取默认会话投影
- **THEN** 系统 MUST 只解析该 worktree 自身 scope
- **AND** MUST NOT 隐式并入 parent main workspace 或 sibling worktrees

### Requirement: Default Main Surfaces MUST Consume Shared Active Projection

sidebar 与 `Workspace Home` 的默认会话集合 MUST 基于共享 catalog 的 `strict + active + unarchived` projection 决定 membership 与 count；运行时线程状态 MAY 叠加其上，但 MUST NOT 单独扩大或收缩该集合。
When the shared active projection is degraded, sidebar surfaces MAY preserve last-good Claude native rows as continuity placeholders until authoritative projection or native truth resolves membership.
Session organization state for newly created pending engine sessions MAY be kept as a temporary UI overlay, but MUST be reconciled through explicit pending-to-real identity transition before durable folder assignment is written.

#### Scenario: sidebar and home align with session management active strict projection
- **GIVEN** 用户打开某个 workspace，并同时查看 sidebar 或 `Workspace Home`
- **WHEN** 同一 workspace 的 `Session Management` 处于 `strict + active` 默认视图
- **THEN** sidebar / `Workspace Home` 的默认会话集合 MUST 来自同一 active projection
- **AND** count 差异 MUST 只允许来自显式展示窗口差异，而不是 scope 或 archive 口径不同

#### Scenario: runtime overlay does not widen membership
- **GIVEN** 运行时线程缓存中存在尚未完成清理的旧 thread 状态
- **WHEN** 共享 active projection 刷新完成
- **THEN** surface 的默认会话 membership MUST 以共享 projection 为准
- **AND** runtime overlay MUST 只补充 processing、reviewing、selected 等状态

#### Scenario: pending organization overlay follows identity transition
- **GIVEN** 新建 engine session 仍处于 pending identity
- **AND** 用户已经为该 pending session 选择了 folder/root organization intent
- **WHEN** 系统收到明确的 `pendingThreadId -> realThreadId` identity transition
- **THEN** surface MUST migrate organization overlay to `realThreadId`
- **AND** durable folder assignment MUST be written for `realThreadId`
- **AND** the migration MUST NOT select another same-engine session by catalog ordering or candidate count alone

#### Scenario: all pending-finalization rename paths share organization migration
- **GIVEN** frontend code has multiple paths that can dispatch `renameThreadId` for a pending engine session
- **WHEN** any such path finalizes `pendingThreadId` to `realThreadId`
- **THEN** it MUST trigger the same pending organization migration contract
- **AND** no dispatch path MAY rely on catalog-result guessing as its primary folder-intent migration mechanism

#### Scenario: Claude continuity does not bypass archive filters
- **GIVEN** the sidebar preserves last-good Claude rows during a degraded shared projection
- **WHEN** the current projection or authoritative native source proves a row is archived, hidden, deleted, or out of strict workspace scope
- **THEN** that row MUST be removed or filtered
- **AND** continuity MUST NOT widen membership beyond the active strict unarchived contract

### Requirement: Projection Summary MUST Expose Filtered Totals And Degraded State

共享 session projection summary MUST 区分 filtered total 与 surface 当前可见窗口，并暴露 partial/degraded source，避免 UI 把不完整结果误渲染成完整项目事实。
For Claude native sidebar membership, degraded projection MUST be treated as incomplete evidence rather than authoritative deletion evidence.

#### Scenario: filtered total is distinct from visible window

- **WHEN** 某个 surface 只展示 active projection 的窗口子集
- **THEN** 系统 MUST 能同时提供 filtered total 与当前 visible window 信息
- **AND** UI MUST NOT 将当前窗口条目数误标为完整项目会话总量

#### Scenario: degraded source remains explainable

- **GIVEN** 某个 engine/source 的历史读取失败或不可用
- **WHEN** 系统返回 projection summary
- **THEN** summary MUST 暴露 partial/degraded marker
- **AND** 依赖该 summary 的 surface MUST 能说明当前结果是不完整投影

#### Scenario: degraded projection cannot erase Claude native sidebar truth
- **WHEN** shared workspace session projection is partial, degraded, startup-only, or otherwise unable to prove Claude source completeness
- **AND** the sidebar has last-good Claude native rows for the same workspace
- **THEN** the sidebar MUST NOT clear those rows solely because the projection omitted them
- **AND** the projection MUST expose enough degraded evidence for the sidebar to preserve continuity while still showing the result as incomplete

### Requirement: Workspace Projection SHALL Keep Task-Run Aggregates Separate From Session Membership

系统 MUST 在 workspace 级 surface 中把 task-run 聚合与 session membership 分开表达，避免 run 数量污染 session catalog 口径。

#### Scenario: run aggregates do not change shared session membership

- **WHEN** workspace surface 同时展示会话目录与 task-run 摘要
- **THEN** task-run aggregates SHALL 作为独立 projection 呈现
- **AND** 共享 session membership 规则 SHALL 保持不变

#### Scenario: degraded run source stays explainable

- **WHEN** 某个 engine 的 run history 或 telemetry source 暂不可用
- **THEN** workspace-level task-run aggregate SHALL 暴露 degraded marker
- **AND** UI SHALL 能解释当前 run 结果并非完整全量

### Requirement: Workspace Session Projection SHALL Treat Folder Tree As Organization Only

共享 workspace session projection MUST 将 folder tree 作为 presentation/organization layer，而不是 membership resolver；sidebar、Workspace Home 与 Session Management 的 strict project scope 仍 MUST 由同一 resolver 决定。

#### Scenario: folder tree does not widen project scope
- **WHEN** 某 session 被分配到当前 project 的 folder
- **THEN** 该 session 仍 MUST 满足当前 project projection membership 才能显示在 strict project view
- **AND** folder assignment MUST NOT 让其它 project 的 session 进入当前 project projection

#### Scenario: sidebar count is not inflated by folders
- **WHEN** sidebar 或 Workspace Home 展示 project session count
- **THEN** 系统 MUST 按 shared active projection 计算 session membership
- **AND** MUST NOT 因 folder 数量或 folder nesting 增加 session count

#### Scenario: root and folder views share degradation markers
- **WHEN** 某 engine/source 历史读取失败导致 projection degraded
- **THEN** root view 与 folder view MUST 暴露一致的 degraded marker
- **AND** folder tree MUST NOT 把 partial result 渲染成完整项目事实

### Requirement: Workspace Session Projection SHALL Support Bounded Backend Pagination

Workspace session catalog projection MUST acquire backend data through bounded pages, bounded ordered candidates, or capped scans so a first-page request does not require exhausting all engine history sources.

#### Scenario: first page does not exhaust full large history
- **WHEN** project history contains more sessions than the requested catalog page limit
- **THEN** backend catalog construction SHOULD stop after it has enough ordered candidates or reaches a documented scan cap
- **AND** response MUST preserve a stable next cursor or partial/degraded marker when more data may exist

#### Scenario: engine without native cursor uses capped degradation
- **WHEN** an engine history source cannot provide native cursor/limit semantics
- **THEN** backend MAY use a bounded scan cap for that source
- **AND** MUST expose partial/degraded evidence if the cap prevents proving completeness
- **AND** other engine sources MUST continue returning their available entries

#### Scenario: load older preserves filter and source semantics
- **WHEN** 用户点击 Load older with keyword、engine 或 status filter
- **THEN** next page MUST use the same filter semantics as the first page
- **AND** MUST NOT duplicate entries already returned for the same cursor chain

### Requirement: Workspace Session Projection SHALL Be The Default Membership Truth

Sidebar, Workspace Home, and Session Management default workspace session membership SHALL be derived from the shared workspace session catalog projection instead of independently merging engine-specific native lists as parallel truth sources.

#### Scenario: sidebar uses catalog membership for Claude rows
- **WHEN** the sidebar renders default active workspace sessions
- **THEN** Claude rows MUST be admitted through the shared active workspace session projection
- **AND** native Claude listing MUST NOT independently widen or shrink default membership outside that projection

#### Scenario: native Claude list remains detail and diagnostic source
- **WHEN** the UI needs to load a Claude transcript or diagnose Claude native history availability
- **THEN** it MAY call native Claude history commands
- **AND** the native result MUST NOT override catalog membership unless the catalog marks the Claude source as incomplete

#### Scenario: settings and home share projection semantics
- **WHEN** Sidebar, Workspace Home, and Session Management request the same active strict workspace scope
- **THEN** their membership sets MUST be explainable from the same backend projection
- **AND** any difference MUST come from display window, pagination, or explicit UI filters rather than different scope rules

### Requirement: Workspace Session Projection SHALL Expose Claude Source Completeness

Workspace session catalog responses SHALL expose whether Claude source absence is authoritative or incomplete so consumers do not confuse degraded omissions with deletion.

#### Scenario: authoritative Claude empty can clear continuity
- **WHEN** the backend proves Claude scanning is complete for the requested strict scope and no Claude sessions match
- **THEN** the projection MUST expose an authoritative empty state for Claude
- **AND** consumers MAY remove stale Claude continuity rows for that scope

#### Scenario: uncertain Claude empty cannot erase last-good rows
- **WHEN** Claude source scanning returns no rows but cannot prove full workspace coverage
- **THEN** the projection MUST expose uncertain or degraded Claude source status
- **AND** consumers MUST NOT clear last-good Claude rows solely because the current response omitted them

#### Scenario: capped Claude scan remains partial
- **WHEN** Claude scanning stops because a scan cap, timeout, malformed transcript, oversized transcript, or source error prevents complete evaluation
- **THEN** the projection MUST expose partial or degraded Claude source status
- **AND** the UI MUST be able to explain that the visible result may be incomplete

### Requirement: Workspace Session Projection SHALL Merge Source Completeness Conservatively

Workspace session catalog projection SHALL preserve per-engine source completeness and SHALL NOT allow one engine's complete result to hide another engine's incomplete evidence.

#### Scenario: Claude incomplete remains visible beside Codex complete
- **WHEN** Codex scanning completes successfully
- **AND** Claude scanning returns partial, degraded, or uncertain empty evidence
- **THEN** the projection MUST keep Claude's incomplete source status in the response
- **AND** the projection summary MUST NOT describe the overall project result as fully complete without exposing that Claude is incomplete

#### Scenario: authoritative empty is engine and scope specific
- **WHEN** Claude scanning proves authoritative empty for the requested strict workspace scope
- **THEN** that proof MUST apply only to Claude in that requested scope
- **AND** it MUST NOT be reused as proof for related/global history or other engines

#### Scenario: incomplete reasons do not collapse into empty
- **WHEN** Claude storage is unavailable, permission denied, capped, timed out, malformed, oversized, or otherwise not fully evaluated
- **THEN** the projection MUST expose a partial, degraded, or uncertain empty source status
- **AND** it MUST NOT collapse the result into authoritative empty

### Requirement: Workspace Session Projection SHALL Preserve Owner Scope Evidence

Workspace session projection SHALL carry enough owner and scope evidence for frontend consumers to avoid reimplementing workspace membership filters.

#### Scenario: child worktree row survives project aggregate projection
- **GIVEN** a main workspace projection includes child worktree owner scopes
- **WHEN** a Claude session belongs to a child worktree within that project aggregate
- **THEN** the backend projection MUST include the row with its true owner workspace identity
- **AND** the frontend MUST NOT drop it by requiring the owner workspace id to equal the selected main workspace id

#### Scenario: worktree-only projection remains isolated
- **GIVEN** the requested scope is a single worktree
- **WHEN** the backend builds active strict projection
- **THEN** it MUST include only sessions owned by that worktree scope
- **AND** it MUST NOT include parent or sibling workspace rows merely because they share a git root

#### Scenario: unresolved Claude ownership is explainable
- **WHEN** a Claude transcript exists on disk but cannot be uniquely attributed to the requested workspace scope
- **THEN** the projection MUST expose unresolved or ambiguous ownership evidence
- **AND** the transcript MUST NOT silently disappear as if it never existed

#### Scenario: unresolved Claude ownership does not enter strict membership
- **WHEN** a Claude transcript exists on disk
- **AND** the backend cannot uniquely prove its owner workspace for the requested strict scope
- **THEN** the strict active projection MUST NOT include that transcript as a current workspace session
- **AND** the response MUST expose diagnostic evidence so the omission is explainable

#### Scenario: conflict between cwd and project directory is not guessed
- **WHEN** a Claude transcript cwd points to one known workspace
- **AND** its Claude project directory maps to a different known workspace
- **THEN** the projection MUST mark the candidate as unresolved or conflicting
- **AND** it MUST NOT choose either owner without explicit higher-confidence evidence

### Requirement: Session Catalog Stability Evidence MUST Preserve Bounded Projection Semantics

Session catalog stability evidence MUST evaluate scan, cursor, degraded-state, and compatibility behavior without changing membership truth.

#### Scenario: evidence report preserves degraded projection semantics
- **WHEN** session catalog evidence is summarized
- **THEN** degraded or partial projection states MUST remain visible
- **AND** the report MUST NOT treat omitted rows from degraded evidence as authoritative deletion proof

#### Scenario: compatibility list APIs remain diagnostic unless removed by change
- **WHEN** legacy or native list APIs are present for session continuity
- **THEN** reports MUST describe them as compatibility or diagnostic paths
- **AND** they MUST NOT be removed solely because the shared projection is the preferred membership truth

### Requirement: Workspace Session Projection SHALL Carry Reconciliation Evidence

Shared workspace session projection MUST carry enough evidence for consumers to distinguish authoritative absence from degraded or inconsistent source state.

#### Scenario: omission is not deletion during degraded projection
- **WHEN** a projection response omits a session while any source is partial or degraded
- **THEN** consumers MUST NOT treat the omission alone as authoritative deletion
- **AND** stale continuity rows MAY remain marked degraded until authoritative evidence arrives

#### Scenario: missing-on-disk is authoritative cleanup evidence
- **WHEN** a catalog entry is returned with `missing-on-disk`
- **THEN** the management UI MAY offer metadata cleanup
- **AND** sidebar active projection MUST NOT show it as a live session

### Requirement: Projection Mutation Results SHALL Preserve Owner Routing

Archive, unarchive, delete and folder assignment responses MUST remain tied to the actual owner workspace used for mutation.

#### Scenario: project aggregate delete returns owner-aware results
- **WHEN** a project-scoped batch delete includes sessions from multiple child workspaces
- **THEN** each mutation result MUST be attributable to the owner workspace used for deletion
- **AND** frontend selection keys MUST remain stable for partial success handling

### Requirement: Workspace Session Projection MUST Preserve Non-Authoritative Source Status

Workspace session catalog projection MUST NOT report an engine/source as complete when the source was bounded, capped, timed out, cache-degraded, or otherwise unable to prove the requested scope was fully covered.

#### Scenario: bounded scan cap prevents complete status
- **WHEN** an engine source returns one or more rows from a bounded scan
- **AND** the scan reaches the documented cap or lookahead limit before completeness can be proven
- **THEN** the source status MUST be `partial`, `degraded`, `uncertain_empty`, or an equivalent non-authoritative status
- **AND** the response MUST expose cap evidence such as `scanCapReached`, `scannedCandidates`, `reason`, or equivalent diagnostics

#### Scenario: non-authoritative source cannot prove deletion or empty membership
- **WHEN** a source status is partial, degraded, capped, timed out, or uncertain
- **THEN** dependent surfaces MUST NOT treat omitted sessions as deleted, archived, or out of scope
- **AND** continuity rows MAY be preserved with degraded evidence until authoritative source truth is available

#### Scenario: complete status requires coverage proof
- **WHEN** the catalog reports an engine source as complete for a workspace scope
- **THEN** the backend MUST have proof that the source was reachable, not capped, not timed out, and fully evaluated for the requested scope/filter
- **AND** frontend surfaces MAY use that complete status as authoritative empty or authoritative omission evidence

### Requirement: Workspace Session Projection MUST Bound Archived Evidence

Archived evidence used by sidebar or workspace surfaces MUST be acquired through bounded requests, backend-provided archive metadata evidence, or an equivalent finite contract; failure to acquire archived evidence MUST be exposed as degraded rather than interpreted as no archived sessions.

#### Scenario: archived lookup failure is degraded evidence
- **WHEN** a sidebar refresh needs archived metadata to filter last-good continuity rows
- **AND** the archived evidence lookup times out, fails, or cannot prove completeness
- **THEN** the refresh MUST expose archived evidence as degraded or uncertain
- **AND** it MUST NOT interpret the failure as an empty archived map

#### Scenario: archived row is not resurrected by missing archive evidence
- **WHEN** a row is known archived from current projection, authoritative native source, or previous complete archive evidence
- **AND** a later archived evidence lookup is partial, degraded, or failed
- **THEN** sidebar continuity MUST NOT resurrect that archived row as active
- **AND** the UI MUST keep enough degraded evidence to explain why archived truth is incomplete

#### Scenario: archived evidence does not require full catalog exhaustion
- **WHEN** a workspace has more archived or active sessions than the sidebar display window
- **THEN** archived evidence collection for a regular sidebar refresh MUST remain bounded
- **AND** full archive exploration MUST be reserved for Session Management or global history pagination surfaces

### Requirement: Workspace Session Projection MUST Use Stable Continuation Cursors

Workspace session catalog pagination MUST use a stable continuation cursor or equivalent anchor-based model instead of relying solely on mutable list offsets.

#### Scenario: cursor chain survives new session insertion
- **WHEN** a caller reads the first page of a sorted catalog result
- **AND** a newer session is inserted before the caller requests the next page with the returned cursor
- **THEN** the next page MUST NOT skip existing entries that belonged after the original page anchor
- **AND** it MUST NOT duplicate entries already returned in the same cursor chain

#### Scenario: cursor encodes stable ordering anchor
- **WHEN** the backend returns `nextCursor`
- **THEN** the cursor MUST encode or reference stable ordering evidence such as updated timestamp, stable session identity, owner workspace, and filter context
- **AND** callers MUST treat the cursor as opaque

#### Scenario: legacy offset cursor remains compatibility only
- **WHEN** a caller passes an old offset-style cursor
- **THEN** the backend MAY accept it for compatibility
- **AND** any new `nextCursor` returned by the backend SHOULD use the stable cursor format

### Requirement: Workspace Session Projection SHALL Apply Automatic Visibility Classification
Workspace session catalog projection SHALL apply automatic session visibility metadata before producing root, folder, Sidebar, Workspace Home, and Session Management active lists.

#### Scenario: Hidden automatic rows are filtered before surface projection
- **WHEN** backend catalog sources return a session classified as `hidden`
- **THEN** shared workspace session projection SHALL exclude it from normal active user-facing membership
- **AND** Sidebar, Workspace Home, and Session Management SHALL NOT re-add it from native engine lists or runtime overlays

#### Scenario: System-auto rows are excluded from root membership
- **WHEN** backend catalog sources return a session classified as `system-auto`
- **THEN** shared workspace session projection SHALL exclude it from root session rows
- **AND** the projection SHALL expose it through the reserved system-auto grouping contract

#### Scenario: Missing metadata preserves existing behavior
- **WHEN** backend catalog sources return a session without automatic visibility metadata
- **THEN** shared workspace session projection SHALL preserve existing membership behavior
- **AND** it SHALL NOT infer hidden status from title text alone

#### Scenario: Compatibility hide signal is normalized
- **WHEN** a Codex background hide signal or equivalent legacy compatibility marker exists for a session
- **THEN** shared workspace session projection SHALL treat the session as hidden automatic metadata
- **AND** all surfaces SHALL consume the normalized classification rather than parsing engine-specific hide events independently

### Requirement: Workspace Projection SHALL Expose Task Run And Orchestration Links Separately From Session Membership

Workspace projection SHALL expose orchestration/task/run/session relationships without changing shared session catalog membership semantics.

#### Scenario: linked sessions are projected separately

- **WHEN** an orchestration task links to one or more sessions
- **THEN** workspace projection SHALL expose those links as task/session associations
- **AND** session catalog membership SHALL remain governed by existing session catalog rules

#### Scenario: task aggregate does not inflate session count

- **WHEN** workspace overview renders orchestration or task-run aggregates
- **THEN** those aggregates SHALL NOT be counted as additional sessions
- **AND** session counts SHALL remain based on session membership truth

#### Scenario: degraded task source is explainable

- **WHEN** a task/run/session association references a missing run, missing session, or unreadable source
- **THEN** workspace projection SHALL expose a degraded marker
- **AND** UI SHALL explain which linked source is unavailable

### Requirement: Workspace Session Catalog SHALL Avoid Unbounded First-Page Loads

Workspace session catalog and sidebar consumers SHALL treat the first page as a
bounded projection rather than an all-history completeness proof.

#### Scenario: sidebar first paint uses a bounded request

- **WHEN** sidebar hydration requests the first workspace session page
- **THEN** the request MUST use a documented bounded page size
- **AND** it MUST NOT use a sentinel limit to force exhaustive history before first paint
- **AND** the response MUST retain a stable continuation cursor or explicit partial/degraded evidence when more history may exist

#### Scenario: incomplete source remains explicit

- **WHEN** an engine source cannot prove completeness within the page limit, native cursor, timeout, or scan cap
- **THEN** the response MUST include next cursor, partial source, degraded source status, or capped scan evidence
- **AND** the UI MUST NOT treat omitted rows as authoritative deletion proof

#### Scenario: load older preserves the original query contract

- **WHEN** the user loads an additional page after applying workspace scope, attribution mode, keyword, engine, or status filters
- **THEN** the continuation request MUST preserve those query dimensions
- **AND** merged rows MUST remain stably ordered and deduplicated
- **AND** a late page from an older query MUST NOT replace the current projection

#### Scenario: bounded absence is not authoritative deletion

- **WHEN** a bounded first page omits a previously visible in-scope session
- **AND** source completeness is partial, capped, timed out, or otherwise degraded
- **THEN** consumers MUST NOT remove the last-good row solely because of the omission
- **AND** authoritative archived, deleted, hidden, or out-of-scope evidence MUST still remove it

### Requirement: Related Attribution SHALL Be Cached And Deduplicated By Effective Query

Related workspace session attribution SHALL avoid repeating equivalent expensive catalog scans for the same workspace and query.

#### Scenario: equivalent related query reuses cached projection
- **WHEN** sidebar hydration, Workspace Home, Session Management, or Radar prewarm request the same workspace, attribution mode, filters, source scope, cursor, and page size within a valid cache window
- **THEN** the system SHOULD reuse or deduplicate the in-flight/catalog projection result
- **AND** duplicate requests MUST NOT independently rescan all related engine history sources

#### Scenario: cache key respects attribution mode and filters
- **WHEN** session attribution mode, keyword, status, engine, folder, source, workspace, cursor, or page size changes
- **THEN** the cache key or dedupe scope MUST change accordingly
- **AND** a `related` result MUST NOT be reused as `workspace-only` membership truth, nor vice versa

### Requirement: Session Management Filters SHALL Not Flood Backend Catalog

Session Management filter interactions SHALL be scheduled so they do not issue backend catalog requests for every transient keystroke.

#### Scenario: keyword input is debounced or transitioned
- **WHEN** the user types a session search keyword
- **THEN** the UI MUST debounce, transition, or otherwise coalesce filter changes before issuing catalog requests
- **AND** stale responses for previous keywords MUST NOT replace the current result set

#### Scenario: filter changes preserve loading continuity
- **WHEN** filters change while a catalog request is in flight
- **THEN** the surface MAY keep last-good rows or show a scoped loading state
- **AND** it MUST NOT clear membership truth or folder assignment based on stale or partial responses

### Requirement: Catalog Hydration SHALL Not Block Foreground Thread Switching

Workspace session catalog hydration SHALL be staged and committed so active
thread switching and visible conversation interaction remain foreground work.

#### Scenario: switch does not wait for catalog completion
- **WHEN** a user selects a thread from sidebar, topbar, search, or Radar
- **THEN** the foreground active thread transition MUST NOT wait for full workspace session catalog hydration
- **AND** catalog refresh completion MUST reconcile in the background with stale guards

#### Scenario: background catalog result respects current scope
- **WHEN** a background catalog request completes after the user has navigated to another workspace or thread
- **THEN** the result MUST be applied only to its requested workspace/query scope
- **AND** it MUST NOT overwrite the current active thread, draft, or visible conversation state

#### Scenario: active workspace catalog starts before background prewarm

- **WHEN** multiple workspaces require session hydration after restore
- **THEN** the active workspace SHALL be prioritized
- **AND** related or inactive workspace work SHALL be deferred or chunked without serially blocking active readiness

#### Scenario: stale hydration cannot overwrite a foreground refresh

- **WHEN** an older background hydration completes after a newer foreground refresh
- **THEN** request identity SHALL reject the stale result
- **AND** the stale completion SHALL NOT mark the workspace fully hydrated

### Requirement: Workspace Session Projection SHALL Accept Attribution Mode

Workspace session projection SHALL accept workspace session attribution mode as an explicit all-engine membership resolver input.

#### Scenario: projection request carries attribution mode
- **WHEN** frontend requests workspace session catalog, default sidebar hydration, Workspace Home membership, or Session Management active workspace view
- **THEN** the request SHALL carry the effective workspace session attribution mode
- **AND** backend projection SHALL use that mode when resolving membership for every participating engine

#### Scenario: missing mode preserves compatibility
- **WHEN** a caller omits workspace session attribution mode
- **THEN** backend projection SHALL treat the request as `related`
- **AND** existing callers SHALL keep current behavior until they are migrated to pass the setting explicitly

### Requirement: Related Attribution Mode SHALL Preserve Existing Projection Semantics

`related` attribution mode SHALL preserve current workspace session projection semantics for all engines, including broad Claude related discovery.

#### Scenario: related mode keeps global Claude candidate discovery
- **WHEN** projection runs in `related` mode
- **THEN** Claude history listing MAY scan current workspace Claude project dirs and other Claude project dirs
- **AND** transcript `cwd`, workspace path, git root, and existing related attribution evidence MAY be used according to current behavior

#### Scenario: related mode keeps non-Claude engine discovery
- **WHEN** projection runs in `related` mode
- **THEN** Codex, Gemini, OpenCode, and future engine discovery SHALL keep their current related-mode behavior
- **AND** the new workspace-only strategy SHALL NOT narrow their related-mode candidate sets

#### Scenario: related mode keeps current tests meaningful
- **WHEN** existing tests assert that a Claude transcript from an unrelated project dir is visible because its `cwd` matches the current workspace scope
- **THEN** those tests SHALL remain valid for `related` mode
- **AND** `workspace-only` tests SHALL be added separately instead of changing the related expectation

### Requirement: Workspace-Only Attribution Mode SHALL Prevent Cross-Project Claude Membership

`workspace-only` attribution mode SHALL prevent Claude sessions from other workspace scopes from entering the current workspace membership through broad scan or related attribution.

#### Scenario: unrelated Claude project dir is excluded
- **GIVEN** current workspace path is `/projects/app`
- **AND** a Claude session file is located under another known workspace's Claude project dir
- **WHEN** projection runs in `workspace-only` mode for `/projects/app`
- **THEN** that session SHALL NOT appear in `/projects/app` membership solely because broad related discovery found it

#### Scenario: conflicting project dir owner is excluded
- **GIVEN** current workspace path is `/projects/app`
- **AND** a Claude session file is located under another known workspace's Claude project dir
- **AND** the same transcript `cwd` is `/projects/app/src`
- **WHEN** projection runs in `workspace-only` mode for `/projects/app`
- **THEN** the projection SHALL NOT include that transcript as `/projects/app` membership
- **AND** the projection SHALL expose conflict diagnostics or exclude the candidate without silently guessing ownership

#### Scenario: shared worktree family does not widen workspace-only membership
- **GIVEN** a Claude session is owned by a parent workspace or sibling worktree outside the requested workspace scope
- **WHEN** projection runs in `workspace-only` mode for the selected workspace
- **THEN** shared worktree family or sibling relationship SHALL NOT add that session to the selected workspace membership

#### Scenario: git-root inference does not widen workspace-only membership
- **GIVEN** a Claude transcript `cwd` is outside the selected workspace path
- **AND** it only matches the selected workspace through git-root or related inference
- **WHEN** projection runs in `workspace-only` mode
- **THEN** the projection SHALL NOT include that transcript as selected workspace membership

### Requirement: Workspace-Only Attribution Mode SHALL Preserve Current Workspace Child Cwd Sessions

`workspace-only` attribution mode SHALL keep Claude sessions whose transcript `cwd` is the current workspace path or a child path inside the current workspace scope.

#### Scenario: exact workspace cwd remains visible
- **GIVEN** current workspace path is `/projects/app`
- **AND** a Claude transcript `cwd` is `/projects/app`
- **WHEN** projection runs in `workspace-only` mode
- **THEN** the session SHALL remain eligible for current workspace membership

#### Scenario: child workspace cwd remains visible
- **GIVEN** current workspace path is `/projects/app`
- **AND** a Claude transcript `cwd` is `/projects/app/src`
- **WHEN** projection runs in `workspace-only` mode
- **THEN** the session SHALL remain eligible for current workspace membership
- **AND** the projection SHALL NOT require `cwd` to equal the workspace path exactly

#### Scenario: child Claude project dir remains visible
- **GIVEN** current workspace path is `/projects/app`
- **AND** a Claude session file is located under a Claude project dir representing `/projects/app/src`
- **AND** its transcript `cwd` is `/projects/app/src`
- **WHEN** projection runs in `workspace-only` mode for `/projects/app`
- **THEN** the session SHALL remain eligible for current workspace membership
- **AND** workspace-only scanning SHALL NOT be limited to only the exact `/projects/app` Claude project dir

#### Scenario: global unrelated project dirs are not scanned for workspace-only membership
- **GIVEN** current workspace path is `/projects/app`
- **AND** Claude history contains project dirs for `/projects/app`, `/projects/app/src`, and `/projects/other`
- **WHEN** projection runs in `workspace-only` mode for `/projects/app`
- **THEN** scanning for membership SHALL include `/projects/app` and `/projects/app/src` candidate dirs
- **AND** scanning for membership SHALL NOT include `/projects/other` solely because it exists under Claude history root

### Requirement: Workspace-Only Projection SHALL Keep Source Status Mode-Aware

Workspace session projection SHALL expose source completeness and diagnostics according to the requested attribution mode.

#### Scenario: workspace-only empty is scoped to workspace-only coverage
- **WHEN** Claude scanning proves no sessions for `workspace-only` mode
- **THEN** the projection SHALL expose authoritative empty evidence only for that mode and requested workspace scope
- **AND** that evidence SHALL NOT be reused to prove empty related-mode membership

#### Scenario: related scan cap does not define workspace-only completeness
- **WHEN** a previous or parallel `related` scan is capped, partial, or degraded
- **THEN** a `workspace-only` projection SHALL NOT treat that related status as its own authoritative completeness result
- **AND** it SHALL expose its own mode-specific source status

### Requirement: Workspace-Only Projection SHALL Use Independent Engine Strategies

Workspace-only projection SHALL use independent engine listing and attribution strategies instead of executing related-mode discovery and filtering its output.

#### Scenario: workspace-only does not invoke related scanner as implementation
- **WHEN** projection runs in `workspace-only` mode
- **THEN** backend SHALL use workspace-only engine strategies for candidate discovery
- **AND** backend SHALL NOT call the existing related scanner/listing pipeline as the implementation source for workspace-only membership

#### Scenario: related branch remains zero-diff
- **WHEN** projection runs in `related` mode
- **THEN** backend SHALL execute the existing related behavior path
- **AND** workspace-only code SHALL NOT change related-mode scan order, candidate set, attribution reasons, source status, or pagination behavior

### Requirement: Workspace-Only Projection SHALL Reconcile All Engine Adapters

Workspace-only projection SHALL reconcile all engine adapter outputs through the shared mode-aware membership resolver.

#### Scenario: all-engine workspace-only membership is scoped
- **WHEN** projection runs in `workspace-only` mode for a selected workspace
- **THEN** Claude, Codex, Gemini, OpenCode, and future engine sessions SHALL be admitted only when their engine evidence belongs to the selected workspace scope
- **AND** engine-specific native listing SHALL NOT directly widen selected workspace membership

#### Scenario: engine-specific ambiguity is fail-closed
- **WHEN** an engine candidate has conflicting or ambiguous workspace ownership evidence under `workspace-only`
- **THEN** the projection SHALL exclude it from selected workspace membership or expose conflict diagnostics
- **AND** it SHALL NOT silently choose a workspace owner through related-mode inference

### Requirement: Workspace Session Projection MUST Scan Managed Codex Provider Homes

Workspace session catalog projection MUST include Codex sessions stored under managed provider-scoped homes in addition to disk/default and workspace-resolved Codex homes.

#### Scenario: managed provider home session appears after restart

- **WHEN** a Codex session history exists under an app-local managed provider home such as `codex-provider-homes/<providerId>/sessions`
- **AND** the app restarts with no live Codex runtime for that provider
- **AND** the session belongs to the requested workspace by source ownership evidence
- **THEN** the workspace session catalog MUST include that Codex session in the active strict projection
- **AND** the row MUST expose provider profile id, source, name, and availability when that metadata can be resolved

#### Scenario: disk Codex scan behavior remains compatible

- **WHEN** a Codex session history exists under the disk/default or workspace-resolved Codex home
- **THEN** the workspace session catalog MUST continue to discover it through the existing disk scan behavior
- **AND** the row MUST remain compatible with the disk provider profile `__disk__`

#### Scenario: provider home scan does not leak sessions across workspaces

- **WHEN** a managed provider home contains Codex sessions for multiple workspaces
- **AND** the user requests a strict projection for one workspace
- **THEN** only sessions whose source ownership evidence belongs to the requested workspace scope MUST enter the projection
- **AND** the provider home id alone MUST NOT be treated as workspace membership proof

#### Scenario: provider binding metadata is overlay not membership proof

- **WHEN** catalog metadata contains a Codex provider binding for a session id
- **BUT** no disk or provider-home source can prove the session exists for the requested workspace
- **THEN** the provider binding MUST NOT by itself create an active catalog row
- **AND** the projection MAY expose missing-on-disk or metadata-cleanup evidence according to existing catalog rules

#### Scenario: unavailable provider-backed history remains visible

- **WHEN** a Codex session is discovered under a managed provider home or has persisted provider binding
- **AND** the referenced provider profile no longer exists
- **THEN** the catalog row MUST remain visible when source ownership is proven
- **AND** provider availability MUST be projected as unavailable
- **AND** the row MUST NOT be rewritten to the disk provider profile

### Requirement: Workspace Session Projection MUST Report Codex Provider Source Completeness

Workspace session catalog projection MUST expose enough Codex source completeness evidence for consumers to distinguish authoritative absence from incomplete provider-home scans.

#### Scenario: provider home scan failure is partial evidence

- **WHEN** one or more managed provider homes cannot be enumerated or scanned
- **THEN** the Codex source status MUST indicate partial or degraded provider-home coverage
- **AND** consumers MUST NOT treat omitted managed-provider sessions as authoritative deletions

#### Scenario: authoritative absence requires all relevant Codex roots

- **WHEN** the backend reports that a Codex session is absent from the requested workspace projection
- **THEN** that absence MAY be treated as authoritative only if disk/default roots, workspace-resolved roots, and relevant managed provider-home roots were scanned or otherwise proven complete for the requested scope

#### Scenario: source completeness remains engine-specific

- **WHEN** Codex provider-home scanning is partial or degraded
- **THEN** the projection MUST preserve that Codex-specific degraded evidence
- **AND** completeness of another engine source MUST NOT hide the incomplete Codex provider-home state

### Requirement: Projection Mutations MUST Resolve Provider-Home Codex Sessions

Workspace session catalog mutations MUST support Codex sessions whose physical source is a managed provider home.

#### Scenario: folder assignment targets provider-home session

- **WHEN** the user assigns a folder to a Codex session discovered from a managed provider home
- **THEN** the mutation MUST resolve the target by stable workspace, engine, session id, and provider/source evidence
- **AND** the durable folder assignment MUST apply to the same session after refresh or restart

#### Scenario: archive and delete target one provider-backed session

- **WHEN** the user archives or deletes a Codex session discovered from a managed provider home
- **THEN** the operation MUST target that session's catalog/disk artifact according to existing delete/archive semantics
- **AND** it MUST NOT delete or mutate the entire provider home

#### Scenario: unresolved provider mutation fails visibly

- **WHEN** a mutation targets a provider-backed Codex session but the backend cannot resolve the source or metadata target safely
- **THEN** the mutation MUST fail with a user-visible diagnostic
- **AND** it MUST NOT silently apply the mutation to a disk-profile session with the same id

### Requirement: Workspace Projection MUST Preserve Continuation Origin And Family

Session catalog metadata 与 frontend projection MUST 暴露
`provider-continuation` Origin、`familyId`、`familyRootSessionId`、
`lineageParentSessionId`、`lineageKind` 与 `lineageDepth`。

#### Scenario: continuation inherits source family

- **WHEN** 来源 Session 已有 authoritative Conversation Family
- **THEN** Continuation MUST 继承相同 `familyId` 与 `familyRootSessionId`
- **AND** `lineageParentSessionId` MUST 指向来源且 depth 增加一

#### Scenario: legacy root receives deterministic family

- **WHEN** 来源 Native Session 没有 authoritative lineage metadata
- **THEN** 系统 MUST 以来源 stable session key 建立独立 Family
- **AND** MUST NOT 按标题、时间或内容相似度猜测血缘

### Requirement: Provider Continuation MUST Remain A Top-Level Sidebar Session

Provider Continuation MUST 显示“供应商续接” Origin 标签和目标 Engine/Provider，并提供来源
导航；MUST NOT 设置 `parentThreadId`、进入 Subagent tree 或显示“子代理”。

#### Scenario: continuation renders at top level

- **WHEN** Sidebar 投影一个 Provider Continuation
- **THEN** row MUST 位于顶层并显示“供应商续接”
- **AND** MUST NOT 因 `lineageParentSessionId` 嵌套到来源下面

#### Scenario: deleted source does not delete continuation

- **WHEN** 来源 Session 被删除或归档
- **THEN** Continuation MUST 保持可见且可独立恢复
- **AND** 来源导航 MUST 显示不可用而不是级联删除

### Requirement: Conversation Family MAY Form A Presentation-Only Sidebar Group

Sidebar MUST be allowed to place visible top-level Sessions with the same authoritative `familyId` into one contiguous presentation group while preserving every member as an independent top-level Session. The presentation group MUST NOT create runtime ownership, change canonical identity, or reuse Subagent tree semantics.

#### Scenario: visible continuation family becomes contiguous

- **WHEN** one Sidebar scope contains at least two visible top-level Sessions with the same authoritative `familyId`
- **AND** at least one member is explicitly a `provider-continuation`
- **THEN** the projection MUST place those visible Family members contiguously
- **AND** it MUST preserve their existing relative order inside the Family block
- **AND** the block MUST occupy the position of its first visible member in the original list

#### Scenario: legacy source without family metadata joins its continuations

- **WHEN** visible Provider Continuations share an authoritative `familyId`
- **AND** their `sourceSessionId`, `lineageParentSessionId`, or `familyRootSessionId` exactly matches a visible legacy source Session canonical id in the same Sidebar partition
- **AND** the source Session does not carry its own `familyId`
- **THEN** the projection MUST include that source root block in the same presentation group
- **AND** the visible member count MUST include the source Session
- **AND** it MUST preserve the source Session's independent top-level identity

#### Scenario: ambiguous source claim fails open

- **WHEN** one visible source Session without `familyId` is claimed by more than one distinct authoritative Family
- **THEN** the projection MUST leave that source outside all Family boundaries
- **AND** it MUST NOT resolve the conflict using title, timestamp, Provider, content, prefix, or proximity

#### Scenario: family grouping preserves top-level identity

- **WHEN** a source Session and its Provider Continuations are visually grouped
- **THEN** every member MUST remain independently selectable, restorable, pinnable, and addressable by its own canonical identity
- **AND** no member MUST gain `parentThreadId`, Subagent depth, tree expander, `aria-expanded`, or a `子代理` label because of the grouping

#### Scenario: subagent subtree remains atomic

- **WHEN** a Family member also owns visible runtime Subagent descendants
- **THEN** the member and its existing Subagent subtree MUST move as one root block during Family ordering
- **AND** the Subagent descendants MUST retain their existing ownership, depth, identity, and collapse behavior
- **AND** the Family member count MUST count only top-level Family Sessions

#### Scenario: uncertain family metadata fails open

- **WHEN** fewer than two visible members can be established by a shared authoritative `familyId` or an exact authoritative source/lineage reference
- **OR** a candidate contains an unsupported non-empty `lineageKind`
- **THEN** Sidebar MUST keep the affected rows in their ordinary top-level projection
- **AND** it MUST NOT infer grouping from title, timestamp, Provider, content, or proximity

#### Scenario: projection respects list partitions

- **WHEN** related Sessions are separated by workspace, worktree, session folder, pinned state, visibility filter, or unloaded pagination
- **THEN** grouping MUST operate only on the members visible inside each current list partition
- **AND** it MUST NOT move a row across those boundaries

### Requirement: Catalog Projection MUST Recover Legacy Codex Continuation Keys

Workspace session catalog projection MUST 将历史
`codex:<workspace>:codex:<thread-id>` continuation metadata key 仅作为
`codex:<workspace>:<thread-id>` 的 legacy alias 读取。Projection MUST 依据 exact
`sourceSessionId` chain 恢复 authoritative Family identity 与 depth，MUST NOT 根据标题、时间、
Provider 或邻近关系猜测。

#### Scenario: legacy duplicated key matches a raw Codex row

- **WHEN** raw catalog row `<thread-id>` 只有 duplicated legacy continuation key
- **THEN** row MUST 获得 `provider-continuation` origin、source lineage 与 Provider snapshot
- **AND** catalog MUST NOT 额外生成 missing/recovery Session

#### Scenario: two legacy continuations form a chain

- **WHEN** target B 的 exact `sourceSessionId` 指向 target A，且 A 指向同一 legacy root
- **THEN** projection MUST 为 A 与 B 派生相同 `familyId` 和 `familyRootSessionId`
- **AND** B 的 `lineageDepth` MUST 等于 A depth 加一
- **AND** Sidebar MUST 通过既有 Family fence 连续展示可见成员

#### Scenario: legacy lineage contains a cycle

- **WHEN** exact source references 形成 cycle 或无法安全解析
- **THEN** catalog MUST fail open 为普通 top-level projection 或保留 stored metadata
- **AND** MUST NOT 通过内容相似度猜测 Family

### Requirement: Workspace Session Projection MUST Discover Managed Kimi Provider Homes

Workspace session catalog projection MUST include Kimi sessions stored under app-local managed provider homes in addition to the configured/default Kimi home when no explicit custom history home is supplied.

#### Scenario: managed Kimi session appears after restart

- **WHEN** a Kimi session exists under `kimi-provider-homes/<providerId>/session_index.jsonl`
- **AND** the application restarts without an in-memory provider home configuration
- **AND** the index entry `workDir` belongs to the requested workspace
- **THEN** the workspace session catalog MUST include that Kimi session
- **AND** the row MUST expose `providerProfileId` when the provider-home id is available

#### Scenario: managed Kimi history remains workspace-scoped

- **WHEN** managed Kimi provider homes contain sessions for multiple workspaces
- **AND** the catalog requests one workspace
- **THEN** only entries whose `workDir` matches that workspace or a child path MUST be returned
- **AND** provider-home membership alone MUST NOT prove workspace ownership

### Requirement: Kimi Catalog Source Completeness MUST Preserve Provider-Home Failures

Kimi catalog source status MUST distinguish a complete empty scan from an incomplete managed provider-home enumeration.

#### Scenario: provider-home enumeration fails

- **WHEN** the managed Kimi provider-home parent exists but cannot be enumerated
- **THEN** the Kimi source MUST be reported as partial or degraded
- **AND** omitted managed-provider sessions MUST NOT be treated as authoritative deletion evidence

### Requirement: Kimi History Operations MUST Use the Discovered Provider Home

Kimi list, load, and delete operations MUST resolve a session through the same provider-home set and MUST operate on the root where the session was discovered.

#### Scenario: discovered managed session can be loaded and deleted

- **WHEN** a managed Kimi session is returned from provider-home discovery
- **THEN** loading it MUST read that provider home's `wire.jsonl`
- **AND** deleting it MUST remove only that session directory and its matching index entry
- **AND** the provider home and unrelated sessions MUST remain intact
