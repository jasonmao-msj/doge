## ADDED Requirements

### Requirement: Shared session participates in project-memory ABCD

Shared CLI 会话 MUST 具备与 native 等价的项目记忆输入采集与完成融合能力（ABCD 中的 A 与 C），不得因 V2 early-return 或 terminal 投影短路而静默跳过。

#### Scenario: Shared V2 整轮入库

- **GIVEN** 用户在 shared thread 发送一轮正常对话
- **AND** V2 send committed 成功
- **WHEN** assistant 终态到达
- **THEN** 项目记忆 MUST 存在完整 conversation_turn（用户输入 + 助手摘要）
- **AND** engine 字段为该 shared turn 的 resolved engine

#### Scenario: turnId 两侧一致

- **GIVEN** capture 使用 runtimeTurnId（若有）
- **WHEN** onAgentMessageCompleted 携带 turnId
- **THEN** 融合逻辑 MUST 能按 turnId 匹配 pending capture
- **AND** 不得因 logical/runtime 混用导致 miss（实现 MUST 统一优先 runtime）

#### Scenario: 采集失败不阻塞 shared send

- **GIVEN** captureTurnInput 抛错
- **WHEN** shared V2 已 committed
- **THEN** UI lifecycle 收敛 MUST 不受影响
- **AND** 仅记录 warn
