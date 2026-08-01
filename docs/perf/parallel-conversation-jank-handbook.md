# Parallel Conversation Jank Handbook

> **内容类型**：Troubleshooting + historical remediation playbook
> **生命周期**：implemented / historical；七类风险模型仍可用于诊断，但路径、flags 和阈值必须按当前代码重验
> **最后校准**：2026-08-01 · mossx `0.7.14` · HEAD `26f8065a0c`
> **读者**：接手「客户端并行对话卡顿」问题的工程师 / QA / on-call。
> **事实源**：`openspec/specs/parallel-conversation-runtime-residuals/spec.md`、`.trellis/spec/frontend/parallel-conversation-runtime-residuals.md`、当前 runtime evidence

原诊断与修复 change 已归档到 `openspec/changes/archive/2026-06-14-fix-parallel-conversation-runtime-residuals-2026-06/`。本手册不是 active backlog；执行任何修复前先用当前 evidence 重新证明根因。

## 0. TL;DR(给急着上工的人)

1. **卡顿 = 7 个 runtime residual 风险叠加的候选模型**。不是单点问题,按 §3 顺序逐个排查,每条都要用数据确认。
2. **第一步先记录，再重置**。先导出/抄录当前 performance flags 与复现证据；再通过 Settings 的性能开关 Reset 恢复默认并 reload。不要先清证据。
3. **第二步 §2.2 查 child 进程数**。30 分钟 + 多 workspace + 卡顿时,优先确认 child 是否随已结束 turn 单调增长。
4. **修的具体方案在 §4-§10**,每条根因独立成节,带验收口径和回归测试。
5. **执行顺序看 §11**,P0 → P1 → P2,不要跳。

---

## 1. 复现条件

| 维度 | 阈值 |
|---|---|
| Workspace 数 | ≥ 3(最好 5) |
| 每个 workspace 的活跃 session 数 | ≥ 2 |
| 长 turn 数(单 turn 8000+ 字符流式输出) | ≥ 3 个 workspace 各 1 个 |
| 持续运行时长 | ≥ 15 分钟 |
| 操作系统 | macOS / Windows / Linux 都要测(WebView 行为差异大) |

复现步骤(手动):
1. 启动 `npm run tauri:dev`,登录任意 provider。
2. 打开 5 个 workspace,每个新建 2 个 session。
3. 在每个 session 里发一条会触发 8000+ 字符回复的 prompt(比如「写一个完整的 Rust + React 教程,带示例代码」)。
4. 等 15 分钟,期间记录:
   - 切 workspace 的响应时间(主观 + PerformanceObserver)
   - 输入文字到屏幕出现的延迟
   - 帧时间(DevTools Performance)
5. 采样:`pgrep -f claude | wc -l` 在 0/5/10/15/30 分钟各跑一次。

如果满足「5 workspace + 2 long-running turn + 15 分钟后切 workspace 响应 > 200ms」,即可确认是本手册描述的卡顿。

复现脚本:`scripts/perf-reproduce-jank.sh`(只跑外部采样,需 Tauri 实例已开)。

---

## 2. 第一轮排查:5 分钟定位

### 2.1 记录 flags → Settings Reset → reload

1. 先用 Settings 的 performance report copy/download 入口保存当前 flags 与诊断信息，并录制 Performance trace。
2. 打开 **Settings → Other → Reset performance flags**。该入口调用 `resetRealtimePerfFlags()`，统一清理 9 个 boolean flags、streaming schedule tier 和 tool-output tail gate。
3. reload 后复现同一场景，比较前后证据。

下列 Console 片段只保留为旧版本 recovery 手段；它只覆盖当时 8 个 key，**不再是当前推荐入口**：

DevTools Console 跑:

```js
['realtimeBatching','appServerEventBatch','reducerNoopGuard','incrementalDerivation',
 'backgroundRenderGating','backgroundBufferedFlush','stagedHydration','debugLightPath']
 .forEach(k => localStorage.removeItem('ccgui.perf.' + k));
location.reload();
```

如果 reload 后卡顿消失 → 是 §4 描述的「优化开关退化」问题,直接看 §4 修复。

如果还在 → 继续 §2.2。

### 2.2 查 Rust 端 child 进程

外部 shell:

```bash
# 5 分钟一次,采样 30 分钟
for i in 0 1 2 3 4 5 6; do
  sleep 300
  echo "[$((i*5)) min] $(date +%H:%M:%S) children: $(pgrep -f 'claude-cli|codex' 2>/dev/null | wc -l | tr -d ' ')"
done
```

期望(正常):
- 30 分钟后 child 数 ≤ workspace 数 × 2(每 workspace 最多 2 个并发 turn)。
- 关闭所有 workspace 后 30s 内 child 数 = 0。

如果 child 数 > workspace × 2 且单调增长 → 命中 §5 描述的「child 进程释放缺少兜底」候选根因,继续采样 active process 与 workspace attribution。

### 2.3 查运行时 flag 实际值

DevTools Console:

```js
const keys = Object.keys(localStorage).filter(k => k.startsWith('ccgui.perf.')).sort();
const flags = {};
keys.forEach(k => { flags[k] = localStorage.getItem(k); });
console.table(flags);
// boolean flags 为空时走代码默认；还要单独检查 streaming tier / tool-output gate
```

如果发现某些 key 是 `'0'` / `'false'` / `'off'`,**那就是 §4 的根因**。

### 2.4 查 setTimeout 队列 + Markdown 重渲染频率

DevTools Performance 录制 30s:

1. 看 Main thread 上 `Timer Fired` 事件密度。
   - 正常:< 5/秒
   - 卡顿:> 20/秒
2. 看 React 组件重渲染火焰图,找 `Markdown` / `Messages` / `Home` 三个组件。
   - 正常:每秒重渲染次数 < 18(对应 56ms 节奏)
   - 卡顿:> 30/秒,`findProgressiveRevealBoundary` 调用频繁

如果 timer / Markdown 异常 → 继续 §6 / §9 修复。

### 2.5 查侧栏 session 数量

打开 100+ session 的 workspace,看侧栏 DOM 节点数:

DevTools Elements 面板 → 选侧栏根元素 → 看 child count。

- 正常(虚拟化):≤ 20 个
- 卡顿(未虚拟化):全部渲染,200+ 个

如果未虚拟化 → §8 修复。

### 2.6 查图片资源

DevTools Memory → Heap snapshot,在 0/5/15/30 分钟各采一次。

看 `Detached HTMLImageElement` / `ImageBitmap` 数量:
- 正常:< 50
- 卡顿:> 200 且增长

如果资源泄漏 → §10 修复。

---

## 3. 7 条根因速查表

| # | 根因 | 影响层 | 优先级 | 修复章节 |
|---|---|---|---|---|
| 1 | Rust child 进程释放缺少 Drop 兜底 | OS / Tokio | P0 | §5 |
| 2 | 优化开关可退化且缺自检/重置 | 全局放大 | P0 | §4 |
| 3 | progressive reveal 边界扫描成本 | CPU 单核 | P1 | §6 |
| 4 | handlers 巨型 useMemo | 内存 churn | P2 | §7 |
| 5 | Home/session 长列表未虚拟化 + 全量投影 | 切 workspace 卡 | P1 | §8 |
| 6 | 图片资源释放缺少 viewport/session owner | 内存泄漏 | P2 | §10 |
| 7 | timer 注册分散且缺 idle scheduling | 主线程延迟 | P2 | §9 |

---

## 4. 根因 2（优化开关退化）历史修复设计

> §4–§10 保留当时的实施推导与示例，不保证示例 API 仍可直接编译。当前修复必须先核对文头事实源和现有 tests；本文已把主要文件路径校准到 2026-08-01。

### 4.1 症状

长跑时帧时间从 16ms 涨到 50ms+;`backgroundActivityByThread` 频繁触发 reducer dispatch;侧栏 session 切换时整张表重投影。

### 4.2 代码位置

- `src/features/threads/utils/realtimePerfFlags.ts:46-71` `readRealtimePerfFlag`(从 localStorage 读,永久 cache)
- `src/services/events.ts` 已有 `eventBackpressure` substrate,但 `appServerHub` / `appServerBatchHub` 当前没有专属 queue-depth/backpressure guard
- `src/features/threads/hooks/useThreadsReducer.ts:101-102` 模块顶层一次性读
- `src/features/threads/hooks/threadReducerCoreHelpers.ts:6` helper 模块顶层一次性读

### 4.3 修复步骤

#### Step 1:文档化 default value（历史实施步骤）

当前 `realtimePerfFlags.ts` 有 9 个 boolean flags；另有 streaming schedule tier 与 tool-output tail gate。数量必须从 registry 读取，禁止在 UI 重复维护列表。

#### Step 2：active flag introspection（已落地）

```ts
const activeFlags = getActiveRealtimePerfFlags();
// 每项包含 value/source/storageKey/defaultValue/testDefaultValue/metric。
```

#### Step 3：Settings Reset（已落地）

`OtherSection.tsx` 已提供 Reset。点击后：
1. 调用 `resetRealtimePerfFlags()` 清理 registry 中 9 个 boolean flags、schedule tier 与 tool-output tail gate
2. 弹 modal 提示 reload
3. reload 后回到默认

#### Step 4:把模块顶层 cache 改成 lazy read

`src/features/threads/hooks/useThreadsReducer.ts:101-102` 与 `src/features/threads/hooks/threadReducerCoreHelpers.ts:6`:

```ts
// 旧(模块加载时一次性读,锁死)
const REDUCER_NOOP_GUARD_ENABLED = isReducerNoopGuardEnabled();
const INCREMENTAL_DERIVATION_ENABLED = isIncrementalDerivationEnabled();

// 新(lazy getter)
const getReducerNoopGuardEnabled = () => isReducerNoopGuardEnabled();
const getIncrementalDerivationEnabled = () => isIncrementalDerivationEnabled();
```

reducer 内部所有用到这两个 flag 的地方改成调用 getter,而非读 const。

### 4.4 验收

- 9 个 boolean flags 的 default/testDefault 由 registry 定义；不得假设 test 全为 false。
- `getActiveRealtimePerfFlags()` 返回 9 项,每项含 `value`、`source`、`storageKey` 与 metric metadata。
- 任意关掉一个开关后,Performance 录制 30s 长 turn,reducer dispatch 次数 / Markdown 组件重渲染次数有可观测放大。
- 重新打开 + reload 后,放大消失。
- 测试覆盖：Settings Reset → registry flags、schedule tier、tool-output gate 全部清理 → 显示结果。

### 4.5 回归测试

`src/features/threads/utils/realtimePerfFlags.test.ts` 新增:

```ts
it('returns false when localStorage overrides to 0', () => {
  window.localStorage.setItem('ccgui.perf.realtimeBatching', '0');
  // 注意:cachedFlags 在非 test mode 下会缓存,需先 reset
  __resetRealtimePerfFlagCacheForTests();
  expect(isRealtimeBatchingEnabled()).toBe(false);
  window.localStorage.removeItem('ccgui.perf.realtimeBatching');
});

it('getActiveRealtimePerfFlags returns registered flags with source', () => {
  const flags = getActiveRealtimePerfFlags();
  expect(Object.keys(flags)).toHaveLength(9);
  for (const key of Object.keys(flags)) {
    expect(flags[key]).toHaveProperty('value');
    expect(flags[key]).toHaveProperty('source');
    expect(['localStorage', 'default']).toContain(flags[key].source);
  }
});
```

---

## 5. 根因 1(Rust child 进程释放缺少 Drop 兜底)修复

### 5.1 症状

打开 5+ workspace 同时跑 turn,几分钟后 `ps -ef | grep claude` 可能看到 claude-cli 子进程驻留,`pgrep -f claude | wc -l` 单调增长。这个现象必须用采样确认。

### 5.2 代码位置

- `src-tauri/src/engine/claude.rs:257` `active_processes: Mutex<HashMap<String, Child>>`
- `src-tauri/src/engine/claude.rs:1119` `active.insert(turn_id.to_string(), child)`
- `src-tauri/src/engine/claude.rs:1477` / `1743` / `1815` 等路径会 remove/drain child
- `src-tauri/src/engine/claude.rs:673` `pub async fn active_process_ids(&self) -> Vec<u32>`(已有诊断 API,但没暴露到 workspace-level DevTools 汇总 command)
- `src-tauri/src/engine/claude/manager.rs:64` `remove_session`(只在外部显式调用时移除)

### 5.3 修复步骤

#### Step 1:`ClaudeSession` 加 `impl Drop`

```rust
impl Drop for ClaudeSession {
    fn drop(&mut self) {
        // 同步、立即发 SIGTERM,不 await
        if let Ok(mut active) = self.active_processes.try_lock() {
            for (turn_id, mut child) in active.drain() {
                if let Some(pid) = child.id() {
                    log::info!("[claude] Drop killing child turn={} pid={}", turn_id, pid);
                    let _ = child.start_kill();  // 同步 SIGTERM,非 await
                }
            }
        }
    }
}
```

注意:`Drop` 不能 await,所以用 `start_kill` 而不是 `wait`。OS 会负责回收 zombie。

#### Step 2:暴露 `get_active_process_ids` 到 tauri command

在 `src-tauri/src/engine/commands.rs` 加:

```rust
#[tauri::command]
pub async fn get_active_process_ids(
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<u32>, String> {
    let manager = &state.engine_manager;
    let mut all_ids = Vec::new();
    for (workspace_id, _) in manager.claude_manager.list_sessions().await {
        if let Some(session) = manager.claude_manager.get_session(&workspace_id).await {
            let ids = session.active_process_ids().await;
            all_ids.extend(ids);
        }
    }
    Ok(all_ids)
}
```

并在 `src-tauri/src/capabilities/*.json` 把这个 command 加进 `allow` 列表。

#### Step 3:加后台 reconciler

在 `ClaudeSession` 加一个 `reconcile_stale_children` 方法,每 60s 跑一次:

```rust
impl ClaudeSession {
    pub async fn reconcile_stale_children(&self) {
        let stale_threshold = std::time::Duration::from_secs(300);  // 5 分钟
        let now = std::time::Instant::now();
        // 对每个 child 检查 last_io,超过 stale_threshold 则 kill
        // ...
    }
}
```

在 `ClaudeSessionManager` 加一个 `tokio::spawn` 后台任务,每 60s 对每个 session 调一次 `reconcile_stale_children`。

### 5.4 验收

- 关闭所有 workspace 30s 后,`pgrep -f claude | wc -l == 0`。
- 长跑 30 分钟后,active child 数 ≤ workspace 数 × 2。
- DevTools console `await window.__TAURI__.core.invoke('get_active_process_ids')` 返回非空 array,数 ≤ workspace × 2。

### 5.5 回归测试

`src-tauri/src/engine/claude/tests_core.rs` 新增:

```rust
#[tokio::test]
async fn drop_kills_active_child() {
    let session = ClaudeSession::new_with_runtime(
        "test-ws".to_string(),
        PathBuf::from("/tmp"),
        None,
    );
    // 模拟 spawn 一个会 sleep 60s 的 mock child
    let mut child = tokio::process::Command::new("sleep")
        .arg("60")
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    session.active_processes.lock().await.insert("test-turn".to_string(), child);
    drop(session);
    // 1s 内 child 应被 kill
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    // 验证:用一个独立命令检查 sleep 进程已死
    let output = std::process::Command::new("pgrep")
        .arg("-f")
        .arg("sleep 60")
        .output()
        .unwrap();
    assert!(!output.status.success(), "child should be killed");
}
```

---

## 6. 根因 3(progressive reveal 边界扫描成本)修复

### 6.1 症状

长 turn 实时流式输出时,CPU 单核 80%+,`findProgressiveRevealBoundary` 频繁触发,DevTools Performance flame chart 看到 `Markdown` 组件反复重渲染。

### 6.2 代码位置

- `src/markdown/runtime/LiveMarkdown.tsx`：progressive reveal boundary / step contract
- `src/markdown/components/Markdown.tsx`：Markdown presentation

### 6.3 修复步骤

#### Step 1:`findProgressiveRevealBoundary` 合并正则

把 6 个 `pattern.exec(candidateSlice)` 合并成单次 `lastIndex` 扫描:

```ts
function findProgressiveRevealBoundary(
  pendingText: string,
  preferredChars: number,
  maxChars: number,
) {
  const normalizedPreferred = normalizeProgressiveRevealChunkChars(preferredChars);
  const normalizedMax = Math.min(maxChars, PROGRESSIVE_REVEAL_MAX_CHARS);
  const searchEnd = Math.min(pendingText.length, normalizedMax);
  const preferredEnd = Math.min(pendingText.length, normalizedPreferred);

  // 单次扫描,记录所有 boundary offset
  const boundaries: number[] = [];
  for (let i = 0; i < searchEnd; i++) {
    if (pendingText[i] === '\n') {
      // 跳过连续空白
      let j = i + 1;
      while (j < searchEnd && /\s/.test(pendingText[j])) j++;
      // 根据 j 后面字符判断 boundary 类型
      if (j < searchEnd) {
        const next = pendingText[j];
        if (next === '\n' || next === '#' || /[-*+\d> ]/.test(next)) {
          boundaries.push(j);
        }
      }
    }
  }

  // 找 >= preferredEnd 的第一个
  for (const b of boundaries) {
    if (b >= preferredEnd) return b;
  }
  // fallback 到 >= PROGRESSIVE_REVEAL_MIN_CHARS 的最后一个
  for (let i = boundaries.length - 1; i >= 0; i--) {
    if (boundaries[i] >= PROGRESSIVE_REVEAL_MIN_CHARS) return boundaries[i];
  }
  return preferredEnd;
}
```

#### Step 2:`resolveProgressiveRevealValue` 加 useMemo

`src/markdown/components/Markdown.tsx` 内，在 `Markdown` 组件里：

```ts
const progressiveValue = useMemo(() => {
  if (!progressiveReveal) return throttledValue;
  return resolveProgressiveRevealValue(
    progressiveBaseRef.current,
    throttledValue,
    resolvedProgressiveChunkChars,
  );
}, [progressiveReveal, throttledValue, resolvedProgressiveChunkChars]);
```

#### Step 3:保留短 pending 短路

当前 `src/markdown/runtime/LiveMarkdown.tsx` 已有 `resolveProgressiveRevealValue`；后续修复只需要补 regression，不要重复实现：

```ts
if (pendingText.length <= PROGRESSIVE_REVEAL_SMALL_PENDING_CHARS) {
  return targetValue;  // 直接返回,无 boundary 扫描
}
```

#### Step 4:按实测调整长 visible 节奏

当前 visible ≥ 3000 时约 42ms、visible ≥ 8000 时 56ms。只有在 profiler 证明 42ms 仍超 budget 时,才把 large-visible 档提升到 ≥ 56ms:

```ts
const finalStepMs = visibleLength > PROGRESSIVE_REVEAL_LARGE_VISIBLE_CHARS
  ? Math.max(adaptiveStepMs, 56)  // 至少 56ms
  : adaptiveStepMs;
```

### 6.4 验收

- 长 turn(8000+ 字符)流式期间,`Markdown` 组件的每秒重渲染次数 ≤ 18。
- `findProgressiveRevealBoundary` 8000 字符输入平均耗时 < 1ms(原 ≤ 3ms)。
- React DevTools Profiler:`Markdown` render duration 中位数 < 5ms。

### 6.5 回归测试

测试入口：`src/markdown/runtime/LiveMarkdown.test.tsx`。

```ts
it('short pending short-circuits', () => {
  expect(resolveProgressiveRevealValue('hello wo', 'hello world', 360))
    .toBe('hello world');
});

it('boundary finder scales linearly', () => {
  const long = 'a\n'.repeat(4000);
  const start = performance.now();
  findProgressiveRevealBoundary(long, 360, 3072);
  const elapsed = performance.now() - start;
  expect(elapsed).toBeLessThan(1);
});
```

---

## 7. 根因 4(handlers useMemo)修复

### 7.1 症状

`handlers` 引用频繁变化,`useAppServerEvents` 的 `handlersRef.current` 频繁更新,下游子模块因为 deps 变化频繁触发重渲染。

### 7.2 代码位置

- `src/features/threads/hooks/useThreadEventHandlers.ts:2651-2736` `handlers = useMemo(...)` 含 28 项 deps
- 多个 `onAgentMessageDeltaTracked` / `onItemStartedTracked` 等内部 useCallback

### 7.3 修复步骤

#### Step 1:拆 handlers 成 3 组

```ts
const streamingHandlers = useMemo(() => ({
  onAgentMessageDelta: onAgentMessageDeltaTracked,
  onAgentMessageCompleted: onAgentMessageCompletedTracked,
  onNormalizedRealtimeEvent: onNormalizedRealtimeEventTracked,
  onItemStarted: onItemStartedTracked,
  onItemUpdated: onItemUpdatedTracked,
  onItemCompleted: onItemCompletedTracked,
  onReasoningSummaryDelta,
  onReasoningSummaryBoundary,
  onReasoningTextDelta,
  onCommandOutputDelta: onCommandOutputDeltaTracked,
  onTerminalInteraction: onTerminalInteractionTracked,
  onFileChangeOutputDelta: onFileChangeOutputDeltaTracked,
}), [/* streaming-only deps */]);

const lifecycleHandlers = useMemo(() => ({
  onWorkspaceConnected,
  onThreadStarted,
  onTurnStarted: onTurnStartedTracked,
  onTurnCompleted: onTurnCompletedTracked,
  onTurnError: onTurnErrorTracked,
  onTurnStalled: onTurnStalledTracked,
  onContextCompacting,
  onContextCompacted,
  onContextCompactionFailed,
  onThreadSessionIdUpdated,
  onBackgroundThreadAction,
}), [/* lifecycle-only deps */]);

const diagnosticHandlers = useMemo(() => ({
  onAppServerEvent,
  onApprovalRequest,
  onRequestUserInput,
  onModeBlocked,
  onModeResolved,
  onProcessingHeartbeat,
  onTurnPlanUpdated,
  onThreadTokenUsageUpdated: onThreadTokenUsageUpdatedTracked,
  onAccountRateLimitsUpdated,
}), [/* diagnostic-only deps */]);
```

#### Step 2:稳定基础设施 callback 引用

用 `useRef` + `useEffect` 自定义 `useStableCallback`:

```ts
function useStableCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  return useCallback((...args: any[]) => ref.current(...args), []) as T;
}
```

把 `flushPendingRealtimeEvents` / `markRealtimeTurnTerminal` / `emitTurnDomainEvent` / `finalizeTurnDiagnostic` / `quarantineCodexTurn` 用 `useStableCallback` 包装。

#### Step 3:更新 `useAppServerEvents` 调用

`src/features/threads/hooks/useThreads.ts:2233`:

```ts
useAppServerEvents(
  { ...streamingHandlers, ...lifecycleHandlers, ...diagnosticHandlers },
  { useNormalizedRealtimeAdapters },
);
```

### 7.4 验收

- 30s 长 turn,`streamingHandlers` / `lifecycleHandlers` / `diagnosticHandlers` 各自 useMemo rebuild 次数 ≤ 5(原 `handlers` 20+)。
- React DevTools Profiler:无「handlers changed」引起的 re-render。
- `useAppServerEvents` 内部 `handlersRef.current` 每 turn 更新 ≤ 5 次。

### 7.5 回归测试

`src/features/threads/hooks/useThreadEventHandlers.test.ts` 新增:

```ts
it('handlers useMemo rebuilds ≤ 5 times per turn', () => {
  const renderCount = { streaming: 0, lifecycle: 0, diagnostic: 0 };
  // mock useThreads, 模拟 100 条 delta
  // 断言 renderCount.streaming / .lifecycle / .diagnostic 都 <= 5
});
```

---

## 8. 根因 5(Home/session 长列表未虚拟化)修复

### 8.1 症状

100+ session 的 workspace 切到 session 列表,瞬间主线程阻塞 200ms+;多 workspace 切换时,每次切换都触发整张表重投影。

### 8.2 代码位置

- `src/features/home/components/HomeChat.tsx`(recent conversation list / workspace picker 直接 `.map`,**未用 `useVirtualizer`**)
- `src/features/threads/hooks/useThreads.ts:2243` `Object.fromEntries(Object.keys(state.threadStatusById).map(...))`
- `src/features/threads/utils/threadPendingResolution.ts:43` 全量数组

### 8.3 修复步骤

#### Step 1:确认 `@tanstack/react-virtual` 已在依赖

```bash
npm ls @tanstack/react-virtual
```

如果没装:`npm i @tanstack/react-virtual`(项目里 `git-history` / `files` / `git diff viewer` / `MessagesTimeline` 都在用)。

#### Step 2:给实测超长 list surface 加 `useVirtualizer`

若瓶颈来自 `HomeChat.latestAgentRuns`,在 `src/features/home/components/HomeChat.tsx` 虚拟化 recent list；若来自 thread sidebar consumer,在对应 component 虚拟化 session list。示例:

```ts
import { useVirtualizer } from '@tanstack/react-virtual';

const parentRef = useRef<HTMLDivElement>(null);
const threads = useMemo(() => threadsByWorkspace[activeWorkspaceId] ?? [], [threadsByWorkspace, activeWorkspaceId]);

const rowVirtualizer = useVirtualizer({
  count: threads.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 48,  // 每个 session 节点 48px
  overscan: 5,
});

return (
  <div ref={parentRef} style={{ height: '100%', overflow: 'auto' }}>
    <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
      {rowVirtualizer.getVirtualItems().map(virtualItem => (
        <div
          key={virtualItem.key}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: virtualItem.size,
            transform: `translateY(${virtualItem.start}px)`,
          }}
        >
          <SessionItem thread={threads[virtualItem.index]} />
        </div>
      ))}
    </div>
  </div>
);
```

#### Step 3:`backgroundActivityByThread` 改懒计算

`src/features/threads/hooks/useThreads.ts:2243` 删掉全量 Object.fromEntries,改成单条 lookup:

```ts
function getBackgroundActivity(threadId: string) {
  return buildThreadBackgroundActivityProjection({
    threadId,
    status: state.threadStatusById[threadId],
    approvals: state.approvals,
  });
}
```

SessionItem 组件 `useMemo(() => getBackgroundActivity(thread.id), [thread.id, state.threadStatusById[thread.id]])`,只有当前可见的会算。

加 LRU cache:

```ts
const bgActivityCache = useRef(new Map<string, ReturnType<typeof buildThreadBackgroundActivityProjection>>());
const MAX_CACHE = 200;

function getCachedBackgroundActivity(threadId: string) {
  if (bgActivityCache.current.has(threadId)) {
    return bgActivityCache.current.get(threadId)!;
  }
  const value = getBackgroundActivity(threadId);
  bgActivityCache.current.set(threadId, value);
  if (bgActivityCache.current.size > MAX_CACHE) {
    const firstKey = bgActivityCache.current.keys().next().value;
    bgActivityCache.current.delete(firstKey);
  }
  return value;
}
```

#### Step 4:reducer 改 structural sharing

`src/features/threads/hooks/threadReducerNormalizedRealtime.ts:128-138`,在 `threadsByWorkspace` 变化时,只重建变化的 workspace:

```ts
// 旧
threadsByWorkspace: nextThreadsByWorkspace  // 整对象重建

// 新(用 immer 或手写)
if (changedWorkspaceIds.length === 1) {
  return {
    ...state.threadsByWorkspace,
    [changedWorkspaceIds[0]]: nextThreadsForThatWorkspace,
  };
}
return nextThreadsByWorkspace;
```

### 8.4 验收

- 100+ session workspace 切到 session 列表,首次渲染 < 50ms,滚动 60fps。
- 切 workspace 时 `backgroundActivityByThread` 重新计算次数 = 1(只算目标 workspace)。
- DevTools Elements:侧栏根元素 child count ≤ 20(200 session 时)。

### 8.5 回归测试

历史示例可迁移到当前 `src/features/home/components/Home.test.tsx` 或相关 virtualization suite：

```ts
it('renders ≤ 20 DOM nodes for 200 sessions', () => {
  const { container } = render(<Home threadsByWorkspace={{ ws: generateThreads(200) }} />);
  const sidebar = container.querySelector('[data-testid="session-list"]');
  expect(sidebar?.children.length).toBeLessThanOrEqual(25);  // 20 + overscan buffer
});

it('backgroundActivityByThread is lazy', () => {
  const calcSpy = vi.spyOn(buildThreadBackgroundActivityProjection, 'buildThreadBackgroundActivityProjection');
  render(<Home threadsByWorkspace={{ ws: generateThreads(200) }} />);
  // 只应计算当前可见的 ≤ 20 个
  expect(calcSpy).toHaveBeenCalledTimes(20);
});
```

---

## 9. 根因 7(timer 注册分散且缺 idle scheduling)修复

### 9.1 症状

5+ workspace 同时活跃,主线程 setTimeout 队列堆积,长 turn 期间输入响应延迟 100ms+。

### 9.2 代码位置

- `src/features/threads/hooks/useThreads.ts:1043 / 1113 / 1671 / 1909` 7+ 处 setTimeout

### 9.3 修复步骤

#### Step 1:统一 timer 注册表

```ts
const timerRegistryRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

function registerTimer(key: string, fn: () => void, delayMs: number) {
  // 清掉旧的
  const old = timerRegistryRef.current.get(key);
  if (old !== undefined) {
    clearTimeout(old);
  }
  // 调 idle callback
  if ('requestIdleCallback' in window) {
    const handle = (window as any).requestIdleCallback(fn, { timeout: delayMs });
    timerRegistryRef.current.set(key, handle as any);
  } else {
    const handle = setTimeout(fn, delayMs);
    timerRegistryRef.current.set(key, handle);
  }
}

function clearAllTimers() {
  for (const handle of timerRegistryRef.current.values()) {
    if ('requestIdleCallback' in window) {
      (window as any).cancelIdleCallback(handle);
    } else {
      clearTimeout(handle);
    }
  }
  timerRegistryRef.current.clear();
}

useEffect(() => {
  return () => clearAllTimers();
}, []);
```

#### Step 2:`lazyResume` 改单例合并

```ts
// 旧
lazyResumeTimerByWorkspaceRef.current[targetId] = setTimeout(...);

// 新
const key = `lazyResume:${targetId}`;
registerTimer(key, () => {
  // 内部遍历所有待 resume 的 session
  for (const session of pendingLazyResumeByWorkspace[targetId] ?? []) {
    doResume(session);
  }
  pendingLazyResumeByWorkspace[targetId] = [];
}, delayMs);

// 触发时,加入待办
function enqueueLazyResume(workspaceId: string, sessionId: string) {
  pendingLazyResumeByWorkspace[workspaceId] = pendingLazyResumeByWorkspace[workspaceId] ?? [];
  pendingLazyResumeByWorkspace[workspaceId].push(sessionId);
}
```

#### Step 3:`sharedSessionSync` 改 idle

```ts
registerTimer(`sharedSessionSync:${thread.id}`, doSync, delay);
```

#### Step 4:heartbeat / reconnect 加 jitter

```ts
const jitter = (Math.random() - 0.5) * 0.4;  // ±20%
const delayWithJitter = baseDelay * (1 + jitter);
```

### 9.4 验收

- 5 workspace 并行,主线程 setTimeout 队列 size < 20。
- 输入响应延迟 < 50ms(从 keydown 到 onChange 触发)。
- DevTools Performance:Timer Fire 事件密度 < 5/秒。

### 9.5 回归测试

历史示例可迁移到当前 `src/features/threads/hooks/useThreads.integration.test.tsx` 或更窄的 timer owner suite：

```ts
it('timer registry stays < 20 for 5 workspaces × 3 sessions', () => {
  const { result } = renderHook(() => useThreads({ ... }));
  // 模拟 5 workspace × 3 session 状态
  act(() => {
    for (let w = 0; w < 5; w++) {
      for (let s = 0; s < 3; s++) {
        result.current.enqueueLazyResume(`ws${w}`, `session${s}`);
      }
    }
  });
  // 断言 timer 注册表 size < 20
});
```

---

## 10. 根因 6（图片资源）历史修复设计

### 10.1 症状

长会话里 markdown 含大量图片,DevTools Memory heap snapshot 显示 `ImageBitmap` / `HTMLImageElement` 引用线性增长;切走再切回 session,内存不释放。

### 10.2 代码位置

- `src/services/mediaResourceOwners.ts`(只管 `URL.createObjectURL`)
- `src/components/common/LocalImage.tsx`（真实实现）
- `src/features/messages/components/media/LocalImage.tsx`（feature re-export）
- `src/markdown/components/Markdown.tsx`

### 10.3 修复步骤

#### Step 1:扩展 `mediaResourceOwners` 注册 `convertFileSrc`

```ts
// mediaResourceOwners.ts
const activeConvertFileSrcUrls = new Map<string, { url: string; ownerId: string }>();

export function trackConvertFileSrcUrl(url: string, ownerId: string) {
  activeConvertFileSrcUrls.set(url, { url, ownerId });
}

export function releaseConvertFileSrcUrl(url: string) {
  activeConvertFileSrcUrls.delete(url);
}
```

#### Step 2:`LocalImage` 加 IntersectionObserver

```tsx
import { useEffect, useRef } from 'react';

const imgRef = useRef<HTMLImageElement>(null);
const [inView, setInView] = useState(true);

useEffect(() => {
  const observer = new IntersectionObserver(
    ([entry]) => setInView(entry.isIntersecting),
    { rootMargin: '100px' },
  );
  if (imgRef.current) observer.observe(imgRef.current);
  return () => observer.disconnect();
}, []);

useEffect(() => {
  if (!imgRef.current) return;
  if (inView) {
    imgRef.current.src = convertFileSrc(filePath);
    trackConvertFileSrcUrl(imgRef.current.src, `${workspaceId}:${threadId}`);
  } else {
    releaseConvertFileSrcUrl(imgRef.current.src);
    imgRef.current.src = '';
  }
}, [inView, filePath, workspaceId, threadId]);
```

#### Step 3:workspace 切换时释放

```tsx
// 在 useThreads 中
useEffect(() => {
  return () => {
    if (imgRef.current) {
      releaseConvertFileSrcUrl(imgRef.current.src);
      imgRef.current.src = '';
    }
  };
}, [workspaceId]);
```

#### Step 4:convertFileSrc 加 cacheBust

```ts
const url = convertFileSrc(filePath) + `?cacheBust=${turnId}`;
```

### 10.4 验收

- 长跑 30 分钟后,DevTools heap 中 `ImageBitmap` / `HTMLImageElement` detached 数 < 50。
- 切走 workspace 30s 后,该 workspace 的图片资源全部释放。
- `getMediaOwnerDiagnostics()` 返回的 `activeObjectUrls` size < 100。

### 10.5 回归测试

测试入口：`src/features/messages/components/media/LocalImage.test.tsx`。

```ts
it('clears src when out of viewport', async () => {
  const { container } = render(<LocalImage filePath="/foo.png" />);
  // mock IntersectionObserver 触发 out
  await act(async () => {
    mockIntersectionObserver.trigger(false);
  });
  const img = container.querySelector('img');
  expect(img?.src).toBe('');
});
```

---

## 11. 实施顺序

按优先级与依赖关系,**严格**按这个顺序执行:

1. **§4 根因 2(P0)**:优化开关文档化 + `getActiveFlags` + Reset 按钮 + lazy read。1-2 天。
2. **§5 根因 1(P0)**:ClaudeSession Drop 兜底 + 汇总 diagnostics command + reconciler。3-5 天。
3. **§6 根因 3(P1)**:boundary finder 合并 + resolveProgressiveRevealValue useMemo + 短 pending 短路 + 长 visible 改 56ms。2-3 天。
4. **§8 根因 5(P1)**:实测超长 list surface useVirtualizer + backgroundActivityByThread 懒计算 + structural sharing。2-3 天。
5. **§7 根因 4(P2)**:handlers 拆 3 组 + 基础设施 callback 稳定化。2-3 天。
6. **§9 根因 7(P2)**:timer 注册表 + 单例合并 + idle callback + jitter。1-2 天。
7. **§10 根因 6(P2)**:convertFileSrc 跟踪 + IntersectionObserver + workspace 切换释放。2-3 天。

每个阶段完成后:

- 跑 `npm run typecheck` + `npm run lint` + `npm run test` 全套，确认无回归。
- 跑 §1 复现步骤,记录卡顿改善程度(切 workspace 响应时间 / 帧时间 / 内存)。
- 在 `docs/perf/jank-fix-progress.md` 记录本次修复的根因 + 数据 + 验收结果。

---

## 12. 验收基线

修复前(对照 §1 复现步骤):

| 指标 | 数值 |
|---|---|
| 切 workspace 响应 | 200ms+ |
| 帧时间 p95 | 50ms+ |
| 30 分钟 child 进程数 | 50+ |
| Heap 30 分钟增长 | 100MB+ |
| `ImageBitmap` detached 数 | 200+ |

修复后目标:

| 指标 | 数值 |
|---|---|
| 切 workspace 响应 | < 100ms |
| 帧时间 p95 | < 30ms |
| 30 分钟 child 进程数 | ≤ workspace × 2 |
| Heap 30 分钟增长 | < 30MB |
| `ImageBitmap` detached 数 | < 50 |

数据采集脚本:`scripts/perf-reproduce-jank.sh` + DevTools Performance + Memory heap snapshot。

---

## 13. 配套文档索引

- **历史修复 change**：`openspec/changes/archive/2026-06-14-fix-parallel-conversation-runtime-residuals-2026-06/`
  - `proposal.md` — 背景与变更范围
  - `design.md` — 根因分析与修复方案
  - `tasks.md` — 当时任务清单
  - `specs/parallel-conversation-runtime-residuals/spec.md` — 当时 delta contract
- **主线 OpenSpec spec**:`openspec/specs/parallel-conversation-runtime-residuals/spec.md`
- **Code-level rule**:`.trellis/spec/frontend/parallel-conversation-runtime-residuals.md`(沉淀)
- **复现脚本**:`scripts/perf-reproduce-jank.sh`
- **执行进度**:`docs/perf/jank-fix-progress.md`(边修边记)
- **修复提案归档**：`openspec/changes/archive/2026-06-14-fix-parallel-conversation-runtime-residuals-2026-06/`

---

## 14. FAQ

### Q:为什么不在本 change 直接改产品代码?

A：原调查只产诊断手册、修复契约与验收口径；P0 修复由已归档的 `fix-parallel-conversation-runtime-residuals-2026-06` 承接。后续问题必须重新立证，不能把 §6–§10 自动当未完成 backlog。

### Q:7 条根因都要修吗?

A:看症状。优先 P0(§4 + §5),这两条修了通常就能解决 60-80% 的卡顿。剩下按用户反馈按需推进。

### Q:如果修完后还有卡顿,怎么办?

A:1) 跑 §2 第一轮排查 5 步,确认没漏。2) 看 `docs/perf/jank-fix-progress.md` 历史记录,看是否有未根治的子症状。3) 在 `openspec/changes/` 起新的 change 处理新发现的根因。

### Q:这跟 `c27bb18a` 那些 P1 提案冲突吗?

A:不冲突。本手册是那些提案的**遗留问题清单** + **新发现的子问题**。`c27bb18a` / `7cc4a284` / `25d101a0` 已落地的优化在生产默认开,本手册的修复是处理「优化被关掉」、「子路径未覆盖」、「跨层叠加」等边缘 case。

### Q:Windows / Linux 上有差异吗?

A:有。Windows 的 WebView2 跟 macOS WebKit 行为差异大,主要是 §10 图片资源释放和 §5 child 进程回收(`taskkill` vs `killpg`)的路径要分别测。建议在三个平台都跑 §1 复现 + §12 验收基线。
