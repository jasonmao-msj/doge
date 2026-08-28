## ADDED Requirements

### Requirement: SubAgent 完成态以 S10 为唯一幕布表面

对 Claude Shared 与 Claude Native，当对话中存在可识别的 SubAgent tool（`Agent` / `Task` 等已由 subagent 识别规则覆盖）时，幕布上的 **canonical 完成态表面** MUST 是 S10 `SubagentSquadGrid` / Ring 卡（及其 process-phase 折叠形态），MUST NOT 再并行展示 legacy `message-agent-task-card`（`Agent session` 完成卡）。

#### Scenario: SubAgent 型 task-notification 不渲染旧卡

- **WHEN** assistant 或 user 消息正文可被解析为 task-notification，且 summary 为 SubAgent 风格（如 `Agent "…"` / `智能体 "…"` 完成态）
- **THEN** 消息行 MUST NOT 渲染 `.message-agent-task-card`
- **AND** MUST NOT 把该 notification 的 `resultText` 作为独立幕布气泡的主内容展示

#### Scenario: S10 卡仍可见

- **WHEN** 同一回合存在已分组的 SubAgent tool items
- **THEN** 幕布 MUST 仍可通过 `subagentGroup` 渲染 S10 小队卡
- **AND** 用户 MUST 能通过点卡打开 SubAgent inspector

### Requirement: task-notification 事实迁入 SubAgent 视图模型

当 SubAgent 型 task-notification 可与 tool item 关联（优先 `tool-use-id` 与 tool item 标识弱匹配）时，系统 MUST 将其终态与输出事实 enrich 到对应 `SubagentCardViewModel` / `taskOutput`，包括 status、taskId、output-file 路径、recent/result 文本中至少一项可用字段。

#### Scenario: 完成通知提升卡状态

- **WHEN** 关联 notification 的 status 表示 completed 或 error
- **THEN** 对应 S10 卡 status MUST 收敛为 completed 或 error（不得长期卡在 running，若仅因 tool.output 仍是 launch ack）

#### Scenario: result 可在 inspector 回看

- **WHEN** notification 带有非空 result 文本且已 enrich
- **THEN** 用户打开 inspector 后 MUST 能在会话画布或 fallback 输出区看到该结果（或等价 artifact 尾读内容）

### Requirement: 旧「查看输出」能力由 inspector 承接

legacy 卡上的「查看输出」（`EngineTaskOutputInspector` + 已知 output-file 有界 tail）MUST 在 SubAgent inspector 中可用，当且仅当卡片已有 `outputFilePath`（或等价 taskOutput 字段）且当前无法加载子会话画布时作为主降级路径之一。

#### Scenario: 无子会话但有 output-file

- **WHEN** inspector 打开的卡没有可用 `sessionThreadId`，但 `taskOutput.outputFilePath` 非空
- **THEN** inspector MUST 提供 EngineTaskOutputInspector（或等价有界 tail 表面）
- **AND** MUST NOT 要求用户回到 legacy Agent session 卡

### Requirement: 非 SubAgent task-notification 不受误伤

不符合 SubAgent 风格识别的 task-notification MUST 继续允许现有 agent-task 卡呈现（若产品仍依赖该路径），本 change MUST NOT 全局删除所有 task-notification 渲染。

#### Scenario: 非 Agent 摘要仍可走旧卡

- **WHEN** task-notification 的 summary 无法识别为 SubAgent 风格
- **THEN** MessageRow MAY 继续渲染 `.message-agent-task-card`
