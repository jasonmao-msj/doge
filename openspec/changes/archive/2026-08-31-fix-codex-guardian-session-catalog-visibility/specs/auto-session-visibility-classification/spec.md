# auto-session-visibility-classification Delta

## ADDED Requirements

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
