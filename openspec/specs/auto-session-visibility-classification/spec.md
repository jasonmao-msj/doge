# auto-session-visibility-classification Specification

## Purpose
TBD - created by archiving change classify-auto-session-visibility. Update Purpose after archive.
## Requirements
### Requirement: Automatic Sessions SHALL Declare Cross-Engine Visibility Metadata
Any code path that creates a new session or thread on behalf of system automation SHALL declare automatic session metadata before or immediately after the canonical session identity is known. The metadata SHALL include purpose, visibility, owner feature, creation source, and optional auto-archive intent, and it SHALL use a stable key based on engine, owner workspace, and canonical session identity.

#### Scenario: Helper session records hidden metadata
- **WHEN** Prompt Enhancer, title generation, commit message generation, run metadata generation, or Project Map organizer creates a new session or thread
- **THEN** the system SHALL record automatic session metadata with `visibility=hidden`
- **AND** the metadata SHALL identify the feature-specific purpose such as `prompt-enhancer`, `title-generation`, `commit-message`, `run-metadata`, or `project-map-organizer`

#### Scenario: Traceable automatic execution records system-auto metadata
- **WHEN** Spec Hub apply, Project Map generation, review fallback, or PR question flow creates a new session or thread
- **THEN** the system SHALL record automatic session metadata with `visibility=system-auto`
- **AND** the metadata SHALL identify the feature-specific purpose such as `spec-hub-apply`, `project-map-generation`, `review`, or `pull-request-question`

#### Scenario: User-created session remains user-visible
- **WHEN** a user explicitly creates a conversation through normal send, new session action, `/new`, or `/clear`
- **THEN** the system SHALL classify the new session as `user-visible` or leave it unclassified so default projection remains user-visible
- **AND** automatic helper rules SHALL NOT move the session into `system-auto`

### Requirement: Automatic Session Visibility SHALL Be Engine Agnostic
Automatic session metadata SHALL be supported consistently for Claude, Codex, Gemini, OpenCode, and compatible remote/shared backend execution paths. Engine-specific events MAY provide compatibility signals, but catalog behavior SHALL depend on the generic visibility contract.

#### Scenario: Codex background hide maps to generic hidden metadata
- **WHEN** Codex emits `codex/backgroundThread` with action `hide`
- **THEN** the system SHALL treat the target thread as `visibility=hidden`
- **AND** this compatibility signal SHALL NOT be the only way to hide automatic sessions

#### Scenario: Sync engine helper can be hidden without background event
- **WHEN** an engine sync helper creates a persisted Claude, Gemini, OpenCode, or Codex session without emitting `codex/backgroundThread`
- **THEN** the system SHALL use the generic automatic session metadata to hide or group that session
- **AND** the session SHALL NOT appear at workspace root merely because no Codex-specific hide event exists

#### Scenario: Older remote daemon remains compatible
- **WHEN** a remote backend does not understand automatic session metadata in the request payload
- **THEN** the client or local backend SHALL still be able to record metadata after receiving a session or thread id
- **AND** failure to record metadata SHALL NOT fail the user-visible engine request

### Requirement: Automatic Session Visibility SHALL Survive Identity Transitions
Automatic session metadata SHALL migrate from pending or provisional thread ids to canonical session ids when engines promote or rename identities.

#### Scenario: Pending session is promoted
- **WHEN** an automatic session starts with a pending thread id
- **AND** the engine later emits a canonical session id or the frontend dispatches a pending-to-real rename
- **THEN** automatic session metadata SHALL migrate to the canonical stable key
- **AND** the pending metadata SHALL NOT leave a duplicate visible root row

#### Scenario: Canonical id is known immediately
- **WHEN** a session creation response returns a canonical thread or session id immediately
- **THEN** the metadata SHALL be written using that canonical identity
- **AND** catalog projection SHALL classify the row on the next refresh

#### Scenario: Failed automatic turn with known canonical id remains classified
- **WHEN** an automatic sync engine run obtains a canonical session or thread id
- **AND** the run later fails, times out after creating history, or returns a stream/runtime error
- **THEN** the system SHALL still record automatic session metadata using the known canonical identity
- **AND** the failed persisted session SHALL follow its declared `hidden` or `system-auto` projection instead of appearing at workspace root

### Requirement: Hidden Automatic Sessions SHALL Stay Out Of Normal Workspace Lists
Sessions classified as `hidden` SHALL NOT appear in normal Sidebar, Workspace Home, or Session Management active workspace lists. They MAY be exposed only through explicit debug or internal diagnostics surfaces.

#### Scenario: Hidden helper is omitted from root
- **WHEN** a hidden helper session exists in the workspace history source
- **THEN** normal workspace session projection SHALL omit it from root and user folders
- **AND** user-visible session counts SHALL NOT include it

#### Scenario: Hidden helper remains diagnosable
- **WHEN** a developer opens an explicit debug or internal diagnostics surface
- **THEN** the system MAY show hidden automatic session metadata
- **AND** that debug exposure SHALL NOT alter normal workspace projection

### Requirement: System-Auto Sessions SHALL Be Traceable Without Polluting Root
Sessions classified as `system-auto` SHALL remain accessible for audit and recovery, but SHALL NOT appear at workspace root. They SHALL be projected into a stable system-owned `system-auto` grouping or equivalent reserved system group.

#### Scenario: System-auto session appears under reserved group
- **WHEN** a system-auto session exists in the active workspace projection
- **THEN** the normal root session list SHALL exclude it
- **AND** the reserved `system-auto` group SHALL include it with its true owner workspace identity

#### Scenario: System-auto action routes by true owner
- **WHEN** a user archives, deletes, opens, or inspects a system-auto session from the reserved group
- **THEN** the action SHALL route through the session's true owner workspace and stable session key
- **AND** the system group SHALL NOT change ownership or strict project membership

### Requirement: Automatic Session Classification SHALL Be Additive And Backward Compatible
Automatic session metadata SHALL be additive. Missing metadata SHALL default to existing user-visible behavior unless a compatibility signal such as a known background hide event proves hidden helper intent.

#### Scenario: Existing unclassified user sessions stay visible
- **WHEN** a historical session has no automatic session metadata
- **THEN** the system SHALL preserve existing catalog projection behavior
- **AND** it SHALL NOT hide the session solely because its title resembles a prompt

#### Scenario: Failed metadata write does not break engine request
- **WHEN** the engine successfully creates or runs a session
- **AND** the automatic metadata overlay write fails
- **THEN** the engine request SHALL still return its primary result
- **AND** the failure SHALL be logged or surfaced diagnostically for follow-up


### Requirement: Background Sessions SHALL Be Excluded From Workspace Session Catalog Projection

Workspace session catalog 投影（本地 Tauri command 与 doge_daemon RPC 共享同一实现）在把 codex 磁盘会话映射为 catalog entry 时，SHALL 排除被归类为 background 的会话，使 catalog 的所有消费方（首屏 hydration、load-older、radar）与 `list_threads` 运行时路径保持同一可见性口径。

#### Scenario: Guardian session produces no catalog entry

- **WHEN** the workspace session catalog projection scans a Codex session whose summary carries `background_kind = "guardian-review"` (or `"subagent-helper"`)
- **THEN** the projection SHALL NOT emit a catalog entry for that session
- **AND** the frontend catalog merge SHALL receive no visible row for it

#### Scenario: Visible sessions remain unaffected in catalog

- **WHEN** a Codex session has no background classification (including visible collab `thread_spawn` subagents)
- **THEN** the catalog projection SHALL emit its entry unchanged

### Requirement: Daemon Remote list_threads SHALL Apply Background Filtering

Remote backend 模式下 doge_daemon 的 `list_threads` SHALL 在 live 透传与 local fallback 两条分支都过滤 background 会话，与本地统一路径口径一致。

#### Scenario: Daemon local fallback excludes background sessions

- **WHEN** the daemon serves `list_threads` from the local scan fallback
- **THEN** sessions classified as background SHALL be excluded from the response data

#### Scenario: Daemon live passthrough filters background thread entries

- **WHEN** the daemon proxies a successful live `thread/list` response
- **THEN** entries whose id belongs to a background-classified local session SHALL be removed
- **AND** entries matching the legacy prompt-prefix heuristic SHALL be removed
- **AND** if the local preview scan is unavailable, the daemon SHALL degrade to text-only filtering without failing the list request

