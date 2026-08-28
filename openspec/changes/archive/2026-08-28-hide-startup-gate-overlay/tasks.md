## 1. Regression Contract

- [x] 1.1 在 `src/router.test.tsx` 增加可见 sentinel mock，并断言 default-off 时 main window 不 mount `StartupGateOverlay`。**Input:** delta spec + existing Router test；**Output:** focused regression；**Verify:** `npm exec vitest -- run src/router.test.tsx --maxWorkers 1 --minWorkers 1`（改动前按预期失败）；**Pri:** P0；**Dep:** none

## 2. Router Composition

- [x] 2.1 从 `src/router.tsx` 移除 `StartupGateOverlay` 的 unconditional mount，同时保留 overlay component、compatibility export、i18n 与 tests。**Input:** task 1.1；**Output:** default-off main window 直接展示 `AppShell`；**Verify:** Router focused test 6/6 passed + `rg` 确认组件、compatibility export 与 tests 保留；**Pri:** P0；**Dep:** 1.1

## 3. Verification

- [x] 3.1 执行 Router 与 Overlay focused Vitest，证明 global mount 已隐藏且保留组件行为未回归。**Input:** tasks 1.x–2.x；**Output:** 2 files / 15 tests passed；**Verify:** `npm exec vitest -- run src/router.test.tsx src/features/app/components/StartupGateOverlay.test.tsx --maxWorkers 1 --minWorkers 1`（retained Overlay suite 仍输出既有 `act(...)` warning，目标 Router suite clean）；**Pri:** P0；**Dep:** 2.1
- [x] 3.2 执行 frontend quality gates 与 OpenSpec strict validation。**Input:** complete diff；**Output:** typecheck、target ESLint、diff check、large-file report 与 change validation passed；**Verify:** `npm run typecheck`、`npm exec eslint -- src/router.tsx src/router.test.tsx`、`git diff --check`、`npm run check:large-files`、`openspec validate hide-startup-gate-overlay --type change --strict --no-interactive`；完整 `npm run lint` 另检出 2 个 untouched baseline errors（`AgentInspectorDrawer.tsx`、`personaAssign.ts`），本 change target clean；**Pri:** P0；**Dep:** 3.1

## 4. Local Test Toggle

- [x] 4.1 校准 proposal、design 与 delta spec，明确 default-off、local opt-in、next-start-only 和 detached-window isolation contract。**Input:** 用户新增需求；**Output:** revised OpenSpec artifacts；**Verify:** `openspec validate hide-startup-gate-overlay --type change --strict --no-interactive`；**Pri:** P0；**Dep:** 3.2
- [x] 4.2 新增 feature-local localStorage helper，安全读取/写入 startup loading test flag；仅精确值 `"1"` 开启，storage failure 回退关闭。**Input:** D2；**Output:** minimal persistence boundary；**Verify:** settings focused test 覆盖默认值与 on/off persistence；**Pri:** P0；**Dep:** 4.1
- [x] 4.3 在 `OtherSection` 底部增加 controlled Switch，补齐 zh/en i18n，并明确“默认关闭、下次启动生效”。**Input:** D3 + settings UI guide；**Output:** 用户可自助控制 test mode；**Verify:** `OtherSection.test.tsx` 6/6 passed；**Pri:** P0；**Dep:** 4.2
- [x] 4.4 `AppRouter` 在 mount 时 capture flag snapshot，仅为 main window conditional mount overlay；补齐 default-off、opt-in、current-mount stability 与 detached isolation regression。**Input:** D1/D4；**Output:** 可恢复的 startup loading；**Verify:** `src/router.test.tsx` 9/9 passed；**Pri:** P0；**Dep:** 4.2

## 5. Final Verification

- [x] 5.1 执行 focused Vitest、typecheck、target ESLint、diff check、large-file report 与 OpenSpec strict validation，并确认 retained overlay code/tests 仍存在。**Input:** tasks 4.2–4.4；**Output:** 3 files / 24 tests passed，typecheck、target ESLint、diff check、large-file report 与 strict validation passed；完整 `npm run lint` 仅保留 2 个 untouched baseline errors（`AgentInspectorDrawer.tsx`、`personaAssign.ts`）；**Verify:** change-local commands；**Pri:** P0；**Dep:** 4.3, 4.4

## 6. Submission Gate Repair

- [x] 6.1 将 `handleRevertRepositoryFiles` ownership 从 `composerContext` 移到真实 owner `workspaceNavigationContext`，不改 production context wiring。**Input:** full-suite drift failure + D6；**Output:** ownership catalog 与 `rawAppShellDomainContexts` 对齐；**Verify:** `appShellDomainContexts.test.ts` 18/18 passed；**Pri:** P0；**Dep:** 5.1
- [x] 6.2 将 `Sidebar.test.tsx` 两处旧 `codex-tui/default-config` selector 校准为 `本地配置`，并补齐 test i18n mock；不改 production UI。**Input:** full-suite drift failure + D7；**Output:** Sidebar regression 与当前 provider display contract 对齐；**Verify:** `Sidebar.test.tsx` 59/59 passed；**Pri:** P0；**Dep:** 6.1
- [x] 6.3 执行 Sidebar、AppShell ownership 与 startup toggle focused tests，并运行 typecheck、target ESLint、diff check 与 OpenSpec strict validation。用户明确要求不再重跑 full suite。**Input:** tasks 6.1–6.2；**Output:** 5 files / 101 tests passed，typecheck、target ESLint、diff check 与 strict validation passed；**Verify:** targeted project gates；**Pri:** P0；**Dep:** 6.2
