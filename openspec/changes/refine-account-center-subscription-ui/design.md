## Context

当前 Account Center 的 `overview / usage / security` 三个 Tab 与独立“我的引擎”页面重叠：订阅卡片不在账号中心，显示名称编辑被埋在安全页，密码入口不稳定。额度页面本身已具备多订阅卡、窗口、daily heatmap 与按模型 hover 数据，应该保留为独立的第二层。

Shared Session 的额度修复是相邻但独立的 change；本 change 不改变 quota transport 或 token2api authority。

## Goals / Non-Goals

**Goals:**

- 为登录用户提供最短路径：订阅查看/使用 -> 额度查看。
- 将高频、低风险的资料编辑留在当前视图；将密码动作变为可发现但不抢占注意力的 Header command。
- 用 explicit migration 区分“新装未设值”与“老用户主动设置”。

**Non-Goals:**

- 不调整套餐、支付、usage 数据模型或 desktop authority endpoint。
- 不消除低频安全能力的后端能力；它们不能作为本轮导航重构的隐性破坏。

## Decisions

### 1. Account Center 使用 `subscription` + `usage` 两个 Tab

选择将原 `overview` state 替换为 `subscription`，而不是仅改 UI label。这样 state、aria value 和测试都表达正确业务语义，避免未来继续向“概览”塞非订阅内容。订阅卡片复用现有 account subscription projection / engine switch signal，不复制 gateway 数据。

### 2. Header 负责 command，内容区负责 entity

Header 显示当前 display name、masked email、refresh（仅额度页）、password 和 logout。display name 点击进入 input，确认/取消后复用现有 `profile.updateProfile`；password 按钮将安全编辑器置为 `password`，不把 secret 放入 controller/persistent state。TOTP、identity bindings、managed credential 等低频项仍通过按需 security surface 保留，避免 silent removal。

### 3. 新装可见性使用 deserialize-time default

`disabledCliEngines` 仅在字段缺失时返回 `grok/kimi/opencode`；若字段存在（包括空数组），按用户数据原样读取。相比启动 effect 覆盖设置，这一方案无竞态、不写盘、也不会侵蚀已有用户的显式选择。

## Risks / Trade-offs

- [安全低频功能缺少主 Tab] -> 保留现有 editor/component 能力，并用 Header password command 覆盖唯一用户已指出的高频安全动作。
- [设置默认迁移误伤老用户] -> 测试 missing / empty / explicit-disabled 三种 deserialize 路径；只有 missing 得到默认禁用列表。
- [订阅卡 UI 与额度卡重复] -> 共用 authority-derived engine labels 与现有 `EngineIcon`，不复制套餐/额度解释文本。

## Migration Plan

1. 发布时无远端迁移、无 token2api 数据变更。
2. 新安装第一次读取无 `disabledCliEngines` 的 settings 时得到默认禁用列表；已有 persisted field 保持不变。
3. 回滚版本读取该数组仍兼容，用户不会丢失 provider configuration。

## Open Questions

- TOTP 与 identity bindings 后续是否需要独立的按需 drawer；本轮仅保证不删除其 domain contract。
