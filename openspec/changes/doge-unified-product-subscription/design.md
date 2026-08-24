# Design: Doge 全产品统一订阅

## 1. Architecture Decision

采用 **一个 token2api Composite plan + 一个 active subscription + 一个 managed Composite key**：

1. Native 从 generic checkout catalog 读取 `group_platform=composite` 的上架 plan。
2. Native 从 subscription summary 判断该账号是否存在与 product plan `group_id` 匹配的 active subscription。
3. 无 entitlement 时，Gate 直接消费上游 plan/payment 字段完成 checkout；有 entitlement 时进入 idempotent preparation。
4. preparation 先完成 product engine provisioning：Codex/Claude Code 通过现有 Account toolchain resolver 选择已验证 external 或 bundled binary，旧 external 版本的 choice 自动选择 bundled；Kimi CLI 仅在缺失时使用现有 typed installer 安装并再次 version-verify，已有安装不自动升级。任一失败保持 Gate 与 retry，不能先写 provider config 假装 ready。
5. preparation 查找或创建绑定该 Composite group 的 Doge managed key，OS vault 是 secret 的持久化事实源；renderer 不接触 secret。Kimi CLI 运行时若无法通过 env 接收 key，由 Native 在隔离的 `KIMI_CODE_HOME` 生成 `0600` runtime config。
   - Kimi 的 Doge registry target 是 JSON，不得落入 Codex TOML verifier；managed merge 必须替换旧 provider entry 并移除 `apiKey/api_key/token/secret` 等 legacy 明文字段，再由 launch adapter 注入。
6. Native 用该 credential 读取 `/v1/models`，输出去重后的 product model catalog，并向已支持的本地 engine 投影 Token Matrix provider configuration。

该路径复用 token2api 已有 payment、subscription、key、Composite routing 与 `/v1/models`，因此本轮不需要上游 schema、payment fulfillment 或 admin UI 代码改造。

## 2. Authority and Contracts

### 2.1 Product catalog

Native 对 renderer 输出严格的 product view：

- `productId` / `groupId`
- server-owned `name`、`description`、`price`、`originalPrice`、`currency`、`validityDays`
- `entitlement.status`、`subscriptionId`、`expiresAt`
- `paymentMethods`

renderer 不基于套餐名猜测权限，也不硬编码售价、有效期、营销 description 或模型清单。

### 2.2 Managed credential

credential business identity 为 `account + device + composite group`。ensure operation 必须幂等；重复启动只能复用或安全 refresh，不得创建 key storm。secret 不进入 IPC diagnostics、React state、日志或用户可见配置 diff；Kimi 的 owner-only runtime config 属于 Native launch adapter，不能成为业务状态或跨账号复用。

### 2.3 Model catalog

模型权限事实来自使用 managed Composite key 调用的 `/v1/models`。Doge 输出稳定字段 `id`、`displayName`、`model`、`compatibleEngines` 与可选 `capabilities`：`displayName` 优先读取上游 `display_name`，`model` 优先读取上游 `model/runtime_model`，缺失时回退公开可调用的 `id`。presentation registry 只补 icon/vendor，不得增加 entitlement。

product catalog identity、用户显示名与 CLI runtime identity 必须分离。豆包是显式 Doge-owned Composite alias：即使上游 row 暴露 account 内部 `model=ark-code-latest`，Doge 对 Composite 的 Native per-thread selection、Kimi launch alias 与 `--model` 仍使用公开 callable“豆包”，由 token2api account routing 内部映射；直接发送 `ark-code-latest` 会被 Composite 以 400 拒绝。同时不得被 local Kimi catalog repair 回默认 `gpt-5.5`。

### 2.4 macOS development vault boundary

用户日常开发入口固定为 `npm run tauri:dev:hot`。在 `cfg(all(debug_assertions, target_os = "macos"))` 下，`AccountRuntime` 选择 app-data 内的 `debug-account-vault/credentials.json`，承载 refresh credential 与 managed Codex/Claude/Kimi keys；该路径不读取、不迁移、也不 fallback 到 Keychain，确保无人值守 E2E 不出现系统授权弹窗。

开发 vault 仍复用同一 purpose allowlist。directory MUST 为 `0700`，credential file MUST 为 regular file 且为 `0600`；读写拒绝 symlink，使用 lock + same-directory create-new temp + fsync + atomic rename。错误只返回稳定 safe message，不能输出 path、purpose 对应 secret 或 serialized payload。

Release、非 macOS debug 与所有正式分发继续构造 `OsAccountVault`。debug file 不参与 release migration，不由 renderer 选择，也没有 runtime flag；从 Keychain 切到 debug file 后若尚无本地 session，开发者只需登录一次，后续启动复用 local refresh credential。

## 3. Gate State Machine

`auth -> catalog -> subscribe | checkout -> fulfilling -> prepare -> ready`

- 未登录：复用现有 AccountAuthPanel。
- catalog loading/error：全屏，不挂载 AppShell；始终允许当前设备退出登录。
- no entitlement：显示上游 Doge plan；checkout 支持 QR / external URL 与 bounded polling。
- paid：刷新 subscription authority 后执行 `prepare`，不得仅相信本地旧 vault。
- checkout 先返回 `paid`、subscription summary 尚未 active 时进入独立 `fulfilling` phase：保留 credential-free paid checkpoint，以 forced catalog refresh + bounded backoff 等待 entitlement；不得退回套餐页诱导重复购买。App restart 可从同一 checkpoint 继续 reconciliation，只有 entitlement active + prepare success 后才清 checkpoint。
- ready：catalog 与 credential 都可用后才 mount AppShell。
- active subscription 但 model catalog 暂时失败：展示可恢复错误与 retry，不得退回 local provider 或空模型假成功。

## 4. Engine and Model Selection

- engine list 只来自 Doge local engine registry，首期产品面展示 Codex、Claude、Kimi。
- product catalog 继续是商业 entitlement 的上限；Doge 不再维护具体 model id allowlist。Native 安全投影保留上游顺序与 display/runtime identity，并拒绝 malformed、重复、超量以及明确的 image/audio/realtime/embedding-only rows。
- 上游 `compatible_engines` 存在时是 engine subset authority；缺失时按稳定 family fallback 投影：GPT/OpenAI→Codex、Claude/Anthropic→Claude Code、Kimi/Moonshot/K3→Kimi CLI、豆包/Ark Coding→三种 managed adapter，未知 family fail closed。由此同 family 新 model id 不需要 Doge 发版即可进入目录；上游新增兼容元数据后可直接扩展新 family。
- model list 按当前 engine 的动态 `compatibleEngines` 过滤后，再按 presentation vendor 分组并支持搜索；组内保持上游 catalog 顺序。`/v1/models` 是 entitlement/catalog evidence，exact CLI Agent payload typed terminal 是发布 E2E evidence；两者不能互相替代。
- engine 使用无独立 card container 的紧凑单选行，完整展示 display name，不以窄卡片 ellipsis 隐藏名称。
- model 选择不改变 engine。切换 engine 时，若当前 model 仍声明兼容则保留；否则原子切换到该 engine 在上游 catalog 中的第一个 compatible model。下一 engine 没有 compatible model 时不得生成 partial target 或回退 local/default。
- 选择立即写入当前/new-session target，面板保持打开；关闭后 composer 展示 engine icon + model brand icon + display name。
- product ready 后，`engine + model + managed provider profile` 共同组成唯一合法的 ExecutionTarget；新会话初始化、Shared target repair、engine/model 切换与发送边界都必须显式绑定 `doge-token-matrix`，不得继承旧 local/disk profile。
- product flow 不展示 provider/configuration selector。用户只选择 engine 与该 engine 已验收的 model；Doge 注入的 managed provider configuration 是产品级 runtime contract，不是第三个用户选项。
- product-ready Home、Shared 与普通 Native conversation 修改入口使用同一个可刷新的 product snapshot，再通过同一个 compatibility helper 得到 engine-specific rows；不得从 provider-scoped/local fallback catalog 补模型，也不得按入口维护多套目录。Native binding 仍 immutable，跨 engine/provider 继续走 managed prepare + new-session/Continuation。
- Product picker 使用右侧 panel，engine/model 分栏独立选择；provider/channel/configuration controls 在该 surface 不可达。Existing Native Session 仍遵守 immutable engine/provider binding，跨 engine 走 new-session/Continuation；Shared 只改变 Next Turn target。
- Release readiness 不能只以 `/v1/models` 为证据；必须维护 `Responses + Messages + Chat Completions` 的 current product model probe matrix。临时 route/account unavailable 只形成原 target 的 typed failure，禁止 silent fallback。
- 组合 ExecutionTarget 时保留上游 `modelCatalogEntryId`，并只把上游公开 `model/runtime_model/id` 解析为 runtime model；禁止从 display name 猜测调用名。
- Kimi launch hydration 在每次真实发送前按 selected runtime model 写入 bare + `doge/` alias；Claude managed turn 通过 family alias + turn-scoped env 投影任意安全 Unicode model id；Codex 直接发送 runtime model。三者都不得回退 global/default model。

token2api production configuration 仍是 E2E prerequisite，但 Doge 不读取 admin-only facts。若 `/v1/models` 广告的模型在 Composite route 中不可调用（当前只读 probe 已证明 `豆包` 与 `ark-code-latest` 均返回 `Model is not supported by composite groups`），该差异必须作为 upstream/configuration blocker 暴露，不能在 Doge 静态伪造映射。

token2api channel 对 `Doge APP` 采用 single-owner `Doge 统一定价`。Kimi 官方 4 条 token price 保留；豆包 Coding Plan 通过 OpenAI 平台 `ark-code-latest + 豆包` allowlist 放行，因官方套餐按订阅额度而非独立 token 单价计费，禁止填写伪造 price；`gpt-5.6-luna` 复用 OpenAI 官方 default 与长上下文分层价。其余 GPT/Claude model 若要 release-ready，必须继续把对应官方 price rules 合并进同一 channel。

Claude Messages 也受同一 channel 的 platform-specific pricing gate。初版在 Anthropic platform 增加 `claude-sonnet-4-6` 官方价与 `ark-code-latest + 豆包` 空价格 allowlist；这是 endpoint eligibility，不改变 private account mapping。Claude CLI 的 structured `assistant` API error 属于 authoritative terminal rejection，即使 process/stdout 未退出也必须立即 settle；等待 EOF 只属于 cleanup，不能让 Continuation Dialog 永久停在 delivery。

右侧面板沿用 Doge 现有 surface、border、spacing、scroll、icon 与 responsive 规则。原型中的页面壳、假 workspace、营销说明和 engine-filter-model 行为不采用。

## 5. Account Center

- 保留 AccountCenterHeader 的 display name、password、TOTP、identity binding、this/all device logout。
- Account Center 使用单页 scroll surface：页面标题/说明、profile + product status、usage details、billing records、subscription details 依次排列，不再要求用户通过 Subscription/Usage Tab 找信息。
- profile 与 product entitlement 来自已就绪的 account controller/product store，首屏同步渲染；usage 与 billing 是两个独立 async owner，分别提供 skeleton、last-known-good、error 与 retry。
- usage period closed enum 为 `current | previous`。Native 重新验证 active Composite subscription，优先用 subscription progress 的 monthly `window_start/resets_at` 计算 exact range；缺失时使用明确标注的 rolling-30-day fallback。
- summary 由 `/usage/stats` 提供 requests、token breakdown、standard/actual cost、average duration；model TOP 由同 group/date range 的 `/usage/dashboard/snapshot-v2` 提供。两者在 period range 已确定后并行请求。
- engine roster 来自 Doge built-in registry；token2api 当前不持有 Doge runtime engine dimension，因此不得展示推测 count。未来上游新增 authoritative dimension 后可在同一 slot 渐进启用。
- billing 独立并行读取 `/payment/orders/my?order_type=subscription` 与 checkout plan catalog，用 plan id 映射显示名；只展示 safe order facts。上游无 invoice artifact/download endpoint，故 UI 不渲染 action，也不展示 unsupported/invoice 提示。
- Subscription details 只显示一个 product：plan name、active state、`YYYY-MM-DD` expiry 与可用模型数量。模型按 presentation vendor grouping 默认显示 vendor + count，点击渐进展开 model display-name list，再次点击收起。豆包 identity 统一使用 product-owned PNG，不能另建第二套 vendor/icon 规则。
- product ready 时完全移除旧 engine-scoped subscription/usage fallback，避免混入历史或无关套餐。
- sidebar shortcut 继续 lazy load，第一层只展示账号身份与整数 percentage；身份区进入账户详情顶部，usage 区进入/聚焦同页 usage section。

## 6. Compatibility and Rollout

- 旧 engine-scoped subscription 仍可出现在 Native authority 数据中，但不解锁新 product Gate；只匹配当前上架 Composite product groups。
- 旧 local provider/config 代码与 Local Mode 数据不删除，但 product-ready flow 不暴露 local channel，也不得从历史 selection、global active profile 或 disk config 继承它。只有退出 product flow 的独立 Local Mode 才可继续使用旧 local/expert channel。
- token2api 无发布变更；Doge rollback 可恢复旧 AccountAppGate/client，而不影响上游订阅和 key。

## 7. Request-Storm Safety

- Gate catalog、subscription、prepare 具备 in-flight dedupe 与 generation cancellation。
- 模型 catalog 使用 30 秒 freshness window、single in-flight owner 与 last-known-good。ready 后以 window focus/visibility event 驱动刷新，并使用 60 秒可见窗口兜底；picker 提供显式刷新，禁止按键/hover 触发远端请求。
- account shortcut 保持 click-to-load；usage 只在目标 surface 主动读取。
- 429 保留 `retryAfterMs` 并禁用重试至 cooldown，不显示泛化“准备没有完成”。
- Account detail usage 与 billing 分别 in-flight dedupe；period generation 只允许当前 selection 写回。刷新保留 last-known-good，不回到整页 blank。
- Native 在取得/刷新 access token 后释放 account state mutex，再执行 usage/order network reads；禁止长请求持锁阻塞 logout/profile/security。
- Product plan card 使用固定 information hierarchy 而非整卡文字按钮：brand → plan name/price/validity → engine row → upstream feature/model row → full-width CTA。商业 name/price/currency/validity/description/features 继续来自 token2api；engine row 来自 Doge registry。

## 8. Verification Matrix

| Layer | Evidence |
|---|---|
| OpenSpec | strict validate for this change |
| Frontend contract | parsers reject malformed product/catalog/payment payloads |
| Gate | unauthenticated, unsubscribed, paid→prepare→ready, logout, 429 cooldown |
| Picker | dynamic upstream rows, display/runtime identity, refresh UX, search, atomic fallback, no partial target |
| Account center | single product card, preserved lifecycle controls, product/model usage |
| Account detail progressive UX | profile immediate; usage/billing independent skeleton, success, error, retry and stale-generation guards |
| Native | Composite catalog/entitlement/key/model projection and secret redaction |
| macOS debug vault | file permission/symlink/corruption/atomic round-trip tests；standard hot startup zero Keychain prompt |
| Manual | hot app login, Gate/payment, composer side panel, account tabs |

本地收口不声明以下范围已验证：Windows Credential Manager / Windows installer、Linux Secret Service、macOS Release Keychain 实包、真实第三方支付回调、退款与跨设备并发，以及 token2api 生产环境新增第二个 Composite 商品后的产品筛选策略。这些场景由 release CI、平台实机和后续 production smoke 覆盖；本轮 hot 验收聚焦 macOS debug local vault、当前账号登录、单套餐 entitlement、model catalog、engine/model selection 与账号中心。
