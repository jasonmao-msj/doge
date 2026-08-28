## Context

Shared V2 send 在 Runtime terminal commit 后返回并 early-return，跳过 native turn-start 与 `captureTurnInput`。完成事件经 sharedOwner / binding 投影到 shared thread；`emitSharedTerminalProjection` 成功时旧逻辑不调用 `onAgentMessageCompleted`，记忆融合不跑。

`handleAgentMessageCompletedForMemory` 已兼容 `threadKind === "shared"`（含 engineSource upsert），可直接复用。

## Goals / Non-Goals

- **Goals**：Shared V2 一轮对话完整入库（user + assistant digest）；turnId 两侧一致；不破坏 canvas 投影。
- **Non-Goals**：改 shared 编排协议；放宽 PENDING_MEMORY_STALE_MS（默认 10min 通常足够，若 squad 超长另开）。

## Decisions

1. **Capture turnId**：优先 `runtimeTurnId`，否则 `logicalTurnId`，与 terminal `turnId` 对齐。
2. **Completion**：`markThreadAgentCompletionSeen` 成功后始终 `onAgentMessageCompleted`；投影 best-effort 独立。
3. **V1**：无 V2 committed 时若有 turn identity 仍 capture，避免 flag 关闭漏采。

## Risks

| Risk | Mitigation |
|------|------------|
| turnId 不一致 → 融合 miss | 两侧优先 runtimeTurnId；测试锁定 |
| 双写 V1/V2 | V2 committed 早退，V1 仅非 committed 路径 |
| 投影 + completed 双路径 UI | completed 走 memory handler；投影走 normalized adapter，idempotent upsert |

## Migration

无。
