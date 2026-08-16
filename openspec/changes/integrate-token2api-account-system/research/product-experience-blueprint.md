# doge Account Convenience — Product Experience Blueprint

> 状态：`product-review-ready`（research artifact，不是 `proposal.md`、`design.md` 或 `tasks.md`）
>
> Owner：`product-design-owner`
>
> Product scope：定义 Account Convenience 的功能、交互、用户收益与体验验收；不展开底层实现方案。
>
> Evidence：吸收 UX researcher handoff、`research/synthesis.md`、关联 Trellis PRD、doge current UI patterns，以及 `/Users/jason/GitHub/token2api` 当前 auth Web/API evidence；token2api 仅用于识别既有 capability 与状态，不作为 doge App UI 模板。
>
> 标记约定：**Confirmed** 表示已确认产品事实；**Recommendation** 表示推荐但尚待产品确认；**Future** 表示纳入完整产品地图但不承诺首期交付。

## 0. Experience North Star

用户在任何 Account surface 都应能迅速回答三个问题，且顺序不可颠倒：

1. **现在能否继续使用？**
2. **是否需要我采取行动？**
3. **doge 将要或已经改动什么？**

### Confirmed product foundation

- Local Mode 完整可用；未登录不是 guest、trial 或受限版本。
- Account Convenience 是 ccgui local experience 上的独立增益层，关闭 addon 后原 local UX 不变。
- Account interaction 覆盖注册、邮箱验证、登录、找回/重置密码、MFA 与可用 OAuth provider；登录收益首先是小白一键配置、doge token service 接入、额度与用量透明，长期扩展 subscription、billing、device/session 与 multi-account。
- 登录仅建立 Account session，不代表用户同意修改本地配置。
- Account 或 token service 不可用时，Local Mode 仍保持可用。
- 内部安全、credential、transaction 与平台验证属于 Engineering Quality Gates，不占用户主交互。
- 开发策略采用 **Contract-first + Mock-first UI + Parallel backend + Late integration**：UI 评审阶段不调用真实 token2api/doge backend；Frontend Experience、Doge Native Broker、token2api API/gaps 三条 lane 按同一 versioned contract 并行推进，contract conformance 通过且用户确认 UI 后才 late integrate。

## 1. Product Thesis And Value Proposition

### Product thesis

doge Account 的产品价值不是“要求用户创建账号”，而是把容易出错、难以理解、需要持续维护的 CLI 服务接入，转化为一个**可选、可见、可恢复**的便捷体验，同时完整保留用户已有的 Local Mode 与手工配置控制权。

### Value proposition

| Benefit layer | 用户承诺 | 代表能力 |
|---|---|---|
| 立即可用 | “我不需要理解配置文件，也能把 CLI 接到 doge token service。” | 登录、adaptive offer、一键配置、明确结果 |
| 持续安心 | “我知道当前是否可用、还剩多少、何时需要处理。” | 配置健康、usage/quota、freshness、actionable notice、恢复入口 |
| 长期管理 | “我能统一管理套餐、账单、设备、session 与多个账号。” | subscription、billing、device/session、multi-account、remote/cloud |

### Product principles

1. **Local complete, account additive**：账号增加便利，不定义使用资格。
2. **Availability before promotion**：先说明 Local Mode 是否可用，再介绍登录收益。
3. **Value before identity**：登录入口先解释用户能得到什么，不以“完善账号”为目的。
4. **Preserve before replace**：先承认已有可用配置；不把“更方便”变成“覆盖用户选择”。
5. **Explicit action scope**：CTA 必须说清将配置哪个 CLI、接入什么服务、是否会改文件。
6. **Progressive proof**：先给结论，再给 changed-file list，最后按需展开 diff。
7. **Quiet by default**：只在首次激活、terminal result 或确实需要行动时主动出现。
8. **Honest freshness and outcomes**：stale data 不伪装 current；noop、partial、failure 不包装成 success。
9. **Continuity over interruption**：ordinary close 不丢任务；恢复入口稳定，但不形成 nag loop。
10. **Accessible and localizable**：完整 keyboard/focus、screen reader、text expansion 与 reduced-motion 行为。

## 2. Personas And Jobs To Be Done

| Persona | Context | Core JTBD | Success signal | Primary risk |
|---|---|---|---|---|
| 零配置新手 | 不理解 CLI provider、key 或配置文件 | “帮我快速获得一个能工作的 CLI，并告诉我是否成功。” | 一次明确操作后可用；无需阅读 diff | 技术细节过载；误以为必须登录才能用 doge |
| 额度敏感用户 | 高频使用 token service，关心成本与重置周期 | “让我随时知道剩余额度和数据时效，在耗尽前决定下一步。” | 能解释 remaining、reset 与 freshness | local usage 和 remote quota 混淆；stale data 造成错误决策 |
| 手工配置进阶用户 | 已有 provider、代理或自定义 config | “保留我的配置，只有在我明确选择时才添加或切换服务。” | doge 识别现状并默认 preserve | 登录后被覆盖；动作 scope 不清楚 |
| Local-first / 弱网用户 | 离线、网络不稳定或不愿登录 | “让我不依赖账号继续工作，远端失败时也不要打断本地流程。” | Local Mode 始终可用，account 状态安静降级 | 账号入口过强；outage 变成全局阻塞 |

### Shared user questions

所有 persona 的界面信息应服从以下共同优先级：

1. 可用性：Local Mode 与 doge token service 当前分别能否使用。
2. 剩余与时效：剩余额度、周期、数据更新时间。
3. CLI 连接状态：哪个 CLI 已连接到什么服务，是否需要行动。
4. 变更与控制：doge 准备改什么、已经改什么、如何重试或退出。
5. 账号管理：profile、plan、billing、devices、sessions、multi-account。

## 3. Complete Feature Map

| Horizon | Capability | User outcome | Default discoverability |
|---|---|---|---|
| 始终 | Full Local Mode | 无登录、离线或 account 故障时继续使用既有本地能力 | 原 ccgui local surfaces，不出现 account gate |
| 立即 | Register / verification | 在 App 内创建账号并完成必要邮箱验证 | Account entry → 统一 Auth Container |
| 立即 | Login / recovery / MFA | 建立或恢复可选 convenience identity | Account entry；相关 token-service contextual CTA |
| 立即 | OAuth sign-in | 使用服务端当前开放且 Desktop-compatible 的 provider 登录/注册 | Auth Container → system browser round trip |
| 立即 | Adaptive configuration offer | 根据用户当前配置给出 preserve-first 的下一步 | interactive login 后一次主动出现 |
| 立即 | One-click configuration | 以明确授权接入 doge token service | offer / Config Center |
| 立即 | Transparent result | 看见结果、changed files 与 lazy safe diff | configuration terminal result 主动出现 |
| 立即 | Recovery continuity | 关闭后可恢复，失败时有下一步 | task bubble + Config Center |
| 持续 | Configuration health | 知道 CLI 是否已连接、是否漂移、是否可用 | Account Overview + CLI 连接 |
| 持续 | Usage / quota / freshness | 理解剩余、已用、重置时间和数据时效 | Account Center 主动查看；必要时低打扰 notice |
| 持续 | Actionable account state | 登录失效、配置漂移、额度接近耗尽时获得可行动提示 | 仅 genuinely actionable 时主动出现 |
| 持续 | Local usage | 查看本地统计，不与 remote quota 混合 | 保留既有本地 usage 入口 |
| 长期 | Subscription / billing | 查看计划、续费与账单，管理套餐 | Account Center 用户主动进入 |
| 长期 | Device / session management | 识别当前设备、撤销其他 session、处理丢失设备 | Account Center 用户主动进入 |
| 长期 | Multi-account | 安全切换工作身份并理解当前 active account | Account Center 用户主动进入 |
| 长期 | Remote / daemon / web | 在更多设备形态获得同样的 convenience benefit | 对应产品 surface，能力可用后再出现 |

## 4. Navigation And Discoverability

### Entry strategy

**Recommendation — dual entry with restrained context**：

- **Canonical entry**：Settings 一级导航中的 `Account`，永久承载 Account Center。
- **Contextual lightweight entry**：仅当用户主动选择/使用 doge token service 且尚未完成连接时展示，例如 `连接 doge Token 服务`。
- **Post-login activation**：interactive login 成功后只主动展示一次 adaptive configuration offer。
- **Task recovery**：doge bubble 只恢复当前 configuration offer/result/attention state，不承担永久 Account Center 导航。

该方案兼顾新手发现率与 Local-first 安静性。它仍是 Recommendation，不是已确认 Decision。

### Proactive versus user-initiated surfaces

| 主动出现 | 条件 | 抑制规则 |
|---|---|---|
| Post-login offer | 用户刚完成 interactive login | 每次明确登录完成最多一次；ordinary close 后不自动重弹 |
| Configuration terminal result | 用户此前明确发起配置 | 必须展示 success/noop/partial/failure 的真实结果 |
| Config drift notice | 已确认的连接状态变为需要行动 | 同一 unresolved issue 去重；用户处理或 hard dismiss 后停止 |
| Login expired notice | 仅 account-backed action 需要重新登录 | 不阻塞、不覆盖 Local Mode 操作 |
| Quota nearing depletion | 达到用户允许的提醒策略 | 推荐 opt-in；同一周期有 cooldown |
| Context CTA | 用户正在选择 doge token service 且未连接 | 不在无关 local flow 中展示 |

| 用户主动访问 | 入口 |
|---|---|
| 登录 / 退出 | Account Center |
| Account Overview | Settings → Account |
| 完整 usage 趋势 / quota | Account Center → 用量与额度 |
| Subscription / billing | Account Center → 账号与套餐 |
| Device / session | Account Center → 设备与会话 |
| Local usage | 既有 local usage surface，保持原入口与语义 |

### Logged-out Account landing

首屏顺序：

1. `Local Mode 可正常使用` 的 availability confirmation。
2. 三项登录收益：一键配置、doge token service、额度透明。
3. Primary CTA：`登录 doge`。
4. Peer action：`创建账号`；不藏在难发现的正文链接中。
5. Secondary action：`继续使用 Local Mode`，返回打开 Account 前的原工作流。

禁止使用“继续使用受限版本”“解锁基础功能”或倒计时式营销文案。

### token2api current auth capability calibration

以下是 doge Auth interaction 的 capability source，不代表照搬 token2api Web 页面：

| Current capability | Evidence | doge product treatment |
|---|---|---|
| Email/password register and login | `token2api:frontend/src/api/auth.ts`；`backend/internal/server/routes/auth.go` 的 `/auth/register`、`/auth/login` | 作为 App 内 primary auth path；使用 doge Auth Container 与表单规范 |
| Configurable email verification | `PublicSettings.email_verify_enabled`；`/auth/send-verify-code`；`EmailVerifyView.vue` | 注册后进入 6 位验证码 screen；支持 resend/cooldown/change email/session recovery |
| Password recovery | `PublicSettings.password_reset_enabled`；`/auth/forgot-password`、`/auth/reset-password` | App 内发起；邮件链接通过系统浏览器/应用链接恢复到 reset screen |
| TOTP MFA | `/auth/login/2fa`；`TotpLoginResponse.requires_2fa` | 密码登录或 OAuth bind 后进入独立 MFA step；未完成不算登录成功 |
| OAuth | public settings 控制 GitHub、Google、LinuxDo、DingTalk、WeChat、OIDC；`routes/auth.go` | 只展示服务端 enabled 且当前 Desktop flow 已验证的 provider；通过系统浏览器往返 |
| OAuth account completion | pending OAuth endpoints 可要求 create account、bind existing account、email verification、invitation 或 TOTP | 回到同一 Auth Container 继续完成；禁止静默合并身份 |
| Registration policy | `registration_enabled`、email suffix allowlist、invitation、promo、login agreement、Turnstile | 由 capability 决定字段/步骤；不可用时显示替代路径，不显示无效控件 |

**Current fact / target experience distinction**：token2api Web 当前使用独立 routes 和 browser storage；doge target experience 使用统一 App container、系统浏览器往返与 App-owned recovery state。具体 credential、callback 与 deep-link 实现继续属于 Engineering Quality Gates。

## 4A. Unified Account Center And Auth Container

### 4A.1 Information architecture

```text
Settings → Account
  ├─ Logged-out landing
  │    ├─ 登录 doge
  │    ├─ 创建账号
  │    └─ 继续使用 Local Mode
  ├─ Auth Container
  │    ├─ Login
  │    ├─ Register
  │    ├─ Email verification
  │    ├─ Forgot password
  │    ├─ Reset password
  │    ├─ MFA
  │    ├─ OAuth waiting / return / account completion
  │    └─ Auth success handoff
  └─ Logged-in Account Center
       ├─ 总览
       ├─ 用量与额度
       ├─ CLI 连接
       ├─ 账号与套餐
       └─ 设备与会话（Future）
```

### 4A.2 Container contract

Auth Container 是一套统一 task surface，而不是每种认证方式各自发明页面：

- 从 `Settings → Account` 进入时，Auth Container 在 Account 内容区内呈现；从 contextual CTA 进入时，可使用相同内容的 opaque modal，但 screen/state contract 完全一致。
- Header 固定包含 doge Account 标题、当前 step title、可选 back action 与关闭 action。
- Footer 固定包含 `继续使用 Local Mode`。它返回 auth 发起前的 workspace/context，不清除用户已完成的远端步骤，也不把离开解释为失败。
- `登录` 与 `创建账号` 是 auth landing 上的 peer choices；进入深层 step 后不继续显示 segmented tabs，改用明确 `返回登录` / `返回创建账号`。
- 容器宽度适配单列 form；窄屏 action 纵向堆叠。OAuth provider 超过 3 个时用 `更多登录方式` progressive disclosure，不形成 logo wall。
- 所有 surface 使用实色背景、现有 theme tokens 与克制的 preference language；不新增营销插画、glass effect 或大面积 provider 品牌装饰。

### 4A.3 Navigation, back, close and draft semantics

| Current screen | Back | Close / `继续使用 Local Mode` | Re-entry behavior |
|---|---|---|---|
| Login / Register | 回到 logged-out Account landing | 返回 auth 发起前的 App context | 可恢复 email；password 默认不跨容器关闭持久化 |
| Verification pending | `更换邮箱` 回 Register，并明确旧 code 将失效/不可继续 | 返回 Local Mode；保留可安全恢复的 pending verification summary | Account entry 显示 `继续验证邮箱`，而非重开空 Register |
| Forgot password | 返回 Login，保留 email | 返回 Local Mode | 再进入可恢复 email，不宣称邮件已发送除非 server 已接受请求 |
| Reset password | 无效/过期时进入 request-new-link；有效时可返回 Login | 返回 Local Mode；不保存 password draft | 再次打开有效 link 恢复 reset；过期 link 始终进入 recovery state |
| MFA | `取消验证` 回 Login；不算 authenticated | 返回 Local Mode | pending MFA 未过期时可显示 `继续验证`；过期则要求重新登录 |
| OAuth waiting | `取消登录` 回 Login | 返回 Local Mode，同时 Auth Container 保留 bounded waiting summary | callback 到达时可恢复；user-canceled flow 不再主动抢焦点 |
| OAuth account completion | 返回 OAuth provider choice 会丢弃当前 completion intent，需二次确认 | 返回 Local Mode，保留 bounded completion summary | Account entry 显示 `继续完成账号`；过期则重新开始 provider 登录 |
| Auth success handoff | 返回 Account Overview | 关闭后留在原 App context | Account Center 已登录；activation offer 遵守 once-only 规则 |

### 4A.4 Capability-loading states

| State | Screen behavior | Actions |
|---|---|---|
| Loading public auth options | Header + short skeleton；不先闪现可能被禁用的表单/provider | `继续使用 Local Mode` 始终可用 |
| Loaded | 只显示 enabled capability 与适用字段 | 正常 auth actions |
| Load failed / offline | `暂时无法加载登录方式，Local Mode 可正常使用` | `重试`、`继续使用 Local Mode` |
| Registration disabled | Register route 显示 `暂时无法创建新账号`，不渲染 disabled form | `登录已有账号`、`继续使用 Local Mode` |
| Password reset disabled | Login 不显示 forgot link；直接 deep link 显示 capability unavailable | `返回登录`、`继续使用 Local Mode` |
| No Desktop-compatible OAuth | 隐藏 OAuth divider/provider group | Email/password path 保持完整；不得显示 disabled provider |

## 4B. Register Journey

### 4B.1 Screen R0 — Create account form

**Purpose**：创建 doge Account，不暗示这是使用 Local Mode 的前置条件。

**Information order**：

1. Title：`创建 doge 账号`。
2. Support copy：`用于一键配置 doge Token 服务和查看额度；Local Mode 无需账号也可使用。`
3. Form fields。
4. `创建账号` / `继续并验证邮箱` primary CTA。
5. OAuth alternatives（若 enabled + Desktop-compatible）。
6. `已有账号？登录` 与 `继续使用 Local Mode`。

**Fields and behavior**：

| Field | Visible when | Validation / interaction |
|---|---|---|
| Email | Always | trim；empty/format inline error；server email suffix policy 为 canonical；`autocomplete="email"` |
| Password | Email/password registration enabled | 默认隐藏；独立 `显示密码` accessible toggle；当前 API baseline 最少 6 字符，UI 应展示当前有效 requirement；`autocomplete="new-password"` |
| Invitation code | `invitation_code_enabled` | Required；blur/settled input 后校验；valid/invalid 使用文字 + icon，不只用颜色 |
| Promo code | `promo_code_enabled` | Optional；收进 `有优惠码？` disclosure；invalid 不清空用户输入；说明是否阻止注册由 server policy 决定 |
| Login agreement | capability enabled | 以 checkbox + 可打开的文档列表呈现；未同意时 primary disabled，并给出原因；拒绝仍可回 Local Mode |
| Human verification | capability required | 位于 submit 前；过期/失败显示局部恢复；不能完成时仍可退出 Local Mode |

**Submit**：

- 无 email verification：CTA `创建账号`；submit 后进入 `R2 Account created`。
- 有 email verification：CTA `继续并验证邮箱`；server 接受发送后进入 `R1 Verification pending`。
- Loading 文案 `正在创建…` / `正在发送验证码…`；整个 form mutation controls disabled，close/Local Mode 仍可用。
- Request failure 保留 email、invitation/promo 与非敏感选择；password 不因 network error 自动清空，但关闭容器后不持久化。
- Email already registered 使用 form-level message：`这个邮箱已有账号`，actions 为 `前往登录`、`找回密码`；不留在无解的 Register error。

### 4B.2 Screen R1 — Verification pending and resend

**Default state**：

- Title：`验证你的邮箱`。
- Copy：`验证码已发送至 {email}`；显示完整用户输入 email 或适度 mask，但必须让用户能确认是否输错。
- 单一 6 位 numeric input，支持 paste、password manager/OS one-time-code autofill；不使用 6 个对 screen reader 不友好的孤立输入格。
- Primary CTA：`验证并创建账号`；输入完整 6 位后 enabled，Enter 可提交，不强制 auto-submit。
- Secondary：`更换邮箱`；返回 Register，保留可安全字段并清除 password/verification context 后要求重新输入 password。
- Resend：显示 `重新发送（{seconds}s）` countdown；结束后变为 `重新发送验证码`。

| Verification state | Behavior | Recovery |
|---|---|---|
| Initial send pending | 输入暂不可提交；显示 `正在发送验证码…` | send 失败后 `重新发送` / `更换邮箱` / Local Mode |
| Code sent | polite status `验证码已发送`，不抢 focus | 输入 code |
| Invalid code | input inline error `验证码不正确，请重试`；清 code、focus 回 input | 可重新输入；resend 不被隐藏 |
| Expired code | `验证码已过期` | `发送新验证码` |
| Resend cooldown | button disabled但可读剩余秒数 | countdown 到 0 自动恢复 action |
| Rate limited | 显示 server-provided safe retry time（若有） | retry time 后 resend；Local Mode 始终可达 |
| Pending session missing/expired | 不显示空 code form | `重新开始注册`、`登录已有账号`、Local Mode |
| Network interrupted on verify | 不宣称失败创建；保留 code 与 email | `重试验证`；若 server 回报账号已存在则转 Login/Account success reconciliation |

### 4B.3 Screen R2 — Account created

- Title：`账号已创建`。
- 第一行：`Local Mode 保持不变。`
- 同一 surface 立即加载 Auth success handoff（§4H）：额度概览 + adaptive config suggestion。
- Quota 未加载或失败不阻塞账号成功；显示独立 `额度暂时无法加载` + `稍后重试`。
- 不先跳到空白 Account dashboard，也不把注册成功等同配置成功。

## 4C. Login Journey

### 4C.1 Screen L0 — Sign in

**Form**：email、password、`显示密码`、`忘记密码？`（capability enabled 时）；primary CTA `登录`。

- Email uses `autocomplete="email"`；password uses `autocomplete="current-password"`。
- Password visibility toggle 有动态 accessible name：`显示密码` / `隐藏密码`，不改变 cursor/focus。
- OAuth divider 文案 `或使用以下方式登录`；provider 只显示 server enabled + Desktop-compatible 项。
- Footer 提供 `没有账号？创建账号` 与 `继续使用 Local Mode`。
- Login agreement 若当前服务要求，先显示 concise acknowledgement 与文档入口；不能把协议拒绝包装成 App 不可用。

### 4C.2 Login submission states

| State | Concrete behavior |
|---|---|
| Validating | 只在 submit/blur 后显示 field error；不要首次输入每个字符都报错 |
| Submitting | CTA `正在登录…` + spinner；email/password/OAuth actions disabled；close/Local Mode 可用 |
| Success without MFA | 进入 §4H；不在 Login screen 只闪一个 toast 后消失 |
| MFA required | 进入 `M0 Verify identity`；保留 masked email context，不回显 password |
| Wrong credentials | Form-level error `邮箱或密码不正确`；避免区分账号是否存在；focus password，允许重试/forgot |
| Email unverified, if server exposes state | `需要先验证邮箱` | `发送新验证码` → R1；`更换账号` |
| Account disabled/restricted | 使用 safe server reason 说明无法登录，不建议反复 retry | `联系支持`（仅有 support channel 时）、`使用其他账号`、Local Mode |
| Rate limited | `尝试次数过多，请在 {time} 后重试` | 不自动循环请求；Local Mode |
| Offline / timeout | `无法连接 doge 服务，Local Mode 可正常使用` | `重试登录`；保留 email/password current in-memory draft |
| Unknown response | 不展示 raw upstream error | `重试`、`返回登录方式`、Local Mode |

## 4D. Forgot And Reset Password Journey

### 4D.1 Screen P0 — Request reset link

- Entry：Login 的 `忘记密码？`。
- Title：`重置密码`。
- Copy：`输入注册邮箱。如果该邮箱存在，我们会发送重置链接。Local Mode 不受影响。`
- Field：email（从 Login prefill，可编辑）。
- Primary CTA：`发送重置链接`；loading `正在发送…`。
- Secondary：`返回登录`；persistent：`继续使用 Local Mode`。
- Human verification 仅在 capability 要求时显示。

**Accepted state**：无论邮箱是否存在，统一显示 `如果该邮箱已注册，你会收到重置邮件`，并提供：

- `返回登录`
- cooldown 后 `重新发送`
- `更换邮箱`
- `继续使用 Local Mode`

不得用 success copy 确认某邮箱已注册。

### 4D.2 Reset link system-browser and deep-link recovery

1. 用户在邮件中点击 reset link。
2. 若平台支持 App link/deep link，系统唤起 doge 并恢复 Auth Container 的 `P1 Set new password`。
3. 若 doge 未运行，启动后直接恢复 P1；workspace/local startup 不等待 reset state。
4. 若 link 首先落到系统浏览器，browser landing 只提供 `打开 doge` 与必要 fallback，不显示 secret/token 内容。
5. 用户拒绝打开 App 或关闭 browser 后，Account Center 保留 `继续重置密码` 的安全提示（仅在可恢复 context 有效时）；Local Mode 可继续。
6. 同一 link 再次打开、过期或已使用时进入 P3 recovery，不停留在 spinner。

### 4D.3 Screen P1 — Set new password

| Element | Contract |
|---|---|
| Account context | 显示可识别 email（read-only）；若 link 不含有效 context 则直接 P3 |
| New password | 默认隐藏；显示 current requirement；`autocomplete="new-password"` |
| Confirm password | 独立输入；支持显示/隐藏；默认与第一字段 visibility 独立，避免意外同时暴露 |
| Primary CTA | `设置新密码`；只有 local validation 通过时 enabled |
| Secondary | `返回登录`（提示尚未更改密码）、Local Mode |

Validation：required、当前 minimum policy、两次不一致均 inline；server rejection 使用 form-level safe copy，并保留可修正 draft。Submitting 时 primary 变为 `正在设置…`，禁止重复提交。

### 4D.4 Screen P2 — Reset success

- Title：`密码已重置`。
- Copy：`现在可以使用新密码登录。Local Mode 始终可用。`
- Primary CTA：`使用新密码登录`，返回 Login 并 prefill email；password 必须由用户重新输入。
- 不自动登录，不自动触发 configuration offer。

### 4D.5 Screen P3 — Invalid / expired / consumed link

- Title：`此重置链接已失效`。
- 不用 generic `出现错误`；明确可能是过期或已使用，但不暴露内部 token reason。
- Primary CTA：`获取新链接`，进入 P0 并 prefill email（如可安全获取）。
- Secondary：`返回登录`、`继续使用 Local Mode`。
- Network 无法确认 link 时使用 `暂时无法验证链接`，提供 `重试`；不要误判为 expired。

## 4E. MFA Journey

### 4E.1 Screen M0 — Verify identity

- Title：`输入身份验证器中的验证码`。
- Context：显示 masked account email；说明这是登录的最后一步。
- 使用单一 6 位 numeric field，支持 paste、one-time-code autofill、Enter submit；不强制 auto-submit。
- Primary CTA：`验证并登录`；loading `正在验证…`。
- Secondary：`取消验证并返回登录`；persistent：`继续使用 Local Mode`。
- Current API 未证明 recovery-code/self-service reset capability，因此 App 不显示不可用的 `使用恢复码`。如有正式 support channel，可提供低优先级 `无法访问身份验证器？联系支持`。

| MFA state | Behavior | Recovery |
|---|---|---|
| Invalid code | 清空 code；inline `验证码不正确`；focus code field | 重新输入 |
| Code expired / time drift | `验证码已更新，请输入当前验证码` | 清空重试 |
| Challenge expired | 不再接受输入 | `重新登录`，返回 L0 |
| Network interrupted | 保留 code only while current screen remains；不宣称失败 login | `重试验证` / `取消验证` |
| Too many attempts | 显示 retry time / challenge reset requirement | `重新登录` 或等待；Local Mode |
| Success | 进入 §4H | 不重复 Login toast + redirect chain |

## 4F. OAuth System-browser Journey

### 4F.1 Provider presentation

- Provider list 来自 token2api public capability，但 App 只呈现已经完成 Desktop/browser-return QA 的 provider。
- Primary candidates 可包含 GitHub、Google、LinuxDo、DingTalk、WeChat、OIDC；实际显示由 server + platform capability 共同决定。
- 超过 3 个 provider 时首屏展示最相关 2–3 个，其余放入 `更多登录方式`。
- Provider action copy 为 `使用 {Provider} 登录`，不只显示 logo。
- WeChat 等环境要求不满足时隐藏 action或显示明确替代说明；禁止点击后才发现当前环境永远无法完成。

### 4F.2 Screen O0 — Leave App confirmation and launch

点击 provider 后：

1. Auth Container 显示 `将在系统浏览器中继续使用 {Provider} 登录`。
2. Primary `打开系统浏览器`；secondary `选择其他方式`。
3. 浏览器成功打开后进入 O1；打开失败则原地显示 `未能打开浏览器` + `重试` / `复制登录链接`（仅当链接可安全复制）/ `使用邮箱登录`。

### 4F.3 Screen O1 — Waiting for browser

- Title：`在浏览器中完成登录`。
- Status：`完成后将自动返回 doge`；可显示 provider name，不显示 code/state/token。
- Actions：`再次打开浏览器`、`取消登录`、`继续使用 Local Mode`。
- App 失焦/隐藏时不弹额外通知；回到 App 后 waiting screen 保持。
- 等待超过正常时间不自动判失败；转为 `仍在等待`，提供 `重新开始`。
- App restart 后若 pending attempt 仍有效，恢复 O1；已过期则 O3 `登录已过期`。

### 4F.4 Browser return and deep-link recovery

| Return state | App behavior |
|---|---|
| Existing identity, login complete | 进入 §4H |
| Provider canceled / denied | O3：`你已取消 {Provider} 登录`；`重试` / `选择其他方式` / Local Mode |
| Callback arrives while Auth Container closed | 不强制覆盖用户当前工作；Account entry 显示 `登录已完成`，首次成功可用低打扰 notice 打开 §4H |
| Callback arrives after user explicitly canceled | 不自动登录/抢焦；提示该 attempt 已取消，需重新开始 |
| Invalid/expired callback | O3：`此登录请求已失效`；`重新使用 {Provider} 登录` |
| Network interruption during exchange | O3：`暂时无法完成登录`；`重试完成`（若安全可重试）或 `重新开始` |
| App not running | deep link 启动 doge，local workspace 恢复与 Auth completion 解耦；进入 O1/O2/O3 的真实状态 |

### 4F.5 Screen O2 — Complete or link account

OAuth 不一定直接完成登录。Auth Container 根据 server result 呈现下列明确分支：

| Server outcome | Screen | Required interaction |
|---|---|---|
| New identity + account creation allowed | `完成账号创建` | Review provider email/profile；按 policy 补 password、email verification、invitation/agreement；明确 `创建新账号` |
| Existing email/account needs linking | `连接到已有账号` | 显示 masked/entered email；要求 password，必要时进入 MFA；CTA `验证并连接` |
| User must choose create vs link | `这个登录方式还没有连接到 doge` | 两个清晰 choices：`创建新账号` / `连接已有账号`；不默认选择 |
| Provider suggests name/avatar adoption | `确认账号资料` | 每项独立 checkbox，默认值需产品/服务 policy 明确；拒绝 adoption 不阻塞 login |
| Registration disabled | `无法用此方式创建新账号` | `连接已有账号`、`使用邮箱登录`、Local Mode |
| Invitation required | 在 create flow 中显示 required invitation field | 无 code 时可 `返回登录方式`，不留死路 |
| Email verification required | 进入 R1，但保留 provider context | verify 成功后完成 OAuth account creation 并进入 §4H |
| Binding requires MFA | 进入 M0 | MFA success 后才算 link/login complete |

**No silent merge rule**：相同 email、相似 profile 或既有 provider identity 都不能直接替用户决定“创建”或“连接”。所有 link CTA 必须写清“连接后可使用 {Provider} 登录此 doge 账号”。

### 4F.6 Screen O3 — OAuth terminal error/recovery

- Error message 只描述用户可行动原因：canceled、expired、provider unavailable、account completion needed、temporarily unavailable。
- 不展示 raw provider query、backend message、state/code 或 internal ID。
- 每个 O3 至少包含一个 recovery action和 `继续使用 Local Mode`；禁止仅有关闭按钮。

## 4G. Form, Loading And Error Presentation Contract

### 4G.1 Validation timing and draft behavior

- Required/format errors在 blur 或 submit 后出现；用户开始修正后清除对应 stale error。
- Server canonical policy（email suffix、invitation、promo、agreement、password requirement）覆盖 client preliminary validation。
- Submit failure 不清空 email、invitation、promo、verification code以外的可恢复 context；password 在同一打开 container 内可保留，关闭/restart 不持久化。
- 从 Login → Forgot → Login 保留 email；Reset success → Login 只保留 email，不携带新 password。
- Password manager/autofill 必须使用正确 `autocomplete`；visible toggle 不更改 input value。

### 4G.2 Error hierarchy

| Level | Use | Placement | Example |
|---|---|---|---|
| Field | 单个字段可直接修正 | field 下方，与 `aria-describedby` 关联 | `请输入有效的邮箱地址` |
| Form | 凭据、policy 或本次 submit 整体失败 | title 下方的 persistent banner；submit 后 focus 到 summary | `邮箱或密码不正确` |
| Step | 当前 challenge/link/provider 无法继续 | 替换 form 为 recovery state | `此重置链接已失效` |
| Service | Network/outage/public settings 不可用 | container 内 availability banner | `暂时无法连接 doge 服务，Local Mode 可正常使用` |
| Global | 仅 auth 已完成但 container 不在前台等跨 surface outcome | 低打扰 notice | `登录已完成` |

- 不用 toast 作为唯一错误载体；用户必须能在 screen 内重新阅读原因与 action。
- Error copy 先说明 Local Mode consequence，再给 safe reason 与 next action。
- Unknown/raw server error 映射为 allowlisted general copy；support reference 仅在真实可用时显示。

### 4G.3 Loading and duplicate-action prevention

- 初次 capability load、submit、resend、OAuth launch/exchange、quota fetch 分别有独立 loading state，不用一个全屏 spinner掩盖全部阶段。
- Primary action loading 时保留原动词语义，例如 `正在登录…`，不只显示 spinner。
- Mutation action pending 时 disable 同类 action，防重复 request；返回 Local Mode/关闭仍可用，除非平台 browser handoff 正在完成一个不可中断的瞬时 transition。
- Timeout 不自动转 success；展示 `仍在处理` 或 safe retry/reconciliation state。

## 4H. Post-auth Success, Quota And Configuration Handoff

Auth success 不直接跳过用户价值，也不把登录成功误写成配置成功。统一 handoff 按优先级执行：

1. **Resume interrupted intent**：如果登录源自 `查看额度`、`配置 CLI` 或 expired re-auth，先回到原任务；不要重复 onboarding。
2. **First auth / not activated on this device**：显示一次 Activation summary。
3. **Returning normal login**：进入 Account Overview；只有真正 actionable issue 才出现 suggestion。

### 4H.1 Activation summary layout

| Region | Content | Failure isolation |
|---|---|---|
| Auth confirmation | `已登录为 {account}`；`Local Mode 保持不变` | Profile refresh 失败时显示 generic signed-in state，不阻塞 local work |
| Quota overview | doge Token 服务 remaining、reset、freshness；`查看完整用量` | Loading 显示 skeleton；失败显示 `额度暂时无法加载`，不影响 config offer |
| CLI readiness | 当前 CLI：no config / healthy manual / conflict / already doge | Unknown state 显示 `正在检查` / `暂时无法确认`，不默认推荐 mutation |
| Adaptive offer | 复用 §6 四路径 | 登录不构成 consent；mutation CTA scope-rich |

### 4H.2 When to show one-click configuration

| Auth completion context | Behavior |
|---|---|
| New account created | 显示 Activation summary + adaptive offer；这是首次可见核心收益 |
| First successful login on this device | 同上，每次明确 login completion 最多一次 |
| Returning login, configuration not activated | 可显示一次 adaptive offer；ordinary close 后转 task bubble，不反复弹窗 |
| Re-auth after expiry during an account action | 恢复原 action；只有原 action 是 config 时继续 config context |
| Healthy manual config | 默认 preserve；明确选择 add/switch 才继续 |
| Already doge configured | 不再弹 config offer；展示 quota + `查看用量与额度` |
| Quota unavailable | 仍可展示已确认安全的 config offer，但 copy 不声称 quota/plan active |
| CLI state unknown | 不展示 mutation CTA；`重新检查连接状态` |

### 4H.3 Close and acknowledgement

- 关闭 Auth success handoff：账号保持登录；如果有 current configuration offer，按 §11 ordinary close → task bubble。
- `已知晓` 只用于 configuration terminal result，不用于 auth success。
- `稍后配置` 是清楚的 non-mutation choice；Account Center → CLI 连接保留用户主动入口。

## 4I. Authentication End-to-end No-dead-end Matrix

| Journey / interruption | Required continuation | Local Mode path |
|---|---|---|
| Register → verification → success | R0 → R1 → R2 → §4H | 每屏 footer 可退出；Account entry 可继续 pending verification |
| Register direct success | R0 → R2 → §4H | 同上 |
| Register disabled | Login existing account / compatible OAuth | `继续使用 Local Mode` |
| Verification code missing/expired | Resend / change email / restart register | `继续使用 Local Mode` |
| Login → MFA → success | L0 → M0 → §4H | M0 可 cancel；每屏可退出 |
| Login failure / rate limit | Retry / forgot / alternative auth | `继续使用 Local Mode` |
| Forgot → email → reset → login | P0 → mail/deep link → P1 → P2 → L0 | P0/P1/P3 均可退出 |
| Reset link invalid/expired | P3 → request new link | `继续使用 Local Mode` |
| OAuth happy path | L0/R0 → O0 → O1 → callback → §4H | O0/O1 可 cancel/exit |
| OAuth needs create/link | O1 → O2 → R1/M0 if needed → §4H | O2 可 return/restart/exit |
| OAuth callback after restart | Restore O1/O2/O3 from current result | App local startup continues independently |
| OAuth canceled/expired/provider failure | O3 → retry / another method | `继续使用 Local Mode` |
| Public settings/network unavailable | capability-load error → retry | `继续使用 Local Mode` always enabled |
| Auth succeeds while surface closed | Low-disruption completion + Account entry | Current local task keeps focus |

## 4J. Reusable Component Map

不新增视觉资产；优先复用 doge current component/token language。只有 Auth 领域稳定复用后，才把 feature-local composite 提升到全局 UI primitive。

| Experience element | Reuse / compose | Account-specific contract |
|---|---|---|
| Settings Account shell | `SettingsView` 的 sidebar/content pattern、`ScrollArea` | `Account` 作为独立一级 section；logged-out/auth/logged-in state 不渗入其他 Settings section |
| Contextual Auth modal | `Dialog` / `DialogContent` / `DialogHeader` / `DialogFooter` | Opaque surface、focus trap、return focus；内容与 embedded Auth Container 使用同一 screen state model |
| Primary/secondary/link actions | `Button` variants | Scope-rich labels；pending action 保留动词；Local Mode action始终可达 |
| Text/password/code inputs | `Input` + `Field` / `FieldLabel` / `FieldDescription` / `FieldError` | 正确 `autocomplete`、`inputmode`、`aria-invalid`、error association；password toggle 为 feature-local trailing action |
| Agreement / adoption choices | `Checkbox` | 整行可点击但 label 与 document link 可区分；每项独立 accessible name |
| Provider alternatives | `Button variant="outline"` + feature-local provider list | Provider text label 必须可见；logo 仅辅助；超过 3 项 progressive disclosure |
| Loading / quota | `Progress` 或现有 spinner pattern | Unknown duration 不显示伪百分比；quota progress 与 auth loading 视觉语义分开 |
| Error/recovery banner | `FieldError` + feature-local `AuthErrorSummary` composite | persistent、可聚焦、包含 next action；toast 不能成为唯一载体 |
| Verification / MFA code | feature-local `AccountCodeField` composed from `Input` | 单一 6 位 field；paste/autofill/Enter；避免 6 个孤立输入产生读屏负担 |
| Browser waiting | feature-local status panel + `Button` | Provider、waiting/retry/cancel；永不展示 callback code/state/token |
| Low-disruption auth completion | existing global notice composition pattern | 仅跨 surface completion；去重、可进入 Account；不承载完整 auth form |
| Configuration task recovery | feature-local doge bubble，遵循 §11 | 只恢复当前 config task；不变成 Account nav；主体/独立 `×` hit target 分离 |
| Changed-file list / diff | existing changed-file list + diff presentation patterns | Account-specific safe labels 与 lazy redacted diff；不直接复用 raw Git diff data boundary |

### Component composition constraints

- `AuthContainer` 只消费 presentation state 与 intents，不读取 token2api raw response，也不把 provider-specific branch 散落到每个 button handler。
- Register/Login/Forgot/Reset/MFA/OAuth completion screens 共享 field、action、error、loading primitives，但保留各自明确 screen component，避免一个巨型 conditional form。
- Provider logo 不作为唯一品牌识别；不新建 hero illustration、avatar asset 或营销背景。
- Auth modal 与 Settings embedded mode 必须用同一 state transition/validation contract，不能形成两套行为。

## 4K. Accessibility And Localization QA Matrix

### 4K.1 Keyboard, focus and screen reader

| Scenario | Keyboard / focus expectation | Screen reader / semantic expectation | PASS evidence |
|---|---|---|---|
| Open embedded Account | focus 到 page heading；sidebar current item 可识别 | `Account` heading + logged-out availability summary | Tab order 与视觉顺序一致 |
| Open contextual Auth modal | focus 到 Auth title 或首个 field；关闭后回原 CTA | `role="dialog"`、`aria-modal`、label/description 完整 | Tab 不逃出；Esc ordinary close |
| Login/Register submit with invalid fields | focus 到 error summary，再可跳首个 invalid field | summary `role="alert"`；field error 由 `aria-describedby` 关联 | 不依赖 toast；错误可重复读取 |
| Password visibility | toggle 可 Tab/Space；focus 保持 | 动态 name `显示密码` / `隐藏密码`；状态可感知 | value/cursor 不丢失 |
| Verification/MFA code | 单一 field；paste、Backspace、Enter 可用 | label 含 6 位验证码用途；`autocomplete="one-time-code"` | 无逐格重复朗读 |
| Resend countdown | disabled action不抢 focus；归零后 action恢复 | 不每秒 live announce；只在可 resend 时 polite announce 一次 | 60 秒测试无 announcement storm |
| Loading submit | focus 保持 action或 step；不能重复提交 | action name 变 `正在…`，容器 `aria-busy` | 不只用 spinner |
| OAuth opens browser | focus 可留在 waiting heading；回 App 后恢复 current step | polite announce `已从浏览器返回，正在完成登录` | 不自动跳到无关 control |
| OAuth/MFA nested completion | focus 移到新 step heading或 error summary | Provider / masked account context 可读 | back/cancel action有明确 consequence |
| Auth success | focus 到 success heading；后续 quota/config CTA 顺序自然 | auth、quota、CLI readiness 分成有标题 regions | 不把登录成功播报成配置成功 |
| Close to Local Mode | focus 回原 Account/context CTA 或合理 App landmark | announce 不需要；Local Mode 未改变 | keyboard user 无 focus loss |
| Lazy diff | Enter/Space 展开；loading 后 focus 保持 file row | diff region有 file label；redacted value 语义可读 | 单文件失败不破坏列表导航 |
| Reduced motion | 所有操作与状态仍可见 | 无依赖 motion 的状态语义 | spinner/progress 以静态文本兜底，bubble 不 pulse/bounce |

### 4K.2 i18n and text expansion

| Dimension | Requirement | QA cases |
|---|---|---|
| Baseline locales | 所有用户文案至少设计 zh/en semantic keys；禁止在 component 硬编码 server raw message | zh + en 完整 journey截图/读屏 |
| Long text | 为德语/俄语等预留 30–50% expansion；buttons可换行或纵向堆叠 | 200% text zoom、≤900px、最长 provider/CTA/error copy |
| CJK / Latin input | Email/code/password不因 IME composition 误触 validate/submit | 中文 IME、Latin keyboard、paste OTP |
| Provider names | Provider brand name不翻译，句子结构可本地化 | `使用 GitHub 登录` / `Continue with GitHub` |
| Masked identity | Mask email 的呈现顺序与 bidi 隔离安全；不拼接难读字符串 | LTR email in zh、RTL locale |
| Dates / retry / quota | reset/retry/freshness 使用 locale-aware absolute/relative format | 12/24h、timezone、plural countdown |
| Error mapping | closed reason → allowlisted i18n key；unknown fallback可行动 | wrong credential、rate limit、offline、expired link/provider |
| Legal documents | document title/content locale 可用时跟随 UI；缺失 locale 时明确 fallback | zh/en legal revision 与重新同意 |
| Screen-reader copy | 状态句完整，不用 `成功/失败` 裸词，不依赖 icon | VoiceOver/NVDA 最少各一条 supported platform path |

### 4K.3 Manual authentication QA suites

每个平台至少执行：

1. Register direct success；register + email verification；resend/expired/wrong code；registration disabled。
2. Login success；wrong credential；offline/timeout；TOTP wrong → retry → success；challenge expired。
3. Forgot accepted；mail link → App reset；invalid/expired/used link；reset success → login。
4. 至少一个 enabled OAuth provider：launch/cancel/success；App closed then callback；callback expired；create-vs-link；MFA after link（若 capability 返回）。
5. Auth success 后 quota load success/failure 与四种 adaptive config context。
6. 每条 path 通过 mouse、keyboard-only、screen reader；light/dark、100%/200% text、reduced-motion、offline recovery。

## 5. First Login And Product Activation Journey

| Step | Surface | User understanding | Primary action | Exit / recovery |
|---|---|---|---|---|
| 1. Discover | Account entry 或 relevant context CTA | Local Mode 已可用；登录提供额外便利 | `登录 doge` | 返回 Local Mode |
| 2. Authenticate | doge Auth Container；OAuth 时才往返 system browser | 这是账号注册/登录，不是配置授权 | 完成对应 auth steps | 取消后回到原 surface，不惩罚、不 nag |
| 3. Welcome | Post-login modal | 登录完成；Local Mode 未改变 | 继续查看适配后的配置建议 | ordinary close → task bubble |
| 4. Adaptive offer | 同一 modal | doge 已识别当前 CLI 配置，并说明 preserve / add / switch scope | 根据 configuration context 显示明确 CTA | ordinary close → task bubble；hard dismiss 仅由 bubble `×` |
| 5. Explicit configure | 同一 flow | 此点击才授权当前所述配置动作 | `配置 Codex 使用 doge Token 服务` 等 scope-rich CTA | Applying 时可普通关闭，不可 hard dismiss |
| 6. Applying | Progress state | 正在处理；Local Mode 可继续使用 | 无需持续等待 | 关闭后后台继续；bubble 显示进行中 |
| 7. Terminal result | Result state | 是否可用、是否需要行动、改了哪些文件 | `已知晓` / `重试未完成项` / `继续处理` | ordinary close 保留 unread；`已知晓` 清 unread |
| 8. Ongoing value | Account Center | CLI 连接健康、quota 与 freshness 可查 | 按需查看或处理 | Account Center 是长期入口；bubble 可消失 |

### Activation definition

“登录成功”不等于 product activation。首期 activation 应定义为：

- 用户完成登录；且
- 用户明确选择配置或已有 doge configuration 被验证可用；且
- UI 给出可理解的 verified usable / actionable outcome。

如果用户选择 preserve 健康的手工配置，登录仍可完成，但不计入“一键配置 activation”；这不是失败。

## 6. Adaptive Configuration Offer

> **Recommendation，尚非 Decision**：当已有手工配置且当前可用时，先承认现状并默认 preserve；只有用户明确选择“添加/切换到 doge Token 服务”才继续配置。

| Detected context | Offer headline | Explanation | Primary action | Secondary / default behavior |
|---|---|---|---|---|
| No config | `让 Codex 立即可用` | “Local Mode 不受影响。doge 将为 Codex 添加连接 doge Token 服务所需的配置。” | `一键配置 Codex` | `暂不配置`；ordinary close 后可由 bubble 恢复 |
| Healthy manual config | `你现有的 Codex 配置可以正常使用` | “doge 默认保留当前设置，不会自动替换。若希望使用 doge Token 服务，可主动添加或切换。” | `添加/切换到 doge Token 服务` | `保留现有配置` 为安全默认；确认后关闭 offer，不产生 nag |
| Conflicting / ambiguous config | `发现需要你确认的 Codex 配置` | 先说明现有配置是否仍可用，再描述影响范围；不把冲突等同损坏 | `查看将要更改的内容` 或 `继续配置` | `保留现状`；不允许模糊的一键覆盖 |
| Already doge configured and healthy | `Codex 已连接 doge Token 服务` | 展示 verified availability 与最近检查时间 | `查看用量与额度` | 不再提出配置 offer；无 changed files 时不制造完成仪式 |

### Adaptive offer rules

- Offer 必须先显示当前可用性，再显示 recommendation。
- 所有 mutation CTA 必须包含 target CLI 和目的；禁止只写 `继续`、`确认`、`修复`。
- `保留现有配置` 是有意义的完成路径，不得被弱化为错误或跳过。
- 已有健康手工配置时，默认 focus 不落在 destructive/switch action。
- Conflicting state 必须允许用户先查看影响范围；无法可靠解释 scope 时不展示 mutation CTA。
- Already configured + healthy 应直接导向持续收益，不重复运行 noop configuration。

## 7. Account Center Information Architecture

Account Center 采用克制的 desktop management surface：以 status 和 next-best action 为核心，不做营销 dashboard，不展示未交付能力的 disabled 卡片墙。

### Primary navigation

1. **总览**
2. **用量与额度**
3. **CLI 连接**
4. **账号与套餐**
5. **设备与会话**（Future；能力可用后才显示）

### 7.1 总览

信息顺序：

1. **Availability summary**：`Local Mode 可用` 常驻；doge token service 单独显示 available / attention / unavailable。
2. **Next-best action**：没有待办时不制造 CTA；有待办时只给一个 primary action。
3. **Usage snapshot**：remaining、reset、freshness，链接到完整趋势。
4. **CLI connection summary**：已连接 CLI、健康状态、最近检查。
5. **Account summary**：当前账号与 plan 的轻量摘要。

### 7.2 用量与额度

详见 §9；只展示 doge token service 的 remote usage/quota。

### 7.3 CLI 连接

作为 Config Center 的长期入口，详见 §8。

### 7.4 账号与套餐

- Profile：显示用户可识别的账号信息。
- Subscription：current plan、status、renewal / expiry、included benefits。
- Billing：manage plan、invoice/payment state 与 provider-hosted portal entry。
- Session action：重新登录、退出登录。
- 退出登录前说明：“本地项目、对话与 Local Mode 不受影响”；是否保留已写入的 CLI 配置必须给出明确状态，而不是暗示自动回滚。

### 7.5 设备与会话

详见 §10。首期未交付时整个导航项隐藏，而不是 disabled。

## 8. Config Center / CLI 连接 Information Architecture

首屏必须在五秒内回答：哪个 CLI 可用、连到哪里、是否需要行动、doge 最近做过什么。

### Page hierarchy

1. **Connection health summary**
   - `未配置 / 使用现有配置 / 已连接 doge / 需要处理 / 暂时无法确认`
   - availability 与最近验证时间
   - 单一 next-best action
2. **Connected CLI list**
   - CLI name、current connection label、health、last verified
   - 行级 action：`配置`、`查看`、`重新检查`、`处理问题`
3. **Available recipes**
   - 仅展示已支持且当前环境可用的 recipes
   - 每项说明 outcome，不暴露内部 recipe/version 概念
4. **Latest configuration result**
   - outcome、完成时间、changed-file count、是否仍需行动
   - `查看变更` 打开 result surface
5. **Configuration history**（Future / progressive disclosure）
   - 只呈现用户可理解的 result history；不把 transaction log 当 UI

### CLI row states

| State | Primary label | User action |
|---|---|---|
| Not configured | `尚未配置` | `一键配置` |
| Healthy manual | `使用现有配置 · 可用` | `保留` 为默认；可选择 `切换到 doge` |
| Healthy doge | `已连接 doge · 可用` | `查看用量`；无需配置 CTA |
| Drifted | `配置已变化 · 需要确认` | `查看变化` |
| Unknown / stale | `状态待确认` + timestamp | `重新检查`；不显示绿色 success |
| Unavailable but Local works | `doge 服务暂不可用` | `稍后重试`；同时显示 `Local Mode 可用` |

### Content boundaries

- 普通 UI 使用 friendly file label，不默认暴露 raw absolute path。
- changed-file list 与 lazy diff 属于 result/detail 层，不占 Config Center 首屏。
- Advanced history、diagnostic reason 与 support action 仅在问题态展开。

## 9. Usage, Quota, Subscription And Billing IA

### Two separate usage concepts

| Concept | Definition | Surface | Visual/copy rule |
|---|---|---|---|
| doge token service usage / quota | Account-backed remote service 的已用量、剩余额度、周期与 freshness | Account Center → 用量与额度 | 明确标注 `doge Token 服务`；受 account/outage 影响 |
| Local usage | doge 在本机统计的 CLI/session usage | 既有 local usage surface | 保留现有入口和语义；不与 remote quota 合计或互相替代 |

禁止只用泛称 `Usage` 将两者放在同一总数字、同一 progress bar 或同一 empty state 中。

### 9.1 Usage & quota page

1. **Availability banner**：`Local Mode 可用`；remote service 状态单独呈现。
2. **Quota summary**：remaining 为主指标，used 为辅，显示 reset date/time。
3. **Freshness**：`刚刚更新 / 更新于… / 数据可能已过期 / 暂时无法刷新`。
4. **Trend**：按日与 billing/usage period 查看；默认不把 raw token 数等同账单金额。
5. **Breakdown**：仅提供能帮助用户决策的 model/CLI/category 维度。
6. **Actions**：refresh、manage plan；quota 充足时不显示强促销 CTA。
7. **Local usage link**：清楚标为独立本地统计入口，例如 `查看本地使用统计`。

### 9.2 Subscription

- Current plan、status、included quota/benefits、renewal/expiry。
- Trial、grace、past due、canceled 等状态使用直白 consequence copy。
- Plan 权益仅描述新增 account/token-service/cloud capabilities，不暗示 Local Mode 会失效。
- Upgrade/downgrade/cancel 的确认必须说明生效时间与对 token service 的影响。

### 9.3 Billing

- doge 内只显示非敏感 payment state、invoice summary 与 `管理账单` 入口。
- 支付与 payment authentication 在 provider-hosted surface 完成。
- Checkout 返回 doge 后必须重新确认 subscription state；不能仅凭关闭浏览器显示 success。
- Billing failure 的首句仍是 `Local Mode 不受影响`，随后说明 token service consequence 与下一步。

### 9.4 Notifications

**Recommendation**：threshold/depletion/freshness notices 默认关闭，由用户 opt in；quota exhausted 与 account-backed action 即将失败时可显示一次 actionable notice。

- 每个周期与 issue dedupe，避免 nag loop。
- Notice 必须含当前数据 freshness。
- Notice 点击进入 `用量与额度` 的对应 context；关闭后遵守 cooldown。

## 10. Device, Session And Multi-account Future

### Device & session management

能力可用后提供：

- Current device 明确标记。
- 每个 session 展示 user-recognizable device label、platform、last active、approximate location（仅在可靠且隐私合适时）。
- 行级 action `退出此设备`；全局危险 action `退出其他所有设备`。
- Current device 被撤销或 session expired 时，不丢失 Local Mode，account-backed actions 转为 `需要重新登录`。
- Lost-device flow 优先让用户确认影响范围，再执行 revoke。
- 空态说明“只有当前设备”而不是错误。

### Multi-account future

- Account switcher 只在第二个账号被添加后出现。
- 切换前明确：将切换 Account Center、quota、token service identity 与后续配置建议；本地 workspace/conversation ownership 不变化。
- CLI 当前连接与 active account 不一致时显示可理解的 mismatch warning，不自动重写配置。
- 添加账号、切换账号、重新配置是独立动作；任何一步不复用另一动作的 consent。
- 退出或删除一个账号不得隐藏、迁移或删除 Local Mode data。

### Remote / daemon future

- 每个 host 的连接与配置状态必须可区分；不使用一个全局“已配置”覆盖所有设备。
- 当目标 host 不支持该 convenience capability 时，隐藏/禁用对应 action 并解释可用替代路径；不得制造 remote success 假象。

## 11. Modal, List, Diff And Bubble Interaction Contract

### 11.1 Surface behavior table

| Surface / state | Content | Keyboard & focus | Close behavior | Reopen behavior |
|---|---|---|---|---|
| Offer modal | current availability、adaptive recommendation、scope-rich CTA | 初始 focus 落标题或安全默认 action；Tab confined；Esc ordinary close | 右上 `×`、Esc、普通关闭均保留 task | doge bubble 恢复同一 offer，不自动重弹 |
| Review / conflict modal | 影响范围、changed-file labels、preserve option | 默认 focus 在 non-mutating action；file rows 可 Enter/Space | ordinary close 保留 review state | bubble / Config Center 恢复 |
| Applying modal | 正在配置、可继续使用 Local Mode、无需等待 | status 变化用 polite live region；无虚假进度百分比 | 可 ordinary close/minimize；此时禁止 hard dismiss | bubble 显示进行中，完成后变为 terminal result |
| Success / noop result | verified availability、outcome、changed-file list | 首焦点为 result heading；`已知晓` 是 primary | ordinary close 保留 unread；`已知晓` 清 unread | quiet bubble 可恢复当前 result，直至 hard dismiss/retention 结束 |
| Partial / failure result | Local Mode availability、已完成/未完成、next action | Error summary 可聚焦；重试 scope 可读 | ordinary close 保留 attention unread | bubble 保持 attention badge；恢复原 result |
| Changed-file list | friendly label、file outcome、可展开 affordance | 每行独立 button；Enter/Space load/open；focus indicator 清晰 | 随 modal 保持展开选择；无需阅读才能 `已知晓` | 恢复时保留 result，展开项可不持久化 |
| Lazy diff loading | 单文件 loading skeleton/spinner | `aria-busy`；加载完成后不抢走用户 focus | 关闭不影响 terminal result | 再开时可重新按需获取 |
| Lazy diff loaded | redacted semantic diff、file outcome | diff region 有 accessible name；长内容可滚动 | 可折叠；不改变 result acknowledgement | 重开默认保持列表摘要，避免强迫重读 |
| Lazy diff unavailable | 该文件详情暂不可用，不影响其他文件 | Retry button 可访问 | 不升级为整次配置 failure，除非 outcome 本身失败 | 可按单文件重试 |
| Task bubble | 当前 configuration task 的 offer/progress/result/attention | 主体与独立 `×` 均可 Tab；accessible names 区分 `打开` / `彻底关闭` | 主体点击 reopen；独立 `×` 才 hard dismiss | hard dismiss 后本 task bubble 不再出现；Account Center 仍可访问历史/状态 |

### 11.2 Bubble state table

| Bubble state | Visual semantics | Click body | Independent `×` | Motion |
|---|---|---|---|---|
| Offer unread | doge avatar + neutral dot | 打开 offer | Hard dismiss 本 recipe offer | 首次进入可一次轻量 appear；不持续 bounce |
| Applying | progress ring / compact label | 打开 applying state | 不可用/隐藏 | 可用低频 progress；reduced-motion 为静态 indicator |
| Success unread | success dot / badge | 打开 result | Hard dismiss result bubble | 不 pulse |
| Attention required | warning/error badge | 打开 partial/failure/drift | 仅 terminal result 可 hard dismiss；未落定 applying 不允许 | 不持续闪烁 |
| Quiet acknowledged | 无 unread badge | 可打开最近 result，若 retention 仍在 | Hard dismiss | 静态 |

Bubble 不显示 quota、profile avatar menu 或永久 Account navigation；否则会从“当前任务恢复”膨胀为第二套 IA。

### 11.3 Acknowledgement and persistence semantics

- `ordinary close`：关闭 surface，不改变 unread/attention，不代表用户接受或拒绝配置。
- `已知晓`：仅确认用户已看到当前 terminal result，清除该 result unread；不删除历史、不撤销配置。
- `保留现有配置`：明确完成 adaptive offer，不产生 mutation；该 recommendation 不应再次 nag，除非用户主动进入或状态实质变化。
- `bubble ×`：Hard dismiss 当前 recipe/version 的 offer/result bubble；不退出账号、不关闭 Account Center、不改变 Local Mode。
- 登录状态变化使旧的 pending offer/plan 不再可继续时，reopen 应进入最新可行动状态，而不是恢复失效 CTA。

## 12. End-to-end State Experience Matrix

| State | First message | What user can trust | Primary next step | Proactive behavior |
|---|---|---|---|---|
| Success | `Codex 已连接 doge Token 服务` | 必须是 verified usable，而非仅“文件已写入” | `已知晓` / `查看用量` | terminal result 主动出现一次 |
| Noop | `Codex 已经配置好了` | 没有文件发生变化；当前连接已验证可用 | `已知晓` | 不制造 changed-file list 或重复 offer |
| Partial | `部分配置已完成，仍有项目需要处理` | 清楚区分 completed / not completed；不声称整体可用 | `重试未完成项` | bubble 保持 attention |
| Failure, no change | `配置未完成，你现有的 Local Mode 不受影响` | 明确未改动文件 | `重试` / `保留现状` | bubble 保持 attention，但不反复弹窗 |
| Failure, recovery needed | `配置未完成，部分变更需要处理` | 展示受影响项与当前可用性，不伪装 rollback success | `继续恢复` | 高优先级 attention，直至 terminal resolution |
| Drift | `Codex 配置已变化` | 说明最近确认时间与当前 availability | `查看变化` | 仅 confirmed actionable drift 主动通知 |
| Login expired | `需要重新登录以继续使用 doge Token 服务` | `Local Mode 可正常使用` | `重新登录` | 仅在 account surface/action context 提醒；不全局阻塞 |
| Quota nearing limit | `doge Token 服务额度即将用完` | remaining、reset、freshness 清楚可见 | `查看用量与额度` | 推荐 opt-in + cooldown |
| Quota exhausted | `doge Token 服务额度已用完` | Local Mode 仍可用；remote action consequence 明确 | `查看套餐` 或 `等待重置` | 同一周期一次 actionable notice |
| Account service outage | `暂时无法连接 doge 服务` | stale timestamp 明示；Local Mode 可用 | `稍后重试` | 不反复 toast；Account surface 显示持续状态 |
| Usage stale | `用量数据更新于…，当前可能已变化` | 不显示为 current success；保留最后已知值并标注 | `刷新` | 不因刷新失败清空 last-known data |
| Offline | `当前离线，Local Mode 可正常使用` | Account 数据标注 last updated | 无需行动 / `联网后重试` | 不把离线当账号错误 |

### Universal state rules

- 每个 degraded/error state 的第一屏都先说明 Local Mode 是否受影响。
- 每个 success 必须对应用户可验证的 outcome；“请求成功”“写入完成”不足以命名为配置成功。
- 每个 retry 必须明确 scope，例如 `重试未完成的 1 项`，而不是泛化 `重试全部`。
- Stale 和 unknown 使用中性状态，不复用 healthy green。

## 13. Microcopy And Call-to-action Principles

### Copy order

1. **Local Mode consequence**：受不受影响。
2. **Current availability**：现在能否使用，数据是否新鲜。
3. **Impact scope**：doge 将改哪个 CLI / 哪些配置项。
4. **Next action**：用户下一步做什么。

### CTA rules

- Mutation CTA 使用 `动作 + 对象 + 目的`：`配置 Codex 使用 doge Token 服务`。
- Review CTA 使用 `查看 + 内容`：`查看将要更改的内容`。
- Retry CTA 使用具体 scope：`重试未完成的 1 项`。
- Preserve 是一级合法选择：`保留现有配置`。
- 禁止单独使用 `继续`、`确认`、`修复`、`优化配置`、`立即解锁`。

### Example copy

| Scenario | Recommended copy | Avoid |
|---|---|---|
| Logged out | `Local Mode 可正常使用。登录后可一键配置 doge Token 服务并查看额度。` | `登录以继续使用 doge` |
| Healthy manual config | `你现有的 Codex 配置可以正常使用，doge 不会自动替换。` | `检测到旧配置，建议修复` |
| Mutation CTA | `配置 Codex 使用 doge Token 服务` | `一键修复` |
| Applying | `正在配置 Codex。你可以关闭此窗口，Local Mode 不受影响。` | `请勿关闭` |
| Success | `Codex 已连接 doge Token 服务。更新了 2 个配置文件。` | `操作成功` |
| Noop | `Codex 已经配置好了，没有文件需要更改。` | `配置成功（0 files）` |
| Partial | `已完成 1 项，另有 1 项需要处理。` | `大部分成功` |
| Expired | `需要重新登录以继续使用 doge Token 服务。Local Mode 可正常使用。` | `会话失效，功能不可用` |
| Stale quota | `上次更新：昨天 18:40。当前剩余额度可能已变化。` | 在旧数据旁只显示绿色 `正常` |
| Quota exhausted | `doge Token 服务额度已用完；Local Mode 仍可正常使用。` | `doge 已不可用` |

### i18n and accessibility copy constraints

- 标题短，description 允许两行；CTA 不依赖 icon 或颜色传意。
- 为德语等长文本保留约 30–50% expansion；窄屏 action 可纵向堆叠。
- Dynamic status 使用完整可读句，不用仅 `Success / Error`。
- Screen reader announcement 只播报 meaningful transition；progress polling 不重复朗读。

## 14. Upstream-isolated UI Seams And Addon-off Behavior

### Minimal doge-owned UI seams

| Seam | Account behavior | Isolation requirement |
|---|---|---|
| Settings navigation | 增加独立 `Account` entry 与 Account Center | 不重写现有 Settings sections 的 local semantics |
| Relevant token-service context | 未连接时提供 lightweight CTA | 只在用户主动进入相关 context 时投影，不给原 local flow 加 login gate |
| App-level surface host | 承载 post-login offer、applying、result | 独立生命周期；关闭不改变原 workspace/composer state |
| App-edge task bubble host | 恢复当前 configuration task | 不承担永久 Account navigation，不占用原 local controls |
| Read-only local fact projection | 用于判断已有 config/CLI 状态并生成 adaptive copy | 只读；Account 不取得 local data ownership |

### Addon-off / unavailable equivalence matrix

| Condition | User-observable behavior |
|---|---|
| Account addon / feature flag off | Account entry、context CTA、modal、bubble、badge 全部消失；不留下空槽 |
| Logged out | Local Mode 与 ccgui baseline 完整可用；只有用户主动访问时看到登录收益 |
| Account module unavailable | 原 local navigation、Workspace、Composer、Provider 与 usage UX 不等待、不降级 |
| Account service outage | Account surfaces 显示 degraded；Local surfaces 不出现 remote error 分支 |
| Quota exhausted / subscription inactive | 只限制新增 token-service/account-backed benefit；Local Mode 不受影响 |
| User logs out | Account surface 回到 logged-out；local workspace、conversation、settings 仍可见可用 |

### Product acceptance

当 addon off 时，用户不应通过 layout、copy、loading、disabled control 或 timing 感知到 Account module 曾参与原 ccgui local flow。

## 15. Engagement And Benefit Metrics

指标用于验证用户收益，不以强迫登录或提高弹窗点击率为目标。正式阈值应在 baseline 后确定，本 Blueprint 不虚构 target。

| Metric id | Definition | Product question | Guardrail / segmentation |
|---|---|---|---|
| `account_entry_to_login_start` | 主动访问 Account 后开始登录的比例 | 价值说明是否清楚 | 按 canonical/context entry 分开；不以更多曝光抬高分母/分子 |
| `account_login_completion` | login start 中完成 interactive login 的比例 | 登录 journey 是否顺畅 | 取消不计错误；按 network state 分层 |
| `account_registration_completion` | register start 中完成账号创建（含必要 verification）的比例 | 注册 journey 是否清楚且无死路 | direct / email verification / OAuth create 分层 |
| `account_verification_completion` | verification code 已发送后成功完成验证的比例 | code input/resend/recovery 是否有效 | wrong/expired/resend/session-expired 分层 |
| `account_password_recovery_completion` | reset request accepted 后最终 reset success 的比例 | email link 与 App recovery 是否连续 | 不以邮箱是否存在为维度；按 expired/deep-link/platform 分层 |
| `account_mfa_completion` | MFA challenge 中成功验证的比例 | MFA screen 是否可完成 | canceled、invalid、expired、network 分层 |
| `account_oauth_return_completion` | system browser launch 后回到 App 并完成 login/create/link 的比例 | browser round trip 是否可靠 | provider/platform/create/link/MFA 分层 |
| `account_activation_rate` | eligible logged-in users 中完成 explicit config 且 verified usable，或已有 doge config verified usable 的比例 | 是否真正获得首个核心收益 | preserve healthy manual config 单独报告，不标失败 |
| `time_to_first_usable` | 从用户点击 mutation CTA 到 UI 首次给出 verified usable 的时间 | 一键配置是否兑现“立即可用” | 分 no config/manual/conflict/already configured；排除用户主动暂停 |
| `config_terminal_success_rate` | consented configuration attempts 中 verified success/noop 的比例 | 配置可靠性如何 | success 与 noop 分列；partial 不计 success |
| `config_manual_preservation_rate` | healthy manual config 场景中未发生非预期 overwrite 的比例 | adaptive preserve 是否可信 | 目标应为 100%；任何 violation 为 blocking incident |
| `config_result_comprehension` | 用户能正确回答“是否可用、改了什么、下一步是什么”的测试/调查比例 | result IA 是否可理解 | 以 usability study / in-product lightweight research 为主，不用 diff click 代替理解 |
| `usage_comprehension` | 用户能区分 remote quota 与 local usage，并正确识别 remaining/reset/freshness 的比例 | 用量 IA 是否避免混淆 | 按 persona 与 locale 分层 |
| `quota_stale_misread_rate` | stale/unknown 数据被用户误认为 current 的比例 | freshness 是否诚实 | 应持续接近零；通过 research/support evidence 评估 |
| `recovery_success_rate` | partial/failure/drift 用户进入恢复后最终达到 verified usable 或明确 preserve 的比例 | 恢复路径是否有效 | 分 retry、preserve、support escalation |
| `time_to_recovery` | actionable issue 首次展示到 terminal resolution 的时间 | 用户能否迅速恢复 | 排除用户未主动访问的 dormant period并单独报告 |
| `nag_reopen_rate` | 用户 hard dismiss/保留后同一 issue 被非预期再次主动展示的比例 | 是否存在 nag loop | 目标为零；recipe/version 或实质状态变化需单独标记 |
| `local_mode_regression_rate` | Account state 导致既有 Local Mode action 不可用/变慢/被 gate 的事件率 | additive promise 是否成立 | 任何 confirmed regression 为 release blocker |

### Qualitative evidence

- 新手能否在无指导下完成首次可用。
- 进阶用户是否信任 preserve 行为与 changed-file disclosure。
- 弱网用户是否理解 remote degraded 与 Local Mode 可用的并存状态。
- 额度敏感用户是否能在十秒内解释 remaining、reset 与 freshness。

## 15A. Frozen Delivery Strategy — Contract-first, Mock-first, Parallel, Late Integration

> **Confirmed development strategy**：本节是当前交付顺序的冻结约束。它不改变用户体验目标，但决定如何在 backend 未就绪时持续完成和评审完整 UI，同时避免 mock 与真实 API 漂移。

### 15A.1 Core rules

1. **Contract-first**：先冻结 versioned Account interaction contract，包含 intents、presentation states、closed outcomes、capability flags、freshness 与 recovery semantics；UI、Doge Native Broker、token2api 均依赖该 contract。
2. **Mock-first UI**：用户评审前的 Frontend Experience 不真实调用 token2api 或 doge backend，不以 backend availability 决定 screen 是否能设计、演示或修正。
3. **Stable port**：UI 只能调用稳定 `AccountGateway` / `AccountService` port。Mock/Real adapter 可替换，但 screen component 与 button handler 不得知道 adapter 类型或直接构造 API response。
4. **Stateful deterministic scenarios**：Mock 是可复现的 scenario engine，按显式 scenario id、初始 state 与 action sequence 推进；同一输入得到同一输出，不使用随机错误或“所有请求都成功”的薄 mock。
5. **Parallel backend**：Doge Native Broker 与 token2api API/gaps 在 UI 评审期间按同一 contract 独立开发与 contract test；两者不等待 UI polish，UI 也不等待真实服务可用。
6. **Late integration**：只有多轮 UI 评审确认、各 backend lane 达标、contract conformance 通过后，才把 Mock adapter 替换为 Real adapter并开始 integration/e2e。
7. **No drift by convenience**：integration 中发现 contract gap 时，先形成 versioned contract change并让三 lane 同步；不得在 Real adapter 中偷偷改变 UI semantics，也不得把 raw backend behavior泄漏进 component。

### 15A.2 Stable Frontend port boundary

Blueprint 不冻结代码签名，但冻结职责：

| Port responsibility | UI may consume | UI must not consume |
|---|---|---|
| Capability discovery | register/reset/OAuth/provider/agreement/verification availability 的 presentation capability | raw `/settings/public` payload、backend feature-field naming |
| Auth intents | start/cancel/resume register/login/verification/reset/MFA/OAuth | URL 拼装、callback parameters、token/session fields |
| Presentation state | 当前 screen、field/form/step error、loading、masked identity、safe retry/freshness | raw HTTP status/body、secret、provider code/state/internal ID |
| Recovery | resend/retry/restart/change-email/open-browser/resume-link 等 typed actions | handler 内临时 fetch、直接 `window.location` auth flow logic |
| Post-auth | account summary、quota snapshot、CLI readiness、adaptive offer context | token2api user DTO、config raw plan/diff |

Button handler 只发 domain intent，例如 `submitLogin(form)`、`resendVerification()`、`launchOAuth(provider)`、`retryAuthCompletion()`；不得在 handler 中写“如果 mock 则成功”“延迟后切 screen”或 provider-specific response mapping。

### 15A.3 Deterministic stateful Mock scenario engine

Mock adapter 必须支持 scenario reset、time control、action log 与 state inspection，供 UI review、component tests 与 story/demo 使用。Latency 用 virtual/controlled clock 表达；offline、恢复联网、link expiry、MFA retry 等必须跨多个 action 保持 state。

| Scenario id | Stateful sequence | Required UI evidence |
|---|---|---|
| `auth.register.direct-happy` | R0 submit → R2 → §4H quota/config | direct success 与 handoff |
| `auth.register.verify-happy` | R0 → send pending → R1 → wrong code → resend cooldown → valid code → R2 | error修正、倒计时、恢复与成功 |
| `auth.register.session-expired` | R1 reopen → pending missing/expired | restart register / login / Local Mode 无死路 |
| `auth.register.disabled` | capability loaded disabled | 无 disabled form；login/Local Mode alternatives |
| `auth.login.happy` | L0 → §4H | success handoff |
| `auth.login.wrong-then-success` | wrong credentials → corrected submit → success | persistent form error + recovery |
| `auth.login.latency-timeout-reconcile` | submit → prolonged pending → timeout/unknown → retry/reconcile → success | 无假成功、无重复 action |
| `auth.offline-recover` | capability or submit offline → Local Mode path → network restored → retry | availability copy 与原 draft恢复 |
| `auth.mfa.retry-happy` | L0 → M0 wrong/expired code → current code success | focus/error/challenge continuity |
| `auth.mfa.challenge-expired` | M0 wait/submit → expired | return L0 / Local Mode |
| `auth.password.link-happy` | P0 accepted → simulate email link → P1 → P2 → L0 | deep-link restore 与 email prefill |
| `auth.password.link-expired` | simulate expired/used link → P3 → P0 | request-new-link recovery |
| `auth.oauth.happy` | O0 launch → O1 background/return → §4H | system-browser waiting/return |
| `auth.oauth.cancel-expire-offline` | O1 canceled or callback expired/exchange offline → O3 → retry/restart | 每种 terminal recovery无死路 |
| `auth.oauth.create-link-mfa` | O1 → choose create/link → profile adoption/invitation/verification or bind password → M0 → success | OAuth complex branch完整性 |
| `auth.post-success.quota-error` | auth success → quota error + known/unknown CLI context | auth success不被 quota 失败推翻；config action守真 |
| `config.adaptive.four-contexts` | no config / healthy manual / conflict / already doge | preserve-first 四种 offer |
| `config.result.matrix` | applying close → success/noop/partial/failure/drift → bubble reopen/ack/hard dismiss | §11/§12 state contract |

**Mock acceptance**：每个 scenario 的 action order、state transition、safe presentation payload、latency/clock advancement与 terminal outcome 可断言；scenario engine 不读取真实账号、网络、filesystem 或 token2api 环境。

### 15A.4 Three parallel lanes

| Lane | Ownership / deliverable | Independent progress | Exit evidence |
|---|---|---|---|
| **Frontend Experience** | Auth Container、Account Center、form/state components、AccountGateway port、Mock adapter/scenario engine、visual/manual/a11y/i18n review | 全程只接 Mock adapter；可完成所有 happy/error/recovery screens与用户多轮评审 | Scenario coverage、component interaction tests、visual evidence、用户 UX approval |
| **Doge Native Broker** | Real adapter 对接的 doge-native account/session/browser/deep-link/quota/config presentation contract | 按 frozen contract 实现，不要求 frontend 接真实 backend；使用 broker contract tests/harness | Contract tests、platform browser/deep-link matrix、closed outcome mapping、Local Mode isolation |
| **token2api API / gaps** | register/login/verification/reset/MFA/OAuth/profile/quota 等既有 API capability校准与必要 gaps | 不等待 UI refinement；保持 deployment/upstream governance，输出 versioned contract fixtures | API contract tests、capability negotiation fixtures、auth branch/error/freshness outcomes |

Lane 之间只通过 frozen contract、fixtures 与 conformance results协作；不得共享 UI-local mock state、raw server DTO 或临时 implementation shortcut。

### 15A.5 Freeze, integration and acceptance gates

```text
G0 Product Interaction Freeze
  → G1 Versioned Contract Freeze
     → Frontend Experience || Doge Native Broker || token2api API/gaps
        → G2 UI Review Freeze + G3 Backend Lane Readiness
           → G4 Contract Conformance
              → G5 Real Adapter Swap / Late Integration
                 → G6 Integration + E2E + Platform Acceptance
```

| Gate | PASS | Blocking failure |
|---|---|---|
| G0 — Product Interaction Freeze | 本 Blueprint 的 screens、states、copy hierarchy、Local Mode exits、post-auth handoff 获产品确认 | 关键 journey/open decision 未定，UI 仍会结构性变化 |
| G1 — Contract Freeze | Version id、intents、capabilities、presentation outcomes、error/recovery/freshness semantics 与 fixtures冻结 | UI 依赖 raw API 或三个 lane 各自定义同名不同义状态 |
| G2 — UI Review Freeze | Mock 覆盖完整 scenario matrix；用户多轮评审确认 interaction/visual/a11y/i18n | UI 只演示 happy path；仍有死路或 mock handler shortcut |
| G3 — Backend Lane Readiness | Doge broker 与 token2api 各自 contract tests通过；无需等待 UI polish | 任何 lane 只能靠真实 UI 手测证明 contract |
| G4 — Contract Conformance | Mock adapter、Real adapter、broker、token2api fixtures 对同一 contract version 的 required cases给出等价 semantic outcomes | 字段可编译但行为分支、retryability、freshness、terminal truth漂移 |
| G5 — Late Integration | Real adapter 替换 Mock 不改 screen components/domain intents；Mock仍保留给 tests/review | 为接真实 API 在 button/component 中新增 raw branching |
| G6 — Acceptance | integration/e2e、auth browser/deep-link、config、quota、outage、addon-off、三平台/a11y矩阵通过 | backend success 与用户可用性不一致；Local Mode regression；Mock-only scenario未被真实路径覆盖 |

### 15A.6 Contract conformance matrix

Conformance 不只比字段 schema，还必须逐 case 比较：

- Capability on/off 与 provider availability。
- Screen transition 和 pending/resume/cancel semantics。
- Closed error level、retryability、safe next action 与 Local Mode consequence。
- Latency、timeout、duplicate submit 与 reconciliation outcome。
- Email verification resend/countdown/session expiry。
- Reset link valid/expired/consumed/deep-link restore。
- MFA required/invalid/challenge expired/success。
- OAuth canceled/expired/create/link/MFA/browser return/restart。
- Post-auth quota freshness/error 与 adaptive config context。
- Config terminal success/noop/partial/failure/drift、ack/bubble/dismiss。

任何 semantic mismatch 都先阻塞 G5；不得以“真实 API 比 mock 复杂”为由把复杂度直接传给 UI。

## 16. Rollout UX Stages

每个 stage 都必须保留完整 Master Plan 导航逻辑，但未交付能力不显示 disabled placeholder。

| Stage | User-visible value | Surfaces | UX exit gate |
|---|---|---|---|
| U0 — Baseline / contract protection | Local Mode 行为不变；interaction 与 versioned contract冻结 | 无 Account UI 或 internal-only mock harness | addon off 与 ccgui baseline 用户可观察等价；G0/G1 通过 |
| U1 — Mock-first Account foundation | 可选注册/验证/登录/找回重置/MFA/OAuth、profile、明确 Local Mode promise | Settings → Account、Auth Container、system-browser simulations | Frontend 仅接 Mock adapter；完整 auth scenario/a11y/i18n 用户评审通过 G2；无真实 backend call |
| U2 — Product activation | Adaptive offer、一个真实 CLI recipe、result/list/lazy diff/bubble | Post-login modal、CLI 连接、task bubble | no/manual/conflict/already configured 四路径通过；verified usable truth；无 overwrite/nag |
| U3 — Ongoing confidence | Configuration health、drift/recovery、remote usage/quota/freshness | 总览、用量与额度、CLI 连接 | local vs remote comprehension、stale handling、recovery evidence 通过 |
| U4 — Commercial management | Subscription、billing、plan transitions | 账号与套餐 | 套餐后果清楚；payment return 不假成功；Local Mode 不受 entitlement 影响 |
| U5 — Account operations | Device/session 与 multi-account | 设备与会话、account switcher | current device、revoke、switch scope 与 local ownership comprehension 通过 |
| U6 — Multi-host convenience | Remote/daemon/web | host-scoped connection surfaces | 不同 host 状态不混淆；unsupported host 不假成功 |

### Stage-wide experience gates

- 每个 stage 都验证 logged-out、offline、outage、expired 与 addon-off。
- 新 surface 必须覆盖 loading、empty、success、noop、partial、failure、stale、focus 与 reduced-motion。
- U1/U2 的 UI review 全程使用 deterministic stateful Mock adapter；Frontend Experience 不等待 backend，也不调用真实服务。
- Doge Native Broker 与 token2api API/gaps 从 G1 后独立并行；各自 G3 通过前不进入 Real adapter integration。
- G4 contract conformance 与用户 G2 UI approval 均通过后，才执行 G5 Mock → Real adapter swap；swap 不得改变 screen component/domain intent。
- 未验证平台或能力不进入普通用户可见 action。
- Rollback 后应回到前一 stage 的完整、可理解体验，而不是残留 disabled UI。

## 17. Open Product Decisions

只保留会显著改变用户体验、discoverability 或默认控制权的选择；工程实现细节不在此列表。

1. **Adaptive offer default**

   **Recommendation**：已有健康手工配置时默认 preserve，并明确承认“当前可用”；只有用户选择 `添加/切换到 doge Token 服务` 才继续。

   待确认点：是否接受 preserve-first 作为正式 product default。若不接受，将显著增加 activation，但也显著提高覆盖配置和信任风险。

2. **Account entry strategy**

   **Recommendation**：`Settings → Account` canonical entry + 仅在相关 token-service context 出现 lightweight CTA。

   待确认点：采用 dual entry，还是 Settings-only。Settings-only 更安静，但会降低新手发现率与 context-to-value 连贯性。

3. **First configuration recipe**

   当前建议 Codex；待确认 Codex 还是 Claude。该选择决定首期主要 persona、context CTA、文案、成功标准与 configuration evidence，不只是工程顺序。

4. **Usage notice default**

   **Recommendation**：threshold/depletion/freshness reminders 由用户 opt in；quota exhausted 且用户正在使用 account-backed action 时可显示一次必要提示。

   待确认点：是否首期只提供主动查看，还是同时提供 opt-in reminders。

以下不是当前 Open Product Decision：具体 plan price、billing provider、device 命名策略、multi-account 上限与 remote rollout date。它们应在相应 stage 进入产品范围时再决策，避免过早冻结。

## 18. Engineering Quality Gates — Index Only

本 Blueprint 默认依赖但不展开以下内部质量门：credential 不进入不可信 UI surface；登录、配置与文件改动是独立授权；配置必须 plan-first、可验证、可恢复；diff 与 diagnostics 不暴露 secret；stale/session/platform 状态 fail closed；addon-off 与 Local Mode equivalence 必须有自动化和人工证据。详细 contract 继续由 `research/synthesis.md`、后续 architecture artifacts、security/data/platform reviews 与 OpenSpec artifacts 维护，不应回流为用户主交互负担。

## 19. Product Experience Acceptance Matrix

| Journey | PASS | FAIL |
|---|---|---|
| Logged out | 用户明确理解 Local Mode 完整可用与登录收益 | 文案暗示登录是继续使用 doge 的条件 |
| Register | enabled fields/policies正确呈现；direct 或 verification path 均可完成；registered email有 login/recovery出口 | disabled form、提交后无状态、邮箱已存在却无登录/找回路径 |
| Email verification | 6 位 code、resend/cooldown/change email/session expiry均有明确恢复 | code过期/丢 pending state 后只剩空表单或关闭 |
| First login | 登录后只出现一次 adaptive offer；未自动改配置 | 登录完成即写配置或重复弹出 offer |
| Login failure/MFA | wrong credential、rate limit、offline与 MFA invalid/expired均可 retry/cancel，成功才进入 handoff | MFA未完成却显示已登录；错误只以 toast 出现 |
| Forgot/reset | request response不泄露账号是否存在；deep link、expired/used link、reset success均有下一步 | 邮件链接只能在 Web 完成、无效链接无新链接入口、reset后自动登录 |
| OAuth | enabled + Desktop-compatible provider可在 system browser完成；cancel/expired/create/link/MFA/restart有无死路 recovery | 暴露 callback数据、静默合并身份、callback失败停在 spinner |
| Auth success handoff | 登录/注册成功后额度与 CLI readiness 独立加载；adaptive offer仍需显式配置 consent | quota失败推翻登录；登录即配置；unknown CLI state仍显示 mutation CTA |
| No config | 一个 scope 清楚的 CTA 后得到 verified usable result | 只显示“写入成功”，未证明 CLI 可用 |
| Healthy manual config | 默认 preserve，用户可明确选择 add/switch | 将现有配置称为错误并默认覆盖 |
| Conflicting config | 先说明 availability/impact，允许保留现状 | 模糊 `一键修复` 覆盖未知配置 |
| Already doge configured | 展示健康与持续收益，不重复配置 | 运行无意义 noop flow 或继续 nag |
| Result disclosure | 摘要 → changed files → lazy redacted diff | 默认灌入 raw diff / absolute path / secret-bearing detail |
| Ordinary close | 任务可由 bubble 恢复，不自动重弹 | close 被解释为 consent、acknowledge 或 hard dismiss |
| Bubble | 只恢复当前配置任务；主体与 `×` 可区分 | bubble 成为永久 Account navigation 或产生误触 hard dismiss |
| Usage | remote quota 与 local usage 明确分离，freshness 可见 | 两者合并为一个数字，或 stale 数据显示 healthy current |
| Partial/failure/drift | Local Mode consequence、影响范围与 next action 清楚 | 用 success 颜色/文案掩盖未验证或未完成状态 |
| Expired/outage/quota exhausted | 只影响 Account Convenience，Local Mode 可继续 | 全局 gate、阻塞 local action 或持续 nag |
| Addon off | 用户可观察行为等价 ccgui local baseline | 遗留入口、空槽、loading、disabled control 或 account branch |
| Accessibility | keyboard/focus/screen reader/reduced-motion 路径可执行 | 只靠 hover、颜色或持续动画传递关键状态 |
| Mock-first frontend | UI 只调用 AccountGateway/AccountService port；deterministic stateful scenarios覆盖 happy/error/recovery/latency/offline/auth links | mock分散在 handler、随机故障、所有调用默认成功或 UI 真实请求 backend |
| Parallel lanes | Frontend、Doge Native Broker、token2api API/gaps 可按同一 contract 独立推进并各自测试 | UI refinement 阻塞 backend，或 backend availability绑架 UI设计 |
| Late integration | G2/G3/G4 通过后才替换 Real adapter；screen/domain intent不变 | integration前无 conformance、Real adapter向 UI 泄漏 raw API branch |

## 20. Evidence Still Needed Before Final Design Freeze

- 用可点击 prototype / usability test 验证 adaptive offer 四种 context 是否被正确理解，尤其是 `保留现有配置` 与 `添加/切换` 的差别。
- 验证用户是否能区分 Account remote quota 与现有 local usage，并正确解释 freshness。
- 校准 bubble 的保留时长、quiet acknowledged state 与 hard dismiss discoverability，确保既可恢复又不形成 nag。
- 在 zh/en 之外选择至少一个长文本 locale 验证 Account Center、result actions 与 narrow layout。
- 使用 keyboard、screen reader 与 reduced-motion 完成 offer → apply → result → lazy diff → acknowledge → bubble reopen 的完整人工 QA。
- 用 Mock scenario engine 完成 register/verification/login/MFA/forgot-reset/OAuth 全 journey 的多轮用户评审，并记录每个 scenario 的 usability findings。
- 在至少一个 supported Desktop platform验证 email reset link与 OAuth system-browser return：App前台、后台、未运行、attempt expired 四种恢复。
- 冻结 AccountGateway versioned contract与 fixtures后，由 Mock adapter、Doge Native Broker、token2api API/gaps分别提供 conformance evidence；未通过不得 late integrate。
- Implementation 完成后必须 review actual UI evidence，而不是仅以 Blueprint 或设计稿作为完成证明。
