# integrate-token2api-account-system：token2api 账号增值层

## Goal

将已完成的跨项目研究与最终产品决策收敛为正式、可实施的 OpenSpec 输入。目标态中 doge App 是 token2api 的完整账号交互端：用户无需离开 doge 的产品 journey 即可完成注册、条件式邮箱验证、登录、MFA、OAuth、忘记/重置密码、会话恢复/退出及 token2api 已有的必要账号生命周期流程；doge 复用 token2api 现有 API 与业务规则，不重造第二套账号后端。Local Mode 永远无需登录且完整可用。首个本地打包试用 release 聚焦完整 account access、主动查看额度/用量与 Codex 一键配置；billing、device/session management、multi-account、remote/daemon/web 等 P5+ 能力继续保留在 Comprehensive Master Plan，但不作为首包 blocker。本轮只落 PRD、proposal 与 product behavior spec delta，不写实现；用户已授权后续 software delivery 按 contract、review、conformance 与 acceptance gates 持续推进至可本地安装试用的打包产物。

## What I already know

- 目标系统：`/Users/jason/GitHub/doge`。
- 账号体系来源：`/Users/jason/GitHub/token2api`。
- 用户将其定义为巨大需求，要求先深度调研并制定完整方案。
- 用户已确认 doge 的 Local Mode（本地模式）不要求登录，并完整保留所有既有本地能力；login、account、entitlement、grace period 或 token2api outage 均不得成为既有本地功能的 gate。
- 用户已确认登录是 opt-in enhancement，只服务两类用户：不会手工配置的用户，以及希望便捷接入 doge token service 的用户。
- 用户已确认登录后的长期收益包括便捷配置、快速接入 doge token service，以及清楚了解额度、用量和后续 subscription 等服务状态；这些均是叠加在上游 ccgui 本地能力之上的 doge 增值功能。
- 用户已确认 OS vault locked/unavailable 时保持完整 Local Mode；不允许 session-only account mode，也不自建 fallback vault。
- 用户已确认 account convenience capability 必须与上游 ccgui 原功能低耦合，便于后续同步上游和 doge 独立维护。
- 用户已确认 doge App 必须成为 token2api 的完整账号交互端，覆盖注册、登录、找回/重置密码及 token2api 已有的必要账号生命周期；App 是新增 client surface，不是新增 identity authority。
- 用户已确认凡 token2api current API 已提供的账号能力，doge 必须通过独立 typed adapter 尽量原样复用，不复制 handler/business rule，不建立平行账号后端；只有 current API 确实无法满足安全 desktop completion 时才登记最小 contract gap。
- 用户已冻结未来开发策略为 **Contract-first + Mock-first UI + Parallel backend + Late integration**：Frontend Experience、Doge Native Broker、token2api API/gaps 三条 lane 在 versioned contract 冻结后并行推进，UI 评审确认且各实现通过 contract conformance 后才替换 adapter 并进入 integration/e2e。
- 用户已确认本版本先形成大而全面的 Master Plan，完整保留 billing、quota/usage、device/session management、remote/daemon/web 等长期范围；实际交付允许按 release cut 和 dependency 分阶段推进。
- 用户已明确 post-login onboarding：用户登录成功后弹出“一键配置”提示；仅在用户同意后自动修改目标配置文件，并展示本次修改涉及的文件列表。
- 用户已确认首个一键配置 recipe 为 **Codex**；其他 recipes 保留在后续 release cuts。
- 用户已确认 **Settings → Account** 是唯一固定、持久入口；仅在 token service/configuration 相关上下文提供轻量入口，不增加第二个全局固定入口。
- 用户已确认首期 quota/usage 只支持用户主动查看；不发送临近阈值、耗尽、刷新异常等 proactive notices。
- 用户已授权在正式 OpenSpec 输入与实现前置 gates 完成后继续软件开发，直到产出可本地安装试用的打包版本；该授权不绕过 design/tasks、security、contract conformance、integration/e2e 或用户体验验收。
- 文件变更详情采用 progressive disclosure：默认只展示 changed file list，用户点击某个文件后再展开该文件的 diff。
- 结果弹窗可通过“已知晓”关闭；为防误关，关闭后保留 doge 头像气泡，可再次点击恢复弹窗；气泡左上角提供 `×`，用于彻底关闭该入口。
- doge 是 `Tauri 2 + React 19 + TypeScript + Rust` 桌面应用；账号接入预计会跨越 UI、frontend state、Tauri command、Rust runtime、local storage、remote API、security/privacy、observability 与 release。
- 对应 OpenSpec change：`integrate-token2api-account-system`。

## Assumptions (temporary)

- “接入账号体系”的 Master Plan 包含 authentication、session/token lifecycle、profile、token key provisioning、recipes、entitlement/plan、quota/usage、subscription、billing、device/session management、logout/revocation、多账号演进和 remote/daemon/web；各阶段具体 contract 仍须以 current code evidence 与已确认产品原则校准。
- token2api 继续作为 account identity/profile/session/quota/subscription 等 remote source of truth，doge 作为新增 desktop interaction client；该 authority boundary 已确认，不再把“doge 自建账号后端”列为候选拓扑。
- 新增的 remote/token-service capability 需要可恢复的 offline/degraded behavior；其降级策略不得影响 Local Mode 的既有本地能力。

## Open Questions

无。影响首个本地打包试用 release 的产品功能与交互问题均已回答并冻结：first recipe 为 Codex；Settings → Account 为唯一固定入口、token service/configuration contexts 可提供轻量入口；quota/usage 首期只允许用户主动查看且无 proactive notices。Credential storage、configuration transaction、跨平台文件处理、redaction、identity authority、session lifecycle 与 failure isolation 继续作为内部 Engineering Constraints 和 blocking gates，不回到产品问答主线。

## Decisions (ADR-lite)

### ADR-001: Local-first optional account with comprehensive planning and phased delivery

- **Status**：Confirmed。
- **Context**：doge 已有完整的本地使用路径；账号体系的价值是降低配置门槛并便捷接入 doge token service，而不是重新定义现有产品的可用资格。
- **Decision**：
  1. 未登录状态统一称为 **Local Mode（本地模式）**，不得描述为受限层级。Local Mode 必须完整保留所有既有本地能力。
  2. login/account/entitlement/grace period/token2api availability 只可影响新增的 account-backed 或 token-service capability，不得阻断、降级或延迟既有本地功能。
  3. Master Plan 必须一次性覆盖长期完整范围；execution 按 dependency 和 release cut 分阶段推进，不以阶段交付为由从计划中删除 billing、quota/usage、device/session、multi-account 或 remote/daemon/web。
  4. 每个阶段都必须以“不破坏 Local Mode no-login baseline”为 blocking acceptance gate；token2api outage、session expiry、logout、revocation 或尚未实现后续阶段时，既有本地能力仍应可用。
  5. 既有 post-login configuration interaction 保持不变：登录后提供 opt-in 一键配置，只有 explicit consent 才能写文件，并保留 changed-file list、lazy redacted diff、acknowledge close、bubble reopen 和 bubble permanent close。
- **Consequences**：账号体系不能成为 app startup 或本地 capability 的前置条件；entitlement、quota、subscription 与 billing 只约束其明确对应的新增服务。Architecture、state model、QA matrix、rollout 和 observability 均需分别验证 Local Mode 与 account-backed mode，且远端故障必须隔离在 account/token-service boundary 内。

### ADR-002: OS-vault-only durable credential policy

- **Status**：Confirmed。
- **Context**：account-backed convenience 需要 durable credential 才能安全完成跨重启登录、token key provisioning 与 configuration apply，但 OS vault 可能处于 locked、unavailable 或 unsupported 状态。
- **Decision**：
  1. Durable account credential 只允许存入 OS vault，并采用 dedicated `account × device × purpose` doge key boundary。
  2. OS vault locked/unavailable 时不得进入 session-only account mode，不得将 credential 写入自建 fallback vault、普通文件、SQLite、frontend storage 或 diagnostics。
  3. 该状态只暂停或隐藏需要 credential 的 account convenience capability，并提供可理解的恢复提示；Local Mode 与全部既有本地能力保持完整可用。
- **Consequences**：vault availability 是 account-backed capability gate，而不是 app/local capability gate。恢复 vault 后可重新发起登录或 provisioning；不得把 timeout、临时内存 session 或静默降级当作成功。

### ADR-003: doge is a complete token2api account client, not a second account backend

- **Status**：Confirmed。
- **Context**：若 doge 只提供“已有账号登录”，新用户和需要恢复账号的用户仍会被迫切换到另一套产品 surface，无法兑现低门槛 token-service onboarding；但复制 token2api 的注册、认证或账号规则又会制造双事实源和长期 drift。
- **Decision**：
  1. doge App 必须承载完整账号交互 journey：public capability discovery、email/password 注册、条件式邮箱验证码、登录、MFA、OAuth、忘记密码、重置密码、session restore/refresh、logout、profile 与已存在的必要 security/identity lifecycle。
  2. doge 通过 doge-owned account adapter 调用 token2api current API，服从其 public settings、rate limits、feature enablement、invitation/promo/email policy、Turnstile、MFA 与 backend-mode guard；不得在 doge 复制这些服务端业务规则。
  3. Current API 已覆盖的 capability 不新增平行 endpoint；current API 缺少 desktop-safe completion、durability 或安全语义时，先登记 gap 与 prerequisite，只允许增加最小兼容 contract，不重做 identity/profile/session domain。
  4. App account journey 与 post-login one-click configuration 是连续但独立授权的两段：完成 durable account session 后才能展示 adaptive configuration offer；登录/注册成功本身不创建 managed key、不写 config。
- **Consequences**：Account Center 必须同时支持“创建账号、进入账号、恢复账号、维护账号、退出账号”，而不只是 login form；token2api route/setting 变化通过 adapter/capability projection 隔离，Local Mode 与 ccgui upstream local flow 不出现 account branch。

### ADR-004: Contract-first parallel delivery with mock-first UI and late integration

- **Status**：Confirmed。
- **Context**：完整账号 journey 同时依赖大量 UI states、doge native authority 与 token2api gap closure。若 UI 等待 backend 才开始，用户体验反馈过晚；若 UI 直接耦合临时 API 或散落 mock，integration 时会产生大规模返工和 false completion。
- **Decision**：
  1. 先冻结 versioned Account contract：port operations、request/response DTO、closed states/errors、capability projection、scenario semantics、security boundary 和 conformance fixtures；三条 lane 共同以该 contract 为唯一交接面。
  2. Frontend Experience lane 在 integration 前不得真实调用 token2api 或 doge backend。UI 只依赖稳定的 `AccountGateway` / `AccountService` port，由可替换 Mock adapter 驱动；button handler、component 或 store 内不得散落 mock branching。
  3. Mock adapter 必须是 deterministic、stateful scenario engine，能够重放并断言 happy、validation/error、recovery、latency、offline/outage、MFA、OAuth callback、registration email code/link、password reset link、expired/replayed token、session expiry、vault unavailable 与 post-login configuration states；不得以“全部成功 response”代替行为模型。
  4. Doge Native Broker lane 与 token2api API/gaps lane 按同一 versioned contract 独立开发并运行 contract tests；各 lane 可并行，不得以 UI refinement 阻塞 backend，也不得以 backend 当前可用性迫使 UI 接受不成熟交互。
  5. 只有 UI 经用户多轮 review 确认、Mock scenarios 覆盖验收 journey、Real implementations 各自通过 contract conformance 后，才允许将 Mock adapter 替换为 Real adapter并进入 integration/e2e。
  6. Contract change 必须 versioned 并同步更新 Mock/fixtures/conformance suites；任何 lane 不得用私有字段、临时 endpoint 或 UI-specific shortcut 绕过 port。
- **Consequences**：Mock 阶段可以验证真实 interaction breadth，但不能宣称 backend integration 完成；backend 可以独立达到 contract-ready，但不能宣称产品体验完成。端到端完成需要 late-integration gate 后的真实 evidence。

### ADR-005: First local trial product cut and entry/value choices

- **Status**：Confirmed。
- **Context**：Foundation 产品原则、完整 account lifecycle 与 delivery strategy 已冻结，剩余选择只影响首个可试用包的入口、首个配置对象和 usage 呈现方式。
- **Decision**：
  1. 首个一键配置 recipe 固定为 **Codex**；其他 recipe 不进入首包 blocking scope。
  2. **Settings → Account** 是唯一固定、持久的 Account Center 入口；token service/configuration contexts 可以提供轻量 CTA 或 deep link，但不得形成第二套全局导航、平行账号状态或不同 journey。
  3. 首期 quota/usage 采用 pull-only：只在用户主动打开 Account Center 对应视图或执行明确 refresh 时读取；不发送 threshold、depletion、staleness 或 failure proactive notice。
  4. 用户已授权按正式 OpenSpec、design/tasks 与各项 gates 继续开发至本地打包试用；首包必须完成 Real adapter late integration 和 E2E，不得用 Mock-only 产物冒充可试用版本。
- **Consequences**：首包 acceptance 可以围绕单一入口、Codex 配置与主动 usage view 收敛；P5+ 商业化、设备、多账号、remote/daemon/web 与更多 recipes 仍在 Master Plan 中演进，但不阻塞首包。Contextual entry 与固定入口必须共享同一 feature slice、route/state 和 gateway；首期不得因 quota 状态打扰或限制 Local Mode。

### ADR-006: Codex 配置必须先选择已有 API Key

- **Status**：Confirmed（2026-08-13 用户修订）。
- **Context**：用户在 token2api 账号中已经拥有和管理 API Key；Doge 不应在“一键配置”内暗中创建一枚额外 key，也不应让登录行为隐式改变 credential inventory。
- **Decision**：
  1. Codex 配置 offer 的第一步必须读取当前账号下 active、未过期 API Key 的 renderer-safe metadata，并要求用户显式选择一枚 key 后才能进入配置 plan。
  2. 列表只展示名称、masked prefix、状态与必要的可用性，不向 renderer 暴露 raw key。选择动作授权 Native Broker 通过 desktop-safe、account/device/recipe-bound handoff 获取该 key，并写入 OS vault；它不授权写任何配置文件。
  3. 账号没有 Key 时，弹窗展示 `https://token-matrix.com/keys` 创建入口与“刷新”动作；从浏览器返回后停留在同一步重新读取列表，形成闭环。
  4. 首包产品流程不自动 provision 新 Key；`managedKey.provisionDedicatedKey` 从用户主路径移除。若服务端无法安全 handoff 某个 legacy key，该 key 只能显示为不可用于一键配置，不能退回 renderer plaintext、剪贴板或静默创建替代 key。
  5. exact config apply 仍是下一阶段的独立授权；完整 consent 顺序为 `login → select existing API Key → apply exact plan`。
- **Consequences**：token2api 需要 metadata-only list 与 owner-authorized Desktop key handoff；Doge 需要 key list/selection/refresh/website-return state、vault binding 与 selection-aware plan fingerprint。Security 页面管理的是“当前 Codex 使用的 API Key”，而不是自动创建的专用凭据。

## Product Value & User Outcomes

- **完整账号自助**：新用户可直接在 doge 注册并完成必要验证；已有用户可登录/MFA/OAuth；忘记密码用户可发起并完成重置；登录后可维护 profile/security/session，无需理解 token2api Web 控制台的页面结构。
- **小白零门槛配置**：不会手工编辑 CLI/config files 的用户，也能通过清晰引导、explicit consent 和可恢复的一键配置完成接入。
- **Token service 快速接入**：希望使用 doge token service 的用户无需理解底层 credential、endpoint 和配置格式，即可快速建立可验证的连接。
- **额度与用量透明**：登录用户能清楚看到 quota、usage、subscription/plan、freshness 和异常状态，减少“是否可用、为何失败、何时恢复”的不确定性。
- **配置健康与恢复**：用户能看到配置是否仍有效、哪些文件发生变化、reload 是否成功，并在 drift、partial failure 或服务异常后获得明确恢复路径。
- **长期服务收益**：subscription、billing、device/session management、multi-account、remote/daemon/web 等能力逐步形成 doge 独立增值体验，但始终不替代或限制 ccgui 原有本地功能。
- **可感知但不打扰**：未登录用户继续使用完整 Local Mode；account value 通过明确、可关闭、与上下文相关的入口呈现，不制造强制登录或持续打扰。

## Requirements

- Local Mode 不登录即可完整使用所有既有本地能力；不得引入 login/account/entitlement gate、grace period、联网要求或 token2api health dependency。
- 登录必须保持 optional，只为不会手工配置的用户与希望便捷接入 doge token service 的用户提供增值路径；产品文案、navigation 和 state model 必须明确 Local Mode 具备完整既有本地能力。
- OS vault locked/unavailable 时必须保持完整 Local Mode；不得提供 session-only account mode，不得实现自建 fallback vault。需要 credential 的增值功能必须 fail closed 并提供恢复指引。
- Account experience 必须优先交付用户可感知的收益：低门槛配置、token service 快速接入、额度/用量透明、配置健康与恢复；底层安全与可靠性作为这些体验的内部 engineering gates。
- doge 必须提供完整 account access lifecycle，而非 login-only surface：至少包含注册、按 server settings 决定的邮箱验证码流程、email/password 登录、TOTP MFA challenge、启用 provider 的 OAuth、忘记/重置密码、session restore/refresh、logout 与 session invalidation feedback。
- doge 必须覆盖 token2api current 已存在且对普通用户必要的 account maintenance：读取/更新 profile、修改密码、查看和管理 TOTP、查看和管理可用 identity bindings、撤销所有会话；具体入口与阶段可分批交付，但不得从 Master Plan 删除。
- 所有账号 form、provider、precondition 和 availability 必须由 token2api `GET /settings/public` 与 typed API response 驱动；registration/password reset/OAuth/TOTP/payment 未启用时不显示可执行假入口，也不得由 doge 自行放宽 server policy。
- Current API capability 必须通过独立 `Token2ApiAccountAdapter` 类边界复用；禁止在 doge 实现平行的 user table、password hashing、email verification、MFA validation、OAuth identity linking、quota/subscription calculation 或 billing settlement authority。
- Current API gap 必须显式登记为 prerequisite：没有 gap closure 之前对应 App action fail closed/hidden，其他 account capability 与 Local Mode 继续可用；不得用 Web token fragment、access-only success 或前端本地推断冒充 durable desktop account completion。
- Frontend account UI 必须只依赖 versioned `AccountGateway` / `AccountService` port；Mock/Real adapter 可替换，UI component、button handler 与 presentation store 不得知道 token2api route、Tauri command 或 mock implementation detail。
- Mock-first UI 阶段禁止发起任何真实 token2api HTTP request 或 doge Tauri/backend command；network/native 调用应由测试 gate 证明为零。所有可交互状态必须由 deterministic stateful scenario engine 驱动并可 reset、seed、advance、inject failure 与 inspect transition history。
- Doge Native Broker 与 token2api API/gaps 必须针对相同 versioned contract 和 shared conformance fixture 独立通过 contract tests；Mock 通过不代表 Real adapter 通过，Real endpoint 可用也不代表 UI behavior 验收完成。
- 计划必须 comprehensive，交付必须 phased：Master Plan 一次性定义长期 scope、contract、dependency、risk 和 acceptance；各 release cut 可按依赖实施，但每一阶段都必须通过 Local Mode no-login baseline 回归。
- 以 current code/spec/config/tests 为证据，分别产出 doge 与 token2api 的账号、认证、数据、部署及安全边界地图。
- 给出至少 2–3 个可行集成架构及 trade-offs，并明确推荐方案与拒绝其他方案的理由。
- 完整覆盖 user journey、API/IPC/data contract、credential storage、refresh/revocation、offline/degraded、migration/compatibility、security/privacy、observability、testing、rollout/rollback。
- 将方案拆成可独立验收的小阶段，明确 ownership、dependencies、risk gates、acceptance criteria 和已关闭的产品决策；后续实现不得隐式重开这些选择。
- 登录成功后进入 post-login configuration offer；任何本地配置写入必须由用户显式同意触发，不得将“登录”本身视为写配置授权。
- 一键配置必须先计算 plan/diff，再以事务化方式执行：覆盖目标文件检测、backup/rollback、atomic write、partial failure、concurrent edit、idempotency、权限错误和 retry。
- 配置结果默认展示 changed file list；点击文件后按需展开 diff。diff 必须按字段与语义 redaction secret，禁止把 access token、refresh token、API key、cookie 或其他 credential 显示在 UI/log/report。
- 弹窗关闭后，若用户未选择“彻底关闭”，显示可再次打开弹窗的 doge avatar bubble；bubble 自带独立 `×` hit target，避免与 reopen action 混淆。
- “已知晓”、普通关闭、bubble reopen、bubble `×`、登录状态变化、配置成功/失败/部分成功之间必须定义明确状态机和持久化边界。
- Settings → Account 必须是唯一固定 Account Center 入口；token service/configuration contexts 只可提供指向同一 journey 的轻量 CTA/deep link，不得创建平行入口体系。
- 首期 quota/usage 只能由登录用户主动打开对应视图或明确刷新时读取；不得发送 proactive threshold/depletion/freshness/error notices，且 remote quota 不得成为 Local Mode gate。
- 首个一键配置 recipe 必须为 Codex；非 Codex recipe 作为后续 release cut，不阻塞首个本地打包试用 release。
- 调研与方案必须区分 current fact、inference、recommendation 与 unverified item，并引用 repo-relative path、symbol、command 或配置证据。

## token2api Current Account Capability Matrix

事实源为 token2api current `backend/internal/server/routes/auth.go`、`user.go`、`payment.go`，对应 handlers/services 与 `frontend/src/api/**`、`frontend/src/views/auth/**`。表中 **Current API fact** 只描述当前代码存在的 contract；**Gap** 不代表授权实施，只是 doge 完整 App journey 的前置条件。

| User capability | Current API fact | Current prerequisites / behavior | doge reuse decision | Gap before doge completion |
|---|---|---|---|---|
| Capability discovery | `GET /settings/public` | 返回 registration、email verify、password reset、Turnstile、invitation/promo、TOTP、OAuth provider、payment、backend mode 等 enablement | doge 先读取并投影为 closed capability model；所有入口随 server capability 收敛 | 需定义 desktop adapter 的 stale/offline cache 展示，但不得伪造 enabled |
| Email/password registration | `POST /auth/register` | `registration_enabled` 必须开启；可能要求 email suffix、invitation code；可携带 promo/affiliate；受 Turnstile/rate limit/backend-mode guard 影响 | 原样复用 request/response 语义与服务端校验；doge 只负责 form/journey | `respondWithTokenPair` 当前允许 refresh-store 失败后 access-only success；doge durable session 必须 fail closed，需 server hardening/明确 capability signal |
| Registration email verification | `POST /auth/send-verify-code` + `POST /auth/register` 的 `verify_code` | `email_verify_enabled` 时先发 6 位验证码，再将 code 随 register 提交；current 没有独立“verify account” endpoint | doge 复用两步 contract，并将 resend/countdown/error 纳入同一注册 journey | 无需新增独立验证 API；必须支持 Turnstile token renewal、email queue/config unavailable 与 code expiry |
| Email/password login | `POST /auth/login` | 受 Turnstile、rate limit、user active、backend mode 约束；可能直接返回 token pair 或 `requires_2fa` challenge | 原样复用；App 用单一 login journey 处理 direct success 与 MFA branch | 同 registration：access-only fallback 不能算 persistent doge session |
| Login MFA | `POST /auth/login/2fa` | 需要 login 返回的 `temp_token` 与 6 位 TOTP；只有 MFA 完成后才产生 account session | doge 必须在 App 内完成 challenge、cancel、expiry、retry | Current debug logging 与 desktop ticket 时序仍是 security gate；不得在 MFA 前进入 post-login offer |
| OAuth login/registration | GitHub、Google、LinuxDo、WeChat、OIDC、DingTalk 的 `/auth/oauth/*/start`、callback 与 provider/pending completion APIs | provider availability 来自 public settings；部分 flow 需要 invitation、email completion、existing-account bind/adoption；system browser/provider 页面仍属外部 trust surface | 复用既有 provider identity、pending adoption、create/bind business API；doge 负责统一发起与最终 App state | Current callback 面向 configured Web frontend，部分成功路径将 token 放 URL fragment；缺少 doge-bound, single-use desktop ticket/exchange completion，不能原样消费 token fragment |
| Forgot password | `POST /auth/forgot-password` | `password_reset_enabled` 且 `email_verify_enabled`；需要 Turnstile；服务端统一返回避免 email enumeration；需要 configured frontend URL 生成邮件 link | doge 在 App 内发起并展示统一 completion，不揭示账号是否存在 | Current reset email link 指向 Web frontend URL；若要求完整 App 内闭环，需 doge-safe reset-link handoff/deep-link contract，不能把 token 暴露给不受控 surface |
| Reset password | `POST /auth/reset-password` | 需要 email、reset token、new password；token 来自邮件 link；成功后重新登录 | doge 承载 invalid/expired link、new password、success → login journey | 与上项相同，desktop link ownership/return path 是 gap；不需要重写 reset validation API |
| Session restore/refresh | `POST /auth/refresh`、`GET /auth/me` | refresh 受 rate limit/backend mode；`auth/me` 需要 JWT；current refresh rotation 与 revoke durability 存在已研究 blocker | doge 用 OS vault refresh credential、Rust memory access token、singleflight/generation 调现有 API | Atomic consume-and-rotate、lost-response retry、durable revoke generation 必须先 harden；否则不可声明可靠跨重启 session |
| Logout / revoke | `POST /auth/logout`、`POST /auth/revoke-all-sessions` | logout 可携 refresh token；revoke-all 需要认证 | doge logout 同时请求 server revoke并清除本地 account credential/metadata projection；无论 remote result，Local Mode 始终可用 | revoke-all current durability blocker必须关闭；remote failure需显示“本地已退出/远端撤销待确认”的真实 scope |
| Profile and password maintenance | `GET /user/profile`、`PUT /user`、`PUT /user/password` | 需要 JWT；修改密码需要 current/new password | 通过 current APIs 提供 profile 与 change-password self-service | 不得把 profile API 当 identity authority replacement；error/result 映射需 closed safe reasons |
| Identity bindings | email binding send-code/bind、`DELETE /user/account-bindings/:provider`、`POST /user/auth-identities/bind/start`、OAuth bind routes | 需要 JWT；provider/last-login-method constraints 由 server 决定 | 复用 current binding/unbinding/adoption contract，App 只呈现允许动作 | Desktop OAuth bind completion沿用 OAuth desktop gap；不能在 client 推断“可解绑最后身份” |
| TOTP management | `/user/totp/status`、`verification-method`、`send-code`、`setup`、`enable`、`disable` | 需要 JWT；全局 `totp_enabled` 与 server encryption/email verification conditions生效 | 纳入 account security lifecycle，分阶段复用 current APIs | Recovery codes/account recovery等 current routes 未见，不得虚构；若后续产品要求则单独 gap |
| API keys / usage / quota / subscription | `/keys/**`、`/usage/**`、`/user/platform-quotas`、`/subscriptions/**` | 需要 JWT；API-key current secret lifecycle 存在 blocker | 复用 current read/business APIs；managed-key 上线前先完成 server hardening | API key hash-at-rest、metadata-only list/get、one-time secret、ACL/idempotency gap必须关闭 |
| Billing/order lifecycle | `/payment/config|checkout-info|plans|channels|limits`、`/payment/orders/**` 及 public resume/verify | authenticated user endpoints；payment enablement/provider rules来自 server | 后续阶段复用 existing order/subscription contract；provider-hosted payment surface处理 payment credential | 不在账号 Foundation 重做 billing；desktop return/resume UX需独立验证 |
| Device/session inventory and self-service account deletion | Current user routes 未发现 device inventory/revoke-one 或 self-service account deletion API | 不属于 current API capability | Master Plan 保留长期收益，但不得在 doge UI 假装已支持 | 若未来确认产品需要，必须新增最小 server contract；不得用 local-only deletion/revoke 冒充 remote lifecycle completion |

### API reuse rule

- **Current API fact**：上述 endpoint 与前置条件来自 current code；doge 不复制其 server-side validation 或 domain state。
- **Product decision**：doge 是这些 capability 的完整 desktop interaction client；用户 journey 可以在 App 内完成，外部 system browser 仅用于 OAuth provider/payment 等必要 trust surface。
- **Gap policy**：新增 API 仅允许补 current contract 无法表达的 desktop-safe completion、durability 或未来明确 capability；必须最小化、复用既有 service/domain，并由 solution architecture 另行定义 signature。PRD 不预先虚构 endpoint。

## Complete Account Journey Contract

1. **Local Mode / voluntary entry**：用户未登录时所有既有 ccgui local capability 完整可用；主动进入 Account 或 account-backed context 后，doge 才读取 public settings 并说明可选收益。
2. **Choose create or sign in**：Account entry 同时提供“创建账号”“登录”“忘记密码”三条清晰路径；server disabled 的路径隐藏或解释 unavailable，不展示可执行假 CTA。
3. **Email registration**：用户填写 server 当前要求的 email/password/agreement/Turnstile/invitation/promo inputs。若 email verify 开启，doge 先调用 send-code，承载 resend/countdown/expired/error，再将 verify code 随 register 提交；若关闭则直接 register。成功只建立 account session，不自动配置。
4. **Email/password login + MFA**：login 成功若返回 token pair则进入 durable-session activation；若返回 `requires_2fa`，doge 在 App 内完成 TOTP challenge。cancel/expired/invalid 保持 signed-out Account state 与完整 Local Mode。
5. **OAuth login/registration**：只显示 public settings 开启的 provider。doge 通过 system browser 发起 current provider flow，继续复用 token2api 的 create/bind/adoption/invitation/email completion rules；最终必须通过 doge-bound desktop-safe completion 回到 App。当前 token-bearing Web fragment 不得被视为可接受实现。
6. **Forgot/reset password**：doge 发起 forgot-password并使用抗枚举统一结果；用户从邮件进入 doge-owned reset completion，处理 missing/expired/invalid token、new-password validation与成功状态；完成后回到 login，不自动建立或恢复旧 session。现有 Web link 到 App 的安全 handoff 是明确 gap。
7. **Session activation and restore**：只有 refresh credential 安全进入 OS vault、nonsecret account metadata 激活且 `auth/me` 可验证后，App 才显示 authenticated。重启时以 refresh → me 恢复；vault locked/unavailable、refresh失效、revoke或service outage均不得阻塞 Local Mode，也不得用 session-only fallback。
8. **Post-login configuration offer**：durable account session 成立后才展示 adaptive offer。用户先从当前账号已有 API Key 中选择一枚；无 Key 时可前往 `https://token-matrix.com/keys` 创建并回到 App 刷新。key selection 与 exact config apply 是独立 consent，注册/登录/MFA/OAuth completion 不授权取用 Key 或写文件。
9. **Account maintenance**：Account Center 提供 profile、change password、TOTP 与 identity binding status/actions、session revoke-all；所有 availability 与结果来自 current APIs。未存在的 device inventory/account deletion 不显示为 current capability。
10. **Ongoing value**：用户可查看 API key metadata、usage/quota/subscription 与后续 billing/order状态；stale/outage/quota exhausted只影响对应 account-backed benefit，Local Mode保持完整。
11. **Logout**：用户退出时 doge 请求 current logout/revoke scope，清除本地 vault/account projection并回到 signed-out Account state；既有 workspace、conversation、settings、CLI local config 与 LocalPrincipal ownership不被删除或隐藏。
12. **Recovery truth**：所有 partial/remote failure明确区分 local completion 与 server completion。例如 remote logout失败时不能声称“所有会话已撤销”；但用户仍能本地退出并继续 Local Mode。

### Mock scenario coverage for the complete journey

Mock scenario engine 至少提供以下稳定、可命名、可组合场景，并让 UI review 能从任意起始状态重复进入：

| Scenario family | Required deterministic scenarios |
|---|---|
| Registration | registration disabled、direct register success、email-code required、resend countdown、invalid/expired code、invitation required/invalid、Turnstile required/failure、email already exists、access-only durable-session rejection |
| Login / MFA | direct login success、invalid credentials、inactive/backend-mode blocked、MFA required、invalid/expired MFA challenge、MFA cancel、MFA success |
| OAuth | provider disabled、browser launch、callback pending、new-account completion、existing-account bind/adoption、provider cancel/error、desktop callback success、state mismatch、expired/replayed completion |
| Password recovery | reset disabled、forgot submit anti-enumeration success、email-link waiting、invalid/missing/expired reset link、password validation failure、reset success → login |
| Session lifecycle | cold restore success、refresh latency、offline/service outage、refresh expired/revoked、lost response、logout local-complete/remote-pending、revoke-all success/failure、vault locked/unavailable |
| Profile/security | profile load/update、change-password success/error、TOTP disabled/setup/enable/disable、identity bind/unbind allowed/blocked |
| Post-login configuration | offer preserve/close/reopen/hard-dismiss、plan latency/stale、happy/noop/partial/failure/recovery、lazy diff unavailable、session/account changes invalidate plan |
| Ongoing value | usage fresh/stale/unknown、quota near/exhausted/reset、subscription inactive/active、billing/order pending/success/failure、Local Mode invariant under every remote state |

每个 scenario 必须声明 initial state、user actions、scheduled latency、port responses/events、expected transitions、terminal/nonterminal truth 与 reset behavior；不得通过 component-local boolean 拼接状态。

## Upstream Isolation Product Requirement

- 所有 doge account convenience capability 必须作为叠加在 ccgui 之上的独立产品层，不得把 account 语义渗入或重写上游既有 local workflow。
- Account 能力必须使用独立的 feature slice、adapter、route、state、storage 与 i18n namespace boundary；共享 contract 仅通过最小、显式、可替换的 integration seam 接入。
- 上游原有 local flow 不得出现 account branch、login check、entitlement check 或 token2api availability check；新增入口只能作为旁路 enhancement 调用独立 account surface。
- 关闭相关 feature flags、未登录、vault unavailable 或 account module 不可用时，用户可观察行为必须等价于上游 ccgui 的 local behavior baseline。
- 后续同步 ccgui upstream 时，account 变更应集中在少量 doge-owned integration seams，能够独立测试、替换和维护，不要求持续改写上游核心模块。
- Account data、events、routes、copy 和 persistence schema 不得复用语义不同的上游类型或 store；若需读取 local facts，必须通过 read-only adapter 投影，而不是向原流程注入 account ownership。

## Comprehensive Master Plan Scope

以下 scope 全部属于唯一 Master Plan，不因首期 release cut 较小而删除；未进入首期的内容必须保留明确 dependency、目标 release cut、compatibility boundary 和后续 acceptance：

| Domain | Master Plan requirement | Delivery note |
|---|---|---|
| Auth / profile / session | registration、conditional email verification、email/password login、MFA/OAuth、forgot/reset password、profile/security maintenance、refresh、logout/revocation、session expiry/recovery | Foundation dependency；App 是完整 interaction client，token2api 仍是 authority |
| Token key provisioning | doge token service key 的创建、绑定、轮换、撤销、最小权限与 secret lifecycle | 依赖 server hardening 与可用的 OS vault；vault policy 已确认 |
| Configuration recipes | recipe catalog、plan/diff、explicit consent、apply、backup、rollback、recovery、reload 和跨平台 capability matrix | Foundation 先交付一个真实 recipe，后续扩展更多 recipe |
| Quota / usage / subscription | quota、usage、subscription/plan 展示、freshness、degraded state 与 entitlement boundary | 后续 release cut；只能约束新增 token-service capability |
| Billing | checkout/portal、invoice/payment state、plan transition、failure/support 与 compliance boundary | 后续 release cut；依赖服务端 billing contract，不影响 Local Mode |
| Device / session management | device identity、active session inventory、revoke one/all、lost-device recovery 与 audit | 后续 release cut；依赖 durable revocation/device model |
| Multi-account future | account switching、data/credential isolation、ownership、conflict handling 与 migration strategy | Future-ready contract；首期可单账号，但不得封死演进路径 |
| Remote / daemon / web | remote、daemon、web 的 capability、auth flow、device authorization、fail-closed boundary 与 Desktop parity | 后续 release cut；不得成为 Desktop Local Mode dependency |
| Security / privacy | threat model、vault、redaction、least privilege、retention/deletion、transport、audit 与 support-bundle privacy | 全阶段 blocking gate |
| Observability / support | closed event/reason/metric schema、diagnostics、SLO/support workflow、privacy-safe correlation 与 outage isolation | Foundation 定义 contract，随阶段补齐 evidence |
| Migration / rollout / rollback | existing-user compatibility、schema/config migration、feature flag、canary、rollback、recovery 与 data cleanup | 每个 release cut 必须具备独立方案和 PASS/FAIL gate |

## Phase Principles

- **Plan comprehensively, deliver incrementally**：先冻结全量 Master Plan，再按 dependency 切分 Foundation 与后续 release cuts；阶段边界不是 scope deletion。
- **Local Mode baseline is invariant**：每个阶段的设计、实现与发布验证都必须证明 no-login 的既有本地能力未被改变。
- **Failure isolation**：token2api outage、login failure、expired/revoked session、quota exhaustion、billing failure、vault unavailable 或后续能力未交付，只能影响对应的 account-backed/token-service capability。
- **Explicit enablement**：登录与 post-login configuration 是用户主动选择的增强路径；登录成功本身不授予文件 mutation 权限。
- **Formal-spec gate**：本轮只收敛 PRD、OpenSpec proposal 与 product behavior spec delta，不写业务代码；后续实现已经获得持续至本地打包试用的产品授权，但仍须先完成 design/tasks、versioned contract 与 lane ownership。
- **Product-first convergence**：Product Experience Blueprint 已覆盖核心功能、入口、journey、states、user outcomes 和 release cuts；security/底层细节继续作为内部 Engineering Constraints 与 acceptance gates，不占用产品问答主线。
- **Contract-first freeze**：实现启动前先冻结 versioned port/DTO/state/error/scenario/conformance contract；未冻结前不得让任一 lane 以临时接口形成事实标准。
- **Mock-first UI**：Frontend Experience 先用 deterministic stateful Mock adapter完成全 journey 与多轮用户 review；该阶段真实 network/native calls 必须为零。
- **Parallel backend**：Doge Native Broker 与 token2api API/gaps 可在 UI review 同期独立推进；三条 lane 通过 contract 对齐，不通过等待或直接代码依赖对齐。
- **Late integration**：Mock-to-Real replacement 只发生在 UI review sign-off、Mock scenario acceptance、两条 backend lane contract conformance 全部通过后；之后才执行 integration/e2e，不把单 lane green 误报为端到端完成。

## Contract-first Parallel Delivery Plan

### Shared Contract Freeze

在三条 lane 写实现前，冻结同一个 versioned contract package/artifact，至少包含：

- `AccountGateway` / `AccountService` port 的 capability-oriented operations，不泄露 HTTP route、Tauri command 或 storage detail。
- Public capability projection、registration/login/MFA/OAuth/password-recovery/session/profile/security/usage/config state model。
- Credential-free DTO、closed error/reason/action、event ordering、cancellation/idempotency、latency/timeout semantics。
- Mock scenario manifest 与 shared request/response/event conformance fixtures；敏感字段 negative schema fixtures。
- Contract compatibility policy：breaking change 升 version；additive change 明确 capability negotiation；Mock、Rust、token2api adapter 必须声明支持版本。

### Lane A — Frontend Experience

- Ownership：doge account feature slice 的 journeys、routes、presentation state、i18n、a11y、Mock adapter/scenario engine 与 UI tests。
- Dependency：只依赖 frozen port/DTO/scenario contract，不依赖真实 token2api 或 Tauri availability。
- Required output：注册/验证、登录/MFA/OAuth、忘记/重置密码、session/profile/security、post-login configuration 与 ongoing value 的可审查 UI；deterministic state transition evidence。
- Prohibition：UI mock 不得散落在 handlers/components；不得 import real HTTP/Tauri client；不得把 mock-only field 加入 product state。
- Exit gate：用户多轮 review sign-off；全部 required scenario 可选择、重放和 reset；network/native call guard 为零；UI acceptance/a11y/i18n tests通过。

### Lane B — Doge Native Broker

- Ownership：doge Rust authority、OS vault、session manager、fixed-origin token2api client、desktop callback/link handoff、account repository、config planner/apply/recovery 与 Real adapter 的 doge 侧实现。
- Dependency：同一 frozen contract；可使用 token2api conformance stub/fixtures，不等待 Frontend UI完成。
- Required output：port 实现、closed DTO/error mapping、contract tests、vault/session/recovery/platform evidence；不将 secret/raw content暴露给 frontend。
- Exit gate：Real doge adapter 对 shared conformance suite 全绿；Local Mode/startup/addon-off isolation与平台前置 gate通过。

### Lane C — token2api API / Gaps

- Ownership：复用 current routes的兼容验证，以及最小 gap closure：durable token pair/revoke/refresh semantics、doge-bound desktop OAuth completion、App password-reset link handoff、API-key lifecycle等。
- Dependency：同一 frozen contract 与 current token2api domain/service；不依赖 Frontend layout/copy。
- Required output：current API compatibility matrix、最小 server contract changes（后续获授权时）、contract/integration tests、capability/version signal；不得建立 doge-specific 平行 identity domain。
- Exit gate：现有 endpoint reuse 与新增 gap contract均通过 shared conformance；DB reload/race/replay/security prerequisites有真实 evidence。

### Freeze, Integration, Acceptance Gates

1. **F0 — Product/experience freeze**：Product Experience Blueprint 覆盖完整 account lifecycle，用户关闭影响 journey 的产品 Open Decisions；不要求 backend 已可用。
2. **F1 — Contract freeze**：versioned port/DTO/state/error/scenario/fixtures 经 frontend、Rust、token2api owners共同签署；三 lane 才可实现。
3. **L-A / L-B / L-C lane acceptance**：各 lane 独立达到自身 exit gate；任何 lane 的完成不替代其他 lane。
4. **C0 — Contract conformance gate**：Mock adapter、Doge Real adapter、token2api compatibility/gap implementation 对同一 fixtures/negative cases/version matrix 全绿；发现 drift 先修 contract或adapter，不在 UI 加兼容分支。
5. **I0 — Mock-to-Real replacement**：保持 UI port不变，只替换 composition root 中 adapter；若替换需要改 UI journey或DTO，视为 contract failure，退回 F1。
6. **I1 — Integration/E2E**：才允许真实 doge ↔ token2api 调用，覆盖注册/email code、login/MFA/OAuth、forgot/reset link、restore/logout、post-login config 以及 offline/latency/expiry/recovery。
7. **A0 — Product acceptance**：用户确认 Real adapter 下体验与已批准 Mock UX 一致；Local Mode/upstream isolation、security、contract、platform 与 rollback gates全部通过后，才可声明 release-ready。

### Product Release Cuts

开发 lane 可以并行，但用户价值仍按可独立验收的 release cut 交付；后续 cut 不得反向成为前一 cut 或 Local Mode 的依赖。

| Release cut | User-visible scope | Lane dependency | Release acceptance |
|---|---|---|---|
| **P0 — Contract & Experience Freeze** | 完整 account lifecycle Blueprint、Mock scenario review environment；不发布真实账号功能 | F0 + F1；Lane A review substrate可先行 | 用户确认 journeys/IA；contract/version/scenario fixtures冻结；仍无真实 backend calls |
| **P1 — Complete Account Access** | public capability discovery、register/email code、login/MFA/OAuth、forgot/reset link、durable restore、logout、basic profile shell | Lane A + B + C 对 account-access contract conformance，I0/I1 | 每条 access/recovery journey E2E通过；Local Mode invariant；不自动配置 |
| **P2 — Account Security & Maintenance** | profile update、change password、TOTP、identity bindings、revoke-all/session truth | 对应 current API reuse + desktop completion gaps | current server policy原样生效；不可用 capability隐藏；logout/revoke scope真实 |
| **P3 — Activation & Configuration** | adaptive post-login offer、managed key、first recipe plan/apply/result/recovery | API-key hardening + Broker config authority + approved UI | three-consent、verified usable、no overwrite、durable receipt/recovery、platform gates通过 |
| **P4 — Ongoing Confidence** | usage/quota/subscription、freshness、configuration health/drift/recovery | current read APIs + adapter projections | remote/local usage不混淆；stale/outage诚实；Local Mode不受 quota/plan影响 |
| **P5+ — Commercial & Operations** | billing/order、device/session、multi-account、remote/daemon/web 与更多 recipes | 对应 current API reuse或显式 gap closure | 每个 capability 独立 conformance/canary/rollback；未存在 API 不得假实现 |

### First Local Packaged Trial Scope

首个可本地安装试用的打包 release 是 P1–P4 的有界纵向切片，而不是要求一次交付全部长期能力。以下内容是 blocking scope：

1. **Local Mode invariant**：未登录、退出、session 失效、vault unavailable、token2api outage、feature flags off 时，全部既有本地能力与上游 local behavior 保持完整可用。
2. **Complete account access**：依据 `GET /settings/public` 与 current API capability 提供 registration/conditional email verification、email/password login、TOTP MFA、已启用且具备 desktop-safe completion 的 OAuth、forgot/reset password、durable session restore、logout，以及首包 journey 必需的 profile/security/session maintenance；不可用 capability 应诚实隐藏或说明 prerequisite。
3. **Single Account Center**：Settings → Account 是唯一固定入口；token service/configuration contexts 仅提供进入同一 Account Center/journey 的轻量入口。
4. **Pull-only transparency**：登录用户可主动查看 quota/usage、freshness 与 unavailable/stale 状态；首包不发送 proactive notices，remote usage 与 Local Mode/local usage 明确分离。
5. **Codex one-click configuration**：登录后只展示 offer，不自动生成 key 或写文件；用户 explicit consent 后完成 Codex configuration plan、changed-file list、lazy redacted diff、事务化 apply、result/recovery，以及 acknowledge close、bubble reopen 与 permanent dismiss。
6. **Real integration evidence**：三 lane 按同一 versioned contract 各自完成；用户先验收 deterministic Mock UX，之后通过 contract conformance 才替换 Real adapter，并完成真实 integration/e2e、target-platform package、install/launch smoke test 与 Local Mode regression。

以下能力保留在 Master Plan，但不作为首包 blocker：production billing/order、完整 subscription commerce、device/session management UI、multi-account、remote/daemon/web、proactive quota/usage notices、非 Codex recipes、跨全部平台同时 GA。未验证平台或未完成 desktop-safe prerequisite 的单项 capability 必须 fail closed，不得拖累目标试用平台的 Local Mode。

## Engineering Constraints

以下事项默认遵循 best practices，由 architecture/engineering/review roles 形成内部 contract、validation matrix 与 blocking gate；除非会改变用户可见功能或取舍，否则不再升级为用户问题：

- React/renderer 必须 credential-free；durable secret 只进入 OS vault，vault unavailable 时 account-backed capability fail closed，Local Mode 不受影响。
- Account lifecycle、session capability、vault availability、connectivity 和 data freshness 必须正交建模，禁止用单一 `loggedIn` boolean 驱动 local flow。
- 登录、configuration plan/apply 必须绑定 account/session generation、host、recipe/version、fingerprint、digest 与 TTL，防止跨账号 consent reuse 和 TOCTOU。
- Configuration apply 必须采用 plan-first、redacted presentation、backup、journaled compensating transaction、rollback/recovery、idempotency 和 concurrent-edit detection。
- Access token、password、TOTP、ticket、PKCE、plan raw content 与 raw file/diff 只可按最短生命周期存在内存；UI、logs、analytics、diagnostics 和 support artifacts 禁止携带 secret。
- token2api 的 revoke、refresh、API-key lifecycle、desktop auth completion 与 authorization boundary 必须在相应 capability 上线前通过 server-side hardening gate。
- Account implementation 必须遵循 Upstream Isolation Product Requirement；feature flags off 的 equivalence regression 是每个阶段的 blocking gate。
- Contract artifacts 必须是三 lane 可执行的 single source of truth；Mock 和 Real adapter 共享 DTO/fixtures，但不共享能掩盖实现差异的 fake transport logic。
- UI test/runtime 必须能阻断真实 network/Tauri 调用；Mock scenario scheduler使用 deterministic virtual time或可控 clock，不依赖随机 sleep、live server 或环境顺序。
- Contract conformance 必须验证 status/error/cancellation/event order、required/optional fields、unknown enum/version行为、secret-negative schema与capability negotiation，不只验证 happy response shape。

## Formalization and Downstream Authorization

`research/product-experience-blueprint.md` 及配套 API、Mock-first 与 parallel-backend research 已完成完整 lifecycle、IA、states、scenario 和 lane boundary 的研究输入；影响首包的产品问题已全部关闭。本轮将决定正式化为 `proposal.md` 与 `token2api-account-convenience` product behavior spec delta，不创建或修改 `design.md`、`tasks.md`，也不写业务代码。

用户已授权后续软件开发持续推进至可本地安装试用的打包产物。该授权的生效路径是：正式 behavior spec → design/tasks 与 versioned contract freeze → Frontend Experience、Doge Native Broker、token2api API/gaps 并行交付 → contract conformance → Mock-to-Real late integration → integration/e2e → target-platform package 与用户试用验收。任一 gate 未通过时不得用 Mock-only、access-only session、Web token fragment 或未验证 capability 冒充完成。

## Acceptance Criteria

- [ ] doge 现有 identity/account/session/storage/integration surfaces 已形成 evidence-backed Impact Map。
- [ ] token2api 账号体系的 domain model、auth flow、API contract、token lifecycle、quota/entitlement、deployment trust boundary 已形成 evidence-backed System Map。
- [ ] Local Mode baseline 已形成可执行 regression matrix，并能判定 login/account/entitlement/grace period/token2api outage 均不会影响所有既有本地能力。
- [ ] OS vault locked/unavailable 场景证明 Local Mode 完整可用、无 session-only 或 fallback vault，并为 account convenience capability 提供明确恢复路径。
- [ ] Comprehensive Master Plan 逐项覆盖 auth/profile/session、token key provisioning、recipes、quota/usage/subscription、billing、device/session management、多账号 future、remote/daemon/web、security/privacy、observability/support 与 migration/rollout/rollback；每项均有 dependency、release cut 和 acceptance owner。
- [x] Product Experience Blueprint 已扩展为完整账号端：覆盖注册、条件式邮箱验证码、email/password login、MFA、启用 provider 的 OAuth、forgot/reset email link、session restore/logout、profile/password/TOTP/identity/session maintenance、post-login offer 与 phased value map；影响首包的产品问题已全部关闭。
- [ ] token2api capability matrix 已逐项对照 current routes/handlers/frontend flows，明确 current API fact、public-settings/认证前置条件、doge reuse decision 与真实 gap；未发现的 capability 不得写成 current fact。
- [ ] doge 的 email/password registration、email verification、login/MFA、forgot/reset、profile/session flow 均复用 existing token2api API；OAuth/password-link 仅新增最小 desktop completion contract，未形成第二套 identity/password/MFA backend。
- [ ] 完整 account journey 有逐步 PASS/FAIL evidence：创建账号、验证、登录/MFA/OAuth、恢复密码、durable session activation、post-login offer、maintenance、ongoing value、logout 之间的授权与状态边界无 scope drift。
- [ ] Account feature flags 关闭、未登录、vault unavailable 与 account module unavailable 时，用户可观察行为等价于 ccgui upstream local baseline；既有 local flow 中不存在 account branch。
- [ ] Account feature slice/adapter/route/state/storage/i18n 均具有独立 doge-owned boundary，上游同步影响面集中且有 regression evidence。
- [ ] Versioned Account contract 已冻结，包含 stable `AccountGateway` / `AccountService` port、credential-free DTO、closed states/errors、capability negotiation、scenario manifest、fixtures 与 compatibility policy；Frontend/Rust/token2api 三方共同接受。
- [ ] Frontend Experience 使用可替换 Mock adapter；button handler/components 无散落 mock，Mock runtime 的真实 token2api network 与 doge backend/Tauri calls 为零。
- [ ] Deterministic stateful scenario engine 覆盖 registration/email-code、login/MFA、OAuth/email link、forgot/reset、latency/offline/outage、expired/replayed token、session recovery、vault unavailable、configuration happy/error/recovery 与 ongoing-value states，并可重复 reset/replay。
- [ ] Frontend Experience、Doge Native Broker、token2api API/gaps 三条 lane 各自通过 exit gate；UI review不等待 backend，backend conformance不依赖 UI refinement。
- [ ] Mock adapter、Doge Real adapter 与 token2api compatibility/gap implementation 对同一 versioned fixtures、negative cases 与 event-order tests通过 contract conformance；Mock/Real drift 为零后才允许 adapter replacement。
- [ ] Late integration 保持 UI port/journey不变；真实 integration/e2e 覆盖 register/email code、login/MFA/OAuth、forgot/reset link、restore/logout、post-login configuration、offline/latency/expiry/recovery，用户确认 Real UX 与已批准 Mock UX 等价。
- [ ] Settings → Account 是唯一固定 Account Center 入口；token service/configuration contexts 的轻量入口进入同一 route/state/journey，关闭 account feature flags 后不存在残留固定入口或 local-flow branch。
- [ ] 首期 quota/usage 仅在用户主动打开或明确刷新时读取并展示 freshness/stale/unavailable；没有 threshold、depletion、freshness 或 error proactive notice，且 quota 状态不影响 Local Mode。
- [ ] 首个 recipe 为 Codex；post-login offer 不自动写配置，explicit consent 后的 plan/list/lazy redacted diff/apply/recovery/close/bubble journey 通过 Mock 与 Real E2E。
- [ ] 首个本地打包试用 release 在目标平台完成 Real adapter integration、安装/启动 smoke、完整 account access、主动 quota/usage view、Codex one-click configuration 与 Local Mode regression；P5+ 未交付不构成失败。
- [ ] 端到端 user journeys 与 failure/edge-case matrix 完整，覆盖首次登录、续期、失效、登出、离线、服务异常、账号切换和数据迁移。
- [ ] 至少 2–3 个架构方案完成 security、complexity、coupling、offline UX、migration 和 operations 比较。
- [ ] 推荐方案包含目标架构、contract 草案、阶段计划、测试策略、rollout/rollback、风险清单和明确不做事项。
- [ ] Security/privacy、data/storage、frontend/backend 与 type contract 负责人完成独立评审，无未解释的 blocking finding。
- [x] 用户已确认产品边界、first recipe、入口与 usage interaction，并授权后续按正式 design/tasks 与 gates 推进至本地打包试用；本轮仍不写实现。
- [ ] Post-login offer、explicit consent、configuration plan/apply、changed-file list、lazy diff、acknowledge close、bubble reopen、bubble permanent close 已形成完整 interaction/state-machine spec。
- [ ] 一键配置不会静默覆盖用户自定义值；每个目标文件均有 precondition、planned diff、backup、atomicity、failure result 和 rollback 策略。
- [ ] UI、logs、diagnostics、telemetry 和 research artifacts 均不暴露 secret-bearing diff；redaction contract 有 Good/Base/Bad cases。
- [ ] macOS/Windows/Linux 的 config path、format、permission、symlink、missing/invalid file 与 concurrent modification 验收矩阵已定义或明确标为未验证。
- [ ] 每个 phased release cut 都显式包含 Local Mode no-login baseline、remote failure isolation 和 rollback gate；任何一项失败均不得进入下一交付阶段。

## Definition of Done

- 研究报告与方案中所有关键结论可追溯到代码或明确标注的推断。
- OpenSpec proposal 与 product behavior spec delta 同 Trellis PRD 的冻结产品决策保持一致；并行中的 design/tasks 后续不得改变该 product contract。
- Product Experience Blueprint、phased delivery plan 与 research inputs 已形成；长期 scope 不得因首个本地试用 release cut 而删减。
- 形成可执行的 Contract-first Parallel Delivery Plan，明确 shared freeze、Frontend Experience、Doge Native Broker、token2api API/gaps、contract conformance、Mock-to-Real replacement、integration/e2e 与 final acceptance gates。
- 本阶段不产生业务代码、数据库迁移、外部部署、账号数据写入或 secret 读取/输出。

## Out of Scope (explicit)

- 本轮不实现账号接入，不修改 doge 或 token2api 的业务代码。
- 不运行 production migration，不创建/修改真实账号，不读取或输出 credentials/tokens/private data。
- 首个本地打包试用 release 不实施 billing/order、device/session management UI、multi-account、remote/daemon/web、proactive quota/usage notices 或非 Codex recipes；这些能力必须留在 Master Plan，且未经后续决策不冻结具体收费策略、套餐规则或 production rollout 时间。首包仅包含 pull-only quota/usage overview。
- 本轮不实际改写任何用户 config file，不读取真实 credential，不展示包含 secret 的原始 diff。
- 不在 doge 新建平行 account backend、user/password/MFA/OAuth authority，不复制 token2api server-side business rules；current API 已覆盖的能力不为 doge 再造 endpoint。
- Mock-first 不代表以 mock 替代 backend、contract test 或 integration/e2e；本轮不实现 Mock/Real adapter，只冻结其 requirement、scenario 与 gate。
- UI 评审期间不真实调用 token2api 或 doge backend；真实联调只允许发生在 late-integration gate 之后。

## Research Lanes

- `product-spec-owner`：产品边界、术语、MVP/未来能力、acceptance 与 OpenSpec 草案。
- `codebase-researcher`：doge current identity/account/session/integration Impact Map。
- `backend-runtime-engineer`：token2api server/auth/API/runtime system map（只读研究身份）。
- `data-storage-engineer`：两侧 schema、identity mapping、credential/local cache、migration/retention。
- `frontend-engineer` / `product-design-owner`：Frontend Experience lane、稳定 port consumer、Mock adapter/scenario engine 与多轮 UI review evidence。
- `backend-runtime-engineer` / `desktop-platform-engineer`：Doge Native Broker lane、desktop callback/link ownership、vault/session/config authority 与 contract tests。
- `backend-runtime-engineer`（token2api scoped）：token2api current API compatibility 与最小 gaps lane，不建立新 identity domain。
- `product-design-owner`：post-login modal、changed-file progressive disclosure、doge bubble、关闭/恢复状态机与 interaction QA matrix。
- `desktop-platform-engineer`：跨平台 config path/permission/file watcher/symlink/concurrent edit 与安全文件写入边界（只读研究）。
- `ux-researcher`：登录、离线、失效、切换账号、错误恢复的体验模型。
- `security-privacy-reviewer`：trust boundary、token storage、threat model、privacy/compliance gate。
- `observability-diagnostics-engineer`：audit/diagnostics/metrics/supportability contract。
- `solution-architect`：在上游研究完成后综合架构选项与推荐方案。
- `type-contract-reviewer`、`change-reviewer`、`agent-system-evaluator`：最终方案独立评审。

## Technical Notes

- doge project rules：`AGENTS.md`、`.trellis/spec/**`、`openspec/**`。
- Agent catalog：`.agents/agents/README.md`；调度遵循最小 Context Pack 与 structured handoff。
- 两个仓库均按 read-only scope 调研；不得把 token2api 中的配置、日志或环境文件内容复制到报告，尤其禁止 secret material。
- “登录成功”只授予远端 session，不自动授予本地文件 mutation；一键配置必须有独立 explicit consent 和可审查的 mutation plan。
- Diff UI 只展示经过 redaction 的 presentation model；raw old/new content 不应进入 frontend global store、analytics 或 persisted diagnostics。

## Research Notes

- 多-agent只读研究已完成并压缩到 `openspec/changes/integrate-token2api-account-system/research/synthesis.md`；该文档区分 Fact、Inference、Recommendation 与 Unverified，不复制 secret、raw config/diff 或大段原始报告。
- doge current 没有 app-level identity、OS vault、desktop auth completion、account metadata schema或config plan/apply；现有 workspace `AccountSnapshot` 不能复用为doge identity。doge已有 `rusqlite` 与 `src-tauri/src/shared_event_log/` SQLite lifecycle pattern，但account数据必须使用独立schema/repository。
- token2api current已有 email/TOTP/OAuth、profile、subscription/quota/usage与user API key，但没有desktop ticket/device session/config apply。revoke-all durability、atomic refresh、API-key secret lifecycle、desktop flow、ACL omission、CORS idempotency header与2FA logging构成production blockers。
- 校准后的核心contract：`LocalPrincipal`保留 Local Mode ownership；account lifecycle、session capability、vault、connectivity、freshness正交；refresh/API key只进vault，access/password/TOTP/ticket/PKCE/plan/raw file/diff只在内存；terminal config result必须已有durable receipt或recovery journal。
- Foundation scope、vault policy、完整 token2api account client boundary、Contract-first/Mock-first/parallel/late-integration 策略，以及 first recipe/entry/usage interaction 已全部确认。Product Experience Blueprint 与配套 research 已完成；本轮创建正式 OpenSpec `proposal.md` 与 product behavior spec delta，但不创建或修改 `design.md`、`tasks.md`，不写实现。
- 用户已授权后续按正式 artifacts 与 gates 继续开发至本地打包试用；开发策略仍是 implementation 的 blocking gate，不得把授权解释为跳过 contract、security、review、integration/e2e 或 Local Mode regression。

## Approaches / Recommended Direction

- 推荐 **Native Host Account Broker**：React credential-free；Tauri Rust持有system-browser loopback ticket + PKCE/state/nonce、session singleflight/generation、OS vault、独立account SQLite、fixed HTTPS client、immutable recipe catalog与config plan/apply/recovery。
- Device authorization flow保留给后续daemon/remote；token2api当前无该能力。doge-specific BFF会增加always-online/session operations surface，与local-first和host-local config ownership不匹配，Foundation不采用。
- 首个 Foundation release cut 支持 Desktop + local backend，并始终保留完整 Local Mode；其账号 surface 是完整 interaction client，覆盖 registration/email verification、login/MFA/OAuth、forgot/reset、profile/session 与 post-login offer。remote/web/daemon 作为 Master Plan 内后续 release cut，其 capability fail closed 且不得影响 Local Mode。
- Delivery dependency 改为：Product Experience + versioned contract freeze → Frontend Experience || Doge Native Broker || token2api API/gaps 三 lane 并行 → contract conformance → Mock-to-Real late integration → integration/e2e → product acceptance；server hardening、vault、desktop completion、recipe transaction等原有技术先后关系保留在各 lane 内部。
- 首个 recipe 已冻结为 Codex：current path/config/reload evidence 更完整；首包必须证明 multi-file journaled compensating transaction、rollback 与 recovery。

## Risks

- token2api handler/mock可能制造false completion：`TokenVersion`未durable persistence，旧JWT在DB reload后可能继续有效；refresh `GET → DEL → mint`存在并发多successor风险。
- API key plaintext-at-rest、List/Get full secret、deleted audit/idempotency exposure使任何renderer/raw diff/log链路都可能泄密；必须先server hardening并建立Rust-only vault。
- 登录、配置plan与apply若没有account/session generation、host、recipe/version、fingerprint、digest与TTL绑定，会发生跨账号consent reuse、TOCTOU或wrong-host mutation。
- 多文件没有全局atomic rename；必须使用journaled compensating transaction。file outcome、reload outcome、receipt/recovery必须分离，timeout不能作为success或repair。
- generic diagnostics含path/store fingerprint，不满足account privacy；必须使用独立strict support bundle和closed event/reason/metric schema。
- OS vault、loopback callback、Windows replace/reparse、Linux Secret Service与各recipe canonical path仍需三平台实机矩阵；未验证平台应隐藏apply capability。
- Mock scenario 若与 Real adapter分叉，会在 UI review 阶段制造 false confidence；必须用 versioned shared fixtures、negative cases、event-order assertions 与 conformance gate阻断 drift。
- 若 UI 临时直连 route/Tauri command，或 backend 为迎合具体 component 增加私有字段，会破坏三 lane 解耦并使 late integration退化为重写；contract port 与 composition-root adapter replacement 是 blocking boundary。

## Open Decisions

无。Vault policy 由 ADR-002 冻结；完整 account client 与 API reuse 由 ADR-003 冻结；parallel delivery 由 ADR-004 冻结；Codex first recipe、Settings → Account 单一固定入口 + contextual lightweight entries、pull-only quota/usage 及本地打包试用目标由 ADR-005 冻结；Codex 配置前选择已有 API Key 与无 Key 网站闭环由 ADR-006 冻结。后续如需改变这些产品结果，必须显式更新 PRD 与 OpenSpec，而不是在 design 或 implementation 中隐式漂移。
