# 对话幕布结构（多 CLI + 共享会话）

> **对照源码日期**：2026-08-01（二次校准；产品 **`0.7.14`**）
> **实现状态**：统一幕布 Phase A–E 已入库（`bf3b35bd6`）；滚动所有权状态机已入库（`b34fdaead`）
> **范围**：中心对话区（幕布 / Messages 时间线）
> **用途**：**现网结构**底稿 + 排障入口；过程后验见 unify-review，能力登记见 matrix
> **目录索引**：[`README.md`](./README.md)
> **任务 PLAN**：`docs/plans/2026-08-01-unified-conversation-canvas-architecture.md`
> **滚动 DESIGN / 代码**：`docs/plans/2026-08-01-conversation-canvas-scroll-ownership-architecture.md` · `orchestration/scrolling/scrollAuthorityMachine.ts`（§7.3）
> **实现后验**：[`unify-conversation-canvas-review-2026-08-01.md`](./unify-conversation-canvas-review-2026-08-01.md)
> **过程投影矩阵**：[`canvas-live-tool-projection-matrix-2026-08-01.md`](./canvas-live-tool-projection-matrix-2026-08-01.md)
> **不在本文**：Intent 画板、Status Panel 内部、Composer 细节、完整 realtime 字典、perf 绝对数字（见 `docs/perf/**`）
> **事实源**：`src/features/messages/**`、`layout/hooks/**`、`threads/**`、`shared-session/**`、`conversation-presentation/**`、`live-canvas/**`
> **契约旁路**：`docs/chat-canvas-conversation-curtain-contracts.md` + `threads/contracts/conversationCurtainContracts.ts`（落后则以源码为准）

---

## 0. 怎么读（按角色）

| 你要… | 优先章节 |
|--------|----------|
| 30 秒搞清全局 | §1 结论 + §2 术语 |
| 统一架构 / 收敛引擎差异 | §1、§5、§6、§10 |
| 修功能 bug（工具卡/折叠/footer） | §3C、§8、§9 |
| 修滚动/流式卡顿 | §3A、§7、§7.1、§7.2、§9 |
| **「显示更早 / 历史展开」与锚点** | **§7.1** |
| **「详情已延迟 / 渲染详情」**（对话/行级已下线；块级显示详情保留） | **§7.2** |
| **滚动所有权 / 飞顶 / 结束离真底** | **§7.3** |
| **Grok 实时读/写过程卡（jsonl 桥）** | **§5.1** · matrix |
| 改 Shared 历史/发送观感 | §6、§9 |
| 改代码从哪进 | §11 源码索引 |

**原则**：代码存在 ≠ 默认开启。以 settings 默认值 + AppShell 硬编码 + 无 flag 的 hard branch 为准。

---

## 1. 结论（默认运行态）

| 点 | 事实 | 大白话 |
|----|------|--------|
| **一套 UI 核** | 所有 native CLI + Shared 都走 `Messages → MessagesCore → MessagesTimeline → TimelineRowRenderer` | 不是 6 套聊天窗口，是一套窗口接不同水管 |
| **差异三层** | **L1 数据入口**最大；**L2 引擎硬分支**常驻；**L3 presentationProfile 默认关** | 真差别在「数据从哪来 + 写死的 if」；配置表大多在休眠 |
| **Shared 不是第七套 Row** | `threadKind=shared`，`threadId` 前缀 `shared:`；多的是历史投影 + 发送条 | 同一张画布，多了「换引擎跑」和发送状态条 |
| **Shared 引擎白名单** | `claude / codex / kimi / grok / opencode`（**无 gemini**） | Gemini 进不了共享会话 |
| **Gemini runtime policy** | registry / adapter / loader 仍存在，但 `GEMINI_RUNTIME_ENABLED=false` | 代码能力存在不等于产品 runtime 可用 |
| **Settings 三开关** | normalized realtime=`true`；unified history=`true`；presentationProfile=`false` | 新实时/新历史默认开；「引擎皮肤表」默认关 |
| **Claude/Codex 幕布更「干净」** | bash/command 卡默认藏；活动多在 **Status Panel**（同屏兄弟，不在 Messages 树） | 命令跑了，幕布可能没卡——去底下状态面板找 |
| **文件修改场景** | 连续 edit + fileChange → `editGroup`（单条也成组）；**默认折叠**；展开才解析 diff | 一堆改文件合成「文件修改（N 个）」，先收着 |
| **流式 vs 闲时性能** | 流式：尾窗 60 + live-text 外置 + staged MD；**不**虚拟化。闲时：≥约 48 行可虚拟化 | 打字中只画尾巴；聊完了长历史才开虚拟列表 |
| **Grok 实时工具进幕布** | stdout 仍无 tool 事件；**已落地 jsonl 增量 tail 桥**（`GrokToolHistoryTailState`，~200ms + 结束 drain；resume baseline=EOF）`bf3b35bd6` | Kimi/OpenCode 原生 stream Tool*；Grok 桥补可见性，时序弱于协议事件 |
| **历史呈现展开（Presentation Expansion）** | 把「只渲一部分 items」切到「全量 history」；`showAllHistoryItems` + `presentationMode=*-expanded-history-*` | 点「显示更早」/ 跳旧消息；**不是**截图里的「详情已延迟」 |
| **闲时数量折叠几乎关着** | `VISIBLE_MESSAGE_WINDOW=10000`（A2 有意）；**流式尾窗仍开** `STREAMING_VISIBLE_WINDOW=60` | 日常闲时很少看到「显示更早」；**流式中**更易看到折叠指示器 |
| **对话/行级轻量摘要墙** | **已下线（unify-conversation-canvas）**：policy/mode 恒 inactive；行级「详情已延迟」条不再渲染 | 见 §7.2；**块级「显示详情」仍保留** |
| **块级重型延迟** | Markdown 大表 / 工具重 output 仍可「显示详情」 | 与行级摘要墙分离 |
| **终轮 footer** | 助手 `isFinal` 行可挂 final boundary meta（完成时间 / 耗时 / token） | 回合结束有轻量汇总，不靠再挂一层独立卡 |

---

## 2. 术语（专业词 · 大白话）

| 词 | 意思 |
|----|------|
| **幕布 / Conversation Canvas** | 中间那条消息时间线；不是意图画板，也不是底栏状态面板 |
| **渲染核** | Messages 这一套 React 树；谁发消息都往这画 |
| **ConversationItem** | 时间线条目统一模型：`message / reasoning / tool / review / diff / explore / generatedImage` |
| **projection（投影行）** | 条目再加工成「要画的行」：工具分组、工作中指示、空态、审批槽位等 |
| **loader（历史加载器）** | 打开会话时，按 `threadId` 前缀把磁盘/服务端历史读进 items |
| **realtime adapter（实时适配器）** | 把引擎事件翻译成统一 item 变更，写进 reducer |
| **hard branch（引擎硬分支）** | 代码里 `if (engine === "codex")` 这类，不依赖开关也生效 |
| **presentationProfile** | 按引擎挂的「呈现皮肤」表；**默认关**，别当现网行为表 |
| **staged MD** | 流式时用轻量 Markdown 分阶段刷，少卡顿（claude+codex **硬编码**开启） |
| **live-text externalization** | 流式正文走 `liveAssistantTextChannel` 旁路，不全塞进 reducer 每字一次 |
| **virtualization（虚拟列表）** | 只挂载视口附近 DOM；闲时开，流式默认关 |
| **fileEdit 场景** | 改文件工具合成一张「文件修改」卡，默认折叠 |
| **final boundary meta** | 助手终轮 footer 旁的完成时间 / 耗时 / token 文案 |
| **settle-repin** | 回合结束 live 尾窗回刷全量后，在预算窗口内把视口钉回底部 |
| **历史呈现展开 / Presentation Expansion** | 历史窗口从「折叠/尾窗」切到「全量 items」；`showAllHistoryItems` + `historyExpansionMode`（§7.1） |
| **presentationMode** | 历史可见集模式：`realtime/static` × `collapsed/expanded/full` × `manual/jump`（§7.1） |
| **presentationScopeKey** | mode + 折叠计数 + 首尾 item id 拼出的 scope；变了等于换了一套可见集 |
| **historyExpansionMode** | 历史展开原因：`manual`（显示更早）或 `jump`（跳旧锚） |
| **live 尾窗** | 流式只保留近端约 `STREAMING_VISIBLE_WINDOW*2` 条 |
| **行内展开（in-row expand）** | 单卡内部折叠打开（fileEdit / explore 等）；不是 presentationMode |
| **⚠️ 详情延迟 / deferred hydration** | heavy 行先以 **summary** 占位（文案「详情已延迟」），点「渲染详情」再 hydrate 完整 DOM（§7.2） |
| **renderWeight / 渲染权重** | 按行估算渲染成本；`≥ TIMELINE_VIRTUALIZATION_HEAVY_ROW_WEIGHT(16)` 记为 heavy row |
| **conversation lightweight mode** | 对话级轻量策略：建议/强制把 heavy 行压成摘要条；oversized 可自动开 |
| **hydration mode** | 行级：`static` / `summary` / `hydrated`；`deferred` 时 UI 走摘要条 |
| **Shared Session** | 一个会话里可切换执行引擎；历史可 merge 投影 |
| **Hidden Binding** | Shared 背后的 native 绑定会话；**不进幕布**，也不应进侧栏当独立会话 |
| **chrome** | 幕布旁边的条/卡/对话框，不在时间线行里（如发送状态条、侧锚） |

---

## 3. 多角度：数据怎么变像素

### 3A. 挂载与数据面（Shell → 幕布）

```mermaid
flowchart LR
  Shell["useLayoutNodes"] --> Store["activeCanvasStore<br/>高频状态旁路"]
  Shell --> Node["buildConversationCanvasNode"]
  Store -.->|selector| ACM["ActiveCanvasMessages"]
  Node --> ACM --> MSG["Messages"] --> CORE["MessagesCore"] --> TL["Timeline"] --> ROW["TimelineRowRenderer"]
  Loaders["history loaders"] --> TH["threads items"]
  RT["realtime adapters"] --> TH
  SharedProj["shared projection"] --> Loaders
  TH --> Store
```

| 层 | 文件 | 干什么（大白话） |
|----|------|------------------|
| Layout | `layout/hooks/useLayoutNodes.tsx` | 拼会话状态、是否 Shared、Composer 旁发送条 |
| Canvas 节点 | `layout/hooks/conversationCanvasNode.tsx` | 挂 Messages + fork 对话框；**不选 heartbeatPulse**，防 5s 心跳整树重渲 |
| 高频旁路 | `layout/hooks/activeCanvasStore.ts` | items / thinking / approvals 不走 Shell 大 props 树 |
| 门面 | `messages/components/Messages.tsx` | 旧 props 适配 → Core |
| 编排 | `messages/components/MessagesCore.tsx` | 窗口、滚动、runtime、交给 Timeline |
| 时间线 | `messages/components/MessagesTimeline.tsx` | 投影 +（可选）虚拟列表 + 逐行渲染 |
| 行分发 | `timeline/components/TimelineRowRenderer.tsx` | kind → 具体气泡/工具卡 + final boundary footer |

**统一幕布提示**：任何「多引擎各挂一套 Messages」的方案，都会与 `activeCanvasStore` 旁路 + Shell 节点契约冲突；收敛应发生在 **L1 水管 / L2 策略表**，不是再长一棵树。

### 3B. 渲染管线（一份，勿重复画）

```text
ConversationItem[]
  → 过滤 / 去重 / 流式尾窗 / 折叠中间步骤
  → groupToolItems()
       read|bash|search：连续 ≥2 成组
       fileEdit：edit|write + fileChange 归并，≥1 即成 editGroup
  → buildTimelineProjectionRows()
       entry | workingIndicator | emptyState | approval | …
  → TimelineRowRenderer（外包 ConversationRowErrorBoundary）
```

| 步骤 | 路径 |
|------|------|
| 分组 | `messages/utils/groupToolItems.ts` |
| 投影 | `timeline/projection/messagesTimelineProjection.ts` |
| 行分发 | `timeline/components/TimelineRowRenderer.tsx` |
| 契约 kinds | `threads/contracts/conversationCurtainContracts.ts` |
| 流式尾窗 | `orchestration/presentation/messagesLiveWindow.ts` + `STREAMING_VISIBLE_WINDOW` |

**editGroup 投影 identity**：`getGroupedEntryProjectionKey` 对 `editGroup` **只用 firstId**。
streaming 时文件数增长若写入 lastId/length，会 remount 并丢掉用户展开态——修「折叠莫名重置」先看这里。

### 3C. kind → 组件 · 分组 · chrome 边界

| kind | 组件 | 备注 |
|------|------|------|
| `message` | `MessageRow` | 用户/助手主气泡；流式可走 live-text；终轮可有 action footer |
| `reasoning` | `ReasoningRow` | 思考；Claude dock 路径默认空 |
| `tool` | `ToolBlockRenderer` 或 Group | 可被引擎策略隐藏 |
| `review` / `diff` / `explore` / `generatedImage` | `PresentationRows` 等 | 评审 / diff / 探索 / 图 |

**工具分发（单卡）**：`ToolBlockRenderer` — userInput 结果 → ExitPlan → bash → read → edit → search → MCP → Generic。
**常态改文件**：多进 `EditToolGroupBlock`（默认折叠），不常落单卡 `EditToolBlock`。

**分组卡**

| 组 | 组件 | 策略 |
|----|------|------|
| `readGroup` | `ReadToolGroupBlock` | ≥2 连续 |
| `editGroup` | `EditToolGroupBlock` | fileEdit 桶；≥1；**默认折叠**；同 path 留最后一次；展开再算 diff |
| `bashGroup` | `BashToolGroupBlock` | 五引擎藏（与单卡一致）；Claude 仅 transcript-fallback 极重历史时可露 |
| `searchGroup` | `SearchToolGroupBlock` | ≥2；MCP `search_query` 故意不组 |

另：`TodoWrite` / `todo_write` 在分组前剔除（`shouldHideToolItemForRender`）。

**非 item 行（时间线补丁）**：`workingIndicator`、`tailUserInput` / `approval`、`liveMiddleCollapsed`、`emptyState` / `historyRecoveryFailure`、`bottomAnchor`、`dockedReasoning`（**默认死路径**）。

**MessageRow 常挂子面**：用户长文折叠、记忆/笔记/Intent/浏览器上下文摘要、协作 badge（仅 codex）、图片、任务输出检查器、断线恢复卡。

**周边 chrome（同屏非时间线行）**

| 组件 | 说明 |
|------|------|
| `MessagesAnchorRail` | 侧栏跳用户消息（只预览 user，躲流式打穿） |
| `ScrollControl` | 贴底/跳转；含 turn-settle、scroll-echo 过滤 |
| `MessagesOutlineFloater` | 大纲；`SHOW_OUTLINE_FLOATER=false` 产品关 |
| `TurnFilesChangedCard` | 回合改文件摘要（与 final boundary 联动：末轮闲时由累计卡承载） |
| `MessageForkConfirmDialog` | fork；codex 可带 provider 选择 |
| `SharedSendStatusBar` | **仅 Shared**，Composer 上方 |
| `ProviderContinuationContextCard` | 续聊来源（`timelineLeadingNode`） |

**信息架构一句话**：幕布 = 叙事；Status Panel = 操作痕迹；Composer = 输入。
藏 bash 不等于没跑命令——用户去 Status Panel 找。

---

## 4. 默认运行态矩阵

### 4.1 总开关

| 开关 | 默认 | 影响（大白话） | 锚点 |
|------|------|----------------|------|
| `chatCanvasUseNormalizedRealtime` | true | 实时事件走统一 adapter | `useAppSettings.ts` |
| `chatCanvasUseUnifiedHistoryLoader` | true | 历史走统一 loader 工厂 | 同上 |
| `chatCanvasUsePresentationProfile` | **false** | 引擎皮肤表休眠 | 同上 |
| Shared projection | true（可 localStorage / env 关） | Shared 历史默认可 merge 投影 | `sharedProjection/dataSource.ts` |
| `TIMELINE_ADAPTIVE_RENDERING_ENABLED` | true | 闲时虚拟化 / oversized 轻量模式总闸 | `messagesTimelineVirtualization.ts` |
| idle 虚拟化门槛 | 行数 ≥**48** 或 renderWeight ≥**96** | 长历史才开虚拟列表 | 同上 |
| `TIMELINE_VIRTUALIZATION_DURING_STREAMING_ENABLED` | **false** | 流式不用虚拟列表，用尾窗 | 同上 |
| `STREAMING_VISIBLE_WINDOW` | 60 | 流式只保留近端条目（约 `*2` 工作集） | `messagesRenderUtils.ts` |
| `VISIBLE_MESSAGE_WINDOW` | **10000** | 闲时数量折叠阈值（现网几乎关） | 同上 |
| `liveTextExternalization` | true（`ccgui.perf.liveTextExternalization=0` 回退） | 流式正文字走旁路 | `realtimePerfFlags.ts` |
| `claudeThinkingVisible` | true（AppShell 写死） | Claude 思考默认显示；dock 遗留门闩打不开 | `useAppShellClaudeThinkingSection.ts` |
| `SHOW_OUTLINE_FLOATER` | false | 大纲浮层关着 | `MessagesTimeline.tsx` |
| `SETTLE_REPIN_WINDOW_MS` | 2400 | 回合结束回刷后钉底预算 | `messagesConstants.ts` |
| `INITIAL_BOTTOM_PIN_BUDGET_MS` | 2400 | 打开会话后跟随预算 | 同上 |

### 4.2 presentationProfile（默认关）

路径：`conversation-presentation/presentationProfile.ts`。仅 `usePresentationProfile===true` 时 `resolvePresentationProfile` 生效。

| 字段 | 引擎意图 | 默认关时是否另有硬编码 |
|------|----------|------------------------|
| staged MD throttle | codex profile | **有**：claude+codex 恒 true（`shouldUseStagedStreamingMarkdown`） |
| preferCommandSummary | codex | **有**：WorkingIndicator 对 codex 仍偏命令摘要 |
| codexCanvasMarkdown / showReasoningLiveDot | codex | **无** |
| heartbeatWaitingHint | opencode | **无**（且 heartbeat 不经 ActiveCanvas 大 props） |

### 4.3 Claude dock 死路径（勿当产品能力）

```text
legacyClaudeReasoningDockEnabled =
  engine===claude
  && typeof claudeThinkingVisible !== "boolean"  // 现网是 boolean true → 永远 false
  && shouldHideClaudeReasoningModule()
```

---

## 5. 引擎硬分支矩阵（常驻，与 profile 无关）

| 行为 | Claude | Codex | Grok | 其他（gemini/kimi/opencode） | Shared |
|------|--------|-------|------|------------------------------|--------|
| 藏 bash 单卡 | ✅ | ✅ | ✅（对齐 Claude） | ✅ Kimi/OpenCode | 跟目标引擎 |
| **实时 tool 进幕布** | ✅ | ✅ | ✅ **jsonl 增量 tail 桥** | Kimi/OpenCode：stream Tool* | 跟目标 adapter |
| **历史 tool 进幕布** | ✅ | ✅ | ✅ jsonl | ✅ | 跟目标 loader |
| 藏 bashGroup | ✅* | ✅ | ✅ | ✅ | 同上 |
| 协作 badge | ❌ | ✅ | ❌ | ❌ | 目标=codex |
| staged MD | ✅ 硬编码 | ✅ 硬编码 | ❌ | ❌ | 跟目标 |
| 超长流式折叠 | ✅ | ❌ | ❌ | ❌ | 跟目标 |
| activity 偏命令摘要 | ❌ | ✅ | ❌ | ❌ | 目标=codex |
| Fork provider 选择 | ❌ | ✅ | ❌ | ❌ | 目标=codex |
| docked reasoning | 死路径 | — | — | — | — |
| SharedSendStatusBar | — | — | — | — | ✅ 独有 |
| Realtime 消息模式 | delta 别名 | **快照** | delta 别名 | delta 别名 | 跟目标 adapter |

\* Claude 在 history transcript fallback（极重历史且折叠后几乎没东西可画）时，bashGroup 可露出。
\* Grok 的「幕布无读/写卡」**不是** `shouldHideCodexCanvasCommandCard` 式隐藏，见 **§5.1**。

### 5.1 Grok 实时对话：读/写过程卡（演进：缺口 → jsonl 桥）

> **演进（勿删）**
> - **改前（~2026-08-01 上午）**：实时 Grok 幕布常只有思考 + 短助手句；右侧 **Diff** 已有 +N/-N，幕布**无** Read/Edit 卡——根因是 **stdout 无 tool 事件**，不是「详情已延迟」。
> - **改后（`bf3b35bd6`）**：并行 **poll `chat_history.jsonl`** 把 `tool_calls`/`tool_result` 桥成 ToolStarted/Completed；读/写类应可见；bash/command **藏**（与 Claude 对齐）。
> - **仍弱于 Claude**：时钟跟磁盘 poll（~200ms + 写盘），payload 常偏 raw；详见 matrix。

#### 现网结论

| 问题 | 答案 |
|------|------|
| 现在 live 有 tool 进 reducer 吗？ | **有（桥）**；非 stdout 原生 |
| 和「藏 bash」是一回事吗？ | **否**。藏的是 command/bash；read/write/search 应显示 |
| 是「详情已延迟」吗？ | **否**。那是呈现层；Grok 历史问题是 L1 信号源 |
| 历史 loader 有 tool 吗？ | **有**。jsonl `tool_calls` / `tool_result` 本就可投影 |
| 续聊闪旧 tool？ | **应否**：`for_turn(true)` 首开 baseline=EOF；新会话 `for_turn(false)` / saw_missing → offset=0 |

#### 因果链（L1 水管）— **已落地**

```text
Grok CLI headless streaming-json
  stdout 仍只有: text | thought | end | error
        │
        ├──► TextDelta / ReasoningDelta / TurnCompleted
        │
        └── 并行 poll chat_history.jsonl（~200ms + 结束 final drain）
              tool_calls  → ToolStarted
              tool_result → ToolCompleted
                    │
                    ▼
              forwarder → item/started|completed
                    │
                    ▼
              幕布 kind=tool（read/fileChange 归场景；bash 可藏）
```

| 层 | 路径 | 事实 |
|----|------|------|
| CLI stdout | `grok.rs` parse | 仍无 tool 行类型 |
| **Live 桥** | `grok.rs` + `grok_history::GrokToolHistoryTailState` | 增量 seek + carry；resume/new 分轨 |
| Kimi | `kimi.rs` stream | 原生 tool_calls；Completed 带 tool_name |
| OpenCode | `opencode.rs` | 原生 Tool* |
| FE | `toolSemantics` · `ToolBlockRenderer` · `shouldHideCodexCanvasCommandCard` | 五引擎藏 bash |
| Diff 面板 | 工作区 git | 仍独立；可与幕布 tool 并存 |

#### UI 三件套（改后怎么读）

| 表面 | 实时 Grok 写文档时（期望） | 含义 |
|------|---------------------------|------|
| **幕布** | 思考 + 助手句 + **读/写类 tool 卡**（可略滞后） | jsonl 桥投影 |
| **Diff 面板** | 文件 +N/-N | 工作区 git，不依赖幕布 tool |
| **Status** | 活动/任务态 | bash 类痕迹可在此；≠ 幕布叙事 |

#### 后续能力债（桥接之后）

| 优先级 | 项 | 说明 |
|--------|-----|------|
| **P2** | 延迟/抖动 | ~200ms poll + 写盘；仅在实测证明收益后评估跨平台 filesystem notifications，必须覆盖 partial write、atomic replace、rename 与 macOS/Windows/Linux 语义；polling 保持可靠基线 |
| **P2** | stdout 原生 tool | CLI 若日后直发 tool，需双通道去重 |
| **P2** | 能力矩阵 codegen | 见 matrix；勿只写文档 |

**History 前缀路由**（`useThreadActions.historyLoaderFactory.ts`）：

| 前缀 | loader |
|------|--------|
| `shared:` | `createSharedHistoryLoader` |
| `claude:` | Claude JSONL + shadow |
| `gemini:` | Gemini（Claude 解析器族） |
| `grok:` / `kimi:` | 本引擎 parser |
| `opencode:` | `resumeThread` 快照（非本地 JSONL） |
| 默认 | Codex resume + 本地 session 融合 |

**Realtime 注册**：`threads/adapters/realtimeAdapterRegistry.ts` — 六引擎各一 adapter；codex = `agentMessageSnapshotMode: "snapshot"`，其余 `allowTextDeltaAlias: true`。

---

## 6. Shared Session（跨引擎单幕布）

| 项 | 值 | 大白话 |
|----|-----|--------|
| 身份 | `threadKind=shared`，`threadId` 以 `shared:` 开头 | 一看 id 就知道是共享会话 |
| 可执行引擎 | claude/codex/kimi/grok/opencode；非法回落 claude | 没有 Gemini |
| 当前目标 | `selectedTarget` / `selectedNextTarget`（下一次 Send） | 这一轮谁来跑 |
| 历史 | Legacy snapshot ⊕（可选）SharedProjection merge | 老快照 + 新投影拼在一起 |
| 发送 | sendStateMachine → runtime 事件进同一 items | 幕布仍只吃 ConversationItem |
| 额外 UI | SharedSendStatusBar；续聊来源卡 | 状态条在 Composer 上，不在时间线里 |
| Hidden Binding | 后台 native 绑定；侧栏/幕布不应当独立会话露出 | 修「多出来一行会话」看 summaries 过滤 |

历史路径（简）：

```text
shared:id → createSharedHistoryLoader
  → loadSharedSession（legacy）
  → [projection 开] loadSharedProjection → toSharedConversationItems
  → 有 legacy 则 merge，否则仅 projection
  → normalize → setThreadItems → activeCanvasStore → Messages
```

要点：

1. `sharedProjection/dataSource.ts` **不** import native `threadItems`（隔离）。
2. 投影丢弃 `systemNotice` / `metadata`（观测面，不进幕布）。
3. 消息可带 `engineSource` / `executionTargetSnapshot`（「这轮谁跑的」痕迹）。
4. UI 行组件与 native **完全同一套**。
5. 开关：`mossx.sharedProjection` / 旧 key `ccgui.sharedProjection` / `VITE_MOSSX_SHARED_PROJECTION`；Settings Other 区有测试回滚开关（改后 reload）。

**供应商/模型**（幕布旁 Composer 行为，细节见姊妹文）：Shared 切渠道只改 `selectedNextTarget`，不新建会话、不走 Native 续接。见 `docs/analysis/native-session-provider-select-vs-disk-overwrite-2026-07-31.md`。

---

## 7. 流式 / 闲时 / 性能旋钮

| 阶段 | 策略 | 目的 |
|------|------|------|
| 流式 | 尾窗裁剪 + static DOM；**不**开虚拟化 | 避免 virtualizer attach 把视口拽飞 / size cache 空 |
| 流式正文 | live-text 外置（默认开） | 减根 reducer 每 delta 重渲 |
| 流式 Markdown | claude/codex staged throttle | 少 full react-markdown 重解析 |
| 回合结束 | settle-repin 2.4s | 尾窗回全量后 scrollHeight 暴增仍贴底 |
| 打开会话 | initial bottom pin 2.4s | 虚拟化/测量收敛前跟底 |
| 闲时长历史 | rows≥48 或 weight≥96 虚拟化 | 降低全量 DOM 滚动成本 |
| 中间步骤 | live collapse middle（local flag） | 可选折叠中间输出 |
| 历史呈现展开 | 见 **§7.1** | 「显示更早」/ 跳旧消息打开全量 items |
| **⚠️ 详情已延迟** | 见 **§7.2** | heavy 行摘要条 +「渲染详情」；**重点重做** |

**改门槛前必回归**：`Messages.virtualized-jump`、scroll-echo、turn-settle 贴底、历史展开跳锚、**详情 hydrate 后锚点**。
**perf 深读**：`docs/perf/render-jank-knife-experiments-2026-07-08.md`、`docs/perf/streaming-render-stall-design-2026-07-30.md`。
**硬红线（AGENTS）**：高频 setState 禁挂根 hook 链；流式正文禁恢复逐 delta dispatch 进 reducer。

---

## 7.1 历史呈现展开（Presentation Expansion）与锚点

> **注意**：产品/用户口语里的「渲染展开」常指截图里的 **「详情已延迟 / 渲染详情」**，那是 **§7.2**。
> 本节专指 **History Presentation Expansion**：从「只渲染一部分 ConversationItem」切到「全量 history」，`presentationMode` 含 `expanded-history`。
> 也不等于单卡 fileEdit/explore 的 **行内展开**（§7.1.5）。

### 7.1.1 是什么

幕布并不是永远把 `items[]` 全挂 DOM。有两层「可见集」：

| 层 | 何时 | 默认阈值 | 效果 |
|----|------|----------|------|
| **闲时数量窗** | `!isThinking` | `VISIBLE_MESSAGE_WINDOW = **10000**` | 只在 item 数 >10000 时才切掉前缀；**现网几乎等价关闭数量折叠** |
| **流式尾窗** | `isThinking` | `STREAMING_VISIBLE_WINDOW = **60**`（working set ≈ `*2`） | 流式只渲近端；更早历史折叠进「显示更早」计数 |

状态机核心（`messagesLiveWindow.resolveMessagesPresentationMode`）：

| `presentationMode` | 含义（大白话） |
|--------------------|----------------|
| `realtime-collapsed-tail` | 流式中，历史被折叠，只画尾巴 |
| `realtime-full-tail` | 流式中，没折叠（条目不够长） |
| `realtime-expanded-history-manual` | 流式中，用户**手动**展开全历史 |
| `realtime-expanded-history-jump` | 流式中，为**跳旧消息**强制展开 |
| `static-collapsed-history` | 闲时，前缀被数量窗裁掉 |
| `static-full-history` | 闲时，全量（或不够裁） |
| `static-expanded-history-manual` | 闲时，手动展开后 |
| `static-expanded-history-jump` | 闲时，跳锚强制展开后 |

`showAllHistoryItems=true` 时，无论 realtime/static，mode 都会落到 `*-expanded-history-{manual|jump}`。

**presentationScopeKey**（`buildMessagesPresentationScopeKey`）把
`scopeKey + mode + collapsedCount + itemCount + firstId + lastId` 拼成字符串。
scope 一变 = 可见集换了一套；deferred presentation / virtualizer / 诊断都会按新 scope 处理。

### 7.1.2 为什么要这样

| 动机 | 说明 |
|------|------|
| **流式成本** | 全历史每帧协调 Markdown/工具卡 ≈ O(全长)；尾窗压到 O(近端)（`messagesRenderUtils` 注释） |
| **跟底稳定** | 流式跟底只关心尾部；中间历史不挂 DOM，少 layout thrash |
| **按需看旧文** | 需要旧上下文时再展开，而不是永远全量 |
| **与虚拟化分工** | 流式 **故意** 不开 `TIMELINE_VIRTUALIZATION_DURING_STREAMING`；展开后若闲时达标，再走 idle 虚拟化 |

A2 把 `VISIBLE_MESSAGE_WINDOW` 提到 10000，是**有意**弱化闲时「数量折叠」，避免和虚拟化/贴底抢策略（见 `Messages.virtualized-jump.test.tsx` skip 注释）。
**结果**：现网「显示更早」更多出现在 **流式尾窗** 场景，而不是闲时 30 条就折叠。

### 7.1.3 怎么触发

```text
                    ┌─────────────────────────────────────┐
                    │  visibleCollapsedHistoryItemCount>0   │
                    │  → 顶部 .messages-collapsed-indicator  │
                    └──────────────┬──────────────────────┘
                                   │ 用户点击
                                   ▼
                         revealAllHistoryItems("manual")
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
        ▼                          ▼                          ▼
 showAllHistoryItems=true   historyExpansionMode=manual   pending expansion
        │                          │                          │
        └──────────► presentationMode = *-expanded-history-manual
                     layoutEffect: scrollTop=0, autoScroll=false
```

| 触发 | 入口 | expansionMode | 展开后滚动意图 |
|------|------|---------------|----------------|
| **手动「显示更早」** | 点 `.messages-collapsed-indicator` → `handleShowAllHistoryItems` → `revealAllHistoryItems("manual")` | `manual` | **强制 `scrollTop=0`**（回到揭示后的历史头）；关 autoScroll |
| **跳旧锚点** | 侧栏 `MessagesAnchorRail` / `ccgui:jump-to-message` → `requestScrollToAnchor` | 若目标 DOM 不在（被裁掉）→ `revealAllHistoryItems("jump")` + `pendingJumpMessageId` | **不**先滚顶；等目标挂载后 `scrollTo` 平滑对准（视口约 28% 处） |
| **切会话 / firstItemId 变** | `useMessagesHistoryWindow` effect | 清空 expand 态 | 回到折叠策略（若仍适用） |
| **回合结束 settle** | 不是「history expand」 | — | live 尾窗回刷全量 + **settle-repin** 钉底（另一条高度暴涨路径） |

关键代码：

| 职责 | 路径 |
|------|------|
| 模式枚举 / 尾窗 | `orchestration/presentation/messagesLiveWindow.ts` |
| expand state | `orchestration/hooks/useMessagesHistoryWindow.ts` |
| 跳锚 + 先 expand | `orchestration/hooks/useMessagesAnchorNavigation.ts` |
| 手动 expand 后滚顶 | `MessagesCore.tsx` `useLayoutEffect(showAllHistoryItems)` |
| 指示器 UI | `MessagesTimeline.tsx` `.messages-collapsed-indicator` |
| 阈值常量 | `utils/messagesRenderUtils.ts` `VISIBLE_MESSAGE_WINDOW` / `STREAMING_VISIBLE_WINDOW` |

### 7.1.4 触发之后：锚点 / 滚动影响（重点）

展开 = **DOM 集合与 scrollHeight 阶跃变化**。影响面：

```text
showAllHistoryItems ↑
  → renderedItems 前缀突然接上
  → scrollHeight 暴涨（顶部插入大量像素）
  → messageNodeById 补齐旧 id
  → presentationScopeKey 变
  → activeAnchor 需 recompute
  →（若 jump）pendingJump 等节点 ready 再 scrollTo
  →（若 manual）scrollTop 置 0，用户离开底部
  → autoScroll 通常关闭 → 流式时若仍在生成，不再强制贴底
```

| 锚点/滚动对象 | expand 后行为 | 风险 / 症状 |
|---------------|---------------|-------------|
| **底部 follow（autoScroll）** | manual expand **关** autoScroll；jump 路径 `autoScroll=false` 后再滚到目标 | 流式中点「显示更早」后，新 delta **不再自动贴底**，直到用户再滚回底部附近 |
| **bottomAnchor 行** | 仍在 projection 末尾；manual 滚到顶后离开它 | 看起来像「展开后掉出最新消息」——预期，不是丢消息 |
| **用户消息侧锚 `MessagesAnchorRail`** | 只索引 user 锚；目标被裁时先 expand 再 jump | 旧锚点 expand 前 `querySelector` 为空；必须等 DOM；若 remeasure 慢会「点了半晌才跳」 |
| **pendingJumpMessageId** | jump expand 专用；`useMessagesTimelineVirtualizer` / layout 信号里 target ready 再滚 | 展开 + 虚拟化同时变时，size cache 空 → 第一次 scrollTop 算偏，依赖二次收敛 |
| **activeAnchorId** | expand 后 `scheduleAnchorUpdate("sync")` | 视口从尾部切到头部时，active 侧锚会从「最新用户句」切到「视口内旧句」 |
| **presentationScopeKey** | mode/count/首尾 id 变 → deferred presentation 可能丢旧 snapshot | 流式 readable-window recovery 依赖 scope 一致；跨 scope 不复用 deferred 列表 |
| **virtualizer remeasure** | 闲时展开后若过 idle 门槛，virtualizer attach + remeasure 预算 | remeasure 超预算被 suppress → 空白洞/重叠；见 hydration remeasure cooldown |
| **settle-repin（另一路径）** | 回合结束尾窗回全量，**不是** `showAllHistoryItems` | 同样 scrollHeight 暴涨，但意图是 **钉底**（2.4s 预算），与 manual expand「滚顶」相反 |

**对照记忆**：

| 高度暴涨原因 | 用户意图 | 滚动策略 |
|--------------|----------|----------|
| 渲染展开 manual | 看更早历史 | **顶**（scrollTop=0） |
| 渲染展开 jump | 落到某条旧消息 | **目标锚**（smooth） |
| settle-repin / 尾窗结束 | 继续看最新 | **底**（stick window） |
| 行内展开（fileEdit…） | 看详情 | **尽量保 scrollTop**（无统一 pin；局部增高可能「顶上去」） |

### 7.1.5 行内展开（易混淆，单独说）

这些 **不改** `presentationMode`，但会改行高 → 影响视口内锚点相对位置：

| 行内展开 | 默认 | 锚点注意 |
|----------|------|----------|
| fileEdit / `EditToolGroupBlock` | **默认折叠**；展开才懒算 diff | streaming 时组 identity 只用 firstId，防 remount 丢展开态 |
| explore 卡 | thinking 时可能 auto-expand，结束后收 | 与 live auto-expand id 联动 |
| 用户长文 / 注解 / NoteCard 摘要 | 交互展开 | 局部增高；侧锚仍绑 message id |
| 代码块注解 | 交互展开 | 同上 |

排障时先分清：**是顶部「显示更早」类展开，还是某一张卡自己展开**。

### 7.1.6 现网体感（2026-08-01）

| 场景 | 会不会看到「渲染展开」 |
|------|------------------------|
| 闲时对话 <10000 items | **基本不会**（数量窗极宽） |
| 流式长对话 | **会**：指示器显示 omitted 计数；点开 = realtime-expanded-history-manual |
| 侧栏点很旧的用户句（目标不在尾窗） | **会**：jump expand，再滚到锚 |
| 回合结束 | 不是 history expand；是尾窗回刷 + settle-repin |

回归用例入口：`Messages.live-behavior.test.tsx`（expand before jump / reveal resets to head / reveal during streaming）、`messagesLiveWindow.test.ts`（mode 解析）、`Messages.virtualized-jump.test.tsx`（A2 折叠策略 skip 注释）。

---

## 7.2 重型行「详情已延迟 / 渲染详情」— 对话/行级 **已下线**；块级 **保留**

> **产品决策（2026-08-01 / unify-conversation-canvas）**
> - **砍掉**：对话级轻量模式 UI、行级「详情已延迟 … 渲染权重」摘要条、「渲染详情」主路径
> - **保留**：块级「重型 Markdown 详情已延迟 / 工具详情已延迟 + **显示详情**」
> - 性能靠尾窗 + 闲时虚拟化 + live-text + 块级延迟
>
> **历史截图（已移除主路径）**
> - ~~灰条：详情已延迟 · readGroup/助手消息 + 渲染详情~~
> - ~~顶部：检测到重型对话 / 启用轻量模式~~
> - **仍可能见到**：块级 `重型 Markdown 详情已延迟 · 表格 · N 行` + **显示详情**

### 7.2.1 是什么（三层，别混）

| 层 | 用户看到什么 | 代码态 | 现状 |
|----|--------------|--------|------|
| **A. 对话级轻量模式** | 顶部轻量条 | `resolveConversationLightweightModeState` | **恒 inactive**；Prompt 不展示 |
| **B. 行级 hydration 摘要** | 灰条 + 渲染详情 | `shouldRenderLightweightProjectionRow` | **恒 false**；不再 `mode=summary` 驱动 UI |
| **C. 块级 Markdown/工具延迟** | 「重型 Markdown… / 工具详情已延迟」+ **显示详情** | 行内 heavy island | **保留** |

**不是**：§7.1 历史「显示更早」、也不是 fileEdit 默认折叠。

### 7.2.2 为什么会这样（动机 + 代码层残留）

| 动机 | 机制 |
|------|------|
| 长对话 / 大 Markdown / 大 tool 输出 | 全量 hydrated DOM 会卡滚动与输入 |
| 用 **renderWeight** 估成本 | `estimateTimelineProjectionRenderWeight`；`≥16` = heavy |
| **现网性能主路径** | 流式尾窗 + 闲时虚拟化 + live-text + **块级**「显示详情」 |
| **已下线的 UI 层** | 对话轻量 mode 恒 inactive；`shouldRenderLightweightProjectionRow` **恒 false**（`bf3b35bd6`） |

阈值常量仍导出（诊断/历史测试引用；**不再驱动对话级摘要墙**）：

| 常量 | 值 | 现网作用 |
|------|-----|----------|
| `TIMELINE_VIRTUALIZATION_HEAVY_ROW_WEIGHT` | **16** | heavy 估算；虚拟化 weight 门槛 |
| `CONVERSATION_LIGHTWEIGHT_SUGGEST_*` / `OVERSIZED_*` | 180/4/520/260 | **policy 恒不建议**；保留数值供测试与回潮审计 |
| `TIMELINE_ADAPTIVE_RENDERING_ENABLED` | true | 闲时虚拟化总闸（**不是**摘要墙总闸） |

**历史路径（改前，可追溯）**：`deriveTimelineRowHydrationStates` 曾对屏外 heavy 给 `mode=summary`，再叠加对话 lightweight 把行画成灰条「详情已延迟 / 渲染详情」。
**现网**：行级摘要条 UI 永久关闭；块级 i18n 仍可能出现：

| key | 中文 | 现网 |
|-----|------|------|
| `conversationLightweightRow*` / `HydrateVisible` | 详情已延迟 / 渲染详情 | **UI 主路径不渲染**（旧构建除外） |
| `markdownHeavyBlockDeferred` / `Show` | 重型 Markdown… / **显示详情** | **保留** |
| `toolHeavyDetailDeferred` / `Show` | 工具详情已延迟 / **显示详情** | **保留** |

### 7.2.3 怎么触发（现网 vs 历史）

**现网用户路径**

| 触发 | 结果 |
|------|------|
| 大 Markdown 表 / 重 tool output | 块内「显示详情」 |
| 流式长输出 | 尾窗 + live-text；**无**行级灰条 |
| 闲时长历史 | 虚拟化（≥约 48 行等） |
| Fork/回溯/复制 | 仍读原始 items |

**历史用户路径（已下线，勿当现网）**

```text
oversized / 手动轻量 → 灰条「详情已延迟」→ 点「渲染详情」→ detailHydrationRequested
```

主入口：

| 职责 | 路径 | 现网备注 |
|------|------|----------|
| weight / 虚拟化 | `messagesTimelineVirtualization.ts` | 活跃 |
| 行 hydration 状态机 | `messagesTimelineHydration.ts` | 状态可算；**摘要条不画** |
| hydration hook | `useMessagesTimelineHydration.ts` | `shouldRenderLightweightProjectionRow` ≡ false |
| 对话轻量策略 | `messagesConversationLightweightMode.ts` | 恒 inactive |
| 摘要条 / 顶部轻量 UI | `TimelineRowRenderer` · `ConversationLightweightPrompt` | Prompt 短路；行级不渲 |
| 块级 MD/工具延迟 | heavy islands / GenericToolBlock 等 | **保留** |

### 7.2.4 对锚点 / 滚动的影响

| 现象 | 现网相关性 |
|------|------------|
| 点行级「渲染详情」后视口跳 | **主路径已无**；若仍见 → 旧构建 |
| 块级「显示详情」后行高变 | **仍有**；局部增高，可能顶视口 |
| 历史 expand + settle + 虚拟化 | 见 §7.1 / **§7.3** scroll authority |
| remeasure 超预算 | 虚拟化/媒体加载路径仍在 |

### 7.2.5 与 §7.1 / 行内展开对照

| | §7.1 历史展开 | §7.2 行级详情延迟（**已下线**） | 块级显示详情 | 行内折叠 |
|--|---------------|----------------------------------|--------------|----------|
| UI | 「显示更早」 | ~~详情已延迟 / 渲染详情~~ | **显示详情** | fileEdit 折叠 |
| 数据 | items 窗口 | items 在，呈现换 summary | 同 item 岛 | 同 item body |
| 现网 | 活跃 | **不渲染** | 活跃 | 活跃 |

### 7.2.6 产品决策落地状态

> **已拍板并入库（`bf3b35bd6` / unify Phase A）**：对话级 + 行级摘要墙 **下线**；块级「显示详情」**保留**。
> 下列保留为**历史优化清单**（摘要墙回潮前的设计债；块级/虚拟化仍可部分适用）：

| 优先级 | 优化点 | 备注（2026-08-01 校准） |
|--------|--------|-------------------------|
| ~~P0 灰条可解释性~~ | 行级 UI 已下线 | 关闭 |
| ~~P0 行级 hydrate 粒度~~ | 同上 | 关闭 |
| P1 块级与 weight 校准 | 块级仍在 | 可跟进 |
| P1 虚拟化 remeasure / 锚点 | 与 §7.3 交叉 | scroll change |
| P2 死代码清理 | lightweight i18n / 恒 false 钩子 | 可选 |

**非目标**

- 不要用「永远全量 hydrated」换性能倒退。
- 不要把 Status Panel 痕迹塞回幕布「为了对称」。
- 不要把 fileEdit 折叠与块级延迟混成一套 state。

---

## 7.3 滚动所有权（Scroll Authority）— 现网入口

> **演进**
> - 长期路径级止血（echo / settle 2.4s / nearBottom 120px）仍难消 **A 飞顶** 与 **F 结束离真底**。
> - DESIGN：`docs/plans/2026-08-01-conversation-canvas-scroll-ownership-architecture.md`
> - **已入库**：`b34fdaead` — 纯状态机 + write ticket；`useMessagesScrollController` 接入。
> - OpenSpec：`refactor-conversation-canvas-scroll-ownership`（实现验证/手测以 change 为准）。

### 7.3.1 一句话

**单一 Owner 授权写 `scrollTop`；高度生命周期发几何事件，不直接抢滚动权。**
真底：`distanceToBottom <= TRUE_BOTTOM_EPSILON_PX`（1px），**禁止**用 120px nearBottom 当结束完成态。

### 7.3.2 代码入口

| 职责 | 路径 |
|------|------|
| 纯状态机（无 DOM） | `orchestration/scrolling/scrollAuthorityMachine.ts` |
| Mode / Intent / Ticket 类型 | `scrollAuthorityTypes.ts` · `scrollWriteTicket.ts` |
| 常数（真底 / rearm / 用户上滚累计） | `scrollAuthorityConstants.ts` |
| DOM 控制器接入 | `hooks/useMessagesScrollController.ts` · `ScrollControl.tsx` |
| 边沿收敛辅助 | `messagesScrollConvergence.ts` · `messagesScrollEcho.ts` |
| settle 时间窗（仍存在） | `SETTLE_REPIN_WINDOW_MS`（`messagesConstants.ts`）— 与几何稳态并存，勿当唯一真理 |

### 7.3.3 与 §7.1 / settle 的关系

| 场景 | 意图 | Owner 侧 |
|------|------|----------|
| 发送见最新 | stick / forced-bottom | turn-send Intent |
| 流式 follow | stick-bottom | 连续 pin |
| 用户明确上滚 | free | 释放 stick |
| 显示更早 manual | history-head | scrollTop=0 |
| 跳旧锚 | jump-anchor | 目标 DOM ready 后滚 |
| 回合结束 | forced/stick 直至几何稳或安全超时 | 消 F |

排障：先确认探针在 **Messages 容器**（勿侧栏文件树 scroller），再查 ticket reason / mode 转移测试。

---

## 8. 功能面清单（修复对照表）

| 功能面 | 默认行为 | 主入口 | 备注 |
|--------|----------|--------|------|
| 文件修改场景 | 成组 + **默认折叠**；同 path 留最后一次 | `groupToolItems` · `EditToolGroupBlock` · `fileEditSceneUtils` | 展开才懒解析 diff |
| **对话/行级详情已延迟** | **已下线** | §7.2 · lightweight 恒 inactive · 摘要条不渲染 | — |
| **重型 Markdown / 工具块延迟** | 行内 table/output 延迟 + **显示详情**（**保留**） | `markdownHeavyBlock*` · `toolHeavyDetail*` | 块级 |
| bash / command 卡 | **五引擎**藏（claude/codex/grok/kimi/opencode）；gemini 未强制 | `shouldHideCodexCanvasCommandCard` | ExitPlan 例外不藏 |
| read / search 组 | ≥2 连续成组 | `ReadToolGroupBlock` / `SearchToolGroupBlock` | MCP `search_query` 不组 |
| TodoWrite | 渲染前剔除 | `shouldHideToolItemForRender` | 不当工具卡 |
| 思考 / reasoning | Claude 默认可见；dock 死 | `ReasoningRow` · thinking section | 别启用 dock 当产品能力 |
| staged MD | claude+codex | `messagesStreamingComplexity` | profile 关也生效 |
| live-text | 默认开 | `liveAssistantTextChannel` · MessageRow | flag 回退测卡顿 |
| 终轮 footer | 时间/耗时/token | `buildAssistantFinalBoundaryMetaText` · TimelineRowRenderer | `isFinal` 助手行 |
| 回合改文件摘要 | 与 final boundary 联动 | `TurnFilesChangedCard` · `turnFileChanges` | 末轮闲时走累计卡 |
| Fork | 最新终轮助手 | `MessageForkConfirmDialog` | codex 可带 provider |
| 侧锚 | 只预览 user | `MessagesAnchorRail` | 躲流式打穿 |
| 大纲 | 关 | `SHOW_OUTLINE_FLOATER` | 产品关 |
| Shared 发送条 | 仅 Shared | `SharedSendStatusBar` | 非时间线行 |
| 协作 badge | 仅 codex | presentation / MessageRow | Shared 目标=codex 时 |

---

## 9. 症状 → 文件入口（排障）

| 症状 | 先看 |
|------|------|
| 命令跑了幕布没卡 | **先分引擎**：五引擎 bash/command **常藏** → 去 Status Panel；读/写应在幕布。Grok 若仍无读/写卡 → 查 jsonl 桥/path/resume baseline（§5.1），勿用「详情已延迟」解释 |
| Grok 实时写文件幕布空白、Diff 有 +N/-N | **改前**为 stdout 无 tool 的预期缺口；**改后**应有桥接卡（可滞后）。仍空：查 `GrokToolHistoryTailState` / history 路径 / 旧构建 |
| 文件修改一堆碎卡 / 不折叠 | `groupToolItems` fileEdit 桶；`EditToolGroupBlock` `defaultCollapsed` |
| 展开改文件后 streaming 又收起 | `getGroupedEntryProjectionKey` editGroup 只用 firstId |
| 流式越聊越卡 | 尾窗 / live-text flag / staged MD 是否被关掉；是否误开 streaming 虚拟化 |
| 流式结束跳顶 / 不跟底 | **§7.3** `scrollAuthorityMachine` · `useMessagesScrollController` · settle-repin · echo |
| **点「显示更早」后飞到顶部 / 不再贴底** | **预期**（历史展开）：manual → `scrollTop=0` + 关 autoScroll；§7.1.4 |
| **侧锚点旧消息半晌才跳 / 先空白** | 目标在折叠前缀外 → jump expand 等 DOM；§7.1 |
| **流式中上滚、回合结束又贴底** | **预期契约**（settle re-pin）：`beginTurnBoundaryBottomConvergence("turn-settle")` 清 user intent 并贴最新；见 live-behavior 测试 |
| **幕布灰条「详情已延迟 · 渲染权重」** | **应已消失**（对话/行级下线）；若仍见 → 查是否旧构建 |
| **块级「显示详情」仍在** | **预期保留**（Markdown 表/工具重输出） |
| **回合结束贴底偏了 / 空白** | settle-repin 与 scrollHeight 阶跃；`useMessagesScrollController` + echo |
| **流式中展开全历史后卡顿** | 尾窗失效，presentation 全量；§7.1 |
| 虚拟列表贴错行 / 重叠 | idle 门槛；`TIMELINE_VIRTUALIZATION_DURING_STREAMING_ENABLED` 是否被改 true |
| Shared 历史缺轮次 / 双份 | projection 开关；`sharedHistoryLoader` merge；dataSource 是否丢 kind |
| Shared 侧栏多出 binding | Hidden Binding 过滤：`sharedSessionSummaries` |
| 心跳导致整树重渲 | `conversationCanvasNode` 是否又选进 `heartbeatPulse` |
| 助手 footer 无时间/token | `finalDurationMs` 等字段是否写回 item；`buildAssistantFinalBoundaryMetaText` |
| Gemini 进不了 Shared | 产品白名单，不是 bug：`sharedSessionEngines` |
| reasoning 想 dock 却没有 | dock 死路径；勿当回归失败 |

---

## 10. 统一幕布工作包（后续立项用）

### 10.1 目标边界

| 要统一 | 不统一 / 不做 |
|--------|----------------|
| 同一 Messages 渲染核 + 同一 projection/row | 不为每个 CLI 再拆一套 Messages 树 |
| L1 loader/realtime 契约与 item kinds | 不把 Status Panel 硬塞回幕布「为了对称」 |
| L2 硬分支 → 可测策略表（或明确 profile 默认开） | 未校准前大开 presentationProfile |
| Shared 仍是「同幕布 + 目标引擎」，不是第七套 UI | 不把 Hidden Binding 投影成可见会话 |

### 10.2 能力矩阵模板（统一/修复 PR 必填）

对每个 PR，按引擎勾选「行为是否变化」：

| 能力 | Claude | Codex | Gemini | Grok | Kimi | OpenCode | Shared(目标=?) |
|------|--------|-------|--------|------|------|----------|----------------|
| bash 可见性 | | | | | | | |
| fileEdit 折叠 | | | | | | | |
| **详情延迟 / 渲染详情** | | | | | | | |
| staged MD | | | | | | | |
| live-text | | | | | | | |
| **live tool 投影** | | | | Grok 桥 | | | |
| 虚拟化 idle/stream | | | | | | | |
| fork / footer | | | | | | | |
| history 入口 | | | | | | | |
| realtime 模式 | | | | | | | |

### 10.3 建议优先级（2026-08-01 校准）

| # | 项 | 状态 |
|---|----|------|
| 1 | 对话/行级轻量下线 + 块级保留 | **已落地** `bf3b35bd6` |
| 2 | Grok/Kimi/OpenCode live tool + 藏 bash | **已落地**；手测/残差见 matrix |
| 3 | 滚动所有权状态机 | **代码已落地** `b34fdaead`；实机 A/F 验收跟 scroll change |
| 4 | presentationProfile go/no-go；dock 死路径 | 未决 |
| 5 | 性能护栏：尾窗 + 虚拟化 + 块级显示详情 | 持续 |
| 6 | Shared 信任与多 CLI 策略表 | 持续 |

**最小启动包（历史）**：轻量下线 + settle + §5.1 矩阵 — 已完成主实现；后续以手测与 scroll 验收为主。

### 10.4 高风险文件（合并勿整文件 ours/theirs）

- `MessagesCore.tsx` / `MessagesTimeline.tsx` / `TimelineRowRenderer.tsx`
- `messagesTimelineProjection.ts` / `groupToolItems.ts` / `messagesTimelineVirtualization.ts`
- **`messagesTimelineHydration.ts` / `useMessagesTimelineHydration.ts` / `messagesConversationLightweightMode.ts`**（§7.2 重做核心）
- `conversationCanvasNode.tsx` / `activeCanvasStore.ts`
- `sharedHistoryLoader.ts` / `sharedProjection/dataSource.ts`

---

## 11. 源码索引（改代码入口）

| 主题 | 路径 |
|------|------|
| 门面 / 编排 / 时间线 | `messages/components/Messages.tsx` · `MessagesCore.tsx` · `MessagesTimeline.tsx` |
| 行分发 / 投影 / 虚拟化 | `timeline/components/TimelineRowRenderer.tsx` · `projection/…` · `virtualization/messagesTimelineVirtualization.ts` |
| 消息行 / staged MD | `rows/components/MessageRow.tsx` · `rows/presentation/messagesStreamingComplexity.ts` |
| 工具 / 文件修改场景 | `toolBlocks/ToolBlockRenderer.tsx` · `EditToolGroupBlock.tsx` · `fileEditSceneUtils.ts` · `groupToolItems.ts` |
| final boundary meta | `messagesRenderUtils.ts` `buildAssistantFinalBoundaryMetaText` · TimelineRowRenderer footer |
| 轻量模式 | `presentation/messagesConversationLightweightMode.ts` |
| 滚动权威 / echo / settle | `orchestration/scrolling/scrollAuthorityMachine.ts` · `scrollAuthorityConstants.ts` · `messagesScrollEcho.ts` · `hooks/useMessagesScrollController.ts` · `constants/messagesConstants.ts` |
| **Grok live tool 桥** | `engine/grok.rs`（stdout 无 tool）+ `engine/grok_history.rs`（`GrokToolHistoryTailState` 增量 tail）· Diff=工作区 git |
| 历史呈现展开 / presentationMode | `orchestration/presentation/messagesLiveWindow.ts` · `hooks/useMessagesHistoryWindow.ts` · `hooks/useMessagesAnchorNavigation.ts` · `MessagesCore` expand layoutEffect · collapsed-indicator |
| **详情延迟（行级已下线 / 块级保留）** | lightweight 恒 inactive · `shouldRenderLightweightProjectionRow`≡false · 块级 `markdownHeavyBlock*` / `toolHeavyDetail*` · weight 见 virtualization |
| Live 控件 / live-text | `live-canvas/liveCanvasControls.ts` · `threads/utils/liveAssistantTextChannel.ts` · `realtimePerfFlags.ts` |
| Canvas 挂载 / 高频 store | `layout/hooks/conversationCanvasNode.tsx` · `activeCanvasStore.ts` · `useLayoutNodes.tsx` |
| Settings / Claude thinking | `settings/hooks/useAppSettings.ts` · `app-shell-parts/useAppShellClaudeThinkingSection.ts` |
| Loader / Shared / 引擎集 | `threads/hooks/useThreadActions.historyLoaderFactory.ts` · `loaders/*HistoryLoader.ts` · `shared-session/utils/sharedSessionEngines.ts` |
| 投影数据源 / Realtime 注册 | `messages/presentation/sharedProjection/dataSource.ts` · `threads/adapters/realtimeAdapterRegistry.ts` |
| Profile / 契约 | `conversation-presentation/presentationProfile.ts` · `threads/contracts/conversationCurtainContracts.ts` |

旧 Claude/Codex 专文（`markdown-doc1/2`）行号与开关默认值已过期，以本文 + 契约源码为准。

---

## 12. 张力与 Review

### 12.1 张力（不是 bug 列表）

| 张力 | 大白话 |
|------|--------|
| 策略分散 | 硬编码 if、profile、migration gate、localStorage 多处管同一类行为 |
| 藏工具 vs 找工具 | Claude/Codex 幕布干净，用户可能以为「命令丢了」——其实在 Status Panel |
| Profile 休眠 | 代码还在养，默认关，用户无感 |
| dock 死路径 | 投影/渲染还在，条件到不了 |
| 引擎观感分裂 | claude/codex/kimi/opencode/grok 过程策略向 Claude 收敛；**gemini** 仍未强制藏 bash；Grok 信号源为桥 |
| Shared 信任 | 切引擎后要能看懂「哪轮谁跑的」 |

### 12.2 Review 清单

- [ ] 认同「一核 + L1/L2 为主 + L3 默认休眠」？
- [ ] bash 藏幕布、活动在 Status Panel，仍是产品预期？
- [ ] Gemini 排除 Shared：产品决策还是债？
- [ ] profile / dock 死路径：养着还是砍？
- [ ] 文件修改默认折叠、idle@48 虚拟化、finalMeta footer，文档与体感是否一致？
- [x] **对话/行级轻量下线、块级显示详情保留**（`bf3b35bd6`）
- [x] **Grok jsonl 桥 + 多引擎藏 bash**（同上）
- [x] **滚动所有权状态机入库**（`b34fdaead`；实机 A/F 仍可跟）
- [ ] settle / forced-bottom 与「上滚读历史」产品预期是否仍接受？
- [ ] presentationProfile / dock 死路径：养还是砍？

---

## 13. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-07-31 | 初版：多 CLI + Shared 幕布结构与默认运行态 |
| 2026-08-01 | 对照源码多角度重写：final boundary / settle-repin / editGroup / 功能面 / 症状 / 工作包 |
| 2026-08-01 | 增补 **§7.1 历史呈现展开** |
| 2026-08-01 | 增补 **§7.2 详情已延迟**（当时仍为现网问题 + 重做清单） |
| 2026-08-01 | 增补 **§5.1 Grok 实时无 live tool**（当时缺口诊断） |
| 2026-08-01 | 挂接统一幕布 PLAN；Phase A–E 实施（轻量下线、Grok 桥、藏 bash） |
| 2026-08-01 | Phase E + Review + matrix 落盘 |
| 2026-08-01 | **二次校准（不丢过程）**：文头对齐 `0.7.14` 与 commit 锚点；§5.1 改为「缺口→桥」演进；§7.2 拆现网/历史触发；新增 **§7.3 scroll authority**；§8–§11/§10 优先级与症状表同步；矛盾「Grok 永远无 tool」清除 |

---

*结构与默认运行态说明。perf 以 `docs/perf/**` 为准。供应商 L1/L2 见 `native-session-provider-select-vs-disk-overwrite-2026-07-31.md`。索引见 [`README.md`](./README.md)。*
