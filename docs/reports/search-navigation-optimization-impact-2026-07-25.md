# 检索与导航优化项 · 逐项影响明细

> **2026-08-01 生命周期校准**：Historical / Evolved。本文保留 2026-07 的职责判断；当前行为以 `SearchPalette.tsx`、`useUnifiedSearch.ts` 与当前 specs 为准。
> **日期**：2026-07-25
> **基线**：分支 `feature/v-799` @ `c75922dec`
> **复核**：2026-07-26 首次复核与 #1/#7 修复均由 `d077890b8` 一并落地（原文误记为 `e6c8b2433`，该提交上 #1/#7 尚未修复）；**同日二次复核** @ `713ef5f2c`：`d077890b8..HEAD` 未修改本文涉及的生产源码，9 项状态与行数、常量值全部一致
> **来源**：从 `client-aux-modules-governance-report-2026-07-25.md` 摘出"检索与导航（search / quick-switcher / project-map / workspaces）"一节的 9 项，逐项展开"现状 → 影响 → 处理后影响 → UI 变化"
> **核对方法**：逐项对照源码、生产 caller 与现行 OpenSpec；本文区分"已确认缺陷""架构债务""产品决策项"，避免把现行 contract 误写成未完成需求
> **行号声明**：行号为 `c75922dec` 快照，后续提交请按 symbol 搜索

## 总览

| # | 优化项 | 分类 | 优先级 | 当前结论 | 主要解决的问题 |
|---|---|---|---|---|---|
| 1 | message search 每次查询全量重建索引 | 性能缺陷 | P1 | ✅ 已修复：相同 snapshot 复用 index；substring scan 保留 | 降低输入时的主线程计算与内存分配 |
| 2 | 三个搜索入口各自为政 | 产品决策 | 待决策 | 🟦 SearchPalette 已统一；QuickSwitcher 按 spec 独立 | 明确主动检索与最近上下文恢复的职责边界 |
| 3 | QuickSwitcher 无查询、硬上限 30 条 | 现行 contract | 不执行 | ✅ 符合 `quick-context-switcher` spec | 保持弹层有界、轻量，并避免复制 Global Search |
| 4 | project-map 证据选取硬编码 15 个文件名 | 生成质量缺陷 | P1 | ❌ 待处理 | 提高不同技术栈与大型仓库的证据相关性 |
| 5 | project-map 响应递归嗅探 + repair 重发证据 | 成本与可靠性缺陷 | P1 | ❌ 待处理，需先测 repair 触发率 | 减少 repair 输入成本并稳定响应 contract |
| 6 | `ProjectMapPanel.tsx` 1945 行 / 17 `useState` | 架构债务 | P1 | 🔶 跨层直写未复现，职责过载属实 | 降低改动耦合与回归面 |
| 7 | worktree 默认分支名无语义 | UX 缺陷 | P1 | ✅ 已修复：默认留空并要求显式填写 | 让分支名称来自用户真实意图 |
| 8 | workspaces 错误契约靠字符串匹配 | Cross-layer contract 缺陷 | P1 | ❌ 待处理 | 避免后端文案变化破坏前端错误分类 |
| 9 | 文件列表 30s 全量轮询 | 性能缺陷 | P2 | 🔶 有失败退避，无 watcher/可见性门控 | 降低静默期 IPC 与后台唤醒 |

## 1. message search 每次查询全量重建索引

**状态**：✅ 已修复。相同 immutable `threadItemsByThread` snapshot 与 ordered thread ids 会复用同一 index；query 仍按原 contract 扫描已索引消息。

### 现状（证据）

- `src/features/search/indexing/messageIndex.ts` 使用 module-local `WeakMap`，以 canonical `threadItemsByThread` object 作为 snapshot owner，并以无歧义的 ordered thread-id signature 区分 workspace slice。
- cache miss 时才遍历 items，过滤空消息/非 message item，并同时保存原始 `text` 与 `normalizedText`。
- `messageProvider.ts` 直接使用 `normalizedText.indexOf(query)`；score、snippet、result identity 与排序保持不变。
- canonical snapshot 引用变化后 cache 自动 miss；旧 snapshot 不再被引用时可由 GC 回收，无需 LRU 或显式清理。

### 影响什么

- **已消除**：同一消息 snapshot 上，每次 query 重复遍历、装箱 `IndexedMessage[]` 和逐条 `toLowerCase()`。
- **仍保留**：substring matching 继续扫描全部已索引消息，复杂度仍是 O（全部已索引文本）。本次没有引入 inverted/trigram index。

### 处理后的影响

- 连续输入命中同一 snapshot cache，只执行 query scan，不再重复 build。
- WeakMap 直接复用现有 immutable state identity，不增加 root version state、持久化或 dependency。
- focused tests 已覆盖 cache hit、新 snapshot invalidation、thread order 隔离和大小写匹配兼容。
- 只有后续性能证据证明 substring scan 仍超预算时，才评估 trigram/inverted index。

### UI 变化

**无直接 UI 变化**。预期降低大 workspace 下的输入阻塞和结果延迟，最终收益以性能基线与改后对比为准。

## 2. 三个搜索入口各自为政

**状态修正**：治理报告写"三套独立打分"，但当前 HEAD 与 OpenSpec 均不支持该结论。SearchPalette 已统一；QuickSwitcher 被明确设计为独立的非搜索导航面。

### 现状（证据）

- **SearchPalette = 已统一**：`src/features/search/hooks/useUnifiedSearch.ts` 聚合了 **8 类 provider**（messages / files / commands / history / kanban / threads / skills / apis），统一走 `ranking/score.ts` 的 `compareSearchResults` + `ranking/recencyStore` 的 frecency，并有防抖（`SEARCH_DEBOUNCE_MS`）、provider 限额（`SEARCH_PROVIDER_LIMITS`）和性能上报（`searchMetrics`）。注：`providers/` 目录另有 `actionsProvider` 与 `recentDiscoveryProvider` 两个文件未接入 useUnifiedSearch，复查时勿按目录文件数误计。
- **QuickSwitcher = 有意独立**：`openspec/specs/quick-context-switcher/spec.md` 明确要求它保持 compact non-search navigation surface，MUST NOT 提供 search input、typing filter 或 provider hydration。QuickSwitcher 的第一项已可跳转 Global Search。
- **会话内搜索 = 未找到独立实现**：在 `src/features/threads`、`src/features/conversation` 下未检索到独立的会话内搜索打分实现，疑似已并入统一搜索或尚未建设——**此点待复核**，不能继续按"三套独立打分"估算工作量。

### 影响什么

- 继续按"三套各自为政"立项会高估工作量，并可能破坏已归档的产品决策。
- SearchPalette 负责主动检索；QuickSwitcher 负责恢复最近上下文。两者结果集不同是职责差异，不足以单独证明需要合并。

### 处理后的影响

- 当前不创建代码 TODO。先通过可用性反馈确认用户是否无法理解两个入口，或是否频繁从 QuickSwitcher 跳转 Global Search。
- 若数据证明职责边界失败，再创建新的 OpenSpec change，明确选择"保持双入口并优化文案"或"合并入口"。不能在实现阶段直接覆盖现行 spec。
- `/`、`@` 等意图路由属于 SearchPalette 的独立产品能力，不应与 QuickSwitcher 收敛绑定立项。

### UI 变化

**当前无变化**。只有新的 OpenSpec change 决定改变双入口职责时，才会产生 UI 调整。

## 3. QuickSwitcher 无查询、硬上限 30 条

**状态**：✅ 符合现行 OpenSpec，不是未完成项。`quick-context-switcher` spec 明确规定无查询输入，并要求 recent sessions/files 各自保持全局最新 30 条。

### 现状（证据）

- `src/features/quick-switcher/types.ts:1`：`QUICK_SWITCHER_RECENT_LIMIT = 30`，recent collections 按 contract 保持有界。
- 数据结构 `QuickSwitcherRecentFile` 只有 `workspaceId / path / touchedAt / source("opened" | "ai-modified")`——**纯时间序，无 frecency（频率 × 新近度）打分**。
- `QuickSwitcher.tsx`（实际路径 `src/features/quick-switcher/components/QuickSwitcher.tsx`）中无查询输入处理，只渲染导航、最近会话与最近文件；Global Search 是导航区第一项。

### 影响什么

- 第 31 个 recent item 不在 QuickSwitcher 展示，但仍可通过 Global Search 或文件导航访问，不能描述为"永远找不到"。
- 30 条上限控制弹层 DOM、键盘导航范围与认知负荷。
- MRU 使用 `touchedAt` 表达"最近上下文"，不是"最常使用"；是否升级为 frecency 属于产品决策。

### 处理后的影响

- 当前不执行查询框、frecency 或扩大上限改造。
- 如果用户反馈显示 30 条窗口无法支持上下文恢复，应先记录触发场景，再通过新 OpenSpec change 修改 `quick-context-switcher` contract。
- 任何改造都必须保留三栏 keyboard model、bounded viewport、canonical navigation 与现有 focused tests。

### UI 变化

**无**。当前实现与 spec 一致。

## 4. project-map 证据选取硬编码 15 个文件名

**状态**：❌ 待处理。当前证据选择仍依赖固定文件名和路径分档。

### 现状（证据）

`src/features/project-map/services/projectMapGenerationWorker.ts`：

- `:86-88` 三重硬上限：`MAX_CONTEXT_FILES = 24`、`MAX_EVIDENCE_PROMPT_CHARS = 52_000`、`MAX_EVIDENCE_FILE_CHARS = 5_000`。
- `:527-558` `filePriority()`：证据优先级靠**硬编码清单**——只有 `package.json`、`pnpm-workspace.yaml`、`vite.config.ts`、`tsconfig.json`、`pyproject.toml`、`requirements.txt`、`go.mod`、`Cargo.toml`、`pom.xml`、`build.gradle`、`settings.gradle`、`CMakeLists.txt`、`Makefile`、`README.md`、`AGENTS.md` 这 15 个文件名拿最高优先级（return 0）；其余按路径前缀分档（openspec/.trellis → 1，src → 2，test → 3，其他 → 4）。

### 影响什么

- **AI 只能看到有偏见的切片**：一个 Rust + Python 混合项目、或用非标准构建文件的项目，证据集里可能连真正的核心源码都排不进前 24 个文件。
- **语言歧视**：清单明显偏 JS/TS 生态（4 个 JS 构建文件 vs 各 1 个其他语言），非 JS 项目的 project map 生成质量天然更差。
- **52k 字符天花板**：大项目的证据被截断后，AI 生成的"项目知识地图"基于残缺信息，图谱可信度打折。

### 处理后的影响

- 第一阶段保留现有 token/file budget 和 `requestSources` 的绝对优先级，再把语言 manifest、entrypoint、测试邻接文件与现有关系图事实纳入确定性评分。
- 为 evidence selection 记录候选数、入选原因、截断原因与技术栈覆盖率，先建立可比较的质量证据。
- 只有确定性排序仍无法覆盖目标场景时，再评估复用 `code_intel` 关系或 semantic retrieval。不要把 embedding 作为本项的默认前置依赖。
- 风险点：相关性排序必须可解释、可复现；semantic retrieval 结果不能覆盖显式 `requestSources` 与确定性 project facts。

### UI 变化

**无直接 UI 变化**。间接效果：生成的 project map 节点/摘要更准确，非 JS 项目改善最明显。

## 5. project-map 引擎响应递归嗅探 + 修复重发全量证据

**状态**：❌ 未做（当前 HEAD 已核实）。repair 会再次发送完整证据，但总成本取决于 repair 触发率，应先测量再确认优先级。

### 现状（证据）

- **响应 envelope 解析过宽**：`projectMapGenerationWorker.ts:218-319` `extractTextFromCodexContent` 对引擎返回值做递归嗅探，依次尝试 `text` / `last_agent_message` / `lastAgentMessage` / `output_text` / `outputText` / `summary`，再递归进入 `content` / `parts` / `output`。引擎响应格式变化时，提取可能失败并进入 repair/failure，但失败字段缺少明确的 engine contract。
- **修复重试会重发证据**：`:901-924` `buildJsonRepairPrompt` 在 JSON 校验失败时，把 **`input.originalPrompt`（即含 52k 证据的完整生成 prompt）原样再发一遍**，外加截断到 12k 的上次无效输出（`:89` `MAX_INVALID_OUTPUT_REPAIR_CHARS = 12_000`）。证据打满预算时，一次 repair 的输入会额外增加约 64k 字符。
- **已有 normalization，但没有受约束的生成 contract**：`parseJsonPayload` 已复用 `parseModelStructuredJsonObject` 做 JSON normalization/validation，`PROJECT_MAP_JSON_SCHEMA_EXAMPLE` 仍只是 prompt 指令。模型首次输出不受 API-level schema 约束，失败后进入整包 repair。
- **repair 不继承上下文**：Codex 路径的 `runCodexThreadTurn` 每次创建并归档新 thread；其他 engine 路径使用 `continueSession: false`。因此不能在现状下直接删除 repair prompt 的原始证据。

### 影响什么

- **直接成本**：每次 JSON repair 都会再次发送证据。repair 场景的输入成本接近两次生成请求，但整体成本增幅取决于 repair 触发率与实际证据长度。
- **脆弱性**：递归 envelope 嗅探缺少 engine-specific contract；字段变化可能把正常响应转成 parse/repair failure。
- **速度**：Codex 单次 turn 超时为 900s；repair 再启动一次独立 turn，会扩大长尾耗时。

### 处理后的影响

- **先补度量**：记录 engine、证据字符数、首次解析结果、repair 触发率、repair 输入字符数、最终成功率与耗时分位。
- **响应 contract 收敛**：各 engine 先通过明确的 envelope adapter 产出 canonical text，再复用 `parseModelStructuredJsonObject` 做 JSON normalization 与 validation。structured parser 不能替代 engine envelope 适配。
- **repair 二选一**：
  - 复用同一 thread/session，再只发送 schema、validation error 与 bounded invalid output。
  - 保持独立 session，但发送经过压缩且足以重新生成的 evidence pack，不能假设新 session 记得首次证据。
- 收益必须通过改前/改后的 repair 输入 tokens、P95 时延与成功率验证，不预先承诺固定 80%。

### UI 变化

**无直接 UI 变化**。预期降低 repair 成本与长尾耗时，并让解析失败保持可追踪、可定位。

## 6. ProjectMapPanel.tsx 1945 行 / 17 useState

**状态**：🔶 部分变化，且治理报告的一条证据**当前查无实据**。

### 现状（证据）

- 体量属实：`src/features/project-map/components/ProjectMapPanel.tsx` 当前 **1945 行**，`useState` 调用 **17 处**（另有 37 处 `useState|useReducer` 匹配含类型导入）。
- **跨层直写证据未复现**：治理报告称"面板仍直接 import orchestration 存储跨层直写"，但在当前 HEAD 对 `src/features/project-map/**` 检索 `kanban|orchestration` **零命中**。面板的 import 已收敛到自身 feature 内的 hooks（`useProjectMapDataset`、`useProjectMapGraphInteractionHandlers`、`useProjectMapIntentCanvasHandlers`）与 utils（`interactiveLayout`、`impactAnalysis`、`contextBuilder`）。该条证据**疑似已随编排中心删除而消失，或原始定位有误**——立项前需复核，不能按旧描述设计拆分方案。
- 剩余的真实债务：面板仍承载图谱布局计算、镜头（lens）过滤、impact 分析、intent-canvas 联动、生成队列展示等多重职责。

### 影响什么

- 1945 行 + 17 个独立 state + 12 个 `useEffect`：修改镜头切换等交互时，需要同时审查多个 state/effect 的同步关系。
- 图谱交互、配置、队列和历史共享同一个 component owner，扩大了改动与回归审查范围。是否存在实际渲染瓶颈仍需 profile 证明。

### 处理后的影响

- 先画 state/effect ownership map，再沿现有 hooks 和稳定 UI boundary 拆分，避免按文件行数机械切块。
- 候选 owner：**GraphCanvas**（布局 + 交互）、**LensBar**（过滤）、**RunQueuePanel**（生成队列/历史）、**ImpactPanel**（影响分析）。面板壳只做组合与跨 owner 协调。
- state 只在存在单一 owner 时下沉；跨 owner 共享状态保留明确的 canonical owner，通过 typed props/回调传递。
- 风险点：拆组件本身不保证减少 render。必须用 React Profiler 对比关键交互的 commit 次数与耗时。

### UI 变化

**无**。本项首先改善可维护性；只有 profile 证明 render boundary 收敛后，才能声明性能收益。

## 7. worktree 默认分支名无语义

**状态**：✅ 已修复。Create Worktree dialog 不再生成 `codex/<date>-<random>`，branch 默认留空并由用户显式填写。

### 现状（证据）

`src/features/workspaces/hooks/useWorktreePrompt.ts`：

```ts
setWorktreePrompt({
  workspace,
  branch: "",
  // ...
});
```

当前创建弹窗只有 branch、baseRef、publish 与 setupScript 等字段，没有可靠的"worktree 目的"事实。系统不再伪造语义：现有 branch input、示例 hint、Git ref validation 和 submit guard 共同要求用户填写真实名称。

### 影响什么

- 不再自动产生日期 + 随机字符的不可识别分支。
- 不再让非 Codex engine 创建的 worktree 带 `codex/` 前缀。
- 用户必须输入合法 branch name，名称语义由真实任务意图决定。

### 处理后的影响

- `openPrompt` 每次初始化 `branch: ""`，重新打开 dialog 不保留旧值。
- UI 的 Create action 在 branch 为空时保持 disabled。
- hook 增加 required guard；即使绕过 UI 直接调用 `confirmPrompt`，空 branch 也不会进入 create payload。
- 合法 branch、baseRef、publish 与 setupScript 流程保持不变。

### UI 变化

**有**：branch input 打开时为空并自动聚焦；用户填写合法名称后才能创建。没有新增字段或额外交互层。

## 8. workspaces 错误契约靠字符串匹配

**状态**：❌ 未做（当前 HEAD 已核实）。

### 现状（证据）

`src/features/workspaces/hooks/useWorktreePrompt.ts`：

- `:109-117` `isNonGitRepositoryError`：靠 `message.toLowerCase().includes(...)` 匹配 **6 种英文错误文案**（"could not find repository"、"not a git repository"、"class=repository"、"code=notfound"、"repository not found"、"git root not found"）判断"不是 git 仓库"。
- `:119-120` 另有前缀契约：`VALIDATION_ERROR:` 和 `Worktree created locally, but push failed:`——后端改任何一个措辞，前端的错误分类就失效。

### 影响什么

- **后端改措辞，前端就瞎**：把 "not a git repository" 改成 "no git repository found"，用户得到的就不是"该目录不是 git 仓库"的友好提示，而是裸错误文案糊脸。
- **匹配清单永远不全**：6 种子串是撞一个补一个攒出来的，git/libgit2 不同版本的报错变体覆盖不全。
- **i18n 隐患**：后端若本地化错误文案，子串匹配全灭。

### 处理后的影响

- **错误契约结构化**：后端 Tauri command 返回 typed error（如 `{ kind: "not_git_repo" | "push_failed" | "validation", message, retryCommand? }`），前端 switch on kind，不再碰 message 文案。
- 前端匹配逻辑从 6 种子串 + 2 个前缀，收敛为一个 discriminated union——后端措辞随便改，分类不受影响。
- 风险点：双端改动（Rust 侧错误类型 + 前端消费），需要为每种错误路径补契约测试；可作为 engine/workspace 错误契约统一改造的第一块样板。

### UI 变化

**有**：

1. "非 git 仓库"等场景的错误提示**稳定友好**（不再偶发裸英文报错）。
2. `retryCommand` 结构化后，可渲染"**一键重试**"按钮而不是让用户手抄命令。

## 9. 文件列表 30s 全量轮询

**状态**：🔶 比治理报告描述略好——**已有指数退避**，但仍是全量轮询。

### 现状（证据）

`src/features/workspaces/hooks/useWorkspaceFiles.ts`：

- `:167` `BASE_REFRESH_INTERVAL_MS = 30_000`，`:168` `MAX_REFRESH_INTERVAL_MS = 180_000`。
- `:544-553`：轮询带**失败退避**——连续失败时间隔按 `2^n` 翻倍，最高 180s；成功路径仍是固定 30s 全量刷新（`refreshFiles("poll")` 拉整个文件树快照）。
- 无 fs watcher 事件通道（对比：`GitHistoryWorktreePanel` 已有 `external_changes` watcher 先例）；轮询 effect 未使用 `setVisibilityGatedInterval` 或 `document.visibilityState`。

### 影响什么

- **空转**：文件树不变时，每 30s 全量拉一次快照——大 monorepo 的文件列表序列化 + IPC 是实打实的开销。
- **新鲜度与开销的死结**：30s 意味着"新建文件最长 30s 才出现在列表"；想更快就得更频繁轮询，更浪费。

### 处理后的影响

- 接 **fs watcher**（复用 `external_changes` 先例）：文件变更事件驱动刷新，轮询降级为 ≥30s 的可见性门控兜底（符合仓库"事件驱动 + ≥30s 兜底，禁秒级轮询"红线）。
- 或做**增量更新**：后端推送变更路径集，前端局部 patch 文件树，不再全量拉。
- 风险点：watcher 在大型 monorepo 的事件风暴需要节流/去抖；远端 SSH workspace 无本地 fs 事件，轮询兜底必须保留。

### UI 变化

**无直接 UI 变化**。事件覆盖的本地变更可更快出现；可见性门控减少后台 IPC。由于仍保留兜底轮询，不能宣称空转完全消失。

## 待办项与实施顺序

### 已闭环

| ID | 实际改动 | 解决的问题 | 验证 |
|---|---|---|---|
| #1 | Weak snapshot cache + indexed `normalizedText` | 消除同一 snapshot 每次 query 的重复全量物化与 lowercase 分配 | 3 个 Search focused test files、18 个测试通过；typecheck/ESLint 通过 |
| #7 | Worktree branch 默认留空 + UI/hook 双层 required guard | 阻止无语义、engine-biased 默认分支进入创建流程 | Worktree hook/component focused tests 通过；typecheck/ESLint 通过 |

### 未完成

| 批次 | ID | 待办项 | 改动描述 | 解决的问题 | 验收标准 | 前置依赖 / 风险 |
|---|---|---|---|---|---|---|
| 第一批：建立证据 | #5 | 量化 Project Map repair 成本 | 增加 repair 触发率、输入 tokens、耗时和成功率指标；区分 engine | 判断是否值得优先改造，避免只凭 52k 上限估算成本 | 可按 engine 查看 repair rate、P95、平均/最大输入 tokens 与最终成功率 | 指标不得记录 prompt/evidence 原文 |
| 第二批：低风险止血 | #9 | watcher + 可见性门控兜底 | 复用现有 external change event；事件节流刷新，≥30s visible-only fallback | 减少静默期全量 IPC，并缩短本地文件变化可见延迟 | watcher、节流、hidden pause、remote fallback 测试通过；无事件风暴 | watcher 未必覆盖 `.git/index`；远端 workspace 必须保留 fallback |
| 第二批：低风险止血 | #5 | 收敛 repair 与响应 contract | 增加 engine envelope adapter；选择 same-session repair 或 bounded evidence pack | 避免脆弱的字段嗅探和无条件重发完整证据 | structured-output、repair success/failure、session continuity tests 通过；repair tokens/P95 优于基线 | 新 session 不能直接省略原始证据 |
| 第三批：Cross-layer | #8 | typed worktree error | Rust/Tauri 返回 discriminated error；前端按 `kind` 分类并保留兼容 fallback | 后端改文案时，前端错误提示与 retry action 不失效 | `not_git_repo`、`push_failed`、`validation`、unknown 均有双端 contract test | 需要 OpenSpec change；兼容旧 backend/runtime |
| 第四批：生成质量 | #4 | 可解释的 evidence ranking | 先做确定性评分与 selection telemetry，再按证据决定是否接 semantic retrieval | 提高不同技术栈和大仓库的 evidence coverage | 多技术栈 fixture 的入口文件/显式 source 命中率提高；入选原因可追踪 | 不把 embedding 设为默认依赖；显式 source 优先 |
| 第四批：架构治理 | #6 | 拆分 ProjectMapPanel owner | 先画 ownership map，再沿现有 hooks 拆 GraphCanvas/LensBar/RunQueuePanel/ImpactPanel | 降低职责耦合、单次改动范围和回归审查成本 | behavior tests 不变；owner 边界清晰；如宣称性能收益，需 Profiler 对比 | 拆文件不等于降 render；禁止顺带重写已有 hooks |

## 产品决策项，不直接进入开发

| ID | 当前 contract | 需要什么证据 | 若决定变更 |
|---|---|---|---|
| #2 | SearchPalette 负责主动检索；QuickSwitcher 负责最近上下文恢复 | 用户是否持续混淆入口；从 QuickSwitcher 跳转 Global Search 的频率与失败场景 | 新建 OpenSpec change，明确双入口文案优化或入口合并，不在实现阶段临时改职责 |
| #3 | QuickSwitcher 无 search input，sessions/files 各取最新 30 条 | 超出 30 条后无法恢复目标上下文的真实案例；MRU 与 frecency 的任务完成率对比 | 修改 `quick-context-switcher` spec，并重新验证 bounded viewport、keyboard model 与 Global Search 分工 |

每个可执行项应按 capability 单独创建或选择 OpenSpec change。#5、#8 属于 cross-layer contract，不能只改前端；#2、#3 未完成产品决策前不得进入实现。
