# 文档1：Claude 引擎对话幕布渲染链路（实时 + 历史）

> **文档性质**：**历史分支快照**（过程溯源），不是 0.7.x 现网说明。
> **采样基线**：分支 `codex/2026-03-23-v0.3.3`（`b7e82ac`）
> **现网请改读**：[`analysis/conversation-canvas-structure-2026-07-31.md`](analysis/conversation-canvas-structure-2026-07-31.md) · [`analysis/README.md`](analysis/README.md)
> **说明**：文内行号/路径会漂移；「幕布」= Messages 时间线及其上游数据链路。
> **保留原因**：单引擎逐步调用链的过程记录，便于对照重构前后。

## 0. 入口与关键开关

| 项 | 结论 | 代码定位 |
|---|---|---|
| 线程事件订阅入口 | `useThreads` 内调用 `useAppServerEvents(handlers, ...)` | `src/features/threads/hooks/useThreads.ts:1580-1621` |
| Claude 实时事件适配器 | `claudeRealtimeAdapter.mapEvent -> mapCommonRealtimeEvent(..., { allowTextDeltaAlias: true })` | `src/features/threads/adapters/claudeRealtimeAdapter.ts:4-10` |
| 统一历史加载器（全局） | 配置被强制为 `true`（normalize 阶段） | `src/features/settings/hooks/useAppSettings.ts:203-206` |

---

## 1. Claude 实时渲染步骤（接收流式数据时）

| 步骤 | 调用方法（按执行顺序） | 作用 | 代码定位 |
|---|---|---|---|
| 1 | `subscribeAppServerEvents` 回调触发 | 前端接收 app-server 推送事件 | `src/features/app/hooks/useAppServerEvents.ts:473-477` |
| 2 | `tryRouteNormalizedRealtimeEvent`（若开了 normalized realtime） | 尝试走统一事件适配层 | `src/features/app/hooks/useAppServerEvents.ts:633-644` |
| 3 | `getRealtimeAdapterByEngine("claude") -> claudeRealtimeAdapter.mapEvent` | Claude 事件做统一映射 | `src/features/app/hooks/useAppServerEvents.ts:447-452` + `src/features/threads/adapters/claudeRealtimeAdapter.ts:4-10` |
| 4 | `mapCommonRealtimeEvent` | 将 `item/agentMessage/delta`、`text:delta`、reasoning/tool delta 等映射成标准操作 | `src/features/threads/adapters/sharedRealtimeAdapter.ts:174-423` |
| 5 | `routeNormalizedRealtimeEvent` | 按 operation 路由到具体 handler；Claude 有 snapshot-as-delta 去重 | `src/features/app/hooks/useAppServerEvents.ts:320-419`（去重 `344-351`） |
| 6 | （默认兼容路径）`extractAgentMessageDeltaPayload` + method 分支 | 若未走 normalized，则按原始 method 直接分流（Claude 也走这里） | `src/features/app/hooks/useAppServerEvents.ts:646-656`、`1022-1223` |
| 7 | `useThreadEventHandlers` 聚合分发 | 将事件转发到 item/turn/userInput 处理器 | `src/features/threads/hooks/useThreadEventHandlers.ts:211-269`、`398-430` |
| 8 | `onAgentMessageDelta/onItemUpdated/onReasoning...` | 事件进入 `useThreadItemEvents`，统一 `dispatch` 更新线程 item | `src/features/threads/hooks/useThreadItemEvents.ts:323-585` |
| 9 | `threadReducer` 处理 action | 核心更新：`appendAgentDelta` / `upsertItem` / `appendReasoningSummary` / `appendReasoningContent` / `appendToolOutput` | `src/features/threads/hooks/useThreadsReducer.ts:2050-2108`、`2179-2306`、`2521-2694` |
| 10 | `prepareThreadItems` | 对 item 去重、合并快照、截断旧 tool 输出，得到可渲染列表 | `src/utils/threadItems.ts:2026-2081` |
| 11 | `useThreadSelectors` 产出 `activeItems` | 从 `itemsByThread` 选中当前线程 items | `src/features/threads/hooks/useThreadSelectors.ts:23-25` |
| 12 | `useLayoutNodes` 构建 `conversationState` | 把 `activeItems/plan/userInputQueue/meta` 封装给幕布 | `src/features/layout/hooks/useLayoutNodes.tsx:646-670` |
| 13 | `<Messages ... conversationState ...>` | 幕布组件接收新数据 | `src/features/layout/hooks/useLayoutNodes.tsx:983-1010` |
| 14 | `resolveRenderableItems -> visibleItems -> renderedItems` | 幕布内部做可见项过滤/去重/折叠窗口 | `src/features/messages/components/Messages.tsx:1656-1665`、`2050-2141` |
| 15 | `groupToolItems -> renderEntry -> renderSingleItem` | 真正渲染行组件：`MessageRow`、`ReasoningRow`、`ToolBlockRenderer`、`ReviewRow`、`DiffRow`、`ExploreRow` | `src/features/messages/components/Messages.tsx:2341-2481` |
| 16 | `WorkingIndicator` / `RequestUserInputMessage` | 渲染“思考中/等待输入”状态层 | `src/features/messages/components/Messages.tsx:2343-2355`、`2561-2575` |

### 1.1 Claude 实时下“具体渲染方法”清单

| 方法 | 场景 | 代码定位 |
|---|---|---|
| `MessageRow` | 用户/助手消息行（Claude 下会标记 streaming 行） | `src/features/messages/components/Messages.tsx:2371-2389` |
| `ReasoningRow` | reasoning 行（含 live/docked） | `src/features/messages/components/Messages.tsx:2392-2411`、`2549-2560` |
| `ToolBlockRenderer` | 单工具卡渲染 | `src/features/messages/components/Messages.tsx:2425-2440` |
| `ReadToolGroupBlock` / `EditToolGroupBlock` / `BashToolGroupBlock` / `SearchToolGroupBlock` | 工具分组渲染 | `src/features/messages/components/Messages.tsx:2455-2479` |
| `ReviewRow` / `DiffRow` / `ExploreRow` | review/diff/explore 渲染 | `src/features/messages/components/Messages.tsx:2412-2450` |
| `WorkingIndicator` | 底部运行状态提示 | `src/features/messages/components/Messages.tsx:2562-2575` |

---

## 2. Claude 历史渲染步骤（打开线程/恢复历史时）

| 步骤 | 调用方法（按执行顺序） | 作用 | 代码定位 |
|---|---|---|---|
| 1 | `setActiveThreadId -> resumeThreadForWorkspace` | 切换线程后触发历史恢复 | `src/features/threads/hooks/useThreads.ts:1400-1409` |
| 2 | `resumeThreadForWorkspace` 进入 unified loader 分支 | 走统一历史加载路径（当前分支默认） | `src/features/threads/hooks/useThreadActions.ts:421-464` |
| 3 | `createClaudeHistoryLoader(...).load(threadId)` | 为 Claude 线程选用专属 loader | `src/features/threads/hooks/useThreadActions.ts:446-453` |
| 4 | `loadClaudeSession(workspacePath, sessionId)` | 读取 Claude JSONL/session 历史 | `src/features/threads/loaders/claudeHistoryLoader.ts:818-841` |
| 5 | `parseClaudeHistoryMessages(messagesData)` | 解析 message/reasoning/tool，处理 askUserQuestion 及 tool 结果回填 | `src/features/threads/loaders/claudeHistoryLoader.ts:536-754` |
| 6 | `extractPendingUserInputQueueFromClaudeItems` | 从未完成 askUserQuestion 提取 pending userInputQueue | `src/features/threads/loaders/claudeHistoryLoader.ts:756-809` |
| 7 | `normalizeHistorySnapshot` | 产出标准 snapshot（含 meta/fallbackWarnings） | `src/features/threads/loaders/claudeHistoryLoader.ts:847-863` + `src/features/threads/contracts/conversationCurtainContracts.ts:118-171` |
| 8 | `dispatch(setThreadItems/setThreadPlan/addUserInputRequest)` | 将历史快照写入状态树 | `src/features/threads/hooks/useThreadActions.ts:471-474`、`560-562` |
| 9 | reducer `setThreadItems` + `prepareThreadItems` | 历史与本地 item 合并、规范化 | `src/features/threads/hooks/useThreadsReducer.ts:2307-2321` + `src/utils/threadItems.ts:2026-2081` |
| 10 | `useThreadSelectors -> useLayoutNodes` | 从状态选择当前线程 items，组装 `conversationState` | `src/features/threads/hooks/useThreadSelectors.ts:23-25` + `src/features/layout/hooks/useLayoutNodes.tsx:646-670` |
| 11 | `Messages` 同一渲染管线出图 | 历史与实时在幕布层走同一套渲染函数 | `src/features/messages/components/Messages.tsx:1656-1665`、`2050-2141`、`2341-2585` |

### 2.1 兼容分支（仅当 unified loader 关闭时）

| 路径 | 说明 | 代码定位 |
|---|---|---|
| Claude 旧路径 | `loadClaudeSession -> parseClaudeHistoryMessages -> setThreadItems` 的 legacy 分支仍保留 | `src/features/threads/hooks/useThreadActions.ts:589-645` |

---

## 3. 结论（Claude）

1. Claude 的“幕布渲染方法”最终集中在 `Messages.tsx` 的 `renderEntry/renderSingleItem`，并落到 `MessageRow/ReasoningRow/ToolBlockRenderer/...`。
2. 实时与历史在上游加载链路不同，但到 `conversationState.items` 后会汇合为同一渲染管线。
3. 当前分支默认启用 unified history loader，因此历史恢复优先走 `createClaudeHistoryLoader`。

