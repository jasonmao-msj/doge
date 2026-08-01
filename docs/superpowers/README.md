# superpowers — agent 任务 plan / design 镜像

> **用途**：历史上给 agentic worker 用的 **implementation plan / design** 落盘（checkbox 任务体）。
> **Canonical 规则**：若文内写明 OpenSpec design 路径，**以 OpenSpec 为准**，本目录避免双份漂移。
> **上级导航**：[`../README.md`](../README.md)

## plans/

| 文档 | 主题 | 注意 |
|------|------|------|
| [2026-04-16-sidebar-cache-implementation.md](./plans/2026-04-16-sidebar-cache-implementation.md) | Sidebar cache 实施任务 | 历史计划；落地与否查代码/OpenSpec |
| [2026-07-21-messages-presentation-architecture.md](./plans/2026-07-21-messages-presentation-architecture.md) | Messages presentation 架构拆分任务 | **已归档**；checkbox 保留原始 agent plan，不是 active backlog |

## specs/

| 文档 | 主题 | 注意 |
|------|------|------|
| [2026-04-16-sidebar-cache-design.md](./specs/2026-04-16-sidebar-cache-design.md) | Sidebar cache 设计 | 历史 |
| [2026-07-21-messages-presentation-architecture-design.md](./specs/2026-07-21-messages-presentation-architecture-design.md) | Messages presentation 设计摘要 | canonical change 已归档于 `2026-07-21-refactor-messages-presentation-architecture` |
| [2026-07-30-shared-cli-creation-runtime-contract-repair-design.md](./specs/2026-07-30-shared-cli-creation-runtime-contract-repair-design.md) | Shared CLI 创建与 runtime 契约修复 | OpenSpec `7/7`，仍 active，待 verify / sync / archive |

## 与 analysis / messages 现网

幕布**现网结构**与统一幕布后验：

- [`../analysis/conversation-canvas-structure-2026-07-31.md`](../analysis/conversation-canvas-structure-2026-07-31.md)
- [`../analysis/README.md`](../analysis/README.md)

本目录 **不**替代 analysis；presentation 重构 plan 描述的是目录/边界搬迁，不是 2026-08 轻量墙/Grok 桥产品决策。

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-01 | Batch 1：新建索引；标明 OpenSpec canonical 优先 |
| 2026-08-01 | Batch 6：校准 presentation archive 归宿；记录 Shared CLI repair `7/7` active closure 状态 |
