## 1. Contract 与任务基线

- [x] 1.1 [P0] 固化 token2api Desktop engine/plan/checkout/managed-access schema、stable reasons 与跨仓库 fixtures；运行 `openspec validate require-account-engine-subscription-onboarding --type change --strict --no-interactive`
- [x] 1.2 [P0] 初始化 full-stack Trellis context，记录旧 `integrate-token2api-account-system` 行为被本 change supersede 的边界

## 2. token2api authority

- [x] 2.1 [P0] 新增 Desktop engine catalog 与 authenticated plan projection；仅返回当前 engine 下 `for_sale=true`、active subscription groups，并用 handler/service tests 验证动态上下架
- [x] 2.2 [P0] 新增 subscription-only checkout create/status projection、payment method filtering、Idempotency-Key 与 paid-after-fulfillment semantics；验证无 balance fallback
- [x] 2.3 [P0] 在 protected `api_keys` uniqueness 上实现 user/device/engine/group deterministic binding，确保 device 原文不持久化且并发只产生一个 credential
- [x] 2.4 [P0] 实现 subscription-gated managed access ensure/handoff，确保 raw secret 不进 logs/ledger/generic DTO，并覆盖 concurrency/replay/account isolation tests
- [x] 2.5 [P0] 更新 authority descriptor 与 route/wire registration，执行 focused Go tests、migration tests、security source scan 与 API contract tests

## 3. Doge cross-layer contract

- [x] 3.1 [P0] 扩展 TypeScript contract/validator/gateway，加入 engine catalog、plans、checkout、managed readiness snapshot 与 stable reason mapping
- [x] 3.2 [P0] 扩展 Rust authority/runtime/SQLite checkout checkpoint/IPC，使用 bounded pre-AppShell reconciliation，确保 renderer projection credential-free
- [x] 3.3 [P0] 增加 engine-scoped OS vault scope、operation outcome truth 与 restart recovery，覆盖 vault unavailable、lost response、account/engine isolation tests

## 4. Engine managed configuration

- [x] 4.1 [P0] 将 Codex recipe 收敛为 entitlement 后自动 prepare，并保留 journal、semantic verifier 与 launch-time secret injection
- [x] 4.2 [P0] 新增 Claude Code managed provider sentinel、vault launch injection 与 configuration verifier，按 Engine/Provider/Model/Session identity matrix 复核
- [x] 4.3 [P0] 实现最近 engine restore 与显式 switch，确保不同账号/engine 不复用 credential 或 provider binding

## 5. Mandatory account UI

- [x] 5.1 [P0] 在 main router 增加 process-lifetime `AccountAppGate`，ready 前不挂载 AppShell，detached routes fail closed
- [x] 5.2 [P0] 按已批准 prototype 实现 login/register、两引擎选择、server plans、渐进支付方式、等待支付、preparing 与 recovery states
- [x] 5.3 [P0] 清理产品主链中的 API Key、配置 diff、Local Mode、balance/pay-as-you-go 文案；保留 Settings 账号管理与切换入口
- [x] 5.5 [P0] 复用 token2api forgot-password API，实现 App 发起、固定 HTTPS Web completion、回到登录的无 reset-token 暴露闭环
- [ ] 5.4 [P1] 完成 light/dark、macOS/Windows density、keyboard/focus/screen reader、自适应 help tooltip 与 Doge app icon 目视回归

## 6. 端到端验证与发布

- [x] 6.1 [P0] 执行 Doge focused Vitest、`npm run typecheck`、lint 与 Rust account/full tests；执行 token2api focused/full Go gates
- [ ] 6.2 [P0] 在可控 authority 环境验证 login、existing subscription、dynamic public plans、payment terminal、managed ensure、Codex launch 与 Claude Code launch
- [x] 6.3 [P0] 运行 cross-layer/check/finish-work，更新 `.trellis/spec/**`、engine foundation ADR 最近校准与 OpenSpec evidence
- [x] 6.4 [P0] 构建并 smoke macOS arm64/x64 与 Windows x64 release artifacts；记录签名/notarization 状态、checksums 与安装启动证据
- [ ] 6.5 [P0] 严格验证并同步/归档 OpenSpec change，提交两个仓库变更并执行 Trellis session record
- [x] 6.6 [P0] 修复 signed-in cold restore 对 masked `primaryEmailLabel` 的 SafeLabel 误判；增加 exact IPC bootstrap regression test，并用本地 macOS release package 验证恢复登录后进入 engine catalog
- [x] 6.7 [P0] 为 recovered checkout 增加“返回套餐”与“退出登录”闭环；实现 account/device/checkout-scoped local checkpoint abandon、focused cross-layer tests 与本地 macOS package smoke
- [x] 6.8 [P0] 将“退出登录”提升为所有 authenticated pre-AppShell blocking states 的固定逃生口；覆盖无订阅套餐、空套餐、加载/异常/支付/准备状态，补齐失败回归并重新生成 macOS 本地包
- [x] 6.9 [P0] 修复 logout 与 `sessionChanged` bootstrap 的 generation race；用 deferred event regression 证明 stale request 释放 loading，并生成 macOS arm64 / Windows x64 本地试用包
- [x] 6.10 [P0] 删除每日古诗轮换、dismiss persistence、专用样式与 tests；保留 composer 通用 header composition
- [x] 6.11 [P0] 将主路径 user-facing engine label/Settings 入口统一为简洁引擎命名与“引擎管理”，并把新建 QR checkout 标题改为 `Doge + 当前选中的 server plan name`；恢复旧 checkout 无本地套餐上下文时安全回退通用标题
- [x] 6.12 [P0] 将 external engine probe 改为 4 秒 non-interactive、timeout 后 process-tree cleanup；接入 Tauri single-instance 并唤醒已有 main window
- [ ] 6.13 [P0] focused frontend/Rust tests、typecheck、OpenSpec strict validate 与 macOS arm64 本地包已完成；Windows x64 本地入口已验证被 host gate 拒绝，等待真实 Windows host（本轮按用户要求不使用 GitHub CI）
- [ ] 6.14 [HOLD] 在 token2api 将 managed API Key display name 收敛为 `Doge + engine + plan`；本轮仅保留独立 worktree，不 commit、push 或 deploy，等待后续单独发布窗口
- [x] 6.15 [P0] 将 Account Center 收敛为“我的引擎”，让 main engine picker 以 target intent 直达对应 entitlement/plans；App 内 flow 保持 AppShell mounted，并提供 cancel 原路返回
- [x] 6.16 [P0] 覆盖 Codex ready → Claude subscription → paid → prepare/activate → Claude 新会话的 focused regression，完成本地 gates 与 macOS arm64 体验包
- [x] 6.17 [P0] 修复 subscription quota 数据源，按已订阅 engine 展示日/周/月窗口与最近一年 GitHub-style heatmap；hover/focus 按需读取单日 model breakdown，完成 cross-layer focused tests 与本地 gates
- [x] 6.18 [P0] 修复 heatmap 空 cell 透明、month label 重复、默认未定位最近日期与 system-locale 混排；删除“少/多”图例，完成 focused tests 并生成 macOS arm64 本地体验包
- [x] 6.19 [P0] 按确认稿收敛 Account Center Header、icon-only refresh/logout、安全页与多订阅 master/detail；一行最多 3 张 card，补齐 selection/refresh/tooltip/responsive focused tests 与本地 gates
- [x] 6.20 [P0] 收敛 macOS cold restore 的 Keychain access budget：bootstrap 只评估一次 vault status、refresh credential 只读取一次并复用 rollback snapshot；补齐计数 vault regression 与本地 Rust gates
