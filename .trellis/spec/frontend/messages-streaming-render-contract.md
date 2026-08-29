# Messages Streaming Render Contract

本文件适用于 `src/features/messages/components/Messages.tsx`、`MessagesTimeline.tsx`、`MessagesRows.tsx`、`Markdown.tsx`、`LiveMarkdown.tsx` 这一条 live conversation render pipeline。

## Scope / Trigger

- Trigger：修改 live assistant streaming、timeline grouping、anchor rail、sticky user bubble、turn boundary、Markdown progressive reveal、visible render diagnostics。
- 目标：保证长文 streaming 时，live row 持续可见增长，同时父层重派生不再被每个 text delta 拖入热路径。

## Why This Exists

- 本 contract 来自一次真实的 `Codex` 长文 streaming P0 卡顿：前段输出丝滑，但中后段开始整客户端按钮失去响应，幕布只能偶尔滚动，最终常常等输出完才一次性刷出。
- 根因不是单个 Markdown parse 慢，而是 parent timeline derivations 与 live text growth 耦合，导致 `grouping / anchors / sticky / final-boundary` 在长文尾段被反复全量驱动。
- 因此这里保护的重点不是某个 throttle 数字，而是数据流分层：`live row` 与 `stable parent snapshot` 必须分轨。
- 2026-05-15 的 Claude Code 流式卡顿修复进一步确认：`Codex` 与 `Claude Code` 的 live streaming 已进入成熟保护期。后续重构应默认保守，优先证明没有把 diagnostics、history reconcile、runtime ledger、process snapshot 或 parent timeline derive 重新塞回 stream hot path。

## Core Invariant

- `liveAssistantItem` / `liveReasoningItem` MAY 直接来自最新 `renderSourceItems`，保持实时可见增长。
- `groupToolItems`、`messageAnchors`、`historyStickyCandidates`、`assistantFinalBoundarySet`、`assistantFinalWithVisibleProcessSet`、`assistantLiveTurnFinalBoundarySuppressedSet` 这类 timeline-heavy derivations MUST 基于稳定的 deferred presentation snapshot。
- message outline / TOC floater 属于 auxiliary navigation state：它 MAY 跟随 live assistant Markdown 更新，但 MUST 以 throttled visible source 为边界，并通过 stable callback、source-keyed cache 与 idempotent state guard 避免反向驱动 live render hot path。
- parent timeline snapshot 可以附加“新插入的 live item id”，但 MUST NOT 因同一 item 的文本增长或 `isFinal` 翻转而在每个 delta 上全量重算整条时间线。
- deferred `renderSourceItems` / `presentationRenderedItems` snapshot MUST be scoped by `workspaceId + threadId`; tab/session 切换时 scope 不同的旧 snapshot 必须立即失效，禁止把上一会话的 grouped entries 与当前会话 live tail 混到同一幕布。
- streaming 结束后，stable snapshot MUST 自然收敛到 canonical latest presentation items；不得永久停留在旧快照。
- `liveTextExternalization` 只允许把逐 delta 文本移出 root reducer；terminal event MUST 将 Provider 的完整 final text 以同一 assistant item identity 一次性 settle 回 reducer。`seenDelta` 不能成为 Shared Session 跳过 terminal settlement 的理由，否则 snapshot persistence 会把首个 delta 永久误写为 final。
- terminal owner MUST call `flushPendingRealtimeEvents()` before `markRealtimeTurnTerminal(...)` / quarantine；该 flush MUST 同步 drain legacy delta queue、normalized operation queue 与 `NormalizedRealtimeBatcher.flush("terminal")`。deferred completion MUST reuse the same settlement owner，不能只在 immediate `turn/completed` caller flush。
- terminal barrier 后只允许 exact-turn、non-empty assistant `completeAgentMessage` 作为 content-only salvage；它可以更新 durable text，但 MUST NOT mark processing、set active turn 或产生第二 terminal。无 `turnId`、incremental delta、reasoning/tool 或 mismatched completion 继续 drop/diagnostic-only。
- `Claude Code` 与 `Codex` live row 收敛 MUST 先走 realtime path；history replay / reconcile 只能用于校验、补账或最终一致性，不得成为 live assistant text、reasoning、tool output 可见的唯一路径。
- backend diagnostics、runtime ledger persistence、Windows process diagnostics、first-token timing、context ledger 或 runtime pool refresh MAY 提供 observability，但 MUST NOT 成为每个 delta 的前置门槛。

## Shared Session Runtime / Projection Contract

- Shared Runtime event 的 canonical lifecycle owner 是 Rust
  `SharedRuntimeCoordinator`，不是 frontend terminal observer。authoritative
  observation/settlement MUST 在普通 `AppServerEvent` fan-out 前进入 coordinator；
  frontend 只消费已经投影到 Shared thread 的 live event 与 canonical history。
- Shared live event 的 `sharedOwner` MUST 携带
  `attemptId + logicalTurnId + bindingKey + engine + providerProfileId +
  executionTargetSnapshot`。embedded Snapshot 只要 malformed、Engine/Provider 与 owner
  冲突，就必须 fail closed；不得从当前 Picker 或 thread-level fallback 猜 Target。
- Runtime identity bind 前的 early event 与 bind 期间的新 event MUST 经 Rust atomic
  replay barrier 保序。每个 replay batch 必须先 publish authoritative observation，
  后 emit 对应 UI event；frontend 不得建立第二个 replay/terminal persistence authority。
- Shared canonical projection MUST default-on for new V2 facts。Legacy Shared history 通过
  dual-read 合并且按 stable Turn identity 去重；不得读取或拼接 Native CLI session
  files 来“补历史”。
- `conversation.turnCommitted` 的 assistant、Reasoning、Tool、Artifact、structured
  outcome 与 immutable Target 必须单向投影成既有 `ConversationItem` shape。
  presentation item 不得反向写 canonical fact。
- Reasoning-only / tool-only completed Turn MUST 生成空正文 provenance anchor，用来承载
  per-turn CLI/Provider/Model Badge；anchor 不得制造可见空泡或伪造 assistant 文本。
- Shared Runtime 的完整 Context Package prompt echo 只属于 transport/control。必须用
  strict versioned classifier 验证 package/checksum 双 marker 和完整 envelope 后，只隐藏
  重复 user echo；后续 assistant、Reasoning、Tool、Error 必须继续显示。禁止
  `text.includes("MOSSX")` 之类宽匹配。
- per-turn Badge MUST 只读 item 上的 immutable `executionTargetSnapshot`。Provider
  删除后使用 name snapshot + unavailable；explicit canonical `local` 才显示“本地配置”；
  legacy identity 不完整显示“历史配置未知”。

## Scenario: Live text single publish cadence and Shared defer attribution

### 1. Scope / Trigger

- Trigger：修改 `liveAssistantTextChannel`、channel-backed `MessageRow`、Markdown streaming scheduler，或 Shared Runtime owner defer / replay barrier。
- 目标：逐 delta 正文无损累积，但 React 只按单一 cadence 收到 stable snapshot；terminal 不丢 unpublished text；相同 stall-then-flush 外观可区分 frontend publish starvation 与 Shared owner defer。

### 2. Signatures

- `appendLiveAssistantText(threadId, itemId, delta) -> { isFirst }`
- `updateLiveAssistantTextSnapshot(threadId, itemId, text) -> first | growth | unchanged | replacement`
- `getLiveAssistantTextSnapshot(threadId) -> LiveAssistantTextEntry | null`
- `clearLiveAssistantText(threadId) -> void`
- `drainLiveAssistantTextTail(threadId) -> { itemId, tailDelta } | null`
- `renameLiveAssistantTextThread(oldThreadId, newThreadId) -> void`
- `LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS = 48`
- `SharedRuntimeObservation.{ui_fanout_defer_reason,deferred_queue_depth,unowned_overflow_drop_count}`

### 3. Contracts

- `entriesByThread` 是逐 delta 权威 accumulated value；`publishedEntriesByThread` 是 `useSyncExternalStore` 唯一 snapshot source。notification 之间 published object MUST 保持稳定。
- 新 item 首段 MUST 立即 publish；同 item growth MUST 使用 per-thread `48ms throttle + trailing latest snapshot`。禁止用 byte threshold 绕过 cadence。
- `drain` / `clear` MUST 先取消 pending timer；`drain` MUST 从 accumulated value 计算 tail，不能从可能落后的 published snapshot 取值。
- `rename` MUST 取消 old/new timer，迁移 accumulated + published state，并禁止旧 thread callback 回写。
- channel-backed `MessageRow` MUST 直接消费 published text；不得再让同一 live text 变化驱动 `useDeferredValue`。Markdown 的 bounded timer / progressive step 到期后 MUST 直接 commit，不再叠加 `startTransition`。
- `TIMELINE_ADAPTIVE_RENDERING_ENABLED = false` 期间，本优化 MUST NOT 恢复 conversation lightweight mode / virtualized canvas；anchor 继续解析 fully mounted static DOM。
- Shared defer MUST 区分 `AwaitingOwnerIdentity` 与 `ReplayBarrier`；unowned queue overflow counter MUST saturating increment。warning 只在累计 drop 为 `1` 或 power-of-two 时输出，且不得记录正文/prompt/tool output。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| 首段到达 | 立即 publish + reducer 建壳 | 等 trailing timer |
| 48ms 内连续 growth | accumulated 逐字完整，published 保持旧引用，窗口尾 publish latest | 每 delta notify 或 byte bypass |
| pending timer 时 interruption | drain 返回全部 shell 后尾段并清理 timer/maps | 从 stale published text 截断 |
| pending → canonical rename | canonical 立即看到 latest accumulated；old timer 不再触发 | 旧 thread callback 回写 |
| Markdown timer 到期 | deterministic state commit | 再包 `startTransition` 被新输入重启 |
| Shared 未解析 exact owner | reason=`AwaitingOwnerIdentity` + queue depth | 归因成 frontend render stall |
| Shared replay 未完成 | reason=`ReplayBarrier` + barrier depth | 修改 authoritative barrier 来“提速” |
| unowned queue overflow | saturating drop count + bounded warning | silent FIFO drop 或每事件 warn |

### 5. Good / Base / Bad Cases

- Good：channel 累积 `Hello` + ` world`，React 首先看到 `Hello`，trailing tick 只再看到一次 `Hello world`。
- Base：非 channel row 继续使用既有 deferred presentation；completed row 继续 full Markdown。
- Bad：`getSnapshot` 直接读取每 delta 换引用的 accumulated map，但 listener 只按 cadence notify，违反 `useSyncExternalStore` contract。
- Bad：为了修流式卡顿重新开启 timeline virtualization，导致 anchor static-to-virtual 坐标切换。

### 6. Tests Required

- fake-timer tests：首段立即、47ms 不 publish、48ms trailing latest、snapshot referential stability。
- terminal tests：pending timer 下 clear/drain 无 stale callback，drain tail 逐字一致。
- rename tests：old/new listener 各收敛一次，旧 timer 到期不再通知。
- row test：每次 channel publish 只产生 latest Markdown value，不先提交 stale deferred value。
- Markdown hook tests：throttle 与 progressive limits 保留，timer 到期可见值更新。
- Shared coordinator tests：两种 defer reason、queue depth、512 cap 与 overflow count；authoritative replay 顺序原测试必须继续通过。

### 7. Wrong vs Correct

#### Wrong

```typescript
entriesByThread.set(threadId, nextEntry);
notifyThread(threadId);
const visible = useDeferredValue(nextEntry.text);
startTransition(() => setMarkdownValue(visible));
```

#### Correct

```typescript
entriesByThread.set(threadId, nextEntry); // lossless accumulated truth
scheduleEntryPublish(threadId, nextEntry); // 48ms trailing latest
const visible = getLiveAssistantTextSnapshot(threadId); // published truth
setMarkdownValue(visible?.text ?? ""); // timer 已负责 bounded scheduling
```

## Scenario: App-server settlement terminal causal barrier

### 1. Scope / Trigger

- Trigger：修改 `src-tauri/src/event_sink.rs`、`src/services/eventBackpressure.ts`、`src/services/events.ts`、app-server critical method 分类，或任何会在 content event 后发出 `turn/completed` / `turn/error` / `runtime/ended` 的路径。
- 目标：critical event 保持 zero-loss / low-latency，但 settlement terminal 永远不能越过同 workspace 已接受的正文；不能用 provider-specific frontend guard 修补统一 transport 的重排。

### 2. Signatures

- Rust：`BatchedEventState::terminal_barrier_batch(event: AppServerEvent) -> Vec<AppServerEvent>`
- Rust terminal methods：`turn/completed | turn/error | runtime/ended`
- Rust/frontend interactive urgent methods：`item/tool/requestUserInput | approval/request | collaboration/modeBlocked | collaboration/modeResolved`
- TypeScript：`EventBackpressureOptions<T>.isCriticalPredecessor?: (queuedEvent: T, criticalEvent: T) => boolean`
- Frontend barrier scope：`AppServerEvent.workspace_id`

### 3. Contracts

- Codex `BatchedTauriEventSink` 收到 settlement terminal 时 MUST 用 per-sink emit-order lock 串行化 ticker 与 critical emitter；state mutex 内 take 同 workspace queue、保持 arrival order、append terminal，释放 state lock 后 emit batch，再释放 emit-order lock。
- ticker MUST 在 drain queue 前取得同一 emit-order lock，并持有到 drained batches 全部 emit 完成；禁止出现“ticker 已 drain、terminal 先 emit、ticker 后 emit predecessors”的 ownership gap。
- terminal barrier MUST 只修改当前 sink 内匹配 workspace 的 queue；其他 workspace MUST 保持 queued。
- `queued_bytes` MUST 只扣除原先 queued predecessors；`last_flush_size_bytes` MUST 包含 predecessors + terminal。
- unified `appServerEventBackpressure` MUST 在 critical terminal 前把同 workspace queued predecessors 按原顺序交付给既有 downstream scheduler。该操作是 queue ownership transfer，不得直接执行 reducer / render。
- single-channel fallback 与 Claude / Gemini / Kimi / Grok / OpenCode direct emit MUST 复用同一 frontend barrier，不得在每个 adapter 复制 terminal ordering policy。
- Shared projected event MUST 复用相同 workspace barrier；Rust `SharedRuntimeCoordinator` 继续是 owner/replay/settlement authority，frontend 不得建立第二 replay queue。
- interactive critical event MUST 继续 immediate bypass；它们不是 settlement proof，不能写入 terminal quarantine。
- `AgentEventBus` lane ordering 不属于本 contract 的当前 implementation surface；出现 production subscriber 时必须单独审计，禁止顺手扩散。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| Codex queue=`delta,item/completed` 后 terminal | emit `[delta,item/completed,terminal]` | terminal 单独 emit、旧 queue 留待 40ms tick |
| ticker 已 drain、尚未 emit 时 terminal 到达 | ticker batch 先 emit，terminal 后 emit | terminal 越过 in-flight drained batch |
| workspace A terminal，queue 同时有 A/B | 只 take A；B 保持 queued | drain 全局 queue |
| frontend queue 有同 workspace content | content 先进入 scheduled consumer，terminal 后进入 | terminal bypass 后 content 被 late guard 丢弃 |
| approval 到达且正文仍 queued | approval immediate bypass | 因 terminal 修复让 approval 等待整条正文 |
| batch flag off / non-Codex direct emit | frontend 仍保留 observed source order | 只在 Codex batch path 正确 |
| Shared projected final | final content 先 dispatch，authoritative terminal 后 dispatch | renderer 猜 owner 或重复 commit |

### 5. Good / Base / Bad Cases

- Good：MiniMax burst 一次带来 large final snapshot，随后 25ms 到达 terminal；backend/frontend 都保持 snapshot-before-terminal。
- Base：queue 为空时 terminal 仍 immediate delivery，额外 barrier 成本为一次空 scan。
- Bad：把 terminal 归类为 critical 后直接 `deliverToListeners`，因为 zero-loss 不代表可越过 causal predecessors。
- Bad：terminal 前调用通用 `flush()` drain 全局 queue，导致其他 workspace 的长 turn 阻塞当前 settlement。

### 6. Tests Required

- Rust `event_sink::tests`：`delta → item/completed → turn/completed` 精确 method/sequence order、other-workspace isolation、`queued_bytes` 与 flush stats。
- Rust implementation inspection：ticker 与 terminal/urgent critical 使用同一 per-sink emit-order lock，且 state lock 不跨 `app.emit`。
- Rust：approval/requestUserInput urgent bypass 保留 queue，不误走 terminal barrier。
- TypeScript `eventBackpressure.test.ts`：scoped predecessor extraction、unrelated queue retention、urgent bypass。
- TypeScript `events.test.ts`：batch channel 与 single channel observed order；既有“terminal 先于 snapshot”断言必须反转。
- Integration：携带 Rust `sharedOwner` 的 `delta → item/completed → turn/completed` 必须按该顺序调用 dispatcher handlers。
- 保留 terminal quarantine tests：真正 late/stale event 仍必须拒绝，不能用 ordering 修复放宽 lifecycle guard。

### 7. Wrong vs Correct

#### Wrong

```typescript
if (classify(event) === "critical") {
  deliverToListeners(listeners, event);
  return;
}
queue.push(event);
```

#### Correct

```typescript
if (classify(event) === "critical") {
  const predecessors = takeMatchingPredecessors(queue, event);
  predecessors.forEach(deliverToScheduledConsumer);
  deliverToScheduledConsumer(event);
  return;
}
queue.push(event);
```

## Required Structure

- `Messages` 负责区分：
  - `renderSourceItems`：latest live source
  - `presentationRenderedItems`：当前真实 presentation surface
  - `timelinePresentationItems`：供 parent-level heavy derivations 消费的 stable snapshot
  - `history expansion mode`：manual reveal 与 jump-to-message reveal 必须分流；manual reveal 不得再用 `scrollHeight delta` restore 伪装“保视口”，而应进入稳定的 expanded-history presentation mode
- `MessagesTimeline` 负责：
  - 吃 `groupedEntries` / anchors / boundary sets 这类稳定派生
  - 用 `liveAssistantItem` / `liveReasoningItem` 对 active tail 做 override
  - 把 lightweight mode bar / history sticky header / collapsed-history reveal control 与 rows 放在同一个 `messages-full` padding contract 下；不要把顶部 surface 放在 timeline root 外再靠 offset hack 补位
- `messagesLiveWindow` 中的 snapshot helper 必须保持 pure helper 语义，方便单元测试锁定 contract。
- `sharedSessionBridge` 只负责验证/映射 Rust `sharedOwner`，不能从
  `selectedNextTarget` 拼 Snapshot。
- `sharedProjection/dataSource` 只负责 canonical Presentation mapping 与 legacy
  dual-read；不能读取 Native history，也不能把 unknown Provider 归一成 local。
- `contextProtocol` classifier 必须匹配完整 protocol envelope；过滤只发生在
  presentation boundary，原始 Runtime/Canonical evidence 保留。
- retained tool output 使用 neutral `src/utils/boundToolOutput.ts`：`commandExecution`
  保留 64 KiB head + recent tail、总长 ≤256 KiB；`fileChange` 总长 ≤1 MiB。helper MUST
  同时进入 `useThreadsReducer.appendToolOutput` 与 `threadItems.normalizeItem`，避免 live
  reducer 有界但 history/snapshot 绕过。`useToolOutputTailGate` 只管 dispatch cadence，
  不能替代 retained-state budget。

## Scenario: Messages Peer Features Must Use Host Composition

### 1. Scope / Trigger

- Trigger：Messages 时间线需要调用 Prompt Distill、Multi-Agent History Fold 或其它 peer feature UI/runtime capability。
- 目标：保持 `src/features/messages` 的 dependency direction，不让 feature integration 重新进入 streaming/timeline hot path 的 private imports。

### 2. Signatures

- Intent callback：`MessagesProps.onSaveAsPrompt?: (sourceText: string) => void`。
- Peer render slot：`MessagesProps.renderHistoryFold?: (itemId: string) => ReactNode`。
- Main host：`ActiveCanvasMessages` 组合 `Messages + usePromptDistillation + PromptDistillDialog + MultiAgentHistoryFoldTimelineRow`。
- Nested host：`SubagentSessionCanvas` 为嵌套 Messages 提供同一 callback/slot。

### 3. Contracts

- Messages MUST NOT import `prompt-distill/**`、`multi-agent/components/**` 或 peer feature stores；它只发布 intent 或调用 optional render slot。
- Host callback MUST 以 stable identity 传入；History Fold callback 只能依赖 `workspaceId + threadId`，不得读取 live assistant text 或每-delta snapshot。
- `renderHistoryFold(itemId)` MUST preserve the exact timeline anchor id；slot 缺失时安全渲染 `null`，不得退回 peer deep import。
- 每个 production Messages entry MUST 显式组合 Prompt Distill fallback 与 History Fold slot；新增嵌套 Messages surface 时不能只依赖 main Layout host。
- Prompt Distill dialog state MUST stay in the host owner；opening/editing dialog MUST NOT force MessagesCore to own peer hook state。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| 主幕 context menu 保存为 Prompt | host callback 打开原 Prompt Distill dialog | MessagesCore import Prompt Distill hook/dialog |
| 子会话嵌套 Messages | 同样提供 distill callback 与 fold slot | 子会话丢失原能力 |
| timeline 命中 `agent:*:hist-fold` | 用 exact item id 调用 host slot | Timeline import Multi-Agent registry/component |
| slot 未提供 | fold row safely empty | runtime throw 或 peer fallback import |
| live text 每 48ms publish | slot callback identity 不随 delta 变化 | 每 delta 重建 callback 打穿 timeline memo |

### 5. Good / Base / Bad Cases

- Good：Layout 用 `useCallback([workspaceId, threadId])` 注入 History Fold renderer，Messages 只识别 neutral item id。
- Base：测试直接渲染 `<Messages>` 且不需要 peer integration 时可省略 slot/callback。
- Bad：为方便直接在 `TimelineRowRenderer` import `HistoryFoldCard`，或在 `MessagesCore` mount `usePromptDistillation()`。

### 6. Tests Required

- `conversationCanvasNode.test.tsx` MUST assert default `onSaveAsPrompt` reaches Prompt Distill owner and History Fold slot preserves item id。
- `SubagentSessionCanvas` 的 production composition MUST pass both props；修改该 surface 时追加 focused behavior test。
- `check:messages-boundaries` MUST report `inbound=0`、`new=0`，且 baseline 不得新增上述 peer edges。
- 变更后运行 Messages focused tests、typecheck、target ESLint 与 boundary contract tests。

### 7. Wrong vs Correct

#### Wrong

```tsx
import { PromptDistillDialog } from "../../prompt-distill/components/PromptDistillDialog";
import { MultiAgentHistoryFoldTimelineRow } from "../../multi-agent/components/HistoryFoldCard";
```

#### Correct

```tsx
onSaveAsPrompt?.(sourceText);
return renderHistoryFold?.(itemId) ?? null;
```

## Scenario: Turn-bound provisional identity promotion and same-tick terminal settlement

### 1. Scope / Trigger

- Trigger：修改 `threadPendingResolution.ts`、`useThreadTurnEvents.onThreadSessionIdUpdated`、Native engine session hint routing，或 canonical terminal alias settlement。
- 目标：Product Home 可能以无 engine prefix 的 logical UUID 启动 Native turn；canonical `session_*` 到达后必须按 exact engine/turn promotion，terminal 紧随其后时不得让旧 logical row 永久显示 responding。

### 2. Signatures

- `resolvePendingThreadIdForTurn({ workspaceId, engine, turnId, threadsByWorkspace, activeThreadIdByWorkspace, activeTurnIdByThread }) -> string | null`
- provisional candidate：`{ id, engineSource }`，其中 `engineSource == engine`、`id` 不是 `${engine}:<native-id>`、`activeTurnIdByThread[id] == turnId`。
- `onThreadSessionIdUpdated(workspaceId, threadId, sessionId, engineHint, turnId)`。
- `resolvePendingAliasThread(workspaceId, canonicalThreadId, turnId) -> provisionalThreadId | null`。

### 3. Contracts

- conventional `${engine}-pending-*` 与 Claude bootstrap/fork identity 继续参与 resolver；除此之外，只有 explicit `engineSource` + exact normalized `turnId` 同时匹配的无 canonical prefix thread MAY 成为 provisional owner。
- session promotion MUST 接受 exact turn resolver result，不得再次用 pending prefix 拒绝它。workspace-level fallback 仍 MUST 要求 conventional pending prefix + active/content anchor。
- `kimi:`、`grok:`、`gemini:`、`opencode:`、`claude:` canonical terminal MUST 查询 exact turn alias。promotion 与 terminal 在同一 React scheduling interval 到达时，terminal MUST idempotently settle canonical + provisional 两侧。
- assistant text、`item/completed`、active selection、thread title、UUID shape 均不是 promotion 或 terminal authority。
- established canonical target、engine mismatch、turn mismatch MUST fail closed；不得 merge unrelated concurrent session。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| `01a*` + `engineSource=kimi` + exact turn | promotion 到 `kimi:session_*` | 因无 `kimi-pending-*` prefix 跳过 |
| 同 UUID 但 engine mismatch | resolver=`null` | 仅凭 active tab rebind |
| same engine、turn mismatch | resolver=`null` | 仅凭 `isProcessing` rebind |
| canonical target 已 established | 保留原 session，skip promotion | 新 turn 偷绑旧历史 |
| session hint 后 2ms terminal | settle canonical + provisional | 等 rerender/timer 后只 settle canonical |
| final assistant text 已显示但无 terminal | 保持 processing / liveness diagnostics | 从正文猜 completed |

### 5. Good / Base / Bad Cases

- Good：Product Home logical id=`01a…`、engine=`kimi`、turn=`kimi-turn-1`；session hint promotion 后 terminal 同 tick 到达，两侧 `isProcessing=false`、`activeTurnId=null`，Sidebar 只保留 canonical row。
- Base：普通 `kimi-pending-*` 沿既有路径 promotion/settle，行为不变。
- Bad：把所有 unprefixed active thread 当 pending；并发 session 会被当前 tab selection 偷绑。
- Bad：看到 assistant text 后立即清 loading；tool/error 尚未 terminal 时会提前结束 turn。

### 6. Tests Required

- Resolver unit：engine-tagged unprefixed Good、engine mismatch、turn mismatch、multiple exact matches active tie-break。
- Hook regression：session hint 接收 unprefixed exact-turn source并 dispatch `renameThreadId`；同一 `act` 内 canonical terminal 对 canonical/provisional 都调用 `markProcessing(false)` 与 `setActiveTurnId(null)`。
- Existing guards：established target、finalized mismatch、concurrent Claude pending、prefix-based Kimi/Grok/OpenCode tests继续通过。
- Gates：focused Vitest、typecheck、target ESLint、runtime contracts、strict OpenSpec 与 `git diff --check`。

### 7. Wrong vs Correct

#### Wrong

```typescript
if (!threadId.startsWith(`${engine}-pending-`)) return null;
if (assistantText) markProcessing(threadId, false);
```

#### Correct

```typescript
const owner = candidates.find(
  (thread) =>
    thread.engineSource === engine &&
    activeTurnIdByThread[thread.id]?.trim() === turnId.trim(),
);
// terminal authority then settles canonical id and exact-turn alias.
```

## Forbidden Patterns

- 让 `groupToolItems(...)`、anchor/sticky 计算、final boundary 计算直接重新依赖最热的 live text source。
- 为了“看起来实时”，把整条 `presentationRenderedItems` 在每个 delta 上重新驱动到 parent timeline render。
- 在历史 reveal 时继续执行基于 `scrollHeight` 的 viewport restore，同时又切换 virtualized/static layout mode；这种 mixed strategy 会把顶部裁剪、抖动和重叠重新带回来。
- 把 lightweight mode bar、history sticky header 或 reveal control 放在 `messages-full` padding contract 之外，再额外给 root 塞 `padding-top` / sticky `top + 36px` 一类补丁。
- 在 JSX/render 中为 live assistant row 反复创建新的 outline callback，导致 `Markdown` effect 因 callback identity 抖动而重复扫描相同 `throttledValue`。
- 收到语义等价的 `{ messageId, outline }` 后仍提交新的 outline state object，造成 floater reset 或 timeline root rerender。
- 对同一个 throttled visible Markdown source 重复执行 outline full source scan；同源重复 effect 应复用最近一次 extraction result。
- 依赖 history reconcile 才看到 final Markdown / final boundary 的最终状态。
- 把这条 contract 退化成单纯的 throttle number 调优，而不保护数据流分层。
- 在重构中把 `Codex` / `Claude Code` 的 no-text interval 直接当成 terminal stuck；非文本 runtime activity、heartbeat、tool progress、request-user-input、reasoning delta 都可能是合法 progress evidence。
- 把 first-token diagnostics、process snapshot、runtime ledger write、context ledger persistence、history detail reload 插入 live delta emission 之前。
- 为了统一代码路径，删除 `liveAssistantItem` / `liveReasoningItem` override，或让 final visible state 只能等待 history replay。
- frontend 收到 Shared terminal 后自行拼 `assistantText/outcome` 并调用 canonical
  commit，形成 Rust 与 renderer 两个 terminal authority。
- `sharedOwner` Snapshot 无效时回退当前 Picker、thread metadata 或 Engine default。
- 为修复历史缺失，把 Hidden Binding 的 Native history 与 Shared canonical history
  直接拼接。
- 将 Context Package prompt echo 连同后续 assistant/reasoning 一起过滤。

## Validation Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| assistant 同 id 文本持续增长 | live assistant row 立即显示最新文本 | parent grouping/anchors/boundaries 每个 delta 全量重算 |
| assistant 同 id 从 non-final -> final | live row 可先拿到最新 final 状态；timeline boundary 允许在 deferred snapshot 上稍后收敛 | final boundary 必须同步卡住整条父层派生 |
| 新增 live tail item | stable snapshot 可立即追加新 id | 因稳定快照导致新 live item 完全不出现 |
| live assistant outline 重复上报 | 同 message + 同 outline entries 返回 previous state reference | 每次 callback replay 都创建新 outline snapshot |
| parent rerender 但 throttled Markdown 未变 | outline callback identity 稳定，或 Markdown 复用同源 cache | 因 callback identity 变化再次 full scan 相同 source |
| 切换 active conversation tab | 新 tab 只能消费同 `workspaceId + threadId` scope 的 stable snapshot | 上一会话 deferred snapshot 与当前会话 live row / working indicator 同屏 |
| streaming turn 完成 | stable snapshot 收敛到 canonical latest items | 停留在旧 boundary / 旧 grouping |
| Shared streaming 已收到 delta，随后收到 terminal full text | 同一 assistant item 一次性 settle 完整 final，并由 snapshot persistence 持久化 | 因 `seenDelta = true` 跳过 completion，只持久化首个 delta |
| Shared event 在 runtime identity bind 前到达 | Rust barrier 保序 replay，live row 不丢 | frontend 猜 owner 或永久丢 event |
| Shared event 的 embedded Snapshot 与 owner Provider 冲突 | 丢弃 Shared attribution/fail closed | 用当前 Picker 修正 |
| V2 history reload | canonical rich blocks + immutable Badge；legacy dual-read 保留 | 读取 Native session file 拼接 |
| reasoning-only / tool-only completed Turn | 无可见空正文，但保留 provenance Badge | 整轮 label 消失 |
| exact Shared Runtime prompt echo | 只隐藏重复 user transport item | 吞掉后续 assistant/reasoning/tool |
| 用户普通正文包含 `MOSSX` | 原样展示 | substring classifier 误杀 |
| Claude Code first token 慢 | diagnostics 标记 startup/first-token 阶段，UI 不伪造文本也不误判 frontend render stall | 把无首 token 归因到 Markdown/render 卡顿或强制 final-only 输出 |
| Claude Code delta 已到 backend forwarder | delta 先发给 frontend，diagnostics/ledger/process snapshot 后台或 checkpoint 执行 | 等 Windows process diagnostics、runtime ledger 或 history reconcile 完成后才发 delta |
| Codex 长时间无 assistant text 但有 runtime/tool 活动 | activity 计入 progress evidence，保持 non-terminal suspicion 或 normal processing | text-delta-only 判断导致误结算、误停止或误恢复 |

## Tests Required

- pure helper：覆盖“同 id 文本增长时复用 deferred snapshot”和“新增 live id 时追加到 stable snapshot”。
- pure helper：覆盖 deferred/current scope 不同时返回 current items，不能把当前 live items append 到旧 thread snapshot。
- `Messages` integration：覆盖“live assistant row 已拿到最新文本/最新 final 状态时，parent boundary set 仍可停留在稳定快照，然后再收敛”。
- `Messages` integration：覆盖 parallel Codex tab switch 时，新 `threadId` 的 `MessagesTimeline` 不接收旧 `threadId` 的 grouped entries。
- `Messages` integration：覆盖 manual history reveal 进入稳定 expanded-history mode，并把 viewport 复位到 revealed history head。
- `MessagesTimeline` integration：覆盖 expanded history 即使不再使用 absolute virtual canvas，也仍与 lightweight mode bar / sticky header 共享同一个 top-padding contract。
- regression：保留 `Codex` large streaming Markdown throttle / live row render path 测试，防止有人把问题误修成 plain-text-only fallback。
- outline regression：覆盖同一 throttled Markdown source 在 callback identity 变化时不重复 extraction；覆盖同 message + same outline 返回 previous snapshot reference。
- Claude Code regression：覆盖 first-token diagnostics 不阻塞 first visible delta，且 diagnostics/history reconcile 不成为 live delta 前置条件。
- Codex regression：覆盖 no-text 但有 heartbeat/tool/status progress 时不会 terminalize active turn；late stale progress 不能复活已 settled turn。
- Shared terminal regression：覆盖 Codex/Claude 在已收到 delta 后仍以原 assistant item id settle `turn/completed.result.text`，且 completion 只触发一次。
- terminal batching regression：fake timer 下 first-token 已建壳、cadence tail pending、terminal flush 同步落尾；后续 cadence no-op；late full completion content salvage 不复燃 lifecycle。
- tool-output budget regression：连续 append 累计 omitted count、command head/recent tail 保留、fileChange 使用更大 budget、history normalization 不绕过。
- Shared owner regression：覆盖 malformed Snapshot、Engine mismatch、Provider mismatch 均
  fail closed；valid owner 保留 `modelCatalogEntryId + runtime model`。
- Shared projection regression：覆盖 canonical default-on、legacy dual-read、failed Turn、
  reasoning/tool-only provenance anchor、Picker mutation 不改旧 Badge。
- Shared control-echo regression：覆盖 exact envelope 隐藏、ordinary `MOSSX` 文本保留、
  echo 后 assistant/reasoning/tool 仍显示。

## Review Checklist

- 是否把新的 timeline-heavy derive 又绑回 `renderSourceItems` / `presentationRenderedItems` 热路径？
- 是否给任何 deferred/stable snapshot 保留了 `workspaceId + threadId` scope guard？
- 是否仍然保留了 `liveAssistantItem` / `liveReasoningItem` 的最新 override？
- 是否新增了能证明“即时 live row + 延后父层派生”双轨 contract 的测试？
- 是否把 outline、TOC、diagnostics 等 auxiliary state 做成 stable / cached / idempotent，而不是让它们反向触发 live row 重算？
- 是否把 Claude Code first-token / backend-forwarder / frontend-render 三段 latency 重新混成一个“流式卡顿”判断？
- 是否把 Codex suspected silence 写成 terminal settlement，或把 progress evidence 收窄成只有 assistant text delta？
- 是否引入了任何每 delta 都执行的 process snapshot、runtime ledger write、history detail reload、context ledger persistence？
- 是否证明 externalized live text 在 terminal event 会完整回灌 reducer，而不是把 `seenDelta` 误当成“final 已持久化”？
- 是否把 Shared lifecycle truth 留在 Rust coordinator，frontend 仅消费 Projection？
- 是否验证 `sharedOwner.executionTargetSnapshot`，而不是从当前 Picker/thread metadata 猜？
- 是否证明 early/live ingress 在 replay barrier 前后保持顺序，且 observation 先于 UI fan-out？
- 是否让 canonical default-on 与 legacy dual-read 保留历史，而没有拼接 Native session？
- 是否用 strict protocol classifier 只隐藏 prompt echo，而没有吞后续模型内容？
