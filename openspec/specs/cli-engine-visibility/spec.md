# cli-engine-visibility Specification

## Purpose

TBD - created by archiving change for `cli-engine-visibility`.

## Requirements

### Requirement: 设置页 CLI 导航 MUST 按用户意愿分组展示

「CLI配置管理」导航 MUST 将 CLI 分为「已启用」「未启用」「暂未开放」三组渲染。`supported: true` 且未被用户停用的 CLI MUST 归入「已启用」；`supported: true` 且已被用户停用的 CLI MUST 归入「未启用」；`supported: false` 的 CLI MUST 全部归入「暂未开放」。

#### Scenario: 默认全启用

- **WHEN** 用户从未操作过 CLI 开关（`disabledCliEngines` 为空）
- **THEN** 全部 supported CLI MUST 出现在「已启用」组
- **AND** 「未启用」组 MUST NOT 渲染

#### Scenario: 停用后落入未启用组

- **WHEN** 用户在某 supported CLI 行的「...」菜单选择「关闭启用」
- **THEN** 该 CLI MUST 从「已启用」组移入「未启用」组
- **AND** 该变更 MUST 持久化到 `AppSettings.disabledCliEngines`
- **AND** 「未启用」组 MUST 自动展开一次，给出可见归宿

#### Scenario: 启停操作收进 hover 菜单

- **WHEN** 用户未与行交互（无 hover / focus / 菜单打开）
- **THEN** supported CLI 行 MUST NOT 常驻展示启停控件
- **AND** hover / focus / 菜单打开时任一条件下「...」按钮 MUST 可见可点

#### Scenario: 未启用与暂未开放组默认折叠

- **WHEN** 用户打开「CLI配置管理」（初次挂载）
- **THEN** 「暂未开放」组 MUST 默认折叠
- **AND** 「未启用」组 MUST 默认折叠（即使挂载时已有停用项）
- **AND** 「已启用」组 MUST 默认展开

#### Scenario: 搜索时平铺

- **WHEN** 用户在搜索框输入过滤词
- **THEN** 导航 MUST 退回跨组平铺过滤
- **AND** MUST NOT 渲染组 header

### Requirement: CLI 开关 MUST 只控制可见性

停用 CLI MUST NOT 删除或改写该 CLI 的供应商配置、本地配置文件或会话数据。

#### Scenario: 停用后配置保留

- **WHEN** 用户停用某已配置供应商的 CLI
- **THEN** 该 CLI 的供应商配置 MUST 原样保留
- **AND** 用户点击「未启用」组中该 CLI 时 MUST 仍能打开其配置页编辑

#### Scenario: 重新启用后配置可用

- **WHEN** 用户重新启用此前停用的 CLI
- **THEN** 该 CLI MUST 回到「已启用」组
- **AND** 其既有配置 MUST 立即可用

### Requirement: composer 引擎选择器 MUST 隐藏已停用引擎

composer 的引擎选择器 MUST NOT 列出已被用户停用的引擎；当前会话正在使用的引擎不受停用影响。

#### Scenario: 停用引擎不出现在下拉

- **WHEN** 用户已停用某引擎对应 CLI
- **AND** 打开 composer 引擎选择器
- **THEN** 下拉列表 MUST NOT 包含该引擎

#### Scenario: 当前选中引擎兜底显示

- **WHEN** 当前会话引擎已被用户停用
- **THEN** 引擎选择器 MUST 仍显示该当前引擎值
- **AND** 该会话 MUST 继续正常工作

#### Scenario: 允许全部停用

- **WHEN** 用户停用全部 supported CLI
- **THEN** 系统 MUST 允许该状态
- **AND** MUST NOT 强制要求至少保留一个启用

### Requirement: Git commit message picker MUST derive visible engines from shared policy

GitDiff 与 GitHistory 的 commit message picker MUST 从 global engine registry 派生候选项，并同时应用 product execution policy 与用户 `disabledCliEngines`。Git feature MUST NOT 维护独立的 engine allowlist。

#### Scenario: 展示全部可执行且用户可见的 engines

- **WHEN** 用户打开 commit message generation menu
- **THEN** 单一面板展示 registry 中所有 product-enabled 且 user-visible engines
- **AND** 用户可先选择 language，再点击 engine 立即生成

#### Scenario: product-disabled 或 user-disabled engine 不可见

- **WHEN** engine 被 product execution policy 禁用，或存在于 `disabledCliEngines`
- **THEN** picker 不展示该 engine
- **AND** 若 last configuration 指向该 engine，“使用上次配置”不得执行

#### Scenario: picker 锚定生成按钮且保持 viewport 可达

- **WHEN** commit composer 位于 bottom 或 top placement
- **THEN** picker 分别在生成按钮上方或下方展开
- **AND** picker 与 trigger 右边缘对齐并保持 viewport padding
- **AND** enabled engines 与 generic extra items 可通过单一紧凑面板访问

#### Scenario: 所有 engines 均被用户关闭

- **WHEN** visibility filter 后没有可用 engine
- **THEN** picker 展示明确空状态
- **AND** 不提供可触发 generation 的 engine item

### Requirement: CLI Engine First-Install Defaults MUST Preserve Explicit Choices

When `disabledCliEngines` is absent, the system MUST default `grok`, `kimi`, and `opencode` to disabled while keeping `codex` and `claude` enabled. When the field exists, including an empty array, the stored value MUST remain authoritative and MUST NOT be rewritten during startup.

#### Scenario: first install uses product-curated engine defaults

- **WHEN** the application reads settings whose `disabledCliEngines` field is absent
- **THEN** Codex and Claude MUST appear in the enabled group
- **AND** Grok, Kimi, and OpenCode MUST appear in the disabled group

#### Scenario: stored choice remains authoritative

- **WHEN** settings contain any explicit `disabledCliEngines` value, including `[]`
- **THEN** the application MUST use that value unchanged
- **AND** it MUST NOT insert or remove engine ids during startup

### Requirement: Account Center SHALL Use A Subscription-First Two-Tab Information Architecture

Authenticated Account Center MUST expose exactly `subscription` and `usage` as its primary tabs. The subscription surface MUST directly render subscribed engine cards and MUST NOT require a second “my engines” page or an “overview” indirection.

#### Scenario: authenticated user opens Account Center

- **WHEN** a Token Matrix session is authenticated
- **THEN** Account Center MUST render `subscription` and `usage` as the primary tabs
- **AND** the subscription tab MUST directly render available subscribed engine cards

#### Scenario: user has no active subscription

- **WHEN** the authenticated account has no active engine subscription
- **THEN** the subscription tab MUST render the existing subscription acquisition state in place
- **AND** it MUST NOT navigate through an empty intermediate engines page
