## Context

协作首段通过 `shared_agent_request_run` 把 `request_text` 写进独立 squad worker binding（`squad:{runId}:{nodeId}:…`）。  
`request_text` 来自前端 `modelText`，现已 fan-in：skill 正文、记忆、便签、附图。  
主幕历史在 `itemsByThread[threadId]`，但 squad 路径从未读取。

## Goals / Non-Goals

- **Goals**: 主幕触发协作时，首段 model text **头部**追加主幕对话 digest；空历史无注入；不改交互与后续段。
- **Non-Goals**: binding 合并、Inspector UI、BE 新字段、全历史无 cap。

## Decisions

### D1. 纯前端 fan-in（无 BE 契约变更）

与 `injectCollabSkillContext` / `injectSelectedMemoriesContext` 同构：  
组装 block → prepend 到 `modelText` → 现有 `request_text` 管道直通首段 `build_stage_prompt`。

**理由**: 零 schema / 零 Rust 面；小手术。

### D2. 注入位置与顺序

```
【主幕对话上下文】
<main-canvas-context>
…digest…
</main-canvas-context>

（其后）skill / 记忆 / 便签 块（既有）
（最后）本轮用户可见原文 / 注入后的任务句
```

实现顺序（squad 路径）：

1. 先跑既有 skill / 记忆 / 便签注入（各自 prepend 到当前 `modelText`）
2. 最后 `injectMainCanvasContext({ userText: modelText, items })` —— 因该函数也是 **prepend**，主幕块落在最终 `modelText` **最前**

**理由**: 主幕历史是「环境」，应在任务与可选上下文之前；本轮任务保持在尾部，与 plan_prompt「用户任务：」语义兼容（整段仍在 request_text 内）。若先注入主幕再跑 skill，skill 的 prepend 会把主幕块挤到后面。

### D3. 材料选择与过滤

| 纳入 | 排除 |
|------|------|
| `kind==="message"` 且 `role` 为 user/assistant | tool / reasoning / fold / status 等 |
| 清洗后非空 `text` | `isCollabInternalPromptText` 命中、strip 后空 |
| 触发瞬间 **已有** items | 本轮尚未入 reducer 的 optimistic（通常未进 `itemsByThread`；若 id 以 `optimistic-user-` 开头亦跳过，避免竞态双计） |
| hist-fold 卡片 | `isMultiAgentHistFoldItemId` |

### D4. Budget

| 常量 | 值 | 作用 |
|------|-----|------|
| `MAX_TURN_CHARS` | 800 | 单轮正文 cap |
| `MAX_TOTAL_CHARS` | 6000 | digest 总 cap |
| `MAX_TURNS` | 24 | 从尾部向前取最近轮次（user+assistant 各算一轮消息） |

超限：从**最旧**消息丢弃，保留最近；单轮超 cap 硬截断 + `…`。

### D5. 可见气泡隔离

- `visibleUserText` / `visibleText` **绝不**含 digest。
- 仅 `modelText` / `request_text` 含块。
- 主幕 `emitCollabVisibleUserMessage` 仍用可见原文。

### D6. 不扩展 Inspector

本 change 不改 `buildStageInjectContext`。模型侧已有上下文即可；Inspector 可解释性后续另开。

## Risks / Trade-offs

| 风险 | 缓解 |
|------|------|
| 历史含旧协作 summary 噪声 | strip collab internal + fold 过滤 |
| digest 过大挤占 skill | 总 cap 6k；skill 仍在其后按自身 cap |
| `itemsByThread` 闭包陈旧 | 与现有 messaging 一致读 hook 快照；空则无注入（安全降级） |
| 用户误以为气泡含历史 | 不污染 visibleText |

## Migration

无。旧会话无字段依赖。

## Open Questions

无（范围已由产品定为方案 A 小手术）。
