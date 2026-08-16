# 强制账号与引擎订阅式启动闭环

OpenSpec single source of truth：`openspec/changes/require-account-engine-subscription-onboarding/`。

## 用户目标

面向不理解 API Key、Provider 和配置文件的小白用户，把 Doge 主路径收敛为：登录 → 选择 Codex/Claude Code → 有订阅则自动准备；无订阅则展示 token2api 当前公开可售套餐 → 支付 → 自动创建/恢复 managed credential → 自动配置 → 进入 App。

## 不可变约束

- 只有 subscription plans；无 balance recharge、pay-as-you-go 或按量付费 fallback。
- 套餐、价格、周期、额度、features 与排序以 token2api `for_sale=true` server response 为准。
- renderer 不接收 raw secret；用户不选择 API Key、不看配置文件或 diff。
- ready 前不挂载 AppShell/managed runtime。
- Codex 与 Claude Code 都需完成真实 managed configuration 与 launch 验证。

## 验收与执行

执行清单、architecture decisions、failure contract 与 release gates 均以对应 OpenSpec `tasks.md`、`design.md`、delta specs 为准。旧 `integrate-token2api-account-system` 的 Native foundation 可复用，但其“Local Mode 始终可用”行为被本 change 明确 supersede，不能同步进最终 main specs。
