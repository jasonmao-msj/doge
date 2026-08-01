# Implementation Plans 索引

本目录保留不同阶段的实施计划。这里的「计划」是撰写时的路线快照，**不是**当前 active backlog，也不保证计划内容已全部落地。

当前状态请以 [`../../openspec/project.md`](../../openspec/project.md)、[`../../openspec/changes/README.md`](../../openspec/changes/README.md) 与 [`../../openspec/specs/README.md`](../../openspec/specs/README.md) 为准；产品与工程入口见 [`../../README.md`](../../README.md) 和 [`../../AGENTS.md`](../../AGENTS.md)。
文档总图：[`../README.md`](../README.md)。

## 状态图例（2026-08-01 代码/OpenSpec 对照）

| 标签 | 含义 |
|------|------|
| **历史快照** | 旧阶段路线；勿当现网任务队列 |
| **实现完成，待流程收口** | OpenSpec tasks 已完成；仍待 verify / sync / archive |
| **实现完成，待实机验收** | 自动化实现已完成；Human QA 尚未闭环 |
| **已入库（对码）** | 关键实现已在 main 线 commit；文可能仍写 PLAN 语气 |
| **DESIGN 正文** | 架构设计仍有效；实现状态另见文头 |

> 状态用于导航，**不替代** change verification。计数来自 2026-08-01 的 change `tasks.md`；后续以 `openspec list` 和 change artifacts 为准。

## 顶层计划快照

### 2026-08 幕布 / 滚动（优先）

| 文档 | 状态 | 备注 |
|------|------|------|
| [统一对话幕布架构改善](2026-08-01-unified-conversation-canvas-architecture.md) | **实现完成，待流程收口** | `23/23`；实现 `bf3b35bd6`；change 仍 active，待 verify/sync/archive |
| [共同幕布滚动所有权](2026-08-01-conversation-canvas-scroll-ownership-architecture.md) | **实现完成，待实机验收** + DESIGN 正文 | `23/26`；实现 `b34fdaead`；余 3 项均为 Human QA |

### 2026-07 多 CLI 基石

| 文档 | 状态 | 备注 |
|------|------|------|
| [多 CLI × 多 Provider 会话基石任务清单](2026-07-27-multi-cli-provider-session-foundation-task-checklist.md) | **A–D 已归档；后续修复另轨** | 设计 [research](../research/mossx-multi-cli-provider-session-foundation-design.md)；报告 [reports](../reports/multi-cli-session-foundation-a-d-impact-and-manual-test-plan-2026-07-28.md) |

### 2026-06

| 文档 | 状态 |
|------|------|
| [Browser Dock Phase 3](2026-06-01-browser-dock-phase3.md) | 历史计划；对应 change 已归档 |
| [Project Map Relationship Dashboard](2026-06-05-project-map-relationship-dashboard.md) | 历史计划；对应 change 已归档 |
| [Refine Project Map API Contract Detail View](2026-06-07-refine-project-map-api-contract-detail-view.md) | 历史计划；对应 change 已归档 |
| [Claude 供应商列表拖动排序](2026-06-20-claude-provider-drag-reorder.md) | 历史计划；供应商管理 change 已归档 |
| [Claude 供应商拉取模型列表](2026-06-20-claude-provider-fetch-models.md) | 历史计划；供应商管理 change 已归档 |

### 2026-05 及更早（顶层）

| 文档 | 状态 |
|------|------|
| [Context Ledger Then Task Center](2026-05-03-context-ledger-then-task-center-implementation.md) | 历史计划；两条能力均已有实现与归档 change |
| [Project Session Management Center](2026-04-19-project-session-management-center-implementation.md) | 历史计划；对应 change 已归档 |
| [Claude Compact Command Adaptation](2026-04-20-claude-compact-command-adaptation-implementation.md) | 历史计划；对应 change 已归档 |
| [Composer 弹窗问题修复](2026-02-10-composer-popup-fix.md) | 历史快照 |
| [Phase 2 路线图：项目记忆](2026-02-10-phase2-roadmap.md) | 历史快照 |
| [Unified Workspace Search](2026-02-10-unified-workspace-search.md) | 历史快照 |

## 已迁移的历史计划

- [Archived Plans Index](archived/README.md)

归档位置只表达**文档**生命周期，不替代 OpenSpec verification、测试证据或当前代码审计。

## 修订记录

| 日期 | 说明 |
|------|------|
| （既有） | 顶层列表 + archived 指针 |
| 2026-08-01 | Batch 1：状态图例；幕布/滚动/多 CLI 优先分组；链接 analysis/reports |
| 2026-08-01 | Batch 2：用 tasks 完成度、commit 与 archive 归宿替换粗粒度状态 |
