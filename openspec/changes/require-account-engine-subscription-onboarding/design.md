## Context

Doge 现有 account foundation 已包含 Native HTTP、OS vault、SQLite ledger、credential-free renderer projection 与 Codex configuration transaction，但产品入口仍是 Settings 内的可选增强，并围绕 API Key 选择和配置确认展开。目标用户已经收敛为不理解 API Key、Provider 或配置文件的小白用户，因此启动主链必须变成“登录—选引擎—验证订阅—自动准备—进入 App”。

token2api 当前仍是账号、套餐、订单、订阅与 API key 的唯一 authority。它已有 `for_sale` subscription plans、active subscriptions、payment orders 和 one-time API-key handoff，但没有 engine-scoped Desktop projection，也没有 `user + device + engine` 的 durable managed binding。仅靠 Doge 拼接现有 Web API 会让 renderer 推断商业规则，并可能在重试时创建重复 key。

约束：

- Doge 不展示 balance、recharge、pay-as-you-go 或手动 API Key。
- raw secret 不能进入 WebView、React state、SQLite、日志、event payload 或 idempotency response。
- AppShell 与 engine runtime 必须晚于 account/engine readiness gate。
- payment provider 仍在 system browser 或 provider-owned surface 完成，Doge 不处理支付凭据。
- token2api 上游更新需要保持可合并；新增 contract 采用独立 Desktop handler/service/schema，不侵入普通 Web checkout UI。
- Codex 与 Claude Code 是既有 engine；本 change 只新增 managed provider binding，不新增 engine registry entry。

## Goals / Non-Goals

**Goals:**

- 建立可恢复的 mandatory account gate，并让 ready 成为 AppShell 的唯一挂载前置条件。
- 由 token2api 返回当前 engine 可售套餐、active entitlement 与 checkout terminal truth。
- 只允许 subscription order；server response 即 UI 商业事实源，本地不硬编码价格、额度或套餐数量。
- 按 `user + device + engine` 幂等 ensure managed credential，并在 Native 内完成 vault 与 Codex/Claude configuration。
- 通过 AppShell 挂载前的 bounded gate reconciliation 自动感知支付结果，禁止把秒级 polling 带入 AppShell/root hook 链。
- 保留登录后的 Settings Account 管理入口与显式 engine switch。

**Non-Goals:**

- 不建设余额充值、按量付费、混合计费、优惠券、发票或套餐营销 CMS。
- 不在 Doge 管理支付卡、OpenID、provider webhook 或订单履约。
- 不向 renderer 暴露 API key、配置 diff 或配置文件路径。
- 不在首期支持 Codex/Claude Code 之外的 managed engine。
- 不删除底层 manual provider 能力；它只是不再出现在小白启动主链。

## Decisions

### 1. 使用 process-lifetime AccountGate 包裹 main AppShell

`router.tsx` 的 main window route 渲染 `AccountAppGate`，只有 `ready` 才 mount `AppShell`；detached windows 保持原路由，但在无主会话时 fail closed。gate 使用独立 feature store/controller，不写入 `AppSettings`，也不挂入 AppShell 根 hook 链。

备选是在 `bootstrapApp.tsx` 阻塞 React mount。拒绝原因是登录 UI 本身需要 React/i18n/theme，且 bootstrap 阻塞会损害 first paint 和错误恢复。

### 2. Desktop contract 采用 credential-free projection + Native-only mutation

token2api 在 `/api/v1/desktop/v1` 增加 additive contract：

- `GET /engines`：返回 server-owned engine catalog 与当前 entitlement summary。
- `GET /engines/:engine/plans`：只返回 group platform 与 engine mapping 相符、`for_sale=true`、group active 且 subscription type 有效的 plans，同时返回可用 payment methods 的 renderer-safe projection。
- `POST /engines/:engine/checkouts`：只创建 subscription order，验证 `plan_id` 属于该 engine；要求 `Idempotency-Key`。
- `GET /checkouts/:id`：返回 pending/paid/cancelled/expired/failed typed receipt；paid 必须在 subscription fulfillment 已确认后才成立。
- `POST /engines/:engine/managed-access`：验证 active subscription 后，按 `user + device_id + engine` ensure 一个 active binding，并只在 create/rotate handoff 时返回 one-time secret。

Codex 映射 `openai` group platform，Claude Code 映射 `anthropic`。映射定义在 token2api Desktop service 的 versioned catalog，不由 renderer 或 plan 文案推断。未知、inactive 或不支持的平台 fail closed。

备选是 Doge Native 直接组合 `/payment/checkout-info`、`/subscriptions/active` 和 `/keys`。拒绝原因是该组合会泄漏 balance 心智、把 engine mapping 放到客户端，并缺少 managed binding 的 server-side idempotency。

### 3. 套餐列表完全服从 token2api 当前公开可售配置

Desktop plan projection 不设本地套餐白名单、不截断 2/3 个、不补默认套餐，也不缓存成长期商业事实。排序使用 server 的 `sort_order` 再以 `id` 稳定排序；字段仅包含 `id/name/description/price/currency/validity/features/limits` 与 checkout 所需 method projection。

空列表是合法产品状态：UI 显示“暂无可订阅套餐”和重试/帮助入口，绝不出现余额充值 fallback。

### 4. 支付方式渐进披露，订单由 Native 创建、持久化并权威读取

选择 plan 后，仅当 server 返回多个可用支付方式时显示一个短 method chooser；单一方式自动选中。Native 创建 subscription order，并按 provider result 打开 `pay_url`；若 provider 只支持 QR，则 gate 显示二维码这一唯一支付动作。Doge 不提供“我已支付”按钮。

Rust AccountRuntime 为 pending checkout 保存 credential-free safe checkpoint；重启先用 `checkout_id` 做 authoritative read，支付 URL/QR payload 不落 SQLite。AccountGate 在 AppShell 尚未挂载时使用 2–15 秒 bounded backoff 与 server absolute expiry 对账；一旦 ready/unmount 立即停止。该 timer 不得进入 AppShell/root hook 链。未来可在不改变 IPC response shape 的前提下替换为 Native event wakeup。

### 5. managed binding 复用受保护 API key 的 durable uniqueness

首期不新增平行 credential table。token2api 使用 server secret 对 `user_id + HMAC(device_id) + engine_id + active subscription group_id` 派生 deterministic credential identity，并把既有受保护 `api_keys.key` unique constraint 作为并发唯一性边界；row 仍 group-bound、owner-bound、metadata-only on reads，recoverable ciphertext 只用于受保护 handoff。`device_id` 原文不进入数据库或日志。

ensure 流程为：验证 active subscription 的 group/platform → 派生 credential identity → create-or-recover 同一 owner/group/name 的 active API key → 产生 Native-only handoff。`Idempotency-Key` 只约束 mutation receipt，不参与 business identity；plaintext 不进入 idempotency table。未来需要 server-side rotate generation、设备管理或多 active binding 时，再迁移到显式 relation table，但不得改变 Desktop response shape。

备选是立即新增 `desktop_managed_engine_keys` relation。首期拒绝原因是现有 protected API key 已提供所需 owner/group/unique/encrypted lifecycle；新增 relation 会把同一 credential truth 拆成两套 schema 和 transaction，增加上游同步面而没有新增用户价值。

### 6. Native vault 与 engine configuration 采用 engine-scoped recipe

vault scope 由 `authority_origin + account_id + device_id + engine_id` 组成。`binding_generation` 不进入本地 scope：Native 在每次 AppShell 挂载前都执行 server-owned deterministic ensure，套餐 group 改变时用当前 binding 覆盖同一 engine scope，从而避免遗留 secret 被本地 readiness 误判为可用。Native 不把 remote binding id 或 raw secret 写入 generic ledger；server ensure 可幂等重放，vault/config 任一步失败都停留在 gate，configuration transaction 继续用 journal 表达 rollback truth，restart 后重新 ensure 即可恢复。

- Codex recipe：复用现有 provider registry/config path 与 launch-time secret injection。
- Claude Code recipe：写入不含 secret 的 managed provider sentinel；launch 时从 vault 注入 `ANTHROPIC_AUTH_TOKEN` 与 token2api base URL。不得把 secret 写进 settings JSON。

配置成功需做 syntax + semantic verifier；UI 只显示“正在准备/已准备”，不展示 file list 或 diff。底层 journal/receipt 仍保留给恢复与诊断。

### 7. 最近引擎与状态机

credential-free preference 只保存 `engine_id`，不保存 plan/order/key。状态机为：

`bootstrapping → signedOut → authenticating → choosingEngine → checkingEntitlement → choosingPlan → choosingPaymentMethod → awaitingPayment → preparing → ready`，并有 `recoverableFailure`。所有 transition 由 authoritative read 或 typed mutation receipt 驱动；网络、vault、CLI missing、subscription unavailable、payment cancelled 分开投影，只有 `noEntitlement` 才进入 plans。

### 8. Rollout 与 compatibility

Doge 的 mandatory gate 是本产品 fork 的默认行为；保留 build-time emergency kill switch 仅用于回滚，关闭后明确进入 unsupported maintenance screen，而不是恢复 Local Mode，从而避免绕过业务要求。token2api Desktop contract 是 additive，不改变 Web plan/payment API；部署顺序必须 server first、Doge second。

### 9. Password recovery 复用既有 Web completion

首个 release cut 在 Doge 内提供 forgot-password 入口并直接调用 token2api current `POST /api/v1/auth/forgot-password`。成功只表示 anti-enumeration request 已受理；UI 只引导用户检查邮件或返回登录，不推断账号是否存在。

邮件中的 reset link 继续由固定 `token-matrix.com` HTTPS 页面完成，新密码和 raw reset token 不进入 Doge WebView、React state、SQLite、event 或日志。完成后用户回到 Doge 重新登录；`auth.inspectExternalIntent` 与 `auth.resetPassword` 在 Native Desktop ticket contract 上线前保持 disabled，不用 legacy Web link 冒充 Native completion。

## Risks / Trade-offs

- [Risk] token2api 的 `group.platform` 不能表达未来一个套餐覆盖多个 engine → [Mitigation] 首期 server-owned catalog 固定一对一 mapping；未来新增显式 plan-engine relation migration，不让客户端推断。
- [Risk] 支付 provider 返回 QR、OAuth 或 mobile-only result，无法统一 system browser → [Mitigation] Desktop receipt typed 区分 `open_url/show_qr/unsupported`，UI 渐进披露；unsupported 不创建假 pending 状态。
- [Risk] webhook 已支付但 subscription fulfillment 延迟 → [Mitigation] `paid` 仅表示 fulfillment confirmed；否则保持 `processing` 并继续 bounded reconcile。
- [Risk] server ensure 成功、vault/config 失败会留下 orphan binding → [Mitigation] 持久化 outcomeUnknown/quarantine receipt，重试同 binding rotate/handoff，不创建第二个 active binding。
- [Risk] mandatory login 暂时降低离线可用性 → [Mitigation] 已 ready 的 session 可在 refresh grace 内恢复 UI，但启动 engine 前仍需可验证 subscription；该取舍由本 change 的产品决策接受。
- [Risk] 上游同步与新增 Desktop schema 冲突 → [Mitigation] 独立 migration、handler/service 与 additive route，避免修改通用 payment response；merge 时按 capability matrix semantic merge。

## Migration Plan

1. token2api 先部署 additive Desktop plan/checkout/managed-access contract、truthful password-reset request capability 与 descriptor；protected API-key migration/guarantees 已具备时才打开 managed capability。
2. Doge 实现新 gateway validator、Native runtime、AccountGate 与 Codex/Claude recipes；在 capability 不足时显示服务升级中，不挂载 AppShell。
3. 使用 staging/production-safe fixture 验证 login、existing entitlement、public plans、checkout terminal、ensure、vault、两种 engine launch。
4. 发布 Doge macOS/Windows 包；观察 contract mismatch、checkout terminal latency、managed ensure 与 config failure metrics。
5. 回滚时先回滚 Doge 到旧版；token2api additive endpoints/schema 可保留。若关闭 server capability，新 Doge fail closed，不降级到余额或手动 key。

## Open Questions

- 正式支付 provider 是否全部能返回 Desktop 可消费的 `pay_url`；若存在 QR-only provider，按 typed QR flow 验收。
- 生产发布身份（Apple Developer ID / Windows code signing）是否已具备；缺失时只产内部测试包，不宣称正式发行。
