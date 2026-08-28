# Proposal: fix-create-session-engine-routing

## Why

新建会话存在「选中引擎 ≠ 实际执行引擎」问题：多条创建路径把用户当前选中的 engine 丢弃或降级，导致 UI 显示与实际执行不一致。

已定位五个根因：

- **R1（prompt → new agent）**：`useAppShellPromptActionsSection` 调 `startThreadForWorkspace` 不传 `engine`，thread 落 hook 内默认引擎。
- **R1（intent canvas attach）**：`useAppShellLayoutNodesSection.handleAttachIntentCanvasToThread` 同样不传 `engine`。
- **R2（kanban composer）**：`useAppShellKanbanComposerSection` 用 `activeEngine === "codex" ? "codex" : "claude"` 硬二分，kimi / gemini / opencode 全部落 claude。
- **R3（create-session-target 竞态）**：`Composer.handleSend` 在 `createSessionTargetPicker` 开启但 target 未 resolved 时静默跳过 target 构建，用 live `activeEngine` 兜底发送，无任何用户反馈。
- **R4（/clear /new）**：`useQueuedSend.runSlashCommand` 用全局 `activeEngine` 建新 thread，不保留当前 thread 的 engine 与 provider binding。
- **R5（queue drain）**：`QueuedMessage` 不携带 engine，drain 时 `useThreadMessaging` 重读 live `activeEngine`，排队期间用户切换引擎会污染已排队消息。

## 目标与边界

- 目标：新建会话的执行引擎 = 创建瞬间的选中引擎；queue drain 使用 enqueue 时冻结的引擎；target 未就绪时显式拦截并提示。
- 边界：仅修「新建会话 / queue 发送」链路，不动既有 thread 续发路径的既有行为（thread 续发引擎推断维持现状）。

## What Changes

- **F6**: Existing-thread Composer must use the current thread's resolved engine, not global `activeEngine`; Home creation remains global-selection scoped.

- **F1**：`useAppShellPromptActionsSection` 与 `useAppShellLayoutNodesSection` 调 `startThreadForWorkspace` 时传 `engine: normalizeEngineForExecution(activeEngine)`。
- **F2**：`useAppShellKanbanComposerSection` 以 `normalizeEngineForExecution(activeEngine, "claude")` 替换 codex/claude 二分。
- **F3**：`Composer.handleSend` 在 `createSessionTargetPicker` 开启且 `effectiveCreationTarget` 未 resolved 时 `pushErrorToast` 并 `return`；新增 `chat.createSessionTargetNotReadyTitle` / `chat.createSessionTargetNotReady` 两个 i18n key（en + zh）。
- **F4**：`useQueuedSend.runSlashCommand` 的 `/clear`、`/new` 通过 `getThreadEngine` / `getThreadProviderProfileId` 保留当前 thread 的 engine 与 providerProfileId；`useComposerController` 与 `app-shell` 透传两个 resolver。
- **F5**：`QueuedMessage` 新增 `engine?: EngineType`；enqueue 时冻结 `activeEngine`（非 shared 分支）；`MessageSendOptions` 新增 `engineOverride?: EngineType`；`dispatchQueuedMessage` 把冻结引擎注入发送 options；`useThreadMessaging` 的 `currentEngine` 优先级改为 `createSessionTarget?.engine ?? options?.engineOverride ?? activeEngine`。

## 非目标

- 不改既有 thread 续发消息的引擎推断逻辑（thread 续发维持现状行为）。
- 不重构 `EngineType` 与 `ExecutableEngineType` 的类型关系。
- 不改 shared session 的 `sharedExecutionTarget` 冻结机制。
- 不引入新的引擎能力探测或 UI。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- 新建会话引擎路由：prompt → new agent、intent canvas attach、kanban composer、/clear、/new、queue drain 均以创建瞬间的选中/冻结引擎为准。

## Impact

- 受影响代码：
  - `src/app-shell-parts/useAppShellPromptActionsSection.ts`
  - `src/app-shell-parts/useAppShellLayoutNodesSection.tsx`
  - `src/app-shell-parts/useAppShellKanbanComposerSection.ts`
  - `src/app-shell.tsx`
  - `src/features/composer/components/Composer.tsx`
  - `src/features/threads/hooks/useQueuedSend.ts`
  - `src/features/threads/hooks/useThreadMessaging.ts`
  - `src/features/app/hooks/useComposerController.ts`
  - `src/types/conversation.ts`
  - `src/i18n/locales/en/chat.ts`、`src/i18n/locales/zh/chat.ts`
- 受影响系统：新建会话执行链路、queue 发送链路；不影响 storage schema 与既有 thread 数据。
- 风险：F4 在 resolver 缺失时回落 `activeEngine`，行为与现状一致；F5 对旧 queue 数据（无 `engine` 字段）行为不变。

## 验收标准

- prompt → new agent、intent canvas attach、kanban composer（含 kimi 等非 codex/claude 引擎）新建 thread 的 `startThreadForWorkspace` 均收到创建瞬间的选中引擎。
- `createSessionTargetPicker` 开启且 target 未 resolved 时发送被拦截并弹出错误提示，不发送。
- 在 engine=A 的 thread 执行 /clear 或 /new，新 thread 引擎为 A，providerProfileId 随之保留。
- enqueue 后切换引擎，drain 时消息仍按 enqueue 时的引擎发送。
