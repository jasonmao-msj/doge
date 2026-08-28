# engine-per-session-provider-binding Specification

## Purpose

定义引擎无关的 per-session 供应商绑定契约：新建会话时可选定供应商，绑定随 thread 持久化，该 thread 后续所有 turn 按绑定路由，同一 workspace 下不同绑定的会话可并行使用不同供应商。

## Requirements

### Requirement: Per-Session Provider Binding MUST Be Recorded And Resolvable

系统 MUST 将 managed provider 绑定建模为会话级 launch configuration（而非全局切换），并在发送消息时按固定优先级解析生效供应商。

#### Scenario: resolution priority

- **WHEN** 后端为某个 thread 的一次发送解析供应商
- **THEN** 解析优先级 MUST 为：send 参数携带的 managed `providerProfileId` > catalog metadata 中该 thread 的持久化 managed binding > 无绑定/default
- **AND** 无绑定时 MUST 保持变更前的行为（Claude 走全局 `~/.claude/settings.json`，Kimi 走全局 `~/.kimi-code/config.toml` / 引擎默认 home）

#### Scenario: Claude runtime model is resolved against bound profile catalog

- **WHEN** Claude managed-bound thread 发送消息且携带 model / model catalog entry 选择
- **THEN** 系统 MUST 使用 **该 thread 绑定 profile** 的 model catalog（及 profile env model 槽）解析最终 runtime model
- **AND** MUST NOT 使用其它 profile 或全局脏 mapping 残留作为 `--model`
- **AND** 解析失败时 MUST fail closed 或 repair 到绑定 profile 默认 runtime，不得静默发送跨供应商模型名

### Requirement: Parallel Sessions With Different Providers MUST Be Isolated

同一 workspace 下，绑定不同供应商的会话 MUST 并行运行且互不影响。
（保持既有 scenario；补充 create-menu 入口不得破坏该隔离。）

#### Scenario: two Claude threads with different providers

- **WHEN** 同一 workspace 下同时存在绑定 managed provider A 的 Claude 会话与绑定 managed provider B（或本地配置）的 Claude 会话
- **THEN** 两个会话各自的 turn 进程 MUST 仅注入各自绑定对应的供应商配置
- **AND** 任一会话的发送 MUST NOT 修改全局 `~/.claude/settings.json`

#### Scenario: two Kimi threads with different providers

- **WHEN** 同一 workspace 下同时存在绑定不同 managed provider 的 Kimi 会话
- **THEN** 每个会话的 `kimi` 进程 MUST 以其绑定 provider 物化的独立 `KIMI_CODE_HOME` 启动
- **AND** 任一会话的发送 MUST NOT 修改全局 `~/.kimi-code/config.toml`

#### Scenario: Kimi workspace control reaches every provider runtime

- **WHEN** 同一 workspace 下存在多个 provider-scoped Kimi runtime，用户执行 workspace interrupt、turn interrupt、remove 或 shutdown
- **THEN** manager MUST 定位并控制该 workspace 下的全部 matching runtime
- **AND** provider-scoped map key MUST NOT 使旧 workspace-only control path 漏掉 child process owner

#### Scenario: global switch does not reroute bound threads

- **WHEN** 用户在设置页切换全局供应商（`vendor_switch_claude_provider` / `vendor_switch_kimi_provider`）
- **THEN** managed-bound 会话的后续发送 MUST 继续使用其绑定供应商
- **AND** 无绑定或 local/default 会话 MUST 跟随新的全局默认

#### Scenario: create-menu binding preserves isolation

- **WHEN** 用户通过新建会话菜单先后为同一 engine 创建绑定 A 与绑定 B 的两个 native 会话
- **THEN** 两会话的 thread binding MUST 分别记录 A 与 B
- **AND** 后续全局设置页 switch 到 C MUST NOT 改写 A/B 已记录的 managed binding

### Requirement: Child Threads MUST Inherit Parent Binding

通过 fork（Claude）或 continue（Kimi）产生的子会话 MUST 继承父会话的供应商绑定。

#### Scenario: fork inherits binding

- **WHEN** 用户 fork 一个绑定了供应商的 Claude thread
- **THEN** 新 child thread 的 thread state MUST 拷贝父 thread 的 `providerProfileId` / `providerProfileSource` / `providerProfileName`
- **AND** child thread 的发送 MUST 按继承的绑定路由

#### Scenario: sidebar shows provider label

- **WHEN** 侧边栏渲染绑定了 managed provider 的 thread
- **THEN** 该 thread MUST 显示其绑定的供应商名称标签（与 Codex 现有标签行为一致）

### Requirement: Canonical Provider Binding MUST Be Persisted At Identity Promotion

当 runtime 首次暴露 canonical session identity 时，系统 MUST 将该 turn 已解析的 managed provider binding 持久化到 canonical session key，而不能只依赖 pending alias、parent id 或下一次 send。

#### Scenario: Kimi first turn promotes pending identity

- **WHEN** managed-bound Kimi turn 从 `kimi-pending-*` 收到真实 `SessionStarted.session_id`
- **THEN** backend MUST 幂等写入该 canonical Kimi session 的 provider binding
- **AND** 首轮结束后立即重启仍 MUST 从 catalog 恢复 provider metadata

#### Scenario: Claude fork receives child identity

- **WHEN** managed-bound Claude fork 的 child canonical session id 首次出现
- **THEN** backend MUST 将继承的 provider binding 写入 child canonical key
- **AND** MUST NOT 只更新 parent binding

#### Scenario: canonical binding persistence fails

- **WHEN** canonical binding metadata 写入失败
- **THEN** backend MUST 输出包含 engine、workspace 与 session identity 的可诊断错误
- **AND** MUST NOT 把失败报告成持久化成功

### Requirement: Provider Catalog Failure MUST Not Silently Change Provider

新会话入口读取 provider catalog 失败、model catalog 失败或 remembered managed provider 不可解析时，系统 MUST fail closed 或要求用户显式选择，不得静默改用 local/default provider。

#### Scenario: remembered managed provider is absent from loaded catalog

- **WHEN** localStorage 记住 managed provider A，但当前 catalog 未返回 A
- **THEN** 新会话菜单 MUST 保留 A 的不可用选择语义或阻止创建
- **AND** MUST NOT 自动选中 local/default 并继续创建

#### Scenario: provider catalog request fails

- **WHEN** Claude、Codex 或 Kimi provider catalog 加载失败
- **THEN** UI MUST 显示可诊断错误
- **AND** 用户显式选择 local/default 前 MUST NOT 把 remembered managed selection 解释为 local/default

#### Scenario: bound provider model catalog fails

- **WHEN** 新会话已绑定 managed provider A，但 provider A 的模型配置缺失、损坏或不可读取
- **THEN** 模型菜单 MUST 保留 last-good catalog 或显示可诊断错误
- **AND** MUST NOT 展示 local/default provider 的 configured models 作为成功结果

### Requirement: Claude Runtime Ownership MUST Be Provider-Scoped

Claude runtime manager MUST use workspace owner and provider profile identity as the runtime ownership boundary while preserving shared Claude history storage.

#### Scenario: two managed providers run in parallel

- **WHEN** 同一 workspace 下 provider A 与 provider B 绑定的 Claude threads 并行发送
- **THEN** 系统 MUST 使用两个不同的 Claude runtime owners
- **AND** 每个 child process MUST 只接收自己 provider 的 environment
- **AND** session id、active turn、pending user input、approval state 与 child ownership MUST NOT 在两个 runtime 间共享

#### Scenario: local and managed provider run in parallel

- **WHEN** local/default Claude thread 与 managed provider thread 并行发送
- **THEN** local runtime MUST NOT 接收 managed provider env
- **AND** managed runtime MUST NOT 写入或切换 `~/.claude/settings.json`
- **AND** 两个 runtime MUST 能独立 interrupt 和完成

#### Scenario: secondary spawn inherits provider launch context

- **WHEN** managed Claude turn 触发 legacy flag retry、auto-compact、AskUserQuestion resume、approval resume 或其他 same-turn child restart
- **THEN** 每个 secondary child MUST 继承原 turn 的 provider launch context
- **AND** MUST NOT fallback 到 local/default environment

#### Scenario: workspace cleanup covers all Claude providers

- **WHEN** 用户 interrupt workspace、remove workspace、切换 Claude binary 或关闭 host
- **THEN** manager MUST 找到该 workspace 的全部 provider-scoped Claude runtimes
- **AND** cleanup failure MUST 保留未确认终止的 child owner并返回或记录可诊断错误

#### Scenario: turn interrupt targets one runtime

- **WHEN** 用户按 `turnId` 中断某个 Claude turn
- **THEN** manager MUST 只中断持有该 turn 的 provider runtime
- **AND** 其他 provider runtime 的并行 turn MUST 继续运行

#### Scenario: missing provider fails closed

- **WHEN** persisted thread binding 指向已删除或非法的 managed Claude provider
- **THEN** send MUST 返回包含 provider id 的 contextual error
- **AND** manager MUST NOT create or reuse local runtime as fallback

#### Scenario: legacy provider env scalar values are normalized

- **WHEN** imported 或 legacy managed Claude provider 的 `settingsConfig.env` 包含 JSON string、number 或 boolean scalar
- **THEN** shared provider resolver MUST 将 number 与 boolean 按 JSON scalar 语义规范化为 process env string
- **AND** provider-scoped model catalog 与 primary/secondary child launch MUST 使用同一份 normalized environment
- **AND** `null`、object 或 array value MUST 返回包含 provider id 与 env key 的 contextual error
- **AND** invalid composite value MUST NOT fallback 到 local/default runtime 或 global model catalog

#### Scenario: managed provider overrides user settings without global mutation

- **GIVEN** `~/.claude/settings.json` 包含另一供应商的 `ANTHROPIC_*` environment
- **WHEN** 绑定 managed provider 的 Claude turn 启动 primary child 或 same-turn resume child
- **THEN** child MUST 同时接收 normalized provider process env 与 command-line `--settings` override
- **AND** command-line settings MUST 包含当前 provider 的 auth、base URL 与 model environment
- **AND** Local settings 中的同名 environment MUST NOT 覆盖当前 provider
- **AND** secret MUST NOT 直接出现在 process arguments、日志或 diagnostic payload
- **AND** private settings artifact MUST 在 turn attempt 结束后清理
- **AND** local/default turn MUST NOT 创建或传入 managed settings override

### Requirement: Provider Continuation MUST Own A New Provider Binding

Provider Continuation 的目标 Session MUST 持久化用户选择的 Engine + Provider Profile
binding；该 binding 与来源 Session 独立，Provider 不可用时 MUST fail closed。

#### Scenario: destination binding differs from source

- **WHEN** Provider A 来源成功续接到 Provider B
- **THEN** 新 Session binding MUST 指向 Provider B
- **AND** 来源 Session binding MUST 保持 Provider A

#### Scenario: destination provider disappears

- **WHEN** prepared operation 指向的 managed Provider 在 execute 前不可用
- **THEN** operation MUST 保留 prepared/retry state
- **AND** MUST NOT 回退到 local/default 或来源 Provider

### Requirement: Native Sidebar Create Menu MUST Bind Selected Provider For Launch

系统 MUST 将 workspace 侧边栏「新建会话」菜单中的供应商选择建模为 **启用启动决策**（下一会话的 L2 launch binding），而不是可有可无的 UI 勾选。

#### Scenario: select managed provider then create session

- **WHEN** 用户在新建会话菜单右侧选中某 engine 的 managed provider P，再点击左侧对应 CLI 入口创建会话
- **THEN** 前端 MUST 调用创建路径并携带 `providerProfileId = P.id` 与完整 `providerProfile` 元数据（至少 id/name/source）
- **AND** 新建 thread 的内存/状态 MUST 记录同一 managed binding
- **AND** 该会话后续首发 `engine_send_message` MUST 携带同一 `providerProfileId`（从 thread state 读取），MUST NOT 静默改用全局 current-only 路径

#### Scenario: select local or disk sentinel profile

- **WHEN** 用户选择 Claude/Kimi/Grok/OpenCode 的 local profile 或 Codex disk profile
- **THEN** 创建路径 MUST 遵循既有 sentinel 归一化（local → 无 managed 覆盖；disk → disk binding 规则）
- **AND** 行为 MUST NOT 注入其他 managed provider 的 env

#### Scenario: menu provider select does not create session alone

- **WHEN** 用户仅点击右侧供应商项（keep menu open）
- **THEN** 系统 MUST 更新该 engine 的 last-selected profile 记忆并更新选中态
- **AND** MUST NOT 仅因选择而创建 thread

#### Scenario: unavailable remembered provider blocks create

- **WHEN** 记忆中的 managed provider 已不存在于 catalog（unavailable）
- **THEN** 主入口创建 MUST 被阻止（不可用）
- **AND** MUST NOT fallback 到另一 provider 静默创建

### Requirement: Native Menu Enable-For-Launch MUST Sync Global Active Provider

新建菜单「选供应商」MUST 同步 L1 全局 active（配置页「使用中」），并同时写入 L2 创建记忆；会话发送仍以 thread binding 为准。

#### Scenario: sidebar provider pick enables settings isActive

- **WHEN** 用户在新建会话菜单中选择 Claude managed provider P
- **THEN** 前端 MUST 调用与设置页「启用」相同的 `switchClaudeProvider(P)`（或等价 switch）
- **AND** 配置页供应商列表在刷新后 MUST 将 P 显示为「使用中」
- **AND** 前端 MUST 仍记忆 P 供左侧 create 写入 thread `providerProfileId`

#### Scenario: bound sessions keep L2 after global enable from menu

- **WHEN** 已存在绑定 managed provider A 的会话，用户在菜单选择并启用 provider B
- **THEN** 会话 A 的 thread binding MUST 保持 A
- **AND** 后续新建会话 MUST 默认使用 B

### Requirement: Provider Continuation MUST Activate Destination Provider

用户在已有会话中通过「使用其他 Provider 继续」切换到目标 provider 后，系统 MUST 完成与新建菜单一致的启动设置。

#### Scenario: continuation success enables destination and applies target model

- **WHEN** Provider 续接成功并打开目标会话（例如 DeepSeek → Minimax-m3）
- **THEN** 系统 MUST 将 L1 `claude.current`（或对应引擎 current）设为目标 provider，使配置页显示「使用中」
- **AND** MUST NOT 盖写 `~/.claude/settings.json`
- **AND** MUST 记忆目标 provider 供后续新建
- **AND** MUST 将续接目标 model/effort 应用到新会话 composer 选择，避免仍显示来源会话模型

### Requirement: Switching Active Session MUST Adapt UI To Session Creation Provider

切换/打开已有 native 会话时，UI 启动配置与模型目录 MUST 适配该会话 **创建时** 绑定的 provider；发送 MUST 仍使用该会话的 `providerProfileId`。

#### Scenario: switch between old claude sessions with different providers

- **WHEN** 用户从绑定 Minimax-m3 的 Claude 会话切到绑定 kimi-k3 的 Claude 会话
- **THEN** 系统 MUST 将 L1 current / 模型映射 / model catalog 切到 kimi-k3 对应配置
- **AND** 发送消息 MUST 仍使用 kimi-k3 的 thread.providerProfileId（创建时绑定）
- **AND** 再切回 Minimax 会话时 MUST 重新适配 Minimax 的映射与 catalog
- **AND** MUST NOT 因适配 L1 而改写任一会话已持久化的 providerProfileId

#### Scenario: composer channel chip follows session provider not stale override

- **WHEN** 用户切换到绑定 managed provider P 的 native Claude 会话
- **THEN** 模型选择器底栏渠道芯片 MUST 显示 P 的名称（如 Minimax-m3 / kimi-k3）
- **AND** MUST NOT 因上一会话的渠道预览覆盖（profileOverrides）或 catalog 首项回退而显示错误供应商名（如 DeepSeek）

> **Note**：Shared Session 渠道→模型切换见同 change 下 `shared-execution-target` delta（`selectedNextTarget` 路径，非 thread L2 binding）。

### Requirement: Codex Session Model Fallback MUST Follow Bound Provider

Codex new-session creation and model-omitted sends MUST resolve their fallback model from the bound provider profile. Provider display names, including `Kimi`, MUST remain opaque labels and MUST NOT influence engine routing.

#### Scenario: managed Codex provider creates a session

- **WHEN** 用户为 Codex engine 选择 managed `providerProfileId=A`
- **THEN** backend MUST start provider A's Codex runtime
- **AND** `thread/start.model` MUST use provider A's configured default model
- **AND** it MUST NOT use the workspace disk/global Codex model

#### Scenario: managed Codex provider has no configured default model

- **WHEN** provider A 的 `configToml` 没有 non-empty top-level `model`
- **THEN** `thread/start` MUST omit `model`
- **AND** runtime MUST resolve its own provider default
- **AND** backend MUST NOT substitute the disk/global model

#### Scenario: provider profile is named Kimi

- **WHEN** Codex managed provider profile 的 display name 为 `Kimi`
- **THEN** routing MUST remain `engine=codex` with provider A's id
- **AND** it MUST NOT invoke or classify the session as Kimi CLI

### Requirement: Codex Create-Session Transport Failure MUST Recover Without Raw OS Error

Codex create-session MUST treat a closed app-server pipe as a recoverable runtime disconnect and retry once inside the same provider identity.

#### Scenario: first thread start hits broken pipe

- **WHEN** selected Codex provider runtime returns `Broken pipe` during the first `thread/start`
- **THEN** backend MUST clean/reacquire the same provider runtime
- **AND** retry `thread/start` once with the same `providerProfileId`
- **AND** it MUST NOT fall back to `__disk__`

#### Scenario: pipe disconnect persists

- **WHEN** the same-provider retry also returns a pipe disconnect
- **THEN** backend MUST return the stable `[SESSION_CREATE_RUNTIME_RECOVERING]` error contract
- **AND** frontend MUST show a recoverable notice instead of native `alert`
- **AND** user-facing copy MUST NOT contain `Broken pipe` or raw OS error codes

### Requirement: Local Session Provider Tags MUST Identify Disk Configuration

When session-list provider labels are enabled, local Codex and Claude Code sessions MUST render the stable technical tag `local` so users can distinguish disk-backed configuration from managed providers.

#### Scenario: Codex disk session is listed

- **WHEN** a Codex thread is bound to `__disk__`
- **THEN** its provider tag MUST display `local`
- **AND** it MUST NOT expose the internal profile name `codex-tui/default-config`

#### Scenario: Claude Code local session is listed

- **WHEN** a Claude Code thread is bound to `__local_settings_json__`
- **THEN** its provider tag MUST display `local`

### Requirement: Provider Configuration Badges MUST Use Consistent Semantics

The new-conversation provider selector MUST describe local/disk profiles and managed profiles with the same semantic labels across Claude Code, Codex, and Kimi CLI.

#### Scenario: local or disk provider row

- **WHEN** the selector renders Claude local `settings.json`, Codex disk/default config, or Kimi local `config.toml`
- **THEN** the badge MUST use the localized equivalent of `跟随全局配置`
- **AND** it MUST NOT use an engine-specific synonym such as `磁盘配置`

#### Scenario: managed provider row

- **WHEN** the selector renders a managed Claude Code, Codex, or Kimi provider
- **THEN** the badge MUST use the localized equivalent of `独立配置`
- **AND** it MUST NOT use an engine-specific synonym such as `自定义配置`

### Requirement: UI Selection MUST Repair When Bound Profile Catalog Changes

当 Native Claude 会话的绑定 profile 或该 profile 的 model catalog 变化后，composer 选中态 MUST 与新 catalog 对齐。

#### Scenario: foreign runtime after provider switch is repaired

- **WHEN** 用户将会话上下文切换到另一 managed Claude profile（含续接成功后的目标会话，或切到绑定不同 profile 的老会话）
- **AND** 当前 composer selection 的 runtime 不属于新 profile 的合法 model 集合
- **THEN** 系统 MUST 将 selection repair 为新 profile 默认 runtime 对应的 catalog entry
- **AND** 后续发送 MUST 使用 repair 后的 runtime

### Requirement: New-Session Defaults SHALL Prefer A Prepared Managed Account Provider

For a signed-in account with a successfully prepared and active supported engine entitlement, a newly created Codex or Claude session with no explicit provider selection MUST bind `doge-token-matrix` as its managed `providerProfileId`. The frontend MUST resolve the selected engine's model against that provider-scoped catalog before creation. This default applies only to new-session creation; existing bindings, explicit local/manual choices, Local Mode, signed-out state, inactive entitlement, and failed preparation MUST retain their previous behavior.

#### Scenario: eligible account creates a new managed session

- **WHEN** account onboarding has successfully prepared the active Codex entitlement and the user creates a new Codex session without choosing a provider
- **THEN** the creation target MUST carry `providerProfileId = "doge-token-matrix"`
- **AND** its model/catalog entry MUST be resolved from that provider's catalog
- **AND** it MUST NOT send a disk/local model id to the managed provider

#### Scenario: explicit local choice remains authoritative

- **WHEN** the user explicitly selects a local/disk/manual provider for a new eligible engine session
- **THEN** the selected provider MUST remain the creation target
- **AND** Doge MUST NOT inject `doge-token-matrix`

#### Scenario: managed catalog cannot be resolved

- **WHEN** an eligible managed default has no usable provider-scoped catalog
- **THEN** creation MUST follow the existing unavailable/diagnostic behavior
- **AND** it MUST NOT silently retry through the local/disk provider
