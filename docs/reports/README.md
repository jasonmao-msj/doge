# reports — 治理 / 影响 / 验收报告索引

> **用途**：带日期的审计、影响明细、人工测试计划、闭环记录。
> **不是** active backlog；不是当前代码行为 single source of truth。
> **原则**：全文保留过程；文头写清基线分支/commit；落地结论以文内「复核」段 + Git 为准。
> **上级导航**：[`../README.md`](../README.md)

## 怎么读

1. 先看文头 **日期 / 基线 commit / 文档性质**。
2. 文内「已修复 / 已闭环」只对**该复核窗口**负责；跨大版本需重新核对符号。
3. 若报告引用 OpenSpec change，优先打开 `openspec/changes/` 或 `archive/` 核对是否仍 active。

## 报告清单

| 文档 | 生命周期 | 当前用途 / 边界 |
|------|----------|-----------------|
| [client-aux-modules-governance-report-2026-07-25.md](./client-aux-modules-governance-report-2026-07-25.md) | historical snapshot | 保存 2026-07-25～26 综合审计；残余债项须重新对码后才可进 backlog |
| [composer-prompt-stack-optimization-impact-2026-07-25.md](./composer-prompt-stack-optimization-impact-2026-07-25.md) | historical closure evidence | 保存四批落地与 commit；不代表当前 Composer 完整现状 |
| [search-navigation-optimization-impact-2026-07-25.md](./search-navigation-optimization-impact-2026-07-25.md) | historical / evolved | 作为搜索职责演进证据；当前实现从 `SearchPalette` / `useUnifiedSearch` 重扫 |
| [engineering-toolchain-optimization-impact-2026-07-25.md](./engineering-toolchain-optimization-impact-2026-07-25.md) | historical closure evidence | 证明当时目标闭环；large-file 与 governance gates 必须在当前 HEAD 重跑 |
| [engine-model-access-layer-governance-report-2026-07-26.md](./engine-model-access-layer-governance-report-2026-07-26.md) | historical closure evidence | 当时引擎/模型治理；当前 registry 为六引擎，以 matrix 与生成 gate 为准 |
| [multi-cli-session-foundation-a-d-impact-and-manual-test-plan-2026-07-28.md](./multi-cli-session-foundation-a-d-impact-and-manual-test-plan-2026-07-28.md) | A–D archived evidence | release smoke 参考；后续 active repairs 以各自 change 为准 |
| [grok-cli-capability-gap-vs-claude-codex-2026-07-30.md](./grok-cli-capability-gap-vs-claude-codex-2026-07-30.md) | implemented，待流程收口 | 图片输入 change `25/25`，仍 active，待 verify / sync / archive |

## 与其它目录的关系

| 需要… | 去 |
|--------|-----|
| 幕布现网结构 | [`../analysis/`](../analysis/README.md) |
| 多 CLI 架构设计 | [`../research/mossx-multi-cli-provider-session-foundation-design.md`](../research/mossx-multi-cli-provider-session-foundation-design.md) |
| 任务清单快照 | [`../plans/2026-07-27-multi-cli-provider-session-foundation-task-checklist.md`](../plans/2026-07-27-multi-cli-provider-session-foundation-task-checklist.md) |
| large-file 策略 | [`../architecture/`](../architecture/README.md) |

## 维护

- 新增报告：文件名带日期；文头必填基线；本表加一行。
- 禁止把已合并进本目录前的「原始三份碎片报告」文件名当仍存在路径（若文内引用已合并源，保留作溯源说明即可）。
- 报告新增结论时，追加「当前校准」而非覆盖原始窗口；若只是新现网事实，应进入 Reference/ADR/OpenSpec，而不是继续拉长历史报告。

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-01 | Batch 1：新建索引；七份报告归位与读法 |
| 2026-08-01 | Batch 5：逐篇标记 lifecycle 与 current use；记录 A–D archive、六引擎边界、Grok image `25/25` |
