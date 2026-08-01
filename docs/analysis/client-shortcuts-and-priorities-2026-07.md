# mossx v0.7.3 后续执行建议（历史快照）

> **文档性质**：**2026-07-16 执行建议快照**，保留全文以便追溯当时判断。
> **不是** 2026-08 现网 backlog 真相源。现网入口见 [`README.md`](./README.md) 与文末 **附录 A（2026-08-01 对照）**。
> **原始校准**：2026-07-16 · 代码基线 `9389f3e3`（`feature/v-0.7.3`）
> **结论性质（当时）**：执行建议，不是线上故障清单。

## 结论先行

当前主要矛盾不是“缺少 14 个功能”，而是实现、验证、提交、session record、OpenSpec task 与 archive 六种状态没有完全收敛。后续工作应先消除治理状态漂移，再补 rebuilt app / platform evidence，最后投入真正的 implementation backlog。

截至当前 HEAD，按目录实数统计：

- active changes：`16`
- archived changes：`598`
- main specs：`395`

`openspec/project.md` 的 `active=12`、`archive=596`、`specs=395` 是 2026-07-15 19:46 的治理快照，早于当晚新增 change 和后续 archive，因此不能单独作为当前数量事实源。当前状态应以文件系统、`openspec list`、Git history 和 change-local artifacts 交叉校准。

## A. Closure：先消除状态漂移

### A1. 已完成且可进入 archive 评估

下列 change 的 tasks 已全部完成，当前 strict validation 通过。它们不应继续占用 implementation backlog：

| Change | 当前事实 | Closure 动作 |
|---|---|---|
| `fix-codex-subagent-sidebar-projection` | `15/15`；commit `a0c82451`；focused Rust/Vitest、typecheck、lint、runtime contract 与 strict validation 已有记录 | 核对 Trellis session record 归因；确认后 sync/archive |
| `fallback-untracked-added-file-empty-inline-diff` | `5/5`；commits `28d1df33`、`07ed4c70`；Session 992/994 已记录；strict validation 通过 | 补最小 verification summary 后 sync/archive |
| `add-turn-file-summary-modal-diff-preview` | `5/5`；commit `e902a0ae`；Session 995 已记录；strict validation 通过 | 补最小 verification summary 后 sync/archive |

这三项的优先级高于新功能开发，因为继续保持 completed-but-active 会放大 `openspec/project.md`、active inventory 与真实交付状态之间的偏差。

### A2. 已提交、已记录，但 change-local 状态过期

`fix-codex-thread-start-continuity-and-recovery` 当前仍显示 `24/26`，其 `tasks.md` 与 `verification.md` 声称缺少 commit 和 Trellis record；但仓库事实已经证明：

- implementation/spec commit `a1f2ad06` 已存在；
- Trellis Session 942 已记录该 commit；
- 后续补充 commit `f8a44b19` 已进入历史；
- working tree 不再包含该 change 的未提交实现。

因此它不是“等待提交的实现”，而是 **change-local artifacts 未与 Git/Trellis 事实对齐**。下一步应回写 6.4/6.5 与 verification status，重新 strict validate，再决定 sync/archive。

### A3. 实现已存在，但仍需 runtime evidence

| Change | 已有事实 | 剩余 gate |
|---|---|---|
| `fix-workspace-drop-overlay-leave-settlement` | `6/7`；Rust bridge 已转发 `DragDropEvent::Leave`，Composer 在 position hit-test 前 settlement；commit `25934252` | rebuilt Tauri app 中验证“进入 Sidebar → 移出窗口 → 外部松开”后 overlay 消失 |
| `optimize-conversation-streaming-render-perf` | `7/8`；history scan cache、event coalescing、compositor animation、Bash output DOM reuse 已实现 | rebuilt app 重录 streaming trace，比较 main-thread time、frame gap 与 CPU |
| `add-claude-runtime-mcp-servers-panel` | `5/6`；runtime server card 已接入现有 snapshot | Claude workspace 手工验证 server rows、`ccgui` badge 与 empty state |
| `add-linux-native-menu-localization` | `3/5`；`MenuLabels` 与 saved-language startup build 已存在 | Linux `cargo` 验证与 GTK startup localization smoke test |

## B. 最新代码已关闭的风险

以下问题已有新 commit 或 archived change 覆盖，不应重新列为 active backlog。

### B1. Codex settled turn 被进度事件重新激活

Commit `7f90d84c` 已完成并归档 `fix-codex-settled-turn-loading-revival`：终态 Codex turn 不再因迟到的 progress/item event 被重新投影为 loading。相关 delta 已同步到 `codex-conversation-liveness` main spec，并有 thread item/turn/integration regression tests。

### B2. 新增文件与已编辑文件 Diff 入口

2026-07-15 晚间三个 commit 已连续收敛该链路：

- `28d1df33`：新增文件空白 Diff fallback；
- `07ed4c70`：恢复幕布新增文件 inline Diff；
- `e902a0ae`：已编辑文件从 turn summary 打开最大化 Diff modal。

剩余工作是 OpenSpec closure，不是继续重写 Diff UI。

### B3. Codex 子代理侧栏投影

Commit `a0c82451` 已贯通 scanner source fact、catalog/native/daemon mapping、frontend parent projection 与 canonical child dedupe。当前需要处理 baseline failure 说明和 archive 归因，不需要再次实现 parent-child tree。

## C. Product Risk：已有缓解，仍需验收

### C1. Claude AskUserQuestion 非 plan 模式

当前代码已在 `default` / `acceptEdits` 下注册 in-process MCP `AskUserQuestion`，注入 `--allowedTools`，将 `MCP_TOOL_TIMEOUT` 提升到 300 秒，并在 pending question 期间保持发送队列。

准确状态是：

> **非 plan AskUserQuestion 已实现；尚缺 deferred cargo test，以及多选问题打断 2–3 条 queued messages 的 rebuilt app 验收。**

优先级：高。它涉及交互式问答、超时 settlement 与发送队列一致性。

### C2. Large-history conversation rendering

当前代码已经具备 heavy-row render weight、virtualized timeline、非可见 heavy row summary/deferred hydration、presentation scope 隔离、lightweight mode、anchor/remeasure protection 和 renderer diagnostics。

准确状态是：

> **大型会话性能治理已落地；尚缺真实长历史的打开、滚动、anchor jump、heavy card 展开、Composer 输入与按钮响应证据。**

优先级：高。不要在取得运行数据前再启动一轮 renderer 重写。

### C3. Claude lightweight streaming

Claude streaming 已接入 lightweight/staged rendering 路径，代码和自动化任务已完成。剩余 gate 是打包版 FPS/main-thread trace、视觉保真和 human acceptance。

它应与 C2 合并为一条 conversation-performance 验收轨道，避免两个 change 分别修改相邻渲染边界。

## D. Implementation Backlog：确实尚未完成

### D1. Sidebar catalog / workspace hydration

“Sidebar 没有分页”已经不是事实。现有实现使用 `cursor`、`pageSize`、`next_cursor`、page cap 与 `loadOlderThreadsForWorkspace`；commit `25934252` 还修复了 unhydrated workspace loading。

真正未完成的是 contract 与 evidence：

- bounded first-page projection 是否稳定响应；
- continuation cursor 是否正确保留；
- stale result 是否不会覆盖新查询；
- per-workspace staged hydration 是否阻塞前台 thread switching；
- partial/degraded source 是否错误扩大 authoritative membership。

相关 change：

- `fix-sidebar-session-catalog-progressive-loading`：`0/8`；
- `redesign-workspace-sidebar-session-loading`：`0/11`。

优先级：中高。先补 contract test 和 profiling，再决定是否需要修改生产代码。

### D2. OpenCode / Gemini CLI retirement

`2026-06-24-retire-opencode-and-gemini-cli` 当前为 `4/48`。代码仍保留 frontend、history、provider、IPC、runtime 和 legacy data compatibility 面，因此这是大型 cross-layer migration，不是简单删除两个菜单项。

优先级：中。先完成 capability inventory、legacy deserialize/fallback contract 与 staged deletion plan；不要在 closure 和 conversation-performance evidence 之前扩大删除面。

### D3. Release sccache

`2026-06-22-release-pipeline-cache-sccache` 当前为 `7/13`。workflow 静态配置已落地，真正缺少的是 live release run：

- cold/hot wall-clock；
- 四个平台 artifact 完整性；
- sccache 写入体积与 quota；
- runner compatibility fallback。

优先级：中。该项影响工程效率，不直接阻塞终端用户工作流。

### D4. CLI thread rename inference

当前代码仍未发现 `cliRenameAlias`、`cli_rename_alias` 或从 Claude/Codex JSONL `/rename` 提取 title 的实现。`2026-06-24-infer-thread-rename-from-claude-codex-jsonl` 为 `0/31`。

优先级：中低。它是明确的体验 backlog，但应晚于 closure 和核心性能验收。

## E. 暂不直接立项的判断

以下判断仍缺少足够证据：

- **Codex / Claude capability 不对齐**：需要 capability matrix，而不是抽象结论。
- **AppShell `@ts-nocheck` 残留**：`src/app-shell.tsx` 当前没有该标记，不能把其他模块残留归因于 AppShell。
- **i18n namespace 未完全覆盖**：需要硬编码扫描、模块范围和用户影响统计。
- **395 个 main specs 未验证**：schema validation 与 implementation evidence 是不同概念；准确表述应是“证据覆盖不均匀”。

## 推荐执行顺序

```text
Phase 0：治理事实校准
├── 更新 openspec/project.md 的 16 / 598 / 395 快照
├── 回写 Codex thread continuity 的 commit / record 状态
└── 核对 Codex subagent change 的 Trellis record 归因

Phase 1：Completed change closure
├── fix-codex-subagent-sidebar-projection
├── fallback-untracked-added-file-empty-inline-diff
└── add-turn-file-summary-modal-diff-preview

Phase 2：运行与平台验收
├── Workspace drop overlay rebuilt-app test
├── Streaming render perf trace
├── Claude Runtime MCP panel QA
├── Linux native menu startup QA
├── AskUserQuestion non-plan cargo + queue test
└── Large-history + Claude lightweight streaming performance acceptance

Phase 3：真实 implementation backlog
├── Sidebar catalog / workspace hydration contract validation
├── OpenCode / Gemini retirement staged migration
├── Release sccache live workflow validation
└── CLI thread rename inference

Phase 4：取证后再立项
├── Provider capability matrix
├── i18n coverage audit
└── Spec implementation-evidence coverage report
```

## 验收口径

项目只有同时满足适用条件，才能从“风险/待处理”移入“完成”：

1. 当前代码、Git commit、Trellis session record、`tasks.md` 与 `verification.md` 状态一致。
2. focused tests 与适用的 typecheck/lint/cargo gate 通过，或明确记录 base branch 的既有失败。
3. 需要 runtime 行为的 change 必须具备 rebuilt app / target platform evidence。
4. 性能 change 必须提供可比较的 trace、FPS、frame gap、CPU 或 wall-clock 数据。
5. strict validation 只证明 artifact structure；不能替代 implementation/runtime evidence。
6. closure 完成后执行 spec sync/archive，并重新校准 `openspec/project.md` inventory。

## 事实来源

- 当前 Git HEAD 与 `git log --since='2026-07-15'`
- `openspec list`
- `openspec/changes/*/tasks.md`
- `openspec/changes/*/verification.md`
- `.trellis/workspace/chenxiangning/journal-24.md`
- `.trellis/workspace/chenxiangning/journal-25.md`
- `openspec/project.md`（仅作为 2026-07-15 19:46 历史快照）
- `src-tauri/src/engine/claude.rs`
- `src-tauri/src/engine/claude/askuser_mcp.rs`
- `src/features/messages/timeline/virtualization/messagesTimelineHydration.ts`
- `src/features/threads/hooks/useThreadItemEvents.ts`
- `src/features/threads/hooks/useThreadActions.ts`
- `src-tauri/src/lib.rs`
- `src-tauri/src/menu.rs`

---

## 附录 A — 2026-08-01 对照现状（不改写上文）

> 原则：上文 A–E 与 Phase 0–4 **保持原样**（过程证据）。本附录只回答「那些 change 现在怎样了、今天该看哪里」。

### A.0 基线

| 项 | 2026-07-16 快照 | 2026-08-01 校准 |
|----|-----------------|-----------------|
| 产品版本语境 | v0.7.3 分支 | **`0.7.14`** |
| 本文角色 | 执行建议 | **历史快照 + 对照表** |
| OpenSpec 数量（文内） | active 16 / archive 598 / specs 395 | **勿沿用**；以 `openspec/changes` 目录与 `openspec list` 为准（校准日约 active≈49 / archive≈782 / specs≈456，仍会漂移） |
| `openspec/project.md` | 已注明可能落后 | 仍可能落后；**不以它单独当数量源** |

### A.1 文中 change 归宿（抽样对照）

| 文中 change | 2026-07-16 建议 | 2026-08-01 目录事实 |
|-------------|-----------------|---------------------|
| `fix-codex-subagent-sidebar-projection` | archive 评估 | **已 archive** |
| `fallback-untracked-added-file-empty-inline-diff` | archive | **已 archive** |
| `add-turn-file-summary-modal-diff-preview` | archive | **已 archive** |
| `fix-codex-thread-start-continuity-and-recovery` | 回写 artifacts | **已 archive** |
| `fix-workspace-drop-overlay-leave-settlement` | rebuilt-app 验收 | **已 archive** |
| `optimize-conversation-streaming-render-perf` | runtime evidence | **已 archive** |
| `add-claude-runtime-mcp-servers-panel` | 手工 QA | **已 archive** |
| `fix-sidebar-session-catalog-progressive-loading` | contract | **已 archive** |
| `redesign-workspace-sidebar-session-loading` | contract | **已 archive** |
| `add-linux-native-menu-localization` | Linux smoke | **仍 active**（目录存在） |
| `2026-06-24-retire-opencode-and-gemini-cli` 等 | staged migration | 以当前 active/archive 目录为准（OpenCode 后续有 restore 等轨） |

### A.2 文中「风险已关闭」— 仍成立

- Codex settled turn 不因迟到 progress 复活（B1）— 保持「勿重开」
- Diff 新增/编辑入口链（B2）— 保持；细节见后续 archive
- Codex 子代理侧栏投影（B3）— 已 archive

### A.3 文中 C 类（性能/AskUser）— 读法更新

| 当时条目 | 2026-08 读法 |
|----------|--------------|
| C1 AskUserQuestion 非 plan | 仍以代码 + 手测为准；勿用本附录代替 verification |
| C2 大型会话渲染 | 尾窗 / 虚拟化 / live-text 仍是主护栏；**对话/行级轻量墙已下线**（`bf3b35bd6`），勿再按「lightweight 摘要墙」验收 |
| C3 Claude lightweight streaming | 与 C2 合并验收轨道的建议仍合理；具体 change 是否仍 active 查目录 |

### A.4 2026-07 之后已落地、本文未覆盖的轨道（补索引）

| 主题 | commit / 文档 | 说明 |
|------|---------------|------|
| 统一幕布轻量下线 + Grok 桥 + 藏 bash | `bf3b35bd6` · structure · matrix · unify-review | 替代「再开一轮 renderer 摘要墙」 |
| 滚动所有权状态机 | `b34fdaead` · structure §7.3 · scroll plan | A 飞顶 / F 离真底架构轨 |
| Native/Shared 供应商与 freeform 模型 | `e2ac4a1a6` · `fb6083584` · `44fcf26a6` · native-session 文 | 不盖盘 + 点选勾选 |
| React #185 useModels | `4c5e97c8e` · react-185 playbook | 冷启动 effort 双写 |

### A.5 今日建议阅读顺序（替代文内 Phase 0–4 作为执行队列）

```text
1. docs/analysis/README.md          — 地图与 commit 锚点
2. conversation-canvas-structure    — 现网幕布
3. canvas-live-tool-projection-matrix + 手测
4. scroll ownership plan/change     — A/F 实机
5. close-native-session-provider…   — 是否 archive
6. 仍 active 的平台/产品 change      — 如 Linux menu 等（openspec list）
```

**不要**再按本文 Phase 1 去 archive 已 archive 的 change；**不要**把 16/598/395 抄进新文档当现数。

### A.6 附录修订

| 日期 | 说明 |
|------|------|
| 2026-08-01 | 全文保留为历史快照；新增附录 A 对照归宿与新轨道索引 |
