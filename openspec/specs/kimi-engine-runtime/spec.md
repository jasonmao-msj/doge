# kimi-engine-runtime Specification

## Purpose
TBD - created by archiving change add-kimi-engine. Update Purpose after archive.

## Requirements

### Requirement: Kimi Canonical Session Identity Convergence

Kimi realtime runtime SHALL keep one user-visible conversation while a new turn
transitions from a frontend pending alias to the canonical session identity emitted
by Kimi CLI.

#### Scenario: New Kimi turn starts before canonical identity is known

- **WHEN** frontend sends the first turn on a `kimi-pending-*` thread
- **THEN** backend SHALL NOT return a fabricated canonical `sessionId`
- **AND** the pending id SHALL remain a runtime alias until Kimi emits a real `session_*` id

#### Scenario: History discovers canonical session before realtime promotion

- **WHEN** sidebar history adds `kimi:<session_*>` before the pending turn receives its identity update
- **THEN** pending promotion SHALL merge runtime items and lifecycle state into the existing canonical row
- **AND** sidebar SHALL display exactly one row for the conversation

#### Scenario: Kimi turn reaches a terminal state after promotion

- **WHEN** `turn/completed`, `turn/error`, or `turn/stalled` arrives for the canonical Kimi thread
- **THEN** processing and active-turn state SHALL be settled for the canonical thread and any matching pending alias
- **AND** no non-interactive orphan row SHALL remain permanently running

#### Scenario: Pending realtime delta flushes after canonical promotion

- **WHEN** a Kimi text delta enters the realtime queue with a `kimi-pending-*` id
- **AND** the session is promoted before that queued operation reaches the reducer
- **THEN** the operation SHALL resolve the latest canonical alias before applying
- **AND** `ensureThread`, processing state, and message content SHALL target the canonical row
- **AND** the retired pending id SHALL NOT be recreated or preserved as an anchored residual

#### Scenario: Canonical Kimi history row is selected or deleted

- **WHEN** the user selects or deletes the converged `kimi:<session_*>` row
- **THEN** history load/delete SHALL use the real Kimi session id from `session_index.jsonl`
- **AND** the operation SHALL NOT target a fabricated UUID or pending alias

### Requirement: Kimi Identity Promotion MUST Survive Event Reordering

Kimi pending-to-canonical promotion MUST migrate items、processing、active turn、selection、title and live assistant text ownership as one logical-session transition.

#### Scenario: history arrives before resume hint

- **WHEN** canonical history row appears before pending runtime receives native session identity
- **THEN** both rows MUST converge to one logical session
- **AND** no message or processing state may be duplicated

#### Scenario: late delta arrives after promotion

- **WHEN** a queued delta targets the retired pending alias
- **THEN** it MUST update the canonical row
- **AND** pending state MUST not be recreated

### Requirement: Kimi Config Diagnostics MUST Distinguish Missing Corrupt And IO Failure

Kimi model/provider config loading MUST return structured `missing`、`loaded`、`malformed` or `io-error` status.

#### Scenario: config is missing

- **WHEN** Kimi config file does not exist
- **THEN** builtin fallback MAY load without an error

#### Scenario: config cannot be parsed

- **WHEN** the file exists but is malformed
- **THEN** the system MUST expose actionable diagnostics
- **AND** it MUST NOT represent the state as ordinary missing config

### Requirement: Kimi Provider Cleanup MUST Report Partial Success

Deleting a managed provider and cleaning namespaced Kimi config entries MUST report each durable outcome.

#### Scenario: managed provider deletes but config cleanup fails

- **WHEN** ccgui provider deletion succeeds and Kimi config write/rename fails
- **THEN** the result MUST be partial success with warning
- **AND** UI MUST identify possible residual config

### Requirement: Kimi Engine Governance MUST Cover Runtime History Lifecycle And Provider Paths

Kimi MUST participate in built-in engine branch scanning、capability parity、runtime/history/lifecycle/provider contract tests.

#### Scenario: new Kimi literal branch is added

- **WHEN** code adds a Kimi-specific business branch outside an approved adapter
- **THEN** the engine branch scanner MUST fail

### Requirement: Kimi Conversation Creation MUST Select A Provider Profile

系统 MUST 将 Kimi 供应商选择建模为新建会话的启动决策，而非仅为全局 provider 切换。

#### Scenario: local config.toml is the intentional default profile

- **WHEN** 用户打开新建 Kimi 会话入口的供应商子菜单
- **THEN** 选择器 MUST 包含代表本地 `~/.kimi-code/config.toml` 的默认项（`__local_config_toml__`）
- **AND** 选择该项 MUST 保持现有 Kimi 启动行为不变
- **AND** UI MUST 明确该项跟随 disk/global config，不承诺与全局切换隔离

#### Scenario: provider selection is persisted with the created thread

- **WHEN** 用户以选定的 managed provider 创建 Kimi 会话
- **THEN** 该 thread 的 state MUST 记录 provider profile id、source 与用户可见名称
- **AND** 该 thread 后续所有发送 MUST 使用持久化绑定而非当前菜单选择

#### Scenario: menu selection only affects the next new conversation

- **WHEN** 用户在新建会话菜单的供应商子菜单中勾选某个 provider
- **THEN** 系统 MUST 仅记忆该选择（localStorage）供下一次新建会话使用
- **AND** MUST NOT 改变任何已有会话的绑定
- **AND** MUST NOT 触发全局 `~/.kimi-code/config.toml` 写入

### Requirement: Kimi Provider MUST Take Effect Via Per-Provider Home Materialization

绑定 managed provider 的 Kimi 会话 MUST 通过注入 per-provider 物化的 `KIMI_CODE_HOME` 使供应商生效，而非改写全局 config.toml。

#### Scenario: managed provider home is materialized

- **WHEN** 绑定 managed provider 的 Kimi thread 发送消息
- **THEN** 后端 MUST 将该 provider 的配置物化为 `~/.ccgui/kimi-provider-homes/<provider-id>/config.toml`（含 `providers` / `models` / `default_model`，结构与全局物化一致）
- **AND** 物化文件 MUST 使用 owner-only 权限（0600）
- **AND** provider id MUST 经过路径安全校验（拒绝目录穿越与保留名）

#### Scenario: per-provider home is injected per turn

- **WHEN** 绑定 managed provider 的 Kimi thread 的某个 turn 启动 `kimi` 进程
- **THEN** 后端 MUST 注入 `KIMI_CODE_HOME` 指向该 provider 的物化 home
- **AND** MUST NOT 修改全局 `~/.kimi-code/config.toml`

#### Scenario: different providers run in parallel

- **WHEN** 同一 workspace 下存在绑定不同 managed provider 的多个 Kimi 会话
- **THEN** 后端 MUST 按 `workspace_id + provider_profile_id` 维度管理运行时 session
- **AND** 各会话的 `kimi` 进程 MUST 使用各自 provider 的 home

#### Scenario: provider-scoped runtime remains controllable

- **WHEN** provider-scoped Kimi session 正在运行且用户中断 turn、关闭 workspace 或应用退出
- **THEN** runtime manager MUST 通过 workspace + provider-aware lookup 找到并清理真实 process owner
- **AND** cleanup failure MUST 显式传播并保留 owner 供诊断/重试

#### Scenario: missing provider fails the send with a clear error

- **WHEN** 绑定指向的 provider id 在 `~/.ccgui/config.json` 中已不存在
- **THEN** 该次发送 MUST 以包含 provider 标识的错误失败
- **AND** MUST NOT 静默回退到其他供应商

#### Scenario: global switch leaves managed-bound sessions untouched

- **WHEN** 用户在设置页切换全局 Kimi provider（触发 `~/.kimi-code/config.toml` 写入）
- **THEN** 已有 managed per-session 绑定的 Kimi 会话的后续发送 MUST 继续使用其物化 home
- **AND** 无绑定或 `__local_config_toml__` 会话 MUST 跟随新的全局配置

### Requirement: Kimi Turn Interrupt MUST Be Owner-Scoped

Kimi turn-specific interrupt MUST 只改变真实拥有目标 turn child 的 runtime 状态；未命中的 provider runtime MUST 保持运行状态。

#### Scenario: interrupt targets one of two provider runtimes

- **WHEN** 同一 workspace 的 provider A 与 provider B runtime 均在运行，用户中断 provider A 的 turn
- **THEN** provider A 的目标 child MUST 被终止
- **AND** provider B MUST NOT 被标记 interrupted 或把正常完成误报为 `Session stopped.`

#### Scenario: targeted kill fails

- **WHEN** Kimi turn child 的 kill 返回错误
- **THEN** active process registry MUST 保留该 child owner
- **AND** error MUST 向 manager/command caller 传播

### Requirement: Kimi Provider Home Materialization MUST Be Secret-Safe And Concurrent

Kimi provider TOML materialization MUST 对同一路径串行化，并保证包含 API key 的 temp file 从创建瞬间起 owner-only。

#### Scenario: Unix temp file contains provider secret

- **WHEN** 系统创建包含 API key 的 provider TOML temp file
- **THEN** temp file MUST 在创建时即使用 0600 mode
- **AND** MUST NOT 先以默认可读权限写入后再 chmod

#### Scenario: concurrent materialization targets one provider

- **WHEN** 两个 turn 并发物化同一 provider home
- **THEN** writer MUST 通过同一路径 file lock 串行化 read-render-replace
- **AND** 最终 config.toml MUST 完整可解析且不存在 replace race

#### Scenario: rendered content is unchanged

- **WHEN** provider home 已包含完全相同的 TOML
- **THEN** materializer MUST 避免不必要的 replace
- **AND** Unix final file mode MUST 仍为 0600

### Requirement: Managed Kimi History MUST Remain Restart-Compatible

Managed Kimi runtime history MUST remain readable after restart even when provider launch state is reconstructed lazily and the global engine configuration has no single `home_dir`.

#### Scenario: force refresh finds a managed Kimi session

- **WHEN** a managed Kimi session was created before restart
- **AND** its history remains under the app-local provider home
- **AND** the user invokes force refresh
- **THEN** the returned session list MUST contain that session
- **AND** the session MUST retain its Kimi engine identity

#### Scenario: explicit custom home remains isolated

- **WHEN** a Kimi history API receives an explicit custom home
- **THEN** it MUST scan only that home
- **AND** it MUST NOT implicitly scan unrelated managed provider homes
