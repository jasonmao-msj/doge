## Context

- **现象**：Shared + Claude「渲染两遍」；中长/结构化回复易现，短回复难现。
- **探针证据**（本机 Vitest，2026-08-04）：
  - Claude `item/updated` → `appendAgentMessageDelta`（全量 text 当 delta）；Codex → `itemUpdated`。
  - 标准 `A+A` / `prefix+full` **已**被 merge 护栏覆盖（既有测试全绿）。
  - **`mergeAgentMessageText(A2, A2+"\n\n"+A)`** 与 **`mergeCompletedAgentText`** 对 early-body 回显 **失败**（`第一段` 出现 2 次）。
  - Shared / Native Claude 不同 itemId 同文两次 complete → **2 bubbles**；Native Codex → **1**。
  - `shouldDeduplicateCodexAssistantMessages`：`threadKind === "shared"` **强制 false**。
- **正交工单**：`fix-live-settle-assistant-tool-order` 处理「结论在工具前」顺序，本 design 不改 segment 挂载。

## Goals / Non-Goals

**Goals:**

1. 单气泡正文：折叠「更长快照 + 前缀/前半回显」与既有重复形态。
2. 双气泡：Native **与** Shared 在同 turn、无 user/tool 硬边界下，对等价 assistant 跨 id 收敛。
3. 不误吞 tool 后真实第二段结论。
4. 测试先红后绿；分批实现可 review。

**Non-Goals:**

- 不改 Claude adapter 为 snapshot-only（可选 follow-up）。
- 不修 tool/结论顺序。
- 不在 UI 层做唯一过滤。
- 不引入 history 强制 reload 当主修复。

## Decisions

### D1. 正文收敛落在 `threadReducerTextMerge`（引擎中立）

- **选择**：在 `mergeAgentMessageText` / `mergeCompletedAgentText` / `normalizeCompletedAssistantText` 加固「suffix 回放 existing 前缀 / 前半段」检测，复用或扩展 `collapseNearDuplicateParagraphRepeats`、`suffixReplaysLeadingSnapshot`、`collapseRepeatedAssistantEcho`。
- **备选**：仅在 Claude complete 分支特判 → 否决（Shared/Native 其它引擎同源风险）。
- **验收锚点**：`A2` + `A2+A` → 单份；既有 Computer Use / markdown 用例不回归。

### D2. 跨 id 收敛从「Codex-only」升级为「同 turn 等价 assistant 通用」

- **选择**：
  - 将 `shouldDeduplicateCodexAssistantMessages` 语义泛化为「是否允许跨 id 等价 assistant 收敛」（可 rename 为 `shouldConvergeEquivalentAssistantMessages` 或保留旧名但改条件）。
  - **删除 / 改写** `threadKind === "shared" → false`：Shared 与 Native 同等开启。
  - 对 **Claude / Shared / 其它非 Codex** 在 `completeAgentMessage` 与相关 `upsertItem` 路径启用与 Codex 相同的 `findEquivalent…` 查找（可复用 `areEquivalentAssistantMessageTexts`）。
- **备选**：只开 Claude、Shared 仍关 → 否决（用户明确 Shared+Native 都要修）。
- **保护**：
  - 向后扫描遇 **user message** 停止（turn 边界）。
  - 中间夹 **tool**（或非等价 assistant）则不得跨过合并（与现有 Codex tool-separated 场景一致）。
  - 仅当文本等价/近等价时合并。

### D3. 不依赖改 adapter 模式作为 P0

- Claude updated→delta 是长 Markdown 提前露出的既有设计；P0 以 merge + 跨 id 收敛兜住。
- 若 P1 仍见噪声，再评估 `agentMessageSnapshotMode: "snapshot"`。

### D4. 分批交付与停点

| Batch | 内容 | Review 停点 |
|-------|------|-------------|
| 1 | OpenSpec artifacts（本批） | 用户审 proposal/design/specs/tasks |
| 2 | 失败用例固化为正式测试（红灯） | 用户审测试范围 |
| 3 | merge 正文修复（绿灯单气泡） | 用户审 diff |
| 4 | 跨 id / Shared 收敛（绿灯双气泡） | 用户审 diff |
| 5 | 总 review：相关套件 + 既有 duplicate 回归 | 用户人工检查；**不 commit** |

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| 误合并 tool 后第二段真实结论 | 保留 user/tool 扫描中断；tool-separated 回归强制保留 |
| Shared 开启收敛后误并不同 turn | user message 硬边界 |
| 近等价过于宽松吞掉微调 | 继续用 `areEquivalentAssistantMessageTexts` + merge 结果评估，不新增宽松阈值 |
| merge 加固引入 O(n²) | 优先前缀/后缀探测与段落块折叠，避免全文模糊扫 |
| 与 settle-tool-order 交互 | 不改 segment id 解析；complete 仍走现有 settlement-safe index 查找后再做等价合并 |

## Migration Plan

1. Artifacts 审过 → Batch 2 测试红灯 → Batch 3/4 实现 → Batch 5 总测。
2. **Rollback**：纯前端 reducer/merge 变更，回退 commit 即可；无 schema/migration。
3. **不自动 git commit**；由用户人工检查后提交。

## Open Questions

1. 跨 id 收敛是否覆盖 **upsertItem** 全路径与 **flushAgentCompletedBatch**？（设计默认：**是**，与 complete 同策略。）
2. Shared 上 Codex 是否也走通用收敛？（设计默认：**是**，Shared 不再禁用。）
3. 是否在本 change 重命名 `shouldDeduplicateCodexAssistantMessages`？（默认：可保留函数名 + 改语义，或小 rename 一次改完调用点；实现时选改动更小者。）

## Implementation Sketch（供 Batch 3/4，非代码）

```
mergeAgentMessageText(existing, delta):
  // existing fast paths...
  if delta starts with existing and suffix replays leading(existing): collapse
  if delta == existing + sep + prefix(existing): collapse
  // existing paragraph/near-duplicate collapse...

completeAgentMessage / upsert assistant:
  index = find by id / segment
  if index < 0 && shouldConvergeEquivalentAssistant(...): // shared + native + claude + codex
    index = findEquivalentAssistantMessageIndex(list, text) // stop at user/tool
  merge text into that item
```
