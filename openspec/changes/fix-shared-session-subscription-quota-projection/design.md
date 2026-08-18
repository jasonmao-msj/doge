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

## 需要先确认的问题

- Token Matrix authority 是否已有按 `engine` / `plan` 返回额度窗口的 Desktop endpoint，还是当前只提供 Account Center quota endpoint？
- `getCodingPlanQuota(engine, providerProfileId)` 是否能区分 managed Token Matrix 与本地/第三方 provider？
- Shared Session 的 `SessionQuotaTarget` 是否包含完整 managed account identity，还是只保留 provider profile id？
- quota panel 是否需要显示当前选中的 target，还是显示 Shared Session 所有已产生过的 targets？产品默认倾向前者，展开后可查看后者。
