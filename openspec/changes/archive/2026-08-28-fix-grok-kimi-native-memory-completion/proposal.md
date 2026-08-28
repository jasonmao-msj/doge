## Why

Native Kimi / Grok（及共用 Gemini-style forwarder 的引擎）在正常流式路径上有 TextDelta 后，TurnCompleted 故意不发 `item/completed` agentMessage。项目记忆融合只挂在 `onAgentMessageCompleted`，导致记忆只剩 user_input、AI 回复「暂无可预览内容」。Claude / Codex 整轮完整入库，体验不对齐。

## What Changes

- 在 Gemini / Kimi / Grok forwarder 的 `TurnCompleted` 分支：移除 `!saw_text_delta` 守卫；`completed_text` 非空即 emit synthetic `item/completed`。
- synthetic item id 必须取 **text lane** 的 stable id（与流式 delta 同 id），靠前端 upsert 防双气泡。
- 同步 daemon 路径（`cc_gui_daemon`）同一合同。
- 更新 `project-memory-auto-capture`：采集与完成融合按 resolved engine 统一，不再锁死 Claude+Codex。
- 前端不改 native 完成合成策略（仍依赖 backend `item/completed`）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `project-memory-auto-capture`: 完成融合触发条件覆盖 native Gemini 系（gemini/grok/kimi）流式路径；engine 字段按 resolved engine 透传。

## Impact

| 层 | 影响面 |
|----|--------|
| Backend | `src-tauri/src/engine/commands.rs`（gemini/kimi/grok forwarder）、`src-tauri/src/bin/cc_gui_daemon*.rs` |
| Frontend | 无代码变更；既有 `item/completed` → `onAgentMessageCompleted` → 记忆融合 |
| Specs | `project-memory-auto-capture` delta |
| Tests | Rust routing/completion id 单测；既有 FE「turn/completed 不前端合成」保留 |

## 非目标

- 不改 shared session 入库（见 change `add-shared-session-project-memory-capture`）。
- 不改前端 `shouldSettleTerminalFinal` 对 native+seenDelta 的抑制。
- 不引入 engine 白名单；存储层保持 engine 透传。
