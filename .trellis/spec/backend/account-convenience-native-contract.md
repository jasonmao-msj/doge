# Account Convenience Native Contract

> **Current product calibration (2026-08-23):** OpenSpec `require-account-engine-subscription-onboarding` 已把 Account 从 Local Mode 之上的可选增值层改为 main-window mandatory gate。下文既有 broker/vault/secret-isolation contracts 继续有效；“Account failure 不 gate Local Mode”“用户选择 existing API Key”“展示配置 diff/bubble”只作为旧 change 的历史行为，不得用于当前产品主链。`doge-unified-product-subscription` 另为 macOS debug 增加 compile-time local development vault exception；Release 仍只使用 OS credential vault。

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
- Durable metadata：`account-v1.sqlite3`；durable secrets：Release 为 OS credential vault，`cfg(all(debug_assertions,target_os="macos"))` 适用下文 development file vault；access token：Rust memory only。
- Codex child credential：仅当 `providerProfileId=doge-token-matrix` 时向该子进程注入 `OPENAI_API_KEY`。

### 3. Contracts

- 每个 mutation MUST 先 `prepare`，绑定 exact `requestId + intentId + operation + accountEpoch + request fingerprint`，再 `execute`。
- renderer 只接收 closed enum、masked label、opaque handle、semantic diff；不得接收 raw token、password、API key、filesystem path、file content 或 server message。
- refresh credential 与 managed API key 只允许 selected `DurableAccountVault` owner；Release 只能是 OS vault，macOS debug 只能是下文 file vault，禁止两者 runtime fallback、session-only 或 renderer storage。
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
- Signed-out Account 主导航 MUST 只保留 `login / register` 两个浅量 Tab；password recovery 作为 login 内次级 action进入focused subflow，不得与主Tab并列。Authenticated Account Center MUST 只保留 `subscription / usage` 两个 Tab：subscription 直接呈现已订阅引擎，且不得自动触发 `usage.read`；display name 只在 Header 原地编辑，password 是带 hover/focus tooltip 的常驻 Header icon，低频 security action 收入按需 Header popover。Codex 配置 offer 只经 App-level bubble 进入 `select existing API Key → file list → lazy safe detail → exact consent → result` 闭环。产品页禁止自动创建专用 Key。
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

## Scenario: Bundled managed engines without runtime download or elevation

### 1. Scope / Trigger

- Trigger：修改 `AccountAppGate.prepare`、bundled engine manifest/resolver、Codex/Claude binary discovery/launch、Windows account configuration commit 或 NSIS install mode。
- 目标：active entitlement/paid checkout 后形成 `inspect bundle → detect/compare external → resolve source → verify → managed prepare → activate` 的单一闭环；普通用户无需联网下载 CLI或理解 PATH/管理员权限。

### 2. Signatures

- Native facade：`account_engine_v1_toolchain(engine_id, choice?) -> { status, bundledVersion, externalVersion, selectedSource }`；closed `choice` 只允许 `bundled | external`。
- Native activation：`account_engine_v1_activate(engine_id) -> Result<(), String>`；closed `engine_id` 只允许 `codex | claude-code`。renderer 通过 `activateAccountEngineV1(engineId)` 调用，payload 只含 camelCase `engineId`。
- Build manifest：pinned official URL、version、target/arch、SHA-256、relative executable；generated runtime manifest 不含下载 URL。
- Account mutation 保持 `account_engine_v1_prepare(engine_id, operation_id)`；toolchain resolution 不进入 Authority receipt、secret scope 或 account SQLite。

### 3. Contracts

- official artifact 只在 build 期下载；用户运行期零 engine download/install side effect。checksum/version/expected executable 任一不匹配即 build fail closed。
- 最终 build stage 必须位于 generated output 同一 parent volume，再用 atomic rename commit；Windows runner 常见 `TEMP=C:`、workspace=`D:`，禁止从 OS temp 直接 rename 到 workspace。
- 无 external 时选 bundled；external version `>= bundled` 时静默选 external；external `< bundled` 时要求一次 closed choice。bundled choice 不得覆盖/卸载 external；external choice必须通过 protocol verifier。
- renderer 不接收 executable absolute path、archive URL、command preview、stdout/stderr；只接收 closed status/source/version。版本选择 generation 失效后不得 prepare/activate stale target。
- `account_engine_v1_toolchain` 通过 manifest/path/`--version` verification 后，才可将 selected binary 写入当前进程 `AccountRuntime.managed_engine_binaries`。`account_engine_v1_activate` 必须只读取同一 closed engine id 的该 mapping，重新调用 `EngineManager::refresh_engine_status_for_binary`，成功后调用 `set_active_engine_after_account_toolchain_verification`；不得将 renderer 提供的路径写入 global config，也不得依赖可被后台 PATH/config detection 覆盖的 `engine_statuses` cache。
- Tauri `beforeDevCommand` 必须先执行 `prepare:bundled-engines`。debug `resource_dir/bundled-engines/current` 必须是 prepared source 的 independent real tree；不得使用指向 source 的 symlink。Tauri 后续 resources copy 会跟随 symlink，将 source/destination 解析为同一文件并截断 bundled manifest/binaries。空或非法 runtime manifest 必须阻断 frontend/native startup。
- Codex bundled sibling resources/PATH 必须随 launch 保留；Claude 使用 standalone executable。managed session 使用 resolver path，manual/local engine path 保持原行为。
- Claude selected binary MUST 只写 `ClaudeSessionManager.provider_configs["doge-token-matrix"]`；禁止写 `EngineManager.engine_configs[Claude]` 或覆盖 `default_config`。普通 turn、manual compact 与 provider continuation 都通过 provider-scoped session 取得该 path；daemon send/compact 对 account provider fail closed。
- Windows configuration existing target 必须在 recovery journal 管理下 staged replace + verify；access denied、sharing violation、unsafe target、rollback incomplete 分开映射。NSIS 明确 `installMode=currentUser`。
- installer timeout/取消必须终止完整 process tree；Windows wrapper child 不得在 gate 已失败后继续写文件。

### 4. Validation Matrix

| 场景 | 结果 |
|---|---|
| external Codex 缺失 | 选择 bundled，verify 后继续 prepare；零网络 |
| external Claude 与 bundled 同版 | 静默选择 external |
| external Codex 高于 bundled | 静默选择 external，不降级 |
| external Claude 低于 bundled | 一次二选一；bundled 不覆盖 external |
| bundled Claude selected、local Claude 已配置 | account provider 使用 bundled；local/manual provider 继续使用用户 path |
| remembered 版本组合不变 | 不重复提示 |
| bundled checksum/version/文件不符 | build fail closed，不产出安装包 |
| dev source 缺失、manifest 为空或非法 | `prepare:bundled-engines` 失败并阻断 Vite/Tauri 启动 |
| legacy debug resource 为 source symlink | 启动前替换为 independent copied tree，source 保持完整 |
| toolchain 已验证、global Codex/Claude cache 后续变为 unavailable | `account_engine_v1_activate` 仍可设置 active engine；无 verified mapping 的普通 switch 保持 installed check |
| Windows temp/workspace 跨卷 | stage 位于 output sibling，same-volume rename 成功且不残留 partial output |
| Windows 已有 `.doge/config.json` | 普通用户 staged replacement成功；不需管理员 |
| Windows target 被锁/ACL拒绝 | typed recoverable failure；保留 journal，不假 ready |
| install 成功但 flow generation 已失效 | 不 prepare、不 activate stale engine |

### 5. Tests Required

- React orchestration：missing external auto bundled、same/newer external silent reuse、older choice/remember、verifier failure、stale generation/cancel。
- Rust resolver：manifest/target/arch validation、semver compare、closed choice、selected managed launch path、Codex sibling PATH、absolute path non-disclosure。
- Rust Claude manager/daemon：provider override 与 local default 隔离；只清 account-provider sessions；daemon send/compact 均拒绝 `doge-token-matrix`。
- Build script：pinned URL/checksum、cache corruption recovery、archive traversal/expected executable、same-volume output stage、macOS nested signing order、Windows resource inclusion。
- Rust configuration：Windows replacement helper contract、write/verify/rollback、error classifier；Windows CI 使用 standard-user account执行 focused test。
- Packaging：tauri Windows config/produced installer证明 `currentUser`，普通双击安装/启动后完成 Codex/Claude prepare；管理员运行不作为验收证据。
- Dev resources：`scripts/tauri-dev-resources.test.mjs` MUST 覆盖 full tree staging、stale replacement、legacy symlink replacement、missing/invalid manifest rejection；在 macOS debug tree 运行 Codex/Claude `--version` 作为 actual binary evidence。
- Activation boundary：`src/services/tauri/accountEngine.test.ts` MUST 锁定 `account_engine_v1_activate` + `{ engineId }`；`src/services/accountEngineActivation.test.ts` MUST 锁定 AccountGate 使用 account-scoped command；`EngineManager` Rust test MUST 证明 verified activation ignores unavailable global status。

### 6. Good / Base / Bad Cases

- Good：`beforeDevCommand -> prepare:bundled-engines -> tauri-dev-resources` 形成 independent debug tree；toolchain verified mapping 后，`account_engine_v1_activate("codex")` 复验 binary 并设置 active engine。
- Base：global detection 把用户 PATH 的 Codex 标记 unavailable；未进入 account gate 的普通 `switch_engine` 仍拒绝该 engine。
- Bad：debug staging 使用 `symlink(source, destination)`；Tauri resource copy 将 bundled manifest 和 binaries 写成 0 byte。
- Bad：renderer 调用 generic `switch_engine` 来完成账号激活；全局 `engine_statuses` cache 可覆盖 toolchain verification 结果。

### 7. Wrong vs Correct

#### Wrong

```ts
await switchEngine(engineId === "claude-code" ? "claude" : "codex");
```

#### Correct

```ts
await invoke("account_engine_v1_activate", { engineId });
```

Native command 只接受 closed engine id，并从本进程已经验证的 account mapping 取得 binary；renderer 永远不传递 executable path。

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

## Scenario: Subscription-owned usage projection and daily model heatmap

### 1. Scope / Trigger

- Trigger：修改 Account `usage.read`、额度页、Desktop engine entitlement mapping，或 token2api subscription/usage API adapter。
- 目标：额度必须来自用户当前 active subscription，而不是可为空的 user platform quota；每个已订阅 engine 独立展示额度与过去一年用量，日级 model 明细只在 hover/focus 时按需读取。

### 2. Signatures

- Gateway read：`usage.read({}) -> QuotaUsageViewV1`。
- Lazy read：`usage.readDayModels({ engineId: "codex" | "claude-code", date: "YYYY-MM-DD" }) -> UsageDayModelsViewV1`。
- Authority composition：
  - `GET /api/v1/desktop/v1/engines`：提供 active engine 的 `engine_id + subscription_id + group_id + subscription_label + expires_at`。
  - `GET /api/v1/subscriptions/progress`：提供 subscription `daily/weekly/monthly` 的 `limit_usd + used_usd + remaining_usd + percentage + resets_at`。
  - `GET /api/v1/usage/dashboard/snapshot-v2?group_id=<id>&start_date=<date>&end_date=<date>`：提供 group-scoped `trend[] + models[]`。
- Main native boundary 仍复用 `account_v1_execute`；新增 operation name 必须在 Rust `GATEWAY_OPERATIONS_V1`、TS IPC schema/transport、Real/Mock gateway 与 scenario manifest 同步登记。

### 3. Contracts

- `usage.read` MUST 先以 Desktop engine catalog 为 entitlement truth，只投影 `subscriptionId/groupId` 均有效的 active engine；不得从 renderer 猜测 engine→group 映射。
- 每个 engine MUST 独立关联同一 subscription id 的 progress，并投影 `windows.daily/weekly/monthly`；不存在的窗口用 `null`，不得用 0 伪造套餐额度。
- 年度 analytics MUST 按 engine 的 `group_id` 分别读取，返回 `range + totals + days + models`；heatmap intensity 为该 engine 日 `actualCost` 的相对 0..4 等级，不得跨 engine 混算。
- 某个 engine dashboard 失败时，该 engine `analyticsStatus="unavailable"`，其他 engine 与已读取额度仍可显示；catalog/progress top-level 失败才使 `usage.read` 失败。
- `usage.readDayModels` MUST 在 Native 重新读取 catalog 并验证请求 engine 当前仍有 active group，date 必须为过去 365 天内的 ISO date；禁止信任 renderer 传入 group id。
- day-model response 只包含 `modelLabel + requests + input/output/cache/total tokens + cost + actualCost`，不得包含 API key、account id、group id、raw server error 或 credential。
- UI 首次进入 Account Center 不自动读取 usage；只有用户打开“额度”Tab或点击刷新才调用 `usage.read`。日级 model 明细只在 activity cell hover/focus 时调用一次并按 `engineId:date` 缓存；禁止轮询与 AppShell root state。
- Account Center Header MUST 是 usage refresh/fetched time 与 logout 的唯一 action owner：logout 常驻，refresh/fetched time 只在额度 Tab出现；两个 action 都使用有 accessible name 与 hover/focus tooltip 的 icon-only button。额度内容区与按需打开的 security popover不得重复同名 heading。
- active subscription engine MUST 使用 selectable card master/detail：一行最多 3 张，1/2/3 张等宽占满，更多自动换行，responsive 降为 2/1 列；card selection 只存在 component-local state，不得触发新的`usage.read`或写入持久化状态。card 摘要优先 daily，缺失时回退 weekly/monthly；detail 保留全部 available windows。
- heatmap cell MUST 可键盘 focus，tooltip宽度自适应且无固定高度；无 activity 的日期不发 day-model request。
- token2api 已有上述三类 read API 时，本场景只改 Doge adapter/contract/UI，不要求 token2api migration 或生产发布。

### 4. Validation & Error Matrix

| 场景 | Native/Gateway | UI |
|---|---|---|
| active subscription + platform quota 为空 | 以 subscription progress 成功投影 | 显示套餐总额/已用/剩余 |
| Codex + Claude 均 active | 按各自 group 独立 snapshot | 两张 engine card，可独立切换 |
| 某 engine snapshot 失败 | 仅该 engine analytics unavailable | 额度窗口保留，其他 engine 热力图正常 |
| progress endpoint失败/畸形 | safe `serviceUnavailable/protocolMismatch` | 可重试，不展示伪造额度 |
| renderer提交 unknown engine/group/date | boundary `validationRejected` | 不发 Authority request |
| hover同一 engine/date 多次 | controller in-flight dedupe + cache | 最多一个请求，复用 model 明细 |
| logout/refresh session | 清 day-model cache 与 generation | 旧响应不得写回新账号 |

### 5. Good / Base / Bad Cases

- Good：catalog 给出 Codex group 11、Claude group 22；Native 分别读取两个 snapshot，UI选择 engine 后只展示该 engine 的窗口与热力图。
- Base：套餐只有 monthly window，UI只渲染 monthly card；daily/weekly保持`null`。
- Bad：继续读取`/api/v1/user/platform-quotas`并因null显示“暂时无法读取额度”。
- Bad：renderer传`groupId`给Native，或一次性为365天逐日加载model明细。
- Bad：一个 engine analytics失败后清空全部 subscription progress。

### 6. Tests Required

- Rust Authority test：断言 progress path、group-scoped snapshot query 与 Bearer envelope；projection test锁定 canonical decimal、windows、365-day trend。
- Rust IPC/model test：`usage.readDayModels` 为read operation，exact payload仅允许`engineId/date`，invalid/未来/超范围date fail closed。
- TS contract test：operation inventory、request/result schema、unknown field、privacy scan、Real/Mock transport mapping。
- React regression：打开额度Tab前零read；Codex/Claude切换；active cell hover分别发送各自`engineId/date`；重复hover不重复读取；partial analytics failure保留额度。
- React visual/interaction regression：authenticated Account 仅有 `subscription/usage` Tab；subscription 首次渲染不调用 `usage.read`；Header logout/refresh icon-only 且 tooltip 可由 hover/focus 打开；Header display name edit、password/security popover 可达；refresh pending 防重复提交；额度内容区无重复 heading；多订阅 grid 锁定最多3列与 responsive 2/1列；card切换不增加`usage.read`调用。
- Required commands：focused Vitest、`cargo test --manifest-path src-tauri/Cargo.toml account:: --lib`、`npm run typecheck`、`npm run lint`、`npm run check:runtime-contracts`。

### 7. Wrong vs Correct

#### Wrong

```ts
const quota = await fetch("/api/v1/user/platform-quotas");
if (!quota.limit) return unavailableUsage();
```

#### Correct

```ts
const view = await gateway.usage.read({});
// Native composes active engine catalog + subscription progress + group snapshots.
await gateway.usage.readDayModels({ engineId, date }, {}); // hover/focus only
```

## Scenario: Lightweight subscription facts and prepared managed Home defaults

### 1. Scope / Trigger

- Trigger：修改 `subscription.read`、Account subscription surface、Sidebar account shortcut、`AccountAppGate` preparation，或 Home/create-session 的 managed provider target。
- 目标：以一次轻量 authority read 展示每个订阅的套餐事实；只有真正完成 prepare 的 Codex/Claude 新会话才能使用 `doge-token-matrix`，provider-scoped catalog 不可用时必须 fail closed。

### 2. Signatures

- Gateway read：`subscription.read({ signal? }) -> AccountSubscriptionSummaryViewV1`；对应 Rust `GatewayOperationV1::SubscriptionRead`，是 read operation。
- Authority composition：`GET /api/v1/subscriptions/summary` 加现有 `GET /api/v1/desktop/v1/engines`；禁止读取 `usage/dashboard`、日趋势或 model analytics。
- Preparation snapshot：`readManagedEnginePreparationV1() -> Record<"codex" | "claude-code", "prepared" | "unprepared" | "unknown">`；唯一 managed profile 为 `MANAGED_PROVIDER_PROFILE_ID_V1 = "doge-token-matrix"`。
- Create resolver：`resolveDefaultCreationExecutionTarget({ enabled, selectedEngine, selectedModelId, providerProfileId, providerCatalogAvailable, models }) -> ExecutionTarget | null`。

### 3. Contracts

- Native 必须以 desktop engine catalog 的 active `subscriptionId + groupId` 做 attribution。每个 summary identity 独立投影套餐 label、available daily/weekly/monthly windows 与 expiry；无法可靠匹配的套餐保留事实但 `engineId = null`，禁止以名称猜 Codex/Claude。
- Account subscription surface 可在 mounted 时读取一次；Sidebar shortcut 必须 `autoLoad: false`，仅在用户打开后发起一次 pull。两者都不得用 `usage.read` 替代 summary，也不得轮询、写入 AppShell root state 或暴露 authority raw error/account/group/credential。
- 只有 account `prepare`、engine activation 与 `doge-token-matrix` provider activation 全部成功，才可把 active entitlement 标记为 `prepared`。重新 prepare、sign-out、inactive entitlement 或失败必须清除该状态；active entitlement 本身不能推断为 prepared。
- Home/new-session 在没有 explicit provider 时，可为 prepared Codex/Claude 使用 managed profile，并必须等待同 profile catalog。managed resolver 只能消费 `providerProfileId === "doge-token-matrix"` 的 catalog rows；missing/empty/failed catalog 返回 `null` target 并禁发，禁止把 global/disk model 或旧 Key 冒充 managed target。
- Existing thread binding、Local Mode、signed-out、inactive/unprepared engine，以及 explicit local/disk/manual target 均优先于 implicit managed default，且不得被该 flow 改写。

### 4. Validation & Error Matrix

| 场景 | Summary 行为 | Home/new-session 行为 |
|---|---|---|
| active Codex/Claude subscription | 投影 stable subscription identity、套餐/窗口/expiry | prepare 成功后可请求 managed catalog |
| multiple/unmapped subscriptions | 分卡保留；unmapped 无 `engineId` | 不猜测或注入 managed default |
| summary authority/vault/session 不可用 | typed unavailable，无伪造额度 | 不影响 existing/local session |
| prepared + managed catalog available | n/a | 只用同 profile catalog row 创建 target |
| prepared + catalog pending/failed | n/a | target 为 `null`、禁发，绝不回退 local |
| explicit local/manual 或 existing thread | n/a | 用户/会话选择保持原样 |

### 5. Good / Base / Bad Cases

- Good：Sidebar 打开后调用一次 `gateway.subscription.read`；Codex prepare 完成后 Home catalog row 带 `providerProfileId: "doge-token-matrix"`，创建 target 也带相同 identity。
- Base：Account Center 只显示 authority 提供的 monthly window；daily/weekly 为 `null`，不显示假 0。
- Bad：只因 entitlement 为 active 就标记 prepared，或 catalog 加载失败后用 disk/global `models[0]` 创建 managed session。
- Bad：把 subscription summary 接到 365-day dashboard、root polling 或 Sidebar mount prefetch。

### 6. Tests Required

- Rust：`SubscriptionRead` 在 inventory 中为 read，operation count 与 canonical TS inventory 同步；authority/projection 覆盖 active、multiple、unmapped、unavailable。
- React：`AccountSubscriptionPanel` 覆盖套餐/窗口/expiry 与多卡；`AccountSidebarShortcut` 覆盖 user-open 后才读取和 Settings handoff；summary hook 覆盖 abort/generation stale guard。
- Composer/catalog：覆盖 prepared managed target、pending catalog 禁发、explicit local 可发送，以及 fallback profile resolver 不把 managed 标为本地。
- Gates：focused Vitest、`cargo test --manifest-path src-tauri/Cargo.toml account:: --lib`、`npm run typecheck`、`npm run lint`、`npm run check:runtime-contracts`、strict OpenSpec validation。

### 7. Wrong vs Correct

#### Wrong

```ts
const providerProfileId = entitlement.status === "active" ? "doge-token-matrix" : null;
const target = resolveDefaultCreationExecutionTarget({
  providerProfileId,
  models: globalModels,
  // catalog failure silently falls back to a local row
});
```

#### Correct

```ts
const providerProfileId = preparation[managedEngineId] === "prepared"
  ? MANAGED_PROVIDER_PROFILE_ID_V1
  : null;
const target = resolveDefaultCreationExecutionTarget({
  providerProfileId,
  providerCatalogAvailable: models.some(
    (model) => model.providerProfileId === providerProfileId,
  ),
  models,
  // null target keeps submit disabled until the managed catalog is trustworthy
});
```

## Scenario: Shared managed session quota projection

### 1. Scope / Trigger

- Trigger：修改 `useSessionQuotaList`、`managedAccountQuota`、Shared Session quota target 或 Composer 的 `SessionControlQuotaPane`。
- 目标：Shared 的 Token Matrix managed Codex/Claude target 复用现有 credential-free `usage.read` projection，不能误走 local CLI credentials，也不能为没有 managed target 的会话产生 Account authority read。

### 2. Signatures

- Managed adapter：`loadManagedAccountQuotaSnapshots(targets: SessionQuotaTarget[]) -> ManagedAccountQuotaResult[]`。
- Managed identity：`providerProfileId === "doge-token-matrix"` 且 engine 为 `codex | claude`。
- Renderer snapshot：`CodingPlanQuotaSnapshot`，source 为 `token_matrix | token_matrix_not_subscribed`；不得包含 credential、account id、group id、raw server error。

### 3. Contracts

- 每次 refresh 必须先按 managed identity 切分 target。存在一个或多个 managed target 时，整个 managed group 只调用一次 `usage.read({})`；没有 managed target 时调用次数必须为零。
- Managed group 的 authority read 与 non-managed `getCodingPlanQuota(engine, providerProfileId)` 可以并行；各 target 的 loading/error/snapshot 仍按 `engine + providerProfileId` 独立投影，返回 UI 时必须保持调用方 target 顺序。
- authority 返回 active subscription 时，managed target 必须投影 Token Matrix、套餐 label、daily/weekly/monthly window、used/limit/reset 和 credential-free totals；不得把 `empty` 或 `empty_credentials` 展示为 provider label。
- authority 明确缺少该 engine entitlement 时，必须返回 `token_matrix_not_subscribed`；authority 暂不可用或 adapter reject 时只返回固定 safe message `Token Matrix 额度暂时不可用，请稍后重试`，不得将 raw exception/server response 暴露到 renderer。
- Local Mode 与所有 non-managed provider 必须保留既有 `getCodingPlanQuota` path；打开 Account Center subscription Tab 不得因本场景产生 `usage.read`。

### 4. Validation & Error Matrix

| 场景 | Authority / provider reads | Shared panel |
|---|---|---|
| Codex + Claude 均为 managed | 一次 `usage.read({})`，无 local CLI quota read | 每项独立显示对应套餐或未订阅状态 |
| 仅 local / non-managed target | 零 `usage.read`，逐 target 调 `getCodingPlanQuota` | 保留原有额度投影 |
| mixed managed + local target | 一次 authority read 与 local reads 并行 | target 顺序稳定，任何单项失败不清空其他项 |
| managed authority reject | 固定 safe error snapshot | 可重试错误，不泄露 exception 文本 |

### 5. Tests Required

- `managedAccountQuota.test.ts` 覆盖 Codex/Claude mapping、not subscribed 与一个 managed group 仅一次 `usage.read`。
- `useSessionQuotaList.test.tsx` 覆盖 mixed target group、零 managed target 零 authority read、stable ordering 和 safe error projection。
- `SessionControlQuotaPane.test.tsx` / `sessionOverviewViewModel.test.ts` 继续覆盖 loading、Token Matrix、plan/window 和 provider label 不为 `empty`。
- Required commands：focused Vitest、`npm run typecheck`、`npm run lint`、`npm run check:runtime-contracts`。

## Scenario: Cold restore OS vault access budget

### 1. Scope / Trigger

- Trigger：修改 `gateway.bootstrap`、`try_restore_session`、access-token refresh、`activate_auth` 或 `DurableAccountVault`。
- 目标：macOS Keychain authorization 是用户可见的高成本 side effect；启动恢复不得对同一 credential 做重复 status/read，同时必须保留 refresh rotation durability。

### 2. Signatures

- `bootstrap(state) -> bootstrap projection`：每次调用最多求值一次 `vault.status()`。
- `activate_auth(state, auth, existing_scope, previous_refresh)`：已有 session 的 caller MUST 传入刚读取的 previous refresh snapshot；新 login/OAuth MAY 传 `None` 并由 activation 读取 rollback baseline。

### 3. Contracts

- active-session cold restore MUST 对 refresh credential 执行 exactly one `vault.read()`；同一值同时用于 Authority refresh 与 local rollback snapshot。
- bootstrap restore gate 与最终 projection MUST 复用同一个 `AccountVaultStatus`，禁止重复 `vault.status()`。
- rotated refresh MUST 写回 OS vault；不得为了减少提示保留旧 refresh 或退化为 memory-only session。
- repository commit 失败时 MUST 使用 snapshot 恢复旧 refresh；snapshot 不得进入 renderer、SQLite、log 或 error message。
- vault locked/unavailable 继续 fail closed。该 contract 约束 Doge access count，不承诺 ad-hoc signature 下 macOS 永不显示必要的 read/write authorization。

### 4. Validation & Error Matrix

| 场景 | Vault access | 结果 |
|---|---|---|
| signed-out bootstrap | `status=1`，无 refresh read/write | 登录页；不访问不存在的 session credential |
| active cold restore success | `status=1, read=1, write=1` | rotated refresh durable，session restored |
| Authority refresh failure | `status=1, read=1, write=0` | 保留旧 credential，可重试 |
| repository commit failure | `status=1, read=1, write new + rollback old` | 不留下半提交 session |
| vault locked/unavailable | `status=1`，不发 Authority refresh | safe `vaultUnavailable` / recoverable gate |

### 5. Tests Required

- Counting vault regression MUST 锁定 cold restore `status_calls == 1` 与 refresh-purpose `read_calls == 1`。
- Activation regression MUST 证明 caller 提供 snapshot 时不再次 read，且 repository failure 仍写回旧 snapshot。
- Required commands：`cargo test --manifest-path src-tauri/Cargo.toml account:: --lib`、`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`、`npm run check:runtime-contracts`、OpenSpec strict validation。

## Scenario: macOS debug non-interactive development vault

### 1. Scope / Trigger

- Trigger：修改 `src-tauri/src/account/vault.rs`、`AccountRuntime::load(data_dir)`、macOS hot-development command、debug/release credential selection 或 Account/Kimi managed credential persistence。
- 目标：日常 `npm run tauri:dev:hot` 可由无人值守 E2E Agent 启动，不因 ad-hoc signature 触发 Keychain 密码授权；该便利不得进入 Release。

### 2. Signatures

- Shared owner：`DurableAccountVault::{status,read,write,delete}`。
- Compile-time selector：`account_vault_for_data_dir(data_dir: &Path) -> Arc<dyn DurableAccountVault>`。
- macOS debug backend：`DevelopmentFileAccountVault`，固定 path=`<app_data>/debug-account-vault/credentials.json`。
- Release/other backend：`OsAccountVault(service="com.doge.account")`。
- Persisted schema exact fields：`{ "version": 1, "entries": Record<allowlistedPurpose, secret> }`；max file `1 MiB`、max entries `128`、single secret max `64 KiB`。

### 3. Contracts

- 仅 `cfg(all(debug_assertions, target_os = "macos"))` 返回 file backend；selector 不读取 env、renderer flag、localStorage 或 persisted setting。所有其他 compile target 返回 `OsAccountVault`。
- debug backend MUST NOT read/migrate/fallback to Keychain。旧 credential 只在 Keychain 时按 signed-out 处理；用户完成一次正常 debug login 后，refresh session 与 `managed-engine:{codex|claude-code|kimi}:<scope>` 均写入 file backend。
- purpose MUST 复用与 OS vault 完全相同的 allowlist + scope validator，禁止 file backend 扩大 key alphabet。
- dedicated directory MUST 是 regular directory、mode `0700`；credential target MUST 是 regular file、mode `0600`。directory/file symlink、non-regular target、oversize、unknown schema/field/purpose、empty/oversize secret MUST fail closed，且不得转去 Keychain。
- mutation MUST `ensure safe directory -> with_storage_lock(target) -> parse bounded document -> same-directory create_new temp(0600) -> write -> fsync -> recheck target -> atomic rename -> target chmod(0600) -> directory fsync`。失败清理 exact temporary；error/log 禁止包含 secret、serialized payload、purpose-derived private fact 或完整 path。
- debug file 是 repo-external development artifact，不进入 IPC、SQLite、diagnostics、backup、git 或 Release migration。Release binary 即使看到该文件也不得读取。

### 4. Validation & Error Matrix

| 场景 | Selected backend / result | Keychain side effect |
|---|---|---|
| macOS debug + file missing | create owner-only directory；status ready；signed out until login | zero |
| macOS debug + valid file | exact purpose round-trip / cold restore | zero |
| file mode `0644` | read/write 前收紧到 `0600` | zero |
| directory/file symlink or non-regular | `Unavailable` / stable safe `Err`；target unchanged | zero |
| corrupt/oversize/unknown schema or purpose | fail closed；不得覆盖 | zero |
| macOS Release / Linux / Windows | `OsAccountVault` | 按对应 OS vault contract |
| only Keychain has prior debug credential | debug signed out；不迁移 | zero |

### 5. Good / Base / Bad Cases

- Good：开发者首次登录一次，后续 standard hot rebuild 复用 app-data debug vault；Agent 可无人值守完成 Account/Kimi E2E。
- Base：debug file 不存在；selector 只创建 `0700` directory，不尝试探测 Keychain。
- Bad：debug file read miss 后调用 `OsAccountVault.read()`；仍可能弹授权，破坏无人值守目标。
- Bad：通过 env/runtime setting 让 Release 使用 plaintext file，或把 credential 写入 `config.json` / repo `.env`。
- Bad：先以默认 umask 写出 `0644` temp，再 chmod；secret 在 commit 前已出现 group/world-readable window。

### 6. Tests Required

- macOS debug focused test MUST 覆盖：selector 实际生成 debug file（证明无 platform entry call）、status/read/write/delete round-trip、directory `0700`、temp/final `0600`、existing permissive mode hardening。
- corruption/safety test MUST 覆盖 malformed JSON、unknown purpose/schema、oversize input、file symlink 与 directory symlink；断言外部 target byte-for-byte unchanged，且错误不含 secret/path。
- compile surface MUST 运行 debug `cargo check --lib`；Release selector 至少运行 `cargo check --release --lib` 或对应 macOS Release CI compile。
- manual smoke MUST 用 exact `npm run tauri:dev:hot` 做冷启动 + restart，观察零 Keychain authorization，并在首次 debug login 后验证 session/managed credential 恢复。

### 7. Wrong vs Correct

#### Wrong

```rust
let secret = file_vault.read(purpose)?
    .or_else(|| OsAccountVault.read(purpose).ok().flatten());
std::fs::write(path, serde_json::to_vec(&secret)?)?;
```

#### Correct

```rust
let vault = account_vault_for_data_dir(data_dir); // compile-time platform/build decision
with_storage_lock(&credential_path, || {
    secure_same_directory_atomic_write(&credential_path, 0o600, serialized)
})?;
```

file backend 与 OS backend 是互斥 owner；调用方只依赖同一 `DurableAccountVault` contract，不能表达 runtime fallback。

## Scenario: Product paid fulfillment reconciliation and Kimi registry verification

### 1. Scope / Trigger

- Trigger：修改 `ProductAccountAppGate`、product checkout checkpoint、product catalog cache、`AccountRuntime::product_prepare`、Kimi managed provider merge 或 `verify_applied_plan`。
- 目标：支付订单先进入 `paid`、Composite subscription 后置生效时，App 必须等待权威 entitlement 并自动继续 prepare；Kimi JSON registry 必须按自身 schema 验证，不能误走 Codex TOML verifier。

### 2. Signatures

- Frontend state machine：`auth -> catalog -> subscription | checkout -> fulfilling -> prepare -> ready`。
- Catalog read：`AccountProductOnboardingClientV1.catalog({ forceRefresh?: boolean })`；`forceRefresh=true` MUST bypass process cache。
- Native checkpoint：`product_checkout_checkpoint(status, expires_at, updated_at) -> Option<(status, expires_at)>`；`paid` 投影为 credential-free `processing` checkpoint，expiry 至少为 `updated_at + PRODUCT_FULFILLMENT_GRACE_SECONDS`。
- Kimi registry target：`~/.doge/config.json#/kimi/providers/doge-token-matrix`，owner fields 为 `source="doge-account"`、`baseUrl="https://token-matrix.com/v1"`、`providerType="openai"`，且 `/kimi/current="doge-token-matrix"`。
- Kimi verifier：`verify_applied_plan(plan)` 的 `file.label == "Doge Kimi provider registry"` 分支 MUST 使用 `serde_json::from_str`；只有其他 Codex TOML target 才使用 `toml::from_str`。

### 3. Contracts

- checkout snapshot 为 `paid` 时，Gate MUST 进入 visible `fulfilling`，以 bounded backoff 反复调用 `catalog({ forceRefresh:true })`；entitlement 未 active 不得退回订阅页、创建第二笔订单或使用旧 cache。
- same-session paid 与 restart 恢复的 paid checkout MUST 共用同一 fulfillment path。Native checkpoint 只能保存 checkout id/status/expiry/isolation tuple；不得保存 plan 文案、payment action、secret 或 entitlement truth。
- fulfillment 达到 bounded deadline、catalog fail 或 prepare fail 时，Gate MUST 保留 fulfillment recovery surface 与明确 retry；retry 继续权威 reconciliation，不得隐式重新 checkout。
- entitlement active 后 `product_prepare` MUST 对 Codex、Claude、Kimi 逐引擎写入同一个 account/device scoped secret owner，再应用各自 provider config；全部配置、model catalog 与 ready projection成功后才清 product checkpoint。
- Kimi managed merge MUST replace entire `doge-token-matrix` provider entry，并移除大小写/分隔符归一化后等价于 `apiKey`、`token`、`secret` 的 legacy secret fields。`config.json` 不得持久化 secret；launch-only owner `KIMI_CODE_HOME/config.toml` 可由 Native 从 vault 生成 owner-only `api_key`。
- Kimi verification MUST 校验 current/source/base URL/provider type、content fingerprint 与 secret absence。任一不符必须 rollback/fail closed；禁止因为 JSON target 不可被 TOML parse 而把正确配置永久回滚。
- Product-ready Home target MUST 先由 `resolveProductManagedExecutionTargetV1` 归一，再执行 `isResolvedExecutionTarget` guard。Kimi display catalog id `kimi-code/<model>` 可保留为 `modelCatalogEntryId`，但 runtime `model` MUST 去除该 namespace；实际 send 禁止回退全局 `selectedModelId`。

### 4. Validation & Error Matrix

| 场景 | Native / Gateway | Gate / Runtime |
|---|---|---|
| order `paid`，subscription 尚未 active | 保存 grace checkpoint；forced catalog 返回 inactive | 保持 `fulfilling`，bounded backoff |
| entitlement 在 backoff 内 active | prepare 三引擎；成功后清 checkpoint | 自动进入 AppShell |
| restart 时 paid checkpoint 存在 | authoritative order read；恢复 paid truth | 直接进入 `fulfilling`，不回套餐 |
| fulfillment deadline 到达 | checkpoint 保留到 server grace expiry | 显示 delayed + retry，不重复购买 |
| Kimi registry 含 legacy `api_key` | managed merge 删除 secret field | JSON verifier通过；secret只在 vault/runtime home |
| Kimi current/baseUrl/providerType 漂移 | verifier reject + transaction rollback | `productPrepare` typed retry failure |
| Kimi JSON 被 Codex TOML verifier处理 | 禁止；regression test必须失败定位 | 不得把正确 JSON 回滚 |

### 5. Good / Base / Bad Cases

- Good：payment poll 先读到 `paid`，两次 forced catalog 后 subscription active，三引擎 prepare 完成并自动进入 AppShell；checkpoint 随成功清除。
- Base：首次 catalog 已有 active entitlement，跳过 checkout/fulfillment 并直接 prepare。
- Bad：`paid -> loadCatalog()` 命中 30 秒 cache，看到 inactive 后 `setPhase("subscription")`，让用户以为需要再次购买。
- Bad：paid checkpoint 立即清除，App restart 丢失“已经付款、等待履约”的真实状态。
- Bad：Kimi JSON registry 落到 default TOML branch，或 merge 只覆盖非 secret 字段而保留旧 `apiKey`。

### 6. Tests Required

- React lifecycle MUST 使用 deferred catalog 证明：paid 后进入 `fulfilling`、每次 read 都带 `forceRefresh:true`、inactive 不出现订阅 CTA、active 后只 prepare 一次并 ready、stale generation 不推进。
- React visual contract MUST 锁定 product stylesheet owner、structured plan card（plan/price/validity/engine/feature/CTA）与 bounded logo；narrow CSS breakpoint 不得把字段拼成一行。
- Rust checkout tests MUST 锁定 `paid -> processing` grace checkpoint、restart read 与 prepare success cleanup；secret scan断言 checkpoint无 payment/plan/credential字段。
- Rust configuration tests MUST 构造 legacy Kimi secret aliases，断言 merge 后 serialized JSON 不含 secret，并直接调用 `verify_applied_plan` 证明 Kimi-specific JSON branch成功；current/base URL/provider type 漂移分别 fail closed。
- Required commands：focused Vitest、`cargo test --manifest-path src-tauri/Cargo.toml --lib account::`、`cargo check --manifest-path src-tauri/Cargo.toml --lib`、`npm run typecheck`、target ESLint、`npm run check:runtime-contracts`、OpenSpec strict validation。

### 7. Wrong vs Correct

#### Wrong

```ts
if (checkout.status === "paid") {
  await loadCatalog(); // may reuse inactive cache
  setPhase("subscription");
}
```

```rust
// Kimi JSON falls through to Codex TOML verification.
let parsed: toml::Value = toml::from_str(&content)?;
```

#### Correct

```ts
setPhase("fulfilling");
const catalog = await client.catalog({ forceRefresh: true });
if (catalog.entitlement.status === "active") await prepare(generation);
```

```rust
if file.label == "Doge Kimi provider registry" {
    let root: serde_json::Value = serde_json::from_str(&content)?;
    verify_kimi_owner_and_secret_absence(&root)?;
}
```

`paid` 只证明订单已支付，不等于 entitlement 已完成传播；Kimi provider registry 的文件格式由 target owner 决定，不能由 default verifier 猜测。

## Scenario: Dynamic product model catalog and real CLI compatibility evidence

### 1. Scope / Trigger

- Trigger：修改 product-ready Composer picker、`ProductEntitlementSnapshotV1`、`ExecutionTarget` repair、Claude/Codex/Kimi managed model projection，或宣称某个 product model 可由多个 CLI engine 使用。
- 目标：product catalog 是 entitlement ceiling；上游增删 conversation model 后 Doge 无需 model-id 发版即可 bounded refresh，同时不能拿 `/v1/models` 或最小 HTTP 200 冒充 Agent runtime compatibility。

### 2. Signatures

- Product picker mode：`ProviderTargetPickerMode = "product"`；catalog=`ProductTargetCatalogV1 { engines[], models[], modelsStatus, modelsUpdatedAt }`。
- Product panel：`ProductEngineModelSelect({ catalog, executionTarget, onExecutionTargetChange })`。
- Managed target：`providerProfileId="doge-token-matrix"`、`providerProfileSource="managed"`、`modelCatalogEntryId` 与 runtime `model` 分域。
- Managed display：`PRODUCT_MANAGED_PROVIDER_LABEL = "Doge"`；内部 stable id 仍为 `doge-token-matrix`。`account_product_v1_prepare` 每次均以同一 stable id 幂等覆盖 Codex/Claude/Kimi registry 的 `name="Doge"`，因此旧本机显示名在下次 authenticated prepare 时迁移。
- Claude product projection：`project_claude_model_for_managed_product(provider_profile_id, requested_model, provider_env)`；projection 只作用于 managed product profile 的 child turn。
- Native model wire：`ProductModelWire { id, display_name?, model?, compatible_engines?, capabilities? }`；renderer view=`{ id, display_name, model, compatible_engines, capabilities }`。
- Read-only refresh command：`account_product_v1_models() -> { ok, value: { models[], fetched_at } }`；必须限制 main window、读取当前 account scope 的 managed key、网络请求前释放 account state lock。
- Frontend refresh owner：`refreshProductModelsV1({ force? })`；30s freshness、same-subscription single in-flight、last-known-good、focus/visibility + 60s visible fallback。
- Product toolchain owner：`prepareProductEngineProvisioningV1({ onEngine? })`；Codex/Claude Code 复用 `account_engine_v1_toolchain`，Kimi 复用 `cli_version_status / cli_install_plan / cli_install_run`。
- Compatibility evidence：`engine × product model × real CLI payload`，至少覆盖 Codex Responses Agent payload、Claude Code Messages payload、Kimi stream-json Chat payload。

### 3. Contracts

- Home create-session、Shared Next Turn、Existing Native Session 的修改入口与 Account Center MUST 从同一个 refreshable product snapshot 读取 entitlement catalog，并复用同一个 compatibility helper 求 selected engine rows。product-ready 普通会话不得回落 legacy `ModelSelect` 的 Grok/OpenCode/provider/channel UI。
- `ProductAccountAppGate.prepare` MUST 先完成 toolchain owner 再调用 `account_product_v1_prepare`。Codex/Claude `choiceRequired` 在产品自动准备中选择 bundled；Kimi 已安装时不得重装/升级，缺失时必须 plan.canRun + installer.ok + version installed 三段闭环。任一失败不得写 provider config 或进入 ready。
- Native MUST preserve upstream order and separate catalog `id`、user `display_name`、callable `model`。`model/runtime_model` 缺失时回退公开 `id`；禁止从 display name 或 admin-only account mapping 猜调用名。
- `compatible_engines` 缺失时使用 stable family fallback：GPT/OpenAI→Codex、Claude/Anthropic→Claude Code、Kimi/Moonshot/K3→Kimi CLI、豆包/Ark Coding→三种 managed adapter；unknown family fail closed。显式空/unknown-only集合时 row 不可选。`capabilities` 有 positive conversation value 时优先；image/audio/realtime/embedding-only row必须过滤，legacy catalog用 bounded negative heuristic。
- 目录刷新 pending/error MUST 保留 last-known-good；成功刷新删除当前 model 时，在下一次发送前按同一 target repair contract 原子收敛。
- 切换 engine 时 current model 兼容则保留；否则必须与 engine 一起原子切换为 upstream order 中第一个 compatible model。空交集 fail closed；切换 model 不得改变 engine。
- Product surface MUST 隐藏 provider/channel/configuration/add-model controls；local/expert provider catalog owner 在 `mode="product"` MUST disabled，不发 profile/model prefetch。
- Existing Native Session 的 engine/provider binding 保持 immutable；product panel 只展示 Codex/Claude/Kimi，选择结果固定生成 `doge-token-matrix` target；跨 engine/provider 继续走 existing managed prepare + new-session/Provider Continuation，不得原地替换 Runtime owner。
- Product panel 底部不得常驻“订阅已生效/目录来源”说明；`ready` 时空间全部归模型列表，只有 `refreshing/stale` 才在 search 下方显示 transient status。
- Account billing 只显示真实 order facts；既然 upstream 无 invoice capability，UI MUST 完全不提发票或下载能力，而不只是隐藏 action。
- Account 可用模型 MUST 默认只展示 vendor label + model count；每个 vendor row 通过 button `aria-expanded/aria-controls` 按需 mount/unmount model detail list，再次点击收起。Doubao vendor/model identities（`豆包`、`doubao-*`、`ark-code-*`）MUST 统一解析到 `src/assets/model-icons/doubao.png`。所有 raster brand asset 必须经 `ProviderBrandIconImg` 渲染并提供 `16×16` intrinsic size、`max-width/max-height:100%` 与 `object-fit:contain`，禁止依赖 optional consumer stylesheet 限尺寸。
- UI selected target、readiness/accessibility projection、persisted `modelCatalogEntryId` 与 dispatched runtime `model` MUST 同源；不得出现 trigger 正确但 readiness/global model 仍旧的 split truth。
- Runtime/provider failure MUST 保留 exact selection 并 fail closed；禁止 silent engine/model/provider fallback。
- `/v1/models` 只证明 catalog entitlement；三种 endpoint 的 minimal 200 只证明 protocol adapter basic reachability。只有真实 CLI 发出的 system/tools/stream/client headers payload 完成 terminal response，才可标记对应组合 E2E ready。
- token2api production `allow_messages_dispatch`、`claude_code_only/fallback`、model routing/account pool 均是 Release prerequisites；Doge 不得通过伪造/隐藏 client identity 绕过 server policy。

### 4. Validation & Error Matrix

| 场景 | Doge 行为 | Release truth |
|---|---|---|
| product Home 打开 picker | 右侧 panel；3 engines 显示当前 compatible rows | UI + catalog contract |
| product-ready Native conversation 打开 picker | 与 Home 相同的右侧 panel，只显示 Codex/Claude/Kimi；选择固定 managed target | existing binding 仍走 continuation/new session |
| product model catalog ready | 不渲染固定 footer，模型列表占满剩余高度 | refreshing/stale 才显示 transient status |
| Account 可用模型 collapsed/expanded | collapsed 只显示 vendor + count；click/keyboard 展开真实 display names，再次操作收起 | 不把所有 model name 拼成截断单行 |
| billing 无 invoice capability | 只显示 order row，不出现 invoice/download copy | 不用 unsupported 提示暴露未提供功能 |
| 豆包 display/runtime alias | `豆包`、`doubao-*`、`ark-code-*` 使用同一本地 PNG | 不回退通用 Doubao SVG 或 engine icon |
| upstream 新增 `claude-opus-4-8` | bounded refresh 后进入同一 snapshot | 不修改 Doge exact-id manifest |
| refresh pending / failure | 保留 rows，显示 refreshing/stale + retry | 不清空 Composer / Account Center |
| fresh device 缺 Kimi | typed install + post-install version verify | 完成后才继续 provider prepare |
| Kimi 已安装 | 零 installer mutation | 直接继续 provider prepare |
| generic `/v1/messages` 为 200、Claude Code payload 400 | 保留 exact target typed failure并记录E2E阻塞 | NOT compatible；检查 client-sensitive routing |
| minimal Responses 200、Codex Agent 两分钟无首包 | 保留 exact target typed failure并记录E2E阻塞 | NOT compatible；检查 tools/stream/Agent payload |
| Kimi stream-json 返回 typed final | 正常 settle、runtime model evidence匹配 | compatible for that pair |
| GPT account pool 503 | 保留组合、typed retry | capacity unavailable，不标 E2E ready |

### 5. Good / Base / Bad Cases

- Good：production `/v1/models` 新增一个 valid text row 后，Native 保留 `display_name/model`，刷新 owner 一次发布给 panel、Composer 与 Account Center；选择与发送使用同一 target identity。
- Good：product-ready Native 会话打开与 Home 相同的 panel；点击 Kimi model 生成 `providerProfileId="doge-token-matrix"` 且由既有 continuation/new-session owner 执行。
- Base：三个 engine 共享 upstream entitlement catalog 与 helper；上游可用 `compatible_engines` 收窄 subset，不需要客户端列举 id。
- Base：Account vendor row 默认只显示数量，用户展开后才 mount 该 vendor 的 model list。
- Bad：因为 `/v1/messages` curl 返回 200，就宣称 Claude Code 支持该 model；真实 client headers 可能走另一 group/fallback policy。
- Bad：为获得 200 在 Doge 本地伪造非 Claude-Code User-Agent，绕过 token2api `ClaudeCodeOnly` policy。
- Bad：某组合失败后自动改成 engine 默认 model，让用户看到的 Target 与计费/usage/runtime 不一致。
- Bad：product-ready Native 会话仍渲染 Grok/OpenCode 或 provider profile picker；这会重新引入用户不需要理解的 local/expert channel。

### 6. Tests Required

- React component：同一 catalog 3 engine rows、compatible preserve / incompatible atomic fallback、切 model 保留 engine、搜索/vendor grouping、empty intersection disabled、panel stays open、Escape close、无 provider/config controls、ready 无固定 footer、Native conversation 同样为 product mode。
- Account component：billing source/copy 无 invoice；vendor summary count 默认可见，model detail 初始不 mount，pointer/keyboard 展开后出现、再次点击消失。
- Brand icon：`resolveProviderBrandIcon` 对 `豆包`、`doubao-entry`、`ark-code-latest` 全部返回本地 `doubao.png`；`ProviderBrandIconImg` component test 断言 intrinsic size 与 container bounds。
- Refresh coordinator：same-subscription coalescing、freshness skip、pending保留rows、success原子发布、failure stale、logout/account-switch stale settle不覆盖。
- Product provisioning：Codex/Claude ready/choiceRequired/bundle failure；Kimi installed/missing plan blocked/install failed/post-verify failed；断言 provider prepare 只在 provisioning success 后调用。
- Composer regression：Home dynamic product mode；Shared removed-model selection 自动 repair并持久化 managed target；readiness/display/runtime identity 跟随 `selectedAtomicTarget`。
- Rust unit：display/runtime/engine metadata、upstream order/dedupe、non-conversation filtering、main-window IPC、managed product Claude Unicode model、Kimi Unicode bare+`doge/` alias。
- Real E2E：当前 selectable catalog 对三 CLI 的 exact model/terminal evidence；失败不得被 minimal endpoint probe覆盖，并必须记录 upstream/config prerequisite。
- Required commands（用户本次 L4）：全量 Vitest/Rust tests、full ESLint/typecheck、Rust check/build、runtime/engine contracts、OpenSpec strict、hot-dev visual/E2E。

### 7. Wrong vs Correct

#### Wrong

```ts
const models = STATIC_RELEASE_MODEL_IDS[selectedEngine];
// 新上游 model 永远不可见，display/runtime identity 也丢失。
```

```text
GET /v1/models contains kimi-for-coding
POST /v1/messages minimal probe = 200
=> mark Claude Code × kimi-for-coding supported  // false proof
```

#### Correct

```ts
const catalog = productEntitlement.models; // refreshed upstream rows
const rows = compatibleProductModelsForEngineV1(nextEngine, catalog);
commitTarget(resolveProductManagedExecutionTargetV1({ engines, models: rows }));

// Product-ready Home / Shared / Native modification share one presentation.
const usesProductTargetCatalog = productEntitlement.status === "ready";
```

```text
catalog entitlement
  + protocol endpoint probe
  + real CLI system/tools/stream payload terminal
  = compatibility evidence for one engine×model cell
```
