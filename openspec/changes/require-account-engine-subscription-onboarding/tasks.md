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
