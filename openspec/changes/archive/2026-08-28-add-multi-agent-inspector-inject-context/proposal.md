## Why

协作右侧节点 Inspector 目前只展示「身份 + 轮次 + 节点输出」，用户无法在幕布侧看到本节点**吃了什么上下文**（用户任务、批准补充、上游产出、本环节指令）。批准补充链路已落地，但可解释性仍断在 Inspector 顶部，排错与理解协作链路成本高。

## 目标与边界

- 在每个节点幕布**上方**增加「注入上下文」Header（方案 **B+C**：折叠分区清单 + 迷你流水线溯源 + 清单/溯源切换）。
- **默认折叠**，一行摘要；展开后显示紧凑迷你步进器与分区内容。
- 只读 `AgentProjectionV1` / stage 字段做**结构化注入清单**；不假装展示完整 worker system prompt（projection 一般不落盘 assembled prompt 原文）。
- 空分区不渲染；切换 stage/round 时摘要与分区随当前节点重算。

## What Changes

- `AgentInspectorDrawer`：在 meta-bar 与 Messages 幕布之间插入 Inject Context Header（B+C）。
- 纯前端 view-model：从 projection 组装用户任务、`approvalNote`、上游 stage shortOutcome / plan 摘要、本环节 `rolePrompt`（persona 正文仍不渲染）。
- 迷你流水线：紧凑步进器 UI；点击节点 → 切到「内容清单」并高亮对应分区；上游 stage 节点 MAY 触发 `selectAgentStage`。
- i18n（全 locale multiAgent.inspector.inject*）+ CSS（`multi-agent.css`）。
- 聚焦单测：view-model 组装、空项过滤、默认折叠。

## 非目标

- 不归档/不暴露完整 worker prompt 原文到 projection（若未来需要另开 change）。
- 不改模板、批准点配置、编排调度、主幕叙事。
- 不重做 hang 恢复条 / 超时卡。
- 不把 persona 正文展示到幕布（仍仅 CLI 注入）。

## 方案取舍

| 选项 | 说明 | 取舍 |
|------|------|------|
| A 芯片条 | 高度最低 | 信息过碎，批准补充难扫读 |
| **B+C（选定）** | B 折叠清单 + C 迷你/全高溯源 | 默认可收起；需要时解释「吃了谁」 |
| C 纯流水线 | 溯源强 | 默认占高，role 长文弱 |
| D sticky+抽屉 | 零高度 | 多一次点击，z-index 叠层 |

选定 **B+C，默认折叠**；迷你流水线用紧凑步进器（16px 节点，已在 preview 收敛）。

## Capabilities

### New Capabilities

- `multi-agent-inspector-inject-context`: 协作节点 Inspector 注入上下文 Header 的展示、折叠、溯源切换与数据契约。

### Modified Capabilities

- `multi-agent-orchestration`: 补充 Inspector 在输出幕布上方 MUST 提供可折叠注入上下文（与既有 display contracts 对齐，不破坏 stage 隔离）。

## Impact

- Frontend: `src/features/multi-agent/components/AgentInspectorDrawer.tsx`、新增 inject-context 组件/utils、`src/styles/multi-agent.css`、`src/i18n/locales/*/multiAgent.ts`
- Preview 参考：`docs/previews/multi-agent-inspector-context-header-schemes.html`
- 无新依赖；无后端 fact schema 变更（复用 `requestText` / `userVisibleText` / `approvalNote` / `plan` / stage outcomes / `rolePrompt`）

## 验收标准

- 待批/实现/审查各节点：Header 可见且**默认折叠**；展开后有迷你流水线 + 清单/溯源切换。
- 有 `approvalNote` 的后续段展开后可见「批准补充」分区；无 note 时该分区不出现。
- 首段不展示「上游」空态；中间/末段展示上游摘要（plan 或前序 shortOutcome）。
- 点迷你步进节点 → 清单高亮对应分区；点上游 stage → 可跳转该 stage 卡。
- `multiAgentLocaleParity` 与相关单元测试通过；不引入 projection 假 prompt 字段。
