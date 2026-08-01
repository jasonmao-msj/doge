# Canvas live tool projection matrix（2026-08-01）

> **对照源码**：2026-08-01 二次校准 · 产品 **`0.7.14`** · 实现 commit **`bf3b35bd6`**
> **状态**：**已入库**（非工作树草案）
> **OpenSpec**：`fix-grok-history-tool-projection` 为 `12/13`；仅余 verify / archive
> **目标呈现**：向 **Claude 打磨后的幕布** 看齐——**读/写过程可见**，**bash/command 默认不进幕布**
> **索引**：[`README.md`](./README.md)
> **结构底稿**：[`conversation-canvas-structure-2026-07-31.md`](./conversation-canvas-structure-2026-07-31.md) §5 / §5.1
> **过程后验**：[`unify-conversation-canvas-review-2026-08-01.md`](./unify-conversation-canvas-review-2026-08-01.md)

## Matrix（现网）

| Engine | live tool 信号源 | 幕布 live 过程 | bash/command 幕布 | fileEdit 场景 | history tool |
|--------|------------------|----------------|-------------------|---------------|--------------|
| **Claude** | stream-json Tool* | ✅ 原生 | **隐藏** | ✅ | ✅ |
| **Codex** | item/* tool | ✅ 原生 | **隐藏** | ✅ | ✅ |
| **Grok** | stdout 无 tool；**jsonl 增量 tail 桥** | ✅ 桥接 | **隐藏** | write/edit→fileChange | ✅ jsonl |
| **Kimi** | stream tool_calls | ✅ 原生 | **隐藏** | write/edit→fileChange | ✅ |
| **OpenCode** | stream Tool* | ✅ 原生 | **隐藏** | write/edit→fileChange | ✅ |
| **Gemini** | 既有 adapter | 依既有 | **未**进五引擎 hide 集合 | — | 依既有 |
| **Shared** | 跟 **目标引擎** | 同上 | 同上 | 同上 | 同上 |

`shouldHideCodexCanvasCommandCard` 引擎集合：`codex | claude | grok | kimi | opencode`（**不含 gemini**）。

Gemini 行描述的是代码 adapter / loader capability，不代表当前产品 runtime 可用：`src-tauri/src/engine_policy.rs` 的 `GEMINI_RUNTIME_ENABLED` 仍为 `false`。Registry presence、projection capability 与 runtime availability 必须分开判断。

## Grok bridge（硬化后 · 已入库）

| 项 | 行为 |
|----|------|
| 状态机 | `GrokToolHistoryTailState`（`src-tauri/src/engine/grok_history.rs`） |
| **Resume** | `for_turn(true)`：首开文件 **baseline=EOF**，不重放旧 tool |
| **新会话** | `for_turn(false)` 或本 turn 曾 `saw_missing`：从 **offset=0** 读 |
| 增量 | `seek(offset)` + 行边界 `carry` |
| 节奏 | ~200ms poll + 进程结束后 final poll |
| 路径 | `resolve_chat_history_path`；存在后 cache |
| 宿主 | `src-tauri/src/engine/grok.rs` send_message 并行 poll |

## 呈现策略（Claude 对齐）

| 工具类 | 幕布 | 专用块 |
|--------|------|--------|
| Read / read_file / list_dir / LS / view_file | **显示** | `ReadToolBlock`（可成 readGroup） |
| Write / Edit / MultiEdit / search_replace / apply_patch / Delete | **显示** | `EditToolBlock` + fileEdit 场景 |
| Grep / Glob / codebase_search | **显示** | `SearchToolBlock` |
| WebFetch / web_search | **显示** | Generic / web 图标 |
| bash / shell / run_terminal_* / commandExecution | **隐藏** | Status Panel |
| TodoWrite | **剔除** | `shouldHideToolItemForRender` |
| Task / 未知 agent 工具 | **显示 Generic** | 可折叠摘要 |
| ExitPlanMode | **显示** | Generic 专用 |

打磨点（实施期写入，仍有效）：

- Completed 事件 **回填 start 时 args**（`_input`/`_output`），避免 path 丢失
- fileChange / command item 带 **title=tool_name**
- **Codex `fileChange` 必须走 GenericToolBlock / EditToolGroupBlock**（`changes[]`）；禁止误走单文件 `EditToolBlock`
- 无 inline diff 时 **点开走编辑器**（`openFileLink`），不进双栏 git diff（避免 Asrc 破布局）
- 有 diff 时优先 **+N/-M 可展开**；`change.diff` 空时尝试从 `item.output` 多文件 patch 按 path 切片
- path 归一防御 `A path` / `Asrc/`
- 名表扩展：delete/multiedit/str_replace/codebase_search/LS/view_file…

## 与 Claude 的差距（预期内 · 保留）

| 维度 | Claude | Grok 桥 |
|------|--------|---------|
| 时钟 | 协议事件 | 磁盘 poll |
| 滞后 | 极低 | 约百毫秒级 + 写盘 |
| payload | 较结构化 | jsonl arguments 常偏 raw |
| 目标 | 成熟过程叙事 | **先保证可见 + 策略一致** |

## 手测清单

任务：`请读取 README 前 20 行，再在 docs/tmp-note.md 写入一行时间戳。`

| # | 引擎 | 期望幕布 | 期望不出现 | 续聊第二轮 |
|---|------|----------|------------|------------|
| 1 | Claude | 读 + 文件修改 | bash 批跑 | 无异常闪现 |
| 2 | Grok | 读 + 文件修改（可略滞后） | bash / run_terminal_* | **无旧 tool 闪现** |
| 3 | Kimi | 读 + 写 | bash 组 | 同上 |
| 4 | OpenCode | 读 + 写 | bash 组 | 同上 |

另验：

- [ ] 无「详情已延迟 · 渲染详情」行级灰条
- [ ] 块级「重型 Markdown · 显示详情」仍可用（若触发）
- [ ] Diff 与幕布写文件大致对应

## 源码索引

| 主题 | 路径 |
|------|------|
| Grok tail 状态机 | `src-tauri/src/engine/grok_history.rs` |
| Grok poll 任务 | `src-tauri/src/engine/grok.rs` send_message |
| Tool→item 类型 | `src-tauri/src/engine/events.rs` `resolve_tool_item_kind` |
| 藏 bash | `messagesRenderUtils.shouldHideCodexCanvasCommandCard` |
| 语义名表 | `src/utils/toolSemantics.ts` |
| 块渲染 | `ToolBlockRenderer` · `fileEditSceneUtils` |
| 轻量墙关 | `messagesConversationLightweightMode.ts` · `ConversationLightweightPrompt.tsx` |

## 演进记录

| 日期 | 说明 |
|------|------|
| 2026-08-01 | 初版矩阵（与 unify 实施同步；当时工作树未 commit） |
| 2026-08-01 | 二次校准：标记 **`bf3b35bd6` 已入库**；Gemini hide 边界写清；去掉「仅草案」语气 |
