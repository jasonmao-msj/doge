# Account Convenience Native Contract

> **Current product calibration (2026-08-16):** OpenSpec `require-account-engine-subscription-onboarding` 已把 Account 从 Local Mode 之上的可选增值层改为 main-window mandatory gate。下文既有 broker/vault/secret-isolation contracts 继续有效；“Account failure 不 gate Local Mode”“用户选择 existing API Key”“展示配置 diff/bubble”只作为旧 change 的历史行为，不得用于当前产品主链。

## Scenario: Local Mode 之上的 token2api Account 增值层

### 1. Scope / Trigger

- Trigger：修改 `src-tauri/src/account/**`、`src/services/accountGateway.ts`、Settings Account UI、managed Codex recipe、account vault/session 或 token2api account API mapping。
- token2api 是 remote identity/account authority；Doge 只拥有 Desktop broker、OS vault、safe local metadata、configuration transaction 与 renderer-safe projection。
- 历史行为：Account failure 不 gate Local Mode。当前产品行为由 `openspec/changes/require-account-engine-subscription-onboarding/**` supersede：main AppShell 在 authenticated account + managed engine ready 前不得挂载。

### 2. Signatures

- Tauri commands：
  - `account_v1_context() -> { processGeneration, accountEpoch }`
  - `account_v1_prepare_mutation(request) -> operationId`
  - `account_v1_execute(request, operationId?) -> AccountIpcResponseEnvelopeV1`
- Wakeup event：`doge://account-v1/wakeup`，payload 为 `{ contractId, contractVersion, event }`；event 只负责唤醒 authoritative read。
- Desktop OAuth target Authority surface：`POST /api/v1/desktop/v1/oauth/authorizations`（provider、intent、loopback `redirect_uri`、PKCE challenge、state、nonce、audience、device id，带 stable `Idempotency-Key`）与 `POST /api/v1/desktop/v1/oauth/authorizations/{authorization_id}/exchange`（opaque ticket、PKCE verifier、nonce、redirect、audience、device id，带 per-attempt stable exchange idempotency key）。这两个 route 仍是 target contract shape；在 token2api implementation 与 descriptor capability/guarantee 未同时上线前，OAuth action必须disabled。
- Native callback broker：`TcpListener::bind("127.0.0.1:0")`；随机 callback path；`GET` only；exact Host/path/state；request `<=8 KiB`；per-connection timeout 2s；attempt TTL `30..=600s`；最多 32 个 attempt、8 次 invalid connection；callback 只接受 `ticket XOR error`，并广播 `{ handle, accountEpoch }` wakeup，不广播 URL/state/nonce/PKCE/ticket。
- Native authority origin：compile-time fixed `https://token-matrix.com`；renderer/env/localStorage/server response 均不得覆盖。`GET /api/v1/settings/public` 还必须返回 exact `api_base_url=https://token-matrix.com` 与三段 decimal SemVer-like `version`，否则整个 Account bootstrap 以 `protocolMismatch` fail closed。
- Public settings 只代表业务开关，不是 execution authority。每个 remote operation 必须同时通过 closed `token2api-account-authority/1.0.0` descriptor 的 capability bit 与该 operation 所需 guarantee set；descriptor缺失、unknown key/guarantee、duplicate guarantee、unsupported version 或 hard-expired cache一律只关闭Account action，Local Mode不变。
- Authority descriptor exact production route 已冻结为 `GET /api/v1/desktop/v1/authority`，token2api handler owner 为 `backend/internal/handler/setting_handler.go::GetAccountAuthorityDescriptor`，Doge consumer 为 `src-tauri/src/account/authority.rs::ACCOUNT_AUTHORITY_DESCRIPTOR_PATH`。不得由renderer/env/localStorage注入或覆盖 path，也不得以current public settings替代descriptor；route缺失、schema漂移或guarantee不足必须fail closed。
- Existing-key Desktop surface 已冻结为 `GET /api/v1/desktop/v1/api-keys` 与 `POST /api/v1/desktop/v1/api-keys/:id/handoffs`。handoff request exact fields=`audience, device_id, recipe_id, recipe_version`，还必须携带 `Authorization: Bearer …` 与 `Idempotency-Key`；response中的raw `secret`只能由Native HTTP adapter消费并立即写入OS vault。
- Durable metadata：`account-v1.sqlite3`；durable secrets：OS credential vault；access token：Rust memory only。
- Codex child credential：仅当 `providerProfileId=doge-token-matrix` 时向该子进程注入 `OPENAI_API_KEY`。

### 3. Contracts

- 每个 mutation MUST 先 `prepare`，绑定 exact `requestId + intentId + operation + accountEpoch + request fingerprint`，再 `execute`。
- renderer 只接收 closed enum、masked label、opaque handle、semantic diff；不得接收 raw token、password、API key、filesystem path、file content 或 server message。
- refresh credential 与 managed API key 只允许 OS vault；vault locked/unavailable 时 account capability fail closed，禁止 session-only/fallback vault。
- SQLite schema version 8 保存 safe `authority_origin_id + account_link_id + device_id` isolation、epoch、masked/profile label、session status、random vault scope、managed key numeric id、operation ledger、configuration safe result、dismissal、external-flow digest/status receipt，以及 credential-free engine checkout checkpoint。checkout 只允许保存 `engine_id + checkout_id + pending/processing + expires_at + updated_at`，禁止保存支付 URL、QR payload、plan 文案、raw handle、credential、raw config、path 或 backup。
- 同一 `intentId + operation + accountEpoch + semantic payload fingerprint` 的 prepare retry MUST 返回已有 `operationId`；不同 fingerprint MUST closed conflict。terminal/executing retry不得再次 dispatch，只能返回 reconcile recovery。
- Codex plan MUST 先返回 changed-file safe labels；file detail lazy read；apply 需要 exact-plan consent，并使用 storage lock + hash recheck + same-filesystem 0700 recovery directory + 0600 backups/stages + durable journal checkpoint + atomic write + fsync + semantic verifier + rollback。
- login、`managedKey.selectExisting(consent=useSelectedApiKey)` 与 `configuration.apply(consent=applyExactPlan)` 是三个独立 mutation/consent。配置 offer MUST 先通过 `managedKey.listCandidates` 返回 name/masked prefix/status/availability，再由用户选择 exact key；apply MUST NOT隐式选择、创建、轮换或替换 key。
- `managedKey.listCandidates` 只允许返回 renderer-safe metadata；raw key 只能由 token2api owner-authorized Desktop handoff 直接进入 Native Broker 并在同一 mutation 中提交 OS vault。handoff 失败不得留下 SQLite ready binding、不得回传 raw key、不得降级到 clipboard/file/frontend storage。
- 无 selectable key 时，UI MUST 仅提供 `https://token-matrix.com/keys` 外部创建入口与主动刷新；browser return不代表创建成功，刷新仍以 authoritative list 为准。
- config journal `applying` 在下次启动执行 rollback；`verified` 表示 files/semantic verification 已完成但 SQLite receipt 尚未提交，重启恢复为 applied result；SQLite receipt 成功后才清 journal。
- durable configuration result MUST 在 restart/unmount 后可经 `configuration.readCurrentTask` 取回；跨进程展示前重新签发当前 generation 的 handle，旧 handle失效。
- build-time renderer flag `VITE_DOGE_ACCOUNT_CONVENIENCE_V1=0` 不得被 localStorage重新开启；Rust `--no-default-features` 不构造 Authority、不打开 Account SQLite、不触碰 OS vault。
- M0 UI Review Package 只允许由 exact build-time flag `VITE_DOGE_ACCOUNT_UI_PREVIEW_V1=1` 产生：Settings Account 与App-level configuration bubble都使用compile-time conditional Mock chunk和同一个process-lifetime Preview Gateway instance，但可见页面 MUST 与真实产品信息架构一致，禁止暴露 `scenario id`、scenario selector、`交互预览`或zero-call调试标签。zero-call只能由build metadata、自动化guard与验收记录证明；同一 flag 必须让 Rust Account Core 不构造 Authority、不打开 Account SQLite、不触碰 OS vault。正常 build 不得通过 localStorage/runtime 切换为 Mock，且 bundler 必须可排除 preview/Mock reachable graph。
- Signed-out Account 主导航 MUST 只保留 `login / register` 两个浅量 Tab；password recovery 作为 login 内次级 action进入focused subflow，不得与主Tab并列。Authenticated Account Center MUST 只保留 `overview / usage / security` 三个Tab；Codex配置从overview CTA或App-level bubble进入 `select existing API Key → file list → lazy safe detail → exact consent → result`闭环。产品页禁止自动创建专用 Key。
- Native Account commands MUST限制 `window.label() == "main"`。
- logout、password change、remote session revocation 只清除 account refresh session，保留已经配置的 Codex API Key，确保 Local Codex provider 不因账号 UI session 变化失效。`managedKey.revoke(consent=removeLocalKey)` 只移除当前 account/device 的 OS-vault binding 与 safe metadata，MUST NOT删除用户在 Token Matrix 中选中的 remote API Key；更换 Key 必须重新进入 existing-key selection，不得调用 remote rotate/delete。
- OAuth callback、普通 Account mutation 共享一个 per-process monotonic `eventSeq`；`RealAccountGatewayV1` 必须先校验完整 event envelope/cursor，再把事件作为 wakeup 分发。React controller 使用 exact-attempt coordinator：early event 先进入 bounded `Set`，start response activate 后重放；同 attempt 只允许一个 authoritative read in flight；不增加 polling。
- OAuth exchange 失败时，ticket/PKCE 内存 material 保留供同一 stable idempotency key 重试；只有 durable session activation + external-flow `consumed` receipt 成功后才清内存 material。IPC response 丢失时，同 process/epoch 的 `auth.readOAuthAttempt` 可从 consumed receipt + active session 恢复 authenticated projection；冲突 terminal receipt fail closed。
- OAuth `denied/expired/cancelled/state mismatch/protocol/replay` 终态必须清 exact attempt 并回登录面；offline/service unavailable/rate limit/vault failure 视为可重试，保留 waiting UI 与 attempt。手动“检查状态”只作为 event 丢失后的恢复入口，不是 polling。
- server guarantee 不足的 mutation（当前包括 durable revoke-all、Desktop OAuth completion、Desktop reset completion、TOTP one-time presentation）MUST hidden/disabled，不能用已有 endpoint 数量冒充安全完成。
- session restore/refresh在读vault、发refresh或激活session前，必须验证`durable_token_pair_v1 + atomic_refresh_replay_v1 + stable_account_reasons_v1`；managed key必须验证one-time secret与metadata-only guarantees；unknown Authority mutation reason映射`protocolMismatch`，不得降级为editable validation error。
- logout本地清除必须独立成功且始终保留Local Mode；缺少validated typed revocation receipt时，无论HTTP 2xx都只能投影`unconfirmed`/`outcomeUnknown`，不得声称remote confirmed。
- Settings 是唯一 fixed Account entry；普通关闭 configuration dialog 后，`AccountConfigurationBubbleHost` MUST 作为 App-level sibling 继续存在，离开 Settings 也不卸载。bubble click 必须导航到同一 `Settings → Account` route、消费一次性 reopen intent，并通过 `configuration.readCurrentTask` authoritative 恢复当前 offer / 未过期 plan / durable result；bubble `×` 才调用 durable `configuration.hardDismiss`。

### 4. Validation & Error Matrix

| 场景 | Native/Gateway 结果 | Local Mode |
|---|---|---|
| service offline / malformed response | `serviceUnavailable` / `protocolMismatch`，safe recovery | 完整可用 |
| vault locked/unavailable | account capability disabled，`vaultUnavailable` | 完整可用 |
| mutation epoch/fingerprint mismatch | native boundary reject before side effect | 完整可用 |
| duplicate semantic intent | reuse已有operation/reconcile，不重复dispatch | 完整可用 |
| logout A → login B | managed key仅按authority/account/device三元组恢复 | 不跨账号注入 |
| config concurrent edit | `concurrentEdit` + replan | 原文件不覆盖 |
| N-file write failure | rollback；失败则 `rollbackIncomplete` | 非账号功能可用 |
| crash during applying journal | next launch reverse rollback + durable result | 原配置不半完成 |
| crash after verified、receipt前 | next launch恢复applied result | 不错误回滚已验证配置 |
| token2api OAuth enabled但无 Desktop completion | `desktopUnsupported` | 其他账号能力可用 |
| OAuth callback早于start response | coordinator缓存exact handle，start settle后authoritative read | 完整可用 |
| duplicate OAuth wakeup / read | 同attempt仅一个exchange in flight；stable idempotency key | 完整可用 |
| wrong state / host / path / audience / device / epoch / generation | callback或exchange fail closed，终态回登录 | 完整可用 |
| exchange response丢失 | retry相同body/key；durable consumed receipt恢复authenticated | 完整可用 |
| App重启存在pending external flow | v7 receipt标记expired；不恢复state/nonce/PKCE/ticket | 完整可用 |
| revoke-all 无 durable persisted generation | `serverGuaranteeMissing` | logout-this-device 仍可用 |
| public settings origin/version缺失或漂移 | `protocolMismatch`，所有Account action fail closed | 完整可用 |
| descriptor path未冻结/descriptor缺失/unknown | affected Account action `serverGuaranteeMissing` / `capabilityUnavailable` | 完整可用 |
| bare logout/revoke 2xx无typed receipt | local cleared + `unconfirmed` / `outcomeUnknown` | 完整可用 |

### 5. Good / Base / Bad Cases

- Good：React form value 只在 Gateway call boundary branded 为 `SecretInputV1`，Native 写 vault，response 只返回 session projection。
- Good：M0 package 看起来和真实Account页一致；scenario catalog只存在于`AccountLab`与自动化测试，reviewer通过页面本身的按钮完成journey。
- Good：loopback callback 到达后只发 `oauthAttemptChanged(attempt)`，React 再调用 `auth.readOAuthAttempt`；SQLite 只包含 `sha256:<handle digest>` receipt。
- Base：账号服务不可用时 Settings Account 显示可重试状态，AppShell 和 Local Mode 不增加 polling/gate。
- Bad：在 Settings Account 页面放`体验场景`下拉、raw scenario id或`交互预览`toolbar，让用户理解测试夹具后才能操作产品。
- Bad：把 refresh/API key 放进 `AppSettings`、SQLite、renderer store、`auth.json`、argv、log 或 diagnostics。
- Bad：UI 直接 `invoke()` / `fetch()` token2api，或允许 env/runtime 参数改变 authority origin。
- Bad：只凭 HTTP 2xx 把缺少 Desktop completion/durability 的 capability 标为 enabled。
- Bad：在 event 中发送 ticket/URL/terminal truth，renderer 轮询 OAuth，或把 state/nonce/PKCE/raw handle 持久化到 SQLite。

### 6. Tests Required

- TS contract/validator：closed enums、unknown field、opaque handle/TTL、privacy scan、Mock/Real transport correlation。
- Frontend：Local Mode visible；usage pull-only；password field cleared；file list before lazy diff；ordinary close→App-level bubble；离开 Settings 仍可重开；bubble `×` hard dismiss。
- Frontend product navigation：signed-out exact visible tabs=`login/register`；recovery只由login内button进入；authenticated exact tabs=`overview/usage/security`；M0 Settings页面不存在scenario selector/raw scenario id/preview label。
- Frontend dialog/bubble：configuration dialog初始focus落在安全普通关闭action，禁止落在help trigger并自动展开tooltip；M0与Real均覆盖ordinary close/ack→App-level bubble→reopen same task→bubble `×` hard dismiss。
- Rust：origin fixed；descriptor frozen production path、closed schema、operation→guarantee inventory、missing guarantee；existing-key list/handoff exact path/body/idempotency、renderer response secret scan与vault commit；vault purpose allowlist；loopback wrong state/host/path/oversize/timeout/cancel-late/replay/binding matrix；Authority begin/exchange field whitelist + stable idempotency retry；SQLite v1→v7 migration/external-flow secret scan/restart expiry/terminal conflict；isolation tuple；semantic retry；epoch/fingerprint correlation；config preserves unrelated data；semantic detail no path/secret；journal crash recovery/verification；local logout key preservation。
- Feature-off：focused frontend test证明build off不可被storage覆盖；`cargo test --no-default-features`证明Native account-off binary仍编译，startup测试证明不创建`account-v1.sqlite3`。
- Cross-layer：`command_registry.rs` exact command mapping、`src/services/tauri/account.ts` payload camelCase、production Settings composition uses Real gateway、wakeup event passes validator then authoritative read。
- Required commands：focused Vitest、`cargo test --manifest-path src-tauri/Cargo.toml account:: --lib`、`npm run typecheck`、`npm run lint`、`npm run check:runtime-contracts`。

### 7. Wrong vs Correct

#### Wrong

```ts
localStorage.setItem("refreshToken", response.refresh_token);
await invoke("account_apply", { path, rawDiff, apiKey });
```

#### Correct

```ts
const prepared = await prepareAccountMutationV1(versionedRequest);
const response = await executeAccountRequestV1(versionedRequest, prepared);
const result = validateAccountIpcResponseV1(response, exactCorrelation);
```

Native 内部负责 token2api、OS vault、safe plan 与 file transaction；renderer 只消费 validated semantic projection。

#### Wrong: callback直接写UI truth

```ts
gateway.subscribe((event) => {
  if (event.kind === "oauthAttemptChanged") setAuthenticated(true);
});
```

#### Correct: wakeup后权威读取

```ts
gateway.subscribe((event) => {
  if (event.kind === "oauthAttemptChanged") {
    oauthCoordinator.observe(event.attempt);
    void gateway.auth.readOAuthAttempt({ attempt: event.attempt }, {});
  }
});
```

event 只表示“可能有变化”，`readOAuthAttempt` + durable session/receipt 才是 terminal truth。

#### Wrong: M0测试控件进入产品页面

```tsx
<AccountSettingsSection>
  <select aria-label="体验场景">...</select>
  <AccountExperience />
</AccountSettingsSection>
```

#### Correct: M0仅替换Gateway composition

```tsx
const gateway = createProductPreviewAccountGatewayV1();
return <AccountSettingsSection gateway={gateway} />;
```

## Scenario: Masked account identity SafeLabel boundary

### 1. Scope / Trigger

- Trigger：修改 `src/features/account/contracts/safeValues.ts`、`primaryEmailLabel` masking、`gateway.bootstrap` authenticated session projection 或 IPC privacy validation。
- 目标：Native 已脱敏的 account label 必须能通过 renderer SafeLabel boundary；通用 label 规则不得先行否决 field-specific masking alphabet。

### 2. Signatures

- `validateSafeLabelForFieldV1(field, value) -> SchemaValidationV1<SafeLabelV1>`。
- `primaryEmailLabel` renderer shape：`string | null`；masked local part MAY 包含 `*`，例如 `a***@token-matrix.com`。
- `profileDisplayName` 等其他 SafeLabel field 继续使用不含 `*` 的通用 alphabet。

### 3. Contracts

- `primaryEmailLabel` MUST 使用独立 allowlist：首字符为 letter/number，总长 `1..=80`，后续只允许 letter/number、space、`._()@*+-`。
- `*` MUST NOT 因本场景扩散到 `profileDisplayName/providerLabel/targetLabel/fieldLabel/subscriptionLabel/maskedPresentation`。
- field-specific shape 通过后仍 MUST 执行 URL、raw email/PII、forbidden field/value privacy checks；允许 masked email 不等于允许 raw email。
- signed-in `gateway.bootstrap` 若其他 correlation/schema 均有效，MUST 接受 masked `primaryEmailLabel` 并继续 engine catalog；不得降级成 `protocolMismatch`。

### 4. Validation & Error Matrix

| 输入 | Field | 结果 |
|---|---|---|
| `a***@token-matrix.com` | `primaryEmailLabel` | accept |
| `user@example.com` | `primaryEmailLabel` | reject as raw PII |
| `A***` | `profileDisplayName` | reject |
| `https://example.com` | any SafeLabel | reject as URL |
| 合法 masked label + wrong IPC correlation | bootstrap response | reject correlation，不得被 label acceptance 掩盖 |

### 5. Good / Base / Bad Cases

- Good：field 决定 allowlist alphabet，随后统一执行 URI/PII/secret privacy scan。
- Base：`primaryEmailLabel=null` 继续作为合法 signed-out/unknown projection。
- Bad：把 `*` 直接加入全局 `SAFE_LABEL_PATTERN_V1`，使所有用户可见 label 的 closed alphabet 被扩大。
- Bad：先执行全局 alphabet，再追加一个更宽的 email check；后者永远无法挽救已产生的 validation issue。

### 6. Tests Required

- `src/features/account/contracts/accountContracts.test.ts` MUST 构造 authenticated `gateway.bootstrap` exact envelope，并断言 masked email 与完整 IPC response 均通过。
- 同一 regression MUST 断言 `profileDisplayName="A***"` 仍失败，锁定 field isolation。
- privacy corpus MUST 继续证明 raw email、URL、secret/path/diff canary 被拒绝。

### 7. Wrong vs Correct

#### Wrong

```ts
if (!SAFE_LABEL_PATTERN_V1.test(value)) issues.push(forbiddenIssue);
if (field === "primaryEmailLabel" && !MASKED_EMAIL_PATTERN.test(value)) {
  issues.push(emailIssue);
}
```

#### Correct

```ts
const pattern = field === "primaryEmailLabel"
  ? MASKED_PRIMARY_EMAIL_LABEL_PATTERN_V1
  : SAFE_LABEL_PATTERN_V1;
if (!pattern.test(value) || isForbiddenAccountValueV1(value)) {
  issues.push(forbiddenIssue);
}
```

## Scenario: Mandatory engine subscription onboarding

### Signatures

- Native commands：`account_engine_v1_catalog`、`account_engine_v1_plans`、`account_engine_v1_create_checkout`、`account_engine_v1_checkout`、`account_engine_v1_pending_checkout`、`account_engine_v1_readiness`、`account_engine_v1_prepare`。
- Authority routes：`GET /api/v1/desktop/v1/engines`、`GET /engines/:engine/plans`、`POST /engines/:engine/checkouts`、`GET /checkouts/:id`、`POST /engines/:engine/managed-access`。
- Closed engine ids：`codex | claude-code`；server mapping 分别为 `openai | anthropic`，renderer 不得推断。
- Required descriptor guarantees：catalog/plans/checkout 需要 `subscription_only_engine_checkout_v1 + stable_account_reasons_v1`；managed prepare 额外需要 `managed_engine_binding_v1 + api_key_one_time_secret_v1 + api_key_metadata_only_reads_v1`。

### Product / Security Contract

- `router.tsx` main route MUST 以 process-lifetime `AccountAppGate` 包裹 `AppShell`；ready 前 workspace/runtime 不挂载。
- 只展示 authority 返回的当前 engine、active subscription group、`for_sale=true` plans；空列表不补 fallback。产品 UI 禁止 balance、recharge、pay-as-you-go、API Key、文件路径与 diff。
- Checkout create 必须携带新 operation id 作为 `Idempotency-Key`；只允许 subscription order。`PAID/RECHARGING → processing`，只有 fulfillment `COMPLETED → paid`。
- Payment navigation 在 Rust 与 TypeScript 两层校验：`open_url` 只允许无 username/password 的 HTTPS；`show_qr` 只作为 bounded QR content 编码，禁止作为 URL/src 执行。
- Pending checkout checkpoint 按 authority/account/device 隔离并在 restart 后 authoritative read；React polling 只允许存在于 AccountGate-owned surface，使用 bounded backoff + absolute server expiry，禁止进入 AppShell/root hook 链。首次启动 flow 在 AppShell mount 前执行；第二引擎增购 overlay 可保留 AppShell mounted，但 tick 只能更新 gate owner。
- managed credential 在 token2api 按 user/device hash/engine/group 幂等 ensure；每次 AppShell mount 前 MUST 重新确认当前 subscription binding，并覆盖 `authority + account + device + engine` scope。raw secret 只走 Rust memory → engine-scoped OS vault。Codex/Claude config 只写 sentinel/base URL，launch 时注入 secret；launch read MUST 要求当前 active account session，MUST NOT 依赖 legacy `managed_key_id`，退出后 fail closed。
- Claude account-managed provider id 固定 `doge-token-matrix`；desktop runtime 注入 `ANTHROPIC_AUTH_TOKEN`，daemon 必须 fail closed，不得读取或伪造 desktop vault secret。

### Required Tests

- token2api：closed catalog、exact public subscription plan filter、checkout terminal/action recovery、required idempotency、audit body omission、managed mapping/isolation。
- Rust：checkout HTTPS/QR validator、SQLite v8 restart/secret scan、Codex/Claude config secret scan、engine-scoped vault、daemon fail closed。
- TypeScript/React：unknown engine/protocol fail closed、exact server plans/no billing fallback、AppShell pre-ready absence、paid auto prepare、pending checkout restart recovery、internal reason 不直出。

异常、恢复与latency scenario由`AccountLab`/Vitest选择；产品页面只呈现用户任务和自然交互。

## Scenario: In-App second managed engine acquisition

### 1. Scope / Trigger

- Trigger：修改 main engine picker、Settings Account engine 入口、`AccountAppGate` ready 后 flow、managed engine entitlement UI 或 post-prepare landing。
- 目标：已有 Codex/Claude 用户增加第二个 engine 时复用同一 subscription/checkout/prepare authority，不修改当前 thread identity，也不卸载当前 AppShell。

### 2. Signatures

- Request intent：`AccountEngineSwitchIntentV1 { source: "accountCenter" | "enginePicker"; targetEngineId: "codex" | "claude-code" | null; openNewConversation: boolean }`。
- Completion intent：`AccountEngineReadyIntentV1 { engineId: "codex" | "claude-code"; openNewConversation: boolean }`。
- Credential-free entitlement snapshot：`Record<"codex" | "claude-code", "active" | "none" | "unknown">`；writer 仅为 authoritative catalog/prepare result。
- Runtime mapping：`codex -> codex`、`claude -> claude-code`；display mapping：`codex -> Codex`、`claude-code -> Claude`。
- 本场景不新增 Tauri command、IPC field、SQLite column 或 token2api route。

### 3. Contracts

- Settings authenticated 固定入口 MUST 使用“我的引擎/管理引擎”；catalog card MUST 区分“已订阅/订阅后使用”，不得把新增权益表达成替换原权益。
- composer 选择不同的 managed engine 且 entitlement snapshot 已 authoritative loaded 时，MUST 在任何 engine/model/provider selection side effect 前发布 target intent；不得先改 `selectedCreationTarget`、active engine 或当前 native thread binding。
- AccountGate 收到 target intent MUST 重新读取 catalog。active entitlement 直接 `prepare`；`none` 直接读取目标 plans；不得先展示通用 engine selector 要用户重复选择。`unknown` 不能作为 entitlement truth。
- ready 后 flow MUST 以 fixed overlay 呈现并让既有 `readyContent` 保持同一 mounted instance。checkout polling 仍由 AccountGate owner 承担，不得把 timer/state 放入 AppShell root hook。
- cancel/back MUST invalidate flow generation；无 checkout 时直接回原 App，有 checkout 时先 exact `abandonCheckout(checkoutId)` 成功再回原 App。迟到 catalog/read/prepare settlement 不得重新激活目标 engine。
- prepare committed 后 completion event 只能携带 engine id 与 landing intent；AppShell consumer 负责同步 active engine、关闭 Settings 并打开空白 Home conversation。不得原地改写当前 thread engine identity。
- entitlement/intent/completion event 禁止携带 plan、checkout URL、order payload、binding id、API key、vault scope 或 config detail。

### 4. Validation & Error Matrix

| 场景 | Gate 行为 | AppShell 行为 |
|---|---|---|
| Codex active、Claude none | 直达 Claude plans | 保持 mounted、原 thread 不变 |
| 目标 entitlement active | 跳过 checkout，authoritative prepare | commit 后切 engine + 新会话 |
| plans/catalog failure | overlay safe failure + retry/cancel | 原上下文仍可返回 |
| checkout pending 后 cancel | exact local abandon；停止 poll | 返回同一 mounted App |
| cancel 与迟到 prepare/read race | generation mismatch 丢弃迟到结果 | 不切 engine、不打开新会话 |
| paid + prepare success | credential-free completion | active engine 同步并打开 Home |
| entitlement snapshot unknown | 不抢占 legacy selection callback | 不以 unknown 假装已订阅/未订阅 |

### 5. Good / Base / Bad Cases

- Good：composer 在写 target 前发 `{ targetEngineId:"claude-code" }`；Gate re-read catalog 后展示 Claude plans，paid 后发 `{ engineId:"claude-code", openNewConversation:true }`。
- Base：用户从“我的引擎”打开无 target catalog，选择已有 engine 后 prepare 并进入该 engine 新会话。
- Bad：先把当前 Codex thread 的 engine 改成 Claude，再发现没有订阅并弹支付。
- Bad：在 Composer/AppShell root 加 checkout polling，或把 server catalog 长期复制进 `AppSettings`。
- Bad：completion event 携带 API key/plan/order/config payload。

### 6. Tests Required

- `AccountAppGate.test.tsx` MUST 覆盖 Codex ready → target Claude plans、ready DOM identity 保持、cancel 返回、paid → Claude prepare/activate/completion。
- `Composer.file-reference-token.test.tsx` MUST 证明已知无权益 target 在 `onSelectEngine` / creation target mutation 前被拦截；snapshot unknown 保留既有 selector contract。
- `ModelSelect.test.tsx` MUST 证明仅 `none` managed engine 显示 localized“订阅后使用”，active/unknown 不误标。
- `useAppShellLayoutNodesSection.test.ts` MUST 证明 completion 先同步 target engine，再关闭 Settings 并进入 Home new conversation。
- `engineSwitchSignal.test.ts` MUST 锁定 closed target/completion payload；`engineOnboardingClient.test.ts` MUST 锁定 novice display mapping。
- Gates：focused Vitest、`npm run typecheck`、`npm run lint`、`npm run check:runtime-contracts`、engine registry/capability checks 与 strict OpenSpec validation。

### 7. Wrong vs Correct

#### Wrong

```ts
setSelectedCreationTarget(claudeTarget);
setActiveEngine("claude");
openPlans("claude-code");
```

#### Correct

```ts
requestAccountEngineSwitchV1({
  source: "enginePicker",
  targetEngineId: "claude-code",
  openNewConversation: true,
});
// AccountGate re-reads catalog; only committed prepare publishes completion.
```

## Scenario: Recovered checkout exit and local abandonment

### 1. Scope / Trigger

- Trigger：修改 `AccountAppGate` 的 pending/processing checkout recovery、checkout SQLite checkpoint、Account logout 或 checkout IPC。
- 目标：恢复支付不能形成无出口页面；离开流程时必须处理 durable local checkpoint，不能只切 React phase 后在下次启动再次恢复同一记录。

### 2. Signatures

- Native command：`account_engine_v1_abandon_checkout(checkout_id: i64) -> { ok, value | error }`。
- Runtime：`AccountRuntime::engine_checkout_abandon(checkout_id: i64) -> Value`。
- Repository：`clear_engine_checkout_if_matches(authority_origin_id, account_link_id, device_id, checkout_id) -> Result<bool, String>`。
- Frontend client：`AccountEngineOnboardingClientV1.abandonCheckout(checkoutId) -> EngineOnboardingResultV1<null>`。
- UI exits：`gateBackToPlans` 与既有 `logout`；等待支付页不得依赖 icon-only back 作为唯一退出路径。

### 3. Contracts

- abandon 是 local-only recovery mutation：MUST 只删除当前 authenticated `authority + account + device + checkout_id` 对应的 SQLite checkpoint；MUST NOT 调用 token2api cancel、声称 remote order cancelled、删除订阅或进入 balance fallback。
- `checkout_id <= 0` MUST `validationRejected`；当前记录属于另一个 checkout id 或 compare-and-delete 失败 MUST `concurrentEdit`；无记录 MUST 作为幂等 success 返回 `value:null`。
- compare-and-delete MUST 在 SQL `DELETE ... AND checkout_id = ?` 中完成；禁止 read 后使用不带 checkout id 的宽删除覆盖并发新订单。
- “返回套餐” MUST 先成功 abandon，再读取当前 engine plans；abandon 失败时保留 checkout 页面并展示 safe recovery error，不得只改 React phase。
- “退出登录” MUST 清除当前 account/device checkout checkpoint 后提交 signed-out session；UI 随后返回登录页。Remote logout 仍遵循既有 best-effort typed-truth contract。
- waiting/processing reconciliation effect MUST 在 phase 离开或 session signed out 后 cleanup；迟到 read 不得重建已 abandon 的 checkpoint。

### 4. Validation & Error Matrix

| 场景 | Native 结果 | UI 结果 |
|---|---|---|
| matching active checkpoint | conditional delete，`ok:true,value:null` | authoritative 读取当前 engine plans |
| checkpoint 已不存在 | idempotent success | 正常返回套餐 |
| 同 account/device 已换成新 checkout id | `concurrentEdit`，不删除新记录 | 留在恢复页并提示重试 |
| SQLite unavailable | `persistenceUnavailable` | 留在恢复页，不制造“已返回”假象 |
| 点击退出登录 | checkout clear + signed-out commit | 显示 login/register，不再恢复旧 checkout |
| provider 远端订单稍后完成 | 本命令不声明 cancel | 后续 entitlement authoritative read 决定可用性 |

### 5. Good / Base / Bad Cases

- Good：显式“返回套餐”调用 `abandonCheckout(checkoutId)`；Native 用 isolation tuple + exact checkout id conditional delete，成功后再 `plans(engineId)`。
- Base：terminal checkout 已由 reconciliation 清除 checkpoint；用户返回套餐时 abandon 幂等成功。
- Bad：`setPhase("plans")` 直接离开页面但保留 SQLite row，导致 restart 再次强制进入支付。
- Bad：把 local abandon 命名/投影为 cancel order，误导用户认为 provider-owned order 已取消。
- Bad：只按 account/device 宽删除，使迟到的旧 UI action 可以删除并发创建的新 checkout。

### 6. Tests Required

- `AccountAppGate.test.tsx` MUST 覆盖 recovered checkout 同时存在“重新打开支付 / 返回套餐 / 退出登录”，返回时 exact checkout id abandon 后读取 plans，失败时留在原页，退出时调用 `auth.logout(thisDevice)` 并离开等待页。
- `engineOnboardingClient.test.ts` MUST 只接受 `value:null` acknowledgement，拒绝 expanded success payload。
- `src/services/tauri/accountEngine.test.ts` MUST 断言 command name 与 `{ checkoutId }` camelCase mapping。
- Rust persistence test MUST 证明 mismatched id 不删除、matching id 删除、重复删除幂等。
- Cross-layer gate MUST 搜索 `command_registry.rs` 注册与 runtime IPC method；required commands：focused Vitest、`cargo test ... account:: --lib`、`npm run typecheck`、`npm run lint`、`npm run check:runtime-contracts`。

### 7. Wrong vs Correct

#### Wrong

```tsx
<button onClick={() => setPhase("plans")}>返回套餐</button>
```

#### Correct

```tsx
const abandoned = await client.abandonCheckout(checkout.checkoutId);
if (!abandoned.ok) return keepCheckoutRecoveryVisible(abandoned.error);
await openPlans(selectedEngine);
```

```sql
DELETE FROM account_engine_checkout
WHERE authority_origin_id = ?1 AND account_link_id = ?2
  AND device_id = ?3 AND checkout_id = ?4;
```

## Scenario: Authenticated AccountGate escape hatch

### 1. Scope / Trigger

- Trigger：修改 mandatory `AccountAppGate` state machine、登录后 engine/plan/payment/preparing/failure 页面，或 `useAccountExperienceControllerV1.logout`。
- 目标：任何尚未进入 AppShell 的 authenticated blocking state 都不能成为账号死路；用户无订阅、无可售套餐或服务失败时仍能切换账号。

### 2. Signatures

- Controller：`logout(scope: "thisDevice" | "allSessions") -> Promise<boolean>`；`true` 仅表示 local signed-out session 已提交，remote revocation truth 仍由既有 receipt 表达。
- Shared frame：`GateFrame({ children, accountExit?: GateAccountExit })`。
- UI contract：`GateAccountExit { copy, busy, failureCode, onLogout }`；产品动作固定复用 localized `copy.logout`。

### 3. Contracts

- `accountExit` MUST 由 authenticated `AccountAppGate` shared frame owner 渲染，并覆盖 `catalog/loading`、engine selection、plans、empty plans、payment method、checkout、preparing 与 authenticated failure；`ready` AppShell 和 signed-out login/register MUST NOT 渲染该 gate action。
- 点击 MUST 调用 `controller.logout("thisDevice")`。成功后进入 login/register；用户可换账号。不得要求先购买订阅、返回上一页或清理 API Key。
- logout pending MUST 同时设置 `disabled` 与 `aria-busy=true`，重复点击不得产生第二个 mutation。
- logout failure MUST 返回 `false`，Gate 留在当前 phase 并显示 mapped safe copy；禁止裸露 Native/protocol enum。
- successful logout MUST invalidate in-flight catalog generation；迟到 catalog result 不得继续 `resumeCheckout`、打开支付 action 或恢复旧 engine path。
- account bootstrap 的 `loading` MUST 由 exact generation owner 管理。`sessionChanged` 触发的 bootstrap 与 logout/change-password signed-out commit 竞态时，signed-out commit MUST 同步 invalidate generation、撤销旧 loading owner 并清除 loading；迟到 bootstrap 只允许静默 settle，不得恢复旧 session 或把 gate 永久留在“正在连接”。
- checkout-local “返回套餐”继续负责 exact checkpoint abandon；全局“退出登录”不得替代该 local recovery contract。

### 4. Validation & Error Matrix

| 当前状态 | 退出动作 | 结果 |
|---|---|---|
| engine / plans / empty plans / payment method | `logout(thisDevice)` | login/register，可换账号 |
| catalog loading / authenticated failure | shared action 始终可见 | 成功 invalidates generation；迟到 catalog 不推进 |
| checkout pending/terminal | shared logout + leaf 返回套餐 | logout 清 session/checkpoint；返回套餐 exact abandon |
| preparing / prepare failure | shared logout | 不挂载 AppShell，返回登录 |
| logout pending | disabled + `aria-busy` | duplicate click 零新增 mutation |
| logout failure | `false` + safe failure | 原 phase 与原主要动作仍可用 |
| logout success 与 `sessionChanged` bootstrap 并发 | signed-out commit 取消旧 loading owner | 立即显示 login/register；stale bootstrap 迟到无可见副作用 |
| signedOut / ready | 不渲染 gate logout | 登录页或 AppShell 各自拥有自己的账号入口 |

### 5. Good / Base / Bad Cases

- Good：`GateFrame accountExit={accountExit}` 作为 authenticated phases 的公共 owner；新增 phase 默认必须显式选择是否属于 authenticated blocking surface。
- Base：无订阅用户在套餐页点击“退出登录”，成功后直接看到登录/注册并换账号。
- Bad：只在 `phase === "checkout"` 内写 logout button，导致 plans/empty/failure 仍无出口。
- Bad：logout 失败后清空 plans 或跳回 loading，使用户既未退出又丢失当前恢复动作。
- Bad：catalog promise 在 logout 成功后继续调用 `resumeCheckout()`，重新打开已退出账号的支付流程。
- Bad：bootstrap 在 stale generation 分支先 `return`，把自己设置的 `loading=true` 永久遗留；或旧 generation settle 时无条件清 loading，误清除更新 generation 的 pending UI。

### 6. Tests Required

- `AccountAppGate.test.tsx` MUST 覆盖无订阅套餐页 visible logout、`auth.logout({scope:"thisDevice"})` exact call、成功后计划页消失。
- 使用 deferred logout 覆盖 pending disabled、duplicate click only once、failure safe alert、plan list 保持可用。
- 使用 deferred catalog 覆盖 catalog loading 中退出成功后迟到 response 不调用 `resumeCheckout`。
- 使用 deferred `sessionChanged` bootstrap 覆盖 logout mutation 先发 event、后返回 success：signed-out commit 后必须立即离开 connecting，迟到 bootstrap settle 后仍保持登录页。
- Existing checkout tests MUST 继续覆盖“返回套餐”与 shared logout；测试点击前先等待目标 phase，避免误点 catalog-loading 的同名 global action。
- Gates：focused Vitest、`npm run typecheck`、target ESLint、full `npm run test`、`npm run lint`。

### 7. Wrong vs Correct

#### Wrong

```tsx
if (phase === "checkout") {
  return <button onClick={() => void logout("thisDevice")}>退出登录</button>;
}
```

#### Correct

```tsx
const accountExit = {
  copy,
  busy: logoutBusy || accountBusy,
  failureCode: logoutFailure,
  onLogout: () => void logoutFromGate(),
};

return <GateFrame accountExit={accountExit}>{phaseContent}</GateFrame>;
```

bootstrap loading 的 owner MUST 与 generation 绑定：

```ts
loadingGenerationRef.current = generation;
setLoading(true);
const result = await gateway.bootstrap({});
if (loadingGenerationRef.current === generation) {
  loadingGenerationRef.current = null;
  setLoading(false);
}
if (generationRef.current !== generation) return;
```
