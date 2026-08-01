# 项目文档导航（docs/）

本目录收录架构说明、实施计划、研究记录、性能证据、分析过程与专项手册。

## 事实边界（先读）

| 层级 | 位置 | 用途 |
|------|------|------|
| 产品入口 | [`../README.md`](../README.md) | 当前能力、命令、版本 |
| 规则与 gate | [`../AGENTS.md`](../AGENTS.md) | PlanFirst、OpenSpec/Trellis、merge 红线 |
| 行为契约 | [`../openspec/`](../openspec/) | active changes / main specs |
| 实现细则 | [`../.trellis/spec/`](../.trellis/spec/) | frontend/backend code-level rules |
| **本目录** | `docs/**` | 解释、计划、证据、过程；**不是** active backlog 真相源 |

`plans/`、`research/`、`reports/`、带日期 baseline、带分支/commit 的引擎专文都是**时间快照**。冲突时以**当前代码 + OpenSpec 当前索引**为准。

## 文档生命周期元数据

新增或校准高风险文档时，文头至少说明以下五项。现有长文不为追求格式统一而批量重写；当它可能被误读为现网事实时再补齐。

| 字段 | 可选值 / 写法 | 目的 |
|------|---------------|------|
| **内容类型** | Reference / How-to / Troubleshooting / Decision Record / Plan / Evidence Snapshot / Strategic Architecture | 明确读者该拿它做什么 |
| **生命周期** | draft / accepted / implemented / superseded / historical | 区分提案、现状与历史 |
| **最后校准** | 日期 + 版本 + commit | 阻止「当前」无限保鲜 |
| **事实源** | 源码路径 / OpenSpec change 或 main spec / 可重跑命令 | 让结论可复核 |
| **更新触发器** | engine registry、contract、flag、gate、外部 API 等变化 | 指明何时必须重审 |

行业资料只证明参考模式在**核对日期**仍存在，不自动成为 mossx 的实现合同。设计稿必须把 `external reference`、`design decision`、`implemented behavior` 分开写。

**维护原则**（与 [`analysis/README.md`](analysis/README.md) 相同）：

1. **可合并**：职责进子目录索引，本页只挂索引与关键入口。
2. **可清理**：过时「现网结论」改成「当时→现在」，禁止静默删因果。
3. **可追溯**：变更记录 / 附录 / commit 锚点只追加。
4. **不双写真相**：行为进 OpenSpec；实现约束进 `.trellis/spec`；docs 写 why / how / evidence。

## 分区索引

| 分区 | 索引 | 装什么 | 默认读法 |
|------|------|--------|----------|
| **analysis/** | [README](analysis/README.md) | 幕布结构、live tool 矩阵、供应商契约、#185 playbook | **现网分析优先** |
| **architecture/** | [README](architecture/README.md) | harness 治理、large-file 基线 | 策略 + 采样快照 |
| **plans/** | [README](plans/README.md) | 实施计划（含 canvas/scroll） | 路线快照，查落地状态 |
| **research/** | [README](research/README.md) | 调研、CLI 基石、spikes、runbook | 设计输入，非 backlog |
| **perf/** | [README](perf/README.md) | 性能 contract、jank、baseline | 重测后才 gate |
| **perf/history/** | [README](perf/history/README.md) | 版本化 baseline 锚点 | 只读 |
| **reports/** | [README](reports/README.md) | 治理/影响/验收报告 | 带日期闭环记录 |
| **browser-agent/** | [README](browser-agent/README.md) | Browser Dock 能力矩阵 | 平台降级契约 |
| **superpowers/** | [README](superpowers/README.md) | agent 任务 plan/spec 镜像 | 可能指向 OpenSpec canonical |

## 按主题阅读

### 对话幕布 / 多 CLI 渲染（推荐顺序）

1. [analysis 索引](analysis/README.md)
2. [对话幕布结构（多 CLI · 现网底稿）](analysis/conversation-canvas-structure-2026-07-31.md)
3. [live tool 投影矩阵](analysis/canvas-live-tool-projection-matrix-2026-08-01.md)
4. [滚动所有权 DESIGN（代码已入库）](plans/2026-08-01-conversation-canvas-scroll-ownership-architecture.md)
5. 契约源码：`src/features/threads/contracts/conversationCurtainContracts.ts`
6. **历史引擎专文**（行号/分支过期，只作溯源）：
   - [Curtain Contracts 草稿](chat-canvas-conversation-curtain-contracts.md)
   - [Claude 幕布链路（v0.3.3 分支快照）](markdown-doc1-claude-chat-canvas-rendering.md)
   - [Codex 幕布链路（历史快照）](markdown-doc2-codex-chat-canvas-rendering.md)

### 同 CLI 供应商 / Shared

- [Native / Shared 供应商与模型契约](analysis/native-session-provider-select-vs-disk-overwrite-2026-07-31.md)
- [多 CLI 会话基石设计](research/mossx-multi-cli-provider-session-foundation-design.md)
- [A–D 影响与手测计划](reports/multi-cli-session-foundation-a-d-impact-and-manual-test-plan-2026-07-28.md)

### Project Memory

1. [Project Memory 全景：Phase 1 历史 + 2026-08 current delta](research/00-project-memory-feature-overview.md)
2. [消费机制：historical proposal + current Memory Reference/Retrieval Pack](research/04-project-memory-consumption-research.md)
3. 当前合同：`openspec/specs/project-memory-*/spec.md`
4. 当前实现：`src/features/project-memory/`、`src-tauri/src/project_memory/`

### Plugin / 外部架构调研

- [Research 索引](research/README.md)：区分 external snapshot、exploratory design 与 implemented behavior
- [Obsidian 市场治理](research/obsidian-plugin-marketplace-governance.md)：2026-05 Community / automated review 新链路
- [Obsidian 分发体验](research/obsidian-plugin-distribution-dev-experience.md)：2026-02 旧模型，文首含 current delta
- [Mossx Plugin Market RFC](research/mossx-plugin-market-and-cli-foundation-design.md)：exploratory，现网尚无 generic plugin runtime / marketplace

### 性能 / 卡顿

- [perf 索引](perf/README.md)
- [Render Jank 实验（2026-07-08）](perf/render-jank-knife-experiments-2026-07-08.md)
- [Streaming stall 设计](perf/streaming-render-stall-design-2026-07-30.md)
- AGENTS 硬红线：live-text 外置、禁高频 setState 挂根链

### Workflow / 运行手册

- [OpenSpec + Trellis Playbook](openspec-trellis-playbook.md)
- [Codex Collaboration Mode Enforcement](codex-collaboration-mode-enforcement-runbook.md)
- [Curated Skill Onboarding](curated-skill-onboarding.md)
- [桌面开发快速启动](research/desktop-dev-fast-start-runbook.md)

### 稳定性

- [React #185 Playbook](analysis/react-185-maximum-update-depth-playbook.md)

## 根目录文件角色（不进子目录的）

| 文件 | 角色 | 注意 |
|------|------|------|
| `chat-canvas-conversation-curtain-contracts.md` | 契约**早期说明** | kinds/引擎列表可能落后；以 TS 契约 + analysis 为准 |
| `markdown-doc1/2-*.md` | 单引擎链路**分支快照** | 行号不可信；现网看 analysis |
| `openspec-trellis-playbook.md` | 团队流程短文 | 细节以 `openspec/`、`.trellis/` 为准 |
| `codex-collaboration-mode-enforcement-runbook.md` | Codex 协作模式 | 操作手册 |
| `curated-skill-onboarding.md` | Skill 上架 | 操作手册 |
| `index.html` / `changelog.html` / `styles.css` / `banner.png` | 站点/展示资产 | 非工程规范源 |

## 全库整理批次（路线图 · 可追加）

| 批次 | 范围 | 状态 |
|------|------|------|
| **0** | `analysis/` 二次校准 + 索引 | **完成**（2026-08-01） |
| **1** | 本页总图；分区索引；根目录幕布文头边界 | **完成**（2026-08-01） |
| **2** | `plans/` 顶层计划状态；canvas / scroll / multi-cli 精确对齐 | **完成第一轮校准**（2026-08-01） |
| **3** | `research/` multi-cli / Project Memory / external ecosystem / plugin RFC 生命周期与现网差异 | **完成第一轮校准**（2026-08-01） |
| **4** | `perf/` streaming / live-text / jank 文内现网误指清理 | **完成第一轮校准**（2026-08-01） |
| **5** | `reports/` 生命周期、OpenSpec 归宿与当前用途 | **完成索引级校准**（2026-08-01） |
| **6** | `architecture/` harness 治理现网复核；Browser Agent archive/现网边界 | **完成第一轮校准**（2026-08-01） |

批次规则：每批只改索引与文头/附录为主；**不删**长文过程；大改写单篇须带变更记录。

## 维护检查清单

1. 新增子目录文档 → 更新**该目录 README** → 若新主题则挂本页。
2. 带日期/版本/commit 的文档保留时间边界。
3. 行为变化 → `openspec/changes/<id>/`；实现约束 → `.trellis/spec/**`。
4. 校准文档时写清对照版本（如 `0.7.14`）与实现 commit（若有）。
5. 禁止把 `openspec/project.md` 旧 inventory 数字当现网唯一数量源。

## 修订记录

| 日期 | 说明 |
|------|------|
| （既有） | 分区索引 + 事实边界 |
| 2026-08-01 | analysis 链接入对话与渲染 |
| 2026-08-01 | **Batch 1**：分区职责表、主题阅读顺序、根文件角色、全库整理批次路线；链接 reports/browser-agent/superpowers |
| 2026-08-01 | **Batch 2–6 第一轮**：补生命周期元数据合同；校准 plans/perf/research/reports/architecture 的高风险现网表述 |
| 2026-08-01 | **Review 补漏**：Project Memory 五篇 current delta；Obsidian/Pi/MemOS 外部 source revision 与行业时效边界；policy-router inventory 语义 |
