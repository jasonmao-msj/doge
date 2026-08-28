## Why

Shared CLI 会话在 V2 committed 路径提前 return，到不了 native `captureTurnInput`；完成侧走 `emitSharedTerminalProjection`（`onNormalizedRealtimeEvent`），投影成功时不调用 `onAgentMessageCompleted`，项目记忆整轮入库缺失。需要与 native 对齐：输入采集 + 完成融合。

## What Changes

- Shared V2 committed 成功路径：在 return 前调用 `projectMemoryFacade.captureTurnInput`（turnId = `runtimeTurnId ?? logicalTurnId`，engine = shared resolved engine），并 `onInputMemoryCaptured` 登记 pending。
- Shared V1 / 非 committed：有稳定 turn id 时同样 capture，避免静默漏采。
- Shared terminal 投影：投影成功后 **仍** 调用 `handlers.onAgentMessageCompleted`，复用既有融合 handler（含 shared thread upsert 与乱序缓冲）。
- Spec：扩展 `project-memory-auto-capture`，并新增 `shared-session-project-memory` capability 描述 shared 边界。

## Capabilities

### New Capabilities

- `shared-session-project-memory`: Shared 会话的项目记忆输入采集与完成融合合同。

### Modified Capabilities

- `project-memory-auto-capture`: Shared 路径纳入 ABCD 闭环；turnId 对齐 runtime/logical。

## Impact

| 层 | 影响面 |
|----|--------|
| Frontend | `useThreadMessaging.ts`（shared capture）、`useAppServerEvents.ts`（terminal 后记忆融合） |
| Backend | 无 |
| Specs | auto-capture delta + shared-session-project-memory |
| Tests | messaging capture 断言、terminal 投影后 completed 断言 |

## 非目标

- 不改 native Grok/Kimi forwarder（见 `fix-grok-kimi-native-memory-completion`）。
- 不改 shared 发送状态机 / recovery。
- 不双写 V1+V2：V2 committed 早退与 V1 路径互斥。
