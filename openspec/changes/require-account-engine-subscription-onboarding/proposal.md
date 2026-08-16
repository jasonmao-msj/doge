## Why

Doge 当前把账号作为 Settings 内的可选增强能力，用户仍需理解 API Key、配置文件和不同 Provider 的关系；这与面向小白用户的“登录后直接使用”目标冲突。现在需要把账号、引擎权益、订阅购买和 managed credential/configuration 收敛为一个 App 启动闭环，让用户只做业务选择，不接触凭据与配置概念。

## 目标与边界

- Doge Desktop 打开后必须先形成可恢复的 token2api 登录态，未登录时不挂载主 AppShell，也不启动受账号管理的 engine runtime。
- 首次登录或主动切换时只展示 Doge 已完成 managed access 的引擎；首期为 `codex` 与 `claude-code`，后续由 versioned engine catalog 扩展。
- 选定引擎后先读取 authoritative entitlement：有效订阅直接进入自动准备；无有效订阅只展示 token2api 当前对该引擎 `for_sale=true`、用户可购买的 subscription plans。
- Doge 不提供 balance recharge、pay-as-you-go、按量付费或其二级入口；套餐为空时显示无套餐状态，不能降级到余额充值。
- 购买成功后 token2api 按 `user + device + engine` 幂等创建/恢复 managed API key，由 Doge Native Broker 接收 one-time secret、写入 OS vault 并完成 engine 配置；renderer 永远不接收 raw secret。
- 首次成功后记住最近使用的引擎；后续启动在登录态、订阅和本机 managed binding 都有效时自动恢复，用户只在切换或失效恢复时再次选择。

## 非目标

- 不在 Doge 复制 token2api 的账号、套餐、订单、支付或 subscription authority。
- 不展示或允许手动选择、复制、粘贴、编辑 API Key；现有 advanced/manual provider 能力的长期去留另开 change。
- 不实现余额充值、按量付费、混合计费、优惠券中心、发票中心或复杂套餐对比营销页。
- 不把支付凭据放进 Doge；支付仍在 provider/system browser trust surface 完成。
- 不让 network、payment、vault 或 managed engine failure 进入半可用 AppShell；失败必须停留在可恢复的 account gate。

## What Changes

- **BREAKING**：废止 `integrate-token2api-account-system` 中“Local Mode 始终可用、账号仅是可选 convenience layer”的产品要求；该 change 的 Native vault/session/config foundation 作为实现依赖保留，但旧行为 delta 不再同步为 main spec。
- 新增 App-level account gate：`login/register/recovery → engine selection → entitlement → subscription checkout → preparing → AppShell`。
- 新增 subscription-only engine plan catalog；Doge 只投影 token2api authenticated API 返回的当前可售套餐，不维护本地套餐、价格或排序事实源。
- 新增 Desktop subscription checkout projection 与 bounded native order reconciliation；支付终态通过 wakeup + authoritative read 驱动 UI，不在 React root 建立秒级 polling。
- 新增 managed engine access contract：subscription verified 后幂等确保 engine-scoped API key、one-time native handoff、OS vault binding、Codex/Claude Code provider configuration 与启动恢复。
- Settings Account 继续作为登录后的固定账号管理入口；启动门禁不复用 Settings 巨型状态，也不把 account state 写入 `AppSettings`。
- 原型确认的 minimal UI 成为验收基线：每屏一个主决策，说明进入自适应 `?` tooltip，产品 UI 不出现 API Key、文件 diff、技术错误码或 scenario selector。

## Capabilities

### New Capabilities

- `account-engine-subscription-onboarding`: mandatory account gate、engine selection、subscription-only plan/checkout journey、managed engine credential/configuration、restore/switch/recovery 与 privacy/failure contract。

### Modified Capabilities

- `client-startup-orchestration`: AppShell 和 managed runtime 的挂载顺序改为由 account/engine readiness gate 控制，并保持低频、事件驱动的 startup projection。

## 技术方案比较

### 方案 A：Doge renderer 直接调用 token2api 并写 engine config

- 优点：文件少、原型落地快。
- 缺点：password/access/API key 会进入 WebView；支付/订单 polling 污染 React root；跨平台 vault、幂等和配置恢复无法成立。
- 结论：拒绝。它不能满足 secret isolation、crash recovery 与小白“无感配置”的真实安全边界。

### 方案 B：Doge Native Account Broker + token2api Desktop contract（采用）

- React 只消费 credential-free state；Rust 持有 access/refresh、OS vault、订单 reconciliation、managed key handoff 和 engine config transaction。
- token2api 继续拥有 plan/order/subscription/key authority，并补充 Desktop engine catalog、managed access 与 typed receipt。
- 优点：职责清晰、可恢复、可跨平台验证，UI 能保持原型信息架构；缺点是跨仓库 contract 与测试面更大。

### 方案 C：只跳转 token-matrix.com 完成套餐与 Key 配置

- 优点：token2api 改动少。
- 缺点：用户仍需理解网站、API Key 与回到 App 后的配置，无法达到“登录后选引擎即可用”。
- 结论：只保留 system browser 支付 trust surface，不把 managed configuration 推回网站。

## 验收标准

- 冷启动未登录时只出现 account gate；AppShell、workspace 内容和 managed engine runtime 不可见、不可启动。
- 登录后选择 Codex 或 Claude Code；已有有效订阅在一次 authoritative check 后自动准备并进入 App。
- 无权益时只展示 token2api 当前对该引擎返回的 `for_sale=true` plans；名称、价格、周期、额度和排序完全来自 server response，本地无硬编码商业数据。
- UI 与 source scan 均不存在 balance recharge、pay-as-you-go、按量付费及相关 fallback。
- 支付在 system browser 完成；Doge 自动获得 terminal order/subscription 状态，不要求“我已支付”产品按钮，React 无秒级 polling。
- 支付成功或已有权益时，managed access ensure 同一 `user/device/engine` 并发与重试只创建一个 active binding；raw key 只在 token2api → Rust → OS vault 路径存在。
- Codex 与 Claude Code 各完成一条真实配置/启动 E2E；用户不选择 API Key、不查看文件 diff、不确认技术配置。
- vault unavailable、套餐为空、支付取消/超时、subscription 失效、managed access 失败、config 失败均停在可恢复 gate，不能进入假就绪 AppShell。
- 最近引擎可恢复；主动切换重新检查权益并隔离 credential/config binding，不跨账号或跨引擎复用。
- doge focused Vitest、Rust account tests、token2api Go tests、跨仓库 contract fixtures、真实 Desktop E2E、macOS package smoke 与 Windows CI package 全部通过。

## Impact

- doge frontend：`src/bootstrapApp.tsx`、router/AppShell composition、`src/features/account/**`、engine selection/provider projection、i18n 与主题样式。
- doge native：`src-tauri/src/account/**`、`AppState`、command/event registry、OS vault、payment reconciliation、Codex/Claude provider configuration。
- token2api：Desktop authority descriptor、authenticated plan projection、subscription checkout/status receipt、protected managed engine access service/handler/routes 与 idempotency/security tests。
- Release：macOS/Windows 都需要验证 OS credential vault、system-browser checkout、恢复与正式签名边界；无法取得正式签名身份时只能交付明确标注的内部测试包，不能误称正式发行版。
