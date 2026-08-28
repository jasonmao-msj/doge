# Verification: fix-workspace-session-startup-hydration

## Verification Level

L3：改动命中 startup orchestration、异步 hydration、并发调度和 Sidebar session visibility；虽然没有 backend/Tauri payload 或持久化 schema 变化，但 startup/concurrency 按项目风险策略需要提升验证等级。影响面限定在 frontend hook、Sidebar consumer 与其 focused tests 及 runtime contract。

## Automated Evidence

| Command | Result |
| --- | --- |
| `npm exec vitest run src/app-shell-parts/useWorkspaceThreadListHydration.test.tsx src/features/workspaces/hooks/useWorkspaceRestore.test.tsx src/features/threads/hooks/useThreads.sidebar-cache.test.tsx src/features/app/components/Sidebar.test.tsx src/features/startup-orchestration --reporter=dot` | 10 files / 112 tests passed |
| `npm run typecheck` | passed |
| `npx eslint src/app-shell-parts/useWorkspaceThreadListHydration.ts src/app-shell-parts/useWorkspaceThreadListHydration.test.tsx` | passed |
| `npm run check:app-shell:runtime-contract` | passed |
| `openspec validate fix-workspace-session-startup-hydration --strict --no-interactive` | passed |
| `git diff --check` | passed |

## Manual QA Waiver

真实 Tauri packaged/desktop 双 workspace 冷启动尚未由用户执行；当前只启动了 Vite dev server，地址为 `http://localhost:1420/`。用户已明确要求“归档 推送 pr”，因此保留该 manual task 为 unchecked waiver，不将自动化结果表述为平台实机验收。剩余风险是 native runtime 的实际扫描时序与不同平台窗口焦点行为未覆盖。
