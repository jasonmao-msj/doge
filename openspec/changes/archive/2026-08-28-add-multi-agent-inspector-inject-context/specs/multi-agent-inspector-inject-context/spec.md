## Purpose

协作节点 Inspector 在输出幕布上方提供「注入上下文」Header：结构化展示本节点消费的用户任务、批准补充、上游产出与本环节指令，支持默认折叠与溯源视图。

## ADDED Requirements

### Requirement: Inspector SHALL show a collapsible inject-context header above stage output

系统 MUST 在协作右侧 Inspector 的 stage 输出（Messages 幕布）上方渲染「注入上下文」Header。

#### Scenario: default collapsed

- **WHEN** 用户打开某节点 Inspector 且该节点存在可展示注入项
- **THEN** Header MUST 默认处于折叠态
- **AND** MUST 显示一行摘要与注入项数量（或等价计数）
- **AND** MUST NOT 默认展开分区正文，以免挤压输出区

#### Scenario: expand reveals B+C surfaces

- **WHEN** 用户展开 Header
- **THEN** 系统 MUST 显示紧凑迷你流水线（用户 → 上游/批准 → 当前）
- **AND** MUST 提供「内容清单」与「上下文溯源」两种视图切换
- **AND** 内容清单 MUST 以分区形式展示非空注入项

#### Scenario: empty sections are omitted

- **WHEN** 某类注入数据为空（例如无 `approvalNote`、无 rolePrompt、首段无上游）
- **THEN** 对应分区 MUST NOT 渲染
- **AND** 迷你流水线 MUST NOT 为纯空占位制造虚假节点（可选节点仅在有数据或语义需要时出现）

### Requirement: Inject sections SHALL be derived from projection fields only

系统 MUST 仅使用 projection / stage 已有字段组装注入清单，禁止伪造完整 worker prompt。

#### Scenario: user task section

- **WHEN** `userVisibleText` 或 `requestText` 非空
- **THEN** 清单 MUST 包含用户任务分区，优先 `userVisibleText`

#### Scenario: approval note section

- **WHEN** `projection.approvalNote` 非空
- **THEN** 清单 MUST 包含批准补充分区展示其原文

#### Scenario: upstream section for non-first stages

- **WHEN** 当前 stage 不是 stages 数组首项
- **THEN** 清单 MUST 包含上游分区
- **AND** 内容 MUST 来自 plan 摘要/markdown 截断和/或直接前序 stage 的 shortOutcome
- **AND** MUST NOT 用其他 stage 的 fullOutcome 冒充本节点输出（仍遵守 orchestration display isolation）

#### Scenario: role section without persona body

- **WHEN** 当前 stage 的 `rolePrompt` 非空
- **THEN** 清单 MUST 展示本环节指令
- **AND** MUST NOT 渲染 `personaPrompt` 正文

### Requirement: Provenance interactions SHALL link pipe nodes to sections and stages

系统 MUST 支持从迷你流水线或溯源视图定位到对应分区，并在适用时跳转上游节点卡。

#### Scenario: pipe click highlights section

- **WHEN** 用户在展开态点击迷你流水线中的某节点
- **THEN** 视图 MUST 切换到内容清单（若当前在溯源）
- **AND** 对应分区 MUST 获得可见高亮反馈

#### Scenario: upstream stage jump

- **WHEN** 用户点击代表上游 stage 的流水线/溯源节点且该节点绑定了 stageId
- **THEN** 系统 MAY 调用既有 `selectAgentStage` 切换到该节点卡
- **AND** MUST NOT 打开新路由或离开当前 conversation host
