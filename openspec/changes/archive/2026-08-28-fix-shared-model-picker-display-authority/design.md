## Context

Shared Session 的下一轮执行目标权威是 per-thread `selectedNextTarget`（内存 `targetStore` + 磁盘 `selectedTarget`）。发送与 Turn Badge 已分别绑定该 store 与 `TurnExecutionSnapshot`。

闭合态 Atomic 选择器（`ModelSelect` trigger）却走另一套解析：

1. 优先在 `targetGroups[engine].models` 里按 id 找行；
2. 否则在父层 `models`（通常来自全局 `activeEngine` 的 `effectiveModels`）里找；
3. 找不到 → 文案 `models.selectModel`（「选择模型」）。

Shared 模式下本地 profile 的 catalog **懒加载**（打开菜单才 `ensureModels`），且故意不用模块 cache 做 authoritative refresh 前投影。创建 Shared 时 **不** `setActiveEngine(initialEngine)`，父层 `models` 常属于其他 CLI。于是出现：

- Send 成功、Badge 正确（Grok · 本地配置 · grok）
- 底栏仍「选择模型」

这是 **display authority 错位**，不是 Shared model 状态被全局共享。Claude managed 场景还会在 target 清空后回落全局 `selectedModelId`，叠加 **串台体感**。

## Goals / Non-Goals

**Goals:**

1. 闭合态 trigger 的选中展示以 `executionTarget` 快照为权威（Shared = `selectedNextTarget`）。
2. Catalog 是 enrichment：提升列表/勾选体验，不作为“是否已选”的前置条件。
3. Shared 下切断全局 `selectedModelId` / 错引擎 `models` 对“已选态”的冒充。
4. 持有完整 next target 时主动 ensure 对应 catalog，减少打开菜单前的空列表窗口。
5. 可单测回归 Grok local / 错引擎 models / null target 三类。

**Non-Goals:**

- 改 send pipeline 或 recovery 状态机。
- 改 Turn Badge / history 归因。
- 用 history badge 反写 picker。
- Native 续接语义大改。
- Git commit。

## Decisions

### D1 — 三源分离（Display / Send / Badge）

| 源 | 权威 | 用途 |
|----|------|------|
| `selectedNextTarget` / `executionTarget` | Next selection | 闭合态标签、勾选身份、下次 send |
| Provider-scoped catalog (`targetGroups`) | Enrichment | 打开菜单后的列表、渠道切换后的合法 model 集合 |
| `TurnExecutionSnapshot` | Past fact | 历史/实时 Badge |

**拒绝**：用 catalog 命中结果决定“有没有选中”；用 Badge 反推 next target。

### D2 — Closed-state label 解析序（正规，非单点 if）

在 **Atomic 路径**（`hasTargetGroups`）上，当 `executionTarget` 带有 model 身份时：

1. 若 catalog 命中 → 用 catalog 行做 label（保留 Claude provider-scoped runtime 优先等既有规则）；
2. 若未命中 → **用 snapshot 合成展示行**：`id = modelCatalogEntryId || model`，`model/label = model || id`，并可带 `providerProfileId`；
3. **禁止** 用父层 `models`（全局 activeEngine 列表）覆盖 Atomic 路径的 current 解析。

无 `executionTarget` 或无 model 身份时：显示未选（`models.selectModel`）。

Legacy 非 Atomic 路径保持现有 `value + models` 行为，避免扩大 blast radius。

### D3 — Shared Composer props 边界

当 `isSharedSessionResolved`：

| Prop | 规则 |
|------|------|
| `executionTarget` | 仅 `selectedNextTarget`（已有） |
| `selectedModelId` | 仅来自 target 的 catalog/runtime id；target 空 → `""` / null，**不**回落全局 `selectedModelId` |
| `selectedEngine` | target.engine ?? 可保留 summary 引擎作弱提示，但 models 不得绑架 Atomic 标签 |
| `models` | Atomic 路径不再依赖它做选中标签；可仍传入供其他控件，但不作为 Shared 已选权威 |

Send 仍只读 store 完整 target（V2 fail-closed 不变）。

### D4 — Catalog ensure 作为 enrichment，不阻塞展示

当 Shared 且 `selectedNextTarget` 可解析 engine+profile（local → local sentinel id）时：

- ChatInputBox / catalog owner 在 target 变化时 **主动** `ensureModels(engine, profileId)`；
- 失败不清空 target，不改标签 snapshot 路径；
- 成功后列表与勾选增强，标签可升级为 catalog 友好名。

### D5 — 不采用「只 setActiveEngine」作主方案

创建 Shared 时可 **附带** `setActiveEngine(initialEngine)` 改善其他依赖 activeEngine 的 UI，但 **不得** 当作 display authority 修复。Shared 内换 CLI 后 activeEngine 仍会落后。

### D6 — 阶段 Review

| 阶段 | 内容 |
|------|------|
| R1 | OpenSpec artifacts + 本 design 自检 |
| R2 | ModelSelect display authority + 单测 |
| R3 | Composer Shared props 隔离 + catalog ensure |
| R4 | 整体回归 / 手动清单 / 不提交 |

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Snapshot 标签缺少 catalog 友好 displayName | 优先 catalog；未命中用 runtime `model`；可接受 |
| Native Atomic 被误伤 | 改动门控 `hasTargetGroups`；Native create-session 路径同步受益（同样合理） |
| ensureModels 风暴 | 依赖既有 request cache / binding key 去重；仅对 current target 触发 |
| null target 后用户必须重选 | 有意 fail-closed，避免串台；与 V2 send 一致 |

## Migration Plan

- 纯前端行为修正，无数据迁移。
- 已持久化完整 `selectedTarget` 的会话：打开即正确标签。
- 不完整 legacy target：继续显示未选 + 禁止 send（既有）。
- 回滚：revert 本 change 前端提交即可。

## Open Questions

- 无（闭合态权威与隔离边界已在 D1–D3 定死）。
