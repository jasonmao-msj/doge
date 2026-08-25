# Parallel Conversation Runtime Residuals

本文件适用于所有「多 session 并行对话」相关代码:`src/features/threads/hooks/useThread*.ts`、`useThreadEventHandlers.ts`、`useThreadsReducer.ts`、`useThreads.ts`、`useAppServerEvents.ts`、`src/features/messages/components/Markdown.tsx`、`LiveMarkdown.tsx`、`Messages.tsx`、`src/features/home/components/Home.tsx` / `HomeChat.tsx`、`src/services/eventBackpressure.ts`、`src/conversation-presentation/realtimePerfFlags.ts`、`src/services/mediaResourceOwners.ts`、`src/components/common/LocalImage.tsx`、`src-tauri/src/engine/claude.rs`、`src-tauri/src/engine/opencode.rs`、`src-tauri/src/engine/gemini.rs`、`src-tauri/src/event_sink.rs`。

## Scope / Trigger

- Trigger:实现或修改并行多 session 实时对话的事件流、reducer、渲染、计时器、子进程管理、媒体资源释放路径。
- 目标:把"客户端并行对话随时间变卡"分解为 7 条独立根因,每条对应可验证的诊断信号、修复方案、回归测试。

## Why This Exists

- 2026-06 用户报告"多 workspace 并行跑 15 分钟后,切 workspace 响应变慢、输入延迟上升、Heap 增长"。当前结论是 7 个 runtime residual 风险需要逐项复现,不能把未量测的假设写成已确认根因。
- 已有 P1 提案(`c27bb18a` / `7cc4a284` / `25d101a0` / `a8bd4b24` / `f7ae0a99`)落地了 realtime batching / no-op guard / incremental derivation / background render gating 等保护,但**这些保护在 default 状态全开,一旦被关掉就放大对应症状**;`ccgui.perf.*` 开关在 `localStorage` 读取且非 test 模式 cache,当前无统一 UI/debug 重置入口。
- Gemini runtime 已建立 session-owned child registry、pre-spawn lifecycle gate、显式 close/interrupt 与 Drop fallback；这只证明 Gemini owner contract，Claude/OpenCode 仍必须按各自实现独立审计，不能从一个 engine 外推全部安全。
- 7 条根因详见 `docs/perf/parallel-conversation-jank-handbook.md` §3 速查表;本 guide 沉淀"写新代码时如何避开这些坑"与"修改相关路径时如何回归验证"。

## Core Invariant

并行多 session 实时对话运行时,**以下 7 项不变量必须始终成立**:

1. **Child 进程有界**:任意时刻 `pgrep -f 'claude|opencode|gemini|codex' | wc -l` 不应随已结束 turn 单调增长;关闭所有 workspace 后 30s 内归零或报告明确的外部进程来源。
2. **优化开关可重置**:`ccgui.perf.*` 8 个开关的 default value 在 `realtimePerfFlags.ts` 顶部有 registry;Settings 面板有"Reset"按钮;`getActiveRealtimePerfFlags()` debug 入口可查。
3. **Progressive reveal 节奏合理**:pending < 140 字符短路直接 flush;长 turn 使用 `resolveAdaptiveProgressiveRevealStepMs`;`findProgressiveRevealBoundary` 8000 字符输入 < 1ms 或有 perf gate 记录例外。
4. **handlers 引用稳定**:`useThreadEventHandlers` 的 `streamingHandlers` / `lifecycleHandlers` / `diagnosticHandlers` 各自 useMemo rebuild 次数 ≤ 5/turn;基础设施 callback(`flushPendingRealtimeEvents` 等)引用恒等。
5. **长列表虚拟化**:Home/recent conversation/thread sidebar 中任何 100+ item surface 用 `useVirtualizer`;200 session 时 DOM 节点数 ≤ 20;`backgroundActivityByThread` 懒计算 + LRU cache(limit 200)。
6. **图片资源释放**:`LocalImage` 滚出视口时释放 decode-heavy `src`;workspace/session 切换时整组释放;`mediaResourceOwners` 或并行 registry 跟踪 `convertFileSrc` / data URL proxy diagnostics。
7. **Timer 有界**:`useThreads` 非紧急 timer 有统一 registry/diagnostics;5 workspace × 3 session 时 active timer proxy size < 20;非紧急 timer 优先走 `requestIdleCallback`;heartbeat/reconnect 加 ±20% jitter。

## Required Structure

任何并行多 session 实时对话相关的代码改动,**必须**包含:

- **诊断入口**:如果是状态相关(reducer / flag / timer),必须有可观测的 metrics / log / DevTools console 入口。
- **释放路径**:如果是资源相关(child process / blob URL / image / timer),必须有显式释放路径 + Drop / unmount 兜底。
- **回归测试**:单测 + 集成测试,断言"有界"或"已释放"或"已重置"。
- **Cross-platform**:Windows / macOS / Linux 三平台的行为差异(`taskkill` vs `killpg`、`URL.createObjectURL` 在 WebView2 行为)必须有对应测试或注释。

## Passive Feature Hydration Isolation

### Scope / Trigger

- Trigger：在 Conversation/AppShell 全局挂载的 feature surface 新增 session hydration、recovery、permission probe 或后台 command。
- 目标：optional feature 的被动恢复只作用于有 durable canonical evidence 的 exact owner，不把普通会话浏览变成 backend discovery scan。

### Signatures

- History evidence boundary：`findCanonicalSquadRunId(items: unknown): string | null`。
- Evidence store：`registerSquadConversationEvidence(workspaceId, threadId, runId)`、`claimSquadHydration(workspaceId, threadId, runId)`。
- Passive runtime：`hydrateSquadProjection(workspaceId, threadId, expectedRunId)`；当前 backend command 是 `shared_squad_get`。
- Source paths：`src/features/threads/loaders/sharedHistoryLoader.ts`、`src/features/squad-orchestration/store/squadStore.ts`、`src/features/squad-orchestration/components/SquadConversationSurface.tsx`、`src/features/squad-orchestration/runtime/squadExecutor.ts`。

### Contracts

- Shared/Native thread identity 只证明 conversation 类型，不能证明某个 optional feature 已拥有该会话；禁止把 `shared:*`、visible inspector 或 transcript prose 当成 capability evidence。
- Passive feature command MUST 先取得已经加载的 canonical evidence，并核对 exact `workspaceId + threadId + domainId`；`presentation-only` item、自由文本和跨 workspace cache 必须 fail closed。
- Evidence discovery MUST 复用当前 history/projection load，不得为每次 session selection 新增 discovery IPC、actor scan 或 recovery side effect。
- 同一 evidence revision 的 passive hydration MUST one-shot；并发调用 MUST single-flight。返回的 domain id 与 expected evidence 不一致时，必须在 publish/recovery 前拒绝。
- 失败只能写 exact scope diagnostic，禁止全局 Toast 污染其他会话。缓存与 evidence registry 必须 bounded，ordinary null probe 不得占位或驱逐真实 projection。

### Validation / Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| Native Session | optional command = 0 | 用 global surface mount 触发 probe |
| ordinary Shared，无 evidence | `shared_squad_get` / recovery / Toast = 0 | 先 query 再用 null 猜 ordinary |
| canonical item identity/`turnId`/`squadRunId` 一致 | 注册 exact scope，最多 hydration 一次 | 从 message text 推断 |
| `presentation-only` 或 malformed item | fail closed | 注册 evidence |
| feature flag off | hydration command = 0 | 后台恢复 disabled feature |
| concurrent same evidence | 共享一个 in-flight request | 重复 actor scan / recovery |
| backend runId 与 evidence 不同 | publish 前 reject + scoped diagnostic | 把另一 run 投影到当前会话 |
| A → B 后 A request 失败 | 只记录 A scope diagnostic，无 Toast | 改写 B store/UI |

### Good / Base / Bad

- Good：history canonical projection 建 evidence，external store one-shot claim，runtime single-flight + runId compare。
- Base：显式 feature action 可直接使用 command response 发布 projection，不额外 discovery。
- Bad：每次 Shared selection 都调用 `shared_squad_get`，失败后只隐藏 Toast；backend actor scan 与 recovery side effect 仍会累积并卡住客户端。

### Tests Required

- `SquadConversationSurface.test.tsx`：100 个 ordinary Shared switches 断言 hydration/Toast 为 0；feature-off、stale scoped diagnostic。
- `sharedHistoryLoader.test.ts` + `squadStore.test.ts`：canonical evidence 正例；prose、presentation-only、identity mismatch 反例；one-shot claim 与 bounded cache。
- `squadExecutor.test.ts`：Native zero-call、same-scope single-flight、evidence run mismatch 在 recovery 前拒绝。
- `SquadConversationInspectorHost.test.tsx`：workspace/thread atomic owner pairing，旧 SubAgent/Native host boundary 不回退。

### Wrong vs Correct

#### Wrong

```ts
if (isSharedSessionThreadId(threadId)) {
  void hydrateOptionalFeature(workspaceId, threadId);
}
```

#### Correct

```ts
const domainId = getCanonicalFeatureEvidence(workspaceId, threadId);
if (domainId && claimFeatureHydration(workspaceId, threadId, domainId)) {
  void hydrateOptionalFeature(workspaceId, threadId, domainId);
}
```

## When Adding New Real-Time Source

新增任何"实时事件源"(新的 backend event / 新的 Tauri command / 新的 WS / 新的 IPC)时:

- **必须**走 `app-server-event-batch` 通道(40ms 批),不绕过 `BatchedTauriEventSink`。
- **必须**在 `BatchedTauriEventState` 加 workspace 隔离(per-workspace `VecDeque`)。
- **必须**在 `useAppServerEvents` 路由,不在 `useThreads` 内直接 listen。
- 若新增的是可降级性能保护,**必须**加 `realtimePerfFlags` 开关(如 `isXxxEnabled`),默认值 `true` 生产,`false` test,且在文件顶部表格注释。
- **必须**评估是否复用 `eventBackpressure` 包装(`maxQueueDepth` / `rawRetainedLimit` / `coalesceKey` 视情况),不能直接新增无限 listener queue。

## When Adding New Reducer Case

新增 `useThreadsReducer` / `threadReducer*` case 时:

- **必须**保留 no-op guard 路径(unchanged state → 同一引用返回)。
- **必须**走 incremental derivation(只重建变化的 thread / workspace,不全量 map)。
- **必须**在 spec delta 里描述"什么 prop 变化触发 rebuild"。

## Startup Restore Reducer Idempotency

启动恢复会并发触发多个 workspace 的 `thread/list` / active thread selection。这里的 reducer 必须满足更严格的幂等契约:

- `setActiveThreadId` 对同一 workspace + 同一 threadId 重复 dispatch 时,若 unread 已清除且 status 无变化,必须返回原 state 引用。
- `setThreads` 对语义相同的 thread summary list 刷新时,即使 incoming array / `nativeThreadIds` / `autoSession` 是新对象,也必须返回原 state 引用。
- `setThreadListLoading` / `setThreadListPaging` / `setThreadListCursor` 对相同值重复写入必须 no-op。
- 任何启动恢复路径的 reducer 修改,必须补 `useThreadsReducer.test.ts` 级别的 referential equality 断言,防止 React #185 / Maximum update depth 类启动崩溃回归。

## Codex Settled-Turn Revival Guard

并行 Codex 会话下,terminal settlement 到达后,旧 turn 的 late event 仍可能滞后进入前端。这里必须把"已完成 turn 不可复活"当作 lifecycle invariant:

- `turn/completed` / `turn/error` / `turn/stalled` 等 terminal path 必须把 Codex `threadId + turnId` 记入 settled-turn quarantine。
- 所有会触发 `markProcessing(true)` 或 `setActiveTurnId(turnId)` 的 processing-start 入口,必须先检查该 `threadId + turnId` 是否已经 quarantined。
- 对已 quarantined 的同一 `turn/started` 重复事件,必须 diagnostic-only,不能再次 `noteRealtimeTurnStarted`,不能恢复旧 active turn。
- verified successor turn 必须允许正常开始;guard 只能拦截 exact quarantined turn,不能用旧 diagnostic 粗暴拒绝新 turn。
- React transition / deferred dispatch 只能包裹 message content reducer 更新,不能包裹 `markProcessing(true)` / `setActiveTurnId` 等 lifecycle mutation。
- 对 normalized realtime event,`markProcessing(true)` 必须在 `scheduleRealtimeDispatch` 之前完成,queued callback 内必须跳过二次 processing mark,并在 dispatch 前重新检查 terminal quarantine。
- ownerless fallback 查询不能只依赖 `useEffect` 后同步的 React state refs;必须有同步更新的 Codex processing owner registry,覆盖同 tick 内 `turn/started -> runtime/ended/progress` 批次。
- `CodexEventRisk` 必须参与 owner 策略:`diagnostic-only` 事件缺 explicit owner 时不能消费 bounded fallback;会触发 settlement 的 `codex/parseError` 必须按 terminal 处理。
- `runtime/ended` / `codex/parseError` / `turn/error` / `turn/stalled` 等 terminal event 如果缺 `turnId`,前端必须在清理 processing 前用当前 active lifecycle turn 或 turn diagnostic 解析出 settlement identity,并把该 identity 写入 realtime terminal tracking + Codex settled-turn quarantine;禁止只 `markProcessing(false)` 而不隔离后续 turnless raw/item 事件。
- no-progress three-evidence reconciliation 必须按被检查的 `workspaceId + threadId + turnId` scope 发起,不能被当前 active tab 限制;后台并行 Codex 会话如果 scoped backend status 返回 terminal,也必须清理自己的 processing residue。
- 后台 reconciliation cleanup 仍必须通过 workspace/thread/turn/engine scope match;active tab 不是 owner proof,也不能作为拒绝后台 residue cleanup 的理由。
- `onAgentMessageCompleted` / normalized `completeAgentMessage` 是 message block completion,不是 Codex turn terminal proof;没有 `turn/completed` / `runtime-ended` / scoped reconciliation terminal status 时,前端禁止仅凭 assistant text completion 清理 processing 或 quarantine turn。
- assistant text completion 只能作为内容/stream evidence;即使 `turn/completed` 已经因 active blockers deferred,assistant completion 也不能越过仍在运行的 blocker 去 flush deferred completion。
- 回归测试必须覆盖 assistant message completion 后 3s 内没有 terminal event 时,同一 Codex turn 仍保持 processing,后续 item/tool activity 不能被旧 final-assistant timer 截断。
- 回归测试必须覆盖 assistant delta/completion 与 `turn/completed` 均已到达,但仍存在 running child/tool blocker 时,同一 Codex turn 仍保持 deferred,直到 blocker terminal 或 scoped reconciliation 给出明确 terminal owner。
- 回归测试必须覆盖:
  - 单 Codex turn 完成后重复 `turn/started` 不复活。
  - 两个 Codex turn 并行时,A 完成后 A 的重复 `turn/started` 不影响 A/B 状态;B 仍按自己的 terminal 结束。
  - raw/normalized late item event 与 duplicate start 都不能把 completed thread 的 sidebar/composer loading 拉回。
  - queued React transition callback 在 terminal settlement 后不能再次把 completed thread 标记为 processing。
  - 同一个 React tick 内新启动的 Codex processing owner 对 fallback 可见。
  - diagnostic-only ownerless event 不得因唯一 processing thread 而产生 lifecycle mutation。
  - terminal event 缺 `turnId` 后,late turnless raw/item event 不能复活已完成 Codex thread。
  - active tab 是 B 时,后台 Codex A 的 no-progress scoped reconciliation 返回 terminal 后,A 必须清理 loading residue。
  - 缺失 `turn/completed` 但 assistant message block 已完成时,同一 Codex `threadId + turnId` 不得仅凭 message completion 清理 processing residue。

### Manual Runtime Reproduction Gate

2026-06-20 三并行 Codex/Minimax 手工复测仍可复现“内容看似完成但某会话继续 running/loading”。因此并行 lifecycle change 即使通过 full unit test，也不得直接视为 archive-ready。

#### 1. Scope / Trigger

- Trigger: 用户手工复测仍看到 sidebar/composer loading residue，尤其是 2+ Codex/Minimax parallel sessions。
- 目标: 防止再次用 assistant text、active tab、visible thread 这类非 owner 证据做 frontend guess settlement。

#### 2. Signatures

- Required diagnostics:
  - `deferred-completion-reconciliation-query-requested`
  - `deferred-completion-reconciliation-query-resolved`
  - `deferred-completion-reconciliation-cleanup-skipped`
  - `three-evidence-reconciliation-cleanup-applied`
  - `three-evidence-reconciliation-cleanup-skipped`
  - `turn-completed-deferred`
  - `quarantined-codex-event-skipped`
- Identity tuple:
  - `workspaceId`
  - `threadId`
  - `turnId`
  - `engine`
  - provider label
  - current `activeTurnId`

#### 3. Contracts

- Manual runtime failure MUST be classified before another code change:
  - Class A: terminal authority never reaches frontend.
  - Class B: scoped backend status remains `running` / `unknown` after visible runtime completion.
  - Class C: terminal authority reaches frontend but cleanup guard rejects due to scope / active-turn / diagnostic mismatch.
- Frontend MUST NOT reintroduce assistant-message-completion settlement.
- Frontend MUST NOT use active tab, visible conversation, selected sidebar row, or provider label as lifecycle owner proof.
- If Class A/B is confirmed, the preferred next fix is backend lifecycle owner/terminal payload enrichment, not another frontend inference layer.

#### 4. Validation & Error Matrix

| Case | Required Evidence | Allowed Next Action |
|---|---|---|
| No `turn/completed` / terminal runtime event | missing terminal diagnostics for stuck `threadId + turnId` | backend terminal emission investigation |
| backend status says `running` / `unknown` | `deferred-completion-reconciliation-cleanup-skipped` with status-not-terminal | backend status source audit |
| cleanup guard rejects | skip reason `scope-mismatch`, `active-turn-mismatch`, or `deferred-completion-missing` | frontend guard review with exact payload |
| assistant text complete only | no terminal authority | keep processing; do not settle |

#### 5. Good / Base / Bad Cases

- Good: collect diagnostics, classify A/B/C, then change the responsible layer.
- Base: automated tests pass, proposal remains open until manual runtime evidence is classified.
- Bad: add a timer that settles after final assistant text; this masks loading but can cut off tool/explore chains.

#### 6. Tests Required

- Unit tests must keep assistant completion non-terminal.
- Unit tests must keep scoped backend terminal cleanup strict.
- Manual reproduction notes must include the diagnostic tuple before archive/sync.

#### 7. Wrong vs Correct

Wrong:

```typescript
onAgentMessageCompleted(payload);
setTimeout(() => markProcessing(payload.threadId, false), 3000);
```

Correct:

```typescript
onAgentMessageCompleted(payload);
recordAssistantCompletionEvidence(payload.threadId, payload.itemId);
// Wait for terminal authority or capture diagnostics proving why it never arrives.
```

### Codex Terminal Authority Matrix

#### 1. Scope / Trigger

任何修改 Codex realtime lifecycle 的代码,只要会调用以下任一 mutation,都必须先通过 terminal authority 判断:

- `markProcessing(threadId, false)`
- `setActiveTurnId(threadId, null)`
- `markRealtimeTurnTerminal(threadId, turnId)`
- `markTerminalSettlement` / settled-turn quarantine
- deferred `turn/completed` flush

#### 2. Signatures

- `onAgentMessageCompleted(payload: { workspaceId; threadId; itemId; text; turnId? })`
- normalized `completeAgentMessage`
- `onTurnCompleted(workspaceId, threadId, turnId)`
- `onTurnError` / `onTurnStalled` / owner-gated `runtime/ended`
- `flushDeferredTurnCompletion(threadId, source)`

#### 3. Contracts

| Signal | Terminal Authority | Allowed Mutation |
|---|---:|---|
| `onAgentMessageCompleted` / `completeAgentMessage` | No | content/stream evidence only |
| assistant delta / text ingress | No | liveness evidence only |
| `turn/completed` with no active blockers | Yes | complete settlement |
| `turn/completed` with running child/tool blockers | Deferred | store deferred completion; do not clear processing |
| child/tool terminal update after deferred completion | Yes | flush deferred completion |
| scoped reconciliation terminal for same deferred `workspaceId + threadId + turnId` | Yes | flush deferred completion with `scoped-reconciliation-terminal` |
| scoped reconciliation returns terminal for same `workspaceId + threadId + turnId` | Yes | clear matching residue |
| ownerless/ambiguous terminal-like event | No | diagnostic-only |

#### 4. Validation & Error Matrix

| Case | Expected |
|---|---|
| assistant completion, no terminal event | keep processing; no quarantine |
| assistant completion after deferred `turn/completed`, blocker running | keep deferred; no flush |
| scoped backend says deferred turn is terminal | flush deferred completion even if local blocker is stale |
| child/tool updates to terminal after deferred `turn/completed` | flush deferred completion |
| scoped backend says inspected turn is terminal | clear matching residue even if background tab |
| scoped backend says running/unknown or turn mismatch | reject cleanup |

#### 5. Wrong vs Correct

Wrong:

```typescript
onAgentMessageCompleted(payload);
setTimeout(() => settleTurn(payload.threadId), 2500);
```

Correct:

```typescript
onAgentMessageCompleted(payload);
recordAssistantCompletionEvidence(payload.threadId, payload.itemId);
// Do not settle. Wait for terminal event, blocker terminal update, or scoped reconciliation.
```

#### 6. Tests Required

- `useThreadEventHandlers.test.ts`: assistant completion without terminal event must not settle after timer advance.
- `useThreadEventHandlers.test.ts`: assistant delta/completion plus deferred `turn/completed` with running blocker must remain deferred.
- `useThreadEventHandlers.test.ts`: scoped backend terminal response for deferred `turn/completed` must flush only the matching thread.
- `useThreadEventHandlers.test.ts`: scoped running/unknown/mismatched response must keep deferred completion blocked.
- `useThreadEventHandlers.test.ts`: terminal child/tool update may flush deferred completion.
- `useThreadEventHandlers.test.ts`: scoped background reconciliation may clear matching stuck residue.

## Conversation Curtain Deferred Snapshot Scope

并行 session 下,幕布渲染层的性能优化也必须保持会话隔离:

- `Messages` 中任何 `useDeferredValue` 包裹的 message snapshot 都必须携带 `workspaceId + threadId` scope。
- 当 active tab/session 切换导致当前 scope 与 deferred snapshot scope 不一致时,必须立即丢弃 deferred snapshot,改用当前 conversation items。
- `resolveStreamingPresentationItems` 只能在同 scope 内把 current live ids append 到 deferred stable snapshot;不同 scope 时必须返回 current items。
- 这条规则只切断跨会话串帧,不得关闭同一会话内的 stable parent snapshot + live row override 双轨性能优化。
- 回归测试必须覆盖:
  - A/B 两个 Codex 会话并行时,切到 B 后 `MessagesTimeline` 不接收 A 的 grouped entries。
  - 同一 `workspaceId + threadId` streaming 时,同 id live assistant 仍可即时覆盖,父层 boundary 可延后收敛。

## When Adding New Sidebar / List Rendering

新增任何侧栏 / 列表 / 表格组件时:

- 任何可能超过 100 items 的列表**必须**用 `@tanstack/react-virtual` 的 `useVirtualizer`。
- **必须**给每个 item 配 `key={item.id}`,不可以用 index。
- **必须**对衍生数据(背景态、token usage、rate limits)走懒计算 + LRU cache。

## When Adding New Timer / Interval

新增任何 `setTimeout` / `setInterval` / `requestAnimationFrame` 时:

- **必须**注册到统一 timer registry 或现有 owner ref,key 唯一,旧 key 先 clear,并提供 diagnostics proxy。
- **非紧急** timer 走 `requestIdleCallback` / `scheduler.postTask`,带 `setTimeout` fallback。
- **heartbeat / reconnect** 必加 ±20% jitter,防 thundering herd。
- **必须**在 useEffect unmount / deps 变化时 clear。

## When Adding New Image / Media Resource

新增任何 `URL.createObjectURL` / `convertFileSrc` / `<img>` / `<video>` 时:

- **必须**注册到 `mediaResourceOwners`(URL.createObjectURL)或扩展的 `trackConvertFileSrcUrl` / data URL proxy registry。
- **必须**配 IntersectionObserver,滚出视口时 `src = ''` 释放。
- **必须**在 workspace / session 切换时主动 release。
- **必须**加 `?cacheBust=<turnId>` 防止 WebView 复用旧资源。

## When Adding New Rust Child Process / Subprocess

### 1. Scope / Trigger

- Trigger：新增或修改 `tokio::process::Command::spawn` / `std::process::Command::spawn`，尤其是 engine session 的 send、interrupt、remove、shutdown。
- 目标：process owner 生命周期必须可证明；旧 `Arc`、抢跑 send 或 cleanup failure 不能产生无主 child。

### 2. Signatures

- Gemini runtime policy：
  - `GEMINI_RUNTIME_ENABLED: bool`
  - `GEMINI_DISABLED_DIAGNOSTIC: &str`
- Session lifecycle：
  - `GeminiSession::interrupt_turn(&self, turn_id: &str) -> Result<(), String>`
  - `GeminiSession::close(&self) -> Result<(), String>`
- Manager lifecycle：
  - `EngineManager::remove_gemini_session(&self, workspace_id: &str) -> Result<(), String>`
  - `EngineManager::shutdown_gemini_sessions(&self) -> Result<(), String>`

### 3. Contracts

- Gemini execution disabled 时，frontend settings、GUI sync/async command、daemon sync/async bridge 与 session pre-spawn gate MUST all reject with the same stable diagnostic。
- frontend execution policy MUST cover Prompt Enhancer、Orchestration、Project Map、Checkpoint commit、commit-message、TaskRun Retry/Resume/Fork、manual recovery、thread messaging/session owner 与 Tauri service boundary；历史记录、filter 与 diagnostics MAY preserve Gemini identity，但不得暴露新执行动作。
- historical Gemini thread MUST remain read-only；composer send、queued auto-flush 与 direct-thread send 必须在 engine mismatch/new-thread fallback 之前 fail closed，禁止把用户输入静默改发给其他 Provider。
- hard-disable 时，single/bulk/preferred detection 与 vendor preflight MUST NOT run `gemini --version`；shared Gemini detector 自身必须是最后一道 zero-spawn gate，不能只依赖现有 callers 记得短路。
- GUI remote boundary MUST reject explicit Gemini locally；`engine=None` MUST remain `None` in transit so the daemon resolves its authoritative active engine and applies the same policy。GUI 不得用不权威的 local active engine 改写 remote request。
- daemon persisted/default active engine MUST normalize a legacy Gemini value to an enabled fallback；否则 remote `engine=None` 会在不 spawn 的同时永久失败。
- session MUST retain every spawned `Child` in its process registry；`closed`、per-turn interrupt tombstone、spawn + registration MUST serialize through the same owner gate。
- `interrupt_turn` MUST publish the turn tombstone before looking up a child；interrupt-before-send 不能留下 race window。
- `close` MUST publish closed state before termination；持有旧 `Arc<GeminiSession>` 的 send 在 close/remove 后不得 spawn。
- cleanup failure MUST return `Err` and retain the session/child owner for diagnosis or retry；manager 不得先 remove 再 best-effort kill。
- `Drop::start_kill` is only a last-resort fallback，MUST NOT be reported as verified cleanup success。
- 禁止用 `pgrep` / process-name scan 作为生产 owner 或自动 kill 依据；只有 owner registry 能证明归属。后台 reconciler 仅在使用该 registry 且有明确 timeout contract 时 MAY add。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| settings 残留 `geminiEnabled=true` | normalize 为 false；command 返回统一 disabled diagnostic | legacy true 绕过 gate |
| explicit Gemini remote send | GUI 转发前拒绝 | 把 Gemini payload 发给旧 daemon |
| GUI remote request engine omitted | 原样转发 `None`；daemon 解析并执行 policy | 用 GUI local active engine 改写 remote request |
| daemon legacy default Gemini | normalize 到 enabled fallback | 把 Gemini 保留为 active 导致所有 implicit send 永久失败 |
| bulk/preferred/vendor probe | synthetic disabled / skip，零 spawn | hard-disable 后仍执行 `gemini --version` |
| historical Gemini TaskRun/thread | 允许查看；composer/queue/direct send 在 fallback 前拒绝 | Retry/Resume/Fork/manual recovery 启动新 turn，或静默改发其他 Provider |
| direct frontend session/service call | shared owner 在 pending thread / IPC 前拒绝 | 只依赖 Rust 最后一层拒绝 |
| interrupt arrives before send spawn | tombstone 使 send 失败且不 spawn | 找不到 child 就当作无事发生 |
| remove/close 后 stale `Arc` send | closed gate 拒绝 | 新 child 脱离 manager ownership |
| child termination failure | propagate error；保留 owner | remove entry 并返回成功 |
| host shutdown 部分失败 | aggregate errors；仅移除成功关闭 owner | 吞掉失败并清空 registry |

### 5. Good / Base / Bad Cases

- Good：command boundary hard-disable + session pre-spawn backstop + owner-retaining cleanup。
- Base：enabled engine 仍按同一 registry/gate 模式 spawn/register/interrupt/close。
- Bad：在 `spawn()` 之后才检查 `closed`；或先从 manager map remove，再尝试 kill。

### 6. Tests Required

- GUI 与 daemon sync/async resolver MUST cover explicit Gemini、remote omitted engine passthrough 与 daemon authoritative resolution。
- settings normalization MUST cover persisted legacy `geminiEnabled=true`。
- single/bulk/preferred detector 与 vendor preflight MUST use a fake marker to prove hard-disable does not spawn。
- frontend policy MUST cover legacy persisted Gemini、background automation fail-closed、direct service invocation、historical actions hidden and no cross-provider composer/queue fallback。
- lifecycle tests MUST cover stale `Arc` after close、interrupt-before-send、cleanup failure retains owner and can be retried。
- process-group helper tests MUST cover descendant cleanup on Unix and failed descendant verification on Windows。
- changed Rust files MUST pass targeted tests、`cargo check --bins` and targeted `rustfmt --check`。

### 7. Wrong vs Correct

#### Wrong

```rust
let session = manager.get_gemini_session(workspace_id).await;
manager.remove_gemini_session(workspace_id).await;
let _ = session.interrupt_turn(turn_id).await;
```

#### Correct

```rust
// close publishes the lifecycle gate and verifies child cleanup before owner removal.
manager.remove_gemini_session(workspace_id).await?;
```

## Regression Test Requirements

任何对 7 条根因相关代码的改动,必须新增或更新回归测试,断言:

| 根因 | 验收指标 | 测试位置 |
|---|---|---|
| 1 | Drop session 后 1s 内 child 被 SIGTERM | `src-tauri/src/engine/claude/tests_core.rs` |
| 2 | localStorage 写 '0' 后,`isXxxEnabled() === false`;清掉后回 true | `src/conversation-presentation/realtimePerfFlags.test.ts` |
| 3 | 8000 字符 `findProgressiveRevealBoundary` < 1ms;pending < 140 短路 | `src/features/messages/components/LiveMarkdown.test.tsx` |
| 4 | 30s 长 turn,handlers useMemo rebuild ≤ 5/组 | `src/features/threads/hooks/useThreadEventHandlers.test.ts` |
| 5 | 200 session 侧栏 DOM 节点 ≤ 25;`backgroundActivityByThread` 懒计算 | `src/features/home/components/Home.perf.test.tsx` |
| 6 | 滚出视口时 `img.src === ''` | `src/features/messages/components/LocalImage.test.tsx` |
| 7 | 5 workspace × 3 session timer registry size < 20 | `src/features/threads/hooks/useThreads.test.tsx` |

测试必须 `npm test` 通过,`npm run typecheck` + `npm run lint` 无错。

## Cross-Reference

- **诊断手册**(读者友好,含复现步骤 + 验收基线):`docs/perf/parallel-conversation-jank-handbook.md`
- **OpenSpec 契约**:`openspec/specs/parallel-conversation-runtime-residuals/spec.md`
- **Change delta**:`openspec/changes/investigate-parallel-conversation-jank-2026-06/specs/parallel-conversation-runtime-residuals/spec.md`
- **复现脚本**:`scripts/perf-reproduce-jank.sh`
- **执行进度**:`docs/perf/jank-fix-progress.md`(边修边记)
- **已落地 P1 提案**(参考):`c27bb18a` / `7cc4a284` / `25d101a0` / `a8bd4b24` / `f7ae0a99`
- **相关 spec**:`openspec/specs/conversation-realtime-cpu-stability` / `conversation-realtime-client-performance` / `realtime-event-batching-performance` / `app-server-event-batching`
