# token2api Account Integration — Parallel Backend Delivery Plan

> 状态：`backend-review-ready`（research / delivery-planning artifact；不授权 implementation）
>
> Project role：`backend-runtime-engineer`
>
> Scope：冻结与 UI 解耦的 parallel backend delivery boundary、semantic contract、test harness、dependency DAG 与 late-integration gate。
>
> Frozen baseline：doge `7c9af67c78ac`；token2api `7a9906d5d67e`。核对时 token2api 被引用的 route/handler/service/API 文件无本地修改；token2api 工作区另有与本计划无关的 docs/infra/lockfile 变更，不作为事实源。
>
> 上游输入：`research/synthesis.md`、`research/product-experience-blueprint.md`、`.trellis/tasks/08-11-integrate-token2api-account-system/prd.md`。

## 1. Outcome And Non-negotiable Boundary

本计划把 backend 拆成两个可独立交付、可独立验收的 lane：

1. **Lane T — token2api Authority**：继续持有 identity、password、email verification、MFA、OAuth identity、profile、session/revocation、API key、quota/usage/subscription/billing 的全部业务规则和 remote source of truth；只补 current contract 无法安全支持 Desktop 的最小 gap。
2. **Lane D — Doge Native Broker**：持有 Tauri/Rust native orchestration、fixed-origin HTTP adapter、OS vault、local account metadata、session singleflight/generation fencing、desktop callback ownership、closed error mapping、cancellation/idempotency coordination 与 credential-free projection；不实现 token2api 业务规则。

两条 lane 只依赖本文件冻结的 versioned semantic contract、conformance scenarios 与 sanitized fixtures。它们不依赖 Frontend layout、copy、React state 或真实 UI availability，也不互相 import source code。

后端并行交付的 blocking invariants：

- **Local Mode invariant**：signed out、flag off、vault unavailable、token2api outage、session revoked、quota exhausted 均不得阻塞或降级 doge 既有本地能力。
- **Zero-real-interaction before UI sign-off**：UI review 期间不允许真实 doge ↔ token2api 调用；Lane D 只连 stateful fake authority，Lane T 只运行 server-side contract/integration tests。
- **Authority singularity**：doge 不创建 user/password/MFA/quota/subscription/billing 的第二事实源，不复制 token2api handler/service validation。
- **Adapter replacement only**：UI 评审通过且两条 backend lane conformance 全绿后，才允许在 composition root 将 Mock adapter 替换为 Real adapter。
- **No DTO leakage**：token2api wire DTO、Rust persistence entity、vault record、Tauri command payload 均不是 renderer contract；renderer 只依赖由 Frontend lane 单独拥有的 product port。
- **No false completion**：单个 lane green、fake green 或真实 route 存在，都不等于 integrated/release-ready。

## 2. Evidence-backed Current API Classification

### 2.1 Evidence boundary

Current route facts来自 token2api：

- `backend/internal/server/routes/auth.go`
- `backend/internal/server/routes/user.go`
- `backend/internal/server/routes/payment.go`
- `backend/internal/handler/auth_handler.go`
- `backend/internal/service/auth_service.go`
- `backend/internal/handler/api_key_handler.go`
- `backend/internal/handler/dto/mappers.go`
- `backend/internal/server/middleware/cors.go`
- `frontend/src/api/auth.ts`
- `frontend/src/api/user.ts`
- `frontend/src/api/keys.ts`
- `frontend/src/api/usage.ts`
- `frontend/src/api/subscriptions.ts`
- `frontend/src/api/payment.ts`

分类含义：

- **Direct reuse**：业务 endpoint 与服务端规则可原样复用；doge 只做 typed transport、safe projection 和 lifecycle orchestration。
- **Thin adaptation**：不新增业务规则，但必须增加 Desktop transport/capability/error/version adapter 才能稳定接入。
- **True gap**：current API 无法表达 durable、atomic、single-use、Desktop-bound 或 secret-safe semantics；对应 capability 在 gap 关闭前 fail closed/hidden。

### 2.2 Direct reuse

| Capability | Current route / behavior | Doge reuse rule | Independent acceptance |
|---|---|---|---|
| Public capability discovery | `GET /settings/public` | 投影为 closed capability set；server disabled 始终优先 | Fake/real 返回相同 capability decisions；stale cache 不把 unknown 变 enabled |
| Registration verification | `POST /auth/send-verify-code`；`POST /auth/register` 接受 `verify_code` | 复用 email suffix、invitation、promo、Turnstile、rate limit、backend-mode rules | direct/verification-required/invalid/expired/cooldown scenarios |
| Password login and MFA challenge | `POST /auth/login`；`POST /auth/login/2fa` | `requires_2fa` 是 authorization intermediate outcome，不是 authenticated | MFA 前不产生 active Broker session；cancel/expiry 可重试 |
| Invitation/promo validation | `POST /auth/validate-invitation-code`；`POST /auth/validate-promo-code` | 只呈现 server result，不在 doge 重算 eligibility | enabled/disabled/invalid/used/expired matrix |
| Forgot/reset validation | `POST /auth/forgot-password`；`POST /auth/reset-password` | 抗枚举结果与 password validation 原样复用 | forgot 对 existent/non-existent email 保持同一 public outcome |
| Current user/profile | `GET /auth/me`、`GET /user/profile`、`PUT /user`、`PUT /user/password` | token2api 始终为 profile authority | optimistic UI 禁止；mutation 后以 authority response/readback 为准 |
| Identity/TOTP business rules | email binding、OAuth binding/unbinding、`/user/totp/**` | last-identity、verification method、TOTP enablement 由 server 决定 | allowed/blocked/last-identity/TOTP-disabled matrix |
| Usage/quota/subscription reads | `/usage/**`、`GET /user/platform-quotas`、`/subscriptions/**` | 仅形成 account-backed read model；不影响 Local Mode | fresh/stale/outage/empty/exhausted matrix |
| Groups/channels metadata | `GET /groups/available`、`GET /groups/rates`、`GET /channels/available` | 仅作为 server-controlled managed-key input | disabled/empty/unknown group 不由 doge 猜测 fallback |
| Billing/order business rules | `/payment/config|checkout-info|plans|channels|limits`、`/payment/orders/**`、public resume/resolve | 后续复用 provider/order/subscription authority；payment credential 不进 doge | capability off/pending/paid/failed/cancel/resume matrix |
| Redeem and announcements | `/redeem/**`、`/announcements/**` | 长期 Account Center 可直接复用；不属于 Foundation blocker | safe read/mutation mapping 与 flag isolation |

“Direct reuse”不表示可以立即接 Real adapter。所有 auth success 仍受 durable token-pair、refresh/revoke 与 Desktop completion prerequisites 约束；API key 仍受 secret lifecycle prerequisites 约束。

### 2.3 Thin adaptation

| Adaptation seam | Current fact | Required thin adapter | Forbidden coupling |
|---|---|---|---|
| Response envelope | token2api 使用 `{code,message,reason?,metadata?,data?}` | `Token2ApiWireDecoder` 校验 HTTP status + envelope + expected data schema | renderer 读取 `code/message/metadata` |
| Stable capabilities | public settings 是大量 flat fields | 归一化成 versioned `AuthorityCapabilities`，每项带 supported/enabled/requirements | UI 根据 raw setting name 分支 |
| Locale/timezone | Web client发送 `Accept-Language`，GET附 timezone | Native adapter按 allowlist 发送 locale/timezone；不复制 browser interceptor | UI 拼 HTTP headers/query |
| Pagination | usage/keys/orders 使用 current pagination envelope | 归一化 `Page<T>`，限制 page/page_size，拒绝 inconsistent totals | renderer依赖 token2api `pages/page_size` 细节 |
| Subscription route drift | current user router只有 `GET /subscriptions`、`/active`、`/progress`、`/summary`；Web helper另定义 `/subscriptions/:id/progress`，但该单项 route只存在于 admin surface | Broker以 router contract为准；若 bulk progress可安全按 owned subscription id投影则本地筛选，否则声明 unsupported/登记 gap | 复制 stale Web helper或误调 admin route |
| OAuth start/pending domain | provider start/callback/pending completion routes已存在 | 复用 provider与pending account rules；Desktop callback只携 opaque completion handle | renderer读取 token fragment/cookie/pending session token |
| Password reset domain | forgot/reset endpoint已存在 | 复用 reset validation；Desktop link只携 opaque reset handle | renderer持有 raw reset token或解析邮件 URL |
| Billing return | public order resolve/verify 已存在 | system browser return转为 opaque resume handle，再调用 current resolve | renderer依赖 provider query/string signature |
| Error normalization | 部分路径有 stable `reason`，部分仍只有 status/message | server reason allowlist + Broker closed mapping；unknown fail closed | raw upstream message成为 i18n/copy |
| Retry/timeout | current Web client统一 30s；route rate limits各异 | 每 operation 独立 deadline/retry policy，尊重 `Retry-After` | component-local timer或无限 retry |
| Cancellation | Gin/Tauri/reqwest 均可传播 context cancellation | read cancellation直接终止；mutation使用 outcome-unknown + reconcile policy | cancel被报告为确定“未执行” |
| Idempotency | user API key create已要求 `Idempotency-Key`；其他 user mutations不统一 | logical-operation key、request fingerprint 与 replay policy按第 7 节执行 | 每 retry生成新 key或 UI生成业务 idempotency |

### 2.4 True gaps and release blockers

| Gap ID | Evidence-backed gap | Minimum authority contract | Capability blocked until closed |
|---|---|---|---|
| `T-GAP-01` Durable auth success | `respondWithTokenPair` 在 refresh storage失败时 fallback为 access-only success | doge-compatible auth success必须返回 durable token pair；无法写 refresh state则整个 auth attempt失败，并由 capability signal声明 guarantee | register、password login、MFA/OAuth completion 的 persistent session activation |
| `T-GAP-02` Atomic refresh rotation | current `GET old → DEL old → mint new` 非 atomic；delete failure继续，new mint failure会丢 successor；并发可产生多个 successor | atomic consume-and-rotate；同一 `operation_id` bounded replay同一 successor；reuse触发 family tombstone；lost response可 reconcile | cold restore、automatic refresh、reliable cross-restart session |
| `T-GAP-03` Durable revoke generation | current user schema/repository未持久化 `TokenVersion`；`RevokeAllUserTokens` 的 increment不能形成可靠 DB-reload evidence | persisted revocation/session generation；access/refresh verification均比较；revoke-all在 DB reload/Redis loss 后仍成立 | revoke-all、password-change invalidation、lost-device claims |
| `T-GAP-04` Desktop authorization completion | current OAuth callback面向 Web frontend/cookie/fragment，未提供 doge-bound single-use exchange | state/nonce/PKCE绑定的 opaque Desktop completion ticket；MFA完成后才签发；single-use、short TTL、audience/device binding | OAuth login/register/bind 的 Real Desktop adapter |
| `T-GAP-05` Desktop reset-link handoff | forgot email用 configured frontend URL；reset token由 Web link携带 | doge-safe app/loopback handoff，向 renderer只交 opaque reset handle；raw token不进 UI/log | App 内 password reset completion |
| `T-GAP-06` API-key secret lifecycle | current `APIKey` DTO的 `key`用于 List/Get/Create；mapper返回 raw key；storage仍以 current raw secret工作 | hash-at-rest；List/Get metadata-only；Create one-time secret；lost-response/idempotency不重复创建或永久暴露；delete/rotate有明确 receipt | managed key provisioning/config recipe |
| `T-GAP-07` API-key update omission | `UpdateAPIKeyRequest.ip_whitelist/ip_blacklist` 为 non-pointer slices，omission与clear易混淆 | patch presence semantics；omitted/clear/set可区分，server validation canonical | safe managed-key maintenance |
| `T-GAP-08` Stable account error reasons | 多个 validation path通过 raw `BadRequest` 返回空 reason | 所有 UI-significant branch给 stable machine reason；message保持非契约 | Real adapter完整 closed error conformance |
| `T-GAP-09` Desktop capability/version negotiation | current public settings未声明 doge contract/version与上述 guarantees | authority contract version + individual guarantee bits；未声明即 unsupported | Real adapter enablement与safe rollout |
| `T-GAP-10` Device/session inventory and deletion | current user routes无 revoke-one/device inventory/self-service deletion | 留到 later phase的最小 server domain contract | Device & Sessions、remote account deletion UI |
| `T-GAP-11` Logout acknowledgement truth | current `POST /auth/logout` 在 refresh revoke失败时仅写 debug log并仍返回 success | 返回可验证的 idempotent remote revoke scope/outcome，或提供 operation reconcile/readback；失败不可伪装 confirmed | “远端 session 已撤销”声明；gap关闭前只能报告 local clear + remote unconfirmed |

`Idempotency-Key` 当前未列入 token2api CORS allow headers。Native Rust client不受 CORS 限制，因此它不是 Desktop Foundation blocker；若 future Web adapter复用相同 mutation contract，则必须在对应 release 前补 allow header 与 preflight tests，不能借此绕过 Native Broker。

## 3. Versioned Contract Freeze

### 3.1 Contract layers

本计划冻结三个互不替代的 contract layer：

```text
token2api HTTP / persistence
  └─ Authority Wire Contract: token2api-account-authority/v1
       └─ Token2ApiAuthority trait + wire mapper (Doge Native only)
            └─ Account Broker Core Contract: doge-account-broker/v1
                 └─ Frontend-owned AccountGateway/Product State Contract
                      └─ React views
```

- `token2api-account-authority/v1`：HTTP method/path/envelope/reason/capability guarantees；由 Lane T 拥有。
- `doge-account-broker/v1`：semantic operations、lifecycle、error/idempotency/cancellation semantics；由 Lane D 拥有。
- Frontend `AccountGateway`：用户可观察 state/journey；由 Frontend lane 拥有。本文件只规定 Real adapter必须能实现它，不定义其 view DTO/layout/copy。

禁止跳层：React不得直接消费 Authority Wire DTO；token2api不得为某个 component state新增字段；Rust persistence struct不得 derive 成 renderer response。

### 3.2 Version and compatibility policy

初始 freeze：

```text
authorityContract = 1.0.0
brokerContract    = 1.0.0
scenarioManifest = 1.0.0
fixtureSchema     = 1.0.0
```

SemVer policy：

| Change | Version action | Compatibility behavior |
|---|---|---|
| Rename/remove field、改变 required/optional、改变 terminal/error/idempotency semantics | major | major不匹配时 Account Convenience fail closed；Local Mode正常 |
| 新增 optional capability/operation/field、增加 closed enum variant并提供 unknown handling | minor | consumer capability negotiation；不支持项 hidden/unavailable |
| 修正文案无关 bug、测试fixture、同语义实现 | patch | 不得改变 observable contract |
| Unknown response field | none | Wire decoder忽略但保留 schema drift metric；不得转发 renderer |
| Unknown enum/reason | none | 映射 `upstreamContractUnknown`，相关 action fail closed；不得猜 fallback |
| Missing guarantee bit | none | 对应 capability unsupported，即使 route恰好存在 |

Authority capability descriptor至少包含：

```text
contractVersion
durableTokenPair
atomicRefreshReplay
durableRevocationGeneration
desktopOAuthTicket
desktopResetHandoff
apiKeyOneTimeSecret
apiKeyMetadataOnlyReads
stableErrorReasons
```

### 3.3 Frozen Broker semantic model

以下是 backend core contract，不是 renderer DTO：

```rust
trait AccountBrokerV1 {
    async fn capabilities(&self, ctx: CallContext) -> BrokerResult<CapabilitySnapshot>;
    async fn begin(&self, ctx: CallContext, operation: BrokerOperation) -> BrokerResult<BrokerReceipt>;
    async fn observe(&self, ctx: CallContext, handle: OperationHandle) -> BrokerResult<BrokerSnapshot>;
    async fn cancel(&self, ctx: CallContext, handle: OperationHandle) -> BrokerResult<CancelReceipt>;
    async fn reconcile(&self, ctx: CallContext, operation_id: OperationId) -> BrokerResult<BrokerReceipt>;
}
```

`BrokerOperation` 是 closed union，v1按 capability modules分组：

```text
Discovery:
  DiscoverCapabilities

Auth:
  SendRegistrationCode, RegisterEmail, LoginPassword, CompleteMfa,
  BeginOAuth, CompleteOAuth, RequestPasswordReset, CompletePasswordReset

Session:
  RestoreSession, RefreshSession, LogoutLocalAndRemote, RevokeAllSessions

ProfileSecurity:
  LoadProfile, UpdateProfile, ChangePassword,
  LoadIdentityBindings, BeginIdentityBinding, UnbindIdentity,
  LoadTotpStatus, BeginTotpSetup, EnableTotp, DisableTotp

AccountValue:
  LoadUsageSummary, LoadUsagePage, LoadPlatformQuotas,
  LoadSubscriptions, LoadPaymentCatalog, LoadOrders, ResolveOrder

ManagedKey (feature-gated):
  CreateManagedKey, LoadManagedKeyMetadata, RotateManagedKey, RevokeManagedKey
```

每个 operation携带：

- `operation_id`：由 Broker生成并durable/ephemeral记录到适当 ledger；同一 logical action retry保持不变。
- `account_epoch`：signed-out discovery/auth start可为空；authenticated mutation必须匹配 active epoch。
- `contract_version`：固定为支持的 major/minor。
- `deadline`：由 Broker policy生成，UI不能任意放宽。
- `cancellation_class`：`readCancelable | flowCancelable | mutationReconcileRequired`。

每个 terminal `BrokerReceipt` 必须明确：

```text
operationId
terminal = succeeded | rejected | cancelledBeforeSend | outcomeUnknown
authorityScope = notContacted | contacted | confirmed | reconciliationPending
sessionEffect = unchanged | activated | refreshed | locallyCleared | remotelyRevoked
nextAction = none | retry | reauthenticate | unlockVault | reconcile | contactSupport
safeProjectionHandle?   // opaque; no secret/path/raw payload
```

`MfaRequired`、`OAuthWaiting`、`ResetLinkWaiting` 是 nonterminal flow snapshot，不得伪装为 error或authenticated terminal。

### 3.4 Credential and DTO separation

类型边界必须物理分层：

| Layer | May contain secret | May serialize to renderer | Examples |
|---|---:|---:|---|
| Ephemeral command input | yes，最短生命周期 | request only；禁止回显/Debug/Clone/persist | password、TOTP、Turnstile response |
| Authority wire private DTO | yes | no | access/refresh token、desktop ticket、one-time API key |
| Vault record | yes | no | refresh credential、managed key secret |
| Broker core state | handle/reference only | no direct serialization | account epoch、vault ref、operation ledger |
| Safe broker projection | no | only through explicit mapper | lifecycle、capability、masked identity、freshness |
| Frontend product state | no durable secret | yes | screen/journey/view state owned by Frontend |

Required compile/test guards：

- private wire/vault types不得实现 renderer-facing conversion trait；secret types禁止 `Debug` 或使用 redacted implementation。
- Tauri commands只接受 narrow operation-specific request；不得暴露通用 `http_request`、raw token getter、raw vault getter。
- command output schema递归拒绝 `access_token`、`refresh_token`、`password`、`totp_code`、`ticket`、`api_key`、`cookie`、raw URL query/fragment等 forbidden fields/values。
- Safe mapper是唯一从 Broker core进入 Frontend adapter的路径；token2api `message` 不穿透。

## 4. Lane T — token2api Authority Delivery

### 4.1 Ownership

Lane T owns：

- current user-facing route compatibility与 version/capability descriptor；
- durable auth pair、refresh rotation、revocation generation；
- Desktop OAuth/reset handoff；
- API-key secret lifecycle与 idempotency；
- stable machine reasons与 server-side contract tests；
- fake/real authority conformance所需的 canonical wire fixtures。

Lane T does not own：

- doge vault、Tauri commands、local account DB、React state、UI copy/layout；
- doge configuration recipe、local file mutation；
- doge-specific duplicate identity/profile/session table；
- production source changes without token2api repo explicit approval。token2api `AGENTS.md` 要求先证明 configuration不足并评估 upstream merge impact。

### 4.2 Delivery slices

| Slice | Scope | Exit evidence |
|---|---|---|
| `T0-current-contract` | 为 direct-reuse routes建立 router/service contract suite；发布 authority v1 schema与 capability descriptor | current behavior golden tests；disabled/guard/rate-limit/error envelope matrix |
| `T1-session-hardening` | 关闭 `T-GAP-01/02/03`：no access-only fallback、atomic refresh replay、durable generation | concurrent refresh只有一个 successor；lost response同 operation replay；DB reload revoke仍有效 |
| `T2-desktop-completion` | 关闭 `T-GAP-04/05`：Desktop-bound OAuth ticket与 reset handoff | state/nonce/PKCE/audience/TTL/replay/MFA-before-ticket tests |
| `T3-key-hardening` | 关闭 `T-GAP-06/07`：hashed secret、metadata-only、one-time create、patch presence | recursive secret scan；lost-response replay；omitted/clear/set ACL tests |
| `T4-error-capability` | 关闭 `T-GAP-08/09`：stable reasons、guarantee bits、compatibility tests | every broker-required error maps without raw message parsing |
| `T5-later-domains` | device/session inventory、revoke-one、deletion等长期 gap | 独立 OpenSpec/release gate；不阻塞 Foundation之外的 Local Mode |

### 4.3 Authority acceptance without UI

Lane T在没有 doge UI、没有 doge Real adapter时即可 PASS：

1. 启动 token2api test router/service dependencies。
2. 运行 canonical authority scenario suite，输出 normalized trace。
3. 对 every mutation验证 idempotency/replay/cancellation-after-send semantics。
4. 对 auth/session运行 Redis failure、DB reload、concurrent refresh、lost response、replay、revoke tests。
5. 对 API key运行 recursive secret/value scan与 one-time delivery tests。
6. 将 sanitized canonical traces交给 fixture pack；不得采集 production traffic、token、email、cookie或 raw config。

Recommended commands在 implementation PR中按 token2api repo current scripts校准，至少包括 focused Go tests、`go test ./...`/相应 package tests、lint，以及 router conformance suite。命令是否全量执行由 PR risk决定，未执行项必须注明。

## 5. Lane D — Doge Native Broker Delivery

### 5.1 Ownership

Lane D owns：

- `AccountBrokerV1` state machine与 operation ledger；
- `Token2ApiAuthority` trait、Fake adapter、Real HTTP adapter；
- OS-vault-only refresh/managed-key credential handling；
- access token memory lifetime、refresh singleflight、account epoch/generation fencing；
- system-browser/loopback/app-link native ownership；
- typed HTTP decode、closed error mapping、deadline/cancellation/idempotency policy；
- safe projection、secret-negative tests、Local Mode isolation；
- Real adapter compiled/tested但在 UI sign-off前不接 production composition root。

Lane D does not own：

- token2api validation/domain rules；
- frontend journey/view model/layout/copy；
- arbitrary remote URL、arbitrary HTTP proxy command；
- session-only credential fallback、plaintext file/SQLite secret storage；
- Local Core startup gating、entitlement gating或 existing local workflow changes。

### 5.2 Internal ports

```rust
trait Token2ApiAuthorityV1 {
    async fn contract_info(&self, ctx: &AuthorityContext) -> AuthorityResult<AuthorityContractInfo>;
    async fn execute(&self, ctx: &AuthorityContext, request: AuthorityRequestV1)
        -> AuthorityResult<AuthorityReplyV1>;
    async fn reconcile(&self, ctx: &AuthorityContext, operation_id: &OperationId)
        -> AuthorityResult<AuthorityReplyV1>;
}

trait AccountCredentialVault {
    async fn availability(&self) -> VaultAvailability;
    async fn stage(&self, key: VaultKey, secret: SecretBytes) -> Result<VaultGeneration, VaultError>;
    async fn activate(&self, generation: VaultGeneration) -> Result<(), VaultError>;
    async fn delete(&self, key: VaultKey, generation: Option<VaultGeneration>) -> Result<(), VaultError>;
}

trait AccountMetadataRepository {
    async fn load_active(&self) -> Result<Option<AccountMetadata>, RepositoryError>;
    async fn commit_generation(&self, transition: AccountGenerationTransition) -> Result<(), RepositoryError>;
    async fn append_operation(&self, receipt: OperationLedgerEntry) -> Result<(), RepositoryError>;
}
```

这些 signature是 semantic freeze；crate/module/file placement在正式 Technical Design中按 doge backend directory rules确定。

### 5.3 Doge delivery slices

| Slice | Scope | Authority dependency | Exit evidence |
|---|---|---|---|
| `D0-contract-harness` | core types、traits、stateful fake、scenario runner、secret-negative scanner | frozen v1 fixtures only | Fake self-conformance与version negative cases |
| `D1-broker-core` | operation lifecycle、closed errors、deadline/cancel/idempotency/reconcile、epoch fencing | Fake | deterministic unit/property tests；no UI/Tauri required |
| `D2-session-vault` | OS vault adapter boundary、metadata generation saga、access-memory/refresh-vault、startup reconcile | Fake auth/refresh | vault locked/unavailable/inconsistent、crash points、refresh singleflight tests |
| `D3-native-auth-handoff` | browser launch、loopback/app-link owner、OAuth/reset opaque handles | Fake callbacks | wrong state/nonce/audience、replay、expiry、second instance/platform preconditions |
| `D4-real-wire-adapter` | fixed-origin HTTPS client、wire schemas、reason mapping、capability negotiation | T0 schema；Fake HTTP server | Real adapter runs against Fake HTTP authority；no renderer registration |
| `D5-account-operations` | profile/security/usage/quota/subscription/payment/key operation mapping | relevant authority routes/gaps | per-module broker conformance；unsupported capability fail closed |
| `D6-real-authority-conformance` | same Broker suite against token2api test deployment/router | T1–T4 as applicable | Fake vs real normalized traces match |
| `D7-integration-candidate` | Tauri narrow commands + safe mapper ready for Frontend Real adapter | UI port frozen/sign-off still required | command registry/runtime contract tests；feature remains off |

### 5.4 Broker acceptance without UI

Lane D的 acceptance binary/test harness直接调用 `AccountBrokerV1`；不 mount React、不 import Frontend mock、不访问真实 token2api：

- Fake authority驱动 registration/login/MFA/OAuth/reset/profile/session/usage scenarios。
- In-memory/fault-injecting vault与repository覆盖每个 transition/crash point。
- Fake clock控制 TTL、rate limit、refresh threshold、challenge expiry；禁止 sleep-based timing。
- Network guard断言 D0–D3无外部 socket；D4只允许绑定 ephemeral localhost fake server。
- Contract snapshot只包含 safe normalized trace；secret canary不得出现在 panic/error/log/serde/fixture。
- Local Mode harness在 Broker完全未构造、构造失败、authority hang、vault locked时均能运行 existing local baseline。

## 6. Stateful Fake Authority And Record/Replay Fixtures

### 6.1 Fake authority requirements

`FakeToken2ApiAuthorityV1` 不是一组 `mockResolvedValueOnce`。它必须是由 scenario manifest驱动的 stateful protocol simulator，至少持有：

```text
users / identity bindings / TOTP state
registration verification challenges
MFA and OAuth completion challenges
password-reset handles
access token metadata + refresh families + revocation generation
API-key metadata + one-time secret delivery state
usage/quota/subscription/order read models
idempotency operation ledger
capability/version descriptor
deterministic clock + scheduled faults/latency
```

Fake必须执行和 Real authority相同的 observable invariants，但不能复用 Real adapter production mapper或 token2api service code，以免共同 bug让 conformance false green。

每个 scenario声明：

- initial authority/broker/vault state；
- ordered client actions；
- scheduled latency/fault/cancellation point；
- expected request fingerprint与 operation id reuse；
- expected nonterminal/terminal normalized trace；
- authority state delta；
- secret-negative assertions；
- reset/replay behavior。

### 6.2 Canonical fixture pack

建议 logical layout（implementation时由 contract owner落盘，不由本 research artifact创建）：

```text
account-contract/v1/
  manifest.json
  schemas/
    authority-capabilities.schema.json
    authority-envelope.schema.json
    broker-trace.schema.json
    forbidden-fields.json
  scenarios/
    auth/*.json
    session/*.json
    profile-security/*.json
    usage-subscription/*.json
    managed-key/*.json
  traces/
    fake/*.json
    real/*.json
```

Fixture rules：

- 只从 ephemeral test authority生成；禁止 record production/staging personal traffic。
- email/user/id/order/key全部 synthetic；时间、UUID、operation id规范化。
- secret字段使用 typed placeholder（例如 `${SECRET:refresh:1}`），fixture writer在落盘前递归拒绝真实 canary value。
- Authorization/Cookie/Set-Cookie、query fragment、raw reset/OAuth ticket从 trace移除，只保留 `present/hashClass/lengthClass`等 nonsecret assertion。
- Error只记录 stable `reason/status/retryAfterClass`，不 golden raw message。
- Record tool与 replay tool使用不同 decoder；replay不能调用 production response mapper生成 expected值。

### 6.3 Fake/real conformance matrix

| Dimension | Fake assertion | Real authority assertion | Match rule |
|---|---|---|---|
| Contract/version | configurable exact/older/newer/missing | public capability descriptor | normalized support decision一致 |
| Success shape | schema-valid semantic reply | HTTP envelope decode后 semantic reply | safe normalized trace相同 |
| Error | closed stable reason | status + stable server reason | exact Broker error code/stage/action |
| Capability off | route behavior + disabled descriptor | server settings/guard | action unavailable，不尝试 mutation |
| MFA/OAuth/reset | challenge/ticket TTL/replay | real service/router | event order、single-use、terminal scope一致 |
| Refresh | atomic successor + operation replay | Redis/DB integration | one successor、same-op same reply、reuse tombstone |
| Revoke | generation survives fake restart | DB reload integration | old access/refresh均 rejected |
| Idempotency | request fingerprint ledger | server idempotency store | same key/same payload replay；different payload conflict |
| Cancellation | before-send/after-send fault points | cancelled context + reconcile | terminal scope/outcomeUnknown一致 |
| API key | metadata-only + one-time secret | DB/handler integration | recursive secret matrix一致 |
| Pagination/unknown fields | generated edge payload | router fixtures | normalized page与unknown handling一致 |
| Latency/rate limit | fake clock + retry-after | handler/rate limiter test | retryability与retry-after class一致 |

Conformance verdict只有 `pass | blocked-capability | fail`。`blocked-capability`要求 capability descriptor明确 unsupported；不得把缺 route/timeout误记为 pass。

## 7. Error, Idempotency, Cancellation And Refresh Contract

### 7.1 Closed Broker errors

```text
BrokerErrorCode =
  capabilityUnavailable | contractVersionUnsupported | upstreamContractUnknown |
  invalidInput | invalidCredentials | accountInactive | policyBlocked |
  challengeInvalid | challengeExpired | completionReplay |
  authExpired | sessionRevoked | reauthenticationRequired |
  rateLimited | conflict | idempotencyConflict |
  networkUnavailable | serviceUnavailable | timeout | cancelled |
  remoteOutcomeUnknown |
  vaultLocked | vaultUnavailable | vaultInconsistent |
  localMetadataCorrupt | localPersistenceFailed |
  managedKeyUnavailable | secretDeliveryFailed |
  internalInvariant
```

每个 error包含 `code`、`stage`、`retryable`、`nextAction`、optional bounded `retryAfter`、privacy-safe `correlationId`；不包含 raw URL/body/message、email、token、path或 provider credential。

Mapping priority固定：

1. local precondition/version/capability；
2. transport cancellation/timeout/DNS/TLS；
3. HTTP status；
4. allowlisted authority `reason`；
5. response schema；
6. unknown → `upstreamContractUnknown`。

禁止用 English/Chinese message substring判断业务原因。

### 7.2 Idempotency matrix

| Operation class | Key/retry policy | Cancellation/ambiguity policy |
|---|---|---|
| Pure reads | no durable op key；bounded automatic retry for connect/selected 5xx | cancel立即返回；无 mutation |
| Capability/profile/usage reads | request coalescing可用，不跨 account epoch复用 | stale result受 generation fence丢弃 |
| Send verification / forgot email | stable op id + server cooldown/dedupe window | after-send timeout不自动发第二封；reconcile或显示可重试倒计时 |
| Register/login/MFA completion | stable op id per user action；不得 silent auto-retry with new id | lost response先 reconcile；不得产生多个 refresh families |
| OAuth/reset completion | ticket single-use + stable op id | timeout后reconcile ticket；new flow必须显式重新开始 |
| Refresh | per-account singleflight + stable op id；server replay同 successor | after-send cancel/timeout进入 reconciliation；绝不并发 mint |
| Logout local | local cleanup自身 idempotent | remote失败不回滚本地退出；receipt标明 remote pending |
| Revoke all | server semantic idempotent；stable op id | 只有 authority confirmation才能声称 remotely revoked |
| Profile/security mutation | stable op id + account epoch + request fingerprint | ambiguous outcome readback/reconcile；不得盲 retry |
| API-key create/rotate | stable op id；one-time secret replay contract | 丢响应不得新建第二 key；secret未安全入 vault不报告 success |
| API-key delete | resource/account scoped idempotent | 404 after prior confirmed delete可归一化已删除；ownership mismatch不可 |
| Billing order create | server/provider idempotency key canonical | timeout以 order resolve/reconcile，不创建第二 order |

### 7.3 Cancellation semantics

- **Before dispatch**：`cancelledBeforeSend`，authority scope `notContacted`。
- **Read in flight**：abort transport并返回 `cancelled`；不得把 partial body作为 data。
- **Flow waiting**：cancel Broker flow，consume/expire local opaque handle；server ticket按 contract撤销或自然过期。
- **Mutation after bytes may have been sent**：返回 `outcomeUnknown`，保留 operation ledger并触发 bounded reconcile；UI离开不改变 authority事实。
- **App shutdown**：停止新操作；flush nonsecret operation ledger；不得为“干净退出”无限等待 network。
- **Account switch/logout**：increment account epoch；旧 callbacks/results可完成 diagnostics/reconcile，但不能提交到新 account projection。

### 7.4 Refresh and vault activation saga

1. Broker在 account epoch内取得 refresh singleflight owner。
2. 从 OS vault读取 current refresh generation；access token不从 renderer/storage读取。
3. 以 stable `operation_id` 调 atomic refresh。
4. timeout/lost response使用相同 old credential + operation id reconcile/replay；不得创建新 operation id。
5. 收到 successor后先 stage新 vault generation。
6. vault stage失败：不激活 session；best-effort revoke successor/family并记录 safe recovery；回到完整 Local Mode。
7. vault stage成功后提交 local metadata generation/account epoch。
8. metadata commit成功后 activate vault generation，再删除旧 generation；delete failure进入 bounded reconcile，不回退到 plaintext。
9. 只有 active vault generation + committed metadata + verified `/auth/me` 一致时，Broker发布 authenticated terminal。
10. 任一 late response携旧 epoch/generation时丢弃 projection并仅做安全 reconcile。

## 8. Feature Flags And Kill Switches

### 8.1 Doge flags

| Flag | Default before integration | Purpose | Off behavior |
|---|---:|---|---|
| `accountBrokerCore` | off | 构造 account module与 local metadata repository | module不构造；zero startup/network dependency |
| `accountFakeAuthority` | test/dev only | UI Mock/backend harness使用 fake | release build硬禁止选择 fake |
| `accountRealAuthorityAdapter` | off | 允许 Broker composition使用 Real adapter | 即使 binary含 adapter也不可调用真实 token2api |
| `accountDesktopAuth` | off | register/login/MFA/OAuth/reset | Account auth capability unavailable；Local Mode正常 |
| `accountProfileSecurity` | off | profile/TOTP/binding | 不显示/不注册对应 operation |
| `accountManagedKey` | off | one-time key/vault/config prerequisite | 不创建 key、不改 config |
| `accountUsageSubscription` | off | usage/quota/subscription reads | existing local usage保持原样 |
| `accountBilling` | off | payment/order flows | Local Mode与local config不受影响 |
| `accountDeviceSessions` | off | later device/session operations | hidden until server gap closed |

`accountRealAuthorityAdapter` 只能在 UI sign-off + C0 conformance gate后对 internal cohort开启；它与 product UI flag是双门。Backend CI必须覆盖 Real adapter compiled但未 composed。

### 8.2 token2api capability switches

token2api应通过 contract descriptor报告 guarantee，不以 deployment guess代替：

- `durable_token_pair_v1`
- `atomic_refresh_replay_v1`
- `durable_revocation_generation_v1`
- `desktop_oauth_ticket_v1`
- `desktop_reset_handoff_v1`
- `api_key_one_time_secret_v1`
- `stable_account_reasons_v1`

Server kill switch关闭时 descriptor先收敛，route再拒绝；Doge看到 unsupported立即 fail closed，且不 fallback到 Web fragment/access-only/raw key。

## 9. PR Dependency DAG And Parallel Schedule

### 9.1 DAG

```text
C0  Promote/freeze v1 contract + schemas + scenario manifest
├─ T0 current API conformance + capability descriptor
│  ├─ T1 durable pair + atomic refresh + durable revoke
│  ├─ T2 desktop OAuth/reset completion
│  ├─ T3 API-key secret/idempotency hardening
│  └─ T4 stable reasons/version compatibility
│       └──────────────┐
└─ D0 Broker types + fake authority + scenario runner
   ├─ D1 lifecycle/idempotency/cancellation core
   ├─ D2 vault/session generation saga
   ├─ D3 native OAuth/reset handoff
   └─ D4 Real wire adapter (tested only against fake)
       └─ D5 profile/security/value operation mapping

T0..T4 + D0..D5
        └─ C1 Fake/real authority + Broker conformance
             ├─ D6 token2api test-deployment conformance
             └─ D7 narrow Tauri integration candidate (flag off)

Frontend Mock lane + product review sign-off ───────────────┐
C1 backend conformance + guest regression + security gates ─┤
                                                            └─ I0 Real adapter composition PR
                                                                 └─ I1 real E2E/platform/manual QA
                                                                      └─ release canary
```

### 9.2 PR ownership and merge gates

| PR | Repo / owner | May run in parallel with | Must wait for | Merge gate |
|---|---|---|---|---|
| `C0` | doge OpenSpec/contract single owner | product/UI review research | current user decisions applicable to contract | architect + Frontend + Lane T/D sign-off；no implementation |
| `T0` | token2api Authority | `D0` | `C0` | current route conformance and descriptor |
| `T1` | token2api Authority | `T2`,`D1`,`D2` if files/ownership disjoint | `T0` primitives | DB/Redis race/reload/replay tests |
| `T2` | token2api Authority | `T1`,`D3` | `T0` | security review; ticket/reset single-use |
| `T3` | token2api Authority | `T1`,`D5` | `T0` | migration/rollback + secret scan |
| `T4` | token2api Authority | doge slices | `T0` | every required mapping has stable reason |
| `D0` | doge Backend | `T0` | `C0` | fake self-conformance; no network |
| `D1` | doge Backend | `T1` | `D0` | deterministic lifecycle matrix |
| `D2` | doge Backend + storage specialist gate | `T1` | `D0` | vault/crash/reconcile tests |
| `D3` | doge Backend + desktop/security gate | `T2` | `D0` | platform callback matrix |
| `D4` | doge Backend | `T1..T4` | `D0`,`T0 schema` | Fake HTTP conformance; Real origin hard-coded/configured safely |
| `D5` | doge Backend | Frontend Mock lane | `D1`,`D4` + relevant T gaps | operation module suites |
| `C1/D6` | both repos / contract owner | Frontend review | required T/D slices | normalized fake/real trace parity |
| `D7` | doge Backend | final UI review | `C1` | narrow IPC + safe DTO; feature off |
| `I0` | doge integration owner | none on shared composition files | UI sign-off、D7、C1、guest gate | adapter-only composition; no journey/DTO rewrite |

同一 shared schema/constants/contract fixture只允许 `C0/C1` contract owner修改；发现 change需要时两 lane停写、升级 contract version并重新跑全 conformance，禁止各自兼容分叉。

## 10. Backend Acceptance Matrix Without UI

### 10.1 Required scenarios

| Area | Required acceptance |
|---|---|
| Discovery | exact v1、newer minor、unsupported major、missing descriptor、capability off、stale/offline |
| Register | direct success、email code、invalid/expired code、invitation/promo/Turnstile、access-only rejection、lost response |
| Login/MFA | success、invalid credentials、inactive/policy blocked、MFA invalid/expired/cancel/success、no ticket before MFA |
| OAuth/reset | state/nonce/PKCE/audience mismatch、ticket expiry/replay、App closed/reconcile、reset used/expired |
| Session | cold restore、refresh threshold、singleflight、concurrent refresh、lost response、vault failure、DB reload revoke |
| Logout/revoke | local clear + remote success、local clear + remote pending、revoke-all confirmed、stale late response fenced |
| Profile/security | read/update/readback、change password invalidates old session、TOTP/binding allowed/blocked |
| Managed key | create one-time secret→vault、response lost、duplicate operation、metadata list/get、rotate/revoke、ACL omission |
| Value reads | usage/quota/subscription empty/fresh/stale/outage/exhausted；pagination/unknown fields |
| Billing | catalog disabled、create order idempotency、pending/paid/failed、resume/reconcile |
| Privacy | forbidden field/value recursive scan over replies/errors/logs/fixtures/support snapshot |
| Version | additive field、unknown enum/reason、missing guarantee、major mismatch |
| Cancellation | before-send、read in-flight、mutation after-send、shutdown、account switch |

### 10.2 Guest / Local Mode regression gate

Backend acceptance必须包含一个不依赖 Account UI的 guest harness：

| Initial condition | Required invariant |
|---|---|
| All account flags off | account module不构造；startup无 token2api DNS/HTTP/vault/account-DB access |
| Signed-out cold start | existing workspace/session/terminal/Git/settings/local usage路径可用 |
| token2api DNS/TLS timeout/5xx/hang | only account operation fails；App/local runtime不等待 authority |
| Vault locked/unavailable | no session-only/plaintext fallback；Local Mode完整 |
| Account metadata missing/corrupt/newer schema | quarantine/fail account module only；不阻塞 App startup |
| Refresh revoked/expired | account projection回 signed out；existing local state/data不删除 |
| Quota exhausted/subscription inactive/payment failed | only named token-service/account capability unavailable |
| Broker task cancelled/panicked | bounded settlement/diagnostic；不污染 root runtime locks或 local lifecycle |

Test instrumentation需断言：

- account module没有注册为 mandatory startup milestone；
- local commands不读取 account state或 entitlement；
- flag-off binary behavior与 pre-account baseline相同；
- authority client为 lazy construction，且 local flow outbound request count为 zero；
- account failures不进入 global fatal/startup guard channel。

### 10.3 Proportional commands for future doge PRs

每个 implementation PR按 ownership运行 focused Rust tests，并在 integration candidate至少运行：

```text
cargo test --manifest-path src-tauri/Cargo.toml <account-focused suites>
npm run check:runtime-contracts
npm run doctor:strict
npm run typecheck
npm run test                 # 或 documented affected batches
```

涉及 Rust shared runtime时增加 `cargo test --manifest-path src-tauri/Cargo.toml --no-run`/full affected tests；涉及 IPC mapping时加入 frontend binding tests。平台未实测必须标为 unverified，不能用 CI OS标签冒充 manual evidence。

## 11. Ready-for-integration Checklist

只有全部勾选，project lead才可批准 Real adapter composition：

### Contract and product

- [ ] Product Experience Blueprint获得用户/UI review sign-off。
- [ ] `authorityContract`、`brokerContract`、`scenarioManifest`、`fixtureSchema`版本冻结并有 single owner。
- [ ] Frontend product port不 import token2api/Rust/Tauri wire DTO。
- [ ] 所有 UI-required outcome/error/capability在 shared scenario manifest有唯一 semantic definition。
- [ ] 无 unresolved major contract change；minor capability均有 negotiation与 unknown handling。

### token2api Authority

- [ ] Direct-reuse endpoint matrix在 current router/service tests通过。
- [ ] `T-GAP-01/02/03/04/05/08/09/11`按首期需要关闭；managed key启用前额外关闭 `T-GAP-06/07`。
- [ ] Durable token pair无 access-only success。
- [ ] Refresh concurrent/lost-response/replay与 revoke DB reload evidence通过。
- [ ] Desktop OAuth/reset completion为 bound、short-lived、single-use、MFA-after-completion-safe。
- [ ] Required error branches均有 stable machine reason。
- [ ] Capability descriptor与真实 deployment guarantees一致。

### Doge Native Broker

- [ ] Broker core对 Fake authority全 scenario green。
- [ ] Real wire adapter对 Fake HTTP authority green，且尚未由 UI composition调用。
- [ ] Vault/session generation saga、singleflight、late-result fencing、startup reconcile通过 fault injection。
- [ ] Closed error mapping不解析 raw message；unknown contract fail closed。
- [ ] All mutation cancellation/idempotency/reconcile cases通过。
- [ ] Renderer-safe output递归 secret-negative scan通过。
- [ ] Narrow Tauri command注册、binding、main-window/capability constraints通过。

### Cross-lane conformance

- [ ] Fake authority与 token2api real test authority normalized trace matrix全绿。
- [ ] Doge Broker在 fake与real authority上产生同一 safe terminal/nonterminal semantics。
- [ ] Record/replay fixtures只含 synthetic/sanitized data，secret canary扫描全绿。
- [ ] Unsupported server/version/feature组合全部得到 `blocked-capability`，没有 silent fallback。

### Isolation and release safety

- [ ] Guest/Local Mode regression gate全绿。
- [ ] UI review runtime network/native guard仍证明 Mock phase zero real calls。
- [ ] `accountRealAuthorityAdapter` default off；fake adapter release build不可选。
- [ ] Authority/base origin、TLS、proxy、timeout policy完成 security review；无 arbitrary endpoint command。
- [ ] token2api与doge各自 rollback/kill switch演练通过。
- [ ] macOS/Windows/Linux未验证项清晰标注，未验证 capability保持 disabled。
- [ ] Integration PR只有 composition/mapping change，不包含 UI journey/layout/DTO rewrite。

## 12. No-UI-Rewrite Guarantee At Late Integration

Late integration“不要求 UI 重写”只有在以下保证条件同时成立时才成立：

1. **Frontend owns product state**：UI依赖 `AccountGateway`/scenario contract，不依赖 HTTP route、Tauri command名、Rust enum layout、DB field或 vault record。
2. **Mock and Real implement one port**：Mock adapter与 Real adapter在 compile-time实现同一 Frontend port；replacement只发生在 composition root。
3. **Backend maps, UI does not normalize**：Authority Wire → Broker Core → Safe Projection → Frontend Port的转换全部在对应 adapter完成；component不做 error/status/capability兼容。
4. **Observable semantics frozen**：loading/nonterminal/terminal、cancellation、outcome unknown、retry action、freshness与 capability off已在 scenario manifest覆盖。
5. **Capability negotiation explicit**：Real server少一个 feature时返回 unavailable/hidden state，而不是改变 journey shape或要求 UI读 raw setting。
6. **Closed errors complete**：所有 product-visible recovery action来自 closed error；raw server message变化不影响 UI。
7. **Opaque handles stable**：OAuth/reset/operation/receipt使用 opaque handles；UI不持有 token、ticket、URL fragment、operation ledger key或 local path。
8. **No mock-only fields**：Mock scheduler控制信息在 test harness，不进入 product DTO/store。
9. **Conformance before composition**：Real adapter未通过与 Mock相同 scenarios时不得接 UI；integration不用于发现基本 contract drift。
10. **Contract failure protocol**：若 Real adapter必须新增 UI branch/field/journey，立即停止 integration，回到 contract owner做 SemVer判定和 UI review；禁止在 I0 PR加临时兼容 boolean。

允许的 I0 diff只有：

- Real adapter factory/composition选择；
- narrow safe mapper wiring；
- feature flag/cohort config；
- integration/E2E fixtures与 diagnostics hook。

以下变化自动判定“保证失败”，必须退回 contract freeze：

- component/hook新增对 HTTP status/reason/raw message的判断；
- UI DTO新增 token2api/Rust persistence字段；
- Mock scenario为适配 Real behavior而删除已批准 journey；
- UI开始持有 refresh/access/API key/OAuth/reset secret；
- Local flow新增 login/quota/token2api check；
- adapter replacement要求改 route hierarchy、copy semantics、user action scope或 terminal truth。

## 13. Risks, Escalation And Explicitly Deferred Work

| Risk | Evidence/trigger | Required escalation |
|---|---|---|
| token2api source is upstream-tracked fork | token2api `AGENTS.md` | 任何 source/schema change先获用户明确批准并记录 upstream merge impact |
| Durable revocation requires schema/migration ownership | current user schema无 token version field | 调入 `data-storage-engineer`；定义 expand/backfill/rollback/DB reload evidence |
| Native callback/vault is platform-sensitive | macOS/Windows/Linux behavior未验证 | 调入 desktop/security specialist；未验证平台flag off |
| API key migration may expose/lose secret | current DTO/mapper返回 raw key | separate migration/threat review；禁止大爆炸 drop column |
| Billing/provider semantics are later scope | current routes存在但 production contract未核实 | 独立 billing release gate；不阻塞 Local Mode/Foundation auth |
| Device/session/account deletion absent | current routes未发现 | later OpenSpec；不得用 local metadata假装 remote completion |
| Fake drifts from real | parallel lanes长期开发 | C1 normalized trace gate + fixture version owner；定期 real test refresh |

明确 deferred：

- 本计划不设计 UI，不决定 layout/copy/interaction细节。
- 本计划不实现 doge/token2api source、schema、migration、fixtures或 tests。
- 本计划不冻结 future device authorization、daemon/web BFF、multi-account UI、configuration recipe/apply contract。
- 本计划不把 token2api current Web localStorage/cookie strategy带入 doge。
- 本计划不允许为赶进度跳过 UI sign-off后再“边联调边改 contract”。

## 14. Delivery Verdict

Backend可以在 UI 尚未实现或尚未评审时独立达到以下两个可验证 verdict：

- **Lane T accepted**：token2api current reuse与所需 gap在 server-side conformance suite通过，能够输出 sanitized authority v1 trace。
- **Lane D accepted**：Doge Native Broker在 stateful fake authority、fault-injecting vault/repository与 Local Mode harness上通过 broker v1 acceptance；Real wire adapter仅在 test composition中通过 conformance。

只有 `Lane T accepted + Lane D accepted + Fake/Real C1 pass + UI sign-off + guest regression pass` 同时成立，才进入 I0 Real adapter composition。I0若要求修改已批准 UI journey或 renderer contract，即视为 contract failure，而不是正常联调成本。
