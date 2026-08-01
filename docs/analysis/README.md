# docs/analysis — 分析与过程文档索引

> **用途**：对话幕布、多 CLI 过程投影、同 CLI 供应商、渲染稳定性等**分析/校准/过程**材料。
> **不是** OpenSpec active proposal 索引；行为契约以 `openspec/**` + 当前源码为准。
> **维护原则**：**可合并、可清理、不丢演进**——过时结论改写成「当时 → 现在」，禁止静默删除过程证据。

## 阅读顺序（按角色）

| 你要… | 先读 |
|--------|------|
| 30 秒地图 + 校准锚点 | **本文** |
| 幕布结构 / 默认运行态 / 排障 | [`conversation-canvas-structure-2026-07-31.md`](./conversation-canvas-structure-2026-07-31.md) |
| 多引擎 live tool 是否进幕布 | [`canvas-live-tool-projection-matrix-2026-08-01.md`](./canvas-live-tool-projection-matrix-2026-08-01.md) |
| 统一幕布改动**后验**（含改前改后） | [`unify-conversation-canvas-review-2026-08-01.md`](./unify-conversation-canvas-review-2026-08-01.md) |
| Native / Shared 供应商与模型 | [`native-session-provider-select-vs-disk-overwrite-2026-07-31.md`](./native-session-provider-select-vs-disk-overwrite-2026-07-31.md) |
| React #185 诊断 playbook | [`react-185-maximum-update-depth-playbook.md`](./react-185-maximum-update-depth-playbook.md) |
| 历史执行建议快照（v0.7.3） | [`client-shortcuts-and-priorities-2026-07.md`](./client-shortcuts-and-priorities-2026-07.md) |

姊妹设计（不在本目录，避免双写）：

| 主题 | 路径 |
|------|------|
| 统一幕布任务 PLAN | `docs/plans/2026-08-01-unified-conversation-canvas-architecture.md` |
| 滚动所有权 DESIGN + 实现入口 | `docs/plans/2026-08-01-conversation-canvas-scroll-ownership-architecture.md` · `src/features/messages/orchestration/scrolling/` |
| 契约旁路 | `docs/chat-canvas-conversation-curtain-contracts.md` |
| perf 硬红线 | `docs/perf/render-jank-knife-experiments-2026-07-08.md` |

## 事实边界

1. **带日期的文件名** = 首次落盘或主题锚定日，不表示「仅当天有效」。
2. **文内「对照源码日期 / 校准」** = 最近一次与 HEAD 对齐的时间；冲突时以**当前代码**为准。
3. **变更记录 / 附录 / Case Log** 只追加，不改写旧条结论语义。
4. 本目录**不**承担 `openspec/project.md` inventory 数量真相；OpenSpec 数量以 `openspec list` / 目录实数为准。

## 2026-08-01 二次校准锚点（代码已入库）

校准基线：产品版本 **`0.7.14`**；下列 commit 是 analysis 文内「已落地」的硬锚点（非完整相关历史）。

| commit | 说明 | 主要文档 |
|--------|------|----------|
| `bf3b35bd6` | 统一幕布：对话/行级轻量下线；Grok/Kimi/OpenCode 过程投影；藏 bash 对齐 | structure · matrix · unify-review |
| `b34fdaead` | 幕布滚动所有权：`scrollAuthorityMachine` 单 writer / 权威回底 | structure §7.3 · plans scroll-ownership |
| `44fcf26a6` | catalog 外模型名 Allow + Native `nativeAtomicSelection` 勾选 | native-session |
| `e2ac4a1a6` | Native 供应商/模型切换；Claude 独立配置不盖盘 | native-session |
| `fb6083584` | Shared Claude 切供应商后模型列表刷新 | native-session |
| `4c5e97c8e` | 冷启动 React #185：useModels effort 双写结构加固 | react-185 playbook |
| `1537211a1` | streaming publish cadence + terminal causal ordering | perf streaming / A4 |
| `4e932e672` | 恢复 idle timeline virtualization（48 rows；streaming 仍关闭） | perf streaming / structure |

OpenSpec 状态快照（2026-08-01；后续仍以 change 目录为准）：

- `unify-conversation-canvas`：`23/23`，active，待 verify / sync / archive
- `refactor-conversation-canvas-scroll-ownership`：`23/26`，余 3 项 Human QA
- `close-native-session-provider-create-binding`：`27/27`，active，待 sync / archive
- `fix-grok-history-tool-projection`：`12/13`，余 verify / archive

## 文档职责（合并策略）

| 文档 | 职责 | 不写什么 |
|------|------|----------|
| **structure** | 幕布**现网结构**、默认开关、引擎硬分支、症状→入口 | 不重复 matrix 的逐引擎手测表全文 |
| **matrix** | live tool **能力登记** + 手测清单 | 不重写 Messages 树 |
| **unify-review** | 统一幕布**过程后验**（改前/改后/完成度） | 不替代 structure 的现网表 |
| **native-session** | Native L1/L2 + Shared next-target 契约 | 不描述 Messages 渲染核 |
| **react-185** | #185 诊断协议 + case 追加 | 不是事故结案唯一源 |
| **client-shortcuts** | **历史**执行建议快照 + 现状附录 | 不当前 backlog 真相源 |

## 演进时间线（不丢过程）

```text
2026-07-16  client-shortcuts：v0.7.3 后续执行建议（治理/closure/backlog）
2026-07-31  conversation-canvas 初版 + native-session 契约
2026-08-01  structure 扩写 §7.1/§7.2/§5.1；matrix；unify 实施与 Review
2026-08-01  bf3b35bd6 合入：轻量墙下线 + Grok jsonl 桥 + 多引擎藏 bash
2026-08-01  b34fdaead 合入：scroll authority 状态机
2026-08-01  44fcf26a6 / 4c5e97c8e：模型点选 freeform + #185 结构修
2026-08-01  1537211a1 / 4e932e672：流式调度收口 + idle virtualization 恢复
2026-08-01  本目录二次校准：索引 + 矛盾表述清理 + 历史附录保留
```

## 维护检查清单

新增/改 analysis 时：

- [ ] 更新本 README 的链接或校准锚点表（若新增主题文件）
- [ ] 文头写清「对照源码日期」与实现状态（已落地 / 设计中 / 历史快照）
- [ ] 过时段落：**标「历史」**或改「当时→现在」，不直接抹掉因果
- [ ] 从 `docs/README.md` 挂到本索引（本页是子索引）

## 全库 docs 整理

analysis 为 **Batch 0**；全库批次路线见 [`../README.md`](../README.md)「全库整理批次」。
