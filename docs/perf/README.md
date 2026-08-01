# Performance Documents

本目录保存 performance contract、诊断 runbook、阶段性计划与生成的 evidence artifact。入口先看 [`../README.md`](../README.md) 的事实边界：

- 当前实现事实以代码、manifest、OpenSpec main specs 和**重新运行**的 measurement 为准。
- 带版本号、日期、commit 或 branch 的 baseline / report 是当时快照，不自动代表当前 `HEAD`。
- `history/` 是只读历史锚点，完整索引见 [`history/README.md`](history/README.md)。
- 幕布**结构与默认旋钮**（尾窗/虚拟化/轻量墙下线）见 [`../analysis/`](../analysis/README.md)，勿只在本目录推断产品策略。

## 当前导航（contract / 诊断）

- [Runtime Evidence Gates](runtime-evidence-gates.md) — runtime evidence 的采集与 gate contract
- [Budget Decision Table](budget-decision-table.md) — performance budget 与判定口径
- [Parallel Conversation Jank Index](parallel-conversation-jank-index.md) — historical/reusable 诊断入口；原 P0 change 已归档
- [Parallel Conversation Jank Handbook](parallel-conversation-jank-handbook.md) — 先留 evidence 再 Settings Reset；七类 residual 不是当前 backlog
- [Render Jank Knife Experiments (2026-07-08)](render-jank-knife-experiments-2026-07-08.md) — 有日期的实验记录；其中数值不是永久基线（AGENTS 仍引用其四层根因框架）
- [A4 Live Text Externalization Plan](a4-live-text-externalization-plan.md) — 已实现的 live-text 旁路；2026-07-30 演进为 accumulated/published 分离 + 48ms cadence
- [Streaming Render Stall Design (2026-07-30)](streaming-render-stall-design-2026-07-30.md) — 已实现 `1537211a1`；OpenSpec `17/17`，待流程收口；idle virtualization 后续由 `4e932e672` 恢复

## 与 0.7.x 幕布相关（交叉，非本目录全文）

| 主题 | 文档 |
|------|------|
| 现网幕布性能旋钮 | [analysis conversation-canvas §7](../analysis/conversation-canvas-structure-2026-07-31.md) |
| 滚动所有权 / A 飞顶 F 离底 | [scroll ownership plan](../plans/2026-08-01-conversation-canvas-scroll-ownership-architecture.md) |
| 统一幕布（砍摘要墙） | [unify plan](../plans/2026-08-01-unified-conversation-canvas-architecture.md) · commit `bf3b35bd6` |

## 阶段性快照（版本叙事）

以下文档按文件内 version、timestamp、commit 与验收窗口解读——**均为历史阶段，不是 0.7.14 现测**：

- [Jank Fix Progress](jank-fix-progress.md)
- [v0.5.8 Performance Optimization Roadmap](v0.5.8-performance-optimization-roadmap.md)
- [v0.5.10 Performance Closure](v0.5.10-performance-closure.md)
- [v0.5.14 Curated Skill Baseline](v0.5.14-curated-skill-baseline.md)
- [v0.5.14 Evidence Acceptance](v0.5.14-evidence-acceptance.md)
- [v0.5.14 UX Jank Acceptance](v0.5.14-ux-jank-acceptance.md)

## Baseline Artifact 角色

- [`baseline.md`](baseline.md) / `baseline.json` 是历史 aggregate snapshot：v0.5.11、branch `feature/v0.5.11`、commit `9a2c9f4a…`，生成于 2026-06-18。它们**不是**当前 **0.7.x** `HEAD` 的测量结果（产品版本会漂移，以 `package.json` 为准）。
- `history/v<version>-baseline*.{md,json}` 是带版本或 timestamp 的历史锚点。
- 根目录 `*-baseline.json` fragment 是 producer output，由 `scripts/perf-aggregate.mjs` 聚合；读取前必须核对 artifact 内 metadata。

## Schema

由 `scripts/perf-aggregate.mjs` 生成的 aggregate / fragment artifact 使用 `schemaVersion: "1.0"`；consumer 必须先检查 major version。常见 metric 字段包括：

- `scenario`：稳定场景 id，例如 `S-LL-200`、`S-CS-COLD`
- `metric`：OpenSpec design 定义的稳定 metric 名
- `value`：数值；当前平台不支持时为 `null`
- `unit`：metric unit
- `notes`：可选上下文
- `unsupportedReason`：`value` 为 `null` 时必填

[`v0.5.14-baseline.json`](v0.5.14-baseline.json) 不是上述 aggregate schema：它的 `source` 明确为 `TEMPORARY-EMPTY-PLACEHOLDER`，metric 值尚未回填，不能作为当前 performance evidence。

## 历史来源

初始 runtime baseline change 已归档：

- [proposal](../../openspec/changes/archive/2026-05-15-add-runtime-perf-baseline/proposal.md)
- [design](../../openspec/changes/archive/2026-05-15-add-runtime-perf-baseline/design.md)
- [verification](../../openspec/changes/archive/2026-05-15-add-runtime-perf-baseline/verification.md)

新 optimization proposal 引用历史 baseline 时，必须同时写明 version、timestamp/commit、scenario/metric row 与可接受的 regression/improvement bound；若结论用于当前分支 gate，应先重新采样。

## 修订记录

| 日期 | 说明 |
|------|------|
| （既有） | contract / 阶段性快照 / baseline 角色 |
| 2026-08-01 | Batch 1：去掉「当前 0.7.5 HEAD」误指；交叉 analysis/scroll/unify；强调 0.7.x 重测 |
| 2026-08-01 | Batch 4：校准 A4/streaming/render-jank 的落地状态、48ms cadence、deferred/transition 与 idle virtualization 现状 |
| 2026-08-01 | Review 补漏：给 v0.5.8/v0.5.10/v0.5.14 与空白 jank worksheet 补 direct-open lifecycle，阻止旧 proxy/placeholder 被当 current evidence |
