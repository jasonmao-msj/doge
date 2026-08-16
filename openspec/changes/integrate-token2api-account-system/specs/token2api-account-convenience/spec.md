## ADDED Requirements

### Requirement: Local Mode remains complete without an account

doge SHALL 在未登录状态提供完整 Local Mode，并 SHALL NOT 让 login、account、entitlement、grace period、remote quota 或 token2api availability 成为任何既有本地能力的 gate。

#### Scenario: Signed-out user uses existing local capabilities

- **WHEN** 用户未登录 doge account
- **THEN** 用户 SHALL 能使用账号接入前已存在的全部本地能力
- **AND** 产品 SHALL 将该状态称为 Local Mode，而不是受限 guest

#### Scenario: Account dependency fails

- **WHEN** token2api outage、quota exhaustion、session expiry、logout、account module failure 或 account feature flags off
- **THEN** 只有对应的 account-backed/token-service capability MAY 降级
- **AND** 既有本地能力、启动路径与本地数据 SHALL 保持可用且不等待 grace period

### Requirement: The App provides complete token2api account access

doge App SHALL 提供 token2api 账号的创建、进入、恢复、必要维护与退出 journey，并 SHALL 复用 token2api current API 与 server policy；doge SHALL NOT 建立平行 identity/password/MFA/OAuth authority。

#### Scenario: Registration follows public server capabilities

- **WHEN** `GET /api/v1/settings/public` 允许注册且用户在 App 提交有效 registration form
- **THEN** App SHALL 调用既有 token2api registration capability
- **AND** 当 server policy 要求邮箱验证时，App SHALL 完成发送/提交验证码或等价既有验证流程后再进入 authenticated journey

#### Scenario: Disabled registration is not presented as actionable

- **WHEN** public settings 禁止注册、要求 invitation/promo/Turnstile 等 App 尚未满足的 prerequisite，或相关 current API 不可用
- **THEN** App SHALL 隐藏或明确禁用不可执行 action 并说明可恢复前置条件
- **AND** App SHALL NOT 在本地复制或放宽 server policy

#### Scenario: Login requires MFA

- **WHEN** email/password 登录的 typed response 要求 TOTP MFA challenge
- **THEN** App SHALL 保持同一 login transaction 并呈现 MFA step
- **AND** 只有 token2api 确认 MFA 成功且 doge 建立 durable session 后才 SHALL 进入 authenticated account state

#### Scenario: Enabled OAuth provider completes safely on Desktop

- **WHEN** token2api 启用 OAuth provider 且对应 desktop-safe completion contract 已通过 conformance
- **THEN** App SHALL 使用 system-browser handoff 与受验证 callback/link completion 返回同一 account journey
- **AND** raw access/refresh token SHALL NOT 通过 renderer-visible URL fragment 或 UI state 交付

#### Scenario: User recovers a forgotten password

- **WHEN** 用户在 App 发起 forgot password
- **THEN** App SHALL 通过 token2api current forgot capability 提交 neutral anti-enumeration request，并呈现检查邮件与返回登录的明确 action
- **AND** 首个 release cut SHALL 由固定 `token-matrix.com` HTTPS 页面消费 email link 并完成新密码提交；raw reset token SHALL NOT 进入 Doge WebView、renderer、SQLite、event 或日志
- **AND** Web completion 成功后用户 SHALL 回到 Doge 重新登录，App 不得由 reset request 伪造成功 session

#### Scenario: User restores or ends a session

- **WHEN** doge 重启且存在可用 durable credential，或用户选择 logout/revoke
- **THEN** App SHALL 分别执行受验证的 session restore/refresh 或 token2api logout/revoke scope
- **AND** restore 失败或 session 失效 SHALL 回到完整 Local Mode，不得损坏本地能力

#### Scenario: User maintains a current account

- **WHEN** current token2api API 与 public capability 允许 profile update、password change、TOTP、identity binding 或 revoke-all
- **THEN** Account Center SHALL 提供首包 journey 所需的对应维护 action，并原样服从 server authorization 与 validation
- **AND** 尚未完成 durability/security prerequisite 的 action SHALL fail closed，其他 account journey 与 Local Mode SHALL 继续可用

### Requirement: Durable account state uses the OS vault only

需要跨重启保留的 account credential SHALL 仅存入 OS vault；doge SHALL NOT 提供 session-only account mode 或自建 fallback vault。

#### Scenario: OS vault is locked or unavailable

- **WHEN** OS vault locked、unavailable 或 unsupported
- **THEN** doge SHALL 保持完整 Local Mode 并提供 account capability 的恢复说明
- **AND** doge SHALL NOT 将 credential 写入普通文件、SQLite、frontend storage 或 diagnostics，也 SHALL NOT 把临时内存 session 当作 durable login 成功

### Requirement: Account Center has one fixed entry topology

doge SHALL 将 Settings → Account 作为唯一固定、持久的 Account Center 入口；token service/configuration contexts MAY 提供轻量 CTA 或 deep link，但 SHALL 进入同一 route、state 与 journey。

Account Center SHALL 采用 attention-first progressive disclosure：primary surface 只显示当前任务、必要状态与下一步 action；解释性 copy SHALL 默认收纳进 keyboard-focusable help affordance，并在 hover/focus 时以 viewport-bounded、content-adaptive overlay 呈现。Account、configuration 与 result journey SHALL 形成可返回或可完成的闭环，而不是在同一页面平铺所有说明和维护表单。

#### Scenario: User opens the fixed entry

- **WHEN** 用户选择 Settings → Account
- **THEN** App SHALL 根据同一 account state 展示注册/登录、恢复、已登录 overview 或维护 journey
- **AND** SHALL NOT 要求用户先访问 token service/configuration context

#### Scenario: User needs secondary guidance

- **WHEN** 当前 step 存在 Local Mode、quota freshness、vault safety 或 configuration preservation 等解释信息
- **THEN** primary surface SHALL 只保留一个具有 contextual accessible name 的 help icon
- **AND** hover 或 keyboard focus SHALL 展示内容自适应、受 viewport 约束且不写死固定宽高的 explanation
- **AND** explanation SHALL NOT 作为常驻段落与当前 action 争夺注意力

#### Scenario: User opens a maintenance action

- **WHEN** 用户选择编辑资料、修改密码、查看额度或展开某个 configuration file diff
- **THEN** UI SHALL 只展开该 intent 所需的 controls/details
- **AND** 未选择的 sibling maintenance form 或 file diff SHALL remain collapsed

#### Scenario: User opens a contextual entry

- **WHEN** 用户在 token service 或 configuration context 选择 account 轻量入口
- **THEN** App SHALL deep-link 到同一 Account Center 或其同一状态机下的目标 step
- **AND** SHALL NOT 创建第二套账号身份、parallel route state 或不同授权规则

#### Scenario: Account feature is disabled

- **WHEN** account convenience feature flags off
- **THEN** Settings 与 contextual surfaces SHALL 移除 account-specific entries
- **AND** 用户可观察行为 SHALL 等价于上游 ccgui local behavior，既有 local flow 中 SHALL NOT 留下 account branch

### Requirement: First-release quota and usage are pull-only

首个本地打包试用 release SHALL 仅在登录用户主动打开 quota/usage view 或执行明确 refresh 时读取和呈现 remote quota/usage，并 SHALL NOT 发送 proactive quota/usage notices。

#### Scenario: User actively views quota and usage

- **WHEN** 登录用户打开 Account Center 的 quota/usage view 或选择 refresh
- **THEN** App SHALL 展示 current value、数据 freshness 以及 stale/unavailable 状态
- **AND** remote token-service usage SHALL 与 doge Local Mode/local usage 明确区分

#### Scenario: User does not open the view

- **WHEN** 用户未主动查看 quota/usage，或 remote quota 临近阈值、耗尽、stale 或 refresh 失败
- **THEN** 首包 SHALL NOT 发送 threshold、depletion、freshness 或 error proactive notice
- **AND** 该状态 SHALL NOT 限制或降级 Local Mode

### Requirement: Codex is the first one-click configuration recipe

首个本地打包试用 release SHALL 以 Codex 为 first recipe，并 SHALL 将 account authentication、配置提议与本地文件 mutation 视为三个独立授权阶段。

#### Scenario: Login succeeds without configuration consent

- **WHEN** 用户完成 durable account login
- **THEN** App MAY 展示 Codex one-click configuration offer
- **AND** SHALL NOT 因登录成功自动生成 API Key、选择已有 Key、读取目标配置内容或写入任何本地配置文件

#### Scenario: User selects an existing API Key

- **WHEN** 用户进入 Codex one-click configuration offer
- **THEN** App SHALL 先读取当前 token2api 账号的 renderer-safe API Key metadata，并要求用户显式选择一枚 active、未过期 Key
- **AND** 用户选择前 SHALL NOT 生成配置 plan 或读取目标配置内容
- **AND** 列表 SHALL 只展示 name、masked prefix、status 与 safe availability，不得向 renderer、log、analytics 或 diagnostics 暴露 raw API Key
- **AND** 选择动作只授权 account/device/recipe-bound Native handoff 与 OS vault commit，不授权修改配置文件

#### Scenario: Account has no selectable API Key

- **WHEN** 当前账号没有可用于 Codex 的 API Key
- **THEN** App SHALL 展示前往 `https://token-matrix.com/keys` 创建 Key 的外部入口
- **AND** SHALL 提供返回 App 后的主动刷新动作，并停留在 Key selection step
- **AND** SHALL NOT 在后台自动创建替代 Key 或把用户直接推进 configuration apply

#### Scenario: User reviews a Codex configuration plan

- **WHEN** 用户已选择并安全绑定一枚已有 API Key，随后允许生成 plan
- **THEN** App SHALL 在 apply 前展示 changed-file list
- **AND** 只有用户选择某个文件时才 SHALL 按需展示 semantic redacted diff
- **AND** UI、logs、analytics 与 diagnostics SHALL NOT 暴露 access token、refresh token、API key 或其他 secret
- **AND** configuration Dialog SHALL use an opaque themed surface and SHALL NOT depend on backdrop blur or transparent panel composition for readability

#### Scenario: User authorizes configuration apply

- **WHEN** 用户在当前 account/session、recipe/version 与未过期 plan 上明确确认 apply
- **THEN** doge SHALL 以可验证、可恢复的事务语义修改 Codex 配置并报告 file/reload/result 状态
- **AND** concurrent edit、permission error、partial failure 或 verification failure SHALL 提供 retry/rollback/recovery，不得静默覆盖用户自定义值或把 timeout 当成功

#### Scenario: User closes and reopens the result

- **WHEN** 用户 acknowledge/关闭配置结果且未 permanent dismiss
- **THEN** App SHALL 保留可重开结果的 doge avatar bubble
- **AND** bubble 的独立 `×` SHALL permanent dismiss 该入口，不得与 reopen action 混淆

### Requirement: Account convenience remains isolated from upstream local flows

所有 account convenience behavior SHALL 位于独立 doge-owned feature slice、adapter、route、state、storage 与 i18n boundary；既有 local flow SHALL NOT 新增 account branch。

#### Scenario: Upstream local behavior is compared with addon off

- **WHEN** account feature flags off，或 account module 未加载
- **THEN** startup、navigation、local state 与全部既有本地 journeys SHALL 通过 upstream-equivalence regression
- **AND** token2api route、account state 或 entitlement SHALL NOT 成为 local component 的条件依赖

### Requirement: Delivery uses a versioned shared contract and replaceable gateway

Frontend Experience、Doge Native Broker 与 token2api API/gaps 三条 lane SHALL 依赖同一 versioned Account contract；UI SHALL 只依赖稳定 `AccountGateway` / `AccountService` port，并 SHALL 在 integration 前由可替换 Mock adapter 驱动。

#### Scenario: Frontend is reviewed before backend integration

- **WHEN** Frontend Experience 处于 Mock review 阶段
- **THEN** button handler、component 与 presentation store SHALL NOT 包含散落 mock branching 或 token2api/Tauri implementation detail
- **AND** runtime/test gate SHALL 证明真实 token2api network 与 doge backend/native calls 为零

#### Scenario: Mock exercises deterministic failures and recovery

- **WHEN** reviewer 选择并重放 account scenario
- **THEN** deterministic stateful scenario engine SHALL 支持 reset、seed、advance、failure injection 与 transition-history inspection
- **AND** required catalog SHALL 覆盖 happy、validation/error、recovery、latency、offline/outage、MFA、OAuth callback、email verification/link、expired/replayed token、session recovery、vault unavailable 与 Codex configuration states，而不是全部返回成功

#### Scenario: Backend lanes progress independently

- **WHEN** Doge Native Broker 与 token2api API/gaps 实现同一 contract
- **THEN** 每条 lane SHALL 能依赖 shared fixtures/stubs 独立执行 contract tests
- **AND** backend availability SHALL NOT 迫使 UI 接受未确认交互，UI refinement 也 SHALL NOT 阻塞 backend conformance

### Requirement: Real integration happens only after contract conformance

Mock adapter、Doge Real adapter 与 token2api compatibility/gap implementation SHALL 在 Mock-to-Real replacement 前通过同一 versioned contract、negative cases 与 event-order conformance；adapter replacement SHALL 只发生在 composition root。

#### Scenario: Contract drift is detected

- **WHEN** Mock 与任一 Real implementation 对 shared fixture、closed error、capability negotiation 或 event ordering 的结果不一致
- **THEN** integration gate SHALL 失败并先修正 contract 或 adapter
- **AND** UI SHALL NOT 增加临时 route-specific branch 绕过 drift

#### Scenario: Late integration starts

- **WHEN** 用户已确认 Mock UX，required scenarios 已验收，且三条 lane conformance 全绿
- **THEN** 系统 SHALL 保持 UI journey/port 不变并将 Mock adapter 替换为 Real adapter
- **AND** 随后 SHALL 执行真实 registration/email verification、login/MFA/OAuth、forgot/reset、restore/logout、pull-only quota/usage、Codex configuration 与 failure/recovery E2E

### Requirement: The first local packaged trial is a bounded vertical slice

首个可本地安装试用的 release SHALL 包含 Real adapter 下的 Local Mode invariant、完整 account access、单一 Account Center、pull-only quota/usage 与 Codex one-click configuration；P5+ 长期能力 SHALL NOT 成为该 release 的 blocking scope。

#### Scenario: Local trial package is accepted

- **WHEN** 目标试用平台的 Real integration/e2e、package install、launch smoke、Local Mode regression 与用户体验验收全部通过
- **THEN** release MAY 作为首个本地打包试用版本交付
- **AND** production billing/order、device/session management UI、multi-account、remote/daemon/web、proactive notices、非 Codex recipes 或全平台 GA 尚未交付 SHALL NOT 单独使该 release 失败

#### Scenario: Only the Mock experience is complete

- **WHEN** Mock UI 已获用户确认，但任一 Real adapter、token2api prerequisite、contract conformance、integration/e2e 或 package smoke 尚未通过
- **THEN** change SHALL NOT 被宣称为本地打包试用完成
- **AND** 用户 SHALL 仍可继续使用完整 Local Mode
