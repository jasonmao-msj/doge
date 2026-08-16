## Why

doge 当前完整支持无需账号的 ccgui 本地能力，但不会手工配置的用户，以及希望便捷接入 doge token service 的用户，仍缺少一条 App 内自助路径。token2api 已具备注册、认证、账号维护、quota/usage 与 subscription 等 domain capability；doge 应成为这些能力的完整 Desktop 交互端，同时继续把 token2api 作为唯一 identity/account authority。

本 change 将已完成的 research/brainstorm 收敛为正式产品输入：账号能力是可选的 doge 增值层，永不成为 Local Mode 的 gate；首个可本地安装试用的 release 交付完整 account access、主动 quota/usage view 与 Codex 一键配置，并采用 Contract-first + Mock-first UI + Parallel backend + Late integration 降低体验与真实 API 漂移风险。

## 目标与边界

- 永久保留完整 **Local Mode（本地模式）**：未登录、退出、session 失效、OS vault 不可用、token2api outage、quota 耗尽或 account feature 关闭，均不得影响既有本地能力。
- doge App 提供 token2api 完整账号交互：public capability discovery、注册、条件式邮箱验证、email/password 登录、MFA、启用 provider 的 OAuth、忘记/重置密码、durable session restore、退出，以及 current API 已存在且首包 journey 必需的 profile/security/session maintenance。
- token2api 继续作为 identity、credential policy、MFA、OAuth binding、quota/subscription 与 billing 的 remote source of truth；doge 复用 current API，只对 desktop-safe completion 或已证明的 durability/security 缺口定义最小 gap。
- **Settings → Account** 是唯一固定、持久的 Account Center 入口；token service/configuration contexts 可以提供进入同一 journey 的轻量入口。
- 首期 quota/usage 只在用户主动查看或明确刷新时呈现，不发送 proactive notices，不把 remote quota 与 Local Mode/local usage 混为一谈。
- 首个一键配置 recipe 为 **Codex**；登录成功只展示 offer，必须再次 explicit consent 才能执行配置 plan/apply。
- 首个本地打包试用 release 必须通过 Real adapter integration/e2e 与目标平台 install/launch smoke；Mock-only 评审产物不视为可试用版本。
- Comprehensive Master Plan 继续覆盖 billing、subscription commerce、device/session management、multi-account、更多 recipes、remote/daemon/web、security/privacy、observability/support、migration/rollout/rollback；这些 P5+ 能力不进入首包 blocking scope。

## 非目标

- 不引入强制登录、entitlement gate、grace period 或联网前置条件，不把未登录用户描述为受限 guest。
- 不在 doge 建立第二套 user/password/MFA/OAuth/quota/billing backend，不复制 token2api handler 或 server-side business rule。
- 首包不交付 billing/order、完整 subscription commerce、device/session management UI、multi-account、remote/daemon/web、非 Codex recipes 或 proactive quota/usage notices。
- 不要求首包同时对 macOS、Windows、Linux 全平台 GA；未验证平台或未完成 desktop-safe prerequisite 的单项 capability 必须 fail closed。
- 本 proposal 不决定视觉样式，不包含 implementation code，不修改 token2api，也不替代后续 `design.md`、`tasks.md` 与 versioned contract。

## What Changes

- 新增独立 doge account convenience feature slice，以 Account Center 承载创建账号、进入账号、恢复账号、必要账号维护、主动查看服务状态与退出账号；关闭 feature flags 后等价于上游 local behavior。
- 用 token2api `GET /api/v1/settings/public` 和 typed responses 驱动注册、email verification、OAuth、TOTP 等 capability；current API 未启用或前置条件不满足时，不展示可执行假入口。
- 将 current auth/profile/session/quota/usage API 通过 doge-owned adapter 复用；OAuth Desktop completion、password-reset App link handoff、durable refresh/revoke、API-key lifecycle 等已识别 gap 在对应能力进入 Real integration 前完成最小 contract closure。
- 固定 Settings → Account 为唯一持久入口，并在 token service/configuration contexts 提供轻量 CTA/deep link；所有入口复用相同 route/state/gateway。
- 首期 Account Center 提供 pull-only quota/usage overview、freshness 与 stale/unavailable 状态；明确 remote token service usage 与 Local Mode/local usage 的边界。
- 以 Codex 作为 first recipe：post-login offer 与配置 consent 分离，先计算 plan，展示 changed-file list 与按需 redacted diff，再事务化 apply 并提供 result/recovery、acknowledge close、bubble reopen、permanent dismiss。
- 冻结三 lane delivery：Frontend Experience 使用 deterministic stateful Mock adapter；Doge Native Broker 与 token2api API/gaps 按同一 versioned contract 并行；contract conformance 后才替换 Real adapter 并进入 integration/e2e。

## 方案对比

| 选项 | 描述 | 取舍 |
|---|---|---|
| **A. 完整 App client + Native Broker + token2api authority（推荐）** | UI 只依赖稳定 gateway；Rust broker 承担 Desktop credential/session/config authority；token2api 保持账号事实源 | 能兑现 App 内完整 journey、Local Mode 隔离和上游低耦合；需要明确 Desktop completion gaps 与三 lane contract |
| B. 账号操作主要跳转 token2api Web | doge 只做登录入口或外链，Web 完成注册、恢复和维护 | 实现较小，但破坏 App 内完整自助、跨上下文恢复与一键配置连续性，不满足冻结产品目标 |
| C. doge 新建专用 account backend/BFF authority | doge 复制或包办 user/session/quota domain | 可自定义 API，但形成双事实源、额外运维和长期 drift，破坏 current API reuse 与低耦合要求 |

选择 A。交付方式同时选择 Contract-first + Mock-first UI + Parallel backend + Late integration；不采用 backend-first 串行方式，因为它会把 UI 评审绑定到远端可用性，也不采用 UI 直连临时 route，因为它会让 Mock/Real contract 漂移。

## Capabilities

### New Capabilities

- `token2api-account-convenience`: 规定 Local Mode invariant、完整 token2api account journey、Account Center 入口、pull-only quota/usage、Codex one-click configuration、上游隔离以及 contract-first/mock-first/parallel/late-integration release gates。

### Modified Capabilities

- （无）现有 main specs 尚无 doge account convenience capability；本 change 不修改既有 Local Mode 行为，只增加独立可选增值层。

## Impact

- **doge Frontend**：新增独立 account routes/state/storage/i18n boundary、Settings → Account、contextual entry、Account Center journeys、Mock scenario review environment 与 Codex configuration experience。
- **doge Native**：后续需要 OS vault、session manager、fixed-origin token2api client、Desktop callback/link handoff、account metadata、configuration plan/apply/recovery 与 credential-free frontend projection。
- **token2api**：优先原样复用 current routes；只有 desktop-safe completion、durable session/revoke 或 API-key security prerequisite 等已证明 gap 才进入最小 backend change，且不改变其 identity authority。
- **Contracts/tests**：新增 versioned `AccountGateway` / `AccountService` behavior contract、shared scenarios/fixtures、Mock/Real conformance、Local Mode/upstream equivalence、integration/e2e 与目标平台 package smoke gates。
- **Rollout/operations**：账号 capability 受独立 feature flags 控制并可整体回退；远端故障只降级 account-backed/token-service capability，不影响 Local Mode。

## Rollout

1. **F0 — Product/spec freeze**：本 proposal 与 behavior spec delta 冻结产品结果；影响首包的 Open Questions 为零。
2. **F1 — Contract/experience freeze**：完成 design/tasks 与 versioned gateway/DTO/state/error/scenario/fixture contract；Frontend Experience 在零真实 network/native calls 的 Mock environment 中接受多轮用户 review。
3. **Parallel lanes**：Frontend Experience、Doge Native Broker、token2api API/gaps 独立推进；backend readiness 不绑架 UI refinement，UI refinement 不阻塞 backend conformance。
4. **C0/I0 — Conformance and replacement**：Mock adapter、Doge Real adapter、token2api compatibility/gap implementation 对同一 contract/fixtures 全绿后，只在 composition root 替换 adapter。
5. **I1/A0 — Integration and local trial**：完成真实 account/config integration/e2e、Local Mode regression、目标平台 package install/launch smoke 与用户体验验收，交付本地打包试用。
6. **P5+**：billing、device/session、multi-account、remote/daemon/web、更多 recipes 与 proactive experiences 按独立 proposal/release cut 推进，不反向阻塞首包或 Local Mode。

回滚时关闭 account convenience feature flags 并移除其固定/contextual entry，保留用户本地配置与完整 Local Mode；不得因远端或 account metadata 清理而改写既有 local data。

## 验收标准

1. 未登录、vault unavailable、token2api outage、quota exhausted、logout/session expiry 与 account feature flags off 均通过 Local Mode/upstream-equivalence regression。
2. 首包在 current server capability 允许时完成 register/email verification、login/MFA/OAuth、forgot/reset、durable restore/logout 与必要 account maintenance 的 Real E2E；真实 gap 未关闭时不得宣称对应 capability 完成。
3. Settings → Account 是唯一固定入口；contextual entries 进入同一 journey，关闭功能后无残留 local-flow branch。
4. quota/usage 只由主动查看/刷新触发，正确呈现 freshness/stale/unavailable，且无 proactive notices。
5. Codex one-click configuration 完成独立 consent、plan、changed-file list、lazy redacted diff、事务化 apply、result/recovery 与关闭/气泡状态机；登录本身不写文件。
6. Mock UI 无真实 token2api/Tauri 调用，deterministic stateful scenarios 覆盖 happy/error/recovery/latency/offline/MFA/OAuth/email link/expired token；Real replacement 前 contract conformance 全绿。
7. 目标平台 Real adapter integration/e2e、package install/launch smoke 与用户试用验收通过；P5+ 尚未交付不构成首包失败。
