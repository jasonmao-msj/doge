## Context

协作 Inspector（`AgentInspectorDrawer`）当前结构：

```
header（节点名 / badge / target）
meta-bar（轮次 + 卡片 pager）
body → Messages（节点输出）
```

Projection 已具备组装注入清单所需字段：`userVisibleText` / `requestText`、`approvalNote`、`plan`、`stages[].shortOutcome|rolePrompt|status`。完整 worker prompt 运行时拼装、不落盘——UI 只做结构化清单。

Preview 已定稿：`docs/previews/multi-agent-inspector-context-header-schemes.html` 方案 **B+C**（默认折叠、紧凑迷你步进器）。

## Goals / Non-Goals

**Goals:**

- 节点输出上方展示可折叠「注入上下文」。
- 展开：迷你流水线 + `内容清单 | 上下文溯源` 切换。
- 默认折叠；空分区不渲染。
- 纯前端 view-model + 展示，不改后端 fact。

**Non-Goals:**

- assembled prompt 归档。
- persona 正文上幕。
- 编排 / 批准 / 主幕叙事变更。

## Decisions

### 1. 组件拆分

| 模块 | 职责 |
|------|------|
| `buildStageInjectContext(projection, stageIndex)` | 纯函数 view-model |
| `StageInjectContextHeader` | 折叠壳 + 迷你步进器 + 清单/溯源 panes |
| `AgentInspectorDrawer` | 在 meta-bar 与 canvas 之间挂载 Header |

**备选**：全塞进 Drawer —— 否决，难测且难复用。

### 2. View-model 字段

```ts
type InjectSectionId = "user" | "approvalNote" | "upstream" | "role";

type InjectSection = {
  id: InjectSectionId;
  kind: InjectSectionId;
  titleKey: string;       // i18n key fragment
  body: string;
  metaKey?: string;       // optional secondary line
  upstreamStageId?: string; // for jump
};

type InjectPipeNode = {
  id: string;
  sectionId: InjectSectionId;
  labelKey: string;
  status: "done" | "current" | "pending";
  jumpStageId?: string | null;
};

type StageInjectContext = {
  sections: InjectSection[];
  pipe: InjectPipeNode[];
  summaryLine: string; // one-line collapsed preview
  itemCount: number;
};
```

组装规则：

| 分区 | 条件 | 内容 |
|------|------|------|
| user | 总有（trim 后非空） | `userVisibleText ?? requestText` |
| approvalNote | `approvalNote` 非空且当前非仅 plan 首段无后续依赖时：对 **非首段或任意已批准 run** 展示；简化：note 非空即展示（含 plan 卡也可看「将会注入」） | note 原文 |
| upstream | `stageIndex > 0` | 优先 `plan.summary` 或 plan.markdown 截断；叠加直接前序 `shortOutcome`（若有） |
| role | `rolePrompt` 非空 | rolePrompt；**不含** personaPrompt |

流水线节点：用户 →（若有）已成功前序 stages →（若有）批准补充 → 当前。当前节点 status=`current`；前序 succeeded=`done`。

### 3. 交互

- 默认 `expanded=false`（local UI state per mount；切 stage 可保持用户展开偏好或重置——**选定：切 stage 保留 expanded，但 pane 回到 list**）。
- 迷你步进 / 溯源卡片 click：
  1. pane → list
  2. flash 对应 section
  3. 若 `jumpStageId` 且 ≠ 当前 → `selectAgentStage(jumpStageId)`
- 上游全文：section body 默认 clamp 3 行 + 展开按钮（仅 body 超长时）。

### 4. 样式

- 类前缀 `ma-inject-*`，落 `multi-agent.css`。
- 迷你步进器参数对齐 preview 紧凑档：节点 16px、标签 9px、内边距 6–8px。
- 不引入新 CSS 依赖。

### 5. i18n

`multiAgent.inspector.inject.*`：title、summary 占位、section 标签、pane 名、expand/collapse、empty 不展示（无 empty 文案）。

全 locale 同步 + parity test。

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| 用户以为看到完整 prompt | 文案用「注入上下文」/ 结构化标签，不写 system prompt |
| 展开占高度 | 默认折叠 + 紧凑步进器 |
| plan.markdown 很长 | clamp + 可选展开；截断常量可复用 short 上限意识（UI 侧 ~500 字预览即可） |
| 切 stage 状态错乱 | key 绑 `runId:stageId` 重置 flash；expanded 可选保留 |

## Migration Plan

- 纯 UI 增量；无数据迁移。
- 回滚：移除 Header 组件挂载即可。

## Open Questions

- 无（默认折叠、B+C、不落 prompt 已确认）。
