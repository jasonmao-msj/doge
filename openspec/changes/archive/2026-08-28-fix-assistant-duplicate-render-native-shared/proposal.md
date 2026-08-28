## Why

用户反馈 Shared + Claude 对话「重复渲染 / 渲染了两遍」：同一轮助手答复在幕布上出现整段正文双份（单气泡 `A+A`）或并排两条等价 assistant 气泡。仓库内探针已钉死两条 state 层根因，而非纯 React 重绘：

1. **单气泡正文**：`mergeAgentMessageText` / `mergeCompletedAgentText` 压不住「更长稿 A2 + 前半段 A 回显」类 completed/snapshot 载荷。
2. **双气泡**：跨 itemId 语义去重目前基本只服务 **Native Codex**；`threadKind === "shared"` 时直接关闭，**Claude Native / Shared（任意引擎）** 在 live complete + 另一 id complete/history upsert 时会留下两条等价 assistant。

若不修，Shared 与 Native 在中长回复 / 快照回显模型（如 ds）下会持续偶发「两遍」，破坏 `conversation-curtain-normalization-core` 与 `conversation-realtime-history-parity` 合同。

## What Changes

- 收紧 **assistant 正文 merge**：在 stream/snapshot/complete 合并路径识别并折叠「增长快照后回放 early body」与既有 `prefix+full` / `A+A` 形态，Native 与 Shared **共用** `threadReducerTextMerge`。
- 将 **跨 itemId 等价 assistant 收敛** 从「仅 Native Codex」扩展为 **同 turn / 无 tool 分隔的等价正文收敛**，覆盖：
  - Native Claude（及同 reducer 路径的其它非 Codex 引擎，若走 complete/upsert 别名）
  - Shared 会话（`threadKind === "shared"` 不得再一刀切禁用）
  - 仍 **MUST NOT** 合并 tool 分隔后的真实第二段结论
- 补齐 Vitest 回归：探针失败用例固化为红→绿；Shared + Claude / Native Claude / Native Codex 矩阵。
- 更新相关 OpenSpec main capability deltas；与 `fix-live-settle-assistant-tool-order`（结论跑到工具前）**正交**，不混修。

## 目标与边界

- **目标**
  1. 单条 assistant 气泡内不得出现可证明的整段正文双份（含 A2+A 回显）。
  2. 同一 user turn 内、无 tool 分隔的等价 assistant 观察（不同 itemId / live+history）收敛为一条气泡；**Native 与 Shared 行为一致**。
  3. 保留 tool 交错多段 assistant；保留非等价正文。
  4. 既有 Codex Computer Use / 近重复段落 collapse 回归继续绿。
- **边界**
  - 仅前端 conversation state：text merge、assistant dedup、complete/upsert 收敛与测试。
  - 不改 provider 协议、不改 history loader 作为主路径、不改 UI 纯展示层过滤。

## 非目标

- 不修复「结论落到工具前」顺序问题（见 `fix-live-settle-assistant-tool-order`）。
- 不把 Claude `item/updated` 强行改成 Codex 式 snapshot-only（可选后续优化，本 change 不依赖）。
- 不在 render 层隐藏重复而放任 state 脏数据。
- 不合并用户有意区分的多段 assistant（tool 分隔或语义不同）。
- 不改 live-text 外置性能契约（禁止恢复 per-delta 根 reducer 风暴）。

## 技术方案对比

| 方案 | 描述 | 优点 | 风险 | 结论 |
|------|------|------|------|------|
| A. 仅 Messages 渲染层过滤相邻重复 | 同文相邻行不画 | 改动面小 | state/copy/search/history 仍脏 | **否决** |
| B. 仅 Claude adapter 改 snapshot 模式 | updated 走 replace | 减少 append 误拼 | 不覆盖 completed 回显、不修跨 id、不修 Shared 禁用 dedupe | **不足，可后续叠加** |
| C. 仅加强 merge 文本 | 修 A2+A | 修单气泡 | 不修双气泡 | **必要但不充分** |
| **D. merge 加固 + 跨引擎/Shared 同 turn 等价收敛（推荐）** | text merge + 扩展 dedupe 适用范围 | 对准两条根因；Native/Shared 同源；可测 | 需严防误吞 tool 后第二段 | **采用** |

## Capabilities

### New Capabilities

- `assistant-duplicate-render-convergence`: Native 与 Shared 共用的 assistant 重复收敛合同——单气泡正文回显折叠 + 同 turn 跨 id 等价气泡收敛 + tool 分隔保护。

### Modified Capabilities

- `conversation-curtain-normalization-core`: 补充「增长快照 + early body 回显」与 Shared/Native 一致收敛要求。
- `conversation-lifecycle-contract`: 将 Claude（及非 Codex）跨 alias 收敛从「仅 completed text merge」扩展到跨 itemId 气泡收敛（在 tool 分隔保护下）。
- `conversation-realtime-history-parity`: 明确 live complete 后 history upsert 等价正文不得新增第二条 assistant。
- `codex-realtime-canvas-message-idempotency`: 澄清 Shared 会话不再被排除在「等价 assistant 跨 id 收敛」之外（Codex 专有事件形态规则仍可保留；Shared 侧走通用收敛）。

## Impact

| 层 | 影响面 |
|----|--------|
| Frontend core | `threadReducerTextMerge.ts`、`useThreadsReducerAssistantDedup.ts`、`useThreadsReducer.ts`（complete/upsert 调用点） |
| Tests | `threadReducerTextMerge.test.ts`、`useThreadsReducer.completed-duplicate.test.ts` 或新增 focused 文件 |
| Specs | 新 capability + 上述 main delta |
| Docs | 可选短分析回链；非强制 |
| Perf | merge 路径保持线性/既有快路径；禁止根链高频 setState |

## 验收标准

1. **单气泡**：`mergeAgentMessageText` / `mergeCompletedAgentText` 对 `A2` + `A2+A` 收敛为可读单份；既有 prefix+full / A+A 仍绿。
2. **双气泡**：Native Claude 与 Shared（`threadKind: shared`, `engineSource: claude`）两次 `completeAgentMessage` 不同 id 同文 → **1** 条；Native Codex 行为不回退。
3. **History**：live complete 后 `upsertItem` 等价不同 id → **1** 条。
4. **保护**：tool 分隔的两段非等价 assistant **仍为 2** 条。
5. **手测矩阵（用户验收，不强制本机 CI）**：Shared×Claude、Native×Claude 中长列表回复不出现两遍；简单「你好」不回归。
6. **不提交**：实现完成后由人工检查；本 change 不自动 commit。
