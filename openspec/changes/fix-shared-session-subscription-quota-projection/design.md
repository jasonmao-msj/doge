# Design: Shared Session Token Matrix quota projection

## 目标数据流

```text
Shared selectedNextTarget
  → (engine, providerProfileId, managed account context)
  → authoritative Token Matrix quota read
  → target-scoped quota snapshot
  → Shared quota list/view model
  → SessionControlQuotaPane
```

每个节点必须保留 `engine`、`providerProfileId`（如有）、`planId/planName`（如 authority 提供）和 `queriedAt`。Renderer 只接收 credential-free snapshot；API key、refresh token 与 vault 内容不得进入组件 props、日志或通用 DTO。

## 状态语义

| 状态 | 条件 | UI 语义 |
|---|---|---|
| `loading` | 请求尚未完成 | 显示加载状态，不显示 `empty` |
| `success` | 有 quota windows 或 authority balance/usage 数据 | 显示 Token Matrix、plan、used/total、reset |
| `not_subscribed` | authority 明确表示当前 engine 无有效订阅 | 显示未订阅，不伪造额度 |
| `unavailable` | authority/网络/权限暂时不可用 | 显示可重试错误，不隐藏为 `empty` |
| `empty` | authority 明确返回无额度模型且已完成读取 | 仅在事实确认为空时使用 |

## 关键验收场景

1. 登录 Token Matrix 账号，Shared Codex target 有订阅：quota panel 显示 `Token Matrix`、Codex、plan name、使用量、总额度和 reset time。
2. Shared Session 先用 Codex 再切 Claude：每个 turn 的 quota entry 保持 target attribution，不把 Codex 数据显示成 Claude 或 `empty`。
3. Shared Session 有多个 provider target：并行读取互不覆盖；一个 provider 失败不清空其他 provider 的成功数据。
4. 请求尚未返回时：显示 loading；不得提前显示“已识别供应商但没有额度窗口数据”。
5. Token Matrix authority 返回未订阅：显示未订阅状态；不得把本地 CLI quota 或历史 provider quota 当作替代数据。
6. Local Mode / Native Session：现有行为保持不变。

## 调研结论与决策

- `AccountRuntime::read_usage` 已通过 `/api/v1/desktop/v1/engines`、`/api/v1/subscriptions/progress` 与 `/api/v1/usage/dashboard/snapshot-v2` 获取 managed Codex / Claude 的权威订阅与 usage 数据；无需 token2api 新接口。
- 现有 `getCodingPlanQuota(engine, providerProfileId)` 只会解析本地 provider profile / CLI credentials，因此 managed target（profile id 为空）会得到 `empty_credentials` / `empty`，随后前端把 `empty` 格式化为 provider label。这是本次根因。
- 新增 Doge internal managed quota read：以 target engine 为输入，仅在已认证 authority session 中复用现有 account usage projection；返回 credential-free plan/windows/usage snapshot。非 managed / Local Mode 保持原 route。
- Shared target mapping 使用 authoritative managed provider identity（`Doge Token Matrix`）而非将 `empty`、`empty_credentials` 等 outcome code 当作可见 provider。Shared 仍展示历史产生过的 targets，条目按 engine + provider profile 互相隔离。
