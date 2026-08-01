# Research 文档索引

本目录保存技术调研、架构分析、运行手册与阶段性 evidence。研究结论和带日期的报告是生成当时的时间快照，不是当前 backlog 或当前代码行为的 single source of truth。

当前事实入口：[`../../README.md`](../../README.md)、[`../../AGENTS.md`](../../AGENTS.md)、[`../../openspec/project.md`](../../openspec/project.md)、[`../../openspec/changes/README.md`](../../openspec/changes/README.md)。
文档总图：[`../README.md`](../README.md)。

## Project Memory 研究链

- [项目记忆功能全景（Phase 1 完成版）](00-project-memory-feature-overview.md) — historical foundation；文首有 2026-08 current delta
- [项目记忆功能设计方案](01-project-memory-design.md) — historical design；现行 contract 转 OpenSpec
- [MemOS 架构分析](02-memos-architecture-analysis.md) — external snapshot @ `a1e23d54d2`，未声明 upstream latest
- [项目记忆模块架构设计图](03-project-memory-architecture.md) — Phase 1 图；旧单文件 backend 已显式标注
- [项目记忆消费机制研究](04-project-memory-consumption-research.md) — historical proposal；显式 Memory Reference / Retrieval Pack 已补 current delta

相关历史实施计划见 [`../plans/`](../plans/README.md) 与 `plans/archived/`。

## 多 CLI × 多 Provider 会话基石

- [多 CLI × 多 Provider 会话基石架构设计](mossx-multi-cli-provider-session-foundation-design.md) — accepted ADR；A–D 已归档，文首含六引擎 / Shared 五引擎校准
- [新 CLI 接入指南](mossx-new-cli-onboarding-guide.md) — current How-to；区分概念角色与真实 registry/Rust/capability/live/history/Shared 注册面

实施 backlog 以 OpenSpec 为准；任务清单快照：[plans/…](../plans/2026-07-27-multi-cli-provider-session-foundation-task-checklist.md)；A–D 影响与手测：[reports/…](../reports/multi-cli-session-foundation-a-d-impact-and-manual-test-plan-2026-07-28.md)。
供应商 UI 契约（Native/Shared）：[analysis native-session](../analysis/native-session-provider-select-vs-disk-overwrite-2026-07-31.md)。

## Spikes（2026-07-27）

| Spike | 文档 | Harness |
|-------|------|---------|
| S1 Codex thread inject items | [spikes/2026-07-27-s1-codex-thread-inject-items.md](./spikes/2026-07-27-s1-codex-thread-inject-items.md) | [harness/s1-…](./spikes/harness/s1-codex-inject-items/evidence/README.md) |
| S2 Claude replay user messages | [spikes/2026-07-27-s2-claude-replay-user-messages.md](./spikes/2026-07-27-s2-claude-replay-user-messages.md) | [harness/s2-…](./spikes/harness/s2-claude-replay-ack/evidence/README.md) |
| S3 Kimi ACP | [spikes/2026-07-27-s3-kimi-acp.md](./spikes/2026-07-27-s3-kimi-acp.md) | [harness/s3-…](./spikes/harness/s3-kimi-acp/README.md) |

Spike 结论是**探测当时**能力边界；现网引擎行为以代码 + OpenSpec 为准。

## 插件市场 / Obsidian / Pi（调研）

| 文档 | 主题 |
|------|------|
| [mossx-plugin-market-and-cli-foundation-design.md](./mossx-plugin-market-and-cli-foundation-design.md) | **Exploratory RFC**；现网无 generic plugin runtime / marketplace，行业事实须在立项时重验 |
| [obsidian-plugin-runtime-architecture.md](./obsidian-plugin-runtime-architecture.md) | external snapshot；API 面，2026-08-01 复核边界 |
| [obsidian-plugin-marketplace-governance.md](./obsidian-plugin-marketplace-governance.md) | external current-state；2026-05 Community 新治理链 |
| [obsidian-plugin-distribution-dev-experience.md](./obsidian-plugin-distribution-dev-experience.md) | historical；2026-02 旧 registry 模型，文头已补 2026-05 演进 |
| [obsidian-security-trust-model-analysis.md](./obsidian-security-trust-model-analysis.md) | external security snapshot；已交付与 announced roadmap 分离 |
| [pi-architecture-plugin-marketplace-analysis.md](./pi-architecture-plugin-marketplace-analysis.md) | exploratory comparative design；pi evidence 锚定 `a9f5b1c123` |
| [pi-chat-orchestration-research.md](./pi-chat-orchestration-research.md) | external snapshot；复用前重验 upstream revision |

以上均为**外部/对比调研或前瞻设计**，不表示 mossx 已完整实现同款模型。

## 开发运行手册

- [桌面开发版快速启动 Runbook](desktop-dev-fast-start-runbook.md)

执行前核对当前 `package.json`、仓库脚本和平台环境。

## Realtime CPU evidence

- [Baseline Report](realtime-cpu/baseline-report.md)
- [Acceptance Report](realtime-cpu/acceptance-report.md)
- [Rollout and Rollback SOP](realtime-cpu/rollout-rollback-sop.md)

Baseline / acceptance 只证明对应采样窗口；是否满足当前性能 gate，应以新的 runtime evidence 与 [`../perf/`](../perf/README.md) 为准。

## 修订记录

| 日期 | 说明 |
|------|------|
| （既有） | memory / multi-cli / runbook / realtime-cpu |
| 2026-08-01 | Batch 1：补 spikes、插件/Obsidian/Pi 列表；交叉 analysis/reports/plans |
| 2026-08-01 | Batch 3：校准 multi-cli ADR 与 onboarding 真实注册面；给 plugin-market RFC 增加现网边界和行业时效声明 |
| 2026-08-01 | Batch 3 补审：修正 Obsidian 2026-02 分发模型的时效漂移；给四份 Obsidian / 两份 Pi 调研补 source revision 与 lifecycle 边界 |
| 2026-08-01 | Batch 3 补审：校准 Project Memory 五篇研究/设计；Phase 1 历史与当前 consumption/retrieval/health 架构分层 |
