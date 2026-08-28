## Why

账号中心当前把订阅、额度、安全和引擎管理拆成多层页面：用户要在“概览”中再次进入“我的引擎”，同时看到重复标题与资料行；新安装还会默认展示并启用超出首期范围的引擎。对于以订阅为入口的小白用户，这些层级增加了理解和操作成本。

本变更将账号中心收敛为订阅与额度两个直接可达的页面，使已订阅引擎在同一上下文中可见、可进入使用，并让首次安装只露出 Codex 与 Claude 的默认选择。

## 目标与边界

- 账号中心只保留“订阅”“额度”两个主 Tab，删除重复的“账号”标题、资料行和“我的引擎”二次跳转。
- 订阅 Tab 直接展示已订阅的引擎卡片；显示名称支持原地编辑，密码修改成为 Header 常驻 icon + tooltip。
- 额度 Tab 沿用现有多订阅卡片与 daily heatmap，不改变 authority 的 quota/usage 计算。
- 首次安装仅默认启用 Codex、Claude；Grok、Kimi、OpenCode 保持可在“引擎管理”中手动启用，且不改写已有用户的 `disabledCliEngines`。

## 非目标

- 不删除 TOTP、身份绑定、全设备退出及 managed credential 等安全能力；本轮不将其扩展为新的主导航。
- 不修改 token2api 的订阅、支付、额度或 API 语义。
- 不改变已有用户已经保存的引擎启用/停用偏好。
- 不引入新的付费流程、套餐或引擎。

## What Changes

- 将 Account Center 的 `overview` 语义更名为 `subscription`，移除 `security` 主 Tab，并将订阅卡片嵌入账号中心。
- 将资料编辑改为显示名称原地编辑；密码修改由 Header `KeyRound` icon 打开，hover/focus 显示自适应 tooltip。
- 删除订阅页冗余的“账号资料”行、重复标题、空白页与无内容的“我的引擎”帮助入口。
- 为新生成的 `AppSettings` 初始化 `disabledCliEngines` 的受控默认值，仅在旧字段不存在时写入 `grok`、`kimi`、`opencode`。

## 技术方案

| 选项 | 说明 | 取舍 |
| --- | --- | --- |
| A. 保留“概览 / 安全 / 我的引擎”页面，仅调整样式 | 改动小，但用户仍需理解三层导航与二次跳转 | 不采用，不能消除交互根因 |
| B. 在 Account Center 内收敛为“订阅 / 额度”，安全高频操作升到 Header、低频能力留在按需 surface | 主动线最短，保留既有 Gateway contract | 采用 |
| C. 将安全能力全部删除或改到 token2api 网站 | 页面最少，但会丢失桌面端已具备的账户能力 | 不采用 |

## 验收标准

- 登录后仅出现“订阅”“额度”Tab；页面不再显示重复“账号”标题、重复“账号资料”行或“我的引擎”跳转页。
- 已订阅的 Codex / Claude 在订阅 Tab 直接展示，点击可进入对应引擎动作；无订阅时显示现有订阅引导，不产生二次跳转。
- 显示名称可在 Header 原地编辑、确认或取消；密码 icon 在 Header 常驻且 tooltip 可读，密码修改流程仍会清理本地密码字段并回到登录态。
- 新装配置默认只启用 Codex、Claude；已有 `disabledCliEngines` 值原样保留。
- 现有 Account Center 额度刷新、卡片选择与按日模型用量 hover 行为不回归。

## Capabilities

### New Capabilities

- `account-center-subscription-ui`: 账号中心订阅优先信息架构、原地资料编辑与 Header 安全入口。

### Modified Capabilities

- `cli-engine-visibility`: 新安装时的默认引擎可见性和已存用户偏好兼容规则。

## Impact

- Frontend：`src/features/account/components/**`、Account controller 类型、copy、样式和 Account Experience tests。
- Settings：`AppSettings.disabledCliEngines` 的默认值与迁移/serde tests。
- 不新增 token2api endpoint，不影响生产 authority 或现有 API contract。
