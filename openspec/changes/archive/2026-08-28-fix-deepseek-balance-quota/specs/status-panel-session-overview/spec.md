## ADDED Requirements

### Requirement: 会话概览额度卡 MUST 支持余额型 coding-plan 结果

会话概览额度渲染 MUST 将 `get_coding_plan_quota` 返回的余额型结果视为有效 coding_plan（或等价供应商额度）成功态：

- 当 `success=true` 且 `balance.items.length > 0` 时，即使 `windows` 为空，额度卡 MUST 进入可展示成功态。
- 前端 MUST 将 `balance.items` 映射为既有 credits 展示字段：`hasCredits=true`，`creditsBalance` 为各 `currency + totalBalance` 的可读拼接（默认形态如 `CNY 110.00`，多币种以分隔符连接）。
- 当 `windows` 为空且 `hasCredits=true` 时，额度卡 MUST NOT 渲染 coding-plan empty 占位文案。
- `isAvailable=false` 时仍可展示余额数字；MUST NOT 仅因 unavailable 将结果降级为 unsupported host。

#### Scenario: DeepSeek 余额成功无百分比窗口

- **WHEN** 某额度 entry 的 coding plan 输入为 `source=deepseek`、`success=true`、`windows=[]`、`balance.items` 非空
- **THEN** 概览额度卡 MUST 显示 credits 余额
- **AND** MUST NOT 显示 `codingPlanEmpty` 类空态文案
- **AND** MUST NOT 显示 `not a known coding-plan host` 类错误

#### Scenario: DeepSeek 查询失败

- **WHEN** coding plan 输入 `success=false` 且 error 描述鉴权或网络失败
- **THEN** 额度卡 MUST 展示 error 态
- **AND** MUST NOT 崩溃整个会话概览 section

#### Scenario: Shared 多卡之一为 DeepSeek 余额

- **WHEN** Shared 会话 `quotaEntries` 同时含 DeepSeek 余额成功 entry 与 MiniMax windows 成功 entry
- **THEN** 系统 MUST 分卡渲染
- **AND** DeepSeek 卡 MUST 显示 credits
- **AND** MiniMax 卡 MUST 显示百分比 windows

### Requirement: 额度成功条件 MUST 兼容 windows 或 balance

`buildSessionOverviewQuota`（或等价 viewModel）在判断供应商额度优先于 official_cli rateLimits 时，MUST 在以下任一成立时采用供应商结果：

1. `windows.length > 0`，或
2. `balance.items.length > 0`

在供应商结果成立时，MUST NOT 回落到 Codex 官方 rateLimits 窗口。

#### Scenario: Codex engine + DeepSeek provider 不用官方 rateLimits 冒充

- **WHEN** engine 为 `codex` 且 coding plan 为 DeepSeek balance 成功
- **AND** 本地存在 Codex account rateLimits 快照
- **THEN** 概览 MUST 展示 DeepSeek 余额
- **AND** MUST NOT 用 Codex official primary/secondary 百分比覆盖该卡
