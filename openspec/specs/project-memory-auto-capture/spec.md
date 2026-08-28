# Project Memory Auto Capture

## Purpose

提供项目记忆自动采集能力,实现 ABCD 闭环(输入采集→输出压缩→融合写入→交叉验证),支持双引擎(Claude + Codex)自动捕获对话上下文。

## Requirements

### Requirement: 输入采集确权 (A - Input Capture)

系统 MUST 在用户发送消息成功并拿到 turnId 后，按 resolved engine 自动采集输入文本,并为后续融合写入预留记忆 ID。`engine` 字段 MUST 透传 resolved engine。

#### Scenario: Claude 引擎自动采集

- **GIVEN** 用户使用 Claude 引擎发送消息
- **WHEN** 消息内容为 "帮我优化数据库查询"
- **THEN** 系统应调用 `project_memory_capture_auto`
- **AND** 传入用户输入文本、workspace_id、thread_id
- **AND** 返回 memoryId 或 null(重复则跳过)

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
- **AND** 等待 assistant 回复完成后融合写入

#### Scenario: Shared V2 committed 采集

- **GIVEN** threadKind 为 shared 且 Shared V2 send 返回 committed=true
- **AND** 存在 runtimeTurnId 或 logicalTurnId
- **WHEN** messaging 处理成功响应
- **THEN** 系统 MUST 调用 captureTurnInput
- **AND** turnId MUST 优先 runtimeTurnId，否则 logicalTurnId
- **AND** engine MUST 为 shared resolved engine
- **AND** MUST 触发 onInputMemoryCaptured 登记 pending

#### Scenario: 采集失败降级

- **GIVEN** 输入采集因网络错误失败
- **WHEN** 系统执行 `project_memory_capture_auto`
- **THEN** 应捕获异常并记录 `console.warn`
- **AND** 不应阻塞消息发送
- **AND** 返回 null 表示跳过本次采集

---

### Requirement: 输出压缩器 (B - Output Digest)

系统 MUST 提供可插拔的输出压缩器,将 assistant 回复内容压缩为 title、summary、detail 三段结构化文本。

#### Scenario: 清洗 Markdown 噪声

- **GIVEN** assistant 回复包含代码块 "\`\`\`python\nprint('hello')\n\`\`\`"
- **WHEN** 调用 `cleanMarkdown(text)`
- **THEN** 应移除代码块标记和内容
- **AND** 保留纯文本描述部分

#### Scenario: 拆分句子

- **GIVEN** 清洗后文本为 "这是第一句。这是第二句。这是第三句。"
- **WHEN** 调用 `splitSentences(text)`
- **THEN** 应按句号、问号、感叹号拆分
- **AND** 返回数组 ["这是第一句", "这是第二句", "这是第三句"]

#### Scenario: 提取标题

- **GIVEN** 句子数组的首句为 "数据库查询优化方案..."
- **WHEN** 调用 `extractTitle(sentences)`
- **THEN** 应截取首句前 50 字符作为标题
- **AND** 标题应去除多余空白

#### Scenario: 提取摘要

- **GIVEN** 句子数组包含 10 个句子
- **WHEN** 调用 `extractSummary(sentences)`
- **THEN** 应取前 3 个句子拼接为摘要
- **AND** 摘要长度应不超过 200 字符
- **AND** 超长时应截断并添加 "..." 省略号

#### Scenario: 提取详情

- **GIVEN** 清洗后完整文本
- **WHEN** 调用 `extractDetail(cleanedText)`
- **THEN** 应截取前 800 字符作为详情
- **AND** 保留完整句子结构

#### Scenario: 无效文本返回 null

- **GIVEN** assistant 回复为空或仅包含空白字符
- **WHEN** 调用 `buildAssistantOutputDigest(text)`
- **THEN** 应返回 null
- **AND** 不应创建空记忆

---

### Requirement: 融合写入 (C - Fusion Write)

系统 MUST 在 assistant 回复完成后,将输入文本和输出摘要融合写入到记忆中。对 Gemini 系 native 引擎（gemini / grok / kimi），TurnCompleted 后 MUST 发出 `item/completed`（agentMessage），即便该 turn 已流式下发过 TextDelta。

#### Scenario: Update 优先模式

- **GIVEN** 输入采集时返回 memoryId="memory-123"
- **AND** assistant 回复完成后生成 outputDigest
- **WHEN** 执行融合写入
- **THEN** 应优先调用 `project_memory_update(memory-123, ...)`
- **AND** 更新 title、summary、detail 字段
- **AND** detail 格式为 "用户输入：...\n助手输出摘要：...\n助手输出：..."

#### Scenario: Create 降级模式

- **GIVEN** Update 操作失败(如 memoryId 不存在)
- **WHEN** 系统检测到 update 失败
- **THEN** 应降级调用 `project_memory_create`
- **AND** 使用相同的数据创建新记忆
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
- **AND** 释放相关资源

#### Scenario: Shared terminal 投影后仍融合

- **GIVEN** shared turn 已 capture 输入，且 turn/completed 带非空 result text
- **WHEN** 系统 settle shared terminal final
- **THEN** 可投影 completeAgentMessage 到 canvas
- **AND** MUST 调用 onAgentMessageCompleted（含 turnId）
- **AND** 记忆融合 handler MUST 能匹配 pending capture 并完成 update/create

#### Scenario: 融合写入失败诊断

- **GIVEN** Update 和 Create 均失败
- **WHEN** 系统执行错误处理
- **THEN** 应记录 `console.warn("[project-memory] fusion write failed")`
- **AND** 包含失败原因和上下文信息
- **AND** 不应阻塞 UI 交互

---

### Requirement: 交叉验证 (D - Cross Validation)

系统 MUST 通过 TypeScript 类型检查、单元测试、集成测试确保 ABCD 闭环的正确性。

#### Scenario: TypeScript 零错误

- **WHEN** 执行 `npm run typecheck`
- **THEN** 应返回零错误
- **AND** 所有类型定义应完整且一致

#### Scenario: 输出压缩器单元测试

- **WHEN** 执行 `vitest outputDigest.test.ts`
- **THEN** 应通过 12 个测试用例
- **AND** 覆盖 cleanMarkdown、splitSentences、extractTitle/Summary/Detail

#### Scenario: Rust 后端集成测试

- **WHEN** 执行 `cargo test project_memory`
- **THEN** 应通过 63 个测试用例
- **AND** 覆盖存储、去重、分类、脱敏等核心逻辑

#### Scenario: 前端 Hook 单元测试

- **WHEN** 执行 `vitest useProjectMemory.test.tsx`
- **THEN** 应通过 3 个测试用例
- **AND** 覆盖 CRUD 操作和状态管理

---

### Requirement: 事件驱动架构

系统 MUST 使用事件驱动机制传递 assistant 消息完成事件,触发融合写入流程。

#### Scenario: 事件传递链

- **GIVEN** assistant 回复完成
- **WHEN** `useThreadItemEvents` 触发 `onAgentMessageCompleted` 事件
- **THEN** 应通过 `useThreadEventHandlers` 中转
- **AND** 传递到 `useThreads` 的 `onAgentMessageCompletedExternal` 回调
- **AND** 最终调用 `handleAgentMessageCompletedForMemory`

#### Scenario: 事件去重

- **GIVEN** 同一 message 被重复触发事件
- **WHEN** 系统检测到 messageId 已处理
- **THEN** 应跳过重复处理
- **AND** 不应创建重复记忆

---

### Requirement: 自动采集开关控制

系统 MUST 支持全局和 workspace 级别的自动采集开关控制。

#### Scenario: 全局开关禁用

- **GIVEN** 全局 autoEnabled 设置为 false
- **WHEN** 用户发送消息
- **THEN** 不应触发自动采集
- **AND** 不应调用 `project_memory_capture_auto`

#### Scenario: Workspace 级别开关覆盖

- **GIVEN** 全局 autoEnabled 为 true
- **AND** workspace A 设置 autoEnabled 为 false
- **WHEN** 在 workspace A 中发送消息
- **THEN** 应使用 workspace 级别配置(禁用)
- **AND** 不应触发自动采集

#### Scenario: Workspace 无覆盖则使用全局配置

- **GIVEN** 全局 autoEnabled 为 true
- **AND** workspace B 无覆盖配置
- **WHEN** 在 workspace B 中发送消息
- **THEN** 应使用全局配置(启用)
- **AND** 正常触发自动采集

---

### Requirement: 噪声过滤

系统 MUST 过滤短文本、纯空白、重复内容等噪声,避免创建低质量记忆。

#### Scenario: 过滤短文本

- **GIVEN** 用户输入为 "好的"
- **WHEN** 系统执行自动采集
- **THEN** 应检测文本长度 < 最小阈值
- **AND** 跳过采集并返回 null

#### Scenario: 过滤纯空白

- **GIVEN** 用户输入为 "   \n\n   "
- **WHEN** 系统执行 `normalize_text`
- **THEN** 清洗后文本应为空
- **AND** 跳过采集并返回 null

#### Scenario: 过滤重复内容

- **GIVEN** 用户连续发送相同内容
- **WHEN** 系统计算 fingerprint 并检查重复
- **THEN** 应检测到指纹冲突
- **AND** 跳过采集并返回 null

---

### Requirement: Source 标记

系统 MUST 在记忆中记录来源标识,区分手动创建、自动采集、输出摘要等不同来源。

#### Scenario: 输入采集标记

- **GIVEN** 通过自动采集创建记忆
- **WHEN** 设置记忆 source 字段
- **THEN** 应标记为 "auto" 或 "composer_send"

#### Scenario: 输出摘要标记

- **GIVEN** 通过融合写入创建记忆
- **WHEN** 设置记忆 source 字段
- **THEN** 应标记为 "assistant_output_digest"

#### Scenario: 手动创建标记

- **GIVEN** 用户在 UI 中手动创建记忆
- **WHEN** 设置记忆 source 字段
- **THEN** 应标记为 "manual"

---

### Requirement: 关联元数据

系统 MUST 记录 thread_id 和 message_id,支持记忆与对话上下文的双向关联。

#### Scenario: 记录 thread_id

- **GIVEN** 用户在 thread-123 中发送消息
- **WHEN** 系统创建记忆
- **THEN** 应设置 threadId="thread-123"
- **AND** 支持后续按 threadId 查询该对话的所有记忆

#### Scenario: 记录 message_id

- **GIVEN** assistant 回复的 message_id 为 "msg-456"
- **WHEN** 系统融合写入记忆
- **THEN** 应设置 messageId="msg-456"
- **AND** 支持从记忆跳转回原始消息
