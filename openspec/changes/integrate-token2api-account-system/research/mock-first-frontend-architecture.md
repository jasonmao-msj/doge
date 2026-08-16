# token2api Account UI — Mock-first Frontend Architecture

> 状态：`research-ready-for-architecture-reconciliation`。本文是 frontend architecture research artifact，不是 `proposal.md`、`design.md`、`tasks.md` 或 production implementation。
>
> Owner：`frontend-engineer`。
>
> Scope：定义可在 **零真实 backend 调用** 下完整体验、测试和反复调整的 Account UI 架构，并保证最终接入真实实现时只替换 adapter / transport composition，不修改 component behavior。
>
> Inputs：`AGENTS.md`、`.agents/agents/frontend-engineer.md`、关联 Trellis PRD、`research/synthesis.md`、`research/product-experience-blueprint.md`。`research/app-account-api-integration.md` 在本文首版完成后出现，已在 validation 阶段完成只读 calibration；对齐结论集中列在 §18.2，最终 contract freeze 仍由 `doge-project-lead` / designated contract owner 负责。

## 1. Outcome And Decision

采用一个 versioned frontend port：`AccountGatewayV1`。所有 Account components、hooks、state machines 与 tests 只依赖该 port 的 credential-minimized view model 和 closed result；不得 import `MockAccountGateway`、Tauri command、HTTP client 或 token2api DTO。

```text
Account components
  -> feature hooks / state machines
    -> AccountGatewayV1                         stable frontend-facing port
       ├─ MockAccountGatewayV1
       │    -> deterministic ScenarioRuntimeV1  zero network / zero Tauri
       └─ RealAccountGatewayV1
            -> AccountTransportV1
               ├─ production Tauri transport   later integration
               └─ scenario-backed transport    contract/conformance tests
```

该结构的核心收益：

1. **UI/backend 真并行**：UI team 只等待 `AccountGatewayV1` 与 Product Blueprint 冻结，不等待 server、vault、desktop callback 或 config transaction 实现。
2. **Mock 与 Real 不形成两套产品**：Mock 只实现 port 和 transport behavior，不携带 component-specific shortcut。
3. **所有点击先可模拟触发**：注册、登录、找回、MFA、OAuth、额度和一键配置均通过 Scenario Runtime 产生真实 async state transition，而不是 event handler 内直接 `setSuccess(true)`。
4. **用户满意后单点切 Real**：composition root 将 `mode: "mock"` 改为 `mode: "real"`；components、hooks、state machine 和 UI tests 不改 import 或 props。
5. **Local Mode 始终独立**：Account feature mount、bootstrap、offline、expiry 或 crash 不参与 App startup 和既有 local capability 的 enablement。

## 2. Non-negotiable Frontend Invariants

### 2.1 Product and isolation

- Account Convenience 是独立 feature slice；不得向既有 workspace、conversation、engine、file、Git、terminal 或 Composer state 注入 `loggedIn` gate。
- `LocalModeView.status` 在 Account UI contract 中固定为 `"available"`；它是用户可见承诺，不从 token2api availability 推导。
- Account feature flag off 时，entry、context CTA、surface host、bubble、badge、polling 和 loading slot 全部消失；既有 layout/timing 与 ccgui local baseline 等价。
- Account Gateway 初始化失败只使 Account surface 进入 `unavailable/offline`；不得让 `AppShell`、router 或 local navigation suspense 等待它。
- 登录完成、managed-key consent 和 config apply consent 是三次独立 authorization。UI state machine 不得把前一阶段 success 自动 dispatch 为后一阶段 mutation。

### 2.2 Boundary and secrecy

- Renderer generic state / store / gateway trace 不接收 access token、refresh token、API key、OAuth code、desktop ticket、PKCE verifier、TOTP seed、raw config path、raw old/new content 或 raw diff。
- 唯一 narrow exception 是用户主动进入 TOTP enrollment 专用 modal 后的 purpose-specific QR / manual secret presentation：它只在 modal local memory 中短暂存在，关闭立即清理，禁止进入 generic store、trace、fixture、diagnostics、analytics 或 screenshot automation。Mock只返回显著的 non-secret placeholder presentation。
- Auth form 中 password、verification code、TOTP 与 reset password 只能存在于对应 form local state；不得进入 global store、scenario state、event trace、URL、fixture、analytics 或 persisted draft。
- Mock trace 只记录 operation name、request ordinal、safe request shape、scenario transition 与 closed outcome；禁止序列化 request payload。
- UI 只消费 closed `GatewayFailureCode`、capability reason、safe labels 和 typed view model；不得显示 raw upstream/backend error。
- `planHandle`、`fileHandle`、`attemptHandle` 等 opaque handle 仅用于当前 feature lifecycle，不进入 diagnostics 或 long-term client storage。

### 2.3 State and async correctness

- Account lifecycle、session capability、vault、connectivity、freshness 与 config task 必须正交建模；禁止一个 `isLoggedIn` / `isDegraded` boolean 控制所有页面。
- 每个 async lane 有独立 generation；stale response、scenario reset 前的 response 或 account epoch 变化前的 response 均不得写入当前 state。
- `AbortSignal` 表示 caller 不再等待，不自动等价于 server mutation 已取消。只有显式 `cancelOAuth` 等 port action 可以产生业务 cancellation。
- Duplicate mutation 必须由 stable `operationId` + in-flight guard 抑制；UI disable 只是 presentation，adapter 仍需幂等处理同一 logical operation。
- Mock 与 Real 使用相同 latency、cancel、race 和 lost-response assertions；即时 Promise 不得成为唯一测试路径。

## 3. Suggested Feature Slice And Import Boundaries

以下是后续 implementation 的建议落位，不在本文创建 production files：

```text
src/features/account/
  contracts/
    accountGatewayV1.ts
    accountViewModels.ts
    accountFailures.ts
  gateway/
    createAccountGateway.ts
    AccountGatewayProvider.tsx
  adapters/
    real/
      RealAccountGatewayV1.ts
      AccountTransportV1.ts
      mapAccountTransportPayload.ts
    mock/
      MockAccountGatewayV1.ts
      ScenarioRuntimeV1.ts
      scenarioCatalog.ts
      fixtures/
  state/
    accountFeatureMachine.ts
    authFlowMachine.ts
    configurationTaskMachine.ts
  hooks/
    useAccountFeature.ts
    useAuthFlow.ts
    useAccountUsage.ts
    useConfigurationTask.ts
  components/
    account-center/
    auth/
    usage/
    configuration/
  lab/
    AccountLab.tsx
    AccountScenarioPanel.tsx
  test/
    renderAccountExperience.tsx
    accountUiContractSuite.tsx
```

Import rules：

- `components/**` MAY import `hooks/**`、presentation types 和 shared UI；MUST NOT import `adapters/**`、`ScenarioRuntimeV1`、Tauri service 或 token2api DTO。
- `hooks/**` MAY import `AccountGatewayV1` interface；MUST NOT discriminate `gateway.kind === "mock"`。
- `state/**` MUST remain pure；effect execution 由 hooks/service layer 负责。
- `adapters/real/**` 是唯一 frontend transport mapping owner；snake/camel、unknown payload narrowing 与 error mapping 不得散落进 hooks。
- `adapters/mock/**` MUST be production-unreachable and removable by tree shaking；scenario selection/dev controls不得编译进普通 production path。
- `lab/**` 只能依赖 public feature component + scenario control API，不能 fork Account pages。

## 4. Versioned `AccountGateway` Port

### 4.1 Versioning rule

`V1` 是 frontend behavior contract version，不是 token2api route version。Backend route 演进由 Real adapter 吸收；只有出现 component-visible breaking behavior 时才新增 `AccountGatewayV2`。

```ts
export const ACCOUNT_GATEWAY_V1 = {
  id: "doge.account-gateway",
  version: 1,
} as const;

export type AccountGatewayContractV1 = typeof ACCOUNT_GATEWAY_V1;

export type GatewayResult<T> =
  | { ok: true; contract: AccountGatewayContractV1; value: T }
  | { ok: false; error: GatewayFailureV1 };

export type GatewayCallContext = {
  /** UI logical operation identity; safe to log, never derived from a credential. */
  operationId: string;
  /** Local observation cancellation. It does not imply remote rollback. */
  signal?: AbortSignal;
};

export type GatewayFailureCode =
  | "cancelled"
  | "offline"
  | "serviceUnavailable"
  | "capabilityUnavailable"
  | "rateLimited"
  | "validationRejected"
  | "credentialsRejected"
  | "verificationExpired"
  | "mfaRequired"
  | "mfaExpired"
  | "oauthStateMismatch"
  | "oauthDenied"
  | "externalIntentExpired"
  | "sessionExpired"
  | "sessionRevoked"
  | "vaultLocked"
  | "vaultUnavailable"
  | "staleAccountEpoch"
  | "stalePlan"
  | "concurrentEdit"
  | "permissionDenied"
  | "unsafeTarget"
  | "rollbackIncomplete"
  | "protocolMismatch"
  | "unknownSafeFailure";

export type GatewayFailureV1 = {
  code: GatewayFailureCode;
  stage:
    | "capabilities"
    | "register"
    | "login"
    | "mfa"
    | "oauth"
    | "passwordReset"
    | "session"
    | "account"
    | "usage"
    | "configurationPlan"
    | "configurationApply";
  retryable: boolean;
  retryAfterMs: number | null;
  action:
    | "none"
    | "retry"
    | "loginAgain"
    | "unlockVault"
    | "requestNewLink"
    | "replan"
    | "reviewFiles"
    | "contactSupport";
};
```

`GatewayFailureV1` 不携带 arbitrary `message` / `messageKey`。UI 使用 exhaustive local mapping 将 closed code 映射到 i18n key，避免 Mock/Real copy drift 或 backend 注入未经审核的文案。

### 4.2 Capability and safe views

```ts
export type AccountCapabilityKey =
  | "auth.emailPasswordLogin"
  | "auth.registration"
  | "auth.registrationEmailVerification"
  | "auth.passwordReset"
  | "auth.mfaChallenge"
  | "auth.oauth.github"
  | "auth.oauth.google"
  | "auth.oauth.linuxdo"
  | "auth.oauth.wechat"
  | "auth.oauth.oidc"
  | "auth.oauth.dingtalk"
  | "account.profile"
  | "account.changePassword"
  | "account.totpManagement"
  | "account.identityBindings"
  | "account.revokeAllSessions"
  | "usage.quota"
  | "configuration.plan"
  | "configuration.apply";

export type OAuthProviderCapabilityKey = Extract<
  AccountCapabilityKey,
  `auth.oauth.${string}`
>;

export type CapabilityAvailability =
  | { status: "enabled" }
  | {
      status: "disabled";
      reason: "serverDisabled" | "desktopUnsupported" | "featureFlagOff";
    }
  | {
      status: "unknown";
      reason: "loading" | "offline" | "serviceUnavailable";
    };

export type AccountCapabilitiesView = {
  observedAt: string;
  freshness: "fresh" | "softStale" | "hardExpired";
  entries: Readonly<Record<AccountCapabilityKey, CapabilityAvailability>>;
  registration: {
    emailSuffixHint: string | null;
    invitationCode: "hidden" | "optional" | "required";
    promoCode: "hidden" | "optional";
    agreementRequired: boolean;
    humanVerificationRequired: boolean;
  };
};

export type AccountSessionView =
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

export type AccountBootstrapView = {
  localMode: { status: "available"; blockedByAccount: false };
  gatewayAvailability: "ready" | "offline" | "serviceUnavailable";
  capabilities: AccountCapabilitiesView;
  session: AccountSessionView;
  vault: "ready" | "locked" | "unavailable" | "inconsistent";
};
```

`primaryEmailLabel` 是 host-approved presentation string；不得用作 durable identity、analytics dimension 或 fixture lookup。Active auth form 内用户输入的 email 仍由 form local state 持有，并在 flow 结束/关闭后清理。

### 4.3 Auth transitions

```ts
export type OpaqueHandle<Kind extends string> = string & {
  readonly __opaqueKind: Kind;
};

export type AuthAttemptHandle = OpaqueHandle<"auth-attempt">;
export type ExternalIntentHandle = OpaqueHandle<"external-intent">;
export type OAuthAttemptHandle = OpaqueHandle<"oauth-attempt">;
export type HumanVerificationHandle = OpaqueHandle<"human-verification">;
export type ConfigPlanHandle = OpaqueHandle<"config-plan">;
export type ConfigFileHandle = OpaqueHandle<"config-file">;
export type ConfigResultHandle = OpaqueHandle<"config-result">;

/** Transient form value. Never persist, trace, fixture, stringify or place in global state. */
export type SecretInput = string & { readonly __transientSecretInput: never };

/** Dedicated modal-only presentation value. Never persist, trace, snapshot or screenshot. */
export type EphemeralSensitivePresentation = string & {
  readonly __ephemeralSensitivePresentation: never;
};

export type TotpEnrollmentPresentation = {
  /** Purpose-scoped sensitive presentation; never store, trace, snapshot or screenshot. */
  qrSvg: EphemeralSensitivePresentation;
  manualSecret: EphemeralSensitivePresentation | null;
  expiresAt: string;
};

export type HumanVerificationPurpose =
  | "register"
  | "login"
  | "registrationCode"
  | "passwordReset";

export interface AccountHumanVerificationPortV1 {
  readRequirement(
    input: { purpose: HumanVerificationPurpose },
    context: GatewayCallContext,
  ): Promise<GatewayResult<
    | { status: "notRequired" }
    | { status: "required"; provider: "turnstile"; siteKey: string; action: string }
    | { status: "unavailable"; reason: "offline" | "platformUnsupported" | "providerUnavailable" }
  >>;

  /** Proof is consumed immediately and replaced by an opaque one-use handle. */
  submitProof(
    input: { purpose: HumanVerificationPurpose; proof: SecretInput },
    context: GatewayCallContext,
  ): Promise<GatewayResult<{ verification: HumanVerificationHandle; expiresAt: string }>>;
}

export type AuthNextView =
  | { next: "verification"; attempt: AuthAttemptHandle; emailLabel: string; resendAt: string }
  | { next: "mfa"; attempt: AuthAttemptHandle; expiresAt: string }
  | { next: "oauthWaiting"; attempt: OAuthAttemptHandle; providerLabel: string; expiresAt: string }
  | {
      next: "oauthAccountCompletion";
      attempt: AuthAttemptHandle;
      requirements: readonly ("email" | "invitation" | "mfa" | "bindConfirmation")[];
    }
  | { next: "resetRequested"; requestAccepted: true }
  | { next: "passwordResetReady"; intent: ExternalIntentHandle; expiresAt: string }
  | { next: "authenticated"; session: Extract<AccountSessionView, { status: "authenticated" }> };

export interface AccountAuthPortV1 {
  beginRegistration(
    input: {
      email: string;
      password: SecretInput;
      invitationCode?: SecretInput;
      promoCode?: string;
      agreementAccepted: boolean;
      humanVerification?: HumanVerificationHandle;
    },
    context: GatewayCallContext,
  ): Promise<GatewayResult<AuthNextView>>;

  resendRegistrationCode(
    input: { attempt: AuthAttemptHandle; humanVerification?: HumanVerificationHandle },
    context: GatewayCallContext,
  ): Promise<GatewayResult<AuthNextView>>;

  submitRegistrationCode(
    input: { attempt: AuthAttemptHandle; code: SecretInput },
    context: GatewayCallContext,
  ): Promise<GatewayResult<AuthNextView>>;

  login(
    input: { email: string; password: SecretInput; humanVerification?: HumanVerificationHandle },
    context: GatewayCallContext,
  ): Promise<GatewayResult<AuthNextView>>;

  verifyMfa(
    input: { attempt: AuthAttemptHandle; code: SecretInput },
    context: GatewayCallContext,
  ): Promise<GatewayResult<AuthNextView>>;

  startOAuth(
    input: { provider: OAuthProviderCapabilityKey },
    context: GatewayCallContext,
  ): Promise<GatewayResult<AuthNextView>>;

  cancelOAuth(
    input: { attempt: OAuthAttemptHandle },
    context: GatewayCallContext,
  ): Promise<GatewayResult<{ cancelled: true }>>;

  completeOAuthAccount(
    input: {
      attempt: AuthAttemptHandle;
      email?: string;
      invitationCode?: SecretInput;
      mfaCode?: SecretInput;
      bindConfirmed?: boolean;
    },
    context: GatewayCallContext,
  ): Promise<GatewayResult<AuthNextView>>;

  requestPasswordReset(
    input: { email: string; humanVerification?: HumanVerificationHandle },
    context: GatewayCallContext,
  ): Promise<GatewayResult<AuthNextView>>;

  inspectExternalIntent(
    input: { intent: ExternalIntentHandle },
    context: GatewayCallContext,
  ): Promise<GatewayResult<AuthNextView>>;

  resetPassword(
    input: { intent: ExternalIntentHandle; newPassword: SecretInput },
    context: GatewayCallContext,
  ): Promise<GatewayResult<{ reset: true }>>;

  logout(
    input: { scope: "thisDevice" | "allSessions" },
    context: GatewayCallContext,
  ): Promise<GatewayResult<{ localSessionCleared: true; remoteRevocation: "confirmed" | "unconfirmed" }>>;
}
```

### 4.4 Account, usage and configuration ports

```ts
export type AccountCenterView = {
  profile: {
    displayName: string;
    primaryEmailLabel: string;
    avatarKind: "doge" | "initials";
  };
  security: {
    totp: "enabled" | "disabled" | "unavailable";
    passwordChange: "available" | "unavailable";
    identityBindings: readonly {
      provider: string;
      status: "bound" | "available" | "unavailable";
    }[];
  };
};

export type QuotaUsageView = {
  status: "available" | "unavailable";
  freshness: "fresh" | "softStale" | "hardExpired";
  observedAt: string | null;
  remaining: { value: number; unit: "requests" | "credits" } | null;
  used: { value: number; unit: "requests" | "credits" } | null;
  resetsAt: string | null;
  subscriptionLabel: string | null;
};

export type ConfigurationOfferView =
  | { status: "notEligible"; reason: "notAuthenticated" | "capabilityUnavailable" }
  | { status: "none" }
  | {
      status: "available";
      recipeId: string;
      recipeVersion: number;
      targetLabel: string;
      recommendation: "configure" | "preserve" | "reviewConflict" | "alreadyConfigured";
    };

export type ConfigFileSummaryView = {
  file: ConfigFileHandle;
  targetLabel: string;
  outcome: "willChange" | "unchanged" | "blocked";
};

export type ConfigurationPlanView = {
  plan: ConfigPlanHandle;
  recipeId: string;
  recipeVersion: number;
  targetLabel: string;
  expiresAt: string;
  summary: "changesPlanned" | "noop" | "blocked";
  files: readonly ConfigFileSummaryView[];
};

export type SafePresentedValue =
  | { kind: "absent" }
  | { kind: "boolean"; value: boolean }
  | { kind: "number"; value: number }
  | { kind: "enum"; label: string }
  | { kind: "safeText"; text: string }
  | { kind: "redacted"; label: "managedCredential" | "userValue" | "sensitiveValue" };

export type ConfigFileDetailView = {
  file: ConfigFileHandle;
  targetLabel: string;
  sections: readonly {
    label: string;
    entries: readonly {
      kind: "add" | "remove" | "change" | "context";
      fieldLabel: string;
      before: SafePresentedValue;
      after: SafePresentedValue;
    }[];
  }[];
};

export type ConfigurationResultView = {
  result: ConfigResultHandle;
  overall: "unchanged" | "applied" | "rolledBack" | "rollbackIncomplete" | "aborted";
  files: readonly {
    targetLabel: string;
    outcome: "unchanged" | "applied" | "rolledBack" | "rollbackFailed" | "skippedPrecondition" | "failedBeforeWrite";
  }[];
  reload: {
    requirement: "none" | "newSessions" | "restartRequired";
    status: "notNeeded" | "pending" | "applied" | "failed";
  };
  acknowledged: boolean;
};

export interface AccountProfilePortV1 {
  read(context: GatewayCallContext): Promise<GatewayResult<AccountCenterView>>;
  updateProfile(
    input: { displayName: string },
    context: GatewayCallContext,
  ): Promise<GatewayResult<AccountCenterView>>;
  changePassword(
    input: { currentPassword: SecretInput; newPassword: SecretInput },
    context: GatewayCallContext,
  ): Promise<GatewayResult<{ changed: true }>>;
  requestTotpEmailCode(context: GatewayCallContext): Promise<GatewayResult<{ resendAt: string }>>;
  beginTotpEnrollment(
    input: {
      verification:
        | { kind: "password"; value: SecretInput }
        | { kind: "emailCode"; value: SecretInput };
    },
    context: GatewayCallContext,
  ): Promise<GatewayResult<{ enrollment: AuthAttemptHandle; presentation: TotpEnrollmentPresentation }>>;
  confirmTotpEnrollment(
    input: { enrollment: AuthAttemptHandle; code: SecretInput },
    context: GatewayCallContext,
  ): Promise<GatewayResult<{ enabled: true }>>;
  disableTotp(
    input: {
      verification:
        | { kind: "password"; value: SecretInput }
        | { kind: "emailCode"; value: SecretInput };
    },
    context: GatewayCallContext,
  ): Promise<GatewayResult<{ disabled: true }>>;
  startIdentityBinding(
    input: { provider: OAuthProviderCapabilityKey },
    context: GatewayCallContext,
  ): Promise<GatewayResult<AuthNextView>>;
  unbindIdentity(
    input: { provider: OAuthProviderCapabilityKey },
    context: GatewayCallContext,
  ): Promise<GatewayResult<{ unbound: true }>>;
}

export interface AccountUsagePortV1 {
  read(context: GatewayCallContext): Promise<GatewayResult<QuotaUsageView>>;
}

export interface AccountConfigurationPortV1 {
  readOffer(context: GatewayCallContext): Promise<GatewayResult<ConfigurationOfferView>>;
  createPlan(
    input: { recipeId: string; recipeVersion: number; intent: "configure" | "review" },
    context: GatewayCallContext,
  ): Promise<GatewayResult<ConfigurationPlanView>>;
  readFileDetail(
    input: { plan: ConfigPlanHandle; file: ConfigFileHandle },
    context: GatewayCallContext,
  ): Promise<GatewayResult<ConfigFileDetailView>>;
  apply(
    input: { plan: ConfigPlanHandle; consent: "applyExactPlan" },
    context: GatewayCallContext,
  ): Promise<GatewayResult<ConfigurationResultView>>;
  readCurrentTask(context: GatewayCallContext): Promise<GatewayResult<ConfigurationOfferView | ConfigurationPlanView | ConfigurationResultView>>;
  acknowledgeResult(
    input: { result: ConfigResultHandle },
    context: GatewayCallContext,
  ): Promise<GatewayResult<{ acknowledged: true }>>;
  hardDismiss(
    input: { recipeId: string; recipeVersion: number },
    context: GatewayCallContext,
  ): Promise<GatewayResult<{ dismissed: true }>>;
}
```

### 4.5 Gateway root and events

```ts
export type AccountGatewayEventV1 =
  | { kind: "sessionChanged"; session: AccountSessionView }
  | { kind: "capabilitiesChanged"; capabilities: AccountCapabilitiesView }
  | { kind: "oauthChanged"; attempt: OAuthAttemptHandle; state: "waiting" | "returned" | "cancelled" | "expired" }
  | { kind: "externalIntentReady"; intent: ExternalIntentHandle; purpose: "passwordReset" }
  | { kind: "usageInvalidated" }
  | { kind: "configurationTaskChanged" };

export interface AccountGatewayV1 {
  readonly contract: AccountGatewayContractV1;
  bootstrap(context: GatewayCallContext): Promise<GatewayResult<AccountBootstrapView>>;
  subscribe(listener: (event: AccountGatewayEventV1) => void): () => void;
  readonly humanVerification: AccountHumanVerificationPortV1;
  readonly auth: AccountAuthPortV1;
  readonly profile: AccountProfilePortV1;
  readonly usage: AccountUsagePortV1;
  readonly configuration: AccountConfigurationPortV1;
}
```

事件只用于 refresh/wakeup；terminal truth 仍通过对应 read/action result 收敛。UI 不把 event arrival 当作 configuration durable success 或 OAuth authentication completion。

## 5. Real And Mock Adapter Replaceability

### 5.1 Real adapter

`RealAccountGatewayV1` 的职责仅是：

1. 将 frontend port call 映射到 `AccountTransportV1`；
2. 将 `unknown` transport response runtime-validate 为 closed view model；
3. 将 transport/backend failure 映射为 `GatewayFailureV1`；
4. 在 `AbortSignal`、request generation 与 account epoch 变化时抑制 stale result；
5. 将 transport event 投影为 `AccountGatewayEventV1`。

它不得承载产品业务规则、server policy replication 或 component copy。Production transport 最终可以是 Tauri IPC，但 `AccountGatewayV1` 不暴露 command 名和 backend DTO。

### 5.2 Mock adapter

`MockAccountGatewayV1` 实现相同 interface，并把每个 call 转成无敏感 payload的 `ScenarioOperation`。它不得：

- 在 component click handler 中注入 success/error；
- 因页面路径直接返回预设 JSX state；
- 使用 `Math.random()`、real current time、real timer race 或网络；
- 读取 production Tauri bridge、token2api URL、OS vault 或用户 config；
- 记录 email/password/code 等 request values；
- 为某个 test 临时添加 interface 外的 escape hatch。

### 5.3 Composition root

```ts
export type AccountGatewayMode = "real" | "mock";

export type CreateAccountGatewayOptions =
  | { mode: "real"; transport: AccountTransportV1 }
  | { mode: "mock"; scenarioRuntime: ScenarioRuntimeV1 };

export function createAccountGateway(
  options: CreateAccountGatewayOptions,
): AccountGatewayV1 {
  return options.mode === "real"
    ? new RealAccountGatewayV1(options.transport)
    : new MockAccountGatewayV1(options.scenarioRuntime);
}
```

唯一允许识别 mode 的位置是 composition/lab bootstrap。`AccountGatewayProvider` 以下的 code 不知道当前 adapter 类型。

## 6. UI State Machines

### 6.1 Feature state is orthogonal

```ts
type AccountFeatureStateV1 = {
  module: "disabled" | "booting" | "ready" | "unavailable";
  connectivity: "online" | "offline" | "serviceUnavailable";
  vault: "ready" | "locked" | "unavailable" | "inconsistent";
  capabilities: "unknown" | AccountCapabilitiesView;
  session: AccountSessionView;
  route: AccountRouteV1;
  authFlow: AuthFlowStateV1;
  usage: RemoteResourceState<QuotaUsageView>;
  configuration: ConfigurationTaskStateV1;
  localMode: { status: "available" };
};

type RemoteResourceState<T> =
  | { status: "idle" }
  | { status: "loading"; previous: T | null; generation: number }
  | { status: "ready"; value: T }
  | { status: "stale"; value: T; failure: GatewayFailureV1 }
  | { status: "error"; failure: GatewayFailureV1 };
```

Rules：

- `module="unavailable"` 与 `localMode="available"` 可以同时成立，并且是 required state。
- `session="authenticated"` 不自动意味着 `vault="ready"`、`connectivity="online"` 或 quota `fresh`。
- Usage refresh failure 保留 last-known value 并进入 `stale`；不得清空成 zero。
- `route` 是用户 navigation intent；不要从 async state 反复推导并抢回用户已选择的 screen。
- Password、verification code、MFA code、OAuth browser data 与 config raw detail不进入该 state。

### 6.2 Auth flow state

```ts
type AuthFlowStateV1 =
  | { state: "landing" }
  | { state: "login" }
  | { state: "register" }
  | { state: "registrationCodeSending"; operationId: string }
  | { state: "registrationVerification"; attempt: AuthAttemptHandle; resendAt: string }
  | { state: "loginSubmitting"; operationId: string }
  | { state: "mfa"; attempt: AuthAttemptHandle; expiresAt: string }
  | { state: "forgotPassword" }
  | { state: "resetRequested" }
  | { state: "resetPassword"; intent: ExternalIntentHandle; expiresAt: string }
  | { state: "resetLinkInvalid"; reason: "expired" | "consumed" | "invalid" }
  | { state: "oauthWaiting"; attempt: OAuthAttemptHandle; providerLabel: string; expiresAt: string }
  | { state: "oauthCompletion"; attempt: AuthAttemptHandle; requirements: readonly string[] }
  | { state: "authSuccess"; accountEpoch: number };
```

Key transitions：

| Current | Event/result | Next | Guard / side effect |
|---|---|---|---|
| landing | choose login/register | login/register | capability enabled；否则 unavailable view |
| register | request code accepted | registrationVerification | 清 password；保留安全 email draft |
| registrationVerification | resend accepted | same state, new `resendAt` | old request generation invalid |
| registrationVerification | register authenticated | authSuccess | 清全部 secret/form draft |
| login | login returns MFA | mfa | 保存 opaque attempt only |
| mfa | code rejected | mfa | 保留 attempt，清 code input，展示 remaining retry state |
| mfa | attempt expired | login | 显示 expiry，要求重新登录，不制造 session |
| login/register | start OAuth | oauthWaiting | real opens system browser；mock opens browser surrogate |
| oauthWaiting | returned + completion needed | oauthCompletion | 不静默 bind/create |
| oauthWaiting | returned authenticated | authSuccess | exact current attempt only |
| forgotPassword | accepted | resetRequested | 无论 account 是否存在都用同一 presentation |
| external intent | valid | resetPassword | intent handle + expiry only |
| resetPassword | expired/consumed | resetLinkInvalid | 提供 request-new-link |
| authSuccess | offer loaded | Account Overview + optional offer | 不 provision key、不 apply config |

Close/back semantics沿用 Product Blueprint：离开 Auth Container 回 Local Mode，不把 cancel 当 error；pending verification/MFA/OAuth只保留 safe resumable summary，不持久化 secret draft。

### 6.3 Configuration task state

```ts
type ConfigurationTaskStateV1 =
  | { state: "idle" }
  | { state: "offer"; offer: Extract<ConfigurationOfferView, { status: "available" }>; unread: boolean }
  | { state: "planning"; operationId: string }
  | { state: "planReady"; plan: ConfigurationPlanView; expandedFile: ConfigFileHandle | null }
  | { state: "applying"; plan: ConfigPlanHandle; startedAt: string }
  | { state: "result"; result: ConfigurationResultView; unread: boolean }
  | { state: "attention"; result: ConfigurationResultView; unread: true }
  | { state: "dismissed"; recipeId: string; recipeVersion: number };
```

- ordinary close 只关闭 surface，不改变 state/unread；bubble 可恢复。
- `已知晓` 只调 `acknowledgeResult`，不 hard dismiss。
- applying 可关闭 surface但不可 hard dismiss；Mock scenario 必须能在 surface unmounted 后继续 settle。
- account epoch、recipe version、plan expiry 或 scenario reset 使 old `planReady` 进入 stale/replan，不可继续 apply。
- 每个 file detail 有独立 request generation；快速展开 A→B 时 A 的迟到 response 不覆盖 B。

### 6.4 Async lane ownership

建议至少维护这些 generation lanes：

```text
bootstrap
capabilities
auth-mutation
oauth:<attemptHandle>
external-intent:<intentHandle>
profile-read
profile-mutation
usage-read
configuration-offer
configuration-plan
configuration-file:<fileHandle>
configuration-apply:<planHandle>
```

每次 scenario reset、adapter replacement 或 authenticated `accountEpoch` 变化时，所有 account-scoped lane generation 增加。旧 Promise 即使 resolve，也只能写 safe trace `staleIgnored`，不得 dispatch UI state。

## 7. Deterministic Stateful Scenario DSL

### 7.1 Requirements

Scenario system 必须同时满足：

- deterministic virtual time；同一 scenario + seed + action sequence 得到相同结果；
- stateful；register 后可 login、quota 会变化、logout 后 session 消失；
- serializable/reviewable；不允许 arbitrary callback/function 作为 scenario behavior；
- request-value blind；只按 operation、safe field presence、ordinal 与 runtime state 匹配，不存储 password/email/code；
- cancellable and raceable；可模拟 out-of-order、lost response、side-effect-before-cancel；
- inspectable；dev panel 只展示 safe state与 redacted trace；
- versioned；DSL breaking change需新增 schema version 和 migration/fixture gate。

### 7.2 DSL draft

```ts
export const ACCOUNT_SCENARIO_V1 = {
  id: "doge.account-scenario",
  version: 1,
} as const;

export type ScenarioOperationName =
  | "gateway.bootstrap"
  | "humanVerification.readRequirement"
  | "humanVerification.submitProof"
  | "auth.beginRegistration"
  | "auth.resendRegistrationCode"
  | "auth.submitRegistrationCode"
  | "auth.login"
  | "auth.verifyMfa"
  | "auth.startOAuth"
  | "auth.cancelOAuth"
  | "auth.completeOAuthAccount"
  | "auth.requestPasswordReset"
  | "auth.inspectExternalIntent"
  | "auth.resetPassword"
  | "auth.logout"
  | "profile.read"
  | "profile.update"
  | "profile.changePassword"
  | "profile.requestTotpEmailCode"
  | "profile.beginTotpEnrollment"
  | "profile.confirmTotpEnrollment"
  | "profile.disableTotp"
  | "profile.startIdentityBinding"
  | "profile.unbindIdentity"
  | "usage.read"
  | "configuration.readOffer"
  | "configuration.createPlan"
  | "configuration.readFileDetail"
  | "configuration.apply"
  | "configuration.readCurrentTask"
  | "configuration.acknowledgeResult"
  | "configuration.hardDismiss";

export type SafeRequestShape = {
  presentFields?: readonly string[];
  absentFields?: readonly string[];
  enumFields?: Readonly<Record<string, string>>;
  /** Never contains email, password, code, token, path or free-form text. */
};

export type ScenarioMatchV1 = {
  operation: ScenarioOperationName;
  occurrence?: number;
  requestShape?: SafeRequestShape;
  state?: Readonly<Record<string, string | number | boolean | null>>;
};

export type ScenarioEffectV1 =
  | { type: "setConnectivity"; value: "online" | "offline" | "serviceUnavailable" }
  | { type: "setVault"; value: "ready" | "locked" | "unavailable" | "inconsistent" }
  | { type: "setSessionFixture"; fixture: string }
  | { type: "setCapabilitiesFixture"; fixture: string }
  | { type: "setUsageFixture"; fixture: string }
  | { type: "setConfigurationFixture"; fixture: string }
  | { type: "incrementAccountEpoch" }
  | { type: "queueEmailIntent"; purpose: "registration" | "passwordReset"; fixture: string }
  | { type: "openOAuthSurrogate"; providerFixture: string }
  | { type: "emitFixtureEvent"; fixture: string; afterMs: number };

export type ScenarioSettlementV1 =
  | { kind: "resolve"; fixture: string }
  | { kind: "fail"; errorFixture: string }
  | { kind: "waitForControl"; control: "deliverEmail" | "completeOAuth" | "denyOAuth" | "restoreNetwork" }
  | { kind: "never" };

export type ScenarioRuleV1 = {
  id: string;
  match: ScenarioMatchV1;
  latencyMs: number;
  /** Simulates whether remote state changed before UI stopped observing. */
  commitPoint: "none" | "requestAccepted" | "settlement";
  effectsBeforeSettlement?: readonly ScenarioEffectV1[];
  settlement: ScenarioSettlementV1;
  effectsAfterSettlement?: readonly ScenarioEffectV1[];
};

export type AccountScenarioDefinitionV1 = {
  schema: typeof ACCOUNT_SCENARIO_V1;
  id: string;
  titleKey: string;
  descriptionKey: string;
  tags: readonly ("auth" | "mfa" | "oauth" | "usage" | "configuration" | "race" | "offline" | "expiry")[];
  seed: number;
  clock: { startsAt: string };
  initialFixtures: {
    capabilities: string;
    session: string;
    usage: string;
    configuration: string;
    vault: "ready" | "locked" | "unavailable" | "inconsistent";
    connectivity: "online" | "offline" | "serviceUnavailable";
  };
  rules: readonly ScenarioRuleV1[];
};
```

Example（不含任何 credential/PII value）：

```ts
const LOGIN_MFA_EXPIRY: AccountScenarioDefinitionV1 = {
  schema: ACCOUNT_SCENARIO_V1,
  id: "login.mfa-expiry-then-retry",
  titleKey: "accountLab.scenario.loginMfaExpiry.title",
  descriptionKey: "accountLab.scenario.loginMfaExpiry.description",
  tags: ["auth", "mfa", "expiry"],
  seed: 1402,
  clock: { startsAt: "2032-04-05T10:00:00.000Z" },
  initialFixtures: {
    capabilities: "capabilities.all-auth",
    session: "session.signed-out",
    usage: "usage.unavailable-signed-out",
    configuration: "configuration.none",
    vault: "ready",
    connectivity: "online",
  },
  rules: [
    {
      id: "first-login-requires-mfa",
      match: { operation: "auth.login", occurrence: 1 },
      latencyMs: 480,
      commitPoint: "settlement",
      settlement: { kind: "resolve", fixture: "auth.next-mfa-short-ttl" },
    },
    {
      id: "expired-mfa-is-closed-failure",
      match: { operation: "auth.verifyMfa", occurrence: 1 },
      latencyMs: 350,
      commitPoint: "none",
      settlement: { kind: "fail", errorFixture: "error.mfa-expired" },
    },
    {
      id: "second-login-requires-fresh-mfa",
      match: { operation: "auth.login", occurrence: 2 },
      latencyMs: 480,
      commitPoint: "settlement",
      settlement: { kind: "resolve", fixture: "auth.next-mfa-normal-ttl" },
    },
    {
      id: "second-mfa-authenticates",
      match: { operation: "auth.verifyMfa", occurrence: 2 },
      latencyMs: 350,
      commitPoint: "settlement",
      settlement: { kind: "resolve", fixture: "auth.authenticated-demo" },
      effectsAfterSettlement: [
        { type: "setSessionFixture", fixture: "session.authenticated-demo" },
        { type: "incrementAccountEpoch" },
      ],
    },
  ],
};
```

### 7.3 Runtime execution semantics

`ScenarioRuntimeV1` 应维护：virtual clock、seeded ordinal、fixture state、operation occurrence、in-flight operations、scheduled events、safe trace 与 current scenario epoch。

1. Gateway call 先生成 `ScenarioOperation { name, safeShape, ordinal, scenarioEpoch }`；原 request object不得交给 trace/DSL matcher。
2. 按 rule order 找第一个 exact match；无 match 返回 `unknownSafeFailure`，并在 dev panel 标记 missing scenario coverage，不能默认为 success。
3. `latencyMs` 使用 virtual scheduler。Automated test 用 `advanceBy(ms)`；interactive lab 可按 1x/5x/instant 驱动同一 virtual clock。
4. `commitPoint="requestAccepted"` 可模拟“remote 已成功但 response lost/caller cancelled”；reset scenario 才回滚 Mock world，普通 abort 不自动回滚。
5. Abort before settlement 返回 `cancelled` 给 observer并移除其 UI delivery；已经 scheduled/committed的世界状态是否继续由 `commitPoint` 决定。
6. Scenario reset 增加 `scenarioEpoch`、清 timer/in-flight/subscriber，并发布 fresh bootstrap；旧 callback 只能进入 `staleIgnored` trace。
7. Event delivery可早于 action Promise settlement，用于覆盖 OAuth callback/subscribe race；hook generation和post-event authoritative read必须保证收敛。
8. Runtime 禁止 real `Date.now()`、unseeded random、real fetch、Tauri invoke、filesystem 或 localStorage。

## 8. Scenario Catalog

Catalog 是用户评审与 automated acceptance 的共同事实源；不要按 Story / test / dev panel 各复制一份 fixture。

| Scenario id | Primary journey | Required behavior |
|---|---|---|
| `bootstrap.signed-out-happy` | Account landing | Local Mode available；auth capabilities loaded |
| `bootstrap.capabilities-loading-slow` | loading | 不闪现 disabled form/provider；Local Mode CTA可用 |
| `bootstrap.offline` | offline | Account unavailable；Local Mode完整可用；retry可恢复 |
| `bootstrap.service-unavailable-last-known` | degraded | 显示 stale capability，不冒充 fresh |
| `challenge.required-success` | human verification | 只产生一次性handle；proof不持久化、不重用 |
| `challenge.expired-then-retry` | challenge expiry | auth request closed failure；用户可获取fresh challenge |
| `challenge.unavailable` | platform/provider unavailable | 对应auth capability fail closed；Local Mode可用 |
| `register.direct-success` | registration | 无 verify时直接 authenticated；只展示 offer，不写 config |
| `register.email-verification` | email code | send/resend/cooldown/invalid-then-success/change-email |
| `register.policy-fields` | invitation/promo/agreement | capability驱动 fields；server rejection保留安全 draft |
| `register.disabled` | disabled route | 不渲染假 form；回 login/Local Mode |
| `login.happy` | login | authenticated + once-only offer |
| `login.credentials-rejected` | login error | form-level safe error；password不进入 trace |
| `login.rate-limited` | retry timing | exact retryAfter presentation；重复 click被抑制 |
| `login.mfa-happy` | MFA | direct login不先成立 session；MFA后才 authenticated |
| `login.mfa-expiry-then-retry` | MFA expiry | expired attempt回 login；fresh attempt success |
| `oauth.happy-return` | OAuth | browser surrogate waiting→return→authenticated |
| `oauth.user-denied` | OAuth denial | 回 login，可重试；不产生 session |
| `oauth.state-mismatch` | unsafe callback | fail closed；Local Mode可用 |
| `oauth.completion-bind-confirmation` | pending completion | 显式 bind/create choice；不静默合并 |
| `oauth.cancel-late-callback` | cancel/race | cancel后迟到 callback不抢焦点/不建立 stale UI session |
| `password-reset.request-and-return` | reset | uniform request result；email surrogate deliver；reset success→login |
| `password-reset.expired-link` | expired intent | request-new-link recovery；password draft清理 |
| `password-reset.consumed-replay` | replay | fail closed；不重复 success |
| `session.expire-while-usage-loading` | account epoch race | old usage response被忽略；Local Mode不受影响 |
| `session.logout-remote-unconfirmed` | logout outage | local logout成立；不得声称all sessions revoked |
| `vault.locked` | vault gate | account benefit recovery copy；无 session-only/fallback vault；Local Mode可用 |
| `account.profile-update-happy` | profile | updated safe view收敛；display input不进入trace |
| `account.profile-update-rejected` | profile validation | field-safe error；其他Account slices保持可用 |
| `account.change-password-happy` | security | transient current/new passwords清理；closed success |
| `account.totp-enroll-password` | TOTP security | password verification→ephemeral placeholder QR→confirm→enabled |
| `account.totp-enroll-email` | TOTP security | send/cooldown/email code→ephemeral placeholder QR→confirm |
| `account.totp-enrollment-expired` | TOTP expiry | presentation/flow清理；重新开始，不保留seed |
| `account.totp-disable-rejected` | TOTP security | verification rejected；状态仍enabled |
| `account.identity-bind-happy` | identity binding | system-browser surrogate→bound，exact provider only |
| `account.identity-bind-choice` | identity conflict | 显式bind/adopt decision；不静默合并 |
| `account.identity-unbind-last-method-blocked` | identity safety | fail closed且解释可恢复action；不锁死account |
| `account.revoke-all-confirmed` | session security | typed confirmation后更新session state |
| `account.revoke-all-unconfirmed` | revoke failure | 不声称远端撤销完成；Local Mode和local sign-out可用 |
| `usage.fresh-normal` | quota | remaining/used/reset/freshness清楚 |
| `usage.soft-stale-refresh-fails` | stale data | 保留last-known，标 stale，不显示healthy current |
| `usage.exhausted` | quota exhausted | 只影响 token-service benefit；Local Mode可用 |
| `configuration.no-config-success` | first setup | offer→plan→changed files→apply→verified result |
| `configuration.healthy-manual-preserve` | preserve | 默认 preserve；零 mutation；不继续 nag |
| `configuration.already-configured-noop` | noop | no changed-file list；真实 noop copy |
| `configuration.conflict-review` | conflict | review-first；不使用模糊一键修复 |
| `configuration.lazy-detail-race` | file A→B | A迟到 detail不得覆盖B；每文件可独立retry |
| `configuration.plan-expired` | plan TTL | apply fail stale；要求 replan |
| `configuration.concurrent-edit` | TOCTOU | no false success；replan/review action |
| `configuration.partial-rollback` | partial | applied/not-completed区分；attention bubble |
| `configuration.rollback-incomplete` | recovery | durable recovery semantics；不能 hard dismiss applying |
| `configuration.close-while-applying` | background settle | surface关闭后继续；result bubble unread |
| `configuration.ack-reopen-dismiss` | bubble semantics | close/ack/reopen/hard dismiss互不混淆 |
| `race.older-login-response-after-newer` | async race | old result ignored even if it succeeds |
| `race.offline-after-request-accepted` | lost response | mutation可能已提交；retry按operation id收敛，不双重副作用 |

Catalog 最小覆盖所有 Product Blueprint pages；每个 UI PR 只扩展 catalog，不重写已有 scenario id 的既定语义。Breaking fixture behavior 需要显式 scenario version bump或新 id。

## 9. Dev Scenario Selector And Control Panel

`AccountScenarioPanel` 是 developer/user-review tool，不是 production Account UI。建议提供：

- searchable scenario selector（id、title、tags）；
- `Reset scenario`，回到 fixed initial state；
- virtual clock：pause、advance 100ms/1s/TTL、1x/5x/instant；
- connectivity：online/offline/service unavailable；
- vault：ready/locked/unavailable/inconsistent；
- `Deliver email link` / `Expire link` / `Replay consumed link`；
- OAuth surrogate：browser opened、provider approve、deny、state mismatch、late callback；
- session controls：expire、revoke、switch account epoch；
- usage controls：fresh、soft stale、exhausted；
- config controls：finish success/noop/partial/rollback incomplete、inject concurrent edit；
- safe trace：operation、ordinal、start/settle virtual time、rule id、outcome、stale ignored；
- copyable review URL，仅编码 `scenario id + safe panel state + virtual time`，不编码 form/input data。

Panel constraints：

- 默认 dock 在 Account Lab 右侧，与被评审 viewport 分离；窄屏可折叠。
- Panel controls 自身有 accessible name、keyboard path、focus indicator；不能因“只给开发者”而跳过 a11y。
- Panel reset 不直接修改 React component state；它调用 Scenario Runtime control API，再由 gateway bootstrap/event正常收敛。
- Safe trace 不提供“查看 raw request”按钮。
- Panel 在 production build不可达且不进入 bundle；production error不得提示开启 scenario panel。

## 10. Fixtures And PII/Secret-free Data Policy

### 10.1 Allowed fixtures

- reserved synthetic domains such as `person@example.invalid`；不可使用真实团队成员、客户或常见真实邮箱；
- product-safe labels：`Demo account`、`Codex settings`、`doge Token service`；
- fixed virtual timestamps，例如 `2032-04-05T10:00:00.000Z`；
- opaque synthetic handles generated from scenario id + ordinal；
- semantic config values limited to allowlisted safe enum/boolean/number/text；credential fields始终 `{ kind: "redacted" }`；
- quota numbers与subscription labels明确标为 demo，不来自 production telemetry。

### 10.2 Forbidden fixtures and trace data

- password、TOTP、verification code、reset token、OAuth code/ticket、access/refresh token、API key；
- raw auth request/response body、headers、cookies；
- real absolute paths、home directory、workspace name、machine/user id；
- raw config before/after、raw patch、secret length/prefix/hash；
- real email、display name、billing/customer/device/session data；
- copied production logs、screenshots或 support bundles。

Automated form tests可以在 test closure 内构造 transient input，但 assertion、snapshot、fixture、test title 与 console不得包含其值。Scenario matcher只检查 `presentFields`，不比较 secret/email value。

### 10.3 Fixture validation

CI 应对 scenario/fixture 目录运行：

1. schema validation + unique scenario/rule/fixture id；
2. recursive forbidden-key scan：`token`、`secret`、`password`、`apiKey`、`cookie`、`authorization`、`rawPath`、`rawDiff` 等不得作为 value-bearing field；
3. common credential pattern scan；
4. absolute path / user-home scan；
5. fixture reachability：catalog引用必须存在，无 orphan stale fixture；
6. safe trace snapshot，证明 request payload不会被 stringified。

## 11. Component And Hook Boundaries

### 11.1 Component tree

```text
AccountFeatureRoot
  AccountGatewayProvider
  AccountSurfaceHost
    AccountCenterRoute
      LoggedOutAccountLanding
      AuthContainer
        LoginForm
        RegisterForm
        RegistrationVerificationStep
        ForgotPasswordForm
        ResetPasswordForm
        MfaChallengeForm
        OAuthWaitingPanel
        OAuthAccountCompletionPanel
      LoggedInAccountCenter
        AccountOverview
        UsageQuotaPanel
        CliConnectionsPanel
        AccountSecurityPanel
  ConfigurationTaskSurface
    AdaptiveConfigurationOffer
    ConfigurationPlanReview
    ChangedFileList
    SafeFileDetail
    ConfigurationApplying
    ConfigurationResult
  AccountTaskBubble
```

### 11.2 Ownership

| Layer | Owns | Does not own |
|---|---|---|
| `AccountFeatureRoot` | composition, lazy mount, addon visibility | auth/config business transitions |
| `AccountCenterRoute` | Account IA route selection | session truth or gateway mapping |
| `AuthContainer` | screen layout, back/close/focus restore | secret persistence, fake success |
| Form components | local draft, field validation presentation, submit intent | gateway construction, scenario branch |
| `useAuthFlow` | auth state machine, generation, submit/cancel orchestration | JSX and backend DTO mapping |
| `useAccountFeature` | bootstrap/session/capabilities/event convergence | Local Core gating |
| `useAccountUsage` | last-known + freshness + scoped refresh | local usage aggregation |
| `useConfigurationTask` | offer/plan/detail/apply/ack/bubble machine | file mutation/raw diff |
| Gateway adapter | port mapping, closed errors, cancellation/stale delivery | product copy or React state |
| Scenario Runtime | deterministic world, virtual clock, safe events | direct component state mutation |

### 11.3 Focus, i18n and accessibility

- 每个 exported component有明确 Props；user-visible copy 全走 `account.*` i18n namespace。
- Async form error summary可 focus；field error用 `aria-describedby`；loading不反复 announce。
- MFA/verification使用单一 accessible input，支持 paste/autocomplete，不做六个孤立格。
- OAuth waiting、email wait 和 applying 状态必须提供可理解的 cancel/close semantics；reduced-motion时不依赖动画表达 progress。
- Modal/opaque overlay使用现有 Dialog contract；close后 focus 返回触发入口；bubble body与独立 `×` 是两个可区分的 controls。
- 30–50% text expansion、narrow layout action stack、keyboard-only journey纳入所有 acceptance scenarios。

## 12. Account Lab, Route, Dev Flag And Storybook Strategy

### 12.1 Primary recommendation: isolated Account Lab route

当前 repo 没有 Storybook dependency，`AppRouter` 也不是 React Router route table，而是按 window label选择 surface。因此第一阶段不引入一整套 Storybook toolchain；用 existing Vite/React runtime 提供一个 isolated Account Lab：

```text
dev browser/Tauri only
  #/dev/account-lab?scenario=register.email-verification
  -> AccountLab
     -> createAccountGateway({ mode: "mock", scenarioRuntime })
     -> same AccountFeatureRoot used by product
```

Lab 必须在 `AppShell` 前短路，保证浏览器 Vite 模式下不需要 Tauri/backend也能打开。它只能在以下条件同时满足时启用：

```ts
import.meta.env.DEV === true &&
import.meta.env.VITE_DOGE_ACCOUNT_LAB === "1"
```

Production build resolver只允许 `off | real`；`mock`/Lab分支必须被静态排除。不要用可被普通用户写入的 `localStorage` 单独开启 Mock gateway。

### 12.2 Product feature flags

建议分开：

- `accountConvenience`：控制 production Account seam 是否出现；off 时 addon-equivalent；
- `accountGatewayMode`：composition-only，production恒为 `real`，dev/lab才可 `mock`；
- 后续 `accountUsage`、`configOnboarding` 等 capability flags只控制新增 Account namespace，不控制 Local Core。

组件不得读取 env/feature flag；root先决定是否 mount，以及注入哪个 gateway。

### 12.3 Storybook later, not a second harness

如果 UI 稳定后团队需要 visual regression，可以再接 Storybook，但必须：

- story decorator复用 `AccountGatewayProvider + ScenarioRuntimeV1`；
- story args只选择 catalog scenario，不另建 MSW/handwritten response fixtures；
- interaction test继续调用同一 Account UI contract suite；
- Storybook不是验证 OAuth/email/config race 的 authority，复杂时序仍由 Scenario Runtime + Vitest/Account Lab负责。

## 13. Testing Strategy

### 13.1 Shared UI contract suite

建立 adapter-injected render helper：

```ts
type AccountGatewayFactory = (scenarioId: string) => AccountGatewayV1;

export function describeAccountUiContract(
  name: string,
  createGateway: AccountGatewayFactory,
): void {
  describe(name, () => {
    // same journey assertions; implementation intentionally omitted here
  });
}

describeAccountUiContract("mock gateway", (scenarioId) =>
  createMockAccountGatewayFromScenario(scenarioId),
);

describeAccountUiContract("real adapter over scenario transport", (scenarioId) =>
  createRealAccountGateway(
    createScenarioBackedAccountTransport(scenarioId),
  ),
);
```

这样同一 UI suite 既证明 Mock 可完整驱动 pages，也证明 Real adapter mapping 不改变 component contract。真实 backend尚未完成时，第二套仍可运行，因为它测试的是 Real adapter over stub transport，而非声称完成 server integration。

### 13.2 Test layers

| Layer | Evidence |
|---|---|
| Pure state machine | legal/illegal transitions、epoch invalidation、close/ack/dismiss semantics |
| Scenario Runtime | determinism、virtual clock、rule matching、cancel/commit point、event-before-ACK、reset cleanup |
| Adapter conformance | Mock/Real均实现V1；closed errors；unknown payload fail closed；no raw data |
| Hook | happy/error/offline/race/repeated mount/unmount；AbortSignal + stale response |
| Component | loading/empty/success/noop/partial/failure/stale、form/a11y/focus/i18n |
| Journey | register/login/reset/MFA/OAuth/quota/config全路径，经gateway点击触发 |
| Addon isolation | flag off无entry/slot/loading/listener；Local Core baseline render/action不变 |
| Production bundle | mock/lab/scenario catalog不在production reachable graph |
| Manual Account Lab | user逐slice评审 visual/copy/interaction，并可切换所有scenario |

### 13.3 Mandatory race/cancellation assertions

- login request A slow，request B fast：B authenticated 后 A success不得覆盖。
- component unmount/close时 abort observer；remote `requestAccepted` mutation可以后续通过 authoritative read/event收敛，UI不得宣称 cancelled=rolled back。
- OAuth cancel后 callback迟到：不抢 focus；若 authoritative session变化，Account Center以新epoch安全提示而非恢复旧 waiting screen。
- password reset intent replay/consumed：第二次 fail closed。
- session expiry while usage/config detail pending：旧 result忽略；Local Mode不受影响。
- config file A detail慢、B快：B保持 selected；A可进cache但不改当前 selection。
- apply surface关闭：operation继续；result/event到达后 bubble unread，重新打开读取 authoritative task。
- scenario reset during in-flight：旧 timer/listener全部清理，无 React `act(...)` noise。

## 14. Contract Drift Gates

### 14.1 Compile-time

- `MockAccountGatewayV1 satisfies AccountGatewayV1` 与 `RealAccountGatewayV1 satisfies AccountGatewayV1`。
- Account components的 import-boundary test拒绝 `adapters/mock`、Tauri invoke、token2api DTO。
- Closed unions使用 exhaustive `never` check；新增 failure/capability/config outcome 未映射时 typecheck fail。
- Transport payload以 `unknown` ingress；只有 mapper输出 V1 view model。

### 14.2 Runtime/golden contract

- 保存 credential-free `AccountGatewayV1` request-shape/response fixture manifest，带 `contract.id/version`。
- Real adapter mapper对 missing/extra/invalid enum/nullable fields运行 Good/Base/Bad fixtures；extra transport fields不得自动进入 view model。
- Scenario catalog所有 settlement fixture必须通过同一 runtime validator，Mock不能返回 Real adapter无法产生的结构。
- 后续 architecture artifact冻结 IPC/API 后，增加 transport schema compatibility check；backend breaking change必须先在 adapter mapper fail closed，而不是让 component处理 drift。

### 14.3 Behavioral parity

- `describeAccountUiContract` 对 Mock 与 Real-over-scenario-transport运行相同 scenario ids。
- Adapter conformance检查 cancellation、event ordering、retryAfter、stale account epoch、unknown safe failure。
- Production `real` mode禁止读取 scenario catalog；dev `mock` mode禁止调用 transport。

### 14.4 Privacy and production isolation

- fixture/trace recursive secret+PII scan；safe snapshot中无 input value。
- bundle/import graph gate确保 `src/features/account/lab` 和 `adapters/mock` 不进入 production chunk。
- negative scan确保 component/event handler不存在 `if (mock)`、`simulateSuccess()`、hardcoded token/email/path。

建议后续提供 focused scripts（命名可由实现阶段校准）：

```text
npm run check:account-gateway-contract
npm run test:account-ui-contract
npm run check:account-scenario-fixtures
npm run check:account-production-boundary
```

本 research artifact 本身仅要求 `git diff --check`；未授权新增 scripts。

## 15. Single-point Mock-to-Real Switch

切换步骤必须保持单点且可回滚：

1. 冻结 `AccountGatewayV1`、closed failures、view model 与 scenario catalog semantics。
2. 实现 `AccountTransportV1` 和 `RealAccountGatewayV1` mapping；先只跑 scenario-backed transport，不接 production server。
3. 运行同一 UI contract suite：Mock 与 Real-over-scenario transport必须全绿。
4. 对接真实 Tauri transport；真实 response先过 runtime mapper/closed error，component不改。
5. 仅在 composition root 将 internal/canary cohort的 `accountGatewayMode` 从 `mock` 切 `real`。
6. 运行真实 smoke/E2E，覆盖 server capabilities、session、OAuth/email-link、quota与config host；失败时把 cohort切回off或Mock lab，不改 UI code。
7. 用户确认 Real parity 后 production root恒注入 Real；Mock/Scenario Runtime继续保留为 dev/test asset，不作为 runtime fallback。

禁止的切换方式：

- 在每个 hook里把 `mockFoo()` 改成 `tauriFoo()`；
- 组件从 fixture props改成 service call；
- Real失败时 production自动 fallback到Mock success；
- 为适应backend raw payload让component新增字段判断；
- 删除Mock suite后只靠真实环境手测。

## 16. Frontend-independent PR Slices And User Acceptance Rhythm

所有 frontend PR 可在 backend未可用时通过 Account Lab独立验收；每个 PR 保持可运行、可回退、无 production real call。

| PR slice | Ownership / output | Scenario evidence | User review checkpoint |
|---|---|---|---|
| **F0 — Contract + Lab foundation** | `AccountGatewayV1`、closed views/errors、Scenario Runtime、catalog validator、Account Lab/selector、provider root | bootstrap/offline/latency/race/reset | 用户确认 Lab 使用方式、Account landing方向和 scenario control是否足够 |
| **F1 — Account shell + email auth** | logged-out landing、Auth Container、login/register/email verification、capability loading | register direct/verify/policy/disabled；login happy/rejected/rate-limit | 用户逐屏调整 copy、fields、back/close、loading/error，不等backend |
| **F2 — Recovery + MFA + OAuth** | forgot/reset、external-intent recovery、MFA、OAuth waiting/completion surrogate | reset expired/replay；MFA expiry；OAuth deny/mismatch/cancel-late | 用户完成所有无死路路径，确认 system-browser waiting与re-entry语义 |
| **F3 — Logged-in center + quota** | Overview、profile edit/change password、TOTP setup/disable、identity binding/revoke-all、usage/quota/freshness/outage/expiry | profile validation；TOTP password/email/expiry；binding choice/last-method guard；revoke confirmed/unconfirmed；fresh/stale/exhausted；session expiry；vault locked | 用户完成账号维护与安全路径，并确认Local/remote usage区分、freshness和expired/outage不阻断Local Mode |
| **F4 — One-click configuration UX** | adaptive offer、preserve/conflict、plan、changed files、lazy safe detail、applying/result/bubble | success/noop/preserve/conflict/race/partial/rollback/close/ack/dismiss | 用户在四种config context下反复调整，确认显式授权和progressive disclosure |
| **F5 — Cross-cutting hardening** | a11y/i18n/long text/reduced motion/responsive、addon-off、full contract suite、production boundary | catalog全量 + keyboard/focus matrix | 用户做完整 prototype acceptance；产品/design冻结后才允许Real integration |
| **F6 — Real adapter integration** | Real adapter + Tauri transport mapping only；components ideally zero diff | UI suite on Real-over-scenario +真实 smoke | 对比Mock/Real visual/behavior parity；任何drift先修adapter/contract |

Acceptance cadence：

1. 每个 slice 合并前提供固定 scenario review list，而不是“随便点点”。
2. 用户反馈优先改 Product Blueprint / scenario expectation，再改 component；同一 state的期望只有一个事实源。
3. 每轮评审保留 `scenario id + viewport + locale + result`，不保存用户输入或原始 trace。
4. F1–F4不因backend尚未完成而阻塞；backend contract变化先影响Real adapter/F6，不回流重写已确认component interaction。
5. F5明确记录“UI accepted against Mock”，不能冒充“real integration complete”。

## 17. Validation And Acceptance Matrix

| Requirement | PASS | FAIL |
|---|---|---|
| Backend-free pages | Account Lab所有pages/scenarios在无Tauri、无network下可进入并可操作 | 某按钮因backend unavailable无响应或需要手改component state |
| Adapter neutrality | component/hook只依赖`AccountGatewayV1`；switch不改component | component import Mock/Real/Tauri或判断mode |
| Stateful Mock | action按DSL改变world，re-entry看到一致state | 每页独立静态fixture，跨页状态矛盾 |
| Determinism | fixed scenario/seed/action/clock产生同结果 | real timer/random导致flake |
| Cancellation/race | stale/abort/lost response按lane/commit point收敛 | 后到response覆盖新session或取消被误报rollback |
| Auth completeness | register/login/verify/reset/MFA/OAuth均有success/error/expiry/recovery | login-only demo或OAuth/MFA靠fake success button |
| Quota honesty | fresh/stale/exhausted有不同presentation，Local Mode始终可用 | stale当current、exhausted阻断local |
| Config consent | offer→plan→exact apply分离，list→lazy safe detail，close/ack/dismiss有状态机 | login即写文件、raw diff、close等价consent |
| Fixture privacy | catalog/trace无secret、PII、raw path/diff | fixture含真实/仿真token、密码或用户数据 |
| Same suite | UI contract suite至少完整运行Mock；Real adapter可用同suite+scenario transport | Mock tests与Real tests各写一套expectation |
| Production isolation | prod不能选择Mock/Lab，Mock不是failure fallback | localStorage/URL可在prod开启Mock success |
| Local Mode isolation | addon off/offline/expired/outage不改变既有local surface | Account bootstrap成为startup dependency或local gate |

## 18. Risks And Reconciliation Points

### 18.1 Frontend risks

- **Port过度镜像backend**：若直接把token2api route DTO暴露为Gateway，UI会随server drift返工。应保持journey-oriented view model与Real mapping boundary。
- **Scenario比production更强**：Mock若允许Real无法安全提供的OAuth/config outcome，会形成false acceptance。所有fixtures必须通过Real adapter同一view validator，未实现capability在production仍fail closed。
- **Dev panel成为第二套控制面**：Panel只能驱动Scenario Runtime，不能直接`setState`或复刻pages。
- **Secret在“测试方便”中泄漏**：request value matching、snapshot和trace最容易违规；DSL只允许safe shape matching。
- **Abort语义过度承诺**：UI close/cancel不能假定remote mutation撤销；commit point scenarios必须覆盖。
- **Mock进入production**：必须用compile-time DEV+env双gate、import graph和bundle gate，不能只隐藏UI。
- **Account root进入App hot chain**：feature应lazy/opt-in mount，Account event/state不得挂root高频polling；usage refresh用event/user action + bounded policy，不做秒级root poll。

### 18.2 Calibration with solution architecture

`research/app-account-api-integration.md` 已完成只读对照，方向一致且没有需要停写升级的 ownership conflict。已吸收：

1. React只依赖versioned `AccountGatewayV1`，production由Native Host Broker经Rust transport持有secret/session/callback；
2. Registration email-code continuation、MFA、OAuth和password reset全部使用opaque flow/intent handle，raw token/code/ticket不进renderer；
3. 注册含email verification时，password在`beginRegistration`后由adapter内部volatile flow持有，React后续只提交attempt + code；
4. Turnstile/human verification作为一次性proof进入专用port并立刻换opaque handle，Mock不加载真实SDK；
5. TOTP setup QR/manual secret是唯一purpose-specific sensitive presentation exception，禁止进入通用store/trace/screenshot fixture；
6. current token2api access-only login success、refresh/revoke、OAuth/password-reset Desktop completion与managed key仍是Real integration prerequisite，Mock不得把它们冒充server-ready；
7. rate-limit current contract没有可靠`Retry-After`时，Real adapter必须返回`retryAfterMs: null`，Scenario可单独覆盖“server提供bounded hint”的target contract但UI不能依赖它恒存在；
8. Mock-first UI、Rust broker、token2api hardening保持三条disjoint lane，Late integration才在composition root切Real。

仍待 designated contract owner 在 formal G0 freeze 统一：

1. 本文journey-oriented method names与solution artifact command-oriented names的canonical naming；
2. success envelope是否每个result携带`contractVersion`，或由gateway handshake/session级保证；本文草案选择每个success显式携带contract identity以支持fixture gate；
3. `GatewayFailureV1`与solution artifact更细的field/cooldown/message-key model如何合并；底线是raw message/metadata禁止进入renderer，UI copy由closed mapping拥有；
4. Real IPC command/event inventory、configuration plan/file/result handle TTL与terminal authoritative read；
5. session `accountEpoch`、capability freshness、event ordering与idempotency receipt的最终authority；
6. F6真实联调contract fixture来源、CI gate owner，以及old-server/version negotiation fail-closed matrix。

如果并行 architecture 要求component直接理解IPC/backend DTO、raw token/path/diff或使用backend availability gate住Local Mode，应视为contract冲突并升级给`doge-project-lead`，不能由frontend静默迁就。

## 19. Frontend Implementation Handoff

后续真正派工前，上游至少冻结：

- Product Blueprint中的Account entry、first recipe、usage notice等仍开放的产品决定；
- `AccountGatewayV1` operation/view/error contract与architecture reconciliation；
- frontend write ownership与feature flag/composition seam；
- F0–F6 acceptance scenarios；
- production Mock exclusion与privacy scan gate。

达到这些前置条件后，frontend可按F0–F5完全独立推进Mock-first UI；F6才依赖真实host/backend contract。无论阶段如何，完成报告必须明确区分：

- `UI accepted against Mock scenarios`；
- `Real adapter contract-conformant against scenario transport`；
- `Real backend integration verified`。

三者不能互相替代，也不能把Mock体验完整误报为production account体系已完成。
