# Tasks: fix-assistant-duplicate-render-native-shared

> OpenSpec change。分批执行；每批结束后 **停下来** 给用户 review。**不要 git commit**。

## 1. OpenSpec artifacts（Batch 1）

- [x] 1.1 创建 change `fix-assistant-duplicate-render-native-shared`
- [x] 1.2 撰写 `proposal.md`（含目标/边界/非目标/方案对比/验收）
- [x] 1.3 撰写 `design.md`（D1–D4、风险、分批）
- [x] 1.4 撰写 capability deltas + 新 capability `assistant-duplicate-render-convergence`
- [x] 1.5 撰写 `tasks.md` 并更新 `openspec/changes/README.md` active 索引
- [x] 1.6 用户 Review Batch 1（校准后再开 Batch 2）— 用户确认全量实施

## 2. 红灯测试固化（Batch 2）

- [x] 2.1 新增 Vitest：`mergeAgentMessageText` / `mergeCompletedAgentText` 对 `A2` + `A2+A` early-body echo **期望单份**
- [x] 2.2 更新 Vitest：Native Claude 不同 itemId 同文两次 `completeAgentMessage` → 期望 1 条
- [x] 2.3 新增 Vitest：Shared + Claude 不同 itemId 同文两次 complete → 期望 1 条
- [x] 2.4 新增 Vitest：live complete + `upsertItem` 等价不同 id → 期望 1 条
- [x] 2.5 保护用例：tool 分隔非等价两段仍为 2；Native Codex 既有 duplicate 套件仍绿
- [x] 2.6 focused vitest 证据（与实现同批落地后全绿）

## 3. 单气泡正文 merge 修复（Batch 3）

- [x] 3.1 在 `threadReducerTextMerge.ts` 加固 early-body echo / 增长快照回显折叠（`collapseEarlyBodyEchoAfterLongerDraft`）
- [x] 3.2 保持 clean-prefix 快路径优先，避免长流式 O(L) 回归
- [x] 3.3 既有 prefix+full / A+A / Computer Use / markdown + 2.1 全绿

## 4. 跨 id 收敛 Native + Shared（Batch 4）

- [x] 4.1 `shouldConvergeEquivalentAssistantMessages`：Shared/Native 全开；保留旧 export 名
- [x] 4.2 `findEquivalentCodexAssistantMessageIndex`：user/tool 边界停止；reasoning 可跳过
- [x] 4.3 2.2–2.4 绿；Codex 既有 duplicate 绿；tool-separated 仍绿

## 5. 总 review（Batch 5）

- [x] 5.1 跑 `threadReducerTextMerge` + `useThreadsReducer.completed-duplicate`（48/48 绿）
- [x] 5.2 关联套件：`realtimeAdapters` 绿；`realtimeHistoryParity` 中 claude shared-id 用例 **改前改后均失败**（预存，非本 change 引入）
- [x] 5.3 对照 proposal 验收标准勾选（见下）
- [x] 5.4 **不 commit**；交付用户人工检查

## 6. Review 收紧（防误吞）

- [x] 6.1 streaming 跨 id：短 delta 禁止松前缀粘合；仅 exact body 或双方 ≥80 + equivalent
- [x] 6.2 early-body：min 24 字 + ≥50% coverage；文末短复述负例
- [x] 6.3 stop 边界对齐 assembler（user/tool/reasoning/media/review）
- [x] 6.4 负向测：短开场不粘上一条；reasoning 夹层不合并
- [x] 6.5 自检：merge + completed-duplicate + adapters + completed-fast-path **84/84**；openspec validate OK

## 验收对照（proposal）

| # | 标准 | 结果 |
|---|------|------|
| 1 | 单气泡 A2+A 收敛 | ✅ `threadReducerTextMerge` 新测 |
| 2 | Shared/Native Claude 跨 id → 1 条 | ✅ `completed-duplicate` 新测 |
| 3 | live + history upsert → 1 条 | ✅ |
| 4 | tool 分隔非等价仍 2 条 | ✅ 既有测 |
| 5 | 防误吞负向 | ✅ 短开场 / 短复述 / reasoning 边界 |
| 6 | commit | 待执行 |

## 依赖与优先级

全量实施 + review 收紧完成；自检绿后提交。
