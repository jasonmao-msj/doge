# 客户端辅助功能与技术债务综合治理报告（合并版）

> **2026-08-01 生命周期校准**：Historical Evidence Snapshot。本文保存 2026-07-25～26 的审计与收口过程，不是当前 debt checklist；任何残余项须对 `0.7.14` 当前代码与 OpenSpec 重新立证。
> **日期**：2026-07-25
> **原始基线**：分支 `feature/v-078` @ `a9c479d57`
> **复核基线**：分支 `feature/v-799` @ `c75922dec`（2026-07-25）
> **最新复核**：分支 `feature/v-0710` @ `713ef5f2cd`（2026-07-26）
> **来源**：合并以下三份报告并去冗余
> - `client-aux-modules-optimization-report-2026-07-24.md`
> - `p0-reprioritized-decision-board-2026-07-24.md`
> - `polling-inventory-2026-07-25.md`
> **增量校准**：交叉核对 `composer-prompt-stack-optimization-impact-2026-07-25.md`、`search-navigation-optimization-impact-2026-07-25.md`、`engineering-toolchain-optimization-impact-2026-07-25.md`
> **范围**：除画布/幕布渲染外，前端辅助功能、系统运维、治理层的技术债务与智能化机会
> **复核方法**：全量扫描 `src/**`、`src-tauri/src/**`、配置、测试、large-file policy、OpenSpec artifacts；逐项核对生产 caller，不以文件存在或单次提交说明代替调用链证据

---

## 〇、执行摘要（大白话）

这份报告回答一个问题：**这个客户端除了主画布以外，输入框、看板、设置、搜索、Git、语音、记忆……这些你每天点的功能，哪些做得糙、哪些做了一半、哪些能加 AI 让你更省事**。

核心结论一句话：**不是缺 AI 功能，而是垃圾没扔、半成品没接电、AI 输出靠猜**。

### 本次复核修订

本次按当前 HEAD 全量复核 3,286 个 TypeScript/JavaScript/Rust 源文件，并交叉检查生产 caller、测试、OpenSpec 与 static gate。07-25 报告创建后，输入体系、搜索导航和工程工具链已有连续实现，以下变化会直接影响治理优先级：

- Composer 清理批次已闭环输入历史双写、重复 autocomplete 计算和命令目录轮询；prompt enhancer、结构化 skill invocation 与“对话→Prompt”已部分落地。
- Git History 5 个核心文件已全部摘除 `@ts-nocheck`，原 494 条 diagnostics 清零；代价是 `GitHistoryPanelImpl.tsx` 增至 4,841 行、`GitHistoryPanelView.tsx` 增至 3,226 行，二者成为新的 large-file failure。
- `GitDiffPanel.tsx` / `FileViewPanel.tsx` 已降到 2,994 / 2,997 行，primary tests 已拆成小于 800 行的 parts；全局 large-file gate 仍有 14 项失败，不能把目标文件达标写成全局闭环。
- Terminal 已接入 `SearchAddon` / `WebLinksAddon`；code annotation 已增加 versioned snapshot 与精确重定位；diff surfaces 已共享 presentation model；Markdown preview 已形成 router / rich fallback / compatibility alias 单向边界。
- message search 已按 immutable snapshot 使用 `WeakMap` 缓存索引；worktree 不再生成随机默认分支名，改为显式输入。QuickSwitcher 的无搜索、30 条上限属于现行 OpenSpec contract，不应继续列作缺陷。
- Skills Hub 已补 `add-skills-hub-management` 追溯 change，但尚未 sync/archive 成 main spec；OpenSpec 当前目录为 active=13、archive=738、specs=436，`changes/README.md` 与 `project.md` 的快照仍未同步。
- browser action 仍只有 `runBrowserAgentAction` Tauri wrapper，无业务 UI consumer；Composer 调用 `useStatusPanelData` 仍未传 `activeEngine`，非 Codex 引擎仍可能回退成 Claude。
- 当前关键体量：`GitHistoryPanelImpl.tsx` 4,841 行、`daemon_state.rs` 3,325 行、`GitHistoryPanelView.tsx` 3,226 行、`useThreads.ts` 3,041 行、`skills_hub.rs` 2,995 行、`GitDiffPanel.tsx` 2,994 行、`FileViewPanel.tsx` 2,997 行、`useAppServerEvents.ts` 2,988 行。

### 全量扫描基线

| 指标 | 当前值 | 治理含义 |
|---|---:|---|
| TypeScript / JavaScript / Rust 源文件 | 3,286 | 本次扫描覆盖 `src/**` 与 `src-tauri/src/**`，不是只看最近提交 |
| 非测试源码总行数 | 676,807 | large-file 问题是系统性存量，不是单文件异常 |
| 非测试源码中 ≥1000 行文件 | 153 | 需要按高变更频率和不可逆操作风险排序，而不是一次性全拆 |
| 非测试源码中 ≥2400 行文件 | 33 | 已进入 `feature-hotpath` warning 或接近 default-source warning |
| 非测试源码中 ≥2800 行文件 | 15 | 体量事实不等于 gate failure 数；不同 policy kind 阈值不同，且测试文件另计 |
| `@ts-nocheck` 生产文件 | 1 | 仅剩 25 行 minified `SpecHubPresentationalImpl.tsx`；Git History 5 个核心文件已清零 |

### large-file gate 当前红灯明细

| failure 类别 | 数量 | 当前文件 |
|---|---:|---|
| Frontend production policy hard | 5 | `GitHistoryPanelImpl.tsx` 4841、`GitHistoryPanelView.tsx` 3226、`useThreads.ts` 3041、`file-view-panel.css` 2972、`useThreadsReducer.ts` 2871 |
| Rust production policy hard | 6 | `daemon_state.rs` 3325、`daemon/git.rs` 3079、`session_management.rs` 3074、`backend/app_server_cli.rs` 2894、`engine/commands.rs` 2860、`codex/mod.rs` 2622 |
| Test policy hard | 2 | `services/tauri.test.ts` 3320、`useThreadActions.test.tsx` 3229 |
| New-file ratchet | 1 | `src-tauri/src/storage.rs` 855；当前不在 `large-file-new-file-baseline.json` |

根因分两层：

1. `docs/architecture/large-file-baseline.json` 当前 `entries` 为空，因此 13 个超过各自 hard threshold 的文件都被判为 `status=new`，不能按“存量已接纳”解释。
2. `large-file-new-file-baseline.json` 虽含大量大文件，却遗漏当前 855 行的 `src-tauri/src/storage.rs`，触发独立 new-file ratchet。

> 🛠 **深度推演**：本轮证明“恢复 contract”比“机械拆行”更有效：Git/File 入口通过 shared hook、presentation model、renderer router 和 test harness 降低耦合，但 Git History 为恢复类型安全反而扩大了文件体量。large-file 数字只能做触发器，不能替代 owner 设计。下一阶段应先让 OpenSpec 与 gate 恢复可信，再按 capability 拆 Git History / Threads / Rust runtime，最后推进 AI 增强。

### 已闭环事项（07-24 ~ 07-26）

| 项 | 状态 | 解决什么问题 | 关键提交 / 备注 |
|---|---|---|---|
| P0-1 settings 加载失败静默修复 | ✅ | 设置文件损坏时前后端都无声回退默认值，保存会不可逆覆盖原文件 | `a1dd0795b` + `c3d472a34` + `ae0927a17` |
| P0-2 引擎二元假设 + `isValidModelId` 不一致 | 🔶 | model id 双源已修；StatusPanel 主路径已透传真实引擎，但 Composer sibling caller 仍遗漏 `activeEngine` | `38e139b37` + `bfb61b9e2`；按 `useStatusPanelData(performanceScopedItems` 定位 |
| P0-3 SettingsView 摘 `@ts-nocheck` + skills 死分支 | ✅ | 设置页已恢复类型检查，旧 `SkillsSection.tsx` 已删除；2545 行体量债务仍保留 | `29ef72543` / `37d545f4f` / `b1a2ea4a5` |
| P0-4 specs 索引补登 26 项 | ✅ | 当时把 capability 索引从 403 补至 429；当前 main spec 目录已增至 436 | `0a723b7ec` + `6bb5fc5f0` |
| `read_workspaces` 静默回退 | ✅ | workspaces.json 损坏同样无声覆盖 | `d51c7dee0` + `d87d62165` + `9cdd61c15` |
| #19 dock streaming 死分支 | ✅ | "streaming" 状态永不可达却残留组件/CSS | `f91ab9a4a` + `140963bc1` |
| #21 常驻轮询优化 | ✅ | worktree/kanban/output/dock/dictation 五处高频率轮询改造成事件驱动或门控降频 | `d042e5018` + `9ca8d2b19` |
| P1-5 aiReview 生产者接线 | ✅ | Session Activity 语义 diff 评审位永远空着 | `053cfbc04` + `140963bc1` |
| P1-7 死代码与 renderer 边界清理 | ✅ | bridge no-op、refreshCodexModelConfig、latestAgentRuns、响应式布局、SHOW_*、`ComposerInput.tsx`、`SkillsSection.tsx` 已清；Markdown router / rich fallback / alias 边界已显式化 | `dbd17d55c` + `380d1c016` + `35740d89a` |
| Composer 输入/补全/commands 批次 | ✅ | 输入历史收敛为单一 store；重复 autocomplete 计算删除；commands 改 fs watch + 显式错误 | `9484986c8` + `32092503c` + `296fad4a5` |
| 工程工具链目标批次 | ✅ 目标闭环 | Git History 恢复 typecheck；Git/File 目标文件退出 gate；Terminal、annotation、diff、Markdown boundary 落地 | `38b5134b1` ~ `35740d89a`；全局 gate 仍红 |
| Search index / worktree default | ✅ | message index 按 snapshot 缓存；随机默认分支名移除 | `d077890b8` |
| P0-H large-file gate | ❌ 当前红灯 | policy/baseline/CI wiring 已落地，本次命令实测失败 14 项；hard baseline 为空，new-file baseline 又遗漏 `src-tauri/src/storage.rs` | `npm run check:large-files:gate`；`.artifacts/large-files-gate.json` |
| Skills 长列表渲染 | ✅ | installed skills 超过 80 条后只渲染可视窗口，并固定批量操作栏 | `c75922dec`；`SkillsPage.jsx:449-636` |

### 仍需你做决策

- **browser 动作管线**：Tauri wrapper 已导出但业务 UI 无消费者，**接通 or 删除二选一**。
- **记忆语义检索**：embedding 方案没定（本地模型 vs 复用引擎通道），不能按"差一步"估算。
- **GitHub URL / rebrand**：About、Settings、updater 与 bundle identifier 都沿用上游身份，要改就是一组改动。
- **任务 AI 验收判定**：原 follow-up 机制已随编排中心删除，需重建。
- **QuickSwitcher 边界**：现行 spec 明确它是无搜索的 compact recent-context surface；是否与 Global Search 合并必须先改产品 contract。

---

## 一、问题清单总表

### 1. 输入与提示词体系（composer / prompts / commands / skills / curated-skills）

| 问题 | 原因 / 现状证据 | 影响（大白话） | 优先级 | 状态 | 建议 |
|---|---|---|---|---|---|
| `ComposerInput.tsx` JCEF 死实现 | 本体、adapter 迁移注释与 guard test 旧命名均已清理 | 已不再进入产物，也不再留下误导性迁移叙事 | P0 | ✅ 已闭环 | — |
| Composer 组件成"上帝组件" | `Composer.tsx` 2528 行 / `ChatInputBoxAdapter.tsx` 2204 行 / `ChatInputBox.tsx` 1773 行；adapter 仍承担大面积透传 | 改一处要翻三栋楼；新功能不敢加 | P1 | 部分减量 | 按职责拆分，消解 adapter 层 |
| 输入历史三套并存、发送时双写 | `usePromptHistory.ts` 与旧 ChatInputBox 内联 history hook 已删除；`useInputHistoryStore` 成为单一 store，发送时单写 | 历史口径与持久化已收敛 | P0 | ✅ 已闭环 | 保持单一 store contract |
| 自动补全两套引擎同时跑 | `useComposerAutocompleteState.ts` 已从约 980 行降至 88 行，只检测 trigger context；候选计算与渲染由 ChatInputBox providers 唯一承担 | 重复候选计算已删除 | P0 | ✅ 已闭环 | 保持 provider 单一计算 owner |
| slash/prompt bridge no-op 死链路 | `providers/slashCommandProvider.ts:244` `sendBridgeEvent` 永远 false；`window.updateSlashCommands` 不会被调用 | ~700 行死链路误导维护者 | P0 | ✅ 已清 | — |
| 自定义命令空结果 15s 冷却 + 全局兜底启发式 | `claude_commands_watch.rs` 提供 fs watch；`useCustomCommands.ts` 订阅事件并显式上报失败；`296fad4a5` 修复 managed command 并发边界 | workspace 命令刷新与错误可见性已恢复 | P1 | ✅ 已闭环 | 保持 watcher 主通道与并发 guard |
| 技能调用纯文本拼接 | `Composer.tsx` 已组装 `skillInvocations` typed metadata 并随消息下发；`promptAssembler.ts` 保留兼容文本；`args` 产品输入通道尚未落地 | 引擎可获得结构化技能身份，但参数仍依赖 prompt | P1 | 🔶 部分完成 | 后续为 `args` 建 typed UI / protocol contract |
| prompt enhancer 粗糙 | 已加入本地化 system prompt、LRU cache、managed command 并发保护；仍是非流式 60s request，未做就地 diff 与稳定错误码分类 | 重复润色与英文偏置已下降，长等待和结果审阅成本仍在 | P1 | 🔶 部分完成 | 流式 + 就地 diff + typed error |
| curated-skills 基础设施与新 Skills Hub 并存 | `CuratedSkillIndicator` 已改 settings event 主通道 + visibility-gated 60s backstop；Extensions Skills 仍走独立 `skills_hub.rs` | 高频设置轮询已消失，两套 skill domain 边界仍需治理 | P1 | 🔶 事件化完成 | 明确 bundled curated skill 与用户安装 skill 的 ownership |
| `skills_hub.rs` 新增即成 2995 行单体 | 测试模块前已有 130 个函数，同时负责 path 安全、registry、trash、GitHub fetch、安装同步、usage 扫描；两个 command 以 `String + serde_json::Value` 做总分发 | 一个协议字段改动会同时影响文件系统、网络、安装和 UI，编译期无法校验 action payload | P1 | 新增债务 | 按 registry/install/discovery/usage 拆模块；为 query/mutation 建 typed request/response |
| `SkillsPage.jsx` 1855 行 / 27 `useState` | `c75922dec` 已为 >80 条 installed skills 增加 88px 固定行高 windowing，并补 sticky bulk actions；页面仍承载安装、仓库、搜索、更新、usage、trash 全流程 | 长列表 mount 风暴已止血，但单页状态与本地 vendor diff 继续扩大 | P1 | 部分修复 | 保留 windowing；按 My/Browse/mutation controller 拆分本地适配层 |
| Skills vendored 偏差登记不完整 | `c75922dec` 修改 `SkillsPage.jsx` 215 行，但 `.trellis/spec/frontend/tokentracker-dashboard-vendored.md` 的“其他适配点”未登记 windowing/sticky toolbar | 下次同步 upstream 时可能把性能修复覆盖掉，或误判为无意 drift | P1 | 未做 | 在 vendored deviation 清单登记 commit、symbol、测试和同步策略 |
| "对话→prompt/skill"一键沉淀缺失 | Messages 已新增 `PromptDistillDialog` 与 `usePromptDistillation`，可把对话存为 Prompt；存为 Skill 尚未实现 | Prompt 沉淀链路已打通，Skill 资产化仍需手工 | P2 | 🔶 部分完成 | 复用 distill contract 增加“存为 Skill” |

### 2. 多代理编排与任务管理（agent-orchestration / agent-catalog / parallel / tasks / kanban / plan）

| 问题 | 原因 / 现状证据 | 影响（大白话） | 优先级 | 状态 | 建议 |
|---|---|---|---|---|---|
| orchestration dispatch 被一行 `= false` 锁死 | `OrchestrationCenterView.tsx:21` `TASK_MODULE_ENTRYPOINTS_ENABLED = false`；按钮、配置面板、350 行派发逻辑已建成但不可达 | "驾驭 AI"核心闭环差一步就能跑 | P0 | ✅ 已闭环（整体删除归档） | 走"接通 or 删除"分支，本次选择删除归档 |
| 看板执行逻辑外泄成 1483 行根 hook | `useAppShellKanbanExecutionSection.ts` 的 20 秒固定轮询已改为 next-due `setTimeout`，但执行锁、thread 对账和 telemetry 回写仍在根链 | 根链仍承载跨域执行状态；维护风险高 | P0 | 部分修复 | 迁入 `features/kanban/execution/` 独立模块 |
| 任务完成判定靠"AI 停止说话" | `:1263-1271` 以停止输出当完成 | AI 报错/停顿也算完成，卡片误判到 testing | P1 | 未做 | 接入真实验收信号或 reviewer turn |
| 周期任务靠字符串签名匹配 | `:1279-1403` 克隆卡片 + 比对标题 | 改标题就断链重来 | P1 | 未做 | 引入稳定任务 ID 或 cron 表达式 |
| 候选任务模板拼接、无排序去重 | `projectMapProvider.ts:266` `Review ${node.title}` | 候选队列噪声大 | P1 | 未做 | LLM 去重/合并/人话标题/排序 |
| 四套状态模型互相有损映射 | 9/8/8/4 值四种状态定义；`review_needed`/`review`/`testing` 语义模糊 | 每加一环智能都要再翻译一次 | P1 | 未做 | 统一成一个 run 状态机 + 视图投影 |
| `parallel` 204 行孤儿模块 | 仅自身测试引用 | 纯死代码 | P0 | ✅ 已删 | — |
| `PlanPanel.tsx` 93 行只读 | 计划不能转任务 | 计划和执行两张皮 | P2 | 未做 | TurnPlan 一键转任务链 |
| agent-catalog 与任务系统零集成 | `KanbanTask` 无 agentId 字段 | 248 个角色没法直接派活 | P2 | 未做 | catalog agent 语义推荐接入任务 |

### 3. 引擎与模型接入层（engine / codex / opencode / models / vendors）

| 问题 | 原因 / 现状证据 | 影响（大白话） | 优先级 | 状态 | 建议 |
|---|---|---|---|---|---|
| `useEngineController` 1008 行 god hook | 能力矩阵半成品；约 20 个子 hook 聚合 | 改引擎/模型逻辑得在千行文件里找位置 | P1 | 未做 | 按能力域拆分 |
| 引擎枚举 3 处硬编码 | `useEngineController.ts:133`、`isSupportedEngineType`、`engineAvailability.ts:4-10` | 新增引擎要改多处，易漏 | P1 | 未做 | 统一引擎 registry 单一事实源 |
| capability matrix 三项永远 "unknown" | `engineCapabilityMatrix.ts:61-63`；运行时 import openspec fixture | 规范归档会破坏构建 | P1 | 未做 | 补 capability 探测，解除 fixture 依赖 |
| 模型/供应商全靠硬编码 | `codexModelCatalog.ts:16-52`、`GEMINI_PRESET_MODEL_IDS`、`CLAUDE_PROVIDER_PRESETS`；Gemini 预设含未发布预览模型 | 厂商发新模型要等客户端发版；列表可能是抄的而不是探测的 | P1 | 未做 | 模型元数据注册表 + 后端探测优先 |
| claude 模型映射读写 3 个 localStorage key | `constants.ts:89-140`；改名迁移代码写了 3 遍 | 同一个配置存三份，容易不同步 | P1 | 未做 | 统一 STORAGE_KEYS |
| `isValidModelId` 双源不一致 | vendors 版 256 字符无正则 vs composer 版 128 字符有正则 | 同一 model id A 入口合法、B 入口非法 | P0 | ✅ 已修 | — |
| claude 错误大面积静默吞掉 | `useProviderManagement.ts:138-139` 等 | 配置失败了你可能毫无知觉 | P1 | 未做 | 显式错误传播 |
| opencode 面板 1011 行启发式 | `inferModelProvider` 20+ 前缀 if 链；hook 层 `inferProviderFromModel` 两套不一致；正则"屏幕抓取"CLI 文案 | 维护困难，易标错 | P1 | 未做 | 统一 provider 推断；结构化 CLI 输出 |
| engine 前缀推断仍大面积散布 | `threadId.startsWith("claude:")` 当前 36 处、分布在 25 个 `src` 文件；"Claude"/"Claude Code"/"Claude CLI" 仍并存 | 同一引擎界面显示不同名字；新增引擎继续扩散分支 | P0-P2 | P0 二元假设已修，系统性问题仍在 | 统一 registry，逐步消除字符串推断 |

### 4. 上下文、记忆与会话管理（context-ledger / project-memory / session-activity / threads / messages / shared-session）

| 问题 | 原因 / 现状证据 | 影响（大白话） | 优先级 | 状态 | 建议 |
|---|---|---|---|---|---|
| 语义检索 544 行建成未接线 | `projectMemorySemanticRetrieval.ts` 完整实现；`useThreadMessaging.ts:535-539` 从不传 `semanticProvider`；`memoryScout.ts:256,262` 分支永远跳过；`ProjectMemoryEmbeddingProvider` 只有接口无生产实现 | 你用的是关键词逐字匹配，"部署"召不回"上线"；544 行骨架空转 | P2 | 未做 | 先定 embedding 方案，再接线或删除 |
| 记忆入库靠机械规则 | `outputDigest.ts:38-60` 正则清洗 + 前 3 句截断；`memoryKindClassifier.ts:20-80` 硬编码关键词打分；`IDENTITY_RECALL_PHRASES` 枚举中文句式 | 记忆质量天花板低；"AI 提炼"其实是规则洗出来的 | P1 | 未做 | 复用 `generateThreadTitle` 通道 LLM 化摘要/分类 |
| 定价 fixture 硬编码 + 预算/成本历史存 localStorage | `pricing/fixtures/claude.ts:11-27`；`budgetStore.ts:41`、`costHistoryStore.ts:25` | 价格调了界面还显示旧价；预算与后端持久化体系不一致 | P1 | 未做 | 远端可更新 + 预算迁后端 |
| threads hooks 四巨石 | `useThreads.ts` 3041 行、`useThreadMessaging.ts` 2545 行、`useThreadEventHandlers.ts` 2567 行、`useThreadActions.ts` 1548 行；`claudeHistoryLoader.ts` 2378 行 | 新增引擎仍需触碰大体量 hook/loader | P2 | 部分变化 | 抽统一事件 schema，泛化 loader/adapter |
| 邮件驱动续聊等边缘功能耦合在核心链 | 非核心能力塞在 threads 主链路 | 核心链路变重；边缘场景污染通用路径 | P1 | 未做 | 边缘能力插件化或剥离 |
| 检索超时硬编码 1.5s | `messageRuntimeController.ts:6` | 大记忆库词法全扫易超时静默降级 | P1 | 未做 | 自适应超时或流式返回 |
| shared-session 绑定双写无 reconcile | 内存 Map + 后端双写；pending id 靠前缀字符串识别 | "明明显示已绑定却找不到会话" | P1 | 未做 | 以后端为单一事实源 |

### 5. 工程工具链（files / git / git-history / terminal / live-edit-preview / code-annotations / markdown）

| 问题 | 原因 / 现状证据 | 影响（大白话） | 优先级 | 状态 | 建议 |
|---|---|---|---|---|---|
| Git History 5 文件共 9438 行 `@ts-nocheck` | 5 个核心文件已全部恢复 typecheck，原 494 条 diagnostics 清零；当前 Impl 4841、View 3226、Interactions 2778、Dialogs 2024、Pickers 493 行 | 高危 Git 链路恢复类型保护，但 Impl / View 已成为 large-file failure | P0 | ✅ 类型安全闭环 | 按 capability 拆文件；禁止重新引入 `@ts-nocheck` |
| `GitDiffPanel.tsx` / `FileViewPanel.tsx` 超大文件 | production 已降至 2994 / 2997 行；primary tests 拆为小于 800 行的 parts；两目标均退出当前 gate failure 清单 | 高频入口的测试与部分 contract 已拆出，但 production 仍接近 3000 行 | P0-P1 | ✅ 目标闭环，债务保留 | 继续按 orchestration / selection / preview owner 拆分，不机械切行 |
| `fileViewPanelShared.ts` / `fileViewPanelInternals.ts` 重复纯函数 | 当前分别 417 / 295 行；重复 export 已清零，internals 复用 shared implementation | 漂移源已移除 | P0 | ✅ 已闭环 | 维持 shared 单一事实源 |
| 文件外部变更 2s 轮询 | watcher 为主通道；fallback 已改为 visibility-gated 30s | 静默期 IPC 与后台空转显著下降 | P1 | ✅ 已闭环 | 保持 watcher + 30s reconcile contract |
| `semanticDiffSummary.ts` 的 `aiReview` 无生产者 | schema/UI 就绪，全仓无调用构造 | "AI 审查本次改动"界面永远等不到内容 | P1 | ✅ 已接线 | `WorkspaceSessionActivityPanel.tsx:719-738` 产出 |
| AI commit message 藏太深 | GitDiff 常驻按钮已支持按 last config 一键生成，并保留 engine / language 切换；尚未流式生成 | 高频入口已可发现，长生成反馈仍不足 | P1 | ✅ 当前需求完成 | 是否增加流式与自动分组需另立体验目标 |
| worktree 面板重复实现 AI commit | GitDiff 与 Worktree 已共享 168 行 `useCommitMessageGenerationMenu`，generation guard / persistence / engine / language contract 收敛；stage/commit scope policy 各自保留 | 生成逻辑漂移源已移除 | P1 | ✅ generation contract 闭环 | 不强行合并两 surface 的 scope policy |
| terminal 零 addon | 已动态加载 `SearchAddon` / `WebLinksAddon`，支持 Cmd/Ctrl+F、前后查找和安全 URL；原 Composer handoff 保留，addon 失败不阻塞 terminal | 搜索与链接能力已补齐；“报错→问 AI”仍缺少结构化上下文 | P1 | 🔶 基础能力闭环 | 后续只补日志诊断 handoff，不重做 terminal runtime |
| code-annotations 批注只带行号 | annotation schema 已增加 versioned snapshot / context fingerprint；±120 行 exact relocation，歧义返回 stale | 编辑插行后可自动重定位，避免静默错绑 | P1 | ✅ 已闭环 | 只有 exact relocation 失败率超预算时再评估 AI 重定位 |
| diff/compare 组件族 6+ 个平行演化 | editable / review / read-only surfaces 已共享 `DiffPresentationEntry` 与 normalization core；editing policy 仍独立 | path/name/media 展示事实源已统一 | P2 | ✅ shared core 闭环 | 保留 surface policy 分层 |
| Markdown preview renderer 边界混乱 | `FileMarkdownPreviewRouter.tsx` 567 行成为 canonical production 入口；`FileMarkdownPreview.tsx` 1581 行显式命名 Rich fallback；Fast 仅 11 行 compatibility alias | production import 单向，legacy 名称不再伪装独立 fast pipeline | P1 | ✅ 已闭环 | 后续按 router / rich capability 拆分，不直接删除 fallback |
| stale mock 路径不符 | `app-shell.startup.test.tsx` mock 已与生产 hook 对齐 | 测试不再意外执行真实 hook | P1 | ✅ 已闭环 | — |

### 6. 检索与导航（search / quick-switcher / project-map / workspaces）

| 问题 | 原因 / 现状证据 | 影响（大白话） | 优先级 | 状态 | 建议 |
|---|---|---|---|---|---|
| message search 每次查询全量重建索引 | `messageIndex.ts` 已用 module-local `WeakMap` 按 immutable snapshot + ordered thread ids 缓存 build 结果；query 仍做 substring scan | 重复遍历、装箱与 lowercase 已消除；超大索引查询仍是 O(全部消息文本) | P1 | ✅ 当前瓶颈已修 | 只有性能数据仍超预算时再评估 trigram / inverted index |
| 三个搜索入口各自为政 | SearchPalette 已由 `useUnifiedSearch` 聚合 8 类 provider 并统一 ranking/frecency；QuickSwitcher 按 spec 独立承担 recent-context navigation；未找到第三套会话内独立打分实现 | 原“三套独立打分”结论不成立 | 待决策 | 结论已校正 | 先验证双入口是否造成认知问题，再决定是否改 OpenSpec |
| QuickSwitcher 无查询、硬上限 30 条 | `quick-context-switcher` main spec 明确要求 compact non-search surface，recent sessions/files 各限 30 条；Global Search 是其导航入口 | 这是有界 MRU contract，不是功能缺失 | — | ✅ 符合现行 spec | 不执行；如需 frecency/合并入口，先新建 behavior change |
| project-map 证据选取硬编码 15 个文件名 | `projectMapGenerationWorker.ts:527-558` 上限 24 文件/52k 字符 | AI 只能看到有偏见的一小部分项目 | P1 | 未做 | 证据检索 RAG 化 |
| project-map 引擎响应 8 层递归嗅探 | `:218-319`；JSON 修复重试把 52k 证据 prompt 完整重发 | 猜错就双倍 token 双倍钱 | P0-P1 | 未做 | 生成管线契约化（structured output、落盘节流、修复重试瘦身） |
| `ProjectMapPanel.tsx` 1945 行 / 17 `useState` 调用 | 体量与职责过载属实；复核未找到旧报告所称的 orchestration storage 直接 import | 架构债务存在，但不能再用未复现的跨层直写作证据 | P1 | 🔶 证据校正 | 按职责拆分；新增改造需重新追踪真实 data flow |
| worktree 默认分支名无语义 | `openPrompt` 现将 `branch` 初始化为空，必须显式输入；旧 `codex/{date}-{random4}` 默认值已删除 | 随机分支名问题已消除，但尚无 AI 语义命名 | P1 | ✅ 缺陷已修 | 语义建议作为独立增强，不恢复隐式默认值 |
| workspaces 错误契约靠字符串匹配 | `useWorktreePrompt.ts:109-217` | 后端改个措辞前端就瞎 | P1 | 未做 | 错误契约结构化 |
| 文件列表 30s 全量轮询 | workspaces 文件列表刷新 | 后台定期全扫 | P2 | 未做 | fs watcher 或增量更新 |

### 7. 系统与运维面（settings / notifications / status-panel / runtime-log / debug / update / startup-orchestration）

| 问题 | 原因 / 现状证据 | 影响（大白话） | 优先级 | 状态 | 建议 |
|---|---|---|---|---|---|
| `SettingsView.tsx` 已摘 `@ts-nocheck`，但仍有 2545 行 | SessionManagementSection 另有 2547 行；MCP / Skills 已迁入 Extensions，但 settings orchestration 仍重 | 类型保护已恢复，职责聚合与副作用密度未消失 | P1 | 部分修复 | 保持 typecheck；继续按 section owner 下沉 orchestration |
| 5 个 `SHOW_*_ENTRY = false` 死开关 | `settingsViewConstants.ts:4-8` 连死 JSX 分支 | 藏着永远渲染不出来的入口 | P0 | ✅ 已清 | — |
| 通知 dock 任何 info 都显示成错误态 | `useGlobalRuntimeNoticeDock.ts:535-537`；正确判定函数 `:423-437` 写好了没接线 | 普通通知也红彤彤 | P0 | ✅ 已修 | — |
| 状态面板二元引擎假设只修主路径 | `useStatusPanelData.ts:248` 支持 `activeEngine`；`useLayoutNodes.tsx:1163-1166` 已传入，但 `Composer.tsx:674-680` sibling caller 仍只传 `isCodexEngine` | Composer 汇总中的 kimi/opencode/gemini task output 仍可能错标 Claude | P0 | 部分修复 | 所有 caller 必须传真实 `selectedEngine`；删除 legacy boolean fallback |
| checkpoint 摘要靠正则抠标题 | `checkpoint.ts:301-351` 抠 `## Summary` | AI 不写这个标题就没摘要 | P1 | 未做 | turn 结束主动生成摘要 |
| 验证 profile 硬编码 8 套 | 不读项目实际 scripts | 新项目验证命令对不上 | P1 | 未做 | 探测实际 scripts |
| runtime-log 出口仍是原文搬运 | 内嵌 140 行手写 shell/batch fallback 仅支持 Java；退出码靠刮 `__EXIT__:N` 日志标记 | 报错要自己读日志；非 Java 项目诊断脚本不可用 | P1 | 未做 | 加"AI 分析此日志"按钮；退出码结构化 |
| Debug 面板无 AI 分析入口 | `DebugPanel.tsx:108-113` 只有 copy/clear | 报错只能自己读日志或复制出来贴给 AI | P1 | 未做 | 加"AI 分析"按钮，喂 tail+退出码+上下文 |
| 更新源指向疑似错误上游 | `tauri.conf.json:73` 指向 `zhukunpenglinyutong/desktop-cc-gui`，当前 remote 是 `chenxiangning/codemoss` | 自动更新可能拉到别人版本 | P2 | 未做 | 确认发版策略后处置 |
| About 页 GitHub 链接疑似过期 | `src/features/about/components/AboutView.tsx:7` 与 `SettingsView.tsx:2490` 指向旧个人仓库 | 用户从两个入口都会跳到原作者仓库 | P0 | 未做 | 确认 rebrand 决策后统一修改 |
| startup-orchestration 17 条 owner 注册表 7 条仍 legacy-hook | 迁移做了一半；trace 耗时数据零利用 | 启动顺序优化靠猜 | P2 | 未做 | 完成迁移；基于 trace 自适应调优 |
| runtime/usage 新 owner 继续单体化 | `useAppServerEvents.ts` 2988 行、`local_usage.rs` 2917 行，均已纳入 `large-file-new-file-baseline`，但没有进入当前 policy hard failure 清单 | 高频事件归并与本地用量扫描继续集中在大 owner，后续引擎/供应商扩展会增加回归半径 | P1 | 未做 | 先按 event family / provider scanner 拆纯解析，再移动副作用 owner |
| `AUTO_UPDATE_ENABLED` 是编译期常量 | `useUpdater.ts:41` | 开关不灵活 | P2 | 未做 | 改为运行时配置 |
| release notes 绑死手写 CHANGELOG 正则格式 | 不读 conventional commits | 发版说明手动维护 | P2 | 未做 | AI 从 commits 生成 release notes |
| `SessionManagementSection.tsx` 等新增巨型文件 | 2547 行等；拆分只是搬家 | 设置页债务从壳子搬到叶子 | P1 | 未做 | 真正按职责切分，不是单纯搬家 |

### 8. 多模态与自动化（dictation / browser-agent / computer-use / collaboration）

| 问题 | 原因 / 现状证据 | 影响（大白话） | 优先级 | 状态 | 建议 |
|---|---|---|---|---|---|
| 语音转写原文直插输入框 | `Composer.tsx:1664-1678`；`real.rs:1395` `set_no_context(true)` 且无 `initial_prompt` | 口语碎句、口误、术语错字全保留 | P1 | 未做 | 注入工作区术语词表 + LLM 清洗 |
| 语音模型下载不可续传 | `real.rs:701-702` 取消即删 `.partial` | 大模型下了一半要重来 | P1 | 未做 | 支持断点续传 |
| 语音无 VAD 无流式，120s 上限整段转写 | `real.rs` 1475 行 god-module | 说完才转，长语音体验差 | P1 | 未做 | VAD + 流式转写 |
| 语音电平 33ms 直推 setState | `real.rs:1245-1251` | 每秒 30 次刷新界面，耗电 | P1 | ✅ 已修 | 100ms + 相同 value 跳过 emit |
| browser-agent 动作执行无业务消费者 | `src/services/tauri/browserAgent.ts:172-177` 已封装并由 `src/services/tauri.ts:219` 导出；生产代码没有 `runBrowserAgentAction(...)` 调用 | 浏览器 agent 只能看不能动 | P1 | 部分变化 | **接通 or 删除**二选一；不要再按“无前端 wrapper”估算 |
| browser click/type 被前后端双重硬编码禁用 | `browserActionPreview.ts:89,97`、`mod.rs:2079-2081` | 动作能力被主动关死 | P1 | 未做 | 统一 gate 真源 |
| `<browser_context_v2>` 手写文本协议 786 行 | section 顺序靠硬编码 nextKeys 耦合 | 解析脆弱 | P1 | 未做 | 改 JSON 协议 |
| browser OCR 管线空壳 | `ocrTextSupplements: []` 恒空 | 截图里的文字无法提取给 AI | P1 | 未做 | 接 OCR 模型或删除 |
| browser code candidates 产出 `src/**` 伪路径 | 仓库有 `code_intel` 却没用 | AI 拿到错误代码位置 | P1 | 未做 | code candidates 接 code_intel 语义定位 |
| browser 脱敏只认英文关键词 | 对邮箱电话一刀切 | 中文语境漏脱或误脱 | P2 | 未做 | 升级脱敏策略 |
| computer-use 埋在设置页深处 | `CodexSection.tsx:999`；与会话零集成；broker 阻塞 600s 无流式无取消 | 用完结果即丢 | P2 | 未做 | 变会话内可调用工具；流式/取消/审计 |
| computer-use 与 activation 共用一把锁互阻 | 共享锁设计 | 两个功能互相卡住 | P1 | 未做 | 锁分离 |
| collaboration 名不副实 | 实为 plan/code 模式选择器；硬编码白名单丢服务端能力；选择不持久化 | 协作能力被阉割 | P2 | 未做 | 重命名 + 持久化 + 接真实能力 |

### 9. 治理与事实层（governance / operation-facts / spec / engine-task-output）

| 问题 | 原因 / 现状证据 | 影响（大白话） | 优先级 | 状态 | 建议 |
|---|---|---|---|---|---|
| `SpecHubPresentationalImpl.tsx` 113KB 混淆 + `@ts-nocheck` | 25 行 minified bundle，7 个 AI prompt 构建器埋在里面；de-minify 分支 `b2736ba9b` 烂尾未合 | 人和 AI 都无法维护，Spec Hub 任何改动等于冻结 | P0-P2 | 未做 | 基于当前 HEAD 重做 prettier 展开 |
| `useSpecHub.ts` 与 Impl 双份实现 | `extractThreadIdFromRpc`、apply prompt 构建两处各写一套 | 必然漂移 | P1 | 未做 | de-minify 后统一到一个实现 |
| apply 任务回写逐条非事务 | `useSpecHub.ts:1365-1419` 每条 `updateSpecTaskChecklist`；失败 best-effort 反向 toggle | 批量勾选慢，中途失败留半勾选 | P1 | 未做 | `spec-core/runtime.ts` 增加 batch API |
| apply 结果契约脆弱 | 3 层 JSON 兜底解析；兼容 4 种键名 3 种索引映射 | 解析靠猜 | P1 | 未做 | 契约化 |
| governance gate 定义硬编码 4 处 | `projectGovernanceProfile.ts:63-123, 278-308`、`gateArtifactEvidenceReader.ts:320-339` | 改 gate 要改多处 | P1 | 未做 | gate 定义集中化 |
| `REPO_PATH_ANCHORS` 写死本仓库目录 | `governanceEvidence.ts:8-18` 却用于任意工作区 | 证据收集对本仓库有偏 | P1 | 未做 | 配置化或探测 |
| 证据无刷新机制 | 证据只采一次 | 治理判定可能基于过期信息 | P1 | 未做 | 加刷新/重采入口 |
| 3 个 adapter API 只经 barrel 导出、无生产消费者 | `createCostBudgetGovernanceEvidence`、`createCapabilityGovernanceEvidence`、`consolidateHarnessGateEvidence` 仅出现在 `index.ts`、定义和测试；`createGateGovernanceEvidence` 有真实 reader caller | 三个扩展接口增加维护面，却没有产品行为 | P1 | 未做 | 删除无消费者导出，或先明确调用 owner 再保留 |
| operation-facts 1026 行启发式猜测 | `computeLineDelta` 对同行数重写返回 +1/-1；与 `threadItemsFileChanges.ts`、`toolSemantics.ts` 三层猜测叠加 | 50 行重写显示成 1 行变更 | P2 | 未做 | engine 后端落结构化契约，前端降级兜底 |
| engine-task-output 引擎归因仍有 fallback 漏洞 | projection 已支持 5 引擎，但 unknown 仍回退 Claude；Composer caller 未透传真实引擎 | 主 StatusPanel 已修，Composer sibling path 仍可能输出错误归属 | P0 | 部分修复 | 统一 registry；unknown 保持 unknown 或显式报错，补 Composer 回归测试 |
| spec-kit 支持是 stub | 所有 action 映射到 `specify xxx --help` | Spec Hub 命令行能力没落地 | P2 | 未做 | 补齐或隐藏 |

### 10. 外壳与杂项（home / layout / theme / about / client-documentation / client-ui-visibility / note-cards / intent-canvas）

| 问题 | 原因 / 现状证据 | 影响（大白话） | 优先级 | 状态 | 建议 |
|---|---|---|---|---|---|
| intent-canvas 自动保存已落地，但写入仍非原子 | `IntentCanvasManager.tsx:1126` 调用保存；`intentCanvasStorage.ts:713-741` 先写 document、再写 index，未见 tmp+rename | 自动保存降低丢稿概率；第二步失败仍可能留下 document/index 不一致 | P0 | 部分修复 | 后端提供原子 batch write，或加入 reconcile/repair |
| `useLayoutNodes.tsx` 2345 行 god hook | `layoutNodesTypes.ts` 1302 行；体量已有下降，`DesktopLayout.tsx` 命令式 DOM 操作仍在 | 外壳仍是重单文件债 | P1 | 部分变化 | 继续按职责拆分；DOM 操作改声明式 |
| 响应式布局死分支 | `useLayoutMode.ts:3-6` 硬编码 `return "desktop"`；Phone/TabletLayout 走不到仍打包 | 体积浪费 | P0 | ✅ 已删 | — |
| home `latestAgentRuns` 半成品 | `Home.tsx:23-25` 下划线弃用不渲染；`app-shell.tsx:1052` 仍计算下传 | "继续上次工作"卡片素材在浪费 | P0 | ✅ 已清 | 要么展示，要么彻底删 |
| About GitHub URL 疑似过期 | `src/features/about/components/AboutView.tsx:7` 与 `SettingsView.tsx:2490` 都指向上游仓库 | 用户从 About 或 Settings 都会跳到原作者仓库 | P0 | 未做 | 与 updater、bundle identifier 一起做 rebrand 决策 |
| client-documentation 881 行纯中文硬编码 | 无 i18n；无搜索；控件 ID 与 client-ui-visibility 双份维护 | 文档跟不上界面变化 | P2 | 未做 | i18n + 搜索 + 单一事实源 |
| note-cards 1323 行单体面板 | 注入 = 勾选顺序 + 字符截断；`noteCardsFacade` 纯透传层 | 便签和当前对话相关性没考虑 | P1 | 未做 | 拆分 + 智能注入排序 + 摘要压缩 |
| intent-canvas 链接全靠手敲 | 节点配色按英文 role 子串匹配，中文 role 全落灰；AI 只出站不进站 | 中文用户画布灰扑扑；AI 能读不能写 | P1 | 未做 | AI 生成画布 + 自动关联建议 +  inbound 协议 |
| `MemoryPanel.tsx` 硬编码 localhost:37777 + 10s no-cors 探活 | 未门控 | 每 10s 无意义 fetch | P2 | 未做 | 抽配置 + 套可见性门控 |
| `HomeChat.tsx` `TokenIndicator percentage={null}` 永久占位符 | 计算了但不展示 | 首页永远缺 token 用量可视化 | P2 | 未做 | 接真实数据或删除占位 |

### 11. openspec 规划一致性

| 问题 | 原因 / 现状证据 | 影响（大白话） | 优先级 | 状态 | 建议 |
|---|---|---|---|---|---|
| OpenSpec current snapshot 仍漂移 | 目录实测 active=13/archive=738/specs=436；`changes/README.md` active table 已列 13 项，但 archive 摘要仍写 731；`project.md` 继续保留旧 active/archive/spec/version 快照 | 同一治理入口仍无法稳定提供 current truth | P0 | 部分更新 | 从目录生成 snapshot；一次性校准 version、counts、active table 与 Updated At，并加 CI |
| Skills Hub 行为绕过 OpenSpec | 已新增 active change `add-skills-hub-management`，14/14 tasks 追溯 `b1d94a930` / `c75922dec` 的安装、卸载、同步、搜索、usage 与长列表行为；尚未 verify/sync/archive，main specs 仍无对应 capability | behavior debt 已从“零 artifact”降为“active 追溯 change 未闭环” | P0 | 🔶 change 已补 | 完成 verify，sync main specs 后 archive；typed query/mutation contract 另行治理 |
| 19 个游离提案实现已落地未归档 | 代码存在但缺 verification.md | mainline spec truth 落后代码 | P0 | ✅ 已归档 | archive 强制 verification.md |
| `add-tokentracker-usage-dashboard` 21/21 但后续 scope 漂移 | proposal/tasks 只描述 usage dashboard、CLI/server/`tt_proxy`；后续 Skills backend/UI 未补进该 change | 直接归档会让完成度看似 100%，却遗漏最新同域行为 | P0 | 需先校准 | Skills 使用独立 change 或显式扩 scope；完成 verify 后再归档 usage change |
| Full strict validation 仍有 2 个失败 | `openspec validate --all --strict --no-interactive` 实测 447 passed / 2 failed；失败项为 `add-tokentracker-usage-dashboard` 与 `reduce-client-polling-overhead` | main specs 与其余 active changes 可验证，但工作区不能宣称全绿 | P1 | 部分通过 | 分别修复两个 active change 的 artifact/requirement validation |
| 无独立 OpenSpec 索引一致性 gate | `package.json` 与 `.github/workflows/` 仍未发现核对 active/archive/specs 索引计数的专用脚本；当前 738 vs 731 已再次证明手工快照会漂移 | validate 通过也不能保证导航计数是 current truth | P1 | 未做 | 加目录计数、active links 与 version 一致性脚本并接 CI |
| 48-task 大删除提案烂尾教训 | `2026-06-24-retire-opencode-and-gemini-cli` 整体强制归档 | 大颗粒删除型提案易烂尾 | — | 已记录 | 未来删除提案按 capability 分片 |

---

## 二、轮询与高频 setState 治理清单

### 已修复项

| 位置 | 周期 | 优化前 | 优化后 | 提交 |
|---|---|---|---|---|
| `GitHistoryWorktreePanel` 3s git status | 3s | 窗口隐藏仍裸轮询 | `external_changes` watcher 事件 + `setVisibilityGatedInterval` 30s 兜底 | `d042e5018` |
| `useAppShellKanbanExecutionSection` 调度器 | 20s | 固定扫描，无任务空转 | next-due 对齐 `setTimeout`，无到期任务休眠 | `d042e5018` |
| `useEngineTaskOutputSnapshot` | 5s | running 任务读产物文件，隐藏不停 | 套 `setVisibilityGatedInterval(5s)` | `d042e5018` |
| `useGlobalRuntimeNoticeDock` | 5s | 拉 runtime 池快照，无变化也拉 | Rust 差量 emit `runtime-pool-changed` + 60s 兜底 | `d042e5018` |
| `dictation/real.rs` 电平推送 | 33ms (~30fps) | 直推前端 setState | 100ms + 相同 value 跳过 emit | `9ca8d2b19` |

### 仍待改造项

#### 前端 IPC 轮询

| 位置 | 周期 | 当前状态 | 建议方案 | 优先级 |
|---|---|---|---|---|
| `CuratedSkillIndicator` | event + 60s | 已改 settings change event 主通道，保留 visibility-gated 60s reconcile | 保留低频 backstop；不再按 2s 轮询治理 | P3 |
| `useGlobalRuntimeNoticeDock` | 60s | 已改为 `runtime-pool-changed` 事件 + visibility-gated 60 秒 backstop | 保留低频 reconcile；无需再按 5 秒轮询治理 | P3 |
| `useGitLog` | 10s | 未修复 | 套 `setVisibilityGatedInterval`；长期接 git 文件变更事件 | P2 |
| `MemoryPanel` 探活 | 10s | 未修复：no-cors HEAD `localhost:37777`，未门控 | 套 `setVisibilityGatedInterval`；URL 抽配置 | P2 |
| `useLocalUsage` | 5min | 未修复：未随窗口可见性暂停 | 复用 `startLocalUsageAutoRefresh`（30s 自适应 + 可见性感知） | P2 |
| `useGitRepositories` | 45s | 部分修复：hidden 时不发 IPC，但递归 `setTimeout` 仍持续唤醒并重新 schedule | 复用统一 visibility-gated scheduler | P3 |
| workspaces 文件列表 | 30s | 全量轮询 | fs watcher 或增量更新 | P2 |

#### 前端本地内存轮询（可合并优化）

| 位置 | 周期 | 当前状态 | 建议方案 | 优先级 |
|---|---|---|---|---|
| `useThreadStorage` 清理 pending map | 5s | 空转但无 IPC | 合并进 `useThreadEventHandlers` 60s 清扫 | P3 |
| `useBrowserContextAttachment` 本地对账 | 30s | 主通道已是事件 | 移除兜底或套可见性门控 | P3 |

#### 纯 UI 计时器（transient，建议收敛）

| 位置 | 周期 | 当前状态 | 建议方案 | 优先级 |
|---|---|---|---|---|
| `KanbanCard` 计时器 | 1s × 2 | 每张卡独立 interval | 单一时钟源 + 各卡订阅计算 | P1 |
| `WorkingIndicator`  thinking 时长 | 1s × N | 每条 thinking 消息独立 interval | 合并为全局 1s clock | P2 |
| `GitHistoryPanelImpl` force-delete / PR 耗时 | 1s × 2 | 独立 interval | 可合并进全局 clock | P2 |
| `useSpecHub` / `SpecHubPresentationalImpl` 执行计时 | 1s × 2 | 独立 interval | 可合并 | P2 |
| `useGitHistoryPanelInteractions` PR 假进度 | 800ms | 独立 interval | 保留或收敛 | P3 |

---

## 三、剩余优先级路线图

### P0 — 立即收口

| # | 任务 | 不做会怎样 | 当前状态 |
|---|---|---|---|
| P0-E | 修 About GitHub URL | 用户点错仓库 | 未做 |
| P0-G | 校准 OpenSpec current snapshot 并加索引一致性 CI | 目录为 13/738/436，导航仍写 archive=731，治理入口继续漂移 | 部分更新 |
| P0-H | 恢复 large-file gate 绿灯：治理 13 个 hard failure 与 `storage.rs` ratchet | 当前 CI 命令仍失败 14 项，新增回退无法与已知债务稳定区分 | 部分完成：Git/File 两目标已退出 |
| P0-I | 完成 Skills Hub OpenSpec verify/sync/archive | active 追溯 change 已有，但 mainline behavior truth 仍未闭环 | 14/14，待 verify/archive |
| P0-J | 补齐 Composer `activeEngine` 透传并移除二元 fallback | 非 Codex task output 仍可能错标 Claude | 部分修复 |

已完成、不再占用剩余 P0 编号：ComposerInput/dead bridge 清理、输入历史单一 store、autocomplete 死计算删除、Git History typecheck 恢复、File View helper 去重、Markdown renderer boundary。large-file policy、baseline 与 CI wiring 只完成基础设施接线；当前 gate 仍为红灯，保留 P0-H。

### P1 — 本季度

| # | 任务 | 不做会怎样 | 当前状态 |
|---|---|---|---|
| P1-1 | 统一模型元数据注册表，消灭字符串启发式 | 每加引擎改 10+ 处；伪徽章误导 | 未做 |
| P1-2 | 事件驱动改造批次（AppSettings、通知、engine-task-output、文件外部变更、commands/skills 目录 watch） | 触碰渲染红线；后台空转 | 部分完成 |
| P1-3 | 拆 god hook 第二波：`useEngineController`、threads 四巨石、`useLayoutNodes`、`ProjectMapPanel` | 阻塞各自领域迭代 | 未做 |
| P1-4 | 记忆/项目证据语义检索接入 | 当前 unified search 已存在，真正缺口是 embedding 与 project evidence retrieval | 需先决策 embedding |
| P1-5 | browser 动作管线：接通或删除 | 纯负债 | **需决策** |
| P1-6 | 语音后处理（`initial_prompt` + LLM 清洗） | 语音输入专业场景不可用 | 未做 |
| P1-7 | AI 日志/错误分析入口 | 报错只能自己读日志 | 未做 |
| P1-8 | 拆 kanban 执行根 hook | 误判与渲染风险持续 | 部分完成 |
| P1-9 | checkpoint 主动摘要 + 验证 profile 探测项目脚本 | 摘要看运气；新项验证对不上 | 未做 |
| P1-10 | AI commit 流式反馈与自动分组 | 常驻一键入口已完成；长生成与多仓选择仍可继续优化 | 基础入口已完成 |
| P1-11 | worktree 语义建议 + workspaces 错误契约结构化 | 随机默认名已删除；错误分类仍会受后端文案变化影响 | 部分完成 |
| P1-12 | project-map 证据 RAG 化 + 生成管线契约化 | 双倍 token；AI 只能看偏见切片 | 未做 |
| P1-13 | 语音 VAD + 流式转写 | 长语音体验差 | 未做 |
| P1-14 | browser `<browser_context_v2>` 改 JSON + OCR/截图确认 | 解析脆弱；截图文字无法给 AI | 未做 |
| P1-15 | 拆 `skills_hub.rs` typed domain modules，并登记 vendored Skills 偏差 | 技能安装、网络、usage 和文件系统变更绑在一个 2995 行 owner | 未做 |
| P1-16 | 拆 Git History / Threads / Rust runtime 当前 gate 巨石 | Git/File 两目标已退出；当前 13 个 hard failure 集中到 Git History、Threads、daemon/runtime 与 CSS | 部分完成 |
| P1-17 | 按性能数据决定 message search 的 trigram / inverted index | snapshot build cache 已完成；只有 substring scan 超预算才需继续 | 暂不执行 |
| P1-18 | 完成 prompt enhancer 流式 diff、skill args 与“存为 Skill” | 四批 Composer 优化已落地基础 contract，但三个用户闭环仍不完整 | 部分完成 |

### P2 — 需先决策 / 有前置依赖

| # | 任务 | 前置决策 / 依赖 | 当前状态 |
|---|---|---|---|
| P2-1 | 记忆语义检索 | embedding 方案（本地 vs 引擎通道） | **需决策** |
| P2-2 | 引擎 registry 单一事实源 | 大重构，涉及 Rust 侧 `infer_engine_label` | 未做 |
| P2-3 | SpecHub de-minify 重做 | 基于当前 HEAD 展开，不能合旧分支 | 未做 |
| P2-4 | GitHub URL / rebrand | 是否改 updater/release/bundle id | **需决策** |
| P2-5 | 任务 AI 验收判定 | 重建 reviewer-turn 机制；依赖 P1-8 拆分 | **需决策** |
| P2-7 | operation-facts 结构化下沉 | 依赖 engine 事件协议演进（双端改动） | 未做 |
| P2-8 | 扩展 skill args 与“对话→Skill”沉淀 | typed skill identity 与“对话→Prompt”已落地；剩余是参数和 Skill 资产化产品 contract | 部分完成 |

---

## 四、风险与注意事项

1. **避免与在途规划重复投入**。OpenSpec 已立项/已完成：AI PR 标题正文生成、prompt enhancer、Agent Catalog、source-aware 便签捕获、Quick Switcher、Kimi 引擎、记忆自动注入。Skills Hub 已补 `add-skills-hub-management` 追溯 change，但尚未 verify/sync/archive，不能伪装成 `add-tokentracker-usage-dashboard` 的 21/21 收尾。

2. **大重构的前置依赖链**：
   - Spec Hub 任何改动 → 先 de-minify，否则在混淆文件上赌博；
   - Composer 拆分 → `ComposerInput.tsx`、历史双写和重复 autocomplete 已清；现在可按 adapter / orchestration owner 拆分；
   - 语义搜索/证据 RAG → 依赖记忆语义检索接线；
   - 模型智能推荐 → 依赖统一注册表；
   - operation-facts 结构化 → 依赖 engine 事件协议演进（双端改动，成本最高）。

3. **大颗粒删除型提案是烂尾重灾区**。`2026-06-24-retire-opencode-and-gemini-cli`（48 tasks）整体强制归档的教训：未来应新建小型、按 capability 分片的 change。P0 死代码大扫除必须拆小提案执行。

4. **已验证但需产品决策的项**：
   - 更新源指向：`tauri.conf.json:73` 端点为上游 `zhukunpenglinyutong/desktop-cc-gui`，当前 remote 是 `chenxiangning/codemoss`，fork 发版存在版本串线风险；
   - `src/features/about/components/AboutView.tsx:7`、`SettingsView.tsx:2490` 与 updater endpoint 均指向同一上游仓库；是否修改取决于 rebrand/release owner 决策；
   - 执行前先 `git status` 核对目标文件是否有在途改动。

5. **轮询改造需遵守仓库红线**。AGENTS.md 明确"事件驱动 + ≥30s 兜底轮询，禁秒级轮询"；渲染风暴排查方法以 `docs/perf/render-jank-knife-experiments-2026-07-08.md` 为准。

6. **baseline 不是豁免证书，当前也没有形成有效豁免**。`large-file-new-file-baseline` 只服务 new-file ratchet，不能替代 hard baseline；当前 hard baseline 的 `entries` 为空，13 个 policy hard failure 仍全部报 `status=new`。`GitDiffPanel`、`FileViewPanel` 已退出 failure 清单，但 Git History Impl/View 因 type-safety 修复进入清单。即使后续临时登记 baseline，也必须绑定 owner、拆分目标和移除期限；拆分按 owner 与 contract 切，不按行数机械搬家。

7. **范围声明**。画布/幕布渲染管线、project-map 图形渲染性能未在本次评估范围；其余条目均核对了当前源码、生产 caller、测试或治理 artifact。保留的历史行号仅代表 `c75922dec` 快照；最新结论优先按 symbol 搜索。

---

*报告完。合并自三份 2026-07-24/25 报告，并于 2026-07-26 在 `713ef5f2cd` 再次全量核对源码、生产 caller、测试、配置、large-file policy 与 OpenSpec artifacts；本轮未重跑全量测试，large-file gate 实测 14 项失败并已如实纳入 P0。*
