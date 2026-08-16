# doge App Account API Integration Architecture

> 状态：`architecture-review-ready`。本文是 `integrate-token2api-account-system` 的 solution-architecture research artifact，不是 `proposal.md`、`design.md` 或 `tasks.md`。
>
> Project role：`solution-architect`；Execution profile：Fast。
>
> Scope：doge 作为 token2api 的新增完整账号交互端，复用 current API 能力并明确 Desktop transport / server hardening gaps。Local Mode 始终独立完整，Account Convenience 低耦合、可关闭、可失败。
>
> Evidence convention：`token2api:<path>` 相对 `/Users/jason/GitHub/token2api`；其他路径相对 doge repo root。本文只记录 payload shape 和 contract fact，不记录真实 credential、token、email 或用户数据。

## 1. Executive Decision

采用 **Contract-first + Mock-first UI + Parallel backend + Late integration**，并保留已有 **Native Host Account Broker** 结论：

```text
                          Account Contract v1
                   commands + views + transitions + errors
                       /             |             \
                      /              |              \
     Frontend Experience      Doge Native Broker      token2api API/gaps
     React + AccountGateway   Tauri Rust + vault/DB    current endpoints +
     + Stateful Mock          + Real adapter           thin desktop additions
             |                       |                         |
             +----------- contract conformance ---------------+
                                      |
                              Late integration / E2E
```

核心判断：

1. **可以复用 current token2api 业务 API，但 doge React 不直接调用它们。** 所有 production request 由 Rust broker 发出；React 只依赖 versioned `AccountGateway` port。
2. **注册、邮箱验证码、密码登录、login MFA、profile、usage、platform quota 和大部分 subscription read API 可复用其业务语义。** 仍需经过 Rust 的 secret containment、session generation、safe DTO 与 closed error normalization。
3. **Current OAuth endpoint surface 不能作为 Desktop completion contract。** 它依赖 browser cookie、fixed Web callback、frontend pending-session state，并有 token-bearing URL fragment；需要 token2api 增加 short-lived single-use Desktop ticket/exchange 薄适配。Provider exchange、identity resolution、pending-account decision 等 server internals可复用。
4. **Current password recovery只完整支持 Web continuation。** `/forgot-password` 固定生成 `frontend_url/reset-password?email=...&token=...`；`/reset-password` 本身可复用，但 doge App 若要完成 reset form，需要新增 Desktop email-link continuation/ticket transport。
5. **Current login/register token response不能直接作为 production Desktop persistent session gate。** `respondWithTokenPair` 在 refresh pair 生成失败时仍返回 access-only success；Desktop 必须在 server 修正或 capability/version 明确后才把结果判为 persistent authenticated。
6. **Current refresh、revoke-all 与 API-key lifecycle存在已知 P0。** Atomic refresh family、durable revoke generation、dedicated-key hash/one-time secret/metadata-only list/get 均是 integration 前置，不得包装成“API 已复用”。
7. **Web frontend只提供 current contract evidence，不被嵌入 App WebView。** doge 独立实现 React presentation，系统浏览器只承担 OAuth、email link、captcha fallback 与 provider-hosted payment 等外部交互。

## 2. Evidence-backed Current Surface

### 2.1 Route and envelope facts

- token2api API base 是 `/api/v1`，注册点见 `token2api:backend/internal/server/router.go::registerRoutes`。
- Auth routes 见 `token2api:backend/internal/server/routes/auth.go::RegisterAuthRoutes`；user/profile/usage/subscription routes 见 `token2api:backend/internal/server/routes/user.go::RegisterUserRoutes`。
- 标准 success/error envelope 为 `{ code, message, reason?, metadata?, data? }`，见 `token2api:backend/internal/pkg/response/response.go`。
- Rate limiter 的 429 response 当前是非标准 `{ error, message }`，且未提供 `Retry-After`，见 `token2api:backend/internal/middleware/rate_limiter.go::abortRateLimit`。
- Web client 会解包 `code === 0` 的 `data`，401 时从 `localStorage` refresh 并把 upstream message交给页面，见 `token2api:frontend/src/api/client.ts`。这套 browser storage/error behavior不得复制到 doge。
- Current Web auth client把 access/refresh token与 user存入 `localStorage`，见 `token2api:frontend/src/api/auth.ts`。doge production contract明确禁止此做法。

### 2.2 Reuse verdict vocabulary

| Verdict | Meaning |
|---|---|
| **Direct through broker** | Method/path和业务 payload 可由 Rust HTTPS client调用；React仍不得直连，也不得收到 raw response。 |
| **Conditional reuse** | 业务 endpoint可保留，但必须先关闭已知 security/durability/contract blocker，或只能作为受限状态使用。 |
| **Thin server adapter** | 复用现有 service/domain logic，但 current public endpoint/transport 不满足 Desktop；必须新增小型 versioned endpoint。 |
| **Web fallback only** | Current 能力只能在 system browser 中完成；这不是“doge App API 完整复用”的完成态。 |
| **Explicit gap** | Route不存在、client/server shape漂移或能力尚无 current API；不得在 plan 中写成已复用。 |

## 3. Current API Capability Matrix

所有 response 均先经过标准 envelope 解包；表中 `response` 指 `data` payload。`JWT` 表示 Rust memory access token注入 `Authorization: Bearer ...`，不代表 renderer持有 token。

### 3.1 Public settings, registration and password authentication

| Capability | Method/path | Current request | Current response | Preconditions / current behavior | Desktop reuse verdict |
|---|---|---|---|---|---|
| Capability bootstrap | `GET /api/v1/settings/public` | 无；Web client对 GET附加 timezone，但此 endpoint不依赖它 | `PublicSettings`：registration/email verify/password reset/Turnstile/OAuth/payment/backend-mode flags与 site metadata | Public；字段很多，部分与 App 无关 | **Direct through broker**。Rust只投影 allowlisted `AccountCapabilitiesView`，不把 arbitrary menu/content/API base URL当 execution authority。 |
| Send registration email code | `POST /api/v1/auth/send-verify-code` | `{ email, turnstile_token? }` | `{ message, countdown }` | Public；Redis rate limit fail-close；Turnstile开启时 proof必需；`Accept-Language`决定邮件语言 | **Direct through broker**。`message`不进 UI；只返回 `cooldownSeconds`。Turnstile transport见 §7。 |
| Register | `POST /api/v1/auth/register` | `{ email, password, verify_code?, turnstile_token?, promo_code?, invitation_code?, aff_code? }` | `AuthResponse { access_token, refresh_token?, expires_in?, token_type, user }` | registration/email verification/invitation/promo policy由 public settings和service决定；成功即登录 | **Conditional reuse**。业务 endpoint保留；raw credentials/tokens只进 Rust。`refresh_token` 缺失时不得判 persistent success，current access-only fallback必须在 S0 修正或由 capability拒绝。 |
| Validate promo | `POST /api/v1/auth/validate-promo-code` | `{ code }` | `{ valid, bonus_amount?, error_code?, message? }` | Public；feature disabled也以 `valid=false` success返回 | **Direct through broker**，Expansion/optional registration field。只传 closed validity reason；不显示 server message。 |
| Validate invitation | `POST /api/v1/auth/validate-invitation-code` | `{ code }` | `{ valid, error_code? }` | Public；是否必填由 public settings决定 | **Direct through broker**，Foundation若 production启用 invitation policy则必须实现。 |
| Password login | `POST /api/v1/auth/login` | `{ email, password, turnstile_token? }` | `AuthResponse` **or** `{ requires_2fa, temp_token, user_email_masked }` | Public；active/backend-mode/Turnstile检查；TOTP用户先进入 challenge | **Conditional reuse**。业务 endpoint与2FA branch可复用；`temp_token`仅进 Rust flow state。Persistent session仍受 access-only fallback blocker约束。 |
| Complete login MFA | `POST /api/v1/auth/login/2fa` | `{ temp_token, totp_code }` | `AuthResponse` | `temp_token` short-lived；code 6位；current handler存在 temp-token prefix和email debug log | **Conditional reuse**。移除敏感 debug log后由 Rust直调；renderer只持 `flowHandle`、masked hint和用户输入 code。 |
| Current user | `GET /api/v1/auth/me` | JWT | current user/profile + `run_mode` | Authenticated；包含的 user字段多于 Account header所需 | **Direct through broker**。Rust映射为最小 `AccountProfileView`；internal id、raw binding subject、unneeded PII不进入 generic store。 |

Trace：route注册见 `token2api:backend/internal/server/routes/auth.go`；request/response与access-only fallback见 `token2api:backend/internal/handler/auth_handler.go`；Web types见 `token2api:frontend/src/types/index.ts`，调用见 `token2api:frontend/src/api/auth.ts`。

### 3.2 Password recovery and email-link continuation

| Capability | Method/path | Current request | Current response | Preconditions / current behavior | Desktop reuse verdict |
|---|---|---|---|---|---|
| Request password recovery | `POST /api/v1/auth/forgot-password` | `{ email, turnstile_token? }` | `{ message }` | Public；password reset开关、Turnstile、rate limit；为防 enumeration，无论 email 是否存在都返回同类 success | **Direct request + transport gap**。Rust可发送请求并只返回 `emailDispatched`；不得把 server message或存在性推断给 UI。 |
| Open recovery email | Current email URL，不是 API route | `frontend_url/reset-password?email=...&token=...` | Web page continuation | Handler从 setting构造 `frontend_url/reset-password`；email service把 raw email/token加入 query | **Web fallback only**。System browser可以完成 current flow，但不等于 App 内完整交互。 |
| Submit new password | `POST /api/v1/auth/reset-password` | `{ email, token, new_password }` | `{ message }` | Public；token one-time consume；成功后 service意图 invalidates existing JWT generation | Endpoint语义可复用，但 App无法安全取得 current email-link token。达到 App completion需 §7 的 **Thin server adapter**，由 Rust以 ticket换内部 reset context，再调用等价 domain logic。 |

Trace：`token2api:backend/internal/handler/auth_handler.go::{ForgotPassword,ResetPassword}`、`token2api:backend/internal/service/auth_service.go::{RequestPasswordResetAsync,ResetPassword}`、`token2api:backend/internal/service/email_service.go::SendPasswordResetEmail`、`token2api:frontend/src/views/auth/ResetPasswordView.vue`。

### 3.3 Session lifecycle

| Capability | Method/path | Current request | Current response | Preconditions / current behavior | Desktop reuse verdict |
|---|---|---|---|---|---|
| Refresh | `POST /api/v1/auth/refresh` | `{ refresh_token }` | `{ access_token, refresh_token, expires_in, token_type }` | Public + rate limit；current service rotation不是 atomic consume-and-rotate，lost response/race可能产生多 successor | **Conditional reuse after S0**。Rust singleflight只能约束单 host，不能修复 server race；atomic family/tombstone/idempotent lost-response先通过。 |
| Logout one refresh token | `POST /api/v1/auth/logout` | `{ refresh_token? }` | `{ message }` | Public；handler会忽略 refresh revoke error后仍返回 success，并清 browser OAuth cookies | **Conditional/best-effort only**。Local sign-out可立即完成，但 current response不能证明 remote revoke。需要 server返回 closed revocation outcome，或 UI明确 `signedOutLocally/revocationUnconfirmed`；不得显示安全撤销成功。 |
| Revoke all sessions | `POST /api/v1/auth/revoke-all-sessions` | JWT | `{ message }` | Authenticated；current `TokenVersion`未 durable persistence，DB reload后存在 false completion风险 | **Conditional reuse after S0**。先修 durable generation/schema/repository与DB reload test；doge只接收 typed receipt，不接收 message。 |

Trace：`token2api:backend/internal/handler/auth_handler.go::{RefreshToken,Logout,RevokeAllSessions}`、`token2api:backend/internal/service/auth_service.go`、`research/synthesis.md::P0 Blockers`。

### 3.4 Profile, password and identity security

| Capability | Method/path | Current request | Current response | Preconditions / current behavior | Desktop reuse verdict |
|---|---|---|---|---|---|
| Profile detail | `GET /api/v1/user/profile` | JWT | user profile、profile source、identity binding summaries | Authenticated | **Direct through broker**。Account Center detail使用；比 `/auth/me`更完整，仍由 Rust裁剪。 |
| Update profile | `PUT /api/v1/user` | `{ username?, avatar_url?, balance_notify_enabled?, balance_notify_threshold? }` | updated profile | Authenticated；pointer fields表达 no-change | **Direct through broker**。Foundation可只支持 username/avatar；notification settings后置。 |
| Change password | `PUT /api/v1/user/password` | `{ old_password, new_password }` | `{ message }` | Authenticated；password只应存在于当前 form与Rust request memory | **Direct through broker**，但 UI success由 HTTP/closed outcome判定，不显示 raw message。是否强制其他 session revoke需另行验收，不作 current claim。 |
| TOTP status | `GET /api/v1/user/totp/status` | JWT | `{ enabled, enabled_at?, feature_enabled }` | Authenticated | **Direct through broker**。 |
| TOTP verification method | `GET /api/v1/user/totp/verification-method` | JWT | `{ method: "email" | "password" }` | Authenticated | **Direct through broker**。驱动 setup/disable state machine。 |
| Send TOTP email code | `POST /api/v1/user/totp/send-code` | JWT | `{ success }` | Verification method为 email时使用 | **Direct through broker**。 |
| Initiate TOTP setup | `POST /api/v1/user/totp/setup` | `{ email_code? | password? }` + JWT | `{ secret, qr_code_url, setup_token, countdown }` | Authenticated；返回 TOTP seed与setup token | **Direct with purpose-specific sensitive view**。Rust保存 `setup_token`；renderer仅在专用 modal中短暂获得 QR presentation，manual secret只在显式 reveal 时短暂提供，禁止进入 store/log/diagnostics/screenshot automation。 |
| Enable TOTP | `POST /api/v1/user/totp/enable` | `{ totp_code, setup_token }` + JWT | `{ success }` | Setup continuation有效 | **Direct through broker**。Renderer只传 code + `flowHandle`；Rust补 `setup_token`。 |
| Disable TOTP | `POST /api/v1/user/totp/disable` | `{ email_code? | password? }` + JWT | `{ success }` | 当前 verification method决定字段 | **Direct through broker**。 |
| Bind/unbind identities | `/user/account-bindings/...`、`/user/auth-identities/bind/start` 及 OAuth bind routes | varies | profile或binding start result | Authenticated；current OAuth bind依赖 access-token cookie + browser cookies | Email binding APIs可 **Direct through broker**；OAuth identity binding属于 **Thin server adapter**，与 Desktop OAuth ticket共用 transport。 |

Trace：`token2api:backend/internal/server/routes/user.go`、`token2api:backend/internal/handler/user_handler.go`、`token2api:backend/internal/handler/totp_handler.go`、`token2api:frontend/src/api/{user,totp}.ts`。

### 3.5 OAuth providers and pending account decisions

Current registered providers：GitHub、Google、LinuxDo、WeChat、OIDC、DingTalk；route inventory在 `token2api:backend/internal/server/routes/auth.go`。

| Current route family | Current transport/state | Reusable server logic | Desktop verdict |
|---|---|---|---|
| `GET /auth/oauth/{github|google}/start` + callback | Start在 browser设置 state/redirect/provider cookies；callback校验 cookie，provider exchange后把 access/refresh token写入 frontend URL fragment | Provider config、code exchange、verified-email lookup、identity resolution、pending registration | **Thin server adapter required**。禁止让 doge 捕获 token-bearing fragment。 |
| `GET /auth/oauth/{linuxdo|oidc|wechat|dingtalk}/start` + callback | State/PKCE/nonce或mode由不同 cookie组合持有；callback重定向 Web frontend；部分完成态写 token fragment | Provider-specific authorize/exchange、identity merge、invitation/adoption logic | **Thin server adapter required**。部分 provider内部已有 PKCE不等于已有 Desktop instance binding/ticket。 |
| `POST /auth/oauth/pending/exchange` | 依赖 `oauth_pending_browser_session` / `oauth_pending_session` HttpOnly cookie | Pending choice/adoption response和consume逻辑 | Current public shape **not reusable** by Rust broker，因为 system browser cookie jar与Rust HTTPS client隔离。新增 ticket-bound pending exchange。 |
| `POST /auth/oauth/pending/send-verify-code` | Email + Turnstile + pending token/cookie context | Pending signup email verification logic | 业务 logic复用；Desktop endpoint必须改用 opaque Desktop authorization id/ticket，不把 pending token交给 renderer。 |
| `POST /auth/oauth/pending/create-account` / `bind-login` | Browser pending session；可能继续返回 MFA/pending step或token pair | Create/bind/adoption/MFA orchestration | 业务 logic复用；HTTP transport需 Desktop-specific continuation。 |
| Provider-specific `complete-registration` / `bind-login` / `create-account` | Legacy/provider-specific compatibility surface，仍依赖 cookie pending session | 同上 | 不作为 doge contract。doge绑定统一 `DesktopOAuthTransition`，server内部可兼容映射。 |

OAuth current facts：

- GitHub/Google callback直接构造 `#access_token=...&refresh_token=...`，见 `token2api:backend/internal/handler/auth_email_oauth.go::emailOAuthCallbackWithProfile`。
- LinuxDo/OIDC/WeChat/DingTalk同样使用 state cookie、pending browser cookie与Web redirect；证据见对应 `auth_*_oauth.go` 和 `auth_oauth_pending_flow.go`。
- Web callback会从 fragment读取 token并写 `localStorage`，见 `token2api:frontend/src/views/auth/OAuthCallbackView.vue` 与 provider callback views。doge禁止复制。

### 3.6 Usage, quota and subscription

| Capability | Method/path | Current request | Current response | Preconditions / current behavior | Desktop reuse verdict |
|---|---|---|---|---|---|
| Account balance/basic quota context | `GET /auth/me` or `/user/profile` | JWT | user includes `balance`, `concurrency`, limits and subscriptions | Authenticated | **Direct through broker**，但只作为 token2api Account Convenience数据，不与 doge Local usage合并。 |
| Platform quotas | `GET /api/v1/user/platform-quotas` | JWT | `{ platform_quotas: [{ platform, daily/weekly/monthly limit/usage/window/reset... }] }` | Authenticated；expired window在 response lazy-zero，不写 DB | **Direct through broker**。Rust补 `fetchedAt/freshness/source=token2apiPlatformQuota`。 |
| Dashboard totals | `GET /api/v1/usage/dashboard/stats` | JWT | request/token/cost totals、today values、by_platform | Authenticated | **Direct through broker**。Account Center summary使用；不替代 Local usage。 |
| Usage trend/model snapshot | `GET /api/v1/usage/dashboard/snapshot-v2` | query：date/granularity/filter/include flags | `{ generated_at, start_date, end_date, granularity, trend?, models?, groups? }` | Authenticated；timezone/date filter | **Direct through broker**，Expansion charts。`generated_at`可作为source time，broker另记录fetch time。 |
| Usage detail/stats | `GET /usage`、`/usage/stats`、`/usage/:id` | pagination/filter/date/timezone | paginated logs/stats/detail | Authenticated；detail有ownership check | **Direct through broker**，Expansion；字段必须经过privacy allowlist。 |
| Subscription list/active | `GET /subscriptions`、`GET /subscriptions/active` | JWT | `UserSubscription[]` | Authenticated | **Direct through broker**。 |
| Subscription summary | `GET /subscriptions/summary` | JWT | `{ active_count, total_used_usd, subscriptions[] }` | Authenticated | **Direct through broker**。适合 Account Overview。 |
| Subscription progress collection | `GET /subscriptions/progress` | JWT | Handler实际返回 `[{ subscription, progress }]` | Authenticated；单项计算失败会被 silently skipped | **Contract correction required**。Web client当前错误标成 `SubscriptionProgress[]`；server silent skip也需显式 partial evidence后才能作为 doge contract。 |
| Single subscription progress | Web client声明 `GET /subscriptions/:id/progress` | JWT | Web type期望 `SubscriptionProgress` | **Server route未注册** | **Explicit gap**。不得调用或标记复用；可删除client假象或新增有ownership check的 route。 |

Trace：`token2api:backend/internal/handler/{user,usage,subscription}_handler.go`、`token2api:frontend/src/api/{user,usage,subscriptions}.ts`、`token2api:frontend/src/types/index.ts`。

### 3.7 Billing and payment orders

| Capability | Method/path | Current request | Current response | Preconditions / current behavior | Desktop reuse verdict |
|---|---|---|---|---|---|
| Checkout bootstrap | `GET /api/v1/payment/config`、`/checkout-info`、`/plans`、`/channels`、`/limits` | JWT | payment flags、plans、methods/limits、nonsecret checkout metadata | Authenticated；payment feature/provider config决定可用项 | **Direct through broker for presentation metadata**。Rust裁剪 channel/provider fields；不得把 publishable/config data提升为 local execution authority。 |
| Create order | `POST /api/v1/payment/orders` | `{ amount, payment_type, order_type, plan_id?, return_url?, payment_source?, openid?, wechat_resume_token?, is_mobile? }` | order + `pay_url?` / `qr_code?` / provider intent metadata / resume token | Authenticated；不同 provider/mode返回不同 completion transport | **Conditional reuse**。Order business endpoint可保留；doge只允许 provider-hosted system browser/QR flow。`return_url`由 Rust固定，renderer不得提交 arbitrary URL；payment credential不进入 App。 |
| Verify/order detail | `POST /payment/orders/verify`、`GET /payment/orders/:id`、`GET /payment/orders/my` | order id/out trade no或pagination | `PaymentOrder` / paginated orders | Authenticated；verify向upstream查询；最终 subscription/entitlement仍需 server fulfillment事实 | **Direct through broker**，Expansion。Browser return不是 success；必须刷新 order + subscription revision。 |
| Cancel/refund request | `POST /payment/orders/:id/cancel`、`POST /:id/refund-request`、eligible-provider read | order id + reason等 | updated/acknowledged order state | Authenticated；具体允许条件由server判定 | **Direct through broker**，Expansion；reason作为用户输入需长度/PII policy，不进入 generic diagnostics。 |
| Public resume | `POST /payment/public/orders/resolve` | `{ resume_token }` | safe public order status | Public；signed resume token用于browser回流恢复；legacy `/verify` 仍可按 out trade no查询 | Rust可用于 **conditional continuation**；resume token只进 Rust flow，不进 renderer/storage。优先 signed resolve，禁止依赖 legacy anonymous lookup作为主路径。 |
| Webhooks | `/payment/webhook/*` | Provider callback | server-side settlement | Provider→token2api，不是 App API | 不由 doge调用。它们与 fulfillment后的 subscription revision才是durable billing truth。 |

Trace：`token2api:backend/internal/server/routes/payment.go`、`token2api:frontend/src/api/payment.ts`、`token2api:frontend/src/types/payment.ts`。Current API相当完整，但 Desktop return binding、closed payment errors、contract version/capability和provider-hosted safety仍需 Expansion contract；不能因 route存在就宣称 App billing集成完成。

### 3.8 Dedicated key and one-click configuration handoff

| Capability | Current endpoint | Current fact | Verdict |
|---|---|---|---|
| User API-key CRUD | `GET/POST /api/v1/keys`、`GET/PUT/DELETE /api/v1/keys/:id` | `dto.APIKey`包含 full `key`；create支持 custom key/group/quota/expiry/rate limit；list/get持续返回 secret；update ACL slice omission可能清空 | **Not safe for doge managed key yet**。只能在 S0 完成 hash-at-rest、metadata-only list/get、one-time create secret、ACL omission semantics、audit/idempotency secret exclusion后 conditional reuse。 |
| Dedicated doge key policy | current generic key API | 没有 `account × device × purpose`、device ownership或managed-key lifecycle | **Explicit gap**。推荐新增 `/desktop/v1/managed-keys` facade或在 existing service上提供等价 typed endpoint；不得把 generic user-selected key伪装成 dedicated managed key。 |
| Recipe/config plan/apply | 无 token2api route | 本地 target host才拥有 recipe/path/file/runtime truth | 不属于 token2api API复用。由 doge Rust broker + immutable local recipe catalog持有；登录/配额成功后只产生 configuration offer。 |

## 4. Account Contract v1

### 4.1 Port boundary

React只依赖稳定 port；Mock 与 Real adapter必须实现同一 interface。下列是 contract shape，不是 production code承诺：

```ts
interface AccountGatewayV1 {
  getCapabilities(): Promise<AccountCapabilitiesViewV1>;
  getSession(): Promise<AccountSessionViewV1>;

  beginRegistration(input: BeginRegistrationInputV1): Promise<AuthTransitionV1>;
  resendRegistrationCode(flow: FlowRefV1, challenge?: ChallengeProofV1): Promise<AuthTransitionV1>;
  submitRegistrationCode(flow: FlowRefV1, code: string): Promise<AuthTransitionV1>;

  signInWithPassword(input: PasswordSignInInputV1): Promise<AuthTransitionV1>;
  submitMfa(flow: FlowRefV1, code: string): Promise<AuthTransitionV1>;
  beginOAuth(provider: OAuthProviderV1): Promise<AuthTransitionV1>;
  resumeExternalContinuation(continuation: ExternalContinuationV1): Promise<AuthTransitionV1>;

  requestPasswordRecovery(input: PasswordRecoveryInputV1): Promise<AuthTransitionV1>;
  submitNewPassword(flow: FlowRefV1, newPassword: string): Promise<AuthTransitionV1>;

  refreshAccount(): Promise<AccountSnapshotV1>;
  updateProfile(input: UpdateProfileInputV1): Promise<AccountProfileViewV1>;
  signOut(scope: "local" | "currentSession" | "allSessions"): Promise<SignOutResultV1>;

  getUsageSummary(): Promise<UsageSummaryViewV1>;
  getQuota(): Promise<QuotaViewV1>;
  getSubscriptions(): Promise<SubscriptionViewV1>;
}
```

规则：

- `AccountGatewayV1` 不暴露 URL、HTTP method、JWT、refresh token、OAuth code、desktop ticket、reset token、TOTP temp/setup token或server response envelope。
- React form中的 password/TOTP/email code只在当前 component memory短暂存在；不得进入 global store、local/session storage、analytics、scenario log或error object。完成、取消、unmount后清空。
- `FlowRefV1 = { flowHandle, kind, expiresAt }`。`flowHandle`是随机 opaque handle，只在当前 app instance有效；Rust/Mock adapter内部持有真正 continuation。
- `AccountSnapshotV1` 分离 session/profile/usage/quota/subscription freshness；某个 read失败不能抹掉Local Mode或其他已知 snapshot。
- 所有 contract带 `contractVersion: 1`；unknown version/enum在安全路径 fail closed。

### 4.2 Closed transition model

```ts
type AuthTransitionV1 =
  | { kind: "registrationDetailsRequired"; flow: FlowRefV1; policy: RegistrationPolicyViewV1 }
  | { kind: "emailCodeSent"; flow: FlowRefV1; maskedDestination: string; cooldownSeconds: number }
  | { kind: "mfaRequired"; flow: FlowRefV1; method: "totp"; maskedHint?: string }
  | { kind: "externalActionRequired"; flow: FlowRefV1; action: "openSystemBrowser" | "checkEmail"; displayUrl?: string }
  | { kind: "oauthAccountChoiceRequired"; flow: FlowRefV1; canCreate: boolean; canBind: boolean; profileSuggestion?: SafeProfileSuggestionV1 }
  | { kind: "authenticated"; session: AccountSessionViewV1; profile: AccountProfileViewV1 }
  | { kind: "passwordResetReady"; flow: FlowRefV1; maskedDestination: string }
  | { kind: "completed"; outcome: ClosedAccountOutcomeV1 }
  | { kind: "failed"; error: AccountErrorViewV1 };
```

`displayUrl`仅允许 server-authorized HTTPS provider URL并由 Real adapter直接交给 system browser；Mock adapter使用固定 `https://example.invalid/...`。React不得自行拼 authority base URL、callback或OAuth query。

## 5. Registration, Verification and Recovery State Contracts

### 5.1 Email/password registration

```text
idle
  → loadingCapabilities
  → collectingDetails
  → acquiringChallenge?          (Turnstile enabled)
  → sendingEmailCode
  → awaitingEmailCode
  → submittingRegistration
  → authenticatedPersistent | mappableFailure
```

Contract：

1. `getCapabilities`决定 registration、email verification、invitation、promo、agreement、Turnstile是否可用；UI不硬编码 server policy。
2. `beginRegistration`把 normalized email、password、可选 codes和一次性 challenge交给 adapter。Real adapter在 Rust volatile flow state保存 registration draft；renderer只保留 `flowHandle`和safe field state。
3. 如果 email verification关闭，Real adapter可直接调用 `/auth/register`；开启时先调用 `/auth/send-verify-code`，返回 `emailCodeSent`。
4. `submitRegistrationCode(flow, code)`由 Rust从 flow取回 registration draft并调用 `/auth/register`，不要求 renderer像 current Web UI那样把 password写入 `sessionStorage`。doge明确禁止复制 `token2api:frontend/src/views/auth/EmailVerifyView.vue` 的 `register_data` storage pattern。
5. Resend必须复用同一 normalized email/policy generation；policy、account service origin或flow expiry变化时重新开始，禁止跨 flow复用 Turnstile proof。
6. Auth response先写 Rust session manager/vault saga，再发布 `authenticated`。如果 persistent credential未安全落地，只能返回已确认的 session-only state或fail closed；不得先让 UI显示登录成功。

### 5.2 Password sign-in and MFA

```text
collectingCredentials
  → acquiringChallenge?
  → authenticating
       ├─ AuthResponse → sessionCommit → authenticated
       └─ requires_2fa → awaitingMfaCode → verifyingMfa → sessionCommit
```

- Current `temp_token`保存在 Rust/Mock flow record，React只收到 `flowHandle`与 `user_email_masked`。
- MFA code validation error只返回 `mfaInvalid | mfaExpired | rateLimited | unavailable` 等 closed error。
- Retry同一 MFA flow不得重新提交 password；flow过期才回到 credentials。
- OAuth login内触发 MFA时也收敛到相同 `mfaRequired` transition，UI无需知道 server pending-session cookie/token差异。

### 5.3 Forgot and reset password

```text
collectingEmail
  → acquiringChallenge?
  → requestingRecovery
  → checkEmail                 (始终不泄露账号是否存在)
  → externalLinkOpened
  → passwordResetReady         (Desktop continuation gap完成后)
  → collectingNewPassword
  → resetting
  → completed → signIn
```

- Foundation UI与Mock必须实现完整 App journey，即使 Real token2api adapter尚未就绪。
- Current Real adapter在新增 Desktop continuation前只能返回 `checkEmail` 并明确 `continuationSurface="systemBrowser"`；这属于 temporary Web fallback，不得作为 App-complete acceptance。
- Target Desktop transport：email指向 authority-owned HTTPS landing page；landing只携带/消费 server reset token，随后签发 short-lived、single-use、server-side hashed Desktop reset ticket并跳转 loopback/deep link。Rust交换 ticket后保存 reset context，React只收到 `passwordResetReady(flowHandle, maskedDestination)`。
- `submitNewPassword`只传新密码 + opaque flow；Rust提交等价 reset domain operation。Raw email/reset token/ticket不进入 renderer、URL fragment、logs、support bundle。
- Link duplicate click、ticket replay、flow expiry、App未运行、错误设备和用户取消均有 closed state；旧 ticket消费后必须不可重放。

## 6. Rust Broker and React Presentation Boundary

### 6.1 React owns

- Account Center navigation、forms、field validation、focus/a11y/i18n和用户可理解状态。
- `AccountGatewayV1` command invocation与safe transition rendering。
- 当前 component内短暂的 password、verification code、TOTP code；不得持久化或进入 generic reducer diagnostics。
- External action的用户确认和系统浏览器打开 intent；URL只能来自 gateway allowlisted view。
- Mock scenario选择仅存在于 development/test harness，不进入 production settings。

React does not own：

- token2api base URL、Bearer header、refresh、retry、cookie jar、OAuth state/nonce/PKCE、callback listener。
- token/session persistence、vault、account DB、generation/accountEpoch。
- Raw upstream response/error、server IDs、email reset token、OAuth code/ticket、TOTP temp/setup token。
- Config recipe、filesystem path、managed key secret或one-click transaction。

### 6.2 Rust broker owns

- Fixed/signed authority origin、TLS policy、bounded timeout、request size、locale/timezone headers。
- Standard envelope与legacy/nonstandard 429 parsing；closed error normalization。
- Access token memory、refresh/dedicated key vault、refresh singleflight、session generation/accountEpoch fence。
- Volatile `FlowRegistry<FlowHandle, SensitiveContinuation>`；TTL、single-use、cancel和startup discard。
- System-browser authorize、loopback/deep-link ownership、state/nonce/PKCE/ticket exchange和second-instance forwarding。
- Profile/usage/quota/subscription safe mapping与explicit freshness cache。
- Post-auth managed-key/config handoff，但不得把 login success当 provisioning/apply consent。

### 6.3 token2api owns

- Identity/password/email/TOTP/OAuth policy与remote session authority。
- Refresh family/revocation、profile、usage/quota/subscription与managed-key authority。
- Provider OAuth exchange和pending account/bind/adoption domain logic。
- Email delivery、reset token与Desktop continuation ticket签发/消费。
- Rate limiting、Turnstile proof validation、security audit和versioned capability negotiation。

## 7. Desktop Transport Contracts

### 7.1 Turnstile / captcha

Current API只接受 `turnstile_token`，没有 Desktop challenge endpoint。

推荐 transport顺序：

1. `GET /settings/public` 由 Rust获取并投影 `{ required, provider: "turnstile", siteKey, action }`。
2. Production React在专用 challenge component渲染 Turnstile SDK；这不是复用 token2api Web page，也不是 token2api API直连。
3. Proof是一次性 anti-abuse proof，不是 account credential，但仍不得持久化/log；立即通过 `AccountGateway` intent传给 Rust并从 UI state清除。
4. Rust只把 proof用于该 exact auth request，不缓存、不重试复用。
5. Tauri origin/CSP、macOS/Windows/Linux WebView和Turnstile domain若无法验证，则该 platform的password auth capability保持 disabled，或改用 authority-hosted system-browser challenge + single-use challenge ticket薄适配。

Mock lane不得加载真实 Turnstile SDK；scenario engine直接发出 `challengeRequired/challengeSolved/challengeExpired/challengeUnavailable` transition。

### 7.2 Email links

- Registration verification current是用户输入 email code，可直接在 App完成，无 deep link gap。
- Password reset current是 Web URL，App continuation需要新增 Desktop reset ticket，如 §5.3。
- 所有 email continuation URL都必须是 authority-owned HTTPS，不直接放 custom scheme secret。
- Custom scheme/loopback只接收 opaque single-use ticket + state；ticket绑定 device/app instance、purpose、redirect、TTL和nonce。
- App未安装/未运行时 landing page提供安全 Web fallback；fallback与App flow共享 server token consume semantics，不能双重完成。

### 7.3 OAuth

推荐新增 versioned thin surface；下面是 **required contract shape，不是 current endpoint claim**：

```text
POST /api/v1/desktop/v1/oauth/authorizations
  request: provider, intent, redirect_binding, pkce_challenge, state_hash, device_public_id
  response: authorization_id, authorize_url, expires_at

POST /api/v1/desktop/v1/oauth/authorizations/{id}/exchange
  request: desktop_ticket, pkce_verifier, state
  response: closed auth transition or token pair consumed by Rust
```

Server provider callback继续复用 current provider exchange/identity logic，但 completion改为：

1. MFA、invitation、create/bind/adoption未完成时，将 pending state绑定 `authorization_id`；不依赖 browser cookie作为doge唯一 continuation。
2. 完成时签发 short-lived single-use Desktop ticket；不把 access/refresh token写 URL fragment。
3. System browser跳到 doge loopback/deep link，仅携带 ticket/state。
4. Rust验证本地 state/PKCE/app-instance binding后exchange；token pair只进入 Rust session manager。

Provider notes：

- GitHub/Google current cookie + frontend fragment flow必须迁移到上述 adapter。
- LinuxDo/OIDC已有部分 PKCE/nonce implementation可复用，但仍需 Desktop authorization binding和ticket completion。
- WeChat的 `open/mp/mobile` capability差异由 server capability返回；需要 WeChat browser/native app的mode在 unsupported platform明确关闭，不能在 doge中猜 user agent。
- DingTalk同样走统一 Desktop transition；provider-specific cookies不进入 React contract。

### 7.4 MFA

- Login TOTP使用 current `/auth/login/2fa`，不需要 system browser。
- OAuth pending flow中的 MFA由 Desktop authorization记录承载；UI仍使用统一 `submitMfa(flowHandle, code)`。
- TOTP setup QR是唯一允许的 purpose-specific secret presentation。其 view不能进入 screenshot regression fixture；Mock使用明显的非真实 placeholder QR/seed。

## 8. Unified Error Normalization

### 8.1 Renderer error shape

```ts
type AccountErrorViewV1 = {
  code: AccountErrorCodeV1;
  stage:
    | "capabilities" | "challenge" | "register" | "verifyEmail"
    | "login" | "mfa" | "oauth" | "recover" | "reset"
    | "refresh" | "logout" | "profile" | "usage" | "quota"
    | "subscription" | "vault" | "callback";
  retryable: boolean;
  userAction:
    | "retry" | "editInput" | "requestNewCode" | "loginAgain"
    | "openBrowser" | "unlockVault" | "useLocalMode"
    | "contactSupport" | "none";
  messageKey: AccountMessageKeyV1;
  field?: "email" | "password" | "code" | "invitation" | "promo";
  cooldownSeconds?: number;
};
```

禁止字段：`message`、`detail`、`error`、`reason: string`、`metadata: Record<string,string>`、URL、HTTP body/header、token、provider raw description。

### 8.2 Normalization precedence

Rust按以下优先级归一：

1. 本地 precondition：offline、vault locked/unavailable、flow expired、callback mismatch、unsupported capability。
2. HTTP status +标准 envelope `reason` closed allowlist。
3. Known legacy shape，如 rate limiter `{ error, message }`，只映射 `rateLimited`，不复制文本。
4. Unknown 4xx → `requestRejected` / field-safe generic；unknown 401 → `sessionInvalid`；unknown 5xx → `serviceUnavailable`。
5. Parse/schema mismatch → `protocolMismatch`，fail closed并记录无 payload的 protocol metric。

初始 reason mapping至少覆盖：

| Server signal | Account error |
|---|---|
| `INVALID_CREDENTIALS` / password login 401 | `credentialsInvalid` |
| `INVALID_EMAIL` / request validation | `emailInvalid` |
| `PASSWORD_RESET_DISABLED` | `capabilityDisabled` |
| `TOTP_INVALID_CODE` | `mfaInvalid` |
| `TOTP_SETUP_EXPIRED` / invalid temp session | `flowExpired` |
| `TOTP_TOO_MANY_ATTEMPTS` / HTTP 429 | `rateLimited` |
| `BACKEND_MODE_ADMIN_ONLY` | `accountNotAllowed` |
| refresh/revoke 401 | `sessionInvalid` |
| network/TLS/DNS | `offline` or `serviceUnavailable`，按可验证原因区分 |

Server raw error只可在 Rust内用于 allowlist comparison，随后立即丢弃；日志记录 `stage/code/httpStatus/duration/retryCount` closed fields。

### 8.3 Contract gaps for errors

- token2api rate limiter应进入标准 envelope并提供 bounded retry hint；current无 `Retry-After`，因此 doge不能虚构精确倒计时。
- Auth handler的 JSON binding error把 framework error拼入 message；doge不得显示它。
- OAuth callback current会把 provider error description放 redirect参数；Desktop ticket contract只返回 closed provider outcome。
- Logout current吞掉 revoke error；需 typed revoke result才能给 security completion承诺。

## 9. Login-to-Quota-and-Configuration Handoff

登录成功只完成 `Account session commit`：

```text
Auth terminal
  → Rust commits session generation/vault metadata
  → GET /auth/me or /user/profile
  → parallel safe reads:
       /user/platform-quotas
       /usage/dashboard/stats
       /subscriptions/summary
  → AccountSnapshotV1 with per-slice freshness
  → React renders Account Overview
  → separate ConfigurationOffer availability check
  → separate managed-key consent
  → separate exact config-plan consent/apply
```

Rules：

- Profile成功但 quota/usage失败时仍可 authenticated；失败 slice显示 unavailable/stale，不回退 whole session。
- Quota exhausted、subscription inactive或billing failure只影响 token2api managed service namespace，绝不影响 Local Mode。
- Usage source必须标 `token2apiAccount | token2apiPlatformQuota | token2apiSubscription`；不得与 doge Local usage合计。
- Post-login只展示 configuration offer；不得在 auth request中自动调用 `/keys` 或写 config。
- 用户接受 managed-key provisioning后，先调用 hardened dedicated-key endpoint；key secret只进入 Rust vault。
- 用户再接受 exact plan后，Rust local recipe transaction使用 vault-backed credential delivery。token2api不接收 local path/diff/config。

## 10. Contract-first, Mock-first Parallel Delivery

### 10.1 Gate G0 — Contract freeze

三 lane启动前冻结：

- `AccountGatewayV1` commands、input、transition、view、closed error enums。
- Secret/PII classification；每个 field的 producer、owner、consumer、retention。
- JSON fixtures / schema corpus：Good、Base、Bad和unknown-version cases。
- Current endpoint mapping与 explicit gaps；不得把 target endpoint误标 current。
- Feature/capability negotiation和 Foundation/Expansion cut。

Contract变更规则：additive minor可并行；breaking change增加 contract version，不允许某 lane私自修改 existing fixture期待。

### 10.2 Lane A — Frontend Experience

Ownership：React account feature、`AccountGatewayV1` port、presentation state、Mock adapter、scenario harness、a11y/i18n和visual/manual QA。

硬约束：

- UI 阶段不得真实调用 token2api 或 doge backend；development/test composition只注入 Mock adapter。
- Button handler只能发 semantic intent，如 `gateway.submitMfa(flow, code)`；不得包含 mock分支、fake timeout、fake token或HTTP shape。
- UI state只依赖 contract transition，不依赖 Axios/Tauri error、route path或server message。
- 用户多轮评审可以调整布局/copy/journey，只要不破坏 frozen semantic contract；不阻塞 Lane B/C。

### 10.3 Stateful deterministic Mock scenario engine

Mock不是“所有 method返回 success”的 stub，而是可复现 state machine：

```ts
type AccountScenarioIdV1 =
  | "new-user-happy"
  | "registration-email-code-invalid"
  | "registration-code-expired-resend"
  | "login-invalid-credentials"
  | "login-mfa-happy"
  | "login-mfa-expired"
  | "oauth-new-account-choice"
  | "oauth-existing-account-bind"
  | "oauth-provider-denied"
  | "oauth-callback-replay"
  | "password-reset-email-link"
  | "password-reset-token-expired"
  | "refresh-rotation-failed"
  | "offline-start"
  | "offline-after-login-stale-quota"
  | "high-latency-recovery"
  | "vault-locked"
  | "quota-exhausted-local-still-works"
  | "configuration-offer-deferred";
```

Mock engine requirements：

- Deterministic clock、seed、operation sequence与latency schedule；测试不得依赖真实 timer/network。
- Stateful account、flow、session generation、email code attempts、MFA attempts、external continuation、freshness和recovery state。
- 支持 scripted latency、timeout、offline→online、stale snapshot、duplicate/replay、cancel/reopen和retry。
- Flow handle仍 opaque；scenario inspector只显示 safe semantic state，不显示 fake secrets。
- Mock output必须逐项通过同一 schema/fixture validator；禁止专供 UI 的额外字段。
- Realistic Bad cases：unknown enum、malformed response、partial snapshot、expired flow、out-of-order response和stale generation必须被 port拒绝或归一。

### 10.4 Lane B — Doge Native Broker

Ownership：Rust `AccountGatewayV1` Real adapter、HTTPS client、flow registry、callback transport、session/vault/DB、safe mapper、closed errors、account cache和post-login handoff。

独立验证：

- 使用 token2api-independent fake HTTP authority / recorded redacted fixtures；不依赖 UI或 live server。
- Contract tests覆盖每个 command/transition/error和raw-field negative scan。
- Refresh singleflight、generation fence、vault reconcile、callback replay和offline cache使用 deterministic tests。
- Rust DTO不得简单镜像 token2api `User`/`AuthResponse`；wire DTO只存在 adapter内，presentation DTO是独立 allowlist。

### 10.5 Lane C — token2api API and gaps

Ownership：current endpoint hardening、Desktop capability/ticket/reset/OAuth/managed-key additions、standard errors和server contract tests。

可并行工作：

- 保持 current register/login/profile/usage routes向后兼容。
- 关闭 refresh/revoke/key/log P0。
- 新增 versioned Desktop OAuth/reset capability而不改变 Web callback consumer。
- 修正 subscription progress shape/route drift。
- 输出 conformance fixtures；不依赖 doge UI可用。

### 10.6 Gate G1 — Per-lane contract conformance

进入 integration前必须全部通过：

1. Mock adapter对 canonical scenario corpus 100% conformance。
2. Rust Real adapter对 redacted HTTP fixtures 100% conformance；unknown/malformed cases fail closed。
3. token2api current + new endpoints对 request/response/error fixtures conformance。
4. Contract diff无 breaking drift；route inventory与documented current/gap labels一致。
5. Recursive secret scanner证明 fixture、snapshot、logs和renderer DTO无 access/refresh/reset/OAuth/pending/setup token。

### 10.7 Gate G2 — UI review freeze

- 用户完成多轮 happy/error/recovery/offline/MFA/OAuth/email-link/expired-flow UI评审。
- Keyboard/focus/screen reader/text expansion/reduced-motion通过。
- UI state与copy不声称 server current尚不能保证的 completion。
- UI acceptance后锁定 interaction baseline；backend可在此前持续并行，不等待 pixel refinement。

### 10.8 Late integration

只有 `G1 + G2 + applicable security gates` 都通过后：

1. Production composition将 `MockAccountGateway`替换为 `TauriAccountGateway`；组件和button handler不改业务语义。
2. 先接 public settings/register/login/MFA/profile/quota的 local test authority。
3. 再接 Desktop reset/OAuth callback、refresh/revoke与managed key。
4. 最后运行 live token2api staging E2E；禁止直接用 production账号/secret做开发 fixture。
5. Integration发现 drift时优先修 adapter/server conformance；不得在 UI散落兼容分支。

## 11. Foundation and Expansion Cuts

### Foundation — Complete core account lifecycle

Scope：

- Contract v1、三 lane与 G0/G1/G2。
- Public capabilities、registration、email code、password login、login MFA。
- Persistent session commit、refresh/logout/profile。
- Forgot/reset完整 UI与Mock；Real App completion依赖 Desktop reset ticket gap。
- Account overview的balance/platform quota/usage summary/subscription summary。
- Login后 configuration offer boundary；不自动 provision/apply。
- Local Mode/outage isolation贯穿全部 scenario。

Dependencies：

- token2api S0：access-only success移除、atomic refresh、durable revoke、2FA log cleanup、standard safe errors。
- doge H0：vault/DB/session/flow/callback substrate。
- Desktop reset ticket若未完成，Foundation只能标 `password recovery Web fallback`，不能标 App-complete GA。

Foundation exit：

- Register→verify→persistent session、login→MFA→persistent session、refresh/logout、profile、quota和reset都通过 contract/E2E。
- token2api outage、vault failure、quota exhaustion、session expiry均不影响 Local Mode。
- Raw token/error/PII negative scan全绿。

### Expansion A — OAuth and account security center

- GitHub、Google、LinuxDo、OIDC、WeChat、DingTalk unified Desktop authorization ticket。
- Pending create/bind/adoption、OAuth-internal MFA、email identity binding。
- TOTP setup/enable/disable和revoke-all security actions。
- Device/session inventory在 server API存在后接入；current没有完整 device-aware session center，保持 explicit gap。

Exit：所有 provider不使用 token fragment；cookie/browser session不成为 Rust continuation唯一事实；ticket replay/wrong-device/expiry matrix通过。

### Expansion B — Managed key and one-click configuration

- Dedicated `account × device × purpose` managed key hardening/API。
- One-time key secret→Rust vault；metadata-only management。
- Read-only recipe plan、safe diff、exact consent、apply/recovery。
- Usage按 dedicated key关联，但不暴露 key secret/ID到 generic renderer state。

Exit：三次 consent独立；lost-response orphan cleanup、key revoke、config receipt/recovery通过。

### Expansion C — Full account value surfaces

- Usage trend/detail、subscription progress corrected contract、billing/payment、device/session、multi-account、remote/daemon/web。
- Payment使用 provider-hosted surface；doge不处理 card/bank credential。
- 每个 domain沿用 AccountGateway versioning和 Mock-first/late-integration gate。

## 12. Dependency and Ownership Map

| Shared contract / concern | Single write owner in implementation | Consumers / dependency |
|---|---|---|
| Account Contract v1 schema/fixtures | solution architecture / designated contract owner | Frontend、Rust、token2api contract tests；先于三 lane |
| React `AccountGatewayV1` port | Frontend Experience owner | Mock与Tauri adapters实现；组件只消费 |
| Mock scenario engine | Frontend Experience/test owner | UX review与frontend tests；不被 backend调用 |
| Rust presentation DTO/error mapper | Doge Native Broker owner | Tauri adapter→React；不得由 token2api DTO生成第二 owner |
| Session/vault/flow registry | Doge Native Broker + data/platform bounded owners | 所有 Real account commands依赖 |
| Current auth/profile/usage endpoints | token2api API owner | Rust HTTP adapter；保持 Web compatibility |
| Desktop OAuth/reset tickets | token2api API owner定义 server contract；Rust owner定义 local exchange | Frontend只见 external/flow transition |
| Managed-key server contract | token2api API owner | Rust vault/config pipeline；Frontend separate consent |
| Recipe/config transaction | Doge Native Broker/config owner | token2api只提供 managed credential authority |

## 13. Validation Matrix

| Area | Good | Base | Bad / required failure |
|---|---|---|---|
| Registration | code验证后 persistent session commit | verification关闭时单次 register | invalid/expired code、Turnstile expired、invitation required、access-only response拒绝 |
| Login/MFA | password→MFA→authenticated | 无MFA直接authenticated | invalid credentials、temp flow expired、attempt limit、stale response after cancel |
| Recovery | generic email sent→ticket→reset success | unknown email仍同样 check-email | expired/replayed/wrong-device ticket、App未运行、reset policy disabled |
| OAuth | system browser→ticket→Rust exchange | provider cancel回可重试 state | token fragment、cookie-only continuation、state/PKCE mismatch、pending choice/MFA、callback replay |
| Refresh | singleflight atomic rotation | soft-stale snapshot while offline | two successors、lost response、stale generation commit、revoked family |
| Profile/quota | independent slices with freshness | empty quotas/subscriptions | malformed field、one slice 5xx、quota exhausted但Local Mode仍可用 |
| Error | closed code/messageKey | unknown 4xx generic safe copy | upstream message/body/metadata进入renderer或log |
| Mock parity | canonical transition sequence | deterministic latency | all-success stub、button-local mock、Mock-only field、real-time flake |
| Conformance | Mock/Rust/server同 fixture | additive optional field | breaking shape无version、frontend client-only endpoint被当 current |

Required checks for this future implementation：

- Route inventory test：server registration与documented method/path一致。
- Server handler/service contract tests：register/login/2FA/refresh/logout/revoke/reset/OAuth tickets/profile/quota/subscription。
- Rust fixture tests：standard envelope、legacy 429、malformed HTML/body、timeout/TLS/offline、unknown enum/version。
- Type/secret scan：presentation DTO不存在 token、password、raw message、URL/body/header、pending/reset/OAuth code字段。
- Frontend scenario matrix：happy/error/recovery/latency/offline/MFA/OAuth/email link/expired token。
- Late E2E：system browser callback三平台、vault persistence、restart refresh、logout/revoke、stale quota、Local Mode regression。

## 14. Explicit token2api Gaps

以下均不是 current API reuse：

1. Desktop capability/version negotiation endpoint。
2. MFA-after-completion Desktop authorize/ticket/exchange；禁止 Web token fragment。
3. Desktop password-reset email continuation/ticket。
4. Atomic refresh family/tombstone/reuse/lost-response contract。
5. Durable revoke generation与可核对 revoke receipt。
6. Logout typed remote revocation outcome；current吞掉 revoke failure。
7. Dedicated device/purpose managed-key API与安全 secret lifecycle。
8. Device-aware session inventory/revoke-one/lost-device contract。
9. Subscription progress response正式 shape；current server/client drift。
10. `/subscriptions/:id/progress` server route；current只存在于 frontend client。
11. Standard 429 envelope/retry hint；current rate limiter shape特殊且无 `Retry-After`。
12. OAuth pending session从browser cookie重构/适配为 Desktop authorization binding。

## 15. Completion Gates

本 architecture lane只有满足以下条件才可 handoff 为 formal implementation design：

- 每个 current route均能从 route→handler→DTO/service→frontend client/type核对，或明确标为 server-only/current drift。
- 所有 target-only endpoint均带 `explicit gap`，未写成 current fact。
- React/Rust/token2api 三 lane拥有 disjoint ownership和共同 versioned contract。
- Mock-first策略覆盖 stateful failure/recovery，不允许 button-local mock或all-success stub。
- OAuth/email/captcha/MFA transport均有 Desktop boundary，不嵌 token2api Web page为 App WebView。
- Raw access/refresh/reset/OAuth/pending/TOTP continuation token和raw upstream error不进入 renderer。
- Login→profile/quota/subscription→configuration offer衔接不产生 implicit managed-key/config consent。
- Contract conformance和用户 UI review在 Late integration前均为 blocking gate。

## 16. Route-to-flow Evidence Index

| Flow | Primary evidence |
|---|---|
| Route registration | `token2api:backend/internal/server/router.go`、`backend/internal/server/routes/{auth,user,payment}.go` |
| Register/login/MFA/session/reset | `token2api:backend/internal/handler/auth_handler.go`、`backend/internal/service/auth_service.go` |
| OAuth transport/pending | `token2api:backend/internal/handler/auth_email_oauth.go`、`auth_linuxdo_oauth.go`、`auth_oidc_oauth.go`、`auth_wechat_oauth.go`、`auth_dingtalk_oauth.go`、`auth_oauth_pending_flow.go` |
| Password reset email link | `token2api:backend/internal/service/email_service.go`、`token2api:frontend/src/views/auth/ResetPasswordView.vue` |
| Profile/TOTP | `token2api:backend/internal/handler/{user,totp}_handler.go`、`token2api:frontend/src/api/{user,totp}.ts` |
| Usage/quota/subscription | `token2api:backend/internal/handler/{usage,user,subscription}_handler.go`、`token2api:frontend/src/api/{usage,user,subscriptions}.ts` |
| Billing/payment | `token2api:backend/internal/server/routes/payment.go`、`token2api:frontend/src/api/payment.ts`、`token2api:frontend/src/types/payment.ts` |
| API key | `token2api:backend/internal/handler/api_key_handler.go`、`token2api:backend/internal/handler/dto/types.go`、`token2api:backend/internal/service/api_key_service.go` |
| Web client evidence | `token2api:frontend/src/api/{client,auth,user,usage,subscriptions,keys,payment}.ts`、`token2api:frontend/src/types/index.ts` |
| doge architecture constraints | `.trellis/tasks/08-11-integrate-token2api-account-system/prd.md`、`research/synthesis.md`、`research/product-experience-blueprint.md` |

本文不授权 implementation、live API调用、真实账号操作或 secret读取；下一步由 `doge-project-lead` 将 Contract v1 freeze、三 lane和 gates转成 formal OpenSpec artifacts与 disjoint ownership。
