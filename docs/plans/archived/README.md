# Archived Plans Index

本目录用于存放**已完成并归档**的计划文档，避免主 `docs/plans/` 被历史计划干扰。

> 本索引记录**文档**归档状态，不是当前代码事实或 verification 证明。当前 backlog 与行为规范以 [`../../../openspec/project.md`](../../../openspec/project.md)、[`../../../openspec/changes/README.md`](../../../openspec/changes/README.md) 和 [`../../../openspec/specs/README.md`](../../../openspec/specs/README.md) 为准。
> 上级：[`../README.md`](../README.md) · 总图 [`../../README.md`](../../README.md)

## 归档规则

1. 计划对应代码已落地（或明确终止且有结论）。
2. 验证结果已记录（至少包含 typecheck / tests 结论）。
3. 路线图与研究文档中的引用已切换到归档路径。

## 命名规范

- 保留原文件名：`YYYY-MM-DD-<topic>.md`
- 不重命名，保证历史可追溯。

## 当前归档清单

- [Memory Auto Capture ABCD Implementation Plan](2026-02-10-memory-auto-capture-abcd-implementation.md)
- [记忆落盘结构改造](2026-02-10-memory-storage-restructure.md)
- [修复 note 未清理与 engine tag](2026-02-10-fix-note-cleanup-and-engine-tag.md)
- [Phase 2.1 项目记忆消费注入 MVP](2026-02-10-phase2-memory-consumption-mvp-implementation-plan.md)
- [自动写入记忆标签化 MVP](2026-02-10-auto-memory-tagging-mvp.md)
- [记忆 Kind 自动分类修复](2026-02-11-memory-kind-classification-fix.md)
- [Phase 2.1 项目记忆上下文注入 MVP](2026-02-11-phase2.1-memory-context-injection-mvp.md)

## 维护建议

- 新计划先放 `docs/plans/`，完成后再迁移到本目录。
- 每次归档后，更新：
  - [`../README.md`](../README.md)
  - 本 README 的“当前归档清单”。
