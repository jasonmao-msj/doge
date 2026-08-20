## Context

当前 `usage.read` 会组合 subscriptions progress 与 365 天 dashboard/model analytics，适合额度页面但不适合 Sidebar 快捷入口。账号 subscription 卡也无法在不触发大请求的前提下展示套餐、每日额度与到期时间。

另一方面，账号 onboarding 已能为受支持引擎配置 `doge-token-matrix` managed provider，但 App Shell preparation 完成后只切换 engine。新建会话的 default execution target 因 `providerProfileId = null` 被投影为 local/disk，可能使用用户遗留的失效 Key。

## Goals

- Separate the lightweight subscription fact from dashboard analytics.
- Make account navigation progressive: sidebar icon -> compact summary -> full account settings.
- Bind only eligible **new** Codex/Claude sessions to the managed provider and preserve all explicit user/session choices.

## Non-Goals

- 不改变套餐支付、订阅生命周期或 token2api authority schema。
- 不修改 Local Mode、已有 session、手动 provider 和全局磁盘配置。
- 不在 Sidebar 预取、轮询或暴露完整 token/model analytics。

## Decisions

### 1. `subscription.read` is a bounded, pull-only operation

Rust 调用既有 `/api/v1/subscriptions/summary`，并使用现有 desktop engine catalog 解析其已知 Codex / Claude entitlement。返回 canonical projection：subscription identity、authority group/plan label、status、daily/weekly/monthly windows、expiry、可选 `engineId`。它不请求 usage dashboard，故 Sidebar 打开前不产生网络请求，打开后最多一次轻量 read。

`subscription.summary` capability 从 feature flag 变为 capability-gated operation；authority 不可用、token 失效或未知 schema 时返回 typed unavailable/failure state，不展示伪造用量。

### 2. Cards use authority facts and responsive layout

Account subscription cards use a responsive grid and show plan label, current daily window and expiry when provided. Subscription identity is not collapsed by engine: multiple known subscriptions render independently. A summary that cannot be matched to a supported engine remains visible as an unmapped subscription rather than being labeled Codex or Claude.

### 3. Sidebar is an on-demand bridge, not another account page

Sidebar keeps one compact account icon at the bottom. Its popover is opened by user intent and owns a one-shot summary load with stale-response protection. It contains only account identity plus compact subscription/remaining quota facts; activating it opens `Settings > account`. The action does not add a primary navigation tab or duplicate the full Account Center.

### 4. Managed default applies at creation time only

The account-ready signal provides an eligible managed engine set after successful preparation. `resolveDefaultCreationExecutionTarget` consumes that set and chooses `doge-token-matrix` only when the user has no explicit creation provider. The selected provider's model catalog is loaded before model resolution, so a disk/local model id cannot leak into a managed create request.

Existing thread bindings always win. Local Mode, signed-out sessions, inactive entitlements, failed preparation and an explicit local/manual provider remain local. Catalog failure must produce the established unavailable/error behavior rather than silently switching to disk configuration.

## Contract And Error Matrix

| Case | `subscription.read` | new-session target |
| --- | --- | --- |
| Authenticated + active Codex/Claude subscription | canonical cards and compact summary | managed provider default for that engine |
| Summary unavailable / malformed | typed unavailable state, no fake values | no impact on existing session/default |
| Multiple subscriptions for one engine | each subscription remains a separate card | one eligible provider default per selected engine |
| Future/unmapped subscription | plan facts visible, `engineId = null` | never guessed as a managed engine |
| Explicit local/manual provider | n/a | explicit profile wins |
| Existing thread / Local Mode / signed out | n/a | no managed default injection |
| Provider catalog failure | n/a | fail closed / show existing diagnostic; never fall back silently |

## Test Plan

- Contract and service tests for success, unauthenticated/unavailable, multiple and unmapped summaries.
- Account UI tests for card details, responsive card data and header action removal.
- Sidebar tests for lazy load, successful summary and account-page handoff.
- `resolveDefaultCreationExecutionTarget` tests for eligible managed selection, explicit local precedence, Local Mode and catalog-safe model handling.
- Run focused Vitest, `npm run typecheck`, `npm run lint`, `npm run check:runtime-contracts`, and strict OpenSpec validation.
