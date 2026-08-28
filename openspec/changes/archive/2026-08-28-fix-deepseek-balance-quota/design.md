## Context

会话概览额度走 `get_coding_plan_quota(engine, providerProfileId)`：

1. 解析当前 engine 的 base_url + api_key（Codex managed / Claude settings / Kimi 等）
2. `detect_provider(base_url)` → 已知 host 才 HTTP 查询
3. 返回 `CodingPlanQuotaSnapshot{ source, windows[], ... }`
4. 前端 `buildSessionOverviewQuota`：仅当 `success && windows.length > 0` 走 coding_plan；否则 unsupported / empty / error
5. Native / Shared 仅在 **target 收集** 分岔（`collectSessionQuotaTargets`），查询 command 共用

DeepSeek 官方文档仅提供余额接口，不提供 5h/周百分比：

```http
GET https://api.deepseek.com/user/balance
Authorization: Bearer <TOKEN>
```

```json
{
  "is_available": true,
  "balance_infos": [
    {
      "currency": "CNY",
      "total_balance": "110.00",
      "granted_balance": "10.00",
      "topped_up_balance": "100.00"
    }
  ]
}
```

Claude managed DeepSeek 常见 base：`https://api.deepseek.com/anthropic`；Codex managed 常见：`https://api.deepseek.com`。检测子串 `api.deepseek.com`（或 `deepseek.com`）即可。

## Goals / Non-Goals

**Goals:**

- 识别 DeepSeek host 并查询官方 balance API。
- Snapshot 同时承载 `windows`（百分比）与 `balance`（货币），additive 不破坏既有供应商。
- Native + Shared 均正确展示；Shared 多卡互不污染。
- 边界：空 key、401、非 JSON、空 `balance_infos`、多币种、`is_available=false` 均可测。

**Non-Goals:**

- 不伪造百分比 window。
- 不新增 Tauri command / 轮询。
- 不改 Native/Shared target 收集策略。
- 不改 Cost 区 token 计费。

## Decisions

### D1. 扩展既有 Snapshot，不拆新 command

**选择**：在 `CodingPlanQuotaSnapshot` 增加可选 `balance`。

**备选**：独立 `get_provider_balance` → Shared list 双路径，拒绝。

**理由**：credential 解析与路由已在 `coding_plan_quota`；IPC 形状 additive；hooks 零改。

### D2. Balance 数据结构

```rust
struct CodingPlanBalanceItem {
    currency: String,           // CNY | USD
    total_balance: String,      // 官方为 string
    granted_balance: Option<String>,
    topped_up_balance: Option<String>,
}

struct CodingPlanBalanceSnapshot {
    is_available: bool,
    items: Vec<CodingPlanBalanceItem>,
}

// CodingPlanQuotaSnapshot 增量：
// balance: Option<CodingPlanBalanceSnapshot>
// source: "deepseek" on success path
```

serde：`camelCase` 与现有 windows 一致。

### D3. HTTP 边界

| 边界 | 行为 |
|------|------|
| base 含 `api.deepseek.com` 或 `deepseek.com` | route = CodingPlanApi + DeepSeek |
| chat base 带 `/anthropic` | 仍识别；balance URL **固定** `https://api.deepseek.com/user/balance` |
| api_key 空 | `empty_credentials` |
| HTTP 401/403 | `success=false`，error 含 Authentication |
| HTTP 非 2xx | `success=false`，截断 body |
| `balance_infos` 空数组 | `success=true`，`balance.items=[]` → 前端可当 empty credits（见 D5） |
| 多 currency | 全部保留；展示拼接 |
| `is_available=false` | 仍返回 items；`plan_label` 可用 `unavailable` 或文案层标注 |

### D4. 前端成功条件与展示

```
coding_plan success iff:
  success
  && source not in {codex, official_cli, none}
  && (windows.length > 0 || balance.items.length > 0)
```

展示映射：

- `hasCredits = balance.items.length > 0`
- `creditsBalance = items.map(i => `${currency} ${totalBalance}`).join(" · ")`
- `creditsUnlimited = false`
- `windows` 对 deepseek 保持 `[]`
- `providerLabel = "deepseek"`

UI：`windows.length === 0 && hasCredits` 时 **跳过** codingPlanEmpty 段落，只渲染 credits 行。

### D5. 空余额 vs 查询失败

| 情况 | success | UI |
|------|---------|-----|
| 网络/鉴权失败 | false | error |
| 200 + items 非空 | true | credits |
| 200 + items 空 | true, balance 存在但 items=[] | empty（非 unsupported host） |
| 未识别 host | unsupported | 原有文案 |

### D6. Shared / Native 适配

- **Native**：`includeHistory=false` → 单 target → 同一 command。
- **Shared**：`useSessionQuotaList` 按 target 并行；DeepSeek profile 返回 `source=deepseek`；MiniMax 仍 `windows`。
- credential 解析不改：仍走 `resolve_engine_base_url_and_key`；只需 `detect_provider` 命中 DeepSeek 即 `QuotaRoute::CodingPlanApi`。

### D7. 测试策略

- Rust：`detect_provider` deepseek 变体；`parse_deepseek_balance` 多币种 / 空 / 字段缺失。
- Vitest：`buildSessionOverviewQuota` deepseek balance 成功；无 windows 有 credits 不 empty；Shared multi-entry 含 deepseek。
- 手动：Native Codex·DeepSeek 概览可见余额（实现后）。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 把 balance 塞进 coding_plan 命名空间语义偏宽 | source 字段区分 `deepseek`；文档写清「quota snapshot 多形态」 |
| 前端旧逻辑只看 windows → 永远 empty | 同步改成功条件 + UI empty 门闩（tasks 强制同 PR） |
| API key 权限不含 balance | 显式 401 error，不静默 |
| 多币种展示过长 | 仅拼 `currency total`；明细 granted/topped_up 先不进主文案（可选 planLabel） |
| 与归档 change「DeepSeek unsupported 正确」冲突 | 本 change **有意** supersede 该非目标；delta 写清 |

## Migration Plan

1. 落地后端 + 前端 + 测试（同一实现窗口）。
2. 无数据迁移；旧客户端忽略未知 `balance` 字段（serde 前端可选）。
3. 回滚：还原 `coding_plan_quota.rs` + 三处 TS/UI 即可；IPC 无版本号。

## Open Questions

- 无阻塞项。展示默认 `CNY 110.00` 形态（proposal 已定）。
- 若后续要对齐「赠金/充值拆分」UI，另开 change，本设计已在 item 保留字段。

## 实现草图（伪代码）

```
detect_provider(url):
  if deepseek host → DeepSeek
  ... existing ...

query_deepseek(api_key):
  GET https://api.deepseek.com/user/balance
  parse → CodingPlanBalanceSnapshot
  return success_snapshot(source="deepseek", windows=[], balance=Some(...))

buildSessionOverviewQuota(...):
  if success && (windows|balance items):
    map windows + map balance → credits
```
