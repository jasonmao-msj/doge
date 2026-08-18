# Proposal: fix-shared-session-subscription-quota-projection

## Why

Shared Session 的 Composer quota panel 当前无法正确投影已登录 Token Matrix 账号的订阅额度。截图中的面板提示“已识别套餐供应商，但还没有额度窗口数据”，`供应商`却显示为 `empty`；同一账号在 Account Center 已经能够读取订阅引擎、已用额度、总额度与 reset time。

这会让用户误以为 Shared Session 没有可用额度，无法判断当前 Codex / Claude 订阅是否还能继续使用。问题发生在 Doge 的 Shared quota projection / data-source 边界，不应通过修改生产套餐、支付状态或 token2api 业务数据来规避。

## What Changes

- 让 Shared Session quota panel 使用当前 Shared execution target 对应的 Token Matrix managed engine / plan quota 数据源。
- 正确显示供应商名称 `Token Matrix`（或权威 authority 返回的 display name）、engine、subscription plan、当前窗口 used/total、剩余比例和 reset time。
- Shared Session 含多个 engine/provider target 时，各额度 entry 必须按 target 隔离，不能因为 active engine 或历史 provider 缺失而显示 `empty`。
- 无额度窗口、正在加载、authority 不可用、未订阅和数据缺失必须分别呈现可解释状态；不得把“数据尚未投影”误报成“没有额度”。
- 保持 Account Center 额度页、Native Session quota 和 Local Mode 行为不变。

## 非目标

- 不修改 token2api 的套餐、价格、支付状态机或额度计算规则。
- 不新增 pay-as-you-go、余额充值或 API Key 选择流程。
- 不把 Shared Session 的多个 engine 请求合并成一个不具备 target identity 的全局额度。
- 不在本次记录阶段修改代码或生产配置。

## 当前观察（Evidence）

- 复现 surface：登录 Token Matrix 账号后，进入 Shared Session，在 Composer 的 quota panel 展开额度窗口。
- 实际 UI：显示“已识别套餐供应商，但还没有额度窗口数据”，`供应商`显示 `empty`。
- 预期事实：同一账号的 Account Center 已有对应订阅卡和额度窗口数据，供应商应为 Token Matrix。
- 截图由用户于 2026-08-17 提供；未记录账号密码、token、payment action 或 raw API secret。

## Capabilities

### New Capabilities

- `shared-session-quota-projection`：Shared target-scoped Token Matrix subscription quota read、状态投影与 credential-free UI contract。

### Modified Capabilities

- `shared-session-engine-selection`：Shared target 的 quota projection 必须携带完整 engine/provider/plan identity。
- `status-panel-session-overview`：quota panel 的 empty/loading/error/success 状态必须区分“无额度”与“额度尚未读取”。
- `account-convenience-native-contract`：managed authority 的 quota read 必须可被 Shared Session 复用，但不泄露 credential。

## 影响面初判

| 层 | 可能受影响位置 |
|---|---|
| Frontend | `SessionControlQuotaPane.tsx`、`useSessionQuotaList.ts`、`sessionQuotaTargets.ts`、Shared target projection |
| Bridge | `getCodingPlanQuota` / Account quota adapter 的 target mapping 与 stable reason mapping |
| Rust | `coding_plan_quota.rs` 与 managed authority quota read；需确认是否已有可复用 command |
| Tests | Shared quota target isolation、Token Matrix managed plan projection、empty/loading/error regression |
| Upstream | 暂不判断需要修改 token2api；先验证现有 authority quota contract 是否已足够 |

## 后续实施原则

先做 read-only data-flow trace：`Shared selectedNextTarget → quota target → authority read → view model → SessionControlQuotaPane`，确认断点后再决定 Doge-only 修复或需要向 token2api 提交 API contract change。生产环境在确认前不做上游改动。
