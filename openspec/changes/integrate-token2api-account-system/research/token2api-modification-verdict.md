# token2api Modification Verdict for doge Account Integration

> Review role: `security-privacy-reviewer`
>
> Review date: 2026-08-12
>
> Scope: current working trees of `doge` and `/Users/jason/GitHub/token2api`; no production probe, no destructive test, no source implementation
>
> Verdict strength: static code/route/schema/test evidence; deployment/runtime/platform behavior仍需 implementation release gate

## 1. 用户可理解结论

**最终 verdict：为了让 doge“完整、安全地”复用 token2api 账号能力，`/Users/jason/GitHub/token2api` 必须修改；但不是所有账号能力都要重写。**

- doge 本地打包本身、Mock-first UI、Local Mode，以及只读 public/profile/usage 基础联调，**不要求**先改 token2api。
- email registration/verify、password login、forgot request、profile、TOTP management、usage/quota 和 subscription 的大部分业务规则已经存在，应该经 doge Rust broker直接复用，**不应**在 doge 重造账号后端。
- 一旦 release 宣称支持 persistent desktop session、完整 App 内 OAuth/reset、可靠 revoke/logout，或一键配置所需的 managed API key，当前 token2api contract就不够：部分问题位于 server atomicity、database durability、browser callback 和 secret-at-rest 边界，doge 客户端无法补救。
- token2api 当前 checkout为 `7a9906d5d67e8db137ac199c3ab3a7d4224c285b`，落后 `origin/main` 10 commits；`origin/main` 已同步到 Sub2API `v0.1.168`，但本地可见的 upstream `v0.1.172` 还包含 OAuth pending flow账号接管修复 `02e50cc22`。**任何 OAuth real release前，必须先把该 upstream security fix纳入 fork baseline。**

因此，“只要 API 能调通”只在以下窄场景足够：开发期 Mock、无 secret 的只读页面、或明确不承诺跨重启 session / OAuth / App 内 reset / managed key / remote revoke truth 的内部 PoC。它不等于本 change定义的完整、安全、可发布账号体系。

## 2. Evidence boundary 与仓库状态

### 2.1 被核对的事实源

- doge requirement/research：
  - `.trellis/tasks/08-11-integrate-token2api-account-system/prd.md`
  - `openspec/changes/integrate-token2api-account-system/research/{synthesis,app-account-api-integration,parallel-backend-delivery-plan,mock-first-frontend-architecture,product-experience-blueprint}.md`
- token2api route/handler/service/schema/migration/test：
  - `backend/internal/server/routes/{auth,user}.go`
  - `backend/internal/handler/{auth_handler,auth_oauth_pending_flow,auth_email_oauth,user_handler,totp_handler,api_key_handler,usage_handler,subscription_handler}.go`
  - `backend/internal/service/{auth_service,auth_pending_identity_service,totp_service,api_key_service,subscription_service}.go`
  - `backend/internal/repository/{refresh_token_cache,totp_cache,user_repo,api_key_repo}.go`
  - `backend/ent/schema/{user,api_key,idempotency_record,pending_auth_session}.go`
  - `backend/migrations/{057_add_idempotency_records,122_pending_auth_completion_token_cleanup,145_deleted_api_key_audit}.sql`
  - 对应 `*_test.go` 与 frontend API/type contract。

### 2.2 Version qualifier

| Fact | Evidence | Consequence |
|---|---|---|
| current checkout落后 fork remote | `git status --branch`：`main...origin/main [behind 10]` | 当前文件 verdict不能替代从 clean `origin/main` 建 release branch。 |
| fork remote baseline是 upstream `v0.1.168` | `origin/main` 包含 `886c44b1b Sync upstream v0.1.168`；`backend/cmd/server/VERSION=0.1.168` | 不得把 local `upstream/v0.1.172` 的修复误认为 fork 已包含。 |
| upstream `v0.1.172` 有账号接管修复 | tag `upstream/v0.1.172` 包含 `02e50cc22 fix(security): block OAuth account takeover via pending exchange` | OAuth release前必须完整 sync至安全 baseline或最小 backport并运行回归测试。 |
| `v0.1.172` 仍未关闭本文大多数 server gaps | 该 tag仍有 access-only fallback、`GET -> DEL -> mint` refresh、raw API key、Redis-only revoke | “先升级 upstream”是必要条件，但不是完整解决方案。 |

本评审没有读取或输出任何真实 credential，也没有把 working-tree中其他人的未提交改动当成本任务产物。

## 3. Threat Review boundary

### 3.1 Assets / data classification

| Data/asset | Classification | Required boundary |
|---|---|---|
| password、TOTP code、OAuth code、reset token、MFA temp token、PKCE verifier | ephemeral secret | 最短生命周期；只在 system browser或 doge Rust memory；不得进入 renderer store/log/report。 |
| refresh token、managed API key | durable credential | doge端只进 OS vault；token2api端不得 plaintext-at-rest或由 List/Get反复返回。 |
| access token、desktop completion ticket | short-lived credential | Rust memory；ticket short TTL、single-use、绑定 purpose/state/PKCE/app instance。 |
| email/profile/identity binding | PII/account security data | server authority；Rust allowlist projection；generic diagnostics不记录。 |
| usage/quota/subscription | account-confidential metadata | 与 doge Local usage明确分源；带 freshness/partial evidence。 |
| revocation generation、refresh family、idempotency outcome | security state | server atomic/durable；HTTP success不能替代 terminal truth。 |

### 3.2 Trust boundaries

```text
React renderer (untrusted for secrets)
  -> narrow Tauri IPC / AccountGateway
  -> doge Rust broker + OS vault
  -> fixed HTTPS token2api origin
  -> token2api auth/service/database/Redis
  -> email and OAuth provider-hosted browser surfaces
```

关键 attacker capabilities：并发/replay旧 token、丢失 HTTP response后重试、读取被泄露的 DB/backup/log、控制 renderer输入、诱导 OAuth pending state、让 Redis/DB/network在 mutation中途失败。本文只报告能落到当前 code path 的问题。

## 4. “无需修改 / 必须修改 / 可后置”总矩阵

| Capability/domain | Verdict | 可直接复用的部分 | Release blocker |
|---|---|---|---|
| Local Mode、Mock UI、本地打包骨架 | **无需修改 token2api** | doge 本地能力与 Mock scenario | Real adapter必须 default off；不得声称账号 integration完成。 |
| `GET /settings/public` capability bootstrap | **无需修改业务 endpoint** | 当前 flags/policy | Real rollout前仍需 versioned guarantee descriptor；见 M8。 |
| registration email code/policy | **无需修改业务规则** | `/auth/send-verify-code`、email suffix、Turnstile、invitation/promo policy | persistent auth success受 M2 阻塞；stable reasons受 M8 阻塞。 |
| password register/login | **必须小改 server terminal contract** | `/auth/register`、`/auth/login`、现有 service rules | access-only fallback必须删除；MFA temp session必须 atomic consume。 |
| TOTP MFA / profile security | **多数无需修改；MFA completion必须改** | `/user/totp/**`、profile、change password、identity rules | M3（MFA replay/log）与 M4（durable revoke）未关前不能宣称 session security闭环。 |
| forgot-password request | **无需修改 request endpoint** | enumeration-resistant `/auth/forgot-password` | App 内 reset completion受 A2 阻塞；Web-only fallback可以单独上线。 |
| App 内 password reset | **必须 thin server adapter** | 复用 `ResetPassword` domain validation/consume | 当前 email link直接携带 raw email/token到 Web URL。 |
| OAuth login/register/bind | **必须 thin server adapter + security baseline** | provider exchange、identity resolution、pending choices | M1账号接管修复和 A1 desktop ticket均为 blocker。 |
| refresh / cold restore | **必须修改 token2api** | token format、family concept、hash storage | M2 atomic consume/rotate/lost-response未关前不能启用 durable auto-refresh。 |
| revoke-all / explicit all-session invalidation | **必须修改 schema/repository** | refresh-token cleanup；改密另由 durable `password_hash`变化使旧 token fingerprint失效 | M4 durable generation与 DB reload evidence。 |
| logout | **必须修改 outcome contract，或降级声明** | local credential clear永远可做 | M5未关前 UI只能说 `signedOutLocally/revocationUnconfirmed`。 |
| profile read/update | **无需修改业务 endpoint** | `/auth/me`、`/user/profile`、`PUT /user` | Rust DTO allowlist；不要把 raw identity subject/internal fields送 renderer。 |
| usage/quota/subscription list/summary | **无需修改基础 endpoint** | `/usage/**`、`/user/platform-quotas`、subscription list/summary | 必须带 source/fetchedAt/freshness；不能 gate Local Mode。 |
| subscription progress | **完整功能必须改；Foundation可后置** | service计算可复用 | M9 shape/partial truth；不展示 progress时不是 auth blocker。 |
| managed API key / one-click config | **必须修改 schema/API/secret lifecycle** | group/permission/quota business rules | M6关闭前禁止自动创建并写入 CLI config。 |
| API key ACL maintenance | **必须以更新 baseline为前提** | `origin/main` 已把 list改为 pointer presence semantics | current checkout仍会 omission-clear；至少同步 `origin/main` 并跑 omitted/clear/set tests。 |
| device/session inventory、revoke-one、account deletion | **可后置** | current无对应普通用户 route | 仅阻塞对应 UI；不得用 local metadata伪装 remote completion。 |
| billing/payment | **可后置且独立 gate** | provider-hosted checkout/order reads可复用 | card/bank/wallet data永不进 doge；settlement由 token2api truth确认。 |
| auth PII/secret logging | **必须收口** | closed reason与匿名 metrics可保留 | M10未关前 production auth logs可能记录 email或 credential fragment。 |

## 5. Current direct-reuse matrix

“Direct reuse”统一指 **React不直连**；doge Rust broker调用 current API，校验 envelope/schema后投影 renderer-safe DTO。

| Journey | Current path/symbol | Current evidence | Direct-reuse decision / test point |
|---|---|---|---|
| capabilities | `routes/auth.go::RegisterAuthRoutes` → `GET /settings/public`; `SettingService.GetPublicSettings` | registration/email reset/Turnstile/OAuth/backend mode已有 public flags与 tests | 直接读；allowlist投影。测试 disabled/unknown/stale时 fail closed。 |
| send registration code | `POST /auth/send-verify-code`; `AuthHandler.SendVerifyCode` | server执行 Turnstile、email policy、Redis fail-close rate limit | 直接调；只返回 cooldown，不转发 message。测试 existent/nonexistent policy、429/503。 |
| register | `AuthHandler.Register` → `AuthService.RegisterWithVerification` | current tests覆盖 disabled、verify required/invalid、email conflict/race、suffix、defaults | 业务规则直接复用；只有得到完整 durable token pair才判 authenticated。 |
| login | `AuthHandler.Login` → `AuthService.Login` | active/backend mode/Turnstile与 TOTP branch存在 | password auth直接复用；MFA前只返回 opaque broker flow handle。 |
| login MFA | `POST /auth/login/2fa`; `AuthHandler.Login2FA` | current能验证 code与完成 OAuth bind | 请求/业务规则可复用；server必须先关闭 M3 atomic consume/log blocker。 |
| forgot request | `AuthHandler.ForgotPassword`; `AuthService.RequestPasswordResetAsync` | 对不存在/inactive/send failure均保持 public success | 直接调；UI只显示 neutral dispatched outcome。App内完成需 A2。 |
| reset validation | `AuthService.ResetPassword` | server one-time consume、password hash、session cleanup意图已存在 | 不复制 domain；由 A2 opaque handoff进入相同 service。 |
| profile | `/auth/me`, `/user/profile`, `PUT /user`, `PUT /user/password` | JWT owner context；identity/profile tests存在 | 直接调并裁剪 PII；mutation后 readback。 |
| TOTP management | `/user/totp/{status,verification-method,send-code,setup,enable,disable}` | feature/method/password/email verification由 server决定；seed at rest AES-GCM | 直接复用；setup secret只在 purpose-specific view短暂显示。 |
| identity maintenance | `/user/account-bindings/**`, `/user/auth-identities/bind/start` | last-login-method guard和 binding tests存在 | email binding直接；OAuth binding走 A1 desktop transport。 |
| usage/quota | `/usage/**`, `/user/platform-quotas` | ownership checks与 privacy-focused handler tests存在 | 直接读；单独标为 token2api source，不与 Local usage混算。 |
| subscription basics | `/subscriptions`, `/active`, `/summary` | routes与 handler输出已存在 | 直接读；progress例外见 M9。 |

## 6. Thin Desktop Adapter：必须新增，但不重写账号后端

### A1 — Generic Desktop OAuth authorization/ticket/exchange

**Required scope**：新增 generic `/api/v1/desktop/v1/...` transport（不要命名为 doge-specific business domain），复用 current provider exchange、identity、invitation、adoption、bind与 MFA service。

Minimum contract：

1. create authorization：provider/intent、PKCE challenge、state hash、app-instance/device public id、fixed registered redirect binding；
2. browser callback只把 pending/terminal state绑定到 authorization record；
3. 仅在 MFA、invitation、create/bind/adoption完成后签发 short-lived、hashed-at-rest、single-use ticket；
4. loopback/custom scheme只携 opaque `ticket + state`，不携 access/refresh/pending token；
5. Rust用 `ticket + PKCE verifier + state` exchange，token pair只进入 Rust。

Evidence：

- `auth_email_oauth.go::emailOAuthCallbackWithProfile` current lines 210–216把 access/refresh token放入 URL fragment。
- `auth_oauth_pending_flow.go::ExchangePendingOAuthCompletion` current依赖两枚 browser cookie，并在 terminal branch把 token pair放入 response payload。
- `AuthPendingIdentityService.IssueCompletionCode/ConsumeCompletionCode` 已有 hashed、TTL、browser-bound、one-time primitive与 unit tests，但 production code没有调用该 primitive；它是可复用地基，不是已完成 Desktop endpoint。

Acceptance tests：state/PKCE/audience/app-instance mismatch、expired/replayed ticket、two simultaneous exchange exactly one success、MFA前绝不发 ticket、callback/response/log/DB递归无 token、App未运行时 Web fallback仍安全。

### A2 — Desktop password-reset handoff

复用 `/auth/forgot-password` 和 `AuthService.ResetPassword`，只新增 opaque completion transport。当前 `EmailService.SendPasswordResetEmail` 构造 `...?email=...&token=...` Web URL；doge renderer不得接收这两个 raw值。

Acceptance tests：ticket purpose/device/redirect/TTL binding、single-use/replay、expired/consumed closed reason、App与 Web fallback不能双重完成、query/log/support bundle无 raw reset token。

### A3 — Authority capabilities/version descriptor

`GET /settings/public` 继续承载业务 flags；另提供 stable contract version与 guarantee bits，例如 `durable_token_pair_v1`、`atomic_refresh_v1`、`durable_revoke_v1`、`desktop_oauth_ticket_v1`、`desktop_reset_handoff_v1`、`managed_key_one_time_v1`。doge遇到 unknown/missing guarantee必须隐藏/阻断对应 capability，不能“试一下再说”。

## 7. Mandatory token2api changes 与每项 release blocker

### M1 — 先纳入 upstream OAuth account-takeover fix

- **Severity**：P0；OAuth release blocker。
- **Evidence**：current `auth_oauth_pending_flow.go::ExchangePendingOAuthCompletion` 在 `canIssueTokenPair == false` 的 choice state，只要 request带 adoption decision，仍可到达 `applyPendingOAuthAdoption(... session.TargetUserID)`。Upstream commit `02e50cc22` 增加 terminal/bind-intent guard；`TestExchangePendingOAuthCompletionChoiceStateDoesNotBindIdentity` 复现攻击者把 identity绑定到 victim的路径。
- **Required mitigation**：从 clean `origin/main` 完整同步经过 `v0.1.172` 的安全 delta，或最小 backport `02e50cc22`；semantic merge current fork customizations，不做整文件覆盖。
- **Acceptance**：运行 upstream regression test；另断言 victim identity/profile不变、pending session未消费、无 token签发。
- **Ownership/upstream impact**：这是 upstream-owned fix，不应维护 fork-only平行实现；优先同步 release而非自行改写。

### M2 — Durable auth success + atomic refresh rotation

- **Severity**：P1；所有 persistent desktop session、cold restore和 automatic refresh blocker。
- **Evidence A**：`AuthHandler.respondWithTokenPair` 在 `GenerateTokenPair`/refresh storage失败时 fallback为 access-only `success`。
- **Evidence B**：`AuthService.RefreshTokenPair` 执行 `GetRefreshToken -> DeleteRefreshToken -> GenerateTokenPair`；delete失败继续，mint失败会在旧 token删除后留下无 successor；并发 callers可同时读到旧 token。`upstream/v0.1.172` server仍相同。其 frontend Web Locks修复只协调 browser tabs，不能覆盖 doge、其他设备、lost response或多实例 server。
- **Required mitigation**：auth completion只有 durable pair或整体失败；server atomic consume-and-rotate，持久化 family tombstone与 bounded operation-id result；reuse撤销 family；lost response以同 operation id取回同一 successor。
- **Acceptance**：
  - refresh store不可用时 register/login/MFA/OAuth不返回 authenticated success；
  - 50+ concurrent same-old-token calls exactly one rotation，其他为 replay same successor或 closed reuse outcome；
  - crash/fault injection覆盖 consume前、consume后/mint前、mint后/response前；
  - old-token replay触发 family tombstone；Redis/server restart后 outcome仍符合 contract；
  - doge Rust singleflight只能作为额外防线，不能替代这些 tests。
- **Ownership/upstream impact**：通用 auth correctness，应优先提交 upstream；若先在 fork落地，改动集中在 refresh cache/service与 migration，建立独立 conformance tests降低后续 sync冲突。

### M3 — MFA temp session atomic consume + sensitive log removal

- **Severity**：P1；email/password MFA与 OAuth-bind MFA release blocker。
- **Evidence**：`AuthHandler.Login2FA` 先 `TotpCache.GetLoginSession`，验证并可能执行 identity binding，最后 best-effort `DeleteLoginSession`，delete error被忽略；同一 temp token可在并发窗口被重复使用。相同 path还记录 temp-token prefix和完整 session email。
- **Required mitigation**：使用 Redis atomic claim/consume（Lua或等价 compare-and-delete/processing state）；副作用与 terminal token issue建立 exactly-once/idempotent界面；删除 token prefix和 email debug值，只保留 closed reason、长度级别或 hashed correlation id。
- **Acceptance**：并发相同 `temp_token`只有一个成功；Redis delete/claim failure fail closed；OAuth binding副作用只发生一次；log canary scan不含 temp token任何 substring、email、TOTP code。
- **Ownership/upstream impact**：通用 MFA hardening，优先 upstream；doge不应创建私有 MFA endpoint绕过修复。

### M4 — Durable revoke generation

- **Severity**：P1；revoke-all、explicit all-session invalidation与 lost-device safety blocker。改密已通过 durable `password_hash`变化产生新 fingerprint，不是本 finding声称的缺口。
- **Evidence**：current `ent/schema/user.go` 没有 `token_version`；current checkout `RevokeAllUserTokens` 自增 service field后调用 `userRepo.Update`，但 repository不写该 field。`origin/main`/`upstream/v0.1.172` 已明确移除这次无效 update，只删除 Redis refresh sessions；因此已签发 stateless access token在 Redis清理后仍可用到 expiry。
- **Required mitigation**：新增 persisted `session_generation`（或等价 durable revocation fact）及 migration/backfill；access/refresh issuance与validation都比较；revoke-all在 durable increment成功后返回 typed receipt，Redis cleanup可重试但不能反转 durable truth。
- **Acceptance**：真实 DB commit + process reload + Redis flush 后，旧 access/refresh均被拒；并发 revoke/refresh线性化；migration rollback/compat matrix；新旧 server滚动部署策略明确。
- **Ownership/upstream impact**：schema/generated Ent/repository/JWT cross-layer change，冲突面高；需 data-storage owner，最好 upstream design先行。Fork实施必须记录 full migration与未来 upstream sync capability matrix。

### M5 — Logout remote truth

- **Severity**：P1 for security claim；普通 local sign-out不阻塞。
- **Evidence**：`AuthHandler.Logout` 吞掉 `RevokeRefreshToken` error仍返回 `Logged out successfully`；`RevokeRefreshToken` 在 cache未配置时还是 no-op success。
- **Required mitigation**：返回 typed outcome，例如 `revoked | alreadyRevoked | revocationUnconfirmed`，或提供 operation receipt/reconcile；server failure不得伪装 confirmed。doge无论如何先清本地 vault/session，但必须呈现准确 remote truth。
- **Acceptance**：Redis unavailable/delete failure/invalid token/already revoked各有 stable outcome；retry idempotent；失败时 doge显示 local signed-out + remote unconfirmed而非“所有设备安全退出”。
- **Ownership/upstream impact**：小型通用 API contract，适合 upstream；保留旧 Web兼容字段可减少 breaking change。

### M6 — API key secret lifecycle、generic idempotency leak 与 deleted audit

- **Severity**：P1；managed key provisioning / one-click config绝对 blocker。
- **Source-to-sink evidence**：
  1. `ent/schema/api_key.go` plaintext `key`；
  2. `dto.APIKeyFromService` 把 `Key`映射到 List/Get/Create/Update response；
  3. `APIKeyHandler.Create` 把含 raw key的 DTO交给 `executeUserIdempotentJSON`；
  4. `IdempotencyCoordinator` serializes success data，`idempotency_records.response_body` 是 plaintext `TEXT`；
  5. `145_deleted_api_key_audit.sql` 与 `apiKeyRepository.DeleteWithAudit` 明确把 deleted raw key永久复制到 `deleted_api_key_audits.key`。
- **Required mitigation**：
  - API auth storage改为 keyed hash/pepper-aware lookup（保留 nonsecret prefix/fingerprint供识别）；
  - List/Get/Update只返回 metadata；Create/Rotate只一次返回 secret；
  - one-time secret的 lost-response replay不能进入 generic plaintext `response_body`：使用 purpose-specific encrypted、short-TTL delivery ledger或等价安全 protocol；
  - deleted audit只保留 nonsecret key id/fingerprint/owner，不保留原 key；为历史 plaintext rows定义 purge/migration与 backup/retention计划；
  - 禁止 user-supplied custom key进入新 managed flow，或单独严格约束。
- **Acceptance**：DB/backup/idempotency/audit/standard logs递归 secret canary scan为零；List/Get永不返回 secret；create replay不产生第二枚 key且仅获授权 broker可取一次；旧 key兼容/rehash/rotation/rollback方案有 migration tests；delete后 auth cache与hash lookup失效。
- **Ownership/upstream impact**：这是最大 cross-layer fork drift：schema、generated Ent、auth hot path、DTO、audit、search、cache和 migration都会变。应先向 Sub2API upstream提出 generic key-secret design；若 fork必须先做，采用 expand → dual-read/new-write → rotate/backfill → contract → cleanup的分阶段 migration，禁止 big-bang drop。

### M7 — API key PATCH presence semantics baseline

- **Severity**：P1 for managed key maintenance；create-only first cut可后置。
- **Evidence**：current checkout `UpdateAPIKeyRequest.IPWhitelist/IPBlacklist` 是 non-pointer slices，handler始终传给 service，`APIKeyService.Update` line 642–644总是覆盖；omitted field会清空 ACL。`origin/main` 已改成 `*[]string`，因此这项不应在 stale checkout重复发明。
- **Required mitigation**：release branch先更新到 `origin/main`或等价 patch；保留 omitted/no-change、empty/clear、nonempty/set三态。
- **Acceptance**：handler + service + persistence tests分别覆盖 omitted/clear/set，以及 invalid CIDR不产生 partial mutation。
- **Ownership/upstream impact**：upstream已有实现时只同步，不维护 fork-only variant。

### M8 — Stable errors、429 envelope 与 capability guarantees

- **Severity**：P1 for Real adapter rollout；Mock/只读 PoC可后置。
- **Evidence**：`response.Response`支持 `reason/metadata`，service已有许多 `ApplicationError`；但 auth/user/TOTP/API-key handlers大量 `response.BadRequest("Invalid request: "+err.Error())`产生空 reason。current rate limiter返回特殊 `{error,message}`；upstream `v0.1.172` 增加 `Retry-After`，仍未进入标准 envelope。current public settings也不声明 desktop contract/guarantees。
- **Required mitigation**：所有 AccountGateway可见 branch提供 stable machine reason；429统一 envelope + Retry-After；publish A3 version/guarantee bits；raw message永远不是 doge控制流。
- **Acceptance**：canonical negative scenario表中每项以 `status + reason + retry hint`映射；unknown reason/version fail closed；修改 server message不破坏 doge tests；rate-limit Redis fail-close与真正 exceeded可区分。
- **Ownership/upstream impact**：reason/envelope是通用改进，优先 upstream；desktop guarantee descriptor可先保持独立、窄、versioned route，避免污染大量 existing settings fields。

### M9 — Subscription progress drift / partial truth

- **Severity**：P1 only when shipping progress; Foundation auth不阻塞。
- **Evidence**：user router只注册 `/subscriptions/{,active,progress,summary}`；frontend还声明不存在的 `/subscriptions/:id/progress`。`SubscriptionHandler.GetProgress` 实际返回 `[{subscription, progress}]`，frontend却标为 `SubscriptionProgress[]`；单项计算 error会被 silently skipped，调用方无法区分“无订阅”与“部分失败”。
- **Required mitigation**：冻结正式 collection shape并显式 `complete/partial/errors/observed_at`；若保留单项 route，必须有 ownership check；否则删除 stale Web helper，由 broker只使用 collection contract。
- **Acceptance**：0/1/N subscription、其中一项计算失败、cross-user id、expired window与 frontend/schema conformance tests。
- **Ownership/upstream impact**：通用 contract correction，应 upstream；若首期只显示 summary，可把 M9后置且不展示 progress入口。

### M10 — Auth PII / credential-fragment log minimization

- **Severity**：P2 privacy completion gate for Foundation；与业务 endpoint能否调用无关。若 auth logs会被非最小权限主体访问或自动上传，需升级为 P1。
- **Evidence**：除 M3 的 `Login2FA` temp-token prefix和 session email外，`AuthService.SendVerifyCodeAsync`、`preparePasswordReset`、`RequestPasswordReset{,Async}`、`ResetPassword` 与 identity sync paths仍把 raw email写入 logs。forgot flow虽对 HTTP caller抗枚举，server log仍形成存在性/活跃状态与目标 email的集中 PII trail。
- **Required mitigation**：auth logs只保留 closed event/reason、nonreversible keyed correlation hash和必要计数；不记录 email、token prefix、password/TOTP、URL query/fragment、raw provider error。定义 retention/access policy，确保 support bundle不采集 raw auth logs。
- **Acceptance**：以 synthetic email/token canary覆盖 register/verify/login/MFA/forgot/reset/OAuth/bind；采集所有标准 logger sink与 support bundle，断言 canary及其任何 credential substring均不存在，同时 closed reason与可诊断 stage仍存在。
- **Ownership/upstream impact**：通用 privacy hardening，优先 upstream；可用集中 auth-safe logging helper减少大量散点 diff和后续 merge冲突。

## 8. 可后置 domains 与明确边界

| Domain | 为什么可后置 | 后置期间禁止的 false claim |
|---|---|---|
| device/session inventory、revoke-one | current user routes不存在；不是注册/登录基础依赖 | 不能把 doge本地 device label当成 server active session清单。 |
| account deletion/export | current普通用户 self-service contract未发现 | 不能只清 doge本地数据就声称远端账号删除。 |
| subscription progress detail | list/summary足以支撑早期 overview | M9未关前不展示精确 progress或“全部已同步”。 |
| billing/payment | 可独立 provider-hosted release | doge不采集 payment credential，不以 browser return判 paid。 |
| API key maintenance/rotation UI | 若 first cut完全不做 managed config可后置 | M6未关前不得 provision secret或写 CLI config。 |
| Web/daemon/remote、多账号 | 与 single local desktop authority可拆 release | 不共享 refresh/API key跨进程 plaintext，不把 future state塞进 generic store。 |

这些 domain可以后置，不表示从 Master Plan删除；对应入口必须 hidden/unsupported，Local Mode保持完整。

## 9. “只要能调通”何时足够、为什么通常不足

### 足够的窄条件

- Mock-first UI review，network/native calls被测试证明为零；
- internal developer PoC，只读 `settings/public`、profile、usage、subscription summary；
- 临时验证 email/password request/response shape，使用 synthetic test account，明确不保存 refresh token、不宣称 persistent login；
- system browser完成 current reset，且产品明确标注这是 Web fallback，不宣称 App内完成。

### 不足的原因

1. **HTTP 200不等于 durable session**：current auth可能只返回 access token。
2. **client lock不等于 server atomicity**：另一个设备、lost response、server多实例仍可并发 rotate。
3. **local logout不等于 remote revoke**：current server会吞 revoke error。
4. **UI隐藏 secret不等于 secret安全**：API key仍在 server DB、List/Get、idempotency response和 deleted audit中明文存在。
5. **browser OAuth成功不等于 desktop-safe completion**：token fragment/cookie flow没有 doge instance/audience/PKCE exchange binding。
6. **列表有数据不等于完整 truth**：subscription progress会 silent skip且 client/server shape drift。
7. **升级 upstream不等于关闭 integration gaps**：`v0.1.172` 修了账号接管，但仍保留 refresh/revoke/key lifecycle等缺口。

## 10. 最小改动策略与 upstream sync 影响

### 10.1 推荐顺序

1. **B0 — Clean secure baseline**：从 clean `origin/main` 建分支，完整同步/semantic backport upstream `v0.1.172`，先关闭 M1；不要在当前 behind/dirty工作区直接叠实现。
2. **T0 — Contract-only**：新增独立 capability/guarantee descriptor与 canonical server tests；不改变 existing route业务语义。
3. **T1 — Session spine**：M2、M3、M4、M5；先解决 persistent auth/revoke，再让 doge Real adapter启用。
4. **T2 — Thin completion**：A1 OAuth与 A2 reset；复用 service，新增 narrow transport，不 fork provider business rules。
5. **T3 — Managed key separate migration**：M6/M7独立 OpenSpec/PR；它的 schema/hot-path风险不与 auth session PR混在一起。
6. **T4 — Presentation contracts**：M8、M9按实际 release surface关闭。
7. 每一阶段由 fake/real conformance出 sanitized trace；doge late integration只替换 composition root，不改 UI journey。

### 10.2 Fork vs upstream ownership

| Change | Preferred ownership | Merge impact |
|---|---|---|
| M1 takeover fix、M7 omission semantics | **直接同步 upstream existing fix** | 最低；禁止 fork重写。 |
| M2 refresh、M3 MFA、M4 revoke、M5 logout、M8 errors、M9 subscription | **Sub2API upstream first** | 通用 correctness；fork-only会长期冲突 auth/service/tests。 |
| A1/A2 desktop adapter、A3 guarantees | **generic upstream design优先；必要时 fork窄 adapter** | 新文件/route优于侵入所有 provider handlers；reuse service interfaces。 |
| M6 key lifecycle | **upstream architecture first，fork phased migration only with approval** | 最高：schema/generated code/auth lookup/cache/audit/search/backups。 |
| doge vault/SQLite/Tauri/config recipes | **doge only** | 不进入 token2api；保持 ccgui/upstream local flow隔离。 |

### 10.3 Token2api repository approval gate

`token2api/AGENTS.md` 要求优先 configuration/deployment，并在修改 upstream-tracked source/schema/migration前解释 configuration不足、评估 merge impact、取得用户明确批准。本文已给出 configuration不足的证据：atomicity、durability、ticket binding和 hash-at-rest都无法由 runtime config实现。**本文是修改必要性 verdict，不是修改授权；实施仍需单独 approval。**

## 11. Release-cut decision table

| Proposed release cut | token2api是否必须改 | Blocking set |
|---|---|---|
| doge Local Mode + Account Mock Lab本地打包 | 否 | Real adapter不可选；zero network/native test。 |
| 只读 capability/profile/usage内部 PoC | 否 | fixed origin、Rust allowlist、synthetic account；不得持久化 secret或作安全完成声明。 |
| email/password persistent account Foundation | **是** | B0 + M2 + M3 + M4 + M5 + M8/A3 + M10。 |
| 完整 App 内 forgot/reset | **是** | Foundation + A2。 |
| OAuth login/register/bind | **是** | Foundation + M1 + A1；provider-specific callback matrix。 |
| post-login managed key + one-click config | **是** | Foundation + M6 + M7；另需 doge vault/config transaction gates。 |
| 精确 subscription progress | **是** | M9；summary-only release不受阻。 |
| device/session/account lifecycle完整态 | **是，可后置** | 新 session inventory/revoke-one/deletion/export contract。 |

## 12. Gate verdict、residual risk 与 handoff

### Gate verdict

**BLOCKED for complete/safe Real release.** `token2api` 必须修改，且 OAuth path在纳入 upstream账号接管修复前不得开放。未发现必须在 doge重造 identity/profile/session authority的理由；正确策略是 direct reuse + narrow Desktop adapters + server hardening。

### Release blockers by severity

- **P0**：M1 upstream OAuth account-takeover fix。
- **P1 Foundation**：M2 durable/atomic refresh、M3 MFA atomic consume、M4 durable revoke、M5 truthful logout、M8 stable guarantees/errors。
- **P1 managed config**：M6 API key secret lifecycle；M7 ACL presence baseline。
- **P1 conditional**：M9仅在 subscription progress release时 blocking。
- **P2 privacy completion**：M10 raw auth PII/credential-fragment logging；若日志访问/上传边界扩大则升级 P1。

### Residual / unverified

- 未执行真实 OAuth/email/TLS/Redis/Postgres或三平台 callback测试；这些必须在 implementation verification完成。
- 未证明 `origin/main` 或 production deployment当前精确 commit；本文只证明 local refs中的包含关系。release必须记录 exact deployed server/version/capability response。
- `upstream/v0.1.172` 是本地已有 tag evidence；实施时仍应按 token2api upstream sync workflow验证目标 release与完整 delta，不应只 cherry-pick release notes中显眼的 commit。
- API key hash migration会影响 auth hot path、search、deleted-key diagnostics和 backup retention；没有 phased migration与 rollback evidence前不得启用 managed provisioning。

### Required downstream handoff

- `doge-project-lead`：把 B0/M1列为 OAuth前置，把 T1/T2/T3拆成独立 ownership/PR，不把“API调通”作为 closure evidence。
- `solution-architect` + token2api domain owner：冻结 Authority contract v1、operation-id/idempotency、migration/rollback matrix。
- `data-storage-engineer`：持有 M4/M6 schema与 migration；`security-privacy-reviewer`在 implementation后复审 source-to-sink与 secret-negative evidence。
- `quality-engineer`：以本文每项 acceptance test point建立 fake/real conformance与 release blocker ledger。
