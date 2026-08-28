# Proposal: hide-startup-gate-overlay

## Why

主窗口原先会在冷启动时无条件挂载全屏 `StartupGateOverlay`，最长阻断交互 20 秒。产品日常使用不再需要该展示面，但仍需要在本机复现冷启动时手动恢复它，因此 overlay 应默认隐藏，并提供明确的测试开关。

## 目标与边界

- 主窗口默认直接展示 `AppShell`，不挂载 `StartupGateOverlay`。
- 在“其他设置”底部提供默认关闭的测试开关；开启后从下次主窗口启动起恢复 overlay。
- startup orchestration、`startup-gate-ready`、first-paint hydration 与后台任务继续按现有 contract 运行。
- 保留 `StartupGateOverlay.tsx`、兼容 re-export、i18n 文案和组件单测。
- 用 focused regression tests 锁定 default-off、explicit opt-in 与 detached-window 隔离行为。

## 非目标

- 不删除或重构 `StartupGateOverlay` 内部诊断、force-enter、timer 与自动关闭逻辑。
- 不修改 startup task 调度、cold-start hydration、`uiScale` startup guard 或 platform 判定。
- 不扩展 Rust / `AppSettings` schema，不引入 backend persistence 或新依赖。
- 不让开关在当前窗口即时挂载 overlay，也不为切换动作自动 reload。
- 不改变 detached window routing。

## What Changes

- **BREAKING（产品交互）**：默认初始化期间主窗口立即可见、可点击，不再通过全屏 overlay 阻止用户输入。
- 增加 localStorage-backed test flag；仅精确值 `"1"` 代表开启，缺失或异常值都回退到关闭。
- `AppRouter` 在挂载时 capture flag snapshot，并只在 main window 条件挂载 `StartupGateOverlay`。
- “其他设置”底部增加 Switch，文案明确“默认关闭、下次启动生效”。
- 组件实现与原单测保持不变。

## 技术方案对比

1. **本机 test flag + Router boot snapshot（采用）**：满足可自助复测，默认路径没有 overlay；无需跨 Rust / `AppSettings` 扩散 contract。
2. **持久化到 `AppSettings`**：可跨 WebView 统一管理，但会增加 TypeScript/Rust schema、加载时序与 migration 成本，超出本机测试需求。
3. **即时挂载或切换后 reload**：反馈更直接，但用户可能在设置页操作时突然被全屏阻断或丢失草稿；采用 next-start-only 语义更安全。

## 验收标准

- flag 缺失或关闭时，main window 渲染 `AppShell` 且不存在 startup gate mount。
- flag 在启动前开启时，main window 同时挂载保留的 `StartupGateOverlay`。
- 设置页开关位于“其他设置”底部，默认关闭，切换结果持久化且当前窗口不即时挂载 overlay。
- `src/features/app/components/StartupGateOverlay.tsx` 与其测试文件仍存在。
- detached window routing 不变，且即使 flag 开启也不挂载 overlay。
- focused Router / OtherSection / StartupGateOverlay tests、TypeScript typecheck 与 target ESLint 通过。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `client-startup-orchestration`: 主窗口 startup presentation 默认不挂载全屏交互门控，但允许通过本机测试开关在下次启动显式恢复；后台 orchestration contract 保持不变。

## Impact

- Code: `src/router.tsx`、`src/router.test.tsx`、`src/features/startup-orchestration/utils/startupGateOverlayTestFlag.ts`、`src/features/settings/components/settings-view/sections/OtherSection.tsx` 及其测试
- Retained code: `src/features/app/components/StartupGateOverlay.tsx`、`src/features/app/components/StartupGateOverlay.test.tsx`
- i18n: `src/i18n/locales/zh/settings.ts`、`src/i18n/locales/en/settings.ts`
- API / dependency: 无变化；persistence 新增一个 localStorage boolean flag，默认缺失即关闭
- Product risk: 默认路径中冷启动重活尚未完成时，用户可以立即点击底层界面；测试模式则复用 overlay 既有 10 秒 force-enter 与 20 秒 absolute ceiling，避免永久锁死。
- Submission gate repair: 提交门禁发现两处既有 contract drift：`handleRevertRepositoryFiles` ownership catalog 与真实 context 不一致，以及 Sidebar 测试仍使用旧本地配置显示名。前者只同步 metadata，后者只校准 test i18n mock 与 selector；均不改变 runtime data flow 或生产 UI。
