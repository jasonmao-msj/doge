# token2api Account Integration — v1 Type Contract Freeze Review

> 状态：`v1-freeze-approved-for-formal-design`。
>
> Project role：`type-contract-reviewer`；Execution profile：Fast。
>
> Scope：在 implementation 前，对 PRD、Product Experience Blueprint、App Account API Integration、Mock-first Frontend Architecture 与 Parallel Backend Delivery Plan 的 frontend port、safe IPC transport、Broker semantic contract、Authority Wire contract、state/error/event/version/scenario 进行 reconciliation。
>
> 本文是只读 research 后形成的 contract review。它不修改既有 research artifacts，不授权 production implementation，也不替代后续 `proposal.md`、`design.md`、`tasks.md` 或 executable schema/fixture。

## 1. Review Verdict

### 1.1 Single v1 freeze decision

**APPROVE AS RECONCILED**：正式 `design.md` / `tasks.md` MUST 采用本文 §§3–11 的 canonical v1 contract，不得从现有 research artifacts 中任选一套同名 contract。

该批准有两个不同含义：

1. **允许 formal design 固化 v1**：本文已对 naming、owner、boundary、operation/state/error/event/version/scenario 做出单一决定，不再保留平行候选。
2. **尚未允许 implementation 启动**：§12 的 blocking resolutions 必须进入 formal design 和 executable contract tasks；shared manifest/schema、runtime validators 与 conformance harness 尚未落盘，不能把本 review 误报为 executable freeze 已完成。

若 formal design 与本文冲突，以 formal design 显式引用并逐项关闭本文 finding 后的新决定为准；不得静默恢复被本文 supersede 的 research draft。

### 1.2 Frozen product invariants

以下已由用户确认，任何 contract layer 都无权重新解释：

- Local Mode 不登录即可完整使用所有既有本地能力；Account failure、vault failure、quota/subscription/billing 或 token2api outage 不得成为 Local Core gate。
- Durable account session 仅允许 OS vault；v1 不存在 `sessionOnly` account mode，也不存在 plaintext/custom fallback vault。
- doge 是 token2api 的完整 Desktop account client，但不是第二个 identity/profile/session/quota/billing authority。
- 登录、managed-key provisioning、exact configuration apply 是三个独立 consent；authenticated terminal 不自动创建 key 或写 config。
- Settings → Account 是唯一固定、持久入口；contextual CTA 只能 deep-link 到同一 route/state/journey，不能建立第二套 account state。
- 首包 quota/usage 是 pull-only：只有用户主动打开或明确 refresh 才可读取；invalidation event 只能标 stale，不能触发 proactive fetch/notice。
- 首个 configuration recipe 是 Codex；登录成功最多展示 offer，不得自动读取目标配置内容，只有用户接受 plan 后才可读取并生成 changed-file projection。
- 首个本地试用是 bounded Real vertical：目标平台 Real adapter E2E、install/launch smoke 与 Local Mode regression 是 blocking；billing/device/multi-account/remote/更多 recipes 不进入首包 Gateway surface。
- Frontend Experience、Doge Native Broker、token2api Authority 只通过 frozen contracts 和 shared scenarios 协作；Mock/Real conformance 通过后才允许 Late integration。

## 2. Evidence And Supersession Rule

本 review 读取并对照：

- `proposal.md`
- `specs/token2api-account-convenience/spec.md`
- `.trellis/tasks/08-11-integrate-token2api-account-system/prd.md`
- `research/product-experience-blueprint.md`
- `research/app-account-api-integration.md`
- `research/mock-first-frontend-architecture.md`
- `research/parallel-backend-delivery-plan.md`
- `research/synthesis.md`
- `.trellis/spec/frontend/type-safety.md`
- `.trellis/spec/frontend/state-management.md`
- `.trellis/spec/backend/error-handling.md`
- `.trellis/spec/backend/database-guidelines.md`
- `.trellis/spec/guides/cross-layer-thinking-guide.md`

Research 文档仍是重要 evidence，但其中的候选 signature/name 不自动成为 canonical。发生冲突时使用以下顺序：

1. 用户确认的 product decision，以及 `proposal.md` / behavior spec 已冻结的 product outcome；
2. 本 review 的 type/contract reconciliation decision；
3. PRD invariant；
4. 最新、最完整且边界更窄的 typed draft；
5. 其他 research draft 只作为 alias/evidence，不作为可序列化 contract。

因此：

- `AccountGateway` / `AccountService` 的并列表述由 `AccountGatewayV1` 单一名称 supersede。
- `app-account-api-integration.md` 的 flat `AccountGatewayV1` method list 由 `mock-first-frontend-architecture.md` 的 composed ports supersede，但本文补齐其 missing operations/invariants。
- `AccountErrorViewV1`、`GatewayFailureV1`、`BrokerErrorCode` 不是三套 renderer error；它们分别归入 Gateway/Broker/Authority mapping，只有 Gateway failure 可进入 UI。
- `ACCOUNT_SCENARIO_V1` 是 Frontend Scenario Runtime 的 derived DSL schema，不是 shared scenario semantic source of truth。

## 3. Canonical Contract Stack, IDs And Owners

### 3.1 Layering decision

```text
React components / feature state
  -> AccountGatewayV1                         frontend behavior port
     -> RealAccountGatewayV1                  unknown -> validated mapping
        -> AccountTransportV1                 credential-free TS <-> Tauri IPC
           -> AccountBrokerV1                 Rust semantic/lifecycle authority
              -> Token2ApiAuthorityV1         private wire mapper/client
                 -> token2api HTTP/domain/persistence authority

MockAccountGatewayV1
  -> Frontend Scenario Runtime                derived from shared scenario manifest

FakeToken2ApiAuthorityV1
  -> Backend scenario projection              derived from the same manifest
```

The safe IPC layer is explicit because an unnamed `Safe broker projection -> Real adapter` seam would otherwise become a second, undocumented renderer contract.

### 3.2 Canonical identities

All serialized identities use a separate ID and SemVer string:

```ts
type ContractRefV1 = {
  id: string;
  version: "1.0.0";
};
```

| Contract | Canonical ID | v1 version | Single semantic owner | Boundary / consumers |
|---|---|---:|---|---|
| Frontend behavior port | `doge.account-gateway` | `1.0.0` | `frontend-engineer` | Components/hooks/state consume; Mock and Real adapters implement |
| Safe IPC transport | `doge.account-transport` | `1.0.0` | `backend-runtime-engineer` | Rust safe mapper produces; `RealAccountGatewayV1` runtime-validates/consumes |
| Broker semantic core | `doge.account-broker` | `1.0.0` | `backend-runtime-engineer` | Rust Broker implementations, vault/repository/platform adapters |
| Authority Wire | `token2api.account-authority` | `1.0.0` | token2api backend owner | token2api handlers/router produce; private Rust wire adapter consumes |
| Shared scenario semantics | `doge.account-scenario-manifest` | `1.0.0` | `quality-engineer` | All lanes consume through derived projections |
| Cross-layer fixture schema | `doge.account-contract-fixture` | `1.0.0` | `test-automation-engineer`, under `quality-engineer` acceptance ownership | Validators, Mock/Real/Broker/Authority conformance fixtures |
| Frontend runtime DSL | `doge.account-scenario-runtime` | `1.0.0` | `frontend-engineer` | Dev/test-only Scenario Runtime; derived, never production behavior authority |

Old strings such as `doge-account-broker/v1`, `token2api-account-authority/v1`, numeric `version: 1`, or the generic name `AccountService` are research aliases only. They MUST NOT appear in executable manifests, envelopes or capability descriptors.

### 3.3 Ownership and no-duplicate-authority rules

| Fact | Exactly one authority | Other layers may do | Other layers MUST NOT do |
|---|---|---|---|
| Identity/password/MFA/OAuth/profile/session revocation/quota/subscription/billing business truth | token2api | Map, cache with freshness, present, reconcile | Reimplement validation, eligibility or settlement |
| Desktop operation lifecycle, account epoch, vault activation, opaque flows, idempotency/reconcile | Doge Native Broker | Project a safe view | Let renderer or Authority Wire DTO become lifecycle owner |
| Local recipe, plan/apply/receipt/recovery/reload truth | Doge Native Broker/config owner | token2api supplies a managed credential when authorized | Send local path/diff/patch to token2api or let UI apply files |
| Screen/route/form/loading/stale presentation state | Frontend Account feature | Derive from Gateway results and authoritative reads | Persist backend raw state or make route a Broker field |
| Scenario IDs and expected cross-layer semantic outcomes | `quality-engineer` shared manifest | Lanes compile layer-specific fixtures/rules | Create a second story/test/backend catalog with different outcomes |
| UI copy/i18n mapping | Frontend/product design | Map closed Gateway failure tuple to copy | Accept raw Authority/Broker `message` or backend `messageKey` |

## 4. Canonical Frontend Port

### 4.1 Root and composed ports

The only frontend-facing name is `AccountGatewayV1`. `AccountService` is not an alias in code.

```ts
interface AccountGatewayV1 {
  readonly contract: {
    id: "doge.account-gateway";
    version: "1.0.0";
  };

  bootstrap(context: GatewayCallContextV1): Promise<GatewayResultV1<AccountBootstrapViewV1>>;
  reconcileIntent(
    input: { intent: GatewayIntentIdV1; expected: GatewayOperationNameV1 },
    context: GatewayReadContextV1,
  ): Promise<GatewayResultV1<GatewayReconciliationViewV1>>;
  subscribe(listener: (event: AccountGatewayEventV1) => void): () => void;

  readonly humanVerification: AccountHumanVerificationPortV1;
  readonly auth: AccountAuthPortV1;
  readonly profile: AccountProfilePortV1;
  readonly usage: AccountUsagePortV1;
  readonly configuration: AccountConfigurationPortV1;
}
```

The composed port draft in `mock-first-frontend-architecture.md` is the signature baseline, with these mandatory v1 corrections:

1. `GatewayCallContext.operationId` is renamed to `intent`; see §4.2.
2. Add `auth.readOAuthAttempt(attempt, context)` so OAuth wakeup events have an authoritative read path.
3. Add root `reconcileIntent(...)` so `outcomeUnknown` is executable without replaying a secret-bearing form mutation.
4. Keep `configuration.readCurrentTask(...)` as the authoritative read after configuration events.
5. Remove `displayUrl` from Gateway views; the Native Broker/platform adapter launches the system browser. Real Gateway only maps the opaque result, and renderer never consumes an Authority URL.
6. `GatewayResultV1` does not repeat the static Gateway contract on every success. Gateway identity is on the instance; transport identity is validated at the IPC envelope.

### 4.2 Identity separation

The current drafts use `operationId` for both UI logical action and Broker durable operation. That creates two apparent idempotency authorities. v1 freezes three distinct identities:

| Identity | Generated by | Stability | Purpose | May cross renderer boundary |
|---|---|---|---|---:|
| `GatewayIntentIdV1` | `AccountGatewayV1` consumer/helper | Stable across retry/reconcile of one user action | Deduplicate the frontend intent and bind it to one Broker operation | yes, opaque/nonsecret |
| `TransportRequestIdV1` | Real adapter/transport | One IPC attempt | Diagnostics and request/response correlation only | yes, transport-internal |
| `BrokerOperationIdV1` | Broker on first accepted intent | Durable when mutation/reconcile requires it | Canonical idempotency, ledger, Authority `Idempotency-Key` | no product-state exposure |

The Broker persists or retains `GatewayIntentId -> BrokerOperationId + operation kind + account epoch + request fingerprint` at the appropriate lifecycle. Reusing the same intent with a different operation/payload is `idempotencyConflict`; generating a new intent for an ambiguous retry is forbidden.

`AbortSignal` means “this caller stopped observing.” It does not cancel a remote mutation. Business cancellation remains an explicit typed operation such as `auth.cancelOAuth`.

### 4.3 Flat draft to canonical operation aliases

| Superseded flat draft | Canonical Gateway v1 operation |
|---|---|
| `getCapabilities()` + `getSession()` | `gateway.bootstrap` |
| `beginRegistration` | `auth.beginRegistration` |
| `resendRegistrationCode` | `auth.resendRegistrationCode` |
| `submitRegistrationCode` | `auth.submitRegistrationCode` |
| `signInWithPassword` | `auth.login` |
| `submitMfa` | `auth.verifyMfa` |
| `beginOAuth` | `auth.startOAuth` |
| `resumeExternalContinuation` | `auth.readOAuthAttempt` or `auth.inspectExternalIntent`, selected by opaque handle kind |
| `requestPasswordRecovery` | `auth.requestPasswordReset` |
| `submitNewPassword` | `auth.resetPassword` |
| `refreshAccount` | slice-specific authoritative reads: `bootstrap`, `profile.read`, `usage.read`, `configuration.readCurrentTask` |
| `updateProfile` | `profile.updateProfile` |
| `signOut` | `auth.logout({ scope: "thisDevice" | "allSessions" })` |
| `getUsageSummary/getQuota/getSubscriptions` | `usage.read` for the v1 aggregated presentation; future detailed pages require an additive negotiated module |

No generic `invoke(operation: string, payload: unknown)` is part of the Gateway.

## 5. Operation Mapping

### 5.1 Frontend intent -> Broker semantic operation -> Authority/local owner

| Canonical Gateway operation | Broker v1 operation/read | Authority route or local execution | Terminal/nonterminal rule |
|---|---|---|---|
| `gateway.bootstrap` | `capabilities` + `RestoreSession` + safe projection | `/settings/public`; refresh + `/auth/me` only when a persisted session can be restored | Partial slice failure cannot remove Local Mode; authenticated only after durable commit; no quota/usage read |
| `gateway.reconcileIntent` | `reconcile(intent binding -> operation_id)` | Authority reconcile/idempotent replay or local ledger read | Returns pending/known terminal/outcome unknown; never silently repeats mutation |
| `humanVerification.readRequirement` | capability read | Public settings / local platform support | Read-only |
| `humanVerification.submitProof` | `StoreHumanVerificationProof` | Broker volatile one-use handle; no Authority call yet | Proof never enters store/trace and is consumed by exact auth request |
| `auth.beginRegistration` | `BeginRegistration` | `/auth/send-verify-code` or `/auth/register`, driven by current capabilities | `verification` nonterminal or durable `authenticated` terminal |
| `auth.resendRegistrationCode` | `ResendRegistrationCode` | `/auth/send-verify-code` | Same flow/policy generation; cooldown is authoritative when present |
| `auth.submitRegistrationCode` | `CompleteRegistration` | `/auth/register` with Broker-held draft | Access-only response is failure, not authenticated |
| `auth.login` | `LoginPassword` | `/auth/login` | MFA is nonterminal; token pair continues to vault/session commit |
| `auth.verifyMfa` | `CompleteMfa` | `/auth/login/2fa` or Desktop authorization continuation | No active session before MFA + durable commit |
| `auth.startOAuth` | `BeginOAuth` | target Desktop authorization v1 gap | Broker opens system browser; Gateway gets opaque waiting handle, never URL |
| `auth.cancelOAuth` | `cancel(flow handle)` | Local flow cancellation + best-effort Authority expiry/revoke if supported | Late callback cannot activate stale UI/account epoch |
| `auth.readOAuthAttempt` | `observe(flow handle)` | Broker snapshot; may reconcile Desktop ticket | Authoritative read after wakeup; returns waiting/completion/authenticated/failure |
| `auth.completeOAuthAccount` | `CompleteOAuth` | target Desktop pending create/bind/adoption contract | Choice/MFA remains nonterminal until durable session commit |
| `auth.requestPasswordReset` | `RequestPasswordReset` | `/auth/forgot-password` | Anti-enumeration accepted outcome; no account-existence signal |
| `auth.inspectExternalIntent` | `observe(reset handle)` | target Desktop reset handoff/ticket exchange | Returns ready/expired/consumed/invalid; raw token never crosses Broker |
| `auth.resetPassword` | `CompletePasswordReset` | `/auth/reset-password` through Broker-held reset context | Success returns reset completed, then user signs in; no implicit login |
| `auth.logout` | `LogoutSession` | `/auth/logout` and/or `/auth/revoke-all-sessions` | Local clear is authoritative; remote result is `confirmed | unconfirmed`, never false confirmed |
| `profile.read` | `LoadProfile` | `/auth/me` + `/user/profile` safe projection | Read-only; source fields are allowlisted |
| `profile.updateProfile` | `UpdateProfile` | `PUT /user` | No optimistic authority; use response/readback |
| `profile.changePassword` | `ChangePassword` | `PUT /user/password` | Passwords transient; resulting session effect explicit |
| `profile.requestTotpEmailCode` | `RequestTotpEmailCode` | `POST /user/totp/send-code` | Cooldown/retry hint closed |
| `profile.beginTotpEnrollment` | `BeginTotpSetup` | `POST /user/totp/setup` | Purpose-scoped sensitive presentation exception only |
| `profile.confirmTotpEnrollment` | `EnableTotp` | `POST /user/totp/enable` | Setup token remains Broker-private |
| `profile.disableTotp` | `DisableTotp` | `POST /user/totp/disable` | Authority decides verification method/policy |
| `profile.startIdentityBinding` | `BeginIdentityBinding` | direct email binding or target Desktop OAuth binding | Opaque flow; no silent identity merge |
| `profile.unbindIdentity` | `UnbindIdentity` | current binding route | Last-method/policy rejection is Authority truth |
| `usage.read` | `LoadAccountValueSummary` | usage dashboard + platform quota + subscription summary | Only when usage surface is opened or user explicitly refreshes; per-slice freshness; stale keeps last-known, never becomes zero |
| `configuration.readOffer` | `ReadConfigurationOffer` | Capability/eligibility facts only; no target config content read | Read-only; unknown target does not expose mutation CTA; login may call this without granting plan/file access |
| `configuration.createPlan` | `CreateConfigurationPlan` | Codex v1 immutable local recipe/catalog + safe planner | Explicit plan acceptance authorizes target read but zero file mutation; plan bound to account/device/host/recipe/version/digest/TTL |
| `configuration.readFileDetail` | `ReadConfigurationFileDetail` | Local safe semantic projection | No raw path/content/patch/diff in IPC |
| `configuration.apply` | `ApplyConfigurationPlan` | Optional managed-key provisioning + local transaction/receipt/recovery | Exact-plan consent; terminal only after durable receipt/recovery checkpoint |
| `configuration.readCurrentTask` | `ReadConfigurationTask` | Local operation ledger/receipt | Authoritative read after event/restart |
| `configuration.acknowledgeResult` | `AcknowledgeConfigurationResult` | Local nonsecret state | Clears current result attention only; does not hard dismiss future recipe version |
| `configuration.hardDismiss` | `HardDismissConfigurationOffer` | Local persisted `(account, device, recipeId, recipeVersion)` | Separate from close/ack; forbidden while applying |

### 5.2 Broker v1 surface correction

`parallel-backend-delivery-plan.md` currently freezes Auth/Profile/AccountValue/ManagedKey but explicitly defers recipe/config apply contract. That cannot satisfy the already frozen Product/Gateway v1 surface. Formal design MUST add the seven Configuration operations above to `BrokerOperationV1` before frontend/backend lanes start.

Billing, device/session inventory, multi-account and remote/daemon/web remain in the comprehensive plan, but they are not emitted by Gateway `1.0.0`. Adding a new product-visible module requires a negotiated minor only when an old consumer can never receive the new closed variants; otherwise it is Gateway v2.

## 6. State Contract Mapping And Invariants

### 6.1 Orthogonal frontend state

`AccountFeatureStateV1` remains frontend-owned and orthogonal:

```ts
type AccountFeatureStateV1 = {
  module: "disabled" | "booting" | "ready" | "unavailable";
  connectivity: "online" | "offline" | "serviceUnavailable";
  vault: "ready" | "locked" | "unavailable" | "inconsistent";
  capabilities: "unknown" | AccountCapabilitiesViewV1;
  session: AccountSessionViewV1;
  route: AccountRouteV1;
  authFlow: AuthFlowStateV1;
  usage: RemoteResourceStateV1<QuotaUsageViewV1>;
  configuration: ConfigurationTaskStateV1;
  localMode: { status: "available" };
};
```

`route`, form draft, focus, expanded file and modal visibility never become Broker/Authority fields. Backend lifecycle is mapped into presentation state; it is not serialized as frontend reducer state.

### 6.2 Session invariant

```ts
type AccountSessionViewV1 =
  | { status: "signedOut" }
  | {
      status: "authenticated";
      accountEpoch: number;
      sessionCapability: "persistent";
      profileLabel: string;
      primaryEmailLabel: string | null;
    }
  | {
      status: "expired" | "revoked";
      previousProfileLabel: string | null;
    };
```

There is intentionally no `sessionOnly`, `authenticatedDegraded`, or `isLoggedIn: boolean` escape hatch. Vault locked/unavailable before commit returns a closed failure and Local Mode; vault becoming unavailable after a committed session is a separate vault/capability state and MUST NOT invent a second in-memory durable mode.

### 6.3 State mapping

| Product/Gateway state | Broker state | Authority fact | Required invariant |
|---|---|---|---|
| `module=booting` | capabilities/session restore reads in progress | public settings or refresh pending | Local Mode immediately available; App startup does not await it |
| `module=unavailable` | Broker unavailable/flag off | no call or failed availability | May coexist with `localMode=available` |
| `session=signedOut` | no active committed generation | no authenticated claim | Auth flows may still be active but are not sessions |
| `registrationVerification` | `VerificationWaiting(handle)` | email challenge exists | Password/draft remains Broker/Mock volatile; UI has opaque attempt only |
| `mfa` | `MfaRequired(handle)` | MFA challenge valid | Nonterminal, never a failure or authenticated terminal |
| `oauthWaiting` | `OAuthWaiting(handle)` | Desktop authorization pending | Event is wakeup; exact observe decides current state |
| `oauthCompletion` | `OAuthCompletionRequired(handle)` | create/bind/adoption/MFA pending | No silent merge and no session before completion |
| `resetRequested` | reset email request terminal + external wait | anti-enumeration accepted | Does not prove account existence |
| `resetPassword` | `ResetReady(handle)` | Desktop reset ticket consumed/exchanged | Renderer sees opaque intent only |
| `authSuccess` / authenticated session | `BrokerReceipt.succeeded + sessionEffect=activated` | durable token pair and `/auth/me` verified | Vault generation + metadata + account epoch committed before projection |
| `session=expired/revoked` | generation fenced/invalid | refresh/revoke authority result | Old async results cannot write current projection |
| usage `stale` | last-known safe snapshot + read failure | read unavailable/expired | Preserve value with freshness; never replace with zero |
| config `planReady` | immutable plan handle | local plan ledger | account epoch/recipe/digest/TTL bound |
| config `applying` | mutation accepted/in progress | optional managed-key + local transaction | Surface may close; task cannot be hard-dismissed |
| config `result/attention` | durable receipt or recovery checkpoint | local terminal truth | Event cannot be the terminal authority |

## 7. Error Reconciliation

### 7.1 Canonical Gateway failure

`GatewayFailureV1` is the only failure shape that enters renderer state. It MUST be a closed discriminated contract and MUST NOT carry `retryable: boolean` alongside an independently variable action, because combinations such as `retryable=false + action=retry` are illegal.

```ts
type GatewayFailureV1 = {
  code: GatewayFailureCodeV1;
  stage: GatewayFailureStageV1;
  recovery: GatewayRecoveryV1;
};

type GatewayRecoveryV1 =
  | { action: "none" }
  | { action: "retry"; afterMs: number | null }
  | { action: "editInput"; field: GatewayFieldV1 }
  | { action: "requestNewCode"; afterMs: number | null }
  | { action: "loginAgain" }
  | { action: "openBrowser" }
  | { action: "unlockVault" }
  | { action: "useLocalMode" }
  | { action: "requestNewLink" }
  | { action: "replan" }
  | { action: "reviewFiles" }
  | { action: "reconcile"; intent: GatewayIntentIdV1 }
  | { action: "contactSupport" };
```

Canonical Gateway failure codes are:

```text
cancelled
offline | serviceUnavailable | capabilityUnavailable | contractUnsupported
rateLimited | validationRejected | credentialsRejected | accountNotAllowed
humanVerificationRejected | humanVerificationExpired
verificationRejected | verificationExpired
mfaRejected | mfaExpired
oauthStateMismatch | oauthDenied
externalIntentInvalid | externalIntentExpired | externalIntentConsumed
sessionExpired | sessionRevoked
vaultLocked | vaultUnavailable | vaultInconsistent
staleAccountEpoch | stalePlan | concurrentEdit | permissionDenied | unsafeTarget
rollbackIncomplete | outcomeUnknown | protocolMismatch | unknownSafeFailure
```

`mfaRequired` is not an error code; it is `AuthNextViewV1.next="mfa"`. Raw `message`, `messageKey`, `detail`, `metadata`, HTTP body/status, URL and provider error description are forbidden. Frontend maps the closed `(code, stage, recovery/field)` tuple exhaustively to i18n copy.

### 7.2 Layer mapping

| Authority/transport fact | Broker error | Gateway failure |
|---|---|---|
| unsupported/missing contract guarantee | `capabilityUnavailable` or `contractVersionUnsupported` | `capabilityUnavailable` or `contractUnsupported` |
| unknown authority enum/reason/schema | `upstreamContractUnknown` | `protocolMismatch`, fail closed for that capability |
| invalid request/field-safe stable reason | `invalidInput` | `validationRejected + editInput(field)` when field is allowlisted |
| invalid credentials | `invalidCredentials` | `credentialsRejected + editInput(password)` |
| inactive/backend policy blocked | `accountInactive/policyBlocked` | `accountNotAllowed` |
| challenge invalid/expired | `challengeInvalid/challengeExpired` | stage-specific human-verification/verification/MFA failure |
| Desktop ticket/reset replay | `completionReplay` | `externalIntentConsumed` or OAuth stage `protocolMismatch` |
| refresh/session invalid | `authExpired/sessionRevoked/reauthenticationRequired` | `sessionExpired/sessionRevoked + loginAgain` |
| HTTP 429 + bounded hint | `rateLimited` | `rateLimited + retry(afterMs)`; `afterMs=null` when current server has no reliable hint |
| DNS/offline | `networkUnavailable` | `offline` |
| TLS/5xx/service outage | `serviceUnavailable` | `serviceUnavailable` |
| observer cancellation before send | `cancelled` | `cancelled` |
| mutation may have reached authority | `remoteOutcomeUnknown` | `outcomeUnknown + reconcile(intent)` |
| vault locked/unavailable/inconsistent | corresponding Broker error | corresponding Gateway failure + unlock/retry/Local Mode action |
| local metadata corrupt/persistence failure | `localMetadataCorrupt/localPersistenceFailed` | `protocolMismatch` or `unknownSafeFailure`; Account module only |
| stale plan/concurrent edit/unsafe target | typed config error | exact Gateway config failure; never generic success |
| rollback incomplete | `rollbackIncomplete` | `rollbackIncomplete + reviewFiles/contactSupport` |

Broker errors remain private and may include a privacy-safe correlation ID. Authority `message` is never the mapping key; only HTTP class plus an allowlisted stable `reason` may select a business code.

## 8. Event Contract

### 8.1 Events are wakeups, not truth

Canonical events contain only identity and invalidation hints:

```ts
type AccountGatewayEventV1 =
  | EventBaseV1 & { kind: "sessionChanged"; accountEpoch: number | null }
  | EventBaseV1 & { kind: "capabilitiesChanged" }
  | EventBaseV1 & { kind: "oauthAttemptChanged"; attempt: OAuthAttemptHandle }
  | EventBaseV1 & {
      kind: "externalIntentReady";
      intent: ExternalIntentHandle;
      purpose: "passwordReset";
    }
  | EventBaseV1 & { kind: "usageInvalidated"; accountEpoch: number }
  | EventBaseV1 & { kind: "configurationTaskChanged" };

type EventBaseV1 = {
  eventId: string;
  emittedAt: string;
};
```

Events MUST NOT carry an authoritative session/profile/config result snapshot. Each maps to one read:

| Event | Authoritative convergence read |
|---|---|
| `sessionChanged` | `gateway.bootstrap` |
| `capabilitiesChanged` | `gateway.bootstrap` |
| `oauthAttemptChanged` | `auth.readOAuthAttempt` |
| `externalIntentReady` | `auth.inspectExternalIntent` |
| `usageInvalidated` | Mark an already loaded slice stale; call `usage.read` only while the user has the usage surface open or explicitly refreshes |
| `configurationTaskChanged` | `configuration.readCurrentTask` |

An event may be duplicated, delayed, absent, or arrive at transport before the initiating Promise settles. Real adapter/Broker MUST bind/buffer/replay by exact intent/attempt and account epoch so a live event cannot overtake owner registration. UI terminal state MUST still converge without the event through the initiating result or an explicit read/reconcile.

## 9. Version And Compatibility Policy

### 9.1 Representation

- All executable schema/envelope/manifest identities use `{ id, version: "MAJOR.MINOR.PATCH" }`.
- Symbol suffix `V1` means supported major `1`; it is not the serialized version.
- `AccountGatewayV1.contract` identifies frontend behavior. `AccountTransportV1` response/event envelopes identify `doge.account-transport`. Authority capability descriptor identifies `token2api.account-authority`.
- Gateway results do not redundantly carry a contract identity. Fixtures carry a `contractRef` for the layer they validate.

### 9.2 Compatibility

| Change | Required version action | Behavior |
|---|---|---|
| Remove/rename field or operation; change required/optional; change terminal/idempotency/cancellation meaning | major | Unsupported major fails Account Convenience closed; Local Mode stays available |
| Add a variant to a closed union that an existing consumer may receive | major | Exhaustive consumer cannot safely ignore it |
| Add an optional operation/capability that old consumers never receive unless they advertise support | minor | Negotiated; unsupported item hidden/unavailable |
| Add optional wire field with defined default/absence semantics | minor | Decoder may ignore unknown field; mapper never leaks it to UI |
| Add stable Authority reason with unknown-reason fail-closed behavior | minor | Old Broker fails only affected operation closed |
| Same semantics bug fix, sanitized fixture correction or internal implementation change | patch | No observable semantic change |
| Change an existing scenario's expected outcome | new scenario ID or manifest major | Existing scenario ID semantics are immutable |
| Add a new scenario | manifest minor | Existing lane projections remain valid |

An Authority route existing is not a capability guarantee. Real adapter enables a capability only when the supported Authority major/minor and required guarantee bits are present.

## 10. Shared Scenario Manifest Freeze

### 10.1 Single owner and artifact roles

`quality-engineer` owns the one canonical semantic manifest. `test-automation-engineer` owns schema/validator implementation under that acceptance contract. Frontend, Broker and token2api owners own only derived projections:

```text
doge.account-scenario-manifest             canonical IDs + semantic expectations
  -> frontend Scenario Runtime rules       UI timing/control projection
  -> Broker fake-authority rules           lifecycle/idempotency projection
  -> token2api router/service fixtures      Authority wire/domain projection
  -> integration/E2E case selection        platform projection
```

Derived fixtures MUST reference `scenarioId`, manifest version and target `contractRef`. They MUST NOT redefine expected product terminal truth. A lane-specific case that has no UI is still added to the same manifest with `requiredLanes`, for example `authority`, `broker`, or `integration`.

### 10.2 Required manifest fields

Every scenario entry MUST contain:

```text
id
releaseCut
requiredLanes[]
requiredCapabilities[]
initialProductState
initialBrokerStateClass
initialAuthorityStateClass
orderedActions[]
scheduledLatency/fault/cancellation points
expectedGatewayOperations/results/events
expectedBroker nonterminal/terminal receipt
expectedAuthority state delta
terminalTruth
localModeInvariant
secretNegativeAssertions
reset/replay behavior
```

Values are synthetic/sanitized. The manifest never contains real email/password/code/token/path/diff, production trace or raw Authority response.

### 10.3 Canonical scenario naming

The detailed IDs in `mock-first-frontend-architecture.md` §8 are the v1 naming seed. Older Blueprint composite aliases are normalized as follows:

| Older Blueprint ID | Canonical manifest ID / decomposition |
|---|---|
| `auth.register.direct-happy` | `register.direct-success` |
| `auth.register.verify-happy` | `register.email-verification` |
| `auth.register.session-expired` | `register.verification-session-expired` |
| `auth.register.disabled` | `register.disabled` |
| `auth.login.happy` | `login.happy` |
| `auth.login.wrong-then-success` | `login.credentials-rejected-then-success` |
| `auth.login.latency-timeout-reconcile` | `race.login-timeout-reconcile` |
| `auth.offline-recover` | `auth.offline-recover` |
| `auth.mfa.retry-happy` | `login.mfa-invalid-then-success` |
| `auth.mfa.challenge-expired` | `login.mfa-expiry-then-retry` |
| `auth.password.link-happy` | `password-reset.request-and-return` |
| `auth.password.link-expired` | `password-reset.expired-link` |
| `auth.oauth.happy` | `oauth.happy-return` |
| `auth.oauth.cancel-expire-offline` | split into `oauth.user-denied`, `oauth.ticket-expired`, `oauth.exchange-offline` |
| `auth.oauth.create-link-mfa` | split into `oauth.completion-bind-confirmation` and `oauth.completion-mfa` |
| `auth.post-success.quota-error` | `handoff.quota-unavailable` |
| `config.adaptive.four-contexts` | the four `configuration.no-config-success`, `healthy-manual-preserve`, `already-configured-noop`, `conflict-review` scenarios |
| `config.result.matrix` | the existing plan/apply/rollback/close/ack/dismiss scenario family; no single matrix ID |

Mandatory additions not fully represented in the current Frontend catalog are:

- `register.access-only-session-rejected`
- `login.account-policy-blocked`
- `oauth.provider-disabled`
- `oauth.ticket-expired`
- `oauth.ticket-replayed`
- `password-reset.disabled`
- `session.cold-restore`
- `session.refresh-lost-response`
- `session.refresh-concurrent-singleflight`
- `configuration.apply-outcome-unknown-reconcile`
- `version.transport-major-unsupported`
- `version.authority-guarantee-missing`

Backend-only refresh/revoke/API-key/billing cases remain in this same manifest with non-frontend `requiredLanes`; they do not create an alternate backend manifest.

## 11. Good / Base / Bad Contract Cases

### 11.1 Authentication and vault

| Case | Input/facts | Required result |
|---|---|---|
| Good | Registration verification succeeds; durable token pair returned; vault stage + metadata commit + vault activate + `/auth/me` verify succeed | `authenticated(persistent, accountEpoch)` then post-auth reads; no config mutation |
| Base | Email verification disabled; direct register returns durable pair and commit succeeds | Same authenticated terminal through fewer nonterminal states |
| Bad | Authority returns access token only, vault is locked, metadata commit fails, or MFA not complete | No authenticated view and no `sessionOnly`; closed failure + complete Local Mode |

### 11.2 Error and version

| Case | Input/facts | Required result |
|---|---|---|
| Good | Known stable `INVALID_CREDENTIALS` reason | Authority reason -> Broker `invalidCredentials` -> Gateway `credentialsRejected + editInput(password)` |
| Base | New optional Authority field under supported minor | Wire decoder ignores/records drift; safe mapped result unchanged |
| Bad | Unknown enum/reason required to decide a mutation, unsupported major, or missing durable guarantee | `protocolMismatch/contractUnsupported/capabilityUnavailable`; affected action fails closed; no raw message fallback |

### 11.3 Event and reconciliation

| Case | Input/facts | Required result |
|---|---|---|
| Good | OAuth callback transport event arrives before the initiating Promise settles | Exact intent/attempt owner is bound; event buffered/replayed; `readOAuthAttempt` supplies authoritative transition |
| Base | Event is lost but initiating operation result or later read is available | UI converges without relying on event delivery |
| Bad | `oauthAttemptChanged` or `configurationTaskChanged` directly sets authenticated/success state | Rejected: events are wakeups, not terminal truth |

### 11.4 Configuration

| Case | Input/facts | Required result |
|---|---|---|
| Good | Exact non-stale plan consent; all writes/reload settle; durable receipt committed | Safe result view + event wakeup; raw path/content/diff absent |
| Base | Plan is a true no-op | `overall=unchanged`; no files written and no fake changed-file success |
| Bad | Plan expired/concurrent edit, Broker has no config operation, or frontend sends raw patch/path | Fail closed/replan; no mutation; formal contract considered incomplete |

### 11.5 Mock/Real parity

| Case | Input/facts | Required result |
|---|---|---|
| Good | Same manifest scenario runs through Mock Gateway, Real Gateway over scenario transport, Broker fake, and applicable Authority fixture | Same Gateway-visible transition/error/recovery/terminal semantics; layer-private traces may differ |
| Base | Real Authority explicitly lacks a negotiated capability | Conformance verdict `blocked-capability`; UI hides/disables exact action; other scenarios and Local Mode continue |
| Bad | Mock uses a private success field or backend fixture changes expected terminal outcome independently | Conformance fail; Late integration blocked |

## 12. Blocking Inconsistencies And Required Resolutions

| ID | Severity | Exact evidence | Failure trigger | Frozen resolution |
|---|---|---|---|---|
| `B-01` | Blocking | PRD lines 82/121/246, Blueprint lines 969/1145, `proposal.md:61` and behavior spec line 154 use `AccountGateway / AccountService`; Mock-first frontend line 13 uses `AccountGatewayV1` | Different lanes create two frontend abstractions or import different names | Only `AccountGatewayV1`; `AccountService` removed from formal design/tasks, then proposal/spec wording normalized by their write owner before governance closure |
| `B-02` | Blocking | `app-account-api-integration.md:179-203` flat interface vs `mock-first-frontend-architecture.md:592-600` composed port | UI/reviewer cannot determine canonical operation surface | Composed port wins; §4.3 maps old aliases |
| `B-03` | Blocking | PRD lines 15/61/114/176 prohibit session-only; `app-account-api-integration.md:252` still permits “session-only state or fail closed” | Vault failure can be mislabeled authenticated | Delete session-only branch in formal design; only persistent commit or fail closed |
| `B-04` | Blocking | `mock-first-frontend-architecture.md:136` calls frontend identity `operationId`; `parallel-backend-delivery-plan.md:210` says Broker generates `operation_id` | Duplicate idempotency authority; retry may mint a second remote mutation | Freeze intent/request/Broker operation identities per §4.2 |
| `B-05` | Blocking | `mock-first-frontend-architecture.md:584-604` says OAuth events are wakeups but defines no OAuth authoritative read | Callback event cannot converge safely, especially when early/lost | Add `auth.readOAuthAttempt`; event maps only to this read |
| `B-06` | Blocking | Frontend config port at `mock-first-frontend-architecture.md:555-579`; Broker union at `parallel-backend-delivery-plan.md:182-205`; backend plan line 750 defers config contract | Mock UI can approve config journey that Real Broker cannot express | Add seven config Broker operations in §5 before lanes start |
| `B-07` | Blocking | `GatewayFailureV1` at frontend lines 168-194, `AccountErrorViewV1` at API architecture lines 387+, `BrokerErrorCode` at backend lines 455+ | Raw/duplicated error models drift on field, retry, action and copy | Canonical Gateway discriminated recovery + explicit Broker mapping in §7 |
| `B-08` | Major | Gateway uses numeric `version:1` and per-success identity; backend uses four `1.0.0` strings; old IDs embed `/v1` | Same v1 serializes differently and version gate cannot be shared | Canonical IDs + SemVer in §§3/9; instance/envelope/fixture identities have distinct owners |
| `B-09` | Major | Blueprint scenario IDs at lines 977+ differ from Frontend catalog at lines 957+; backend proposes its own `manifest.json` | UI/backend tests run “same journey” under different IDs/outcomes | One QE-owned semantic manifest; aliases/decomposition in §10 |
| `B-10` | Major | API architecture `AuthTransitionV1` exposes optional `displayUrl`; Mock-first port says Real adapter owns transport and UI must not know backend DTO | Renderer can become browser URL authority or leak callback/query data | No URL in Gateway; Broker/Real adapter opens system browser and returns opaque handle |
| `B-11` | Major | Frontend events carry full session/capability payload but also claim events are wakeups | Event payload competes with authoritative read and stale generation | Events contain identity/invalidation hints only; §8 read mapping is mandatory |
| `B-12` | Major | Backend SemVer table treats added closed enum variant as minor | Existing exhaustive TS/Rust consumer cannot safely handle emitted variant | Product-visible closed variant is major unless capability negotiation proves old consumer never receives it |

No additional type-style preference is reported. Each finding has a concrete construction/transport/consumer failure.

## 13. Formal Design And Tasks Freeze Checklist

### 13.1 Design MUST adopt

- [ ] List all seven canonical contract IDs, versions, owners and boundaries from §3.
- [ ] Use only `AccountGatewayV1`; include composed subports, `reconcileIntent` and `auth.readOAuthAttempt`.
- [ ] Define `AccountTransportV1` as a credential-free runtime-validated IPC boundary; no Rust/wire/persistence type is exported directly.
- [ ] Define the three identities (`GatewayIntentId`, `TransportRequestId`, `BrokerOperationId`) and exact binding/idempotency rules.
- [ ] Include the complete operation mapping in §5, including config operations.
- [ ] Remove every session-only success branch; authenticated requires persistent vault/metadata/me commit.
- [ ] Encode orthogonal module/connectivity/vault/session/resource/config state and keep route/form UI-only.
- [ ] Use the discriminated Gateway recovery model; remove contradictory `retryable + action` combinations and raw/message-key injection.
- [ ] Define wakeup-only events and their exact authoritative reads; cover early/lost/duplicate event behavior.
- [ ] Use SemVer rules from §9, especially product-visible closed variants as breaking.
- [ ] Assign `quality-engineer` as semantic scenario manifest owner and `test-automation-engineer` as schema/validator implementation owner.
- [ ] Mark Blueprint/older research IDs as aliases only; executable assets use canonical IDs.
- [ ] Keep Authority Wire DTO, token, ticket, raw URL/path/content/diff and persistence entities outside UI types.
- [ ] Freeze Settings → Account as the single fixed route, pull-only usage reads, Codex-only first recipe and bounded first-release scope; no event/background bootstrap may widen them.

### 13.2 Tasks MUST create executable evidence

- [ ] Canonical manifest and JSON/schema validators with unique IDs, version checks and secret/PII/path scans.
- [ ] TS compile-time tests: Mock and Real satisfy one Gateway; closed unions exhaustive; forbidden import boundaries.
- [ ] Real adapter runtime tests for Good/Base/Bad transport payloads, unknown fields/enums, unsupported major and missing guarantees.
- [ ] TS/Rust IPC round-trip fixtures for every operation/result/event, including null/optional semantics.
- [ ] Broker tests for intent-to-operation binding, idempotency conflict, cancellation before send, outcome unknown and reconcile.
- [ ] Event tests for early-before-ACK, duplicate, delayed, absent, old account epoch and exact read convergence.
- [ ] Vault/session tests proving no session-only/plaintext fallback and no authenticated projection before full commit.
- [ ] Config tests for plan TTL/account epoch/digest, no-op, concurrent edit, Nth-file failure, rollback incomplete and durable terminal receipt.
- [ ] Shared scenario conformance across Mock Gateway, Real-over-scenario transport, Broker fake and token2api test authority where applicable.
- [ ] Production boundary gates: Mock/Lab unreachable, zero real calls during Mock phase, no arbitrary URL/HTTP/Tauri command.
- [ ] Local Mode harness under flags off, vault unavailable, authority hang/outage, metadata corrupt, session revoked and quota exhausted.
- [ ] `git diff --check` and applicable OpenSpec strict validation before implementation dispatch.

## 14. Validation Verdict

| Validation requirement | Review result | Evidence / remaining executable work |
|---|---|---|
| No duplicate authority | **PASS at design decision level** | §3.3 assigns identity, Broker lifecycle, config and UI/scenario facts exactly once; executable ownership files still pending |
| UI does not depend on wire DTO | **PASS at frozen boundary level** | Explicit Gateway -> safe Transport -> Broker -> private Authority Wire stack; import/schema guards required in tasks |
| Mock/Real behavior parity is executable | **PASS as a testable contract, not yet executed** | One semantic manifest, derived lane fixtures, same Gateway suite and normalized trace rules defined; files/harness pending |
| Good/Base/Bad and illegal states covered | **PASS** | §§6, 7, 9 and 11; session-only, raw DTO, event-terminal and duplicate-ID illegal states explicitly rejected |
| Blocking inconsistencies resolved | **PASS for formalization** | B-01–B-12 each has one frozen resolution; formal design must encode them before implementation |
| Repository diff hygiene | **PASS** | `git diff --check -- openspec/changes/integrate-token2api-account-system/research/v1-contract-freeze-review.md` |
| OpenSpec target change | **PASS** | `openspec validate integrate-token2api-account-system --type change --strict --no-interactive` |

### Final parity verdict

**Gateway/Broker/Authority/Scenario parity is design-freeze coherent at v1.0.0.** It is not yet executable conformance evidence. The implementation gate remains closed until formal design/tasks instantiate this review as typed contracts, schemas, fixtures and validators, and all `B-*` resolutions are mechanically enforced.
