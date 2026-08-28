## Context

项目记忆 ABCD 闭环中，C（融合写入）依赖 `onAgentMessageCompleted`。该事件由 `item/completed`（agentMessage）驱动。Claude forwarder 在 TurnCompleted 时总会发 completed；Gemini 系（gemini/kimi/grok）原先在 `saw_text_delta` 时跳过 synthetic completed，导致正常流式对话记忆不完整。

## Goals / Non-Goals

- **Goals**：Native Grok/Kimi/Gemini 流式 turn 结束后也能触发完整 conversation_turn 记忆；synthetic id 与 text lane 对齐，不产生双气泡。
- **Non-Goals**：Shared 会话；前端 turn/completed 二次合成；改动 Claude/Codex 既有路径语义。

## Decisions

1. **Backend always emit** `item/completed` when `completed_text` 非空，无论是否见过 TextDelta。
2. **Item id**：`gemini_agent_completion_item_id(state, base)` — prefer `active_text_item_id`，否则按 `text_run_index` 重建 last text id。
3. **Daemon 同步**：daemon_state 三处 forwarder 同合同，避免桌面/daemon 分叉。
4. **Gemini 同步受益**：forwarder 共用逻辑，视为修复而非 scope creep。

## Risks

| Risk | Mitigation |
|------|------------|
| 双气泡（错误 Other-lane id） | text-lane id + 单测锁定 |
| 与 turn/completed 前端兜底重复 | FE 见 completed 后 mark seen，不二次合成 |
| 空文本 completed | 仍要求 `completed_text` 非空 |

## Migration

无数据迁移。已有仅输入侧的不完整记忆可在健康审查中按既有规则处理。
