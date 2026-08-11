---
type: index
status: active
---

# doge 文档中心

本目录承载架构解释、操作指南、实现参考、计划、研究与可复核 evidence。产品行为以当前代码和 OpenSpec 为准；`docs/**` 不承担 active backlog 或 code-level rule 的 single source of truth。

## 从这里开始

| 需求 | 入口 | 事实边界 |
|---|---|---|
| 产品能力、安装、命令、版本 | [`../README.md`](../README.md) | 当前产品入口 |
| 仓库规则与 delivery gate | [`../AGENTS.md`](../AGENTS.md) | 规则入口 |
| 行为契约与 change lifecycle | [`../openspec/`](../openspec/) | Behavior single source of truth |
| Frontend/backend 实现规范 | [`../.trellis/spec/`](../.trellis/spec/) | Code-level rule |
| 文档治理 | [`GOVERNANCE.md`](GOVERNANCE.md) | 分类、生命周期、索引与退役规则 |

## 当前文档

| 分区 | 索引 | 职责 |
|---|---|---|
| **Guides** | [`guides/README.md`](guides/README.md) | 可执行的 workflow、runbook 与 UI 指南 |
| **Reference** | [`reference/README.md`](reference/README.md) | 由源码校准的稳定术语、类型与 contract 说明 |
| **Analysis** | [`analysis/README.md`](analysis/README.md) | 当前系统链路分析、故障定位与专项 review |
| **Architecture** | [`architecture/README.md`](architecture/README.md) | Durable architecture 与治理策略 |
| **Performance** | [`perf/README.md`](perf/README.md) | Performance contract、baseline 与 runtime evidence |
| **Plans** | [`plans/README.md`](plans/README.md) | 有时间边界的 implementation plan |
| **Research** | [`research/README.md`](research/README.md) | 外部调研、spike 与设计输入，不代表 shipped behavior |
| **Reports** | [`reports/README.md`](reports/README.md) | 带日期的治理、影响与验收报告 |

## 历史文档

历史材料统一从 [`archive/README.md`](archive/README.md) 进入。归档表示正文停止维护，不表示历史结论曾经无效。

当前保留两个高 fan-out historical surface，避免无收益的大规模链接迁移：

- [`browser-agent/README.md`](browser-agent/README.md)：2026-06 Browser Dock 跨平台 evidence
- [`superpowers/README.md`](superpowers/README.md)：历史 agent plan/design mirror

## 按主题阅读

### 对话幕布与多 CLI 渲染

1. [`analysis/conversation-canvas-structure-2026-07-31.md`](analysis/conversation-canvas-structure-2026-07-31.md)
2. [`analysis/canvas-live-tool-projection-matrix-2026-08-01.md`](analysis/canvas-live-tool-projection-matrix-2026-08-01.md)
3. [`analysis/live-settle-assistant-tool-order-2026-08-04.md`](analysis/live-settle-assistant-tool-order-2026-08-04.md) — live settle 后结论文本落到工具前（Shared×Claude 已确认；跨 CLI 矩阵）
4. [`plans/2026-08-01-conversation-canvas-scroll-ownership-architecture.md`](plans/2026-08-01-conversation-canvas-scroll-ownership-architecture.md)
5. [`reference/conversation/conversation-curtain-contracts.md`](reference/conversation/conversation-curtain-contracts.md)
6. 历史单引擎链路见 [`archive/conversation-rendering/README.md`](archive/conversation-rendering/README.md)

### Provider、Shared Session 与多 CLI

- [`analysis/native-vs-shared-cli-explained.md`](analysis/native-vs-shared-cli-explained.md)
- [`analysis/native-session-provider-select-vs-disk-overwrite-2026-07-31.md`](analysis/native-session-provider-select-vs-disk-overwrite-2026-07-31.md)
- [`research/mossx-multi-cli-provider-session-foundation-design.md`](research/mossx-multi-cli-provider-session-foundation-design.md)
- [`reports/multi-cli-session-foundation-a-d-impact-and-manual-test-plan-2026-07-28.md`](reports/multi-cli-session-foundation-a-d-impact-and-manual-test-plan-2026-07-28.md)

### Project Memory

- [`research/00-project-memory-feature-overview.md`](research/00-project-memory-feature-overview.md)
- [`research/04-project-memory-consumption-research.md`](research/04-project-memory-consumption-research.md)
- Contract：`openspec/specs/project-memory-*/spec.md`
- Implementation：`src/features/project-memory/`、`src-tauri/src/project_memory/`

### Performance 与卡顿

- [`perf/README.md`](perf/README.md)
- [`analysis/cold-start-click-freeze-postmortem-2026-08-10.md`](analysis/cold-start-click-freeze-postmortem-2026-08-10.md) — 历史冷启动点击冻结的完整复盘与平台差异
- [`analysis/workspace-switch-session-catalog-performance-regression-2026-08-08.md`](analysis/workspace-switch-session-catalog-performance-regression-2026-08-08.md) — workspace navigation exhaustive catalog scan 根因、版本归因与闭环修复指南
- [`perf/render-jank-knife-experiments-2026-07-08.md`](perf/render-jank-knife-experiments-2026-07-08.md)
- [`perf/streaming-render-stall-design-2026-07-30.md`](perf/streaming-render-stall-design-2026-07-30.md)

### Workflow 与 UI

- [`guides/workflow/README.md`](guides/workflow/README.md)
- [`guides/ui/README.md`](guides/ui/README.md)

## 兼容入口

以下文件只保留 redirect stub，正文只在新路径维护：

- [`chat-canvas-conversation-curtain-contracts.md`](chat-canvas-conversation-curtain-contracts.md)
- [`codex-collaboration-mode-enforcement-runbook.md`](codex-collaboration-mode-enforcement-runbook.md)
- [`curated-skill-onboarding.md`](curated-skill-onboarding.md)
- [`openspec-trellis-playbook.md`](openspec-trellis-playbook.md)
- [`markdown-doc1-claude-chat-canvas-rendering.md`](markdown-doc1-claude-chat-canvas-rendering.md)
- [`markdown-doc2-codex-chat-canvas-rendering.md`](markdown-doc2-codex-chat-canvas-rendering.md)
- [`ui-ux/README.md`](ui-ux/README.md)

## Runtime 与 generated artifacts

- `banner.png` 是根 README 使用的 current screenshot，保持稳定路径
- `perf/*.json`、`architecture/*baseline*.json` 与 research harness evidence 是可重跑 artifact，由对应 Markdown owner 解释
- `.DS_Store`、临时导出、未被 owner 文档引用的截图不得进入 `docs/`
- 旧营销静态站已退役，记录见 [`archive/legacy-marketing-site/README.md`](archive/legacy-marketing-site/README.md)

## 维护入口

文档变更后运行：

```bash
npm run check:docs
```

该 gate 检查 local links、JSON、根索引可达性、section index、archive lifecycle 与 root allowlist。具体规则见 [`GOVERNANCE.md`](GOVERNANCE.md)。
---
type: index
status: active
---
