# 当前工程工具链优化现状与影响范围

> **2026-08-01 生命周期校准**：Historical Closure Evidence。本文只证明当时目标文件与 gate 状态；当前 large-file / OpenSpec / governance 结论必须重跑对应命令，不能继承 2026-07-26 的数量。
> **复核日期**：2026-07-26（二次复核于 `713ef5f2c`：14 项 gate 失败及构成、全部行数、openspec 447/2 结果与本文一致，无事实变更）
>
> **代码基线**：分支 `feature/v-0710`，HEAD `713ef5f2c`（内容等价于首次复核基线 `f287e2374`，其间仅 trellis/docs 提交）
>
> **工作区状态**：复核开始时 clean；本文更新尚未提交
>
> **复核口径**：以当前代码、production import graph、OpenSpec main specs、增量测试和 static gate 为准；未跑全量测试

本轮重新实施 #1、#2、#7、#8、#9、#10、#11。七项均形成代码、增量测试、review、OpenSpec archive、commit 和 Trellis session record 闭环。

需要区分两个结论：

- **本轮目标已闭环**：Git/File 两个目标入口已退出 large-file gate；Terminal、annotation、diff presentation 和 Markdown renderer boundary 已落地。
- **仓库全局债务未清零**：`check:large-files:gate` 仍有 14 项失败，集中在 Git History、Threads、Rust runtime、CSS，以及一个 855 行的新 Rust 文件。不能把目标文件达标写成全局 gate 变绿。

## 状态总览

| # | 优化项 | 当前状态 | 最新事实 |
|---|---|---|---|
| 1 | Git History 大面积 `@ts-nocheck` | ✅ 完成 | 5 个核心文件 `@ts-nocheck` 从 5 降为 0；原 494 条 diagnostics 清零 |
| 2 | `GitDiffPanel` / `FileViewPanel` 超大文件 | ✅ 目标完成；全局 gate 未清零 | production 分别 2,994 / 2,997 行；主测试拆为 `<800` 行 parts；全局仍 14 项失败 |
| 3 | File View 重复纯函数 | ✅ 完成 | shared/internals 重复 export 为 0 |
| 4 | 文件外部变更 2s 轮询 | ✅ 完成 | 30s visibility-gated fallback + watcher |
| 5 | `aiReview` 无生产者 | ✅ 完成 | producer、summary consumer、renderer 闭环 |
| 6 | AI commit message 选择入口 | ✅ 当前需求完成 | 固定三层入口：常驻按钮 → engine/last config → 中文/English；可随时切换 |
| 7 | Worktree AI commit 重复实现 | ✅ generation contract 完成 | 两入口共享 168 行 `useCommitMessageGenerationMenu`；stage/commit scope policy 仍各自保留 |
| 8 | Terminal 能力不足 | ✅ 本轮范围完成 | SearchAddon + WebLinksAddon + 原 Composer handoff；addon 失败不阻塞基础 terminal |
| 9 | Code annotation 锚点漂移 | ✅ 完成 | versioned snapshot/context fingerprint；±120 行 exact relocation；歧义返回 stale |
| 10 | Diff/compare 平行演化 | ✅ shared core 完成 | editable/review/read-only 共用 `DiffPresentationEntry`；surface policy 继续分离 |
| 11 | Markdown legacy renderer 边界 | ✅ 完成 | 567 行 canonical router；1,581 行 Rich 显式 fallback；Fast 旧入口仅 11 行 alias |
| 12 | Live Edit Preview stale mock | ✅ 完成 | mock 路径与生产 hook 对齐 |

## 本轮提交与验证

| 批次 | Commit | 范围 | 增量验证 |
|---|---|---|---|
| 1 | `38b5134b1` | #1 Git History type safety | 62 个 Git History tests；typecheck、ESLint、import checks |
| 2 | `26cbce638` | #2/#7/#10 Git/File modularity | GitDiff/FileView/diff focused tests；typecheck、ESLint |
| 3 | `d8b592095` | #8 Terminal search/web links | 26 个 terminal tests；typecheck、ESLint |
| 4 | `175edc732` | #9 annotation anchor | 44 个 annotation/FileView/Git diff tests；typecheck、ESLint |
| 5 | `dbd17d55c` | #11 Markdown boundary | 74 个 Markdown/FileView tests；typecheck、ESLint |
| Follow-up | `68e5c2e3c` | 消除 #9 对 #2 的行数回退 | 41 个 annotation/FileView tests；FileView 回落到 2,997 行 |
| Follow-up | `380d1c016`、`35740d89a` | 遵守 Markdown new-file ratchet | 74 个 tests；large-file failures 从 15 回落到 14 |

所有上述 code commit 均已执行 Trellis session record；对应 OpenSpec change 已 archive，main specs 已同步。

最终 `openspec validate --all --strict --no-interactive` 结果为 447 项通过、2 项失败。本轮相关 main specs 全部通过；失败项是既有 active changes `add-tokentracker-usage-dashboard` 和 `reduce-client-polling-overhead`。

## 影响范围矩阵

| 项 | 用户可见影响 | Runtime / IO | 代码与维护 | Gate / 测试 |
|---|---|---|---|---|
| #1 | 无 UI 变化 | Git 行为不变 | 高危 Git props/handlers 恢复类型保护 | diagnostics 494 → 0；但 Git History Impl/View 进入 large-file debt |
| #2 | 无交互变化 | 原 effects/state 生命周期保持 | Git/File 高频入口与测试按 capability 拆分 | 两个目标 production 文件低于 3,000；全局仍 14 failures |
| #7 | 两入口保持相同三层选择 | generation guard/persistence 统一 | engine、language、last config、busy guard 单一事实源 | 两套 UI tests + shared hook contract |
| #8 | Terminal 支持 Cmd/Ctrl+F、前后查找、安全 URL 点击 | addons 动态加载；失败时保留基础 terminal | 搜索、链接、Composer handoff 契约集中 | 26 个 focused tests |
| #9 | 编辑后批注可随原代码移动；prompt 带选中 snapshot | 每个 annotation 最多检查 241 个候选 start line | anchor v1、legacy compatibility、stale status | 插入、重复、越界、旧数据 tests |
| #10 | 不同 diff surface 的 path/name/media 展示一致 | 无新增 IPC | shared data model；editing/review/read-only policy 不强行合并 | model + surface tests |
| #11 | fast/rich/fallback、outline、Mermaid、图片行为保持 | router-only state 不再重挂载 Rich subtree | production import 单向；Fast 兼容层无逻辑 | 74 tests + import-graph contract |

## 1. Git History 已恢复类型保护

**结论**：5 个核心文件已无 `@ts-nocheck`。

| 文件 | 当前行数 | TypeScript 状态 |
|---|---:|---|
| `GitHistoryPanelImpl.tsx` | 4,841 | strict checked |
| `GitHistoryPanelView.tsx` | 3,226 | strict checked |
| `useGitHistoryPanelInteractions.tsx` | 2,778 | strict checked |
| `GitHistoryPanelDialogs.tsx` | 2,024 | strict checked |
| `GitHistoryPanelPickers.tsx` | 493 | strict checked |

实施中修复了真实的 cleanup/state 问题，并为跨层 props 建立显式 scope contract。代价也必须说明：为一次性恢复类型保护生成了大量显式类型，`Impl` 和 `View` 行数明显增加，并成为当前 large-file gate 的两项失败。

**当前判断**：类型安全目标完成；后续应按 capability 拆 Git History 文件，而不是重新引入 `@ts-nocheck` 或压缩类型逃避 gate。

## 2. Git/File 两个目标入口已退出 large-file gate

**结论**：本项指定的 production 与 primary test targets 已达标。

- `GitDiffPanel.tsx`：2,994 行
- `FileViewPanel.tsx`：2,997 行
- GitDiff test parts：最大 642 行
- FileView test parts：最大 551 行

本轮不是纯机械切行：

- AI commit menu/generation 抽到 shared hook。
- diff entry normalization 抽到 shared presentation model。
- primary tests 拆为可独立运行的 capability parts。
- #9 集成一度令 `FileViewPanel` 回升到 3,016 行；最终审计将 anchor attach/relocation 下沉到 code-annotation helper，恢复到 2,997 行。

**全局剩余**：`pnpm run check:large-files:gate` 当前仍报告 14 项失败。目标文件不在列表；剩余包含 Git History 2 项、Threads 3 项、Rust 7 项、CSS 1 项、test 1 项。

## 3. File View 重复纯函数已清理

`fileViewPanelShared.ts` 与 `fileViewPanelInternals.ts` 的重复 export 为 0，`EXTERNAL_CHANGE_POLL_INTERVAL_MS` 保持单一事实源。后续只需防止 helper 再复制。

## 4. 外部文件变化轮询已治理

fallback 从 2s 调整到 30s，并受 page visibility gate 控制；watcher event 和 fallback 统一进入 `refreshFromDisk`。隐藏窗口不再持续 polling，递归 `setTimeout` 避免慢 IO 重叠。

## 5. `aiReview` 已形成生产闭环

`WorkspaceSessionActivityPanel` 通过 `useTurnSemanticReview` 生产 facts，`semanticDiffSummary` 消费并渲染。当前剩余问题是 facts 质量和成本，不是缺生产者。

## 6. AI commit message 三层选择已恢复

当前固定交互：

1. 常驻 AI commit button。
2. 选择“使用上次配置”、Codex 或 Claude。
3. 选择 engine 后再选中文或 English。

历史配置只作为显式快捷项；retired/disabled engine 不能借旧配置绕过 catalog。`GitDiffPanel` 与 `GitHistoryWorktreePanel` 均可在每次生成时重新切换 engine 和 language。

流式生成没有混入本轮。它需要 adapter streaming、cancel、partial-result 和 input overwrite contract，应作为独立产品需求，不影响“三层选择已恢复”的完成结论。

## 7. AI commit generation 已共享，scope policy 保持分离

两个入口共同使用 `useCommitMessageGenerationMenu`，统一：

- busy/canGenerate guard
- engine execution policy
- last config 校验与持久化
- engine menu 和 language menu
- generation 调用 contract

没有强行合并 stage/unstage/commit UI。原因是 Git Changes 使用 repository selections，Worktree 使用 path selections，二者 scope policy 不同。继续抽成“大一统 controller”会把 surface policy 塞进 boolean/options，收益低于复杂度。

## 8. Terminal 搜索与安全链接已上线

新增依赖：

- `@xterm/addon-search@^0.15.0`
- `@xterm/addon-web-links@^0.11.0`

用户能力：

- Cmd/Ctrl+F 打开 search bar。
- Enter / Shift+Enter 或按钮查找 next/previous。
- Escape 关闭；无匹配显示 no-results。
- 仅 `http:` / `https:` 交给 desktop opener。
- terminal selection 发送 Composer 的原能力保持。

addon 通过 `Promise.allSettled` 加载；Search/WebLinks 任一失败不会阻止基础 xterm 初始化。`SerializeAddon` 未加入，因为 session persistence 是不同的数据生命周期，不应顺手扩 scope。

## 9. Code annotation 已具备抗漂移 anchor

`CodeAnnotationAnchor v1` 保存：

- exact `selectedText`
- 最多两行 prefix/suffix context
- deterministic fingerprint

解析策略：

1. 先验证原 line range。
2. 失配后仅搜索原 start line 前后 120 行。
3. 候选必须 exact match selected snapshot。
4. 多候选必须由 context fingerprint 唯一消歧。
5. 无唯一结果返回 `stale`，不做全文件 fuzzy guess。

旧 annotation 没有 anchor 时保持原行为。新 annotation 写入 prompt 时附带 selected snapshot，降低行号漂移对 AI 上下文的影响。

## 10. Diff/compare 共用 presentation core

`diffPresentationModel.ts` 定义 path、status、diff、fileName 和 image metadata 的共同 contract；`WorkspaceEditableDiffCompare`、`WorkspaceEditableDiffReviewSurface`、`WorkspaceReadOnlyDiffCompare` 已消费该 contract。

没有合并所有 surface component。editing、review annotation、read-only policy 和 toolbar 本来就不同；本轮只统一会漂移的 data presentation，不创建全能组件。

## 11. Markdown renderer 边界已显式化

当前 production graph：

```text
FileViewBody
  -> FileMarkdownPreviewRouter.tsx (567 lines, canonical router)
       -> fast HTML renderer
       -> FileMarkdownPreview.tsx / FileMarkdownPreviewRich (1,581 lines)

FileMarkdownPreviewFast.tsx (11 lines)
  -> compatibility alias to canonical router
```

关键变化：

- production 不再 import 名称误导的 Fast wrapper。
- canonical router 明确拥有 profile、outline 和 fast-to-rich fallback。
- Rich implementation 显式导出，保留在原 baseline-tracked path，未制造新的 >800 行文件。
- Fast 旧入口只 re-export，无 state、handler、fallback logic。
- stable empty annotations + `memo` 隔离 router outline churn，修复 Mermaid subtree 重挂载。

Rich fallback 没有删除。它仍承载 local image、Mermaid、math、annotation 和完整 ReactMarkdown 语义；删除它会造成功能回退。当前闭环点是依赖方向与 ownership，而不是虚假的“legacy 行数归零”。

## 12. Live Edit Preview stale mock 已修复

startup test mock 已指向真实 `useLiveEditPreview` 路径，避免 IPC/storage side effects 泄漏进测试。

## 当前剩余工程债务

| 优先级 | 债务 | 建议动作 |
|---:|---|---|
| P0 | `app_server_cli.rs`、`engine/commands.rs`、`codex/mod.rs` 仍超 bridge-runtime threshold | 按 command domain 拆分，保留 facade |
| P1 | Git History Impl/View 4,841 / 3,226 行 | 基于已恢复的类型 contract 按 interaction slice 拆分 |
| P1 | Threads 三个 hook/test 超限 | 先拆 reducer actions 与 runtime effects |
| P1 | `file-view-panel.css` 2,972 行 | 按 preview/editor/navigation capability 拆 style owner |
| P1 | `storage.rs` 855 行触发 new-file ratchet | 回退到 800 行内或拆 persistence domain |
| P2 | `tauri.test.ts`、`useThreadActions.test.tsx` 超限 | 拆为 independently runnable test parts |

## 最终结论

本轮七项不是只改文档状态：每项都有 production code、focused tests、review、OpenSpec main spec 和 session evidence。当前最大新增价值是：

1. Git History 高危链路重新受 TypeScript 保护。
2. Git/File 两个高频入口退出本项 large-file gate。
3. AI commit、diff、annotation、Terminal、Markdown 都建立了明确 shared contract。
4. 两次跨批次 gate 回退在最终审计中被发现并修复，没有带着“局部通过”假装闭环。

下一轮不应回头重做这七项；应直接处理上表 14 项全局 large-file debt，优先 Git History 和 bridge-runtime-critical Rust 文件。
