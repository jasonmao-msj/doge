## ADDED Requirements

### Requirement: Custom prompts list MUST preserve cache on soft-cancel

当 `startupOrchestrator` 因 workspace 切换、force-enter 等原因以 `stale` 或 `cancelled` 结算 `prompts_list` 任务时，系统 MUST 保留已有自定义提示词列表，MUST NOT 将列表替换为空数组，MUST NOT 将该次 settle 记为「权威成功拉取」。

#### Scenario: soft-cancel keeps existing prompts

- **WHEN** 内存中已有至少一条 custom prompt
- **AND** 随后一次 `prompts_list` 编排 settle 原因为 `stale` 或 `cancelled`
- **THEN** 内存 prompts 列表 MUST 仍包含原有条目
- **AND** 系统 MUST NOT 仅因该次 soft-cancel 展示「暂无提示词」

#### Scenario: soft-cancel does not block later successful refresh

- **WHEN** 一次 `prompts_list` settle 原因为 `stale` 或 `cancelled`
- **AND** 之后发生 on-demand 成功刷新（创建提示词、设置页刷新、`!` 空态 revalidate 或事件触发）
- **THEN** 系统 MUST 能用后端返回的最新列表更新内存 prompts

### Requirement: Custom prompts list MUST NOT stamp success on hard failure

当 `prompts_list` 因 `timeout` 或其他非 soft-cancel 的 fallback/异常失败时，系统 MUST NOT 将「已成功拉取」标记写入该 workspace，MUST 允许后续刷新重试。若失败前内存已有列表，MUST 保留该列表。

#### Scenario: timeout with empty cache remains retryable

- **WHEN** 当前 workspace 内存 prompts 为空
- **AND** `prompts_list` 以 `timeout`（或等价硬失败）settle
- **THEN** 系统 MUST NOT 将该 workspace 标记为权威成功拉取
- **AND** 后续 on-demand / 创建 / 事件 / `!` 空态 revalidate MUST 仍可发起新的 `prompts_list`

#### Scenario: timeout with non-empty cache preserves prompts

- **WHEN** 内存中已有 custom prompts
- **AND** 一次刷新以 `timeout` settle
- **THEN** 内存列表 MUST 保留原有条目
- **AND** UI MUST NOT 因该次失败瞬间清空为「暂无提示词」

### Requirement: Authoritative empty list remains empty UI

当 `prompts_list` **成功**返回空数组（无 fallback reason）时，系统 MUST 将内存列表更新为空，并在 `!` 菜单展示空态入口（「暂无提示词」+「创建提示词」）。

#### Scenario: true empty workspace

- **WHEN** 后端成功返回 `[]` 且无编排 fallback reason
- **THEN** `!` 补全 MUST 展示空态与创建入口
- **AND** MUST NOT 无限 revalidate 打满 IPC（同一次 in-flight 共享；权威空成功后可不强制每次键入重拉）

### Requirement: Concurrent refreshPrompts MUST share in-flight work

同一 workspace 上重叠的 `refreshPrompts` 调用 MUST 共享同一次 in-flight `prompts_list` 工作，后到的调用 MUST await 同一结果，MUST NOT 静默丢弃导致调用方误以为已刷新。

#### Scenario: create awaits overlapping prewarm

- **WHEN** idle-prewarm 的 `refreshPrompts` 仍在进行
- **AND** 创建提示词路径 `await refreshPrompts()`
- **THEN** 创建路径 MUST 等待进行中的刷新完成或与其合并为同一 in-flight
- **AND** MUST NOT 因 `inFlight` 早退而跳过列表收敛

### Requirement: Bang menu empty state MUST revalidate on demand

Composer `!` 提示词补全在**当前内存 prompts 为空**且 workspace 可用时，MUST 触发一次 on-demand 列表刷新；若刷新成功返回非空列表，当次或紧随其后的补全结果 MUST 能展示这些提示词（通过 refresh 返回值或随后的 props 更新），不得要求用户先「再创建一条」才能看到已有提示词。

#### Scenario: empty memory recovers existing disk prompts via bang

- **WHEN** 磁盘上已有 custom prompts，但内存列表因先前 soft-failure 为空
- **AND** 用户触发 `!` 补全
- **THEN** 系统 MUST 发起 on-demand `prompts_list`（或等价 refresh）
- **AND** 成功后补全列表 MUST 包含磁盘上的既有提示词（无需用户新建）

#### Scenario: non-empty memory does not force revalidate

- **WHEN** 内存 prompts 已非空
- **AND** 用户触发 `!` 补全
- **THEN** 系统 MUST 使用内存列表筛选展示
- **AND** MUST NOT 强制为每次 `!` 打开都发起新的 list IPC

### Requirement: Hard list failure MAY surface a deduped toast

非 soft-cancel 的列表加载失败 MAY 以固定 id 的 error toast 提示用户（与 commands 列表不可用提示同级），同一失败窗口内 MUST 去重，避免刷屏。

#### Scenario: timeout toast is deduped

- **WHEN** `prompts_list` 连续多次以 `timeout` 失败
- **THEN** 用户可见的 error toast MUST 使用稳定 id 去重
- **AND** soft-cancel 失败 MUST NOT 弹出该 toast
