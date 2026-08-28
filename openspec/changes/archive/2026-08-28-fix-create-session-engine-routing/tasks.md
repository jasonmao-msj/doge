# Tasks: fix-create-session-engine-routing

## 1. 修复实现

- [x] 1.1 [P0] F1：`useAppShellPromptActionsSection` options 加 `activeEngine?: EngineType | null`，`startThreadForWorkspace` options type 加 `engine?: EngineType`，`handleSendPromptToNewAgent` 传 `engine: normalizeEngineForExecution(activeEngine)`；`app-shell.tsx` 调用处传 `activeEngine`。
- [x] 1.2 [P0] F1：`useAppShellLayoutNodesSection.handleAttachIntentCanvasToThread` 传 `engine: normalizeEngineForExecution(activeEngine)`，deps 补 `activeEngine`，import `normalizeEngineForExecution`。
- [x] 1.3 [P0] F2：`useAppShellKanbanComposerSection` 以 `normalizeEngineForExecution(activeEngine, "claude")` 替换 `activeEngine === "codex" ? "codex" : "claude"` 二分。
- [x] 1.4 [P0] F3：`Composer.handleSend` 加 target 未 resolved 守卫（`pushErrorToast` + `return`）；`src/i18n/locales/en/chat.ts`、`src/i18n/locales/zh/chat.ts` 加 `createSessionTargetNotReadyTitle` / `createSessionTargetNotReady`。
- [x] 1.5 [P0] F4：`useQueuedSend` options 加 `getThreadEngine` / `getThreadProviderProfileId` resolver 与 `startThreadForWorkspace` options 的 `providerProfileId`；`/clear`、`/new` 保留当前 thread engine + binding；`useComposerController`、`app-shell` 透传。
- [x] 1.6 [P0] F5：`QueuedMessage` 加 `engine?: EngineType`；`buildQueuedMessage` 非 shared 分支冻结 `activeEngine`；`MessageSendOptions` 加 `engineOverride?: EngineType`；`dispatchQueuedMessage` 注入冻结引擎；`useThreadMessaging` 的 `currentEngine` 改为 `createSessionTarget?.engine ?? options?.engineOverride ?? activeEngine`。

## 2. 测试

- [x] 2.1 [P0] 回归跑 `useQueuedSend.test.tsx` 现有断言（F4 后 `/clear` `/new` 默认行为应不变），新增保留 thread engine + binding 的 case。
- [x] 2.2 [P0] `useAppShellKanbanComposerSection.test.tsx` 新增 kimi / grok 引擎透传 case。
- [x] 2.3 [P0] 新建 `useAppShellPromptActionsSection.test.tsx`（renderHook，断言 engine 透传）。
- [x] 2.4 [P0] Composer target 未 resolved 守卫测试（复用 `Composer.file-reference-token.test.tsx` 的 harness 模式，断言 onSend 未调用且 `pushErrorToast` 被调用）。
- [x] 2.5 [P1] `useThreadMessaging.test.tsx` 新增 `engineOverride` 优先级 case。

## 3. 验证

- [x] 3.1 [P0] L2 定向验证：`npx vitest run` 跑受影响测试文件清单（useQueuedSend / useThreadMessaging / useAppShellKanbanComposerSection / useComposerController / engineSessionRouting / useWorkspaceActions + 新增文件）。
- [x] 3.2 [P0] typecheck 全量。
- [x] 3.3 [P0] ESLint 仅跑改动文件。
