# 文档2：Codex 引擎对话幕布渲染链路（实时 + 历史）

> **文档性质**：**历史分支快照**（过程溯源），不是 0.7.x 现网说明。
> **采样基线**：分支 `codex/2026-03-23-v0.3.3`（`b7e82ac`）
> **现网请改读**：[`analysis/conversation-canvas-structure-2026-07-31.md`](analysis/conversation-canvas-structure-2026-07-31.md) · [`analysis/README.md`](analysis/README.md)
> **注意**：文内「normalized realtime 默认 false」等开关结论**已过期**（现网默认 true，见 analysis §4）；行号会漂移。
> **保留原因**：Codex 单引擎逐步调用链的过程记录。

## 0. 入口与关键开关（Codex）

| 项 | 结论 | 代码定位 |
|---|---|---|
| 线程事件订阅入口 | `useThreads -> useAppServerEvents` | `src/features/threads/hooks/useThreads.ts:1580-1621` |
| normalized realtime 默认值 | 默认 `false`（即默认走 legacy method 分流） | `src/features/settings/hooks/useAppSettings.ts:125-126` |
| unified history loader | 归一化阶段强制 `true` | `src/features/settings/hooks/useAppSettings.ts:203-206` |
| Codex 适配器 | `codexRealtimeAdapter.mapEvent -> mapCommonRealtimeEvent("codex")`（无 text alias） | `src/features/threads/adapters/codexRealtimeAdapter.ts:4-8` |

---

## 1. Codex 实时渲染步骤（接收流式数据时）

| 步骤 | 调用方法（按执行顺序） | 作用 | 代码定位 |
|---|---|---|---|
| 1 | `subscribeAppServerEvents` 回调触发 | 前端接收 Codex runtime 推送 | `src/features/app/hooks/useAppServerEvents.ts:473-477` |
| 2 | （默认）legacy method 分流 | `token_count`、`item/*`、`turn/*`、`reasoning/*` 等事件按 method 分支处理 | `src/features/app/hooks/useAppServerEvents.ts:658-1223` |
| 3 | （可选）`tryRouteNormalizedRealtimeEvent` | 若开启 normalized realtime，则先走统一适配层 | `src/features/app/hooks/useAppServerEvents.ts:633-644` |
| 4 | `codexRealtimeAdapter.mapEvent` | Codex 事件映射为标准 operation（append/start/update/complete） | `src/features/threads/adapters/codexRealtimeAdapter.ts:4-8` + `src/features/threads/adapters/sharedRealtimeAdapter.ts:174-423` |
| 5 | `routeNormalizedRealtimeEvent` | 按 normalized operation 调用 handler | `src/features/app/hooks/useAppServerEvents.ts:320-419` |
| 6 | `useThreadEventHandlers` | 聚合分发到 item/turn/userInput 等处理器 | `src/features/threads/hooks/useThreadEventHandlers.ts:211-269`、`398-430` |
| 7 | `useThreadItemEvents` | item 级更新：`onAgentMessageDelta`、`onItemStarted/Updated/Completed`、reasoning/tool output 追加 | `src/features/threads/hooks/useThreadItemEvents.ts:323-585` |
| 8 | `useThreadTurnEvents` | turn 级状态更新：`onTurnStarted`、`onTurnCompleted`、plan、token usage、context compacting | `src/features/threads/hooks/useThreadTurnEvents.ts:185-410` |
| 9 | reducer 写入状态 | `appendAgentDelta` / `completeAgentMessage` / `upsertItem` / reasoning/tool append / 状态位更新 | `src/features/threads/hooks/useThreadsReducer.ts:2050-2108`、`2109-2178`、`2179-2306`、`2521-2694` |
| 10 | `prepareThreadItems` | 合并同 id 项、过滤空 assistant、裁剪旧 tool 输出 | `src/utils/threadItems.ts:2026-2081` |
| 11 | `useThreadSelectors` -> `activeItems` | 选中当前线程 items | `src/features/threads/hooks/useThreadSelectors.ts:23-25` |
| 12 | `useLayoutNodes` 组装 `conversationState` | 将 items/plan/userInput/meta 传给幕布 | `src/features/layout/hooks/useLayoutNodes.tsx:646-670` |
| 13 | `Messages` 渲染管线 | `resolveRenderableItems -> visibleItems -> renderedItems` | `src/features/messages/components/Messages.tsx:1656-1665`、`2050-2141` |
| 14 | 行组件渲染 | `groupToolItems -> renderEntry -> renderSingleItem` 落到 `MessageRow/ReasoningRow/ToolBlockRenderer/...` | `src/features/messages/components/Messages.tsx:2341-2481` |
| 15 | 状态层渲染 | `RequestUserInputMessage` + `WorkingIndicator` | `src/features/messages/components/Messages.tsx:2343-2355`、`2561-2575` |

### 1.1 Codex 实时路径里的关键 method 分支（legacy）

| method | 处理函数/动作 | 代码定位 |
|---|---|---|
| `item/agentMessage/delta` | `extractAgentMessageDeltaPayload -> onAgentMessageDelta` | `src/features/app/hooks/useAppServerEvents.ts:180-242`、`646-656` |
| `item/started` / `item/updated` / `item/completed` | `hydrateToolSnapshotWithEventParams` 后进入 `onItem*` | `src/features/app/hooks/useAppServerEvents.ts:1022-1127` |
| `item/reasoning/*` + `response.reasoning_*` | 进入 `onReasoningSummaryDelta/onReasoningTextDelta` | `src/features/app/hooks/useAppServerEvents.ts:1129-1190` |
| `item/commandExecution/outputDelta` / `item/fileChange/outputDelta` | 进入 tool output 追加链路 | `src/features/app/hooks/useAppServerEvents.ts:1192-1222` |
| `turn/started` / `turn/completed` | turn 状态位 + 结束收敛 | `src/features/app/hooks/useAppServerEvents.ts:658-671`、`770-844` |
| `token_count` | token usage 更新 | `src/features/app/hooks/useAppServerEvents.ts:931-1008` |

---

## 2. Codex 历史渲染步骤（打开线程/恢复历史时）

| 步骤 | 调用方法（按执行顺序） | 作用 | 代码定位 |
|---|---|---|---|
| 1 | `setActiveThreadId -> resumeThreadForWorkspace` | 切线程触发历史恢复 | `src/features/threads/hooks/useThreads.ts:1400-1409` |
| 2 | unified loader 分支 | 当前分支默认走统一历史加载 | `src/features/threads/hooks/useThreadActions.ts:443-464` |
| 3 | `createCodexHistoryLoader(...).load(threadId)` | Codex 历史专用 loader | `src/features/threads/hooks/useThreadActions.ts:458-462` + `src/features/threads/loaders/codexHistoryLoader.ts:88-137` |
| 4 | `resumeThread -> buildItemsFromThread(thread)` | 从服务端 thread.turns 构建历史 items | `src/features/threads/loaders/codexHistoryLoader.ts:96-101` + `src/utils/threadItems.ts:2619-2645` |
| 5 | `loadCodexSession -> parseCodexSessionHistory` | 读取本地会话历史（reasoning/tool call/output/user/assistant） | `src/features/threads/loaders/codexHistoryLoader.ts:103-108` + `src/features/threads/loaders/codexSessionHistory.ts:470-639` |
| 6 | `mergeCodexHistoryPreservingTurns` | 远端 + 本地历史按 user turn 结构融合 | `src/features/threads/loaders/codexHistoryLoader.ts:33-86` |
| 7 | `extractLatestTurnPlan` / `extractUserInputQueueFromThread` | 恢复 plan 与 pending userInputQueue | `src/features/threads/loaders/codexHistoryLoader.ts:122-125` + `src/features/threads/loaders/historyLoaderUtils.ts:159-224` |
| 8 | `normalizeHistorySnapshot` | 标准化 snapshot/meta/fallbackWarnings | `src/features/threads/loaders/codexHistoryLoader.ts:117-135` + `src/features/threads/contracts/conversationCurtainContracts.ts:118-171` |
| 9 | `dispatch(setThreadItems/setThreadPlan/addUserInputRequest)` | 把历史状态落入 reducer | `src/features/threads/hooks/useThreadActions.ts:471-474`、`560-562` |
| 10 | reducer `setThreadItems` + `prepareThreadItems` | 合并本地 optimistic 与历史项，得到可渲染列表 | `src/features/threads/hooks/useThreadsReducer.ts:2307-2321` + `src/utils/threadItems.ts:2026-2081` |
| 11 | `useThreadSelectors -> useLayoutNodes -> Messages` | 进入幕布统一渲染链路 | `src/features/threads/hooks/useThreadSelectors.ts:23-25` + `src/features/layout/hooks/useLayoutNodes.tsx:646-670` + `src/features/messages/components/Messages.tsx:1656-2585` |

### 2.1 `parseCodexSessionHistory` 中与渲染直接相关的解析点

| 输入条目类型 | 产物 item | 代码定位 |
|---|---|---|
| `response_item(reasoning)` | `reasoning`（含去重/合并） | `src/features/threads/loaders/codexSessionHistory.ts:486-490`、`109-123` |
| `response_item(function_call + exec_command)` | 暂存 pending command | `src/features/threads/loaders/codexSessionHistory.ts:494-517` |
| `response_item(function_call_output)` | `commandExecution` tool（flush） | `src/features/threads/loaders/codexSessionHistory.ts:524-539` |
| `custom_tool_call(apply_patch)` / output | `fileChange` tool | `src/features/threads/loaders/codexSessionHistory.ts:542-553`、`586-598` |
| `response_item(message assistant)` | assistant `message` | `src/features/threads/loaders/codexSessionHistory.ts:555-560` |
| `event_msg(user_message/agent_message)` | user/assistant `message` | `src/features/threads/loaders/codexSessionHistory.ts:564-582` |

---

## 3. 结论（Codex）

1. Codex 的幕布最终渲染方法与 Claude 一致，都是 `Messages` 内 `renderEntry/renderSingleItem` 调到具体 Row 组件。
2. 实时路径上，当前分支默认仍是 legacy method 分流；若启用 normalized realtime，则会先走 `codexRealtimeAdapter`。
3. 历史路径上，当前分支默认统一走 `createCodexHistoryLoader`，并融合远端 thread 快照与本地 session 历史。

