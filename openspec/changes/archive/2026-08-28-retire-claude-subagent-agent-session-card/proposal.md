## Why

Claude Shared / Native 幕布在 SubAgent 完成后会同时渲染两套完成态：新的 S10 `SubagentSquadGrid` 卡，以及历史 `message-agent-task-card`（`Agent session` + COMPLETED + 查看输出）。后者来自 `<task-notification>` 消息，是 engine-task-output 时代的入口，现已与 S10 重复，造成视觉噪音与「渲染了两遍」的错觉。应退役 SubAgent 场景下的旧卡，并把仍有价值的能力收敛到新卡 / inspector。

> **Supersession note（2026-08-08）**：幕布 S10 作为 canonical 完成表面，已被 [`retire-canvas-subagent-squad-grid`](../retire-canvas-subagent-squad-grid/proposal.md) **部分 supersede**。本 change 仍有效的核心是：退役 legacy Agent session 卡 + task-notification 事实 enrich + inspector 输出承接；enrich 宿主改为 Composer run-status strip / StatusPanel 行，而非幕布 SquadGrid。

## 目标与边界

- **目标**：Claude（Shared + Native）SubAgent 场景下旧 `Agent session` 卡在 SubAgent 型 task-notification 上不再可见；事实 enrich 到 subagent 视图模型 / inspector（canonical 观察面见 `retire-canvas-subagent-squad-grid`：Composer strip，**非** 幕布 S10）。
- **边界**：仅影响「像 SubAgent 完成通知」的 task-notification 呈现；解析契约、锚点数据、非 SubAgent 的任务输出卡保留。
- **能力迁移**：旧卡上仍有用的能力（终态 status、result 摘要、output-file 可观测）必须落到 strip/StatusPanel 行或 inspector，不得裸丢。

## 非目标

- 不删除 `parseAgentTaskNotification` / engine-task-output 契约与 artifact 读取桥。
- 不改 Claude Agent 工具识别（`isSubagentTool`）与 process-phase 折叠策略。
- 不重做 Codex Collab / Grok / Kimi 子代理视觉体系。
- 不实现完整 Claude `/tasks` 中心。
- 不在本次扩大 background shell settlement 范围（见独立 change）。

## What Changes

- 识别 **SubAgent 型** task-notification（summary 匹配 `Agent "…"` / 智能体形态等），在 MessageRow **不再渲染** `.message-agent-task-card`，且不把其 `resultText` 当作独立幕布气泡展示。
- 将 notification 的终态、result、output-file、taskId 等 **enrich 进** 对应 S10 卡 `SubagentCardViewModel` / `taskOutput`。
- Inspector 在「无子会话 id、但已知 output-file」时，提供与旧「查看输出」等价的 **EngineTaskOutputInspector** 入口（有界 tail）。
- 非 SubAgent 的 task-notification（若存在）继续走旧卡，避免误伤。
- 更新 focused tests：SubAgent 完成态无旧卡；能力可在新表面触达。

## Technical Options

| Option | Summary | Trade-off |
|--------|---------|-----------|
| A. 仅 CSS/条件藏旧卡 chrome，result 仍露在消息行 | 改动最小 | result 与主 agent 汇总仍可能双份；能力未迁到新卡 |
| B. 藏旧卡 + 把 notification 事实 enrich 到 S10 / inspector | 表面唯一、能力不丢 | 需匹配 toolUseId / 邻近消息，测试面略增 |
| C. 后端吞掉 task-notification 不进 conversation items | 前端干净 | 破坏历史回放与锚点、跨引擎风险高 |

**选定 B**：前端 presentation 退役旧卡，事实迁入 S10 体系；解析与契约保留。

## Capabilities

### New Capabilities

- `claude-subagent-canvas-surface`：Claude Shared/Native 幕布上 SubAgent 的唯一可见完成表面（S10）与 task-notification 退役规则、事实迁移合同。

### Modified Capabilities

- `generic-tool-presentation`：明确 SubAgent 主表面为 persona/squad；SubAgent 型 task-notification 不得再作为并行完成卡。
- `shared-message-domain-helpers`：agent-task 解析所有权不变；messages **消费** 规则改为「SubAgent 型不渲染旧卡」。

## 验收标准

1. Shared Claude 与 Native Claude：Explore/Agent 完成后幕布 **无** `Agent session` / `.message-agent-task-card` / 「查看输出」旧按钮。
2. 同场景仍可见 S10 卡，状态可收敛到 completed/error；点卡可开 inspector。
3. 若 notification 带 `output-file` 且尚无子会话，inspector 内可打开任务输出检查器（有界 tail）。
4. 非 SubAgent 型 task-notification（若有）旧卡行为不回归。
5. focused vitest 覆盖识别、藏卡、enrich；`openspec validate` 对本 change 通过。

## Impact

- **Frontend**：`MessageRow`、`messageRowPresentation`、`subagent-ui`（view model enrich、inspector）、相关 tests / i18n（若补文案）。
- **Contracts**：复用 `engine-task-output/contracts` 与 projection；无新 Tauri command。
- **StatusPanel / scroll**：优先 inspector；`data-agent-task-*` 锚点可保留零高度挂载（可选）。
- **OpenSpec**：本 change + 上述 capability delta。
