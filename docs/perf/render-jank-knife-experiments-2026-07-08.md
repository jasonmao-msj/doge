# 对话卡顿根因排查：删除法实验 + 归因探针全记录

> 日期：2026-07-07 ~ 2026-07-08
> 分支：`feat/ui-refactoring`
> 方法：逐层「删除法」二分（8 把刀）+ 6 类归因探针（数据直接渲染到界面面板）
> 状态：**四层病因实锤；A1~A4 修复全部落地 + 人工验收通过（2026-07-08「性能非常明显好转，大幅优化卡顿」）**；层 4 单价手术留待 B 阶段
> 最后校准：2026-08-01；A4 后续增加 48ms publish cadence、row deferred bypass 与 terminal causal ordering（`1537211a1`）

## 交付结果（2026-07-08 验收）

| 修复 | 治的层 | 手段 | 状态 |
|---|---|---|---|
| A1 | 层 1 | `useDebugLog` 面板关闭时日志进内存缓冲不写 state | ✅ 落地 |
| A2 | 层 3 | 两个任务 store 改「写入即广播 CustomEvent」+ 30s 兜底轮询 | ✅ 落地 |
| A3 | 层 3 | git 刷新从「每次消息活动」改「回合结束（isProcessing 下降沿）」 | ✅ 落地 |
| A4 | 层 2 | 流式正文 delta 走 `liveAssistantTextChannel`，每回合根渲染 几十~上百次 → 2 次；flag `liveTextExternalization` 默认开 | ✅ 落地，方案见 `a4-live-text-externalization-plan.md` |

实测：FPS 39 → 55~58；后台 Agent 场景「对话关了还在渲」已消除；前台流式手感大幅改善。**红线规则已固化进 `.claude/CLAUDE.md` 和 `AGENTS.md`。**

---

## 一、TL;DR 终极诊断

**原始主诉**：对话过程中页面整体卡顿；对话关闭、仅后台运行时也大量重绘重排（react-scan 全树 ×8~×22，FPS 39）。

| 层 | 病因 | 证据 | 状态 |
|---|---|---|---|
| 1 | **Debug 日志系统**：`useDebugLog.addDebugEntry` 的 `setDebugEntries([...prev, entry])` 挂在 AppShell 根，每条引擎日志（`thread/session:`、`turn/start`、`reasoning/raw:`、stderr、warn）= 一次根渲染。数组 append 型 setState 结构上不可能有 same-value 守卫。前后台线程通吃 → 解释「对话关了也在渲」 | 面板 `client-store-write: diagnostics.threadSessionLog` 1Hz 与写它的同一函数内的 setState 对上 | 刀 7 验证 → **A1 已根治 ✅** |
| 2 | **引擎事件 → threads reducer 高频换引用**：流式 delta / upsertItem / 心跳 / token / 时间戳等 action 曾每秒多次换 state 引用 → AppShell 全树重渲染 | 刀 1+2 后渲染 ×8~×22 → ×1~×3，FPS 39→57 | 刀 1/2/4 验证；**A4 已外部化正文，后续补 48ms publish cadence** |
| 3 | **轮询双胞胎 + git 链**：`useTaskRunStore` 与 `useOrchestrationTaskStore`（同构，各 2s 轮询 localStorage + stringify 比较）挂在根链，Agent 任务运行中数据必变 → 每 2s 打根；`queueGitStatusRefresh`（消息活动 500ms 防抖）+ `useGitStatus` 15s 轮询，Agent 改文件时 git status 必变 → 打根 | timer 归因榜 + 触发者归因 | 刀 3/5/6 验证 → **A2/A3 已根治 ✅** |
| 4 | **单次根渲染端到端成本 100~350ms**（结构病）：react-commit 仅占 ~15%（10~40ms），**其余 85% 在 passive effects + 样式重算 + 布局绘制**。残余合法触发（`setActiveTurnId`/`markProcessing`/`renameThreadId` 等回合生命周期）× 高单价 = 剩余卡滞 | 「根渲染端到端成本」探针 vs `react-commit` hotspot 对照；更新发起者榜 `AppShell×45/67s` ≈ reducer 合法变化数 | 待 B 阶段手术 |

**旁支结论**：
- `Tooltip×354`（Radix）= **启动期一次性挂载风暴**：两轮独立会话计数完全相同（354=354）且鼠标移出后零增长 → 非持续源，但说明 tooltip 密度过高（启动优化点）。
- blank-screen watchdog（1.5s 强制 reflow）真实存在但**非卡滞主力**（刀 8 停用后卡滞无明显变化）。
- react-scan 是**放大器**（历史结论 2~3x），测量时必须关闭；关闭后卡滞仍在 → 非主犯。
- **事件洪水/IPC 被证无罪**：reducer 静默后 10s 仅 5~14 次 flush、个位数操作。

---

## 二、方法论

### 2.1 删除法（刀）

临时禁用一个子系统，观察症状是否消失。要点：

- **一次一刀**，每刀前先侦察代码确认「刀口干净」（不误伤伴生路径）；
- 下刀前预判「预期牺牲」（功能表现变化 = 刀生效的标志，防止误判成 bug）；
- 每刀写明还原方式，注释统一带 `临时性能排查·刀N` 标记。

### 2.2 归因探针（面板）

核心洞察：**用户的工作流是截图，就把归因数据渲染到他必然截到的地方**（JSON 探针页顶部红色面板，每秒自刷新）。演进出的探针：

| 探针 | 原理 | 回答的问题 |
|---|---|---|
| AppShell 根渲染计数 | 函数体内计数 + console.log | 根渲染真实频率 |
| reducer 换引用榜 | wrapper 包住 `threadReducer`，`next !== state` 时按 action 计数 | 哪个 action 在打根（threads 侧） |
| 主线程卡滞 | **event loop lag 采样**（50ms 心跳的期望 vs 实际间隔差）。WKWebView 无 `longtask` PerformanceObserver，此法全平台等价 | 把体感的「卡」量化成 ms |
| 卡滞归因 | 卡滞样本 ±120ms 时间相关性（伴随根渲染 / flush / reducer / 无关联） | 卡滞是谁造成的 |
| 根渲染端到端成本 | T0=根函数体执行，T1=`setTimeout(0)` 回调（render→commit→layout effects→paint→passive effects 排空）；配触发者归因（前 100ms 内 reducer/flush/其他state） | 单次渲染的真实阻塞时长 + React 内外占比 |
| 事件到达时间线 | `services/events.ts` 的 `deliverEvent` 统一分发点插桩，`message.method` 精化（JSON-RPC 风格，注意**不是** `message.type`） | 哪类业务事件伴随渲染 |
| timer 归因补丁 | monkey-patch `setInterval`/`setTimeout`，包装回调记录**创建位置调用栈**；渲染回看前 100ms 内 fire 过的 timer | 「无事件」渲染的内部定时器源（直接打印源文件名） |
| **React 更新发起者追踪（终极武器）** | `main.tsx` 在 React 加载前装最小 `__REACT_DEVTOOLS_GLOBAL_HOOK__` stub（激活 dev 的 enableUpdaterTracking），包装 `onCommitFiberRoot` 读 `root.memoizedUpdaters` → 发起 setState 的**组件名** | React 亲口作证「谁发起了这次更新」，零猜测 |

### 2.3 面板样例（终态）

```
[probe-stats] 运行=67s  AppShell根渲染=168次  最近一次根渲染=1.2s前
主线程卡滞(近10s): 总计1209ms(12%)  次数=8  最大单次=262ms
卡滞归因: 伴随根渲染=7  伴随事件flush(无渲染)=0  伴随reducer(无渲染)=0  完全无关联=1
根渲染端到端成本(近10s): 26次/1100ms  最大单次=311ms  触发者: 其他state×18 flush×8
更新发起者榜(累计·组件名): Tooltip×354  ProbeStatsTicker×49  AppShell×45  ScrollArea×26 ...
渲染前事件榜(累计): (无事件·纯内部state)×104  ...:item/agentMessage/delta×42  ...
渲染前timer榜(累计): timeout@unknown(0ms)×141  timeout@useRenderScheduler.ts(0ms)×58  ...
事件洪水(近10s): flush=8次  操作=8条
热路径耗时榜(近10s): react-commit: 10次/178ms(单次峰值30ms)  |  client-store-write: ...
reducer换引用榜: setActiveTurnId×8  renameThreadId×6  markProcessing×4  ...
```

---

## 三、八把刀清单（实验期临时改动，现已全部还原）

| 刀 | 内容 | 文件 | 结果 |
|---|---|---|---|
| 0 | **JSON 探针**：对话画布 GUI 树整棵替换为纯 JSON 渲染（`Messages`/`MessageForkConfirmDialog` 降级为 `import type`）；数据订阅路径原样保留 | `conversationCanvasNode.tsx` | JSON 模式仍卡 → **GUI 树洗清** |
| 1 | reducer 入口丢弃 5 种流式文本 delta action，`return state` 不换引用 | `useThreadsReducer.ts` | 稍有好转，仍有全树渲染 |
| 2 | 丢弃面扩到 **37 种**引擎事件驱动 action，白名单只留用户交互/导航/历史加载/审批 | 同上 | 渲染 ×8~×22 → ×1~×3，FPS 39→57，**层 2 实锤** |
| 3 | 停用 `useTaskRunStore` 2s 轮询（`{ refreshIntervalMs: 0 }`，两处调用） | `useLayoutNodes.tsx`、`WorkspaceHome.tsx` | 部分有效（漏了双胞胎） |
| 4 | 丢弃集合追加 `markUnread`（reducer 分支无 same-value 守卫） | `useThreadsReducer.ts` | 辅助刀 |
| 5 | 停用 `useOrchestrationTaskStore` 2s 轮询（与刀 3 同构双胞胎） | `useLayoutNodes.tsx` | 配合刀 3 击毙轮询层 |
| 6 | 断开 git 链两个入口：`onMessageActivity → undefined`；`useGitStatus` 15s 轮询 → 天文数字 | `app-shell.tsx`、`useGitStatus.ts` | 单独看无明显变化（机制真实，已转正 A3） |
| 7 | **debug 日志不再写 React state**：`addDebugEntry` 在 setState 前直接 `return`（磁盘持久化保留） | `useDebugLog.ts` | 卡滞 982→642ms、react-commit 峰值 40→21ms，**层 1 实锤** |
| 8 | 停用 blank-screen watchdog（每 1.5s 强制 reflow） | `bootstrapApp.tsx` | 卡滞无明显变化 → **非主力，还原** |

---

## 四、实验时间线与推理链（复现路径）

1. **JSON 探针（刀 0）**：GUI 整棵摘除仍卡 → 排除渲染表现层 → 数据层。
2. **刀 1（丢 delta）**：稍好仍卡 → delta 之外还有打根源。
3. **react-scan 截图对比**：后台运行也全树渲染 → 「后台任务渲染风暴」独立病灶；侦察排除 `markProcessing`（有 noop 守卫）、`queueGitStatusRefresh`（500ms trailing debounce 在流式密集期永不触发——**此结论后来反转**，见教训 5）。
4. **刀 2（37 种全静默）**：×8~×22 → ×1~×3、FPS 39→57 → 层 2 实锤；残余 ×1~×3。
5. **刀 3（taskRun 轮询）**：数据吻合（2s 节奏）但无改善 → 发现**双胞胎** `useOrchestrationTaskStore`。
6. **归因面板 v1**（渲染计数 + reducer 榜）：`172s/162次 ≈ 1Hz`，reducer 榜仅 34 次低频合法操作 → **根渲染大头不走 threads reducer**。
7. **刀 5 + 刀 4**：仍有渲染 → 继续。
8. **卡滞探针 + 归因**：`卡滞 10/10 全部伴随根渲染`、事件洪水 10s 仅 7 条 → **不是渲染次数多，是单次渲染贵**（86~200ms）。
9. **热路径榜接入**：`react-commit 仅 181ms vs 卡滞 695ms` → **~75% 成本在 React 渲染管线之外**。
10. **端到端成本探针 + 触发者归因**：触发者 `其他state×13 flush×8`、**reducer×0** → 白名单 reducer 洗清，另有隐藏 setState。
11. **刀 6（git 链）**：无明显变化。
12. **刀 7（debug 日志）**：有效（层 1 击毙）但仍有残余。
13. **事件榜 + timer 补丁**：`method` 精化后 `item/agentMessage/delta×56` 伴随（300ms 宽窗口假相关，后收紧 100ms）；timer 榜点名 `useRenderScheduler.ts`（事件批分块调度）与 watchdog（81% 重合率）。
14. **刀 8（watchdog）**：无明显变化 → 非主力。
15. **React 更新发起者追踪（终极）**：`Tooltip×354`（启动一次性，跨会话计数相同证明）、`AppShell×45/67s ≈ reducer 合法变化数` → **触发侧已压到合法下限，残余问题 = 层 4 单价**。结案。

---

## 五、关键陷阱与教训（复现时必读）

1. **react-scan 必须关闭再测**：2~3x 放大器；其 DevTools hook 与 updater 探针有交互。
2. **宽时间窗口制造假相关**：事件榜 300ms 回看窗口下「delta×56 伴随渲染」是假因果（流式期间 delta 连续到达）；收紧到 100ms 才可信。**判定「伴随 vs 因果」永远用最窄窗口。**
3. **跨会话计数对比可判定「一次性 vs 持续」**：Tooltip 两轮独立会话都是 ×354 → 启动一次性；持续源计数随运行时长增长（ProbeStatsTicker×49≈运行秒数）。
4. **StrictMode 双跑**：dev 下 AppShell 函数体执行次数 ≈ 真实 commit ×2；`memoizedUpdaters` 与函数体计数口径不同，对账时注意。
5. **防抖在负载变化后行为反转**：`queueGitStatusRefresh` 的 500ms trailing debounce 在流式密集期永不执行（每 32ms 被重置）→ 早期洗清；刀 1/2 把事件流变稀疏后**防抖每次都会真的到期执行** → 早期结论作废。**任何「因频率而无害」的结论在改变频率的刀落下后必须重新审。**
6. **WKWebView 无 `longtask`**：用 event loop lag 采样（50ms 心跳偏差）等价替代；lag 探针自身的 interval 要用 patch 前的原始 `setInterval`，否则污染 timer 归因榜。
7. **`message.method` 不是 `message.type`**：本项目 app-server-event 是 JSON-RPC 风格，事件类型在 `message.method`。
8. **数组 append 型 setState 无法有守卫**：`setXxx(prev => [...prev, item])` 每次必换引用——排查「谁在打根」时这类 state 最先查（层 1 正是此类）。
9. **updater 追踪的前置条件**：`root.memoizedUpdaters` 只在 react-dom **模块加载时** `__REACT_DEVTOOLS_GLOBAL_HOOK__` 已存在才填充 → stub 必须装在 `main.tsx` 最顶部，且改后必须**彻底重启 dev**（HMR 不够）。

---

## 六、正式修复方案与落地状态

### A. 把刀转正

1. **A1 ✅（2026-07-08 已落地）**：`useDebugLog.addDebugEntry` —— 面板关闭时条目进内存缓冲（有界 `MAX_DEBUG_ENTRIES`）不写 state；打开面板时缓冲一次性灌入；`setHasDebugAlerts(true)` 保留（boolean same-value bailout 天然守卫，红点功能不丢）；`clearDebugEntries` 同步清缓冲防回灌。磁盘持久化（threadSessionLog/clientErrorLog）零改动。守护测试 2 个。
2. **A2 ✅（2026-07-08 已落地）**：`saveTaskRunStore` / `saveOrchestrationTaskStore` **写入即广播** CustomEvent（`ccgui:task-run-store-updated` / `ccgui:orchestration-task-store-updated`）；两个 hook 监听事件即时刷新（同 webview 零延迟），轮询从 2s 降为 **30s 兜底**（跨窗口/异常路径，且有内容比较守卫）。守护测试 1 个。
3. **A3 ✅（2026-07-08 已落地）**：移除 `onMessageActivity: queueGitStatusRefresh`（高频消息活动链拆除）；app-shell 观察 `threadStatusById` 的 **isProcessing 下降沿**（任一线程回合结束）→ `queueGitStatusRefresh()`（仍有 500ms 防抖合并）；外部 git 变化由 `useGitStatus` 15s 轮询兜底（有内容守卫）。
4. **A4 ✅（2026-07-08 已落地，2026-07-30 加固）**：流式正文 delta 进入 `liveAssistantTextChannel` + `useSyncExternalStore` 细粒度订阅，不再持续经过 AppShell 根 reducer。后续实现把 accumulated / published 分离，以 48ms cadence 通知 React，并让 channel-backed row 绕过重复 deferred。

### B. 治单价（层 4 结构手术，未做）

- 目标：单次根渲染端到端 100~350ms → <30ms。
- 第一步：Safari Web Inspector Timelines 录制「回合进行中」，定位 React 外 85% 成本构成（style recalc / layout / passive effects 占比）；
- 候选：AppShell 分域拆解、passive effects 审计、Tooltip 密度治理（354 实例）。

### C. 实验设施还原状态

**已全部还原/删除（2026-07-08）**：8 把刀、JSON 探针、`perfProbeStats.ts`、main.tsx stub、events.ts 插桩、reducer wrapper、AppShell log、flush 计数、ProbeStatsTicker。全项目搜 `临时性能排查` 零命中。

---

## 七、性能对比（实测数据）

| 指标 | 排查前（原始） | 全刀实验极限（功能残缺） | A1~A3 落地后（本次交付） |
|---|---|---|---|
| react-scan FPS（对话+后台 Agent） | **39** | 57~58 | 2026-07-08 验收显著改善；当前数值须重新测量 |
| 全树渲染次数（react-scan 观察窗口） | ×8~×22 | ×1~×3 | 后台场景预期 ×1 级 |
| AppShell 根渲染频率 | 多源叠加 ≈4~8 次/s | 0.7 次/s（合法下限） | 正文 A4 已外置；当前频率须重新测量 |
| 主线程卡滞（10s 窗口） | 未测（推算 40%+） | 6~11%（≈600~1100ms） | 待统一测试实测 |
| 后台 Agent 打根源 | 日志 1~3Hz + 轮询 2s×2 + git 链 + 事件 | 全静默 | **全部根治**（日志缓冲/事件驱动/回合级 git） |

**如何统一测试**（无探针状态下）：先关闭 react-scan 做正式测量；需要归因时再开，并记录其 2–3x 放大效应。分三个场景对比：①空闲 ②后台 Agent 运行+对话关闭 ③前台对话流式中。场景③若仍顿挫，先按 source/publish/render/paint 分层，不再默认归因于未完成的 A4。

---

## 八、本次实验的面板数据存档（关键轮次）

```
# 刀2+3 后（首页，Agent 运行中）
运行=172s  AppShell根渲染=162次  最近一次根渲染=15.8s前
reducer换引用榜: 合计34次(全为低频合法操作)
→ 根渲染大头不走 reducer

# 卡滞探针上线后（对话+Agent）
主线程卡滞(近10s): 总计1070ms(11%) 次数=11 最大单次=251ms
卡滞归因: 伴随根渲染=10 其余=1
根渲染端到端成本: 21次/893ms  触发者: 其他state×13 flush×8
react-commit: 14次/204ms
→ 单价问题实锤：React 管线仅占 ~23%

# 刀7 后
主线程卡滞: 982→642ms  react-commit 峰值 40→21ms
→ 层 1（debug 日志）贡献确认

# 终局（updater 追踪上线）
更新发起者榜: Tooltip×354(启动一次性)  AppShell×45/67s(≈reducer合法变化)  ProbeStatsTicker×49(探针自身)
→ 触发侧到达合法下限，残余 = 层 4 单价
```
