# Design: token2api Account Convenience v1

> 状态：`architecture-frozen-for-contract-implementation`。
>
> 本文冻结 `integrate-token2api-account-system` 的 v1 architecture、contract layers、ownership、dependency 与 release gates。它不是 implementation，也不表示 token2api gaps、Doge Native Broker、Frontend Experience 或真实 integration 已完成。
>
> 事实基线：本 change 的 `proposal.md`、behavior spec delta、PRD，以及 `research/synthesis.md`、`research/product-experience-blueprint.md`、`research/app-account-api-integration.md`、`research/mock-first-frontend-architecture.md`、`research/parallel-backend-delivery-plan.md`。Current token2api route 与 gap classification 以 research 中逐项 route-to-handler trace 为准。

## 1. Context And Frozen Product Decisions

doge 当前是完整可用的 local-first desktop client，尚无 app-level doge identity、OS credential vault、Desktop OAuth/reset completion、durable account session repository 或安全的一键配置 transaction。token2api 已拥有 identity、email/password、MFA、OAuth identity、profile、usage/quota、subscription、billing 与 generic API key domain，但其 current Web transport、refresh/revoke durability 与 API-key secret lifecycle不能直接成为 Desktop production contract。

本设计冻结以下产品事实，不再作为 implementation open question：

1. **Local Mode 完整可用**：未登录、退出、vault unavailable、token2api outage、quota exhausted、subscription inactive 或 account flag off 均不影响任何既有 local capability。
2. **Account 是低耦合 convenience plane**：doge 是 token2api 的新增完整 interaction client，不是第二个 account backend。
3. **入口固定**：`Settings → Account` 是唯一 fixed/persistent entry；token service/configuration context只提供进入同一 route/state的 lightweight entry。
4. **首期 quota/usage pull-only**：只有用户主动打开或明确 refresh 才读取；没有 threshold、depletion、staleness 或 failure proactive notice。
5. **First recipe 是 Codex**：其他 CLI recipe保留 contract extension point，但不进入首个 integrated trial blocker。
6. **Three-consent boundary**：durable login、existing API Key selection/handoff、exact config apply是三个独立 authorization；前一步成功不能自动触发后一步 mutation。
7. **Delivery strategy**：Contract-first + Mock-first UI + Parallel backend + Late integration。UI Mock review与真实可试用完成是两个不同 verdict。
8. **交付终点**：推进到目标平台可安装、可启动、Real adapter 已联调的 local trial package；Mock-only package不得冒充该终点。

## 2. Goals And Non-goals

### 2.1 Goals

- 冻结可让 Frontend Experience、Doge Native Broker、token2api API/gaps 独立并行实现的 v1 semantic boundary。
- 明确 current API direct reuse、conditional reuse、thin Desktop adapter 与 explicit gap，禁止把 target endpoint写成 current fact。
- 让 React只依赖 credential-minimized `AccountGatewayV1`；让 Rust拥有 session、vault、callback、HTTP、local data与config transaction authority。
- 首个 integrated local trial覆盖完整 account access、必要 profile/security lifecycle、pull-only quota/usage、existing API Key selection/handoff与 Codex one-click configuration。
- 从第一版 schema保留 multi-account、device/session、billing、remote/daemon/web、更多 recipes、migration/retention 与 support extension points。
- 以 capability negotiation、feature flags、conformance、platform evidence与 rollback保证未完成能力 fail closed，且 Local Mode始终可用。

### 2.2 Non-goals

- 不在本文实现 React、Rust、Go、schema migration、fixture、test或packaging代码。
- 不把 token2api Web UI嵌入 App WebView，也不复用 Web `localStorage`、cookie-only continuation或token fragment。
- 不在 doge复制 password hashing、registration policy、MFA validation、OAuth identity merge、quota/subscription calculation或billing settlement。
- 不允许 renderer构造 arbitrary authority URL、redirect URI、filesystem path、raw patch、recipe template或shell command。
- 首个 integrated trial不交付 billing/order UI、device/session inventory、multi-account UI、remote/daemon/web、proactive usage notices或非 Codex recipe。
- 未经目标平台实机 evidence，不宣称 macOS、Windows、Linux feature parity或全平台 GA。

## 3. Architecture Decision

### 3.1 Two planes, one optional link

```text
Local Core Plane
  LocalPrincipal
    -> existing workspace / conversation / engine / file / Git / terminal / local usage
    -> no account, vault, network, quota or entitlement dependency

Account Convenience Plane (lazy + feature-gated)
  React Account Feature
    -> AccountGatewayV1 (product port)
      -> MockAccountGatewayV1                 [review/test only]
      -> RealAccountGatewayV1
        -> AccountIpcV1                       [safe DTO only]
          -> Tauri Rust Native Account Broker
            -> SessionManager + OS Vault + Account SQLite
            -> Desktop callback/reset broker
            -> fixed-origin Token2ApiAuthorityV1 adapter
            -> immutable RecipeCatalog + ConfigTransaction
              -> token2api authority
              -> exact local Codex target/runtime
```

`AccountLink` 只把一个 optional remote identity附加到本机 `LocalPrincipal`。它不拥有、迁移、隐藏或重标 workspace、conversation、settings、local history或任何其他既有 local data。退出、远端删除、switch account或失效均不得改变该 ownership。

### 3.2 Selected topology and rejected alternatives

| Option | Decision | Reason |
|---|---|---|
| Native Host Account Broker + token2api authority | **Selected** | Tauri/Rust能闭合 OS vault、system browser、callback、refresh generation、fixed origin、filesystem transaction与secret boundary；token2api继续是唯一remote authority。 |
| token2api Web as primary account UI | Rejected for App journey | 无法兑现 App 内完整注册/恢复/维护与连续的一键配置；Web fragment/cookie transport不满足Desktop boundary。 |
| doge-specific second account backend/BFF | Rejected for Desktop v1 | 形成 identity/quota/billing双事实源与always-online operations surface；削弱Local Mode和current API reuse。Web/cloud phase可重新评估BFF，但不能改变authority singularity。 |
| Device authorization as Desktop v1 primary flow | Deferred | 适合daemon/headless，但token2api current无该domain；保留为remote/daemon extension，不阻塞local system-browser vertical。 |

### 3.3 Dependency direction

依赖必须单向：

```text
React components/state
  -> AccountGateway product contract
    -> Real adapter mapper
      -> Account IPC safe contract
        -> Broker semantic contract
          -> token2api Authority wire contract

Recipe UI
  -> safe plan/result views
    -> Broker Recipe/Transaction contract
      -> local immutable Codex recipe + vault reference
```

禁止反向依赖或跳层：React不读取 authority DTO；token2api不接收 component state；Rust persistence entity不直接 serialize到renderer；recipe不从remote获得path/patch/script。

## 4. Non-negotiable Invariants

1. **No-login completeness**：Local Mode不是guest/trial；所有既有local capability均完整可用。
2. **Startup independence**：Account module lazy construct；app startup、workspace load、local recovery与engine discovery不等待account DB、vault、network、refresh或quota。
3. **No local entitlement gate**：quota、subscription、billing、revocation只控制新增 `account/*`、`token-service/*`、`cloud/*` namespace。
4. **Local ownership preservation**：`LocalPrincipal`永不被`AccountLink`替换；remote lifecycle不删除或迁移local data。
5. **OS-vault-only durable secrets**：refresh credential与managed API key只进OS vault；vault locked/unavailable时无session-only mode、无plaintext/fallback vault，Account capability fail closed而Local Mode正常。
6. **Three independent consents**：login、existing API Key selection/handoff、exact-plan apply不可合并或隐式继承。
7. **No raw secret/error to renderer**：access/refresh/API key、OAuth/reset/desktop ticket、PKCE verifier、provider cookie、raw authority body/message/header、raw config/path/diff不得进入renderer response、generic store、log、metric或support bundle。
8. **Purpose-scoped input exception**：用户输入的password/code/TOTP可在form local state与单次narrow IPC request中短暂存在；不得回显、persist、trace或进入generic state。TOTP enrollment QR/manual secret只允许在专用modal内短暂呈现，关闭立即清理且不得截图测试。
9. **No wrong-host mutation**：plan和receipt绑定authority origin、account epoch、device、target host、recipe/version、catalog digest、managed-key generation、file identity/fingerprint与TTL；任一变化均replan。
10. **Local immutable recipe authority**：server只能引用本地已安装的`recipeId/version`；不得下发arbitrary path、patch、template、command或executable payload。
11. **Durable terminal truth**：consented config apply只有在durable receipt或recovery checkpoint提交后才能成为terminal；timeout、event或HTTP 2xx不是success proof。
12. **Mutation ambiguity is explicit**：bytes可能已发送后的cancel/timeout返回`outcomeUnknown`并reconcile，不能宣称未执行。
13. **Unverified capability disabled**：server guarantee、Desktop transport、vault或platform evidence缺一项，对应action hidden/unavailable；不得best effort后才报错。
14. **Pull-only quota in first trial**：不进行后台quota polling或proactive notice；view open/explicit refresh之外的invalidations只标记下次读取，不主动fetch。
15. **Mock never masks reality**：Mock只用于dev/test/review，release build不可选择，Real失败不得fallback到Mock success。

## 5. Capability Landscape And Release Placement

完整scope在本design中都有contract或extension point；“deferred”只表示implementation cut，不表示从Master Plan删除。

| Domain | v1 design frozen now | First integrated trial | Later implementation |
|---|---|---|---|
| Local Mode | startup/ownership/no-gate invariant、guest regression | **Required** | 永久gate |
| Auth | public capability、register、email code、login、MFA、OAuth、forgot/reset continuation | **Required**，只开放server+platform已conform的provider | device authorization、new providers |
| Profile/security | profile read/update、password change、TOTP、identity binding、revoke-all closed semantics | **Required where current capability enabled**；Desktop OAuth binding需gap closure | expanded security center/recovery methods |
| Session | durable pair、vault commit、restore、singleflight refresh、logout/revoke、epoch fencing | **Required** | device-aware per-session inventory |
| Selected API Key binding | account-owned key metadata、account×device×recipe Desktop handoff、OS-vault binding、refresh/revoke/idempotency | **Required for Codex apply** | policy variants、additional purposes |
| Codex recipe | local immutable recipe、read-only plan、safe diff、apply/recovery、runtime binding | **Required** | alternate Codex modes/version migrations |
| Additional recipes | common recipe schema and platform gates | Not implemented | Claude/Gemini/OpenCode/others independently versioned |
| Quota/usage | remote source labels、freshness、stale/unavailable、pull policy | **Required pull-only summary/view** | trends/detail、opt-in notices by later decision |
| Subscription | summary/read model与entitlement namespace | Optional read summary supporting quota context | commerce management/progress correction |
| Billing/payment | provider-hosted boundary、order idempotency、settlement refresh extension | Not implemented | independent commercial release |
| Device/session | durable device identity、future inventory/revoke-one schema seam | No UI; `DeviceId` exists internally | full device/session center |
| Multi-account | per-account keys/schema/epoch/dismiss/receipt isolation | one active account exposed | add/switch/remove UI and mismatch handling |
| Remote/daemon/web | host-bound capability、no-wrong-host、device auth/BFF seam | Not implemented | independent threat/platform release |
| Security/privacy | placement、redaction、retention、threat gates | **Required** | continuous expansion review |
| Observability/support | closed low-cardinality events、strict bundle、SLO seams | **Required** | operational dashboards/runbooks |
| Migration/retention | versioned DB/vault/receipt、key migration、quarantine | **Required for introduced data** | account export/deletion and broader retention |
| Rollout/rollback | flags、guarantees、cohort、kill switch、package verdicts | **Required** | per-domain/per-platform rollout |

## 6. Authoritative Versioned Contract Layers

不存在一个跨所有层直接共享的DTO。每层有唯一authority和明确consumer，防止Go/Rust/TypeScript互相镜像内部结构。

| Layer / initial version | Authority / single write owner | Normative content | Consumers |
|---|---|---|---|
| Behavior spec | current OpenSpec capability | Product/spec owner | user-observable invariants、release acceptance | all lanes |
| `doge-account-semantic/1.0.0` | designated contract owner in doge | closed capability/state/error/outcome semantics、scenario IDs、secret classification | Frontend、Broker、Authority conformance |
| `doge-account-gateway/1.0.0` | Frontend Experience owner | React-facing port、safe view models、domain intents/events | Mock adapter、Real adapter、components |
| `doge-account-ipc/1.0.0` | Doge Native Broker owner | Tauri command/event envelope、request secrecy、safe output | Real frontend adapter、Rust command layer |
| `doge-account-broker/1.0.0` | Doge Native Broker owner | lifecycle、operation receipt、epoch/idempotency/cancel/reconcile semantics | Rust adapters/repository/vault/config |
| `token2api-account-authority/1.0.0` | token2api API owner | exact current/new HTTP paths、envelope/reasons、guarantee descriptor、idempotency | Rust authority adapter、server contract tests |
| `doge-config-recipe/1.0.0` | Doge config/transaction owner | recipe schema、target slots、plan binding、file outcomes、recovery | Codex recipe、future recipes、config UI mapper |
| `doge.account.codex-token-service/1` | Codex recipe owner | fixed nonsecret provider config、runtime credential injection、verification/reload policy | Config planner/transaction、Codex runtime |
| persistence schema v1 | Doge data/storage bounded owner | SQLite tables/migrations、vault alias schema、receipt journal | Broker startup/reconcile |

### 6.1 Version policy

- Removing/renaming a field, changing requiredness, changing terminal truth, retry/cancel/idempotency meaning or reusing an enum value requires a **major** version.
- Additive optional fields/capabilities require a **minor** version and capability negotiation; old consumers ignore unknown fields at ingress but never forward them.
- Bug/test fixture fixes that preserve observable semantics use a **patch** version.
- Unknown field is ignored by the layer decoder and increments a drift metric. Unknown enum/reason or missing required guarantee maps to `protocolMismatch`/`capabilityUnavailable` and fails the affected action closed.
- Major mismatch disables Account Convenience composition, not Local Mode.
- Each IPC success envelope carries `{ contractId, contractVersion, value }`; an error envelope carries only closed v1 error fields plus the locally supported contract identity when known.

### 6.2 Canonical semantic scenario manifest

`doge-account-semantic/1.0.0` owns a secret-free `ScenarioManifestV1` containing scenario id, initial semantic state, ordered intents, expected transitions, terminal/nonterminal outcome, required capability and privacy assertions. The three lanes may maintain layer-specific fixtures, but may not redefine an existing scenario's observable meaning.

Required families：

- bootstrap/offline/outage/vault unavailable/version mismatch；
- registration direct/email-code/policy/cooldown/expired/recovery；
- login invalid/MFA success-expiry-rate limit/lost response；
- OAuth approve/deny/create-vs-bind/MFA/state mismatch/replay/late callback/restart；
- forgot/reset accepted/valid/expired/consumed/replay/app-not-running；
- restore/refresh concurrency/lost response/revoke/logout remote-unconfirmed；
- profile/password/TOTP/identity/revoke-all；
- quota fresh/stale/unavailable/exhausted with Local Mode intact；
- API Key list/empty/refresh/selection/handoff/vault failure/orphan/revoke；
- Codex no-config/manual-preserve/conflict/already-configured/plan expiry/concurrent edit/Nth-file failure/rollback incomplete/reload failure/close-ack-dismiss；
- stale response after account epoch/scenario generation change。

## 7. Three Parallel Delivery Lanes

### 7.1 Lane F — Frontend Experience

Owns：

- `AccountGatewayV1` product port and safe presentation models；
- Settings → Account、contextual lightweight entry、Auth Container、Account Center、pull-only usage view与Codex configuration surfaces；
- Auth Container采用少量主导航：signed-out只显示`login / register`两个Tab，password recovery从login内action进入focused subflow；Account Center只显示`overview / usage / security`三个Tab，Codex configuration由overview CTA或App-level bubble进入。M0 Mock package只替换Gateway composition，Settings与App-level bubble共享同一个process-lifetime Preview Gateway task state；禁止把scenario selector、raw scenario id、`交互预览`或zero-call标签暴露到Settings产品页面，scenario controls仅属于`AccountLab`和自动化测试。Configuration dialog初始focus落安全普通关闭action，不能落help trigger导致tooltip自动展开。
- deterministic stateful Mock adapter、virtual clock、scenario catalog/Account Lab；
- presentation state machines、a11y、i18n、visual/manual review与production Mock exclusion。

Does not own：HTTP route、Tauri command implementation、vault、callback、token/session、server policy、filesystem mutation或raw config mapping。

Before Late Integration：

- UI composition只能注入Mock；real token2api network与doge native/backend call count必须为zero。
- Components/hooks不得import Mock/Real/Tauri/token2api DTO，也不得判断adapter mode。
- Mock必须stateful/deterministic，未命中scenario返回closed failure，不能默认success。

### 7.2 Lane D — Doge Native Broker

Owns：

- Broker state machine、narrow IPC、safe mapper、closed errors；
- fixed-origin HTTPS adapter、deadline/idempotency/cancel/reconcile；
- OS vault、account SQLite、access-memory/refresh-generation、epoch fencing；
- system browser、loopback/deep link、single-instance callback ownership；
- selected API Key vault lifecycle；
- immutable recipe catalog、Codex planner、transaction/receipt/recovery与runtime credential injection；
- fake authority/fault-injecting vault/repository harness、Local Mode isolation tests。

Does not own：token2api user/business rules、React journey/copy、remote endpoint policy、arbitrary HTTP proxy、plaintext secret fallback。

Lane D只可连接stateful fake authority或ephemeral local fake HTTP server，直到cross-lane conformance批准真实test authority；UI review期不进入production composition。

### 7.3 Lane T — token2api API / gaps

Owns：

- current route compatibility与server-side contract tests；
- Authority v1 capability/guarantee descriptor；
- durable token pair、atomic refresh/replay/family tombstone、durable revocation；
- Desktop OAuth/reset/human-verification continuation；
- selected existing API Key metadata/handoff lifecycle与 patch semantics；
- stable reasons、typed logout/revoke outcome、subscription drift corrections；
- sanitized canonical wire fixtures。

Does not own：doge vault/DB/Tauri/React/config recipe/local path；不新增第二identity domain。任何token2api source/schema change仍服从其repo approval/upstream governance。

### 7.4 Cross-lane change rule

只有designated contract owner可修改canonical semantic manifest/shared schema。若任一lane发现breaking need：停止affected integration，提交version decision，更新manifest/fixtures，三lane重新conform。Real adapter不得私藏兼容boolean，Frontend不得添加route-specific branch。

## 8. Frontend Product Port And State Contract

### 8.1 `AccountGatewayV1`

```ts
interface AccountGatewayV1 {
  readonly contract: { id: "doge-account-gateway"; version: "1.0.0" };
  bootstrap(ctx: CallContext): Promise<Result<AccountBootstrapViewV1>>;
  subscribe(listener: (event: AccountEventV1) => void): () => void;
  readonly humanVerification: HumanVerificationPortV1;
  readonly auth: AccountAuthPortV1;
  readonly profile: AccountProfilePortV1;
  readonly usage: AccountUsagePortV1;
  readonly managedKey: AccountManagedKeyPortV1;
  readonly configuration: AccountConfigurationPortV1;
}
```

Frozen operation inventory：

- Human verification：`readRequirement`、`submitProof`；
- Auth：`beginRegistration`、`resendRegistrationCode`、`submitRegistrationCode`、`login`、`verifyMfa`、`startOAuth`、`cancelOAuth`、`completeOAuthAccount`、`requestPasswordReset`、`inspectExternalIntent`、`resetPassword`、`logout`；
- Profile/security：`read`、`updateProfile`、`changePassword`、TOTP status/setup/enable/disable、identity bind/unbind、`revokeAllSessions`；
- Usage：`read` only in first trial；
- Managed key：`readStatus`、`provision`、`rotate`、`revoke`；
- Configuration：`readOffer`、`createPlan`、`readFileDetail`、`apply`、`readCurrentTask`、`acknowledgeResult`、`hardDismiss`。

`refresh`由Broker session policy拥有，不作为常规component action。UI遇到`sessionExpired`只能发`loginAgain`；若产品surface提供explicit retry，它调用session re-read/reconcile intent，而不接收refresh credential。

#### Operation request/result freeze

下表冻结Gateway层的semantic request shape。`SecretInput`只表示purpose-scoped transient input；它不能进入generic store、trace、fixture或response。所有mutation都额外接收`CallContext { operationId, signal? }`，其中UI `operationId`只用于local logical dedupe，Broker会产生自己的authority operation id。

| Operation | Safe/transient input | Result |
|---|---|---|
| `bootstrap` | none | `AccountBootstrapViewV1` |
| `humanVerification.readRequirement` | `purpose` | not-required / required(provider, public site metadata) / unavailable |
| `humanVerification.submitProof` | `purpose + SecretInput proof` | one-use opaque verification handle + expiry |
| `auth.beginRegistration` | email、`SecretInput password`、optional invitation/promo、agreement、optional verification handle | `AuthNextV1` |
| `auth.resendRegistrationCode` | auth attempt + optional verification handle | verification transition with new cooldown |
| `auth.submitRegistrationCode` | auth attempt + `SecretInput code` | `AuthNextV1` |
| `auth.login` | email、`SecretInput password`、optional verification handle | MFA or authenticated transition |
| `auth.verifyMfa` | auth attempt + `SecretInput code` | `AuthNextV1` |
| `auth.startOAuth` | closed provider capability key | OAuth waiting transition；browser destination stays in Rust |
| `auth.cancelOAuth` | OAuth attempt | typed cancel receipt |
| `auth.completeOAuthAccount` | attempt + only fields named by current requirements；password/code/TOTP are `SecretInput` | completion/MFA/verification/authenticated transition |
| `auth.requestPasswordReset` | email + optional verification handle | uniform reset-requested transition |
| `auth.inspectExternalIntent` | external intent handle | reset-ready transition or closed invalid/expired/replayed error |
| `auth.resetPassword` | external intent + `SecretInput newPassword` | reset completed；does not auto-login |
| `auth.logout` | `thisDevice | allSessions` | local clear + remote `confirmed | unconfirmed` receipt |
| `profile.read/updateProfile` | none / allowlisted display profile fields | `AccountCenterViewV1` |
| `profile.changePassword` | current/new `SecretInput` | changed receipt；session effect is separately authoritative |
| `profile.requestTotpEmailCode` | none | cooldown only |
| `profile.begin/confirm/disableTotp` | required password/email code/TOTP as `SecretInput` | purpose-scoped enrollment presentation or closed receipt |
| `profile.startIdentityBinding/unbindIdentity` | provider capability；required transient proof | OAuth transition or unbound receipt |
| `profile.revokeAllSessions` | explicit scope confirmation | durable confirmed or outcome-unknown receipt |
| `usage.read` | none | `QuotaUsageViewV1` with source/fetchedAt/freshness；never local usage aggregation |
| `managedKey.readStatus` | recipe id/version | absent / ready / attention / unavailable；no raw key or authority id |
| `managedKey.listCandidates` | recipe id/version | name、masked prefix、status、safe availability only |
| `managedKey.selectExisting` | recipe id/version + opaque key handle + `useSelectedApiKey` consent | ready status only after owner-authorized Desktop handoff and OS-vault commit |
| `managedKey.rotate` | legacy dedicated-key operation；not used by the existing-key product flow | typed receipt + safe resulting status |
| `managedKey.revoke` | recipe id/version + `removeLocalKey` consent | removes only the account/device-scoped OS-vault binding；MUST NOT delete the selected remote API Key |
| `configuration.readOffer` | none | adaptive offer based on session/key/recipe/local target state |
| `configuration.createPlan` | recipe id/version + `configure | review` intent | safe plan handle/summary/list；zero write |
| `configuration.readFileDetail` | plan + file handle | semantic redacted detail |
| `configuration.apply` | plan + literal `applyExactPlan` consent | durable `ConfigurationResultViewV1` |
| `configuration.readCurrentTask` | none | authoritative offer/plan/result/attention snapshot |
| `configuration.acknowledgeResult` | result handle | acknowledged receipt |
| `configuration.hardDismiss` | recipe id/version | dismissal receipt；never logout/delete/rollback |

The first-trial capability keys are also frozen：

```text
auth.emailPasswordLogin
auth.registration
auth.registrationEmailVerification
auth.passwordReset
auth.humanVerification
auth.mfa
auth.oauth.<github|google|linuxdo|wechat|oidc|dingtalk>
account.profile
account.passwordChange
account.totp
account.identityBindings
account.revokeAllSessions
usage.quotaPull
subscription.summary
managedKey.listCandidates
managedKey.selectExisting
managedKey.rotate
managedKey.revoke
configuration.plan
configuration.apply
recipe.codex.v1
```

Future keys use reserved namespaces `billing.*`、`deviceSessions.*`、`multiAccount.*`、`remote.*` and `recipe.<id>.v<major>`。A missing/unknown key is not enabled；new key addition is a semantic contract minor change。

#### Renderer-safe view minimum shape

G1 executable schemas must preserve this minimum shape；they may add optional minor-version fields but may not expose authority or persistence DTOs。

```ts
type AvailabilityV1 =
  | { status: "enabled" }
  | {
      status: "disabled";
      reason:
        | "serverDisabled"
        | "serverGuaranteeMissing"
        | "desktopUnsupported"
        | "platformUnverified"
        | "featureFlagOff"
        | "vaultUnavailable";
    }
  | { status: "unknown"; reason: "loading" | "offline" | "serviceUnavailable" };

type AccountCapabilitiesViewV1 = {
  contractVersion: "1.0.0";
  observedAt: string; // RFC 3339 UTC
  freshness: "fresh" | "softStale" | "hardExpired";
  entries: Readonly<Record<string, AvailabilityV1>>;
  registration: {
    emailSuffixHint: string | null;
    invitationCode: "hidden" | "optional" | "required";
    promoCode: "hidden" | "optional";
    agreementRequired: boolean;
    humanVerificationRequired: boolean;
  };
};

type AccountSessionViewV1 =
  | { status: "signedOut" }
  | {
      status: "authenticated";
      accountEpoch: number;
      sessionCapability: "persistent";
      profileLabel: string;
      primaryEmailLabel: string | null;
    }
  | { status: "expired" | "revoked"; previousProfileLabel: string | null };

type AccountBootstrapViewV1 = {
  localMode: { status: "available"; blockedByAccount: false };
  gatewayAvailability: "ready" | "offline" | "serviceUnavailable";
  vault: "ready" | "locked" | "unavailable" | "inconsistent";
  capabilities: AccountCapabilitiesViewV1;
  session: AccountSessionViewV1;
};

type QuotaMeasureV1 = {
  value: string; // canonical non-negative decimal string; precision review closes at G1
  unit: "requests" | "credits" | "tokens" | "usd";
};

type QuotaUsageViewV1 = {
  status: "available" | "unavailable";
  source: "token2apiAccount" | "token2apiPlatformQuota" | "token2apiSubscription";
  freshness: "fresh" | "softStale" | "hardExpired";
  observedAt: string | null; // source observation time
  fetchedAt: string | null;  // broker observation time
  remaining: QuotaMeasureV1 | null;
  used: QuotaMeasureV1 | null;
  resetsAt: string | null;
  subscriptionLabel: string | null;
};

type ManagedKeyStatusViewV1 =
  | { status: "absent" }
  | { status: "ready"; recipeId: string; recipeVersion: number }
  | { status: "attention"; action: "rotate" | "reprovision" | "revoke" }
  | { status: "unavailable"; reason: "capabilityUnavailable" | "vaultUnavailable" };

type ConfigurationPlanViewV1 = {
  plan: ConfigPlanHandle;
  recipeId: string;
  recipeVersion: number;
  targetLabel: string;
  expiresAt: string;
  summary: "changesPlanned" | "noop" | "blocked";
  files: readonly {
    file: ConfigFileHandle;
    targetLabel: string;
    outcome: "willChange" | "unchanged" | "blocked";
  }[];
};

type ConfigurationResultViewV1 = {
  result: ConfigResultHandle;
  overall: "unchanged" | "applied" | "rolledBack" | "rollbackIncomplete" | "aborted";
  files: readonly {
    targetLabel: string;
    outcome:
      | "unchanged"
      | "applied"
      | "rolledBack"
      | "rollbackFailed"
      | "skippedPrecondition"
      | "failedBeforeWrite";
  }[];
  reload: {
    requirement: "none" | "newSessions" | "restartRequired";
    status: "notNeeded" | "pending" | "applied" | "failed";
  };
  verification: "notRequired" | "pending" | "usable" | "failed";
  acknowledged: boolean;
};
```

`profileLabel`、`primaryEmailLabel` and `subscriptionLabel` are purpose-scoped display strings, not durable identities or analytics dimensions。They are cleared on sign-out/account epoch change and may be absent while offline。Capability map keys are runtime-validated against the current semantic minor version；unknown keys are retained only as disabled/ignored transport observations, not rendered as actions。

### 8.2 Opaque handles

Renderer只可持有短期opaque handles：`AuthAttemptHandle`、`OAuthAttemptHandle`、`ExternalIntentHandle`、`ConfigPlanHandle`、`ConfigFileHandle`、`ConfigResultHandle`。Handle不编码token、path、account id或secret，不进入analytics/support snapshot，受account epoch、process generation与TTL约束。

### 8.3 Orthogonal state

```ts
type AccountFeatureStateV1 = {
  module: "disabled" | "booting" | "ready" | "unavailable";
  localMode: { status: "available"; blockedByAccount: false };
  lifecycle: "signedOut" | "authorizing" | "authenticated" | "expiring" | "revoking";
  sessionCapability: "persistent" | "none";
  vault: "ready" | "locked" | "unavailable" | "inconsistent";
  connectivity: "online" | "offline" | "serviceUnavailable";
  capabilityFreshness: "fresh" | "softStale" | "hardExpired";
  accountEpoch: number | null;
  authFlow: AuthFlowStateV1;
  usage: RemoteResourceStateV1<QuotaUsageViewV1>;
  configuration: ConfigurationTaskStateV1;
};
```

Rules：

- `sessionCapability="persistent"`只有vault+metadata commit完成且authority identity验证后成立；v1无`sessionOnly`。
- `authenticated`不自动意味着online、vault ready、usage fresh或config eligible。
- MFA/OAuth/reset是authorization flow state，不是authenticated error/success shortcut。
- 每个async lane有generation；account epoch、adapter/scenario reset或route lifecycle改变后，stale response不得commit。
- Event只用于wakeup/invalidation；terminal truth由action result或authoritative read收敛。
- Usage refresh failure保留last-known并标stale，不清零；first trial没有background poll/notice。

### 8.4 Auth transition contract

`AuthNextV1`是closed union：

```text
verification(attempt, emailLabel, resendAt)
mfa(attempt, expiresAt)
oauthWaiting(attempt, providerLabel, expiresAt)
oauthAccountCompletion(attempt, requirements[])
resetRequested(requestAccepted=true)
passwordResetReady(intent, expiresAt)
authenticated(sessionView)
```

`authenticated`只能由Broker在durable session activation saga完成后发布。Registration code、MFA code、password与human-verification proof在单次request后清理；pending flow只保留opaque handle与safe summary。

### 8.5 Configuration task state

```text
idle
 -> offer(unread)
 -> planning
 -> planReady
 -> applying
 -> result(unread) | attention(unread)
 -> acknowledged | hardDismissed(recipe/version scoped)
```

- ordinary close只关闭surface，不更改task/unread；bubble恢复当前task。
- applying可以minimize，不可hard dismiss。
- `acknowledgeResult`只清当前result unread；不删除receipt、历史或bubble recoverability policy。
- bubble独立`×`才是`hardDismiss`，key为`accountLink × device × recipeId × recipeVersion`。
- account epoch/recipe version/plan TTL/file fingerprint变化使plan stale，必须replan。

## 9. Narrow IPC Contract

### 9.1 Envelope

```ts
type AccountIpcResultV1<T> =
  | { ok: true; contractId: "doge-account-ipc"; contractVersion: "1.0.0"; value: T }
  | { ok: false; contractId: "doge-account-ipc"; contractVersion: "1.0.0"; error: AccountFailureV1 };
```

`AccountFailureV1`只含closed `code`、`stage`、`retryable`、optional bounded `retryAfterMs`、optional closed `field`与`action`。不含arbitrary `message/detail/reason/metadata`。Frontend按`code+stage+action` exhaustive映射到i18n copy。

### 9.2 Command inventory

下列command names是v1 IPC authority；implementation可在Rust内部进一步拆分，但不能向renderer暴露generic HTTP/vault/filesystem escape hatch。

| Command family | Commands | Secret input allowed | Safe output |
|---|---|---:|---|
| Bootstrap | `account_v1_bootstrap`、`account_v1_capabilities_read`、`account_v1_session_read` | no | capabilities/session/vault/connectivity views |
| Human verification | `account_v1_challenge_read`、`account_v1_challenge_submit` | proof on submit | opaque handle/expiry only |
| Registration | `account_v1_registration_begin`、`account_v1_registration_resend`、`account_v1_registration_verify` | password/code/policy inputs | `AuthNextV1` |
| Login/MFA | `account_v1_login_begin`、`account_v1_mfa_submit` | password/TOTP | `AuthNextV1` |
| OAuth | `account_v1_oauth_begin`、`account_v1_oauth_cancel`、`account_v1_oauth_account_complete` | completion form secrets if required | waiting/completion/auth transition; no URL/ticket |
| Reset | `account_v1_password_reset_request`、`account_v1_external_intent_inspect`、`account_v1_password_reset_complete` | new password | accepted/ready/completed view |
| Session | `account_v1_logout`、`account_v1_revoke_all_sessions`、`account_v1_session_reconcile` | no | typed local/remote receipt |
| Profile | `account_v1_profile_read`、`account_v1_profile_update`、`account_v1_password_change` | operation-specific password | allowlisted profile/security view |
| TOTP | `account_v1_totp_status_read`、`account_v1_totp_email_code_request`、`account_v1_totp_enrollment_begin`、`account_v1_totp_enrollment_confirm`、`account_v1_totp_disable` | operation-specific password/code | purpose-scoped presentation or closed receipt |
| Identity | `account_v1_identity_bind_begin`、`account_v1_identity_unbind` | operation-specific password/code | safe transition/receipt |
| Usage | `account_v1_usage_read` | no | quota/usage/subscription summary with freshness/source |
| Managed key | `account_v1_managed_key_status`、`account_v1_managed_key_provision`、`account_v1_managed_key_rotate`、`account_v1_managed_key_revoke` | exact provision/rotate/revoke consent；secret never comes from renderer | safe status/receipt only |
| Configuration | `account_v1_config_offer_read`、`account_v1_config_plan_create`、`account_v1_config_file_detail_read`、`account_v1_config_apply`、`account_v1_config_task_read`、`account_v1_config_result_acknowledge`、`account_v1_config_hard_dismiss` | exact apply consent only | handles、friendly labels、safe semantic values、terminal result |

IPC output recursive scanner must reject field names/values matching access/refresh/password/TOTP code/desktop ticket/reset token/API key/cookie/Authorization/raw URL/raw path/raw content/raw diff. Secret request types不得`Debug`/`Clone`或serialize到trace；command timing/logging使用operation class而非payload。

### 9.3 Event inventory and ordering

The v1 event channel is `account-v1://event` with a closed payload：

```text
sessionChanged(sessionView, eventSeq)
capabilitiesInvalidated(eventSeq)
externalFlowChanged(flowHandle, waiting|returned|cancelled|expired, eventSeq)
usageInvalidated(eventSeq)
configurationTaskChanged(eventSeq)
```

- `eventSeq` is monotonic within one Broker process generation and is not a durable identity。
- Events contain no raw cause, account id, URL, path or secret；handles are omitted when no current renderer lifecycle owns them。
- Events may arrive before the initiating command ACK or after surface unmount。Frontend increments the corresponding generation and performs the authoritative read；it never treats an event as durable terminal success。
- On subscribe/reconnect, frontend calls `account_v1_bootstrap` and `account_v1_config_task_read` instead of replaying an unbounded event history。
- Account event emission is scoped to the Account feature；it does not append high-frequency arrays or force root `AppShell` state updates。

## 10. Broker Semantic, Idempotency And Session Contract

### 10.1 Broker operation receipt

每个mutation由Rust生成stable `operationId`与request fingerprint；renderer提供的`operationId`只作为UI logical dedupe hint，不能成为authority key source。

```text
BrokerReceiptV1
  operationId
  terminal = succeeded | rejected | cancelledBeforeSend | outcomeUnknown
  authorityScope = notContacted | contacted | confirmed | reconciliationPending
  sessionEffect = unchanged | activated | refreshed | locallyCleared | remotelyRevoked
  nextAction = none | retry | reauthenticate | unlockVault | reconcile | contactSupport
  safeProjectionHandle?
```

Cancellation semantics：

- before dispatch：`cancelledBeforeSend/notContacted`；
- read in flight：abort transport，discard partial body；
- flow waiting：invalidate local handle；server ticket revoked或自然过期；
- mutation after possible send：`outcomeUnknown/reconciliationPending`，stable operation id reconcile；
- logout：local clear独立成功；remote failure不得回滚本地退出，也不得声称remote revoked；
- shutdown：停止新操作、flush nonsecret ledger，不无限等待network。

### 10.2 Durable session activation saga

1. Auth/MFA/OAuth authority success必须包含capability-guaranteed durable token pair；access-only success整体拒绝。
2. Access token只进入Rust memory；refresh credential以new generation stage到OS vault。
3. Vault stage失败：不建立session，best-effort revoke new family并记录safe recovery。
4. Vault stage成功后，SQLite transaction提交`AccountLink`、account epoch、vault generation ref与operation receipt。
5. Metadata commit后activate new vault generation，再清理old generation；cleanup failure进入bounded reconcile。
6. Broker用`/auth/me`或equivalent验证authority identity与epoch一致。
7. 只有步骤1–6成立，发布`authenticated/persistent`。
8. Crash/startup时reconcile staged/orphan/missing generation；任何失败只使Account Convenience signed out/unavailable，Local Mode继续。

### 10.3 Refresh

- 每个account epoch最多一个refresh singleflight owner。
- Server必须atomic consume-and-rotate；同一old credential + operation id在lost-response window replay同一successor。
- Reuse触发family tombstone；access/refresh verification均检查durable revocation generation。
- New vault generation与SQLite activation沿用session saga。
- Late old-generation response只做safe reconcile，不可commit projection。

### 10.4 Logout and revoke

- `thisDevice`：先清local active session/vault ref，再attempt remote refresh-family revoke；result区分`confirmed|unconfirmed`。
- `allSessions`：只有durable server generation receipt确认后显示remote revoke success。
- Logout不删除Codex config或LocalPrincipal data。Managed key/config保留或revoke是独立明确action，不从logout推导。

## 11. Authority API Reuse And Explicit Gaps

### 11.1 Current route mapping

所有HTTP由Rust fixed-origin client调用；React不直连。`/api/v1`为current base。

| Capability | Current method/path | v1 verdict |
|---|---|---|
| Public settings | `GET /settings/public` | Direct through broker；投影allowlisted capabilities，不把raw setting变execution authority。 |
| Registration code | `POST /auth/send-verify-code` | Direct；Turnstile required时受Desktop proof capability约束。 |
| Register | `POST /auth/register` | Conditional；durable pair guarantee关闭前不得激活persistent session。 |
| Invitation/promo validation | `POST /auth/validate-invitation-code`、`/auth/validate-promo-code` | Direct when enabled。 |
| Login/MFA | `POST /auth/login`、`POST /auth/login/2fa` | Conditional；temp token仅Rust memory；2FA sensitive logs和durable pair prerequisite先关闭。 |
| Current user/profile | `GET /auth/me`、`GET /user/profile`、`PUT /user`、`PUT /user/password` | Direct through broker with allowlisted mapping。 |
| TOTP | `/user/totp/status|verification-method|send-code|setup|enable|disable` | Direct through broker；setup presentation是purpose-scoped sensitive exception。 |
| Identity binding | current email/OAuth binding families | Email direct；OAuth binding需Desktop authorization adapter。 |
| Forgot request | `POST /auth/forgot-password` | Request semantics direct；App link completion是gap。 |
| Reset complete | `POST /auth/reset-password` | Domain logic reusable；current raw email/token link不能直接交App。 |
| Refresh | `POST /auth/refresh` | Conditional afteratomic rotation/replay/family closure。 |
| Logout/revoke-all | `POST /auth/logout`、`POST /auth/revoke-all-sessions` | Conditional aftertyped outcome/durable generation。 |
| Platform quota/usage | `GET /user/platform-quotas`、`/usage/**` | Direct for pull-only view；broker adds source/fetch/freshness。 |
| Subscription | `GET /subscriptions`、`/active`、`/summary` | Direct read；`/progress` current shape drift不能作为v1 stable contract。 |
| Billing/orders | `/payment/**` | Later conditional reuse；provider-hosted completion only。 |
| Generic API keys | `GET/POST /keys`、`GET/PUT/DELETE /keys/:id` | Not safe for managed recipe until secret lifecycle gaps close。 |

### 11.2 Gap register

这些均是target work，不是current API reuse：

| Gap | Required target semantic | Blocks |
|---|---|---|
| `T-GAP-01` durable auth success | refresh persistence failure makes whole auth fail；descriptor guarantees token pair | all persistent auth |
| `T-GAP-02` atomic refresh family | atomic consume/rotate、same-op replay、family tombstone、lost-response reconcile | restore/refresh |
| `T-GAP-03` durable revoke generation | persisted generation checked by access+refresh across DB/Redis reload | revoke-all/password invalidation |
| `T-GAP-04` Desktop OAuth authorization | state/nonce/PKCE/audience/device-bound, short-lived single-use ticket after MFA | OAuth login/register/bind |
| `T-GAP-05` Desktop reset handoff | trusted HTTPS email landing consumes raw reset token and issues App-bound opaque ticket | in-App reset completion |
| `T-GAP-06` selected API Key secret lifecycle | hash-for-auth + envelope-encrypted owner-recoverable secret、metadata-only list/get、device/recipe-bound handoff、lost-response replay | Codex selected key binding |
| `T-GAP-07` key patch semantics | omitted/clear/set ACL distinct; stable validation/idempotency | key maintenance |
| `T-GAP-08` stable account reasons | all UI-significant branches emit closed machine reason; no message parsing | complete Real error mapping |
| `T-GAP-09` capability/version descriptor | contract version + per-guarantee bits match deployment | safe Real enablement |
| `T-GAP-10` device/session API | inventory、revoke-one、lost-device、deletion | later device/session UI |
| `T-GAP-11` typed logout outcome | remote revoke confirmed/unconfirmed or reconcile receipt | truthful logout security state |
| `T-GAP-12` Desktop human-verification proof | when Turnstile is required, verified browser/WebView proof becomes one-use Desktop handle without persistent renderer token | enabled auth policies requiring challenge |
| `T-GAP-13` subscription progress correction | server/client collection shape and partial failures formalized；single-id route either added with ownership check or removed from client contract | later detailed subscription UI |

Lane T owns exact new HTTP path assignment and OpenAPI/wire schema during its `T0` contract slice. Until that authority manifest lands, Lane D codes against semantic `Token2ApiAuthorityV1` and fake fixtures; no one may invent a current path. Recommended namespace is under current base as a versioned Desktop family, but path naming is not evidence of an existing route.

### 11.3 Authority capability descriptor

Real composition computes each action from the intersection of local build support, platform evidence, product flag, server enabled setting and declared guarantee. Minimum guarantee keys：

```text
durable_token_pair_v1
atomic_refresh_replay_v1
durable_revocation_generation_v1
desktop_oauth_ticket_v1
desktop_reset_handoff_v1
desktop_human_verification_v1
api_key_one_time_secret_v1
api_key_metadata_only_reads_v1
stable_account_reasons_v1
typed_logout_outcome_v1
```

Route existence without a guarantee bit is unsupported. Server kill switch first removes/changes descriptor, then rejects new operations; doge never falls back to Web fragment/access-only/raw key。

## 12. Desktop OAuth, Email Link And Callback Transport

### 12.1 Unified external continuation

OAuth、reset、identity binding和future billing return复用一个native continuation shell，但各purpose有独立audience/TTL/state machine。

1. Rust creates `ExternalAttempt` with state、nonce、PKCE verifier/challenge、purpose、provider、device、authority origin、target platform和expiry。
2. Rust asks authority to begin a Desktop flow and opens the returned authorize destination directly in the system browser；URL不进入React。
3. Authority retains provider cookie/pending domain internally and never writes token fragment for Desktop audience。
4. Browser completion reaches an authority-controlled HTTPS landing or exact loopback/app link and carries only opaque `ticket + state`。
5. Rust validates active attempt、state、audience、origin、expiry、single-instance ownership，then exchanges ticket over fixed-origin HTTPS with PKCE verifier。
6. Authority consumes a server-side hashed single-use ticket；MFA/pending account completion must precede final session ticket。
7. Broker publishes a safe transition/event, then performs authoritative read；event arrival alone is not terminal truth。

### 12.2 Live, background and app-not-running behavior

- Live app优先使用ephemeral loopback bound to loopback-only address and exact random port/path，with short lifetime and one owner。
- App background/closed recovery uses a registered app link/custom URI only after platform registration, second-instance forwarding and hijack/replay tests pass。
- Reset email contains an authority HTTPS URL. Raw reset token is consumed on authority landing and never embedded in `doge://` or renderer；the app receives only a Desktop reset ticket。
- Callback arriving after explicit cancel does not steal focus or authenticate stale UI；it is rejected/reconciled against current attempt。
- App launch from callback must not delay or replace normal Local Mode startup；Account completion resumes lazily after local shell is usable。
- If a provider/platform transport is unverified, that provider action is hidden/disabled while email/password and Local Mode remain available。

PKCE verifier、OAuth nonce和unfinished authorization secret不得写入SQLite或vault，因此 **process termination invalidates an unfinished OAuth attempt in v1**。An app link received after process exit may reopen Account Center and present a safe `登录请求已失效，请重新开始` recovery state, but it may not exchange the old ticket or claim seamless OAuth completion。Mock must cover this restart-expiry behavior rather than simulate cross-process secret recovery。A future resumable cross-process authorization requires a separately reviewed, OS-vault-bound flow-secret contract and semantic minor/major review。

Password reset is different：the authority HTTPS landing consumes the email token and may mint a fresh App-bound reset ticket after the app starts。That ticket still remains Rust-memory-only and short-lived；if the app cannot receive and exchange it within the live attempt, it expires and the user requests a new link。

### 12.3 Human verification

Mock never loads real Turnstile SDK. Real implementation chooses one reviewed transport：

- authority system-browser challenge that returns a one-use Desktop proof handle（preferred）；or
- a narrowly sandboxed, CSP-pinned challenge component whose proof is immediately consumed by Rust and never persisted/traced。

If server requires Turnstile and neither transport has platform/security evidence, affected register/login/code-send capability is unavailable；doge must not silently bypass the policy。

## 13. Data, Vault And Retention Contract

### 13.1 SQLite v1 logical schema

Account storage is independent from Local Core stores and multi-account-ready from first migration。No table contains credential, raw path/config/diff or authority response body。

| Entity | Key fields / purpose |
|---|---|
| `account_links` | opaque `account_link_id`、authority origin id、masked presentation、status、account epoch、created/last-seen timestamps |
| `devices` | opaque local `device_id`、platform class、created timestamp；future remote registration ref optional |
| `session_generations` | account/device/generation、vault alias ref、status、authority revision、timestamps |
| `operation_ledger` | operation id、class、request fingerprint、terminal/authority scope、reconcile deadline；no payload |
| `account_cache` | slice kind、safe encoded view、source/fetch/expiry time、account epoch |
| `external_flows` | purpose、opaque handle hash/ref、state class、expiry/status；no ticket/token/URL |
| `config_tasks` | account/device/recipe/version、plan/result state、safe summary、unread/ack/dismiss、receipt ref |
| `config_file_receipts` | transaction/file slot、fingerprint class、outcome、checkpoint；no path/content |
| `schema_meta` | schema version、migration/recovery state |

At most one active account is exposed in first trial, but uniqueness is `(authorityOriginId, accountLinkId, deviceId)` rather than a global singleton. Account switch increments epoch and fences all old callbacks/reads/plans。

### 13.2 Vault alias schema

Logical alias：`account-v1 / authority-origin / account-link / device / purpose / generation`。Purposes are closed：`refresh-session` and `selected-api-key:<recipe-purpose>`。Alias contains no email/token/key material；secret value is opaque bytes. The literal OS-specific service/account naming requires platform review but must round-trip this logical identity。

### 13.3 Retention

- Active session/key vault generation：until explicit revoke/remove, account unlink or bounded orphan cleanup。
- Expired external flow metadata：delete after expiry + short replay-audit window；ticket/token never stored locally。
- Safe account cache：bounded TTL and cleared on unlink/account epoch replacement；stale may be shown only with timestamp。
- Operation ledger：bounded recovery/idempotency window, then aggregate/remove；no raw payload。
- Config receipt/recovery：retain while rollback/recovery is possible and according to future user-visible history policy；protected recovery artifact remains until terminal resolution or explicit reviewed cleanup。
- Hard dismissal：scoped to account/device/recipe/version and retained until recipe upgrade、account removal or product retention expiry。
- Support bundle：generated only on explicit user action, local-only by default, never auto-uploaded。

Account data corruption/newer schema is quarantined as an Account-only failure. Local Core startup continues；no destructive auto-reset。Recovery/export/deletion UX is later scope but schema ownership is reserved now。

## 14. Codex Recipe And Configuration Transaction

### 14.1 v1 outcome and compatibility boundary

`doge.account.codex-token-service/1` creates or updates a **doge-managed Codex provider profile** for future doge-launched Codex sessions. It does not overwrite a healthy manual/default `$CODEX_HOME`, does not retroactively switch existing threads, and does not change a thread's persisted `providerProfileId`。

The recipe must honor current provider-scoped runtime contract：new/forked Codex sessions bind the selected provider profile；existing session binding remains stable。Healthy manual configuration defaults to preserve；collision or ambiguous ownership enters review，不覆盖。

### 14.2 Credential handling decision

- Managed token2api API key remains only inOS vault。
- Recipe must not write key into `auth.json`, doge config JSON, `config.toml`, environment file, shell profile or SQLite。
- Rust resolves the vault secret at Codex process launch and injects it process-scoped as the exact locally compiled credential environment key required by the recipe。It must not log command environment or return it to renderer。
- Nonsecret provider config declares fixed model-provider id、trusted token-service base URL reference、supported `wire_api` and other allowlisted fields。The base URL derives from signed/build-channel authority config and local recipe, not renderer input or arbitrary remote payload。
- Current provider codepaths that persist `authJson` are not reusable for this managed account recipe without refactor；their existence is not a waiver of the OS-vault invariant。

If the target Codex runtime cannot consume a vault-injected process credential without persistent plaintext on a platform/version, the recipe capability is disabled there。External shell use outside doge-managed runtime is not claimed by v1。

### 14.3 Immutable recipe definition

Recipe v1 freezes these logical properties：

```text
recipeId              = doge.account.codex-token-service
recipeVersion         = 1
targetEngine          = codex
targetHostClass       = local-desktop
credentialPurpose     = codex-token-service
writeSlots            = doge-managed-provider-registry, codex-provider-config
forbiddenWriteSlots   = codex-auth-json, shell-profile, arbitrary-user-path
runtimeCredentialMode = child-process-env-from-vault
reloadRequirement     = newSessions
```

Exact filesystem paths are derived in Rust from app path policy and Codex provider-home policy。They are never parameters from server/renderer and never appear in renderer DTO。Implementation must freeze and test the platform-specific canonical path mapping before enabling a platform。

### 14.4 Plan contract

`ConfigPlanInternalV1` binds：

```text
accountLinkId + accountEpoch + sessionGeneration
deviceId + authorityOriginId + targetHostId
recipeId + recipeVersion + recipeCatalogDigest
managedKeyGeneration
logical file slots + canonical identity + no-follow evidence + fingerprints
semantic change set + planDigest + createdAt + expiresAt
```

Renderer receives only plan/file handles、friendly target labels、`willChange|unchanged|blocked` and safe semantic fields。`SafeValue` is a closed union：Absent、Bool、Number、Enum、allowlisted SafeText、Redacted。SafeText constructor is Rust-private and requires field allowlist、length/character policy and secret scan。Unknown value is Redacted/blocked, not stringified。

Plan generation is read-only。It may inspect local target after the user accepts the configuration offer, but it may not create key or write file. Managed-key provisioning is a separate preceding consent and operation；exact apply is a third consent。

### 14.5 Apply transaction

1. Revalidate account epoch、authority/target host、recipe/catalog/key generation、TTL and all file identities/fingerprints。
2. Open targets with no-follow/canonical identity policy；reject symlink/junction/reparse/hardlink or unsupported permission cases per platform policy。
3. Write durable journal intent with planned file slots and fingerprint classes, no raw content/path。
4. Create protected backups/stages on the same filesystem where required；owner-only permissions and fsync policy apply。
5. Apply each file in deterministic order using platform-safe replace；after each replace, durably checkpoint outcome。
6. Verify parsed semantic state and managed provider binding。Never equate bytes-written with usable。
7. On failure, rollback completed files in reverse order；record per-file `rolledBack|rollbackFailed|skippedPrecondition|failedBeforeWrite`。
8. Commit a terminal receipt or durable recovery checkpoint before publishing result/event。
9. Apply runtime behavior：existing Codex threads are untouched；new sessions can select/use the managed profile。Credential injection starts only at new process launch。
10. Verify availability with a bounded, nonsecret recipe verifier。If credential/provider usability cannot be proved, result is `applied + verification pending/failed`, not `Codex connected` success。

Files outcome and reload outcome remain separate：reload failure never rewrites applied files as rolled back。`reloadRequirement="newSessions"` for recipe v1；no global app restart or forced restart of existing threads。

### 14.6 Collision and migration behavior

- Existing healthy manual/default Codex config：preserve by default and create a separate managed profile only after explicit choice。
- Existing doge-managed profile with matching recipe marker/version：plan semantic update/noop。
- Same profile id without valid doge ownership marker：conflict; choose a new deterministic collision-safe id or require review, never overwrite。
- Malformed config、unknown fields that cannot be preserved、unsupported `wire_api` or unsafe path：blocked plan，no mutation。
- Recipe version upgrade creates a new plan and ignores old hard-dismiss key；no automatic migration/write。

## 15. Error, Privacy, Observability And Support

### 15.1 Closed error model

Minimum `AccountFailureCodeV1` families：

```text
cancelled, offline, serviceUnavailable, rateLimited,
capabilityUnavailable, protocolMismatch, validationRejected,
credentialsRejected, accountInactive, policyBlocked,
verificationExpired, mfaRequired, mfaExpired,
oauthDenied, oauthStateMismatch, externalIntentExpired,
sessionExpired, sessionRevoked, remoteOutcomeUnknown,
vaultLocked, vaultUnavailable, vaultInconsistent,
staleAccountEpoch, stalePlan, concurrentEdit,
permissionDenied, unsafeTarget, rollbackIncomplete,
managedKeyUnavailable, localPersistenceFailed, unknownSafeFailure
```

The renderer error DTO is exactly bounded by these closed dimensions：

```ts
type AccountFailureStageV1 =
  | "capabilities"
  | "challenge"
  | "register"
  | "verifyEmail"
  | "login"
  | "mfa"
  | "oauth"
  | "recover"
  | "reset"
  | "refresh"
  | "logout"
  | "profile"
  | "security"
  | "usage"
  | "subscription"
  | "managedKey"
  | "configurationPlan"
  | "configurationApply"
  | "reload"
  | "vault"
  | "persistence";

type AccountFailureActionV1 =
  | "none"
  | "retry"
  | "editInput"
  | "requestNewCode"
  | "requestNewLink"
  | "loginAgain"
  | "openBrowser"
  | "unlockVault"
  | "replan"
  | "reviewFiles"
  | "reconcile"
  | "useLocalMode"
  | "contactSupport";

type AccountFailureV1 = {
  code: AccountFailureCodeV1;
  stage: AccountFailureStageV1;
  retryable: boolean;
  retryAfterMs: number | null;
  action: AccountFailureActionV1;
  field: "email" | "password" | "code" | "invitation" | "promo" | null;
};
```

No arbitrary `message` or `messageKey` crosses IPC。Frontend owns an exhaustive `(code, stage, action, field) -> i18n key` mapping, so Mock and Real cannot inject divergent copy。If a bounded retry hint is absent, `retryAfterMs=null`。

Mapping priority：local precondition/version/capability → transport class → HTTP status → allowlisted authority reason → schema validation → unknown safe failure。Raw authority message is never copy, log key or business branch。Current legacy 429 without `Retry-After` maps to `retryAfterMs=null`；doge must not invent a countdown。

### 15.2 Secret and PII placement

| Data | Allowed location | Forbidden |
|---|---|---|
| refresh/API key | OS vault only | files、SQLite、renderer、fixtures、logs |
| access/password/code/TOTP/ticket/PKCE/proof | shortest-lived Rust/form memory only | durable stores、trace、support |
| account email/profile presentation | purpose-scoped Account UI memory only，prefer masked/minimal | global store、analytics dimension、generic diagnostics |
| raw config/old/new/diff/path | Rust transaction memory only | IPC、renderer、logs、support |
| safe account/cache/receipt metadata | independent Account SQLite | Local Core stores、cross-account reuse |

### 15.3 Closed observability

Allowed metric/event ids are low-cardinality and credential-free：

- `account_operation_total{class,stage,outcome}`
- `account_operation_duration_ms{class,stage}`
- `account_contract_mismatch_total{layer,kind}`
- `account_callback_rejected_total{purpose,reason_class}`
- `account_refresh_singleflight_violation_total`
- `account_stale_generation_commit_total`（health objective: zero）
- `account_config_terminal_total{recipe,outcome}`
- `account_config_recovery_open_total{recipe,stage}`（health objective after recovery: zero）
- `account_mock_real_call_total{transport}`（Mock review artifact objective: zero real calls）
- `account_local_mode_regression_total{gate}`（objective: zero）

Forbidden labels：account/user/device/session/operation id、email、URL、path/fingerprint、provider raw error、model prompt、token/key prefix/length/hash。Account steady state uses event/user action and bounded refresh policy；no second-level polling or append-only event arrays on AppShell root。

Strict support bundle includes only contract versions、feature/capability booleans、closed state/error/outcome counts、stage durations、platform evidence class and recovery presence。It excludes generic client store、headers/body、IDs/PII、raw path/config/diff、backup/journal payload and secrets。Export is explicit and local-only by default。

## 16. Feature Flags, Capability Evaluation And Kill Switches

### 16.1 Doge flags

| Flag | Pre-integration default | Scope | Off behavior |
|---|---:|---|---|
| `accountConvenience` | off | product entry/root | no entry/slot/listener/network；Local baseline equivalent |
| `accountBrokerCore` | off | construct Rust account module | no DB/vault/authority startup access |
| `accountGatewayReal` | off | compose Real frontend adapter | Mock lab/test only；release never fallbacks |
| `accountDesktopAuth` | off | register/login/MFA/OAuth/reset | auth unavailable，Local Mode normal |
| `accountProfileSecurity` | off | profile/password/TOTP/binding/revoke | hidden by capability |
| `accountUsagePull` | off | explicit usage read | no fetch/no notices |
| `accountManagedKey` | off | existing API Key list/selection/handoff lifecycle | no list/handoff/vault binding |
| `accountConfigOnboarding` | off | offer/plan/apply surfaces | no config read/write |
| `accountRecipeCodexV1` | off | Codex recipe | hidden/unavailable |
| `accountBilling` | off | later billing | hidden |
| `accountDeviceSessions` | off | later device/session | hidden |
| `accountMultiAccount` | off | later switcher | one active account only |
| `accountRemote` | off | later remote/daemon/web | no remote host operations |

`accountFrontendMock`/Account Lab is compile-time DEV/test-only and must be absent from normal production reachable graph。Per-platform flags separately guard vault、callback、safe replace、runtime injection and Codex recipe evidence。

### 16.2 Effective capability

```text
effective = productFlag
         ∩ compiledLocalSupport
         ∩ platformEvidence
         ∩ serverContractMajorCompatibility
         ∩ serverGuaranteeBit
         ∩ serverEnabledSetting
         ∩ currentVault/SessionPrecondition
```

`unknown` never becomes enabled。Capability off removes or disables only its Account action；Local Mode is not part of this formula。

### 16.3 Rollout and kill switch order

1. Ship code with all Real flags off。
2. Enable contract/fake/internal tests。
3. Enable individual server guarantee in test deployment only after server tests pass。
4. Enable Doge Real adapter for internal cohort after G4 conformance。
5. Enable target-platform auth, usage, managed key and Codex recipe independently。
6. On incident, disable the narrowest capability first；if contract/session integrity is uncertain, disable `accountGatewayReal/accountConvenience`。Do not delete vault/metadata/config during kill switch。

## 17. Corrected Phase Graph And Artifact Truth

```text
G0  Formal design freeze (this document)
  -> G1 Executable contract/schema/scenario freeze
       ├─ Lane F: F0 port/lab -> F1 auth -> F2 recovery/MFA/OAuth
       │                    -> F3 account/usage -> F4 Codex config -> F5 UI hardening
       ├─ Lane D: D0 harness -> D1 broker -> D2 vault/session -> D3 callback
       │                    -> D4 wire adapter -> D5 account/config operations -> D7 IPC candidate
       └─ Lane T: T0 current conformance/descriptor
                    -> T1 session durability
                    -> T2 Desktop completion
                    -> T3 managed key
                    -> T4 stable errors/version

Lane F F0..F5 -> G2 UI Review Freeze -> M0 UI Mock Review Package
Lane D/T ready -> G3 Backend Readiness
G2 + G3 -> G4 Cross-lane Contract Conformance
           -> G5 Late Integration / composition-root Mock -> Real swap
              -> I0 integration + real E2E + security/platform/package checks
                 -> G6 Integrated Trial Acceptance
                    -> A0 Fully Integrated Local Trial Package
                       -> later commercial/device/multi-account/remote/recipe cuts
```

### 17.1 Gates

| Gate | Exit evidence |
|---|---|
| `G0` Design freeze | decisions/invariants/layers/ownership/gaps/release truth internally consistent；type/security review backlog identified |
| `G1` Executable contract freeze | schemas、closed enums、scenario manifest、Good/Base/Bad fixtures、version rules and forbidden-field corpus accepted by all lane owners |
| `G2` UI Review freeze | full Mock scenarios、user multi-round UX review、a11y/i18n/long-text/reduced-motion；zero real network/native calls |
| `G3` Backend readiness | Lane D against stateful fake/fault injection and Lane T server contract suites independently green；Local Mode harness green |
| `G4` Conformance | Mock、Real-over-scenario、Broker fake/real authority and token2api normalized traces semantically match；unknown/negative cases fail closed |
| `G5` Late integration | composition-root-only swap；no component/domain intent rewrite；Real enabled only internal/target deployment |
| `G6` Integrated trial acceptance | real auth/profile/session/quota/Codex E2E、Local Mode regression、target-platform install/launch/callback/vault/config smoke、rollback drill and user trial acceptance |

### 17.2 Two artifacts that must not be confused

| Artifact | What it proves | What it explicitly does **not** prove |
|---|---|---|
| **M0 — Account UI Mock Review Package** | Locally runnable/packageable UI review build；deterministic scenario engine drives full journey；visual/interaction/a11y/copy accepted；network/native guard proves zero real calls | token2api readiness、vault/session security、callback、filesystem mutation、Real adapter、E2E or installable trial completion |
| **A0 — Fully Integrated Local Trial Package** | Real adapter and selected token2api test/prod-like deployment conform；target platform package installs/launches；complete account access、pull-only usage and Codex recipe pass real E2E；Local Mode remains complete | all-platform GA、billing、device/session UI、multi-account、remote/web or additional recipes |

Status language is normative：M0 reports `UI accepted against Mock scenarios`；backend may report `Lane D/T contract-ready`；G4 may report `Real adapter conformant`；only A0 may report `local packaged trial complete`。

M0 visual acceptance additionally freezes an attention-first progressive-disclosure contract：no marketing-style Account card wall；no persistent instructional paragraphs on the primary path；secondary guidance lives behind contextual keyboard-accessible help affordances；Profile/Password/file diff are revealed only after explicit intent；configuration Dialog is opaque and uses host theme tokens；shipping UI and default runtime Dock icon resolve the same canonical Doge product asset。Tooltip geometry is content-adaptive with viewport collision handling rather than fixed width/height。

### 17.3 First integrated trial required closure

A0 requires `T-GAP-01/02/03/04/05/08/09/11`，plus `T-GAP-06/07` for Codex。`T-GAP-12` is required if the selected deployment requires human verification。Enabled OAuth providers must have Desktop conformance；unsupported providers are hidden, but the deployment must retain at least one complete account access path。Device/session `T-GAP-10` and subscription detail `T-GAP-13` do not block A0。

## 18. Migration, Rollback And Recovery

### 18.1 Doge migrations

- Account DB starts as independent schema v1；migration never runs as mandatory Local Core startup milestone。
- Before each schema migration, create a bounded metadata backup；newer/corrupt schema quarantines Account module without rewriting user data。
- Vault and SQLite use generation saga, not assumed cross-store ACID；startup reconciles staged/orphan/missing refs。
- Existing account-less users require no LocalPrincipal migration。
- Existing manual/provider configurations are discovered read-only and classified；never auto-adopted or overwritten。
- Existing Codex provider records containing plaintext `authJson` are outside this recipe's credential authority。A future migration must be explicit, consented and security-reviewed；v1 must not copy them into account vault or claim they are managed keys。

### 18.2 token2api migrations

- Durable revocation generation：expand schema → backfill/default → dual read/verify → enforce → remove legacy assumption；DB reload evidence before enablement。
- Refresh family：deploy atomic script/store and operation replay side-by-side → migrate active families or force explicit reauth per policy → enable guarantee → retire legacy rotation。
- API key：add hash/metadata fields → dual read → one-time create and metadata-only API → backfill/rotate policy → stop plaintext reads → bounded rollback window → drop plaintext only after security gate。
- Existing Web consumers remain compatible until their versioned migration；Desktop guarantee descriptor stays off until new semantics are actually active。

### 18.3 Rollback

- Feature rollback hides/disables Account entry/adapter but does not delete vault、metadata or user configuration。
- Server capability rollback removes guarantee and Doge fails affected action closed；no fallback to legacy insecure path。
- Config rollback is a receipt-driven user/recovery action, not feature-flag side effect。`rollbackIncomplete` retains protected recovery artifact and attention state。
- Runtime injection/reload hook can be disabled independently；already committed file result remains accurate and next sessions report credential unavailable rather than fake rollback。
- Package rollback to a pre-account build must not damage Local Mode。Account metadata can remain unused；managed Codex profile must not become global default without doge runtime binding。
- Account unlink/delete later must separate remote account action、managed key revoke、local metadata cleanup、config cleanup and LocalPrincipal preservation；one action cannot implicitly authorize all。

## 19. Platform Matrix

Every capability starts `unverified/off` per platform。CI on an OS is not manual evidence；target-platform A0 requires all `Required for A0` rows verified on that platform。Other platforms remain disabled without blocking a single-platform trial。

| Capability | macOS | Windows | Linux | Required evidence / gate |
|---|---|---|---|---|
| OS vault stage/activate/delete/lock | unverified | unverified | unverified | real backend behavior、lock/unavailable、restart、no plaintext；A0 required |
| System browser launch | unverified | unverified | unverified | foreground/background/failure/focus；A0 required |
| Loopback callback | unverified | unverified | unverified | firewall、random port/path、replay、cancel、second instance；A0 required |
| App link/deep link | unverified | unverified | unverified | app running/background/not running、hijack/audience/expiry；required if selected flow uses it |
| Turnstile/human verification | unverified | unverified | unverified | selected transport/CSP/browser return；required only if deployment enables policy |
| Account SQLite quarantine/recovery | unverified | unverified | unverified | migration/newer/corrupt/quick-check isolation；A0 required |
| Codex canonical target resolution | unverified | unverified | unverified | env override、provider home、collision、no arbitrary path；A0 required |
| no-follow / symlink / reparse / hardlink policy | unverified | unverified | unverified | platform filesystem attack matrix；A0 required |
| same-filesystem stage/replace/fsync/permissions | unverified | unverified | unverified | crash/Nth-file/rollback evidence；A0 required |
| child-process credential injection | unverified | unverified | unverified | key absent from file/argv/log/process diagnostics; child receives expected env；A0 required |
| Codex new-session binding/reload | unverified | unverified | unverified | existing thread unchanged、new session correct profile、failure recovery；A0 required |
| package install/launch/update rollback | unverified | unverified | unverified | clean install、upgrade、rollback、signed/package channel；A0 required |

## 20. Test And Acceptance Matrix

| Layer | Required tests/evidence |
|---|---|
| Semantic contract | schema Good/Base/Bad、version/additive/unknown/breaking cases、scenario manifest completeness |
| Frontend state | pure legal/illegal transitions、generation fences、close/ack/dismiss、pull-only usage、Local Mode always available |
| Mock runtime | deterministic clock/seed、stateful flows、latency/offline/replay/lost response、reset cleanup、missing rule failure |
| Frontend boundary | components import only Gateway；no Tauri/HTTP/Mock mode branch；production bundle excludes Lab/Mock |
| Authority routes | route→handler/service/schema trace、disabled policy、stable reasons、idempotency、malformed/legacy envelopes |
| Session/security | durable pair、MFA-before-ticket、atomic refresh concurrency/replay、revoke DB reload、logout unconfirmed |
| Callback/reset | state/nonce/PKCE/audience/device mismatch、TTL/replay/cancel/late return、app lifecycle |
| Vault/data | every crash point、generation mismatch、locked/unavailable、orphan cleanup、SQLite corruption/newer schema |
| Managed key | one-time delivery、response lost/replay、vault failure/orphan revoke、metadata-only recursive scan、ACL omission |
| Codex plan/apply | no/manual/conflict/already-configured、malformed、unsafe target、concurrent edit、expired plan、Nth failure、rollback/reload、secret-negative scan |
| IPC/privacy | forbidden field/value recursive scan over request traces、responses、errors、logs、metrics、fixtures、support bundle |
| Cross-lane conformance | same semantic scenarios through Mock、Real-over-scenario、Broker fake/real authority；normalized traces match |
| Local Mode regression | flags off、signed out、offline/hang/5xx、vault fail、DB corrupt、session revoked、quota exhausted；zero account calls in local journeys |
| Integration/E2E | real register/verify/login/MFA/OAuth/reset/restore/logout/profile/security、pull usage、Codex provision/plan/apply/restart |
| UX/a11y/i18n | keyboard/focus/screen reader、200% text、30–50% expansion、reduced motion、light/dark、narrow layout |
| Package | target platform clean install、launch、callback registration、upgrade/rollback、feature kill-switch smoke |

Health invariants have hard assertions：one refresh network rotation per wave；zero stale generation commit；every consented apply has terminal receipt or recovery checkpoint；zero unrecovered partial mutation at release gate；Mock review has zero real calls。

## 21. Ownership And Dependency DAG

### 21.1 Future implementation ownership

| Surface | Single write owner | Coordination rule |
|---|---|---|
| Canonical semantic schema/scenario/forbidden corpus | designated contract owner | other lanes consume; no parallel edits |
| `src/features/account/**` product port/components/state/mock/lab | Frontend Experience owner | no Rust/token2api DTO imports |
| Settings entry/shared frontend composition | Frontend integration owner | only after F slice ready；contextual entry shares same route |
| `src-tauri/src/account/**` broker/vault/repository/authority/config | Doge Native Broker owner with bounded storage/platform review | no token2api business duplication |
| shared Tauri command registry / frontend Tauri facade | Integration owner | D7/G5 only；avoid concurrent shared-file writes |
| Codex provider/runtime shared modules | Codex recipe/config owner | preserve provider-scoped session binding；security review before credential changes |
| token2api routes/handlers/services/schema | token2api API owner | current compatibility and upstream approval required |
| package/signing/channel flags | Release owner | only after G6 evidence candidates |

All workers must preserve unrelated changes；shared contract/composition/command-registry/Codex runtime files are serialized ownership zones。

### 21.2 Dependency DAG

```text
Contract owner: G1 semantic/schema/fixture pack
  ├─ Frontend owner: AccountGateway + Mock + UI slices ──────> G2
  ├─ Doge owner: Broker core
  │    ├─ data owner: SQLite + vault saga
  │    ├─ platform owner: browser/callback
  │    └─ config owner: Codex recipe/transaction
  │         └─ D7 safe IPC candidate ────────────────────────> G3
  └─ token2api owner: current conformance + T1..T4 gaps ────> G3

G2 + G3
  -> contract owner runs G4 cross-lane conformance
    -> integration owner performs G5 composition swap
      -> security + platform + release owners verify I0/G6
        -> A0 Integrated Local Trial Package
```

No dependency from Lane F UI refinement to Lane D/T implementation beyond frozen contract；no dependency from backend availability to Mock UI review。Only G4/G5 join the lanes。

## 22. Risks And Required Reviews

### 22.1 Blocking type review before G1

- Final cross-language optionality/nullability、timestamp format、integer precision and opaque handle encoding。
- Closed enum unknown handling and exact exhaustive mapping between semantic、Gateway、IPC、Broker and Authority layers。
- `accountEpoch`/generation monotonicity and process-restart semantics。
- Success/error envelope contract identity placement and runtime validation。
- Purpose-scoped PII/TOTP presentation types and proof that generic stores/snapshots cannot accept them。
- Scenario manifest naming normalization；research drafts use multiple scenario id styles and must converge without semantic loss。

### 22.2 Blocking security/privacy review before affected implementation

- OS vault crate/backend selection and macOS/Windows/Linux lock/unavailable semantics。
- OAuth/reset/human-verification threat model：custom URI hijack、loopback DNS rebinding/firewall、second instance、ticket audience/replay、PKCE/state/nonce lifecycle。
- Fixed authority origin、TLS/HSTS/proxy/trusted redirect and build-channel configuration。
- Managed-key hash/idempotency/one-time replay、orphan cleanup and migration rollback。
- Codex child-process credential injection：environment visibility、crash dump/process inspection、subprocess inheritance and secret clearing；prove no `auth.json`/argv/log persistence。
- Config canonical path/no-follow/reparse/hardlink、backup permissions、fsync/replace/crash recovery and protected artifact retention。
- TOTP enrollment QR/manual secret presentation and screenshot/diagnostic exclusion。
- Strict support bundle and metric/log cardinality/privacy review。
- Payment boundary before billing release；payment credentials remain provider-hosted only。

### 22.3 Other delivery risks

| Risk | Mitigation / gate |
|---|---|
| Mock semantics become richer than Real | Canonical scenario owner + Real-over-scenario + fake/real normalized trace at G4 |
| Current token2api route drift | T0 route inventory tests；target gaps explicitly separate |
| Account module enters App hot/startup path | lazy construction、flag-off zero-call harness、no root polling/store arrays |
| Existing Codex provider semantics regress | honor providerProfileId/session binding；existing threads unchanged；Codex contract tests |
| Config success reported before usable | recipe verifier + separate file/reload/verification outcomes + durable receipt |
| Single-platform evidence generalized | evidence states remain per platform；unverified flags off |
| token2api upstream fork changes become hard to merge | minimal service reuse、versioned Desktop adapter、explicit approval/upstream impact review |
| Scope is silently reduced to Foundation | capability map and later extension points remain normative；deferred means implementation-only |

## 23. Design Exit Verdict

This document freezes the v1 architecture and contract ownership needed to start parallel implementation planning。It deliberately does **not** claim type/security review completion、executable schema freeze、lane readiness、Mock UI acceptance、Real conformance or local packaged trial completion。

Next authorized artifacts may derive implementation tasks and executable contract files from this design, but must retain：

- full Local Mode invariant；
- three distinct contract authorities and three delivery lanes；
- current-vs-gap honesty；
- OS-vault-only persistent credential boundary；
- Codex managed profile with vault-to-process credential injection and no `auth.json` secret；
- G2/G3/G4 before Late Integration；
- M0 Mock Review and A0 Fully Integrated Trial as different artifacts/verdicts。
