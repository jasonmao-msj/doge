# 幕布对话流式渲染卡顿（stall-then-flush）设计文档

> 日期：2026-07-30
> 内容类型：Troubleshooting + implementation design
> 生命周期：implemented；OpenSpec tasks `17/17`，change 仍 active，待 verify / sync / archive
> 状态：核心修复已入库 `1537211a1`；idle timeline virtualization 后续由 `4e932e672` 恢复
> 最后校准：2026-08-01 · mossx `0.7.14` · HEAD `26f8065a0c`
> 范围：Native Session / Shared Session 幕布对话的流式输出渲染链路（Rust 后端 → Tauri IPC → 前端事件 → React 渲染）
> 关联文档：`docs/perf/parallel-conversation-jank-handbook.md`、`docs/perf/a4-live-text-externalization-plan.md`、`docs/perf/render-jank-knife-experiments-2026-07-08.md`
> OpenSpec：`openspec/changes/fix-streaming-render-stall-then-flush/`

---

## 0. 2026-08-01 当前代码校准

本文 §1–§3 保留 2026-07-30 的诊断过程；以下是已落地后的现网合同。

| 原问题 | 当前实现 | 证据 |
|--------|----------|------|
| per-delta notify | accumulated / published 分离；首段立即，后续每 thread **48ms throttle + trailing publish** | `LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS` |
| `useDeferredValue` starvation | channel-backed row 直接消费 published text；仅非 channel 路径保留 deferred 策略 | `MessageRow.tsx` |
| Markdown 双重 transition | bounded timer 仍保留；scheduled commit 已移除 `startTransition` | `useMarkdownStreamingValue.ts` |
| terminal overtaking content | backend sink + frontend backpressure 都有 settlement causal barrier | `1537211a1` 与 change tests |
| timeline virtualization | **idle 开启**，阈值 48 rows；**streaming 关闭**，继续使用尾窗 + static rows | `messagesTimelineVirtualization.ts`、`4e932e672` |

因此，旧 S0–S3 是已修复根因，不是当前待办；当前若再出现 stall，应先按 phase evidence 判断 source → publish → render → paint 卡在哪层，再决定是否复用本文机制。

## 1. 背景与现象

幕布对话（chat canvas）流式输出偶发**卡顿**：token 持续到达，但屏幕长时间不更新；流结束后**一次性完整输出全部内容**（stall-then-flush）。Windows 上明显多于 macOS。

涉及两条会话模式：

- **Native Session**：Claude/Gemini/OpenCode CLI 子进程 stdout → `BufReader::lines()` → 逐事件 `app.emit`（不走批量 sink）。
- **Shared Session / App-server 模式**：Codex app-server 等 → shared coordinator（可能 defer）→ `SnapshotThrottle`(32ms) → `BatchedTauriEventSink`(40ms flush)。

---

## 2. 诊断结论

### 2.1 核心结论

2026-07-30 的证据确认存在两个独立问题：

1. **render starvation 放大因素**：数据已到 frontend 时，per-delta channel notify、`useDeferredValue` 与 Markdown `startTransition` 叠加，使 background render 在持续输入下被反复重启。
2. **terminal ordering root cause**：Codex `BatchedTauriEventSink` 与 unified frontend `appServerEventBackpressure` 都允许 settlement terminal 越过已接受的正文；frontend 先结算 turn 后会拒绝 late delta / item completion。

MiniMax-M3 的 sparse / bursty output 让 final content 与 terminal 更容易落进同一竞态窗口，但 provider 只是放大器。结构性修复必须同时覆盖 store→React publish cadence 与 causal terminal ordering。JavaScript timer 只能提供 publish opportunity；主线程被同步长任务占用时，不能承诺 DOM 在固定时间内 commit。

### 2.2 延迟叠加链路图

```
[子进程 stdout]                     Windows: 管道 4KB 缓冲 + cmd /c 包装 → 数据"成团"到达
  ↓ BufReader::lines()
[后端 coalesce 32ms]                仅 Windows：src-tauri/src/engine/claude.rs:1695（mac = 0 直发）
  ↓
[SnapshotThrottle 32ms]             src-tauri/src/snapshot_throttle.rs:6
[BatchedSink 40ms flush]            Codex；settlement terminal 必须先 drain 同 workspace queue
  ↓ app.emit
[Tauri IPC]                         WebView2 JSON 反序列化大 payload 更贵
  ↓
[eventBackpressure]                 全 CLI 统一入口；terminal 必须先移交同 workspace predecessors
                                    rAF；isInputPending 时退 setTimeout(32ms)（仅 WebView2 走此分支）
  ↓
[live text channel]                accumulated 无损累计；published 48ms + trailing
  ↓
[MessageRow]                        channel-backed 行绕过重复 useDeferredValue
  ↓
[useMarkdownStreamingValue]         48–220ms bounded timer；无 startTransition
  ↓
[staged / full markdown]            row 内 Markdown 策略；idle ≥48 rows 可虚拟化，streaming 禁用虚拟化
```

### 2.3 嫌疑点排序（置信度）

| # | 嫌疑点 | 位置 | 置信度 |
|---|--------|------|--------|
| S0 | **terminal causal ordering defect（已确认）**：Rust / frontend 两层 critical bypass 让 settlement 越过正文，late content 被 terminal guard 丢弃 | `event_sink.rs`、`eventBackpressure.ts` | ★★★★★（代码与回归测试已确认） |
| S1 | **`useDeferredValue` 饥饿**：per-token notify 持续重启 deferred background render | `MessageRow.tsx` | 已修：channel-backed 行绕过 deferred |
| S2 | **双层 transition 叠加**：deferred 之下 Markdown 更新再包 `startTransition` | `useMarkdownStreamingValue.ts` | 已修：timer commit 不再 transition |
| S3 | live channel 入口无合流，每 token 一次行级同步渲染挤占主线程 | `liveAssistantTextChannel.ts` | 已修：48ms publish cadence |
| S4 | 滚动锚定与 static timeline layout 成本 | `MessagesCore.tsx`、virtualization contract | 另轨：idle virtualization 已恢复；scroll authority 已重构 |
| S5 | mitigation 是反应式的：stall 700ms 后才降级纯文本，且激活瞬间伴随一次大提交 | `streamLatencyDiagnostics.ts:100` | ★★★ |
| S6 | Windows 32ms coalesce + 40ms batch 攒出大 payload，WebView2 单次反序列化更贵 | `src-tauri/src/engine/claude.rs:1695`、`event_sink.rs:101` | ★★★（平台放大器） |

### 2.4 完整度评估（架构已做对的）

- `liveTextExternalization` 默认开启：delta 不打根 reducer，订阅粒度到单行 `useSyncExternalStore`。
- claude/codex 走 staged 增量 Markdown（Issue #721 修过 full re-parse 6FPS 问题）；它与 conversation lightweight mode 是两个独立概念。
- timeline adaptive rendering 当前已开启：idle ≥48 rows 可虚拟化；流式期 virtualizer 仍关闭，继续使用尾窗 + static projection。
- 有背压队列（128KB / 200 events per flush）、复杂度自适应节流（增量 delta 分析避免 O(n²)）。
- 有 stall 诊断与降级 mitigation 机制。

### 2.5 原结构性缺口与收口状态

1. **无提交下限**：已由 48ms trailing publish 收口；它保证 publish opportunity，不保证 DOM hard SLA。
2. **优先级倒挂**：channel-backed row 已绕过重复 deferred；非 channel 路径仍按原策略。
3. **降级滞后**：700ms stall 阈值意味着用户必然先看到卡顿才被救；mitigation 切换瞬间有一次全量大提交。
4. **平台成本仍需重新测量**：WebView2 单行 Markdown / IPC 成本可能更高；idle virtualization 已恢复，streaming virtualization 仍不作为调参式修复。
5. **结束瞬间 DOM 暴涨**：流式期尾窗 60 条 → idle 全量 10000（`messagesRenderUtils.ts:32`），结尾那一下卡顿是设计出来的。
6. **critical 与 settlement 混类**：已拆为 interactive urgent bypass 与 settlement causal barrier。

### 2.6 Windows 更差的机制（按影响排序）

1. **GPU 回退陷阱**：`src-tauri/src/startup_guard.rs:159-167` 连续 2 次启动未就绪会持久化注入 `--disable-gpu` → WebView2 软件渲染，长列表 + 每帧 scrollTop 写入全面变慢。**优先核查用户机器 `startup_guard.json`**。
2. **后台节流不对称**：macOS 显式 `BackgroundThrottlingPolicy::Disabled`（`src-tauri/src/lib.rs:325`），Windows 没有——窗口被遮挡时 WebView2 降低 rAF/timer 频率。
3. **32ms coalesce 仅 Windows**（`claude.rs:1695`）：事件更大更稀疏，与 WebView2 慢 IPC 叠加成"一顿一顿"。
4. **调度 API 分裂**：`isInputPending`/`requestIdleCallback` WebView2 有、WKWebView 无，同一份代码在 Windows 多走一层 `setTimeout(32)`。
5. **子进程成团到达**：Windows 管道（消息模式、4KB）+ `cmd /c` 包装（`app_server_cli.rs:864-883`）+ Node 非 TTY 缓冲，stdout 突发批量到达。

---

## 3. 业界实践调研

### 3.1 Vercel AI SDK：在 store 订阅层节流（最直接的对照）

`useChat` 的 `experimental_throttle`（AI SDK v5 更名为 `throttle`）：默认每个 chunk 触发一次 React 重渲染，官方明确这会在复杂组件（Markdown）或慢设备上压垮渲染，甚至造成 "Maximum update depth exceeded" 和流式中途停滞（HTTP 200 无报错，纯渲染背压）。

- **做法**：在 `useSyncExternalStore` 的订阅层做 throttle，消息状态按固定窗口批量通知 React，而不是每个 chunk 都 setState。
- **数值**：50ms（官方示例）；社区建议实时聊天 50–100ms、复杂 UI 500ms+。
- **关键启示**：**节流的正确位置是"store → React 的边界"，不是渲染层内部。** 我们的 live channel 每 token notify（S3）正是缺了这一层。
- 来源：[useChat API reference](https://ai-sdk.dev/v5/docs/reference/ai-sdk-ui/use-chat)、[Vercel troubleshooting: Maximum update depth exceeded](https://sdk.vercel.ai/docs/troubleshooting/react-maximum-update-depth-exceeded)、[AI SDK v5 streaming backpressure 分析（zenn.dev）](https://zenn.dev/coji/articles/vercel-ai-sdk-streaming-backpressure?locale=en)

### 3.2 React 官方：`useDeferredValue` 饥饿是确认行为，官方解法是"节流源头"

React 官方文档明确：

> "The background re-render is interruptible: if there's another update to the value, React will restart the background re-render from scratch. ... the chart will only re-render after the user stops typing."

即：**连续高频更新下 deferred value 永不提交，且没有 debounce 那样的"最终保证 flush"**。官方建议的缓解：

1. **节流更新源头**（throttle/debounce input），可与 `useDeferredValue` 组合使用；
2. memo 化 deferred 子树，让被打断的渲染足够便宜；
3. 保证 deferred value 引用稳定（每次新引用都会通过 `Object.is` 触发重启）。

这直接坐实 S1 的机理，并给出官方立场：**不要指望 React 自己兜底，必须在源头限频。**
来源：[react.dev — useDeferredValue](https://react.dev/reference/react/useDeferredValue)、[React 18 WG Discussion #129](https://github.com/reactwg/react-18/discussions/129)、[DeveloperWay — useTransition 实战分析](https://www.developerway.com/posts/use-transition)

### 3.3 Tauri 高频事件：IPC 是带宽墙，批量化/二进制化是共识

- **"It's physics, not a bug"**：WebView 应用的 IPC 带宽墙来自 JSON 序列化/反序列化，高频小事件必须聚合，否则前端主线程被解析长任务占满。（[mechanicalrock.io](https://www.mechanicalrock.io/blog/it-s-physics-not-a-bug-the-ipc-bandwidth-wall-in-webview-apps)）
- **tauri-wire**：二进制帧协议替代 JSON IPC，高频数据流 encode/decode 快 28–33x、体积小 44%——说明社区已在"序列化成本"这个点上达成共识。（[github.com/userFRM/tauri-wire](https://github.com/userFRM/tauri-wire)）
- **Tauri 2 Channel**：官方为流式场景提供的原语，比全局 event emit 更定向。（[v2.tauri.app — Calling the Frontend from Rust](https://v2.tauri.app/develop/calling-frontend/)、[IPC Improvements Discussion #5690](https://github.com/orgs/tauri-apps/discussions/5690)）
- 对我们：`BatchedTauriEventSink` 40ms 批量方向正确；但 Native 模式逐事件 `app.emit`（`event_sink.rs:385-391` 的 terminal output 同理）是漏网路径。

### 3.4 业界共识模式归纳

| 模式 | 内容 | 谁在用 |
|------|------|--------|
| **边界节流** | 在 store→UI 边界按 50–100ms 窗口批量通知，不在渲染内部节流 | Vercel AI SDK |
| **源头限频** | deferred/transition 之前先给更新源降频，让低优渲染有机会提交 | React 官方 |
| **上限+下限双约束** | throttle 保证不泛滥，max-staleness 保证不饿死 | debounce/trailing-flush 经典模式 |
| **事件聚合** | 高频 IPC 事件按时间窗/字节窗聚合，避免逐事件跨边界 | Tauri 社区、tauri-wire |
| **增量解析** | markdown 按 block 增量渲染，避免全量 re-parse | streamdown 类库、本仓库 lightweight renderer（已具备） |

---

## 4. 设计目标与原则

### 目标

1. 流式期间幕布文本获得 bounded publish opportunity；DOM commit latency 由 trace 测量，不预设无法由 JavaScript timer 保证的硬 SLA。
2. 不引入渲染风暴：主线程帧预算内完成（16ms/帧，重负载允许降级到 ~8 FPS 但不允许冻结）。
3. Windows 与 macOS 体验差距收敛到可感知阈值以下。
4. settlement terminal 不得越过同 workspace 已接受的正文；其他 workspace 与 interactive urgent event 不受牵连。

### 原则

- **发布节奏只设一道**：在 store→React 边界限频；每个 delta 仍无损进入 accumulated entry。
- **首段立即 + throttle trailing**：第一段立即发布，后续按 thread 约 48ms 发布 latest snapshot；不按 byte threshold 绕过频率上限。
- **scheduled commit 必须确定**：timer 已触发的 row / Markdown update 不再叠加可被连续输入重启的 transition。
- **critical 不等于可重排**：settlement terminal 是 causal barrier；approval / requestUserInput 是 urgent bypass。
- **改动最小化**：保留 live-text-externalization 与 staged Markdown；conversation lightweight mode 关闭；idle virtualization 可用，streaming virtualization 保持关闭。

---

## 5. 方案设计

### P0 — 给 live 文本建立单一发布节奏（治 S1/S2/S3）

**核心改动**：在 live assistant text channel 的 notify 边界做合流，替代"每 token 同步 notify"。

```
token delta → accumulated entry（逐 delta 无损）
  ├─ new item / first text → 立即更新 published snapshot 并 notify
  └─ same item growth → 每 thread 48ms throttle + 单个 trailing timer
                         timer 读取 latest accumulated entry 后 publish
```

- 位置：`src/features/threads/utils/liveAssistantTextChannel.ts`。`getSnapshot` 只读 published map，保证 `useSyncExternalStore` 在 notification 之间看到稳定引用。
- `drain` / `clear` 从 accumulated entry 收口正文并同步取消 timer；`rename` 迁移双方状态且禁止旧 timer 回写。
- channel-backed live row 直接使用 published text，绕过重复 `useDeferredValue`；非 channel 路径保持原策略。
- `useMarkdownStreamingValue` 保留 48–220ms throttle / progressive chunk，但 timer commit 不再包 `startTransition`。
- 与 AI SDK `throttle: 50` 同构；48ms 是 publish cadence，不是 DOM hard deadline。主线程同步阻塞仍需由 trace 单独定位。
- 不使用 `flushSync`，不增加 byte threshold bypass，不新增永久 feature flag。

### P0 — terminal causal ordering 闭环（治 S0）

- **Codex backend**：`turn/completed`、`turn/error`、`runtime/ended` 到达时，`BatchedTauriEventSink` 用 per-sink emit-order lock 串行化 ticker 与 critical emitter；state lock 内 drain 当前 sink、同 workspace queue，再 append terminal，释放 state lock 后 emit ordered batch。其他 workspace 不 drain。
- **In-flight drain**：ticker 的 emit-order lock 必须覆盖“drain ownership → app.emit”，防止 queue 已从 state 移除但尚未 emit 时 terminal 抢先。
- **Unified frontend**：`appServerEventBackpressure` 在 app-server settlement terminal 到达时，先把同 workspace queued predecessors 按原顺序移交给既有 scheduled consumer，再交付 terminal。这里只同步搬运 queue ownership，不同步执行 reducer / React render。
- **Interactive critical**：`approval/request`、`item/tool/requestUserInput`、collaboration mode control 保持 immediate bypass。
- **其他 CLI**：Claude / Gemini / Kimi / Grok / OpenCode backend adapter 不改；它们的 sequential direct emit 统一由 frontend barrier 保护。
- **Shared**：Codex target 继承 backend + frontend 两层保护；其他 target 继承 frontend 保护。`SharedRuntimeCoordinator` replay barrier 保持 authoritative，不建立 renderer 第二权威。

### 后续独立 change — 消除结束瞬间的 DOM 暴涨（治 2.5-5）

- `STREAMING_VISIBLE_WINDOW = 60` → idle `VISIBLE_MESSAGE_WINDOW = 10000` 的切换需要单独测量和设计。
- 不得以此为由恢复 virtualization；必须先解决 initial-offset handoff 与 post-measure anchor preservation，并提供 focused regression coverage。

### P1 — Windows 平台对齐

1. **GPU 回退可观测**：启动时读 `startup_guard.json`，若 `enable_webview2_gpu_fallback` 已激活，在设置页/诊断页提示"当前为软件渲染兼容模式"，并提供重置入口。这是 Windows 卡顿的环境主因，先让用户能自查。
2. **后台节流对齐**：评估 Windows 侧禁用 `BackgroundThrottling`（Tauri 2 是否已支持 Windows；不支持则记录为 upstream gap）。
3. **平台测量**：记录 Windows WebView2 的 IPC、Markdown commit 与 long task phase。`TIMELINE_VIRTUALIZATION_STREAMING_MIN_ROWS` 当前不生效，不在本轮调整。

### P2 — Native 模式事件聚合（治 S6 的一半）

- Native 模式逐事件 `app.emit` 改为复用 `BatchedTauriEventSink`（40ms），与 app-server 模式对齐；terminal output 路径（`event_sink.rs:385-391`）一并纳入。
- Windows 32ms coalesce（`claude.rs:1695`）在 P0 落地后复核：前端有下限保证后，后端攒批不再是唯一防抖手段，可考虑收敛到与 mac 一致（0）或保留但缩小窗口——以实测数据决定。

### P2 — mitigation 从反应式改为预防式

- `DEFAULT_VISIBLE_OUTPUT_STALL_THRESHOLD_MS = 700` 触发前，P0 的下限机制已保证上屏；mitigation 保留为最终保险丝，但预期触发率应趋近于 0。
- 观测指标 `stream-latency/mitigation-activated` 纳入回归门禁：触发即视为退化。

### 不做（YAGNI / 本轮明确排除）

- 不引入二进制 IPC（tauri-wire 类）：文本 delta 的 JSON 开销在聚合后已不是瓶颈，先验证 P0。
- 不重写 markdown 渲染器：lightweight renderer 已验证。
- 不改 shared coordinator 的 authoritative owner defer 语义；它是可产生相同 stall-then-flush 的独立 upstream 原因，本轮只补 attribution / overflow evidence。
- 不修改各 engine adapter 或当前无 production subscriber 的 `AgentEventBus`；不得借 terminal bug 扩散成全 runtime 重构。

---

## 6. 验证方案

### 6.1 复现与指标

| 指标 | 工具 | 目标 |
|------|------|------|
| source→publish / publish→render phase | `ccgui.debug.streamLatencyTrace=1` | 分段可归因；不得用单一总延迟掩盖 upstream defer |
| channel publish cadence | focused fake-timer tests + trace | 首段立即；持续输入约 48ms trailing publish，无 byte bypass |
| mitigation 触发次数 | `stream-latency/mitigation-activated` 诊断 | 0 |
| 事件批量统计 | `app-server-event-batch-stats` | flush 间隔稳定、无 >128KB 突发 |
| terminal causal order | focused Rust + Vitest integration | `delta → item/completed → terminal`；其他 workspace 保持 queued |
| 帧率 | `render-jank-knife-experiments` 方法 | 重负载 ≥ 8 FPS，无 >500ms 长帧 |

### 6.2 A/B 验证 S1/S2（实施与验证并行）

channel-backed row 直接使用 published text，并移除 Markdown scheduled commit 的 `startTransition`。若 source→publish 正常、publish→render stall 消失，则支持 S1/S2；若 source→publish 本身停滞，继续检查 backend / Shared owner defer。该 A/B 只证明当前复现链路，不宣称所有 provider 共用唯一根因。

### 6.3 回归场景

- Native Session（claude/codex CLI）长回复流式：Windows WebView2 + macOS WKWebView 双平台真机。
- Shared Session（app-server）并行多会话流式（参照 `parallel-conversation-jank-handbook.md` 场景）。
- 含代码块/表格/math 的重 markdown 流式（复杂度升档路径）。
- 窗口被遮挡/最小化恢复后的流式连续性（Windows 后台节流场景）。
- `Messages.windows-render-mitigation` 场景不回归（`messages.part1.css:31-42` 注释要求的真机回归）。
- Codex batch、single fallback、non-Codex direct emit 与 Shared projected identity 都必须在 terminal guard 前 dispatch final content。

---

## 7. 风险与回滚

| 风险 | 缓解 |
|------|------|
| P0 cadence 引入可感知“出字变粗”（逐字 → 逐块） | 48ms 接近 AI SDK 参考值；保留现有复杂度分档与 progressive reveal |
| timer 被主线程长任务延迟 | 明确 timer 不是 DOM SLA；用 phase trace 定位同步 long task |
| terminal 到达时 published snapshot 落后 | drain / clear 从 accumulated entry 读取并同步取消 timer |
| rename 时旧 timer 回写旧 thread | 取消旧 timer，迁移 accumulated / published 后同步发布 latest |
| terminal barrier 搬运大量 predecessors | 只移交到既有 scheduled consumer，不同步执行 reducer；仅匹配同 workspace |
| approval 被正文队列拖延 | interactive critical 不启用 terminal barrier，保持 urgent bypass |

回滚：复用现有 `ccgui.perf.liveTextExternalization=0`，回到 reducer-backed live text；不新增第二个永久 flag。idle adaptive rendering 是后续独立恢复项，不随该 flag 回滚。

---

## 8. 实施顺序

1. **P0 live channel accumulated / published 分离** + fake-timer tests。
2. **P0 terminal / rename / reset 无损收口**。
3. **P0 channel-backed row 去重 defer + Markdown scheduled commit 去 transition**。
4. **P0 Codex backend terminal barrier + unified frontend causal barrier**。
5. focused Rust/Vitest、typecheck、定向 ESLint、OpenSpec strict validation。
6. 双平台真机 trace；按 phase evidence 决定 Native event transport 与 idle window 的后续独立 changes。

---

## 9. 分 CLI 特性矩阵与特殊处理（2026-07-30 进阶）

> 以下全部来自当前 HEAD 源码核实，不含推测。每家标注关键 `file:line`。

### 9.1 总览矩阵（2026-07-30 诊断快照）

| CLI | 启动形态 | stdout 协议 | 文本粒度 | 后端聚合 | 前端 markdown 路径 |
|-----|---------|------------|---------|---------|------------------|
| Claude Code | 每 turn 新进程，`-p` + `--input-format stream-json`（prompt 走 stdin） | JSONL（`--output-format stream-json --verbose --include-partial-messages`） | **真 delta**（`stream_event`/`assistant_message_delta`） | Windows 32ms coalesce；mac=0；逐事件 `app.emit` | staged（lightweight） |
| Codex | `codex app-server` 常驻 stdio JSON-RPC | JSON-RPC notifications | **真 delta**（`item/agentMessage/delta`）+ 快照（`item/updated`） | SnapshotThrottle 32ms + BatchedSink 40ms | staged（lightweight） |
| Gemini | **每 turn 新进程**，`--output-format stream-json`，prompt 经 `--prompt ""` 占位 + stdin 写入，续聊 `--resume <id>` | JSONL，但**多版本 schema 模糊匹配** | 混合：`delta` 字段为增量；`gemini`/`message` 类型的 `content` 为**整块文本** | 无 coalesce；逐事件 emit | **full re-parse**（不在 staged 白名单） |
| OpenCode | 每 turn 新进程，`opencode run --format json` | JSONL | 首条 TextDelta 常为**整块文本**，adapter 合成流式（64–140 字符/块，24ms/块） | 合成延迟 24ms；工具输出快照→suffix diff | **full re-parse** |
| Grok | 每 turn 新进程，`--output-format streaming-json`（注意：不是 `stream-json`） | NDJSON | **真 delta**（`{"type":"text","data":"..."}`） | 无 coalesce | **full re-parse** |
| Kimi | 每 turn 新进程，`--output-format stream-json` | NDJSON | **整块快照**（`{"role":"assistant","content":"..."}`，无 token delta） | adapter 做 snapshot→suffix diff（`kimi.rs:230-233`） | **full re-parse** |

前端 staged 白名单证据：`src/features/messages/rows/presentation/messagesStreamingComplexity.ts:168-175` —— `shouldUseStagedStreamingMarkdown` 只覆盖 `codex || claude`，**其余四家流式期间每个 delta 都走 react-markdown 全量重解析**。

### 9.2 Claude Code（`src-tauri/src/engine/claude.rs`）

**特性（已核实）**

- 启动参数：`claude.rs:1088-1113` —— `--input-format stream-json`（prompt 经 stdin，避免 shell wrapper 解析 prompt 文本）、`--output-format stream-json`、`--verbose`、`--include-partial-messages`。
- 读取：`BufReader::lines()` 逐行 JSON（`claude.rs:1684-1685`）。
- coalesce：仅 Windows 32ms（`claude.rs:298,1695-1699`），`BufferedClaudeTextDelta` 攒批后由 `flush_buffered_text_delta` 发出（`claude.rs:914-935`）。
- 通道：`broadcast::channel(1024)`（`claude.rs:734`）；每 turn 一个 forwarder task（`commands.rs:1846+`），**逐事件 `app.emit("app-server-event")`，不走 BatchedTauriEventSink**（`commands.rs:1975`）。
- EOF 陷阱：拿到 `result` 事件即逻辑完成，不等进程退出——MCP 子进程/Stop hook 继承 stdio 管道会拖延 EOF，由 `CLAUDE_POST_RESULT_GRACE` 兜底（`claude.rs:1701-1710` 注释）。

**特殊处理需求**

1. delta 速率全家最高（`--include-partial-messages` 产生 token 级事件），前端 deferred 饥饿（S1）在 Claude 上最容易触发——P0 的 live channel 合流对 Claude 收益最大。
2. Windows 32ms coalesce 与前端合流叠加后，出字节奏为"32ms 后端攒批 + 32ms 通道攒批"，需在 P0 落地后复测是否仍需要后端这层（见 §5 P2）。
3. forwarder lag 时广播丢事件只记 warn（`commands.rs:1875`），长文本高频 delta 下 broadcast(1024) 溢出即丢字——需纳入回归观测。

### 9.3 Codex（app-server 模式）

**特性（已核实）**

- 协议：`item/agentMessage/delta` 与 `item/reasoning/delta` 为真 delta（`codex_adapter.rs:177-188`）；`item/started|updated|completed` 为快照事件（`app_server_runtime_lifecycle.rs:336`）。
- 双节流：`SnapshotThrottle` 32ms 作用于 `item/updated` 快照（`app_server_runtime_lifecycle.rs:665`），`BatchedTauriEventSink` 40ms 批量 flush（`event_sink.rs:99-102`）。
- 事件方法名兼容四种写法（`item/agentMessage/delta`/`text:delta`/`text/delta`/`item/agentMessage/textDelta`，`app_server_runtime_lifecycle.rs:317-324`）。
- Windows 经 `cmd /c` 包装（`app_server_cli.rs:864-883`）。

**特殊处理需求**

1. Codex 是全仓库**唯一自带完整后端聚合**的链路（32ms 快照节流 + 40ms 批量 sink）——它是 P2 给其他 Native 引擎补聚合时的参考实现。
2. `SnapshotThrottle` 只能保证其自身 pending snapshot 在 terminal 前输出；下游 `BatchedTauriEventSink` 仍可能让 terminal 越过整个 workspace queue。因此 terminal 必须在 sink 内 drain predecessors 后作为 batch 尾事件。
3. managed provider（包括 MiniMax）可产生 sparse / bursty output；客户端必须保序，不能用 provider 差异作为 terminal overtaking 的例外。

### 9.4 Gemini（`src-tauri/src/engine/gemini.rs`）

**特性（已核实）**

- **每 turn 新进程**：续聊靠 `--resume <session_id>`（`gemini.rs:842-843`），prompt 用 `--prompt ""` 占位后从 stdin 写入（`gemini.rs:863-864`，`prompt_writer` 与 `stdout_reader` 并行，`gemini.rs:1383`）。每条消息都付一次进程启动成本。
- 解析是**多版本 schema 模糊匹配**：`parse_gemini_event` 接受 `text`/`content_delta`/`message_delta`/`message`/`gemini`/`response_item`/`response.output_item.added` 等十余种事件类型（`gemini_event_parsing.rs:744-809`），文本提取按 `delta`→`text`→`message`→`content` 多字段回退（`gemini_event_parsing.rs:46-52`）。
- **文本路径无 snapshot→suffix diff**：`gemini` 类型事件的整块 `content` 直接映射为 TextDelta（`gemini_event_parsing.rs:795-809`，测试 `parse_gemini_snapshot_content_maps_to_text_delta`）。对比：reasoning 路径有 `last_reasoning_snapshot`/`emitted_reasoning_texts` 去重（`gemini.rs:1295-1302`），Kimi/OpenCode 文本路径有 suffix diff（`kimi.rs:230-233`、`opencode.rs:243-264`）——Gemini 文本路径是全家唯一没有增量保障的。
- **流式中途轮询历史文件**：若流里没出现 reasoning，每 `GEMINI_REASONING_HISTORY_SYNC_INTERVAL_MS` 读一次 session 历史 JSON 并补发 ReasoningDelta（`gemini.rs:1330-1373`），流结束后还有一次兜底（`gemini.rs:1397-1427`）——流式热路径上的同步文件 I/O。
- 前端不在 staged 白名单 → 每个 delta 全量 markdown 重解析。

**特殊处理需求**

1. **文本快照去重**：为 `gemini`/`message` 类型的整块 `content` 补 suffix diff（与 reasoning 的 dedup 同构），否则同一文本块在快照事件下重复上屏。
2. **纳入 staged markdown 白名单**：Gemini 是现行产品引擎之一，full re-parse 是它流式卡顿的最大单项。
3. **reasoning 历史轮询移出热路径**：文件 I/O 改为完成时一次兜底，或移到独立 task 不阻塞 stdout 读取循环。
4. 每 turn 进程启动成本叠加 TTFT，是 Gemini"首字慢"的来源；不在本次范围，但诊断时不要把启动延迟误判为流式卡顿。

### 9.5 OpenCode（`src-tauri/src/engine/opencode.rs`）

**特性（已核实）**

- 协议：`opencode run --format json`（`opencode.rs:282-284`），delta 从 `part.delta`/`part.text`/`part.content` 回退提取（`opencode.rs:853-860`）。
- **合成流式**：每 turn **第一条** TextDelta 若 ≥180 字符，被 `split_text_for_progressive_stream` 按 64–140 字符切块、块间 `sleep(24ms)` 补发（`opencode.rs:27-28,575-594,938-969`）。这直接证明该 CLI 的首条文本事件常以**整块**到达——"生成期间无字、完成后一大块"是 CLI 侧固有限制，adapter 用合成流式遮盖。
- 工具输出是累积快照，adapter 做 suffix diff 只发新增部分（`opencode.rs:243-264`）。
- 空闲超时：`OPENCODE_OPENAI_IDLE_TIMEOUT=300s`、`OPENCODE_POST_RESPONSE_IDLE_TIMEOUT=15s`、IO 轮询 5s（`opencode.rs:22-26`）。
- 前端不在 staged 白名单。
- 注意：OpenCode retirement 是 active migration（见 `.claude/CLAUDE.md`），投入需控制。

**特殊处理需求**

1. **合成流式期间的下限语义**：24ms/块的 sleep 在 stdout 读取循环内执行，会阻塞后续真实事件的读取——长首块（如 10KB）合成播放需 ~2s，期间真实后续事件被压在管道里。应改为"合成播放与真实事件读取解耦"或取消合成、如实整块上屏（与 P0 的下限机制配合后，整块上屏不再是体验灾难）。
2. 若 retirement 推进，本引擎投入以"不劣化"为限，不做增量优化。

### 9.6 Grok / Kimi

**Grok（`src-tauri/src/engine/grok.rs`）**

- `--output-format streaming-json`（注意 flag 与别家不同，`grok.rs:225-226`）；`{"type":"text","data":"..."}` 为真 delta（`grok.rs:7-8`）。
- 无后端 coalesce，前端不在 staged 白名单。

**Kimi（`src-tauri/src/engine/kimi.rs`）**

- stream-json 为 NDJSON 四种行型，assistant 文本是**整块快照、无 token delta**（`kimi.rs:6-13` 头注释）；adapter 用 `incoming[accumulated.len()..]` 做 snapshot→suffix diff（`kimi.rs:230-233`，测试 `converts_repeated_assistant_snapshots_to_suffix_deltas`）。
- thinking 不写入 JSONL（`kimi.rs:13`）；`-p` 模式恒为 auto 权限、无审批事件。

**特殊处理需求**

1. Kimi 的 suffix diff 假设"后续快照是前缀超集"——若 CLI 行为变为重发整块或乱序，diff 会产生错字；需一条防御：新快照不是旧文本前缀超集时整块替换而非 suffix。
2. 两家前端同样不在 staged 白名单，与 Gemini 一并评估纳入。

### 9.7 Native vs Shared Session 的结构性差异

**Native**（上述六家直连）：瓶颈链 = 后端逐事件 emit → IPC → 前端 deferred 饥饿。症状强弱按 delta 速率排序：Claude > Codex > Grok > Gemini > OpenCode ≈ Kimi（后两家文本天然整块，本来就"晚"，但被 full re-parse 放大）。

**Shared Session**：多了一层 `shared_runtime_coordinator` 的**所有权缓冲**（`shared_runtime_coordinator.rs:930-952`）：

- 事件到达时若 attempt 身份未解析（runtime send 未返回 exact identity），进入 `unowned_events` 缓冲（上限 512，超出 FIFO 丢弃，`shared_runtime_coordinator.rs:28,935-938`），`ui_fanout_deferred=true`，**UI 完全不更新**；
- `bind_runtime_turn` 拿到 exact identity 后开启 replay barrier，缓冲事件**一次性批量重放**（`shared_runtime_coordinator.rs:471-507,1065-1079`）；
- barrier 期间后续事件继续排队（`shared_runtime_coordinator.rs:944-950`）。

这就是 Shared Session"卡到最后一刻一次性输出"的**独立机制**——与 CLI 无关、与前端 deferred 无关，是 coordinator 的 ownership 解析延迟决定的。诊断 Shared 卡顿时必须先查 `publish_shared_runtime_observation` 的 `ui_fanout_deferred` 分布，不要把 coordinator 缓冲误判为渲染饥饿。512 上限的 FIFO 丢弃还意味着极端情况下 Shared 模式会**丢字**而非仅仅延迟。

### 9.8 分 CLI 处理优先级结论

| 优先级 | 事项 | 覆盖 CLI | 依据 |
|--------|------|---------|------|
| P0 | live channel 单一 publish cadence + row/Markdown 去重调度（§5） | 全部，Claude 收益最大 | delta 速率最高 |
| P0 | Codex sink + unified frontend terminal causal barrier | 全部；Codex 多一层 backend 修复 | settlement 不得越过 accepted content |
| P1 | staged markdown 白名单扩到 gemini/grok/kimi | Gemini、Grok、Kimi | §9.1 矩阵；OpenCode 随 retirement 不投 |
| P1 | Gemini 文本 snapshot suffix diff + reasoning 轮询移出热路径 | Gemini | §9.4-1/3 |
| P2 | Native 引擎接入批量 event sink | Claude、Gemini、Grok、Kimi | Codex 已有参考实现 |
| P2 | OpenCode 合成流式与真实事件解耦 | OpenCode | §9.5-1 |
| P2 | Shared coordinator `ui_fanout_deferred` 观测与 512 上限告警 | 全部（Shared 模式） | §9.7 |
| 观察项 | Kimi 前缀超集防御 | Kimi | §9.6-1 |

---

## 10. 参考资料

**本仓库诊断**

- `src/features/messages/rows/components/MessageRow.tsx:291-298`（deferred 分支）
- `src/markdown/hooks/useMarkdownStreamingValue.ts`（bounded timer；scheduled transition 已移除）
- `src/services/eventBackpressure.ts:37-59`（flush 调度）
- `src-tauri/src/engine/claude.rs:298,1695-1699`（Windows 32ms coalesce）
- `src-tauri/src/event_sink.rs:99-102,385-391`（批量 sink / 逐事件 emit）
- `src-tauri/src/startup_guard.rs:159-167`（WebView2 GPU 回退）
- `src-tauri/src/lib.rs:318-329`（macOS 独占 BackgroundThrottling 禁用）
- `src/features/messages/timeline/virtualization/messagesTimelineVirtualization.ts:9-43`（mac 调校阈值）
- `src/features/messages/utils/messagesRenderUtils.ts:32`（尾窗↔全量切换）

**业界实践**

- [Vercel AI SDK — useChat reference（throttle）](https://ai-sdk.dev/v5/docs/reference/ai-sdk-ui/use-chat)
- [Vercel — Maximum update depth exceeded troubleshooting](https://sdk.vercel.ai/docs/troubleshooting/react-maximum-update-depth-exceeded)
- [AI SDK v5 streaming backpressure 分析](https://zenn.dev/coji/articles/vercel-ai-sdk-streaming-backpressure?locale=en)
- [React 官方 — useDeferredValue](https://react.dev/reference/react/useDeferredValue)
- [React 18 WG Discussion #129 — New in 18: useDeferredValue](https://github.com/reactwg/react-18/discussions/129)
- [DeveloperWay — useTransition 实战](https://www.developerway.com/posts/use-transition)
- [Mechanical Rock — The IPC bandwidth wall in webview apps](https://www.mechanicalrock.io/blog/it-s-physics-not-a-bug-the-ipc-bandwidth-wall-in-webview-apps)
- [tauri-wire — binary framing for Tauri IPC](https://github.com/userFRM/tauri-wire)
- [Tauri v2 — Calling the Frontend from Rust](https://v2.tauri.app/develop/calling-frontend/)
- [Tauri IPC Improvements Discussion #5690](https://github.com/orgs/tauri-apps/discussions/5690)
