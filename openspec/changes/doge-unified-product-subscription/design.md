# Design: Doge 全产品统一订阅

## 1. Architecture Decision

采用 **一个 token2api Composite plan + 一个 active subscription + 一个 managed Composite key**：

1. Native 从 generic checkout catalog 读取 `group_platform=composite` 的上架 plan。
2. Native 从 subscription summary 判断该账号是否存在与 product plan `group_id` 匹配的 active subscription。
3. 无 entitlement 时，Gate 直接消费上游 plan/payment 字段完成 checkout；有 entitlement 时立即 mount AppShell，并在后台执行 catalog-only Product access reconciliation。
4. Product engine provisioning 不属于 startup Gate。用户首次发送到 Codex/Claude/Kimi 时，send-time coordinator 只为 frozen target 的 exact engine 执行 managed config、toolchain resolve/install、verification 与必要 activation；失败只影响该 send，并由右下角 non-blocking card 提供 retry。
5. catalog-only 或 exact-engine preparation 查找/创建绑定该 Composite group 的 Doge managed key，OS vault 是 secret 的持久化事实源；renderer 不接触 secret。create 是可能已经提交 server-side side effect、但响应解析为 `protocolMismatch` 或缺少可信 secret 的 mutation：Native 必须先用 deterministic `group + hashed device` key name authoritative re-list，命中 exact active key 后走 owner-authorized handoff并继续；只有 reconcile 也无法证明 usable key 时才返回原始失败。Kimi CLI 运行时若无法通过 env 接收 key，由 Native 在隔离的 `KIMI_CODE_HOME` 生成 `0600` runtime config。
   - Kimi 的 Doge registry target 是 JSON，不得落入 Codex TOML verifier；managed merge 必须替换旧 provider entry 并移除 `apiKey/api_key/token/secret` 等 legacy 明文字段，再由 launch adapter 注入。
6. Native 用该 credential 读取 `/v1/models` 并输出去重后的 product model catalog；只有 exact-engine prepare 才向该 selected engine 投影 Token Matrix provider configuration。

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

managed provider projection 采用 stable id `doge-token-matrix` + integer `managedRevision`。catalog-only startup prepare 不 apply engine config；send-time exact-engine prepare 检测同 id 的旧 Doge entry，缺失/低于 current revision 时 fail closed，并只替换当前 selected engine 的 deterministic entry，同时保留其他 local/custom provider rows。Codex 只向 Doge-spawned child 注入隔离 `CODEX_HOME`，Kimi 只向 child 注入隔离 `KIMI_CODE_HOME`，Claude 每 turn 使用 owner-only private `--settings`；不得改写用户的 `~/.codex`、`~/.claude/settings.json` 或 `~/.kimi-code`，因此用户在 terminal 直接运行 CLI 仍使用自己的本地配置。

product entitlement ready 时，shipping UI 不再挂载 Engine Management：Settings sidebar、model menu footer、`providers/vendors` legacy deep link，以及历史上转发到 provider surface 的 `permissions` deep link 都必须隐藏或回退基础设置。Codex/Claude/Kimi 的 local/official activation、CLI 启停和 raw global file edit 不再提供给产品用户；底层 provider/config diagnostics 只作为内部实现保留，不能改变任何 product execution target。

`AppSettings.disabledCliEngines` 继续作为 legacy Local Mode compatibility field，但 Rust settings owner 与 TypeScript boundary normalization 都必须移除 `claude/codex/kimi`。默认 blacklist 只保留非产品引擎；因此旧安装即使曾停用 Kimi，authenticated AppShell mount 后也会看到完整三引擎 product surface。visibility 不等于 executable readiness；后者由 send-time coordinator 在 exact engine 第一次使用时收敛，任何失败都不得让 AppShell 回到 Gate。

### 2.3 Model catalog

模型权限事实来自使用 managed Composite key 调用的 `/v1/models`。Doge 输出稳定字段 `id`、`displayName`、`model`、`compatibleEngines` 与可选 `capabilities`：`displayName` 优先读取上游 `display_name`，`model` 优先读取上游 `model/runtime_model`，缺失时回退公开可调用的 `id`。presentation registry 只补 icon/vendor，不得增加 entitlement。

product catalog identity、用户显示名与 CLI runtime identity 必须分离。豆包是显式 Doge-owned Composite alias：即使上游 row 暴露 account 内部 `model=ark-code-latest`，Doge 对 Composite 的 Native per-thread selection、Kimi launch alias 与 `--model` 仍使用公开 callable“豆包”，由 token2api account routing 内部映射；直接发送 `ark-code-latest` 会被 Composite 以 400 拒绝。同时不得被 local Kimi catalog repair 回默认 `gpt-5.5`。

### 2.4 macOS development vault boundary

用户日常开发入口固定为 `npm run tauri:dev:hot`。在 `cfg(all(debug_assertions, target_os = "macos"))` 下，`AccountRuntime` 选择 app-data 内的 `debug-account-vault/credentials.json`，承载 refresh credential 与 managed Codex/Claude/Kimi keys；该路径不读取、不迁移、也不 fallback 到 Keychain，确保无人值守 E2E 不出现系统授权弹窗。

开发 vault 仍复用同一 purpose allowlist。directory MUST 为 `0700`，credential file MUST 为 regular file 且为 `0600`；读写拒绝 symlink，使用 lock + same-directory create-new temp + fsync + atomic rename。错误只返回稳定 safe message，不能输出 path、purpose 对应 secret 或 serialized payload。

Release、非 macOS debug 与所有正式分发继续构造 `OsAccountVault`。debug file 不参与 release migration，不由 renderer 选择，也没有 runtime flag；从 Keychain 切到 debug file 后若尚无本地 session，开发者只需登录一次，后续启动复用 local refresh credential。

canonical dev/release 共用 bundle identifier 也意味着 macOS single-instance owner 必须可辨认。`tauri:dev:hot`、isolated 与 signed dev 在执行 `tauri dev` 前检查 `.app/Contents/MacOS/doge` packaged process；存在时 fail closed 并要求先退出旧窗口，禁止让旧内置 `tauri://localhost` bundle 抢占本应连接 Vite `:1420` 的验收窗口。preflight 不自动 kill，以免丢失旧 App 中未保存的用户工作；repo raw `target/debug/doge` 不视为 packaged conflict。

## 3. Gate State Machine

`auth -> catalog -> subscribe | checkout -> fulfilling -> ready(AppShell)`

- 未登录：复用现有 AccountAuthPanel。
- catalog loading/error：全屏，不挂载 AppShell；始终允许当前设备退出登录。
- no entitlement：显示上游 Doge plan；checkout 支持 QR / external URL 与 bounded polling。
- paid：只等待 authoritative subscription active，不等待任何 CLI toolchain。
- checkout 先返回 `paid`、subscription summary 尚未 active 时进入独立 `fulfilling` phase：保留 credential-free paid checkpoint，以 forced catalog refresh + bounded backoff 等待 entitlement；不得退回套餐页诱导重复购买。App restart 可从同一 checkpoint 继续 reconciliation。
- ready：active entitlement catalog 成立即 mount AppShell，并 publish empty/refreshing model snapshot。
- active subscription 后，以 catalog-only `account_product_v1_prepare(engineId=null)` 在后台收敛 credential/model catalog；最多按 `[0, 1s, 2s, 4s, 8s, 15s]` 做 6 次 bounded idempotent convergence，attempts exhausted 只投影 stale catalog 与 safe diagnostic，禁止 unmount/锁定 AppShell。
- CLI toolchain readiness 仅在 send-time exact engine transaction 中处理；进度与错误由 shared bottom-right toast stack 展示。

## 4. Engine and Model Selection

- engine list 只来自 Doge local engine registry，首期产品面展示 Codex、Claude、Kimi。
- Product Home 每次进入新会话态都以 `Codex + 当前上游目录中第一条 Responses-compatible model` 作为确定性初始 Target；不得继承 global/local 上次 engine 或 model。用户在当前 Home 明确点选后，local creation target 保留到该 Session 创建完成。
- product catalog 继续是商业 entitlement 的上限；Doge 不再维护具体 model id allowlist。Native 安全投影保留上游顺序与 display/runtime identity，并拒绝 malformed、重复、超量以及明确的 image/audio/realtime/embedding-only rows。
- 上游模型 compatibility 先归一为 endpoint-level managed Provider API protocol：`openai-responses`、`openai-chat-completions`、`anthropic-messages`。explicit `api_protocols|supported_protocols|protocols` 是 authority；legacy `compatible_engines` 只作为对应 endpoint evidence；缺失时按实测 family fallback 投影，unknown family fail closed。API protocol 不等于 CLI process/stdout `protocolFamily`。
- model list 按当前 engine 的 exact endpoint protocol capability 过滤后，再按 presentation vendor 分组并支持搜索；Codex 消费 Responses rows、Kimi 消费 Chat Completions rows、Claude 消费 Anthropic Messages rows，多 endpoint row 才可跨 engine。`/v1/models` 是 entitlement/catalog evidence，exact CLI Agent payload typed terminal 是发布 E2E evidence；两者不能互相替代。
- 2026-08-27 production `Doge APP` Composite 已补齐 `kimi*` / `k3*` → Kimi / Responses routes；managed-key probes 证明 `k3`、`k3-256k`、`kimi-for-coding` 在 Responses 均返回 200，因此 Kimi-family fallback 是 Responses + Chat Completions，Codex 与 Kimi 都应展示。
- engine 使用无独立 card container 的紧凑单选行，完整展示 display name，不以窄卡片 ellipsis 隐藏名称。
- model 选择不改变 engine。Codex/Kimi 间切换时只有同时支持 Responses + Chat Completions 的 model 可以保留；否则原子切换到目标 engine 在上游 catalog 中的第一个 compatible model。下一 engine 没有 compatible model 时不得生成 partial target 或回退 local/default。
- 选择立即写入当前/new-session target，面板保持打开；关闭后 composer 展示 engine icon + model brand icon + display name。
- product ready 后，`engine + model + managed provider profile` 共同组成唯一合法的 ExecutionTarget；新会话初始化、Shared target repair、engine/model 切换与发送边界都必须显式绑定 `doge-token-matrix`，不得继承旧 local/disk profile。
- product flow 不展示 provider/configuration selector。用户只选择 engine 与该 engine 已验收的 model；Doge 注入的 managed provider configuration 是产品级 runtime contract，不是第三个用户选项。
- Sidebar 新建菜单遵守同一产品 contract：product ready 时 Claude/Codex/Kimi 都是直接创建动作，固定 `doge-token-matrix`；只有非产品/Local Mode 保留 legacy Provider submenu。模型发布集合由 token2api `Doge APP` 分组的自定义 `/v1/models` 展示列表维护，Doge 不增加第二份 model-id allowlist。
- product-ready Home、Shared 与普通 Native conversation 修改入口使用同一个可刷新的 product snapshot，再通过同一个 compatibility helper 得到 engine-specific rows；不得从 provider-scoped/local fallback catalog 补模型，也不得按入口维护多套目录。Native binding 仍 immutable，跨 engine/provider 继续走 managed prepare + new-session/Continuation。
- Product picker 使用右侧 panel，engine/model 分栏独立选择；provider/channel/configuration controls 在该 surface 不可达。Existing Native Session 中切换 engine 时只更新 panel 内 draft engine，必须等用户点击目标 model 后才原子提交完整 `engine + model + managed provider` Target 并启动 Continuation；禁止 engine click 先用来源 model 创建 target，再让后续 model click 只改 UI。Existing Native Session 仍遵守 immutable engine/provider binding，跨 engine 走 new-session/Continuation；Shared 只改变 Next Turn target。
- Release readiness 不能只以 `/v1/models` 为证据；必须维护 `Responses + Messages + Chat Completions` 的 current product model probe matrix。临时 route/account unavailable 只形成原 target 的 typed failure，禁止 silent fallback。
- 组合 ExecutionTarget 时保留上游 `modelCatalogEntryId`，并只把上游公开 `model/runtime_model/id` 解析为 runtime model；禁止从 display name 猜测调用名。
- Kimi launch hydration 在每次真实发送前按 selected runtime model 写入 bare + `doge/` alias；Claude managed turn 通过 family alias + turn-scoped env 投影任意安全 Unicode model id；Codex 直接发送 runtime model。三者都不得回退 global/default model。

token2api production configuration 仍是 E2E prerequisite，但 Doge 不读取 admin-only facts。若 `/v1/models` 广告的模型在 Composite route 中不可调用（当前只读 probe 已证明 `豆包` 与 `ark-code-latest` 均返回 `Model is not supported by composite groups`），该差异必须作为 upstream/configuration blocker 暴露，不能在 Doge 静态伪造映射。

token2api channel 对 `Doge APP` 采用 single-owner `Doge 统一定价`。Kimi 官方 4 条 token price 保留；豆包 Coding Plan 通过 OpenAI 平台 `ark-code-latest + 豆包` allowlist 放行，因官方套餐按订阅额度而非独立 token 单价计费，禁止填写伪造 price；`gpt-5.6-luna + gpt-5.6-sol + gpt-5.6-terra` 共享当前 OpenAI default 与长上下文分层价。其余 GPT/Claude model 若要 release-ready，必须继续把对应 official/current product price rules 合并进同一 channel。

Claude Messages 也受同一 channel 的 platform-specific pricing gate。初版在 Anthropic platform 增加 `claude-sonnet-4-6` 官方价与 `ark-code-latest + 豆包` 空价格 allowlist；这是 endpoint eligibility，不改变 private account mapping。Claude CLI 的 structured `assistant` API error 属于 authoritative terminal rejection，即使 process/stdout 未退出也必须立即 settle；等待 EOF 只属于 cleanup，不能让 Continuation Dialog 永久停在 delivery。

右侧面板沿用 Doge 现有 surface、border、spacing、scroll、icon 与 responsive 规则。原型中的页面壳、假 workspace、营销说明和 engine-filter-model 行为不采用。

## 5. Account Center

- 保留 AccountCenterHeader 的 display name、password、TOTP、identity binding、this/all device logout。
- Account Center 使用单页 scroll surface：页面标题、profile + product status、usage details、billing records、subscription details 依次排列，不再要求用户通过 Subscription/Usage Tab 找信息；标题下不重复解释页面能力。
- profile 与 product entitlement 来自已就绪的 account controller/product store，首屏同步渲染；usage 与 billing 是两个独立 async owner，分别提供 skeleton、last-known-good、error 与 retry。
- usage query 使用 validated `startDate + endDate + day|hour` contract。Frontend 提供与 token2api 一致的常用范围、自定义日期与粒度选择；Native 限制 future、倒序、超过 366 天以及超过 32 天的 hourly query，并在重新验证 active Composite subscription 后把 exact range 传给 authority。
- summary 由 `/usage/stats` 提供 requests、token breakdown、standard/actual cost、average duration；model usage table 与 Token trend 由同 group/date range 的 `/usage/dashboard/snapshot-v2` 提供。两者在 range 已验证后并行请求；granularity 原样传给 snapshot，不在 Doge 伪造 buckets。Trend 展示 Input/Output/Cache Creation/Cache Read，并按上游公式 `cacheRead / (input + cacheRead + cacheCreation)` 派生 Cache Hit Rate 右轴；legend 可逐 series toggle。
- 所有 Doge core Token count display 统一调用 `src/utils/tokenFormat.ts::formatTokenCount`，固定使用 uppercase `K/M/B`，禁止依赖 locale compact notation 产生“万/亿”或各 surface 自建 lowercase `k/m` formatter。
- token2api 未返回 runtime-engine aggregation 时，Account Center 不渲染无数据的 engine roster 或解释性 filler；model table 是唯一 usage drill-down。
- engine roster 来自 Doge built-in registry；token2api 当前不持有 Doge runtime engine dimension，因此不得展示推测 count。未来上游新增 authoritative dimension 后可在同一 slot 渐进启用。
- billing 独立并行读取 `/payment/orders/my?order_type=subscription` 与 checkout plan catalog，用 plan id 映射显示名；只展示 safe order facts。上游无 invoice artifact/download endpoint，故 UI 不渲染 action，也不展示 unsupported/invoice 提示。
- Subscription details 只显示一个 product：plan name、active state、`YYYY-MM-DD` expiry 与可用模型数量。模型按 presentation vendor grouping 默认显示 vendor + count，点击渐进展开 model display-name list，再次点击收起。豆包 identity 统一使用 product-owned PNG，不能另建第二套 vendor/icon 规则。所有 provider/LLM icon 必须经过 `ProviderBrandIconImg` theme strategy；彩色资产保持原色，`currentColor` mono SVG 在 dark/dim/system-dark 自动反白，白字品牌继续使用 dark tile。
- product ready 时完全移除旧 engine-scoped subscription/usage fallback，避免混入历史或无关套餐。
- sidebar shortcut 继续 lazy load，第一层只展示账号身份与整数 percentage；身份区进入账户详情顶部，usage 区进入/聚焦同页 usage section。

## 6. Compatibility and Rollout

- renderer 已删除旧 `AccountAppGate`、engine-scoped subscription/usage cards、engine checkout client 与 associated copy；shipping route 只能构造 `ProductAccountAppGate`。Native authority 中的兼容数据不得恢复旧 UI。
- 旧 local provider/config 代码与 Local Mode 数据不删除，但 product-ready flow 不暴露 local channel，也不得从历史 selection、global active profile 或 disk config 继承它。只有退出 product flow 的独立 Local Mode 才可继续使用旧 local/expert channel。
- rollback 只允许回退 Product Gate 实现；不得恢复按引擎订阅选择或旧 engine checkout client。

## 7. Request-Storm Safety

- Gate catalog、subscription、prepare 具备 in-flight dedupe 与 generation cancellation。
- 模型 catalog 使用 30 秒 freshness window、single in-flight owner 与 last-known-good。ready 后以 window focus/visibility event 驱动刷新，并使用 60 秒可见窗口兜底；picker 提供显式刷新，禁止按键/hover 触发远端请求。
- account shortcut 保持 click-to-load；usage 只在目标 surface 主动读取。
- 429 保留 `retryAfterMs` 并禁用重试至 cooldown，不显示泛化“准备没有完成”。
- Account detail usage 与 billing 分别 in-flight dedupe；period generation 只允许当前 selection 写回。刷新保留 last-known-good，不回到整页 blank。
- Native 在取得/刷新 access token 后释放 account state mutex，再执行 usage/order network reads；禁止长请求持锁阻塞 logout/profile/security。
- Product plan card 使用固定 information hierarchy 而非整卡文字按钮：brand → plan name/price/validity → engine row → upstream feature/model row → full-width CTA。商业 name/price/currency/validity/description/features 继续来自 token2api；engine row 来自 Doge registry。
- Account usage range Popover 必须使用 opaque `surface-popover`，不得让下层 stat cards/table header 穿透影响日期与 preset 可读性。

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
