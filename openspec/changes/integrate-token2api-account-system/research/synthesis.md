# token2api → doge Account Integration Research Synthesis

> 状态：`ready-for-user-decision`。本文是 durable research synthesis，不是正式 `proposal.md`、`design.md` 或 `tasks.md`。剩余 credential/vault、managed key 与 first-recipe 决策确认前不得进入 implementation。
>
> 路径约定：未加前缀的路径均相对 doge repo root；`token2api:<path>` 相对 token2api repo root。本文不记录 secret、raw config、raw diff 或大段 agent 原始报告。

## Executive Summary

Master Plan 采用两个永不混淆的 product plane：

- **Local Core Plane**：doge 所有既有本地能力在未登录、离线、token2api outage、subscription inactive 或 quota exhausted 时仍完整可用。它由 `LocalPrincipal` 持有，app startup 与本地 capability discovery 不依赖 account DB、vault、network 或 entitlement。
- **Account Convenience Plane**：可选增强层，服务不会手工配置的用户与希望便捷接入 doge token service 的用户。它覆盖 auth/profile/session、dedicated managed key、recipes/one-click configuration、quota/usage、subscription/entitlement、billing/payment、device/session、multi-account、remote/daemon 与 web/cloud。

Account Convenience Plane 推荐由 **Native Host Account Broker** 承载：React renderer 只发送 intent 和接收 credential-free view model；Tauri Rust 持有 system-browser auth、loopback callback、PKCE/state/nonce、session singleflight/generation、OS credential vault、独立 account SQLite、fixed HTTPS client、immutable recipe catalog，以及 config plan/apply/recovery transaction。`AccountLink` 只附加 convenience identity，永不替换 `LocalPrincipal` 或接管既有本地 data ownership。

规划原则是 **design broad, implement vertically**：本 Master Plan 一次性保留长期完整 capability、dependency、security boundary、migration 与 release gate；execution 可按 D0/S0/H0/C0/R1–R7/Cn 分阶段交付，但不能因首个 release cut 较小而删除长期能力。当前仍不具备直接实施条件：token2api 的 revoke-all durability、refresh atomic rotation、desktop ticket 与 API-key secret lifecycle 存在 P0 blocker；doge 尚无 app-level identity、OS vault、desktop auth completion、account metadata schema 或 safe multi-file config transaction。

## Evidence-backed Current Facts

### doge current

- **Fact**：doge 没有 app-level identity。现有 `AccountSnapshot` 是 workspace-scoped Codex/CLI account display，不是 doge user identity，证据见 `src/types/planning.ts`、`src/features/threads/hooks/useThreadAccountInfo.ts`、`src/features/threads/hooks/useThreadsReducer.ts`。
- **Fact**：当前 account command surface 仅覆盖 Codex `account_read`、rate limits、`codex_login`/cancel；不存在 doge refresh、logout/revoke、device session，见 `src-tauri/src/command_registry.rs`、`src-tauri/src/shared/codex_core.rs`。
- **Fact**：当前没有 OS keychain/Stronghold/keyring abstraction，也没有 loopback callback listener 或 deep-link completion contract；`src-tauri/src/lib.rs` 仅把 HTTP(S) 交给 system browser，`RunEvent::Opened` 只处理 `file:` URL，dependency 事实源为 `src-tauri/Cargo.toml`。
- **Fact**：当前 plaintext settings/provider stores 不能作为 account vault。`src-tauri/src/types.rs`、`src-tauri/src/vendors/commands.rs` 和 `src-tauri/src/email/mod.rs` 的 serializable DTO/file stores 可承载 secret；generic renderer diagnostics 也不足以证明 raw diff 安全，见 `src/services/rendererDiagnostics.ts`。
- **Fact**：doge 已有 `rusqlite` dependency 与 SQLite operational pattern；`src-tauri/src/shared_event_log/` 提供 WAL、foreign keys、`user_version` migration、single-writer、`quick_check` 与 recovery precedent。缺口是独立 account metadata schema/repository，而不是 SQLite foundation。
- **Fact**：现有 `Dialog`、`Accordion`、`DiffBlock`、changed-file list、global notice/bubble pattern可提供 interaction precedent，见 `src/components/ui/dialog.tsx`、`src/features/messages/components/conversation/TurnFilesChangedCard.tsx`、`src/features/git/components/DiffBlock.tsx`、`src/features/notifications/components/GlobalRuntimeNoticeDock.tsx`。
- **Fact**：现有 Git diff/config editor不可直接复用。`src/features/git/components/GitDiffPanel.tsx` 可读取 raw working-tree diff 并支持 edit/save；`src/features/git/utils/diffPresentationModel.ts` 不承担 secret redaction。
- **Inference**：可复用 UI composition、SQLite lifecycle、single-file safe-write primitives 与 typed Tauri facade pattern，但 account DB、vault、auth broker、safe semantic diff 和 multi-file compensating transaction 必须建立独立 boundary。

### token2api current

- **Fact**：token2api 是 Go/Gin/Ent/PostgreSQL + Redis 服务，已覆盖 email login/register、TOTP、OAuth、profile、subscription/quota/usage 与 user-owned API key；routes 见 `token2api:backend/internal/server/routes/auth.go`、`token2api:backend/internal/server/routes/user.go`。
- **Fact**：它没有 desktop ticket/device authorization、device-aware session、config plan/diff/apply/recovery API。当前 Web OAuth callback 把 token 交给 frontend fragment，见 `token2api:backend/internal/handler/auth_email_oauth.go`；该 flow 没有 doge instance binding、PKCE verifier 或 one-time desktop exchange，不能复用。
- **Fact**：revoke-all 存在 false completion。`token2api:backend/internal/service/auth_service.go::RevokeAllUserTokens` 在内存增加 `TokenVersion`，但 `token2api:backend/ent/schema/user.go`、migrations 与 `token2api:backend/internal/repository/user_repo.go` 没有 durable field/read-write mapping；handler mock 的 `7 → 8` 不能证明 DB reload 后旧 JWT 被拒绝。
- **Fact**：refresh rotation 是分离的 `GET → DEL old → generate/store new`，不是 atomic consume-and-rotate；并发 refresh 可产生多个 successor，reuse path也没有完整 family tombstone，见 `token2api:backend/internal/service/auth_service.go::RefreshTokenPair`、`token2api:backend/internal/repository/refresh_token_cache.go`。
- **Fact**：login 在 refresh store 失败时可能返回 access-only HTTP success，见 `token2api:backend/internal/handler/auth_handler.go`；desktop client不能把它解释为 durable session。
- **Fact**：API key 以 plaintext unique value存储，List/Get持续返回 full secret，见 `token2api:backend/ent/schema/api_key.go`、`token2api:backend/internal/handler/dto/types.go`。deleted audit/idempotency response也可能延长 secret exposure。
- **Fact**：API key `PUT` 的 ACL slices不是 optional pointer；省略字段可能清空 allow/deny lists，见 `token2api:backend/internal/handler/api_key_handler.go`、`token2api:backend/internal/service/api_key_service.go`。
- **Fact**：CORS allow headers 缺 `Idempotency-Key`，见 `token2api:backend/internal/server/middleware/cors.go`。doge 应始终发送 stable logical-operation idempotency key；推荐的 host architecture 使用 Rust native HTTPS，不能依赖 WebView CORS。
- **Fact**：2FA debug log含 temp-token prefix 与 email，production 接入前必须移除，位置在 `token2api:backend/internal/handler/auth_handler.go`。
- **Inference**：token2api 可继续作为 identity/profile/entitlement/API-key authority，但 desktop auth、device identity 与 config transaction 是新增 contract，不能由现有 Web flow 或 UI config generator替代。

## User Interaction Contract

1. 用户完成完整 login/MFA 后，只出现 configuration offer；此时不创建 key、不写 config。
2. 用户选择 recipe 后，Rust 计算 read-only exact plan；UI 默认只显示 changed-file labels，不显示 raw path。
3. 用户点击某一文件时，Rust 按 `planHandle + fileHandle` lazy 生成 semantic redacted diff。raw old/new、unknown values、secret长度/prefix/hash均不得跨 IPC。
4. Apply consent 只授权当前 account/session generation、host、recipe/version、file fingerprint、plan digest 与 TTL 绑定的 exact plan。任一 binding 变化均要求重新 plan/consent。
5. ordinary close：关闭 surface，保留 bubble，unread badge 不变。
6. “已知晓”：关闭 surface，只清当前 result badge，bubble 仍保留。
7. 点击 bubble 恢复当前 offer/plan/result；bubble 的独立 `×` 才写 `HardDismiss`。
8. applying 期间允许 ordinary close/minimize，但禁止 hard dismiss；完成后产生 durable result 或 recovery state，并显示 unread bubble。
9. `HardDismiss` key 固定为 `account × device × recipeId × recipeVersion`；account/session generation变化使旧 plan失效，recipe version升级不会被旧 dismissal抑制。
10. failed/partial/rollback/reload failure必须保持可恢复入口；timeout不能伪装为成功或“已修复”。

## Architecture Options

| Option | Strengths | Costs / Risks | Verdict |
|---|---|---|---|
| Native Host Account Broker | secret不进 renderer；能统一 vault、generation、filesystem transaction、Local Core isolation与platform能力；与 Tauri trust boundary匹配 | Rust/platform工作量最高；必须验证 OS vault、loopback、safe replace/recovery | **Recommended host architecture** |
| Device authorization flow | 无 inbound callback，适合 remote/headless daemon；device与host ownership更清晰 | token2api当前无 device flow；polling、expiry、slow-down、daemon vault/unlock均需新增 | 保留为 R6 remote/daemon方向，不阻塞 local vertical slice |
| doge-specific BFF/session proxy | 可把部分 authority/token policy收敛到 server，renderer仍可保持薄 | 引入新的 always-online service、session/cookie/CSRF/operations surface；弱化 local-first与host-local config ownership | Desktop local vertical不采用；R6 Web/cloud lane重新评估 |

## Comprehensive Account Integration Master Plan

以下 scope 全部属于唯一 Master Plan。某项尚未进入当前 release cut，只表示 implementation deferred；不得将其从设计、dependency、compatibility、migration 或 acceptance map 删除。

| Capability domain | Long-term contract | Planned delivery lane |
|---|---|---|
| Auth / profile / session | desktop login、MFA、profile、refresh、logout/revoke、expiry/recovery、account lifecycle | H0 + R1；后续 device/web flow扩展 |
| Dedicated managed key | `account × device × purpose` credential、create/rotate/revoke、least privilege、metadata-only API与secret lifecycle | S0 hardening + R2 policy/implementation |
| Recipes / one-click config | immutable catalog、plan、changed-file list、lazy safe diff、three-step authorization、apply、backup/rollback/recovery/reload | C0 + R2/R3；Cn持续扩展 |
| Quota / usage | freshness-aware usage/quota read model、offline/degraded behavior、support state | R4；仅控制新增 token-service actions |
| Subscription / entitlement | plan/subscription state、capability namespace、expiry/grace/recovery | R4；不得控制 Local Core Plane |
| Billing / payment | checkout/portal、invoice/payment state、plan transition、failure/support/compliance | R5；payment credential由 payment provider持有 |
| Device / session management | durable device identity、session inventory、revoke one/all、lost-device recovery、audit | R5；依赖 S0 revocation/device model |
| Multi-account | account switch、vault/data isolation、active-account ownership、conflict/migration | schema自D0起ready；R5提供product surface |
| Remote / daemon | device authorization、daemon vault、host-bound account/config、wrong-host prevention、Desktop parity | R6 |
| Web / cloud | BFF/device session、browser credential boundary、cloud capability namespace、Local Core isolation | R6，独立 security/operations gate |
| Security / privacy | threat model、vault、least privilege、redaction、retention/deletion、transport、audit、strict support bundle | S0为全阶段 blocking gate |
| Migration / retention | existing-user compatibility、schema/config/key migrations、backup cleanup、account deletion/export | D0 contract；各 R phase有独立 migration gate |
| Observability / support | closed events/reasons/metrics、SLO、diagnostics、recovery evidence、support workflow | D0/H0冻结contract，R1起贯穿所有阶段 |
| Platform matrix | macOS/Windows/Linux browser callback、vault、filesystem、runtime reload；headless/server variants | C0/R3验证，Cn/R6扩展 |
| Rollout / rollback | capability negotiation、feature flags、canary、kill switch、durable rollback/recovery | 每个 phase独立 exit gate |

### Planning principles

1. **Design broad, implement vertically**：先定义完整 capability/data/security/release map，再以可独立验收的 vertical slice交付；phase cut不是scope deletion。
2. **LocalPrincipal is canonical for local ownership**：`AccountLink` 永不替换 `LocalPrincipal`，也不迁移或重标既有 workspace、conversation、settings与local runtime data。
3. **Entitlement is namespaced**：subscription、quota、billing只控制新增 `account/*`、`token-service/*`、`cloud/*` capability namespace，禁止成为既有 local command、engine、workspace、Git、terminal、file 或conversation gate。
4. **Multi-account-ready from first schema**：即使首个 UI 只允许一个active account，SQLite/vault/session/receipt/dismiss schema也必须显式携带 opaque `AccountLinkId`、`DeviceId`、generation/accountEpoch与uniqueness boundary，禁止single-account global row设计。
5. **Three independent authorizations**：login只授权建立account session；managed key provisioning需单独确认；config apply还需针对exact live plan再次确认。任何一次授权不能被另一阶段复用。
6. **Recipes are local immutable capability definitions**：remote只可引用已安装并签名/编译入本地catalog的 `recipeId/version` 与typed inputs；不得远程下发任意 path、raw patch、template script、shell command或executable payload。
7. **Failure isolation**：account/token2api/vault/billing/entitlement failure只能降级Account Convenience Plane；Local Core Plane必须保持startup-independent和fully usable。

## Target Architecture

```text
Local Core Plane
  LocalPrincipal → existing workspace/conversation/engine/file/Git/terminal abilities
  no login, no vault, no network, no entitlement, no token2api startup dependency

Account Convenience Plane (opt-in)
  React renderer
    intent + credential-free presentation DTO
                       │ narrow typed IPC
                       ▼
  Tauri Rust / authority host
    DesktopAuthBroker ─ system browser + loopback + PKCE/state/nonce
    SessionManager ─── access memory + refresh singleflight/generation fence
    AccountVault ───── refresh/API key only, policy pending
    AccountRepository  independent multi-account-ready SQLite
    Token2ApiClient ── fixed HTTPS origin + typed closed errors
    RecipeCatalog ──── immutable versioned local allowlist
    ConfigPlanner ──── read-only fingerprinted safe plan/diff
    ApplyTransaction ─ journal + backup/stage/replace/verify/rollback/recovery
                       │
                token2api authority + exact target-host CLI config/runtime
```

- `LocalPrincipal` 继续拥有全部既有 local workspace data；未登录状态是完整的 **Local Mode**，不是 guest tier或受限层。`AccountLink` 只是 remote authority linkage，不重写既有 ownership。
- Internal identity使用 `AccountLink`、`Device`、session `generation` 与 `accountEpoch`；renderer/diagnostics不接收 internal IDs、authority subject、email、raw path或稳定 fingerprint。
- 首个 vertical release支持 `Desktop + local backend + local target host`；Comprehensive Master Plan仍包含remote/daemon/web/cloud。对应host capability未实现时返回 closed `capabilityUnavailable`，不允许“local config + remote runtime”假成功，也不得影响Local Core Plane。
- Vault 与 SQLite 没有跨存储 ACID；用 generation saga 协调 new secret、active metadata、old secret cleanup，并在 startup reconcile orphan/inconsistent generation。
- Config apply 不是跨文件全局 atomic rename，而是 journaled compensating transaction；terminal result发布前必须已有 durable receipt 或 recovery journal。

## Non-negotiable Invariants

1. **No-login completeness**：未登录用户可完整使用所有发布前已存在的本地能力；login UI不得用“继续使用受限版本”等暗示重新定义Local Mode。
2. **Startup independence**：app启动、workspace加载、local storage recovery、engine discovery与本地navigation不得等待account DB、vault unlock、token refresh、subscription/quota或token2api health。
3. **No local entitlement gate**：subscription、quota、usage、billing、grace period和revocation只控制新增account/token-service/cloud namespace；不得阻止或降级既有本地能力。
4. **Local ownership preservation**：`LocalPrincipal` 永不被 `AccountLink` 替换；logout、account deletion/switch或远端删除不会孤儿化、迁移、隐藏或重属既有local data。
5. **Three-consent boundary**：login、managed key provisioning、config apply是三次独立用户授权；login completion仅产生offer。
6. **No wrong-host mutation**：plan、consent、receipt绑定authority host、target host、device、recipe/version与file identity；host mismatch一律fail closed。
7. **No arbitrary remote recipe execution**：remote/server不得下发任意path、patch、template、command或script；本地immutable recipe catalog是唯一mutation authority。
8. **Durable terminal truth**：每个consented apply必须产生durable receipt或durable recovery journal；timeout、UI event或HTTP success不能作为transaction terminal truth。
9. **Payment credential exclusion**：card、bank、wallet credential与payment authentication只进入payment provider-hosted surface；不得经过doge renderer、Rust IPC、SQLite、vault、logs或support bundle。doge只保存nonsecret provider customer/subscription/payment-state references。
10. **Secret/raw content boundary**：refresh/API key仅按已确认vault policy持久化；access/password/TOTP/ticket/PKCE/plan/raw file/diff memory-only；raw old/new类型在编译期不能跨IPC。
11. **Unverified platform disabled**：未完成browser/vault/filesystem/reload实机matrix的平台或host capability默认disabled/hidden，禁止best-effort尝试后再报错。
12. **Account outage isolation**：token2api outage、session expiry、vault failure、quota exhausted、payment failure或后续phase未交付均不得改变Local Core Plane可用性。

## Security/Data/Observability Invariants

### Secret and data placement

| Data | Placement |
|---|---|
| refresh token、dedicated API key | OS credential vault only |
| access token、password、TOTP、desktop ticket、PKCE verifier | Rust memory only，最短生命周期 |
| plan、raw old/new、raw diff、new file bytes | Rust transaction memory only |
| account metadata、nonsecret cache、dismiss/result metadata、receipt/recovery journal | 独立 account SQLite；字段最小化 |
| renderer/client store | generic state、safe labels、closed outcomes；无 secret/internal ID/PII/path |

- Vault unavailable/locked时无 plaintext fallback；仅可按用户决策进入 explicit session-only，或 production fail closed。
- Authority origin来自 signed/build-channel config；renderer不能提交 base URL、redirect URI、path、content或patch。
- Browser callback仅携带 opaque `ticket + state`；ticket必须 MFA 后签发、short TTL、single-use、server-side hashed，并绑定 exact redirect、nonce与PKCE challenge。
- Config target由 immutable recipe推导；apply必须执行 no-follow/canonical identity/fingerprint recheck、backup、same-filesystem stage、fsync、platform-safe replace、verify、reverse rollback与startup recovery。
- `SafeText` 只能由 crate-private allowlisted constructor产生；malformed/unknown field fail closed。secret显示固定 semantic redaction，不保留可关联特征。
- Account observability采用 closed event/reason/metric schema，无 free-form `message/error/details/payload`；steady state不秒级 polling、不把 append-only event array挂在 AppShell root。
- Account support bundle必须使用独立 strict profile；允许 closed enums/count/duration/stage，禁止 generic client-store/path fingerprint、PII、IDs、URL/body/header、raw diff/config、backup/journal payload。默认 local-only、用户主动导出、不自动上传。
- 关键 health objective：同一 refresh wave最多一个 network rotation；stale generation commit 为 0；每个 consented apply必须有 terminal receipt或durable recovery journal；unrecovered partial mutation为 0。
- Payment checkout、card authentication与payment method management只能使用provider-hosted browser surface；doge只接收closed nonsecret settlement/subscription state，不记录payment credential、payment form payload或provider raw error。
- AccountConvenience event/store更新不得挂到Local Core startup/root render critical path；account data migration或corruption必须隔离并回到signed-out convenience state，而不是阻塞app启动。

## P0 Blockers

### token2api blockers

1. Persist revocation generation/`TokenVersion` through schema、migration、repository read/write，并以真实 DB reload integration证明旧 JWT 被拒绝。
2. 把 refresh改为 atomic consume-and-rotate，补 family membership/tombstone、reuse revocation与 lost-response idempotent retry。
3. 新增 desktop authorize/ticket/exchange contract；MFA完成后才签发，禁止复用 token-bearing Web fragment。
4. Harden API key：hash-at-rest；List/Get metadata-only；create one-time secret delivery不进入 audit/idempotency/log；清理 deleted raw secret exposure。
5. 修正 API key PUT omission semantics，避免未提供 ACL 时清空；CORS允许 `Idempotency-Key`；server/client始终使用稳定 logical-operation key。
6. 移除 2FA temp-token prefix/email debug log；所有 auth错误收敛为 safe machine reason。

### doge blockers

1. Rust-owned OS vault + generation saga/startup reconcile，无 plaintext fallback。
2. System-browser loopback broker + PKCE/state/nonce/single-instance callback ownership。
3. 独立 account SQLite schema/repository、corruption quarantine与Local Mode-safe recovery。
4. Session refresh singleflight、generation/accountEpoch fencing与closed session capability。
5. Immutable recipe + read-only plan/safe diff + anti-TOCTOU transaction/receipt/recovery；raw types在编译期不能进入 IPC。
6. Main-window-only narrow command capability、fixed HTTPS origin与strict account support bundle。
7. remote/backend host不匹配时 fail closed；未完成目标vertical release实机矩阵前不开放对应 platform recipe。

## Corrected Typed Contracts

### Orthogonal account state

```ts
type Lifecycle = "signedOut" | "authorizing" | "authenticated" | "expiring" | "revoking";
type SessionCapability = "persistent" | "sessionOnly" | "none";
type VaultState = "ready" | "locked" | "unavailable" | "inconsistent";
type Connectivity = "online" | "offline" | "serviceUnavailable";
type Freshness = "fresh" | "softStale" | "hardExpired";

type AccountView = {
  lifecycle: Lifecycle;
  sessionCapability: SessionCapability;
  vault: VaultState;
  connectivity: Connectivity;
  freshness: Freshness;
  canRefresh: boolean;
  canConfigure: boolean;
  canProvisionKey: boolean;
};
```

Lifecycle、credential capability、vault、connectivity与freshness必须正交；不得用一个 `degraded` string表达全部非法状态。2FA challenge是 authorization flow state，只有 MFA完成后才可产生 desktop ticket。

### Closed error and safe presentation

```ts
type BrokerStage = "authorize" | "exchange" | "refresh" | "vault" | "plan" | "apply" | "reload";
type BrokerError = {
  code: BrokerErrorCode;      // closed enum
  stage: BrokerStage;
  retryable: boolean;
  userAction: "retry" | "loginAgain" | "unlockVault" | "replan" | "contactSupport" | "none";
  messageKey: string;         // allowlisted i18n key
};
```

- `BrokerErrorCode` 必须覆盖 capability unavailable、ticket/state/replay、session/vault/generation、stale plan、unsafe target、permission/concurrent edit与rollback incomplete；不允许 raw upstream message。
- `SafeValue = Absent | Bool | Number | Enum | SafeText | Redacted`。`SafeText` constructor为 crate-private，要求 recipe field allowlist、长度/字符policy与secret scanner同时通过。
- Config IPC只接收 opaque `planHandle/fileHandle/resultHandle`；这些 handle不进入 diagnostics。raw path/content/patch/diff字段在类型中不存在。

### File and reload terminal truth

```ts
type FileOutcome =
  | "unchanged" | "applied" | "rolledBack" | "rollbackFailed"
  | "skippedPrecondition" | "failedBeforeWrite";

type FilesOutcome = {
  overall: "unchanged" | "applied" | "rolledBack" | "rollbackIncomplete" | "aborted";
  files: Array<{ targetLabel: string; outcome: FileOutcome }>;
};

type ReloadOutcome = {
  requirement: "none" | "newSessions" | "restartRequired";
  status: "notNeeded" | "pending" | "applied" | "failed";
};
```

- `FilesOutcome` 与 `ReloadOutcome` 分离；reload failure不能伪装为file rollback。
- `FileOutcome` 是 closed union，不使用 `status: string`。
- backend只有在 durable receipt或recovery checkpoint提交成功后才能发布 terminal `ConfigResultView`。
- `HardDismiss(account, device, recipeId, recipeVersion)` 与 result acknowledgement分离；ack只清当前 result badge。

## Phase Dependency Plan

```text
D0  Comprehensive decisions + OpenSpec/ADR/data namespace freeze
 ├── S0  Security/server hardening spine
 ├── H0  Local host account substrate
 └── C0  Immutable config/host/platform contract
       │
       └────── S0 + H0 + C0 ──────► R1 Local account vertical
                                      │
                                      ├──► R2 Managed key + read-only recipe plan
                                      │       │
                                      │       └──► R3 One-click apply/UI/recovery
                                      ├──► R4 Usage/quota/subscription/entitlement
                                      └──► R5 Billing + device/session + multi-account
                                                │
                                                └──► R6 Remote/daemon + web/cloud
                                                        │
                                                        └──► R7 Integrated hardening/GA
                                                                 │
                                                                 └──► Cn Additional recipes/platforms
```

| Phase | Scope and preserved dependencies | Exit gate |
|---|---|---|
| **D0 — Master Plan & Decisions** | 冻结双平面、full capability map、multi-account-ready identity/data namespace、three-consent model、vault/managed-key/recipe decisions、ADRs、validation/ownership/migration map | 用户关闭当前blocking decisions；正式OpenSpec artifacts完成strict review；明确仍不以Local Core作为entitlement target |
| **S0 — Security & Server Spine** | token2api persisted revocation generation、atomic refresh/family tombstone、MFA-after-ticket desktop exchange、API-key hash/metadata-only/audit/idempotency/ACL/CORS、2FA log cleanup、payment data boundary | DB reload、race/replay/lost-response、secret-recursive-scan与privacy tests通过；旧server capability不足时doge fail closed但Local Core正常 |
| **H0 — Host Account Substrate** | doge独立multi-account-ready SQLite、vault abstraction/generation saga、session singleflight/accountEpoch、loopback owner、fixed HTTPS client、strict support profile、startup isolation | vault unavailable/corruption/reconcile、callback三平台与no-login startup regression通过；无plaintext fallback行为由D0 policy决定 |
| **C0 — Config & Platform Contract** | immutable local recipe schema/catalog、target-host binding、no arbitrary remote payload、safe DTO、anti-TOCTOU file identity、journal/receipt/recovery、platform capability matrix与首个recipe fixtures | recipe/version/path/semantic fields冻结；raw IPC negative tests通过；未验证platform/host disabled；零文件mutation |
| **R1 — Local Account Vertical** | Desktop/local system-browser auth、profile、refresh、logout/revoke、optional Account Convenience UI；不包含managed-key/config mutation | login/MFA/expiry/offline/outage/restart矩阵通过；Local Core no-login/entitlement-independent baseline全绿 |
| **R2 — Managed Key & Read-only Plan** | 独立managed-key consent/provision/rotate/revoke；一个真实recipe完成discovery/fingerprint/changed-file list/lazy semantic safe diff；仍零写盘 | managed-key policy与server hardening gate通过；plan绑定account/device/host/recipe/version/digest/TTL；raw secret/diff不跨IPC |
| **R3 — One-click Apply & UX** | 第三次exact-plan consent、multi-file compensating transaction、receipt/recovery/reload、offer/modal/bubble/ack/hard dismiss/a11y/i18n | crash-point、Nth-file failure、rollback/reload、close/ack/reopen/applying、三平台matrix通过；每个terminal均有durable receipt/recovery |
| **R4 — Usage/Quota/Subscription** | quota/usage/subscription/entitlement read models、freshness/degraded/support、account/token-service capability namespace | outage/stale/expired/quota exhausted只影响新增namespace；Local Core gate scanner与regression通过 |
| **R5 — Billing/Device/Multi-account** | provider-hosted billing/portal/invoice state、device/session inventory/revoke/lost-device recovery、multi-account switching/isolation/migration | payment credential递归排除；per-account vault/DB/receipt/dismiss isolation；durable revoke evidence与account-switch race tests通过 |
| **R6 — Remote/Daemon/Web/Cloud** | device authorization、daemon vault/unlock、host-bound plan/apply、web/BFF credential boundary、remote capability negotiation | no wrong-host mutation；browser无refresh/API key；daemon/web outage不影响Desktop Local Core；每个host/platform实机验证通过 |
| **R7 — Integrated Hardening & GA** | end-to-end security/privacy、migration/retention/deletion、observability/support/SLO、scale/performance、rollout/rollback、kill switches | 全scope threat/QA/platform/recovery matrix与support drills通过；unresolved platform保持disabled；GA rollback演练完成 |
| **Cn — Capability Expansion** | Claude/Gemini/OpenCode及后续recipe、platform/host variants；每项沿用C0 contract，不重写transaction authority | 每个recipe独立evidence、fixtures、safe diff、apply/recovery、reload与platform flag验收；不接受remote arbitrary path/patch/command |

旧 PR0–PR11 研究依赖完整映射到新图：PR1/PR2/PR5 server blockers进入 S0；PR3/PR4 substrate进入 H0/R1；PR6先于PR7的recipe依赖进入 C0→R2；PR8/PR9进入 R3；PR10进入 Cn；PR11进入 R6。原有P0 gate与先后关系均保留，Master Plan新增R4/R5/R7以承载此前仅标为later的长期能力。

## Validation/Rollout/Rollback

### Validation matrix

- **Local Core baseline**：signed-out cold start、account DB corrupt/newer schema、vault locked/unavailable、offline/DNS/TLS/token2api 5xx、session expired/revoked、quota exhausted、subscription inactive、payment failed；所有既有local capability与startup path保持可用。
- **Auth/server**：MFA-before-ticket、state/nonce/PKCE mismatch、ticket replay/expiry、atomic concurrent refresh、lost response、revoke DB reload、access-only response。
- **Vault/DB**：new-vault-write → DB failure、DB activate → old-delete failure、orphan/missing ref、vault locked/unavailable、SQLite newer schema、`quick_check` failure/quarantine。
- **Config**：missing/malformed file、symlink/junction/reparse/hardlink、permission、concurrent edit、plan expiry/account switch、multi-file Nth failure、crash at each journal checkpoint、rollback/reload failure。
- **Privacy/IPC**：recursive forbidden-field/value scanner；canary secret不得出现在 serde DTO、renderer store、logs、metrics、notice、strict support bundle。
- **UI**：ordinary close、ack、reopen、hard dismiss、applying minimize、result unread、account change、recipe upgrade、keyboard/focus/screen reader/text expansion。
- **Billing/device/multi-account**：payment credential递归排除、provider-hosted redirect/settlement、device revoke receipt、account switch generation fence、per-account vault/DB/dismiss/receipt isolation。
- **Host/platform**：macOS/Windows/Linux loopback browser、OS vault、no-follow、safe replace、runtime reload；remote/daemon/web host identity与wrong-host rejection；未验证平台/host隐藏 capability。

### Rollout

1. 先完成 D0，再独立推进 S0/H0/C0；任一flag关闭或server capability不足时，仅Account Convenience Plane fail closed，Local Core保持完整。
2. 以 `accountConvenience`、`managedKey`、`configOnboarding`、`usageSubscription`、`billing`、`deviceSessions`、`multiAccount`、`remoteAccount`、per-recipe/per-platform flags分层启用。
3. R1 local account先internal/opt-in；R2 read-only planner dogfood；R3 apply先单platform小cohort，再完成三平台matrix后扩大。
4. R4/R5/R6分别独立canary，不与R3 big-bang发布；long-term scope保留不等于提前打开未验收capability。
5. Cn每个recipe/platform单独release；R7完成integrated security/support/rollback drill后才进入GA。

### Rollback

- Feature flag rollback只关闭入口，不删除 vault/metadata、不静默恢复用户配置。
- Config rollback由 durable receipt显式驱动；rollback incomplete保留bounded protected recovery artifact并向用户显示恢复动作。
- API-key plaintext migration采用 expand/dual-read/backfill/switch/stop-plaintext/drop-column；drop前保留受控 rollback window，但 public API切换后不再返回 raw secret。
- Account SQLite migration前备份 metadata；migration/corruption failure quarantine并回到Local Mode-safe path。
- Runtime reload hook按recipe独立关闭；reload失败保留已提交file receipt与retry，不把file outcome改写成rolled back。
- Subscription/billing/device/multi-account/remote rollout rollback只撤销对应新增namespace和入口，不删除LocalPrincipal data、不锁定local capability、不把既有local state迁回远端。
- Payment provider或billing integration rollback不得复制或接管payment credential；只撤销doge-side nonsecret references/capability projection。

## Decision Record

### DR-001 — Local Core Plane is fully usable without login

- **Status**：Confirmed by user。
- **Decision**：doge所有既有本地能力在不登录时完整可用；未登录状态是Local Mode，不是受限tier。account、token2api outage、subscription、quota、billing、grace period、session expiry/revocation均不得成为Local Core gate或startup dependency。
- **Consequence**：每个phase的blocking acceptance必须包含no-login baseline与outage isolation；entitlement只能控制新增account/token-service/cloud namespace。

### DR-002 — Account is an optional convenience plane

- **Status**：Confirmed by user。
- **Decision**：login用于帮助不会配置的用户，以及希望便捷接入doge token service的用户。`AccountLink`是opt-in linkage，不替换`LocalPrincipal`。
- **Consequence**：login、managed key provisioning、config apply必须三次独立授权；logout/account removal不会改变既有local data ownership。

### DR-003 — Comprehensive planning, phased implementation

- **Status**：Confirmed by user。
- **Decision**：Master Plan完整保留auth/profile/session、managed key、recipes、quota/usage、subscription/entitlement、billing/payment、device/session、multi-account、remote/daemon、web/cloud、安全隐私、migration/retention、observability/support、platform matrix与rollout/rollback。实施按D0/S0/H0/C0/R1–R7/Cn依赖推进，长期能力只能延后implementation，不能从plan删除。
- **Consequence**：首个vertical slice较小不构成scope reduction；每个deferred domain仍必须有target phase、dependency与exit gate。

## Open Decisions

### Next single decision — Vault unavailable policy

当OS credential vault unavailable/locked时，选择哪条产品policy？

- **A. Persistent-or-local（Recommended）**：只有vault可安全持久化时才建立persistent account session；否则保持完整Local Mode，并提示用户修复vault后再登录。无plaintext fallback、无session-only account。
- **B. Explicit session-only**：用户可明确选择仅本次运行的memory-only session；不可跨重启，且禁止managed key provisioning与config apply。退出或access expiry即回Local Mode。
- **C. User-unlocked doge vault**：doge提供用户解锁的encrypted local vault作为OS vault替代；需要独立KDF、unlock UX、memory hardening、rotation/recovery/backup与threat-model ADR，复杂度最高。

### Later decisions, after vault policy

1. **Managed key policy**：是否采用 dedicated `account × device × purpose` doge key（推荐），默认group/quota/expiry/rotation/revoke如何定义，以及是否允许复用既有高权限 key。
2. **First recipe**：Codex还是Claude？推荐Codex，因为current path/config/reload evidence更完整；需接受首期multi-file transaction/recovery成本。
3. **Operational details**：encrypted backup retention、manual rollback期限、orphan-key cleanup SLA、active runtime reload policy，以及Linux/headless unlock策略；在相关phase前逐项决策。

上述blocking decisions关闭前，不创建正式 `proposal.md`、`design.md`、`tasks.md`，也不进入 implementation。文档状态保持 `ready-for-user-decision`。

## Unverified Items

- OS vault具体 crate/backend、macOS Keychain/Windows Credential Manager/Linux Secret Service行为，以及 Linux unavailable/headless unlock policy。
- Loopback callback的 firewall、second-instance forwarding、browser focus与macOS/Windows/Linux packaging实机结果。
- token2api production TLS/HSTS/CORS/trusted-proxy/public-base-url配置及 deployment capability negotiation。
- Codex/Claude首个recipe的三平台 canonical path、symlink/reparse/permission、unknown field preservation与active runtime reload matrix。
- Dedicated key的默认 group/quota/expiry、orphan key cleanup SLA、encrypted backup retention与manual rollback期限。
- token2api account deletion/export、server audit/Redis backup retention与privacy/compliance claim。
- Billing/payment provider的production checkout/portal/webhook/idempotency/refund/chargeback contract；payment credential始终排除于doge。
- Device/session inventory、multi-account switching/migration、daemon/headless secure store、device authorization、web/cloud BFF与remote target host identity；均已纳入Master Plan但尚未实现或验证。
- Quota/usage/subscription freshness、entitlement namespace与outage semantics的正式server contract；Local Core不得受其影响已确认。

## Research Agents/Handoffs

| Lane | Durable handoff consumed by this synthesis |
|---|---|
| `doge_identity_map` / codebase-researcher | doge identity/session/storage/IPC/UI Impact Map；后续独立 change review校正 SQLite、callback、recipe order、remote host与release cut |
| `token2api_account_map` / backend-runtime research | token2api auth/profile/TOTP/OAuth/subscription/quota/usage/API-key System Map、route/schema/test evidence与P0 gaps |
| `post_login_config_ux_map` / product-design research | post-login offer、changed-file progressive disclosure、bubble/ack/hard-dismiss状态机与plan/apply interaction contract |
| `account_product_scope` / product-spec-owner | local-first optional account边界、non-goals与用户决策轴；最新PRD进一步确认双平面Comprehensive Master Plan |
| `account_config_security` / security-privacy-reviewer | vault、desktop auth、refresh race、anti-TOCTOU transaction、no-raw-IPC、privacy threat model与merge blockers |
| `account_data_mapping` / data-storage-engineer | `LocalPrincipal`/`AccountLink`/`Device`/session generation、vault+SQLite generation saga、retention/migration；后续复用为type-contract review |
| `account_solution_architecture` / solution-architect | Native Host Account Broker、loopback ADR、D0/S0/H0/C0/R1–R7/Cn Master Plan、rollout/rollback与next vault-policy decision |
| `account_observability` / observability-diagnostics-engineer | closed events/reasons/metrics、durable receipt/recovery evidence、strict support bundle、retention与support runbook |

`doge-project-lead` 对 handoff 冲突采用 evidence over vote：revoke-all 保持 P0；doge SQLite表述改为“已有pattern、缺account schema”；account state拆为正交维度；`FilesOutcome`/`ReloadOutcome`与durable terminal truth分离。用户随后确认Local Mode no-login completeness、optional account convenience与comprehensive-plan/phased-delivery；本文已用Decision Record与Master Plan吸收这些产品事实，只保留校准后的 durable conclusions。
