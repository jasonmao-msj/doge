# Doge 全产品统一订阅

## Goal

将当前按 engine / model 分散订阅的产品形态升级为 Doge 产品级统一订阅：用户只付款一次，Doge 与 token2api 自动为账号开通当前套餐包含的 GPT、Claude、豆包等能力，并可在未来无感扩展 Kimi、GLM、DeepSeek 等模型族。

本轮追加目标：验收 Kimi 托管全链路与 macOS 稳定本地签名，并把 Account Center 收敛为原型所示的单页账户详情。页面真实读取订阅周期、请求/Token/费用/平均耗时、model breakdown 与 subscription orders；慢接口按 section 渐进加载，任何统计缺口都显式降级，禁止把原型示意值当生产数据。

用户进一步明确开发效率目标：macOS 日常 `npm run tauri:dev:hot` 必须可由 E2E Agent 无人值守启动，不能弹 Keychain 密码授权。仅 macOS debug build 改用 repo 外、owner-only 的 local development vault；Release 继续使用 Keychain。

本轮最终目标升级为 **dynamic upstream product catalog**：订阅生效后，Home 新建会话与 Shared 下一 Turn 使用同一份可刷新的 product entitlement catalog。具体 model id 不再写死在 Doge；上游新增/删除模型后，客户端通过 focus/visibility、60 秒兜底与主动刷新收敛。Provider 固定由 Doge 托管，不进入产品选择器；display name、catalog id 与 runtime model 分域。

## What I already know

- 用户不应理解或分别购买底层 provider、API Key、engine 或 model。
- 一次订阅应获得一组由产品套餐定义的模型能力。
- token2api 提供单一的 Doge 套餐；首期包含 OpenAI-compatible 与 Anthropic-compatible 两类协议能力及其对应模型。
- Doge 启动时只判断用户是否拥有有效的 Doge 套餐：无权限进入统一订阅界面，付款履约完成后进入 App；有权限直接使用全部功能。
- 用户只选择 engine 与 model，不选择套餐内的底层 API Key / group / protocol credential。
- engine 是 Doge 内置的本地执行能力，不属于套餐 entitlement，也不由上游订阅 catalog 决定。
- model 是套餐提供的远端能力；订阅生效后，Doge 从上游 `/models` 类接口读取该用户当前可用的统一模型列表。
- Doge 仍需根据用户选择的 engine 和 model，自动完成 credential、runtime model 与 upstream route 的投影。
- 产品将继续扩展模型族，因此不能把 entitlement 写死为 Codex / Claude 两个分支。
- 当前阶段按 OpenSpec `explore -> propose -> apply` 实施 Doge 客户端；不修改或发布 token2api 生产代码。

## Assumptions (temporary)

- token2api 继续作为账号、支付、订阅、额度与 managed credential 的 authority。
- Doge 只消费产品目录与 entitlement，不自行判断某个用户“理论上应该有”哪些模型。
- 一个产品订阅可以包含多个 model capability，并由 token2api 统一计费与限额。

## Quota Decision

- 客户端以 token2api Composite subscription/group 返回的 quota windows 为 authority，不自行拆分 engine 或 model 额度。
- 若上游未来提供 model-family 独立额度，Doge 仅按返回的 product/model projection 渐进展示，不改变购买动线。

## Requirements (evolving)

- 登录后只展示 Doge 产品套餐，不展示底层 API Key 或单模型订阅。
- 未获得有效 product entitlement 时，订阅 Gate 必须覆盖整个 App workspace；sidebar、workspace、对话与设置入口均不可见且不可操作，订阅履约准备完成前不得解锁。
- 套餐卡直接消费上游 plan 返回的 `name`、`price`、`description` 等展示字段；客户端不硬编码“模型 / 目录 / 配置”等能力清单。
- Gate 主标题下不重复展示套餐卖点；套餐说明仅由卡片中的上游 `description` 承载。
- 支付成功后自动开通套餐包含的全部模型能力。
- product prepare 必须先确保 Codex、Claude Code、Kimi CLI 可执行：前两者优先使用已验证 external 或内置 bundle，Kimi 仅在缺失时自动安装；安装/验证失败不得进入 ready。
- Account Gate 从 engine-scoped entitlement 升级为 product-scoped entitlement；启动主链不再要求用户先选择引擎。
- 对话框点击当前模型入口后，右侧滑出 engine/model 组合选择面板。
- 组合面板采用 Doge 原生右侧栏视觉，不使用悬浮卡片；打开时占据固定右侧区域，主内容同步让位。
- 组合面板第一栏为内置 engine 单选，第二栏为套餐 model 单选；engine / model 均展示品牌 icon。
- model 选择不得改变 engine；切换 engine 时只保留仍兼容的 model，否则原子选择该 engine 在上游 catalog 中的第一个 released model。
- model entitlement 来自上游统一 catalog；可选列表按上游可选 `compatible_engines` 求交集。当前字段缺失时按 GPT/Claude/Kimi/豆包 family fallback 动态投影，unknown family fail closed；Doge 不维护具体 model id allowlist，也不得增加上游未返回的 model。
- model 区支持搜索与平铺列表，engine / model 点击后立即生效，面板保持打开以支持连续切换。
- 选择完成后，对话框底部同时展示 engine icon、model icon 与 model display name。
- 原型需示意 Codex、Claude、Kimi CLI 三个 Doge 内置 engine，以及上游 catalog 返回的 GPT、Claude、豆包、Kimi、GLM、DeepSeek 模型族；本轮仅验证 UI 信息架构，不声明生产 catalog 已接入。
- 新增模型族时，应主要通过服务端 catalog / entitlement 配置扩展，避免每次都改造支付链路。
- Doge 的 engine、model、provider route 三者仍保持独立 identity；Home/Shared/Account Center 必须消费同一个可刷新 catalog snapshot，不得复制静态模型表。
- Product-ready Home / Shared SHALL 以同一上游 catalog 为 entitlement ceiling，并按 selected engine 展示 released subset。切换 engine 时 current model 兼容则保留，否则原子 fallback；切换 model 仍不得改变 engine。
- Product flow SHALL 使用独立右侧 engine/model panel，隐藏 provider/channel/configuration/Add model/Refresh config 等 expert controls；trigger 同时展示 engine icon 与 model icon/name。
- Product model `catalog entry id`、用户 `display name` 与 CLI/API `runtime model` 必须分域；UI 只把 display name 作为主标签，Kimi fallback namespace 等 presentation identity 不能覆盖 raw runtime model。
- model catalog refresh 使用 30 秒 freshness、single in-flight、60 秒 visible fallback 与 focus/visibility event；pending/failure 保留 last-known-good，不清空对话或 Account Center。
- 已创建 Native Session 继续遵守固定 engine/provider binding；跨 engine 选择创建新会话/Continuation，不在原 Native Session 内热切 Runtime。Shared Session 可按既有 durable target contract 在下一 Turn 切换。
- 任意组合运行失败时显示原组合的 typed failure 并保留选择；禁止静默改用另一个 engine/model/provider。
- 开通、续费、过期、退款、套餐升级与 webhook 重放必须幂等。
- 账号入口在 entitlement 生效后恢复可用；点击 sidebar 账号按钮进入用户中心，用户可以返回对话主界面。
- 用户中心订阅页只展示一个 product-scoped Doge 订阅，不再按 Codex / Claude 等 engine 拆成多张订阅卡。
- 用户中心订阅详情展示上游返回的 plan 名称、订阅状态、到期时间与当前可用模型 catalog；卡片首层不重复展示 price、validity、description 或 catalog 更新时间。到期日以 `YYYY-MM-DD` 紧邻标题展示，“可用模型”后直接显示数量，模型明细继续渐进披露。
- 侧边栏账号入口采用 preview → detail 两级动线：第一次点击仅在当前页面弹出由上游 usage windows 驱动的轻量用量概览，概览只展示取整后的使用率百分比；点击概览中的“用量”区域后进入账号中心“用量”Tab，点击账户身份区域则进入“订阅”Tab。完整详情页继续展示实际用量与总额度。
- 统一订阅改造不得回退既有账号生命周期：账号中心继续保留 capability-driven 的显示名称编辑、修改密码、当前设备退出、全部设备退出、安全状态与身份绑定；未订阅 Gate 也必须能退出并切换账号。旧的 per-engine managed credential 状态不进入统一产品账号中心。
- 用户中心用量按 product subscription 汇总并可下钻到 model usage；engine 不作为计费或订阅分组。原“独立 Usage Tab”要求由本轮单页账户详情 supersede。
- Account Center 采用单页滚动详情，而不是让用户先在“订阅/额度”Tab 间寻找信息：页头与 profile/subscription status 立即可见，usage 与 billing 独立渐进加载。
- usage 支持“本期/上期”。本期优先使用 token2api subscription progress 返回的 monthly `window_start / resets_at`；上期使用紧邻的前一 30-day window。缺少 window authority 时使用明确标注的最近 30 天 fallback，不伪造套餐周期。
- usage summary 动态展示 total requests、input/output/cache/total tokens、standard/actual cost 与 average duration；model TOP 使用 group-scoped dashboard model stats。
- “按引擎”聚合只有在上游返回 authoritative engine/platform dimension 时才展示数值。当前 token2api 不记录 Doge runtime engine，Doge 只展示静态 engine roster 与 unavailable explanation，禁止按 model 名或 User-Agent 猜测。
- billing 读取 `/api/v1/payment/orders/my` 的 subscription orders；上游未提供 invoice artifact/download endpoint 时不伪造下载能力。
- usage 与 billing 各自维护 loading/error/last-known-good；切换周期、刷新或某个 section 失败不得清空 profile、entitlement 或另一个已成功 section。
- Kimi managed launch 必须为当前实际发送的 runtime model 生成 bare alias 与 `doge/` alias，不能只配置一个硬编码 default 后宣称整个 product catalog 可用。
- Product checkout plan projection 必须完整满足 frontend parser：`original_price / currency / validity_days / validity_unit / features / quota limits` 明确映射；generic token2api plan `price` 的 base currency 以 upstream subscription USD contract 投影为 `USD`。
- `cfg(all(debug_assertions, target_os = "macos"))` 下 refresh credential 与 managed Codex/Claude/Kimi key 只写 app-data debug vault，不读取/迁移/fallback Keychain；目录 `0700`、文件 `0600`、拒绝 symlink、secure atomic write。其他 build 保持 OS vault。

## Data Ownership Matrix

| UI 信息 | Authority / 数据源 | Doge 处理规则 |
|---|---|---|
| 账号显示名、邮箱 | token2api profile API | 只做安全 label projection，不在客户端伪造 |
| 显示名称编辑、修改密码、全部设备退出等操作能力 | token2api account capability / 对应 mutation API | 仅在服务端能力可用时展示入口；成功后刷新 session，修改密码后强制重新登录 |
| 两步验证状态、身份绑定 | token2api security / identity API | 使用紧凑安全弹层渐进披露；不混入产品订阅卡，也不展示 legacy managed key |
| plan id / name / description / price / original price / currency / validity / features / quota limits / sort order | token2api plan catalog（现有 engine plan 已具备这些字段，统一产品机制迁移到 product plan） | Gate、支付弹窗与用户中心复用同一个 plan view model，禁止分别写文案 |
| entitlement status / subscription id / expires at | token2api subscription authority | 决定 Gate 是否锁定、用户中心状态与到期时间 |
| checkout status / expires at / plan name / payment action | token2api checkout API | Doge 只渲染二维码或打开 payment URL，并轮询终态 |
| model catalog id / display name / runtime model / entitlement availability | token2api `/v1/models` 类 catalog | 作为 entitlement ceiling；`display_name` 用于 UI，`model/runtime_model/id` 按优先级组成调用名，私有 account mapping 仍由 token2api 负责 |
| model description / icon key / sort order / family / capabilities | product catalog metadata（现有通用 `/v1/models` 尚不完整提供） | 正式实现前需补齐上游 metadata；Doge 不维护业务文案副本 |
| engine id / display name / icon / installed status | Doge 内置 engine registry | 与 subscription 无关，由本地 runtime 管理 |
| model icon asset | Doge presentation registry，根据上游 `iconKey` / `family` 选择 | 只维护渲染资产，不决定模型权限与可用性 |
| 当前选中的 engine + model | Doge conversation/session state | 持久化完整 compatible target；engine 变化造成 model fallback 时一次原子提交 |
| 页面标题、按钮、空态、错误提示 | Doge i18n | 属于客户端交互 copy，不来自商业 catalog |

## Acceptance Criteria (evolving)

- [ ] 用户一次付款后，重新进入 Doge 即可使用套餐包含的全部受支持模型。
- [ ] Doge 不要求用户选择或感知 API Key。
- [ ] 未订阅、已过期、额度耗尽与某模型不可用均有清晰且可恢复的产品动线。
- [ ] 新增 Kimi / GLM / DeepSeek 等模型族时无需复制一套支付与账号流程。
- [ ] 服务端 entitlement 与客户端实际可选模型一致，不出现“能看不能用”或“已开通但不可见”。
- [ ] 有效账号打开 Account Center 时，profile/subscription 首屏不等待 usage/billing；两个慢 section 显示结构化 skeleton 并可独立完成或失败。
- [ ] 本期/上期切换使用 exact date range，请求乱序时旧 response 不覆盖新选择；retry/refresh pending 防重复提交。
- [ ] 统计卡、model TOP 与账单全部来自 token2api response；无 engine breakdown/invoice download authority 时显示 truthful unavailable，而非示意数字或假按钮。
- [ ] Product catalog 的真实 checkout-info fixture 可通过 Rust wire 与 TypeScript parser，不再稳定触发 `protocolMismatch`。
- [ ] Kimi 选择非默认 product model 时，launch home 中存在该 raw model alias，`config.json` 仍无 secret，runtime `config.toml` 保持 owner-only。
- [ ] macOS dev-signed runner 的 setup 幂等、contract test、实际 binary signature/designated requirement 均可验证；不把本地自签结论扩大为 Gatekeeper/release signing 结论。
- [ ] 标准 `npm run tauri:dev:hot` 冷启动与重启均无 Keychain authorization；首次 debug 登录后 session 与三类 managed engine key 可从 app-data local vault 恢复。
- [ ] checkout 已 paid 但 entitlement 延迟时保持“正在开通”并自动重试，不能退回套餐页；App restart 后继续同一 paid fulfillment，不创建重复订单。
- [ ] 套餐选择页与原型一致使用独立 card、plan header、引擎/模型信息行和整宽 CTA，不再把 name/price/description 压成一行。
- [ ] Product-ready Home / Shared / Account Center 使用同一动态 catalog；上游新增/删除 conversation model 后无需 Doge 发版即可在 bounded refresh 内收敛。
- [ ] model display name 与 runtime model 分域；若上游显式返回 `display_name=豆包, model=ark-code-latest`，UI 只显示豆包且 Runtime 发送 ark；若只返回公开 `id=豆包`，Doge 发送豆包并由 token2api 处理私有 mapping。
- [ ] 当前动态目录中的每个可选 engine/model 组合都有真实 CLI typed terminal evidence；minimal endpoint probe、账号白名单或 catalog presence 不单独构成 ready。
- [ ] Product picker 不出现 provider/channel/configuration 入口；实际 dispatch receipt/wire history 可证明 selected runtime model 未回退全局默认。

## Definition of Done (team quality bar)

- OpenSpec proposal / design / tasks / spec delta 完整。
- token2api 与 Doge 的 API contract、幂等语义、缓存与失效策略明确。
- 按风险分层补齐 backend、frontend 与 contract tests。
- rollout、兼容旧订阅、回滚与生产观测方案明确。

## Out of Scope (explicit)

- 不修改 token2api schema、payment fulfillment、admin UI 或生产部署。
- 不迁移既有生产订阅；旧 engine-scoped 订阅不自动推断为 Doge product entitlement。
- 暂不在客户端决定具体售价、营销文案与模型成本配比，这些信息均来自上游 plan。
- 不在本轮修改或发布 token2api；现有 user usage/order routes 已覆盖动态详情。
- 不实现 engine-attributed usage、invoice PDF 下载、退款/换套餐 mutation；这些需要上游新增 authoritative contract。
- 不宣称完成真实第三方支付回调或 Windows/Linux vault smoke。Kimi exact CLI 对话已通过；Codex/Claude 当前仍需 token2api production account pool / Composite route 配置后才能完成 typed terminal 验收。

## Technical Notes

- token2api `origin/main` 已支持 `Composite` group：一个 group 可通过 model route 映射到 OpenAI / Anthropic 等不同 endpoint，并由 `/v1/models` 聚合可调度模型。
- 当前 Desktop engine endpoints 仍是 engine-scoped，无法直接识别 Composite product；Doge 本轮复用 generic checkout、subscription summary、API key/handoff 与 `/v1/models`，不要求上游改造。
- product managed credential identity 收敛为 `user + device + composite group`；OS vault 是 secret 的持久化事实源，secret 不进入 renderer。Kimi CLI 启动所需的 owner-only runtime config 仅由 Native 在隔离目录生成。
- 上述 production secret contract 在 macOS debug 有显式 development exception：同一 `DurableAccountVault` contract 由 app-data file backend 实现，以解除 E2E 系统授权阻塞；该 exception 由 compile-time cfg 决定，不提供 runtime switch，Release 仍以 OS vault 为事实源。
- Doge `AccountAppGate` 与 `engineOnboardingClient.ts` 当前将 entitlement / plans / checkout 全部建模为 engine-scoped，需要升级为 product-scoped gate。
- Doge `ModelSelect.tsx` 当前是 nested `engine submenu -> model list`，改造成 Doge 原生右侧 side panel；engine registry 与 product model catalog 分别作为两个独立数据源，`ExecutionTarget` 只在最终执行时组合二者。
- token2api `main` 已提交 user routes：`GET /api/v1/usage/stats`、`GET /api/v1/usage/dashboard/snapshot-v2`、`GET /api/v1/subscriptions/progress`、`GET /api/v1/payment/orders/my`。这些足以实现 period summary、model stats、quota range 与 billing；不存在 engine-runtime aggregation 或 invoice artifact endpoint。
- 原型 `yuanxing.html` 注释明确声明 requests/Token/cost/latency/invoices 为示意数据；本 change 只继承其 information hierarchy、spacing 与 progressive disclosure，不继承示意 business facts。
- 代码审计发现原 tasks §5 与实际不一致：`AccountCenter` 仍消费 legacy engine-scoped panels，`ProductUsageOverview.tsx` 无调用点；§8 product plan wire 也缺少 frontend parser mandatory fields。以下实现以代码事实纠偏任务勾选。
- Kimi 当前目标是 npm `@moonshot-ai/kimi-code`（2026-08-23 latest `0.38.0`）；官方 current config 仍为 `$KIMI_CODE_HOME/config.toml`，Chat Completions provider type 为 `openai`。`~/.kimi` / `openai_legacy` 属于逐步退役的 Python `kimi-cli` 文档，不用于本 runtime。

## Account Detail Data Matrix

| Surface | token2api authority | Doge behavior |
|---|---|---|
| Profile / email | existing Account profile bootstrap | 立即渲染，保留 edit/password/security/logout |
| Plan / status / expiry / quota | product entitlement + subscription progress | 立即显示 entitlement；progress 到达后补 exact range/reset |
| Requests / tokens / cost / latency | `/usage/stats?group_id&start_date&end_date` | strict parse；section-local retry |
| Trend / model TOP | `/usage/dashboard/snapshot-v2` | 与 stats 并行；只显示 authority rows |
| Engine roster | Doge built-in registry | 静态展示 Codex/Claude/Kimi；usage count 显示 unavailable |
| Subscription bills | `/payment/orders/my?order_type=subscription` | 独立加载最近记录；无 invoice download action |

## Decision (ADR-lite follow-up)

**Context**: Account detail 涉及多个慢 read，但 profile、entitlement、usage 与 billing 的可用性并不相同；原型数据不可进入生产。

**Decision**: 使用 product store 作为即时 profile-adjacent entitlement projection；新增独立 `product usage` 与 `product billing` read commands/clients/hooks。Native 只接受 closed period enum，在服务端重新验证 active Composite subscription/group；network await 不持有 account state mutex。Frontend 使用 exact request generation、section-local last-known-good 与 skeleton/error state。

**Consequences**: 页面能渐进完成且 partial failure 可恢复；新增两个 read-only IPC contracts 与 focused tests。engine breakdown 与 invoice download 保留可扩展 UI slot，但在上游提供事实前不显示伪数据。

## Research Notes

### 2026-08-23 Engine × Model protocol matrix（历史证据，动态目录实现不得忽略）

- Doge runtime fact：Codex managed provider 使用 OpenAI Responses；Claude Code 将 safe model id 透传到 Anthropic Messages；Kimi CLI 将 raw model id 透传到 Chat Completions，并由 isolated provider home 动态生成 alias。
- token2api source 已包含基础协议转换，但 Composite→OpenAI Messages 仍有硬 gate，且真实 CLI payload 可暴露 minimal probe 看不到的兼容问题；完整自由组合不能仅靠现有 adapter 宣称成立。
- 真实套餐 key 的最小 21-combination probe：`kimi-for-coding` 与 `kimi-for-coding-highspeed` 在 Responses/Messages/Chat 均为 HTTP 200；五个 GPT models 在 Responses/Chat 为 HTTP 503（OpenAI account pool unavailable），在 Messages 为 HTTP 403（Composite group `allow_messages_dispatch=false`）。
- 真实 CLI payload follow-up：`Kimi CLI × kimi-for-coding` 成功；`Claude Code × kimi-for-coding` 虽然 generic Messages probe 为 200，但真实 Claude Code client 被 production client-sensitive routing 以 `claude-code:unrecognized_model` 拒绝；`Codex × kimi-for-coding` 的简单 Responses probe 为 200，但真实 Codex Agent payload 两分钟无首包。Endpoint 200 不能替代 CLI payload compatibility evidence。
- 后续生产复核发现 GPT 503 的直接配置根因是 `Doge APP` 仅属于 Kimi Channel，无法取得 OpenAI pricing/routing；Claude→GPT 403 则是 token2api Composite Messages 硬 gate。结论：先发布按引擎过滤的初版，完整 Cartesian product 延后。

### Feasible approaches for free combination

**Approach A: Dynamic family-compatible subset（采用）**

- Home/Shared picker 继续消费同一 product entitlement snapshot；具体 model ids 完全来自上游，provider 固定 `doge-token-matrix`。
- 上游若提供 `compatible_engines/capabilities`，Doge 直接消费；缺失时过滤明确非对话 rows，并只对 GPT/OpenAI、Claude/Anthropic、Kimi/Moonshot/K3、豆包/Ark Coding 这些已知 family 投影对应 adapter，unknown family fail closed。E2E/typed failure 继续暴露 route gap，不静默换模型。
- 切 engine 时可能需要原子 fallback 到该 engine 的第一个 compatible model；刷新删除当前模型时采用同一 repair contract。

**Approach B: Product-owned Cartesian catalog（延后）**

- 只有当目标 cell 通过真实 CLI Agent payload terminal 验收后，才逐步扩大到跨 family 自由组合；token2api source/adapter 缺口不得由 UI 假装完成。

**Approach C: Client runtime probing（不采用）**

- 每次登录为每个模型调用三种协议探测。
- 缺点：慢、消耗额度、产生请求风暴且结果受临时 account pool 波动影响，不适合作为客户端 entitlement authority。

### What similar product systems do

- Product / price / entitlement 分层：用户购买 Product，价格由 Price/Offer 表达，实际功能访问由 active entitlement 表达；功能集合可随产品演进，不要求客户端理解支付订单细节。
- 这与 Stripe Billing Entitlements 的 Product → Features → active entitlements 模型一致，适合把模型能力从售价和支付流程中解耦。

### Feasible approaches here

**Approach A: 复用现有 Composite group（采用）**

- 一个 Doge plan 绑定一个 Composite group；支付后创建一个 active subscription。
- 一个 managed Composite key 按 model route 跨 OpenAI / Anthropic 等 endpoint 调度。
- Doge 只读取 product entitlement 和 server-owned `/v1/models` catalog；新增模型由上游 route/catalog 配置完成并在 bounded refresh 内进入 Doge，不再修改客户端 exact-id manifest。

## Decision (ADR-lite): Dynamic catalog over exact-id release manifest

**Context**：生产 `/v1/models` 已返回动态 `id + display_name`，当前 exact 7-model manifest 会让上游新增 Claude/GPT/Kimi 模型不可见；同时 `/v1/models` 不暴露 admin-only `model_mapping` 右值。

**Decision**：删除 exact-id manifest。Native 保留上游 display/runtime/compatibility metadata 并安全投影；Frontend 通过一个 refresh coordinator 向所有 consumer 发布 last-known-good snapshot。调用名只来自公开 catalog 字段，禁止根据 display name 或浏览器 admin 信息猜测。

**Consequences**：新模型可无客户端发版出现；慢/失败刷新不清空 UI；若上游目录广告不可路由模型，真实 E2E 会以 exact target typed failure 暴露，需要上游 route/config 修复，Doge 不做 silent fallback。
- 优点：不新增 schema 或支付链，用户心智与服务端 truth 都只有一个产品订阅。

**Approach B: bundle order 批量创建多个 platform subscription（不采用）**

- 会产生部分履约、续期、退款、额度合并和 model 扩展复杂度，也不符合已经配置好的 Composite product 事实。

**Approach C: 新增 product entitlement schema（暂不采用）**

- 未来若需要一个商业产品同时授权多个相互独立的 quota pool，可再引入 additive product entitlement；当前 Composite group 已足够，无需提前扩大上游改造面。

## Decision (ADR-lite)

**Context**: 用户购买的是 Doge 产品，而不是 engine、model 或 protocol。

**Decision**: 采用现有 Composite Approach A。Composite subscription 是启动 Gate 的唯一商业 authority；OpenAI / Anthropic / Kimi / GLM / DeepSeek 等 model route 是产品 capability。API key 仅负责 routing、billing 与 Native credential，不进入用户心智。

**Consequences**: token2api 本轮无需改代码；Doge 需要一个 product-scoped Native adapter、AccountGate 和 engine/model 组合选择器。现有 engine runtime、provider profile、ExecutionTarget、generic payment 与 Composite routing 可复用。
