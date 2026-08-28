## Context

Claude Agent/Task 完成后，协议会同时留下：

1. **tool item**（`Agent` / `Task`）→ `isSubagentTool` → `subagentGroup` → **S10** `SubagentSquadGrid` / Ring 卡 → 点击进 `SubagentInspectorDrawer`。
2. **message item**（`<task-notification>`）→ `parseAgentTaskNotification` → **旧卡** `.message-agent-task-card`（`Agent session` + status + task/tool/output 徽标 + 「查看输出」→ `EngineTaskOutputInspector`）。

S10 已是跨引擎 SubAgent 主表面；旧卡是 engine-task-output 时代的 Claude 专用完成通知壳。Shared 与 Native Claude 共用 MessageRow 路径，故双表面在两边都可见。

旧卡能力清单（需迁移或显式放弃）：

| 能力 | 旧卡 | 新表面现状 | 本设计 |
|------|------|------------|--------|
| 标题 / description | summary 解析 `Agent "…"` | Ring 描述 | 已有；可 enrich 对齐 |
| 终态 status | notification.status | mapToolStatus(tool) | **enrich** 自 notification |
| result 正文 | resultText 作 markdown | tool.output 常为 launch ack | **enrich** recentOutput / fallback |
| output-file 尾读 | 查看输出 → Inspector | 无 session 时仅 pre 文本 | **inspector 内接 EngineTaskOutputInspector** |
| taskId / toolUseId 徽标 | Badge | taskOutput 字段 | enrich 字段；UI 不强制徽标行 |
| 滚动锚点 | data-agent-task-* | StatusPanel 已改 inspector | 锚点可保留零高 wrapper |

## Goals / Non-Goals

**Goals:**

- SubAgent 型 task-notification 在幕布上 **零旧卡像素**。
- 事实迁入 S10 / inspector，用户不丢终态与可观测输出。
- Shared Claude 与 Native Claude 行为一致。
- 解析契约与 artifact 桥保持可用。

**Non-Goals:**

- 后端过滤 task-notification。
- 改 subagent 识别与 process-phase 折叠。
- Codex/Grok/Kimi 旧卡（它们本就不走 Claude Agent session 卡）。

## Decisions

### D1 — 识别 SubAgent 型 notification（前端 pure）

在 `engine-task-output/contracts` 或 messages 旁侧 pure helper 增加：

`isSubagentStyleAgentTaskNotification(notification): boolean`

规则（保守、可测）：

- `summary` 匹配 `Agent\s+["“]…["”]` 或 `智能体\s*["“]…["”]`；或
- `summary` 以 `Agent` 开头且含 completed/finished/done/success 等终态词。

**不**用「有 tool-use-id」单独判定（background shell 也可能带 id）。

### D2 — MessageRow：藏卡 + 藏 result 气泡（方案 A 整条视觉退役）

当 `parseAgentTaskNotification` 命中且 D1 为 true：

- 不渲染 `.message-agent-task-card`；
- 不把 `resultText` 当独立 markdown 气泡展示；
- `MessageRow` 对「仅 notification、无图/无其它可见内容」可 **return null**（外层 Timeline 仍可挂 `data-agent-task-id`）。

非 D1 notification 保持现有旧卡（防御性兼容）。

### D3 — Enrich S10 卡

在 `SubagentSquadGrid`（或 view-model 纯函数）中：

1. 从当前父 thread items 扫描 message，解析 task-notification。
2. 用 `toolUseId` 与 tool item `id` / detail / 已知 tool-use 字段 **弱匹配**。
3. 命中则覆盖/补齐：`status`、`taskOutput.taskId`、`outputFilePath`、`recentOutput`（prefer 更长的 result）、必要时 `description`。

匹配失败时：仅藏旧卡，不伪造关联（S10 仍靠 tool 自身状态）。

### D4 — Inspector 承接「查看输出」

`SubagentInspectorDrawer`：

- 优先 `sessionThreadId` → `SubagentSessionCanvas`（不变）。
- 否则若 `taskOutput.outputFilePath` 存在 → 渲染 `EngineTaskOutputInspector`（snapshot 自 `taskOutput` + 现有 hook 刷新）。
- 否则 fallback `outputText` / launch 文案（不变）。

### D5 — 测试策略

- unit：`isSubagentStyleAgentTaskNotification` 边界。
- unit：enrich 匹配与 status/result 合并。
- component：原 rich-content「必须有旧卡」改为 SubAgent 摘要 **无旧卡**；非 SubAgent 样例（若有）仍可有卡。
- component：inspector 在有 outputFile 无 session 时可挂载 inspector label。

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| toolUseId 与 item.id 不一致导致 enrich 失败 | 多键弱匹配 + 失败时至少藏旧卡；手测 Claude Explore |
| 用户依赖旧卡 result 当「主回复」 | enrich + 主 agent 仍会写汇总；inspector 可看 result |
| 误判 background shell 为 SubAgent | 仅 Agent/智能体 summary 形态；shell 文案通常不同 |
| 空 MessageRow 占位影响虚拟列表高度 | return null / 无 bubble；virtualizer 已有 measure |

## Migration Plan

1. 落地 helper + MessageRow 藏卡。
2. Enrich + inspector 输出桥。
3. 改测试与 OpenSpec tasks 勾选。
4. 手测 Shared/Native Claude 各一轮 Agent。
5. 回滚：还原 MessageRow 条件即可恢复旧卡（契约未删）。

## Open Questions

- 无：以 D1 summary 形态为准，不扩大到全部 task-notification。
