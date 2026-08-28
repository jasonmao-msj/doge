## MODIFIED Requirements

### Requirement: Inspector display contracts SHALL isolate stage stories

系统 MUST 保证头与幕布「两套故事」一致：徽章对齐本段 target；
非 plan 段禁止用 plan.markdown；canvas key 带 `shared:` 前缀 attempt 隔离。
在此基础上，Inspector MUST 在 stage 输出幕布上方提供可折叠的注入上下文 Header（详见 capability `multi-agent-inspector-inject-context`），且该 Header 使用 plan/上游摘要时 MUST NOT 将 plan.markdown 写入非 plan 段的 **输出幕布** 正文。

#### Scenario: contract 2 non-plan stage must not use plan.markdown

- **WHEN** Inspector 为 implement 或 review 段构造 settle fallback 正文
- **THEN** 系统 MUST NOT 读取 `projection.plan.markdown`
- **AND** MUST 仅使用本 stage 的 fullOutcome / shortOutcome / liveText

#### Scenario: contract 2 plan stage may use plan.markdown

- **WHEN** Inspector 为 plan 段构造 settle fallback 且 plan.markdown 非空
- **THEN** 系统 MAY 使用 plan.markdown 作为正文候选

#### Scenario: contract 3 canvas key uses shared prefix

- **WHEN** 协作节点写入或读取 attempt-scoped canvas
- **THEN** threadId MUST 形如 `agent-canvas:shared:<uuid>:<attemptId>`
- **AND** 解析 MUST 还原 `sharedThreadId` 以 `shared:` 开头

#### Scenario: contract 4 persona line is target plus optional agent name

- **WHEN** Inspector 卡片头渲染 `stageInspectorTypeLine`
- **THEN** 输出 MUST 含引擎/模型目标标签
- **AND** 若存在 `personaAgentName`，MUST 以 ` · 智能体 {name}` 追加
- **AND** persona MUST NOT 改写 stage.target

#### Scenario: contract 4 persona body is injected to CLI but hidden on canvas

- **WHEN** 协作节点绑定了客户端智能体且 `personaPrompt` 非空
- **THEN** 该 stage worker prompt MUST 包含智能体正文（先于本步 `rolePrompt`）
- **AND** 主幕 / Inspector 卡片 MUST NOT 渲染智能体正文
- **AND** 展示层 MAY 仅显示 persona icon 与 name

#### Scenario: inject-context header may reference plan summary without polluting canvas

- **WHEN** 非 plan 段 Inspector 展开注入上下文 Header
- **THEN** Header 的上游分区 MAY 展示 `plan.summary` 或截断后的 plan 文本作为「注入来源」
- **AND** Messages 输出幕布正文 MUST 仍遵守 contract 2（不得因 Header 而把 plan.markdown 写入非 plan 段 canvas）
