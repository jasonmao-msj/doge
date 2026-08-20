# Proposal: 完善账号快捷入口与托管引擎默认配置

## Why

账号中心第一轮收敛后，仍有四个影响小白用户闭环的问题：订阅卡缺少套餐、额度和到期事实；Header 保留了与主流程无关的安全入口；已订阅引擎的新会话可能错误落到本地配置；主界面没有账号与订阅摘要的快捷动线。

这些问题会让用户已经购买的订阅无法自然地转化为可用引擎，并在本地旧 API Key 无效时出现 `401 Invalid API key`。本 change 在 Doge 内修复该体验，不修改 `token2api` 的生产 API 或服务端数据。

## What Changes

- 新增轻量只读 `subscription.read` Gateway operation：复用现有 `GET /api/v1/subscriptions/summary` 与 desktop engine catalog，将活跃的 Codex / Claude entitlement 映射为套餐、当日用量、额度和到期时间；不加载 365 天 usage dashboard。
- 将 Account subscription surface 改为可响应的多订阅卡片；未知或无法可靠映射的未来套餐只显示 authority 返回的套餐事实，不伪造 engine identity。
- 移除 Account Header 的冗余 shield action；保留 password command 与现有低频安全能力。
- 在 Sidebar 底部增加账号快捷入口。用户点击后才读取轻量摘要，查看后可直达 Settings 的 account 页面；不引入后台轮询。
- 当账号已认证、对应 Codex / Claude entitlement 为 active 且 onboarding preparation 成功时，将**新建**会话默认绑定 `doge-token-matrix` managed provider，并按该 provider 刷新 model catalog。已有会话、显式选择本地/手动 provider、未订阅账号与 Local Mode 保持原样。

## User Outcome

- 用户在账号中心即可看清每个订阅的套餐、今日用量、额度和到期时间。
- 用户从任何主界面都能快速进入账号与额度，而不需要先猜 Settings 层级。
- 已购买 Codex / Claude 的用户新建会话会使用对应托管访问，不会错误复用旧本地 API Key。

## Non-Goals

- 不新增、修改或发布 `token2api` API。
- 不把完整 usage dashboard 或按模型日趋势加载进 Sidebar popover。
- 不迁移已有 thread 的 provider binding，也不替用户修改全局 CLI 配置。

## Impact

- Frontend: account contracts/services/hooks/components、Sidebar layout wiring、new-session execution target resolution。
- Rust: account authority/runtime projection only, for the new read-only summary operation.
- Existing capability specs: `engine-per-session-provider-binding` and `model-provider-catalog-runtime`.
