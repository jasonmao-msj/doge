## MODIFIED Requirements

### Requirement: 输入采集确权 (A - Input Capture)

系统 MUST 在用户发送消息成功后采集输入。对 **shared** thread，MUST 在 shared send 成功路径（含 V2 committed early-return）显式采集，不得依赖 native turn-start 公共块。

#### Scenario: Shared V2 committed 采集

- **GIVEN** threadKind 为 shared 且 Shared V2 send 返回 committed=true
- **AND** 存在 runtimeTurnId 或 logicalTurnId
- **WHEN** messaging 处理成功响应
- **THEN** 系统 MUST 调用 captureTurnInput
- **AND** turnId MUST 优先 runtimeTurnId，否则 logicalTurnId
- **AND** engine MUST 为 shared resolved engine
- **AND** MUST 触发 onInputMemoryCaptured 登记 pending

#### Scenario: Claude 引擎自动采集

- **GIVEN** 用户使用 Claude 引擎发送消息
- **WHEN** 消息内容为 "帮我优化数据库查询"
- **THEN** 系统应调用 `project_memory_capture_auto`
- **AND** 传入用户输入文本、workspace_id、thread_id
- **AND** 返回 memoryId 或 null

#### Scenario: Codex 引擎自动采集

- **GIVEN** 用户使用 Codex 引擎发送消息
- **WHEN** 消息内容为 "实现用户登录功能"
- **THEN** 系统应调用 `project_memory_capture_auto`
- **AND** 采集逻辑与 Claude 引擎一致

#### Scenario: Grok / Kimi 引擎自动采集

- **GIVEN** 用户使用 Grok 或 Kimi native 引擎发送消息
- **WHEN** turn 启动成功并拿到 turnId
- **THEN** 系统 MUST 同样调用输入采集
- **AND** engine MUST 分别为 `grok` / `kimi`

#### Scenario: 采集确权回调

- **GIVEN** 输入采集成功并返回 memoryId="memory-123"
- **WHEN** `onInputMemoryCaptured` 回调被触发
- **THEN** 应将 memoryId 存储到 `pendingMemoryCaptureRef`
- **AND** 关联到当前 threadId 和 turnId

#### Scenario: 采集失败降级

- **GIVEN** 输入采集因网络错误失败
- **WHEN** 系统执行输入采集
- **THEN** 应捕获异常并记录 warn
- **AND** 不应阻塞消息发送

### Requirement: 融合写入 (C - Fusion Write)

系统 MUST 在 assistant 完成时融合写入。对 shared terminal 路径，即便已发出 normalized completeAgentMessage 投影，MUST 仍调用 onAgentMessageCompleted 以驱动记忆融合。

#### Scenario: Shared terminal 投影后仍融合

- **GIVEN** shared turn 已 capture 输入
- **AND** turn/completed 带非空 result text（或等价终态文本）
- **WHEN** 系统 settle shared terminal final
- **THEN** 可投影 completeAgentMessage 到 canvas
- **AND** MUST 调用 onAgentMessageCompleted（含 turnId）
- **AND** 记忆融合 handler MUST 能匹配 pending capture 并完成 update/create

#### Scenario: Update 优先模式

- **GIVEN** 输入采集时返回 memoryId="memory-123" 且 assistant 回复完成后生成 outputDigest
- **WHEN** 执行融合写入
- **THEN** 应优先调用 `project_memory_update(memory-123, ...)`
- **AND** 更新 title、summary、detail 字段

#### Scenario: Create 降级模式

- **GIVEN** Update 操作失败
- **WHEN** 系统检测到 update 失败
- **THEN** 应降级调用 `project_memory_create`
- **AND** 设置 source 为 "assistant_output_digest"

#### Scenario: Grok/Kimi 流式 turn 完成后融合

- **GIVEN** native Grok 或 Kimi turn 已流式 TextDelta，且输入侧已 capture
- **WHEN** provider 发出 TurnCompleted 且最终文本非空
- **THEN** backend MUST emit `item/completed` agentMessage
- **AND** 前端 MUST 触发 `onAgentMessageCompleted` 并完成融合写入

#### Scenario: 融合写入成功后清理

- **GIVEN** 融合写入成功完成
- **WHEN** 系统完成 update 或 create 操作
- **THEN** 应清理 `pendingMemoryCaptureRef[threadId]`

#### Scenario: 融合写入失败诊断

- **GIVEN** Update 和 Create 均失败
- **WHEN** 系统执行错误处理
- **THEN** 应记录失败原因和上下文信息
- **AND** 不应阻塞 UI 交互
