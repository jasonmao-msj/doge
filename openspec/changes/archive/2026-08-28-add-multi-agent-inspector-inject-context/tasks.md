## 1. View-model

- [x] 1.1 [P0] 新增 `buildStageInjectContext` 纯函数（projection + stageIndex → sections/pipe/summary/count）；覆盖首段/中段/有无 approvalNote/有无 role；单测。

## 2. UI

- [x] 2.1 [P0] 实现 `StageInjectContextHeader`：默认折叠、展开迷你步进器（紧凑档）、清单/溯源切换、分区 clamp、点击高亮与可选 `selectAgentStage`。
- [x] 2.2 [P0] 挂入 `AgentInspectorDrawer`（meta-bar 与 canvas 之间）；无 sections 时不渲染 Header。

## 3. Style / i18n

- [x] 3.1 [P0] `multi-agent.css` 增加 `ma-inject-*`（对齐 preview 紧凑步进器）。
- [x] 3.2 [P0] 全 locale `multiAgent.inspector.inject.*` + parity。

## 4. Gates

- [x] 4.1 [P0] focused Vitest + locale parity；手测：折叠默认、展开 B+C、note/上游分区、跳 stage。
- [x] 4.2 [P0] OpenSpec change review 自检与 tasks 勾选。
- [x] 4.3 [P0] review follow-up：迷你条/溯源只高亮；「打开节点」才跳 stage；flash timer cleanup；noteMeta/upstreamMeta 文案；locale parity。
