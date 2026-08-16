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
- Pending checkout checkpoint 按 authority/account/device 隔离并在 restart 后 authoritative read；React polling 只允许存在于 AppShell 挂载前的 gate，使用 bounded backoff + absolute server expiry，禁止进入 AppShell/root hook 链。
- managed credential 在 token2api 按 user/device hash/engine/group 幂等 ensure；每次 AppShell mount 前 MUST 重新确认当前 subscription binding，并覆盖 `authority + account + device + engine` scope。raw secret 只走 Rust memory → engine-scoped OS vault。Codex/Claude config 只写 sentinel/base URL，launch 时注入 secret；launch read MUST 要求当前 active account session，MUST NOT 依赖 legacy `managed_key_id`，退出后 fail closed。
- Claude account-managed provider id 固定 `doge-token-matrix`；desktop runtime 注入 `ANTHROPIC_AUTH_TOKEN`，daemon 必须 fail closed，不得读取或伪造 desktop vault secret。

### Required Tests

- token2api：closed catalog、exact public subscription plan filter、checkout terminal/action recovery、required idempotency、audit body omission、managed mapping/isolation。
- Rust：checkout HTTPS/QR validator、SQLite v8 restart/secret scan、Codex/Claude config secret scan、engine-scoped vault、daemon fail closed。
- TypeScript/React：unknown engine/protocol fail closed、exact server plans/no billing fallback、AppShell pre-ready absence、paid auto prepare、pending checkout restart recovery、internal reason 不直出。

异常、恢复与latency scenario由`AccountLab`/Vitest选择；产品页面只呈现用户任务和自然交互。
