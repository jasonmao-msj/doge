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

The explicit provider selected in Home is transient to that single creation attempt. Once the app leaves create-session mode, it MUST discard that transient target. Re-entering Home resolves a fresh default, so an eligible prepared subscription returns to `doge-token-matrix`; the session just created keeps the user's explicit provider through its durable thread binding.

Preparation is engine-scoped and only the last managed engine is guaranteed to be ready after startup. If Home currently selects another engine with an active entitlement, Composer requests the existing Account Gate preparation transaction once for that engine instead of exposing local/disk as a silent default. The managed target and provider-scoped catalog are resolved only after the ready signal; preparation failure remains fail-closed and does not fabricate a managed credential.

Home 的 engine submenu 也必须按每个 engine 自己的 entitlement 投影默认渠道，而不是只看当前 `executionTarget.engine`。因此，当 Codex 与 Claude 都有 active entitlement 时，即使当前闭合 target 是 Codex，Claude submenu 仍以 `doge-token-matrix` 加载和展示 model catalog；该 projection 仅用于 create-session，existing Native / Shared session 继续服从 durable target。

Provider identity is independent from engine identity. When an existing Native local/manual session explicitly selects `doge-token-matrix`, Composer MUST route through the existing Account Gate prepare transaction even if the target engine equals the active engine. This explicit cross-provider transition MUST re-confirm server-owned binding and OS-vault readiness rather than trusting a renderer-only `prepared` snapshot, because the credential may have been removed or become unavailable after the snapshot was published. Only the resulting ready signal may open the managed new-conversation surface; the source session keeps its durable provider binding.

## Contract And Error Matrix

| Case | `subscription.read` | new-session target |
| --- | --- | --- |
| Authenticated + active Codex/Claude subscription | canonical cards and compact summary | managed provider default for that engine |
| Active entitlement, but another engine was prepared at startup | n/a | automatically prepare the selected engine before resolving the managed default |
| Another subscribed engine is opened from the Home picker | n/a | its submenu defaults to `doge-token-matrix`, not local/disk |
| Summary unavailable / malformed | typed unavailable state, no fake values | no impact on existing session/default |
| Multiple subscriptions for one engine | each subscription remains a separate card | one eligible provider default per selected engine |
| Future/unmapped subscription | plan facts visible, `engineId = null` | never guessed as a managed engine |
| Explicit local/manual provider | n/a | explicit profile wins |
| Explicit local/manual provider used for one new session, then Home is reopened | n/a | created session keeps its binding; next creation resolves the managed default again |
| Existing local/manual Native session explicitly selects Token Matrix on the same engine | idempotent managed prepare re-confirms binding and vault credential | ready signal opens a new managed conversation; no failing continuation is created first |
| Renderer says prepared but managed credential is missing | prepare repairs/reissues the credential before runtime launch | raw `ambiguous-runtime` credential error is not used as the interaction path |
| Existing thread / Local Mode / signed out | n/a | no managed default injection |
| Provider catalog failure | n/a | fail closed / show existing diagnostic; never fall back silently |

## Test Plan

- Contract and service tests for success, unauthenticated/unavailable, multiple and unmapped summaries.
- Account UI tests for card details, responsive card data and header action removal.
- Sidebar tests for lazy load, successful summary and account-page handoff.
- `resolveDefaultCreationExecutionTarget` tests for eligible managed selection, explicit local precedence, Local Mode and catalog-safe model handling.
- Composer regression for same-engine local -> Token Matrix selection: it emits Account Gate intent, does not emit Provider Continuation first, and re-confirms even from a stale renderer `prepared` state.
- Run focused Vitest, `npm run typecheck`, `npm run lint`, `npm run check:runtime-contracts`, and strict OpenSpec validation.
