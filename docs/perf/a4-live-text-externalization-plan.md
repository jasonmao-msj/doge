# A4 实施方案：流式正文 live-text 外部化（delta 不进根 reducer）

> 日期：2026-07-08
> 前置：`docs/perf/render-jank-knife-experiments-2026-07-08.md`（四层病因诊断，本方案治层 2）
> 内容类型：Implementation Plan + historical evidence
> 生命周期：implemented；2026-07-30 由 `1537211a1` 继续演进
> 状态：**已实施 + 人工验收通过；flag `liveTextExternalization` 默认开启**
> 最后校准：2026-08-01 · mossx `0.7.14` · HEAD `26f8065a0c`
> 侦察方式：2 个并行 Explore agent + 人工核验，所有事实均带 文件:行号
>
> **实施落点**：通道 `utils/liveAssistantTextChannel.ts`、hook `hooks/useLiveAssistantText.ts`、flag `liveTextExternalization`、写入/settle/drain/rename/evict 生命周期，以及 `rows/components/MessageRow.tsx` 渲染换源。
> **回退方式**：devtools console 执行 `localStorage.setItem("ccgui.perf.liveTextExternalization", "0")` 后**刷新**；删除该 key 恢复默认（开）。

---

## 0. 2026-08-01 演进增量

原方案的「delta 不进根 reducer」合同未变；`1537211a1` 在 store → React 边界补上单一发布节奏：

| 原设计 | 当前实现 |
|--------|----------|
| accumulated entry 同时作为 React snapshot | `entriesByThread` 与 `publishedEntriesByThread` 分离 |
| 每次 append 同步 notify | 首段立即；后续每 thread 48ms throttle + 单个 trailing timer |
| entry 只有 item/text/version | 增加 `shellTextLength`，terminal/interruption 只 drain 未落 reducer 的尾段 |
| channel 文本继续经过 deferred | channel-backed `MessageRow` 直接消费 published text；非 channel 路径保留 `useDeferredValue` |
| Markdown scheduled update 使用 transition | bounded timer 保留，`startTransition` 已移除 |

这一增量同时守住两个边界：accumulated text 无损，React publish 有界。48ms 是 publish cadence，不是浏览器 paint SLA。

## 一、目标与量化预期

**问题**：对话流式期间，每条正文 delta 经 32ms 批处理 dispatch 进根 reducer 换引用 → AppShell（2500 行 hook 链）全树重渲染，每秒 5~10+ 次 × 单次端到端 100~350ms → 主线程被吃掉大半（层 2 病因）。

**目标**：流式期间正文 delta **完全不触发根渲染**，只让正在流式的那一行 `MessageRow` 小树更新。

**量化验收**：
- 对话流式中 AppShell 根渲染：**每回合 ≤3 次**（首 delta 建壳 1 次 + completed 落地 1 次 + status 类合法变更）——对比现状每回合几十~上百次；
- 对话流式中 FPS ≥ 55（复测方法见实验报告 §七）；
- 正文渲染与 flag 关闭时逐字节一致（无缺字/乱序/重复）。

---

## 二、核心设计（三段式生命周期）

```
现状:  每条 delta → dispatch(appendAgentDelta) → reducer 换引用 → AppShell 全树渲染
                                                                    ↓
                                     Messages → liveAssistantItem → resolveLiveRenderItem
                                              → MessageRow(item.text)

方案:  首条 delta ──→ dispatch 照旧（reducer 建壳,壳带首段文本）→ 1 次根渲染,气泡出现
       后续 delta ──→ 只写 liveAssistantTextChannel + notify ──→ 仅订阅的 MessageRow 重渲染
       completed  ──→ dispatch flushAgentCompletedBatch(全量终稿) → 1 次根渲染
                      └→ settleLiveText 清通道 + notify → 该行切回读 item.text(终稿)
```

### 2.1 关键机制依据（侦察确认的事实）

| # | 事实 | 依据 | 对方案的意义 |
|---|---|---|---|
| 1 | 气泡壳由首条 delta 在 reducer 建（`index < 0` 分支） | `useThreadsReducer.ts:1201-1330` | 首 delta 照旧 dispatch = 建壳，一次合法根渲染 |
| 2 | completed 事件自带**完整终稿文本**，`flushAgentCompletedBatch(text)` 全量落地；`mergeCompletedAgentText(existing, completed)` 在 existing 为空/前缀时正确合并 | `useThreadItemEvents.ts:1529-1538`、`threadReducerTextMerge.ts:976-987`、`useThreadsReducer.ts:2713-2717` | settle 不依赖流式期间 reducer 累计文本 |
| 3 | MessageRow 取文本仍收敛在 displayText 分支；channel-backed 行绕过重复 deferred | `rows/components/MessageRow.tsx` | 渲染侧改动保持单点 |
| 4 | 流式判定 = `renderItem.id === liveAssistantMessageId`（+ `meta.isThinking`），**不依赖文本增长** | `MessagesTimeline.tsx:1563-1570`、`Messages.tsx:1099-1103` | 壳文本冻结不影响「哪行在流式」的判定 |
| 5 | MessageRow memo 比较器逐字段比 `item.text` | `MessagesRows.tsx:302-322,328-371` | 壳文本不变 → props 永不放行 → 渲染完全由新订阅驱动，天然隔离 |
| 6 | 每线程同时只有**一个**活跃流式正文（`liveAssistantMessageId` 是单值） | `Messages.tsx:1082-1103` | 通道可按 threadId 建模（规避 id canonicalize 风险，见 §2.3） |
| 7 | 影子转录（shadow transcript）独立累计全量文本 + 1s 落盘 + 断流恢复 | `liveAssistantShadowTranscript.ts:282,337,396` | 持久化/恢复兜底**不动**，与新通道并行写入 |
| 8 | `lastAgentMessageByThread` 只在 completed 时更新 | `useThreadItemEvents.ts:717,728-733` | 侧栏最后消息预览不受影响 |

### 2.2 新模块：`liveAssistantTextChannel`

`src/features/threads/utils/liveAssistantTextChannel.ts`（纯内存，无持久化——持久化由影子转录负责）：

```ts
type LiveAssistantTextEntry = {
  itemId: string;
  text: string;
  version: number;
  shellTextLength: number;
};
// authoritative accumulated state 与 React-visible published snapshot 分离
const entriesByThread = new Map<string, LiveAssistantTextEntry>();
const publishedEntriesByThread = new Map<string, LiveAssistantTextEntry>();
const listenersByThread = new Map<string, Set<() => void>>();

export function appendLiveAssistantText(
  threadId: string, itemId: string, delta: string,
): { isFirst: boolean };                                  // itemId 变化(分段/新回合)视同 isFirst 并重置条目
export function settleLiveAssistantText(threadId: string, itemId?: string): void;  // 清除+notify
export function renameLiveAssistantTextThread(oldThreadId: string, newThreadId: string): void;
export function clearLiveAssistantTextForThread(threadId: string): void;
export function getLiveAssistantTextSnapshot(threadId: string): LiveAssistantTextEntry | null;
export function subscribeLiveAssistantText(threadId: string, cb: () => void): () => void;

// React 侧（可放同文件或 hooks/useLiveAssistantText.ts）
export function useLiveAssistantText(threadId: string | null, enabled: boolean): LiveAssistantTextEntry | null;
// 实现：useSyncExternalStore；enabled=false 或 threadId=null 时订阅空 store 恒返回 null
```

设计要点：
- **按 threadId 订阅而非 itemId**：reducer 建壳时会把 id canonicalize/分段（`resolveLiveAssistantMessageId`，`useThreadsReducer.ts:1202-1222`），事件层 itemId 与壳 item.id 可能不一致——按线程订阅 + 「是否用它」交给已有的 `isStreaming` prop 判定，彻底绕开 id 映射问题；
- `version` 单调递增作为 `useSyncExternalStore` 的 snapshot 比较基础（text 引用即可，version 供调试）；
- publish 采用 `LIVE_ASSISTANT_TEXT_PUBLISH_INTERVAL_MS = 48`：首段立即，后续 throttle + trailing；terminal/drain 始终读取 accumulated entry。

### 2.3 写入改道（`useThreadItemEvents.onAgentMessageDelta`，`useThreadItemEvents.ts:1428-1487`）

flag 开启时：

```ts
appendLiveAssistantShadowDelta(...);           // 照旧（持久化/恢复兜底）
const { isFirst } = appendLiveAssistantText(threadId, itemId, resolvedDelta);
if (isFirst || !isLiveTextExternalizationEnabled()) {
  enqueueRealtimeDeltaOperation({ kind: "agentDelta", ... });  // 建壳或旧路径
}
// 非首条且 flag 开：不 enqueue、不 dispatch —— 零根渲染
```

- `isFirst` 判定 = 通道内该线程无条目或 itemId 变化（覆盖新回合、分段切换、text-alias 合成 id 等场景，每次 id 变化都会建一次壳，语义与现状一致）；
- reasoning delta / toolOutput delta **一期不动**（照旧 dispatch）：它们写不同字段（`summary/content/output`，消费点分散在多个 tool block），且频率低于正文——二期再评估。

### 2.4 渲染接入（`MessageRow.tsx` 单点）

```ts
// MessageRow 内（约 :819 displayText 计算之前）
const liveEntry = useLiveAssistantText(
  threadId,
  isStreaming && item.role === "assistant" && isLiveTextExternalizationEnabled(),
);
// displayText 的 assistant 分支（:829）换源：
//   原:  item.text
//   新:  liveEntry && isStreaming ? mergeShellWithLive(item.text, liveEntry.text) : item.text
```

- `mergeShellWithLive`：壳文本（首段）与通道累计文本的拼接语义——**通道从首条 delta 起全量累计**（首条也写通道），所以直接用 `liveEntry.text` 即可，无需拼接（壳文本是通道文本的前缀）。保留函数名位仅为测试锚点；
- channel-backed 行直接使用 published text，避免高频输入反复重启 `useDeferredValue`；非 channel 行保留 deferred 策略；
- MessageRow 若缺 `threadId` prop 则补传（Messages/MessagesTimeline 作用域内现成）。

### 2.5 settle 与清理

| 时机 | 动作 | 位置 |
|---|---|---|
| completed | dispatch `flushAgentCompletedBatch`（照旧，全量终稿）→ **然后** `settleLiveAssistantText(threadId)`；同一事件循环内 React 合并为一次提交，行切回 `item.text`（终稿）无闪烁 | `useThreadItemEvents.ts:1488-1555` |
| 中断（interrupt） | `clearLiveAssistantTextForThread(threadId)`；断流文本由影子转录恢复机制兜底（`recoveredFromLiveShadow`，现状已有） | interruptedThreads 标记处 |
| 会话 id 迁移（pending→canonical） | `renameLiveAssistantTextThread(old, new)` | `renameThreadId` dispatch 处 |
| 会话删除/驱逐 | `clearLiveAssistantTextForThread` | removeThread / evictThreadItems 调用侧 |
| turn/started（新回合） | 无需显式处理——新 itemId 首条 delta 自动重置条目 | — |

### 2.6 灰度开关

`realtimePerfFlags.ts` 按既有模式新增（改 3 处：id 数组 `:9-18`、定义数组 `:38-87`、读取函数）：

```
id: "liveTextExternalization"
defaultValue: false          // 上线默认关,行为与现状完全一致
testDefaultValue: false      // 存量测试零影响
```

验证达标后翻 `defaultValue: true`；出问题 localStorage 一键回退（`ccgui.perf.liveTextExternalization`）。

---

## 三、已知降级与风险清单（侦察实测的消费面）

### 3.1 一期接受的降级（流式期间读 `items` 活跃文本的外围消费者）

| 消费者 | 位置 | 降级表现 | 严重度 |
|---|---|---|---|
| 会话雷达 LIVE 预览 | `useSessionRadarFeed.ts:213-215` | 流式中预览文本冻结在首段（有 user message 时显示用户文本，无感） | 低 |
| 看板卡片运行摘要 `latestOutputSummary` | `taskRunTelemetry.ts:150-194`、`useAppShellKanbanExecutionSection.ts:1537-1550` | 流式中摘要冻结在首段，回合结束更新；`running/planning` 判定依赖「有无可读输出」——壳带首段文本，判定不受影响 | 低 |
| 流式中手动「复制对话」 | `useCopyThread.ts:11-30` | 复制结果缺活跃段的后续文本（仅首段） | 低（低频操作） |
| 无 user message 线程的自动命名 | `threadReducerThreadNaming.ts:100-147`（appendAgentDelta 内调用） | 命名延迟到回合结束（settle 路径同样触发命名） | 低 |

二期可让前三者改读 `getLiveAssistantTextSnapshot(threadId)` 消除降级。

### 3.2 技术风险与对策

| 风险 | 对策 |
|---|---|
| reducer 建壳 id ≠ 事件 itemId（canonicalize/分段） | 通道按 threadId 建模（§2.2 设计要点），「是否用通道文本」由既有 `isStreaming` prop 判定 |
| settle 合并边界：壳=首段 + completed=终稿 | `mergeCompletedAgentText` 现有语义已覆盖（existing 为前缀 → 用终稿）；补单测锁定 |
| completed 事件丢失（断流） | 影子转录恢复机制照旧兜底（本方案不触碰该链路） |
| Codex 去重逻辑 `findEquivalentCodexAssistantMessageIndex`（`useThreadsReducer.ts:1228-1230`）依赖 delta 文本 | 该逻辑只在建壳时（index<0）参与——首条 delta 照旧 dispatch，语义保留 |
| 流式测试矩阵（`Messages.live-markdown-streaming` 等十余个）| flag testDefault=false → 存量测试零改动；新增 flag-on 镜像用例覆盖核心流式场景 |

---

## 四、分阶段实施（3 个 PR）

| PR | 内容 | 风险 | 验证 |
|---|---|---|---|
| **PR1** | 通道模块 + flag + 写入改道（含 rename/interrupt/evict 清理挂钩） | 零（flag 关 = 行为不变；通道多写一份内存数据无害） | 通道单测（append/settle/subscribe/rename/isFirst 语义）+ `useThreadItemEvents` flag 开关分支单测 + 全量既有测试 |
| **PR2** | MessageRow 换源接入 + flag-on 镜像测试 + settle 合并边界单测 | 中（渲染正确性） | flag-on 跑流式测试矩阵；人工对照 flag 开/关的渲染一致性 |
| **PR3**（验收后） | flag 默认开；二期评估：雷达/看板/复制读通道、reasoning/toolOutput 外部化 | — | 探针面板复测（实验报告 §七方法）：根渲染 ≤3 次/回合、FPS ≥55 |

预估改动量：PR1 ≈ 150~200 行（含测试），PR2 ≈ 80~120 行（含测试）。

---

## 五、验收方法（复用排查期探针）

按 `render-jank-knife-experiments-2026-07-08.md` §七复现指南装回三件套（AppShell 渲染计数 + 卡滞探针 + 面板），场景「前台对话流式中」对比：

| 指标 | flag 关（现状） | flag 开（目标） |
|---|---|---|
| AppShell 根渲染 / 回合 | 几十~上百次 | ≤3 次 |
| 主线程卡滞（10s 窗口） | ~10% | 显著下降（剩余为层 4 单价 × 极低频率） |
| FPS（流式中） | 45~50 | ≥55 |
| 正文渲染结果 | 基准 | 与基准逐字节一致 |
